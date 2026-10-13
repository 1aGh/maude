// crash_reporter.rs — opt-in, local-only crash logging (Phase 32 / Task 4).
//
// DEFAULT OFF. Only when the user explicitly checks "Send crash reports to help
// improve Maude" in the first-run wizard (prefs.crash_reporting = true) does a panic
// get written to a local file the user can attach to a GitHub issue. NOTHING leaves
// the machine — no network, no third party (the user picked the local-file backend
// over Sentry). Privacy: a report holds only the panic message + source location +
// backtrace + OS + Maude version. It deliberately does NOT capture canvas content,
// paths to user data, or any token — the keychain GitHub token never enters Rust
// panic state, and the panic `location()` is our own source file, not user data.
//
// Opt-in is the explicit checkbox; opt-out is the default — never the reverse
// (non-technical users click "yes" on everything).

use std::backtrace::Backtrace;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::Manager;

use crate::prefs::CRASH_REPORTING;

/// Keep at most this many crash logs on disk (oldest pruned at startup).
const MAX_CRASH_LOGS: usize = 10;

/// Prune crash logs down to the most recent `MAX_CRASH_LOGS` (filenames are
/// `crash-<unix-secs>.log`, so lexical sort == chronological). Best-effort.
fn prune_old_logs(dir: &std::path::Path) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<std::path::PathBuf> = rd
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|x| x == "log").unwrap_or(false))
        .collect();
    if files.len() <= MAX_CRASH_LOGS {
        return;
    }
    files.sort();
    for old in &files[..files.len() - MAX_CRASH_LOGS] {
        let _ = std::fs::remove_file(old);
    }
}

/// One row in the Report-a-Bug dialog's crash-log consent checkbox.
#[derive(Serialize)]
pub struct CrashLogInfo {
    pub name: String,
    /// The report's first line ("Maude crash report") — enough for the
    /// consent UI to show something human without shipping the body yet.
    pub first_line: String,
}

fn crashes_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("crashes"))
}

/// Only ever serve names we generated ourselves — the name doubles as a path
/// segment, so anything else is a traversal attempt, not a crash log.
fn valid_log_name(name: &str) -> bool {
    name.strip_prefix("crash-")
        .and_then(|rest| rest.strip_suffix(".log"))
        .is_some_and(|ts| !ts.is_empty() && ts.bytes().all(|b| b.is_ascii_digit()))
}

/// List local crash logs (newest first) for the Report-a-Bug dialog. Reading
/// them is consent-gated in the dialog; this only names them. Reports are
/// written scrubbed by design (no user data, no tokens — see module header),
/// so listing carries nothing sensitive.
#[tauri::command]
pub fn list_crash_logs(app: tauri::AppHandle, webview: tauri::Webview) -> Result<Vec<CrashLogInfo>, String> {
    crate::windows::caller_project(&webview, false)?;
    let Some(dir) = crashes_dir(&app) else { return Ok(Vec::new()) };
    let Ok(rd) = std::fs::read_dir(&dir) else { return Ok(Vec::new()) };
    let mut names: Vec<String> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| valid_log_name(n))
        .collect();
    names.sort();
    names.reverse(); // crash-<unix-secs> — lexical == chronological
    Ok(names
        .into_iter()
        .take(10)
        .map(|name| {
            let first_line = std::fs::read_to_string(dir.join(&name))
                .ok()
                .and_then(|s| s.lines().next().map(str::to_string))
                .unwrap_or_default();
            CrashLogInfo { name, first_line }
        })
        .collect())
}

/// Read one crash log body for a consented report attachment. The backtrace
/// can carry the user's home path in frame locations (our own source files
/// when built locally) — collapse it to `~` before it leaves the shell.
#[tauri::command]
pub fn read_crash_log(app: tauri::AppHandle, webview: tauri::Webview, name: String) -> Result<String, String> {
    crate::windows::caller_project(&webview, false)?;
    if !valid_log_name(&name) {
        return Err("not a crash log".into());
    }
    let dir = crashes_dir(&app).ok_or("no crash-log directory")?;
    let body = std::fs::read_to_string(dir.join(&name)).map_err(|e| e.to_string())?;
    let scrubbed = match app.path().home_dir() {
        Ok(home) => body.replace(&home.to_string_lossy().to_string(), "~"),
        Err(_) => body,
    };
    Ok(scrubbed)
}

/// Install the panic hook. Chains the default hook (so stderr still shows the panic),
/// then — IF crash reporting is opted in — appends a scrubbed report to a local file.
/// Call once, early in `setup`, after `prefs::init`.
pub fn install(app: &tauri::AppHandle) {
    let dir = app.path().app_config_dir().ok().map(|d| d.join("crashes"));
    if let Some(d) = &dir {
        prune_old_logs(d);
    }
    let version = app.package_info().version.to_string();

    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Always preserve default behavior (stderr message).
        default_hook(info);
        // Opt-in gate — silent no-op when off.
        if !CRASH_REPORTING.load(Ordering::Relaxed) {
            return;
        }
        let Some(dir) = dir.clone() else { return };
        if std::fs::create_dir_all(&dir).is_err() {
            return;
        }

        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let path: PathBuf = dir.join(format!("crash-{ts}.log"));

        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| (*s).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic".to_string());
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_default();
        let bt = Backtrace::force_capture();

        let report = format!(
            "Maude crash report\nversion: {version}\nos: {} {}\nlocation: {location}\nmessage: {msg}\n\nbacktrace:\n{bt}\n",
            std::env::consts::OS,
            std::env::consts::ARCH,
        );
        if let Ok(mut f) = std::fs::File::create(&path) {
            let _ = f.write_all(report.as_bytes());
        }
    }));
}
