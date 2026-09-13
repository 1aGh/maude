## Failure modes

- **Target file already exists** → preferred: surface AskUserQuestion with 2–3 alternative-name suggestions (mechanical `<Name> v2`, plus 1–2 brief-derived semantic alternatives — e.g. if the existing one is `iOS Signup Flow.tsx` and the brief is about scootersharing, suggest `Scooter Signup Flow`). If the user picks one, use it; if they cancel, abort.
- **Target file exists AND AskUserQuestion is denied** (Auto Mode / non-interactive context) → infer the most accurate alternative name from the brief — semantic, not a mechanical `v2`. Document the choice explicitly in the final print (`Filename: <chosen> (auto-picked from brief because <existing> existed)`). Auto Mode authorizes reasonable autonomous decisions; preserving existing files while creating a new one with a brief-accurate name is reasonable. A mechanical `v2` suffix is an acceptable fallback if the brief doesn't yield a clear semantic name.
- **`frontend-design` Skill unavailable** → **do NOT fail** — fall back to orchestrator-direct generation (see step 6). The final print MUST flag `Generation: orchestrator-direct fallback` + suggestion `/plugin install frontend-design@claude-plugins-official` for better quality next run.
- **Generated HTML violates validation** (missing tokens, hardcoded colors, single-page wrapper without DCArtboard, …) → re-prompt once. If broken again, fail with detail.
- **Post-write screenshot fails / canvas renders blank** → warn `⚠ canvas rendered blank — likely JSX error` but don't abort. The file exists; the user can open it manually + find the error in the console.
- **Screenshot reports success but file is missing** → use the canonical helper via `maude design screenshot`. The helper detects silent-fail (PNG < 1 KB) and exit-codes 3. Avoid calling `agent-browser screenshot …` inline directly — it has CLI quirks around the `--full` separator and `--output` that the helper handles for you.

### `--perfect` cost when budget tight

Default `/design:new` = `--perfect` (8 iter, target 4.5/5, routed panel). Honest cost:

- 8 iterations × min 4 critic agents (signature-moment + design + frontend + a11y) = **32+ subagent calls**
- Plus auto-fix iterations between critics = **~40+ subagent calls total**
- Estimated token cost: **150–300k tokens** (canvas-size dependent)
- Wall time: **5–15 min** v default model speed

**Orchestrator behavior:**

1. **Default — honor the contract.** Run the full loop. The user chose `/design:new` knowing the deal (default-on `--perfect` is documented first-class behavior, not hidden).

2. **If the session token budget is visibly constrained** (context > 60% full, user flagged token concerns earlier in the session, or the conversation has already consumed > ~150k tokens) → **before** starting the loop, surface a one-shot AskUserQuestion:
   > "`/design:new` runs `--perfect` by default (~40 subagent calls, 150–300k tokens, 5–15 min). Your context is already 65% full. Pick: (a) full `--perfect` (default — expensive but polished), (b) `--quick` (signature-moment only, ~2 iter, ~30k tokens), (c) `--no-critic` (just generate + render check, ~5k tokens)."

3. **Never silently downgrade** — if you want less, use an **explicit flag**: `--quick` or `--no-critic`. A token-saving shortcut without user opt-in / opt-in question = **process violation**. Same pattern as the `/flow:execute` Edit-Verify Loop — a contract is a contract.

4. **If the user explicitly chose a downgrade** (option b/c in the question above, OR an explicit `--quick` / `--no-critic` flag) → state it explicitly in the final print:
   > `Critic panel (--quick mode per user choice): signature-moment-critic only, max 2 iter`
- **Path contains a path outside `<DESIGN_ROOT>`** → fail (security).
- **`.design/config.json` missing** → warn the user "using defaults" and continue with defaults from `dev-server/config.schema.json`.
- **Auto-critic loop hits `stable-but-bland`** (correctness clean, aspiration plateau below target) → don't fail, surface the canvas with a diagnostic. The user should get the lowest 2 aspiration axes named so they know where to steer targeted feedback.
