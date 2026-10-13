import fs from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo, Server as NetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { Server as TlsServer } from "node:tls";

type SupertestServer = NetServer & {
  address(): ReturnType<NetServer["address"]>;
  listen(port: number): NetServer;
};

type SupertestTestInstance = {
  _server?: SupertestServer;
};

type SupertestTestConstructor = {
  prototype: {
    serverAddress(this: SupertestTestInstance, app: SupertestServer, path: string): string;
    __paperclipLoopbackPatched?: boolean;
  };
};

// Keep the original home available only for read-only host port-lease checks.
process.env.PAPERCLIP_TEST_HOST_HOME ??= process.env.PAPERCLIP_HOME?.trim() || path.join(os.homedir(), ".paperclip");

// Isolated forks do not isolate inherited filesystem paths. Give every file
// its own canonical, compact root even when several files share a Vitest run.
// Receipt-spool recovery must never scan a developer's instance during tests.
const tempRootParent = process.platform === "win32" ? os.tmpdir() : "/tmp";
const paperclipTestRoot = fs.realpathSync(fs.mkdtempSync(path.join(tempRootParent, "pv-f-")));
const paperclipTestHome = path.join(paperclipTestRoot, "h");
const paperclipTestTmp = path.join(paperclipTestRoot, "t");
fs.mkdirSync(paperclipTestHome);
fs.mkdirSync(paperclipTestTmp);
process.env.PAPERCLIP_HOME = paperclipTestHome;
process.env.PAPERCLIP_CONFIG = path.join(paperclipTestHome, "config.json");
process.env.PAPERCLIP_INSTANCE_ID = `vt-${process.pid}-${path.basename(paperclipTestRoot)}`;
process.env.TMPDIR = paperclipTestTmp;
// Setup-file afterAll hooks run before suites drain asynchronous heartbeats.
// Cleanup only after suite teardown, whether the worker exits normally or Vitest
// terminates its fork with SIGTERM. Keep cleanup scoped to this allocated root.
let paperclipTestRootCleaned = false;
function cleanupPaperclipTestRoot() {
  if (paperclipTestRootCleaned) return;
  paperclipTestRootCleaned = true;
  fs.rmSync(paperclipTestRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
}
process.once("exit", cleanupPaperclipTestRoot);
function cleanupOnSigterm() {
  cleanupPaperclipTestRoot();
  process.off("SIGTERM", cleanupOnSigterm);
  process.kill(process.pid, "SIGTERM");
}
process.once("SIGTERM", cleanupOnSigterm);

const require = createRequire(import.meta.url);
const SupertestTest = require("supertest/lib/test.js") as SupertestTestConstructor;

if (!process.env.CODEX_HOME) {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-vitest-codex-home-"));
  fs.writeFileSync(path.join(codexHome, "auth.json"), '{"OPENAI_API_KEY":"sk-vitest"}\n', { mode: 0o600 });
  process.env.CODEX_HOME = codexHome;
}

// The automatic Tailscale HTTPS default (PAP-17158) probes for a real host
// broker socket, so leaving it enabled would make every test that starts a
// service named `paperclip-dev` behave differently on a broker-capable host
// than on CI. Tests that exercise the default opt in explicitly.
if (!process.env.PAPERCLIP_MANAGED_RUNTIME_HTTPS) {
  process.env.PAPERCLIP_MANAGED_RUNTIME_HTTPS = "off";
}

if (!SupertestTest.prototype.__paperclipLoopbackPatched) {
  SupertestTest.prototype.serverAddress = function serverAddress(app, path) {
    const addr = app.address();

    if (!addr) {
      this._server = app.listen(0) as SupertestServer;
    }

    const listeningAddress = app.address() as AddressInfo | string | null;
    if (!listeningAddress || typeof listeningAddress === "string") {
      throw new Error("Expected Supertest server to listen on a TCP port");
    }

    const host = listeningAddress.address === "::"
      ? "[::1]"
      : listeningAddress.address === "0.0.0.0"
        ? "127.0.0.1"
        : listeningAddress.address;
    const protocol = app instanceof TlsServer ? "https" : "http";
    return `${protocol}://${host}:${listeningAddress.port}${path}`;
  };

  SupertestTest.prototype.__paperclipLoopbackPatched = true;
}
