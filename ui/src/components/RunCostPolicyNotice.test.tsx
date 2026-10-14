import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunCostPolicyNotice } from "./RunCostPolicyNotice";

describe("run cost policy notice", () => {
  it("explains internal zero, external uncertainty and the limited CLI reference", () => {
    const html = renderToStaticMarkup(<RunCostPolicyNotice usage={{ costPolicy: "host_external_untracked_v1", costUsd: 1.25,
      billingType: "subscription_included" }} result={null} />);
    expect(html).toContain("Paperclip does not count charges for this run");
    expect(html).toContain("External actual cost is unknown");
    expect(html).toContain("Zero does not mean free or included in a subscription");
    expect(html).toContain("Amount budgets do not cap the external bill");
    expect(html).toContain("CLI cost reference:");
    expect(html).toContain("$1.2500");
    expect(html).toContain("not an external bill");
  });
  it("keeps unknown CLI amounts unknown and leaves historical run explanations unchanged", () => {
    expect(renderToStaticMarkup(<RunCostPolicyNotice usage={{ costPolicy: "host_external_untracked_v1" }} result={null} />))
      .not.toContain("CLI cost reference");
    expect(renderToStaticMarkup(<RunCostPolicyNotice usage={{ costUsd: 1.25 }} result={null} />)).toBe("");
    expect(renderToStaticMarkup(<RunCostPolicyNotice usage={null} result={{ costPolicy: "host_external_untracked_v1" }} />)).toBe("");
  });
  it("shows the original CLI amount instead of cache-adjusted costs", () => {
    const html = renderToStaticMarkup(<RunCostPolicyNotice
      usage={{ costPolicy: "host_external_untracked_v1", costUsd: 1.25, cacheAdjustedCostUsd: 0.5 }} result={null} />);
    expect(html).toContain("$1.2500");
    expect(html).not.toContain("$0.5000");
  });
  it("does not label a rate-card estimate as a CLI reference", () => {
    const html = renderToStaticMarkup(<RunCostPolicyNotice usage={{ costPolicy: "host_external_untracked_v1",
      costUsdExact: "0.001", costStatus: "estimated", pricingProvenance: { source: "rate_card" } }} result={null} />);
    expect(html).not.toContain("CLI cost reference");
  });
});
