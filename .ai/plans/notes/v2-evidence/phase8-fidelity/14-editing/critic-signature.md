# signature-moment-critic — 14 Editing (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/14 Editing.tsx` (+ `14 Editing.css`) · impl = release v2 client (stage-A frames, `full-size-path.txt`) · opt_out_scope: palette · READ-ONLY_

## TL;DR

**Aspiration (impl vs board): 3.3/5** · Specificity: pass · Verdict: **fix-and-retry**

The editing anatomy is carried almost one to one:

- the azure name chip with its size, eight handles, the dashed resize ghost, the preset ruler and the guide line
- the hint for ⌘ / ⌥
- the magenta gap bands
- the reorder slot and its "moves 3 of 5" pill
- the align bar with Tidy up
- the inspector's section order: Position, Size, Layout, Fill, Corners, Border, Effects, Type
- the ⇧I component picker with its Brand and Components groups and "Open Design system"
- the pen hint words

What is plainer is the **voice of the HUD**. Every pill, chip, ruler label and hint on the canvas is set in `--maude-chrome-font-mono`: 19 files under `apps/studio/editing/`. The board sets them in the UI face, `--type-xs`, semibold, with tabular numbers. The DS README says "**Mono only in Advanced and code**." The two lens moments diverge visibly:

- **The size pill** "Laptop · 1280 × 1573" is a mono label, and its hint is one bordered mono box rather than two shadowed pills.
- **The pen hints** are one dark HUD bar pinned above the toolbar, where the board draws four light pills next to the path.

**Token chips in the Inspector** ("Space 24", "Round", "Ink") read as raw numbers + **Bind** in the impl. That is **fixture**: the stage-A canvases are plain code with no token-bound values. `client/v2/inspector/token-chip.jsx` does render the chip for a `var(--space-*)` value, so it is not a finding, but it stays unproven until a system-styled canvas is driven.

Dark: the user's designs stay light (theme-pinned) on the dark chrome, as designed. The only dark-only difference is the washed light toolbar pill, the same as 13 and 15.

Not findings (fixture / lane, per INDEX):
- "div · Frame" and crumbs like "Desktop › div › div" (the fixture has no layer names)
- "No style" (the system has no text styles)
- 3 vs 4 artboards in the marquee
- the signed-out AI panel ("Connect your Claude account?")
- no Tereza
- no Figma clipboard

## Axis scores (IMPL)

| Axis | Score | Weight | Weighted | Verdict |
|---|---|---|---|---|
| Signature moment per artboard | 3/5 | 1.5 | 4.5 | Every gesture has its HUD, but in a mono, file-like voice; the pen's four pills became one bar |
| Brand prominence | 3/5 | 1.0 | 3.0 | Inspector "Uses maude-v2" pill and the azure selection carry Maude's identity; the HUD reads generic dev-tool |
| Mock fidelity | 4/5 | 1.0 | 4.0 | Real product, real gestures; a few states not reached by the drive |
| Restraint | 3/5 | 1.5 | 4.5 | Focus-order pills with dotted path codes ("1.3.2.1") linger on unrelated frames; mono everywhere adds noise |
| Negative space | 4/5 | 1.0 | 4.0 | Comfortable; the inspector panel is long but scrolls |
| **Specificity gate** | **pass** | — | — | One leak, not placeholder: inspector title "h1.dc-text-editing" |

Weighted total 20.0/30 → **3.3/5**.

## Per artboard (a "both" row counts once per theme)

### ed-ab-select
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Azure name chip "Desktop 1440 × …", 8 handles, artboard inspector (Preset/Width, Height Fits content/Fixed, Clip, Fill, Layout, Export, Other widths) | — | match | `editing/artboard-handles.tsx`, `client/v2/inspector/kinds/artboard.jsx` | verified (element) |

### ed-ab-resize — the signature: the size pill + preset ruler
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Bubble, ruler labels and hint are set in mono | `.ed-bubble` UI face, `--type-xs` semibold, tabular, `--radius-sm`, `--shadow-sm` | `font: 600 11px/16px var(--maude-chrome-font-mono)`, 4 px radius, no shadow | `editing/preset-ruler.tsx:57,103,116` | blocker |
| both | The hint is one bordered box, not two pills ("⌘ ignores presets" · "⌥ From the centre") | `.ed-hints` → 2 × `.ed-hint` `--radius-pill`, `--shadow-sm` + island edge | one 4 px-radius box with a 1 px border | `preset-ruler.tsx:106-125,192-201` | warning |
| both | The lit ruler stop is the HUD accent (azure), not the guide magenta; the ruler is one label over a hairline, not a drawn scale with three stops | `.ed-ruler-t[data-on]` `--ed-guide` (`--guide`) | `--maude-hud-accent`; only "Tablet 834" in view | `preset-ruler.tsx:76-83,147-170` | warning |
| both | The bubble says 1057 × 1050 while the name chip says 1063 × 1050 in the same frame | one number | 6 px apart | `editing/artboard-handles.tsx` (bubble box vs chip `sizeText`) | warning |
| both | No preset name in the bubble | "Laptop · 1280 × 1573" | "1057 × 1050" | `artboard-resize.ts:161-164` adds the label only on a snap; the drive stopped between presets | not-a-finding (drive) |

### ed-ab-arrange
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No magenta smart guides, no "80" equal-gap chips, no "X 3480 · Y 0" pill in the frame | 3 gap chips + pill | handles + size chip only | `editing/artboard-guides.tsx` (exists; drag likely outside the snap range) | warning (unproven) |

### ed-ab-tidy
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Floating bar "N artboards · align · distribute · Tidy up" | — | match | `editing/align-bar.tsx` | verified (element) |
| both | Bar count and labels in mono | UI face | `align-bar.tsx:60,85` mono | — | warning |

### ed-ab-menu · ed-obj-enter · ed-obj-order · ed-lay-free · ed-comp-instance · ed-text-style
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Artboard menu; drill-in with the dashed parent; object menu (frame, order, lock, hide); Constraints with the pin diagram; instance inspector (Component, Variant, "Your text and colour come along"); text Style row | — | match in anatomy | `editing/artboard-menu.tsx`, `editing/object-menu.tsx`, `client/v2/inspector/kinds/instance.jsx` | verified (element). Layer names / styles = fixture |

### ed-obj-multi
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No "3 objects" bar, no Mixed values, no align bar: the root frame ended up selected | — | single frame | `editing/selection.tsx` (drive: ⇧-click inside nested frames) | warning (unproven) |

### ed-lay-auto — token chips + gap drag
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Gap / Padding are "24" + Bind, not "Space 24" chips; no stops menu (Space 4 … 64), no token ruler | chips + menu + `ed-tokruler` | numbers + Bind | `client/v2/inspector/token-chip.jsx:1-8,78-180` (renders a chip for a `var(--space-*)` value), `editing/token-ruler.tsx` | not-a-finding (fixture: no token-bound values) |
| both | Magenta gap bands with "24" chips | — | match | `editing/gap-bands.tsx` | verified (element) |
| both | Gap chips in mono | UI face | `gap-bands.tsx:146` | — | warning |

### ed-lay-reorder
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The "moves to 3 of 5" pill is cut off by the window's left edge; the lifted card is not visible at frame scale | pill beside the card | clipped | `editing/reorder-slot.tsx:256-290` (no edge clamp; mono 275/287) | warning |

### ed-text-edit
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Inspector title leaks the editing class: "h1.dc-text-editing · Text" | "Titulek · Text" | class in the name | `editing/text-in-place.tsx:19` (`dc-text-editing` read as the layer name) | warning |
| both | Language row (Čeština, one-letter ties) not in view | — | below the fold | `client/v2/inspector/kinds/text.jsx:313` exists | not-a-finding |

### ed-shape · ed-img
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both (shape) | No Kind row, no per-corner fields: a text element was selected instead of the shape | Rectangle + 4 corners | text inspector | drive | warning (unproven) |
| both (img) | Crop brackets + "↵ done · esc cancel" present; the whole photo faded beyond the frame is not visible | faded overflow | none visible | `editing/crop-mode.tsx:5` promises it; the fixture photo may fill the frame exactly | warning (unproven) |

### ed-comp-pick
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | ⇧I picker: search, system, Brand, Components, Open Design system | — | match | `client/v2/inspector/component-picker.jsx` | verified (element) |
| both | No Patterns group | Patterns rows | hidden while empty (by design) | `component-picker.jsx:10`, the cause is 13's empty Patterns | not-a-finding here (counted on 13) |
| both | The picker opens over the Tablet artboard and clips it | above the toolbar, clear of the work | over the work | `component-picker.css` anchor | warning |

### ed-inspector — the signature: token chips everywhere
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Sections Position · Size · Layout · Fill · Corners · Border · Effects · Type in the board's order | — | match | `client/v2/inspector/sections.js:16-165` | verified (element) |
| both | Values are numbers + Bind ("999" corners) | "Round", "Space 24", "Ink", "Resting" chips | numbers | `token-chip.jsx` | not-a-finding (fixture) |
| both | Interaction / Export / "Tokens it uses" not in view | — | below the fold / under Advanced | `sections.js:102,157`, `advanced-rows-default.jsx:6` | not-a-finding |

### ed-pen — the signature: pen hint pills
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The four hints are one dark HUD bar pinned 72 px above the toolbar, not light pills grouped next to the path | `.ed-hint` × 4: `--bg-2`, `--radius-pill`, `--shadow-sm` + island edge | `.ed-pen-hints` one bar, `--maude-hud-bg`, 6 px radius, fixed bottom-centre | `editing/pen/overlay.tsx:27-32,57-68` | blocker |
| both | Point chips ("Smooth", "Sharp", "Click here to close", angle) are mono, 3 px radius | UI face, pill | mono | `editing/pen/overlay.tsx:21-26` | warning |
| both | Point inspector (Corner, X/Y, Stroke ends, Combine shapes) not reached | — | — | drive | not-a-finding |

### ed-edge-ask · ed-edge-keys
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both (ask) | Inline "Ask AI…" composer with a "1 element" chip | — | match | `editing/ask-bubble.tsx` | verified (element) |
| both (ask) | Focus-order pills with path codes ("1.3.2.1") are drawn on the selection during ⌘/, and linger on ed-edge-ai and ed-edge-undo | none | dotted path pills | `editing/tab-order.tsx:163` (mono) — shown outside keyboard mode | warning |
| both (keys) | Numbered focus marks are hierarchical path codes in mono, not the board's simple numbered rings | rings 1–6 | "1.1 · 1.2 · …" pills | `editing/tab-order.tsx` | warning |

### ed-edge-huge
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No contextual minimap, no sticky name, no "You're looking at 1727–5636 of 6000" | minimap + sticky chip | fit view | `editing/minimap-context.tsx`, `editing/sticky-name.tsx` (appear while zoomed in; the drive stayed at fit) | warning (unproven) |

### ed-edge-undo
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | "Undo history · newest first" popover with rows + Version history | — | match | `client/v2/undo/undo-history.jsx` | verified (element). AI rows = lane |
| both | The popover sits bottom-left over the canvas, not against the left rail | left rail | bottom-left | `undo-history.jsx` / `undo.css` | warning |

### ed-edge-ai · ed-edge-tereza · ed-edge-paste
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | AI-owned footer + "AI is drawing the footer"; Tereza's ring; Figma paste bar | — | not reachable | signed-out AI / no collaborator / no Figma clipboard (`editing/paste-bar.tsx` exists) | unverified (lane) |

### dark (all frames)
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark | Canvas toolbar is a washed light pill with faded glyphs | solid dark island | light, low contrast | `toolbars/toolbar-css.ts:23` (`--island-bg` fallback); cause unconfirmed | warning |

## Root causes that hit several artboards

1. **The HUD speaks mono.** 19 files in `apps/studio/editing/` (preset-ruler, pen/overlay, align-bar, gap-bands, nudge, reorder-slot, tab-order, artboard-guides, corner-dots, size-ghost, sticky-name, minimap-context, token-ruler, …) set `--maude-chrome-font-mono`. The board sets every HUD label in the UI face, `--type-xs`, semibold, tabular-nums, and the DS rule is "Mono only in Advanced and code" (README §Type). One shared HUD-label token fixes resize, arrange, tidy, lay-auto, reorder, pen and keys.
2. **Hints are HUD boxes, not pills.** The board has one hint vocabulary, `.ed-hint` (`--bg-2`, pill, `--shadow-sm` + island edge). The impl has three: a bordered box (`preset-ruler`), a dark bar (`pen/overlay`) and chips (`pen` chips).
3. **The lit preset uses the wrong colour.** It is the HUD accent, not `--guide` (`preset-ruler.tsx:76-83`), while the board lights the stop and guide in magenta.
4. **Focus-order pills leak outside keyboard mode** (`tab-order.tsx`). They add noise to ask/ai/undo frames and use path codes where the board uses simple numbers.
5. **Token chips are unproven,** not missing. Stage B needs a system-styled canvas (values bound to `var(--space-*)`, `--radius-*`, `--shadow-*`) to judge ed-inspector and ed-lay-auto.

## What's working (preserve)

- The full resize choreography: ghost, guide, ruler, bubble, hint. The words match the board.
- The inspector's section order and copy ("Set by Services · 2 of 3", "Convert children to absolute position"), the instance inspector, the ⇧I picker structure.
- The magenta gap bands and the reorder slot marker.

---

## Verdict

```json
{
  "agent": "signature-moment-critic",
  "iter": 1,
  "blockers": 1,
  "warnings": 3,
  "aspiration_score": 3.3,
  "axes": {
    "signature_moment": { "score": 3, "weight": 1.5 },
    "brand_prominence": { "score": 3, "weight": 1.0 },
    "mock_fidelity": { "score": 4, "weight": 1.0 },
    "restraint": { "score": 3, "weight": 1.5 },
    "negative_space": { "score": 4, "weight": 1.0 }
  },
  "specificity": "pass",
  "specificity_findings": [],
  "top_blockers": [],
  "opt_out_applied": "palette",
  "passed": false
}
```

```json
{"canvas":"14 Editing","critic":"signature-moment-critic","blockers":4,"warnings":35,"verified_ids":["ed-ab-select·light","ed-ab-menu·light","ed-obj-enter·light","ed-obj-order·light","ed-lay-free·light","ed-text-style·light","ed-comp-instance·light","ed-inspector·light"]}
```
