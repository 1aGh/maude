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
    /// Every webview URL read in the shell goes through `url_of`. A raw `Webview::url()` /
    /// `WebviewWindow::url()` call (it returns a `Result`, so it is always followed by `.ok()`, `?`,
    /// `.map…` or `.unwrap…`) can quit the app on macOS while a tab has no URL yet.
    /// `PageLoadPayload::url()` and `Request::url()` return a plain value and are not webview calls.
    #[test]
    fn no_raw_webview_url_calls() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut offenders = Vec::new();
        let mut stack = vec![src];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).expect("read src") {
                let path = entry.expect("dir entry").path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                if path.extension().and_then(|e| e.to_str()) != Some("rs")
                    || path.file_name().and_then(|n| n.to_str()) == Some("webview_url.rs")
                {
                    continue;
                }
                let text = std::fs::read_to_string(&path).expect("read source");
                for (i, line) in text.lines().enumerate() {
                    let code = line.split("//").next().unwrap_or("");
                    for tail in [
                        ".url().ok()",
                        ".url()?",
                        ".url().map",
                        ".url().unwrap",
                        ".url().expect",
                    ] {
                        if code.contains(tail) {
                            offenders.push(format!(
                                "{}:{}: {}",
                                path.display(),
                                i + 1,
                                line.trim()
                            ));
                        }
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
}
