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

---

# Round 7b (p8-c7-g0607b) — continuation: done vs open

Branch `p8-c7-g0607b`. Harness fixes the previous builder left uncommitted are in `_c7o-harness-g2/` + `_c7o-harness-g3/` (copied, repointed).
Nothing is marked "matches": the lead's critic judges the re-shot pairs (06 and 07, light + dark).

## Done (commit · what · test red → green)

| commit | what | tests |
|---|---|---|
| 7299b26fb (**shared canvas-lib.tsx**) | **ad-pinned / ad-inspector (artboard).** A `DCArtboard` with a `kind` outside digital · web · print · video (an old `kind="social"`: the alligators Post / Story) kept that value in `data-dc-kind`, so no per-kind slot matched and the artboard inspector drew a "Size" heading with nothing under it (and no Fill row). It now resolves like no kind (digital, or video over a VideoComp). | `p8-c7b-unknown-kind` (2) — red before |
| 7bc96dee9 (+ 8e4bff541 **shared icons.jsx**: the kit's `tab` glyph) | **ad-ai.** Raw log / Copy transcript / Open in terminal carry the board's glyphs (file · duplicate · tab). | `v2-ai-chat-list-ui` (new test) — red before |
| c79d70a1d | the round-7a label CSS comment spelled `\00a0` inside a template literal (tsc TS1487, red on the lane's typecheck) | tsc clean |

## Harness (the MUSTs that were the shot)

- **ad-edge-syntax** — "Ask AI to fix it" is a desktop-only action (`isNativeApp()`); `s06b` deletes `__TAURI__` for ad-share and never puts it back. `s06h` runs with the stub ON, opens the card's Advanced fold (Error / Where / excerpt / Open in editor / Copy error / Last good version) and closes the left panel. The button and the rows are in the shot now.
- **ad-pinned** — `s06g` pins both panels and selects the Post artboard with its Advanced fold open (it pinned only the AI chat). The "Canvases collapses while pinned" claim does not reproduce on this tip.
- **ad-history** — `s06i` runs on a throwaway git repo (3 commits, a draft branch, an origin): Branch / Drafts / Remote and the git actions are drawn.
- **07 ve-trim-split** Full timeline + a held trim (tip on screen); **ve-captions** with real footage, transcript card and caption chips; **ve-music** with the song + beats file (`t07c`).

## Decided against / owned elsewhere (the owning board wins)

- **ad-history seg + Compare / Restore row**: `11 · pn-vh` draws the All / Named / Made by AI / People seg, the Now row and the `pn-vh-acts` row; 11 owns Version history.
- **ad-export Advanced body** (two columns, Exact scale, File names pattern, From the terminal): `09 · ex-advanced` owns the sheet (p8-c7-ex10b merged the File names select / Include row); 06's own sheet is a smaller drawing of it.
- **ad-left extra rows**, **ad-timeline raw keys**: unchanged, see round 7a.

## Open

- **07 ve-music "Fade in · out"**: the product has NO music fade (no prop on the music Audio, no op, no render path — `MUSIC_WORDS.fade` exists only as a word). It is a feature: an edit op `video.music.fade` (frames in / out on the one music `<Audio>`, like `<Duck>`), the comp's volume callback, the inspector row (a read-only "0.5 s · 1.5 s" note in the board, two number fields in a real build). Handed back as its own task.
- **07 ve-text** "Title · Slide up" tag on the artboard (a selection box over the title inside the video frame: needs the comp to report the title's rect).
- **07 ve-captions** Captions inspector (font · highlight · position · words at a time · also as a file) does not replace the Video inspector when a caption chip is selected in the lane (the chip highlights; the inspector stays on the video).
- **07 ve-transition** the picker is anchored on the join dot with its tip (it was already); over a small artboard at 100 % it overlaps the picture, which the board's camera avoids (a layout of the fixture, not of the picker).
- 06: ad-ai "AI may" heading (03 owns the fold, p8-c7-aimay), ad-ds specimen view (13), ad-logs title row + x, Element group rows (POS / SIZE / FILL…) under Advanced, ad-edge-syntax provenance clause ("changed outside the app 2 min ago") needs a server signal.

## Decisions
- `decision:maude/v2-p8-c7b-artboard-unknown-kind-digital`: DCArtboard resolves an unknown `kind` to the implicit default (digital, or video by content) instead of passing it through. Rejected: teaching every slot's `kindOf` the old values (nine call sites would each need the same alias list); a migration that rewrites old canvases (a canvas file edit for a display bug).
- `decision:maude/v2-p8-c7b-music-fade-is-a-feature`: the Music inspector's "Fade in · out" row is not drawn until a fade exists in the product. Rejected: a static "0.5 s · 1.5 s" note (a row that says something the file does not).
