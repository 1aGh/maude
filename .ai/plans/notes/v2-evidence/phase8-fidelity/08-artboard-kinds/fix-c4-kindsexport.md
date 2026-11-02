# 08 Artboard kinds + toast rule — round 4 (p8-c4-kindsexport): done / open

Branch `p8-c4-kindsexport` from feat/maude-v2 b21411687. Tests through `scripts/v2-test-lane.sh`; tsc clean; biome format on every touched file; release rebuild + `check-client-boots-source` OK + `opening-card-clears` PASS. Revert-check: SizePicker.jsx / print.jsx / batch.jsx put back to base -> the new tests went red (12+ fails), restored, `git diff` clean.

## Done

| what | tests (red -> green) |
|---|---|
| ONE toast rule (decision `v2-p8-c4-toast-dock-or-top`): dock (bottom-centre above the toolbar) is the default; `placement: 'top'` for states of the app; a notice with no placement goes TOP while the video timeline (`.tl-track`) is in the dock; the pill hugs its sentence (fit-content, up to 640 px, one line). Bug found: `use-tabs.jsx` dropped the pill options of shell events (tabs reopened / opened from link never reached `notify`) — placement + the link glyph now arrive; thread landing is a top link pill | `p8-c4-toast-rule.test.tsx` (3 red on the base), `s6-11b-thread-landing` pin |
| Artboard card: Fill is a ROW ("Fill", opacity shown), Layout one row; section heads hidden when every entry is headless (`frame.jsx`, `headless` on a slot entry); Padding / Gap under Advanced | `v2-inspector-artboard.test.tsx` |
| Safe zones: select-shaped trigger + floating checked menu (head, check column, rule, footnote); notes out of the card | `v2-inspector-safe-zones.test.tsx`, testids.json / TESTIDS.md |
| Paper reads "A6"; mm fields have no grip | `v2-inspector-print.test.tsx` |
| Size picker: laptop / picture / play-frame glyphs (canvas-icons.jsx `LaptopIcon`, `ImageIcon`, new `VideoIcon`), chevrons down, search rests (ring only with a query), Custom island beside the open picker | `size-picker.test.tsx` |
| Convert: after-state selects the new copy (`selectCopyPlan`, `select-by-id` x3), toast wears the copy glyph | `v2-convert-dialog.test.tsx` |
| Kind-dim: only a Layers pick dims the canvas (`getDimKind`; Canvases chip passes `'canvases'`) | `kind-filter.test.tsx` |
| On-canvas "Crosses the cut": `ArtboardWarnOutlines` (dashed warn outline + tag, guides class, edit chrome only), mounted in canvas-lib | `p8-c4-warn-outlines.test.tsx` |

## Not a bug

- "Convert dialog stuck on Checking…": the list resolves in ~3 s (a headless render of the post, `GET /_api/kinds/convert-plan`, server cap 25 s); the stage-D shot was taken at 1.8 s. The harness now waits. With the fixture the answer is "Nothing to check." (its post has no logo / layer over the edge) — the spec's three lines are fixture content.

## Open

- ak-picker: panel placement (anchored left over the Frame tool) and the 115/86 vs 128/91 tile rhythm; the Print grid is cut by the panel height (the body scrolls).
- ak-web-hug: row ORDER (board: Width, Height, Layout, Fill, Other widths; ours keeps Fill, Layout after the size block); "+ 373 px" tag / "new section" highlight need an insert-section drive.
- ak-safe-zones: band tag clipped at the camera, "Under the reply bar" flag over the headline; Reels right band / profile-grid crop.
- ak-print-letak: Print guides state (board: ON with dashed guides), the Colour note wraps, Export block is Presets / Copy / Export… (board: one "Print PDF" row) — export slot is 09/14's.
- ak-print-view: the Menu › View › Advanced › Print guides menu is not driven by the harness. ak-mixed-select (shift-click two artboard labels), ak-web-widths (Add a width menu), ak-advanced (open the fold) harness gaps remain.
- ak-video: the compact timeline head / track heads / poster flag are 07's.
- ak-mixed-fit / ak-mixed-filter: Layers still shows raw DOM children, rows have no thumbnails / 44 px, docked panel; "19 other artboards are dimmed. Show all" not driven.
- ak-warnings: the video-length and paper-size cases need two more fixtures; "Fix size" verb is still an unstyled link.

## Decisions

- `decision:maude/v2-p8-c4-toast-dock-or-top` — dock by default; top for states of the app (caller) or while the timeline is in the dock; pill fit-content, one line, quiet x kept (lead's `v2-p8-lead-toast-pill-keeps-dismiss`). Rejected: top for everything (hides the toolbar's tooltips and the inspector's top rows, and the boards draw edit outcomes with Undo in the dock); a per-callsite placement for the video toasts (the timeline probe covers every canvas notice).
- `decision:maude/v2-p8-c4-dim-is-layers-only` — the kind filter stays one value (S7.24), but only a Layers pick dims the open canvas; the Canvases chips narrow the list. Rejected: a second store (the chips would disagree).
- `decision:maude/v2-p8-c4-convert-selects-the-copy` — after Change kind made a copy the copy is selected via `select-by-id` posted at 0 / 450 / 1200 ms (the canvas re-renders a beat after the write; the select is idempotent). Rejected: waiting for a canvas event (no event for "the source changed").
