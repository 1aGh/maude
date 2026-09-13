### 5. Build envelope

**Discipline:** the envelope is a *creative brief*, not a *wireframe spec*. See `skills/design/SKILL.md` → "Envelope discipline". In brief: vibe + 1–2 reference canvases + aspiration directives 9–14 verbatim + brief. Do **not** dictate elements, button counts, copy, paddings.

**Motion vocabulary (Phase 3.7 / DDR-049).** When the brief asks for or implies motion (`animate`, `transition`, `motion`, `play`, `loop`, `slide`, `fade`, drag/drop UX, route transitions, presence cursors, scroll-linked effects), the envelope **MUST** use the canvas-lib motion vocabulary — `<MotionDemo role>` / `<MotionTrack>` / `<TokenPlayback>` / `<ReducedMotionToggle>` / `useMotionTokens` from `@maude/canvas-lib` — not hand-rolled `@keyframes`. The pure-CSS `.motion-*` escape hatch is opt-in for justified zero-JS surfaces only. **The full, authoritative rule (default / escape hatch / never) lives in `skills/design-system/SKILL.md` → "Animation tooling contract" — this is a pointer.** The 8 roles (flip / panel / route / soft / spring / scroll / drag / presence) are the canonical vocabulary; `design-system-keeper` warns on reinventions ≥3× per canvas (promotes to blocker). The motion library (`motion/react`) is automatically declared in `/design:handoff`'s registry-item.json, so the canvas drops into a Next.js + shadcn project with animations working — no manual `npm i motion`.

Adapt the generic envelope from SKILL.md "Generation envelope" with the concrete config values from step 1. **Aspiration directives 9–14 MUST be in the envelope verbatim** — they are what drives the signature-moment-critic axes (signature moment, brand prominence, mock fidelity, restraint, negative space, specificity).

**Append UX pattern reference bundle** (from step 4.5 payload): include in the envelope a `## UX patterns reference` section listing payload `information_architecture_patterns[0].label` (the Recommended IA pattern), `typical_screen_anatomy.regions[]` as a region checklist, `common_flows[].id` as flow names the canvas might depict, `interaction_patterns[].label` as patterns to honor, and `anti_patterns[].pattern` as patterns to avoid. These are **reference**, not prescription — `frontend-design` interprets, doesn't dictate. If step 4.5 failed and no payload exists, skip this section and note in the envelope's footer (`UX pattern research unavailable — generation proceeds on DS + brief alone`).

**Test envelope quality before running generation:**
- Reads like a brief to a senior IC? ✓
- Reads like a wireframe spec with a list of elements? ✗ — trim it
- Length ~30–50 lines? ✓ (~100+ = over-prescriptive)
- Aspiration directives present? ✓ required
- References 1–2 existing canvases? ✓ required
- `## Pattern priors` section populated (or explicitly empty for first-canvas case)? ✓ required

#### 5a. Collect pattern priors (for the envelope's `## Pattern priors` section)

```bash
# Existing canvases in this DS — same dir as the target, .meta.json.designSystem matches.
PRIORS_DIR="$DESIGN_ROOT/$NEW_CANVAS_DIR"
PRIOR_CANVASES=$(find "$PRIORS_DIR" -maxdepth 2 -name "*.tsx" -not -name "$(basename "$TARGET_PATH")")

PRIORS_LIST=""
for c in $PRIOR_CANVASES; do
  STEM="$(basename "$c")"
  STEM="${STEM%.*}"
  META="$(dirname "$c")/${STEM}.meta.json"
  # Filter to canvases in the same DS (multi-DS aware). Single-DS layouts have no
  # designSystem field on the meta — accept those too (treat as same DS).
  CANVAS_DS=$(jq -r '.designSystem // "project"' "$META" 2>/dev/null || echo "project")
  [[ "$CANVAS_DS" != "$TARGET_DS" ]] && continue

  # Class roots — both className="..." (JSX) and class="..." (HTML).
  CLASSES=$(grep -oE '(className|class)="[^"]+"' "$c" \
              | sed -E 's/^(className|class)="//; s/"$//' \
              | tr ' ' '\n' \
              | grep -E '^[a-z][a-z0-9-]+$' \
              | sort -u | tr '\n' ',' | sed 's/,$//')
  SUB=$(jq -r '.subtitle // ""' "$META" 2>/dev/null || echo "")
  PRIORS_LIST+="- $c ($SUB) — class roots: $CLASSES"$'\n'
done

# Preview components — DS-supplied component library (TSX specimens).
PRIOR_PREVIEW=$(ls "$DS_ROOT/preview/components-"*.tsx 2>/dev/null)
PREVIEW_LIST=""
for p in $PRIOR_PREVIEW; do
  # Pull subtitle from .meta.json sidecar (cheap, no AST parse).
  META="${p%.tsx}.meta.json"
  ROLE=$(jq -r '.subtitle // .title // ""' "$META" 2>/dev/null || echo "")
  [ -z "$ROLE" ] && ROLE=$(basename "$p" .tsx | sed 's/components-//; s/-/ /g')
  PREVIEW_LIST+="- $(basename "$p") — $ROLE"$'\n'
done

# ── Tier-0 prior: the platform SHOWCASE layout (the canonical "DS in use" shell) ──
# `ui_kits-<platform>-showcase.tsx` is the single highest-leverage specimen the DS
# scaffold produces — the established arrangement of chrome (nav / sidebar / toolbar /
# main / status) for a full product surface. Feeding it as a prior is what lets a NEW
# feature canvas reuse "where it goes" instead of re-deriving a shell. (Gap fix — pre-this,
# step 5a globbed only components-*.tsx and the showcase never entered the envelope.)
# Resolve the canvas platform (mirror step 4's detection; tablet rides the mobile family
# per _MAPPING.md). Default desktop.
PLATFORM="desktop"
grep -qiE -- '--mobile|mobile|ios|android' <<< "$ARGS $NAME" && PLATFORM="mobile"
grep -qiE -- '--tablet|tablet|ipad'        <<< "$ARGS $NAME" && PLATFORM="mobile"   # tablet → mobile showcase family

# Primary = exact platform; fallback chain = any showcase present (shell reference only);
# else none. NEVER fatal — a DS may ship desktop-only (no ui_kits-mobile-showcase).
SHOWCASE_PATH=$(ls "$DS_ROOT/preview/ui_kits-${PLATFORM}-showcase.tsx" 2>/dev/null | head -1)
SHOWCASE_RESOLUTION="matched ${PLATFORM}"
if [[ -z "$SHOWCASE_PATH" ]]; then
  SHOWCASE_PATH=$(ls "$DS_ROOT/preview/ui_kits-"*-showcase.tsx 2>/dev/null | head -1)
  [[ -n "$SHOWCASE_PATH" ]] \
    && SHOWCASE_RESOLUTION="fell back to $(basename "$SHOWCASE_PATH") as shell reference (DS ships no ${PLATFORM} showcase)" \
    || SHOWCASE_RESOLUTION="none — DS ships no showcase"
fi
SHOWCASE_INDEX=$(ls "$DS_ROOT/preview/ui_kits-${PLATFORM}-index.tsx" 2>/dev/null | head -1)

SHOWCASE_BLOCK=""
if [[ -n "$SHOWCASE_PATH" ]]; then
  # Showcases carry NO .meta.json sidecar — pull the role from the file's
  # `/** SPECIMEN: … */` header comment (DEMONSTRATES / COMPOSITION lines).
  SHOWCASE_ROLE=$(grep -m1 -E '^\s*\*\s*(SPECIMEN|DEMONSTRATES|COMPOSITION):' "$SHOWCASE_PATH" 2>/dev/null | sed -E 's/^\s*\*\s*//')
  [ -z "$SHOWCASE_ROLE" ] && SHOWCASE_ROLE="platform product shell (DS-in-use composition)"
  SHOWCASE_BLOCK="- $SHOWCASE_PATH — $SHOWCASE_ROLE"$'\n'
  [ -n "$SHOWCASE_INDEX" ] && SHOWCASE_BLOCK+="- $SHOWCASE_INDEX — surface catalog/launcher (secondary prior)"$'\n'
else
  SHOWCASE_BLOCK="(none — DS ships no showcase; compose the shell from the DS readme + component priors)"$'\n'
fi

# ── Tier-0 prior (identity): BRAND ASSETS — the canonical logo + icon vocabulary (DDR-141) ──
# The DS ships its brand identity as preview specimens (logo.*, iconography.*) plus an optional
# assets/ tree. Without this block, aspiration directive 10 ("brand mark at human scale") is an
# order to INVENT a logo — the exact failure the ds-awareness RCA documents. Never fatal: a DS
# with no brand specimens simply gets the "(none …)" marker and a fresh mark is legitimate.
LOGO_SPECIMEN=$(ls "$DS_ROOT"/preview/logo.{tsx,jsx,svg,html} 2>/dev/null | head -1)
ICON_SPECIMEN=$(ls "$DS_ROOT"/preview/iconography.{tsx,jsx,html} 2>/dev/null | head -1)
ASSET_FILES=$(ls "$DS_ROOT/assets/" 2>/dev/null | head -20)

BRAND_BLOCK=""
[ -n "$LOGO_SPECIMEN" ] && BRAND_BLOCK+="- LOGO (canonical mark): $LOGO_SPECIMEN"$'\n'
[ -n "$ICON_SPECIMEN" ] && BRAND_BLOCK+="- ICONOGRAPHY (canonical icon family — grid, stroke, corners, shipped glyphs): $ICON_SPECIMEN"$'\n'
[ -n "$ASSET_FILES" ]   && BRAND_BLOCK+="- ASSETS tree ($DS_ROOT/assets/): $(printf '%s' "$ASSET_FILES" | tr '\n' ' ')"$'\n'
[ -z "$BRAND_BLOCK" ]   && BRAND_BLOCK="(none — DS ships no logo/iconography specimen; a brand mark, if the brief needs one, is legitimately new — route it through the draw pipeline)"$'\n'
```

The `PRIORS_LIST`, `PREVIEW_LIST`, `SHOWCASE_BLOCK`, and `BRAND_BLOCK` strings are interpolated verbatim into the envelope's `## Pattern priors` section (step 5b heredoc) — `SHOWCASE_BLOCK` (placement) and `BRAND_BLOCK` (identity) are the **Tier-0** subsections (above canvases + components). **Content, not just paths (DDR-141):** before writing the envelope, `Read` the resolved `$SHOWCASE_PATH` and `$LOGO_SPECIMEN` files and inline what the generator must lift — the showcase's shell skeleton (region arrangement + chrome class roots, summarized) and the logo specimen's mark markup (verbatim, into the Brand-assets subsection). A path listing alone is a bibliography the generator can't lift from — that asymmetry vs. the edit path was the pre-DDR-141 failure. `$SHOWCASE_RESOLUTION` is carried to the envelope footer + step-12 print so the user sees whether shell-grounding applied or fell back; brand-asset resolution rides the same footer (step-12 `Brand grounding:` line). If `PRIORS_LIST` + `PREVIEW_LIST` are both empty AND `SHOWCASE_BLOCK` + `BRAND_BLOCK` are both "(none…)" markers, write the one-line note ("First canvas in this DS — no priors to lift from.") and continue.

#### 5b. Persist envelope as audit artifact

**Always write the envelope to `<DESIGN_ROOT>/_history/<slug>/000-envelope.md` before invoking generation** — regardless of which path (Skill vs orchestrator-direct) ultimately produces the canvas. This makes the brief auditable for future retros and lets the user see what creative directive actually drove the output.

```bash
mkdir -p "$DESIGN_ROOT/_history/$SLUG"
cat > "$DESIGN_ROOT/_history/$SLUG/000-envelope.md" << EOF
# Envelope — <Name>

Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Generation path: {to be filled in step 6}

## Brief
<verbatim user brief>

## Aspiration directives (verbatim from SKILL.md 9–14)
<directives 9–14>

## Reference canvases
- <ref 1>
- <ref 2>

## Pattern priors — existing canvases to study before inventing

For any compositional element (card, panel, snippet, toolbar, sidebar, modal, button, badge), FIRST check if any prior listed below has the same shape. If yes, **lift it** — same class names, same paddings, same border treatment. Reinventing is the exception, not the default — leave a one-line JSX comment in the new canvas explaining what your variant does that the prior didn't.

The `design-system-keeper` agent (step 9.5) audits compliance with this directive after generation. Surfaced reinventions feed into the critic panel as additional context.

### Platform showcase layout — the canonical shell (adopt this skeleton)
<SHOWCASE_BLOCK from step 5a — resolved `ui_kits-<platform>-showcase.tsx` path + role from its header comment, plus the `-index` catalog as a secondary line. If empty, the literal "(none — …)" marker.>

This specimen is the DS's authoritative <platform> product shell — the established arrangement of chrome (nav / sidebar / toolbar / main / status). For any **full-screen surface** in this canvas, ADOPT its spatial skeleton and chrome material: same region placement, same shell framing, same hairline/elevation/radius treatment. Do NOT re-derive a new product shell. Reinventing the shell is the exception, not the default — leave a one-line JSX comment explaining what this surface needs that the showcase shell couldn't give. (If the line above reads "(none …)", this DS ships no showcase for this platform — compose the shell freely from the DS readme + the component priors below.) This is **reference, not a wireframe** — adopt the skeleton, but you still own element-level decisions and the signature moment; do not transcribe the showcase region-by-region.

### Brand assets — canonical identity (REUSE, do not invent) (DDR-141)
<BRAND_BLOCK from step 5a — resolved logo/iconography specimen paths + assets/ inventory. If empty, the literal "(none — …)" marker.>

<the logo specimen's mark markup, INLINED verbatim here by the orchestrator (Read $LOGO_SPECIMEN) — the generator lifts this, it does not redraw it>

The logo above IS the brand mark. Aspiration directive 10 ("brand mark featured at human scale") refers to THIS mark, rendered from the inlined markup (or a documented variant from assets/) — never a newly drawn one. Icons come from the iconography family named above: match its grid, stroke weight, and corner treatment; a glyph the set doesn't ship is drawn to those family rules with a one-line JSX comment naming the gap. (If the marker reads "(none …)", the DS ships no brand specimens — a new mark is legitimate; route genuine new art through the draw pipeline, step 9.6.)

### Existing canvases (same DS, with class roots)
<for each .tsx in <DESIGN_ROOT>/<NEW_CANVAS_DIR>/ matching this DS, NOT the new canvas — see step 5 collection recipe>
- <path> (<.meta.json.subtitle>) — class roots: <comma-separated list extracted via the recipe>

### Existing preview components (DS library, with role)
<for each .tsx in <DS_ROOT>/preview/components-*.tsx — see step 5 collection recipe>
- <filename> — <one-line role from the .meta.json subtitle>

(If neither list has entries, this is the first canvas in this DS — Pattern priors is empty; the generator works from the DS readme + UX research alone.)

## UX patterns reference (from ux-research-agent step 4.5)
- IA pattern (Recommended): <payload.information_architecture_patterns[recommended].label>
- Typical screen anatomy regions: <payload.typical_screen_anatomy.regions[].id, csv>
- Common flows the canvas might depict: <payload.common_flows[].id, csv>
- Interaction patterns to honor: <payload.interaction_patterns[].label, csv>
- Anti-patterns to avoid: <payload.anti_patterns[].pattern, csv>
- Reference products (for IA / behavior, NOT visual): <payload.reference_products[].name, csv>
- [if step 4.5 skipped/failed: "UX pattern research unavailable — generation proceeds on DS + brief alone."]

## Constraints
- rootClass: <ROOT_CLASS>
- tokens: <TOKENS_REL>
- platform: <mobile | desktop>
- platform_showcase: <abs path to ui_kits-<platform>-showcase.tsx, or "none">   ← from step 5a; the shell skeleton frontend-design adopts for full-screen surfaces ($SHOWCASE_RESOLUTION names whether it matched or fell back)
- brand_logo: <abs path to preview/logo.*, or "none">           ← from step 5a (DDR-141); the canonical mark, inlined in the Brand assets subsection above
- brand_iconography: <abs path to preview/iconography.*, or "none">   ← from step 5a (DDR-141); the icon family every glyph must match
- opt_out_scope: <palette | aesthetic | full>   ← from step 4, propagated into the generation prompt so the generator knows how much DS latitude it has
- ds_fidelity: <advisory | strict>              ← from step 4 (DDR-141); strict = reinventing a shipped specimen is a blocker (scope full overrides to advisory)
- ux_research_payload: <abs path or empty>      ← from step 4.5, passed to frontend-design as a reference bundle

## Opt-out interpretation (only when scope > palette)
- aesthetic: gradients, off-ladder radii, alt type pairings, decorative SVG/emoji are PERMITTED inside the canvas-local namespace. Tokens link + rootClass envelope still required.
- full:      DS is advisory; type/radii/aesthetic up to the canvas. Envelope still required.
- A11y is independent — keep WCAG AA compliance regardless of scope.

## Artboard isolation (HARD-STOP — applies at EVERY opt-out scope)
Each `<DCArtboard>` is a **fixed-size design surface**. Its content MUST render identically regardless of the studio chrome (Assistant panel, sidebar, window size) and of pan/zoom. Do NOT use CSS that resolves against the browser viewport — inside an artboard the viewport is the studio's canvas stage, not the artboard box, so these silently reflow the mock when the workspace resizes:
- **No viewport length units** — `vw` / `vh` / `vmin` / `vmax` / `svh` / `dvh` / `lvh` (and the `*vw` variants), including Tailwind `min-h-screen` / `h-screen` / `w-screen` / `h-[100vh]` / `text-[4vw]`. Size to a fixed design width, `%`, or `h-full` against the artboard body.
- **No viewport `@media` width queries** for layout — neither raw `@media (min-width: …)` nor Tailwind responsive prefixes (`sm:` / `md:` / `lg:` / `xl:` / `2xl:`). One artboard = one form factor; make a *second* `<DCArtboard>` for another breakpoint instead of reflowing one.
- **Need responsiveness inside a single artboard?** Use container queries — `@container` + `cqw` / `cqh` — they resolve against the artboard body (canvas-lib sets `container-type: inline-size` there), so they stay isolated. `position: fixed` is fine (the canvas world re-roots it).
- **`kind="web"` artboards lean on this hardest** (feature-3-web-artboards) — hug-height + `@container` is the whole reflow-testing mechanism (T4: drag the artboard's width handle, the content reflows live). This rule was already load-bearing before that feature; `kind="web"` just names the artboard as the primary consumer.

## CSS-import contract (HARD-STOP — applies at EVERY opt-out scope)
A `preview/` component (e.g. `<Mascot>`, brand `<Logo>`, any specimen-authored component) ships **markup only** — its base layout + motion (`@keyframes`, the `position: relative` scoping) live in the DS's `preview/_layout.css`, which the **ui-canvas shell does NOT auto-inject** (it injects only the DS tokens + `_components.css`; `_layout.css` is auto-injected for *specimens* only). So whenever this canvas `import`s a component from `system/<ds>/preview/`, it MUST **also** `import "…/system/<ds>/preview/_layout.css"` alongside the token / `_components.css` imports at the top of the file. Omit it and the component renders **silently static and mispositioned** — no animation, and absolutely-positioned children (auras / accessory layers with `inset: 0`) resolve against a distant ancestor — **with no build error**. Specimens get this transitively; ui canvases must add the import explicitly. `design-system-keeper` Pass A.9 warns on the omission after generation, but write the import up front.
EOF
```

After step 6, append the chosen generation path (Skill vs orchestrator-direct) to the file's "Generation path:" line.

**Why mandatory:** scooter retro (2026-05-09) flagged that without an envelope artifact, future retros can't see what brief drove generation — the orchestrator's mental model of the brief disappears with the conversation. The envelope being on disk also surfaces over-prescriptive briefs (wireframe-spec smell) for review independent of the canvas itself.
