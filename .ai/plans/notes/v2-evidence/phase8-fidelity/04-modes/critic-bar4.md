# 04 Modes - re-evaluation 4 against the "verified" bar (v2-michal-verified-bar)

_Source: FINAL (D6, 3d58f57df) pairs, both themes read for every reachable id (committed `<id>-<theme>.jpg` pairs + full-size impl frames at the LAST line of `full-size-path.txt`). Checklist: critic-bar3.md + fix-c7-oboard.md round-8 table. Lead decisions applied: owning board wins (presenter row greyed, esc chip on video Present per 07, transport per 07, present video fill per 04), CONTRACT over board (right-hand Comments panel with All tab, View > Exports row), Inspector per 14 (full Inspector, On click below the fold), Inspector/Assets chips per 08/12, first-run card once, view-only opens in Preview. Shots are Google Chrome on the Mac mini._

## Per id
- md-model · verified (dark, light) · none (What's new notice = harness; Local project pill vs avatars = fixture)
- md-keys · verified (dark, light) · none (Menu > View amended per CONTRACT; glyph legend / key tables are board documentation; hover word = side row)
- md-edit · verified (dark, light) · none (full Inspector per 14; link chip `Go to Pricing` on canvas; Canvases folded)
- md-edit-image · verified (dark, light) · none (Assets pressed beside the panel, Photos, search, From this Mac)
- md-edit-component · verified (dark, light) · none. Round-8 fixed both prior MUSTs: picker is anchored above the pressed Components slot (slot x 825-865, panel 697-995, centred) and Canvases is folded. Ghost chip `Logo - Mark` on the artboard centre line = the c8 preview row; variant segment present for the focused row; DS component rows are fixture content
- md-motion · unreachable · 0/40/140/220 ms storyboard, not a state (e2e)
- md-annotate · verified (dark, light) · none (stage 5 = side row)
- md-preview · verified (dark, light) · none (seeded stickies / drawing / link-less Pricing = fixture)
- md-preview-follow · verified (dark, light) · none (back pill `Homepage` present; Pricing stand-in = fixture)
- md-preview-combine · verified (dark, light) · none (overview camera held with no links; fewer boards = fixture)
- md-present-menu · verified (dark, light) · none (greyed Presenter view + `Needs a second display` per lead decision; Copy link disabled in a local project)
- md-present-lift · verified (dark, light) · none (the settled frame; 0/40 ms frames = motion side row)
- md-present-full · verified (dark, light) · none (dark stage, fixed artboard, pager + name + esc pill in both themes; the board's display icon is the Presenter-view toggle that needs a second display = same gate as the menu row)
- md-present-video · verified (dark, light) · none under lead decisions (esc chip per 07, transport = 07's bar, fill per 04); 16:9 blue test clip vs 9:16 Reels = fixture
- md-present-canvas · verified (dark, light) · none
- md-presenter · unreachable · second display / desktop shell
- md-present-link · unreachable · hub cloud project with a viewer link
- md-comment · verified (dark, light) · none (Comment tool armed, right-hand Comments panel per CONTRACT with Open / Mine / Resolved / All, composer card at the spot; thread + replies + Resolve + @ = side row, needs a second person)
- md-comment-only · unreachable · Can comment role (hub, second person)
- md-draw · verified (dark, light) · none. Round-8 fixed the prior MUST: AI chat opens by itself in the Preview fold with Canvases folded (`aiInFold`). Sticky armed + colour strip, two stickies, selection toolbar, `1 sticky` chip; section / arrows / Tereza cursor / AI reply = fixture or AI run (side row)
- md-inspect · differs · MUST: (1) the inspected element's highlight and spec tags (size 97 x 35, gap) are NOT visible on the merged-tip shot - the camera is still 81 % (the round-8 fit-camera harness step did not take effect) and `Book a call` sits under the Inspect island, so the board's selection + measure behaviour is unproven; (2) the board draws Advanced open with the raw CSS rows (padding, border-radius, background, font, color), the shot has it collapsed. Island content otherwise matches (Size and spacing, Colour and type, Export PNG 1x/2x/SVG/Handoff, Copy code, Edit, Advanced). Both items are shot-fixable (fit camera <= 69 %, expand Advanced), not a product gap on the evidence
- md-edge-ai · verified (dark, light) · none (spark-token rim on the changed artboards, tag above-right, `+ AI` pointer; tag is world-sized and illegible at 21 % = polish)
- md-edge-viewer · unreachable · cloud viewer role
- md-edge-mixed · verified (dark, light) · none. Round-8 added the Banner 1200 x 300 letterbox (sixth frame, centred at full width, stage around it); web fill-width, Post fit-height, Story pillarbox, 16:9 edge to edge, A4 at the trim all present. The Reels-with-sound frame is covered by md-present-video (no Reels clip in the fixture = side row)
- md-edge-offline · unreachable · desktop Presenter view offline with a missing clip
- md-esc · verified (dark, light) · none (the board is a behaviour table; ladder pinned by esc-ladder.test.tsx and esc-shell-consumed.test.tsx; shot is the settled Edit state)

## Polish list
- md-model · What's new notice over the canvas (harness); Local project pill vs avatars + Saved (fixture)
- md-keys · Present from the start key order `opt shift cmd return` vs board `shift opt cmd return` (same chord)
- md-edit · camera 53 % vs 47 %; handles tight on a 124 x 43 button; Inspector shows Position / Size first (14 owns)
- md-edit-image · selected object is a Frame (gradient hero fixture) so the Inspector shows Frame; tile filenames / selected ring on pick (12)
- md-edit-component · DS component list differs from the board's Studio-site rows (fixture); picker covers the artboard centre on wide pages
- md-preview · seeded stickies, drawing and camera differ from the board
- md-preview-follow · Pricing content is a stand-in
- md-preview-combine · camera 25 % vs the board's 14 %; fewer boards (fixture)
- md-present-menu · menu sits over the Inspector (Post selected); Copy presentation link disabled in a local project
- md-present-video · scrub track contrast on the dark transport pill is low (measure, not a blocker); light theme transport is a white pill on the dark stage
- md-present-lift · web artboard fills the window at the final frame only
- md-comment · extra-impl thread shot has no replies (second person)
- md-edge-ai · tag and pointer illegible at many-board zoom; sweep band on every artboard (whole file written, fixture)
- md-edge-mixed · banner artboard has a thin white bottom edge in the Present frame; 16:9 teaser is a deck artboard, not a video
- md-inspect · `Arial 13.3333` and raw `#14181F` in the island are fixture CSS (no tokens), board shows `Ink 100%` / `Round`

## Side states
- md-annotate/stage-5 · N in Edit: sticky armed, colour strip above toolbar · reachable (harness)
- md-keys/hover · mode-glyph hover word + key (native title only today) · reachable
- md-edit/gap-measure · 112 px gap measure when pointing at a neighbour with opt · reachable
- md-edit/on-click-row · Interaction section (On click / On hover) of the Inspector, below the fold · reachable (scroll)
- md-edit-component/placed-chip · placed `Button - Secondary` chip after pick · reachable
- md-edit-image/placed-photo · placed photo + `Hero image - fills, cropped to fit` chip · reachable (needs an image object in the fixture)
- md-preview-combine/playing · Playing badge + sticky · reachable
- md-present-lift/frames · 0 / 40 / 280 ms motion frames · unreachable (e2e, same class as md-motion)
- md-present-full/pointer-trail · pointer dot / trail in presence colour · reachable
- md-present-video/format-switch · Reels / 16:9 / 1:1 switch, deck stepping, Reels pillarbox with sound · reachable with a multi-format fixture
- md-comment/thread · open thread with replies, Resolve, @ suggest · unreachable without a second person (seeded thread reachable)
- md-draw/section-arrows · section, arrows, presence cursor, AI answer with chips · reachable except the AI answer (needs an AI run)
- md-edge-ai/pointer-label · `+ AI` pointer label at a readable zoom · reachable (fake AI run)
