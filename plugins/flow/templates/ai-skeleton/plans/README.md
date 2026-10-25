# Plans

Feature implementation plans. One file per feature, slug as filename (e.g. `onboarding-flow.md`).

## Lifecycle

1. `/flow:plan <feature>` — agent drafts the plan into `<feature>.md`, including task list, file touch map, scenarios.
2. `/flow:execute` — agent works through the task list, ticking items as `[x]`.
3. `/flow:done` — agent finalizes, runs validation, then moves the file to `archive/`.

## Conventions

- **Front matter:** `name`, `status` (`proposed | active | done | archived`), `created`, `decisions` (DDR IDs).
- **Task IDs:** `T1, T2, …` so `/flow:run --resume` can re-enter mid-flow.
- **Cross-links:** plan links to the PRD section it implements and to DDRs it depends on.
- **Archive on `/flow:done`,** not on completion of the last task — `archive/` means "shipped, link permanent."
