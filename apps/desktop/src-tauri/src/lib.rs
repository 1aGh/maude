// Maude native shell — Tauri v2 entry (DDR-106).
//
// Lifecycle: spawn the compiled dev-server as a sidecar → poll `_server.json` for
// the port → navigate the webview to it → kill the sidecar on quit. Single-instance
// focuses the existing window instead of opening a second one.
//
// Windows (V2-3.2, contract V2-1.1 §5.2): Rust creates every window — one per
// open project, label `p-<pid>`, all child webviews of one `shell` window (tabs.rs). There
// is no `"main"` window. Closing a window stops ONLY its project's server, after
// a 10 s grace; closing the last one leaves the app running on macOS.
//
// Quit is caught on two paths so no sidecar is orphaned (DDR-106 lifecycle):
//   1. `RunEvent::ExitRequested` / `Exit` — Cmd+Q / app termination.
//   2. SIGTERM / SIGINT — `kill`, Ctrl+C, crash-via-signal.
// (SIGKILL is uncatchable and will orphan — unavoidable for any process; a relaunch
// detects the stale `_server.json` server.)

mod app_state;
mod bus;
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
// S5.14: ⌘Q asks first while AI is working, then stops and keeps what AI finished.
mod quit;
mod server_json;
mod sidecar;
mod tabs;
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
/// respected) and the URL from that instance's APP-OWNED info file (V2-1.1
/// decision 8 — never the in-project `_server.json`), validated loopback-only
/// in `sidecar::read_shell_origin`. A RESTING window gets `{resting, name}`
/// instead and its splash waits for focus to wake it. The page
/// receives an already-validated `http://localhost:*` / `http://127.0.0.1:*`
/// string and can never steer the navigate — this is not an open-navigate
/// primitive, and must not become one.
#[tauri::command]
async fn resolve_dev_server_url(webview: tauri::Webview) -> Result<serde_json::Value, String> {
    // The Home window's splash answers the Home origin (V2-3.3, §5.2 "Splash
    // states"): from the app-local splash or Home itself, never a `p-*` label.
    if webview.label() == windows::HOME_LABEL {
        home::caller_home(&webview, true)?;
        let url = home::wait_home_url(webview.app_handle(), std::time::Duration::from_millis(RECOVERY_WAIT_MS)).await?;
        // The splash is about to go there itself: the Home origin is the one
        // its navigations may reach (N-M2) — from app-owned state only.
        home::stamp_home_origin(webview.app_handle(), &url);
        return Ok(serde_json::Value::String(url));
    }
    // The splash runs on the app-local origin; a page already on its server
    // may ask too (a reload).
    let caller = windows::caller_project(&webview, true)?;
    // S1.19: a tab whose folder is gone gets the moved-folder card's answer
    // (`{missing, pid, name, place}` — its own project only) and goes there.
    if let Some(card) = tabs::missing_answer(webview.app_handle(), &caller) {
        return Ok(card);
    }
    if let Some(name) = windows::resting_name(webview.app_handle(), &caller.label) {
        return Ok(serde_json::json!({ "resting": true, "name": name }));
    }
    let url = sidecar::wait_for_shell_url(webview.app_handle(), &caller.root, RECOVERY_WAIT_MS).await?;
    // The splash navigates itself there: record that origin (from the live
    // child's app-owned info file) as this window's, or the guard refuses it (N-M2/N-M3).
    if !windows::stamp_server_origin(webview.app_handle(), &caller.label, &caller.root, &url) {
        return Err("This window moved on to another project.".to_string());
    }
    Ok(serde_json::Value::String(format!("{url}/")))
}

/// Native folder picker for "pull a local copy" — returns the chosen parent dir,
/// or `None` if the user cancelled. The clone lands in `<dir>/<repo-name>`.
#[tauri::command]
async fn pick_directory(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<Option<String>, String> {
    let caller = windows::caller_project(&webview, false)?;
    windows::caller_in_front(&webview)?; // 1g: no native dialog from a hidden tab
                                         // E2E (debug builds only): a native folder picker can't be DOM-driven, so the
                                         // harness injects the chosen path via MAUDE_E2E_PICK_DIR instead of opening the OS
                                         // dialog. Gated on `debug_assertions`, so it is NEVER compiled into the release
                                         // `.app` (which has no WebDriver server either). See the `desktop-e2e` skill.
    #[cfg(debug_assertions)]
    if let Ok(p) = std::env::var("MAUDE_E2E_PICK_DIR") {
        if !p.is_empty() {
            windows::remember_pick(&caller.label, &p);
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
    let picked = rx.await.map_err(|_| "Folder picker closed unexpectedly.".to_string())?;
    // The one folder (and its direct children) this window may now open or
    // remember without it being a registered project (V2-3.6 M3).
    if let Some(p) = &picked {
        windows::remember_pick(&caller.label, p);
    }
    Ok(picked)
}

/// S5.10 — "Choose a folder…" in the AI composer's paperclip: the native
/// folder picker, returning the chosen folder (or `None` on cancel) for the
/// server's read-only attach consent. Unlike `pick_directory` it does NOT
/// remember the pick: an attached folder is something the AI may READ once the
/// person consents, never a folder this tab may open or switch to (V2-3.6 M3's
/// `PICKED_FOLDER` stays the "Open another folder…" pick only).
#[tauri::command]
async fn pick_attach_folder(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<Option<String>, String> {
    let _caller = windows::caller_project(&webview, false)?;
    windows::caller_in_front(&webview)?; // 1g: no native dialog from a hidden tab
                                         // E2E (debug builds only): the harness names the folder instead of the OS dialog.
    #[cfg(debug_assertions)]
    if let Ok(p) = std::env::var("MAUDE_E2E_PICK_ATTACH_DIR") {
        if !p.is_empty() {
            return Ok(Some(p));
        }
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
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
    windows::caller_in_front(&webview)?; // 1g: no save sheet from a hidden tab
                                         // The origin comes from the app-owned info file of THAT project's running
                                         // child (V2-1.1 decision 8), never the in-project `_server.json` (V2-3.6 M1).
    let info_file = sidecar::shell_info_file(&app, &caller.root);
    let download_url = export_download_url(info_file.as_deref(), &job_id)?;

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

/// The one route `save_export` may fetch (V2-3.6 M1): a fixed path on the
/// project's own loopback origin, with only the validated id varying.
const EXPORT_DOWNLOAD_PATH: &str = "/_api/export-jobs/download";

/// Resolve the `/_api/export-jobs/download` URL for `job_id` against the origin
/// the app-owned shell info file names (`sidecar::read_shell_origin`, loopback
/// only — DDR-109). `None` = no running child of ours for that project.
/// Validates the id looks like the `crypto.randomUUID()` the server actually
/// generates (`exporters/jobs.ts`) before it's interpolated into a URL —
/// defense in depth, since this string arrives from the studio client, and a
/// Rust command has no other gate of its own on what it's handed.
fn export_download_url(info_file: Option<&std::path::Path>, job_id: &str) -> Result<String, String> {
    let looks_like_id = !job_id.is_empty()
        && job_id.len() <= 64
        && job_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !looks_like_id {
        return Err("Invalid export job id.".to_string());
    }
    let unreachable = || "Couldn't reach the local Maude server to fetch the export.".to_string();
    let origin = sidecar::read_shell_origin(info_file.ok_or_else(unreachable)?).ok_or_else(unreachable)?;
    let url: tauri::Url = format!("{origin}{EXPORT_DOWNLOAD_PATH}?id={job_id}")
        .parse()
        .map_err(|_| unreachable())?;
    // Belt and braces: the assembled URL is loopback and on the one route.
    if !server_json::is_loopback_url(&url) || url.path() != EXPORT_DOWNLOAD_PATH {
        return Err(unreachable());
    }
    Ok(url.to_string())
}

/// The export download client: loopback only, so no proxy (an `HTTP_PROXY` in
/// the login env must never see the request) and no redirects (a 3xx must not
/// carry the fetch off the project's own server — V2-3.6 M1). No timeout: a
/// print PDF can take a while to stream.
fn export_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: std::sync::OnceLock<Option<reqwest::Client>> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .ok()
        })
        .as_ref()
        .ok_or_else(|| "Couldn't start the export download.".to_string())
}

/// Stream a finished export job's bytes from the dev-server straight to `dest`
/// in chunks, never materializing the whole payload in memory at once — a
/// print-ready PDF can be hundreds of MB (see `save_export`'s doc comment).
async fn stream_download_to_file(url: &str, dest: &std::path::Path) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let resp = export_client()?
        .get(url)
        .send()
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
    windows::caller_in_front(&webview)?; // 1g: no native dialog from a hidden tab
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
    windows::caller_in_front(&webview)?; // 1g: no native dialog from a hidden tab
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
    // V2-3.6 M3: a project page cannot switch its tab to an arbitrary folder —
    // only a registered project (recents, a resolved link) or the folder the
    // last picker shown to THIS window returned (or what it created inside it).
    if !windows::local_project_allowed(&app, &caller.label, &p) {
        return Err("Choose that folder with “Open another folder…” first.".to_string());
    }
    // The dev-server fails loud on a project with no `.design/` (load-bearing,
    // CLAUDE.md). Refuse the switch HERE so a non-Maude folder shows a clear message
    // instead of crash-looping the sidecar (3 respawns → blank). The client also
    // pre-checks via the clone's `hasDesign`, but this guards every open path.
    if !p.join(".design").is_dir() {
        return Err("That folder isn’t a Maude project yet (no design system). Open it and run “Set up a design system” first.".to_string());
    }
    // S1.22b: a registered project other than the picked folder must be one of
    // THIS tab's account (⌘K's rule) and keeps its binding — the switch never
    // moves the tab onto another account's project, nor adopts the last sign-in.
    let binding = {
        let st = app_state::load(&app);
        windows::in_tab_open_rule(
            &st,
            &caller.pid,
            &st.profile_for(&caller.root),
            &windows::pid_for_root(&p.to_string_lossy()),
            windows::picked_covers(&caller.label, &p),
            windows::is_boot_root(&p),
        )?
    };
    // Remember it as the last project (so a relaunch reopens it) + switch in-process.
    app_state::set_last_project_with(&app, &p, binding);
    // The pick is spent once it opened something (it is registered now).
    windows::PICKED_FOLDER.take(&caller.label);
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
        // V2-3.7: Home is pinned and stays; the opened tab becomes active.
        match windows::open_project_window(&app, &path, caller.as_deref(), None, app_state::Binding::Adopt) {
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
            // V2-3.7 the tab strip (strip-only, capabilities/strip.json).
            tabs::tabs_state,
            tabs::tab_activate,
            tabs::tab_close,
            tabs::tab_reorder,
            // S1.22b: the tab menu, Rename… and the tab overview (strip-only).
            tabs::tab_menu,
            tabs::tab_rename,
            tabs::tab_overview,
            tabs::e2e_shell_bounds,
            menu::e2e_menu_state,
            notify::e2e_ai_transition,
            notify::e2e_dock_badge,
            open_project_folder,
            home::shell_state,
            home::home_session,
            home::new_home_tab,
            home::take_pending_intent,
            windows::take_tabs_restored,
            windows::take_pending_navigate,
            home::index_search,
            home::open_search_result,
            home::relink_project,
            windows::window_labels,
            windows::e2e_focus_window,
            windows::e2e_close_window,
            windows::e2e_bind_profile,
            oauth::e2e_github_sign_in_as,
            profiles::cloud_sign_in_prepare,
            profiles::cloud_signed_in,
            notify::e2e_notification_click,
            app_state::app_is_first_run,
            app_state::app_get_last_project,
            app_state::app_set_last_project,
            app_state::app_recent_projects,
            updater::restart_to_update,
            updater::check_for_updates,
            prefs::prefs_get_crash_reporting,
            prefs::prefs_set_crash_reporting,
            prefs::prefs_get_claude_auto_setup,
            prefs::prefs_set_claude_auto_setup,
            crash_reporter::list_crash_logs,
            crash_reporter::read_crash_log,
            deep_link::take_pending_deep_link,
            deep_link::take_link_opened,
            bus::shell_subscribe,
            deep_link::e2e_deliver_deep_link,
            project_resolve::resolve_project_for_link,
            notify::send_notification,
            // S5.14: the asked tab's answer to the quit dialog.
            quit::quit_answer,
            managed::managed_project_open,
            managed::managed_projects_list,
            profiles::profiles_list,
            profiles::profiles_create,
            profiles::profiles_delete,
            profiles::accounts_list,
            pick_attach_folder,
        ])
        .menu(menu::build_menu)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .setup(|app| {
            let handle = app.handle().clone();
            // S1.22b: the menu is NSApp's by now (tauri init_app_menu runs before setup);
            // hide the ⇧⌘] / ⇧⌘[ items, keeping their keys (menu.rs).
            #[cfg(target_os = "macos")]
            menu::hide_hidden_items();

            // Crash reporting (Phase 32 / Task 4) — prime the opt-in toggle from
            // prefs.json and install the panic hook FIRST, so a panic anywhere in
            // setup is caught (and, only if opted in, written to a local file).
            prefs::init(&handle);
            crash_reporter::install(&handle);
            // V2-3.8: debug builds only — the e2e lane's in-memory keychain.
            #[cfg(debug_assertions)]
            keychain::test_store::install_for_e2e();

            // issue #105 — a canvas with audio/video hard-aborts the web process
            // when no GStreamer audio sink is registered, and the user sees only
            // a blank view. Say it out loud instead. Best-effort, non-blocking,
            // and a no-op on a machine whose media stack is complete.
            #[cfg(target_os = "linux")]
            linux_media::warn_if_incomplete(&handle);

            // maude:// links (Phase 17). macOS delivers through the plugin;
            // the state is parked until the client asks for it.
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
            // V2-3.6 M4: name the bridge port for curl-local to refuse. If that
            // record cannot be written the bridge stays unpublished — no spawn
            // gets its endpoint (V2-3.10 low (b), fail closed).
            if let Err(e) = handle
                .path()
                .app_data_dir()
                .map_err(|e| format!("no app data dir: {e}"))
                .and_then(|d| keychain::write_bridge_port_file(&d.join("run")))
            {
                sidecar::log_line(&format!(
                    "[maude] WARN: token bridge port not published, GitHub features disabled: {e}"
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
            // launch IS Home (no welcome-project sidecar) — then a saved
            // multi-tab session reopens after it (V2-3.2 part b; only the front
            // tab spawns), else the last project as a tab after Home. Boot
            // projects go through `open_window_for_root`, not
            // `open_project_window`: the welcome project and an
            // `MAUDE_PROJECT_ROOT` override must not enter the registry.
            //
            // V2-3.7: ONE `shell` window with the tab strip, then the pinned
            // Home tab (always, in both plans — it is never closed), then the
            // project tab(s), each a child webview of the shell.
            if let Err(e) = tabs::ensure_shell(&handle) {
                sidecar::log_line(&format!("[maude] FATAL: could not open the Maude window: {e}"));
            }
            if let Err(e) = home::ensure_home_window(&handle, None) {
                sidecar::log_line(&format!("[maude] FATAL: could not open the Home tab: {e}"));
            }
            match &plan {
                BootPlan::Project(root) => {
                    windows::boot_windows(&handle, Some(&root.to_string_lossy()));
                }
                BootPlan::Home { reopen } => {
                    let reopen = reopen.as_ref().map(|r| r.to_string_lossy().into_owned());
                    windows::boot_windows(&handle, reopen.as_deref());
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
            // V2-3.10: `index://changed` to Home when a running project's index changes.
            home::spawn_index_watch(&handle);
            // S1.19: a tab whose folder moved on disk shows the card.
            tabs::spawn_root_watch(&handle);

            // The bundled app parks maude:// links; the client validates and
            // opens a file locally or asks before a project switch.

            Ok(())
        })
        // The ONE `shell` window (V2-3.7). Tabs are child webviews with no
        // lifecycle events of their own: a tab closes through `tabs::close_tab`
        // (the strip's ×, e2e), which does the per-tab bookkeeping (grace,
        // reap — `windows::on_destroyed`). The shell's close button HIDES it on
        // macOS — the app keeps running and the Dock (`RunEvent::Reopen`)
        // shows it again; elsewhere it closes and the app exits. A resize or a
        // fullscreen change re-lays-out the children. Focus only checks for
        // updates (Phase 32 / Task 1): the active tab is the strip's business.
        .on_window_event(|window, event| {
            if window.label() != tabs::SHELL_LABEL {
                return;
            }
            match event {
                #[cfg(target_os = "macos")]
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                // S5.14: elsewhere closing the shell quits — the same ask-first round trip.
                #[cfg(not(target_os = "macos"))]
                WindowEvent::CloseRequested { api, .. } if !quit::approved() => {
                    api.prevent_close();
                    quit::request(window.app_handle());
                }
                WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
                    tabs::layout(window.app_handle());
                }
                WindowEvent::Focused(true) => {
                    updater::check_now(window.app_handle().clone());
                }
                _ => {}
            }
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
        // Kill every sidecar on Cmd+Q / app termination. S5.14: an exit that skipped the quit
        // dialog (the Dock's Quit, logout, an update restart) stops the runs first, bounded.
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            quit::last_chance(app_handle);
            sidecar::kill_server(app_handle);
            home::kill(app_handle);
        }
        // Dock click with the shell hidden (its close button, V2-3.7): show it
        // again on the tab that was active.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            let handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                windows::reveal_front(&handle);
            });
        }
        _ => {}
    });
}

/// A click on a native menu item (`on_menu_event`; `menu::e2e_menu_state` clicks one in a debug
/// build). `id` is the menu-item id.
pub(crate) fn on_menu(app: &tauri::AppHandle, id: &str) {
    // The focused window (no fallback) — where a menu action lands.
    let focused = || {
        app.try_state::<SidecarState>().and_then(|s| {
            menu::action_target(&s.windows.lock().unwrap_or_else(|e| e.into_inner()))
        })
    };
    // S5.14: Maude ▸ Quit ⌘Q is a native item (menu.rs) — ask first while AI is working.
    if id == quit::MENU_QUIT {
        quit::request(app);
        return;
    }
    // S1.22b: a row of the tab menu (right-click a tab; tabs::tab_menu builds it).
    if let Some((item, label)) = tabs::tab_menu_command(id) {
        tabs::run_tab_menu(app, item, &label);
        return;
    }
    let Some(route) = menu::route(id) else {
        return; // a predefined item: AppKit handled it
    };
    let id = match route {
        // exec:'shell' (V2-1.3 §5.8): the focused window's webview runs the
        // action by registry id — File ▸ New Canvas (`canvas.new`), Help ▸
        // Report a Bug… (`help.report-bug`, the dialog owns capture + consent)
        // and New Project… (`project.new`: a project tab opens IdentityBar's
        // create dialog; Home opens its create sheet — V2-3.9, home-app.jsx).
        // The ACTIVE tab only: no active tab → nothing (never a background tab).
        menu::MenuRoute::Action(action) => {
            if let Some(label) = focused() {
                // The focused page's own channel only (bus.rs, finding 1d).
                bus::send(
                    &label,
                    menu::MENU_ACTION_EVENT,
                    serde_json::json!({ "id": action }),
                );
            }
            return;
        }
        menu::MenuRoute::Native(id) => id,
    };
    if id == menu::MENU_CHECK_UPDATES {
        // Maude ▸ Check for Updates… — force a check now with explicit
        // dialog feedback (the background loop is otherwise silent).
        updater::check_now_interactive(app.clone());
        return;
    }
    // File ▸ Open Project… ⌘O — the `open_project_folder` flow; the new tab
    // goes after the focused window, as from the command.
    if id == menu::MENU_OPEN_PROJECT_FOLDER {
        pick_and_open_folder(app, focused());
        return;
    }
    // V2-3.9 — File ▸ Show Home ⌘T (`home.open`, activates the pinned Home), Close Tab
    // ⌘W, and the Window menu's tab items: the shell's own tab bar (tabs.rs).
    if let Some(cmd) = menu::tab_command(&id) {
        tabs::run_tab_command(app, cmd);
    }
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

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "maude-lib-{tag}-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
        ));
        std::fs::create_dir_all(d.join(".design")).unwrap();
        d
    }

    /// V2-3.6 M1: the download origin is the app-owned info file's, loopback
    /// only, on the one export route — a planted `_server.json` plays no part.
    #[test]
    fn save_export_url_comes_from_the_info_file_and_is_loopback_only() {
        let project = scratch("export-url");
        std::fs::write(
            project.join(".design/_server.json"),
            r#"{"pid":1,"port":443,"url":"https://evil.example"}"#,
        )
        .unwrap();
        let info = project.join("info.json");
        std::fs::write(&info, r#"{"url":"http://localhost:4403","port":4403}"#).unwrap();
        assert_eq!(
            export_download_url(Some(&info), "0b6c-41f2").unwrap(),
            "http://localhost:4403/_api/export-jobs/download?id=0b6c-41f2"
        );
        // No running child of ours ⇒ no download, whatever `_server.json` says.
        assert!(export_download_url(None, "0b6c-41f2").is_err());
        // An info file off loopback is refused too (DDR-109).
        std::fs::write(&info, r#"{"url":"https://evil.example"}"#).unwrap();
        assert!(export_download_url(Some(&info), "0b6c-41f2").is_err());
        // The id cannot reshape the URL.
        std::fs::write(&info, r#"{"url":"http://localhost:4403"}"#).unwrap();
        for bad in ["", "a/../b", "x?y", "x#y", "a&id=b", &"a".repeat(65)] {
            assert!(export_download_url(Some(&info), bad).is_err(), "{bad}");
        }
        let _ = std::fs::remove_dir_all(&project);
    }

    /// Serve one canned HTTP response on a loopback port; returns the port.
    fn serve_once(response: String) -> u16 {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut s, _)) = listener.accept() {
                let mut buf = [0u8; 4096];
                let _ = s.read(&mut buf);
                let _ = s.write_all(response.as_bytes());
            }
        });
        port
    }

    /// V2-3.6 M1: a 3xx from the project's server must not carry the fetch
    /// elsewhere — the redirect target's bytes never reach the chosen file.
    #[test]
    fn save_export_download_refuses_a_redirect() {
        let evil = serve_once(
            "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nevil".to_string(),
        );
        let first = serve_once(format!(
            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{evil}/x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        ));
        let dir = scratch("export-redirect");
        let dest = dir.join("out.pdf");
        let res = tauri::async_runtime::block_on(stream_download_to_file(
            &format!("http://127.0.0.1:{first}/_api/export-jobs/download?id=a"),
            &dest,
        ));
        assert!(res.is_err(), "a redirect must fail the download, got {res:?}");
        assert!(std::fs::read(&dest).map(|b| b != b"evil").unwrap_or(true));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
