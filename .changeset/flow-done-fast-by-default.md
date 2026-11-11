---
"@1agh/maude": minor
---

`/flow:done` now runs the fast close by default (`/flow:validate --fast`, everything else unchanged): what used to be `/flow:done --quick`. The whole `/flow:validate` (build, scenario, a11y, design-system) plus the CLAUDE.md debrief moved to `/flow:done --full`; use it for auth, migrations, cross-package, CI config or security-sensitive work, or when no full validate or CI runs before merge. `--quick` is still accepted and changes nothing. `/flow:bug-fix` with the orbit tracker hands off to plain `/flow:done`.
