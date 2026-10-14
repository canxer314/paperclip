import type { AdapterEnvironmentCheck, AdapterEnvironmentTestContext, AdapterEnvironmentTestResult } from "@paperclipai/adapter-utils";
import { asString, ensurePathInEnv, parseObject } from "@paperclipai/adapter-utils/server-utils";
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

/** A local startup proof never tests authentication or sends inference input. */
export async function checkClaudeLocalEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  const config = parseObject(ctx.config);
  const target = ctx.executionTarget ?? null;
  const cwd = resolveAdapterExecutionTargetCwd(target, asString(config.cwd, ""), process.cwd());
  const checks: AdapterEnvironmentCheck[] = [];
  let reproducibility: AdapterEnvironmentTestResult["configurationReproducibility"] = "unverifiable";
  const result = (outcome: NonNullable<AdapterEnvironmentTestResult["outcome"]>): AdapterEnvironmentTestResult => ({
    adapterType: ctx.adapterType, purpose: ctx.purpose ?? "local-check", outcome,
    status: outcome === "failed" ? "fail" : outcome === "passed" && !checks.some(check => check.level === "warn") ? "pass" : "warn",
    localPrerequisites: outcome === "passed" ? "passed" : outcome === "failed" ? "failed" : "unverifiable",
    configurationReproducibility: reproducibility, modelResponse: "not_tested",
    checks, testedAt: new Date().toISOString(), cwd,
  });
  if ((config.engine !== undefined && config.engine !== "cli") || target?.kind === "remote") {
    checks.push({ code: "claude_local_check_unsupported_target", level: "warn",
      message: "Local checks require the local Claude Code CLI target." });
    return result("unsupported");
  }
  if (ctx.purpose === "model-test") {
    checks.push({ code: "claude_model_test_unsupported", level: "warn", message: "An isolated host model test is not available." });
    return result("unsupported");
  }
  const runId = `claude-local-check-${Date.now()}`;
  try {
    await ensureAdapterExecutionTargetDirectory(runId, target, cwd, {
      cwd, env: {}, createIfMissing: ctx.directoryPreparation === "create",
    });
    checks.push({ code: "claude_cwd_valid", level: "info", message: "The working directory is available." });
  } catch {
    checks.push({ code: "claude_cwd_invalid", level: "error", message: "The working directory is unavailable." });
    return result("failed");
  }
  const env = Object.fromEntries(Object.entries(parseObject(config.env)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
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
  const probe = await buildLocalAdapterTestProbeEnv({ callerEnv: env, trustedEnv: process.env });
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
  const model = asString(config.model, "").trim() || asString(env.ANTHROPIC_MODEL, "").trim() || process.env.ANTHROPIC_MODEL || "";
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
  } catch {
    checks.push({ code: "claude_cli_capabilities_unverifiable", level: "warn", message: "The required task CLI capabilities could not be confirmed." });
    return result("unverifiable");
  }
  const envMatches = Object.entries(env).every(([key, value]) => (probe.env[key] ?? process.env[key]) === value);
  const hasArguments = [config.args, config.extraArgs].some(value => Array.isArray(value) && value.length > 0);
  const hasScopes = Boolean(config.filesystemScope || config.networkScope);
  reproducibility = envMatches && !hasArguments && !hasScopes ? "verified" : "unverifiable";
  checks.push({ code: "claude_local_prerequisites_passed", level: "info", message: "Local startup conditions passed. Authentication and model responses were not tested." });
  if (reproducibility === "unverifiable") {
    checks.push({ code: "claude_configuration_unverifiable", level: "warn", message: "Local startup conditions passed, but the full environment, scopes, or argument overrides were not reproduced." });
  }
  return result("passed");
}
