// deep_link.rs — the maude:// protocol handler (Cloud Phase 17 T1/T2; routed
// per window since V2-3.5, contract V2-1.1 §5.2 "Deep link").
//
// The scheme registers at INSTALL time from the bundle (tauri.conf.json
// `plugins.deep-link.desktop.schemes` → Info.plist / registry), so a `tauri
// dev` run never receives one — only the bundled .app does. Links arrive two
// ways: macOS delivers through the plugin's on_open_url; Windows/Linux relaunch
// the binary with the URL in argv, which single-instance forwards here.
//
// TRUST POSTURE: a deep link is an UNTRUSTED string — any web page can
// navigate to maude://. The shell only ROUTES and PARKS it:
//   - `maude://open/<project>…` naming a project this machine remembers
//     (`project_resolve::resolve_known` — registry, recent, last) goes to THAT
//     project's window: its tab is focused if open, else opened as a new tab
//     (`windows::open_window_for_root`, the same open-once path as Home). The
//     link is parked for that window's label only and the event goes to that
//     window only (`emit_to`), plus `shell://navigate {canvas, artboard}`.
//   - anything else (an unknown project, a link we cannot read) goes to Home —
//     created if absent — never to whichever project happens to be in front.
// The client still decides what the link does: a connect code is only ever
// exchanged after the person presses Connect, against the app's own configured
// Maude Cloud address; a file link opens a file that exists in the loaded tree.
// Nothing from the link is put in a URL query by this module (§5.8 item 8) and
// no window is navigated anywhere but through the DDR-109 loopback guard
// (§5.8 item 7).

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::windows::HOME_LABEL;

/// Parked links, one per window label. A window takes only its own, once —
/// and only while it shows the project it was parked for: everything parked
/// for a label dies with the window AND with an in-tab switch
/// (`windows::drop_parked_for`, V2-3.6 N-M5).
pub struct PendingDeepLink(crate::windows::Parked<String>);

impl Default for PendingDeepLink {
    fn default() -> Self {
        Self::new()
    }
}

impl PendingDeepLink {
    pub const fn new() -> Self {
        PendingDeepLink(crate::windows::Parked::new())
    }

    /// Park `url` for `label`. A newer link for the same window replaces the
    /// older one still unread there — the client's own dialog never swaps a
    /// link the person is already reading (CloudBar keeps the first).
    pub fn park(&self, label: &str, url: &str) {
        self.0.park(label, url.to_string());
    }

    pub fn take(&self, label: &str) -> Option<String> {
        self.0.take(label)
    }
}

/// THE parked links (a static like every other parked value, so
/// `drop_parked_for` can clear it without an `AppHandle`).
pub static PENDING_LINKS: PendingDeepLink = PendingDeepLink::new();

// ── S6.7: the sign-in nudges and the invite link (contract S6-S9 §5.1 step 8) ──
//
// `maude://auth/done?state=<s>` / `maude://auth/cancelled?state=<s>` are rendered
// by the cloud's device page for Home's own sign-in. Any web page can fire them,
// so they carry NOTHING but the attempt's `state` and are only nudges: Rust
// passes one to Home (`auth://return {kind, state}`) only when `state` is the
// live attempt's (`profiles::home_auth_nudge` — single use, TTL); a forged, an
// old, a replayed or a malformed one is dropped silently (no Home focus, no
// note). `maude://invite/<id>` goes to Home only — never a project window — and
// is parked for it (`take_pending_invite`): Home peeks it and decides which
// profile opens it (S6.11). Neither kind ever carries an e-mail, a token or a
// project name, and neither opens a project by itself.

/// The longest auth / invite link the shell reads (both are fixed-size).
const MAX_SPECIAL_LINK: usize = 128;

/// The invite id parked for Home (one slot; a newer link replaces it).
pub static PENDING_INVITES: crate::windows::Parked<String> = crate::windows::Parked::new();

/// Invite links that may bring Home to the front per `LINK_OPEN_WINDOW`
/// (any page can fire one; past the budget they are dropped).
const MAX_INVITE_LINKS: usize = 5;
static INVITE_LINKS: Mutex<crate::profiles::Budget> = Mutex::new(crate::profiles::Budget::new());

/// Which sign-in nudge a link is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthKind {
    Done,
    Cancelled,
}

/// A `maude://` link the shell handles itself rather than routing to a project.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Special {
    /// `maude://auth/{done,cancelled}?state=<32 lowercase hex>`.
    Auth { kind: AuthKind, state: String },
    /// `maude://invite/<36 chars of [0-9a-f-]>` (one trailing `/` tolerated).
    Invite(String),
    /// An `auth` / `invite` link of any other shape — dropped, never shown.
    Malformed,
    /// Not one of these: the V2-3.5 routing (`plan_route`).
    No,
}

/// Classify a link. The grammar is matched on the RAW string, not a parsed URL,
/// so no percent-decoding, case folding or normalisation can turn a junk link
/// into a valid one: the host must be exactly `auth` / `invite` in lowercase
/// (any other casing of those names is Malformed), with no query besides the
/// one `state`, no fragment, no userinfo, no port.
pub fn special_link(url: &str) -> Special {
    let Some(rest) = url.strip_prefix("maude://") else {
        return Special::No;
    };
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let host = &rest[..host_end];
    let is = |name: &str| host.eq_ignore_ascii_case(name);
    if !is("auth") && !is("invite") {
        return Special::No;
    }
    if url.len() > MAX_SPECIAL_LINK || host.bytes().any(|b| b.is_ascii_uppercase()) {
        return Special::Malformed;
    }
    let tail = &rest[host_end..];
    if host == "auth" {
        let parsed = tail
            .strip_prefix("/done?state=")
            .map(|s| (AuthKind::Done, s))
            .or_else(|| tail.strip_prefix("/cancelled?state=").map(|s| (AuthKind::Cancelled, s)));
        return match parsed {
            Some((kind, state)) if crate::profiles::valid_signin_state(state) => Special::Auth {
                kind,
                state: state.to_string(),
            },
            _ => Special::Malformed,
        };
    }
    let id = tail.strip_prefix('/').map(|t| t.strip_suffix('/').unwrap_or(t));
    match id {
        Some(id) if crate::profiles::valid_invite_id(id) => Special::Invite(id.to_string()),
        _ => Special::Malformed,
    }
}

/// Where a special link ends: Home, or nowhere. Pure, so "never a project
/// window" is a test. `nudge`: the attempt book's verdict on an auth state.
pub fn special_label(s: &Special, nudge: impl FnOnce(&str) -> bool) -> Option<&'static str> {
    match s {
        Special::Auth { state, .. } => nudge(state).then_some(HOME_LABEL),
        Special::Invite(_) => Some(HOME_LABEL),
        Special::Malformed | Special::No => None,
    }
}

/// Deliver a special link (Home only). Returns false for `Special::No`, which
/// the caller routes as before.
fn deliver_special(app: &AppHandle, url: &str) -> bool {
    let special = special_link(url);
    if special == Special::No {
        return false;
    }
    let invite_ok = || {
        INVITE_LINKS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .allow(MAX_INVITE_LINKS, LINK_OPEN_WINDOW, Instant::now())
    };
    let label = match &special {
        Special::Invite(_) if !invite_ok() => None,
        s => special_label(s, crate::profiles::home_auth_nudge),
    };
    let Some(label) = label else {
        // Silently: no Home focus, no note — the person did nothing here.
        crate::sidecar::log_line("[maude] deep link: dropped an auth/invite link");
        return true;
    };
    if let Err(e) = crate::home::ensure_home_window(app, None) {
        crate::sidecar::log_line(&format!("[maude] deep link: could not open Home: {e}"));
    }
    match special {
        Special::Auth { kind, state } => {
            crate::bus::send(label, "auth://return", serde_json::json!({ "kind": kind, "state": state }));
        }
        Special::Invite(id) => {
            PENDING_INVITES.park(label, id.clone());
            crate::bus::send(label, "invite://open", serde_json::json!({ "id": id }));
        }
        Special::Malformed | Special::No => {}
    }
    crate::sidecar::log_line(&format!("[maude] deep link routed to {label}"));
    true
}

/// `take_pending_invite()` — Home only: the invite id a `maude://invite/<id>`
/// link parked for Home (the link that launched the app, or one Home missed),
/// once. A project window never reads it.
#[tauri::command]
pub fn take_pending_invite(webview: tauri::Webview) -> Result<Option<String>, String> {
    crate::home::caller_home(&webview, false)?;
    Ok(PENDING_INVITES.take(HOME_LABEL))
}

/// What a `maude://` link names, as far as ROUTING needs to know. The client
/// re-validates the whole link (`parseDeepLink` / `parseFileDeepLink`).
#[derive(Clone, Debug, PartialEq)]
pub struct LinkAddress {
    pub project: String,
    /// A file link's designRoot-relative canvas (`?open=`), validated.
    pub canvas: Option<String>,
    /// `#<artboard>`, a short plain id.
    pub artboard: Option<String>,
    /// The link as the client receives it: the fragment is stripped (the
    /// client's file-link grammar has none — the artboard rides in
    /// `shell://navigate` instead).
    pub url: String,
    /// It carries a `?code=` (a connect link, V2-3.5): routed by the app's
    /// own hub binding only (N-M4).
    pub connect: bool,
    /// S1.18 — a stable canvas link's kernel entry (`?c=`), validated. Such a
    /// link names no path and travels to the window as `url` only (the client
    /// resolves the entry against its own server): `canvas` and `artboard`
    /// stay None, so no `shell://navigate` aims it at whatever canvas is open.
    pub entry: Option<String>,
}

/// The kernel's entry grammar (kernel.mjs `TX_ID`).
fn valid_entry(e: &str) -> bool {
    (8..=128).contains(&e.len())
        && e.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// A comment id (S9.7 comments/ops.ts `ID_RE`).
fn valid_comment(m: &str) -> bool {
    (1..=64).contains(&m.len()) && m.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// Strict `%XX` decoding of a URL fragment; None on a malformed escape or
/// bytes that are not UTF-8.
fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let (hi, lo) = (*b.get(i + 1)?, *b.get(i + 2)?);
            if !hi.is_ascii_hexdigit() || !lo.is_ascii_hexdigit() {
                return None;
            }
            out.push(u8::from_str_radix(std::str::from_utf8(&[hi, lo]).ok()?, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// S1.18 — the `#<artboardId>` anchor of a canvas link: decoded once, then the
/// kernel's artboard grammar (kernel.mjs `ARTBOARD_ID`: 1–128 characters, no
/// `/`, no control characters). An anchor that fails is dropped — the canvas
/// still opens, framed as it was.
pub fn link_anchor(fragment: Option<&str>) -> Option<String> {
    let a = percent_decode(fragment.filter(|f| !f.is_empty())?)?;
    let n = a.chars().count();
    ((1..=128).contains(&n) && !a.chars().any(|c| c == '/' || c.is_control())).then_some(a)
}

/// Parse `maude://open/<project>[/]?<query>[#<artboard>]`. `None` = a link
/// this shell cannot route to a project (it goes to Home).
pub fn parse_link(url: &str) -> Option<LinkAddress> {
    if !url.starts_with("maude://open/") || url.len() > 4096 {
        return None;
    }
    let parsed = tauri::Url::parse(url).ok()?;
    if parsed.host_str() != Some("open") {
        return None;
    }
    let project = parsed.path().trim_start_matches('/').trim_end_matches('/');
    if !crate::project_resolve::valid_project(project) {
        return None;
    }
    let mut canvas = None;
    let mut connect = false;
    let mut entry: Option<String> = None;
    let mut comment: Option<String> = None;
    let mut other = false;
    for (k, v) in parsed.query_pairs() {
        match k.as_ref() {
            "code" => connect = true,
            "open" => {
                if canvas.is_some() {
                    return None;
                }
                canvas = Some(crate::project_resolve::validate_open_param(&v)?);
            }
            "c" => {
                if entry.is_some() || !valid_entry(&v) {
                    return None;
                }
                entry = Some(v.into_owned());
            }
            "m" => {
                // Twice is as bad as an unknown key (only a canvas link reads it).
                other |= comment.is_some();
                comment = Some(v.into_owned());
            }
            _ => other = true,
        }
    }
    // S1.18 — a canvas link carries ids only: its entry, an optional comment
    // id, the `#<artboard>` anchor. Nothing else rides along (no path, no
    // code, no key the client might read), and the window gets a link this
    // module rebuilt from the validated parts, never the bytes that arrived.
    if let Some(entry) = entry {
        if canvas.is_some() || connect || other {
            return None;
        }
        if comment.as_deref().is_some_and(|m| !valid_comment(m)) {
            return None;
        }
        let mut out = tauri::Url::parse(&format!("maude://open/{project}")).ok()?;
        {
            let mut q = out.query_pairs_mut();
            q.append_pair("c", &entry);
            if let Some(a) = link_anchor(parsed.fragment()) {
                q.append_pair("a", &a);
            }
            if let Some(m) = &comment {
                q.append_pair("m", m);
            }
        }
        return Some(LinkAddress {
            project: project.to_string(),
            canvas: None,
            artboard: None,
            url: out.to_string(),
            connect: false,
            entry: Some(entry),
        });
    }
    let artboard = parsed
        .fragment()
        .filter(|a| !a.is_empty())
        .map(|a| {
            crate::windows::validate_target(crate::windows::OpenTarget {
                canvas: None,
                artboard: Some(a.to_string()),
                thread: None,
                via: None,
            })
            .ok()
            .and_then(|t| t.artboard)
        })
        .unwrap_or(None);
    let url = url.split('#').next().unwrap_or(url).to_string();
    Some(LinkAddress {
        project: project.to_string(),
        canvas,
        artboard,
        url,
        connect,
        entry: None,
    })
}

/// Where a link goes. Pure, so the routing rule is testable.
#[derive(Clone, Debug, PartialEq)]
pub enum LinkRoute {
    /// A remembered project: its window (focused, or opened as a new tab).
    Project { root: String, address: LinkAddress },
    /// Home, with the raw link for its calm "can't open that here" note.
    Home { url: String },
}

/// `resolve`: any remembered folder (file links). `resolve_connect`: only the
/// folder the app itself bound to that hub — a connect link's one-shot code
/// goes there or to Home, never to a folder that merely claims the hub in its
/// own committed config (V2-3.6 N-M4).
pub fn plan_route(
    url: &str,
    resolve: impl Fn(&str) -> Option<String>,
    resolve_connect: impl Fn(&str) -> Option<String>,
) -> LinkRoute {
    match parse_link(url) {
        Some(address) => match if address.connect {
            resolve_connect(&address.project)
        } else {
            resolve(&address.project)
        } {
            Some(root) => LinkRoute::Project { root, address },
            None => LinkRoute::Home { url: address.url },
        },
        None => LinkRoute::Home {
            url: url.split('#').next().unwrap_or(url).to_string(),
        },
    }
}

/// The window label a route ends in. `open` opens/focuses a project window and
/// returns its label; a failure (the folder is gone, a build error) falls back
/// to Home rather than to a random project window.
pub fn deliver_label(
    route: &LinkRoute,
    open: impl FnOnce(&str) -> Result<String, String>,
) -> String {
    match route {
        LinkRoute::Project { root, .. } => open(root).unwrap_or_else(|_| HOME_LABEL.to_string()),
        LinkRoute::Home { .. } => HOME_LABEL.to_string(),
    }
}

/// Route a maude:// URL to its window, park it there and tell that window
/// only. Safe to call before the windows exist: routing waits (bounded) for
/// the shell state, and the client also polls `take_pending_deep_link` on
/// boot, which is how a link that launched the app gets consumed.
pub fn accept(app: &AppHandle, url: &str) {
    if !url.starts_with("maude://") {
        return;
    }
    let app = app.clone();
    let url = url.to_string();
    tauri::async_runtime::spawn(async move {
        // The launch-path link can beat `setup` managing the window book.
        for _ in 0..100 {
            if app.try_state::<crate::sidecar::SidecarState>().is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if app.try_state::<crate::sidecar::SidecarState>().is_none() {
            return;
        }
        route_now(&app, &url);
    });
}

/// Link-driven NEW tabs allowed inside `LINK_OPEN_WINDOW` (V2-3.6 L1). Any web
/// page can fire `maude://open/<slug>`, and a new tab spawns a server; past
/// the budget a link for a closed project goes to Home (its note offers the
/// open) instead of spawning. Focusing an already-open tab is never limited.
const MAX_LINK_OPENS: usize = 3;
const LINK_OPEN_WINDOW: Duration = Duration::from_secs(60);

/// Sliding-window budget of link-driven tab opens. Pure, so it is testable.
pub struct LinkOpenBudget {
    recent: VecDeque<Instant>,
}

impl LinkOpenBudget {
    pub const fn new() -> Self {
        Self {
            recent: VecDeque::new(),
        }
    }

    /// Records an open at `now`; false once the window's budget is spent.
    pub fn allow(&mut self, now: Instant) -> bool {
        while let Some(&first) = self.recent.front() {
            if now.duration_since(first) >= LINK_OPEN_WINDOW {
                self.recent.pop_front();
            } else {
                break;
            }
        }
        if self.recent.len() >= MAX_LINK_OPENS {
            return false;
        }
        self.recent.push_back(now);
        true
    }
}

static LINK_OPENS: Mutex<LinkOpenBudget> = Mutex::new(LinkOpenBudget::new());

/// What `take_link_opened` answers: the project a link opened as a NEW tab
/// (its "Opened <name> from a link." toast — the page did not exist yet when
/// the link arrived, so it is parked like `take_tabs_restored`).
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct LinkOpened {
    pub name: String,
}

pub static LINK_OPENED: crate::windows::Parked<LinkOpened> = crate::windows::Parked::new();

/// `take_link_opened()` — the link-open note parked for THIS window, once.
#[tauri::command]
pub fn take_link_opened(webview: tauri::Webview) -> Result<Option<LinkOpened>, String> {
    let caller = crate::windows::caller_project(&webview, false)?;
    Ok(LINK_OPENED.take(&caller.label))
}

fn route_now(app: &AppHandle, url: &str) {
    // S6.7: sign-in nudges and invites go to Home or nowhere — before any
    // project resolution, so neither can reach (or open) a project window.
    if deliver_special(app, url) {
        return;
    }
    let st = crate::app_state::load(app);
    let legacy = crate::managed::bound_copies(app);
    let mut route = plan_route(
        url,
        |p| crate::project_resolve::resolve_known(&st, p),
        |p| crate::project_resolve::resolve_connect(&st, &legacy, p),
    );
    // L1: a closed project costs a server; over the budget, Home decides.
    if let LinkRoute::Project { root, address } = &route {
        let open = crate::windows::label_for_root(app, root).is_some();
        let allowed = open
            || LINK_OPENS
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .allow(Instant::now());
        if !allowed {
            crate::sidecar::log_line(&format!(
                "[maude] deep link: {MAX_LINK_OPENS} link-opened tabs in {}s — sending this one to Home",
                LINK_OPEN_WINDOW.as_secs()
            ));
            route = LinkRoute::Home {
                url: address.url.clone(),
            };
        }
    }
    let mut existing = false;
    let label = deliver_label(&route, |root| {
        let LinkRoute::Project { address, .. } = &route else {
            unreachable!("deliver_label opens only a project route")
        };
        crate::windows::open_window_for_root(app, root, None, address.canvas.as_deref()).map(|o| {
            existing = matches!(o, crate::windows::Opened::Existing(_));
            if let crate::windows::Opened::New(label) = &o {
                LINK_OPENED.park(
                    label,
                    LinkOpened {
                        name: crate::windows::project_display_name(root),
                    },
                );
            }
            // A NEW tab's `?open=` carries the canvas only; the artboard is
            // parked for it (`take_pending_navigate`).
            crate::windows::park_navigate_for_new(
                &o,
                Some(&crate::windows::OpenTarget {
                    canvas: address.canvas.clone(),
                    artboard: address.artboard.clone(),
                    thread: None,
                    via: None,
                }),
            );
            o.label().to_string()
        })
    });
    let (payload, navigate) = match &route {
        LinkRoute::Project { address, .. } if label != HOME_LABEL => (
            address.url.clone(),
            (address.canvas.is_some() || address.artboard.is_some()).then(|| {
                crate::windows::OpenTarget {
                    canvas: address.canvas.clone(),
                    artboard: address.artboard.clone(),
                    thread: None,
                    via: None,
                }
            }),
        ),
        LinkRoute::Project { address, .. } => (address.url.clone(), None),
        LinkRoute::Home { url } => (url.clone(), None),
    };
    if label == HOME_LABEL {
        if let Err(e) = crate::home::ensure_home_window(app, None) {
            crate::sidecar::log_line(&format!("[maude] deep link: could not open Home: {e}"));
        }
    }
    crate::sidecar::log_line(&format!("[maude] deep link routed to {label}"));
    PENDING_LINKS.park(&label, &payload);
    // That window's own channel only (bus.rs, finding 1d).
    crate::bus::send(&label, "maude://deep-link", &payload);
    // A NEW window gets the canvas as its first navigate's `?open=` (the
    // open_project path); an existing one is told where to go.
    if let (true, Some(t)) = (existing, navigate) {
        crate::bus::send(&label, "shell://navigate", t);
    }
}

/// One-shot consume of the link parked for the CALLING window — a re-mounted
/// panel cannot re-ask a question the person already answered, and no window
/// can read a link that was routed to another. The caller is the window's
/// label ON its recorded origin (Home: the Home origin) — a page that took
/// the window's top frame elsewhere reads nothing (N-M5).
#[tauri::command]
pub fn take_pending_deep_link(webview: tauri::Webview) -> Result<Option<String>, String> {
    let label = match crate::windows::caller_any(&webview, false)? {
        crate::windows::Caller::Home => HOME_LABEL.to_string(),
        crate::windows::Caller::Project(c) => c.label,
    };
    Ok(PENDING_LINKS.take(&label))
}

/// Debug-only e2e helper (V2-3.6 M5): deliver a `maude://` link to the CALLING
/// window exactly as `route_now` delivers one routed there — parked for its
/// label, `maude://deep-link` emitted to it only. Scenarios used to fake this
/// with a page-side `event.emit`, which pages can no longer do. Granted only by
/// capabilities/debug/e2e-webdriver.json; a release build answers Err.
#[tauri::command]
pub fn e2e_deliver_deep_link(webview: tauri::Webview, url: String) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        crate::windows::caller_any(&webview, false)?;
        if !url.starts_with("maude://") {
            return Err("not a maude:// link".into());
        }
        let label = webview.label().to_string();
        PENDING_LINKS.park(&label, &url);
        crate::bus::send(&label, "maude://deep-link", url);
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (webview, url);
        Err("debug builds only".into())
    }
}

/// Debug-only e2e helper (S6.7): run a `maude://` link through the REAL routing
/// (`route_now`) as if the OS had delivered it — unlike `e2e_deliver_deep_link`,
/// which hands it to the calling window. Lets a scenario prove that an invite
/// fired while a project tab is in front lands on Home, and that a forged
/// sign-in nudge reaches nobody. Granted only by
/// capabilities/debug/e2e-webdriver.json; a release build answers Err.
#[tauri::command]
pub fn e2e_route_deep_link(app: AppHandle, webview: tauri::Webview, url: String) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        crate::windows::caller_any(&webview, false)?;
        if !url.starts_with("maude://") {
            return Err("not a maude:// link".into());
        }
        route_now(&app, &url);
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (app, webview, url);
        Err("debug builds only".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATE: &str = "0123456789abcdef0123456789abcdef";

    /// S6.7 (contract S6-S9 §5.1 step 8, §5.6): the sign-in nudges carry the
    /// state only, in one exact shape; anything else is dropped, never shown.
    /// A forged / replayed / stale state reaches nobody; the live one reaches
    /// Home once.
    #[test]
    fn deep_link_auth_state() {
        assert_eq!(
            special_link(&format!("maude://auth/done?state={STATE}")),
            Special::Auth { kind: AuthKind::Done, state: STATE.into() }
        );
        assert_eq!(
            special_link(&format!("maude://auth/cancelled?state={STATE}")),
            Special::Auth { kind: AuthKind::Cancelled, state: STATE.into() }
        );
        let long = format!("maude://auth/done?state={STATE}{}", "0".repeat(200));
        for bad in [
            "maude://auth",
            "maude://auth/",
            "maude://auth/done",
            "maude://auth/done?state=",
            "maude://auth/done?state=0123456789ABCDEF0123456789ABCDEF",
            "maude://auth/done?state=0123456789abcdef0123456789abcde",
            "maude://auth/done?state=0123456789abcdef0123456789abcdef0",
            "maude://auth/done?state=%30123456789abcdef0123456789abcde",
            "maude://auth/done?state=0123456789abcdef0123456789abcdef&token=mpt_x",
            "maude://auth/done?email=a@b.cz&state=0123456789abcdef0123456789abcdef",
            "maude://auth/done?state=0123456789abcdef0123456789abcdef#x",
            "maude://auth/done/?state=0123456789abcdef0123456789abcdef",
            "maude://auth/signed-in?state=0123456789abcdef0123456789abcdef",
            "maude://AUTH/done?state=0123456789abcdef0123456789abcdef",
            "maude://auth/Done?state=0123456789abcdef0123456789abcdef",
            "maude://auth/done?State=0123456789abcdef0123456789abcdef",
            &long,
        ] {
            assert_eq!(special_link(bad), Special::Malformed, "{bad}");
            assert_eq!(special_label(&special_link(bad), |_| panic!("no nudge for {bad}")), None);
        }
        // The attempt book decides: a forged state reaches nobody.
        let forged = special_link(&format!("maude://auth/done?state={}", "f".repeat(32)));
        assert_eq!(special_label(&forged, |_| false), None);
        let live = special_link(&format!("maude://auth/cancelled?state={STATE}"));
        assert_eq!(special_label(&live, |s| s == STATE), Some(HOME_LABEL));
        // Through the real book: once, and only after Home opened the page.
        let t0 = Instant::now();
        let mut book = crate::profiles::HomeSignInBook::default();
        assert!(!book.nudge(STATE, t0), "no attempt yet: a cold-start nudge is dropped");
        book.prepare(crate::profiles::HomePrepared {
            profile: "default".into(),
            fresh: false,
            invite: None,
            at: t0,
        });
        book.open(STATE, t0).unwrap();
        assert_eq!(special_label(&live, |s| book.nudge(s, t0)), Some(HOME_LABEL));
        assert_eq!(special_label(&live, |s| book.nudge(s, t0)), None, "replayed");
        // Not a special link: the V2-3.5 routing.
        for other in ["maude://open/alligators?open=ui/A.tsx", "maude://connect?code=x", "maude://authx/done", "https://auth/done"] {
            assert_eq!(special_link(other), Special::No, "{other}");
        }
        // The payload Home hears is the kind and the state, nothing else.
        let wire = serde_json::json!({ "kind": AuthKind::Cancelled, "state": STATE }).to_string();
        assert_eq!(wire, format!(r#"{{"kind":"cancelled","state":"{STATE}"}}"#));
    }

    /// S6.7: an invite link goes to Home only — never a project window, whatever
    /// tab is in front and whatever the project resolver knows — and only Home
    /// can take it.
    #[test]
    fn invite_link_to_home() {
        let id = "0b6f3d4e-1c2a-4b5d-8e9f-0123456789ab";
        for url in [format!("maude://invite/{id}"), format!("maude://invite/{id}/")] {
            let s = special_link(&url);
            assert_eq!(s, Special::Invite(id.into()), "{url}");
            assert_eq!(special_label(&s, |_| panic!("an invite is no nudge")), Some(HOME_LABEL));
        }
        for bad in [
            "maude://invite",
            "maude://invite/",
            "maude://invite/not-an-id",
            "maude://invite/0B6F3D4E-1C2A-4B5D-8E9F-0123456789AB",
            "maude://invite/0b6f3d4e-1c2a-4b5d-8e9f-0123456789ab?email=a@b.cz",
            "maude://invite/0b6f3d4e-1c2a-4b5d-8e9f-0123456789ab#poster",
            "maude://invite/0b6f3d4e-1c2a-4b5d-8e9f-0123456789ab/alligators",
            "maude://invite/../../0b6f3d4e-1c2a-4b5d-8e9f-0123456789",
            "maude://Invite/0b6f3d4e-1c2a-4b5d-8e9f-0123456789ab",
        ] {
            assert_eq!(special_link(bad), Special::Malformed, "{bad}");
        }
        // The V2-3.5 router would never send one to a project either.
        let r = plan_route(&format!("maude://invite/{id}"), |_| Some("/work/a".into()), |_| Some("/work/a".into()));
        assert!(matches!(r, LinkRoute::Home { .. }), "{r:?}");
        // Parked for Home: a project tab's takes read nothing.
        PENDING_INVITES.park(HOME_LABEL, id.to_string());
        assert_eq!(PENDING_INVITES.take("p-front"), None);
        assert_eq!(PENDING_LINKS.take(HOME_LABEL), None, "not a deep-link note");
        assert_eq!(PENDING_INVITES.take(HOME_LABEL).as_deref(), Some(id));
        assert_eq!(PENDING_INVITES.take(HOME_LABEL), None, "one-shot");
        // take_pending_invite is Home's: label + Home origin (home::check_home).
        let src = include_str!("deep_link.rs");
        let body = &src[src.find("pub fn take_pending_invite(").unwrap()..];
        assert!(body[..body.find("\n}\n").unwrap()].contains("caller_home(&webview, false)?"));
    }

    /// V2-3.6 L1: a burst of links for closed projects opens at most
    /// `MAX_LINK_OPENS` tabs per window of time; the budget refills.
    #[test]
    fn link_spawns_are_capped_per_minute() {
        let mut b = LinkOpenBudget::new();
        let t0 = Instant::now();
        for i in 0..MAX_LINK_OPENS {
            assert!(b.allow(t0 + Duration::from_secs(i as u64)), "open {i}");
        }
        assert!(!b.allow(t0 + Duration::from_secs(5)), "over the budget");
        assert!(!b.allow(t0 + Duration::from_secs(30)));
        // The first open ages out: one more is allowed, then refused again.
        assert!(b.allow(t0 + LINK_OPEN_WINDOW));
        assert!(!b.allow(t0 + LINK_OPEN_WINDOW + Duration::from_millis(1)));
    }

    fn resolver(p: &str) -> Option<String> {
        (p == "alligators").then(|| "/work/alligators".to_string())
    }

    #[test]
    fn deep_link_a_known_project_routes_to_its_window_with_canvas_and_artboard() {
        let r = plan_route(
            "maude://open/alligators?open=ui/Hero.tsx#cover",
            resolver,
            |_| None,
        );
        let LinkRoute::Project { root, address } = &r else {
            panic!("expected a project route, got {r:?}")
        };
        assert_eq!(root, "/work/alligators");
        assert_eq!(address.canvas.as_deref(), Some("ui/Hero.tsx"));
        assert_eq!(address.artboard.as_deref(), Some("cover"));
        assert_eq!(address.url, "maude://open/alligators?open=ui/Hero.tsx");
        assert_eq!(deliver_label(&r, |_| Ok("p-abc".to_string())), "p-abc");
        // The folder vanished between resolve and open: Home, not a random tab.
        assert_eq!(deliver_label(&r, |_| Err("gone".to_string())), HOME_LABEL);
    }

    #[test]
    fn deep_link_an_unknown_or_unreadable_link_goes_home() {
        for url in [
            "maude://open/not-on-this-machine?open=ui/Smoke.tsx",
            "maude://open/../etc?open=a",
            "maude://open/alligators?open=../../secret",
            "maude://open/alligators?open=a&open=b",
            "maude://connect?code=mhc_00",
            "maude://",
        ] {
            let r = plan_route(url, resolver, resolver);
            assert!(matches!(r, LinkRoute::Home { .. }), "{url} → {r:?}");
            assert_eq!(
                deliver_label(&r, |_| panic!("must not open")),
                HOME_LABEL,
                "{url}"
            );
        }
    }

    #[test]
    fn deep_link_a_connect_link_routes_by_its_project_without_a_canvas() {
        let code = format!("mhc_{}", "a".repeat(64));
        let link = format!("maude://open/alligators?code={code}");
        let r = plan_route(&link, resolver, resolver);
        let LinkRoute::Project { address, .. } = r else {
            panic!()
        };
        assert_eq!(address.canvas, None);
        assert!(address.connect);
        assert_eq!(address.url, link);
        // N-M4: a folder that only CLAIMS the hub (the general resolver) gets
        // no code — with no app-owned binding the link goes to Home.
        let r = plan_route(&link, resolver, |_| None);
        assert!(matches!(r, LinkRoute::Home { .. }), "{r:?}");
        // A file link is not a connect link.
        let r = plan_route("maude://open/alligators?open=ui/A.tsx", resolver, |_| None);
        assert!(matches!(&r, LinkRoute::Project { address, .. } if !address.connect));
    }

    #[test]
    fn deep_link_payload_is_parked_for_the_target_window_only() {
        let parked = PendingDeepLink::default();
        parked.park("p-abc", "maude://open/alligators?open=ui/A.tsx");
        assert_eq!(parked.take("p-other"), None, "another tab cannot read it");
        assert_eq!(parked.take(HOME_LABEL), None);
        assert_eq!(
            parked.take("p-abc").as_deref(),
            Some("maude://open/alligators?open=ui/A.tsx")
        );
        assert_eq!(parked.take("p-abc"), None, "one-shot");
    }

    fn entry_route(url: &str) -> LinkAddress {
        match plan_route(url, resolver, |_| None) {
            LinkRoute::Project { address, .. } => address,
            r => panic!("{url} → {r:?}"),
        }
    }

    /// S1.18: a canvas link names ids only. The window gets a link rebuilt
    /// from the validated entry / anchor / comment; no canvas path, and no
    /// artboard for `shell://navigate` to aim at whatever canvas is open.
    #[test]
    fn deep_link_anchor_an_entry_link_carries_ids_only() {
        let a = entry_route("maude://open/alligators?c=n_abc12345#pozvanka-story");
        assert_eq!(a.entry.as_deref(), Some("n_abc12345"));
        assert_eq!((a.canvas.as_deref(), a.artboard.as_deref()), (None, None));
        assert!(!a.connect);
        assert_eq!(
            a.url,
            "maude://open/alligators?c=n_abc12345&a=pozvanka-story"
        );
        // The comment id rides along; no anchor → no `a`.
        let a = entry_route("maude://open/alligators/?c=n_abc12345&m=c_7Ab#story");
        assert_eq!(
            a.url,
            "maude://open/alligators?c=n_abc12345&a=story&m=c_7Ab"
        );
        let a = entry_route("maude://open/alligators?c=n_abc12345");
        assert_eq!(a.url, "maude://open/alligators?c=n_abc12345");
    }

    #[test]
    fn deep_link_anchor_is_decoded_once_then_held_to_the_artboard_grammar() {
        // Encoded once on the way in, re-encoded by us on the way out.
        let a = entry_route("maude://open/alligators?c=n_abc12345#story%20A");
        assert_eq!(a.url, "maude://open/alligators?c=n_abc12345&a=story+A");
        let a = entry_route("maude://open/alligators?c=n_abc12345#p%C5%99%C3%ADb%C4%9Bh");
        assert_eq!(
            link_anchor(Some("p%C5%99%C3%ADb%C4%9Bh")).as_deref(),
            Some("příběh")
        );
        assert!(a.url.ends_with("&a=p%C5%99%C3%ADb%C4%9Bh"), "{}", a.url);
        // `%2525` decodes ONCE to `%25`, never to `%`.
        assert_eq!(link_anchor(Some("x%2525")).as_deref(), Some("x%25"));
        // A bad anchor is dropped; the canvas still opens.
        let long = "a".repeat(129);
        for bad in [
            "a/b",
            "a%2Fb",
            "%00x",
            "x%0A",
            "%ZZ",
            "%+1x",
            "%C3",
            "",
            long.as_str(),
        ] {
            assert_eq!(link_anchor(Some(bad)), None, "{bad}");
            let a = entry_route(&format!("maude://open/alligators?c=n_abc12345#{bad}"));
            assert_eq!(a.url, "maude://open/alligators?c=n_abc12345", "{bad}");
        }
        assert_eq!(
            link_anchor(Some(&"a".repeat(128))).map(|a| a.len()),
            Some(128)
        );
    }

    #[test]
    fn deep_link_anchor_a_malformed_entry_link_goes_home() {
        for url in [
            "maude://open/alligators?c=short",
            "maude://open/alligators?c=../../etc/x",
            "maude://open/alligators?c=n_has%20space0",
            &format!("maude://open/alligators?c={}", "a".repeat(129)),
            "maude://open/alligators?c=n_abc12345&c=n_abc67890",
            // ids only: no path, no code, no URL, no key the client might read
            "maude://open/alligators?c=n_abc12345&open=ui/A.tsx",
            "maude://open/alligators?c=n_abc12345&code=mhc_aa",
            "maude://open/alligators?c=n_abc12345&a=story",
            "maude://open/alligators?c=n_abc12345&next=https://evil.example",
            "maude://open/alligators?c=n_abc12345&m=a-b",
            "maude://open/alligators?c=n_abc12345&m=",
            "maude://open/alligators?c=n_abc12345&m=a&m=b",
            "maude://open/Alligators?c=n_abc12345",
            // a known entry for a project this Mac does not know
            "maude://open/not-on-this-machine?c=n_abc12345",
        ] {
            let r = plan_route(url, resolver, resolver);
            assert!(matches!(r, LinkRoute::Home { .. }), "{url} → {r:?}");
            assert_eq!(deliver_label(&r, |_| panic!("must not open")), HOME_LABEL);
        }
        // `m` outside a canvas link stays what it was: ignored.
        let r = plan_route(
            "maude://open/alligators?open=ui/A.tsx&m=a&m=b",
            resolver,
            |_| None,
        );
        assert!(matches!(r, LinkRoute::Project { .. }), "{r:?}");
    }
}
