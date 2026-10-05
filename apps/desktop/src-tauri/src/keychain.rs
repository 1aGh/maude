// keychain.rs — OS keychain storage for the GitHub token + a loopback-only HTTP
// bridge so the sidecar (dev-server) can read it at request time (Phase 28 / DDR-108).
//
// Why a bridge? The token lives in the OS keychain (macOS Keychain / Windows
// Credential Manager / Linux Secret Service). The dev-server runs as a SEPARATE
// process (a Tauri sidecar) and cannot call Tauri IPC or the OS keychain directly,
// so when its `/_api/github/*` endpoints need the token for Octokit, they fetch it
// over loopback from this bridge.
//
// SECURITY (Task 3 acceptance):
//   • The bridge binds to 127.0.0.1 only — unreachable off-loopback.
//   • Every request must carry a per-launch random `X-Maude-Token-Key` header that
//     ONLY the sidecar is told (passed via env at spawn). So neither the untrusted
//     canvas iframe (which can't reach this ephemeral port at all) nor a casual
//     local process can read the token. Missing/wrong key → 403.
//   • Only `GET /_tauri/github-token` is served; everything else → 404/405.
//   • The token is never logged. `github_get_token` is deliberately NOT exposed to
//     the webview — the webview only learns *whether* you're signed in, never the
//     token itself.

use std::sync::OnceLock;

use keyring::Entry;

/// Keychain coordinates. One credential: the GitHub access token.
const KEYCHAIN_SERVICE: &str = "com.maude.app.github";
const KEYCHAIN_ACCOUNT: &str = "maude-github-token";

const BRIDGE_PATH: &str = "/_tauri/github-token";
const KEY_HEADER: &str = "X-Maude-Token-Key";

fn entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())
}

/// Store the token (overwrites any prior). Called from the OAuth flow only.
pub fn set_token(token: &str) -> Result<(), String> {
    entry()?.set_password(token).map_err(|e| e.to_string())
}

/// Read the token, or `None` if not signed in. Internal — never exposed to the webview.
pub fn get_token() -> Option<String> {
    match entry() {
        Ok(e) => e.get_password().ok(),
        Err(_) => None,
    }
}

/// Delete the token (sign out). Idempotent — a missing entry is success.
pub fn delete_token() -> Result<(), String> {
    let e = entry()?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

// ── loopback token bridge ────────────────────────────────────────────────────

struct Bridge {
    port: u16,
    key: String,
}
static BRIDGE: OnceLock<Bridge> = OnceLock::new();

fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    // SECURITY (phase-28 audit, fail-closed): the bridge key's only job is to be
    // unguessable. If the OS RNG is unavailable we REFUSE to start the bridge —
    // never degrade to a time-seeded (guessable) key. getrandom is infallible on
    // every platform Maude targets, so this is a hard invariant, not a hot path.
    getrandom::getrandom(&mut buf).map_err(|e| format!("secure RNG unavailable: {e}"))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// Constant-time equality for the bridge key — avoids a timing side-channel on the
/// `X-Maude-Token-Key` check. Lengths are fixed (64-hex), so the length compare
/// leaks nothing.
fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Start the loopback token bridge on an ephemeral 127.0.0.1 port (idempotent).
/// Returns immediately; the server loop runs on a background thread.
pub fn start_token_bridge() -> Result<(), String> {
    if BRIDGE.get().is_some() {
        return Ok(());
    }
    let server = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|e| format!("could not bind token bridge: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or_else(|| "token bridge has no port".to_string())?;
    let key = random_hex(32)?;
    let key_for_thread = key.clone();

    std::thread::Builder::new()
        .name("maude-token-bridge".into())
        .spawn(move || {
            for req in server.incoming_requests() {
                handle_request(req, &key_for_thread);
            }
        })
        .map_err(|e| format!("could not start token bridge thread: {e}"))?;

    let _ = BRIDGE.set(Bridge { port, key });
    eprintln!("[maude] github token bridge on 127.0.0.1:{port}");
    Ok(())
}

/// The `(endpoint_url, key)` the sidecar needs to read the token, or `None` if the
/// bridge isn't up. Passed to the sidecar as env at spawn (sidecar.rs).
pub fn bridge_env() -> Option<(String, String)> {
    BRIDGE.get().map(|b| {
        (
            format!("http://127.0.0.1:{}{}", b.port, BRIDGE_PATH),
            b.key.clone(),
        )
    })
}

fn handle_request(req: tiny_http::Request, key: &str) {
    let is_get = req.method() == &tiny_http::Method::Get;
    let path_ok = req.url() == BRIDGE_PATH;
    let key_ok = req
        .headers()
        .iter()
        .any(|h| h.field.equiv(KEY_HEADER) && ct_eq(h.value.as_str(), key));

    // Wrong route → 404; wrong method on the route → 405; bad/missing key → 403.
    let status: u16 = if !path_ok {
        404
    } else if !is_get {
        405
    } else if !key_ok {
        403
    } else {
        200
    };

    let body = if status == 200 {
        match get_token() {
            Some(t) => t,
            // Authenticated bridge request but not signed in → 404 (no token).
            None => return respond(req, 404, String::new()),
        }
    } else {
        String::new()
    };
    respond(req, status, body);
}

fn respond(req: tiny_http::Request, status: u16, body: String) {
    let resp = tiny_http::Response::from_string(body).with_status_code(status);
    let _ = req.respond(resp);
}

// ── webview commands (NO token ever crosses to the webview) ──────────────────

/// Whether a GitHub token is currently stored. Drives the IdentityBar's signed-in
/// state on launch. Returns only a boolean — never the token.
///
/// `async` on purpose: Tauri runs a sync command on the MAIN thread, and a
/// keychain read can park on a macOS access prompt — which froze the whole
/// window (and every main-thread callback, e.g. web_process.rs crash recovery)
/// until the user answered it. Async commands run on the async runtime instead.
#[tauri::command]
pub async fn github_is_signed_in() -> bool {
    // E2E (debug builds only): reading the keychain here makes macOS raise a
    // "Maude wants to use your confidential information" prompt, and because a
    // debug build is re-signed on every `tauri build --debug`, "Always Allow"
    // never sticks — so EVERY rebuild puts a modal in front of the app. That
    // modal blocks the main thread, which freezes the WKWebView, which makes
    // every WebDriver script time out: a scenario suite that looks like a code
    // failure and isn't. A test run has no keychain token to find anyway.
    // Gated on `debug_assertions`, so the shipped `.app` always reads for real.
    #[cfg(debug_assertions)]
    if std::env::var_os("MAUDE_E2E_NO_KEYCHAIN").is_some() {
        return false;
    }
    get_token().is_some()
}

/// Sign out — delete the keychain token. Idempotent.
#[tauri::command]
pub async fn github_sign_out() -> Result<(), String> {
    delete_token()
}
