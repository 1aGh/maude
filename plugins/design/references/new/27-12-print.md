### 12. Print

The text you print follows skill `contract-voice`: the result first, what is safe, then the one thing to do; no "I".

Show the canvas first: `maude design open "$TARGET_REL"` puts it in the person's Maude window (exit code 3 means no window shows this project; say where the canvas is instead).

```
✓ Made: <DESIGN_ROOT>/<NEW_CANVAS_DIR>/<Name>.tsx   {ingest: "✓ Ingested into: <DESIGN_ROOT>/<active-rel> (existing brief canvas)"}
  Pattern: canvas with N artboards (DesignCanvas + N artboards): <group · kind · size per artboard, e.g. "App · Fixed size · 1440 × 1024">
  {if INGEST: "Mode: ingest — N artboards inserted into <ACTIVE_REL> below the brief frame; annotations untouched (still floating). annotations_sha: <sha>."}
  Sidecar: <DESIGN_ROOT>/<NEW_CANVAS_DIR>/<Name>.meta.json
  Name: {as given | Untitled canvas [N] (no name given) | <noun> (from the sentence)}  ·  Design system: <TARGET_DS> {(default) | (this folder's) | (--ds)}
  Generation: {frontend-design specialist | orchestrator-direct fallback}
  Baseline: <RUN>/shots/NNN-screen-<id>.png (per-artboard set) | (absent — see "Visual verification" below)
  Visual verification: { confirmed (N of N artboards captured) | partial (M of N — failed: <id-list>) | ⚠ SKIPPED — per-artboard capture failed on both agent-browser + playwright engines; canvas IA was NOT visually confirmed (user accepted gap) | aborted }
  {if DS_THEMES declares >1 theme: "Theme verification: {confirmed — <THEME> + <ALT_THEME> both captured (2×N screenshots) | ⚠ SKIPPED — <ALT_THEME>-theme capture failed on both engines; only <THEME> was visually confirmed (user accepted gap)}"}

  Mode: {--perfect (default) | --perfect-iter N | --quick | --no-critic}
  Artboard density: {N (per brief) | N (chosen via AskUserQuestion) | N (Auto Mode default — brief did not name a count)} {if N ≥ 8: "— pan/zoom may stutter on trackpad; /design:edit \"reduce to M\" if heavy"}
  Opt-out scope: {palette (default) | aesthetic | full} {if inferred from brief: "(inferred from brief — user confirmed via AskUserQuestion)"}
  DS fidelity: {advisory (default) | strict — reuse violations gate the loop | strict → advisory (opt-out=full on this canvas)}
  Shell grounding: {$SHOWCASE_RESOLUTION — e.g. "matched desktop (ui_kits-desktop-showcase.tsx)" | "fell back to ui_kits-desktop-showcase.tsx as shell reference (DS ships no mobile showcase)" | "none — DS ships no showcase"}
  Brand grounding: {logo: preview/logo.tsx (inlined) · iconography: preview/iconography.tsx | none — DS ships no brand specimens} {if step 9.6 substituted: "· Brand mark: substituted canonical <basename>"}
  UX research: {cache hit — reusing <date> | fresh — <N>s wall-clock | fallback (LLM-knowledge) — review IA | unavailable — drafted on DS + brief only}
  Critic panel ({default = signature-moment + design + frontend + a11y; --quick = signature-moment only;
                --perfect --all = full set; --no-critic = (none)}; scope-downgraded blockers tagged as warnings):
    correctness: {X} blockers · {Y} warnings
    aspiration: {n}/5 (signature {n}, brand {n}, fidelity {n}, restraint {n}, neg-space {n}) · specificity: {pass|fail}
    verdict: {solid | stable-but-bland | max-reached | divergent | validation-failed | skipped}
    iterations: {N} of {max_iter}
  {if user opted into --quick / --no-critic via flag or AskUserQuestion: "Critic mode: <flag> per user choice"}
  {iteration log for each iter — score delta, fixes applied}
  {if stable-but-bland: "Lowest axes: <list>. Targeted feedback would lift these."}
  {if Visual verification = SKIPPED: "⚠ Critic panel ran WITHOUT baseline screenshots — aspiration scoring is degraded. The artboards exist in the canvas but were not visually confirmed to render. Open <DESIGN_ROOT>/<NEW_CANVAS_DIR>/<Name>.tsx in Maude to verify before iterating."}

  Docs: <designRoot>/INDEX.md added entry; <designRoot>/README.md updated.
  {if INDEX.md was missing and /design:setup-docs --full was invoked: "Docs: bootstrapped via /design:setup-docs --full"}

  Version history has the draft as one version; one undo takes all of it back.
  Open in Maude: {shown | not shown — no window}. Iterate via /design:edit "<feedback>".
```
