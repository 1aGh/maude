## Report shape (deliverable)

`runs/<timestamp>/report.md` is the single thing the human reads. Required sections, in this order:

1. **TL;DR table** — one row per platform: result (PASS / FAIL / SKIPPED), steps reached, tooling.
2. **Counter-delta verification** — the strongest cross-platform parity signal. One row per platform, columns for each numeric counter that should have moved (e.g. `mastered Δ`, `remaining Δ`). Identical deltas across rows = scenario verified.
3. **Per-step pivot table** — **rows = platforms, columns = step thumbnails** (markdown image embeds). Lets the human eyeball cross-platform parity in one glance instead of scrolling a 10-row table sideways.
4. **What surprised us** — non-obvious findings (UX differences, broken expectations, unexpected counter math, mid-run state changes).
5. **Recommended follow-ups** — prioritized list of codebase changes that would make the scenario more reliable (e.g. missing testIDs).

The wide path-listing (per-step file paths per platform) goes in a collapsed `<details>` block at the end — useful for repro but not the primary content.

```markdown
## Per-step screenshots (pivot)

| Platform      | Step 1 home                        | Step 5 grid                                 | Step 8 final                      |
| ------------- | ---------------------------------- | ------------------------------------------- | --------------------------------- |
| web-desktop   | ![](web-desktop/step-1-home.png)   | ![](web-desktop/step-4-flashcards-grid.png) | ![](web-desktop/step-8-final.png) |
| web-mobile    | ![](web-mobile/step-1-home.png)    | ![](web-mobile/step-5-flashcards-grid.png)  | ![](web-mobile/step-8-final.png)  |
| ios-phone     | ![](ios-phone/step-1-home.png)     | ![](ios-phone/step-5-flashcards.png)        | ![](ios-phone/step-8-final.png)   |
| ios-tablet    | ![](ios-tablet/step-1-home.png)    | ...                                         | ...                               |
| android-phone | ![](android-phone/step-1-home.png) | ...                                         | ...                               |

## Counter delta

| Platform    | `mastered` Δ | `remaining` Δ |
| ----------- | ------------ | ------------- |
| web-desktop | +3           | −3            |
| web-mobile  | +3           | −3            |
| ...         | ...          | ...           |
```

---
