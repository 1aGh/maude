// quit.rs — S5.14: quitting while AI is working asks first, then stops and keeps
// what AI finished (V2-1.15 §5.9, decision A5, 03 `ai-quit`).
//
//   ⌘Q (Maude ▸ Quit, a native item now — AppKit's predefined `terminate:` cannot
//   be held) → probe every running project's own studio `GET /_api/ai/runs` →
//   nothing live: stop-all + exit. Live → the project tab with AI shows the
//   dialog "Quit while AI is working?" (QuitDialog.jsx) → Quit → every project's
//   `POST /_api/ai/runs/stop-all {reason:'quit'}` in parallel (each studio
//   cancels, publishes the partial version, releases the leases and writes
//   "Stopped when the app quit", ≤ 5 s) → `app.exit(0)` → `kill_server`.
//   A second ⌘Q while the dialog is open quits (stop-all, then exit); a third
//   exits now.
//
// Security (V2-3.6 threat list; the hand-back carries the self-review):
//   - The shell decides, the page only answers. Live counts come from each
//     project's OWN studio over the authenticated probe — the address from the
//     app-owned info file and the per-spawn token (sidecar.rs), never a URL a page
//     names. Stop-all goes to every running project, whatever a page answered,
//     so no page can declare "quit allowed" for another project or skip its stop.
//   - An answer counts only from the webview that was asked (its own label,
//     `caller_project`) with the round's nonce; anything else is refused.
//   - A page cannot hold quit forever: no "shown" ack in ACK_TIMEOUT → the native
//     dialog takes over; a cancel no person could have given (before "shown", or
//     inside FAST_ANSWER) distrusts the page, so the next ⌘Q asks natively; and a
//     second ⌘Q always quits. Every network step is bounded (PROBE_TIMEOUT,
//     STOP_ALL_TIMEOUT).
//   - An exit that skipped this flow (the Dock's Quit, logout, an update
//     restart: `RunEvent::Exit`) still stops the runs, bounded by LAST_CHANCE.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

use crate::sidecar::SidecarState;

/// The Maude ▸ Quit item's id (menu.rs builds it in place of AppKit's predefined one).
pub const MENU_QUIT: &str = "quit";
/// The shell → page message that opens QuitDialog.jsx: `{nonce, chats}`.
pub const ASK_KIND: &str = "quit://ask";
/// The asked label of a round the native dialog answers.
pub const NATIVE: &str = "native";
/// How long the asked page has to say it is showing the dialog.
pub const ACK_TIMEOUT: Duration = Duration::from_millis(2_000);
/// Faster than a person reads "Quit while AI is working?" and clicks Cancel.
pub const FAST_ANSWER: Duration = Duration::from_millis(350);
const PROBE_TIMEOUT: Duration = Duration::from_millis(1_500);
/// The studio's own budget is 5 s (`STOP_ALL_BUDGET_MS`); this adds the transport.
const STOP_ALL_TIMEOUT: Duration = Duration::from_millis(5_500);
/// An exit that skipped the dialog (`RunEvent::Exit`) waits at most this long.
const LAST_CHANCE: Duration = Duration::from_millis(3_000);

#[derive(Clone, Debug, PartialEq)]
pub enum Phase {
    Idle,
    /// Asking each studio for its live runs.
    Probing,
    /// The dialog is up — in the page `label`, or `NATIVE`.
    Asking {
        nonce: u64,
        label: String,
        at: Instant,
        shown: bool,
    },
    /// Stop-all is in flight.
    Stopping,
    /// Exit may proceed.
    Approved,
}

/// What a ⌘Q does now.
#[derive(Debug, PartialEq)]
pub enum Key {
    Probe,
    StopAll,
    ExitNow,
    Nothing,
}

/// What the probe's answer leads to.
#[derive(Debug, PartialEq)]
pub enum Ask {
    StopAll,
    Page { nonce: u64, label: String },
    Native { nonce: u64 },
    Nothing,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Answer {
    Shown,
    Quit,
    Cancel,
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Refused,
    Shown,
    StopAll,
    Cancelled,
}

/// The quit round trip, pure: every transition is a unit test.
#[derive(Debug)]
pub struct QuitBook {
    phase: Phase,
    nonce: u64,
    /// A page that answered like no person could: the next ask is native.
    page_distrusted: bool,
}

impl Default for QuitBook {
    fn default() -> Self {
        QuitBook {
            phase: Phase::Idle,
            nonce: 0,
            page_distrusted: false,
        }
    }
}

impl QuitBook {
    #[cfg(test)]
    pub fn phase(&self) -> &Phase {
        &self.phase
    }

    #[cfg_attr(all(target_os = "macos", not(test)), allow(dead_code))]
    pub fn approved(&self) -> bool {
        self.phase == Phase::Approved
    }

    /// ⌘Q (or the shell window's close on Windows / Linux).
    pub fn key(&mut self) -> Key {
        match self.phase {
            Phase::Idle => {
                self.phase = Phase::Probing;
                Key::Probe
            }
            Phase::Probing => Key::Nothing,
            // A second ⌘Q while the dialog is open quits (§5.9.1).
            Phase::Asking { .. } => {
                self.phase = Phase::Stopping;
                Key::StopAll
            }
            // A third while stopping: now.
            Phase::Stopping | Phase::Approved => {
                self.phase = Phase::Approved;
                Key::ExitNow
            }
        }
    }

    /// The probe answered: `chats` live across every project, `page` = the tab to ask in.
    pub fn probed(&mut self, chats: u32, page: Option<String>, now: Instant) -> Ask {
        if self.phase != Phase::Probing {
            return Ask::Nothing;
        }
        if chats == 0 {
            self.phase = Phase::Stopping;
            return Ask::StopAll;
        }
        self.nonce += 1;
        let nonce = self.nonce;
        match page.filter(|_| !self.page_distrusted) {
            Some(label) => {
                self.phase = Phase::Asking {
                    nonce,
                    label: label.clone(),
                    at: now,
                    shown: false,
                };
                Ask::Page { nonce, label }
            }
            None => {
                self.phase = Phase::Asking {
                    nonce,
                    label: NATIVE.to_string(),
                    at: now,
                    shown: true,
                };
                Ask::Native { nonce }
            }
        }
    }

    /// An answer from `label` (the caller's own label, or `NATIVE`) for round `nonce`.
    pub fn answer(&mut self, label: &str, nonce: u64, answer: Answer, now: Instant) -> Outcome {
        let Phase::Asking {
            nonce: n,
            label: asked,
            at,
            shown,
        } = &mut self.phase
        else {
            return Outcome::Refused;
        };
        if *n != nonce || asked != label {
            return Outcome::Refused;
        }
        match answer {
            Answer::Shown if label == NATIVE => Outcome::Refused,
            Answer::Shown => {
                *shown = true;
                Outcome::Shown
            }
            Answer::Quit => {
                self.phase = Phase::Stopping;
                Outcome::StopAll
            }
            Answer::Cancel => {
                if label != NATIVE && (!*shown || now.duration_since(*at) < FAST_ANSWER) {
                    self.page_distrusted = true;
                }
                self.phase = Phase::Idle;
                Outcome::Cancelled
            }
        }
    }

    /// The asked page did not say "shown" in time: the native dialog takes over.
    pub fn ack_timeout(&mut self, nonce: u64, now: Instant) -> Ask {
        match &self.phase {
            Phase::Asking {
                nonce: n,
                label,
                shown: false,
                ..
            } if *n == nonce && label != NATIVE => {
                self.page_distrusted = true;
                self.nonce += 1;
                let nonce = self.nonce;
                self.phase = Phase::Asking {
                    nonce,
                    label: NATIVE.to_string(),
                    at: now,
                    shown: true,
                };
                Ask::Native { nonce }
            }
            _ => Ask::Nothing,
        }
    }

    /// Stop-all came back (or ran out of time).
    pub fn stopped(&mut self) {
        if self.phase == Phase::Stopping {
            self.phase = Phase::Approved;
        }
    }

    /// The app is exiting whatever happened (`RunEvent::Exit`). True when the
    /// runs were NOT stopped by this flow yet — the caller stops them now.
    pub fn exiting(&mut self) -> bool {
        let skipped = !matches!(self.phase, Phase::Approved | Phase::Stopping);
        self.phase = Phase::Approved;
        skipped
    }
}

static BOOK: Mutex<Option<QuitBook>> = Mutex::new(None);

fn with_book<T>(f: impl FnOnce(&mut QuitBook) -> T) -> T {
    let mut g = BOOK.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(QuitBook::default))
}

/// Exit may proceed (the Windows / Linux shell close checks it).
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn approved() -> bool {
    with_book(|b| b.approved())
}

/// The dialog's words (03 `ai-quit`, V2-1.15 §5.8).
pub fn dialog_text(chats: u32) -> (&'static str, String) {
    let n = if chats == 1 {
        "1 chat stops".to_string()
    } else {
        format!("{chats} chats stop")
    };
    (
        "Quit while AI is working?",
        format!(
            "{n} where they are. Everything AI finished so far is kept as a version, and each chat can carry on next time."
        ),
    )
}

/// The tab that shows the dialog: the one in front when its project has AI, else the first
/// project with AI that has a live tab. `None` → the native dialog.
pub fn pick_label(book: &crate::windows::WindowBook, live_roots: &[String]) -> Option<String> {
    let usable = |label: &str| {
        label != crate::windows::HOME_LABEL
            && !book.is_resting(label)
            && book.root_of(label).is_some()
    };
    if let Some(front) = book.focused() {
        if usable(front) && book.root_of(front).is_some_and(|r| live_roots.contains(&r)) {
            return Some(front.to_string());
        }
    }
    live_roots
        .iter()
        .filter_map(|r| book.label_for_root(r))
        .find(|l| usable(l))
}

fn running_roots(app: &AppHandle) -> Vec<String> {
    app.try_state::<SidecarState>()
        .map(|s| {
            s.instances
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .keys()
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

/// ⌘Q. Runs on the main thread (a menu event); the probe and stop-all go async.
pub fn request(app: &AppHandle) {
    match with_book(|b| b.key()) {
        Key::Probe => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { probe_and_ask(&app).await });
        }
        Key::StopAll => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { stop_all_then_exit(&app).await });
        }
        Key::ExitNow => app.exit(0),
        Key::Nothing => {}
    }
}

async fn probe_and_ask(app: &AppHandle) {
    let roots = running_roots(app);
    let probes = roots.iter().map(|root| async move {
        let snap = match crate::sidecar::shell_probe_for(app, root) {
            Some(p) => crate::notify::probe_runs(&p, PROBE_TIMEOUT).await,
            None => None,
        };
        (root.clone(), snap)
    });
    let mut chats = 0u32;
    let mut live_roots = Vec::new();
    for (root, snap) in futures_util::future::join_all(probes).await {
        if let Some(s) = snap.filter(|s| s.any_live()) {
            chats = chats.saturating_add(s.live_chats().max(1));
            live_roots.push(root);
        }
    }
    let page = app.try_state::<SidecarState>().and_then(|s| {
        pick_label(
            &s.windows.lock().unwrap_or_else(|e| e.into_inner()),
            &live_roots,
        )
    });
    match with_book(|b| b.probed(chats, page, Instant::now())) {
        Ask::StopAll => stop_all_then_exit(app).await,
        Ask::Page { nonce, label } => {
            let _ = crate::tabs::reveal(app, &label);
            crate::bus::send(
                &label,
                ASK_KIND,
                serde_json::json!({ "nonce": nonce, "chats": chats }),
            );
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(ACK_TIMEOUT).await;
                if let Ask::Native { nonce } = with_book(|b| b.ack_timeout(nonce, Instant::now())) {
                    show_native(&app, nonce, chats);
                }
            });
        }
        Ask::Native { nonce } => show_native(app, nonce, chats),
        Ask::Nothing => {}
    }
}

fn show_native(app: &AppHandle, nonce: u64, chats: u32) {
    let (title, body) = dialog_text(chats);
    let app2 = app.clone();
    let mut dialog =
        app.dialog()
            .message(body)
            .title(title)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Quit".to_string(),
                "Cancel".to_string(),
            ));
    if let Some(shell) = app.get_window(crate::tabs::SHELL_LABEL) {
        dialog = dialog.parent(&shell);
    }
    dialog.show(move |quit| {
        let answer = if quit { Answer::Quit } else { Answer::Cancel };
        if with_book(|b| b.answer(NATIVE, nonce, answer, Instant::now())) == Outcome::StopAll {
            let app = app2.clone();
            tauri::async_runtime::spawn(async move { stop_all_then_exit(&app).await });
        }
    });
}

/// `POST /_api/ai/runs/stop-all {reason}` to `root`'s own studio (the app-owned info file's
/// address, the per-spawn token). True when it answered 2xx.
async fn post_stop_all(app: &AppHandle, root: &str, reason: &str) -> bool {
    let Some(probe) = crate::sidecar::shell_probe_for(app, root) else {
        return false;
    };
    let Some(origin) = crate::sidecar::read_shell_origin(&probe.info_file) else {
        return false;
    };
    let Some(client) = crate::sidecar::probe_client() else {
        return false;
    };
    client
        .post(format!("{origin}/_api/ai/runs/stop-all"))
        .header("X-Maude-Shell", &probe.token)
        .header("Content-Type", "application/json")
        .body(serde_json::json!({ "reason": reason }).to_string())
        .timeout(STOP_ALL_TIMEOUT)
        .send()
        .await
        .is_ok_and(|r| r.status().is_success())
}

/// Close tab (V2-1.15 §5.9, A5): stop `root`'s runs before its server goes — the same
/// partial versions, lease release and "Stopped" divider as quitting, bounded.
pub(crate) async fn stop_project(app: &AppHandle, root: &str, reason: &str) -> bool {
    tokio::time::timeout(STOP_ALL_TIMEOUT, post_stop_all(app, root, reason))
        .await
        .unwrap_or(false)
}

/// Stop every running project's runs in parallel, bounded.
pub(crate) async fn stop_all(app: &AppHandle, reason: &str, budget: Duration) {
    let roots = running_roots(app);
    let posts = roots.iter().map(|r| post_stop_all(app, r, reason));
    let started = Instant::now();
    let done = tokio::time::timeout(budget, futures_util::future::join_all(posts)).await;
    crate::sidecar::log_line(&format!(
        "[maude] quit: stop-all over {} project(s) {} in {} ms",
        roots.len(),
        if done.is_ok() {
            "answered"
        } else {
            "timed out"
        },
        started.elapsed().as_millis()
    ));
}

async fn stop_all_then_exit(app: &AppHandle) {
    stop_all(app, "quit", STOP_ALL_TIMEOUT).await;
    with_book(|b| b.stopped());
    app.exit(0);
}

/// `RunEvent::Exit`: the process is going whatever happens. An exit that skipped the dialog
/// (the Dock's Quit, logout, an update restart) still stops the runs first, bounded.
pub fn last_chance(app: &AppHandle) {
    if !with_book(|b| b.exiting()) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::block_on(async move { stop_all(&app, "quit", LAST_CHANCE).await });
}

/// `quit_answer({nonce, answer})` — the asked page's reply: `shown` | `quit` | `cancel`.
/// Counts only from the webview that was asked (its own label) for the round's nonce.
#[tauri::command]
pub fn quit_answer(
    app: AppHandle,
    webview: tauri::Webview,
    nonce: u64,
    answer: String,
) -> Result<bool, String> {
    let caller = crate::windows::caller_project(&webview, false)?;
    let answer = match answer.as_str() {
        "shown" => Answer::Shown,
        "quit" => Answer::Quit,
        "cancel" => Answer::Cancel,
        _ => return Err("unknown answer".into()),
    };
    match with_book(|b| b.answer(&caller.label, nonce, answer, Instant::now())) {
        Outcome::Refused => Ok(false),
        Outcome::StopAll => {
            tauri::async_runtime::spawn(async move { stop_all_then_exit(&app).await });
            Ok(true)
        }
        Outcome::Shown | Outcome::Cancelled => Ok(true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asked(b: &mut QuitBook, now: Instant) -> u64 {
        assert_eq!(b.key(), Key::Probe);
        match b.probed(2, Some("p-a".into()), now) {
            Ask::Page { nonce, label } => {
                assert_eq!(label, "p-a");
                nonce
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn nothing_live_stops_and_exits_without_a_dialog() {
        let mut b = QuitBook::default();
        assert_eq!(b.key(), Key::Probe);
        assert_eq!(b.key(), Key::Nothing, "a ⌘Q during the probe waits for it");
        assert_eq!(
            b.probed(0, Some("p-a".into()), Instant::now()),
            Ask::StopAll
        );
        b.stopped();
        assert!(b.approved());
    }

    #[test]
    fn quit_from_the_asked_page_stops_then_approves() {
        let mut b = QuitBook::default();
        let t = Instant::now();
        let n = asked(&mut b, t);
        assert_eq!(b.answer("p-a", n, Answer::Shown, t), Outcome::Shown);
        assert_eq!(
            b.answer("p-a", n, Answer::Quit, t + Duration::from_secs(2)),
            Outcome::StopAll
        );
        assert!(!b.approved(), "not before stop-all answered");
        b.stopped();
        assert!(b.approved());
    }

    #[test]
    fn a_second_command_q_while_asking_quits_and_a_third_exits_now() {
        let mut b = QuitBook::default();
        asked(&mut b, Instant::now());
        assert_eq!(b.key(), Key::StopAll);
        assert_eq!(b.key(), Key::ExitNow);
        assert!(b.approved());
    }

    #[test]
    fn another_page_or_a_stale_round_cannot_answer() {
        let mut b = QuitBook::default();
        let t = Instant::now();
        let n = asked(&mut b, t);
        let later = t + Duration::from_secs(3);
        assert_eq!(
            b.answer("p-b", n, Answer::Quit, later),
            Outcome::Refused,
            "not the asked tab"
        );
        assert_eq!(
            b.answer("p-a", n + 1, Answer::Quit, later),
            Outcome::Refused,
            "wrong round"
        );
        assert_eq!(b.answer(NATIVE, n, Answer::Quit, later), Outcome::Refused);
        assert!(matches!(b.phase(), Phase::Asking { .. }), "still asking");
        // No round open: refused too.
        let mut idle = QuitBook::default();
        assert_eq!(idle.answer("p-a", 1, Answer::Quit, t), Outcome::Refused);
    }

    #[test]
    fn a_silent_page_hands_over_to_the_native_dialog() {
        let mut b = QuitBook::default();
        let t = Instant::now();
        let n = asked(&mut b, t);
        let native = match b.ack_timeout(n, t + ACK_TIMEOUT) {
            Ask::Native { nonce } => nonce,
            other => panic!("{other:?}"),
        };
        assert_ne!(native, n);
        assert_eq!(
            b.answer("p-a", n, Answer::Quit, t),
            Outcome::Refused,
            "the page's round is over"
        );
        assert_eq!(
            b.answer(NATIVE, native, Answer::Cancel, t),
            Outcome::Cancelled
        );
        // Distrusted: the next ⌘Q asks natively even with a page to ask in.
        assert_eq!(b.key(), Key::Probe);
        assert!(matches!(
            b.probed(1, Some("p-a".into()), t),
            Ask::Native { .. }
        ));
    }

    #[test]
    fn a_page_that_said_shown_keeps_its_round_past_the_ack_timeout() {
        let mut b = QuitBook::default();
        let t = Instant::now();
        let n = asked(&mut b, t);
        b.answer("p-a", n, Answer::Shown, t);
        assert_eq!(b.ack_timeout(n, t + ACK_TIMEOUT), Ask::Nothing);
        // A person reads it and cancels: still trusted.
        assert_eq!(
            b.answer("p-a", n, Answer::Cancel, t + Duration::from_secs(4)),
            Outcome::Cancelled
        );
        assert_eq!(b.key(), Key::Probe);
        assert!(matches!(
            b.probed(1, Some("p-a".into()), t),
            Ask::Page { .. }
        ));
    }

    #[test]
    fn a_cancel_no_person_could_give_distrusts_the_page() {
        for shown_first in [false, true] {
            let mut b = QuitBook::default();
            let t = Instant::now();
            let n = asked(&mut b, t);
            if shown_first {
                b.answer("p-a", n, Answer::Shown, t);
            }
            assert_eq!(
                b.answer("p-a", n, Answer::Cancel, t + Duration::from_millis(50)),
                Outcome::Cancelled
            );
            assert_eq!(b.key(), Key::Probe);
            assert!(
                matches!(b.probed(1, Some("p-a".into()), t), Ask::Native { .. }),
                "shown first: {shown_first}"
            );
        }
    }

    #[test]
    fn no_tab_to_ask_in_asks_natively() {
        let mut b = QuitBook::default();
        b.key();
        assert!(matches!(
            b.probed(3, None, Instant::now()),
            Ask::Native { .. }
        ));
        assert_eq!(
            b.answer(NATIVE, 1, Answer::Shown, Instant::now()),
            Outcome::Refused
        );
    }

    #[test]
    fn an_exit_that_skipped_the_flow_still_stops_the_runs() {
        assert!(
            QuitBook::default().exiting(),
            "Dock Quit: stop the runs now"
        );
        let mut b = QuitBook::default();
        b.key();
        b.probed(0, None, Instant::now());
        assert!(!b.exiting(), "stop-all already in flight");
        assert!(!b.exiting(), "the second Exit event does nothing");
    }

    #[test]
    fn the_dialog_counts_chats_in_the_contract_words() {
        let (t, body) = dialog_text(2);
        assert_eq!(t, "Quit while AI is working?");
        assert_eq!(
            body,
            "2 chats stop where they are. Everything AI finished so far is kept as a version, and each chat can carry on next time."
        );
        assert!(dialog_text(1).1.starts_with("1 chat stops where"));
    }

    #[test]
    fn the_dialog_shows_in_the_front_tab_with_ai_else_the_first_tab_with_ai() {
        use crate::windows::{Role, WindowBook};
        let project = |root: &str| Role::Project {
            pid: crate::windows::pid_for_root(root),
            root: root.to_string(),
        };
        let mut book = WindowBook::default();
        book.insert_after("home", Role::Home, 1, None);
        book.insert_after("p-a", project("/a"), 2, Some("home"));
        book.insert_after("p-b", project("/bb"), 3, Some("p-a"));
        book.focus("p-a", 4);
        let live = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            pick_label(&book, &live(&["/a", "/bb"])).as_deref(),
            Some("p-a")
        );
        assert_eq!(pick_label(&book, &live(&["/bb"])).as_deref(), Some("p-b"));
        assert_eq!(
            pick_label(&book, &live(&["/elsewhere"])),
            None,
            "no tab: native"
        );
        book.focus("home", 5);
        assert_eq!(
            pick_label(&book, &live(&["/a"])).as_deref(),
            Some("p-a"),
            "Home never asks"
        );
        book.set_resting("p-a", true);
        assert_eq!(
            pick_label(&book, &live(&["/a"])),
            None,
            "a resting tab has no page"
        );
    }
}
