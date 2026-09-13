## Infra-error vs product-fail classification

A step can fail for two very different reasons: the product regressed, or the environment flaked (device boot timeout, network blip, stale simulator/emulator state, daemon left over from a previous run). Only the first should ever block `/flow:validate`/`/flow:done`.

Extend the `result.txt` contract above with a third state: `infra-error: <reason>` (alongside `pass` and `fail: <reason>`). A runner writes `infra-error` instead of `fail` when it's confident the failure is environmental — not the app under test. `scenario-runner` treats `infra-error` platforms like `skipped`: reported, but never counted toward blockers.

If a project wants this bound to a concrete signal (e.g. a specific reserved exit code the runner scripts use), declare it in the scenario guide's "Infra-error classification overrides" section — the default here is the `result.txt` string convention above, which needs no exit-code plumbing.

---
