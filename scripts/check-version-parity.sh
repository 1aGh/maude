#!/usr/bin/env bash
# Ensures package.json, every plugin's .claude-plugin/plugin.json, every
# per-platform sub-package (DDR-015), and the two app manifests a running
# process reads its own version from (apps/studio, apps/hub) carry the same
# version. All files must move together — the npm CLI, the Claude Code plugins,
# the platform binaries, and the cloud fleet ship under one release line.
#
# Also enforces that the main package's `optionalDependencies` pin every
# sub-package to that same version (otherwise npm won't fetch the matching
# binary at install time).
#
# Run before tagging, before publishing, and in CI.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PKG_PATH="$ROOT/package.json"
PLUGIN_PATHS=(
  "$ROOT/plugins/design/.claude-plugin/plugin.json"
  "$ROOT/plugins/flow/.claude-plugin/plugin.json"
  "$ROOT/plugins/design/.codex-plugin/plugin.json"
  "$ROOT/plugins/flow/.codex-plugin/plugin.json"
)
SUBPACKAGE_PATHS=(
  "$ROOT/packages/maude-darwin-arm64/package.json"
  "$ROOT/packages/maude-darwin-x64/package.json"
  "$ROOT/packages/maude-linux-x64/package.json"
  "$ROOT/packages/maude-linux-arm64/package.json"
  "$ROOT/packages/maude-linux-x64-musl/package.json"
  "$ROOT/packages/maude-linux-arm64-musl/package.json"
  "$ROOT/packages/maude-win32-x64/package.json"
)
# The app manifests a RUNNING process reads its own version from — the hub's
# `readOwnVersion()` and the studio's `/_config`. They ship inside the release
# image, so a drift here is a fleet that misreports which release it is, which
# is exactly what the post-deploy gate in cells-deploy.yml asserts against.
APP_MANIFEST_PATHS=(
  "$ROOT/apps/studio/package.json"
  "$ROOT/apps/hub/package.json"
)

if [ ! -f "$PKG_PATH" ]; then
  echo "error: missing $PKG_PATH" >&2
  exit 2
fi

PKG_VER=$(node -p "require('$PKG_PATH').version")

mismatches=0
for plugin in "${PLUGIN_PATHS[@]}"; do
  if [ ! -f "$plugin" ]; then
    echo "error: missing $plugin" >&2
    exit 2
  fi
  PLUGIN_VER=$(node -p "require('$plugin').version")
  if [ "$PKG_VER" != "$PLUGIN_VER" ]; then
    rel="${plugin#$ROOT/}"
    echo "error: version mismatch" >&2
    printf "  %-50s %s\n" "package.json:" "$PKG_VER" >&2
    printf "  %-50s %s\n" "$rel:" "$PLUGIN_VER" >&2
    mismatches=$((mismatches + 1))
  fi
done

for sub in "${SUBPACKAGE_PATHS[@]}"; do
  # Sub-packages may not yet exist on older branches — skip in that case.
  [ ! -f "$sub" ] && continue
  SUB_VER=$(node -p "require('$sub').version")
  if [ "$PKG_VER" != "$SUB_VER" ]; then
    rel="${sub#$ROOT/}"
    echo "error: version mismatch" >&2
    printf "  %-50s %s\n" "package.json:" "$PKG_VER" >&2
    printf "  %-50s %s\n" "$rel:" "$SUB_VER" >&2
    mismatches=$((mismatches + 1))
  fi
done

for app in "${APP_MANIFEST_PATHS[@]}"; do
  # Absent on older branches, like the sub-packages above.
  [ ! -f "$app" ] && continue
  APP_VER=$(node -p "require('$app').version")
  if [ "$PKG_VER" != "$APP_VER" ]; then
    rel="${app#$ROOT/}"
    echo "error: version mismatch" >&2
    printf "  %-50s %s\n" "package.json:" "$PKG_VER" >&2
    printf "  %-50s %s\n" "$rel:" "$APP_VER" >&2
    mismatches=$((mismatches + 1))
  fi
done

# Native desktop shell (Phase 32) — tauri.conf.json drives the auto-updater's
# {{current_version}}; Cargo.toml drives the native About box. Both ship under the
# same release line and must equal package.json. May be absent on older branches.
TAURI_CONF_PATH="$ROOT/apps/desktop/src-tauri/tauri.conf.json"
if [ -f "$TAURI_CONF_PATH" ]; then
  TAURI_VER=$(node -p "require('$TAURI_CONF_PATH').version")
  if [ "$PKG_VER" != "$TAURI_VER" ]; then
    echo "error: version mismatch" >&2
    printf "  %-50s %s\n" "package.json:" "$PKG_VER" >&2
    printf "  %-50s %s\n" "apps/desktop/src-tauri/tauri.conf.json:" "$TAURI_VER" >&2
    mismatches=$((mismatches + 1))
  fi
fi

CARGO_TOML_PATH="$ROOT/apps/desktop/src-tauri/Cargo.toml"
if [ -f "$CARGO_TOML_PATH" ]; then
  CARGO_VER=$(grep -m1 '^version = ' "$CARGO_TOML_PATH" | sed -E 's/version = "(.*)"/\1/')
  if [ "$PKG_VER" != "$CARGO_VER" ]; then
    echo "error: version mismatch" >&2
    printf "  %-50s %s\n" "package.json:" "$PKG_VER" >&2
    printf "  %-50s %s\n" "apps/desktop/src-tauri/Cargo.toml:" "$CARGO_VER" >&2
    mismatches=$((mismatches + 1))
  fi
fi

# Cloud fleet — the cell image tag in apps/cells/wrangler.toml rides the same
# release line since the fleet rollout became part of the release (the v30
# 'refused to connect' + manual-restart cycle). A semver tag must equal the
# package version; a legacy counter tag (v29, v31…) predates the convention and
# only warns — the next `bump-version.sh` converts it, and from then on this
# asserts. May be absent on older branches.
WRANGLER_TOML_PATH="$ROOT/apps/cells/wrangler.toml"
if [ -f "$WRANGLER_TOML_PATH" ]; then
  CELL_TAG=$(grep -m1 '^image = ' "$WRANGLER_TOML_PATH" | sed -E 's/.*maude-cell:([^"]+)".*/\1/')
  if [[ "$CELL_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    if [ "v$PKG_VER" != "$CELL_TAG" ]; then
      echo "error: version mismatch" >&2
      printf "  %-50s %s\n" "package.json:" "$PKG_VER" >&2
      printf "  %-50s %s\n" "apps/cells/wrangler.toml (maude-cell tag):" "$CELL_TAG" >&2
      mismatches=$((mismatches + 1))
    fi
  else
    echo "note: apps/cells/wrangler.toml still carries a legacy cell tag ($CELL_TAG) — the next bump converts it to v$PKG_VER" >&2
  fi
fi

# Render service (DDR-230) — same contract as the cell tag: the maude-render
# image tag in apps/render/wrangler.toml IS render-deploy.yml's instruction,
# so it rides the release line too. May be absent on older branches.
RENDER_TOML_PATH="$ROOT/apps/render/wrangler.toml"
if [ -f "$RENDER_TOML_PATH" ]; then
  RENDER_TAG=$(grep -m1 '^image = ' "$RENDER_TOML_PATH" | sed -E 's/.*maude-render:([^"]+)".*/\1/')
  if [[ "$RENDER_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    if [ "v$PKG_VER" != "$RENDER_TAG" ]; then
      echo "error: version mismatch" >&2
      printf "  %-50s %s\n" "package.json:" "$PKG_VER" >&2
      printf "  %-50s %s\n" "apps/render/wrangler.toml (maude-render tag):" "$RENDER_TAG" >&2
      mismatches=$((mismatches + 1))
    fi
  fi
fi

# optionalDependencies pin parity — every @1agh/maude-* entry must equal PKG_VER.
mismatches=$((mismatches + $(node -e "
  const j = require('$PKG_PATH');
  const od = j.optionalDependencies || {};
  let n = 0;
  for (const [k, v] of Object.entries(od)) {
    if (!k.startsWith('@1agh/maude-')) continue;
    if (v !== j.version) {
      console.error('error: optionalDependencies pin mismatch:');
      console.error('  package.json version:', j.version);
      console.error('  ' + k + ':', v);
      n++;
    }
  }
  console.log(n);
")))

if [ $mismatches -gt 0 ]; then
  echo "" >&2
  echo "Bump all files to the same version before release:" >&2
  echo "  scripts/bump-version.sh patch    # 0.4.0 → 0.4.1" >&2
  echo "  scripts/bump-version.sh minor    # 0.4.0 → 0.5.0" >&2
  echo "  scripts/bump-version.sh X.Y.Z    # explicit" >&2
  exit 1
fi

echo "version parity OK: $PKG_VER"
echo "  package.json"
for plugin in "${PLUGIN_PATHS[@]}"; do
  echo "  ${plugin#$ROOT/}"
done
for sub in "${SUBPACKAGE_PATHS[@]}"; do
  [ -f "$sub" ] && echo "  ${sub#$ROOT/}"
done
for app in "${APP_MANIFEST_PATHS[@]}"; do
  [ -f "$app" ] && echo "  ${app#$ROOT/}"
done
[ -f "$TAURI_CONF_PATH" ] && echo "  apps/desktop/src-tauri/tauri.conf.json"
[ -f "$CARGO_TOML_PATH" ] && echo "  apps/desktop/src-tauri/Cargo.toml"

# ── Bun runtime pin (T0e, post-1.0 backlog) ─────────────────────────────────
# .bun-version is the ONE source for the bun toolchain version. Every CI
# workflow must consume it via setup-bun's `bun-version-file` (a literal
# `bun-version:` is drift waiting to happen), and the hub image's oven/bun
# stages must carry the same exact tag — `oven/bun:1` floated for months, which
# means the image's runtime was whatever bun happened to publish that week.
# EXACT matters: Bun's minifier output is not stable across patch releases
# (a 1.3.14 client bundle rendered a blank desktop app — see build-desktop.yml).
BUN_VERSION_FILE="$ROOT/.bun-version"
if [ ! -f "$BUN_VERSION_FILE" ]; then
  echo "bun pin: .bun-version is missing" >&2
  exit 1
fi
BUN_PIN=$(tr -d '[:space:]' < "$BUN_VERSION_FILE")
case "$BUN_PIN" in
  [0-9]*.[0-9]*.[0-9]*) : ;;
  *)
    echo "bun pin: .bun-version must be an exact x.y.z, got: '$BUN_PIN'" >&2
    exit 1
    ;;
esac

bun_drift=0
while IFS= read -r line; do
  echo "bun pin: workflow hardcodes a bun version instead of bun-version-file:" >&2
  echo "  $line" >&2
  bun_drift=1
done < <(grep -rn "bun-version:" "$ROOT/.github/workflows" 2>/dev/null || true)

while IFS= read -r line; do
  tag=${line##*oven/bun:}
  tag=${tag%% *}
  if [ "$tag" != "$BUN_PIN" ]; then
    echo "bun pin: apps/hub/Dockerfile stage is not on oven/bun:$BUN_PIN:" >&2
    echo "  $line" >&2
    bun_drift=1
  fi
done < <(grep -n "FROM oven/bun:" "$ROOT/apps/hub/Dockerfile" 2>/dev/null || true)

if [ $bun_drift -gt 0 ]; then
  echo "" >&2
  echo "Fix: change ONLY .bun-version, and reference it everywhere:" >&2
  echo "  workflows:  bun-version-file: .bun-version" >&2
  echo "  Dockerfile: FROM oven/bun:<the pinned version>" >&2
  exit 1
fi
echo "bun pin OK: $BUN_PIN (.bun-version → workflows via bun-version-file, hub Dockerfile stages)"
