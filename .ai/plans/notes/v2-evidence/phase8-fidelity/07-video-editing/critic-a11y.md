# a11y-critic — 07 Video Editing (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/07 Video Editing.tsx` · impl frames `.claude/worktrees/agent-af625ef88bd36c798/.scr/impl/07/` · standard: WCAG 2.1 AA (no project a11y-rules skill, so the WCAG defaults apply) · opt_out_applied: n/a, a11y applies at every scope_

**How this was measured.** Contrast comes from the impl JPEG pixels. For each text box the background is the modal colour and the foreground is the 99.5th-percentile luminance outlier. Each measured ratio is cross-checked against the token maths (oklch → sRGB). JPEG smearing reads thin 10–11 px text about 0.3–0.5 low, so a measured value inside 0.5 of a threshold is a warning, not a blocker. Spec dark is the host re-theme, not a drawn state (INDEX), so dark impl is judged against the app's own tokens. Rows marked (fixture) are not findings.

**Severity counting.** Each root cause counts once for this canvas, plus each artboard-specific row, plus each unreachable state.

## Root causes (these hit several artboards)

| # | cause | spec | impl (measured) | owner | sev |
|---|---|---|---|---|---|
| R2 | Meta text (`--fg-2`) sits on an opaque `--accent-muted` "current" row. Seen in the Formats row "this one" (ve-select, ve-formats, ve-long, ve-advanced, ve-trim-split …) | `--fg-2` on `--accent-soft` (12 % azure) = 4.91 L / 5.11 D | 4.32 L (token 4.19) / **2.30 D** (token 2.34) | `client/v2/timeline/reframe.css:137-143`; ladder `client/styles/1-tokens-maude.css:45,158` | blocker |
| R4 | v2 surfaces render on the v1 `.maude` ladder (indigo 268, opaque `--accent-muted`), not maude-v2 (azure 238, 12 % soft). `1-tokens-maude-v2.css` only applies under `.maude-v2`, which is worn only by Home and the annotations. This is the source of R2/R3. | `colors_and_type.css` | `--accent` oklch(.52 .195 268) L / (.68 .18 268) D | `client/styles/1-tokens-maude-v2.css:3-6`, `client/v2/annotations/v2-scope.js:3` | (cause) |
| R3 | Timeline popovers are portalled to `document.body`, outside `.maude[data-theme]`, so they pick up the legacy amber `:root` tokens in BOTH themes: beige #eeeade (L), brown #1e160e (D). Mono face; the tiles lose their pictures. Affects the transition picker, clip menu, comment popover, fit-fill ask. | `--bg-2` island with 6 picture tiles | amber ladder; text still passes (Cut 7.72 L / 8.43 D) | `client/v2/timeline/Timeline.jsx:2700,2759,2825,2872,2878` | blocker |
| R5 | The storyline clip kind glyph uses theme-blind hex (`#7dd3fc` on a sky mix), built for dark. | thumbnails + ink labels | ▶ glyph on clip fill **1.29 L** (5.29 D) | `client/styles/3-shell-maude.css:6230-6241` | blocker (light) |
| R8 | The "+ add transition" seam buttons are `opacity:0` until the track is hovered, and there is no `:focus-visible`/`:focus-within` reveal. Tab lands on an invisible control (2.4.7). | not drawn | invisible on keyboard focus | `client/styles/3-shell-maude.css:5745-5762` (button `Timeline.jsx:1690-1708`) | blocker |
| R1 | In the export sheet, a selected segment differs from the others only by fill. | `.k-seg-b[aria-pressed=true]`: `--bg-2` + 1 px inset `--accent` ring (4.89 L / 3.13 D) | selected vs unselected fill **1.09 L / 1.20 D**, no ring | `client/v2/export/export.css:101-105` | blocker |

## Per artboard

| id | theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|---|
| ve-none | L/D | The bottom-left undo/redo/zoom % pill is not on screen. ⌘Z / ⌘0 still reach those actions. | pill drawn | absent (View › Advanced › Zoom controls is off by default) | `client/v2/shell/menu-runner.js:468` | warning |
| ve-select | L/D | R2 "this one" fails (D 2.30). R5 glyph fails (L 1.29). R8 is present. Everything else in chrome passes: ruler 5.69/5.90, tracks 7.04/6.20, inspector labels 5.13/5.25, playhead tag 5.15/5.96 (token 5.71). | — | — | see R2/R5/R8 | (root) |
| ve-deselect | L/D | Explainer artboard (four minis + rule card) is board-only, not a finding. The Kept-open state matches. The View › Advanced › Keep timeline open path was not driven. | — | R5 visible | — | (root) |
| ve-drop | L/D | No text says where the drop lands. The spec tooltip "Drop 3 clips at 0:09 — the video grows by 0:20" is missing; only the artboard pill shows. Pill text passes (6.38 D). | tooltip + caret | pill only | `client/v2/timeline/edit/drop.jsx` | warning |
| ve-trim-split | L/D | The toast "Split … Undo" is pinned bottom-centre over the track and covers the clip just split. Spec puts it top-centre. Sonner region is live, which is fine. | top-centre toast | covers the timeline | shell toaster (sonner) | warning |
| ve-move-transition | L/D | Move and trim are pointer-only on the block: trim/resize handles, keyframes and lane chip are `<span onPointerDown>` with no role. Keyboard routes exist through the clip menu (Earlier/Later, layer up/down) and the Length field, but none is surfaced. No drop indicator was captured. | drag + "Drop before Touchdown" | drag only | `Timeline.jsx:1540,1605,1618,2250`; `edit/clip-menu.js:26-29` | warning |
| ve-transition | L/D | **Keyboard-opened picker lands off-screen.** The seam's `onClick` positions it from `e.clientX/Y`, which is 0 for an Enter/Space click, so `bottom = innerHeight+14` puts the dialog above the viewport while focus moves into it. | anchored on the join | invisible dialog | `Timeline.jsx:1728-1731`; `joins/transition-picker.jsx:145-160` | blocker |
| ve-transition | L/D | The seam button's accessible name is the glyph "⧓". `title` is only a description. | "Oslava → Logo" join | name "⧓" | `Timeline.jsx:1720-1733` | blocker |
| ve-transition | L/D | R3 off-theme picker. The hint "Hover a tile to play it." measures 4.63 L / 4.53 D (near the threshold). The "logo" shot label is 3.69, but it sits in an aria-hidden preview. | `--fg-2` on `--bg-2` 5.78 | amber ladder | `joins/joins.css:7-28` via R3 | warning |
| ve-transition | L/D | `role=radiogroup` has no arrow keys, so each tile is its own Tab stop. Esc does not return focus to the seam (no `useModalFocus`). | — | — | `joins/transition-picker.jsx:112-122,172-199` | warning |
| ve-text | L/D | The new title clip's name is the raw component, "Absol…". Its aria-label reads "AbsoluteFill, from frame …". The title inspector (Motion grid) did not open, so that part is not verified. | "PROČ ALLIGATORS" | "AbsoluteFill" | `Timeline.jsx:1438-1442` (`seq.label`) | warning |
| ve-captions | L/D | Footage missing → no transcript card / caption chips (fixture). Code: transcript words are `<span onMouseDown>` with no role, and selection depends on section-level keys. | — | — | `client/v2/transcript/TranscriptPanel.jsx:91` | warning |
| ve-music | L/D | The bed row is `<div role="button" tabIndex=0>`, which is fragile. Clicking it did not select it, so the Music inspector (Volume, Lower under speech, Snap) is not verified. | Music inspector | stayed on artboard | `Timeline.jsx:1760-1775` | warning |
| ve-formats | L/D | Single format (fixture). R2 "this one" is present. | — | — | R2 | (root) |
| ve-reframe | L/D | No re-frame window because the footage is missing (fixture). Missing tile: red 7.06 L / 6.46 D, Relink 4.58 L (near) / 5.69 D. | — | — | `client/v2/timeline/footage-rows.jsx` | warning |
| ve-play | L/D | No on-screen key hints ("Step ← → one frame ⇧ one second", "Pause — tap Space") and no loop band. The keys exist; the screen never says so. A stale toast covers the track. | hints + loop band | none | `client/actions/defs/timeline.ts:46-122` | warning |
| ve-fullscreen | L/D | The scrub range is 0–1000 with no `aria-valuetext`, so a screen reader hears "500" instead of "0:10 of 0:15". Play carries a changing label AND `aria-pressed`, so it reads "Pause, pressed". Pill contrast 14.4 L / 13.4 D. No format switcher (fixture: one format). | time pill | numeric | `client/v2/present/video-present.jsx:156-206` | warning |
| ve-export | L/D | R1 on MP4/GIF, 1080p/4K, Captions. The "Split…" toast stays live above the aria-modal scrim. `--dur-fast` is undefined, so 120 ms transitions are not collapsed under reduced motion. Labels pass (4.83–6.6). | — | — | `export.css:96`, `exports-panel.css:143` | warning |
| ve-footage | L/D | Only the Missing + Relink state; no owner line or preparing bars. Product work: a peer device that owns the file. | "Waiting for Jonas's Mac" | — | `timeline/footage-state.js` | warning |
| ve-long | L/D | No fold counts ("Text · 18"). The zoom range is labelled ("Timeline zoom", pass). R5 is visible across 24 clips. | — | — | `Timeline.jsx:2053` | (root) |
| ve-advanced | L/D | **The Advanced strip overflows its island.** The "This video" rows (bitrate, colour) and the "Long videos" note render outside the timeline, under the toolbar and past the window bottom. That text is cut off and nothing makes it reachable. Key cells measure 4.27 D / 4.36 L (token 4.84 / 5.04, pass). | cards beside the artboard | spill | `client/v2/timeline/advanced/advanced.css:30-37` | blocker |

## Unreachable (spec-only). The state does not exist in this lane.

| id | what makes it reachable | sev |
|---|---|---|
| ve-ai-cut · ve-ai-watch · ve-ai-scrub · ve-ai-proposal · ve-ai-adjust | A signed-in Claude run of the AI cut (the e2e lane stubs claude). Board-level note for that work: the "AI is watching footage" / "Placing shot 8" pill is drawn with white on `--spark` (3.13 measured; token 3.39 L / 2.88 D). The DS asks for `--spark-fg` dark ink (5.37 / 6.33). | blocker ×5 |
| ve-render | Running and finished export jobs (render service or this-Mac lane in the e2e harness) | blocker |
| ve-together | A second peer on a linked hub editing the same video | blocker |
| ve-fit-fill | A real vertical-file drop (`timeline/fit-fill.jsx` exists; only the drop is missing in the lane) | blocker |

## Verdict

```json
{"canvas":"07 Video Editing","critic":"a11y-critic","blockers":16,"warnings":15,"verified_ids":[],"opt_out_applied":"n/a — a11y enforces at every scope"}
```

No id × theme is clean. Every timeline frame shows R5/R8, every inspector frame shows R2, and ve-none is missing its zoom pill.
