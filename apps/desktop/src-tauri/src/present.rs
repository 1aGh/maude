// S3.6a — Present: the displays and the audience window (contract
// `apps/studio/client/v2/contracts/S3-present-session.md` §6).
//
// The audience window is a TOP-LEVEL window `audience-<pid>` (not a tab of the
// `shell` window) that shows this project's follower root, full screen, on a
// display the presenter picked. Three rules carry the security:
//
// - **Rust builds the URL.** The page passes a display id, a canvas and a
//   session id — never a URL (decision `maude/v2-S3.0-audience-url-built-in-
//   rust`). The origin is the one the shell recorded for the CALLER's tab.
// - **No capability.** No capability file names `audience-*` (`p-*`, `home`
//   and `strip` only) and the window is not in the windows book, so every
//   caller check refuses it. The follower root calls no Tauri API.
// - **Its own navigation guard** (`audience_nav_check`, reached from
//   windows.rs `nav_check`): on the project origin only the exact follower
//   root its entry names (origin, `open`, `sid`); subframes also on the
//   project's canvas origin, `about:blank`/`about:srcdoc` and a `blob:` of
//   either. Nothing app-local, no `data:`, no remote https.
// - **It never keeps the keys.** Focus goes back to the presenter whenever it
//   becomes key, and once its full-screen transition settles it is made
//   non-focusable. It opens only when the page declares the audience lock.
//
// Lifetime: one window per project. It closes when its project tab closes or
// switches project, when the project's recorded origin changes or is cleared
// (server died, tab resting), on `present_audience_close` (End / esc), and
// when its display disappears — a watcher re-checks every 2 s while it is
// open. Presenting continues on the Mac: nothing here touches the tab.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use crate::sidecar::SidecarState;
use crate::windows::{caller_in_front, caller_project, WindowBook};

/// Label prefix of every audience window (`audience-<pid>`).
pub const AUDIENCE_PREFIX: &str = "audience-";

/// How often an open audience window re-checks its display and its project.
const WATCH_EVERY: Duration = Duration::from_secs(2);

/// The design-rel grammar's length cap (contract §5).
const MAX_CANVAS_LEN: usize = 1024;

/// The exact query keys of the follower root an audience window may show.
const AUDIENCE_QUERY_KEYS: [&str; 4] = ["open", "present", "sid", "audience"];

/// The audience-lock version the page must declare (F2): the follower root
/// that S3.7a builds treats `audience=1` as "no editor, no keys, no chrome".
/// `client/v2/present/follow-location.js` exports the same number as
/// `AUDIENCE_LOCK`; presenter view passes it to `present_audience_open`.
pub const AUDIENCE_LOCK: u32 = 1;

// ── Pure rules ──────────────────────────────────────────────────────────────

/// `audience-<pid>` for a project id (`l` + 16 hex, `windows::pid_for_root`).
pub fn audience_label(pid: &str) -> Option<String> {
    let ok = pid.len() <= 64
        && !pid.is_empty()
        && pid
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    ok.then(|| format!("{AUDIENCE_PREFIX}{pid}"))
}

pub fn is_audience_label(label: &str) -> bool {
    label.starts_with(AUDIENCE_PREFIX)
}

/// A presenter session id: `/^[a-z0-9]{8,32}$/` (contract §4).
pub fn valid_sid(sid: &str) -> bool {
    (8..=32).contains(&sid.len())
        && sid
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// The design-rel grammar (contract §5) for a canvas module: `<seg>(/<seg>)*.tsx`,
/// no empty / `.` / `..` segment, no segment starting `_` (runtime dirs), no
/// control character, `\` or `:`, at most 1024 bytes. Also no `%`, `?` or `#`
/// (F3): the raw string is what the page names, so nothing in it may decode or
/// split into something else.
pub fn valid_canvas(canvas: &str) -> bool {
    if canvas.len() > MAX_CANVAS_LEN
        || !canvas.ends_with(".tsx")
        || canvas.len() == ".tsx".len()
        || canvas
            .chars()
            .any(|c| c.is_control() || matches!(c, '\\' | ':' | '%' | '?' | '#'))
    {
        return false;
    }
    canvas
        .split('/')
        .all(|s| !s.is_empty() && s != "." && s != ".." && !s.starts_with('_'))
}

/// A display's stable id: FNV-1a 64 over (name, position, size), hex. Stable
/// across launches (no randomly seeded hasher), so a page may remember it.
pub fn display_id(name: &str, x: i32, y: i32, w: u32, h: u32) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let key = format!("{name}\u{0}{x}\u{0}{y}\u{0}{w}\u{0}{h}");
    for b in key.bytes() {
        hash ^= u64::from(b);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The follower root an audience window shows, built from the caller's
/// RECORDED origin (never an argument): `<origin>/?open=<canvas>&present=follow
/// &audience=1&sid=<sid>`. The origin must be loopback (DDR-109).
pub fn audience_url(origin: &str, canvas: &str, sid: &str) -> Result<tauri::Url, String> {
    if !valid_canvas(canvas) {
        return Err("Invalid canvas address.".to_string());
    }
    if !valid_sid(sid) {
        return Err("Invalid presentation session.".to_string());
    }
    let mut url = origin
        .parse::<tauri::Url>()
        .map_err(|_| "This project has no address yet.".to_string())?;
    if !crate::server_json::is_loopback_url(&url) || url.origin().ascii_serialization() != origin {
        return Err("This project has no address yet.".to_string());
    }
    url.set_path("/");
    url.set_fragment(None);
    url.query_pairs_mut()
        .clear()
        .append_pair("open", canvas)
        .append_pair("present", "follow")
        .append_pair("audience", "1")
        .append_pair("sid", sid);
    Ok(url)
}

/// The one page an audience window's main frame may show: the follower root
/// Rust built for its entry (origin, canvas and presenter session).
#[derive(Clone, Copy, Debug)]
pub struct Expect<'a> {
    pub origin: &'a str,
    pub open: &'a str,
    pub sid: &'a str,
}

/// The audience window's MAIN frame: exactly the follower root its entry
/// names — the recorded project origin, path `/`, query keys exactly {open,
/// present, sid, audience}, each once, `open` and `sid` equal to the entry's.
/// Nothing app-local (the window has no splash), no other page, no other
/// canvas or session (F4).
pub fn audience_top_level_allowed(url: &tauri::Url, expect: Option<Expect<'_>>) -> bool {
    let Some(x) = expect else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https")
        || url.origin().ascii_serialization() != x.origin
        || url.path() != "/"
    {
        return false;
    }
    let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
    if pairs.len() != AUDIENCE_QUERY_KEYS.len() {
        return false;
    }
    let get = |k: &str| -> Option<&str> {
        let mut it = pairs.iter().filter(|(key, _)| key == k);
        let first = it.next()?;
        it.next().is_none().then_some(first.1.as_str())
    };
    get("present") == Some("follow")
        && get("audience") == Some("1")
        && get("open") == Some(x.open)
        && get("sid") == Some(x.sid)
}

/// Every navigation of the audience window. WKWebView asks for subframes
/// too and does not say which frame (wry's handler gets the URL only), so
/// this is the union a frame of the follower root may load — and on the
/// project origin that union is the follower root itself (F5): a main-frame
/// navigation to any other page of the project is refused here, before it
/// commits. Otherwise: the project's canvas origin (the canvas iframe; never
/// a main frame, `audience_top_level_allowed` closes the window at commit),
/// `about:blank` / `about:srcdoc`, and a `blob:` minted by either origin.
/// With the origin split off (no canvas origin) the canvas iframe is the
/// project origin's own `/_canvas-shell(.html)`.
pub fn audience_navigation_allowed(
    url: &tauri::Url,
    expect: Option<Expect<'_>>,
    canvas: Option<&str>,
) -> bool {
    let Some(x) = expect else {
        return false;
    };
    let target = match url.scheme() {
        "about" => return matches!(url.path(), "blank" | "srcdoc"),
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
    if url.scheme() == "blob" {
        return o == x.origin || canvas == Some(o.as_str());
    }
    if canvas == Some(o.as_str()) {
        return true;
    }
    o == x.origin
        && (audience_top_level_allowed(url, Some(x))
            || (canvas.is_none()
                && matches!(target.path(), "/_canvas-shell.html" | "/_canvas-shell")))
}

/// F2: the page side must declare the audience lock (`audience=1` renders no
/// editor and takes no keys — S3.7a `follow-location.js` `AUDIENCE_LOCK`)
/// before Rust opens a full-screen window on it.
pub fn check_lock(lock: u32) -> Result<(), String> {
    if lock == AUDIENCE_LOCK {
        Ok(())
    } else {
        Err("not-ready: this version of Maude can't show an audience screen yet.".to_string())
    }
}

/// F6: the same display — by id, or (a resolution change) by name and
/// position with only the size changed.
pub fn same_display(entry: &AudienceEntry, id: &str, name: &str, pos: (i32, i32)) -> bool {
    id == entry.display_id || (name == entry.display_name && pos == entry.display_pos)
}

// ── The audience book ───────────────────────────────────────────────────────

/// One open audience window.
#[derive(Clone, Debug, PartialEq)]
pub struct AudienceEntry {
    /// The project tab that opened it (labels never change; its project may).
    pub owner: String,
    /// The project it shows — the owner's pid when it was opened.
    pub pid: String,
    /// The owner's recorded origin + canvas origin when it was opened.
    pub origin: String,
    pub canvas_origin: Option<String>,
    /// The follower root's `open` and `sid` — the only page it may show (F4).
    pub open: String,
    pub sid: String,
    pub display_id: String,
    /// The display's name and position (F6: re-matched when only its size changes).
    pub display_name: String,
    pub display_pos: (i32, i32),
    /// Unique per (re)open, so a superseded watcher stops.
    pub generation: u64,
    /// The window instance it lives in (a move reuses the window).
    pub window_id: u64,
}

/// How an open proceeds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum OpenPlan {
    /// Move / re-point the live window with this instance id.
    Reuse(u64),
    /// Build a new window with this instance id.
    Build(u64),
}

/// What a watcher tick does.
#[derive(Clone, Debug, PartialEq)]
pub enum Watch {
    /// A newer open owns the label: this watcher stops, that one watches.
    Stop,
    /// The entry is gone (End, a failed open): close any window under the
    /// label — never leave one unwatched (F1).
    Close,
    Check(Box<AudienceEntry>),
}

pub const STILL_CLOSING: &str = "The audience screen is still closing — try again in a moment.";

/// Audience entries and windows by label (F1: every removal is checked
/// against the window instance it is about, so a late `Destroyed` of an old
/// window never drops a newer entry under the same label).
#[derive(Default, Debug)]
pub struct AudienceBook {
    entries: HashMap<String, AudienceEntry>,
    /// The live window per label: (instance id, a close is in flight).
    windows: HashMap<String, (u64, bool)>,
    next_window: u64,
    next_generation: u64,
}

impl AudienceBook {
    /// Record `entry` for `label` and decide how the open proceeds. Called
    /// BEFORE any webview call, so the window's first navigation meets its
    /// guard. A window that is still closing (or one this book does not
    /// track) refuses the open: reusing a dying window would lose the entry
    /// to its `Destroyed`.
    pub fn begin_open(
        &mut self,
        label: &str,
        mut entry: AudienceEntry,
        untracked_window: bool,
    ) -> Result<(OpenPlan, u64), String> {
        let plan = match self.windows.get(label) {
            Some((_, true)) => return Err(STILL_CLOSING.to_string()),
            Some((id, false)) => OpenPlan::Reuse(*id),
            None if untracked_window => return Err(STILL_CLOSING.to_string()),
            None => {
                self.next_window += 1;
                self.windows
                    .insert(label.to_string(), (self.next_window, false));
                OpenPlan::Build(self.next_window)
            }
        };
        self.next_generation += 1;
        entry.generation = self.next_generation;
        entry.window_id = match plan {
            OpenPlan::Reuse(id) | OpenPlan::Build(id) => id,
        };
        self.entries.insert(label.to_string(), entry);
        Ok((plan, self.next_generation))
    }

    /// A close starts: forget the entry, mark the window dying.
    pub fn closing(&mut self, label: &str) -> Option<AudienceEntry> {
        if let Some(w) = self.windows.get_mut(label) {
            w.1 = true;
        }
        self.entries.remove(label)
    }

    /// Window instance `id` is gone (its `Destroyed`, or a build that never
    /// made one): drop what belongs to THAT instance only.
    pub fn destroyed(&mut self, label: &str, id: u64) {
        if self.windows.get(label).is_some_and(|w| w.0 == id) {
            self.windows.remove(label);
        }
        if self.entries.get(label).is_some_and(|e| e.window_id == id) {
            self.entries.remove(label);
        }
    }

    pub fn watch_step(&self, label: &str, generation: u64) -> Watch {
        match self.entries.get(label) {
            None => Watch::Close,
            Some(e) if e.generation != generation => Watch::Stop,
            Some(e) => Watch::Check(Box::new(e.clone())),
        }
    }

    pub fn entry(&self, label: &str) -> Option<&AudienceEntry> {
        self.entries.get(label)
    }
}

/// Never held across a webview call (those wait on the main thread, which
/// takes this lock in the navigation guard).
static AUDIENCE: Mutex<Option<AudienceBook>> = Mutex::new(None);

fn with_book<T>(f: impl FnOnce(&mut AudienceBook) -> T) -> T {
    let mut g = AUDIENCE.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(AudienceBook::default))
}

fn entry_of(label: &str) -> Option<AudienceEntry> {
    with_book(|b| b.entry(label).cloned())
}

/// Does `entry`'s project tab still show that project, awake, on the origin
/// the window was opened for? A tab that closed, switched project, rested, or
/// whose server died (origin cleared) or moved no longer vouches for it.
pub fn owner_still_presents(book: &WindowBook, entry: &AudienceEntry) -> bool {
    let same_project = book
        .project_of(&entry.owner)
        .is_some_and(|(pid, _)| pid == entry.pid);
    let Some((_, origin, canvas)) = book.nav_view(&entry.owner) else {
        return false;
    };
    same_project
        && !book.is_resting(&entry.owner)
        && origin.as_deref() == Some(entry.origin.as_str())
        && canvas == entry.canvas_origin
}

/// The audience window's navigation check (windows.rs `nav_check`): against
/// its entry, and only while its project tab still vouches for it. No entry,
/// or a tab that no longer vouches: nothing loads.
pub fn audience_nav_check<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    url: &tauri::Url,
    top: bool,
) -> bool {
    let Some(entry) = entry_of(label) else {
        return false;
    };
    let vouched = app.try_state::<SidecarState>().is_some_and(|s| {
        owner_still_presents(&s.windows.lock().unwrap_or_else(|e| e.into_inner()), &entry)
    });
    if !vouched {
        return false;
    }
    let x = Expect {
        origin: &entry.origin,
        open: &entry.open,
        sid: &entry.sid,
    };
    if top {
        audience_top_level_allowed(url, Some(x))
    } else {
        audience_navigation_allowed(url, Some(x), entry.canvas_origin.as_deref())
    }
}

/// How long a hidden audience window lives before it is destroyed (see `close_audience`).
const AUDIENCE_TEARDOWN_GRACE: Duration = Duration::from_millis(1500);

/// Close (and forget) an audience window. Idempotent.
pub fn close_audience<R: Runtime>(app: &AppHandle<R>, label: &str, why: &str) {
    if !is_audience_label(label) {
        return;
    }
    let had = with_book(|b| b.closing(label)).is_some();
    if let Some(w) = app.get_webview_window(label) {
        // The audience page has its own data store, so its own WKProcessPool: destroying the window while that
        // pool's DisplayLink still has the page as a client crashed the whole app (WebKit's DisplayLink teardown —
        // a CheckedRef assert, or the CVDisplayLink thread on a freed link; End right after Presenter view opened,
        // 2 of 8 modes-present runs on a two-display Mac). Hide it first — a page that is not visible stops asking
        // for frames — and destroy it after a grace, off this thread. Until its `Destroyed` the book keeps the
        // window "dying", so an open in between is refused as still closing.
        let _ = w.hide();
        let (w, label) = (w.clone(), label.to_string());
        std::thread::spawn(move || {
            std::thread::sleep(AUDIENCE_TEARDOWN_GRACE);
            if let Err(e) = w.destroy() {
                crate::sidecar::log_line(&format!("[maude] could not close {label}: {e}"));
            }
        });
    }
    if had {
        crate::sidecar::log_line(&format!("[maude] {label}: audience window closed ({why})"));
    }
}

// ── Displays ────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PresentDisplay {
    pub id: String,
    pub name: String,
    pub primary: bool,
    /// The caller's window is on this display.
    pub current: bool,
}

fn monitor_id(m: &tauri::Monitor) -> String {
    let (p, s) = (m.position(), m.size());
    display_id(
        m.name().map_or("", String::as_str),
        p.x,
        p.y,
        s.width,
        s.height,
    )
}

fn monitor_raw_name(m: &tauri::Monitor) -> &str {
    m.name().map_or("", String::as_str)
}

fn monitor_name(m: &tauri::Monitor, index: usize) -> String {
    m.name()
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| format!("Display {}", index + 1))
}

// ── Commands ────────────────────────────────────────────────────────────────

/// Every connected display (contract §6). The caller is the project tab in
/// front: a background page learns nothing about the person's screens.
#[tauri::command]
pub async fn present_displays(webview: tauri::Webview) -> Result<Vec<PresentDisplay>, String> {
    caller_project(&webview, false)?;
    caller_in_front(&webview)?;
    let app = webview.app_handle();
    let monitors = app
        .available_monitors()
        .map_err(|e| format!("Couldn't list displays: {e}"))?;
    let primary = app.primary_monitor().ok().flatten().map(|m| monitor_id(&m));
    let current = webview
        .window()
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| monitor_id(&m));
    Ok(monitors
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let id = monitor_id(m);
            PresentDisplay {
                primary: primary.as_deref() == Some(id.as_str()),
                current: current.as_deref() == Some(id.as_str()),
                name: monitor_name(m, i),
                id,
            }
        })
        .collect())
}

/// Open (or move) THIS project's audience window, full screen, on
/// `display_id`. Rust builds the URL from the caller's recorded origin. The
/// page declares the audience lock (`lock`, F2); the window never keeps
/// keyboard focus, so the presenter keeps the keys.
#[tauri::command]
pub async fn present_audience_open(
    webview: tauri::Webview,
    display_id: String,
    canvas: String,
    sid: String,
    lock: u32,
) -> Result<(), String> {
    let caller = caller_project(&webview, false)?;
    caller_in_front(&webview)?;
    check_lock(lock)?;
    let app = webview.app_handle().clone();
    let (origin, canvas_origin) = {
        let state = app
            .try_state::<SidecarState>()
            .ok_or_else(|| "Maude is still starting.".to_string())?;
        let book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
        match book.nav_view(&caller.label) {
            Some((_, Some(o), c)) => (o, c),
            _ => return Err("This project has no address yet.".to_string()),
        }
    };
    let url = audience_url(&origin, &canvas, &sid)?;
    let label = audience_label(&caller.pid)
        .ok_or_else(|| "This window isn't showing a project.".to_string())?;
    let current = webview
        .window()
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| monitor_id(&m));
    if current.as_deref() == Some(display_id.as_str()) {
        return Err("Pick another display — this one shows your presenter view.".to_string());
    }
    let monitor = app
        .available_monitors()
        .map_err(|e| format!("Couldn't list displays: {e}"))?
        .into_iter()
        .find(|m| monitor_id(m) == display_id)
        .ok_or_else(|| "That display isn't connected any more.".to_string())?;

    // Record first: the window's very first navigation meets the guard.
    let entry = AudienceEntry {
        owner: caller.label.clone(),
        pid: caller.pid.clone(),
        origin,
        canvas_origin,
        open: canvas,
        sid,
        display_id,
        display_name: monitor_raw_name(&monitor).to_string(),
        display_pos: (monitor.position().x, monitor.position().y),
        generation: 0,
        window_id: 0,
    };
    let untracked = app.get_webview_window(&label).is_some();
    let (plan, generation) = with_book(|b| {
        // A window we track is not "untracked", whatever the manager says.
        let tracked = b.windows.contains_key(&label);
        b.begin_open(&label, entry, untracked && !tracked)
    })?;

    let placed = match (plan, app.get_webview_window(&label)) {
        (OpenPlan::Reuse(_), Some(w)) => {
            let _ = w.set_focusable(true);
            place(&w, &monitor).and_then(|()| {
                if crate::webview_url::url_of(w.as_ref()).as_ref() == Some(&url) {
                    Ok(())
                } else {
                    w.navigate(url.clone()).map_err(|e| e.to_string())
                }
            })
        }
        (OpenPlan::Reuse(_), None) => Err("the window went away".to_string()),
        (OpenPlan::Build(id), _) => build(&app, &label, id, url, &monitor),
    };
    if let Err(e) = placed {
        close_audience(&app, &label, "it could not open");
        if app.get_webview_window(&label).is_none() {
            // No window will send a `Destroyed` for this instance.
            let id = match plan {
                OpenPlan::Reuse(id) | OpenPlan::Build(id) => id,
            };
            with_book(|b| b.destroyed(&label, id));
        }
        return Err(format!("Couldn't open the audience window: {e}"));
    }
    refocus_presenter(&app, &caller.label);
    settle(app.clone(), label.clone(), caller.label);
    watch(app, label, generation);
    Ok(())
}

/// Close the caller's audience window. Idempotent. A background tab may close
/// its OWN audience window (closing only ever takes something away), so this
/// one does not ask for the tab in front.
#[tauri::command]
pub async fn present_audience_close(webview: tauri::Webview) -> Result<(), String> {
    let caller = caller_project(&webview, false)?;
    if let Some(label) = audience_label(&caller.pid) {
        close_audience(webview.app_handle(), &label, "End");
    }
    Ok(())
}

// ── The window ──────────────────────────────────────────────────────────────

fn build(
    app: &AppHandle,
    label: &str,
    window_id: u64,
    url: tauri::Url,
    monitor: &tauri::Monitor,
) -> Result<(), String> {
    let (nav_app, nav_label) = (app.clone(), label.to_string());
    let (load_app, load_label) = (app.clone(), label.to_string());
    #[allow(unused_mut)]
    let mut builder =
        tauri::webview::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::External(url))
            .title("Maude — Audience")
            .visible(false)
            .focused(false)
            .decorations(false)
            .disable_drag_drop_handler()
            .on_navigation(move |url| {
                let ok = crate::windows::nav_check(&nav_app, &nav_label, url, false);
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
                    && !crate::windows::nav_check(&load_app, &load_label, payload.url(), true)
                {
                    // No splash to fall back to: the window goes — off this
                    // callback, which runs inside the window's own load.
                    let (app, label) = (load_app.clone(), load_label.clone());
                    std::thread::spawn(move || {
                        close_audience(&app, &label, "the page left the follower root")
                    });
                }
            })
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
    #[cfg(target_os = "macos")]
    if crate::windows::supports_data_store() {
        builder = builder.data_store_identifier(crate::windows::data_store_id_for_label(label));
    }
    let window = builder.build().map_err(|e| e.to_string())?;
    let (ev_app, ev_label) = (app.clone(), label.to_string());
    window.on_window_event(move |e| match e {
        // F1: only THIS window instance's records go.
        tauri::WindowEvent::Destroyed => with_book(|b| b.destroyed(&ev_label, window_id)),
        // F2: the audience window never keeps the keys — whenever it becomes
        // key (the async full-screen transition, a click), they go back.
        tauri::WindowEvent::Focused(true) => {
            if let Some(owner) = entry_of(&ev_label).map(|e| e.owner) {
                let app = ev_app.clone();
                std::thread::spawn(move || refocus_presenter(&app, &owner));
            }
        }
        _ => {}
    });
    place(&window, monitor)?;
    window.show().map_err(|e| e.to_string())
}

/// Put the window on `monitor`, full screen.
fn place<R: Runtime>(w: &tauri::WebviewWindow<R>, monitor: &tauri::Monitor) -> Result<(), String> {
    if w.is_fullscreen().unwrap_or(false) {
        w.set_fullscreen(false).map_err(|e| e.to_string())?;
    }
    w.set_position(tauri::Position::Physical(*monitor.position()))
        .map_err(|e| e.to_string())?;
    w.set_size(tauri::Size::Physical(*monitor.size()))
        .map_err(|e| e.to_string())?;
    w.set_fullscreen(true).map_err(|e| e.to_string())
}

/// Give the keys back to the presenter: the shell window, and the owner's
/// webview when it is still the tab in front.
fn refocus_presenter<R: Runtime>(app: &AppHandle<R>, owner: &str) {
    if let Some(shell) = app.get_window(crate::tabs::SHELL_LABEL) {
        let _ = shell.set_focus();
    }
    let front = app.try_state::<SidecarState>().is_some_and(|s| {
        crate::windows::front_only(&s.windows.lock().unwrap_or_else(|e| e.into_inner()), owner)
            .is_ok()
    });
    if front {
        if let Some(wv) = app.get_webview(owner) {
            let _ = wv.set_focus();
        }
    }
}

/// One step of the post-open settle (F2): macOS native full screen is
/// asynchronous, so focus is re-asserted until the window has been full
/// screen for two ticks in a row (then it is made non-focusable) or the
/// bound runs out. Returns (refocus now, done).
pub fn settle_step(
    was_fullscreen: bool,
    fullscreen: bool,
    focused: bool,
    last: bool,
) -> (bool, bool) {
    let done = last || (was_fullscreen && fullscreen);
    (focused || done, done)
}

const SETTLE_TICKS: u32 = 25;
const SETTLE_EVERY: Duration = Duration::from_millis(200);

fn settle(app: AppHandle, label: String, owner: String) {
    std::thread::spawn(move || {
        let mut was = false;
        for tick in 0..SETTLE_TICKS {
            std::thread::sleep(SETTLE_EVERY);
            let Some(w) = app.get_webview_window(&label) else {
                return;
            };
            let fullscreen = w.is_fullscreen().unwrap_or(false);
            let focused = w.is_focused().unwrap_or(false);
            let (refocus, done) = settle_step(was, fullscreen, focused, tick + 1 == SETTLE_TICKS);
            if done {
                // From here on it can't become key at all (canBecomeKeyWindow).
                let _ = w.set_focusable(false);
            }
            if refocus {
                refocus_presenter(&app, &owner);
            }
            if done {
                return;
            }
            was = fullscreen;
        }
    });
}

/// Re-check every `WATCH_EVERY` while the window is open: its display still
/// connected, its project tab still vouching for it. Either gone → close. An
/// entry that disappeared closes the window too (F1: never an unwatched
/// window); a reopen's newer generation stops this watcher.
fn watch(app: AppHandle, label: String, generation: u64) {
    std::thread::spawn(move || loop {
        std::thread::sleep(WATCH_EVERY);
        let entry = match with_book(|b| b.watch_step(&label, generation)) {
            Watch::Stop => return,
            Watch::Close => {
                close_audience(&app, &label, "its record is gone");
                return;
            }
            Watch::Check(e) => *e,
        };
        if app.get_webview_window(&label).is_none() {
            with_book(|b| b.destroyed(&label, entry.window_id));
            return;
        }
        let owner_ok = app.try_state::<SidecarState>().is_some_and(|s| {
            owner_still_presents(&s.windows.lock().unwrap_or_else(|e| e.into_inner()), &entry)
        });
        if !owner_ok {
            close_audience(&app, &label, "its project tab no longer shows it");
            return;
        }
        // A transient error listing monitors is not an unplug.
        if let Ok(monitors) = app.available_monitors() {
            let present = monitors.iter().any(|m| {
                same_display(
                    &entry,
                    &monitor_id(m),
                    monitor_raw_name(m),
                    (m.position().x, m.position().y),
                )
            });
            if !present {
                close_audience(&app, &label, "its display was disconnected");
                return;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::windows::Role;

    const O: &str = "http://localhost:4399";
    const C: &str = "http://localhost:4400";

    fn u(s: &str) -> tauri::Url {
        s.parse().unwrap()
    }

    const OPEN: &str = "d.tsx";
    const SID: &str = "abcd1234";

    fn x() -> Option<Expect<'static>> {
        Some(Expect {
            origin: O,
            open: OPEN,
            sid: SID,
        })
    }

    fn follower(open: &str, sid: &str) -> String {
        audience_url(O, open, sid).unwrap().to_string()
    }

    #[test]
    fn the_url_is_built_from_the_recorded_origin_never_an_argument() {
        let url = audience_url(O, "ui/deck.tsx", "abcd1234").unwrap();
        assert_eq!(
            url.as_str(),
            "http://localhost:4399/?open=ui%2Fdeck.tsx&present=follow&audience=1&sid=abcd1234"
        );
        let mine = Some(Expect {
            origin: O,
            open: "ui/deck.tsx",
            sid: "abcd1234",
        });
        assert!(
            audience_top_level_allowed(&url, mine),
            "the built URL passes its own guard"
        );
        // The canvas can't smuggle another path, origin, key or encoding into the URL.
        for canvas in [
            "http://evil.example/x.tsx",
            "../../etc/passwd.tsx",
            "/abs.tsx",
            "_draw/x.proof.tsx",
            "ui/_photo/x.tsx",
            "ui//x.tsx",
            "ui/./x.tsx",
            "ui\\x.tsx",
            "C:x.tsx",
            "ui/deck.html",
            ".tsx",
            "a\u{0}.tsx",
            "",
            // F3: nothing that decodes or splits into something else.
            "ui/%2e%2e/x.tsx",
            "%5fdraw/x.tsx",
            "ui/a%2Fb.tsx",
            "ui/a?x=1.tsx",
            "ui/a#x.tsx",
        ] {
            assert!(audience_url(O, canvas, "abcd1234").is_err(), "{canvas:?}");
        }
        let amp = "ui/a&present=x.tsx";
        let encoded = audience_url(O, amp, "abcd1234").unwrap();
        assert!(
            audience_top_level_allowed(
                &encoded,
                Some(Expect {
                    origin: O,
                    open: amp,
                    sid: "abcd1234"
                })
            ),
            "an & is a value, not a key"
        );
        assert_eq!(encoded.query_pairs().count(), 4);
        for sid in ["short", "ABCDEFGH1", "abcd-1234", &"a".repeat(33), ""] {
            assert!(audience_url(O, "ui/deck.tsx", sid).is_err(), "{sid:?}");
        }
        assert!(valid_canvas(&format!("{}.tsx", "a".repeat(1020))));
        assert!(!valid_canvas(&format!("{}.tsx", "a".repeat(1021))));
        // Only a loopback origin, given as a bare origin.
        assert!(audience_url("https://evil.example", "ui/deck.tsx", "abcd1234").is_err());
        assert!(audience_url("http://localhost:4399/x", "ui/deck.tsx", "abcd1234").is_err());
        assert!(audience_url("not a url", "ui/deck.tsx", "abcd1234").is_err());
    }

    #[test]
    fn the_navigation_guard_refuses_any_other_url() {
        let top = |s: &str| audience_top_level_allowed(&u(s), x());
        assert!(top(&follower(OPEN, SID)));
        assert!(top(
            "http://localhost:4399/?sid=abcd1234&audience=1&present=follow&open=d.tsx"
        ));
        // F4: another canvas or another session, though both valid.
        assert!(!top(&follower("other.tsx", SID)));
        assert!(!top(&follower(OPEN, "zzzz9999")));
        // Another page of the project, an extra / missing / repeated key, a bad value.
        assert!(!top("http://localhost:4399/?open=d.tsx"));
        assert!(!top(
            "http://localhost:4399/_config?open=d.tsx&present=follow&audience=1&sid=abcd1234"
        ));
        assert!(!top(
            "http://localhost:4399/?open=d.tsx&present=follow&audience=1&sid=abcd1234&x=1"
        ));
        assert!(!top(
            "http://localhost:4399/?open=d.tsx&present=follow&audience=1&audience=1"
        ));
        assert!(!top(
            "http://localhost:4399/?open=d.tsx&present=edit&audience=1&sid=abcd1234"
        ));
        assert!(!top(
            "http://localhost:4399/?open=d.tsx&present=follow&audience=0&sid=abcd1234"
        ));
        // Another origin, the canvas origin, app-local, data, remote.
        let q = "?open=d.tsx&present=follow&audience=1&sid=abcd1234";
        for base in [
            "http://localhost:4400/",
            "http://127.0.0.1:4399/",
            "http://localhost:5555/",
            "https://evil.example/",
            "tauri://localhost/",
            "http://tauri.localhost/",
        ] {
            assert!(!top(&format!("{base}{q}")), "{base}");
        }
        assert!(!top("about:blank"));
        assert!(!top("data:text/html,x"));
        assert!(
            !audience_top_level_allowed(&u(&format!("{O}/{q}")), None),
            "no entry"
        );

        let nav = |s: &str| audience_navigation_allowed(&u(s), x(), Some(C));
        assert!(nav(&follower(OPEN, SID)));
        assert!(
            nav("http://localhost:4400/_canvas-shell.html?ro=1"),
            "its canvas iframe"
        );
        assert!(nav("about:blank"));
        assert!(nav("about:srcdoc"));
        assert!(nav("blob:http://localhost:4399/0f1e"));
        assert!(nav("blob:http://localhost:4400/0f1e"));
        for refused in [
            // F5: on the project origin, only the follower root itself — a
            // main frame can't even start towards the editor or a privileged page.
            "http://localhost:4399/?open=d.tsx",
            "http://localhost:4399/",
            "http://localhost:4399/_config",
            "http://localhost:4399/_canvas-shell.html",
            &follower("other.tsx", SID),
            "tauri://localhost/index.html",
            "http://tauri.localhost/index.html",
            "data:text/html,x",
            "https://www.youtube.com/embed/x",
            "http://localhost:5555/",
            "http://127.0.0.1:4399/",
            "blob:http://localhost:5555/0f1e",
            "blob:https://www.youtube.com/0f1e",
            "file:///etc/passwd",
            "maude://open/x",
            "about:config",
        ] {
            assert!(!nav(refused), "{refused}");
        }
        // Origin split off: the canvas iframe is the project origin's shell page.
        let split_off = |s: &str| audience_navigation_allowed(&u(s), x(), None);
        assert!(split_off("http://localhost:4399/_canvas-shell.html?ro=1"));
        assert!(!split_off("http://localhost:4400/"));
        assert!(!split_off("http://localhost:4399/_config"));
        assert!(!audience_navigation_allowed(
            &u("http://localhost:4399/"),
            None,
            Some(C)
        ));
        // windows.rs never admits NavRole::Audience by the generic rules: it is
        // judged by `audience_nav_check` against its entry only.
        use crate::windows::{navigation_allowed, top_level_allowed, NavRole};
        for s in [
            "tauri://localhost/index.html",
            "data:text/html,x",
            "https://www.youtube.com/embed/x",
            "http://localhost:4399/x",
        ] {
            assert!(
                navigation_allowed(NavRole::Project, &u(s), Some(O), Some(C)),
                "{s}"
            );
            assert!(
                !navigation_allowed(NavRole::Audience, &u(s), Some(O), Some(C)),
                "{s}"
            );
        }
        assert!(!top_level_allowed(
            NavRole::Audience,
            &u(&follower(OPEN, SID)),
            Some(O)
        ));
    }

    /// No capability file — release or debug — targets an `audience-*` label,
    /// so the window gets no IPC at all; nor does the runtime Home capability.
    #[test]
    fn audience_has_no_capability() {
        fn glob(p: &[u8], s: &[u8]) -> bool {
            match p.split_first() {
                None => s.is_empty(),
                Some((b'*', rest)) => (0..=s.len()).any(|i| glob(rest, &s[i..])),
                Some((c, rest)) => s.first() == Some(c) && glob(rest, &s[1..]),
            }
        }
        let glob = |p: &str, s: &str| glob(p.as_bytes(), s.as_bytes());
        assert!(glob("p-*", "p-l0123"));
        assert!(glob("*", "audience-l0"));
        assert!(!glob("p-*", "audience-l0"));
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
        let label = audience_label("l0123456789abcdef").unwrap();
        assert_eq!(label, "audience-l0123456789abcdef");
        for p in &caps {
            let v: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
            for key in ["windows", "webviews"] {
                for pat in v[key]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|x| x.as_str())
                {
                    assert!(
                        !glob(pat, &label),
                        "{} grants `{pat}` to {label}",
                        p.display()
                    );
                }
            }
        }
        // The runtime Home capability names exactly `home`.
        let home = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/home.rs"),
        )
        .unwrap();
        assert!(home.contains(".webview(HOME_LABEL)"));
        // And it is not a project window: every caller check refuses it.
        let book = WindowBook::default();
        assert!(crate::windows::check_caller(&book, &label, Some(&u(O)), true).is_err());
        assert!(book.nav_view(&label).is_none());
    }

    #[test]
    fn it_closes_when_its_project_tab_stops_vouching() {
        let mut b = WindowBook::default();
        b.insert(
            "p-a",
            Role::Project {
                pid: "la".into(),
                root: "/a".into(),
            },
            0,
        );
        b.set_origin("p-a", O);
        b.set_canvas_origin("p-a", Some(C));
        let e = entry("p-a");
        assert!(owner_still_presents(&b, &e));
        // The server moved (a respawn on another port).
        b.set_origin("p-a", "http://localhost:4501");
        assert!(!owner_still_presents(&b, &e));
        b.set_origin("p-a", O);
        b.set_canvas_origin("p-a", Some("http://localhost:4502"));
        assert!(!owner_still_presents(&b, &e), "the canvas origin moved");
        b.set_canvas_origin("p-a", Some(C));
        assert!(owner_still_presents(&b, &e));
        // The server died: its origin no longer vouches.
        b.clear_origin("p-a");
        assert!(!owner_still_presents(&b, &e));
        b.set_origin("p-a", O);
        b.set_canvas_origin("p-a", Some(C));
        // Resting.
        assert!(b.set_resting("p-a", true));
        assert!(!owner_still_presents(&b, &e));
        b.set_resting("p-a", false);
        b.set_origin("p-a", O);
        assert!(owner_still_presents(&b, &e));
        // An in-tab switch to another project.
        assert!(b.set_project("p-a", "/b"));
        b.set_origin("p-a", O);
        b.set_canvas_origin("p-a", Some(C));
        assert!(!owner_still_presents(&b, &e));
        // The tab closed.
        b.remove("p-a");
        assert!(!owner_still_presents(&b, &e));
    }

    fn entry(owner: &str) -> AudienceEntry {
        AudienceEntry {
            owner: owner.into(),
            pid: "la".into(),
            origin: O.into(),
            canvas_origin: Some(C.into()),
            open: OPEN.into(),
            sid: SID.into(),
            display_id: "d".into(),
            display_name: "LG UltraFine".into(),
            display_pos: (1512, 0),
            generation: 0,
            window_id: 0,
        }
    }

    /// F1: End → Present again before the old window's `Destroyed` arrives.
    /// The late event must not drop the new entry, a dying window is never
    /// reused, and a watcher whose entry is gone closes, never just exits.
    #[test]
    fn a_late_destroyed_never_drops_a_newer_entry() {
        let l = "audience-la";
        let mut b = AudienceBook::default();
        let (plan, g1) = b.begin_open(l, entry("p-a"), false).unwrap();
        let OpenPlan::Build(w1) = plan else {
            panic!("first open builds")
        };
        assert_eq!(
            b.watch_step(l, g1),
            Watch::Check(Box::new(b.entry(l).unwrap().clone()))
        );
        // A move reuses the live window; the old watcher stops, the new one watches.
        let (plan, g2) = b.begin_open(l, entry("p-a"), false).unwrap();
        assert_eq!(plan, OpenPlan::Reuse(w1));
        assert_eq!(b.watch_step(l, g1), Watch::Stop);
        assert!(matches!(b.watch_step(l, g2), Watch::Check(_)));
        // End: the entry goes at once and the window is dying.
        assert!(b.closing(l).is_some());
        assert_eq!(
            b.watch_step(l, g2),
            Watch::Close,
            "an entry-less window is closed"
        );
        assert_eq!(
            b.begin_open(l, entry("p-a"), true).unwrap_err(),
            STILL_CLOSING,
            "a dying window is never reused"
        );
        // Its Destroyed arrives; now a fresh window is built.
        b.destroyed(l, w1);
        let (plan, g3) = b.begin_open(l, entry("p-a"), false).unwrap();
        let OpenPlan::Build(w2) = plan else {
            panic!("a fresh window")
        };
        assert_ne!(w1, w2);
        assert!(g3 > g2 && g2 > g1, "generations never repeat");
        // A stale Destroyed of the old instance changes nothing.
        b.destroyed(l, w1);
        assert!(matches!(b.watch_step(l, g3), Watch::Check(_)));
        assert_eq!(b.watch_step(l, g1), Watch::Stop);
        // A window the book does not track refuses the open too.
        let mut fresh = AudienceBook::default();
        assert!(fresh.begin_open(l, entry("p-a"), true).is_err());
        assert_eq!(fresh.watch_step(l, 1), Watch::Close);
    }

    /// F2: the page must declare the audience lock, and the settle loop
    /// re-asserts focus until full screen has held for two ticks.
    #[test]
    fn it_opens_only_on_a_declared_lock_and_never_keeps_the_keys() {
        assert!(check_lock(AUDIENCE_LOCK).is_ok());
        for bad in [0, 2, u32::MAX] {
            assert!(check_lock(bad).unwrap_err().starts_with("not-ready"));
        }
        // (was_fullscreen, fullscreen, focused, last) → (refocus, done)
        assert_eq!(settle_step(false, false, false, false), (false, false));
        assert_eq!(
            settle_step(false, false, true, false),
            (true, false),
            "key mid-transition"
        );
        assert_eq!(
            settle_step(false, true, true, false),
            (true, false),
            "not settled yet"
        );
        assert_eq!(
            settle_step(true, true, false, false),
            (true, true),
            "settled"
        );
        assert_eq!(
            settle_step(false, false, false, true),
            (true, true),
            "bound reached"
        );
        let src = include_str!("present.rs");
        assert!(src.contains("tauri::WindowEvent::Focused(true) =>"));
        assert!(src.contains("w.set_focusable(false)"));
        let open = &src[src.find("pub async fn present_audience_open(").unwrap()..];
        let open = &open[..open[1..].find("#[tauri::command").unwrap()];
        assert!(open.contains("check_lock(lock)?"));
        assert!(open.contains("settle("));
    }

    /// F6: the presenter's own display is refused; a resolution change on the
    /// audience display is not an unplug.
    #[test]
    fn the_display_is_matched_by_id_or_by_name_and_position() {
        let e = entry("p-a");
        assert!(same_display(&e, "d", "whatever", (0, 0)));
        assert!(
            same_display(&e, "other-id", "LG UltraFine", (1512, 0)),
            "only the size changed"
        );
        assert!(!same_display(&e, "other-id", "LG UltraFine", (0, 0)));
        assert!(!same_display(&e, "other-id", "Built-in", (1512, 0)));
        let src = include_str!("present.rs");
        let open = &src[src.find("pub async fn present_audience_open(").unwrap()..];
        assert!(open.contains("current.as_deref() == Some(display_id.as_str())"));
    }

    #[test]
    fn display_ids_are_stable_and_labels_are_plain() {
        let a = display_id("LG UltraFine", 1512, 0, 3840, 2160);
        assert_eq!(a, display_id("LG UltraFine", 1512, 0, 3840, 2160));
        assert_eq!(a.len(), 16);
        assert_ne!(
            a,
            display_id("LG UltraFine", 0, 0, 3840, 2160),
            "a second identical screen elsewhere"
        );
        assert_ne!(a, display_id("Built-in", 1512, 0, 3840, 2160));
        assert!(audience_label("").is_none());
        assert!(audience_label("l../x").is_none());
        assert!(audience_label("L01").is_none());
        assert!(is_audience_label("audience-l01"));
        assert!(!is_audience_label("p-l01"));
    }

    /// The source half (S3.6a): the three commands check their caller, the two
    /// that open or reveal something only for the tab in front, and the
    /// window is built from the guard, never with a page-chosen URL.
    #[test]
    fn the_commands_check_their_caller_and_take_no_url() {
        let src = include_str!("present.rs");
        let body = |sig: &str| -> &str {
            let i = src.find(sig).unwrap_or_else(|| panic!("{sig} not found"));
            let rest = &src[i..];
            let end = rest[1..]
                .find("#[tauri::command")
                .map_or(rest.len(), |e| e + 1);
            &rest[..end]
        };
        for (sig, front) in [
            ("pub async fn present_displays(", true),
            ("pub async fn present_audience_open(", true),
            ("pub async fn present_audience_close(", false),
        ] {
            let b = body(sig);
            assert!(b.contains("caller_project(&webview, false)"), "{sig}");
            assert_eq!(b.contains("caller_in_front(&webview)"), front, "{sig}");
        }
        let open = body("pub async fn present_audience_open(");
        let params = &open[..open.find(") -> Result").unwrap()];
        assert!(
            !params.contains("url"),
            "present_audience_open takes no URL: {params}"
        );
        assert!(open.contains("audience_url(&origin, &canvas, &sid)"));
    }
}
