// home.rs — the Home server and the Home window (V2-3.3; contract V2-1.1
// decisions 1, 2, 3, 6, 7 and §5.3/§5.4).
//
// ONE Home server per app run: `maude-server --home`, the same compiled binary
// as every project server (DDR-009/DDR-177), spawned at launch before any
// project and supervised like a sidecar (respawn ≤ `MAX_RESTARTS`, the same
// give-up dialog shape). It is never in the project pool, never counted toward
// the cap and never reaped. Its record lives in `SidecarState.home`.
//
// Trust: the Home server writes its `{pid, port, url, mode:'home'}` to an
// APP-OWNED info file (`MAUDE_SHELL_INFO_FILE`, under app data) — nothing in a
// project can move it. Rust reaches its internal routes with a per-spawn bearer
// (`MAUDE_HOME_TOKEN`). Home commands are granted by a RUNTIME capability added
// once the port is known (`add_home_capability`) and re-checked here, label AND
// origin, on every call (`check_home`, decision 7 / §5.8 item 3).
//
// V2-3.6 H1: the Home PAGE routes need a second per-spawn secret
// (`MAUDE_HOME_PAGE_SECRET`, never equal to the bearer), sent by the page as the
// `x-maude-home` value. Only the Home window on the Home origin can read it
// (`home_session`). Before this the page routes' whole gate was the constant
// header `x-maude-home: 1`, which any local process — the agent's auto-allowed
// `maude design curl-local` included — could send. Both secrets travel in the
// child's env; a same-user `ps -Eww` can read them. That is the accepted residual
// (V2-3.6 M4): the agent runs as the same OS user and could read any app-owned
// file as well.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

use crate::app_state::AppState;
use crate::sidecar::{log_line, SidecarState, MAX_RESTARTS};
use crate::windows::{self, Role, WindowBook, WindowHost, WindowSpec, HOME_LABEL};

/// The request header every Home route requires (§5.3 Guards).
pub const HOME_HEADER: &str = "x-maude-home";

/// The server's own cap for `/_home/internal/thumbs` keys per call.
const MAX_THUMB_KEYS: usize = 50;

/// `shell://state` debounce (§5.4 Events).
const STATE_DEBOUNCE: Duration = Duration::from_millis(250);

/// The permissions of the runtime `home` capability (§5.4 Capabilities). Every
/// entry must resolve: Tauri `unwrap`s the runtime resolve, so an unknown name
/// would panic at bind time (`every_home_permission_exists` pins it).
pub const HOME_PERMISSIONS: &[&str] = &[
    // No `core:event:*` (V2-3.6 M5, finding 1d): Home hears `shell://state`,
    // `index://changed` … on the Channel it hands `shell_subscribe` (bus.rs).
    "allow-shell-subscribe",
    "allow-shell-state",
    "allow-open-project",
    "allow-open-project-folder",
    "allow-new-home-tab",
    "allow-relink-project",
    "allow-managed-project-open",
    "allow-managed-projects-list",
    "allow-open-cloud-url",
    "allow-resolve-dev-server-url",
    "allow-send-notification",
    // V2-3.5: a link for a project this machine doesn't know is parked for Home.
    "allow-take-pending-deep-link",
    // V2-3.6 H1: the page secret for the Home server's page routes.
    "allow-home-session",
];

// ── The Home server record ──────────────────────────────────────────────────

/// The live Home server. `port`/`url` are `None` until its info file names
/// THIS child (and again from its death until the respawn binds).
pub struct HomeInstance {
    pub port: Option<u16>,
    /// `http://127.0.0.1:<port>` — the Home origin.
    pub url: Option<String>,
    /// The internal bearer (32 random bytes, hex), minted per spawn.
    pub token: String,
    /// The page secret (32 random bytes, hex, never `token`), minted per spawn —
    /// what `home_session` hands the Home window (V2-3.6 H1).
    pub page_secret: String,
    pub info_file: PathBuf,
    pub child: Option<CommandChild>,
    pub budget: RestartBudget,
    pub spawned_at: Instant,
    /// Ports a runtime capability was already added for (one per origin).
    cap_ports: Vec<u16>,
}

/// The restart budget of the Home server (same accounting as a project's —
/// `sidecar::next_restart_count`).
#[derive(Debug, Default)]
pub struct RestartBudget {
    pub restarts: u32,
}

/// What a Home death does — the seam the supervisor test drives.
pub trait HomeSpawner {
    /// Respawn after `delay` (attempt `attempt` of `MAX_RESTARTS`).
    fn spawn_after(&self, attempt: u32, delay: Duration);
    /// The budget is spent: tell the person (the give-up dialog).
    fn give_up(&self);
}

/// One unexpected death. Returns the respawn attempt, or `None` on give-up
/// (the budget is reset so "Try again" starts fresh).
pub fn on_death(
    budget: &mut RestartBudget,
    uptime: Duration,
    spawner: &impl HomeSpawner,
) -> Option<u32> {
    budget.restarts = crate::sidecar::next_restart_count(budget.restarts, uptime);
    if budget.restarts > MAX_RESTARTS {
        budget.restarts = 0;
        spawner.give_up();
        return None;
    }
    let attempt = budget.restarts;
    spawner.spawn_after(attempt, Duration::from_millis(500 * attempt as u64));
    Some(attempt)
}

struct TauriSpawner {
    app: AppHandle,
}

impl HomeSpawner for TauriSpawner {
    fn spawn_after(&self, attempt: u32, delay: Duration) {
        log_line(&format!(
            "[maude] respawning Home (attempt {attempt}/{MAX_RESTARTS})"
        ));
        let app = self.app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(delay).await;
            if app
                .state::<SidecarState>()
                .shutting_down
                .load(Ordering::SeqCst)
            {
                return;
            }
            if let Err(e) = spawn_home(&app) {
                log_line(&format!("[maude] Home respawn failed: {e}"));
            }
        });
    }

    fn give_up(&self) {
        log_line(&format!(
            "[maude] Home gave up after {MAX_RESTARTS} restarts"
        ));
        let app = self.app.clone();
        self.app
            .dialog()
            .message(format!(
                "Maude Home stopped {MAX_RESTARTS} times in a row and is no longer running, so the Home tab can't show your projects.\n\nYour projects and files are untouched."
            ))
            .title("Maude Home stopped")
            .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
                "Try again".to_string(),
                "Close".to_string(),
            ))
            .show(move |retry| {
                if retry {
                    if let Err(e) = spawn_home(&app) {
                        log_line(&format!("[maude] Home restart failed: {e}"));
                    }
                }
            });
    }
}

fn app_data(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))
}

fn mint_token() -> Result<String, String> {
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf).map_err(|e| format!("secure RNG unavailable: {e}"))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// `(internal bearer, page secret)` for one spawn — two independent draws, and
/// never equal (the Home server refuses an equal pair anyway).
fn mint_secrets() -> Result<(String, String), String> {
    let bearer = mint_token()?;
    loop {
        let page = mint_token()?;
        if page != bearer {
            return Ok((bearer, page));
        }
    }
}

/// What the Home server's info file must say to count as THIS child bound:
/// `mode:'home'`, the child's pid, and `url == http://127.0.0.1:<port>`.
pub fn parse_info(bytes: &[u8], pid: u32) -> Option<(u16, String)> {
    #[derive(Deserialize)]
    struct Info {
        pid: u32,
        port: u16,
        url: String,
        mode: String,
    }
    let info: Info = serde_json::from_slice(bytes).ok()?;
    let expected = format!("http://127.0.0.1:{}", info.port);
    let loopback = info
        .url
        .parse::<tauri::Url>()
        .is_ok_and(|u| crate::server_json::is_loopback_url(&u));
    (info.mode == "home" && info.pid == pid && info.port != 0 && info.url == expected && loopback)
        .then_some((info.port, info.url))
}

/// Spawn (or respawn) the Home server. Re-entrant from the supervisor.
pub fn spawn_home(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<SidecarState>();
    let data = app_data(app)?;
    let state_dir = data.join("home");
    let run_dir = data.join("run");
    for d in [&state_dir, &run_dir] {
        std::fs::create_dir_all(d).map_err(|e| format!("could not create {}: {e}", d.display()))?;
    }
    let info_file = run_dir.join("home-server.json");
    // A dead child's record must not satisfy the wait below.
    let _ = std::fs::remove_file(&info_file);
    let (token, page_secret) = mint_secrets()?;

    let mut args = vec!["--home".to_string()];
    if let Some(p) = crate::app_state::load(app).home_port {
        args.push("--port".to_string());
        args.push(p.to_string());
    }
    let mut command = app
        .shell()
        .sidecar("maude-server")
        .map_err(|e| format!("sidecar resolve failed: {e}"))?
        .args(args)
        .env("NO_OPEN", "1")
        .env(
            "MAUDE_HOME_STATE_DIR",
            state_dir.to_string_lossy().to_string(),
        )
        .env("MAUDE_HOME_TOKEN", token.clone())
        .env("MAUDE_HOME_PAGE_SECRET", page_secret.clone())
        .env(
            "MAUDE_SHELL_INFO_FILE",
            info_file.to_string_lossy().to_string(),
        );
    // MAUDE_INDEX_DIR / MAUDE_CLOUD_URL / XDG_CONFIG_HOME are inherited from
    // this process, exactly as every project server inherits them — so Home
    // reads the index the project servers write.
    if let Some(studio) = crate::sidecar::bundled_studio_root(app) {
        command = command.env(
            "MAUDE_DEV_SERVER_ROOT",
            studio.to_string_lossy().to_string(),
        );
    }
    let (rx, child) = command
        .spawn()
        .map_err(|e| format!("Home spawn failed: {e}"))?;
    let pid = child.pid();
    log_line(&format!("[maude] Home server spawned (pid {pid})"));

    let displaced = {
        let mut slot = state.home.lock().unwrap_or_else(|e| e.into_inner());
        match slot.as_mut() {
            Some(h) => {
                h.port = None;
                h.url = None;
                h.token = token;
                h.page_secret = page_secret;
                h.info_file = info_file.clone();
                h.spawned_at = Instant::now();
                h.child.replace(child)
            }
            None => {
                *slot = Some(HomeInstance {
                    port: None,
                    url: None,
                    token,
                    page_secret,
                    info_file: info_file.clone(),
                    child: Some(child),
                    budget: RestartBudget::default(),
                    spawned_at: Instant::now(),
                    cap_ports: Vec::new(),
                });
                None
            }
        }
    };
    if let Some(old) = displaced {
        crate::sidecar::terminate(old);
    }
    supervise(app.clone(), rx, pid);
    wait_bound(app.clone(), info_file, pid);
    Ok(())
}

fn current_pid(app: &AppHandle) -> Option<u32> {
    let state = app.try_state::<SidecarState>()?;
    let slot = state.home.lock().unwrap_or_else(|e| e.into_inner());
    slot.as_ref()?.child.as_ref().map(|c| c.pid())
}

fn supervise(app: AppHandle, mut rx: tauri::async_runtime::Receiver<CommandEvent>, pid: u32) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    crate::sidecar::log_raw(&format!(
                        "[maude:home] {}",
                        String::from_utf8_lossy(&line)
                    ));
                }
                CommandEvent::Terminated(payload) => {
                    log_line(&format!(
                        "[maude:home] terminated (code={:?})",
                        payload.code
                    ));
                    let state = app.state::<SidecarState>();
                    if state.shutting_down.load(Ordering::SeqCst) {
                        break;
                    }
                    let mut slot = state.home.lock().unwrap_or_else(|e| e.into_inner());
                    let Some(h) = slot.as_mut() else { break };
                    // A newer child (a racing respawn) supervises itself.
                    if h.child.as_ref().is_some_and(|c| c.pid() != pid) {
                        break;
                    }
                    h.child = None;
                    h.port = None;
                    h.url = None;
                    let uptime = h.spawned_at.elapsed();
                    on_death(&mut h.budget, uptime, &TauriSpawner { app: app.clone() });
                    drop(slot);
                    // N-M3: the dead Home's port is not "the Home origin" for
                    // the window's navigations any more; `on_bound` records the
                    // next. (Taken after the Home lock is released.)
                    state
                        .windows
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .clear_origin(HOME_LABEL);
                    break;
                }
                _ => {}
            }
        }
    });
}

/// Poll the app-owned info file until it names THIS child, then `on_bound`.
fn wait_bound(app: AppHandle, info_file: PathBuf, pid: u32) {
    tauri::async_runtime::spawn(async move {
        let deadline = Instant::now() + Duration::from_millis(windows::SERVER_WAIT_MS);
        while Instant::now() < deadline {
            if current_pid(&app) != Some(pid) {
                return; // died or replaced — its successor waits for itself
            }
            if let Some((port, url)) = std::fs::read(&info_file)
                .ok()
                .and_then(|b| parse_info(&b, pid))
            {
                on_bound(&app, pid, port, url);
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        log_line("[maude] Home server did not come up");
    });
}

fn on_bound(app: &AppHandle, pid: u32, port: u16, url: String) {
    let state = app.state::<SidecarState>();
    let cap_id = {
        let mut slot = state.home.lock().unwrap_or_else(|e| e.into_inner());
        let Some(h) = slot.as_mut() else { return };
        if h.child.as_ref().map(|c| c.pid()) != Some(pid) {
            return;
        }
        h.port = Some(port);
        h.url = Some(url.clone());
        if h.cap_ports.contains(&port) {
            None
        } else {
            let id = if h.cap_ports.is_empty() {
                "home".to_string()
            } else {
                format!("home-{port}")
            };
            h.cap_ports.push(port);
            Some(id)
        }
    };
    log_line(&format!("[maude] Home up at {url}"));
    if let Some(id) = cap_id {
        if let Err(e) = app.add_capability(home_capability(&id, port)) {
            log_line(&format!("[maude] could not add the Home capability: {e}"));
        }
    }
    crate::app_state::set_home_port(app, port);
    navigate_home(app);
}

/// The runtime capability for the Home window at the Home origin — the exact
/// `127.0.0.1` listener Home binds, not its `localhost` twin (a same-user
/// `[::1]:<port>` listener would answer that name; V2-3.6 W2). `local(false)`:
/// on the app-local splash the window gets only the static `home-splash`
/// capability (resolve_dev_server_url). A capability for a port Home no
/// longer owns cannot be removed (Tauri has no API), but the window can never
/// reach that port: the navigation guard admits the recorded origin only.
pub fn home_capability(id: &str, port: u16) -> CapabilityBuilder {
    // V2-3.7: the webview label, never a window — every tab lives in the one
    // `shell` window, and a window match would grant this to all of them.
    let mut b = CapabilityBuilder::new(id)
        .webview(HOME_LABEL)
        .local(false)
        .remote(format!("http://127.0.0.1:{port}/*"));
    for p in HOME_PERMISSIONS {
        b = b.permission(*p);
    }
    b
}

/// `(url, token)` of the bound Home server.
fn endpoint(app: &AppHandle) -> Option<(String, String)> {
    let state = app.try_state::<SidecarState>()?;
    let slot = state.home.lock().unwrap_or_else(|e| e.into_inner());
    let h = slot.as_ref()?;
    Some((h.url.clone()?, h.token.clone()))
}

/// The bound Home server's page secret (`None` while it is (re)starting).
fn page_secret<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let state = app.try_state::<SidecarState>()?;
    let slot = state.home.lock().unwrap_or_else(|e| e.into_inner());
    let h = slot.as_ref()?;
    h.port?;
    Some(h.page_secret.clone())
}

pub fn home_port<R: Runtime>(app: &AppHandle<R>) -> Option<u16> {
    let state = app.try_state::<SidecarState>()?;
    let slot = state.home.lock().unwrap_or_else(|e| e.into_inner());
    slot.as_ref()?.port
}

/// The Home URL once bound (`resolve_dev_server_url` from the Home splash).
pub async fn wait_home_url(app: &AppHandle, budget: Duration) -> Result<String, String> {
    let deadline = Instant::now() + budget;
    loop {
        if let Some((url, _)) = endpoint(app) {
            return Ok(url);
        }
        if Instant::now() >= deadline {
            return Err("Maude Home is still starting.".to_string());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// Stop the Home server (app quit). The caller already set `shutting_down`.
pub fn kill(app: &AppHandle) {
    let child = app.try_state::<SidecarState>().and_then(|s| {
        s.home
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
            .and_then(|h| h.child.take())
    });
    if let Some(c) = child {
        crate::sidecar::log_shutdown("[maude] quitting — stopping the Home server");
        crate::sidecar::terminate(c);
    }
}

// ── The caller gate (decision 7, §5.8 item 3) ──────────────────────────────

/// The Home origin is exactly `http://127.0.0.1:<port>` (W2: not the
/// `localhost` twin — Home binds 127.0.0.1 only).
fn on_home_origin(url: &tauri::Url, port: u16) -> bool {
    url.scheme() == "http" && url.port() == Some(port) && url.host_str() == Some("127.0.0.1")
}

/// Pure half of `caller_home`: the label is `home` AND the window's current URL
/// is on the Home origin (or, only where the command allows it, the app-local
/// splash). A `p-*` window on the Home URL, and `home` showing anything else,
/// answer for nobody.
pub fn check_home(
    label: &str,
    url: Option<&tauri::Url>,
    home_port: Option<u16>,
    allow_app_local: bool,
) -> Result<(), String> {
    if label != HOME_LABEL {
        return Err("Only the Home window can do that.".to_string());
    }
    let url = url.ok_or_else(|| "This window has no address.".to_string())?;
    if allow_app_local && windows::is_app_local(url) {
        return Ok(());
    }
    match home_port {
        Some(port) if on_home_origin(url, port) => Ok(()),
        _ => Err("This window isn't showing Home.".to_string()),
    }
}

pub fn caller_home<R: Runtime>(
    webview: &tauri::Webview<R>,
    allow_app_local: bool,
) -> Result<(), String> {
    let port = home_port(webview.app_handle());
    check_home(
        webview.label(),
        webview.url().ok().as_ref(),
        port,
        allow_app_local,
    )
}

// ── The Home window ─────────────────────────────────────────────────────────

/// Send the Home window to the Home origin (DDR-109: loopback only), recording
/// the origin in the book. A no-op until both the window and the server exist.
pub fn navigate_home(app: &AppHandle) {
    let Some((url, _)) = endpoint(app) else {
        return;
    };
    let Some(window) = app.get_webview(HOME_LABEL) else {
        return;
    };
    match url.parse::<tauri::Url>() {
        Ok(parsed) if crate::server_json::is_loopback_url(&parsed) => {
            stamp_home_origin(app, &url);
            if let Err(e) = window.navigate(parsed) {
                log_line(&format!("[maude] Home navigate failed: {e}"));
            }
        }
        _ => log_line(&format!(
            "[maude] refusing non-loopback Home url (DDR-109): {url}"
        )),
    }
}

/// Record the bound Home server's origin as the Home window's (the one its
/// navigations may reach, N-M2). Only the app-owned `endpoint` url counts;
/// anything else is ignored.
pub fn stamp_home_origin(app: &AppHandle, url: &str) {
    if endpoint(app).map(|(u, _)| u).as_deref() != Some(url) {
        return;
    }
    let Ok(parsed) = url.parse::<tauri::Url>() else {
        return;
    };
    if !crate::server_json::is_loopback_url(&parsed) {
        return;
    }
    if let Some(state) = app.try_state::<SidecarState>() {
        state
            .windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .set_origin(HOME_LABEL, &parsed.origin().ascii_serialization());
    }
}

/// Activate Home (V2-3.7: pinned, created once at boot, never closed), or
/// create it — its webview in the shell, sent to the Home origin. Returns
/// whether it was created. `caller` is unused since Home has no strip place
/// to be opened "after"; kept for the callers' shape.
pub fn ensure_home_window(app: &AppHandle, caller: Option<&str>) -> Result<bool, String> {
    let _ = caller;
    if app.get_webview(HOME_LABEL).is_some() {
        crate::tabs::reveal(app, HOME_LABEL)?;
        return Ok(false);
    }
    let state = app.state::<SidecarState>();
    let tick = state.tick.fetch_add(1, Ordering::SeqCst);
    // Written BEFORE the build so activation finds it. Never a strip tab.
    state
        .windows
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert_after(HOME_LABEL, Role::Home, tick, None);
    let spec = WindowSpec {
        label: HOME_LABEL.to_string(),
        title: "Home".to_string(),
        caller: None,
        background: false,
    };
    if let Err(e) = (windows::TauriHost { app }).create(&spec) {
        state
            .windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(HOME_LABEL);
        return Err(e);
    }
    navigate_home(app);
    Ok(true)
}

// ── ShellState (§5.4) ───────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellProject {
    pub pid: String,
    pub root: String,
    pub name: String,
    pub profile: String,
    /// `tab` | `resting` | `closed`.
    pub place: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub focused: bool,
    /// Live AI counts of a RUNNING tab, from the poller's cache of the
    /// authenticated `/_api/shell/status` probe (V2-3.5) — never probed on the
    /// `shell_state` path. Omitted for resting / closed projects and before the
    /// first probe answers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai: Option<ShellAi>,
    /// The hub the APP bound this project to — a managed copy's server, from
    /// the registry (or the app-owned managed index for an older copy). Never
    /// the project's own `linkedHub` claim: Home trusts only this to say a
    /// cloud project is "on this Mac" (V2-3.6 N-M4).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hub: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct ShellAi {
    pub running: u32,
    pub awaiting: u32,
}

/// A project's place against the live windows (§5.4): a tab, a resting tab,
/// or closed.
pub fn place_of(book: &WindowBook, pid: &str) -> (&'static str, Option<String>) {
    match book.label_for_pid(pid) {
        Some(l) if book.is_resting(&l) => ("resting", Some(l)),
        Some(l) => ("tab", Some(l)),
        None => ("closed", None),
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ShellProfile {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ShellState {
    pub projects: Vec<ShellProject>,
    pub profiles: Vec<ShellProfile>,
    pub recent: Vec<String>,
}

/// Pure: the registry (newest first) placed against the live windows.
pub fn build_shell_state(
    st: &AppState,
    book: &WindowBook,
    profiles: Vec<ShellProfile>,
    name_of: impl Fn(&str, &str) -> String,
    ai_of: impl Fn(&str) -> Option<ShellAi>,
    legacy_hub: impl Fn(&str) -> Option<String>,
) -> ShellState {
    let mut entries: Vec<_> = st.projects.iter().collect();
    entries.sort_by(|a, b| {
        b.1.last_opened_at
            .cmp(&a.1.last_opened_at)
            .then(a.0.cmp(b.0))
    });
    let projects = entries
        .into_iter()
        .map(|(pid, e)| {
            let (place, label) = place_of(book, pid);
            ShellProject {
                pid: pid.clone(),
                root: e.root.clone(),
                name: name_of(&e.root, &e.name),
                profile: e.profile.clone(),
                place,
                focused: label.is_some() && book.focused() == label.as_deref(),
                // Running tabs only: a resting or closed project has no server.
                ai: if place == "tab" { ai_of(&e.root) } else { None },
                hub: st.managed_server_of(pid).or_else(|| legacy_hub(&e.root)),
                label,
            }
        })
        .collect();
    let recent = st
        .recent
        .iter()
        .filter(|p| st.projects.contains_key(*p))
        .take(50)
        .cloned()
        .collect();
    ShellState {
        projects,
        profiles,
        recent,
    }
}

fn current_shell_state(app: &AppHandle) -> ShellState {
    let st = crate::app_state::load(app);
    let profiles = crate::profiles::list_all()
        .into_iter()
        .map(|p| ShellProfile {
            id: p.id,
            label: p.label,
            email: p.cloud_email,
        })
        .collect();
    let copies = crate::managed::bound_copies(app);
    let state = app.state::<SidecarState>();
    let book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
    build_shell_state(
        &st,
        &book,
        profiles,
        |root, name| {
            if Path::new(root).is_dir() {
                windows::project_display_name(root)
            } else {
                crate::notify::sanitize_title(name)
            }
        },
        |root| {
            crate::notify::cached_ai(app, root).map(|a| ShellAi {
                running: a.running,
                awaiting: a.awaiting,
            })
        },
        |root| {
            copies
                .iter()
                .find(|(path, _)| windows::pid_for_root(path) == windows::pid_for_root(root))
                .map(|(_, server)| server.clone())
        },
    )
}

static STATE_GEN: AtomicU64 = AtomicU64::new(0);

/// A tab, focus or registry change: tell Home (only), at most once per 250 ms.
pub fn state_changed(app: &AppHandle) {
    if app.get_webview(HOME_LABEL).is_none() {
        return;
    }
    let gen = STATE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STATE_DEBOUNCE).await;
        if STATE_GEN.load(Ordering::SeqCst) != gen || app.try_state::<SidecarState>().is_none() {
            return;
        }
        let s = current_shell_state(&app);
        // Home's own channel only: a project page must never read this (1d).
        crate::bus::send(HOME_LABEL, "shell://state", s);
    });
}

// ── index://changed (§5.4 Events, §5.6 step 5; V2-3.10) ─────────────────────

/// How often the shell looks at the running projects' index snapshots.
const INDEX_WATCH_MS: u64 = 1_000;

/// The snapshot mtimes seen last tick, per running project pid.
#[derive(Default)]
pub struct IndexWatch {
    seen: HashMap<String, Option<std::time::SystemTime>>,
}

impl IndexWatch {
    /// `now` is `(pid, snapshot mtime)` for every RUNNING project. Returns the
    /// pids whose snapshot changed since the last tick (a first snapshot counts;
    /// no snapshot is not news), sorted; a pid no longer running is forgotten,
    /// so its next sighting is news again.
    pub fn tick(&mut self, now: Vec<(String, Option<std::time::SystemTime>)>) -> Vec<String> {
        let mut changed = Vec::new();
        let mut next = HashMap::with_capacity(now.len());
        for (pid, mtime) in now {
            let prev = self.seen.get(&pid).copied().flatten();
            if mtime.is_some() && mtime != prev {
                changed.push(pid.clone());
            }
            next.insert(pid, mtime);
        }
        self.seen = next;
        changed.sort();
        changed.dedup();
        changed
    }
}

/// Tell Home when a running project's index changes, so its rows refetch live
/// (`index://changed {pids}`; home-app.jsx refetches exactly those). The
/// project server writes `<index dir>/projects/<pid>/index.json` on every
/// canvas change (index/service.ts); the shell watches only the mtimes of the
/// RUNNING projects' snapshots — a closed project changes only through Home's
/// own rebuild-on-read. Payload: pids only, never paths. Emitted to Home only;
/// a missing Home window makes it a no-op (Home refetches all on load).
pub fn spawn_index_watch(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut watch = IndexWatch::default();
        loop {
            tokio::time::sleep(Duration::from_millis(INDEX_WATCH_MS)).await;
            let Some(state) = app.try_state::<SidecarState>() else {
                continue;
            };
            if state.shutting_down.load(Ordering::SeqCst) {
                break;
            }
            let roots: Vec<String> = state
                .instances
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .keys()
                .cloned()
                .collect();
            let Some(dir) = index_dir().map(|d| d.join("projects")) else {
                continue;
            };
            let now = roots
                .iter()
                .map(|root| {
                    let pid = windows::pid_for_root(root);
                    let mtime = std::fs::metadata(dir.join(&pid).join("index.json"))
                        .and_then(|m| m.modified())
                        .ok();
                    (pid, mtime)
                })
                .collect();
            let pids = watch.tick(now);
            if !pids.is_empty() {
                crate::bus::send(HOME_LABEL, "index://changed", json!({ "pids": pids }));
            }
        }
    });
}

// ── Intents (§5.4 "The create-from-Home intent") ────────────────────────────

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenIntent {
    pub kind: String,
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_hint: Option<String>,
}

pub fn validate_intent(i: OpenIntent) -> Result<OpenIntent, String> {
    let ok = i.kind == "create-canvas"
        && !i.prompt.trim().is_empty()
        && i.prompt.chars().count() <= 4000
        && i.project_hint
            .as_ref()
            .is_none_or(|h| h.chars().count() <= 200);
    if ok {
        Ok(i)
    } else {
        Err("That request can't be opened.".to_string())
    }
}

/// Parked per window label; taken once by that window only.
static INTENTS: Mutex<Option<HashMap<String, OpenIntent>>> = Mutex::new(None);

pub fn park_intent(label: &str, intent: OpenIntent) {
    INTENTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_or_insert_with(HashMap::new)
        .insert(label.to_string(), intent);
    // A nudge only — the payload is never in the event.
    crate::bus::send(label, "shell://intent", ());
}

/// `park_intent` without the nudge (no `AppHandle` in a unit test).
#[cfg(test)]
pub(crate) fn park_intent_for_test(label: &str, intent: OpenIntent) {
    INTENTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_or_insert_with(HashMap::new)
        .insert(label.to_string(), intent);
}

pub fn take_intent(label: &str) -> Option<OpenIntent> {
    INTENTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_mut()?
        .remove(label)
}

// ── index_search scope (§5.8 item 4) ────────────────────────────────────────

/// The pids a project window may search: registry projects bound to the
/// caller's profile, minus the caller itself.
pub fn index_scope(st: &AppState, caller_pid: &str, caller_profile: &str) -> Vec<String> {
    st.projects
        .iter()
        .filter(|(pid, e)| pid.as_str() != caller_pid && e.profile == caller_profile)
        .map(|(pid, _)| pid.clone())
        .collect()
}

/// The fields a cross-project row may carry (V2-1.17 §5.2 projection, plus the
/// inlined picture this shell adds).
const ROW_FIELDS: &[&str] = &[
    "group", "key", "name", "meta", "score", "close", "marks", "cover",
];

/// Pure: keep only groups inside `scope` and only projection fields, and place
/// each group against the live windows.
pub fn shape_search(
    resp: &Value,
    scope: &[String],
    place_of: impl Fn(&str) -> &'static str,
) -> Vec<Value> {
    let Some(groups) = resp.get("groups").and_then(Value::as_array) else {
        return Vec::new();
    };
    groups
        .iter()
        .filter_map(|g| {
            let pid = g.get("pid")?.as_str()?;
            if !scope.iter().any(|p| p == pid) {
                return None;
            }
            let rows: Vec<Value> = g
                .get("rows")
                .and_then(Value::as_array)
                .map(|rows| {
                    rows.iter()
                        .filter_map(Value::as_object)
                        .map(|r| {
                            Value::Object(
                                r.iter()
                                    .filter(|(k, _)| ROW_FIELDS.contains(&k.as_str()))
                                    .map(|(k, v)| (k.clone(), v.clone()))
                                    .collect(),
                            )
                        })
                        .collect()
                })
                .unwrap_or_default();
            Some(json!({
                "pid": pid,
                "name": g.get("name").and_then(Value::as_str).unwrap_or(""),
                "place": place_of(pid),
                "rows": rows,
            }))
        })
        .collect()
}

fn internal_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("http client: {e}"))
}

async fn internal_get(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    query: &[(&str, String)],
) -> Result<Value, String> {
    client
        .get(url)
        .query(query)
        .header(HOME_HEADER, "1")
        .bearer_auth(token)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Home search failed: {e}"))?
        .json::<Value>()
        .await
        .map_err(|e| format!("Home search answered oddly: {e}"))
}

/// Inline each row's cover as a `data:` JPEG (`/_home/internal/thumbs`, ≤ 50
/// keys per call, only keys that pid's snapshot references).
async fn attach_thumbs(client: &reqwest::Client, base: &str, token: &str, groups: &mut [Value]) {
    for g in groups.iter_mut() {
        let pid = g["pid"].as_str().unwrap_or_default().to_string();
        let mut keys: Vec<String> = g["rows"]
            .as_array()
            .map(|rows| {
                rows.iter()
                    .filter_map(|r| r.get("cover").and_then(Value::as_str).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        keys.sort();
        keys.dedup();
        keys.truncate(MAX_THUMB_KEYS);
        if keys.is_empty() {
            continue;
        }
        let Ok(resp) = internal_get(
            client,
            &format!("{base}/_home/internal/thumbs"),
            token,
            &[("pid", pid), ("keys", keys.join(","))],
        )
        .await
        else {
            continue;
        };
        let thumbs = resp.get("thumbs").cloned().unwrap_or(Value::Null);
        if let Some(rows) = g["rows"].as_array_mut() {
            for r in rows.iter_mut() {
                let b64 = r
                    .get("cover")
                    .and_then(Value::as_str)
                    .and_then(|k| thumbs.get(k))
                    .and_then(Value::as_str)
                    .filter(|s| {
                        s.bytes()
                            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
                    })
                    .map(|s| format!("data:image/jpeg;base64,{s}"));
                if let (Some(obj), Some(src)) = (r.as_object_mut(), b64) {
                    obj.insert("thumb".to_string(), Value::String(src));
                }
            }
        }
    }
}

// ── Commands (§5.4) ─────────────────────────────────────────────────────────

/// `shell_state()` — Home only.
#[tauri::command]
pub fn shell_state(app: AppHandle, webview: tauri::Webview) -> Result<ShellState, String> {
    caller_home(&webview, false)?;
    Ok(current_shell_state(&app))
}

/// What `home_session()` answers: the Home page secret.
#[derive(Debug, Serialize)]
pub struct HomeSession {
    pub secret: String,
}

/// Pure half of `home_session`: the caller gate first (`home` on the Home
/// origin — never the app-local splash, never a project window), then the
/// secret of the server that origin belongs to.
pub fn session_for(
    label: &str,
    url: Option<&tauri::Url>,
    home_port: Option<u16>,
    secret: Option<&str>,
) -> Result<HomeSession, String> {
    check_home(label, url, home_port, false)?;
    secret
        .map(|s| HomeSession {
            secret: s.to_string(),
        })
        .ok_or_else(|| "Maude Home is still starting.".to_string())
}

/// `home_session()` — Home only (V2-3.6 H1): the page secret the Home page
/// sends as `x-maude-home` on every request to the Home server.
#[tauri::command]
pub fn home_session(app: AppHandle, webview: tauri::Webview) -> Result<HomeSession, String> {
    let secret = page_secret(&app);
    session_for(
        webview.label(),
        webview.url().ok().as_ref(),
        home_port(&app),
        secret.as_deref(),
    )
}

/// `new_home_tab()` (⌘T, Back to Home) — activate the pinned Home tab. Either
/// role — also from a tab still on its splash (it only shows Home; nothing is
/// read or written for the caller).
#[tauri::command]
pub async fn new_home_tab(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    // 1g: a background project tab may not switch the active tab.
    if let windows::Caller::Project(_) = windows::caller_any(&webview, true)? {
        windows::caller_in_front(&webview)?;
    }
    ensure_home_window(&app, Some(webview.label())).map(|_| ())
}

/// `take_pending_intent()` — the intent parked for THIS project window, once.
#[tauri::command]
pub fn take_pending_intent(webview: tauri::Webview) -> Result<Option<OpenIntent>, String> {
    let caller = windows::caller_project(&webview, false)?;
    Ok(take_intent(&caller.label))
}

/// `index_search({q, limit?})` — a project window's cross-project ⌘K, brokered
/// through the Home server's internal route (decision 6: no HTTP between
/// origins). Scope = same profile, minus the caller (§5.8 item 4).
#[tauri::command]
pub async fn index_search(
    app: AppHandle,
    webview: tauri::Webview,
    q: String,
    limit: Option<u32>,
) -> Result<Value, String> {
    let caller = windows::caller_project(&webview, false)?;
    let st = crate::app_state::load(&app);
    let profile = st.profile_for(&caller.root);
    let scope = index_scope(&st, &caller.pid, &profile);
    if scope.is_empty() {
        return Ok(json!({ "groups": [] }));
    }
    let (base, token) = endpoint(&app).ok_or_else(|| "Maude Home isn't running.".to_string())?;
    let q: String = q.chars().take(200).collect();
    let limit = limit.unwrap_or(50).clamp(1, 50);
    let client = internal_client()?;
    let resp = internal_get(
        &client,
        &format!("{base}/_home/internal/search"),
        &token,
        &[
            ("q", q),
            ("pids", scope.join(",")),
            ("limit", limit.to_string()),
        ],
    )
    .await?;
    let mut groups = {
        let state = app.state::<SidecarState>();
        let book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
        shape_search(&resp, &scope, |pid| place_of(&book, pid).0)
    };
    attach_thumbs(&client, &base, &token, &mut groups).await;
    Ok(json!({ "groups": groups }))
}

/// What a project tab refuses with for a pid it may not open — ONE answer for
/// another profile's project and for a pid nobody registered, so a page
/// learns nothing about which pids exist outside its scope.
pub const NOT_THIS_TABS: &str = "That project isn't one this tab can open.";

/// THE rule for a project tab opening another project by pid (S15-A4): only
/// a pid `index_search` could have answered for it — `index_scope` (the
/// caller's profile, minus the caller). `open_search_result` and the pid path
/// of `open_project` both go through here; `open_project` adds the caller's
/// own pid in front of it (open once focuses itself).
pub fn tab_may_open<'a>(
    st: &'a AppState,
    caller_pid: &str,
    caller_profile: &str,
    pid: &str,
) -> Result<&'a crate::app_state::ProjectEntry, String> {
    if !index_scope(st, caller_pid, caller_profile)
        .iter()
        .any(|p| p == pid)
    {
        return Err(NOT_THIS_TABS.to_string());
    }
    st.projects.get(pid).ok_or_else(|| NOT_THIS_TABS.to_string())
}

/// Pure half of `open_search_result` (S1.5, decision
/// `v2-S1-cross-project-open-command`): the folder and the target a ⌘K row of
/// ANOTHER project names. Only a pid `index_search` could have answered for
/// this caller — `index_scope` (same profile, minus the caller) — so a page can
/// never reach a project of another account through it, nor its own project
/// (its own rows open in-page). The canvas goes through the same check as a
/// deep link's `open`; the artboard as a short plain id (`validate_target`).
pub fn search_result_target(
    st: &AppState,
    caller_pid: &str,
    caller_profile: &str,
    pid: &str,
    canvas: String,
    artboard: Option<String>,
) -> Result<(PathBuf, windows::OpenTarget), String> {
    let entry = tab_may_open(st, caller_pid, caller_profile, pid)?;
    let target = windows::validate_target(windows::OpenTarget {
        canvas: Some(canvas),
        artboard,
    })?;
    Ok((PathBuf::from(&entry.root), target))
}

/// `open_search_result({pid, canvas, artboard?})` — ↵ on a ⌘K row of another
/// project (11 `pn-k-across`). Project windows only, from the tab in front.
/// Takes ids, never a URL or a path: the folder comes from the registry entry
/// of a pid in `index_scope(caller)`. Open once (`open_project_window`): a
/// project already in a tab is switched to and told `shell://navigate`; a
/// closed one opens a tab after the caller whose first navigate carries
/// `?open=<canvas>` and the artboard parked for `take_pending_navigate` — the
/// same path `open_project` and a deep link take. `async`: building a window
/// from a sync command deadlocks on Windows.
#[tauri::command]
pub async fn open_search_result(
    app: AppHandle,
    webview: tauri::Webview,
    pid: String,
    canvas: String,
    artboard: Option<String>,
) -> Result<windows::OpenedProject, String> {
    let caller = windows::caller_project(&webview, false)?;
    // 1g: a background tab may not switch tabs; S15-A3: claimed, so a second
    // ↵ racing this one is refused until it returns.
    let _front = windows::claim_front(&webview)?;
    let st = crate::app_state::load(&app);
    let profile = st.profile_for(&caller.root);
    let (path, target) =
        search_result_target(&st, &caller.pid, &profile, &pid, canvas, artboard)?;
    if !path.is_dir() {
        return Err("That project folder doesn’t exist.".to_string());
    }
    // S15-A1: the scope check saw the target's binding as it is — the open
    // must not re-bind an unbound target to `lastSignInProfile`.
    let opened = windows::open_project_window(
        &app,
        &path,
        Some(webview.label()),
        target.canvas.as_deref(),
        crate::app_state::Binding::Keep,
    )?;
    windows::park_navigate_for_new(&opened, Some(&target));
    if let windows::Opened::Existing(label) = &opened {
        crate::bus::send(label, "shell://navigate", target.clone());
    }
    Ok(windows::OpenedProject::from(&opened))
}

/// The machine index root (`$MAUDE_INDEX_DIR`, default `~/.maude/index/v1` —
/// apps/studio/index/snapshot.ts).
fn index_dir() -> Option<PathBuf> {
    match std::env::var("MAUDE_INDEX_DIR") {
        Ok(d) if !d.is_empty() => Some(PathBuf::from(d)),
        _ => std::env::var_os("HOME")
            .map(|h| PathBuf::from(h).join(".maude").join("index").join("v1")),
    }
}

/// Who may relink `pid` (V2-3.6 N-M6, widened by S1.19): Home any registered
/// project; a project tab only its OWN, and only while its folder is gone —
/// the tab on the moved-folder card. The new folder inherits the entry's
/// profile, so a page must never rebind another project (another profile's),
/// nor its own working project, to a folder the person picks without knowing
/// what for. `missing` is `tabs::root_missing`, read from disk per call.
pub fn relink_allowed(
    caller: &windows::Caller,
    pid: &str,
    missing: impl Fn(&str) -> bool,
) -> Result<(), String> {
    match caller {
        windows::Caller::Home => Ok(()),
        windows::Caller::Project(c) if c.pid == pid && missing(&c.root) => Ok(()),
        windows::Caller::Project(c) if c.pid == pid => {
            Err("This project's folder is where it was.".to_string())
        }
        windows::Caller::Project(_) => {
            Err("A project window can only find the folder of its own project.".to_string())
        }
    }
}

/// `relink_project({pid})` — "Find the folder…": pick where the project moved
/// to, rebind its registry entry, carry its index entry over, and move the tab
/// showing it to the new folder (`tabs::follow_relink`). Home, or the tab
/// whose folder is gone, for itself (`relink_allowed`) — from the app-local
/// card (`root-missing.html`), the one project-tab page on that origin that
/// may ask. The picker is a sheet on the calling window, titled with the
/// project it is for. Resolves the new pid, or `null` when cancelled.
#[tauri::command]
pub async fn relink_project(
    app: AppHandle,
    webview: tauri::Webview,
    pid: String,
) -> Result<Option<String>, String> {
    let who = if webview.label() == HOME_LABEL {
        windows::caller_any(&webview, false)?
    } else {
        windows::Caller::Project(windows::caller_project(&webview, true)?)
    };
    // 1g: no native dialog from a hidden tab; S15-A3: one picker at a time.
    let _front = windows::claim_front(&webview)?;
    relink_allowed(&who, &pid, crate::tabs::root_missing)?;
    let name = match crate::app_state::load(&app).projects.get(&pid) {
        Some(e) => crate::notify::sanitize_title(&e.name),
        None => return Err("That project isn't in your list.".to_string()),
    };
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_parent(&webview.window())
        .set_title(format!("Find the folder for {name}"))
        .pick_folder(move |f| {
            let _ = tx.send(f.and_then(|f| f.as_path().map(Path::to_path_buf)));
        });
    let Some(folder) = rx
        .await
        .map_err(|_| "The folder picker closed unexpectedly.".to_string())?
    else {
        return Ok(None);
    };
    if !folder.join(".design").is_dir() {
        return Err("That folder isn’t a Maude project (no design system).".to_string());
    }
    let new_pid = crate::app_state::relink_project(&app, &pid, &folder)?;
    if new_pid != pid {
        if let Some(dir) = index_dir().map(|d| d.join("projects")) {
            let (from, to) = (dir.join(&pid), dir.join(&new_pid));
            if from.is_dir() && !to.exists() {
                let _ = std::fs::rename(from, to);
            }
        }
    }
    crate::tabs::follow_relink(&app, &pid, &folder.to_string_lossy());
    state_changed(&app);
    Ok(Some(new_pid))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// V2-3.10: `index://changed` names the running projects whose snapshot
    /// changed since the last tick — a first snapshot counts, an unchanged one
    /// does not, and a project that stopped running is forgotten.
    #[test]
    fn index_watch_reports_only_changed_snapshots() {
        use std::time::UNIX_EPOCH;
        let t = |s: u64| Some(UNIX_EPOCH + Duration::from_secs(s));
        let mut w = IndexWatch::default();
        let first = w.tick(vec![("la".into(), t(1)), ("lb".into(), None)]);
        assert_eq!(first, vec!["la".to_string()], "a first snapshot is news; no snapshot is not");
        assert!(w.tick(vec![("la".into(), t(1)), ("lb".into(), None)]).is_empty());
        assert_eq!(
            w.tick(vec![("la".into(), t(2)), ("lb".into(), t(5))]),
            vec!["la".to_string(), "lb".to_string()]
        );
        // la stops running, then runs again with the same snapshot: news again
        // (Home may have missed it while it was closed).
        assert!(w.tick(vec![("lb".into(), t(5))]).is_empty());
        assert_eq!(w.tick(vec![("la".into(), t(2)), ("lb".into(), t(5))]), vec!["la".to_string()]);
    }

    fn url(s: &str) -> tauri::Url {
        s.parse().unwrap()
    }

    /// N-M6 (audit 2): a project window relinks only itself; Home any.
    /// N-M4: ShellState names a project's hub only from the app's own binding.
    #[test]
    fn shell_state_hub_is_the_apps_binding_never_the_projects_claim() {
        let mut st = AppState::default();
        let copy = st.bind_managed("/data/c", "default", "https://a.cloud.maude.sh", "a", 2);
        let plain = st.upsert("/x/claims-a-hub", 1);
        let book = WindowBook::default();
        let legacy = |root: &str| (root == "/data/old").then(|| "https://b.cloud.maude.sh".to_string());
        st.upsert("/data/old", 3);
        let s = build_shell_state(&st, &book, Vec::new(), |_, n| n.to_string(), |_| None, legacy);
        let hub = |pid: &str| s.projects.iter().find(|p| p.pid == pid).unwrap().hub.clone();
        assert_eq!(hub(&copy).as_deref(), Some("https://a.cloud.maude.sh"));
        assert_eq!(hub(&plain), None);
        assert_eq!(
            hub(&windows::pid_for_root("/data/old")).as_deref(),
            Some("https://b.cloud.maude.sh")
        );
    }

    /// S1.19: Find the folder… from a tab works only for the tab whose folder
    /// is gone, for its own project — the card's tab. A tab whose folder is
    /// where it was is refused (it would rebind a working project to a folder
    /// picked for something else), and so is every other tab, even one whose
    /// own folder is gone. Home relinks any registered project.
    #[test]
    fn relink_from_missing_tab_only() {
        let base = std::env::temp_dir().join(format!("maude-s119-relink-{}", std::process::id()));
        let here = base.join("here");
        std::fs::create_dir_all(here.join(".design")).unwrap();
        let gone = base.join("gone"); // never created: the folder moved away
        let tab = |pid: &str, root: &std::path::Path| {
            windows::Caller::Project(windows::CallerProject {
                label: format!("p-{pid}"),
                pid: pid.into(),
                root: root.to_string_lossy().into(),
            })
        };
        let missing = crate::tabs::root_missing;
        let card = tab("laaaaaaaaaaaaaaaa", &gone);
        let working = tab("lcccccccccccccccc", &here);
        assert!(relink_allowed(&card, "laaaaaaaaaaaaaaaa", missing).is_ok(), "the card's own relink");
        assert!(
            relink_allowed(&working, "lcccccccccccccccc", missing).is_err(),
            "a tab whose folder is where it was relinked itself"
        );
        assert!(relink_allowed(&card, "lbbbbbbbbbbbbbbbb", missing).is_err(), "another tab's project");
        assert!(relink_allowed(&working, "laaaaaaaaaaaaaaaa", missing).is_err(), "the card's project from another tab");
        assert!(relink_allowed(&windows::Caller::Home, "lbbbbbbbbbbbbbbbb", missing).is_ok());
        // The command: a tab is resolved WITH the app-local origin (the card),
        // Home without it; claimed in front; then the rule above; then the tab
        // follows the relink.
        let src = include_str!("home.rs");
        let i = src.find("pub async fn relink_project(").unwrap();
        let body = &src[i..i + src[i + 1..].find("#[cfg(test)]").unwrap()];
        for needle in [
            "windows::caller_any(&webview, false)?",
            "windows::caller_project(&webview, true)?",
            "claim_front(&webview)?",
            "relink_allowed(&who, &pid, crate::tabs::root_missing)?",
            "follow_relink(",
        ] {
            assert!(body.contains(needle), "relink_project lost {needle}");
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn home_gate_needs_the_home_label_and_the_home_origin() {
        let home = url("http://127.0.0.1:4500/");
        // A project window that navigated to the Home URL is not Home.
        assert!(check_home("p-l0123456789abcdef", Some(&home), Some(4500), false).is_err());
        // Home showing a non-Home origin (a project server, another port) is refused.
        assert!(check_home(
            "home",
            Some(&url("http://localhost:4399/")),
            Some(4500),
            false
        )
        .is_err());
        assert!(check_home(
            "home",
            Some(&url("http://127.0.0.1:4501/")),
            Some(4500),
            false
        )
        .is_err());
        assert!(check_home(
            "home",
            Some(&url("https://127.0.0.1:4500/")),
            Some(4500),
            false
        )
        .is_err());
        // No Home server bound yet → no Home origin → refused.
        assert!(check_home("home", Some(&home), None, false).is_err());
        // The splash only where the command allows it.
        let splash = url("tauri://localhost/index.html");
        assert!(check_home("home", Some(&splash), Some(4500), false).is_err());
        assert!(check_home("home", Some(&splash), Some(4500), true).is_ok());
        // The real thing — and NOT its localhost twin (W2: a same-user
        // `[::1]:4500` listener would answer that name).
        assert!(check_home("home", Some(&url("http://127.0.0.1:4500/x?y")), Some(4500), false).is_ok());
        assert!(check_home(
            "home",
            Some(&url("http://localhost:4500/x?y")),
            Some(4500),
            false
        )
        .is_err());
    }

    // V2-3.6 H1 — the page secret is the Home server's page-route capability; only the
    // Home window on the Home origin may read it.
    #[test]
    fn home_session_answers_only_home_on_the_home_origin() {
        let home = url("http://127.0.0.1:4500/");
        let secret = "ef".repeat(32);
        let s = Some(secret.as_str());
        // A project window — even one that navigated to the Home URL — gets nothing.
        assert!(session_for("p-l0123456789abcdef", Some(&home), Some(4500), s).is_err());
        // Home showing a project server / another port / the app-local splash gets nothing.
        for other in [
            "http://localhost:4399/",
            "http://127.0.0.1:4501/",
            "tauri://localhost/index.html",
        ] {
            assert!(session_for("home", Some(&url(other)), Some(4500), s).is_err());
        }
        // Not bound yet, or no secret minted yet.
        assert!(session_for("home", Some(&home), None, s).is_err());
        assert!(session_for("home", Some(&home), Some(4500), None).is_err());
        // The real thing.
        assert_eq!(
            session_for("home", Some(&home), Some(4500), s)
                .unwrap()
                .secret,
            secret
        );
    }

    #[test]
    fn the_page_secret_is_never_the_internal_bearer() {
        for _ in 0..32 {
            let (bearer, page) = mint_secrets().unwrap();
            assert_ne!(bearer, page);
            for t in [&bearer, &page] {
                assert_eq!(t.len(), 64);
                assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
            }
        }
        assert!(HOME_PERMISSIONS.contains(&"allow-home-session"));
    }

    #[derive(Default)]
    struct FakeSpawner {
        spawns: RefCell<Vec<(u32, Duration)>>,
        gave_up: RefCell<u32>,
    }
    impl HomeSpawner for FakeSpawner {
        fn spawn_after(&self, attempt: u32, delay: Duration) {
            self.spawns.borrow_mut().push((attempt, delay));
        }
        fn give_up(&self) {
            *self.gave_up.borrow_mut() += 1;
        }
    }

    #[test]
    fn home_supervisor_respawns_three_times_then_gives_up() {
        let sp = FakeSpawner::default();
        let mut b = RestartBudget::default();
        let quick = Duration::from_secs(1);
        assert_eq!(on_death(&mut b, quick, &sp), Some(1));
        assert_eq!(on_death(&mut b, quick, &sp), Some(2));
        assert_eq!(on_death(&mut b, quick, &sp), Some(3));
        assert_eq!(on_death(&mut b, quick, &sp), None);
        assert_eq!(
            sp.spawns.borrow().iter().map(|s| s.0).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(*sp.gave_up.borrow(), 1);
        // "Try again" starts from a fresh budget.
        assert_eq!(b.restarts, 0);
        // A death after a healthy run opens a new budget instead of spending it.
        on_death(&mut b, quick, &sp);
        on_death(&mut b, quick, &sp);
        assert_eq!(on_death(&mut b, Duration::from_secs(600), &sp), Some(1));
        assert_eq!(*sp.gave_up.borrow(), 1);
    }

    #[test]
    fn info_file_must_name_this_child_on_loopback() {
        let ok =
            br#"{"pid":7,"port":4500,"url":"http://127.0.0.1:4500","started":"x","mode":"home"}"#;
        assert_eq!(
            parse_info(ok, 7),
            Some((4500, "http://127.0.0.1:4500".to_string()))
        );
        assert_eq!(parse_info(ok, 8), None, "another child's record");
        let project = br#"{"pid":7,"port":4500,"url":"http://127.0.0.1:4500","mode":"project"}"#;
        assert_eq!(parse_info(project, 7), None);
        let elsewhere = br#"{"pid":7,"port":4500,"url":"http://evil.example:4500","mode":"home"}"#;
        assert_eq!(parse_info(elsewhere, 7), None);
        let mismatch = br#"{"pid":7,"port":4500,"url":"http://127.0.0.1:4501","mode":"home"}"#;
        assert_eq!(parse_info(mismatch, 7), None);
        assert_eq!(parse_info(b"{", 7), None);
    }

    fn entry(root: &str, profile: &str, opened: u64) -> crate::app_state::ProjectEntry {
        serde_json::from_value(json!({
            "root": root, "name": root.trim_start_matches('/'), "profile": profile,
            "lastOpenedAt": opened
        }))
        .unwrap()
    }

    fn registry() -> AppState {
        let mut st = AppState::default();
        st.projects.insert("la".into(), entry("/a", "default", 3));
        st.projects.insert("lb".into(), entry("/b", "default", 2));
        st.projects.insert("lw".into(), entry("/w", "work", 1));
        st.recent = vec!["lb".into(), "la".into(), "gone".into()];
        st
    }

    /// S1.5: ↵ on another project's ⌘K row opens only a pid `index_search`
    /// could have answered for this caller — never another profile's project
    /// (a planted pid), never the caller's own, never an unknown one — and the
    /// canvas / artboard go through the deep-link checks.
    #[test]
    fn open_search_result_scope() {
        let st = registry();
        let ok = search_result_target(&st, "la", "default", "lb", "ui/y.tsx".into(), Some("hero".into()))
            .expect("a same-profile project opens");
        assert_eq!(ok.0, PathBuf::from("/b"));
        assert_eq!(ok.1.canvas.as_deref(), Some("ui/y.tsx"));
        assert_eq!(ok.1.artboard.as_deref(), Some("hero"));
        // A pid outside index_scope(caller): another account's project.
        assert!(
            search_result_target(&st, "la", "default", "lw", "ui/x.tsx".into(), None).is_err(),
            "a project of another profile opened from a project tab"
        );
        // The caller's own project is not in its scope (its rows open in-page).
        assert!(search_result_target(&st, "la", "default", "la", "ui/x.tsx".into(), None).is_err());
        assert!(search_result_target(&st, "la", "default", "nope", "ui/x.tsx".into(), None).is_err());
        // The profile is the caller's, not the target's: a `work` caller can't reach `default`.
        assert!(search_result_target(&st, "lw", "work", "lb", "ui/y.tsx".into(), None).is_err());
        // Ids only — no path out of the design root, no control characters.
        for bad in ["../secrets.tsx", "/etc/passwd", ""] {
            assert!(
                search_result_target(&st, "la", "default", "lb", bad.into(), None).is_err(),
                "{bad:?} accepted as a canvas"
            );
        }
        assert!(
            search_result_target(&st, "la", "default", "lb", "ui/y.tsx".into(), Some("a\nb".into())).is_err()
        );
        // The command resolves its caller from the webview, asks for the front
        // tab, scopes through `search_result_target` and opens once.
        let src = include_str!("home.rs");
        let i = src.find("pub async fn open_search_result(").unwrap();
        let body = &src[i..i + src[i + 1..].find("#[tauri::command").map_or(src.len() - i, |e| e + 1)];
        for needle in [
            "windows::caller_project(&webview, false)?",
            "claim_front(&webview)?",
            "search_result_target(",
            "open_project_window(",
            "crate::app_state::Binding::Keep",
            "park_navigate_for_new(",
        ] {
            assert!(body.contains(needle), "open_search_result lost {needle}");
        }
        assert!(!body.contains("root:"), "a page-supplied path reached the command");
    }

    #[test]
    fn index_search_scope_is_the_callers_profile_minus_the_caller() {
        let st = registry();
        let mut s = index_scope(&st, "la", "default");
        s.sort();
        assert_eq!(
            s,
            vec!["lb".to_string()],
            "never the caller, never another profile"
        );
        assert_eq!(index_scope(&st, "lw", "work"), Vec::<String>::new());
        // Defense in depth: a group the server returned outside the scope is dropped,
        // and a row keeps only projection fields.
        let resp = json!({ "groups": [
            { "pid": "lw", "name": "Work", "rows": [{ "key": "ui/x.tsx" }] },
            { "pid": "la", "name": "Self", "rows": [] },
            { "pid": "lb", "name": "B", "rows": [{ "key": "ui/y.tsx", "name": "y", "source": "SECRET", "cover": "k1" }] }
        ]});
        let shaped = shape_search(&resp, &s, |_| "closed");
        assert_eq!(shaped.len(), 1);
        assert_eq!(shaped[0]["pid"], "lb");
        assert_eq!(shaped[0]["place"], "closed");
        let row = &shaped[0]["rows"][0];
        assert_eq!(row["key"], "ui/y.tsx");
        assert_eq!(row["cover"], "k1");
        assert!(row.get("source").is_none());
    }

    #[test]
    fn shell_state_places_projects_against_the_windows() {
        let st = registry();
        let mut book = WindowBook::default();
        book.insert(HOME_LABEL, Role::Home, 1);
        book.insert(
            "p-lb",
            Role::Project {
                pid: "lb".into(),
                root: "/b".into(),
            },
            2,
        );
        book.focus("p-lb", 3);
        let s = build_shell_state(&st, &book, Vec::new(), |_, n| n.to_string(), |_| None, |_| None);
        let pids: Vec<_> = s.projects.iter().map(|p| p.pid.as_str()).collect();
        assert_eq!(pids, vec!["la", "lb", "lw"], "newest first");
        let b = &s.projects[1];
        assert_eq!(
            (b.place, b.label.as_deref(), b.focused),
            ("tab", Some("p-lb"), true)
        );
        assert_eq!(
            (s.projects[0].place, s.projects[0].focused),
            ("closed", false)
        );
        assert_eq!(
            s.recent,
            vec!["lb".to_string(), "la".to_string()],
            "unknown pids dropped"
        );
        let v = serde_json::to_value(&s.projects[0]).unwrap();
        assert!(v.get("label").is_none() && v.get("ai").is_none());
    }

    #[test]
    fn shell_state_reports_resting_and_ai_from_the_cached_status() {
        let st = registry();
        let mut book = WindowBook::default();
        book.insert(HOME_LABEL, Role::Home, 1);
        for (label, pid) in [("p-la", "la"), ("p-lb", "lb")] {
            let root = st.projects[pid].root.clone();
            book.insert(
                label,
                Role::Project {
                    pid: pid.into(),
                    root,
                },
                2,
            );
        }
        book.set_resting("p-la", true);
        // A stubbed probe cache that answers for EVERY root, resting ones too.
        let ai = |_: &str| {
            Some(ShellAi {
                running: 1,
                awaiting: 2,
            })
        };
        let s = build_shell_state(&st, &book, Vec::new(), |_, n| n.to_string(), ai, |_| None);
        let by = |pid: &str| s.projects.iter().find(|p| p.pid == pid).unwrap().clone();
        let (a, b, w) = (by("la"), by("lb"), by("lw"));
        assert_eq!((a.place, a.label.as_deref()), ("resting", Some("p-la")));
        assert_eq!(a.ai, None, "a resting tab has no server to report");
        assert_eq!(b.place, "tab");
        assert_eq!(
            b.ai,
            Some(ShellAi {
                running: 1,
                awaiting: 2
            })
        );
        assert_eq!((w.place, w.ai), ("closed", None));
        let v = serde_json::to_value(&b).unwrap();
        assert_eq!(v["ai"], serde_json::json!({"running": 1, "awaiting": 2}));
        assert_eq!(place_of(&book, "la").0, "resting", "index_search agrees");
    }

    #[test]
    fn intents_are_validated_and_taken_once_per_window() {
        let good = OpenIntent {
            kind: "create-canvas".into(),
            prompt: "a pricing page".into(),
            project_hint: None,
        };
        assert!(validate_intent(good.clone()).is_ok());
        assert!(validate_intent(OpenIntent {
            kind: "run-shell".into(),
            ..good.clone()
        })
        .is_err());
        assert!(validate_intent(OpenIntent {
            prompt: " ".into(),
            ..good.clone()
        })
        .is_err());
        assert!(validate_intent(OpenIntent {
            prompt: "x".repeat(4001),
            ..good.clone()
        })
        .is_err());
        INTENTS
            .lock()
            .unwrap()
            .get_or_insert_with(HashMap::new)
            .insert("p-lt".into(), good.clone());
        assert_eq!(take_intent("p-other"), None);
        assert_eq!(take_intent("p-lt"), Some(good));
        assert_eq!(take_intent("p-lt"), None);
    }

    #[test]
    fn every_home_permission_exists() {
        // Tauri unwraps the runtime capability's resolve — an unknown permission
        // would panic the moment Home binds.
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("permissions/autogenerated");
        for p in HOME_PERMISSIONS.iter().filter(|p| !p.starts_with("core:")) {
            let cmd = p.trim_start_matches("allow-").replace('-', "_");
            assert!(
                dir.join(format!("{cmd}.toml")).is_file(),
                "no permission file for {p}"
            );
        }
        let splash = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities/home-splash.json"),
        )
        .unwrap();
        let v: Value = serde_json::from_str(&splash).unwrap();
        assert_eq!(v["webviews"], json!(["home"]), "V2-3.7: webviews, never windows");
        assert_eq!(v["permissions"], json!(["allow-resolve-dev-server-url"]));
        assert!(
            v.get("remote").is_none(),
            "the splash capability is app-local only"
        );
    }
}
