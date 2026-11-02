#!/usr/bin/env bash
# smoke.sh — batch-screenshot every UI canvas + preview specimen.
# Catches "build green ≠ user-visible green" regressions that bypass the
# per-canvas hooks in /design:edit step 7 / /design:new step 9 — typically
# dev-server infra changes or bulk multi-canvas migrations. See DDR-021.
#
# Beyond "does it render", preview specimens are also gated on "does it render
# STYLED" (DDR-068): a static import-graph lint (every specimen reaches
# _layout.css — its single CSS entry, which @imports the tokens + _components.css
# — and every shared preview/_*.css has >=1 importer) plus a runtime
# computed-style check (the DS token contract `--bg-0` must resolve on the body,
# else the canvas's import graph lost the token CSS and every var()-driven rule
# is dead — the specimen mounts with content but renders unstyled).
#
# Also runs an ADVISORY artboard-isolation lint over ui/ canvases: `@media`
# width queries + viewport units (vw/vh/*-screen) resolve against the studio
# canvas stage, not the fixed artboard box, so they reflow the mock when the
# panel/sidebar/window resizes. Warns only — never fails the exit code.
#
# Usage:
#   smoke.sh [--root <repo>]
#            [--out-dir <dir>]
#            [--include-system 0|1]   (default 1)
#            [--timeout <secs>]       (default 8)
#            [--engine auto|agent-browser|playwright]
#            [--changed-only]         (default off — screenshot only canvases changed
#                                      since the last smoke run; escalates to the full
#                                      set when dev-server / canvas-lib / templates changed)
#            [--perf]                 (also benchmark the heaviest canvas after the sweep
#                                      and append the frame-time / render-count delta to
#                                      the report — see perf.sh)
#
# Reads:
#   $DESIGN_ROOT/_server.json   (must exist — caller runs server-up.sh first)
#   $DESIGN_ROOT/ui/**/*.tsx    (canvases, RECURSIVELY — `--pages` imports
#                               land in ui/<folder>/ and were being missed)
#   $DESIGN_ROOT/system/*/preview/*.tsx   (specimens, when --include-system 1)
#
# Writes:
#   <out-dir>/<slug>.png        (one screenshot per canvas)
#   <out-dir>/report.tsv        (machine-parseable summary)
#   <out-dir>/report.md         (human-readable summary, links every PNG)
#
# Stdout: one line per canvas, tab-separated:
#   STATUS \t FILE \t SCREENSHOT \t DETAIL
# Stderr: diagnostic / progress.
# Exit:   0 = all green / 3 = at least one blank/error/unstyled/broken-img/lint-fail / 1 = missing deps / 2 = bad args.
#
# BROKEN-IMG (agent-browser engine only) flags a VISIBLE <img> that finished
# loading with naturalWidth 0 — a CSP-blocked hotlink or a 404'd local asset the
# user sees as an empty thumbnail. onError-hidden scrap fallbacks are excluded.

REPO=""
OUT_DIR=""
INCLUDE_SYSTEM=1
TIMEOUT=8
ENGINE="auto"
CHANGED_ONLY=0
PERF=0

while [ $# -gt 0 ]; do
  case "$1" in
    --root)           REPO="$2"; shift 2 ;;
    --out-dir)        OUT_DIR="$2"; shift 2 ;;
    --include-system) INCLUDE_SYSTEM="$2"; shift 2 ;;
    --timeout)        TIMEOUT="$2"; shift 2 ;;
    --engine)         ENGINE="$2"; shift 2 ;;
    --changed-only)   CHANGED_ONLY=1; shift ;;
    --perf)           PERF=1; shift ;;
    --help|-h)
      sed -n '2,30p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "smoke.sh: unknown arg '$1' (try --help)" >&2
      exit 2
      ;;
  esac
done

# ---------- resolve repo + design root ----------
if [ -z "$REPO" ]; then
  REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
fi
DESIGN_ROOT="$REPO/.design"
[ -d "$DESIGN_ROOT" ] || { echo "smoke.sh: no .design/ under $REPO" >&2; exit 1; }

STATE="$DESIGN_ROOT/_server.json"
[ -f "$STATE" ] || { echo "smoke.sh: $STATE missing — run server-up.sh first" >&2; exit 1; }

if command -v jq >/dev/null 2>&1; then
  PORT=$(jq -r .port "$STATE" 2>/dev/null)
else
  PORT=$(sed -nE 's/.*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$STATE" | head -n1)
fi
[ -n "$PORT" ] || { echo "smoke.sh: no port in $STATE" >&2; exit 1; }

# ---------- resolve out-dir ----------
if [ -z "$OUT_DIR" ]; then
  TS=$(date +%Y%m%d-%H%M%S)
  OUT_DIR="$DESIGN_ROOT/_history/_smoke/$TS"
fi
mkdir -p "$OUT_DIR"
# agent-browser ignores RELATIVE screenshot paths (writes to ~/.agent-browser/tmp
# instead), which silently strands every PNG. Canonicalize to absolute so the
# captured evidence actually lands in OUT_DIR. See DDR-021.
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

# V2-8.9 round 2 (R2-M1) — "AI may › Search the web: off" holds here too: a canvas the agent wrote
# renders on loopback only (dead loopback proxy, WebRTC pinned, a session of its own). The
# playwright lane goes through screenshot.sh, which sources the same file.
. "$(dirname "$0")/_no-egress.sh"
# p8-e2e-fix-r10: on exit, the page the sweep opened is parked on about:blank and its session closed.
. "$(dirname "$0")/_ab-park.sh"

# ---------- engine resolution ----------
if [ "$ENGINE" = "auto" ]; then
  if command -v agent-browser >/dev/null 2>&1; then
    ENGINE="agent-browser"
  else
    ENGINE="playwright"
  fi
fi
echo "→ smoke engine: $ENGINE | port: $PORT | out: $OUT_DIR" >&2

# ---------- collect canvases ----------
#
# RECURSIVE, and that is a fix, not a preference. This was `-maxdepth 1` and the
# consequence was measured on the first live Figma migration: `--pages` always
# writes to `ui/<folder>/`, so EVERY canvas the primary import route produces was
# invisible here. The run reported "52/52 canvases rendered styled" having never
# looked at the 6 imported pages — green, true, and worthless. The import-graph
# lint below already walks `ui/` recursively, which is exactly why the mismatch
# went unnoticed: the lint covered the imports, the screenshots did not.
#
# A `_`-prefixed DIRECTORY is skipped as well as a `_`-prefixed file, so runtime
# state (`_history/`, `_draw/`, `_smoke/` output itself) never enters the sweep —
# without that, recursing would screenshot our own previous reports.
CANVASES=""
if [ -d "$DESIGN_ROOT/ui" ]; then
  while IFS= read -r f; do
    case "$f" in *'/_'*) continue ;; esac
    CANVASES="$CANVASES$f"$'\n'
  done < <(find "$DESIGN_ROOT/ui" -type f -name '*.tsx' 2>/dev/null | sort)
fi

if [ "$INCLUDE_SYSTEM" = "1" ] && [ -d "$DESIGN_ROOT/system" ]; then
  while IFS= read -r f; do
    base=$(basename "$f")
    case "$base" in _*) continue ;; esac
    CANVASES="$CANVASES$f"$'\n'
  done < <(find "$DESIGN_ROOT/system" -type f -name '*.tsx' -path '*/preview/*' 2>/dev/null | sort)
fi

CANVASES=$(printf '%s' "$CANVASES" | sed '/^$/d')
COUNT=$(printf '%s' "$CANVASES" | grep -c .)
[ "$COUNT" -gt 0 ] || { echo "smoke.sh: no canvases found (ui/**/*.tsx or system/*/preview/*.tsx)" >&2; exit 1; }
echo "→ found $COUNT canvases" >&2

# ---------- --changed-only incremental filter (Phase C / DDR-061) ----------
# Default smoke screenshots every canvas. --changed-only narrows to the canvases
# touched since the last recorded smoke run, UNLESS the diff touches an
# "everything could break" shape (dev-server, canvas-lib, canvas templates) — then
# it escalates back to the full set. Correctness > speed: no baseline, no git, or
# an escalation trigger all fall back to the full set.
MARKER="$DESIGN_ROOT/_history/_smoke/.last-smoke.json"
if [ "$CHANGED_ONLY" = "1" ]; then
  LAST_SHA=""
  if [ -f "$MARKER" ] && command -v jq >/dev/null 2>&1; then
    LAST_SHA=$(jq -r '.sha // empty' "$MARKER" 2>/dev/null)
  fi
  if ! command -v git >/dev/null 2>&1 || ! git -C "$REPO" rev-parse HEAD >/dev/null 2>&1; then
    echo "→ --changed-only: no git in $REPO — running full set" >&2
  elif [ -z "$LAST_SHA" ]; then
    echo "→ --changed-only: no prior smoke baseline ($MARKER) — running full set" >&2
  else
    # All paths changed between the last smoke and the current working tree
    # (committed + uncommitted), plus untracked canvases.
    CHANGED=$(
      { git -C "$REPO" diff --name-only "$LAST_SHA" -- 2>/dev/null
        git -C "$REPO" ls-files --others --exclude-standard -- .design/ui .design/system 2>/dev/null
      } | sort -u
    )
    # `apps/studio/` is the dev server. The pattern used to say `dev-server/`,
    # which is where it lived before the move — so from the rename until
    # 2026-08-06 the escalation silently never fired, and a dev-server change
    # got the narrow "only canvases that changed" sweep instead of the full one.
    # Kept alongside the old path rather than replaced: a --changed-only run in
    # an older checkout should still escalate.
    if printf '%s\n' "$CHANGED" | grep -qE 'apps/studio/|dev-server/|canvas-lib\.tsx|canvas[^/]*\.tsx\.template'; then
      echo "→ --changed-only: dev-server / canvas-lib / template changed — escalating to FULL set" >&2
    else
      # Keep only canvases whose repo-relative path is in the changed set.
      FILTERED=""
      while IFS= read -r CANVAS; do
        [ -z "$CANVAS" ] && continue
        REL_REPO="${CANVAS#$REPO/}"
        if printf '%s\n' "$CHANGED" | grep -qxF "$REL_REPO"; then
          FILTERED="$FILTERED$CANVAS"$'\n'
        fi
      done <<< "$CANVASES"
      CANVASES=$(printf '%s' "$FILTERED" | sed '/^$/d')
      COUNT=$(printf '%s' "$CANVASES" | grep -c .)
      if [ "$COUNT" -eq 0 ]; then
        echo "→ --changed-only: no canvas .tsx changed since last smoke ($LAST_SHA) — nothing to screenshot" >&2
        # Refresh the marker so the next run diffs from here, then exit clean.
        mkdir -p "$(dirname "$MARKER")"
        printf '{"sha":"%s","ts":"%s","mode":"changed-only-noop"}' \
          "$(git -C "$REPO" rev-parse HEAD 2>/dev/null)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MARKER"
        exit 0
      fi
      echo "→ --changed-only: $COUNT changed canvas(es) since $LAST_SHA" >&2
    fi
  fi
fi

# ---------- helpers ----------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SLUG_HELPER="$SCRIPT_DIR/slug.sh"

urlencode_path() {
  # Encode spaces only — leaves /, ., etc alone. Server resolves these.
  printf '%s' "$1" | sed 's/ /%20/g'
}

# Static import-graph lint (DDR-068). Runs once before render. The dev-server
# inlines ONLY the CSS a canvas's import graph produces (canvas-build.ts), so a
# forgotten import is a silently unstyled specimen that still "has content" and
# sails past the per-canvas render checks below. Asserts, per DS preview dir:
#   (1) every specimen reaches `_layout.css` (direct `import`, or its own css
#       `@import`s it) — _layout.css is the single CSS entry that pulls tokens
#       (colors_and_type.css) + controls (_components.css);
#   (2) every shared `preview/_*.css` has >=1 importer (no orphan partial — the
#       class of bug where `.btn`/`.input` in _components.css loaded NOWHERE).
# Appends violations to $MD; sets LINT_FAILED. Anchored to real `^import` lines
# so a specimen that DISPLAYS a css filename in its content isn't a false match.
LINT_FAILED=0
lint_specimen_imports() {
  local SQ Q preview tsx base css imp impfile reached n=0
  SQ=$(printf '\047'); Q="[\"$SQ]"   # bracket class matching either quote style
  for preview in "$DESIGN_ROOT"/system/*/preview; do
    [ -d "$preview" ] || continue
    # (1) every specimen reaches _layout.css
    for tsx in "$preview"/*.tsx; do
      [ -e "$tsx" ] || continue
      base=$(basename "$tsx"); case "$base" in _*) continue ;; esac
      grep -qE "^[[:space:]]*import[^;]*${Q}[^\"$SQ]*_layout\.css" "$tsx" && continue
      reached=0
      while IFS= read -r imp; do
        impfile="$preview/$(basename "$imp")"
        [ -f "$impfile" ] || continue
        if grep -qE "@import[^;]*_layout\.css" "$impfile"; then reached=1; break; fi
      done < <(grep -oE "import[[:space:]]+${Q}[^\"$SQ]*\.css" "$tsx" 2>/dev/null | grep -oE "[^\"$SQ]*\.css$")
      if [ "$reached" -eq 0 ]; then
        printf 'LINT-FAIL  %s — never reaches _layout.css (no DS tokens/layout/components)\n' "${tsx#$DESIGN_ROOT/}" >&2
        printf '| ✗ LINT | `%s` | — | never reaches _layout.css |\n' "${tsx#$DESIGN_ROOT/}" >> "$MD"
        n=$((n + 1))
      fi
    done
    # (2) every shared _*.css partial has an importer
    for css in "$preview"/_*.css; do
      [ -e "$css" ] || continue
      base=$(basename "$css")
      grep -qsE "^[[:space:]]*import[^;]*${Q}[^\"$SQ]*${base}${Q}" "$preview"/*.tsx && continue
      grep -qsE "@import[^;]*${base}" "$preview"/*.css "$preview"/../*.css && continue
      printf 'LINT-FAIL  %s — orphan shared partial (no specimen or css imports it)\n' "${css#$DESIGN_ROOT/}" >&2
      printf '| ✗ LINT | `%s` | — | orphan shared partial |\n' "${css#$DESIGN_ROOT/}" >> "$MD"
      n=$((n + 1))
    done
  done
  LINT_FAILED=$n
  if [ "$n" -eq 0 ]; then
    echo "→ import-graph lint: clean" >&2
  else
    echo "✗ import-graph lint: $n violation(s) — see report" >&2
  fi
}

# Static artboard-isolation lint (advisory). An artboard is a fixed-size design
# surface, but `@media` width queries + viewport units (vh/vw/vmin/vmax + the
# dynamic svh/dvh/lvh family, incl. Tailwind's *-screen utilities) resolve
# against the IFRAME VIEWPORT — i.e. the studio's canvas stage — not the
# artboard box. So a ui/ mock that uses them reflows when the Assistant panel /
# sidebar / window resizes, even at a fixed zoom. `container-type` on
# .dc-artboard-body (canvas-lib ENGINE_CSS) gives an isolated responsive path
# via @container + cqw/cqh; viewport units still escape by spec. This warns —
# it never fails the exit code (existing DS canvases legitimately use vw/vh in
# full-bleed specimens, and the fix is an author rewrite, not a smoke gate).
# Scopes ui/ canvases + their sibling .css only (preview specimens render
# standalone, so viewport units there are fine). Sets ISO_WARN.
ISO_WARN=0
lint_artboard_isolation() {
  local f n=0 hits total=0 pat
  # Length units (vh/vw/…), Tailwind *-screen utilities, raw viewport @media.
  pat='[0-9.]+(vh|vw|vmin|vmax|dvh|svh|lvh|dvw|svw|lvw)([^a-z]|$)|(min-|max-)?[hw]-screen|@media[[:space:]]*\((min|max)-width'
  [ -d "$DESIGN_ROOT/ui" ] || { echo "→ artboard-isolation lint: no ui/ dir — skipped" >&2; return; }
  while IFS= read -r f; do
    [ -e "$f" ] || continue
    case "$(basename "$f")" in _*) continue ;; esac
    hits=$(grep -cnE "$pat" "$f" 2>/dev/null || true)
    [ "${hits:-0}" -gt 0 ] || continue
    n=$((n + 1)); total=$((total + hits))
    printf 'ISO-WARN   %s — %s viewport-escape(s) (@media/vw/vh/*-screen leak to the studio stage)\n' "${f#$DESIGN_ROOT/}" "$hits" >&2
    printf '| ⚠ ISO | `%s` | — | %s viewport-escape(s) — use %%%%/px or @container+cqw |\n' "${f#$DESIGN_ROOT/}" "$hits" >> "$MD"
  done < <(find "$DESIGN_ROOT/ui" -type f \( -name '*.tsx' -o -name '*.css' \) 2>/dev/null | sort)
  ISO_WARN=$n
  if [ "$n" -eq 0 ]; then
    echo "→ artboard-isolation lint: clean" >&2
  else
    echo "⚠ artboard-isolation lint: $n file(s), $total viewport-escape(s) — advisory, see report" >&2
  fi
}

# Probe a canvas via agent-browser. Returns three lines on stdout:
#   <status>   one of OK / BLANK / ERROR
#   <detail>   short summary string
#   <screenshot-path-or-empty>
probe_agent_browser() {
  local url="$1"
  local out_png="$2"
  local is_specimen="$3"   # 1 → apply the DDR-068 computed-style gate

  agent-browser open "$url" >/dev/null 2>&1 || { echo "ERROR"; echo "open-failed"; echo ""; return; }

  # Poll for any DC marker — [data-dc-screen], [data-dc-slot], [data-cd-id].
  # Specimens may not have any of these, so we also accept body innerText > 0.
  local poll=0
  local mounted=0
  while [ $poll -lt "$TIMEOUT" ]; do
    sleep 1
    poll=$((poll + 1))
    local raw
    raw=$(agent-browser eval "document.querySelectorAll('[data-dc-screen],[data-dc-slot],[data-cd-id]').length + (document.body && document.body.innerText.trim().length > 0 ? 1000 : 0)" 2>/dev/null)
    raw=$(printf '%s' "$raw" | tr -d '[:space:]')
    case "$raw" in
      ''|*[!0-9]*) continue ;;
      0) continue ;;
      *) mounted=1; break ;;
    esac
  done

  # Capture screenshot regardless — the PNG is evidence even on failure.
  agent-browser screenshot --full "$out_png" >/dev/null 2>&1 || true

  if [ $mounted -eq 0 ]; then
    echo "BLANK"
    echo "no-dc-markers-no-text-after-${TIMEOUT}s"
    echo "$out_png"
    return
  fi

  # Probe for visible error overlays (react-error-overlay, common patterns).
  local err
  err=$(agent-browser eval "(() => {
    const sel = ['#__react-error-overlay', '.react-error-overlay', '[data-error-overlay]', 'pre.error-stack'];
    for (const s of sel) { const el = document.querySelector(s); if (el && el.innerText) return el.innerText.slice(0, 120); }
    const body = document.body && document.body.innerText || '';
    if (body.startsWith('Error:') || body.startsWith('SyntaxError:') || body.startsWith('ReferenceError:')) return body.slice(0, 120);
    const t = body.trim();
    if (t === 'Not found' || t.startsWith('Forbidden (canvas origin)')) return 'route-error: ' + t.slice(0, 80);
    return '';
  })()" 2>/dev/null)
  # Strip wrapping quotes that agent-browser eval adds for strings.
  err=$(printf '%s' "$err" | sed 's/^"//; s/"$//; s/^\\n//; s/\\n$//')

  if [ -n "$err" ] && [ "$err" != "null" ] && [ "$err" != "undefined" ]; then
    echo "ERROR"
    echo "$err"
    echo "$out_png"
    return
  fi

  # The PNG IS the evidence (DDR-021). A missing/empty file means agent-browser
  # never wrote it (relative path, capture crash, …) — that is a FAILURE, not an
  # OK. The old code fell straight through to "OK" here, which is exactly how a
  # broken canvas route ("Not found" 404 + no PNG) masqueraded as 43/43 green.
  if [ ! -s "$out_png" ]; then
    echo "ERROR"
    echo "screenshot-not-written"
    echo "$out_png"
    return
  fi
  # PNG size sanity — < 2 KB usually means blank background only.
  local size
  size=$(wc -c < "$out_png" 2>/dev/null | tr -d ' ')
  if [ -n "$size" ] && [ "$size" -lt 2048 ]; then
    echo "BLANK"
    echo "png-${size}B"
    echo "$out_png"
    return
  fi

  # Broken-image gate (DDR-147 / 2026-07-06 RCA) — the moodboard + DS specimens
  # fill photo slots with web imagery; a hotlink blocked by the canvas CSP
  # (`img-src 'self'`, default-on split origin) or a 404'd local path renders as
  # an empty "broken image" thumbnail the user sees but every check above sails
  # past (it has text, no error, a >2 KB screenshot). Flag any <img> that
  # FINISHED loading with naturalWidth 0 AND is actually VISIBLE — a slot whose
  # `onError` hid the img and swapped in a scrap (display:none / hidden / opacity
  # 0) is a graceful degrade, NOT a failure, so it's excluded. Catches the class
  # of regression where download-first silently stopped working.
  local broken
  broken=$(agent-browser eval "(() => {
    const bad = [...document.querySelectorAll('img')].filter((im) => {
      if (!im.complete || im.naturalWidth > 0) return false;
      const src = (im.getAttribute('src') || '').trim();
      if (!src || src.startsWith('data:')) return false;
      const cs = getComputedStyle(im);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      return true;
    });
    if (!bad.length) return '';
    const sample = bad.slice(0, 2).map((im) => (im.currentSrc || im.getAttribute('src') || '').slice(0, 60)).join(', ');
    return bad.length + ' broken img(s): ' + sample;
  })()" 2>/dev/null)
  broken=$(printf '%s' "$broken" | sed 's/^\"//; s/\"$//')
  if [ -n "$broken" ] && [ "$broken" != "null" ] && [ "$broken" != "undefined" ]; then
    echo "BROKEN-IMG"
    echo "$broken"
    echo "$out_png"
    return
  fi

  # Computed-style gate (DDR-068) — "mounts with content" ≠ "rendered styled". A
  # specimen whose import graph dropped the token CSS passes every check above
  # (it has text, no error, a >2 KB screenshot) yet every var()-driven rule is
  # dead. Confirm the DS token contract actually resolved at runtime: --bg-0 is
  # defined on :root by colors_and_type.css (DDR-043 name contract) and inherits
  # to <body>, so an empty value means the token CSS never loaded. Scoped to DS
  # preview specimens — ui/ app canvases may legitimately opt out of the tokens.
  if [ "$is_specimen" = "1" ]; then
    local styled
    styled=$(agent-browser eval "(() => {
      const b = document.body; if (!b) return 'unstyled:no-body';
      const cs = getComputedStyle(b);
      const tok = (cs.getPropertyValue('--bg-0').trim() || cs.getPropertyValue('--fg-0').trim() || cs.getPropertyValue('--accent').trim());
      if (tok) return 'styled';
      return 'unstyled:no-tokens(ff=' + ((cs.fontFamily||'').replace(/[\"\\n]/g,'').slice(0,18)) + ')';
    })()" 2>/dev/null)
    styled=$(printf '%s' "$styled" | sed 's/^"//; s/"$//')
    # Only an EXPLICIT unstyled* verdict fails — a blank/garbled eval (browser
    # hiccup) falls through to OK, since the DOM already mounted without error.
    case "$styled" in
      unstyled*)
        echo "UNSTYLED"
        echo "$styled"
        echo "$out_png"
        return
        ;;
    esac
  fi

  echo "OK"
  echo "ok"
  echo "$out_png"
}

# ---------- iterate ----------
TSV="$OUT_DIR/report.tsv"
MD="$OUT_DIR/report.md"
printf 'status\tfile\tscreenshot\tdetail\n' > "$TSV"
{
  echo "# Smoke report — $(date '+%Y-%m-%d %H:%M:%S')"
  echo
  echo "- repo: \`$REPO\`"
  echo "- port: $PORT"
  echo "- canvases: $COUNT"
  echo
  echo "| status | file | screenshot | detail |"
  echo "|---|---|---|---|"
} > "$MD"

# Static import-graph lint before rendering (DDR-068) — only meaningful when
# system specimens are in scope (they own the shared _layout.css / _components.css
# chain). Violations are folded into the final exit code alongside render fails.
if [ "$INCLUDE_SYSTEM" = "1" ] && [ -d "$DESIGN_ROOT/system" ]; then
  lint_specimen_imports
fi
# Artboard-isolation lint always runs (ui/ canvases are always in scope). Advisory.
lint_artboard_isolation

FAILED=0
N=0
# A sweep never leaves a canvas open as a collab peer (_ab-park.sh); the loop below opens one per canvas.
[ "$ENGINE" = "agent-browser" ] && ab_park_arm
while IFS= read -r CANVAS; do
  [ -z "$CANVAS" ] && continue
  N=$((N + 1))
  REL="${CANVAS#$DESIGN_ROOT/}"
  REL_ENC=$(urlencode_path "$REL")
  # Canvases render through the canvas shell, not the bare path. The bare
  # `/<rel>` route 404s when the canvas-origin sandbox is on (default since
  # phase-9.1) — only `/_canvas-shell.html?canvas=<rel>` mounts the canvas
  # (works in both split-on and legacy same-origin modes).
  URL="http://localhost:$PORT/_canvas-shell.html?canvas=$REL_ENC"
  . "$SCRIPT_DIR/_url-guard.sh" && maude_url_guard "$URL" || exit 2 # V2-8.9 B2 — http(s) to this Mac only
  SLUG=$(bash "$SLUG_HELPER" "$REL" 2>/dev/null || printf '%s' "$REL" | tr '/ ' '__' | tr '[:upper:]' '[:lower:]')
  OUT_PNG="$OUT_DIR/$SLUG.png"
  # DS preview specimens get the computed-style gate; ui/ app canvases don't.
  case "$REL" in system/*/preview/*) IS_SPECIMEN=1 ;; *) IS_SPECIMEN=0 ;; esac

  printf '  [%d/%d] %s … ' "$N" "$COUNT" "$REL" >&2

  if [ "$ENGINE" = "agent-browser" ]; then
    RESULT=$(probe_agent_browser "$URL" "$OUT_PNG" "$IS_SPECIMEN")
  else
    # Playwright fallback — coarser: just screenshot, accept any PNG > 2 KB as OK.
    # See _screenshot-playwright.mjs for the underlying tool.
    bash "$SCRIPT_DIR/screenshot.sh" --url "$URL" --full --out "$OUT_PNG" --engine playwright --timeout "$TIMEOUT" >/dev/null 2>&1
    if [ -s "$OUT_PNG" ]; then
      SIZE=$(wc -c < "$OUT_PNG" | tr -d ' ')
      if [ "$SIZE" -lt 2048 ]; then
        RESULT=$'BLANK\npng-'"$SIZE"$'B\n'"$OUT_PNG"
      else
        RESULT=$'OK\nok\n'"$OUT_PNG"
      fi
    else
      RESULT=$'ERROR\nno-png\n'"$OUT_PNG"
    fi
  fi

  STATUS=$(printf '%s\n' "$RESULT" | sed -n '1p')
  DETAIL=$(printf '%s\n' "$RESULT" | sed -n '2p')
  SHOT=$(printf '%s\n' "$RESULT" | sed -n '3p')

  case "$STATUS" in
    OK)         SYM="✓"; echo "$SYM" >&2 ;;
    BLANK)      SYM="✗"; FAILED=$((FAILED + 1)); echo "$SYM blank ($DETAIL)" >&2 ;;
    ERROR)      SYM="⚠"; FAILED=$((FAILED + 1)); echo "$SYM error ($DETAIL)" >&2 ;;
    UNSTYLED)   SYM="✗"; FAILED=$((FAILED + 1)); echo "$SYM unstyled ($DETAIL)" >&2 ;;
    BROKEN-IMG) SYM="✗"; FAILED=$((FAILED + 1)); echo "$SYM broken-img ($DETAIL)" >&2 ;;
    *)          SYM="?"; FAILED=$((FAILED + 1)); echo "? unknown ($STATUS)" >&2 ;;
  esac

  printf '%s\t%s\t%s\t%s\n' "$STATUS" "$REL" "$SHOT" "$DETAIL" >> "$TSV"
  printf '| %s %s | `%s` | [`%s`](%s) | %s |\n' "$SYM" "$STATUS" "$REL" "$(basename "$SHOT")" "$(basename "$SHOT")" "$DETAIL" >> "$MD"

  printf '%s\t%s\t%s\t%s\n' "$STATUS" "$REL" "$SHOT" "$DETAIL"
done <<< "$CANVASES"

TOTAL_FAIL=$((FAILED + LINT_FAILED))
{
  echo
  if [ $TOTAL_FAIL -eq 0 ]; then
    echo "**Result:** ✓ all $COUNT canvases rendered styled; import-graph lint clean."
  else
    echo "**Result:** ✗ $FAILED / $COUNT canvases failed render/style; $LINT_FAILED import-graph lint violation(s)."
  fi
  if [ "${ISO_WARN:-0}" -gt 0 ]; then
    echo
    echo "> ⚠ **Artboard isolation:** $ISO_WARN ui/ file(s) use viewport-escaping CSS (\`@media\`/\`vw\`/\`vh\`/\`*-screen\`) that reflows with the studio chrome. Advisory — not a failure. Replace with fixed px / \`%\` / \`@container\`+\`cqw\`."
  fi
} >> "$MD"

# ---------- optional perf pass (--perf) ----------
# Smoke answers "does it still render"; this answers "is it still fast", against
# the same canvases, in the same run. The heaviest canvas (most artboards) is the
# one worth timing — a 1-artboard specimen has nothing to say about pan/zoom.
if [ "$PERF" = "1" ]; then
  HEAVIEST=""
  HEAVIEST_N=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    n=$(grep -c 'DCArtboard' "$f" 2>/dev/null || echo 0)
    if [ "$n" -gt "$HEAVIEST_N" ]; then HEAVIEST_N="$n"; HEAVIEST="$f"; fi
  done <<< "$CANVASES"
  if [ -n "$HEAVIEST" ]; then
    REL_PERF="${HEAVIEST#"$REPO"/}"
    echo "→ perf: benchmarking heaviest canvas ($HEAVIEST_N artboards): $REL_PERF" >&2
    {
      echo ""
      echo "## Perf"
      echo ""
      echo '```'
      bash "$(dirname "${BASH_SOURCE[0]}")/perf.sh" --root "$REPO" --canvas "$REL_PERF" 2>&1 || \
        echo "(perf run failed — see stderr; smoke result above is unaffected)"
      echo '```'
    } >> "$MD"
  fi
fi

echo "→ report: $MD" >&2
echo "→ tsv:    $TSV" >&2

# Record this run as the baseline for the next --changed-only diff (Phase C / DDR-061).
if command -v git >/dev/null 2>&1 && git -C "$REPO" rev-parse HEAD >/dev/null 2>&1; then
  mkdir -p "$DESIGN_ROOT/_history/_smoke"
  printf '{"sha":"%s","ts":"%s","mode":"%s","count":%d,"failed":%d}' \
    "$(git -C "$REPO" rev-parse HEAD 2>/dev/null)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$([ "$CHANGED_ONLY" = "1" ] && echo changed-only || echo full)" "$COUNT" "$FAILED" \
    > "$DESIGN_ROOT/_history/_smoke/.last-smoke.json"
fi

if [ $TOTAL_FAIL -gt 0 ]; then
  echo "✗ smoke: $FAILED / $COUNT canvases failed render/style; $LINT_FAILED lint violation(s)" >&2
  exit 3
fi
echo "✓ smoke: all $COUNT canvases rendered styled; import-graph lint clean" >&2
exit 0
