### 10. Tell user

```
✓ Edited: <path>
  Snapshot: <hist>/NNN-ts.bak (rollback with /design:rollback)
  Lines changed: <range>
  Baseline: <hist>/NNN-baseline.png

  Critic panel ({list}):
    correctness: {X} blockers · {Y} warnings
    {if signature-moment-critic in panel:}
    aspiration: {n}/5 (signature {n}, brand {n}, fidelity {n}, restraint {n}, neg-space {n}) · specificity: {pass|fail}
    verdict: {solid | stable-but-bland | max-reached | divergent | validation-failed}
  {if iter > 1 or --perfect, list iterations: "iter 1 → iter 2 → iter 3 (final)"}
  {if restored: "↺ restored to iter K (best result)"}
  {if stable-but-bland: "Lowest axes: <list>. Targeted feedback would lift these."}

  Docs: <designRoot>/INDEX.md updated, iter {N}.

  Reload browser tab to see changes (Cmd+R inside the iframe).
```
