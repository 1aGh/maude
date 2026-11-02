// The DDR-109 loopback guard (this module used to read `<design_root>/_server.json`, DDR-106).
//
// The dev-server (apps/studio/server.ts) writes `_server.json` after it binds:
//   { pid, port, url: "http://localhost:<port>", canvasOrigin?, started, ... }
// Since V2-3.2 part b the shell no longer WAITS on this file to navigate or
// probe: `_server.json` is in-project, so a planted copy could name an impostor.
// Every navigate, probe, crash recovery and export download now reads the
// app-owned info file instead (`sidecar::read_shell_origin`, V2-1.1 decision 8).
// V2-3.6 (H2, M1) removed the last two Rust readers of `_server.json`
// (web_process.rs crash recovery and `save_export`): an agent can rewrite the
// file with our child's pid and its own port. Rust no longer reads it at all —
// only the loopback guard is left here.

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
