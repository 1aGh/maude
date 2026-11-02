# `references/draw/design-rules.md` — the draw rubric (single source)

> Reference doc, **not** an agent or a slash command (it lives under `references/`). Read by both
> `draw-agent` (generation + self-verify) and `draw-critic` (independent judge).
> Distilled from the Phase 25 + Phase 25.1 deep research (DDR-070; the 25.1
> "what makes good design objectively good" pass is cited inline). Every check
> below is **yes/no or measurable** — no vibes. The agent verifies the objective
> ones from the **SVG source / primitive list / palette tokens / engine metrics**,
> never by asking a vision model (VLMs misread text, counts, and color).

---

## ⚠️ Phase-25.1 corrections — read these first

The deep research overturned several "common knowledge" rules. These govern everything below:

1. **The golden ratio (φ) is NOT a quality signal.** Peer-reviewed evidence (Naini 2024; Markowsky 1992; Blake 1921) debunks the φ-and-beauty myth. **Never** gate generation or critique on φ, and never reward "it aligns to φ". φ is at most ONE optional armature among several (`armature(box,'golden')`), with no special status — prefer `thirds` / `rabatment` / `dynamic-symmetry`.

2. **Armature/grid alignment is a GENERATION tool, NOT a critic gate.** Fitting *any* proportion grid to a finished image is mathematically non-discriminating — a dense enough armature aligns with *anything* (Blake 1921). So: **place elements ON the armature when generating** (`composition.armature()` → `assignSlots()`), but the critic must score with the DISCRIMINATING metrics below (balance moment, value range, harmony distance, dominance, APCA) — never "does it sit on a grid".

3. **"Blob soup" is a generation-architecture failure, not a taste failure.** Random placement avoids overlap only ~3–12% of the time (Shiripour 2021). The fix is structural: compose on an armature, don't scatter-then-hope.

---

## Generation discipline — the anti-soup rules (MANDATORY for draw-agent)

Before drawing any multi-element composition (illustration / diagram / spot / background), the agent MUST:

| # | Rule | How (engine) |
|---|---|---|
| G1 | **Compose on an armature** — place focal + primary elements on construction focal points, never random-scatter. | `const arm = armature(box, 'dynamic-symmetry'\|'thirds'\|'rabatment'); place on arm.focals / assignSlots(n, arm)`. |
| G2 | **One dominant focal element.** The largest element's visual weight ≥ ~1.3× the next (a clear primary, not competing foci). | `dominanceRatio(elements) ≥ 1.3` — make the focal bigger/brighter. |
| G3 | **Value does the work.** Span a real luminance range — deep darks ↔ bright lights. A scene with depth wants `valueRange ≥ ~0.35`; a flat mid-value set reads as muddy soup. | `valueRange(keyColors)`; structure colors as base(dark) → support(mid) → focal(bright). |
| G4 | **Harmonize the palette via a template**, don't pick hues at random. 2–3 related hues (often warm-focal vs cool-field) beat a 9-hue spectrum. | `bestHarmony(hues)` to check (`distance ≈ 0`); `harmonize(hues, template, rot)` to snap. |
| G5 | **Balance the masses.** Net visual moment about the center near zero (asymmetry is fine if it balances). | `balanceMoment(elements, box).score ≥ ~0.75`. |
| G6 | **Active negative space.** Leave breathing room around the focal; don't fill every quadrant. | place supports on a SUBSET of focals; keep one quadrant calm. |

A composition that ignores G1–G5 is the failure mode the user called "ugly" — fix it in generation, not by asking the critic to bless it.

---

## Discriminating critic metrics — measure, don't vibe (for draw-critic)

The critic scores on these COMPUTED metrics (from the primitive list / palette / rendered raster), NOT on armature-presence and NOT on a gut score. Each has a measurable threshold; below threshold is a real finding, not a nag.

| Metric | Compute | Pass threshold | Catches |
|---|---|---|---|
| **Value range** | `valueRange(colors)` (max−min WCAG luminance) | ≥ 0.35 for scenes/backgrounds with intended depth | the "washed-out pastel" + "muddy near-equal-value overlap" failures (the C + B variants) |
| **Hue harmony** | `bestHarmony(hues).distance` (Cohen-Or, sat-weighted) | ≤ ~30 (≈0 ideal) | "fighting colors" / random-spectrum soup |
| **Visual balance** | `balanceMoment(elements, box).score` (VME) | ≥ 0.75 | left/bottom-heavy, dead-quadrant layouts |
| **Dominance** | `dominanceRatio(elements)` | ≥ 1.3 (one clear focal) | "everything equally loud", no focal point |
| **Text contrast** | `apcaLc(fg, bg)` (APCA Lc) | body ≥ 75 · large/heavy ≥ 60 · any visible el ≥ 15 | illegible text / invisible elements |
| **WCAG (text)** | `contrastRatio` / `meetsWcag` | AA (4.5 / 3) | accessibility floor |

**Aggregation:** report each axis separately (per Ngo — the *summed* score has weak human correlation, so don't average them into one number). A composition **fails** if it misses ANY of: value-range, balance, dominance (these three are the anti-soup core), or any HARD floor below. **Raise the bar:** a background with `valueRange < 0.25` OR `balance < 0.6` OR `dominance < 1.15` is NOT "portfolio-grade" regardless of how pretty the colors are — that was the leniency that passed the soup.

**Do NOT score:** φ-conformance, armature-alignment, root-ratio presence (all non-discriminating / debunked).

## How to read this

Three principle layers feed one rubric:

1. **Principles** (the "why") — Gestalt, composition, hierarchy, spacing, color, type, logo, icon, optical adjustment.
2. **The 30-check rubric** (the "did you") — each tagged **HARD** / **STRONG** / **SOFT**.
3. **Source-level checks** (the "prove it") — what to grep/compute instead of eyeballing.

**Severity:**
- **HARD** = objective defect. A single HARD failure ⇒ the mark does **not** pass; fix and re-iterate. (WCAG, 4/8pt grid, 16px legibility, single-color flatten.)
- **STRONG** = best practice. A deviation needs a one-line reason in the verdict, else it's a blocker.
- **SOFT** = context-judged. Note it; don't block on it alone.

---

## Principles (compressed)

- **Gestalt** — proximity, similarity, closure, continuity, figure/ground. Group by spacing, not boxes. Negative space is a shape.
- **Composition / balance** — one primary focal element; off-center unless deliberately static; balance visual weight (a small dark mass balances a large light one).
- **Hierarchy** — size, weight, color, and position rank elements. The squint test: blur it; what survives should be the intended primary.
- **Spacing / grid** — everything on a 4/8pt scale; intra-group spacing < inter-group; align edges to a small set of x/y positions; consistent live-area padding.
- **Color** — WCAG-safe pairs; ~60-30-10 with accent ≤ ~15% area; perceptually-even ramps (OKLCH); never color-alone meaning.
- **Type** — modular-scale sizes; body measure 45–75ch; body leading ~1.4–1.6, headlines tighter; ≤ 2–3 families.
- **Logo** — legible at 16px; survives single-color flatten; no dated trend effects; the four Paul Rand virtues: distinctive, memorable, simple, versatile.
- **Icon family** — shared stroke width + corner radius + keyline grid + optical weight; pixel-snapped; consistent live-area padding.
- **Optical adjustment** — curves/circles overshoot flat edges ~1–3%; a circle reads equal to a square only when ~+13% larger by extent (equal-area `2/√π`); triangles/play-glyphs centroid-centered, not bbox-centered.

---

## The 30-check rubric

### Hierarchy
1. Exactly one clear primary focal element. **[STRONG]**
2. Largest text ≥ 1.5× body. **[STRONG]**
3. ≥ 3 typographic tiers (where the mark carries type). **[STRONG]**
4. Squint/blur test — the surviving blobs are the intended primaries. **[STRONG]**

### Spacing / grid
5. All spacing on the 4/8pt scale; flag 7 / 11 / 13 / 23px. **[HARD]**
6. Intra-group spacing < inter-group (≥ ~1.5–2×). **[STRONG]**
7. Internal padding ≤ external padding. **[STRONG]**
8. Edges align to a small set of x/y positions. **[STRONG]**

### Type
9. Sizes on a consistent modular ratio. **[STRONG]**
10. Body measure 45–75ch. **[STRONG]**
11. Body line-height ~1.4–1.6; headlines tighter. **[STRONG]**
12. ≤ 2–3 families. **[SOFT]**

### Color
13. Every text/bg pair meets WCAG AA (4.5:1 text / 3:1 large / ≥ 3:1 non-text). **[HARD]**
14. ~60-30-10 distribution; accent ≤ ~15% area. **[STRONG]**
15. Recognizable harmony; no two saturated colors fighting at equal value. **[STRONG]**
16. Ramps perceptually even (OKLCH). **[SOFT]**
17. Never color-alone meaning. **[SOFT]**

### Composition
18. Focal point off-center unless deliberately static. **[SOFT]**
19. Not everything centered. **[STRONG]**
20. Balanced visual weight. **[SOFT]**

### Optical correction (craft tier)
21. Curves/circles overshoot flat edges ~1–3%; circle ~+13% vs equal-extent square. **[STRONG]**
22. Triangles / play-icons centroid-centered, not bbox-centered. **[STRONG]**
23. Logo icon ~1–3% larger than adjacent cap height. **[SOFT]**

### Icon family
24. Shared stroke width + corner radius + keyline grid + optical weight. **[STRONG]**
25. Pixel-snapped; consistent live-area padding. **[STRONG]**

### Logo
26. Legible / recognizable at 16px. **[HARD]**
27. Survives single-color black-on-white flatten. **[HARD]**
28. Free of dated trend effects + stock clichés. **[SOFT]**

### Anti-pattern sweep
29. Same semantic role styled identically. **[STRONG]**
30. Whitespace deliberate / active with macro breathing room. **[SOFT]**

---

## Source-level checks (verify these from SOURCE, never from the vision model)

The vision model judges **composition / balance / "does it read"** (and ranks candidates pairwise). It does **not** adjudicate the objective checks below — those come from the SVG text, the primitive list, or the engine:

| Check | How to verify objectively |
|---|---|
| **Text / wordmark content** (5, 26) | Read the `<text>` content + `<title>`/`<desc>` from the SVG source. Never ask "what does it say?" |
| **Element / shape counts** | Count primitives in the build list or `grep -oE '<(rect\|circle\|path\|line\|polygon\|ellipse\|text)'`. |
| **Exact colors + WCAG (13)** | Compute with `palette.contrastRatio()` / `meetsWcag()` on the actual token/hex values. Never ask the VLM if contrast "looks fine". |
| **4/8pt grid (5)** | Inspect coordinate values in the primitive list; flag off-scale numbers. The engine's `grid` arg prevents most. |
| **Single-color flatten (27)** | Re-serialize with one ink color (or read the `flatten` proof artboard) and confirm the silhouette still reads — this is a shape test, not a color question. |
| **16px legibility (26)** | Read the `16px` cell of the `DrawProof` ladder; confirm the silhouette is distinguishable. |
| **`currentColor` / dark-mode** | Confirm fills/strokes resolve to `currentColor` (not a hardcoded `#000`) so theme + flatten work — grep the SVG for literal `#000`/`black` on the primary shape. |
| **Optical corrections (21, 22)** | The engine helpers (`overshoot`, `EQUAL_AREA_CIRCLE_SCALE`, `centroidCenter`) encode these — confirm they were applied where relevant. |

---

## Per-type emphasis

| Type | HARD checks that dominate | Notes |
|---|---|---|
| **icon** (24-grid keyline) | 5, 13, 24, 25, 26 | One family = one stroke width + radius + live-area. Pixel-snap (`grid: 1`). 2px stroke on a 24 grid is the Lucide/Material default. |
| **logo** (wordmark / lettermark / pictorial / abstract / combination / emblem) | 26, 27, 13 | The two HARD logo gates (16px + flatten) are non-negotiable. Keep it simple (Paul Rand). |
| **illustration** (spot / hero) | 13, 14, 18, 20 | Composition + restraint matter most; looser grid OK; still WCAG for any text. |
| **diagram** (nodes + A* edges + labels) | 5, 6, 8, 13, 29 | Edges never cross non-endpoint nodes (engine `diagram()` guarantees). Labels don't overlap (engine `placeLabels`). Same node role = same style. |
| **spot** (decorative / pattern / background) | 14, 17, 30 | `aria-hidden` if purely decorative. Restraint + negative space. |

---

## The HARD floor (a mark cannot pass with any of these failing)

1. **WCAG** — every text/bg + non-text pair meets AA (check 13).
2. **4/8pt grid** — no off-scale coordinates (check 5).
3. **16px legibility** — recognizable at favicon size (check 26).
4. **Single-color flatten** — silhouette survives black-on-white (check 27).

Everything else is STRONG (needs a reason to skip) or SOFT (judgment). The
agent's verdict reports per-check pass/fail; `draw-critic` independently
re-scores against this same doc.
