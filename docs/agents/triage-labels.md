# Triage labels

Use these GitHub labels in `canxer314/paperclip`.

| Canonical role | GitHub label | Meaning |
| --- | --- | --- |
| needs-triage | needs-triage | Needs maintainer evaluation |
| needs-info | needs-info | Waiting for more information |
| ready-for-agent | ready-for-agent | Fully specified for agent implementation |
| ready-for-human | ready-for-human | Requires human implementation |
| wontfix | wontfix | Will not be actioned |

When a skill names a triage role, apply its mapped GitHub label. Before applying
it, check `gh label list --repo canxer314/paperclip --limit 100`. If the label is
missing, report the missing label and request approval to create it. Keep the
issue unclassified until it exists; do not silently substitute another role.
