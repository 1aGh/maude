// Maude native shell — Tauri v2 entry (DDR-106).
//
// Lifecycle: spawn the compiled dev-server as a sidecar → poll `_server.json` for
// the port → navigate the webview to it → kill the sidecar on quit. Single-instance
// focuses the existing window instead of opening a second one.
//
// Quit is caught on three paths so the sidecar is never orphaned (DDR-106 lifecycle):
//   1. Window `CloseRequested` — the window's X button.
//   2. `RunEvent::ExitRequested` / `Exit` — Cmd+Q / app termination.
//   3. SIGTERM / SIGINT — `kill`, Ctrl+C, crash-via-signal.
// (SIGKILL is uncatchable and will orphan — unavoidable for any process; a relaunch
// detects the stale `_server.json` server.)

mod app_state;
mod crash_reporter;
mod deep_link;
mod keychain;
// issue #105 — WebKitGTK's GStreamer media path is the one part of the shell that
// can kill the renderer before the user sees a single pixel of their canvas.
#[cfg(target_os = "linux")]
mod linux_media;
mod menu;
mod notify;
mod oauth;
mod prefs;
mod project_resolve;
mod server_json;
mod sidecar;
mod updater;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Mutex;

use tauri::{Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_dialog::DialogExt;

use sidecar::SidecarState;

/// Cold-start timeout: first launch runs boot-self-heal (bun install + build), up
/// to ~90 s; give it headroom. Warm launches resolve in well under 2 s.
const SERVER_WAIT_MS: u64 = 120_000;

/// Resolve the project root to open. `MAUDE_PROJECT_ROOT` env override → last-used
/// project (if it still exists) → the minimal welcome project (first run). Phase-29
/// (E4): on first run we boot the welcome project so the webview can render the
/// OnboardingWizard over it (the client checks `app_is_first_run`).
fn resolve_project_root(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(p) = std::env::var("MAUDE_PROJECT_ROOT") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    if let Some(p) = app_state::last_project(app) {
        return p;
    }
    app_state::welcome_project(app)
}

/// Catch SIGTERM/SIGINT so an abrupt `kill`/Ctrl+C still tears the sidecar down.
/// One task per signal (avoids the `tokio` `macros` feature); whichever fires
/// first kills the sidecar and exits.
#[cfg(unix)]
fn install_signal_handler(handle: tauri::AppHandle) {
    use tokio::signal::unix::{signal, SignalKind};
    for kind in [SignalKind::terminate(), SignalKind::interrupt()] {
        let handle = handle.clone();
        tauri::async_runtime::spawn(async move {
            match signal(kind) {
                Ok(mut sig) => {
                    sig.recv().await;
                    // NOT `eprintln!`: it panics on a broken pipe, which is
                    // the normal state here — the launching terminal is
                    // usually gone by the time a signal arrives. Panicking
                    // inside the handler abandoned the sidecars this is about
                    // to kill. See `sidecar::log_shutdown`.
                    sidecar::log_shutdown("[maude] termination signal received — killing sidecar");
                    sidecar::kill_server(&handle);
                    std::process::exit(0);
                }
                Err(e) => {
                    sidecar::log_shutdown(&format!(
                        "[maude] could not install signal handler: {e}"
                    ));
                }
            }
        });
    }
}

/// Recovery poll budget for `resolve_dev_server_url`, deliberately far shorter
/// than `SERVER_WAIT_MS`: that constant is sized for a COLD start (first-run
/// `bun install` + build). A recovering splash is asking about a server that is
/// normally already up, so a long single wait would just delay the retry loop
/// on the page. The page retries, so a miss here is cheap.
const RECOVERY_WAIT_MS: u64 = 5_000;

/// Resolve the CURRENT project's dev-server URL for the boot splash to navigate
/// itself back to (#92).
///
/// `apps/desktop/src/index.html` is the webview's ENTRY document. WKWebView
/// returns to it on a content-process crash reload (WebKit reloads the window's
/// original URL) and on an uncaught back-navigation, and the startup navigate in
/// `setup()` is a one-shot — so before this command the app parked on
/// "Starting…" until the user force-quit.
///
/// SECURITY (DDR-109 §1): takes NO input from the page. The root comes from
/// `SidecarState` (so a project switch is respected) and the URL from that
/// project's own `_server.json`, validated loopback-only right here. The page
/// receives an already-validated `http://localhost:*` / `http://127.0.0.1:*`
/// string and can never steer the navigate — this is not an open-navigate
/// primitive, and must not become one.
#[tauri::command]
async fn resolve_dev_server_url(app: tauri::AppHandle) -> Result<String, String> {
    let project_root = {
        let state = app.state::<SidecarState>();
        let root = state.project_root.lock().expect("sidecar mutex poisoned").clone();
        PathBuf::from(root)
    };
    let url = server_json::wait_for_server(project_root.join(".design"), RECOVERY_WAIT_MS).await?;
    match url.parse::<tauri::Url>() {
        Ok(parsed) if server_json::is_loopback_url(&parsed) => Ok(parsed.to_string()),
        Ok(parsed) => Err(format!("refusing non-loopback url (DDR-109): {parsed}")),
        Err(e) => Err(format!("invalid server url {url}: {e}")),
    }
}

/// Native folder picker for "pull a local copy" — returns the chosen parent dir,
/// or `None` if the user cancelled. The clone lands in `<dir>/<repo-name>`.
#[tauri::command]
async fn pick_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    // E2E (debug builds only): a native folder picker can't be DOM-driven, so the
    // harness injects the chosen path via MAUDE_E2E_PICK_DIR instead of opening the OS
    // dialog. Gated on `debug_assertions`, so it is NEVER compiled into the release
    // `.app` (which has no WebDriver server either). See the `desktop-e2e` skill.
    #[cfg(debug_assertions)]
    if let Ok(p) = std::env::var("MAUDE_E2E_PICK_DIR") {
        if !p.is_empty() {
            return Ok(Some(p));
        }
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let path = folder
            .and_then(|f| f.into_path().ok())
            .map(|p| p.to_string_lossy().to_string());
        let _ = tx.send(path);
    });
    rx.await.map_err(|_| "Folder picker closed unexpectedly.".to_string())
}

/// Native "Save As…" for an export payload — opens a save dialog seeded with the
/// export's filename, then streams the finished job's bytes STRAIGHT FROM the
/// local dev-server to the chosen path over `reqwest`, and returns that path (or
/// `None` if the user cancelled). This is what makes native-app exports OFFER a
/// save location: the webview's `<a download>` blob path (app.jsx) is swallowed
/// opaquely by WKWebView, so the user never learns where the file landed.
/// RCA: issue-desktop-export-failures (original native-save mechanism).
///
/// RCA issue-desktop-print-pdf-save-as-hang-large-payload: this used to accept
/// the export's `bytes: Vec<u8>` as a plain `invoke()` argument — Tauri's IPC
/// JSON-serializes command arguments, so a print-ready PDF (hundreds of MB —
/// `page.pdf()` per artboard re-embeds full-size photos at print DPI with no
/// cross-page dedup, see `exporters/pdf.ts`) turned the JS-side
/// `Array.from(new Uint8Array(...))` + that JSON encode into an effectively
/// unbounded main-thread block. The "Saving…" button kept spinning (a pure-CSS
/// compositor animation, unaffected by a blocked JS thread) while the whole app
/// was actually frozen. Fetching the bytes IN Rust and streaming them straight to
/// disk means the webview never materializes or transmits the payload at all.
#[tauri::command]
async fn save_export(
    app: tauri::AppHandle,
    job_id: String,
    filename: String,
) -> Result<Option<String>, String> {
    let download_url = export_download_url(&app, &job_id)?;

    // E2E (debug builds only): a native save dialog can't be DOM-driven, so the
    // harness injects the destination via MAUDE_E2E_SAVE_PATH. Gated on
    // `debug_assertions` — never compiled into the release `.app`. Still runs
    // through the real fetch-and-stream path below (not a shortcut), so the E2E
    // scenario actually exercises this regression's fix.
    #[cfg(debug_assertions)]
    if let Ok(p) = std::env::var("MAUDE_E2E_SAVE_PATH") {
        if !p.is_empty() {
            stream_download_to_file(&download_url, std::path::Path::new(&p)).await?;
            return Ok(Some(p));
        }
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().set_file_name(&filename).save_file(move |dest| {
        let _ = tx.send(dest.and_then(|f| f.into_path().ok()));
    });
    let dest = rx.await.map_err(|_| "Save dialog closed unexpectedly.".to_string())?;
    match dest {
        Some(path) => {
            stream_download_to_file(&download_url, &path).await?;
            Ok(Some(path.to_string_lossy().to_string()))
        }
        None => Ok(None), // cancelled — not an error
    }
}

/// Resolve the `/_api/export-jobs/download` URL for `job_id` against the
/// currently-running dev-server sidecar (via `_server.json`). Validates the id
/// looks like the `crypto.randomUUID()` the server actually generates
/// (`exporters/jobs.ts`) before it's interpolated into a URL — defense in depth,
/// since this string arrives from the (trusted, main-origin-only) studio client
/// rather than the untrusted canvas iframe, but a Rust command has no other gate
/// of its own on what it's handed.
fn export_download_url(app: &tauri::AppHandle, job_id: &str) -> Result<String, String> {
    let looks_like_id = !job_id.is_empty()
        && job_id.len() <= 64
        && job_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !looks_like_id {
        return Err("Invalid export job id.".to_string());
    }
    let state = app.state::<SidecarState>();
    let project_root = state.project_root.lock().expect("sidecar mutex poisoned").clone();
    let design_root = PathBuf::from(project_root).join(".design");
    let base_url = server_json::read_server_url(&design_root)
        .ok_or_else(|| "Couldn't reach the local Maude server to fetch the export.".to_string())?;
    Ok(format!("{base_url}/_api/export-jobs/download?id={job_id}"))
}

/// Stream a finished export job's bytes from the dev-server straight to `dest`
/// in chunks, never materializing the whole payload in memory at once — a
/// print-ready PDF can be hundreds of MB (see `save_export`'s doc comment).
async fn stream_download_to_file(url: &str, dest: &std::path::Path) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("Couldn't reach the local Maude server: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("The export isn't ready to download ({}).", resp.status()));
    }
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("Couldn’t write the export: {e}"))?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Couldn't download the export: {e}"))?;
        file
            .write_all(&chunk)
            .await
            .map_err(|e| format!("Couldn’t write the export: {e}"))?;
    }
    Ok(())
}

/// Serialized picked-file payload for `pick_media_file`.
#[derive(serde::Serialize)]
struct PickedMedia {
    name: String,
    bytes: Vec<u8>,
}

/// Native "open file" for media upload — the READ counterpart to save_export.
/// WKWebView won't present a file panel for an HTML `<input type=file>` (dogfood:
/// "upload native okno nevyskoci v tauri"), so the AssetPicker routes through
/// this: opens an image/video open-dialog, reads the chosen file, and returns
/// `{ name, bytes }` (or `None` if cancelled). JS then POSTs the bytes to
/// `/_api/asset` — the same content-addressed, magic-byte-sniffed intake as a
/// drag-drop, so no trust is placed in the name/extension.
#[tauri::command]
async fn pick_media_file(app: tauri::AppHandle) -> Result<Option<PickedMedia>, String> {
    // E2E (debug builds only): a native open dialog can't be DOM-driven, so the
    // harness injects the source path via MAUDE_E2E_OPEN_PATH. Never in release.
    #[cfg(debug_assertions)]
    if let Ok(p) = std::env::var("MAUDE_E2E_OPEN_PATH") {
        if !p.is_empty() {
            let bytes = std::fs::read(&p).map_err(|e| format!("Couldn’t read the file: {e}"))?;
            let name = std::path::Path::new(&p)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("upload")
                .to_string();
            return Ok(Some(PickedMedia { name, bytes }));
        }
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter(
            "Media",
            &[
                "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "mp4", "webm", "mov", "m4v",
                "ogg",
            ],
        )
        .pick_file(move |picked| {
            let _ = tx.send(picked.and_then(|f| f.into_path().ok()));
        });
    let path = rx.await.map_err(|_| "Open dialog closed unexpectedly.".to_string())?;
    match path {
        Some(p) => {
            let bytes = std::fs::read(&p).map_err(|e| format!("Couldn’t read the file: {e}"))?;
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("upload")
                .to_string();
            Ok(Some(PickedMedia { name, bytes }))
        }
        None => Ok(None), // cancelled — not an error
    }
}

/// feature-bulk-media-insert — multi-select counterpart to `pick_media_file`.
/// Same read-and-return-bytes shape, `.pick_files()` (plural) instead of
/// `.pick_file()`. Returns an empty Vec on cancel (not an error) so the JS
/// side can treat "nothing picked" uniformly with an empty selection.
#[tauri::command]
async fn pick_media_files(app: tauri::AppHandle) -> Result<Vec<PickedMedia>, String> {
    // E2E (debug builds only): mirrors MAUDE_E2E_OPEN_PATH but plural —
    // comma-separated source paths, never read in a release build.
    #[cfg(debug_assertions)]
    if let Ok(p) = std::env::var("MAUDE_E2E_OPEN_PATHS") {
        if !p.is_empty() {
            let mut out = Vec::new();
            for part in p.split(',') {
                let part = part.trim();
                if part.is_empty() {
                    continue;
                }
                let bytes = std::fs::read(part).map_err(|e| format!("Couldn’t read the file: {e}"))?;
                let name = std::path::Path::new(part)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("upload")
                    .to_string();
                out.push(PickedMedia { name, bytes });
            }
            return Ok(out);
        }
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter(
            "Media",
            &[
                "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "mp4", "webm", "mov", "m4v",
                "ogg",
            ],
        )
        .pick_files(move |picked| {
            let _ = tx.send(picked.map(|files| {
                files
                    .into_iter()
                    .filter_map(|f| f.into_path().ok())
                    .collect::<Vec<_>>()
            }));
        });
    let paths = rx.await.map_err(|_| "Open dialog closed unexpectedly.".to_string())?;
    match paths {
        Some(paths) => {
            let mut out = Vec::with_capacity(paths.len());
            for p in paths {
                let bytes = std::fs::read(&p).map_err(|e| format!("Couldn’t read the file: {e}"))?;
                let name = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("upload")
                    .to_string();
                out.push(PickedMedia { name, bytes });
            }
            Ok(out)
        }
        None => Ok(Vec::new()), // cancelled — not an error
    }
}

/// Switch the app to a local project folder (the freshly cloned copy) — same
/// in-process switch as File ▸ Open Project (NOT app.restart()).
#[tauri::command]
fn open_local_project(app: tauri::AppHandle, path: String, open: Option<String>) -> Result<(), String> {
    let open = open.map(|value| project_resolve::validate_open_param(&value)
        .ok_or_else(|| "Invalid file address.".to_string())).transpose()?;
    let p = PathBuf::from(&path);
    if !p.is_dir() {
        return Err("That project folder doesn’t exist.".to_string());
    }
    // The dev-server fails loud on a project with no `.design/` (load-bearing,
    // CLAUDE.md). Refuse the switch HERE so a non-Maude folder shows a clear message
    // instead of crash-looping the sidecar (3 respawns → blank). The client also
    // pre-checks via the clone's `hasDesign`, but this guards every open path.
    if !p.join(".design").is_dir() {
        return Err("That folder isn’t a Maude project yet (no design system). Open it and run “Set up a design system” first.".to_string());
    }
    // Remember it as the last project (so a relaunch reopens it) + switch in-process.
    app_state::set_last_project(&app, &p);
    sidecar::switch_project(&app, p, open);
    Ok(())
}

/// Remember `path` as the last project (so a relaunch reopens it) + switch in-process.
fn remember_and_switch(app: &tauri::AppHandle, path: PathBuf) {
    app_state::set_last_project(app, &path);
    sidecar::switch_project(app, path, None);
}

/// Write a minimal bootable `.design/` into `dir` (mirrors apps/studio/scaffold-design.ts)
/// so a non-Maude folder opened via File ▸ Open Project can boot instead of crash-
/// looping. A real design system is created later via /design:setup-ds.
pub(crate) fn write_minimal_design(dir: &std::path::Path) -> std::io::Result<()> {
    let design = dir.join(".design");
    if design.join("config.json").exists() {
        return Ok(());
    }
    std::fs::create_dir_all(design.join("ui"))?;
    std::fs::create_dir_all(design.join("system"))?;
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".to_string());
    // `{name:?}` debug-formats the string with JSON-safe quoting/escaping.
    let config = format!(
        "{{\n  \"$schema\": \"https://raw.githubusercontent.com/1aGh/maude/main/apps/studio/config.schema.json\",\n  \"name\": {name:?},\n  \"designRoot\": \".design\",\n  \"canvasGroups\": [\n    {{ \"label\": \"Design system\", \"path\": \"system\" }},\n    {{ \"label\": \"UI kit\", \"path\": \"ui\" }}\n  ],\n  \"designSystems\": [],\n  \"completenessProfile\": \"standard\"\n}}\n"
    );
    std::fs::write(design.join("config.json"), config)?;
    std::fs::write(design.join("ui").join(".gitkeep"), "")?;
    std::fs::write(design.join("system").join(".gitkeep"), "")?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // FIRST, before anything spawns a thread or a webview: WebKit reads
    // WEBKIT_GST_DISABLE_GL_SINK in the WEB process, which inherits whatever
    // environment we hold at webview-creation time, and `set_var` is only sound
    // while we are still single-threaded. See linux_media.rs (issue #105).
    #[cfg(target_os = "linux")]
    linux_media::configure_env();

    let builder = tauri::Builder::default()
        // Single-instance MUST be registered first (DDR-106): a second launch
        // focuses the existing window rather than opening a duplicate.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Windows/Linux deliver a maude:// link by relaunching the binary
            // with the URL in argv — the running instance receives it here.
            for arg in &args {
                if arg.starts_with("maude://") {
                    deep_link::accept(app, arg);
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // Auto-update (Phase 32 / Task 1) — config (endpoints + pubkey) is in
        // tauri.conf.json; the check/download/install loop lives in updater.rs.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // feature-acp-turn-notifications — real OS notifications. Only our own
        // narrow `send_notification` command is exposed to the webview (see notify.rs's
        // doc comment on why: same "trusted core, narrow command" posture as
        // the updater plugin above) — the plugin's own JS API is never used.
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            oauth::github_sign_in,
            oauth::github_open_verification,
            oauth::open_github_url,
            oauth::open_cloud_url,
            keychain::github_is_signed_in,
            keychain::github_sign_out,
            pick_directory,
            resolve_dev_server_url,
            save_export,
            pick_media_file,
            pick_media_files,
            open_local_project,
            app_state::app_is_first_run,
            app_state::app_get_last_project,
            app_state::app_set_last_project,
            app_state::app_recent_projects,
            updater::restart_to_update,
            prefs::prefs_get_crash_reporting,
            prefs::prefs_set_crash_reporting,
            prefs::prefs_get_claude_auto_setup,
            prefs::prefs_set_claude_auto_setup,
            crash_reporter::list_crash_logs,
            crash_reporter::read_crash_log,
            deep_link::take_pending_deep_link,
            project_resolve::resolve_project_for_link,
            notify::send_notification,
        ])
        .menu(menu::build_menu)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == menu::MENU_NEW_PROJECT {
                // File ▸ New Project… — hand off to the webview, which owns the
                // create-project dialog (name + visibility → POST create-project →
                // git init + design scaffold → open). IdentityBar listens for this.
                let _ = app.emit("menu://new-project", ());
                return;
            }
            if event.id().as_ref() == menu::MENU_REPORT_BUG {
                // Help ▸ Report a Bug… — hand off to the webview's dialog, which
                // owns capture + consent (feature-bug-report-button).
                let _ = app.emit("menu://report-bug", ());
                return;
            }
            if event.id().as_ref() == menu::MENU_CHECK_UPDATES {
                // Maude ▸ Check for Updates… — force a check now with explicit
                // dialog feedback (the background loop is otherwise silent).
                updater::check_now_interactive(app.clone());
                return;
            }
            if event.id().as_ref() == menu::MENU_OPEN_PROJECT {
                let app = app.clone();
                // Pick a project folder, remember it, and relaunch pointed at it.
                // (The richer in-window project switcher is phase-29.)
                app.dialog().file().pick_folder(move |folder| {
                    let Some(folder) = folder else { return };
                    let Some(path) = folder.as_path().map(|p| p.to_path_buf()) else { return };
                    // Switch in-process — NOT app.restart() (relaunch aborts tao's
                    // did_finish_launching on the non-bundled dev binary).
                    if path.join(".design").is_dir() {
                        remember_and_switch(&app, path);
                        return;
                    }
                    // Not a Maude project yet — ASK before setting one up (the user's
                    // requested fallback), instead of crash-looping on a no-.design root.
                    let app2 = app.clone();
                    let name = path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    app.dialog()
                        .message(format!(
                            "“{name}” isn’t a Maude project yet. Set up a Maude project here so you can start designing?"
                        ))
                        .title("Set up Maude")
                        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
                            "Set it up".to_string(),
                            "Cancel".to_string(),
                        ))
                        .show(move |ok| {
                            if ok && write_minimal_design(&path).is_ok() {
                                remember_and_switch(&app2, path);
                            }
                        });
                });
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // Crash reporting (Phase 32 / Task 4) — prime the opt-in toggle from
            // prefs.json and install the panic hook FIRST, so a panic anywhere in
            // setup is caught (and, only if opted in, written to a local file).
            prefs::init(&handle);
            crash_reporter::install(&handle);

            // issue #105 — a canvas with audio/video hard-aborts the web process
            // when no GStreamer audio sink is registered, and the user sees only
            // a blank view. Say it out loud instead. Best-effort, non-blocking,
            // and a no-op on a machine whose media stack is complete.
            #[cfg(target_os = "linux")]
            linux_media::warn_if_incomplete(&handle);

            // maude:// links (Phase 17). macOS delivers through the plugin;
            // the state is parked until the client asks for it.
            app.manage(deep_link::PendingDeepLink::default());
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let dl_handle = handle.clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        deep_link::accept(&dl_handle, url.as_str());
                    }
                });
            }

            let project_root = resolve_project_root(&handle);
            eprintln!("[maude] project root: {}", project_root.display());

            app.manage(SidecarState {
                // Task 10 — a POOL, not a single child: switching projects now
                // leaves the origin project's server (and its running chats)
                // alive instead of killing it. See sidecar.rs's SidecarInstance.
                instances: Mutex::new(std::collections::HashMap::new()),
                shutting_down: AtomicBool::new(false),
                project_root: Mutex::new(project_root.to_string_lossy().to_string()),
                tick: AtomicU64::new(0),
            });

            // Clear any stale `_server.json` from a previous session BEFORE spawning,
            // so `wait_for_server` blocks on THIS run's fresh (post-bind) write. Without
            // this the webview navigates to the old port before the new server binds →
            // connection refused → intermittent white screen.
            let design_root = project_root.join(".design");
            let _ = std::fs::remove_file(design_root.join("_server.json"));

            // 0. Start the loopback GitHub-token bridge BEFORE spawning the sidecar,
            // so its endpoint+key are available to pass to the child (DDR-108).
            if let Err(e) = keychain::start_token_bridge() {
                eprintln!("[maude] WARN: token bridge did not start (GitHub features disabled): {e}");
            }

            // 1. Spawn the dev-server sidecar.
            if let Err(e) = sidecar::spawn_server(&handle) {
                eprintln!("[maude] FATAL: could not spawn dev-server: {e}");
            }

            // 2. Poll `_server.json`, then navigate the webview to the server URL.
            let nav_handle = handle.clone();
            // Panic-free prints (issue #115). This task is the ONLY thing that
            // points the webview at the dev-server on boot, and a `.app` opened
            // from Finder or the Dock normally has an unwritable stderr — an
            // `eprintln!` here would panic the task and leave a blank window.
            tauri::async_runtime::spawn(async move {
                match server_json::wait_for_server(design_root, SERVER_WAIT_MS).await {
                    Ok(url) => {
                        sidecar::log_line(&format!(
                            "[maude] dev-server ready at {url} — navigating webview"
                        ));
                        if let Some(window) = nav_handle.get_webview_window("main") {
                            match url.parse::<tauri::Url>() {
                                Ok(parsed) if server_json::is_loopback_url(&parsed) => {
                                    if let Err(e) = window.navigate(parsed) {
                                        sidecar::log_line(&format!("[maude] navigate failed: {e}"));
                                    }
                                }
                                Ok(parsed) => sidecar::log_line(&format!(
                                    "[maude] refusing non-loopback navigate (DDR-109): {parsed}"
                                )),
                                Err(e) => sidecar::log_line(&format!(
                                    "[maude] invalid server url {url}: {e}"
                                )),
                            }
                        }
                    }
                    Err(e) => {
                        sidecar::log_line(&format!("[maude] dev-server did not come up: {e}"))
                    }
                }
            });

            // 3. SIGTERM/SIGINT → kill sidecar + exit.
            #[cfg(unix)]
            install_signal_handler(handle.clone());

            // 4. Background auto-update (Phase 32 / Task 1): initial check after a
            // short delay, then every 4 h. On-focus checks are wired in
            // `on_window_event` below. No-op on a dev / unbundled build.
            updater::spawn_update_loop(handle.clone());

            // 5. feature-acp-turn-notifications — poll every NON-current pooled
            // instance and fire on a state transition. Started after
            // `SidecarState` is managed (above) since it reads the pool.
            notify::spawn_activity_poller(&handle);

            // The bundled app parks maude:// links; the client validates and
            // opens a file locally or asks before a project switch.

            Ok(())
        })
        // Kill the sidecar when the main window is closed (X button); check for
        // updates whenever the window regains focus (Phase 32 / Task 1).
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { .. } => {
                sidecar::kill_server(window.app_handle());
            }
            WindowEvent::Focused(true) => {
                updater::check_now(window.app_handle().clone());
            }
            _ => {}
        });

    // Desktop E2E (DOM-driven scenario tests via @wdio/tauri-service): register the
    // embedded W3C WebDriver server LAST and ONLY in debug builds. `debug_assertions`
    // is on for `tauri dev` AND `tauri build --debug` (the e2e test bundle) but OFF
    // for the shipped release, so the production `.app` never starts a WebDriver
    // server. Registered after single-instance so DDR-106's focus behavior is
    // unaffected. See the `desktop-e2e` skill + the harness in apps/desktop/e2e/.
    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Kill the sidecar on Cmd+Q / app termination.
    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
            sidecar::kill_server(app_handle);
        }
    });
}
