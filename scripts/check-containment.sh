#!/usr/bin/env bash
# Containment invariant — the CI half of DDR-193 §2's "enforced, not asserted".
#
#   > No tenant-authored TSX is ever evaluated by vendor-operated compute.
#
# The boot-assert (apps/studio/workspace-mode.ts) catches a cell that would
# START with a forbidden surface reachable. This catches the change that would
# make that possible, at review time, where it is cheap.
#
# Two checks:
#   1. The forbidden-surface vocabulary in workspace-mode.ts has not silently
#      shrunk. Deleting an entry is how this invariant would actually be lost —
#      not by someone arguing against it, but by a refactor quietly dropping a
#      line while every test stays green.
#   2. The cell image does not ship a browser automation dependency. A cell that
#      HAS Playwright is one import() away from rendering tenant content, so the
#      cheapest place to hold the line is the dependency list.
#
# Exits non-zero with an explanation. Never "fixes" anything.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MODULE="apps/studio/workspace-mode.ts"
fail=0

if [ ! -f "$MODULE" ]; then
  echo "FAIL: $MODULE is missing — the containment boot-assert is gone (DDR-193 §2)." >&2
  exit 1
fi

# ---- 1. the vocabulary must still name every forbidden surface --------------
#
# DDR-209 A'1 split this in two. FORBIDDEN entries are absent from a cell.
# SANDBOXED entries are PRESENT AND ATTESTED — a cell serves the canvas shell
# and the vendor runtime bundles, because the member's BROWSER is what evaluates
# — but only while the out-of-process build sandbox is armed. Both lists are
# asserted here, and so is the arming, because "moved to the other list" must
# never be a way to quietly stop checking something.
#
# NOT `/_api/photo-edit`. It was on this list, and it never fit the rationale:
# the route validates and STORES a JSON sidecar (`assets/<sha8>.photo.json`) —
# the decoding it was blamed for happens in the member's own browser
# (PhotoPreviewBridge), the same division of labour that makes `/_canvas-shell`
# servable at all. Withholding it meant photo edits could not be saved in the
# cloud, reported as "photo editing doesn't work". Reclassified deliberately in
# `98a4c5ad`, which updated `workspace-mode.ts` and the hub manifest but not
# this script — so the gate was red on the branch until the v1.0.0 A7 sweep.
# Removing an entry here is a DDR-shaped decision, not a way to quiet a failure.
REQUIRED_PREFIXES=(
  "/_api/export"
  "/_api/generate"
  "/_api/shell-shot"
  "/_ws/acp"
  # The secret-bearing surfaces, named by Cloud Phase 27 D1. DDR-123's "claude
  # never on our infra" is a fact only while these are unreachable in a cell.
  "/_api/acp"
  "/_api/claude"
  "/_api/cloud"
  "/_api/github"
  "/_api/hub"
  "/_api/debug-bundle"
  "/_api/design"
)
for prefix in "${REQUIRED_PREFIXES[@]}"; do
  if ! grep -qF "'$prefix'" "$MODULE"; then
    echo "FAIL: '$prefix' is no longer in FORBIDDEN_ROUTE_PREFIXES ($MODULE)." >&2
    echo "      A workspace cell must not expose it — see DDR-193 §2 / DDR-209." >&2
    echo "      If a feature genuinely needs it, Direction B is its hard prerequisite," >&2
    echo "      not a deletion here." >&2
    fail=1
  fi
done

REQUIRED_SANDBOXED=(
  "/_canvas-shell"
  "/_canvas-runtime"
)
for prefix in "${REQUIRED_SANDBOXED[@]}"; do
  if ! grep -qF "'$prefix'" "$MODULE"; then
    echo "FAIL: '$prefix' is in NEITHER containment list ($MODULE)." >&2
    echo "      DDR-209 A'1 permits a cell to serve it only under an asserted" >&2
    echo "      contract. Dropping it from SANDBOXED_ROUTE_PREFIXES makes it" >&2
    echo "      unconditionally reachable, which is strictly weaker than before." >&2
    fail=1
  fi
done

# The sandboxed list is worth nothing without the contract it is conditional on.
if ! grep -qF "SANDBOXED_ROUTE_PREFIXES" "$MODULE"; then
  echo "FAIL: SANDBOXED_ROUTE_PREFIXES is gone from $MODULE (DDR-209 A'1)." >&2
  fail=1
fi
if ! grep -qF "sandboxArmed" "$MODULE"; then
  echo "FAIL: $MODULE no longer takes the sandboxArmed attestation." >&2
  echo "      The canvas surfaces would then be permitted unconditionally." >&2
  fail=1
fi
if ! grep -qF "sandboxArmed: SANDBOX_ARMED" apps/studio/server.ts; then
  echo "FAIL: apps/studio/server.ts no longer PASSES the sandbox attestation." >&2
  echo "      An attestation nobody supplies defaults to false and would refuse" >&2
  echo "      every cell boot — or, worse, gets 'fixed' by hardcoding true." >&2
  fail=1
fi

REQUIRED_MODULES=(playwright playwright-core puppeteer puppeteer-core)
for mod in "${REQUIRED_MODULES[@]}"; do
  if ! grep -qF "'$mod'" "$MODULE"; then
    echo "FAIL: '$mod' is no longer in FORBIDDEN_MODULES ($MODULE)." >&2
    fail=1
  fi
done

# The assert must still be CALLED. A module that defines the rule but is never
# invoked is the most plausible way this rots.
if ! grep -q "assertContainment" apps/studio/server.ts; then
  echo "FAIL: apps/studio/server.ts no longer calls assertContainment()." >&2
  echo "      The boot-assert is defined but never runs." >&2
  fail=1
fi

# ---- 2. no browser automation in the cell's runtime dependencies ------------
# devDependencies are fine — the desktop E2E harness and the screenshot fallback
# legitimately use Playwright on a DEVELOPER's machine. The cell ships runtime
# deps only.
for manifest in package.json apps/studio/package.json apps/hub/package.json; do
  [ -f "$manifest" ] || continue
  hits=$(node -e '
    const fs = require("node:fs");
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const runtime = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
    const banned = ["playwright", "playwright-core", "puppeteer", "puppeteer-core"];
    console.log(banned.filter((b) => b in runtime).join(" "));
  ' "$manifest")
  if [ -n "$hits" ]; then
    echo "FAIL: $manifest lists browser automation as a RUNTIME dependency: $hits" >&2
    echo "      A workspace cell that ships a browser is one import() from rendering" >&2
    echo "      tenant-authored TSX (DDR-193 §2). Move it to devDependencies." >&2
    fail=1
  fi
done

# ---- 2b. no browser TRANSITIVELY, either ----------------------------------
# The manifest check above only sees DIRECT dependencies, and that is not where
# this actually goes wrong. Found for real: dependabot PR #66 bumps
# `dom-to-pptx` (a runtime dependency of apps/studio) from 1.x to 2.x, and 2.x
# pulls `puppeteer` in as a real dependency — putting a browser inside the
# workspace's production closure with nothing in the manifests to show for it.
# The Vercel build failed on `ERR_PNPM_IGNORED_BUILDS: puppeteer@25.4.0`, which
# is the only reason anyone noticed.
#
# Scoped to the two packages that actually ship into a cell. The docs site
# legitimately reaches Playwright through Next's peer graph and is irrelevant
# here — a broader check would be noise, and a noisy gate gets disabled.
if command -v pnpm >/dev/null 2>&1; then
  for pkg in puppeteer puppeteer-core playwright playwright-core; do
    for scope in "@maude/hub" "@maude/dev-server"; do
      if pnpm why "$pkg" --prod --filter "$scope" 2>/dev/null | grep -qE "^${pkg}@"; then
        echo "FAIL: '$pkg' is reachable from $scope's PRODUCTION dependencies." >&2
        echo "      Not necessarily as a direct dep — check the transitive path:" >&2
        echo "        pnpm why $pkg --prod --filter $scope" >&2
        echo "      A cell that can reach a browser is one import() from rendering" >&2
        echo "      tenant-authored TSX (DDR-193 §2)." >&2
        fail=1
      fi
    done
  done
else
  echo "note: pnpm not on PATH — skipped the transitive browser check" >&2
fi

# ---- 3. the CELL IMAGE must not be able to render at all ------------------
# A cell that merely *chooses* not to render is one config mistake from
# rendering. A cell with no browser in it cannot, whatever the config says — so
# the image is where the strongest version of this invariant lives.
CELL_DOCKERFILE="infra/cell/Dockerfile"
CELL_ENTRYPOINT="infra/cell/entrypoint.sh"
if [ -f "$CELL_DOCKERFILE" ]; then
  for browser in playwright puppeteer chromium chrome firefox; do
    # Match INSTALL directives only — the file legitimately names these in the
    # comment explaining why they are absent, and in the entrypoint's own check.
    if grep -iE '^\s*(RUN|COPY|ADD).*'"$browser" "$CELL_DOCKERFILE" >/dev/null 2>&1; then
      echo "FAIL: $CELL_DOCKERFILE installs '$browser'." >&2
      echo "      A tenant cell must not be able to render tenant-authored TSX" >&2
      echo "      (DDR-193 §2). Rendering happens on a member's own machine." >&2
      fail=1
    fi
  done

  if [ ! -f "$CELL_ENTRYPOINT" ]; then
    echo "FAIL: $CELL_ENTRYPOINT is missing — the cell's boot-assert is gone." >&2
    fail=1
  else
    # The entrypoint must still CHECK at boot. An image can be hand-modified and
    # a base image can change under us, so the cheap re-check has to survive.
    if ! grep -q 'containment' "$CELL_ENTRYPOINT"; then
      echo "FAIL: $CELL_ENTRYPOINT no longer performs a containment check at boot." >&2
      fail=1
    fi
    # And it must refuse to start on an empty rehydrate. A cell that starts
    # empty looks exactly like a brand-new project, and autosave would commit
    # that emptiness over real work.
    if ! grep -q 'Refusing to start with an empty working set' "$CELL_ENTRYPOINT"; then
      echo "FAIL: $CELL_ENTRYPOINT no longer refuses to start after a failed rehydrate." >&2
      echo "      An empty working set is indistinguishable from a deleted project," >&2
      echo "      and autosave would commit the emptiness over real work." >&2
      fail=1
    fi
  fi
fi

# ---- 4. the BUILD SANDBOX keeps its bounds (Cloud Phase 25 A1) ------------
#
# A0 amended what a cell may do — it BUILDS a tenant's canvas now — and left
# the invariant it may not: nothing here evaluates tenant code, and no browser
# enters the image (checks 2 and 3 above are unchanged and still the strongest
# line). What is NEW is that a bundler touches the filesystem on our compute,
# so the properties that make that safe are asserted here rather than trusted:
# an import allowlist, ceilings, and an empty child environment.
#
# The failure mode this exists for is not an argument — it is a refactor that
# drops `restrictImportsTo` while every test stays green, because the desktop
# (which passes no such option) would not notice.
SANDBOX_HOST="apps/studio/canvas-build-sandbox.ts"
SANDBOX_ENGINE="apps/studio/canvas-build.ts"
if [ -f "$SANDBOX_HOST" ]; then
  for needle in "BUILD_TIMEOUT_MS" "BUILD_RSS_LIMIT_MB" "workerEnv"; do
    if ! grep -qF "$needle" "$SANDBOX_HOST"; then
      echo "FAIL: $SANDBOX_HOST no longer references '$needle'." >&2
      echo "      The cell's build sandbox must keep its import allowlist, its" >&2
      echo "      wall-clock and memory ceilings, and its empty child environment" >&2
      echo "      (Cloud Phase 25 A1)." >&2
      fail=1
    fi
  done
  # The child must NOT inherit the parent environment: every secret in a cell
  # is an env var, and `...env` here would hand them to a process that parses
  # tenant-authored source.
  if grep -qE '^\s*env: \{ \.\.\.(process\.)?env' "$SANDBOX_HOST"; then
    echo "FAIL: $SANDBOX_HOST spreads the parent environment into the build child." >&2
    echo "      HUB_SECRET, MAUDE_PROJECT_TOKEN_KEY and the tenant's storage" >&2
    echo "      credentials all live there (Cloud Phase 25 A1)." >&2
    fail=1
  fi
fi
if [ -f "$SANDBOX_ENGINE" ] && ! grep -qF "importAllowlist" "$SANDBOX_ENGINE"; then
  echo "FAIL: $SANDBOX_ENGINE no longer implements the import allowlist." >&2
  fail=1
fi
# …and the worker must still ARM it. An allowlist nobody passes is a comment.
SANDBOX_WORKER="apps/studio/canvas-build-worker.ts"
if [ -f "$SANDBOX_WORKER" ] && ! grep -qF "restrictImportsTo" "$SANDBOX_WORKER"; then
  echo "FAIL: $SANDBOX_WORKER no longer arms the import allowlist." >&2
  echo "      Without it the cell's bundler resolves anything on this disk" >&2
  echo "      (Cloud Phase 25 A1)." >&2
  fail=1
fi
# The kill switch is the on-call story's only actual control (A3).
if [ -f "apps/hub/src/canvas/routes.mjs" ] && ! grep -qF "renderDisabled" "apps/hub/src/canvas/routes.mjs"; then
  echo "FAIL: the per-tenant render kill switch is gone (Cloud Phase 25 A3)." >&2
  fail=1
fi

# ---- 4. the export except-list stays exactly what the DDRs sanctioned -------
#
# DDR-230 introduced the ONE escape from a forbidden prefix: exact paths on the
# `/_api/export` entry's `except` list (the job lane — enqueue/list/stream,
# nothing evaluates in-cell). A NEW entry appearing here is a containment
# decision, not a convenience — it must arrive with its own DDR, so it is a red
# build until this list is updated deliberately.
#
# DDR-231 (hybrid export lanes) added the browser lane's two halves, and the
# pin was NOT updated with them — so this gate has been failing on main since
# that change shipped in v1.0.7. Both are the zip containment class (pure JS
# over pure data; nothing evaluates tenant TSX):
#   /_api/export-assemble — composes a deck from PNGs the MEMBER'S browser
#     captured and already holds.
#   /_api/export-warmup   — proxies GET /_health to the render service so the
#     container wakes while the member picks options. No job body, no secret.
#
# Maude v2 (decision maude/v2-p8-containment-v2-export-routes) added four, and
# this pin went unchecked because an earlier Quality step failed first:
#   /_api/export-estimate   — numbers from the project index + history ledger.
#   /_api/export-jobs/retry — re-enqueues a session's own failed job items into
#     the same job lane as /_api/export-jobs (render dispatches to maude-render).
#   /_api/export-preflight  — paper, back, fonts. Its safe-margin measure runs a
#     headless canvas-rects render, so a cell is wired WITHOUT the rects runner
#     (pinned below) and answers "unmeasured".
#   /_api/export-preview    — row pictures from the thumbnail service, which is
#     constructed `enabled: !isWorkspaceMode()` (pinned below) and so answers
#     `no-engine` in a cell.
EXCEPT_ACTUAL=$(node -e "
  const s = require('fs').readFileSync('$MODULE', 'utf8');
  const m = s.match(/except:\s*\[([^\]]*)\]/g) ?? [];
  const paths = m.flatMap((x) => [...x.matchAll(/'([^']+)'/g)].map((g) => g[1]));
  console.log(paths.sort().join(','));
")
EXCEPT_EXPECTED="/_api/export-assemble,/_api/export-estimate,/_api/export-history,/_api/export-jobs,/_api/export-jobs/download,/_api/export-jobs/retry,/_api/export-preflight,/_api/export-preview,/_api/export-warmup"
# The two excepted routes that sit next to a renderer stay render-free in a cell.
HTTP_TS="apps/studio/http.ts"
if ! node -e "
  const s = require('fs').readFileSync('$HTTP_TS', 'utf8');
  const i = s.indexOf('preflight: {');
  const block = i < 0 ? '' : s.slice(i, s.indexOf('createRectsRunner', i) + 1);
  process.exit(/isWorkspaceMode\(\)\s*\?\s*\{\}/.test(block) ? 0 : 1);
"; then
  echo "FAIL: /_api/export-preflight's rects runner is wired in a cell — it renders tenant TSX (DDR-193)." >&2
  fail=1
fi
if ! grep -qE "enabled: !isWorkspaceMode\(\)" "$HTTP_TS"; then
  echo "FAIL: the thumbnail service is no longer disabled in a cell — /_api/export-preview would render there (DDR-193)." >&2
  fail=1
fi
if [ "$EXCEPT_ACTUAL" != "$EXCEPT_EXPECTED" ]; then
  echo "FAIL: the forbidden-prefix except-list changed (DDR-230)." >&2
  echo "      expected: $EXCEPT_EXPECTED" >&2
  echo "      found:    $EXCEPT_ACTUAL" >&2
  echo "      A new escape from a forbidden prefix needs its own DDR, then this list." >&2
  fail=1
fi

# ---- 5. the render service must be the inverse of a cell --------------------
#
# apps/render is the ONE image that carries a browser (DDR-230). Its safety
# argument is that it holds nothing worth stealing — so the boot-assert that
# refuses secret-bearing environments must stay, and the cell/hub side must
# never grow a dependency on it becoming more than that.
if [ -d "apps/render" ]; then
  if ! grep -qF "REFUSING TO START" apps/render/server.ts; then
    echo "FAIL: apps/render/server.ts no longer refuses a secret-bearing environment (DDR-230 §1)." >&2
    fail=1
  fi
  if ! grep -qF "MAUDE_RENDER_CANVAS_ORIGINS" apps/render/server.ts; then
    echo "FAIL: apps/render/server.ts no longer gates canvas origins (the SSRF allowlist, DDR-230)." >&2
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "containment gate FAILED" >&2
  exit 1
fi

echo "containment gate OK — forbidden surfaces named, asserts wired (studio + cell image), no runtime browser dep, sandbox bounded"
