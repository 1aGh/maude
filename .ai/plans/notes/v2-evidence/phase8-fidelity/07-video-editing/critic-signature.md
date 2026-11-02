# signature-moment-critic — 07 Video Editing (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/07 Video Editing.tsx` (+ `_video.css`) · impl = release v2 client (stage-A frames) · opt_out_scope: palette · READ-ONLY_

## TL;DR

**Aspiration (impl vs board): 2.2/5** · Specificity: **fail** (app-made code names) · Verdict: **divergent**

The island is in place: it slides in, has the notch, Kept open, Expand, and the Advanced foot. Inside it, though, is the v1 TimelinePanel body, moved over unchanged (S7.7 says so: "body unchanged"). None of the board's craft was ported into it: icon-tile track labels, filmstrip beats, the poster flag, round join dots, the lifted and tilted clip, the beat-marked waveform, the small top-centre toast. Two things fail outright. The transition picker is portaled out of `.maude`, so it paints in the v1 paper palette with mono type. The always-on "+" seams turn the storyline into a fence.

Dark: none of 07 is drawn dark (INDEX). Dark impl was checked against the app's dark tokens. Every light finding repeats in dark. The only dark-specific one: the transition picker goes brown and mono (the v1 `:root` dark paper), the same root cause as R1.

## Per artboard (light = dark unless noted; a "both" row counts once per theme in the totals)

### ve-none
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The scrub bar shows at rest because poster seek makes `frame > 0` count as "started" | only a 40 px ringed play glyph — "nothing hints that one is missing" | filled disc play + full scrub bar "0:10 / 0:28" | `apps/studio/video-play-chrome.tsx:112` (`started = playing \|\| frame > 0`) | blocker |
| both | Length is missing from the label | "Hype trailer · Reels · 0:15" | "Trailer" + camera badge | canvas-lib label (`canvas-lib.tsx:2965`) — no length segment for video kinds | warning |
| both | Content: three artboards vs one 1280×720 | — | — | (fixture) | — |

### ve-select
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Track labels are text, not icon tiles | `.ve-lab-ic` 20 px tiles, lilac/yellow/green (`_video.css:69-73`) | "Text / Graphics / Video" text + mono "V1 STORYLINE" | `client/v2/timeline/Timeline.jsx` (v1 body) | blocker |
| both | No poster flag when the poster is the default (35 %) | "⊡ Poster" flag on the ruler at 0:04 (`.ve-poster-flag`) | none | `Timeline.jsx:2153` (flag only when `island.poster` is stored) | blocker |
| both | The "+" add-transition seams show at rest on every cut (~30) | join dots appear on hover/select | always visible at 0.8 opacity | `styles/3-shell-maude.css:10384` — an unlayered `.tl-seam{opacity:.8}` beats the layered `.tl-seam-add{opacity:0}` (:5745) | blocker |
| both | The header carries 13 controls | play · loop · time · name · 4 tools · Expand | + skip-back, sound, volume slider, "30 fps · 867f" + zoom slider, close | `Timeline.jsx:2042-2048` | warning |
| both | Mono, decimal playhead time | `.ve-head-tag` semibold tabular "0:04" | mono 9 px "0.00s" | `Timeline.jsx:198`, `3-shell-maude.css:10360` | warning |
| both | The island sits over the video instead of under its edge | timeline below the artboard, dashed notch arrow | fixed `bottom:80px`, overlaps the lower third | `client/v2/timeline/timeline.css:18`, `anchor.js:32` | warning (big artboard = partly fixture) |
| both | Beats have no thumbnails | filmstrip per clip | blue slabs | `Timeline.jsx:1495-1520` — strips only for footage `mediaSrc`; comp beats get none | warning (fixture: no footage; ak-video proves strips paint when footage exists) |
| both | Docked full-height inspector, no poster thumbnail, native selects | floating card: Size/Length/Poster thumb/Sound/Export | Fill, Layout, Formats, Safe zones, Export presets… | `client/inspector-controls.jsx:507` (native `<select>`), `v2/inspector/kinds/artboard-video.jsx` | warning |

### ve-deselect
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Only the Kept-open end state can be reached. The diagram, rules card and slide-over arc are board explanation | — | "Kept open" pin chip present | `v2/timeline/island-controls.jsx:53` | — (verified: Kept open) |
| both | The View › Advanced › Keep timeline open menu was not driven | ✓ row with ⇧⌘T | — | not reached | warning |

### ve-drop
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No insert line, no tooltip, no stacked-clip ghost with a count | "Drop 3 clips at 0:09 · the video grows by 0:20" + badge 3 | nothing on the timeline (synthetic drag) | `v2/timeline/edit/drop.jsx`, `Timeline.jsx:1349` (`DropLanding`) | warning (synthetic drag may not arm the caret) |
| both | The canvas drop chip sits in the centre, with no dashed artboard outline and no "+" | bottom pill "+ Or drop here — adds at the end", dashed outline | centred pill | canvas `timeline-drop-hint` block (S7.9) | warning |
| both | Rows labelled with code names and a ƒ glyph | names | "Absol…", "beat-…", ƒ | `Timeline.jsx:114-121` (`rowKindGlyph` text glyphs incl. ✨) | blocker |

### ve-trim-split
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The toast is a large card with an X and an accent bar at the bottom centre, over the timeline | small pill at the top centre "Split Oslava at 0:10. Undo" | bottom card | `client/v2/shell/util.js:155` (`shellToast` stack, app.jsx:2989) | blocker |
| both | No trim tip, no blue trim handles with grip, no duration chip | "Touchdown · 2.4 s −0.6 s · video 0:14", `.ve-trim` | none | `v2/timeline/edit/trim.jsx` | warning (not dragged) |
| both | The split half lands on its own row | one video track | second row "beat-…" | `Timeline.jsx` per-sequence rows (fixture non-storyline) | warning |

### ve-move-transition
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No lift (−1.5° tilt, lg shadow), no landing line, no "Drop before Touchdown" | `.ve-clip--lift`, `.ve-insert` | none; old toast lingers | `v2/timeline/edit/move.jsx` (landing only for storyline `reorderDrag`) | blocker |
| both | Formats row shows an empty name | "Reels 9:16 · this one" | "🔗 (blank) this one" | `v2/inspector/sections/formats.jsx:58` (`{f.name}` empty for Custom size) | warning |

### ve-transition
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | The picker paints in v1 paper tokens: beige surface, mono type, no tile pictures, a big 2-shot slab, orange range | 288 px popover, 6 thumbnail tiles (Fade selected, accent-muted), 0.5 s slider | unstyled-looking | `Timeline.jsx:2824-2843` — `createPortal(…, document.body)` escapes `.maude` (`app.jsx:2984`). Tokens fall to `styles/1-tokens.css:33-37` (paper `--bg-2: oklch(93% .012 78)`) | blocker |
| dark | Same, in brown v1 dark paper | — | — | same | blocker |
| both | The join glyph is a text "⧓", not a 22 px round dot | `.ve-join` | text | `Timeline.jsx:1735` | warning |

### ve-text
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | "+ Title" inserts a default serif "Title" named AbsoluteFill, with no selection and no Title inspector | brand display title on an ink chip, "Title · Slide up" tag, motion tiles | serif "Title", toast "Title added.", Text row "Absol…" | `client/app.jsx:2459-2479` (v1 insert, `mediaTag:'Title'`, no select/inspect) | blocker |

### ve-captions
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No transcript card, caption chips or caption inspector | struck "Ehm…", word chips, Captions inspector | Missing tile | (fixture — footage absent; `v2/transcript/TranscriptPanel.jsx`, `v2/inspector/kinds/caption.jsx` exist) | — |
| both | The Missing tile uses red hatch and a raw file hash | — | "aaaa1111.mp4", red stripe | `apps/studio/asset-placeholder.tsx:123` (`--dc-absent-error-soft`) | warning |
| both | Mute chip is an emoji | `.ve-clip-mute` glyph | 🔇 | `Timeline.jsx:1491` | warning |

### ve-music
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The Sound row says "None yet" while the timeline plays song.mp3 | "Hype instrumental" swatch | "None yet" | `v2/inspector/kinds/video-facts.js:52-67` (reads `/_api/comp-clips`, disagrees with the music lane) | warning |
| both | Sine wave instead of a bar waveform. No duck line, no tall/short beat marks, mono label | `.ve-wave`, `.ve-beat--strong`, `.ve-duck` | teal sine, "120 B…" clipped | `v2/timeline/lanes/music-lane.jsx` (peaks fallback) | warning (fixture audio may be absent) |
| both | Clicking the bed did not select it, so no Music inspector | Volume / Lower under speech / Snap / Fade / Song | artboard inspector | `v2/inspector/kinds/music.jsx` (not reached) | warning |

### ve-formats
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Siblings, link glyphs and "Shared by 3 formats" missing | — | one format | (fixture) | — |
| both | The label chip collides with the kind badge on a narrow artboard | — | "180 ⊡20" overlap | `canvas-lib.tsx:577-614` (positioned label + kind chip) | warning |
| both | The island covers the 9:16 artboard's lower half | timeline under it | overlap | `timeline.css:18` | blocker |

### ve-reframe
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Re-frame window not reached | "Frame 'Touchdown' for" window, follow switch | none | `v2/timeline/reframe-island.jsx` exists; needs a clip with present footage + Framing click. **Product/lane work:** footage fixture | warning |

### ve-play
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No loop band with I/O handles, no "+ 2 frames", no Sound-on meter, no Pause/Step key tips | `.ve-loop`, `.ve-tip` | none | `Timeline.jsx` header/ruler | blocker |
| both | The two transports disagree on length | — | artboard 0:07 vs timeline 0:06 | `video-play-chrome.tsx` vs `Timeline.jsx` total | warning |
| both | Stale toast still on screen | — | "Split beat-two…" | `shell/util.js:155` (no auto-dismiss in lane) | warning |

### ve-fullscreen
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Video doesn't paint | — | black | (lane: Remotion doesn't paint) | — |
| both | Volume is a full native range, not one icon | sound icon only | accent range slider | `v2/present/video-present.jsx:219` | warning |
| both | The bar sits on the bottom edge, not floating under the video. No loop ticks | ticks on the scrub, bar ~80 px up | `bottom: var(--space-5)` | `v2/present/video-present.css:68` | warning |
| both | No format switch | Reels / 16:9 / 1:1 | none | (fixture: one format) | — |

### ve-export
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Format tiles carry no thumbnail | thumb + name + px | text chip | `v2/export/sections/video.jsx` | warning |
| both | An empty time strip with a playhead fills the middle | filmstrip with clip pictures | blank lane, "0:00" tag | `v2/export/sections/video.jsx:41-80` (`Film` draws bare blocks; none painted) | blocker |
| both | Segments don't use the board's selected style | `.k-seg-b[aria-pressed]` inset 1 px accent ring (`_kit.css:229`) | raised white pill + shadow | `v2/export/export.css:101` | warning |
| both | Toast stays above the modal scrim | — | toast over dim | `shell/util.js:155` z-order | warning |
| both | No cloud-vs-Mac cards | — | — | (fixture: local project) | — |

### ve-footage
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The missing clip in the timeline isn't hatched | `.ve-clip--off` grey hatch, inset border | flat light-blue block "rozhovor · missing" | `v2/timeline/timeline.css:304-314` (dashed + warn border only; storyline block shows neither) | warning |
| both | Waiting / preparing states not reachable | "Waiting for Jonas's Mac", progress bars | — | **product work:** a second peer + sync-pending footage; `footage-state.js` exists | warning |

### ve-long
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Full mode has no grip, no zoom slider + Fit, no marker flags, no fold rows "Text · 18", no hover tip | `.ve-tl--full`, `.ve-marker`, `.ve-fold-bar` | Compact button only; the island stops at the inspector edge | `Timeline.jsx` header; `timeline/markers.js`, `fold.js` exist but are not drawn | blocker |

### ve-advanced
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The Advanced strip overflows the island and the window; the tracks vanish | floating cards beside the artboard + expanded timeline | rows spill below, "Long videos" note off-window | `v2/timeline/advanced/foot.jsx`, `advanced.css` | blocker |
| both | No easing graph (empty "Pick a keyframe") | cubic-bezier curve card | text | `advanced/easing-curve.jsx` | warning |

### Spec-only (impl state does not exist in the lane)
| id | product work to make it reachable |
|---|---|
| ve-ai-cut | Board explainer (12 clips → cut, with lines). There is no single app state; covered by ai-watch/scrub/proposal |
| ve-ai-watch, ve-ai-scrub, ve-ai-proposal | A signed-in Claude run of "make a 30 s recap", with the spark AI edge (`timeline/ai-edge.jsx` exists) and the chat recap. Needs an AI-run fixture/stub that emits the edit-op stream |
| ve-ai-adjust | A finished AI cut with multiple takes per clip (`other-takes.jsx` exists) |
| ve-render | Running/finished export jobs (Exports panel rows, ring on the cluster icon). Needs a render-service stub in the lane |
| ve-together | A second peer on a linked hub editing captions (`timeline/peers.jsx` exists) |
| ve-fit-fill | A real vertical-clip file drop (`timeline/fit-fill.jsx` exists) — needs a native/file drag |

## Root causes that hit several artboards

1. **R1 — Portals escape `.maude`, so v1 paper tokens apply.** `createPortal(…, document.body)` in `Timeline.jsx`, `other-takes.jsx`, `reframe-island.jsx`, `edit/drop.jsx` and `ds/kinds/token.jsx`. The v2 tokens are scoped to `.maude[data-theme]` (`1-tokens-maude-v2-shell.css:7`), and `:root` is the v1 paper palette. Result: transition picker (light and dark), and likely other-takes and reframe once reached.
2. **R2 — The v1 Timeline body moved over unchanged (S7.7).** None of the `_video.css` vocabulary (`.ve-lab-ic`, `.ve-clip-lab`, `.ve-join`, `.ve-poster-flag`, `.ve-head-tag`, `.ve-clip--lift`, `.ve-wave`/`.ve-beat`) was ported. Text glyphs (ƒ ✨ ▶ ⧓ 🔇) stand in for icons. Hits select, drop, trim, move, transition, music, long, play.
3. **R3 — Unlayered v1 rules beat `@layer shell`.** `3-shell-maude.css:10360-10386` (after the layer closes at :10099) forces seams visible and the mono 9 px playhead tag.
4. **R4 — Native `<select>` and the docked full inspector.** `inspector-controls.jsx:507` has no `appearance:none` (`3-shell-maude.css:4391`). Every video selection shows Fill/Layout/Safe zones/Export presets, while the board shows five rows.
5. **R5 — Toasts are a bottom card stack, not the top-centre pill.** They overlap the timeline and the export scrim (`shell/util.js:155`).

## What's working (preserve)

- The island itself: slide in/out, notch, Kept open, Expand/Compact, Advanced foot, fps/frames readout under Advanced.
- Filmstrips paint where footage exists (ak-video). The gap is comp beats only.
- Fullscreen chrome copy ("esc Back to the canvas") and the Present-owned transport.

## Verdict

```json
{
  "canvas": "07 Video Editing",
  "critic": "signature-moment-critic",
  "agent": "signature-moment-critic",
  "iter": 1,
  "blockers": 28,
  "warnings": 60,
  "aspiration_score": 2.2,
  "axes": {
    "signature_moment": { "score": 2, "weight": 1.5 },
    "brand_prominence": { "score": 3, "weight": 1.0 },
    "mock_fidelity": { "score": 2, "weight": 1.0 },
    "restraint": { "score": 2, "weight": 1.5 },
    "negative_space": { "score": 2, "weight": 1.0 }
  },
  "specificity": "fail",
  "specificity_findings": [
    "Title the app inserts is named 'AbsoluteFill' / row 'Absol…' (client/app.jsx:2459)",
    "rows show component ids 'beat-one', 'beat-…' with a ƒ glyph (Timeline.jsx:114-121)",
    "mono 'V1 STORYLINE' lane tag",
    "Missing tile shows the raw hash 'aaaa1111.mp4' (asset-placeholder.tsx)"
  ],
  "top_blockers": [
    { "category": "aspiration-specificity", "line": null, "summary": "app-made code names on user-facing rows", "fix": "Name inserted titles by their text and beats by their clip/label; never the component id." },
    { "category": "aspiration-signature_moment", "line": null, "summary": "signature_moment 2/5 — the timeline is the v1 body", "fix": "Port the _video.css track/clip/join/poster/head vocabulary into Timeline.jsx." },
    { "category": "aspiration-restraint", "line": null, "summary": "restraint 2/5 — ~30 always-on '+' seams, 13 header controls, dual transports", "fix": "Layer or remove the unlayered .tl-seam rule; move fps/zoom into Advanced; hide the scrub until playing." },
    { "category": "aspiration-mock_fidelity", "line": null, "summary": "mock_fidelity 2/5 — transition picker painted in v1 paper tokens", "fix": "Portal into the .maude root (or re-declare tokens on the portal host)." },
    { "category": "aspiration-negative_space", "line": null, "summary": "negative_space 2/5 — island over the video, Advanced overflows the window", "fix": "Anchor under the artboard edge when there is room; scroll inside the Advanced fold." }
  ],
  "opt_out_applied": "palette",
  "passed": false,
  "verified_ids": []
}
```
