# Reuse local Claude Code through cc-switch

This setup uses Paperclip's `claude_local` adapter with `engine: cli` and no
`runtimeConfig.aiConnection`. Claude Code reads the existing host configuration,
including cc-switch's loopback URL and proxy authentication. It does not perform
Claude OAuth login or import a subscription credential into Paperclip.

The version references record the original verification environment; they are not a
current-release compatibility guarantee. The local-auth flow has not been
requalified against those versions by this utility. The script stops when required
CLI flags or server validation are incompatible rather than falling back to another
adapter.

## Prerequisites

- Run the script on the Paperclip server host, under the same user as the server.
- Install Node.js 24.11+, the managed `paperclipai` CLI, and Claude Code.
- Start cc-switch and confirm Claude Code already works with its selected model.
- Start Paperclip and create a company.
- Authenticate the Paperclip CLI with board-user access:

  ```sh
  paperclipai auth login --no-browser --api-base http://127.0.0.1:3100
  ```

  Approve the printed URL in your authenticated Paperclip browser. For remote
  browser access, change only the URL origin to your Paperclip HTTPS origin,
  preserving the path and query. Do not share the approval token. This is
  Paperclip authorization, not Claude login.

## Run

From the repository root:

```sh
# Read-only prerequisite check. No Agent creation or model calls.
node scripts/setup-local-claude.mjs --dry-run

# Create a dedicated connectivity-test Agent. No model calls.
node scripts/setup-local-claude.mjs

# Explicitly request one model run through Paperclip and cc-switch.
node scripts/setup-local-claude.mjs --test
```

If more than one company exists, add `--company-id <id>`. Use `--api-base` for a
nondefault API origin, without an `/api` suffix. Run `--help` for executable,
configuration-directory, name, and workspace overrides. The script is intended
for Linux/macOS hosts. A Windows browser can access Paperclip independently;
this script does not provision a native Windows execution host.

The utility never reuses an Agent. If an Agent already has the selected name, the
script refuses before fetching its configuration, creating another Agent, or
requesting a model run. Choose a new `--name` and a new empty dedicated
`--workspace` for each setup. The default workspace is company-specific; after a
successful setup, choose a different workspace for a subsequent test. Existing
Agents and workspaces are never overwritten.

The selected workspace must be empty when setup begins. This prevents a test run
from interacting with pre-existing project files; the script stops before Agent
creation if it finds anything there. Each invocation with `--test` requests one
paid upstream run. If a run times out while waiting, inspect or cancel it before
retrying with a new name and workspace.

## What gets configured

- Adapter: `claude_local`, explicit `engine: cli`.
- Command: the local Claude executable resolved from PATH.
- Config directory: `CLAUDE_CONFIG_DIR` or `~/.claude`.
- Managed AI Connection: none.
- Instructions: a managed `AGENTS.md` bundle requesting
  `PAPERCLIP_CC_SWITCH_OK`.
- Automatic heartbeats: disabled. Manual invocation: enabled.
- Tools, skills, MCP servers, hooks and custom extensions: disabled for this test.
- CLI-reported budget: $0.25 per invocation. This is not an authoritative
  spending cap for a third-party gateway; configure provider-side limits too.

The setup never copies or prints proxy credential values, changes cc-switch
routing, upgrades Paperclip, or weakens Paperclip authentication. It references
the existing Claude config directory, so the server user must be able to read it.
The workspace is a dedicated directory, not a sandbox. It must be empty before
setup begins; existing workspace content causes the script to stop without
creating an Agent.

## Verification and limits

A successful live run must return exactly `PAPERCLIP_CC_SWITCH_OK`. Check the
matching session in cc-switch to confirm the actual upstream provider and model.
Claude's reported model alias and Paperclip's cost/billing classification may
still look like Claude/Anthropic; they are not the upstream bill. The local-auth
flow has not been live-qualified by the current utility.

The Agent is a connectivity fixture, not a coding Agent. After verification,
configure a separate working Agent's instructions, workspace, tool permissions,
and scheduling deliberately. Do not bind a managed subscription connection to
this legacy local-auth setup unless you intend to switch authentication paths.

Script tests:

```sh
node --test scripts/setup-local-claude.test.mjs
```
