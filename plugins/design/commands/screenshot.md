---
name: screenshot
category: daily
description: "Capture the active canvas, one artboard, an element or all screens."
argument-hint: "[--screen|--element <id> | --selector <css> | --full | --all-screens | --shell] [--area <n>]"
---

# /design:screenshot — capture active canvas

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Opens the active canvas (`_active.json`) via the server URL (not `file://`), captures a screenshot and saves it under the conversation's run folder, `<RUN>/shots/<NNN>-<area>.png` (runtime state, never versioned).

The single source of truth for the screenshot logic is `maude design screenshot` (the on-PATH `maude` dispatches to the bundled helper — DDR-062). This command just maps the slash-command flags to the helper and resolves the output file path.

**Input `$ARGUMENTS`:**

| Flag | What it does |
|---|---|
| `--full` *(default)* | Whole page. |
| `--screen <id>` | Only the artboard with `data-dc-screen="<id>"` (Phase 13 convention) or `data-dc-slot="<id>"` (legacy). |
| `--element <id>` | Only the element with `data-dc-element="<id>"`. |
| `--selector <css>` | Custom CSS selector (power-user — prefer `--screen`/`--element` where possible). |
| `--all-screens` | Loops over every artboard, saving `<NNN>-screen-<id>.png` into the run folder's `shots/`. |
| `--shell` | The studio itself instead of a canvas: panels, toolbar and the AI chat panel are in frame. For reporting a bug in Maude, not for design review. |
| `--area <name>` | Label for the single-shot output (default `full`). Examples: `roster-row`, `top-bar`. |

**Examples:**
```
/design:screenshot
/design:screenshot --screen onboarding-welcome
/design:screenshot --element cta-primary
/design:screenshot --all-screens
/design:screenshot --selector ".roster-row:nth-child(1)" --area roster-row
```

## Procedure

Invoke skill `design` with the input: `screenshot $ARGUMENTS`.

The skill:

1. **Server lifecycle** — `PORT=$(maude design server-up)`.
2. **Parse args** — extract one of the single-shot modes, `--all-screens`, `--area`.
3. **Run folder** — the design plugin's hook names it once per conversation, in a line like `Maude run folder for this conversation: .design/_runs/<session>/`. Use that folder as `RUN`; no such line (hooks off) → `RUN=.design/_runs/local/`. Then `mkdir -p "$RUN/shots"`.
4. **Output path:**
   - Single-shot: `OUT="$RUN/shots/<NNN>-$AREA.png"`, where `NNN` is next in the sequence for that area (no colliding names).
   - `--all-screens`: `OUT_DIR="$RUN/shots/"`; the helper creates `NNN-screen-<id>.png` itself.
5. **Call the helper:**
   ```bash
   maude design screenshot \
     --screen "$SCREEN_ID" --out "$OUT"
   # or
   maude design screenshot \
     --all-screens --out-dir "$OUT_DIR"
   ```
   The helper resolves the URL from `_server.json` + the open canvas (`_active.json`) itself and picks the engine (`agent-browser` > `playwright` fallback). Diagnostics go to stderr, written paths to stdout — composable.
6. **Print to the user** the path(s) to the PNG. If `--all-screens` wrote < 1 file (capture failed), surface the failure instead of a silent OK.

## Tip — annotation loop for pin-comments (Claude Design style)

If you want to annotate a specific spot:

1. `/design:screenshot --element <id>` or `--selector <css>` for the crop.
2. Open the PNG in an image editor → circle it → save.
3. `/design:edit "<specific feedback>" --screenshot <path-to-annotated-image>`.

## Failure modes

- **`_active.json` missing / `active = null`** → the helper fails: open a canvas first (or pass `--canvas`).
- **Server not responding to `/_health`** → `server-up.sh` exits 1 pointing at `$DESIGN_ROOT/_server.log`.
- **Selector doesn't match** → the helper detects it (PNG < 1 KB or an error from agent-browser), exits 3 with a diagnostic. Does NOT do a silent "success".
- **`agent-browser` skill unavailable** → the helper auto-falls back to `npx playwright` (the first run installs Chromium ~150 MB).

## What `/design:screenshot` does NOT do

- Doesn't modify the canvas — it only reads.
- Doesn't modify `_active.json`.
- Doesn't create a version: it writes only into the run folder.

Screenshot by default, often — it's free, and image input is indispensable for the `/design:edit "..." --screenshot` annotation loop and for `/design:critic`.
