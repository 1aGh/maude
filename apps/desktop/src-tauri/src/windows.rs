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
use tauri::{AppHandle, Manager, Runtime};
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
    /// The canvas origin the same app-owned info file named (N-M2): the one
    /// other loopback origin this window's navigations may reach — the
    /// cross-origin canvas iframe. Set and cleared with `origin`.
    pub canvas_origin: Option<String>,
    /// The tab is RESTING (§5.2 "Rest (cap)"): its server was stopped to keep
    /// the running count at the cap; it shows the splash until focus wakes it.
    /// Live only, never on disk (decision 5).
    pub resting: bool,
    /// A close is waiting on the status probe or the "Stop AI in …?" confirm;
    /// a second ⌘W meanwhile must not stack a second dialog.
    pub closing: bool,
    /// The strip's AI dot (V2-3.7 §6): set on a background tab, cleared when
    /// it becomes the active tab. Live only.
    pub dot: Option<crate::tabs::Dot>,
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
    /// Tab order as the person sees it in the strip (V2-3.7): a new tab goes
    /// right after the tab that opened it, or at the end when Home opened it.
    /// Project/cell tabs only — Home is pinned and NEVER in it. What the
    /// session saves (§5.5).
    tabs: Vec<String>,
    /// The ACTIVE tab (V2-3.7: the one shown in the shell), `home` included.
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
        if role != Role::Home {
            let at = after
                .and_then(|a| self.tabs.iter().position(|l| l == a))
                .map(|i| i + 1)
                .unwrap_or(self.tabs.len());
            self.tabs.insert(at, label.to_string());
        }
        self.entries.insert(
            label.to_string(),
            WindowEntry {
                role,
                last_focused: tick,
                origin: None,
                canvas_origin: None,
                resting: false,
                closing: false,
                dot: None,
            },
        );
    }

    /// One tab's entry.
    pub fn entry(&self, label: &str) -> Option<&WindowEntry> {
        self.entries.get(label)
    }

    /// The project/cell tabs in strip order (Home is never one).
    pub fn tab_labels(&self) -> &[String] {
        &self.tabs
    }

    /// The tab that becomes active when `label` (the active one) closes: its
    /// right neighbour, else its left one; `None` ⇒ Home (the last tab closed,
    /// or `label` is not a tab).
    pub fn after_close(&self, label: &str) -> Option<String> {
        let i = self.tabs.iter().position(|l| l == label)?;
        self.tabs
            .get(i + 1)
            .or_else(|| i.checked_sub(1).and_then(|j| self.tabs.get(j)))
            .cloned()
    }

    /// Move tab `label` to index `to` of the strip (clamped). Home never
    /// moves: it is not in the list.
    pub fn move_tab(&mut self, label: &str, to: usize) -> bool {
        let Some(i) = self.tabs.iter().position(|l| l == label) else {
            return false;
        };
        let l = self.tabs.remove(i);
        let to = to.min(self.tabs.len());
        self.tabs.insert(to, l);
        true
    }

    /// Set a BACKGROUND tab's AI dot (V2-3.7 §6; `None` clears it). The active
    /// tab never carries one: false.
    pub fn set_dot(&mut self, label: &str, dot: Option<crate::tabs::Dot>) -> bool {
        if self.focused.as_deref() == Some(label) && dot.is_some() {
            return false;
        }
        match self.entries.get_mut(label) {
            Some(e) => {
                e.dot = dot;
                true
            }
            None => false,
        }
    }

    /// Record the origin the shell just navigated `label` to.
    pub fn set_origin(&mut self, label: &str, origin: &str) {
        if let Some(e) = self.entries.get_mut(label) {
            e.origin = Some(origin.to_string());
        }
    }

    /// Record the canvas origin of the server `label` was just sent to.
    pub fn set_canvas_origin(&mut self, label: &str, canvas: Option<&str>) {
        if let Some(e) = self.entries.get_mut(label) {
            e.canvas_origin = canvas.map(str::to_string);
        }
    }

    /// The window no longer vouches for any server origin (its server died,
    /// or it is resting): nothing but the splash is "its" page until the shell
    /// records a fresh origin from a live child's info file (N-M3).
    pub fn clear_origin(&mut self, label: &str) {
        if let Some(e) = self.entries.get_mut(label) {
            e.origin = None;
            e.canvas_origin = None;
        }
    }

    /// `clear_origin` for the window showing `root`; returns its label.
    pub fn forget_origin_of_root(&mut self, root: &str) -> Option<String> {
        let label = self.label_for_root(root)?;
        self.clear_origin(&label);
        Some(label)
    }

    /// What `label`'s navigations are judged against (N-M2): its role and the
    /// origins the shell recorded for it.
    pub fn nav_view(&self, label: &str) -> Option<(NavRole, Option<String>, Option<String>)> {
        let e = self.entries.get(label)?;
        let role = match e.role {
            Role::Home => NavRole::Home,
            Role::Project { .. } => NavRole::Project,
            Role::Cell { .. } => NavRole::Cell,
        };
        Some((role, e.origin.clone(), e.canvas_origin.clone()))
    }

    pub fn remove(&mut self, label: &str) -> Option<WindowEntry> {
        self.order.retain(|l| l != label);
        self.tabs.retain(|l| l != label);
        if self.focused.as_deref() == Some(label) {
            self.focused = None;
        }
        self.entries.remove(label)
    }

    #[cfg(test)]
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
                e.canvas_origin = None;
                true
            }
            None => false,
        }
    }

    /// Activation (V2-3.7 `tabs::activate`): stamp `focused` + `last_focused`
    /// and clear the tab's dot. Unknown labels (a webview the shell did not
    /// create as a tab, the strip) are ignored.
    pub fn focus(&mut self, label: &str, tick: u64) -> bool {
        match self.entries.get_mut(label) {
            Some(e) => {
                e.last_focused = tick;
                e.dot = None;
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
    /// project of the front window. Test-only since V2-3.5 (the notify poller
    /// now targets "not focused", `notify::poll_targets`).
    #[cfg(test)]
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
                    // A resting tab runs no AI: its dot goes (V2-3.7 §6).
                    e.dot = None;
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
    /// Build the tab without activating it (a relaunch builds every saved tab
    /// in the background, then activates the saved one — V2-3.9 T4).
    pub background: bool,
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
    open_in_as(host, book, root, name, caller, tick, false)
}

/// `open_in`; `background` builds a new tab without activating it, and leaves
/// an existing one where it is (the relaunch path, V2-3.9 T4).
pub fn open_in_as(
    host: &impl WindowHost,
    book: &Mutex<WindowBook>,
    root: &str,
    name: &str,
    caller: Option<&str>,
    tick: u64,
    background: bool,
) -> Result<Opened, String> {
    let pid = pid_for_root(root);
    let label = {
        let mut b = book.lock().unwrap_or_else(|e| e.into_inner());
        match b.label_for_pid(&pid) {
            Some(existing) if host.exists(&existing) => {
                drop(b);
                if !background {
                    host.reveal(&existing, name);
                }
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
        title: crate::notify::sanitize_title(name),
        caller: caller.map(str::to_string),
        background,
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
/// (`notify::sanitize_title`, contract §5.2 "Title" — one line, no bidi
/// controls) — AppKit draws it.
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
    crate::notify::sanitize_title(&name)
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

/// Can a webview get its own WebKit data store here? macOS ≥ 14 only.
pub(crate) fn supports_data_store() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_supports_data_store()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
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

// ── Navigation guard (V2-3.6 N-M2, contract §5.8 item 7) ─────────────────────

/// The kind of window a navigation is judged for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum NavRole {
    Home,
    Project,
    /// `c-*` cell tabs (not built yet): https inside the configured cloud zone.
    Cell,
    /// S3.6a `audience-<pid>`: never admitted by these generic rules — its
    /// navigations are judged by `present::audience_nav_check` (its entry).
    Audience,
}

/// A loopback (or unspecified) host on any scheme — what an agent or another
/// local listener can bind.
fn loopbackish(url: &tauri::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    match host.parse::<std::net::IpAddr>() {
        Ok(ip) => ip.is_loopback() || ip.is_unspecified(),
        Err(_) => host == "localhost" || host.ends_with(".localhost"),
    }
}

/// THE rule for every navigation of a shell-built window (`on_navigation`).
/// WKWebView asks it for subframes too (the canvas iframe, an embed inside a
/// canvas) and does not say which frame, so this is the union a page may
/// legitimately load anywhere; `top_level_allowed` narrows the main frame.
/// - the app-local splash, `about:blank` / `about:srcdoc`;
/// - the origin the shell recorded for this window (`origin`), and a `blob:`
///   minted by it;
/// - a project tab also: its own server's canvas origin (`canvas`), `data:`
///   and remote https (subframe content — a remote origin gets no IPC, the
///   capability lists loopback only); NEVER another loopback origin;
/// - Home: nothing else; a cell tab: https inside the cloud zone.
pub fn navigation_allowed(
    role: NavRole,
    url: &tauri::Url,
    origin: Option<&str>,
    canvas: Option<&str>,
) -> bool {
    if role == NavRole::Audience {
        // Judged only by `present::audience_nav_check`, against its entry.
        return false;
    }
    if is_app_local(url) {
        return true;
    }
    let target = match url.scheme() {
        "about" => return matches!(url.path(), "blank" | "srcdoc"),
        "data" => return role == NavRole::Project,
        "blob" => match tauri::Url::parse(url.path()) {
            Ok(inner) => inner,
            Err(_) => return false,
        },
        "http" | "https" => url.clone(),
        _ => return false,
    };
    if !matches!(target.scheme(), "http" | "https") {
        return false;
    }
    let o = target.origin().ascii_serialization();
    if origin == Some(o.as_str()) {
        return true;
    }
    // A `blob:` is admitted only when the window's own origin minted it. The
    // canvas origin's blob is never a page the shell loads, and the native
    // check is the only one it meets: a link dropped on the canvas iframe
    // would otherwise land in the main frame before the post-commit bounce.
    if url.scheme() == "blob" {
        return false;
    }
    match role {
        NavRole::Home => false,
        NavRole::Project if loopbackish(&target) => canvas == Some(o.as_str()),
        NavRole::Project => target.scheme() == "https",
        NavRole::Cell => {
            target.scheme() == "https" && !loopbackish(&target) && crate::oauth::in_cloud_zone(&o)
        }
        NavRole::Audience => false,
    }
}

/// The main frame (`on_page_load` Started — WKWebView reports it for the main
/// frame only): the splash, `about:blank`, or the window's own recorded
/// origin. A page that took the top frame anywhere else is sent back to the
/// splash.
pub fn top_level_allowed(role: NavRole, url: &tauri::Url, origin: Option<&str>) -> bool {
    if role == NavRole::Audience {
        // Judged only by `present::audience_nav_check`, against its entry.
        return false;
    }
    if is_app_local(url) || (url.scheme() == "about" && url.path() == "blank") {
        return true;
    }
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let o = url.origin().ascii_serialization();
    origin == Some(o.as_str())
        || (role == NavRole::Cell
            && url.scheme() == "https"
            && !loopbackish(url)
            && crate::oauth::in_cloud_zone(&o))
}

/// `navigation_allowed` / `top_level_allowed` against the live book. A label
/// the book does not know (yet) may show only the splash. An audience window
/// (S3.6a) is judged against the origins it was opened for, and only while
/// its project tab still vouches for them; otherwise it may load nothing.
pub(crate) fn nav_check<R: Runtime>(app: &AppHandle<R>, label: &str, url: &tauri::Url, top: bool) -> bool {
    if crate::present::is_audience_label(label) {
        return crate::present::audience_nav_check(app, label, url, top);
    }
    let view = app
        .try_state::<SidecarState>()
        .and_then(|s| s.windows.lock().unwrap_or_else(|e| e.into_inner()).nav_view(label));
    let Some((role, origin, canvas)) = view else {
        return is_app_local(url);
    };
    if top {
        top_level_allowed(role, url, origin.as_deref())
    } else {
        navigation_allowed(role, url, origin.as_deref(), canvas.as_deref())
    }
}

/// Send `label` to the app-local splash (a refused top-level page, a server
/// that gave up).
pub fn show_splash<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(w) = app.get_webview(label) {
        if let Err(e) = w.navigate(splash_url()) {
            crate::sidecar::log_line(&format!("[maude] could not show the splash in {label}: {e}"));
        }
    }
}

/// A project's server died (N-M3): its window stops vouching for the dead
/// server's origin at once — a listener that binds the freed port is never
/// "the project" — and, when the supervisor gave up, shows the splash. The
/// respawn's own info file records the next origin (`navigate_to_server`).
pub fn on_server_died(app: &AppHandle, root: &str, gave_up: bool) {
    let label = app.try_state::<SidecarState>().and_then(|s| {
        s.windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .forget_origin_of_root(root)
    });
    if let (Some(label), true) = (label, gave_up) {
        show_splash(app, &label);
    }
}

/// Record the server origin a window is being sent to, from the app-owned
/// info file of `root`'s running child — with that file's canvas origin —
/// but only while the window still shows `root` and is awake. The one place
/// an origin becomes trusted (navigate, and the splash's own recovery).
pub fn stamp_server_origin(app: &AppHandle, label: &str, root: &str, origin: &str) -> bool {
    let canvas = crate::sidecar::shell_info_file(app, root)
        .and_then(|f| crate::sidecar::read_shell_canvas_origin(&f));
    let state = app.state::<SidecarState>();
    let mut book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
    if !book.may_navigate(label, root) {
        return false;
    }
    book.set_origin(label, origin);
    book.set_canvas_origin(label, canvas.as_deref());
    true
}

/// The Tauri side of `WindowHost`.
pub struct TauriHost<'a> {
    pub app: &'a AppHandle,
}

impl WindowHost for TauriHost<'_> {
    fn exists(&self, label: &str) -> bool {
        self.app.get_webview(label).is_some()
    }

    fn reveal(&self, label: &str, name: &str) {
        if self.app.get_webview(label).is_none() {
            return;
        }
        if let Err(e) = crate::tabs::reveal(self.app, label) {
            crate::sidecar::log_line(&format!("[maude] could not show {label}: {e}"));
        }
        crate::bus::send(
            label,
            "shell://opened-existing",
            serde_json::json!({ "name": name }),
        );
    }

    /// A tab is a child webview of the `shell` window (V2-3.7): the splash
    /// (`index.html`) first; the server URL comes later through the DDR-109
    /// loopback guard in `navigate_to_server`. Then it becomes the active tab.
    fn create(&self, spec: &WindowSpec) -> Result<(), String> {
        // N-M2: every navigation of every shell-built tab passes the guard;
        // a main frame that still lands elsewhere goes back to the splash; a
        // page never opens a window of its own.
        let (nav_app, nav_label) = (self.app.clone(), spec.label.clone());
        let (load_app, load_label) = (self.app.clone(), spec.label.clone());
        let label = spec.label.clone();
        crate::tabs::add_tab(self.app, &spec.label, move |builder| {
            #[allow(unused_mut)]
            let mut builder = builder
                .on_navigation(move |url| {
                    let ok = nav_check(&nav_app, &nav_label, url, false);
                    if !ok {
                        crate::sidecar::log_line(&format!(
                            "[maude] {nav_label}: refused a navigation to {}",
                            url.origin().ascii_serialization()
                        ));
                    }
                    ok
                })
                .on_page_load(move |_w, payload| {
                    if payload.event() == tauri::webview::PageLoadEvent::Started
                        && !nav_check(&load_app, &load_label, payload.url(), true)
                    {
                        crate::sidecar::log_line(&format!(
                            "[maude] {load_label}: the page left its origin — back to the splash"
                        ));
                        show_splash(&load_app, &load_label);
                    }
                })
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
            #[cfg(target_os = "macos")]
            if supports_data_store() {
                builder = builder.data_store_identifier(data_store_id_for_label(&label));
            }
            builder
        })?;
        if spec.background {
            // Hidden, not the active tab; the strip still lists it.
            crate::tabs::changed(self.app);
            return Ok(());
        }
        crate::tabs::reveal(self.app, &spec.label)
    }
}

/// Validate a server URL (DDR-109 §1, loopback only) and navigate `label` to
/// it — but only while that window still shows `root`: an in-tab switch or a
/// close since the wait began makes this navigate stale.
pub fn navigate_to_server(app: &AppHandle, label: &str, root: &str, url: &str, open: Option<&str>) {
    let Some(window) = app.get_webview(label) else {
        return;
    };
    match url.parse::<tauri::Url>() {
        Ok(mut parsed) if crate::server_json::is_loopback_url(&parsed) => {
            // Check-and-stamp under one lock: the window must still show
            // `root`, and the origin it is sent to becomes the one its
            // commands are answered for (`check_caller`) and its navigations
            // may reach (N-M2).
            if !stamp_server_origin(app, label, root, &parsed.origin().ascii_serialization()) {
                crate::sidecar::log_line(&format!(
                    "[maude] {label} no longer shows {root}, or is resting — not navigating"
                ));
                return;
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
        crate::sidecar::spawn_enforce_cap(app);
        navigate_when_up(app, label.clone(), root.to_string(), open.map(str::to_string));
        schedule_session_save(app);
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

/// A tab became the active one (V2-3.7 `tabs::activate`; was the window's
/// `Focused(true)`): the front tab, its project's `last_shown`, a session
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
        // The person is looking at it now: out of the Dock badge (V2-3.5).
        crate::notify::project_focused(app, root);
    }
    schedule_session_save(app);
    crate::home::state_changed(app);
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
    let marked = {
        let mut book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
        // Its server is about to stop: the port it held vouches for nothing (N-M3).
        book.clear_origin(label);
        book.set_resting(label, true)
    };
    crate::sidecar::shutdown_instance(app, root);
    if !marked {
        return;
    }
    if let Some(w) = app.get_webview(label) {
        if let Err(e) = w.navigate(splash_url()) {
            crate::sidecar::log_line(&format!("[maude] could not rest {label}: {e}"));
        }
    }
    // The strip shows the tab as resting; its name stays.
    crate::tabs::changed(app);
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

/// The user close of a tab (V2-3.7: the strip's ×, `tabs::close_tab_by_user`;
/// was the window's `CloseRequested`). Home, a resting tab and a project with
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
        let Some(webview) = app.get_webview(&label) else {
            return;
        };
        if !needs_close_confirm(status.as_ref()) {
            app.state::<SidecarState>()
                .windows
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .end_close(&label);
            let _ = crate::tabs::close_tab(&app, &label);
            return;
        }
        // The confirm is about THIS tab: show it first.
        let _ = crate::tabs::activate(&app, &label);
        let window = webview.window();
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
                    crate::tabs::changed(&app2);
                    return;
                }
                let _ = crate::tabs::close_tab(&app2, &label2);
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
    // What was parked for this window (intent, restore count, navigate) dies
    // with it (a later window with the same label must not inherit it), and
    // Home's tab list changed.
    drop_parked_for(label);
    // …and so does its shell channel (bus.rs): a reopened tab subscribes anew.
    crate::bus::forget(label);
    crate::profiles::forget_prepared(label);
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

/// What a relaunch reopens (contract V2-3.7 §4 `plan_tabs`): project tabs in
/// saved order, and which one is active — `None` = Home, the pinned tab.
#[derive(Clone, Debug, PartialEq)]
pub struct RestorePlan {
    pub tabs: Vec<RestoreTab>,
    /// Index into `tabs` of the active tab, the only one that spawns; every
    /// other tab starts resting. `None`: Home is active and nothing spawns.
    pub active: Option<usize>,
}

/// Pure half of the relaunch (V2-3.9 T4), on today's app-state schema: the
/// saved session resolved against the registry.
/// - Project tabs come back in saved order, each pid once, only when the
///   registry still knows the pid and its root still exists (Home's "isn't
///   where it was" card handles the rest, not a dead tab).
/// - A `home` entry (a pre-V2-3.7 session, where Home was a tab) and any other
///   entry without a pid is dropped: Home is the pinned tab, never a strip
///   tab — re-adding that entry was the stray Home tab.
/// - `session.focused == "home"` → Home active; a focused tab that is gone (or
///   none saved) → the first survivor, else Home.
pub fn plan_tabs(
    session: &crate::app_state::Session,
    projects: &std::collections::BTreeMap<String, crate::app_state::ProjectEntry>,
    exists: impl Fn(&str) -> bool,
) -> RestorePlan {
    let mut tabs: Vec<RestoreTab> = Vec::new();
    let mut focused_at = None;
    for t in &session.tabs {
        if t.label == HOME_LABEL {
            continue;
        }
        let Some(pid) = t.pid.as_deref() else {
            continue; // a cell tab: no relaunch path (yet)
        };
        let Some(entry) = projects.get(pid) else {
            continue;
        };
        if !exists(&entry.root) || tabs.iter().any(|r| r.pid == pid) {
            continue;
        }
        if session.focused.as_deref() == Some(t.label.as_str()) {
            focused_at = Some(tabs.len());
        }
        tabs.push(RestoreTab {
            pid: pid.to_string(),
            root: entry.root.clone(),
        });
    }
    let active = if session.focused.as_deref() == Some(HOME_LABEL) {
        None
    } else {
        focused_at.or_else(|| (!tabs.is_empty()).then_some(0))
    };
    RestorePlan { tabs, active }
}

/// What the boot builds after the shell and Home (pure half of `boot_windows`).
#[derive(Clone, Debug, PartialEq)]
pub enum BootTabs {
    /// A saved session — even one with no project tab left (Home alone): the
    /// relaunch restores exactly what was open. A one-tab session takes this
    /// path too (no `len() > 1` special case, contract §4).
    Restore(RestorePlan),
    /// No session to restore: this project alone (the boot plan's root).
    Open(String),
    /// Nothing: Home alone.
    HomeOnly,
}

pub fn boot_tabs(plan: Option<RestorePlan>, fallback_root: Option<&str>) -> BootTabs {
    match (plan, fallback_root) {
        (Some(plan), _) => BootTabs::Restore(plan),
        (None, Some(root)) => BootTabs::Open(root.to_string()),
        (None, None) => BootTabs::HomeOnly,
    }
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

/// The boot tabs, after the shell and the pinned Home (lib.rs). With a saved
/// session: `plan_tabs` — every saved project tab in order, built in the
/// background (never passing through activation), only the active one spawns,
/// and it (or Home) is activated last. Without one: `fallback_root` alone
/// (`None` = Home alone).
pub fn boot_windows(app: &AppHandle, fallback_root: Option<&str>) {
    let plan = if restore_enabled() {
        let st = crate::app_state::load(app);
        st.session
            .as_ref()
            .map(|s| plan_tabs(s, &st.projects, |r| Path::new(r).join(".design").is_dir()))
    } else {
        None
    };
    match boot_tabs(plan, fallback_root) {
        BootTabs::Restore(plan) => restore_session(app, &plan),
        BootTabs::Open(root) => {
            if let Err(e) = open_window_for_root(app, &root, None, None) {
                crate::sidecar::log_line(&format!("[maude] FATAL: could not open the project window: {e}"));
            }
        }
        BootTabs::HomeOnly => {}
    }
}

fn restore_session(app: &AppHandle, plan: &RestorePlan) {
    let state = app.state::<SidecarState>();
    let mut prev: Option<String> = None;
    let mut active_label = None;
    let mut count = 0;
    for (i, tab) in plan.tabs.iter().enumerate() {
        let tick = state.tick.fetch_add(1, Ordering::SeqCst);
        let name = project_display_name(&tab.root);
        // Each tab goes after the previous one, so the strip keeps the saved
        // order; built in the background, so no tab passes through activation.
        let opened = open_in_as(
            &TauriHost { app },
            &state.windows,
            &tab.root,
            &name,
            prev.as_deref(),
            tick,
            true,
        );
        let label = match opened {
            Ok(o) => o.label().to_string(),
            Err(e) => {
                crate::sidecar::log_line(&format!("[maude] could not restore {}: {e}", tab.root));
                continue;
            }
        };
        count += 1;
        if plan.active == Some(i) {
            active_label = Some((label.clone(), tab.root.clone()));
        } else {
            state
                .windows
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .set_resting(&label, true);
        }
        prev = Some(label);
    }
    let active = match active_label {
        Some((front, root)) => {
            if let Err(e) = crate::tabs::reveal(app, &front) {
                crate::sidecar::log_line(&format!("[maude] could not show the restored tab: {e}"));
            }
            crate::sidecar::attach_or_spawn(app, &root);
            crate::sidecar::spawn_enforce_cap(app);
            navigate_when_up(app, front.clone(), root, None);
            // The front tab is still on its splash: the event below reaches
            // no page. Parked too, for the page to take once it mounts.
            if count >= 2 {
                TABS_RESTORED.park(&front, TabsRestored { count });
            }
            front
        }
        // Home active (saved so, or the active tab did not come back).
        None => {
            if let Err(e) = crate::tabs::reveal(app, HOME_LABEL) {
                crate::sidecar::log_line(&format!("[maude] could not show Home: {e}"));
            }
            HOME_LABEL.to_string()
        }
    };
    crate::sidecar::log_line(&format!("[maude] {count} tab(s) reopened — {active} is active"));
    if count >= 2 {
        crate::bus::send(
            &active,
            "shell://tabs-restored",
            serde_json::json!({ "count": count }),
        );
    }
    crate::tabs::changed(app);
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
    let label = label.unwrap_or_else(|| HOME_LABEL.to_string());
    if let Err(e) = crate::tabs::reveal(app, &label) {
        crate::sidecar::log_line(&format!("[maude] could not show {label}: {e}"));
    }
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

/// Low 1g: a tab the person can't see may not open a native dialog or switch
/// the active tab — a background page would otherwise pop a folder picker /
/// save sheet over the tab in front, or yank the person to another tab. The
/// active tab is the book's `focused`; none focused means Home is in front.
pub fn front_only(book: &WindowBook, label: &str) -> Result<(), String> {
    let front = book.focused().unwrap_or(HOME_LABEL);
    if front == label {
        Ok(())
    } else {
        Err("Switch to this tab first.".to_string())
    }
}

/// `front_only` for the calling webview (its own label, never an argument).
pub fn caller_in_front<R: Runtime>(webview: &tauri::Webview<R>) -> Result<(), String> {
    let state = webview
        .app_handle()
        .try_state::<SidecarState>()
        .ok_or_else(|| "Maude is still starting.".to_string())?;
    let book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
    front_only(&book, webview.label())
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

// ── One-shot values parked per window label (V2-3 patches) ──────────────────
//
// An event emitted at a window before its page has mounted is lost (the
// restored front tab is still on its splash when `shell://tabs-restored`
// fires; a new tab's artboard has no place in `?open=`). The value is parked
// for that label instead, and the page takes it once on mount — the
// `home::take_intent` pattern. It dies with the window (`drop_parked_for`).

/// One value per window label; a window takes only its own, once.
pub struct Parked<T>(Mutex<Option<HashMap<String, T>>>);

impl<T> Parked<T> {
    pub const fn new() -> Self {
        Parked(Mutex::new(None))
    }

    pub fn park(&self, label: &str, value: T) {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get_or_insert_with(HashMap::new)
            .insert(label.to_string(), value);
    }

    pub fn take(&self, label: &str) -> Option<T> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()?
            .remove(label)
    }
}

/// What `take_tabs_restored` answers: how many tabs the session restore
/// reopened (the front tab's "N tabs reopened" note).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct TabsRestored {
    pub count: usize,
}

static TABS_RESTORED: Parked<TabsRestored> = Parked::new();
static PENDING_NAVIGATE: Parked<OpenTarget> = Parked::new();

/// Park `target` for a NEW window when it names an artboard — the canvas
/// alone already rides in the first navigate's `?open=`; the artboard has no
/// place there.
pub fn park_navigate_for_new(opened: &Opened, target: Option<&OpenTarget>) {
    if let (Opened::New(label), Some(t)) = (opened, target) {
        if t.artboard.is_some() {
            PENDING_NAVIGATE.park(label, t.clone());
        }
    }
}

/// The folder the last native picker shown to a window returned (V2-3.6 M3),
/// canonicalized. `open_local_project` / `app_set_last_project` accept a path
/// from a project page only when it is a registered project or this pick (or
/// a direct child of it — "create here" / "clone here" make `<pick>/<name>`).
pub static PICKED_FOLDER: Parked<PathBuf> = Parked::new();

/// Record a picker result for `label`.
pub fn remember_pick(label: &str, picked: &str) {
    if let Ok(p) = std::fs::canonicalize(picked) {
        PICKED_FOLDER.park(label, p);
    }
}

/// Both paths exist and name the same directory.
pub fn same_dir(a: &Path, b: &Path) -> bool {
    matches!((std::fs::canonicalize(a), std::fs::canonicalize(b)), (Ok(x), Ok(y)) if x == y)
}

/// Pure half of `local_project_allowed`: `path` is a registered project, or
/// the canonical `picked` folder itself, or a direct child of it.
pub fn local_path_allowed(registered: bool, picked: Option<&Path>, path: &Path) -> bool {
    if registered {
        return true;
    }
    let (Some(picked), Ok(path)) = (picked, std::fs::canonicalize(path)) else {
        return false;
    };
    path == picked || path.parent() == Some(picked)
}

/// May a project page in `label` open/remember `path`? (V2-3.6 M3: never an
/// arbitrary folder.) Reads the registry and PEEKS at the pick — the caller
/// consumes it with `PICKED_FOLDER.take` once the open has succeeded, so a
/// refused attempt (no `.design/` yet) can be retried after setup.
pub fn local_project_allowed(app: &AppHandle, label: &str, path: &Path) -> bool {
    // The `MAUDE_PROJECT_ROOT` launch override is deliberately kept out of the
    // registry (lib.rs boot), but it is the folder the person launched the app
    // at — read from this process's own launch env, which no page can change.
    let boot_root = std::env::var("MAUDE_PROJECT_ROOT")
        .ok()
        .filter(|r| !r.is_empty())
        .is_some_and(|r| same_dir(Path::new(&r), path));
    let registered = boot_root
        || crate::app_state::load(app)
            .projects
            .contains_key(&pid_for_root(&path.to_string_lossy()));
    let picked = PICKED_FOLDER.take(label);
    let ok = local_path_allowed(registered, picked.as_deref(), path);
    if let Some(p) = picked {
        PICKED_FOLDER.park(label, p);
    }
    ok
}

/// Everything parked for `label` dies with the window — a later window that
/// reuses the label must not inherit it — and with an in-tab switch, so the
/// project the label shows next cannot take what was parked for the last one
/// (N-M5: the deep link too, `?code=` and all).
pub fn drop_parked_for(label: &str) {
    crate::home::take_intent(label);
    TABS_RESTORED.take(label);
    PENDING_NAVIGATE.take(label);
    crate::deep_link::LINK_OPENED.take(label);
    crate::deep_link::PENDING_LINKS.take(label);
    PICKED_FOLDER.take(label);
}

/// `take_tabs_restored()` — the restore count parked for THIS window, once.
#[tauri::command]
pub fn take_tabs_restored(webview: tauri::Webview) -> Result<Option<TabsRestored>, String> {
    let caller = caller_project(&webview, false)?;
    Ok(TABS_RESTORED.take(&caller.label))
}

/// `take_pending_navigate()` — the `{canvas, artboard}` a NEW window was
/// opened for, parked for THIS window, once.
#[tauri::command]
pub fn take_pending_navigate(webview: tauri::Webview) -> Result<Option<OpenTarget>, String> {
    let caller = caller_project(&webview, false)?;
    Ok(PENDING_NAVIGATE.take(&caller.label))
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

/// The `intent` an `open_project` call parks (W1): Home only. A project window
/// can open a same-profile project, but never park a create-canvas prompt for
/// it — once the consumer starts an AI run from the intent, that would be a
/// cross-project prompt injection.
pub fn intent_for(
    caller: &Caller,
    intent: Option<crate::home::OpenIntent>,
) -> Result<Option<crate::home::OpenIntent>, String> {
    match (caller, intent) {
        (_, None) => Ok(None),
        (Caller::Project(_), Some(_)) => Err("Only Home can open a project with a request.".to_string()),
        (Caller::Home, Some(i)) => crate::home::validate_intent(i).map(Some),
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
    // 1g: a background project tab may not switch the active tab.
    if matches!(caller, Caller::Project(_)) {
        caller_in_front(&webview)?;
    }
    let st = crate::app_state::load(&app);
    let path = resolve_open_root(&caller, &st, pid.as_deref(), root.as_deref())?;
    let target = target.map(validate_target).transpose()?;
    let intent = intent_for(&caller, intent)?;
    if !path.is_dir() {
        return Err("That project folder doesn’t exist.".to_string());
    }
    let canvas = target.as_ref().and_then(|t| t.canvas.clone());
    let opened = open_project_window(&app, &path, Some(webview.label()), canvas.as_deref())?;
    let label = opened.label().to_string();
    park_navigate_for_new(&opened, target.as_ref());
    if let Some(intent) = intent {
        crate::home::park_intent(&label, intent);
    }
    if let (Opened::Existing(_), Some(t)) = (&opened, &target) {
        crate::bus::send(&label, "shell://navigate", t.clone());
    }
    // V2-3.7: Home is pinned and never closes; the opened tab is active.
    Ok(OpenedProject::from(&opened))
}

/// Debug-only e2e helper: `open_project` by folder from a PROJECT window (the
/// `{root}` form is Home-only in the real command). The same open path —
/// registry upsert, open once, tab after the caller. Granted only by
/// capabilities/debug/e2e-webdriver.json; a release build answers Err.
#[tauri::command]
pub async fn e2e_open_root(
    app: AppHandle,
    webview: tauri::Webview,
    root: String,
) -> Result<OpenedProject, String> {
    #[cfg(debug_assertions)]
    {
        caller_any(&webview, false)?;
        let opened = open_project_window(&app, Path::new(&root), Some(webview.label()), None)?;
        Ok(OpenedProject::from(&opened))
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (app, webview, root);
        Err("debug builds only".into())
    }
}

/// Debug-only e2e helper (V2-3.5 `project-tabs-identity`): bind a folder to
/// an account profile through `app_state::bind_profile` — the binding entry
/// point V2-3.1 left with no UI caller yet. The project's running server keeps
/// its old profile until it is restarted (env is never hot-swapped), so the
/// scenario closes and reopens the tab. Granted only by
/// capabilities/debug/e2e-webdriver.json; a release build answers Err.
#[tauri::command]
pub fn e2e_bind_profile(
    app: AppHandle,
    webview: tauri::Webview,
    root: String,
    profile: String,
) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        // V2-3.6 L3: even in debug, only a window on its own origin.
        caller_any(&webview, false)?;
        crate::app_state::bind_profile(&app, &root, &profile)
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (app, webview, root, profile);
        Err("debug builds only".into())
    }
}

// Debug-only e2e helpers (lifted from the V2-3.2 e2e spike). Bodies are
// `#[cfg(debug_assertions)]`; a release build gets an Err stub, and only the
// e2e-webdriver capability grants them — never `default.json`.

/// Every live webview label (`strip`, `home`, `p-*`), sorted — a cross-check
/// for WebDriver's own handle list (V2-3.7: handles are webview labels).
#[tauri::command]
pub fn window_labels(app: AppHandle) -> Vec<String> {
    #[cfg(debug_assertions)]
    {
        let mut v: Vec<String> = app.webviews().keys().cloned().collect();
        v.sort();
        v
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        Vec::new()
    }
}

/// Make a tab the active one (`tabs::reveal`). A background tab is
/// `document.hidden` and gets 0 rAF/s, so a scenario selects the tab before
/// any animation-gated check (spike "Ceiling").
#[tauri::command]
pub fn e2e_focus_window(app: AppHandle, label: String) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        crate::tabs::reveal(&app, &label)
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (app, label);
        Err("debug builds only".into())
    }
}

/// Close a tab through the ONE close path (`tabs::close_tab`): `destroy:
/// true` skips the "Stop AI in …?" guard; `false` is the user close path (the
/// strip's ×), guard included.
#[tauri::command]
pub fn e2e_close_window(app: AppHandle, label: String, destroy: bool) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        if app.get_webview(&label).is_none() {
            return Err(format!("no window {label}"));
        }
        if destroy {
            crate::tabs::close_tab(&app, &label)
        } else {
            crate::tabs::close_tab_by_user(&app, &label)
        }
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
    fn w1_an_intent_is_accepted_from_home_only() {
        let intent = crate::home::OpenIntent {
            kind: "create-canvas".into(),
            prompt: "make a landing page".into(),
            project_hint: None,
        };
        let project = Caller::Project(CallerProject {
            label: "p-lself".into(),
            pid: "lself".into(),
            root: A.into(),
        });
        // A project window may open a project, but never park a prompt for one.
        assert!(intent_for(&project, Some(intent.clone())).is_err());
        assert_eq!(intent_for(&project, None).unwrap(), None);
        // Home may, and the prompt is still validated.
        assert_eq!(intent_for(&Caller::Home, Some(intent.clone())).unwrap(), Some(intent));
        let empty = crate::home::OpenIntent {
            kind: "create-canvas".into(),
            prompt: "  ".into(),
            project_hint: None,
        };
        assert!(intent_for(&Caller::Home, Some(empty)).is_err());
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
        let e2e = read(include_str!("../capabilities/debug/e2e-webdriver.json"));
        // V2-3.7: tabs are child webviews of the one `shell` window — named
        // under `webviews`, never `windows` (tabs.rs scans every capability).
        assert_eq!(default["webviews"], serde_json::json!(["p-*"]));
        assert_eq!(e2e["webviews"], serde_json::json!(["home", "p-*", "strip"]));
        assert!(default.get("windows").is_none() && e2e.get("windows").is_none());
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
        // V2-3.6: the "Opened <name> from a link." toast needs its grant in release.
        assert!(perms(&default).iter().any(|p| p == "allow-take-link-opened"));
    }

    /// V2-3.6 N-M2 (c): every command a shipped page may call re-checks its
    /// caller in Rust — the calling window's label AND its current URL origin
    /// (`caller_project` / `caller_any` / `caller_home`, or `resolve_profile`,
    /// which is `caller_project`). The capability ACL alone admits any frame on
    /// `http://localhost:*`, the canvas iframe included, so a command without
    /// its own check is one leaked invoke key away from the canvas. A source
    /// ratchet: a new grant without a check is a red test.
    #[test]
    fn every_granted_command_checks_its_caller() {
        let read = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap();
        let default = read(include_str!("../capabilities/default.json"));
        let mut granted: Vec<String> = default["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str().map(str::to_string))
            .collect();
        granted.extend(crate::home::HOME_PERMISSIONS.iter().map(|p| p.to_string()));
        // V2-3.7: the strip's commands (each checks label `strip` + strip.html).
        let strip = read(include_str!("../capabilities/strip.json"));
        granted.extend(
            strip["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|p| p.as_str().map(str::to_string)),
        );
        assert!(granted.iter().any(|p| p == "allow-tab-close"));
        let src_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let sources: Vec<String> = std::fs::read_dir(&src_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "rs"))
            .map(|p| std::fs::read_to_string(p).unwrap())
            .collect();
        let checks = [
            "caller_project(",
            "caller_any(",
            "caller_home(",
            "check_home(",
            "resolve_profile(",
            "session_for(", // home_session: label + exact Home origin, pure
            "caller_strip(", // V2-3.7 strip commands: label `strip` + app-local strip.html
        ];
        let mut unchecked = Vec::new();
        for p in granted.iter().filter(|p| p.starts_with("allow-")) {
            let cmd = p.trim_start_matches("allow-").replace('-', "_");
            let body = sources.iter().find_map(|s| {
                [format!("pub fn {cmd}("), format!("pub async fn {cmd}("), format!("\nfn {cmd}("), format!("async fn {cmd}(")]
                    .iter()
                    .find_map(|sig| s.find(sig.as_str()).map(|i| &s[i..]))
                    .map(|rest| {
                        // The command's own body: up to the next command.
                        let end = rest[1..].find("#[tauri::command").map_or(rest.len(), |e| e + 1);
                        rest[..end].to_string()
                    })
            });
            let Some(body) = body else {
                panic!("{p}: no `fn {cmd}` found under src/");
            };
            if !checks.iter().any(|c| body.contains(c)) {
                unchecked.push(cmd);
            }
        }
        assert!(unchecked.is_empty(), "granted commands with no Rust caller check: {unchecked:?}");
    }

    /// V2-3.6 M3: a project page switches its tab only to a registered
    /// project or the folder its last picker returned (or a direct child).
    #[test]
    fn open_local_project_refuses_an_unregistered_unpicked_path() {
        let base = std::env::temp_dir().join(format!(
            "maude-open-local-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
        ));
        let picked = base.join("picked");
        let child = picked.join("new-project");
        let grand = child.join("deeper");
        let other = base.join("elsewhere");
        let lookalike = base.join("picked-evil");
        for d in [&grand, &other, &lookalike] {
            std::fs::create_dir_all(d).unwrap();
        }
        let pick = std::fs::canonicalize(&picked).unwrap();
        // Unregistered and nothing picked: refused.
        assert!(!local_path_allowed(false, None, &other));
        // Registered: allowed (recents, a resolved link).
        assert!(local_path_allowed(true, None, &other));
        // The pick itself and what "create/clone here" makes inside it.
        assert!(local_path_allowed(false, Some(&pick), &picked));
        assert!(local_path_allowed(false, Some(&pick), &child));
        assert!(local_path_allowed(false, Some(&pick), &picked.join("new-project/../new-project")));
        // Not deeper, not beside it, not a prefix lookalike.
        assert!(!local_path_allowed(false, Some(&pick), &grand));
        assert!(!local_path_allowed(false, Some(&pick), &other));
        assert!(!local_path_allowed(false, Some(&pick), &lookalike));
        assert!(!local_path_allowed(false, Some(&pick), &base.join("missing")));
        // The launch override root is compared as a directory, not a string.
        assert!(same_dir(&picked, &child.join("..")));
        assert!(!same_dir(&picked, &lookalike));
        assert!(!same_dir(&picked, &base.join("missing")));
        // The slot is per window.
        remember_pick("p-pick-a", &picked.to_string_lossy());
        assert!(PICKED_FOLDER.take("p-pick-b").is_none());
        assert_eq!(PICKED_FOLDER.take("p-pick-a"), Some(pick));
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Finding 1d: Tauri delivers an `emit_to(label)` to every JS listener
    /// registered with target `Any`, in every webview — so no page may listen
    /// at all. Every capability file (release AND debug) plus the runtime Home
    /// set: no `core:default`, no `core:event:*`.
    #[test]
    fn no_page_capability_grants_events() {
        fn files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            for e in std::fs::read_dir(dir).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    files(&p, out);
                } else if p.extension().is_some_and(|x| x == "json") {
                    out.push(p);
                }
            }
        }
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let mut caps = Vec::new();
        files(&dir, &mut caps);
        assert!(caps.len() >= 4, "capability files not found: {caps:?}");
        let mut sets: Vec<(String, Vec<String>)> = caps
            .iter()
            .map(|p| {
                let v: serde_json::Value =
                    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
                let perms = v["permissions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| match p {
                        serde_json::Value::String(s) => s.clone(),
                        other => other["identifier"].as_str().unwrap_or_default().to_string(),
                    })
                    .collect();
                (p.display().to_string(), perms)
            })
            .collect();
        sets.push((
            "home (runtime)".to_string(),
            crate::home::HOME_PERMISSIONS
                .iter()
                .map(|p| p.to_string())
                .collect(),
        ));
        for (name, set) in &sets {
            for p in set {
                assert!(
                    p != "core:default" && !p.starts_with("core:event:"),
                    "{name} grants {p}: a listening page hears every webview's emit_to"
                );
            }
        }
    }

    /// Finding 1d, the other half: nothing in `src/` emits a Tauri event — every
    /// shell → page message goes through `bus::send` / `bus::broadcast` (the
    /// Channel the page handed `shell_subscribe`). An event, even `emit_to` one
    /// label, reaches every `Any`-target listener in every webview. Allow-list
    /// an emit here only if it provably reaches no page.
    #[test]
    fn the_shell_never_emits_to_a_page() {
        const ALLOWED: &[(&str, &str)] = &[];
        // Built at runtime so this test's own source doesn't match itself.
        let needles: Vec<String> = ["emit_to(", ".emit(", "emit_filter(", "emit_str(", "Emitter"]
            .iter()
            .map(|n| n.to_string())
            .collect();
        let src_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut hits = Vec::new();
        for e in std::fs::read_dir(&src_dir).unwrap().flatten() {
            let path = e.path();
            if path.extension().is_none_or(|x| x != "rs") {
                continue;
            }
            let file = path.file_name().unwrap().to_string_lossy().to_string();
            let text = std::fs::read_to_string(&path).unwrap();
            for (i, line) in text.lines().enumerate() {
                let code = line.split("//").next().unwrap_or("");
                if code.contains("needles") || code.contains("ALLOWED") {
                    continue;
                }
                for n in &needles {
                    if code.contains(n.as_str())
                        && !ALLOWED.iter().any(|(f, l)| *f == file && line.contains(l))
                    {
                        hits.push(format!("{file}:{}: {}", i + 1, line.trim()));
                    }
                }
            }
        }
        assert!(
            hits.is_empty(),
            "the shell emits a Tauri event (use bus::send): {hits:#?}"
        );
    }

    /// Low 1g: only the tab in front opens a native dialog or switches tabs.
    #[test]
    fn only_the_tab_in_front_may_open_a_dialog_or_switch_tabs() {
        let mut b = WindowBook::default();
        b.insert(HOME_LABEL, Role::Home, 0);
        for (l, r) in [("p-a", "/a"), ("p-b", "/b")] {
            b.insert(
                l,
                Role::Project {
                    pid: l.into(),
                    root: r.into(),
                },
                0,
            );
        }
        // Nothing focused yet: Home is in front.
        assert!(front_only(&b, HOME_LABEL).is_ok());
        assert!(front_only(&b, "p-a").is_err());
        assert!(b.focus("p-a", 1));
        assert!(front_only(&b, "p-a").is_ok());
        assert!(
            front_only(&b, "p-b").is_err(),
            "a background tab opened a dialog"
        );
        assert!(
            front_only(&b, HOME_LABEL).is_err(),
            "hidden Home opened a dialog"
        );
        assert!(front_only(&b, "strip").is_err());
        // And every command that opens one (or switches the tab) asks.
        let src = |f: &str| {
            std::fs::read_to_string(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("src")
                    .join(f),
            )
            .unwrap()
        };
        let body = |text: &str, sig: &str| -> String {
            let i = text.find(sig).unwrap_or_else(|| panic!("{sig} not found"));
            let rest = &text[i..];
            let end = rest[1..]
                .find("#[tauri::command")
                .map_or(rest.len(), |e| e + 1);
            rest[..end].to_string()
        };
        for (file, sig) in [
            ("lib.rs", "async fn pick_directory("),
            ("lib.rs", "async fn save_export("),
            ("lib.rs", "async fn pick_media_file("),
            ("lib.rs", "async fn pick_media_files("),
            ("home.rs", "pub async fn relink_project("),
            ("home.rs", "pub async fn new_home_tab("),
            ("windows.rs", "pub async fn open_project("),
            ("present.rs", "pub async fn present_displays("),
            ("present.rs", "pub async fn present_audience_open("),
            ("home.rs", "pub async fn open_search_result("),
        ] {
            assert!(
                body(&src(file), sig).contains("caller_in_front("),
                "{sig} lets a hidden tab act"
            );
        }
    }

    /// V2-3.6 M2 / M5 / L3: what the shipped capabilities may never grant.
    #[test]
    fn capabilities_grant_no_emit_no_profiles_and_no_debug_commands() {
        let read = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap();
        let perms = |v: &serde_json::Value| -> Vec<String> {
            v["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|p| p.as_str().map(str::to_string))
                .collect()
        };
        let default = perms(&read(include_str!("../capabilities/default.json")));
        let splash = perms(&read(include_str!("../capabilities/home-splash.json")));
        let e2e = perms(&read(include_str!("../capabilities/debug/e2e-webdriver.json")));
        let home: Vec<String> = crate::home::HOME_PERMISSIONS.iter().map(|p| p.to_string()).collect();
        // M5: no page may emit into another window. `core:default` and
        // `core:event:default` both carry emit + emit-to.
        let emitters = [
            "core:default",
            "core:event:default",
            "core:event:allow-emit",
            "core:event:allow-emit-to",
        ];
        for (name, set) in [("default", &default), ("home-splash", &splash), ("home", &home), ("e2e", &e2e)] {
            for e in emitters {
                assert!(!set.iter().any(|p| p == e), "{name} grants {e}");
            }
        }
        // Finding 1d: pages hear the shell on their own Channel, never an event.
        for (name, set) in [("default", &default), ("home", &home)] {
            assert!(set.iter().any(|p| p == "allow-shell-subscribe"), "{name} can't subscribe");
        }
        // M2: profile management is not a project-page power.
        for p in ["allow-profiles-list", "allow-profiles-create", "allow-profiles-delete"] {
            assert!(!default.contains(&p.to_string()), "{p} in default.json");
            assert!(!home.contains(&p.to_string()), "{p} granted to Home without a UI");
            assert!(e2e.contains(&p.to_string()), "{p}: the identity e2e needs it");
        }
        // V2-3.10 low (c): no page reads the deep-link plugin directly. Its
        // `get_current` returns the launch link (which may carry `?code=`) with
        // no caller check; links reach pages only through `deep_link.rs`'s
        // caller-checked parking (`take_pending_deep_link`). The plugin's Rust
        // side (`on_open_url`) needs no capability.
        for (name, set) in [("default", &default), ("home-splash", &splash), ("home", &home), ("e2e", &e2e)] {
            assert!(
                !set.iter().any(|p| p.starts_with("deep-link:")),
                "{name} grants the deep-link plugin to a page"
            );
        }
        // L3: every debug-only command is granted ONLY by the debug capability,
        // and a release build does not compile that file at all.
        let debug_only = [
            "wdio-webdriver:default",
            "allow-window-labels",
            "allow-e2e-focus-window",
            "allow-e2e-close-window",
            "allow-e2e-open-root",
            "allow-e2e-bind-profile",
            "allow-e2e-notification-click",
            "allow-e2e-deliver-deep-link",
            "allow-e2e-shell-bounds",
        ];
        for p in debug_only {
            assert!(e2e.contains(&p.to_string()), "{p} belongs to the e2e capability");
            for (name, set) in [("default", &default), ("home-splash", &splash), ("home", &home)] {
                assert!(!set.contains(&p.to_string()), "{p} in {name}");
            }
        }
        let build = include_str!("../build.rs");
        assert!(build.contains(r#"const RELEASE_CAPABILITIES: &str = "./capabilities/*.json";"#));
        assert!(build.contains("capabilities_path_pattern(RELEASE_CAPABILITIES)"));
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
        // before B (a new tab goes after the one that opened it), so the saved
        // order is A, C, B, not the open order A, B, C. Home is pinned and
        // never in the session's tabs (V2-3.7), but may be the focused one.
        let host = MockHost::default();
        let book = Mutex::new(WindowBook::default());
        open_in(&host, &book, A, "Alpha", None, 1).unwrap();
        open_in(&host, &book, B, "Beta", Some(&label_of(A)), 2).unwrap();
        open_in(&host, &book, C, "Gamma", Some(&label_of(A)), 3).unwrap();
        book.lock().unwrap().insert_after("home", Role::Home, 4, None);
        book.lock().unwrap().focus(&label_of(B), 5);

        let (tabs, focused) = book.lock().unwrap().session_tabs();
        let labels: Vec<&str> = tabs.iter().map(|t| t.label.as_str()).collect();
        assert_eq!(labels, [label_of(A), label_of(C), label_of(B)]);
        assert_eq!(tabs[1].pid.as_deref(), Some(pid_for_root(C).as_str()));
        assert_eq!(focused, Some(label_of(B)));
        book.lock().unwrap().focus("home", 6);
        assert_eq!(book.lock().unwrap().session_tabs().1.as_deref(), Some("home"));

        // A closed tab leaves the session.
        forget_window(&mut book.lock().unwrap(), &label_of(C));
        let (tabs, _) = book.lock().unwrap().session_tabs();
        assert_eq!(tabs.len(), 2);
    }

    fn restore_fixture() -> std::collections::BTreeMap<String, crate::app_state::ProjectEntry> {
        let mut projects = std::collections::BTreeMap::new();
        for r in [A, B, C] {
            projects.insert(
                pid_for_root(r),
                crate::app_state::ProjectEntry {
                    root: r.to_string(),
                    ..crate::app_state::ProjectEntry::default()
                },
            );
        }
        projects
    }

    fn stab(r: &str) -> crate::app_state::SessionTab {
        crate::app_state::SessionTab {
            label: label_of(r),
            pid: Some(pid_for_root(r)),
        }
    }

    fn roots(plan: &RestorePlan) -> Vec<&str> {
        plan.tabs.iter().map(|t| t.root.as_str()).collect()
    }

    #[test]
    fn plan_tabs_keeps_saved_order_and_only_the_focused_tab_runs() {
        use crate::app_state::{Session, SessionTab};
        let projects = restore_fixture();
        let session = Session {
            tabs: vec![
                stab(C),
                stab(A),
                // A pid the registry forgot, and a repeat: both skipped.
                SessionTab { label: "p-lffffffffffffffff".into(), pid: Some("lffffffffffffffff".into()) },
                stab(A),
                stab(B),
            ],
            focused: Some(label_of(A)),
            saved_at: 1,
        };
        let plan = plan_tabs(&session, &projects, |_| true);
        assert_eq!(roots(&plan), [C, A, B]);
        assert_eq!(plan.active, Some(1), "only session.focused spawns");

        // A vanished root is skipped; a focused tab that vanished falls back to
        // the first survivor.
        let plan = plan_tabs(&session, &projects, |r| r != A);
        assert_eq!(roots(&plan), [C, B]);
        assert_eq!(plan.active, Some(0));

        // Nothing survives: Home alone, Home active.
        let plan = plan_tabs(&session, &projects, |_| false);
        assert!(plan.tabs.is_empty());
        assert_eq!(plan.active, None);
    }

    #[test]
    fn plan_tabs_drops_an_old_home_entry_and_restores_home_active() {
        use crate::app_state::{Session, SessionTab};
        let projects = restore_fixture();
        // A pre-V2-3.7 session: Home was a tab of its own, and the active one.
        let session = Session {
            tabs: vec![
                SessionTab { label: "home".into(), pid: None },
                stab(A),
                stab(B),
            ],
            focused: Some("home".into()),
            saved_at: 1,
        };
        let plan = plan_tabs(&session, &projects, |_| true);
        assert_eq!(roots(&plan), [A, B], "no stray Home tab");
        assert_eq!(plan.active, None, "focused == home: Home active, nothing spawns");

        // Today's session (Home never in tabs), B active.
        let session = Session {
            tabs: vec![stab(A), stab(B)],
            focused: Some(label_of(B)),
            saved_at: 2,
        };
        let plan = plan_tabs(&session, &projects, |_| true);
        assert_eq!(roots(&plan), [A, B]);
        assert_eq!(plan.active, Some(1));

        // No focus saved: the first tab.
        let session = Session { focused: None, ..session };
        assert_eq!(plan_tabs(&session, &projects, |_| true).active, Some(0));

        // Home active with no project tab at all: Home alone.
        let session = Session { tabs: vec![], focused: Some("home".into()), saved_at: 3 };
        assert_eq!(
            plan_tabs(&session, &projects, |_| true),
            RestorePlan { tabs: vec![], active: None }
        );
    }

    #[test]
    fn boot_restores_any_saved_session_and_opens_the_fallback_only_without_one() {
        let one = RestorePlan {
            tabs: vec![RestoreTab { pid: "a".into(), root: A.into() }],
            active: Some(0),
        };
        // A one-tab session restores (its active tab), not the "last project".
        assert_eq!(boot_tabs(Some(one.clone()), Some(B)), BootTabs::Restore(one));
        // A session with nothing left is Home alone, never the last project.
        let none = RestorePlan { tabs: vec![], active: None };
        assert_eq!(boot_tabs(Some(none.clone()), Some(B)), BootTabs::Restore(none));
        // No session: the boot plan's project, else Home alone.
        assert_eq!(boot_tabs(None, Some(B)), BootTabs::Open(B.into()));
        assert_eq!(boot_tabs(None, None), BootTabs::HomeOnly);
    }

    #[test]
    fn a_background_open_builds_the_tab_without_activating_it() {
        let host = MockHost::default();
        let book = Mutex::new(WindowBook::default());
        let a = open_in_as(&host, &book, A, "Alpha", None, 1, true).unwrap();
        assert_eq!(a, Opened::New(label_of(A)));
        assert!(host.created.borrow()[0].background);
        // Opening it again in the background leaves it where it is.
        let again = open_in_as(&host, &book, A, "Alpha", None, 2, true).unwrap();
        assert_eq!(again, Opened::Existing(label_of(A)));
        assert!(host.revealed.borrow().is_empty(), "no reveal while restoring");
        // A normal open still activates, and a normal build is not background.
        open_in(&host, &book, A, "Alpha", None, 3).unwrap();
        assert_eq!(host.revealed.borrow().len(), 1);
        open_in(&host, &book, B, "Beta", None, 4).unwrap();
        assert!(!host.created.borrow()[1].background);
    }

    // ── V2-3 patches: one-shot values parked per window label ──────────────
    // The statics are process-wide and tests run in parallel: each test uses
    // its own labels.

    #[test]
    fn tabs_restored_is_one_shot_and_answers_only_its_own_window() {
        TABS_RESTORED.park("p-tr-front", TabsRestored { count: 3 });
        assert_eq!(TABS_RESTORED.take("p-tr-other"), None);
        assert_eq!(TABS_RESTORED.take("p-tr-front"), Some(TabsRestored { count: 3 }));
        assert_eq!(TABS_RESTORED.take("p-tr-front"), None);
    }

    #[test]
    fn pending_navigate_is_parked_for_a_new_window_with_an_artboard_only() {
        let full = OpenTarget {
            canvas: Some("ui/a.tsx".into()),
            artboard: Some("hero".into()),
        };
        park_navigate_for_new(&Opened::New("p-nav-new".into()), Some(&full));
        assert_eq!(PENDING_NAVIGATE.take("p-nav-other"), None);
        assert_eq!(PENDING_NAVIGATE.take("p-nav-new"), Some(full.clone()));
        assert_eq!(PENDING_NAVIGATE.take("p-nav-new"), None);
        // An existing window hears `shell://navigate` instead.
        park_navigate_for_new(&Opened::Existing("p-nav-old".into()), Some(&full));
        assert_eq!(PENDING_NAVIGATE.take("p-nav-old"), None);
        // A canvas alone already rides in `?open=`.
        let canvas_only = OpenTarget {
            canvas: Some("ui/a.tsx".into()),
            artboard: None,
        };
        park_navigate_for_new(&Opened::New("p-nav-canvas".into()), Some(&canvas_only));
        assert_eq!(PENDING_NAVIGATE.take("p-nav-canvas"), None);
        park_navigate_for_new(&Opened::New("p-nav-none".into()), None);
        assert_eq!(PENDING_NAVIGATE.take("p-nav-none"), None);
    }

    /// N-M2 (audit 2): the guard admits the splash and the window's own
    /// origins — never another loopback listener, a file, or (for Home and the
    /// main frame) a remote page.
    #[test]
    fn the_navigation_guard_admits_only_the_windows_own_origins() {
        use NavRole::*;
        let u = |s: &str| s.parse::<tauri::Url>().unwrap();
        let (o, c) = (Some("http://localhost:4399"), Some("http://localhost:4400"));
        let nav = |r, s: &str| navigation_allowed(r, &u(s), o, c);
        assert!(nav(Project, "tauri://localhost/index.html"));
        assert!(nav(Project, "http://tauri.localhost/index.html"));
        assert!(nav(Project, "http://localhost:4399/?open=ui%2Fa.tsx"));
        assert!(nav(Project, "http://localhost:4400/_canvas-shell.html"), "its canvas iframe");
        assert!(nav(Project, "blob:http://localhost:4399/0f1e"));
        assert!(nav(Project, "about:blank"));
        assert!(nav(Project, "about:srcdoc"));
        assert!(!nav(Project, "http://localhost:5555/"), "an agent's listener");
        assert!(!nav(Project, "http://127.0.0.1:4399/"), "the unrecorded twin");
        assert!(!nav(Project, "https://localhost:4399/"));
        assert!(!nav(Project, "http://[::1]:4399/"));
        assert!(!nav(Project, "blob:http://localhost:5555/0f1e"));
        assert!(!nav(Project, "blob:http://localhost:4400/0f1e"), "the canvas origin's blob");
        assert!(!nav(Project, "blob:https://www.youtube.com/0f1e"), "a remote page's blob");
        assert!(!nav(Project, "file:///etc/passwd"));
        assert!(!nav(Project, "maude://open/x"));
        assert!(!nav(Project, "http://evil.example/"));
        assert!(!nav(Project, "about:config"));
        // Remote https is subframe content only (an embed inside a canvas).
        assert!(nav(Project, "https://www.youtube.com/embed/x"));
        assert!(!top_level_allowed(Project, &u("https://www.youtube.com/embed/x"), o));
        assert!(!top_level_allowed(Project, &u("http://localhost:4400/"), o));
        assert!(!top_level_allowed(Project, &u("data:text/html,x"), o));
        assert!(top_level_allowed(Project, &u("http://localhost:4399/x"), o));
        assert!(top_level_allowed(Project, &u("tauri://localhost/index.html"), o));
        // Home: its own origin and the splash, nothing else.
        let h = Some("http://127.0.0.1:4500");
        assert!(navigation_allowed(Home, &u("http://127.0.0.1:4500/"), h, None));
        assert!(navigation_allowed(Home, &u("tauri://localhost/index.html"), h, None));
        assert!(!navigation_allowed(Home, &u("http://localhost:4500/"), h, None));
        assert!(!navigation_allowed(Home, &u("http://127.0.0.1:4501/"), h, None));
        assert!(!navigation_allowed(Home, &u("https://www.youtube.com/"), h, None));
        assert!(!navigation_allowed(Home, &u("data:text/html,x"), h, None));
        // A cell tab (one rule, built later): https in the cloud zone.
        assert!(navigation_allowed(Cell, &u("https://acme.cloud.maude.sh/x"), None, None));
        assert!(top_level_allowed(Cell, &u("https://acme.cloud.maude.sh/x"), None));
        assert!(!navigation_allowed(Cell, &u("https://evil.example/"), None, None));
        assert!(!navigation_allowed(Cell, &u("http://localhost:4399/"), None, None));
    }

    /// N-M3 (audit 2): a dead server's port vouches for nothing — the window's
    /// recorded origins are cleared, so neither a caller check nor a reload on
    /// that port is answered until a fresh info file names the next one.
    #[test]
    fn a_dead_servers_origin_is_no_longer_the_windows() {
        let mut book = WindowBook::default();
        let label = label_for_pid(&pid_for_root("/tmp/nm3"));
        book.insert(
            &label,
            Role::Project {
                pid: pid_for_root("/tmp/nm3"),
                root: "/tmp/nm3".into(),
            },
            0,
        );
        book.set_origin(&label, "http://localhost:4399");
        book.set_canvas_origin(&label, Some("http://localhost:4400"));
        let page = "http://localhost:4399/".parse::<tauri::Url>().unwrap();
        assert!(check_caller(&book, &label, Some(&page), false).is_ok());
        assert_eq!(book.forget_origin_of_root("/tmp/nm3"), Some(label.clone()));
        assert!(check_caller(&book, &label, Some(&page), false).is_err());
        let (role, origin, canvas) = book.nav_view(&label).unwrap();
        assert!(!navigation_allowed(role, &page, origin.as_deref(), canvas.as_deref()));
        let iframe = "http://localhost:4400/".parse::<tauri::Url>().unwrap();
        assert!(!navigation_allowed(role, &iframe, origin.as_deref(), canvas.as_deref()));
        let splash = "tauri://localhost/index.html".parse::<tauri::Url>().unwrap();
        assert!(navigation_allowed(role, &splash, origin.as_deref(), canvas.as_deref()));
        assert!(top_level_allowed(role, &splash, origin.as_deref()));
    }

    #[test]
    fn parked_values_die_with_their_window() {
        let t = OpenTarget {
            canvas: None,
            artboard: Some("hero".into()),
        };
        TABS_RESTORED.park("p-gone", TabsRestored { count: 2 });
        PENDING_NAVIGATE.park("p-gone", t.clone());
        crate::home::park_intent_for_test(
            "p-gone",
            crate::home::OpenIntent {
                kind: "create-canvas".into(),
                prompt: "x".into(),
                project_hint: None,
            },
        );
        // N-M5: a connect link (its `?code=`) parked for the window too.
        crate::deep_link::PENDING_LINKS.park("p-gone", "maude://open/a?code=mhc_00");
        TABS_RESTORED.park("p-stays", TabsRestored { count: 2 });
        PENDING_NAVIGATE.park("p-stays", t.clone());
        crate::deep_link::PENDING_LINKS.park("p-stays", "maude://open/b");
        drop_parked_for("p-gone");
        assert_eq!(TABS_RESTORED.take("p-gone"), None);
        assert_eq!(PENDING_NAVIGATE.take("p-gone"), None);
        assert_eq!(crate::home::take_intent("p-gone"), None);
        assert_eq!(crate::deep_link::PENDING_LINKS.take("p-gone"), None);
        assert_eq!(
            crate::deep_link::PENDING_LINKS.take("p-stays").as_deref(),
            Some("maude://open/b")
        );
        // Another window's values are untouched.
        assert_eq!(TABS_RESTORED.take("p-stays"), Some(TabsRestored { count: 2 }));
        assert_eq!(PENDING_NAVIGATE.take("p-stays"), Some(t));
    }
}
