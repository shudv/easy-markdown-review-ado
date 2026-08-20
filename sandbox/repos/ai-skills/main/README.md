# AI Skills

Reusable agent skills for on-call and support workflows, plus the human
guidelines they automate. Each skill is a self-contained folder with a
`SKILL.md`; the human-readable process docs live under `guidelines/`.

| Skill | Purpose |
| --- | --- |
| [ICM Investigation](skills/icm-investigation/SKILL.md) | Triage an IcM incident and propose a first mitigation. |

## Conventions

- A skill's `SKILL.md` carries YAML frontmatter (`name`, `description`,
  `version`) so it can be discovered and versioned.
- A skill links to the guideline it automates so a human can always read the
  process the agent is following.
- Guidelines are written for people; skills are written for agents.
