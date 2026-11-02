### 1. Resolve config + DS

Invoke skill `design` with the input: `new $ARGUMENTS`.

**Choose each artboard's kind and size from the catalogue, not from the brief's wording.** The kinds are Fixed size (`digital`), Web page, Print and Video; the picker groups them as App · Web page · Social · Print · Video, and every group's presets are in [Artboards of a kind](../../skills/design/_guide-28-artboards.md). The cues below decide the group; the guide gives the exact `<DCArtboard>` for a preset (its `kind`, `fixed`, `print` prop and the px size). Never guess a px size for a preset, and never write `paper: "custom"`.

**Video-comp brief cue (DDR-148).** When the brief describes a **video / animation / motion-graphic** deliverable — cues like `video`, `animace`/`animation`, `klip`/`clip`, `mp4`, `gif`, `showreel`, `trailer`, `title sequence`/`titulek`, `motion graphic`, `hudba`/`music`, `explainer`, `intro/outro` — use the **Video** group (Reels 9:16, Landscape 16:9 or Square 1:1, 30 fps), also load skill **`design:video-comp`** and author the artboard body as a `<VideoComp>` Remotion composition (frame-driven, `assets/` media, bundled imports only) instead of a static mock. The rest of the envelope (`DesignCanvas`/`DCSection`/`DCArtboard`, DS tokens) is unchanged.

**Print brief cue (feature-2-print-artboards).** When the brief describes a **physical print piece** — cues like `letak`/`plakat`/`vizitka`/`brozura`/`leták`/`plakát`/`vizitka`/`brožura` (Czech), `flyer`/`poster`/`business card`/`brochure`/`print`/`tisk`/`A4`/`A5`/`A3`/`envelope`/`postcard`, or an explicit paper size — use the **Print** group: `kind="print"` with the `print` prop of the closest paper (A4 when the brief names none; a size in mm that is not a paper is the Custom size row of the guide). The artboard IS the bleed box (trim + 2 × bleed, Design Decision 1), so copy the `width` / `height` the guide gives for that paper; a hand-guessed px size desyncs from the paper. Generation rules for a print artboard:
- **Absolute-first composition** — a print page has no responsive breakpoints or scroll; lay out with fixed positions/sizes against the artboard's own resolved px box, not flex-grow/fill patterns meant for a screen.
- **Backgrounds extend to the bleed edge** — any full-bleed background/photo/color fill must cover the ENTIRE artboard (0 to `width`/`height`), not just the trim-inset area, so nothing white shows at the cut edge. Turn on the print guides while iterating (Menu › View › Advanced ▸ Print guides) to see the trim and margin lines.
- **Critical content stays inside the safe margin** — headlines, logos, and anything that must not get trimmed away belong inside the margin-inset box (default 5mm on all sides, `print.marginsMm`), never flush against the trim line.
- **Prefer TTF over OTF** for any custom/embedded font — Chromium's print pipeline outlines OTF glyphs to paths (T5 gotcha), which is fine visually but loses text-selectability/searchability in the exported PDF.
- The existing **no viewport-length-units rule** (below) already covers print artboards — a fixed-mm-derived px canvas has no viewport to size against.

Pass the user's brief **verbatim** to generation (CLAUDE.md rule) — this cue only changes what gets DRAFTED (`kind`, `print` prop, layout rules above), never rewrites or annotates the brief text itself.

**Marketing-graphic brief cue (feature-4, 2026-07-19).** When the brief describes a **fixed-size marketing/graphic composition** — cues like `social post`, `banner`, `Instagram`/`IG post`/`story`, `thumbnail`, `cover`, `og image`, `ad`/`reklama`, `grafika`, or any fixed-canvas visual that is NOT a UI screen and NOT a physical print piece — use the **Social** group (Post 4:5, Story 9:16 (still), FB event cover, Post 1:1, Link preview, YouTube thumbnail): a Fixed size artboard, `kind="digital" fixed`. Author it **absolute-first**, exactly like the print rule above: elements get `position: absolute` boxes inside a `position: relative` root (or the artboard body itself, which is already `relative`), NOT flex/grid flow. Rationale: these artboards are edited by freely dragging elements (the "Convert layout to absolute" flow exists precisely to retrofit this) — authoring them absolute from the start means zero conversion and instantly draggable output. **UI mocks (screens, dashboards, app flows) use the App group and stay flow-first** — absolute-first applies only when the deliverable is a graphic composition. The same applies when EDITING an artboard whose elements are already predominantly absolute: preserve the absolute model, never "clean it up" into flex.

**Per-instance positions for reused components.** When a reusable component is instanced across several artboards and an instance needs its own position/size, write the `left`/`top`/`width`/`height` (or transform) on the **`<Component/>` usage tag** (each usage styles independently — the Stage-H3 local-instance model), never on the element inside the shared definition (that moves every instance). If an inner element genuinely needs per-instance styling beyond the box, **detach the instance first** (the Inspector's Detach button clones the definition + repoints that one usage), then edit the detached copy.

**Web brief cue (feature-3-web-artboards).** When the brief describes a **responsive web flow** — cues like `web`, `landing`, `landing page`, `stranka`/`stránka`, `webovka`/`webovky`, `website`, `homepage`, `marketing site`, `SaaS`, `web app`, or an explicit breakpoint/viewport mention — use the **Web page** group (`kind="web"`). Generation rules for a web artboard:
- **Flow-first composition** — flex/grid (or plain block flow), never absolute positioning as the default layout mechanism. Absolute positioning is reserved for a deliberate overlay (a badge, a floating CTA) and MUST carry a one-line JSX comment naming why it's an overlay, not a layout escape.
- **Hug height, not fixed** — omit the artboard's `fixed` prop so `height` is a floor, not an exact box; the artboard grows to its content, matching how a real web page has no bottom edge until content runs out.
- **Width is the breakpoint** — take the `width` from the Web page presets (Mobile 390 / Tablet 834 / Laptop 1280 / Desktop 1440) rather than an arbitrary number, so the artboard reads as "this is the 1280px layout" rather than a one-off size.
- **In-artboard responsiveness via `@container`, never `vw`/`vh`/`@media`** — the artboard body is already a `container-type: inline-size` root (see "Artboard isolation" below), so `@container`/`cqw`/`cqh` rules respond to the artboard's own width. This is how ONE web artboard can carry responsive behavior for reflow-testing without violating the existing viewport-isolation ban.
- **Multiple breakpoints are separate artboards, not one artboard with media queries.** Author the primary breakpoint, then add the others as further Web page artboards (or ask the person to use the artboard menu's "Duplicate at another width") — a structural copy the agent (or the clone's own `@container` rules) then adapts, not a linked/synced variant.

Pass the user's brief **verbatim** to generation (CLAUDE.md rule) — this cue only changes what gets DRAFTED (`kind`, flow-first layout, breakpoint width), never rewrites or annotates the brief text itself.

**The run folder.** The design plugin's hook names it once per conversation, in a line like `Maude run folder for this conversation: .design/_runs/<session>/ (run id r_…)`. Use that folder as `RUN`. No such line (hooks off, or a host without plugin hooks): `RUN=.design/_runs/local/`. Screenshots, the envelope, research and critic hand-offs for this canvas go under it (`$RUN/shots/`, `$RUN/research/`, `$RUN/handoff/`, `$RUN/critique/`). It is runtime state: never versioned, never synced, pruned after a week.

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
# ALT_THEME feeds a filesystem path (step 9's $RUN/shots/theme-$ALT_THEME) AND the
# screenshot helper's --theme flag — config.json's themes[] is untrusted (same
# posture as MOODBOARD_VARIANTS above), so reject anything outside a safe slug
# charset rather than let a crafted ["dark","../../etc"] entry escape the run folder.
if [[ -n "$ALT_THEME" && ! "$ALT_THEME" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "→ ignoring malformed theme name in designSystems[$TARGET_DS].themes — skipping dual-theme capture" >&2
  ALT_THEME=""
fi

mkdir -p "$RUN/shots" "$RUN/research"
```
