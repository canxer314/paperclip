import { describe, expect, it } from "vitest";
import { visibleRunCostUsd, visibleRunTokenTotal } from "./utils";

describe("persisted run cost policy", () => {
  it("shows internal zero and actual tokens without changing the CLI amount", () => {
    const usage = { costPolicy: "host_external_untracked_v1", provider: "anthropic", costUsd: 1.25,
      inputTokens: 100, cachedInputTokens: 200, outputTokens: 30 };
    expect(visibleRunCostUsd(usage, { total_cost_usd: 9 })).toBe(0);
    expect(visibleRunTokenTotal(usage)).toBe(330);
    expect(usage.costUsd).toBe(1.25);
  });
  it("retains historical charges and ignores a policy claimed by provider result JSON", () => {
    expect(visibleRunCostUsd({ costUsd: 1.25 }, { costPolicy: "host_external_untracked_v1" })).toBe(1.25);
    expect(visibleRunCostUsd(null, { total_cost_usd: 1.25 })).toBe(1.25);
    expect(visibleRunCostUsd({ billingType: "subscription_included", costUsd: 1.25 })).toBe(0);
  });
});
