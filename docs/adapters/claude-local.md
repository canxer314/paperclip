---
title: Claude Code
summary: Claude Code local adapter setup and configuration
---

The `claude_local` adapter runs Anthropic's Claude Code CLI locally. It supports session persistence, skills injection, and structured output parsing.

## Quota waits

Claude ACP runs that end with a typed provider-quota error retain the quota
classification and any parsed reset time. Recovery waits until that time, or
uses its existing one-hour quota backoff when no reset time is available.
This includes the Claude bridge's typed “The Claude account has no available
quota.” fallback, which carries no reset timestamp.
The adapter inspects the terminal provider message in memory; the run result
and run log retain only the generic failure message, recovery labels, and reset
timestamp. Context, turn, rate, and configured budget limits are not treated as
subscription quota exhaustion merely because ACP labels them `limit`.

## Prerequisites

- Claude Code CLI installed (`claude` command available)
- Either `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` in adapter or
  environment env (or host env), or a Claude Code subscription login
  available to the execution target

## Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cwd` | string | Yes | Working directory for the agent process (absolute path; created automatically if missing when permissions allow) |
| `model` | string | No | Claude model to use (default: `claude-opus-5`) |
| `promptTemplate` | string | No | Prompt used for all runs |
| `env` | object | No | Environment variables (supports secret refs) |
| `timeoutSec` | number | No | Process timeout (0 = no timeout) |
| `graceSec` | number | No | Grace period before force-kill |
| `maxTurnsPerRun` | number | No | Max agentic turns per heartbeat (defaults to `300`) |
| `dangerouslySkipPermissions` | boolean | No | Skip permission prompts (default: `true`); required for headless runs where interactive approval is impossible |

## Configuration source for existing Agents

Existing Agent settings offer Paperclip or Server Claude Code configuration.
Changing the selection edits a draft; Save applies it without stopping current
runs or adding background verification. Stop the Agent and wait for its runs
to finish before switching.

Host refers to the Paperclip execution host and service user, not the browser
computer. Env and advanced arguments can override native configuration. Hooks
and helpers may execute; Paperclip constructs default MCP, permissions and task
sessions. Custom override compatibility remains the operator's responsibility.
The saved-source summary does not prove a connected account.

Source switching preserves one shared model and existing authentication, env,
instructions, skills, tools and history. Host uses static suggestions and manual
model IDs, including aliases and values outside the list. The candidates do not
prove account availability. Native default does not specify an extra Paperclip
model, although env and advanced arguments may specify one. Paperclip's model
defaults below continue to apply after switching back.

Company permission and query errors appear in the editor. Ask the instance
administrator to manage permission. A legal save does not require permission,
an installed CLI, a working cwd or verified sandbox compatibility. Illegal
sources, explicit unsupported engines/targets, unauthorized fields and approval
freezes still reject. Host supports the local CLI, not explicit ACP/auto or remote
targets. The existing env editor remains available.

Old login is hidden for host. If saved and draft sources differ, save the source
change separately before using Paperclip login. Login completion and applying a
stored login cannot silently submit a host draft. Native authentication is
managed by the administrator under the actual execution user.

Existing-Agent editing and local checks are available as parts of #24. Formal
host task execution, creation controllers and complete release qualification
are implemented separately.

## Paperclip default model

An omitted, empty, or whitespace-only `model` uses Claude Opus 5
(`claude-opus-5`) on both the CLI and ACP engines. This also applies to existing
agents with an unset model, including agents created through the API and agents
running in sandboxes. No database migration is needed. The editor shows the
Paperclip default and leaves the setting unset until you select a model.

An explicit `model` takes precedence over `ANTHROPIC_MODEL`. When only
`ANTHROPIC_MODEL` is configured, the adapter keeps that override. Bedrock and
Vertex configurations without an explicit model keep their provider-specific
default because those providers use different model IDs. Host environment
settings apply only to local targets when resolving the model.

The default does not change explicitly configured agent models or the separate
Paperclip Runner's qualified provider profiles.

## Prompt Templates

Templates support `{{variable}}` substitution:

| Variable | Value |
|----------|-------|
| `{{agentId}}` | Agent's ID |
| `{{companyId}}` | Company ID |
| `{{runId}}` | Current run ID |
| `{{agent.name}}` | Agent's name |
| `{{company.name}}` | Company name |

## Session Persistence

The adapter persists Claude Code session IDs between heartbeats. On the next wake, it resumes the existing conversation so the agent retains full context.

Session resume is cwd-aware: if the agent's working directory changed since the last run, a fresh session starts instead.

If resume fails with an unknown session error, the adapter automatically retries with a fresh session.

### Poisoned `previous_message_id` (recovery)

Symptom in logs / issue thread:

```
API Error: 400 diagnostics.previous_message_id: must be the `id` from a prior /v1/messages response (starts with `msg_`)
```

What it means: the on-disk Claude Code transcript JSONL for that session contains a malformed (non-`msg_`-prefixed) `previous_message_id`. Anthropic's `/v1/messages` rejects every resume attempt against that transcript with a deterministic 400. Without guards, Paperclip would re-persist the same poisoned session id and the issue is stranded permanently — see [RED-976](../../../) / [RED-978](../../../).

What the adapter does automatically:

1. **Auto-rotate on resume.** If a `--resume` attempt returns this 400, the adapter retries once with a fresh session, deletes the poisoned `<session>.jsonl` from the local Claude config dir (best effort), and uses the fresh session id going forward.
2. **Validate-before-persist.** A result that carries this 400 never gets its `session_id` written back to the task session store, even if Claude Code emits one in the result event. The adapter returns `sessionId: null`, `sessionParams: null`, and `errorCode: "claude_poisoned_previous_message_id"`.
3. **Clear-on-error.** The adapter sets `clearSession: true` on the result, which causes the heartbeat service to drop any persisted session row for that issue (`clearTaskSessions`). The next continuation starts from a clean slate.

On-call checklist if you see this in production:

- Confirm `errorCode` is `claude_poisoned_previous_message_id` in the run row — that means the guards fired correctly and the issue auto-recovers on the next heartbeat.
- If the same issue still loops after one heartbeat, check that `agentTaskSessions` for that `(agentId, taskKey)` was cleared. If not, the adapter return value was lost (e.g. a malformed run finalization) — escalate; do **not** manually edit the row, file a child issue with the run id.
- For remote execution targets (sandbox/SSH), the poisoned JSONL is on the remote and the adapter only logs the cleanup intent. The fresh-session retry still succeeds because it uses a new session id, and the server-side `clearSession: true` is authoritative regardless of remote disk state.

## Skills Injection

The adapter creates a temporary directory with symlinks to Paperclip skills and passes it via `--add-dir`. This makes skills discoverable without polluting the agent's working directory.

## Remote credential ownership

When no API key or `CLAUDE_CODE_OAUTH_TOKEN` is configured,
`claude_local` uses a snapshot-owns-auth topology for managed sandbox execution
targets. When the run uses a sandbox execution target and no explicit
`CLAUDE_CONFIG_DIR` is configured, Paperclip creates a remote
`CLAUDE_CONFIG_DIR` under the run's Claude runtime directory. It uploads
sanitized host-side settings such as `settings.json` and `CLAUDE.md`, but the
managed seed does not upload host Claude credential files.

After the seed is copied, the remote materialization command checks the
execution target's own `$HOME/.claude` directory. For each missing credential
file, it copies `.credentials.json` or `credentials.json` from that remote home
into the managed `CLAUDE_CONFIG_DIR`. That means credentials baked into the
sandbox image win for managed remote Claude runs.

Worked example: a sandbox image contains `$HOME/.claude/.credentials.json` from
its own Claude Code login. Paperclip starts a managed remote `claude_local` run,
uploads only the sanitized config seed, and sets `CLAUDE_CONFIG_DIR` to the
remote runtime config path. Because the managed config has no credential file,
the adapter copies the sandbox image's `$HOME/.claude/.credentials.json` into
that path before invoking Claude. The sandbox snapshot owns the credential for
the run.

This differs from [`codex_local`](/adapters/codex-local), where a
Paperclip-managed sandbox run uploads a host-owned `CODEX_HOME/auth.json` and
therefore shadows any Codex login already present inside the sandbox image.

For manual local CLI usage outside heartbeat runs (for example running as `claudecoder` directly), use:

```sh
npx paperclipai agent local-cli claudecoder --company-id <company-id>
```

This installs Paperclip skills in `~/.claude/skills`, creates an agent API key, and prints shell exports to run as that agent.

## Environment Test

Use the "Test Environment" button in the UI to validate the adapter config. It checks:

- Claude CLI is installed and accessible
- Working directory is absolute and available (auto-created if missing and permitted)
- API key/auth mode hints (`ANTHROPIC_API_KEY` vs `CLAUDE_CODE_OAUTH_TOKEN` vs subscription login)
- A live hello probe (`claude --print - --output-format stream-json --verbose` with prompt `Respond with hello.`) to verify CLI readiness

The probe sees the same layered env as a real run: when an environment is
selected, its environment variables (secret refs included) are resolved and
merged under the adapter config's `env`, so environment-level auth is
reflected in the test result. A secret binding that is missing surfaces as
an `environment_env_binding_missing` failure instead of a silently passing
probe.


## Company permission for server configuration

An instance administrator can open **Instance Access** from the account menu
(`/instance/access`) and grant or revoke a company’s Claude server configuration
permission. This block is independent of the user selected for membership editing.
An administrator needs no membership in the target company to manage permission;
permission does not give the administrator or company users any additional
company business access. Ordinary board users and agent keys cannot grant it.

Existing companies start with permission denied. Granting permission stores no
credentials, native identity or configuration paths and does not check login or
call a model. Existing Claude adapter configuration modes continue to work.
Formal host execution and integrated qualification remain part of #24;
permission alone does not prove either.

If the host permission directory fails, retry its directory action; it is not an
empty directory or a denial result. If an individual update fails, the row shows
an error and does not claim the change succeeded. Reload the directory to confirm
current permission before retrying. Only that row is disabled while its update
is pending.

**Restore to another host:** revoke and explicitly regrant company permissions
after checking the new execution host and runtime user. Paperclip does not detect
host changes automatically. The server is not the computer running your browser.
Permission is not evidence of successful authentication or model availability.

API contracts:

- `GET /api/instance/claude-host-access`: instance admin, only company ID/name/enabled.
- `PUT /api/instance/claude-host-access/:companyId`: instance admin, `{ "enabled": true | false }`.
- `GET /api/companies/:companyId/claude-host-access`: existing company access, `{ "enabled": boolean }`.

Unauthenticated requests return 401, non-admin administration requests 403,
unknown companies 404, invalid payloads 400 and database failures server errors.
Unauthorized company queries use existing resource hiding. Every setting request,
including a repeated grant or revoke, is activity-audited with its actor, company,
before/after state and whether it changed. Company deletion removes permission.

Permission administration adds no Telemetry event or OTLP span, does not change
unconfigured Observability’s no-op behavior, and leaves run-log data in the instance database.
