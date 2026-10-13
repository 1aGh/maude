// windows.rs — project/window IDENTITY helpers (V2-1.1 home-window contract §5.2).
//
// V2-3.1 landed the pure derivations every other piece keys on: the project id
// (`pid`) the app-state registry is keyed by, the window label a project's tab
// carries, and the per-window WebKit data-store id. V2-3.2 (part a) adds the
// window model itself (§5.2): the `WindowBook` of live windows and their roles,
// focus tracking, open-once, per-window close with a grace period, and the
// caller resolution every project command goes through (§5.4). Part b adds the
// running cap's resting tabs (wake on focus), the AI-running close confirm and
// the tab session (save on open/close/focus, restore on relaunch).
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
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

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

/// The Home window's label (V2-3.3 builds Home; part a only reserves the name).
#[allow(dead_code)] // first caller: V2-3.3 (Home window)
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
#[allow(dead_code)] // Home / Cell: first constructed in V2-3.3
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
    /// The tab is RESTING (§5.2 "Rest (cap)"): its server was stopped to keep
    /// the running count at the cap; it shows the splash until focus wakes it.
    /// Live only, never on disk (decision 5).
    pub resting: bool,
    /// A close is waiting on the status probe or the "Stop AI in …?" confirm;
    /// a second ⌘W meanwhile must not stack a second dialog.
    pub closing: bool,
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
    /// Tab order as the person sees it: a new window is attached right after
    /// the window that opened it (`addTabbedWindow:ordered:NSWindowAbove`), so
    /// this mirrors that placement. What the session saves (§5.5).
    tabs: Vec<String>,
    focused: Option<String>,
}

impl WindowBook {
    #[cfg(test)]
    pub fn insert(&mut self, label: &str, role: Role, tick: u64) {
        self.insert_after(label, role, tick, None);
    }

    /// `insert`, placing the tab right after `after` (the window that opened
    /// it) — at the end when `after` is absent or unknown.
    pub fn insert_after(&mut self, label: &str, role: Role, tick: u64, after: Option<&str>) {
        self.order.retain(|l| l != label);
        self.order.push(label.to_string());
        self.tabs.retain(|l| l != label);
        let at = after
            .and_then(|a| self.tabs.iter().position(|l| l == a))
            .map(|i| i + 1)
            .unwrap_or(self.tabs.len());
        self.tabs.insert(at, label.to_string());
        self.entries.insert(
            label.to_string(),
            WindowEntry {
                role,
                last_focused: tick,
                origin: None,
                resting: false,
                closing: false,
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
        self.tabs.retain(|l| l != label);
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

    /// `last_focused` of a window — the rest policy's LRU key.
    pub fn last_focused(&self, label: &str) -> Option<u64> {
        self.entries.get(label).map(|e| e.last_focused)
    }

    pub fn is_resting(&self, label: &str) -> bool {
        self.entries.get(label).is_some_and(|e| e.resting)
    }

    /// Mark a project tab resting or awake. A resting tab is on the splash, so
    /// the server origin it was sent to no longer vouches for it.
    pub fn set_resting(&mut self, label: &str, resting: bool) -> bool {
        match self.entries.get_mut(label) {
            Some(e) if matches!(e.role, Role::Project { .. }) => {
                e.resting = resting;
                if resting {
                    e.origin = None;
                }
                true
            }
            _ => false,
        }
    }

    /// Claim the close of `label`; false if a close is already in flight.
    pub fn begin_close(&mut self, label: &str) -> bool {
        match self.entries.get_mut(label) {
            Some(e) if !e.closing => {
                e.closing = true;
                true
            }
            _ => false,
        }
    }

    pub fn end_close(&mut self, label: &str) {
        if let Some(e) = self.entries.get_mut(label) {
            e.closing = false;
        }
    }

    /// May the shell navigate `label` to `root`'s server now? Only while the
    /// window still shows `root` (an in-tab switch or a close since the wait
    /// began makes the navigate stale) and is not resting — a respawn's
    /// re-navigate must never wake a resting tab (§5.2 "Respawn after a crash").
    pub fn may_navigate(&self, label: &str, root: &str) -> bool {
        self.project_of(label)
            .is_some_and(|(pid, _)| pid == pid_for_root(root))
            && !self.is_resting(label)
    }

    /// The session to save (§5.5 `session`): every tab in tab order, a project
    /// tab with its pid, and the focused (else front) label.
    pub fn session_tabs(&self) -> (Vec<crate::app_state::SessionTab>, Option<String>) {
        let tabs = self
            .tabs
            .iter()
            .map(|l| crate::app_state::SessionTab {
                label: l.clone(),
                pid: self.project_of(l).map(|(pid, _)| pid),
            })
            .collect();
        (tabs, self.front_label())
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
        b.insert_after(
            &label,
            Role::Project {
                pid,
                root: root.to_string(),
            },
            tick,
            caller,
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
                if !book.may_navigate(label, root) {
                    crate::sidecar::log_line(&format!(
                        "[maude] {label} no longer shows {root}, or is resting — not navigating"
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

/// Wait for `root`'s server to write its APP-OWNED info file (decision 8 —
/// never the in-project `_server.json`, which a planted file could point at a
/// loopback impostor that would then hold this window's IPC), then
/// `navigate_to_server`. Async task; every print goes through `log_line`
/// (issue #115 — a panic here is silent and would leave the window on the
/// splash).
pub fn navigate_when_up(app: &AppHandle, label: String, root: String, open: Option<String>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match crate::sidecar::wait_for_shell_url(&app, &root, SERVER_WAIT_MS).await {
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
        crate::sidecar::spawn_enforce_cap(app);
        navigate_when_up(app, label.clone(), root.to_string(), None);
        schedule_session_save(app);
    }
    Ok(opened)
}

/// `open_window_for_root` + the registry upsert (`lastOpenedAt`) — every open a
/// person asked for (the `open_project` command, File › Open Project…).
pub fn open_project_window(
    app: &AppHandle,
    root: &Path,
    caller: Option<&str>,
) -> Result<Opened, String> {
    if !root.join(".design").is_dir() {
        return Err("That folder isn’t a Maude project yet (no design system). Open it and run “Set up a design system” first.".to_string());
    }
    crate::app_state::upsert_project(app, root);
    open_window_for_root(app, &root.to_string_lossy(), caller)
}

// ── Window events ───────────────────────────────────────────────────────────

/// `Focused(true)`: the front window, its project's `last_shown`, a session
/// save, and — for a resting tab — the wake (§5.2 "Window Focused(true)").
pub fn on_focused(app: &AppHandle, label: &str) {
    let Some(state) = app.try_state::<SidecarState>() else {
        return;
    };
    let tick = state.tick.fetch_add(1, Ordering::SeqCst);
    let (root, resting) = {
        let mut book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
        if !book.focus(label, tick) {
            return;
        }
        (book.root_of(label), book.is_resting(label))
    };
    if let Some(root) = &root {
        crate::sidecar::mark_shown(app, root, tick);
    }
    schedule_session_save(app);
    if let (Some(root), true) = (root, resting) {
        wake_when_settled(app, label.to_string(), root);
    }
}

/// How long a resting tab must stay focused before it wakes. Restoring a
/// session builds every tab, and each build passes focus through it on the way
/// to the saved front tab; a person cycling tabs with ⌃Tab does the same. Only
/// a tab that is still the focused one after this wakes — a tab merely passed
/// through stays resting (and costs no server).
const WAKE_SETTLE: Duration = Duration::from_millis(250);

/// Wake `label` (spawn its server, navigate when up — DDR-109 guard unchanged)
/// if it is still the focused, resting window after `WAKE_SETTLE`.
fn wake_when_settled(app: &AppHandle, label: String, root: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(WAKE_SETTLE).await;
        let state = app.state::<SidecarState>();
        if state.shutting_down.load(Ordering::SeqCst) {
            return;
        }
        let wake = {
            let mut book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
            let still = book.front_label().as_deref() == Some(label.as_str())
                && book.is_resting(&label)
                && book.root_of(&label).as_deref() == Some(root.as_str());
            // Cleared under the same lock as the check, so two focus events
            // cannot both wake the tab.
            still && book.set_resting(&label, false)
        };
        if !wake {
            return;
        }
        crate::sidecar::log_line(&format!("[maude] {label} was resting — waking {root}"));
        crate::sidecar::attach_or_spawn(&app, &root);
        crate::sidecar::spawn_enforce_cap(&app);
        navigate_when_up(&app, label, root, None);
    });
}

/// The app-local splash document (`index.html`) — where a resting tab goes.
fn splash_url() -> tauri::Url {
    #[cfg(windows)]
    const SPLASH: &str = "http://tauri.localhost/index.html";
    #[cfg(not(windows))]
    const SPLASH: &str = "tauri://localhost/index.html";
    SPLASH.parse().expect("the splash url parses")
}

/// Rest `label` (§5.2 "Rest (cap)"): mark it resting FIRST (so no in-flight
/// navigate or respawn re-navigate can put it back on a server), stop its
/// server, and send the tab to the splash in its resting state. The title is
/// kept — the tab still says which project it is.
pub fn rest_window(app: &AppHandle, label: &str, root: &str) {
    let state = app.state::<SidecarState>();
    let marked = state
        .windows
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .set_resting(label, true);
    crate::sidecar::shutdown_instance(app, root);
    if !marked {
        return;
    }
    if let Some(w) = app.get_webview_window(label) {
        let title = project_display_name(root);
        if let Err(e) = w.navigate(splash_url()) {
            crate::sidecar::log_line(&format!("[maude] could not rest {label}: {e}"));
        }
        let _ = w.set_title(&crate::notify::sanitize_notify_field(&title));
    }
}

/// For `resolve_dev_server_url`: the project name a RESTING calling window
/// shows on its splash, or `None` when the window is awake.
pub fn resting_name(app: &AppHandle, label: &str) -> Option<String> {
    let state = app.try_state::<SidecarState>()?;
    let book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
    if !book.is_resting(label) {
        return None;
    }
    book.root_of(label).map(|r| project_display_name(&r))
}

/// What a window close should do before the window goes away.
#[derive(Debug, PartialEq)]
pub enum CloseGuard {
    Proceed,
    /// Keep the window open for now: the status probe (and maybe the "Stop AI
    /// in …?" confirm) decides, then closes it itself.
    Hold,
}

/// Does this status call for the close confirm? Only when the project's own
/// server SAYS AI is running or waiting (§5.2 "Window close"). No answer is no
/// confirm: the shell cannot claim AI is running when it does not know.
pub fn needs_close_confirm(status: Option<&crate::sidecar::ShellStatus>) -> bool {
    status.is_some_and(|s| s.ai_active())
}

/// `CloseRequested` (⌘W, the tab's ×). Home, a resting tab and a project with
/// no running server close at once. A running project's close is held while
/// its `/_api/shell/status` is read (authenticated, decision 8); when AI is
/// running or waiting the person is asked "Stop AI in <name>?" — **Stop and
/// close** destroys the window and stops the server now (no 10 s grace: the
/// person just said stop), **Cancel** keeps the window open.
pub fn close_guard(app: &AppHandle, label: &str) -> CloseGuard {
    let Some(state) = app.try_state::<SidecarState>() else {
        return CloseGuard::Proceed;
    };
    let root = {
        let mut book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
        let Some(root) = book.root_of(label) else {
            return CloseGuard::Proceed;
        };
        if book.is_resting(label) {
            return CloseGuard::Proceed;
        }
        if !book.begin_close(label) {
            // A confirm for this window is already up.
            return CloseGuard::Hold;
        }
        root
    };
    if crate::sidecar::shell_origin(app, &root).is_none() {
        // Not running (or never came up): nothing to stop.
        state
            .windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .end_close(label);
        return CloseGuard::Proceed;
    }
    let app = app.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        let status = crate::sidecar::shell_status(&app, &root).await;
        let Some(window) = app.get_webview_window(&label) else {
            return;
        };
        if !needs_close_confirm(status.as_ref()) {
            let _ = window.destroy();
            return;
        }
        let name = project_display_name(&root);
        let app2 = app.clone();
        let label2 = label.clone();
        app.dialog()
            .message(format!(
                "AI is still working in {name}. Closing the tab stops it."
            ))
            .title(format!("Stop AI in {name}?"))
            .parent(&window)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Stop and close".to_string(),
                "Cancel".to_string(),
            ))
            .show(move |stop| {
                let state = app2.state::<SidecarState>();
                state
                    .windows
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .end_close(&label2);
                if !stop {
                    return;
                }
                if let Some(w) = app2.get_webview_window(&label2) {
                    let _ = w.destroy();
                }
                crate::sidecar::log_line(&format!(
                    "[maude] {label2} closed with AI running — stopping {root} now"
                ));
                crate::sidecar::shutdown_instance(&app2, &root);
            });
    });
    CloseGuard::Hold
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
    schedule_session_save(app);
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

// ── Session save + relaunch restore (§5.2 "Relaunch", §5.5 `session`) ───────

/// Saves coalesce: a burst of opens/focuses (a restore builds every tab) writes
/// the app state once, with the final tab set.
const SESSION_SAVE_DEBOUNCE: Duration = Duration::from_millis(400);

static SESSION_SAVE_PENDING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Save the tab session soon (debounced), through app-state v2.
pub fn schedule_session_save(app: &AppHandle) {
    if SESSION_SAVE_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SESSION_SAVE_DEBOUNCE).await;
        SESSION_SAVE_PENDING.store(false, Ordering::SeqCst);
        // Quitting destroys every window; `kill_server` already saved the
        // session as it was before the teardown began.
        if app
            .try_state::<SidecarState>()
            .is_some_and(|s| s.shutting_down.load(Ordering::SeqCst))
        {
            return;
        }
        save_session_now(&app);
    });
}

/// Save the tab session now (the quit path calls this before teardown).
pub fn save_session_now(app: &AppHandle) {
    let Some(state) = app.try_state::<SidecarState>() else {
        return;
    };
    let (tabs, focused) = state
        .windows
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .session_tabs();
    crate::app_state::save_session(app, tabs, focused);
}

/// One tab a relaunch reopens.
#[derive(Clone, Debug, PartialEq)]
pub struct RestoreTab {
    pub pid: String,
    pub root: String,
}

/// What a relaunch reopens: project tabs in saved order and which one runs.
#[derive(Clone, Debug, PartialEq)]
pub struct RestorePlan {
    pub tabs: Vec<RestoreTab>,
    /// Index into `tabs` of the tab that spawns; every other tab starts resting.
    pub front: usize,
}

/// Pure half of the relaunch: the saved session resolved against the registry.
/// A tab whose pid is unknown or whose root is gone is skipped (Home's "isn't
/// where it was" card handles those, not a dead tab), as is a repeated pid
/// (open once). The front tab is `session.focused` when it survived, else the
/// first tab. `None` when nothing is left to restore.
///
/// SEAM (Home restore): a `home` entry is skipped here for now; the Home window
/// (V2-3.3) hooks in to reopen it in its saved place.
pub fn plan_restore(
    session: &crate::app_state::Session,
    projects: &std::collections::BTreeMap<String, crate::app_state::ProjectEntry>,
    exists: impl Fn(&str) -> bool,
) -> Option<RestorePlan> {
    let mut tabs: Vec<RestoreTab> = Vec::new();
    let mut front = None;
    for t in &session.tabs {
        let Some(pid) = t.pid.as_deref() else {
            continue; // SEAM (Home restore): `home` and other non-project tabs
        };
        let Some(entry) = projects.get(pid) else {
            continue;
        };
        if !exists(&entry.root) || tabs.iter().any(|r| r.pid == pid) {
            continue;
        }
        if session.focused.as_deref() == Some(t.label.as_str()) {
            front = Some(tabs.len());
        }
        tabs.push(RestoreTab {
            pid: pid.to_string(),
            root: entry.root.clone(),
        });
    }
    if tabs.is_empty() {
        return None;
    }
    Some(RestorePlan {
        front: front.unwrap_or(0),
        tabs,
    })
}

/// Does this launch restore the saved session? Not when `MAUDE_PROJECT_ROOT`
/// names the project to open (e2e, tests, a power-user launch): that launch
/// was told what to show. A debug build can force it (`MAUDE_E2E_RESTORE=1`).
fn restore_enabled() -> bool {
    #[cfg(debug_assertions)]
    if std::env::var("MAUDE_E2E_RESTORE").as_deref() == Ok("1") {
        return true;
    }
    std::env::var("MAUDE_PROJECT_ROOT").map_or(true, |v| v.is_empty())
}

/// The boot window(s). With a saved session: every saved project tab, in
/// order, as one tab group; only the front tab spawns, the others start
/// resting, and the front window hears `shell://tabs-restored {count}`. Without
/// one: `fallback_root` alone, as before.
pub fn boot_windows(app: &AppHandle, fallback_root: &str) {
    let plan = if restore_enabled() {
        let st = crate::app_state::load(app);
        st.session
            .as_ref()
            .and_then(|s| plan_restore(s, &st.projects, |r| Path::new(r).join(".design").is_dir()))
    } else {
        None
    };
    let Some(plan) = plan.filter(|p| p.tabs.len() > 1) else {
        // Zero or one tab: today's boot. (A one-tab session's root is what
        // `resolve_project_root` already resolved to.)
        if let Err(e) = open_window_for_root(app, fallback_root, None) {
            crate::sidecar::log_line(&format!("[maude] FATAL: could not open the project window: {e}"));
        }
        return;
    };
    restore_session(app, &plan);
}

fn restore_session(app: &AppHandle, plan: &RestorePlan) {
    let state = app.state::<SidecarState>();
    let mut prev: Option<String> = None;
    let mut front_label = None;
    for (i, tab) in plan.tabs.iter().enumerate() {
        let tick = state.tick.fetch_add(1, Ordering::SeqCst);
        let name = project_display_name(&tab.root);
        // Each tab is attached after the previous one, so the group keeps the
        // saved order (attaching all to the first would reverse it).
        let opened = open_in(
            &TauriHost { app },
            &state.windows,
            &tab.root,
            &name,
            prev.as_deref(),
            tick,
        );
        let label = match opened {
            Ok(o) => o.label().to_string(),
            Err(e) => {
                crate::sidecar::log_line(&format!("[maude] could not restore {}: {e}", tab.root));
                continue;
            }
        };
        if i == plan.front {
            front_label = Some(label.clone());
        } else {
            state
                .windows
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .set_resting(&label, true);
        }
        prev = Some(label);
    }
    let Some(front) = front_label else { return };
    let front_root = plan.tabs[plan.front].root.clone();
    // Focus the front tab LAST, on the main thread: each `attach_as_tab` above
    // queued a closure that focuses its child, and those run first (FIFO), so a
    // plain `set_focus` here would be undone by the last attach. The resting
    // tabs that focus passes through on the way stay resting (`WAKE_SETTLE`).
    if let Some(w) = app.get_webview_window(&front) {
        if app.run_on_main_thread(move || {
            let _ = w.set_focus();
        })
        .is_err()
        {
            crate::sidecar::log_line("[maude] could not focus the restored front tab");
        }
    }
    crate::sidecar::attach_or_spawn(app, &front_root);
    crate::sidecar::spawn_enforce_cap(app);
    navigate_when_up(app, front.clone(), front_root, None);
    let count = plan.tabs.len();
    crate::sidecar::log_line(&format!("[maude] {count} tabs reopened — only {front} runs"));
    let _ = app.emit_to(
        EventTarget::AnyLabel { label: front },
        "shell://tabs-restored",
        serde_json::json!({ "count": count }),
    );
    schedule_session_save(app);
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
fn is_app_local(url: &tauri::Url) -> bool {
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
/// invoked on — label AND current URL origin, never an argument (§5.4). The
/// recorded origin is the one `navigate_when_up` read from the app-owned
/// `MAUDE_SHELL_INFO_FILE` (decision 8), never the in-project `_server.json`.
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

/// `open_project({root})` — open a project as a new tab after the calling
/// window, or focus its tab if it is already open (§5.4; Home's `{pid}` form
/// comes in V2-3.3). The caller must be a project window on its own server.
/// `async`: building a window from a sync command runs on the main thread and
/// deadlocks on Windows (Tauri docs).
#[tauri::command]
pub async fn open_project(
    app: AppHandle,
    webview: tauri::Webview,
    root: String,
) -> Result<OpenedProject, String> {
    let caller = caller_project(&webview, false)?;
    let path = PathBuf::from(&root);
    if !path.is_dir() {
        return Err("That project folder doesn’t exist.".to_string());
    }
    let opened = open_project_window(&app, &path, Some(&caller.label))?;
    Ok(OpenedProject {
        label: opened.label().to_string(),
        opened: match opened {
            Opened::Existing(_) => "existing",
            Opened::New(_) => "new",
        },
    })
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

    // ── V2-3.2 part b: resting, close confirm, session ─────────────────────

    #[test]
    fn rest_policy_a_resting_tab_is_never_navigated_until_it_wakes() {
        // §5.2 "Respawn after a crash": a re-navigate must not wake a resting
        // tab; only the wake (which clears `resting` first) may navigate it.
        let mut b = WindowBook::default();
        b.insert(&label_of(A), Role::Project { pid: pid_for_root(A), root: A.into() }, 1);
        assert!(b.may_navigate(&label_of(A), A));
        assert!(b.set_resting(&label_of(A), true));
        b.set_origin(&label_of(A), "http://localhost:4399");
        assert!(!b.may_navigate(&label_of(A), A));
        assert!(b.set_resting(&label_of(A), false));
        assert!(b.may_navigate(&label_of(A), A));
        // Resting drops the origin: the tab is on the splash, not its server.
        b.set_origin(&label_of(A), "http://localhost:4399");
        b.set_resting(&label_of(A), true);
        assert_eq!(b.entries[&label_of(A)].origin, None);
        // Only project windows rest.
        b.insert("home", Role::Home, 2);
        assert!(!b.set_resting("home", true));
    }

    #[test]
    fn close_confirm_only_when_the_server_says_ai_is_running_or_waiting() {
        use crate::sidecar::{AiCounts, ShellStatus};
        assert!(!needs_close_confirm(None));
        assert!(!needs_close_confirm(Some(&ShellStatus {
            unsent: 3,
            jobs: 1,
            ..ShellStatus::default()
        })));
        assert!(needs_close_confirm(Some(&ShellStatus {
            ai: AiCounts { running: 0, awaiting: 1 },
            ..ShellStatus::default()
        })));
        let mut b = WindowBook::default();
        b.insert(&label_of(A), Role::Project { pid: pid_for_root(A), root: A.into() }, 1);
        assert!(b.begin_close(&label_of(A)));
        assert!(!b.begin_close(&label_of(A)), "a second ⌘W does not stack a dialog");
        b.end_close(&label_of(A));
        assert!(b.begin_close(&label_of(A)));
    }

    const C: &str = "/nonexistent/maude-v2-3-2/gamma";

    #[test]
    fn session_saves_tabs_in_the_order_the_person_sees_them() {
        // A opens; B opens from A; C opens from A too — C lands right after A,
        // before B (addTabbedWindow:ordered:NSWindowAbove), so the saved order
        // is A, C, B, not the open order A, B, C.
        let host = MockHost::default();
        let book = Mutex::new(WindowBook::default());
        open_in(&host, &book, A, "Alpha", None, 1).unwrap();
        open_in(&host, &book, B, "Beta", Some(&label_of(A)), 2).unwrap();
        open_in(&host, &book, C, "Gamma", Some(&label_of(A)), 3).unwrap();
        book.lock().unwrap().insert_after("home", Role::Home, 4, None);
        book.lock().unwrap().focus(&label_of(B), 5);

        let (tabs, focused) = book.lock().unwrap().session_tabs();
        let labels: Vec<&str> = tabs.iter().map(|t| t.label.as_str()).collect();
        assert_eq!(labels, [label_of(A), label_of(C), label_of(B), "home".into()]);
        assert_eq!(tabs[1].pid.as_deref(), Some(pid_for_root(C).as_str()));
        assert_eq!(tabs[3].pid, None, "Home carries no pid");
        assert_eq!(focused, Some(label_of(B)));

        // A closed tab leaves the session.
        forget_window(&mut book.lock().unwrap(), &label_of(C));
        let (tabs, _) = book.lock().unwrap().session_tabs();
        assert_eq!(tabs.len(), 3);
    }

    #[test]
    fn session_restore_keeps_saved_order_and_only_the_focused_tab_runs() {
        use crate::app_state::{ProjectEntry, Session, SessionTab};
        let entry = |root: &str| ProjectEntry {
            root: root.to_string(),
            ..ProjectEntry::default()
        };
        let mut projects = std::collections::BTreeMap::new();
        for r in [A, B, C] {
            projects.insert(pid_for_root(r), entry(r));
        }
        let tab = |r: &str| SessionTab {
            label: label_of(r),
            pid: Some(pid_for_root(r)),
        };
        let session = Session {
            tabs: vec![
                tab(C),
                SessionTab { label: "home".into(), pid: None },
                tab(A),
                // A pid the registry forgot, and a repeat: both skipped.
                SessionTab { label: "p-lffffffffffffffff".into(), pid: Some("lffffffffffffffff".into()) },
                tab(A),
                tab(B),
            ],
            focused: Some(label_of(A)),
            saved_at: 1,
        };
        let plan = plan_restore(&session, &projects, |_| true).unwrap();
        let roots: Vec<&str> = plan.tabs.iter().map(|t| t.root.as_str()).collect();
        assert_eq!(roots, [C, A, B]);
        assert_eq!(plan.front, 1, "only session.focused spawns");

        // A vanished root is skipped; a focused tab that vanished falls back to
        // the first surviving tab.
        let plan = plan_restore(&session, &projects, |r| r != A).unwrap();
        let roots: Vec<&str> = plan.tabs.iter().map(|t| t.root.as_str()).collect();
        assert_eq!(roots, [C, B]);
        assert_eq!(plan.front, 0);

        // Nothing left → no restore (the boot opens its fallback project).
        assert_eq!(plan_restore(&session, &projects, |_| false), None);
    }
}
