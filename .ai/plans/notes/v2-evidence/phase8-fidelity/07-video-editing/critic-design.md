# design-critic — 07 Video Editing · phase 8 stage B (fidelity)

_2026-10-22 · board `.design/ui/v2/07 Video Editing.tsx` (+ `.css`, `_video.css`, `_kit.css`) · pairs `07-video-editing/*` (full size in `agent-af625ef88bd36c798/.scr/pairs/07`) · lens: layout, spacing, sizes, type, colour/tokens, material, iconography, drawn states · read-only, no server booted_

**Themes.** Every 07 artboard is a light-pinned Stage. The "dark" spec half is the host re-theme, not a designed state, so dark impl is judged against the app's own dark tokens. A dark row only lists what dark adds; "= light" means the light findings hold.
**Paths.** `C/` = `apps/studio/client/`, `S/` = `apps/studio/`, `CSS3` = `C/styles/3-shell-maude.css`. Fixture-only differences are listed as **(fixture)**, sev `—`.

**Blockers: 41** · Warnings: 34 · Verdict: **fix-and-retry** (`opt_out_scope` palette, nothing downgraded)

## Root causes (several artboards each)

| # | Root cause | Owner | Artboards |
|---|---|---|---|
| RC1 | **The timeline island still runs the v1 timeline body.** It has a `V1 STORYLINE` mono lane, sky `#0ea5e9` blocks with no thumbnails or names, a `+` at every seam, a 9 px mono ruler with ticks, a mono "0.00s" playhead chip, a 9 px/700 mono lane id, and the extra header controls (accent-filled play, jump-to-start, mute, volume range, AI placeholder, comment tool, `30 fps · 867f`, zoom range, ×). The board's compact island has none of these: 20 px tinted track-icon chips (no names in compact), sans ruler labels, filmstrip clips with name chips, lilac/yellow/green track tints, `0:04 / 0:15` sans semibold, and four icon tools + Expand. Most of this CSS is **un-layered** (CSS3:10100–10419, after `@layer shell` closes at :10099), so it beats every layered v2 rule. | `C/v2/timeline/Timeline.jsx:1859-2064, 2305-2311, 1694, 2669`; CSS3:5595, 5614-5624, 5745, 6133-6150, 6183-6191, 10176-10245, 10360-10371 | select, deselect, drop, trim-split, move, transition, text, captions, music, formats, play, footage, long, advanced |
| RC2 | **Body portals leave the v2 token scope.** v2 tokens live on `.maude[data-theme]`. `createPortal(…, document.body)` resolves the legacy `:root` palette instead (`C/styles/1-tokens.css:32-140`: beige `--bg-2` hue 78, orange `--accent`, Berkeley Mono `--font-body`), and `--object-*` are undefined there. | `C/v2/timeline/Timeline.jsx:2825-2845` (picker), `:2700, :2759, :2872, :2878`; `other-takes.jsx:255`, `reframe-island.jsx:463`, `edit/drop.jsx:81` | transition (seen); predicted for adjust (other takes), reframe, fit-fill, drop tip, clip menu, comment popover |
| RC3 | **The inspector is a docked full-height panel, not a floating island.** It has an "Inspector" title strip with ×, sits 285 px wide from top to bottom, and uses native `<select>` (`st-cp-nsel`: 1 px `--border-default`, `--radius-xs`, `--type-xs`, OS arrow, no `appearance:none`). The board uses a content-height island (~262 px), name + kind chip as its head, and DS `.select`/`.input` (`appearance:none`, `--bg-3`, `--radius-md`, 28 px, inset 0.5 px `--border-subtle`, chevron icon). The dock also stops the full timeline at the inspector edge. | `C/shell/dock.jsx:61-90, 182-200`; `C/inspector-controls.jsx:507-526`; CSS3:4391-4406; `C/v2/timeline/anchor.js:37-40` | every artboard with an inspector, plus long and advanced |
| RC4 | **The toast is v1's sonner card, not the kit pill.** It is 360 w with 16 px padding and a 3 px accent side-stripe, has a ×, puts the action on a 2nd line, uses 13 px type, and sits bottom-centre at offset 84, so it covers the timeline. It also stays across later steps. The board's `k-toast` is an island pill: min-h 40, `--type-sm`, inline ghost action, `at="top"` for timeline verbs. | `S/notifications.tsx:223-238, 294-297` | trim-split, text, move, play, export |
| RC5 | **v1 chrome left in the canvas iframe.** The DDR-148 video badge (top-right of the label row, `--bg-2,#e8e3d8` beige fallback, beige in dark too) has no spec counterpart. The toolbar uses 32 px buttons (spec 40), a raw 14 px radius, mono font, an active underbar, and a separator after Hand instead of before More. The Undo · Redo · zoom % pill is not built ("ZoomUndo later"). | `S/canvas-lib.tsx:617-645, 3114, 4474`; `S/toolbars/toolbar-css.ts:16-83`; `S/tool-palette.tsx:722-727` | every canvas artboard |
| RC6 | **Code names in the timeline.** Rows are labelled with the component/sequence id behind an `ƒ` glyph (`Absol…`, `beat-one`, `oslava`), shown in a v1 label column next to the track caption. The board shows clip names on the filmstrip and no per-row label in compact. (The names themselves are partly fixture; the glyph and the column are impl.) | `C/v2/timeline/Timeline.jsx:110-120, 2545-2552, 2366-2378` | drop, trim, move, text, music, transition |

## Per artboard

### ve-none
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | The artboard plays a scrub bar at rest | centred play glyph only ("nothing hints") | bar `▶ ──── 0:10 / 0:28` across the bottom | `S/video-play-chrome.tsx` (bar shown once "started") | blocker |
| light | Ring around the artboard with nothing selected | no ring | 1.5 px azure rim | `S/canvas-shell.tsx` HALO_CSS / active-artboard pick `S/canvas-lib.tsx:2430` (may be hover; re-check) | warning |
| light | Label carries no length | "Hype trailer · Reels · 0:15" + video glyph | "Trailer" | `S/canvas-lib.tsx:2965` (label not suffixed with length) | warning |
| light | Extra video badge | none | camera chip, beige | RC5 | blocker |
| light | No undo/redo/zoom pill; toolbar sizes | pill bottom-left; 40 px tools, 56 px dock | none; 32 px tools, underbar | RC5 | blocker |
| light | One trailer, not three artboards | social canvas at 22 % | (fixture) | — | — |
| dark | = light; the badge stays beige on dark | — | `--bg-2,#e8e3d8` fallback | RC5 | (counted) |

### ve-select
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Timeline header controls | ghost play, loop, `0:04 / 0:15` sans 600, video glyph + name, 4 tools, divider, Expand | filled-accent play, ⏮, loop, filled mute, volume range, mono time, 6 tools, `30 fps · 867f` mono, zoom range, Expand, × | RC1 `Timeline.jsx:1859-2064` | blocker |
| light | Track gutter | 20 px chips (T / image / video / music) on tints, no names in compact | "Text / Graphics / Video" words + `V1 STORYLINE` mono badge; no Music row | RC1 `Timeline.jsx:992-1005, 2305-2311`; `timeline.css:121-135` | blocker |
| light | Clip material | filmstrip thumbnails, name chips (ink 78 %), `--radius-sm` | `#0ea5e9` 22 % sky blocks, play glyphs, no names | CSS3:10224-10227 | blocker |
| light | `+` insert at every seam, at rest | none | ~24 `+` circles | `Timeline.jsx:1694`; CSS3:5745 + rest override ~10372 | blocker |
| light | Ruler | sans `--type-xs` labels, no ticks | 9 px mono labels + tick marks; mono "0.00s" playhead chip | CSS3:6183-6191, 10176-10181, 10360-10371 | blocker |
| light | Poster flag on the ruler missing | "Poster" flag at 0:04 | none (the inspector says 0:10) | `Timeline.jsx:2153` (`poster` null in the island) | blocker |
| light | Advanced fold drawn in compact | Advanced only in Full | "› Advanced · Frames, keyframes, the cut as code" row | `advanced/foot.jsx` | warning |
| light | Inspector frame | floating card | docked full-height "Inspector" panel | RC3 | blocker |
| light | Size select | DS `.select` "Reels 9:16" | native select "Custom", 1 px border | RC3 (`artboard-rows.jsx:45-64`) | blocker |
| light | Length is not a field | InNum (clock + filled input) | read-only text | `C/v2/inspector/kinds/artboard-video.jsx:26-30` | warning |
| light | Poster frame | 22×38 thumbnail + 0:04 + ghost "Change" button | "0:10" + underlined fg-2 "Change" | `artboard-video.jsx:32-46`; `sections.css:521-532` | blocker |
| light | Sound row | swatch + name in InFill | plain "None yet" (no music in the fixture) | `artboard-video.jsx:48-52` | warning |
| light | Extra rows/sections | Size · Length · Poster · Sound · Export MP4 · Advanced (5) | + "Uses project" accent bar, Fill, Layout, Formats, Safe zones, Export presets list | `C/v2/inspector/sections.js` (slot registry) | warning |
| light | Notch and width | 900 w, notch under the artboard | 900 w, notch present ✓; overlays the video (camera) | — | — |
| dark | = light; "this one" in the Formats row is near-invisible (fg-2 on accent-tint) | — | — | `C/v2/inspector/sections/formats.jsx:60` | warning |

### ve-deselect (partial: only "Kept open" is app UI; the four-step diagram, rules card and menu are explainers)
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Kept-open island = ve-select header/body | as ve-select | RC1 set | RC1 | (counted) |
| light | "Kept open" status present ✓; × close sits next to it | no × (⇧⌘T / deselect) | × | `Timeline.jsx:2061` | warning |
| light | Island overlaps the artboard's own scrub bar | — | island bottom at the bar | `S/video-play-chrome.tsx` + `timeline.css:17-19` | warning |
| dark | = light | | | | |

### ve-drop (partial: synthetic drag)
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Drop rim | inset 6 px, 2 px dashed `--accent`, `--radius-sm` | 1.5 px dashed at inset 0, hidden under the solid selection ring | `S/editing/drop-chip.tsx:38-43` | blocker |
| light | Drop chip | bottom of the artboard, `+` 12 px icon, `--type-xs` 600, 2 px/`--space-2` pad, `--radius-pill` | vertically centred, no icon, 12 px/16, 4×10 pad, `999px` | `drop-chip.tsx:44-48` (`place-items:center`) | blocker |
| light | Timeline caret + tip + ghost clip stack | "Drop 3 clips at 0:09 / the video grows by 0:20" + dark tip + 3-badge ghost | none captured (the code exists; the tip's dim line reads "…by what you drop") | `C/v2/timeline/edit/drop.jsx:23-30` | warning |
| light | No inspector on the selected video | Video inspector | none | inspector open-on-select | blocker |
| light | Row labels `ƒ Absol…` / `ƒ beat-one` | — | RC6 | RC6 | (counted) |
| dark | = light | | | | |

### ve-trim-split
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Split toast | top-centre pill "Split Oslava at 0:10. **Undo**" | bottom card with stripe and ×, Undo on 2nd line, over the timeline | RC4 | blocker |
| light | Split tooltip naming the key | "Split at the playhead · S" | "Split at playhead (⌘B)" | `Timeline.jsx:1958` | warning |
| light | Clip inspector Length | InNum "2.5 s" with clock | NumberField "3  s" with native spinners | `C/v2/inspector/kinds/clip.jsx:85-99` | warning |
| light | Clip inspector shows "Uses project" | not on a clip | accent bar | `sections.js` | warning |
| light | Clips drawn one per row (staircase) | one Video track | `beat-…` on its own row each | RC1 (overlay rows) / fixture series | warning |
| light | Spec is the Full timeline (eye/volume buttons, zoom −/+, Fit, Compact, grip); harness was Compact | — | not driven | (fixture/harness) | — |
| dark | Inspector stayed on the artboard (light showed the clip) | — | lane timing | (fixture) | — |

### ve-move-transition
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Lifted clip / insert line / "Drop before Touchdown" tip not drawn | lift −10 px, −1.5°, `--shadow-lg` + 2 px accent, tip | none (the drag did not select or lift) | `C/v2/timeline/edit/move.jsx:30-40`; `Timeline.jsx:1262` | blocker |
| light | Inspector on the artboard, not the clip | ClipInspector: Length · Speed · Volume 70 % · Framing | Video artboard rows | selection on drag | blocker |
| light | Stale toast from the previous step | none | split card | RC4 | (counted) |
| light | Volume/Framing rows (they show only for footage with sound/picture) | — | (fixture: component beats) | `clip.jsx:192-193` | — |
| dark | = light | | | | |

### ve-transition
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Picker type | sans; title "Oslava → Logo" `--type-xs` 600 fg-2 | Berkeley Mono everywhere, "oslava → logo" | RC2 | blocker |
| light | Picker surface | `--bg-2` island, `--radius-lg`, soft shadow | beige `oklch(93% .012 78)` (legacy `:root`) | RC2 | blocker |
| light | Tile pictures missing | 64×40 two-shot thumbnails per tile, the selected one tinted `--accent-muted` | blank space above each label (`--object-*` undefined) | RC2; `joins/joins.css:107-120` | blocker |
| light | Big preview slab not on the board | tiles are the preview | 16:9 `tj-preview` grey "logo" slab | `joins/transition-picker.jsx:167` | blocker |
| light | Length slider colour | `--accent` azure | orange (legacy `--accent`) | RC2; `joins.css` `.tj-range` | blocker |
| light | Anchoring | on the join, above the timeline | above the artboard, covering it | `transition-picker.jsx:145-160` (`bottom` from the join y) | warning |
| light | Extra foot link "Remove transition (hard cut)" underlined mono | not drawn | shown | `transition-picker.jsx:224-233` | warning |
| dark | Picker is warm brown (legacy dark `:root`, hue 60) next to the cool app dark | — | — | RC2 | blocker |

### ve-text
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | A new title is not selected and no Title inspector opens | selected title on the artboard (ring + "Title · Slide up" tag) + inspector Font · Colour · Motion grid (6 tiles) · Length | nothing selected; artboard inspector absent | `Timeline.jsx:1972-1980` (`onAddTitle`) → `C/v2/inspector/kinds/title-rows.jsx` | blocker |
| light | Toast | top pill "Captions added — 15 words… Undo" | bottom card "Title added." | RC4 | (counted) |
| light | Text-track item | lilac chip "T PROČ ALLIGATORS" 600 | sky block `ƒ AbsoluteFill` | RC1/RC6 | (counted) |
| light | Serif "Title" in the artboard | — | (fixture default component) | — | — |
| dark | = light | | | | |

### ve-captions
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | No Transcript card, caption chips or Captions inspector | — | footage missing → hatched tile | (fixture) | — |
| light | Missing clip block material | `.ve-clip--off`: grey hatch, 1.5 px `--border-strong` | sky fill + dashed `--status-warn` border | `timeline.css:304-312`; CSS3:10224 | warning |
| dark | = light | | | | |

### ve-music
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Music bed colour uses a status token | `--ve-music-bg` = object-green 30 % over `--bg-2` | `--status-ok` 18 % (a teal-green), stroke `--status-ok` 80 % | CSS3:6513-6535; `.tl-row--audio` `#22c55e` CSS3:~10214 | blocker (ds-status) |
| light | Waveform | bar waveform + a tick on every beat (tall per bar) | placeholder sine path; faint ticks | `Timeline.jsx:1780-1786` (sine fallback when no peaks) | warning |
| light | Bed label | `bg-2` chip "♫ Hype instrumental · 120 BPM" | mono "song.mp3" over the wave; "120 BPM" clipped by the block edge | `Timeline.jsx:1788`; `timeline.css:265-272` (`.tl-music-bpm`) | blocker |
| light | Clicking the bed does not select it; no Music inspector | Volume 80 % · Lower under speech · Snap to the beat · Fade · Song Change… | artboard inspector | `lanes/music-lane.jsx`; `C/v2/inspector/kinds/music.jsx` | blocker |
| dark | = light | | | | |

### ve-formats
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Selection tag overlaps the video badge on a narrow artboard | tag "Recap · Reels · 0:30 1080 × 1920" | "…0:03 180 [badge]20" collision | RC5 `canvas-lib.tsx:636-643` | blocker |
| light | Formats rows | inside the Size block, link glyph + name + size per row, "this one" fg-2 | own section; 1 row "9:16 this one" on an accent-tint bar | `C/v2/inspector/sections/formats.jsx:50-70` | warning |
| light | "Make an unlinked copy" | secondary button with duplicate icon | (hidden: `canUnlink` false, one format); when shown it is an underlined quiet link | `formats.jsx:177-187` | warning |
| light | Safe zones | select "Instagram Reels" | native select "None" + a three-line paragraph | RC3 | warning |
| light | "Shared by 3 formats" status in the timeline header | link glyph + text | none (one format) | (fixture) | — |
| light | Size reads "Custom" | Reels 9:16 | (fixture 180×320) | — | — |
| dark | "this one" unreadable on accent-tint | — | — | `formats.jsx:60` | (counted) |

### ve-reframe (partial: the window was not opened)
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Re-frame window not reached | "Frame 'Touchdown' for" + format seg + crop boxes + Follow a subject + Reset/Done | no frame (footage missing; no clip selected) | `C/v2/timeline/reframe-island.jsx:463-484`, a body portal, so RC2 is likely | warning (unverified) |
| light | Missing tile on the artboard | — | red hatch + white card + filled Relink… | `S/asset-placeholder.tsx:47` | (not drawn in 07) |
| dark | = light | | | | |

### ve-play
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Pressed play/loop | `k-pressed` tint on the icon buttons | solid accent fill (play), filled mute | RC1 `Timeline.jsx:1862-1902` | (counted) |
| light | "Sound on" meter in the header | 3-bar meter + "Sound on" | none | `Timeline.jsx` header (no status slot for sound) | blocker |
| light | Readout | "0:07 + 2 frames / 0:15" sans | `0:04 / 0:06` mono (frames only while stepping) | CSS3:6133 `.tl-readout` mono | blocker |
| light | Key hints as tips | "Pause — tap space…" and "Step ← → one frame ⇧ one second" `ve-tip`s | native `title` only | `Timeline.jsx:1867` | warning |
| light | Loop band | `--accent-tint` band + 2 px accent edges and lane tint | none (loop not set by the harness); impl band is 22 % accent + 1 px + I/O letters | `timeline.css:146-185` | warning |
| light | Stale split toast | none | card over the timeline | RC4 | (counted) |
| dark | = light | | | | |

### ve-fullscreen
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Stage colour | `--object-ink` | pure black (the preview did not paint in this lane) | `C/v2/present/video-present.css` | warning |
| light | Bar placement | in flow under the video (gap `--space-4`), 720 w, `--radius-xl` | absolute `bottom: --space-5`, on the window edge | `video-present.css:65-76` | blocker |
| light | Volume | icon only | icon + 64 px blue range | `video-present.jsx:220-230`; `video-present.css:139-142` | blocker |
| light | Pause pressed state | `k-pressed` tint | plain ▷ (not playing) | (lane) | — |
| light | Format switcher "Reels 9:16 · 16:9 · 1:1" | top-left InSeg | none (one format) | (fixture) `video-present.jsx:116` | — |
| light | Scrub marker ticks | 2×10 fg-2 ticks | none | (fixture: no markers) | — |
| dark | = light | | | | |

### ve-export
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Title | 'Export "Recap"', 600 | "Export 1 artboard" + subtitle "VideoEdit" (the label is not passed) | `C/v2/export/export-copy.js:43-47` (caller passes no `label`) | warning |
| light | Captions options | Burned in · As a file · Both · Off | Off · Burned in | `C/v2/export/sections/video.jsx:221-243` | blocker |
| light | Render-location cards | two radio cards "In the cloud / On this Mac" with time lines | none; one line "about 45 seconds on this Mac" | `sections/render-row.jsx:22` (`choice.show` false when signed-out/local; re-check on a cloud project) | blocker |
| light | Segment style and alignment | values right-aligned; the selected segment is an outlined pill | left column after the labels; the selected segment is a raised white chip | `C/v2/export/export.css` (`Seg`) | warning |
| light | Format tiles | 2-col tiles with a thumbnail + name + size | one wide chip, no thumbnail (one format) | `C/v2/export/video-content.js` | warning |
| light | Extra caption timeline strip + "Sound" row | not drawn | empty range strip with a "0:00" accent chip; "Music, mixed as on the timeline" | `C/export-region.ts`; `sections/video.jsx:205-218` | warning |
| light | Primary | "Export 3 videos" | "⤓ Export ↵", double focus ring | `export-copy.js` `primaryLabel` | warning |
| light | Estimate line | on the Advanced row "3 videos + 1 caption file · about 48 MB" | its own line | `C/v2/export/export-sheet.jsx` | warning |
| light | Scope as a select vs segmented | select "This canvas · 4 artboards" | 4-way segmented with counts (CONTRACT §7 allows it) | — | — |
| dark | = light; the stale toast shows under the sheet | | | RC4 | (counted) |

### ve-footage (partial: only Missing is reachable)
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Waiting state, "3 clips still preparing", preparing bars and clip File/Status rows | quiet grey hatch + "Waiting for Jonas's Mac" | not reachable: only Missing | `C/v2/timeline/footage-state.js`, `timeline.css:304-330` | warning (unreached) |
| light | Missing clip block | `.ve-clip--off` grey hatch | sky + dashed warn border | (as ve-captions) | (counted) |
| dark | = light | | | | |

### ve-long (partial)
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | Full width | edge to edge (`--space-4` each side) under a floating inspector | stops at the docked inspector, ~700 px | RC3 `anchor.js:37-40` | blocker |
| light | Full header | zoom −/bar/+ (84 px, 12 px knob), Fit, Compact; no × | v1 range zoom, Compact, × | RC1 `Timeline.jsx:2045-2064` | blocker |
| light | Track names column (132 px, eye/volume buttons) and fold rows "Text · 18 / Graphics · 6" | drawn | not drawn: compact gutter kept | `Timeline.jsx:992-1005` (fold button exists) | blocker |
| light | Ruler markers (Výkop, TD 1, Poločas, TD 2) | flags with a 2 px fg-1 left edge | none | (fixture: no markers) | — |
| light | Grip on the top edge | 36×4 pill | v1 resize handle | `Timeline.jsx:1852-1858` | warning |
| light | 24 vs 40 clips | — | (fixture) | — | — |
| dark | = light | | | | |

### ve-advanced
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | "Copy timecode" is an unstyled native button | (DS ghost/sm button) | black 1 px border, system font | `C/v2/timeline/advanced/advanced.css:125-135` (no `appearance:none; border:0; font:inherit`) | blocker |
| light | Content spills out of the island | contained | "colour Rec. 709" row and the "Long videos" note run below the island, over the canvas and toolbar | `advanced.css:30-37` + island has no max-height (`timeline.css:17-26`) | blocker |
| light | Tracks hidden while Advanced is open | tracks stay; the ruler switches to frame numbers (240 · 300 …) | the ruler stays m:ss; tracks replaced by the 3-col Advanced grid | `advanced/foot.jsx` | blocker |
| light | Easing curve | graph card (frame 330 → 342, cubic-bezier row, y row) | "Pick a keyframe on a clip" (no clip picked) | (lane) | — |
| light | Cards placement | floating Render settings / Easing / Cut-as-code islands beside the artboard | inside the timeline foot | `advanced/*` (a deliberate lift into the foot; check against the board's note 26) | warning |
| dark | = light | | | | |

### Unreachable (spec only): each is a finding, the state isn't shown in the app yet
| id | what is missing | product work that makes it reachable |
|---|---|---|
| ve-ai-cut | the AI-cut picture (an explainer) plus its live parts: placed-shot spark ring and "Placing shot 8 — lands on the beat" | a replayable AI-cut run: an ACP stub or a recorded `aiCut` timeline-store fixture for the browser lane (`C/v2/timeline/ai-edge.jsx`) |
| ve-ai-watch | "AI is watching footage" tag, the empty-lane hint "Shots land here as AI places them.", the Working card | same replay, which needs a signed-in or stubbed Claude |
| ve-ai-scrub | the AI edge (spark playhead + "AI" flag), the island ringed in spark, "AI is cutting · 7 of 14", the floating "Placing shot 7" card | same, mid-run |
| ve-ai-proposal | "Made by AI · 14 shots" header chip, spark island ring, the Result card | same, finished run |
| ve-ai-adjust | the Other takes popover (3 takes, "AI's pick") | a finished AI cut with takes; the popover is a body portal (`other-takes.jsx:255`), so RC2 is expected |
| ve-render | the Exports ring, the Exports panel rows (Ready / Rendering 64 % / Queued) and the done/partial toasts | export jobs that can run in the browser lane, or seeded `exports-model` jobs (`C/v2/export/exports-panel.jsx`, `done-toast.jsx`) |
| ve-together | a peer playhead (sky), "Tereza is fixing a caption" flag, a peer-locked word | a second peer on a linked hub (`C/v2/timeline/peers.jsx`, `together.css`) |
| ve-fit-fill | the "is vertical — how should it sit?" ask (Fill / Fit / Blur behind + "Same for every vertical clip"), and "No sound in this video. Add music" | inserting a vertical clip by `clip.insert` without a Finder drag (Assets ↵ place); the ask is a body portal (`Timeline.jsx:2872`), so RC2 is expected |

---

## Verdict

```json
{
  "canvas": "07 Video Editing",
  "critic": "design-critic",
  "agent": "design-critic",
  "blockers": 41,
  "warnings": 34,
  "top_blockers": [
    { "category": "ds-tokens", "line": 2825, "summary": "Transition picker portals to document.body and renders in the legacy :root palette (beige, orange accent, mono, no tile pictures)", "fix": "Mount timeline popovers inside the .maude[data-theme] root, or re-declare the v2 token scope on the portal host." },
    { "category": "ds", "line": 1859, "summary": "Timeline island body is v1 (storyline lane, sky #0ea5e9 blocks, + seams, 9px mono ruler, extra header controls); its CSS is un-layered (3-shell-maude.css:10100-10419)", "fix": "Lift the board's compact/full .ve-tl anatomy into the island and drop or layer the v1 rules." },
    { "category": "ux", "line": 223, "summary": "Toasts are the v1 sonner card with a side stripe at bottom-centre, covering the timeline, and they persist", "fix": "Render the kit k-toast pill (top for timeline verbs), with the action inline." }
  ],
  "opt_out_applied": "palette",
  "ds_blockers_downgraded": 0,
  "passed": false,
  "verified_ids": []
}
```
