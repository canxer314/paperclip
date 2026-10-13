import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("a SIGTERM-terminated worker cleans only its root and keeps a failing exit status", (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pv-sigterm-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const capture = path.join(root, "capture.json");
  const config = path.join(root, "vitest.config.mjs");
  writeFileSync(config, `export default { test: { include: ["*.test.ts"], setupFiles: [${JSON.stringify(path.join(repoRoot, "server/src/__tests__/setup-supertest.ts"))}], pool: "forks", isolate: true, maxWorkers: 1, fileParallelism: false } };`);
  writeFileSync(path.join(root, "termination.test.ts"), `import { test } from ${JSON.stringify(path.join(repoRoot, "node_modules/vitest/dist/index.js"))};
import fs from "node:fs";
test("terminate after recording the owned root", () => {
 fs.writeFileSync(${JSON.stringify(capture)}, process.env.PAPERCLIP_HOME);
 process.kill(process.pid, "SIGTERM");
});`);
  const result = spawnSync(process.execPath, [path.join(repoRoot, "node_modules/vitest/vitest.mjs"), "run", "--config", config, "--pool=forks", "--isolate"], {
    cwd: root, encoding: "utf8", timeout: 20000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.ok(Number.isInteger(result.status) && result.status !== 0, `${result.stdout}\n${result.stderr}`);
  const home = readFileSync(capture, "utf8");
  assert.equal(existsSync(path.dirname(home)), false, "SIGTERM removes the worker's allocated root");
});

test("isolated server forks cannot see another file's config or temporary files and have distinct instance IDs", (t) => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pv-cli-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const capture = path.join(root, "capture.jsonl");
  const host = path.join(root, "host");
  mkdirSync(host);
  writeFileSync(path.join(host, "keep"), "host state");
  mkdirSync(path.join(root, "tmp"));
  const config = path.join(root, "vitest.config.mjs");
  writeFileSync(config, `export default { test: { include: ["*.test.ts"], setupFiles: [${JSON.stringify(path.join(repoRoot, "server/src/__tests__/setup-supertest.ts"))}], pool: "forks", isolate: true, maxWorkers: 1, fileParallelism: false } };`);
  const source = `import { afterAll, test, expect } from ${JSON.stringify(path.join(repoRoot, "node_modules/vitest/dist/index.js"))};
import fs from "node:fs";
import path from "node:path";
afterAll(async () => {
 await fs.promises.writeFile(path.join(process.env.TMPDIR, "after-all"), "suite teardown complete");
 fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({ type: "teardown", home: process.env.PAPERCLIP_HOME, marker: fs.readFileSync(path.join(process.env.TMPDIR, "after-all"), "utf8") }) + "\\n");
});
test("per-file disk and environment isolation", () => {
 const config = process.env.PAPERCLIP_CONFIG;
 const tmp = path.join(process.env.TMPDIR, "same-name");
 expect(fs.existsSync(config)).toBe(false);
 expect(fs.existsSync(tmp)).toBe(false);
 expect(process.env.PAPERCLIP_TEST_HOST_HOME).toBe(${JSON.stringify(host)});
 expect(process.env.DATABASE_URL).toBe("postgres://test.invalid/explicit-test-db");
 fs.writeFileSync(config, "fixture config");
 fs.writeFileSync(tmp, "fixture temp");
 fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({ type: "test", home: process.env.PAPERCLIP_HOME, config, tmp: process.env.TMPDIR, instance: process.env.PAPERCLIP_INSTANCE_ID }) + "\\n");
});`;
  for (const name of ["a", "b"]) writeFileSync(path.join(root, `${name}.test.ts`), source);
  const result = spawnSync(process.execPath, [path.join(repoRoot, "node_modules/vitest/vitest.mjs"), "run", "--config", config, "--no-file-parallelism", "--maxWorkers=1", "--pool=forks", "--isolate"], {
    cwd: root, encoding: "utf8", timeout: 20000,
    env: { ...process.env, PAPERCLIP_HOME: host, PAPERCLIP_TEST_HOST_HOME: host, PAPERCLIP_CONFIG: path.join(root, "shared-config.json"), PAPERCLIP_INSTANCE_ID: "shared-instance", TMPDIR: path.join(root, "tmp"), DATABASE_URL: "postgres://test.invalid/explicit-test-db" },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const records = readFileSync(capture, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const files = records.filter(record => record.type === "test");
  const teardowns = records.filter(record => record.type === "teardown");
  assert.equal(files.length, 2);
  assert.equal(teardowns.length, 2);
  assert.deepEqual(new Set(teardowns.map(record => record.home)), new Set(files.map(file => file.home)), "async afterAll completed for every file");
  assert.ok(teardowns.every(record => record.marker === "suite teardown complete"));
  for (const key of ["home", "config", "tmp", "instance"]) assert.equal(new Set(files.map(file => file[key])).size, 2, `${key} must be independent per file`);
  for (const file of files) {
    assert.equal(path.dirname(file.config), file.home);
    assert.equal(existsSync(path.dirname(file.home)), false, "allocated root is cleaned after worker exit");
    if (process.platform !== "win32") assert.equal(file.home.length < 80, true, "fixture roots must stay compact for Unix sockets");
  }
  assert.equal(readFileSync(path.join(host, "keep"), "utf8"), "host state");
});
