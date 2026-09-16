# Rolling a project onto accepted revisions

Operator runbook for plan `feature-reliable-project-multiplayer` (T30/T33,
DDR-241). It covers both deployment families — a **self-hosted hub** (e.g. the
AWS StudyFi deployment behind `design.studyfi.com`) and a **Maude Cloud cell**
(e.g. the Cloudflare Alligators tenant under `cloud.maude.sh`) — and it is
written so that every step before "Switch" changes nothing.

> **Authorization.** Switching a real, in-use project is a production change.
> Run the preflight freely; do the switch only with the project owner's
> explicit go-ahead, one project at a time.

## What changes for the project

A project in `legacy` mode lets every peer write the shared documents. A
project in `transactions` mode keeps its canonical history in the project
store (`project-store.sqlite` on a self-host data volume, or the tenant's
`ProjectStore` Durable Object in the cloud): every change is a proposal the
hub accepts or rejects, peers hold read-only replicas, and history, undo and
restore become project actions. Designers notice nothing except that saving is
truthful — *Saving N changes…* until the project confirms.

The switch is reversible (see *Rollback boundary*). It never loses work in
either direction: entering imports the documents' final state; leaving keeps
the accepted state in the documents; re-entering carries forward anything
written while the project was back in legacy mode.

## Preflight (read-only)

All commands use the project owner's token (`$OWNER`, a hub admin/owner token
or, in a cell, the operator's cell secret). `$HUB` is the hub/cell origin.

1. **Versions.** The hub/cell release must include accepted revisions (the
   first release after v1.2.0) on both the server and every desktop that will
   open the project — an older desktop cannot propose and would only read.
   `curl -s $HUB/health | jq '{version, releaseVersion, coordinator}'` —
   `coordinator.protocol` must be `1`.
2. **A durable store.** `coordinator.durable` must be `true`.
   - Self-host: the data directory is a persistent volume (`/data` in the
     compose recipe) and `MAUDE_DATA_EPHEMERAL` is unset.
   - Cloud: the fleet var `CELL_PROJECT_STORE=do` is set, the Worker carries
     the `PROJECT_STORE` binding and migration `v3` (`ProjectStore`), and the
     cell was restarted onto a release tag after that (the env applies at
     container start). A cell without it answers the switch with
     `409 store-not-durable` — by design.
3. **A fresh backup** (self-host): `MAUDE_BACKUP_TARGET` (or the S3 env set)
   is configured and a generation from the last `MAUDE_BACKUP_INTERVAL_MS`
   exists. From this release every generation includes
   `project-store.sqlite` beside `hub.db`, `tokens.db`, `users.db` and
   `journal.db`. Run the restore drill once before the first switch.
4. **The exact import, without importing** (dry run — nothing persists):

   ```sh
   curl -s -X POST -H "authorization: Bearer $OWNER" -H 'content-type: application/json' \
     -d '{"mode":"transactions","dryRun":true}' \
     $HUB/api/projects/current/v1/mode | jq '.imported | {created, updated, dirs, actions, operations, bytes, skipped}'
   ```

   `skipped` must be empty or understood: every entry names a document and the
   reason (no valid canvas path, a source that does not validate and has no
   valid checkout fallback, an empty document). Resolve those first — a
   skipped document is not lost (it stays in the document store and on the
   checkout), but it will not be part of the accepted project.
5. **Designers' pending work.** Ask designers to let their apps finish
   saving (status *Synced*) and to resolve open conflicts. Nothing is lost if
   they do not — a desktop keeps its candidates and proposes them after the
   switch — but a quiet project makes the parity check meaningful.
6. **Designer accounts** (self-host). Designers sign in with an email and
   password: create member accounts (`POST /admin/api/users` with the hub
   secret) or send invites (`/join/<token>`). Token-only access keeps working
   as the legacy path.

## Switch

```sh
EPOCH=$(curl -s -H "authorization: Bearer $OWNER" $HUB/api/projects/current/v1/mode | jq .epoch)
curl -s -X POST -H "authorization: Bearer $OWNER" -H 'content-type: application/json' \
  -d "{\"mode\":\"transactions\",\"expectEpoch\":$EPOCH}" \
  $HUB/api/projects/current/v1/mode | jq '{mode, epoch, imported}'
```

The hub persists the mode and a new epoch, tells every connected peer on its
own socket, waits one grace round trip for writes already in flight, fences
every connection (read-only per message — no socket is closed), imports the
documents as `maude-migration` actions, and reconciles. Proposals made during
the switch wait for it. `expectEpoch` makes a double-submitted switch fail
(`epoch-stale`) instead of advancing a second epoch.

**If the switch is interrupted.** The mode and epoch are persisted before the
import, so a hub that dies mid-switch restarts in `transactions` mode with the
import noted as unfinished (`importPending` in the store). The next start
finishes it before anything reconciles — the import only creates what the
store lacks — and logs `resumed import: …`. Nothing to do by hand; run the
parity check below once it is up. A finished import is never re-run.

**Git in an accepted project.** The checkout is the shared history's
projection. The studio refuses the Git operations that rewrite its files
(switch or add a draft, discard, get latest, resolve) with `409
accepted-project`; restoring an earlier version happens from History and is a
new action everyone sees. Commit, branch, push and fetch still work.

## Verify

1. **Byte parity** — every live document matches the store head, and the
   checkout matches it where the hub serves one:

   ```sh
   curl -s -H "authorization: Bearer $OWNER" $HUB/api/projects/current/v1/parity | jq '{ok, checked, mismatches}'
   ```

   `ok: true` is required. A mismatch is reported, never repaired by this
   route; re-run after a minute (a reconcile may be finishing) and investigate
   what remains.

   > **This route IS the shadow comparison.** The migration plan asks for one
   > that "compares only, never writes a second authority" — that is exactly
   > what `parity` does: it reads every live document's lanes, compares them
   > against the store head and the checkout's source, and reports. Nothing
   > here writes. Its before-the-switch half is the dry run
   > (`POST …/v1/mode` with `dryRun: true`), which reports what a switch WOULD
   > import and imports nothing. Neither is called "shadow" anywhere in the
   > tree, which has already cost one reader an afternoon concluding the
   > capability was missing — so: `previewSwitch()` before,
   > `parity()` after, both in `apps/hub/src/project-transactions/hub-integration.mjs`.
2. **Health** — `coordinator.ready: true`, `mode: "transactions"`; with the
   cell secret, `proposals.rejected` stays near zero and `ackMs.p95` within
   the SLO below.
3. **A real round trip** — a designer edits a canvas; a second designer sees
   it without refreshing; History shows it under their name; *Undo* on their
   own action works and keeps a teammate's later change.

## Rollback boundary

```sh
curl -s -X POST -H "authorization: Bearer $OWNER" -H 'content-type: application/json' \
  -d '{"mode":"legacy"}' $HUB/api/projects/current/v1/mode
```

Returns the project to legacy writes with exactly the access each credential
had before. The documents already hold the accepted state, so nothing
accepted is lost. The store keeps its history; switching forward again
imports what legacy writers changed in between (`lane.replace` from each
head) and never rolls that work back. A rollback is therefore safe at any
point after the switch — but it is a product regression for designers
(truthful saving, history and undo stop), so treat it as an incident step.

**Disaster recovery.** Self-host: restore the latest backup generation into an
empty data directory (`restoreLatest`; `force` also removes a stale
`-wal`/`-shm` beside a restored database) — the documents, the journal and the
accepted history come back from the same generation. Cloud: the container's
disk is disposable by design; the `ProjectStore` Durable Object is the
canonical history and survives container rollouts, and a new cell reconciles
its documents to it on boot. RPO for an acknowledged action is 0 in both
families (the answer is sent after the store commits); a disaster that loses
the store itself is bounded by the backup interval (self-host) or Cloudflare's
Durable Object durability (cloud).

## SLOs and what to watch

| Signal | Where | Target |
|---|---|---|
| Durable acknowledgment p95 | `/health` (cell secret) `coordinator.ackMs.p95` | ≤ 50 ms self-host, ≤ 150 ms cloud |
| Rejections by code | `coordinator.proposals.rejected` | `base-conflict` rare and explained; any `retryable`, `capacity` or `source-invalid` burst investigated |
| Oldest unanswered change | studio `sync:status` → `accepted.oldestPendingAt` | < 60 s (the app says so beyond that) |
| Coordinator readiness | public `/health` `coordinator.ready` | always `true` in accepted mode (503 otherwise) |

## Backend notes

**Self-host (AWS StudyFi).** Upgrade the hub image by release tag, keep `/data`
on its EBS volume, confirm the backup target, create designer accounts, then
switch. The desktop app's *Open a project you were invited to → Your team's own
server* is the designer's way in (address, email, password).

**Cloud (Cloudflare Alligators).** Roll the fleet onto a release that carries
the `ProjectStore` class, with the tenant in the `CELL_PROJECT_STORE` allowlist
(`apps/cells/wrangler.toml`; `do`/`*` would mean every tenant — don't), restart
the tenant's cell by tag change and confirm `coordinator.durable`. The project
**owner** then switches from the dashboard: *cloud.maude.sh → the project →
Saving → Preview the switch → Switch to accepted revisions*. The preview is the
dry run above (created/skipped by name); the switch carries `expectEpoch` and is
recorded on the project's Activity page. (An operator can still use the cell
secret with the commands above.) Designers open the project from *Maude Cloud* in the app (device
sign-in, project list, *Open*), or from the dashboard's *Open in Maude*.

Two things about browser editors on a cloud project. The canvas origin's
capability lives 15 minutes and an open tab re-mints it itself (from 1.3.1 —
before that, a canvas open longer than that stopped showing teammates' edits
until the page was reloaded). `MAUDE_CANVAS_TOKEN_TTL_MS` may only shorten it.
And every browser editor saves through the cell's one credential, so History
attributes browser changes to the workspace and personal Undo is withheld in
the browser; desktop editors are attributed and can undo their own actions.

## Large projects and hub versions

A hub built on Hocuspocus 4.3 closes any socket with more than 100 documents
mid-authentication. Hubs from this release raise that limit to 4096
(`MAX_PENDING_DOCUMENTS`), and desktops from this release spread a project
over sockets of at most 64 documents, so a new desktop works against an older
hub and an older desktop works against a new hub. A deployment with a project
over 100 canvases should upgrade the hub and the desktops together; the
symptom of a mismatched pair is a copy that never finishes syncing and a
per-label rate-limit log full of refusals for one designer.
