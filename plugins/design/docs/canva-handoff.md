# Canva handoff — from Maude canvas to editable Canva design

> Phase 6.5 ships **two paths** for getting your Maude canvas into Canva as **editable text, shapes, and images** — not flat raster.
>
> Both paths share the same payload (a PPTX file authored from your canvas model) so you can choose based on whether you've configured a Canva MCP server in your agentic tool of choice.

## TL;DR

1. Open the Export sheet (**Menu › File › Export…**, ⇧⌘E, or right-click → **Export this artboard…**).
2. Pick **format: Canva**.
3. Pick **scope: Canvas → separate** (one Canva page per artboard).
4. Click **Export**. You'll get a ZIP with two files:
   - `<canvas>.pptx` — the editable payload.
   - `<canvas>.canva-handoff.md` — instructions for both paths below.
5. **Drag-drop path:** drag the `.pptx` into [canva.com](https://canva.com). Done.
6. **MCP path:** if you've got a Canva MCP server connected, paste the prompt block from the `.canva-handoff.md` into your agentic tool and let it import for you.

## Why PPTX?

Canva's import-fidelity ladder, [per their docs](https://www.canva.dev/docs/connect/api-reference/design-imports/create-design-import-job/):

| Format | What Canva preserves as editable |
|---|---|
| **PPTX** | Text boxes (editable text), shapes (fill + stroke), images (swappable), layouts (one slide → one Canva page), groups |
| PDF | Mixed — Canva's docs contradict whether text stays editable; depends on the PDF generator |
| SVG | One non-decomposable element. Requires Canva Pro / Teams. |
| PNG | Flat raster. Nothing editable. |

PPTX is the top of the ladder. Maude authors PPTX from a normalized canvas model (`canvas-model.ts` → `modelToPptx`) via `pptxgenjs` — one slide per artboard, native shapes, native text, base64-embedded images. See [DDR-039](../../../.ai/archive/decisions/DDR-039-export-pptx-via-pptxgenjs.md) for the engine rationale.

## Path A — drag-drop (universal, any Canva tier)

The bulletproof path. Works on free, Pro, Teams, Enterprise — no auth, no install, no MCP required.

1. Run the export (UI / CLI / slash command). You get a ZIP in your Downloads folder.
2. Double-click to unzip. You'll see `<canvas>.pptx` and `<canvas>.canva-handoff.md` side by side.
3. Open [canva.com](https://canva.com) in your browser.
4. Drag `<canvas>.pptx` onto the Canva home screen, **or** click **Create a design → Upload media → Import file**.
5. Canva runs an import job (takes a few seconds). When it finishes, the design opens with all artboards as editable pages.

You can now select text and edit it, swap images, adjust shape fills, recolor with your Canva Brand Kit, etc.

## Path B — MCP-prompt (one-click for users with a Canva MCP)

If you've got a Canva MCP server connected to Claude Code, Cursor, Goose, or any other agentic tool, you can skip the manual drag-drop step.

### What's a Canva MCP?

[Model Context Protocol](https://modelcontextprotocol.io) is an open standard for connecting LLMs to external tools. A "Canva MCP" is any MCP server that exposes Canva's API as tools your agentic chat can call — `create_design`, `import_file`, `list_brand_kits`, etc. Several community implementations exist; Canva's official server is in development as of 2026-05.

**Setting one up takes ~5 minutes** the first time and is then permanent. The MCP holds your Canva auth; Maude never sees it.

### Using the prompt block

The `<canvas>.canva-handoff.md` file ships with a fenced ` ```text ` block. Open the markdown, copy the block, paste into a fresh chat with your agentic tool. Example:

```text
Use my Canva MCP to import the PowerPoint file at the path below into a new Canva design titled "home". Preserve text editability, shape fills and strokes, image swappability, and the artboard-to-page mapping (one PPTX slide = one Canva page). After the import job completes, return the Canva design URL.

File path: /Users/<you>/Downloads/home/home.pptx
Slides expected: 5
```

The agent reads the prompt, calls your Canva MCP's import tool with that path, polls the import job, and returns the Canva design URL. End-to-end one paste.

### Maude doesn't see your credentials

This is the load-bearing property. Maude exports a markdown file containing instructions; **your MCP** holds the Canva auth and runs the import. No `_canva-auth.json`, no OAuth dance in `.design/`, no token rotation for Maude to worry about. See [DDR-040](../../../.ai/archive/decisions/DDR-040-export-canva-via-pptx-and-mcp-prompt.md) for the security rationale.

## Fidelity caveats

PPTX is the most editable Canva format, **and** it has limits. Real users sometimes hit these. The exporter doesn't try to translate every CSS feature — it picks what's preservable and flags what isn't.

| What | Behavior on Canva import | What you can do |
|---|---|---|
| **Fonts** | If your Canva Brand Kit doesn't include the source fonts, Canva substitutes its default. **Text remains editable** — only the visual face shifts. | Add the source fonts to your Brand Kit before importing for visual parity. |
| **Gradients** | CSS gradients translate to native PPT gradients. Multi-stop fidelity drops on > 4 stops. | Simplify gradients in the source if visual parity matters, or accept the quantization. |
| **Shadows + blend modes** | `box-shadow`, `mix-blend-mode`, `backdrop-filter` rasterize on import (Canva flattens them to baked-in image effects). | Manual reapplication in Canva for cases where edit-after-import matters. |
| **Flex / grid layouts** | Flattened to absolute coordinates at export-time viewport (1440 × declared artboard height). Responsive variants are lost. | Lock to the breakpoint you want **before** exporting. |
| **Inline `<svg>` icons** | Rasterize on PPTX import. Canva can't edit them as vector primitives. | Replace with native Canva icons after import if you need to recolor frequently. |
| **CSS animations** | Lost. PPTX has its own animation model; Maude doesn't translate. | If the canvas was demoing an animation, capture it separately as MP4 / GIF. |

These caveats are inherent to PPTX-as-intermediate, not Maude bugs. The PPTX → Canva path is **best-in-class** for editable handoff today; if a future Canva integration ships (a Canva App via the Apps SDK — see [DDR-040 open questions](../../../.ai/archive/decisions/DDR-040-export-canva-via-pptx-and-mcp-prompt.md#open-questions)), some of these caveats may lift.

## `--canva=raster` — legacy reference bundle

Sometimes you just want PNGs + a manifest, not editable PPTX. Maybe the design is being archived; maybe Canva isn't the destination at all. Use the raster bundle:

```sh
maude design export canva --option mode=raster
```

Or in the slash command:

```
/design:export canva --option mode=raster
```

You get a ZIP with one PNG per artboard, a `manifest.csv` mapping index → filename → canvas slug, and a `README.md` explaining what's in the bundle and that re-exporting without `mode=raster` gives the editable PPTX path.

## Troubleshooting

**Drag-drop into Canva: nothing happens.**
Canva sometimes rejects PPTX uploads if the file extension was changed (e.g. macOS adding `.zip` on download). Confirm the inner file ends in `.pptx`, not `.pptx.zip`.

**Imported design looks pixelated.**
You probably dragged a `--canva=raster` bundle. Re-export without `--option mode=raster` to get the editable PPTX path.

**Text shifts position vs. the source canvas.**
Font substitution. Add the source font to your Canva Brand Kit and re-import — Canva re-flows with the actual font and positions normalize.

**MCP prompt fails with "no Canva MCP found."**
Your agentic tool doesn't have a Canva MCP configured. Either configure one (5-min setup, see your tool's MCP docs) or fall back to Path A.

**MCP prompt opens an import job but it never completes.**
Most Canva imports finish in 10–30 seconds. If yours hangs past 60 seconds, check your MCP's logs — usually a tier issue (Canva Connect Design-Imports is gated to Enterprise for production scope; your MCP may need to fall back to drag-drop scripting).

## See also

- [DDR-039: PPTX engine](../../../.ai/archive/decisions/DDR-039-export-pptx-via-pptxgenjs.md) — why pptxgenjs + canvas model IR, not DOM walker
- [DDR-040: Canva path](../../../.ai/archive/decisions/DDR-040-export-canva-via-pptx-and-mcp-prompt.md) — why PPTX + MCP-prompt, not OAuth + Connect API
- [Phase 6.5 plan](../../../.ai/plans/phase-6.5-export.md) — full export feature spec
- [Canva Design Imports API reference](https://www.canva.dev/docs/connect/api-reference/design-imports/create-design-import-job/) — for MCP authors implementing the import call
