// app_state.rs — first-run detection + the project registry / last-project
// persistence (Phase 29, epic E4; schema v2 since V2-3.1).
//
// Chicken-and-egg: the OnboardingWizard is a CLIENT surface served BY the dev-server,
// but the dev-server needs a project with a `.design/` to boot. So on first launch
// (nothing remembered) the shell boots the sidecar against a minimal **welcome
// project** in app-data, and the client — querying `app_is_first_run` — renders the
// wizard OVER the (empty) canvas browser. Completing a door calls `set_last_project`
// + switches the sidecar to the real project, so the next launch skips the wizard
// (the fast path).
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

// Set once a project has been opened in THIS process run (via set_last_project). The
// debug-only MAUDE_FORCE_ONBOARDING affordance reads it so that completing an onboarding
// door DISMISSES the wizard to the studio instead of re-rendering it forever — it forces
// first-run only until the user actually opens a project this run.
#[cfg(debug_assertions)]
static PROJECT_OPENED_THIS_RUN: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

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
    fn open(&mut self, root: &str, now: u64) -> String {
        let pid = self.upsert(root, now);
        if let Some(e) = self.projects.get_mut(&pid) {
            e.last_opened_at = now;
        }
        self.touch_recent(&pid);
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

/// Read persisted state (v2; v1 and the legacy marker migrate transparently).
pub fn load(app: &tauri::AppHandle) -> AppState {
    load_from(
        state_path(app).as_deref(),
        legacy_marker(app).as_deref(),
        now_ms(),
    )
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
    out
}

/// Register (or touch) a project in the registry when a window opens it
/// (`open_project`, Home, File › Open Project…): `lastOpenedAt` + the MRU head
/// that Home's `ShellState.recent` reads (V2-3.3). The session is left alone —
/// the tab set is part b's. Returns its pid.
pub fn upsert_project(app: &tauri::AppHandle, root: &Path) -> String {
    let root = root.to_string_lossy().to_string();
    update(app, |st, now| st.open(&root, now))
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

/// The account profile bound to `root` (missing ⇒ `default`).
pub fn profile_for(app: &tauri::AppHandle, root: &str) -> String {
    load(app).profile_for(root)
}

/// Bind `root` to profile `id`. The id must be valid AND registered — a binding
/// to a profile that doesn't exist would spawn the server on no account at all.
/// A running server keeps its old env until restarted: T11 restarts it
/// explicitly; env is never hot-swapped.
#[allow(dead_code)] // first caller lands with the profile UI (old T11)
pub fn bind_profile(app: &tauri::AppHandle, root: &str, id: &str) -> Result<(), String> {
    profiles::validate_id(id)?;
    if !profiles::exists(id) {
        return Err("That account profile doesn't exist.".to_string());
    }
    update(app, |st, now| {
        let pid = st.upsert(root, now);
        if let Some(e) = st.projects.get_mut(&pid) {
            e.profile = id.to_string();
        }
    });
    Ok(())
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

/// First run (show the wizard) = there is no usable remembered project.
pub fn is_first_run(app: &tauri::AppHandle) -> bool {
    // Dev/test affordance (debug builds only): force the onboarding wizard to render
    // regardless of remembered state, so `pnpm dev:desktop:onboarding` can walk the
    // first-run flow without moving app-state files on disk. Gated on `debug_assertions`,
    // so it is NEVER honored in the release `.app`.
    #[cfg(debug_assertions)]
    if std::env::var("MAUDE_FORCE_ONBOARDING")
        .map(|v| !v.is_empty())
        .unwrap_or(false)
    {
        // Force the wizard only until the user opens a project THIS run; once a door
        // completes (set_last_project), let it dismiss to the studio instead of looping.
        return !PROJECT_OPENED_THIS_RUN.load(std::sync::atomic::Ordering::Relaxed);
    }
    // An explicit project target via the `MAUDE_PROJECT_ROOT` override (e2e/tests,
    // or a power-user launching at a known project) means the app was told what to
    // open — so it's not a first run, and the onboarding wizard must not render over
    // it. Mirrors resolve_project_root()'s precedence (env first). Harmless in
    // release: the env var is an existing documented override.
    if std::env::var("MAUDE_PROJECT_ROOT")
        .map(|v| !v.is_empty())
        .unwrap_or(false)
    {
        return false;
    }
    // V2-3.3: a launch opens Home, and every project Home opens is registered
    // before its window exists — a registered project is never a first run (the
    // wizard must not cover a project the person just picked).
    last_project(app).is_none() && load(app).projects.is_empty()
}

/// Remember `path` as the last project: registry upsert, MRU head, one-tab session
/// (and, via `save_to`, the v1 keys).
pub fn set_last_project(app: &tauri::AppHandle, path: &Path) {
    let s = path.to_string_lossy().to_string();
    update(app, |st, now| {
        let pid = st.open(&s, now);
        st.session = Some(one_tab_session(&pid, now));
    });
    // A project was opened this run — lets MAUDE_FORCE_ONBOARDING dismiss the wizard.
    #[cfg(debug_assertions)]
    PROJECT_OPENED_THIS_RUN.store(true, std::sync::atomic::Ordering::Relaxed);
    // Keep the legacy marker in sync so any older read path still resolves.
    if let Some(marker) = legacy_marker(app) {
        if let Some(dir) = marker.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(&marker, path.to_string_lossy().as_bytes());
    }
}

/// The MRU project list, filtered to ones that still exist (max 10).
pub fn recent_projects(app: &tauri::AppHandle) -> Vec<String> {
    load(app)
        .recent_projects
        .into_iter()
        .filter(|p| Path::new(p).exists())
        .collect()
}

/// A minimal, always-bootable project the dev-server serves on first run so the
/// webview has something to render the wizard over. Reuses the same minimal
/// `.design/` scaffold as the "Set up Maude here" fallback (lib::write_minimal_design).
pub fn welcome_project(app: &tauri::AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let dir = base.join("welcome-project");
    let _ = crate::write_minimal_design(&dir);
    dir
}

// ── Tauri commands (webview → shell) ────────────────────────────────────────────
#[tauri::command]
pub fn app_is_first_run(app: tauri::AppHandle) -> bool {
    is_first_run(&app)
}

#[tauri::command]
pub fn app_get_last_project(app: tauri::AppHandle) -> Option<String> {
    last_project(&app).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn app_set_last_project(app: tauri::AppHandle, path: String) {
    set_last_project(&app, &PathBuf::from(path));
}

#[tauri::command]
pub fn app_recent_projects(app: tauri::AppHandle) -> Vec<String> {
    recent_projects(&app)
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
}
