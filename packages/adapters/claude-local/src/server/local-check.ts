import type { AdapterEnvironmentCheck, AdapterEnvironmentTestContext, AdapterEnvironmentTestResult } from "@paperclipai/adapter-utils";
import { asNumber, asString, asStringArray, ensurePathInEnv, parseObject } from "@paperclipai/adapter-utils/server-utils";
import {
  ensureAdapterExecutionTargetDirectory,
  ensureAdapterExecutionTargetCommandResolvable,
  resolveAdapterExecutionTargetCommandForLogs,
  resolveAdapterExecutionTargetCwd,
  runAdapterExecutionTargetProcess,
} from "@paperclipai/adapter-utils/execution-target";
import { readClaudeCommandVersion, claudeCliVersionAtLeast, minimumClaudeCliVersionForModel } from "./cli-capabilities.js";
import { buildLocalAdapterTestProbeEnv } from "./probe-env.js";
import path from "node:path";
import { detectClaudeLoginRequired, parseClaudeStreamJson } from "./parse.js";

/** Shared trusted preflight. Only the explicit model-test purpose sends inference input. */
export async function checkClaudeLocalEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  const config = parseObject(ctx.config);
  const modelTest = ctx.purpose === "model-test";
  const target = ctx.executionTarget ?? null;
  const cwd = resolveAdapterExecutionTargetCwd(target, asString(config.cwd, ""), process.cwd());
  const checks: AdapterEnvironmentCheck[] = [];
  let reproducibility: AdapterEnvironmentTestResult["configurationReproducibility"] = "unverifiable";
  const result = (outcome: NonNullable<AdapterEnvironmentTestResult["outcome"]>): AdapterEnvironmentTestResult => ({
    adapterType: ctx.adapterType, purpose: ctx.purpose ?? "local-check", outcome: modelTest && outcome === "unverifiable" ? "unsupported" : outcome,
    status: outcome === "failed" ? "fail" : outcome === "passed" && !checks.some(check => check.level === "warn") ? "pass" : "warn",
    localPrerequisites: outcome === "passed" ? "passed" : outcome === "failed" ? "failed" : "unverifiable",
    configurationReproducibility: reproducibility, modelResponse: "not_tested",
    checks, testedAt: new Date().toISOString(), cwd,
    ...(modelTest ? { selectedModel: asString(config.model, "").trim() } : {}),
  });
  if ((config.engine !== undefined && config.engine !== "cli") || target?.kind === "remote") {
    checks.push({ code: "claude_local_check_unsupported_target", level: "warn",
      message: "Local checks require the local Claude Code CLI target." });
    return result("unsupported");
  }
  const runId = `claude-local-check-${Date.now()}`;
  try {
    await ensureAdapterExecutionTargetDirectory(runId, target, cwd, {
      cwd, env: {}, createIfMissing: !modelTest && ctx.directoryPreparation === "create",
    });
    checks.push({ code: "claude_cwd_valid", level: "info", message: "The working directory is available." });
  } catch {
    checks.push({ code: "claude_cwd_invalid", level: "error", message: "The working directory is unavailable." });
    return result("failed");
  }
  const env = Object.fromEntries(Object.entries(parseObject(config.env)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const probe = await buildLocalAdapterTestProbeEnv({ callerEnv: env, trustedEnv: process.env });
  const envMatches = Object.entries(env).every(([key, value]) => (probe.env[key] ?? process.env[key]) === value);
  if (modelTest && !envMatches) {
    checks.push({ code: "claude_model_test_unsupported", level: "warn", message: "The effective environment cannot be faithfully reproduced by the trusted model test. No model request was sent." });
    return result("unsupported");
  }
  const command = asString(config.command, "claude");
  let runtimeCommand: string;
  try {
    const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
    await ensureAdapterExecutionTargetCommandResolvable(command, target, cwd, runtimeEnv);
    runtimeCommand = await resolveAdapterExecutionTargetCommandForLogs(command, target, cwd, runtimeEnv);
  } catch {
    checks.push({ code: "claude_command_unresolvable", level: "error", message: "The configured command is not executable." });
    return result("failed");
  }
  if (!probe.command || !path.isAbsolute(probe.command) || probe.command !== runtimeCommand) {
    checks.push({ code: "claude_executable_unverifiable", level: "warn",
      message: "The runtime executable cannot be confirmed by the trusted local check. No other CLI was tested." });
    return result("unverifiable");
  }
  const version = await readClaudeCommandVersion({ runId, command: probe.command, target, cwd, env: probe.env, timeoutSec: 20, graceSec: 5 });
  if (!version) {
    checks.push({ code: "claude_cli_version_unverifiable", level: "warn", message: "The installed Claude Code version could not be confirmed." });
    return result("unverifiable");
  }
  checks.push({ code: "claude_cli_version_valid", level: "info", message: `Claude Code ${version} is installed.` });
  const runtimeModel = { ...process.env, ...env }.ANTHROPIC_MODEL;
  const model = asString(config.model, "").trim() || asString(runtimeModel, "").trim();
  const minimumVersion = minimumClaudeCliVersionForModel(model);
  if (minimumVersion && !claudeCliVersionAtLeast(version, minimumVersion)) {
    checks.push({ code: "claude_cli_version_incompatible", level: "error", message: "The installed Claude Code version does not meet the selected model's CLI requirement." });
    return result("failed");
  }
  try {
    const help = await runAdapterExecutionTargetProcess(runId, target, probe.command, ["--help"], {
      cwd, env: probe.env, timeoutSec: 20, graceSec: 5, onLog: async () => {},
    });
    if (help.timedOut || help.signal || help.exitCode === null) {
      checks.push({ code: "claude_cli_capabilities_unverifiable", level: "warn", message: "The required task CLI capabilities could not be confirmed." });
      return result("unverifiable");
    }
    const output = `${help.stdout}\n${help.stderr}`;
    if (help.exitCode !== 0 || !["--print", "--output-format", "stream-json", "--verbose"].every(flag => output.includes(flag))) {
      checks.push({ code: "claude_cli_capabilities_missing", level: "error", message: "The installed CLI does not advertise the required task output protocol." });
      return result("failed");
    }
    if (modelTest && !["--no-session-persistence", "--tools", "--disallowedTools"].every(flag => output.includes(flag))) {
      checks.push({ code: "claude_model_test_unsupported", level: "warn", message: "The installed CLI does not advertise the isolated model-test capabilities. No model request was sent." });
      return result("unsupported");
    }
  } catch {
    checks.push({ code: "claude_cli_capabilities_unverifiable", level: "warn", message: "The required task CLI capabilities could not be confirmed." });
    return result("unverifiable");
  }
  const hasArguments = [config.args, config.extraArgs].some(value => Array.isArray(value) && value.length > 0);
  const hasScopes = Boolean(config.filesystemScope || config.networkScope);
  reproducibility = envMatches && !hasArguments && !hasScopes ? "verified" : "unverifiable";
  if (modelTest) {
    const extraArgs = asStringArray(config.extraArgs).length ? asStringArray(config.extraArgs) : asStringArray(config.args);
    // Only documented value options whose behavior preserves isolation can be reproduced.
    const safeValueOptions = new Set(["--model", "--effort", "--max-turns", "--add-dir", "--settings", "--setting-sources"]);
    let safeArguments = true;
    for (let index = 0; index < extraArgs.length; index++) {
      const [flag, inlineValue] = extraArgs[index].split(/=(.*)/s);
      if (!safeValueOptions.has(flag)) { safeArguments = false; break; }
      const value = inlineValue ?? extraArgs[++index];
      if (!value || value.startsWith("-")) { safeArguments = false; break; }
    }
    if (!envMatches || hasScopes || !safeArguments || config.chrome === true) {
      checks.push({ code: "claude_model_test_unsupported", level: "warn", message: "The configuration cannot be faithfully reproduced within the isolated model-test boundary. No model request was sent." });
      return result("unsupported");
    }
    reproducibility = "verified";
    const args = ["--print", "--output-format", "stream-json", "--verbose",
      "--no-session-persistence", "--tools", "", "--disallowedTools", "mcp__*"];
    if (typeof config.model === "string" && config.model.trim()) args.push("--model", config.model.trim());
    if (typeof config.effort === "string" && config.effort.trim()) args.push("--effort", config.effort.trim());
    if (typeof config.maxTurnsPerRun === "number" && config.maxTurnsPerRun > 0) args.push("--max-turns", String(config.maxTurnsPerRun));
    if (config.dangerouslySkipPermissions === true) args.push("--dangerously-skip-permissions");
    args.push(...extraArgs);
    try {
      const tested = await runAdapterExecutionTargetProcess(runId, target, probe.command, args, {
        cwd, env: probe.env, timeoutSec: Math.max(1, asNumber(config.helloProbeTimeoutSec, 45)),
        graceSec: 5, stdin: "Respond with hello.", onLog: async () => {},
      });
      const terminal = parseClaudeStreamJson(tested.stdout).resultJson;
      const passed = !tested.timedOut && !tested.signal && tested.exitCode === 0 && terminal?.subtype === "success"
        && terminal.is_error === false && typeof terminal.result === "string" && /^hello[.!]?$/i.test(terminal.result.trim());
      const requiresLogin = !passed && detectClaudeLoginRequired({ parsed: terminal, stdout: tested.stdout, stderr: tested.stderr }).requiresLogin;
      checks.push({ code: passed ? "claude_model_test_passed" : requiresLogin ? "claude_model_test_auth_required" : "claude_model_test_failed", level: passed ? "info" : "error",
        message: passed ? "This model call succeeded. External costs and actual backend routing are unknown." : "This model call failed or returned an incomplete or unexpected result. External execution and charges may still have occurred.",
        hint: requiresLogin ? "Ask the execution-host administrator to repair native authentication or the saved env override, then explicitly test again." : undefined });
      return { ...result(passed ? "passed" : "failed"), localPrerequisites: "passed", modelResponse: passed ? "passed" : "failed" };
    } catch {
      checks.push({ code: "claude_model_test_failed", level: "error", message: "This model call could not be completed. External execution and charges may still have occurred." });
      return { ...result("failed"), localPrerequisites: "passed", modelResponse: "failed" };
    }
  }
  checks.push({ code: "claude_local_prerequisites_passed", level: "info", message: "Local startup conditions passed. Authentication and model responses were not tested." });
  if (reproducibility === "unverifiable") {
    checks.push({ code: "claude_configuration_unverifiable", level: "warn", message: "Local startup conditions passed, but the full environment, scopes, or argument overrides were not reproduced." });
  }
  return result("passed");
}
