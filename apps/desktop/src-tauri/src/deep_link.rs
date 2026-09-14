// deep_link.rs — the maude:// protocol handler (Cloud Phase 17 T1/T2).
//
// The scheme registers at INSTALL time from the bundle (tauri.conf.json
// `plugins.deep-link.desktop.schemes` → Info.plist / registry), so a `tauri
// dev` run never receives one — only the bundled .app does. Links arrive two
// ways: macOS delivers through the plugin's on_open_url; Windows/Linux relaunch
// the binary with the URL in argv, which single-instance forwards here.
//
// TRUST POSTURE: a deep link is an UNTRUSTED string — any web page can
// navigate to maude://. The shell therefore only PARKS it (state + event);
// the client surfaces it as an explicit "Connect?" confirmation, and the
// dev-server exchanges the code against its OWN configured Maude Cloud
// address, never against anything the link names. File links may open a
// validated file in the current project; another project requires confirmation.
// File links cannot carry a connect code or change the configured cloud origin.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct PendingDeepLink(pub Mutex<Option<String>>);

/// Park a maude:// URL and tell the webview one arrived. Safe to call before
/// the webview exists — the client also polls `take_pending_deep_link` on
/// boot, which is how a link that launched the app gets consumed.
pub fn accept(app: &AppHandle, url: &str) {
    if !url.starts_with("maude://") {
        return;
    }
    if let Some(state) = app.try_state::<PendingDeepLink>() {
        *state.0.lock().unwrap() = Some(url.to_string());
    }
    let _ = app.emit("maude://deep-link", url.to_string());
}

/// One-shot consume — the client takes the link exactly once, so a re-mounted
/// panel cannot re-ask a question the person already answered.
#[tauri::command]
pub fn take_pending_deep_link(state: tauri::State<'_, PendingDeepLink>) -> Option<String> {
    state.0.lock().unwrap().take()
}
