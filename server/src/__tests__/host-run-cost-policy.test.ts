import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, agentRuntimeState, budgetReservations, companies, costEvents, createDb, heartbeatRuns } from "@paperclipai/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { accountRunCost } from "../services/run-cost-accounting.js";
import { accountingIntegrityService } from "../services/accounting-integrity.js";
import { heartbeatService } from "../services/heartbeat.js";
import { createRunUsageRecorder } from "../services/usage-receipts.js";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../adapters/index.js", async importOriginal => ({
  ...await importOriginal<typeof import("../adapters/index.js")>(),
  getServerAdapter: () => ({ supportsLocalAgentJwt: false, execute }),
}));

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;
if (!support.supported) console.warn(`Host run cost tests unavailable: ${support.reason}`);

describeDatabase("host run cost policy", () => {
  let db: ReturnType<typeof createDb>;
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let heartbeat: ReturnType<typeof heartbeatService>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("host-run-cost-policy-");
    db = createDb(database.connectionString);
    heartbeat = heartbeatService(db);
  }, 20_000);
  afterEach(async () => {
    await heartbeat.drainActiveRunExecutions();
    execute.mockReset();
    await db.execute(sql`drop trigger if exists require_host_policy on budget_reservations`);
    await db.execute(sql`drop function if exists require_host_policy()`);
    await db.execute(sql`truncate table ${companies} cascade`);
  });
  afterAll(async () => { await database?.cleanup(); });

  async function fixture(usageJson: Record<string, unknown>) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const runId = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "Cost policy fixture", issuePrefix: `T${companyId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, companyId, name: "Claude", role: "engineer", status: "idle",
      adapterType: "claude_local", adapterConfig: { configurationSource: "paperclip" } });
    await db.insert(heartbeatRuns).values({ id: runId, companyId, agentId, invocationSource: "on_demand",
      status: "succeeded", finishedAt: new Date(), costAccountingPending: true, usageJson });
    return { companyId, agentId, runId };
  }

  it("settles a persisted host policy at zero with model tokens and CLI reference intact", async () => {
    const usage = {
      costPolicy: "host_external_untracked_v1", accountingReceiptReady: true,
      provider: "anthropic", model: "claude-sonnet-4", billingType: "metered_api", costUsd: 1.25,
      inputTokens: 100, cachedInputTokens: 200, outputTokens: 30,
      usageByModel: [
        { model: "claude-sonnet-4", costUsd: 1, usage: { inputTokens: 80, cachedInputTokens: 150, outputTokens: 20 } },
        { model: "claude-haiku-4", costUsd: 0.25, usage: { inputTokens: 20, cachedInputTokens: 50, outputTokens: 10 } },
      ],
    };
    const { companyId, agentId, runId } = await fixture(usage);
    expect(await accountRunCost(db, runId)).toBe(true);
    const events = await db.select().from(costEvents).where(eq(costEvents.heartbeatRunId, runId));
    expect(events).toHaveLength(2);
    expect(events.map(event => Number(event.costCents))).toEqual([0, 0]);
    expect(events.map(event => [event.model, event.inputTokens, event.cachedInputTokens, event.outputTokens]).sort()).toEqual([
      ["claude-haiku-4", 20, 50, 10], ["claude-sonnet-4", 80, 150, 20],
    ]);
    for (const event of events) {
      expect(event.billingType).toBe("unknown");
      expect(event.costStatus).toBe("reported");
      expect(event.pricingProvenance).toMatchObject({ source: "operator", version: "host_external_untracked_v1" });
    }
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(run.usageJson).toEqual(usage);
    expect(run.costAccountingPending).toBe(false);
    const [runtime] = await db.select().from(agentRuntimeState).where(eq(agentRuntimeState.agentId, agentId));
    expect(Number(runtime.totalCostCents)).toBe(0);
    expect(runtime).toMatchObject({ totalInputTokens: 100, totalCachedInputTokens: 200, totalOutputTokens: 30 });
    expect((await accountingIntegrityService(db).inspect(companyId)).findings).toEqual([]);
    expect(await accountRunCost(db, runId)).toBe(false);
    expect(await db.select().from(costEvents).where(eq(costEvents.heartbeatRunId, runId))).toHaveLength(2);
  });

  it("persists the host policy before dispatch and keeps it through receipt and result finalization", async () => {
    const { companyId, agentId, runId: historicalRunId } = await fixture({});
    await db.delete(heartbeatRuns).where(eq(heartbeatRuns.id, historicalRunId));
    await db.update(agents).set({ adapterConfig: { configurationSource: "host" },
      runtimeConfig: { heartbeat: { wakeOnDemand: true } } }).where(eq(agents.id, agentId));
    // The database boundary rejects reservation before the policy is durable.
    await db.execute(sql`create function require_host_policy() returns trigger language plpgsql as $$
      begin
        if (select usage_json->>'costPolicy' from heartbeat_runs where id = new.run_id)
          is distinct from 'host_external_untracked_v1' then
          raise exception 'Host policy must precede reservation';
        end if;
        return new;
      end $$`);
    await db.execute(sql`create trigger require_host_policy before insert on budget_reservations
      for each row execute function require_host_policy()`);
    execute.mockImplementation(async ({ runId }) => {
      const run = await heartbeat.getRun(runId);
      const reservations = await db.select().from(budgetReservations).where(eq(budgetReservations.runId, runId));
      expect(run?.usageJson?.costPolicy).toBe("host_external_untracked_v1");
      expect(reservations).toHaveLength(1);
      return { exitCode: 0, signal: null, timedOut: false, summary: "Fixture run", provider: "anthropic", model: "claude-sonnet-4",
        costUsd: 1.25, usage: { inputTokens: 100, cachedInputTokens: 200, outputTokens: 30 }, usageBasis: "per_run",
        resultJson: { total_cost_usd: 1.25, costPolicy: "paperclip" } };
    });
    const invoked = await heartbeat.invoke(agentId, "on_demand", {}, "manual", { actorType: "user", actorId: "board-user" });
    await heartbeat.drainActiveRunExecutions();
    expect(execute).toHaveBeenCalledOnce();
    const run = await heartbeat.getRun(invoked!.id);
    expect(run).toMatchObject({ status: "succeeded", usageJson: { costPolicy: "host_external_untracked_v1", costUsd: 1.25,
      inputTokens: 100, cachedInputTokens: 200, outputTokens: 30 }, resultJson: { total_cost_usd: 1.25 } });
    const events = await db.select().from(costEvents).where(eq(costEvents.heartbeatRunId, invoked!.id));
    expect(events).toHaveLength(1);
    expect(Number(events[0].costCents)).toBe(0);
    expect(Number((await heartbeat.list(companyId, agentId, 5, { summary: true }))[0].costUsd)).toBe(0);
  });

  it.each(["paperclip", "host"])("keeps unmarked historical charges when the current source is %s", async configurationSource => {
    const { companyId, agentId, runId } = await fixture({ provider: "anthropic", model: "claude-sonnet-4",
      billingType: "metered_api", costUsd: 1.25, inputTokens: 100, cachedInputTokens: 200, outputTokens: 30 });
    await db.update(agents).set({ adapterConfig: { configurationSource } }).where(eq(agents.id, agentId));
    expect(await accountRunCost(createDb(database.connectionString), runId)).toBe(true);
    const [event] = await db.select().from(costEvents).where(eq(costEvents.heartbeatRunId, runId));
    expect(Number(event.costCents)).toBe(125);
    expect(event.billingType).toBe("metered_api");
    expect((await accountingIntegrityService(db).inspect(companyId)).findings).toEqual([]);
    expect((await heartbeat.getRun(runId))?.usageJson).not.toHaveProperty("costPolicy");
  });

  it("retains the host policy through receipt capture and restart after source changes", async () => {
    const { companyId, agentId, runId } = await fixture({ costPolicy: "host_external_untracked_v1" });
    const recorder = await createRunUsageRecorder(db, { companyId, runId, adapterType: "claude_local" });
    await recorder.capture({ complete: true, provider: "anthropic", model: "claude-sonnet-4", billingType: "subscription",
      costUsd: 2.5, usage: { inputTokens: 100, cachedInputTokens: 200, outputTokens: 30 }, usageBasis: "per_run" });
    for (const configurationSource of ["host", "paperclip", "host", "paperclip"]) {
      await db.update(agents).set({ adapterConfig: { configurationSource } }).where(eq(agents.id, agentId));
      expect((await heartbeat.getRun(runId))?.usageJson?.costPolicy).toBe("host_external_untracked_v1");
    }
    expect(await accountRunCost(createDb(database.connectionString), runId)).toBe(true);
    const [event] = await db.select().from(costEvents).where(eq(costEvents.heartbeatRunId, runId));
    expect(Number(event.costCents)).toBe(0);
    expect(event.billingType).toBe("unknown");
    expect(event).toMatchObject({ inputTokens: 100, cachedInputTokens: 200, outputTokens: 30 });
    expect((await heartbeat.getRun(runId))?.usageJson).toMatchObject({ costPolicy: "host_external_untracked_v1", costUsd: 2.5 });
    expect(await accountRunCost(db, runId)).toBe(false);
  });

  it.each(["unpriced", "estimated"])("zero policy does not depend on the CLI's %s amount", async costStatus => {
    const { runId } = await fixture({ costPolicy: "host_external_untracked_v1", provider: "anthropic", model: "claude-sonnet-4",
      costStatus, inputTokens: 10, cachedInputTokens: 20, outputTokens: 3,
      usageByModel: [{ model: "claude-sonnet-4", costUsd: 9, usage: { inputTokens: 10, cachedInputTokens: 20, outputTokens: 3 } }] });
    expect(await accountRunCost(db, runId)).toBe(true);
    const [event] = await db.select().from(costEvents).where(eq(costEvents.heartbeatRunId, runId));
    expect(Number(event.costCents)).toBe(0);
    expect(event).toMatchObject({ model: "claude-sonnet-4", costStatus: "reported", inputTokens: 10, cachedInputTokens: 20, outputTokens: 3 });
  });

  it.each([{ accountingReceiptReady: false }, { accountingCaptureFailed: true }])(
    "leaves incomplete host accounting pending: %j", async incomplete => {
      const { runId } = await fixture({ costPolicy: "host_external_untracked_v1", costUsd: 5, ...incomplete });
      expect(await accountRunCost(db, runId)).toBe(false);
      expect(await db.select().from(costEvents).where(eq(costEvents.heartbeatRunId, runId))).toHaveLength(0);
      expect(await heartbeat.getRun(runId)).toMatchObject({ costAccountingPending: true, costAccountedAt: null });
    },
  );
});
