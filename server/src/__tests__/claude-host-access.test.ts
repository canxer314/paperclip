import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { companyClaudeHostAccess, activityLog, companies } from "@paperclipai/db";
import { activityRoutes } from "../routes/activity.js";
import request from "supertest";
import { expect, it } from "vitest";
import { describeEmbeddedPostgres, useEmbeddedPostgres, routeApp, seedCompanyWithBoardAccess } from "./helpers/route-test-harness.js";
import { deleteCompany } from "../services/company-deletion.js";
import { claudeHostAccessRoutes } from "../routes/claude-host-access.js";

describeEmbeddedPostgres("Claude host access", () => {
  const context = useEmbeddedPostgres("claude-host-access");

  it("upgrades historical companies without granting access or backfilling data", async () => {
    const company = await seedCompanyWithBoardAccess(context.db, "Historical company");
    await context.db.execute(sql`DROP TABLE company_claude_host_access`);
    const migration = await readFile(new URL("../../../packages/db/src/migrations/0333_vengeful_scorpion.sql", import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await context.db.execute(sql.raw(statement));
    }
    expect(await context.db.select().from(companyClaudeHostAccess)).toHaveLength(0);
    const own = routeApp(context.db, company.actor, claudeHostAccessRoutes);
    expect((await request(own).get(`/api/companies/${company.companyId}/claude-host-access`)).body).toEqual({ enabled: false });
    const [column] = await context.db.execute(sql`SELECT column_default FROM information_schema.columns WHERE table_name = 'company_claude_host_access' AND column_name = 'enabled'`);
    expect(column.column_default).toBe("false");
  });
  it("defaults deny, allows an admin without membership, and hides company state", async () => {
    const { db } = context;
    const company = await seedCompanyWithBoardAccess(db, "Host access");
    const actor = { ...company.actor, companyIds: [], memberships: [], isInstanceAdmin: true };
    const app = routeApp(db, actor, claudeHostAccessRoutes);
    const directory = await request(app).get("/api/instance/claude-host-access");
    expect(directory.status).toBe(200);
    expect(directory.headers["cache-control"]).toBe("no-store");
    expect((await request(app).put("/api/instance/claude-host-access/not-a-company-id").send({ enabled: true })).status).toBe(400);
    for (const payload of [{ enabled: "true" }, { enabled: true, extra: "ignored?" }, null]) {
      expect((await request(app).put(`/api/instance/claude-host-access/${company.companyId}`).send(payload)).status).toBe(400);
    }
    expect(directory.body).toContainEqual({ id: company.companyId, name: expect.any(String), enabled: false });
    expect((await request(app).put(`/api/instance/claude-host-access/${company.companyId}`).send({ enabled: true })).status).toBe(200);
    expect((await request(app).get(`/api/companies/${company.companyId}/claude-host-access`)).status).toBe(404);
    const own = routeApp(db, company.actor, claudeHostAccessRoutes);
    expect((await request(own).get(`/api/companies/${company.companyId}/claude-host-access`)).body).toEqual({ enabled: true });
    expect((await request(own).get("/api/instance/claude-host-access")).status).toBe(403);
    expect((await request(own).put(`/api/instance/claude-host-access/${company.companyId}`).send({ enabled: false })).status).toBe(403);
    const local = routeApp(db, { ...actor, source: "local_implicit", isInstanceAdmin: false }, claudeHostAccessRoutes);
    expect((await request(local).put(`/api/instance/claude-host-access/${company.companyId}`).send({ enabled: false })).status).toBe(200);
    expect((await request(app).put(`/api/instance/claude-host-access/${randomUUID()}`).send({ enabled: false })).status).toBe(404);
    expect((await request(app).put(`/api/instance/claude-host-access/${company.companyId}`).send({})).status).toBe(400);
  });
  it("deletes permission before the existing audit cleanup", async () => {
    const company = await seedCompanyWithBoardAccess(context.db, "Delete host access");
    const app = routeApp(context.db, { ...company.actor, isInstanceAdmin: true }, claudeHostAccessRoutes);
    expect((await request(app).put(`/api/instance/claude-host-access/${company.companyId}`).send({ enabled: true })).status).toBe(200);
    await expect(deleteCompany(context.db, company.companyId)).resolves.toMatchObject({ id: company.companyId });
    expect((await request(app).get(`/api/companies/${company.companyId}/claude-host-access`)).status).toBe(404);
  });

  it("rejects unauthenticated and agent mutations and hides cross-company reads", async () => {
    const company = await seedCompanyWithBoardAccess(context.db, "Auth matrix");
    for (const actor of [{ type: "none" }, { type: "agent", companyId: randomUUID(), agentId: randomUUID() }]) {
      const app = routeApp(context.db, actor as never, claudeHostAccessRoutes);
      const status = actor.type === "none" ? 401 : 403;
      expect((await request(app).get("/api/instance/claude-host-access")).status).toBe(status);
      expect((await request(app).put(`/api/instance/claude-host-access/${company.companyId}`).send({ enabled: true })).status).toBe(status);
      expect((await request(app).get(`/api/companies/${company.companyId}/claude-host-access`)).status).toBe(actor.type === "none" ? 401 : 404);
    }
    const agent = routeApp(context.db, { type: "agent", companyId: company.companyId, agentId: randomUUID() } as never, claudeHostAccessRoutes);
    expect((await request(agent).get(`/api/companies/${company.companyId}/claude-host-access`)).body).toEqual({ enabled: false });
  });

  it("audits every idempotent request and serializes concurrent updates", async () => {
    const company = await seedCompanyWithBoardAccess(context.db, "Audit concurrency");
    const app = routeApp(context.db, { ...company.actor, isInstanceAdmin: true, companyIds: [], memberships: [] }, claudeHostAccessRoutes);
    const path = `/api/instance/claude-host-access/${company.companyId}`;
    for (const enabled of [true, true, false, false]) {
      expect((await request(app).put(path).send({ enabled })).body).toEqual({ enabled });
    }
    const activityApp = routeApp(context.db, company.actor, activityRoutes);
    const audit = await request(activityApp).get(`/api/companies/${company.companyId}/activity`);
    expect(audit.status).toBe(200);
    const rows = audit.body.filter((row: any) => row.action === "company.claude_host_access_updated");
    expect(rows).toHaveLength(4);
    expect(rows.every((row: any) => row.actorId === company.userId && row.companyId === company.companyId)).toBe(true);
    expect(rows.map((row: any) => row.details)).toEqual(expect.arrayContaining([
      { before: false, after: true, changed: true }, { before: true, after: true, changed: false },
      { before: true, after: false, changed: true }, { before: false, after: false, changed: false },
    ]));
    const results = await Promise.all([true, false, true, false].map((enabled) => request(app).put(path).send({ enabled })));
    expect(results.every((result) => result.status === 200)).toBe(true);
    const [state] = await context.db.select().from(companyClaudeHostAccess).where(eq(companyClaudeHostAccess.companyId, company.companyId));
    const [lastAudit] = await context.db.select().from(activityLog).where(eq(activityLog.id, state.activityId));
    expect(state.enabled).toBe(lastAudit.details?.after);
    const history = await context.db.select().from(activityLog).where(eq(activityLog.companyId, company.companyId)).orderBy(activityLog.createdAt);
    expect(history).toHaveLength(8);
    // activity.createdAt uses transaction time, not lock-acquisition/commit order.
    // Validate the transition ledger without assuming those timestamps order writers.
    const grants = history.filter((row) => row.details?.before === false && row.details?.after === true).length;
    const revokes = history.filter((row) => row.details?.before === true && row.details?.after === false).length;
    expect(grants - revokes).toBe(state.enabled ? 1 : 0);
    for (const row of history) expect(row.details?.changed).toBe(row.details?.before !== row.details?.after);
    expect(await context.db.select().from(companyClaudeHostAccess).where(eq(companyClaudeHostAccess.companyId, company.companyId))).toHaveLength(1);
  });

  it("holds concurrent writers until the company transaction releases its lock", async () => {
    const company = await seedCompanyWithBoardAccess(context.db, "Ordered writers");
    const app = routeApp(context.db, { ...company.actor, isInstanceAdmin: true }, claudeHostAccessRoutes);
    let release!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const transaction = context.db.transaction(async (tx) => {
      await tx.select().from(companies).where(eq(companies.id, company.companyId)).for("update");
      locked();
      await barrier;
    });
    await acquired;
    let settled = false;
    const update = request(app).put(`/api/instance/claude-host-access/${company.companyId}`).send({ enabled: true })
      .then((result) => { settled = true; return result; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(settled).toBe(false);
    } finally { release(); }
    await transaction;
    expect((await update).status).toBe(200);
    const [state] = await context.db.select().from(companyClaudeHostAccess).where(eq(companyClaudeHostAccess.companyId, company.companyId));
    expect(state.enabled).toBe(true);
  });

  it("returns truthful database errors and rolls audit back with permission", async () => {
    const company = await seedCompanyWithBoardAccess(context.db, "Rollback");
    const app = routeApp(context.db, { ...company.actor, isInstanceAdmin: true }, claudeHostAccessRoutes);
    await context.db.execute(sql`CREATE FUNCTION reject_host_permission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$`);
    await context.db.execute(sql`CREATE TRIGGER reject_host_permission BEFORE INSERT OR UPDATE ON company_claude_host_access FOR EACH ROW EXECUTE FUNCTION reject_host_permission()`);
    try {
      expect((await request(app).put(`/api/instance/claude-host-access/${company.companyId}`).send({ enabled: true })).status).toBe(500);
      expect(await context.db.select().from(activityLog).where(eq(activityLog.companyId, company.companyId))).toHaveLength(0);
      expect((await request(app).get(`/api/companies/${company.companyId}/claude-host-access`)).body).toEqual({ enabled: false });
    } finally {
      await context.db.execute(sql`DROP TRIGGER reject_host_permission ON company_claude_host_access`);
      await context.db.execute(sql`DROP FUNCTION reject_host_permission()`);
    }
    await context.db.execute(sql`ALTER TABLE company_claude_host_access RENAME TO unavailable_host_access`);
    try {
      expect((await request(app).get("/api/instance/claude-host-access")).status).toBe(500);
      expect((await request(app).get(`/api/companies/${company.companyId}/claude-host-access`)).status).toBe(500);
    } finally { await context.db.execute(sql`ALTER TABLE unavailable_host_access RENAME TO company_claude_host_access`); }
  });
});
