# Scenarios

Cross-platform UI scenarios. One folder per scenario; per-run reports inside.

> This file documents the **directory layout** convention for individual scenarios. For *behavioral* deltas from `/flow:validate --scenario`'s generic protocol (device lifecycle, selector conventions, infra-error classification, platform gotchas), see `../scenario-guide.md` instead — the two files have distinct scopes and shouldn't be merged.

## Layout

```
scenarios/
├── _lib/                       — shared helpers (selectors, fixtures, env)
└── <scenario-slug>/
    ├── spec.md                 — what the flow does, success criteria, platform matrix
    ├── covers.json             — OPTIONAL: { web/native/shared git pathspecs } the scenario exercises
    └── <YYYY-MM-DD-HHMM>/
        ├── report.md           — TL;DR + per-platform pivot table + counter deltas
        ├── web-desktop/        — screenshots, logs
        ├── web-mobile/
        ├── ios-phone/
        └── android-phone/
```

## Conventions

- **Scenario slug:** kebab-case, action-oriented (`coach-creates-recurring-practice`, `signup-via-invite`).
- **Run timestamp:** local time of the run start. Latest run = lexicographically last folder.
- **Report format:** owned by the `scenario` skill — `maude scenario-report <run-dir>` generates the mechanical tables; the LLM authors only the prose sections.
- **`covers.json`** (optional): declares the source globs the scenario exercises, split into `web` / `native` / `shared` git pathspecs. Enables the route-aware skip (re-run only when covered files changed) and the web-only scope skip (no sim boot for web-only diffs). Example: `{"web":["app/(video)/**"],"native":["expo-app/**"],"shared":["packages/api-client/**"]}`. Absent → the scenario always runs the full platform matrix.

Run with `/flow:validate --scenario <slug>` (registered scenarios) or `/flow:validate --scenario <ad-hoc description>` (one-off).
