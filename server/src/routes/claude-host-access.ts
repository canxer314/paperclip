import { Router } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies, companyClaudeHostAccess } from "@paperclipai/db";
import { z } from "zod";
import { setClaudeHostAccessSchema } from "@paperclipai/shared";
import { badRequest, notFound } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { assertAuthenticated, assertInstanceAdmin, assertCompanyAccess, hasCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity, publishActivity, type ActivityPublication } from "../services/activity-log.js";

export function claudeHostAccessRoutes(db: Db) {
  const router = Router();
  router.get("/instance/claude-host-access", async (req, res) => {
    assertAuthenticated(req);
    assertInstanceAdmin(req);
    const rows = await db.select({ id: companies.id, name: companies.name, enabled: companyClaudeHostAccess.enabled })
      .from(companies).leftJoin(companyClaudeHostAccess, eq(companies.id, companyClaudeHostAccess.companyId))
      .orderBy(companies.name, companies.id);
    res.setHeader("Cache-Control", "no-store");
    res.json(rows.map((row) => ({ ...row, enabled: row.enabled ?? false })));
  });
  router.put("/instance/claude-host-access/:companyId", async (req, res, next) => {
    assertAuthenticated(req);
    assertInstanceAdmin(req);
    next();
  }, validate(setClaudeHostAccessSchema), async (req, res) => {
    const companyId = z.string().uuid().safeParse(req.params.companyId);
    if (!companyId.success) throw badRequest("Invalid company ID");
    const publications: ActivityPublication[] = [];
    const result = await db.transaction(async (tx) => {
      // Lock the company, including the missing-permission-row case, to serialize writers
      // and coordinate with company deletion before reading the committed previous state.
      const [company] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId.data)).for("update");
      if (!company) throw notFound("Company not found");
      const [previous] = await tx.select().from(companyClaudeHostAccess).where(eq(companyClaudeHostAccess.companyId, company.id));
      const enabled = req.body.enabled as boolean;
      const before = previous?.enabled ?? false;
      // Existing activity helpers accept Db; transaction exposes the query surface they use.
      const activity = await logActivity(tx as unknown as Db, {
        companyId: company.id, ...getActorInfo(req),
        action: "company.claude_host_access_updated", entityType: "company", entityId: company.id,
        details: { before, after: enabled, changed: before !== enabled },
      }, publications);
      await tx.insert(companyClaudeHostAccess).values({ companyId: company.id, enabled, updatedAt: new Date(), activityId: activity.id })
        .onConflictDoUpdate({ target: companyClaudeHostAccess.companyId, set: { enabled, updatedAt: new Date(), activityId: activity.id } });
      return { enabled };
    });
    publications.forEach(publishActivity);
    res.json(result);
  });
  router.get("/companies/:companyId/claude-host-access", async (req, res) => {
    assertAuthenticated(req);
    const companyId = z.string().uuid().safeParse(req.params.companyId);
    if (!companyId.success || !hasCompanyAccess(req, companyId.data)) throw notFound("Company not found");
    assertCompanyAccess(req, companyId.data);
    const [company] = await db.select({ enabled: companyClaudeHostAccess.enabled }).from(companies)
      .leftJoin(companyClaudeHostAccess, eq(companies.id, companyClaudeHostAccess.companyId)).where(eq(companies.id, companyId.data));
    if (!company) throw notFound("Company not found");
    res.setHeader("Cache-Control", "no-store");
    res.json({ enabled: company.enabled ?? false });
  });
  return router;
}
