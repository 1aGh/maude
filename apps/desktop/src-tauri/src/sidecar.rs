// Dev-server sidecar lifecycle — spawn / supervise / kill (DDR-106, DDR-109).
//
// The sidecar is the compiled Bun dev-server binary (DDR-009/084), bundled via
// Tauri `externalBin` as `binaries/maude-server-<target-triple>` and spawned with
// `--root <project>`. Loopback-only (DDR-109): the dev-server binds localhost.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Rotating sidecar log (`<app-log-dir>/server.log`, 1 MB × 3 files).
/// Volume is tiny (boot lines + request warnings), so plain sync writes on
/// the drain task are fine.
struct ServerLog {
    file: std::fs::File,
    size: u64,
    dir: PathBuf,
}

const SERVER_LOG_MAX_BYTES: u64 = 1_000_000;
const SERVER_LOG_KEEP: usize = 3;

impl ServerLog {
    fn open(app: &AppHandle) -> Option<Self> {
        let dir = app.path().app_log_dir().ok()?;
        std::fs::create_dir_all(&dir).ok()?;
        let path = dir.join("server.log");
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .ok()?;
        let size = file.metadata().map(|m| m.len()).unwrap_or(0);
        Some(Self { file, size, dir })
    }

    fn write(&mut self, bytes: &[u8]) {
        use std::io::Write;
        if self.size > SERVER_LOG_MAX_BYTES {
            self.rotate();
        }
        if self.file.write_all(bytes).is_ok() {
            self.size += bytes.len() as u64;
        }
    }

    /// server.log → server.log.1 → … → server.log.<KEEP> (oldest dropped).
    fn rotate(&mut self) {
        for i in (1..=SERVER_LOG_KEEP).rev() {
            let from = if i == 1 {
                self.dir.join("server.log")
            } else {
                self.dir.join(format!("server.log.{}", i - 1))
            };
            let _ = std::fs::rename(&from, self.dir.join(format!("server.log.{i}")));
        }
        if let Some(fresh) = Self::open_fresh(&self.dir) {
            self.file = fresh;
            self.size = 0;
        }
    }

    fn open_fresh(dir: &std::path::Path) -> Option<std::fs::File> {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("server.log"))
            .ok()
    }
}

/// One running dev-server, keyed by the project root it serves.
///
/// feature-acp-write-path-scope Addendum, Task 10 — this used to be a single
/// `child`, and `switch_project` KILLED it so the supervisor could respawn at
/// the new root. That meant switching projects tore down the whole server
/// process, so every chat in project A died — not just the visible one — and no
/// server-side change could reach it.
///
/// Option 2 of the plan's table: keep the origin project's sidecar ALIVE and
/// spawn-or-attach the new one beside it. Option 3 (one long-lived cross-project
/// agent host) was recommended against and is not implemented: one agent process
/// spanning projects would dissolve the per-project boundary the write gate
/// draws, and re-open the scope question in the worst possible place. A pool
/// keeps `repoRoot` — and therefore `AcpBridge`'s pinned `scopeRoot` — exactly
/// one-to-one with a server.
pub struct SidecarInstance {
    pub child: Option<CommandChild>,
    /// Respawn attempts for THIS instance (capped at MAX_RESTARTS). Per-instance
    /// rather than global: one project's crash-looping server must not exhaust
    /// another's restart budget.
    ///
    /// Counts a crash LOOP, not a lifetime crash total — see `spawned_at`.
    pub restarts: u32,
    /// When the CURRENT child was spawned. Exists so `MAX_RESTARTS` can mean what
    /// its give-up message claims ("crash-looped 3+ times") instead of "died three
    /// times, ever". Before this the counter only ever reset when the user
    /// switched away and back, so a single-project session that hit three
    /// unrelated crashes hours apart — the observed shape of the Bun
    /// divide-by-zero in maude-server, twice in one afternoon — retired the
    /// project permanently even though every one of those crashes had recovered.
    pub spawned_at: Instant,
    /// Monotonic tick of when this instance was last the DISPLAYED project —
    /// drives least-recently-shown eviction.
    pub last_shown: u64,
    /// The identity profile the CURRENT child was spawned on (V2-3.1). Read at
    /// spawn from `app_state::profile_for`; a rebinding takes effect only on the
    /// next spawn — env is never hot-swapped.
    pub profile_id: String,
    /// The per-spawn token-bridge key the CURRENT child holds (keychain.rs
    /// `mint_key`). Revoked the moment that child is shut down, dies, or is
    /// replaced, so a key never outlives its process (plan T3 gotcha).
    pub bridge_key: Option<String>,
    /// The app-owned info file + per-spawn token the CURRENT child was given
    /// (V2-1.1 decision 8). Retired with that child, exactly like `bridge_key`:
    /// a respawn gets a fresh path and a fresh token, so a dead child's file or
    /// token never answers for its successor.
    pub shell: Option<ShellProbe>,
}

/// Where the shell's authenticated probe for ONE spawn goes (V2-1.1 decision 8):
/// an app-owned file the server writes its address to — outside the project, so
/// an agent, a `git checkout` or a planted file cannot point it anywhere — and
/// the per-spawn token `/_api/shell/status` checks.
#[derive(Clone, Debug)]
pub struct ShellProbe {
    pub info_file: PathBuf,
    pub token: String,
}

/// What `GET /_api/shell/status` answers (apps/studio/routes/shell.ts).
#[derive(Clone, Debug, Default, PartialEq, serde::Deserialize)]
pub struct ShellStatus {
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub ai: AiCounts,
    #[serde(default)]
    pub unsent: u32,
    #[serde(default)]
    pub jobs: u32,
}

#[derive(Clone, Debug, Default, PartialEq, serde::Deserialize)]
pub struct AiCounts {
    #[serde(default)]
    pub running: u32,
    #[serde(default)]
    pub awaiting: u32,
}

impl ShellStatus {
    /// AI is running or waiting for the person — the close confirm's trigger.
    pub fn ai_active(&self) -> bool {
        self.ai.running + self.ai.awaiting > 0
    }

    /// Anything that resting would lose (§5.2 "Rest (cap)"): AI, unsent
    /// changes, an export or generation job.
    pub fn busy(&self) -> bool {
        self.ai_active() || self.unsent > 0 || self.jobs > 0
    }
}

/// The identity env for one spawn (V2-3.1, plan T6). `default` sets only the id
/// and label: the server's own path defaults ARE the default profile's files
/// (hubs-config.ts, cloud/endpoints.ts), and leaving them unset keeps a
/// pre-profiles install byte-identical. Any other profile points the server at its
/// own `cloud.json` / `hubs.json`.
pub(crate) fn profile_env(
    profile_id: &str,
    label: &str,
    paths: Option<&crate::profiles::ProfilePaths>,
) -> Vec<(&'static str, String)> {
    let mut env = vec![
        ("MAUDE_PROFILE_ID", profile_id.to_string()),
        ("MAUDE_PROFILE_LABEL", label.to_string()),
    ];
    if profile_id != crate::profiles::DEFAULT_ID {
        if let Some(p) = paths {
            env.push((
                "MAUDE_CLOUD_CONFIG",
                p.cloud_config.to_string_lossy().into_owned(),
            ));
            env.push((
                "HUBS_CONFIG_PATH",
                p.hubs_config.to_string_lossy().into_owned(),
            ));
        }
    }
    env
}

/// Managed state holding the live sidecar pool + supervision flags.
pub struct SidecarState {
    /// project root → its running dev-server. At most `running_cap()` entries,
    /// unless every candidate is busy (the cap overflows, `enforce_cap`).
    pub instances: Mutex<std::collections::HashMap<String, SidecarInstance>>,
    /// Set true on app quit so the supervisor does not respawn during shutdown.
    pub shutting_down: AtomicBool,
    /// Every live window and which one is focused (V2-3.2, contract §5.2).
    /// Replaces `project_root`: "the displayed project" is now the project of
    /// the focused window, and a command answers for the window that called it
    /// (`windows::caller_project`), never for "the current project".
    pub windows: Mutex<crate::windows::WindowBook>,
    /// Source for `last_shown`. A counter, not a clock: `Instant`/`SystemTime`
    /// would drag time handling into a comparison that only needs an ordering.
    pub tick: AtomicU64,
    /// The one Home server (V2-3.3, contract V2-1.1 decision 1): never in
    /// `instances`, never counted in the pool, never reaped. `None` until the
    /// first spawn (home.rs).
    pub home: Mutex<Option<crate::home::HomeInstance>>,
}

pub(crate) const MAX_RESTARTS: u32 = 3;

/// How long a child must stay up before its death counts as an ISOLATED crash
/// rather than another turn of a loop. A crash loop is a server that cannot get
/// through startup; anything that served real requests for a minute first was
/// working, and the next crash starts a fresh budget.
const HEALTHY_UPTIME: Duration = Duration::from_secs(60);

/// How many project servers may run at once (V2-1.1 decision 4, "Running cap 5").
///
/// Tabs are the workspace now: a person keeps every project they work on open as
/// a tab, and the cap no longer limits what is open — only what is RUNNING. A
/// tab over the cap rests (its server stops, the tab stays, focusing it wakes
/// it), so the ceiling is purely the process cost DDR-125 books per project: a
/// Bun server plus however many `claude` adapters its chats have spawned.
/// Five covers the "two or three projects at once, plus a couple I glanced at"
/// habit without letting twenty tabs mean twenty process stacks.
const RUNNING_CAP: usize = 5;

/// The cap in force. Debug builds honour `MAUDE_E2E_RUNNING_CAP` so a desktop
/// e2e can reach resting with three projects instead of six; a release build
/// never reads it.
pub(crate) fn running_cap() -> usize {
    #[cfg(debug_assertions)]
    if let Some(n) = std::env::var("MAUDE_E2E_RUNNING_CAP")
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .filter(|n| *n >= 1)
    {
        return n;
    }
    RUNNING_CAP
}

/// Milliseconds allowed for one `/_api/shell/status` probe. Short: a wedged
/// server must not stall a close or the cap for long. A probe that times out
/// reads as "no status" — busy for resting (never rest what we can't see),
/// no confirm for a close (we can't claim AI is running).
const RUNNING_PROBE_TIMEOUT_MS: u64 = 1500;

/// Resolve the user's real PATH by asking their login shell, so a Finder/Dock-
/// launched `.app` can reach `claude` / `maude` even though it inherited the
/// truncated launchd PATH (DDR-128). Unix-only — Windows GUI apps already inherit
/// the user PATH. Best-effort: returns `None` on any failure and the caller leaves
/// the inherited PATH in place.
///
/// `-ilc` runs an interactive login shell so BOTH `.zprofile` (login) and `.zshrc`
/// (interactive — where Homebrew/asdf/nvm users usually export PATH) are sourced.
/// The value is bracketed with markers because instant-prompt frameworks
/// (powerlevel10k) write to stdout on interactive start; we extract only the slice
/// between the markers. Runs on a worker thread with a 5 s timeout so a slow or
/// input-blocking rc can never wedge app startup (stdin is /dev/null for the same
/// reason).
#[cfg(unix)]
fn resolve_login_path() -> Option<String> {
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Duration;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        // no-console-window: #[cfg(unix)] — there is no console to open.
        let out = Command::new(&shell)
            .args([
                "-ilc",
                "command printf '__MAUDE_PATH__%s__MAUDE_END__' \"$PATH\"",
            ])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output();
        let _ = tx.send(out);
    });

    let output = match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(o)) => o,
        _ => return None,
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let start = stdout.find("__MAUDE_PATH__")? + "__MAUDE_PATH__".len();
    let rest = &stdout[start..];
    let end = rest.find("__MAUDE_END__")?;
    let path = rest[..end].trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

#[cfg(not(unix))]
fn resolve_login_path() -> Option<String> {
    None
}

/// p8-app-port-range (decision maude/v2-michal-desktop-own-port-range) — set to "1" on every project-server spawn, so
/// `resolvePort` (apps/studio/port.ts `APP_SIDECAR_ENV`) starts the server's ladder at 46399, never the CLI's 4399 a
/// person's own `maude design serve` uses. An e2e lane's `MAUDE_E2E_*` marker wins over it there (47399). A crashed
/// server's respawn walks the same ladder, so it finds its predecessor's port free again ("same URL, same port").
/// The Home server (home.rs) is not marked: it binds any free port and the app remembers it (`home_port`).
pub(crate) const APP_SIDECAR_ENV: &str = "MAUDE_SHELL_SIDECAR";

/// p8-port-gc — the port this project's server bound last time (app-state.json `projects.<pid>.port`), tried first by
/// port.ts `portCandidates` (`PREFERRED_PORT_ENV`), so a rested tab's wake, a relaunch and a crash respawn keep their
/// origin — per-origin web storage and the crash-recovery reload both rely on it. Taken → the server walks the rest of
/// its ladder and `spawn_record_port` records the new port. In the MAUDE_SHELL_* namespace the agent never inherits.
pub(crate) const PREFERRED_PORT_ENV: &str = "MAUDE_SHELL_PORT";

/// How long a spawn's port recorder waits for the server to write its info file (250 ms ticks, 30 s).
const RECORD_PORT_TICKS: u32 = 120;

/// p8-e2e-isolation-r13 — true when any `MAUDE_E2E_*` variable is set non-empty: this app was launched by a desktop
/// e2e lane (wdio.conf.ts), never by a person. Mirrors `isE2eEnv` in apps/studio/acp/probe.ts.
pub(crate) fn is_e2e_env<I>(vars: I) -> bool
where
    I: IntoIterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
{
    vars.into_iter().any(|(k, v)| {
        k.to_str().is_some_and(|k| k.starts_with("MAUDE_E2E_")) && !v.is_empty()
    })
}

/// The PATH a project sidecar starts with. A person's `.app` gets the login-shell PATH (DDR-128, `resolve_login_path`);
/// an e2e lane keeps the PATH it was launched with (p8-e2e-isolation-r13). The lane puts its stub `claude` first on
/// that PATH, and the login shell sources the person's own rc files — in the 2026-10-27 V2-8.3 record it put the real
/// `~/.local/bin/claude` back in front, and the ACP adapter spawned it with the person's HOME (the real keychain).
/// `login` is never called for an e2e lane.
fn sidecar_base_path(
    e2e: bool,
    inherited: Option<String>,
    login: impl FnOnce() -> Option<String>,
) -> String {
    if e2e {
        return inherited.unwrap_or_default();
    }
    login().unwrap_or_else(|| inherited.unwrap_or_default())
}

/// DDR-166 T0b — stage the bundled `maude` binary as the ONLY entry in a
/// narrow, single-purpose directory, and return that entry's own path (the
/// symlink, not the real target — this is exactly what a PATH lookup for
/// `maude` will resolve to, so it's also what `MAUDE_BUNDLED_CLI_PATH` must
/// equal for `readiness.ts`'s bundled-vs-real-PATH comparison to match).
///
/// Returns `None` when the bundled binary isn't next to our own executable —
/// the expected case under `tauri dev`, where `externalBin` is triple-named
/// under `src-tauri/binaries` rather than staged beside the dev binary (same
/// condition `MAUDE_AGENT_BROWSER` above degrades under). No regression: PATH
/// resolution then falls through to whatever's genuinely on the user's PATH.
fn stage_bundled_cli_link(app: &AppHandle) -> Option<PathBuf> {
    let exe = if cfg!(windows) { "maude.exe" } else { "maude" };
    let bundled = std::env::current_exe().ok()?.parent()?.join(exe);
    if !bundled.is_file() {
        return None;
    }
    let dir = app.path().app_cache_dir().ok()?.join("bin-link");
    std::fs::create_dir_all(&dir).ok()?;
    let link = dir.join(exe);
    // Idempotent + ATOMIC refresh (DDR-168 hardening): a stale symlink from a
    // prior version (or a same-user-writable location, per the F4 rationale
    // this mirrors) never lingers pointed at the wrong — or a tampered —
    // target. Symlink to a per-process-unique temp name first, then
    // `rename()` over the real target — POSIX/Windows both guarantee rename()
    // never exposes a missing-file window, unlike the previous
    // remove_file()+symlink() sequence, which had a transient gap where an
    // in-flight `maude` PATH lookup from a longer-lived child (e.g. the
    // ACP-spawned `claude`'s own Bash-tool shell, which outlives the
    // dev-server sidecar across a respawn) could resolve to whatever's next
    // on PATH for that one lookup.
    let tmp = dir.join(format!("{exe}.tmp.{}", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&bundled, &tmp).ok()?;
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_file(&bundled, &tmp).ok()?;
    }
    std::fs::rename(&tmp, &link).ok()?;
    Some(link)
}

/// Spawn a dev-server for ONE project root and register it in the pool. Drains
/// the command's event stream; on unexpected termination (not a quit), respawns
/// with linear backoff up to `MAX_RESTARTS`. Re-entrant: the respawn path calls
/// back in.
///
/// Takes the root EXPLICITLY rather than reading `project_root` (Task 10): with
/// a pool, "the current project" and "the project this child serves" are no
/// longer the same thing, and the supervisor in particular must respawn the root
/// that actually died — not whichever project the user has since switched to.
/// That aliasing was the bug the single-child design couldn't have.
pub fn spawn_for(app: &AppHandle, project_root: &str) -> Result<(), String> {
    let state = app.state::<SidecarState>();
    let project_root = project_root.to_string();

    // RETIRE THE PREVIOUS PROCESS'S `_server.json` BEFORE WE SPAWN — issue #115.
    //
    // The dev-server unlinks this file only on a GRACEFUL shutdown (server.ts),
    // so a crash leaves the dead process's `{pid, port, url, canvasOrigin}` on
    // disk. Every reader here treats the file's existence as "a server is
    // listening": the respawn path below calls `wait_for_server` the instant
    // this function returns, and with a stale file that wait satisfies itself in
    // ~0 ms with the dead URL — so the recovery re-navigate fires before the
    // fresh child has bound anything, and the one mechanism that would have
    // reloaded a page holding a stale `canvasOrigin` spends itself for nothing.
    //
    // The BOOT path (lib.rs, whose comment already names the symptom: "the
    // webview navigates to the old port before the new server binds →
    // connection refused → intermittent white screen") and `switch_project`
    // have both always done this. The RESPAWN path and the DDR-235 "Try again"
    // path never did — which is why a crash-respawn behaved worse than a cold
    // start. Doing it HERE covers all four, so they cannot drift again.
    // Best-effort by design: a file that isn't there, or can't be removed, must
    // not stop us from starting a server.
    let _ = std::fs::remove_file(
        std::path::Path::new(&project_root)
            .join(".design")
            .join("_server.json"),
    );

    let mut command = app
        .shell()
        .sidecar("maude-server")
        .map_err(|e| format!("sidecar resolve failed: {e}"))?
        .args(["--root", project_root.as_str()])
        // The webview IS the UI — suppress the dev-server's default
        // open-the-browser-on-boot behavior (server.ts honors NO_OPEN).
        .env("NO_OPEN", "1")
        // p8-app-port-range — the app's own port ladder, 46399–46408 (port.ts).
        .env(APP_SIDECAR_ENV, "1");
    // p8-port-gc — ask for the port this project had last time first (rest-wake, relaunch, respawn).
    if let Some(port) = crate::app_state::preferred_port(app, &project_root) {
        command = command.env(PREFERRED_PORT_ENV, port.to_string());
    }

    // DDR-128 — a `.app` launched from Finder/Dock inherits the truncated launchd
    // PATH (`/usr/bin:/bin:…`), NOT the user's shell PATH. The sidecar would then
    // fail to find `claude` (the ACP adapter spawns it) and `maude` (the paired
    // `claude`'s `/design:edit` shells out to `maude design <verb>`), so AI editing
    // silently dies in the bundled app while working under `tauri dev` (which
    // inherits the terminal's full PATH). Resolve the login-shell PATH once and
    // pass it through; everything downstream (Bun.which, the adapter, the paired
    // claude) then sees the real PATH. Best-effort: on failure we leave PATH
    // untouched (no regression). The /_api/preflight readiness probe reports what's
    // still genuinely missing on top of this.
    let base_path = sidecar_base_path(
        is_e2e_env(std::env::vars_os()),
        std::env::var("PATH").ok(),
        resolve_login_path,
    );
    eprintln!(
        "[maude] sidecar PATH ← login shell ({} entries)",
        base_path.split(':').count()
    );

    // DDR-166 T0b / DDR-168 — expose the bundled `maude` CLI on the sidecar's
    // PATH so the ACP-spawned `claude`'s Bash-tool shell-outs (`maude design
    // <verb>`, per DDR-062's "never a raw bin path" convention) resolve it
    // even with no global install. NOT via `current_exe().parent()` prepended
    // wholesale — that directory also holds `maude-server`/`agent-browser`,
    // and per the Attacker-F4 rationale a few lines above, exposing an entire
    // multi-binary directory for unqualified PATH lookup lets a same-user
    // attacker who can write there shadow every name in it for every
    // dev-server child. Instead: stage `maude` alone as the ONLY entry in a
    // narrow, single-purpose directory, and PREPEND (not append) that
    // directory — every release ships an internally-consistent, release-
    // matched `maude` CLI + plugin set (DDR-168), so the bundled copy is now
    // authoritative: a ceiling, not a floor. A user's own newer/older global
    // `maude` (e.g. `npm i -g @1agh/maude`) no longer wins on precedence for
    // dispatch inside the sidecar's own spawned children — this is narrow in
    // scope (it does not touch the user's system-wide PATH or shell).
    let mut path = base_path;
    if let Some(link) = stage_bundled_cli_link(app) {
        path = format!("{}:{path}", link.parent().unwrap_or(&link).display());
        command = command.env("MAUDE_BUNDLED_CLI_PATH", link.to_string_lossy().to_string());
    }
    command = command.env("PATH", path);

    // Point the screenshot helper at the bundled `agent-browser` engine (DDR-144)
    // by an EXPLICIT env var rather than prepending our dir to PATH. Attacker-F4:
    // prepending `current_exe().parent()` (Contents/MacOS, where the externalBin
    // siblings live) would let a same-user attacker who can write there shadow
    // `node`/`google-chrome`/etc. for every dev-server child. A single-binary env
    // pointer exposes ONLY agent-browser, no PATH pollution. screenshot.sh honors
    // `MAUDE_AGENT_BROWSER` and otherwise falls back to a PATH lookup. In `tauri
    // dev` the externalBin is triple-named in src-tauri/binaries (not next to the
    // exe), so this stays unset → the developer's global agent-browser is used.
    if let Some(ab) = std::env::current_exe().ok().and_then(|p| {
        let exe = if cfg!(windows) {
            "agent-browser.exe"
        } else {
            "agent-browser"
        };
        p.parent().map(|d| d.join(exe))
    }) {
        if ab.is_file() {
            command = command.env("MAUDE_AGENT_BROWSER", ab.to_string_lossy().to_string());
            eprintln!("[maude] bundled screenshot engine: {}", ab.display());
        }
    }

    // DDR-166 T0b — same single-binary env-pointer pattern as MAUDE_AGENT_BROWSER
    // above, for the bundled `maude-server` binary itself: the compiled `maude`
    // CLI's BOOT_VERBS (server-up/visual-sanity/smoke, cli/commands/design.mjs)
    // resolve their own copy of this same binary via npm-package lookup, which
    // breaks inside a compiled binary (no npm package to resolve — DDR-045-class
    // trap). Pre-setting this short-circuits that resolution entirely: the CLI's
    // own dispatch already checks `!process.env.MAUDE_DEV_SERVER_BIN` before
    // trying to resolve it itself. This is also literally the exact binary
    // already running as this sidecar, so it's always correct.
    if let Some(sb) = std::env::current_exe().ok().and_then(|p| {
        let exe = if cfg!(windows) {
            "maude-server.exe"
        } else {
            "maude-server"
        };
        p.parent().map(|d| d.join(exe))
    }) {
        if sb.is_file() {
            command = command.env("MAUDE_DEV_SERVER_BIN", sb.to_string_lossy().to_string());
        }
    }

    // Pass through the canvas-origin-split override (DDR-063) so a WKWebView that
    // can't load the cross-origin canvas iframe can be debugged / fall back to
    // same-origin via `MAUDE_CANVAS_ORIGIN_SPLIT=0 tauri dev`.
    if let Ok(split) = std::env::var("MAUDE_CANVAS_ORIGIN_SPLIT") {
        command = command.env("MAUDE_CANVAS_ORIGIN_SPLIT", split);
    }

    // DDR-166 — deterministic E2E stub for claude-readiness states that are
    // otherwise near-impossible to reproduce on an already-set-up dev machine
    // (mirrors MAUDE_E2E_FAKE_GITHUB_LOGIN in oauth.rs). Never set in a normal
    // launch; readiness.ts is the consumer.
    if let Ok(v) = std::env::var("MAUDE_E2E_FORCE_CLAUDE_STATUS") {
        command = command.env("MAUDE_E2E_FORCE_CLAUDE_STATUS", v);
    }

    // DDR-166 Decision 5 — pass the settings-UI opt-out for auto-install/
    // auto-sign-in to the sidecar at spawn time. Read fresh on every spawn
    // (including respawn/switch_project), so a toggle takes effect on the
    // next project switch or app launch without needing extra plumbing.
    let auto_setup = crate::prefs::load(app).claude_auto_setup;
    command = command.env(
        "MAUDE_CLAUDE_AUTOSETUP_ENABLED",
        if auto_setup { "1" } else { "0" },
    );

    // Identity profile (V2-3.1): which GitHub / Cloud account this project talks
    // as. Resolved per spawn from the project's registry binding (missing ⇒
    // `default`), so a respawn after a rebinding picks the new account up.
    let profile_id = crate::app_state::profile_for(app, &project_root);
    let profile_paths = crate::profiles::paths(&profile_id).ok();
    for (k, v) in profile_env(
        &profile_id,
        &crate::profiles::label_of(&profile_id),
        profile_paths.as_ref(),
    ) {
        command = command.env(k, v);
    }

    // gate-b-sec4 — the hub the app itself bound this folder to (a managed copy), so the studio
    // honours that link without asking. A committed `linkedHub` is never this (sync/link-consent.ts).
    if let Some(hub) = crate::app_state::app_bound_hub(app, &project_root) {
        command = command.env("MAUDE_APP_BOUND_HUB", hub);
    }

    // Loopback GitHub-token bridge (DDR-108): the dev-server's /_api/github/*
    // endpoints fetch the keychain token from this endpoint at request time. The
    // key is minted FOR THIS SPAWN and maps to this project's profile only — it
    // replaces the old one-key-per-launch shared by every server, which let any
    // project's server read the one token there was. Absent in non-Tauri `maude
    // design serve` → those endpoints degrade to "sign in via the desktop app".
    let bridge_key = match crate::keychain::bridge_env(&profile_id) {
        Some((endpoint, key)) => {
            command = command
                .env("MAUDE_TOKEN_ENDPOINT", endpoint)
                .env("MAUDE_TOKEN_KEY", key.clone());
            Some(key)
        }
        None => None,
    };

    // V2-1.1 decision 8 — the authenticated shell probe. A fresh app-owned info
    // file path and a fresh token FOR THIS SPAWN; the server writes its address
    // to the file (shell/info-file.ts) and answers `/_api/shell/status` only to
    // this token. No probe ⇒ no env: the server then has no shell route (404) and
    // every probe of it reads "no status".
    let shell = mint_shell_probe(app, &project_root);
    // p8-port-gc — the port is recorded from THIS spawn's app-owned info file, never from `_server.json`.
    let record_from = shell.as_ref().map(|p| p.info_file.clone());
    if let Some(p) = &shell {
        command = command
            .env("MAUDE_SHELL_INFO_FILE", p.info_file.to_string_lossy().to_string())
            .env("MAUDE_SHELL_TOKEN", p.token.clone());
    }

    // In a packaged .app the sidecar binary sits alone in Contents/MacOS/ with no
    // apps/studio/ up-tree, so paths.ts walk-up can't find the runtime. Point it at
    // the runtime we ship as a bundle resource (Resources/apps/studio). In dev this
    // dir doesn't exist → left unset → walk-up resolves the source tree (DDR-106).
    {
        if let Some(studio) = bundled_studio_root(app) {
            command = command.env(
                "MAUDE_DEV_SERVER_ROOT",
                studio.to_string_lossy().to_string(),
            );
            eprintln!("[maude] bundled runtime: {}", studio.display());

            // RCA G2 — point the bundled `maude` CLI at its staged pkgRoot. The
            // compiled `maude` lives in Contents/MacOS/ but resolves its
            // `apps/studio/bin/<verb>.sh` helpers relative to a pkgRoot, which
            // `cli/lib/pkg-root.mjs` `isPkgRoot` defines as a dir with BOTH
            // `apps/studio/bin/screenshot.sh` AND `cli/commands/design.mjs`.
            // pkgRoot = the parent of `apps/studio` (== `<res>`), which
            // stage-resources also stages `cli/` + `package.json` into.
            // `resolvePkgRoot` has an .app sibling probe that covers macOS
            // without this, but MAUDE_PKG_ROOT is the portable belt for the
            // Linux .deb layout (binary in /usr/bin, resources in /usr/lib) where
            // the resource tree is NOT a sibling of the binary. Gated on the cli
            // anchor so we never point at a non-pkgRoot.
            if let Some(pkg_root) = studio.parent().and_then(|p| p.parent()) {
                if pkg_root
                    .join("cli")
                    .join("commands")
                    .join("design.mjs")
                    .exists()
                {
                    command = command.env("MAUDE_PKG_ROOT", pkg_root.to_string_lossy().to_string());
                    eprintln!("[maude] bundled pkgRoot: {}", pkg_root.display());
                }
            }
        }
    }

    let (mut rx, child) = match command.spawn() {
        Ok(spawned) => spawned,
        Err(e) => {
            // No process holds the freshly minted key — it must not stay live.
            if let Some(k) = &bridge_key {
                crate::keychain::revoke_key(k);
            }
            retire_shell_probe(shell);
            return Err(format!("sidecar spawn failed: {e}"));
        }
    };

    eprintln!(
        "[maude] dev-server sidecar spawned (pid {}) --root {}",
        child.pid(),
        project_root
    );
    let displaced = {
        let mut pool = state.instances.lock().expect("sidecar mutex poisoned");
        let tick = state.tick.fetch_add(1, Ordering::SeqCst);
        let entry = pool.entry(project_root.clone()).or_insert(SidecarInstance {
            child: None,
            restarts: 0,
            last_shown: tick,
            spawned_at: Instant::now(),
            profile_id: profile_id.clone(),
            bridge_key: None,
            shell: None,
        });
        // The previous child's key (a respawn, or a racing double spawn) dies
        // with that child; the new one carries its own.
        if let Some(old_key) = std::mem::replace(&mut entry.bridge_key, bridge_key) {
            crate::keychain::revoke_key(&old_key);
        }
        // Same for the shell probe: the old child's info file and token are
        // retired, so nothing can read the old address as the new child's.
        retire_shell_probe(std::mem::replace(&mut entry.shell, shell));
        entry.profile_id = profile_id.clone();
        // CORRECTNESS (security-auditor A5) — `or_insert` overwrites an EXISTING
        // entry's `child`, and the first cut did exactly that: a racing second
        // `spawn_for` for the same root would drop a live CommandChild on the
        // floor WITHOUT terminating it, orphaning a Bun server plus every
        // `claude` adapter it had spawned. Take the old handle out and kill it
        // below — outside the lock, since `terminate` sleeps for the SIGTERM
        // grace period.
        let displaced = entry.child.take();
        entry.child = Some(child);
        // Re-stamp on EVERY spawn, not just the `or_insert` path — a respawn
        // reuses the existing entry, and a stale `spawned_at` would make the new
        // child look like it had already been up for the old one's lifetime.
        entry.spawned_at = Instant::now();
        displaced
    };
    if let Some(old) = displaced {
        eprintln!("[maude] replacing a live sidecar for {project_root} — terminating the old one");
        terminate(old);
    }
    if let Some(info_file) = record_from {
        spawn_record_port(app, project_root.clone(), info_file);
    }

    let app = app.clone();
    let supervised_root = project_root.clone();
    tauri::async_runtime::spawn(async move {
        // feature-bug-report-button (T4/1b) — mirror the sidecar's output into a
        // rotating file under the OS log dir (~/Library/Logs/<bundle-id> on
        // macOS). A Finder-launched .app has no terminal, so without this the
        // server's own output is unrecoverable post-mortem; the dev-server's
        // in-memory ring only covers the live process. Best-effort: an
        // unopenable log dir degrades to today's stderr-only behavior.
        let mut server_log = ServerLog::open(&app);
        while let Some(event) = rx.recv().await {
            match event {
                // PANIC-FREE LOGGING IS LOAD-BEARING HERE — see `log_line`. A
                // broken stderr pipe (the normal state of a Finder-launched
                // .app) made `eprint!` panic out of this very task, which is
                // the only consumer of `Terminated` below: no respawn, no
                // drained output, no give-up modal.
                CommandEvent::Stdout(line) => {
                    log_raw(&format!("[maude:server] {}", String::from_utf8_lossy(&line)));
                    if let Some(log) = server_log.as_mut() {
                        log.write(&line);
                    }
                }
                CommandEvent::Stderr(line) => {
                    log_raw(&format!("[maude:server] {}", String::from_utf8_lossy(&line)));
                    if let Some(log) = server_log.as_mut() {
                        log.write(&line);
                    }
                }
                CommandEvent::Error(err) => {
                    log_line(&format!("[maude:server] error: {err}"));
                }
                CommandEvent::Terminated(payload) => {
                    log_line(&format!(
                        "[maude:server] terminated (code={:?}) — root {supervised_root}",
                        payload.code
                    ));
                    let state = app.state::<SidecarState>();
                    if state.shutting_down.load(Ordering::SeqCst) {
                        break; // expected — app is quitting
                    }
                    // Task 10 — respawn THIS root, not "the current project".
                    // With a pool those diverge the moment the user switches,
                    // and the old code would have resurrected project A's dead
                    // server as a second copy of project B.
                    //
                    // An instance the pool no longer knows about was evicted or
                    // shut down deliberately: let it stay dead.
                    let attempt = {
                        let mut pool = state.instances.lock().expect("sidecar mutex poisoned");
                        match pool.get_mut(&supervised_root) {
                            Some(inst) => {
                                // A child that served for a while was not looping.
                                // Its death opens a NEW budget instead of spending
                                // the one some unrelated crash left behind hours
                                // ago — otherwise `MAX_RESTARTS` silently means
                                // "died three times, ever" and a long single-
                                // project session retires itself.
                                let uptime = inst.spawned_at.elapsed();
                                inst.restarts = next_restart_count(inst.restarts, uptime);
                                inst.child = None;
                                // The dead child's bridge key goes with it,
                                // BEFORE any respawn — the respawn mints its own
                                // (and on give-up nothing should hold one).
                                if let Some(k) = inst.bridge_key.take() {
                                    crate::keychain::revoke_key(&k);
                                }
                                retire_shell_probe(inst.shell.take());
                                log_line(&format!(
                                    "[maude] dev-server was up {}s before it died — restart {}/{}",
                                    uptime.as_secs(),
                                    inst.restarts,
                                    MAX_RESTARTS
                                ));
                                inst.restarts
                            }
                            None => {
                                log_line(&format!(
                                    "[maude] {supervised_root} was retired — not respawning"
                                ));
                                break;
                            }
                        }
                    };
                    // N-M3: the dead child's port vouches for nothing from now on —
                    // the respawn's own info file records the next origin.
                    crate::windows::on_server_died(&app, &supervised_root, attempt > MAX_RESTARTS);
                    if attempt > MAX_RESTARTS {
                        log_line(&format!(
                            "[maude] sidecar gave up after {MAX_RESTARTS} restarts ({supervised_root})"
                        ));
                        state
                            .instances
                            .lock()
                            .expect("sidecar mutex poisoned")
                            .remove(&supervised_root);
                        // feature-acp-turn-notifications — the FULL clear is
                        // safe here (unlike shutdown_instance's reap path,
                        // just below): reaching MAX_RESTARTS means the real,
                        // trusted dev-server process genuinely crash-looped
                        // 3+ times, not "an untrusted probe answered idle" —
                        // see clear_project_fully's doc comment.
                        crate::notify::clear_project_fully(&app, &supervised_root);
                        report_sidecar_gave_up(&app, &supervised_root);
                        break;
                    }
                    log_line(&format!(
                        "[maude] respawning dev-server (attempt {attempt}/{MAX_RESTARTS})"
                    ));
                    tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
                    if let Err(e) = spawn_for(&app, &supervised_root) {
                        log_line(&format!("[maude] respawn failed: {e}"));
                    } else {
                        // The dead process took the webview's open WebSocket(s)
                        // with it — sync status, active-canvas tracking, HMR —
                        // and unlike `switch_project` this path never told the
                        // webview to reconnect. Same URL, same port, but every
                        // canvas-open action the frontend wires to that socket
                        // hangs against a connection nothing is listening on
                        // anymore. Re-navigate once the fresh child is up, so
                        // the page reloads and reopens its sockets against the
                        // new process — in THE WINDOW FOR THAT ROOT (V2-3.2,
                        // §5.2 "Respawn after a crash"; was "main" + "is it
                        // still the displayed project"). A window that was
                        // closed or switched to another project meanwhile gets
                        // no navigate: we must not yank it back.
                        let app2 = app.clone();
                        let root2 = supervised_root.clone();
                        tauri::async_runtime::spawn(async move {
                            // The fresh child's OWN info file (a new path per
                            // spawn), so the dead child's address can never
                            // satisfy this wait — issue #115's stale-file trap
                            // is closed by construction, not by an mtime.
                            match wait_for_shell_url(&app2, &root2, 120_000).await {
                                Ok(url) => {
                                    let Some(label) =
                                        crate::windows::label_for_root(&app2, &root2)
                                    else {
                                        return;
                                    };
                                    log_line(&format!(
                                        "[maude] dev-server recovered — reloading {label} for {root2}"
                                    ));
                                    crate::windows::navigate_to_server(
                                        &app2, &label, &root2, &url, None,
                                    );
                                }
                                Err(e) => log_line(&format!(
                                    "[maude] post-respawn: dev-server did not come back up: {e}"
                                )),
                            }
                        });
                    }
                    break; // a fresh task now drains the new child
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// The staged `apps/studio` runtime inside a packaged app (`MAUDE_DEV_SERVER_ROOT`
/// for every server this shell spawns — projects and Home), or `None` in dev,
/// where `paths.ts` walk-up resolves the source tree (DDR-106).
pub(crate) fn bundled_studio_root(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    // Tauri's resource-path mapping varies by version/config; probe the likely
    // landing spots for the staged `apps/studio` runtime (anchor: it has `dist/`).
    let candidates = [
        resource_dir.join("apps").join("studio"),
        resource_dir.join("resources").join("apps").join("studio"),
        resource_dir.join("_up_").join("apps").join("studio"),
        resource_dir.join("studio"),
    ];
    let studio = candidates.into_iter().find(|p| p.join("dist").exists())?;
    // #141 — resource_dir is a verbatim `\\?\C:\…` path on Windows, and
    // `node \\?\C:\…\index.js` (the ACP adapter) dies on it. Export the
    // ordinary form; the walk-up probes above don't care.
    Some(crate::win_process::strip_verbatim(&studio))
}

/// Restart-budget accounting: what this death costs the instance.
///
/// Extracted from the supervisor so the loop-vs-isolated distinction is unit-
/// testable without a running app — the same reason `notify::transition_kind`
/// exists apart from its poller.
///
/// A death after `HEALTHY_UPTIME` opens a fresh budget at 1 rather than spending
/// the previous one. Returning 1 and not 0 is deliberate: this WAS a crash, and
/// three more in quick succession from here must still reach the cap.
pub(crate) fn next_restart_count(previous: u32, uptime: Duration) -> u32 {
    if uptime >= HEALTHY_UPTIME {
        1
    } else {
        previous + 1
    }
}

/// The one place a user learns that their project's server is gone for good.
///
/// Until this existed, giving up was an `eprintln!` and nothing else — and an app
/// launched from Finder, the Dock, or `gtk-launch` has no terminal to print to,
/// which is the same reason `ServerLog` exists in the supervisor above. The window
/// simply kept showing a page whose server had stopped answering: no error, no
/// reason, no way back short of quitting. That is the same "it just goes blank and
/// nothing says why" failure the Linux media crash (issue #105) was reported as,
/// arrived at from a completely different direction.
///
/// A modal is the right weight here precisely because the app is already
/// non-functional for this project — there is no work in progress left to
/// interrupt. And "Try again" is not decoration: `spawn_for` re-inserts the pool
/// entry with a fresh budget, so an isolated runtime crash (the Bun
/// divide-by-zero seen twice in `maude-server`) becomes a recoverable blip
/// instead of a relaunch.
fn report_sidecar_gave_up(app: &AppHandle, project_root: &str) {
    // The project's own directory name only — never its CONTENT. Same rule as
    // notify.rs Decision D: the served project is untrusted (DDR-054), and this
    // string lands in an OS-drawn dialog the user cannot inspect.
    //
    // Sanitized through the SAME function the notification path uses, not a
    // hand-rolled equivalent: a directory name is chosen by whoever created the
    // folder, so it can carry control characters or run to any length, and the
    // fallback below widens that to a full path. Capping and stripping here
    // costs nothing and keeps the two OS-facing surfaces honest about the same
    // input.
    let name = crate::notify::sanitize_title(
        &std::path::Path::new(project_root)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| project_root.to_string()),
    );
    let app2 = app.clone();
    let root = project_root.to_string();
    app.dialog()
        .message(format!(
            "Maude's server for \u{201c}{name}\u{201d} stopped {MAX_RESTARTS} times in a row and is no longer running, so this project can't load or save.\n\nYour files on disk are untouched."
        ))
        .title("Maude's server stopped")
        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancelCustom(
            "Try again".to_string(),
            "Close".to_string(),
        ))
        .show(move |retry| {
            if !retry {
                return;
            }
            eprintln!("[maude] user asked to restart the dev-server for {root}");
            if let Err(e) = spawn_for(&app2, &root) {
                eprintln!("[maude] manual restart failed: {e}");
            }
        });
}

/// Switch the CALLING window to another project in-tab (the repo switcher, the
/// onboarding doors, a managed cloud copy): point it at the new root's server
/// and reload it — WITHOUT `app.restart()`.
///
/// Why not restart: `app.restart()` relaunches the binary, and on a non-bundled
/// `tauri dev` binary macOS delivers an "open" Apple Event that aborts `tao` in
/// `did_finish_launching` (SIGABRT). Switching in-process avoids that entirely and
/// is better UX (no window flash).
///
/// V2-3.2: the switch belongs to ONE window (`label`), not to "the app". The
/// window keeps its label (labels never change, §5.2) while its role moves to
/// the new project; every root lookup goes through the role. Open once
/// (decision 3): if another window already shows the target, that window is
/// focused instead and this one stays where it is.
pub fn switch_project(app: &AppHandle, label: &str, new_root: PathBuf, open: Option<String>) {
    let state = app.state::<SidecarState>();
    let root = new_root.to_string_lossy().to_string();
    let other = {
        let mut book = state.windows.lock().expect("windows mutex poisoned");
        match book.label_for_root(&root) {
            Some(other) if other != label => Some(other),
            _ => {
                if !book.set_project(label, &root) {
                    log_line(&format!("[maude] switch: no window {label} — ignoring"));
                    return;
                }
                // N-M5: what was parked for the label while it showed the old
                // project (a link, an intent, a navigate) is not the new one's.
                crate::windows::drop_parked_for(label);
                None
            }
        }
    };
    if let Some(other) = other {
        log_line(&format!("[maude] {root} is already open in {other} — focusing it"));
        let name = crate::windows::project_display_name(&root);
        crate::windows::WindowHost::reveal(&crate::windows::TauriHost { app }, &other, &name);
        return;
    }
    log_line(&format!("[maude] {label}: switching project → {root}"));
    // V2-3.7: the strip (and the shell title) show the tab's new project.
    crate::tabs::changed(app);
    attach_or_spawn(app, &root);

    // Apply the cap AFTER the switch: the window just switched is the focused
    // one, so it can never be the one rested.
    spawn_enforce_cap(app);

    // Re-navigate once the target project's dev-server is up. Unchanged for the
    // spawn path; instant for the attach path, since `_server.json` is already
    // there from the live instance. The DDR-109 loopback guard applies per
    // instance exactly as before — a pool does not relax it.
    crate::windows::navigate_when_up(app, label.to_string(), root, open);
}

/// SPAWN-OR-ATTACH (Task 10) the server for `root`: attach to a live instance
/// (stamping it most-recently-shown and giving it its restart budget back), or
/// spawn one. Returns whether it spawned.
///
/// The old switch unconditionally killed the child and deleted `_server.json`.
/// Both halves are wrong in the pool world:
///
///  • Killing tore down the WHOLE server process, so every chat in the project
///    we're leaving died — not just the visible one.
///  • Deleting `_server.json` was safe when it could only ever be a stale file
///    from a previous app session. With a pool it may be a LIVE instance's
///    state, and removing it would orphan a healthy server (`wait_for_server`
///    would then block on a write that never comes). So it is deleted ONLY when
///    we are actually about to spawn.
pub(crate) fn attach_or_spawn(app: &AppHandle, root: &str) -> bool {
    let state = app.state::<SidecarState>();
    // V2-3.8: a live server spawned on another profile than the project's
    // binding now holds (a sign-in rebound it; an unbound project adopted the
    // last sign-in's profile on this open) is NOT attached to — env is never
    // hot-swapped, so it is replaced by a server on the bound profile.
    let bound = crate::app_state::profile_for(app, root);
    let stale = {
        let pool = state.instances.lock().expect("sidecar mutex poisoned");
        pool.get(root)
            .is_some_and(|inst| inst.child.is_some() && inst.profile_id != bound)
    };
    if stale {
        log_line(&format!("[maude] {root} is bound to profile {bound} — restarting its server"));
        shutdown_instance(app, root);
    }
    let already_running = {
        let mut pool = state.instances.lock().expect("sidecar mutex poisoned");
        let tick = state.tick.fetch_add(1, Ordering::SeqCst);
        match pool.get_mut(root) {
            Some(inst) if inst.child.is_some() => {
                inst.last_shown = tick;
                // A deliberate return to this project is not evidence of a
                // crash loop — give it its restart budget back.
                inst.restarts = 0;
                true
            }
            _ => false,
        }
    };
    if already_running {
        log_line(&format!("[maude] {root} already running — attaching to its live server"));
        return false;
    }
    let _ = std::fs::remove_file(std::path::Path::new(root).join(".design").join("_server.json"));
    if let Err(e) = spawn_for(app, root) {
        log_line(&format!("[maude] could not spawn dev-server for {root}: {e}"));
    }
    true
}

/// V2-3.8: the project in window `label` was just rebound to another profile
/// (a sign-in that would have re-signed a shared profile): restart its server
/// onto the new profile's env (`attach_or_spawn` replaces the stale instance)
/// and reload the window on it, so its identity bar reads the new account.
pub fn restart_on_binding(app: &AppHandle, label: &str, root: &str) {
    attach_or_spawn(app, root);
    crate::windows::navigate_when_up(app, label.to_string(), root.to_string(), None);
}

/// A window showing `root` was focused: stamp its instance most-recently-shown
/// (drives least-recently-shown eviction in `reap_instances`).
pub(crate) fn mark_shown(app: &AppHandle, root: &str, tick: u64) {
    let state = app.state::<SidecarState>();
    let mut pool = state.instances.lock().expect("sidecar mutex poisoned");
    if let Some(inst) = pool.get_mut(root) {
        inst.last_shown = tick;
    }
}

// ── Authenticated shell probes (V2-1.1 decision 8) ──────────────────────────
//
// Before this, `has_running_chat` and the notify poller read the address to
// probe from `<project>/.design/_server.json` — in-project, so writable by a
// prompt-injected agent, a `git checkout` or a planted file — and believed
// whatever answered there. A fake responder could hold the pool open forever or
// answer "idle" and get a running chat killed. Now the address comes ONLY from
// the app-owned info file this spawn was given, and the server answers only to
// this spawn's token. `_server.json` is still written for the slash commands
// and helpers; nothing in this file reads it.

/// The directory every instance's info file lives in: under the app's own data
/// dir, never inside a project. 0700 — no other local user lists the ports.
fn shell_info_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?.join("shell-info");
    std::fs::create_dir_all(&dir).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    Some(dir)
}

/// `bytes` of OS randomness, hex. `None` if the RNG is unavailable: the probe
/// is then simply off for this spawn (fail closed, never a guessable token).
fn random_hex(bytes: usize) -> Option<String> {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).ok()?;
    Some(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// A fresh probe for one spawn of `root`: `<shell-info>/<pid>-<nonce>.json`
/// (a new name per spawn, so a slow-dying old child cannot overwrite its
/// successor's file) and a 32-byte token.
fn mint_shell_probe(app: &AppHandle, root: &str) -> Option<ShellProbe> {
    let dir = shell_info_dir(app)?;
    let nonce = random_hex(4)?;
    let token = random_hex(32)?;
    let pid = crate::windows::pid_for_root(root);
    Some(ShellProbe {
        info_file: dir.join(format!("{pid}-{nonce}.json")),
        token,
    })
}

/// Delete a retired probe's info file. The token dies with the struct.
fn retire_shell_probe(probe: Option<ShellProbe>) {
    if let Some(p) = probe {
        let _ = std::fs::remove_file(&p.info_file);
    }
}

/// The loopback origin an info file names, or `None` (absent, unparseable,
/// not loopback — DDR-109 holds here too, even for an app-owned file).
pub(crate) fn read_shell_origin(info_file: &Path) -> Option<String> {
    #[derive(serde::Deserialize)]
    struct Info {
        url: Option<String>,
        port: Option<u16>,
    }
    let info: Info = serde_json::from_slice(&std::fs::read(info_file).ok()?).ok()?;
    let raw = match info.url.filter(|u| !u.is_empty()) {
        Some(u) => u,
        None => format!("http://localhost:{}", info.port.filter(|p| *p != 0)?),
    };
    let parsed = raw.parse::<tauri::Url>().ok()?;
    if !crate::server_json::is_loopback_url(&parsed) {
        log_line(&format!(
            "[maude] refusing a non-loopback shell info url (DDR-109): {parsed}"
        ));
        return None;
    }
    Some(parsed.origin().ascii_serialization())
}

/// p8-port-gc — the port the loopback address in an info file names (the port the server actually bound), or
/// `None` — the same DDR-109 loopback gate as `read_shell_origin`.
pub(crate) fn read_shell_port(info_file: &Path) -> Option<u16> {
    read_shell_origin(info_file)?
        .parse::<tauri::Url>()
        .ok()?
        .port_or_known_default()
        .filter(|p| *p != 0)
}

/// p8-port-gc — once this spawn's server has written its address, record its port for `root` (app_state
/// `record_port`). Polls only this spawn's own info file: a respawn retires it (the file goes) and records through
/// its own recorder, so an old address is never written over a new one.
fn spawn_record_port(app: &AppHandle, root: String, info_file: PathBuf) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        for _ in 0..RECORD_PORT_TICKS {
            if let Some(port) = read_shell_port(&info_file) {
                crate::app_state::record_port(&app, &root, port);
                return;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    });
}

/// The canvas origin the same app-owned info file names (N-M2), loopback only.
pub(crate) fn read_shell_canvas_origin(info_file: &Path) -> Option<String> {
    #[derive(serde::Deserialize)]
    struct Info {
        #[serde(rename = "canvasOrigin")]
        canvas_origin: Option<String>,
    }
    let info: Info = serde_json::from_slice(&std::fs::read(info_file).ok()?).ok()?;
    let parsed = info.canvas_origin?.parse::<tauri::Url>().ok()?;
    crate::server_json::is_loopback_url(&parsed).then(|| parsed.origin().ascii_serialization())
}

/// One client for every probe: loopback only, so no proxy (an `HTTP_PROXY` in
/// the login env must never see the token), no redirects, a short timeout.
pub(crate) fn probe_client() -> Option<&'static reqwest::Client> {
    static CLIENT: std::sync::OnceLock<Option<reqwest::Client>> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .no_proxy()
                .timeout(Duration::from_millis(RUNNING_PROBE_TIMEOUT_MS))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .ok()
        })
        .as_ref()
}

/// `GET /_api/shell/status` at the address `probe.info_file` names, with the
/// token in `X-Maude-Shell` (a header — never argv, which `ps` shows every local
/// user, and never a URL). Any failure is `None`.
pub(crate) async fn probe_status(probe: &ShellProbe) -> Option<ShellStatus> {
    let origin = read_shell_origin(&probe.info_file)?;
    let resp = probe_client()?
        .get(format!("{origin}/_api/shell/status"))
        .header("X-Maude-Shell", &probe.token)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<ShellStatus>().await.ok()
}

/// The probe of `root`'s RUNNING instance, cloned out from under the lock.
pub(crate) fn shell_probe_for(app: &AppHandle, root: &str) -> Option<ShellProbe> {
    let state = app.try_state::<SidecarState>()?;
    let pool = state.instances.lock().unwrap_or_else(|e| e.into_inner());
    pool.get(root)
        .filter(|inst| inst.child.is_some())
        .and_then(|inst| inst.shell.clone())
}

/// `shell_status(root)` (V2-1.1 decision 8): what `root`'s own server says
/// about AI, unsent changes and jobs — or `None` (not running, not up yet,
/// wrong token, no answer).
pub async fn shell_status(app: &AppHandle, root: &str) -> Option<ShellStatus> {
    let probe = shell_probe_for(app, root)?;
    probe_status(&probe).await
}

/// The app-owned info file of `root`'s running instance.
pub(crate) fn shell_info_file(app: &AppHandle, root: &str) -> Option<PathBuf> {
    shell_probe_for(app, root).map(|p| p.info_file)
}

/// The loopback origin `root`'s running instance wrote to its info file — the
/// one address the shell navigates a window to and the notify poller probes.
pub fn shell_origin(app: &AppHandle, root: &str) -> Option<String> {
    read_shell_origin(&shell_probe_for(app, root)?.info_file)
}

/// Poll `root`'s info file until it names an address (every 200 ms, up to
/// `timeout_ms`). Looked up afresh each tick: a respawn mid-wait swaps in a new
/// file, and a rest or close removes the instance (this then times out and the
/// caller navigates nowhere).
pub async fn wait_for_shell_url(
    app: &AppHandle,
    root: &str,
    timeout_ms: u64,
) -> Result<String, String> {
    for _ in 0..(timeout_ms / 200).max(1) {
        if let Some(origin) = shell_origin(app, root) {
            return Ok(origin);
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err(format!(
        "timed out after {timeout_ms} ms waiting for {root}'s server"
    ))
}

// ── Running cap + resting (V2-1.1 decision 4, §5.2 "Rest (cap)") ────────────

/// One running instance the cap may stop.
#[derive(Clone, Debug)]
pub struct RestCandidate {
    pub root: String,
    /// The window showing it; `None` = windowless (an in-tab switch left it
    /// behind) — stopped outright, there is no tab to put to rest.
    pub label: Option<String>,
    /// `last_focused` of its window (or the instance's `last_shown` when
    /// windowless) — the same `SidecarState.tick` clock, so they compare.
    pub recency: u64,
    pub status: Option<ShellStatus>,
    /// Still booting: its child has not written an address to its info file
    /// yet, so it has no status to read (V2-3.6 L2).
    pub booting: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum RestPick {
    UnderCap,
    /// Stop this root; rest `label`'s tab if it has one.
    Rest { root: String, label: Option<String> },
    /// Over the cap and every candidate is busy: allow it (today's rule).
    Overflow,
    /// Over the cap, nothing restable YET, but a candidate is still booting:
    /// a booting server counts toward the cap, so look again once it binds
    /// instead of leaving the burst over the cap until the next spawn (V2-3.6 L2).
    Wait,
}

/// The rest policy, pure. Over the cap, the candidates are every running
/// instance except the focused window's; windowless instances first (nobody is
/// looking at them), then least-recently-focused. A busy instance — or one
/// whose status could not be read — is never rested: the conservative side of
/// "never lose running AI, unsent changes or a job".
pub fn pick_rest(
    running: usize,
    cap: usize,
    focused_label: Option<&str>,
    mut candidates: Vec<RestCandidate>,
) -> RestPick {
    if running <= cap {
        return RestPick::UnderCap;
    }
    candidates.retain(|c| c.label.is_none() || c.label.as_deref() != focused_label);
    candidates.sort_by_key(|c| (c.label.is_some(), c.recency));
    let booting = candidates.iter().any(|c| c.booting);
    candidates
        .into_iter()
        .find(|c| c.status.as_ref().is_some_and(|s| !s.busy()))
        .map(|c| RestPick::Rest {
            root: c.root,
            label: c.label,
        })
        .unwrap_or(if booting { RestPick::Wait } else { RestPick::Overflow })
}

/// How long `enforce_cap` keeps looking again for booting servers to bind
/// (one second apart) before it allows the overflow.
const CAP_BOOT_WAIT: u32 = 60;

/// Serializes `enforce_cap` runs: two spawns in quick succession must not both
/// pick a victim when resting one was enough.
static CAP_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Apply the cap after a spawn, in the background (the probes are HTTP).
pub(crate) fn spawn_enforce_cap(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        enforce_cap(&app).await;
    });
}

/// While more than `running_cap()` servers run, rest one idle candidate.
async fn enforce_cap(app: &AppHandle) {
    let _serial = CAP_LOCK.lock().await;
    let state = app.state::<SidecarState>();
    let mut waits = 0u32;
    loop {
        if state.shutting_down.load(Ordering::SeqCst) {
            return;
        }
        let running: Vec<(String, u64)> = {
            let pool = state.instances.lock().unwrap_or_else(|e| e.into_inner());
            pool.iter()
                .filter(|(_, inst)| inst.child.is_some())
                .map(|(root, inst)| (root.clone(), inst.last_shown))
                .collect()
        };
        let cap = running_cap();
        if running.len() <= cap {
            return;
        }
        let (focused, mut candidates) = {
            let book = state.windows.lock().unwrap_or_else(|e| e.into_inner());
            let focused = book.front_label();
            let candidates: Vec<RestCandidate> = running
                .iter()
                .map(|(root, last_shown)| {
                    let label = book.label_for_root(root);
                    let recency = label
                        .as_deref()
                        .and_then(|l| book.last_focused(l))
                        .unwrap_or(*last_shown);
                    RestCandidate {
                        root: root.clone(),
                        label,
                        recency,
                        status: None,
                        booting: false,
                    }
                })
                .collect();
            (focused, candidates)
        };
        // Probed OUTSIDE both locks: an HTTP round trip must not stall a switch.
        for c in candidates.iter_mut() {
            if c.label.is_some() && c.label == focused {
                continue;
            }
            // No address in its info file yet = still booting (L2).
            c.booting = shell_origin(app, &c.root).is_none();
            if !c.booting {
                c.status = shell_status(app, &c.root).await;
            }
        }
        log_line(&format!(
            "[maude] cap {cap}, {} running, focused {focused:?}: {}",
            running.len(),
            candidates
                .iter()
                .map(|c| format!(
                    "{}@{}={}",
                    c.label.as_deref().unwrap_or("(no window)"),
                    c.recency,
                    match &c.status {
                        None => "unknown".to_string(),
                        Some(s) if s.busy() => format!(
                            "busy(ai {}+{}, unsent {}, jobs {})",
                            s.ai.running, s.ai.awaiting, s.unsent, s.jobs
                        ),
                        Some(_) => "idle".to_string(),
                    }
                ))
                .collect::<Vec<_>>()
                .join(", ")
        ));
        match pick_rest(running.len(), cap, focused.as_deref(), candidates) {
            RestPick::UnderCap => return,
            RestPick::Overflow => {
                log_line(&format!(
                    "[maude] {} servers running (cap {cap}) and every candidate is busy — allowing the overflow",
                    running.len()
                ));
                return;
            }
            RestPick::Wait if waits < CAP_BOOT_WAIT => {
                waits += 1;
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            RestPick::Wait => {
                log_line(&format!(
                    "[maude] {} servers running (cap {cap}); one never finished booting — allowing the overflow",
                    running.len()
                ));
                return;
            }
            RestPick::Rest { root, label } => match label {
                Some(label) => {
                    log_line(&format!(
                        "[maude] over the cap of {cap} — resting {label} ({root})"
                    ));
                    crate::windows::rest_window(app, &label, &root);
                }
                None => {
                    log_line(&format!(
                        "[maude] over the cap of {cap} — stopping windowless {root}"
                    ));
                    shutdown_instance(app, &root);
                }
            },
        }
    }
}

/// Remove ONE instance from the pool and terminate its child. Removing it from
/// the map first is what tells the supervisor task (which checks membership on
/// `Terminated`) that this death was deliberate and must not be respawned.
pub(crate) fn shutdown_instance(app: &AppHandle, root: &str) {
    let state = app.state::<SidecarState>();
    let child = {
        let mut pool = state.instances.lock().expect("sidecar mutex poisoned");
        pool.remove(root).and_then(|inst| {
            // Revoke first: the moment this instance leaves the pool its key
            // must stop working, even while the child is still in its SIGTERM
            // grace period below.
            if let Some(k) = &inst.bridge_key {
                crate::keychain::revoke_key(k);
            }
            retire_shell_probe(inst.shell);
            inst.child
        })
    };
    if let Some(child) = child {
        terminate(child);
    }
    // feature-acp-turn-notifications — clear ONLY the transition-detection
    // state, not the notification budget: a rest or a close is driven by what
    // the project's own server answered, and that server runs the (untrusted,
    // DDR-054) project's code — a full clear here would let a compromised
    // project reset its notification cap on demand by answering one probe
    // "idle". See `clear_project_reaped`'s doc comment.
    crate::notify::clear_project_reaped(app, root);
}

/// SIGTERM-then-SIGKILL a sidecar child (DDR-166).
///
/// `CommandChild::kill()` alone sends SIGKILL (it wraps `std::process::Child::
/// kill`), which the Bun sidecar's own `process.on('SIGTERM', shutdown)` handler
/// (server.ts) never sees — so its cleanup never runs. That cleanup now matters
/// MORE than when DDR-166 was written: besides reaping an in-flight claude-
/// install / sign-in grandchild, `shutdown()` also calls `acp.stopAll()`, which
/// is what stops the detached ACP bridges (Task 8) from outliving the server.
/// A bare SIGKILL here would orphan every `claude` subprocess this instance had
/// spawned. Security-review finding, extended.
pub(crate) fn terminate(child: CommandChild) {
    let pid = child.pid();
    #[cfg(unix)]
    {
        // no-console-window: #[cfg(unix)] — there is no console to open.
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
        std::thread::sleep(Duration::from_millis(400));
    }
    let _ = child.kill();
    log_shutdown(&format!(
        "[maude] dev-server sidecar terminated (pid {pid})"
    ));
}

/// Write a shutdown line WITHOUT the ability to panic.
///
/// `eprintln!` panics when stderr cannot be written — and "cannot be written"
/// is the ordinary state of a GUI app on shutdown: the terminal that launched
/// it has usually gone away, so the pipe is broken. A real crash report was
/// filed by exactly this (`failed printing to stderr: Broken pipe`, unwinding
/// out of the SIGTERM handler), which turns a clean quit into a recorded crash
/// AND abandons the sidecars the handler was in the middle of killing.
///
/// A teardown path may not depend on anybody listening.
pub fn log_shutdown(line: &str) {
    log_line(line);
}

/// Write one line to stderr, DISCARDING the result — the panic-free `eprintln!`.
///
/// NOT only for teardown (issue #115 follow-up). `eprintln!`/`eprint!` panic
/// when stderr cannot be written, and an unwritable stderr is the ORDINARY
/// state of a `.app` launched from Finder, the Dock, or `gtk-launch` — the
/// pipe is broken from the start or breaks when the launching terminal goes
/// away. Any code that can run in that state and prints must use this.
///
/// The supervisor task below is the load-bearing case. It is the only consumer
/// of `CommandEvent::Terminated`, so a panic unwinding out of it does far more
/// than lose a log line: the sidecar is never respawned, its output stops being
/// drained (so the child eventually blocks on a full pipe and hangs), and the
/// `MAX_RESTARTS` give-up modal never fires either — the app goes quiet with no
/// crash, no reason, and no way back. Three crash reports on one install showed
/// exactly this, twice at the `eprint!` in the Stdout/Stderr arms.
pub(crate) fn log_line(line: &str) {
    use std::io::Write;
    let _ = writeln!(std::io::stderr(), "{line}");
    // Debug builds only: a desktop e2e launches the app through WebDriver, which
    // drops its stderr — `MAUDE_E2E_SHELL_LOG=<file>` keeps the shell's own
    // decisions (rest, wake, overflow) readable after a run.
    #[cfg(debug_assertions)]
    if let Some(p) = std::env::var_os("MAUDE_E2E_SHELL_LOG") {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
            let _ = writeln!(f, "{line}");
        }
    }
}

/// `log_line` without the trailing newline — for mirroring sidecar output that
/// already carries its own.
pub(crate) fn log_raw(chunk: &str) {
    use std::io::Write;
    let _ = write!(std::io::stderr(), "{chunk}");
}

/// Kill EVERY sidecar (called on app quit). Flags shutdown first so no
/// supervisor respawns.
///
/// Task 10 — this used to kill "the" child; with a pool it must reach all of
/// them, or switching projects during a session would leave orphaned Bun
/// servers (and their `claude` subprocesses) alive after the app window closed.
/// App quit is the ONE boundary the extended session lifetime deliberately does
/// not survive: keeping a chat alive across a project or branch *switch* is the
/// point; keeping it alive across a quit is an orphan.
pub fn kill_server(app: &AppHandle) {
    if let Some(state) = app.try_state::<SidecarState>() {
        // The session is saved ONCE, before anything is torn down (§5.5
        // `session`): quitting destroys every window, and the per-close saves
        // that follow must not shrink the saved tab set to nothing. Only the
        // first call saves — `Exit` follows `ExitRequested` with the book empty.
        if !state.shutting_down.swap(true, Ordering::SeqCst) {
            crate::windows::save_session_now(app);
        }
        let children: Vec<(String, CommandChild)> = {
            let mut pool = state.instances.lock().expect("sidecar mutex poisoned");
            pool.drain()
                .filter_map(|(root, inst)| {
                    if let Some(k) = &inst.bridge_key {
                        crate::keychain::revoke_key(k);
                    }
                    retire_shell_probe(inst.shell);
                    inst.child.map(|c| (root, c))
                })
                .collect()
        };
        for (root, child) in children {
            log_shutdown(&format!(
                "[maude] quitting — stopping dev-server for {root}"
            ));
            terminate(child);
        }
    }
}

#[cfg(test)]
mod tests {
    // p8-app-port-range — a project server the app starts carries the marker port.ts maps to 46399–46408; Home does
    // not (it keeps its own remembered port), and the name is the one the server reads.
    #[test]
    fn project_spawn_carries_the_app_port_range_marker_and_home_does_not() {
        let src = include_str!("sidecar.rs");
        let spawn = &src[src.find("pub fn spawn_for(").unwrap()..];
        let spawn = &spawn[..spawn.find("\n}\n").unwrap()];
        assert!(spawn.contains(".env(APP_SIDECAR_ENV, \"1\")"), "spawn_for must mark an app sidecar");
        assert!(!include_str!("home.rs").contains("APP_SIDECAR_ENV"), "Home is not a project server");
        let port_ts = include_str!("../../../studio/port.ts");
        assert!(
            port_ts.contains(&format!("export const APP_SIDECAR_ENV = '{}';", super::APP_SIDECAR_ENV)),
            "port.ts reads a different marker"
        );
        assert!(port_ts.contains("export const APP_PORT_BASE = 46399;"));
    }

    // p8-port-gc — the spawn asks for the recorded port under the name port.ts reads, and records the bound port
    // from this spawn's own info file (never `_server.json`).
    #[test]
    fn project_spawn_asks_for_its_recorded_port_and_records_the_bound_one() {
        let src = include_str!("sidecar.rs");
        let spawn = &src[src.find("pub fn spawn_for(").unwrap()..];
        let spawn = &spawn[..spawn.find("\n}\n").unwrap()];
        assert!(spawn.contains("crate::app_state::preferred_port(app, &project_root)"));
        assert!(spawn.contains(".env(PREFERRED_PORT_ENV, port.to_string())"));
        assert!(spawn.contains("spawn_record_port(app, project_root.clone(), info_file)"));
        let port_ts = include_str!("../../../studio/port.ts");
        assert!(
            port_ts.contains(&format!("export const PREFERRED_PORT_ENV = '{}';", super::PREFERRED_PORT_ENV)),
            "port.ts reads a different name"
        );
    }

    #[test]
    fn the_recorded_port_comes_from_the_info_file_and_only_a_loopback_one() {
        let dir = std::env::temp_dir().join(format!("maude-port-info-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("info.json");
        let read = |body: &str| {
            std::fs::write(&f, body).unwrap();
            super::read_shell_port(&f)
        };
        assert_eq!(read(r#"{"port":46403}"#), Some(46403));
        assert_eq!(read(r#"{"url":"http://127.0.0.1:46405/","port":46405}"#), Some(46405));
        assert_eq!(read(r#"{"url":"http://evil.example:46405/"}"#), None, "never a non-loopback address");
        assert_eq!(read(r#"{"port":0}"#), None);
        assert_eq!(read("not json"), None);
        std::fs::remove_file(&f).unwrap();
        assert_eq!(super::read_shell_port(&f), None, "no file yet → nothing to record");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // p8-e2e-isolation-r13 — the V2-8.3 record: the lane's stub-first PATH was replaced by the person's login-shell
    // PATH, and the sidecar's ACP adapter found the real ~/.local/bin/claude on it.
    #[test]
    fn e2e_lane_keeps_its_stub_first_path_and_never_runs_the_login_shell() {
        let lane = "/tmp/lane-stub/bin:/usr/bin".to_string();
        let mut shelled = false;
        let got = super::sidecar_base_path(true, Some(lane.clone()), || {
            shelled = true;
            Some("/Users/u/.local/bin:/usr/bin".to_string())
        });
        assert_eq!(got, lane);
        assert!(!shelled, "an e2e lane must not source the person's shell rc files");
    }

    #[test]
    fn a_person_still_gets_the_login_shell_path() {
        let got = super::sidecar_base_path(false, Some("/usr/bin:/bin".into()), || {
            Some("/Users/u/.local/bin:/usr/bin".into())
        });
        assert_eq!(got, "/Users/u/.local/bin:/usr/bin");
        assert_eq!(
            super::sidecar_base_path(false, Some("/usr/bin".into()), || None),
            "/usr/bin"
        );
    }

    #[test]
    fn e2e_markers_are_any_non_empty_maude_e2e_variable() {
        use std::ffi::OsString;
        let v = |k: &str, x: &str| (OsString::from(k), OsString::from(x));
        assert!(super::is_e2e_env(vec![v("MAUDE_E2E_NO_KEYCHAIN", "1")]));
        assert!(super::is_e2e_env(vec![v("PATH", "/usr/bin"), v("MAUDE_E2E_RUN_DIR", "/r")]));
        assert!(!super::is_e2e_env(vec![v("MAUDE_E2E_ON_TOP", "")]));
        assert!(!super::is_e2e_env(vec![v("MAUDE_CLAUDE_BIN", ""), v("PATH", "/usr/bin")]));
    }

    use super::*;

    #[test]
    fn profile_env_default_keeps_the_servers_own_paths() {
        let paths = crate::profiles::ProfilePaths {
            cloud_config: PathBuf::from("/c/cloud.json"),
            hubs_config: PathBuf::from("/c/hubs.json"),
        };
        fn keys(env: &[(&'static str, String)]) -> Vec<&'static str> {
            env.iter().map(|(k, _)| *k).collect()
        }
        let d = profile_env("default", "Default", Some(&paths));
        assert_eq!(keys(&d), vec!["MAUDE_PROFILE_ID", "MAUDE_PROFILE_LABEL"]);
        let w = profile_env("work", "Work", Some(&paths));
        assert_eq!(
            keys(&w),
            vec![
                "MAUDE_PROFILE_ID",
                "MAUDE_PROFILE_LABEL",
                "MAUDE_CLOUD_CONFIG",
                "HUBS_CONFIG_PATH"
            ]
        );
        assert_eq!(w[0].1, "work");
        assert_eq!(w[2].1, "/c/cloud.json");
        assert_eq!(w[3].1, "/c/hubs.json");
    }

    #[test]
    fn a_server_that_dies_during_startup_spends_the_budget() {
        // The real crash-loop shape: never gets far enough to serve anything.
        let mut n = 0;
        for _ in 0..3 {
            n = next_restart_count(n, Duration::from_millis(400));
        }
        assert_eq!(n, 3, "three fast deaths must reach MAX_RESTARTS");
        assert!(next_restart_count(n, Duration::from_millis(400)) > MAX_RESTARTS);
    }

    #[test]
    fn isolated_crashes_hours_apart_never_retire_the_project() {
        // The observed bug: maude-server took a Bun divide-by-zero at 14:30 and
        // again at 18:01, each time recovering fine. Under the old accounting a
        // third such crash in the same session would have retired the project
        // permanently — and silently.
        let mut n = 0;
        for _ in 0..10 {
            n = next_restart_count(n, Duration::from_secs(3 * 3600));
            assert!(
                n <= MAX_RESTARTS,
                "an isolated crash must never reach the cap"
            );
        }
        assert_eq!(n, 1);
    }

    #[test]
    fn a_healthy_run_resets_the_budget_but_still_counts_as_one_crash() {
        // Not 0 — a server that has just died is not in a clean state, and three
        // more deaths from here still have to reach the cap.
        assert_eq!(next_restart_count(3, HEALTHY_UPTIME), 1);
    }

    #[test]
    fn the_threshold_is_inclusive() {
        assert_eq!(next_restart_count(2, HEALTHY_UPTIME), 1);
        assert_eq!(
            next_restart_count(2, HEALTHY_UPTIME - Duration::from_millis(1)),
            3
        );
    }

    #[test]
    fn a_recovered_loop_still_ends_in_give_up_if_it_resumes() {
        // Two fast deaths, one long healthy run, then a fresh loop: the healthy
        // run must not carry the old strikes forward, and the new loop must
        // still be able to reach the cap on its own.
        let mut n = next_restart_count(0, Duration::from_secs(1));
        n = next_restart_count(n, Duration::from_secs(1));
        assert_eq!(n, 2);
        n = next_restart_count(n, Duration::from_secs(600));
        assert_eq!(n, 1, "a healthy run clears the earlier strikes");
        n = next_restart_count(n, Duration::from_secs(1));
        n = next_restart_count(n, Duration::from_secs(1));
        assert_eq!(n, 3);
        assert!(next_restart_count(n, Duration::from_secs(1)) > MAX_RESTARTS);
    }

    // ---- issue #115: printing must never be able to kill a spawned task ----

    /// Child half of the two probes below. A no-op unless the parent asked for
    /// it, so an ordinary `cargo test` run just skips straight past it.
    #[test]
    fn broken_stderr_probe_child() {
        let Ok(mode) = std::env::var("MAUDE_BROKEN_STDERR_PROBE") else {
            return;
        };
        // Let the parent close the read end of the pipe it handed us.
        std::thread::sleep(Duration::from_millis(300));
        for _ in 0..64 {
            if mode == "eprintln" {
                eprintln!("[maude:server] probe");
            } else {
                log_line("[maude:server] probe");
            }
        }
    }

    /// Re-exec this test binary with a stderr nobody is reading.
    fn broken_stderr_probe(mode: &str) -> Option<i32> {
        let exe = std::env::current_exe().expect("test binary path");
        // no-console-window: test-only re-exec.
        let mut child = std::process::Command::new(exe)
            .args([
                "--exact",
                "sidecar::tests::broken_stderr_probe_child",
                // Without this libtest swallows the write into its own buffer
                // and the pipe is never touched.
                "--nocapture",
            ])
            .env("MAUDE_BROKEN_STDERR_PROBE", mode)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("re-exec the test binary");
        // THE POINT. Dropping the read end leaves the child holding a broken
        // stderr pipe — the ordinary state of a .app launched from Finder or
        // the Dock, and what #115's three crash reports were.
        drop(child.stderr.take());
        child.wait().expect("probe child exits").code()
    }

    #[test]
    fn eprintln_dies_when_stderr_is_a_broken_pipe() {
        assert_eq!(
            broken_stderr_probe("eprintln"),
            Some(101),
            "`eprintln!` is expected to PANIC on a broken stderr pipe — this is \
             the fault behind #115, and the reason log_line exists"
        );
    }

    #[test]
    fn log_line_survives_a_broken_stderr_pipe() {
        assert_eq!(
            broken_stderr_probe("log_line"),
            Some(0),
            "log_line must swallow the write error and let the task carry on"
        );
    }

    /// The tripwire. A panic inside a spawned task is silent — it takes the
    /// task's REMAINING work with it and nothing reports the loss — so no print
    /// inside one may go through a macro that can panic.
    #[test]
    fn no_spawned_task_prints_through_a_panicking_macro() {
        // Both files that navigate the webview from inside a spawned task:
        // lib.rs on boot, sidecar.rs on respawn and on a project switch.
        let sources = [
            ("sidecar.rs", include_str!("sidecar.rs")),
            ("lib.rs", include_str!("lib.rs")),
        ];

        let mut offenders: Vec<String> = Vec::new();
        for (name, src) in sources {
            // Comments here legitimately NAME `eprint!` while explaining why it
            // is banned, so strip them before scanning.
            let code = src
                .lines()
                .map(|l| match l.find("//") {
                    Some(i) => &l[..i],
                    None => l,
                })
                .collect::<Vec<_>>()
                .join("\n");

            let mut rest = code.as_str();
            while let Some(at) = rest.find("async_runtime::spawn(") {
                let block = &rest[at..];
                // Walk to the end of the spawn call on paren/brace balance.
                let mut depth = 0i32;
                let mut end = block.len();
                for (i, ch) in block.char_indices() {
                    match ch {
                        '(' | '{' => depth += 1,
                        ')' | '}' => {
                            depth -= 1;
                            if depth == 0 {
                                end = i + 1;
                                break;
                            }
                        }
                        _ => {}
                    }
                }
                for line in block[..end].lines() {
                    if line.contains("eprintln!") || line.contains("eprint!") {
                        offenders.push(format!("    {name}: {}", line.trim()));
                    }
                }
                rest = &block[end..];
            }
        }

        assert!(
            offenders.is_empty(),
            "issue #115 — these prints sit inside a spawned task and can panic \
             it dead; use log_line / log_raw:\n{}",
            offenders.join("\n")
        );
    }

    // ── rest_policy (V2-1.1 decision 4, §5.2 "Rest (cap)", §7) ──────────────

    fn idle() -> Option<ShellStatus> {
        Some(ShellStatus::default())
    }

    fn cand(root: &str, label: Option<&str>, recency: u64, status: Option<ShellStatus>) -> RestCandidate {
        RestCandidate {
            root: root.to_string(),
            label: label.map(str::to_string),
            recency,
            status,
            booting: false,
        }
    }

    fn rested(root: &str, label: Option<&str>) -> RestPick {
        RestPick::Rest {
            root: root.to_string(),
            label: label.map(str::to_string),
        }
    }

    /// V2-3.6 L2: a burst of opens leaves servers still booting. They count
    /// toward the cap: with nothing restable yet the policy waits for them to
    /// bind instead of overflowing until some later spawn.
    #[test]
    fn rest_policy_counts_booting_servers_toward_the_cap() {
        let mut booting = cand("/boot", Some("p-boot"), 1, None);
        booting.booting = true;
        let c = vec![booting.clone(), cand("/f", Some("p-f"), 2, idle())];
        assert_eq!(pick_rest(2, 1, Some("p-f"), c), RestPick::Wait);
        // Once it has bound and reports idle, it is the one rested.
        let mut bound = booting;
        bound.booting = false;
        bound.status = idle();
        assert_eq!(
            pick_rest(2, 1, Some("p-f"), vec![bound, cand("/f", Some("p-f"), 2, idle())]),
            rested("/boot", Some("p-boot"))
        );
        // A FOCUSED booting tab is never the reason to wait (it cannot rest).
        let mut focused = cand("/f", Some("p-f"), 2, None);
        focused.booting = true;
        assert_eq!(
            pick_rest(2, 1, Some("p-f"), vec![cand("/a", Some("p-a"), 1, None), focused]),
            RestPick::Overflow
        );
    }

    #[test]
    fn rest_policy_cap_is_five_and_nothing_rests_at_or_under_it() {
        assert_eq!(RUNNING_CAP, 5);
        let six: Vec<RestCandidate> = (0..6)
            .map(|i| cand(&format!("/r{i}"), Some(&format!("p-{i}")), i, idle()))
            .collect();
        assert_eq!(pick_rest(5, 5, Some("p-5"), six.clone()), RestPick::UnderCap);
        assert_eq!(pick_rest(6, 5, Some("p-5"), six), rested("/r0", Some("p-0")));
    }

    #[test]
    fn rest_policy_rests_the_least_recently_focused_idle_tab() {
        let c = vec![
            cand("/c", Some("p-c"), 30, idle()),
            cand("/a", Some("p-a"), 10, idle()),
            cand("/b", Some("p-b"), 20, idle()),
            cand("/f", Some("p-f"), 40, idle()),
        ];
        assert_eq!(pick_rest(4, 3, Some("p-f"), c), rested("/a", Some("p-a")));
    }

    #[test]
    fn rest_policy_never_rests_a_busy_instance() {
        let ai = ShellStatus {
            ai: AiCounts { running: 0, awaiting: 1 },
            ..ShellStatus::default()
        };
        let unsent = ShellStatus {
            unsent: 2,
            ..ShellStatus::default()
        };
        let job = ShellStatus {
            jobs: 1,
            ..ShellStatus::default()
        };
        let c = vec![
            cand("/ai", Some("p-ai"), 1, Some(ai)),
            cand("/unsent", Some("p-unsent"), 2, Some(unsent)),
            cand("/job", Some("p-job"), 3, Some(job)),
            // No status (wedged, not up yet, wrong token): busy, conservatively.
            cand("/unknown", Some("p-unknown"), 4, None),
            cand("/idle", Some("p-idle"), 5, idle()),
            cand("/f", Some("p-f"), 6, idle()),
        ];
        assert_eq!(pick_rest(6, 5, Some("p-f"), c), rested("/idle", Some("p-idle")));
    }

    #[test]
    fn rest_policy_overflows_when_every_candidate_is_busy() {
        let busy = Some(ShellStatus {
            ai: AiCounts { running: 1, awaiting: 0 },
            ..ShellStatus::default()
        });
        let c = vec![
            cand("/a", Some("p-a"), 1, busy.clone()),
            cand("/b", Some("p-b"), 2, None),
            cand("/f", Some("p-f"), 3, idle()),
        ];
        assert_eq!(pick_rest(3, 2, Some("p-f"), c), RestPick::Overflow);
    }

    #[test]
    fn rest_policy_never_picks_the_focused_window() {
        // The focused tab is the least recent by tick (focus stamps can lag)
        // and idle — it still must not rest.
        let c = vec![
            cand("/f", Some("p-f"), 1, idle()),
            cand("/b", Some("p-b"), 2, None),
        ];
        assert_eq!(pick_rest(2, 1, Some("p-f"), c.clone()), RestPick::Overflow);
        let mut c = c;
        c[1].status = idle();
        assert_eq!(pick_rest(2, 1, Some("p-f"), c), rested("/b", Some("p-b")));
    }

    #[test]
    fn rest_policy_stops_windowless_instances_first() {
        // A windowless instance (an in-tab switch left it behind) goes before
        // any tab, however recently that tab was focused.
        let c = vec![
            cand("/tab", Some("p-tab"), 1, idle()),
            cand("/orphan", None, 99, idle()),
            cand("/f", Some("p-f"), 100, idle()),
        ];
        assert_eq!(pick_rest(3, 2, Some("p-f"), c), rested("/orphan", None));
    }

    #[test]
    fn running_cap_override_is_debug_only_and_sane() {
        // Unset (the normal case) is the cap itself.
        if std::env::var("MAUDE_E2E_RUNNING_CAP").is_err() {
            assert_eq!(running_cap(), RUNNING_CAP);
        }
    }
}
