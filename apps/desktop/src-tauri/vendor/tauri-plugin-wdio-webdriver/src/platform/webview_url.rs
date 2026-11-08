//! A webview's URL, read without the macOS main-thread panic (Maude fork; see `VENDORED.md`).
//!
//! `tauri::Webview::url()` answers on the main thread with `WKWebView.URL().unwrap()` (wry 0.57), and a
//! `WKWebView` has no URL until its first navigation commits, or again while that navigation is being
//! replaced. A call in that window panics the main thread and quits the app. The shell has the same
//! helper (`src/webview_url.rs` in `maude-desktop`, which also holds the test that keeps every other
//! `.url()` call out of both trees); this copy exists because a vendored crate cannot reach the shell's.
//!
//! `url_of` reads `WKWebView.URL` itself, on the main thread, and answers `None` when there is none.
//! Off macOS it is `url()`.

use tauri::{Runtime, Url, Webview};

/// How long a caller off the main thread waits for the main thread to read the URL.
#[cfg(target_os = "macos")]
const MAIN_THREAD_WAIT: std::time::Duration = std::time::Duration::from_secs(5);

/// The webview's current URL, or `None` while it has none, when it is gone, or when the main thread does
/// not answer in time. Never panics.
pub(crate) fn url_of<R: Runtime>(webview: &Webview<R>) -> Option<Url> {
    #[cfg(target_os = "macos")]
    {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;

        let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
        webview
            .with_webview(move |platform| {
                // SAFETY: on macOS `inner()` is the live WKWebView this closure runs against, on the main
                // thread (Tauri's `with_webview` contract); `URL` and `absoluteString` are nullable getters.
                let url = unsafe {
                    let wk: *mut AnyObject = platform.inner().cast();
                    let url: *mut AnyObject = msg_send![wk, URL];
                    if url.is_null() {
                        None
                    } else {
                        let abs: *mut AnyObject = msg_send![url, absoluteString];
                        if abs.is_null() {
                            None
                        } else {
                            Some((*abs.cast::<objc2_foundation::NSString>()).to_string())
                        }
                    }
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
