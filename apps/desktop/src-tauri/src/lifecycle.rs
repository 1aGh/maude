//! S11.16 (C37) — did the last run end cleanly?
//!
//! At launch the shell writes `<app data>/running.json` `{pid, startedAt}` and deletes it
//! on a clean quit (`RunEvent::Exit` — ⌘Q, the quit dialog, the Dock, logout — plus
//! SIGTERM/SIGINT and the update restart, which stop the servers in order too). A launch
//! that finds the file knows the previous run was killed (kill -9, a panic abort, power
//! loss). It then tells each project tab the boot reopened — once, in `app://crashed`.
//!
//! Delivery is a park-and-take (`take_crash_notice`), the `take_tabs_restored` shape,
//! not a push: at boot every restored tab is still on its splash (a resting one only
//! loads when it is opened), so a message sent then reaches no page, and one sent on
//! `shell_subscribe` can land before the page has a handler for it. The page asks once
//! it mounts; the take removes it, so a reload asks again and hears nothing.
//!
//! The marker lives in the app's own data dir — never in a project (so none of the
//! DDR-115 runtime-state lists name it) and never in `~/.config/maude`. A debug build
//! may point it elsewhere with `MAUDE_LIFECYCLE_DIR` (tests, e2e).

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::windows::{Parked, WindowBook};

pub const MARKER: &str = "running.json";

/// What `running.json` holds while the app runs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub pid: u32,
    /// Unix ms.
    pub started_at: u64,
}

/// What a restored tab takes after an unclean exit: `kind` is the message name the
/// contract uses; `startedAt` is when the run that crashed began (`null` when its
/// marker could not be read).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Crashed {
    pub kind: &'static str,
    pub started_at: Option<u64>,
}

pub const CRASHED_KIND: &str = "app://crashed";

static CRASHED: Parked<Crashed> = Parked::new();

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The marker's folder: the app data dir (a debug build: `MAUDE_LIFECYCLE_DIR` first).
pub fn marker_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(d) = std::env::var("MAUDE_LIFECYCLE_DIR").ok().filter(|d| !d.is_empty()) {
        return Some(PathBuf::from(d));
    }
    app.path().app_data_dir().ok()
}

/// Pure half of the launch: read what the last run left, then mark this run. A marker
/// that is there means the last run did not end cleanly (even if it is unreadable).
pub fn begin(dir: &Path, pid: u32, started_at: u64) -> Option<Crashed> {
    let path = dir.join(MARKER);
    let crashed = match std::fs::read(&path) {
        Ok(bytes) => Some(Crashed {
            kind: CRASHED_KIND,
            started_at: serde_json::from_slice::<Marker>(&bytes).ok().map(|m| m.started_at),
        }),
        Err(_) => None,
    };
    let body = serde_json::to_vec(&Marker { pid, started_at }).unwrap_or_default();
    if let Err(e) = crate::profiles::atomic_write(&path, &body) {
        crate::sidecar::log_line(&format!("[maude] could not write {MARKER}: {e}"));
    }
    crashed
}

/// Pure half of a clean exit: remove the marker if it is this run's.
pub fn end(dir: &Path, pid: u32) {
    let path = dir.join(MARKER);
    let ours = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Marker>(&b).ok())
        .is_some_and(|m| m.pid == pid);
    if ours {
        let _ = std::fs::remove_file(&path);
    }
}

/// Launch (lib.rs setup, before the boot tabs): `Some` when the last run crashed.
pub fn start<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<Crashed> {
    let dir = marker_dir(app)?;
    let crashed = begin(&dir, std::process::id(), now_ms());
    if crashed.is_some() {
        crate::sidecar::log_line("[maude] the last run did not quit cleanly");
    }
    crashed
}

/// A clean exit (RunEvent::Exit, SIGTERM/SIGINT, the update restart).
pub fn clean_exit<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(dir) = marker_dir(app) {
        end(&dir, std::process::id());
    }
}

/// Park the notice for every project tab the boot reopened (the book's tabs right
/// after `boot_windows`). Home is not one: it has no project to answer `lastWorkAt` for.
pub fn park_for_tabs(book: &WindowBook, crashed: Option<&Crashed>) -> usize {
    let Some(c) = crashed else { return 0 };
    let mut n = 0;
    for label in book.tab_labels() {
        if book.project_of(label).is_some() {
            CRASHED.park(label, c.clone());
            n += 1;
        }
    }
    n
}

/// After `boot_windows`: hand the restored tabs the notice.
pub fn after_boot(app: &tauri::AppHandle, crashed: Option<Crashed>) {
    let Some(state) = app.try_state::<crate::sidecar::SidecarState>() else {
        return;
    };
    let book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
    park_for_tabs(&book, crashed.as_ref());
}

/// A label's window is gone or now shows another project (`windows::drop_parked_for`).
pub fn drop_for(label: &str) {
    CRASHED.take(label);
}

/// `take_crash_notice()` — `app://crashed` for THIS tab, once (S11.17 shows
/// "Maude quit unexpectedly. Your work up to 14:05 is here.").
#[tauri::command]
pub fn take_crash_notice(webview: tauri::Webview) -> Result<Option<Crashed>, String> {
    let caller = crate::windows::caller_project(&webview, false)?;
    Ok(CRASHED.take(&caller.label))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::windows::Role;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "maude-lifecycle-{tag}-{}-{}",
            std::process::id(),
            now_ms()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_first_launch_and_a_launch_after_a_clean_quit_say_nothing() {
        let dir = scratch("clean");
        assert_eq!(begin(&dir, 11, 1_000), None);
        assert!(dir.join(MARKER).is_file());
        end(&dir, 11);
        assert!(!dir.join(MARKER).exists(), "a clean quit removes the marker");
        assert_eq!(begin(&dir, 12, 2_000), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_launch_after_an_unclean_exit_says_so_once() {
        let dir = scratch("crash");
        assert_eq!(begin(&dir, 21, 1_000), None);
        // No `end`: the run was killed. The next launch hears when it started …
        assert_eq!(
            begin(&dir, 22, 2_000),
            Some(Crashed { kind: CRASHED_KIND, started_at: Some(1_000) })
        );
        // … and only that launch: it rewrote the marker as its own and quit cleanly.
        end(&dir, 22);
        assert_eq!(begin(&dir, 23, 3_000), None);
        // An unreadable marker still means the last run did not end cleanly.
        std::fs::write(dir.join(MARKER), b"{torn").unwrap();
        assert_eq!(begin(&dir, 24, 4_000), Some(Crashed { kind: CRASHED_KIND, started_at: None }));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn end_removes_only_its_own_marker() {
        let dir = scratch("own");
        begin(&dir, 31, 1_000);
        end(&dir, 99);
        assert!(dir.join(MARKER).is_file(), "another run's marker is not ours to clear");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The child half of the kill -9 test below (does nothing without its env var).
    #[test]
    #[ignore = "spawned by the kill -9 test"]
    fn lifecycle_child_process() {
        let Ok(dir) = std::env::var("MAUDE_LIFECYCLE_CHILD_DIR") else { return };
        let dir = PathBuf::from(dir);
        begin(&dir, std::process::id(), now_ms());
        std::fs::write(dir.join("child-ready"), b"1").unwrap();
        if std::env::var("MAUDE_LIFECYCLE_CHILD_CLEAN").is_ok() {
            end(&dir, std::process::id());
            return;
        }
        std::thread::sleep(std::time::Duration::from_secs(60));
    }

    #[cfg(unix)]
    fn run_child(dir: &Path, clean: bool) {
        // no-console-window: unix-only, test-only (this test binary as the child).
        let mut cmd = std::process::Command::new(std::env::current_exe().unwrap());
        cmd.args(["--exact", "lifecycle::tests::lifecycle_child_process", "--ignored", "--test-threads=1"])
            .env("MAUDE_LIFECYCLE_CHILD_DIR", dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        if clean {
            cmd.env("MAUDE_LIFECYCLE_CHILD_CLEAN", "1");
        }
        let mut child = cmd.spawn().unwrap();
        let ready = dir.join("child-ready");
        let t0 = std::time::Instant::now();
        while !ready.exists() {
            assert!(t0.elapsed().as_secs() < 30, "the child never marked its run");
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        if clean {
            assert!(child.wait().unwrap().success());
        } else {
            // SIGKILL: no handler, no Exit event, nothing runs.
            child.kill().unwrap();
            let _ = child.wait();
        }
        let _ = std::fs::remove_file(ready);
    }

    /// A real process: killed with SIGKILL it leaves the marker and the next launch
    /// reports the crash once; a run that quits cleanly leaves nothing to report.
    #[cfg(unix)]
    #[test]
    fn a_kill_9_is_reported_once_and_a_clean_quit_is_not() {
        let dir = scratch("kill9");
        run_child(&dir, false);
        assert!(dir.join(MARKER).is_file(), "kill -9 left the marker");
        let child_started = serde_json::from_slice::<Marker>(&std::fs::read(dir.join(MARKER)).unwrap())
            .unwrap()
            .started_at;
        let crashed = begin(&dir, 41, now_ms());
        assert_eq!(crashed, Some(Crashed { kind: CRASHED_KIND, started_at: Some(child_started) }));
        end(&dir, 41);

        run_child(&dir, true);
        assert!(!dir.join(MARKER).exists(), "a clean quit left a marker");
        assert_eq!(begin(&dir, 42, now_ms()), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_notice_goes_to_each_reopened_project_tab_once() {
        let mut book = WindowBook::default();
        book.insert("p-lc-a", Role::Project { pid: "la".into(), root: "/lc/a".into() }, 0);
        book.insert("p-lc-b", Role::Project { pid: "lb".into(), root: "/lc/b".into() }, 1);
        let c = Crashed { kind: CRASHED_KIND, started_at: Some(5) };
        assert_eq!(park_for_tabs(&book, None), 0);
        assert_eq!(CRASHED.take("p-lc-a"), None, "a clean last run parks nothing");
        assert_eq!(park_for_tabs(&book, Some(&c)), 2);
        assert_eq!(CRASHED.take("home"), None, "Home is not a project tab");
        assert_eq!(CRASHED.take("p-lc-a"), Some(c.clone()));
        assert_eq!(CRASHED.take("p-lc-a"), None, "once: a reload hears nothing");
        crate::windows::drop_parked_for("p-lc-b");
        assert_eq!(CRASHED.take("p-lc-b"), None, "a closed / switched tab keeps nothing");
    }

    /// Every clean way out clears the marker; the kill paths cannot and must not.
    #[test]
    fn every_clean_exit_path_clears_the_marker() {
        let lib = include_str!("lib.rs");
        let exit = &lib[lib.find("RunEvent::ExitRequested { .. } | RunEvent::Exit =>").unwrap()..];
        let exit = &exit[..exit.find("RunEvent::Reopen").unwrap()];
        assert!(exit.contains("lifecycle::clean_exit(app_handle)"));
        let sig = &lib[lib.find("fn install_signal_handler").unwrap()..];
        let sig = &sig[..sig.find("std::process::exit(0)").unwrap()];
        assert!(sig.contains("lifecycle::clean_exit(&handle)"));
        let up = include_str!("updater.rs");
        let up = &up[up.find("pub fn restart_to_update(").unwrap()..];
        let up = &up[..up.find("app.restart()").unwrap()];
        assert!(up.contains("lifecycle::clean_exit(&app)"));
        // The marker is written before the boot tabs and parked right after them.
        let setup = &lib[lib.find(".setup(|app|").unwrap()..];
        let start = setup.find("lifecycle::start(&handle)").unwrap();
        let boot = setup.find("windows::boot_windows(").unwrap();
        let after = setup.find("lifecycle::after_boot(&handle, crashed)").unwrap();
        assert!(start < boot && boot < after);
    }
}
