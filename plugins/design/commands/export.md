---
name: export
category: daily
description: "Export a canvas to images, documents, slides, video or a handoff bundle."
argument-hint: "<png|jpg|pdf|svg|html|pptx|mp4|gif|webm|canva|zip|audio> [--scope selection|canvas|folder|project] [--canvas <rel>] [--folder <rel>] [--region x,y,w,h] [--kind <kind>=<format>[:k=v,k=v]] [--name <template>] [--estimate] [--out <path>] [--option key=value]"
---

# /design:export — export from Maude

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Runs `maude design export`, which sends one export spec to the studio: the same spec the Export sheet (**Menu › File › Export…**) sends. The export lands in the Exports panel like any other, and the file is written to disk (default: the current directory, or `--out <path>`).

**Prerequisite:** Maude is running for this project (`maude design serve`, or the Maude window). The verb finds it through `.design/_server.json`. A person who can only view or comment on the project is refused on the server, and the refusal is printed as it is.

## Input `$ARGUMENTS`

| Flag | Meaning |
|---|---|
| `<format>` (required) | `png` / `jpg` / `pdf` / `svg` / `html` / `pptx` / `mp4` / `gif` / `webm` / `canva` / `zip` / `audio` |
| `--scope <s>` | `selection` / `canvas` / `folder` / `project`: Selection, This canvas, Folder, Whole project. `--canvas <rel>` names the canvas (default: the open one), `--folder <rel>` the folder, `--artboard <id>` / `--element <id>` (repeatable) the selection. |
| `--region x,y,w,h` / `--unit each\|one` | A world rectangle of the canvas; `one` makes one file of everything in scope. |
| `--kind <kind>=<format>[:k=v,k=v]` (repeatable) | Each artboard kind its own format: `--kind digital=png:scale=1 --kind print=pdf:bleed=true,marks=crop --kind video=mp4`. What the Export sheet's groups by kind send as `byKind`; the options after `:` are `--option` items for that kind alone. The positional format is the default for a kind not named. |
| `--name '<template>'` | File names, with `{project} {folder} {canvas} {artboard} {kind} {size} {scale} {date}`. |
| `--estimate` | Print the number of files, size and time for the spec, and export nothing. |
| `--preflight` | For a print artboard: print its paper (trim, bleed, safe margin), its back, elements closer to the cut than the safe margin and fonts that will not embed, and export nothing. Warnings inform — the export still runs. The Export sheet's Print section shows the same. |
| `--at <sha>` | Export a past version of the canvas (a ref from `maude design history list`). |
| `--wait ai` | When AI is changing the artboard, hold the export until that run ends and then export the finished result. Without it the export takes the last finished version. If the run ends without one (stopped or failed), nothing is exported and the reason is printed. |
| `--scope <s>` (older spellings, same request as before) | `selection` / `artboard` / `canvas-as-separate` / `canvas-whole` / `selection-bounds` / `project-raw`. `canvas-whole` (PNG/PDF) = the whole canvas as ONE image/page, layout between artboards kept; `selection-bounds` (PNG/PDF) = one image of the bounding box around everything selected (no selection → whole canvas). Default = `canvas-as-separate` for element-shape formats, `artboard` for the temporal formats (`mp4`/`gif`/`webm`), `project-raw` for `zip`. |
| `--out <path>` | Where to write. Default = cwd + the filename the server returns in `Content-Disposition`. |
| `--option key=value` | Per-format option. Can be repeated. Examples: `--option pageFit=a4` (PDF), `--option mode=raster` (Canva → legacy raster bundle), `--option include=system` (ZIP filter), `--option fps=30` / `--option durationMs=4000` / `--option gifColors=128` (MP4/GIF/WebM), `--option dpi=300` (PNG — feature-2-print-artboards T4), `--option marks=crop,registration` / `--option includeBleed=true` (PDF — T5), `--option text=outline` (PDF — issue #116), `--option includeAnnotations=true` (`canvas-whole` / `selection-bounds` — paint the annotation layer in; comment pins never export — issue #125). |

**Print options (feature-2-print-artboards).**

- **PNG `dpi`** — `96` / `150` / `300` / `600` (snaps to the nearest preset). Wins over the legacy `scale` option when both are given (`exporters/png.ts` `resolveDeviceScale`). `deviceScaleFactor = dpi / 96`; output larger than 16,000 px on a side or ~600 MB is rejected with a message naming the max supported DPI for that artboard size.
- **PDF `dpi`** — same `96`/`150`/`300`/`600` ladder, but a DIFFERENT meaning than for PNG: the PDF page itself is always vector (text/shapes never rasterize regardless of this option), but any RASTER content on the artboard — a dropped photo, a large-format piece authored at a fraction of its real physical size (e.g. a billboard laid out at 1:10 scale) — still embeds as a bitmap, and `dpi` sets that bitmap's capture density (`exporters/pdf.ts` `resolvePdfDeviceScale`). Default (omitted) is 1× — deliberately NOT the PNG adapter's 2× default, since a plain "just export a PDF" call shouldn't silently double every embedded image's weight — except a page of a `kind="print"` artboard, which defaults to 300 dpi (a print-shop photo must not arrive at 96 dpi); an explicit `dpi` always wins.
- **PDF `includeBleed`** — `true` (default when the artboard's own `print` prop has `bleedMm > 0`) / `false`. Only meaningful for a `kind="print"` artboard — a no-op on any other artboard.
- **A v2 spec's Print PDF** (a `--scope selection|canvas|folder|project` export, the Export sheet's wire shape) takes the print options under `options.print`: `--option bleed=true --option marks=crop --option registration=true --option back=true --option text=outline` (`text` = `keep` · `embed` · `outline`). `back=true` adds the front's paired back artboard (the print artboard of the same size whose name says back/zadní/verso, with the front's other words) as page 2 of the same PDF; no pairing found = one page. The engine reads these as `pdfPrint` + `text`, as below.
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

# Whole canvas incl. annotations → one PNG
/design:export png --scope canvas-whole --option includeAnnotations=true

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

# Every canvas under ui/2026 as JPG, named by canvas and size
/design:export jpg --scope folder --folder ui/2026 --name '{canvas} {size}'

# How big would that be?
/design:export jpg --scope folder --folder ui/2026 --estimate

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

1. Runs `maude design export $ARGUMENTS`. It shows the permission card (it writes a file and may use a render).
2. With `--estimate` or `--preflight` it prints the numbers and exports nothing. Run `--estimate` first for a folder or the whole project.
3. Otherwise the studio makes the file and the verb writes it to `--out` (a folder name puts the file inside it) or to the current directory, and prints `maude design export: wrote <abs-path> (<bytes> bytes)`. A failure prints what happened and exits 1; usage errors exit 2.
4. A batch can be partial ("Exported 114 of 115"). `maude design exports list` shows recent exports and which items did not make it; `maude design exports retry <id|index> [--item <id,…>]` runs only those; `maude design exports again <id|index> [--out <file|folder/>] [--no-wait]` repeats one with the same spec.

Print reaches the canvas as written: bleed, marks and trim come from the artboard's own paper, and **Print never includes annotations**; a print export still succeeds and says so. Captions are Off unless the export asks for them.

No network calls outside localhost. No OAuth / token storage: the Canva handoff returns a PPTX + markdown with a prompt block for your MCP (see `plugins/design/docs/canva-handoff.md`).
