import { useEffect, useRef, useState } from "react";
import type { AdapterEnvironmentTestResult } from "@paperclipai/shared";
import { agentsApi } from "../api/agents";
import { Button } from "./ui/button";
import { AdapterEnvironmentResult } from "./AdapterEnvironmentResult";

export function SavedClaudeModelTest({ companyId, agentId, model, context, disabled, hasDraft }: {
  companyId: string;
  agentId: string;
  model: string;
  context: string;
  disabled: boolean;
  hasDraft: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ context: string; value: AdapterEnvironmentTestResult } | null>(null);
  const [error, setError] = useState<{ context: string; message: string } | null>(null);
  const inFlight = useRef(false);
  const sequence = useRef(0);
  const previousContext = useRef(context);
  if (previousContext.current !== context) {
    previousContext.current = context;
    sequence.current++;
  }
  useEffect(() => { setResult(null); setError(null); }, [context]);
  useEffect(() => () => { sequence.current++; }, []);

  async function test() {
    if (disabled || hasDraft || inFlight.current) return;
    const request = ++sequence.current;
    inFlight.current = true;
    setPending(true); setResult(null); setError(null);
    try {
      const value = await agentsApi.testEnvironment(companyId, "claude_local", { agentId, purpose: "model-test" });
      if (request === sequence.current) setResult({ context, value });
    } catch {
      if (request === sequence.current) setError({ context, message: "The saved model test could not be completed. Check configuration permissions, company permission, budgets and active environment bindings. External execution and charges may still have occurred." });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  const current = result?.context === context ? result.value : null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        This tests the saved configuration and sends "Respond with hello." It may also send native project context, referenced instructions and memory, and may incur external charges.
        Paperclip starts one CLI call without automatic retry; the CLI or proxy may make multiple requests, retry or fall back to another model.
        All model tools are disabled and the test session is not persisted. Native hooks and helpers may execute; their side effects and external records remain possible.
        Clicking authorizes this call directly. Tests use an existing configured directory or the server default; tasks may use another workspace or worktree.
        A timeout, disconnect or leaving this page does not prove cancellation or no charges. A later click is another potentially paid test.
      </p>
      {hasDraft && <p className="text-xs text-muted-foreground">Save or discard execution changes before testing the saved model. This does not test your draft or save automatically.</p>}
      <Button type="button" variant="outline" size="sm" disabled={disabled || hasDraft || pending} onClick={() => void test()}>
        {pending ? "Testing saved model…" : "Test saved model"}
      </Button>
      {error?.context === context && <p role="alert" className="text-xs text-destructive">{error.message}</p>}
      {current && <div role="status" className="space-y-2 text-xs">
        <p>{current.outcome === "passed" && current.modelResponse === "passed"
          ? `${(current.selectedModel ?? model) || "Default model"} call succeeded for this test only.` : "This saved model test did not pass."}
          {" "}This is the selected model, not proof of the backend model or account. Results remain on this page only.</p>
        {current.cwd && <p className="font-mono break-all">Test directory: {current.cwd}</p>}
        <AdapterEnvironmentResult result={current} />
      </div>}
    </div>
  );
}
