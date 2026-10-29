# V2-8 F17: an AI-driven canvas trash is recorded as the person's delete

Triage row F17 (`V2-8-functional-triage.md`); note in `.ai/scenarios/maude-v2/lead/pr-followups.md`
("AI-driven canvas trash … `canvas.delete` by the person, not under the AI run"). p8-fix-b analysed it
and did not implement it: the lead moved it to the A1 attribution builder ("every writer verb claims its
own writes", Michal 2026-10-29), which includes this delete claim.

## How a create is claimed today (S12.16)

1. `maude design curl-local` (`apps/studio/bin/_curl-local.mjs` `chatHeaderFor`) adds
   `X-Maude-Chat: <MAUDE_CHAT_ID>` from the chat shell's own env, on `POST /_api/canvas` only. A typed
   `--header x-maude-chat` is refused, so one chat cannot name another.
2. `http.ts` `/_api/canvas` POST: the route already refuses a cross-origin or rebound-Host write
   (`sameOriginWrite` + `isTrustedRequestHost`). The route is main-origin only (absent from
   `CANVAS_SAFE_API` and the canvas listener, DDR-054), so canvas code can't send the header.
3. After `api.createCanvas`, `runForCreate(req, runs)` (`ai/create-claim.ts`) resolves the header
   against the run registry. It claims only for that chat's LIVE, unqueued run. A header never creates
   or extends a run.
4. `claimCreatedCanvas(control, …)` → `beginAiAction(run:<id>)` (idempotent) + `claimAiWrite(runId,
   repoRel, hash)` → the stage's `claim()` adds the slug and `slug|hash`.
5. The watcher import then finds the explicit claim: local `sync/local-kernel.ts` `syncCanvas`
   (`!live` branch, `stage.captures(rel, true, html, true)`) stages the lanes with `create: rel`, and
   `sync/action-stage.ts` `publishRun` turns them into ONE `doc.create` inside the run's `ai` action.
   The run's single undo takes it back.

## The two delete paths (neither goes through the stage)

- **Hub / accepted project:** `api.deleteCanvas` moves the files to `_trash/` and emits
  `canvas-deleted {slug}` → `sync/index.ts` `noteToHub` → `acceptedLink.deleteDoc(slug)`
  (`sync/accepted-link.ts`) → `structural('Delete canvas', 'canvas.delete', [doc.delete])`, proposed
  with the person as actor. This is the row V2-8.16 saw.
- **Local home:** the watcher sees the file vanish → `syncCanvas` `!onDisk` branch submits
  `doc.delete` with the watcher's action (the person's / `outside`), never asking the stage.
- `publishRun` has no delete op: it builds only `doc.create` + `lane.replace`.

`maude design trash move` (`apps/studio/bin/_trash.mjs` `move`) calls `DELETE /_api/canvas?file=…`
through `_studio-verb.mjs` `call()`, which sends no headers except content-type. curl-local's
`chatHeaderFor` allows only `POST /_api/canvas`.

## Proposed split

- **(a) Stage:** a per-run `deletes` set and `claimDelete(runId, slug)` in `action-stage.ts`;
  `publishRun` emits `doc.delete` for a claimed slug (after the run's `lane.replace`s on other docs,
  dropping staged lanes of the deleted doc). Consumers: the local-kernel `syncCanvas` `!onDisk` branch
  asks the stage (explicit claim only, like creates — never the lone-open-run fallback), and the hub's
  `noteToHub` → `deleteDoc` checks the stage first and leaves the delete to the run's publish when
  claimed. Undo of the run must restore the canvas (doc revive), which needs checking against
  `history/versions.ts` (`trash` / `canvas.delete` rows) and the trash/restore builder's work.
- **(b) Route (http.ts, shared, so a lead patch):** in the `/_api/canvas` DELETE branch,
  `const mine = runForCreate(req, runs)` BEFORE `api.deleteCanvas` (the `canvas-deleted` emit is
  synchronous inside it, so the claim must already be there), then
  `control.claimDelete?.(mine.runId, repoRel)` after `beginAiAction`. The same guards as the create
  apply (same-origin write, trusted Host, main origin only).
- **(c) Verb:** `_trash.mjs move` sends `X-Maude-Chat` from `MAUDE_CHAT_ID` (same id pattern), either
  by giving `_studio-verb.mjs` `call()` a `headers` option, or by widening curl-local's
  `chatHeaderFor` to `DELETE /_api/canvas`. The header must come only from the verb's own process env,
  never from argv or page content.

Security property to keep: the claim names a chat; only the registry decides, and only for that chat's
live run. No route reachable from the canvas origin may carry it.
