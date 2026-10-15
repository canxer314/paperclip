import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { agents, companies, companyMemberships, budgetPolicies, budgetReservations, costEvents, heartbeatRuns, principalPermissionGrants, createDb } from "@paperclipai/db";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";
import { claudeHostAccessRoutes } from "../routes/claude-host-access.js";
import { secretService } from "../services/secrets.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home: string;
let network: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;
beforeEach(() => { network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Model tests must use only the fake CLI")); });
afterEach(() => { try { expect(network).not.toHaveBeenCalled(); } finally { network.mockRestore(); } });
beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "paperclip-model-test-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY_FILE", path.join(home, "master.key"));
  vi.stubEnv("ANTHROPIC_API_KEY", "fixture-native-key");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "fixture-native-token");
  vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "fixture-native-oauth");
  const executable = path.join(home, "claude");
  await writeFile(executable, `#!${process.execPath}\n${await readFile(new URL("../../../packages/adapters/claude-local/src/server/__fixtures__/model-test-cli.cjs", import.meta.url), "utf8")}`);
  await chmod(executable, 0o755);
  vi.stubEnv("PATH", `${home}${path.delimiter}${process.env.PATH}`);
  database = await startEmbeddedPostgresTestDatabase("agent-saved-model-test-");
  db = createDb(database.connectionString);
}, 90_000);
afterAll(async () => {
  await db?.$client.end(); await database?.cleanup(); vi.unstubAllEnvs();
  if (home) await rm(home, { recursive: true, force: true });
});

async function fixture() {
  const companyId = randomUUID(), agentId = randomUUID();
  const cwd = await mkdtemp(path.join(home, "cwd-"));
  await writeFile(path.join(cwd, "model-test-fixture.json"), "{}");
  await db.insert(companies).values({ id: companyId, name: "Model test", issuePrefix: `M${companyId.slice(0, 7)}` });
  await db.insert(agents).values({ id: agentId, companyId, name: "Claude", role: "engineer", adapterType: "claude_local",
    adapterConfig: { configurationSource: "host", engine: "cli", cwd, model: "saved-model" }, lifecycleState: "ready" });
  const actor = { type: "board" as const, userId: "local-board", companyIds: [companyId], source: "local_implicit" as const, isInstanceAdmin: false };
  function appFor(override: Partial<express.Request["actor"]> = {}) {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.actor = { ...actor, ...override }; next(); });
    app.use("/api", agentRoutes(db), claudeHostAccessRoutes(db)); app.use(errorHandler); return app;
  }
  const endpoint = `/api/companies/${companyId}/adapters/claude_local/test-environment`;
  expect((await request(appFor()).put(`/api/instance/claude-host-access/${companyId}`).send({ enabled: true })).status).toBe(200);
  return { companyId, agentId, cwd, app: appFor(), appFor, endpoint,
    test: (extra = {}) => request(appFor()).post(endpoint).send({ purpose: "model-test", agentId, ...extra }) };
}

describe("saved Agent isolated model-test HTTP contract", () => {
  it("tests the server's saved configuration", async () => {
    const f = await fixture();
    const response = await f.test();
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ purpose: "model-test", outcome: "passed", modelResponse: "passed", cwd: f.cwd, selectedModel: "saved-model" });
    const calls = (await readFile(path.join(f.cwd, "model-test-calls.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(expect.arrayContaining(["--model", "saved-model", "--no-session-persistence", "mcp__*"]));
  });

  it.each(["manual", "budget"])("keeps a %s Agent pause and applies its distinct test admission", async pauseReason => {
    const f = await fixture();
    await db.update(agents).set({ status: "paused", lifecycleState: "paused", pauseReason, lifecycleHolds: [pauseReason] }).where(eq(agents.id, f.agentId));
    // Even an inactive or newly raised policy must not silently resume a budget pause.
    await db.insert(budgetPolicies).values({ companyId: f.companyId, scopeType: "agent", scopeId: f.agentId,
      windowKind: "calendar_month_utc", amount: 100, isActive: false });
    const response = await f.test();
    expect(response.status, JSON.stringify(response.body)).toBe(pauseReason === "manual" ? 200 : 409);
    expect((await request(f.app).get(`/api/agents/${f.agentId}`)).body).toMatchObject({ status: "paused", lifecycleState: "paused", pauseReason, lifecycleHolds: [pauseReason] });
    if (pauseReason === "budget") await expect(readFile(path.join(f.cwd, "model-test-calls.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["company", "agent"])("blocks an exhausted %s reservation without reserving the test", async scopeType => {
    const f = await fixture();
    await db.insert(budgetPolicies).values({ companyId: f.companyId, scopeType, scopeId: scopeType === "company" ? f.companyId : f.agentId, windowKind: "lifetime", amount: 100 });
    const [run] = await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.agentId, status: "running" }).returning();
    await db.insert(budgetReservations).values({ companyId: f.companyId, runId: run.id, agentId: f.agentId, amountCents: "100" });
    const response = await f.test();
    expect(response.status).toBe(409);
    await expect(readFile(path.join(f.cwd, "model-test-calls.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["spent", "unpriced", "pending"])("blocks applicable %s accounting without changing Agent state", async kind => {
    const f = await fixture();
    await db.insert(budgetPolicies).values({ companyId: f.companyId, scopeType: "agent", scopeId: f.agentId, windowKind: "lifetime", amount: 100 });
    if (kind === "pending") await db.insert(heartbeatRuns).values({ companyId: f.companyId, agentId: f.agentId, status: "failed", costAccountingPending: true });
    else await db.insert(costEvents).values({ companyId: f.companyId, agentId: f.agentId, provider: "anthropic", model: "historical", billingType: "metered_api", inputTokens: 1, outputTokens: 1, costCents: kind === "spent" ? 100 : 0, costStatus: kind === "unpriced" ? "unpriced" : "reported", occurredAt: new Date() });
    expect((await f.test()).status).toBe(409);
    expect((await request(f.app).get(`/api/agents/${f.agentId}`)).body).toMatchObject({ lifecycleState: "ready", status: "idle" });
    await expect(readFile(path.join(f.cwd, "model-test-calls.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["pending_approval", "terminated"])("does not test a %s Agent", async status => {
    const f = await fixture();
    await db.update(agents).set({ status, lifecycleState: status as "pending_approval" | "terminated" }).where(eq(agents.id, f.agentId));
    expect((await f.test()).status).toBe(409);
    await expect(readFile(path.join(f.cwd, "model-test-calls.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([{ adapterConfig: { model: "draft" } }, { testCredentials: { ANTHROPIC_API_KEY: "fixture-key" } },
    { environmentId: randomUUID() }, { aiConnection: { mode: "responsible_user", provider: "anthropic", method: "api_key" } }])("rejects execution replacements (%j)", async replacement => {
    const f = await fixture(); expect((await f.test(replacement)).status).toBe(422);
    await expect(readFile(path.join(f.cwd, "model-test-calls.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires the saved Agent identity and verifies its company", async () => {
    const f = await fixture(), foreign = await fixture();
    expect((await request(f.app).post(f.endpoint).send({ purpose: "model-test" })).status).toBe(422);
    expect((await f.test({ agentId: foreign.agentId })).status).toBe(404);
    await expect(readFile(path.join(f.cwd, "model-test-calls.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not give an instance administrator business access to another company", async () => {
    const f = await fixture();
    const response = await request(f.appFor({ source: "session", isInstanceAdmin: true, companyIds: [] })).post(f.endpoint).send({ purpose: "model-test", agentId: f.agentId });
    expect(response.status).toBe(403);
    await expect(readFile(path.join(f.cwd, "model-test-calls.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("allows an Agent key with configuration permission without requiring create permission", async () => {
    const f = await fixture();
    const callerId = randomUUID();
    await db.insert(agents).values({ id: callerId, companyId: f.companyId, name: "Caller", role: "engineer" });
    await db.insert(companyMemberships).values({ companyId: f.companyId, principalType: "agent", principalId: callerId, membershipRole: "member", status: "active" });
    const caller = f.appFor({ type: "agent", source: "agent_key", agentId: callerId, companyId: f.companyId, userId: undefined });
    expect((await request(caller).post(f.endpoint).send({ purpose: "model-test", agentId: f.agentId })).status).toBe(403);
    await db.insert(principalPermissionGrants).values({ companyId: f.companyId, principalType: "agent", principalId: callerId, permissionKey: "agents:configure", scope: null });
    const response = await request(caller).post(f.endpoint).send({ purpose: "model-test", agentId: f.agentId });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.outcome).toBe("passed");
  });

  it("ignores inactive router authentication and preserves the saved model and env override", async () => {
    const f = await fixture();
    await db.update(agents).set({ runtimeConfig: { aiConnection: { mode: "router", provider: "anthropic", method: "api_key", connectionId: randomUUID() } },
      adapterConfig: { configurationSource: "host", engine: "cli", cwd: f.cwd, model: "saved-private-model",
        env: { ANTHROPIC_API_KEY: { type: "plain", value: "fixture-active-key" } } } }).where(eq(agents.id, f.agentId));
    const response = await f.test();
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.outcome).toBe("passed");
    const call = JSON.parse((await readFile(path.join(f.cwd, "model-test-calls.jsonl"), "utf8")).trim());
    expect(call.apiKey).toBe("fixture-active-key");
    expect(call.args).toEqual(expect.arrayContaining(["--model", "saved-private-model"]));
    expect(JSON.stringify(response.body)).not.toContain("fixture-active-key");
  });

  it("fails closed on an unavailable active env secret rather than using native authentication", async () => {
    const f = await fixture();
    await db.update(agents).set({ adapterConfig: { configurationSource: "host", cwd: f.cwd,
      env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: randomUUID(), version: "latest" } } } }).where(eq(agents.id, f.agentId));
    expect((await f.test()).status).toBe(404);
    await expect(readFile(path.join(f.cwd, "model-test-calls.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("checks current company host permission and treats a query error separately", async () => {
    const f = await fixture();
    expect((await request(f.app).put(`/api/instance/claude-host-access/${f.companyId}`).send({ enabled: false })).status).toBe(200);
    const denied = await f.test();
    expect(denied.status).toBe(403);
    expect(denied.body.code ?? denied.body.details?.code).toBe("claude_host_access_denied");
    await db.execute(sql`ALTER TABLE company_claude_host_access RENAME TO unavailable_host_permission`);
    try {
      const failed = await f.test();
      expect(failed.status).toBe(500);
      expect(failed.body.code ?? failed.body.details?.code).not.toBe("claude_host_access_denied");
    } finally { await db.execute(sql`ALTER TABLE unavailable_host_permission RENAME TO company_claude_host_access`); }
    await expect(readFile(path.join(f.cwd, "model-test-calls.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("creates no formal run, reservation, cost event or configuration history", async () => {
    const f = await fixture();
    const before = (await request(f.app).get(`/api/agents/${f.agentId}`)).body;
    expect((await f.test()).body.outcome).toBe("passed");
    expect((await request(f.app).get(`/api/agents/${f.agentId}`)).body).toEqual(before);
    expect((await request(f.app).get(`/api/agents/${f.agentId}/config-revisions`)).body).toEqual([]);
    // The ledger tables are the externally persisted accounting boundary.
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.companyId, f.companyId))).toEqual([]);
    expect(await db.select().from(costEvents).where(eq(costEvents.companyId, f.companyId))).toEqual([]);
    expect(await db.select().from(budgetReservations).where(eq(budgetReservations.companyId, f.companyId))).toEqual([]);
  });

  it("resolves the saved declared user env override for the caller", async () => {
    const f = await fixture();
    const secrets = secretService(db);
    const definition = await secrets.createUserSecretDefinition(f.companyId, { key: "fixture_anthropic", name: "Fixture key", provider: "local_encrypted" });
    await secrets.createCurrentUserSecretValue(f.companyId, "local-board", { definitionId: definition.id, value: "fixture-user-key" });
    const env = { ANTHROPIC_API_KEY: { type: "user_secret_ref", key: "fixture_anthropic", version: "latest", required: true } };
    await db.update(agents).set({ adapterConfig: { configurationSource: "host", cwd: f.cwd, env } }).where(eq(agents.id, f.agentId));
    await secrets.syncEnvBindingsForTarget(f.companyId, { targetType: "agent", targetId: f.agentId }, env);
    const response = await f.test();
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.outcome).toBe("passed");
    expect(JSON.parse((await readFile(path.join(f.cwd, "model-test-calls.jsonl"), "utf8")).trim()).apiKey).toBe("fixture-user-key");
    expect(JSON.stringify(response.body)).not.toContain("fixture-user-key");
  });

  it.each(["manual", "budget"])("applies a %s company pause without changing it", async pauseReason => {
    const f = await fixture();
    await db.update(companies).set({ status: "paused", pausedAt: new Date(), pauseReason }).where(eq(companies.id, f.companyId));
    expect((await f.test()).status).toBe(pauseReason === "manual" ? 200 : 409);
    expect((await db.select().from(companies).where(eq(companies.id, f.companyId)))[0]).toMatchObject({ status: "paused", pauseReason });
  });
});
