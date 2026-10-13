import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runner = path.join(repoRoot, "scripts/run-vitest-stable.mjs");

test("serialized CLI runs selected suites exactly once in bounded serial isolated batches, including the final partial batch", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "vitest-runner-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "server/src/__tests__"), { recursive: true });
  mkdirSync(path.join(root, "server/scripts"), { recursive: true });
  mkdirSync(path.join(root, "bin"));
  const files = ["a-routes", "b-routes", "c-routes", "d-routes"].map(name => `server/src/__tests__/${name}.test.ts`);
  for (const file of files) writeFileSync(path.join(root, file), "");
  const capture = path.join(root, "invocations.jsonl");
  const pnpm = path.join(root, "bin/pnpm");
  writeFileSync(pnpm, `#!${process.execPath}\nconst fs = require("node:fs");\nfs.appendFileSync(process.env.RUNNER_CAPTURE, JSON.stringify({ args: process.argv.slice(2), home: process.env.PAPERCLIP_HOME }) + "\\n");\n`);
  chmodSync(pnpm, 0o755);
  const result = spawnSync(process.execPath, [runner, "--mode", "serialized"], {
    cwd: root,
    encoding: "utf8",
    timeout: 10000,
    env: { ...process.env, PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`, RUNNER_CAPTURE: capture },
  });
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(capture, "utf8").trim().split("\n").map(line => JSON.parse(line));
  t.after(() => { for (const call of calls) rmSync(path.dirname(call.home), { recursive: true, force: true }); });
  const selected = calls.map(call => call.args.filter(arg => arg.endsWith(".test.ts")));
  assert.deepEqual(selected, [files.slice(0, 3), files.slice(3)], "bounded batches preserve selection order and exact-once coverage");
  for (const call of calls) {
    assert.deepEqual(call.args.slice(0, 3), ["exec", "vitest", "run"]);
    for (const flag of ["--no-file-parallelism", "--maxWorkers=1", "--pool=forks", "--isolate"]) {
      assert.ok(call.args.includes(flag), `missing ${flag}`);
    }
  }
});

for (const scenario of ["failed batch", "empty shard"]) {
  test(`serialized CLI ${scenario === "failed batch" ? "propagates failure and does not start the next batch" : "does not invoke Vitest for an empty shard"}`, (t) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "vitest-runner-cli-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(path.join(root, "server/src/__tests__"), { recursive: true });
    mkdirSync(path.join(root, "server/scripts"), { recursive: true });
    mkdirSync(path.join(root, "bin"));
    for (const name of ["a", "b", "c", "d"]) writeFileSync(path.join(root, `server/src/__tests__/${name}-routes.test.ts`), "");
    const capture = path.join(root, "invocations.jsonl");
    const pnpm = path.join(root, "bin/pnpm");
    writeFileSync(pnpm, `#!${process.execPath}\nconst fs = require("node:fs");\nfs.appendFileSync(process.env.RUNNER_CAPTURE, JSON.stringify({ args: process.argv.slice(2), home: process.env.PAPERCLIP_HOME }) + "\\n");\nprocess.exit(7);\n`);
    chmodSync(pnpm, 0o755);
    const args = scenario === "empty shard" ? ["--shard-index", "4", "--shard-count", "5"] : [];
    const result = spawnSync(process.execPath, [runner, "--mode", "serialized", ...args], {
      cwd: root, encoding: "utf8", timeout: 10000,
      env: { ...process.env, PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH}`, RUNNER_CAPTURE: capture },
    });
    const calls = existsSync(capture) ? readFileSync(capture, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
    t.after(() => { for (const call of calls) rmSync(path.dirname(call.home), { recursive: true, force: true }); });
    assert.equal(result.status, scenario === "empty shard" ? 0 : 7, result.stderr);
    assert.equal(calls.length, scenario === "empty shard" ? 0 : 1);
  });
}
