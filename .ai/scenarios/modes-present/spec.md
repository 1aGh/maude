# modes-present

**Persona:** a designer who moves one canvas between Edit, Preview and Present, follows a link and comes back, presents artboard by artboard and as one canvas, and leaves with esc each time.

**Feature under test:** Maude v2 S3 (modes and Present) — 04 Modes, rows `md-model` … `md-esc`. Contracts: `apps/studio/client/v2/contracts/S3-slices.md`, `S3-links-format.md`, `S3-present-session.md`; words CONTRACT §3–§4.

## Platform matrix

| Platform | Driver | Required |
| --- | --- | --- |
| web-desktop (1440×980) | agent-browser on a scratch project copy | yes |
| native desktop (WKWebView) | `apps/desktop/e2e/scenarios/modes-present.e2e.ts` (WebdriverIO) | yes, run with `desktop-e2e` |
| mobile / tablet | — | SKIPPED (desktop dev tool) |

## Preconditions

- Scratch copy of the project (never this repo's `.design`): `config.json` with `linkedHub` stripped, no `_sync.json` / `_state`.
- Boot: `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 MAUDE_MACHINE_FILE=$(mktemp) bun run apps/studio/server.ts --root <copy>` on the committed release `dist/client.bundle.js`.
- Canvases: `Smoke` (one artboard, heading linked with `data-cd-link="ui/Cut.tsx#cut"`), `Cut`, and a mixed canvas `Combine` (two 1:1 posts, a `kind="web"` page 600 wide with 900 px of content, a 9:16 `VideoComp` of 3 s, an A4 print).
- The canvas iframe is not reachable by DOM: drive the shell (`palette-mode-*`, `mode-present-*`, `present-*`, `preview-bar*`), keys as synthetic `keydown` on the shell document, and read the canvas through screenshots. `agent-browser press` is not used (it pegs Chrome's CPU).

## Steps

1. **Edit.** Open `Combine`. Assert the switch (`palette-mode-edit` pressed), the cluster `data-cluster="full"` with faces + status word.
2. **Present ⌄ menu.** Click `mode-present-menu`. Assert the drawn rows with their keys and notes (`mode-present-from-selection` ⌥⌘↵, `mode-present-from-start` ⇧⌥⌘↵, `mode-present-canvas` "no chrome, no pins", `mode-present-order-notes`; the presenter row only with two displays, "Copy presentation link — follows you live" in a cloud project). esc closes the menu and leaves the mode.
3. **Preview.** ⌥⌘P: `preview-bar` "Previewing Combine · esc to edit", cluster `compact` (status word and faces gone), Canvases panel folded to its icon, project pill folded to the mark, annotation toolbar. Measure the Edit → Preview move on `requestAnimationFrame`.
4. **Follow a link and back.** On `Smoke` in Preview click the heading: `preview-bar-back` reads "‹ Smoke", the bar says "Previewing Cut"; back returns, the back button goes.
5. **Present from selection.** Select an artboard, ⌥⌘↵: `present-counter` "2 / 5", `present-label` the artboard name, no cluster, no panels. → ← space step; the counter skips nothing it should not.
6. **AI holds still.** While Present · Artboards shows an artboard, change that artboard's source on disk: the screen keeps the old content; after → ← it lands. The same write in Preview lands at once.
7. **Video.** Step to the 9:16 reel: `present-media-toggle`, `present-media-time`, `present-media-sound`. A headless Chrome cannot prove autoplay with sound; the native run measures it (S3.3 helper `videoPlays`).
8. **Present the canvas.** `mode-present-canvas`: `present-pill` "Presenting the canvas · NN % · esc to leave", nothing else.
9. **Mixed kinds.** Present from the start, walk the web page (wheel scrolls inside the stage), the reel (pillarbox), the A4.
10. **Presenter view.** Two displays only; one display: SKIPPED with the reason.
11. **esc ladder.** Menu → mode; Preview → Edit; Present → where it came from (Preview → Preview → Edit); Edit with nothing selected: nothing.

## Result of the first run (agent-browser, 2026-10-19)

Evidence frames (canvas artboard | built state, one PNG per `04/md-*` row): `.ai/plans/notes/v2-evidence/S3.13/`. Per-row verdicts and gaps are in the S3.13 hand-back. No S3 row reached `verified`.
