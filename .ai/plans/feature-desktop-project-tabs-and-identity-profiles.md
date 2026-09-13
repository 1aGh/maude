---
name: feature-desktop-project-tabs-and-identity-profiles
status: active
created: 2026-09-13
decisions:
  - One native window tab per open project (Tauri `WebviewWindow` + macOS `tabbing_identifier`), each navigated to its own pooled sidecar origin — the origin-bound studio client gets NO project id and NO in-page tab strip.
  - Tauri's `unstable` in-window multiwebview is rejected (unstable API under a notarized auto-updating `.app`; merges the per-window CSP DDR-109 relies on).
  - Identity is scoped PER PROJECT, not per window: a machine-local project→profile binding in `app-state.json` (never in committed `.design/config.json`) that the shell turns into per-sidecar env the server already honours.
  - Secrets stay in the OS keychain (DDR-108); one keychain slot per profile; a per-spawn token-bridge key maps a sidecar to exactly one profile's token.
  - The debate (BUILDER / SHIPPER / BREAKER, 2026-09-13) converged on the window model; BREAKER's dissent on cross-account leakage is folded in as guard tasks (T6, T7, T14) and a DDR amending DDR-108 / DDR-132 / DDR-204, not as a v1 cut — the owner's request explicitly asks for per-tab logins.
---

# Feature: Desktop project tabs + per-project identity profiles

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports. The Rust shell is the centre of gravity here — read `apps/desktop/src-tauri/src/sidecar.rs` top-to-bottom before touching anything.

## Description

Maude Desktop today shows ONE project in ONE window. Switching projects re-navigates that window to another loopback origin, and every identity (GitHub token, Maude cloud account, hub sessions) is global per install. The owner wants several projects open at once as tabs, each possibly signed in as a different GitHub user or a different Maude cloud account, so they can work on several projects in one Maude Desktop without switching.

The good news, verified in code: the shell is already multi-project underneath. `sidecar.rs` keeps a **pool** of up to three live `maude-server` processes keyed by project root (`switch_project` is spawn-or-attach, added by `feature-acp-write-path-scope` Task 10), and the studio server already honours per-process env overrides for the cloud account file (`MAUDE_CLOUD_CONFIG`) and the hub-session file (`HUBS_CONFIG_PATH`). What is single is (a) the one `"main"` webview that navigates, (b) the one GitHub keychain slot behind one loopback token bridge handed identically to every sidecar, and (c) the one `cloud.json`.

This feature turns the pool into visible **native window tabs** (macOS draws the tab bar; Windows/Linux get plain separate windows) and adds **identity profiles** bound per project and injected at sidecar spawn.

## User Story

As Michal (the owner), I want several projects open as tabs in one Maude Desktop, each using the GitHub account and Maude cloud account that project belongs to, so that I stop switching projects and re-signing-in, and can work on StudyFi and personal projects side by side.

## Problem

- **One window.** `tauri.conf.json` declares exactly one window; `lib.rs`, `sidecar.rs` (`switch_project`, the post-crash respawn navigate) and the single-instance focus handler all call `get_webview_window("main")`. `SidecarState.project_root` is a single "the displayed project" string read by `resolve_dev_server_url`, `export_download_url`, the respawn `still_shown` guard, `notify.rs`'s "skip the displayed project", and the deep-link parking slot.
- **One GitHub identity.** `keychain.rs:26-27` is a fixed `(service, account)` pair; `set_token` overwrites. One `OnceLock` bridge mints one key at launch and `sidecar.rs:423-427` hands the SAME `MAUDE_TOKEN_ENDPOINT` + `MAUDE_TOKEN_KEY` to every sidecar — any project's server can read the one token. `github://signed-in` is emitted app-wide.
- **One cloud account.** `~/.config/maude/cloud.json` is a single record; `cloud/renew.ts` renews every cell session with that one account token. Hub sessions in `hubs.json` are keyed by hub URL only, so two accounts on the same cell URL would collide.
- **Prefs follow the port, not the project.** `localStorage` is per origin = per port; the 4399→4408 ladder is assigned in spawn order, so after a restart a project can inherit another's ~20 UI pref keys.
- **`MAX_INSTANCES = 3`** and `reap_instances` evict the least-recently-shown idle project — invisible today, but with tabs an eviction would be a tab whose server silently died.

## Solution

1. **Window model — one `WebviewWindow` per open project.** Window label `proj-<hash16(root)>` (the existing `"main"` window stays the first tab so nothing that reaches `main` breaks), `tabbing_identifier("maude-project")` on macOS, `data_store_identifier(hash16 bytes)` on macOS 14+ so each project gets its own cookie/localStorage store (fixes the port-swap prefs bug for free). Each window loads the same splash `index.html` and is navigated to its project's loopback URL through the unchanged `is_loopback_url` guard (DDR-109). `SidecarState` gains `windows: HashMap<label, root>`; "the displayed project" becomes "the project of the focused window". `switch_project` keeps working for in-tab switching; a new `new_tab: true` argument opens a window instead of navigating.
2. **Identity model — profiles bound per project, injected at spawn.** A profile is `{ id, label, githubLogin?, cloudEmail? }` in `~/.config/maude/profiles.json`; profile `default` maps to today's files (`~/.config/maude/cloud.json`, `hubs.json`, keychain account `maude-github-token`) so every existing install migrates with zero behaviour change. A non-default profile owns `~/.config/maude/profiles/<id>/{cloud.json,hubs.json}` and keychain account `maude-github-token:<id>`. The project→profile binding is `project_profiles` in `<app_config_dir>/app-state.json` (Rust-owned, per machine, never committed). `spawn_for` sets `MAUDE_PROFILE_ID`, `MAUDE_CLOUD_CONFIG`, `HUBS_CONFIG_PATH` and a **per-spawn** bridge key; the bridge maps key→profile and serves only that profile's token. DDR-108/132 invariants hold: the token is never on disk, never cached, never in `.design/`.
3. **UI.** `RepoBranchSwitcher` recents rows get "Open in new tab" (and the dock's "Open another folder…" gets a new-tab variant); File menu gains "Open Project in New Tab…". `IdentityBar` and `CloudBar` show which profile this tab uses and offer "Sign in as another account…", which creates a profile, signs in into its slot, rebinds the project, and restarts that project's server (env changed) with an explicit confirm.
4. **Deferred, explicitly:** per-`HOME` Claude ACP identity (DDR-166 — one `~/.claude` per machine), BYOK generation keys per profile (`keys.json` stays global), a tab bar on Windows/Linux (plain windows there), per-window deep-link routing (v1 delivers to the focused window), tab drag-out polish.

## Metadata

- **Ticket**: none yet (provider `github`; open an issue at `/flow:done` if the owner wants one)
- **Type**: New Capability
- **Complexity**: High
- **App/Package**: `apps/desktop` (Rust shell, e2e), `apps/studio` (server env + client panels), `cli/lib/hubs-config.mjs` (env parity)
- **Affected Systems**: sidecar pool + supervisor, token bridge / keychain, OAuth device flow, cloud attach + renewal, hub credential store, notifications poller, deep links, desktop e2e harness, `.ai/archive/decisions` (new DDR)
- **Dependencies**: none new. Tauri 2 stable API only (`WebviewWindowBuilder`, `tabbing_identifier`, `data_store_identifier`). NO `unstable` Cargo feature.
- **Concurrent plans (Syncthing tree, 2026-09-13)**: `feature-share-link-deeplink.md` and `feature-reliable-project-multiplayer.md` were drafted the same day by another session and are not yet committed. T7 (deep-link delivery to the focused window) overlaps the share-link plan's `deep_link.rs` work — before executing T7, `git log --oneline -- apps/desktop/src-tauri/src/deep_link.rs` and read that plan; whichever lands second rebases its parking-slot change on the other.
- **Mandatory**: `security-auditor` + `ethical-hacker` fan-out at `/flow:validate` — this change touches the token bridge and the ACP scope seam (`bridge.ts:229-231` states the rule; DDR-185's first cut shipped bypasses only that pass caught).

---

## Context References

### Must-Read Files

> When consuming this section during `/flow:execute`, **read every file listed here in parallel in a single assistant message** (multiple Read tool calls) — they're independent context loads.

- `apps/desktop/src-tauri/src/sidecar.rs` (whole file; esp. 80-145 pool rationale, 271-693 `spawn_for` + supervisor, 633-683 respawn re-navigate + `still_shown`, 776-855 `switch_project`, 865-930 `has_running_chat`, 940-1011 `reap_instances` / `shutdown_instance`, 1088-1104 `kill_server`) — Why: the pool IS the tab model; every "main" / `project_root` site listed in Problem lives here.
- `apps/desktop/src-tauri/src/lib.rs` (47-57 `resolve_project_root`, 112-125 `resolve_dev_server_url`, 217-222 `export_download_url`, 377-400 `open_local_project` + `remember_and_switch`, 438-450 single-instance, 462-488 command registry, 490-546 menu handler, 570-640 setup: state + token bridge + boot navigate, 665-692 close/exit) — Why: window creation and every "which project" command.
- `apps/desktop/src-tauri/src/keychain.rs` (25-60 fixed keychain pair, 59-167 bridge: `OnceLock`, `handle_request`, `bridge_env`, 173-193 commands) — Why: becomes per-profile slots + per-spawn keys.
- `apps/desktop/src-tauri/src/oauth.rs` (34-39 client id/scope, 202-251 completion → `set_token` + app-wide `github://signed-in`) — Why: the flow gains a target profile and emits to one window.
- `apps/desktop/src-tauri/src/app_state.rs` (12-46 file shape + `MAX_RECENT`, 117-176 load/save + commands) — Why: home of `project_profiles`.
- `apps/desktop/src-tauri/src/notify.rs` (24-48 poller, "skip current project") — Why: "displayed" becomes "has a focused window".
- `apps/desktop/src-tauri/src/deep_link.rs` (22-42 single parking slot) — Why: v1 delivers to the focused window; document.
- `apps/desktop/src-tauri/src/menu.rs` (8-17, 41-50) — Why: add "Open Project in New Tab…".
- `apps/desktop/src-tauri/src/server_json.rs` (29-122) — Why: `wait_for_server_since` + `is_loopback_url` are reused per window, unchanged.
- `apps/desktop/src/index.html` (56-149 splash self-heal via `resolve_dev_server_url`) — Why: every new window boots through it; the command must answer for the CALLING window.
- `apps/desktop/src-tauri/tauri.conf.json` (`app.windows`, `app.security.csp`) — Why: CSP already allows `http://localhost:*`; confirm nothing per-window is needed.
- `apps/studio/cloud/endpoints.ts` (84-120 `cloudConfigPath` / read / write, 191-245 device flow + sign-out, 273-367 `attach` / `attachCode`, 497-546 `readLinkedHub` / `credentialedHub`) and `apps/studio/cloud/renew.ts` (53-71) — Why: already env-driven; verify every reader goes through `cloudConfigPath()`.
- `apps/studio/sync/hubs-config.ts` (12-69) + `apps/studio/sync/hub-link.ts` (128-204) + `cli/lib/hubs-config.mjs` (65-159) — Why: `HUBS_CONFIG_PATH` parity between server and CLI (`maude design link` must land in the same profile file the server reads).
- `apps/studio/github/token.ts` (22-51) + `apps/studio/github/identity-cache.ts` (11-13, 47-74) — Why: per-request fetch, never cached; the cache is token-hash keyed so a second account is a clean miss — but it is a single slot; T7 decides.
- `apps/studio/http.ts` (`/_config` projection — grep `readOnly` / `cloud:`; `/_api/github/*` 2951-3078; `/_api/git/*` 2441-2567) — Why: expose `profile` to the client; confirm no route caches the token.
- `apps/studio/client/github.js` (10-35 bridge, 87-102 project commands) — Why: every bridge call is parameterless today.
- `apps/studio/client/panels/RepoBranchSwitcher.jsx` (189, 412-429, 501-522, 627) — Why: "Open in new tab" lands here.
- `apps/studio/client/panels/IdentityBar.jsx` (164-218, 247-290) + `apps/studio/client/panels/CloudBar.jsx` (600-639, 915) — Why: profile display + "Sign in as another account…".
- `apps/studio/client/app.jsx` (128-143 + 11393-11504 localStorage keys, 3184-3187 switcher mount, 4270 menubar, 9644 `App()`, 10026-10081 `loadServerConfig`, 11598-11640 `/_ws`, 11970-11989 single-canvas tabs) — Why: confirm the client stays origin-bound and needs only the `profile` field in `cfg`.
- `apps/desktop/e2e/scenarios/git-switch-repos.e2e.ts`, `apps/desktop/e2e/wdio.switchrepos.conf.ts`, `apps/desktop/e2e/helpers/{native,sidecar}.ts` — Why: the shape of the new tabs scenario; `waitForSidecar` reads `browser.getUrl()` of the CURRENT window handle.
- `.ai/plans/archive/feature-acp-write-path-scope.md` (144-226, 329-361) — Why: the pool's own options table, its security findings (A1-A6) and what was verified only "by construction".
- `.ai/archive/decisions/DDR-108-github-auth-oauth-device-flow.md`, `DDR-109-native-shell-security-model.md`, `DDR-132-github-identity-swr-disk-cache.md`, `DDR-204-one-account-one-dashboard-two-authorities.md`, `DDR-125-acp-multichat-parallel-and-security-posture.md`, `DDR-177-*` — Why: the invariants the new DDR amends or must preserve.

### Files to Create

- `apps/desktop/src-tauri/src/profiles.rs` — profile registry (`~/.config/maude/profiles.json`), per-profile paths, keychain account naming, `default` mapping to legacy paths.
- `apps/desktop/src-tauri/src/windows.rs` — window label derivation (`proj-<hash16>`), `open_project_window`, label→root registry helpers, focused-window resolution, `tabbing_identifier` / `data_store_identifier` cfg gates.
- `apps/desktop/e2e/scenarios/project-tabs.e2e.ts` + `apps/desktop/e2e/wdio.tabs.conf.ts` — two projects, two window handles, each on its own origin; profile label visible per tab.
- `apps/desktop/e2e/scenarios/project-tabs-identity.e2e.ts` (same conf) — profile binding survives restart; sign-out in tab B leaves tab A signed in (stubbed via `MAUDE_E2E_*` env, see T13).
- `.ai/archive/decisions/DDR-2xx-native-project-tabs-and-per-project-identity-profiles.md` — authored at `/flow:done` via `/flow:record-ddr` (amends DDR-108 §Sign-out / one-slot, DDR-132 single-slot cache, DDR-204 "one account per install" as an install-level statement; supersedes the `sidecar.rs:136-145` "not a workspace" rationale).

### Design canvases

| Canvas | Status | Tags | Notes |
| ------ | ------ | ---- | ----- |
| `.design/ui/RepoBranchSwitcher.tsx` | `handed-off` | — | The bottom dock + upward popup: "Project (recent + open another) + Version". "Open in new tab" is a secondary action on a recent row + a second entry under "Open another folder…" — extend this composition, do not add a top tab strip (the OS draws it). |
| `.design/ui/Studio.tsx` | — | — | App-shell redesign: left tree · top menubar · bottom context bar · right inspector. The profile chip belongs in the existing IdentityBar slot, not new chrome. |
| `.design/ui/CreateProject.tsx` | `handed-off` | — | Create / open / share flows — the "Sign in as another account…" copy should match this canvas's register (plain words, no git jargon). |
| `.design/ui/Cloud Self Service.tsx` | `draft` | cloud, self-service, onboarding | Boards C2/C4/D1/D3/E0 are the cloud sign-in screens; the per-profile cloud sign-in reuses the device-flow modal shown there. |

No canvas matched the feature slug directly; the four above are the closest priors and the shell placement answer ("kde to bude") is: OS tab bar + existing dock + existing identity rail.

### Documentation

- [Tauri 2 `WebviewWindowBuilder::tabbing_identifier`](https://docs.rs/tauri/2/tauri/webview/struct.WebviewWindowBuilder.html#method.tabbing_identifier) — Why: macOS-only; "if not set, automatic tabbing is disabled". Windows with the same id group into one tab bar.
- [Tauri 2 `WebviewWindowBuilder::data_store_identifier`](https://docs.rs/tauri/2/tauri/webview/struct.WebviewWindowBuilder.html#method.data_store_identifier) — Why: macOS 14+ / iOS 17+ only; `[u8; 16]`; unsupported on Windows/Linux (use `data_directory` there, optional in v1).
- Tauri 2 multiwebview (`Window::add_child`) — Why: **rejected**; requires the `unstable` Cargo feature ("unfinished, API under review").
- [Tauri 2 window events / `on_window_event` Focused](https://docs.rs/tauri/2/tauri/enum.WindowEvent.html) — Why: focused-window tracking for "the displayed project".

### Patterns to Follow

- **Loopback guard on every navigate** — `sidecar.rs:838-847`:
  ```rust
  match url.parse::<tauri::Url>() {
      Ok(parsed) if server_json::is_loopback_url(&parsed) => { window.navigate(parsed) … }
      Ok(parsed) => log_line(&format!("[maude] refusing non-loopback navigate (DDR-109): {parsed}")),
      Err(e) => …
  }
  ```
  Reuse verbatim per window.
- **Panic-free logging in async tasks** — `sidecar::log_line`, never `eprintln!` in a spawned task (issue #115; a Finder-launched `.app` has an unwritable stderr).
- **Constant-time key compare in the bridge** — `keychain.rs:80` `ct_eq`; keep for the per-spawn keys.
- **Atomic tmp+rename, 0600 file / 0700 dir** for every credential-adjacent file — `sync/hub-link.ts:128-175`, `cloud/endpoints.ts:105-117`; mirror in Rust for `profiles.json` (`std::fs::write` to `.tmp` then `rename`).
- **`data-testid` convention** `<area>-<thing>[-<id>]` — `repo-switcher-trigger`, `branch-row-<slug>`; new: `project-tab-open-new`, `recent-row-<slug>-new-tab`, `identity-profile-chip`, `identity-signin-other`, `cloud-profile-chip`.
- **e2e retries around a navigate** — `git-switch-repos.e2e.ts:48` `this.retries(2)`; a window open under WebDriver is a new handle, so use `browser.getWindowHandles()` + `switchToWindow`, not a re-navigate wait.
- **Comment style** in `sidecar.rs`: explain WHY at length, name the finding / DDR that motivated each guard.

---

## Design Decisions

### Components (from registry)

| Component | Source | Notes |
| --------- | ------ | ----- |
| Repo/branch dock + popup | `apps/studio/client/panels/RepoBranchSwitcher.jsx` | Add a per-row secondary "Open in new tab" affordance and a second "Open another folder in new tab…" entry. Keep the dock single-line. |
| Identity rail | `apps/studio/client/panels/IdentityBar.jsx` | Account menu gains a profile chip (label + login) and "Sign in as another account…". |
| Cloud bar | `apps/studio/client/panels/CloudBar.jsx` | Shows the cloud profile email; `signOut` becomes profile-scoped; "Use another Maude account…" reuses the device-flow modal. |
| Device-flow modal | `OnboardingWizard.jsx` (`ob-device-modal`/`ob-device-code`) | Reuse for the per-profile GitHub sign-in; do not build a second modal. |
| Confirm dialog | native `tauri-plugin-dialog` (as in `lib.rs:490-546` "Set it up?") | For "this project's server must restart to switch account". |

### Existing screens / blocks reused

| Screen / block | Source | Notes |
| -------------- | ------ | ----- |
| Native tab bar | macOS (via `tabbing_identifier`) | Using as-is. No custom strip. |
| Splash / self-heal page | `apps/desktop/src/index.html` | Every new window boots through it unchanged; only the Rust answer becomes per-window. |

### Icons

| Icon | Library | Size | Usage |
| ---- | ------- | ---- | ----- |
| `ExternalLink` / `PlusSquare` | existing client icon set (check `client/panels/ToolGroup.jsx` for the family in use) | 14 | "Open in new tab" row action |
| `UserRound` / `Users` | same family | 14 | profile chip |

### Tokens

Client tokens only (`var(--fg-*)`, `var(--bg-*)`, `var(--accent)`); no new colors. The profile chip uses the same muted foreground as the branch label in the dock.

### Custom Components Needed

| Component | Reason | Extends |
| --------- | ------ | ------- |
| `ProfileChip` (inline in IdentityBar) | none in registry | plain `<span>` + existing menu |

---

## Tasks

Execute in order. Each task is atomic and testable. Keywords: CREATE, UPDATE, ADD, REMOVE, REFACTOR, MIRROR.

### T1: CREATE `profiles.rs` — profile registry + per-profile paths

- **Do**: `Profile { id, label, github_login: Option<String>, cloud_email: Option<String>, created_at }`; registry file `~/.config/maude/profiles.json` (`{ "profiles": [...], "default": "default" }`), read/write atomic (tmp+rename, 0600/0700). `paths(profile_id) -> ProfilePaths { cloud_config, hubs_config }`: `default` → `~/.config/maude/cloud.json` + `hubs.json` (legacy, unchanged); other → `~/.config/maude/profiles/<id>/cloud.json` + `hubs.json`. `keychain_account(profile_id)`: `default` → `maude-github-token` (unchanged), other → `maude-github-token:<id>`. `id` is `[a-z0-9-]{1,32}`, validated on every entry point. Commands: `profiles_list`, `profiles_create(label)`, `profiles_delete(id)` (refuses `default` and any id still bound to a project).
- **Pattern**: `app_state.rs` load/save; `sync/hub-link.ts` atomic write.
- **Gotcha**: honour `XDG_CONFIG_HOME` exactly like `hubs-config.ts:63-68` does, or the server and shell disagree on where `hubs.json` is. Unit-test the path mapping for `default` vs non-default.
- **Validate**: `cd apps/desktop/src-tauri && cargo test profiles`

### T2: UPDATE `app_state.rs` — project→profile binding

- **Do**: add `project_profiles: HashMap<String /* abs root */, String /* profile id */>` (`#[serde(default)]`); `profile_for(root) -> String` (missing ⇒ `default`); `bind_profile(root, id)`; commands `app_get_project_profile(path)`, `app_set_project_profile(path, profile)`. Prune bindings whose root no longer exists on load (mirror the existence filter on `recent_projects`).
- **Pattern**: `app_state.rs:117-176`.
- **Gotcha**: the binding is machine-local by design — never write it into `.design/config.json` (a committed `linkedHub` alone is not proof; `cloud/endpoints.ts:497-546`).
- **Validate**: `cargo test app_state`

### T3: REFACTOR `keychain.rs` — per-profile slots + per-spawn bridge keys

- **Do**: `entry(profile_id)` uses `profiles::keychain_account`. Bridge state becomes `Bridge { port, keys: Mutex<HashMap<String /* key */, String /* profile */>> }`; `mint_key(profile_id) -> String` (random 64-hex, inserted), `revoke_key(key)`; `handle_request` looks the header up (constant-time compare against EVERY stored key — iterate, never `HashMap::get` on the raw header, so a wrong key costs the same as a right one) and serves only that profile's token. `bridge_env(profile_id)` mints and returns `(endpoint, key)`. Commands `github_is_signed_in(profile)`, `github_sign_out(profile)`.
- **Pattern**: existing `ct_eq` (`keychain.rs:80`), `OnceLock` bridge.
- **Gotcha**: revoke the key when its instance is shut down (`shutdown_instance`) or respawned — a stale key must not outlive its process. `set_token` for profile A must never touch profile B's slot; add a test that two profiles round-trip independently (use the `keyring` mock backend under `cfg(test)` if available, else guard the test behind an env flag).
- **Validate**: `cargo test keychain`

### T4: UPDATE `oauth.rs` — sign in INTO a profile, notify ONE window

- **Do**: `github_sign_in(window: tauri::Window, profile: String)`; on completion `keychain::set_token(&profile, …)`; emit `github://device-code` and `github://signed-in` with `window.emit(...)` (or `app.emit_to(label, …)`), not app-wide. Record `github_login` on the profile after the first identity fetch (optional; the client can also PATCH it via `profiles_update`).
- **Pattern**: `oauth.rs:202-251`.
- **Gotcha**: the client bridge (`github.js:52`) listens for the global event today — T10 changes it to a window-scoped listener at the same time. Two windows signing in concurrently into different profiles must not share the device-code poll state (make it per-call, not a static).
- **Validate**: `cargo test oauth` (10 existing tests stay green) + manual sign-in in two tabs → two keychain rows in Keychain Access.

### T5: CREATE `windows.rs` + UPDATE `SidecarState` — label↔root registry, focused window

- **Do**: `label_for(root) -> String` (`proj-` + first 16 hex of sha256(root); the boot window keeps `"main"`); `SidecarState.windows: Mutex<HashMap<String /* label */, String /* root */>>` and `focused: Mutex<Option<String /* label */>>` replace `project_root`. `root_of(window) -> Option<String>`; `displayed_root()` = root of focused (fallback: any window). Register `on_window_event` `Focused(true)` → set `focused`; `Destroyed` → unregister label, then `reap_instances` (an instance with no window is idle-evictable; one with a window never is). `open_project_window(app, root, url_or_none)`: `WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html"))` with `title`, `inner_size` from the focused window, `#[cfg(target_os = "macos")] .tabbing_identifier("maude-project")`, `#[cfg(target_os = "macos")]` `data_store_identifier(hash16 bytes)` **only when the OS is ≥ 14** (probe `NSProcessInfo.operatingSystemVersion` via `objc2` already in the Tauri dep tree, or skip the identifier on < 14 and log it).
- **Pattern**: `lib.rs:613-639` boot navigate; `sidecar.rs:838-847` guard.
- **Gotcha**: `get_webview_window("main")` sites in `lib.rs` (446 single-instance focus, 619 boot), `sidecar.rs` (659 respawn, 838 switch) ALL move to "the window for this root" — grep `"main"` after the change and justify every remaining hit. The e2e helper `waitForSidecar` inspects the current handle only, so `"main"` must remain the boot window's label.
- **Validate**: `cargo check && cargo clippy -- -D warnings`; `pnpm test:e2e:desktop:switchrepos` still green (in-tab switching unchanged).

### T6: UPDATE `sidecar.rs` — per-instance window + profile env + reap policy + log tagging

- **Do**: `SidecarInstance` gains `window_label: Option<String>`, `profile_id: String`, `bridge_key: String`. `spawn_for(app, root)` reads `app_state::profile_for(root)`, then sets env: `MAUDE_PROFILE_ID`, and for non-default profiles `MAUDE_CLOUD_CONFIG` + `HUBS_CONFIG_PATH` from `profiles::paths`; `MAUDE_TOKEN_ENDPOINT` + a fresh `MAUDE_TOKEN_KEY` from `keychain::bridge_env(profile)`. Revoke the key in `shutdown_instance` and before a supervisor respawn (respawn mints a new one). Respawn re-navigate targets `instance.window_label` (guard: window still exists AND its root is still this one). `reap_instances`: never evict an instance with a live window; `MAX_INSTANCES` → `5` and its comment rewritten (tabs ARE the workspace now; the ceiling is process cost per DDR-125). `switch_project(app, root, new_tab: bool)`: `new_tab` ⇒ `open_project_window` and bind label; else today's navigate on the CALLING window. Tag every `server.log` line with the root's basename (`[maude:<name>]`).
- **Pattern**: existing `spawn_for` env block (`sidecar.rs:405-473`), `switch_project` (776-855).
- **Gotcha**: `spawn_for` deletes `_server.json` before spawn; with a window per instance that is still only on the spawn path (plan `feature-acp-write-path-scope` A2/A5). The `has_running_chat` probe uses the instance's own origin — unchanged. If the profile binding changes for a RUNNING project, the env is stale: T11 restarts it explicitly; do not hot-swap env.
- **Validate**: `cargo test sidecar` (9 existing + new: reap skips windowed instances; key revoked on shutdown); `pnpm test:e2e:desktop:sidecar-respawn`.

### T7: UPDATE `notify.rs`, `deep_link.rs`, `lib.rs` commands — "displayed" = focused window

- **Do**: `notify.rs` polls every instance whose window is NOT focused (was: root ≠ `project_root`); a click on the notification focuses that instance's window. `deep_link.rs`: park as today; deliver to the focused window; log the deferral. `resolve_dev_server_url(window)`, `export_download_url(window, …)`, `save_export(window, …)`, `pick_*` take the calling `tauri::Window` and resolve root via `windows::root_of`. `lib.rs` single-instance handler focuses the focused-or-first window. `open_local_project(path, new_tab: Option<bool>, profile: Option<String>)`: validates, binds profile if given, `remember_and_switch`.
- **Pattern**: `notify.rs:24-48`; `lib.rs:112-125`.
- **Gotcha**: `export_download_url` builds a URL from `_server.json` of the displayed project — with two windows it MUST take the calling window, or an export from tab B downloads from tab A's origin.
- **Validate**: `cargo test notify` (10 existing); manual: ACP activity in an unfocused tab fires a notification; clicking it focuses the right tab.

### T8: UPDATE `menu.rs` + `lib.rs` menu handler — "Open Project in New Tab…"

- **Do**: File ▸ "Open Project in New Tab…" (`Cmd+Shift+O`, id `open_project_tab`), same pick → `.design` check → "Set it up?" path, ending in `switch_project(…, new_tab: true)`. Add a `Window` submenu with the predefined macOS items so the OS tab commands ("Show Next Tab", "Merge All Windows") appear.
- **Pattern**: `menu.rs:8-50`, `lib.rs:490-546`.
- **Gotcha**: macOS only shows native tab menu items when a `Window` menu exists; verify in `tauri dev` rather than assuming.
- **Validate**: `cargo check`; manual.

### T9: UPDATE studio server — expose the profile, verify env-driven readers, CLI parity

- **Do**: `/_config` projection gains `profile: { id, label? }` from `MAUDE_PROFILE_ID` (label via a tiny `MAUDE_PROFILE_LABEL` env set by the shell). Audit every reader of `cloud.json` / `hubs.json` on the server (`cloud/endpoints.ts`, `cloud/renew.ts`, `sync/index.ts:676-678`, `sync/supervisor.ts:100-113`, `sync/workspace-signin.ts`, `cloud/attach*`) — ALL must resolve through `cloudConfigPath()` / `hubsConfigPath()`; add a `bun test` that sets both env vars to a temp dir and asserts sign-in/attach/renew write there. `cli/lib/hubs-config.mjs` must honour `HUBS_CONFIG_PATH` identically (it says it matches `hubs-config.ts` — assert with a node test). `maude design link` run from a tab's ACP session inherits the sidecar env, so it lands in the right profile automatically — document that in the command's markdown.
- **Pattern**: `cloud/endpoints.ts:90-92`; `sync/hubs-config.ts:63-68`.
- **Gotcha**: `github/identity-cache.ts` is a single slot keyed by token hash — two profiles alternate and each revalidates on every switch. Make the file per key (`github-identity-<key>.json`) or a small map; keep "token never written" (DDR-132).
- **Validate**: `cd apps/studio && bun test test/cloud-*.test.ts test/sync-*.test.ts` (+ new profile-env test); `node --test cli/lib/hubs-config.test.mjs`. Check `git status apps/studio/dist/` before AND after `bun test` (memory: test runs have clobbered `dist/`).

### T10: UPDATE client bridge + RepoBranchSwitcher — "Open in new tab"

- **Do**: `github.js`: `openLocalProject(path, { newTab, profile })`, `isSignedIn(profile)`, `signIn(profile)`, `signOut(profile)`, `listProfiles()`, `createProfile(label)`, `getProjectProfile()`, `setProjectProfile(id)`; the `github://signed-in` listener becomes `getCurrentWindow().listen(...)` (window-scoped). `RepoBranchSwitcher.jsx`: each recent row gets a trailing "Open in new tab" button (`recent-row-<slug>-new-tab`) and Cmd/Ctrl-click on the row does the same; "Open another folder in new tab…" (`project-tab-open-new`) next to "Open another folder…". `cfg.profile` (from `/_config`) is passed down for the chip.
- **Pattern**: `RepoBranchSwitcher.jsx:412-429, 501-522`; `github.js:87-102`.
- **Gotcha**: the client stays origin-bound — no project id anywhere in fetches or the `/_ws` URL. Rebuild the committed bundle release-minified afterwards (`cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`) and commit `dist/client.bundle.js` + `dist/styles.css`.
- **Validate**: `pnpm lint`; `pnpm test:e2e:desktop:switchrepos`.

### T11: UPDATE IdentityBar + CloudBar — profile chip + "Sign in as another account…"

- **Do**: IdentityBar account menu shows `identity-profile-chip` (profile label · GitHub login) and `identity-signin-other`: create profile (label prompt) → `signIn(profileId)` (reused device modal) → on success `setProjectProfile(profileId)` → native confirm "Restart this project's server to use <label>?" → `invoke('restart_project_server')` (new command: `shutdown_instance` + `spawn_for` for the calling window's root, then re-navigate that window). CloudBar: shows the profile's cloud email; `signOut` and device sign-in are profile-scoped by construction (server env); "Use another Maude account…" = same create-profile + restart path. Copy in plain words per the RepoBranchSwitcher canvas register.
- **Pattern**: `IdentityBar.jsx:164-218, 247-290`; `CloudBar.jsx:600-639`; `switcher-chat-guard` for the "a chat is running" confirm.
- **Gotcha**: restarting a server kills its running ACP chats — reuse the `switcher-chat-guard` copy and require confirm when `/_api/acp/running` is non-empty.
- **Validate**: manual in `tauri dev`; testids present for T13.

### T12: UPDATE `tauri.conf.json` + first-run — boot window label + tabbing on the boot window

- **Do**: give the declared window `"label": "main"` explicitly and `"tabbingIdentifier": "maude-project"` (macOS) so the FIRST window joins the tab group (otherwise the boot window and later windows are two groups). Onboarding wizard's `open_local_project` stays in-tab.
- **Gotcha**: `tauri.e2e.conf.json` overlays the base config — verify the key survives the overlay and the e2e bundle id stays `com.maude.app.e2e`.
- **Validate**: `pnpm test:e2e:desktop:build`; open two projects → one tab bar.

### T13: CREATE desktop e2e — `project-tabs` + `project-tabs-identity`

- **Do**: `wdio.tabs.conf.ts` reuses `makeLifecycleFixture()` (primary + secondary). Scenario 1: boot on primary; `invokeTauri('open_local_project', { path: secondary, newTab: true })`; `browser.getWindowHandles()` → 2; `switchToWindow(handles[1])`; `waitForSidecar()` URL has a DIFFERENT port than handle[0]; `repo-switcher-trigger` shows `feat/nav-redesign`; switch back to handle[0] → still `main`; close handle[1] (`browser.closeWindow()`) → `_server.json` of secondary is gone within 10 s after the reap probe (or the instance is marked idle — assert via a new `sidecar_instances` debug command gated `cfg(debug_assertions)`). Scenario 2: `app_set_project_profile(secondary, 'e2e-b')` (profile created via `profiles_create`); reopen → `/_config.profile.id === 'e2e-b'` in that tab and `default` in the other; `github_is_signed_in('e2e-b')` is false while `'default'` is stubbed true via the existing `MAUDE_E2E_*` seam (extend `MAUDE_E2E_FORCE_CLAUDE_STATUS`'s pattern with `MAUDE_E2E_GITHUB_SIGNED_IN_PROFILES=default`).
- **Pattern**: `git-switch-repos.e2e.ts` (retries around navigates), `helpers/sidecar.ts`.
- **Gotcha**: SHIPPER's top risk — multi-window under `@wdio/tauri-service` is untested here. Spike this scenario FIRST (before T10/T11 polish) to learn whether `getWindowHandles` sees Tauri-created windows; if not, fall back to per-window `data-testid` assertions through `invokeTauri` + a debug `window_labels` command, and record the ceiling in the plan.
- **Validate**: `pnpm test:e2e:desktop:build && pnpm --filter @maude/desktop-e2e e2e:tabs`

### T14: SECURITY fan-out + bundle gates + docs

- **Do**: spawn `flow:security-auditor` + `flow:ethical-hacker` briefed on: per-spawn key revocation, a sidecar presenting another instance's key, profile id injection into paths (`profiles/<id>` — validated charset), `HUBS_CONFIG_PATH` pointing outside `~/.config/maude`, a window navigating to a non-loopback URL, cross-window `github://signed-in` leakage, deep link delivered to the wrong tab, process exhaustion via "open in new tab" spam (cap = `MAX_INSTANCES`, refuse with a dialog). Fix blockers. Run `apps/desktop/scripts/check-bundle-completeness.mjs <built .app> --smoke` and `check-client-boots.mjs <built .app>`. Update `CLAUDE.md` (runtime contract: sidecar pool = tabs; profile env list; the `MAX_INSTANCES` rationale) and `site/content/docs/` desktop page. Add a `whats-new-entry` (pending) and the DDR at `/flow:done`.
- **Validate**: 0 blockers in both reports; both gates green; `pnpm --filter @maude/site gen:roadmap` diff committed.

---

## Validation

Run these commands to confirm zero regressions:

1. **Lint**: `pnpm lint`
2. **Types**: `cd apps/studio && bunx tsc --noEmit && cd ../.. && bash scripts/check-tsc-coverage.sh`
3. **Rust**: `cd apps/desktop/src-tauri && cargo test && cargo clippy -- -D warnings`
4. **Tests**: `pnpm test && cd apps/studio && bun test test/sync-*.test.ts test/cloud-*.test.ts --timeout 20000` (run alone — memory: parallel suites fabricate failures; check `git status apps/studio/dist/` before and after)
5. **Build**: `pnpm --filter @maude/site build`; `pnpm test:e2e:desktop:build`
6. **Desktop e2e**: `pnpm test:e2e:desktop:switchrepos`, `pnpm test:e2e:desktop:sidecar-respawn`, `pnpm test:e2e:desktop:parity`, new `e2e:tabs`
7. **Packaged-app gates**: `node apps/desktop/scripts/check-bundle-completeness.mjs <.app> --smoke`, `node apps/desktop/scripts/check-client-boots.mjs <.app>`
8. **Security**: `security-auditor` + `ethical-hacker` (T14) — mandatory, 0 blockers
9. **A11y**: `flow:a11y-auditor` over the switcher popup + identity menu (new buttons need names + focus order)
10. **Manual**: two tabs, two GitHub accounts → push from each lands under the right author; two cloud accounts on the same cell URL → `hubs.json` per profile, renewal in tab B never uses tab A's token (watch `server.log` tags); quit drains all servers; restart restores the last project in-tab (tab restoration is NOT in v1).

---

## Scenario Coverage

Native-only shell feature — the 5-platform `scenario-runner` ladder does not apply (same ceiling DDR-132/DDR-134 record). Verification backbone is the desktop e2e harness:

| Scenario | Covers | Status |
|----------|--------|--------|
| `git-switch-repos` | in-tab switching still works, no duplicate spawn | ✅ existing |
| `sidecar-respawn-canvas-switch` | respawn re-navigates the RIGHT window | ✅ existing (assert unchanged) |
| `shell-parity` | shared chrome unchanged in a tab | ✅ existing |
| `project-tabs` | open in new tab → two handles, two origins, close → reap | 🆕 T13 |
| `project-tabs-identity` | per-project profile binding + isolated sign-in state | 🆕 T13 |

Intentional divergence from the 5-platform requirement is recorded in the DDR (T14).

---

## Acceptance Criteria

- [ ] All tasks T1–T14 completed
- [ ] `/flow:utils-verify` passes after each task (Edit-Verify Loop, max 3 iterations)
- [ ] `/flow:validate` passes overall:
  - [ ] Static (types, lint, format, clippy)
  - [ ] Tests (node + studio sync/cloud lanes + cargo)
  - [ ] Build (site + e2e debug bundle)
  - [ ] Desktop e2e: switchrepos, sidecar-respawn, parity, tabs, tabs-identity green
  - [ ] Packaged-app gates green (bundle completeness + client boots)
  - [ ] `security-auditor` + `ethical-hacker`: 0 blockers
  - [ ] `a11y-auditor`: 0 blockers on the touched menus
- [ ] Two tabs on two GitHub accounts and two cloud accounts verified by hand (Validation §10) and the evidence linked in the PR
- [ ] DDR recorded (amends DDR-108 / DDR-132 / DDR-204; supersedes the `sidecar.rs` "not a workspace" rationale); `kg` plan node closed
- [ ] `whats-new.json` pending entry added; `CLAUDE.md` runtime-contract paragraph updated; roadmap regenerated
- [ ] Code follows project conventions, no regressions
