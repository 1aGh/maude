---
name: post-1.0-hardening-backlog
status: deferred
created: 2026-08-19
decisions:
  - kg:maude/debate-v1-gate-set (round 4, 2026-08-19 — everything here was 4-0 deferred OUT of the v1.0.0 gate)
---

# Feature: post-1.0 hardening backlog (deferred 4-0 from the v1.0.0 gate)

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports.

## Description

Everything the original 5-phase hardening program (rounds 1–3, 2026-08-05) and the sync arc's open-findings list contain that does **NOT** gate the v1.0.0 tag. Deferred, not dropped — each item is named here so nothing silently disappears. Source of the full task detail: the pre-re-scope revision of `feature-production-grade-hardening.md` (`git log -p --follow` on that file) and `.ai/plans/archive/feature-sync-burn-down-and-shared-doc.md` § "Inherited security findings".

**Ordering guidance, not mandate**: the "Before first external users" block is BINDING debt (it was traded away in round 4 only because Maude has zero external users today); the rest is opportunistic 1.x work.

## Metadata

- **Type**: Refactor / hardening backlog
- **Complexity**: High (program), Medium per item
- **App/Package**: apps/studio, cli/, apps/hub, apps/cloud, packages/* (new), root CI

---

## Backlog

### Before first external users (BINDING) — DONE 2026-08-20

The whole binding block shipped to main as `feature-before-first-external-users`
(archived). All five items complete; two things stay open by design, both
recorded in that plan's close-out: the scope half of B14/B15 (deferred with
rationale — needs the document-name↔path vocabulary reconciliation, a feature)
and Increment 8 (blocked on a RELEASE by the arc's soak rule; main carries the
work but npm is still 0.60.7 per STATE.md).

- **A7 notices reach a human** — DONE. `console.warn`s became an additive
  `notices[]` payload rendered in the Sync panel with a per-(notice, hub)
  machine-local dismiss (commit `fee7150d`).
- **Consent / first-upgrade dialog + UI toggles** — DONE. `/_api/sync/settings`
  + panel toggles, per-file doručenka rows, global first-upgrade consent
  dialog, and in-UI adopt/detach via `/_api/sync/ownership` (commits `26cfbbcc`,
  `78a2de12`).
- **`_trash/` retention + findable restore** (F-6) — DONE. `sync/trash.ts`
  scanner + `/_api/sync/trash` (list/restore/prune) + panel Trash section;
  product copy repointed off the hidden folder (commit `7f512e24`).
- **OIDC AppSec pass** — DONE. Surface verified sound; the one open gap
  (unthrottled `/studio/signin` + `/auth/oidc/callback`) fixed with a fail-first
  reachability pin. No beta label existed to remove
  (`.ai/logs/security-reviews/oidc-appsec-pass.md`, commit `62b949ac`).
- **Hub-trust findings** — DONE bar the deferral. F-4/F-7/F-8/F-14/B14
  (precondition)/F-11/F-12/B6/B13 fixed with fail-first tests; B11 fell to the
  ownership confirm row; the scope half of B14/B15 deferred with rationale
  (commit `566096bd`).

### Release-channel + detection (old Phase 5, re-scoped by round 4)

- **T21′ prerelease channel — tooling FIRST**: round 4 measured that no canary mechanism exists (`bump-version.sh:77` rejects prerelease strings, parity script same, `npm publish` has no `--tag`, updater endpoint has no channel dimension) and the `v*.*.*` globs would match an rc tag. Before any soak/promotion model: extend the version grammar, add `--tag next`, verify the site updater route's `releases/latest` prerelease exclusion, split the workflow globs. Then the written promotion rule + maintainer-on-canary from the original T21.
- **T22 nightly ecosystem-verify** — the repo still has zero `schedule:` workflows: clean-container `npm pack` → install → every `maude design <verb>`; upgrade-from-N-1 leg (the auto-updater code path has never been exercised); built-`.app` boot legs.
- **T23 local diagnostics + no-telemetry DDR** — ring-buffer boot log, Help ▸ Copy diagnostic report, `maude doctor --bundle`, redaction test; record the no-background-telemetry commitment; document the updater's outbound call in privacy.mdx.
- **T5b trusted publishing** — migrate the 8 npm packages off the long-lived `NPM_TOKEN` (`build-binaries.yml` ×2) to npm OIDC trusted publishing. (Do not conflate with hub end-user OIDC.)
- **Full studio suite → required**: flip A3's non-blocking full-suite job to required once clean-CI data names (or empties) the quarantine list. Includes triaging the `/_api/figma/import` cluster round 4's SHIPPER flagged as possibly real.

### Observability + hygiene (old Phase 1 residue)

- **T0b — RESOLVED (2026-08-20).** Deleted the 1,312-line pre-DDR-009 Node
  server; `maude design serve` from source now refuses loud without bun (the
  fallback silently served a years-stale feature surface). The published
  `claude-design-server` bin now forwards to `maude design serve` via a shim
  (`cli/bin/claude-design-server.mjs`) instead of pointing at the deleted file;
  `apps/studio/package.json` `main`/`start` repointed; CLAUDE.md's
  "runtime migration ahead" note (stale since Phase 3.4 landed) rewritten.
- **T0d′ — RESOLVED (2026-08-20).** `check-import-coherence.sh` runs as a
  required step in `quality.yml` (~26 s), next to the other script gates.
- **T0e — RESOLVED (2026-08-20).** `.bun-version` is the one source; all six
  workflow `setup-bun` steps consume it via `bun-version-file`, and
  `apps/hub/Dockerfile`'s three `oven/bun` stages are pinned to it — they had
  floated on `oven/bun:1`, i.e. the hub image's runtime was whatever bun
  published that week. `check-version-parity.sh` asserts all of it: the file
  exists and is exact x.y.z, no workflow carries a literal `bun-version:`, and
  the Dockerfile tags match (both negative cases verified firing).
- **T3** remove the Biome client exclusion (`"!**/apps/studio/client"`) — format-only commit first, then errors-only ratchet over the 33k virgin lines.
- **T4 — RESOLVED (2026-08-20).** New path-filtered `client-boot.yml` on
  `client/**` PRs: (a) `check-runtime-bundles.sh` size floors per-PR (v0.22.0
  class — previously release-only); (b) `scripts/check-client-boots-source.mjs`
  — builds `--release`, boots the SOURCE server, loads it in chromium with a
  `window.__TAURI__` stub injected and asserts `#root` mounted (v0.51.1 class,
  verified failing on a planted broken bundle). Committed-bundle byte-drift is
  a REPORT-ONLY step by design: the committed `client.bundle.js` is not what
  ships (regenerated at package time) and bun's minifier has been
  environment-sensitive, so a hard byte gate would go permanently red on any
  macOS↔Linux nondeterminism — the boot gate is the correctness check.
- **T5** JSDoc `@ts-check` trial over `cli/lib` with the three named escalation triggers.
- **T2′** cloud/cells type gate (`wrangler types` + `tsc --noEmit` — cloud has no tsconfig at all today); **T15c** `apps/cells` → TypeScript (838 lines guarding tenant isolation).
- **T6** characterization tests + desktop-e2e scenarios for panels about to move (prerequisite for the decomposition below).

### Decompose + shared layer + unified UI (old Phases 2–4, unchanged verdicts)

- **T7–T10** `app.jsx` (15,936 lines) decomposition along the `client/panels/` seam — pure move-and-export commits, bundle byte-delta band, exit ≤ ~2,000 lines.
- **T11** duplication census (admission rule: ≥2 named real consumers); **T12** five-environment reachability canary + dep-surface freeze — blocks all content moves.
- **T13** `packages/tokens` (DTCG source, hand-written emitters, byte-identical first run); **T14** `packages/protocol` (runtime-state list generator, DDR-088 parity, slug conformance + property tests); **T15** `packages/crypto-portable` narrowed to token grammar + timing-safe compare; **T15b** hub COPY-manifest gate + published dep posture.
- **T16–T19** `@maude/ds-css` pilot (kill-switch), shell vocabulary convergence, handoff `--check` + self-containment, DiffView inversion pilot → written go/no-go incl. trust-boundary review.
- **T20** TypeScript policy DDR (checker-first ratchet) — record once the trial evidence exists.

### Desktop E2E harness residue (found running the v1.0.0 gate's e2e lane, 2026-08-19)

Both scenarios that were red on the branch are now fixed — the causes were **stale
tests, not product defects** (`timeline-manual-cut` asserted a band-mode storyline
its media-free fixture deliberately never renders; `canvas-text-editing` asserted
caret-at-click after the 2026-07-20 steer made the dblclick entry select-all, and
its drill budget of 5 was under the 3–4 dblclicks the ladder actually needs). What
is left is harness quality, not correctness:

- **E1 — the two write-through waits are load-sensitive.**
  `canvas-text-editing.e2e.ts:904` ("h1 edit never persisted through reload") and
  `:1028` (the `.map` card equivalent) both wait on commit → `/_api/edit-text`
  source rewrite → file-watcher HMR → re-render. Measured over ~15 consecutive
  runs: failure count tracks machine load (this box sits at 7–9 from concurrent
  sessions) and the specific test varies. **Do not "fix" by raising the timeout
  until it has been measured on an idle machine** — that would only move the
  ceiling, and the current number may be fine. This is
  `feedback_native_app_verification_ceiling` in its load form; the honest fix is
  either an idle-run measurement or a deterministic settle signal (an explicit
  "source rewritten + canvas rebuilt" event to await instead of polling the DOM).
- **E2 — RESOLVED (2026-08-20).** A run left the VERSIONED fixture dirty on
  failure: `canvas-text-editing` snapshotted `ui/Smoke.tsx` +
  `ui-smoke.annotations.svg` in `before` and restored in `after`, but a
  crashed/killed run skipped `after` — the tree was then dirty, and worse, the
  NEXT run snapshotted the dirty state as its baseline and cascaded (observed:
  one run reported 6 failures purely from this). It also broke a `git stash pop`
  mid-investigation. Two more scenarios had the identical shape and the identical
  bug: `timeline-manual-cut` (`ui/Cut.tsx`) and `cloud-attach`
  (`.design/config.json`). All three now go through
  `apps/desktop/e2e/helpers/fixture-guard.ts`, which writes the baseline to a
  gitignored sidecar under `_e2e-evidence/fixture-guard/` BEFORE any test runs.
  A sidecar still present at the next `snapshot()` is the fingerprint of a run
  that died: the guard repairs the tree from it and only then baselines, which is
  what breaks the cascade. SIGINT/SIGTERM/`exit` handlers cover the catchable
  cases; the sidecar covers SIGKILL. Verified by simulating a killed run —
  baseline pristine + tree repaired on the following run.
- **E-1 — five server-booting studio tests race on CI and pass locally.** Surfaced
  by the new non-blocking `studio-suite` job on its first real runs (the whole
  point of it): `POST /_api/import-asset`, `POST /_api/import-brand`,
  `_active.json round-trip` (the v=1 case), `exporters/jobs` byte
  retrieval/eviction, and `issue #74` comments file-watch re-broadcast. The
  signature is a read that beats the server's own write — e.g. `ENOENT ...
  /tmp/mdcc-test-*/.design/_active.json` — with the sibling assertion in the same
  file passing. macOS has never shown them. Same family as E0 and E1: waits that
  assume a settle rather than awaiting a signal. Left red on purpose for now —
  the job cannot fail the merge, and inventing timeouts without an idle-machine
  measurement just moves the ceiling.
- **E0 — RESOLVED (2026-08-20), with the diagnosis corrected.** The item claimed
  the test ran "under bun's 10-second default timeout, so the budget EQUALS the
  workload". That was wrong on the tree: it has carried an explicit per-test
  timeout of `STRESS_MS + 5_000` since 2026-05-27 (`5f911512`). The real defect
  was that the headroom was a FLAT +5 s over a wall-clock window the body burns
  by construction — re-measured 2026-08-20 at 10.10 s against a 15 s budget on a
  loaded box (load 6.3). Now `STRESS_MS * 2 + 10_000`, so headroom scales with
  the window. Nothing in the test asserts speed (the checks are RSS + Y.Doc
  growth), so the wider budget costs no signal.
- **E3 — RESOLVED (2026-08-20).** The default `wdio.conf.ts` spec glob claimed
  scenarios that have their own configs: `specs: scenarios/**/*.e2e.ts` swept in
  `onboarding`, `cloud-attach`, `git-*`, `acp-cold-start` and `shell-parity` —
  seven specs, each with a dedicated conf supplying env they cannot run without,
  so `pnpm test:e2e:desktop` ran them under the WRONG config and they failed for
  missing env rather than a real defect. Fixed by naming the seven in a
  `DEDICATED` map and computing the default spec list as "everything else"
  (17 → 10). **Deliberately NOT via `exclude:`** — all seven confs do
  `{ ...base, specs: [theirSpec] }` without touching `exclude`, so an inherited
  exclude list would have contained their own spec and left every one of those
  suites running nothing. A load-time tripwire fails loud when the conf count and
  the map size diverge (verified: firing on a planted 8th conf), and `onPrepare`
  now prints what the default run does NOT cover, with the command for each.

### Release-mechanics hazards found preparing the B2 drills (2026-08-20)

- **D-1 — RESOLVED (2026-08-20).** `hub-image.yml` computed its tags as
  `VER="${GITHUB_REF_NAME#v}"` unconditionally, so a `workflow_dispatch` from
  main resolved `VER=main` and would have published `ghcr.io/1agh/maude-hub:vmain`
  — a version tag from a ref that is not a version. Same shape as round 4's
  finding that the `v*.*.*` globs match `v1.0.0-rc.1`: the manual path inherited
  a name nobody chose. Decision (user): **`:latest` is always published** — it is
  the deploy emitter's default and what every self-hoster pulls, so it tracks the
  newest build by design — and the extra tag is an **optional** dispatch input
  for when a build needs a second addressable name (which is what a fleet drill
  needs, since `cells-deploy` derives its cell from a named hub image). A
  dispatch with no tag now publishes `:latest` alone; the version tag is derived
  only on a real tag push; the input is charset-validated.
- **D-2 — the fleet drill has a chicken-and-egg the plan does not name.**
  `cells-deploy` derives the cell from an EXISTING hub image, and the merged code
  is published nowhere (no tag). So a drill of *this* code needs either D-1's
  staging image or the v1.0.0 tag itself — i.e. the gate cannot be satisfied
  before the thing it gates, unless D-1 is fixed first.

### DS specimen defects (found reading all 73 smoke PNGs, 2026-08-19)

All three are **pre-existing** — confirmed byte-identical to the previous cleared
smoke run, so none is a regression from the gate set. Cosmetic, none blocking.

- **S1** `colors-presence` §2 — the agent cursor's label overlaps its own name chip
  ("agent editi" + "Agent" collide) in the Group·Footer artboard.
- **S2** `iconography` §4 ("In the toolbar") — the seated glyphs render as empty
  boxes; §2's full set renders correctly, so it is specific to that specimen's
  toolbar mount.
- **S3** `commands_overview` — diagram nodes render as solid black boxes with no
  visible labels (draw-engine text). Also affects the same canvas in older runs.

### Sync arc residue (non-security)

- **Increment 8** — delete `agent.ts` + the two-doc relay (deliberately held so the `MAUDE_SHARED_DOC` flip keeps a config rollback; unblocks only after A7-notice ships).
- Two open RCA items in `.ai/logs/rca/issue-cloud-assets-open-findings.md` §3 + live half of §4.
- Duplicate DDR-223 file numbering remains open.
- **`maude kg record-log` ENOENT — RESOLVED.** Repo-namespaced slugs containing
  `/` are handled by `cli/commands/kg.mjs` and pinned by
  `cli/commands/kg.test.mjs` (the regression names the former ENOENT failure).

---

## Validation

Per-item, inherited from the original plan's per-task validation (see the pre-re-scope revision). Program-level: every item either ships in a 1.x release or carries a written rejection — nothing exits this list silently.

## Acceptance Criteria

- [ ] "Before first external users" block completed BEFORE any release is promoted to a real external population (or each item carries a recorded, dated waiver)
- [ ] Each remaining item scheduled into a 1.x plan or explicitly rejected with a DDR
- [ ] This file archived only when empty

---

## Retro — E-block pass (2026-08-20, E0/E2/E3 closed)

- **A backlog item's diagnosis ages worse than its symptom.** E0 named a cause
  (`bun`'s default timeout) that had been untrue since 2026-05-27 — the fix it
  prescribed was already half-applied. The symptom was real, the mechanism was
  not. Re-measure before implementing anything a backlog item asserts about
  *why*; the entry is a lead, not a spec. Same shape as the CLAUDE.md rule about
  plan checkboxes lagging reality.
- **A bug written up against one file was in three.** E2 was filed against
  `canvas-text-editing`; `timeline-manual-cut` and `cloud-attach` carried the
  identical hand-rolled before/after shape. Grepping for the *pattern* rather
  than the *named file* is what turned a one-scenario patch into a shared guard.
  Worth doing by default on any "this test does X badly" item.
- **The obvious fix for E3 would have silently disabled seven suites.** Reaching
  for wdio's `exclude:` reads as the natural answer and would have been
  invisible in review — the confs spread `...base` and never override `exclude`,
  so each would have excluded its own spec and reported success on zero tests.
  Checking how the *consumers compose the thing you are editing* caught it.
  Green-on-nothing is the failure mode to fear in test-harness work.
- **Self-review on my own diff found the only security-shaped defect.** The
  sidecar is parsed from disk, so its keys were untrusted input feeding a file
  write; nothing else in the pass would have surfaced it. Small, but it argues
  for reviewing harness code with the same posture as product code.
- **What the gate can't see.** Running the quality gates surfaced an unrelated
  stale artifact (`site/lib/whats-new.json` still on 0.60.7 after the v1.0.0
  release) because the site-content gate compares only `site/content/docs/` and
  `site/lib/stats.json`. **Done 2026-08-20:** the gate now regenerates and
  diffs `roadmap.json` + `whats-new.json` too. The blocker was that both
  generators stamped a clock-based `generated` field — every regen was dirty by
  construction, which is *why* they had been left out; both now derive
  `generated` deterministically from their inputs. Follow-up closed
  2026-08-20: the roadmap's per-phase dates were ALL null (three stacked causes
  — the kgai-era STATE.md records history as prose the table parser never
  matched; the migration moved the old tables to `.ai/archive/state/` which the
  generator never read; and the newer tables put the plan ID in the Phase cell
  where the matcher expected `Phase X.Y`). All three parse now, with the
  archival commit date (`git log --diff-filter=A`) as the last-resort source —
  192/192 dated. Both generators also bail out instead of overwriting their
  committed output when run outside the repo (the Vercel shape).
