// web_process.rs — recover from a WKWebView web-content-process crash (macOS).
//
// WebKit runs the page in a separate WebContent process. When that process dies
// (most often memory pressure on a heavy canvas — WebKit kills it without asking)
// WKWebView does NOT reload on its own: the window just goes white and stays
// white, with nothing in our logs. Tauri ≥ 2.11 surfaces the
// `webViewWebContentProcessDidTerminate:` delegate as
// `Builder::on_web_content_process_terminate`; this module is that hook.
//
// Recovery re-navigates instead of a bare `reload()`. The dev-server sidecar is a
// separate process and usually survives, but a bare reload re-requests whatever
// URL the window held — if that server died too and another local process took
// its loopback port, that process's page would load into the privileged
// top-level webview (security review, attacker finding 3). So the target is
// re-derived from the CURRENT project's live sidecar: the address its child
// wrote to the APP-OWNED shell info file (V2-1.1 decision 8,
// `sidecar::read_shell_origin`, DDR-109 loopback guard) — never the in-project
// `_server.json`, which an agent can rewrite with our child's pid and its own
// loopback port and so inherit the project's IPC (V2-3.6 H2). No info file ⇒
// we navigate nowhere and leave it to the sidecar supervisor, which
// re-navigates once it has respawned.
//
// A page that kills the process again on load would loop, so recoveries are
// rate-limited (`CrashGuard`): past the budget we stop and ask the user instead.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, Runtime, Url, Webview};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

use crate::sidecar::{log_line, read_shell_origin, SidecarState};

/// Automatic reloads allowed inside `WINDOW` before we stop and ask.
const MAX_AUTO_RELOADS: usize = 3;
const WINDOW: Duration = Duration::from_secs(60);

/// Sliding-window budget of automatic reloads.
struct CrashGuard {
    recent: VecDeque<Instant>,
}

impl CrashGuard {
    const fn new() -> Self {
        Self {
            recent: VecDeque::new(),
        }
    }

    /// Records a crash at `now`; true when it is still within the auto-reload budget.
    fn allow_reload(&mut self, now: Instant) -> bool {
        while let Some(&first) = self.recent.front() {
            if now.duration_since(first) >= WINDOW {
                self.recent.pop_front();
            } else {
                break;
            }
        }
        if self.recent.len() >= MAX_AUTO_RELOADS {
            return false;
        }
        self.recent.push_back(now);
        true
    }

    fn reset(&mut self) {
        self.recent.clear();
    }
}

static GUARD: Mutex<CrashGuard> = Mutex::new(CrashGuard::new());
/// One give-up dialog at a time — later crashes while it is up add nothing.
static DIALOG_OPEN: AtomicBool = AtomicBool::new(false);

/// The `on_web_content_process_terminate` hook.
pub(crate) fn on_terminate<R: Runtime>(webview: &Webview<R>) {
    // A poisoned lock must not switch the budget off (that would be the reload loop).
    let allowed = GUARD
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .allow_reload(Instant::now());

    if allowed {
        log_line(&format!(
            "[maude] web content process terminated ({}) — recovering",
            webview.label()
        ));
        recover(webview);
        return;
    }

    log_line(&format!(
        "[maude] web content process terminated {MAX_AUTO_RELOADS}× within {}s — asking before reloading again",
        WINDOW.as_secs()
    ));
    if DIALOG_OPEN.swap(true, Ordering::SeqCst) {
        return;
    }
    let webview = webview.clone();
    webview
        .app_handle()
        .dialog()
        .message(
            "Maude’s window keeps crashing — most likely a canvas that is too heavy to render. \
             Reload to try again, or close the window and reopen a lighter canvas.",
        )
        .title("Maude stopped responding")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Reload".to_string(),
            "Not now".to_string(),
        ))
        .show(move |reload| {
            DIALOG_OPEN.store(false, Ordering::SeqCst);
            if !reload {
                return;
            }
            GUARD.lock().unwrap_or_else(|p| p.into_inner()).reset();
            recover(&webview);
        });
}

/// Navigate the webview back to the current project's verified live dev-server.
fn recover<R: Runtime>(webview: &Webview<R>) {
    let Some(live) = live_server_url(webview) else {
        log_line(
            "[maude] no verified live dev-server — leaving recovery to the sidecar supervisor",
        );
        return;
    };
    let target = recovery_target(crate::webview_url::url_of(webview).as_ref(), &live);
    // The shell is navigating this window: record the origin its commands are
    // answered for (V2-3.2 `windows::check_caller`) — a respawn may have moved
    // the server to another port since the last navigate.
    if let Some(state) = webview.app_handle().try_state::<SidecarState>() {
        state
            .windows
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .set_origin(webview.label(), &live.origin().ascii_serialization());
    }
    if let Err(e) = webview.navigate(target) {
        log_line(&format!(
            "[maude] navigate after web process crash failed: {e}"
        ));
    }
}

/// The crashed window's OWN project's server url (V2-3.2: the root of this
/// webview's window role, not "the displayed project" — a background tab can
/// crash too), read from the info file of the child WE spawned for that
/// project. Never `_server.json` (V2-3.6 H2).
fn live_server_url<R: Runtime>(webview: &Webview<R>) -> Option<Url> {
    let state = webview.app_handle().try_state::<SidecarState>()?;
    let root = state
        .windows
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .root_of(webview.label())?;
    let info_file = {
        let instances = state.instances.lock().unwrap_or_else(|p| p.into_inner());
        instances
            .get(&root)
            .filter(|inst| inst.child.is_some())
            .and_then(|inst| inst.shell.as_ref())
            .map(|probe| probe.info_file.clone())
    };
    recovery_origin(info_file.as_deref())
}

/// Pure half of `live_server_url`: the loopback origin the app-owned info file
/// names (`read_shell_origin` refuses anything off loopback), or `None`. It
/// takes no project root on purpose: nothing inside the project can steer
/// where a recovered window goes.
fn recovery_origin(info_file: Option<&std::path::Path>) -> Option<Url> {
    read_shell_origin(info_file?)?.parse().ok()
}

/// Query param that tells the page it was brought back by this recovery. The
/// page's canvas crash guard (`client/v2/shell/canvas-crash-guard.js`) counts
/// a canvas left open at its death as a crash ONLY on such a load — WKWebView
/// fires no `pagehide` on an app quit, so without it every quit looked like a
/// crash (2.0.7). The page strips it from the address once read.
pub(crate) const RECOVERED_PARAM: &str = "maude-recovered";

/// Keep the user's place (path + query) when the window was already on the live
/// server's origin; otherwise go to the live server's root. Either way the
/// target carries `RECOVERED_PARAM` (once). The origin is untouched, so the
/// loopback / recorded-origin checks see exactly what they did before.
fn recovery_target(current: Option<&Url>, live: &Url) -> Url {
    let mut target = match current {
        Some(cur) if cur.origin() == live.origin() => cur.clone(),
        _ => live.clone(),
    };
    mark_recovered(&mut target);
    target
}

/// Append `RECOVERED_PARAM=1`, dropping any earlier copy (a crash before the
/// page stripped it). The rest of the query is kept byte for byte — no
/// re-encoding through `query_pairs_mut`.
fn mark_recovered(url: &mut Url) {
    let mut parts: Vec<&str> = url
        .query()
        .unwrap_or("")
        .split('&')
        .filter(|p| !p.is_empty())
        .filter(|p| p.split('=').next() != Some(RECOVERED_PARAM))
        .collect();
    let marker = format!("{RECOVERED_PARAM}=1");
    parts.push(&marker);
    let query = parts.join("&");
    url.set_query(Some(&query));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        s.parse().unwrap()
    }

    /// V2-3.6 H2: an agent rewrites the in-project `_server.json` with OUR
    /// child's pid and its own loopback port. Recovery must not follow it.
    #[test]
    fn recovery_ignores_a_planted_server_json() {
        let project = std::env::temp_dir().join(format!(
            "maude-webproc-planted-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
        ));
        std::fs::create_dir_all(project.join(".design")).unwrap();
        std::fs::write(
            project.join(".design/_server.json"),
            format!(
                r#"{{"pid":{},"port":6666,"url":"http://localhost:6666"}}"#,
                std::process::id()
            ),
        )
        .unwrap();
        let info = project.join("app-owned-info.json");
        std::fs::write(&info, r#"{"url":"http://localhost:4403","port":4403}"#).unwrap();
        assert_eq!(recovery_origin(Some(&info)), Some(url("http://localhost:4403")));
        // No app-owned info file (not spawned by us, or retired) ⇒ nowhere,
        // however plausible `_server.json` looks.
        assert_eq!(recovery_origin(None), None);
        // DDR-109 holds for the app-owned file too.
        std::fs::write(&info, r#"{"url":"http://attacker.tld"}"#).unwrap();
        assert_eq!(recovery_origin(Some(&info)), None);
        let _ = std::fs::remove_dir_all(&project);
    }

    #[test]
    fn recovery_keeps_the_place_only_on_the_live_origin() {
        let live = url("http://localhost:4403/");
        let here = url("http://localhost:4403/ui/foo?open=a.tsx");
        assert_eq!(
            recovery_target(Some(&here), &live),
            url("http://localhost:4403/ui/foo?open=a.tsx&maude-recovered=1")
        );
        // Window was on a stale port (dead server, maybe squatted) → live root.
        let stale = url("http://localhost:4399/ui/foo");
        let root = url("http://localhost:4403/?maude-recovered=1");
        assert_eq!(recovery_target(Some(&stale), &live), root);
        assert_eq!(recovery_target(None, &live), root);
    }

    /// 2.0.7: the page counts a canvas crash only when it was brought back by
    /// this recovery (`canvas-crash-guard.js`), so the target always carries
    /// the marker — once, with the rest of the path, query (byte for byte) and
    /// fragment kept, and still on the live loopback origin.
    #[test]
    fn recovery_marks_the_navigation_and_keeps_the_rest() {
        let live = url("http://localhost:4403/");
        let here = url("http://localhost:4403/p/x?open=ui%2FDeck.tsx&artboard-live=light#a b");
        let t = recovery_target(Some(&here), &live);
        assert_eq!(t.path(), "/p/x");
        assert_eq!(
            t.query(),
            Some("open=ui%2FDeck.tsx&artboard-live=light&maude-recovered=1")
        );
        assert_eq!(t.fragment(), here.fragment());
        assert_eq!(t.origin(), live.origin());
        assert!(crate::server_json::is_loopback_url(&t));
        // A crash before the page stripped the marker does not stack a second one.
        let again = recovery_target(Some(&t), &live);
        assert_eq!(again, t);
        let only = url("http://localhost:4403/?maude-recovered=1");
        assert_eq!(recovery_target(Some(&only), &live), only);
        assert_eq!(
            recovery_target(
                Some(&url("http://localhost:4403/?maude-recovered=1&open=a")),
                &live
            )
            .query(),
            Some("open=a&maude-recovered=1")
        );
    }

    #[test]
    fn allows_the_budget_then_refuses() {
        let mut g = CrashGuard::new();
        let t0 = Instant::now();
        for i in 0..MAX_AUTO_RELOADS {
            assert!(g.allow_reload(t0 + Duration::from_secs(i as u64)));
        }
        assert!(!g.allow_reload(t0 + Duration::from_secs(10)));
    }

    #[test]
    fn crashes_outside_the_window_do_not_count() {
        let mut g = CrashGuard::new();
        let t0 = Instant::now();
        for i in 0..MAX_AUTO_RELOADS {
            assert!(g.allow_reload(t0 + Duration::from_secs(i as u64)));
        }
        // Once the earliest crash ages out, one slot frees up again.
        assert!(g.allow_reload(t0 + WINDOW));
        assert!(!g.allow_reload(t0 + WINDOW + Duration::from_millis(500)));
    }

    #[test]
    fn reset_restores_the_full_budget() {
        let mut g = CrashGuard::new();
        let t0 = Instant::now();
        for _ in 0..MAX_AUTO_RELOADS {
            g.allow_reload(t0);
        }
        assert!(!g.allow_reload(t0));
        g.reset();
        assert!(g.allow_reload(t0));
    }
}
