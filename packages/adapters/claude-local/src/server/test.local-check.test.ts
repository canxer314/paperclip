import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { access } from "node:fs/promises";

const runtime = vi.hoisted(() => ({
  directory: vi.fn(async () => {}),
  command: vi.fn(async () => {}),
  resolvedCommand: vi.fn(async () => "/trusted/bin/claude"),
  process: vi.fn(async (..._args: unknown[]) => ({
    exitCode: 0, signal: null, timedOut: false, pid: 1, startedAt: "",
    stdout: "2.1.284 (Claude Code)", stderr: "",
  })),
}));
vi.mock("node:fs/promises", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  access: vi.fn(async () => {}),
}));
vi.mock("@paperclipai/adapter-utils/execution-target", async importOriginal => ({
  ...await importOriginal<typeof import("@paperclipai/adapter-utils/execution-target")>(),
  ensureAdapterExecutionTargetDirectory: runtime.directory,
  ensureAdapterExecutionTargetCommandResolvable: runtime.command,
  resolveAdapterExecutionTargetCommandForLogs: runtime.resolvedCommand,
  runAdapterExecutionTargetProcess: runtime.process,
}));

import { testEnvironment } from "./test.js";

describe("Claude local startup checks", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("PATH", "/trusted/bin");
    runtime.directory.mockResolvedValue(); runtime.command.mockResolvedValue();
    runtime.resolvedCommand.mockResolvedValue("/trusted/bin/claude");
    vi.mocked(access).mockResolvedValue();
    runtime.process.mockImplementation(async (...args: unknown[]) => ({
      exitCode: 0, signal: null, timedOut: false, pid: 1, startedAt: "",
      stdout: JSON.stringify(args[3]) === '["--version"]' ? "2.1.284" : "--print --output-format stream-json --verbose",
      stderr: "",
    }));
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("defaults host checks to local conditions without requesting a model", async () => {
    const result = await testEnvironment({
      companyId: "company-1", adapterType: "claude_local",
      config: { configurationSource: "host", cwd: "/work" },
    });
    expect(result).toMatchObject({
      purpose: "local-check", outcome: "passed", localPrerequisites: "passed",
      modelResponse: "not_tested", cwd: "/work",
    });
    expect(runtime.directory).toHaveBeenCalledWith(expect.any(String), null, "/work",
      expect.objectContaining({ createIfMissing: false }));
    expect(runtime.process).toHaveBeenCalled();
    for (const call of runtime.process.mock.calls) {
      expect(call[3]).toEqual(expect.arrayContaining([expect.stringMatching(/^--(version|help)$/)]));
      expect(call[4]).not.toHaveProperty("stdin");
    }
  });

  it("requires the task CLI protocol but does not require model-test isolation flags", async () => {
    runtime.process.mockImplementation(async (...args: unknown[]) => ({
      exitCode: 0, signal: null, timedOut: false, pid: 1, startedAt: "",
      stdout: JSON.stringify(args[3]) === '["--version"]' ? "2.1.284" : "--print --output-format stream-json --verbose",
      stderr: "",
    }));
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local",
      config: { configurationSource: "host", cwd: "/work" } });
    expect(result.localPrerequisites).toBe("passed");
    expect(runtime.process.mock.calls.map(call => call[3])).toEqual([["--version"], ["--help"]]);
    runtime.process.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, pid: 1, startedAt: "", stdout: "2.1.284 --print", stderr: "" });
    const missing = await testEnvironment({ companyId: "company-1", adapterType: "claude_local",
      config: { configurationSource: "host", cwd: "/work" } });
    expect(missing).toMatchObject({ outcome: "failed", localPrerequisites: "failed" });
  });

  it("keeps full HOME and proxy overrides unverified while allowing local readiness", async () => {
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local",
      config: { configurationSource: "host", cwd: "/work", env: {
        HOME: "/caller-home", HTTPS_PROXY: "http://caller-proxy.invalid", NODE_OPTIONS: "--import=caller-loader", ANTHROPIC_API_KEY: "caller-key",
      } } });
    expect(result).toMatchObject({ status: "warn", outcome: "passed", localPrerequisites: "passed",
      configurationReproducibility: "unverifiable", modelResponse: "not_tested" });
    for (const call of runtime.process.mock.calls) {
      expect(call[2]).toBe("/trusted/bin/claude");
      expect(call[4]).toMatchObject({ env: { ANTHROPIC_API_KEY: "caller-key" } });
      expect(JSON.stringify(call[4])).not.toMatch(/caller-home|caller-proxy|caller-loader/);
    }
    expect(JSON.stringify(result)).not.toMatch(/caller-key|caller-proxy|caller-loader/);
  });

  it.each(["/caller/bin/claude", "/caller/wrapper"])("does not probe a substitute executable for %s", async command => {
    runtime.resolvedCommand.mockResolvedValue(command);
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local",
      config: { configurationSource: "host", command, cwd: "/work", env: { PATH: "/caller/bin" } } });
    expect(result).toMatchObject({ outcome: "unverifiable", localPrerequisites: "unverifiable" });
    expect(runtime.process).not.toHaveBeenCalled();
  });

  it("does not trust a relative server PATH executable", async () => {
    vi.stubEnv("PATH", "."); runtime.resolvedCommand.mockResolvedValue("claude");
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local", config: { configurationSource: "host" } });
    expect(result.outcome).toBe("unverifiable"); expect(runtime.process).not.toHaveBeenCalled();
  });

  it("fails a missing cwd without creating it or copying raw diagnostics", async () => {
    runtime.directory.mockRejectedValue(new Error("PRIVATE_DIRECTORY_DIAGNOSTIC"));
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local",
      config: { configurationSource: "host", cwd: "/missing", directoryPreparation: "create", createIfMissing: true } });
    expect(result).toMatchObject({ outcome: "failed", localPrerequisites: "failed" });
    expect(runtime.directory).toHaveBeenCalledWith(expect.any(String), null, "/missing", expect.objectContaining({ createIfMissing: false }));
    expect(runtime.process).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain("PRIVATE_DIRECTORY_DIAGNOSTIC");
  });

  it("keeps directory preparation for a trusted automatic verification", async () => {
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local", purpose: "local-check", directoryPreparation: "create",
      config: { configurationSource: "host", cwd: "/new" } });
    expect(result.localPrerequisites).toBe("passed");
    expect(runtime.directory).toHaveBeenCalledWith(expect.any(String), null, "/new", expect.objectContaining({ createIfMissing: true }));
  });

  it.each(["acp", "auto"])("rejects explicit %s without preparing directories or processes", async engine => {
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local",
      config: { configurationSource: "host", engine } });
    expect(result.outcome).toBe("unsupported"); expect(runtime.directory).not.toHaveBeenCalled(); expect(runtime.process).not.toHaveBeenCalled();
  });

  it("does not request a model when isolated host model testing is unavailable", async () => {
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local", purpose: "model-test",
      config: { configurationSource: "host" } });
    expect(result).toMatchObject({ purpose: "model-test", outcome: "unsupported", modelResponse: "not_tested" });
    expect(runtime.process).not.toHaveBeenCalled();
  });

  it("retains required CLI version gates for explicitly selected models", async () => {
    runtime.process.mockResolvedValue({ exitCode: 0, signal: null, timedOut: false, pid: 1, startedAt: "", stdout: "2.1.279", stderr: "" });
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local",
      config: { configurationSource: "host", model: "claude-opus-5-5" } });
    expect(result).toMatchObject({ outcome: "failed", localPrerequisites: "failed" });
    expect(runtime.process.mock.calls.map(call => call[3])).toEqual([["--version"]]);
  });

  it("does not inject a Paperclip default model or classify absent keys as missing authentication", async () => {
    const result = await testEnvironment({ companyId: "company-1", adapterType: "claude_local", config: { configurationSource: "host" } });
    expect(result.localPrerequisites).toBe("passed");
    expect(JSON.stringify(runtime.process.mock.calls)).not.toMatch(/--model|Respond with hello|ANTHROPIC_MODEL/);
    expect(result.checks.some(check => check.code.includes("auth_missing") || check.code.includes("hello_probe"))).toBe(false);
  });
});
