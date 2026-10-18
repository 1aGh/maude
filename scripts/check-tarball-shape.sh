#!/usr/bin/env bash
# Asserts the published @1agh/maude tarball has the shape we expect:
#   - no workspace `package.json` files leak (would publish a private workspace
#     name like @maude/dev-server)
#   - no `node_modules/` or transitive deps end up in the tarball
#   - reserved-slot workspaces (`site`, `apps/hub`) are excluded
#     entirely
#   - the harness command, runtime modules, target adapters, compatibility
#     metadata, template, docs, and declared runtime dependencies all ship
#   - harness tests/fixtures, backups, machine state, logs, workspace metadata,
#     and secret-shaped files never ship
#
# Run before tagging and in CI on PRs that touch `files` or any workspace.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

# npm pack --json is the supported machine-readable shape since npm 7.
listing=$(npm pack --dry-run --json 2>/dev/null | node -e '
  const json = require("fs").readFileSync(0, "utf8");
  const parsed = JSON.parse(json);
  // npm 7-10 emitted an ARRAY of package objects; npm 11 emits an OBJECT keyed
  // by package name. Accept both — this gate runs on whatever npm the machine
  // or the runner happens to have, and the array-only form failed closed with
  // `JSON.parse is not a function or its return value is not iterable`, which
  // reads like a syntax error rather than a shape change.
  const pkgs = Array.isArray(parsed) ? parsed : Object.values(parsed);
  for (const pkg of pkgs) {
    for (const f of pkg.files) console.log(f.path);
  }
')

fail() {
  echo "error: tarball shape violation — $1" >&2
  echo "" >&2
  echo "Full tarball listing:" >&2
  echo "$listing" | sed "s/^/  /" >&2
  exit 1
}

require_file() {
  echo "$listing" | grep -Fx "$1" >/dev/null || fail "required runtime file missing: $1"
}

# Workspace package.json files must NOT ship — they declare private packages
# (@maude/dev-server, @maude/hub, @maude/site) that would
# accidentally be exposed at install time.
echo "$listing" | grep -E "^(site|plugins/[^/]+/[^/]+|apps/[^/]+)/package\.json$" >/dev/null \
  && fail "workspace package.json present in tarball" || true

# Reserved-slot workspaces must be entirely absent — except the hub's project-transactions kernel,
# which the studio's in-process local kernel (apps/studio/sync/local-kernel.ts, S5.1b) imports by
# relative path, so `server.ts` run from the npm package resolves it. Nothing else under apps/hub.
echo "$listing" | grep -E "^(site|apps/hub)/" | grep -vE "^apps/hub/src/project-transactions/[^/]+\.mjs$" >/dev/null \
  && fail "reserved workspace dir leaked into tarball" || true
for required in \
  apps/hub/src/project-transactions/baseline.mjs \
  apps/hub/src/project-transactions/kernel.mjs \
  apps/hub/src/project-transactions/lanes.mjs \
  apps/hub/src/project-transactions/store-core.mjs \
  apps/hub/src/project-transactions/runs-core.mjs
do
  require_file "$required"
done

# Transitive deps must never appear.
echo "$listing" | grep -E "^node_modules/" >/dev/null \
  && fail "node_modules/ in tarball" || true

# Workspace lockfile must never ship.
echo "$listing" | grep -E "^pnpm-lock\.yaml$" >/dev/null \
  && fail "pnpm-lock.yaml in tarball" || true

# postinstall recreates this cache with an installation-specific absolute path.
echo "$listing" | grep -Fx "cli/.platform-binary-path" >/dev/null \
  && fail "postinstall platform-binary cache leaked into tarball" || true

# Harness runtime closure. Keep this explicit: a broad `cli` package entry can
# look correct from a checkout while omitting a template or metadata file needed
# only after installation.
for required in \
  cli/bin/maude.mjs \
  cli/commands/harness.mjs \
  cli/lib/harness/capabilities.mjs \
  cli/lib/harness/compatibility.mjs \
  cli/lib/harness/discover-claude.mjs \
  cli/lib/harness/managed-state.mjs \
  cli/lib/harness/model.mjs \
  cli/lib/harness/secrets.mjs \
  cli/lib/harness/transaction.mjs \
  cli/lib/harness/targets/codex.mjs \
  cli/lib/harness/targets/opencode.mjs \
  cli/templates/harness/opencode/maude-projector.ts \
  docs/harness-capability-matrix.md \
  docs/harness-environment-projection.md
do
  require_file "$required"
done

# Published harness code is runtime-only. Tests and their synthetic data can
# contain sentinel credentials and must remain in the source checkout.
echo "$listing" | grep -E "^(cli/.*\.test\.mjs|cli/(fixtures?|backups?|logs?|state)/|cli/.*/(fixtures?|backups?|logs?|state)/|apps/studio/(\.ai/|bun\.lock$)|apps/studio/.*\.(test|spec)\.[^/]+$|apps/studio/(.*/)?(tests?|fixtures?|backups?|logs?|state)/|apps/hub/.*\.(test|spec)\.[^/]+$)" >/dev/null \
  && fail "tests, fixtures, backups, logs, or machine state leaked into tarball" || true

echo "$listing" | grep -E "(^|/)(\.DS_Store|\.env($|\.)|[^/]*\.(pem|key|secret|secrets|backup|bak|log))$" >/dev/null \
  && fail "machine metadata, secret-shaped file, backup, or log leaked into tarball" || true

# These are the only third-party packages imported by harness runtime modules.
# npm installs dependencies separately; they belong in package metadata, never
# as vendored node_modules entries.
node -e '
  const pkg = require("./package.json");
  for (const name of ["@decimalturn/toml-patch", "yaml"]) {
    if (!pkg.dependencies?.[name]) {
      console.error(`error: tarball shape violation — missing harness runtime dependency ${name}`);
      process.exit(1);
    }
  }
' || fail "harness runtime dependency metadata is incomplete"

count=$(echo "$listing" | wc -l | tr -d ' ')
echo "tarball shape OK: $count files, harness runtime complete, forbidden state absent"
