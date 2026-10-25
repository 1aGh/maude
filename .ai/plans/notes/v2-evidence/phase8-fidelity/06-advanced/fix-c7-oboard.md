# Phase 8 stage C round 7 · c7-oboard (06 Advanced + 07 Video editing) — done vs open

Branch `p8-c7-g0607` from feat/maude-v2 00aedfb0a. Budget: ~300k tokens; the harness work (assembling the layered g2 / g3
harnesses in a new worktree) took a third of it, so the list below is short and the open list is real.
Nothing here is marked "matches": the lead's critic judges the re-shot pairs.

## Done (commit · what · test red → green)

| commit | what | tests |
|---|---|---|
| 794901a71 | **07 M1 label form.** A video artboard's label reads `Name · Format · Length` (`Hype trailer · Reels · 0:14`) at rest and, selected, ends with the size chip (`  1080 × 1920`). Format word from the comp's own size (Reels for 1080×1920, else the reduced ratio `16:9` / `1:1` / `4:5`, nothing for an odd ratio); not told twice when the label already says it (a size, the word, a `m:ss`). The length **floors** like the Length row, the timeline readout and the ruler (the canvas label rounded: `0:29` beside `0:28`). The comp stamps `data-dc-vtail` on its label when it registers; the label's `::after` draws it; the selection overlay swaps in the tail + chip. New pure module `editing/video-label.ts`. | `p8-c7-video-label` (6 + wiring) — red with floor→round |
| (next) | **06 ad-search glyphs.** `Allow longer videos` (clock), `Hidden files` (eye), `Keep timeline open` (pin), `Layers as a panel` (layers), `Open / Close all Advanced sections` (plus / minus): no stand-in chevron left in the ⌘K list. | `p8-c7-oboard-palette-glyphs` — red before; `p8-c2-kitadv-icons-copy` updated (its "unknown action" example was one of these) |
| (next) | **06 ad-inspector.** Element id ends in the quiet copy glyph (board), not a "Copy id" button; the id field gets its width back. | `v2-inspector-render` copy test — red with the `icon` prop off |

### Harness (shared by 06) — `_c7o-harness-g2/`, `_c7o-harness-g3/`
- `s06f.mjs`: ad-inspector shoots the open fold's body scrolled into frame (the stage-D shot cut it at "Element"); **ad-diag is now the Menu › Diagnostics submenu** (pill → Diagnostics), what the board draws, not the sheet again; **ad-settings is the Advanced tab** (it opened General); ad-logs runs with `__TAURI__` still on — `s06b` deleted it for ad-share and never put it back, which is why "Show in Finder" was absent (a desktop-only row).
- `t07.mjs` ve-play: pauses, turns the loop on and steps two frames (readout `+ 2 frames`, the step tip).
- `chain6.sh`, `chain7.sh`, `r6.sh`, `go7.sh`: one chromium chain at a time.

## Decided against (conflicts between boards — the owning board wins)

- **ve-fullscreen picture inset + bar floating below it** (07 · M3 layout). `04 md-present-video` owns Present and draws the video filling the stage height; the two Present tests that pin it (`present-media`: "pillarboxed, never cropped", "16:9 fills the stage") would have gone red for 07's inset. Tried (reserve in `fitForKind`), reverted. The ve-fullscreen difference stays; if the lead wants 07's layout, 04 has to change first.
- **ad-timeline raw keys** (`fps`, `durationInFrames`, `codec`): `07 ve-advanced` (the owner of the timeline) draws exactly these mono keys; `06 ad-timeline` draws Frame rate / Codec. Kept the owner's.
- **ad-left extra rows** ("Open canvas", Trash Empty/Open inside the fold): both are in `client/v2/nothing-deleted.json` (V2-4.8b moved the active path there; the fold's Trash row is the only door to an empty Trash). Not removed without a lead decision.

## Open (not done; why)

06: ad-ai glyphs on Raw log / Copy transcript / Open in terminal and the orphaned "AI may" heading (03 owns the fold — p8-c7-ai); ad-export Advanced body one column + File names pattern + "From the terminal" blocks + Exact scale (09's, p8-c7-ex10); ad-history seg + Compare / Restore row (11's); ad-pinned (Canvases collapses while pinned = the `display: contents` wrapper bug, and the harness pins only AI); ad-ds (specimen view not landed); ad-edge-syntax "Ask AI to fix it" button; ad-logs extra Refresh icon + title row + x (the sheet is a dialog: it needs its name and a way out); Element group still carries POS / SIZE / FILL / TEXT / FONT rows and a long scoped selector (the board draws Tag / Classes / Selector / Element id).
07: ve-transition picker anchoring; ve-text "Title · Slide up" tag on the artboard; ve-captions transcript card (fixture has no speech); ve-music "Fade in · out" row and the Music bed lane label on an empty bed; ve-formats unlinked-copy button + sibling artboards (3-format fixture); ve-footage preparing bars; ve-export single-artboard sheet cards; ve-render Share-cluster ring + toasts; ve-long fold rows / markers. M2 (toast) was already the kit pill at the top with Undo on the merged tip — the critic's note was from an older client.

## Decisions
- `decision:maude/v2-p8-c7-video-label-tail`: the label's format + length are DATA the comp stamps on its label (`data-dc-vtail`), drawn by `::after`; the author's name text is never rewritten. Rejected: appending to the stored label (stale on a length edit, doubles an author's own "· Reels · 0:30"), a React child in canvas-lib's label (canvas-lib must not know comps).
- `decision:maude/v2-p8-c7-present-video-04-wins`: Present · video keeps 04's fill; 07's inset is not drawn. Rejected: a per-entry-point fit (the shell's mode switch and the artboard Present are one stage).
