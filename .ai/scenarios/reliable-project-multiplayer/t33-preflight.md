# T33 preflight — the two initial deployments

**Plan:** `.ai/plans/feature-reliable-project-multiplayer.md` T33. Operator runbook:
`docs/operations/project-multiplayer-rollout.md` (preflight → switch → verify → rollback).

Everything below the line *Needs authorization* changes production and is **not
done**. The planning/goal request is not deployment approval: each item waits for
the project owner's explicit go-ahead, one deployment and one project at a time.

## Observed now (read-only, public `/health`, 2026-09-15)

| | AWS StudyFi (`design.studyfi.com`) | Cloudflare Alligators (cloud cell) |
|---|---|---|
| Release | `1.2.0` (hub and render image tags `v1.2.0`, spike notes 2026-09-14) | fleet `fc766cf7…` with `CELL_LIVE_PAIRING=alligators` (spike notes) |
| Identity | `mode: off`, `authMode: tokens` — designers cannot sign in with email/password yet | device sign-in via Maude Cloud (already live) |
| Project | 106 canvases, 90 connected peers | 5,190 objects / 8.46 GB in `maude-cloud-assets` (whole bucket) |
| Media | `assetsRestored: present 520, failed 13` — **13 assets fail to restore today** | not inventoried |
| Accepted revisions | not present (pre-release) | not present; needs `CELL_PROJECT_STORE=do` + `PROJECT_STORE` binding |

The 13 failed asset restores are an existing blocked-media backlog. S20 requires
"no NEW blocked-media backlog", so record the exact 13 paths before the switch and
compare after.

## Local evidence the release rests on (done)

- Kernel/store/fence and both durable homes — plan checkpoints 2026-09-14/15.
- Real Cloudflare `ProjectStore` DO (disposable Worker): 4 SIGKILL rounds with the
  same-transaction retry, 0/104 acknowledged lost, 0 duplicates, ack p95 229 ms —
  `evidence/t32-2026-09-15-durable-object-4-rounds.json`.
- Self-host SQLite: same oracle, ack p95 5 ms — `evidence/t32-2026-09-15-self-host-sqlite-4-rounds.json`.
- Real S3 multipart (hub adapter): 96 MiB and 513 MiB byte-identical, retry and
  abort — `evidence/t18-2026-09-15-real-s3-multipart.json`.
- Native desktop: team-project 6/6, cloud-attach 10/10 (2026-09-15).
- Surface matrix: see the plan's latest checkpoint for the full-run numbers.

## Release artifacts (local, no publish)

1. `scripts/bump-version.sh minor` on a clean tree → `v1.3.0` in package.json, both
   plugin manifests, tauri.conf.json, Cargo.toml and `apps/cells/wrangler.toml`
   (cell image tag); `scripts/stamp-whats-new.mjs` stamps the pending entries.
2. Gates: `bash scripts/check-version-parity.sh`, `bash scripts/check-tarball-shape.sh`,
   `bash scripts/check-import-coherence.sh`, root `pnpm lint`, `pnpm test`,
   `cd apps/studio && bunx tsc --noEmit && bun test test/sync-*.test.ts --timeout 20000`,
   `pnpm --filter @maude/hub test`, `pnpm --filter @maude/cells test`,
   `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`,
   `pnpm --filter @maude/site build`.
3. Client bundle rebuilt release-mode and committed; desktop `.app` built and
   `apps/desktop/scripts/check-client-boots.mjs` + `check-bundle-completeness.mjs --smoke`
   green against it.
4. `apps/cells` `wrangler deploy --dry-run` shows both DO bindings and migration
   `v3` (`ProjectStore`).

## Needs authorization (production — ask first, in this order)

1. **Cut the release**: commit the bump, annotated tag `v1.3.0`, `git push --follow-tags`.
   This publishes npm, the hub image, the render service and rolls the
   Cloudflare cell fleet (every tenant, not only Alligators).
2. **Cloud capability for Alligators only**: set `CELL_PROJECT_STORE=do` for the
   tenant (never blanket-enable unknown tenants), restart its cell by tag change,
   confirm public `/health` → `coordinator.durable: true`.
3. **AWS StudyFi hub upgrade** (SSM/compose on the shared host): pull
   `ghcr.io/1agh/maude-hub:v1.3.0`, keep `/data` on its volume, confirm the S3
   backup target and run one restore drill; enable identity (`MAUDE_IDENTITY=on`
   per the self-host recipe) and create designer accounts/invites.
4. **Per project, one at a time**: runbook preflight (dry-run import, `skipped`
   empty or explained, designers quiet) → switch with `expectEpoch` → parity
   `ok: true` → S20 on the upgraded deployment (clean designer invitation →
   desktop project → browser peer edit → undo → quit → reopen), recording build /
   protocol identity, rollout and rollback checkpoint IDs (no secrets).
5. **Read-only re-inventory needing credentials** (before 1): SSM
   `docker ps`/image digests and env *names* on the StudyFi host; `wrangler
   deployments list` + tenant vars for the cells Worker; the 13 failed asset paths.

T34 (retire old write authorities, fleet rollout) starts only after both
initial deployments pass S20.

## Rollout record — 2026-09-15 (authorized: "vydat novou verzi a migrovat prod")

No secrets below; command IDs are AWS SSM run-command IDs on host `i-0e484a007adbf57a5`.

### Release v1.3.0

- Tag moved twice before every pipeline went green: `3e3b64cf` → `8ba6ae8a` (hub
  image bundler stage lacked `sync/repeated-module.ts` and could not resolve
  `diff` for borrowed studio files) → `ed2b1ebf` (npm now answers a republish
  with "Cannot publish over previously staged version"; the idempotence match
  was case-sensitive and did not know the wording).
- Green at `ed2b1ebf`: build-binaries (npm `@1agh/maude@1.3.0`), build-desktop,
  hub-image (`ghcr.io/1agh/maude-hub:v1.3.0`, amd64 + arm64), selfhost images,
  render-deploy, cells-deploy (fleet rolled). GitHub Release published, not draft.
- Desktop updater endpoint answers a 1.2.0 app with `version: 1.3.0`.

### AWS StudyFi (`design.studyfi.com`)

| Step | Result |
|---|---|
| Read-only inventory | `12e14bdd-a210-4735-84c2-869929082edc` — hub/render `v1.2.0`, volumes `maude-hub_hub-data` (20 MB) / `maude-hub_hub-repo` (86 MB), 25 GB free |
| Rollback checkpoint + upgrade | `1e38dc05-7bb3-4dba-b9bb-3a8f1ad9d7df` — checkpoint dir `/opt/maude-hub/pre-v1.3.0-20260915T142530Z` (`env.bak`, `docker-compose.yml`, `hub-data.tgz`, `hub-repo.tgz`, taken with hub + render STOPPED; previous image IDs `sha256:5264d3c3…` hub, `sha256:a3c988d6…` render); `MAUDE_IMAGE_TAG` → `v1.3.0`; both containers healthy |
| Health after upgrade | `version 1.3.0`, `coordinator {ready, mode: legacy, protocol 1, durable: true}` |
| Dry-run import | 121 documents + 34 folders in one action, 5.1 MB, `skipped: []`, nothing collapsed |
| Switch (`expectEpoch: 0`) | `6d20a040-e81c-4fc1-82ff-7ed2e24ed0f2` — `mode: transactions`, epoch 1, revision 1; **parity `ok: true`, 121/121**; health `ready`, `durable` |
| Store snapshot after switch | `project-store-post-switch.sqlite` in the checkpoint dir, `integrity_check: ok` (the scheduled S3 generation — every 6 h from boot, first at ≈20:27Z — is the first to carry `project-store.sqlite`) |

**Media restore baseline.** `assetsRestored` went from `present 520 / failed 13`
to `present 521 / failed 14`. All 14 are in the `files/` plane: every one of the
117 `files/` objects IS present in the hub checkout (checked path by path on the
host), and the classifier admits all of them as plane files only while their
sibling canvas is absent — the 14 are `.css` sidecars whose `.tsx` exists, i.e.
canvas-owned (the CSS lives in the canvas document), so the restore's write-door
admission refuses to overwrite them from the bucket (checked on the host: exactly
14 of the 70 bucket `.css` objects have a sibling `.tsx` — 13 `ui/orbit/*` canvases
from August plus `ui/orbit/_h7-mobile-board.css`, mirrored 07:43Z before its
`.tsx` was written at 08:58Z). Not media, nothing missing: no new blocked-media
backlog.

**Rollback.** Project: `POST …/v1/mode {"mode":"legacy"}` (accepted state stays
in the documents). Image: restore `env.bak` (tag `v1.2.0`) and
`docker compose up -d hub render`; the volume tarballs restore `/data` and
`/repo` as of the checkpoint.

### v1.3.1 (same day — follow-up fixes)

Release `v1.3.1` (`1927e38b`): build-binaries (npm `@1agh/maude@1.3.1`),
build-desktop, hub-image, selfhost images, render-deploy, cells-deploy all
green; GitHub Release published (15 assets). The release commit's `Lint
(biome)` failed on the two Codex plugin manifests the bump rewrote — fixed on
`main` (`f8f4a868`, bump script now formats every manifest it writes); nothing
shipped differs.

| Step | Result |
|---|---|
| StudyFi checkpoint + upgrade | `8e79c85f-d6b1-4893-a6ad-3626f87044b9` — checkpoint `/opt/maude-hub/pre-v1.3.1-20260915T184558Z` (`env.bak`, compose, `hub-data.tgz` 10.8 MB incl. the project store, `hub-repo.tgz` 63 MB; hub + render stopped while taken; previous images `sha256:6ed9ab95…` hub, `sha256:db756dbc…` render); tag `v1.3.1`; hub healthy |
| StudyFi health | `version 1.3.1`, `coordinator {ready, mode: transactions, protocol 1, durable: true}`, studio ready |
| StudyFi parity | `03e5863a-8c83-4764-8e2e-93043bb10dec` — `ok: true`, 121/121; mode `transactions`, epoch 1, `importPending: false` |
| Alligators | fleet on `1.3.1` (public `/health`: `releaseVersion 1.3.1`, `coordinator {ready, mode: legacy, durable: true}`); still awaiting the owner's switch |

Rollback for this step: restore `env.bak` from the v1.3.1 checkpoint (tag
`v1.3.0`) and `docker compose up -d hub render`; the tarballs restore `/data`
(project store included) and `/repo` as of the checkpoint.

### v1.4.0 (2026-09-16 — the nine follow-up fixes)

Release `v1.4.0` (`213b139f`): all six pipelines green on the first tag —
build-binaries (npm `@1agh/maude@1.4.0`, provenance-signed, plus the seven
platform sub-packages), build-desktop (blank-window gate passed), hub-image
(`ghcr.io/1agh/maude-hub:v1.4.0`), selfhost multi-arch images, render-deploy,
cells-deploy (fleet rolled). GitHub Release published, 15 assets, not draft.

| Step | Result |
|---|---|
| StudyFi checkpoint + upgrade | `f48be572-c0a0-425a-b148-a4b1eb9a2c7d` — checkpoint `/opt/maude-hub/pre-v1.4.0-20260916T024927Z` (`env.bak`, compose, `hub-data.tgz` 10.8 MB incl. the project store, `hub-repo.tgz` 63 MB; hub + render stopped while taken; previous images `sha256:33ead03d…` hub, `sha256:03c3d737…` render); tag `v1.4.0`; both containers up, hub healthy |
| StudyFi health | `version 1.4.0`, `coordinator {ready, mode: transactions, protocol 1, durable: true}`, studio `ready` (0 restarts), history `ready`, checkout present |
| StudyFi parity | `5098e97f-d4ad-40af-b07e-5d0819cd25e3` — `ok: true`, 121/121, no mismatches; mode `transactions`, epoch 1, revision 1, `importPending: false` |
| Media restore baseline | `present 521 / failed 14` — unchanged from v1.3.1; the same 14 canvas-owned `.css` sidecars the write door refuses to overwrite from the bucket |
| Alligators fleet | public `/health`: `releaseVersion 1.4.0`, `coordinator {ready, mode: legacy, protocol 1, durable: true}`; cell `200`, canvas origin `401` (correct without a capability); still awaiting the owner's project switch |
| Render service | `render.cloud.maude.sh/_health`: `v1.4.0`, `configured: true` |

Rollback for this step: restore `env.bak` from the v1.4.0 checkpoint (tag
`v1.3.1`) and `docker compose up -d hub render`; the tarballs restore `/data`
(project store included) and `/repo` as of the checkpoint.

### Cloudflare Alligators

- Fleet on `v1.4.0` with `CELL_PROJECT_STORE = "alligators"`; public `/health`:
  `version 1.4.0`, `coordinator {ready, mode: legacy, protocol 1, durable: true}`.
- The switch is the owner's, and it lives in the **Maude Cloud dashboard**, not
  in the cell's own admin UI: `https://cloud.maude.sh/projects/alligators/saving`
  ("How Alligators saves"), owner role only — any other role gets a 404. The
  page offers **Preview the switch** (a dry run; check `skipped` is empty, and
  `collapsed` — the 4× bodies the peer reported are repaired on import) and then
  **Switch to accepted revisions**, which carries the epoch the preview saw. A
  cold cell answers "The workspace did not answer" — open the studio once so it
  wakes, then come back. The cell admin at `alligators.cloud.maude.sh/admin` has
  no such section (Overview / Peers / People / Tokens / Canvases / Activity /
  Settings), and no operator cell secret is held on this machine.

### S20 on StudyFi — passed 2026-09-16

Run through the debug `.app` built from the release commit, against the live
`design.studyfi.com` on `v1.4.0`. New lane:
`apps/desktop/e2e/scenarios/s20-deployment.e2e.ts` +
`wdio.s20-deployment.conf.ts` (`pnpm test:e2e:desktop:s20`). It is inert
without an explicit `MAUDE_S20_HUB` / `_EMAIL` / `_PASSWORD` — there is no
default target — and it isolates the designer's machine (a first-run home for
the e2e bundle id, an empty hub credential file, an empty cloud session), so it
can neither read nor write the developer's own `hubs.json`.

**Identity recorded by the run:** `version 1.4.0`, `protocol 1`, project
`local`, `coordinator {ready, mode: transactions, durable: true}`.

| Step | Result |
|---|---|
| 1 · first run offers the invited-project door | pass — no token, no folder, no Git |
| 2 · email + password opens the project's own copy | pass — the real project arrived (242 canvas files, 49 MB) in a managed copy nobody chose a folder for; the password was never written, only the minted credential |
| 3 · the designer's work reaches the deployment | pass — a new canvas, then an edit to it, each served back by the hub out of its own blob store |
| 4 · personal undo takes back the last action only | pass — the product's own Undo on the designer's own action; the canvas the first action created stayed |
| 5 · quit and reopen | pass — the app returned to the project by itself; the undone state survived the restart |
| 6 · the designer removes what they made | pass — deleted through the row's delete control; the document is retired on the deployment |

Cleanup: invitation revoked (a second redeem answers `410`), the disposable
account deleted (12 tokens revoked; a login now answers `401`), users back to
5. **Project parity after the run: `ok: true`, 121/121, no mismatches**, mode
`transactions`, epoch 1, `importPending: false`. The throwaway canvas exists
only in the local copy's `_trash/` (runtime state, never synced).

Three things the run found, none of them release blockers:

- **A managed team copy is not a Git repository, so the status bar's Changes
  chip — the only visible entry to project history and its personal Undo —
  does not render there.** The View menu entry and `⌘⇧G` do work, so the
  feature is reachable but not discoverable on exactly the surface an invited
  designer uses. Worth a follow-up.
- **Deleting the file does not delete the canvas**: the deployment holds the
  document and puts the file back. That is the right behaviour (an editor's
  `rm` must not wipe a teammate's canvas) and is now asserted.
- Cloudflare's browser-integrity check refuses `Python-urllib`'s user agent at
  `design.studyfi.com` with a `1010`. Every agent the product actually uses
  (WebKit, Bun, none) is served normally — an artefact of the probing script,
  not a product issue.

### v1.4.1 (2026-09-16 — the waking-workspace fence)

Released for one correctness fix found while checking this very rollout. A hub
reads how its project saves from its own store at boot; until that read came
back, `fence()` assumed the older everybody-writes-directly answer, so a peer
connecting into that window got a writable socket on a project that accepts
only proposals — two writable authorities on one document. On a self-hosted hub
the window is a local file read and effectively nil; on a cloud cell the store
is a Durable Object across the network and the cell wakes constantly. Observed
here: `alligators.cloud.maude.sh/health` answered `coordinator.mode: "legacy"`
seconds after a cold start and `"transactions"` moments later, on a project
switched hours before. It now fails closed, and a workspace that has not looked
yet reports `unknown` rather than passing its default off as a reading.

Also carries the desktop fix that gives an invited designer a visible way into
their own project history.

| Step | Result |
|---|---|
| Release | _pending — recorded when the six pipelines finish_ |
| StudyFi checkpoint + upgrade | _pending_ |
| StudyFi health + parity | _pending_ |
| Alligators fleet | _rolls with the tag_ |

### Still open for T33

- Alligators owner switch + parity.
- S20 on Alligators, which is gated behind that switch: the fleet is on
  `v1.4.0`, but the project still runs in `legacy` mode and no operator cell
  secret is held on this machine.

**Correction (2026-09-16).** An earlier note here read StudyFi's health as
blocking S20: `identity: {mode: "off"}` was taken to mean the hub has no
accounts and that the email/password invitation path would need
`MAUDE_IDENTITY=on`. That is wrong. `identityPosture()` in
`apps/hub/src/server.mjs` reports `MAUDE_CLOUD_IDENTITY` — whether this hub
federates its identity to Maude Cloud — and says nothing about local accounts.
`authMode: "tokens"` likewise describes only the token store. StudyFi was asked
directly through the admin API: **5 users and 3 open invitations**. The
invitation door (`POST /admin/api/invites` → `/join/<value>` → `POST /auth/login`
→ the desktop's `team-hub-url` / `team-hub-email` / `team-hub-password` form)
has been live the whole time. No production environment change is needed for
S20, and none was made.
