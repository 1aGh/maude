// web_process.rs — recover from a WKWebView web-content-process crash (macOS).
//
// WebKit runs the page in a separate WebContent process. When that process dies
// (most often memory pressure on a heavy canvas — WebKit kills it without asking)
// WKWebView does NOT reload on its own: the window just goes white and stays
// white, with nothing in our logs. Tauri ≥ 2.11 surfaces the
// `webViewWebContentProcessDidTerminate:` delegate as
// `Builder::on_web_content_process_terminate`; this module is that hook.
//
// Recovery is a plain `reload()` — the dev-server sidecar is a separate process
// and survives, so the page comes back at the same URL. A page that kills the
// process again on load would turn that into a reload loop, so reloads are
// rate-limited (`CrashGuard`): past the budget we stop and ask the user instead.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, Runtime, Webview};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

use crate::sidecar::log_line;

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
            "[maude] web content process terminated ({}) — reloading",
            webview.label()
        ));
        if let Err(e) = webview.reload() {
            log_line(&format!(
                "[maude] reload after web process crash failed: {e}"
            ));
        }
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
            if let Err(e) = webview.reload() {
                log_line(&format!(
                    "[maude] reload after web process crash failed: {e}"
                ));
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

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
