# signature-moment-critic — 04 Modes (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/04 Modes.tsx` vs the live app (pairs in `04-modes/`) · type: product surface (mode switch, Preview, Present) · aspiration score of the IMPL against the board: **3.3/5**_

Read-only review. Lens: the mode switch and its morph (signature moment 1, 04 Modes.tsx:740: panels fold into their icons, the toolbar swaps, the camera eases), Present lifting the artboard into the dark (signature moment 2, :777), and the Present overview / Present-the-canvas. Fixture differences (stand-in Homepage, 5-artboard Combine-kampan, local project) are not findings.

## TL;DR

**Aspiration: 3.3/5** · Specificity: pass · Verdict: fix-and-retry

The machinery is all in the code: the fold ghost (`fold-ghost.js`, floating-panels.css:233), ToolbarMorph (`tool-palette.tsx:415`), the Preview pill fading in over `--dur-panel`, the Present stage mask with a 280 ms lift (`present/present-stage.tsx`), and the mode glyphs, which are the kit's own pencil-ruler, eye, easel and glasses (`mode-switch.jsx:25` = `_kit.tsx:858`). The INDEX's "glyph looks different" is not a finding. The frames still don't read as "the canvas, waking up". Preview keeps Edit's selection chrome (blue outline, "div · 1440 × 900" tag, "≤ 1440px" chip, numbered 1.1/1.2/1.3 badges), the left panel stays open in several Preview frames, and an AI edit in Preview shows no live tag.

## Per-artboard differences (lens: signature moments)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| md-preview · both | Edit selection chrome stays drawn in Preview: outline, size tag, breakpoint chip, numbered element badges | clean artboard, "Clicks on the design: use it" (md-model table) | the artboard keeps the Edit selection plus badges | the mode handoff never drops the Edit selection (`use-tool-mode.tsx:248` set-mode path; shell `use-canvas-mode-lane.js:4`) | blocker |
| md-annotate · both | Same selection chrome over the end-state toolbar. The toolbar set itself matches (hand armed, annotation tools) | — | — | same | blocker |
| md-preview-combine · both | A4 keeps the selection outline. Camera lands at 65 % on one artboard where the spec shows a whole-canvas overview | all boards, "Playing" badge, sticky | one artboard | selection: same. Camera: C6 `preview-chrome-host.jsx` | blocker |
| md-edge-ai · both | No live AI tag on the previewed artboard while the AI edits, and no Made-by-AI ring after | orange "AI's new hero · shown live" tag at the artboard corner | none; Post keeps the Edit selection | ring lane `ring-relay.js` + 03 root (`runs-store.js:94 markDone` has no caller) | blocker |
| md-edge-ai · both | Selection outline and size tag in Preview | — | — | as md-preview | blocker |
| md-preview-follow · both | The left Canvases panel is open after following a link to Pricing. The fold signature undoes itself on a canvas change | panel folded into its corner icon | panel open | `use-canvas-mode-lane.js:52 wantsFold` folds only on a chosen mode switch (nonce > 0). A canvas change inside Preview re-shows it | blocker |
| md-draw · md-inspect · md-comment · md-present-menu · both | Left panel open in Preview (may be harness order; re-check after fixing the row above) | folded | open | same | warning |
| md-present-lift · both | No lift was caught: at 0.45 s the frame is already full-screen. The stage mask is `var(--bg-0)`, not the board's always-dark `--object-ink` (04 Modes.css:128), so in light theme the other artboards would sink into light, not dark | dark stage, "Present · Artboards 3 of 14" | full-screen page | `present/present-stage.tsx:331` | warning |
| md-present-full · both | No dark ground is visible: the 1440×900 web artboard fills the window, which is fixture aspect. The presenter pointer dot and trail were not driven | pointer dot + trail | none | `presenter-*` | warning |
| md-edge-mixed · both | The per-kind Present run (web fills width, post fits height, reel plays, print at trim, banner letterboxed) was not reached. The frame is Present-the-canvas | 6 treatments | canvas mode | `present/fit.ts` (not driven: needs a mixed-kind canvas) | warning |
| md-keys · both | The pressed segment does not visibly slide; no transition on the mode segment | "only the pressed segment moves" (md-motion note) | instant | `v2/shell/mode-switch.jsx` | warning |
| md-motion · both | Animation storyboard, not a state. The fold ghost, ToolbarMorph and camera ease exist in code but have no frame evidence | — | — | `fold-ghost.js`, `tool-palette.tsx:415`, `preview.css:15` | n/a (unverified) |

**Verified in this lens:** md-model (switch, glyphs = kit), md-present-canvas (pill "Presenting the canvas · N % · esc to leave", no chrome; the spec's "the camera simply stays" holds), md-esc. Each in dark and light.

**Unreachable:** md-present-video needs a footage-backed 9:16 video artboard in the fixture. md-presenter needs a second display (desktop). md-present-link, md-comment-only and md-edge-viewer need a hub project and roles. md-edge-offline needs the desktop shell offline.

## Root causes
1. **Preview does not clear Edit's selection overlay.** That one gap breaks the "canvas, alive" moment on 4 boards.
2. **The fold only runs on a chosen mode switch** (`wantsFold` nonce). A canvas change inside Preview brings the left panel back.
3. **The AI ring never reaches a previewed artboard after the edit.** This is the 03 done-ring root (markDone has no caller).
4. **The Present stage mask follows the theme** (`--bg-0`), where the board's stage is always ink.

## Axis scores (IMPL against the board)

| Axis | Score | Weight | Weighted | Verdict |
|---|---|---|---|---|
| Signature moment | 3/5 | 1.5 | 4.5 | Morph and lift are built; the Preview frames are polluted by Edit chrome |
| Brand prominence (the mode switch as identity) | 4/5 | 1.0 | 4.0 | Glyphs, pill and Present controls match the kit |
| Mock fidelity | 4/5 | 1.0 | 4.0 | Present menu, controls pill and Preview pill are real |
| Restraint | 3/5 | 1.5 | 4.5 | Selection badges and size tags add noise to a mode that promises none |
| Negative space | 3/5 | 1.0 | 3.0 | An open left panel in Preview eats the immersive frame |
| **Specificity gate** | **pass** | — | — | — |

Weighted total: 20.0/30 → **3.3/5**

## What's working
- The mode switch glyphs and the Present menu rows. The "Previewing Homepage · esc to edit" pill. The Present-the-canvas pill.
- Annotation toolbar end state (hand armed, Preview's own set).

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
    "brand_prominence": { "score": 4, "weight": 1.0 },
    "mock_fidelity": { "score": 4, "weight": 1.0 },
    "restraint": { "score": 3, "weight": 1.5 },
    "negative_space": { "score": 3, "weight": 1.0 }
  },
  "specificity": "pass",
  "specificity_findings": [],
  "top_blockers": [],
  "opt_out_applied": "palette",
  "passed": false
}
```

```json
{"canvas":"04 Modes","critic":"signature-moment-critic","blockers":6,"warnings":6,"verified_ids":["md-model-dark","md-model-light","md-present-canvas-dark","md-present-canvas-light","md-esc-dark","md-esc-light"]}
```
