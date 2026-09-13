---
name: smoke
category: validate
description: "Screenshot UI canvases and design specimens to detect blank, broken or unstyled output."
argument-hint: "[--include-system 0|1] [--timeout <secs>] [--out-dir <dir>]"
---

# /design:smoke — batch render check across every canvas

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Wraps the bundled `smoke.sh` helper, invoked via `maude design smoke` (the on-PATH `maude` binary dispatches to it — DDR-062). Single source of truth lives in the helper; this command exists so you can invoke smoke as a slash, and so `/flow:execute` can call it as a phase-end gate.

## When to invoke

**Manually:** any time you want a quick "did I break the iframe?" pass — typically after a dev-server refactor, a bulk migration, or a runtime library change. ~30 s for a project with ~40 canvases.

**Automatic via `/flow:execute` (DDR-021):** the executor runs this at phase-end when the diff matches any of:

- `apps/studio/**` modified
- `<designRoot>/_lib/**` modified
- `plugins/design/templates/canvas*.tsx.template` modified
- ≥ 3 `*.tsx` files mutated under `<designRoot>/` outside a `/design:edit` invocation (bulk migration shape)

Per-canvas hooks (`/design:edit` step 7, `/design:new` step 9, `/design:setup-ds` step 9) already cover single-target work. `/design:smoke` covers the work shapes that bypass them.

## Procedure

1. **Server lifecycle** — `PORT=$(maude design server-up)`.
1a. **Runtime-bundle health** — `maude design runtime-health --port "$PORT" --restart --quiet`. Smoke's whole purpose is "did I break the iframe?" — a stale dev-server serving a defective `/_canvas-runtime/*.js` will produce blanket `ERROR` rows across every canvas with the same `ReferenceError` (and no source change explains it). Probing the runtime bundles first separates "I broke a canvas" from "the server is broken". System-review 2026-05-27 (D-1).
2. **Run smoke** — `maude design smoke [$ARGUMENTS]`.
3. **Read every PNG.** When the report has > 5 canvases, **Read each PNG into the conversation, not a sample.** This is the rule from Phase 3.6.1 retro learning #4 — the agent screenshotted 38 specimens, sampled 3, called it good; user opened `colors-accent` and triple-chrome was pre-attentive in 2 s. Some visual regressions are catchable by human glance and miss-able by sampling. Don't skip.
4. **If exit ≠ 0:**
   - List every failed canvas with its status (`BLANK` / `ERROR`) and detail.
   - Open the failing PNGs (Read them into context).
   - Open the offending canvas source(s) (Read the `.tsx` files).
   - Identify root cause (broken import, undefined ref, dropped CSS, blank mount). Do NOT mark phase complete.
5. **If exit == 0:** print the markdown report path + summary. Note success in the calling context (commit message, phase close-out, etc.).

## Output layout

Helper writes to `<designRoot>/_history/_smoke/<timestamp>/`:

- `<slug>.png` — one screenshot per canvas
- `report.tsv` — tab-separated status/file/screenshot/detail (machine-parseable)
- `report.md` — human-readable table; links every PNG

Path is gitignored under the existing `_history/` pattern.

## Status semantics

| Status | Meaning |
|---|---|
| `OK` | Canvas mounted (any of `[data-dc-screen]` / `[data-dc-slot]` / `[data-cd-id]` present, OR body has text), no visible error overlay, PNG > 2 KB. For preview specimens, also passed the computed-style gate (tokens resolved). |
| `BLANK` | No DC markers and body text empty after `--timeout` seconds. OR PNG < 2 KB. Likely a runtime error broke the React mount before any output. |
| `ERROR` | A visible error overlay was detected (react-error-overlay, body text starting with `Error:`/`SyntaxError:`/`ReferenceError:`). Canvas partially mounted but the page is showing an error. |
| `UNSTYLED` | **(preview specimens only — DDR-068)** Canvas mounted with content and no error, but the DS token contract `--bg-0` does **not** resolve on `<body>` — its import graph lost the token CSS, so every `var()`-driven rule is dead. It *renders*, but unstyled (the exact class the prior `745bcf0` "verified rendering" + the old blank-only smoke both missed). Detail carries the UA-default font as evidence, e.g. `unstyled:no-tokens(ff=Times)`. |

### Import-graph lint (static, pre-render — DDR-068)

Before the render loop, when `--include-system 1`, smoke statically lints the DS preview import graph (the dev-server inlines only the CSS a canvas's imports produce — `canvas-build.ts` — so a forgotten import silently unstyles a specimen that still "has content"):

- **every preview specimen reaches `_layout.css`** — directly via `import`, or via its own co-located CSS `@import`ing it. `_layout.css` is the single CSS entry point that `@import`s the tokens (`colors_and_type.css`) + the controls (`_components.css`).
- **every shared `preview/_*.css` partial has ≥ 1 importer** — no orphan partial (the class of bug where `.btn`/`.input` lived in `_components.css` but nothing imported it, so native controls rendered unstyled everywhere).

Violations print as `LINT-FAIL <file> — …` and land in `report.md`. The lint is anchored to real `^import` lines, so a specimen that *displays* a CSS filename in its content is not a false match.

The helper exits `0` only if every canvas is `OK` **and** the import-graph lint is clean; `3` if any canvas is `BLANK` / `ERROR` / `UNSTYLED` or the lint finds a violation.

## Flags

| Flag | Default | Notes |
|---|---|---|
| `--include-system 0\|1` | `1` | Set `0` to skip `system/*/preview/*.tsx` and only smoke `ui/*.tsx`. Faster when iterating only user canvases. |
| `--timeout <secs>` | `8` | Per-canvas mount poll budget. Bump up for heavy canvases or slow machines. |
| `--out-dir <dir>` | `<designRoot>/_history/_smoke/<timestamp>/` | Override output location (used by `/flow:execute` to land reports in a phase-scoped folder). |
| `--engine auto\|agent-browser\|playwright` | `auto` | Forced fallback. Playwright loses the error-overlay probe (coarser verdict). |
| `--changed-only` | off | **Incremental mode (Phase C / DDR-061).** Screenshot only canvases changed since the last smoke run (baseline recorded in `_history/_smoke/.last-smoke.json`). **Escalates back to the full set** when the diff touches `dev-server/**`, `canvas-lib.tsx`, or a `canvas*.tsx.template` (the "everything could break" shapes). No baseline / no git → full set. Empty change set → exit 0, nothing to screenshot. **`/flow:execute`'s phase-end gate defaults to this**; manual `/design:smoke` and release/CI stay full-set. |

## Examples

```sh
/design:smoke
/design:smoke --include-system 0
/design:smoke --timeout 12 --out-dir .design/_history/_smoke/post-canvas-lib-refactor
```

## Failure modes

- **Server not up** → helper exits 1; run `/design:browse` or any `/design:edit/new` first to boot the server, then re-run.
- **No canvases** (`ui/` and `system/` empty) → helper exits 1 with "no canvases found".
- **`agent-browser` skill unavailable** → helper auto-fallback to playwright. Error-overlay probe is lost; status decision becomes "PNG > 2 KB → OK". Acceptable degraded mode; install agent-browser for full coverage.
- **Smoke reports `BLANK` for a canvas you know renders fine in browser** → bump `--timeout`. Heavy canvases with lazy-mount can miss the 8 s window.

## What `/design:smoke` does NOT do

- Doesn't change `_active.json` (smoke iterates URLs directly; doesn't touch the user's selection).
- Doesn't make a qualitative judgment — no critic, no aesthetic scores. Pure render check.
- Can't do a per-artboard breakdown — that's `/design:screenshot --all-screens` on a specific canvas. Smoke is full-page per file.
- Doesn't save into `_history/<slug>/screenshots/` (= the per-canvas snapshot dir for `/design:edit`). Smoke goes to `_history/_smoke/<timestamp>/` so it doesn't pollute canvas-level history.

## What this loop drills against

The Phase 3.6 + 3.6.1 retros repeatedly documented the same pattern: build green + tests green + scope "infra change, not UI change" → badly broken canvases only surfaced by user-driven exploration. `/design:smoke` is the structural gate that interrupts that pattern at phase-end, not in post-validate triage. See `.ai/archive/decisions/DDR-021-design-smoke-gate-for-infra-and-bulk-ui-work.md`.
