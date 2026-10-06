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
/// project doesn't need it, and at most `MAX_INSTANCES - 1` = 2 instances are
/// ever polled.
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
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect();
    cleaned.chars().take(MAX_NOTIFY_FIELD_LEN).collect()
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
}

/// Send a real OS notification. Internal callers (the poller) call this
/// directly; the `send_notification` command below is the same path for the visible-
/// project client (Task 6), invoked over IPC. Sanitizes at the sink — see
/// `sanitize_notify_field`'s doc comment — regardless of caller.
fn send(app: &AppHandle, title: &str, body: &str) {
    let title = sanitize_notify_field(title);
    let body = sanitize_notify_field(body);
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        eprintln!("[maude] notify: failed to show notification: {e}");
    }
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
pub fn send_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
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

/// Probe one non-current instance's activity endpoint and fire on transition.
///
/// Reuses `has_running_chat`'s URL handling VERBATIM (Pattern, plan Task 5):
/// parse `_server.json`'s url, require `is_loopback_url`, rebuild from
/// `origin().ascii_serialization()`, `--` before the url in curl's argv. See
/// `sidecar.rs::has_running_chat`'s doc comment for the full A1 rationale this
/// mirrors — `_server.json` is untrusted project content.
async fn poll_one(app: &AppHandle, project_root: &str) {
    let design_root = PathBuf::from(project_root).join(".design");
    let Some(base) = crate::server_json::read_server_url(&design_root) else {
        return;
    };
    let Ok(parsed) = base.parse::<tauri::Url>() else {
        eprintln!("[maude] notify: refusing to probe unparseable _server.json url: {base}");
        return;
    };
    if !crate::server_json::is_loopback_url(&parsed) {
        eprintln!("[maude] notify: refusing non-loopback _server.json url (DDR-109): {parsed}");
        return;
    }
    let url = format!("{}/_api/acp/activity", parsed.origin().ascii_serialization());
    let out = crate::win_process::hidden_command("curl")
        .args([
            "-s",
            "--max-time",
            &format!("{:.1}", ACTIVITY_PROBE_TIMEOUT_MS as f64 / 1000.0),
            "--",
            &url,
        ])
        .output();
    let Ok(out) = out else { return };
    let Ok(snapshot) = serde_json::from_slice::<ActivitySnapshot>(&out.stdout) else {
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
    let name = project_display_name(project_root);
    let (title, body) = match kind {
        Transition::AwaitingInput => (
            "Maude needs your input",
            format!("Claude is waiting on an approval or a question in {name}."),
        ),
        Transition::Finished => (
            "Claude finished",
            format!("Your assistant turn is ready in {name}."),
        ),
    };
    send(app, title, &body);
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
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
            let sidecar_state = app.state::<SidecarState>();
            if sidecar_state.shutting_down.load(Ordering::SeqCst) {
                break;
            }
            let current = sidecar_state
                .project_root
                .lock()
                .expect("sidecar mutex poisoned")
                .clone();
            let roots: Vec<String> = {
                let pool = sidecar_state.instances.lock().expect("sidecar mutex poisoned");
                pool.keys().filter(|root| **root != current).cloned().collect()
            };
            // Probed OUTSIDE the pool lock — same reasoning as reap_instances:
            // the curl is bounded but still slow enough that holding the lock
            // across it would stall an unrelated switch.
            for root in roots {
                poll_one(&app, &root).await;
            }
        }
    });
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
}
