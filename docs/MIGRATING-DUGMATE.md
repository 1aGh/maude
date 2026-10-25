# Migrating Dugmate to the `flow` plugin

This guide migrates `/Volumes/D/git/dugmate` from its bundled `.claude/` workflow loop to the marketplace-installed `flow@maude` plugin.

## What you keep, what you remove, what you gain

**Keep** (project-local override, lives in `dugmate/.claude/`):

- `skills/dugmate-motion-rules/` — *until* generalized `motion-rules` in flow plugin is rich enough; then config-driven
- `skills/dugmate-responsive-rules/`
- `skills/dugmate-a11y-rules/`
- `skills/dugmate-testing-rules/`
- `skills/dugmate-debugging-rules/`
- `skills/ux-designer/` — stays Dugmate-local indefinitely. Design-critic skills live in the `design` plugin (`/design:critic`) and cover that role at Maude scope.

**Remove** (replaced by `flow@maude`):

- `dugmate/.claude/commands/*.md` — all 25 commands. Flow plugin ships generic, English equivalents installed under the `/flow:` namespace. If you really want Czech command bodies, you can override individual ones by placing matching files back in `dugmate/.claude/commands/` (Claude Code prefers local over plugin).
- `dugmate/.claude/agents/*.md` — `a11y-auditor`, `design-system-guard`, `scenario-runner`, `test-coverage`. Flow plugin ships these generic.
- `dugmate/.claude/skills/{agent-browser,agent-device,a11y-checker,codebase-intelligence,ddr-keeper,make-skill-template,question-protocol,scenario,workflow-state}/` — all generic skills. Flow plugin ships these.

**Gain:**

- Plugin updates propagate to dugmate automatically.
- No duplication between repos. Future projects benefit from the same loop.
- `.ai/workflows.config.json` replaces ~50 lines of duplicated content with ~50 lines of typed JSON.

## Migration steps

### 1. Install Maude marketplace + flow plugin

Inside Claude Code, with `dugmate` open as the project:

```
/plugin marketplace add 1aGh/maude
/plugin install flow@maude
/reload-plugins
```

Optional: `/plugin install design@maude` if you want the design canvas there too. (Dugmate already has rich design tooling; verify before installing.)

### 2. Install the CLI globally

```sh
npm i -g @1agh/maude
```

### 3. Scaffold the missing `.ai/` pieces

Dugmate already has a rich `.ai/`. The flow skeleton adds anything missing — it's idempotent.

```sh
cd /Volumes/D/git/dugmate
maude init --name dugmate
```

This:
- Creates `.ai/workflows.config.json` if absent (skips if present — review and tune by hand).
- Adds missing subfolders (e.g. `business/` if dugmate doesn't have one).
- Skips every file that already exists. Run with `--dry-run` first if you want to see the diff.

### 4. Populate the config

```sh
maude config set name dugmate
maude config set language cs
maude config set theme dark
maude config set platforms '["web-desktop","web-mobile","ios-phone","ios-tablet","android-phone"]'
maude config set bundleIdPrefix com.dugmate
maude config set boundaries.realtime '["Yjs","WebSocket","Partykit","Liveblocks"]'
maude config set boundaries.video '["Mux","bunny.net"]'
maude config set boundaries.api '["tRPC","RLS"]'
maude config set boundaries.telemetry '["PostHog"]'
maude config set ux.responseTargetMs 100
maude config set ux.bilingual '["cs","en"]'
maude config set responsive.densityMap '{"web-desktop":"command-center","web-mobile":"sideline-tool","ios-phone":"palm-friendly","ios-tablet":"palm-friendly","android-phone":"palm-friendly"}'
```

Inspect with `maude config show`.

### 5. Verify path resolution

The flow plugin's commands resolve `<project>` from `.ai/workflows.config.json` → `name`. With `name: "dugmate"`, references like `.ai/<project>-prd.md` resolve to `.ai/dugmate-prd.md` — which already exists.

```sh
maude config get paths.prd            # → .ai/dugmate-prd.md
maude config get paths.designSystem   # → .ai/dugmate-design-system.md
```

If you want different filenames, override `paths.prd` / `paths.designSystem`.

### 6. Remove the now-duplicated workflow files

Once you've confirmed `/flow:run --status`, `/flow:plan`, `/flow:execute` work from the plugin:

```sh
cd /Volumes/D/git/dugmate
git rm -r .claude/commands .claude/agents
git rm -r .claude/skills/agent-browser .claude/skills/agent-device \
          .claude/skills/a11y-checker .claude/skills/codebase-intelligence \
          .claude/skills/ddr-keeper .claude/skills/make-skill-template \
          .claude/skills/question-protocol .claude/skills/scenario \
          .claude/skills/workflow-state
git commit -m "chore: drop bundled workflow loop, switch to flow@maude"
```

**Don't remove:**

- `dugmate/.claude/skills/dugmate-*-rules/` — these are dugmate-specific enforcement; subagents from the plugin look them up by name.
- `dugmate/.claude/skills/ux-designer/` — stays.
- `dugmate/.claude/settings.json` — plugin enablement lives here.
- Everything in `dugmate/.ai/`.

### 7. Update `dugmate/.claude/settings.json`

Make sure `flow@maude` is in your enabled plugins list:

```json
{
  "enabledPlugins": [
    "flow@maude",
    "design@maude",
    "frontend-design@claude-code",
    "playground@claude-code"
  ]
}
```

Adjust to taste. Dugmate's existing settings (PostHog, Vercel, etc.) stay untouched.

### 8. Smoke test

Inside Claude Code with `dugmate` open:

```
/flow:run --status            # should resolve to dugmate's .ai/state/STATE.md
maude doctor         # should print "5 dugmate-* skills found" etc.
```

Then try a small loop end-to-end on a throwaway branch:

```
/flow:plan "demo plan for migration verification"
/flow:execute           # cancel after a step or two
/flow:run --status            # confirms phase tracking works
```

## What can go wrong

- **Subagents can't find `dugmate-*-rules`.** Cause: skill folder names changed or moved. Fix: ensure `dugmate/.claude/skills/dugmate-{motion,responsive,a11y,testing,debugging}-rules/SKILL.md` exist (with frontmatter `name: dugmate-<topic>-rules`).
- **`<project>` placeholder doesn't resolve.** Cause: `.ai/workflows.config.json` missing or `name` empty. Fix: `maude config set name dugmate`.
- **Czech command bodies missed.** Generic commands are EN. If you really need a Czech body, copy that specific command back to `dugmate/.claude/commands/<name>.md` — Claude Code prefers local over plugin. Recommended: keep EN.
- **`scenario-runner` doesn't iterate all 5 platforms.** Cause: `platforms` array short. Fix: `maude config set platforms '[...]'`.
- **`.ai/dugmate-*.md` files have stale links to `.claude/commands/`.** Update those to `plugins/flow/commands/` or just remove the path — the command name is what matters.

## Tracker integration (optional)

If you decide to wire dugmate's tracker (currently GitHub Issues) into the flow loop, add the integration block. For dugmate this is minimal because `provider: github` + `gh` CLI covers everything:

```sh
maude config set integrations.tracker.provider github
```

For projects on ClickUp / Linear / Jira / Notion, set the MCP prefix and pour project-specific shape into `defaults`:

```sh
maude config set integrations.tracker.provider clickup
maude config set integrations.tracker.mcp mcp__claude_ai_ClickUp
maude config set integrations.tracker.defaults '{"boardListId":"901519382993","doneStatus":"done","activeStatus":"in progress"}'
```

Anything non-obvious about *why* those values are correct (which list is the source of truth, what the status flow contract is, how milestones nest) belongs in a DDR — see `docs/INTEGRATIONS.md` for the schema → config → DDR pattern.

## When to upstream a dugmate-* rule

If you find yourself writing the same enforcement in dugmate-*-rules that would help generic projects, consider PR'ing the generic version into `flow` plugin's `skills/<topic>-rules/SKILL.md` and reducing the dugmate version to only the project-specific bits (boundary names, custom pulses, etc.).

The skeleton for project-overridable hard-stops is in `plugins/flow/.claude-plugin/config.schema.json` — anything that fits in there as a typed knob is a good upstream target.
