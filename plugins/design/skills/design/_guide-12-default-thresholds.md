### Default thresholds

```
SOLID = correctness_blockers == 0
        AND aspiration_score >= 4.0
        AND specificity == "pass"
        AND no_gains_for_1_round   # stable — last fix didn't move scores
```
