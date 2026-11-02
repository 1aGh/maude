### Stop-condition vocabulary

The loop tracks two quality axes per iteration, both produced by the panel. Each critic's numbers come from its `HandoffOut`, mapped by `handoffToCriticVerdict` (`cli/lib/handoff.mjs`; the table is `/design:critic` step 7), so the fields below are the same ones the pre-hand-off verdict carried:

- **`correctness_blockers`** — sum of `blockers` across non-aspiration critics (`design-critic`, `a11y-critic`, `typography-critic`, …) **including the round's `maude design check` errors, `design-system-keeper` and `brand-critic`**. Under `dsFidelity: strict` (DDR-141) their reuse findings arrive AS blockers, so the loop cannot exit `SOLID` while a shipped specimen (logo, icon family, component, shell) stays reinvented; under `advisory` they arrive as warnings and don't gate. Drives correctness gate.
- **`aspiration_score`** — `signature-moment-critic.aspiration_score` (0–5 normalized; its result's `result.verdict.aspiration_score`). Drives aspiration gate. If `signature-moment-critic` is not in the panel, treat aspiration_score as 5 (auto-pass, axis not measured).
- **`specificity`** — `signature-moment-critic.specificity` (`pass | fail`; its result's `result.verdict.specificity`). Hard gate — fail blocks success even if everything else is green.
- **A critic with no valid result** (missing, invalid, `status: "blocked"`) counts as **not measured**, never as 0 blockers. Name it in the panel, and do not exit `SOLID` on a round where `design-critic` or `a11y-critic` was not measured.
