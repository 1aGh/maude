# git-lifecycle

**native-desktop** E2E scenario — drives the COMPLETE in-repo git lifecycle through the bundled Maude `.app` UI (switcher + GitPanel), DOM-driven, one screenshot per operation. Validates **DDR-133** end-to-end against a local bare remote (never GitHub). Repo-switch is split into the separate `git-switch-repos` scenario (its sidecar-respawn is WebDriver-flaky).

**Persona:** developer doing a full save → publish → sync cycle in the desktop app.
**Decision:** [DDR-133](../../decisions/DDR-133-system-git-autodetect-and-git-native-switcher-vocabulary.md). Harness: `apps/desktop/e2e/` (`wdio.lifecycle.conf.ts` → `make-lifecycle-fixture`). Skill: `desktop-e2e`.
**Auth model:** the conf sets `MAUDE_USE_SYSTEM_GIT=1` so push/pull/fetch run through system git, with no credential helper and no GitHub account involved. Reads/vocabulary are engine-independent.
**Fixture:** a FULL clone (not `--depth`, which would be single-branch) of a local bare repo that plays the team's remote. Since 5281d1e35 the clone's `origin` is `ssh://maude-e2e.invalid/<bare>`, served by a local ssh shim (`GIT_SSH_COMMAND`) because the product refuses a `file://` remote (DDR-131); `GIT_ALLOW_PROTOCOL=ssh` makes https a hard error (decision `v2-p8-e2e-lifecycle-local-bare-remote`).

## Platform matrix

| Platform | Required | Rationale |
| --- | --- | --- |
| **native-desktop** (`Maude.app`) | ✓ | GitPanel + switcher are `isNativeApp()`-gated (DDR-119); only the native shell renders the full git UI. |
| web-* / ios / android | N/A | Native-desktop-only surface. |

## Steps (automated — `apps/desktop/e2e/scenarios/git-lifecycle.e2e.ts`)

| # | Operation | Drives | Expected |
| --- | --- | --- | --- |
| 1 | boot | — | native shell + sidecar on `main`. |
| 2 | **new branch** | switcher → New branch → name → Create | trigger shows `smoke/ui-lifecycle`. |
| 3 | **switch branches** | switcher → `branch-row-main` → back | trigger flips main ↔ feature. |
| 4 | **commit** (Save version) | GitPanel: message + Save all (after a Node-side `.design/` write + reload) | "Version saved" → publish state. |
| 5 | **push** (Publish) | GitPanel → Publish | branch appears in the bare remote (`--git-dir` verify). |
| 6 | **fetch remote branches** | switcher → Fetch | a teammate `smoke/from-remote` (created in the bare remote) surfaces as a remote row. |
| 7 | **merge to main** (fold) | switcher → Merge this branch → main → confirm | lands on `main`; `ui-lifecycle.txt` reaches remote `main` (`--git-dir` verify). |
| 8 | **pull** (Get latest) | GitPanel → Get latest (after an out-of-band commit on the bare remote's `main`) | best-effort — the remote-ahead nudge is probe-timing-sensitive (45 s cache); captures whatever state it reaches. |

**Acceptance:** steps 1–7 hard-assert + screenshot; step 8 (pull) is best-effort (operation is verified at the API layer; the UI nudge is timing-sensitive). Run output → `.ai/device/scenario-runs/git-lifecycle/<ts>/` (gitignored). 9 screenshots.

## How to run

```sh
pnpm test:e2e:desktop:build       # one-time / on studio-client or Rust change
pnpm test:e2e:desktop:lifecycle
```

> Pushes only to the scenario's own local bare remote (a branch, a merge to main): nothing leaves this machine and no credentials are needed.
