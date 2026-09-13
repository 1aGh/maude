---
name: setup-ds
category: setup
description: "Create or re-bootstrap a named design system."
argument-hint: "<name> [\"<brief>\"] [--force] [--quick]"
---

# /design:setup-ds — create / extend a design system

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Dedicated entry point for **creating a design system** in this project. Three modes the underlying skill auto-detects:

- **first-bootstrap** — `.design/config.json` does not exist (or `designSystems[]` is empty). The skill runs **staged discovery** (DDR-033 + DDR-147: Stage 0 scope picker → Stage 1 vision prompts → Stage 2 research → **Stage 3 direction gate** (moodboard pick of ~`moodboard.variants` directions) → **Stage 4 refinement residue** → **LOCK gate**), scaffolds `system/<name>/`, writes `config.json` with `designSystems: [{ name, path, description }]`.
- **additional-ds** — `config.json` exists and `<name>` is **not** in `designSystems[]`. The skill runs the same stages plus a Q_purpose prompt at the start and an inheritance picker between Stage 2 and the Stage-3 direction gate (inherited fields are frozen across all direction tiles).
- **re-bootstrap** — `<name>` already exists in `designSystems[]` AND `--force` was passed. Stage 1 is lossy-inferred from the existing DS README + tokens + `_layout.css`; user confirms / corrects in a single chat message; Stage 2 always re-runs; the Stage-3 direction gate runs with **1 tile**; Stage 4 residue + LOCK proceed identically.

This command **does NOT create a canvas** — use `/design:new` for that. It also does NOT prepare the project environment (deps, CLAUDE.md, .ai/) — that's `/design:init`'s job.

## Arguments

- `<name>` — required. Kebab-case slug (`marketing`, `admin`, `consumer-mobile`, …). For the first DS in a **single-DS project**, the literal value `project` is the conventional default — every `/design:edit` / `/design:new` auto-detects it without `--ds=<name>` flag. **Name-validation rule (Phase 19 / DDR-044):** when first-bootstrap is detected AND `<name>` exactly matches the repo basename (e.g. user typed `/design:setup-ds my-repo` from `~/git/my-repo`), the skill warns: `You passed '<name>'; for first-bootstrap projects the conventional default is 'project' (auto-detected by /design:edit). Continue with '<name>'? [Y/n]` and proceeds on Y/enter. The user-supplied name is honored either way — the warning is informational, not gating. The completeness-critic's C2 dirname check (`system/<name>/` vs `system/project/`) reads `vision-brief.json#name_source` to distinguish `user`-supplied from `default`-applied names; user-supplied names do NOT trigger C2.
- `<brief>` — optional. If absent, Stage 1 asks all 11 prompts. If present, the skill pre-fills the matching `vision-brief.json` fields (typically P1 elevator pitch, sometimes P5 lineage / P10 OST hypothesis) and prints a one-line `→ Skipping P<N> (covered in brief)` per skipped prompt so the user can correct misfires.
- `--force` — required for re-bootstrap of an existing DS. Without it, an existing-DS target produces an error pointing at the right verb (`/design:edit` for incremental change, `/design:setup-ds <new-name>` to add a sibling DS).
- `--quick` — opt out of Stage 1's full 11 prompts. The skill collapses Stage 1 to 4 prompts (P1 elevator + P5 lineage + P8 primary emotion + P10 OST hypothesis), forces the Stage-3 direction gate to **1 tile** (auto-proceed-but-still-ask), and runs Stage 4 refinement normally. Output is structurally valid but typically scores ~3.5/5 aspiration instead of the 4.0+/5 the full 3-stage flow targets. Use when scaffolding a throwaway DS or when the user explicitly wants the fast path.
- `--imprint` — steer Stage 2 research toward an explicit brand prior (rare; usually used when the brief already names a strong gold-standard, e.g. "use the studyfi imprint pattern"). The skill still runs Stage 1 + Stage 2 + Stage 3 in full BUT seeds the research agent's payload with the prior. **Phase 3.7 / DDR-049:** the post-scaffold critic panel is gated by an explicit `AskUserQuestion` (Full 4 rounds / Imprint-only / Custom) regardless of `--imprint` — the flag does NOT silently skip Rounds 2 + 3. `motion-critic` is always-on whenever `motion.tsx` is scaffolded, regardless of `--opt-out=motion`. See SKILL.md "Spec-bypass discipline" — any deviation from spec routes through `<designRoot>/_history/_system/<ds>-bypass-log.md`.
- `--from-brand <file(s)>` — the FILE-BACKED sibling of `--imprint`: point at one or more local brand files (a logo SVG/PDF, brand images) instead of naming a prior in prose. Each file runs through `maude design import-asset` (DDR-167's hardened SVG/PDF ingestion) and, for a resulting logo asset, `maude design import-brand` (DDR-173) to extract a typed `{palette, fonts, logoRef}` triple — **never free text**; DDR-173 Decision 1 forwards only grammar-validated color values, allowlist-matched real font names, and a hardened logo asset reference into Stage 2's research payload. The Stage 2 research agent treats these as strong anchors (still going through the normal `recommendations[]` confidence process — Stage 3/4 still confirm, extraction is best-effort, never presented as final) and, per DDR-173 Decision 3, this run does NOT write to the committed, cross-peer `research/domain` cache (only the ephemeral per-brief layer) so an unreviewed brand-seeded run never silently becomes the shared domain default for other briefs. Stage 1 + Stage 2 + Stage 3 still run in full — `--from-brand` seeds the payload, it does not skip stages, exactly like `--imprint`. Combine with `--imprint` if useful (a prose prior AND a file prior can both seed the same payload). See DDR-173 for the full trust boundary this flag operates inside.

## Examples

```
/design:setup-ds project "It's a recipe manager where you set the number of servings and it recalculates the ingredients. For me and 3 friends. I want it to look like an 80s cookbook, not a modern food app with big photos."
/design:setup-ds marketing "<paragraph describing what this marketing surface is for, the audience, the primary action, voice direction>"
/design:setup-ds admin --force                                          # re-bootstrap
/design:setup-ds quickdraft "<one-paragraph brief>" --quick             # collapse Stage 1 to 4 prompts
```

**Brief content guidance:**
- Stage 1 of discovery is conversational — the skill leads you through 11 small prompts, each with an example. You don't need to know anything in advance.
- If `<brief>` is just a one-liner, it pre-fills P1 only; the remaining 10 prompts get asked.
- If `<brief>` is a paragraph, the skill pattern-matches lineage / OST / audience cues and skips the corresponding Stage 1 prompts (each skip is printed inline so you can correct). Stage 2 research + the Stage-3 direction gate always run.
- No Pastier vocabulary required — the skill handles the internal mapping to his chapters silently.

## Process

### Step 1 — Detect environment

One pre-flight call resolves config presence + the known-DS set in a single pass (instead of a bare `.design/config.json` read):

```bash
eval "$(maude design prep --shell-export --shape setup-ds)"
# → CONFIG_PRESENT, KNOWN_DS, DEFAULT_DS, REPO_ROOT, DESIGN_ROOT, ACCENT_STRATEGY, COLOR_SPACE
```

If `CONFIG_PRESENT=false`:

```
→ .design/config.json missing. Running /design:init first to initialize the project…
```

Then auto-invoke `/design:init --skip-prompts` so the user isn't double-prompted. After it returns, continue.

If config exists (`CONFIG_PRESENT=true`), skip onboard. `KNOWN_DS` already tells you whether `<name>` collides with an existing DS (drives the first-bootstrap / additional-ds / re-bootstrap sub-mode decision in Step 2).

### Step 1.5 — Cache inspiration library inventory

Before the skill runs any `find` calls against the inspiration library, capture the library tree once and hold it in context:

```sh
ls -R plugins/design/templates/design-system-inspiration/ | head -200
```

This avoids the false-negative template-drop the studio-2 retro caught (BAD-6) where `find` from the wrong cwd returned exit-code-1 and a template (`audience-developer/type-mono.html`) was incorrectly classified as missing. Subsequent `find` calls during scaffold MUST use absolute paths anchored at the repo root.

### Step 2 — Invoke skill `design-system` in bootstrap mode

Call `Skill design-system` with the input envelope:

```
mode: bootstrap
target_ds: <name>
brief:     <brief or empty>
force:     true|false
quick:     true|false           # --quick → collapse Stage 1 to 4 prompts
```

The skill detects the sub-mode internally (first-bootstrap / additional-ds / re-bootstrap) based on `.design/config.json` state.

### Step 3 — Skill runs its discovery + scaffold

> **Direction is a START / divergent bookend (DDR-130).** When `orchestration.mode` is not `off` and native agent-teams are available, the Stage-3 direction gate is the place to contest the aesthetic before ~15k LOC of scaffold. The gate already diverges by construction (DDR-147: ~`moodboard.variants` seed-composed direction tiles, blind sub-agent escalation on request); with the debate layer eligible it additionally routes the direction call through **`flow:debate-protocol`** — `flow:user-advocate` (who is this for / who's excluded) + `flow:builder` (boldest viable aesthetic) + `signature-moment-critic` (aspiration) — surfacing one framed direction. Never blocks; `mode:off` → today's flow, unchanged.

See `plugins/design/skills/design-system/SKILL.md` "Bootstrap flow" for the canonical spec. Briefly:

1. Pre-Flight (light) — node ≥ 20, git, write permission, config exists (else auto-onboard). **AskUserQuestion availability probe** (Phase 19 / DDR-044): the skill fires one trivial AskUserQuestion before Stage 0; if it returns `InputValidationError` or permission denial (e.g. don't-ask mode), Stage 0 + every downstream picker (direction gate, refinement, LOCK) switch to numbered-prose-in-chat for the rest of the session. Spec + copy-paste prose templates in the design-system skill's `_bootstrap.md` ("Tool-availability check" callout, just before Stage 0).
2. Discovery — staged (DDR-033 + DDR-147). Stage 0 = single AskUserQuestion (scope) OR numbered-prose fallback. Stage 1 = 11 plain-prose prompts in 3 batches, free-text + skip. Stage 2 = `ux-research-agent` runs on the full `vision-brief.json`, ~30–90s wall-clock. `--quick` collapses Stage 1 to 4 prompts.
2.5. **Stage 3 — direction gate (design-language moodboard, DEFAULT ~`moodboard.variants` directions).** Directly after research — before any refinement question — the main agent composes ~3 **direction tiles** (miniature chaotic collages: type-in-context, 60/30/10 palette strip + OKLCH chips, treatment hero, voice line, descriptive name + one-line thesis, provenance) into ONE **persistent UI canvas** at `ui/<ds>-moodboard.tsx` (DDR-136 — revisitable + commentable, never under `system/<ds>/`), **seed-only from the Stage-2 payload: no web, no fan-out** (DDR-147). Screenshot + Read, then the **direction-pick gate**: gut-first, fit-framed pick / Mix (base + named elements, re-rendered coherently) / eliminate-one fallback. Blind-sub-agent + self-harvest variants are the opt-in **escalation** ("wilder variants"); tile count degrades to the distinct-seed count via an **informed opt-in**, never silently. The winner expands into the full six-concern collage. ~1–3 min (3–6 escalated) vs the ~30–40 min scaffold. Interactive-only (skipped on `--no-discovery`; `--quick`/autonomous/re-bootstrap force 1 tile). **Canonical spec in `plugins/design/skills/design-system/_bootstrap.md` § "Stage 3 — Direction gate" — this is a pointer.**
3. **Stage 4 — refinement (residue only).** Adaptive AskUserQuestion picks ONLY for what the pick didn't settle — the pick silences the axes the tiles visibly varied on (bounded override, DDR-073-safe); the non-visual residue (majak codes, density, spacing, type ratio, easing, width + <0.60 leftovers) runs the normal confidence gate. Typically 1–3 Qs.
3.5. **LOCK gate.** Replaces the prose Confirm — one echo of {picked direction + residue}, then the moodboard freezes as the **locked direction contract** Batch A consumes verbatim; any post-lock edit re-locks + re-runs the hero gate. **Canonical spec in `_bootstrap.md` § "LOCK gate" — this is a pointer.**
4. Mapping — consult `_MAPPING.md` for file set, `activeFamilies[]`, per-file `dependency_closure` (drives batching).
5. **Pre-scaffold roster** — emit `_history/_system/000-scaffold-roster.yaml` listing every file with `batch: A|B|C` + `status: pending`.
6. **Scaffold (fan-out)** — Batch A by main agent (tokens + chrome + READMEs + config + **one hero-preview specimen**, `colors-accent.tsx`); Batches B + C **fired in parallel via sub-agents** (5–8 slices). Sub-agents read tokens CSS + chrome + reference template, then RESTRUCTURE per the creativity rubric. Each updates its rows to `status: written`.
6.5. **Hero-preview gate (token-fidelity check).** After Batch A's CSS + the hero specimen are written, the main agent screenshots `colors-accent.tsx` and drift-checks the *real computed tokens* against the approved moodboard **before** the Batch B+C fan-out. Light by default — auto-proceed on no-drift, hard-prompt (`Continue / Adjust tokens / Stop`) only on drift (wrong hue lightness, missing treatment, inverted type roles). Catches "burnt → candy" as a token edit, not a ~15k-LOC regen. **Canonical spec in `_bootstrap.md` § "Hero-preview gate" — this is a pointer.**
7. Reconcile — main agent reads roster, asserts no pending rows remain.
7.5. **Animation-contract gate (fail closed — DDR-049).** If `system/<ds>/preview/motion.tsx` was scaffolded, grep it: it MUST import `@maude/canvas-lib` AND reference the vocabulary (`<MotionDemo` or `<MotionTrack`). A specimen that is pure-CSS `@keyframes` only (no canvas-lib import) violates the Animation tooling contract (`skills/design-system/SKILL.md`). On miss → either **regenerate the specimen** against the contract, or, if a zero-JS specimen is genuinely intended, record the deviation in `_history/_system/<ds>-bypass-log.md` with a one-line reason. Do NOT accept a silently-pure-CSS motion specimen. (`motion-critic` in step 10 also blocks it; this gate catches it before the panel so the regen happens once.)
8. Copy-claim → asset-receipt sweep, then auto-run completeness-critic.
9. Visual sanity — 3 signature specimen screenshots via `maude design screenshot` (or `maude design visual-sanity`).
10. **4 brand rounds panel** — **Round 1 (Clarity: completeness + a11y) runs first** (the structural floor must hold before aesthetics matter, and Round 2 reads Round 1's blocker count to set severity). After Round 1 returns, **Rounds 2 + 3 fire together as one parallel batch** (single assistant message, multiple Agent calls): Round 2 (Appeal: graphic-design + signature-moment) + Round 3 (Consistency: typography + brand + copy). Honest verdicts surface in the completion block. Canonical spec (gating + verdicts + parallelism) lives in `plugins/design/skills/design-system/SKILL.md` post-scaffold gate — this is a pointer.
11. Post-flight — print next-step block.

### Step 3.9 — Record the locked direction (kgai — when active)

The **LOCK gate** (DDR-147) is the single most consequential decision this command makes: it freezes one moodboard direction as the contract every later canvas is generated against. Today that contract survives only as scaffolded files — nothing states *which* direction was chosen, *why*, or what the runner-up was.

Load **`flow:kgai-backend`** and check `maude kg resolve --json`.

- **`active: false`** (default) → skip silently. This is a **net-new** capture; there is no classic file path to preserve.
- **`active: true`** → after the LOCK gate resolves and the scaffold succeeds, record the direction as a `ds:` node:

  ```bash
  echo '{"decision":{"title":"Design system locked: <DS_NAME>","rationale":"<the locked direction in the user'"'"'s own words + why it beat the runner-up + any Stage-4 residue>","date":"<YYYY-MM-DD>","mutations":[{"op":"upsert_element","kind":"ds","name":"<DS_NAME>","props":{"path":"<DESIGN_ROOT>/system/<DS_NAME>","accentStrategy":"<ACCENT_STRATEGY>","colorSpace":"<COLOR_SPACE>","status":"locked"}},{"op":"upsert_element","kind":"direction","name":"<DS_NAME>-locked"},{"op":"add_link","from":"ds:<DS_NAME>","to":"direction:<DS_NAME>-locked","link":"LOCKED_TO"}]}}' | maude kg ingest --root "$CLAUDE_PROJECT_DIR"
  ```

  Put the **user's own words** in `rationale`, verbatim — not a polished paraphrase. This is the one record of intent behind every downstream canvas, and the value is in what they actually said. Re-bootstrap (`--force`) re-locks: record again; identity converges on `ds:<DS_NAME>` and props merge, so `status`/`accentStrategy` update in place while the decision history keeps both events.

### Step 4 — Return

The skill prints its "Bootstrap complete" block. This command body has no Post-flight of its own.

## Failure modes

- **`<name>` already exists AND `--force` was NOT passed** → fail with:
  ```
  Error: design system "<name>" already exists at .design/system/<name>/.
  To iterate on it:  /design:edit "<feedback>"
  To replace it:     /design:setup-ds <name> "<new brief>" --force
  To add a sibling:  /design:setup-ds <new-name> "<brief>"
  ```
- **`<name>` is not a valid kebab-case slug** (must match `^[a-z][a-z0-9-]*$`) → fail with the regex hint.
- **`<name>` collides with a reserved dir** (`preview`, `assets`, `ui_kits`) → fail with "reserved name; pick another".
- **Hard-dep missing (node < 20 / no git / no write permission)** → the skill's Pre-Flight aborts with the specific install hint.

## What `/design:setup-ds` does NOT do

- **No canvas creation.** Use `/design:new "<Name>" "<brief>" --ds=<this-name>`.
- **No environment init.** That's `/design:init` (auto-invoked here when needed).
- **No incremental edits to an existing DS.** That's `/design:edit "<feedback>"` against a specimen file, or hand-editing `colors_and_type.css` directly.
