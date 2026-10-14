# Domain docs

## Layout

Use a single-context layout:
- `GLOSSARY.md` at the repository root.
- `docs/adr/` for shared architectural decisions.

Preserve existing package ADRs. For runner work, also check
`packages/paperclip-runner/docs/adr/`.

## Before exploring

Read the root glossary and ADRs relevant to the topic.
If a root `GLOSSARY-MAP.md` is introduced later, follow its links to the
relevant context glossaries.

If these files or directories do not exist, proceed silently.
Do not create empty placeholders or suggest creating them upfront.
The `domain-modeling` skill creates domain docs when terms or decisions
are actually resolved.

These rules supplement the required reading order in `AGENTS.md`.

## Vocabulary

Use glossary terms in issue titles, proposals, hypotheses, and tests.
Do not substitute synonyms the glossary explicitly avoids.
If a concept is missing, reconsider the term or note the gap for
`domain-modeling`.

## ADR conflicts

Explicitly identify any recommendation that conflicts with an existing
ADR, including the ADR reference and the reason to reconsider it.
