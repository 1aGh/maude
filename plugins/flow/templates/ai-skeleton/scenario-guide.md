# Scenario Guide — PROJECT_NAME

> Read by `/flow:validate --scenario` (skill + `scenario-runner` agent) before running or authoring a scenario. This file documents ONLY where this project's scenario testing diverges from `/flow:validate --scenario`'s generic protocol — device/platform matrix, selector strategy, report shape, speed levers. An absent or empty file is valid: `/flow:validate --scenario` runs its documented defaults with no changes. Delete any section below that doesn't apply to this project; don't fill a section with a generic restatement of the default behavior.

## Device / platform lifecycle

> Does this project need something other than the generic default (native platforms run in parallel where the host allows it)? State the constraint and why — e.g. a RAM- or CPU-constrained CI/dev box that can only hold one simulator/emulator alive at a time forces a sequential lifecycle instead.

_Not yet documented — using the generic default._

## Test account & reset strategy

> How does a scenario run get the app into a known state before asserting anything? If this project has a seeded test account, a fixture/profile system, or an in-app reset affordance, describe (or link to) it here. If this lives in its own skill (e.g. a dedicated test-account skill), reference it — don't duplicate its contents.

_Not yet documented — using the generic default (no project-specific reset step)._

## Selector strategy overrides

> `/flow:validate --scenario`'s default selector reach-order is: stable locator (testID / `data-testid`) → accessible name/text → vision-based check (advisory only, never gates a pass/fail). Document here only if this project's locator convention deviates — e.g. a different testID naming scheme, a platform where accessible-name lookup is unreliable, or an additional locator tier.

_Not yet documented — using the generic default._

## Infra-error classification overrides

> `/flow:validate --scenario`'s default treats environment/flake failures (device boot timeout, network blip, stale simulator state) as distinct from real product regressions, so they don't count as blockers. If this project binds that convention to a specific exit code or detection rule, document it here.

_Not yet documented — using the generic default._

## Platform-specific gotchas

> A running log of harness quirks specific to this project's stack (framework cold-start races, platform dialog chains, overlay/devtools collisions, coordinate math for custom pickers, etc.). Add an entry whenever a scenario run fails for a reason that isn't a product bug — future runs (and future contributors) benefit from not re-discovering it.

_None recorded yet._

## Scenario-authoring notes

> Anything specific to how new scenarios should be authored for this project beyond `/flow:validate --scenario`'s default collaborative loop (announce → act → screenshot → co-design asserts with the user → stop, one step at a time). E.g. project-specific `--save-script` conventions, or app areas that need special care when picking assertions.

_Not yet documented — using the generic default._
