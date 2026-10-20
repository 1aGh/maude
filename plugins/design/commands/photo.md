---
name: photo
category: daily
description: "Adjust or retouch a canvas photo, apply masks, or remove its background."
argument-hint: "--asset <assets/<sha8>.<ext> | <sha8>> [--remove-bg] [--brightness N] [--contrast N] [--saturation N] [--exposure N] [--hue N] [--sepia N] [--grayscale N] [--invert N] [--duotone \"#aabbcc,#ddeeff[,intensity]\"] [--grain \"amt[,size]\"] [--pattern \"type[,scale,opacity,blend]\"] [--mask \"preset[,strength]\"] [--replace|--reset]"
---

# /design:photo — headless photo editing

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Applies a **non-destructive** edit to a photo already in the active canvas — an `<img>` authored in an artboard, or an `ImageStroke` dropped/pasted into the annotation layer. Every edit is stored as a `PhotoEdit` sidecar (`<designRoot>/assets/<sha8>.photo.json`) that the canvas-lib `<PhotoLayer>` WebGL compositor renders live. **The whole point is drivability:** an agent tunes a photo without clicking a slider.

**This command changes every use of the photo.** The sidecar `assets/<sha8>.photo.json` is the photo's every-use look, so each canvas that shows the photo changes with it. An edit to one use only is a different file: see "One use only" below.

Two paths, by cost:
- **Parametric** (adjustments / duotone / grain / pattern / mask) — pure JSON, written by `maude design photo-adjust`. No browser.
- **Background removal** (`--remove-bg`) — runs on this Mac (`@imgly/background-removal`, WASM/WebGPU, zero native deps) through a headless harness via `maude design photo-bg-remove`, stores the cutout as a mask on top of the photo and points `PhotoEdit.backgroundRemoved.maskAsset` at it. Non-destructive + toggle-able; the original is kept.

Project-specific values (designRoot) come from `<repo>/.design/config.json`.

## Flags

| Flag | What it does |
|---|---|
| `--asset <path\|sha8>` | **Required.** The source photo — `assets/<sha8>.<ext>`, `<sha8>.png`, or bare `<sha8>`. |
| `--remove-bg` | Remove the background (client-side ML). Toggle-able; the original is retained. |
| `--brightness/--contrast/--saturation/--exposure N` | Tonal adjustments. Normalized −1…1, `0` = neutral. |
| `--hue N` | Hue rotation, −180…180 degrees. |
| `--sepia/--grayscale/--invert N` | Amount 0…1, `0` = off. |
| `--duotone "#aabbcc,#ddeeff[,intensity]"` | Two-color luminance remap (shadow→highlight); intensity 0…1. |
| `--grain "amt[,size]"` | Film grain — amount 0…1, optional grain size ≥ 1. |
| `--pattern "type[,scale,opacity,blend]"` | Overlay: `dots\|grid\|lines\|diagonal\|crosshatch`, blend `normal\|multiply\|screen\|overlay\|soft-light`. |
| `--mask "preset[,strength]"` | Preset mask: `vignette\|radial-reveal\|edge-fade`, strength 0…1. |
| `--replace` | Overwrite the sidecar instead of merging onto the current edit. |
| `--reset` | Clear the sidecar to neutral (unedited). |

Parametric flags **merge** by default (successive `/design:photo` calls accumulate). `--remove-bg` composes with parametric flags in one invocation.

## Flow

### 0. Pre-flight

```bash
REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
maude design bootstrap-check --root "$REPO"    # 0 = DS present; 10/11 = needs /design:setup-ds
eval "$(maude design prep --shell-export --shape edit --root "$REPO")"   # config + active-canvas + server probe
PORT=$(maude design server-up --root "$REPO")  # Maude must be running (the edit and the harness need it)
```

If `bootstrap-check` returns 10/11 → **stop**, print `Run /design:setup-ds <name> first`.

### 1. Resolve the target asset

- If `--asset` is given, use it verbatim.
- Otherwise, resolve from the active selection (`_active.json` → `selected`): an artboard `<img>`'s `src` or an annotation `ImageStroke`'s `href` — both are `assets/<sha8>.<ext>`. If no photo is selected, **stop** and ask which asset.

### 1.5. Check where the photo is used

```bash
maude design assets --usage "$ASSET"
```

It lists the canvases that show the photo. When more than one does, say which canvases will change and ask before going on. When any of them is a canvas the person cannot edit (Can view or Can comment), stop: the edit is refused for them on the server, and it must not be done by writing the file. A photo used once changes only where it is used.

### 2. Dispatch

**Background removal** (only when `--remove-bg` is present):

```bash
MATTE=$(maude design photo-bg-remove --asset "$ASSET" --root "$REPO")   # prints assets/<sha8>.png
```

This drives the headless harness (`@imgly` inference on this Mac), stores the matte as an asset, and writes `backgroundRemoved` into the sidecar. It is the ONE path that needs a browser round-trip — parametric edits never do.

**Parametric edits** (any of the adjustment/duotone/grain/pattern/mask flags):

```bash
SIDECAR=$(maude design photo-adjust --asset "$ASSET" --root "$REPO" \
  [--contrast 0.3] [--duotone "#1a1a2e,#e94560,0.8"] [--grain 0.4] [--mask "vignette,0.6"] …)
# prints assets/<sha8>.photo.json
```

Pass through only the flags the user supplied. `photo-adjust` merges onto the current sidecar (or `--replace`/`--reset`). Maude validates every field (ranges, the asset name, the size) — a rejected edit exits non-zero with the reason.

### 3. Report

Print what changed: the sidecar path, the fields set, and (if `--remove-bg`) the matte asset. The live `<PhotoLayer>` re-composites automatically on the next canvas render — no manual refresh. Suggest `/design:screenshot --element <id>` to capture the result, or `/design:photo --asset <same> --reset` to revert.

## One use only

To change one use of a photo and leave the others as they are, write the edit as a file, as the Photo section does: a per-use `PhotoEdit` at `assets/<img8>.<edit8>.photo.json` and `data-photo-edit="<edit8>"` on that `<img>` (the `design` skill, "Edit this use of the photo"; its row in the `studio-actions` skill has the exact steps). Removing the attribute shows the every-use look again. "Apply to every use…" is the same edit written as `assets/<sha8>.photo.json`, which is what this command does.

## Notes

- **Non-destructive:** the source pixels are never modified. Everything lives in the sidecar; `--reset` restores the untouched photo, and `--remove-bg` is a toggle (the matte is retained when disabled).
- **Never** the Node/native `@imgly/background-removal-node` variant — background removal is browser/WASM only (the `sharp`/native-addon exclusion, DDR-070).
- Human-clickable equivalent: the **Photo** section of the inspector (Adjust…) edits this one use. **Apply to every use…** opens a sheet naming each canvas it would change, and then does what this command does.
