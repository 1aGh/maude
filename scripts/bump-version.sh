#!/usr/bin/env bash
# Bumps version in package.json AND every plugin's .claude-plugin/plugin.json
# together. Use this instead of `npm version` so files never drift.
#
# Plugins covered:
#   - plugins/design/.claude-plugin/plugin.json
#   - plugins/flow/.claude-plugin/plugin.json
#
# Usage:
#   scripts/bump-version.sh patch    # 0.4.0 → 0.4.1
#   scripts/bump-version.sh minor    # 0.4.0 → 0.5.0
#   scripts/bump-version.sh major    # 0.4.0 → 1.0.0
#   scripts/bump-version.sh 1.2.3    # explicit version
#
# After bumping, this script does NOT commit, tag, or push — review the diff,
# then run:
#   git commit -am "chore: release vX.Y.Z"
#   git tag -a "vX.Y.Z" -m "vX.Y.Z"    # ANNOTATED — see the note at the bottom
#   git push --follow-tags
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PKG_PATH="$ROOT/package.json"
PLUGIN_PATHS=(
  "$ROOT/plugins/design/.claude-plugin/plugin.json"
  "$ROOT/plugins/flow/.claude-plugin/plugin.json"
  "$ROOT/plugins/design/.codex-plugin/plugin.json"
  "$ROOT/plugins/flow/.codex-plugin/plugin.json"
)
# The native desktop shell (Phase 32) ships under the same release line — its
# tauri.conf.json `version` drives the auto-updater's `{{current_version}}`, so it
# MUST move in lockstep with package.json + the plugin manifests.
TAURI_CONF_PATH="$ROOT/apps/desktop/src-tauri/tauri.conf.json"
# Per-platform sub-packages (Phase 3.4 / DDR-015) — versioned in lockstep with
# the main tarball because the main package's optionalDependencies pin them.
SUBPACKAGE_PATHS=(
  "$ROOT/packages/maude-darwin-arm64/package.json"
  "$ROOT/packages/maude-darwin-x64/package.json"
  "$ROOT/packages/maude-linux-x64/package.json"
  "$ROOT/packages/maude-linux-arm64/package.json"
  "$ROOT/packages/maude-linux-x64-musl/package.json"
  "$ROOT/packages/maude-linux-arm64-musl/package.json"
  "$ROOT/packages/maude-win32-x64/package.json"
)
# The two app manifests that a RUNNING process reads its own version from.
#
# Both were pinned at 0.0.0 as private workspace packages, which is why the
# hub's `/health` reported `0.0.0` — `readOwnVersion()` reads exactly this file,
# and the image copies it in as its own package.json. A version nobody can read
# off a live process is a version you have to reconstruct from CI logs, and
# that is what made the v0.57.0 stale-hub deploy take hand-probing to diagnose.
#
# Nothing depends on the 0.0.0 literal: neither pnpm-lock.yaml nor either
# bun.lock records a workspace root's own version (checked), and no package
# references these by version range.
APP_MANIFEST_PATHS=(
  "$ROOT/apps/studio/package.json"
  "$ROOT/apps/hub/package.json"
)

if [ $# -ne 1 ]; then
  echo "usage: $0 <patch|minor|major|X.Y.Z>" >&2
  exit 2
fi

CURRENT=$(node -p "require('$PKG_PATH').version")

case "$1" in
  patch|minor|major)
    NEW=$(node -p "
      const [a,b,c] = '$CURRENT'.split('.').map(Number);
      const kind = '$1';
      kind === 'major' ? \`\${a+1}.0.0\` :
      kind === 'minor' ? \`\${a}.\${b+1}.0\` :
                         \`\${a}.\${b}.\${c+1}\`
    ")
    ;;
  *)
    if [[ ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "error: '$1' is not patch|minor|major or a valid X.Y.Z" >&2
      exit 2
    fi
    NEW="$1"
    ;;
esac

echo "$CURRENT → $NEW"

PATHS_JOINED=$(printf "'%s'," "$PKG_PATH" "${PLUGIN_PATHS[@]}" "${SUBPACKAGE_PATHS[@]}" "${APP_MANIFEST_PATHS[@]}" "$TAURI_CONF_PATH")
PATHS_JOINED="${PATHS_JOINED%,}"

node -e "
  const fs = require('fs');
  for (const p of [$PATHS_JOINED]) {
    if (!fs.existsSync(p)) continue; // sub-packages may be absent in early branches
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.version = '$NEW';
    // The main package pins its sub-packages via optionalDependencies — bump
    // those too so they always agree with the version we just wrote.
    if (j.optionalDependencies) {
      for (const k of Object.keys(j.optionalDependencies)) {
        if (k.startsWith('@1agh/maude-')) j.optionalDependencies[k] = '$NEW';
      }
    }
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  }
"

# tauri.conf.json has short arrays (updater.endpoints / bundle.externalBin) that
# biome's formatter keeps on a single line, but the JSON.stringify writer above
# re-expands them onto multiple lines — which fails the `Lint (biome)` quality
# gate on EVERY release (regressed v0.38.1). Reformat it back to biome's style so
# the committed file stays clean. Best-effort: skip silently if biome is absent.
npx --no-install biome format --write "$TAURI_CONF_PATH" >/dev/null 2>&1 || true
# Same for every manifest the writer above touched: the Codex plugin manifests
# carry short arrays too (capabilities / defaultPrompt), and v1.3.1's release
# commit failed the gate on exactly those two files.
npx --no-install biome format --write "$PKG_PATH" "${PLUGIN_PATHS[@]}" "${SUBPACKAGE_PATHS[@]}" "${APP_MANIFEST_PATHS[@]}" >/dev/null 2>&1 || true

# The desktop crate's Cargo.toml is TOML, not JSON — bump its [package] version
# (drives env!("CARGO_PKG_VERSION") in the native About box) so it never drifts
# from tauri.conf.json. Only the first `version = "…"` (the [package] one) is touched.
CARGO_TOML_PATH="$ROOT/apps/desktop/src-tauri/Cargo.toml"
if [ -f "$CARGO_TOML_PATH" ]; then
  NEW="$NEW" node -e "
    const fs = require('fs');
    const p = '$CARGO_TOML_PATH';
    const s = fs.readFileSync(p, 'utf8');
    const out = s.replace(/^version = \"[0-9]+\.[0-9]+\.[0-9]+\"/m, 'version = \"' + process.env.NEW + '\"');
    fs.writeFileSync(p, out);
  "
fi

# Cargo.lock records the workspace member's version too. Without this, the
# lockfile drifts after every release until the next cargo run rewrites it —
# outside the release commit, as a stray working-tree modification.
CARGO_LOCK_PATH="$ROOT/apps/desktop/src-tauri/Cargo.lock"
if [ -f "$CARGO_LOCK_PATH" ]; then
  NEW="$NEW" node -e "
    const fs = require('fs');
    const p = '$CARGO_LOCK_PATH';
    const s = fs.readFileSync(p, 'utf8');
    const out = s.replace(/(name = \"maude-desktop\"\nversion = )\"[0-9]+\.[0-9]+\.[0-9]+\"/, '\$1\"' + process.env.NEW + '\"');
    fs.writeFileSync(p, out);
  "
fi

# The cloud fleet ships the same release line. The cell image tag in
# apps/cells/wrangler.toml IS the fleet instruction (cells-deploy builds and
# deploys exactly what it names, deriving from ghcr maude-hub:vX.Y.Z on a tag),
# so the bump rewrites it to maude-cell:v$NEW. The release tag then carries the
# WHOLE rollout — and because env is applied at container START and Cloudflare
# only rolls instances on a CONFIG change, the tag change is precisely what
# restarts every cell onto the new image (the v30/v31 lesson: a re-pushed image
# under an unchanged tag looks deployed and isn't running anywhere).
WRANGLER_TOML_PATH="$ROOT/apps/cells/wrangler.toml"
if [ -f "$WRANGLER_TOML_PATH" ]; then
  NEW="$NEW" node -e "
    const fs = require('fs');
    const p = '$WRANGLER_TOML_PATH';
    const s = fs.readFileSync(p, 'utf8');
    const out = s.replace(/(\/maude-cell:)v[0-9A-Za-z.-]+\"/, '\$1v' + process.env.NEW + '\"');
    if (out === s && !s.includes('/maude-cell:v' + process.env.NEW + '\"')) {
      console.error('[bump] WARNING: no maude-cell image tag found in apps/cells/wrangler.toml');
    }
    fs.writeFileSync(p, out);
  "
  echo "[bump] apps/cells/wrangler.toml → maude-cell:v${NEW} (the release tag rolls the fleet)"
fi

# Same contract for the render service (DDR-230): the tag in
# apps/render/wrangler.toml is the rollout instruction render-deploy.yml reads.
RENDER_TOML_PATH="$ROOT/apps/render/wrangler.toml"
if [ -f "$RENDER_TOML_PATH" ]; then
  NEW="$NEW" node -e "
    const fs = require('fs');
    const p = '$RENDER_TOML_PATH';
    const s = fs.readFileSync(p, 'utf8');
    const out = s.replace(/(\/maude-render:)v[0-9A-Za-z.-]+\"/, '\$1v' + process.env.NEW + '\"');
    if (out === s && !s.includes('/maude-render:v' + process.env.NEW + '\"')) {
      console.error('[bump] WARNING: no maude-render image tag found in apps/render/wrangler.toml');
    }
    fs.writeFileSync(p, out);
  "
  echo "[bump] apps/render/wrangler.toml → maude-render:v${NEW}"
fi

# Stamp any pending What's New entries (version:null) with the new version + date.
node "$ROOT/scripts/stamp-whats-new.mjs" "$NEW"

# Rebuild the committed client bundle at the NEW version.
#
# `build.ts` compiles the version in (`__MDCC_VERSION__` from package.json), so
# the moment the version moves, the committed dist/client.bundle.js is stale by
# exactly that string — and CI's release build, which regenerates it, would ship
# an artifact nobody reviewed. That is not hypothetical: the desktop app opened
# to a blank window in v0.51.1 and v0.52.0 because the shipped bundle was never
# the committed one. Rebuilding here keeps them the same object, which is what
# the "built client bundle matches the committed one" CI gate asserts.
#
# Release-minified deliberately (never a dev build — 14 MB vs 2 MB), and
# MAUDE_SKIP_RUNTIME_BUILD=1 so the committed dist/runtime/*.js stay untouched.
if command -v bun >/dev/null 2>&1; then
  # Braces are load-bearing: a multibyte character straight after `$NEW` gets
  # swallowed into the variable name and `set -u` kills the release mid-bump.
  echo "[bump] rebuilding the client bundle at ${NEW}..."
  (cd "$ROOT/apps/studio" && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release >/dev/null)
  echo "[bump] dist/client.bundle.js + dist/styles.css rebuilt — commit them with the bump"
else
  echo "[bump] WARNING: bun not on PATH — dist/client.bundle.js still carries the OLD version." >&2
  echo "[bump]          Run this before committing, or CI will refuse the release:" >&2
  echo "[bump]            cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release" >&2
fi

# Regenerate the site's generated content at the NEW version.
#
# Same class of staleness as the client bundle above: `site/lib/stats.json` bakes
# `"version": "vX.Y.Z"`, so the bump alone makes it stale and quality.yml's
# "Site generated content drift" step — which regenerates and diffs — goes red on
# the release commit itself. (An older fix made `publishedDate` stable; it never
# covered the version field, and a memory summarising it as "permanently fixed"
# is exactly how v0.53.2 shipped with a red gate and needed a follow-up commit.)
# Regenerating here makes the release commit self-consistent.
if command -v pnpm >/dev/null 2>&1; then
  echo "[bump] regenerating site reference + stats at ${NEW}..."
  (cd "$ROOT" && pnpm --filter @maude/site gen:reference >/dev/null 2>&1 || true)
  (cd "$ROOT" && pnpm --filter @maude/site gen:stats >/dev/null 2>&1 || true)
  echo "[bump] site/lib/stats.json regenerated — commit it with the bump"
else
  echo "[bump] WARNING: pnpm not on PATH — site/lib/stats.json still carries the OLD version." >&2
  echo "[bump]          Run before committing or quality.yml reds on the release commit:" >&2
  echo "[bump]            pnpm --filter @maude/site gen:reference && pnpm --filter @maude/site gen:stats" >&2
fi

"$ROOT/scripts/check-version-parity.sh"

# Every relative import in a tracked file must have a tracked target. In a
# Syncthing tree with concurrent sessions, a `git add` of a SHARED file can
# carry another session's in-flight import into main while the module stays
# untracked — green locally, fatal in CI, and it killed the whole v0.51.0
# binary + desktop matrix twice before this check existed.
"$ROOT/scripts/check-import-coherence.sh"

echo ""
echo "Review the diff, then:"
echo "  git commit -am 'chore: release v$NEW'"
echo "  git tag -a \"v$NEW\" -m \"v$NEW\""
echo "  git push --follow-tags"
echo ""
# The annotated form is not a style preference. `git push --follow-tags` pushes
# ANNOTATED tags only, so a lightweight `git tag v$NEW` stays local and NO
# release workflow fires — the release looks done (main is pushed, the bump is
# committed) and nothing is published or deployed. This printed the wrong form
# for the whole life of the script while .ai/release-guide.md printed the right
# one; two surfaces out of three said "lightweight", and that is how a release
# reached main with the tag still sitting on the laptop.
echo "  (annotated -a -m is required — 'git push --follow-tags' only pushes annotated"
echo "   tags; a lightweight 'git tag v$NEW' silently stays local and nothing fires)"
