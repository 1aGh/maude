---
name: scenario
category: daily
type: command
description: "Run cross-platform web and native UI scenarios with screenshot evidence and a report."
keywords: [scenario, validate, e2e, smoke, cross-platform, agent-browser, agent-device]
argument-hint: "<scenario-name> | new <scenario-name>"
---

# /scenario — cross-platform UI flow runner

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

**This is the validation backbone.** For every UI feature there must be at least one scenario that verifies it across 5 platforms. Web-only or native-only features use a subset.

Wrapper around the `agent-browser` + `agent-device` skills. Full protocol in `.claude/skills/scenario/SKILL.md`. Repo-specific overrides (device lifecycle, selector conventions, infra-error classification, platform gotchas) live in the project's own scenario guide (`paths.scenarioGuide`, default `.ai/scenario-guide.md`) — the skill resolves and applies it automatically, no project-local wrapper skill needed. See the skill's "Repo-owned scenario guide" section.

## Input

`$ARGUMENTS`:
- `<scenario-name>` — run an existing scenario from `.ai/scenarios/<name>/`
- `new <scenario-name>` — create a new scenario (interactively pilot via agent-browser/agent-device, save runners)
- (empty) — list all scenarios from `.ai/scenarios/` plus their last run status

## Process — existing scenario

0. **Route-aware skip + scope (Phase C / DDR-061)** — see the `scenario` skill's "Phase C speed levers" for the recipes:
   - **C15 skip:** if `.ai/scenarios/<name>/covers.json` exists and its covered files are unchanged since the last **green** run (the `scenario/<name>/<covers-sha>` cache), print "last passed green on this exact covered-file set — skipping. Use `--force` to re-run." and reuse the cached report.
   - **C18 web-only:** if the in-scope diff touches only `web` pathspecs (no `native`/`shared`), run only the web variants and mark native platforms `skipped: web-only change` — don't boot or detect sims at all.

1. **Pre-flight:**
   - `agent-browser --version` + `agent-device --version` — verify install
   - **C16 — background sim/AVD boot:** unless web-only (C18), fire `xcrun simctl boot` + AVD start with `run_in_background: true` and **Monitor** their booted state (`simctl bootstatus` / `adb wait-for-device`); proceed to run the web variants while they come up. Fall back to synchronous boot if `run_in_background` is disabled.
   - `xcrun simctl list devices booted` — find UDIDs of iPhone + iPad sims (if any)
   - `adb devices` — find Android serial (if any)
   - Platforms without a booted sim/AVD are **skipped** with a `result.txt` reason, not a fail of the whole run

2. **Run** per the protocol in the `scenario` skill — web in parallel (sequential between web variants) + native (parallel among themselves). By the time the web variants finish, the C16 background boots have completed, so natives run with no extra wait.

3. **Generate the report** deterministically (Phase C / DDR-061) — don't hand-author the mechanical tables:
   ```bash
   maude scenario-report ".ai/device/scenario-runs/<name>/<YYYY-MM-DD-HHMM>"
   ```
   This walks each `<platform>/result.txt` + `step-*.png` (+ optional `counters.json`) and writes `report.md` with the TL;DR table, counter-delta parity table, per-step pivot, and a collapsed path-listing. **You author ONLY the two prose sections** it leaves as `<!-- LLM-AUTHORED -->` placeholders — "What surprised us" and "Recommended follow-ups" (testIDs to add, fragile selectors, parity gaps). Replace each placeholder comment with real prose; delete the comment.

4. **Next-step suggestion:** _"Scenario `<name>` ran: <X>/<Y> platforms pass. Report: `<path>`. Post to PR?"_

## Process — `new <scenario-name>`

1. Create `.ai/scenarios/<name>/` directory with `runners/` and `README.md`.
2. **README.md** — the user describes:
   - **User flow** — steps 1..N (e.g. "Open Video tab → click first tape → tag at 12s → save clip")
   - **Persona** from the project PRD (who does it)
   - **PRD reference** — which screen brief this covers
   - **Fixtures** — seed data the scenario needs (test team, test video URL, etc.)
   - **Expected end state** — what must be true after the last step (counter delta, navigation state)
3. **Pilot interactively** via agent-browser (web) and agent-device (native) per the skill. `agent-device --save-script` records the native flow automatically.
4. **Save runners** — one bash script per platform in `.ai/scenarios/<name>/runners/`.
5. **Smoke test** — run the freshly written scenario. If it passes 5/5, commit the runners.

## Acceptance criteria for a scenario

A scenario is **production-ready** when:

- [ ] Runners are idempotent (can be run again without cleaning state)
- [ ] Selectors use testIDs or semantic locators (not fragile DOM class chains)
- [ ] The counter-delta section in the report has identical values across platforms (parity)
- [ ] If testIDs are missing → the follow-ups section in the report contains concrete tickets

## Known scenarios

`.ai/scenarios/` — read files directly. `/scenario` (no arguments) prints the list.

## Integration

- **`/plan`** — Acceptance Criteria for a UI task must name at least one scenario.
- **`/execute`** — during the Edit-Verify loop (max 3 iterations) it runs an agent-browser smoke for web after each edit, but a full scenario only in `/flow:utils-verify`.
- **`/flow:utils-verify`** — if the feature has UI touch, runs the relevant scenario (web-desktop + web-mobile minimum, native only if the feature touches RN code).
- **`/validate`** — always full scenario across all 5 platforms.
- **`/done`** — requires a passing scenario report as a gate. The report URL goes into the PR description.
