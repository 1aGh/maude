// notify.rs — feature-acp-turn-notifications.
//
// The native shell tells the user when a chat finishes or needs input, even in
// a project they're not looking at — including a DETACHED chat with no socket
// (feature-acp-write-path-scope Addendum). Two halves:
//
//   1. `send_notification` — a thin command wrapping `tauri-plugin-notification`, so
//      either the shell (poller below) or the visible-project client path
//      (app.jsx, Task 6) can post a real OS notification regardless of which
//      project's page is loaded, or whether any page is loaded at all.
//   2. The poller — a background task that walks the sidecar pool
//      (`SidecarState.instances`), skips the CURRENTLY-DISPLAYED project (the
//      client already owns that one instantly), probes every other instance's
//      `/_api/acp/activity`, and fires on a STATE TRANSITION, never on a level
//      (polling a level would re-notify every tick — Design Decisions table).
//
// Decision D (load-bearing, not a nicety): the notification body carries NO
// project content — only the project's own directory name (from the path the
// user chose to open) plus a fixed string. A chat title is model-generated
// from what the model read, and per DDR-054 the served project's content is
// untrusted; putting it in a notification renders attacker-influenced text on
// a lock screen, outside the app, in a surface the user cannot inspect.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::sidecar::SidecarState;

/// How often the poller walks the non-current pool instances. Slow on purpose
/// (Design Decisions table — "this competes with `git status`"): the visible
/// project doesn't need it, and at most `running_cap() - 1` = 4 instances are
/// ever polled (more only while the cap overflows).
const POLL_INTERVAL_MS: u64 = 6_000;

/// Bound on the activity probe, mirroring `sidecar.rs`'s
/// `RUNNING_PROBE_TIMEOUT_MS` — a wedged instance must not stall the loop.
const ACTIVITY_PROBE_TIMEOUT_MS: u64 = 1_500;

/// Reuses `handleAssistantAttention`'s `ATTENTION_NOTIFY_COOLDOWN_MS` semantics
/// (app.jsx:115) — one stuck chat must not become a notification storm — but
/// scoped PER PROJECT here rather than globally, since two different projects
/// both needing attention are two genuinely separate things to tell the user.
const NOTIFY_COOLDOWN_MS: u64 = 30_000;

/// SECURITY (ethical-hacker finding, Task 8) — the 30 s cooldown bounds RATE,
/// not COUNT: `_server.json` lives under the untrusted project root (same file
/// `sidecar.rs::has_running_chat` already treats as untrusted for a different
/// reason — the A1 SSRF/argv-injection class), so a compromised project can
/// stand up its own loopback responder at that url and answer the activity
/// probe with a scripted, ever-alternating state forever, for as long as the
/// project stays open. Nothing here re-authenticates that the responder is
/// genuinely THIS app's own spawned dev-server — `is_loopback_url` only proves
/// "loopback", not "ours". A truthful project name + a fixed string (Decision
/// D still holds — no CONTENT leaks) fired indefinitely is itself an attack:
/// it can train a user to mute Maude's notifications system-wide, which loses
/// the real `awaiting-input` signal too — the one thing beating
/// `PERMISSION_TIMEOUT_MS`'s 120 s fail-closed deny. This cap turns
/// "indefinite" into "bounded per project per app session": once a project has
/// legitimately (or maliciously) generated this many notifications in one
/// session, the poller stops paging the user for it — it does not stop
/// polling or updating `last_seen`, so a real transition after the cap is
/// still recorded and the badge/in-app signal is unaffected, only the OS ping
/// stops. Cleared by `clear_project`, so a genuinely long session that outlives
/// several app restarts (or the project being closed and reopened) is not
/// permanently muted.
///
/// This is a mitigation, not the fix: the real fix is authenticating the
/// poller's target at SPAWN time (a recorded port / per-boot token) instead of
/// re-trusting a freshly re-read untrusted file every tick — tracked as a
/// named open item in the plan (Follow-ups) rather than done here, since it
/// also touches `has_running_chat`'s identical, separately-accepted pattern
/// and is a bigger architectural change than this feature's scope.
const MAX_NOTIFICATIONS_PER_PROJECT_SESSION: u32 = 20;

/// Defense-in-depth for the `send_notification` command (ethical-hacker finding, LOW) —
/// Decision D ("no project content in the body") is enforced today by the two
/// known call sites only passing fixed strings + a trusted directory name, not
/// by the command's own signature. Cap length and strip control characters at
/// the SINK, so a not-yet-found XSS in the main studio webview (which could
/// otherwise call `invoke('notify', …)` with arbitrary text) degrades to a
/// garbled OS notification instead of attacker-authored text on the lock
/// screen. `\n`/`\t` are kept (multi-line bodies are legitimate); other
/// control characters are stripped.
const MAX_NOTIFY_FIELD_LEN: usize = 200;

///
/// `pub(crate)` because the sidecar's give-up dialog renders the same class of
/// value (a project's own directory name) into the same class of surface (an
/// OS-drawn box the user cannot inspect), and a second, subtly-different
/// sanitizer is how the two drift apart.
pub(crate) fn sanitize_notify_field(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .filter(|c| (!c.is_control() || *c == '\n' || *c == '\t') && !is_bidi_control(*c))
        .collect();
    cleaned.chars().take(MAX_NOTIFY_FIELD_LEN).collect()
}

/// The bidi embedding / override / isolate controls (U+202A–202E,
/// U+2066–2069) and the bare marks (U+200E/200F, U+061C). They are `Cf`, not
/// `Cc`, so `is_control` keeps them — and they can make an OS-drawn name read
/// as something else (V2-3.6 W3).
fn is_bidi_control(c: char) -> bool {
    matches!(
        c,
        '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{200E}' | '\u{200F}' | '\u{061C}'
    )
}

/// A project-supplied name for a ONE-LINE native surface — a window title, a
/// dialog's "{name}" (V2-3.6 W3): `sanitize_notify_field`, with every control
/// (newline, tab, CR) turned into a space and runs of whitespace collapsed.
pub(crate) fn sanitize_title(s: &str) -> String {
    let spaced: String = s
        .chars()
        .filter(|c| !is_bidi_control(*c))
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    let one_line = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    one_line.chars().take(MAX_NOTIFY_FIELD_LEN).collect()
}

/// A notification's `(title, body)` as the OS draws them (V2-3.10 W3): the
/// title is ONE line (`sanitize_title` — a project-controlled name with a
/// newline would push a forged second line into the banner's title row); the
/// body may keep `\n`/`\t`. Both are bidi-free and capped.
pub(crate) fn notification_fields(title: &str, body: &str) -> (String, String) {
    (sanitize_title(title), sanitize_notify_field(body))
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ChatState {
    Idle,
    Running,
    AwaitingInput,
}

impl ChatState {
    fn parse(s: &str) -> Self {
        match s {
            "awaiting-input" => ChatState::AwaitingInput,
            "running" => ChatState::Running,
            _ => ChatState::Idle,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Transition {
    /// Something in this project now needs the user — a permission prompt or
    /// an elicitation form. Racing `PERMISSION_TIMEOUT_MS` (120 s, bridge.ts).
    AwaitingInput,
    /// A turn that was running has settled with nothing left pending.
    Finished,
}

/// Pure transition classifier — the unit-testable core of Task 5.
///
/// DEVIATION FROM THE PLAN'S LITERAL WORDING, recorded here rather than left
/// silent: Task 5's "Do" bullet says "idle→awaiting-input or running→idle".
/// But a chat's actual lifecycle for the case that matters most —a running
/// turn that hits a permission prompt mid-flight — goes RUNNING→AWAITING,
/// never through idle (idle only precedes a turn's first prompt, before
/// `turnActive` is even true). Firing only on idle→awaiting-input would miss
/// the acceptance criterion "a permission prompt … in a non-visible project
/// produces a notification" for every mid-turn prompt, which is the common
/// case. So this fires on ANY→awaiting-input (except already-awaiting, so a
/// second concurrent request doesn't re-notify — DDR-179/180 already caps at
/// 10+5 pending, and the client-side precedent for bursts is "one ping, not
/// fifteen") and on running→idle for the finished case, exactly as written.
pub fn transition_kind(prev: ChatState, curr: ChatState) -> Option<Transition> {
    if curr == ChatState::AwaitingInput && prev != ChatState::AwaitingInput {
        return Some(Transition::AwaitingInput);
    }
    if prev == ChatState::Running && curr == ChatState::Idle {
        return Some(Transition::Finished);
    }
    None
}

#[derive(Deserialize)]
struct ActivityChat {
    #[serde(rename = "chatId")]
    chat_id: String,
    state: String,
}

#[derive(Deserialize)]
struct ActivitySnapshot {
    chats: Vec<ActivityChat>,
}

/// Poller-owned state. Managed separately from `SidecarState` — this is
/// notification bookkeeping, not sidecar lifecycle, and keeping it a distinct
/// `Mutex` means a slow notify-state read/write can never contend with the
/// pool lock other code paths take on the hot project-switch path.
pub struct NotifyPollState {
    /// (project_root, chatId) → last-seen state. Read this project's OWN key
    /// space is cleared by `clear_project` on eviction/shutdown/respawn-giveup
    /// (sidecar.rs) — otherwise a LATER instance spawned at the same root would
    /// inherit a stale transition and either miss or duplicate a real one.
    last_seen: Mutex<HashMap<(String, String), ChatState>>,
    /// project_root → last time a notification actually fired for it.
    last_notified: Mutex<HashMap<String, Instant>>,
    /// project_root → how many notifications have fired for it THIS app
    /// session — the lifetime cap above rate-limiting (MAX_NOTIFICATIONS_PER_PROJECT_SESSION).
    notified_count: Mutex<HashMap<String, u32>>,
    /// SECURITY (ethical-hacker re-review, Task 8 fan-out #2) — the
    /// `send_notification` COMMAND's own cooldown + cap, entirely separate
    /// from the two maps above. The command has no project identity to key
    /// by (it's the visible project's own client calling it, Task 6, with no
    /// project argument) — but more importantly, WITHOUT its own budget it
    /// was a structural bypass of the poller-side cap: main-webview JS (an
    /// XSS — the exact threat `sanitize_notify_field` exists for) could call
    /// `invoke('send_notification', …)` in a tight loop with zero rate limit,
    /// degraded only by content sanitization, not frequency. `(last fired,
    /// count this session)` — one shared bucket is correct here because only
    /// ONE project is ever visible at a time (this command exists only for
    /// that one), unlike the poller's genuinely per-project maps above.
    command_notify: Mutex<(Option<Instant>, u32)>,
    /// project_root → the last `ai` counts its authenticated `shell_status`
    /// probe answered (V2-3.5). Home's `ShellState.projects[].ai` reads this
    /// cache, so `shell_state` never waits on a probe. Running instances only:
    /// a root that left the pool is pruned on the next tick.
    ai: Mutex<HashMap<String, crate::sidecar::AiCounts>>,
    /// The Dock badge (V2-3.5): projects that need the person.
    badge: Mutex<Badge>,
}

/// The Dock badge's set (V2-3.5): projects that started waiting on the person
/// while their window was not focused, and that the person has not looked at
/// since. A project leaves it when its window gains focus or when its own
/// server no longer reports anything awaiting. "Unseen mentions" would join
/// this set — no mention source reaches the shell yet.
#[derive(Debug, Default)]
pub struct Badge {
    pending: std::collections::BTreeSet<String>,
}

impl Badge {
    /// A project now needs the person. True when the count changed.
    pub fn mark(&mut self, root: &str) -> bool {
        self.pending.insert(root.to_string())
    }

    /// Its window gained focus, or it stopped waiting. True when changed.
    pub fn clear(&mut self, root: &str) -> bool {
        self.pending.remove(root)
    }

    /// Drop projects that are no longer running (closed, resting, crashed).
    pub fn retain_running(&mut self, running: &[String]) -> bool {
        let before = self.pending.len();
        self.pending.retain(|r| running.iter().any(|x| x == r));
        before != self.pending.len()
    }

    pub fn count(&self) -> usize {
        self.pending.len()
    }
}

/// The poller's targets (§5.2 "Notifications"): every running instance whose
/// window is NOT the focused one. A project with no window at all (kept by the
/// pool) is polled too. Home is never a target — its server is not in the
/// pool, and a Home label is refused here as a second guard.
pub fn poll_targets(book: &crate::windows::WindowBook, running: &[String]) -> Vec<String> {
    let focused = book.focused();
    running
        .iter()
        .filter(|root| {
            let label = book.label_for_root(root);
            label.as_deref() != Some(crate::windows::HOME_LABEL)
                && (label.is_none() || label.as_deref() != focused)
        })
        .cloned()
        .collect()
}

/// What a click on a project's notification does.
#[derive(Clone, Debug, PartialEq)]
pub enum ClickAction {
    /// Unminimize + focus this window (which selects its tab; a resting tab
    /// then wakes through `windows::on_focused`).
    Focus(String),
    /// The project has no window (its server is kept by the pool): open one.
    Open,
}

pub fn click_action(book: &crate::windows::WindowBook, root: &str) -> ClickAction {
    match book.label_for_root(root) {
        Some(label) => ClickAction::Focus(label),
        None => ClickAction::Open,
    }
}

/// A click on the notification for `root` — the OS callback (macOS) and the
/// debug-only `e2e_notification_click` both land here.
pub fn on_click(app: &AppHandle, root: &str) {
    let Some(state) = app.try_state::<SidecarState>() else { return };
    let action = click_action(&state.windows.lock().unwrap_or_else(|e| e.into_inner()), root);
    if let ClickAction::Focus(label) = action {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.unminimize();
            let _ = w.set_focus();
            return;
        }
    }
    if let Err(e) = crate::windows::open_window_for_root(app, root, None, None) {
        crate::sidecar::log_line(&format!("[maude] notify: could not open {root}: {e}"));
    }
}

/// A project's window gained focus: the person is looking at it, so it leaves
/// the Dock badge (V2-3.5).
pub fn project_focused(app: &AppHandle, root: &str) {
    let Some(state) = app.try_state::<NotifyPollState>() else { return };
    let changed = state.badge.lock().expect("notify mutex poisoned").clear(root);
    if changed {
        apply_badge(app);
    }
}

/// The cached `ai` counts of `root`'s running instance, if probed.
pub fn cached_ai(app: &AppHandle, root: &str) -> Option<crate::sidecar::AiCounts> {
    let state = app.try_state::<NotifyPollState>()?;
    let ai = state.ai.lock().expect("notify mutex poisoned");
    ai.get(root).cloned()
}

/// Push the badge count to the Dock. On macOS the badge is the app's (any
/// window sets it); `None` clears it.
fn apply_badge(app: &AppHandle) {
    let Some(state) = app.try_state::<NotifyPollState>() else { return };
    let count = state.badge.lock().expect("notify mutex poisoned").count();
    let Some(w) = app.webview_windows().into_values().next() else { return };
    let value = (count > 0).then_some(count as i64);
    if let Err(e) = w.set_badge_count(value) {
        crate::sidecar::log_line(&format!("[maude] notify: could not set the Dock badge: {e}"));
    }
}

/// Debug-only e2e helper: the click handler of `root`'s notification (native
/// notifications are not DOM-reachable). Granted only by
/// capabilities/debug/e2e-webdriver.json; a release build answers Err.
#[tauri::command]
pub fn e2e_notification_click(
    app: AppHandle,
    webview: tauri::Webview,
    root: String,
) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        // V2-3.6 L3: even in debug, only a window on its own origin.
        crate::windows::caller_any(&webview, false)?;
        on_click(&app, &root);
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (app, webview, root);
        Err("debug builds only".into())
    }
}

/// Send a real OS notification. Internal callers (the poller) call this
/// directly; the `send_notification` command below is the same path for the visible-
/// project client (Task 6), invoked over IPC. Sanitizes at the sink — see
/// `sanitize_notify_field`'s doc comment — regardless of caller.
fn send(app: &AppHandle, title: &str, body: &str) {
    let (title, body) = notification_fields(title, body);
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("[maude] notify: failed to show notification: {e}");
    }
}

/// How many notifications may wait for a click at once (each holds a thread
/// until it is clicked or dismissed). Past it a notification is still shown,
/// just without click routing.
#[cfg(target_os = "macos")]
const MAX_CLICK_WAITERS: usize = 8;
#[cfg(target_os = "macos")]
static CLICK_WAITERS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// A project's notification whose click focuses THAT project's window (V2-3.5).
/// `tauri-plugin-notification` reports no click on desktop, so on macOS the
/// same `notify-rust` backend it wraps is driven directly, waiting for the
/// response on a thread of its own (NSUserNotificationCenter answers on the
/// main run loop, which Tauri pumps). Elsewhere: the plain path, no routing.
fn send_for_project(app: &AppHandle, title: &str, body: &str, root: &str) {
    #[cfg(target_os = "macos")]
    {
        if CLICK_WAITERS.fetch_add(1, Ordering::SeqCst) < MAX_CLICK_WAITERS {
            let (title, body) = notification_fields(title, body);
            let identifier = app.config().identifier.clone();
            let app2 = app.clone();
            let root2 = root.to_string();
            let spawned = std::thread::Builder::new()
                .name("maude-notify-click".into())
                .spawn(move || {
                    let _ = notify_rust::set_application(if tauri::is_dev() {
                        "com.apple.Terminal"
                    } else {
                        &identifier
                    });
                    match notify_rust::Notification::new().summary(&title).body(&body).show() {
                        Ok(handle) => handle.wait_for_action(|action| {
                            if action == "default" {
                                on_click(&app2, &root2);
                            }
                        }),
                        Err(e) => eprintln!("[maude] notify: failed to show notification: {e}"),
                    }
                    CLICK_WAITERS.fetch_sub(1, Ordering::SeqCst);
                });
            if spawned.is_ok() {
                return;
            }
        }
        CLICK_WAITERS.fetch_sub(1, Ordering::SeqCst);
    }
    let _ = root;
    send(app, title, body);
}

/// One-shot system notice from the native core — something about the MACHINE the
/// user needs to know (issue #105's "no GStreamer audio sink, media will fail"),
/// not something about a project or a chat.
///
/// Routed through `send` so the OS notifier keeps exactly one caller, and
/// deliberately NOT through the cooldown/cap bookkeeping: those bound a repeating
/// signal whose timing untrusted project state can steer. This is a fixed string
/// with no project content in it, fired at most once per launch by our own
/// startup path, so there is nothing for the throttle to protect against — and
/// silently swallowing the one warning that explains a blank window would be the
/// worse outcome.
#[cfg(target_os = "linux")]
pub(crate) fn send_system_notice(app: &AppHandle, title: &str, body: &str) {
    send(app, title, body);
}

/// Webview-facing command (Task 6) — lets the CLIENT fire the same native
/// notification for the visible project, so there is exactly one code path
/// that ever calls the OS notifier, under Tauri or from the poller. Gated by
/// its OWN cooldown + cap (`command_notify`) — see that field's doc comment
/// for why this can't reuse the poller's per-project bookkeeping. Silently
/// drops the call once throttled (`Ok(())`, not an error) — the client's own
/// gate (`!assistantOpenRef.current || document.hidden`) already decided this
/// notification was warranted; a throttled native ping should degrade
/// quietly, the same way the poller's cap does, not surface as a JS error the
/// caller has no useful way to handle.
#[tauri::command]
pub fn send_notification(
    app: AppHandle,
    webview: tauri::Webview,
    title: String,
    body: String,
) -> Result<(), String> {
    crate::windows::caller_any(&webview, false)?;
    let state = app.state::<NotifyPollState>();
    {
        let mut bucket = state.command_notify.lock().expect("notify mutex poisoned");
        let (last, count) = *bucket;
        if let Some(last) = last {
            if Instant::now().duration_since(last) < Duration::from_millis(NOTIFY_COOLDOWN_MS) {
                return Ok(());
            }
        }
        if count >= MAX_NOTIFICATIONS_PER_PROJECT_SESSION {
            return Ok(());
        }
        *bucket = (Some(Instant::now()), count + 1);
    }
    send(&app, &title, &body);
    Ok(())
}

/// Clear the TRANSITION-DETECTION state for `project_root` only — `last_seen`,
/// never `last_notified`/`notified_count`. Call this from a path an in-project
/// attacker can steer the timing of.
///
/// SECURITY (ethical-hacker re-review, Task 8 fan-out #2) — `shutdown_instance`
/// (sidecar.rs) is driven by `reap_instances`, whose eviction candidacy check
/// (`has_running_chat`) reads the SAME untrusted `_server.json` the notify
/// poller does, with "any failure ⇒ evictable" as its explicit default. A
/// compromised project's rogue responder can therefore choose exactly when it
/// gets reaped — and the original `clear_project` (now `clear_project_fully`,
/// below) reset `notified_count` on every reap, turning the "bounded per
/// project per app session" cap (`MAX_NOTIFICATIONS_PER_PROJECT_SESSION`) into
/// "bounded per pool-membership epoch": pump toward the cap, answer one probe
/// "idle" to get evicted (wiping the count), get reopened by the user on their
/// next ordinary switch back, repeat. This function is the fix: reaping still
/// needs `last_seen` cleared (a later instance at the same root must not
/// inherit a stale per-chat transition — the correctness reason the ORIGINAL
/// Task 5 gotcha named), but the notification budget must NOT reset just
/// because an attacker-influenced probe said "evictable". `last_notified`
/// (the 30 s cooldown) is left alone for the same reason — resetting it would
/// let the SAME churn shrink the cooldown window too.
pub fn clear_project_reaped(app: &AppHandle, project_root: &str) {
    let Some(state) = app.try_state::<NotifyPollState>() else { return };
    state
        .last_seen
        .lock()
        .expect("notify mutex poisoned")
        .retain(|(root, _), _| root != project_root);
}

/// Clear ALL poller state for `project_root` — `last_seen`, `last_notified`,
/// AND `notified_count`. Reserved for paths that are NOT attacker-timeable:
/// the supervisor giving up after `MAX_RESTARTS` (sidecar.rs) means the real,
/// trusted dev-server process for this root has genuinely crash-looped 3+
/// times — a much stronger bar than "answer one HTTP probe with the wrong
/// word" — so treating it as a fresh session for that project is safe. Do NOT
/// call this from the reap-eviction path; see `clear_project_reaped` above.
pub fn clear_project_fully(app: &AppHandle, project_root: &str) {
    let Some(state) = app.try_state::<NotifyPollState>() else { return };
    state
        .last_seen
        .lock()
        .expect("notify mutex poisoned")
        .retain(|(root, _), _| root != project_root);
    state
        .last_notified
        .lock()
        .expect("notify mutex poisoned")
        .remove(project_root);
    state
        .notified_count
        .lock()
        .expect("notify mutex poisoned")
        .remove(project_root);
}

/// The project name shown in a notification — Decision D: the directory name
/// FROM THE PATH THE USER CHOSE, never anything the agent or its tools wrote.
fn project_display_name(project_root: &str) -> String {
    PathBuf::from(project_root)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "your project".to_string())
}

/// The activity endpoint of the server whose app-owned info file is
/// `info_file` (V2-1.1 decision 8, §5.8 item 6). The address comes ONLY from
/// that file — loopback-validated, rebuilt from the origin so no path or flag
/// survives — never from the in-project `_server.json`, which a prompt-injected
/// agent or a planted file could point at a fake responder.
pub(crate) fn activity_url(info_file: &std::path::Path) -> Option<String> {
    crate::sidecar::read_shell_origin(info_file).map(|o| format!("{o}/_api/acp/activity"))
}

/// `GET /_api/acp/activity` of the instance `probe` names (V2-3.10 W6, §5.8.6):
/// the same `probe_client()` as `/_api/shell/status` — no proxy (system curl
/// honoured `http_proxy` for 127.0.0.1 unless `NO_PROXY` was set), no
/// redirects — with the per-spawn token in `X-Maude-Shell`. Any failure is
/// `None`.
async fn probe_activity(probe: &crate::sidecar::ShellProbe) -> Option<ActivitySnapshot> {
    let url = activity_url(&probe.info_file)?;
    let resp = crate::sidecar::probe_client()?
        .get(url)
        .header("X-Maude-Shell", &probe.token)
        .timeout(Duration::from_millis(ACTIVITY_PROBE_TIMEOUT_MS))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<ActivitySnapshot>().await.ok()
}

/// Probe one non-current instance's activity endpoint and fire on transition.
async fn poll_one(app: &AppHandle, project_root: &str) {
    let Some(probe) = crate::sidecar::shell_probe_for(app, project_root) else {
        return;
    };
    let Some(snapshot) = probe_activity(&probe).await else {
        return;
    };

    let state = app.state::<NotifyPollState>();
    let mut fired: Vec<Transition> = Vec::new();
    {
        let mut seen = state.last_seen.lock().expect("notify mutex poisoned");
        for chat in &snapshot.chats {
            let key = (project_root.to_string(), chat.chat_id.clone());
            let curr = ChatState::parse(&chat.state);
            let prev = seen.get(&key).copied().unwrap_or(ChatState::Idle);
            if let Some(t) = transition_kind(prev, curr) {
                fired.push(t);
            }
            seen.insert(key, curr);
        }
    }
    if fired.is_empty() {
        return;
    }
    // The badge counts every project that started waiting while unfocused —
    // before the cooldown/cap below, which only throttle the OS ping.
    if fired.contains(&Transition::AwaitingInput)
        && state.badge.lock().expect("notify mutex poisoned").mark(project_root)
    {
        apply_badge(app);
    }

    // Cooldown per project (Design Decisions table). Awaiting-input is the
    // more actionable of the two if both fired in the same tick.
    {
        let mut last = state.last_notified.lock().expect("notify mutex poisoned");
        let now = Instant::now();
        if let Some(prev) = last.get(project_root) {
            if now.duration_since(*prev) < Duration::from_millis(NOTIFY_COOLDOWN_MS) {
                return;
            }
        }
        last.insert(project_root.to_string(), now);
    }

    // SECURITY (ethical-hacker finding, Task 8) — lifetime cap on top of the
    // cooldown. See MAX_NOTIFICATIONS_PER_PROJECT_SESSION's doc comment: the
    // cooldown alone bounds rate, not count, and a compromised project's fake
    // activity endpoint can otherwise page the user forever. `last_seen` above
    // is still updated (a real transition post-cap is still tracked, only the
    // OS ping is withheld), so this never desyncs from reality — it only mutes.
    {
        let mut counts = state.notified_count.lock().expect("notify mutex poisoned");
        let count = counts.entry(project_root.to_string()).or_insert(0);
        if *count >= MAX_NOTIFICATIONS_PER_PROJECT_SESSION {
            eprintln!(
                "[maude] notify: {project_root} hit the per-session notification cap ({MAX_NOTIFICATIONS_PER_PROJECT_SESSION}) — muting further OS pings for it this session"
            );
            return;
        }
        *count += 1;
    }

    let kind = if fired.contains(&Transition::AwaitingInput) {
        Transition::AwaitingInput
    } else {
        Transition::Finished
    };
    let (title, body) = notification_text(kind, &project_display_name(project_root));
    send_for_project(app, &title, &body, project_root);
}

/// The notification's words (V2-3.5): the title names the project — its
/// directory name, Decision D — and the body is a fixed string. Sanitized at
/// the sink (`send` / `send_for_project`).
pub fn notification_text(kind: Transition, name: &str) -> (String, String) {
    match kind {
        Transition::AwaitingInput => (
            format!("{name}: Needs you"),
            "Claude is waiting on an approval or a question.".to_string(),
        ),
        Transition::Finished => (
            format!("{name}: AI is done"),
            "Your assistant turn is ready.".to_string(),
        ),
    }
}

/// Spawn the background poller. Call once from `setup`, after `SidecarState`
/// is managed. Skips the currently-displayed project every tick — that one is
/// the client's job (Task 6) and is not this poller's concern at all, so
/// there is exactly one notifier per project per moment, never two racing.
pub fn spawn_activity_poller(app: &AppHandle) {
    app.manage(NotifyPollState {
        last_seen: Mutex::new(HashMap::new()),
        last_notified: Mutex::new(HashMap::new()),
        notified_count: Mutex::new(HashMap::new()),
        command_notify: Mutex::new((None, 0)),
        ai: Mutex::new(HashMap::new()),
        badge: Mutex::new(Badge::default()),
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
            let sidecar_state = app.state::<SidecarState>();
            if sidecar_state.shutting_down.load(Ordering::SeqCst) {
                break;
            }
            let running: Vec<String> = {
                let pool = sidecar_state.instances.lock().expect("sidecar mutex poisoned");
                pool.keys().cloned().collect()
            };
            // Targets = running instances whose window is NOT focused (V2-3.5,
            // §5.2; was "≠ the displayed project"). The focused window's own
            // client notifies for itself. A resting tab has no instance, so it
            // is never polled; Home is not in the pool.
            let targets = {
                let book = sidecar_state.windows.lock().expect("windows mutex poisoned");
                poll_targets(&book, &running)
            };
            // Probed OUTSIDE every lock — same reasoning as reap_instances:
            // the probe is bounded but still slow enough that holding a lock
            // across it would stall an unrelated switch.
            refresh_ai(&app, &running).await;
            for root in targets {
                poll_one(&app, &root).await;
            }
        }
    });
}

/// Refresh the `ai` cache from every running instance's authenticated status
/// probe (Home shows it for each tab), drop roots that stopped running, and
/// take a project out of the badge once nothing in it is awaiting.
async fn refresh_ai(app: &AppHandle, running: &[String]) {
    let mut fresh: Vec<(String, Option<crate::sidecar::AiCounts>)> = Vec::new();
    for root in running {
        let status = crate::sidecar::shell_status(app, root).await;
        fresh.push((root.clone(), status.map(|s| s.ai)));
    }
    let state = app.state::<NotifyPollState>();
    let (ai_changed, badge_changed) = apply_ai_refresh(
        &mut state.ai.lock().expect("notify mutex poisoned"),
        &mut state.badge.lock().expect("notify mutex poisoned"),
        running,
        fresh,
    );
    if badge_changed {
        apply_badge(app);
    }
    if ai_changed {
        crate::home::state_changed(app);
    }
}

/// Pure half of `refresh_ai`. A probe that did not answer keeps the last
/// counts (a slow server must not flicker Home); a root no longer running is
/// dropped. Returns `(ai cache changed, badge changed)`.
pub fn apply_ai_refresh(
    ai: &mut HashMap<String, crate::sidecar::AiCounts>,
    badge: &mut Badge,
    running: &[String],
    fresh: Vec<(String, Option<crate::sidecar::AiCounts>)>,
) -> (bool, bool) {
    let before = ai.clone();
    ai.retain(|root, _| running.iter().any(|r| r == root));
    let mut badge_changed = badge.retain_running(running);
    for (root, counts) in fresh {
        if let Some(counts) = counts {
            if counts.awaiting == 0 {
                badge_changed |= badge.clear(&root);
            }
            ai.insert(root, counts);
        }
    }
    (*ai != before, badge_changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_turn_hitting_a_prompt_mid_flight_fires_awaiting_input() {
        // The common real case: running (turnActive, nothing pending) → a
        // permission request arrives → awaiting-input. NEVER passes through
        // idle. This is exactly the case the plan's literal "idle→awaiting-
        // input" wording would have missed.
        assert_eq!(
            transition_kind(ChatState::Running, ChatState::AwaitingInput),
            Some(Transition::AwaitingInput)
        );
    }

    #[test]
    fn a_fresh_chats_first_prompt_also_fires_awaiting_input() {
        // idle→awaiting-input — a brand-new chat whose very first tool call
        // needs approval, before `turnActive` would even read as running.
        assert_eq!(
            transition_kind(ChatState::Idle, ChatState::AwaitingInput),
            Some(Transition::AwaitingInput)
        );
    }

    #[test]
    fn a_finished_turn_fires_finished() {
        assert_eq!(
            transition_kind(ChatState::Running, ChatState::Idle),
            Some(Transition::Finished)
        );
    }

    #[test]
    fn staying_in_the_same_state_never_fires_a_second_time() {
        // "fire on TRANSITION, not on state" (Design Decisions table) — a
        // level, polled repeatedly, must not re-notify every tick.
        assert_eq!(transition_kind(ChatState::AwaitingInput, ChatState::AwaitingInput), None);
        assert_eq!(transition_kind(ChatState::Running, ChatState::Running), None);
        assert_eq!(transition_kind(ChatState::Idle, ChatState::Idle), None);
    }

    #[test]
    fn a_resolved_prompt_that_returns_to_running_is_silent() {
        // Awaiting-input → running (the human answered) is progress, not
        // something to notify about — only entering/leaving the pending state
        // in the directions above are notify-worthy.
        assert_eq!(transition_kind(ChatState::AwaitingInput, ChatState::Running), None);
    }

    #[test]
    fn idle_never_fires_finished_a_turn_must_have_been_running_first() {
        // A chat that was already idle staying idle, or an awaiting-input chat
        // resolving straight to idle (no more work queued), must not read as
        // "finished" unless it was actually mid-turn — `running→idle` only.
        assert_eq!(transition_kind(ChatState::Idle, ChatState::Idle), None);
        assert_eq!(transition_kind(ChatState::AwaitingInput, ChatState::Idle), None);
    }

    #[test]
    fn a_second_concurrent_request_does_not_re_fire() {
        // DDR-179/180: up to 15 distinct pending requests can legitimately
        // queue in one turn. Staying in AwaitingInput (state doesn't change)
        // must read as the SAME transition, not a fresh one — matches the
        // client-side precedent of "one attention-getting ping, not fifteen".
        assert_eq!(transition_kind(ChatState::AwaitingInput, ChatState::AwaitingInput), None);
    }

    // SECURITY (ethical-hacker finding, Task 8) — sanitize_notify_field is the
    // defense-in-depth sink for the `send_notification` command's freeform title/body.
    #[test]
    fn sanitize_strips_control_characters_but_keeps_newlines_and_tabs() {
        let s = sanitize_notify_field("hello\x00\x07world\nline2\tindented");
        assert_eq!(s, "helloworld\nline2\tindented");
    }

    /// W3: a title is one line with no bidi controls; a notification body
    /// keeps its newlines but loses the bidi controls too.
    #[test]
    fn notification_titles_are_one_line_and_bodies_keep_their_lines() {
        let (title, body) = notification_fields(
            "Acme\nClaude needs your password\t\u{202E}x",
            "line1\n\u{2067}line2",
        );
        assert_eq!(title, "Acme Claude needs your password x");
        assert_eq!(body, "line1\nline2");
    }

    #[test]
    fn titles_are_one_line_and_bidi_free() {
        assert_eq!(
            sanitize_title("Acme\n\r\tBrand\u{202E}gpj.exe\u{2066}x\u{2069}"),
            "Acme Brandgpj.exex"
        );
        assert_eq!(sanitize_title("  a   b  "), "a b");
        assert_eq!(sanitize_notify_field("a\u{202E}b\nc"), "ab\nc");
    }

    #[test]
    fn sanitize_caps_length_at_max_notify_field_len() {
        let long = "x".repeat(MAX_NOTIFY_FIELD_LEN + 500);
        let s = sanitize_notify_field(&long);
        assert_eq!(s.chars().count(), MAX_NOTIFY_FIELD_LEN);
    }

    #[test]
    fn sanitize_is_a_no_op_on_an_ordinary_short_string() {
        assert_eq!(sanitize_notify_field("Claude finished"), "Claude finished");
    }

    // ── probe_auth (V2-1.1 decision 8, §5.8 item 6, §7 "Probe auth") ────────

    use crate::sidecar::{probe_status, ShellProbe};
    use std::sync::atomic::AtomicUsize;
    use std::sync::Arc;

    /// A loopback HTTP responder on an ephemeral port. `answer(token_header)`
    /// picks (status, body); every request bumps `hits`.
    fn responder(
        answer: impl Fn(Option<String>) -> (u16, &'static str) + Send + 'static,
    ) -> (u16, Arc<AtomicUsize>) {
        let server = tiny_http::Server::http("127.0.0.1:0").expect("bind a loopback port");
        let port = server.server_addr().to_ip().expect("an ip listener").port();
        let hits = Arc::new(AtomicUsize::new(0));
        let h = hits.clone();
        std::thread::spawn(move || {
            for req in server.incoming_requests() {
                h.fetch_add(1, Ordering::SeqCst);
                let token = req
                    .headers()
                    .iter()
                    .find(|x| x.field.equiv("x-maude-shell"))
                    .map(|x| x.value.as_str().to_string());
                let (code, body) = answer(token);
                let _ = req.respond(tiny_http::Response::from_string(body).with_status_code(code));
            }
        });
        (port, hits)
    }

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "maude-probe-auth-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    const IDLE: &str = r#"{"version":"x","ai":{"running":0,"awaiting":0},"unsent":0,"jobs":0}"#;
    const BUSY: &str = r#"{"version":"x","ai":{"running":1,"awaiting":0},"unsent":0,"jobs":0}"#;

    #[tokio::test]
    async fn probe_auth_a_planted_server_json_is_never_believed() {
        // The impostor a prompt-injected agent would plant: `_server.json` in the
        // project naming a responder that says "idle" (rest me, kill my chat).
        let (fake_port, fake_hits) = responder(|_| (200, IDLE));
        let project = scratch("project");
        std::fs::create_dir_all(project.join(".design")).unwrap();
        std::fs::write(
            project.join(".design").join("_server.json"),
            format!(r#"{{"pid":1,"port":{fake_port},"url":"http://127.0.0.1:{fake_port}"}}"#),
        )
        .unwrap();

        // The real server: answers only to this spawn's token.
        let token = "a".repeat(64);
        let want = token.clone();
        let (real_port, real_hits) = responder(move |got| match got {
            Some(t) if t == want => (200, BUSY),
            _ => (401, r#"{"error":"shell-token"}"#),
        });
        let app_owned = scratch("app");
        let info_file = app_owned.join("lproj-0000.json");
        std::fs::write(
            &info_file,
            format!(r#"{{"pid":2,"port":{real_port},"url":"http://127.0.0.1:{real_port}","started":"t","mode":"project"}}"#),
        )
        .unwrap();

        // The info file + token is believed.
        let probe = ShellProbe {
            info_file: info_file.clone(),
            token: token.clone(),
        };
        let status = probe_status(&probe).await.expect("the real server answers");
        assert_eq!(status.ai.running, 1);
        assert!(status.busy());
        // The notify poller's target comes from the same file.
        assert_eq!(
            activity_url(&info_file).as_deref(),
            Some(format!("http://127.0.0.1:{real_port}/_api/acp/activity").as_str())
        );

        // A wrong token is not an answer (401 → None), not "idle".
        let wrong = ShellProbe {
            info_file: info_file.clone(),
            token: "b".repeat(64),
        };
        assert_eq!(probe_status(&wrong).await, None);

        // No info file → no probe at all; it never falls back to `_server.json`.
        let gone = ShellProbe {
            info_file: app_owned.join("missing.json"),
            token: token.clone(),
        };
        assert_eq!(probe_status(&gone).await, None);
        assert_eq!(activity_url(&app_owned.join("missing.json")), None);

        // An info file that names somewhere off the box is refused (DDR-109).
        let off_box = app_owned.join("off-box.json");
        std::fs::write(&off_box, r#"{"url":"http://evil.example:80"}"#).unwrap();
        assert_eq!(activity_url(&off_box), None);

        assert_eq!(fake_hits.load(Ordering::SeqCst), 0, "the impostor was never asked");
        assert_eq!(real_hits.load(Ordering::SeqCst), 2, "token probe + wrong-token probe");
        let _ = std::fs::remove_dir_all(project);
        let _ = std::fs::remove_dir_all(app_owned);
    }

    // V2-3.10 W6 — the activity probe carries the per-spawn token, like the status probe.
    #[tokio::test]
    async fn the_activity_probe_sends_the_per_spawn_token() {
        let token = "c".repeat(64);
        let want = token.clone();
        let (port, hits) = responder(move |got| match got {
            Some(t) if t == want => (200, r#"{"chats":[{"chatId":"c1","state":"running"}]}"#),
            _ => (401, r#"{"error":"shell-token"}"#),
        });
        let dir = scratch("activity");
        let info_file = dir.join("lproj-0001.json");
        std::fs::write(
            &info_file,
            format!(r#"{{"pid":3,"port":{port},"url":"http://127.0.0.1:{port}","started":"t","mode":"project"}}"#),
        )
        .unwrap();
        let probe = ShellProbe {
            info_file: info_file.clone(),
            token,
        };
        let snap = probe_activity(&probe).await.expect("answers to the spawn's token");
        assert_eq!(snap.chats.len(), 1);
        let wrong = ShellProbe {
            info_file,
            token: "d".repeat(64),
        };
        assert!(probe_activity(&wrong).await.is_none());
        assert_eq!(hits.load(Ordering::SeqCst), 2);
        let _ = std::fs::remove_dir_all(dir);
    }

    // ── V2-3.5: targets, click, badge, ai cache ─────────────────────────────

    use crate::sidecar::AiCounts;
    use crate::windows::{Role, WindowBook, HOME_LABEL};

    fn book_ab() -> WindowBook {
        let mut book = WindowBook::default();
        book.insert(HOME_LABEL, Role::Home, 1);
        for (label, root) in [("p-a", "/a"), ("p-b", "/b")] {
            book.insert(
                label,
                Role::Project {
                    pid: crate::windows::pid_for_root(root),
                    root: root.into(),
                },
                2,
            );
        }
        book
    }

    fn roots(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn poller_targets_unfocused_instances_only_never_the_focused_one() {
        let mut book = book_ab();
        // "/c" runs with no window (kept by the pool) — still the poller's.
        let running = roots(&["/a", "/b", "/c"]);
        book.focus("p-a", 3);
        assert_eq!(poll_targets(&book, &running), roots(&["/b", "/c"]));
        book.focus("p-b", 4);
        assert_eq!(poll_targets(&book, &running), roots(&["/a", "/c"]));
        // Home focused: every project is unfocused, and Home itself is never
        // a target (it is not in the pool to begin with).
        book.focus(HOME_LABEL, 5);
        assert_eq!(poll_targets(&book, &running), running);
    }

    #[test]
    fn notification_click_focuses_that_projects_window() {
        let mut book = book_ab();
        book.focus("p-a", 3);
        let ClickAction::Focus(label) = click_action(&book, "/b") else {
            panic!("an open project focuses its tab")
        };
        assert_eq!(label, "p-b");
        // What the OS focus event then does: p-b is the focused label.
        book.focus(&label, 4);
        assert_eq!(book.focused(), Some("p-b"));
        assert_eq!(click_action(&book, "/c"), ClickAction::Open);
    }

    #[test]
    fn notification_title_names_the_project() {
        let (t, b) = notification_text(Transition::AwaitingInput, "alligators");
        assert_eq!(t, "alligators: Needs you");
        assert!(!b.contains("alligators"), "the body is a fixed string");
        assert_eq!(notification_text(Transition::Finished, "x").0, "x: AI is done");
    }

    #[test]
    fn badge_counts_projects_that_need_you_and_clears_on_focus() {
        let mut badge = Badge::default();
        assert!(badge.mark("/a"));
        assert!(!badge.mark("/a"), "one project counts once");
        assert!(badge.mark("/b"));
        assert_eq!(badge.count(), 2);
        assert!(badge.clear("/a"), "its window gained focus");
        assert_eq!(badge.count(), 1);
        assert!(badge.retain_running(&roots(&["/a"])), "/b stopped running");
        assert_eq!(badge.count(), 0);
    }

    #[test]
    fn ai_cache_keeps_running_roots_and_a_settled_project_leaves_the_badge() {
        let counts = |running, awaiting| AiCounts { running, awaiting };
        let mut ai = HashMap::new();
        ai.insert("/gone".to_string(), counts(1, 0));
        let mut badge = Badge::default();
        badge.mark("/a");
        badge.mark("/b");
        let (ai_changed, badge_changed) = apply_ai_refresh(
            &mut ai,
            &mut badge,
            &roots(&["/a", "/b"]),
            vec![
                ("/a".to_string(), Some(counts(0, 0))),
                ("/b".to_string(), Some(counts(1, 1))),
            ],
        );
        assert!(ai_changed && badge_changed);
        assert!(!ai.contains_key("/gone"));
        assert_eq!(ai["/b"], counts(1, 1));
        assert_eq!(badge.count(), 1, "/a stopped awaiting, /b still waits");
        // A probe that did not answer keeps the last counts: no flicker.
        let (ai_changed, _) =
            apply_ai_refresh(&mut ai, &mut badge, &roots(&["/a", "/b"]), vec![("/b".into(), None)]);
        assert!(!ai_changed);
        assert_eq!(ai["/b"], counts(1, 1));
    }
}
