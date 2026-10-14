import { HOST_EXTERNAL_UNTRACKED_COST_POLICY } from "@paperclipai/shared";
import { formatNumber } from "../lib/utils";

export function RunCostPolicyNotice({ usage, result }: {
  usage: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
}) {
  if (usage?.costPolicy !== HOST_EXTERNAL_UNTRACKED_COST_POLICY) return null;
  const pricingProvenance = usage.pricingProvenance as { source?: unknown } | null | undefined;
  const usageCostIsEstimate = usage.costStatus === "estimated" || usage.costStatus === "unpriced"
    || pricingProvenance?.source === "rate_card";
  const reportedCost = [result?.total_cost_usd, result?.cost_usd, result?.costUsd,
    !usageCostIsEstimate ? usage.costUsd : null]
    .find((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  return (
    <div className="border-t border-border p-4 text-xs text-muted-foreground space-y-2">
      <p>Paperclip does not count charges for this run. External actual cost is unknown.
        Zero does not mean free or included in a subscription. Amount budgets do not cap the external bill.</p>
      {reportedCost != null && <p>CLI cost reference: <span className="font-mono">
        ${formatNumber(reportedCost, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
      </span>, not an external bill.</p>}
    </div>
  );
}
