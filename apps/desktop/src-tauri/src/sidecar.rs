// Dev-server sidecar lifecycle — spawn / supervise / kill (DDR-106, DDR-109).
//
// The sidecar is the compiled Bun dev-server binary (DDR-009/084), bundled via
// Tauri `externalBin` as `binaries/maude-server-<target-triple>` and spawned with
// `--root <project>`. Loopback-only (DDR-109): the dev-server binds localhost.

use std::path::PathBuf;
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
}

/// Managed state holding the live sidecar pool + supervision flags.
pub struct SidecarState {
    /// project root → its running dev-server. At most `MAX_INSTANCES` entries.
    pub instances: Mutex<std::collections::HashMap<String, SidecarInstance>>,
    /// Set true on app quit so the supervisor does not respawn during shutdown.
    pub shutting_down: AtomicBool,
    /// The project the webview is CURRENTLY showing. Every consumer that asks
    /// "where are we" (export download URLs, the deep-link handler) means this
    /// one — not "the only one", which it no longer is.
    pub project_root: Mutex<String>,
    /// Source for `last_shown`. A counter, not a clock: `Instant`/`SystemTime`
    /// would drag time handling into a comparison that only needs an ordering.
    pub tick: AtomicU64,
}

const MAX_RESTARTS: u32 = 3;

/// How long a child must stay up before its death counts as an ISOLATED crash
/// rather than another turn of a loop. A crash loop is a server that cannot get
/// through startup; anything that served real requests for a minute first was
/// working, and the next crash starts a fresh budget.
const HEALTHY_UPTIME: Duration = Duration::from_secs(60);

/// How many project servers may run at once.
///
/// The ceiling is load-bearing, not polish: each instance is a Bun process plus
/// however many `claude` adapters its chats have spawned, and DDR-125 already
/// books "N processes" as the cost of parallel chats WITHIN one project. Without
/// a cap, a user clicking through ten recent projects would accumulate ten of
/// those stacks. Small on purpose — the point is "switch back and your work is
/// still running", which is a two-or-three-project habit, not a workspace.
const MAX_INSTANCES: usize = 3;

/// Milliseconds allowed for the "does this project still have a chat running?"
/// probe before eviction proceeds anyway. Short: a wedged server must not be
/// able to make itself un-evictable by never answering.
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

/// Spawn the dev-server sidecar and store the child in managed state. Drains the
/// command's event stream; on unexpected termination (not a quit), respawns with
/// linear backoff up to `MAX_RESTARTS`. Re-entrant: the respawn path calls back in.
pub fn spawn_server(app: &AppHandle) -> Result<(), String> {
    let root = app
        .state::<SidecarState>()
        .project_root
        .lock()
        .expect("sidecar mutex poisoned")
        .clone();
    spawn_for(app, &root)
}

/// Spawn a dev-server for ONE project root and register it in the pool.
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
        .env("NO_OPEN", "1");

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
    let base_path =
        resolve_login_path().unwrap_or_else(|| std::env::var("PATH").unwrap_or_default());
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

    // Loopback GitHub-token bridge (DDR-108): the dev-server's /_api/github/*
    // endpoints fetch the keychain token from this endpoint at request time, with
    // the per-launch key. Absent in non-Tauri `maude design serve` → those
    // endpoints degrade to "sign in via the desktop app".
    if let Some((endpoint, key)) = crate::keychain::bridge_env() {
        command = command
            .env("MAUDE_TOKEN_ENDPOINT", endpoint)
            .env("MAUDE_TOKEN_KEY", key);
    }

    // In a packaged .app the sidecar binary sits alone in Contents/MacOS/ with no
    // apps/studio/ up-tree, so paths.ts walk-up can't find the runtime. Point it at
    // the runtime we ship as a bundle resource (Resources/apps/studio). In dev this
    // dir doesn't exist → left unset → walk-up resolves the source tree (DDR-106).
    if let Ok(resource_dir) = app.path().resource_dir() {
        // Tauri's resource-path mapping varies by version/config; probe the likely
        // landing spots for the staged `apps/studio` runtime (anchor: it has `dist/`).
        let candidates = [
            resource_dir.join("apps").join("studio"),
            resource_dir.join("resources").join("apps").join("studio"),
            resource_dir.join("_up_").join("apps").join("studio"),
            resource_dir.join("studio"),
        ];
        if let Some(studio) = candidates.into_iter().find(|p| p.join("dist").exists()) {
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

    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("sidecar spawn failed: {e}"))?;

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
        });
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
                    // Stamped BEFORE the spawn so the recovery wait below can
                    // tell the fresh child's `_server.json` from the dead one's
                    // (issue #115). `spawn_for` also removes the stale file; this
                    // is the half that does not depend on that removal working.
                    let spawn_at = std::time::SystemTime::now();
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
                        // new process — but only if the crashed root is still
                        // what's on screen; the user may have switched projects
                        // while this one was down, and we must not yank them
                        // back to it.
                        let app2 = app.clone();
                        let root2 = supervised_root.clone();
                        tauri::async_runtime::spawn(async move {
                            let design_root = std::path::Path::new(&root2).join(".design");
                            match crate::server_json::wait_for_server_since(
                                design_root,
                                120_000,
                                Some(spawn_at),
                            )
                            .await
                            {
                                Ok(url) => {
                                    let still_shown = app2
                                        .state::<SidecarState>()
                                        .project_root
                                        .lock()
                                        .expect("sidecar mutex poisoned")
                                        .clone()
                                        == root2;
                                    if !still_shown {
                                        return;
                                    }
                                    match url.parse::<tauri::Url>() {
                                        Ok(parsed)
                                            if crate::server_json::is_loopback_url(&parsed) =>
                                        {
                                            if let Some(window) = app2.get_webview_window("main")
                                            {
                                                log_line(&format!(
                                                    "[maude] dev-server recovered — reloading webview for {root2}"
                                                ));
                                                if let Err(e) = window.navigate(parsed) {
                                                    log_line(&format!(
                                                        "[maude] post-respawn navigate failed: {e}"
                                                    ));
                                                }
                                            }
                                        }
                                        Ok(parsed) => log_line(&format!(
                                            "[maude] refusing non-loopback navigate (DDR-109): {parsed}"
                                        )),
                                        Err(e) => {
                                            log_line(&format!("[maude] invalid server url {url}: {e}"))
                                        }
                                    }
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

/// Restart-budget accounting: what this death costs the instance.
///
/// Extracted from the supervisor so the loop-vs-isolated distinction is unit-
/// testable without a running app — the same reason `notify::transition_kind`
/// exists apart from its poller.
///
/// A death after `HEALTHY_UPTIME` opens a fresh budget at 1 rather than spending
/// the previous one. Returning 1 and not 0 is deliberate: this WAS a crash, and
/// three more in quick succession from here must still reach the cap.
fn next_restart_count(previous: u32, uptime: Duration) -> u32 {
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
    let name = crate::notify::sanitize_notify_field(
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

/// Switch the open project IN-PROCESS (File ▸ Open Project…): point the dev-server
/// at a new root and reload the webview — WITHOUT `app.restart()`.
///
/// Why not restart: `app.restart()` relaunches the binary, and on a non-bundled
/// `tauri dev` binary macOS delivers an "open" Apple Event that aborts `tao` in
/// `did_finish_launching` (SIGABRT). Switching in-process avoids that entirely and
/// is better UX (no window flash). The supervisor's respawn (Terminated → spawn)
/// reads the updated `project_root`, so killing the child re-spawns it with the new
/// root; we then re-navigate once the new `_server.json` lands.
pub fn switch_project(app: &AppHandle, new_root: PathBuf, open: Option<String>) {
    let state = app.state::<SidecarState>();
    let root = new_root.to_string_lossy().to_string();
    *state.project_root.lock().expect("sidecar mutex poisoned") = root.clone();
    eprintln!("[maude] switching project → {}", new_root.display());

    let design_root = new_root.join(".design");

    // SPAWN-OR-ATTACH (Task 10). This used to unconditionally kill the child and
    // delete `_server.json` so the supervisor would respawn at the new root.
    // Both halves are now wrong in the pool world:
    //
    //  • Killing tore down the WHOLE server process, so every chat in the
    //    project we're leaving died — not just the visible one. Keeping it
    //    alive is the entire point of this task.
    //  • Deleting `_server.json` was safe when it could only ever be a stale
    //    file from a previous app session. With a pool it may be a LIVE
    //    instance's state for a project that is already running, and removing
    //    it would orphan a healthy server (`wait_for_server` would then block
    //    on a write that never comes, because that server already wrote it).
    //    So it is deleted ONLY when we are actually about to spawn.
    let already_running = {
        let mut pool = state.instances.lock().expect("sidecar mutex poisoned");
        let tick = state.tick.fetch_add(1, Ordering::SeqCst);
        match pool.get_mut(&root) {
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
        eprintln!("[maude] project already running — attaching to its live server");
    } else {
        let _ = std::fs::remove_file(design_root.join("_server.json"));
        if let Err(e) = spawn_for(app, &root) {
            eprintln!("[maude] switch: could not spawn dev-server: {e}");
        }
    }

    // Trim the pool AFTER the switch, so the project we just moved to (now the
    // most-recently-shown) can never be the one evicted.
    reap_instances(app);

    // Re-navigate once the target project's dev-server is up. Unchanged for the
    // spawn path; instant for the attach path, since `_server.json` is already
    // there from the live instance. The DDR-109 loopback guard applies per
    // instance exactly as before — a pool does not relax it.
    //
    // Every print in the task below goes through `log_line` (issue #115): a
    // panic here is silent and would take `window.navigate` with it, so the
    // user switches project and the webview simply never follows.
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match crate::server_json::wait_for_server(design_root, 120_000).await {
            Ok(url) => {
                log_line(&format!("[maude] project switched — navigating to {url}"));
                if let Some(window) = app.get_webview_window("main") {
                    match url.parse::<tauri::Url>() {
                        Ok(mut parsed) if crate::server_json::is_loopback_url(&parsed) => {
                            if let Some(ref rel) = open {
                                parsed.query_pairs_mut().append_pair("open", rel);
                            }
                            if let Err(e) = window.navigate(parsed) {
                                log_line(&format!("[maude] navigate failed: {e}"));
                            }
                        }
                        Ok(parsed) => log_line(&format!(
                            "[maude] refusing non-loopback navigate (DDR-109): {parsed}"
                        )),
                        Err(e) => log_line(&format!("[maude] invalid server url {url}: {e}")),
                    }
                }
            }
            Err(e) => log_line(&format!("[maude] switch: dev-server did not come up: {e}")),
        }
    });
}

/// Is a chat mid-turn in the project served at `design_root`?
///
/// Asks that instance's own dev-server (`/_api/acp/running`, added for the
/// branch-switch warning). Any failure — no `_server.json`, refused connection,
/// timeout, unparseable body — answers `false`, i.e. "evictable". That default
/// is deliberate: a server we cannot talk to is not one whose running turns we
/// can protect, and letting it veto its own eviction forever would turn a wedged
/// process into an unkillable one.
fn has_running_chat(design_root: &std::path::Path) -> bool {
    let Some(base) = crate::server_json::read_server_url(design_root) else {
        return false;
    };
    // SECURITY (security-auditor A1, HIGH) — `_server.json` lives under the
    // (untrusted, DDR-054) PROJECT root, and `server_json.rs` says so explicitly:
    // its `url` "originates from a file under the (potentially untrusted) project
    // root, so the navigate target is validated rather than trusted (security
    // review F3)". The first cut of this function passed that string straight
    // into curl's argv, skipping the very guard the navigate site 25 lines above
    // already applies. Two exploitable shapes, both reached by a prompt-injected
    // session writing `_server.json` — which is IN-PROJECT and therefore
    // auto-approved by the write gate this same feature added:
    //   • `{"url":"http://attacker.tld"}` → an outbound beacon from the native
    //     app, off the permission surface entirely.
    //   • `{"url":"-K/path/to/attacker.conf"}` → the leading `-` makes curl read
    //     it as `--config`, which can specify an arbitrary URL *and* an
    //     arbitrary output file. Arbitrary outbound request + arbitrary write.
    // Triggered whenever `reap_instances` probes that project.
    //
    // Parse and enforce loopback with the SAME `is_loopback_url` the navigate
    // site uses — one rule, one place. A non-loopback or unparseable url ⇒
    // "evictable", the same safe default as every other failure below.
    let Ok(parsed) = base.parse::<tauri::Url>() else {
        eprintln!("[maude] refusing to probe unparseable _server.json url: {base}");
        return false;
    };
    if !crate::server_json::is_loopback_url(&parsed) {
        eprintln!("[maude] refusing non-loopback _server.json url (DDR-109): {parsed}");
        return false;
    }
    // Built from the parsed url's ORIGIN, never the raw string — so a leading
    // `-` cannot survive to be read as a curl flag even if parsing somehow
    // admitted it. Origin rather than Display: `Url`'s Display keeps whatever
    // path the file supplied, so a `_server.json` carrying
    // `http://localhost:4399/foo` would concatenate into `/foo_api/acp/running`
    // and 404 — which this function reads as "busy", quietly making that project
    // un-evictable. `ascii_serialization()` is scheme+host+port only, so the
    // path we append is always the one we mean.
    let url = format!("{}/_api/acp/running", parsed.origin().ascii_serialization());
    // `curl` rather than a new HTTP crate: this is one loopback GET on a rare
    // path, and it mirrors resolve_login_path's existing shell-out-to-a-system-
    // binary pattern rather than adding a dependency for it.
    let out = std::process::Command::new("curl")
        .args([
            "-s",
            "--max-time",
            &format!("{:.1}", RUNNING_PROBE_TIMEOUT_MS as f64 / 1000.0),
            // `--` terminates option parsing: belt-and-braces alongside the
            // loopback validation above, so no argv position can ever be
            // reinterpreted as a flag (`-K` being the dangerous one).
            "--",
            &url,
        ])
        .output();
    match out {
        Ok(o) => {
            let body = String::from_utf8_lossy(&o.stdout);
            // `{"running":0,...}` ⇒ idle. Substring rather than a JSON parse:
            // the shape is ours, one field, and a parse failure would have to
            // fall back to this anyway.
            !body.contains("\"running\":0")
        }
        Err(_) => false,
    }
}

/// Enforce MAX_INSTANCES by shutting down the least-recently-shown IDLE project.
///
/// "Idle" means no chat is mid-turn — the reap policy the plan asks for. The
/// currently-displayed project is never a candidate. If every non-displayed
/// instance is busy, the pool is allowed to exceed the ceiling rather than kill
/// a running turn: the ceiling exists to stop unbounded accumulation, and a user
/// who has three projects genuinely working at once has made that choice
/// explicitly. It re-trims on the next switch, once something goes idle.
fn reap_instances(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    let current = state
        .project_root
        .lock()
        .expect("sidecar mutex poisoned")
        .clone();
    loop {
        let candidates: Vec<String> = {
            let pool = state.instances.lock().expect("sidecar mutex poisoned");
            if pool.len() <= MAX_INSTANCES {
                return;
            }
            let mut sorted: Vec<(String, u64)> = pool
                .iter()
                .filter(|(root, _)| **root != current)
                .map(|(root, inst)| (root.clone(), inst.last_shown))
                .collect();
            sorted.sort_by_key(|(_, tick)| *tick);
            sorted.into_iter().map(|(root, _)| root).collect()
        };
        // CORRECTNESS (security-auditor A2) — walk the WHOLE least-recently-shown
        // list looking for an idle instance, rather than giving up at the first
        // busy one. The first cut returned there, so a single long-running old
        // project pinned the pool above MAX_INSTANCES indefinitely: the ceiling
        // silently stopped being a ceiling, which is exactly the process
        // accumulation this constant exists to prevent.
        let mut evicted = false;
        for root in candidates {
            // Probed OUTSIDE the mutex — the curl is bounded but still slow
            // enough that holding the pool lock across it would stall an
            // unrelated switch.
            if has_running_chat(&PathBuf::from(&root).join(".design")) {
                eprintln!("[maude] not evicting {root} — a chat is still running");
                continue;
            }
            eprintln!("[maude] pool over {MAX_INSTANCES} — shutting down idle project {root}");
            shutdown_instance(app, &root);
            evicted = true;
            break;
        }
        // EVERY non-displayed instance is busy. Allow the overflow rather than
        // kill a running turn — the ceiling exists to stop unbounded drift, and
        // a user with three projects genuinely working at once chose that. The
        // next switch re-trims once something goes idle.
        if !evicted {
            return;
        }
    }
}

/// Remove ONE instance from the pool and terminate its child. Removing it from
/// the map first is what tells the supervisor task (which checks membership on
/// `Terminated`) that this death was deliberate and must not be respawned.
fn shutdown_instance(app: &AppHandle, root: &str) {
    let state = app.state::<SidecarState>();
    let child = {
        let mut pool = state.instances.lock().expect("sidecar mutex poisoned");
        pool.remove(root).and_then(|inst| inst.child)
    };
    if let Some(child) = child {
        terminate(child);
    }
    // feature-acp-turn-notifications — clear ONLY the transition-detection
    // state, not the notification budget: this is the reap-eviction path,
    // driven by `has_running_chat`'s answer on the SAME untrusted
    // `_server.json` an attacker already controls in the threat model this
    // feature's own security review is about — a full clear here would let a
    // compromised project reset its notification cap on demand by answering
    // one probe "idle". See `clear_project_reaped`'s doc comment.
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
fn terminate(child: CommandChild) {
    let pid = child.pid();
    #[cfg(unix)]
    {
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
}

/// `log_line` without the trailing newline — for mirroring sidecar output that
/// already carries its own.
fn log_raw(chunk: &str) {
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
        state.shutting_down.store(true, Ordering::SeqCst);
        let children: Vec<(String, CommandChild)> = {
            let mut pool = state.instances.lock().expect("sidecar mutex poisoned");
            pool.drain()
                .filter_map(|(root, inst)| inst.child.map(|c| (root, c)))
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
    use super::*;

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
}
