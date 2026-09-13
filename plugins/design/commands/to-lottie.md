---
name: to-lottie
category: daily
description: "Export animation keyframes to a verified Lottie artifact for web and mobile."
argument-hint: "\"<animated mark | IR handle | canvas>\" [--out <path>] [--web] [--verify]"
---

# /design:to-lottie — emit ONE Lottie from code (web + mobile)

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

The **production-delivery** handoff for maude animation ([DDR-094](../../../.ai/archive/decisions/DDR-094-draw-animation-keyframe-ir-native-authoring-lottie-export.md)).
You iterate the animation natively in maude (the keyframe IR → SMIL/JSX preview);
when it's time to ship, this emits **ONE `.lottie`** that renders **1:1 on web**
(`lottie-web` / `dotlottie-react`) **AND mobile** (`lottie-react-native`) — 1:1 by
construction (same renderer family), performant (native Lottie runtime).

> **Emitter, not converter.** There is **no** reliable rendered-SVG/SMIL→Lottie
> converter (lottie-web #62, 8 years; After Effects rejects animated SVG — DDR-094
> research). So this emits Lottie **from the keyframe data**, via a python-lottie
> generator. Validated by a full POC ([`to-lottie-poc/`](../../../.ai/plans/notes/to-lottie-poc/)).

## Flags

| Flag | Default | What it does |
|---|---|---|
| `"<source>"` | — | **Required.** The animated mark: IR handle / `.tsx` canvas / disciplined SMIL+CSS source. |
| `--out <path>` | `<designRoot>/assets/<slug>.json` | Output `.lottie`/`.json`. |
| `--web` | — | Also drop a web usage snippet (`dotlottie-react` / `lottie-web`) alongside the RN snippet. |
| `--verify` | on (recommended) | Render frames through headless lottie-web and compare against the web reference. |

## Why Lottie (not a second native renderer)

The POC built BOTH paths. The native `react-native-svg` + Reanimated port proved
fidelity is *possible* but hit three real walls (DDR-094 Update): `feTurbulence`
has no native impl; continuous multi-layer `d`-morph **froze the app** (rn-svg
re-parses `d` + re-renders the whole `<Svg>` every frame); and two hand-matched
implementations drift. Lottie is ONE artifact rendered by the same engine family
on both platforms → 1:1 by construction. The native renderer (`/design:to-rn`) is
a **fallback for light animation only**.

## Flow

### 0. Pre-flight

```bash
REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
maude design bootstrap-check --root "$REPO"   # 0 = DS present
```

### 1. Resolve the source → per-property keyframes + per-layer shapes

- **IR path** (preferred, once the mark is authored in the engine): read the
  `Timeline` tracks directly — vertex-array `d` morphs, transform/opacity/stop tracks,
  the per-track easing handles.
- **SMIL+CSS path** (a hand-authored `.svg`/canvas): read the morph `<animate values>`
  (→ vertex frames) + the CSS `@keyframes` (→ transform/opacity/scale tracks) + the
  easing tokens. Enumerate EVERY animated property (rule 2).

### 2. Write a python-lottie generator

Author a small `gen.py` under `<designRoot>/_draw/<slug>.to-lottie.py`. python-lottie
owns the format correctness (beziers, keyframes, gradients, masks, parenting). Write
the Lottie to `os.environ["MAUDE_LOTTIE_OUT"]`. Map:

- path morph → animated `ty:sh` bezier (`v`/`i`/`o`/`c`); parse `d` (incl. `A` arcs)
  with `parse_svg_file` — never hand-approximate (rule 3).
- transforms (jump/scale/rotate) → a parent null layer + per-layer transforms (rule 7).
- gradients → `gf`/`gr` with **opacity stops appended after color stops** (rule 8).
- clipping (eyes/mouth) → masks (rule 5).

### 3. Apply the 8 conversion rules (the load-bearing part)

Each was found the hard way in the POC — encode ALL 8 (full text:
[`design-to-lottie-skill-spec.md`](../../../.ai/plans/notes/design-to-lottie-skill-spec.md)
+ [`_draw-motion-rules.md`](../agents/_draw-motion-rules.md)):

1. **Per-segment easing from the real CSS tokens** — every kf gets `o=(x1,y1)` +
   `i=(x2,y2)`; **preserve overshoot (`y>1`)** (the "snap"). Each animation its OWN token.
2. **Port EVERY animated property** — enumerate; don't eyeball (the POC dropped the mouth).
3. **Arc commands (`A`) → `parse_svg_file`**, never hand-approximate.
4. **`layers[0]` = top** (first shape = top) — build back→front then **reverse** the layer list.
5. **Masks** render on lottie-web/RN but NOT cairo → self-verify via lottie-web.
6. **Incommensurate sub-loops** → bake across the comp; hide the loop seam in an invisible phase.
7. **Coordinate offset + baked static transforms** — only ANIMATED transforms become keyframes.
8. **Gradient opacity stops** appended after color stops (`count` = color-stop count).

### 4. Generate + self-verify

```bash
maude design to-lottie \
  --script "<designRoot>/_draw/<slug>.to-lottie.py" \
  --out "<designRoot>/assets/<slug>.json" \
  --verify --root "$REPO"
```

`maude design to-lottie` bootstraps a cached python-lottie venv, runs the generator,
**validity-gates the output** (parseable Lottie with `layers`/`op`), and with
`--verify` renders frames through **headless lottie-web** (NOT cairo — cairo can't
render masks). **Read every frame PNG** under `_verify-frames/` and compare the arc
to the web reference. Iterate the generator until it matches.

### 5. Emit usage snippets

**Mobile (lottie-react-native):**
```tsx
import LottieView from 'lottie-react-native';
<LottieView source={require('./<slug>.json')} autoPlay loop style={{ width, height }} />
```

**Web (`--web`, dotlottie-react / lottie-web):**
```tsx
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
<DotLottieReact src="/<slug>.json" autoplay loop />
```

Theme colors are **baked** into a Lottie (the format has no token reference) — override
at runtime via the host's color-filter API where a theme-aware mark needs it. Reduced
motion is **host-gated** (`autoPlay={!reduce}`); the Lottie format has no RM of its own.

## Output report

```
🎞  /design:to-lottie — <slug>
Output:     <out .json>   (<N> layers · <op> frames @ <fr>fps)
Platforms:  web (lottie-web/dotlottie-react) + mobile (lottie-react-native) — 1:1
Verify:     <frames dir>  (rendered through headless lottie-web)
Usage:      RN + web snippets above
```

## Notes

- Reachable engine: python-lottie (generator) + headless lottie-web (self-verify), via
  `maude design to-lottie` (DDR-062). Ships the verify harness (`to-lottie-verify.html`).
- A future TS `toLottie()` engine serializer (from the IR directly) supersedes the
  python-lottie generator once the IR is fully wired; the generator is the proven
  reference until then (DDR-094 P1.1).
- For **light/occasional** animation where you want native rn-svg instead of a Lottie
  runtime, see `/design:to-rn` (the fallback — not for continuous rich morph).
