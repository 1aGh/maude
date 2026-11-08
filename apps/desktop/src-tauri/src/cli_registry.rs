// #206 / DDR-250 (contract `apps/studio/client/v2/contracts/206-cli-reuses-desktop.md` §3): the
// app-owned registry of this app's sidecars, `<app_data_dir>/servers.json`.
//
// A terminal design run (`server-up`, `maude design open`, the screenshot helpers) reads this file to
// find the server the app already runs for a checkout, instead of booting a second one. It is the
// CLI-side twin of the shell's own trust rule (`v2-3.4-shell-probe-gate-order`): the project tree is
// untrusted, so the CLI never believes `<project>/.design/_server.json` while the app runs; it believes
// this file, which only Rust writes, in a 0700 dir, 0600, atomically (tmp + rename), on every pool
// change — spawn, ready (the port is known), rest, wake, reap, and quit (an empty list).
//
// The file names a port and a per-spawn `attestKey`; the server got the same key as
// `MAUDE_SHELL_ATTEST_KEY` and answers `GET /_api/shell/attest?n=` with an HMAC over it, so the CLI
// uses a port only after a challenge-response (a port squatter or a respawned sibling cannot answer).
// A respawn mints a fresh key; a reaped server's entry, key and all, leaves the file.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::sidecar::SidecarState;

/// The registry file, under the app data dir.
pub(crate) const REGISTRY_FILE: &str = "servers.json";
/// The CLI → app socket the registry advertises (contract §4, `cli_channel.rs`).
pub(crate) const SOCKET_FILE: &str = "cli.sock";
/// The env var a project spawn's attest key travels in. In the `MAUDE_SHELL_*` namespace on
/// purpose: `scrubAgentEnv` (apps/studio/acp/env.ts) keeps every one of those from the AI agent.
pub(crate) const ATTEST_KEY_ENV: &str = "MAUDE_SHELL_ATTEST_KEY";
pub(crate) const REGISTRY_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Registry {
    pub v: u32,
    pub app: AppInfo,
    pub servers: Vec<ServerEntry>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub pid: u32,
    pub version: String,
    pub socket: String,
    pub started: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Running,
    Resting,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Project,
    Worktree,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerEntry {
    /// The checkout's realpath.
    pub root: String,
    /// `sha256(realpath)[:12]` — byte-for-byte http.ts `rootIdentity`, part of the attest MAC.
    pub root_id: String,
    /// The tab's webview label, `p-<pid>`.
    pub label: String,
    pub state: State,
    /// Absent while resting, and while a fresh spawn has not bound yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    /// Absent while resting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    /// The CURRENT child's key; absent while resting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attest_key: Option<String>,
    pub profile: String,
    pub kind: Kind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_root: Option<String>,
    /// The checked-out branch, or `null` (detached, not a git folder).
    #[serde(default)]
    pub branch: Option<String>,
    pub busy: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started: Option<String>,
}

/// One running pool instance, as `publish` snapshots it.
#[derive(Clone, Debug)]
pub struct RunningView {
    pub root: String,
    pub pid: u32,
    pub port: Option<u16>,
    pub attest_key: Option<String>,
    pub profile: String,
    pub started_ms: u64,
    /// A live terminal lease keeps it in use (contract §6) — the entry's `busy`.
    pub busy: bool,
}

/// One resting tab (its server stopped, the tab kept).
#[derive(Clone, Debug)]
pub struct RestingView {
    pub root: String,
    pub profile: String,
    pub busy: bool,
}

/// The realpath string Node's `realpathSync` gives (what `rootIdentity` hashes), or the input.
pub(crate) fn realpath(root: &str) -> String {
    match std::fs::canonicalize(root) {
        Ok(p) => crate::win_process::strip_verbatim(&p).to_string_lossy().into_owned(),
        Err(_) => root.to_string(),
    }
}

/// http.ts `rootIdentity`: `sha256(realpath)` hex, first 12 characters.
pub(crate) fn root_id(realpath: &str) -> String {
    Sha256::digest(realpath.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>()[..12]
        .to_string()
}

/// Epoch milliseconds → `YYYY-MM-DDTHH:MM:SS.mmmZ` (what JS `toISOString` prints).
pub(crate) fn iso_utc(ms: u64) -> String {
    let secs = ms / 1000;
    let days = (secs / 86_400) as i64;
    let tod = secs % 86_400;
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        tod / 3600,
        (tod % 3600) / 60,
        tod % 60,
        ms % 1000
    )
}

/// `kind`, `mainRoot` and `branch` for one root.
fn git_facts(real: &str, is_known: &dyn Fn(&Path) -> bool) -> (Kind, Option<String>, Option<String>) {
    let root = Path::new(real);
    match crate::project_resolve::worktree_of(root) {
        Some(wt) if is_known(&wt.main_root) => (
            Kind::Worktree,
            Some(wt.main_root.to_string_lossy().into_owned()),
            wt.head.branch(),
        ),
        Some(wt) => (Kind::Project, None, wt.head.branch()),
        None => (Kind::Project, None, crate::project_resolve::branch_of(root)),
    }
}

/// The whole registry for one snapshot. `is_known(main_root)`: the main checkout is one Maude already
/// knows (registry or Recent, contract §5) — only then is a worktree folder `kind: "worktree"`.
pub fn build_registry(
    app: AppInfo,
    running: &[RunningView],
    resting: &[RestingView],
    is_known: &dyn Fn(&Path) -> bool,
) -> Registry {
    let mut servers: Vec<ServerEntry> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for r in running {
        let real = realpath(&r.root);
        if !seen.insert(real.clone()) {
            continue;
        }
        let (kind, main_root, branch) = git_facts(&real, is_known);
        servers.push(ServerEntry {
            root_id: root_id(&real),
            label: crate::windows::label_for_pid(&crate::windows::pid_for_root(&r.root)),
            state: State::Running,
            port: r.port,
            pid: Some(r.pid),
            attest_key: r.attest_key.clone(),
            profile: r.profile.clone(),
            kind,
            main_root,
            branch,
            busy: r.busy,
            started: Some(iso_utc(r.started_ms)),
            root: real,
        });
    }
    for r in resting {
        let real = realpath(&r.root);
        if !seen.insert(real.clone()) {
            continue; // a running server for the same root wins
        }
        let (kind, main_root, branch) = git_facts(&real, is_known);
        servers.push(ServerEntry {
            root_id: root_id(&real),
            label: crate::windows::label_for_pid(&crate::windows::pid_for_root(&r.root)),
            state: State::Resting,
            port: None,
            pid: None,
            attest_key: None,
            profile: r.profile.clone(),
            kind,
            main_root,
            branch,
            busy: r.busy,
            started: None,
            root: real,
        });
    }
    servers.sort_by(|a, b| a.root.cmp(&b.root));
    Registry { v: REGISTRY_VERSION, app, servers }
}

/// Write `reg` to `<dir>/servers.json`: the dir 0700, the file 0600, through a fresh temp file renamed
/// over the old one, so a reader sees the previous version or this one, never a torn write.
pub fn write_registry(dir: &Path, reg: &Registry) -> std::io::Result<()> {
    use std::io::Write;
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    let bytes = serde_json::to_vec_pretty(reg).map_err(std::io::Error::other)?;
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let tmp = dir.join(format!(".{REGISTRY_FILE}.{}.{seq}.tmp", std::process::id()));
    let mut opts = std::fs::OpenOptions::new();
    // `create_new` (O_EXCL): never write through a file or link someone else left at the temp name.
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let result = opts.open(&tmp).and_then(|mut f| {
        f.write_all(&bytes)?;
        f.sync_all()?;
        std::fs::rename(&tmp, dir.join(REGISTRY_FILE))
    });
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// The registry file as written, or `None` (absent, unparseable). Rust never reads it back to
/// decide anything (the pool is the truth); tests do.
#[cfg(test)]
pub fn read_registry(dir: &Path) -> Option<Registry> {
    serde_json::from_slice(&std::fs::read(dir.join(REGISTRY_FILE)).ok()?).ok()
}

// ── AppHandle glue ───────────────────────────────────────────────────────────

static APP_STARTED_MS: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
/// One writer at a time, snapshot AND write under it, so the last file on disk is the latest snapshot.
static PUBLISH: Mutex<()> = Mutex::new(());

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn registry_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok()
}

/// Rewrite the registry from the live pool + tab book. Call it OUTSIDE the sidecar locks, after every
/// pool change. Best-effort: a write failure is logged, and the CLI then finds no entry and keeps
/// today's behaviour (its own headless server).
pub(crate) fn publish(app: &AppHandle) {
    let Some(state) = app.try_state::<SidecarState>() else {
        return;
    };
    let Some(dir) = registry_dir(app) else {
        return;
    };
    let _one = PUBLISH.lock().unwrap_or_else(|e| e.into_inner());
    let quitting = state.shutting_down.load(std::sync::atomic::Ordering::SeqCst);
    let running: Vec<RunningView> = if quitting {
        Vec::new()
    } else {
        let pool = state.instances.lock().unwrap_or_else(|e| e.into_inner());
        pool.iter()
            .filter_map(|(root, inst)| {
                let child = inst.child.as_ref()?;
                Some(RunningView {
                    root: root.clone(),
                    pid: child.pid(),
                    port: inst.port,
                    attest_key: inst.attest_key.clone(),
                    profile: inst.profile_id.clone(),
                    started_ms: inst.started_ms,
                    busy: crate::cli_channel::leased(root),
                })
            })
            .collect()
    };
    let resting_roots: Vec<String> = if quitting {
        Vec::new()
    } else {
        let book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
        book.tab_labels()
            .iter()
            .filter(|l| book.is_resting(l))
            .filter_map(|l| book.root_of(l))
            .collect()
    };
    let st = crate::app_state::load(app);
    let resting: Vec<RestingView> = resting_roots
        .into_iter()
        .map(|root| RestingView {
            profile: st.profile_for(&root),
            busy: crate::cli_channel::leased(&root),
            root,
        })
        .collect();
    let mut known: std::collections::HashSet<String> = st.projects.keys().cloned().collect();
    known.extend(running.iter().map(|r| crate::windows::pid_for_root(&r.root)));
    let is_known = |p: &Path| known.contains(&crate::windows::pid_for_root(&p.to_string_lossy()));
    let app_info = AppInfo {
        pid: std::process::id(),
        version: app.package_info().version.to_string(),
        socket: dir.join(SOCKET_FILE).to_string_lossy().into_owned(),
        started: iso_utc(*APP_STARTED_MS.get_or_init(now_ms)),
    };
    let reg = build_registry(app_info, &running, &resting, &is_known);
    if let Err(e) = write_registry(&dir, &reg) {
        crate::sidecar::log_line(&format!("[maude] could not write the CLI registry: {e}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("maude-206-reg-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::canonicalize(&d).unwrap()
    }

    fn app_info() -> AppInfo {
        AppInfo {
            pid: 4242,
            version: "2.0.0".into(),
            socket: "/x/cli.sock".into(),
            started: iso_utc(0),
        }
    }

    fn running(root: &str, port: Option<u16>, key: &str) -> RunningView {
        RunningView {
            root: root.into(),
            pid: 5678,
            port,
            attest_key: Some(key.into()),
            profile: "default".into(),
            started_ms: 1_762_560_123_456,
            busy: false,
        }
    }

    #[test]
    fn root_id_is_http_ts_root_identity_and_iso_matches_to_iso_string() {
        // printf %s /nonexistent/maude-206 | shasum -a 256
        assert_eq!(root_id("/nonexistent/maude-206"), "c532fc1b987b");
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00.000Z");
        // node -e 'console.log(new Date(1762560123456).toISOString())'
        assert_eq!(iso_utc(1_762_560_123_456), "2025-11-08T00:02:03.456Z");
        assert_eq!(iso_utc(951_782_400_000), "2000-02-29T00:00:00.000Z");
    }

    #[test]
    fn a_running_spawn_and_a_resting_tab_are_listed_with_the_contract_shape() {
        let base = scratch("shape");
        let a = base.join("a");
        let b = base.join("b");
        for p in [&a, &b] {
            std::fs::create_dir_all(p.join(".design")).unwrap();
        }
        let (a, b) = (a.to_string_lossy().into_owned(), b.to_string_lossy().into_owned());
        let key = "ab".repeat(32);
        let reg = build_registry(
            app_info(),
            &[running(&a, Some(46399), &key)],
            &[RestingView { root: b.clone(), profile: "work".into(), busy: false }],
            &|_| false,
        );
        assert_eq!(reg.v, 1);
        assert_eq!(reg.servers.len(), 2);
        let ra = reg.servers.iter().find(|s| s.root == a).expect("running entry");
        assert_eq!(ra.state, State::Running);
        assert_eq!(ra.port, Some(46399));
        assert_eq!(ra.pid, Some(5678));
        assert_eq!(ra.attest_key.as_deref(), Some(key.as_str()));
        assert_eq!(ra.root_id, root_id(&a));
        assert_eq!(ra.label, crate::windows::label_for_pid(&crate::windows::pid_for_root(&a)));
        assert_eq!(ra.kind, Kind::Project);
        assert_eq!(ra.started.as_deref(), Some("2025-11-08T00:02:03.456Z"));
        let rb = reg.servers.iter().find(|s| s.root == b).expect("resting entry");
        assert_eq!(rb.state, State::Resting);
        assert_eq!((rb.port, rb.pid, rb.attest_key.as_deref()), (None, None, None));
        assert_eq!(rb.profile, "work");

        // The wire shape the CLI parses (camelCase, `branch` always present, absent fields omitted).
        let json: serde_json::Value = serde_json::to_value(&reg).unwrap();
        let wa = json["servers"].as_array().unwrap().iter().find(|s| s["root"] == a.as_str()).unwrap();
        assert_eq!(wa["rootId"], root_id(&a).as_str());
        assert_eq!(wa["attestKey"], key.as_str());
        assert_eq!(wa["state"], "running");
        assert_eq!(wa["kind"], "project");
        assert!(wa.get("branch").is_some_and(|v| v.is_null()));
        assert!(wa.get("mainRoot").is_none());
        let wb = json["servers"].as_array().unwrap().iter().find(|s| s["root"] == b.as_str()).unwrap();
        assert!(wb.get("port").is_none() && wb.get("attestKey").is_none() && wb.get("pid").is_none());
        assert_eq!(json["app"]["socket"], "/x/cli.sock");
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn a_live_lease_marks_the_entry_busy_running_or_resting() {
        let base = scratch("busy");
        let (a, b) = (base.join("a"), base.join("b"));
        for p in [&a, &b] {
            std::fs::create_dir_all(p).unwrap();
        }
        let (a, b) = (a.to_string_lossy().into_owned(), b.to_string_lossy().into_owned());
        let mut ra = running(&a, Some(46399), &"ab".repeat(32));
        ra.busy = true;
        let reg = build_registry(
            app_info(),
            &[ra],
            &[RestingView { root: b.clone(), profile: "default".into(), busy: true }],
            &|_| false,
        );
        assert!(reg.servers.iter().all(|s| s.busy), "{:?}", reg.servers);
        let reg = build_registry(app_info(), &[running(&a, Some(46399), &"ab".repeat(32))], &[], &|_| false);
        assert!(!reg.servers[0].busy);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn a_root_both_running_and_resting_is_listed_once_as_running() {
        let base = scratch("dupe");
        let a = base.to_string_lossy().into_owned();
        let reg = build_registry(
            app_info(),
            &[running(&a, None, &"cd".repeat(32))],
            &[RestingView { root: a.clone(), profile: "default".into(), busy: false }],
            &|_| false,
        );
        assert_eq!(reg.servers.len(), 1);
        assert_eq!(reg.servers[0].state, State::Running);
        assert_eq!(reg.servers[0].port, None, "a spawn that has not bound yet carries no port");
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn a_worktree_of_a_known_project_is_kind_worktree_and_an_unknown_one_is_a_project() {
        let base = scratch("wt");
        let main = base.join("main");
        let g = main.join(".git/worktrees/wt");
        std::fs::create_dir_all(&g).unwrap();
        std::fs::write(main.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        let wt = base.join("wt");
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(wt.join(".git"), format!("gitdir: {}\n", g.display())).unwrap();
        std::fs::write(g.join("gitdir"), format!("{}\n", wt.join(".git").display())).unwrap();
        std::fs::write(g.join("commondir"), "../..\n").unwrap();
        std::fs::write(g.join("HEAD"), "ref: refs/heads/feat-x\n").unwrap();
        let wts = wt.to_string_lossy().into_owned();
        let main_s = main.to_string_lossy().into_owned();

        let known = |p: &Path| p == main.as_path();
        let reg = build_registry(app_info(), &[running(&wts, Some(46400), &"ef".repeat(32))], &[], &known);
        let e = &reg.servers[0];
        assert_eq!(e.kind, Kind::Worktree);
        assert_eq!(e.main_root.as_deref(), Some(main_s.as_str()));
        assert_eq!(e.branch.as_deref(), Some("feat-x"));

        // Main checkout Maude has never opened: an ordinary project (it goes through first-open trust).
        let reg = build_registry(app_info(), &[running(&wts, Some(46400), &"ef".repeat(32))], &[], &|_| false);
        assert_eq!(reg.servers[0].kind, Kind::Project);
        assert_eq!(reg.servers[0].main_root, None);
        assert_eq!(reg.servers[0].branch.as_deref(), Some("feat-x"), "the branch is a fact either way");

        // The main checkout itself: a project on its own branch.
        let reg = build_registry(app_info(), &[running(&main_s, Some(46401), &"01".repeat(32))], &[], &known);
        assert_eq!((reg.servers[0].kind, reg.servers[0].branch.as_deref()), (Kind::Project, Some("main")));
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn write_is_atomic_0600_in_a_0700_dir_and_a_reap_drops_the_entry() {
        let base = scratch("write");
        let dir = base.join("app-data");
        let a = base.to_string_lossy().into_owned();
        let reg = build_registry(app_info(), &[running(&a, Some(46399), &"ab".repeat(32))], &[], &|_| false);
        write_registry(&dir, &reg).unwrap();
        assert_eq!(read_registry(&dir), Some(reg.clone()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode(&dir.join(REGISTRY_FILE)), 0o600);
            assert_eq!(mode(&dir), 0o700);
            // A file left 0644 by anything else is REPLACED, never written through.
            std::fs::set_permissions(dir.join(REGISTRY_FILE), std::fs::Permissions::from_mode(0o644)).unwrap();
        }
        // Reap (and quit): the next snapshot has no entry, and no key survives on disk.
        let empty = build_registry(app_info(), &[], &[], &|_| false);
        write_registry(&dir, &empty).unwrap();
        let back = read_registry(&dir).unwrap();
        assert!(back.servers.is_empty());
        let raw = std::fs::read_to_string(dir.join(REGISTRY_FILE)).unwrap();
        assert!(!raw.contains(&"ab".repeat(32)), "a reaped spawn's key left the file");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join(REGISTRY_FILE)).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        // No temp file is left behind.
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n != REGISTRY_FILE)
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
        std::fs::remove_dir_all(base).unwrap();
    }

    /// #206 handover (contract §6.1): Rust deletes NO `_server.json`. The file has one writer, the
    /// server (compare-and-delete on shutdown); a blind delete here orphaned a terminal-started
    /// server's lock holder and made the next `server-up` start a third server.
    #[test]
    fn no_rust_code_deletes_a_server_json() {
        let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut offenders = Vec::new();
        for entry in std::fs::read_dir(&src_dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let src = std::fs::read_to_string(&path).unwrap();
            // Production code only: everything before the file's test module.
            let prod = src.split("#[cfg(test)]\nmod tests").next().unwrap_or(&src);
            let mut rest = prod;
            while let Some(i) = rest.find("remove_file(") {
                let call = &rest[i..];
                let end = call.find(';').unwrap_or(call.len());
                if call[..end].contains("_server.json") {
                    offenders.push(format!("{}: {}", path.display(), &call[..end.min(120)]));
                }
                rest = &call["remove_file(".len()..];
            }
        }
        assert!(offenders.is_empty(), "blind _server.json deletes: {offenders:#?}");
    }
}
