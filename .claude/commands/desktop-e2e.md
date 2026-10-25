---
description: "Run DOM-driven E2E scenario(s) against the bundled Maude desktop app (Tauri + WebdriverIO). Builds the test app if stale, runs the scenario, surfaces the report."
argument-hint: "[<scenario-slug> | all]   (default: all)"
---

# Run desktop E2E scenarios

Drive the **real bundled `Maude.app`** through DOM-driven scenarios and report pass/fail + the evidence path.

> Repo-local command — specific to maude's native desktop shell (`apps/desktop`), not part of the published flow/design plugins or the `maude init` skeleton. Lives in `.claude/commands/`. The authoritative how/why is the **`desktop-e2e` skill** — this command is the thin runner.

## Steps

1. **Load the skill.** Read `.claude/skills/desktop-e2e/SKILL.md` and follow it as the source of truth.

2. **Resolve the target.** `$ARGUMENTS` is a scenario slug (matches `apps/desktop/e2e/scenarios/<slug>.e2e.ts`) or `all` / empty → every scenario.

3. **Ensure deps.** If `apps/desktop/e2e/node_modules` is missing, run `pnpm install` (the e2e workspace member's deps).

4. **Ensure the test build is fresh.** Build the `--debug` test app when missing or stale:
   - Missing: no `apps/desktop/src-tauri/target/debug/bundle/macos/Maude.app` (or the platform equivalent).
   - Stale: `apps/studio/client/` or `apps/desktop/src-tauri/src/` changed since the last build.
   - If studio-client changed, **rebuild the committed bundle first**: `cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release` (then it ships in the test app).
   - Build: `pnpm test:e2e:desktop:build`.

5. **Run.** `pnpm test:e2e:desktop` (all) or scope to the slug:
   `pnpm --filter @maude/desktop-e2e exec wdio run ./wdio.conf.ts --spec scenarios/<slug>.e2e.ts`.

6. **Report.** Surface: pass/fail per scenario, the evidence dir — same place as `/flow:validate --scenario`: `.ai/device/scenario-runs/<slug>/<YYYY-MM-DD-HHMM>/` (`report.md` + `native-desktop/*.png`, gitignored) — and read the screenshots into context to confirm the render actually looks right (don't trust a green exit alone — DDR-021 lesson). On failure, give the failing step + the WebdriverIO error.

## Notes

- macOS/Windows toolchain required (cargo + tauri-cli). Drives a `--debug` build, not the signed release (see the skill's gotchas).
- No computer-use — everything is DOM-driven via `data-testid`.
