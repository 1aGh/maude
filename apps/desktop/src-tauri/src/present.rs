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
// - **Its own navigation guard** (`NavRole::Audience`, windows.rs `nav_check`):
//   the top frame only on the recorded project origin, path `/`, query keys
//   exactly {open, present, sid, audience}; subframes on that origin, the
//   project's canvas origin, `about:blank`/`about:srcdoc` and a `blob:` of
//   either. Nothing app-local, no `data:`, no remote https.
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
/// control character, `\` or `:`, at most 1024 bytes.
pub fn valid_canvas(canvas: &str) -> bool {
    if canvas.len() > MAX_CANVAS_LEN
        || !canvas.ends_with(".tsx")
        || canvas.len() == ".tsx".len()
        || canvas
            .chars()
            .any(|c| c.is_control() || c == '\\' || c == ':')
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

/// The audience window's MAIN frame: only the follower root on the recorded
/// project origin — path `/`, query keys exactly {open, present, sid,
/// audience}, each once, with valid values. Nothing app-local (the window
/// has no splash), no other path, no other origin.
pub fn audience_top_level_allowed(url: &tauri::Url, origin: Option<&str>) -> bool {
    let Some(origin) = origin else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https")
        || url.origin().ascii_serialization() != origin
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
    AUDIENCE_QUERY_KEYS.iter().all(|k| get(k).is_some())
        && get("present") == Some("follow")
        && get("audience") == Some("1")
        && get("sid").is_some_and(valid_sid)
        && get("open").is_some_and(valid_canvas)
}

/// Every navigation of the audience window (WKWebView asks for subframes too
/// and does not say which frame): the recorded project origin, the project's
/// canvas origin, `about:blank` / `about:srcdoc`, and a `blob:` minted by
/// either. `audience_top_level_allowed` narrows the main frame.
pub fn audience_navigation_allowed(
    url: &tauri::Url,
    origin: Option<&str>,
    canvas: Option<&str>,
) -> bool {
    let Some(origin) = origin else {
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
    o == origin || canvas == Some(o.as_str())
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
    pub display_id: String,
    /// Bumped on every (re)open, so a superseded watcher stops.
    pub generation: u64,
}

/// Audience windows by label. Never held across a webview call (those wait on
/// the main thread, which takes this lock in the navigation guard).
static AUDIENCE: Mutex<Option<HashMap<String, AudienceEntry>>> = Mutex::new(None);

fn with_book<T>(f: impl FnOnce(&mut HashMap<String, AudienceEntry>) -> T) -> T {
    let mut g = AUDIENCE.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(HashMap::new))
}

fn entry_of(label: &str) -> Option<AudienceEntry> {
    with_book(|b| b.get(label).cloned())
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

/// What an audience window's navigations are judged against (windows.rs
/// `nav_check`): its pinned origins, but only while its project tab still
/// vouches for them. `None` refuses every navigation.
pub fn nav_view<R: Runtime>(app: &AppHandle<R>, label: &str) -> Option<(String, Option<String>)> {
    let entry = entry_of(label)?;
    let state = app.try_state::<SidecarState>()?;
    let ok = owner_still_presents(
        &state.windows.lock().unwrap_or_else(|e| e.into_inner()),
        &entry,
    );
    ok.then_some((entry.origin, entry.canvas_origin))
}

/// Close (and forget) an audience window. Idempotent.
pub fn close_audience<R: Runtime>(app: &AppHandle<R>, label: &str, why: &str) {
    if !is_audience_label(label) {
        return;
    }
    let had = with_book(|b| b.remove(label)).is_some();
    if let Some(w) = app.get_webview_window(label) {
        if let Err(e) = w.destroy() {
            crate::sidecar::log_line(&format!("[maude] could not close {label}: {e}"));
        }
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
/// `display_id`. Rust builds the URL from the caller's recorded origin; the
/// window opens unfocused, so the presenter keeps the keys.
#[tauri::command]
pub async fn present_audience_open(
    webview: tauri::Webview,
    display_id: String,
    canvas: String,
    sid: String,
) -> Result<(), String> {
    let caller = caller_project(&webview, false)?;
    caller_in_front(&webview)?;
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
    let monitor = app
        .available_monitors()
        .map_err(|e| format!("Couldn't list displays: {e}"))?
        .into_iter()
        .find(|m| monitor_id(m) == display_id)
        .ok_or_else(|| "That display isn't connected any more.".to_string())?;

    // Record first: the window's very first navigation meets the guard.
    let generation = with_book(|b| {
        let generation = b.get(&label).map_or(0, |e| e.generation + 1);
        b.insert(
            label.clone(),
            AudienceEntry {
                owner: caller.label.clone(),
                pid: caller.pid.clone(),
                origin,
                canvas_origin,
                display_id: display_id.clone(),
                generation,
            },
        );
        generation
    });

    let placed = match app.get_webview_window(&label) {
        Some(w) => place(&w, &monitor).and_then(|()| {
            if w.url().ok().as_ref() == Some(&url) {
                Ok(())
            } else {
                w.navigate(url.clone()).map_err(|e| e.to_string())
            }
        }),
        None => build(&app, &label, url, &monitor),
    };
    if let Err(e) = placed {
        close_audience(&app, &label, "it could not open");
        return Err(format!("Couldn't open the audience window: {e}"));
    }
    // Keys stay with the presenter.
    let _ = webview.window().set_focus();
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
    let forget = label.to_string();
    window.on_window_event(move |e| {
        if matches!(e, tauri::WindowEvent::Destroyed) {
            with_book(|b| b.remove(&forget));
        }
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

/// Re-check every `WATCH_EVERY` while the window is open: its display still
/// connected, its project tab still vouching for it. Either gone → close.
/// A reopen bumps `generation`, which stops this watcher (the new one runs).
fn watch(app: AppHandle, label: String, generation: u64) {
    std::thread::spawn(move || loop {
        std::thread::sleep(WATCH_EVERY);
        let Some(entry) = entry_of(&label) else {
            return;
        };
        if entry.generation != generation {
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
            if !monitors.iter().any(|m| monitor_id(m) == entry.display_id) {
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

    #[test]
    fn the_url_is_built_from_the_recorded_origin_never_an_argument() {
        let url = audience_url(O, "ui/deck.tsx", "abcd1234").unwrap();
        assert_eq!(
            url.as_str(),
            "http://localhost:4399/?open=ui%2Fdeck.tsx&present=follow&audience=1&sid=abcd1234"
        );
        assert!(
            audience_top_level_allowed(&url, Some(O)),
            "the built URL passes its own guard"
        );
        // The canvas can't smuggle another path, origin or key into the URL.
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
        ] {
            assert!(audience_url(O, canvas, "abcd1234").is_err(), "{canvas:?}");
        }
        let encoded = audience_url(O, "ui/a&present=x.tsx", "abcd1234").unwrap();
        assert!(
            audience_top_level_allowed(&encoded, Some(O)),
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
        let top = |s: &str| audience_top_level_allowed(&u(s), Some(O));
        assert!(top(
            "http://localhost:4399/?open=ui%2Fdeck.tsx&present=follow&audience=1&sid=abcd1234"
        ));
        assert!(top(
            "http://localhost:4399/?sid=abcd1234&audience=1&present=follow&open=deck.tsx"
        ));
        // Another page of the project, an extra / missing / repeated key, a bad value.
        assert!(!top("http://localhost:4399/?open=ui%2Fdeck.tsx"));
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
        assert!(!top(
            "http://localhost:4399/?open=d.tsx&present=follow&audience=1&sid=BAD"
        ));
        assert!(!top(
            "http://localhost:4399/?open=_draw%2Fx.tsx&present=follow&audience=1&sid=abcd1234"
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
            "no recorded origin"
        );

        let nav = |s: &str| audience_navigation_allowed(&u(s), Some(O), Some(C));
        assert!(nav("http://localhost:4399/?open=d.tsx"));
        assert!(
            nav("http://localhost:4400/_canvas-shell.html?ro=1"),
            "its canvas iframe"
        );
        assert!(nav("about:blank"));
        assert!(nav("about:srcdoc"));
        assert!(nav("blob:http://localhost:4399/0f1e"));
        assert!(nav("blob:http://localhost:4400/0f1e"));
        for refused in [
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
        assert!(!audience_navigation_allowed(
            &u("http://localhost:4400/"),
            Some(O),
            None
        ));
        assert!(!audience_navigation_allowed(
            &u("http://localhost:4399/"),
            None,
            Some(C)
        ));
        // windows.rs dispatches NavRole::Audience here: no app-local splash, no
        // data:, no remote https — what a project tab may load.
        use crate::windows::{navigation_allowed, top_level_allowed, NavRole};
        for s in [
            "tauri://localhost/index.html",
            "data:text/html,x",
            "https://www.youtube.com/embed/x",
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
        assert!(top_level_allowed(
            NavRole::Project,
            &u("http://localhost:4399/x"),
            Some(O)
        ));
        assert!(!top_level_allowed(
            NavRole::Audience,
            &u("http://localhost:4399/x"),
            Some(O)
        ));
        assert!(!top_level_allowed(
            NavRole::Audience,
            &u("tauri://localhost/index.html"),
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
        let e = AudienceEntry {
            owner: "p-a".into(),
            pid: "la".into(),
            origin: O.into(),
            canvas_origin: Some(C.into()),
            display_id: "d".into(),
            generation: 0,
        };
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
