---
name: export
category: daily
description: "Export a canvas to images, documents, slides, video or a handoff bundle."
argument-hint: "<png|pdf|svg|html|pptx|mp4|gif|webm|canva|zip> [--scope selection|artboard|canvas-as-separate|project-raw] [--out <path>] [--option key=value]"
---

# /design:export — export active canvas

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Sends a request to the running dev-server (`POST /_api/export`) with the same payload the ⌘E dialog inside the canvas sends. The server writes the file and this slash command pulls it down to disk (default cwd, or `--out <path>`).

**Prerequisite:** the dev-server is running (`maude design serve` or `/design:new` brings it up). The slash command reads the port from `.design/_server.json`.

## Input `$ARGUMENTS`

| Flag | Meaning |
|---|---|
| `<format>` (required) | `png` / `pdf` / `svg` / `html` / `pptx` / `mp4` / `gif` / `webm` / `canva` / `zip` |
| `--scope <s>` | `selection` / `artboard` / `canvas-as-separate` / `project-raw`. Default = `canvas-as-separate` for element-shape formats, `artboard` for the temporal formats (`mp4`/`gif`/`webm`), `project-raw` for `zip`. |
| `--out <path>` | Where to write. Default = cwd + the filename the server returns in `Content-Disposition`. |
| `--option key=value` | Per-format option. Can be repeated. Examples: `--option pageFit=a4` (PDF), `--option mode=raster` (Canva → legacy raster bundle), `--option include=system` (ZIP filter), `--option fps=30` / `--option durationMs=4000` / `--option gifColors=128` (MP4/GIF/WebM), `--option dpi=300` (PNG — feature-2-print-artboards T4), `--option marks=crop,registration` / `--option includeBleed=true` (PDF — T5), `--option text=outline` (PDF — issue #116). |

**Print options (feature-2-print-artboards).**

- **PNG `dpi`** — `96` / `150` / `300` / `600` (snaps to the nearest preset). Wins over the legacy `scale` option when both are given (`exporters/png.ts` `resolveDeviceScale`). `deviceScaleFactor = dpi / 96`; output larger than 16,000 px on a side or ~600 MB is rejected with a message naming the max supported DPI for that artboard size.
- **PDF `dpi`** — same `96`/`150`/`300`/`600` ladder, but a DIFFERENT meaning than for PNG: the PDF page itself is always vector (text/shapes never rasterize regardless of this option), but any RASTER content on the artboard — a dropped photo, a large-format piece authored at a fraction of its real physical size (e.g. a billboard laid out at 1:10 scale) — still embeds as a bitmap, and `dpi` sets that bitmap's capture density (`exporters/pdf.ts` `resolvePdfDeviceScale`). Default (omitted) is unchanged 1× — deliberately NOT the PNG adapter's 2× default, since a plain "just export a PDF" call shouldn't silently double every embedded image's weight.
- **PDF `includeBleed`** — `true` (default when the artboard's own `print` prop has `bleedMm > 0`) / `false`. Only meaningful for a `kind="print"` artboard — a no-op on any other artboard.
- **PDF `marks`** — comma-separated: `crop`, `registration` (MVP scope; `colorBars` / `pageInfo` are accepted but not yet drawn). Building the request body: `--option marks=crop,registration` becomes `options.pdfPrint.marks = { crop: true, registration: true }` — the flat `--option` flags collapse into ONE nested `pdfPrint` object in the JSON POST body (`{ includeBleed, marks: {crop, registration, colorBars, pageInfo} }`), not four separate top-level keys. `dpi`/`pageFit` stay TOP-LEVEL options (unrelated to `pdfPrint` — `dpi` is raster-content density regardless of kind, `pageFit` is the non-print-artboard scale-to-paper path).
- **PDF `text`** — `keep` (default) / `embed` / `outline`. **TOP-LEVEL**, like `dpi` and `pageFit`, NOT inside `pdfPrint`: a plain non-print PDF can carry unprintable fonts just as easily as a leaflet can, so this is not gated on print options being present.

  Chromium's `page.pdf()` emits **Type 3** fonts for COLRv1 colour fonts (`@font-palette-values`) and for synthetic italics — a Type 3 "font" is a per-glyph content stream, not a font program, so a print shop's preflight reports it as *not embedded*, Acrobat/Illustrator render it broken, and DTP has to re-substitute by hand. That is the problem this option exists for.

  | value | behaviour |
  |---|---|
  | `keep` | Today's behaviour — text stays selectable and searchable, fonts as Chromium emitted them. A **font preflight notice** rides back on the export (job row, completion toast, history ledger) when some font came out Type 3 or non-embedded, naming the faces. |
  | `embed` | Same file, but the export **fails** rather than shipping a font a printer will reject. Type 3 is a hard failure, named — never a silent pass. |
  | `outline` | Every glyph becomes a vector path (Ghostscript `-dNoOutputFonts`). Nothing left to break. Text is **no longer selectable or searchable**, and the file can grow substantially (glyphs become path data). |

  `outline` needs **Ghostscript** on PATH — `brew install ghostscript` / `apt-get install ghostscript` / `choco install ghostscript`, or point `MAUDE_GHOSTSCRIPT` at it. Exports run in a Maude **workspace (cloud) already have it**; the desktop app and the npm CLI do not bundle it (Ghostscript is AGPL-3.0, Maude is MIT), and refuse with the install line rather than silently handing back un-outlined text. Print boxes (MediaBox/BleedBox/TrimBox), the vector crop/registration marks, and every raster image's pixel count + ppi are all preserved through the pass — the flag set pins `-dPassThroughJPEGImages` and disables downsampling and auto-filtering precisely so a photo cannot be quietly recompressed or resampled out of print DPI.

  The preflight also flags a **synthetic italic** specifically (the same base name appearing as both a Type 3 and a real embedded font). Unlike a colour font, that one is fixable at the source: load the real italic face and it disappears without outlining anything.

- Bleed/trim geometry always comes from the artboard's own `print` JSX prop (paper/orientation/bleedMm) — never re-specify bleed via `--option`; there isn't one. RGB PDF only — CMYK/PDF-X is out of scope (print shops convert on their end). `text` is a different axis: it is not about colour, it is about whether the vector output can be sent to print at all.

**Temporal formats (`mp4` / `gif` / `webm`) — DDR-148.** Scope is `artboard`: a **video-comp** artboard (its comp meta drives fps + frame count) or an ordinary **animated** mock (`--option fps=…` + `--option durationMs=…`; add `--option mode=ordinary` for WAAPI/CSS-driven motion). Rendered through Maude's own capture spine (Playwright frame-step → mediabunny H.264 MP4 / gifenc GIF, in-page) — no native binaries, deterministic. Default cap 30 s / 900 frames. MP4 falls back to WebM when the capture browser has no H.264 encoder.

## Examples

```
# Active canvas → multi-page PDF, one artboard per page
/design:export pdf --scope canvas-as-separate

# Selected element → PNG to ~/Downloads/hero.png
/design:export png --scope selection --out ~/Downloads/hero.png

# Editable Canva handoff bundle (PPTX + .canva-handoff.md)
/design:export canva

# Legacy raster bundle (PNG+CSV+README, no editable PPTX)
/design:export canva --option mode=raster

# Whole `.design/` source ZIP, DS subtree only
/design:export zip --option include=system

# A4 PDF instead of the artboard's native dimensions
/design:export pdf --option pageFit=a4

# Video-comp artboard → MP4 (fps/duration come from the comp meta)
/design:export mp4 --scope artboard

# Animated mock → looping GIF, 15 fps · 3 s · 128-color palette
/design:export gif --scope artboard --option fps=15 --option durationMs=3000 --option gifColors=128

# 300 DPI PNG (print-ready raster) of the active artboard
/design:export png --scope artboard --option dpi=300

# Print-ready PDF — bleed included, crop + registration marks
/design:export pdf --scope artboard --option includeBleed=true --option marks=crop,registration

# Large-format PDF (e.g. a billboard authored at a fraction of its real size) —
# 300 dpi capture for any dropped photo/art on the artboard; the page stays vector
/design:export pdf --scope artboard --option dpi=300

# The full send-to-print deliverable — bleed, marks, and all text on curves so
# no font can be rejected at preflight (needs Ghostscript locally)
/design:export pdf --scope artboard --option includeBleed=true --option marks=crop,registration --option text=outline

# Just check: fail the export if any font would come back unprintable
/design:export pdf --scope artboard --option text=embed
```

## What the command does

1. **Detects the port** from `.design/_server.json` (or a `--port N` override).
2. **Resolve scope:** if the user didn't pass `--scope`, use the plan-defined default (`canvas-as-separate` for element formats, `project-raw` for `zip`).
3. **POST** `http://localhost:<port>/_api/export` with body `{ format, scope, options }`.
4. **Writes the bytes** to the `--out` path (or cwd + the server-supplied filename).
5. **Stdout:** `wrote <abs-path> (<bytes> bytes)`. Stderr on error.

No network calls outside localhost. No OAuth / token storage — the Canva handoff returns a PPTX + markdown with a prompt block for your MCP (see `plugins/design/docs/canva-handoff.md`).
