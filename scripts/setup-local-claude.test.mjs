import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPayload, validateSettings } from "./setup-local-claude.mjs";

const options = { name: "Test", command: "/usr/bin/claude", configDir: "/home/test/.claude", workspace: "/home/test/work" };
const scriptPath = path.join(import.meta.dirname, "setup-local-claude.mjs");

test("builds a local CLI Agent without managed credentials or automatic scheduling", () => {
  const payload = buildPayload(options);
  assert.equal(payload.adapterConfig.engine, "cli");
  assert.equal(payload.runtimeConfig.aiConnection, undefined);
  assert.equal(payload.runtimeConfig.heartbeat.enabled, false);
  assert.equal(payload.adapterConfig.dangerouslySkipPermissions, false);
  assert.ok(payload.adapterConfig.extraArgs.includes("--tools"));
  assert.ok(!JSON.stringify(payload).includes("ANTHROPIC_AUTH_TOKEN"));
});

test("requires a loopback proxy and existing authentication without returning the credential", () => {
  assert.equal(validateSettings({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:15721", ANTHROPIC_AUTH_TOKEN: "secret" } }), "http://127.0.0.1:15721");
  assert.throws(() => validateSettings({ env: { ANTHROPIC_BASE_URL: "https://example.com", ANTHROPIC_AUTH_TOKEN: "secret" } }));
  assert.throws(() => validateSettings({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:15721" } }));
});

function makeFixture(t, { existingAgent = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "paperclip-local-claude-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const configDir = path.join(root, "config");
  const workspace = path.join(root, "workspace");
  mkdirSync(bin);
  mkdirSync(configDir);
  writeFileSync(path.join(configDir, "settings.json"), JSON.stringify({ env: {
    ANTHROPIC_BASE_URL: "http://127.0.0.1:15721",
    ANTHROPIC_AUTH_TOKEN: "fixture-secret-must-not-be-printed",
  } }));

  const claude = path.join(bin, "claude");
  writeFileSync(claude, `#!/usr/bin/env node\nif (process.argv.includes("--version")) console.log("Claude fixture");\nelse if (process.argv.includes("--help")) console.log("--safe-mode --tools --disable-slash-commands --no-session-persistence --strict-mcp-config --max-budget-usd");\n`);
  chmodSync(claude, 0o755);

  const callLog = path.join(root, "calls.jsonl");
  const paperclip = path.join(bin, "paperclipai");
  writeFileSync(paperclip, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FIXTURE_CALL_LOG, JSON.stringify(args) + "\\n");
let result;
if (args[0] === "whoami") result = { source: "user_session", userId: "fixture-user" };
else if (args[0] === "company" && args[1] === "list") result = [{ id: "fixture-company", name: "Fixture" }];
else if (args[0] === "agent" && args[1] === "list") result = process.env.FIXTURE_EXISTING_AGENT ? [{ id: "fixture-agent", name: "Test" }] : [];
  else if (args[0] === "agent" && args[1] === "create") {
    const payload = JSON.parse(args[args.indexOf("--payload-json") + 1]);
    const env = Object.fromEntries(Object.entries(payload.adapterConfig.env).map(([key]) => [key, { type: "plain", value: "***REDACTED***" }]));
    result = { ...payload, id: "fixture-agent", status: "idle", adapterConfig: { ...payload.adapterConfig, env } };
  }
else if (args[0] === "agent" && args[1] === "heartbeat:invoke") result = { id: "fixture-run" };
else if (args[0] === "run" && args[1] === "get") result = { status: "succeeded", resultJson: { result: "PAPERCLIP_CC_SWITCH_OK" } };
else result = {};
console.log(JSON.stringify(result));
`);
  chmodSync(paperclip, 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    FIXTURE_CALL_LOG: callLog,
    ...(existingAgent ? { FIXTURE_EXISTING_AGENT: "1" } : {}),
  };
  const run = (...args) => spawnSync(process.execPath, [scriptPath, "--config-dir", configDir, "--claude", claude, "--workspace", workspace, "--name", "Test", ...args], { encoding: "utf8", env });
  const calls = () => readFileSync(callLog, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  return { run, calls, workspace };
}

test("CLI creates a test Agent in an empty workspace without invoking it", t => {
  const fixture = makeFixture(t);
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  const calls = fixture.calls();
  assert.equal(calls.filter(args => args[0] === "agent" && args[1] === "create").length, 1);
  assert.equal(calls.some(args => args[0] === "agent" && args[1] === "heartbeat:invoke"), false);
  assert.equal(calls.some(args => args[0] === "run" && args[1] === "get"), false);
});

test("CLI creates and invokes one test Agent when --test is requested", t => {
  const fixture = makeFixture(t);
  const result = fixture.run("--test");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS: PAPERCLIP_CC_SWITCH_OK/);
  const calls = fixture.calls();
  assert.equal(calls.filter(args => args[0] === "agent" && args[1] === "create").length, 1);
  assert.equal(calls.filter(args => args[0] === "agent" && args[1] === "heartbeat:invoke").length, 1);
  assert.equal(calls.filter(args => args[0] === "run" && args[1] === "get").length, 1);
});

test("CLI refuses an existing Agent before creation or heartbeat", t => {
  const fixture = makeFixture(t, { existingAgent: true });
  const result = fixture.run("--test");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reuse is disabled/i);
  const calls = fixture.calls();
  assert.equal(calls.some(args => args[0] === "agent" && args[1] === "create"), false);
  assert.equal(calls.some(args => args[0] === "agent" && args[1] === "heartbeat:invoke"), false);
  assert.equal(calls.some(args => args[0] === "agent" && args[1] === "get"), false);
});

test("CLI refuses a nonempty workspace before creating an Agent, including dry runs", t => {
  const fixture = makeFixture(t);
  mkdirSync(fixture.workspace);
  writeFileSync(path.join(fixture.workspace, "keep.txt"), "do not overwrite");
  for (const args of [[], ["--dry-run"]]) {
    const result = fixture.run(...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /workspace.*not empty/i);
  }
  assert.equal(fixture.calls().some(args => args[0] === "agent" && args[1] === "create"), false);
  assert.equal(readFileSync(path.join(fixture.workspace, "keep.txt"), "utf8"), "do not overwrite");
  assert.ok(!fixture.calls().some(args => args[0] === "agent" && args[1] === "heartbeat:invoke"));
  const outputs = fixture.calls();
  assert.ok(outputs.length > 0);
});

test("CLI refuses a nonempty workspace for an existing Agent before heartbeat", t => {
  const fixture = makeFixture(t, { existingAgent: true });
  mkdirSync(fixture.workspace);
  writeFileSync(path.join(fixture.workspace, "keep.txt"), "do not overwrite");
  const result = fixture.run("--test");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /workspace.*not empty/i);
  const calls = fixture.calls();
  assert.equal(calls.some(args => args[0] === "agent" && args[1] === "heartbeat:invoke"), false);
  assert.equal(readFileSync(path.join(fixture.workspace, "keep.txt"), "utf8"), "do not overwrite");
});

test("CLI refuses a modified existing Agent instruction bundle before heartbeat", t => {
  const fixture = makeFixture(t, { existingAgent: true });
  const result = fixture.run("--test");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reuse is disabled/i);
  const calls = fixture.calls();
  assert.equal(calls.some(args => args[0] === "agent" && args[1] === "create"), false);
  assert.equal(calls.some(args => args[0] === "agent" && args[1] === "heartbeat:invoke"), false);
  assert.equal(calls.some(args => args[0] === "agent" && args[1] === "get"), false);
});
