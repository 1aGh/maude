---
name: release
type: command
category: daily
description: "Follow the project release runbook and its action approval gates."
argument-hint: "[--changelog]"
keywords: [release, runbook, ship, publish, tag, version-bump, version, cut, changelog, changeset, release-note]
---

# /flow:release — walk the release runbook

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Two lanes: the default walks the project-owned runbook at `integrations.changelog.releaseGuide` (default `.ai/release-guide.md`); **`--changelog`** only authors a release-note entry (what shipped) and exits. `$ARGUMENTS` containing `--changelog` selects that lane; otherwise walk the runbook.

**Never auto-runs** — every shell command is gated behind `[run] / [skip] / [edit] / [abort]`. The runbook is plain Markdown: each `##` heading is a step, each ` ```bash ` block a candidate command. Provider-specific bash is the user's responsibility; `/flow:release` only walks the file.

## Process (default lane)

### 1. Resolve the runbook

```bash
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
GUIDE_PATH="$(jq -r '.integrations.changelog.releaseGuide // ".ai/release-guide.md"' "$REPO_ROOT/.ai/workflows.config.json" 2>/dev/null)"
GUIDE="$REPO_ROOT/$GUIDE_PATH"
[[ -f "$GUIDE" ]] || { echo "No release guide at $GUIDE_PATH. Run /flow:init to scaffold one (see plugins/flow/templates/ai-skeleton/release-guide.md)."; exit 1; }
```

### 2. Changelog check (before walking)

Read `integrations.changelog.provider`. If it is `changesets` and the branch has no new `.changeset/*.md`, offer `/flow:release --changelog` first (section below); declining is allowed and not recorded as a failure. Other providers: nothing to do here — the runbook owns them.

### 3. Parse the runbook

Split by `##` headings. Step title = heading; prose = text up to the next block or heading; candidate commands = each ` ```bash ` block in order. Checkbox items (`- [ ]`) are prose: render, never execute.

### 4. Walk the steps

For each step, in order:

1. Print the title + prose verbatim.
2. For each bash block: print the command, then prompt `[run] / [skip] / [edit] / [abort]`. **Default = skip** (an accidental Enter must not fire a release command).
   - **run** → execute via Bash (foreground, streamed). Exit 0 → continue; non-zero → ask `[retry] / [skip-rest-of-step] / [abort]`.
   - **skip** → print "  → skipped", continue.
   - **edit** → prompt for a replacement single-line command and re-run the same prompt loop with it (never fall through to run).
   - **abort** → jump to the recap and exit cleanly.
3. After the blocks: "  ✓ step done" (or "  ⏭ step skipped" if every block was skipped).

### 5. Recap

On abort or completion print:

```
## /flow:release recap — <YYYY-MM-DD HH:MM>
Guide:        $GUIDE_PATH
Result:       <completed | aborted at "<step name>">
Steps run:    <N> / <M>   (✓ <step-1>, ⏭ <step-2>, …)
Commands run: <K>   (✓ <K-pass>, ✗ <K-fail>)
Aborted at:   <step name + command, if applicable>

Hint: if the release went smoothly, fold any [edit] swaps back into the runbook.
```

## `--changelog` — author a release-note entry

Non-destructive: writes one new file, never edits existing ones (including `CHANGELOG.md`; `<pm> changeset version` does that during the runbook or in CI). Switching providers later needs a DDR first (`/flow:record-ddr "switch changelog provider"`).

1. Read `integrations.changelog.provider` and `.scope` from `.ai/workflows.config.json` (missing config → "run /flow:init first", exit).
2. Dispatch:
   - **`none`** → print "No changelog provider configured. Set `integrations.changelog.provider` (e.g. `changesets`) or run /flow:init", exit 0.
   - **`git-cliff` / `conventional` / `custom`** → print "Provider `<name>` is not yet implemented in /flow:release --changelog; author the entry with your provider's normal flow (`git cliff --bump`, `npm version …`, your script)", exit 0. No provider-specific dispatch.
   - **`changesets`**:
     1. No `.changeset/config.json` → detect the package manager (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm) and ask: _"About to run `<PM> dlx @changesets/cli init`. Proceed? [y/N]"_. N → "Aborted — author your changelog entry manually", exit 0.
     2. Ask in order: **bump type** (`patch` default / `minor` / `major`; breaking → `major`; for non-user-visible cleanup ask whether to skip authoring), **summary** (multi-line; first line is the published headline; imperative tense, "Add X" not "Added X"), **affected packages** (suggest from `package.json` `workspaces`, else the root name; pre-fill `integrations.changelog.scope`; comma-separated).
     3. Write `.changeset/<slug>.md` (slug = lowercased headline, non-alphanumerics → `-`, ≤ 40 chars): frontmatter `"<pkg>": <bump>` per package, then the headline line and any body.
     4. Print `✓ Wrote .changeset/<slug>.md` with bump and packages; next: continue work, or `/flow:done`.

## Safety

- **Never auto-run.** Every command is gated; default is skip.
- **Verbatim.** The runbook is user-authored: no sandbox, but no fabricated commands either — what you see is what gets prompted.
- **No side effects from the walker.** Parse failures, missing files and bogus paths produce error messages, never partial execution.
- **Abort is clean.** It stops at the current command, prints the recap, exits 0.
- **Provider-agnostic.** The runbook supplies provider commands; a new provider is a documentation change (the skeleton stub in `cli/commands/init.mjs`), not a change to this walker. Step order is the runbook author's job — write dependencies into the prose.
