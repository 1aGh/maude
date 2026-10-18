// updater.rs — background auto-update (Phase 32 / Task 1).
//
// Polls the signed JSON release feed (endpoint + ed25519 pubkey in
// tauri.conf.json → plugins.updater), downloads + stages a newer build silently
// in the background, then emits `update-ready` to the webview so the client can
// show a non-blocking "Maude updated · Restart to apply" banner. The user applies
// it by clicking "Restart now" (→ `restart_to_update`), which kills the sidecar
// and relaunches into the swapped bundle.
//
// Why drive this from Rust instead of the @tauri-apps/plugin-updater JS API: the
// webview loads the dev-server UI from a REMOTE (loopback http://) origin. Letting
// that origin invoke the updater plugin would mean granting `updater:default` to
// remote content (it could trigger an install). Instead we keep all updater calls
// in the trusted Rust core and expose only the narrow `restart_to_update` command
// plus `check_for_updates` (V2-4.7c, Settings › Advanced) — the menu's own check,
// no arguments, throttled.
//
// Cadence: an initial check shortly after boot, on every window focus, and every
// 4 h. Checks never block the UI and failures are logged, not fatal (a dev / un-
// bundled build has nothing to install — that's expected and quiet).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

/// 4 hours between background checks (plus on-focus + boot).
const CHECK_INTERVAL_SECS: u64 = 4 * 60 * 60;
/// Let the sidecar + webview settle before the first check.
const INITIAL_DELAY_SECS: u64 = 15;

/// Set true only after an update has actually been downloaded + staged. The
/// `restart_to_update` command is a no-op until this flips, so a forged/injected
/// call from the (CSP-less, DDR-109-F2) main origin can't loop-restart the app —
/// you can only "restart to update" when there genuinely IS a staged update.
static UPDATE_STAGED: AtomicBool = AtomicBool::new(false);

/// V2-4.7c: a page may ask for an interactive check at most this often. Each
/// interactive check can end in a native dialog, so a forged call loop from the
/// main origin could otherwise stack dialogs; a person clicking twice loses nothing.
const PAGE_CHECK_COOLDOWN: Duration = Duration::from_secs(10);
static LAST_PAGE_CHECK: Mutex<Option<Instant>> = Mutex::new(None);

/// Whether a page-requested check may start now (pure; `check_for_updates` records `now`).
fn page_check_allowed(last: Option<Instant>, now: Instant) -> bool {
    last.is_none_or(|t| now.saturating_duration_since(t) >= PAGE_CHECK_COOLDOWN)
}

/// Payload for the `update-ready` event the client banner listens for.
#[derive(Clone, Serialize)]
struct UpdateReady {
    version: String,
    notes: Option<String>,
}

/// Spawn the background check loop: initial check after a short delay, then every
/// `CHECK_INTERVAL_SECS`. Call once from `setup`.
pub fn spawn_update_loop(handle: AppHandle) {
    // Never auto-update a dev build: `tauri dev` is how in-flight worktree
    // changes get dogfooded, and the silent loop was replacing the dev app
    // with the released version MID-TEST (2026-07-30). The explicit
    // "Check for Updates…" menu path stays available in debug.
    if cfg!(debug_assertions) {
        eprintln!("[maude] debug build — background auto-update disabled");
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(INITIAL_DELAY_SECS)).await;
        let mut ticker = tokio::time::interval(Duration::from_secs(CHECK_INTERVAL_SECS));
        loop {
            check_and_apply(&handle, false).await;
            ticker.tick().await;
        }
    });
}

/// One-shot check (used on window focus). Safe to call concurrently with the loop —
/// the updater plugin no-ops a second in-flight check.
pub fn check_now(handle: AppHandle) {
    if cfg!(debug_assertions) {
        return; // silent focus-check — same dev-build guard as the loop
    }
    tauri::async_runtime::spawn(async move {
        check_and_apply(&handle, false).await;
    });
}

/// One-shot check the user triggered from the Maude ▸ Check for Updates… menu.
/// Unlike the silent background/focus checks, this surfaces the two otherwise-
/// invisible outcomes via a native dialog: "you're up to date" and "check failed".
/// A found update still flows through the normal download → `update-ready` banner.
pub fn check_now_interactive(handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        check_and_apply(&handle, true).await;
    });
}

/// Webview → shell (V2-4.7c): Settings › Advanced › Check for updates. The SAME
/// path as Maude ▸ Check for Updates… (`check_now_interactive`): the signed feed
/// from tauri.conf.json, the same dialogs, the same `update-ready` broadcast.
/// Takes no input — no URL, no path, no channel — and only a project page may call it.
#[tauri::command]
pub fn check_for_updates(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    crate::windows::caller_project(&webview, false)?;
    {
        let mut last = LAST_PAGE_CHECK
            .lock()
            .map_err(|_| "updater state poisoned".to_string())?;
        let now = Instant::now();
        if !page_check_allowed(*last, now) {
            eprintln!("[maude] check_for_updates ignored — a check ran moments ago");
            return Ok(());
        }
        *last = Some(now);
    }
    check_now_interactive(app);
    Ok(())
}

/// `interactive` = the user asked for this check (menu), so give explicit feedback
/// on the up-to-date + error paths. Background/focus checks pass `false` and stay quiet.
async fn check_and_apply(handle: &AppHandle, interactive: bool) {
    let updater = match handle.updater() {
        Ok(u) => u,
        Err(e) => {
            eprintln!("[maude] updater unavailable: {e}");
            if interactive {
                notify_check_failed(handle, &e.to_string());
            }
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            let notes = update.body.clone();
            eprintln!("[maude] update available: {version} — downloading in background");
            // download_and_install stages the new bundle (macOS swaps the .app, Windows
            // runs the signed installer). The running process keeps going until restart.
            let result = update
                .download_and_install(
                    |_chunk, _total| {},
                    || eprintln!("[maude] update downloaded — staged for restart"),
                )
                .await;
            match result {
                Ok(()) => {
                    UPDATE_STAGED.store(true, Ordering::Relaxed);
                    // Every page, each through its own channel (bus.rs, finding 1d).
                    crate::bus::broadcast("update-ready", UpdateReady { version, notes });
                }
                Err(e) => {
                    eprintln!("[maude] update download/install failed: {e}");
                    // Unlike the sibling Ok(None)/Err(check) branches below, this used to
                    // swallow the failure — a manual click that finds an update but can't
                    // install it looked identical to a click that did nothing at all.
                    if interactive {
                        handle
                            .dialog()
                            .message(format!(
                                "Found Maude {version}, but couldn’t install it.\n\n{e}"
                            ))
                            .title("Update failed")
                            .kind(MessageDialogKind::Error)
                            .show(|_| {});
                    }
                }
            }
        }
        Ok(None) => {
            // Quiet for background checks; for a manual check the user expects
            // feedback that the click did something. Linux .deb builds have no
            // updater artifact, so `None` there does not verify currency.
            if interactive {
                handle
                    .dialog()
                    .message(up_to_date_message(
                        std::env::consts::OS,
                        env!("CARGO_PKG_VERSION"),
                    ))
                    .title(up_to_date_title(std::env::consts::OS))
                    .kind(MessageDialogKind::Info)
                    .show(|_| {});
            }
        }
        Err(e) => {
            eprintln!("[maude] update check failed: {e}");
            if interactive {
                notify_check_failed(handle, &e.to_string());
            }
        }
    }
}

/// Copy for an interactive check that did not find an updater artifact.
///
/// Linux ships as a `.deb`, not an AppImage updater target (see
/// `build-desktop.yml`), so the updater's `None` response cannot establish that
/// the installed version is current.
fn up_to_date_message(os: &str, running_version: &str) -> String {
    if os == "linux" {
        "Automatic updates aren’t available for this Linux installation. Check the Maude releases page for a newer .deb."
            .to_owned()
    } else {
        format!("Maude {running_version} is the latest version.")
    }
}

fn up_to_date_title(os: &str) -> &'static str {
    if os == "linux" {
        "Update information"
    } else {
        "You’re up to date"
    }
}

/// Native error dialog for a manual check that couldn't reach / verify the feed.
fn notify_check_failed(handle: &AppHandle, err: &str) {
    handle
        .dialog()
        .message(format!("Couldn’t check for updates.\n\n{err}"))
        .title("Update check failed")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

/// Webview → shell: apply the staged update by relaunching. Tears the sidecar down
/// first (mirrors the quit paths) so the relaunched app gets a fresh dev-server.
///
/// Guarded: a no-op unless an update was genuinely downloaded + staged. Without this
/// a forged/injected call from the main origin (which has no CSP yet — DDR-109 F2)
/// could loop-restart the app as a DoS. With it, the worst an injected call can do is
/// nothing.
#[tauri::command]
pub fn restart_to_update(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    crate::windows::caller_project(&webview, false)?;
    if !UPDATE_STAGED.load(Ordering::Relaxed) {
        eprintln!("[maude] restart_to_update ignored — no update staged");
        return Ok(());
    }
    eprintln!("[maude] restart_to_update — killing sidecar and relaunching into the update");
    crate::sidecar::kill_server(&app);
    // S11.16: an update restart is a clean quit, not a crash.
    crate::lifecycle::clean_exit(&app);
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::{page_check_allowed, up_to_date_message, up_to_date_title, PAGE_CHECK_COOLDOWN};
    use std::time::{Duration, Instant};

    #[test]
    fn a_page_check_runs_first_time_and_again_only_after_the_cooldown() {
        let t0 = Instant::now();
        assert!(page_check_allowed(None, t0));
        assert!(!page_check_allowed(Some(t0), t0));
        assert!(!page_check_allowed(Some(t0), t0 + Duration::from_secs(3)));
        assert!(page_check_allowed(Some(t0), t0 + PAGE_CHECK_COOLDOWN));
    }

    #[test]
    fn linux_manual_check_explains_that_automatic_updates_are_unavailable() {
        assert_eq!(
            up_to_date_message("linux", "1.0.11"),
            "Automatic updates aren’t available for this Linux installation. Check the Maude releases page for a newer .deb."
        );
    }

    #[test]
    fn supported_updater_targets_keep_the_latest_version_confirmation() {
        assert_eq!(
            up_to_date_message("darwin", "1.0.11"),
            "Maude 1.0.11 is the latest version."
        );
    }

    #[test]
    fn linux_manual_check_does_not_use_an_up_to_date_title() {
        assert_eq!(up_to_date_title("linux"), "Update information");
    }
}
