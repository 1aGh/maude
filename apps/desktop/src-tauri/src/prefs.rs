// prefs.rs — small user-preferences store (Phase 32 / Task 4).
//
// Distinct from app_state.json (which holds the project MRU): prefs.json holds
// opt-in toggles. Today that's just `crash_reporting` — DEFAULT OFF. Lives at
// <app_config_dir>/prefs.json:  { "crash_reporting": false }
//
// The panic hook (crash_reporter.rs) must check the toggle without doing file I/O
// mid-panic, so we mirror it into a static AtomicBool primed at startup and updated
// whenever the webview flips the pref.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::Manager;

/// Mirrors prefs.json's crash_reporting so the panic hook reads it lock-free.
pub static CRASH_REPORTING: AtomicBool = AtomicBool::new(false);

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize)]
pub struct Prefs {
    #[serde(default)]
    pub crash_reporting: bool,
    /// DDR-166 Decision 5 — the primary opt-out for the auto-install/auto-
    /// sign-in AI-editing setup flow. DEFAULT ON (unlike crash_reporting):
    /// this is an opt-OUT for locked-down/enterprise machines, not an
    /// opt-in. A settings-UI toggle, not just an env var — the whole point
    /// is that it must be reachable without ever opening a terminal.
    #[serde(default = "default_true")]
    pub claude_auto_setup: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { crash_reporting: false, claude_auto_setup: true }
    }
}

fn prefs_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("prefs.json"))
}

pub fn load(app: &tauri::AppHandle) -> Prefs {
    if let Some(p) = prefs_path(app) {
        if let Ok(bytes) = std::fs::read(&p) {
            if let Ok(pr) = serde_json::from_slice::<Prefs>(&bytes) {
                return pr;
            }
        }
    }
    Prefs::default()
}

fn save(app: &tauri::AppHandle, pr: &Prefs) {
    let Some(p) = prefs_path(app) else { return };
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(pr) {
        let _ = std::fs::write(&p, json);
    }
}

/// Read prefs at startup and prime the atomic the panic hook reads.
pub fn init(app: &tauri::AppHandle) {
    CRASH_REPORTING.store(load(app).crash_reporting, Ordering::Relaxed);
}

// ── Tauri commands (webview → shell) ────────────────────────────────────────────
#[tauri::command]
pub fn prefs_get_crash_reporting(app: tauri::AppHandle, webview: tauri::Webview) -> Result<bool, String> {
    crate::windows::caller_project(&webview, false)?;
    Ok(load(&app).crash_reporting)
}

#[tauri::command]
pub fn prefs_set_crash_reporting(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    enabled: bool,
) -> Result<(), String> {
    crate::windows::caller_project(&webview, false)?;
    let mut pr = load(&app);
    pr.crash_reporting = enabled;
    save(&app, &pr);
    CRASH_REPORTING.store(enabled, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub fn prefs_get_claude_auto_setup(app: tauri::AppHandle, webview: tauri::Webview) -> Result<bool, String> {
    crate::windows::caller_project(&webview, false)?;
    Ok(load(&app).claude_auto_setup)
}

#[tauri::command]
pub fn prefs_set_claude_auto_setup(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    enabled: bool,
) -> Result<(), String> {
    crate::windows::caller_project(&webview, false)?;
    let mut pr = load(&app);
    pr.claude_auto_setup = enabled;
    save(&app, &pr);
    Ok(())
}
