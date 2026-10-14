# Claude Code local checks

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
source editing and login boundaries are implemented in #28. Isolated host
model testing is implemented separately; until available, explicit `model-test`
returns `unsupported` without inference. Formal host task execution, creation
controllers, billing, and integrated release qualification remain separate work.
This slice adds no Telemetry events, Observability spans, or run-log rows.
