# S1 (2.1.1) — what the first sync does after "Link your server"

Decision `maude/v2-2.1.1-s1-first-link-keeps-local-side-lanes`. Spike for B5 (`POST /_api/hub/link-folder`).

## Measured

Harness: the fixture hub (`apps/hub/test/fixtures/serve-hub.mjs --transactions --users`) in workspace mode
(`MAUDE_WORKSPACE_MODE=1 MAUDE_CELL_PAIRING=1 MAUDE_STUDIO_CHILD=0`, so `/health` is ok and the hub
carries the file journal), seeded by a first folder. A second folder is then linked through the real
route + `cloudApi.attachStored` → `linkFolder` → a live `createSyncRuntime`. The harness without
`fileEvents:false` runs the v2 file plane; `hub-link-folder-route.test.ts` sets it, which runs the v1
lane and does not show what the desktop does.

| Kind | This Mac after | Server after | What the person sees |
| --- | --- | --- | --- |
| Canvas, only here | unchanged | created (`doc.create`) | nothing (it syncs) |
| Canvas, only there | pulled down | unchanged | the canvas appears |
| Canvas, both, source differs | **this Mac's source kept** | **server's kept** | held conflict: `conflicts[] body-rejected` + `source-conflict-<slug>` notice → conflict card (Compare · Keep mine · Keep both) |
| File, only here | unchanged | uploaded | nothing |
| File, only there | downloaded | unchanged | the file appears |
| File, both, differ | server's bytes; **this Mac's parked as `<name>.maude-conflict-<ts>-<machine>local.<ext>`** beside it | both (the copy is uploaded too) | the copy in the file list; `files.conflicts: 1`; **no callout** (see follow-up F1) |
| Same source, layout/title differ | **before:** server's, no copy · **now:** server's, this Mac's in `sync-recovery/local.meta.json` + `set-aside-<slug>` notice | server's | **no v2 surface renders the notice** (F2) |
| Same source, comments differ | **before:** never proposed; the recovery copy was overwritten by the board's (one `local.json`) · **now:** union proposed | **now:** both comments | both comments |
| Same source, sticky notes differ | **before:** server's replica, local only in recovery · **now:** union proposed | **now:** both sets | both sets |

## Rule (code)

- Canvas source/css, first link: `decideSourceLane` (`sync/accepted-cold-start.ts`): no base on record + accepted non-empty → `hold`, unless `wasAccepted(local)` (the project once took exactly these bytes → an older state → materialize). Hold → `projection.hold` → `reject('local-edit')` → `onConflict` (`sync/index.ts`, the source-conflict notice).
- Files: `decideFile` `diverged` → `conflict-aside` (`sync/decide-file.ts`); park first, refuse the overwrite if the park fails (`sync/file-plane.ts` `parkLocal`). More than `FIRST_ANCHOR_STORM_LIMIT` first-anchor conflicts hold the set and ask (`resolveFirstAnchor`).
- Side lanes (new): comments and sticky notes whose local value the project **never** accepted (`wasAccepted === false`) are proposed as accepted + entries only this disk has (`unionById`); an id both sides changed keeps the project's, this Mac's goes to the lane's recovery slot. Layout keeps the project's, this Mac's to `local.meta.json`. A value the project once accepted is an older state: project's, quietly (unchanged). A hub checkout (`checkoutIsCache`) owes nothing (T11, unchanged).
- Recovery slots are per lane: `recoverySuffix` (`sync/source-recovery.ts`) — `.annotations.json`, `.meta.json`, `.comments.json`; `.tsx`/`.css` unchanged.

## Interface

- `acceptedColdStart(...)` → `{ kind: 'reconciled', verdicts, setAside?: ProposalLane[] }`.
- `setAsideNotice(rel, slug, lanes)` → the `set-aside-<slug>` notice text in `_sync.json` `notices[]`.
- `unionById('comments' | 'annotations', local, accepted)` → `{ value, complete } | null`.

## Tests

- `test/s1-first-link-side-lanes.test.ts` — red 5/6 with the fix reverted, green 8/8.
- `test/v2-link-server-model.test.ts`, `test/v2-link-server-dialog.test.tsx` — the count lines (red 3 → green).

## Open

1. F1/F2: the file conflict copy and the layout set-aside are recoverable but not said on screen. Default: one Sync details row per `set-aside-*` notice and per file in `conflict`, with the copy's name.
2. Media on a server without media storage stays on this Mac (`[sync/assets] … can't store media`), so "only on this Mac — sent up" is not true for pictures/videos there. Default: the survey reads the hub's media capability and splits the line.
3. A layout difference is not merged (whole value). Default: keep as is (project's + copy); revisit if people report lost arrangements.
