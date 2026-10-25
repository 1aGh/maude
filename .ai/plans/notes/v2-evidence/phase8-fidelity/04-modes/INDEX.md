# 04 Modes - spec vs implementation, evidence (V2-8.5 stage A)

Canvas `.design/ui/v2/04 Modes.tsx`. **26 artboards**, 52 pairs (dark + light), **19 reached in the app**, 7 not reachable (placeholder on the right of the pair, reason in the row).

How the two sides were made. SPEC: the board rendered from a scratch copy of `.design/` (`.scr/design-copy`, own studio, throwaway HOME, claude stubbed), camera forced to 1:1, host theme set dark (default) then light (`data-maude-theme`: the host re-themes every unpinned artboard; pinned user designs stay light). IMPL: Playwright Chromium 1440x900 (the spec's Stage window size) with a `window.__TAURI__` stub, release client, `theme` in prefs.json, on a generated fixture project. Project: generated "Studio site" (Homepage with a data-cd-link to Pricing, Pricing, Combine-kampan, six photos in Assets). Modes are driven through the Share-cluster testids and the in-frame toolbar (frameLocator); the md-edge-ai frame uses the fake agent from 03.
Theme: both themes were made for every artboard. Differences below are the dark pair's unless the "theme" column says otherwise; a theme-only difference (a token that does not flip) is called out there.

**Common differences (C1-C5):**
- **C1** The spec draws the macOS title bar and project tab strip; the browser lane has none.
- **C2** The spec's Preview and Present frames hide every panel (immersive); the app also hides panels in Preview but leaves the AI/left corner icons, and in several frames the left Canvases panel is still open after a mode change (see rows).
- **C3** Share cluster: spec "T J - Saved - Share" (cloud, two people); app "YO - Local project - Share".
- **C4** Spec canvases are "Studio site > Homepage / Pricing" (Calm software, made in Brno; Studio, Pricing) and "Alligators > Combine-kampan" (15 artboards). The app runs a rebuilt stand-in Homepage (Desktop 1440 / Tablet 834 / Mobile 390), Pricing and a 5-artboard Combine-kampan; content differs by fixture, behaviours do not.
- **C5** Spec note strip under each Stage has no app counterpart; documentation boards (md-model, md-keys, md-annotate, md-esc, md-motion, md-present-lift, md-edge-mixed) are info-graphics with tables and storyboards, compared only against the live state they describe.
- **C6** Camera: entering Preview in the app lands at 65-81 % centred on whichever artboard is nearest the centre (it started on Tablet, not Desktop); the spec's Preview frames sit at 76 % on Desktop.

| id | state (spec) | how the impl was reached | impl reachable? | first-glance differences | theme | pair |
|---|---|---|---|---|---|---|
| `md-model` | 1 - the mode switch, and what each mode shows (table + three toolbar mock-ups) | Edit mode on Homepage with Desktop selected; the Share cluster shows the switch | partially: a table board vs one live state | Share-cluster mode switch present (Edit / Preview / Present with chevron) but the app shows only 3 slots (no Viewing for an owner, correct); glyph look: spec Edit = pen-nib-like mark, app = crossed-tools mark - compare at zoom; the spec's tables (what each mode shows / hides, key column) and the Present-Artboards / Viewing rows have no one-frame app counterpart; Edit toolbar in the app: select, hand, frame, shape, pen, text, image, components, more (spec lists the same set) | base | `04-modes/md-model-dark.jpg` |
| `md-model` | 1 - the mode switch, and what each mode shows (table + three toolbar mock-ups) | Edit mode on Homepage with Desktop selected; the Share cluster shows the switch | partially: a table board vs one live state | Share-cluster mode switch present (Edit / Preview / Present with chevron) but the app shows only 3 slots (no Viewing for an owner, correct); glyph look: spec Edit = pen-nib-like mark, app = crossed-tools mark - compare at zoom; the spec's tables (what each mode shows / hides, key column) and the Present-Artboards / Viewing rows have no one-frame app counterpart; Edit toolbar in the app: select, hand, frame, shape, pen, text, image, components, more (spec lists the same set) | same structure; chrome follows the light host theme | `04-modes/md-model-light.jpg` |
| `md-keys` | 2 - its own glyphs, words and keys (mode cards, proposed keys, View menu) | hover the Preview glyph | partially: the hover shows no tooltip in the frame | No tooltip or key hint is visible after a 1.5 s hover (spec says the glyphs carry words and keys: Edit, Preview, Present, Viewing + key caps cmd-alt-P etc.); the View menu list ('Hide panels', 'Comments', 'Assets', 'Annotations', Preview / Present / Present from the start / Present the canvas, zoom items) is a desktop menu-bar menu - not in the browser lane | base | `04-modes/md-keys-dark.jpg` |
| `md-keys` | 2 - its own glyphs, words and keys (mode cards, proposed keys, View menu) | hover the Preview glyph | partially: the hover shows no tooltip in the frame | No tooltip or key hint is visible after a 1.5 s hover (spec says the glyphs carry words and keys: Edit, Preview, Present, Viewing + key caps cmd-alt-P etc.); the View menu list ('Hide panels', 'Comments', 'Assets', 'Annotations', Preview / Present / Present from the start / Present the canvas, zoom items) is a desktop menu-bar menu - not in the browser lane | same structure; chrome follows the light host theme | `04-modes/md-keys-light.jpg` |
| `md-edit` | 3 - Edit: set up where a click goes (See pricing: On click Go to Pricing, link chip on the canvas) | cmd-click 'See pricing' in Edit (a data-cd-link to Pricing) | yes | Link chip on the element reads 'See pricing - 126 x 46 / Go to Pricing' (spec: 'Go to Pricing' chip + '112' gap measure); the right panel is the FULL Inspector (Position, Size, Layout, Fill, Corners, Border, Effects...) with no visible On click row in the first screen, spec shows a compact property card (Size, Fill, Border, On click: Go to Pricing, On hover: Fill with Ink, Advanced 3 properties); the left panel is hidden while the Inspector is open (spec keeps nothing on the left) | base | `04-modes/md-edit-dark.jpg` |
| `md-edit` | 3 - Edit: set up where a click goes (See pricing: On click Go to Pricing, link chip on the canvas) | cmd-click 'See pricing' in Edit (a data-cd-link to Pricing) | yes | Link chip on the element reads 'See pricing - 126 x 46 / Go to Pricing' (spec: 'Go to Pricing' chip + '112' gap measure); the right panel is the FULL Inspector (Position, Size, Layout, Fill, Corners, Border, Effects...) with no visible On click row in the first screen, spec shows a compact property card (Size, Fill, Border, On click: Go to Pricing, On hover: Fill with Ink, Advanced 3 properties); the left panel is hidden while the Inspector is open (spec keeps nothing on the left) | same structure; chrome follows the light host theme | `04-modes/md-edit-light.jpg` |
| `md-edit-image` | 4 - Image: a photo into a frame (Assets open, Image tool armed, hero image fills) | Assets tab of the left panel | partially: Assets open, no image placed | Assets tab shows a 6-photo grid ('Photos', 'From this Mac...') like the spec's; Image tool not armed and no photo dropped into a frame ('Hero image - fills, cropped to fit' chip); spec shows a purple hero image on the Desktop artboard; selection stays on the artboard | base | `04-modes/md-edit-image-dark.jpg` |
| `md-edit-image` | 4 - Image: a photo into a frame (Assets open, Image tool armed, hero image fills) | Assets tab of the left panel | partially: Assets open, no image placed | Assets tab shows a 6-photo grid ('Photos', 'From this Mac...') like the spec's; Image tool not armed and no photo dropped into a frame ('Hero image - fills, cropped to fit' chip); spec shows a purple hero image on the Desktop artboard; selection stays on the artboard | same structure; chrome follows the light host theme | `04-modes/md-edit-image-light.jpg` |
| `md-edit-component` | 5 - Component: a Button from the Design system (picker with variants, Button - Secondary placed) | toolbar Components slot | partially: picker opens, no instance placed | Picker lists Brand (Logo with Mark / Wordmark / Lockup variants, Icon) and Components (Button, IconButton, Input, Field, Switch, Checkbox, Segmented, Tabs, Chip, Badge, Card, Callout, Dialog, Tooltip) + 'Open Design system'; spec header is 'Studio site system' with Button expanded to Primary / Secondary / Ghost and a placed 'Button - Secondary' chip; the app picker is wider and the Inspector is open on a Section frame behind it | base | `04-modes/md-edit-component-dark.jpg` |
| `md-edit-component` | 5 - Component: a Button from the Design system (picker with variants, Button - Secondary placed) | toolbar Components slot | partially: picker opens, no instance placed | Picker lists Brand (Logo with Mark / Wordmark / Lockup variants, Icon) and Components (Button, IconButton, Input, Field, Switch, Checkbox, Segmented, Tabs, Chip, Badge, Card, Callout, Dialog, Tooltip) + 'Open Design system'; spec header is 'Studio site system' with Button expanded to Primary / Secondary / Ghost and a placed 'Button - Secondary' chip; the app picker is wider and the Inspector is open on a Section frame behind it | same structure; chrome follows the light host theme | `04-modes/md-edit-component-light.jpg` |
| `md-motion` | 6 - Edit to Preview, in motion (storyboard 0 / 40 / 140 / 220 ms) | not reachable: a motion storyboard | no - animation, not a state (the end state is md-annotate) | n/a | base | `04-modes/md-motion-dark.jpg` |
| `md-motion` | 6 - Edit to Preview, in motion (storyboard 0 / 40 / 140 / 220 ms) | not reachable: a motion storyboard | no - animation, not a state (the end state is md-annotate) | n/a | same structure; chrome follows the light host theme | `04-modes/md-motion-light.jpg` |
| `md-annotate` | 7 - Preview's toolbar: annotation tools only (five stages + a key table) | press Preview in the Share cluster | partially: the end stage only | Preview toolbar order matches the table (hand, sticky, comment, marker, arrow, shape, text, stickers, section) with the hand armed; the app shows the page full-bleed (81 % zoom) with the Preview pill; the storyboard stages, 'N in Edit' colour dots and the key table are documentation | base | `04-modes/md-annotate-dark.jpg` |
| `md-annotate` | 7 - Preview's toolbar: annotation tools only (five stages + a key table) | press Preview in the Share cluster | partially: the end stage only | Preview toolbar order matches the table (hand, sticky, comment, marker, arrow, shape, text, stickers, section) with the hand armed; the app shows the page full-bleed (81 % zoom) with the Preview pill; the storyboard stages, 'N in Edit' colour dots and the key table are documentation | same structure; chrome follows the light host theme | `04-modes/md-annotate-light.jpg` |
| `md-preview` | 8 - Previewing Homepage (hover and pointer alive, 'AI's changes show live' note) | same frame as md-annotate | yes | 'Previewing Homepage - esc to edit' pill, panels hidden, corner spark; camera lands at 65 % on the Tablet artboard (spec: Desktop at 76 %); left corner panel icon sits over the artboard edge | base | `04-modes/md-preview-dark.jpg` |
| `md-preview` | 8 - Previewing Homepage (hover and pointer alive, 'AI's changes show live' note) | same frame as md-annotate | yes | 'Previewing Homepage - esc to edit' pill, panels hidden, corner spark; camera lands at 65 % on the Tablet artboard (spec: Desktop at 76 %); left corner panel icon sits over the artboard edge | same structure; chrome follows the light host theme | `04-modes/md-preview-light.jpg` |
| `md-preview-follow` | 9 - followed a link to Pricing ('< Homepage' back, 'Previewing Pricing') | click 'See pricing' in Preview | yes | Back chip '< Homepage' and 'Previewing Pricing' match; the left Canvases panel is open in this frame (spec hides it) and the Pricing artboard is fit to the window, spec at 56 % | base | `04-modes/md-preview-follow-dark.jpg` |
| `md-preview-follow` | 9 - followed a link to Pricing ('< Homepage' back, 'Previewing Pricing') | click 'See pricing' in Preview | yes | Back chip '< Homepage' and 'Previewing Pricing' match; the left Canvases panel is open in this frame (spec hides it) and the Pricing artboard is fit to the window, spec at 56 % | same structure; chrome follows the light host theme | `04-modes/md-preview-follow-light.jpg` |
| `md-preview-combine` | 10 - Preview on a canvas with no links (all 15 artboards, 'Playing' video badge) | open Combine-kampan, Preview | partially | Camera lands at 65 % on one artboard (A4) instead of an overview of the whole canvas; spec shows all artboards, a 'Playing' badge on the video artboard, a sticky and the no-links hint; app has no video artboard here | base | `04-modes/md-preview-combine-dark.jpg` |
| `md-preview-combine` | 10 - Preview on a canvas with no links (all 15 artboards, 'Playing' video badge) | open Combine-kampan, Preview | partially | Camera lands at 65 % on one artboard (A4) instead of an overview of the whole canvas; spec shows all artboards, a 'Playing' badge on the video artboard, a sticky and the no-links hint; app has no video artboard here | same structure; chrome follows the light host theme | `04-modes/md-preview-combine-light.jpg` |
| `md-present-menu` | 11 - Present, and its small menu (Present from 'Post 1:1', from the start, the canvas, Presenter view on another display, Order and notes, Copy presentation link) | Present chevron | yes | Menu rows: Present from 'Tablet' / Present from the start / The canvas - pan freely: Present the canvas / Order and notes... / Copy presentation link (greyed 'in a cloud project'); spec also has 'Presenter view on another display' (tick, 'On Ultrawide') - desktop only; spec row label names the selected artboard (Post 1:1), app names Tablet; keys right-aligned in both | base | `04-modes/md-present-menu-dark.jpg` |
| `md-present-menu` | 11 - Present, and its small menu (Present from 'Post 1:1', from the start, the canvas, Presenter view on another display, Order and notes, Copy presentation link) | Present chevron | yes | Menu rows: Present from 'Tablet' / Present from the start / The canvas - pan freely: Present the canvas / Order and notes... / Copy presentation link (greyed 'in a cloud project'); spec also has 'Presenter view on another display' (tick, 'On Ultrawide') - desktop only; spec row label names the selected artboard (Post 1:1), app names Tablet; keys right-aligned in both | same structure; chrome follows the light host theme | `04-modes/md-present-menu-light.jpg` |
| `md-present-lift` | 12 - Present lifts the artboard out of the canvas (3 frames: 0 / 40 % / 280 ms) | alt-cmd-Enter from the selected artboard, shot 0.45 s in | partially: an animation; the frame is the end state | At 0.45 s the app is already full-screen on Desktop (page pinned light) with a controls pill '< 1/3 > Desktop esc to leave'; no visible lift / dark fade; spec frame 3 shows the dark stage with 'Present - Artboards 3 of 14' pill | base | `04-modes/md-present-lift-dark.jpg` |
| `md-present-lift` | 12 - Present lifts the artboard out of the canvas (3 frames: 0 / 40 % / 280 ms) | alt-cmd-Enter from the selected artboard, shot 0.45 s in | partially: an animation; the frame is the end state | At 0.45 s the app is already full-screen on Desktop (page pinned light) with a controls pill '< 1/3 > Desktop esc to leave'; no visible lift / dark fade; spec frame 3 shows the dark stage with 'Present - Artboards 3 of 14' pill | same structure; chrome follows the light host theme | `04-modes/md-present-lift-light.jpg` |
| `md-present-full` | 13 - full screen, 3 of 15 (pointer dot and trail, controls pill) | same Present run, 2.6 s later | yes | Controls pill present (counter, label, esc to leave); spec's dark stage with the presenter pointer dot and trail and a card on a dark ground; app shows the light Homepage fitted to the screen with a grey strip under it (the 1440x900 frame is not full-height of 900: page letterboxed) | base | `04-modes/md-present-full-dark.jpg` |
| `md-present-full` | 13 - full screen, 3 of 15 (pointer dot and trail, controls pill) | same Present run, 2.6 s later | yes | Controls pill present (counter, label, esc to leave); spec's dark stage with the presenter pointer dot and trail and a card on a dark ground; app shows the light Homepage fitted to the screen with a grey strip under it (the 1440x900 frame is not full-height of 900: page letterboxed) | same structure; chrome follows the light host theme | `04-modes/md-present-full-light.jpg` |
| `md-present-video` | 14 - a 9:16 video plays inline (transport) | not reachable | no - needs a footage-backed video artboard (the fixture has no media) | n/a | base | `04-modes/md-present-video-dark.jpg` |
| `md-present-video` | 14 - a 9:16 video plays inline (transport) | not reachable | no - needs a footage-backed video artboard (the fixture has no media) | n/a | same structure; chrome follows the light host theme | `04-modes/md-present-video-light.jpg` |
| `md-present-canvas` | 15 - Present the canvas: pan freely ('Presenting the canvas - 21 % - esc to leave') | Present chevron, Present the canvas | yes | Pill 'Presenting the canvas - 39 % - esc to leave' matches the spec's pill; canvas chrome hidden; the app frames the Homepage tiles on the light page (user design pinned light) and the camera shows two of three artboards partially; spec shows Combine-kampan tiles on dark | base | `04-modes/md-present-canvas-dark.jpg` |
| `md-present-canvas` | 15 - Present the canvas: pan freely ('Presenting the canvas - 21 % - esc to leave') | Present chevron, Present the canvas | yes | Pill 'Presenting the canvas - 39 % - esc to leave' matches the spec's pill; canvas chrome hidden; the app frames the Homepage tiles on the light page (user design pinned light) and the camera shows two of three artboards partially; spec shows Combine-kampan tiles on dark | same structure; chrome follows the light host theme | `04-modes/md-present-canvas-light.jpg` |
| `md-presenter` | 16 - Presenter view on the Mac (now, next, notes, clock) | not reachable | no - needs a second display, desktop shell | n/a | base | `04-modes/md-presenter-dark.jpg` |
| `md-presenter` | 16 - Presenter view on the Mac (now, next, notes, clock) | not reachable | no - needs a second display, desktop shell | n/a | same structure; chrome follows the light host theme | `04-modes/md-presenter-light.jpg` |
| `md-present-link` | 17 - watching from a link, and looking back | not reachable | no - cloud viewer link (hub) | n/a | base | `04-modes/md-present-link-dark.jpg` |
| `md-present-link` | 17 - watching from a link, and looking back | not reachable | no - cloud viewer link (hub) | n/a | same structure; chrome follows the light host theme | `04-modes/md-present-link-light.jpg` |
| `md-comment` | 18 - pins on artboards, a thread, resolve, Open / Mine, @mention (Comments panel) | Comment tool, click on a heading, type, send (frame also md-comment-thread) | partially: one comment, single user | Composer popover with the artboard name ('Tablet') and send button appears at the click; spec shows the Comments panel on the left (Open 3 / Mine 1 / Resolved 2 with Tereza / Jonas threads), a thread with Resolve and an @mention popup; app: the left panel is the Canvases list, no Comments panel opened, no other people | base | `04-modes/md-comment-dark.jpg` |
| `md-comment` | 18 - pins on artboards, a thread, resolve, Open / Mine, @mention (Comments panel) | Comment tool, click on a heading, type, send (frame also md-comment-thread) | partially: one comment, single user | Composer popover with the artboard name ('Tablet') and send button appears at the click; spec shows the Comments panel on the left (Open 3 / Mine 1 / Resolved 2 with Tereza / Jonas threads), a thread with Resolve and an @mention popup; app: the left panel is the Canvases list, no Comments panel opened, no other people | same structure; chrome follows the light host theme | `04-modes/md-comment-light.jpg` |
| `md-comment-only` | 19 - someone who may only comment (Comment view, toolbar cut to Hand + Comment) | not reachable | no - a Can comment role needs a hub / second person | n/a | base | `04-modes/md-comment-only-dark.jpg` |
| `md-comment-only` | 19 - someone who may only comment (Comment view, toolbar cut to Hand + Comment) | not reachable | no - a Can comment role needs a hub / second person | n/a | same structure; chrome follows the light host theme | `04-modes/md-comment-only-light.jpg` |
| `md-draw` | 20 - annotate in Preview: stickies, arrows, a section; AI reads the layer | Sticky tool, click, type | partially: one sticky | Sticky placed with its context toolbar (colour dots, size 'Medium', Resolve, 'Turn into a comment') and a hint toast '(cmd)Enter commits and creates the next one beside it'; spec shows a section 'Feedback od trenerů' with several stickies, arrows to artboards and an AI chat panel reading the layer ('Do what the stickies in Feedback od trenérů ask') | base | `04-modes/md-draw-dark.jpg` |
| `md-draw` | 20 - annotate in Preview: stickies, arrows, a section; AI reads the layer | Sticky tool, click, type | partially: one sticky | Sticky placed with its context toolbar (colour dots, size 'Medium', Resolve, 'Turn into a comment') and a hint toast '(cmd)Enter commits and creates the next one beside it'; spec shows a section 'Feedback od trenerů' with several stickies, arrows to artboards and an AI chat panel reading the layer ('Do what the stickies in Feedback od trenérů ask') | same structure; chrome follows the light host theme | `04-modes/md-draw-light.jpg` |
| `md-inspect` | 21 - Inspect 'Book a call' (spec card: size, padding, corners, fill, text, export, Copy code, Advanced CSS) | cmd-click in Preview | partially: selection chip only | Cmd-click selects the button (measure tag 'Book a call 97 x 33') but the Inspect side panel is not open in the frame (spec shows the Inspect panel at the right with Size and spacing, Colour and type, Export PNG 1x/2x/SVG/Handoff, Copy code, Advanced CSS list) | base | `04-modes/md-inspect-dark.jpg` |
| `md-inspect` | 21 - Inspect 'Book a call' (spec card: size, padding, corners, fill, text, export, Copy code, Advanced CSS) | cmd-click in Preview | partially: selection chip only | Cmd-click selects the button (measure tag 'Book a call 97 x 33') but the Inspect side panel is not open in the frame (spec shows the Inspect panel at the right with Size and spacing, Colour and type, Export PNG 1x/2x/SVG/Handoff, Copy code, Advanced CSS list) | same structure; chrome follows the light host theme | `04-modes/md-inspect-light.jpg` |
| `md-edge-ai` | 22 - AI changes the artboard you're clicking through (tag 'AI's new from ... shown live', note) | Preview + AI panel + prompt on Combine-kampan; frame at +0.9 s (also md-edge-ai-after) | partially | Preview with the AI panel open and the AI's edit landing; no 'AI is making a change - shown live' tag on the previewed artboard and no pointer-hold note; the spec shows Homepage preview with an orange tag at the artboard corner | base | `04-modes/md-edge-ai-dark.jpg` |
| `md-edge-ai` | 22 - AI changes the artboard you're clicking through (tag 'AI's new from ... shown live', note) | Preview + AI panel + prompt on Combine-kampan; frame at +0.9 s (also md-edge-ai-after) | partially | Preview with the AI panel open and the AI's edit landing; no 'AI is making a change - shown live' tag on the previewed artboard and no pointer-hold note; the spec shows Homepage preview with an orange tag at the artboard corner | same structure; chrome follows the light host theme | `04-modes/md-edge-ai-light.jpg` |
| `md-edge-viewer` | 23 - a view-only link, in a browser (Can view) | not reachable | no - cloud project and a viewer role (hub) | n/a | base | `04-modes/md-edge-viewer-dark.jpg` |
| `md-edge-viewer` | 23 - a view-only link, in a browser (Can view) | not reachable | no - cloud project and a viewer role (hub) | n/a | same structure; chrome follows the light host theme | `04-modes/md-edge-viewer-light.jpg` |
| `md-edge-mixed` | 24 - mixed kinds on one screen (Present - Artboards on web / social / video / print: six stage treatments) | Present the canvas on Combine-kampan | partially: canvas mode, not the per-kind run | The app frame is Present-the-canvas (all artboards at 33 %, pill 'Presenting the canvas'), not the per-kind treatments the spec draws (web fills width, post fits height, reel plays, print at the trim, banner letterboxed, 16:9 edge to edge) - those need Present - Artboards on a 15-artboard canvas with those kinds | base | `04-modes/md-edge-mixed-dark.jpg` |
| `md-edge-mixed` | 24 - mixed kinds on one screen (Present - Artboards on web / social / video / print: six stage treatments) | Present the canvas on Combine-kampan | partially: canvas mode, not the per-kind run | The app frame is Present-the-canvas (all artboards at 33 %, pill 'Presenting the canvas'), not the per-kind treatments the spec draws (web fills width, post fits height, reel plays, print at the trim, banner letterboxed, 16:9 edge to edge) - those need Present - Artboards on a 15-artboard canvas with those kinds | same structure; chrome follows the light host theme | `04-modes/md-edge-mixed-light.jpg` |
| `md-edge-offline` | 25 - presenting with no internet (Presenter view offline, clip missing, Skip) | not reachable | no - desktop shell (Presenter view, offline clip) | n/a | base | `04-modes/md-edge-offline-dark.jpg` |
| `md-edge-offline` | 25 - presenting with no internet (Presenter view offline, clip missing, Skip) | not reachable | no - desktop shell (Presenter view, offline clip) | n/a | same structure; chrome follows the light host theme | `04-modes/md-edge-offline-light.jpg` |
| `md-esc` | 26 - what esc does, everywhere (table) | Preview on Combine-kampan, then one esc | partially: one row of the table | After one esc from Preview the app returns to Edit with panels back (matches row 'Preview: esc back to Edit'); the other ten rows (menus, Present, Image, Comment, Annotation tools, Inspect, Viewing, mid-drag, browser) not driven | base | `04-modes/md-esc-dark.jpg` |
| `md-esc` | 26 - what esc does, everywhere (table) | Preview on Combine-kampan, then one esc | partially: one row of the table | After one esc from Preview the app returns to Edit with panels back (matches row 'Preview: esc back to Edit'); the other ten rows (menus, Present, Image, Comment, Annotation tools, Inspect, Viewing, mid-drag, browser) not driven | same structure; chrome follows the light host theme | `04-modes/md-esc-light.jpg` |


## after (stage D, 6d19daa9a)

Re-shoot of the IMPL side on tip 6d19daa9a (stage C round 2 merged), both themes, so the critic re-check compares the board with what the app draws now. No match / mismatch judged here. Pair images (`<id>-<theme>.jpg`, SPEC left | IMPL right) were overwritten in place; the SPEC side is **reused** from stage A for every id (no `.design/ui/v2/04 *` change since the stage-A shot; `git log` shows only 02 and 09 touched). The `extra-impl-*` frames were re-shot too.

- Same harness as stage A. Adaptations: the What's new toast dismissed through its close button, the composer picked with `:visible`. No spec side re-render (board 04 unchanged since stage A).
- Not reachable, unchanged since stage A: md-motion (a storyboard), md-present-video (no footage in the fixture), md-presenter / md-edge-offline (second display / desktop shell), md-present-link / md-comment-only / md-edge-viewer (hub or second person).

| id | dark | light |
|---|---|---|
| `md-model` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-keys` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-edit` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-edit-image` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-edit-component` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-motion` | unreachable (An animation storyboard of Edit to Preview (frames over 0 to 220 ms), not a state.) | unreachable (same) |
| `md-annotate` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-preview` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-preview-follow` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-preview-combine` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-present-menu` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-present-lift` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-present-full` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-present-video` | unreachable (Needs a 9:16 video artboard with footage; the fixture has no footage file.) | unreachable (same) |
| `md-present-canvas` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-presenter` | unreachable (Presenter view needs a second display (desktop shell).) | unreachable (same) |
| `md-present-link` | unreachable (A cloud viewer link needs a hub project.) | unreachable (same) |
| `md-comment` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-comment-only` | unreachable (A Can comment role needs a hub / second person.) | unreachable (same) |
| `md-draw` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-inspect` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-edge-ai` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-edge-viewer` | unreachable (A view-only link in a browser needs a cloud project.) | unreachable (same) |
| `md-edge-mixed` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |
| `md-edge-offline` | unreachable (Offline Present with a missing clip is a desktop-shell state (Presenter view).) | unreachable (same) |
| `md-esc` | IMPL re-shot, SPEC reused | IMPL re-shot, SPEC reused |

## Round 3 re-shoot (p8-c3-modes)

IMPL re-shot after the round-3 modes / menus fixes; the committed <id>-<theme>.jpg pairs are overwritten for: md-model, md-annotate, md-preview, md-preview-follow, md-preview-combine, md-inspect, md-comment, md-draw, md-present-menu, md-edge-ai, md-esc. No match is judged here. md-edge-ai is shot in the board's own state (the prompt asked in Edit, then Preview folds the panels); md-draw-dark is the stage-D frame of the same code (its click timed out on the second run).


## FINAL (stage D2, d3881fe41)

Re-shoot of the IMPL side on the merged tip d3881fe41 (stage C rounds 1-4 all merged), both themes, **every reachable id**, so the critic re-check compares the board with what the app draws now; this section supersedes the per-round "after" sections above. The committed `<id>-<theme>.jpg` pairs (SPEC left | IMPL right) are overwritten in place. SPEC side **reused** from stage A for every id (`git log` shows no change to `.design/ui/v2/04 *` after the stage-A shot). No match / mismatch is judged here.

- Harness: stage-D scripts with the product's new camera / panel behaviour handled: selecting an artboard folds the left panel (md-edit-image first opens it from its corner icon); in Preview the camera is Desktop 81 % or Tablet 65 % depending on the run, so Preview clicks use the bounding box of whichever of the Desktop / Tablet element is on screen (md-inspect = ⌘-click with the real mouse on "Book a call"; md-preview-follow = a click event on "See pricing →", the link cannot be hit by the mouse at that camera); the toolbar slots are clicked by their position.
- **md-edge-ai** is the board's state (`s04c`: the prompt `Make it greener, keep the logo white` asked in Edit, then Preview folds the panels, shot mid change; the frame +3.5 s later is `extra-impl-md-edge-ai-after`).
- **md-present-video is newly reached**: the base fixture's VideoEdit canvas, the Reel artboard selected, ⌥⌘↵, the play button pressed, shot with Google Chrome (`SHOT_CHANNEL=chrome`: the bundled Chromium cannot decode H.264). The fixture clip is 16:9 and a single artboard, not the board's 9:16 Reels in a 14-artboard deck, so Present shows no deck counter; the pair compares the video-in-Present surface, not the exact scene.
- Not reachable, unchanged: md-motion (a storyboard), md-presenter / md-edge-offline (second display / desktop shell), md-present-link / md-comment-only / md-edge-viewer (hub or second person).

| id | dark | light |
|---|---|---|
| `md-model` | re-shot | re-shot |
| `md-keys` | re-shot | re-shot |
| `md-edit` | re-shot | re-shot |
| `md-edit-image` | re-shot | re-shot |
| `md-edit-component` | re-shot | re-shot |
| `md-motion` | unreachable (An animation storyboard of Edit to Preview (frames over 0 to 220 ms), not a state.) | unreachable (same) |
| `md-annotate` | re-shot | re-shot |
| `md-preview` | re-shot | re-shot |
| `md-preview-follow` | re-shot | re-shot |
| `md-preview-combine` | re-shot | re-shot |
| `md-present-menu` | re-shot | re-shot |
| `md-present-lift` | re-shot | re-shot |
| `md-present-full` | re-shot | re-shot |
| `md-present-video` | re-shot | re-shot |
| `md-present-canvas` | re-shot | re-shot |
| `md-presenter` | unreachable (Presenter view needs a second display (desktop shell).) | unreachable (same) |
| `md-present-link` | unreachable (A cloud viewer link needs a hub project.) | unreachable (same) |
| `md-comment` | re-shot | re-shot |
| `md-comment-only` | unreachable (A Can comment role needs a hub / second person.) | unreachable (same) |
| `md-draw` | re-shot | re-shot |
| `md-inspect` | re-shot | re-shot |
| `md-edge-ai` | re-shot | re-shot |
| `md-edge-viewer` | unreachable (A view-only link in a browser needs a cloud project.) | unreachable (same) |
| `md-edge-mixed` | re-shot | re-shot |
| `md-edge-offline` | unreachable (Offline Present with a missing clip is a desktop-shell state (Presenter view).) | unreachable (same) |
| `md-esc` | re-shot | re-shot |

## After (round 5, p8-c5-panels @ 2e203e9e6)
`md-comment` re-shot (IMPL light + dark, SPEC reused): the Comment tool docks the Comments panel, the composer card is the board's card (heading, field, small accent send). Other ids unchanged.


## FINAL (D3, 63592219a)

Re-shoot of the IMPL side on the merged tip 63592219a (stage C rounds 1-5 + bugs3 merged), both themes, **every reachable id**; this section supersedes every earlier "after" / FINAL section above. The committed `<id>-<theme>.jpg` pairs (SPEC left | IMPL right) are overwritten in place. SPEC side **reused** from stage A for every id (`git log` shows no change to `.design/ui/v2/04 *` since 2026-10-19, before the stage-A shot). No match / mismatch is judged here.

- Harness: `_d3-harness-g2/` = D2 `s04a` / `s04c` / `s04v`, with two adaptations to the merged product: **md-draw** now closes the docked Comments panel, leaves Preview with one esc (re-entering Preview if the toolbar is gone), and picks the sticky tool by its testid `toolbar-slot-sticky` (the toolbar moved up, the old fixed coordinate opened the sticker palette); **md-esc** therefore shows the esc ladder without the Comments panel left open from the comment step.
- **md-comment** shows the Comment tool docking the Comments panel with the composer card; `extra-impl-md-comment-thread` is the thread after ⌘↵.
- **md-edge-ai** is the board's state (`s04c`: the prompt `Make it greener, keep the logo white` asked in Edit, then Preview folds the panels, shot mid change; the frame +3.5 s later is `extra-impl-md-edge-ai-after`).
- **md-present-video**: the base fixture's VideoEdit canvas, the Reel artboard selected, ⌥⌘↵, shot with Google Chrome (`SHOT_CHANNEL=chrome`, H.264). The fixture clip is 16:9 and a single artboard, not the board's 9:16 Reels in a 14-artboard deck, so Present shows no deck counter; `extra-impl-md-present-video-play` is the frame after the play button.
- Not reachable, unchanged: md-motion (a storyboard), md-presenter / md-edge-offline (second display / desktop shell), md-present-link / md-comment-only / md-edge-viewer (hub or second person).

| id | dark | light |
|---|---|---|
| `md-model` | re-shot | re-shot |
| `md-keys` | re-shot | re-shot |
| `md-edit` | re-shot | re-shot |
| `md-edit-image` | re-shot | re-shot |
| `md-edit-component` | re-shot | re-shot |
| `md-motion` | unreachable (An animation storyboard of Edit to Preview (frames over 0 to 220 ms), not a state.) | unreachable (same) |
| `md-annotate` | re-shot | re-shot |
| `md-preview` | re-shot | re-shot |
| `md-preview-follow` | re-shot | re-shot |
| `md-preview-combine` | re-shot | re-shot |
| `md-present-menu` | re-shot | re-shot |
| `md-present-lift` | re-shot | re-shot |
| `md-present-full` | re-shot | re-shot |
| `md-present-video` | re-shot | re-shot |
| `md-present-canvas` | re-shot | re-shot |
| `md-presenter` | unreachable (Presenter view needs a second display (desktop shell).) | unreachable (same) |
| `md-present-link` | unreachable (A cloud viewer link needs a hub project.) | unreachable (same) |
| `md-comment` | re-shot | re-shot |
| `md-comment-only` | unreachable (A Can comment role needs a hub / second person.) | unreachable (same) |
| `md-draw` | re-shot | re-shot |
| `md-inspect` | re-shot | re-shot |
| `md-edge-ai` | re-shot | re-shot |
| `md-edge-viewer` | unreachable (A view-only link in a browser needs a cloud project.) | unreachable (same) |
| `md-edge-mixed` | re-shot | re-shot |
| `md-edge-offline` | unreachable (Offline Present with a missing clip is a desktop-shell state (Presenter view).) | unreachable (same) |
| `md-esc` | re-shot | re-shot |

## after (round 7, p8-c7-modes)

IMPL re-shot, both themes, on the merged tip + p8-c7-modes. The committed `<id>-<theme>.jpg` pairs (SPEC left | IMPL right) are overwritten for every 04 id the harness reaches. No match is judged here. Harness changes (`_c7-modes-harness/`):
- md-edit: Canvases panel folded (md-edit is shot BEFORE Assets is opened) and the camera zoomed in so the handles and the `126 x 47` tag are not a pile.
- md-inspect: Preview is entered from the selected Desktop artboard and the camera has settled before the cmd-click; the Inspect island is on screen.
- md-present-menu: Combine-kampan in Edit, Post 1:1 selected (no toast); the menu now carries the greyed `Presenter view on another display` row, sub line `Needs a second display`.
- md-present-full: Post 1:1 presented inside the 2 s the controls pill stays (dark stage + `2 / 5 · name · esc to leave`).
- md-edge-mixed: a contact sheet of real Present frames per kind (Web, Post, Story, A4, 16:9) on Combine-kampan.
- md-draw: Preview on Combine-kampan, Sticky armed with its colour strip, two stickies, AI chat beside.
- md-keys: the View menu (the amended rows and keys) open on a deselected canvas.
- md-edge-ai: the canvas file is written under a Preview (a terminal agent's edit): rim, tag and the AI pointer (`+ AI`).
