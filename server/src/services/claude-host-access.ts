import { eq } from "drizzle-orm";
import { companyClaudeHostAccess, type Db } from "@paperclipai/db";
import { forbidden } from "../errors.js";

/** Read committed permission at each admission boundary; query failures propagate. */
export async function assertClaudeHostAccess(db: Db, companyId: string): Promise<void> {
  const [permission] = await db.select({ enabled: companyClaudeHostAccess.enabled })
    .from(companyClaudeHostAccess).where(eq(companyClaudeHostAccess.companyId, companyId));
  if (permission?.enabled !== true) {
    throw forbidden("Contact your instance administrator to enable Claude server configuration for this company.", {
      code: "claude_host_access_denied",
    });
  }
}
