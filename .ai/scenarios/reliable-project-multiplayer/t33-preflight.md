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
