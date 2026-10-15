import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { testEnvironment } from "./test.js";

describe("explicit isolated Claude model tests", () => {
  let dir: string;
  let record: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "claude-model-test-"));
    record = path.join(dir, "model-test-calls.jsonl");
    const executable = path.join(dir, "claude");
    await writeFile(executable, `#!${process.execPath}\n${await readFile(new URL("./__fixtures__/model-test-cli.cjs", import.meta.url), "utf8")}`);
    await writeFile(path.join(dir, "model-test-fixture.json"), "{}");
    await chmod(executable, 0o755);
    vi.stubEnv("PATH", `${dir}${path.delimiter}${process.env.PATH}`);
    vi.stubEnv("ANTHROPIC_MODEL", "native-env-model");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
  });
  afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });

  it("uses one new non-persistent tool-free CLI call in the saved cwd without injecting a host default model", async () => {
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local",
      purpose: "model-test", config: { configurationSource: "host", cwd: dir } });
    expect(result).toMatchObject({ purpose: "model-test", outcome: "passed", modelResponse: "passed", cwd: dir });
    const calls = (await readFile(record, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ args: ["--print", "--output-format", "stream-json", "--verbose",
      "--no-session-persistence", "--tools", "", "--disallowedTools", "mcp__*"],
      input: "Respond with hello.", cwd: dir, model: "native-env-model", apiKey: "" });
    expect(JSON.stringify(result)).not.toContain("Hello!");
  });

  it("keeps explicit model and allowlisted env and argument overrides", async () => {
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local", purpose: "model-test",
      config: { configurationSource: "host", cwd: dir, model: "chosen-model", effort: "high", extraArgs: ["--max-turns=2"],
        env: { ANTHROPIC_MODEL: "user-env-model", ANTHROPIC_API_KEY: "fixture-key" } } });
    expect(result.outcome).toBe("passed");
    const call = JSON.parse((await readFile(record, "utf8")).trim());
    expect(call.args).toEqual(expect.arrayContaining(["--model", "chosen-model", "--effort", "high", "--max-turns=2"]));
    expect(call).toMatchObject({ model: "user-env-model", apiKey: "fixture-key" });
    expect(JSON.stringify(result)).not.toContain("fixture-key");
  });

  it.each(["--resume", "--resume=old", "--continue", "-c", "-rold", "--session-id=old", "--fork-session", "--tools=Bash", "--allowed-tools", "--disallowedTools=", "--output-format=text", "--input-format=stream-json", "--no-session-persistence=false", "--bare", "--", "untrusted-input"])("does not send a model request for conflicting argument %s", async argument => {
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local", purpose: "model-test",
      config: { configurationSource: "host", cwd: dir, extraArgs: [argument, "old"] } });
    expect(result).toMatchObject({ outcome: "unsupported", modelResponse: "not_tested" });
    await expect(readFile(record)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["HOME", "PATH", "HTTP_PROXY", "NODE_OPTIONS"])("does not substitute a different environment for caller %s", async key => {
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local", purpose: "model-test",
      config: { configurationSource: "host", cwd: dir, env: { [key]: "/untrusted/override" } } });
    expect(result).toMatchObject({ outcome: "unsupported", modelResponse: "not_tested" });
    await expect(readFile(record)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    { output: "Hello!" }, { output: '{"type":"system","subtype":"init"}' },
    { output: '{"type":"result","subtype":"success","result":"Hello!"}' },
    { output: '{"type":"result","subtype":"success","is_error":true,"result":"Hello!"}' },
    { output: '{"type":"result","subtype":"error_during_execution","is_error":false,"result":"Hello!"}' },
    { output: '{"type":"result","subtype":"success","is_error":false,"result":"credential SECRET_MARKER"}' },
    { exitCode: 1 }, { delayMs: 2000 },
  ])("requires a complete successful hello result without retrying (%j)", async scenario => {
    await writeFile(path.join(dir, "model-test-fixture.json"), JSON.stringify(scenario));
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local", purpose: "model-test",
      config: { configurationSource: "host", cwd: dir, helloProbeTimeoutSec: 1 } });
    expect(result).toMatchObject({ outcome: "failed", modelResponse: "failed" });
    expect((await readFile(record, "utf8")).trim().split("\n")).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("SECRET_MARKER");
  });

  it("does not send a substitute CLI request for an untrusted wrapper", async () => {
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local", purpose: "model-test",
      config: { configurationSource: "host", command: process.execPath, cwd: dir } });
    expect(result).toMatchObject({ outcome: "unsupported", modelResponse: "not_tested" });
    await expect(readFile(record)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns only fixed authentication guidance for a recognized login failure", async () => {
    await writeFile(path.join(dir, "model-test-fixture.json"), JSON.stringify({ exitCode: 1,
      output: JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true,
        result: "Not logged in. SECRET_MARKER https://private.example/login?token=private" }) }));
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local", purpose: "model-test",
      config: { configurationSource: "host", cwd: dir } });
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ code: "claude_model_test_auth_required", hint: expect.stringContaining("administrator") })]));
    expect(JSON.stringify(result)).not.toMatch(/SECRET_MARKER|private\.example|token=private/);
  });
});
