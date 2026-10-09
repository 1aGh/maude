# Release Guide — Maude

> Walked step-by-step by `/flow:release`. Each `##` heading is a step; bash blocks are candidate commands (the slash command confirms before running each).
>
> **Scope:** local prep to trigger the right GitHub Actions. After `git push --follow-tags`, work is handed off to `.github/workflows/build-binaries.yml`, which owns the full release pipeline (create-release → 7-platform matrix → publish-main → populate notes).
>
> **Provider:** changesets · **Package:** `@1agh/maude`
>
> **Ten manifests + seven `optionalDependencies` pins + the cell image tag move in lockstep.** `package.json`, both `plugins/*/.claude-plugin/plugin.json` files, and all seven `packages/maude-*/package.json` files must always share the same `version`. The root's `optionalDependencies` map pins each sub-package at the same version, and `apps/cells/wrangler.toml` names the cell image at `maude-cell:vX.Y.Z` — that tag IS the fleet-rollout instruction (see "Push"). `scripts/bump-version.sh` writes all of them; `scripts/check-version-parity.sh` enforces (the cell tag strictly once it is semver-shaped). `scripts/changesets-version.sh` delegates to `bump-version.sh`, so the changeset flow gets parity for free.
>
> **What publishes how:**
> - **npm — root `@1agh/maude`** (CLI + dev-server source + ai-skeleton templates). Published by `build-binaries.yml > publish-main` after every per-platform sub-package lands.
> - **npm — `@1agh/maude-<slug>` × 7** (per-platform Bun standalone binaries: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl`, `win32-x64`). Published in parallel by `build-binaries.yml > build-binaries` matrix. Pulled in at install time via root's `optionalDependencies`.
> - **GitHub Release** — created empty by `build-binaries.yml > create-release` (so matrix `gh release upload` has a target), then `publish-main` populates the body from `CHANGELOG.md` (auto-generated notes if the section is missing).
> - **Claude Code marketplace** — both plugins (`design`, `flow`) ship via `marketplace.json` read directly from `main`. The moment the release commit is on `main`, end users can `/plugin marketplace update maude`. No separate publish step.
> - **Release candidates (`vX.Y.Z-rc.N`)** — a separate, narrower channel: npm dist-tag `next` + a prerelease GitHub release + the rc desktop feed, and nothing in the cloud. See [§ Release candidates](#release-candidates-prerelease-channel). Every bullet below is about a STABLE `vX.Y.Z` tag.
> - **Maude Cloud fleet** — the same `v*` tag triggers `hub-image.yml` (multi-arch `ghcr.io/1agh/maude-hub:vX.Y.Z` + `:latest`) and `cells-deploy.yml`, which waits for that hub image, builds the cell image at the tag `apps/cells/wrangler.toml` declares (`maude-cell:vX.Y.Z`, written by the bump), pushes it to the Cloudflare registry, and `wrangler deploy`s the data plane. **The tag change is what restarts every cell** — env is applied at container START and Cloudflare only rolls instances on a config change; a re-pushed image under an unchanged tag deploys nothing anywhere (the v30/v31 lesson). Rollout verification is part of the Push step below.
> - **Render service (DDR-230)** — the same tag also triggers `render-deploy.yml`: it builds `maude-render` at the tag `apps/render/wrangler.toml` declares (written by the bump, asserted by parity), publishes it BOTH to ghcr (`ghcr.io/1agh/maude-render:vX.Y.Z` — the self-host sidecar) and the Cloudflare registry, deploys the `maude-render` Worker, and polls `https://render.cloud.maude.sh/_health` until it reports the release version. Same tag-is-the-instruction contract as the cells.

## Pre-flight

- [ ] On `main` with clean working tree (no staged or unstaged changes)
  - If `apps/studio/dist/runtime/*.js` show as modified, that's an accidental dev-mode regen (unminified, ~2× shipped size) — `git restore apps/studio/dist/runtime/`, **never commit it**. The committed bundles are release-authoritative (`MAUDE_SKIP_RUNTIME_BUILD=1` in CI); regen deliberately only after a dep bump.
- [ ] Latest `quality.yml` and `version-parity.yml` are **actually green** on `main` (run `gh run list --workflow=quality.yml --branch=main --limit 1` — don't just assume from memory). A red `quality.yml` masks lurkers that the release commit will surface.
- [ ] At least one `.changeset/*.md` since the previous tag (otherwise the bump is a no-op)
- [ ] You have npm publish permission for `@1agh/maude` + all 7 `@1agh/maude-<slug>` packages, and push access to `main`
- [ ] `NPM_TOKEN` repo secret is set (one-time, only after rotation)
- [ ] 1Password is unlocked AND the SSH key is approved for the session (signing failures mid-tag-move leave the repo in a partial state — see "When things break")
- [ ] **No stray local annotated tags** — `git push --follow-tags --dry-run` must show only the tag you are about to create. A stale local tag from an interrupted release rides along with `--follow-tags` and fires a SECOND release pipeline, whose concurrency group can cancel the real one's `cells-deploy` (the v1.0.12-vs-v1.2.0 incident, 2026-09-04: stray tag pushed, its create-release grabbed "Latest", and the real release's cell run was auto-cancelled). Note `git tag -l <name>` exits 0 even when nothing matches — don't gate on its exit code. If you DO have to cancel a stray tag's runs, a stable tag fires SIX workflows — build-binaries, build-desktop, hub-image, cells-deploy, render-deploy, self-host images (an rc tag fires only the first two) — cancel ALL of them; a missed `build-desktop` run later re-created the deleted release record (its `gh release upload` re-creates the tag too) with partial Windows assets.

```bash
git switch main && git pull --ff-only
git status                                           # working tree clean
gh run list --workflow=quality.yml --branch=main --limit 1
gh run list --workflow=version-parity.yml --branch=main --limit 1
ls .changeset/*.md 2>/dev/null | grep -v README.md   # at least one pending changeset
```

### Config health + quality gates (blocker)

The release walker runs the workspace's own config sanity check, then every declared quality gate — a schema error or a failing gate aborts before the bump (per the `flow:quality-gates` skill, release pre-flight runs **all** gates, no filter):

> When the release being prepared ADDS a new config-schema key that this repo's own `.ai/workflows.config.json` already uses, the globally installed `maude` validates against its bundled (previous-release) schema and false-positives. Fall back to the working-tree CLI: `node cli/bin/maude.mjs doctor --json`.

```bash
# Step 1: config schema must be clean
maude doctor --json | jq -e '.summary.schemaErrors == 0' >/dev/null \
  || { echo "::error::config schema errors — run \`maude doctor --fix\`"; exit 1; }

# Step 2: every declared quality gate (format/lint/typecheck/tests/build, …) in order
for gate in $(jq -r '.quality | keys[]' .ai/workflows.config.json); do
  cmd=$(jq -r ".quality[\"$gate\"]" .ai/workflows.config.json)
  echo "→ $gate: $cmd"
  eval "$cmd" || { echo "::error::release pre-flight: $gate gate failed (\`$cmd\`)"; exit 1; }
done
```

## Author changesets (optional — usually done during feature work)

Skip this step if `.changeset/` already has at least one non-README `.md`. Otherwise, for each user-facing change since the last release:

```bash
pnpm changeset
```

The wizard asks for bump kind and a short summary, writes `.changeset/<slug>.md`. Commit that file as part of the PR that introduced the change — not at release time.

**Bump-kind rule of thumb:**
- `patch` — bug fixes, doc-only changes, internal refactors, CLI flag tweaks that stay backwards-compatible.
- `minor` — new commands/skills/agents, new `maude` subcommands, new config keys with safe defaults.
- `major` — removed/renamed commands or config keys, breaking CLI flag changes, dev-server protocol break.

## Bump

Consume pending changesets and propagate the new version to all ten manifests + the seven `optionalDependencies` pins:

```bash
pnpm run changeset:version
```

> The script: (1) `pnpm changeset version` consumes `.changeset/*.md`, bumps `package.json`, regenerates `CHANGELOG.md`. (2) Delegates to `scripts/bump-version.sh "$NEW"` which writes the new version to every manifest and every `optionalDependencies` pin. (3) Runs `scripts/check-version-parity.sh` as the safety net. Don't use bare `pnpm version` — pnpm 11 reserves that name for its built-in command.

Capture the new version and review the diff:

```bash
git diff --stat
node -p "require('./package.json').version"
```

## Biome reformat sweep

> **Why this step exists:** `scripts/bump-version.sh` writes JSON via `JSON.stringify(j, null, 2)`, which expands small arrays (`"os"`, `"cpu"`, `"libc"`, `"files"`) onto multiple lines. Biome's formatter prefers them inline for the sub-package manifests. Without this step, the release commit lints clean locally but `quality.yml` fails CI on every sub-package. This bites every bump until `bump-version.sh` learns biome's JSON formatter conventions.

```bash
pnpm biome check --fix
pnpm lint                                            # confirm clean
```

> **Eyeball what `--fix` touched beyond the manifests** (`git status --short`). Biome's "safe" fixes are not always behavior-safe: `useArrowFunction` rewrote a test's `function () {}` constructor mocks into arrow functions (not constructible — 3 tests silently broke, 2026-09-04). If the sweep fixed any non-manifest file, re-run that file's tests or revert the file — the rule is warning-level, so reverting keeps lint green.

After `pnpm run changeset:version`, re-run the `format` + `lint` gates. **If only `format` errors remain**, the bump expanded the sub-package arrays (the `JSON.stringify` mechanism above) — apply the format-fix and re-stage:

```bash
pnpm biome format --write .                          # fix the expanded arrays
```

**Any other gate failure is real debt** that should have been caught upstream by the Pre-flight gate loop — abort the release and triage it outside the release flow. Don't `--fix` your way past a `lint`/`typecheck`/`tests`/`build` failure at release time.

## Pre-push smoke

Always run. `pnpm changeset version` regularly surfaces stale generated artefacts (e.g. `site/lib/stats.json` derived from `package.json.version`) that CI drift checks flag:

```bash
pnpm lint
pnpm test
pnpm --filter @maude/site gen:stats              # refresh derived stats
pnpm --filter @maude/site gen:reference          # refresh derived reference docs
pnpm --filter @maude/site gen:roadmap            # refresh roadmap from .ai/plans + STATE.md
pnpm --filter @maude/site gen:whatsnew           # refresh the site whats-new mirror — the bump STAMPS apps/studio/whats-new.json, so this drifts on every release (missing here until v1.2.0 turned quality.yml red)
git diff --stat site/                                # capture any drift to commit
```

The committed dev-server artifacts ship verbatim (`publish-main` builds with `MAUDE_SKIP_RUNTIME_BUILD=1`), so verify `client.bundle.js` + `styles.css` + `comment-mount.js` aren't stale against source — a studio-client commit that forgot the release-minified rebuild otherwise ships without its own change (bit v0.40.x: the committed bundle lagged source by several commits):

```bash
(cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release)
git diff --stat apps/studio/dist/                    # any diff = committed artifact was stale; stage it
```

If the generators or the artifact rebuild produced diffs, stage them with the release commit (next step).

## Commit + annotated tag

Stage everything the bump and the smoke step touched, then commit and tag.

```bash
VER=$(node -p "require('./package.json').version")
git add package.json \
        pnpm-lock.yaml \
        plugins/design/.claude-plugin/plugin.json \
        plugins/flow/.claude-plugin/plugin.json \
        packages/maude-*/package.json \
        apps/cells/wrangler.toml \
        apps/render/wrangler.toml \
        apps/desktop/src-tauri/tauri.conf.json \
        apps/desktop/src-tauri/Cargo.toml \
        apps/desktop/src-tauri/Cargo.lock \
        apps/studio/dist/ \
        apps/studio/whats-new.json \
        apps/studio/package.json \
        apps/hub/package.json \
        CHANGELOG.md \
        .changeset/ \
        site/lib/stats.json \
        site/lib/roadmap.json \
        site/content/docs/config-schema.mdx
git status                                           # eyeball — no surprise additions
git commit -m "chore: release v${VER}"
git tag -a "v${VER}" -m "v${VER}"
```

> `apps/studio/package.json` + `apps/hub/package.json` are in that list because
> `bump-version.sh` writes the version into them (they are the manifests a RUNNING
> studio / hub process reads its own version from) **and**
> `check-version-parity.sh` asserts them. They were missing here through v1.0.0 —
> the release commit would have shipped two manifests still claiming the previous
> version, and the parity gate would have caught it in CI rather than at the
> `git add`.

> **Annotated tag (`-a -m`) is required** — `git push --follow-tags` only pushes annotated tags. A lightweight `git tag v${VER}` will silently stay local and `build-binaries.yml` never fires.

> **Hotfix path (no changesets):** if you need to bump without authoring changesets first, use `scripts/bump-version.sh patch|minor|major|X.Y.Z` instead of `pnpm run changeset:version`. It bumps every manifest + pin without touching `CHANGELOG.md`; the release step falls back to auto-generated notes when the `## X.Y.Z` section is missing.

## Push — CI takes over from here

```bash
git push --follow-tags
```

The `v*.*.*` tag triggers `.github/workflows/build-binaries.yml`, which:

1. **`create-release`** — creates an empty GitHub Release (so matrix uploads have a target).
2. **`build-binaries`** (7-platform matrix) — `bun build --compile --target=<platform>` produces a Bun standalone binary; smoke-tests it; `npm publish --access public --provenance` the matching `@1agh/maude-<slug>` sub-package (idempotent — 409 "already published" is treated as success); uploads the binary to the GitHub Release as an asset.
3. **`desktop-gate`** (since v1.0.0's gate set) — waits for `build-desktop.yml` to conclude **for this exact SHA** and fails the release if it did not succeed. It exists because the two gates that catch a packaged app which installs cleanly and then opens to an empty window — `check-bundle-completeness --smoke` (DDR-177) and `check-client-boots` (the v0.51.1 blank window) — live in that other workflow, on the same tag. Two workflows racing meant npm could publish before either had run; a gate the thing it guards can finish ahead of is not a gate. GitHub has no cross-workflow `needs:`, so this job asks the API instead. **Timing out is a refusal, not a pass.**
4. **`publish-main`** (after the full matrix **and** `desktop-gate` succeed) — installs with `--no-frozen-lockfile` (the lockfile cannot enumerate per-platform sub-packages that don't exist on npm until the matrix publishes them); verifies parity; `pnpm build`; verifies tarball shape; `npm publish` the root tarball (idempotent); populates the GitHub Release body from CHANGELOG.md.

> **Break glass.** `workflow_dispatch` on `build-binaries.yml` takes a `skip-desktop-gate` input that publishes without waiting. Use it only when a desktop build genuinely cannot run (macOS runner outage), never to get past a red gate — a red gate is the gate working. The skip is written into the job summary with the actor and SHA, so it is a recorded decision rather than a silent one.
>
> **Known, accepted gap:** the per-platform `@1agh/maude-<slug>` sub-packages are published by the matrix *before* `desktop-gate` runs. A refused release therefore leaves the sub-packages on npm with no matching root tarball. That is inert — `npm i -g @1agh/maude` resolves the ROOT, which is what the gate protects — and the next tag's matrix republishes them idempotently.

The same tag also fires the **cloud rollout chain**: `hub-image.yml` (ghcr hub image) → `cells-deploy.yml` (cell image at the wrangler.toml tag, data-plane deploy, instance restart) → and, independently, `render-deploy.yml` (maude-render image to ghcr + Cloudflare, Worker deploy, `/_health` version poll). And `build-desktop.yml` for the native app.

Watch all of them — a release is not done while any is red or running:

```bash
gh run list --workflow=build-binaries.yml --limit 1
gh run list --workflow=hub-image.yml --limit 1
gh run list --workflow=cells-deploy.yml --limit 1
gh run list --workflow=build-desktop.yml --limit 1
gh run view --web                                    # or open https://github.com/1aGh/maude/actions
```

After `publish-main` is green:

```bash
gh release view "v$(node -p "require('./package.json').version")"
npm view @1agh/maude version                     # confirm npm sees the new root
```

### Verify the fleet actually rolled

**Since v0.57.0, `cells-deploy` green means "a live cell answered with THIS release".** The workflow's last step polls a real tenant cell's `/health` until `releaseVersion` equals the tag it just deployed **and** the reported `client.bundle.js` hash equals the seal it read out of the image it pushed (`scripts/verify-fleet-release.sh`). The two are not redundant: the hash catches "same tag, different bytes", and only the version catches "the layer underneath was built from the previous release" — the v0.57.0 failure, whose image was internally self-consistent. Also since then, **only a release tag touches the fleet** — a push to `main` runs the data-plane tests and stops. That includes `wrangler deploy`: `wrangler.toml` names the container image, so a deploy reconciles the container config, and on the release commit it fails with `IMAGE_REGISTRY_DOESNT_CONTAIN_IMAGE` because only the tag run builds that image (learned in v0.58.0). Use `workflow_dispatch` for an urgent fleet change between releases.

That covers what used to be manual curl-ing. What it still cannot cover is the browser: a botched env derivation once produced a fleet that was green in CI and unusable in a browser (v30, `frame-ancestors` from the waking request's Host). So finish with the live checks — the first two are now belt-and-braces, the third is the one that matters:

```bash
# The cell answers (repeat until 200 — cold start can take minutes):
curl -s -o /dev/null -w "%{http_code}\n" https://alligators.cloud.maude.sh/health

# The canvas origin answers as itself (401 JSON without a capability is CORRECT):
curl -s -o /dev/null -w "%{http_code}\n" https://canvas-alligators.cloud.maude.sh/

# The one thing curl cannot prove: open the project in a BROWSER and confirm a
# canvas iframe renders (not "refused to connect") — that exercises the render
# token, the capability cookie, and frame-ancestors in one look.
```

If the GitHub Release shows `draft: true` (happens when the tag was force-moved during a retry cycle), publish it:

```bash
gh release edit "v$(node -p "require('./package.json').version")" --draft=false
```

## Release candidates (prerelease channel)

> **Skip this step for a stable release.** It is the whole runbook for a `vX.Y.Z-rc.N` tag, which goes through every step above (pre-flight, bump, smoke, commit + annotated tag, push) with the differences below. Built in V2-2.0 (T21′); the first planned use is `v2.0.0-rc.1` after the v2 branch is merged (V2-8.12).

**The grammar is `X.Y.Z` or `X.Y.Z-rc.N` (N ≥ 1) — nothing else.** `-beta.1`, `-rc.0`, build metadata and leading zeros are refused by `scripts/bump-version.sh`, by `scripts/check-version-parity.sh`, and by `scripts/release-kind.mjs`, which the release workflows run. The workflows only know how to ship an rc, so a tag outside the grammar is refused rather than half-shipped.

**Bump** (`pnpm run changeset:version` works too — changesets' own pre mode writes `X.Y.Z-rc.N` — but the script is the direct path):

```bash
scripts/bump-version.sh 2.0.0-rc.1     # start an rc line — explicit, because only you know whether it is a patch, minor or major
scripts/bump-version.sh rc             # 2.0.0-rc.1 → 2.0.0-rc.2
scripts/bump-version.sh promote        # 2.0.0-rc.2 → 2.0.0 — the STABLE release, an ordinary release from here on
```

`patch|minor|major` are refused while package.json is on an rc (ambiguous — name the version, `rc`, or `promote`). An rc bump moves every manifest in lockstep exactly like a stable one (npm, plugins, sub-packages + pins, the two app manifests, `tauri.conf.json`, `Cargo.toml` + `Cargo.lock`) and rebuilds the client bundle at the rc version, **with two deliberate exceptions**:

- **`apps/cells/wrangler.toml` and `apps/render/wrangler.toml` keep their last STABLE image tags.** Those tags are the fleet instruction; an rc never rolls the fleet, so an rc-named tag there would be an instruction nothing runs — until a manual `workflow_dispatch` rolled production onto rc code. `check-version-parity.sh` accepts a stable tag beside an rc package version and **refuses an rc tag there**. `promote` rewrites both, as every stable bump does.
- **Pending What's New entries stay pending.** rc testers see them labelled "next"; the stable release stamps them, so the release most users install still announces them.

**What an rc tag runs — and what it never touches:**

| Workflow | Stable `vX.Y.Z` | `vX.Y.Z-rc.N` |
| --- | --- | --- |
| `build-binaries.yml` | npm `latest` + GitHub release (becomes Latest) | npm **`next`** (root + 7 sub-packages) + **prerelease** GitHub release |
| `build-desktop.yml` | installers + updater artifacts on the release | same, on the prerelease; Windows MSI ProductVersion `X.Y.Z.N` (WiX refuses `-rc.N`) |
| `hub-image.yml` | `maude-hub:vX.Y.Z` + `:latest` | **does not run** |
| `cells-deploy.yml` | rolls the cloud fleet | **does not run** |
| `render-deploy.yml` | deploys render | **does not run** |
| `selfhost-images.yml` | multi-arch gate | **does not run** |

The split is the tag filters (stable workflows: `['v*.*.*', '!v*.*.*-*']`; the two rc-capable ones add `'v*.*.*-rc.*'` — GitHub applies the patterns in order and the last match decides), a step in each stable-only workflow that refuses a prerelease tag anyway, and the `classify` answer (`scripts/release-kind.mjs`: from the tag, which must equal package.json) that every publish step reads. `scripts/test/release-channel.test.mjs` asserts all three; `workflow_dispatch` on `build-binaries.yml` with `dry-run: true` from a branch whose package.json is on an rc prints the plan and runs `npm publish --dry-run --tag next` without publishing anything.

**Who gets it:**

- **npm:** only `npm i -g @1agh/maude@next` (or `@2.0.0-rc.1`). `npm i -g @1agh/maude` stays on `latest`, and the CLI's update notice reads `latest`, so stable users are never nudged onto an rc.
- **Desktop:** the updater feed (`site/lib/updater-feed.mjs`, behind `maude.sh/releases/…`) follows the INSTALLED version. A stable install is offered only stable releases — by GitHub's prerelease flag and by version string, so a mis-flagged rc still cannot reach it. An install on an rc is offered the newest rc, then the stable release that supersedes it (`2.0.0` > `2.0.0-rc.N` by semver precedence), at which point it is stable again. Getting onto the rc channel is a manual download of the rc installer from the prerelease's assets.
- **Claude Code marketplace:** the plugins ship from `main` — **an rc bump committed to `main` IS what marketplace users get.** That is the one surface this channel does not split. Cut the rc only once the plugins on `main` are fit for every user (V2-8.12 does it after the merge, which is the point at which they already are).
- **The site:** `site/lib/stats.json` (home-page version label) regenerates from package.json, so it shows the rc while `main` is on one. Cosmetic; known.

**Verify an rc:** `gh release view vX.Y.Z-rc.N --json isPrerelease` → `true`; `npm view @1agh/maude dist-tags` → `next` is the rc, `latest` unchanged; no `hub-image` / `cells-deploy` / `render-deploy` / `selfhost-images` run exists for the tag's SHA (`gh run list --workflow cells-deploy.yml --limit 3`). Nothing to verify in the fleet — it was not touched.

**Promote:** `scripts/bump-version.sh promote` → the stable release, through every step above as an ordinary release (it rolls the fleet, moves `latest`, stamps What's New). rc installs pick it up through the feed; `next` can stay where it is (`npm dist-tag add @1agh/maude@X.Y.Z next` if you want `@next` to stop lagging).

**Known gaps:** a Linux `.deb` built at `X.Y.Z-rc.N` sorts ABOVE `X.Y.Z` for dpkg (the part after `-` is a Debian revision) — the `.deb` does not self-update and a manual `dpkg -i` of the stable one only warns, but a future apt repo would need `X.Y.Z~rc.N`. A 1.x maintenance release while `main` is on an rc would have to be cut from a branch; there is no recipe for that yet.

## When things break

### Tag pushed, `build-binaries.yml` matrix has 1+ failed cells

The matrix is `fail-fast: false` — other cells continue. Pull the failed job logs:

```bash
gh run view <RUN_ID> --log-failed | tail -100
```

Common failures + recovery:

- **`macos-13` runner queued for 15+ min with no assignment** — capacity issue, runner is being deprecated. Already migrated to `macos-14` cross-compile (`--target=bun-darwin-x64`); shouldn't recur. If it does, swap the matrix entry and force-move the tag (see below).
- **`win32-x64` binary not produced (`maude-windows-x64.exe` vs `maude-win32-x64.exe`)** — slug mismatch between `bun --target` naming and Node's `process.platform`. Already fixed in `build.ts` `platformSlug()`. Should not recur.
- **Alpine container fails "JavaScript Actions in Alpine containers only supported on x64 Linux runners"** — JS actions can't run inside alpine on arm64. Already fixed by cross-compiling musl from regular ubuntu runners. Should not recur.
- **Network flake on `npm publish`** — re-run the failed job from the Actions UI; the matrix step is idempotent (409 conflict treated as success).

### `hub-image.yml` or `cells-deploy.yml` failed — the fleet stayed on the previous release

This is the FAIL-SAFE shape: `cells-deploy` waits for the hub image and asserts the
wrangler.toml tag matches the release, so a broken half never rolls anything — the
fleet keeps serving the previous image. npm/marketplace users are unaffected (their
channels published independently). Recovery:

```bash
gh run view <RUN_ID> --log-failed | tail -60         # find the real error
# land the fix on main, then force-move the tag (see below) — the re-fired
# chain absorbs the already-published npm halves via 409-idempotence and
# rebuilds the images from the fixed commit.
```

Known instances of this class: the v0.54.0 hub image failed on a studio file the
Dockerfile's bundler stage didn't copy (`repo-lock.ts` — the stage copies studio
files one by one; when a borrowed file grows an import, copy the import too).

### The fleet rolled but a cell still behaves like the OLD release (env-shaped symptoms)

A container-config rollout (the image-tag change) replaces the instance with the
new IMAGE but **replays the stored env spec** from whenever the Durable Object
last `start()`ed it — it does not recompute `cellEnv`. So a release reliably
ships new *code*, while a change to the env *derivation* (Worker-side
`cell-config.mjs`) only takes effect after a full stop → request-driven start.
Learned the hard way on v0.54.0: the `HUB_PUBLIC_URL` fix was deployed, the v31
restart-roll "succeeded", and the fresh instance still served `frame-ancestors`
from the poisoned value.

To force a clean env recompute, in order of preference:

```bash
# 1. The sanctioned restart (needs CELL_SECRET_MASTER):
#    POST https://<tenant>.<zone>/_cell/restart  with  Authorization: Bearer <deriveSecret(master, tenant)>
# 2. Zero-credential fallback: let it idle-sleep (sleepAfter=20m) — close every
#    tab (canvas tabs count!), stop probing /health, wait ~25 min, then ONE
#    request wakes it through the current Worker and env is recomputed.
```

`wrangler containers` has no instance-level kill (only application delete — do
NOT), and `wrangler cloudchamber *` needs a scope the OAuth login doesn't carry.
Follow-up on file: an env-hash drift-restart in the DO would close this class.

### `publish-main` failed after the matrix succeeded

The 7 per-platform sub-packages are already on npm at the new version. Re-run `publish-main` only:

```bash
gh run view <RUN_ID>                                 # find publish-main job ID
gh run rerun <RUN_ID> --failed
```

`publish-main` is idempotent: if the root was already published, the step treats 409 as success and moves on to populate Release notes.

### Tag pushed but `build-binaries.yml` never fired

Means a lightweight tag was pushed instead of annotated. Recover:

```bash
VER=$(node -p "require('./package.json').version")
git tag -d "v${VER}"
git push origin ":refs/tags/v${VER}"                 # delete remote
git tag -a "v${VER}" -m "v${VER}"                    # annotated this time
git push origin "v${VER}"
```

### GitHub Release is stuck in `draft: true`

Happens when the tag was force-moved one or more times during a retry cycle — the original release record gets orphaned. The Release exists with the correct name and tag association but the `draft` flag is still set:

```bash
gh release edit "v$(node -p "require('./package.json').version")" --draft=false
```

### Force-move the tag to retry from a fixed commit

Sometimes a CI bug is found mid-release after some sub-packages already published. Bumping the version just to re-trigger CI is wasteful; force-moving the tag re-triggers `build-binaries.yml` and the idempotent publish steps absorb the already-published sub-packages.

```bash
git push origin main                                  # land the CI fix first
VER=$(node -p "require('./package.json').version")
git tag -d "v${VER}"
git push origin ":refs/tags/v${VER}"                 # delete remote tag
git tag -a "v${VER}" -m "v${VER}"                    # recreate at new HEAD
git push origin "v${VER}"
```

> The GitHub Release record may go into `draft: true` after a force-move — see above for the `gh release edit --draft=false` recovery.

### npm publish succeeded but the release is broken and needs to come down

- Within 72h npm allows `npm unpublish @1agh/maude@X.Y.Z` (non-popular packages only).
- Prefer `npm deprecate @1agh/maude@X.Y.Z "<reason>"` first — keeps the version in the registry as an audit trail and warns installers, without breaking lockfiles that already pinned it.
- If only some of the 7 sub-packages published (partial release), deprecate the published ones with a message pointing at the next patch release.
- **Do not delete the git tag from GitHub** — fix forward with the next patch release. The tag is the audit trail for what was attempted.

### Version parity check fails locally on `main` after merge

A PR slipped through that touched some manifests but not all ten. Re-sync:

```bash
scripts/bump-version.sh "$(node -p "require('./package.json').version")"   # idempotent
pnpm biome check --fix                                                     # reformat sub-package arrays
git diff --stat                                                            # eyeball
git commit -am "chore: re-sync manifests to v$(node -p 'require(\"./package.json\").version')"
git push
```

### 1Password SSH agent refuses signing mid-tag-move

If 1Password locks mid-sequence (commit succeeds, push or tag-push fails), the repo can end up with:
- New commit local but not remote.
- Local tag deleted but remote tag still at old commit.

Recovery: unlock 1Password, then chain the whole sequence with `&&` so a failure stops cleanly mid-way (no partial state). Example for retrying after a failed bun-setup commit:

```bash
git commit -m "<message>" && \
  git push origin main && \
  git tag -d "v${VER}" && \
  git push origin ":refs/tags/v${VER}" && \
  git tag -a "v${VER}" -m "v${VER}" && \
  git push origin "v${VER}"
```

### Vercel deployment failed with `ERR_PNPM_OUTDATED_LOCKFILE`

Same root cause as CI: Vercel defaults to `pnpm install --frozen-lockfile`, incompatible with the `optionalDependencies` bootstrap pattern. Already pinned to `--no-frozen-lockfile` via repo-root `vercel.json`. If Vercel ever loses that override, re-add:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "installCommand": "pnpm install --no-frozen-lockfile"
}
```
