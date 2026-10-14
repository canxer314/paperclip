# Claude Code local checks

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

This is the local-check slice of issue #24, implemented in #27. Isolated host
model testing is implemented separately; until available, explicit `model-test`
returns `unsupported` without inference. Formal host task execution, UI source
selection, billing, and integrated release qualification remain separate work.
This slice adds no Telemetry events, Observability spans, or run-log rows.
