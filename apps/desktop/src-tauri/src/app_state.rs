// app_state.rs — the project registry / last-project persistence (Phase 29, epic E4; schema v2
// since V2-3.1). S6.15 retired the v1 first-run wizard with its `app_is_first_run` command and the
// welcome-project sidecar: first launch boots Home (lib.rs `boot_plan`), which owns sign-in and
// "Create a local project".
//
// State lives in `<app_config_dir>/app-state.json` — schema v2 (contract
// V2-1.1-home-window §5.5), atomic tmp + rename, 0600:
//   { "v": 2,
//     "projects": { "<pid>": { root, name, profile, port, addedAt, lastOpenedAt, managed } },
//     "recent":   ["<pid>", …],            (MRU-first, ≤ 50)
//     "session":  { tabs: [{label, pid?}], focused, savedAt },
//     "homePort": <u16>?,
//     "last_project": "<abs>", "recent_projects": ["<abs>", …] }   ← v1 keys
// The v1 keys (`last_project`, `recent_projects` ≤ 10) keep being WRITTEN for one
// release so a downgrade to 1.x still reopens the last project. Read order: v2 keys
// when `v >= 2`, else migrate v1 (each `recent_projects` path → a registry entry on
// profile `default`; `last_project` → a one-tab session). A phase-26..28 install that
// only has the legacy `last-project.txt` marker is migrated the same way.
//
// `projects[pid].profile` is THE project→account binding (V2-3.1) — machine-local
// by design, never written into `.design/config.json` (a committed `linkedHub` is
// not proof of who you are; cloud/endpoints.ts). Missing ⇒ `default`. There is
// deliberately no separate `project_profiles` map: one registry, one binding.
//
// V2-3.8 "each project keeps its own sign-in": `projects[pid].bound` marks a
// binding someone CHOSE (a sign-in, `bind_profile`, a managed copy); an entry
// on `default` that was never bound is unbound. `lastSignInProfile` is the
// profile the most recent sign-in (GitHub or Maude Cloud) landed on. An
// unbound project adopts it the next time it is opened (registry creation or
// any later open — `AppState::open`) and is bound from then on, so a project
// that never signed in follows the account you last used, once; a bound
// project is never rebound by opening it.
//
// A registry entry whose root vanished is KEPT (§5.5: shown as "isn't where it
// was" until Find the folder… rebinds it); it ages out only after 90 days unopened.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::profiles;
use crate::windows;

/// v1 mirror cap — what 1.x showed and what `app_recent_projects` still returns.
const MAX_RECENT: usize = 10;
/// v2 MRU cap (contract §5.5; was 10).
const MAX_RECENT_V2: usize = 50;
const SCHEMA_V2: u32 = 2;
/// A vanished root's registry entry ages out after this long unopened (§5.5).
const VANISHED_AGE_OUT_MS: u64 = 90 * 24 * 60 * 60 * 1000;

/// Serialises read-modify-write of app-state.json inside this process: the
/// supervisor, the menu and webview commands can all reach `set_last_project` /
/// `bind_profile` concurrently, and a lost update here silently drops a binding.
static STATE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    pub root: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_profile")]
    pub profile: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub added_at: u64,
    #[serde(default)]
    pub last_opened_at: u64,
    /// Managed cloud copy descriptor (managed.rs) — `null` for a plain local project.
    #[serde(default)]
    pub managed: Option<serde_json::Value>,
    /// V2-3.8: the profile was chosen (sign-in / `bind_profile` / managed copy),
    /// not inherited. See `ProjectEntry::is_bound`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub bound: bool,
    /// S1.22b — the name the person gave this project's tab ON THIS MAC (the tab
    /// menu's Rename…). Wins over `.design/config.json`'s name and the folder's
    /// name in the strip, the window title, Home and notifications; never written
    /// into the project (its folder, its config, its git) — machine-local like the
    /// binding. Absent = the project's own name. A 1.x build ignores the key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// S8.23 — the folder "Save to" remembers for this project's exports ON THIS
    /// MAC (export_save.rs): chosen once through the native save panel, never
    /// written into the project. Absent = not chosen yet. A 1.x build ignores it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub export_folder: Option<String>,
}

/// S1.22b — the most a tab's display name may be (characters, after `sanitize_title`).
pub const MAX_DISPLAY_NAME: usize = 80;

/// Pure: what Rename… stores for `raw` — one sanitized line, trimmed, capped;
/// `None` (back to the project's own name) when nothing is left.
pub fn clean_display_name(raw: &str) -> Option<String> {
    let one = crate::notify::sanitize_title(raw);
    let t: String = one.trim().chars().take(MAX_DISPLAY_NAME).collect();
    let t = t.trim().to_string();
    (!t.is_empty()).then_some(t)
}

/// The renamed projects (`pid → displayName`) as of the last load or save, so
/// `windows::project_display_name` can answer from a root without a file read.
static DISPLAY_NAMES: Mutex<BTreeMap<String, String>> = Mutex::new(BTreeMap::new());

fn cache_display_names(st: &AppState) {
    let names = st
        .projects
        .iter()
        .filter_map(|(pid, e)| e.display_name.clone().map(|n| (pid.clone(), n)))
        .collect();
    *DISPLAY_NAMES.lock().unwrap_or_else(|e| e.into_inner()) = names;
}

/// The name the person gave `pid`'s tab on this Mac, if any.
pub fn display_name_of(pid: &str) -> Option<String> {
    DISPLAY_NAMES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(pid)
        .cloned()
}

/// Rename… (`tabs::tab_rename`): store `name` as `pid`'s display name on this
/// Mac (`None`/blank clears it). Err for a pid that is not in the registry.
pub fn set_display_name(app: &tauri::AppHandle, pid: &str, name: Option<&str>) -> Result<(), String> {
    update(app, |st, _| set_display_name_in(st, pid, name))
}

/// Pure half of `set_display_name`.
pub fn set_display_name_in(st: &mut AppState, pid: &str, name: Option<&str>) -> Result<(), String> {
    let e = st
        .projects
        .get_mut(pid)
        .ok_or_else(|| "That project isn't in your list.".to_string())?;
    e.display_name = name.and_then(clean_display_name);
    Ok(())
}

/// S8.23 — the folder `pid`'s exports were last saved into on this Mac.
pub fn export_folder_of(app: &tauri::AppHandle, pid: &str) -> Option<String> {
    load(app).projects.get(pid).and_then(|e| e.export_folder.clone())
}

/// S8.23 — remember `dir` as the folder `pid`'s exports go to on this Mac.
pub fn set_export_folder(app: &tauri::AppHandle, pid: &str, dir: &Path) -> Result<(), String> {
    update(app, |st, _| set_export_folder_in(st, pid, dir))
}

/// Pure half of `set_export_folder`. Err for a pid that is not in the registry.
pub fn set_export_folder_in(st: &mut AppState, pid: &str, dir: &Path) -> Result<(), String> {
    let e = st
        .projects
        .get_mut(pid)
        .ok_or_else(|| "That project isn't in your list.".to_string())?;
    e.export_folder = Some(dir.to_string_lossy().into_owned());
    Ok(())
}

impl ProjectEntry {
    /// Bound = chosen. An entry on any profile other than `default` was bound
    /// by definition (entries written before V2-3.8 carry no `bound` flag).
    pub fn is_bound(&self) -> bool {
        self.bound || self.profile != profiles::DEFAULT_ID
    }
}

/// May an open bind an unbound project to `lastSignInProfile` (V2-3.8)?
/// `Adopt`: an open from Home, or of a folder the person picked. `Keep`: a
/// project tab opening ANOTHER registered project by pid (⌘K across,
/// `open_project({pid})`) — the tab was scoped on that project's current
/// profile, so the open must not move it to another one (S15-A1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Binding {
    Adopt,
    Keep,
}

fn default_profile() -> String {
    profiles::DEFAULT_ID.to_string()
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct SessionTab {
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    #[serde(default)]
    pub tabs: Vec<SessionTab>,
    #[serde(default)]
    pub focused: Option<String>,
    #[serde(default)]
    pub saved_at: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct AppState {
    /// Absent (0) on a v1 file — the migration trigger.
    #[serde(default)]
    pub v: u32,
    #[serde(default)]
    pub projects: BTreeMap<String, ProjectEntry>,
    #[serde(default)]
    pub recent: Vec<String>,
    #[serde(default)]
    pub session: Option<Session>,
    #[serde(default, rename = "homePort")]
    pub home_port: Option<u16>,
    /// V2-3.8: the profile the most recent sign-in landed on — what an unbound
    /// project adopts when it is opened.
    #[serde(
        default,
        rename = "lastSignInProfile",
        skip_serializing_if = "Option::is_none"
    )]
    pub last_sign_in_profile: Option<String>,
    // ── v1 keys: recomputed from v2 on every load/save, read only to migrate ──
    #[serde(default)]
    pub last_project: Option<String>,
    #[serde(default)]
    pub recent_projects: Vec<String>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn basename(root: &str) -> String {
    Path::new(root)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string())
}

fn one_tab_session(pid: &str, now: u64) -> Session {
    let label = windows::label_for_pid(pid);
    Session {
        tabs: vec![SessionTab {
            label: label.clone(),
            pid: Some(pid.to_string()),
        }],
        focused: Some(label),
        saved_at: now,
    }
}

impl AppState {
    /// Insert-or-refresh the registry entry for `root`; returns its pid. A new
    /// entry starts on `default`. An existing entry keeps its profile (rebinding is
    /// `bind_profile`'s job only) and adopts `root` as given — same pid means same
    /// realpath, so this only refreshes the spelling.
    pub fn upsert(&mut self, root: &str, now: u64) -> String {
        let pid = windows::pid_for_root(root);
        let e = self
            .projects
            .entry(pid.clone())
            .or_insert_with(|| ProjectEntry {
                root: root.to_string(),
                name: basename(root),
                profile: default_profile(),
                port: None,
                added_at: now,
                last_opened_at: 0,
                managed: None,
                bound: false,
                display_name: None,
                export_folder: None,
            });
        e.root = root.to_string();
        if e.name.is_empty() {
            e.name = basename(root);
        }
        pid
    }

    fn touch_recent(&mut self, pid: &str) {
        self.recent.retain(|p| p != pid);
        self.recent.insert(0, pid.to_string());
        self.recent.truncate(MAX_RECENT_V2);
    }

    /// Open `root`: registry entry + MRU head + (today, single window) a one-tab
    /// session. V2-3.2 replaces the session write with the real tab set.
    /// V2-3.8: an unbound entry adopts `lastSignInProfile` here and is bound
    /// from then on; a bound one keeps its profile.
    fn open(&mut self, root: &str, now: u64) -> String {
        self.open_with(root, now, Binding::Adopt)
    }

    /// `open`, choosing whether an unbound entry may adopt `lastSignInProfile`
    /// (S15-A1): an open the person made from Home, or of a folder they
    /// picked, does; a project tab opening ANOTHER project keeps that
    /// project's binding as it is — the tab was scoped on it.
    pub(crate) fn open_with(&mut self, root: &str, now: u64, binding: Binding) -> String {
        let pid = self.upsert(root, now);
        let recent = self
            .last_sign_in_profile
            .clone()
            .filter(|p| binding == Binding::Adopt && profiles::validate_id(p).is_ok());
        if let Some(e) = self.projects.get_mut(&pid) {
            e.last_opened_at = now;
            if let (false, Some(p)) = (e.is_bound(), recent) {
                e.profile = p;
                e.bound = true;
            }
        }
        self.touch_recent(&pid);
        pid
    }

    /// How many projects OTHER than `pid` are bound to `profile` (a missing
    /// or invalid binding reads as `default`, as `profile_for` does).
    pub fn others_on_profile(&self, profile: &str, pid: &str) -> usize {
        self.projects
            .iter()
            .filter(|(p, e)| {
                p.as_str() != pid
                    && profiles::validate_id(&e.profile)
                        .map(|_| e.profile.as_str())
                        .unwrap_or(profiles::DEFAULT_ID)
                        == profile
            })
            .count()
    }

    /// Bind `root` to `profile` by choice (`bound`), keeping everything else.
    pub fn bind(&mut self, root: &str, profile: &str, now: u64) -> String {
        let pid = self.upsert(root, now);
        if let Some(e) = self.projects.get_mut(&pid) {
            e.profile = profile.to_string();
            e.bound = true;
        }
        pid
    }

    /// Migrate a v1 (or legacy-marker) state in place. No-op on v2.
    fn migrate_v1(&mut self, now: u64) {
        if self.v >= SCHEMA_V2 {
            return;
        }
        let mut order: Vec<String> = self.recent_projects.clone();
        if let Some(last) = &self.last_project {
            if !order.contains(last) {
                order.insert(0, last.clone());
            }
        }
        // Oldest first, so each `open` pushes to the MRU head and the final order
        // matches v1's. Migrated entries count as opened now — otherwise a
        // vanished one would age out on its very first v2 load.
        for root in order.iter().rev() {
            self.open(root, now);
        }
        if let Some(last) = &self.last_project {
            let pid = windows::pid_for_root(last);
            self.session = Some(one_tab_session(&pid, now));
        }
        self.v = SCHEMA_V2;
    }

    /// Age out vanished roots unopened for 90+ days. Everything else is kept —
    /// including vanished roots inside that window (§5.5 `pn-cant-open`).
    fn prune(&mut self, now: u64) {
        self.projects.retain(|_, e| {
            Path::new(&e.root).exists()
                || now.saturating_sub(e.last_opened_at) <= VANISHED_AGE_OUT_MS
        });
        let projects = &self.projects;
        self.recent.retain(|p| projects.contains_key(p));
    }

    /// The last project's root: the session's focused tab, else the MRU head.
    fn last_root(&self) -> Option<String> {
        let focused_pid = self
            .session
            .as_ref()
            .and_then(|s| s.focused.as_deref())
            .and_then(|label| label.strip_prefix("p-"));
        focused_pid
            .and_then(|pid| self.projects.get(pid))
            .or_else(|| self.recent.first().and_then(|pid| self.projects.get(pid)))
            .map(|e| e.root.clone())
    }

    /// Recompute the v1 mirror from the v2 keys (written for one release).
    fn sync_v1(&mut self) {
        self.recent_projects = self
            .recent
            .iter()
            .filter_map(|pid| self.projects.get(pid).map(|e| e.root.clone()))
            .take(MAX_RECENT)
            .collect();
        self.last_project = self.last_root();
    }

    /// The binding for `root`; missing (or an id failing validation) ⇒ `default`.
    /// p8-port-gc — the port `root`'s server bound last time (`ProjectEntry.port`), asked for first on the next
    /// spawn: a rested tab's wake, a relaunch and a crash respawn come back on the same origin. The server ignores
    /// a port outside its own ladder (port.ts `portCandidates`), so this needs no range check of its own.
    pub fn preferred_port(&self, root: &str) -> Option<u16> {
        self.projects
            .get(&windows::pid_for_root(root))
            .and_then(|e| e.port)
            .filter(|p| *p != 0)
    }

    /// p8-port-gc — remember the port `root`'s server actually bound (read from its per-spawn shell info file,
    /// never `_server.json`). True when the registry changed. A root that is not registered never gains an entry.
    pub fn record_port(&mut self, root: &str, port: u16) -> bool {
        if port == 0 {
            return false;
        }
        match self.projects.get_mut(&windows::pid_for_root(root)) {
            Some(e) if e.port != Some(port) => {
                e.port = Some(port);
                true
            }
            _ => false,
        }
    }

    pub fn profile_for(&self, root: &str) -> String {
        self.projects
            .get(&windows::pid_for_root(root))
            .map(|e| e.profile.clone())
            .filter(|p| profiles::validate_id(p).is_ok())
            .unwrap_or_else(default_profile)
    }

    pub fn is_profile_bound(&self, id: &str) -> bool {
        self.projects.values().any(|e| e.profile == id)
    }

    /// `roots` (the v1 recents) narrowed to projects bound to `profile` — an
    /// unregistered root counts as `default`, as `profile_for` reads it.
    pub fn recents_in_profile(&self, profile: &str, roots: Vec<String>) -> Vec<String> {
        roots
            .into_iter()
            .filter(|r| self.profile_for(r) == profile)
            .collect()
    }

    /// N-H1: register a managed copy Maude itself made, ON the profile it was
    /// prepared for, with the app-owned `(server, projectId)` it was made for —
    /// the registry's own record of which hub this folder belongs to (N-M4
    /// reads it; the folder's committed `config.json` claim is never proof).
    pub fn bind_managed(
        &mut self,
        root: &str,
        profile: &str,
        server: &str,
        project_id: &str,
        now: u64,
    ) -> String {
        let pid = self.upsert(root, now);
        if let Some(e) = self.projects.get_mut(&pid) {
            e.profile = profile.to_string();
            e.bound = true;
            e.managed = Some(serde_json::json!({ "server": server, "projectId": project_id }));
        }
        pid
    }

    /// The hub a registered project is bound to by the APP (a managed copy),
    /// never by its own files.
    pub fn managed_server_of(&self, pid: &str) -> Option<String> {
        self.projects
            .get(pid)?
            .managed
            .as_ref()?
            .get("server")?
            .as_str()
            .map(str::to_string)
    }

    /// Rebind `old_pid`'s entry to `new_root` (the project moved): same name,
    /// profile and history under the pid of its new realpath; the MRU keeps its
    /// place. Refuses a folder that is already another registered project.
    pub fn relink(&mut self, old_pid: &str, new_root: &str) -> Result<String, String> {
        let new_pid = windows::pid_for_root(new_root);
        if new_pid != old_pid && self.projects.contains_key(&new_pid) {
            return Err("That folder is already one of your projects.".to_string());
        }
        let mut entry = self
            .projects
            .remove(old_pid)
            .ok_or_else(|| "That project isn't in your list any more.".to_string())?;
        entry.root = new_root.to_string();
        self.projects.insert(new_pid.clone(), entry);
        for p in self.recent.iter_mut() {
            if p == old_pid {
                *p = new_pid.clone();
            }
        }
        Ok(new_pid)
    }
}

/// Parse + normalise: the JSON (or the legacy marker), migrate v1 → v2, age out
/// long-vanished roots, and refresh the v1 mirror IN MEMORY so v1-shaped readers
/// (project_resolve.rs) keep seeing the same projects.
fn load_from(file: Option<&Path>, marker: Option<&Path>, now: u64) -> AppState {
    let mut st = file
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<AppState>(&b).ok())
        .or_else(|| {
            let raw = std::fs::read_to_string(marker?).ok()?;
            let t = raw.trim();
            (!t.is_empty()).then(|| AppState {
                last_project: Some(t.to_string()),
                recent_projects: vec![t.to_string()],
                ..AppState::default()
            })
        })
        .unwrap_or_default();
    st.migrate_v1(now);
    st.prune(now);
    st.sync_v1();
    st
}

fn save_to(file: &Path, st: &mut AppState) {
    st.v = SCHEMA_V2;
    st.sync_v1();
    match serde_json::to_vec_pretty(st) {
        Ok(json) => {
            if let Err(e) = profiles::atomic_write(file, &json) {
                crate::sidecar::log_line(&format!("[maude] could not save app state: {e}"));
            }
        }
        Err(e) => crate::sidecar::log_line(&format!("[maude] could not encode app state: {e}")),
    }
}

fn state_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("app-state.json"))
}

fn legacy_marker(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("last-project.txt"))
}

/// True when the state file is THERE but cannot be read or parsed. `load` answers a default (empty)
/// registry then, which is right for a UI that starts fresh — and wrong for anything that deletes data
/// "not in the registry" (the index GC, p8-sec2-lows I2).
pub fn state_unreadable_in(file: &Path) -> bool {
    match std::fs::read(file) {
        Ok(b) => serde_json::from_slice::<AppState>(&b).is_err(),
        Err(e) => e.kind() != std::io::ErrorKind::NotFound,
    }
}

/// [`state_unreadable_in`] for the app's own state file.
pub fn state_unreadable(app: &tauri::AppHandle) -> bool {
    state_path(app).is_some_and(|p| state_unreadable_in(&p))
}

/// Read persisted state (v2; v1 and the legacy marker migrate transparently).
pub fn load(app: &tauri::AppHandle) -> AppState {
    let st = load_from(
        state_path(app).as_deref(),
        legacy_marker(app).as_deref(),
        now_ms(),
    );
    cache_display_names(&st);
    st
}

/// Load → mutate → save, under the in-process lock.
fn update<T>(app: &tauri::AppHandle, f: impl FnOnce(&mut AppState, u64) -> T) -> T {
    let _guard = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let now = now_ms();
    let mut st = load_from(
        state_path(app).as_deref(),
        legacy_marker(app).as_deref(),
        now,
    );
    let out = f(&mut st, now);
    if let Some(p) = state_path(app) {
        save_to(&p, &mut st);
    }
    cache_display_names(&st);
    out
}

/// Register (or touch) a project in the registry when a window opens it
/// (`open_project`, Home, File › Open Project…): `lastOpenedAt` + the MRU head
/// that Home's `ShellState.recent` reads (V2-3.3). The session is left alone —
/// the tab set is part b's. Returns its pid.
pub fn upsert_project(app: &tauri::AppHandle, root: &Path, binding: Binding) -> String {
    let root = root.to_string_lossy().to_string();
    update(app, |st, now| {
        forget_missing_recent(st);
        st.open_with(&root, now, binding)
    })
}

/// A `lastSignInProfile` that was since deleted is not adopted by anyone.
fn forget_missing_recent(st: &mut AppState) {
    if st
        .last_sign_in_profile
        .as_deref()
        .is_some_and(|p| !profiles::exists(p))
    {
        st.last_sign_in_profile = None;
    }
}

/// What a V2-3.8 sign-in did to the calling project's binding.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SignedIn {
    /// The profile the credential was stored in (now the project's binding).
    pub profile: String,
    /// The project moved to a NEW profile — its server must restart onto it.
    pub rebound: bool,
}

/// V2-3.8 bind-on-sign-in, socket- and keychain-free so it is testable: pick
/// the profile `account`'s credential goes to for the project at `root`
/// (`profiles::sign_in_target`), make a fresh profile when the caller's own
/// would be re-signed under the projects sharing it, `store` the credential
/// THERE, and only then bind the project (`bound`) and record the account +
/// `lastSignInProfile`. A failed store leaves every binding as it was.
#[allow(clippy::too_many_arguments)]
pub(crate) fn settle_sign_in(
    st: &mut AppState,
    registry: &Path,
    root: &str,
    kind: profiles::SignInKind,
    account: &str,
    prior_credential: impl FnOnce(&str) -> bool,
    store: impl FnOnce(&str) -> Result<(), String>,
    now: u64,
) -> Result<SignedIn, String> {
    let current = st.profile_for(root);
    let pid = windows::pid_for_root(root);
    let target = profiles::sign_in_target(
        prior_credential(&current),
        profiles::recorded_account_in(registry, &current, kind).as_deref(),
        st.others_on_profile(&current, &pid),
        account,
    );
    let profile = match target {
        profiles::SignInTarget::Keep => current.clone(),
        profiles::SignInTarget::NewProfile => profiles::create_capped_in(registry, account)?.id,
    };
    store(&profile)?;
    st.bind(root, &profile, now);
    st.last_sign_in_profile = Some(profile.clone());
    profiles::set_account_in(registry, &profile, kind, account);
    Ok(SignedIn {
        rebound: profile != current,
        profile,
    })
}

/// `settle_sign_in` through the app-state lock, against the real registry.
pub fn settle_sign_in_app(
    app: &tauri::AppHandle,
    root: &str,
    kind: profiles::SignInKind,
    account: &str,
    prior_credential: impl FnOnce(&str) -> bool,
    store: impl FnOnce(&str) -> Result<(), String>,
) -> Result<SignedIn, String> {
    let registry = profiles::registry_file();
    update(app, |st, now| {
        settle_sign_in(st, &registry, root, kind, account, prior_credential, store, now)
    })
}

/// S6.7: a Home sign-in (no calling project) records `lastSignInProfile` only —
/// a never-bound project adopts it on its first open; nothing is bound here.
pub fn set_last_sign_in_profile(app: &tauri::AppHandle, id: &str) {
    if profiles::validate_id(id).is_err() {
        return;
    }
    update(app, |st, _| st.last_sign_in_profile = Some(id.to_string()));
}

/// Remember the port the Home server bound (contract §5.5 `homePort`), so the
/// next launch asks for the same origin first.
pub fn set_home_port(app: &tauri::AppHandle, port: u16) {
    if load(app).home_port == Some(port) {
        return;
    }
    update(app, |st, _| st.home_port = Some(port));
}

/// "Find the folder…" (`relink_project`): point registry entry `old_pid` at
/// `new_root`. Returns the new pid.
pub fn relink_project(
    app: &tauri::AppHandle,
    old_pid: &str,
    new_root: &Path,
) -> Result<String, String> {
    let root = new_root.to_string_lossy().to_string();
    update(app, |st, _| st.relink(old_pid, &root))
}

/// p8-port-gc — the port `root`'s next server asks for first (`AppState::preferred_port`).
pub fn preferred_port(app: &tauri::AppHandle, root: &str) -> Option<u16> {
    load(app).preferred_port(root)
}

/// p8-port-gc — record the port `root`'s server bound. Reads first, so an unchanged port is not a write.
pub fn record_port(app: &tauri::AppHandle, root: &str, port: u16) {
    if load(app).preferred_port(root) == Some(port) {
        return;
    }
    update(app, |st, _| st.record_port(root, port));
}

/// The account profile bound to `root` (missing ⇒ `default`).
pub fn profile_for(app: &tauri::AppHandle, root: &str) -> String {
    load(app).profile_for(root)
}

/// gate-b-sec4 — the hub the APP bound `root` to (a managed copy Maude made: the registry's
/// `managed.server`, else the app-owned managed index), never the folder's own `linkedHub`. The
/// sidecar passes it as `MAUDE_APP_BOUND_HUB` so the studio honours that one link without a prompt.
pub fn app_bound_hub(app: &tauri::AppHandle, root: &str) -> Option<String> {
    let pid = windows::pid_for_root(root);
    load(app).managed_server_of(&pid).or_else(|| {
        crate::managed::bound_copies(app)
            .into_iter()
            .find(|(path, _)| windows::pid_for_root(path) == pid)
            .map(|(_, server)| server)
    })
}

/// Bind `root` to profile `id`. The id must be valid AND registered — a binding
/// to a profile that doesn't exist would spawn the server on no account at all.
/// A running server keeps its old env until restarted: T11 restarts it
/// explicitly; env is never hot-swapped.
#[allow(dead_code)] // release: no caller yet (e2e_bind_profile is debug-only; V2-3.8 binds via settle_sign_in)
pub fn bind_profile(app: &tauri::AppHandle, root: &str, id: &str) -> Result<(), String> {
    profiles::validate_id(id)?;
    if !profiles::exists(id) {
        return Err("That account profile doesn't exist.".to_string());
    }
    update(app, |st, now| {
        st.bind(root, id, now);
    });
    Ok(())
}

/// Bind `root` to an existing profile by choice (V2-3.8 cloud prepare).
pub fn bind_chosen(app: &tauri::AppHandle, root: &str, id: &str) -> Result<(), String> {
    profiles::validate_id(id)?;
    if !profiles::exists(id) {
        return Err("That account profile doesn't exist.".to_string());
    }
    update(app, |st, now| {
        st.bind(root, id, now);
    });
    Ok(())
}

/// `AppState::bind_managed` through the lock. The profile must be valid and
/// registered (default always is).
pub fn bind_managed(
    app: &tauri::AppHandle,
    root: &Path,
    profile: &str,
    server: &str,
    project_id: &str,
) -> Result<String, String> {
    profiles::validate_id(profile)?;
    if profile != profiles::DEFAULT_ID && !profiles::exists(profile) {
        return Err("That account profile doesn't exist.".to_string());
    }
    let root = root.to_string_lossy().to_string();
    Ok(update(app, |st, now| {
        st.bind_managed(&root, profile, server, project_id, now)
    }))
}

/// Whether any registered project is bound to `id` (profiles_delete refuses then).
pub fn is_profile_bound(app: &tauri::AppHandle, id: &str) -> bool {
    load(app).is_profile_bound(id)
}

/// The remembered last project, IF it still exists on disk (a deleted project
/// falls through to first-run rather than crash-looping the sidecar).
pub fn last_project(app: &tauri::AppHandle) -> Option<PathBuf> {
    let p = PathBuf::from(load(app).last_project?);
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

/// Remember `path` as the last project: registry upsert, MRU head, one-tab session
/// (and, via `save_to`, the v1 keys).
pub fn set_last_project(app: &tauri::AppHandle, path: &Path) {
    set_last_project_with(app, path, Binding::Adopt);
}

/// `set_last_project`, choosing whether an unbound entry may adopt
/// `lastSignInProfile` (S15-A1; `open_local_project` keeps a registered one's).
pub fn set_last_project_with(app: &tauri::AppHandle, path: &Path, binding: Binding) {
    let s = path.to_string_lossy().to_string();
    update(app, |st, now| {
        forget_missing_recent(st);
        let pid = st.open_with(&s, now, binding);
        st.session = Some(one_tab_session(&pid, now));
    });
    // Keep the legacy marker in sync so any older read path still resolves.
    if let Some(marker) = legacy_marker(app) {
        if let Some(dir) = marker.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&marker, path.to_string_lossy().as_bytes());
    }
}

/// Save the live tab session (V2-3.2, §5.5 `session`): every tab in order and
/// the focused label. Through `update`, so it serializes with every other v2
/// write and refreshes the v1 `last_project` mirror from the new focus.
pub fn save_session(app: &tauri::AppHandle, tabs: Vec<SessionTab>, focused: Option<String>) {
    update(app, |st, now| {
        st.session = Some(Session {
            tabs,
            focused,
            saved_at: now,
        });
    });
}

/// The MRU project list, filtered to ones that still exist (max 10).
pub fn recent_projects(app: &tauri::AppHandle) -> Vec<String> {
    load(app)
        .recent_projects
        .into_iter()
        .filter(|p| Path::new(p).exists())
        .collect()
}

// ── Tauri commands (webview → shell) ────────────────────────────────────────────
/// V2-3.6 N-M1: the calling project window's own profile only — a page never
/// learns where another profile's projects live.
#[tauri::command]
pub fn app_get_last_project(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<Option<String>, String> {
    let caller = windows::caller_project(&webview, false)?;
    let st = load(&app);
    let profile = st.profile_for(&caller.root);
    Ok(last_project(&app)
        .map(|p| p.to_string_lossy().to_string())
        .filter(|p| st.profile_for(p) == profile))
}

/// V2-3.6 M3: remembering a folder REGISTERS it, and a registered folder is
/// one `open_local_project` accepts — so this is gated the same way: the
/// calling project window, and a registered project or that window's pick.
#[tauri::command]
pub fn app_set_last_project(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    path: String,
) -> Result<(), String> {
    let caller = windows::caller_project(&webview, false)?;
    let p = PathBuf::from(path);
    if !p.is_dir() || !windows::local_project_allowed(&app, &caller.label, &p) {
        return Err("That folder can’t be remembered from here.".to_string());
    }
    set_last_project(&app, &p);
    Ok(())
}

/// The recents list the repo switcher shows (V2-3.6 N-M1): the calling
/// project window's own profile only, never another profile's paths.
#[tauri::command]
pub fn app_recent_projects(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<Vec<String>, String> {
    let caller = windows::caller_project(&webview, false)?;
    let st = load(&app);
    Ok(st.recents_in_profile(&st.profile_for(&caller.root), recent_projects(&app)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u64 = 24 * 60 * 60 * 1000;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "maude-appstate-{tag}-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    // p8-sec2-lows I2 — a state file that exists but does not parse is "unreadable", a missing one is not.
    #[test]
    fn state_unreadable_tells_a_corrupt_file_from_a_missing_one() {
        let d = tmp("unreadable");
        let f = d.join("app-state.json");
        assert!(!state_unreadable_in(&f), "missing: a fresh install, nothing to protect");
        std::fs::write(&f, b"{ not json").unwrap();
        assert!(state_unreadable_in(&f), "present but corrupt");
        std::fs::write(&f, serde_json::to_vec(&AppState::default()).unwrap()).unwrap();
        assert!(!state_unreadable_in(&f), "present and parses");
    }

    fn read_json(p: &Path) -> serde_json::Value {
        serde_json::from_slice(&std::fs::read(p).unwrap()).unwrap()
    }

    #[test]
    fn app_state_v1_migrates_to_v2_and_still_writes_v1_keys() {
        let dir = tmp("mig");
        let a = dir.join("alpha");
        let b = dir.join("beta");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        let (a_s, b_s) = (
            a.to_string_lossy().to_string(),
            b.to_string_lossy().to_string(),
        );
        let file = dir.join("app-state.json");
        std::fs::write(
            &file,
            serde_json::json!({ "last_project": b_s, "recent_projects": [b_s, a_s] }).to_string(),
        )
        .unwrap();

        let now = 1_760_000_000_000;
        let mut st = load_from(Some(&file), None, now);
        let (pa, pb) = (windows::pid_for_root(&a_s), windows::pid_for_root(&b_s));
        assert_eq!(st.v, 2);
        assert_eq!(
            st.recent,
            vec![pb.clone(), pa.clone()],
            "MRU order survives"
        );
        assert_eq!(st.projects[&pa].root, a_s);
        assert_eq!(st.projects[&pa].name, "alpha");
        assert_eq!(
            st.projects[&pa].profile, "default",
            "every migrated entry is default"
        );
        let session = st.session.clone().unwrap();
        assert_eq!(session.focused.as_deref(), Some(format!("p-{pb}").as_str()));
        assert_eq!(session.tabs.len(), 1);

        save_to(&file, &mut st);
        let j = read_json(&file);
        assert_eq!(j["v"], 2);
        assert_eq!(j["last_project"], b_s, "v1 key still written for downgrade");
        assert_eq!(j["recent_projects"], serde_json::json!([b_s, a_s]));
        assert_eq!(j["projects"][&pa]["profile"], "default");
        assert!(
            j["projects"][&pa].get("lastOpenedAt").is_some(),
            "camelCase per §5.5"
        );

        // Read order: v2 keys win over (stale) v1 keys.
        let mut v = j.clone();
        v["last_project"] = serde_json::json!("/somewhere/else");
        v["recent_projects"] = serde_json::json!(["/somewhere/else"]);
        std::fs::write(&file, v.to_string()).unwrap();
        let st2 = load_from(Some(&file), None, now);
        assert_eq!(st2.last_project.as_deref(), Some(b_s.as_str()));
        assert_eq!(st2.recent.len(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_marker_migrates() {
        let dir = tmp("marker");
        let marker = dir.join("last-project.txt");
        std::fs::write(&marker, "/gone/project\n").unwrap();
        let st = load_from(Some(&dir.join("absent.json")), Some(&marker), 1_000 * DAY);
        assert_eq!(st.last_project.as_deref(), Some("/gone/project"));
        assert_eq!(st.recent.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn vanished_roots_are_kept_until_they_age_out() {
        let now = 1_000 * DAY;
        let mut st = AppState {
            v: 2,
            ..AppState::default()
        };
        let fresh = st.open("/vanished/fresh", now - 10 * DAY);
        let stale = st.open("/vanished/stale", now - 91 * DAY);
        st.prune(now);
        assert!(
            st.projects.contains_key(&fresh),
            "a vanished root is kept, not deleted"
        );
        assert!(
            !st.projects.contains_key(&stale),
            "90 days unopened ⇒ aged out"
        );
        assert_eq!(st.recent, vec![fresh]);
    }

    #[test]
    fn profile_binding_lives_on_the_registry_entry() {
        let mut st = AppState::default();
        assert_eq!(
            st.profile_for("/x/never-seen"),
            "default",
            "missing ⇒ default"
        );
        let pid = st.upsert("/x/p", 1);
        st.projects.get_mut(&pid).unwrap().profile = "work".into();
        assert_eq!(st.profile_for("/x/p"), "work");
        assert!(st.is_profile_bound("work"));
        assert!(!st.is_profile_bound("other"));
        // Re-opening keeps the binding.
        st.open("/x/p", 2);
        assert_eq!(st.profile_for("/x/p"), "work");
        // A tampered on-disk id never reaches a path or the keychain.
        st.projects.get_mut(&pid).unwrap().profile = "../evil".into();
        assert_eq!(st.profile_for("/x/p"), "default");
    }

    /// N-H1 (audit 2): a managed copy Home made for profile Y is registered ON Y,
    /// with the app-owned (server, project) it was made for — before anything
    /// spawns it — and a later plain open keeps both.
    #[test]
    fn a_managed_copy_is_bound_to_the_profile_it_was_made_for() {
        let mut st = AppState::default();
        let pid = st.bind_managed("/data/projects/work@a.test--p", "work", "https://a.test", "p", 1);
        let e = &st.projects[&pid];
        assert_eq!(e.profile, "work");
        assert_eq!(
            e.managed,
            Some(serde_json::json!({ "server": "https://a.test", "projectId": "p" }))
        );
        st.open("/data/projects/work@a.test--p", 2);
        assert_eq!(st.profile_for("/data/projects/work@a.test--p"), "work");
        assert_eq!(st.managed_server_of(&pid).as_deref(), Some("https://a.test"));
        // A plain local folder carries no app-owned hub binding.
        let local = st.upsert("/x/local", 3);
        assert_eq!(st.managed_server_of(&local), None);
    }

    /// N-M1 (audit 2): a project page's recents hold its own profile's paths only.
    #[test]
    fn recents_answer_only_the_callers_profile() {
        let mut st = AppState::default();
        let w = st.upsert("/x/work-a", 1);
        st.projects.get_mut(&w).unwrap().profile = "work".into();
        st.upsert("/x/home-b", 2);
        let roots = vec!["/x/work-a".to_string(), "/x/home-b".to_string(), "/x/unknown".to_string()];
        assert_eq!(st.recents_in_profile("work", roots.clone()), vec!["/x/work-a".to_string()]);
        assert_eq!(
            st.recents_in_profile("default", roots),
            vec!["/x/home-b".to_string(), "/x/unknown".to_string()]
        );
    }

    #[test]
    fn recent_is_capped_at_fifty_and_v1_mirror_at_ten() {
        let mut st = AppState::default();
        for i in 0..60 {
            st.open(&format!("/p/{i}"), i);
        }
        st.sync_v1();
        assert_eq!(st.recent.len(), 50);
        assert_eq!(st.recent_projects.len(), 10);
        assert_eq!(st.recent_projects[0], "/p/59");
    }

    // ── V2-3.8: each project keeps its own sign-in ─────────────────────────────

    use crate::keychain;
    use crate::profiles::SignInKind;

    /// A throwaway profile registry with one shared profile `<tag>-shared`
    /// that projects `/v238/<tag>/a` and `/v238/<tag>/b` are bound to — the
    /// finding's "every project sits on one profile", without touching the
    /// `default` keychain slot other tests share.
    fn shared_fixture(tag: &str) -> (PathBuf, AppState, String) {
        keychain::test_store::install();
        let dir = tmp(tag);
        let reg = dir.join("profiles.json");
        let shared = profiles::create_in(&reg, &format!("{tag} shared")).unwrap().id;
        let mut st = AppState::default();
        st.bind(&format!("/v238/{tag}/a"), &shared, 1);
        st.bind(&format!("/v238/{tag}/b"), &shared, 1);
        (reg, st, shared)
    }

    fn github_sign_in(st: &mut AppState, reg: &Path, root: &str, login: &str) -> SignedIn {
        let token = format!("tok-{login}");
        settle_sign_in(
            st,
            reg,
            root,
            SignInKind::GitHub,
            login,
            |p| keychain::get_token(p).is_some(),
            |p| keychain::set_token(p, &token),
            2,
        )
        .unwrap()
    }

    fn ids(reg: &Path) -> Vec<String> {
        profiles::list_in(reg).into_iter().map(|p| p.id).collect()
    }

    #[test]
    fn a_first_sign_in_creates_no_profile() {
        let (reg, mut st, shared) = shared_fixture("v238first");
        let before = ids(&reg);
        let out = github_sign_in(&mut st, &reg, "/v238/v238first/a", "v238first-x");
        assert_eq!(out, SignedIn { profile: shared.clone(), rebound: false });
        assert_eq!(ids(&reg), before, "a first sign-in makes no profile");
        assert_eq!(keychain::get_token(&shared).as_deref(), Some("tok-v238first-x"));
        assert_eq!(st.last_sign_in_profile.as_deref(), Some(shared.as_str()));
        assert_eq!(
            profiles::recorded_account_in(&reg, &shared, SignInKind::GitHub).as_deref(),
            Some("v238first-x")
        );
    }

    /// The finding: A signs in as X, B (same profile) signs in as Y — B moves
    /// to a new profile and A's profile still holds X's token.
    #[test]
    fn a_rebind_leaves_the_old_profiles_token_untouched() {
        let (reg, mut st, shared) = shared_fixture("v238rebind");
        let (a, b) = ("/v238/v238rebind/a", "/v238/v238rebind/b");
        github_sign_in(&mut st, &reg, a, "v238rebind-x");
        let out = github_sign_in(&mut st, &reg, b, "v238rebind-y");
        assert!(out.rebound, "B must not re-sign the profile A uses");
        assert_ne!(out.profile, shared);
        assert_eq!(keychain::get_token(&shared).as_deref(), Some("tok-v238rebind-x"), "A's token untouched");
        assert_eq!(keychain::get_token(&out.profile).as_deref(), Some("tok-v238rebind-y"));
        assert_eq!(st.profile_for(a), shared, "A keeps its profile");
        assert_eq!(st.profile_for(b), out.profile, "B is rebound");
        assert!(ids(&reg).contains(&out.profile));
        // The same account again on B's own profile refreshes in place.
        let again = github_sign_in(&mut st, &reg, b, "v238rebind-y");
        assert_eq!(again, SignedIn { profile: out.profile.clone(), rebound: false });
    }

    #[test]
    fn a_rebind_reaches_profile_env() {
        let (reg, mut st, shared) = shared_fixture("v238env");
        github_sign_in(&mut st, &reg, "/v238/v238env/a", "v238env-x");
        let out = github_sign_in(&mut st, &reg, "/v238/v238env/b", "v238env-y");
        // What spawn_for hands the restarted server: the binding, read per spawn.
        let bound = st.profile_for("/v238/v238env/b");
        assert!(out.rebound);
        assert_eq!(bound, out.profile);
        assert_ne!(bound, shared, "the restart is onto the NEW profile");
        let paths = profiles::paths(&bound).unwrap();
        let env = crate::sidecar::profile_env(&bound, "Y", Some(&paths));
        let get = |k: &str| env.iter().find(|(n, _)| *n == k).map(|(_, v)| v.clone());
        assert_eq!(get("MAUDE_PROFILE_ID").as_deref(), Some(bound.as_str()));
        let cloud = get("MAUDE_CLOUD_CONFIG").expect("a non-default profile names its cloud.json");
        assert!(cloud.ends_with(&format!("profiles/{bound}/cloud.json")), "{cloud}");
        let hubs = get("HUBS_CONFIG_PATH").expect("and its hubs.json");
        assert!(hubs.ends_with(&format!("profiles/{bound}/hubs.json")), "{hubs}");
    }

    /// Step 3 of the finding: a project that never signed in follows the
    /// profile of the most recent sign-in — once, when it is opened.
    #[test]
    fn a_never_signed_project_takes_the_most_recent_profile() {
        let (reg, mut st, _shared) = shared_fixture("v238recent");
        github_sign_in(&mut st, &reg, "/v238/v238recent/a", "v238recent-x");
        let out = github_sign_in(&mut st, &reg, "/v238/v238recent/b", "v238recent-y");
        // A project new to the registry…
        let c = st.open("/v238/v238recent/c", 3);
        assert_eq!(st.projects[&c].profile, out.profile);
        assert!(st.projects[&c].bound);
        // …and an old one that sat on `default` without ever signing in.
        let d = st.upsert("/v238/v238recent/d", 0);
        assert_eq!(st.profile_for("/v238/v238recent/d"), "default");
        st.open("/v238/v238recent/d", 4);
        assert_eq!(st.projects[&d].profile, out.profile);
        // Without any sign-in yet, a new project stays on default, unbound.
        let mut fresh = AppState::default();
        let e = fresh.open("/v238/v238recent/e", 1);
        assert_eq!(fresh.projects[&e].profile, "default");
        assert!(!fresh.projects[&e].is_bound());
    }

    /// S15-A1: a project tab opening ANOTHER project (⌘K across, the pid path
    /// of `open_project`) never binds it — an unbound project stays unbound
    /// on `default`, the profile the tab's scope check saw — and still counts
    /// as opened. Home's first open keeps adopting (the test above).
    #[test]
    fn an_open_from_a_project_tab_never_adopts_a_profile() {
        let (reg, mut st, _shared) = shared_fixture("s15a1");
        let out = github_sign_in(&mut st, &reg, "/s15/s15a1/work", "s15a1-x");
        assert!(st.last_sign_in_profile.is_some());
        let d = st.upsert("/s15/s15a1/d", 0);
        let pid = st.open_with("/s15/s15a1/d", 9, Binding::Keep);
        assert_eq!(pid, d);
        assert_eq!(st.profile_for("/s15/s15a1/d"), "default", "a tab open re-bound the project");
        assert!(!st.projects[&d].is_bound());
        assert_eq!(st.projects[&d].last_opened_at, 9);
        assert_eq!(st.recent.first(), Some(&d));
        // The next open from Home is the first-open binding, unchanged.
        st.open_with("/s15/s15a1/d", 10, Binding::Adopt);
        assert_eq!(st.projects[&d].profile, out.profile);
        // And the commands pick `Keep` for a project caller (source pin).
        let src = include_str!("windows.rs");
        assert!(src.contains("Caller::Project(_) => crate::app_state::Binding::Keep"));
        assert!(include_str!("home.rs").contains("crate::app_state::Binding::Keep"));
    }

    #[test]
    fn an_existing_binding_survives_a_reopen() {
        let (reg, mut st, shared) = shared_fixture("v238keep");
        github_sign_in(&mut st, &reg, "/v238/v238keep/a", "v238keep-x");
        github_sign_in(&mut st, &reg, "/v238/v238keep/b", "v238keep-y");
        // The most recent sign-in is B's new profile; A is bound and stays.
        st.open("/v238/v238keep/a", 5);
        assert_eq!(st.profile_for("/v238/v238keep/a"), shared);
        // A project bound to `default` by choice is bound too (not "unbound").
        st.bind("/v238/v238keep/f", "default", 5);
        st.open("/v238/v238keep/f", 6);
        assert_eq!(st.profile_for("/v238/v238keep/f"), "default");
        // And it survives the file round trip.
        let dir = tmp("v238keep-file");
        let file = dir.join("app-state.json");
        save_to(&file, &mut st);
        let mut back = load_from(Some(&file), None, 7);
        back.open("/v238/v238keep/f", 8);
        assert_eq!(back.profile_for("/v238/v238keep/f"), "default");
        assert_eq!(back.profile_for("/v238/v238keep/a"), shared);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Sign-out deletes the calling project's profile token only. Projects
    /// sharing that profile share the account, so they are signed out with it;
    /// the recorded login stays, so a later sign-in as someone else from any of
    /// them still moves that project to its own profile.
    #[test]
    fn sign_out_is_scoped_to_the_calling_projects_profile() {
        let (reg, mut st, shared) = shared_fixture("v238out");
        let (a, b) = ("/v238/v238out/a", "/v238/v238out/b");
        st.bind("/v238/v238out/c", &shared, 1);
        github_sign_in(&mut st, &reg, a, "v238out-x");
        let y = github_sign_in(&mut st, &reg, b, "v238out-y").profile;
        // B signs out: only B's profile.
        keychain::delete_token(&st.profile_for(b)).unwrap();
        assert_eq!(keychain::get_token(&y), None);
        assert_eq!(keychain::get_token(&shared).as_deref(), Some("tok-v238out-x"), "A still X");
        // A signs out of the profile it shares with C …
        keychain::delete_token(&st.profile_for(a)).unwrap();
        // … and C signs in as Z: the shared profile is not re-signed as Z.
        let z = github_sign_in(&mut st, &reg, "/v238/v238out/c", "v238out-z");
        assert!(z.rebound);
        assert_eq!(keychain::get_token(&shared), None);
        assert_eq!(st.profile_for(a), shared);
        // A signing in as X again lands back on its own profile.
        let back = github_sign_in(&mut st, &reg, a, "v238out-x");
        assert_eq!(back, SignedIn { profile: shared, rebound: false });
    }

    /// p8-port-gc — the port a project's server bound is recorded on spawn and asked for again on wake and
    /// relaunch; a server that had to fall back records its new port.
    #[test]
    fn project_port_is_recorded_on_spawn_and_reused_on_wake_and_relaunch() {
        let dir = tmp("port");
        let file = dir.join("app-state.json");
        let mut st = AppState::default();
        st.upsert("/x/port-a", 1);
        assert_eq!(st.preferred_port("/x/port-a"), None, "a new project has no port yet");

        // spawn → the server bound 46402 → recorded
        assert!(st.record_port("/x/port-a", 46402));
        assert_eq!(st.preferred_port("/x/port-a"), Some(46402), "a wake asks for the same port");
        assert!(!st.record_port("/x/port-a", 46402), "an unchanged port is not a write");

        // relaunch → the same port comes back from disk
        save_to(&file, &mut st);
        assert_eq!(read_json(&file)["projects"][windows::pid_for_root("/x/port-a")]["port"], 46402);
        let mut st = load_from(Some(&file), None, 2);
        assert_eq!(st.preferred_port("/x/port-a"), Some(46402));

        // the recorded port was taken → the server walked the ladder → the new port is recorded
        assert!(st.record_port("/x/port-a", 46405));
        assert_eq!(st.preferred_port("/x/port-a"), Some(46405));

        // an unregistered root never gains an entry; 0 is never a port
        assert!(!st.record_port("/x/never-opened", 46401));
        assert!(!st.projects.contains_key(&windows::pid_for_root("/x/never-opened")));
        assert!(!st.record_port("/x/port-a", 0));
        assert_eq!(st.preferred_port("/x/port-a"), Some(46405));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
