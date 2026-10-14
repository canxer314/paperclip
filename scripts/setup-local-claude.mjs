#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "paperclip-local-claude-smoke-v1";

function runClaudeCheck(command, args, label) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error(`Claude ${label} check failed. Check the executable and its local configuration.`);
  }
}

export function buildPayload({ name, command, configDir, workspace }) {
  return {
    name,
    role: "general",
    title: "Local Claude Code / cc-switch connectivity test",
    capabilities: "Connectivity test only. Tools and automatic heartbeats disabled.",
    adapterType: "claude_local",
    instructionsBundle: {
      entryFile: "AGENTS.md",
      files: {
        "AGENTS.md": "# Connectivity test\n\nReturn exactly PAPERCLIP_CC_SWITCH_OK. Do not use tools, access files, or perform other work. This is not a task-processing heartbeat.\n",
      },
    },
    adapterConfig: {
      engine: "cli",
      command,
      cwd: workspace,
      dangerouslySkipPermissions: false,
      timeoutSec: 90,
      graceSec: 5,
      env: { CLAUDECODE: "", CLAUDE_CONFIG_DIR: configDir },
      extraArgs: [
        "--safe-mode", "--tools", "", "--disable-slash-commands",
        "--no-session-persistence", "--strict-mcp-config", "--mcp-config",
        '{"mcpServers":{}}', "--permission-mode", "dontAsk", "--max-budget-usd", "0.25",
      ],
    },
    runtimeConfig: { heartbeat: { enabled: false, intervalSec: 0, wakeOnDemand: true } },
    metadata: { localClaudeSetup: MARKER },
  };
}

export function validateSettings(settings) {
  const url = new URL(settings.env?.ANTHROPIC_BASE_URL ?? "");
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("ANTHROPIC_BASE_URL must be an HTTP(S) URL without embedded credentials.");
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Expected a loopback cc-switch endpoint in Claude settings.");
  }
  if (!settings.env?.ANTHROPIC_AUTH_TOKEN && !settings.env?.ANTHROPIC_API_KEY) {
    throw new Error("No proxy authentication found in Claude settings. Configure cc-switch first.");
  }
  return url.origin;
}

function help() {
  console.log(`Usage: node scripts/setup-local-claude.mjs [options]

  --api-base URL        Paperclip API origin (default http://127.0.0.1:3100)
  --company-id ID       Required if more than one company exists
  --name NAME           Test Agent name (default Local Claude via cc-switch)
  --claude PATH         Claude executable (default resolved from PATH)
  --config-dir PATH     Claude config directory (default CLAUDE_CONFIG_DIR or ~/.claude)
  --workspace PATH      Empty/dedicated test workspace (choose another for each setup)
  --dry-run             Check prerequisites and print non-secret configuration; no mutations
  --test                Invoke one model run after setup; consumes upstream quota
  --help                Show this help

Run on the SAME host and under the SAME user as the Paperclip server.
This creates only a tool-free test Agent, not a production coding Agent.
Existing Agents and credentials are never overwritten. No Claude login is performed.`);
}

async function main() {
  const opts = { apiBase: "http://127.0.0.1:3100", name: "Local Claude via cc-switch" };
  const values = { "--api-base": "apiBase", "--company-id": "companyId", "--name": "name", "--claude": "command", "--config-dir": "configDir", "--workspace": "workspace" };
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--help") return help();
    if (arg === "--test") opts.test = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (values[arg] && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) opts[values[arg]] = process.argv[++i];
    else throw new Error(`Unknown option or missing value: ${arg}`);
  }
  if (opts.test && opts.dryRun) throw new Error("Choose --test or --dry-run, not both.");
  const api = new URL(opts.apiBase);
  if (!["http:", "https:"].includes(api.protocol) || api.username || api.password || api.search || api.hash || !["/", ""].includes(api.pathname)) {
    throw new Error("--api-base must be an HTTP(S) origin, e.g. http://127.0.0.1:3100, without /api or credentials.");
  }
  opts.configDir = path.resolve(opts.configDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"));
  const command = opts.command ? path.resolve(opts.command) : runClaudeCheck("which", ["claude"], "executable resolution").trim();
  opts.command = command;
  let settings;
  try {
    settings = JSON.parse(readFileSync(path.join(opts.configDir, "settings.json"), "utf8"));
  } catch {
    throw new Error(`Could not read valid Claude settings at ${path.join(opts.configDir, "settings.json")}. Check the file locally; its contents are not displayed.`);
  }
  const gateway = validateSettings(settings);
  console.log(`Claude: ${runClaudeCheck(opts.command, ["--version"], "version").trim()}`);
  console.log(`Config: ${opts.configDir}\nProxy: ${gateway} (credential values are not copied or printed)`);
  const claudeHelp = runClaudeCheck(opts.command, ["--help"], "CLI compatibility");
  for (const flag of ["--safe-mode", "--tools", "--disable-slash-commands", "--no-session-persistence", "--strict-mcp-config", "--max-budget-usd"]) {
    if (!claudeHelp.includes(flag)) throw new Error(`Claude CLI does not support ${flag}; this script requires a compatible version.`);
  }
  const cli = (...args) => {
    let out;
    try {
      out = execFileSync("paperclipai", [...args, "--api-base", opts.apiBase, "--json"], {
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024,
      });
    } catch {
      throw new Error("Paperclip CLI command failed. Check CLI authentication, API availability, and version compatibility.");
    }
    try { return JSON.parse(out); }
    catch { throw new Error("Paperclip did not return JSON. Check CLI authentication, API availability, and version compatibility."); }
  };
  let identity;
  try { identity = cli("whoami"); }
  catch { throw new Error(`Authorize the CLI first: paperclipai auth login --no-browser --api-base ${opts.apiBase}\nApprove in the Paperclip browser, then rerun. This is NOT Claude login.`); }
  if (identity.source === "agent_key" || !identity.userId) throw new Error("Board-user CLI authentication is required.");
  const companies = cli("company", "list");
  if (!opts.companyId) {
    if (companies.length !== 1) {
      console.log(companies.map(c => `${c.id}  ${c.name}`).join("\n"));
      throw new Error("Choose a company with --company-id.");
    }
    opts.companyId = companies[0].id;
  }
  if (!companies.some(c => c.id === opts.companyId)) throw new Error("Selected company is not accessible.");
  opts.workspace = path.resolve(opts.workspace ?? path.join(os.homedir(), ".paperclip", "local-claude-smoke", opts.companyId));
  try {
    if (readdirSync(opts.workspace).length > 0) {
      throw new Error(`Workspace ${opts.workspace} is not empty. Choose an empty, dedicated test workspace; nothing was overwritten.`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const payload = buildPayload({ ...opts, workspace: opts.workspace });
  const matches = cli("agent", "list", "--company-id", opts.companyId).filter(a => a.name === opts.name);
  if (matches.length > 0) {
    throw new Error("An Agent with this name already exists. Reuse is disabled; choose a new --name and an empty, dedicated --workspace.");
  }
  console.log(`Company: ${opts.companyId}\nWorkspace: ${opts.workspace}`);
  if (opts.dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    console.log("Dry run passed. No Agent created and no model request sent.");
    return;
  }
  mkdirSync(opts.workspace, { recursive: true, mode: 0o700 });
  const agent = cli("agent", "create", "--company-id", opts.companyId, "--payload-json", JSON.stringify(payload));
  if (!agent?.id) throw new Error("Paperclip created no Agent. Check CLI output and server compatibility.");
  console.log(`Test Agent: ${agent.name} (${agent.id})\nAutomatic heartbeats disabled; managed AI Connection not bound.`);
  if (!opts.test) {
    console.log("Setup complete. Add --test to explicitly authorize one upstream model run.");
    return;
  }
  const run = cli("agent", "heartbeat:invoke", agent.id);
  if (!run?.id) throw new Error("No run was scheduled. Check Agent approval and wake policy.");
  console.log(`Run: ${run.id}`);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const result = cli("run", "get", run.id);
    if (result.status === "succeeded") {
      if ((result.resultJson?.result ?? result.resultJson?.summary)?.trim() !== "PAPERCLIP_CC_SWITCH_OK") {
        throw new Error(`Run ${run.id} succeeded but did not return the expected marker. Inspect it in Paperclip.`);
      }
      console.log("PASS: PAPERCLIP_CC_SWITCH_OK");
      console.log("For the actual upstream model and bill, inspect the matching session in cc-switch; Claude aliases and Paperclip costs are not authoritative.");
      return;
    }
    if (["failed", "cancelled", "timed_out"].includes(result.status)) {
      throw new Error(`Run ${run.id} ended with ${result.status}. Inspect its log in Paperclip. No automatic retry was sent.`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`Stopped waiting for run ${run.id}. It may still be queued/running; inspect or cancel it before retrying --test.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error instanceof Error ? error.message : "Setup failed."); process.exitCode = 1; });
}
