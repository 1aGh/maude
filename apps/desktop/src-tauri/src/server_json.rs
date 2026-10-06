// Poll `<design_root>/_server.json` to discover the dev-server URL (DDR-106).
//
// The dev-server (apps/studio/server.ts) writes `_server.json` after it binds:
//   { pid, port, url: "http://localhost:<port>", canvasOrigin?, started, ... }
// First launch runs boot-self-heal (bun install + build.ts) → up to ~90 s, so the
// caller uses a 120 s timeout on cold start; subsequent launches are < 2 s.
//
// DDR-106: navigate the `url` field VERBATIM — it uses `localhost`, not
// `127.0.0.1` (different origins to WKWebView).

use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;

#[derive(Deserialize)]
struct ServerInfo {
    url: Option<String>,
    port: Option<u16>,
    pid: Option<u32>,
}

/// Poll `<design_root>/_server.json` every 200 ms until a URL is resolvable or the
/// timeout elapses. Returns the URL string to navigate the webview to.
///
/// Accepts ANY readable `_server.json`, including one left behind by a process
/// that has since died. Correct for callers that are attaching to a server they
/// have reason to believe is already up (`switch_project`'s attach path); WRONG
/// for a caller waiting on a server it just spawned — see `wait_for_server_since`.
pub async fn wait_for_server(design_root: PathBuf, timeout_ms: u64) -> Result<String, String> {
    wait_for_server_since(design_root, timeout_ms, None).await
}

/// `wait_for_server`, but ignoring any `_server.json` last written before
/// `not_before` — i.e. "wait for a server that started AFTER this moment".
///
/// Issue #115. The dev-server unlinks `_server.json` only on a graceful shutdown,
/// so after a crash the dead process's file is still on disk, and a plain
/// `wait_for_server` satisfies itself from it in ~0 ms. The supervisor's
/// post-respawn recovery then re-navigates the webview at a server that has not
/// bound a port yet, which fails, which leaves the page holding the *previous*
/// process's `canvasOrigin` — an OS-assigned ephemeral port that no longer
/// exists — and every canvas the user opens from then on is a blank pane.
///
/// FRESHNESS IS THE FILE'S MTIME, NOT ITS `started` FIELD. mtime needs no date
/// parser (so no new dependency) and cannot be influenced by the file's contents,
/// which originate under a project root we treat as untrusted (DDR-054) — the
/// same reason `is_loopback_url` validates the `url` field rather than trusting
/// it. A PID-liveness check would be the more direct test but needs `libc`, and
/// `spawn_for` now removes the file before spawning anyway, so this is the belt
/// to that braces: it also covers a removal that failed, and a `_server.json`
/// written by an unrelated `maude design serve` against the same project.
pub async fn wait_for_server_since(
    design_root: PathBuf,
    timeout_ms: u64,
    not_before: Option<std::time::SystemTime>,
) -> Result<String, String> {
    let info_file = design_root.join("_server.json");
    let tries = (timeout_ms / 200).max(1);

    for _ in 0..tries {
        if is_fresh_enough(&info_file, not_before) {
            if let Ok(bytes) = std::fs::read(&info_file) {
                if let Ok(info) = serde_json::from_slice::<ServerInfo>(&bytes) {
                    if let Some(url) = info.url.filter(|u| !u.is_empty()) {
                        return Ok(url);
                    }
                    if let Some(port) = info.port {
                        return Ok(format!("http://localhost:{port}"));
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    Err(format!(
        "timed out after {timeout_ms} ms waiting for {}",
        info_file.display()
    ))
}

/// True when `file` may be read as the CURRENT server's info. With no
/// `not_before` every file qualifies (the historical behavior). With one, the
/// file must have been written at or after that instant.
///
/// An unreadable mtime (a platform or filesystem that does not report one) is
/// treated as NOT fresh: the caller asked for a server started after a specific
/// moment, and "I can't tell" is not that. The wait keeps polling and falls
/// through to its timeout, which the respawn path already handles — strictly
/// better than re-navigating at a URL that may be a corpse.
fn is_fresh_enough(file: &std::path::Path, not_before: Option<std::time::SystemTime>) -> bool {
    let Some(cutoff) = not_before else {
        return true;
    };
    match std::fs::metadata(file).and_then(|m| m.modified()) {
        Ok(mtime) => mtime >= cutoff,
        Err(_) => false,
    }
}

/// One-shot read of `_server.json` — unlike `wait_for_server`, does not poll or
/// time out. For callers that run AFTER the server is already known to be up
/// (e.g. `save_export` resolving a download URL for a running session), a
/// poll loop would be the wrong shape — this just returns `None` if the file
/// is absent/unparseable so the caller can surface its own clear error.
pub fn read_server_url(design_root: &std::path::Path) -> Option<String> {
    let bytes = std::fs::read(design_root.join("_server.json")).ok()?;
    let info: ServerInfo = serde_json::from_slice(&bytes).ok()?;
    if let Some(url) = info.url.filter(|u| !u.is_empty()) {
        return Some(url);
    }
    info.port.map(|p| format!("http://localhost:{p}"))
}

/// `read_server_url` plus the `pid` the server wrote — for callers that must
/// confirm the url belongs to a process THEY spawned, not merely to whatever
/// last wrote the file or now listens on the port (web_process.rs crash recovery).
pub fn read_server_pid_url(design_root: &std::path::Path) -> Option<(u32, String)> {
    let bytes = std::fs::read(design_root.join("_server.json")).ok()?;
    let info: ServerInfo = serde_json::from_slice(&bytes).ok()?;
    let pid = info.pid?;
    let url = match info.url.filter(|u| !u.is_empty()) {
        Some(u) => u,
        None => format!("http://localhost:{}", info.port?),
    };
    Some((pid, url))
}

/// Enforce the DDR-109 §1 loopback-only invariant IN CODE at the navigate sites:
/// only ever navigate the webview to `http://localhost:*` / `http://127.0.0.1:*`.
/// Defense-in-depth — `_server.json` is cleared before spawn, but its `url` still
/// originates from a file under the (potentially untrusted) project root, so the
/// navigate target is validated rather than trusted (security review F3).
pub fn is_loopback_url(url: &tauri::Url) -> bool {
    url.scheme() == "http" && matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> tauri::Url {
        s.parse().expect("test url should parse")
    }

    #[test]
    fn accepts_loopback_http() {
        assert!(is_loopback_url(&url("http://localhost:4399")));
        assert!(is_loopback_url(&url("http://127.0.0.1:4399")));
        // Path/query on the loopback origin is still the same origin.
        assert!(is_loopback_url(&url("http://localhost:4399/ui/foo?x=1")));
    }

    #[test]
    fn rejects_non_loopback_host() {
        // The whole point of the guard: `_server.json` lives under a possibly
        // untrusted project root, so a rewritten `url` must not steer the
        // webview off-box (DDR-109 §1 / security review F3).
        assert!(!is_loopback_url(&url("http://evil.example/")));
        assert!(!is_loopback_url(&url("http://127.0.0.1.evil.example/")));
        // A loopback-looking host that is NOT one of the two accepted spellings.
        assert!(!is_loopback_url(&url("http://[::1]:4399")));
    }

    #[test]
    fn rejects_non_http_scheme() {
        assert!(!is_loopback_url(&url("https://localhost:4399")));
        assert!(!is_loopback_url(&url("file:///Applications/Maude.app")));
        assert!(!is_loopback_url(&url("javascript:alert(1)")));
    }

    #[tokio::test]
    async fn wait_for_server_times_out_without_server_json() {
        // The recovery path's failure mode: no `_server.json` yet. Must return
        // Err (so the splash keeps retrying) rather than hang or panic.
        let dir = std::env::temp_dir().join("maude-server-json-test-empty");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let _ = std::fs::remove_file(dir.join("_server.json"));

        let err = wait_for_server(dir, 200)
            .await
            .expect_err("should time out");
        assert!(err.contains("timed out"), "unexpected error: {err}");
    }

    #[tokio::test]
    async fn wait_for_server_reads_url_then_falls_back_to_port() {
        let dir = std::env::temp_dir().join("maude-server-json-test-read");
        std::fs::create_dir_all(&dir).expect("temp dir");

        std::fs::write(
            dir.join("_server.json"),
            br#"{"url":"http://localhost:4401","port":4399}"#,
        )
        .expect("write _server.json");
        assert_eq!(
            wait_for_server(dir.clone(), 1_000).await.expect("url"),
            "http://localhost:4401"
        );

        // `port` only when `url` is absent — the DDR-106 verbatim-url rule.
        std::fs::write(dir.join("_server.json"), br#"{"port":4399}"#).expect("write _server.json");
        assert_eq!(
            wait_for_server(dir.clone(), 1_000)
                .await
                .expect("port fallback"),
            "http://localhost:4399"
        );

        let _ = std::fs::remove_file(dir.join("_server.json"));
    }

    // ── issue #115 — a crashed server's `_server.json` must not satisfy the
    // post-respawn wait. These pin the freshness gate itself; the caller-side
    // wiring (respawn passes `Some(spawn_at)`, attach passes `None`) is asserted
    // by `wait_for_server_still_accepts_a_pre_existing_file` below.

    #[test]
    fn a_stale_server_json_is_not_fresh_enough() {
        let dir = std::env::temp_dir().join("maude-server-json-test-stale");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let file = dir.join("_server.json");
        std::fs::write(&file, br#"{"url":"http://localhost:4399"}"#).expect("write");

        // The dead process wrote the file; THEN we decided to respawn.
        let spawn_at = std::time::SystemTime::now() + Duration::from_secs(1);
        assert!(
            !is_fresh_enough(&file, Some(spawn_at)),
            "a file written before the respawn must be rejected"
        );
        // Same file, no cutoff → the attach path's historical behavior.
        assert!(is_fresh_enough(&file, None));

        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn a_missing_server_json_is_not_fresh_enough() {
        let dir = std::env::temp_dir().join("maude-server-json-test-absent");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let file = dir.join("_server.json");
        let _ = std::fs::remove_file(&file);

        assert!(!is_fresh_enough(&file, Some(std::time::SystemTime::now())));
        // With no cutoff the gate is open, and the READ that follows it fails —
        // which is what produces the timeout, not the gate.
        assert!(is_fresh_enough(&file, None));
    }

    #[tokio::test]
    async fn wait_for_server_since_times_out_on_a_dead_servers_file() {
        // THE #115 REGRESSION. Before the fix this returned the dead process's
        // URL in ~0 ms, and the supervisor re-navigated the webview at it.
        let dir = std::env::temp_dir().join("maude-server-json-test-crashed");
        std::fs::create_dir_all(&dir).expect("temp dir");
        std::fs::write(
            dir.join("_server.json"),
            br#"{"url":"http://localhost:4399","port":4399}"#,
        )
        .expect("write _server.json");

        let spawn_at = std::time::SystemTime::now() + Duration::from_secs(1);
        let err = wait_for_server_since(dir.clone(), 400, Some(spawn_at))
            .await
            .expect_err("a pre-respawn _server.json must not satisfy the wait");
        assert!(err.contains("timed out"), "unexpected error: {err}");

        let _ = std::fs::remove_file(dir.join("_server.json"));
    }

    #[tokio::test]
    async fn wait_for_server_since_accepts_a_file_written_after_the_cutoff() {
        let dir = std::env::temp_dir().join("maude-server-json-test-fresh");
        std::fs::create_dir_all(&dir).expect("temp dir");
        let _ = std::fs::remove_file(dir.join("_server.json"));

        let spawn_at = std::time::SystemTime::now();
        // The fresh child binds a DIFFERENT port and writes its own file while
        // the wait is already polling.
        let write_dir = dir.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(250)).await;
            std::fs::write(
                write_dir.join("_server.json"),
                br#"{"url":"http://localhost:4400","port":4400}"#,
            )
            .expect("write _server.json");
        });

        let url = wait_for_server_since(dir.clone(), 5_000, Some(spawn_at))
            .await
            .expect("the fresh server's file must satisfy the wait");
        assert_eq!(url, "http://localhost:4400");

        let _ = std::fs::remove_file(dir.join("_server.json"));
    }

    #[tokio::test]
    async fn wait_for_server_still_accepts_a_pre_existing_file() {
        // `switch_project`'s attach path waits on a server that is ALREADY up,
        // whose `_server.json` is by definition old. The freshness gate must not
        // reach it — hence the `None` default that `wait_for_server` passes.
        let dir = std::env::temp_dir().join("maude-server-json-test-attach");
        std::fs::create_dir_all(&dir).expect("temp dir");
        std::fs::write(
            dir.join("_server.json"),
            br#"{"url":"http://localhost:4399"}"#,
        )
        .expect("write _server.json");

        assert_eq!(
            wait_for_server(dir.clone(), 1_000)
                .await
                .expect("attach path must still resolve instantly"),
            "http://localhost:4399"
        );

        let _ = std::fs::remove_file(dir.join("_server.json"));
    }
}
