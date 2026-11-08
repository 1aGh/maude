// #206 / DDR-250 (contract `apps/studio/client/v2/contracts/206-cli-reuses-desktop.md` §4, §6, §7): the
// CLI → app channel, an app-owned unix socket `<app_data_dir>/cli.sock`.
//
// A terminal design run (`server-up`, `maude design open`, the screenshot helpers) asks the RUNNING app
// for a checkout's server here instead of booting a second one: `ensure` (a port, opening the tab when
// allowed), `status` (a pending consent ticket), `show` (front the tab), `lease`/`release` (keep the tab
// busy while an agent works) and `restart`. One JSON request per connection, one JSON reply, then close.
//
// Trust (decisions in DDR-250; first-open trust is Michal's option A):
// - the socket is 0600 in a 0700 dir, and every connection's peer uid must be ours (`getpeereid`) —
//   another user is closed without a byte;
// - a request is ≤ 8 KiB and must arrive within 2 s;
// - `root` is absolute, exists, realpaths to a folder with `.design/config.json`, and is neither inside
//   nor an ancestor of the app's own data dirs, the profile config folders or the credential folders;
// - a folder Maude already knows (ever opened / Recent) and a verified worktree of one opens silently;
//   any other folder brings Maude to the front with a native sheet ("Open" / "Not now"). Open adds it
//   to the project list, so the next request is silent; Not now answers `denied` (the CLI uses its own
//   hidden server) and is kept for this app run; at most MAX_SHEETS_PER_WINDOW sheets per ten minutes
//   across every folder, Not now is the default button and Open counts only after SHEET_OPEN_DELAY;
// - Settings › General "Let the terminal open projects in Maude" (prefs `terminal_opens`, default on)
//   off ⇒ nothing is opened from the terminal (a tab already open still answers);
// - the terminal never picks or creates a profile: a new folder adopts the last sign-in's profile
//   exactly as an unbound folder opened from Home does, and a worktree never enters the project list.

use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};

/// The largest request the channel reads (contract §4).
pub(crate) const MAX_REQUEST: usize = 8 * 1024;
/// How long a client has to send its request.
pub(crate) const READ_TIMEOUT: Duration = Duration::from_secs(2);
/// A lease with no `ttlSec` lives this long (contract §10.2).
pub(crate) const LEASE_DEFAULT_SECS: u64 = 300;
/// The longest lease a request may ask for.
pub(crate) const LEASE_MAX_SECS: u64 = 600;
/// A consent ticket nobody answered is gone after this (the CLI polls ≤ 60 s).
pub(crate) const TICKET_TTL: Duration = Duration::from_secs(120);
/// At most this many sheets wait at once; more requests for new folders are refused.
pub(crate) const MAX_PENDING_TICKETS: usize = 4;
/// At most this many consent sheets per `SHEET_WINDOW` across EVERY folder (not per folder): an agent
/// cycling through new folders cannot keep bringing Maude to the front. Past it: `too-many-sheets`.
pub(crate) const MAX_SHEETS_PER_WINDOW: usize = 3;
pub(crate) const SHEET_WINDOW: Duration = Duration::from_secs(600);
/// Open counts only this long after the sheet showed: a key or click already on its way when Maude
/// came to the front cannot answer it (the sheet is raised again instead).
pub(crate) const SHEET_OPEN_DELAY: Duration = Duration::from_secs(1);
pub(crate) const SHEET_OPEN: &str = "Open";
pub(crate) const SHEET_NOT_NOW: &str = "Not now";
/// At most this many connections are handled at once; more are closed.
pub(crate) const MAX_CONNECTIONS: usize = 16;
const MAX_ROOT_LEN: usize = 4096;

// ── Requests ────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Purpose {
    Capture,
    Show,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LeaseAsk {
    pub id: String,
    #[serde(default)]
    pub ttl_sec: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Expect {
    #[serde(default)]
    pub branch: Option<String>,
}

/// One request, as the wire carries it (`{v:1, op, …}`).
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase", deny_unknown_fields)]
pub enum Op {
    Ensure {
        v: u32,
        root: String,
        purpose: Purpose,
        #[serde(default)]
        lease: Option<LeaseAsk>,
        #[serde(default)]
        expect: Option<Expect>,
    },
    Status {
        v: u32,
        ticket: String,
    },
    Show {
        v: u32,
        root: String,
        #[serde(default)]
        canvas: Option<String>,
        #[serde(default)]
        artboard: Option<String>,
        #[serde(default)]
        element: Option<String>,
        #[serde(default)]
        mode: Option<String>,
    },
    Lease {
        v: u32,
        id: String,
        root: String,
        #[serde(default, rename = "ttlSec")]
        ttl_sec: Option<u64>,
    },
    Release {
        v: u32,
        id: String,
        root: String,
    },
    Restart {
        v: u32,
        root: String,
    },
}

impl Op {
    fn version(&self) -> u32 {
        match self {
            Op::Ensure { v, .. }
            | Op::Status { v, .. }
            | Op::Show { v, .. }
            | Op::Lease { v, .. }
            | Op::Release { v, .. }
            | Op::Restart { v, .. } => *v,
        }
    }
}

/// Why a request is refused (the reply's `reason`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    TooLarge,
    BadRequest,
    RootNotAbsolute,
    RootMissing,
    NotAProject,
    AppData,
    UnknownTicket,
    NotOpen,
    Busy,
    TooManySheets,
    NotReady,
    BranchChangedUnsent,
}

impl Refusal {
    pub fn reason(self) -> &'static str {
        match self {
            Refusal::TooLarge => "too-large",
            Refusal::BadRequest => "bad-request",
            Refusal::RootNotAbsolute => "root-not-absolute",
            Refusal::RootMissing => "root-missing",
            Refusal::NotAProject => "not-a-maude-project",
            Refusal::AppData => "app-data",
            Refusal::UnknownTicket => "unknown-ticket",
            Refusal::NotOpen => "not-open",
            Refusal::Busy => "busy",
            Refusal::TooManySheets => "too-many-sheets",
            Refusal::NotReady => "not-ready",
            Refusal::BranchChangedUnsent => "branch-changed-unsent",
        }
    }

    pub fn reply(self) -> Value {
        json!({ "status": "refused", "reason": self.reason() })
    }
}

/// A lease or ticket id: 1–64 of `[A-Za-z0-9_-]`.
fn plain_id(s: &str, max: usize) -> bool {
    (1..=max).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn is_ticket(s: &str) -> bool {
    s.len() == 32
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A short free-text field: no control or bidi characters, at most `max` characters.
fn plain_text(s: &str, max: usize) -> bool {
    let n = s.chars().count();
    (1..=max).contains(&n)
        && !s.chars().any(|c| {
            c.is_control()
                || ('\u{202a}'..='\u{202e}').contains(&c)
                || ('\u{2066}'..='\u{2069}').contains(&c)
        })
}

/// Parse one request. Every string field is checked here, before any of it reaches the app.
pub fn parse_request(bytes: &[u8]) -> Result<Op, Refusal> {
    if bytes.len() > MAX_REQUEST {
        return Err(Refusal::TooLarge);
    }
    let op: Op = serde_json::from_slice(bytes).map_err(|_| Refusal::BadRequest)?;
    if op.version() != 1 {
        return Err(Refusal::BadRequest);
    }
    let ok = match &op {
        Op::Ensure { lease, expect, .. } => {
            lease.as_ref().is_none_or(|l| {
                plain_id(&l.id, 64) && l.ttl_sec.is_none_or(|t| (1..=LEASE_MAX_SECS).contains(&t))
            }) && expect
                .as_ref()
                .and_then(|e| e.branch.as_deref())
                .is_none_or(|b| plain_text(b, 255))
        }
        Op::Status { ticket, .. } => is_ticket(ticket),
        Op::Show {
            canvas,
            artboard,
            element,
            mode,
            ..
        } => {
            canvas
                .as_deref()
                .is_none_or(|c| crate::project_resolve::validate_open_param(c).is_some())
                && artboard
                    .as_deref()
                    .is_none_or(|a| plain_text(a, 128) && !a.contains('/'))
                && element.as_deref().is_none_or(|e| plain_text(e, 256))
                && mode.as_deref().is_none_or(|m| {
                    (1..=32).contains(&m.len())
                        && m.bytes().all(|b| b.is_ascii_lowercase() || b == b'-')
                })
        }
        Op::Lease { id, ttl_sec, .. } => {
            plain_id(id, 64) && ttl_sec.is_none_or(|t| (1..=LEASE_MAX_SECS).contains(&t))
        }
        Op::Release { id, .. } => plain_id(id, 64),
        Op::Restart { .. } => true,
    };
    if ok {
        Ok(op)
    } else {
        Err(Refusal::BadRequest)
    }
}

// ── Roots ───────────────────────────────────────────────────────────────────

/// The realpath of a terminal-supplied root, or why it is refused. `forbidden`: the app's own data
/// dirs and the profile config folders — a root inside one, or one that CONTAINS one (the project's
/// server would then serve the app's keys and registry), is refused.
pub fn validate_root(raw: &str, forbidden: &[PathBuf]) -> Result<PathBuf, Refusal> {
    if raw.is_empty() || raw.len() > MAX_ROOT_LEN || raw.contains('\0') {
        return Err(Refusal::BadRequest);
    }
    let p = Path::new(raw);
    if !p.is_absolute() {
        return Err(Refusal::RootNotAbsolute);
    }
    let real = std::fs::canonicalize(p).map_err(|_| Refusal::RootMissing)?;
    let real = crate::win_process::strip_verbatim(&real).to_path_buf();
    if !real.is_dir() {
        return Err(Refusal::RootMissing);
    }
    for f in forbidden {
        let f = std::fs::canonicalize(f).unwrap_or_else(|_| f.clone());
        if real.starts_with(&f) || f.starts_with(&real) {
            return Err(Refusal::AppData);
        }
    }
    if !real.join(".design").join("config.json").is_file() {
        return Err(Refusal::NotAProject);
    }
    Ok(real)
}

/// The credential folders under `home` no terminal-supplied root may be in or contain — the same set
/// the AI session's deny rules name (`apps/studio/acp/may-scope.ts` `credentialPathsFor`).
pub(crate) fn credential_dirs(home: &Path) -> Vec<PathBuf> {
    [".ssh", ".aws", ".gnupg", "Library/Keychains"]
        .iter()
        .map(|d| home.join(d))
        .collect()
}

// ── The consent sheet (contract §7) ─────────────────────────────────────────

/// The sheet's `(title, message)` for the realpath `real`: the folder's own name and full path —
/// never a label from the folder's config, which the folder's author picks.
pub(crate) fn sheet_text(real: &Path) -> (String, String) {
    let full = real.to_string_lossy();
    let base = real
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| full.clone().into_owned());
    // One line, nothing that reorders or hides text; the path is never cut short in its middle —
    // a very long one keeps its tail, the part that names the folder.
    let clean = |s: &str| -> String {
        crate::project_resolve::strip_invisible(s)
            .chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .collect()
    };
    let name: String = clean(&base).chars().take(120).collect();
    let path = clean(&full);
    let n = path.chars().count();
    let path = if n > 600 {
        format!("\u{2026}{}", path.chars().skip(n - 599).collect::<String>())
    } else {
        path
    };
    (
        "Open a folder from the terminal?".to_string(),
        format!(
            "Claude Code wants to show the folder \u{201c}{name}\u{201d} in Maude.\n\n{path}\n\nEither way this project runs on this Mac: Open shows it in a Maude tab, Not now lets the terminal run it in its own hidden server."
        ),
    )
}

/// The sheet's buttons in the order the OS draws them; the FIRST is the default (Return): Not now.
pub(crate) fn sheet_buttons() -> (&'static str, &'static str) {
    (SHEET_NOT_NOW, SHEET_OPEN)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SheetAnswer {
    Open,
    NotNow,
    /// Open, but sooner than `SHEET_OPEN_DELAY` after the sheet showed: ask again.
    TooSoon,
}

/// What a press means. `pressed`: the label of the button pressed (`None`: the sheet closed any other
/// way, which is Not now). `shown`: when the sheet was raised.
pub(crate) fn sheet_answer(pressed: Option<&str>, shown: Instant, at: Instant) -> SheetAnswer {
    if pressed != Some(SHEET_OPEN) {
        return SheetAnswer::NotNow;
    }
    if at.saturating_duration_since(shown) < SHEET_OPEN_DELAY {
        return SheetAnswer::TooSoon;
    }
    SheetAnswer::Open
}

// ── First-open trust (option A) ─────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Trust {
    /// Open without asking: a folder Maude knows, or a verified worktree of one (`main`).
    Silent { worktree_of: Option<PathBuf> },
    /// Bring Maude to the front and ask.
    Ask,
    /// Never open it from the terminal (the switch is off, or the person said Not now this run).
    Denied,
}

/// The first-open rule for a folder that is not open in a tab yet.
pub fn trust_for(
    root: &Path,
    enabled: bool,
    declined: bool,
    is_known: &dyn Fn(&Path) -> bool,
) -> Trust {
    if !enabled {
        return Trust::Denied;
    }
    if is_known(root) {
        return Trust::Silent { worktree_of: None };
    }
    if let Some(wt) = crate::project_resolve::worktree_of(root) {
        if is_known(&wt.main_root) {
            return Trust::Silent {
                worktree_of: Some(wt.main_root),
            };
        }
    }
    if declined {
        Trust::Denied
    } else {
        Trust::Ask
    }
}

// ── Consent tickets ─────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Answer {
    Pending,
    Open,
    NotNow,
}

#[derive(Clone, Debug)]
pub struct Ticket {
    pub root: PathBuf,
    pub purpose: Purpose,
    pub canvas: Option<String>,
    pub artboard: Option<String>,
    pub lease: Option<LeaseAsk>,
    pub answer: Answer,
    pub created: Instant,
}

#[derive(Debug, Default)]
pub struct Tickets {
    by_id: HashMap<String, Ticket>,
    /// Folders the person answered Not now for, this app run.
    declined: HashSet<PathBuf>,
    /// When each sheet of the last `SHEET_WINDOW` was raised (every folder together).
    sheets: VecDeque<Instant>,
}

impl Tickets {
    fn prune(&mut self, now: Instant) {
        self.by_id
            .retain(|_, t| now.saturating_duration_since(t.created) < TICKET_TTL);
    }

    /// A ticket for `t.root`: the pending one already raised for that folder (one sheet per folder),
    /// or a new id. `Err` when too many sheets wait already. Returns `(id, raise_sheet)`.
    pub fn open(&mut self, id: String, t: Ticket, now: Instant) -> Result<(String, bool), Refusal> {
        self.prune(now);
        if let Some((existing, _)) = self
            .by_id
            .iter()
            .find(|(_, x)| x.root == t.root && x.answer == Answer::Pending)
        {
            return Ok((existing.clone(), false));
        }
        while self
            .sheets
            .front()
            .is_some_and(|s| now.saturating_duration_since(*s) >= SHEET_WINDOW)
        {
            self.sheets.pop_front();
        }
        if self.sheets.len() >= MAX_SHEETS_PER_WINDOW {
            return Err(Refusal::TooManySheets);
        }
        if self
            .by_id
            .values()
            .filter(|x| x.answer == Answer::Pending)
            .count()
            >= MAX_PENDING_TICKETS
        {
            return Err(Refusal::TooManySheets);
        }
        self.sheets.push_back(now);
        self.by_id.insert(id.clone(), t);
        Ok((id, true))
    }

    pub fn get(&mut self, id: &str, now: Instant) -> Option<Ticket> {
        self.prune(now);
        self.by_id.get(id).cloned()
    }

    /// The person answered the sheet for `id`.
    pub fn answer(&mut self, id: &str, open: bool) -> Option<Ticket> {
        let t = self.by_id.get_mut(id)?;
        if t.answer != Answer::Pending {
            return None;
        }
        t.answer = if open { Answer::Open } else { Answer::NotNow };
        if !open {
            self.declined.insert(t.root.clone());
        } else {
            self.declined.remove(&t.root);
        }
        Some(t.clone())
    }

    pub fn declined(&self, root: &Path) -> bool {
        self.declined.contains(root)
    }

    /// The pending ticket raised first (debug e2e answers sheets in the order they came).
    #[cfg_attr(not(debug_assertions), allow(dead_code))]
    pub fn oldest_pending(&mut self, now: Instant) -> Option<String> {
        self.prune(now);
        self.by_id
            .iter()
            .filter(|(_, t)| t.answer == Answer::Pending)
            .min_by_key(|(_, t)| t.created)
            .map(|(id, _)| id.clone())
    }
}

/// Debug-only e2e helper (`cli-reuse` lane): answer the terminal consent sheet — Open (`open: true`)
/// or Not now — for the oldest pending ticket; returns its folder, or `null` when none waits. Only an
/// e2e app started with `MAUDE_E2E_CLI_CONSENT=1` parks tickets (the native sheet is not
/// DOM-reachable). Granted only by capabilities/debug/e2e-webdriver.json; a release build answers Err.
#[tauri::command]
pub fn e2e_cli_consent(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    open: bool,
) -> Result<Option<String>, String> {
    #[cfg(all(debug_assertions, unix))]
    {
        crate::windows::caller_any(&webview, false)?;
        Ok(glue::e2e_answer_oldest(&app, open).map(|p| p.to_string_lossy().into_owned()))
    }
    #[cfg(not(all(debug_assertions, unix)))]
    {
        let _ = (app, webview, open);
        Err("debug builds only".into())
    }
}

// ── Leases (contract §6 "Busy") ─────────────────────────────────────────────

/// Per root realpath, per lease id: when it ends. A live lease makes the tab busy, so idle rest and
/// the running cap never rest it; it ends by itself, so a dead agent leaves no stuck tab.
#[derive(Debug, Default)]
pub struct Leases(HashMap<String, HashMap<String, Instant>>);

impl Leases {
    pub fn grant(&mut self, root: &str, id: &str, ttl_sec: Option<u64>, now: Instant) {
        let secs = ttl_sec
            .unwrap_or(LEASE_DEFAULT_SECS)
            .clamp(1, LEASE_MAX_SECS);
        self.0
            .entry(root.to_string())
            .or_default()
            .insert(id.to_string(), now + Duration::from_secs(secs));
    }

    pub fn release(&mut self, root: &str, id: &str) {
        if let Some(m) = self.0.get_mut(root) {
            m.remove(id);
            if m.is_empty() {
                self.0.remove(root);
            }
        }
    }

    /// Every root a live lease holds (expired ones dropped) — the lease watcher compares these.
    pub fn live_roots(&mut self, now: Instant) -> std::collections::BTreeSet<String> {
        self.0.retain(|_, m| {
            m.retain(|_, end| *end > now);
            !m.is_empty()
        });
        self.0.keys().cloned().collect()
    }

    pub fn is_leased(&mut self, root: &str, now: Instant) -> bool {
        let Some(m) = self.0.get_mut(root) else {
            return false;
        };
        m.retain(|_, end| *end > now);
        if m.is_empty() {
            self.0.remove(root);
            return false;
        }
        true
    }
}

static LEASES: std::sync::LazyLock<Mutex<Leases>> = std::sync::LazyLock::new(Default::default);

/// Does a live terminal lease keep `root` (a pool key — realpath'd here) busy? Read by `idle_rest`
/// and the running cap.
pub(crate) fn leased(root: &str) -> bool {
    let real = crate::cli_registry::realpath(root);
    LEASES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_leased(&real, Instant::now())
}

fn live_leases() -> std::collections::BTreeSet<String> {
    LEASES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .live_roots(Instant::now())
}

// ── Branch (contract §6 "Branch mismatch") ──────────────────────────────────

/// What `ensure`/`show` do about the folder's branch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BranchCheck {
    Same,
    /// The reply carries `warning:{kind:'branch-changed', was, now}`; the tab is relabelled.
    Changed { was: String, now: String },
    /// The folder switched under a tab with unsent changes: `refused:'branch-changed-unsent'`.
    RefuseUnsent,
}

impl BranchCheck {
    pub fn warning(&self) -> Option<Value> {
        match self {
            BranchCheck::Changed { was, now } => {
                Some(json!({ "kind": "branch-changed", "was": was, "now": now }))
            }
            _ => None,
        }
    }
}

/// A branch as the warning names it: the branch, or "detached" (a bare commit, not a git folder).
pub fn branch_word(b: Option<&str>) -> String {
    b.map_or_else(|| "detached".to_string(), str::to_string)
}

/// `was` = the branch the tab was opened with, `now` = the folder's HEAD, `expect` = the agent's own
/// HEAD (`expect.branch`), `unsent` = the tab's `ShellStatus.unsent` (`None` = unreadable, counted
/// as none: a booting server holds no unsent changes).
pub fn branch_check(
    was: Option<&str>,
    now: Option<&str>,
    expect: Option<&str>,
    unsent: Option<u32>,
) -> BranchCheck {
    if was != now {
        if unsent.unwrap_or(0) > 0 {
            return BranchCheck::RefuseUnsent;
        }
        return BranchCheck::Changed {
            was: branch_word(was),
            now: branch_word(now),
        };
    }
    match expect {
        Some(e) if Some(e) != now => BranchCheck::Changed {
            was: e.to_string(),
            now: branch_word(now),
        },
        _ => BranchCheck::Same,
    }
}

/// The branch each open tab was opened with (by realpath), updated once a change was told.
#[derive(Debug, Default)]
pub struct TabBranches(HashMap<String, Option<String>>);

impl TabBranches {
    pub fn note(&mut self, root: &str, branch: Option<String>) {
        self.0.insert(root.to_string(), branch);
    }

    /// `None` = never noted (a tab opened before this run's channel saw it).
    pub fn was(&self, root: &str) -> Option<Option<String>> {
        self.0.get(root).cloned()
    }
}

static BRANCHES: std::sync::LazyLock<Mutex<TabBranches>> =
    std::sync::LazyLock::new(Default::default);

/// A tab for `root` was just built: remember the branch it shows. Called by
/// `windows::open_window_for_root_as`.
pub(crate) fn note_branch(root: &str) {
    let real = crate::cli_registry::realpath(root);
    let b = crate::project_resolve::current_branch(Path::new(&real));
    BRANCHES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .note(&real, b);
}

// ── The socket ──────────────────────────────────────────────────────────────

/// The uid on the other end of a unix socket, or `None` when the OS will not say.
#[cfg(unix)]
pub fn peer_uid(stream: &std::os::unix::net::UnixStream) -> Option<u32> {
    use std::os::unix::io::AsRawFd;
    let fd = stream.as_raw_fd();
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd"
    ))]
    {
        let mut uid: libc::uid_t = 0;
        let mut gid: libc::gid_t = 0;
        // SAFETY: fd is a live socket for the duration of the call; uid/gid are valid out-pointers.
        let rc = unsafe { libc::getpeereid(fd, &mut uid, &mut gid) };
        (rc == 0).then_some(uid)
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let mut cred = libc::ucred {
            pid: 0,
            uid: 0,
            gid: 0,
        };
        let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        // SAFETY: fd is a live socket; cred/len describe a correctly sized out-buffer.
        let rc = unsafe {
            libc::getsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                (&mut cred as *mut libc::ucred).cast(),
                &mut len,
            )
        };
        (rc == 0).then_some(cred.uid)
    }
}

#[cfg(unix)]
pub(crate) fn my_uid() -> u32 {
    // SAFETY: getuid has no preconditions and cannot fail.
    unsafe { libc::getuid() }
}

/// Read one request: up to the first `\n` or the end of the stream, at most `MAX_REQUEST` bytes.
pub fn read_request(r: &mut impl Read) -> Result<Vec<u8>, Refusal> {
    let mut buf = Vec::with_capacity(512);
    let mut chunk = [0u8; 1024];
    loop {
        let n = match r.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(Refusal::BadRequest), // the 2 s timeout, a reset
        };
        if let Some(i) = chunk[..n].iter().position(|&b| b == b'\n') {
            buf.extend_from_slice(&chunk[..i]);
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() > MAX_REQUEST {
            return Err(Refusal::TooLarge);
        }
    }
    if buf.len() > MAX_REQUEST {
        return Err(Refusal::TooLarge);
    }
    Ok(buf)
}

/// Serve one connection: the peer must be `uid` (else it is closed with no reply), then one request,
/// `handle`'s reply, close.
#[cfg(unix)]
pub fn serve_conn(
    mut stream: std::os::unix::net::UnixStream,
    uid: u32,
    handle: &dyn Fn(Op) -> Value,
) {
    if peer_uid(&stream) != Some(uid) {
        return; // another user (or unknown): not a byte back
    }
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let _ = stream.set_write_timeout(Some(READ_TIMEOUT));
    let reply = match read_request(&mut stream).and_then(|b| parse_request(&b)) {
        Ok(op) => handle(op),
        Err(r) => r.reply(),
    };
    let mut out = serde_json::to_vec(&reply).unwrap_or_default();
    out.push(b'\n');
    let _ = stream.write_all(&out);
    let _ = stream.flush();
}

/// Bind `<dir>/cli.sock`: the dir 0700, the socket 0600. A socket a crashed run left is replaced
/// (single-instance: no other app of ours holds it); anything else at that name is refused.
#[cfg(unix)]
pub fn bind_socket(dir: &Path) -> std::io::Result<std::os::unix::net::UnixListener> {
    use std::os::unix::fs::{FileTypeExt, PermissionsExt};
    std::fs::create_dir_all(dir)?;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    let path = dir.join(crate::cli_registry::SOCKET_FILE);
    match std::fs::symlink_metadata(&path) {
        Ok(m) if m.file_type().is_socket() => std::fs::remove_file(&path)?,
        Ok(_) => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "something that is not a socket sits at cli.sock",
            ))
        }
        Err(_) => {}
    }
    let listener = std::os::unix::net::UnixListener::bind(&path)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

// ── AppHandle glue ───────────────────────────────────────────────────────────

#[cfg(unix)]
mod glue {
    use super::*;
    use crate::sidecar::SidecarState;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tauri::{AppHandle, Manager};
    use tauri_plugin_dialog::DialogExt;

    static TICKETS: std::sync::LazyLock<Mutex<Tickets>> =
        std::sync::LazyLock::new(Default::default);
    static CONNS: AtomicUsize = AtomicUsize::new(0);
    /// How long `ensure` waits for a tab's server to come up before it answers `not-ready`.
    const SERVER_WAIT_MS: u64 = 45_000;

    /// Start listening. Call once from `setup`, after `SidecarState` is managed. Best-effort: without
    /// the socket the CLI keeps today's behaviour (its own headless server).
    pub(crate) fn start(app: &AppHandle) {
        let Ok(dir) = app.path().app_data_dir() else {
            return;
        };
        let listener = match bind_socket(&dir) {
            Ok(l) => l,
            Err(e) => {
                crate::sidecar::log_line(&format!("[maude] terminal channel not started: {e}"));
                return;
            }
        };
        watch_leases(app);
        let uid = my_uid();
        let app = app.clone();
        let spawned = std::thread::Builder::new()
            .name("maude-cli-sock".into())
            .spawn(move || {
                for conn in listener.incoming() {
                    let Ok(stream) = conn else { continue };
                    if app
                        .state::<SidecarState>()
                        .shutting_down
                        .load(Ordering::SeqCst)
                    {
                        break;
                    }
                    if CONNS.fetch_add(1, Ordering::SeqCst) >= MAX_CONNECTIONS {
                        CONNS.fetch_sub(1, Ordering::SeqCst);
                        continue; // dropped: closed
                    }
                    let app = app.clone();
                    let ok = std::thread::Builder::new()
                        .name("maude-cli-conn".into())
                        .spawn(move || {
                            serve_conn(stream, uid, &|op| handle(&app, op));
                            CONNS.fetch_sub(1, Ordering::SeqCst);
                        });
                    if ok.is_err() {
                        CONNS.fetch_sub(1, Ordering::SeqCst);
                    }
                }
            });
        if let Err(e) = spawned {
            crate::sidecar::log_line(&format!(
                "[maude] terminal channel thread did not start: {e}"
            ));
        }
    }

    /// How often the lease watcher looks for a lease that ended by itself.
    const LEASE_WATCH: Duration = Duration::from_secs(2);

    /// A lease begins or ends (by itself, too): the registry's `busy` and the strip's AI dot follow.
    fn watch_leases(app: &AppHandle) {
        let app = app.clone();
        let _ = std::thread::Builder::new()
            .name("maude-cli-leases".into())
            .spawn(move || {
                let mut last = std::collections::BTreeSet::new();
                loop {
                    std::thread::sleep(LEASE_WATCH);
                    if app
                        .state::<SidecarState>()
                        .shutting_down
                        .load(Ordering::SeqCst)
                    {
                        break;
                    }
                    let live = live_leases();
                    if live != last {
                        crate::cli_registry::publish(&app);
                        crate::tabs::changed(&app);
                        last = live;
                    }
                }
            });
    }

    /// The dirs no terminal-supplied root may be in (or contain): every app dir, the profile config
    /// folders (both the XDG one and the legacy `~/.config/maude`) and the credential folders.
    fn forbidden(app: &AppHandle) -> Vec<PathBuf> {
        let p = app.path();
        let mut v: Vec<PathBuf> = [
            p.app_data_dir(),
            p.app_config_dir(),
            p.app_local_data_dir(),
            p.app_cache_dir(),
            p.app_log_dir(),
        ]
        .into_iter()
        .filter_map(Result::ok)
        .collect();
        v.push(crate::profiles::config_root());
        let home = crate::profiles::home_dir();
        v.push(home.join(".config").join("maude"));
        v.extend(credential_dirs(&home));
        v
    }

    fn is_known(app: &AppHandle) -> impl Fn(&Path) -> bool {
        let st = crate::app_state::load(app);
        let mut known: HashSet<String> = st.projects.keys().cloned().collect();
        known.extend(
            st.recent_projects
                .iter()
                .map(|r| crate::windows::pid_for_root(r)),
        );
        move |p: &Path| known.contains(&crate::windows::pid_for_root(&p.to_string_lossy()))
    }

    /// The tab showing `root` (matched by project id, so any spelling of the folder finds it):
    /// `(label, resting, the root as the tab holds it)`. The pool is keyed by the TAB's spelling, so
    /// every server lookup goes through the third value, never the terminal's realpath.
    fn label_of(app: &AppHandle, root: &str) -> Option<(String, bool, String)> {
        let state = app.state::<SidecarState>();
        let book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
        let label = book.label_for_root(root)?;
        let resting = book.is_resting(&label);
        let tab_root = book.root_of(&label).unwrap_or_else(|| root.to_string());
        Some((label, resting, tab_root))
    }

    fn random_ticket() -> Option<String> {
        let mut buf = [0u8; 16];
        getrandom::getrandom(&mut buf).ok()?;
        Some(buf.iter().map(|b| format!("{b:02x}")).collect())
    }

    pub(super) fn handle(app: &AppHandle, op: Op) -> Value {
        if app
            .state::<SidecarState>()
            .shutting_down
            .load(Ordering::SeqCst)
        {
            return json!({ "status": "denied" });
        }
        let root_of = |raw: &str| validate_root(raw, &forbidden(app));
        match op {
            Op::Ensure {
                root,
                purpose,
                lease,
                expect,
                ..
            } => match root_of(&root) {
                Ok(real) => {
                    let expect = expect.and_then(|e| e.branch);
                    ensure(app, &real, purpose, None, None, lease.as_ref(), expect.as_deref())
                }
                Err(r) => r.reply(),
            },
            Op::Show {
                root,
                canvas,
                artboard,
                ..
            } => match root_of(&root) {
                Ok(real) => {
                    let canvas = canvas
                        .as_deref()
                        .and_then(crate::project_resolve::validate_open_param);
                    ensure(app, &real, Purpose::Show, canvas, artboard, None, None)
                }
                Err(r) => r.reply(),
            },
            Op::Status { ticket, .. } => status(app, &ticket),
            Op::Lease {
                id, root, ttl_sec, ..
            } => match root_of(&root) {
                Ok(real) => {
                    let r = real.to_string_lossy().into_owned();
                    if label_of(app, &r).is_none() {
                        return Refusal::NotOpen.reply();
                    }
                    LEASES.lock().unwrap_or_else(|e| e.into_inner()).grant(
                        &r,
                        &id,
                        ttl_sec,
                        Instant::now(),
                    );
                    crate::cli_registry::publish(app);
                    json!({ "ok": true })
                }
                Err(e) => e.reply(),
            },
            Op::Release { id, root, .. } => {
                // A root that vanished can still drop its lease: release never opens anything.
                let r = crate::cli_registry::realpath(&root);
                LEASES
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .release(&r, &id);
                json!({ "ok": true })
            }
            Op::Restart { root, .. } => match root_of(&root) {
                Ok(real) => restart(app, &real.to_string_lossy()),
                Err(r) => r.reply(),
            },
        }
    }

    /// `ensure` and `show`: an open tab answers; otherwise first-open trust decides.
    fn ensure(
        app: &AppHandle,
        real: &Path,
        purpose: Purpose,
        canvas: Option<String>,
        artboard: Option<String>,
        lease: Option<&LeaseAsk>,
        expect: Option<&str>,
    ) -> Value {
        let root = real.to_string_lossy().into_owned();
        if let Some((label, _, tab_root)) = label_of(app, &root) {
            let warning = match branch_gate(app, &root, &label, &tab_root, expect) {
                Ok(w) => w,
                Err(refused) => return refused,
            };
            let mut reply = answer_open(app, &root, purpose, canvas, artboard, lease);
            if let (Some(w), Some(obj)) = (warning, reply.as_object_mut()) {
                if obj.get("status").and_then(Value::as_str) != Some("refused") {
                    obj.insert("warning".into(), w);
                }
            }
            return reply;
        }
        let enabled = crate::prefs::load(app).terminal_opens;
        let declined = TICKETS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .declined(real);
        match trust_for(real, enabled, declined, &is_known(app)) {
            Trust::Denied => json!({ "status": "denied" }),
            Trust::Silent { .. } => {
                if cap_full(app) {
                    return json!({ "status": "cap-full" });
                }
                answer_open(app, &root, purpose, canvas, artboard, lease)
            }
            Trust::Ask => {
                let Some(id) = random_ticket() else {
                    return Refusal::NotReady.reply();
                };
                let t = Ticket {
                    root: real.to_path_buf(),
                    purpose,
                    canvas,
                    artboard,
                    lease: lease.cloned(),
                    answer: Answer::Pending,
                    created: Instant::now(),
                };
                let opened =
                    TICKETS
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .open(id, t, Instant::now());
                match opened {
                    Ok((id, true)) => {
                        ask(app, real, &id);
                        json!({ "status": "consent", "ticket": id })
                    }
                    Ok((id, false)) => json!({ "status": "consent", "ticket": id }),
                    Err(r) => r.reply(),
                }
            }
        }
    }

    /// Contract §6 "Branch mismatch" for an open tab: the folder's HEAD against the branch the tab
    /// was opened with (and the agent's own `expect`). A change relabels the tab, shows its one
    /// line and rides the reply as a warning — unless the tab has unsent changes: refused.
    fn branch_gate(
        app: &AppHandle,
        root: &str,
        label: &str,
        tab_root: &str,
        expect: Option<&str>,
    ) -> Result<Option<Value>, Value> {
        let now = crate::project_resolve::current_branch(Path::new(root));
        let was = {
            let mut b = BRANCHES.lock().unwrap_or_else(|e| e.into_inner());
            match b.was(root) {
                Some(w) => w,
                None => {
                    // A tab this channel never saw open: what it shows now is what it was opened with.
                    b.note(root, now.clone());
                    now.clone()
                }
            }
        };
        let unsent = if was != now {
            tauri::async_runtime::block_on(crate::sidecar::shell_status(app, tab_root))
                .map(|s| s.unsent)
        } else {
            None
        };
        match branch_check(was.as_deref(), now.as_deref(), expect, unsent) {
            BranchCheck::Same => Ok(None),
            BranchCheck::RefuseUnsent => Err(Refusal::BranchChangedUnsent.reply()),
            c @ BranchCheck::Changed { .. } => {
                if was != now {
                    BRANCHES
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .note(root, now.clone());
                    if let BranchCheck::Changed { was, now } = &c {
                        crate::bus::send(
                            label,
                            "shell://branch-changed",
                            json!({ "was": was, "now": now }),
                        );
                    }
                    crate::tabs::changed(app);
                    crate::cli_registry::publish(app);
                }
                Ok(c.warning())
            }
        }
    }

    fn status(app: &AppHandle, ticket: &str) -> Value {
        let Some(t) = TICKETS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(ticket, Instant::now())
        else {
            return Refusal::UnknownTicket.reply();
        };
        match t.answer {
            Answer::Pending => json!({ "status": "consent", "ticket": ticket }),
            Answer::NotNow => json!({ "status": "denied" }),
            Answer::Open => {
                let root = t.root.to_string_lossy().into_owned();
                if label_of(app, &root).is_none() {
                    // Open was answered and the tab is still being built (`on_answer` opens it off
                    // the sheet's thread), or it was closed again: keep the CLI polling — it stops
                    // by itself (≤ 60 s) and the ticket ends after TICKET_TTL. Answering not-open
                    // here raced the build and failed the run the person had just allowed.
                    return json!({ "status": "consent", "ticket": ticket });
                }
                answer_open(app, &root, t.purpose, None, None, t.lease.as_ref())
            }
        }
    }

    /// The one sheet (contract §7 option A). Maude comes to the front first. The default button is
    /// Not now; an Open pressed sooner than `SHEET_OPEN_DELAY` after the sheet showed raises it again.
    fn ask(app: &AppHandle, real: &Path, id: &str) {
        crate::windows::reveal_front(app);
        let (title, message) = sheet_text(real);
        let app2 = app.clone();
        let real2 = real.to_path_buf();
        let id = id.to_string();
        // Desktop e2e (`cli-reuse`): a native sheet is not DOM-reachable, so a debug build started
        // with MAUDE_E2E_CLI_CONSENT=1 parks the ticket instead and `e2e_cli_consent` answers it
        // through the same `on_answer`. Never compiled into a release build.
        #[cfg(debug_assertions)]
        if e2e_consent_parked() {
            crate::sidecar::log_line(&format!(
                "[maude] e2e: the terminal consent sheet for {} waits for e2e_cli_consent",
                crate::notify::sanitize_title(&real.to_string_lossy())
            ));
            return;
        }
        let (first, second) = sheet_buttons();
        let shown = Instant::now();
        app.dialog()
            .message(message)
            .title(title)
            .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
                first.to_string(),
                second.to_string(),
            ))
            .show_with_result(move |res| {
                let pressed = match &res {
                    tauri_plugin_dialog::MessageDialogResult::Custom(s) => Some(s.as_str()),
                    _ => None,
                };
                match sheet_answer(pressed, shown, Instant::now()) {
                    SheetAnswer::Open => {
                        on_answer(&app2, &id, true);
                    }
                    SheetAnswer::NotNow => {
                        on_answer(&app2, &id, false);
                    }
                    SheetAnswer::TooSoon => {
                        let pending = TICKETS
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .get(&id, Instant::now())
                            .is_some_and(|t| t.answer == Answer::Pending);
                        if pending {
                            ask(&app2, &real2, &id);
                        }
                    }
                }
            });
    }

    /// The person answered the sheet for ticket `id` (or, in a debug e2e build, `e2e_cli_consent`).
    /// Returns the folder when the answer was taken.
    fn on_answer(app: &AppHandle, id: &str, open: bool) -> Option<PathBuf> {
        let t = TICKETS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .answer(id, open)?;
        let root = t.root.clone();
        if !open {
            crate::sidecar::log_line("[maude] terminal open: Not now");
            return Some(root);
        }
        // Open is remembered: the folder joins the project list (the person chose it, so it adopts
        // the last sign-in's profile like any folder opened from Home). Off the dialog's thread, as
        // File › Open does (`remember_and_open`): building a tab waits on it.
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            let target = t.canvas.clone();
            let r = crate::windows::open_project_window(
                &app2,
                &t.root,
                None,
                target.as_deref(),
                crate::app_state::Binding::Adopt,
            );
            match r {
                Ok(o) => {
                    park_target(&o, t.canvas, t.artboard);
                    crate::windows::reveal_front(&app2);
                }
                Err(e) => crate::sidecar::log_line(&format!("[maude] terminal open failed: {e}")),
            }
        });
        Some(root)
    }

    /// Debug builds only: the e2e app parks consent tickets instead of raising the native sheet.
    #[cfg(debug_assertions)]
    fn e2e_consent_parked() -> bool {
        std::env::var("MAUDE_E2E_CLI_CONSENT").is_ok_and(|v| v == "1")
    }

    /// Debug builds only: answer the oldest pending sheet (`e2e_cli_consent`).
    #[cfg(debug_assertions)]
    pub(crate) fn e2e_answer_oldest(app: &AppHandle, open: bool) -> Option<PathBuf> {
        if !e2e_consent_parked() {
            return None;
        }
        let id = TICKETS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .oldest_pending(Instant::now())?;
        on_answer(app, &id, open)
    }

    fn park_target(o: &crate::windows::Opened, canvas: Option<String>, artboard: Option<String>) {
        if canvas.is_none() && artboard.is_none() {
            return;
        }
        let target = crate::windows::OpenTarget {
            canvas,
            artboard,
            thread: None,
            via: None,
            from: None,
        };
        crate::windows::park_navigate_for_new(o, Some(&target));
        if let crate::windows::Opened::Existing(label) = o {
            crate::bus::send(label, "shell://navigate", target.clone());
        }
    }

    /// The tab for `root` (opened silently when needed — a worktree or a known folder, never the
    /// project list), then the reply: `shown` for show, the port once its server is up for capture.
    fn answer_open(
        app: &AppHandle,
        root: &str,
        purpose: Purpose,
        canvas: Option<String>,
        artboard: Option<String>,
        lease: Option<&LeaseAsk>,
    ) -> Value {
        let background = purpose == Purpose::Capture;
        // A resting tab wakes; a capture never moves the person's view (contract §10.3).
        if let Some((label, true, tab_root)) = label_of(app, root) {
            if cap_full(app) {
                return json!({ "status": "cap-full" });
            }
            // `show` focuses the tab, and focusing a resting tab wakes it (windows::on_focused).
            if background && !wake(app, &label, &tab_root) {
                return Refusal::RootMissing.reply();
            }
        }
        let opened =
            crate::windows::open_window_for_root_as(app, root, None, canvas.as_deref(), background);
        let opened = match opened {
            Ok(o) => o,
            Err(e) => {
                crate::sidecar::log_line(&format!("[maude] terminal open of {root} failed: {e}"));
                return Refusal::NotReady.reply();
            }
        };
        let label = opened.label().to_string();
        if let Some(l) = lease {
            LEASES.lock().unwrap_or_else(|e| e.into_inner()).grant(
                root,
                &l.id,
                l.ttl_sec,
                Instant::now(),
            );
        }
        if purpose == Purpose::Show {
            park_target(&opened, canvas, artboard);
            crate::windows::reveal_front(app);
            return json!({ "status": "shown", "label": label });
        }
        let tab_root = label_of(app, root).map_or_else(|| root.to_string(), |(_, _, r)| r);
        let up = tauri::async_runtime::block_on(crate::sidecar::wait_for_shell_url(
            app,
            &tab_root,
            SERVER_WAIT_MS,
        ));
        let port = up
            .ok()
            .and_then(|u| u.parse::<tauri::Url>().ok())
            .and_then(|u| u.port());
        match port {
            Some(port) => json!({ "status": "running", "port": port, "label": label }),
            None => Refusal::NotReady.reply(),
        }
    }

    /// Wake a resting tab without focusing it (its server, then its page once up).
    fn wake(app: &AppHandle, label: &str, root: &str) -> bool {
        let state = app.state::<SidecarState>();
        let woke = state
            .windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .set_resting(label, false);
        if !woke {
            return true; // someone else woke it meanwhile
        }
        if crate::tabs::root_missing(root) {
            crate::tabs::show_missing(app, label, root);
            return false;
        }
        crate::sidecar::log_line(&format!(
            "[maude] {label} was resting — the terminal wakes {root}"
        ));
        crate::sidecar::attach_or_spawn(app, root);
        crate::sidecar::spawn_enforce_cap(app);
        crate::windows::navigate_when_up(app, label.to_string(), root.to_string(), None);
        crate::tabs::changed(app);
        true
    }

    /// `cap-full` (contract §6): `RUNNING_CAP` servers run and every one is in use — the front tab, a
    /// live lease, still booting, busy, or a status nobody could read.
    fn cap_full(app: &AppHandle) -> bool {
        let state = app.state::<SidecarState>();
        let running: Vec<String> = {
            let pool = state.instances.lock().unwrap_or_else(|e| e.into_inner());
            pool.iter()
                .filter(|(_, i)| i.child.is_some())
                .map(|(r, _)| r.clone())
                .collect()
        };
        if running.len() < crate::sidecar::running_cap() {
            return false;
        }
        let front = state
            .windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .front_label();
        tauri::async_runtime::block_on(async {
            for root in &running {
                let is_front =
                    label_of(app, root).is_some_and(|(l, _, _)| Some(&l) == front.as_ref());
                if is_front || leased(root) || crate::sidecar::shell_origin(app, root).is_none() {
                    continue;
                }
                match crate::sidecar::shell_status(app, root).await {
                    Some(s) if !s.busy() => return false,
                    _ => continue,
                }
            }
            true
        })
    }

    /// `restart` — the "Try again" path for a tab's server (DDR-235): stop it, start a fresh one,
    /// reload the tab on it. Never for a busy server (running AI, unsent changes, a job).
    fn restart(app: &AppHandle, root: &str) -> Value {
        let Some((label, resting, root)) = label_of(app, root) else {
            return Refusal::NotOpen.reply();
        };
        if resting {
            return Refusal::NotOpen.reply();
        }
        // No answer at all is allowed: a server that cannot answer is what a restart is for.
        let status = tauri::async_runtime::block_on(crate::sidecar::shell_status(app, &root));
        if status.as_ref().is_some_and(|s| s.busy()) {
            return Refusal::Busy.reply();
        }
        crate::sidecar::log_line(&format!(
            "[maude] the terminal asked to restart {root}'s server"
        ));
        crate::sidecar::shutdown_instance(app, &root);
        crate::sidecar::attach_or_spawn(app, &root);
        crate::windows::navigate_when_up(app, label, root.clone(), None);
        crate::cli_registry::publish(app);
        json!({ "status": "restarting" })
    }
}

#[cfg(unix)]
pub(crate) use glue::start;

/// Windows/Linux named-pipe variant is contract §10.4 (after macOS); no listener there yet.
#[cfg(not(unix))]
pub(crate) fn start(_app: &tauri::AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("maude-206-ch-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::canonicalize(&d).unwrap()
    }

    fn project(at: &Path) -> PathBuf {
        std::fs::create_dir_all(at.join(".design")).unwrap();
        std::fs::write(at.join(".design/config.json"), "{}").unwrap();
        at.to_path_buf()
    }

    #[test]
    fn requests_parse_with_every_field_checked() {
        let ok = parse_request(br#"{"v":1,"op":"ensure","root":"/a","purpose":"capture","lease":{"id":"run-1","ttlSec":300}}"#);
        assert!(
            matches!(
                ok,
                Ok(Op::Ensure {
                    purpose: Purpose::Capture,
                    ..
                })
            ),
            "{ok:?}"
        );
        assert!(parse_request(
            br#"{"v":1,"op":"show","root":"/a","canvas":"ui/A.tsx","artboard":"hero"}"#
        )
        .is_ok());
        assert!(parse_request(
            br#"{"v":1,"op":"status","ticket":"0123456789abcdef0123456789abcdef"}"#
        )
        .is_ok());
        assert!(parse_request(br#"{"v":1,"op":"lease","id":"a","root":"/a"}"#).is_ok());
        assert!(parse_request(br#"{"v":1,"op":"release","id":"a","root":"/a"}"#).is_ok());
        assert!(parse_request(br#"{"v":1,"op":"restart","root":"/a"}"#).is_ok());
        for bad in [
            &br#"{"v":2,"op":"restart","root":"/a"}"#[..],
            br#"{"op":"restart","root":"/a"}"#,
            br#"{"v":1,"op":"launch","root":"/a"}"#,
            br#"{"v":1,"op":"restart","root":"/a","profile":"work"}"#,
            br#"{"v":1,"op":"ensure","root":"/a","purpose":"capture","profile":"work"}"#,
            br#"{"v":1,"op":"ensure","root":"/a","purpose":"exec"}"#,
            br#"{"v":1,"op":"ensure","root":"/a","purpose":"capture","lease":{"id":"x","ttlSec":601}}"#,
            br#"{"v":1,"op":"lease","id":"a b","root":"/a"}"#,
            br#"{"v":1,"op":"status","ticket":"../../etc"}"#,
            br#"{"v":1,"op":"show","root":"/a","canvas":"../outside.tsx"}"#,
            br#"{"v":1,"op":"show","root":"/a","artboard":"a/b"}"#,
            br#"{"v":1,"op":"show","root":"/a","mode":"Present Now"}"#,
            br#"not json"#,
        ] {
            assert_eq!(parse_request(bad), Err(Refusal::BadRequest), "{}", String::from_utf8_lossy(bad));
        }
        let mut big = br#"{"v":1,"op":"restart","root":"/"#.to_vec();
        big.extend(std::iter::repeat_n(b'a', MAX_REQUEST));
        big.extend(br#""}"#);
        assert_eq!(parse_request(&big), Err(Refusal::TooLarge));
    }

    #[test]
    fn a_request_is_read_to_the_newline_and_capped() {
        let mut r = std::io::Cursor::new(b"{\"a\":1}\ntrailing".to_vec());
        assert_eq!(read_request(&mut r).unwrap(), b"{\"a\":1}");
        let mut r = std::io::Cursor::new(vec![b'x'; MAX_REQUEST + 1]);
        assert_eq!(read_request(&mut r), Err(Refusal::TooLarge));
        let mut r = std::io::Cursor::new(vec![b'x'; MAX_REQUEST]);
        assert_eq!(read_request(&mut r).unwrap().len(), MAX_REQUEST);
    }

    #[test]
    fn roots_must_be_absolute_real_maude_projects_outside_the_app_dirs() {
        let base = scratch("roots");
        let p = project(&base.join("proj"));
        let none = base.join("plain");
        std::fs::create_dir_all(&none).unwrap();
        let app_data = base.join("app-data");
        std::fs::create_dir_all(&app_data).unwrap();
        let forbidden = vec![app_data.clone()];

        assert_eq!(
            validate_root(&p.to_string_lossy(), &forbidden),
            Ok(p.clone())
        );
        assert_eq!(
            validate_root("proj", &forbidden),
            Err(Refusal::RootNotAbsolute)
        );
        assert_eq!(validate_root("", &forbidden), Err(Refusal::BadRequest));
        assert_eq!(
            validate_root(&base.join("gone").to_string_lossy(), &forbidden),
            Err(Refusal::RootMissing)
        );
        assert_eq!(
            validate_root(&none.to_string_lossy(), &forbidden),
            Err(Refusal::NotAProject)
        );
        // `.design/` alone is not enough: the contract asks for `.design/config.json`.
        std::fs::create_dir_all(none.join(".design")).unwrap();
        assert_eq!(
            validate_root(&none.to_string_lossy(), &forbidden),
            Err(Refusal::NotAProject)
        );
        // Inside the app's data (a managed copy, the registry) — even a real project there.
        let inside = project(&app_data.join("managed/x"));
        assert_eq!(
            validate_root(&inside.to_string_lossy(), &forbidden),
            Err(Refusal::AppData)
        );
        // A folder that CONTAINS the app's data (its server would serve the keys).
        project(&base);
        assert_eq!(
            validate_root(&base.to_string_lossy(), &forbidden),
            Err(Refusal::AppData)
        );
        // The realpath is what is checked and returned: a link into the app dir is refused too.
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&inside, base.join("link")).unwrap();
            assert_eq!(
                validate_root(&base.join("link").to_string_lossy(), &forbidden),
                Err(Refusal::AppData)
            );
            std::os::unix::fs::symlink(&p, base.join("link2")).unwrap();
            assert_eq!(
                validate_root(&base.join("link2").to_string_lossy(), &[]),
                Ok(p.clone())
            );
        }
        assert_eq!(validate_root("/a\0b", &forbidden), Err(Refusal::BadRequest));
        std::fs::remove_dir_all(base).unwrap();
    }

    fn worktree(base: &Path) -> (PathBuf, PathBuf) {
        let main = project(&base.join("main"));
        let g = main.join(".git/worktrees/wt");
        std::fs::create_dir_all(&g).unwrap();
        std::fs::write(main.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        let wt = project(&base.join("wt"));
        std::fs::write(wt.join(".git"), format!("gitdir: {}\n", g.display())).unwrap();
        std::fs::write(g.join("gitdir"), format!("{}\n", wt.join(".git").display())).unwrap();
        std::fs::write(g.join("commondir"), "../..\n").unwrap();
        std::fs::write(g.join("HEAD"), "ref: refs/heads/feat-x\n").unwrap();
        (main, wt)
    }

    #[test]
    fn first_open_trust_is_option_a() {
        let base = scratch("trust");
        let (main, wt) = worktree(&base);
        let stranger = project(&base.join("cloned"));
        let known_main = |p: &Path| p == main.as_path();
        let nothing = |_: &Path| false;

        // Known folder: silent. Verified worktree of a known folder: silent, naming its main.
        assert_eq!(
            trust_for(&main, true, false, &known_main),
            Trust::Silent { worktree_of: None }
        );
        assert_eq!(
            trust_for(&wt, true, false, &known_main),
            Trust::Silent {
                worktree_of: Some(main.clone())
            }
        );
        // Anything else: ask. A worktree of a folder Maude never opened is "anything else".
        assert_eq!(trust_for(&stranger, true, false, &known_main), Trust::Ask);
        assert_eq!(trust_for(&wt, true, false, &nothing), Trust::Ask);
        // Not now this run: no second sheet.
        assert_eq!(trust_for(&stranger, true, true, &known_main), Trust::Denied);
        // The switch off: nothing opens from the terminal, known or not.
        assert_eq!(trust_for(&main, false, false, &known_main), Trust::Denied);
        assert_eq!(trust_for(&wt, false, false, &known_main), Trust::Denied);
        assert_eq!(
            trust_for(&stranger, false, false, &known_main),
            Trust::Denied
        );

        // A planted `.git` file (no back-reference from the main repo) is no worktree: it asks.
        let planted = project(&base.join("planted"));
        std::fs::write(
            planted.join(".git"),
            format!("gitdir: {}\n", main.join(".git/worktrees/wt").display()),
        )
        .unwrap();
        assert_eq!(trust_for(&planted, true, false, &known_main), Trust::Ask);
        std::fs::remove_dir_all(base).unwrap();
    }

    fn ticket(root: &str, now: Instant) -> Ticket {
        Ticket {
            root: PathBuf::from(root),
            purpose: Purpose::Capture,
            canvas: None,
            artboard: None,
            lease: None,
            answer: Answer::Pending,
            created: now,
        }
    }

    #[test]
    fn one_sheet_per_folder_a_cap_on_sheets_and_not_now_is_kept() {
        let now = Instant::now();
        let mut t = Tickets::default();
        let (a, raise) = t.open("a".repeat(32), ticket("/x", now), now).unwrap();
        assert!(raise);
        // The same folder again while its sheet is up: the same ticket, no second sheet.
        let (a2, raise) = t.open("b".repeat(32), ticket("/x", now), now).unwrap();
        assert_eq!((a2.as_str(), raise), (a.as_str(), false));
        for (i, r) in ["/y", "/z"].iter().enumerate() {
            t.open(format!("{i:032}"), ticket(r, now), now).unwrap();
        }
        assert_eq!(
            t.open("c".repeat(32), ticket("/v", now), now).err(),
            Some(Refusal::TooManySheets)
        );

        // Not now: answered once, kept for the run; a second answer changes nothing.
        let got = t.answer(&a, false).unwrap();
        assert_eq!(got.answer, Answer::NotNow);
        assert!(t.declined(Path::new("/x")));
        assert!(t.answer(&a, true).is_none(), "a ticket is answered once");
        assert_eq!(t.get(&a, now).unwrap().answer, Answer::NotNow);
        // Open on another folder: not declined.
        let y = format!("{:032}", 0);
        assert_eq!(t.answer(&y, true).unwrap().answer, Answer::Open);
        assert!(!t.declined(Path::new("/y")));
        // Tickets expire.
        assert!(t
            .get(&y, now + TICKET_TTL + Duration::from_secs(1))
            .is_none());
        assert!(
            t.answer(&"f".repeat(32), true).is_none(),
            "an unknown ticket answers nothing"
        );
    }

    #[test]
    fn leases_expire_by_themselves_and_are_capped() {
        let now = Instant::now();
        let mut l = Leases::default();
        assert!(!l.is_leased("/r", now));
        l.grant("/r", "a", Some(10), now);
        assert!(l.is_leased("/r", now + Duration::from_secs(9)));
        assert!(
            !l.is_leased("/r", now + Duration::from_secs(10)),
            "a dead agent leaves no stuck tab"
        );
        l.grant("/r", "a", None, now);
        assert!(l.is_leased("/r", now + Duration::from_secs(LEASE_DEFAULT_SECS - 1)));
        assert!(!l.is_leased("/r", now + Duration::from_secs(LEASE_DEFAULT_SECS)));
        l.grant("/r", "b", Some(99_999), now);
        assert!(
            !l.is_leased("/r", now + Duration::from_secs(LEASE_MAX_SECS)),
            "capped at {LEASE_MAX_SECS}s"
        );
        l.grant("/r", "a", Some(60), now);
        l.grant("/r", "b", Some(60), now);
        l.release("/r", "a");
        assert!(l.is_leased("/r", now), "another lease still holds it");
        l.release("/r", "b");
        assert!(!l.is_leased("/r", now));
        assert!(!l.is_leased("/other", now));
    }

    #[cfg(unix)]
    #[test]
    fn the_socket_is_0600_in_a_0700_dir_and_never_replaces_a_non_socket() {
        use std::os::unix::fs::PermissionsExt;
        let base = scratch("bind");
        let dir = base.join("app-data");
        let l = bind_socket(&dir).unwrap();
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&dir), 0o700);
        assert_eq!(mode(&dir.join("cli.sock")), 0o600);
        drop(l);
        // A crashed run's socket is replaced.
        assert!(bind_socket(&dir).is_ok());
        // A regular file at that name is never removed or bound over.
        std::fs::remove_file(dir.join("cli.sock")).unwrap();
        std::fs::write(dir.join("cli.sock"), "keep").unwrap();
        assert!(bind_socket(&dir).is_err());
        assert_eq!(
            std::fs::read_to_string(dir.join("cli.sock")).unwrap(),
            "keep"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[cfg(unix)]
    fn round_trip(uid: u32, request: &[u8]) -> Vec<u8> {
        use std::os::unix::net::UnixStream;
        let (mut client, server) = UnixStream::pair().unwrap();
        let t = std::thread::spawn(move || {
            serve_conn(server, uid, &|op| match op {
                Op::Restart { .. } => json!({ "status": "restarting" }),
                _ => json!({ "status": "denied" }),
            })
        });
        // The server may close early (another uid, an oversize request): a broken pipe is expected.
        let _ = client.write_all(request);
        let _ = client.shutdown(std::net::Shutdown::Write);
        let mut out = Vec::new();
        client
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let _ = client.read_to_end(&mut out);
        t.join().unwrap();
        out
    }

    #[cfg(unix)]
    #[test]
    fn the_same_user_gets_one_reply_and_another_user_gets_nothing() {
        assert_eq!(
            peer_uid(&std::os::unix::net::UnixStream::pair().unwrap().0),
            Some(my_uid())
        );
        let req = br#"{"v":1,"op":"restart","root":"/a"}"#;
        let out = round_trip(my_uid(), req);
        assert_eq!(
            serde_json::from_slice::<Value>(&out).unwrap()["status"],
            "restarting"
        );
        // Another uid: closed without a byte, and the handler never ran.
        let out = round_trip(my_uid().wrapping_add(1), req);
        assert!(out.is_empty(), "{}", String::from_utf8_lossy(&out));
    }

    #[cfg(unix)]
    #[test]
    fn oversize_and_malformed_requests_are_refused_without_reaching_the_handler() {
        let mut big = br#"{"v":1,"op":"restart","root":"/"#.to_vec();
        big.extend(std::iter::repeat_n(b'a', MAX_REQUEST + 10));
        let out = round_trip(my_uid(), &big);
        let v: Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(
            (v["status"].as_str(), v["reason"].as_str()),
            (Some("refused"), Some("too-large"))
        );
        let out = round_trip(my_uid(), b"{\"v\":1,\"op\":\"restart\"}\n");
        let v: Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["reason"], "bad-request");
    }

    /// Contract §6 "Busy": a live lease keeps a tab from idle rest AND from the running cap. Both
    /// sweeps are async + HTTP (no unit seam), so this pins that each consults `leased` before it
    /// probes a candidate's status.
    #[test]
    fn idle_rest_and_the_cap_both_skip_a_leased_tab() {
        let idle = include_str!("idle_rest.rs");
        let sweep = &idle[idle.find("async fn sweep_once(").unwrap()..];
        let sweep = &sweep[..sweep.find("\n}\n").unwrap()];
        let lease = sweep
            .find("crate::cli_channel::leased(&v.root)")
            .expect("idle rest reads leases");
        assert!(lease < sweep.find("shell_status(").unwrap());

        let side = include_str!("sidecar.rs");
        let cap = &side[side.find("async fn enforce_cap(").unwrap()..];
        let cap = &cap[..cap.find("\n}\n").unwrap()];
        let lease = cap
            .find("crate::cli_channel::leased(&c.root)")
            .expect("the cap reads leases");
        assert!(lease < cap.find("c.status = shell_status(").unwrap());
    }

    /// A source pin: `serve_conn` checks the peer before it reads, so no later edit parses an
    /// unverified peer's bytes.
    #[test]
    fn serve_conn_checks_the_peer_before_reading() {
        let src = include_str!("cli_channel.rs");
        let body = &src[src.find("pub fn serve_conn(").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        let check = body
            .find("peer_uid(&stream) != Some(uid)")
            .expect("uid check");
        let read = body.find("read_request(").expect("read");
        assert!(check < read);
    }

    #[test]
    fn a_branch_change_warns_and_unsent_changes_refuse() {
        use BranchCheck::*;
        assert_eq!(branch_check(Some("main"), Some("main"), None, Some(0)), Same);
        assert_eq!(
            branch_check(Some("a"), Some("b"), None, Some(0)),
            Changed { was: "a".into(), now: "b".into() }
        );
        assert_eq!(
            branch_check(Some("a"), None, None, None),
            Changed { was: "a".into(), now: "detached".into() },
            "an unreadable status is no unsent changes; a detached HEAD has a name"
        );
        assert_eq!(branch_check(Some("a"), Some("b"), None, Some(2)), RefuseUnsent);
        // The agent's own HEAD differs from the folder's: the same warning, never a refusal.
        assert_eq!(
            branch_check(Some("b"), Some("b"), Some("a"), Some(3)),
            Changed { was: "a".into(), now: "b".into() }
        );
        assert_eq!(branch_check(Some("b"), Some("b"), Some("b"), Some(3)), Same);
        assert_eq!(
            Refusal::BranchChangedUnsent.reply()["reason"],
            "branch-changed-unsent",
            "the CLI matches this word"
        );
        let w = BranchCheck::Changed { was: "a".into(), now: "b".into() }.warning();
        assert_eq!(w, Some(json!({ "kind": "branch-changed", "was": "a", "now": "b" })));
    }

    #[test]
    fn a_tab_keeps_the_branch_it_was_opened_with_until_a_change_is_told() {
        let mut b = TabBranches::default();
        assert_eq!(b.was("/r"), None, "never noted");
        b.note("/r", Some("main".into()));
        b.note("/r2", None);
        assert_eq!(b.was("/r"), Some(Some("main".into())));
        assert_eq!(b.was("/r2"), Some(None));
        b.note("/r", Some("feat".into()));
        assert_eq!(b.was("/r"), Some(Some("feat".into())));
    }

    #[test]
    fn the_live_lease_set_changes_when_a_lease_ends() {
        let now = Instant::now();
        let mut l = Leases::default();
        l.grant("/a", "x", Some(5), now);
        l.grant("/b", "y", Some(50), now);
        assert_eq!(l.live_roots(now).into_iter().collect::<Vec<_>>(), ["/a", "/b"]);
        assert_eq!(
            l.live_roots(now + Duration::from_secs(6)).into_iter().collect::<Vec<_>>(),
            ["/b"]
        );
    }

    /// F3: three sheets per ten minutes across every folder — answering one does not free a slot,
    /// a different folder does not either; the window slides.
    #[test]
    fn sheets_are_capped_per_app_run_not_per_folder() {
        let now = Instant::now();
        let mut t = Tickets::default();
        for (i, r) in ["/a", "/b", "/c"].iter().enumerate() {
            let (id, raise) = t.open(format!("{i:032}"), ticket(r, now), now).unwrap();
            assert!(raise);
            t.answer(&id, false).unwrap();
        }
        let later = now + Duration::from_secs(60);
        assert_eq!(
            t.open("d".repeat(32), ticket("/d", later), later).err(),
            Some(Refusal::TooManySheets),
            "a fourth folder within ten minutes is refused, though no sheet waits"
        );
        let after = now + SHEET_WINDOW + Duration::from_secs(1);
        assert!(t.open("e".repeat(32), ticket("/e", after), after).unwrap().1);
    }

    /// F3: the sheet names the folder by its own name and full path, never by a label from its
    /// config, and says plainly that Not now still runs the project (in the terminal's server).
    #[test]
    fn the_sheet_shows_the_real_folder_and_honest_words() {
        let base = std::env::temp_dir().join(format!("maude-sheet-{}", std::process::id()));
        let root = base.join("acme-real");
        std::fs::create_dir_all(root.join(".design")).unwrap();
        std::fs::write(
            root.join(".design/config.json"),
            r#"{"name":"Your Bank","projectLabel":"Your Bank"}"#,
        )
        .unwrap();
        let (_title, msg) = sheet_text(&root);
        assert!(msg.contains("\u{201c}acme-real\u{201d}"), "{msg}");
        assert!(msg.contains(&*root.to_string_lossy()), "{msg}");
        assert!(!msg.contains("Your Bank"), "{msg}");
        assert!(msg.contains("hidden server"), "{msg}");
        assert!(!msg.contains("Opening it runs"), "{msg}");
        let (_, msg) = sheet_text(&base.join("ev\u{202e}il"));
        assert!(!msg.contains('\u{202e}'));
        std::fs::remove_dir_all(base).unwrap();
    }

    /// F3: Not now is the default button; Open counts only after the delay; anything else is Not now.
    #[test]
    fn the_sheet_defaults_to_not_now_and_open_waits() {
        assert_eq!(sheet_buttons().0, SHEET_NOT_NOW, "the first button is the default");
        assert_eq!(sheet_buttons().1, SHEET_OPEN);
        let shown = Instant::now();
        let soon = shown + Duration::from_millis(200);
        let late = shown + SHEET_OPEN_DELAY + Duration::from_millis(1);
        assert!(SHEET_OPEN_DELAY >= Duration::from_millis(800));
        assert_eq!(sheet_answer(Some(SHEET_OPEN), shown, soon), SheetAnswer::TooSoon);
        assert_eq!(sheet_answer(Some(SHEET_OPEN), shown, late), SheetAnswer::Open);
        assert_eq!(sheet_answer(Some(SHEET_NOT_NOW), shown, late), SheetAnswer::NotNow);
        assert_eq!(sheet_answer(None, shown, late), SheetAnswer::NotNow);
        assert_eq!(sheet_answer(Some("OK"), shown, late), SheetAnswer::NotNow);
        // The sheet is wired to these and to the button's label, not to "first button pressed".
        let src = include_str!("cli_channel.rs");
        let ask = &src[src.find("    fn ask(app: &AppHandle").unwrap()..];
        let ask = &ask[..ask.find("\n    }\n").unwrap()];
        for needle in ["sheet_text(real)", "sheet_buttons()", "sheet_answer(", ".show_with_result("] {
            assert!(ask.contains(needle), "{needle}");
        }
        assert!(!ask.contains("project_display_name"));
    }

    /// L5: a root inside (or containing) a credential folder is refused like the app's own data.
    #[test]
    fn credential_folders_are_forbidden_roots() {
        let base = std::env::temp_dir().join(format!("maude-cred-roots-{}", std::process::id()));
        let home = base.join("home");
        let forbidden = credential_dirs(&home);
        for d in [".ssh", ".aws", ".gnupg", "Library/Keychains"] {
            let p = project(&home.join(d).join("x"));
            assert_eq!(
                validate_root(&p.to_string_lossy(), &forbidden),
                Err(Refusal::AppData),
                "{d}"
            );
        }
        project(&home);
        assert_eq!(
            validate_root(&home.to_string_lossy(), &forbidden),
            Err(Refusal::AppData),
            "a root containing ~/.ssh"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    /// #206 T6.4 pin: the e2e answer to the consent sheet exists only in a debug build — the park
    /// check, the answer helper and the command body are all behind `debug_assertions`, and a release
    /// build's command answers Err.
    #[test]
    fn the_e2e_consent_answer_is_debug_only() {
        let src = include_str!("cli_channel.rs");
        let ask = &src[src.find("    fn ask(app: &AppHandle").unwrap()..];
        let ask = &ask[..ask.find("\n    }\n").unwrap()];
        let gate = ask.find("#[cfg(debug_assertions)]\n        if e2e_consent_parked()").expect("gated park");
        assert!(gate < ask.find("app.dialog()").unwrap(), "the park is checked before the sheet");
        for f in ["fn e2e_consent_parked()", "pub(crate) fn e2e_answer_oldest("] {
            let at = src.find(f).unwrap_or_else(|| panic!("{f}"));
            let before = &src[..at];
            let attr = before.rfind("#[cfg(debug_assertions)]").expect("attribute");
            assert!(!src[attr..at].contains("\n\n"), "{f} sits right under #[cfg(debug_assertions)]");
        }
        let cmd = &src[src.find("pub fn e2e_cli_consent(").unwrap()..];
        let cmd = &cmd[..cmd.find("\n}\n").unwrap()];
        assert!(cmd.contains("#[cfg(all(debug_assertions, unix))]"));
        assert!(cmd.contains("#[cfg(not(all(debug_assertions, unix)))]"));
        assert!(cmd.contains("Err(\"debug builds only\".into())"));
        let release = include_str!("../capabilities/default.json");
        assert!(!release.contains("e2e-cli-consent"), "never granted in a release capability");
    }

    /// Pins: a lease change republishes the registry and the strip; `ensure` reads the branch gate
    /// before it answers an open tab; a new tab notes its branch.
    #[test]
    fn leases_feed_the_registry_and_ensure_runs_the_branch_gate() {
        let src = include_str!("cli_channel.rs");
        let watch = &src[src.find("fn watch_leases(").unwrap()..];
        let watch = &watch[..watch.find("\n    }\n").unwrap()];
        assert!(watch.contains("crate::cli_registry::publish(&app)"));
        assert!(watch.contains("crate::tabs::changed(&app)"));
        let ens = &src[src.find("    fn ensure(\n").unwrap()..];
        let ens = &ens[..ens.find("\n    }\n").unwrap()];
        assert!(ens.find("branch_gate(").unwrap() < ens.find("answer_open(").unwrap());
        let reg = include_str!("cli_registry.rs");
        assert!(reg.contains("busy: crate::cli_channel::leased(root)"));
        let win = include_str!("windows.rs");
        let open = &win[win.find("pub fn open_window_for_root_as(").unwrap()..];
        let open = &open[..open.find("\n}\n").unwrap()];
        assert!(open.contains("crate::cli_channel::note_branch(root)"));
    }

}
