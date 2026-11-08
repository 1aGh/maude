//! The one way the shell reads a webview's URL.
//!
//! `tauri::Webview::url()` is unsafe to call on macOS: wry 0.57 answers it on the main thread with
//! `WKWebView.URL().unwrap()` (`wry::wkwebview::url_from_webview`), and a WKWebView has NO URL until its
//! first navigation commits — or again when that first navigation is cancelled and replaced, which is
//! what a new project tab does when the shell sends it from the splash to its server. A call in that
//! window panics the main thread; tao catches it, stops the run loop, and Maude quits with code 101 and
//! no crash report. The 2 s root watch (`tabs::spawn_root_watch`) reads every tab's URL, so opening a
//! project tab could quit the app (V2-8.3 first-canvas lane: 3 of ~60 runs; a loop of Home sentences
//! hit it within 15 opens).
//!
//! `url_of` reads `WKWebView.URL` itself, on the main thread, and answers `None` when there is none —
//! the same answer every caller already gave to an `Err` from `url()` (a gate refuses, a watcher
//! skips). Off macOS it is `url()`. `tests::no_raw_webview_url_calls` keeps every other `.url()` call
//! on a webview out of `src/`.

use tauri::{Runtime, Url, Webview};

/// Source with comments and string / char literals blanked to spaces (newlines kept), so every index and
/// line number still lines up with the original and no token inside a comment or a string is matched.
#[cfg(test)]
fn blank_comments_and_literals(text: &str) -> Vec<char> {
    let c: Vec<char> = text.chars().collect();
    let mut out = c.clone();
    let blank = |out: &mut Vec<char>, from: usize, to: usize| {
        for ch in out.iter_mut().take(to).skip(from) {
            if *ch != '\n' {
                *ch = ' ';
            }
        }
    };
    let mut i = 0;
    while i < c.len() {
        let next = c.get(i + 1).copied();
        if c[i] == '/' && next == Some('/') {
            let end = c[i..]
                .iter()
                .position(|&x| x == '\n')
                .map_or(c.len(), |p| i + p);
            blank(&mut out, i, end);
            i = end;
        } else if c[i] == '/' && next == Some('*') {
            let mut depth = 1;
            let mut j = i + 2;
            while j < c.len() && depth > 0 {
                if c[j] == '/' && c.get(j + 1) == Some(&'*') {
                    depth += 1;
                    j += 2;
                } else if c[j] == '*' && c.get(j + 1) == Some(&'/') {
                    depth -= 1;
                    j += 2;
                } else {
                    j += 1;
                }
            }
            blank(&mut out, i, j);
            i = j;
        } else if c[i] == '"' || (c[i] == 'r' && matches!(next, Some('"' | '#'))) {
            // a (raw) string: r"..", r#".."# or an ordinary "..", with escapes
            let mut j = i;
            let mut hashes = 0;
            let raw = c[i] == 'r';
            if raw {
                j += 1;
                while c.get(j) == Some(&'#') {
                    hashes += 1;
                    j += 1;
                }
            }
            if c.get(j) != Some(&'"') {
                i += 1;
                continue;
            }
            j += 1;
            while j < c.len() {
                if !raw && c[j] == '\\' {
                    j += 2;
                } else if c[j] == '"' && (0..hashes).all(|k| c.get(j + 1 + k) == Some(&'#')) {
                    j += 1 + hashes;
                    break;
                } else {
                    j += 1;
                }
            }
            blank(&mut out, i, j.min(c.len()));
            i = j;
        } else if c[i] == '\'' {
            // a char literal ('x', '\n', '"'); a lifetime ('a) has no closing quote and is left alone
            let close = if c.get(i + 1) == Some(&'\\') {
                c[i + 2..]
                    .iter()
                    .take(8)
                    .position(|&x| x == '\'')
                    .map(|p| i + 2 + p)
            } else if c.get(i + 2) == Some(&'\'') {
                Some(i + 2)
            } else {
                None
            };
            if let Some(end) = close {
                blank(&mut out, i, end + 1);
                i = end + 1;
            } else {
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    out
}

/// The 1-based line of every raw `<webview>.url()` call in `text` - a call whose `Result` is consumed
/// (`?`, `.ok()`, `.map…`, `.unwrap…`, `.expect`, `if let`, `match`). Whitespace and line breaks are
/// ignored between every token, so a rustfmt-split chain (`.window` / `.url()` / `.map_err(..)`) is
/// found; a plain-value `Request::url()` / `PageLoadPayload::url()` is not (no such tail).
#[cfg(test)]
fn raw_url_calls(text: &str) -> Vec<usize> {
    const TAILS: [&str; 15] = [
        "ok",
        "map",
        "map_err",
        "map_or",
        "map_or_else",
        "unwrap",
        "unwrap_or",
        "unwrap_or_else",
        "unwrap_or_default",
        "expect",
        "is_ok",
        "is_err",
        "and_then",
        "ok_or",
        "ok_or_else",
    ];
    let c = blank_comments_and_literals(text);
    let ident = |ch: char| ch.is_alphanumeric() || ch == '_';
    let skip_ws = |mut i: usize| {
        while i < c.len() && c[i].is_whitespace() {
            i += 1;
        }
        i
    };
    let word_at = |i: usize, w: &str| {
        let end = i + w.chars().count();
        end <= c.len()
            && c[i..end].iter().copied().eq(w.chars())
            && !c.get(end).copied().is_some_and(ident)
    };
    let mut lines = Vec::new();
    for (i, &ch) in c.iter().enumerate() {
        if ch != '.' {
            continue;
        }
        // `.` ws* `url` ws* `(` ws* `)`
        let u = skip_ws(i + 1);
        if !word_at(u, "url") {
            continue;
        }
        let open = skip_ws(u + 3);
        if c.get(open) != Some(&'(') {
            continue;
        }
        let close = skip_ws(open + 1);
        if c.get(close) != Some(&')') {
            continue;
        }
        let after = skip_ws(close + 1);
        let consumed = match c.get(after) {
            Some('?' | '{') => true,
            Some('.') => {
                let name = skip_ws(after + 1);
                TAILS.iter().any(|t| word_at(name, t))
            }
            _ => false,
        };
        if consumed {
            lines.push(1 + c[..u].iter().filter(|&&x| x == '\n').count());
        }
    }
    lines
}

/// How long a caller off the main thread waits for the main thread to read the URL. A caller ON the
/// main thread never waits: Tauri runs `with_webview` inline there.
#[cfg(target_os = "macos")]
const MAIN_THREAD_WAIT: std::time::Duration = std::time::Duration::from_secs(5);

/// The webview's current URL, or `None` while it has none (a fresh or mid-replacement webview), when
/// it is gone, or when the main thread does not answer in time. Never panics.
pub fn url_of<R: Runtime>(webview: &Webview<R>) -> Option<Url> {
    #[cfg(target_os = "macos")]
    {
        let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
        webview
            .with_webview(move |platform| {
                // SAFETY: on macOS `inner()` is the live WKWebView this closure runs against, on the main
                // thread (Tauri's `with_webview` contract); `URL` and `absoluteString` are nullable getters.
                let url = unsafe {
                    let wk: &objc2_web_kit::WKWebView = &*platform.inner().cast();
                    wk.URL()
                        .and_then(|u| u.absoluteString())
                        .map(|s| s.to_string())
                };
                let _ = tx.send(url);
            })
            .ok()?;
        rx.recv_timeout(MAIN_THREAD_WAIT).ok()??.parse().ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        webview.url().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::raw_url_calls;

    /// Directories whose Rust sources must read a webview's URL only through `url_of`: the shell itself
    /// and the vendored WebDriver plugin (it drives the same WKWebViews; V2-3.7).
    const SCANNED: [&str; 2] = ["src", "vendor/tauri-plugin-wdio-webdriver/src"];

    /// Files that never touch a WKWebView. `android.rs` drives the Android WebView through the plugin's
    /// own bridge; the macOS main-thread `unwrap` that `url_of` guards against does not exist there.
    const EXEMPT: [&str; 1] = ["android.rs"];

    /// Every webview URL read in the shell goes through `url_of`. A raw `Webview::url()` /
    /// `WebviewWindow::url()` call (it returns a `Result`, so it is always consumed with `.ok()`, `?`,
    /// `.map…`, `.unwrap…`, `if let` or `match`) can quit the app on macOS while a tab has no URL yet.
    /// The match ignores whitespace and line breaks (rustfmt splits a long chain over lines), and the
    /// vendored WebDriver plugin is scanned too.
    /// `PageLoadPayload::url()` and `Request::url()` return a plain value and are not webview calls.
    #[test]
    fn no_raw_webview_url_calls() {
        let mut offenders = Vec::new();
        for rel in SCANNED {
            let mut stack = vec![std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(rel)];
            while let Some(dir) = stack.pop() {
                for entry in std::fs::read_dir(&dir).expect("read dir") {
                    let path = entry.expect("dir entry").path();
                    if path.is_dir() {
                        stack.push(path);
                        continue;
                    }
                    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                    if path.extension().and_then(|e| e.to_str()) != Some("rs")
                        || name == "webview_url.rs"
                        || EXEMPT.contains(&name)
                    {
                        continue;
                    }
                    let text = std::fs::read_to_string(&path).expect("read source");
                    for line in raw_url_calls(&text) {
                        offenders.push(format!(
                            "{}:{}: {}",
                            path.display(),
                            line,
                            text.lines().nth(line - 1).unwrap_or("").trim()
                        ));
                    }
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "read a webview's URL with webview_url::url_of, not .url():\n{}",
            offenders.join("\n")
        );
    }

    #[test]
    fn scanner_finds_the_one_line_forms() {
        for src in [
            "let u = w.url().ok();",
            "let u = w.url()?;",
            "w.url().map(|u| u.to_string())",
            "w.url().map_err(|e| e.to_string())?",
            "w.url().unwrap()",
            "w.url().expect(\"url\")",
            "if let Ok(url) = self.window().url() {",
            "match w.url() {",
            "w.url().is_ok()",
        ] {
            assert_eq!(raw_url_calls(src), vec![1], "{src}");
        }
    }

    #[test]
    fn scanner_finds_calls_split_over_lines_and_spaces() {
        // rustfmt's chain layout
        let chained = "let url = self\n    .window\n    .url()\n    .map_err(|e| e.to_string())?\n    .to_string();";
        assert_eq!(raw_url_calls(chained), vec![3]);
        // a call split inside its own tokens, and a `?` on the next line
        assert_eq!(
            raw_url_calls("let u = w\n    . url\n    ( )\n    ?;"),
            vec![2]
        );
        assert_eq!(raw_url_calls("let u = w.url (\n)\n    .ok();"), vec![1]);
        assert_eq!(raw_url_calls("let u = w.url()  \n\n  .unwrap();"), vec![1]);
    }

    #[test]
    fn scanner_ignores_plain_value_url_calls_comments_and_strings() {
        for src in [
            "let u = request.url().to_string();",
            "let h = payload.url().host_str();",
            "let u = payload.url();",
            "// w.url().ok() is what url_of replaces",
            "/* w.url().unwrap() */ let x = 1;",
            "let s = \"w.url().ok()\";",
            "let _ = url_of(w);",
        ] {
            assert!(raw_url_calls(src).is_empty(), "{src}");
        }
    }
}
