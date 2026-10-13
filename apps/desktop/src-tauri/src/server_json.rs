// Read `<design_root>/_server.json` (DDR-106) — and the DDR-109 loopback guard.
//
// The dev-server (apps/studio/server.ts) writes `_server.json` after it binds:
//   { pid, port, url: "http://localhost:<port>", canvasOrigin?, started, ... }
// Since V2-3.2 part b the shell no longer WAITS on this file to navigate or
// probe: `_server.json` is in-project, so a planted copy could name an impostor.
// Every navigate and probe now reads the app-owned info file instead
// (`sidecar::wait_for_shell_url`, V2-1.1 decision 8). What is left here are the
// one-shot readers for callers that need the in-project facts (`save_export`,
// web_process.rs's pid-checked crash recovery).
//
// DDR-106: navigate the `url` field VERBATIM — it uses `localhost`, not
// `127.0.0.1` (different origins to WKWebView).

use serde::Deserialize;

#[derive(Deserialize)]
struct ServerInfo {
    url: Option<String>,
    port: Option<u16>,
    pid: Option<u32>,
}

/// One-shot read of `_server.json` — does not poll or
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
}
