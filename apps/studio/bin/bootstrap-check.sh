#!/usr/bin/env bash
# bootstrap-check.sh — detect whether the project has a usable design system.
# Canonical recipe (was inline in `commands/new.md` step 0 + `commands/edit.md` step 0).
#
# Usage:
#   bootstrap-check.sh                # human-readable next-step on stdout, exit 0/10/11
#   bootstrap-check.sh --json         # JSON on stdout, exit 0/10/11
#   bootstrap-check.sh --shell-export # `export FOO=bar` lines on stdout, eval-friendly
#
# Exit codes:
#   0  — ready (config + at least one DS in system/)
#   10 — needs `/design:init` (no .design/config.json)
#   11 — needs `/design:setup-ds` (config present, no DS folders)

MODE="default"
case "$1" in
  --json)         MODE="json" ;;
  --shell-export) MODE="shell" ;;
  --help|-h)
    sed -n '2,16p' "$0" | sed 's/^# \?//'
    exit 0
    ;;
  "") ;;
  *)
    echo "bootstrap-check.sh: unknown arg '$1' (try --help)" >&2
    exit 2
    ;;
esac

# V2-8.9 r2 C2 — the pinned project first (the dispatcher sets it in an AI session), like the other helpers
REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
CFG="$REPO_ROOT/.design/config.json"

CONFIG_PRESENT="false"
[ -f "$CFG" ] && CONFIG_PRESENT="true"

HAS_DS="false"
if [ -d "$REPO_ROOT/.design/system" ]; then
  if find "$REPO_ROOT/.design/system" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | grep -q .; then
    HAS_DS="true"
  fi
fi

KNOWN_DS=""
DEFAULT_DS="project"
if [ "$CONFIG_PRESENT" = "true" ] && command -v jq >/dev/null 2>&1; then
  KNOWN_DS=$(jq -r '.designSystems[]?.name // empty' "$CFG" 2>/dev/null | tr '\n' ' ' | sed 's/ $//')
  ds_default=$(jq -r '.defaultDesignSystem // empty' "$CFG" 2>/dev/null)
  [ -n "$ds_default" ] && DEFAULT_DS="$ds_default"
fi

# Decide exit code
EXIT_CODE=0
if [ "$CONFIG_PRESENT" = "false" ]; then
  EXIT_CODE=10
elif [ "$HAS_DS" = "false" ]; then
  EXIT_CODE=11
fi

case "$MODE" in
  json)
    printf '{"has_ds":%s,"config_present":%s,"repo_root":"%s","known_ds":[%s],"default_ds":"%s","exit_code":%d}\n' \
      "$HAS_DS" "$CONFIG_PRESENT" "$REPO_ROOT" \
      "$(printf '%s' "$KNOWN_DS" | awk 'NF{for(i=1;i<=NF;i++) printf "%s\"%s\"",(i>1?",":""),$i}')" \
      "$DEFAULT_DS" "$EXIT_CODE"
    ;;
  shell)
    printf 'export HAS_DS=%s\n' "$HAS_DS"
    printf 'export CONFIG_PRESENT=%s\n' "$CONFIG_PRESENT"
    printf 'export REPO_ROOT=%s\n' "$REPO_ROOT"
    printf 'export KNOWN_DS=%s\n' "\"$KNOWN_DS\""
    printf 'export DEFAULT_DS=%s\n' "$DEFAULT_DS"
    printf 'export BOOTSTRAP_EXIT=%d\n' "$EXIT_CODE"
    ;;
  default)
    case "$EXIT_CODE" in
      0)  echo "✓ ready — design system(s): ${KNOWN_DS:-$DEFAULT_DS}" ;;
      10) echo "→ Run /design:init first (no .design/config.json found at $REPO_ROOT)" ;;
      11) echo "→ Run /design:setup-ds <name> first (no DS in $REPO_ROOT/.design/system/)" ;;
    esac
    ;;
esac

exit $EXIT_CODE
