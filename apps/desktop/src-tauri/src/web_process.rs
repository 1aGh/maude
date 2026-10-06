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
// re-derived from the CURRENT project's live sidecar: `_server.json` must name
// the pid of the child we spawned, and its url must pass the DDR-109 loopback
// guard. No verified server ⇒ we navigate nowhere and leave it to the sidecar
// supervisor, which re-navigates once it has respawned.
//
// A page that kills the process again on load would loop, so recoveries are
// rate-limited (`CrashGuard`): past the budget we stop and ask the user instead.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, Runtime, Url, Webview};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

use crate::server_json::{is_loopback_url, read_server_pid_url};
use crate::sidecar::{log_line, SidecarState};

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
    let target = recovery_target(webview.url().ok().as_ref(), &live);
    if let Err(e) = webview.navigate(target) {
        log_line(&format!(
            "[maude] navigate after web process crash failed: {e}"
        ));
    }
}

/// The current project's server url — only when `_server.json` names the pid of
/// the sidecar child WE spawned for that project and the url is loopback.
fn live_server_url<R: Runtime>(webview: &Webview<R>) -> Option<Url> {
    let state = webview.app_handle().try_state::<SidecarState>()?;
    let root = state
        .project_root
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone();
    let child_pid = {
        let instances = state.instances.lock().unwrap_or_else(|p| p.into_inner());
        instances.get(&root)?.child.as_ref()?.pid()
    };
    let design_root = std::path::Path::new(&root).join(".design");
    let (pid, url) = read_server_pid_url(&design_root)?;
    verified_url(pid, child_pid, &url)
}

/// Pure half of `live_server_url`: pid must match our child, url must be loopback.
fn verified_url(file_pid: u32, child_pid: u32, url: &str) -> Option<Url> {
    if file_pid != child_pid {
        return None;
    }
    let parsed: Url = url.parse().ok()?;
    is_loopback_url(&parsed).then_some(parsed)
}

/// Keep the user's place (path + query) when the window was already on the live
/// server's origin; otherwise go to the live server's root.
fn recovery_target(current: Option<&Url>, live: &Url) -> Url {
    match current {
        Some(cur) if cur.origin() == live.origin() => cur.clone(),
        _ => live.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        s.parse().unwrap()
    }

    #[test]
    fn verified_url_requires_our_pid_and_loopback() {
        assert_eq!(
            verified_url(42, 42, "http://localhost:4403"),
            Some(url("http://localhost:4403"))
        );
        // Another process wrote the file or now owns the port.
        assert_eq!(verified_url(43, 42, "http://localhost:4403"), None);
        // DDR-109: never off loopback, even with a matching pid.
        assert_eq!(verified_url(42, 42, "http://attacker.tld"), None);
        assert_eq!(verified_url(42, 42, "-K/tmp/x"), None);
    }

    #[test]
    fn recovery_keeps_the_place_only_on_the_live_origin() {
        let live = url("http://localhost:4403/");
        let here = url("http://localhost:4403/ui/foo?open=a.tsx");
        assert_eq!(recovery_target(Some(&here), &live), here);
        // Window was on a stale port (dead server, maybe squatted) → live root.
        let stale = url("http://localhost:4399/ui/foo");
        assert_eq!(recovery_target(Some(&stale), &live), live);
        assert_eq!(recovery_target(None, &live), live);
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
