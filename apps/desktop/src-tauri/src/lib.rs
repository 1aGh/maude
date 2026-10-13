// Maude native shell — Tauri v2 entry (DDR-106).
//
// Lifecycle: spawn the compiled dev-server as a sidecar → poll `_server.json` for
// the port → navigate the webview to it → kill the sidecar on quit. Single-instance
// focuses the existing window instead of opening a second one.
//
// Windows (V2-3.2, contract V2-1.1 §5.2): Rust creates every window — one per
// open project, label `p-<pid>`, all in one macOS tab group (windows.rs). There
// is no `"main"` window. Closing a window stops ONLY its project's server, after
// a 10 s grace; closing the last one leaves the app running on macOS.
//
// Quit is caught on two paths so no sidecar is orphaned (DDR-106 lifecycle):
//   1. `RunEvent::ExitRequested` / `Exit` — Cmd+Q / app termination.
//   2. SIGTERM / SIGINT — `kill`, Ctrl+C, crash-via-signal.
// (SIGKILL is uncatchable and will orphan — unavoidable for any process; a relaunch
// detects the stale `_server.json` server.)

mod app_state;
mod crash_reporter;
mod deep_link;
mod home;
mod keychain;
// issue #105 — WebKitGTK's GStreamer media path is the one part of the shell that
// can kill the renderer before the user sees a single pixel of their canvas.
#[cfg(target_os = "linux")]
mod linux_media;
mod managed;
mod menu;
mod notify;
mod oauth;
mod picked_media;
mod prefs;
mod profiles;
mod project_resolve;
mod server_json;
mod sidecar;
mod updater;
mod win_process;
mod windows;
// WKWebView-only: recover from a crashed web content process instead of a white window.
#[cfg(any(target_os = "macos", target_os = "ios"))]
mod web_process;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Mutex;

use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_dialog::DialogExt;

use sidecar::SidecarState;

/// What a launch opens (V2-3.3, contract V2-1.1 §5.3 "Boot" / decision 2).
#[derive(Debug, PartialEq)]
enum BootPlan {
    /// Only this project's window (no Home window at boot; ⌘T still opens it).
    Project(PathBuf),
    /// The Home window first; then, as a tab after it, the last project.
    /// SEAM (Home restore): V2-3.2 part b replaces `reopen` with the full
    /// `session.tabs` restore.
    Home { reopen: Option<PathBuf> },
}

/// Pure half of the boot decision:
///   - `MAUDE_PROJECT_ROOT` (e2e lanes, a power user launching at a known
///     project): the app was told what to open — that project, first window.
///   - `MAUDE_FORCE_ONBOARDING` (debug builds only): the welcome project, so
///     the onboarding lane can still drive the OnboardingWizard.
///   - otherwise Home — first launch included (no welcome-project sidecar).
fn boot_plan(
    env_root: Option<PathBuf>,
    force_onboarding: bool,
    last: Option<PathBuf>,
    welcome: impl FnOnce() -> PathBuf,
) -> BootPlan {
    if let Some(root) = env_root {
        return BootPlan::Project(root);
    }
    if force_onboarding {
        return BootPlan::Project(welcome());
    }
    BootPlan::Home { reopen: last }
}

fn resolve_boot_plan(app: &tauri::AppHandle) -> BootPlan {
    let env_root = std::env::var("MAUDE_PROJECT_ROOT")
        .ok()
        .filter(|p| !p.is_empty())
        .map(PathBuf::from);
    #[cfg(debug_assertions)]
    let force_onboarding = std::env::var("MAUDE_FORCE_ONBOARDING").is_ok_and(|v| !v.is_empty());
    #[cfg(not(debug_assertions))]
    let force_onboarding = false;
    let last = app_state::last_project(app).filter(|p| p.join(".design").is_dir());
    boot_plan(env_root, force_onboarding, last, || app_state::welcome_project(app))
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
                    home::kill(&handle);
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
/// than `windows::SERVER_WAIT_MS`: that constant is sized for a COLD start (first-run
/// `bun install` + build). A recovering splash is asking about a server that is
/// normally already up, so a long single wait would just delay the retry loop
/// on the page. The page retries, so a miss here is cheap.
const RECOVERY_WAIT_MS: u64 = 5_000;

/// Resolve the CALLING window's project dev-server URL for its splash to
/// navigate itself back to (#92; per window since V2-3.2, contract §5.2
/// "Splash states").
///
/// `apps/desktop/src/index.html` is the webview's ENTRY document. WKWebView
/// returns to it on a content-process crash reload (WebKit reloads the window's
/// original URL) and on an uncaught back-navigation, and the startup navigate in
/// `setup()` is a one-shot — so before this command the app parked on
/// "Starting…" until the user force-quit.
///
/// SECURITY (DDR-109 §1): takes NO input from the page. The root comes from the
/// calling window's role in `SidecarState.windows` (so an in-tab switch is
/// respected) and the URL from that project's own `_server.json`, validated
/// loopback-only right here. The page
/// receives an already-validated `http://localhost:*` / `http://127.0.0.1:*`
/// string and can never steer the navigate — this is not an open-navigate
/// primitive, and must not become one.
#[tauri::command]
async fn resolve_dev_server_url(webview: tauri::Webview) -> Result<String, String> {
    // The Home window's splash answers the Home origin (V2-3.3, §5.2 "Splash
    // states"): from the app-local splash or Home itself, never a `p-*` label.
    if webview.label() == windows::HOME_LABEL {
        home::caller_home(&webview, true)?;
        return home::wait_home_url(webview.app_handle(), std::time::Duration::from_millis(RECOVERY_WAIT_MS)).await;
    }
    // The splash runs on the app-local origin; a page already on its server
    // may ask too (a reload). SEAM (V2-3.2 part b): a resting window answers
    // `{ resting: true, name }` here.
    let project_root = PathBuf::from(windows::caller_project(&webview, true)?.root);
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
async fn pick_directory(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<Option<String>, String> {
    windows::caller_project(&webview, false)?;
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
    // Parented to the calling window, so the sheet lands on the tab that asked.
    app.dialog().file().set_parent(&webview.window()).pick_folder(move |folder| {
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
    webview: tauri::Webview,
    job_id: String,
    filename: String,
) -> Result<Option<String>, String> {
    // The CALLING window's project (V2-3.2): with two tabs, an export from tab
    // B must download from B's server, not from whichever tab is in front.
    let caller = windows::caller_project(&webview, false)?;
    let download_url = export_download_url(&caller.root, &job_id)?;

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
    app.dialog()
        .file()
        .set_parent(&webview.window())
        .set_file_name(&filename)
        .save_file(move |dest| {
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

/// Resolve the `/_api/export-jobs/download` URL for `job_id` against `root`'s
/// running dev-server sidecar (via `_server.json`). Validates the id
/// looks like the `crypto.randomUUID()` the server actually generates
/// (`exporters/jobs.ts`) before it's interpolated into a URL — defense in depth,
/// since this string arrives from the (trusted, main-origin-only) studio client
/// rather than the untrusted canvas iframe, but a Rust command has no other gate
/// of its own on what it's handed.
fn export_download_url(project_root: &str, job_id: &str) -> Result<String, String> {
    let looks_like_id = !job_id.is_empty()
        && job_id.len() <= 64
        && job_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !looks_like_id {
        return Err("Invalid export job id.".to_string());
    }
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

/// Native "open file" for media upload — the READ counterpart to save_export.
/// WKWebView won't present a file panel for an HTML `<input type=file>` (dogfood:
/// "upload native okno nevyskoci v tauri"), so the AssetPicker routes through
/// this: opens an image/video open-dialog and returns `{ token, name, size }`
/// (or `None` if cancelled). The page then reads the file in slices through
/// `read_picked_media` and POSTs them to `/_api/asset*` — the same
/// content-addressed, magic-byte-sniffed intake as a drag-drop, so no trust is
/// placed in the name/extension. See picked_media.rs for why it is not bytes.
#[tauri::command]
async fn pick_media_file(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    registry: tauri::State<'_, picked_media::PickedMediaRegistry>,
) -> Result<Option<picked_media::PickedMediaRef>, String> {
    windows::caller_project(&webview, false)?;
    // E2E (debug builds only): a native open dialog can't be DOM-driven, so the
    // harness injects the source path via MAUDE_E2E_OPEN_PATH. Never in release.
    #[cfg(debug_assertions)]
    if let Ok(p) = std::env::var("MAUDE_E2E_OPEN_PATH") {
        if !p.is_empty() {
            return registry.register(PathBuf::from(p)).map(Some);
        }
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_parent(&webview.window())
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
        Some(p) => registry.register(p).map(Some),
        None => Ok(None), // cancelled — not an error
    }
}

/// feature-bulk-media-insert — multi-select counterpart to `pick_media_file`.
/// Same `{ token, name, size }` shape, `.pick_files()` (plural) instead of
/// `.pick_file()`. Returns an empty Vec on cancel (not an error) so the JS
/// side can treat "nothing picked" uniformly with an empty selection.
#[tauri::command]
async fn pick_media_files(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    registry: tauri::State<'_, picked_media::PickedMediaRegistry>,
) -> Result<Vec<picked_media::PickedMediaRef>, String> {
    windows::caller_project(&webview, false)?;
    // E2E (debug builds only): mirrors MAUDE_E2E_OPEN_PATH but plural —
    // comma-separated source paths, never read in a release build.
    #[cfg(debug_assertions)]
    if let Ok(p) = std::env::var("MAUDE_E2E_OPEN_PATHS") {
        if !p.is_empty() {
            return p
                .split(',')
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .map(|part| registry.register(PathBuf::from(part)))
                .collect();
        }
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_parent(&webview.window())
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
        Some(paths) => paths.into_iter().map(|p| registry.register(p)).collect(),
        None => Ok(Vec::new()), // cancelled — not an error
    }
}

/// Switch the CALLING window to a local project folder (the freshly cloned
/// copy, a repo-switcher row, an onboarding door) — in-tab, in-process (NOT
/// app.restart()). If another tab already shows it, that tab is focused instead
/// (open once, V2-1.1 decision 3).
#[tauri::command]
fn open_local_project(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    path: String,
    open: Option<String>,
) -> Result<(), String> {
    let caller = windows::caller_project(&webview, false)?;
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
    sidecar::switch_project(&app, &caller.label, p, open);
    Ok(())
}

/// File ▸ Open Project… (⌘O): remember `path` as the last project and open it
/// as a new tab after the front window — or focus its tab if it is already
/// open (V2-1.1 decision 3). Off the main thread: the menu callback runs there,
/// and building a window waits on it.
fn remember_and_open(app: &tauri::AppHandle, path: PathBuf, caller: Option<String>) {
    app_state::set_last_project(app, &path);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match windows::open_project_window(&app, &path, caller.as_deref(), None) {
            // A pick made from Home replaces the Home tab (V2-1.1 decision 3).
            Ok(opened) if caller.as_deref() == Some(windows::HOME_LABEL) => {
                home::close_home_when_key(&app, opened.label());
            }
            Ok(_) => {}
            Err(e) => sidecar::log_line(&format!("[maude] could not open {}: {e}", path.display())),
        }
    });
}

/// Open project… (⌘O, Home's "Open a folder"): the folder picker, then open it
/// as a tab after `caller` (`None` ⇒ the front window); a folder without
/// `.design/` asks "Set it up?" first instead of crash-looping its server.
fn pick_and_open_folder(app: &tauri::AppHandle, caller: Option<String>) {
    let app = app.clone();
    app.dialog().file().pick_folder(move |folder| {
        let Some(folder) = folder else { return };
        let Some(path) = folder.as_path().map(|p| p.to_path_buf()) else { return };
        // Switch in-process — NOT app.restart() (relaunch aborts tao's
        // did_finish_launching on the non-bundled dev binary).
        if path.join(".design").is_dir() {
            remember_and_open(&app, path, caller);
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
                    remember_and_open(&app2, path, caller);
                }
            });
    });
}

/// `open_project_folder()` (§5.4) — the File-menu flow, for Home or a project
/// window; the new tab goes after the caller.
#[tauri::command]
async fn open_project_folder(app: tauri::AppHandle, webview: tauri::Webview) -> Result<(), String> {
    windows::caller_any(&webview, false)?;
    pick_and_open_folder(&app, Some(webview.label().to_string()));
    Ok(())
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
            windows::reveal_front(app);
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
            picked_media::read_picked_media,
            picked_media::release_picked_media,
            open_local_project,
            windows::open_project,
            windows::e2e_open_root,
            open_project_folder,
            home::shell_state,
            home::new_home_tab,
            home::take_pending_intent,
            home::index_search,
            home::relink_project,
            windows::window_labels,
            windows::e2e_focus_window,
            windows::e2e_close_window,
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
            managed::managed_project_open,
            managed::managed_projects_list,
            profiles::profiles_list,
            profiles::profiles_create,
            profiles::profiles_delete,
        ])
        .menu(menu::build_menu)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == menu::MENU_NEW_PROJECT {
                // File ▸ New Project… — hand off to the webview, which owns the
                // create-project dialog (name + visibility → POST create-project →
                // git init + design scaffold → open). IdentityBar listens for this.
                windows::emit_to_front(app, "menu://new-project", ());
                return;
            }
            if event.id().as_ref() == menu::MENU_REPORT_BUG {
                // Help ▸ Report a Bug… — hand off to the webview's dialog, which
                // owns capture + consent (feature-bug-report-button).
                windows::emit_to_front(app, "menu://report-bug", ());
                return;
            }
            if event.id().as_ref() == menu::MENU_CHECK_UPDATES {
                // Maude ▸ Check for Updates… — force a check now with explicit
                // dialog feedback (the background loop is otherwise silent).
                updater::check_now_interactive(app.clone());
                return;
            }
            if event.id().as_ref() == menu::MENU_OPEN_PROJECT {
                pick_and_open_folder(app, None);
                return;
            }
            // File › New Home Tab ⌘T / Back to Home (V2-3.3). The item itself comes
            // from the action registry (`home.open` → menu.actions.json, lead-owned);
            // until it lands this arm is unreachable.
            if event.id().as_ref() == "new_home_tab" {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = home::ensure_home_window(&app, None) {
                        sidecar::log_line(&format!("[maude] could not open Home: {e}"));
                    }
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
            app.manage(picked_media::PickedMediaRegistry::default());
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let dl_handle = handle.clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        deep_link::accept(&dl_handle, url.as_str());
                    }
                });
            }

            let plan = resolve_boot_plan(&handle);
            sidecar::log_line(&format!("[maude] boot: {plan:?}"));

            app.manage(SidecarState {
                // Task 10 — a POOL, not a single child: switching projects now
                // leaves the origin project's server (and its running chats)
                // alive instead of killing it. See sidecar.rs's SidecarInstance.
                instances: Mutex::new(std::collections::HashMap::new()),
                shutting_down: AtomicBool::new(false),
                windows: Mutex::new(windows::WindowBook::default()),
                tick: AtomicU64::new(0),
                home: Mutex::new(None),
            });

            // Clear any stale `_server.json` from a previous session BEFORE spawning,
            // so `wait_for_server` blocks on THIS run's fresh (post-bind) write. Without
            // this the webview navigates to the old port before the new server binds →
            // connection refused → intermittent white screen. (`attach_or_spawn`
            // removes it again on its spawn path; this keeps the boot ordering explicit.)
            let boot_root = match &plan {
                BootPlan::Project(root) => Some(root.clone()),
                BootPlan::Home { reopen } => reopen.clone(),
            };
            if let Some(root) = &boot_root {
                let _ = std::fs::remove_file(root.join(".design").join("_server.json"));
            }

            // 0. Start the loopback GitHub-token bridge BEFORE spawning the sidecar,
            // so its endpoint+key are available to pass to the child (DDR-108).
            if let Err(e) = keychain::start_token_bridge() {
                sidecar::log_line(&format!(
                    "[maude] WARN: token bridge did not start (GitHub features disabled): {e}"
                ));
            }

            // 1. The Home server, before any project (V2-1.1 decision 1). Its
            // window navigates once its app-owned info file names it.
            if let Err(e) = home::spawn_home(&handle) {
                sidecar::log_line(&format!("[maude] could not start Home: {e}"));
            }

            // 2. The boot windows. `tauri.conf.json` declares NO window; every
            // one is built by the path later tabs take (splash, then the
            // server's origin through the DDR-109 guard). Home first — a first
            // launch IS Home (no welcome-project sidecar) — then the last project
            // as a tab after it. Boot projects go through `open_window_for_root`,
            // not `open_project_window`: the welcome project and an
            // `MAUDE_PROJECT_ROOT` override must not enter the registry.
            match &plan {
                BootPlan::Project(root) => {
                    if let Err(e) = windows::open_window_for_root(&handle, &root.to_string_lossy(), None, None) {
                        sidecar::log_line(&format!("[maude] FATAL: could not open the project window: {e}"));
                    }
                }
                BootPlan::Home { reopen } => {
                    if let Err(e) = home::ensure_home_window(&handle, None) {
                        sidecar::log_line(&format!("[maude] FATAL: could not open the Home window: {e}"));
                    }
                    if let Some(root) = reopen {
                        if let Err(e) = windows::open_window_for_root(
                            &handle,
                            &root.to_string_lossy(),
                            Some(windows::HOME_LABEL),
                            None,
                        ) {
                            sidecar::log_line(&format!("[maude] could not reopen {}: {e}", root.display()));
                        }
                    }
                }
            }


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
        // Per-window lifecycle (V2-3.2, contract §5.2). A close stops ONLY that
        // window's project, after the grace (`windows::on_destroyed`) — it used
        // to `kill_server` the whole pool (e2e spike finding 1). `Destroyed`, not
        // `CloseRequested`, does the bookkeeping: WebDriver's DELETE /window
        // destroys without asking, and both paths must converge. Focus stamps
        // the front window and checks for updates (Phase 32 / Task 1).
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                if windows::close_guard(window.app_handle(), window.label())
                    == windows::CloseGuard::Hold
                {
                    api.prevent_close();
                }
            }
            WindowEvent::Destroyed => {
                windows::on_destroyed(window.app_handle(), window.label());
            }
            WindowEvent::Focused(true) => {
                windows::on_focused(window.app_handle(), window.label());
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
    // Not on Windows: the plugin does not build there against Tauri 2.12 (Cargo.toml).
    #[cfg(all(debug_assertions, not(target_os = "windows")))]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    // WebKit kills the page's web content process under memory pressure (a heavy
    // canvas) and WKWebView then sits on a white window. Reload it — rate-limited,
    // see web_process.rs.
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let builder = builder.on_web_content_process_terminate(web_process::on_terminate);

    // Multiplayer E2E must keep the normal cross-origin canvas containment ON:
    // disabling it also disables TSX sync. Opt-in DOM observation in test builds
    // lets WDIO assert the receiving canvas without changing that security gate.
    #[cfg(debug_assertions)]
    let builder = if std::env::var("MAUDE_E2E_FRAME_PROBE").as_deref() == Ok("1") {
        builder.plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("e2e-frame-probe")
                .js_init_script_on_all_frames(include_str!("e2e-frame-probe.js"))
                .build(),
        )
    } else {
        builder
    };

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        // The last window was closed (`code: None` comes only from that — ⌘Q
        // and `app.exit` arrive as `Exit` / `Some(code)`). On macOS the app keeps
        // running, as Mac apps do; the closed window's server still stops after
        // its grace (contract §5.2 "Last window closed").
        #[cfg(target_os = "macos")]
        RunEvent::ExitRequested {
            code: None, api, ..
        } => {
            api.prevent_exit();
        }
        // Kill every sidecar on Cmd+Q / app termination.
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            sidecar::kill_server(app_handle);
            home::kill(app_handle);
        }
        // Dock click with no window open: Home (contract §5.2 "Last window
        // closed").
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            let none_open = app_handle
                .try_state::<SidecarState>()
                .is_some_and(|s| s.windows.lock().unwrap_or_else(|e| e.into_inner()).is_empty());
            if none_open {
                let handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = home::ensure_home_window(&handle, None) {
                        sidecar::log_line(&format!("[maude] reopen failed: {e}"));
                    }
                });
            }
        }
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boot_opens_home_first_unless_told_what_to_open() {
        let p = |s: &str| PathBuf::from(s);
        let welcome = || p("/welcome");
        // First launch: Home only — no welcome-project sidecar.
        assert_eq!(boot_plan(None, false, None, welcome), BootPlan::Home { reopen: None });
        // A last project: Home, then that project as a tab after it.
        assert_eq!(
            boot_plan(None, false, Some(p("/last")), welcome),
            BootPlan::Home { reopen: Some(p("/last")) }
        );
        // MAUDE_PROJECT_ROOT (every e2e lane): that project's window first.
        assert_eq!(
            boot_plan(Some(p("/e2e")), false, Some(p("/last")), welcome),
            BootPlan::Project(p("/e2e"))
        );
        // MAUDE_FORCE_ONBOARDING (debug, the onboarding lane): the welcome project.
        assert_eq!(boot_plan(None, true, None, welcome), BootPlan::Project(p("/welcome")));
    }
}
