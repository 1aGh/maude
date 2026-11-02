# Gate policy (Michal, 2026-11-01 — kg `v2-michal-gates-scoped-recheck`)

Michal, verbatim via the keeper: "1. ano / 2. ano / musi to jit nejak paralelne udelat, vzdy dokoncit davku mensich
oprav, pustit quality jako kdyby to bylo normalni PR a potom az je nejaka phase hotova udelat dukladny test".

1. **Order.** The gates that most often find something — 8.7 a11y, 8.8 / 8.14 perf, 8.9 security delta, 8.15 docs,
   nothing-deleted, dead-controls — run BEFORE the freeze, in parallel (figga / mini / this Mac). chain4
   (8.1 → 8.3 ×3 → 8.18 → 8.2) is the last step, once those are green.
2. **Scoped re-check.** After a green chain4, a trivial change (CSS, copy, a11y ink, tests, harness scripts — no
   product logic) does not re-run chain4. Run 8.1 quality + the gate that found it + the e2e specs on that surface +
   client-boots, then carry the green command gates to HEAD:
   `node scripts/v2-gates.mjs --carry V2-8.3 --from <green sha> --checks "<what ran>" [--allow <path>,…] --note "…"`.
   The evidence keeps `carriedFrom` and the exact `scoped.diff`. A logic change takes the full chain4.
3. **Work like a normal PR.** Finish a batch of small fixes → quality as a regular PR check (lint / tsc / unit / hub
   on figga, the studio suite on the mini) → next batch. The thorough test (chain4 + every re-attest) runs once per
   phase / round, when the batch is closed.
4. **Parallelism.** Builders in parallel; quality runs on figga / the mini while the next batch is prepared; this
   Mac only for 8.3, the 8.18 Docker record and the .app.
