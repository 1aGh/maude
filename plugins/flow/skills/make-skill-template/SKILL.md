---
name: make-skill-template
type: skill
description: "Scaffold a reusable skill with a concise entry point, optional references and host-appropriate metadata."
keywords: [scaffold, template, skill, create, new, generator]
---

# Make Skill Template

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Creates a new self-contained AI skill package with the correct directory structure, SKILL.md frontmatter, and optional supporting directories.

## When to Use This Skill

- When creating a brand-new skill for the AI system
- When a user says "I need a skill for [X]"
- When you need to scaffold a skill directory before implementing its logic

## Skill Directory Standard

Every skill must follow this layout:

```
skills/<skill-name>/
├── SKILL.md              ← Required: frontmatter + docs (this is the entry point)
├── scripts/              ← Optional: shell scripts, Node scripts
│   └── <name>.sh
├── config/               ← Optional: JSON configs, mappings
│   └── <name>.json
├── references/           ← Optional: payload templates, API docs
│   └── <name>.md
└── templates/            ← Optional: file templates
    └── <name>.template
```

## SKILL.md Frontmatter

Every `SKILL.md` must start with YAML frontmatter:

```yaml
---
name: <skill-name>           # kebab-case, matches directory name
type: skill                   # optional Maude catalog metadata
description: '<1-2 sentences describing when to invoke this skill>'
keywords: [keyword1, keyword2, keyword3]   # for discovery/search
---
```

### Frontmatter Field Requirements

| Field         | Required | Constraints                                                                |
| ------------- | -------- | -------------------------------------------------------------------------- |
| `name`        | **Yes**  | 1-64 chars, lowercase letters/numbers/hyphens only, must match folder name |
| `type`        | No  | Always `skill`                                                             |
| `description` | **Yes**  | 1-1024 chars, must describe WHAT it does AND WHEN to use it                |
| `keywords`    | No  | Array of lowercase keywords for discovery and search                       |

## Context budget and host metadata

Keep the description to roughly 80–160 characters: the trigger and outcome, not
an inventory of every feature. Prefer a short `SKILL.md` (under 8 KB / 300 lines)
with essential constraints and explicit links saying when to read each reference.
These are authoring budgets, not parser limits. Do not delete workflow branches
or move everything to a reference that every invocation must read wholesale.

For a shared skill, keep one Markdown procedure usable by both hosts. Claude-only
invocation settings belong in frontmatter; Codex discovery policy belongs in
`agents/openai.yaml`. That YAML configures a skill, not a custom subagent. Use
`policy.allow_implicit_invocation: false` for explicit-only Codex command entries.
Do not hardcode a model or add scripts just to translate tool names.

## Creating a New Skill

### Step 1: Gather Requirements

Ask the user (or infer from context):

1. **Name**: What should the skill be called? (kebab-case)
2. **Purpose**: What does it do? When should it be used?
3. **Needs shell scripts?** (scripts/)
4. **Needs configuration files?** (config/)
5. **Needs reference docs?** (references/)

### Step 2: Create Directory Structure

```bash
mkdir -p skills/<skill-name>
# Add optional subdirectories as needed:
mkdir -p skills/<skill-name>/scripts
mkdir -p skills/<skill-name>/config
mkdir -p skills/<skill-name>/references
```

### Step 3: Create SKILL.md

The SKILL.md should contain:

1. **Frontmatter** (see above)
2. **H1 heading** matching the skill name (Title Case)
3. **When to Use This Skill** section — clear trigger conditions
4. **Prerequisites** section — what's needed before running
5. **Quick Start** section — fastest path to using the skill
6. **Detailed sections** — reference docs, options, examples

#### Recommended Sections

| Section                     | Purpose                         |
| --------------------------- | ------------------------------- |
| `# Title`                   | Brief overview                  |
| `## When to Use This Skill` | Reinforces description triggers |
| `## Prerequisites`          | Required tools, dependencies    |
| `## Quick Run`              | One-liner to invoke the skill   |
| `## Step-by-Step`           | Numbered steps for tasks        |
| `## Troubleshooting`        | Common issues and solutions     |
| `## References`             | Links to bundled docs           |

### Step 4: Create Supporting Files

| Folder        | Purpose                            | When to Use                     |
| ------------- | ---------------------------------- | ------------------------------- |
| `scripts/`    | Executable code (Bash, Python, JS) | Automation that performs tasks   |
| `references/` | Documentation agent reads          | API references, schemas, guides |
| `config/`     | Configuration files                | Field mappings, cache files     |
| `templates/`  | Starter code agent modifies        | Scaffolds to extend             |

- Shell scripts: use `#!/usr/bin/env bash` and `set -euo pipefail`
- Config files: JSON or YAML format
- Reference docs: Markdown format

## Description Best Practices

**CRITICAL**: The `description` is the PRIMARY mechanism for automatic skill discovery. Include:

1. **WHAT** the skill does (capabilities)
2. **WHEN** to use it (triggers, scenarios)
3. **Keywords** users might mention in prompts

✅ **Do** start with an action verb or "Use when"
✅ **Do** mention specific use cases and technologies
❌ **Don't** be too vague ("Helps with stuff")
❌ **Don't** exceed 1024 characters

**Good examples:**

```yaml
description: 'Run accessibility audits on UI components. Use when checking WCAG compliance, color contrast, or ARIA attributes.'
```

```yaml
description: 'Manage Jira work items. Use when creating, updating, or transitioning stories, epics, and bugs via REST API.'
```

**Poor example:**

```yaml
description: 'Helps with project management tasks.'
```

## Conventions

1. **Package manager**: Use `<pm>` as a placeholder in documentation and scripts. Add a note that the actual package manager is auto-detected from lock files.
2. **No secrets**: Never include real credentials in skill files. Use `<YOUR_TOKEN>` placeholders.
3. **Self-contained**: Skills should work independently — don't assume other skills are installed.
4. **Project-agnostic**: Skills should work in any project, not just a specific repo.
5. **Shell scripts**: Always use `set -euo pipefail` and auto-detect the package manager.

## After Creating a Skill

1. **Register it** — Add an entry to the skills table in `CLAUDE.md` (or your project's main instructions file)
2. **Update the index** — If your project has a `workflows.md` or skill catalog, add the new skill
3. **Test it** — Run any scripts to verify they work

## Existing Skills

| Skill Name | Purpose |
|-----------|---------|
| a11y-checker | WCAG accessibility audits |
| jira-manager | Jira/iTrack issue CRUD |
| make-skill-template | This skill — scaffold new skills |
