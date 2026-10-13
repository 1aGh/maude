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

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime};
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

/// How long a Home pick waits for the new project tab to become key before it
/// closes Home anyway.
const KEY_WAIT: Duration = Duration::from_secs(3);

/// The permissions of the runtime `home` capability (§5.4 Capabilities), plus
/// `core:event:default` — the Home page `listen`s for `shell://state`. Every
/// entry must resolve: Tauri `unwrap`s the runtime resolve, so an unknown name
/// would panic at bind time (`every_home_permission_exists` pins it).
pub const HOME_PERMISSIONS: &[&str] = &[
    "core:event:default",
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
    let token = mint_token()?;

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
                h.info_file = info_file.clone();
                h.spawned_at = Instant::now();
                h.child.replace(child)
            }
            None => {
                *slot = Some(HomeInstance {
                    port: None,
                    url: None,
                    token,
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

/// The runtime capability for the Home window at the Home origin (+ its
/// `localhost` twin). `local(false)`: on the app-local splash the window gets
/// only the static `home-splash` capability (resolve_dev_server_url).
pub fn home_capability(id: &str, port: u16) -> CapabilityBuilder {
    let mut b = CapabilityBuilder::new(id)
        .window(HOME_LABEL)
        .local(false)
        .remote(format!("http://127.0.0.1:{port}/*"))
        .remote(format!("http://localhost:{port}/*"));
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

/// The Home origin is `http://127.0.0.1:<port>`; its `localhost` twin is the
/// same listener (the runtime capability grants both).
fn on_home_origin(url: &tauri::Url, port: u16) -> bool {
    url.scheme() == "http"
        && url.port() == Some(port)
        && matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"))
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
    let Some(window) = app.get_webview_window(HOME_LABEL) else {
        return;
    };
    match url.parse::<tauri::Url>() {
        Ok(parsed) if crate::server_json::is_loopback_url(&parsed) => {
            if let Some(state) = app.try_state::<SidecarState>() {
                state
                    .windows
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .set_origin(HOME_LABEL, &parsed.origin().ascii_serialization());
            }
            if let Err(e) = window.navigate(parsed) {
                log_line(&format!("[maude] Home navigate failed: {e}"));
            }
        }
        _ => log_line(&format!(
            "[maude] refusing non-loopback Home url (DDR-109): {url}"
        )),
    }
}

/// Focus the Home window, or create it — as a tab of `caller` (else the front
/// window) — and send it to the Home origin. Returns whether it was created.
pub fn ensure_home_window(app: &AppHandle, caller: Option<&str>) -> Result<bool, String> {
    if let Some(w) = app.get_webview_window(HOME_LABEL) {
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(false);
    }
    let state = app.state::<SidecarState>();
    let tick = state.tick.fetch_add(1, Ordering::SeqCst);
    let caller = {
        let mut book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
        let caller = caller.map(str::to_string).or_else(|| book.front_label());
        // Written BEFORE the build so the build's `Focused` event finds it.
        book.insert(HOME_LABEL, Role::Home, tick);
        caller
    };
    let spec = WindowSpec {
        label: HOME_LABEL.to_string(),
        title: "Home".to_string(),
        caller,
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

/// After a pick on Home opened (or focused) `label`: close Home once that tab
/// is key — "picking a project replaces the Home tab" (decision 3).
pub fn close_home_when_key(app: &AppHandle, label: &str) {
    let app = app.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        let deadline = Instant::now() + KEY_WAIT;
        while Instant::now() < deadline {
            let key = app
                .state::<SidecarState>()
                .windows
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .focused()
                == Some(label.as_str());
            if key {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if let Some(w) = app.get_webview_window(HOME_LABEL) {
            let _ = w.close();
        }
    });
}

// ── ShellState (§5.4) ───────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellProject {
    pub pid: String,
    pub root: String,
    pub name: String,
    pub profile: String,
    /// `tab` | `closed`. SEAM (V2-3.2 part b): `resting`.
    pub place: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub focused: bool,
    // SEAM (probe): `ai: {running, awaiting}` from part b's authenticated
    // `/_api/shell/status` probe. Omitted until it lands.
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
            let label = book.label_for_pid(pid);
            ShellProject {
                pid: pid.clone(),
                root: e.root.clone(),
                name: name_of(&e.root, &e.name),
                profile: e.profile.clone(),
                place: if label.is_some() { "tab" } else { "closed" },
                focused: label.is_some() && book.focused() == label.as_deref(),
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
    let profiles = crate::profiles::profiles_list()
        .into_iter()
        .map(|p| ShellProfile {
            id: p.id,
            label: p.label,
            email: p.cloud_email,
        })
        .collect();
    let state = app.state::<SidecarState>();
    let book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
    build_shell_state(&st, &book, profiles, |root, name| {
        if Path::new(root).is_dir() {
            windows::project_display_name(root)
        } else {
            crate::notify::sanitize_notify_field(name)
        }
    })
}

static STATE_GEN: AtomicU64 = AtomicU64::new(0);

/// A tab, focus or registry change: tell Home (only), at most once per 250 ms.
pub fn state_changed(app: &AppHandle) {
    if app.get_webview_window(HOME_LABEL).is_none() {
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
        let _ = app.emit_to(
            EventTarget::AnyLabel {
                label: HOME_LABEL.to_string(),
            },
            "shell://state",
            s,
        );
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

pub fn park_intent(app: &AppHandle, label: &str, intent: OpenIntent) {
    INTENTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_or_insert_with(HashMap::new)
        .insert(label.to_string(), intent);
    // A nudge only — the payload is never in the event.
    let _ = app.emit_to(
        EventTarget::AnyLabel {
            label: label.to_string(),
        },
        "shell://intent",
        (),
    );
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

/// `new_home_tab()` (⌘T, Back to Home) — focus Home or open it as a tab of the
/// calling window. Either role.
#[tauri::command]
pub async fn new_home_tab(app: AppHandle, webview: tauri::Webview) -> Result<(), String> {
    windows::caller_any(&webview, false)?;
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
        shape_search(&resp, &scope, |pid| {
            if book.label_for_pid(pid).is_some() {
                "tab"
            } else {
                "closed" // SEAM (V2-3.2 part b): `resting`
            }
        })
    };
    attach_thumbs(&client, &base, &token, &mut groups).await;
    Ok(json!({ "groups": groups }))
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

/// `relink_project({pid})` — "Find the folder…": pick where the project moved
/// to, rebind its registry entry and carry its index entry over. Either role.
/// Resolves the new pid, or `null` when the picker was cancelled.
#[tauri::command]
pub async fn relink_project(
    app: AppHandle,
    webview: tauri::Webview,
    pid: String,
) -> Result<Option<String>, String> {
    windows::caller_any(&webview, false)?;
    if !crate::app_state::load(&app).projects.contains_key(&pid) {
        return Err("That project isn't in your list.".to_string());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |f| {
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
    state_changed(&app);
    Ok(Some(new_pid))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn url(s: &str) -> tauri::Url {
        s.parse().unwrap()
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
        // The real thing, and its localhost twin.
        assert!(check_home("home", Some(&home), Some(4500), false).is_ok());
        assert!(check_home(
            "home",
            Some(&url("http://localhost:4500/x?y")),
            Some(4500),
            false
        )
        .is_ok());
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
        let s = build_shell_state(&st, &book, Vec::new(), |_, n| n.to_string());
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
        assert_eq!(v["windows"], json!(["home"]));
        assert_eq!(v["permissions"], json!(["allow-resolve-dev-server-url"]));
        assert!(
            v.get("remote").is_none(),
            "the splash capability is app-local only"
        );
    }
}
