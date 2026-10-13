import { pgTable, uuid, boolean, timestamp } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { activityLog } from "./activity_log.js";

export const companyClaudeHostAccess = pgTable("company_claude_host_access", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  activityId: uuid("activity_id").notNull().references(() => activityLog.id),
});
