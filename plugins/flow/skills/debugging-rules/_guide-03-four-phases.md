## Four phases

You **MUST** complete each phase before proceeding to the next.

### Phase 1 — Root cause investigation

Before attempting any fix:

1. **Read error messages carefully.** Don't skip past errors or warnings — they often contain the exact solution. Read stack traces completely. Note line numbers, file paths, error codes.

2. **Reproduce consistently.** Can you trigger it reliably? Exact steps? Every time? If not reproducible — gather more data, don't guess.

3. **Check recent changes.** `git diff`, recent commits, new dependencies, config changes, env differences. `.ai/state/STATE.md` `Updated` line is a useful timestamp.

4. **Gather evidence at every boundary.** Read `boundaries.*` from the project config. Each declared system is a potential failure seam:

   ```
   For EACH declared boundary:
     - Log what data enters this component
     - Log what data exits this component
     - Verify environment / config / secrets propagation
     - Check state at each layer (request context, RLS, JWT claims, env vars)

   Run once to gather evidence showing WHERE it breaks.
   THEN analyze evidence to identify the failing component.
   THEN investigate that specific component.
   ```

   Cross-platform projects: also check for build/runtime delta between platforms (web bundle vs native build, dev vs prod, EAS channel, deploy preview vs main).

5. **Trace data flow.** When the error is deep in the call stack: where does the bad value originate? What called this with the bad value? Keep tracing up until you find the source. Fix at source, not at symptom.

### Phase 2 — Pattern analysis

Find the pattern before fixing:

1. **Find working examples.** Locate similar working code in the same codebase. What works that's similar to what's broken?
2. **Compare against references.** If implementing a pattern (auth provider, ORM migration, RPC procedure), read the reference completely — don't skim. Understand fully before applying.
3. **Identify differences.** What's different between working and broken? List every difference, however small. Don't assume "that can't matter."
4. **Understand dependencies.** What other components does this need? Settings, config, environment, RLS context, JWT claims, env vars, feature flags?

### Phase 3 — Hypothesis and testing

Scientific method:

1. **Form single hypothesis.** State clearly: "I think X is the root cause because Y." Write it down. Be specific.
2. **Test minimally.** Smallest possible change to test hypothesis. One variable at a time. Don't fix multiple things at once.
3. **Verify before continuing.** Worked? → Phase 4. Didn't work? Form a **new** hypothesis. Don't add more fixes on top.
4. **When you don't know.** Say "I don't understand X." Don't pretend. Ask the user. Research more.
5. **Re-verify the verification.** When a check or ad-hoc query claims the design's premise is wrong, that claim itself needs evidence — verify the verification script/query before overturning the design. Real cost of skipping this: an ad-hoc Mongo check "proved" a correct production join broken (the check, not the code, was wrong) and nearly triggered a fix in the wrong direction.

### Phase 4 — Implementation

Fix the root cause, not the symptom:

1. **Create failing test case.** Simplest possible reproduction. Automated test if framework available; one-off script if not. **MUST exist before fixing.** This is the TDD bridge — see `testing-rules` § Iron Law.

2. **Implement single fix.** Address the root cause. ONE change at a time. No "while I'm here" improvements. No bundled refactoring.

3. **Verify fix.** Test passes? Other tests still pass? Issue actually resolved?

4. **If fix doesn't work — STOP.** Count fixes attempted:
   - **< 3:** Return to Phase 1, re-analyze with new information.
   - **≥ 3:** STOP and question architecture (step 5).
   - Don't attempt fix #4 without architectural discussion.

5. **If 3+ fixes failed — question architecture.**

   Pattern indicating architectural problem:
   - Each fix reveals new shared state / coupling / problem in a different place
   - Fixes require "massive refactoring" to implement
   - Each fix creates new symptoms elsewhere

   STOP and question fundamentals:
   - Is this pattern fundamentally sound?
   - Are we sticking with it through inertia?
   - Should we refactor architecture vs. continue fixing symptoms?
   - **Discuss with user before attempting more fixes.**
   - This is a candidate for a DDR (rebuild-vs-refactor decision).

   This is **not** a failed hypothesis — this is a wrong architecture.
