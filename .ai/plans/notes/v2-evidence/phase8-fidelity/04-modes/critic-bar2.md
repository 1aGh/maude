# 04 Modes - re-evaluation against the "verified" bar (v2-michal-verified-bar)

_Source: critic-final-d3.md (merged tip 63592219a) + committed pairs re-read (md-edit, md-keys, md-inspect, md-annotate, md-present-full, md-present-video, md-edge-ai). No new shots. Lead decisions applied: contract over board, owning boards, toast dock, Connect without API-key row, Inspector per 14 (full Inspector instead of the compact card is not a blocker)._

## Per id
- md-model · verified (dark, light) · none
- md-preview · verified (dark, light) · none (seeded annotations / camera = fixture)
- md-preview-follow · verified (dark, light) · none (Pricing stand-in = fixture)
- md-present-lift · verified (dark, light) · none (lift motion = md-motion class)
- md-present-canvas · verified (dark, light) · none
- md-esc · verified (dark, light) · none
- md-annotate · verified (dark, light) · none; stage 5 (N in Edit, colour strip) is a second storyboard frame, moved to side rows
- md-keys · differs · shot shows an Artboard inspector instead of the keys board content: mode glyph legend with words and keys, per-mode toolbar rows with caps, Edit/Preview/Present/Viewing cards (control/content missing)
- md-edit · differs · Canvases panel stays open with the selection (spec folds it); handle pile on "See pricing" and its `126 x 47` tag overlaps the `Go to Pricing` chip
- md-edit-image · differs · Assets panel: 3-col tiles without filenames, no selected ring, extra "Not used" chip; Image tool not armed
- md-edit-component · differs · picker floats top-right on a Frame selection instead of anchored above an armed Components slot; no `Primary / Secondary / Ghost` segment; list starts with Brand not the studio-site system
- md-motion · unreachable · storyboard needs a recorded 0/40/140/220 ms frame series (e2e)
- md-preview-combine · differs · camera lands on A4 at 65 % instead of the 14 % overview of all boards (`preview/preview-camera.tsx:100-112`)
- md-present-menu · differs · menu lacks the `Presenter view on another display` row; shot state is Preview with Hand armed and a `cmd-Enter commits...` toast (spec: Edit, selected artboard, undo/redo island)
- md-present-full · differs · no controls pill (`3 / 14 - name - esc to leave`) and no dark stage; web artboard fills the window
- md-present-video · differs · extra top-right `esc Back to the canvas` chip the board does not draw; transport is a wide scrub bar + loop button, missing deck counter / kind name / `esc to leave`
- md-presenter · unreachable · second display / desktop shell
- md-present-link · unreachable · hub cloud project with a viewer link
- md-comment · differs · extra `All` tab in the Comments panel; composer is a bare new-comment card, no thread / replies / Resolve / @ suggest (needs seeded thread fixture to prove)
- md-comment-only · unreachable · Can comment role (hub, second person)
- md-draw · differs · wrong state: placed sticky with Edit handles, selection toolbar, dashed artboard rim, `On Desktop - moves with it` tag and commit toast; board draws section, arrows, colour strip, AI chat
- md-inspect · differs · Inspect island (Size and spacing, Colour and type, Export, Copy code, Advanced CSS) not on screen; only the `97 x 35` measure tag
- md-edge-ai · differs · AI tag is a 7 px chip inside the artboard corner (spec: spark pill above-right); light rim purple instead of spark token (DS token); no `+ AI` pointer label (`artboard-activity-overlay.tsx`)
- md-edge-viewer · unreachable · cloud viewer role
- md-edge-mixed · differs · shot is Present-the-canvas; the six per-kind Present - Artboards treatments are not shown
- md-edge-offline · unreachable · desktop Presenter view offline with a missing clip

## Polish list
- md-preview · seeded annotations / camera differ from spec
- md-preview-follow · Pricing content is a stand-in
- md-edit · full Inspector vs compact card (overruled by 14), 112 px gap measure is hover (see side rows)
- md-present-video · 16:9 blue test clip vs 9:16 Reel (fixture)
- md-present-menu · `Copy presentation link` disabled in a cloud project (fixture)
- md-edge-ai · Combine-kampan stand-in artboard (fixture)
- md-comment · one-row list in extra-impl thread shot (fixture)

## Side states
- md-annotate/stage-5 · N in Edit: sticky armed, colour strip above toolbar · reachable (harness)
- md-keys/hover · mode-glyph hover word + key (native title only today) · reachable
- md-edit/gap-measure · 112 px gap measure when pointing at a neighbour · reachable
- md-edit-component/placed-chip · placed `Button - Secondary` chip after pick · reachable
- md-edit-image/placed-photo · placed photo + `Hero image - fills, cropped to fit` chip · reachable
- md-preview-combine/playing · Playing badge + sticky · reachable
- md-present-full/pointer-trail · pointer dot / trail in presence colour · reachable
- md-comment/thread · open thread with replies, Resolve, @ suggest · reachable with a seeded thread fixture
- md-edge-ai/pointer-label · `+ AI` pointer label · reachable (needs a fake AI run)
