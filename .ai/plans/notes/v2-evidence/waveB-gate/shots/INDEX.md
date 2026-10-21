# Wave-B gate — implementation shots

Shot 2026-10-21 from branch `gate-b-shots` (base = `feat/maude-v2` 0ac68fb3d), release-built client, Playwright Chromium 1600×1000 with a `window.__TAURI__` stub,
own studio per run on scratch copies of the fixtures (throwaway HOME / XDG_CONFIG_HOME / machine file, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`). Theme is set the way the app reads it (`prefs.json` `theme`), not by emulation alone.
Frames are JPEG q70 (`<canvas>/<id>-<theme>.jpg`); ids reuse the canvas artboard id where the frame IS that artboard's state, and carry an `ex-`/`ak-`… name of their own where the board draws a state the browser lane reaches only as a neighbour.
202 frames, 14.0 MB.

Fixtures: `apps/desktop/e2e/fixtures/project` (Smoke, Print, Video*, Cut, Export), a generated 93-canvas / 21-artboard / broken-canvas project, a generated 18-photo project, an empty project,
the S10 DS seeds (`seed-ds-reach/-switch/-outside`), and Home (`server.ts --home`). **Not reached by any fixture:** the S7 video footage (the fixtures' `aaaa1111.mp4` is absent, so video artboards show the designed "Missing — no device has it" state and the console carries one `MEDIA_ELEMENT_ERROR`).

## Coverage
- 01 Create Flow: 14 distinct states shot (28 frames expected, dark + light)
- 02 Onboarding: 8 distinct states shot (16 frames expected, dark + light)
- 05 Empty States: 13 distinct states shot (26 frames expected, dark + light)
- 06 Advanced: 12 distinct states shot (24 frames expected, dark + light)
- 07 Video Editing: 11 distinct states shot (22 frames expected, dark + light)
- 08 Artboard Kinds: 10 distinct states shot (20 frames expected, dark + light)
- 09 Export: 10 distinct states shot (20 frames expected, dark + light)
- 10 Share and Collaboration: 8 distinct states shot (16 frames expected, dark + light)
- 12 Import and Assets: 12 distinct states shot (24 frames expected, dark + light)
- 13 Design System: 3 distinct states shot (6 frames expected, dark + light)

## Frames

| Canvas | Artboard / state id | Theme | State | How reached | File |
| --- | --- | --- | --- | --- | --- |
| 01 Create Flow | `cf-add-artboard` | dark | F — a new artboard, any kind | press F; the size picker opens | `01-create-flow/cf-add-artboard-dark.jpg` |
| 01 Create Flow | `cf-add-artboard` | light | F — a new artboard, any kind | press F; the size picker opens | `01-create-flow/cf-add-artboard-light.jpg` |
| 01 Create Flow | `cf-ai-panel` | dark | AI chat panel (no agent in the browser lane: “AI editing isn’t ready yet”) | panel-icon-assistant | `01-create-flow/cf-ai-panel-dark.jpg` |
| 01 Create Flow | `cf-ai-panel` | light | AI chat panel (no agent in the browser lane: “AI editing isn’t ready yet”) | panel-icon-assistant | `01-create-flow/cf-ai-panel-light.jpg` |
| 01 Create Flow | `cf-big-tree` | dark | 93 canvases in folders — the Canvases panel | big fixture, one folder expanded | `01-create-flow/cf-big-tree-dark.jpg` |
| 01 Create Flow | `cf-big-tree` | light | 93 canvases in folders — the Canvases panel | big fixture, one folder expanded | `01-create-flow/cf-big-tree-light.jpg` |
| 01 Create Flow | `cf-blank` | dark | ⌘N — a blank canvas | ⌘K → New canvas | `01-create-flow/cf-blank-dark.jpg` |
| 01 Create Flow | `cf-blank` | light | ⌘N — a blank canvas | ⌘K → New canvas | `01-create-flow/cf-blank-light.jpg` |
| 01 Create Flow | `cf-home-prompt` | dark | Home — one sentence, the starters, the cloud card | project-less Home server (`--home`), Tauri stub | `01-create-flow/cf-home-prompt-dark.jpg` |
| 01 Create Flow | `cf-home-prompt` | light | Home — one sentence, the starters, the cloud card | project-less Home server (`--home`), Tauri stub | `01-create-flow/cf-home-prompt-light.jpg` |
| 01 Create Flow | `cf-home-target` | dark | Home — the “starts a new canvas in…” menu | click the target chip | `01-create-flow/cf-home-target-dark.jpg` |
| 01 Create Flow | `cf-home-target` | light | Home — the “starts a new canvas in…” menu | click the target chip | `01-create-flow/cf-home-target-light.jpg` |
| 01 Create Flow | `cf-home-typed` | dark | Home — the sentence typed, the send button lit | type into the Home question field | `01-create-flow/cf-home-typed-dark.jpg` |
| 01 Create Flow | `cf-home-typed` | light | Home — the sentence typed, the send button lit | type into the Home question field | `01-create-flow/cf-home-typed-light.jpg` |
| 01 Create Flow | `cf-open-big` | dark | 21 artboards, fit to view | open the 21-artboard canvas, ⌘0 fits | `01-create-flow/cf-open-big-dark.jpg` |
| 01 Create Flow | `cf-open-big` | light | 21 artboards, fit to view | open the 21-artboard canvas, ⌘0 fits | `01-create-flow/cf-open-big-light.jpg` |
| 01 Create Flow | `cf-panel-search` | dark | Search inside the panel: "campaign" | type into canvas-search | `01-create-flow/cf-panel-search-dark.jpg` |
| 01 Create Flow | `cf-panel-search` | light | Search inside the panel: "campaign" | type into canvas-search | `01-create-flow/cf-panel-search-light.jpg` |
| 01 Create Flow | `cf-render-error` | dark | A canvas that won’t render | open Broken.tsx (syntax error) | `01-create-flow/cf-render-error-dark.jpg` |
| 01 Create Flow | `cf-render-error` | light | A canvas that won’t render | open Broken.tsx (syntax error) | `01-create-flow/cf-render-error-light.jpg` |
| 01 Create Flow | `cf-search-k` | dark | ⌘K — canvases first, then tools | press Meta+k, type "camp" | `01-create-flow/cf-search-k-dark.jpg` |
| 01 Create Flow | `cf-search-k` | light | ⌘K — canvases first, then tools | press Meta+k, type "camp" | `01-create-flow/cf-search-k-light.jpg` |
| 01 Create Flow | `cf-select-tweak` | dark | Select — the inspector arrives | click inside the artboard | `01-create-flow/cf-select-tweak-dark.jpg` |
| 01 Create Flow | `cf-select-tweak` | light | Select — the inspector arrives | click inside the artboard | `01-create-flow/cf-select-tweak-light.jpg` |
| 01 Create Flow | `cf-status-words` | dark | Save status, in words (share cluster) | canvas open, share cluster status | `01-create-flow/cf-status-words-dark.jpg` |
| 01 Create Flow | `cf-status-words` | light | Save status, in words (share cluster) | canvas open, share cluster status | `01-create-flow/cf-status-words-light.jpg` |
| 01 Create Flow | `cf-sticky-comment` | dark | A comment — Preview toolbar | switch to Preview, comment tool, click the canvas | `01-create-flow/cf-sticky-comment-dark.jpg` |
| 01 Create Flow | `cf-sticky-comment` | light | A comment — Preview toolbar | switch to Preview, comment tool, click the canvas | `01-create-flow/cf-sticky-comment-light.jpg` |
| 02 Onboarding | `ob-adv-open` | dark | Advanced options, opened | Canvases › Advanced | `02-onboarding/ob-adv-open-dark.jpg` |
| 02 Onboarding | `ob-adv-open` | light | Advanced options, opened | Canvases › Advanced | `02-onboarding/ob-adv-open-light.jpg` |
| 02 Onboarding | `ob-ai-connect` | dark | First send — AI not connected yet, shown just in time | AI panel | `02-onboarding/ob-ai-connect-dark.jpg` |
| 02 Onboarding | `ob-ai-connect` | light | First send — AI not connected yet, shown just in time | AI panel | `02-onboarding/ob-ai-connect-light.jpg` |
| 02 Onboarding | `ob-edge-whats-new` | dark | After an update — findable, never in the way (What’s new notice) | first load, notice at the foot | `02-onboarding/ob-edge-whats-new-dark.jpg` |
| 02 Onboarding | `ob-edge-whats-new` | light | After an update — findable, never in the way (What’s new notice) | first load, notice at the foot | `02-onboarding/ob-edge-whats-new-light.jpg` |
| 02 Onboarding | `ob-first-canvas` | dark | The first canvas, the mode hint | open a canvas on first run | `02-onboarding/ob-first-canvas-dark.jpg` |
| 02 Onboarding | `ob-first-canvas` | light | The first canvas, the mode hint | open a canvas on first run | `02-onboarding/ob-first-canvas-light.jpg` |
| 02 Onboarding | `ob-first-launch` | dark | First launch is Home (signed out, no projects) | project-less Home server, no projects | `02-onboarding/ob-first-launch-dark.jpg` |
| 02 Onboarding | `ob-first-launch` | light | First launch is Home (signed out, no projects) | project-less Home server, no projects | `02-onboarding/ob-first-launch-light.jpg` |
| 02 Onboarding | `ob-local-share` | dark | Local — Share offers the cloud | share cluster › Share | `02-onboarding/ob-local-share-dark.jpg` |
| 02 Onboarding | `ob-local-share` | light | Local — Share offers the cloud | share cluster › Share | `02-onboarding/ob-local-share-light.jpg` |
| 02 Onboarding | `ob-project-menu` | dark | The project menu | project pill | `02-onboarding/ob-project-menu-dark.jpg` |
| 02 Onboarding | `ob-project-menu` | light | The project menu | project pill | `02-onboarding/ob-project-menu-light.jpg` |
| 02 Onboarding | `ob-settings` | dark | Settings and where every old door went | ⌘K › Settings | `02-onboarding/ob-settings-dark.jpg` |
| 02 Onboarding | `ob-settings` | light | Settings and where every old door went | ⌘K › Settings | `02-onboarding/ob-settings-light.jpg` |
| 05 Empty States | `es-ai-panel` | dark | AI chat — empty, no agent connected | panel-icon-assistant | `05-empty-states/es-ai-panel-dark.jpg` |
| 05 Empty States | `es-ai-panel` | light | AI chat — empty, no agent connected | panel-icon-assistant | `05-empty-states/es-ai-panel-light.jpg` |
| 05 Empty States | `es-artboard-new` | dark | Empty artboard after “New artboard” | New artboard door on the empty canvas | `05-empty-states/es-artboard-new-dark.jpg` |
| 05 Empty States | `es-artboard-new` | light | Empty artboard after “New artboard” | New artboard door on the empty canvas | `05-empty-states/es-artboard-new-light.jpg` |
| 05 Empty States | `es-canvas-ai` | dark | A new canvas — “Your canvas is ready.” | ⌘K › New canvas | `05-empty-states/es-canvas-ai-dark.jpg` |
| 05 Empty States | `es-canvas-ai` | light | A new canvas — “Your canvas is ready.” | ⌘K › New canvas | `05-empty-states/es-canvas-ai-light.jpg` |
| 05 Empty States | `es-history` | dark | Version history — nothing to restore yet | ⌘K › Version history | `05-empty-states/es-history-dark.jpg` |
| 05 Empty States | `es-history` | light | Version history — nothing to restore yet | ⌘K › Version history | `05-empty-states/es-history-light.jpg` |
| 05 Empty States | `es-home-local` | dark | Home — no projects yet (ghost shelves, “Open project…”) | project-less Home server, no projects | `05-empty-states/es-home-local-dark.jpg` |
| 05 Empty States | `es-home-local` | light | Home — no projects yet (ghost shelves, “Open project…”) | project-less Home server, no projects | `05-empty-states/es-home-local-light.jpg` |
| 05 Empty States | `es-panels-canvas` | dark | Comments — nothing yet | share cluster › Comments | `05-empty-states/es-panels-canvas-dark.jpg` |
| 05 Empty States | `es-panels-canvas` | light | Comments — nothing yet | share cluster › Comments | `05-empty-states/es-panels-canvas-light.jpg` |
| 05 Empty States | `es-panels-make-assets` | dark | Assets — no images or footage yet | left panel › Assets | `05-empty-states/es-panels-make-assets-dark.jpg` |
| 05 Empty States | `es-panels-make-assets` | light | Assets — no images or footage yet | left panel › Assets | `05-empty-states/es-panels-make-assets-light.jpg` |
| 05 Empty States | `es-panels-make-exports` | dark | Exports panel — nothing exported yet | ⌘K › Exports | `05-empty-states/es-panels-make-exports-dark.jpg` |
| 05 Empty States | `es-panels-make-exports` | light | Exports panel — nothing exported yet | ⌘K › Exports | `05-empty-states/es-panels-make-exports-light.jpg` |
| 05 Empty States | `es-panels-make-trash` | dark | Trash — empty | Trash row | `05-empty-states/es-panels-make-trash-dark.jpg` |
| 05 Empty States | `es-panels-make-trash` | light | Trash — empty | Trash row | `05-empty-states/es-panels-make-trash-light.jpg` |
| 05 Empty States | `es-project-new` | dark | A new project with no canvases | empty project, nothing open | `05-empty-states/es-project-new-dark.jpg` |
| 05 Empty States | `es-project-new` | light | A new project with no canvases | empty project, nothing open | `05-empty-states/es-project-new-light.jpg` |
| 05 Empty States | `es-search-k` | dark | ⌘K — nothing called “pricng” | ⌘K, type pricng | `05-empty-states/es-search-k-dark.jpg` |
| 05 Empty States | `es-search-k` | light | ⌘K — nothing called “pricng” | ⌘K, type pricng | `05-empty-states/es-search-k-light.jpg` |
| 05 Empty States | `es-search-more` | dark | Assets search with no hits | Assets search: zzz | `05-empty-states/es-search-more-dark.jpg` |
| 05 Empty States | `es-search-more` | light | Assets search with no hits | Assets search: zzz | `05-empty-states/es-search-more-light.jpg` |
| 05 Empty States | `es-search-panel` | dark | Panel search — none match | canvas search: zzz | `05-empty-states/es-search-panel-dark.jpg` |
| 05 Empty States | `es-search-panel` | light | Panel search — none match | canvas search: zzz | `05-empty-states/es-search-panel-light.jpg` |
| 06 Advanced | `ad-ai` | dark | AI chat › Advanced | AI panel, › Advanced | `06-advanced/ad-ai-dark.jpg` |
| 06 Advanced | `ad-ai-diag` | dark | Diagnostics — AI | AI tab | `06-advanced/ad-ai-diag-dark.jpg` |
| 06 Advanced | `ad-ai-diag` | light | Diagnostics — AI | AI tab | `06-advanced/ad-ai-diag-light.jpg` |
| 06 Advanced | `ad-ai` | light | AI chat › Advanced | AI panel, › Advanced | `06-advanced/ad-ai-light.jpg` |
| 06 Advanced | `ad-code` | dark | The canvas as code | ⌘K › code | `06-advanced/ad-code-dark.jpg` |
| 06 Advanced | `ad-code` | light | The canvas as code | ⌘K › code | `06-advanced/ad-code-light.jpg` |
| 06 Advanced | `ad-diag` | dark | Diagnostics — Server | Server tab | `06-advanced/ad-diag-dark.jpg` |
| 06 Advanced | `ad-diag` | light | Diagnostics — Server | Server tab | `06-advanced/ad-diag-light.jpg` |
| 06 Advanced | `ad-export` | dark | Export › Advanced | ⇧⌘E, open the fold | `06-advanced/ad-export-dark.jpg` |
| 06 Advanced | `ad-export` | light | Export › Advanced | ⇧⌘E, open the fold | `06-advanced/ad-export-light.jpg` |
| 06 Advanced | `ad-inspector` | dark | Inspector, with the Advanced rows | select an element | `06-advanced/ad-inspector-dark.jpg` |
| 06 Advanced | `ad-inspector` | light | Inspector, with the Advanced rows | select an element | `06-advanced/ad-inspector-light.jpg` |
| 06 Advanced | `ad-left` | dark | Canvases › Advanced | open the Advanced fold at the foot of Canvases | `06-advanced/ad-left-dark.jpg` |
| 06 Advanced | `ad-left` | light | Canvases › Advanced | open the Advanced fold at the foot of Canvases | `06-advanced/ad-left-light.jpg` |
| 06 Advanced | `ad-logs` | dark | Diagnostics — Logs | ⌘K › Logs | `06-advanced/ad-logs-dark.jpg` |
| 06 Advanced | `ad-logs` | light | Diagnostics — Logs | ⌘K › Logs | `06-advanced/ad-logs-light.jpg` |
| 06 Advanced | `ad-search` | dark | ⌘K finds the advanced rows too | ⌘K, type “advanced” | `06-advanced/ad-search-dark.jpg` |
| 06 Advanced | `ad-search` | light | ⌘K finds the advanced rows too | ⌘K, type “advanced” | `06-advanced/ad-search-light.jpg` |
| 06 Advanced | `ad-settings` | dark | Settings | ⌘K › Settings | `06-advanced/ad-settings-dark.jpg` |
| 06 Advanced | `ad-settings` | light | Settings | ⌘K › Settings | `06-advanced/ad-settings-light.jpg` |
| 06 Advanced | `ad-share` | dark | Share › Advanced — other ways in | Share sheet, open the fold | `06-advanced/ad-share-dark.jpg` |
| 06 Advanced | `ad-share` | light | Share › Advanced — other ways in | Share sheet, open the fold | `06-advanced/ad-share-light.jpg` |
| 06 Advanced | `ad-syncd` | dark | Diagnostics — Sync | Sync tab | `06-advanced/ad-syncd-dark.jpg` |
| 06 Advanced | `ad-syncd` | light | Diagnostics — Sync | Sync tab | `06-advanced/ad-syncd-light.jpg` |
| 07 Video Editing | `ve-captions` | dark | Edit the talk as text; style the captions | open VideoTranscript, select | `07-video-editing/ve-captions-dark.jpg` |
| 07 Video Editing | `ve-captions` | light | Edit the talk as text; style the captions | open VideoTranscript, select | `07-video-editing/ve-captions-light.jpg` |
| 07 Video Editing | `ve-cut` | dark | A cut with several clips | open Cut, select | `07-video-editing/ve-cut-dark.jpg` |
| 07 Video Editing | `ve-cut` | light | A cut with several clips | open Cut, select | `07-video-editing/ve-cut-light.jpg` |
| 07 Video Editing | `ve-export` | dark | Export — every format at once | ⇧⌘E on the video artboard | `07-video-editing/ve-export-dark.jpg` |
| 07 Video Editing | `ve-export` | light | Export — every format at once | ⇧⌘E on the video artboard | `07-video-editing/ve-export-light.jpg` |
| 07 Video Editing | `ve-formats` | dark | Three formats, one edit | open VideoFormats, select | `07-video-editing/ve-formats-dark.jpg` |
| 07 Video Editing | `ve-formats` | light | Three formats, one edit | open VideoFormats, select | `07-video-editing/ve-formats-light.jpg` |
| 07 Video Editing | `ve-fullscreen` | dark | Present — full-screen preview | Present mode (⌘↵ via the share cluster) | `07-video-editing/ve-fullscreen-dark.jpg` |
| 07 Video Editing | `ve-fullscreen` | light | Present — full-screen preview | Present mode (⌘↵ via the share cluster) | `07-video-editing/ve-fullscreen-light.jpg` |
| 07 Video Editing | `ve-music` | dark | A music bed: beats, lower under speech, volume | open VideoMusic, select, click the bed | `07-video-editing/ve-music-dark.jpg` |
| 07 Video Editing | `ve-music` | light | A music bed: beats, lower under speech, volume | open VideoMusic, select, click the bed | `07-video-editing/ve-music-light.jpg` |
| 07 Video Editing | `ve-none` | dark | Nothing selected — no timeline | open a video canvas, nothing selected | `07-video-editing/ve-none-dark.jpg` |
| 07 Video Editing | `ve-none` | light | Nothing selected — no timeline | open a video canvas, nothing selected | `07-video-editing/ve-none-light.jpg` |
| 07 Video Editing | `ve-play` | dark | Play in place, loop a range, step frames | timeline play | `07-video-editing/ve-play-dark.jpg` |
| 07 Video Editing | `ve-play` | light | Play in place, loop a range, step frames | timeline play | `07-video-editing/ve-play-light.jpg` |
| 07 Video Editing | `ve-reframe` | dark | Clip inspector — fit, fill, reframe | open VideoClipInspect, clip block | `07-video-editing/ve-reframe-dark.jpg` |
| 07 Video Editing | `ve-reframe` | light | Clip inspector — fit, fill, reframe | open VideoClipInspect, clip block | `07-video-editing/ve-reframe-light.jpg` |
| 07 Video Editing | `ve-select` | dark | Select it — the timeline slides out of it | click the video artboard | `07-video-editing/ve-select-dark.jpg` |
| 07 Video Editing | `ve-select` | light | Select it — the timeline slides out of it | click the video artboard | `07-video-editing/ve-select-light.jpg` |
| 07 Video Editing | `ve-trim-split` | dark | Trim an edge; S splits at the playhead | open VideoEdit, select, clip block | `07-video-editing/ve-trim-split-dark.jpg` |
| 07 Video Editing | `ve-trim-split` | light | Trim an edge; S splits at the playhead | open VideoEdit, select, clip block | `07-video-editing/ve-trim-split-light.jpg` |
| 08 Artboard Kinds | `ak-layers` | dark | Layers panel — artboards by kind | Layers tab | `08-artboard-kinds/ak-layers-dark.jpg` |
| 08 Artboard Kinds | `ak-layers` | light | Layers panel — artboards by kind | Layers tab | `08-artboard-kinds/ak-layers-light.jpg` |
| 08 Artboard Kinds | `ak-mixed-filter` | dark | Canvases filtered by kind | kind chip: Print | `08-artboard-kinds/ak-mixed-filter-dark.jpg` |
| 08 Artboard Kinds | `ak-mixed-filter` | light | Canvases filtered by kind | kind chip: Print | `08-artboard-kinds/ak-mixed-filter-light.jpg` |
| 08 Artboard Kinds | `ak-mixed-fit` | dark | ⌘0 fits all 21 artboards | open the 21-artboard canvas, ⌘0 | `08-artboard-kinds/ak-mixed-fit-dark.jpg` |
| 08 Artboard Kinds | `ak-mixed-fit` | light | ⌘0 fits all 21 artboards | open the 21-artboard canvas, ⌘0 | `08-artboard-kinds/ak-mixed-fit-light.jpg` |
| 08 Artboard Kinds | `ak-mixed-select` | dark | Several artboards selected | ⌘A selects every artboard | `08-artboard-kinds/ak-mixed-select-dark.jpg` |
| 08 Artboard Kinds | `ak-mixed-select` | light | Several artboards selected | ⌘A selects every artboard | `08-artboard-kinds/ak-mixed-select-light.jpg` |
| 08 Artboard Kinds | `ak-picker-custom` | dark | A custom print size, in millimetres | size picker › Print › All › Custom size… | `08-artboard-kinds/ak-picker-custom-dark.jpg` |
| 08 Artboard Kinds | `ak-picker-custom` | light | A custom print size, in millimetres | size picker › Print › All › Custom size… | `08-artboard-kinds/ak-picker-custom-light.jpg` |
| 08 Artboard Kinds | `ak-picker` | dark | F — pick what you’re making | press F: the size picker | `08-artboard-kinds/ak-picker-dark.jpg` |
| 08 Artboard Kinds | `ak-picker-full` | dark | All sizes in a group (Print: All N) | size picker › Print › All | `08-artboard-kinds/ak-picker-full-dark.jpg` |
| 08 Artboard Kinds | `ak-picker-full` | light | All sizes in a group (Print: All N) | size picker › Print › All | `08-artboard-kinds/ak-picker-full-light.jpg` |
| 08 Artboard Kinds | `ak-picker` | light | F — pick what you’re making | press F: the size picker | `08-artboard-kinds/ak-picker-light.jpg` |
| 08 Artboard Kinds | `ak-picker-search` | dark | Search the sizes: “story” | F, type in the picker search | `08-artboard-kinds/ak-picker-search-dark.jpg` |
| 08 Artboard Kinds | `ak-picker-search` | light | Search the sizes: “story” | F, type in the picker search | `08-artboard-kinds/ak-picker-search-light.jpg` |
| 08 Artboard Kinds | `ak-print-letak` | dark | A print artboard (A6 + bleed) — the inspector speaks mm | open Print, select an artboard | `08-artboard-kinds/ak-print-letak-dark.jpg` |
| 08 Artboard Kinds | `ak-print-letak` | light | A print artboard (A6 + bleed) — the inspector speaks mm | open Print, select an artboard | `08-artboard-kinds/ak-print-letak-light.jpg` |
| 08 Artboard Kinds | `ak-video` | dark | A video artboard summons the timeline | open Video, select the artboard | `08-artboard-kinds/ak-video-dark.jpg` |
| 08 Artboard Kinds | `ak-video` | light | A video artboard summons the timeline | open Video, select the artboard | `08-artboard-kinds/ak-video-light.jpg` |
| 09 Export | `ex-advanced` | dark | Export › Advanced, per kind | open the sheet, open the Advanced fold | `09-export/ex-advanced-dark.jpg` |
| 09 Export | `ex-advanced` | light | Export › Advanced, per kind | open the sheet, open the Advanced fold | `09-export/ex-advanced-light.jpg` |
| 09 Export | `ex-batch-pick` | dark | Folder / whole project scope — grouped by kind | sheet open, Whole project scope | `09-export/ex-batch-pick-dark.jpg` |
| 09 Export | `ex-batch-pick` | light | Folder / whole project scope — grouped by kind | sheet open, Whole project scope | `09-export/ex-batch-pick-light.jpg` |
| 09 Export | `ex-canvas` | dark | ⇧⌘E with nothing selected → this canvas | deselect, ⇧⌘E | `09-export/ex-canvas-dark.jpg` |
| 09 Export | `ex-canvas` | light | ⇧⌘E with nothing selected → this canvas | deselect, ⇧⌘E | `09-export/ex-canvas-light.jpg` |
| 09 Export | `ex-formats` | dark | Other… — every format, one list away | click Other… | `09-export/ex-formats-dark.jpg` |
| 09 Export | `ex-formats` | light | Other… — every format, one list away | click Other… | `09-export/ex-formats-light.jpg` |
| 09 Export | `ex-handoff` | dark | ⇧⌘H — pick where the code goes | ⇧⌘H | `09-export/ex-handoff-dark.jpg` |
| 09 Export | `ex-handoff` | light | ⇧⌘H — pick where the code goes | ⇧⌘H | `09-export/ex-handoff-light.jpg` |
| 09 Export | `ex-history` | dark | Exports panel (empty — no jobs have run in the browser lane) | ⌘K › Exports | `09-export/ex-history-dark.jpg` |
| 09 Export | `ex-history` | light | Exports panel (empty — no jobs have run in the browser lane) | ⌘K › Exports | `09-export/ex-history-light.jpg` |
| 09 Export | `ex-inspector` | dark | No sheet at all — the inspector with an artboard selected | select the artboard, inspector open | `09-export/ex-inspector-dark.jpg` |
| 09 Export | `ex-inspector` | light | No sheet at all — the inspector with an artboard selected | select the artboard, inspector open | `09-export/ex-inspector-light.jpg` |
| 09 Export | `ex-print` | dark | A print artboard → Print PDF, on paper | open Print canvas, select, ⇧⌘E | `09-export/ex-print-dark.jpg` |
| 09 Export | `ex-print` | light | A print artboard → Print PDF, on paper | open Print canvas, select, ⇧⌘E | `09-export/ex-print-light.jpg` |
| 09 Export | `ex-social` | dark | A digital artboard → PNG or JPG sheet | select, ⇧⌘E | `09-export/ex-social-dark.jpg` |
| 09 Export | `ex-social` | light | A digital artboard → PNG or JPG sheet | select, ⇧⌘E | `09-export/ex-social-light.jpg` |
| 09 Export | `ex-video` | dark | A video artboard → MP4, GIF or sound | open Video canvas, select, ⇧⌘E | `09-export/ex-video-dark.jpg` |
| 09 Export | `ex-video` | light | A video artboard → MP4, GIF or sound | open Video canvas, select, ⇧⌘E | `09-export/ex-video-light.jpg` |
| 10 Share and Collaboration | `co-comment-compose` | dark | A comment being written | Preview mode, comment tool, click, type | `10-share-and-collaboration/co-comment-compose-dark.jpg` |
| 10 Share and Collaboration | `co-comment-compose` | light | A comment being written | Preview mode, comment tool, click, type | `10-share-and-collaboration/co-comment-compose-light.jpg` |
| 10 Share and Collaboration | `co-comment-print` | dark | A comment on a print artboard | Preview, comment tool on the print artboard | `10-share-and-collaboration/co-comment-print-dark.jpg` |
| 10 Share and Collaboration | `co-comment-print` | light | A comment on a print artboard | Preview, comment tool on the print artboard | `10-share-and-collaboration/co-comment-print-light.jpg` |
| 10 Share and Collaboration | `co-comment-thread` | dark | A thread, a mention | send the comment (⌘↵) | `10-share-and-collaboration/co-comment-thread-dark.jpg` |
| 10 Share and Collaboration | `co-comment-thread` | light | A thread, a mention | send the comment (⌘↵) | `10-share-and-collaboration/co-comment-thread-light.jpg` |
| 10 Share and Collaboration | `co-comment-video` | dark | A comment on a video artboard | Preview, comment tool on the video | `10-share-and-collaboration/co-comment-video-dark.jpg` |
| 10 Share and Collaboration | `co-comment-video` | light | A comment on a video artboard | Preview, comment tool on the video | `10-share-and-collaboration/co-comment-video-light.jpg` |
| 10 Share and Collaboration | `co-comments-panel` | dark | Comments panel with the thread | share cluster › Comments | `10-share-and-collaboration/co-comments-panel-dark.jpg` |
| 10 Share and Collaboration | `co-comments-panel` | light | Comments panel with the thread | share cluster › Comments | `10-share-and-collaboration/co-comments-panel-light.jpg` |
| 10 Share and Collaboration | `co-presence` | dark | The Share cluster — faces, status, comments | share cluster, top right | `10-share-and-collaboration/co-presence-dark.jpg` |
| 10 Share and Collaboration | `co-presence` | light | The Share cluster — faces, status, comments | share cluster, top right | `10-share-and-collaboration/co-presence-light.jpg` |
| 10 Share and Collaboration | `co-share-advanced` | dark | Share › Advanced — other ways in, where it syncs | open the Other ways fold | `10-share-and-collaboration/co-share-advanced-dark.jpg` |
| 10 Share and Collaboration | `co-share-advanced` | light | Share › Advanced — other ways in, where it syncs | open the Other ways fold | `10-share-and-collaboration/co-share-advanced-light.jpg` |
| 10 Share and Collaboration | `co-share-sheet` | dark | Share — Invite is the first thing (local project: the cloud offer) | share cluster › Share | `10-share-and-collaboration/co-share-sheet-dark.jpg` |
| 10 Share and Collaboration | `co-share-sheet` | light | Share — Invite is the first thing (local project: the cloud offer) | share cluster › Share | `10-share-and-collaboration/co-share-sheet-light.jpg` |
| 12 Import and Assets | `ia-asset-details` | dark | An asset — details in place of the list | right-click a tile › Show details | `12-import-and-assets/ia-asset-details-dark.jpg` |
| 12 Import and Assets | `ia-asset-details` | light | An asset — details in place of the list | right-click a tile › Show details | `12-import-and-assets/ia-asset-details-light.jpg` |
| 12 Import and Assets | `ia-assets-browse` | dark | Photos › — a wide view to browse and pick many | click the Photos group heading | `12-import-and-assets/ia-assets-browse-dark.jpg` |
| 12 Import and Assets | `ia-assets-browse` | light | Photos › — a wide view to browse and pick many | click the Photos group heading | `12-import-and-assets/ia-assets-browse-light.jpg` |
| 12 Import and Assets | `ia-assets-details-advanced` | dark | Details › Advanced — how the file is stored | details, open the Advanced fold | `12-import-and-assets/ia-assets-details-advanced-dark.jpg` |
| 12 Import and Assets | `ia-assets-details-advanced` | light | Details › Advanced — how the file is stored | details, open the Advanced fold | `12-import-and-assets/ia-assets-details-advanced-light.jpg` |
| 12 Import and Assets | `ia-assets-find` | dark | Search what you made: “Match” | type in the Assets search | `12-import-and-assets/ia-assets-find-dark.jpg` |
| 12 Import and Assets | `ia-assets-find` | light | Search what you made: “Match” | type in the Assets search | `12-import-and-assets/ia-assets-find-light.jpg` |
| 12 Import and Assets | `ia-assets-keys` | dark | Place without dragging — select a tile | click a tile | `12-import-and-assets/ia-assets-keys-dark.jpg` |
| 12 Import and Assets | `ia-assets-keys` | light | Place without dragging — select a tile | click a tile | `12-import-and-assets/ia-assets-keys-light.jpg` |
| 12 Import and Assets | `ia-assets-panel` | dark | Assets — the photos, grouped | left panel › Assets tab | `12-import-and-assets/ia-assets-panel-dark.jpg` |
| 12 Import and Assets | `ia-assets-panel` | light | Assets — the photos, grouped | left panel › Assets tab | `12-import-and-assets/ia-assets-panel-light.jpg` |
| 12 Import and Assets | `ia-assets-tidy` | dark | Not used — what nothing uses | “Not used” chip | `12-import-and-assets/ia-assets-tidy-dark.jpg` |
| 12 Import and Assets | `ia-assets-tidy` | light | Not used — what nothing uses | “Not used” chip | `12-import-and-assets/ia-assets-tidy-light.jpg` |
| 12 Import and Assets | `ia-brand-steps` | dark | Drop a logo or type a website | ⌘K › Import a brand | `12-import-and-assets/ia-brand-steps-dark.jpg` |
| 12 Import and Assets | `ia-brand-steps` | light | Drop a logo or type a website | ⌘K › Import a brand | `12-import-and-assets/ia-brand-steps-light.jpg` |
| 12 Import and Assets | `ia-figma-sheets` | dark | Paste a link · Connect once | ⌘K › Import from Figma… | `12-import-and-assets/ia-figma-sheets-dark.jpg` |
| 12 Import and Assets | `ia-figma-sheets` | light | Paste a link · Connect once | ⌘K › Import from Figma… | `12-import-and-assets/ia-figma-sheets-light.jpg` |
| 12 Import and Assets | `ia-gen-ask` | dark | Generate an image — the ask | ⌘K › Generate with AI… | `12-import-and-assets/ia-gen-ask-dark.jpg` |
| 12 Import and Assets | `ia-gen-ask` | light | Generate an image — the ask | ⌘K › Generate with AI… | `12-import-and-assets/ia-gen-ask-light.jpg` |
| 12 Import and Assets | `ia-photo-inspector` | dark | Select a photo — the photo inspector | click the photo on the artboard | `12-import-and-assets/ia-photo-inspector-dark.jpg` |
| 12 Import and Assets | `ia-photo-inspector` | light | Select a photo — the photo inspector | click the photo on the artboard | `12-import-and-assets/ia-photo-inspector-light.jpg` |
| 12 Import and Assets | `ia-photo-steps` | dark | Photo tab — crop, remove background | inspector › Photo tab | `12-import-and-assets/ia-photo-steps-dark.jpg` |
| 12 Import and Assets | `ia-photo-steps` | light | Photo tab — crop, remove background | inspector › Photo tab | `12-import-and-assets/ia-photo-steps-light.jpg` |
| 13 Design System | `ds-make-entry` | dark | A project with no design system — “Make a design system” | empty project, Canvases panel | `13-design-system/ds-make-entry-dark.jpg` |
| 13 Design System | `ds-make-entry` | light | A project with no design system — “Make a design system” | empty project, Canvases panel | `13-design-system/ds-make-entry-light.jpg` |
| 13 Design System | `ds-make-inputs` | dark | Make a design system — three quick inputs | Canvases › Make a design system | `13-design-system/ds-make-inputs-dark.jpg` |
| 13 Design System | `ds-make-inputs` | light | Make a design system — three quick inputs | Canvases › Make a design system | `13-design-system/ds-make-inputs-light.jpg` |
| 13 Design System | `ds-make-sentence` | dark | The sentence typed | type a sentence into the field | `13-design-system/ds-make-sentence-dark.jpg` |
| 13 Design System | `ds-make-sentence` | light | The sentence typed | type a sentence into the field | `13-design-system/ds-make-sentence-light.jpg` |

## Artboards not reachable in the browser lane

Reasons: **hub** = needs a signed-in cloud project, a second person or a hub (the browser lane runs one local project, no hub) · **ai** = needs a running AI agent (the lane has none: the panel says “AI editing isn’t ready yet”, and that state is what `cf-ai-panel` / `ob-ai-connect` / `es-ai-panel` show) · **desktop** = native shell only (OS windows, native pickers, Finder drops, accelerators, relaunch) · **media** = needs footage / transcripts / a render service the fixtures don’t hold · **ds-board** = the DS seeds (see below) · **not shot** = reachable here, left out for turn budget — not a verdict about the build.

**Design-system board (13) — read this first.** The S10 e2e seeds (`seed-ds-reach/-switch/-outside`) write a one-line placeholder `design-system.tsx`; in the desktop app the DS canvas is the engine-converted board, but in this lane the pinned “Design system” row never appears (the Canvases panel offers “Make a design system” instead) and opening `system/acme/design-system` shows “design-system can’t be drawn right now — It didn’t finish loading”. I judged this to be the seed (a bare component never posts `canvas-rendered`), not a regression, but I did not prove it: the same card also appears with the origin split off. **If the lead wants a DS board shot, the DS gate needs the desktop lane or a converted project.** Only the three “Make a design system” frames of 13 are in the set.

## 01 Create Flow
- ai: `cf-ai-drafting`, `cf-ai-done`, `cf-undo-before`, `cf-undo-ai`
- hub: `cf-busy` (Tereza, Jonas, AI and you)
- desktop/offline: `cf-offline-create`
- not shot: `cf-duplicate-width`, `cf-duplicate-done`, `cf-frames-text`
- the board’s `cf-home-prompt` is shot from the project-less Home server (`--home`), see `cf-home-*`

## 02 Onboarding
- hub: `ob-signin-browser`, `ob-home-new`, `ob-invite-page`, `ob-invite-landed`, `ob-home-team`, `ob-local-moved`, `ob-edge-timeout`, `ob-edge-other-mac`, `ob-edge-accounts`
- ai: `ob-first-draw`, `ob-sig-draw`, `ob-edge-ai-missing` (the not-connected panel itself is `ob-ai-connect`)
- desktop: `ob-local-name`, `ob-local-first` (the create-project sheet opens a native window), `ob-edge-offline`
- not shot: `ob-adv-sheets`

## 05 Empty States
- hub: `es-home-cloud`, `es-home-shared` (Home is signed out in the lane), `es-viewer`, `es-arriving`, `es-edge-panels` (team of one)
- desktop/offline: `es-offline-uncached`
- not shot: `es-landing` (animation), `es-canvas-three`, `es-timeline`, `es-filter` (kind chips exist only once a canvas has artboards), `es-all-trashed`

## 06 Advanced
- shot: `ad-left`, `ad-inspector`, `ad-ai`, `ad-share`, `ad-export`, `ad-logs`, `ad-diag`, `ad-syncd`, `ad-ai-diag`, `ad-settings`, `ad-search`, `ad-code` (⌘K row only)
- not shot: `ad-map`, `ad-why`, `ad-trace`, `ad-timeline`, `ad-history`, `ad-ds`, `ad-menus`, `ad-pinned`, `ad-open-all`, `ad-edge-*`
- ds-board: `ad-ds`

## 07 Video Editing
- media: the fixtures’ footage (`aaaa1111.mp4`) is absent, so artboards show the designed “Missing — no device has it” card and the console carries one `MEDIA_ELEMENT_ERROR`; `ve-drop`, `ve-footage`, `ve-render`, `ve-fit-fill`, `ve-long`, `ve-advanced`
- ai: `ve-ai-cut`, `ve-ai-watch`, `ve-ai-scrub`, `ve-ai-proposal`, `ve-ai-adjust`
- hub: `ve-together`
- not shot (a click on `timeline-seq-*` / `timeline-seam-*` / `timeline-add-title` timed out, so these frames are missing rather than wrong): `ve-trim-split` (shot as the artboard only), `ve-move-transition`, `ve-transition`, `ve-text`

## 08 Artboard Kinds
- not shot: `ak-web-hug`, `ak-web-widths`, `ak-social`, `ak-safe-zones`, `ak-print-view`, `ak-convert`, `ak-convert-after`, `ak-warnings`, `ak-advanced`, `ak-real-*` (the real FLAG boards live in the studio-site project, not a fixture)
- shot under other ids: the picker (`ak-picker`, `-full`, `-custom`, `-search` — some of these failed on the second theme, see the table), `ak-print-letak`, `ak-video`, `ak-mixed-fit`, `ak-mixed-filter`, `ak-mixed-select`

## 09 Export
- media/render: `ex-progress`, `ex-states`, `ex-batch` (needs a job), `ex-offline`, `ex-huge`
- hub: `ex-share-vs`, `ex-edges` (viewer, AI mid-change)
- not shot: `ex-handoff-ready`, `ex-handoff-edges`, `ex-print-warn`, `ex-web` (no web artboard in the fixtures)
- shot as: `ex-social`, `ex-print`, `ex-video`, `ex-inspector`, `ex-formats`, `ex-canvas`, `ex-batch-pick`, `ex-handoff`, `ex-history`, `ex-advanced`

## 10 Share and Collaboration
- hub (all of it needs a cloud project and a second person): `co-roles`, `co-browser-view`, `co-follow`, `co-bring`, `co-spotlight`, `co-mention-notify`, `co-sync-offline`, `co-sync-back`, `co-conflict`, `co-trashed`, `co-twelve`, `co-ask-edit`, `co-access-ends`
- ai: the “two AIs” part of `co-presence`
- shot: `co-share-sheet` (local project: the move-to-cloud offer is what the lane shows), `co-share-advanced`, `co-presence` (the cluster with one face), `co-comment-compose`, `co-comment-thread`, `co-comments-panel`, `co-comment-video`, `co-comment-print`

## 12 Import and Assets
- desktop: `ia-drop-photos`, `ia-placed`, `ia-more-ways` (Finder drops, paste, native picker)
- hub: `ia-missing`, `ia-missing-gone` (“Waiting for Jonas”), `ia-edges` (twice / offline / Tereza)
- media/network: `ia-gen-placed` (provider), `ia-figma-arrived`, `ia-figjam`, `ia-brand` (the website read)
- not shot: `ia-advanced` as a whole (the asset-details Advanced fold is `ia-assets-details-advanced`)

## 13 Design System
- ds-board: every board, editing, reach, review, truth, switch, library, migrate and edge state (`ds-where-*`, `ds-board-*`, `ds-edit-*`, `ds-truth-*`, `ds-many-*`, `ds-multi-*`, `ds-edge-*`, `ds-advanced`)
- ai: `ds-make-directions`, `ds-make-mix`, `ds-make-filling`, `ds-make-done`
- shot: `ds-make-entry` (`canvases-ds-make` row), `ds-make-inputs` (`ds-make-inputs` — the three quick inputs), `ds-make-sentence`

## Caveats on single frames
- `ak-picker-full`, `ak-picker-custom`, `ak-picker-search`, `ad-left`: the click that sets the state timed out in the last run of one theme; that theme's frame comes from an earlier identical run of the same script, so the pair was shot minutes apart, not in one session. `ak-picker-full` also leaves an A2 ghost on the canvas (the tile click places it).
- `ve-none` is the video canvas as it opens (the lane, not a seed, decides whether the timeline is up).
- `es-search-panel` and `es-filter` are absent: the empty project has no canvases to search or filter.
- Console: one `MEDIA_ELEMENT_ERROR` per video canvas (missing fixture media) is expected; no other page errors were logged in any run.

