// S3.10b — `open_link_external`: the third browser opener (DDR-054 amendment,
// contract apps/studio/client/v2/contracts/S3-links-format.md §6).
//
// A canvas link to a website (`data-cd-link="https://…"`) opens in the system
// browser only after the person clicks **Open** in the shell's own confirmation
// sheet (client/v2/preview/external-link-confirm.jsx). The canvas iframe never
// reaches this command: it posts only `link-follow {elementId, artboardId}`, the
// shell reads the target from the versioned TSX (`GET /_api/links`) and draws the
// sheet. Rust cannot see that click, so it does not trust the argument either —
// it re-checks everything the shell checked, and more:
//
//   • the caller is a project window on its own server's origin (`caller_project`)
//     and is the tab in front (`caller_in_front`) — a background tab never opens
//     a browser over the one the person is looking at;
//   • `http` / `https` only, parsed by a URL parser, never matched by prefix;
//   • the string is ASCII and already in its canonical (WHATWG `href`) form, so
//     what the shell showed in the sheet is byte for byte what launches — no
//     parser differential, no IDN homograph past the punycode the sheet shows;
//   • ≤ 2048 chars, no userinfo, a host that is not loopback, link-local or
//     unspecified (`localhost`, `*.localhost`, 127/8, 0/8, 169.254/16, ::1, ::,
//     fe80::/10 and their IPv4-mapped forms — the decimal and hex IPv4 spellings
//     normalise to these before the check);
//   • the `open_cloud_url` launcher refusal set (`has_unsafe_bytes`, CVE-2024-24576:
//     whitespace, controls, `@ \ & | ^ < > " ' \` %`) on the input AND on the
//     serialization that is launched. A URL with a query `&` or a `%` escape is
//     therefore refused; the sheet then shows the URL with Copy link instead
//     (the named fallback), which opens nothing;
//   • at most one open per second per window.
//
// It is NOT a general opener: anything it refuses, the person can still copy.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The longest URL the opener launches (the link grammar's `LINK_MAX`).
pub const EXTERNAL_URL_MAX: usize = 2048;
/// One open per this interval per window.
pub const OPEN_INTERVAL: Duration = Duration::from_secs(1);

const REFUSED: &str = "Refusing to open that address.";

fn ipv4_blocked(v4: Ipv4Addr) -> bool {
    let [a, b, ..] = v4.octets();
    a == 127 || a == 0 || (a == 169 && b == 254)
}

fn ip_blocked(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => ipv4_blocked(v4),
        IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() {
                return true;
            }
            // fe80::/10 — link-local.
            if (v6.segments()[0] & 0xffc0) == 0xfe80 {
                return true;
            }
            // ::ffff:a.b.c.d — an IPv4 address in IPv6 dress.
            if let Some(v4) = v6.to_ipv4_mapped() {
                return ipv4_blocked(v4);
            }
            v6 == Ipv6Addr::UNSPECIFIED
        }
    }
}

/// Is `host` (as `Url::host_str` prints it) a host this opener refuses?
fn host_blocked(host: &str) -> bool {
    let h = host.trim_end_matches('.').to_ascii_lowercase();
    if h.is_empty() || h == "localhost" || h.ends_with(".localhost") {
        return true;
    }
    let bare = h
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(&h);
    match bare.parse::<IpAddr>() {
        Ok(ip) => ip_blocked(ip),
        Err(_) => false,
    }
}

/// The URL to launch, or None. Pure: the whole policy, unit-tested below.
/// Returns the PARSED url so the command launches exactly what was validated.
pub(crate) fn external_url_allowed(url: &str) -> Option<reqwest::Url> {
    if url.is_empty() || url.len() > EXTERNAL_URL_MAX || !url.is_ascii() {
        return None;
    }
    if crate::oauth::has_unsafe_bytes(url) {
        return None;
    }
    let u = reqwest::Url::parse(url).ok()?;
    if !matches!(u.scheme(), "http" | "https") {
        return None;
    }
    // Canonical form only: the shell sends `new URL(v).href`. A string the parser
    // rewrites (upper-case scheme, `https:host`, a missing `/`, a decimal IP) is
    // not the string the person was shown.
    if u.as_str() != url || crate::oauth::has_unsafe_bytes(u.as_str()) {
        return None;
    }
    if !u.username().is_empty() || u.password().is_some() {
        return None;
    }
    let host = u.host_str()?;
    if host_blocked(host) {
        return None;
    }
    Some(u)
}

/// One open per `OPEN_INTERVAL` per window label. Records the open when allowed.
pub(crate) fn rate_ok(book: &mut HashMap<String, Instant>, label: &str, now: Instant) -> bool {
    if let Some(last) = book.get(label) {
        if now.saturating_duration_since(*last) < OPEN_INTERVAL {
            return false;
        }
    }
    book.insert(label.to_string(), now);
    true
}

static LAST_OPEN: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);

/// `#[tauri::command]` — open a website a canvas links to, after the shell's
/// confirmation. Project windows only (capabilities/default.json), re-checked
/// here; the argument is validated in full (see the header).
#[tauri::command]
pub async fn open_link_external(webview: tauri::Webview, url: String) -> Result<(), String> {
    crate::windows::caller_project(&webview, false)?;
    crate::windows::caller_in_front(&webview)?;
    let validated = external_url_allowed(&url).ok_or_else(|| REFUSED.to_string())?;
    {
        let mut guard = LAST_OPEN.lock().unwrap_or_else(|e| e.into_inner());
        let book = guard.get_or_insert_with(HashMap::new);
        if !rate_ok(book, webview.label(), Instant::now()) {
            return Err("One link at a time.".to_string());
        }
    }
    // Off the UI thread: Linux launchers can wait for the browser (open_cloud_url).
    tauri::async_runtime::spawn_blocking(move || open::that(validated.as_str()))
        .await
        .map_err(|e| format!("Couldn't launch the browser task: {e}"))?
        .map_err(|e| format!("Couldn't open the browser: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(u: &str) -> bool {
        external_url_allowed(u).is_some()
    }

    #[test]
    fn opens_plain_http_and_https_websites() {
        for u in [
            "https://cal.com/studio",
            "https://cal.com/",
            "http://example.com/",
            "https://example.com:8443/a/b",
            "https://docs.example.co.uk/path/to/page#section",
            "https://example.com/?q=1",
            // An IDN host arrives as the punycode the sheet showed.
            "https://xn--mnchen-3ya.de/",
            // A private LAN address is not loopback or link-local (the contract's line).
            "http://192.168.1.10/",
        ] {
            assert!(ok(u), "should open {u}");
        }
        assert_eq!(
            external_url_allowed("https://cal.com/studio")
                .unwrap()
                .as_str(),
            "https://cal.com/studio"
        );
    }

    #[test]
    fn refuses_every_other_scheme() {
        for u in [
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "javascript://example.com/%0aalert(1)",
            "file:///etc/passwd",
            "file://localhost/etc/passwd",
            "data:text/html,<script>alert(1)</script>",
            "data:text/html;base64,PHNjcmlwdD4=",
            "blob:https://example.com/uuid",
            "mailto:a@example.com",
            "tel:+123",
            "ftp://example.com/",
            "ws://example.com/",
            "maude://open?project=x",
            "vbscript:msgbox(1)",
            "about:blank",
            "//example.com/",
            "example.com",
            "",
        ] {
            assert!(!ok(u), "should refuse {u:?}");
        }
    }

    #[test]
    fn refuses_userinfo_and_authority_tricks() {
        for u in [
            "https://user@example.com/",
            "https://user:pw@example.com/",
            "https://example.com@evil.com/",
            "https://example.com\\@evil.com/",
            "https://evil.com\\example.com/",
        ] {
            assert!(!ok(u), "should refuse {u:?}");
        }
    }

    #[test]
    fn refuses_loopback_link_local_and_unspecified_hosts() {
        for u in [
            "http://localhost/",
            "http://localhost:4399/",
            "http://LOCALHOST/",
            "http://localhost./",
            "http://app.localhost/",
            "http://127.0.0.1/",
            "http://127.1.2.3:8080/",
            "http://0.0.0.0/",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]/",
            "http://[::]/",
            "http://[fe80::1]/",
            "http://[::ffff:7f00:1]/",
            "http://[::ffff:a9fe:a9fe]/",
            // Spellings the parser rewrites into a loopback address: refused both as
            // non-canonical and, below, as loopback once normalised.
            "http://2130706433/",
            "http://0x7f.1/",
            "http://0177.0.0.1/",
        ] {
            assert!(!ok(u), "should refuse {u:?}");
        }
        // The normalised forms the parser would print are refused on the host alone.
        for h in [
            "127.0.0.1",
            "[::ffff:7f00:1]",
            "[fe80::1]",
            "localhost.",
            "a.b.localhost",
        ] {
            assert!(host_blocked(h), "host {h} must be blocked");
        }
        assert!(!host_blocked("example.com"));
        assert!(!host_blocked("192.168.1.10"));
    }

    #[test]
    fn refuses_non_ascii_and_non_canonical_strings() {
        for u in [
            // Cyrillic "а" in the host: the sheet would show punycode, so the raw form is a lie.
            "https://exаmple.com/",
            // Fullwidth dot (U+3002) and fullwidth letters normalise to another host.
            "https://example。com/",
            "https://ｅｘａｍｐｌｅ.com/",
            "https://example.com/ü",
            // Right-to-left override and zero-width joiner.
            "https://example.com/\u{202e}fdp.exe",
            "https://exa\u{200d}mple.com/",
            // Not the `href` form the shell sends.
            "HTTPS://example.com/",
            "https://EXAMPLE.com/",
            "https:example.com/",
            "https:/example.com/",
            "https://example.com",
            "https://example.com:443/",
            "https://example.com/a/../b",
        ] {
            assert!(!ok(u), "should refuse {u:?}");
        }
    }

    #[test]
    fn refuses_the_launcher_metacharacter_set() {
        for u in [
            "https://example.com/a b",
            "https://example.com/\ta",
            "https://example.com/\na",
            "https://example.com/%TEMP%",
            "https://example.com/?a=1&b=2",
            "https://example.com/a|b",
            "https://example.com/a^b",
            "https://example.com/a<b>",
            "https://example.com/\"x",
            "https://example.com/'x",
            "https://example.com/`x`",
        ] {
            assert!(!ok(u), "should refuse {u:?}");
        }
    }

    #[test]
    fn refuses_overlong_urls() {
        let base = "https://example.com/";
        let at = format!("{base}{}", "a".repeat(EXTERNAL_URL_MAX - base.len()));
        assert_eq!(at.len(), EXTERNAL_URL_MAX);
        assert!(ok(&at));
        let over = format!("{at}a");
        assert!(!ok(&over));
    }

    #[test]
    fn one_open_per_second_per_window() {
        let mut book = HashMap::new();
        let t0 = Instant::now();
        assert!(rate_ok(&mut book, "p-a", t0));
        assert!(!rate_ok(&mut book, "p-a", t0 + Duration::from_millis(400)));
        assert!(!rate_ok(&mut book, "p-a", t0 + Duration::from_millis(999)));
        // Another window has its own budget.
        assert!(rate_ok(&mut book, "p-b", t0 + Duration::from_millis(400)));
        // A refused attempt does not move the window's clock.
        assert!(rate_ok(&mut book, "p-a", t0 + OPEN_INTERVAL));
        assert!(!rate_ok(
            &mut book,
            "p-a",
            t0 + OPEN_INTERVAL + Duration::from_millis(10)
        ));
    }

    /// What `open::that` runs, per platform. The `&` / `%` refusal above exists
    /// because two of the three shipped launchers are shells: Windows runs
    /// `cmd /c start "" "<url>"` (`%VAR%` expands inside the quotes) and Linux
    /// runs `xdg-open`, a POSIX shell script. Only macOS execs one binary with the
    /// URL as one argv element. Relaxing the refusal set needs this pin to change
    /// first, for every platform the desktop app ships on.
    #[test]
    fn the_launcher_shape_is_pinned() {
        let url = "https://example.com/?a=1&b=%41";
        let cmds = open::commands(url);
        assert!(!cmds.is_empty());
        #[cfg(target_os = "macos")]
        {
            assert_eq!(cmds.len(), 1);
            let c = &cmds[0];
            assert_eq!(c.get_program(), "/usr/bin/open", "no shell on macOS");
            let args: Vec<_> = c.get_args().collect();
            assert_eq!(
                args,
                [std::ffi::OsStr::new(url)],
                "the URL is one argv element"
            );
        }
        #[cfg(windows)]
        assert!(
            cmds.iter().any(|c| c.get_program() == "cmd"),
            "Windows launches through cmd.exe: & and % stay refused"
        );
        // The source launches through `open::that`, which runs exactly these.
        let src = include_str!("external_link.rs");
        let body = &src[src.find("pub async fn open_link_external(").unwrap()..];
        let body = &body[..body.find("#[cfg(test)]").unwrap()];
        assert!(body.contains("open::that(validated.as_str())"));
        assert!(!body.contains("Command::new"), "no hand-rolled launcher");
    }

    #[test]
    fn the_command_checks_its_caller_before_it_reads_the_url() {
        // A source pin next to the windows.rs ratchet: the caller checks come
        // first, the policy second, the rate third, the launch last.
        let src = include_str!("external_link.rs");
        let body = &src[src.find("pub async fn open_link_external(").unwrap()..];
        let at = |needle: &str| {
            body.find(needle)
                .unwrap_or_else(|| panic!("missing {needle}"))
        };
        // Split literals: windows.rs `every_granted_command_checks_its_caller` must find
        // the check in the command's own body, never in this test (S3.10c bounded its
        // scan to the command; the split keeps this pin from ever vouching anyway).
        let project = at(concat!("caller_", "project(&webview, false)?"));
        let front = at(concat!("caller_", "in_front(&webview)?"));
        let policy = at("external_url_allowed(&url)");
        let rate = at("rate_ok(");
        let launch = at("open::that(validated.as_str())");
        assert!(project < front && front < policy && policy < rate && rate < launch);
        // It launches the validated parse, never the caller's string.
        assert!(!body[..body.find("#[cfg(test)]").unwrap()].contains("open::that(&url)"));
    }
}
