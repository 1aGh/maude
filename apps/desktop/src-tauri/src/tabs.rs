// tabs.rs — Maude's own tab bar (V2-3.7, contract
// apps/studio/client/v2/contracts/V2-3.7-own-tab-bar.md).
//
// ONE native window, `shell`, holds child webviews (Tauri multi-webview,
// `Window::add_child`): the tab strip `strip` across the top, and one webview
// per tab — `home` (pinned, always there) and `p-<pid>` per open project. Only
// the active tab's webview is shown; a switch is `show()` on the new one and
// `hide()` on the rest. `WindowBook` (windows.rs) stays the ONE source of truth
// for the tab list and the active tab (`focused`); the strip is a trusted
// app-local page that only draws what Rust sends it and asks Rust to act.
//
// Security (contract §8):
// - Every capability names `webviews`, never the `shell` window: Tauri grants a
//   capability on a webview-label OR window-label match, and every tab lives in
//   `shell`. `capabilities_name_webviews_never_windows` (below) scans for it.
// - The strip state reaches the strip ONLY, through the `Channel` the strip
//   handed `tabs_state` — never `emit_to`: a JS listener registered with the
//   `Any` target hears every `emit_to`, in every webview, so a project page
//   could otherwise read the other projects' names.
// - Every strip command refuses a caller that is not the `strip` webview on
//   the app-local `strip.html` (`check_strip`).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Rect, Runtime, WebviewUrl};

use crate::sidecar::SidecarState;
use crate::windows::{self, Role, WindowBook, HOME_LABEL};

/// The one native window every tab lives in.
pub const SHELL_LABEL: &str = "shell";
/// The tab strip's webview.
pub const STRIP_LABEL: &str = "strip";
/// The strip's app-local document.
const STRIP_PAGE: &str = "strip.html";
/// The strip's height (logical px): the titlebar row. Tabs start below it.
pub const STRIP_H: f64 = 38.0;
/// The shell's first and minimum size (as the project windows had).
const SHELL_W: f64 = 1280.0;
const SHELL_H: f64 = 800.0;
const SHELL_MIN_W: f64 = 1024.0;
const SHELL_MIN_H: f64 = 680.0;
/// `changed` coalesces a burst (a restore opens every tab) into one push.
const CHANGED_DEBOUNCE: Duration = Duration::from_millis(16);

// ── The strip state (contract §3.2) ─────────────────────────────────────────

/// The AI dot of a background tab: the activity poller (notify.rs, V2-3.9 T6) sets it when
/// the tab's AI finishes or needs you; activating the tab clears it. Live only.
/// S5.14 (03 `ai-other-tab`, `ai-needs-tab`): `working` is the tab's spark while a run is
/// live there, and `needs-you` draws as the azure question mark — both LEVELS read from that
/// project's runs each tick (`mark_for`), so they clear by themselves.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Dot {
    Done,
    NeedsYou,
    Working,
}

/// S5.14 — the mark a background tab shows after one poll tick: `level` is what its runs say
/// now (`RunsSnapshot::level`: needs you › working › nothing), `current` what the tab shows,
/// `finished` whether a run ended `done` this tick. Needs you and working are levels; done
/// stays until the tab is activated (V2-3.7 §6) and gives way to a new level.
pub fn mark_for(level: Option<Dot>, current: Option<Dot>, finished: bool) -> Option<Dot> {
    match level {
        Some(l) => Some(l),
        None if finished || current == Some(Dot::Done) => Some(Dot::Done),
        None => None,
    }
}

/// S5.14 — put `mark` on `root`'s tab exactly (the level path; `set_dot` keeps the old
/// transition rule for its e2e helper). The active tab takes none (`WindowBook::set_dot`).
/// True when the strip state changed.
pub fn set_mark(app: &AppHandle, root: &str, level: Option<Dot>, finished: bool) -> bool {
    let changed_now = app.try_state::<SidecarState>().is_some_and(|s| {
        let mut book = s.windows.lock().unwrap_or_else(|e| e.into_inner());
        set_mark_in(&mut book, root, level, finished)
    });
    if changed_now {
        changed(app);
    }
    changed_now
}

/// Pure half of `set_mark`.
pub fn set_mark_in(book: &mut WindowBook, root: &str, level: Option<Dot>, finished: bool) -> bool {
    let Some(label) = book.label_for_root(root) else {
        return false;
    };
    let current = book.entry(&label).and_then(|e| e.dot);
    let next = mark_for(level, current, finished);
    if next == current {
        return false;
    }
    book.set_dot(&label, next)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StripTab {
    pub label: String,
    /// `project` | `cell`.
    pub kind: &'static str,
    /// `sanitize_title`'d — the only project text that reaches the strip.
    pub name: String,
    pub dot: Option<Dot>,
    pub resting: bool,
    pub closing: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StripHome {
    pub label: &'static str,
}

/// What the strip draws (`tabs://state`): the project/cell tabs in strip
/// order, Home pinned (never in `tabs`), and the active label (`home` too).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TabStripState {
    pub tabs: Vec<StripTab>,
    pub home: StripHome,
    pub active: String,
}

/// Pure: the strip state of `book`. `name_of(root)` names a project tab (the
/// result is sanitized again here — whatever the caller passes).
pub fn strip_state(book: &WindowBook, name_of: impl Fn(&str) -> String) -> TabStripState {
    let tabs = book
        .tab_labels()
        .iter()
        .filter_map(|label| {
            let e = book.entry(label)?;
            let (kind, name) = match &e.role {
                Role::Project { root, .. } => ("project", name_of(root)),
                Role::Cell { .. } => ("cell", "Cloud".to_string()),
                Role::Home => return None,
            };
            Some(StripTab {
                label: label.clone(),
                kind,
                name: crate::notify::sanitize_title(&name),
                dot: e.dot,
                resting: e.resting,
                closing: e.closing,
            })
        })
        .collect();
    TabStripState {
        tabs,
        home: StripHome { label: HOME_LABEL },
        active: book.focused().unwrap_or(HOME_LABEL).to_string(),
    }
}

// ── The strip's caller gate (contract §8) ───────────────────────────────────

/// Pure half of `caller_strip`: the label is `strip` AND the page is the
/// app-local `strip.html`. A project page, Home, and a `strip` webview that
/// ended up anywhere else answer for nobody.
pub fn check_strip(label: &str, url: Option<&tauri::Url>) -> Result<(), String> {
    if label != STRIP_LABEL {
        return Err("Only the tab bar can do that.".to_string());
    }
    match url {
        Some(u) if windows::is_app_local(u) && u.path() == format!("/{STRIP_PAGE}") => Ok(()),
        _ => Err("The tab bar isn't showing itself.".to_string()),
    }
}

pub fn caller_strip<R: Runtime>(webview: &tauri::Webview<R>) -> Result<(), String> {
    check_strip(webview.label(), webview.url().ok().as_ref())
}

/// The strip's navigation guard: `strip.html` and nothing else.
fn strip_navigation_allowed(url: &tauri::Url) -> bool {
    windows::is_app_local(url) && url.path() == format!("/{STRIP_PAGE}")
}

// ── Layout (contract §3.3 "Relayout") ───────────────────────────────────────

/// Pure: the strip's and every tab's bounds in a shell whose inner size is
/// `w`×`h` (logical). Not `auto_resize`, which would scale the strip's height.
pub fn child_bounds(w: f64, h: f64) -> (Rect, Rect) {
    let strip = Rect {
        position: LogicalPosition::new(0.0, 0.0).into(),
        size: LogicalSize::new(w, STRIP_H.min(h)).into(),
    };
    let tab = Rect {
        position: LogicalPosition::new(0.0, STRIP_H.min(h)).into(),
        size: LogicalSize::new(w, (h - STRIP_H).max(0.0)).into(),
    };
    (strip, tab)
}

/// The shell's logical inner size.
fn shell_logical_size<R: Runtime>(shell: &tauri::Window<R>) -> (f64, f64) {
    let scale = shell.scale_factor().unwrap_or(1.0);
    match shell.inner_size() {
        Ok(s) => {
            let l = s.to_logical::<f64>(scale);
            (l.width, l.height)
        }
        Err(_) => (SHELL_W, SHELL_H),
    }
}

/// Re-lay-out every child after a resize, a fullscreen change or a scale
/// change (`on_window_event` in lib.rs).
pub fn layout<R: Runtime>(app: &AppHandle<R>) {
    let Some(shell) = app.get_window(SHELL_LABEL) else {
        return;
    };
    let (w, h) = shell_logical_size(&shell);
    let (strip, tab) = child_bounds(w, h);
    for wv in shell.webviews() {
        let r = if wv.label() == STRIP_LABEL { strip } else { tab };
        if let Err(e) = wv.set_bounds(r) {
            crate::sidecar::log_line(&format!("[maude] could not lay out {}: {e}", wv.label()));
        }
    }
}

// ── The shell host ──────────────────────────────────────────────────────────

/// The `shell` window with its strip, built on first use (boot).
pub fn ensure_shell(app: &AppHandle) -> Result<tauri::Window, String> {
    if let Some(w) = app.get_window(SHELL_LABEL) {
        return Ok(w);
    }
    #[allow(unused_mut)]
    let mut builder = tauri::window::WindowBuilder::new(app, SHELL_LABEL)
        .title("Maude")
        .inner_size(SHELL_W, SHELL_H)
        .min_inner_size(SHELL_MIN_W, SHELL_MIN_H);
    #[cfg(target_os = "macos")]
    {
        // The strip sits in the titlebar row (its left 78 px stay free for the
        // traffic lights, strip.html).
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }
    let shell = builder
        .build()
        .map_err(|e| format!("Couldn't open the Maude window: {e}"))?;
    let (w, h) = shell_logical_size(&shell);
    let (strip_rect, _) = child_bounds(w, h);
    #[allow(unused_mut)]
    let mut strip = WebviewBuilder::new(STRIP_LABEL, WebviewUrl::App(STRIP_PAGE.into()))
        .disable_drag_drop_handler()
        .on_navigation(|url| {
            let ok = strip_navigation_allowed(url);
            if !ok {
                crate::sidecar::log_line("[maude] strip: refused a navigation");
            }
            ok
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    #[cfg(target_os = "macos")]
    if windows::supports_data_store() {
        strip = strip.data_store_identifier(windows::data_store_id_for_label(STRIP_LABEL));
    }
    shell
        .add_child(strip, strip_rect.position, strip_rect.size)
        .map_err(|e| format!("Couldn't open the tab bar: {e}"))?;
    Ok(shell)
}

/// Add a tab's webview to the shell, hidden. `with` attaches the tab's own
/// handlers (navigation guard, page load, data store) — windows.rs owns them.
pub fn add_tab(
    app: &AppHandle,
    label: &str,
    with: impl FnOnce(WebviewBuilder<tauri::Wry>) -> WebviewBuilder<tauri::Wry>,
) -> Result<tauri::Webview, String> {
    let shell = ensure_shell(app)?;
    let (w, h) = shell_logical_size(&shell);
    let (_, rect) = child_bounds(w, h);
    let builder = with(
        WebviewBuilder::new(label, WebviewUrl::App("index.html".into())).disable_drag_drop_handler(),
    );
    let wv = shell
        .add_child(builder, rect.position, rect.size)
        .map_err(|e| format!("Couldn't open a tab for this project: {e}"))?;
    // Built visible: hide it until `activate` picks it, so a tab opened in the
    // background (a restore) never flashes over the active one.
    let _ = wv.hide();
    Ok(wv)
}

/// The name the shell title shows for `label`.
fn title_of(app: &AppHandle, label: &str) -> String {
    if label == HOME_LABEL {
        return "Home".to_string();
    }
    app.try_state::<SidecarState>()
        .and_then(|s| s.windows.lock().unwrap_or_else(|e| e.into_inner()).root_of(label))
        .map(|root| windows::project_display_name(&root))
        .unwrap_or_else(|| "Maude".to_string())
}

/// Make `label` the active tab (contract §3.2 `activate`): the book's
/// `focused` (+ `last_focused`, dot cleared) and today's focus side effects
/// (`windows::on_focused`: mark shown, Dock badge, wake a resting tab, session
/// save, Home's state), then show it, hide every other tab, focus it, and title
/// the shell after it, and set the menu for its role (V2-3.9 T5, `menu::apply_role`).
pub fn activate(app: &AppHandle, label: &str) -> Result<(), String> {
    let known = app.try_state::<SidecarState>().is_some_and(|s| {
        s.windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(label)
            .is_some()
    });
    if !known || label == STRIP_LABEL {
        return Err(format!("no tab {label}"));
    }
    let target = app.get_webview(label).ok_or_else(|| format!("no tab {label}"))?;
    // The book first (never held across a webview call: those wait on the
    // main thread, which takes the book lock in the navigation guard).
    windows::on_focused(app, label);
    // Show before hide: no frame without a tab (contract §10 q1).
    let _ = target.show();
    if let Some(shell) = app.get_window(SHELL_LABEL) {
        for wv in shell.webviews() {
            if wv.label() != label && wv.label() != STRIP_LABEL {
                let _ = wv.hide();
            }
        }
        let _ = shell.set_title(&title_of(app, label));
    }
    let _ = target.set_focus();
    apply_menu_role(app);
    changed(app);
    Ok(())
}

/// The menu role of the active tab (`menu::apply_role`), from the book.
fn apply_menu_role(app: &AppHandle) {
    let Some((role, n)) = app.try_state::<SidecarState>().map(|s| {
        let book = s.windows.lock().unwrap_or_else(|e| e.into_inner());
        (menu_role(&book), book.tab_labels().len())
    }) else {
        return;
    };
    crate::menu::apply_role(app, role, n);
}

/// Pure: the menu role of the book's active tab — Home when Home (or nothing) is active.
pub fn menu_role(book: &WindowBook) -> crate::menu::MenuRole {
    match book.focused().and_then(|l| book.entry(l)).map(|e| &e.role) {
        Some(Role::Project { .. }) | Some(Role::Cell { .. }) => crate::menu::MenuRole::Project,
        _ => crate::menu::MenuRole::Home,
    }
}

/// Pure: the tab a tab-bar menu command goes to (contract V2-3.7 §5). Next / Previous walk the
/// project tabs in strip order and then Home, wrapping; Tab `n` is project tab `n`; Last is the
/// last project tab; Show Home is Home. `None`: nothing to do (no such tab, or Close — which
/// `run_tab_command` handles itself).
pub fn tab_command_target(book: &WindowBook, cmd: crate::menu::TabCommand) -> Option<String> {
    use crate::menu::TabCommand;
    let tabs = book.tab_labels();
    match cmd {
        TabCommand::ShowHome => Some(HOME_LABEL.to_string()),
        TabCommand::Close => None,
        TabCommand::Select(n) => tabs.get(n.checked_sub(1)?).cloned(),
        TabCommand::Last => tabs.last().cloned(),
        TabCommand::Next | TabCommand::Prev => {
            if tabs.is_empty() {
                return None;
            }
            let ring: Vec<&str> = tabs.iter().map(String::as_str).chain([HOME_LABEL]).collect();
            let at = book
                .focused()
                .and_then(|f| ring.iter().position(|l| *l == f))
                .unwrap_or(ring.len() - 1);
            let n = ring.len();
            let to = if cmd == TabCommand::Next { (at + 1) % n } else { (at + n - 1) % n };
            Some(ring[to].to_string())
        }
    }
}

/// Run a tab-bar menu command (lib.rs `on_menu`): Close Tab is the user close path of the
/// ACTIVE project tab (nothing on Home); the rest activate their target.
pub fn run_tab_command(app: &AppHandle, cmd: crate::menu::TabCommand) {
    let Some((focused, target)) = app.try_state::<SidecarState>().map(|s| {
        let book = s.windows.lock().unwrap_or_else(|e| e.into_inner());
        (book.focused().map(str::to_string), tab_command_target(&book, cmd))
    }) else {
        return;
    };
    let result = if cmd == crate::menu::TabCommand::Close {
        match focused {
            Some(l) if l != HOME_LABEL => close_tab_by_user(app, &l),
            _ => Ok(()),
        }
    } else if let Some(t) = target {
        reveal(app, &t)
    } else {
        Ok(())
    };
    if let Err(e) = result {
        crate::sidecar::log_line(&format!("[maude] menu {cmd:?}: {e}"));
    }
}

/// Set (or clear) the AI dot of `root`'s tab (V2-3.7 §6; notify.rs's poller). The active tab
/// never takes one, and 'needs-you' outranks 'done' until the tab is activated. True when the
/// strip state changed.
pub fn set_dot(app: &AppHandle, root: &str, dot: Option<Dot>) -> bool {
    let changed_now = app.try_state::<SidecarState>().is_some_and(|s| {
        let mut book = s.windows.lock().unwrap_or_else(|e| e.into_inner());
        set_dot_in(&mut book, root, dot)
    });
    if changed_now {
        changed(app);
    }
    changed_now
}

/// Pure half of `set_dot`.
pub fn set_dot_in(book: &mut WindowBook, root: &str, dot: Option<Dot>) -> bool {
    let Some(label) = book.label_for_root(root) else {
        return false;
    };
    let current = book.entry(&label).and_then(|e| e.dot);
    let next = match (current, dot) {
        // 'needs-you' is not downgraded to 'done' by a later finish.
        (Some(Dot::NeedsYou), Some(Dot::Done)) => Some(Dot::NeedsYou),
        (_, d) => d,
    };
    if next == current {
        return false;
    }
    book.set_dot(&label, next)
}

/// `activate`, and bring the shell to the front (unhide, unminimize, key):
/// open-once's reveal, a notification click, a relaunch, the Dock.
pub fn reveal(app: &AppHandle, label: &str) -> Result<(), String> {
    if let Some(shell) = app.get_window(SHELL_LABEL) {
        let _ = shell.show();
        let _ = shell.unminimize();
        let _ = shell.set_focus();
    }
    activate(app, label)
}

/// The ONE close path of a tab (contract §3.3): child webviews have no
/// lifecycle events, so this closes the webview, runs the per-tab bookkeeping
/// (`windows::on_destroyed`: grace, reap, parked values, session) and, when
/// the active tab closed, activates its neighbour — Home after the last one.
/// Home is never closed.
pub fn close_tab(app: &AppHandle, label: &str) -> Result<(), String> {
    if label == HOME_LABEL || label == STRIP_LABEL {
        return Err("That tab can't be closed.".to_string());
    }
    let next = app.try_state::<SidecarState>().and_then(|s| {
        let book = s.windows.lock().unwrap_or_else(|e| e.into_inner());
        (book.focused() == Some(label)).then(|| book.after_close(label))
    });
    if let Some(wv) = app.get_webview(label) {
        wv.close().map_err(|e| e.to_string())?;
    }
    windows::on_destroyed(app, label);
    if let Some(next) = next {
        let next = next.unwrap_or_else(|| HOME_LABEL.to_string());
        if let Err(e) = activate(app, &next) {
            crate::sidecar::log_line(&format!("[maude] after closing {label}: {e}"));
        }
    }
    changed(app);
    Ok(())
}

/// The user close path (the strip's ×, ⌘W from T5, `e2e_close_window` without
/// `destroy`): the "Stop AI in …?" guard first, then `close_tab`.
pub fn close_tab_by_user(app: &AppHandle, label: &str) -> Result<(), String> {
    if label == HOME_LABEL || label == STRIP_LABEL {
        return Err("That tab can't be closed.".to_string());
    }
    match windows::close_guard(app, label) {
        windows::CloseGuard::Proceed => close_tab(app, label),
        // The guard closes it itself once the probe / confirm decides.
        windows::CloseGuard::Hold => {
            changed(app);
            Ok(())
        }
    }
}

// ── Pushing the state to the strip ──────────────────────────────────────────

/// The channel the mounted strip handed `tabs_state`; replaced on a reload.
static STRIP_CHANNEL: Mutex<Option<Channel<TabStripState>>> = Mutex::new(None);
static CHANGED_GEN: AtomicU64 = AtomicU64::new(0);

fn current_state(app: &AppHandle) -> Option<TabStripState> {
    let state = app.try_state::<SidecarState>()?;
    let book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
    Some(strip_state(&book, windows::project_display_name))
}

/// Every tab-list / active / dot / name change: push the state to the strip
/// (only) and title the shell after the active tab, coalesced over
/// `CHANGED_DEBOUNCE`.
pub fn changed(app: &AppHandle) {
    let gen = CHANGED_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(CHANGED_DEBOUNCE).await;
        if CHANGED_GEN.load(Ordering::SeqCst) != gen {
            return;
        }
        let Some(s) = current_state(&app) else { return };
        // The shell's title follows the active tab (an in-tab switch renames it).
        let title = s
            .tabs
            .iter()
            .find(|t| t.label == s.active)
            .map(|t| t.name.clone())
            .unwrap_or_else(|| "Home".to_string());
        if let Some(shell) = app.get_window(SHELL_LABEL) {
            let _ = shell.set_title(&title);
        }
        // The tab count changes Next / Previous (a tab opened or closed).
        apply_menu_role(&app);
        let ch = STRIP_CHANNEL.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if let Some(ch) = ch {
            let _ = ch.send(s);
        }
    });
}

// ── Strip commands (contract §3.2; capabilities/strip.json) ─────────────────

/// `tabs_state({onState})` — the current strip state; `onState` (a Channel)
/// receives every later change (`tabs://state`). A strip reload hands a new
/// channel, which replaces the old one.
#[tauri::command]
pub fn tabs_state(
    app: AppHandle,
    webview: tauri::Webview,
    on_state: Channel<TabStripState>,
) -> Result<TabStripState, String> {
    caller_strip(&webview)?;
    *STRIP_CHANNEL.lock().unwrap_or_else(|e| e.into_inner()) = Some(on_state);
    current_state(&app).ok_or_else(|| "Maude is still starting.".to_string())
}

/// `tab_activate({label})` — a click on a tab (or on Home).
#[tauri::command]
pub fn tab_activate(app: AppHandle, webview: tauri::Webview, label: String) -> Result<(), String> {
    caller_strip(&webview)?;
    activate(&app, &label)
}

/// `tab_close({label})` — the tab's × / a middle click. Not Home.
#[tauri::command]
pub fn tab_close(app: AppHandle, webview: tauri::Webview, label: String) -> Result<(), String> {
    caller_strip(&webview)?;
    close_tab_by_user(&app, &label)
}

/// `tab_reorder({label, to})` — move a project tab within the strip. Home
/// never moves (it is not in the tab list).
#[tauri::command]
pub fn tab_reorder(
    app: AppHandle,
    webview: tauri::Webview,
    label: String,
    to: usize,
) -> Result<(), String> {
    caller_strip(&webview)?;
    let moved = app
        .try_state::<SidecarState>()
        .is_some_and(|s| s.windows.lock().unwrap_or_else(|e| e.into_inner()).move_tab(&label, to));
    if !moved {
        return Err(format!("no tab {label}"));
    }
    windows::schedule_session_save(&app);
    changed(&app);
    Ok(())
}

/// Debug-only e2e helper (contract §10 q6): optionally resize the shell or
/// toggle fullscreen, let the relayout run, and answer the shell's logical
/// inner size and every child's logical bounds `[x, y, w, h]`. Granted only by
/// capabilities/debug/e2e-webdriver.json; a release build answers Err.
#[tauri::command]
pub async fn e2e_shell_bounds(
    app: AppHandle,
    size: Option<(f64, f64)>,
    fullscreen: Option<bool>,
) -> Result<serde_json::Value, String> {
    #[cfg(debug_assertions)]
    {
        let shell = app.get_window(SHELL_LABEL).ok_or("no shell")?;
        if let Some(f) = fullscreen {
            shell.set_fullscreen(f).map_err(|e| e.to_string())?;
            // The AppKit fullscreen animation, then the Resized relayout.
            tokio::time::sleep(Duration::from_millis(1500)).await;
        }
        if let Some((w, h)) = size {
            shell.set_size(LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        let scale = shell.scale_factor().unwrap_or(1.0);
        let (w, h) = shell_logical_size(&shell);
        let mut children = serde_json::Map::new();
        for wv in shell.webviews() {
            let Ok(r) = wv.bounds() else { continue };
            let p = r.position.to_logical::<f64>(scale);
            let s = r.size.to_logical::<f64>(scale);
            children.insert(
                wv.label().to_string(),
                serde_json::json!([p.x.round(), p.y.round(), s.width.round(), s.height.round()]),
            );
        }
        Ok(serde_json::json!({
            "inner": [w.round(), h.round()],
            "fullscreen": shell.is_fullscreen().unwrap_or(false),
            "children": children,
        }))
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (app, size, fullscreen);
        Err("debug builds only".into())
    }
}

// ── A moved folder (S1.19, 11 · pn-cant-open, V2-1.1 §5.5) ──────────────────
//
// A tab whose project folder is gone shows the app-local card
// `root-missing.html` instead of a dead page: "<name> isn't where it was." /
// Find the folder… / "Closing the tab keeps it on Home." Its server is
// stopped, the tab vouches for no server origin (N-M3) and the registry entry
// is kept (Home lists it as "isn't where it was"). Find the folder… is
// `relink_project({pid})` from the card — the one place a project tab on the
// app-local origin may call it, and only for its own pid while its folder is
// gone (home::relink_allowed). The relink moves the tab to the new folder
// (`follow_relink`): same tab, same label, the entry's profile and recents.

/// The card's app-local document.
pub const MISSING_PAGE: &str = "root-missing.html";
/// How often the shell looks for a tab whose folder went away.
const ROOT_WATCH_MS: u64 = 2_000;

/// Is the project at `root` gone — moved, renamed, or no design system left?
/// The same test relaunch (`plan_tabs`) and `open_project_window` apply.
pub fn root_missing(root: &str) -> bool {
    !std::path::Path::new(root).join(".design").is_dir()
}

fn missing_url() -> tauri::Url {
    #[cfg(windows)]
    const CARD: &str = "http://tauri.localhost/root-missing.html";
    #[cfg(not(windows))]
    const CARD: &str = "tauri://localhost/root-missing.html";
    CARD.parse().expect("the card url parses")
}

/// Is `url` the card (the app-local `root-missing.html`)?
pub fn on_card(url: &tauri::Url) -> bool {
    windows::is_app_local(url) && url.path() == format!("/{MISSING_PAGE}")
}

/// "Desktop › Portfolio 2026": where the folder was, from the home folder when
/// it was under it, else from the top. Long paths keep their last four parts.
pub fn place_words(root: &str, home: Option<&std::path::Path>) -> String {
    let path = std::path::Path::new(root);
    let rel = home
        .and_then(|h| path.strip_prefix(h).ok())
        .filter(|r| r.components().next().is_some())
        .unwrap_or(path);
    let parts: Vec<String> = rel
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => {
                Some(crate::notify::sanitize_title(&s.to_string_lossy()))
            }
            _ => None,
        })
        .filter(|s| !s.is_empty())
        .collect();
    let keep = parts.len().saturating_sub(4);
    let mut out = parts[keep..].join(" › ");
    if keep > 0 {
        out = format!("… › {out}");
    }
    out
}

/// What the card shows, for the tab's OWN project only (no input: the pid and
/// root come from the calling window's book entry).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MissingCard {
    pub missing: bool,
    pub pid: String,
    pub name: String,
    pub place: String,
}

pub fn missing_card(
    st: &crate::app_state::AppState,
    pid: &str,
    root: &str,
    home: Option<&std::path::Path>,
) -> MissingCard {
    let base = || {
        std::path::Path::new(root)
            .file_name()
            .map(|n| crate::notify::sanitize_title(&n.to_string_lossy()))
            .unwrap_or_default()
    };
    let name = st
        .projects
        .get(pid)
        .map(|e| crate::notify::sanitize_title(&e.name))
        .filter(|n| !n.is_empty())
        .unwrap_or_else(base);
    MissingCard {
        missing: true,
        pid: pid.to_string(),
        name: if name.is_empty() { "This project".to_string() } else { name },
        place: place_words(root, home),
    }
}

/// For `resolve_dev_server_url`: the card's answer when the calling tab's
/// folder is gone, else `None`.
pub fn missing_answer(app: &AppHandle, caller: &windows::CallerProject) -> Option<serde_json::Value> {
    if !root_missing(&caller.root) {
        return None;
    }
    let st = crate::app_state::load(app);
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    serde_json::to_value(missing_card(&st, &caller.pid, &caller.root, home.as_deref())).ok()
}

/// Put `label` on the card: not resting (focus must not try to wake a server
/// for a folder that is gone), no server origin, its server stopped. Only
/// while the tab still shows `root`.
pub fn show_missing(app: &AppHandle, label: &str, root: &str) {
    let Some(state) = app.try_state::<SidecarState>() else {
        return;
    };
    let still = {
        let mut book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
        let still = book.root_of(label).as_deref() == Some(root);
        if still {
            book.set_resting(label, false);
            book.clear_origin(label);
        }
        still
    };
    if !still {
        return;
    }
    crate::sidecar::shutdown_instance(app, root);
    if let Some(w) = app.get_webview(label) {
        if let Err(e) = w.navigate(missing_url()) {
            crate::sidecar::log_line(&format!("[maude] could not show the moved-folder card in {label}: {e}"));
        }
    }
    crate::sidecar::log_line(&format!("[maude] {label}: its folder is gone — showing the card"));
    changed(app);
    crate::home::state_changed(app);
}

/// The tab showing `old_pid` follows a relink to `new_root` (S1.19): same tab
/// and label, the registry entry's profile and recents (app_state::relink).
/// The front tab starts the new folder's server; a background one rests.
pub fn follow_relink(app: &AppHandle, old_pid: &str, new_root: &str) {
    let Some(state) = app.try_state::<SidecarState>() else {
        return;
    };
    let moved = {
        let mut book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
        book.label_for_pid(old_pid).and_then(|label| {
            let (_, old_root) = book.project_of(&label)?;
            book.set_project(&label, new_root);
            let front = book.front_label().as_deref() == Some(label.as_str());
            book.set_resting(&label, !front);
            Some((label, old_root, front))
        })
    };
    let Some((label, old_root, front)) = moved else {
        return;
    };
    if old_root != new_root {
        crate::sidecar::shutdown_instance(app, &old_root);
    }
    windows::show_splash(app, &label);
    if front {
        crate::sidecar::attach_or_spawn(app, new_root);
        crate::sidecar::spawn_enforce_cap(app);
        windows::navigate_when_up(app, label.clone(), new_root.to_string(), None);
    }
    crate::sidecar::log_line(&format!("[maude] {label} found its folder again: {new_root}"));
    changed(app);
    windows::schedule_session_save(app);
    crate::home::state_changed(app);
}

/// One project tab as the root watch sees it.
#[derive(Clone, Debug)]
pub struct WatchedTab {
    pub label: String,
    pub root: String,
    pub on_card: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum RootAction {
    /// The folder is gone (two looks in a row): show the card.
    Card { label: String, root: String },
    /// The card's folder is back where it was: open it again.
    Back { label: String, root: String },
}

/// The root watch's memory: tabs whose folder was missing at the last look.
#[derive(Default)]
pub struct RootWatch {
    suspect: std::collections::HashSet<String>,
}

impl RootWatch {
    /// Pure: what to do this tick. A folder must be missing on two looks in a
    /// row before its tab goes to the card (a checkout or a sync that swaps
    /// the folder for a moment is not a move); a card whose folder is back
    /// opens it again. A tab no longer listed is forgotten.
    pub fn tick(&mut self, tabs: &[WatchedTab], missing: impl Fn(&str) -> bool) -> Vec<RootAction> {
        let mut out = Vec::new();
        let mut next = std::collections::HashSet::new();
        for t in tabs {
            let gone = missing(&t.root);
            match (t.on_card, gone) {
                (true, false) => out.push(RootAction::Back {
                    label: t.label.clone(),
                    root: t.root.clone(),
                }),
                (false, true) if self.suspect.contains(&t.label) => out.push(RootAction::Card {
                    label: t.label.clone(),
                    root: t.root.clone(),
                }),
                (false, true) => {
                    next.insert(t.label.clone());
                }
                _ => {}
            }
        }
        self.suspect = next;
        out
    }
}

/// The card's folder came back: the front tab opens it, a background one rests
/// until it is switched to.
fn reopen_from_card(app: &AppHandle, label: &str, root: &str) {
    let Some(state) = app.try_state::<SidecarState>() else {
        return;
    };
    let front = {
        let mut book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
        if book.root_of(label).as_deref() != Some(root) {
            return;
        }
        let front = book.front_label().as_deref() == Some(label);
        book.set_resting(label, !front);
        front
    };
    windows::show_splash(app, label);
    if front {
        crate::sidecar::attach_or_spawn(app, root);
        crate::sidecar::spawn_enforce_cap(app);
        windows::navigate_when_up(app, label.to_string(), root.to_string(), None);
    }
    changed(app);
}

/// Look every `ROOT_WATCH_MS` for a project tab whose folder went away while
/// it was open (renamed or moved on disk) and put it on the card; a card
/// whose folder is back opens it again. The book is read under its lock, the
/// webview URLs after it (a webview call waits on the main thread, which takes
/// the book lock in the navigation guard).
pub fn spawn_root_watch(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut watch = RootWatch::default();
        loop {
            tokio::time::sleep(Duration::from_millis(ROOT_WATCH_MS)).await;
            let Some(state) = app.try_state::<SidecarState>() else {
                continue;
            };
            if state.shutting_down.load(Ordering::SeqCst) {
                break;
            }
            let listed: Vec<(String, String)> = {
                let book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
                book.tab_labels()
                    .iter()
                    .filter(|l| book.entry(l).is_some_and(|e| !e.closing))
                    .filter_map(|l| book.root_of(l).map(|r| (l.clone(), r)))
                    .collect()
            };
            let tabs: Vec<WatchedTab> = listed
                .into_iter()
                .filter_map(|(label, root)| {
                    let url = app.get_webview(&label)?.url().ok()?;
                    Some(WatchedTab {
                        on_card: on_card(&url),
                        label,
                        root,
                    })
                })
                .collect();
            for action in watch.tick(&tabs, root_missing) {
                match action {
                    RootAction::Card { label, root } => show_missing(&app, &label, &root),
                    RootAction::Back { label, root } => reopen_from_card(&app, &label, &root),
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(root: &str) -> Role {
        Role::Project {
            pid: windows::pid_for_root(root),
            root: root.to_string(),
        }
    }

    const A: &str = "/nonexistent/maude-v2-3-7/alpha";
    const B: &str = "/nonexistent/maude-v2-3-7/beta";
    const C: &str = "/nonexistent/maude-v2-3-7/gamma";

    fn book_abc() -> WindowBook {
        let mut b = WindowBook::default();
        b.insert_after(HOME_LABEL, Role::Home, 1, None);
        b.insert_after("p-a", project(A), 2, Some(HOME_LABEL));
        b.insert_after("p-b", project(B), 3, Some("p-a"));
        b.insert_after("p-c", project(C), 4, Some("p-b"));
        b
    }

    #[test]
    fn the_strip_state_pins_home_last_and_never_in_tabs_and_sanitizes_names() {
        let mut b = book_abc();
        b.focus("p-b", 5);
        let s = strip_state(&b, |root| {
            if root == A {
                "Al\u{202e}pha\nlab".to_string()
            } else {
                root.rsplit('/').next().unwrap().to_string()
            }
        });
        let labels: Vec<&str> = s.tabs.iter().map(|t| t.label.as_str()).collect();
        assert_eq!(labels, ["p-a", "p-b", "p-c"], "Home is never a tab");
        assert_eq!(b.tab_labels(), ["p-a", "p-b", "p-c"], "nor in the book's tab list");
        assert_eq!(s.home, StripHome { label: "home" });
        assert_eq!(s.active, "p-b");
        assert_eq!(s.tabs[0].name, "Alpha lab", "bidi + newline sanitized");
        assert!(s.tabs.iter().all(|t| t.kind == "project" && t.dot.is_none()));
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["home"], serde_json::json!({ "label": "home" }));
        assert_eq!(json["tabs"][1]["dot"], serde_json::Value::Null);
        // Nothing focused yet (boot): Home is the active tab.
        let s = strip_state(&book_abc(), |_| String::new());
        assert_eq!(s.active, "home");
    }

    #[test]
    fn activate_sets_the_active_tab_and_clears_its_dot() {
        let mut b = book_abc();
        b.focus("p-a", 5);
        assert!(b.set_dot("p-c", Some(Dot::NeedsYou)));
        assert!(b.set_dot("p-b", Some(Dot::Done)));
        let s = strip_state(&b, |_| String::new());
        assert_eq!(s.tabs[2].dot, Some(Dot::NeedsYou));
        assert_eq!(
            serde_json::to_value(s.tabs[2].dot).unwrap(),
            serde_json::json!("needs-you")
        );
        // The active tab never carries a dot.
        assert!(!b.set_dot("p-a", Some(Dot::Done)));
        assert!(b.focus("p-c", 6));
        let s = strip_state(&b, |_| String::new());
        assert_eq!(s.active, "p-c");
        assert_eq!(s.tabs[2].dot, None, "activating a tab clears its dot");
        assert_eq!(s.tabs[1].dot, Some(Dot::Done), "other tabs keep theirs");
        assert_eq!(b.last_focused("p-c"), Some(6));
        // Home is a valid active tab.
        assert!(b.focus(HOME_LABEL, 7));
        assert_eq!(strip_state(&b, |_| String::new()).active, "home");
    }

    #[test]
    fn the_menu_role_follows_the_active_tab() {
        use crate::menu::MenuRole;
        let mut b = book_abc();
        assert_eq!(menu_role(&b), MenuRole::Home, "nothing active yet (boot)");
        b.focus("p-b", 5);
        assert_eq!(menu_role(&b), MenuRole::Project);
        b.focus(HOME_LABEL, 6);
        assert_eq!(menu_role(&b), MenuRole::Home);
    }

    #[test]
    fn tab_menu_commands_walk_the_strip_then_home() {
        use crate::menu::TabCommand::*;
        let mut b = book_abc();
        b.focus("p-c", 5);
        let to = |b: &WindowBook, c| tab_command_target(b, c);
        assert_eq!(to(&b, Next).as_deref(), Some("home"), "after the last tab: Home");
        assert_eq!(to(&b, Prev).as_deref(), Some("p-b"));
        b.focus(HOME_LABEL, 6);
        assert_eq!(to(&b, Next).as_deref(), Some("p-a"), "Home wraps to the first tab");
        assert_eq!(to(&b, Prev).as_deref(), Some("p-c"));
        assert_eq!(to(&b, Select(1)).as_deref(), Some("p-a"));
        assert_eq!(to(&b, Select(3)).as_deref(), Some("p-c"));
        assert_eq!(to(&b, Select(4)), None, "no tab 4");
        assert_eq!(to(&b, Last).as_deref(), Some("p-c"));
        assert_eq!(to(&b, ShowHome).as_deref(), Some("home"));
        assert_eq!(to(&b, Close), None, "Close is run_tab_command's own");
        // Home alone: nowhere to cycle, no tab to select.
        let mut home = WindowBook::default();
        home.insert_after(HOME_LABEL, Role::Home, 1, None);
        home.focus(HOME_LABEL, 2);
        for c in [Next, Prev, Select(1), Last] {
            assert_eq!(to(&home, c), None, "{c:?}");
        }
    }

    #[test]
    fn the_ai_dot_marks_a_background_tab_and_needs_you_outranks_done() {
        let mut b = book_abc();
        b.focus("p-a", 5);
        assert!(set_dot_in(&mut b, B, Some(Dot::Done)));
        assert!(!set_dot_in(&mut b, B, Some(Dot::Done)), "no change, no push");
        assert!(set_dot_in(&mut b, B, Some(Dot::NeedsYou)));
        assert!(!set_dot_in(&mut b, B, Some(Dot::Done)), "a finish never downgrades needs-you");
        assert_eq!(b.entry("p-b").unwrap().dot, Some(Dot::NeedsYou));
        assert!(!set_dot_in(&mut b, A, Some(Dot::Done)), "the active tab takes no dot");
        assert!(!set_dot_in(&mut b, "/nonexistent/other", Some(Dot::Done)));
        // Activating clears it; resting drops it.
        b.focus("p-b", 6);
        assert_eq!(b.entry("p-b").unwrap().dot, None);
        assert!(set_dot_in(&mut b, C, Some(Dot::Done)));
        b.set_resting("p-c", true);
        assert_eq!(b.entry("p-c").unwrap().dot, None, "a resting tab runs no AI");
        // The poller's mapping.
        use crate::notify::{dot_for, Transition};
        assert_eq!(dot_for(&[Transition::Finished]), Some(Dot::Done));
        assert_eq!(
            dot_for(&[Transition::Finished, Transition::AwaitingInput]),
            Some(Dot::NeedsYou)
        );
        assert_eq!(dot_for(&[]), None);
    }

    #[test]
    fn the_poller_sets_the_dot_before_the_notification_cooldown() {
        let src = include_str!("notify.rs");
        let body = &src[src.find("async fn poll_one(").unwrap()..];
        // S5.14: the mark is a level, set every tick — before the "nothing fired" return.
        let dot = body.find("mark_tab(app, project_root, &snapshot, &fired);").expect("poll_one marks the tab");
        let cooldown = body.find("NOTIFY_COOLDOWN_MS").unwrap();
        let empty = body.find("if fired.is_empty()").unwrap();
        assert!(dot < empty && dot < cooldown, "the mark every tick, before the cooldown");
    }

    // S5.14 — 03 `ai-other-tab` (a spark while working) and `ai-needs-tab` (the azure ?).
    #[test]
    fn the_tab_mark_is_the_runs_level_and_done_stays_until_the_tab_is_seen() {
        use Dot::*;
        assert_eq!(mark_for(Some(Working), None, false), Some(Working));
        assert_eq!(mark_for(Some(NeedsYou), Some(Working), false), Some(NeedsYou));
        assert_eq!(mark_for(Some(Working), Some(NeedsYou), false), Some(Working), "answered: back to the spark");
        assert_eq!(mark_for(None, Some(Working), true), Some(Done), "the run finished");
        assert_eq!(mark_for(None, Some(Working), false), None, "stopped / cancelled: no mark");
        assert_eq!(mark_for(None, Some(NeedsYou), false), None, "the question went away");
        assert_eq!(mark_for(None, Some(Done), false), Some(Done), "done stays until activated");
        assert_eq!(mark_for(Some(Working), Some(Done), false), Some(Working), "a new run takes over");

        let mut b = book_abc();
        b.focus("p-a", 5);
        assert!(set_mark_in(&mut b, B, Some(Working), false));
        assert!(!set_mark_in(&mut b, B, Some(Working), false), "no change, no push");
        assert_eq!(b.entry("p-b").unwrap().dot, Some(Working));
        assert!(set_mark_in(&mut b, B, Some(NeedsYou), false));
        assert!(set_mark_in(&mut b, B, None, true));
        assert_eq!(b.entry("p-b").unwrap().dot, Some(Done));
        assert!(!set_mark_in(&mut b, A, Some(Working), false), "the active tab takes no mark");
        // The strip reads the value as a kebab-case string.
        assert_eq!(serde_json::to_value(Working).unwrap(), "working");
    }

    #[test]
    fn closing_the_active_tab_activates_its_neighbour_and_the_last_one_home() {
        let b = book_abc();
        // Right neighbour first, then left, then Home (None).
        assert_eq!(b.after_close("p-a").as_deref(), Some("p-b"));
        assert_eq!(b.after_close("p-c").as_deref(), Some("p-b"));
        let mut one = WindowBook::default();
        one.insert_after(HOME_LABEL, Role::Home, 1, None);
        one.insert_after("p-a", project(A), 2, None);
        assert_eq!(one.after_close("p-a"), None, "the last tab closing → Home");
        assert_eq!(one.after_close(HOME_LABEL), None);
    }

    #[test]
    fn reorder_moves_project_tabs_and_never_home() {
        let mut b = book_abc();
        assert!(b.move_tab("p-c", 0));
        assert_eq!(b.tab_labels(), ["p-c", "p-a", "p-b"]);
        assert!(b.move_tab("p-c", 99), "past the end clamps");
        assert_eq!(b.tab_labels(), ["p-a", "p-b", "p-c"]);
        assert!(!b.move_tab(HOME_LABEL, 0), "Home is not in the tab list");
        assert!(!b.move_tab("p-zz", 0));
    }

    #[test]
    fn strip_commands_refuse_any_caller_but_the_strip_on_strip_html() {
        let url = |s: &str| s.parse::<tauri::Url>().unwrap();
        assert_eq!(check_strip("strip", Some(&url("tauri://localhost/strip.html"))), Ok(()));
        assert_eq!(check_strip("strip", Some(&url("http://tauri.localhost/strip.html"))), Ok(()));
        // Not the strip's label: a project page, Home, the splash of either.
        for label in ["p-l0123456789abcdef", "home", "shell", "Strip", ""] {
            assert!(check_strip(label, Some(&url("tauri://localhost/strip.html"))).is_err(), "{label}");
        }
        // The strip's label on any other page.
        for bad in [
            "tauri://localhost/index.html",
            "http://localhost:4400/strip.html",
            "http://127.0.0.1:4400/strip.html",
            "https://evil.example/strip.html",
            "about:blank",
        ] {
            assert!(check_strip("strip", Some(&url(bad))).is_err(), "{bad}");
        }
        assert!(check_strip("strip", None).is_err());
        // Its navigation guard pins it to the same page.
        assert!(strip_navigation_allowed(&url("tauri://localhost/strip.html")));
        assert!(!strip_navigation_allowed(&url("tauri://localhost/index.html")));
        assert!(!strip_navigation_allowed(&url("http://localhost:4400/strip.html")));
    }

    #[test]
    fn children_are_laid_out_below_the_strip_at_any_size() {
        let size = |r: &Rect| match r.size {
            tauri::Size::Logical(s) => (s.width, s.height),
            tauri::Size::Physical(_) => panic!("logical"),
        };
        let pos = |r: &Rect| match r.position {
            tauri::Position::Logical(p) => (p.x, p.y),
            tauri::Position::Physical(_) => panic!("logical"),
        };
        for (w, h) in [(1280.0, 800.0), (1024.0, 680.0), (3008.0, 1692.0)] {
            let (strip, tab) = child_bounds(w, h);
            assert_eq!(pos(&strip), (0.0, 0.0));
            assert_eq!(size(&strip), (w, STRIP_H), "the strip keeps its height");
            assert_eq!(pos(&tab), (0.0, STRIP_H));
            assert_eq!(size(&tab), (w, h - STRIP_H), "the tab fills the rest");
        }
        // A degenerate size never goes negative.
        let (_, tab) = child_bounds(10.0, 5.0);
        assert_eq!(size(&tab), (10.0, 0.0));
    }

    /// Contract §8: Tauri grants a capability when the webview label OR the
    /// window label matches, and every tab lives in the `shell` window — so a
    /// capability naming `shell` (or a pattern that matches it) under
    /// `windows` would grant every tab. Every capability, static or runtime,
    /// names `webviews` only.
    #[test]
    fn capabilities_name_webviews_never_windows() {
        use tauri::ipc::RuntimeCapability;
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let mut files = Vec::new();
        let mut stack = vec![dir];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(&d).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else if p.extension().is_some_and(|x| x == "json") {
                    files.push(p);
                }
            }
        }
        assert!(files.len() >= 4, "default, home-splash, strip, debug/e2e-webdriver: {files:?}");
        for f in &files {
            let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(f).unwrap()).unwrap();
            let windows = v.get("windows").and_then(|w| w.as_array()).cloned().unwrap_or_default();
            assert!(windows.is_empty(), "{} names windows {windows:?}", f.display());
            let webviews = v["webviews"].as_array().unwrap_or_else(|| panic!("{}: no webviews", f.display()));
            assert!(!webviews.is_empty(), "{}", f.display());
            for w in webviews {
                let w = w.as_str().unwrap();
                assert!(w != SHELL_LABEL && w != "*" && !w.starts_with("s*"), "{}: {w}", f.display());
            }
        }
        // The runtime Home capability too.
        let tauri::utils::acl::capability::CapabilityFile::Capability(home) =
            crate::home::home_capability("home", 4321).build()
        else {
            panic!("one capability");
        };
        assert!(home.windows.is_empty(), "home capability names windows {:?}", home.windows);
        assert_eq!(home.webviews, ["home"]);
        // And the strip's is local-only, for the strip only.
        let strip: serde_json::Value = serde_json::from_str(include_str!("../capabilities/strip.json")).unwrap();
        assert_eq!(strip["webviews"], serde_json::json!(["strip"]));
        assert!(strip.get("remote").is_none(), "the strip is app-local only");
        let perms: Vec<&str> = strip["permissions"].as_array().unwrap().iter().filter_map(|p| p.as_str()).collect();
        for p in ["allow-tabs-state", "allow-tab-activate", "allow-tab-close", "allow-tab-reorder"] {
            assert!(perms.contains(&p), "{p}");
        }
        // No emit (M5), and no strip grant reaches any other capability.
        assert!(!perms.iter().any(|p| p.contains("emit") || *p == "core:default"));
        for f in files.iter().filter(|f| !f.ends_with("strip.json")) {
            let s = std::fs::read_to_string(f).unwrap();
            for p in ["allow-tabs-state", "allow-tab-activate", "allow-tab-close", "allow-tab-reorder"] {
                assert!(!s.contains(&format!("\"{p}\"")), "{} grants {p}", f.display());
            }
        }
    }

    /// S1.19: renaming a project folder on disk puts its tab on the card (on
    /// the second look — a folder swapped for a moment is not a move), and a
    /// card whose folder is back opens it again. A tab already on the card is
    /// left there while the folder is still gone.
    #[test]
    fn a_moved_folder_puts_its_tab_on_the_card() {
        let tab = |label: &str, root: &str, on_card: bool| WatchedTab {
            label: label.into(),
            root: root.into(),
            on_card,
        };
        let gone = std::cell::RefCell::new(std::collections::HashSet::<String>::new());
        let missing = |r: &str| gone.borrow().contains(r);
        let mut w = RootWatch::default();
        let tabs = [tab("p-a", "/a", false), tab("p-b", "/b", false)];
        assert!(w.tick(&tabs, missing).is_empty());
        gone.borrow_mut().insert("/a".into()); // renamed on disk
        assert!(w.tick(&tabs, missing).is_empty(), "one look is not a move");
        assert_eq!(
            w.tick(&tabs, missing),
            vec![RootAction::Card { label: "p-a".into(), root: "/a".into() }]
        );
        // On the card while the folder is still gone: nothing more to do.
        let carded = [tab("p-a", "/a", true), tab("p-b", "/b", false)];
        assert!(w.tick(&carded, missing).is_empty());
        assert!(w.tick(&carded, missing).is_empty());
        // A folder gone for one look only never reaches the card.
        gone.borrow_mut().insert("/b".into());
        assert!(w.tick(&carded, missing).is_empty());
        gone.borrow_mut().remove("/b");
        assert!(w.tick(&carded, missing).is_empty());
        // The folder is back where it was: the tab opens it again.
        gone.borrow_mut().remove("/a");
        assert_eq!(
            w.tick(&carded, missing),
            vec![RootAction::Back { label: "p-a".into(), root: "/a".into() }]
        );
        // The disk test is the relaunch one: no design system ⇒ gone.
        let base = std::env::temp_dir().join(format!("maude-s119-watch-{}", std::process::id()));
        std::fs::create_dir_all(base.join("p").join(".design")).unwrap();
        assert!(!root_missing(&base.join("p").to_string_lossy()));
        assert!(root_missing(&base.join("q").to_string_lossy()));
        let _ = std::fs::remove_dir_all(&base);
    }

    /// S1.19: the card's words come from the tab's own registry entry (the
    /// name the person knew) and the folder's old place, from the home folder.
    #[test]
    fn the_card_names_the_project_and_where_it_was() {
        let home = std::path::Path::new("/Users/x");
        assert_eq!(place_words("/Users/x/Desktop/Portfolio 2026", Some(home)), "Desktop › Portfolio 2026");
        assert_eq!(place_words("/Volumes/Work/site", Some(home)), "Volumes › Work › site");
        assert_eq!(place_words("/Users/x/a/b/c/d/e", Some(home)), "… › b › c › d › e");
        let mut st = crate::app_state::AppState::default();
        let mut e = crate::app_state::ProjectEntry {
            root: "/Users/x/Desktop/Portfolio 2026".into(),
            name: "Portfolio 2026".into(),
            ..Default::default()
        };
        st.projects.insert("lp".into(), e.clone());
        assert_eq!(
            missing_card(&st, "lp", &e.root, Some(home)),
            MissingCard {
                missing: true,
                pid: "lp".into(),
                name: "Portfolio 2026".into(),
                place: "Desktop › Portfolio 2026".into(),
            }
        );
        e.name.clear();
        st.projects.insert("lp".into(), e.clone());
        assert_eq!(missing_card(&st, "lp", &e.root, Some(home)).name, "Portfolio 2026");
        // The card is the app-local root-missing.html, never a page that only
        // shares its name on a server.
        assert!(on_card(&missing_url()));
        assert!(!on_card(&"http://localhost:4400/root-missing.html".parse().unwrap()));
        assert!(!on_card(&"tauri://localhost/index.html".parse().unwrap()));
        // The splash forwards to it, and the card's page is in the bundle.
        assert!(include_str!("../../src/index.html").contains("answer.missing"));
        let card = include_str!("../../src/root-missing.html");
        for words in [
            "isn't where it was.",
            "Nothing inside has changed — the folder was moved or renamed.",
            "Find the folder…",
            "Closing the tab keeps it on Home.",
            "invoke('relink_project'",
        ] {
            assert!(card.contains(words), "the card lost {words:?}");
        }
    }
}
