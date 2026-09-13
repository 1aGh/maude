---
name: release
type: command
category: daily
description: "Follow the project release runbook and its action approval gates."
keywords: [release, runbook, ship, publish, tag, version-bump, version, cut]
---

# /flow:release — walk the release runbook

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Reads the project-owned release runbook at `integrations.changelog.releaseGuide` (default `.ai/release-guide.md`) and walks it step-by-step. **Never auto-runs** — every shell command is gated behind explicit `[run] / [skip] / [edit] / [abort]` confirmation.

The runbook is plain Markdown. Each `##` heading is a step. Each ` ```bash ` fenced block under that step is a candidate command. Provider-specific bash is the user's responsibility — `/flow:release` doesn't know what "release" means in your project; it just walks the file.

## Process

### 1. Resolve runbook path

```bash
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CONFIG="$REPO_ROOT/.ai/workflows.config.json"

GUIDE_PATH="$(jq -r '.integrations.changelog.releaseGuide // ".ai/release-guide.md"' "$CONFIG" 2>/dev/null)"
GUIDE="$REPO_ROOT/$GUIDE_PATH"

if [[ ! -f "$GUIDE" ]]; then
  echo "No release guide found at $GUIDE_PATH."
  echo "Run /flow:init to scaffold one, or create the file manually."
  echo "(The runbook is plain Markdown — see plugins/flow/templates/ai-skeleton/release-guide.md for the structure.)"
  exit 1
fi
```

### 2. Parse the runbook

Split the file by `##` headings. For each step:

- Step title = the heading text.
- Step prose = everything between the heading and the next fenced block (or next heading).
- Candidate commands = each ` ```bash ` block under that step (in order).

Checkbox items (`- [ ]`) are treated as **prose** — render them, don't execute them. They're for the user's eyes, not the runner.

### 3. Walk the steps

For each step in order:

1. Print the step title + prose verbatim.
2. For each bash block under that step:
   - Print the command (4-space indented, syntax-highlighted if the harness supports it).
   - Prompt: `[run] / [skip] / [edit] / [abort]`. **Default = skip** (safety: an accidental Enter doesn't fire a release command).
   - On **`[run]`**: execute via the Bash tool (foreground, stream output). After completion, report exit code and whether to continue:
     - exit 0 → continue to next block / step.
     - non-zero → ask: `[retry] / [skip-rest-of-step] / [abort]`.
   - On **`[skip]`**: print "  → skipped" and continue.
   - On **`[edit]`**: prompt for a replacement single-line command. Re-prompt the same loop with the new command (do not silently fall through to run).
   - On **`[abort]`**: jump to Step 4 (recap), exit cleanly.
3. After all blocks for a step → print "  ✓ step done" (or "  ⏭ step skipped" if every block was skipped).

### 4. Recap

At the end (whether `[abort]` or natural completion), print:

```
## /flow:release recap — <YYYY-MM-DD HH:MM>
Guide:        $GUIDE_PATH
Result:       <completed | aborted at "<step name>">
Steps run:    <N> / <M>   (✓ <step-1>, ✓ <step-2>, ⏭ <step-3>, …)
Commands run: <K>   (✓ <K-pass>, ✗ <K-fail>)
Aborted at:   <step name + command, if applicable>

Hint: if this release went smoothly, consider updating the runbook to
reflect any [edit] swaps — that's how the file stays current.
```

## Safety

- **Never auto-run.** Every command is gated. The default selection is always `skip` so an accidental Enter is safe.
- **Untrusted-but-surfaced.** The runbook is user-authored — we don't sandbox commands, but we also don't fabricate them. What you see in the file is what gets prompted, verbatim.
- **No side-effects from the walker itself.** Parsing failures, missing files, and bogus paths produce error messages, never partial execution.
- **`[abort]` is always clean.** It stops at the current command, prints the recap, exits 0. No half-states.

## Provider awareness

`/flow:release` is **provider-agnostic** by design — the runbook supplies provider-specific commands; the walker just orchestrates. This is the load-bearing decision: it means adding a new changelog provider (`git-cliff`, `conventional`, `custom`, …) is a **documentation** change (update the skeleton's stub in `cli/commands/init.mjs`), not a code change to `/flow:release`.

Phase 3 ships the `changesets` stub end-to-end via `maude init --provider changesets`. Other providers land their stubs in follow-up PRs.

## Notes

- The runbook is yours. Edit it freely. `maude init` only scaffolds the initial structure; subsequent runs of `/flow:release` always read whatever's currently on disk.
- For non-trivial release flows (multi-package monorepos, manual smoke gates, staged publishes), consider splitting into multiple `##` steps so each can be skipped/aborted independently rather than one giant bash block.
- If a step's commands depend on the previous step's success, write that into the prose (`- [ ] Confirm CI green before continuing`) — the walker won't enforce step ordering; that's the runbook author's call.
