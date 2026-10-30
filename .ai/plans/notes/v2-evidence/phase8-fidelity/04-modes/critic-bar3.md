# 04 Modes - re-evaluation 3 against the "verified" bar (v2-michal-verified-bar)

_Source: FINAL (D5, e37e7d82a) pairs, both themes read for every reachable id (committed `<id>-<theme>.jpg` pairs + the full-size impl frames of the LAST line of `full-size-path.txt`). Checklist: critic-bar2.md + fix-c7-modes.md / fix-c7-oboard.md. Lead decisions applied: owning board wins (presenter row greyed, esc chip on video Present per 07, present video fill per 04), CONTRACT over board (View > Exports row, All tab in Comments), Inspector per 14 (full Inspector instead of the compact card, On click row sits below the fold), Inspector/Assets chips per 08/12. Shots taken in Google Chrome 156._

## Per id
- md-model · verified (dark, light) · none (What's new toast = harness notice; Local project pill vs avatars = fixture)
- md-keys · verified (dark, light) · none. The shot is now Menu > View, amended (rows, keys, Exports per CONTRACT); the glyph legend / key tables are board documentation with no product surface (fix-c7-modes decision), hover word is a side row
- md-edit · verified (dark, light) · none. Canvases folded, link chip `Go to Pricing` on the canvas, size tag no longer overlaps the chip; Inspector is 14's full one (decision), On click / On hover live in its Interaction section below the fold
- md-edit-image · verified (dark, light) · none. Image slot pressed beside the Assets panel, six Photos, search, From this Mac; tile filenames / selected ring are 12's call, extra chips are 12's
- md-edit-component · differs · MUST: the picker floats centred on the canvas, not anchored above the Components slot; the Components slot is not pressed (armed) while the picker is open; Canvases panel left open under it (board: no left panel). Variant segment is present (Mark / Wordmark / Lockup for the focused Logo row) - that part is fine
- md-motion · unreachable · a 0/40/140/220 ms storyboard, not a state (e2e)
- md-annotate · verified (dark, light) · none (stage 5 = side row)
- md-preview · verified (dark, light) · none (seeded stickies / drawing = fixture)
- md-preview-follow · verified (dark, light) · none (Pricing stand-in = fixture; back pill `Homepage` present)
- md-preview-combine · verified (dark, light) · none. Overview camera held with no links (c7 decision); fewer boards than the board = fixture
- md-present-menu · verified (dark, light) · none. Greyed `Presenter view on another display` row + `Needs a second display` per lead decision; label is clipped by the sub line (polish)
- md-present-lift · verified (dark, light) · none (the lift is the motion storyboard class, side row)
- md-present-full · verified (dark, light) · none. Dark stage, fixed-size artboard, `2 / 5 - name - esc to leave` pill, both themes
- md-present-video · verified (dark, light) · none under the lead decisions: esc chip per 07, fill per 04, transport = 07's bar (play, loop, time, scrub, sound, captions); no deck counter / kind name because the fixture is a deck of one and 07 owns the video bar
- md-present-canvas · verified (dark, light) · none
- md-presenter · unreachable · second display / desktop shell
- md-present-link · unreachable · hub cloud project with a viewer link
- md-comment · verified (dark, light) · none. Comment tool armed, Comments panel docked (Open / Mine / Resolved / All = CONTRACT), composer card at the spot; thread with replies / Resolve / @ is a side row (seeded thread, second person)
- md-comment-only · unreachable · Can comment role (hub, second person)
- md-draw · differs · MUST: the Canvases panel is open beside the AI chat in Preview (board: Canvases folded, AI chat only). The corner icon's `onShow` unfolds both panels, so the board's layout (Preview + AI chat open + Canvases folded) is not reachable. Sticky armed + colour strip, two stickies, selection toolbar, `1 sticky` chip are right; section / arrows / Tereza cursor / AI reply = fixture or needs an AI run
- md-inspect · differs · MUST: the Inspect island is right (Size and spacing, Colour and type, Export, Copy code, Edit, Advanced) but the inspected element's highlight and spec tags (size, gap) are not visible - at the shot's 81 % camera `Book a call` sits under the island. Shot-fixable (fit camera at 60 % or lower so the target and its tags are visible); not a product gap on the evidence
- md-edge-ai · verified (dark, light) · none. Spark-token rim, tag above-right, `+ AI` pointer present; tag is world-sized and tiny at a 23 % camera (polish); every artboard flagged because the whole file was written (fixture)
- md-edge-viewer · unreachable · cloud viewer role
- md-edge-mixed · differs · MUST: the contact sheet shows five treatments (Web fill-width, Post, Story, 16:9, A4) but not the Banner 1200 x 300 letterbox, and the Reels-with-sound frame is only covered by md-present-video; the fixture lacks a Banner artboard. Shot-fixable
- md-edge-offline · unreachable · desktop Presenter view offline with a missing clip
- md-esc · verified (dark, light) · none (ladder behaviour pinned by esc-ladder.test.tsx, esc-shell-consumed.test.tsx; the shot is the settled Edit state)

## Polish list
- md-model · What's new notice sits over the canvas in the shot (harness notice)
- md-model · Local project pill in the cluster vs the board's avatars + Saved (fixture / local project)
- md-preview · seeded stickies, drawing and camera differ from the board
- md-preview-follow · Pricing content is a stand-in
- md-preview-combine · camera 21 % vs the board's 14 %; fewer boards (fixture)
- md-edit · camera 53 % vs 47 %; handles are tight on a 124 x 43 button; Inspector shows Position / Size first, Interaction below the fold (14 owns)
- md-edit-image · selected object is a Frame (gradient hero, fixture), so the Inspector shows Frame; tile filenames and selected ring on hover / pick (12)
- md-present-menu · `Presenter view on another display` clipped to `...on another…`; `Copy presentation link` disabled in a local project (fixture); menu sits over the Inspector
- md-present-video · 16:9 blue test clip vs the 9:16 Reels; scrub track contrast on the dark transport pill is low (not a blocker, measure)
- md-present-lift · the 280 ms frame only; web artboard fills the window
- md-comment · one-row list in the thread frame; extra-impl thread shot has no replies
- md-edge-ai · tag and pointer illegible at many-board zoom; brown sweep band on every artboard mid-change
- md-keys · Present from the start key order `⌥⇧⌘↵` vs board `⇧⌥⌘↵` (same chord)
- md-inspect · `Arial 13.3333` and raw `#14181F` in the island are fixture CSS (no tokens), not copy

## Side states
- md-annotate/stage-5 · N in Edit: sticky armed, colour strip above toolbar · reachable (harness)
- md-keys/hover · mode-glyph hover word + key (native title only today) · reachable
- md-edit/gap-measure · 112 px gap measure when pointing at a neighbour with ⌥ · reachable
- md-edit/on-click-row · the Interaction section (On click / On hover) of the Inspector, below the fold · reachable (scroll)
- md-edit-component/placed-chip · placed `Button - Secondary` chip after pick · reachable
- md-edit-image/placed-photo · placed photo + `Hero image - fills, cropped to fit` chip · reachable (needs an image object in the fixture)
- md-preview-combine/playing · Playing badge + sticky · reachable
- md-present-lift/frames · 0 / 40 / 280 ms motion frames · unreachable (e2e, same class as md-motion)
- md-present-full/pointer-trail · pointer dot / trail in presence colour · reachable
- md-present-video/format-switch · top-left Reels / 16:9 / 1:1 switch and deck stepping · reachable with a multi-format fixture
- md-comment/thread · open thread with replies, Resolve, @ suggest · reachable with a seeded thread fixture (replies need a second person)
- md-draw/section-arrows · section, arrows, presence cursor, AI answer with chips · reachable except the AI answer (needs an AI run)
- md-edge-ai/pointer-label · `+ AI` pointer label at a readable zoom · reachable (fake AI run)
