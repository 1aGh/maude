#!/usr/bin/env bash
# prep.sh — one-shot pre-flight context for the design slash commands.
#
# Collapses the 4–8 sequential bash invocations that /design:new, /design:edit
# and /design:setup-ds each ran in their step-0/step-1 (bootstrap-check + config
# jq reads + _active.json read + _preflight read + _server.json PID probe + slug
# compute) into a SINGLE call that emits one structured blob. Same shape family
# as bootstrap-check.sh / server-up.sh.
#
# Reads (all optional — missing files degrade gracefully, never error):
#   .design/config.json          → NAME, DESIGN_ROOT, ROOT_CLASS, THEME, TOKENS_REL,
#                                   NEW_CANVAS_DIR, NEW_COMPONENT_DIR, TEAM_ACCENT,
#                                   DEFAULT_DS, KNOWN_DS, ACCENT_STRATEGY, COLOR_SPACE
#   <designRoot>/_active.json     → ACTIVE_CANVAS, SELECTED_ELEMENT, SELECTED_FILE,
#                                   SEL_VALID, OPEN_TABS, ACTIVE_SLUG
#   <designRoot>/_preflight.json  → DEPS_OK, DEPS_MISSING   (Phase A cache)
#   <designRoot>/_server.json     → SERVER_UP, SERVER_PORT  (PID liveness + /_health)
#
# Usage:
#   prep.sh                       # JSON on stdout (default)
#   prep.sh --json                # JSON on stdout
#   prep.sh --shell-export        # `export FOO=bar` lines, eval-friendly
#   prep.sh --shape <new|edit|setup-ds>   # emit only the subset that command needs
#   prep.sh --root <repo>         # override repo root (else git root → $CLAUDE_PROJECT_DIR → pwd)
#
# Resolution (DDR-045): resolve the repo root from args/env/git — never from
# `dirname $0`, which maps to /$bunfs/root inside a bun --compile binary.
#
# Exit: 0 always (this is a context gatherer; callers branch on the fields).

MODE="json"
SHAPE="all"
REPO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --json)         MODE="json"; shift ;;
    --shell-export) MODE="shell"; shift ;;
    --shape)        SHAPE="$2"; shift 2 ;;
    --root)         REPO="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,33p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "prep.sh: unknown arg '$1' (try --help)" >&2
      exit 2
      ;;
  esac
done

case "$SHAPE" in
  all|new|edit|setup-ds) ;;
  *) echo "prep.sh: --shape must be one of new|edit|setup-ds (got '$SHAPE')" >&2; exit 2 ;;
esac

# ---- repo root ----------------------------------------------------------------
if [ -z "$REPO" ]; then
  REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
fi

HAVE_JQ=0
command -v jq >/dev/null 2>&1 && HAVE_JQ=1

# ---- config -------------------------------------------------------------------
CFG="$REPO/.design/config.json"
CONFIG_PRESENT="false"; [ -f "$CFG" ] && CONFIG_PRESENT="true"

NAME="Project"
DESIGN_ROOT=".design"
ROOT_CLASS="app"
THEME="dark"
TOKENS_REL="system/colors_and_type.css"
NEW_CANVAS_DIR="ui/project"
NEW_COMPONENT_DIR="ui/project/components"
TEAM_ACCENT=""
DEFAULT_DS="project"
KNOWN_DS=""
ACCENT_STRATEGY="single"
COLOR_SPACE="oklch"
MOODBOARD_VARIANTS="3"

if [ "$CONFIG_PRESENT" = "true" ] && [ "$HAVE_JQ" = "1" ]; then
  NAME=$(jq -r '.name // "Project"' "$CFG")
  DESIGN_ROOT=$(jq -r '.designRoot // ".design"' "$CFG")
  ROOT_CLASS=$(jq -r '.rootClass // "app"' "$CFG")
  THEME=$(jq -r '.themeDefault // "dark"' "$CFG")
  TOKENS_REL=$(jq -r '.tokensCssRel // "system/colors_and_type.css"' "$CFG")
  NEW_CANVAS_DIR=$(jq -r '.newCanvasDir // "ui/project"' "$CFG")
  NEW_COMPONENT_DIR=$(jq -r '.newComponentDir // "ui/project/components"' "$CFG")
  TEAM_ACCENT=$(jq -r '.teamAccentDefault // empty' "$CFG")
  DEFAULT_DS=$(jq -r '.defaultDesignSystem // "project"' "$CFG")
  KNOWN_DS=$(jq -r '.designSystems[]?.name // empty' "$CFG" 2>/dev/null | tr '\n' ' ' | sed 's/ $//')
  ACCENT_STRATEGY=$(jq -r '.accentStrategy // "single"' "$CFG")
  COLOR_SPACE=$(jq -r '.colorSpace // "oklch"' "$CFG")
  # Type-coerce + clamp in jq: config.json is untrusted input (a poisoned repo
  # could put a string here) and --shell-export output gets eval'd by callers.
  MOODBOARD_VARIANTS=$(jq -r '.moodboard.variants // 3 | if type=="number" then floor else 3 end | if . < 1 then 1 elif . > 3 then 3 else . end' "$CFG")
fi

DR_ABS="$REPO/$DESIGN_ROOT"

# ---- active canvas / selection ------------------------------------------------
ACTIVE_FILE="$DR_ABS/_active.json"
ACTIVE_CANVAS=""
SELECTED_ELEMENT=""
SELECTED_FILE=""
SEL_VALID="0"
OPEN_TABS="0"
ACTIVE_SLUG=""
if [ -f "$ACTIVE_FILE" ] && [ "$HAVE_JQ" = "1" ]; then
  ACTIVE_CANVAS=$(jq -r '.active // empty' "$ACTIVE_FILE" 2>/dev/null)
  [ "$ACTIVE_CANVAS" = "null" ] && ACTIVE_CANVAS=""
  SELECTED_ELEMENT=$(jq -rc '.selected // empty' "$ACTIVE_FILE" 2>/dev/null)
  SELECTED_FILE=$(jq -r '.selected.file // empty' "$ACTIVE_FILE" 2>/dev/null)
  OPEN_TABS=$(jq -r '(.open_tabs // []) | length' "$ACTIVE_FILE" 2>/dev/null || echo 0)
  if [ -n "$SELECTED_ELEMENT" ] && [ -n "$ACTIVE_CANVAS" ] && [ "$SELECTED_FILE" = "$ACTIVE_CANVAS" ]; then
    SEL_VALID="1"
  fi
  if [ -n "$ACTIVE_CANVAS" ]; then
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    ACTIVE_SLUG=$(bash "$SCRIPT_DIR/slug.sh" "${ACTIVE_CANVAS#"$DESIGN_ROOT"/}" 2>/dev/null)
  fi
fi

# ---- deps preflight cache -----------------------------------------------------
PREFLIGHT_FILE="$DR_ABS/_preflight.json"
DEPS_OK="unknown"
DEPS_MISSING=""
if [ -f "$PREFLIGHT_FILE" ] && [ "$HAVE_JQ" = "1" ]; then
  DEPS_OK=$(jq -r 'if .ok == true then "true" elif .ok == false then "false" else "unknown" end' "$PREFLIGHT_FILE" 2>/dev/null || echo unknown)
  DEPS_MISSING=$(jq -r '(.missing // []) | join(",")' "$PREFLIGHT_FILE" 2>/dev/null || echo "")
fi

# ---- server liveness ----------------------------------------------------------
# #206 (contract §2): who serves this checkout — `app` (the Maude desktop app's attested server; its
# port, never `_server.json`'s, while the app has the project open), `cli` (a terminal server found
# through `_server.json` + /_health) or `none`. Probe only: nothing is opened, started or leased.
SERVER_FILE="$DR_ABS/_server.json"
SERVER_UP="false"
SERVER_PORT=""
SERVER_OWNER="none"
DESKTOP_RC=10
if [ -f "$(dirname "$0")/_desktop-locate.sh" ]; then
  # shellcheck source=/dev/null
  . "$(dirname "$0")/_desktop-locate.sh"
  desktop_port "$REPO" 2>/dev/null
  DESKTOP_RC=$?
fi
if [ "$DESKTOP_RC" = 0 ] && [ -n "${DESKTOP_PORT:-}" ]; then
  SERVER_OWNER="app"; SERVER_UP="true"; SERVER_PORT="$DESKTOP_PORT"
elif [ "$DESKTOP_RC" = 11 ]; then
  # the app has it open but its server did not answer the check: the app's, and not usable
  SERVER_OWNER="app"
elif [ -f "$SERVER_FILE" ] && [ "$HAVE_JQ" = "1" ]; then
  SERVER_PORT=$(jq -r '.port // empty' "$SERVER_FILE" 2>/dev/null)
  SERVER_PID=$(jq -r '.pid // empty' "$SERVER_FILE" 2>/dev/null)
  if [ -n "$SERVER_PID" ] && [ -n "$SERVER_PORT" ] \
     && kill -0 "$SERVER_PID" 2>/dev/null \
     && curl -fs "http://localhost:$SERVER_PORT/_health" >/dev/null 2>&1; then
    SERVER_UP="true"; SERVER_OWNER="cli"
  fi
fi

# ---- emit ---------------------------------------------------------------------
# Shape membership: `new`/`setup-ds` omit the active-canvas/selection block
# (those commands don't act on an open canvas); `edit`/`all` emit everything.
if [ "$MODE" = "shell" ]; then
  printf 'export REPO_ROOT=%q\n'         "$REPO"
  printf 'export CONFIG_PRESENT=%s\n'    "$CONFIG_PRESENT"
  printf 'export NAME=%q\n'              "$NAME"
  printf 'export DESIGN_ROOT=%q\n'       "$DESIGN_ROOT"
  printf 'export ROOT_CLASS=%q\n'        "$ROOT_CLASS"
  printf 'export THEME=%q\n'             "$THEME"
  printf 'export TOKENS_REL=%q\n'        "$TOKENS_REL"
  printf 'export NEW_CANVAS_DIR=%q\n'    "$NEW_CANVAS_DIR"
  printf 'export NEW_COMPONENT_DIR=%q\n' "$NEW_COMPONENT_DIR"
  printf 'export TEAM_ACCENT=%q\n'       "$TEAM_ACCENT"
  printf 'export DEFAULT_DS=%q\n'        "$DEFAULT_DS"
  printf 'export KNOWN_DS=%q\n'          "$KNOWN_DS"
  printf 'export ACCENT_STRATEGY=%q\n'   "$ACCENT_STRATEGY"
  printf 'export COLOR_SPACE=%q\n'       "$COLOR_SPACE"
  printf 'export MOODBOARD_VARIANTS=%q\n' "$MOODBOARD_VARIANTS"
  printf 'export DEPS_OK=%s\n'           "$DEPS_OK"
  printf 'export DEPS_MISSING=%q\n'      "$DEPS_MISSING"
  printf 'export SERVER_UP=%s\n'         "$SERVER_UP"
  printf 'export SERVER_PORT=%q\n'       "$SERVER_PORT"
  printf 'export SERVER_OWNER=%s\n'      "$SERVER_OWNER"
  if [ "$SHAPE" = "edit" ] || [ "$SHAPE" = "all" ]; then
    printf 'export ACTIVE_CANVAS=%q\n'   "$ACTIVE_CANVAS"
    printf 'export SELECTED_FILE=%q\n'   "$SELECTED_FILE"
    printf 'export SEL_VALID=%s\n'       "$SEL_VALID"
    printf 'export OPEN_TABS=%s\n'       "$OPEN_TABS"
    printf 'export ACTIVE_SLUG=%q\n'     "$ACTIVE_SLUG"
  fi
  exit 0
fi

# JSON mode — emit via jq when available for correct escaping; fall back to printf.
if [ "$HAVE_JQ" = "1" ]; then
  jq -n \
    --arg repo "$REPO" --arg cfg "$CONFIG_PRESENT" --arg name "$NAME" \
    --arg dr "$DESIGN_ROOT" --arg rc "$ROOT_CLASS" --arg th "$THEME" \
    --arg tok "$TOKENS_REL" --arg ncd "$NEW_CANVAS_DIR" --arg ncm "$NEW_COMPONENT_DIR" \
    --arg acc "$TEAM_ACCENT" --arg dds "$DEFAULT_DS" --arg kds "$KNOWN_DS" \
    --arg astrat "$ACCENT_STRATEGY" --arg cspace "$COLOR_SPACE" \
    --arg mbvar "$MOODBOARD_VARIANTS" \
    --arg depsok "$DEPS_OK" --arg depsmiss "$DEPS_MISSING" \
    --arg sup "$SERVER_UP" --arg sport "$SERVER_PORT" --arg sown "$SERVER_OWNER" \
    --arg act "$ACTIVE_CANVAS" --arg selfile "$SELECTED_FILE" \
    --arg selv "$SEL_VALID" --arg tabs "$OPEN_TABS" --arg slug "$ACTIVE_SLUG" \
    --argjson sel "${SELECTED_ELEMENT:-null}" \
    '{
      repo_root: $repo,
      config_present: ($cfg == "true"),
      config: {
        name: $name, design_root: $dr, root_class: $rc, theme: $th,
        tokens_rel: $tok, new_canvas_dir: $ncd, new_component_dir: $ncm,
        team_accent: $acc, default_ds: $dds,
        known_ds: ($kds | if . == "" then [] else split(" ") end),
        accent_strategy: $astrat, color_space: $cspace,
        moodboard_variants: ($mbvar | tonumber? // 3)
      },
      active: {
        canvas: $act, selected: $sel, selected_file: $selfile,
        sel_valid: ($selv == "1"), open_tabs: ($tabs | tonumber? // 0), slug: $slug
      },
      deps: { ok: $depsok, missing: ($depsmiss | if . == "" then [] else split(",") end) },
      server: { up: ($sup == "true"), port: ($sport | if . == "" then null else (tonumber? // .) end), owner: $sown }
    }'
else
  printf '{"repo_root":"%s","config_present":%s,"jq":false,"note":"jq unavailable — install jq for full prep.sh output"}\n' \
    "$REPO" "$CONFIG_PRESENT"
fi

exit 0
