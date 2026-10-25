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

---

# Round 8 (p8-c8-adv) — continuation: done vs open

Branch `p8-c8-adv` from feat/maude-v2 a428cfee7. Scope: the MUST rows of `critic-bar3.md` except ad-timeline (p8-c8-video). Nothing is marked "matches": the lead's critic judges the re-shot pairs.

## Done (commit · what · test red → green)

| commit | what | tests |
|---|---|---|
| 987d12c18 | **ad-settings** Engines are "Subtitles · …" and "Video keyframes · …" SELECT rows (the radio cards are gone); **Reset** is one wrapping row of three buttons (Reset panel layout · Close all Advanced sections · red Reset all settings…) with the "⌘K “open advanced”" hint — the "Open now, on this Mac" per-fold switch list is removed (a fold opens and closes at its own panel; `settings-fold-<id>` retired). **ad-search** one "Close all Advanced sections" result (the Settings row stays in the sheet and the parity table, `searchTwin`). **ad-logs** no Refresh icon (the Logs box re-reads every 5 s while in view instead). **ad-edge-syntax** no "Reload canvas" under a mistake on record (kept when the server knows of none; Menu › Diagnostics › Reload canvas ⌘R stays) and the last-drawn boards are dashed ghosts behind the card (layout from the canvas meta, nothing invented). **ad-pinned / ad-inspector (artboard)** a Fixed size's fold is Exact size · Look and layout · In code (the raw `kind · width · height` fact rows are gone; Kind and Clip content stay under Look and layout — see Open). | `p8-c8-adv-search`, `v2-settings` (Engines ×2), `v2-s11-13-advanced` (Reset), `v2-diagnostics-render`, `v2-canvas-error-card` (ghosts ×3, Reload), `kind-inspector-rows` — all red on the base files, green now |
| 86a865e14 | Engines show ONE model at a time (a Model select + the board's box: name · size, status word, one action); Menu › Diagnostics keeps "Project folder" whole (the label no longer shrinks beside a long value); Fixed size In code on two lines; harness `_c8adv-harness-g2/` | `p8-c8-adv-css`, `v2-settings` |
| ee6f098bd (**shared** `actions/defs/canvas.ts`, `view.ts`) | the four Canvases row-menu actions and Show file names say `Canvases › Advanced` in ⌘K (board: ad-search "Copy file path — Canvases › Advanced"); the chip no longer cuts "Copy fil…" | `v2-s11-18-sweep` updated |

## Harness (the MUSTs that were the shot) — `_c8adv-harness-g2/impl/s06j.mjs`, `s06h.mjs`
- ad-diag: the Diagnostics submenu with its Advanced row OPEN. ad-code: ⌘K "view code" + Enter, the panel's Advanced fold open. ad-search: the board's query "copy". ad-history: a version SELECTED (git-backed copy), fold open. ad-inspector / ad-export: a tall window (1760 / 1500 px) so the whole fold / sheet is in frame. ad-left: Show file names ON + Show hidden files ON.
- ad-edge-syntax: the Broken canvas gets a `.meta.json` with three boards (the ghosts), left panel closed via `panel-fold-left`.

## Open (not done; why)
- ad-diag ③ Resync now · Download all: hidden for a local project (needs a linked hub project).
- ad-pinned Kind select stays (Look and layout): it is the only place a board's kind is switched (a v1 control; the header chip is a label). Move it only when 08 gives the chip a menu.
- ad-settings: Send anonymous usage data / Remember design decisions / Faster canvas engine rows are not built (C34, no store); the Update row reads "Up to date" (fixture).
- ad-search: "copy" returns 16 results in the product (the board's 7): the registry has more copy actions than the board; not trimmed.
- ad-edge-remember draws the "Open now, on this Mac" list inside Reset; ad-settings does not. ad-settings (lead's call) wins; the list's capability is each panel's own fold.
- ad-edge-syntax provenance clause needs a server signal (unchanged).

---

# Round 10 (p8-c10-advvid) — 06 Advanced MUSTs of critic-bar4b

Branch `p8-c10-advvid` from feat/maude-v2 55850113d. The lead's critic judges the re-shot pairs.

## Done (commit · what · test red → green)

| what | tests |
|---|---|
| **ad-inspector** — the v1 Inspect facts (POS / SIZE / FILL / TEXT / FONT) move to the very end of the Advanced fold, under the v1 raw editor (nothing-deleted keeps them reachable); the Element group is Tag / Classes / Selector again | `v2-inspector-advanced` (fold order, red before) |
| **ad-left** — Show hidden files draws the one canvas tree: file names under the canvases (Show file names), sidecars under their canvas, a folder's loose notes, the runtime entries (`_history/`, `_canvas-state/`) dimmed at the root. The v1 file view is gone; the Project files group still follows as a small FileTree. `file-row-<slug>` / `tree-row-menu-<slug>` / preview-on-click / rename kept | `p8-c10-hidden-tree` (model, red with the old tree-model), `v2-left-panel-render` (render) |
| **ad-search** — registry action `export.copy-command` "Copy export command" (Export › Advanced): ⌘K "copy" lists it; copies the `maude design export …` line for the selection (else this canvas) | `p8-c10-copy-export-command`, `ai-parity-coverage` (regen) |

## Open
- ad-left: the folder counts stay canvas counts (the board adds the supporting rows to them); `_history/` is drawn once at the root, not under each canvas.
- Everything the critic listed as POLISH / SIDE (fixtures, 11 / 09 / 13 owned rows) is untouched.
