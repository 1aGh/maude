# copy-critic — 04 Modes · phase 8 stage B

_2026-10-22 · board `.design/ui/v2/04 Modes.tsx` · impl = release client, pairs in `.claude/worktrees/agent-a45b4750975bd8337/.scr/pairs/04-modes/` · voice: CONTRACT §2 keys, §3 words, §4 voice · strings reviewed ≈ 230_

**Themes.** Copy is the same in both themes. I read the dark pairs; each row covers **D·L**.
**Fixture.** Not findings: the "YO · Local project" cluster (C3), the stand-in Homepage, Pricing and Combine-kampan content (C4), zoom values, the camera (C6), and the flat 13-canvas list.

## TL;DR

**Blockers: 5** · Warnings: 21 · Verdict: **fix-and-retry**

The mode chrome reads exactly like the board: `Previewing Homepage · esc to edit`, `‹ Homepage`, `Presenting the canvas · 66% · esc to leave`, `1 / 3 · Desktop · esc to leave`, and the Present menu rows. The breaks are around it. The Inspector names elements by raw tag (`button`, `section`, crumbs `div › section › div`) and shows `Uses project ↗`. In Preview, AI's live change is tagged `editing — Combine-kampan.tsx` rather than in AI's voice. The Inspect panel (⌘-click in Preview) doesn't open, so none of its spec words can be checked.

## Per artboard (D·L)

| id | difference | spec (board) | impl | owner | sev |
|---|---|---|---|---|---|
| md-model | doc board. Live: the switch has 3 segments (no Viewing for an owner ✓). The segment words live in `aria-label` / `title` only ✓ | — | — | `client/v2/shell/mode-switch.jsx:212-257` | — |
| md-keys | hover words + keys not visible in the frame (headless shows no native `title` tooltip) | glyph words Edit · Preview · Present · Viewing + ⌥⌘P … | none rendered | `mode-switch.jsx` (title-attr only; no kit Tooltip) | warning |
| md-keys | **board is stale**: "Still proposed: Preview ⌥⌘P, Present ⌥⌘↵, Present from the start ⇧⌥⌘↵, the L pointer, and Viewing" | — | CONTRACT §2 lists them as decided [A7] | board `04 Modes.tsx:1016` | warning |
| md-edit | Inspector title is the raw tag | `See pricing` · chip `Button` | `button` · `Button` | `client/v2/inspector/model.js:27-53` (`titleOf`: the layer label is the tag; the element text is never preferred for a named control) | blocker |
| md-edit | crumbs are raw tags | none (title + kind chip) | `Desktop › div › section › div › See pricing →` | `inspector/model.js:58-64`, `inspector/crumbs.jsx` | warning |
| md-edit | design-system link with no name | `Uses <DS name>` (§7 A9) | `Uses project ↗` | `client/v2/ds/uses-link.jsx` (fallback when no system is declared; P8-B2) | blocker |
| md-edit | `On click: Go to Pricing` / `On hover: Fill with Ink` rows below the fold. The canvas chip `Go to Pricing` ✓ | — | `Interaction · On click` lower in the full Inspector | — | warning |
| md-edit | ✓ "It sits where its frame's layout puts it. Place freely makes X and Y yours." / "This system has no shadow steps." (plain, no hedging) | — | — | — | — |
| md-edit-image | Assets search advertises the global Search key | `Search assets` (no key) | `Search assets ⌘K` | `client/v2/left-panel/assets-panel.jsx:592` | warning |
| md-edit-image | the placed-image tag was not reached | `Hero image · fills, cropped to fit` | — | harness (no drop) | warning |
| md-edit-image | ✓ `Photos 7` · `From this Mac…` · `Not used` | — | — | — | — |
| md-edit-component | the Inspector behind the picker is named by tag | — | `section · Frame` | `inspector/model.js:27-53` | blocker |
| md-edit-component | picker isn't headed by the system's name | `Studio site system` · Button `3 variants` · Primary/Secondary/Ghost | groups `Brand` / `Components`, no system name | `client/v2/inspector/component-picker.jsx` | warning |
| md-edit-component | ✓ `Search components` · `Open Design system`. Placed tag `Button · Secondary` not reached | — | — | — | — |
| md-edit-component | CSS jargon as an action label | (06: "Convert to absolute…", under Advanced) | `Convert children to absolute position` | `inspector/kinds/frame.jsx:72` | warning |
| md-motion | **unreachable**: an animation, not a state | — | — | — | n/a |
| md-annotate | ✓ Preview toolbar set and order (icons only) | — | — | — | verified |
| md-preview | ✓ `Previewing Homepage` · `esc to edit` | — | — | `client/v2/preview/` bar | verified |
| md-preview-follow | ✓ `‹ Homepage` · `Previewing Pricing` · `esc to edit` | — | — | — | verified |
| md-preview-combine | `Playing` / `Scrolls` chips absent (no video artboard in the fixture) | `Playing`, `Scrolls` | — | fixture | warning |
| md-present-menu | ✓ `Artboards, one by one` · `Present from "Tablet"` ⌥⌘↵ · `Present from the start` ⇧⌥⌘↵ · `The canvas, pan freely` · `Present the canvas · no chrome, no pins` · `Order and notes…` · `Copy presentation link · in a cloud project`. The `Presenter view on another display` row is desktop-only (not a finding) | — | — | `mode-switch.jsx:95-133` | verified |
| md-present-menu | the Preview sticky hint toast is still on screen after the mode change | — | `⌘Enter commits and creates the next one beside it.` | `apps/studio/annotations-layer.tsx:2776` (showOnceHint outlives the mode) | warning |
| md-present-lift | end state ✓ `1 / 3 · Desktop · esc to leave` (spec `3 / 14 · Post 1:1 · Combine 2026`, fixture) | — | — | `client/v2/present/present-controls.jsx` | verified |
| md-present-full | the controls had faded by capture time. Word order matches present-lift | — | — | — | — |
| md-present-video | **unreachable**: needs a footage-backed video artboard. `0:06 / 0:15` transport unverified | — | — | fixture media | warning |
| md-present-canvas | ✓ `Presenting the canvas · 66% · esc to leave` | — | — | `client/v2/present/canvas-pill.jsx:41-51` | verified |
| md-presenter | **unreachable**: second display (desktop) | — | — | — | warning |
| md-present-link | **unreachable**: hub viewer link. `Tereza is on 6 of 14 · you're on 5` · Catch up unverified | — | — | — | warning |
| md-comment | composer header names only the artboard | thread head `Pricing · Desktop` (canvas · artboard) | `Tablet` | `apps/studio/canvas-comment-mount.tsx` composer head | warning |
| md-comment | Comments panel, Resolve, @mention `Jonas · Can edit` weren't driven | — | — | harness | warning |
| md-comment | **board is stale**: filters `Open 3 · Mine 1 · Resolved 2` | CONTRACT §6 C7: Open · Mine · Resolved · **All** | — | board `04 Modes.tsx:645` | warning |
| md-comment-only | **unreachable**: Can comment role (hub). `@ to mention` · Cancel · Post unverified | — | — | — | warning |
| md-draw | hint uses the key name and jargon | §2: the Return glyph is ↵; plain words | `⌘Enter commits and creates the next one beside it.` | `annotations-layer.tsx:2776` → "⌘↵ adds the next one beside it." | warning |
| md-draw | ✓ sticky bar `Medium` · `Resolve` · `Turn into a comment`. The AI layer-read turn ("Do what the stickies…", `The crest` / `The lockup`) wasn't driven | — | — | — | — |
| md-inspect | the Inspect panel doesn't open on ⌘-click in Preview, so none of its words show | `Size and spacing` · `Gap to About 48` · `Colour and type` · `Export PNG 1× / 2× / SVG / Handoff…` · `Copy code` · `Edit ↵` · `Advanced · CSS` | only the tag `Book a call · 97 × 35` | `client/v2/inspect/` (⌘-click route in Preview) | blocker |
| md-edge-ai | AI's live change is tagged with a lowercase verb and a file name | `AI's new hero — shown live` (AI voice, §3) | `editing — Combine-kampan.tsx` on both artboards | `apps/studio/artboard-activity-overlay.tsx:68` | blocker |
| md-edge-ai | the canvas banner hedges (not in the frame) | — | `AI is editing this canvas — your changes may conflict` | `apps/studio/ai-banner.tsx:181` ("may" = hedging, §4) | warning |
| md-edge-viewer | **unreachable**: hub + Can view. `Previewing matchday · esc for Viewing`, the viewer menu `Version history · to look` unverified | — | — | — | warning |
| md-edge-mixed | doc board. Live = canvas mode ✓ pill | — | — | — | — |
| md-edge-offline | **unreachable**: presenter view offline (desktop) | — | — | — | warning |
| md-esc | ✓ Preview → esc → Edit (one row) | — | — | — | verified |

## Board is stale (CONTRACT wins)

- `md-keys` still calls the A7 keys "proposed". CONTRACT §2 / §1 has them decided.
- The `md-comment` filter row lacks **All** (CONTRACT §6 C7).

## Root causes

1. **The Inspector names things by code, not by what people see** (`inspector/model.js titleOf/crumbsOf`), and there's a nameless DS link (`Uses project`). Hits md-edit and md-edit-component.
2. **The v1 activity overlay speaks for AI** (`artboard-activity-overlay.tsx`: `editing — <file>`). §3/§4 want "AI is …" words about the work. Hits md-edge-ai.
3. **Once-hints outlive their mode and use key names** (`annotations-layer.tsx showOnceHint`). Hits md-draw and md-present-menu.
4. **The Inspect face of the Inspector isn't reachable in Preview.** Hits md-inspect.

```json
{"canvas":"04 Modes","critic":"copy-critic","blockers":5,"warnings":21,"verified_ids":["md-annotate-dark","md-annotate-light","md-preview-dark","md-preview-light","md-preview-follow-dark","md-preview-follow-light","md-present-menu-dark","md-present-menu-light","md-present-lift-dark","md-present-lift-light","md-present-canvas-dark","md-present-canvas-light","md-esc-dark","md-esc-light"]}
```
