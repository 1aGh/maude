//! The one way the shell talks to a page (finding 1d, V2-3.7/V2-3.10).
//!
//! Tauri 2.12 delivers an `emit_to(label)` — and every `emit` / `emit_filter`
//! — to each JS listener registered with the `Any` target, in EVERY webview
//! (tauri `event/listener.rs` `emit_js_filter`: `match_any_or_filter`). A
//! project page that called the global `event.listen` heard Home's
//! `shell://state` (every project's pid, root, name, profile, hub, AI counts),
//! `index://changed`, a sibling tab's `github://device-code`, `menu://action`,
//! deep links, navigates … So the shell never emits to a page. Each page hands
//! `shell_subscribe` a `tauri::ipc::Channel` once; the shell keeps it under the
//! page's OWN label (from the IPC webview, never an argument) and `send` writes
//! to that one channel only. A Channel is bound to the webview that created it
//! (its eval runs there, and the large-payload fetch queue is scoped to that
//! webview), so no other page can read it. The strip already works this way
//! (`tabs.rs` `tabs_state`, decision `maude/v2-3.7-t2-strip-state-channel`).
//!
//! No page capability grants `core:event:*` any more, so a page cannot even
//! register a listener; `windows.rs` pins both halves (no emit towards a page in
//! `src/`, no event permission in a page capability).

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;

/// One shell → page message. `kind` keeps the old event names
/// (`shell://state`, `github://device-code`, …).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ShellMessage {
    pub kind: String,
    pub payload: serde_json::Value,
}

/// label → the channel that page handed `shell_subscribe` (a reload replaces it).
#[derive(Default)]
pub struct Bus {
    subscribers: HashMap<String, Channel<ShellMessage>>,
}

impl Bus {
    pub fn subscribe(&mut self, label: &str, ch: Channel<ShellMessage>) {
        self.subscribers.insert(label.to_string(), ch);
    }

    pub fn forget(&mut self, label: &str) {
        self.subscribers.remove(label);
    }

    /// To `label` only. A dead channel (closed tab) is dropped.
    pub fn send(&mut self, label: &str, msg: ShellMessage) -> bool {
        let Some(ch) = self.subscribers.get(label) else {
            return false;
        };
        if ch.send(msg).is_err() {
            self.subscribers.remove(label);
            return false;
        }
        true
    }

    /// The same app-wide message to every page, each through its own channel
    /// (`update-ready` only: nothing in it is about a project).
    pub fn broadcast(&mut self, msg: &ShellMessage) {
        let labels: Vec<String> = self.subscribers.keys().cloned().collect();
        for l in labels {
            self.send(&l, msg.clone());
        }
    }
}

static BUS: Mutex<Option<Bus>> = Mutex::new(None);

fn with_bus<T>(f: impl FnOnce(&mut Bus) -> T) -> T {
    let mut g = BUS.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(Bus::default))
}

fn message<S: Serialize>(kind: &str, payload: S) -> ShellMessage {
    ShellMessage {
        kind: kind.to_string(),
        payload: serde_json::to_value(payload).unwrap_or(serde_json::Value::Null),
    }
}

/// Send `kind` + `payload` to the page with `label` — and to no other.
pub fn send<S: Serialize>(label: &str, kind: &str, payload: S) {
    let msg = message(kind, payload);
    with_bus(|b| b.send(label, msg));
}

/// An app-wide notice, to every subscribed page through its own channel.
pub fn broadcast<S: Serialize>(kind: &str, payload: S) {
    let msg = message(kind, payload);
    with_bus(|b| b.broadcast(&msg));
}

/// A tab closed: drop its channel.
pub fn forget(label: &str) {
    with_bus(|b| b.forget(label));
}

/// `shell_subscribe({onMessage})` — Home (on the Home origin) or a project
/// page (on its own server's origin) hands the channel every later shell
/// message reaches it on. The label is the calling webview's, so a page can
/// only ever subscribe itself.
#[tauri::command]
pub fn shell_subscribe(
    webview: tauri::Webview,
    on_message: Channel<ShellMessage>,
) -> Result<(), String> {
    crate::windows::caller_any(&webview, false)?;
    with_bus(|b| b.subscribe(webview.label(), on_message));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};
    use tauri::ipc::InvokeResponseBody;

    fn recorder() -> (Channel<ShellMessage>, Arc<StdMutex<Vec<String>>>) {
        let got = Arc::new(StdMutex::new(Vec::new()));
        let g = got.clone();
        let ch = Channel::new(move |body: InvokeResponseBody| {
            if let InvokeResponseBody::Json(s) = body {
                g.lock().unwrap().push(s);
            }
            Ok(())
        });
        (ch, got)
    }

    #[test]
    fn a_message_reaches_its_own_page_and_no_other() {
        let mut bus = Bus::default();
        let (home, home_got) = recorder();
        let (p1, p1_got) = recorder();
        bus.subscribe("home", home);
        bus.subscribe("p-1", p1);
        assert!(bus.send(
            "home",
            message("shell://state", serde_json::json!({ "projects": [] }))
        ));
        assert_eq!(home_got.lock().unwrap().len(), 1);
        assert!(home_got.lock().unwrap()[0].contains("shell://state"));
        assert!(p1_got.lock().unwrap().is_empty(), "p-1 heard Home's state");
        // Nobody subscribed under that label: nothing is delivered anywhere.
        assert!(!bus.send("p-2", message("github://device-code", 1)));
        assert!(p1_got.lock().unwrap().is_empty());
        assert_eq!(home_got.lock().unwrap().len(), 1);
    }

    #[test]
    fn a_resubscribe_replaces_and_broadcast_reaches_each_page_once() {
        let mut bus = Bus::default();
        let (old, old_got) = recorder();
        let (new, new_got) = recorder();
        let (home, home_got) = recorder();
        bus.subscribe("p-1", old);
        bus.subscribe("p-1", new); // a reload
        bus.subscribe("home", home);
        bus.broadcast(&message(
            "update-ready",
            serde_json::json!({ "version": "9.9.9" }),
        ));
        assert!(old_got.lock().unwrap().is_empty());
        assert_eq!(new_got.lock().unwrap().len(), 1);
        assert_eq!(home_got.lock().unwrap().len(), 1);
        bus.forget("p-1");
        assert!(!bus.send("p-1", message("menu://action", 1)));
    }

    #[test]
    fn a_dead_channel_is_dropped() {
        let mut bus = Bus::default();
        bus.subscribe("p-1", Channel::new(|_| Err(tauri::Error::WebviewNotFound)));
        assert!(!bus.send("p-1", message("menu://action", 1)));
        assert!(bus.subscribers.is_empty());
    }
}
