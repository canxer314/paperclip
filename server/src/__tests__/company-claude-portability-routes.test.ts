import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { Router } from "express";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { agents } from "@paperclipai/db";
import { type AgentDetail, resolveClaudeConfigurationSource } from "@paperclipai/shared";
import { agentRoutes } from "../routes/agents.js";
import { companyRoutes } from "../routes/companies.js";
import { claudeHostAccessRoutes } from "../routes/claude-host-access.js";
import { buildDuplicateAgentPayload } from "../../../ui/src/lib/duplicate-agent-payload.js";
import { describeEmbeddedPostgres, routeApp, seedCompanyWithBoardAccess, useEmbeddedPostgres } from "./helpers/route-test-harness.js";

const include = { company: true, agents: true, projects: false, issues: false, skills: false };

describeEmbeddedPostgres("Claude copying and company package routes", () => {
  const context = useEmbeddedPostgres("company-claude-portability");
  let home: string;
  let network: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;
  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-issue-43-"));
    vi.stubEnv("PAPERCLIP_HOME", home);
    vi.stubEnv("PAPERCLIP_SECRETS_MASTER_KEY_FILE", path.join(home, "master.key"));
    await fs.mkdir(path.join(home, ".claude"));
    await fs.writeFile(path.join(home, ".claude", ".credentials.json"), "fixture-native-credential");
  });
  beforeEach(() => { network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Portability must not call a provider")); });
  afterEach(() => {
    try { expect(network).not.toHaveBeenCalled(); } finally { network.mockRestore(); }
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await fs.rm(home, { recursive: true, force: true });
  });

  async function fixture(configurationSource: "host" | "paperclip" | null = "host") {
    const company = await seedCompanyWithBoardAccess(context.db, "Claude portability");
    const actor = { ...company.actor, source: "local_implicit", isInstanceAdmin: true };
    const app = routeApp(context.db, actor, agentRoutes, db => {
      const router = Router();
      router.use("/companies", companyRoutes(db));
      return router;
    }, claudeHostAccessRoutes);
    const id = randomUUID();
    await context.db.insert(agents).values({ id, companyId: company.companyId, name: "Claude", role: "engineer",
      adapterType: "claude_local", lifecycleState: "ready", adapterConfig: {
        ...(configurationSource === null ? {} : { configurationSource }),
        engine: "cli", model: "custom-model", cwd: home, promptTemplate: "Instructions.",
      } });
    const grant = async (enabled: boolean) => {
      const result = await request(app).put(`/api/instance/claude-host-access/${company.companyId}`).send({ enabled });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
    };
    const exported = async () => {
      const result = await request(app).post(`/api/companies/${company.companyId}/export`).send({ include });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      return result.body;
    };
    return { ...company, app, id, grant, exported };
  }

  async function expectDenied(app: ReturnType<typeof routeApp>, companyId: string, config: Record<string, unknown>) {
    const result = await request(app).post(`/api/companies/${companyId}/adapters/claude_local/test-environment`).send({ adapterConfig: config });
    expect(result.status, JSON.stringify(result.body)).toBe(403);
    expect(result.body.details?.code).toBe("claude_host_access_denied");
  }

  it.each([undefined, false, "true"])("requires a boolean batch confirmation at the HTTP boundary (%s)", async acknowledgement => {
    const f = await fixture();
    const bundle = await f.exported();
    const before = await request(f.app).get("/api/companies");
    const imported = await request(f.app).post("/api/companies/import").send({
      source: { type: "inline", files: bundle.files }, include, target: { mode: "new_company" }, hostConfigurationConfirmed: acknowledgement,
    });
    expect(imported.status).toBe(acknowledgement === "true" ? 400 : 422);
    expect((await request(f.app).get("/api/companies")).body).toHaveLength(before.body.length);
  });

  it("copies within the company and uses its current permission after revocation", async () => {
    const f = await fixture();
    await f.grant(true);
    const original = await request(f.app).get(`/api/agents/${f.id}`);
    expect(original.status).toBe(200);
    const copy = await request(f.app).post(`/api/companies/${f.companyId}/agents`).send(buildDuplicateAgentPayload(original.body as AgentDetail));
    expect(copy.status, JSON.stringify(copy.body)).toBe(201);
    expect(copy.body.adapterConfig).toMatchObject({ configurationSource: "host", model: "custom-model" });
    await f.grant(false);
    await expectDenied(f.app, f.companyId, copy.body.adapterConfig);
    await expectDenied(f.app, f.companyId, original.body.adapterConfig);
  });

  it("exports host source without native credentials and imports into an unlicensed new company", async () => {
    const f = await fixture();
    await f.grant(true);
    const reads = vi.spyOn(fs, "readFile");
    let bundle;
    try {
      bundle = await f.exported();
      expect(reads.mock.calls.some(([file]) => String(file).includes(".credentials.json"))).toBe(false);
    } finally { reads.mockRestore(); }
    expect(bundle.manifest.agents[0].adapterConfig).toMatchObject({ configurationSource: "host", model: "custom-model" });
    expect(JSON.stringify(bundle)).not.toContain("fixture-native-credential");
    expect(JSON.stringify(bundle)).not.toContain("claudeHostAccess");
    const imported = await request(f.app).post("/api/companies/import").send({
      source: { type: "inline", files: bundle.files }, include, target: { mode: "new_company" }, hostConfigurationConfirmed: true,
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    const saved = await request(f.app).get(`/api/agents/${imported.body.agents[0].id}`);
    expect(saved.body.adapterConfig).toMatchObject({ configurationSource: "host", model: "custom-model" });
    expect(saved.body.pauseReason).not.toBe("import");
    const permission = await request(f.app).get(`/api/companies/${imported.body.company.id}/claude-host-access`);
    expect(permission.body).toEqual({ enabled: false });
    await expectDenied(f.app, imported.body.company.id, saved.body.adapterConfig);
  });

  it("can explicitly switch a host package to another adapter without carrying the Claude source", async () => {
    const f = await fixture();
    const bundle = await f.exported();
    const imported = await request(f.app).post("/api/companies/import").send({
      source: { type: "inline", files: bundle.files }, include, target: { mode: "existing_company", companyId: f.companyId },
      adapterOverrides: { claude: { adapterType: "codex_local" } },
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    const saved = await request(f.app).get(`/api/agents/${imported.body.agents[0].id}`);
    expect(saved.body.adapterType).toBe("codex_local");
    expect(saved.body.adapterConfig).not.toHaveProperty("configurationSource");
  });

  it.each([false, true])("keeps existing target permission %s despite source package permission data", async enabled => {
    const f = await fixture();
    await f.grant(!enabled);
    const bundle = await f.exported();
    bundle.files[".paperclip.yaml"] += `\nclaudeHostAccess: ${!enabled}\n`;
    const target = await seedCompanyWithBoardAccess(context.db, "Target");
    await request(f.app).put(`/api/instance/claude-host-access/${target.companyId}`).send({ enabled });
    const imported = await request(f.app).post("/api/companies/import").send({
      source: { type: "inline", files: bundle.files }, include, target: { mode: "existing_company", companyId: target.companyId }, hostConfigurationConfirmed: true,
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    expect((await request(f.app).get(`/api/companies/${target.companyId}/claude-host-access`)).body).toEqual({ enabled });
    const saved = await request(f.app).get(`/api/agents/${imported.body.agents[0].id}`);
    expect(saved.body.adapterConfig.configurationSource).toBe("host");
    if (!enabled) await expectDenied(f.app, target.companyId, saved.body.adapterConfig);
  });

  it.each(["paperclip", null] as const)("round trips legacy source %s without host confirmation", async source => {
    const f = await fixture(source);
    const bundle = await f.exported();
    expect(resolveClaudeConfigurationSource(bundle.manifest.agents[0].adapterConfig)).toBe("paperclip");
    const imported = await request(f.app).post("/api/companies/import").send({
      source: { type: "inline", files: bundle.files }, include, target: { mode: "new_company" },
    });
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    const saved = await request(f.app).get(`/api/agents/${imported.body.agents[0].id}`);
    expect(resolveClaudeConfigurationSource(saved.body.adapterConfig)).toBe("paperclip");
    expect(saved.body.adapterConfig.model).toBe("custom-model");
  });
});
