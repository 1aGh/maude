### Stop-condition vocabulary

The loop tracks two quality axes per iteration, both produced by the panel:

- **`correctness_blockers`** — sum of `blockers` across non-aspiration critics (`design-critic`, `a11y-critic`, `typography-critic`, …) **including `design-system-keeper` and `brand-critic`**. Under `dsFidelity: strict` (DDR-141) their reuse findings arrive AS blockers, so the loop cannot exit `SOLID` while a shipped specimen (logo, icon family, component, shell) stays reinvented; under `advisory` they arrive as warnings and don't gate. Drives correctness gate.
- **`aspiration_score`** — `signature-moment-critic.aspiration_score` (0–5 normalized). Drives aspiration gate. If `signature-moment-critic` is not in the panel, treat aspiration_score as 5 (auto-pass, axis not measured).
- **`specificity`** — `signature-moment-critic.specificity` (`pass | fail`). Hard gate — fail blocks success even if everything else is green.
