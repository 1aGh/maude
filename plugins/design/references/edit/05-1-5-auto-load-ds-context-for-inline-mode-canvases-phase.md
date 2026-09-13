### 1.5 Auto-load DS context for inline-mode canvases (Phase 3.6 Task 12c)

When the canvas is `.tsx` + `css_mode: "inline"` AND the feedback is about styling (classes, spacing, colors, borders, radii, …) OR `_active.json.selected.id` is set, **pre-load** the DS's `_components.css` + `colors_and_type.css` into the orchestrator's context BEFORE dispatching to `frontend-design`. Cost: ~6 KB CSS read per qualifying edit; saves the ~30 KB "Claude re-grep'd `_components.css` mid-edit" round-trip that empirically slows token-cheap iteration.

```bash
# Resolve the active canvas's meta sidecar; bail early on non-tsx, non-inline,
# or when there's no _components.css to load.
ABS_ACTIVE="$REPO_ROOT/$DESIGN_ROOT/${ACTIVE#$DESIGN_ROOT/}"
META_PATH="${ABS_ACTIVE%.*}.meta.json"
CSS_MODE=$(jq -r '.css_mode // "inline"' "$META_PATH" 2>/dev/null || echo "inline")

LOAD_CSS=0
# Heuristic — case-insensitive match against style verbs. Bound and conservative;
# err toward loading when in doubt (~6 KB is cheap).
case "$ARGUMENTS" in
  *color*|*COLOR*|*Color*|\
  *padding*|*PADDING*|*Padding*|\
  *spacing*|*SPACING*|*Spacing*|\
  *margin*|*MARGIN*|*Margin*|\
  *border*|*BORDER*|*Border*|\
  *radius*|*RADIUS*|*Radius*|\
  *shadow*|*SHADOW*|*Shadow*|\
  *background*|*BACKGROUND*|\
  *className*|*class\ name*|\
  *font*|*tracking*|*leading*|\
  *opacity*|*OPACITY*|\
  *hover*|*HOVER*|*focus*|*FOCUS*|\
  *barv*|*Barv*|*BARV*|\
  *odsazen*|*Odsazen*|*mezer*|*Mezer*|\
  *okraj*|*Okraj*|*rámeč*|*ramec*|\
  *zaobl*|*Zaobl*|*stín*|*Stín*|*stin*|\
  *pozad*|*Pozad*|*písm*|*pism*|*Písm*|\
  *průhled*|*pruhled*|*třída*|*trid*)
    LOAD_CSS=1
    ;;
esac
# ↑ The Czech verbs (barva, odsazení, mezery, okraj, rámeček, zaoblení, stín, pozadí,
# písmo, průhlednost, třída) are load-bearing, not decoration — the ds-awareness RCA
# found Czech style feedback silently missed the EN-only list, so those edits ran with
# ZERO DS vocabulary and the generator improvised off-system (DDR-141).

# Selection-anchored edits also benefit — they're nearly always style/structure.
if [ "${SEL_VALID:-0}" = "1" ]; then
  LOAD_CSS=1
fi

CANVAS_LIB="$CLAUDE_PLUGIN_ROOT/dev-server/canvas-lib.tsx"
DCTX=""   # cached DS-context pack (empty = cache miss → read the raw files)

if [ "$LOAD_CSS" = "1" ] && [ "${ACTIVE##*.}" = "tsx" ] && [ "$CSS_MODE" = "inline" ]; then
  # Use the design system's tokensCssRel + the DS-specific `_components.css`.
  DS_NAME=$(jq -r '.designSystem // "project"' "$META_PATH" 2>/dev/null || echo "project")
  DS_PREVIEW_DIR=$(jq -r ".designSystems[] | select(.name==\"$DS_NAME\") | .path" "$CFG" 2>/dev/null || echo "system/$DS_NAME")
  COMPONENTS_CSS="$REPO_ROOT/$DESIGN_ROOT/$DS_PREVIEW_DIR/preview/_components.css"
  TOKENS_CSS="$REPO_ROOT/$DESIGN_ROOT/$TOKENS_REL"

  # Sidecar cache (Phase C / DDR-061): cache the extracted DS vocabulary
  # (component class names + token names + canvas-lib exports) per
  # (DS-name, sha-of-the-three-source-files). A repeated /design:edit on the
  # same canvas reads the compact digest instead of re-reading ~6 KB CSS +
  # the ~58 KB canvas-lib. Invalidates the moment ANY of the three files change.
  # Access via the `maude` CLI (declared dep, on PATH) — cli/lib is NOT beside
  # the plugin in a marketplace install (DDR-061).
  TOKENS_SHA=$(cat "$COMPONENTS_CSS" "$TOKENS_CSS" "$CANVAS_LIB" 2>/dev/null | git hash-object --stdin | cut -c1-12)
  DCTX=$(maude cache get design-context "$DS_NAME/$TOKENS_SHA" 2>/dev/null)

  if [ -n "$DCTX" ]; then
    echo "→ DS context cache HIT ($DS_NAME/$TOKENS_SHA) — seeding from cached vocabulary, skipping CSS + canvas-lib reads"
  else
    echo "→ DS context cache MISS ($DS_NAME/$TOKENS_SHA) — pre-loading: $COMPONENTS_CSS"
    echo "→ pre-loading DS context: $TOKENS_CSS"
  fi
fi

# Pre-load the dev-server-bundled canvas-lib for every TSX canvas UNLESS the
# DS-context cache already covered it (the lib sha is folded into TOKENS_SHA, so
# a hit means its export vocabulary is in $DCTX). The lib is the authoring
# vocabulary (envelope + helpers + hooks the canvas can compose from); cold-edit
# without it is a known foot-gun (Phase 3.6.1 Task 13). Per DDR-025 it ships
# with the dev-server install. Cost when read: ~58 KB, idempotent.
if [ "${ACTIVE##*.}" = "tsx" ] && [ -z "$DCTX" ] && [ -f "$CANVAS_LIB" ]; then
  echo "→ pre-loading canvas-lib: $CANVAS_LIB"
fi

# ── Add-surface edits: pre-load the platform SHOWCASE shell (placement reference) ──
# When the edit PLACES A NEW SURFACE (a new screen/section/panel/artboard) rather than
# tweaking an existing element, the orchestrator needs the DS's canonical product shell so
# the new surface reuses "kde to bude" instead of inventing a parallel shell. Gate it tight
# — a class tweak / copy / colour edit must NOT trigger this (the showcase TSX is large).
ADD_SURFACE=0
case "$ARGUMENTS" in
  *add*|*Add*|*ADD*|*new\ *|*New\ *|\
  *přidej*|*Přidej*|*nová*|*nový*|*nové*|\
  *screen*|*section*|*panel*|*page*|*view*|*layout*|*sidebar*|*obrazovk*|*sekc*|*stránk*|*artboard*)
    ADD_SURFACE=1 ;;
esac
# A structural edit (AST fast-path did NOT fire) that adds a region is also add-surface.
# Never for surgical single-attribute edits (step 3a handles those).
if [ "$ADD_SURFACE" = "1" ] && [ "${ACTIVE##*.}" = "tsx" ]; then
  # Resolve platform + DS preview dir independently of the LOAD_CSS branch (which may
  # not have run for a non-style add-surface edit).
  SC_DS=$(jq -r '.designSystem // "project"' "$META_PATH" 2>/dev/null || echo "project")
  SC_PLATFORM=$(jq -r '.platform // "desktop"' "$META_PATH" 2>/dev/null || echo "desktop")
  [ "$SC_PLATFORM" = "tablet" ] && SC_PLATFORM="mobile"   # tablet rides mobile showcase family
  SC_PREVIEW=$(jq -r ".designSystems[] | select(.name==\"$SC_DS\") | .path" "$CFG" 2>/dev/null || echo "system/$SC_DS")
  SC_DIR="$REPO_ROOT/$DESIGN_ROOT/$SC_PREVIEW/preview"
  SHOWCASE=$(ls "$SC_DIR/ui_kits-${SC_PLATFORM}-showcase.tsx" 2>/dev/null | head -1)
  # Fallback: any showcase the DS ships (shell reference only). Never fatal.
  [ -z "$SHOWCASE" ] && SHOWCASE=$(ls "$SC_DIR/ui_kits-"*-showcase.tsx 2>/dev/null | head -1)
  if [ -n "$SHOWCASE" ]; then
    echo "→ pre-loading platform showcase: $SHOWCASE"
  else
    echo "→ add-surface edit but DS ships no showcase — placing surface from component priors + DS readme"
  fi
fi

# ── Brand-touching edits: pre-load the DS logo + iconography specimens (DDR-141) ──
# When the feedback touches the brand mark or icons (EN + CZ cues), the orchestrator needs
# the CANONICAL specimens in context — otherwise it redraws/invents. Add-surface edits get
# them too (a new full-screen surface typically places the mark).
BRAND_EDIT=0
grep -qiE 'logo|wordmark|brand|značk|znack|ikon|icon|glyph' <<< "$ARGUMENTS" && BRAND_EDIT=1
if { [ "$BRAND_EDIT" = "1" ] || [ "$ADD_SURFACE" = "1" ]; } && [ "${ACTIVE##*.}" = "tsx" ]; then
  BR_DS=$(jq -r '.designSystem // "project"' "$META_PATH" 2>/dev/null || echo "project")
  BR_PREVIEW=$(jq -r ".designSystems[] | select(.name==\"$BR_DS\") | .path" "$CFG" 2>/dev/null || echo "system/$BR_DS")
  BR_DIR="$REPO_ROOT/$DESIGN_ROOT/$BR_PREVIEW/preview"
  BR_LOGO=$(ls "$BR_DIR"/logo.{tsx,jsx,svg,html} 2>/dev/null | head -1)
  BR_ICON=$(ls "$BR_DIR"/iconography.{tsx,jsx,html} 2>/dev/null | head -1)
  [ -n "$BR_LOGO" ] && echo "→ pre-loading canonical brand mark: $BR_LOGO"
  [ -n "$BR_ICON" ] && echo "→ pre-loading iconography family: $BR_ICON"
  [ -z "$BR_LOGO$BR_ICON" ] && [ "$BRAND_EDIT" = "1" ] && echo "→ brand edit but DS ships no logo/iconography specimen — new art is legitimate (route via step 4.6)"
fi
```

**What the orchestrator does with those paths:**

- **Brand pre-load (DDR-141):** when `→ pre-loading canonical brand mark: …` / `→ pre-loading iconography family: …` printed, `Read` those specimens and pass them to the edit prompt as the **identity reference** — any brand mark the edit places or touches IS the specimen's mark (lift its markup; adapt only size/placement), and any icon matches the iconography family's grid/stroke/corner rules. Never redraw the mark from memory.

- **Add-surface pre-load:** when `→ pre-loading platform showcase: …` printed, `Read` that showcase TSX and pass it to `frontend-design` as the **placement reference** — the new surface must adopt the showcase's shell arrangement (nav / sidebar / toolbar / main / status), same chrome material, instead of inventing a new shell. It is reference, not a wireframe — the new surface still owns its own content. Skip the load (and this read) for surgical / cosmetic edits.
  - **Artboard-isolation hard-stop (carry into the `frontend-design` prompt for any add-surface / new-artboard edit):** the new `<DCArtboard>` is a fixed-size surface — never author it with viewport length units (`vw`/`vh`/`*-screen`/`h-[100vh]`) or viewport `@media` width queries / Tailwind responsive prefixes (`md:`/`lg:`), which resolve against the studio canvas stage and reflow the mock when the panel/sidebar/window resizes. Use fixed px / `%` / `h-full`, or `@container`+`cqw/cqh` for artboard-relative responsiveness. One artboard = one form factor (add a second artboard for another breakpoint). Full rule: `/design:new` envelope → "Artboard isolation". `design-system-keeper` Pass A.7 warns on violations.
  - **CSS-import-contract hard-stop (carry into the prompt whenever the edit adds an `import` of a `preview/` component):** a `preview/` component (`<Mascot>`, brand `<Logo>`, any specimen-authored component) ships **markup only** — its layout + motion live in the DS's `preview/_layout.css`, which the ui-canvas shell does NOT auto-inject (only tokens + `_components.css` are). So if the edit introduces `import { X } from ".../system/<ds>/preview/…"`, it MUST also add `import ".../system/<ds>/preview/_layout.css"` at the top — otherwise X renders silently static + mispositioned with no build error. Specimens get it for free; ui canvases must import it explicitly. Full rule: `/design:new` envelope → "CSS-import contract". `design-system-keeper` Pass A.9 warns on the omission.

- **Cache HIT (`$DCTX` non-empty):** seed the `frontend-design` prompt directly from the cached pack — `classNames` (what `_components.css` offers: `.btn`, `.tile`, `.sku`, `.seg`, …), `tokenNames` (the `colors_and_type.css` namespace), and `libExports` (the canvas-lib authoring vocabulary). **Skip the CSS + canvas-lib Reads entirely.** This is the C5 win — repeat edits on an unchanged DS pay zero read cost.
- **Cache MISS:** if `LOAD_CSS=1`, `Read` `_components.css` + `colors_and_type.css`, and (for any `.tsx`) the canvas-lib, **in parallel — one assistant message, multiple Read tool calls** (independent files; serialising just adds round-trips). Then extract the vocabulary and write the pack so the next edit hits:

  ```sh
  # Build the pack JSON from the parsed vocabulary, then store it:
  #   { "dsName": "...", "classNames": [...from _components.css...],
  #     "tokenNames": [...--tokens from colors_and_type.css...],
  #     "libExports": [...exported names from canvas-lib.tsx...],
  #     "logoSpecimenPath": "<preview/logo.* or null>",              // DDR-141 brand inventory —
  #     "iconographySpecimenPath": "<preview/iconography.* or null>", // paths + names only; mark
  #     "assetNames": [...filenames under <ds>/assets/, if any...] }  // CONTENT is Read fresh
  printf '%s' "$PACK_JSON" | maude cache put design-context "$DS_NAME/$TOKENS_SHA"
  ```

For `css_mode: "tailwind"` canvases skip (Tailwind utilities self-describe); for `css_mode: "modules"` load the canvas's `<Slug>.module.css` sidecar instead. Missing the canvas-lib vocabulary is the most common reason a `/design:edit` suggests re-inventing a helper that already exists — so on a miss the lib read is non-negotiable, and on a hit `libExports` carries that same vocabulary forward.
