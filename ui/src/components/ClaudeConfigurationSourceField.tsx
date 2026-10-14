import { useQuery } from "@tanstack/react-query";
import type { ClaudeConfigurationSource } from "@paperclipai/shared";
import { accessApi } from "../api/access";
import { queryKeys } from "../lib/queryKeys";
import { Field } from "./agent-config-primitives";
import { Button } from "./ui/button";
import { NativeSelect } from "./ui/select";

export function ClaudeConfigurationSourceField({ companyId, value, savedValue, onChange, disabled }: {
  companyId: string;
  value: ClaudeConfigurationSource;
  savedValue?: ClaudeConfigurationSource;
  onChange: (source: ClaudeConfigurationSource) => void;
  disabled?: boolean;
}) {
  const showPermission = value === "host" || savedValue === "host";
  const permission = useQuery({
    queryKey: queryKeys.access.companyClaudeHostAccess(companyId),
    queryFn: () => accessApi.getClaudeHostAccess(companyId),
    enabled: showPermission,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  return (
    <Field label="Configuration source" hint="Chooses the automatic authentication preparation for Claude Code.">
      <NativeSelect aria-label="Configuration source" value={value} disabled={disabled}
        onChange={event => onChange(event.target.value as ClaudeConfigurationSource)}>
        <option value="paperclip">Paperclip</option>
        <option value="host">Server Claude Code configuration</option>
      </NativeSelect>
      <div className="mt-2 space-y-2 text-xs text-muted-foreground">
        {savedValue && <p>Saved configuration source: {savedValue === "host" ? "Server Claude Code configuration" : "Paperclip"}</p>}
        <p>The server is Paperclip's execution host and service user, not your browser computer. Agent env and advanced arguments may override native configuration; this choice does not prove which account is used.</p>
        <p>Native hooks and helpers may execute. Paperclip constructs default MCP, permissions and task sessions; operators are responsible for advanced override compatibility. <a className="underline" href="https://github.com/canxer314/paperclip/blob/master/doc/claude-local-checks.md" target="_blank" rel="noreferrer">Configuration boundaries</a></p>
        {savedValue && <p>Stop the Agent and wait for current runs to finish before switching. Save does not stop current runs.</p>}
        {savedValue && value !== savedValue && <p>Save the source switch before using Paperclip login. Login does not apply a different source draft.</p>}
        {showPermission && <div role={permission.isError ? "alert" : "status"} className="space-y-2">
          <p>{permission.isError ? "Could not load company permission. Retry the permission query." :
            permission.isFetching ? "Loading company permission…" :
            permission.data?.enabled === true ? "Company permission: allowed" : "Company permission: not granted"}</p>
          <p>Contact your instance administrator to manage permission. Permission is required for checks and new runs, not for saving configuration.</p>
          {permission.isError && <Button type="button" variant="ghost" size="sm" onClick={() => void permission.refetch()}>Retry permission query</Button>}
        </div>}
      </div>
    </Field>
  );
}
