import type { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Reuse cross-env's declared cross-spawn dependency for .cmd launching and
// Windows argument escaping; do not build shell command strings ourselves.
const crossSpawn = createRequire(import.meta.resolve("cross-env"))("cross-spawn") as {
  sync: typeof spawnSync;
};

// Resolve before replacing HOME. A Corepack shim is not the installed manager.
function installedPnpm(entry: string | undefined, node: string) {
  if (!entry || !path.isAbsolute(entry) || !existsSync(entry)) return null;
  const resolved = realpathSync(entry);
  if (!/^pnpm(?:\.(?:cjs|mjs|js|exe))?$/i.test(path.basename(resolved))) return null;
  for (let dir = path.dirname(resolved); ; dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (existsSync(manifest)) {
      if (JSON.parse(readFileSync(manifest, "utf8")).name === "corepack") return null;
      break;
    }
    if (path.dirname(dir) === dir) break;
  }
  return /\.(?:cjs|mjs|js)$/i.test(resolved)
    ? { command: node, argsPrefix: [resolved] }
    : { command: resolved, argsPrefix: [] as string[] };
}

export function resolveTestPnpmInvocation(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  node = process.execPath,
) {
  const installed = installedPnpm(env.npm_execpath, node);
  if (installed) return installed;

  // `pnpm exec vitest` does not set npm_execpath. Ask an offline lifecycle
  // script for it using the original environment, not the isolated test HOME.
  const probe = mkdtempSync(path.join(os.tmpdir(), "paperclip-test-pnpm-"));
  try {
    const { packageManager } = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    writeFileSync(path.join(probe, "package.json"), JSON.stringify({
      packageManager,
      // pnpm supplies npm_node_execpath to lifecycle scripts. Expand the
      // variable once rather than interpolating a path into shell source.
      scripts: { probe: process.platform === "win32"
        ? '"%npm_node_execpath%" -p "process.env.npm_execpath"'
        : '"$npm_node_execpath" -p "process.env.npm_execpath"' },
    }));
    // CLI config has higher precedence than project/user .npmrc or env.
    // Corepack's network switch alone does not stop standalone pnpm switching.
    const result = crossSpawn.sync("pnpm", ["--dir", probe, "--config.manage-package-manager-versions=false", "--config.package-manager-strict=false", "--silent", "run", "probe"], {
      cwd: probe,
      env: { ...env, COREPACK_ENABLE_NETWORK: "0" },
      encoding: "utf8",
      timeout: 30_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Offline pnpm probe failed (${result.status ?? result.signal}): ${result.stderr}\n${result.stdout}`);
    }
    const entry = result.stdout.trim();
    const invocation = installedPnpm(entry, node);
    if (!invocation) throw new Error("Offline pnpm probe did not return an installed pnpm entry.");
    return invocation;
  } catch (cause) {
    throw new Error("Run tests through `pnpm run` with an installed pnpm, or make pnpm available offline in the original HOME.", { cause });
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}
