# signature-moment-critic — 09 Export (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/09 Export.tsx` · impl = release v2 client (stage-A frames) · opt_out_scope: palette · READ-ONLY_

## TL;DR

**Aspiration (impl vs board): 2.8/5** · Specificity: pass · Verdict: **divergent**

The bones of the sheet are right:
- the Scope row with counts
- per-kind sections, Other…, the Annotations row
- the big-export bar and the Project ZIP hint
- the Advanced fold that mirrors the board's knob set
- the honest "1 file · about 210 KB · a few seconds on this Mac" line

What makes the board's sheet feel designed is missing:
- **The preview card.** It is missing on image, web and video, and the print preview never draws ("Drawing the page…").
- **Pixel sizes on the size chips** ("1× 1080 × 1350").
- **Thumbnails** on format tiles and on the per-kind rows of canvas/folder/project exports.
- **The filmstrip** in the video sheet. It is an empty lane.
- **The board's selected-segment style** (accent ring).
- **File name and Save to rows.** They are demoted into Advanced.

Handoff is a plain list rather than radio cards with icons, and a heavy focus ring wraps the whole dialog. Restraint is fine: the impl is plainer, not louder.

Dark: none of 09 is drawn dark (INDEX). Dark impl was checked against the app's dark tokens. Sheets, segments and menus re-theme correctly, and the light findings repeat. The one dark-only note: handoff's selected row is a solid accent block in dark, heavier than light's tint (warning, ex-handoff · dark).

## Per artboard (light = dark unless noted; a "both" row counts once per theme in the totals)

### ex-social
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No preview card | 1080×1350 thumbnail + "1080 × 1350 · Post 4:5" | none | `client/v2/export/sections/image.jsx` (no preview; only `sections/print.jsx` draws one) | blocker |
| both | Size chips carry no pixels | "1× 1080 × 1350 · 2× 2160 × 2700" | "1× · 2×" | `client/v2/export/export-copy.js:111-114` (`IMAGE_SIZES`) | blocker |
| both | Selected segment = raised white + shadow | inset 1 px accent ring (`_kit.css:229`) | no ring | `client/v2/export/export.css:101-105` | warning |
| both | File name / Save to are missing from the sheet | rows under Annotations | only in Advanced | `client/v2/export/advanced/names.jsx` (moved), `export-sheet.jsx` | warning |
| both | Generic title | "Export 'DOMA · Post 4:5 — feed matchday'" | "Export 1 artboard" + canvas name | `client/v2/export/export-sheet.jsx` | warning |

### ex-print
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The preview never draws | page with bleed tint + crop marks, page strip, legend | empty card "Drawing the page…" | `client/v2/export/sections/print.jsx:155-170` (pending while `preflight` is null; `preflight/use-preflight.js`) | blocker |
| both | No "Add 'B · zadní (FLAG)'" back-page row, though the fixture has the B artboard | third Print checkbox | absent | `sections/print.jsx` | warning |

### ex-web
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No preview card with the visible-area dashes | page thumb, "dashed: visible area" | none | `client/v2/export/sections/web.jsx` | blocker |
| both | Area is a sentence, not two chips with sizes | "Full page 1440 × 3120 · Visible area 1440 × 900" | "Full page" text | `sections/web.jsx` | warning |

### ex-video
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The filmstrip is an empty lane. No clip pictures, titles or music bed | thumbnails per clip + text row + bed, playhead 0:04 | blank blue box with a ruler | `client/v2/export/sections/video.jsx:41-80` (`Film` draws bare blocks; none painted here) | blocker |
| both | No poster preview card ("Frame at 0:04, scrub the strip below") | left card | none | `sections/video.jsx` | blocker |
| both | Format tile has no thumbnail | thumb + name + px | text chip | `sections/video.jsx` | warning |
| both | No cloud / Mac render cards | two radio cards | — | (fixture: local project) | — |

### ex-inspector
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Export rows are native selects + "Export 1 file" | pill selects, "⤓ Export 2 files" full-width button | native | `client/v2/export/inspector-export.jsx` → `inspector-controls.jsx:507` | warning |
| both | Copy-as-PNG toast not captured | "Copied … paste anywhere." pill | — | lane | — |

### ex-formats
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Two-line items, taller list, clipped by the window | dense one-line rows, reason right-aligned, greyed rows say why ("Needs a print artboard") | two-line, clipped at the bottom | `client/v2/export/other-formats.jsx` | warning |

### ex-canvas
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Per-kind rows have no kind tile and no thumbnail strip | kind glyph tile + 3-thumb strip + pill select | text + native select | `client/v2/export/sections/batch.jsx` | blocker |
| both | No Folders / Save to rows | "One folder · Combine-kampan/Arch 1…" | absent | `sections/batch.jsx` | warning |

### ex-batch-pick
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The ⌘A selection isn't carried into Scope | "Selection 5" | "Selection —", falls to This canvas | `client/export-bridge-scope.js` / `client/selection-scope.js` (artboard ⌘A → selection scope) | blocker |

### ex-batch
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Same as ex-canvas: no thumbnail strips, no Folders / Save to | — | — | `sections/batch.jsx` | warning |
| both | No "_broadcast … shared parts left out" row | — | — | (fixture) | — |

### ex-history
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Empty state only; row layout not observable | — | "No exports yet." | **product/lane work:** a render-service stub that records jobs | — |

### ex-share-vs
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The Share panel is the local-project "Move to cloud" card, and it does have the "Only need a file? Menu › Export… ⇧⌘E" line | — | — | (fixture: local project) | — |

### ex-handoff
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Targets have no radio dot and no target icon | radio + 🖥/📱/▶ icon + "Last used" chip | text rows | `client/v2/handoff/handoff-sheet.jsx:244-275` | blocker |
| both | A heavy focus ring wraps the whole dialog | no dialog outline | 2 px accent ring around the sheet | `handoff-sheet.jsx:226` (dialog focus without `outline:none`) | warning |
| both | No "Use the design system" checkbox | checkbox + tokens line | hidden | (fixture: no DS) | — |
| dark | The selected row is a solid accent block | tinted | solid | `client/v2/handoff/handoff.css` `.ho-target--on` | warning |

### ex-handoff-edges
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Signed-out: the connect sheet is nested inside the handoff sheet (two titles, a card-in-card) | one sheet "Connect your Claude account to let AI draft this." | stacked dialog | `client/v2/handoff/edges.jsx` | warning |
| both | Offline-queued and review-blockers variants not reached | — | — | lane | — |

### ex-offline
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No offline status in the cluster, and the sheet doesn't switch to "this Mac renders" | "Offline — kept on this Mac" chip | unchanged | **product/lane work:** the app's offline detection didn't trip on browser offline | warning |

### ex-huge
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Same thumbnail/tile gap as ex-canvas | — | — | `sections/batch.jsx` | warning |
| both | No "Include · All 5 folders · loose canvases" row | checkboxes | absent | `sections/batch.jsx` | warning |
| both | Big-export bar + Project ZIP hint | — | present | — | verified (elements) |

### ex-print-warn
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | In-sheet preflight warnings and the "2 mm to the cut" pin on the preview are missing | amber rows + "Show on canvas" | none (preview pending) | `sections/print.jsx` + `preflight/safe-margin.js` (same root as ex-print) | blocker |

### ex-advanced
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The sheet clips at the window bottom (Cancel/Export cut) | fold scrolls inside the sheet | overflow | `client/v2/export/advanced/advanced.css` / `export.css` (no max-height + scroll) | blocker |
| both | File-name tokens and the terminal commands aren't in view | `{canvas}` tokens + 4 copyable commands | below the fold, clipped | `advanced/names.jsx`, `advanced/command.jsx` | warning |

### Spec-only
| id | product work to make it reachable |
|---|---|
| ex-progress, ex-states | Running/finished export jobs: a lane stub for maude-render + this-Mac jobs, so the Exports panel rows and the cluster ring (`share-cluster.jsx:168`, shown "once any export exists") appear |
| ex-handoff-ready | A finished AI handoff run (`handoff/ready-card.jsx` exists). Needs a signed-in or stubbed Claude |
| ex-edges | A viewer-role session (Can view) + an "AI is changing this artboard" live edit (version picker) |

## Root causes

1. **R1 — Previews were built only for print, and print's never resolves in the lane.** `sections/print.jsx:155`. Image, web and video have no preview card, and that card is the sheet's anchor in the board.
2. **R2 — Thumbnail material is absent everywhere in Export:** kind rows, format tiles, the filmstrip (`sections/batch.jsx`, `sections/video.jsx`).
3. **R3 — Copy shrank.** Size chips lost their px (`export-copy.js:111`). Titles are generic ("Export 1 artboard"). File name / Save to are demoted into Advanced.
4. **R4 — The control style drifted from the kit** (`export.css:101` seg; native selects via `inspector-controls.jsx:507`).

## What's working (preserve)

- The Scope row with counts, per-kind defaults (PNG 1×/2×, Print PDF + bleed + crop marks, MP4), Other… grouped by kind.
- The estimate line in words, the big-export bar, the Project ZIP hint, the Advanced knob set (two-column, per kind).
- Handoff copy: "AI takes about a minute — keep working."; Design tokens says why it's off.

## Verdict

```json
{
  "canvas": "09 Export",
  "critic": "signature-moment-critic",
  "agent": "signature-moment-critic",
  "iter": 1,
  "blockers": 22,
  "warnings": 33,
  "aspiration_score": 2.8,
  "axes": {
    "signature_moment": { "score": 2, "weight": 1.5 },
    "brand_prominence": { "score": 3, "weight": 1.0 },
    "mock_fidelity": { "score": 2, "weight": 1.0 },
    "restraint": { "score": 4, "weight": 1.5 },
    "negative_space": { "score": 3, "weight": 1.0 }
  },
  "specificity": "pass",
  "specificity_findings": [],
  "top_blockers": [
    { "category": "aspiration-signature_moment", "line": null, "summary": "signature_moment 2/5 — no preview card on image/web/video; print preview stuck pending", "fix": "Add the preview card to every per-kind section and resolve print's preflight without a live measurement." },
    { "category": "aspiration-mock_fidelity", "line": null, "summary": "mock_fidelity 2/5 — no thumbnails on kind rows, format tiles or the filmstrip", "fix": "Reuse the canvas thumbnail cache for the row strips and tiles; paint the clip filmstrip from the timeline media cache." }
  ],
  "opt_out_applied": "palette",
  "passed": false,
  "verified_ids": []
}
```
