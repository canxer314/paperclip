# Claude Code local checks

## Creating an Agent from New Agent

The independent New Agent dialog opens the same setup page in both UI layouts.
Claude Code starts with the Paperclip source. Choose Server Claude Code
configuration to save without creating an AI connection or sending a model
prompt. Switching sources keeps the shared model, unfinished authentication
inputs and env edits as drafts. Cancel leaves without saving.

Host model suggestions use the same static catalog as the existing Agent editor.
Native default leaves Paperclip's model selection unset. Manual IDs remain valid
configuration values; the suggestions do not prove backend availability. Agent
env remains editable. The server means Paperclip's execution host and service
user, and env or advanced arguments can override native configuration.

Check local conditions is optional before saving. Permission denial, a permission
query error, a missing CLI, cwd failure or an unverified executable does not
disable Finish setup. The existing create API still checks field validity,
actor/company access, approval policy and supported targets. An explicit remote
or ACP target is not made valid by choosing host.

After creation, the confirmation distinguishes a saved record from readiness.
It refreshes the existing lifecycle state while preparation or local verification
is pending. A verification failure preserves the record and opens that same
Agent for repair; refreshing the setup URL does not create another Agent.
The existing automatic verification and retries use local checks only, retain
normal directory preparation, and require a passing proof of necessary local
conditions. No model test or managed hello is needed. A local pass does not prove
native authentication or model availability. Permission and environment repairs
continue through the existing lifecycle, without a separate recovery wizard.

## First company and legacy onboarding

The first-company Agent step, company onboarding route and default wizard
variant share the same onboarding controller. Claude Code defaults to Paperclip.
Choose Server Claude Code configuration before connecting a provider to save
without a managed connection, stored-login lookup or blocking model test.
Switching sources keeps unfinished authentication inputs, env edits and the same
model value. Host offers static suggestions, aliases and manual IDs. Native
default leaves the model unset. Env drafts stay in memory rather than browser
storage.

Check local conditions is an optional, separate action. A failed local check,
missing permission or permission-query error does not block Save Agent. It does
not prove authentication or model availability. Saving keeps the normal server
field, company/actor, approval and supported-target checks. Existing onboarding
approval handling remains in place; a failed approval request retains the saved
Agent and its approval state.

The completion screen separates the saved record from pending, failed or passing
local verification. Open Agent ends this configuration step and opens that same
Agent. It does not create or dispatch the old onboarding task. Continue the
existing lifecycle verification there after repairing permission or the local
environment. Reloading a saved wizard also reuses the record. Back and existing
route/leave rules do not submit a source draft. The Paperclip source retains its
existing login, full test and first-task flow.

Active model testing is a separate feature and is never a prerequisite for this
save. This wizard does not infer a connection or hello success from saving or
local verification.

## Editing an existing Agent

In the Claude Code settings, Configuration source edits a draft. Save explicitly
to apply it. The saved-source summary describes configuration, not a connected
account. Both page layouts use the same editor.

Switching source keeps the shared model, authentication inputs, env bindings,
instructions, skills, tools, schedule and history. Host models come from the
shipped static catalog, including aliases and concrete IDs; manual IDs and
values outside the catalog remain editable. These are suggestions, not an
account's available models. There is no host provider refresh or model detection.
Native default leaves the model unset; env and advanced arguments can still
specify one. Returning to Paperclip keeps that shared value and its existing
default-model rules.

The host is the Paperclip execution host and service user, not the browser's
computer. Agent env and advanced arguments can override native configuration,
so source selection does not prove which account is used. Native hooks and
helpers may execute. Paperclip constructs default MCP, permission flags and
task sessions; operators remain responsible for custom override compatibility.

Company permission appears with fixed instance-administrator guidance. A query
failure is an error, not a denial. Permission, CLI availability, cwd failures and
unverified sandbox compatibility do not add save gates. Existing field validity,
company/actor permissions, approval freezes and explicit target restrictions
still apply. Host supports the local CLI target; explicit ACP, auto and remote
targets remain rejected. No native directory picker or env-conflict scanner is
added.

Explicit API edits to inactive connection references retain company membership,
credential-sharing and target-installation checks. They do not resolve native or
managed credentials, check provider health, discover models or select a pool's
runtime. Unchanged inactive references are retained without those lookups.

Stop the Agent and wait for current runs to finish before switching. This is a
recommendation. Saving does not stop runs, trigger new background verification,
clear queues or guarantee an atomic change for running/queued work.

| Saved source | Draft source | Login |
| --- | --- | --- |
| host | host | Old login hidden; Agent claude-login API rejects |
| host | paperclip | Save the source change separately before login |
| paperclip | host | Login and applying stored login cannot submit the host draft |
| paperclip | paperclip | Existing login and stored-login rules remain |

Login completion checks the current source before saving. Applying a stored
login through the update API requires both saved and requested source to be
Paperclip. The host administrator manages native authentication under the actual
execution user. Switching back validates the retained managed/router binding
under the existing Paperclip rules; it does not fall back to host on failure.

## Rolling back a configuration

Use the existing configuration revision history to restore a selected revision.
`POST /api/agents/:id/config-revisions/:revisionId/rollback` restores its entire
`afterConfig`, including source, the shared model, runtime settings, budget and
profile fields present in that snapshot. It creates a `rollback` revision linked
to the selected revision, including when that configuration is already current.
Older snapshots without a source field continue to mean Paperclip; snapshots
without appearance fields retain the current appearance.

Current company access, configuration permissions, approval freezes, Agent host
field restrictions and supported-target checks still apply. A legal host rollback
can be saved without company host permission or a working CLI/cwd. It restores
no host permission, native credentials, native settings snapshot, or old check
success. Checks and new runs must meet their current admission requirements.

Inactive managed/router references remain in host configuration. Restoring a
different reference checks its current company, caller and installation access
without resolving credentials or checking provider health. Returning to Paperclip
uses current managed connection admission; an unavailable binding fails closed
without falling back to host. Rollback does not launch a model test or restore an
old connection grant. Active env secret references keep their existing checks.
`latest` resolves at runtime, including rotations after rollback. Any revision
containing a redacted marker remains non-restorable.

Stop and wait for runs to finish before rollback. Rollback does not stop running
tasks, clear queued work, restore a historical session or add a session protection
mechanism. Existing model, cwd, bundle fingerprint and fresh-session behavior
continues. Running processes and queued work do not switch atomically, and an old
run can still write session state through the existing completion path.

## Copying and company packages

Duplicate Agent keeps the saved Claude configuration source and shared model.
The copy uses the company's current host permission. Revoking that permission
also applies to the copy. Copying adds no host confirmation or model test.

Company export keeps the source in `.paperclip.yaml`. Missing source fields in
old packages mean Paperclip. Export does not read or include native Claude
credentials or the company host permission. Existing explicit env secret export
and import rules still apply; this feature does not include additional secrets.

When importing host-source Agents, confirm the target execution environment once
for the whole batch. It uses the target Paperclip execution host and the
configuration visible to its runtime user, not the source host or browser computer.
The UI has one batch checkbox. CLI import includes the same explanation in its
existing confirmation; `--yes` accepts it, including in JSON or unattended use.
The raw API uses `hostConfigurationConfirmed: true`. This acknowledgement is
required only when the final import creates or replaces a host-source Agent.
Skipped Agents require no acknowledgement.

Confirmation grants no permission. An import can save Agents without target host
permission; checks, tests and runs still require current permission. A company
package cannot grant, revoke or overwrite the target permission. Import does not
add wakeups, runs, active model tests or a new forced pause. The existing optional
pause choice and lifecycle stay in place. Any existing automatic host verification
uses local checks only. A local pass is not native authentication or model proof.

## Local check API

The existing `POST /api/companies/:companyId/adapters/claude_local/test-environment`
endpoint accepts an optional `purpose`, either `local-check` or `model-test`.
`adapterConfig.configurationSource` accepts `paperclip` and `host`. Omission
preserves `paperclip`. Omitted purpose on that source keeps the existing test;
omitted purpose on `host` means a local check and never sends model input.

```json
{
  "purpose": "local-check",
  "adapterConfig": {
    "configurationSource": "host",
    "cwd": "/existing/workspace"
  }
}
```

A host check requires company access, the existing configuration permissions,
and current company permission granted by an instance administrator in Instance
Access. Permission is read before preparation and again before adapter dispatch.
A missing or disabled permission returns 403 with `claude_host_access_denied`.
A query error remains a service error; it never authorizes a probe. Revocation
after final admission does not cancel an already admitted check.

Host checks require the local CLI target. Omitted engine selects the CLI for
this check; explicit ACP, `auto`, SSH, sandbox, and managed-sandbox-only targets
are rejected. Existing Paperclip-source engine and remote behavior are retained.
The host means Paperclip's execution host and service user, not the browser's
computer. The first release's support promise is Ubuntu directly launching the
local Claude Code CLI. These mocked tests do not qualify a real Ubuntu host.

Checks inspect the directory and executable and run only bounded `--version`
and `--help` commands, with the existing process termination mechanism. The
task CLI's machine-readable output capabilities and existing model-specific
version requirements must pass. Model-test isolation flags are not prerequisites
for local readiness. No hello prompt, provider discovery, managed revalidation,
login scan, native credential import, or native configuration snapshot follows.
No explicit API key is required for this check. Authentication remains untested.

Inactive managed/router bindings are retained for switching back and do not
participate. Active Agent and environment env bindings keep their existing
resolution, authorization, and merge order. Invalid active secret references
block the check. Agent callers cannot use draft checks to add host fields that
their normal configuration path forbids.

The trusted probe uses the existing server PATH and caller-env allowlist. It
must confirm the same absolute executable selected by the runtime configuration.
A custom wrapper, different PATH selection, or unresolved executable produces
an unverified result without testing another CLI. Caller HOME, proxy, loader,
and arbitrary env overrides do not enter the probe. When the same executable
and basic conditions can be confirmed but full env/args cannot be reproduced,
the result states that limited proof explicitly.

Results retain `status`, `checks`, and `testedAt` for existing consumers. The
additional fields describe this operation, not persistent health:

| Field | Meaning |
| --- | --- |
| `purpose` | Local check or explicit model test |
| `outcome` | `passed`, `failed`, `unverifiable`, or `unsupported` |
| `localPrerequisites` | `passed`, `failed`, or `unverifiable` startup conditions |
| `configurationReproducibility` | Whether the probe can reproduce the effective environment and arguments |
| `modelResponse` | `not_tested` for a local check |
| `cwd` | Directory checked by the adapter |

A draft local check only inspects an existing cwd and cannot create it.
Creation's trusted automatic verification and its existing retries retain
directory preparation. They complete from an explicit passing local proof,
including when full configuration reproduction is unknown. A generic warning
or an unknown necessary condition cannot make a new Agent ready. Check failures
do not deactivate an already ready Agent or delete a new Agent's record.

Local checks are the slice of issue #24 implemented in #27; existing-Agent
source editing and login boundaries are implemented in #28. The independent
New Agent flow is implemented in #29, and the first-company and legacy onboarding
controller in #30. Whole-configuration rollback compatibility is implemented in
#31. Isolated host
model testing is implemented separately; until available, explicit `model-test`
returns `unsupported` without inference. Formal host task execution, billing,
and integrated release qualification remain separate work.
This slice adds no Telemetry events, Observability spans, or run-log rows.
