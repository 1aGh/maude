// windows.rs — project/window IDENTITY helpers (V2-1.1 home-window contract §5.2).
//
// V2-3.1 landed the pure derivations every other piece keys on: the project id
// (`pid`) the app-state registry is keyed by, the window label a project's tab
// carries, and the per-window WebKit data-store id. V2-3.2 (part a) adds the
// window model itself (§5.2): the `WindowBook` of live windows and their roles,
// focus tracking, open-once, per-window close with a grace period, and the
// caller resolution every project command goes through (§5.4). The running cap,
// resting tabs and the AI-running close confirm are part b; their seams are
// marked `SEAM (V2-3.2 part b)`.
//
// PARITY IS LOAD-BEARING. The same `pid` is derived in TS
// (`apps/studio/index/snapshot.ts` `pidOf`, and `apps/studio/home/pid.ts`): the
// Home server indexes `index/v1/projects/<pid>/` under it and the shell's registry
// is keyed by it, so a one-character drift silently splits one project into two.
// The vectors in the tests below are the TS outputs, pinned on both sides.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
#[cfg(target_os = "macos")]
use tauri::WebviewWindow;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

use crate::sidecar::SidecarState;

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The realpath string TS's `realpathSync` would produce, or `None` when the path
/// cannot be resolved (gone, permission) — the caller then hashes the input as
/// given, exactly like `pidOf`'s `catch`.
fn realpath_string(root: &str) -> Option<String> {
    let real = std::fs::canonicalize(root).ok()?;
    // `canonicalize` returns a verbatim `\\?\C:\…` path on Windows where Node's
    // `realpathSync` returns `C:\…`; hash the ordinary form or every Windows pid
    // would disagree with the server's (#141 is the same verbatim-path class).
    Some(
        crate::win_process::strip_verbatim(&real)
            .to_string_lossy()
            .into_owned(),
    )
}

/// `pid = "l" + hex(sha256(realpath(root)))[0..16]` — a project on THIS Mac (a
/// managed cloud copy too: its root is under app data). When realpath fails the
/// string is hashed as given, so a vanished root keeps the pid it was registered
/// under (contract §5.5: vanished entries are kept, not re-keyed).
pub fn pid_for_root(root: &str) -> String {
    let subject = realpath_string(root).unwrap_or_else(|| root.to_string());
    format!("l{}", &sha256_hex(subject.as_bytes())[..16])
}

/// A project window's label: `p-<pid>` (contract regex `^p-l[0-9a-f]{16}$`).
/// Labels never change for the life of a window.
pub fn label_for_pid(pid: &str) -> String {
    format!("p-{pid}")
}

/// `sha256("maude-window:" + label)[0..16]` — the WKWebView data-store identifier
/// (macOS ≥ 14) that gives each window its own cookie/localStorage jar. Derived
/// from the LABEL, not the root, so Home (`home`) gets a stable store too.
pub fn data_store_id_for_label(label: &str) -> [u8; 16] {
    let digest = Sha256::digest(format!("maude-window:{label}").as_bytes());
    let mut out = [0u8; 16];
    out.copy_from_slice(&digest[..16]);
    out
}

// ── Window model (contract §5.2) ────────────────────────────────────────────

/// The Home window's label (V2-3.3, home.rs). At most one Home window.
pub const HOME_LABEL: &str = "home";

/// How long a closed project window's server keeps running (§5.2 "Window
/// close"): a reopen inside it attaches to the live server instead of paying a
/// cold boot. After it, `shutdown_instance` stops THAT root only.
pub const CLOSE_GRACE: Duration = Duration::from_secs(10);

/// Cold-start budget for a window's first navigate — first launch runs the
/// server's boot self-heal (bun install + build), up to ~90 s.
pub const SERVER_WAIT_MS: u64 = 120_000;

/// What a window is for. `Home` and `Cell` are reserved here so the book has
/// one shape; V2-3.3 opens `home`, and `c-*` cell tabs come later.
#[derive(Clone, Debug, PartialEq)]
#[allow(dead_code)] // Cell: first constructed with the cell tabs
pub enum Role {
    Home,
    Project { pid: String, root: String },
    Cell { url: String },
}

#[derive(Clone, Debug)]
pub struct WindowEntry {
    pub role: Role,
    /// `SidecarState.tick` at the last `Focused(true)`. Part b's rest policy
    /// sorts on it (least-recently-focused idle project rests first).
    pub last_focused: u64,
    /// The server origin the SHELL last navigated this window to (scheme +
    /// host + port, loopback-validated). A command's caller check compares the
    /// page's origin with this — app-owned memory, not the in-project
    /// `_server.json` an agent, a `git clean` or a planted file can delete or
    /// rewrite (decision 8's concern, without waiting for part b's info file).
    /// `None` until the first navigate, and again after an in-tab switch.
    pub origin: Option<String>,
}

/// Every live window the shell created, keyed by label, plus which one has
/// focus. ONE mutex for both (the contract sketches two fields): every reader
/// needs the pair together ("the displayed project" = the project of
/// `focused`), and one lock can't be taken in the wrong order.
#[derive(Debug, Default)]
pub struct WindowBook {
    entries: HashMap<String, WindowEntry>,
    /// Open order, oldest first — a stable fallback when nothing is focused.
    order: Vec<String>,
    focused: Option<String>,
}

impl WindowBook {
    pub fn insert(&mut self, label: &str, role: Role, tick: u64) {
        self.order.retain(|l| l != label);
        self.order.push(label.to_string());
        self.entries.insert(
            label.to_string(),
            WindowEntry {
                role,
                last_focused: tick,
                origin: None,
            },
        );
    }

    /// Record the origin the shell just navigated `label` to.
    pub fn set_origin(&mut self, label: &str, origin: &str) {
        if let Some(e) = self.entries.get_mut(label) {
            e.origin = Some(origin.to_string());
        }
    }

    pub fn remove(&mut self, label: &str) -> Option<WindowEntry> {
        self.order.retain(|l| l != label);
        if self.focused.as_deref() == Some(label) {
            self.focused = None;
        }
        self.entries.remove(label)
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// `(pid, root)` of a project window.
    pub fn project_of(&self, label: &str) -> Option<(String, String)> {
        match &self.entries.get(label)?.role {
            Role::Project { pid, root } => Some((pid.clone(), root.clone())),
            _ => None,
        }
    }

    pub fn root_of(&self, label: &str) -> Option<String> {
        self.project_of(label).map(|(_, root)| root)
    }

    /// The window showing project `pid`, if any. Looked up through the ROLE,
    /// never derived from the label: an in-tab switch keeps a window's label
    /// while its project changes (labels never change, §5.2).
    pub fn label_for_pid(&self, pid: &str) -> Option<String> {
        self.order
            .iter()
            .find(|l| matches!(&self.entries[*l].role, Role::Project { pid: p, .. } if p == pid))
            .cloned()
    }

    pub fn label_for_root(&self, root: &str) -> Option<String> {
        self.label_for_pid(&pid_for_root(root))
    }

    /// Point an existing project window at another project (in-tab switch).
    pub fn set_project(&mut self, label: &str, root: &str) -> bool {
        match self.entries.get_mut(label) {
            Some(e) => {
                e.role = Role::Project {
                    pid: pid_for_root(root),
                    root: root.to_string(),
                };
                // The old project's origin no longer vouches for this window.
                e.origin = None;
                true
            }
            None => false,
        }
    }

    /// `Focused(true)`: stamp `focused` + `last_focused`. Unknown labels (a
    /// window the shell did not create) are ignored.
    pub fn focus(&mut self, label: &str, tick: u64) -> bool {
        match self.entries.get_mut(label) {
            Some(e) => {
                e.last_focused = tick;
                self.focused = Some(label.to_string());
                true
            }
            None => false,
        }
    }

    /// The window that has focus right now (no fallback).
    pub fn focused(&self) -> Option<&str> {
        self.focused.as_deref()
    }

    /// The window a shell-level action without a caller acts on (single-
    /// instance relaunch, the native menu, a deep link): the focused one, else
    /// the most recently focused, else the oldest.
    pub fn front_label(&self) -> Option<String> {
        if let Some(f) = &self.focused {
            return Some(f.clone());
        }
        // `max_by_key` keeps the LAST maximum; on a tie (nothing focused yet)
        // prefer the oldest window, so iterate newest-first.
        self.order
            .iter()
            .rev()
            .max_by_key(|l| self.entries[*l].last_focused)
            .cloned()
    }

    /// "The displayed project" (replaces `SidecarState.project_root`): the
    /// project of the front window.
    pub fn displayed_root(&self) -> Option<String> {
        self.front_label().and_then(|l| self.root_of(&l))
    }

    /// Every root some window currently shows.
    pub fn project_roots(&self) -> Vec<String> {
        self.order.iter().filter_map(|l| self.root_of(l)).collect()
    }

    /// The label a NEW window for `pid` gets: `p-<pid>`, unless that label is
    /// still held by a window an in-tab switch moved to another project — then
    /// `p-<pid>-2`, `-3`, … (still `p-*` for the capability, still never `main`).
    pub fn free_label_for(&self, pid: &str, taken: impl Fn(&str) -> bool) -> String {
        let base = label_for_pid(pid);
        if !self.entries.contains_key(&base) && !taken(&base) {
            return base;
        }
        (2..)
            .map(|n| format!("{base}-{n}"))
            .find(|l| !self.entries.contains_key(l) && !taken(l))
            .expect("an unbounded range always yields a free label")
    }
}

/// A window's bookkeeping on `Destroyed`: forget it, and name the root whose
/// server should stop after the grace — only when no OTHER window still shows
/// that project.
pub fn forget_window(book: &mut WindowBook, label: &str) -> Option<String> {
    let entry = book.remove(label)?;
    match entry.role {
        Role::Project { pid, root } if book.label_for_pid(&pid).is_none() => Some(root),
        _ => None,
    }
}

/// Wait out `grace`, then stop `root`'s server — unless a window for it was
/// opened again meanwhile (the reopen attached to the live server). Returns
/// whether it shut down.
pub async fn reap_after_grace(
    book: &Mutex<WindowBook>,
    root: String,
    grace: Duration,
    shutdown: impl FnOnce(&str),
) -> bool {
    tokio::time::sleep(grace).await;
    let reopened = book
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .label_for_root(&root)
        .is_some();
    if reopened {
        return false;
    }
    shutdown(&root);
    true
}

// ── Open once (§5.2 `open_project`) ─────────────────────────────────────────

/// What `open_in` needs from the windowing system — a seam so open-once is
/// testable without a running app (the Tauri impl is `TauriHost`).
pub trait WindowHost {
    fn exists(&self, label: &str) -> bool;
    /// Unminimize, focus, select its tab, and tell that window (only) it was
    /// asked for again.
    fn reveal(&self, label: &str, name: &str);
    fn create(&self, spec: &WindowSpec) -> Result<(), String>;
}

#[derive(Clone, Debug, PartialEq)]
pub struct WindowSpec {
    pub label: String,
    pub title: String,
    /// The window to attach the new one after, as a tab.
    pub caller: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Opened {
    Existing(String),
    New(String),
}

impl Opened {
    pub fn label(&self) -> &str {
        match self {
            Opened::Existing(l) | Opened::New(l) => l,
        }
    }
}

/// Open `root` once: focus the window that already shows it, else create one.
/// The book entry is written BEFORE the window is built so the `Focused` event
/// the build fires finds it; a failed build takes the entry back out.
pub fn open_in(
    host: &impl WindowHost,
    book: &Mutex<WindowBook>,
    root: &str,
    name: &str,
    caller: Option<&str>,
    tick: u64,
) -> Result<Opened, String> {
    let pid = pid_for_root(root);
    let label = {
        let mut b = book.lock().unwrap_or_else(|e| e.into_inner());
        match b.label_for_pid(&pid) {
            Some(existing) if host.exists(&existing) => {
                drop(b);
                host.reveal(&existing, name);
                return Ok(Opened::Existing(existing));
            }
            Some(stale) => {
                b.remove(&stale);
            }
            None => {}
        }
        let label = b.free_label_for(&pid, |l| host.exists(l));
        b.insert(
            &label,
            Role::Project {
                pid,
                root: root.to_string(),
            },
            tick,
        );
        label
    };
    let spec = WindowSpec {
        label: label.clone(),
        title: crate::notify::sanitize_notify_field(name),
        caller: caller.map(str::to_string),
    };
    if let Err(e) = host.create(&spec) {
        book.lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&label);
        return Err(e);
    }
    Ok(Opened::New(label))
}

/// The name a window title (and the "is open" notice) shows: the project's
/// `projectLabel ?? name` from `.design/config.json`, else its folder name. The
/// value comes from the untrusted project, so it is sanitized
/// (`notify::sanitize_notify_field`, contract §5.2 "Title") — AppKit draws it.
pub fn project_display_name(root: &str) -> String {
    let from_config = std::fs::read(Path::new(root).join(".design").join("config.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| {
            ["projectLabel", "name"].iter().find_map(|k| {
                v.get(*k)
                    .and_then(|s| s.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
            })
        });
    let name = from_config.unwrap_or_else(|| {
        Path::new(root)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.to_string())
    });
    crate::notify::sanitize_notify_field(&name)
}

/// `data_store_identifier` exists from macOS 14 (WKWebsiteDataStore
/// `dataStoreForIdentifier:`); below it the window is built without one and
/// shares the default jar (logged).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn data_store_supported_for(product_version: &str) -> bool {
    product_version
        .trim()
        .split('.')
        .next()
        .and_then(|m| m.parse::<u32>().ok())
        .is_some_and(|major| major >= 14)
}

/// macOS product version, probed once. `sysctl kern.osproductversion` is the
/// same value as `NSProcessInfo.operatingSystemVersion` without an objc struct
/// return (whose encoding objc2 verifies — a mismatch panics in debug builds).
#[cfg(target_os = "macos")]
fn macos_supports_data_store() -> bool {
    static CACHE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *CACHE.get_or_init(|| {
        // no-console-window: #[cfg(target_os = "macos")] — there is no console.
        let version = std::process::Command::new("/usr/sbin/sysctl")
            .args(["-n", "kern.osproductversion"])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default();
        let ok = data_store_supported_for(&version);
        if !ok {
            crate::sidecar::log_line(&format!(
                "[maude] macOS {:?} < 14 — project windows share one WebKit data store",
                version.trim()
            ));
        }
        ok
    })
}

/// The Tauri side of `WindowHost`.
pub struct TauriHost<'a> {
    pub app: &'a AppHandle,
}

impl WindowHost for TauriHost<'_> {
    fn exists(&self, label: &str) -> bool {
        self.app.get_webview_window(label).is_some()
    }

    fn reveal(&self, label: &str, name: &str) {
        if let Some(w) = self.app.get_webview_window(label) {
            let _ = w.unminimize();
            // `set_focus` = makeKeyAndOrderFront, which on a tabbed NSWindow
            // also selects its tab (e2e spike).
            let _ = w.set_focus();
            let _ = self.app.emit_to(
                EventTarget::AnyLabel {
                    label: label.to_string(),
                },
                "shell://opened-existing",
                serde_json::json!({ "name": name }),
            );
        }
    }

    fn create(&self, spec: &WindowSpec) -> Result<(), String> {
        // The splash (`index.html`) first; the server URL comes later through
        // the DDR-109 loopback guard in `navigate_to_server`.
        #[allow(unused_mut)]
        let mut builder =
            WebviewWindowBuilder::new(self.app, &spec.label, WebviewUrl::App("index.html".into()))
                .title(&spec.title)
                .inner_size(1280.0, 800.0)
                .min_inner_size(1024.0, 680.0)
                .disable_drag_drop_handler();
        #[cfg(target_os = "macos")]
        {
            // Every window joins one tab group (decision 2), whatever the
            // person's "Prefer tabs" setting — `attach_as_tab` does the adding.
            builder = builder.tabbing_identifier("maude");
            if macos_supports_data_store() {
                builder = builder.data_store_identifier(data_store_id_for_label(&spec.label));
            }
        }
        let win = builder
            .build()
            .map_err(|e| format!("Couldn't open a window for this project: {e}"))?;
        let parent = spec
            .caller
            .as_deref()
            .filter(|c| *c != spec.label)
            .and_then(|c| self.app.get_webview_window(c));
        match parent {
            #[cfg(target_os = "macos")]
            Some(parent) => attach_as_tab(self.app, parent, win),
            _ => {
                let _ = win.set_focus();
            }
        }
        Ok(())
    }
}

/// `[parent addTabbedWindow:child ordered:NSWindowAbove]` on the main thread,
/// then focus the child (the spike left open whether the add selects it).
/// Fire-and-forget: a caller ON the main thread (setup, a menu handler) must
/// not block waiting for a closure only the main thread can run.
#[cfg(target_os = "macos")]
fn attach_as_tab(app: &AppHandle, parent: WebviewWindow, child: WebviewWindow) {
    let result = app.run_on_main_thread(move || {
        if let (Ok(p), Ok(c)) = (parent.ns_window(), child.ns_window()) {
            use objc2::runtime::AnyObject;
            // SAFETY: both are live NSWindows owned by tao (this closure holds
            // their WebviewWindow handles); we are on the main thread.
            unsafe {
                let p = p as *mut AnyObject;
                let c = c as *mut AnyObject;
                // NSWindowOrderingMode::NSWindowAbove = 1
                let _: () = objc2::msg_send![p, addTabbedWindow: c, ordered: 1isize];
            }
        }
        let _ = child.set_focus();
    });
    if let Err(e) = result {
        crate::sidecar::log_line(&format!(
            "[maude] could not attach the window as a tab: {e}"
        ));
    }
}

/// Validate a server URL (DDR-109 §1, loopback only) and navigate `label` to
/// it — but only while that window still shows `root`: an in-tab switch or a
/// close since the wait began makes this navigate stale.
pub fn navigate_to_server(app: &AppHandle, label: &str, root: &str, url: &str, open: Option<&str>) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    match url.parse::<tauri::Url>() {
        Ok(mut parsed) if crate::server_json::is_loopback_url(&parsed) => {
            // Check-and-stamp under one lock: the window must still show
            // `root`, and the origin it is sent to becomes the one its
            // commands are answered for (`check_caller`).
            {
                let state = app.state::<SidecarState>();
                let mut book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
                let still_this_project = book
                    .project_of(label)
                    .is_some_and(|(pid, _)| pid == pid_for_root(root));
                if !still_this_project {
                    crate::sidecar::log_line(&format!(
                        "[maude] {label} no longer shows {root} — not navigating"
                    ));
                    return;
                }
                book.set_origin(label, &parsed.origin().ascii_serialization());
            }
            if let Some(rel) = open {
                parsed.query_pairs_mut().append_pair("open", rel);
            }
            if let Err(e) = window.navigate(parsed) {
                crate::sidecar::log_line(&format!("[maude] navigate failed: {e}"));
            }
        }
        Ok(parsed) => crate::sidecar::log_line(&format!(
            "[maude] refusing non-loopback navigate (DDR-109): {parsed}"
        )),
        Err(e) => crate::sidecar::log_line(&format!("[maude] invalid server url {url}: {e}")),
    }
}

/// Wait for `root`'s `_server.json`, then `navigate_to_server`. Async task;
/// every print goes through `log_line` (issue #115 — a panic here is silent and
/// would leave the window on the splash).
pub fn navigate_when_up(app: &AppHandle, label: String, root: String, open: Option<String>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let design_root = Path::new(&root).join(".design");
        match crate::server_json::wait_for_server(design_root, SERVER_WAIT_MS).await {
            Ok(url) => {
                crate::sidecar::log_line(&format!("[maude] {label}: dev-server up at {url}"));
                navigate_to_server(&app, &label, &root, &url, open.as_deref());
            }
            Err(e) => crate::sidecar::log_line(&format!(
                "[maude] {label}: dev-server did not come up: {e}"
            )),
        }
    });
}

/// Open (or focus) a window for `root` WITHOUT touching the registry — the
/// boot path, which must not register the welcome project or an
/// `MAUDE_PROJECT_ROOT` override. `caller` = the window to tab after (`None` ⇒
/// the front window).
pub fn open_window_for_root(
    app: &AppHandle,
    root: &str,
    caller: Option<&str>,
    open: Option<&str>,
) -> Result<Opened, String> {
    let state = app.state::<SidecarState>();
    let caller = caller.map(str::to_string).or_else(|| {
        state
            .windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .front_label()
    });
    let tick = state.tick.fetch_add(1, Ordering::SeqCst);
    let name = project_display_name(root);
    let opened = open_in(
        &TauriHost { app },
        &state.windows,
        root,
        &name,
        caller.as_deref(),
        tick,
    )?;
    if let Opened::New(label) = &opened {
        // Server after the window: the splash shows at once, and a server that
        // is still running for this root (closed < CLOSE_GRACE ago, or kept by
        // the pool) is attached to instead of spawned.
        crate::sidecar::attach_or_spawn(app, root);
        crate::sidecar::reap_instances(app);
        navigate_when_up(app, label.clone(), root.to_string(), open.map(str::to_string));
        crate::home::state_changed(app);
    }
    Ok(opened)
}

/// `open_window_for_root` + the registry upsert (`lastOpenedAt`, MRU) — every
/// open a person asked for (the `open_project` command, File › Open Project…).
/// `open` = a designRoot-relative canvas for a NEW window's first navigate.
pub fn open_project_window(
    app: &AppHandle,
    root: &Path,
    caller: Option<&str>,
    open: Option<&str>,
) -> Result<Opened, String> {
    if !root.join(".design").is_dir() {
        return Err("That folder isn’t a Maude project yet (no design system). Open it and run “Set up a design system” first.".to_string());
    }
    crate::app_state::upsert_project(app, root);
    open_window_for_root(app, &root.to_string_lossy(), caller, open)
}

// ── Window events ───────────────────────────────────────────────────────────

/// `Focused(true)`: the front window, and (for the pool's least-recently-shown
/// eviction) its project's `last_shown`.
pub fn on_focused(app: &AppHandle, label: &str) {
    let Some(state) = app.try_state::<SidecarState>() else {
        return;
    };
    let tick = state.tick.fetch_add(1, Ordering::SeqCst);
    let root = {
        let mut book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
        if !book.focus(label, tick) {
            return;
        }
        book.root_of(label)
    };
    if let Some(root) = root {
        crate::sidecar::mark_shown(app, &root, tick);
    }
    // SEAM (V2-3.2 part b): a resting window wakes here (spawn + navigate).
    crate::home::state_changed(app);
}

/// What a window close should do before the window goes away.
#[derive(Debug, PartialEq)]
pub enum CloseGuard {
    Proceed,
    /// Keep the window open (part b: the person cancelled "Stop AI in …?").
    #[allow(dead_code)] // first constructed by part b's AI-running confirm
    Hold,
}

/// SEAM (V2-3.2 part b): the AI-running close confirm. Part b probes the
/// project's `/_api/shell/status` (authenticated, decision 8) and, when AI is
/// running or waiting, shows "Stop AI in <name>?" and returns `Hold` unless
/// the person picks Stop and close. Until then every close proceeds.
pub fn close_guard(_app: &AppHandle, _label: &str) -> CloseGuard {
    CloseGuard::Proceed
}

/// `Destroyed` (⌘W, the tab's ×, WebDriver's DELETE /window): forget the
/// window; if it was the last one showing its project, stop that project's
/// server after `CLOSE_GRACE` — that root only (e2e spike finding 1: closing
/// any tab used to drain the whole pool).
pub fn on_destroyed(app: &AppHandle, label: &str) {
    let Some(state) = app.try_state::<SidecarState>() else {
        return;
    };
    let root = forget_window(
        &mut state.windows.lock().unwrap_or_else(|e| e.into_inner()),
        label,
    );
    // An intent parked for this window dies with it (a later window with the
    // same label must not inherit it), and Home's tab list changed.
    crate::home::take_intent(label);
    crate::home::state_changed(app);
    let Some(root) = root else { return };
    crate::sidecar::log_line(&format!(
        "[maude] {label} closed — {root}'s server stops in {}s unless it is reopened",
        CLOSE_GRACE.as_secs()
    ));
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = app.state::<SidecarState>();
        reap_after_grace(&state.windows, root, CLOSE_GRACE, |r| {
            // A quit during the grace already drained the pool.
            if !state.shutting_down.load(Ordering::SeqCst) {
                crate::sidecar::log_line(&format!("[maude] stopping {r}'s server (window closed)"));
                crate::sidecar::shutdown_instance(&app, r);
            }
        })
        .await;
    });
}

/// The front window, unminimized and focused (single-instance relaunch).
pub fn reveal_front(app: &AppHandle) {
    let label = app.try_state::<SidecarState>().and_then(|s| {
        s.windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .front_label()
    });
    if let Some(w) = label.and_then(|l| app.get_webview_window(&l)) {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Emit to the front window only — a shell-level event (the native menu)
/// belongs to the window the person is looking at, not every tab.
pub fn emit_to_front<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    let label = app.try_state::<SidecarState>().and_then(|s| {
        s.windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .front_label()
    });
    let _ = match label {
        Some(label) => app.emit_to(EventTarget::AnyLabel { label }, event, payload),
        None => app.emit(event, payload),
    };
}

// ── Caller resolution (contract §5.4) ───────────────────────────────────────

/// The project window a command was invoked from.
#[derive(Clone, Debug, PartialEq)]
pub struct CallerProject {
    pub label: String,
    pub pid: String,
    pub root: String,
}

/// The app-local origin the splash (`index.html`) runs on: `tauri://localhost`
/// on macOS/Linux, `http(s)://tauri.localhost` on Windows.
pub(crate) fn is_app_local(url: &tauri::Url) -> bool {
    url.scheme() == "tauri"
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
}

/// Pure half of `caller_project`. A caller is a project window when its label
/// is in the book with a `Project` role AND its current URL is on the origin
/// the shell itself navigated that window to (`WindowEntry.origin`) — or, only
/// where the command allows it, the app-local splash. A `p-*` window that
/// ended up on another origin (another project's server, the canvas origin)
/// answers for nobody.
pub fn check_caller(
    book: &WindowBook,
    label: &str,
    url: Option<&tauri::Url>,
    allow_app_local: bool,
) -> Result<CallerProject, String> {
    let entry = book
        .entries
        .get(label)
        .ok_or_else(|| "This window isn't showing a project.".to_string())?;
    let Role::Project { pid, root } = &entry.role else {
        return Err("This window isn't showing a project.".to_string());
    };
    let url = url.ok_or_else(|| "This window has no address.".to_string())?;
    let on_server = crate::server_json::is_loopback_url(url)
        && entry
            .origin
            .as_deref()
            .is_some_and(|o| url.origin().ascii_serialization() == o);
    if on_server || (allow_app_local && is_app_local(url)) {
        Ok(CallerProject {
            label: label.to_string(),
            pid: pid.clone(),
            root: root.clone(),
        })
    } else {
        Err("This window isn't showing its project.".to_string())
    }
}

/// Resolve the calling project window from the `Webview` a command was
/// invoked on — label AND current URL origin, never an argument (§5.4).
/// SEAM (V2-3.2 part b): the shell learns each server's port from the
/// app-owned `MAUDE_SHELL_INFO_FILE` (decision 8); the recorded origin then
/// comes from there instead of the in-project `_server.json` read at navigate.
pub fn caller_project<R: Runtime>(
    webview: &tauri::Webview<R>,
    allow_app_local: bool,
) -> Result<CallerProject, String> {
    let state = webview
        .app_handle()
        .try_state::<SidecarState>()
        .ok_or_else(|| "Maude is still starting.".to_string())?;
    let url = webview.url().ok();
    let book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
    check_caller(&book, webview.label(), url.as_ref(), allow_app_local)
}

/// The window currently showing `root`.
pub fn label_for_root(app: &AppHandle, root: &str) -> Option<String> {
    app.try_state::<SidecarState>()?
        .windows
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .label_for_root(root)
}

// ── Commands ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct OpenedProject {
    label: String,
    /// `"existing"` (open once: its tab was focused) or `"new"`.
    opened: &'static str,
}

impl From<&Opened> for OpenedProject {
    fn from(o: &Opened) -> Self {
        OpenedProject {
            label: o.label().to_string(),
            opened: match o {
                Opened::Existing(_) => "existing",
                Opened::New(_) => "new",
            },
        }
    }
}

/// Who invoked a command that both roles may call (§5.4).
#[derive(Clone, Debug, PartialEq)]
pub enum Caller {
    Home,
    Project(CallerProject),
}

/// Resolve the caller as Home (label `home` AND the Home origin, re-checked in
/// `home::check_home`) or as a project window (`caller_project`). A `p-*`
/// window that navigated to the Home URL is a project window on the wrong
/// origin — refused, never promoted to Home (§5.8 item 3).
pub fn caller_any<R: Runtime>(
    webview: &tauri::Webview<R>,
    allow_app_local: bool,
) -> Result<Caller, String> {
    if webview.label() == HOME_LABEL {
        crate::home::caller_home(webview, allow_app_local).map(|()| Caller::Home)
    } else {
        caller_project(webview, allow_app_local).map(Caller::Project)
    }
}

/// `target` of `open_project`: a canvas (designRoot-relative) and an artboard.
#[derive(Clone, Debug, Default, PartialEq, serde::Deserialize, Serialize)]
pub struct OpenTarget {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvas: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artboard: Option<String>,
}

/// Validate a page-supplied target: the canvas through the same check as a
/// deep link's `open` (relative, no `..`), the artboard as a short plain id.
pub fn validate_target(t: OpenTarget) -> Result<OpenTarget, String> {
    let bad = || "Invalid canvas address.".to_string();
    let canvas = t
        .canvas
        .map(|c| crate::project_resolve::validate_open_param(&c).ok_or_else(bad))
        .transpose()?;
    let artboard = t
        .artboard
        .map(|a| {
            if a.is_empty() || a.chars().count() > 128 || a.chars().any(char::is_control) {
                Err(bad())
            } else {
                Ok(a)
            }
        })
        .transpose()?;
    Ok(OpenTarget { canvas, artboard })
}

/// Which folder an `open_project` call names, and whether this caller may name
/// it (§5.4 Check, §5.8 item 3). Pure, so the gate is testable.
///   - `{root}` is Home-only (a project window passes a pid).
///   - `{pid}` from Home: any registered project.
///   - `{pid}` from a project: its own, or one bound to the same account profile
///     (the `index_search` scope).
pub fn resolve_open_root(
    caller: &Caller,
    st: &crate::app_state::AppState,
    pid: Option<&str>,
    root: Option<&str>,
) -> Result<PathBuf, String> {
    match (pid, root) {
        (Some(_), Some(_)) | (None, None) => Err("Name one project to open.".to_string()),
        (None, Some(root)) => match caller {
            Caller::Home => Ok(PathBuf::from(root)),
            Caller::Project(_) => Err("Only Home can open a project by its folder.".to_string()),
        },
        (Some(pid), None) => {
            if let Caller::Project(c) = caller {
                if c.pid == pid {
                    return Ok(PathBuf::from(&c.root));
                }
            }
            let entry = st
                .projects
                .get(pid)
                .ok_or_else(|| "That project isn't in your list.".to_string())?;
            match caller {
                Caller::Home => Ok(PathBuf::from(&entry.root)),
                Caller::Project(c) if entry.profile == st.profile_for(&c.root) => {
                    Ok(PathBuf::from(&entry.root))
                }
                Caller::Project(_) => Err("That project belongs to another account.".to_string()),
            }
        }
    }
}

/// `open_project({pid} | {root}, target?, intent?)` — open a project as a new
/// tab after the calling window, or focus its tab if it is already open (open
/// once, §5.2). From Home, the Home tab closes once the project tab is key
/// (decision 3). `target` reaches an existing window as `shell://navigate` and
/// a new one as its first navigate's `?open=`; `intent` is parked for the
/// target window (`take_pending_intent`) — prompt text never in a URL.
/// `async`: building a window from a sync command runs on the main thread and
/// deadlocks on Windows (Tauri docs).
#[tauri::command]
pub async fn open_project(
    app: AppHandle,
    webview: tauri::Webview,
    pid: Option<String>,
    root: Option<String>,
    target: Option<OpenTarget>,
    intent: Option<crate::home::OpenIntent>,
) -> Result<OpenedProject, String> {
    let caller = caller_any(&webview, false)?;
    let st = crate::app_state::load(&app);
    let path = resolve_open_root(&caller, &st, pid.as_deref(), root.as_deref())?;
    let target = target.map(validate_target).transpose()?;
    let intent = intent.map(crate::home::validate_intent).transpose()?;
    if !path.is_dir() {
        return Err("That project folder doesn’t exist.".to_string());
    }
    let canvas = target.as_ref().and_then(|t| t.canvas.clone());
    let opened = open_project_window(&app, &path, Some(webview.label()), canvas.as_deref())?;
    let label = opened.label().to_string();
    if let Some(intent) = intent {
        crate::home::park_intent(&app, &label, intent);
    }
    if let (Opened::Existing(_), Some(t)) = (&opened, &target) {
        let _ = app.emit_to(
            EventTarget::AnyLabel {
                label: label.clone(),
            },
            "shell://navigate",
            t.clone(),
        );
    }
    if caller == Caller::Home {
        crate::home::close_home_when_key(&app, &label);
    }
    Ok(OpenedProject::from(&opened))
}

/// Debug-only e2e helper: `open_project` by folder from a PROJECT window (the
/// `{root}` form is Home-only in the real command). The same open path —
/// registry upsert, open once, tab after the caller. Granted only by
/// capabilities/e2e-webdriver.json; a release build answers Err.
#[tauri::command]
pub async fn e2e_open_root(
    app: AppHandle,
    webview: tauri::Webview,
    root: String,
) -> Result<OpenedProject, String> {
    #[cfg(debug_assertions)]
    {
        let caller = caller_any(&webview, false)?;
        let opened = open_project_window(&app, Path::new(&root), Some(webview.label()), None)?;
        if caller == Caller::Home {
            crate::home::close_home_when_key(&app, opened.label());
        }
        Ok(OpenedProject::from(&opened))
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (app, webview, root);
        Err("debug builds only".into())
    }
}

// Debug-only e2e helpers (lifted from the V2-3.2 e2e spike). Bodies are
// `#[cfg(debug_assertions)]`; a release build gets an Err stub, and only the
// e2e-webdriver capability grants them — never `default.json`.

/// Every live webview-window label, sorted — a cross-check for WebDriver's
/// own handle list.
#[tauri::command]
pub fn window_labels(app: AppHandle) -> Vec<String> {
    #[cfg(debug_assertions)]
    {
        let mut v: Vec<String> = app.webview_windows().keys().cloned().collect();
        v.sort();
        v
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        Vec::new()
    }
}

/// Bring a window (tab) to the front. A background tab is `document.hidden`
/// and gets 0 rAF/s, so a scenario selects the tab before any animation-gated
/// check (spike "Ceiling").
#[tauri::command]
pub fn e2e_focus_window(app: AppHandle, label: String) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let w = app
            .get_webview_window(&label)
            .ok_or_else(|| format!("no window {label}"))?;
        w.set_focus().map_err(|e| e.to_string())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (app, label);
        Err("debug builds only".into())
    }
}

/// Close a window: `destroy: true` skips `CloseRequested` (what WebDriver's
/// DELETE /window does); `false` goes through the user close path (⌘W, ×),
/// including `close_guard`.
#[tauri::command]
pub fn e2e_close_window(app: AppHandle, label: String, destroy: bool) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let w = app
            .get_webview_window(&label)
            .ok_or_else(|| format!("no window {label}"))?;
        if destroy { w.destroy() } else { w.close() }.map_err(|e| e.to_string())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (app, label, destroy);
        Err("debug builds only".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn pid_parity_vector_for_a_path_that_does_not_exist() {
        // Nonexistent ⇒ realpath fails ⇒ hashed as given. Same value TS pidOf prints.
        assert_eq!(
            pid_for_root("/Users/x/Maude/alligators"),
            "l6ff9cde02f1b516d"
        );
    }

    #[test]
    fn pid_hashes_the_realpath_when_the_root_exists() {
        let dir = std::env::temp_dir().join(format!("maude-pid-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let real = std::fs::canonicalize(&dir).unwrap();
        let expected = format!("l{}", &sha256_hex(real.to_string_lossy().as_bytes())[..16]);
        // A trailing `/.` resolves to the same realpath → the same pid.
        let dotted = format!("{}/.", dir.to_string_lossy());
        assert_eq!(pid_for_root(&dotted), expected);
        assert_eq!(pid_for_root(&dir.to_string_lossy()), expected);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn labels_and_data_store_ids() {
        let pid = pid_for_root("/Users/x/Maude/alligators");
        let label = label_for_pid(&pid);
        assert_eq!(label, "p-l6ff9cde02f1b516d");
        assert_eq!(label.len(), 19);
        assert_eq!(
            hex(&data_store_id_for_label("home")),
            "98df3f4077c6a139537de9d66d4c18fd"
        );
        assert_ne!(
            data_store_id_for_label(&label),
            data_store_id_for_label("home")
        );
    }

    // ── V2-3.2 window model ────────────────────────────────────────────────

    use std::cell::RefCell;

    /// A windowing system with no windows except the ones `create` adds.
    #[derive(Default)]
    struct MockHost {
        live: RefCell<Vec<String>>,
        created: RefCell<Vec<WindowSpec>>,
        revealed: RefCell<Vec<(String, String)>>,
        fail_create: bool,
    }

    impl WindowHost for MockHost {
        fn exists(&self, label: &str) -> bool {
            self.live.borrow().iter().any(|l| l == label)
        }
        fn reveal(&self, label: &str, name: &str) {
            self.revealed
                .borrow_mut()
                .push((label.to_string(), name.to_string()));
        }
        fn create(&self, spec: &WindowSpec) -> Result<(), String> {
            if self.fail_create {
                return Err("no".into());
            }
            self.live.borrow_mut().push(spec.label.clone());
            self.created.borrow_mut().push(spec.clone());
            Ok(())
        }
    }

    const A: &str = "/nonexistent/maude-v2-3-2/alpha";
    const B: &str = "/nonexistent/maude-v2-3-2/beta";

    fn label_of(root: &str) -> String {
        label_for_pid(&pid_for_root(root))
    }

    #[test]
    fn open_once_focuses_the_existing_window_instead_of_creating_one() {
        let host = MockHost::default();
        let book = Mutex::new(WindowBook::default());

        let first = open_in(&host, &book, A, "Alpha", None, 1).unwrap();
        assert_eq!(first, Opened::New(label_of(A)));

        // Second open of the same project: its window is focused, none created,
        // and only THAT window hears about it.
        let again = open_in(&host, &book, A, "Alpha", Some("p-other"), 2).unwrap();
        assert_eq!(again, Opened::Existing(label_of(A)));
        assert_eq!(host.created.borrow().len(), 1);
        assert_eq!(
            host.revealed.borrow().as_slice(),
            &[(label_of(A), "Alpha".to_string())]
        );

        // Another project opens as a NEW tab after the caller.
        let b = open_in(&host, &book, B, "Beta\u{7}", Some(&label_of(A)), 3).unwrap();
        assert_eq!(b, Opened::New(label_of(B)));
        let spec = host.created.borrow()[1].clone();
        assert_eq!(spec.caller.as_deref(), Some(label_of(A).as_str()));
        assert_eq!(
            spec.title, "Beta",
            "the title is sanitized (control chars stripped)"
        );
        assert_eq!(
            book.lock().unwrap().root_of(&label_of(B)).as_deref(),
            Some(B)
        );
    }

    #[test]
    fn open_once_from_home_and_from_a_project() {
        let host = MockHost::default();
        let book = Mutex::new(WindowBook::default());
        book.lock().unwrap().insert(HOME_LABEL, Role::Home, 0);
        host.live.borrow_mut().push(HOME_LABEL.to_string());

        // From Home: a new tab right after Home (Home then closes — home.rs).
        let a = open_in(&host, &book, A, "Alpha", Some(HOME_LABEL), 1).unwrap();
        assert_eq!(a, Opened::New(label_of(A)));
        assert_eq!(host.created.borrow()[0].caller.as_deref(), Some(HOME_LABEL));

        // From a project (B's tab): A is open — focused, never created again.
        let b = open_in(&host, &book, B, "Beta", Some(&label_of(A)), 2).unwrap();
        assert_eq!(b, Opened::New(label_of(B)));
        let again = open_in(&host, &book, A, "Alpha", Some(&label_of(B)), 3).unwrap();
        assert_eq!(again, Opened::Existing(label_of(A)));
        // …and from Home again: still the same window.
        let from_home = open_in(&host, &book, A, "Alpha", Some(HOME_LABEL), 4).unwrap();
        assert_eq!(from_home, Opened::Existing(label_of(A)));
        assert_eq!(host.created.borrow().len(), 2);
        // Home is never mistaken for a project window.
        let b_ = book.lock().unwrap();
        assert_eq!(b_.project_of(HOME_LABEL), None);
        assert_eq!(b_.label_for_pid(&pid_for_root(A)), Some(label_of(A)));
    }

    fn st_with(entries: &[(&str, &str, &str)]) -> crate::app_state::AppState {
        let mut st = crate::app_state::AppState::default();
        for (pid, root, profile) in entries {
            st.projects.insert(
                pid.to_string(),
                serde_json::from_value(serde_json::json!({ "root": root, "profile": profile }))
                    .unwrap(),
            );
        }
        st
    }

    #[test]
    fn home_gate_open_project_by_folder_is_home_only() {
        let st = st_with(&[("lself", A, "default"), ("lsame", B, "default"), ("lwork", "/w", "work")]);
        let project = Caller::Project(CallerProject {
            label: "p-lself".into(),
            pid: "lself".into(),
            root: A.into(),
        });
        // {root} — Home only (§5.8 item 3).
        assert!(resolve_open_root(&project, &st, None, Some("/x")).is_err());
        assert_eq!(
            resolve_open_root(&Caller::Home, &st, None, Some("/x")).unwrap(),
            PathBuf::from("/x")
        );
        // {pid} from a project: its own, or the same account profile.
        assert_eq!(resolve_open_root(&project, &st, Some("lself"), None).unwrap(), PathBuf::from(A));
        assert_eq!(resolve_open_root(&project, &st, Some("lsame"), None).unwrap(), PathBuf::from(B));
        assert!(resolve_open_root(&project, &st, Some("lwork"), None).is_err());
        // {pid} from Home: any registered project, never an unknown one.
        assert!(resolve_open_root(&Caller::Home, &st, Some("lwork"), None).is_ok());
        assert!(resolve_open_root(&Caller::Home, &st, Some("lnope"), None).is_err());
        // Exactly one of the two.
        assert!(resolve_open_root(&Caller::Home, &st, Some("lwork"), Some("/x")).is_err());
        assert!(resolve_open_root(&Caller::Home, &st, None, None).is_err());
        // A target canvas goes through the deep-link path check.
        assert!(validate_target(OpenTarget { canvas: Some("../etc/x.tsx".into()), artboard: None }).is_err());
        assert_eq!(
            validate_target(OpenTarget { canvas: Some(".design/ui/a.tsx".into()), artboard: Some("hero".into()) })
                .unwrap()
                .canvas
                .as_deref(),
            Some("ui/a.tsx")
        );
    }

    #[test]
    fn open_once_replaces_a_stale_entry_and_a_failed_build_leaves_none() {
        // The book names a window the system no longer has (it died without a
        // Destroyed event): the open creates a fresh one instead of focusing a ghost.
        let host = MockHost::default();
        let book = Mutex::new(WindowBook::default());
        book.lock().unwrap().insert(
            &label_of(A),
            Role::Project {
                pid: pid_for_root(A),
                root: A.into(),
            },
            0,
        );
        assert_eq!(
            open_in(&host, &book, A, "Alpha", None, 1).unwrap(),
            Opened::New(label_of(A))
        );

        let failing = MockHost {
            fail_create: true,
            ..MockHost::default()
        };
        let book = Mutex::new(WindowBook::default());
        assert!(open_in(&failing, &book, B, "Beta", None, 1).is_err());
        assert!(book.lock().unwrap().is_empty());
    }

    #[test]
    fn a_window_label_is_never_main() {
        let host = MockHost::default();
        let book = Mutex::new(WindowBook::default());
        for root in [A, B, "/", "", "main", "/Users/x/Maude/main"] {
            let opened = open_in(&host, &book, root, "x", None, 1).unwrap();
            let label = opened.label();
            assert_ne!(label, "main");
            assert!(label.starts_with("p-l") && label.len() == 19, "{label}");
        }
        // An in-tab switch keeps the label; a later window for the old project
        // takes the next free `p-*` label — still never `main`.
        let mut b = WindowBook::default();
        b.insert(
            &label_of(A),
            Role::Project {
                pid: pid_for_root(A),
                root: A.into(),
            },
            0,
        );
        assert!(b.set_project(&label_of(A), B));
        assert_eq!(b.label_for_root(B), Some(label_of(A)));
        assert_eq!(b.label_for_root(A), None);
        let fresh = b.free_label_for(&pid_for_root(A), |_| false);
        assert_eq!(fresh, format!("{}-2", label_of(A)));

        // No window is declared in config: Rust creates every one (so none can
        // inherit tauri.conf.json's unnamed default label, `main`).
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["app"]["windows"], serde_json::json!([]));
    }

    #[test]
    fn caller_resolution_needs_the_label_and_the_origin_the_shell_sent_it_to() {
        let mut book = WindowBook::default();
        let label = label_of(A);
        book.insert(
            &label,
            Role::Project {
                pid: pid_for_root(A),
                root: A.into(),
            },
            0,
        );
        let url = |s: &str| s.parse::<tauri::Url>().unwrap();
        let page = url("http://localhost:4401/?x=1");

        // Not navigated by the shell yet: no origin vouches for the window.
        assert!(check_caller(&book, &label, Some(&page), false).is_err());

        book.set_origin(&label, "http://localhost:4401");
        let ok = check_caller(&book, &label, Some(&page), false).unwrap();
        assert_eq!(ok.root, A);
        assert_eq!(ok.pid, pid_for_root(A));

        // Another server's origin (another project, the canvas origin): refused.
        let other = url("http://localhost:4402/");
        assert!(check_caller(&book, &label, Some(&other), false).is_err());
        // Not loopback, even if the recorded origin somehow said so.
        book.set_origin(&label, "https://evil.example");
        let evil = url("https://evil.example/");
        assert!(check_caller(&book, &label, Some(&evil), false).is_err());
        book.set_origin(&label, "http://localhost:4401");
        // A label the shell did not create: refused.
        assert!(check_caller(&book, "p-l0000000000000000", Some(&page), false).is_err());
        // An in-tab switch drops the old project's origin until the new navigate.
        assert!(book.set_project(&label, B));
        assert!(check_caller(&book, &label, Some(&page), false).is_err());
        // The app-local splash: only where the command allows it.
        let splash = url("tauri://localhost/index.html");
        assert!(check_caller(&book, &label, Some(&splash), false).is_err());
        assert_eq!(
            check_caller(&book, &label, Some(&splash), true)
                .unwrap()
                .root,
            B
        );
        let windows_splash = url("http://tauri.localhost/");
        assert!(check_caller(&book, &label, Some(&windows_splash), true).is_ok());
    }

    #[test]
    fn closing_one_window_stops_only_its_root_after_the_grace() {
        let book = Mutex::new(WindowBook::default());
        {
            let mut b = book.lock().unwrap();
            for (root, tick) in [(A, 1), (B, 2)] {
                b.insert(
                    &label_of(root),
                    Role::Project {
                        pid: pid_for_root(root),
                        root: root.into(),
                    },
                    tick,
                );
            }
            b.focus(&label_of(B), 3);
        }
        let reap = forget_window(&mut book.lock().unwrap(), &label_of(B));
        assert_eq!(reap.as_deref(), Some(B));
        // The surviving window becomes the displayed project.
        assert_eq!(book.lock().unwrap().displayed_root().as_deref(), Some(A));

        let stopped = RefCell::new(Vec::<String>::new());
        let grace = Duration::from_millis(80);
        let t0 = std::time::Instant::now();
        let shut = tauri::async_runtime::block_on(reap_after_grace(&book, B.into(), grace, |r| {
            stopped.borrow_mut().push(r.to_string());
            assert!(t0.elapsed() >= grace, "stopped before the grace ran out");
        }));
        assert!(shut);
        assert_eq!(stopped.borrow().as_slice(), &[B.to_string()]);
    }

    #[test]
    fn a_reopen_during_the_grace_keeps_the_server_and_a_shared_root_is_not_reaped() {
        let book = Mutex::new(WindowBook::default());
        let reopen = || {
            book.lock().unwrap().insert(
                &label_of(A),
                Role::Project {
                    pid: pid_for_root(A),
                    root: A.into(),
                },
                9,
            )
        };
        reopen();
        let reap = forget_window(&mut book.lock().unwrap(), &label_of(A));
        assert_eq!(reap.as_deref(), Some(A));
        reopen(); // reopened inside the grace
        let shut = tauri::async_runtime::block_on(reap_after_grace(
            &book,
            A.into(),
            Duration::from_millis(10),
            |_| panic!("a reopened project must keep its server"),
        ));
        assert!(!shut);

        // Two windows on one root (an in-tab switch landed on it): closing one
        // names nothing to stop.
        let mut b = WindowBook::default();
        b.insert(
            "p-x",
            Role::Project {
                pid: pid_for_root(A),
                root: A.into(),
            },
            0,
        );
        b.insert(
            "p-y",
            Role::Project {
                pid: pid_for_root(A),
                root: A.into(),
            },
            0,
        );
        assert_eq!(forget_window(&mut b, "p-x"), None);
        assert_eq!(forget_window(&mut b, "p-y").as_deref(), Some(A));
    }

    #[test]
    fn front_window_falls_back_to_the_most_recently_focused() {
        let mut b = WindowBook::default();
        assert_eq!(b.front_label(), None);
        b.insert(
            "p-a",
            Role::Project {
                pid: "la".into(),
                root: A.into(),
            },
            0,
        );
        b.insert(
            "p-b",
            Role::Project {
                pid: "lb".into(),
                root: B.into(),
            },
            0,
        );
        assert_eq!(
            b.front_label().as_deref(),
            Some("p-a"),
            "nothing focused: the oldest"
        );
        b.focus("p-b", 5);
        assert_eq!(b.displayed_root().as_deref(), Some(B));
        b.focus("p-a", 6);
        b.remove("p-a");
        assert_eq!(b.front_label().as_deref(), Some("p-b"));
        assert!(
            !b.focus("p-unknown", 7),
            "a window the shell did not create is ignored"
        );
    }

    #[test]
    fn capability_windows_match_the_window_model() {
        let read = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap();
        let default = read(include_str!("../capabilities/default.json"));
        let e2e = read(include_str!("../capabilities/e2e-webdriver.json"));
        assert_eq!(default["windows"], serde_json::json!(["p-*"]));
        assert_eq!(e2e["windows"], serde_json::json!(["home", "p-*"]));
        let perms = |v: &serde_json::Value| -> Vec<String> {
            v["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|p| p.as_str().map(str::to_string))
                .collect()
        };
        let debug_only = [
            "allow-window-labels",
            "allow-e2e-focus-window",
            "allow-e2e-close-window",
            "allow-e2e-open-root",
        ];
        for p in debug_only {
            assert!(
                !perms(&default).iter().any(|d| d == p),
                "{p} must never be in default.json"
            );
            assert!(
                perms(&e2e).iter().any(|d| d == p),
                "{p} belongs to the e2e capability"
            );
        }
        assert!(perms(&default).iter().any(|p| p == "allow-open-project"));
    }

    #[test]
    fn data_store_needs_macos_14() {
        assert!(data_store_supported_for("14.0"));
        assert!(data_store_supported_for("26.5.1\n"));
        assert!(!data_store_supported_for("13.6.1"));
        assert!(!data_store_supported_for(""));
    }
}
