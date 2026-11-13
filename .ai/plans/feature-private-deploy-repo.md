# Feature: Private `maude-deploy` repo for the Cloudflare pipeline

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports.

## Description

Every Cloudflare deploy of Maude Cloud (the data-plane cells, the control-plane Worker, the render service) runs today as a GitHub Actions workflow in the **public** repo `1aGh/maude`. Two consequences the security audit of 2026-11-03 named (`.ai/logs/security-reviews/main-20261103-2005.md`, X1 / X2 / X8 and Addendum 2):

1. Anyone can read the run logs — bindings, workers.dev URLs, container app/version ids, health bodies (reconnaissance; secrets are masked).
2. The account-wide Cloudflare tokens (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `MAUDE_CONTAINERS_TOKEN`) sit in a repo that fork PRs, Dependabot auto-merge and every third-party action in the public tree can reach.

This plan moves the **deploy half** into a new private repo `1aGh/maude-deploy`. The code stays public and unchanged: the private jobs check out `1aGh/maude` at the release tag (public clone, no token) and run the same scripts (`infra/cell/Dockerfile`, `scripts/verify-fleet-release.sh`, `scripts/collect-v2-convert.mjs`, `scripts/release-kind.mjs`). The ghcr publishes (`maude-hub`, `maude-render`) stay public: a ghcr package is linked to the repo that first published it and another repo's `GITHUB_TOKEN` is denied (the v0.59.0 lesson), and the images are the self-host artifacts anyway. The private repo only does what needs a Cloudflare credential.

Option A from the audit (moving `apps/cloud`, `apps/cells`, `apps/render` out of the public repo as well) is **out of scope** — it buys recon reduction only, at the cost of a two-repo release and a pinned-dependency split.

## User Story

As the owner of Maude Cloud I want the Cloudflare deploys to run from a private repo so that no one can read the deploy logs and no public-repo compromise can reach the fleet.

## Problem

- `.github/workflows/cells-deploy.yml`, `render-deploy.yml`, `cloud-deploy.yml` run under the three Cloudflare secrets in the public repo; their logs are world-readable for 90 days.
- `cloud-deploy.yml` deploys the control plane on **push to main** (`apps/cloud/**`), so a Dependabot auto-merge is a production deploy (X8).
- The repo's own tests pin these workflow files (`scripts/test/workflow-invariants.test.mjs`, `scripts/test/release-channel.test.mjs`) — moving the files without re-homing the guards would silently drop the v0.57.0 (`:latest`) and v0.58.0 (branch deploy) invariants.

## Solution

Converged in the divergent debate (reduce tier — builder / shipper / breaker, 2026-11-03):

| Question | Decision | Why |
| --- | --- | --- |
| Trigger | **Manual** `gh workflow run deploy.yml -R 1aGh/maude-deploy -f tag=vX.Y.Z` as a runbook step right after `git push --follow-tags`. No PAT in the public repo, no `repository_dispatch`, no polling. | The release is already a manual checklist; a dispatch PAT puts a deploy-capable credential back into the public repo and fails silently on expiry (breaker #1). Can be automated later with a fine-grained PAT (`actions: write` on `maude-deploy` only) if the manual step proves forgettable. |
| Payload trust | The private job resolves the tag to a SHA (`git rev-parse`), checks it is an annotated stable tag matching `package.json` at that SHA (`scripts/release-kind.mjs`), checks both `wrangler.toml` image tags equal the release, refuses a version below the currently deployed `/health` `releaseVersion` unless `allow_rollback=true`, and checks out **by SHA**. | A moved or deleted tag, or a rollback, must be an explicit decision (breaker #5). |
| ghcr publishes | New public `render-image.yml` (modelled on `hub-image.yml`) builds + publishes `ghcr.io/1agh/maude-render:<tag>` with `GITHUB_TOKEN`. The private render lane **pulls the public image by digest** and pushes it to the Cloudflare registry — no private build. | Package permissions (v0.59.0); the image is public (anonymous pull verified 2026-11-03); no billed build minutes. Cells already wait for the public hub image the same way. |
| Control plane | `cloud` lane of the same private workflow, dispatched with the release tag (or a `ref` for a hotfix). Its `node --test` moves into public `quality.yml`; the private job reruns it before `wrangler deploy`. | Push-to-main deploy goes away (X8). Tests stay a public gate without a credential. |
| `render-canary.yml` | **Stays public.** It uses only `GITHUB_TOKEN` (ghcr read) and public URLs. Mask the health body it echoes (audit W2). | Nothing to protect; moving it adds a repo to watch for no secret. |
| Workflow-pinning tests | Tag-only / never-`:latest` / hub-tag-pinned invariants move to `maude-deploy/test/*.test.mjs` with their own CI (`node --test`, runs on every push of the private repo, checks out the public repo for `parseJobs`-free YAML reads). Public `release-channel.test.mjs` keeps `hub-image.yml`, `build-*.yml`, gains `render-image.yml`; the `wrangler.toml`-tag-equals-release assertion keeps living in `bump-version.sh` + `check-version-parity.sh` (public) **and** in the private job. | The guards exist because of real incidents; they must keep a CI gate (breaker #3). |
| Cutover | Private workflow first validated with `dry_run=true` against the current stable tag (stops before `containers push` — never re-push bytes under an existing tag). Then **one public commit** adds `render-image.yml`, deletes the three deploy workflows, adjusts tests and docs. The next release goes through `maude-deploy`. After it verifies green, delete the three secrets from the public repo and **rotate all three tokens** (past public logs). | No tag is ever deployable by both pipelines (breaker #6). |
| Hardening that comes free | `environment: production` in the private repo with the secrets as environment secrets and a required reviewer (a second click on a single-owner account still blocks automation); per-component concurrency groups; private Actions minutes budgeted (cells build ≈ 5 min, render pull ≈ 2 min, cloud ≈ 1 min). | Tier 0 of the audit; cheap once the repo exists. |

Not addressed here (still Tier 0/1 in the audit): hardware 2FA on `1aGh`, tag ruleset on `v*` in the public repo, `enforce_admins`, pinning `wrangler`, SHA-pinned actions, per-app Cloudflare tokens, OIDC (Cloudflare has no GitHub OIDC federation for wrangler — long-lived tokens stay, scoped).

## Metadata

- **Type**: Refactor (CI/CD)
- **Complexity**: Medium
- **App/Package**: `.github/workflows/`, `scripts/test/`, `.ai/release-guide.md`, `CLAUDE.md`; new repo `1aGh/maude-deploy`
- **Affected Systems**: Maude Cloud fleet rollout (cells), render service, control-plane Worker, release runbook, GitHub secrets
- **Dependencies**: `gh` with the `1aGh` admin token (`gh auth token --user 1aGh`); Cloudflare tokens re-entered into the private repo; nothing new in the codebase

---

## Context References

### Must-Read Files

> `/flow:execute` reads every file listed here in parallel in a single assistant message — they are independent context loads.

- `.github/workflows/cells-deploy.yml` — Why: the steps to carry over verbatim (prerelease refusal, tag assertion, hub wait, build, seal, push, deploy, verify, convert report); its header comments are the fleet contract.
- `.github/workflows/render-deploy.yml` — Why: which steps are the ghcr half (lines 114–172, stay public as `render-image.yml`) and which are the Cloudflare half (175–end, move).
- `.github/workflows/cloud-deploy.yml` — Why: the control-plane lane; the `/health` poll stays as is.
- `.github/workflows/hub-image.yml` — Why: the pattern for the new public `render-image.yml` (tag policy, multi-arch, manifest-list check).
- `.github/workflows/render-canary.yml` (lines 40–65) — Why: the health echo to mask; otherwise untouched.
- `scripts/test/workflow-invariants.test.mjs` (lines 150–260) — Why: the (a)/(b) tests that move; `parseJobs` helper to copy.
- `scripts/test/release-channel.test.mjs` (lines 110–200) — Why: the tag-triggered workflow list to edit.
- `scripts/release-kind.mjs` — Why: the private job classifies the tag with it.
- `scripts/verify-fleet-release.sh`, `scripts/collect-v2-convert.mjs` — Why: called from the private cells lane by path inside the public checkout.
- `.ai/release-guide.md` (lines 170–232) — Why: the Push section gains the dispatch step and the verify section changes repo.
- `CLAUDE.md` § "Release flow" — Why: the chain description to update.
- `.ai/logs/security-reviews/main-20261103-2005.md` (Addendum 2) — Why: the decision record this plan executes.

### Files to Create

- `maude-deploy/.github/workflows/deploy.yml` — one `workflow_dispatch` workflow, inputs `tag`, `components` (default `cells,render,cloud`), `dry_run`, `allow_rollback`, `ref` (cloud hotfix only); jobs `resolve` → `cells`, `render`, `cloud` (each `needs: resolve`, `environment: production`, own concurrency group).
- `maude-deploy/.github/workflows/test.yml` — `node --test test/` on push.
- `maude-deploy/test/deploy-invariants.test.mjs` — the moved (a)/(b) guards, re-targeted at `deploy.yml`.
- `maude-deploy/README.md` — what the repo is, how to dispatch, what it refuses, the secrets it holds, the cutover date.
- `.github/workflows/render-image.yml` (public) — ghcr publish of `maude-render` on stable tags.

### Documentation / Patterns to Follow

- `hub-image.yml` — the public image-publish shape (`:latest` always, extra tag optional — decision `maude/hub-image-tag-policy`).
- Decisions `One path to the fleet` (d_2152229760ff703da58e2d03) and its amendment `a branch push touches NOTHING in the fleet` — the invariants the private workflow must keep: only a release tag builds/pushes/deploys; never derive from `:latest`; `wrangler deploy` is a release operation.
- `v0.59.0 reached the fleet by hand` (d_394d6db09fa6ce1e1f7f5236) — the ghcr permission trap this plan routes around.
- Memory `maude-gh-admin-account` — the active `gh` user lacks admin; every `gh` call against `1aGh/*` uses `GH_TOKEN=$(gh auth token --user 1aGh)`.

---

## Tasks

Execute in order. Each task is atomic and testable.

### ✅ Task 1: CREATE the private repo and its secrets — completed 2026-11-13 (repo + environment `production` + Actions restrictions; required reviewer refused by GitHub on the Free plan, 422; the three secrets are entered by the owner)

- **Do**: `gh repo create 1aGh/maude-deploy --private --description "Cloudflare deploys for Maude Cloud (private: logs + tokens)"`; create environment `production` with a required reviewer (`1aGh`); add `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `MAUDE_CONTAINERS_TOKEN` as **environment** secrets (values re-entered by the owner — never copied from the public repo by a tool). Enable Actions, default workflow permissions `read`, `allowed_actions` restricted to `actions/*`, `docker/*`.
- **Files**: none in this repo
- **Pattern**: public repo settings as inventoried in the audit (`gh api repos/1aGh/maude`)
- **Gotcha**: `GH_TOKEN=$(gh auth token --user 1aGh)` for every call. Secret values come from the owner in the terminal; the executing session must not read them from the public repo (it cannot anyway).
- **Validate**: `gh repo view 1aGh/maude-deploy --json visibility` → `PRIVATE`; `gh api repos/1aGh/maude-deploy/environments/production` lists the reviewer; `gh secret list -R 1aGh/maude-deploy -e production` shows the three names.
- **Risk**: secrets

### ✅ Task 2: CREATE `maude-deploy/.github/workflows/deploy.yml` — completed 2026-11-13 (dry run against v2.2.1: https://github.com/1aGh/maude-deploy/actions/runs/43387288204, all four jobs green)

- **Do**: One `workflow_dispatch` workflow. Job `resolve`: `actions/checkout` of `1aGh/maude` (`repository:`, `ref: refs/tags/${{ inputs.tag }}`, `fetch-depth: 0`), assert the tag is annotated (`git cat-file -t` → `tag`), `SHA=$(git rev-parse "${tag}^{commit}")`, `node scripts/release-kind.mjs` must say stable and equal `package.json`, both `apps/{cells,render}/wrangler.toml` image tags equal the release, read the live `releaseVersion` from the cells `/health` and refuse a lower version unless `allow_rollback`; outputs `sha`, `version`. Jobs `cells` / `render` / `cloud` (`if: contains(inputs.components, '<name>')`, `needs: resolve`, `environment: production`, `concurrency: deploy-<name>`): checkout `1aGh/maude` at `ref: ${{ needs.resolve.outputs.sha }}`, then the steps carried verbatim from the public workflows — cells: hub wait → build FROM `ghcr.io/1agh/maude-hub:<tag>` → seal → `wrangler containers push` → `wrangler deploy` → `verify-fleet-release.sh` → `collect-v2-convert.mjs`; render: wait for `ghcr.io/1agh/maude-render:<tag>` (public, anonymous pull), resolve its digest, `wrangler containers push` from the digest → `wrangler deploy --var MAUDE_RENDER_VERSION` → roll instances → `/_health` poll; cloud: `node --test` → `wrangler deploy --dry-run` → `wrangler deploy` → `/health` poll. `dry_run=true` stops every lane before its first write (`containers push` / `deploy`). Secrets only via `env:`; `${{ inputs.* }}` and `${{ needs.* }}` go through `env:` too, never spliced into `run:` (audit X7). Drop the `MAUDE_CONTAINERS_TOKEN || CLOUDFLARE_API_TOKEN` fallback (audit W5): cells + render use `MAUDE_CONTAINERS_TOKEN`, cloud uses `CLOUDFLARE_API_TOKEN`. Pin `wrangler` to an exact version (audit X1).
- **Files**: `maude-deploy/.github/workflows/deploy.yml`
- **Pattern**: `.github/workflows/cells-deploy.yml` lines 121–392, `render-deploy.yml` lines 175–280, `cloud-deploy.yml` lines 52–94 — keep their step comments, they are the fleet's institutional memory.
- **Gotcha**: `wrangler containers push` runs from the `apps/cells` / `apps/render` working directory of the **public checkout**; `infra/cell/Dockerfile` context is the public checkout root. The hub/render image waits test existence of the **pinned tag**, never `:latest`.
- **Validate**: `actionlint maude-deploy/.github/workflows/deploy.yml`; `gh workflow run deploy.yml -R 1aGh/maude-deploy -f tag=<current stable tag> -f dry_run=true` → every lane green up to its write gate; the run summary shows the resolved SHA and version.
- **Risk**: deploy

### ✅ Task 3: CREATE the private repo's test lane — completed 2026-11-13 (11 assertions, red on six mutations, `Tests` run green)

- **Do**: `maude-deploy/test/deploy-invariants.test.mjs` with `node:test`: (a) `containers push` / `wrangler deploy` steps are reachable only under `needs: resolve` and never in a job without the `environment`; (b) no `maude-hub:latest` / `maude-render:latest` anywhere under `jobs:`; (c) hub and render images are pinned to `${{ inputs.tag }}`; (d) every `run:` is free of `${{ inputs.` / `${{ needs.` / `${{ secrets.` splices; (e) `dry_run` guards every write step. Copy `parseJobs` from the public `workflow-invariants.test.mjs`. `maude-deploy/.github/workflows/test.yml`: `node --test test/` on push and PR.
- **Files**: `maude-deploy/test/deploy-invariants.test.mjs`, `maude-deploy/.github/workflows/test.yml`, `maude-deploy/package.json` (`"type": "module"`, no deps)
- **Pattern**: `scripts/test/workflow-invariants.test.mjs` lines 150–260
- **Gotcha**: the tests must fail first — temporarily add a `:latest` reference and watch (b) go red before committing (memory `maude-verify-regression-tests-fail-first`).
- **Validate**: `node --test test/` in `maude-deploy` green; the private `test.yml` run green.

### ✅ Task 4: CREATE public `.github/workflows/render-image.yml` and REMOVE the three deploy workflows — completed 2026-11-13 (also removed `cloud-d1-precheck.yml`, which used the fleet token; it lives in `maude-deploy/d1-precheck.yml`; the control-plane tests got their own Node 24 job in `quality.yml` because 32 of them fail on the quality job's Node 22)

- **Do**: `render-image.yml` = `render-deploy.yml` lines 1–172 (prerelease refusal, parse-check, service tests, tag read + assertion, QEMU, ghcr login, multi-arch build + push, manifest-list check), triggered on stable tags only, `permissions: packages: write, contents: read`; keep `workflow_dispatch` with `push: false`. Delete `cells-deploy.yml`, `render-deploy.yml`, `cloud-deploy.yml`. Move `apps/cloud` `node --test "*.test.mjs"` into `quality.yml` next to the data-plane tests (same "a cells change must not trigger a control-plane deploy" comment style). In `render-canary.yml` mask the echoed health body (`::add-mask::` or print only `ok`/`version` fields).
- **Files**: `.github/workflows/render-image.yml` (new), `.github/workflows/{cells-deploy,render-deploy,cloud-deploy}.yml` (deleted), `.github/workflows/quality.yml`, `.github/workflows/render-canary.yml`
- **Pattern**: `hub-image.yml` for the image workflow shape
- **Gotcha**: this commit must land **after** Task 2's dry run is green and **before** the next release tag — never let both pipelines see one tag. `scripts/test/release-channel.test.mjs` and `workflow-invariants.test.mjs` go red on this commit until Task 5 lands; do Tasks 4 + 5 in one commit.
- **Validate**: `actionlint .github/workflows/*.yml`; `node --test scripts/test/*.test.mjs` (after Task 5).

### ✅ Task 5: UPDATE the public tests that pinned the moved workflows — completed 2026-11-13 (test (d) is scoped to the two fleet token names: `site-deploy.yml` keeps its own zone-scoped `CLOUDFLARE_SITE_API_TOKEN` by design)

- **Do**: `scripts/test/release-channel.test.mjs` — replace `cells-deploy.yml` / `render-deploy.yml` in the stable-only list with `render-image.yml`; keep `hub-image.yml`. `scripts/test/workflow-invariants.test.mjs` — remove tests (a) ×3 and (b) `cell image never derives from :latest` / `hub image pinned` (they now live in `maude-deploy/test`); keep `(b) hub-image.yml publishes the tag the cell build pins to` re-worded to "the tag `maude-deploy` pins to", and add one test that no public workflow references `secrets.CLOUDFLARE_` / `secrets.MAUDE_CONTAINERS_` (the regression that would re-introduce a fleet credential here). `scripts/test/verify-fleet-release.test.mjs` and `collect-v2-convert.test.mjs` only mention the workflow in comments — update the comment to name `maude-deploy`.
- **Files**: `scripts/test/release-channel.test.mjs`, `scripts/test/workflow-invariants.test.mjs`, `scripts/test/verify-fleet-release.test.mjs`, `scripts/test/collect-v2-convert.test.mjs`
- **Pattern**: existing test wording in those files
- **Gotcha**: the new "no Cloudflare secret in a public workflow" test must fail first against the pre-Task-4 tree.
- **Validate**: `node --test scripts/test/*.test.mjs`; `scripts/v2-test-lane.sh -- node --test scripts/test/*.test.mjs` if run while other suites may be active.

### ✅ Task 6: UPDATE the release runbook and CLAUDE.md — completed 2026-11-13

- **Do**: `.ai/release-guide.md` § Push: after `git push --follow-tags` add the step `GH_TOKEN=$(gh auth token --user 1aGh) gh workflow run deploy.yml -R 1aGh/maude-deploy -f tag=vX.Y.Z` and `gh run watch -R 1aGh/maude-deploy`; § "Verify the fleet actually rolled" and the rc section: `cells-deploy`/`render-deploy` → the `maude-deploy` run; "a stable tag fires SIX workflows" → the new count (build-binaries, build-desktop, hub-image, render-image, selfhost-images) + the manual dispatch; hotfix of the control plane = `-f components=cloud -f ref=<sha>`. `CLAUDE.md` § "Release flow" step 4 and the rc paragraph: same chain rewrite, plus one line that the three Cloudflare secrets no longer exist in this repo. Add the private repo to the root `~/git/CLAUDE.md` `personal/` table (one row). Append a pending What's New entry? **No** — not user-visible.
- **Files**: `.ai/release-guide.md`, `CLAUDE.md`, `/Users/iagh/git/CLAUDE.md`
- **Pattern**: the existing wording of those sections
- **Gotcha**: `scripts/test/workflow-invariants.test.mjs` test `(c) the release guide still documents the annotated form` reads the guide — keep the annotated-tag sentence intact.
- **Validate**: `node --test scripts/test/workflow-invariants.test.mjs`; `grep -n "cells-deploy\|render-deploy\|cloud-deploy" CLAUDE.md .ai/release-guide.md` returns only historical mentions.

### Task 7: Cutover on the next stable release, then revoke (OPEN — waits for the next stable tag)

- **Do**: Release per the updated runbook; dispatch `maude-deploy` with the tag; confirm `verify-fleet-release.sh`, the render `/_health` version and the cloud `/health` all report the new version from the **private** run. Then `gh secret delete CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|MAUDE_CONTAINERS_TOKEN -R 1aGh/maude`, rotate both tokens in the Cloudflare dashboard (new values into the private environment secrets only), re-run `maude-deploy` with `dry_run=true` to prove the rotated tokens work. Record the cutover in `maude-deploy/README.md` and as a kg decision (`/flow:record-ddr`: the deploy plane moved to a private repo, manual dispatch, ghcr publishes stay public).
- **Files**: `maude-deploy/README.md`; kg decision
- **Gotcha**: do not delete the public secrets before the private run has deployed a real release — the public workflows are already gone (Task 4), so a failed private run means **no** path to the fleet until fixed; keep the `workflow_dispatch` with `allow_rollback` as the recovery lever.
- **Validate**: `gh secret list -R 1aGh/maude` shows no `CLOUDFLARE_*` / `MAUDE_CONTAINERS_*`; the cells `/health` reports the release; `kg search "maude-deploy"` returns the decision.
- **Risk**: deploy

---

## Validation

1. **Static**: `pnpm lint`, `pnpm typecheck` (no TS touched — expected no-op), `node --test scripts/test/*.test.mjs`, `actionlint` on both repos' workflows.
2. **Private dry run**: `deploy.yml` with `dry_run=true` against the current stable tag — all lanes reach their write gate.
3. **Fail-first**: each new test shown red once (Tasks 3, 5).
4. **Manual**: one real release through the private repo; public run list shows no `cells-deploy`/`render-deploy`/`cloud-deploy` run for that tag; private run logs not readable logged-out (open the run URL in a private browser window → 404).

---

## Acceptance Criteria

- [ ] All tasks completed
- [ ] `/flow:validate --fast` passes after each task (Edit-Verify Loop, max 3 iterations)
- [ ] `/flow:validate` passes overall: static (types, lint, format), full tests, build
- [ ] A stable release rolled the fleet, render and cloud from `1aGh/maude-deploy`; `verify-fleet-release.sh` green there
- [ ] `gh secret list -R 1aGh/maude` holds no Cloudflare credential; the three tokens were rotated after the cutover
- [ ] Public tests guard "no Cloudflare secret in a public workflow"; private tests guard tag-only / never-`:latest` / pinned-tag / no-splice / dry-run gates
- [ ] `.ai/release-guide.md` + `CLAUDE.md` describe the new chain; `site/lib/roadmap.json` regenerated
- [ ] No DDR-worthy decision left unrecorded (Task 7 records the move)
