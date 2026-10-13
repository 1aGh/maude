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

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, EventTarget, Manager};

use crate::windows::HOME_LABEL;

/// Parked links, one per window label. A window takes only its own, once.
#[derive(Default)]
pub struct PendingDeepLink(pub Mutex<HashMap<String, String>>);

impl PendingDeepLink {
    /// Park `url` for `label`. A newer link for the same window replaces the
    /// older one still unread there — the client's own dialog never swaps a
    /// link the person is already reading (CloudBar keeps the first).
    pub fn park(&self, label: &str, url: &str) {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(label.to_string(), url.to_string());
    }

    pub fn take(&self, label: &str) -> Option<String> {
        self.0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(label)
    }
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
    for (k, v) in parsed.query_pairs() {
        if k == "open" {
            if canvas.is_some() {
                return None;
            }
            canvas = Some(crate::project_resolve::validate_open_param(&v)?);
        }
    }
    let artboard = parsed
        .fragment()
        .filter(|a| !a.is_empty())
        .map(|a| {
            crate::windows::validate_target(crate::windows::OpenTarget {
                canvas: None,
                artboard: Some(a.to_string()),
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

pub fn plan_route(url: &str, resolve: impl Fn(&str) -> Option<String>) -> LinkRoute {
    match parse_link(url) {
        Some(address) => match resolve(&address.project) {
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

fn route_now(app: &AppHandle, url: &str) {
    let st = crate::app_state::load(app);
    let route = plan_route(url, |p| crate::project_resolve::resolve_known(&st, p));
    let mut existing = false;
    let label = deliver_label(&route, |root| {
        let LinkRoute::Project { address, .. } = &route else {
            unreachable!("deliver_label opens only a project route")
        };
        crate::windows::open_window_for_root(app, root, None, address.canvas.as_deref()).map(|o| {
            existing = matches!(o, crate::windows::Opened::Existing(_));
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
    if let Some(state) = app.try_state::<PendingDeepLink>() {
        state.park(&label, &payload);
    }
    let target = || EventTarget::AnyLabel {
        label: label.clone(),
    };
    let _ = app.emit_to(target(), "maude://deep-link", payload);
    // A NEW window gets the canvas as its first navigate's `?open=` (the
    // open_project path); an existing one is told where to go.
    if let (true, Some(t)) = (existing, navigate) {
        let _ = app.emit_to(target(), "shell://navigate", t);
    }
}

/// One-shot consume of the link parked for the CALLING window — a re-mounted
/// panel cannot re-ask a question the person already answered, and no window
/// can read a link that was routed to another.
#[tauri::command]
pub fn take_pending_deep_link(
    state: tauri::State<'_, PendingDeepLink>,
    webview: tauri::Webview,
) -> Option<String> {
    state.take(webview.label())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolver(p: &str) -> Option<String> {
        (p == "alligators").then(|| "/work/alligators".to_string())
    }

    #[test]
    fn deep_link_a_known_project_routes_to_its_window_with_canvas_and_artboard() {
        let r = plan_route("maude://open/alligators?open=ui/Hero.tsx#cover", resolver);
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
            let r = plan_route(url, resolver);
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
        let r = plan_route(&format!("maude://open/alligators?code={code}"), resolver);
        let LinkRoute::Project { address, .. } = r else {
            panic!()
        };
        assert_eq!(address.canvas, None);
        assert_eq!(address.url, format!("maude://open/alligators?code={code}"));
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
}
