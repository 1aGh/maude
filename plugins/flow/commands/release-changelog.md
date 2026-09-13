---
name: release-changelog
type: command
category: release
description: "Write a changelog entry using the project changelog conventions."
keywords: [changelog, release-note, changeset, release, version-bump, semver]
---

# /flow:release-changelog — author a release-note entry

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Provider-dispatched authoring command. Reads `integrations.changelog.provider` from `.ai/workflows.config.json` and routes to the right tool. Phase 3 implements the `changesets` provider end-to-end; other enum values stub to a "not yet implemented" message.

This is the sibling authoring command to the parent `/flow:release` runbook walker. Run `/flow:release-changelog` to record _what_ shipped; run `/flow:release` to actually cut the release.

## Process

### 1. Read provider from config

```bash
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CONFIG="$REPO_ROOT/.ai/workflows.config.json"

if [[ ! -f "$CONFIG" ]]; then
  echo "No .ai/workflows.config.json — run /flow:init first."
  exit 1
fi

PROVIDER="$(jq -r '.integrations.changelog.provider // "none"' "$CONFIG")"
SCOPE="$(jq -r '.integrations.changelog.scope // empty' "$CONFIG")"
```

### 2. Dispatch on provider

#### Provider = `none`

```
No changelog provider configured. Set `integrations.changelog.provider`
in `.ai/workflows.config.json` (e.g. `changesets`), or run /flow:init
to auto-detect.
```

Exit 0.

#### Provider = `changesets`

##### 2a. Detect existing init

```bash
if [[ ! -f "$REPO_ROOT/.changeset/config.json" ]]; then
  echo "No .changeset/ found. Bootstrap with @changesets/cli? [y/N]"
  # If y:
  #   Detect package manager (pnpm-lock.yaml → pnpm, yarn.lock → yarn, else npm)
  #   Run: <pm> dlx @changesets/cli init
  # If N: print "Aborted — author your changelog entry manually." and exit 0
fi
```

Auto-detect package manager:

```bash
if   [[ -f "$REPO_ROOT/pnpm-lock.yaml" ]];   then PM="pnpm"
elif [[ -f "$REPO_ROOT/yarn.lock" ]];        then PM="yarn"
elif [[ -f "$REPO_ROOT/package-lock.json" ]]; then PM="npm"
else PM="npm"  # safe fallback
fi
```

Then prompt before running:

> About to run `<PM> dlx @changesets/cli init`. This adds `.changeset/`
> and a default `config.json`. Proceed? [y/N]

##### 2b. Interactive prompt

Ask the user three things (in this order):

1. **Bump type** — `patch` / `minor` / `major`. Default `patch`. (For breaking changes always escalate to `major`; for non-user-visible internal cleanup, ask whether to skip authoring entirely.)
2. **Summary** — multi-line free text. First line becomes the headline (will appear in the published CHANGELOG); subsequent lines = details. Keep tense imperative ("Add X" not "Added X") to match Changesets' rendering.
3. **Affected packages** — auto-suggest from `package.json` `workspaces` (or the single root package). Pre-fill with `integrations.changelog.scope` if set in config. Allow comma-separated list.

```bash
# Resolve candidate package names from workspaces
PACKAGES="$(jq -r '.workspaces[]? // empty' "$REPO_ROOT/package.json" 2>/dev/null \
  | xargs -I {} jq -r '.name // empty' "$REPO_ROOT/{}/package.json" 2>/dev/null \
  | grep -v '^$')"
# Single-package repos: PACKAGES = root .name
if [[ -z "$PACKAGES" ]]; then
  PACKAGES="$(jq -r '.name // empty' "$REPO_ROOT/package.json")"
fi
```

##### 2c. Write the changeset file

```bash
SLUG="$(echo "$SUMMARY_FIRST_LINE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\+/-/g;s/^-//;s/-$//' | cut -c1-40)"
FILE="$REPO_ROOT/.changeset/${SLUG}.md"
```

File contents:

```markdown
---
"<pkg-name-1>": <bump>
"<pkg-name-2>": <bump>
---

<headline summary line>

<body details, if provided>
```

After writing, print:

```
✓ Wrote .changeset/<slug>.md
  bump: <type>
  packages: <list>

Next: continue your work, or run /flow:done to ship.
```

#### Provider in (`git-cliff`, `conventional`, `custom`)

```
Provider `<name>` is not yet implemented in /flow:release-changelog.
Track in a follow-up PR. For now: author your changelog entry manually
using your provider's normal flow (e.g. `git cliff --bump`,
`npm version <patch|minor|major>`, or your custom script).
```

Exit 0. **Do not** attempt provider-specific dispatch — this is the holding pattern until each provider gets its own end-to-end implementation.

## Validation matrix

| Provider | `.changeset/` present? | Expected behaviour |
|----------|------------------------|--------------------|
| `none` | n/a | Print config hint, exit 0 |
| `changesets` | yes | Skip bootstrap → ask 3 questions → write `.changeset/<slug>.md` |
| `changesets` | no | Offer to run `<pm> dlx @changesets/cli init` → then proceed as above |
| `git-cliff` | n/a | Print "not yet implemented", exit 0 |
| `conventional` | n/a | Print "not yet implemented", exit 0 |
| `custom` | n/a | Print "not yet implemented", exit 0 |

## Notes

- The provider abstraction is in `.ai/workflows.config.json` — never hardcode "changesets" anywhere in this command's prose other than inside the `changesets` branch.
- This command is non-destructive. It writes one new file under `.changeset/`. It never edits existing files (including `CHANGELOG.md`) — that's `<pm> changeset version`'s job, run by `/flow:release` (or CI on tag push).
- If you need to switch providers later, write a DDR (`/flow:record-ddr "switch changelog provider"`) before changing `integrations.changelog.provider`.
