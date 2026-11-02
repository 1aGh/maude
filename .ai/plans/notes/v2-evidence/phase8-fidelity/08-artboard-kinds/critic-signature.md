# signature-moment-critic — 08 Artboard Kinds (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/08 Artboard Kinds.tsx` · impl = release v2 client (stage-A frames) · opt_out_scope: palette · READ-ONLY_

## TL;DR

**Aspiration (impl vs board): 3.0/5** · Specificity: **fail** (Layers shows raw DOM; hash track label) · Verdict: **fix-and-retry**

Three of the board's moments made it through: the F picker (kind badges, Fewer/All, the Custom size… tile), the dashed size ghost, and print guides with the label warning mark. The surrounding craft did not. Safe-zone bands are a raw red hatch where the board draws navy/green with accent tags. The ghost chip is mono. Every inspector is the docked full panel with native selects and Fill/Layout/Safe-zone rows on kinds the board keeps to 5–7 rows. Layers dumps `div / div.__remotion-player / img`. Two-kind selection has no inspector at all.

Dark: none of 08 is drawn dark (INDEX). Dark impl was checked against the app's dark tokens. The picker, inspector and Layers re-theme correctly, and the light findings repeat unchanged. No dark-only finding.

## Per artboard (light = dark unless noted; a "both" row counts once per theme in the totals)

### ak-picker
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No Recent row | "Recent · FB event cover · Post 4:5 · A6" | absent | (state: fresh HOME has no `recentSizes`; `SizePickerHost.jsx:17-28` implements it) | — |
| both | No ghost frame / hot tile in this shot | FB event cover hot + dashed ghost | none hot | (state: no tile focused; ghost exists — see ak-picker-full) | — |
| both | The App group header uses the phone glyph | laptop glyph | phone | `client/v2/kinds/SizePicker.jsx:41` glyph map | warning |
| both | The panel floats at mid-window | anchored under the top cluster, lg radius + shadow | centred at y≈190, hairline | `SizePicker.jsx:88` (`placePanel`) | warning |

### ak-picker-full
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The ghost chip is mono with a weak fill | sans chip + kind glyph, ~30 % tinted dashed frame | mono "A2 420 × 594 mm", 10 % fill | `apps/studio/editing/size-ghost.tsx:160-166` (`font: … var(--maude-chrome-font-mono…)`) | warning |
| both | The Custom print size dialog and the "kind travels on the label" card | dialog beside the picker | separate frame (shots-2); the card is board-only | — | — |
| both | All 7 print tiles + Custom size… + Fewer | — | match | — | verified |

### ak-web-hug
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No "+ 373 px" growth tag or "new section" highlight | bracket + tag beside the page | none | `canvas` hug overlay — event moment not driven (add a section). **Lane work:** drive an insert | warning |
| both | Other widths is a native select, not a button | "⧉ Add a width" button | `<select>` "Add a width…" | `client/v2/inspector/kinds/artboard-web.jsx:46-53` → `inspector-controls.jsx:507` | blocker |
| both | Layout reads "Content: Page flow". Inspector has extra Fill/Layout/Export sections | Layout "Top to bottom" | Page flow + Padding/Gap | `artboard-web.jsx` + `inspector/sections.js` | warning |
| both | Export row is 1×/PNG native selects + "Export 1 file" | — (board has no Export row on web) | native | `client/v2/export/inspector-export.jsx` | warning |

### ak-web-widths
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Same frame as web-hug; the Add-a-width menu and sibling widths were not driven | — | — | not reached (lane) | warning |

### ak-social
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Size reads "Custom" for a 304×540 story | "Story 9:16 (still)" | Custom | preset match in `client/v2/kinds/size-picker-model.js` (exact px) | warning (fixture size) |
| both | A fixed-size kind still shows Layout "Page flow" / Padding / Gap | Size · W/H · Fill · Safe zones · Export | + Layout section | `client/v2/inspector/sections.js` (sections not gated by kind) | blocker |
| both | Export is native selects + button, not the "⤓ PNG · 1×" pill | pill | native | `inspector-export.jsx` | warning |
| both | W/H fields use mono numerals with a boxed prefix | sans "W 1080" pill | mono | `3-shell-maude.css` `.st-cp-*` | warning |

### ak-safe-zones
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Bands are a raw red hatch with red tags | navy diagonal hatch top, green hatch bottom, accent-blue tags; warn yellow only for the collision | red/pink hatch + red pills | `apps/studio/safe-zones-overlay.tsx:34` (literal `oklch(60% 0.2 25)`) | blocker |
| both | The platform list is a native select | floating checked list with the dated note | `<select>` | `inspector-controls.jsx:507` | warning |
| both | Collision tag "Under the reply bar" | present | present | — | verified (one element) |

### ak-print-letak
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The unit sits as a boxed left prefix ("mm 3"), half-width | "3 mm" suffix, full pill | prefix | `3-shell-maude.css` `.st-cp-*` unit field | warning |
| both | Orientation selected style | outlined pill (accent ring) | grey fill | `3-shell-maude.css` segmented | warning |
| both | Fill / Layout "Page flow" on a print kind | not on print | present | `inspector/sections.js` | blocker |
| both | Warning row + Fix size | — | present | (fixture QR box) | — |

### ak-print-view
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Safe margin is magenta dashed; bleed is a pink slab | white/light dashed safe line on the artwork, soft pink bleed halo, dark trim | magenta dashes | `apps/studio/artboard-guides-overlay.tsx` | warning |
| both | Menu › View › Advanced not opened (palette used) | menu with ✓ Print guides | — | lane | — |

### ak-video
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The track label is a hash | clip name | "0fce5…", "Video 2" + empty "Video" lane | `client/v2/timeline/Timeline.jsx` row label (mediaSrc basename) | blocker |
| both | No poster flag / waveform / icon labels (see 07 R2) | — | — | `Timeline.jsx:2153` | blocker |
| both | Length missing from the label | "Hype trailer · 16:9 · 0:30" | "Hype trailer · 16:9" | `canvas-lib.tsx:2965` | warning |
| both | Filmstrip paints | — | ✓ | — | verified (element) |

### ak-mixed-fit
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Layers shows raw DOM children | per-kind artboard rows only | `div`, `div.__remotion-player`, `img` under the video | `client/v2/layers/*` tree source | blocker |
| both | Social post/story carry the web-page glyph, and the chips count them as web (□0 / ▭3) while the inspector says "Fixed size" | phone glyph, Fixed size | web glyph | `client/v2/kinds/layers-kind-model.js` vs the inspector kind | blocker |
| both | Docked full-height Layers panel | floating card hugging its rows, "19 other artboards are dimmed. Show all" | docked | `client/v2/left-panel/*` | warning |
| both | ⌘0 did not fit (artboards cropped) | 7 % fit | camera unchanged | lane / focus in the Layers tab | warning |

### ak-mixed-filter
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Canvas rows have no thumbnails | thumbnail per row + "2 of 3" kind badge | empty square | `client/v2/canvases/*` row | blocker |
| both | Non-matching artboards fade on the canvas | Canvases filter leaves the canvas undimmed (dim belongs to the Layers filter) | faded | `client/v2/kinds/KindDimHost.jsx` | warning |

### ak-mixed-select
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No mixed-artboard inspector | "2 artboards · 2 kinds", Kinds list, Fill Mixed, align H/V segs, "2 files…" | floating "3 objects" align bar; no inspector | `client/v2/inspector/*` (mixed artboards) | blocker |

### ak-warnings
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The label mark is an outline triangle, and the fix is a button at the right | filled amber disc mark; amber card, verb as a link under the text | outline ⚠, "Fix size" button | `client/v2/inspector/warning-fix.js` | warning |
| both | Multi-case (video length, paper size) not reproduced | — | — | lane | — |

### ak-advanced
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The Advanced fold didn't open (click missed) | Exact size / Resolution / Colour / Guides / Look and layout / In code | collapsed "7 properties" | lane — **re-capture** | warning |

### ak-real-print / ak-real-web
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Content differs | — | — | (fixture) | — |
| both | Mid-edge pill handles in addition to corner squares | corner squares | pill side handles | canvas selection chrome (`canvas-lib.tsx`) | warning (real-print only) |

### Spec-only
| id | product work to make it reachable |
|---|---|
| ak-convert / ak-convert-after | "Make 'X' an A6 print?" dialog from the Size select (`client/v2/kinds/ConvertDialog.jsx` exists). Lane: pick the A6 option by value, not index |
| ak-real-about | Board note card — no app state |

## Root causes

1. **R1 — Inspector sections aren't gated by kind.** Fill/Layout/Safe zones/Export appear on fixed-size and print kinds (`inspector/sections.js`). The board's per-kind inspectors are 5–7 rows.
2. **R2 — Native `<select>` everywhere** (`inspector-controls.jsx:507`, `3-shell-maude.css:4391` has no `appearance:none`): Width, Other widths, Safe zones, Paper, Export.
3. **R3 — Canvas overlays use literal colours and mono chrome.** `safe-zones-overlay.tsx:34`, `size-ghost.tsx:166`, `artboard-guides-overlay.tsx`. Not the board's accent/navy/green vocabulary.
4. **R4 — Layers and canvas rows lack the material.** Raw DOM nodes, no thumbnails, kind glyph disagreement.

## What's working (preserve)

- The size picker structure and copy: groups, the four kind badges, All N / Fewer, Custom size… tile, footer hint.
- Print inspector speaks mm, with RGB→CMYK copy; the label warning mark and the one-verb fix row.
- Safe-zone overlay draws on canvas only, with the dated platform note.

## Verdict

```json
{
  "canvas": "08 Artboard Kinds",
  "critic": "signature-moment-critic",
  "agent": "signature-moment-critic",
  "iter": 1,
  "blockers": 20,
  "warnings": 42,
  "aspiration_score": 3.0,
  "axes": {
    "signature_moment": { "score": 3, "weight": 1.5 },
    "brand_prominence": { "score": 3, "weight": 1.0 },
    "mock_fidelity": { "score": 3, "weight": 1.0 },
    "restraint": { "score": 3, "weight": 1.5 },
    "negative_space": { "score": 3, "weight": 1.0 }
  },
  "specificity": "fail",
  "specificity_findings": [
    "Layers tree shows 'div', 'div.__remotion-player', 'img' (client/v2/layers)",
    "video track label is the hash '0fce5…' (Timeline.jsx row label)"
  ],
  "top_blockers": [
    { "category": "aspiration-specificity", "line": null, "summary": "raw DOM / hash names in Layers and the timeline", "fix": "Stop Layers at artboard children with data-cd-id; label tracks by clip name." }
  ],
  "opt_out_applied": "palette",
  "passed": false,
  "verified_ids": ["ak-real-web · light", "ak-real-web · dark"]
}
```
