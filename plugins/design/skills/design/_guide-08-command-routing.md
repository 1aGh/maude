## Command routing

### `/design:edit "<feedback>" [--screenshot <path>]` — primary flow

Default. Edits the active canvas inline.

1. Server up + `_active.json` resolved.
2. **If `selected` is non-null AND `selected.file === active`**, build a **scoped prompt** (see "Scoped edit prompt" below). Otherwise build a canvas-wide prompt.
3. If `--screenshot <path>` was passed (or feedback contains a `.png`/`.jpg` path), read it as image input.
4. Read the active canvas file fully.
5. **Snapshot.**
6. Apply edit using the **Edit tool** (preferred — minimal diff). Use Write only if the change spans most of the file.
7. **Validate output:**
   - `<link>` to tokens CSS still present
   - `<body class="<rootClass>" data-theme="…">` still present (rootClass from config)
   - No new hardcoded `#hex` colors, no new `font-family` not using `var(--font-*)`
   - If validation fails, restore from snapshot and report what went wrong.
8. **Confirmation screenshot — always, regardless of `--no-critic`.** See "Post-write reality check" below.
9. **Tell the user.** Print: file edited, line range changed, snapshot id, screenshot path, "reload iframe (Cmd+R inside the canvas tab)".

### Post-write reality check — confirmation screenshot

**Always fires after a successful edit / generate, regardless of `--no-critic`.** This is reality check (does the file render?), not quality check (is it good?). It's cheap, costs one helper call, and is the baseline both critics and rollback compare against.

Single source of truth is `maude design screenshot` (on-PATH `maude` dispatches to the bundled helper — DDR-062). It resolves URL from `_server.json` + `_active.json`, polls for canvas mount (Babel/React takes 2–4 s), selects engine (`agent-browser` > `playwright` fallback), and emits diagnostic on stderr.

```bash
HIST="<designRoot>/_history/$SLUG"
OUT="$HIST/$NNN-baseline.png"
maude design screenshot --full --out "$OUT"
```

Why this step matters:

- **Babel-standalone runtime errors don't surface as HTTP errors** — the file serves 200 even if JSX fails to mount. Without a render check, "wrote 600 lines + 200 OK" is a false positive.
- **Critics already auto-capture if missing**, but `--no-critic` skips the entire loop. Without this step, the user sees no visual confirmation when they explicitly opt out of critique.
- **Rollback diffs need a baseline.** Comparing screenshots across snapshots is only useful if every snapshot has one.

**Lazy-mount + pan-zoom caveat (canvases since commit 7a00561).** `DesignCanvas` has its own pan/zoom viewport and lazy-mounts artboards as they enter view. A single full-page screenshot at default viewport height captures only what's currently positioned in the canvas viewport — typically 1–3 artboards out of 6+. For canvases with > 3 artboards, **per-screen element screenshots are the reliable unit** — use `--all-screens`:

```bash
maude design screenshot \
  --all-screens --out-dir "$HIST" --timeout 10
```

The helper queries `[data-dc-screen],[data-dc-slot]` in the live DOM, scrolls each artboard into view (defeats `DesignCanvas` pan/zoom lazy-mount), and writes `<NNN>-screen-<id>.png` per artboard. Output paths go to stdout (one per line), engine choice + per-screen status on stderr.

**Why per-screen wins for canvases (retro 2026-05-09).** During the iOS Bikeshare Signup session, full-page snapshots showed only 1 of 6 artboards because DesignCanvas pans/zooms its world independently of document scroll. `[data-dc-screen]` element screenshots captured all 6 cleanly. The `--all-screens` mode is the default for `/design:new`.

**Dual-theme DSes need a second pass in the alternate theme (2026-07-08).** A default-theme-only capture cannot catch a token that's frozen at its `:root` value and never redeclared inside the alternate `[data-theme="…"]` block — it renders correctly in the theme you captured and near-invisible/wrong-contrast in the one you didn't (the studyfi-v3 `--fg-0` regression this note exists to prevent). When `config.json`'s `designSystems[<ds>].themes` declares more than one theme, `/design:new` step 9 runs the `--all-screens` capture a second time with `--theme <alternate>` (forces every `[data-theme]` element to that value via a DOM eval, into its own `_history/<slug>/theme-<name>/` subdir) and reads BOTH sets before considering the canvas visually confirmed. `themeDefault` alone can never signal this — its schema enum is `dark|light` only, never `"both"`. See `/design:new` step 9 for the full capture + failure-handling contract.

Failure handling:
- Helper returns exit code 3 → capture failed (empty PNG, selector miss, or engine error). Surface stderr to the user — don't pretend the baseline exists.
- Mount timeout → warn but don't fail the edit. The file already exists; the user can open it manually. Increase `--timeout` for heavy-JS canvases.
- Both engines unavailable → helper exits 1; surface install hint (`agent-browser` or `playwright`) without rolling back the edit.

Output is gitignored (lives under `_history/`), and is referenced from the iteration's chat.md row as `**Baseline:** {path}`.

### Scoped edit prompt (when `selected` is set)

When the user Cmd+Clicked an element first, narrow your edit:

```
You are editing ONE specific element in <active_path>. The user has the following element selected:

  selector: <selected.selector>
  tag:      <selected.tag>
  classes:  <selected.classes>
  text:     "<selected.text>"
  dom path: <selected.dom_path joined with " > ">
  bounds:   x=<x>, y=<y>, w=<w>, h=<h>
  outerHTML (truncated):
  ```
  <selected.html>
  ```

User feedback:
<feedback>

Apply the change to that element only — match the selector / dom path. Do NOT modify other parts of the file unless the feedback explicitly says so. Preserve token usage, semantics, and the surrounding layout.
```

Use the Edit tool with `old_string` matching a unique substring of the selected element's HTML. If the outerHTML appears multiple times verbatim, fall back to the longer dom-path match (find the parent context that disambiguates).

**Selection screenshot is mandatory** before building the scoped prompt. The selection JSON gives you WHAT (selector + outerHTML + bounds); only a screenshot gives you WHERE-IN-CONTEXT (neighbors, alignment, the visual conversation the element is part of). Call `maude design screenshot --full --out "<out>"` (plus an `--element <id>` shot when the selector contains `data-dc-element="…"`) and `Read` the PNG into your context BEFORE the Edit tool call. See `/design:edit` step 3.5 for the canonical snippet. Editing from JSON describe alone is *tapping in the dark*; the studio iter-4 sidebar-active-item incident (3 rollback iterations before landing) is the canonical cost of skipping. Reference: `.ai/logs/system-reviews/design-edit-screenshot-habits-review.md`.

### `/design:new <name> "<brief>"` — scaffold new canvas project

Creates a brand-new TSX canvas file in `<designRoot>/<newCanvasDir>/<Name>.tsx` (or `<newComponentDir>/<Name>.tsx` if the user explicitly says component). TSX is the only supported canvas format; envelope primitives import from `@maude/canvas-lib` (virtual specifier → the dev-server-bundled canvas-lib at `apps/studio/canvas-lib.tsx`). Generated via the `frontend-design` Skill (preferred) or the orchestrator's direct authoring (documented fallback) — see "Generation invocation" in Cross-skill calls.

**The new file MUST be a multi-artboard canvas project**, not a single-page wrapper. It uses the `DesignCanvas` + `DCSection` + `DCArtboard` pattern (see existing examples in `<designRoot>/ui/`) so multiple screens live in one panable canvas. A bare single-page wrapper is an anti-pattern unless the user explicitly says so.

1. Validate `<name>`:
   - For canvas project: title-case with optional spaces (`Match Recap`, `Scout Radar`). File: `<Name>.tsx`.
   - For shared component: PascalCase (`MatchRecap`). File: `<newComponentDir>/<Name>.tsx`.
2. Reject if file already exists. Suggest `<Name> v2`.
3. **Build the envelope** following "Envelope discipline" — creative brief, not wireframe spec. Include the aspiration directives 9–14 verbatim. Reference at least one existing canvas as wrapper pattern.
4. **Generate** via the preferred path; fall back transparently if the Skill is unavailable. Always note which path was taken in the final report.
5. Validate output (link to tokens, correct rootClass, no hardcoded values, includes at least one `DCArtboard`).
6. Write the file.
7. **Post-write reality check** — capture confirmation screenshot (see "Post-write reality check" above). Same guarantees as `/design`: always fires, even with `--no-critic`. For canvases with > 3 artboards, scroll all artboards into view first (see "Lazy-mount caveat") or explicitly state in the report that the snapshot covers only the first ~3.
8. **Auto-critic loop — `/design:new` defaults to `--perfect`** (max 8 iter, target 4.5/5, full panel: signature-moment + design + frontend + a11y). Higher bar than `/design` because new canvases are high-leverage scaffolds. Opt-out flags: `--quick` (signature-moment only, 2 iter), `--no-critic` (skip), `--perfect-iter N` (override iter count). See "Default flow vs. --perfect" table for the full matrix and "Auto-critic loop" for stop conditions.
9. Print path + generation path used + screenshot path + critic mode + verdict + "click on it in the browser tree to make it active, then iterate with /design".

### `/design:rollback [--steps N] [--list]` — undo

Restores the last snapshot of the active canvas. With `--steps N`, restores N back. `--list` prints history without restoring.

1. Read `_active.json.active` → file path.
2. Compute `<slug>` and look in `_history/<slug>/`.
3. List snapshots, sorted descending. Take element [N-1] (default N=1 = most recent).
4. **Snapshot the CURRENT state first** (rollback is itself reversible).
5. Copy chosen snapshot back over the canvas file.
6. Print: which snapshot restored, current snapshot count.

### `/design:screenshot` — capture

Operates on `_active.json`. Output goes to `_history/<slug>/screenshots/<NNN>-<area>.png` (gitignored). Flags: `--screen <id>`, `--element <id>`, `--selector <css>`, `--full` (default), `--all-screens`, `--area <label>`.

All paths funnel through the canonical helper:

```bash
maude design screenshot --full --out "<out>"
maude design screenshot --screen <id> --out "<out>"
maude design screenshot --all-screens --out-dir "<dir>"
```

The helper picks `agent-browser` first, falls back to `npx playwright`, polls for canvas mount, and verifies PNG size > 0 before returning. Inline `agent-browser navigate + screenshot` blocks are deprecated — use the helper everywhere.

If `_active.json.selected` is set and the user passed no flag, default to `--element <id>` when the selected element has `data-dc-element="…"`, otherwise fall through to `--selector "<saved-selector>"`. The screenshot is scoped to the focused element.

### `/design:critic` — review by specialist agents

Spawns one or more `*-critic` subagents against the active canvas. Each subagent reads:

- The canvas file
- Latest screenshot (or captures one first via `/design:screenshot`)
- The project's tokens CSS at `<designRoot>/<tokensCssRel>` and any sibling `README.md`
- The corresponding domain rules skill, if present (e.g. `<project>-a11y-rules`, `<project>-motion-rules`)
- If `selected` is set, includes selector + dom_path so critique can be element-scoped

Each critic emits a JSON verdict block at the bottom of its report — that's the orchestrator-readable signal:

```json
{ "agent": "<name>", "iter": N, "blockers": X, "warnings": Y, "top_blockers": [...], "passed": (X == 0) }
```

**Modes:**
- **No flag** → orchestrator-routed panel (see "Critic panel routing" below). The default.
- **`--agent <name>`** → just that one critic.
- **`--all`** → every critic in parallel (heavy — uses many tool calls).
- **`--panel`** → alias for default.

Output: `<designRoot>/_history/<slug>/critique/<NNN>-<agent>.md` per critic. A `<NNN>-PANEL.md` consolidation is written when 2+ critics ran (top blockers across all critics, who flagged what).
