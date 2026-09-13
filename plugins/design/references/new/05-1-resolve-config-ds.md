### 1. Resolve config + DS

Invoke skill `design` with the input: `new $ARGUMENTS`.

**Video-comp brief cue (DDR-148).** When the brief describes a **video / animation / motion-graphic** deliverable — cues like `video`, `animace`/`animation`, `klip`/`clip`, `mp4`, `gif`, `showreel`, `trailer`, `title sequence`/`titulek`, `motion graphic`, `hudba`/`music`, `explainer`, `intro/outro` — also load skill **`design:video-comp`** and scaffold the artboard body as a `<VideoComp>` Remotion composition (frame-driven, `assets/` media, bundled imports only) instead of a static mock. The rest of the envelope (`DesignCanvas`/`DCSection`/`DCArtboard`, DS tokens) is unchanged.

**Print brief cue (feature-2-print-artboards).** When the brief describes a **physical print piece** — cues like `letak`/`plakat`/`vizitka`/`brozura`/`leták`/`plakát`/`vizitka`/`brožura` (Czech), `flyer`/`poster`/`business card`/`brochure`/`print`/`tisk`/`A4`/`A5`/`A3`/`envelope`/`postcard`, or an explicit paper size — set `kind="print"` on the artboard(s) and author a `print` prop (`apps/studio/print/units.ts` `PAPER_PRESETS` — pick the closest match; default `paper:'a4'` when the brief names no specific size) with the preset's own default bleed (omit `bleedMm` to inherit 3mm EU / 0.125in US) and DO NOT hand-author `width`/`height` — call `resolvePrintArtboard({paper, orientation, bleedMm})` (or, in-canvas, use the Inspector's paper picker per T2) to get the resolved px size, since the artboard IS the bleed box (trim + 2×bleed, Design Decision 1) and a hand-guessed px size will desync from the paper preset. Generation rules for a print artboard:
- **Absolute-first composition** — a print page has no responsive breakpoints or scroll; lay out with fixed positions/sizes against the artboard's own resolved px box, not flex-grow/fill patterns meant for a screen.
- **Backgrounds extend to the bleed edge** — any full-bleed background/photo/color fill must cover the ENTIRE artboard (0 to `width`/`height`), not just the trim-inset area, so nothing white shows at the cut edge. Toggle the print guides overlay (View menu → "Show print guides", T3) while iterating to see the trim/margin lines.
- **Critical content stays inside the safe margin** — headlines, logos, and anything that must not get trimmed away belong inside the margin-inset box (default 5mm on all sides, `print.marginsMm`), never flush against the trim line.
- **Prefer TTF over OTF** for any custom/embedded font — Chromium's print pipeline outlines OTF glyphs to paths (T5 gotcha), which is fine visually but loses text-selectability/searchability in the exported PDF.
- The existing **no viewport-length-units rule** (below) already covers print artboards — a fixed-mm-derived px canvas has no viewport to size against.

Pass the user's brief **verbatim** to generation (CLAUDE.md rule) — this cue only changes what gets SCAFFOLDED (`kind`, `print` prop, layout rules above), never rewrites or annotates the brief text itself.

**Marketing-graphic brief cue (feature-4, 2026-07-19).** When the brief describes a **fixed-size marketing/graphic composition** — cues like `social post`, `banner`, `Instagram`/`IG post`/`story`, `thumbnail`, `cover`, `og image`, `ad`/`reklama`, `grafika`, or any fixed-canvas visual that is NOT a UI screen and NOT a physical print piece — keep `kind` digital (the default) and author **absolute-first**, exactly like the print rule above: elements get `position: absolute` boxes inside a `position: relative` root (or the artboard body itself, which is already `relative`), NOT flex/grid flow. Rationale: these artboards are edited by freely dragging elements (the "Convert layout to absolute" flow exists precisely to retrofit this) — authoring them absolute from the start means zero conversion and instantly draggable output. **UI mocks (screens, dashboards, app flows) stay flow-first** — absolute-first applies only when the deliverable is a graphic composition. The same applies when EDITING an artboard whose elements are already predominantly absolute: preserve the absolute model, never "clean it up" into flex.

**Per-instance positions for reused components.** When a reusable component is instanced across several artboards and an instance needs its own position/size, write the `left`/`top`/`width`/`height` (or transform) on the **`<Component/>` usage tag** (each usage styles independently — the Stage-H3 local-instance model), never on the element inside the shared definition (that moves every instance). If an inner element genuinely needs per-instance styling beyond the box, **detach the instance first** (the Inspector's Detach button clones the definition + repoints that one usage), then edit the detached copy.

**Web brief cue (feature-3-web-artboards).** When the brief describes a **responsive web flow** — cues like `web`, `landing`, `landing page`, `stranka`/`stránka`, `webovka`/`webovky`, `website`, `homepage`, `marketing site`, `SaaS`, `web app`, or an explicit breakpoint/viewport mention — set `kind="web"` on the artboard(s). Generation rules for a web artboard:
- **Flow-first composition** — flex/grid (or plain block flow), never absolute positioning as the default layout mechanism. Absolute positioning is reserved for a deliberate overlay (a badge, a floating CTA) and MUST carry a one-line JSX comment naming why it's an overlay, not a layout escape.
- **Hug height, not fixed** — omit the artboard's `fixed` prop (or leave it falsy) so `height` is a floor, not an exact box; the artboard grows to its content, matching how a real web page has no bottom edge until content runs out.
- **Width is the breakpoint** — pick the artboard's `width` from the breakpoint preset table (T2: mobile 390 / tablet 834 / laptop 1280 / desktop 1440, same values as `SCREEN_PRESETS`) rather than an arbitrary number, so the artboard reads as "this is the 1280px layout" rather than a one-off size.
- **In-artboard responsiveness via `@container`, never `vw`/`vh`/`@media`** — the artboard body is already a `container-type: inline-size` root (see "Artboard isolation" below), so `@container`/`cqw`/`cqh` rules respond to the artboard's own width. This is how ONE web artboard can carry responsive behavior for reflow-testing (T4) without violating the existing viewport-isolation ban.
- **Multiple breakpoints are separate artboards, not one artboard with media queries.** Author the primary breakpoint, then use the artboard-chrome/Inspector **"Duplicate at width…"** action (T3) to clone it at another breakpoint — a structural copy the agent (or the clone's own `@container` rules) then adapts, not a linked/synced variant.

Pass the user's brief **verbatim** to generation (CLAUDE.md rule) — this cue only changes what gets SCAFFOLDED (`kind`, flow-first layout, breakpoint width), never rewrites or annotates the brief text itself.

**One pre-flight call instead of 4–8 sequential jq reads.** `prep.sh` reads `.design/config.json` + `_active.json` + `_preflight.json` + `_server.json` in a single pass and exports the resolved vars (`REPO_ROOT`, `NAME`, `DESIGN_ROOT`, `ROOT_CLASS`, `THEME`, `TOKENS_REL`, `NEW_CANVAS_DIR`, `NEW_COMPONENT_DIR`, `TEAM_ACCENT`, `DEFAULT_DS`, `KNOWN_DS`, `ACCENT_STRATEGY`, `COLOR_SPACE`, `DEPS_OK`, `DEPS_MISSING`, `SERVER_UP`, `SERVER_PORT`). The DS-presence gate (`bootstrap-check.sh`, step 0) stays separate — it owns the 0/10/11 exit-code contract.

```bash
eval "$(maude design prep --shell-export --shape new --root "$REPO_ROOT")"
CFG="$REPO_ROOT/.design/config.json"
TEAM_DEFAULT="$TEAM_ACCENT"   # downstream alias

# Resolve target DS (multi-DS aware) — DEFAULT_DS / KNOWN_DS already exported by prep.sh
DS_FLAG=$(grep -oE -- '--ds=[a-z][a-z0-9-]*' <<< "$ARGS" | cut -d= -f2)
TARGET_DS="${DS_FLAG:-$DEFAULT_DS}"

# Validate against designSystems[]
KNOWN=$(jq -r '.designSystems // [] | map(.name) | join(",")' "$CFG")
if [[ -n "$DS_FLAG" ]]; then
  if ! jq -e --arg ds "$DS_FLAG" '.designSystems // [] | any(.name == $ds)' "$CFG" > /dev/null; then
    echo "Error: design system \"$DS_FLAG\" not found in config.json.designSystems[]."
    echo "Available: ${KNOWN:-<none>}"
    echo "To create: /design:setup-ds $DS_FLAG \"<brief>\""
    exit 1
  fi
fi

# Resolve DS-specific paths
DS_TOKENS=$(jq -r --arg ds "$TARGET_DS" '.designSystems[] | select(.name == $ds) | .path + "/colors_and_type.css" // empty' "$CFG")
DS_ROOT=$(jq -r --arg ds "$TARGET_DS"   '.designSystems[] | select(.name == $ds) | .path // empty' "$CFG")
# Fallback to single-DS layout if designSystems[] is empty
[[ -z "$DS_ROOT" ]] && DS_ROOT="system/project" && DS_TOKENS="$TOKENS_REL"

# Resolve declared themes[] — the ONLY authoritative dual-theme signal (never
# config.themeDefault, whose schema enum is dark|light only and can't hold
# "both"). Drives step 9's dual-theme reality-check capture below. A DS entry
# that predates this field (no `themes[]` written) falls back to just $THEME —
# conservative default, no second capture pass triggered on unknown info.
DS_THEMES=$(jq -r --arg ds "$TARGET_DS" --arg dt "$THEME" \
  '.designSystems[] | select(.name == $ds) | (.themes // [$dt] | join(","))' "$CFG")
[[ -z "$DS_THEMES" ]] && DS_THEMES="$THEME"
ALT_THEME=$(tr ',' '\n' <<< "$DS_THEMES" | grep -v -x -F "$THEME" | head -n1)
# ALT_THEME feeds a filesystem path (step 9's $HIST/theme-$ALT_THEME) AND the
# screenshot helper's --theme flag — config.json's themes[] is untrusted (same
# posture as MOODBOARD_VARIANTS above), so reject anything outside a safe slug
# charset rather than let a crafted ["dark","../../etc"] entry escape _history/.
if [[ -n "$ALT_THEME" && ! "$ALT_THEME" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "→ ignoring malformed theme name in designSystems[$TARGET_DS].themes — skipping dual-theme capture" >&2
  ALT_THEME=""
fi
```
