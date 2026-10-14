# Issue tracker: GitHub

Engineering issues and specs live in GitHub Issues for `canxer314/paperclip`.
Use the `gh` CLI and explicitly select this repository for every operation.
`origin` is the fork; `upstream` is `paperclipai/paperclip`.
Publish to upstream only when the user explicitly requests it.

Explicitly assigned Paperclip tasks follow the `paperclip` skill instead.
Repo plan documents remain in `doc/plans/YYYY-MM-DD-slug.md`.

## Conventions

- Create: `gh issue create --repo canxer314/paperclip --title "..." --body-file <file>`.
- Read: `gh issue view <number> --repo canxer314/paperclip --comments`.
- List: `gh issue list --repo canxer314/paperclip --state open --json number,title,body,labels,assignees`.
- Comment: `gh issue comment <number> --repo canxer314/paperclip --body-file <file>`.
- Apply/remove labels: `gh issue edit <number> --repo canxer314/paperclip --add-label "..."` or `--remove-label "..."`.
- Close: `gh issue close <number> --repo canxer314/paperclip --comment "..."`.

Use the label mapping in `triage-labels.md`.

## Pull requests as a triage surface

PRs as a request surface: no.

GitHub issues and PRs share a number space. If a reference is ambiguous,
resolve its type before acting on it.

## Publishing and fetching

When a skill says to publish to the issue tracker, create an issue in
`canxer314/paperclip`.

When a skill says to fetch a ticket, read the issue and its comments from
that repository.

## Wayfinding operations

Before applying a Wayfinder label, use the same existence check and approval
process for missing labels described in `triage-labels.md`.

- Map: one issue labeled `wayfinder:map`, with Notes, Decisions-so-far, and Fog.
- Child tickets: GitHub sub-issues labeled `wayfinder:<type>`, where type is
  research, prototype, grilling, or task.
- If sub-issues are unavailable, use a task list in the map and
  `Part of #<map>` in each child.
- Blocking: use native issue dependencies. API paths must start with
  `repos/canxer314/paperclip/`.
- Dependency edges use issue database IDs, not issue numbers or node IDs.
- If dependencies are unavailable, use `Blocked by: #<n>, #<n>` in the child.
- Frontier: open children without open blockers or an assignee, in map order.
- Claim: assign the child to the driving developer before starting work.
- Resolve: comment with the answer, close the child, and add a summary and
  link to Decisions-so-far in the map.
