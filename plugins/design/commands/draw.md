---
name: draw
category: daily
description: "Create and verify SVG logos, icons, illustrations or diagrams with the geometry engine."
argument-hint: "\"<brief>\" [--type icon|logo|illustration|diagram|spot] [--grid 0|1|4|8] [--asset [<path>] | --inline [--into <canvas>]] [--reference <url|path>] [--perfect [N]] [--no-critic]"
---

# /design:draw — draw a verified SVG mark

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Generates **production-grade vector graphics** via the geometry engine (`apps/studio/draw/`) and **verifies them visually** — renders, screenshots, pairwise-ranks, critiques against the 30-check rubric, and iterates to convergence. No free-hand `<path d>` coordinates: the LLM decides *intent*, the engine computes *coordinates* (this eliminates the LLM-SVG failure modes — integer quantization, coordinate drift, occlusion, color degradation).

Project-specific values (designRoot, rootClass, tokens, accent, colorSpace) come from `<repo>/.design/config.json`.

## Flags

| Flag | Default | What it does |
|---|---|---|
| `"<brief>"` | — | **Required.** Description of the mark, verbatim (don't rewrite, don't augment with brand names). |
| `--type <t>` | auto | `icon` \| `logo` \| `illustration` \| `diagram` \| `spot`. Auto-detected from the brief when omitted. |
| `--grid <n>` | per-type | Snap base: `1` (pixel — icons/logos), `4`/`8` (spacing scale — diagrams), `0` (off — illustrations/spot). |
| `--asset [<path>]` | see below | Output as a standalone `.svg`. Without `<path>` → `<designRoot>/assets/<slug>.svg`. |
| `--inline` | — | Output as JSX embedded into the canvas. |
| `--into <canvas>` | active | (with `--inline`) target `.tsx` canvas; default = `_active.json`. |
| `--perfect [N]` | 3 | Max draw-agent iterations (`max_rounds`). Cap 4. |
| `--no-critic` | — | Skip the final independent `draw-critic` pass. |
| `--reference <url\|path>` | — | A sanctioned "make it like THIS" — adapt an external asset. **Triggers a license HARD gate** (step 1.5): first the license is determined, choices surfaced, default = inspiration only. Without the flag it stays engine-first. |

**Default output mode:** `--asset` (standalone file). Choose `--inline` when the mark belongs directly in the open canvas (a logo in the header, an icon in a button).

**Animation:** when the brief asks for motion (morph / pulse / blink / "animated…"), draw-agent also reads `_draw-motion-rules.md`, plans a keyframe `Timeline` via IR (`morphVariants` / `timeline` / `sequence`+`parallel`+`stagger`), emits via `toAnimatedSvg`/`toAnimatedJsx`, and **must verify it live** via `draw-proof --motion` (a freeze-frame can't capture motion — DDR-094). Production delivery for web+mobile is Lottie via `/design:to-lottie`.

## Flow

### 0. Pre-flight

```bash
REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
maude design bootstrap-check --root "$REPO"   # 0 = DS present; 10/11 = needs /design:setup-ds
eval "$(maude design prep --shell-export --shape edit --root "$REPO")"   # config + active-canvas + server probe
PORT=$(maude design server-up --root "$REPO") # ensure dev server (needed for draw-proof)
```

When `bootstrap-check` returns 10/11 (no design system) → **stop**, print `Run /design:setup-ds <name> first` and exit. The mark is drawn in the context of the DS (tokens, accent, colorSpace).

### 1. Resolve type / grid / mode / viewBox

- `--type` given → use it; otherwise detect from the brief (single glyph → `icon`; brand name / wordmark → `logo`; scene/character → `illustration`; nodes+arrows → `diagram`; decorative pattern/background → `spot`).
- `--grid` given → use it; otherwise default per type (`icon`/`logo` → 1, `diagram` → 8, `illustration`/`spot` → 0).
- viewBox: `icon` → `0 0 24 24`, `logo` → `0 0 64 64`, otherwise pick per composition.
- Output mode: `--inline` → resolve the target canvas (`--into` or `_active.json` from prep); otherwise `--asset` (path from the flag or `<designRoot>/assets/<slug>.svg`).
- Slug: `maude design slug "<brief-or-name>"`.

### 1.5 Reference-adapt license gate (only with `--reference`)

`draw-agent` has no network access (tools: Read/Write/Bash/Glob/Grep) — so **the
license fetch is YOUR job here**, before any adaptation. This is the studyfi-v3 D5
fix (a reference was traced without ever checking its terms). When `--reference`
is set:

1. **Fetch the license FIRST** — WebFetch the reference (or its source page / repo
   `LICENSE`) and establish the terms. If you can't determine them, treat as
   non-permissive.
2. **Surface the choice** (AskUserQuestion): **adapt** (license permits derivative
   use) · **inspiration only** (draw original engine-first; default when terms are
   unclear/non-permissive) · **pick a different reference**.
3. **Pass the cleared result** into the spawn below as `reference` +
   `reference_license` + `reference_mode`. Never pass a `reference` you haven't
   license-checked. Without `--reference`, set all three empty/null.

### 2. Spawn `draw-agent`

```
Agent(
  description: "draw <type>: <short brief>",
  subagent_type: "design:draw-agent",
  prompt: <<EOF
brief:            "<verbatim user brief>"
type:             "<resolved type>"
grid:             <resolved grid>
output_mode:      "asset" | "inline"
output_path:      "<abs .svg path>"          # asset mode
into_canvas:      "<abs .tsx path>"          # inline mode
selected:         <selected element JSON or null>   # inline, from prep/_active.json
slug:             "<slug>"
config:           <contents of .design/config.json>
designRoot:       "<abs designRoot>"
opt_out_scope:    "<palette|aesthetic|full or empty>"
reference:        "<--reference value or null>"      # license-gated in step 1.5
reference_license:"<established license/terms or null>"
reference_mode:   "<adapt|inspiration>"              # from the step-1.5 gate
max_rounds:       <N from --perfect, default 3, cap 4>
candidates_n:     2
EOF
)
```

The agent owns the whole verify loop (plan → N candidates → draw-proof ladder → pairwise-rank → keep-best → rubric critique → iterate). **Read the verdict** (the last fenced `json` block in its output).

### 3. Evaluate the verdict

- `passed: true` (and `hard_pass: true`) → continue to step 4.
- `passed: false` → the mark has a HARD gap or an unresolved STRONG. If `--perfect [N]` allows another round and the agent didn't say "cap reached", **re-spawn** with the remaining `max_rounds` and a note to target `rubric.strong_failed` + the failed HARD checks. Cap 4 rounds total.
- After exhausting rounds with `passed:false` → print the gaps, **don't mark it done**; propose a manual intervention (typically a logo where flatten/16px fails).

### 4. Independent critic (default — skip s `--no-critic`)

```
Agent(
  description: "draw-critic on <slug>",
  subagent_type: "design:draw-critic",
  prompt: <<EOF
mark_path:     "<output_path (.svg) or the canvas it was inlined into>"
type:          "<type>"
proof_dir:     "<proof_dir from draw-agent verdict>"
designRoot:    "<abs designRoot>"
opt_out_scope: "<scope or empty>"
EOF
)
```

`draw-critic` is an **independent judge** (reads the same `_draw-design-rules.md`, but hasn't seen draw-agent's self-assessment). When its verdict disagrees (finds a HARD fail the agent declared a pass) → surface it and propose one corrective round via `draw-agent`.

### 4.5 Record the mark (kgai — when active)

A mark that survived the proof ladder and the rubric is a design decision, not just a file — and the *reasoning* (which of the N candidates won, and on which rubric axes) lives nowhere on disk once `_draw/` is swept.

Load **`flow:kgai-backend`**; when `maude kg resolve --json` reports `active` (skip silently otherwise — net-new capture, no classic path to preserve):

```bash
echo '{"decision":{"title":"Mark: <slug>","rationale":"<what was drawn, which candidate won and why, critic verdict + any accepted rubric trade-off>","date":"<YYYY-MM-DD>","mutations":[{"op":"upsert_element","kind":"draw","name":"<slug>","props":{"path":"<output_path>","type":"<logo|icon|illustration|diagram|spot>","mode":"<asset|inline>"}}]}}' | maude kg ingest --root "$CLAUDE_PROJECT_DIR"
```

In `--inline` mode also link it to the canvas it landed in — add `{"op":"add_link","from":"draw:<slug>","to":"canvas:<canvas-slug>","link":"DRAWN_FOR"}` to `mutations`. Record only a mark that **passed** (or that the user explicitly accepted over a critic objection — say so in the rationale); discarded candidates are noise.

### 5. Report + docs refresh

- Print the output report (below).
- `/design:setup-docs` refresh (auto, as after `/design:edit`/`/design:new`) — so `<designRoot>/README.md` + `INDEX.md` capture the new asset.

## Output report

```
🎨 /design:draw — <type> · <slug>

Output:        <asset path | inlined into <canvas>>
Mode:          asset | inline
Iterations:    <iterations_run> (kept best: round <kept_best_round>)
HARD floor:    WCAG <✓|✗> · 4/8pt grid <✓|✗> · 16px legible <✓|✗> · flatten <✓|✗>
Verdict:       <passed | needs-work> (draw-agent) · <agree | disagree> (draw-critic)
Proof ladder:  <proof_dir>  (light / dark / flatten · 16/24/48/256)
STRONG gaps:   <list or "none">
```

## Notes

- All dev-tooling verbs go through `maude design <verb>` (DDR-062) — never a raw bin path.
- `_draw/` (build scripts + proof canvases) and `_history/_draw-proof/` are gitignored — regenerable.
- The mark inherits the theme color via `currentColor` (engine default) — that's why dark-mode and single-color flatten work for free.
- For inline edit feedback like "add a logo to the header" `/design:edit` auto-routes you here (see edit.md), so you usually call `/design:draw` manually only for a standalone asset.
