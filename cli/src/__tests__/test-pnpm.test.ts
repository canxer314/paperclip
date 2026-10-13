import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTestPnpmInvocation } from "./helpers/pnpm.js";

let root = "";
afterEach(() => {
  vi.restoreAllMocks();
  if (root) rmSync(root, { recursive: true, force: true });
});

function fixtureNode(node: string) {
  if (process.platform === "win32") copyFileSync(process.execPath, node);
  else symlinkSync(process.execPath, node);
}

function fixture() {
  root = mkdtempSync(path.join(os.tmpdir(), "paperclip pnpm & regression-"));
  for (const dir of ["home", "cache", "bin", "manager", "repo"]) mkdirSync(path.join(root, dir));
  writeFileSync(path.join(root, "repo/package.json"), JSON.stringify({ packageManager: "pnpm@99.0.0" }));
  const env = {
    HOME: path.join(root, "home"),
    PAPERCLIP_HOME: path.join(root, "home/paperclip"),
    COREPACK_HOME: path.join(root, "cache"),
    COREPACK_ENABLE_NETWORK: "0",
    PATH: path.join(root, "bin"),
  };
  if (process.platform === "win32") {
    writeFileSync(path.join(root, "bin/pnpm.cmd"), "@exit /b 99\r\n");
  } else {
    writeFileSync(path.join(root, "bin/pnpm"), '#!/bin/sh\nexit 99\n', { mode: 0o755 });
  }
  return env;
}

const resolveSkippedSuitePnpm = vi.fn(() => { throw new Error("pnpm must not be required for a skipped suite"); });
vi.doMock("./helpers/pnpm.js", () => ({ resolveTestPnpmInvocation: resolveSkippedSuitePnpm }));
vi.doMock("./helpers/embedded-postgres.js", () => ({
  getEmbeddedPostgresTestSupport: async () => ({ supported: false, reason: "regression fixture" }),
  startEmbeddedPostgresTestDatabase: vi.fn(),
}));
let skippedSuiteImportError: unknown;
let createBasePaperclipEnv: typeof import("./company-import-export-e2e.test.js").createBasePaperclipEnv;
try {
  ({ createBasePaperclipEnv } = await import("./company-import-export-e2e.test.js"));
} catch (error) {
  skippedSuiteImportError = error;
} finally {
  vi.doUnmock("./helpers/pnpm.js");
  vi.doUnmock("./helpers/embedded-postgres.js");
}

describe("unsupported embedded Postgres host", () => {
  it("collects the skipped company suite without resolving pnpm", () => {
    expect(skippedSuiteImportError).toBeUndefined();
    expect(resolveSkippedSuitePnpm).not.toHaveBeenCalled();
  });
});

describe("offline test pnpm invocation", () => {
  it.each(["PATH", "Path", "path"])("preserves the existing %s search-path key", (key) => {
    const original = process.env;
    try {
      process.env = { [key]: "original-search-path" };
      const env = createBasePaperclipEnv({ configPath: "config", paperclipHome: "home", instanceId: "test", shellHome: "shell" });
      expect(Object.keys(env).filter((name) => name.toLowerCase() === "path")).toEqual([key]);
      expect(env[key]).toBe(`${path.join("shell", "bin")}${path.delimiter}original-search-path`);
    } finally {
      process.env = original;
    }
  });

  it("deduplicates mixed-case PATH keys while preserving Windows' first search path", () => {
    const original = process.env;
    try {
      process.env = { path: "ignored-lower", Path: "ignored-title", PATH: "windows-search-path" };
      const env = createBasePaperclipEnv({ configPath: "config", paperclipHome: "home", instanceId: "test", shellHome: "shell" });
      expect(Object.keys(env).filter((name) => name.toLowerCase() === "path")).toEqual(["PATH"]);
      expect(env.PATH).toBe(`${path.join("shell", "bin")}${path.delimiter}windows-search-path`);
    } finally {
      process.env = original;
    }
  });

  // Resolve the real installed manager before replacing HOME or PATH. The
  // wrapper below delegates to it, so every probe runs the lifecycle shell.
  const realPnpm = resolveTestPnpmInvocation(path.resolve(import.meta.dirname, "../../.."));
  const probeCases = (process.platform === "win32"
    ? ["node space.exe"]
    : ["node space", "node $HOME", "node `echo substituted`", "node $(echo substituted)"])
    .map((name) => ({ name, manager: undefined as string | undefined }));
  probeCases.push(...["corepack", "npm"].map((manager) => ({ name: process.platform === "win32" ? "node space.exe" : "node space", manager })));
  it.each(probeCases)(
    "executes the actual probe lifecycle with $name and npm_execpath=$manager",
    ({ name, manager }) => {
      const env = fixture();
      const node = path.join(root, "bin", name);
      fixtureNode(node);
      const shim = path.join(root, "bin", process.platform === "win32" ? "pnpm.cmd" : "pnpm");
      const script = `const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
if (process.cwd() !== args[1]) throw new Error('wrong probe cwd');
fs.writeFileSync('.npmrc', 'manage-package-manager-versions=true\\n');
const result = cp.spawnSync(${JSON.stringify(realPnpm.command)}, [...${JSON.stringify(realPnpm.argsPrefix)}, ...args], { stdio: 'inherit', env: (() => { const childEnv = { ...process.env, npm_config_manage_package_manager_versions: 'true', npm_config_registry: 'http://127.0.0.1:9', npm_config_fetch_retries: '0' }; delete childEnv.COREPACK_ROOT; return childEnv; })() });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
`;
      writeFileSync(`${shim}.cjs`, script);
      if (process.platform === "win32") {
        writeFileSync(shim, '@echo off\r\n"%PAPERCLIP_TEST_NODE%" "%~f0.cjs" %*\r\n');
      } else {
        writeFileSync(shim, '#!/bin/sh\nexec "$PAPERCLIP_TEST_NODE" "$0.cjs" "$@"\n', { mode: 0o755 });
      }
      vi.spyOn(os, "tmpdir").mockReturnValue(root);
      if (manager === "corepack") writeFileSync(path.join(root, "bin/package.json"), '{"name":"corepack"}');
      const invocation = resolveTestPnpmInvocation(path.join(root, "repo"), {
        ...env,
        PATH: `${env.PATH}${path.delimiter}${process.env.PATH}`,
        PAPERCLIP_TEST_NODE: node,
        NODE: node,
        npm_execpath: manager === "corepack" ? shim : manager === "npm" ? path.join(root, "npm-cli.js") : undefined,
      }, node);
      expect(invocation).toEqual({ command: node, argsPrefix: realPnpm.argsPrefix });
      expect(readdirSync(env.COREPACK_HOME)).toEqual([]);
    },
  );

  const entries = process.platform === "win32"
    ? ["pnpm.cjs", "pnpm.mjs", "pnpm.js"]
    : ["pnpm.cjs", "pnpm.mjs", "pnpm.js", "pnpm"];
  it.each(entries)("uses installed %s without PATH or cache", (name) => {
    const env = fixture();
    const entry = path.join(root, "manager", name);
    const node = path.join(root, "bin", process.platform === "win32" ? "node space.exe" : "node space $HOME `echo substituted`");
    fixtureNode(node);
    const script = "console.log(JSON.stringify({args:process.argv.slice(2),home:process.env.HOME,paperclip:process.env.PAPERCLIP_HOME,network:process.env.COREPACK_ENABLE_NETWORK}));\n";
    if (name === "pnpm") {
      writeFileSync(`${entry}.cjs`, script);
      writeFileSync(entry, '#!/bin/sh\nexec "$PAPERCLIP_TEST_NODE" "$0.cjs" "$@"\n', { mode: 0o755 });
    } else {
      writeFileSync(entry, script);
    }
    const invocation = resolveTestPnpmInvocation(path.join(root, "repo"), { ...env, npm_execpath: entry });
    expect(invocation.command).toBe(name === "pnpm" ? entry : process.execPath);
    const argsCases = [["paperclipai", "run"], ["--silent", "paperclipai", "company", "export"], ["space path", "a&b", 'a"b', "a%PATH%b", "a^b", "trailing\\"]];
    for (const args of argsCases) {
      const result = JSON.parse(execFileSync(invocation.command, [...invocation.argsPrefix, ...args], { env: { ...env, PAPERCLIP_TEST_NODE: node }, encoding: "utf8" }));
      expect(result).toEqual({ args, home: env.HOME, paperclip: env.PAPERCLIP_HOME, network: "0" });
    }
    expect(readdirSync(env.COREPACK_HOME)).toEqual([]);
  });

  it("fails clearly without an installed manager instead of enabling network", () => {
    const env = fixture();
    expect(() => resolveTestPnpmInvocation(path.join(root, "repo"), env)).toThrow("make pnpm available offline");
  });
});
