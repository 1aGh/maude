//! Idle rest (Maude 2.0.4, decision `v2-michal-running-cap-3-rest-15min`): a project tab nobody has
//! used for `IDLE_REST_AFTER` (15 min) rests — its server stops and the tab shows the splash until
//! focus wakes it, exactly like a tab the running cap rested (`windows::rest_window`).
//!
//! **Idle**, from signals the shell already has:
//! - the tab is not the active one (`WindowBook::front_label`). The active tab never rests by idling,
//!   even with the app in the background for hours — it is the page the person comes back to;
//! - and it has not been in use for `IDLE_REST_AFTER`. "In use" = the active tab, or a server that
//!   answers busy on `GET /_api/shell/status` (AI running or awaiting, unsent changes, an export or
//!   generation job — `ShellStatus::busy`, the same check the cap uses), or whose status could not be
//!   read, or that is still booting. The clock restarts at every such moment, at every focus change
//!   that touches the tab (`touch_focus_change`) and at every sweep that sees it in use;
//! - so a busy tab NEVER rests: a busy answer restarts its clock, and the 15 minutes count from the
//!   moment it stopped being busy.
//!
//! A sweep every `SWEEP_EVERY` probes the background tabs (outside every lock) and rests the ones
//! whose clock ran out. Windowless instances are not this policy's: the pool's own grace reaps them.

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::sidecar::{ShellStatus, SidecarState};

/// How long a background tab may sit unused before it rests (Michal, 2026-11-04).
pub const IDLE_REST_AFTER: Duration = Duration::from_secs(15 * 60);

/// How often the background tabs are looked at. A tab rests between 15 and 16 minutes after its
/// last use; one status probe per background tab per minute.
const SWEEP_EVERY: Duration = Duration::from_secs(60);

/// The idle threshold in force. Debug builds honour `MAUDE_E2E_IDLE_REST_SECS` (as the cap honours
/// `MAUDE_E2E_RUNNING_CAP`), so a desktop e2e can reach an idle rest in seconds; a release build
/// never reads it.
pub(crate) fn idle_rest_after() -> Duration {
    #[cfg(debug_assertions)]
    if let Some(n) = std::env::var("MAUDE_E2E_IDLE_REST_SECS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|n| *n >= 1)
    {
        return Duration::from_secs(n);
    }
    IDLE_REST_AFTER
}

/// What one sweep knows about one running project.
#[derive(Clone, Debug)]
pub struct IdleView {
    pub root: String,
    /// Its tab; `None` = windowless (not this policy's).
    pub label: Option<String>,
    /// It is the active tab.
    pub front: bool,
    /// Its `/_api/shell/status` answer; `None` = could not be read (counts as in use).
    pub status: Option<ShellStatus>,
    /// No address in its info file yet (counts as in use).
    pub booting: bool,
}

impl IdleView {
    fn in_use(&self) -> bool {
        self.front || self.booting || self.status.as_ref().is_none_or(|s| s.busy())
    }
}

/// Per project root: the last moment it was seen in use. Pure — the clock is passed in.
#[derive(Debug, Default)]
pub struct IdleBook {
    seen: HashMap<String, Instant>,
}

impl IdleBook {
    /// `root` was in use at `now` (a focus change touched its tab).
    pub fn touch(&mut self, root: &str, now: Instant) {
        self.seen.insert(root.to_string(), now);
    }

    /// One sweep: restart the clock of every project in use, start it for one seen idle for the
    /// first time, and return `(root, label)` for every tab whose clock has run `after` or more.
    /// Roots no longer running are forgotten.
    pub fn sweep(
        &mut self,
        now: Instant,
        views: Vec<IdleView>,
        after: Duration,
    ) -> Vec<(String, String)> {
        self.seen
            .retain(|root, _| views.iter().any(|v| &v.root == root));
        let mut rest = Vec::new();
        for v in views {
            if v.in_use() {
                self.seen.insert(v.root, now);
                continue;
            }
            let since = *self.seen.entry(v.root.clone()).or_insert(now);
            if let Some(label) = v.label {
                if now.saturating_duration_since(since) >= after {
                    rest.push((v.root, label));
                }
            }
        }
        rest
    }
}

/// Managed state: the one `IdleBook`.
pub struct IdleRestState(pub Mutex<IdleBook>);

/// The active tab changed from `prev` to `next` (roots of project tabs; `None` for Home or a cell):
/// both were in use until now. Called from `windows::on_focused`; a no-op before the sweep starts.
pub fn touch_focus_change(app: &AppHandle, prev: Option<&str>, next: Option<&str>) {
    let Some(state) = app.try_state::<IdleRestState>() else {
        return;
    };
    let now = Instant::now();
    let mut book = state.0.lock().unwrap_or_else(|e| e.into_inner());
    for root in [prev, next].into_iter().flatten() {
        book.touch(root, now);
    }
}

/// Start the sweep. Call once from `setup`, after `SidecarState` is managed.
pub fn spawn_idle_rest(app: &AppHandle) {
    app.manage(IdleRestState(Mutex::new(IdleBook::default())));
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(sweep_every()).await;
            let state = app.state::<SidecarState>();
            if state.shutting_down.load(Ordering::SeqCst) {
                break;
            }
            sweep_once(&app).await;
        }
    });
}

fn sweep_every() -> Duration {
    // An e2e threshold of a few seconds needs a sweep at least as often.
    SWEEP_EVERY.min(idle_rest_after())
}

async fn sweep_once(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    let running: Vec<String> = {
        let pool = state.instances.lock().unwrap_or_else(|e| e.into_inner());
        pool.iter()
            .filter(|(_, inst)| inst.child.is_some())
            .map(|(root, _)| root.clone())
            .collect()
    };
    if running.is_empty() {
        return;
    }
    let mut views: Vec<IdleView> = {
        let book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
        let front = book.front_label();
        running
            .iter()
            .map(|root| {
                let label = book.label_for_root(root);
                IdleView {
                    front: label.is_some() && label == front,
                    root: root.clone(),
                    label,
                    status: None,
                    booting: false,
                }
            })
            .collect()
    };
    // Probed OUTSIDE every lock (as `enforce_cap` does): an HTTP round trip must not stall a switch.
    for v in views.iter_mut() {
        if v.front || v.label.is_none() {
            continue;
        }
        // #206: a live terminal lease is in use (status stays unknown = in use).
        if crate::cli_channel::leased(&v.root) {
            continue;
        }
        v.booting = crate::sidecar::shell_origin(app, &v.root).is_none();
        if !v.booting {
            v.status = crate::sidecar::shell_status(app, &v.root).await;
        }
    }
    let picks = {
        let Some(idle) = app.try_state::<IdleRestState>() else {
            return;
        };
        let mut book = idle.0.lock().unwrap_or_else(|e| e.into_inner());
        book.sweep(Instant::now(), views, idle_rest_after())
    };
    for (root, label) in picks {
        // The person may have switched to it while the probes ran: look again under the lock.
        let still_idle = {
            let book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
            book.front_label().as_deref() != Some(label.as_str())
                && !book.is_resting(&label)
                && book.root_of(&label).as_deref() == Some(root.as_str())
        };
        if !still_idle {
            continue;
        }
        crate::sidecar::log_line(&format!(
            "[maude] {label} unused for {} min — resting {root}",
            idle_rest_after().as_secs() / 60
        ));
        crate::windows::rest_window(app, &label, &root);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::AiCounts;

    fn idle_status() -> Option<ShellStatus> {
        Some(ShellStatus::default())
    }

    fn view(root: &str, front: bool, status: Option<ShellStatus>) -> IdleView {
        IdleView {
            root: root.to_string(),
            label: Some(format!("p-{root}")),
            front,
            status,
            booting: false,
        }
    }

    const MIN: Duration = Duration::from_secs(60);

    #[test]
    fn the_threshold_is_fifteen_minutes() {
        assert_eq!(IDLE_REST_AFTER, Duration::from_secs(15 * 60));
        if std::env::var("MAUDE_E2E_IDLE_REST_SECS").is_err() {
            assert_eq!(idle_rest_after(), IDLE_REST_AFTER);
        }
    }

    #[test]
    fn a_background_idle_tab_rests_after_fifteen_minutes_not_before() {
        let t0 = Instant::now();
        let mut book = IdleBook::default();
        book.touch("a", t0); // it lost focus at t0
        assert!(book
            .sweep(
                t0 + 14 * MIN,
                vec![view("a", false, idle_status())],
                IDLE_REST_AFTER
            )
            .is_empty());
        let picks = book.sweep(
            t0 + 15 * MIN,
            vec![view("a", false, idle_status())],
            IDLE_REST_AFTER,
        );
        assert_eq!(picks, vec![("a".to_string(), "p-a".to_string())]);
    }

    #[test]
    fn the_active_tab_never_rests() {
        let t0 = Instant::now();
        let mut book = IdleBook::default();
        book.touch("a", t0);
        for m in [15, 60, 600] {
            assert!(book
                .sweep(
                    t0 + m * MIN,
                    vec![view("a", true, idle_status())],
                    IDLE_REST_AFTER
                )
                .is_empty());
        }
    }

    #[test]
    fn a_busy_tab_never_rests_and_its_clock_restarts_when_it_stops() {
        let t0 = Instant::now();
        let mut book = IdleBook::default();
        book.touch("a", t0);
        let busy = [
            ShellStatus {
                ai: AiCounts {
                    running: 1,
                    awaiting: 0,
                },
                ..Default::default()
            },
            ShellStatus {
                ai: AiCounts {
                    running: 0,
                    awaiting: 1,
                },
                ..Default::default()
            },
            ShellStatus {
                unsent: 2,
                ..Default::default()
            },
            ShellStatus {
                jobs: 1,
                ..Default::default()
            },
        ];
        for (i, s) in busy.iter().enumerate() {
            let at = t0 + (20 + 30 * i as u32) * MIN;
            assert!(
                book.sweep(at, vec![view("a", false, Some(s.clone()))], IDLE_REST_AFTER)
                    .is_empty(),
                "{s:?}"
            );
        }
        // last seen busy at t0+110 min: idle from there, rests 15 min later — not at once
        let last_busy = t0 + 110 * MIN;
        assert!(book
            .sweep(
                last_busy + 14 * MIN,
                vec![view("a", false, idle_status())],
                IDLE_REST_AFTER
            )
            .is_empty());
        assert_eq!(
            book.sweep(
                last_busy + 15 * MIN,
                vec![view("a", false, idle_status())],
                IDLE_REST_AFTER
            )
            .len(),
            1
        );
    }

    #[test]
    fn unknown_status_or_booting_counts_as_in_use() {
        let t0 = Instant::now();
        let mut book = IdleBook::default();
        book.touch("a", t0);
        book.touch("b", t0);
        let mut booting = view("b", false, None);
        booting.booting = true;
        assert!(book
            .sweep(
                t0 + 30 * MIN,
                vec![view("a", false, None), booting],
                IDLE_REST_AFTER
            )
            .is_empty());
    }

    #[test]
    fn a_focus_change_restarts_the_clock() {
        let t0 = Instant::now();
        let mut book = IdleBook::default();
        book.touch("a", t0);
        // the person glanced at it between two sweeps (never front at a sweep)
        book.touch("a", t0 + 10 * MIN);
        assert!(book
            .sweep(
                t0 + 16 * MIN,
                vec![view("a", false, idle_status())],
                IDLE_REST_AFTER
            )
            .is_empty());
        assert_eq!(
            book.sweep(
                t0 + 25 * MIN,
                vec![view("a", false, idle_status())],
                IDLE_REST_AFTER
            )
            .len(),
            1
        );
    }

    #[test]
    fn a_tab_first_seen_idle_starts_its_clock_then() {
        let t0 = Instant::now();
        let mut book = IdleBook::default();
        assert!(book
            .sweep(t0, vec![view("a", false, idle_status())], IDLE_REST_AFTER)
            .is_empty());
        assert!(book
            .sweep(
                t0 + 14 * MIN,
                vec![view("a", false, idle_status())],
                IDLE_REST_AFTER
            )
            .is_empty());
        assert_eq!(
            book.sweep(
                t0 + 15 * MIN,
                vec![view("a", false, idle_status())],
                IDLE_REST_AFTER
            )
            .len(),
            1
        );
    }

    #[test]
    fn windowless_instances_are_not_this_policys() {
        let t0 = Instant::now();
        let mut book = IdleBook::default();
        let mut v = view("a", false, idle_status());
        v.label = None;
        book.touch("a", t0);
        assert!(book
            .sweep(t0 + 60 * MIN, vec![v], IDLE_REST_AFTER)
            .is_empty());
    }

    #[test]
    fn a_root_that_stopped_running_is_forgotten() {
        let t0 = Instant::now();
        let mut book = IdleBook::default();
        book.touch("a", t0);
        book.sweep(t0 + MIN, vec![], IDLE_REST_AFTER);
        // back later (woken, focused, left): its old clock must not rest it at once
        assert!(book
            .sweep(
                t0 + 30 * MIN,
                vec![view("a", false, idle_status())],
                IDLE_REST_AFTER
            )
            .is_empty());
    }
}
