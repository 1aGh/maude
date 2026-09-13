### 9. Refresh docs (auto)

After auto-critic loop completes (or `--no-critic` skipped it), call the **incremental docs refresh** described in `skills/design/SKILL.md` "Continuous docs maintenance":

1. Update `<canvas>.meta.json` (`last_modified`, `iteration_count`, `tokens_used`).
2. Update `<designRoot>/INDEX.md` row for this canvas.
3. Update `<designRoot>/README.md` "Last updated" line.

Failure here is non-fatal — print warning, don't restore the canvas. (User can run `/design:setup-docs --full` to recover.)
