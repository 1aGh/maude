// oauth.rs — GitHub OAuth **device flow** sign-in (Phase 28 / DDR-108).
//
// Non-technical sign-in with no PAT paste: we POST for a device+user code, open
// the system browser at github.com/login/device, show the user the short code
// (the webview renders the GitHubIdentity device-code modal off the emitted
// `github://device-code` event), and poll GitHub until the user authorizes.
//
// SECURITY — the access token is a SECRET:
//   • It goes ONLY to the OS keychain (`keychain::set_token`) — never to disk,
//     never to `_server.json`/`.design/`, never logged or echoed to the webview.
//   • `github_sign_in` returns only the **login** (a public handle) so the UI can
//     flip to "Connected"; the full profile comes from `/_api/github/identity`,
//     which reads the token via the loopback bridge (keychain.rs).
//
// The `client_id` is NOT a secret (it merely identifies the OAuth App) and is
// compiled in / overridable via `MAUDE_GITHUB_CLIENT_ID`. *** SETUP REQUIRED ***:
// create a GitHub OAuth App under the `1aGh` org with **Device flow enabled** and
// drop its Client ID into `GITHUB_CLIENT_ID` below (see
// `apps/desktop/README-github-oauth.md`). Until then sign-in fails with a clear,
// non-technical message instead of a confusing GitHub error.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::time::sleep;

/// The Maude GitHub OAuth App client id. NOT a secret. Replace the placeholder
/// once the `1aGh` OAuth App exists (or set `MAUDE_GITHUB_CLIENT_ID` at runtime).
const GITHUB_CLIENT_ID: &str = "Ov23liQZXn0jbRdYbKkk";
const CLIENT_ID_PLACEHOLDER: &str = "REPLACE_WITH_MAUDE_OAUTH_APP_CLIENT_ID";

/// Scopes: `repo` (create private/public repos + manage collaborators) and
/// `read:user` (read the signed-in profile for the identity bar).
const OAUTH_SCOPE: &str = "repo read:user";

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const USER_URL: &str = "https://api.github.com/user";
const USER_AGENT: &str = "maude-desktop";

/// Resolve the client id: `MAUDE_GITHUB_CLIENT_ID` env override → compiled-in
/// constant. Returns a friendly error while the placeholder is still in place.
fn client_id() -> Result<String, String> {
    if let Ok(v) = std::env::var("MAUDE_GITHUB_CLIENT_ID") {
        if !v.trim().is_empty() {
            return Ok(v.trim().to_string());
        }
    }
    if GITHUB_CLIENT_ID == CLIENT_ID_PLACEHOLDER {
        return Err(
            "GitHub sign-in isn't set up yet — Maude needs its GitHub app to be configured. \
             (Developer: create the `1aGh` OAuth App with Device flow enabled and set the \
             client id — see apps/desktop/README-github-oauth.md.)"
                .to_string(),
        );
    }
    Ok(GITHUB_CLIENT_ID.to_string())
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    #[serde(default = "default_interval")]
    interval: u64,
    #[serde(default)]
    expires_in: u64,
}
fn default_interval() -> u64 {
    5
}

/// Emitted to the webview so the GitHubIdentity device-code modal can render the
/// code + verification URL. Deliberately carries NO secret (the `device_code` —
/// the pollable secret half — stays in Rust).
#[derive(Serialize, Clone)]
struct DeviceCodeEvent {
    user_code: String,
    verification_uri: String,
    expires_in: u64,
}

#[derive(Deserialize)]
struct AccessTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct GitHubUser {
    login: String,
}

/// POST for a device+user code.
async fn request_device_code(
    client: &reqwest::Client,
    client_id: &str,
) -> Result<DeviceCodeResponse, String> {
    let resp = client
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&[("client_id", client_id), ("scope", OAUTH_SCOPE)])
        .send()
        .await
        .map_err(|_| "Couldn't reach GitHub. Check your internet connection and try again.".to_string())?;
    if !resp.status().is_success() {
        return Err("GitHub couldn't start sign-in. Try again in a moment.".to_string());
    }
    resp.json::<DeviceCodeResponse>()
        .await
        .map_err(|_| "GitHub sent an unexpected response. Try again.".to_string())
}

/// Poll the token endpoint until the user authorizes (or the code expires / is
/// denied). Honors `interval` and the `slow_down` back-off.
async fn poll_for_token(
    client: &reqwest::Client,
    client_id: &str,
    device_code: &str,
    interval: u64,
) -> Result<String, String> {
    let mut wait = interval.max(1);
    loop {
        sleep(Duration::from_secs(wait)).await;
        let resp = client
            .post(ACCESS_TOKEN_URL)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", client_id),
                ("device_code", device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|_| "Lost connection to GitHub while signing in. Try again.".to_string())?;
        let body = resp
            .json::<AccessTokenResponse>()
            .await
            .map_err(|_| "GitHub sent an unexpected response. Try again.".to_string())?;

        if let Some(token) = body.access_token {
            return Ok(token);
        }
        match body.error.as_deref() {
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                wait += 5;
                continue;
            }
            Some("expired_token") => {
                return Err("That code expired — start sign-in again to get a fresh one.".to_string())
            }
            Some("access_denied") => {
                return Err("Sign-in was cancelled. You can try again any time.".to_string())
            }
            other => {
                // Don't surface raw GitHub error codes to a non-technical user.
                eprintln!("[maude] github device-flow error: {:?}", other);
                return Err("Sign-in didn't finish. Please try again.".to_string());
            }
        }
    }
}

/// GET the signed-in user's login (public handle). The token is used once here
/// and never returned to the webview.
async fn fetch_login(client: &reqwest::Client, token: &str) -> Result<String, String> {
    let resp = client
        .get(USER_URL)
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "Signed in, but couldn't load your GitHub profile. Try again.".to_string())?;
    if !resp.status().is_success() {
        return Err("Signed in, but GitHub declined the profile request. Try again.".to_string());
    }
    Ok(resp
        .json::<GitHubUser>()
        .await
        .map_err(|_| "GitHub sent an unexpected profile response.".to_string())?
        .login)
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Couldn't start the sign-in client.".to_string())
}

/// `#[tauri::command]` — the whole device flow, awaited by the webview.
///
/// 1. POST for a device+user code → emit `github://device-code` so the modal shows
///    the code, and open the browser at the verification URL.
/// 2. Poll until authorized (or expired/denied).
/// 3. Store the token in the OS keychain (never on disk) and return the **login**.
#[tauri::command]
pub async fn github_sign_in(app: AppHandle) -> Result<String, String> {
    // E2E (debug builds only): the device flow opens the system browser + polls GitHub —
    // neither DOM-drivable nor deterministic. With MAUDE_E2E_FAKE_GITHUB_LOGIN set, show a
    // deterministic device-code modal, "authorize" after a beat, then report the fake
    // login — no browser, no network, no keychain write. Gated on `debug_assertions`, so
    // it is NEVER in the release `.app`. See the `desktop-e2e` skill.
    #[cfg(debug_assertions)]
    if let Ok(login) = std::env::var("MAUDE_E2E_FAKE_GITHUB_LOGIN") {
        if !login.is_empty() {
            let _ = app.emit(
                "github://device-code",
                DeviceCodeEvent {
                    user_code: "E2E-CODE".to_string(),
                    verification_uri: "https://github.com/login/device".to_string(),
                    expires_in: 900,
                },
            );
            sleep(Duration::from_millis(2500)).await;
            let _ = app.emit("github://signed-in", &login);
            return Ok(login);
        }
    }

    let client_id = client_id()?;
    let client = http_client()?;

    let dc = request_device_code(&client, &client_id).await?;

    // Show the code in the UI (the device-code modal listens for this).
    let _ = app.emit(
        "github://device-code",
        DeviceCodeEvent {
            user_code: dc.user_code.clone(),
            verification_uri: dc.verification_uri.clone(),
            expires_in: dc.expires_in,
        },
    );
    // Best-effort: open the verification page in the system browser.
    if let Err(e) = open::that(&dc.verification_uri) {
        eprintln!("[maude] could not open browser for device flow: {e}");
    }

    let token = poll_for_token(&client, &client_id, &dc.device_code, dc.interval).await?;

    // The token is a secret → keychain only.
    crate::keychain::set_token(&token)
        .map_err(|e| format!("Signed in, but couldn't save it securely: {e}"))?;

    let login = fetch_login(&client, &token).await?;
    let _ = app.emit("github://signed-in", &login);
    Ok(login)
}

/// `#[tauri::command]` — re-open the verification URL (the modal's "Open it again").
#[tauri::command]
pub fn github_open_verification(url: String) -> Result<(), String> {
    // Only ever the GitHub device-verification URL — refuse anything else so this
    // can't be turned into an arbitrary-URL opener from the webview.
    if url != "https://github.com/login/device" {
        return Err("Refusing to open a non-GitHub URL.".to_string());
    }
    open::that(&url).map_err(|e| format!("Couldn't open the browser: {e}"))
}

/// `#[tauri::command]` — open a github.com URL (a PR link, repo page, …) in the OS
/// browser. Host-locked to github.com: the prefix requires the char after the host to
/// be `/`, so `github.com@evil` / `github.com.evil` can't smuggle another host, and we
/// reject whitespace — the untrusted webview can't turn this into an arbitrary-URL
/// opener (DDR-054 posture, same rationale as `github_open_verification`).
#[tauri::command]
pub fn open_github_url(url: String) -> Result<(), String> {
    // Host-locked to github.com (the trailing `/` closes the URL authority — no
    // `@`/label host-smuggle), length-capped, and rejecting bytes that could re-open
    // the authority (`@`, `\`) or that Rust std's Windows launcher has historically
    // mishandled as cmd-metacharacters (CVE-2024-24576). The only caller passes a
    // github.com PR html_url. (F3)
    let ok = url.starts_with("https://github.com/") && url.len() <= 2048 && !has_unsafe_bytes(&url);
    if !ok {
        return Err("Refusing to open a non-GitHub URL.".to_string());
    }
    open::that(&url).map_err(|e| format!("Couldn't open the browser: {e}"))
}

// ── Maude Cloud opener (feature-cloud-connect-ux) ─────────────────────────────
//
// The webview's `window.open` is a silent no-op in WKWebView, so the cloud lane
// (device sign-in, share view, dashboard) had no path to the OS browser at all:
// the person was left holding a code with nowhere to type it. This is that path,
// and it is deliberately NOT a general opener — DDR-054 treats the webview as
// untrusted, so an `opener` plugin (arbitrary URL) is out of the question. Same
// posture as `open_github_url`, one zone wider.

/// Where Maude Cloud lives when nothing overrides it.
const DEFAULT_CLOUD_URL: &str = "https://cloud.maude.sh";
/// The one host whose SUBDOMAINS are in the zone. Compiled in on purpose — see
/// `cloud_url_allowed` arm 2.
const DEFAULT_CLOUD_HOST: &str = "cloud.maude.sh";

/// Bytes that must never reach the OS launcher: anything that could re-open the
/// URL authority (`@`, `\`) and the cmd-metacharacters Rust std's Windows
/// launcher has historically mishandled (CVE-2024-24576).
///
/// `%` is in the set for a reason that is NOT percent-encoding hygiene: the
/// `open` crate launches Windows URLs as `cmd /c start "" <url>` via `raw_arg`,
/// which splices the string into a cmd command line unescaped — and cmd expands
/// `%VAR%` *inside* double quotes, with the result re-entering parsing. Without
/// this, any in-zone host (a self-serve cell, a `view-*` share view) could ask
/// for `https://view-x.cloud.maude.sh/?d=%GITHUB_TOKEN%` and read the expansion
/// out of its own access log. Defender pass 2026-08-04, F1.
///
/// The cost is that a legitimately percent-encoded URL is refused rather than
/// opened. That is the safe direction here: both callers pass unencoded shapes
/// (a PR `html_url`, an `/activate?code=<alnum-dash>`), and a refusal falls back
/// to the link the person can click by hand.
///
/// ORDERING IS LOAD-BEARING: this runs BEFORE the URL parse, which is what stops
/// the WHATWG "strip tab/newline, then parse" trick from smuggling a different
/// host past the checks below.
///
/// Do NOT relax the whitespace rule "for a legitimate space": on Linux `open`
/// shells out to `xdg-open`, a POSIX shell script whose `$BROWSER`-with-`%s` path
/// word-splits and glob-expands the URL. The whitespace rule is the only thing
/// standing between that and argv injection.
fn has_unsafe_bytes(url: &str) -> bool {
    url.contains(|c: char| {
        c.is_whitespace()
            || c.is_control()
            || matches!(c, '@' | '\\' | '&' | '|' | '^' | '<' | '>' | '"' | '\'' | '`' | '%')
    })
}

/// Resolve the Maude Cloud address **per call**, never once at boot.
///
/// The sidecar resolves it per call too (`apps/studio/cloud/endpoints.ts`
/// `cloudUrl()`), and for the same reason: a self-hoster's `MAUDE_CLOUD_URL` can
/// be set after this process's module graph is warm, and a boot-time snapshot
/// would leave Rust locked to a different origin than the one the sidecar is
/// actually talking to — the opener would then refuse the very URL the dialog is
/// showing. Falls back to the default on anything unparseable.
fn cloud_base() -> reqwest::Url {
    if let Ok(raw) = std::env::var("MAUDE_CLOUD_URL") {
        if let Ok(u) = reqwest::Url::parse(raw.trim()) {
            // A bare single-label host (`https://sh`, `https://com`) is a typo, not
            // an address — refuse it rather than let it become an origin the
            // opener honors (attacker pass A3). Loopback + `localhost` are the
            // legitimate no-dot shapes every self-host and e2e stub uses.
            // (IPv4 carries dots; IPv6 arrives bracketed as `[::1]`.)
            let plausible = u
                .host_str()
                .is_some_and(|h| h.contains('.') || h == "localhost" || h.starts_with('['));
            if matches!(u.scheme(), "http" | "https") && plausible {
                return u;
            }
        }
    }
    reqwest::Url::parse(DEFAULT_CLOUD_URL).expect("the default cloud address parses")
}

/// Is `url` inside the configured cloud zone? Returns the PARSED url so the
/// caller launches exactly what was validated rather than the original string —
/// `https:cloud.maude.sh/x` and `https:/cloud.maude.sh/x` both validate, and
/// handing the raw form to the OS is the classic validate-vs-use gap (defender
/// pass 2026-08-04, F2). Split out from the command so the policy is
/// unit-testable without env or a browser.
fn cloud_url_allowed(url: &str, base: &reqwest::Url) -> Option<reqwest::Url> {
    if url.len() > 2048 || has_unsafe_bytes(url) {
        return None;
    }
    let u = reqwest::Url::parse(url).ok()?;
    if !matches!(u.scheme(), "http" | "https") {
        return None;
    }
    // The filter above ran on the CALLER's string, but what gets LAUNCHED is this
    // serialization — and `Url` re-introduces `%`: every non-ASCII byte is
    // percent-encoded, so `…/Ͱ` (U+0370) comes back out as `…/%CD%B0`, and `%CD%`
    // is a cmd dynamic pseudo-variable (the current directory). Validating the
    // input while launching the output is exactly how the F1 class returned;
    // both strings have to pass. (Attacker re-review 2026-08-04, NEW-1.)
    if has_unsafe_bytes(u.as_str()) {
        return None;
    }

    let (host, base_host) = (u.host_str()?, base.host_str()?);

    // Arm 1 — the exact configured origin (scheme + host + port). This is the arm
    // a self-hosted / stubbed control plane matches (`http://127.0.0.1:8788`).
    if u.scheme() == base.scheme()
        && host == base_host
        && u.port_or_known_default() == base.port_or_known_default()
    {
        return Some(u);
    }

    // Arm 2 — a host inside the cloud zone: the per-project cells
    // (`<project>.cloud.maude.sh`) and the share views (`view-*.cloud.maude.sh`).
    //
    // Attacker pass 2026-08-04 (A1) reframed what this zone actually IS: it is
    // not "Maude", it is "Maude and every customer's cell, share view and canvas
    // origin" — hosts OTHER TENANTS control and can serve script from. So this
    // arm is deliberately the narrowest thing that still serves its two callers:
    //
    //   • pinned to the COMPILED-IN host, never to `base`. A poisoned or typo'd
    //     `MAUDE_CLOUD_URL` therefore cannot mint a wildcard (`https://sh` would
    //     otherwise have made `*.sh` the zone — A3); at worst it moves arm 1,
    //     which is one exact origin, not a family.
    //   • ROOT PATH ONLY. Both callers want a host's front door (a share view
    //     home, a cell home). Refusing deep paths is what stops a tenant-hosted
    //     asset — e.g. a stored `.svg` served from a canvas origin — from being
    //     the target, which was the entry hop of the reported chain.
    //   • https, port-less, and the suffix test carries its own dot: a bare
    //     `ends_with` would accept `evilcloud.maude.sh`, and no suffix test at
    //     all would accept `cloud.maude.sh.attacker.com`.
    // File links still open the studio front door, never a tenant asset route.
    // The launcher byte checks above remain in force (encoded URLs fail closed).
    let valid_query = u.query().is_none() || {
        let pairs: Vec<_> = u.query_pairs().collect();
        pairs.len() == 1 && pairs[0].0 == "open"
            && crate::project_resolve::validate_open_param(&pairs[0].1).is_some()
    };
    let at_root = matches!(u.path(), "" | "/") && valid_query && u.fragment().is_none();
    let in_zone = host == DEFAULT_CLOUD_HOST
        || (host.len() > DEFAULT_CLOUD_HOST.len()
            && host.ends_with(DEFAULT_CLOUD_HOST)
            && host.as_bytes()[host.len() - DEFAULT_CLOUD_HOST.len() - 1] == b'.');
    if u.scheme() == "https" && u.port().is_none() && at_root && in_zone {
        return Some(u);
    }
    None
}

/// `#[tauri::command]` — open a Maude Cloud URL (device-activation page, share
/// view, dashboard) in the OS browser. Zone-locked in Rust against the address
/// resolved at call time; the webview's argument never widens what is allowed.
#[tauri::command]
pub async fn open_cloud_url(url: String) -> Result<(), String> {
    // Launch the PARSED url, never the caller's string — see cloud_url_allowed.
    let validated = cloud_url_allowed(&url, &cloud_base())
        .ok_or_else(|| "Refusing to open a URL outside Maude Cloud.".to_string())?;
    // Linux launchers can wait for the browser to exit. A synchronous Tauri
    // command then freezes the main event loop, including the device-code UI.
    // Keep both that wait and its error reporting off the UI/runtime workers.
    tauri::async_runtime::spawn_blocking(move || open::that(validated.as_str()))
        .await
        .map_err(|e| format!("Couldn't launch the browser task: {e}"))?
        .map_err(|e| format!("Couldn't open the browser: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{cloud_base, cloud_url_allowed, DEFAULT_CLOUD_URL};

    fn base(s: &str) -> reqwest::Url {
        reqwest::Url::parse(s).unwrap()
    }

    /// The policy as a boolean, for the many cases that only care about verdict.
    fn allowed(url: &str, b: &reqwest::Url) -> bool {
        cloud_url_allowed(url, b).is_some()
    }

    #[test]
    fn file_links_only_add_a_validated_identity_to_the_cloud_front_door() {
        let b = base(DEFAULT_CLOUD_URL);
        assert!(allowed("https://alligators.cloud.maude.sh/?open=ui/Smoke.tsx", &b));
        for bad in [
            "https://alligators.cloud.maude.sh/?open=../secret",
            "https://alligators.cloud.maude.sh/?open=/etc/passwd",
            "https://alligators.cloud.maude.sh/?open=ui//Smoke.tsx",
            "https://alligators.cloud.maude.sh/?open=",
            "https://alligators.cloud.maude.sh/?open=ui/Smoke.tsx&code=secret",
            "https://alligators.cloud.maude.sh/?open=ui/Smoke.tsx&open=other",
            "https://alligators.cloud.maude.sh/asset.svg?open=ui/Smoke.tsx",
            "https://alligators.cloud.maude.sh/?open=ui/Smoke.tsx#fragment",
            "https://alligators.cloud.maude.sh/?open=ui/%TEMP%.tsx",
            "https://alligators.cloud.maude.sh/?open=ui/A%20B.tsx",
            "https://alligators.cloud.maude.sh/?open=ui/Žába.tsx",
        ] {
            assert!(!allowed(bad, &b), "should refuse {bad}");
        }
    }

    #[test]
    fn accepts_the_cloud_zone_on_the_default_origin() {
        let b = base(DEFAULT_CLOUD_URL);
        for ok in [
            "https://cloud.maude.sh/activate?code=ABCD-1234", // arm 1 — the control plane
            "https://cloud.maude.sh",
            "https://alligators.cloud.maude.sh/", // arm 2 — a cell's front door
            "https://view-alligators.cloud.maude.sh",
        ] {
            assert!(allowed(ok, &b), "should allow {ok}");
        }
    }

    #[test]
    fn the_zone_arm_reaches_front_doors_only_never_tenant_hosted_assets() {
        // `*.cloud.maude.sh` is every customer's cell / share view / canvas origin,
        // i.e. hosts other tenants can serve script from. Allowing a deep path
        // there made a stored asset a valid target, which was the entry hop of the
        // reported chain (attacker pass A1). Front doors only.
        let b = base(DEFAULT_CLOUD_URL);
        for bad in [
            "https://canvas-evil.cloud.maude.sh/stored.svg",
            "https://view-evil.cloud.maude.sh/?next=x",
            "https://evil.cloud.maude.sh/#/x",
        ] {
            assert!(!allowed(bad, &b), "should refuse {bad}");
        }
        // The control plane itself still takes paths — it is arm 1, and it is ours.
        assert!(allowed("https://cloud.maude.sh/activate?code=X", &b));
    }

    #[test]
    fn a_moved_base_cannot_mint_a_wildcard_zone() {
        // Arm 2 is pinned to the compiled-in host, so even a poisoned or typo'd
        // MAUDE_CLOUD_URL buys exactly one origin (arm 1), never a family (A2/A3).
        let b = base("https://evil.tld");
        assert!(allowed("https://evil.tld/x", &b)); // arm 1: the configured origin
        assert!(!allowed("https://sub.evil.tld/", &b)); // no wildcard came with it
        assert!(!allowed("https://sub.evil.tld/asset.svg", &b));
        // The compiled zone stays reachable and does NOT track the base — those are
        // real Maude front doors, and opening one gains a base-poisoner nothing.
        assert!(allowed("https://alligators.cloud.maude.sh/", &b));
    }


    #[test]
    fn refuses_percent_so_the_windows_launcher_cannot_expand_env_vars() {
        // `open` runs `cmd /c start "" <url>` through raw_arg on Windows, and cmd
        // expands %VAR% inside quotes. An in-zone host asking for this would read
        // the expansion out of its own access log (defender pass F1).
        let b = base(DEFAULT_CLOUD_URL);
        for bad in [
            "https://view-attacker.cloud.maude.sh/?d=%GITHUB_TOKEN%",
            "https://cloud.maude.sh/%TEMP%",
            "https://cloud.maude.sh/a%40b",
            // Non-ASCII survives the input filter and comes BACK as `%CD%B0` from
            // Url serialization — `%CD%` is cmd's current-directory pseudo-var.
            "https://cloud.maude.sh/\u{0370}",
            "https://cloud.maude.sh/?x=\u{0370}",
        ] {
            assert!(!allowed(bad, &b), "should refuse {bad}");
        }
    }

    #[test]
    fn the_launched_url_is_the_parsed_one_not_the_callers_string() {
        // Validate-vs-use (defender pass F2): these validate, and what goes to the
        // OS must be the normalized form rather than the odd input spelling.
        let b = base(DEFAULT_CLOUD_URL);
        let got = cloud_url_allowed("https:cloud.maude.sh/activate", &b).expect("validates");
        assert_eq!(got.as_str(), "https://cloud.maude.sh/activate");
    }

    #[test]
    fn refuses_everything_outside_the_zone() {
        let b = base(DEFAULT_CLOUD_URL);
        for bad in [
            // Not the cloud at all.
            "https://evil.example/activate",
            // Suffix-without-dot and zone-as-prefix — the two host-smuggle shapes
            // a naive `ends_with` / `contains` would wave through.
            "https://evilcloud.maude.sh/",
            "https://cloud.maude.sh.attacker.example/",
            // Authority re-opened by userinfo.
            "https://cloud.maude.sh@evil.example/",
            "https://evil.example/?next=cloud.maude.sh",
            // Non-http schemes are never a browser target.
            "file:///etc/passwd",
            "javascript:alert(1)",
            "maude://open/x",
            // Downgrade + odd-port lookalikes must not ride the subdomain arm.
            "http://alligators.cloud.maude.sh/",
            "https://alligators.cloud.maude.sh:8443/",
            // Windows cmd-metacharacter / whitespace shapes (CVE-2024-24576).
            "https://cloud.maude.sh/a&calc",
            "https://cloud.maude.sh/a b",
            "not a url",
        ] {
            assert!(!allowed(bad, &b), "should refuse {bad}");
        }
    }

    #[test]
    fn refuses_an_over_long_url() {
        let b = base(DEFAULT_CLOUD_URL);
        let long = format!("https://cloud.maude.sh/{}", "a".repeat(2100));
        assert!(!allowed(&long, &b));
    }

    #[test]
    fn a_self_hosted_origin_matches_only_on_the_exact_arm() {
        // What every e2e stub and self-hoster looks like: loopback with a port.
        let b = base("http://127.0.0.1:8788");
        assert!(allowed("http://127.0.0.1:8788/activate?code=X", &b));
        // A different port is a different origin; the https zone is not implied.
        assert!(!allowed("http://127.0.0.1:9999/activate", &b));
        assert!(!allowed("https://cloud.maude.sh/activate", &b));
        // The subdomain arm must not fire for a loopback/plaintext base at all —
        // it once implied https://127.0.0.1/ from this very base (defender F3).
        assert!(!allowed("https://127.0.0.1/activate", &b));
        assert!(!allowed("https://x.127.0.0.1/activate", &b));
    }

    #[test]
    fn a_port_bearing_self_host_does_not_imply_its_default_port_or_subdomains() {
        // `https://cloud.internal.corp:8443` is one service; port 443 on the same
        // name is usually a different one, and the subdomains are not its zone.
        let b = base("https://cloud.internal.corp:8443");
        assert!(allowed("https://cloud.internal.corp:8443/activate", &b));
        assert!(!allowed("https://cloud.internal.corp/activate", &b));
        assert!(!allowed("https://cell.cloud.internal.corp/", &b));
    }

    #[test]
    fn the_base_comes_from_the_env_at_call_time() {
        // ONE test owns MAUDE_CLOUD_URL for every env-dependent assertion. Rust
        // runs tests on parallel threads against a shared process environment, so
        // a second test touching this var races this one and fails whichever
        // loses — split them and you get an intermittent red that has nothing to
        // do with the policy under test.
        std::env::remove_var("MAUDE_CLOUD_URL");
        assert_eq!(cloud_base().as_str(), "https://cloud.maude.sh/");

        std::env::set_var("MAUDE_CLOUD_URL", "http://127.0.0.1:4599/");
        assert_eq!(cloud_base().host_str(), Some("127.0.0.1"));
        assert!(allowed("http://127.0.0.1:4599/activate", &cloud_base()));

        // Garbage falls back to the default rather than opening the zone up.
        std::env::set_var("MAUDE_CLOUD_URL", "not a url");
        assert_eq!(cloud_base().as_str(), "https://cloud.maude.sh/");

        // A bare single-label host is a typo, not an address — same fallback, so
        // `https://sh` can never turn `*.sh` into the zone.
        std::env::set_var("MAUDE_CLOUD_URL", "https://sh");
        assert_eq!(cloud_base().as_str(), "https://cloud.maude.sh/");
        assert!(!allowed("https://evil.sh/x", &cloud_base()));

        std::env::remove_var("MAUDE_CLOUD_URL");
    }
}
