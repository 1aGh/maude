# 04 Modes - re-evaluation 5 against the "verified" bar (v2-michal-verified-bar)

_Source: FINAL (D7, 98ed9c011) merged-tip pairs, both themes read for every reachable id (committed `<id>-<theme>.jpg` pairs; full-size D7 impl frames opened for md-inspect, md-present-video, md-present-full). Checklist: critic-bar4.md. Lead decisions applied: owning board wins (presenter row greyed, esc chip on video Present per 07, transport per 07, present video fill per 04), CONTRACT over board (right-hand Comments panel with All tab, View > Exports row), Inspector per 14, Inspector/Assets chips per 08/12, first-run card once, view-only opens in Preview, Connect/Always-allowed/music-fade items deferred. Shots are Google Chrome on the Mac mini._

## Per id
- md-model · verified (dark, light) · none (What's new notice = harness; Local project pill vs avatars = fixture)
- md-keys · verified (dark, light) · none (View menu amended per CONTRACT; glyph legend / key tables are board documentation)
- md-edit · verified (dark, light) · none (full Inspector per 14, On click below the fold = side row)
- md-edit-image · verified (dark, light) · none (Assets pressed beside the panel, Photos, search, From this Mac; selected object is a Frame = fixture)
- md-edit-component · verified (dark, light) · none (picker anchored above the pressed Components slot, variant segment for the focused row; DS rows = fixture)
- md-motion · unreachable · 0/40/140/220 ms storyboard, not a state (e2e)
- md-annotate · verified (dark, light) · none (settled stage 4 Preview toolbar, Hand pressed; stage 5 = side row)
- md-preview · verified (dark, light) · none
- md-preview-follow · verified (dark, light) · none (back pill `Homepage` present; Pricing stand-in = fixture)
- md-preview-combine · verified (dark, light) · none (overview camera held with no links; camera 25 % vs 14 % = polish)
- md-present-menu · verified (dark, light) · none (greyed Presenter view + `Needs a second display` per lead decision; Copy link disabled in a local project)
- md-present-lift · verified (dark, light) · none (settled frame; 0/40 ms frames = motion side row)
- md-present-full · verified (dark, light) · none (dark stage, fixed artboard, pager + name + esc pill in both themes; display-icon toggle needs a second display, same gate as the menu row)
- md-present-video · verified (dark, light) · none under lead decisions (esc chip per 07, transport = 07's bar, fill per 04); 16:9 blue test clip vs 9:16 Reels = fixture
- md-present-canvas · verified (dark, light) · none
- md-presenter · unreachable · second display / desktop shell
- md-present-link · unreachable · hub cloud project with a viewer link
- md-comment · verified (dark, light) · none (Comment tool armed, right-hand Comments panel per CONTRACT with Open / Mine / Resolved / All, composer at the spot; thread + replies + Resolve + @ = side row, needs a second person)
- md-comment-only · unreachable · Can comment role (hub, second person)
- md-draw · verified (dark, light) · none (Sticky armed + colour strip, two stickies, selection toolbar, `1 sticky` chip, AI chat opens in the fold with Canvases folded; section / arrows / cursor / AI reply = fixture or AI run)
- md-inspect · verified (dark, light) · none. Both bar4 MUSTs fixed on the D7 shot: camera 68 %, `Book a call` highlighted with the `97 x 35` spec tag clear of the island, Advanced open with the raw CSS rows and the `kept open` chip; island content (Size and spacing, Colour and type, Export PNG 1x/2x/SVG/Handoff, Copy code, Edit) matches
- md-edge-ai · verified (dark, light) · none (spark-token rim on the changed artboards, tag above-right, `+ AI` pointer; illegible at 21 % = polish)
- md-edge-viewer · unreachable · cloud viewer role
- md-edge-mixed · verified (dark, light) · none (web fill-width, Post fit-height, Story pillarbox, A4 at the trim, 16:9 edge to edge, Banner letterbox all present; Reels-with-sound = covered by md-present-video, side row)
- md-edge-offline · unreachable · desktop Presenter view offline with a missing clip
- md-esc · verified (dark, light) · none (the board is a behaviour table; ladder pinned by esc-ladder.test.tsx and esc-shell-consumed.test.tsx; shot is the settled Edit state)

## Polish list
- md-model · What's new notice over the canvas (harness); Local project pill vs avatars + Saved (fixture)
- md-keys · Present from the start key order `opt shift cmd return` vs board `shift opt cmd return` (same chord)
- md-edit · camera 53 % vs 47 %; handles tight on a 124 x 43 button; Inspector shows Position / Size first (14 owns)
- md-edit-image · tile filenames / selected ring on pick (12 owns); gradient hero is a Frame not an image (fixture)
- md-edit-component · DS component list differs from the board's Studio-site rows (fixture); picker covers the artboard centre on wide pages
- md-preview · seeded stickies, drawing and camera differ from the board
- md-preview-follow · Pricing content is a stand-in
- md-preview-combine · camera 25 % vs the board's 14 %; fewer boards (fixture)
- md-present-menu · menu sits over the Inspector (Post selected); Copy presentation link disabled in a local project
- md-present-full · thin white edge on the right/bottom of the fixed artboard
- md-present-video · scrub track contrast on the dark transport pill is low (the thumb and fill carry state); light theme transport is a white pill on the dark stage
- md-present-lift · web artboard fills the window at the final frame only
- md-comment · extra-impl thread shot has no replies (second person)
- md-inspect · Advanced label `background-color` wraps and touches its value (`background-rgb(...)`); `Arial 13.3333` and raw `#14181F` / `rgb()` are fixture CSS (board shows `Ink 100%` / `Round`)
- md-edge-ai · tag and pointer illegible at many-board zoom; sweep band on every artboard (whole file written, fixture)
- md-edge-mixed · 16:9 teaser is a deck artboard, not a video; frame 3 is a Story, not a Reels clip (fixture)

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
- md-comment/thread · open thread with replies, Resolve, @ suggest · unreachable without a second person
- md-draw/section-arrows · section, arrows, presence cursor, AI answer with chips · reachable except the AI answer (needs an AI run)
- md-inspect/gap-measure · gap tag between Book a call and About · reachable (opt-point)
- md-edge-ai/pointer-label · `+ AI` pointer label at a readable zoom · reachable (fake AI run)
