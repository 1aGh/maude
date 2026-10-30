# design-critic — 04 Modes · V2-8.5 stage B

_2026-10-22 · board `.design/ui/v2/04 Modes.tsx` (+ `04 Modes.css`, `_kit.css`, `_kit.tsx`) · DS `.design/system/maude-v2/` (`preview/_components.css` for `.dock` / `.icon-btn` / `.island` / `.kbd`) · pairs from `04-modes/INDEX.md`; all 52 full-size pairs read, plus the two `extra-impl` frames (comment-thread, edge-ai-after). This was a read-only review. Nothing was edited and no server was booted._

Lens: layout, spacing, sizes, typography, colour/tokens, material, iconography, and every state the board draws. INDEX C1–C6 (no title bar or tab strip, Share-cluster people/status, stand-in Homepage/Pricing/Combine content, note strips, camera numbers driven by fixture) are **(fixture)** and not findings. Spec "dark" is the host re-theme of a light-pinned board. User designs stay pinned light in both lanes, so a light page inside a dark shell is not a finding.

**C0 (root cause, named once, already being fixed):** the shell still runs on the v1 `.maude` token ladder and v1 buttons (accent hue, radii, type scale, dark surfaces, `.btn--primary` Share). This report does not repeat it per artboard. Every row below is a difference that remains *after* C0.

## Root causes (rows cite them as R1–R8)

| # | root cause | spec | impl | owner |
|---|---|---|---|---|
| R1 | **Edit chrome leaks into Preview.** Selection rim, the `div · 1440 × 900` name tag, the `1440 × 900` size tag, the tab-order badges `1.1 / 1.2 / 1.3`, the rotate handle and the edit-style resize handles on a sticky all draw in Preview. | Preview draws only the design, the annotation layer and pins (CONTRACT §2, md-model table "Inspector: ⌘-click → Inspect"). | All of the above stay visible. | `editing/index.tsx:261` (`<EditingSelection/>`), `:279` (`SizeGhost`), `:320` (`<KeyboardBadges/>`). All are ungated, while `editChrome` (`:134`) gates only PasteBar, StickyName and Minimap. |
| R2 | **Canvas-side HUD uses the legacy `--maude-hud-*` / `--maude-chrome-*` vocabulary and a mono font**, not maude-v2 tokens. This is the canvas iframe, so it is separate from C0. | `.md-linkchip`: radius-pill, 26px, `--accent`, type-xs semibold, link icon 13. `.k-cpin-dot`: 28px avatar teardrop in the presence tone, font-rounded. `.k-ab-ai`: 1.5px dashed `--spark`. Toolbar: `.dock`, radius-xl, font-body. | Link chip radius 3px, mono 11/16, no icon. Pins: 24px numbered square in `--maude-hud-accent`, mono 11. AI rim: 2.5px solid `hsl(210 90% 58%)` plus a mono badge. Toolbar: mono 12px, radius 14px, 4px padding. | `link-chip-overlay.tsx:55-67`, `comments-overlay.css:30-42`, `inspect.ts:558-561`, `toolbars/toolbar-css.ts:16-35,49-56` |
| R3 | **The annotation toolbar is not "a size bigger", and its icons are monochrome.** | Edit dock 421×56 (icon-btn 32, icons 18). Annotate dock 493×64, with `.k-ad-b` buttons 48×48 radius-lg and 22px icons. Sticky = yellow note chip, Stickers = yellow face, Marker = pen with a red ink tip. | Both toolbars use 32px buttons (Edit ≈ 311px wide, Preview ≈ 311px). The sticky, stamp and marker glyphs are outline-only `currentColor`. | `toolbars/toolbar-css.ts:49-56` (one button size for both modes), `canvas-icons.tsx` (imported `tool-palette.tsx:61`) |
| R4 | **Panels don't stay folded in Preview after a canvas change.** | Preview folds the Canvases and AI panels to corner icons (`mode-shows.ts:67-69` "folded"). | Folded on entry (md-annotate, md-preview). The left Canvases panel is back open after a link follow, a canvas open, the Comment tool, a sticky, a ⌘-click or the AI prompt. | `client/v2/shell/use-canvas-mode-lane.js:52`: `wantsFold` needs `snap.nonce > 0`, so a remount on canvas switch re-shows the panels. |
| R5 | **The Present pills don't use the `.island` material.** | `.md-pctl` / `.md-cpill` are `.island`: radius-lg, `--island-bg` with blur, `--island-shadow` plus the 0.5px edge, height 44. `.kbd` is font-body on bg-2 with an inset border. | radius-pill, flat `--bg-1`, `1px solid --border-default`, `box-shadow 0 4px 16px rgb(0 0 0/.18)`. The esc kbd is `--font-mono`. | `client/v2/present/present.css:29-32` (controls), `styles/3-shell-maude.css:8381-8383` (`.st-present-exit`, inherited by `.pr-pill`), `:8403-8408` (kbd mono) |
| R6 | **Preview ⌘-click doesn't open Inspect.** | Right-hand Inspect island (Size and spacing · Colour and type · Export PNG 1× / 2× / SVG / Handoff… · Copy code + Edit ↵ · Advanced CSS). | Only the selection tag. The panel stays closed. | `client/v2/inspect/inspect-host.jsx:34` → `inspect-model.js:131` needs `el.inspected`, which `inspect-canvas.ts:33` only sets when `inspectsSelection(mode, tool)` holds. The ⌘-click path never reaches it. |
| R7 | **Edit's Inspector is the full panel, not the board's compact property card**, and it prints raw values. | `Inspector` card (title + kind chip "Button"; Size W/H, Fill "Page 100%", Border "Ink 1.5", **On click: Go to Pricing** (focus ring), On hover, `› Advanced 3 properties`), floating island that hugs its height. | Full-height docked "Inspector" with breadcrumb, Position, Rotation, Size Fixed, Layout, Fill `rgb(255, 255, 255)`, Corners, Border `rgb(20, 24, 31)`, Effects. No On click row in the first screen. | `client/v2/inspector/` (fill and border sections print computed rgb). On click lives in `sections/interaction.jsx`, below the fold. |
| R8 | **The AI corner spark is monochrome.** | `PanelIcon icon="spark"`: the 4-point star in `--spark`. | `StIcon sparkle` with `fill="currentColor"` (fg-0 / white-on-dark). | `client/v2/shell/corner-icons.jsx:128`, `shell/icons.jsx:98-104` |

## Per artboard

**md-model** (L, D)
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Edit toolbar scale | dock 421×56, icon-btn 32, gap space-1, padding space-2, radius-xl | ≈311 wide, padding 4, gap 2, radius 14, mono | R3 · `toolbar-css.ts:16-56` | blocker |
| L+D | Shape tool glyph | overlapping square + circle (`Icon shape`) | plain square | `canvas-icons.tsx` | warning |
| L+D | Mode switch: track bg-3, 30×28 segments, Present 40px with chevron, pressed = bg-2 + shadow-sm + 1px accent ring; glyphs = board `MODE_PATHS` at 2.25 stroke | — | matches (`share-cluster.css:225-262`, `mode-switch.jsx:27-69`) | — | ✓ |
| L+D | Extra "Comments" speech-bubble button in the Share cluster, left of the switch | cluster = faces · status · switch · panel-right · Share | adds a `share-cluster-comments` icon-btn | `client/v2/shell/share-cluster.jsx:147-160` | warning |
| L+D | Right corner "sliders" icon shows with nothing selected | no right-corner icon in Edit without a selection | `panel-icon-right` sliders | `corner-icons.jsx:101-117` | warning |
| L+D | width tag "↔ 1440px" at the artboard's top-right corner | none | drawn | `artboard-growth-tag.tsx` | warning |

**md-keys** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | hovering a mode glyph shows no word or key | words + keys (`Kbd`), kit tooltip `.k-tip` with a `.kbd` | native `title` only (not drawn, so it doesn't appear in the capture) | `mode-switch.jsx:223,257` | warning |
| L+D | View menu is the desktop menubar | — | n/a (browser lane) | — | (fixture) |

**md-edit** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | link chip material | pill, 26px, `--accent`, semibold xs, link icon 13, dashed link line from the selection | 3px radius, mono 11, no icon, uppercase-tracked look | R2 · `link-chip-overlay.tsx:55-67` | blocker |
| L+D | selection name/size tag "See pricing → · 126 × 46" above the selection | not drawn (handles only) | mono HUD tag | `editing/selection.tsx` | warning |
| L+D | rotate handle under the selection | none | ↻ handle | `editing/` (rotation affordance) | warning |
| L+D | Inspector card vs full panel; raw rgb; On click missing from view | compact card | full panel | R7 | blocker |
| L+D | ⌥ gap measure "112" | drawn | not driven | — | (not driven) |

**md-edit-image** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Assets grid | 2 columns, radius-md thumbs, filename (xs, fg-1) under each, selected thumb with an accent ring + accent label, count right-aligned "6" | 3 columns, no filenames, "Not used" filter chip, "+" buttons, search with ⌘K | `client/v2/assets/` grid | blocker |
| L+D | Image tool armed (accent-muted pressed) + photo placed + "Hero image · fills, cropped to fit" accent chip | drawn | not reached (no drop) | — | warning (state not driven) |
| L+D | thumbnail content | — | noise images | — | (fixture) |

**md-edit-component** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | picker anchor | above the toolbar's Component slot, beside the CTA row | top-right, beside the Inspector (≈1470,245), far from the slot | components picker host (`client/v2/ds/`) | blocker |
| L+D | variant control | `.seg` Primary / Secondary / Ghost, with the pressed one ringed | small text chips (Mark │ Wordmark │ Lockup) | same | blocker |
| L+D | picker width / rows | ≈252 wide, 28px rows, diamond icon, "N variants" xs fg-2 right, rule + "Open Design system" | ≈300 wide; same row anatomy | same | warning |
| L+D | Inspector open behind the picker on a Section | none | open | R7 | warning |
| L+D | group names (Brand / Components vs "Studio site system") | — | fixture DS | — | (fixture) |

**md-motion** (L, D): an animation storyboard (0 / 40 / 220 ms). It can't be compared from a still. The engine exists (`preview/preview-camera.tsx`, `v2/shell/fold-ghost.js`). Making it comparable needs a frame-timed capture lane, not product work. Severity: warning (unverified).

**md-annotate** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | annotate toolbar size + coloured glyphs | 493×64, 48px buttons, 22px icons, yellow sticky, red marker tip, yellow sticker face, a divider after Hand | 32px monochrome, ≈311 wide | R3 | blocker |
| L+D | section glyph | dashed-corner frame | folder-like glyph | `canvas-icons.tsx` | warning |
| L+D | selection rim + `div · 1440 × 900` + `1440 × 900` + badges 1.1–1.3 on the page | none | drawn | R1 | blocker |
| L+D | Preview bar: island 40px, mode glyph 16, "Previewing **Homepage**", divider, `.kbd esc` "to edit" | — | matches (`preview/preview-bar.jsx`) | — | ✓ |
| L+D | AI corner spark | `--spark` | monochrome | R8 | blocker |

**md-preview** (L, D): same frame as md-annotate. R1, R3 and R8 apply (blockers). The camera (65 % on Tablet vs 76 % on Desktop) is C6 **(fixture)**. The board's stickies, ink and pins are content **(fixture)**.

**md-preview-follow** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Canvases panel open after the link follow | folded | open | R4 | blocker |
| L+D | back chip `btn--ghost btn--sm` "‹ Homepage" + "Previewing **Pricing**" | — | matches | — | ✓ |
| L+D | landing zoom (fit vs 56 %) | — | — | — | (fixture/C6) |

**md-preview-combine** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | camera from an overview: the board stays on the whole canvas (14 %); impl dives to the nearest artboard (A4, 65 %) | stays where Edit was | eases onto the nearest artboard even from overview zoom | `preview/preview-camera.tsx:100-112` | warning |
| L+D | AI corner spark, annotate toolbar | | | R3, R8 | blocker |
| L+D | "Playing" badge on a video, sticky | — | no video artboard | — | (fixture) |

**md-present-menu** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | menu width | 352 | 300 | `client/v2/shell/share-cluster.css:302` | warning |
| L+D | first row highlighted (`.k-mi[data-hl]` accent-muted) | highlighted | no highlight | `mode-switch.jsx:322-339` | warning |
| L+D | group headers xs semibold fg-2, keys xs fg-2 right, notes xs | — | matches (`share-cluster.css:305-318`) | — | ✓ |
| L+D | menu material (bg-2, shadow-lg + edge) | radius-lg | `--island-radius` 14 | `project-pill.css:102-115` | (C0) |
| L+D | Presenter view row | desktop only | absent | — | (fixture/browser lane) |
| L+D | menu opened while Preview, a sticky and a toast were still up (left over from the run order) | — | — | — | (harness) |

**md-present-lift** (L, D): the shot at 0.45 s is past the 280 ms lift, so the lift itself is unverified (warning, same capture-lane need as md-motion). The end-state controls pill is R5 (blocker).

**md-present-full** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | controls pill material + mono esc kbd | `.island` radius-lg | radius-pill, bg-1, 1px border | R5 | blocker |
| L+D | a web artboard fills the width edge to edge | md-edge-mixed "Web · fills the width" | does | — | ✓ |
| L+D | dark stage, 1px frame and pointer dot for a Post (the spec's 3 of 14) | drawn | Homepage presented, not a Post | — | (fixture) |
| L+D | grey band below the impl | — | pair padding (900 vs 982 tall) | — | (not a finding) |

**md-present-video** (L, D): unreachable here. It needs a footage-backed 9:16 artboard in the fixture. The product exists (`client/v2/present/video-present.jsx`). **(fixture)**

**md-present-canvas** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | pill material + mono kbd | `.island md-pctl md-cpill` radius-lg, island-bg blur | `.st-present-exit` radius-pill, bg-1, border | R5 | blocker |
| L+D | pill anatomy (present glyph fg-2 · "Presenting the canvas" · divider · zoom xs tabular · divider · esc "to leave") | — | matches (`canvas-pill.jsx:20-50`) | — | ✓ |
| L+D | zoom value, tiles | — | — | — | (fixture) |

**md-presenter**, **md-edge-offline** (L, D): unverified. They need the desktop shell with a second display or offline mode (`presenter-view.jsx` exists). Work: a desktop e2e scenario. Warning ×2.
**md-present-link**, **md-edge-viewer**, **md-comment-only** (L, D): unverified. They need a hub-backed cloud project and a second role (`follow-view.jsx`, `role-gate.js` exist). Work: a hub fixture in the fidelity harness. Warning ×3.

**md-comment** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | comment pin | 28px avatar teardrop, presence tone, initial in font-rounded, `shadow-md + 2px bg-2` ring | 24px numbered square, `--maude-hud-accent`, mono 11 | R2 · `comments-overlay.css:30-42` | blocker |
| L+D | composer / thread popover | island card: header "Pricing · Desktop" xs fg-2 + "✓ Resolve", then messages (avatar 20, name semibold, time fg-2), then a reply input (bg-3, accent focus ring) with a round accent send "›" | header "Tablet" + ×, textarea with a 1px accent border, square accent send with ↑ | `canvas-comment-mount.tsx` / `comments-overlay.css` | blocker |
| L+D | selection tag + rim on the heading in Preview | none | `Calm software, made · 556 × 40` | R1 | blocker |
| L+D | Canvases panel open (spec: the Comments panel docked left with Open / Mine / Resolved seg) | Comments panel | Canvases list | R4; panel = `client/v2/comments/comments-panel.jsx` (not opened) | blocker |
| L+D | other people's threads, @mention popup | — | single user | — | (fixture) |
| L+D | Comment tool pressed: board = accent-muted 48px | | 32px | R3 | blocker |

**md-draw** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | sticky armed shows the 5-colour swatch strip above the toolbar (selected = ring) | drawn | the tool falls back to Hand after the commit, so no strip; the colour row sits in a context bar on the sticky instead | `tool-palette.tsx:491-494` | warning |
| L+D | edit-style blue resize handles + "On Tablet · moves with it" tag on the sticky | none | drawn | R1 | blocker |
| L+D | hint toast "⌘Enter commits and creates the next one beside it." bottom-left | none | dark island toast | annotations hint (`annotations-layer.tsx`) | warning |
| L+D | Canvases panel open | folded | open | R4 | blocker |
| L+D | section, arrows, AI panel reading the layer | — | one sticky only | — | (not driven) |

**md-inspect** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Inspect panel missing | drawn | absent | R6 | blocker |
| L+D | measure: one accent chip "150 × 48" under the element (+ ⌥ gaps 48 / 64 / 20) | one chip | two HUD tags ("Book a call · 97 × 35" above, "97 × 35" below), mono | R2 · `editing/selection.tsx` | warning |
| L+D | Canvases panel open | folded | open | R4 | blocker |

**md-edge-ai** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | the AI-at-work rim on the artboard you're previewing | 1.5px **dashed `--spark`** at inset −5, `radius-sm` | 2.5px **solid `hsl(210 90% 58%)`** + glow + scan wave | R2 · `inspect.ts:558-560,571-572` | blocker |
| L+D | AI tag | `k-cur-tag` in spark: "✦ AI's new hero — shown live" (corner, above) plus a small "✦ AI" tag on Tablet | mono 11 blue badge **"editing — Combine-kampan.tsx"** (a file name) inside the rim | `artboard-activity-overlay.tsx:68`, `inspect.ts:561` | blocker |
| L+D | Canvases panel open | folded | open | R4 | blocker |
| L+D | Canvases row "AI is working" (light) | — | present | — | ✓ |

**md-edge-mixed** (L, D): the run was Present the canvas on Combine-kampan, not Present · Artboards, so the six per-kind treatments weren't driven. The pill shown is R5 (blocker). Work needed: a Present · Artboards walk over a Combine-kampan fixture with web / post / reel / print / banner / 16:9 artboards. Warning (unverified).

**md-esc** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | after esc: Edit is pressed, **and** Preview keeps a 2px accent focus-visible outline, so two segments read as on | one pressed segment | two highlighted | `share-cluster.css:290-295` + no focus hand-back on esc (`use-canvas-mode-lane.js`) | warning |
| L+D | panels come back, Edit toolbar returns | — | matches | — | ✓ |
| L+D | the other ten rows of the table | — | — | — | (not driven) |

## Verdict

R1–R5 are the blockers. R1 (Edit chrome in Preview) and R4 (panels unfold) touch most of the Preview artboards. R2 is a second token-vocabulary gap that sits in the **canvas iframe**, so the C0 shell fix will not reach it. R3 means the board's FigJam-sized annotation toolbar doesn't exist yet in any mode.

```json
{"canvas":"04 Modes","critic":"design-critic","blockers":30,"warnings":26,"verified_ids":[]}
```

No artboard × theme came out fully clean in this lens. These parts were verified clean (sub-components): the mode switch track and segments (md-model L/D), the Preview bar (md-annotate / md-preview L/D), the Preview back chip (md-preview-follow L/D), the Present menu typography (md-present-menu L/D), the canvas-pill anatomy (md-present-canvas L/D), web-kind full width (md-present-full L/D), and esc back to Edit (md-esc L/D).
