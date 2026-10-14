import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { agentConfigRevisions, agentRuntimeState, agents, companies, companyMemberships, createDb, environments, heartbeatRuns, principalPermissionGrants, toolConnectionInstalls, toolConnections } from "@paperclipai/db";
import { agentRoutes } from "../routes/agents.js";
import { errorHandler } from "../middleware/index.js";
import { activityRoutes } from "../routes/activity.js";
import { claudeHostAccessRoutes } from "../routes/claude-host-access.js";
import { agentService } from "../services/agents.js";
import { aiConnectionService } from "../services/ai-connections.js";
import { prepareManagedAiRuntime } from "../services/ai-connection-runtime.js";
import { secretService } from "../services/secrets.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
let db: ReturnType<typeof createDb>;
let home: string;
let network: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;

beforeEach(() => {
  network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Rollback must not call a provider"));
});

afterEach(() => {
  try { expect(network).not.toHaveBeenCalled(); } finally { network.mockRestore(); }
});

beforeAll(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), "paperclip-issue-31-"));
  vi.stubEnv("PAPERCLIP_HOME", home);
  vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY_FILE", path.join(home, "master.key"));
  database = await startEmbeddedPostgresTestDatabase("agent-config-rollback");
  db = createDb(database.connectionString);
}, 90_000);

afterAll(async () => {
  await db?.$client.end();
  await database?.cleanup();
  vi.unstubAllEnvs();
  if (home) await rm(home, { recursive: true, force: true });
});

async function fixture() {
  const companyId = randomUUID();
  const agentId = randomUUID();
  const cwd = await mkdtemp(path.join(home, "cwd-"));
  await db.insert(companies).values({ id: companyId, name: "Rollback test", issuePrefix: `R${companyId.slice(0, 7)}` });
  await db.insert(agents).values({ id: agentId, companyId, name: "Claude", role: "engineer",
    adapterType: "claude_local", adapterConfig: { configurationSource: "host", engine: "cli", model: "current-model" },
    lifecycleState: "ready" });
  const svc = agentService(db);
  function appFor(actor: express.Request["actor"]) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.actor = actor; next(); });
    app.use("/api", agentRoutes(db), activityRoutes(db), claudeHostAccessRoutes(db));
    app.use(errorHandler);
    return app;
  }
  const actor = { type: "board" as const, userId: "local-board", companyIds: [companyId], source: "local_implicit" as const, isInstanceAdmin: false };
  const app = appFor(actor);
  async function revision(adapterConfig: Record<string, unknown>) {
    await svc.update(agentId, { adapterConfig }, { recordRevision: { source: "patch" } });
    const [saved] = await svc.listConfigRevisions(agentId);
    await svc.update(agentId, { adapterConfig: { configurationSource: "host", engine: "cli", model: "current-model" } });
    return saved;
  }
  return { companyId, agentId, svc, app, appFor, actor, revision, cwd };
}

describe("whole Agent configuration rollback", () => {
  it.each(["unchanged", "changed", "unauthorized"])("keeps inactive host binding rules on rollback (%s)", async kind => {
    const f = await fixture();
    await db.insert(companyMemberships).values({ companyId: f.companyId, principalType: "user", principalId: "local-board",
      membershipRole: "owner", status: "active" });
    const account = await aiConnectionService(db).save(f.companyId, "local-board", {
      provider: "anthropic", method: "api_key", name: "Inactive account", ownership: "personal",
      agentIds: [f.agentId], allAgents: false, apiKey: "fixture-inactive-key",
    }, "fixture-inactive-key");
    const binding = { ...account, mode: "delegated" as const, provider: "anthropic" as const, method: "api_key" as const };
    await f.svc.update(f.agentId, { runtimeConfig: { aiConnection: binding } });
    const revision = await f.revision({ configurationSource: "host", engine: "cli", model: "historical-model" });
    await db.update(toolConnections).set({ enabled: false, healthStatus: "error" }).where(eq(toolConnections.id, account.connectionId));
    if (kind !== "unchanged") await f.svc.update(f.agentId, { runtimeConfig: {} });
    if (kind === "unauthorized") await db.delete(toolConnectionInstalls).where(eq(toolConnectionInstalls.connectionId, account.connectionId));
    const result = await request(f.app).post(`/api/agents/${f.agentId}/config-revisions/${revision.id}/rollback`);
    expect(result.status, JSON.stringify(result.body)).toBe(kind === "unauthorized" ? 403 : 200);
    const saved = await f.svc.getById(f.agentId);
    expect(saved?.adapterConfig.model).toBe(kind === "unauthorized" ? "current-model" : "historical-model");
    expect(saved?.runtimeConfig.aiConnection).toEqual(kind === "unauthorized" ? undefined : binding);
  });

  it("records an explicit rollback even when the selected configuration is already current", async () => {
    const f = await fixture();
    const revision = await f.revision({ configurationSource: "host", engine: "cli", model: "historical-model" });
    const endpoint = `/api/agents/${f.agentId}/config-revisions/${revision.id}/rollback`;
    expect((await request(f.app).post(endpoint)).status).toBe(200);
    expect((await request(f.app).post(endpoint)).status).toBe(200);
    const history = await f.svc.listConfigRevisions(f.agentId);
    expect(history).toHaveLength(3);
    expect(history[0]).toMatchObject({ source: "rollback", rolledBackFromRevisionId: revision.id, changedKeys: [] });
  });

  it.each(["invalid", null, 1])("rejects an invalid historical configuration source %s", async configurationSource => {
    const f = await fixture();
    const revision = await f.revision({ configurationSource, engine: "cli", model: "historical-model" });
    const result = await request(f.app).post(`/api/agents/${f.agentId}/config-revisions/${revision.id}/rollback`);
    expect(result.status).toBe(400);
    expect((await f.svc.getById(f.agentId))?.adapterConfig.model).toBe("current-model");
    expect(await f.svc.listConfigRevisions(f.agentId)).toHaveLength(1);
  });

  it("keeps a historical source omission as Paperclip and restores its shared model", async () => {
    const f = await fixture();
    const revision = await f.revision({ model: "historical-model", engine: "cli" });
    const result = await request(f.app).post(`/api/agents/${f.agentId}/config-revisions/${revision.id}/rollback`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.adapterConfig).toEqual({ model: "historical-model", engine: "cli" });
    expect((await f.svc.listConfigRevisions(f.agentId))[0].source).toBe("rollback");
  });

  it("keeps current appearance when restoring a legacy snapshot without appearance fields", async () => {
    const f = await fixture();
    const revision = await f.revision({ model: "historical-model" });
    const legacy = { ...revision.afterConfig };
    delete legacy.icon;
    delete legacy.appearance;
    await db.update(agentConfigRevisions).set({ afterConfig: legacy }).where(eq(agentConfigRevisions.id, revision.id));
    const appearance = { schemaVersion: 1 as const, characterVersion: "cap-v1" as const, paletteId: "solar-flare" as const };
    await f.svc.update(f.agentId, { icon: "bot", appearance });
    const restored = await f.svc.rollbackConfigRevision(f.agentId, revision.id, { userId: "local-board" });
    expect(restored).toMatchObject({ icon: "bot", appearance, adapterConfig: { model: "historical-model" } });
  });

  it("does not restore historical readiness or remove current lifecycle holds", async () => {
    const f = await fixture();
    const revision = await f.revision({ configurationSource: "host", engine: "cli", model: "historical-model" });
    await db.update(agents).set({ status: "paused", lifecycleState: "paused", lifecycleHolds: ["budget"],
      lifecycleError: "Current verification failure", pauseReason: "budget" }).where(eq(agents.id, f.agentId));
    const result = await request(f.app).post(`/api/agents/${f.agentId}/config-revisions/${revision.id}/rollback`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({ status: "paused", lifecycleState: "paused", lifecycleHolds: ["budget"],
      lifecycleError: "Current verification failure", pauseReason: "budget", adapterConfig: { model: "historical-model" } });
  });

  it("rejects restoring a Claude source on a different adapter", async () => {
    const f = await fixture();
    const revision = await f.revision({ configurationSource: "host", engine: "cli", model: "historical-model" });
    await db.update(agentConfigRevisions).set({ afterConfig: { ...revision.afterConfig, adapterType: "codex_local" } })
      .where(eq(agentConfigRevisions.id, revision.id));
    const result = await request(f.app).post(`/api/agents/${f.agentId}/config-revisions/${revision.id}/rollback`);
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("Configuration source is only supported by the Claude Code adapter.");
    expect((await f.svc.getById(f.agentId))?.adapterConfig.model).toBe("current-model");
  });


  it("rejects restoring host source to an explicit remote environment", async () => {
    const f = await fixture();
    const [environment] = await db.insert(environments).values({ name: `Remote ${f.agentId}`, driver: "ssh" }).returning();
    await f.svc.update(f.agentId, { defaultEnvironmentId: environment.id,
      adapterConfig: { configurationSource: "host", engine: "cli", model: "historical-model" } }, { recordRevision: { source: "patch" } });
    const [revision] = await f.svc.listConfigRevisions(f.agentId);
    await f.svc.update(f.agentId, { defaultEnvironmentId: null, adapterConfig: { configurationSource: "host", model: "current-model" } });
    const result = await request(f.app).post(`/api/agents/${f.agentId}/config-revisions/${revision.id}/rollback`);
    expect(result.status).toBe(422);
    expect(result.body.error).toContain('Environment driver "ssh" is not allowed');
    expect((await f.svc.getById(f.agentId))?.defaultEnvironmentId).toBeNull();
  });

  it.each(["configuration_permission", "cross_company", "foreign_revision", "approval_freeze", "agent_host_field"])(
    "keeps the existing rollback restriction for %s", async reason => {
      const f = await fixture();
      const revision = await f.revision({ configurationSource: "host", engine: "cli", cwd: f.cwd, model: "historical-model" });
      let app = f.app;
      let revisionId = revision.id;
      let status = 403;
      if (reason === "configuration_permission") {
        await db.insert(companyMemberships).values({ companyId: f.companyId, principalType: "user", principalId: "reader", membershipRole: "member" });
        app = f.appFor({ ...f.actor, userId: "reader", source: "session", memberships: [{ companyId: f.companyId, membershipRole: "member", status: "active" }] });
      }
      if (reason === "cross_company") { app = f.appFor({ ...f.actor, source: "session", companyIds: [] }); status = 404; }
      if (reason === "foreign_revision") { const other = await fixture(); revisionId = (await other.revision({ model: "other-model" })).id; status = 404; }
      if (reason === "approval_freeze") { await db.update(agents).set({ status: "pending_approval" }).where(eq(agents.id, f.agentId)); status = 409; }
      if (reason === "agent_host_field") {
        await db.insert(principalPermissionGrants).values({ companyId: f.companyId, principalType: "agent", principalId: f.agentId, permissionKey: "agents:configure" });
        app = f.appFor({ type: "agent", agentId: f.agentId, companyId: f.companyId, source: "agent_key" });
      }
      const result = await request(app).post(`/api/agents/${f.agentId}/config-revisions/${revisionId}/rollback`);
      expect(result.status, JSON.stringify(result.body)).toBe(status);
      expect((await f.svc.getById(f.agentId))?.adapterConfig.model).toBe("current-model");
      expect(await f.svc.listConfigRevisions(f.agentId)).toHaveLength(1);
    },
  );

  it("does not stop running or queued work or create a fresh session on source rollback", async () => {
    const f = await fixture();
    const revision = await f.revision({ configurationSource: "host", engine: "cli", model: "historical-model" });
    await f.svc.update(f.agentId, { adapterConfig: { model: "current-model" } });
    await db.update(agents).set({ status: "running" }).where(eq(agents.id, f.agentId));
    const runs = await db.insert(heartbeatRuns).values(["running", "queued"].map(status => ({ companyId: f.companyId, agentId: f.agentId, status }))).returning();
    await db.insert(agentRuntimeState).values({ companyId: f.companyId, agentId: f.agentId, adapterType: "claude_local",
      sessionId: "fixture-current-session", stateJson: { sessionId: "fixture-current-session" } });
    const result = await request(f.app).post(`/api/agents/${f.agentId}/config-revisions/${revision.id}/rollback`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.status).toBe("running");
    for (const run of runs) {
      const saved = await request(f.app).get(`/api/heartbeat-runs/${run.id}`);
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body.status).toBe(run.status);
    }
    const runtime = await request(f.app).get(`/api/agents/${f.agentId}/runtime-state`);
    expect(runtime.status).toBe(200);
    expect(runtime.body.sessionId).toBe("fixture-current-session");
  });

  it("keeps latest secret references dynamic across rollback and later rotation", async () => {
    const f = await fixture();
    const secrets = secretService(db);
    const secret = await secrets.create(f.companyId, { name: "Rollback env", provider: "local_encrypted", value: "fixture-old-secret" });
    const revision = await f.revision({ configurationSource: "host", engine: "cli", model: "historical-model",
      env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: secret.id, version: "latest" } } });
    await secrets.rotate(secret.id, { value: "fixture-current-secret" });
    const result = await request(f.app).post(`/api/agents/${f.agentId}/config-revisions/${revision.id}/rollback`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.adapterConfig.env.ANTHROPIC_API_KEY).toMatchObject({ type: "secret_ref", secretId: secret.id, version: "latest" });
    const resolve = () => secrets.resolveAdapterConfigForRuntime(f.companyId, result.body.adapterConfig,
      { consumerType: "agent", consumerId: f.agentId }, { adapterType: "claude_local" });
    expect((await resolve()).config.env).toEqual({ ANTHROPIC_API_KEY: "fixture-current-secret" });
    await secrets.rotate(secret.id, { value: "fixture-next-secret" });
    expect((await resolve()).config.env).toEqual({ ANTHROPIC_API_KEY: "fixture-next-secret" });
    const history = JSON.stringify(await f.svc.listConfigRevisions(f.agentId));
    for (const value of ["fixture-old-secret", "fixture-current-secret", "fixture-next-secret"]) {
      expect(history).not.toContain(value);
      expect(JSON.stringify(result.body)).not.toContain(value);
    }
  });

  it("rejects historical redacted values without restoring configuration or creating a rollback revision", async () => {
    const f = await fixture();
    const revision = await f.revision({ configurationSource: "host", engine: "cli",
      env: { ANTHROPIC_API_KEY: { type: "plain", value: "fixture-private-key" } } });
    expect(JSON.stringify(revision.afterConfig)).toContain("***REDACTED***");
    const result = await request(f.app).post(`/api/agents/${f.agentId}/config-revisions/${revision.id}/rollback`);
    expect(result.status).toBe(422);
    expect(result.body.error).toBe("Cannot roll back a revision that contains redacted secret values");
    expect(JSON.stringify(result.body)).not.toContain("fixture-private-key");
    expect((await f.svc.getById(f.agentId))?.adapterConfig.model).toBe("current-model");
    expect(await f.svc.listConfigRevisions(f.agentId)).toHaveLength(1);
  });

  it("restores host configuration after permission is revoked but leaves current checks denied", async () => {
    const f = await fixture();
    const admin = f.appFor({ ...f.actor, isInstanceAdmin: true });
    const accessPath = `/api/instance/claude-host-access/${f.companyId}`;
    expect((await request(admin).put(accessPath).send({ enabled: true })).status).toBe(200);
    const revision = await f.revision({ configurationSource: "host", engine: "cli", model: "historical-model" });
    await f.svc.update(f.agentId, { adapterConfig: { model: "current-model" } });
    expect((await request(admin).put(accessPath).send({ enabled: false })).status).toBe(200);
    const result = await request(f.app).post(`/api/agents/${f.agentId}/config-revisions/${revision.id}/rollback`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect((await request(f.app).get(`/api/companies/${f.companyId}/claude-host-access`)).body).toEqual({ enabled: false });
    const check = await request(f.app).post(`/api/companies/${f.companyId}/adapters/claude_local/test-environment`)
      .send({ agentId: f.agentId, adapterConfig: result.body.adapterConfig });
    expect(check.status).toBe(403);
    expect(check.body.details?.code).toBe("claude_host_access_denied");
  });

  it("fails closed when rolling back from host to an unavailable managed connection", async () => {
    const f = await fixture();
    await db.insert(companyMemberships).values({ companyId: f.companyId, principalType: "user", principalId: "local-board",
      membershipRole: "owner", status: "active" });
    const account = await aiConnectionService(db).save(f.companyId, "local-board", {
      provider: "anthropic", method: "api_key", name: "Historical account", ownership: "personal",
      agentIds: [f.agentId], allAgents: false, apiKey: "fixture-managed-key",
    }, "fixture-managed-key");
    const binding = { ...account, mode: "delegated" as const, provider: "anthropic" as const, method: "api_key" as const };
    await f.svc.update(f.agentId, { runtimeConfig: { aiConnection: binding } });
    const revision = await f.revision({ model: "claude-sonnet-5" });
    await db.update(toolConnections).set({ enabled: false, healthStatus: "error" }).where(eq(toolConnections.id, account.connectionId));
    const result = await request(f.app).post(`/api/agents/${f.agentId}/config-revisions/${revision.id}/rollback`);
    expect(result.status, JSON.stringify(result.body)).toBe(422);
    expect(result.body.details?.code).toBe("ai_connection_unavailable");
    expect((await f.svc.getById(f.agentId))?.adapterConfig.configurationSource).toBe("host");
    expect(await f.svc.listConfigRevisions(f.agentId)).toHaveLength(1);
    await expect(prepareManagedAiRuntime(db, { companyId: f.companyId, agentId: f.agentId, responsibleUserId: "local-board",
      adapterType: "claude_local", binding, config: { cwd: f.cwd, model: "claude-sonnet-5" } })).rejects.toMatchObject({ details: { code: "ai_connection_unavailable" } });
  });

  it("restores the entire historical configuration and records a rollback without restoring permission or readiness", async () => {
    const f = await fixture();
    const historical = {
      name: "Historical Claude", role: "cto", title: "Historical title", icon: "brain",
      appearance: { schemaVersion: 1 as const, characterVersion: "cap-v1" as const, paletteId: "arctic-blue" as const },
      reportsTo: null, capabilities: "Historical capabilities", adapterType: "claude_local",
      adapterConfig: { configurationSource: "host", engine: "cli", model: "historical-model", cwd: "/missing/historical-cwd" },
      runtimeConfig: { heartbeat: { enabled: false, intervalSec: 600 } },
      defaultEnvironmentId: null, budgetMonthlyCents: 1000, metadata: { purpose: "historical" },
    };
    await f.svc.update(f.agentId, { ...historical, permissions: { canCreateAgents: true } }, { recordRevision: { source: "patch" } });
    const [revision] = await f.svc.listConfigRevisions(f.agentId);
    await f.svc.update(f.agentId, { name: "Current Claude", role: "engineer", title: null, icon: "bot",
      appearance: { schemaVersion: 1, characterVersion: "cap-v1", paletteId: "solar-flare" },
      capabilities: null, adapterConfig: { configurationSource: "paperclip", model: "current-model" },
      runtimeConfig: {}, metadata: null, budgetMonthlyCents: 2000, permissions: { canCreateAgents: false } });
    const result = await request(f.app).post(`/api/agents/${f.agentId}/config-revisions/${revision.id}/rollback`);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body).toMatchObject({ ...historical, lifecycleState: "ready", permissions: { canCreateAgents: false } });
    const revisions = await f.svc.listConfigRevisions(f.agentId);
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toMatchObject({ source: "rollback", rolledBackFromRevisionId: revision.id,
      createdByUserId: "local-board", afterConfig: historical });
    const audit = await request(f.app).get(`/api/companies/${f.companyId}/activity`);
    expect(audit.status).toBe(200);
    expect(audit.body).toEqual(expect.arrayContaining([expect.objectContaining({ action: "agent.config_rolled_back",
      companyId: f.companyId, entityId: f.agentId, actorId: "local-board", details: { revisionId: revision.id } })]));
    const check = await request(f.app).post(`/api/companies/${f.companyId}/adapters/claude_local/test-environment`)
      .send({ agentId: f.agentId, adapterConfig: result.body.adapterConfig });
    expect(check.status).toBe(403);
    expect(check.body.details?.code).toBe("claude_host_access_denied");
  });

  it("rejects a host revision with an unsupported engine before restoring it", async () => {
    const f = await fixture();
    const revision = await f.revision({ configurationSource: "host", engine: "acp", model: "historical-model" });
    const result = await request(f.app).post(`/api/agents/${f.agentId}/config-revisions/${revision.id}/rollback`);
    expect(result.status, JSON.stringify(result.body)).toBe(422);
    expect(result.body.details?.code).toBe("claude_host_target_unsupported");
    expect((await f.svc.getById(f.agentId))?.adapterConfig.model).toBe("current-model");
    expect(await f.svc.listConfigRevisions(f.agentId)).toHaveLength(1);
  });
});
