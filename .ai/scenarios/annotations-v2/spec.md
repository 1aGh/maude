# annotations-v2

Verifies the whiteboard on the DDR-242 element model end to end:

- JSON boards
- per-element ops
- the text system
- sections as containers
- live previews
- AI verbs
- migration

It checks each of these on every surface that edits a board.

- **Persona:** a team sharing one board: designers in the browser and the desktop app, plus an AI agent.
- **Plan:** `.ai/plans/feature-annotations-v2-element-model.md` (Task 29).
- **DDR:** `.ai/archive/decisions/DDR-242-annotations-v2-element-model.md`.
- **Hypothesis:** two people and an agent can change the same board at the same time without losing each
  other's work. The old stroke UI's behaviour is fully preserved.

## Lanes

| Lane | Harness | What it proves |
| --- | --- | --- |
| **browser behaviour** | `apps/studio/test/e2e/annotations-ui.e2e.mjs` (R1–R11) + `annotations-parity.e2e.mjs` (P1–P5) | Playwright drives a real studio server. Assertions run on both the DOM and the board on disk. Every scenario was proven red first. |
| **native text** | `apps/desktop/e2e/scenarios/canvas-text-editing.e2e.ts` (annotation phases) | The textarea editor, caret-at-click, Enter / Shift+Enter, and the section title, all in WKWebView. |
| **multiplayer** | `apps/desktop/e2e/multiplayer/surface.e2e.ts` (`--only L09.v2.`, plus the ported L09/L10 rows) | Browser, desktop A and desktop B run in every direction on one rig. |
| **benchmarks** | `apps/studio/test/e2e/annotations-bench.mjs` | Checks bytes per edit, renders per drag and AI read/write size ([perf.md](../../plans/notes/annotations-v2/perf.md)). |

Commands:

```sh
node --test apps/studio/test/e2e/annotations-ui.e2e.mjs apps/studio/test/e2e/annotations-parity.e2e.mjs
pnpm test:e2e:desktop:build
(cd apps/desktop/e2e && npx wdio run ./wdio.conf.ts --spec scenarios/canvas-text-editing.e2e.ts)
bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode candidate --only L09.v2.
```

The `local-e2e.sh` run needs Node 24 on `PATH` for the hub.

Every studio server these harnesses start runs with `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`, so no browser window pops up.

## Rows

| Row | Asserts | Where |
| --- | --- | --- |
| V1 parity | Every existing L09/L10 row passes against the preserved baseline | rig, `--mode candidate --baseline <dir>` |
| V2 concurrent different elements | A moves sticky 1 while B recolours sticky 2. Both changes survive everywhere. | rig `L09.v2.concurrent-different-elements` |
| V3 same element, different fields | A moves a sticky and B recolours the same one. Both changes survive. | rig `L09.v2.same-element-different-fields` |
| V4 same text field | Two writers type in one sticky. Both insertions merge. | browser R7 (a peer op merges into the open editor, and undo removes only mine). The rig can't insert at a cursor. |
| V5 delete while editing | B deletes the sticky A is typing in. A sees the notice, and Enter restores it with the text. | browser R7 + rig `L09.v2.delete-while-editing` |
| V6 section subtree | A moves a section while B edits a child's text. The children move and the text survives. | rig `L09.v2.section-move-while-child-edited`, browser R8 |
| V7 marquee in a section | A marquee inside a section selects only its children. Alt-duplicate copies the subtree. | browser R3 / R8 / P3. The rig can't send Alt. |
| V8 nested sections | An inner section drawn inside an outer one nests and renders above it. They move together. | rig `L09.v2.nested-section-create`, `L09.v2.nested-sections-move-together` |
| V9 IME | Enter during a composition doesn't commit. | unit `annotations-v2-text.test.tsx` (ImeGuard, keyCode 229). **Manual:** Czech dead keys + Japanese IME in WKWebView. |
| V10 migration | A legacy `.svg` becomes JSON at boot and the original is kept. A restart is a no-op. | unit `annotations-v2-migrate-boot.test.ts`, browser suites (legacy fixture) |
| V11 hub migration | Pre-upgrade history: undo and restore keep working | hub `annotations-lane.test.mjs` (SVG history blobs are upconverted) |
| V12 mixed version | An old studio against a v2 board can't erase it. A new studio against an old hub warns. | `annotations-v2-replica.test.ts` (legacy peer write), capability warning. Not driven on the rig. |
| V13 stale sidecar | A reappearing `.svg` is quarantined as `_trash/annotations-v1/stale-…` and the board is unchanged. | unit `annotations-v2-migrate-boot.test.ts` |
| V14 AI round trip | `annotate update` while a peer has the sticky selected: same id, no flicker | rig `L09.v2.ai-update-while-selected`, `annotate-write.test.ts` |
| V15 live previews | Peer B sees A's drag ghost before release, and it clears on release | browser R10 + rig `L09.v2.live-drag-preview` |
| V16 offline / outbox | Edits made offline are accepted after reconnecting | the existing offline row on the rig. Queued SVG proposals are upconverted by `checkLane`. |

**Acceptance:**

- Browser suites green.
- The native text phases green.
- The rig's `L09.v2.*` rows green in every direction.
- No regression against the baseline on the L09/L10 rows.

Run outputs go to `.ai/device/scenario-runs/…` (gitignored).
