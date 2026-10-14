import { HOST_EXTERNAL_UNTRACKED_COST_POLICY } from "@paperclipai/shared";
import { readRunCostUsd } from "../lib/utils";

export function RunCostPolicyNotice({ usage, result }: {
  usage: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
}) {
  if (usage?.costPolicy !== HOST_EXTERNAL_UNTRACKED_COST_POLICY) return null;
  const reportedCost = readRunCostUsd(usage) ?? readRunCostUsd(result);
  return (
    <div className="border-t border-border p-4 text-xs text-muted-foreground space-y-2">
      <p>Paperclip does not count charges for this run. External actual cost is unknown.
        Zero does not mean free or included in a subscription. Amount budgets do not cap the external bill.</p>
      {reportedCost != null && <p>CLI cost reference: ${reportedCost.toFixed(4)}, not an external bill.</p>}
    </div>
  );
}
