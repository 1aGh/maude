// keychain.rs — OS keychain storage for GitHub tokens, one slot PER PROFILE, + a
// loopback-only HTTP bridge so each sidecar (dev-server) can read ITS profile's
// token at request time (Phase 28 / DDR-108; per-profile since V2-3.1).
//
// Why a bridge? The token lives in the OS keychain (macOS Keychain / Windows
// Credential Manager / Linux Secret Service). The dev-server runs as a SEPARATE
// process (a Tauri sidecar) and cannot call Tauri IPC or the OS keychain directly,
// so when its `/_api/github/*` endpoints need the token for Octokit, they fetch it
// over loopback from this bridge.
//
// Slots (profiles.rs): `default` → account `maude-github-token` (the pre-V2-3.1
// slot, unchanged — existing sign-ins keep working); profile `<id>` → account
// `maude-github-token:<id>`. Setting A never touches B's slot.
//
// SECURITY (Task 3 acceptance, extended for profiles):
//   • The bridge binds to 127.0.0.1 only — unreachable off-loopback.
//   • Every request must carry an `X-Maude-Token-Key` header. Keys are minted PER
//     SPAWN (`mint_key(profile)`) and handed to exactly one sidecar via env, and
//     each key maps to exactly one profile: the bridge serves only THAT profile's
//     token, so project A's server can never read project B's account. A key is
//     revoked when its process is shut down or respawned (sidecar.rs) — a stale
//     key must not outlive its process.
//   • The presented key is compared in constant time against EVERY stored key —
//     iterate, never `HashMap::get` on the raw header — so a wrong key costs the
//     same as a right one and the map's hashing leaks nothing.
//   • Only `GET /_tauri/github-token` is served; everything else → 404/405.
//   • The token is never logged, never on disk (DDR-132). `github_get_token` is
//     deliberately NOT exposed to the webview — it only learns *whether* a profile
//     is signed in, never the token itself.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, OnceLock};

use keyring::Entry;

use crate::profiles;

/// Keychain service. The account is per profile (`profiles::keychain_account`).
const KEYCHAIN_SERVICE: &str = "com.maude.app.github";

const BRIDGE_PATH: &str = "/_tauri/github-token";
const KEY_HEADER: &str = "X-Maude-Token-Key";

fn entry(profile: &str) -> Result<Entry, String> {
    let account = profiles::keychain_account(profile)?;
    Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())
}

/// Store `profile`'s token (overwrites any prior). Called from the OAuth flow only.
pub fn set_token(profile: &str, token: &str) -> Result<(), String> {
    entry(profile)?
        .set_password(token)
        .map_err(|e| e.to_string())
}

/// Read `profile`'s token, or `None` if not signed in. Internal — never exposed to
/// the webview.
pub fn get_token(profile: &str) -> Option<String> {
    entry(profile).ok()?.get_password().ok()
}

/// Delete `profile`'s token (sign out). Idempotent — a missing entry is success.
pub fn delete_token(profile: &str) -> Result<(), String> {
    let e = entry(profile)?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

// ── loopback token bridge ────────────────────────────────────────────────────

/// The bridge's bound port (set once, when the listener is up).
static BRIDGE_PORT: OnceLock<u16> = OnceLock::new();
/// key → profile. One entry per live sidecar spawn.
static BRIDGE_KEYS: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn keys() -> std::sync::MutexGuard<'static, HashMap<String, String>> {
    // A poisoned lock still holds a coherent map (every critical section is a
    // single insert/remove/scan) — keep serving rather than wedging sign-in.
    BRIDGE_KEYS.lock().unwrap_or_else(|e| e.into_inner())
}

fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    // SECURITY (phase-28 audit, fail-closed): the bridge key's only job is to be
    // unguessable. If the OS RNG is unavailable we REFUSE to mint a key — never
    // degrade to a time-seeded (guessable) one. getrandom is infallible on every
    // platform Maude targets, so this is a hard invariant, not a hot path.
    getrandom::getrandom(&mut buf).map_err(|e| format!("secure RNG unavailable: {e}"))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// Constant-time equality for the bridge key — avoids a timing side-channel on the
/// `X-Maude-Token-Key` check. Stored keys are fixed-length (64-hex), so the length
/// compare leaks nothing about any key.
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

/// The profile `presented` is a key for, scanning EVERY stored key with no early
/// exit (see the SECURITY note at the top of the file).
fn profile_for_key(map: &HashMap<String, String>, presented: &str) -> Option<String> {
    let mut found = None;
    for (key, profile) in map.iter() {
        if ct_eq(key, presented) {
            found = Some(profile.clone());
        }
    }
    found
}

/// Mint a fresh per-spawn key bound to `profile`. Returns the key; the caller
/// (sidecar.rs) passes it to exactly one child and revokes it when that child is
/// shut down or respawned.
pub fn mint_key(profile: &str) -> Result<String, String> {
    profiles::validate_id(profile)?;
    let key = random_hex(32)?;
    keys().insert(key.clone(), profile.to_string());
    Ok(key)
}

/// Revoke a key. Idempotent — revoking twice (or an unknown key) is a no-op.
pub fn revoke_key(key: &str) {
    keys().remove(key);
}

/// Start the loopback token bridge on an ephemeral 127.0.0.1 port (idempotent).
/// Returns immediately; the server loop runs on a background thread.
pub fn start_token_bridge() -> Result<(), String> {
    if BRIDGE_PORT.get().is_some() {
        return Ok(());
    }
    let server = tiny_http::Server::http("127.0.0.1:0")
        .map_err(|e| format!("could not bind token bridge: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or_else(|| "token bridge has no port".to_string())?;

    std::thread::Builder::new()
        .name("maude-token-bridge".into())
        .spawn(move || {
            for req in server.incoming_requests() {
                handle_request(req);
            }
        })
        .map_err(|e| format!("could not start token bridge thread: {e}"))?;

    let _ = BRIDGE_PORT.set(port);
    crate::sidecar::log_line(&format!("[maude] github token bridge on 127.0.0.1:{port}"));
    Ok(())
}

/// The bridge endpoint URL, or `None` if the bridge isn't up.
fn bridge_endpoint() -> Option<String> {
    BRIDGE_PORT
        .get()
        .map(|port| format!("http://127.0.0.1:{port}{BRIDGE_PATH}"))
}

/// `(endpoint_url, freshly minted key for profile)` for ONE sidecar spawn, or
/// `None` when the bridge isn't up (non-Tauri `maude design serve` never gets
/// here) or the RNG refused. Passed to the sidecar as env at spawn (sidecar.rs).
pub fn bridge_env(profile: &str) -> Option<(String, String)> {
    let endpoint = bridge_endpoint()?;
    match mint_key(profile) {
        Ok(key) => Some((endpoint, key)),
        Err(e) => {
            crate::sidecar::log_line(&format!("[maude] token bridge key not minted: {e}"));
            None
        }
    }
}

/// The whole request decision, socket-free so it is testable: `(status, body)`.
fn respond_for<'a>(
    is_get: bool,
    url: &str,
    presented_keys: impl Iterator<Item = &'a str>,
) -> (u16, String) {
    // Wrong route → 404; wrong method on the route → 405; bad/missing key → 403.
    if url != BRIDGE_PATH {
        return (404, String::new());
    }
    if !is_get {
        return (405, String::new());
    }
    // Exactly one key header. Two headers naming two different profiles would be
    // ambiguous; the sidecar only ever sends one.
    let presented: Vec<&str> = presented_keys.collect();
    let [presented] = presented.as_slice() else {
        return (403, String::new());
    };
    let Some(profile) = profile_for_key(&keys(), presented) else {
        return (403, String::new());
    };
    match get_token(&profile) {
        Some(t) => (200, t),
        // Authenticated bridge request but that profile isn't signed in → 404.
        None => (404, String::new()),
    }
}

fn handle_request(req: tiny_http::Request) {
    let is_get = req.method() == &tiny_http::Method::Get;
    let (status, body) = respond_for(
        is_get,
        req.url(),
        req.headers()
            .iter()
            .filter(|h| h.field.equiv(KEY_HEADER))
            .map(|h| h.value.as_str()),
    );
    let resp = tiny_http::Response::from_string(body).with_status_code(status);
    let _ = req.respond(resp);
}

// ── webview commands (NO token ever crosses to the webview) ──────────────────

/// The profile a webview command acts on: the binding of the CALLING window's
/// project (V2-3.2, contract §5.4 — resolved from the `Webview`, label and
/// origin, never from an argument). The old `Some(profile)` arm is gone: a page
/// could name any profile and read or sign out an account its project is not
/// bound to. Signing in "as another account" is a rebinding (`bind_profile`),
/// not a parameter.
pub fn resolve_profile<R: tauri::Runtime>(
    app: &tauri::AppHandle,
    webview: &tauri::Webview<R>,
) -> Result<String, String> {
    let caller = crate::windows::caller_project(webview, false)?;
    Ok(crate::app_state::profile_for(app, &caller.root))
}

/// Whether the calling window's project profile has a GitHub token stored. Drives the IdentityBar's signed-in state. Returns only a boolean —
/// never the token.
///
/// `async` on purpose: Tauri runs a sync command on the MAIN thread, and a
/// keychain read can park on a macOS access prompt — which froze the whole
/// window (and every main-thread callback, e.g. web_process.rs crash recovery)
/// until the user answered it. Async commands run on the async runtime instead.
#[tauri::command]
pub async fn github_is_signed_in(app: tauri::AppHandle, webview: tauri::Webview) -> bool {
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
    match resolve_profile(&app, &webview) {
        Ok(p) => get_token(&p).is_some(),
        Err(_) => false,
    }
}

/// Sign the calling window's project profile out — delete its keychain token
/// only. Idempotent.
#[tauri::command]
pub async fn github_sign_out(app: tauri::AppHandle, webview: tauri::Webview) -> Result<(), String> {
    delete_token(&resolve_profile(&app, &webview)?)
}

#[cfg(test)]
pub(crate) mod test_store {
    //! In-memory keyring backend for tests. keyring v3's own `mock` builder keeps
    //! the secret INSIDE each `Entry`, so a fresh `entry()` per call (exactly what
    //! production does) could never read back what an earlier one set. This store
    //! is shared across entries, keyed by (service, account), so tests exercise the
    //! real `Entry` path + our account mapping end to end.
    use std::any::Any;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, Once};

    use keyring::credential::{Credential, CredentialApi, CredentialBuilderApi};

    type Store = Arc<Mutex<HashMap<(String, String), Vec<u8>>>>;

    struct Cred {
        store: Store,
        id: (String, String),
    }
    impl CredentialApi for Cred {
        fn set_secret(&self, secret: &[u8]) -> keyring::Result<()> {
            self.store
                .lock()
                .unwrap()
                .insert(self.id.clone(), secret.to_vec());
            Ok(())
        }
        fn get_secret(&self) -> keyring::Result<Vec<u8>> {
            self.store
                .lock()
                .unwrap()
                .get(&self.id)
                .cloned()
                .ok_or(keyring::Error::NoEntry)
        }
        fn delete_credential(&self) -> keyring::Result<()> {
            self.store
                .lock()
                .unwrap()
                .remove(&self.id)
                .map(|_| ())
                .ok_or(keyring::Error::NoEntry)
        }
        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    struct Builder {
        store: Store,
    }
    impl CredentialBuilderApi for Builder {
        fn build(
            &self,
            _target: Option<&str>,
            service: &str,
            user: &str,
        ) -> keyring::Result<Box<Credential>> {
            Ok(Box::new(Cred {
                store: self.store.clone(),
                id: (service.to_string(), user.to_string()),
            }))
        }
        fn as_any(&self) -> &dyn Any {
            self
        }
    }

    static INSTALL: Once = Once::new();
    static STORE: std::sync::OnceLock<Store> = std::sync::OnceLock::new();

    /// Route every `keyring::Entry` in this test binary to the shared memory store.
    pub fn install() -> Store {
        let store = STORE.get_or_init(Store::default).clone();
        let s = store.clone();
        INSTALL.call_once(move || {
            keyring::set_default_credential_builder(Box::new(Builder { store: s }));
        });
        store
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_profiles_round_trip_independently() {
        let store = test_store::install();
        set_token("rt-a", "token-a").unwrap();
        set_token("rt-b", "token-b").unwrap();
        assert_eq!(get_token("rt-a").as_deref(), Some("token-a"));
        assert_eq!(get_token("rt-b").as_deref(), Some("token-b"));
        // The accounts on the keychain are the per-profile ones.
        {
            let s = store.lock().unwrap();
            assert!(s.contains_key(&(KEYCHAIN_SERVICE.into(), "maude-github-token:rt-a".into())));
            assert!(s.contains_key(&(KEYCHAIN_SERVICE.into(), "maude-github-token:rt-b".into())));
        }
        delete_token("rt-a").unwrap();
        assert_eq!(get_token("rt-a"), None);
        assert_eq!(
            get_token("rt-b").as_deref(),
            Some("token-b"),
            "deleting A leaves B"
        );
        delete_token("rt-a").unwrap(); // idempotent
        assert!(
            set_token("../rt", "x").is_err(),
            "an invalid id never reaches the keychain"
        );
    }

    #[test]
    fn default_profile_keeps_the_legacy_keychain_account() {
        let store = test_store::install();
        // The account name, not the token, is what this test pins — the legacy
        // slot is shared by every test using `default`, so only read it here.
        assert_eq!(
            profiles::keychain_account(profiles::DEFAULT_ID).unwrap(),
            "maude-github-token"
        );
        let e = entry(profiles::DEFAULT_ID).unwrap();
        e.set_password("legacy").unwrap();
        assert!(store
            .lock()
            .unwrap()
            .contains_key(&(KEYCHAIN_SERVICE.into(), "maude-github-token".into())));
    }

    #[test]
    fn the_bridge_serves_only_the_keys_profile() {
        test_store::install();
        set_token("br-a", "secret-a").unwrap();
        set_token("br-b", "secret-b").unwrap();
        let ka = mint_key("br-a").unwrap();
        let kb = mint_key("br-b").unwrap();
        assert_ne!(ka, kb);
        assert_eq!(ka.len(), 64);

        let get = |k: &str| respond_for(true, BRIDGE_PATH, std::iter::once(k));
        assert_eq!(get(&ka), (200, "secret-a".to_string()));
        assert_eq!(get(&kb), (200, "secret-b".to_string()));

        // Wrong key (right length, and a prefix of a real one) → 403.
        let mut wrong = ka.clone();
        wrong.replace_range(63..64, if ka.ends_with('0') { "1" } else { "0" });
        assert_eq!(get(&wrong).0, 403);
        assert_eq!(get("").0, 403);
        assert_eq!(respond_for(true, BRIDGE_PATH, std::iter::empty()).0, 403);
        // Two key headers → ambiguous → 403, even when both are valid.
        assert_eq!(
            respond_for(true, BRIDGE_PATH, [ka.as_str(), kb.as_str()].into_iter()).0,
            403
        );
        // Route / method gates come first.
        assert_eq!(
            respond_for(true, "/other", std::iter::once(ka.as_str())).0,
            404
        );
        assert_eq!(
            respond_for(false, BRIDGE_PATH, std::iter::once(ka.as_str())).0,
            405
        );

        // Revoked → 403; the other profile's key keeps working.
        revoke_key(&ka);
        assert_eq!(get(&ka).0, 403);
        assert_eq!(get(&kb), (200, "secret-b".to_string()));
        revoke_key(&ka); // idempotent

        // A valid key for a profile with no token → 404, never another profile's.
        let kc = mint_key("br-c").unwrap();
        assert_eq!(get(&kc), (404, String::new()));
        revoke_key(&kb);
        revoke_key(&kc);
        assert!(mint_key("Bad").is_err());
    }

    #[test]
    fn key_lookup_scans_every_stored_key() {
        // Whichever position the matching key lands in the map's iteration order,
        // it is found — and a non-matching key against many is refused.
        let mut map = HashMap::new();
        let keys: Vec<String> = (0..32).map(|_| random_hex(32).unwrap()).collect();
        for (i, k) in keys.iter().enumerate() {
            map.insert(k.clone(), format!("p{i}"));
        }
        for (i, k) in keys.iter().enumerate() {
            assert_eq!(profile_for_key(&map, k), Some(format!("p{i}")));
        }
        assert_eq!(profile_for_key(&map, &random_hex(32).unwrap()), None);
        assert_eq!(
            profile_for_key(&map, &keys[0][..63]),
            None,
            "a prefix is not a key"
        );
    }

    #[test]
    fn the_live_bridge_answers_over_loopback() {
        use std::io::{Read, Write};
        test_store::install();
        set_token("live-a", "live-secret").unwrap();
        start_token_bridge().unwrap();
        let (endpoint, key) = bridge_env("live-a").unwrap();
        let port: u16 = endpoint
            .trim_start_matches("http://127.0.0.1:")
            .split('/')
            .next()
            .unwrap()
            .parse()
            .unwrap();
        let fetch = |k: &str| {
            let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
            write!(
                s,
                "GET {BRIDGE_PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\n{KEY_HEADER}: {k}\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
            let mut out = String::new();
            s.read_to_string(&mut out).unwrap();
            out
        };
        let ok = fetch(&key);
        assert!(ok.starts_with("HTTP/1.1 200"), "{ok}");
        assert!(ok.ends_with("live-secret"));
        revoke_key(&key);
        assert!(fetch(&key).starts_with("HTTP/1.1 403"));
    }
}
