---
name: desktop-e2e
description: Run or author DOM-driven end-to-end scenarios against the bundled Maude desktop app (Tauri + WKWebView) using WebdriverIO. Use when the user asks to "run desktop e2e", "test the native app", "regression-test the desktop build", "add a desktop scenario", or when closing a feature that touched the native shell (apps/desktop) / studio UI and needs native verification beyond browser-mode agent-browser.
---

# desktop-e2e — DOM-driven E2E for the native Maude `.app`

Repo-internal skill (Maude-specific; lives in `.claude/skills/`, **not** shipped via the marketplace or npm). It owns how we drive the **real bundled desktop app** in scenario tests — the native counterpart to `agent-browser` (which only reaches the web layer at `http://localhost:<port>`, never the native shell).

Background + decisions: `.ai/plans/feature-desktop-e2e-scenario-harness.md`, memory `project_tauri_desktop_e2e_testing_path`, and `feedback_prefer_dom_driven_e2e_not_computer_use`.

## The one rule

**DOM-driven, never computer-use.** Find elements by `data-testid`, click/type, assert on DOM/text, screenshot for evidence. Computer-use/pixel-vision is too flaky (user feedback) and is NOT used here. Native menu actions are invoked via `window.__TAURI__` commands (see `helpers/native.ts`), not by clicking native chrome.

## What it is

- **Harness:** `apps/desktop/e2e/` — WebdriverIO + [`@wdio/tauri-service`](https://www.npmjs.com/package/@wdio/tauri-service) (Tauri's official E2E path). On macOS the service runs an **embedded W3C WebDriver server inside the app** (no external driver — Apple ships none for WKWebView). The Rust crate `tauri-plugin-wdio-webdriver` is registered in `apps/desktop/src-tauri/src/lib.rs` under `#[cfg(debug_assertions)]`, so the **shipped release `.app` never starts a WebDriver server** — only `tauri dev` and the `--debug` test build do.
- **Scenarios:** `apps/desktop/e2e/scenarios/*.e2e.ts`. The committed **spec** lives in `.ai/scenarios/<slug>/spec.md`. **Run outputs go to the SAME place as `/flow:scenario`** — `.ai/device/scenario-runs/<slug>/<YYYY-MM-DD-HHMM>/` (gitignored): `report.md` at the run root + screenshots under `native-desktop/`. Per the scenario convention, **never write run outputs into `.ai/scenarios/<slug>/`** (that's spec/runners only).
- **Fixture:** `apps/desktop/e2e/fixtures/project/` — a minimal `.design/` project the test app opens via `MAUDE_PROJECT_ROOT`, bypassing first-run/project-picker so scenarios need no native dialog.

## How to run

```sh
# 1. (once / after harness or dep changes) install the e2e workspace deps
pnpm install

# 2. (once / on studio-client or Rust source change) build the test app
pnpm test:e2e:desktop:build      # → apps/desktop: tauri build --debug

# 3. run the scenarios
pnpm test:e2e:desktop            # → wdio run apps/desktop/e2e/wdio.conf.ts
```

Requires the macOS/Windows toolchain (cargo + tauri-cli). The `tauri build` `beforeBuildCommand` syncs the Bun sidecar binary automatically.

> **Studio client changes need a bundle rebuild first.** The test app serves the committed `apps/studio/dist/client.bundle.js`. If you added/changed `data-testid`s in `apps/studio/client/`, rebuild release-minified before `test:e2e:desktop:build`: `cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release` and commit `dist/client.bundle.js` + `dist/styles.css` (CLAUDE.md rule).

## The `data-testid` convention

Scenarios target `data-testid`, never CSS classes (classes churn with the DS). Format: `data-testid="<area>-<thing>[-<id>]"`, kebab-case, slug-derived for list items. Established hooks in `apps/studio/client/app.jsx`:

| testid | Element |
| --- | --- |
| `canvas-list` | the sidebar file tree (`.st-tree`) |
| `canvas-row-<slug>` | a canvas row; `<slug>` = the canvas path kebab-cased (e.g. `ui/Smoke.tsx` → `canvas-row-ui-smoke`) |
| `canvas-frame` | the **active** canvas iframe |
| `smoke-artboard-content` | content inside the fixture canvas |

When a new feature adds UI a scenario must reach, add a `data-testid` to that element in the same change.

### The v2 shell's hooks (where to look, what to use)

The v2 shell re-emits the v1 hooks that kept their meaning and adds about 1,700 new ones. **The inventory is the source of truth:** `apps/studio/client/testids.json` (one record per hook: `hook`, `pattern`, `meaning`, `producer`, `region`, `consumers`, `v2`) and its readable twin `apps/studio/client/TESTIDS.md`. A hook marked `retired` has a `notes` field naming its replacement; never target one. Look a hook up before you write a selector: `jq -r '.[] | select(.hook|test("^vh-")) | [.hook,.v2,.meaning] | @tsv' apps/studio/client/testids.json`. Testids are an API: a new hook goes into both files in the same commit, an existing one is never renamed.

Regions a scenario usually needs (all live; `<…>` is a pattern):

| Area | Anchor hooks |
| --- | --- |
| Shell chrome | `project-pill` (opens `project-menu`; rows are `project-menu-row-<action-id>`, submenus `project-menu-row-sub-<name>`), `share-cluster` · `share-cluster-share` · `share-cluster-status` (`data-status`), `panel-icon-<which>`, `palette-input` · `palette-row-<id>` (⌘K), `settings-sheet` |
| Home and sign-in | `home-root`, `home-search`, `home-recent-row-<pid>-<slug>`, `signin-card` · `signin-local` · `signin-cloud`, `onb-<sheet>` (Advanced sheets) |
| Canvases and the open canvas | `canvas-list`, `canvas-row-<slug>`, `canvas-row-trashed-<slug>`, `canvas-frame`, `empty-canvas`, `toolbar-<mode>` · `toolbar-slot-<toolId>`, `edit-name-tag` and the other `edit-*` object hooks |
| AI chat | `ai-chat-header`, `ai-chat-island`, `chat-composer`, `chat-tool-row`, `takes-island` |
| Version history and Trash | `vh-panel`, `vh-now`, `vh-filter-<id>`, `vh-list`, `project-history-row-<revision>` · `project-history-restore-<revision>` · `project-history-undo-<revision>`, `all-trashed` · `all-trashed-restore` |
| Comments and annotations | `comments-panel`, `comment-item-<id>`, `comment-filter-<id>`, `annotation-list`, `stickers-*`, `vote-sheet` |
| Present and video | `present-controls`, `present-zone`, `presenter-view`, `timeline-panel`, `transcript-panel`, `video-scrub-bar` |
| Export, assets, handoff | `export-format-<id>`, `export-scope`, `exports-panel`, `assets-panel`, `assets-search`, `handoff-sheet`, `handoff-target-<id>` |
| Design system | `ds-bar`, `ds-section-<kind>`, `ds-bar-pending`, `ds-review-scrim`, `canvases-ds-row` |
| Diagnostics and sync | `diag-tab-<view>`, `diag-logs`, `diag-logs-filter-<source>`, `sync-panel`, `sync-row-<slug>`, `sync-resync` |
| Inspector | `inspector-panel`, `insp-sec-<id>`, `insp-row-<name>`, `layers-panel` |

Notes for v2 scenarios: the canvas is a separate origin (see the gotchas), so drive it by coordinates or a structural route, not by selectors inside it; words in assertions come from the CONTRACT (`.design/system/maude-v2/CONTRACT.md` §3), so assert "Version history", "Trash", "Annotations", never the v1 names; and a scenario for a role-gated action asserts the server's refusal, not only a hidden button.

## How to add a new scenario

1. **Add testids** to the studio-client (or native) elements the flow touches; rebuild the bundle (above).
2. **Write the spec:** `.ai/scenarios/<slug>/spec.md` (mirror `app-boots-and-renders-canvas/spec.md`; platform matrix lists `native-desktop`).
3. **Write the test:** `apps/desktop/e2e/scenarios/<slug>.e2e.ts`. Use the helpers: `waitForSidecar()`, `enterCanvasFrame()`/`exitToTop()`, `capture(label)` (screenshot + report row), `invokeTauri(cmd, args)` / `isNativeShell()`.
4. **Run** via `/desktop-e2e <slug>` or `pnpm test:e2e:desktop`.

### Scenarios that need native dialogs / OAuth — debug-only stubs (BUILT)

The pilot avoids native chrome by opening the fixture via `MAUDE_PROJECT_ROOT` and calling Tauri commands directly. A scenario that genuinely needs the native file picker or the GitHub device flow drives Home's sheets via two **deterministic stubs** gated behind `#[cfg(debug_assertions)]` (so NEVER in the release `.app`):

- **`MAUDE_E2E_PICK_DIR`** → `pick_directory` (`src-tauri/src/lib.rs`) returns this path instead of opening the native folder dialog.
- **`MAUDE_E2E_FAKE_GITHUB_LOGIN`** → `github_sign_in` (`src-tauri/src/oauth.rs`) emits a deterministic device-code (`E2E-CODE`) for ~2.5 s, then "authorizes" and reports the fake login — no browser, no network, no keychain write.

The first-run scenario is **`onboarding.e2e.ts`** + **`wdio.onboarding.conf.ts`** (`pnpm test:e2e:desktop:onboarding`). First launch IS Home (S6.8; S6.15 retired the v1 `OnboardingWizard`, `app_is_first_run` and `MAUDE_FORCE_ONBOARDING`): the config DROPS `MAUDE_PROJECT_ROOT`, wipes the `com.maude.app.e2e` app-state and points `MAUDE_HOME_PROJECTS_DIR` at a throwaway dir, so the boot opens the `home` window with the sign-in card (`signin-card`, `signin-local`, `signin-advanced`, `signin-adv-<id>`). A new project starts EMPTY (Q10, `scaffoldDesign` seeds no canvas); Help › Help and guides (`help-add-guides`) adds the two guide canvases. Lanes that start on a clean profile enter a project through `helpers/home-entry.ts` (`connectHubFromHome`, `focusHome`, `followNewTab`). The retired wizard hooks (`onboarding-wizard`, `ob-door-*`, `ob-device-*`, …) are marked `retired` in `client/testids.json` with their new home. A `project-switch`-style scenario can still reuse `MAUDE_E2E_PICK_DIR`.

## Known gotchas (all VERIFIED on the first real run, 2026-06-29)

The pilot run surfaced five real integration issues — every one is now fixed/encoded in the harness. Keep these in mind when extending:

- **Pin `@wdio/tauri-service` to `1.1.0` (exact, not `^`).** `1.2.0` (current latest) is published broken — it imports `installMockSyncOverride` from `@wdio/native-utils`, which that version doesn't export, so the service fails to initialize. `^1.2.0` would regress to it. Re-check when a `1.2.1+` ships.
- **Distinct bundle identifier for the e2e build (`com.maude.app.e2e`, in `tauri.e2e.conf.json`).** Without it, the `tauri_plugin_single_instance` plugin makes the test launch **focus a developer's already-running Maude** (same `com.maude.app`) instead of spawning a fresh fixture instance — the test then drives the wrong project. The distinct id isolates the e2e instance (own single-instance lock, own app-state dir).
- **Pin a non-default embedded WebDriver port (`embeddedPort: 4455`, in `wdio.conf.ts`).** The default is 4445; a developer's running **debug** Maude also carries the wdio plugin (it's `#[cfg(debug_assertions)]`) and answers on 4445, so the harness would connect to the wrong instance. 4455 sidesteps the collision.
- **First-run wizard suppression.** A distinct identifier ⇒ fresh app-state ⇒ `is_first_run` true ⇒ the OnboardingWizard renders over everything. `app_state::is_first_run` now returns false when `MAUDE_PROJECT_ROOT` is set (an explicit project target = not a first run). `MAUDE_PROJECT_ROOT` reliably forwards: the embedded provider spawns the app with `{...process.env}`.
- **`data-testid` for canvas rows strips the designRoot prefix.** `file.path` is `.design/ui/Smoke.tsx` (with the `.design/` root), so the slug derivation strips a leading dot-folder → `canvas-row-ui-smoke` (not `…-design-ui-smoke`).
- **Canvas iframe content is a SOFT assertion (step 5b).** The canvas takes a few seconds to build+render after opening (an immediate post-click screenshot can show "0 ARTBOARDS" — it's timing, not a runtime gap; a later screenshot shows the full render). The hard assertion is the top-frame `canvas-frame` element + its `data-path`; the in-frame DOM check is best-effort (cross-origin DDR-054 if the split is on; with `MAUDE_CANVAS_ORIGIN_SPLIT=0` it's same-origin and renders — confirmed visually in the evidence). Tighten to a hard in-frame assertion (with generous waits) when a scenario must prove deep canvas DOM.
- **A git-repo fixture must be OFFLINE (refs-only, no configured remote URL).** A fixture with a real `remote.origin.url` (e.g. `https://github.com/…`) makes the dev-server's unattended ahead/behind probe spawn a `git fetch` to that host during boot; that network call keeps the WKWebView JS unresponsive long enough that the embedded WebDriver's `execute`/`getUrl` time out — the harness hangs at `waitForSidecar` and the scenario fails before its first assertion (observed on `git-branch-switcher`, 2026-06-30). Fix: write `refs/remotes/origin/*` directly with `git update-ref`/`git symbolic-ref` and do NOT `git remote add` → `classifyRemoteUrl` returns `none`, the probe is a no-op, boot is deterministic. The "remote · not downloaded yet" rows still render (they read disk refs, not the remote config). See `apps/desktop/e2e/fixtures/make-git-fixture.ts`.
- **`tauri-service: Failed to wait for plugin initialization` (script timeout) is non-fatal.** It's the service's wdio mock-store injection giving up; scenarios that don't use request mocking (all of ours) still run + pass once the webview settles. Don't chase it.
- **No active display ⇒ the whole harness wedges (run it on a machine with a woken screen).** If EVERY WebDriver command times out — `execute/async`, then `getUrl` / `element` at 60 s each, so `waitForSidecar` fails before the first assertion — the cause is usually that the session has **no awake display**. macOS throttles the off-screen WKWebView (occlusion / App-Nap) so its embedded WebDriver can't answer. Confirm in seconds WITHOUT WebDriver: `screencapture -x` comes back **fully black**, `pmset -g powerstate IODisplayWrangler` errors, and `osascript … get size of windows` returns empty bounds — meanwhile `curl http://localhost:<port>/_health` is `ok` (the sidecar is fine; only the webview is throttled). This is the `feedback_native_app_verification_ceiling` in its "headless / display-asleep" form — it is NOT a scenario or app defect. Re-run with the screen awake (or hand the run to the user's interactive session, as the git scenarios were verified). `caffeinate` can't conjure a display that isn't attached.
- **Signed vs test build:** the harness drives a `--debug` build (embedded WebDriver), not the exact signed release. Same source, different profile — a near-release smoke, documented.
- **Not covered:** the Bun sidecar process itself, native OS dialogs, and the macOS menu bar chrome — assert their *effects* via the webview / Tauri commands, or a separate probe. Dialog/OAuth stubs (for first-run/project-switch scenarios) are still deferred (above).

## When NOT to use

Browser-renderable studio UI is cheaper to verify with `agent-browser` in browser mode (`maude design serve`). Reach for desktop-e2e only for native-shell behavior: sidecar lifecycle, webview navigation, first-run, project switch, native menus, OAuth/keychain, updater.
