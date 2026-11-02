# a11y-critic — 12 Import and Assets (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/12 Import and Assets.tsx` · impl = stage A frames (browser lane + Tauri stub) · standard: WCAG 2.1 AA (no project a11y-rules skill)_

Method: every pair read, both themes. Contrast **measured on the raw impl frames** (`.scr/impl/12-import-and-assets/`), because several pairs here (`ia-assets-find`, `-tidy`, `-details`, `ia-advanced`, the brand/figma sheets) scale the impl half down and antialiasing would understate it. Spec values come from the board pixels and the v2 token math. Fixture-only differences ("(fixture)": the plasma JPEGs, no AI / tagged / used-in assets, a single-`<img>` artboard, a local project) are not findings.

Global facts: the shell is on the v1 indigo ladder. Every measured text in the Assets panel, inspector and import sheets passes. fg-1 8.7–9.4:1 / 8.1–9.2:1, fg-2 5.4–5.9:1 / 5.0–5.8:1, error text 6.27:1 dark / 5.87:1 light, primary buttons 6.0–6.3 / 5.7–5.8:1. All three import sheets are `role=dialog aria-modal aria-labelledby`, with labelled fields, `role=alert` errors and `aria-live` reading rows (`v2/import/figma-sheet.jsx:226-497`, `brand-sheet.jsx:195-385`). Tiles are real `<button aria-pressed aria-label>` (`v2/assets/tile.jsx:49-58`), and ↵ places through `assets.place` (`actions/shell-key-handlers.js:177`). Motion runs on `--dur-*` tokens and collapses under reduced motion.

## ia-drop-photos (partial)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | No "Drop to place 6 photos in Fotky ze zápasu" chip on the target and no ghost stack. Only a dashed outline around the whole window, which names no target and announces nothing | blue chip on the artboard + stack with "6" | dashed frame only | The hint exists in the canvas (`apps/studio/editing/finder-drop.tsx:350` `role=status`, words from `edit-ops/place-plan.ts:47-49`). The lane dispatched the synthetic drag on the shell, not into the canvas iframe, so the state was never shown | blocker (state not shown; re-shoot with the drag inside the canvas or through the desktop e2e harness) |

## ia-placed ✓ (fixture-limited)
The fixture artboard holds one `<img>`, so "Not placed. That picture does not fit there; try another." is the correct product answer: `role=alert` (`left-panel/assets-panel.jsx:506`), 15.9 / 17.1:1. "Just added 6" group present. Size tag "img · 480 × 360" dark ink on #698fff 6.25:1, white on #3a5ad7 5.69:1. Disabled W/H fields 4.5 / 4.6:1 (exempt). No upload ring: (fixture: local project). No difference in lens.

## ia-assets-panel (partial)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | "All kinds ▾" filter missing, so there is no keyboard way to narrow the kind | chip with a menu beside "Not used" | absent | `client/v2/left-panel/assets-panel.jsx:620-640` (filter row) | blocker |
| dark · light | Foot "247 assets · 1.4 GB" absent (status line) | fg-2 foot | — | same | warning |
| dark · light | Video / Sound / Logos / Generated groups | — | (fixture: photos only) | — | — |

"Not used" chip `aria-pressed` (`assets-panel.jsx:628`), pressed state filled accent 6.26 / 5.80:1. Group heading buttons `aria-label="Photos, 19. Browse"`.

## ia-assets-keys

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | The tile menu (Place in … ↵ / Show details / Rename… / Copy / Move to trash) opens only on `contextmenu`. There is no keyboard opener (⇧F10 / ContextMenu key / a "…" button) | menu beside the selected tile | right-click only. ↵ place and ⌘I details exist as keys | `client/v2/assets/tile.jsx:59-63` | warning |
| dark · light | Selected tile caption "pic.png Used in 2 c…" clipped; it is `aria-hidden`, and the aria-label carries the full words | — | — | `tile.jsx:93` | — |

Tile menu itself: `role=menu`, ↑↓, Esc, focus to the first item (`tile-menu.jsx:52-69,93-102`).

## ia-assets-browse

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | The wide browse panel covers the canvas toolbar (only its "…" end shows), so focused toolbar buttons are hidden under the panel | the panel stops above the toolbar row, leaving a gap | the panel runs to the bottom; the toolbar sits behind it | `client/v2/left-panel/left-panel.css` browse view (`.lp-browse`) z-order/height | blocker |
| dark · light | Large / Small segment: pressed = bg-2 + shadow-sm, no accent ring (≈1.2:1 fill vs track) | kit pressed segment with the accent hairline | text weight only | `left-panel.css:1281-1301` | blocker |
| dark · light | No pick circles on the thumbs, so multi-select (⌘/⇧-click, `multi-select.js`) has no visible affordance; the "N selected · Place N in … ↵" foot appears only once picked | circles on every thumb | none until picked | `client/v2/assets/browse-view.jsx:147-189` | warning |

Filenames 8.7 / 8.9:1, date group 5.4 / 5.6:1, search placeholder 4.85 / 5.05:1. Size group `role=group aria-label=Size`, `aria-pressed`.

## ia-assets-find (partial)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | States 2–4 (the "Describe the pictures in …?" consent sheet, "Seen in the picture" results, AI not connected) not reachable | 4 columns | state 1 only (AI stub signed out) | `assets/describe-consent.jsx` (code exists). Needs a connected AI stub in the lane | blocker (states not shown) |

State 1 in lens: offer card 14.7 / 16.5:1, "Turn on…" a real button. Pass.

## ia-assets-tidy (partial)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Foot "31 assets · 212 MB / Move 31 to the trash…" not in the frame. `TidyFoot` renders it whenever count > 0 (`tidy.jsx:64-82`, here 17), so it is probably below the panel scroll | foot pinned at the panel bottom | not visible | `left-panel/assets-panel.jsx:819` (foot not pinned) | warning |
| dark · light | "Not counted: …" note | — | (fixture: no older versions / AI takes, so the note is empty by design) | — | — |

## ia-asset-details (partial)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Back control shows no chevron (the glyph does not render), so "Assets" reads as a heading, not a way back | "‹ Assets" | text only (still a `<button>`) | `client/v2/assets/details.jsx:122-130` | warning |
| dark · light | Place button does not name its target | "Place in MVP zápasu ↵" | "Place ↵" | `details.jsx` | warning |
| dark · light | "Used in" rows have no chevrons; they are buttons with `aria-label="Open …"` (`details.jsx:230-237`) | chevron rows | text rows | same | warning |
| dark · light | Added-by avatar, "AI saw" chips, Made-by-AI / clip / sound variants | — | (fixture) | — | — |

Size key 5.0 / 5.8:1, values 15.9:1.

## ia-advanced ✓
Advanced fold: Stored as / In canvases with a labelled Copy. Missing rows (Original / Edits / Cut-out, the Terminal snippet) are content, not a11y. No difference in lens.

## ia-photo-inspector

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | The Photo section (Placement, 8 Look tiles, Light/Colour sliders, Remove background, Replace/Reset, "Apply to every use…") never mounts, so none of its controls can be reached. The generic element inspector shows instead | photo card | `Hero › img` inspector | `client/inspector/inspector-panel.jsx:641` (`effTab === 'photo' && photoTarget && photoPerUse`). Find why a placed `assets/*.jpg` `<img>` gets no `photoTarget` | blocker |

Generic inspector in lens: help text 5.86 / 5.77:1, Fill/Fit/Crop/Tile pressed fill #383e44 vs track #22272d (no ring, same segment root cause).

## ia-photo-steps — **unreachable** (same cause as above). Blocker ×2.

## ia-gen-ask

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | The ask names no target. The board's "Gameweek 5 photo ▾" chip is replaced by an up-front error ("Select an artboard first…", `role=alert`, 6.27 / 5.87:1) that is not tied to the textarea | target chip + aspect row | error line | `client/v2/assets/generate-ask.jsx:238-330` | warning |
| dark · light | Time/cost line ("About 30 s · billed to your Google key") and the watermark note absent | fg-2 lines | — | same | warning |

Textarea `aria-label`, takes select `aria-label`, Advanced `<details>`, ⌘↵ / Esc.

## ia-figma-sheets · ia-figma-sheets-connect

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light (both) | A disabled primary (Import with an empty link; Connect with an empty token) renders as an outlined accent button with fg-2 text (5.6:1), so it looks like an enabled secondary. The board greys it out | grey disabled pill | outlined accent | kit `.btn--primary:disabled` (`client/styles/4-components-maude.css`) | warning |
| dark · light | Sheet 3 (pick frames, where they go) not reachable | drawn | needs the Figma API | `figma-sheet.jsx:359-389`. Needs a stubbed Figma file fetch | blocker (state missing) |

Field focus = DS input recipe (accent border + tint). Steps list and keychain line 5.4–9.4:1.

## ia-brand-steps ✓ · -1 ✓ · -3 ✓ · -2

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| -2 dark · light | "Reading…" row + progress not captured (flashes past with no network). The progress is `aria-hidden`; the row is `aria-live` | Reading… with bar | jumps to Couldn't read | lane timing | warning |

Couldn't-read word 9.4 / 9.2:1 beside a warn dot (state is in words, not colour alone), callout 7.8 / 8.1:1, `role=alert`. "Continue with the logo" is absent only because no logo was chosen (fixture).

## ia-missing-gone

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | The Missing frame collapses to a ~14 px hatched strip: the card is clipped after the file name, so "Missing — no device has it" and **Relink…** are cut off and unreachable by pointer | full-frame hatch + centred card + Relink… | `.dc-absent{overflow:hidden}` sized to the broken `<img>`'s own rect (no authored height, so it collapses) | `apps/studio/asset-placeholder.tsx:119,239-247` (needs a min box) | blocker |
| dark · light | Inspector "Missing · Added by Tereza…" card not opened in the shot | — | unverified | — | warning |

The group has `role=group aria-label="<file> · <line>"` (`asset-placeholder.tsx:278-280`). Filename 16.2 / 17.1:1.

## Unreachable (spec-only)
- **ia-more-ways**: paste, a video file, a logo. Native picker/paste; needs desktop e2e.
- **ia-gen-placed**: four takes, ← → between them. Needs a generation provider stub (BYOK) for `takes-overlay.jsx`.
- **ia-figma-arrived**, **ia-figjam**: need a Figma API stub.
- **ia-brand**: needs a reachable site fake for `brand-result.jsx`.
- **ia-missing**: "Waiting for Jonas's Mac". Needs a synced peer that holds the file.
- **ia-edges**: nine conditions (huge file, twice, .psd, offline, other person's, link, Figma access, no Google key, HEIC). Needs a per-condition fake.

7 artboards plus ia-photo-steps = 8 × 2 themes = 16 blockers (states not verifiable).

## Root causes
1. **Segments re-implemented without the pressed ring.** Browse Large/Small (`left-panel.css:1298`), the inspector Fit row, and the same on canvases 10/11.
2. **Overlays sized to collapsible content.** The Missing card is clipped by `overflow:hidden` on a 14 px rect (`asset-placeholder.tsx:119`). The wide browse panel overlaps the toolbar.
3. **Photo inspector gating.** `inspector-panel.jsx:641` never resolves a `photoTarget` for a plain placed asset image. That keeps every photo control (and ia-photo-steps) out of reach.
4. **Controls the board draws that the panel lacks.** All-kinds filter, pick circles, a keyboard opener for the tile menu.
5. **A disabled primary looks enabled.** Outlined accent rather than greyed.
6. **The lane cannot drive drop, AI, Figma or brand network states.** Half the canvas is unverified in this lens until stubs exist.

```json
{"canvas":"12 Import and Assets","critic":"a11y-critic","blockers":32,"warnings":19,"verified_ids":["ia-placed·dark","ia-placed·light","ia-advanced·dark","ia-advanced·light","ia-brand-steps·dark","ia-brand-steps·light","ia-brand-steps-1·dark","ia-brand-steps-1·light","ia-brand-steps-3·dark","ia-brand-steps-3·light"]}
```
