//! #122 (122-C) — a paste between two projects on this Mac (contract
//! `apps/studio/client/v2/contracts/122-cross-canvas-clipboard.md` §5.6).
//!
//! The object clipboard keeps the copied TEXT in the project server that read it (edit-ops/clipboard.ts);
//! a tab's shell holds only a handle. Two project tabs have two servers, so a paste in tab B of a copy
//! made in tab A goes through Rust:
//!
//! - `clip_note({id, kind, count, from})` — a copy in a project tab. Rust keeps the LATEST copy on this
//!   Mac `{tab, root, id, kind, count, from, seq}` in memory only (never on disk; a relaunch forgets).
//! - `clip_latest()` → `{seq, mine, kind, count, from, project}` or null. Never the handle of another tab.
//!   `mine` = the latest copy was the caller's own (its shell pastes with its own handle).
//! - `clip_take({seq})` — after the person said Paste on the TARGET tab's own toast. Rust reads the clip
//!   from the source project's server (`GET /_api/shell/clip-export`, `/clip-asset`) and hands it to the
//!   caller's server (`POST /_api/shell/clip-import`), each with that server's per-spawn shell token and at
//!   the address its app-owned info file names. The answer is the handle on the caller's server.
//!
//! Every command accepts only a `p-*` project webview at its own server origin (`caller_project` — label
//! AND origin, never an argument); Home, the strip and cloud-cell tabs answer for nobody. A resting or
//! restarted source is never woken: "That copy is gone; copy it again." (a closed tab's server is reaped,
//! and a reopened one never had the clip, so its export answers 404 → the same words).

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::Manager;

use crate::windows::caller_project;

pub const GONE: &str = "That copy is gone; copy it again.";
pub const CHANGED: &str = "That copy changed on the way; copy it again.";
pub const AGAIN: &str = "Something else was copied since; press ⌘V again.";
pub const NOT_RUNNING: &str = "This project isn't running yet; try again in a moment.";

/// The most clip header JSON Rust will carry (the server's own bound, shell/clip-transfer.ts).
const HEADER_MAX: usize = 16 * 1024 * 1024;
/// The most picture bytes one clip may bring (shell/clip-transfer.ts `CLIP_ASSETS_MAX_BYTES`).
const ASSETS_MAX: u64 = 80 * 1024 * 1024;
const ASSETS_COUNT_MAX: usize = 256;
const MAX_ITEMS: u32 = 50;
/// One carriage: export + every asset + import. Loopback only, so generous.
const CARRY_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClipKind {
    Objects,
    Artboards,
}

impl ClipKind {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "objects" => Some(Self::Objects),
            "artboards" => Some(Self::Artboards),
            _ => None,
        }
    }
    fn as_str(self) -> &'static str {
        match self {
            Self::Objects => "objects",
            Self::Artboards => "artboards",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Latest {
    tab: String,
    root: String,
    id: String,
    kind: ClipKind,
    count: u32,
    from: String,
    seq: u64,
}

/// What a tab hears about the latest copy: never its handle.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LatestView {
    pub seq: u64,
    pub mine: bool,
    pub kind: &'static str,
    pub count: u32,
    pub from: String,
    pub project: String,
}

/// The handle a take answers (the clip as kept on the CALLER's server).
#[derive(Clone, Debug, PartialEq, Serialize, serde::Deserialize)]
pub struct Handle {
    pub id: String,
    pub kind: String,
    pub count: u32,
    pub from: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TakeAnswer {
    pub handle: Handle,
}

/// The latest copy on this Mac. Managed state; live only.
#[derive(Debug, Default)]
pub struct ClipBook {
    inner: Mutex<BookInner>,
}

#[derive(Debug, Default)]
struct BookInner {
    latest: Option<Latest>,
    seq: u64,
}

pub fn is_clip_id(id: &str) -> bool {
    id.len() == 18
        && id.starts_with("c_")
        && id[2..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A control or a bidi override/isolate (a name the toast draws must read as it is).
fn is_odd_char(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{200e}' | '\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
}

/// A designRoot-relative canvas path as a handle names it: no root, no `..`, a `.tsx`/`.jsx` file.
fn is_canvas_rel(from: &str) -> bool {
    !from.is_empty()
        && from.len() <= 512
        && !from.starts_with('/')
        && !from.contains('\\')
        && !from.chars().any(is_odd_char)
        && !from
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..")
        && (from.ends_with(".tsx") || from.ends_with(".jsx"))
}

/// A note's arguments, as a page sent them (the page is the studio, but a planted one must not plant junk).
pub fn check_note(id: &str, kind: &str, count: u32, from: &str) -> Result<ClipKind, String> {
    let kind = ClipKind::parse(kind).ok_or_else(|| "Not a copy.".to_string())?;
    if !is_clip_id(id) || count == 0 || count > MAX_ITEMS || !is_canvas_rel(from) {
        return Err("Not a copy.".to_string());
    }
    Ok(kind)
}

impl BookInner {
    fn note(
        &mut self,
        tab: &str,
        root: &str,
        id: &str,
        kind: ClipKind,
        count: u32,
        from: &str,
    ) -> u64 {
        self.seq += 1;
        self.latest = Some(Latest {
            tab: tab.to_string(),
            root: root.to_string(),
            id: id.to_string(),
            kind,
            count,
            from: from.to_string(),
            seq: self.seq,
        });
        self.seq
    }

    /// The latest copy and whether it is the caller's own.
    fn latest_for(&self, tab: &str) -> Option<(Latest, bool)> {
        self.latest.as_ref().map(|l| (l.clone(), l.tab == tab))
    }

    /// The copy a take in `tab` may carry: the one it was asked about (`seq`), made in ANOTHER tab.
    fn source_for(&self, tab: &str, root: &str, seq: u64) -> Result<Latest, &'static str> {
        let l = self.latest.as_ref().ok_or(GONE)?;
        if l.seq != seq {
            return Err(AGAIN);
        }
        if l.tab == tab || l.root == root {
            // the caller's own copy pastes through its own shell's handle, never through Rust
            return Err(GONE);
        }
        Ok(l.clone())
    }
}

impl ClipBook {
    fn lock(&self) -> std::sync::MutexGuard<'_, BookInner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn book<R: tauri::Runtime>(
    webview: &tauri::Webview<R>,
) -> Result<tauri::State<'_, ClipBook>, String> {
    webview
        .app_handle()
        .try_state::<ClipBook>()
        .ok_or_else(|| "Maude is still starting.".to_string())
}

// ── Commands ────────────────────────────────────────────────────────────────

/// `clip_note({id, kind, count, from})` — a copy in this project tab became the latest on this Mac.
#[tauri::command]
pub fn clip_note(
    webview: tauri::Webview,
    id: String,
    kind: String,
    count: u32,
    from: String,
) -> Result<u64, String> {
    let caller = caller_project(&webview, false)?;
    let kind = check_note(&id, &kind, count, &from)?;
    let book = book(&webview)?;
    let seq = book
        .lock()
        .note(&caller.label, &caller.root, &id, kind, count, &from);
    Ok(seq)
}

/// `clip_latest()` — the latest copy on this Mac, without its handle; null when there is none.
#[tauri::command]
pub fn clip_latest(webview: tauri::Webview) -> Result<Option<LatestView>, String> {
    let caller = caller_project(&webview, false)?;
    let book = book(&webview)?;
    let Some((l, mine)) = book.lock().latest_for(&caller.label) else {
        return Ok(None);
    };
    Ok(Some(LatestView {
        seq: l.seq,
        mine,
        kind: l.kind.as_str(),
        count: l.count,
        from: l.from,
        project: if mine {
            String::new()
        } else {
            crate::windows::project_display_name(&l.root)
        },
    }))
}

/// `clip_take({seq})` — after Paste on this tab's own toast: carry the latest copy (made in another
/// project's tab) to this tab's server. Answers the handle there.
#[tauri::command]
pub async fn clip_take(webview: tauri::Webview, seq: u64) -> Result<TakeAnswer, String> {
    let caller = caller_project(&webview, false)?;
    let app = webview.app_handle().clone();
    let src = book(&webview)?
        .lock()
        .source_for(&caller.label, &caller.root, seq)
        .map_err(str::to_string)?;
    // a resting / stopped source is never woken: its clip went with its server
    let from = crate::sidecar::shell_probe_for(&app, &src.root).ok_or(GONE)?;
    let from_origin = crate::sidecar::read_shell_origin(&from.info_file).ok_or(GONE)?;
    let to = crate::sidecar::shell_probe_for(&app, &caller.root).ok_or(NOT_RUNNING)?;
    let to_origin = crate::sidecar::read_shell_origin(&to.info_file).ok_or(NOT_RUNNING)?;
    let project = crate::windows::project_display_name(&src.root);
    let client = carry_client().ok_or(GONE)?;
    carry(
        client,
        Ends {
            from_origin: &from_origin,
            from_token: &from.token,
            to_origin: &to_origin,
            to_token: &to.token,
        },
        &src.id,
        &project,
    )
    .await
}

// ── The carriage ────────────────────────────────────────────────────────────

/// Loopback only: no proxy (the token must never reach one), no redirects.
fn carry_client() -> Option<&'static reqwest::Client> {
    static CLIENT: std::sync::OnceLock<Option<reqwest::Client>> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .no_proxy()
                .timeout(CARRY_TIMEOUT)
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .ok()
        })
        .as_ref()
}

struct Ends<'a> {
    from_origin: &'a str,
    from_token: &'a str,
    to_origin: &'a str,
    to_token: &'a str,
}

fn url_with(origin: &str, path: &str, query: &[(&str, &str)]) -> Result<tauri::Url, String> {
    let mut u = format!("{origin}{path}")
        .parse::<tauri::Url>()
        .map_err(|_| GONE.to_string())?;
    if !crate::server_json::is_loopback_url(&u) {
        return Err(GONE.to_string());
    }
    u.query_pairs_mut().extend_pairs(query);
    Ok(u)
}

/// The pictures an export lists, checked: designRoot-relative `assets/…`, counted and capped.
pub fn plan_assets(export: &serde_json::Value) -> Result<Vec<(String, u64)>, String> {
    let list = export
        .get("assets")
        .and_then(|a| a.as_array())
        .ok_or_else(|| CHANGED.to_string())?;
    if list.len() > ASSETS_COUNT_MAX {
        return Err(CHANGED.to_string());
    }
    let mut out = Vec::with_capacity(list.len());
    let mut total: u64 = 0;
    for a in list {
        let rel = a.get("rel").and_then(|r| r.as_str()).ok_or(CHANGED)?;
        let size = a.get("size").and_then(|s| s.as_u64()).ok_or(CHANGED)?;
        let name = rel.strip_prefix("assets/").ok_or(CHANGED)?;
        let ok_name = !name.is_empty()
            && name.len() <= 128
            && !name.starts_with('.')
            && name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_');
        if !ok_name {
            return Err(CHANGED.to_string());
        }
        total = total.saturating_add(size);
        if total > ASSETS_MAX {
            return Err("That copy has too many pictures to paste in another project.".to_string());
        }
        out.push((rel.to_string(), size));
    }
    Ok(out)
}

/// Rust's frame for `clip-import`: header length (BE u32), the header JSON, the assets' bytes in order.
pub fn build_frame(
    export: &serde_json::Value,
    project: &str,
    assets: &[(String, u64)],
    blobs: &[Vec<u8>],
) -> Result<Vec<u8>, String> {
    let header = serde_json::json!({
        "clip": export,
        "project": project,
        "assets": assets.iter().map(|(rel, size)| serde_json::json!({ "rel": rel, "size": size })).collect::<Vec<_>>(),
    });
    let header = serde_json::to_vec(&header).map_err(|_| CHANGED.to_string())?;
    if header.len() > HEADER_MAX {
        return Err(CHANGED.to_string());
    }
    let total: usize = blobs.iter().map(Vec::len).sum();
    let mut out = Vec::with_capacity(4 + header.len() + total);
    out.extend_from_slice(&(header.len() as u32).to_be_bytes());
    out.extend_from_slice(&header);
    for b in blobs {
        out.extend_from_slice(b);
    }
    Ok(out)
}

/// The server's words for a refusal (`{ message }`), else `fallback`.
async fn words(resp: reqwest::Response, fallback: &str) -> String {
    let body = read_capped(resp, 64 * 1024).await.unwrap_or_default();
    serde_json::from_slice::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| {
            v.get("message")
                .and_then(|m| m.as_str())
                .map(str::to_string)
        })
        .filter(|m| !m.is_empty() && m.len() <= 400 && !m.chars().any(is_odd_char))
        .unwrap_or_else(|| fallback.to_string())
}

async fn read_capped(mut resp: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|_| GONE.to_string())? {
        if out.len() + chunk.len() > max {
            return Err(CHANGED.to_string());
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

/// Validate the handle the caller's server answered.
pub fn handle_of(body: &[u8]) -> Result<Handle, String> {
    #[derive(serde::Deserialize)]
    struct Answer {
        handle: Handle,
    }
    let h = serde_json::from_slice::<Answer>(body)
        .map_err(|_| GONE.to_string())?
        .handle;
    if !is_clip_id(&h.id)
        || ClipKind::parse(&h.kind).is_none()
        || h.count == 0
        || h.count > MAX_ITEMS
    {
        return Err(GONE.to_string());
    }
    Ok(h)
}

async fn carry(
    client: &reqwest::Client,
    ends: Ends<'_>,
    id: &str,
    project: &str,
) -> Result<TakeAnswer, String> {
    let shell = "X-Maude-Shell";
    let resp = client
        .get(url_with(
            ends.from_origin,
            "/_api/shell/clip-export",
            &[("id", id)],
        )?)
        .header(shell, ends.from_token)
        .send()
        .await
        .map_err(|_| GONE.to_string())?;
    if !resp.status().is_success() {
        return Err(words(resp, GONE).await);
    }
    let export: serde_json::Value = serde_json::from_slice(&read_capped(resp, HEADER_MAX).await?)
        .map_err(|_| CHANGED.to_string())?;
    let assets = plan_assets(&export)?;
    let mut blobs = Vec::with_capacity(assets.len());
    for (rel, size) in &assets {
        let resp = client
            .get(url_with(
                ends.from_origin,
                "/_api/shell/clip-asset",
                &[("id", id), ("rel", rel)],
            )?)
            .header(shell, ends.from_token)
            .send()
            .await
            .map_err(|_| GONE.to_string())?;
        if !resp.status().is_success() {
            return Err(words(resp, GONE).await);
        }
        let bytes = read_capped(resp, *size as usize).await?;
        if bytes.len() as u64 != *size {
            return Err(CHANGED.to_string());
        }
        blobs.push(bytes);
    }
    let frame = build_frame(&export, project, &assets, &blobs)?;
    let resp = client
        .post(url_with(ends.to_origin, "/_api/shell/clip-import", &[])?)
        .header(shell, ends.to_token)
        .header("Content-Type", "application/octet-stream")
        .body(frame)
        .send()
        .await
        .map_err(|_| NOT_RUNNING.to_string())?;
    if !resp.status().is_success() {
        return Err(words(resp, GONE).await);
    }
    let handle = handle_of(&read_capped(resp, 64 * 1024).await?)?;
    Ok(TakeAnswer { handle })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::windows::{check_caller, label_for_pid, pid_for_root, Role, WindowBook};

    const A: &str = "/nonexistent/maude-122c/alpha";
    const B: &str = "/nonexistent/maude-122c/beta";
    const ID: &str = "c_0123456789abcdef";

    #[test]
    fn only_a_project_tab_on_its_own_origin_is_a_caller() {
        // The commands resolve their caller with `caller_project` (label AND origin). Its pure half:
        let mut book = WindowBook::default();
        let a = label_for_pid(&pid_for_root(A));
        book.insert(
            &a,
            Role::Project {
                pid: pid_for_root(A),
                root: A.into(),
            },
            0,
        );
        book.insert("home", Role::Home, 0);
        book.insert(
            "c-cell",
            Role::Cell {
                origin: "https://x.cloud.maude.sh".into(),
                profile: "default".into(),
            },
            0,
        );
        book.set_origin(&a, "http://localhost:4401");
        let page = "http://localhost:4401/".parse::<tauri::Url>().unwrap();
        assert!(check_caller(&book, &a, Some(&page), false).is_ok());
        for label in ["home", "c-cell", "strip", "p-l0000000000000000"] {
            assert!(
                check_caller(&book, label, Some(&page), false).is_err(),
                "{label}"
            );
        }
        // the canvas origin of the same tab answers for nobody
        let canvas = "http://localhost:4402/".parse::<tauri::Url>().unwrap();
        assert!(check_caller(&book, &a, Some(&canvas), false).is_err());
        // and every command calls it first
        let src = include_str!("clip_bridge.rs");
        for sig in [
            "pub fn clip_note(",
            "pub fn clip_latest(",
            "pub async fn clip_take(",
        ] {
            let i = src.find(sig).unwrap();
            let body = &src[i..i + src[i..].find("\n}\n").unwrap()];
            assert!(body.contains("caller_project(&webview, false)?"), "{sig}");
        }
    }

    #[test]
    fn a_note_checks_its_arguments() {
        assert_eq!(
            check_note(ID, "objects", 2, "ui/Home.tsx"),
            Ok(ClipKind::Objects)
        );
        assert_eq!(
            check_note(ID, "artboards", 1, "a/b.jsx"),
            Ok(ClipKind::Artboards)
        );
        for (id, kind, count, from) in [
            ("c_0123", "objects", 1, "ui/Home.tsx"),
            ("c_0123456789ABCDEF", "objects", 1, "ui/Home.tsx"),
            (ID, "files", 1, "ui/Home.tsx"),
            (ID, "objects", 0, "ui/Home.tsx"),
            (ID, "objects", 51, "ui/Home.tsx"),
            (ID, "objects", 1, "/etc/passwd.tsx"),
            (ID, "objects", 1, "../x/Home.tsx"),
            (ID, "objects", 1, "ui/Home.json"),
            (ID, "objects", 1, "ui/\u{202e}Home.tsx"),
        ] {
            assert!(
                check_note(id, kind, count, from).is_err(),
                "{id} {kind} {count} {from}"
            );
        }
    }

    #[test]
    fn the_latest_copy_wins_and_mine_says_whose_it_is() {
        let mut b = BookInner::default();
        assert!(b.latest_for("p-a").is_none());
        let s1 = b.note("p-a", A, ID, ClipKind::Objects, 2, "ui/Home.tsx");
        let (l, mine) = b.latest_for("p-a").unwrap();
        assert!(mine);
        assert_eq!((l.seq, l.count, l.from.as_str()), (s1, 2, "ui/Home.tsx"));
        assert!(!b.latest_for("p-b").unwrap().1);
        let s2 = b.note(
            "p-b",
            B,
            "c_00000000000000ff",
            ClipKind::Artboards,
            1,
            "ui/About.tsx",
        );
        assert!(s2 > s1);
        assert!(b.latest_for("p-b").unwrap().1);
        assert!(!b.latest_for("p-a").unwrap().1);
    }

    #[test]
    fn a_take_carries_only_the_copy_it_was_asked_about_from_another_tab() {
        let mut b = BookInner::default();
        assert_eq!(b.source_for("p-b", B, 1), Err(GONE));
        let s = b.note("p-a", A, ID, ClipKind::Objects, 2, "ui/Home.tsx");
        // the toast asked about seq s; a newer copy since → press ⌘V again, nothing carried
        assert_eq!(b.source_for("p-b", B, s + 1), Err(AGAIN));
        assert_eq!(b.source_for("p-b", B, s).unwrap().id, ID);
        // the copying tab (or another tab on the same root) never takes through Rust
        assert_eq!(b.source_for("p-a", A, s), Err(GONE));
        assert_eq!(b.source_for("p-x", A, s), Err(GONE));
    }

    #[test]
    fn the_view_never_names_the_handle() {
        let view = LatestView {
            seq: 1,
            mine: false,
            kind: "objects",
            count: 1,
            from: "ui/Home.tsx".into(),
            project: "Acme".into(),
        };
        let json = serde_json::to_value(&view).unwrap();
        let keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["count", "from", "kind", "mine", "project", "seq"]);
    }

    #[test]
    fn nothing_is_written_to_disk() {
        let src = include_str!("clip_bridge.rs");
        let code = &src[..src.find("#[cfg(test)]").unwrap()];
        for banned in [
            "std::fs",
            "File::create",
            "tokio::fs",
            "OpenOptions",
            "write_all(",
        ] {
            assert!(!code.contains(banned), "{banned}");
        }
    }

    #[test]
    fn the_assets_an_export_lists_are_checked() {
        let ok = serde_json::json!({ "assets": [{ "rel": "assets/0a1b2c3d.png", "size": 12 }] });
        assert_eq!(
            plan_assets(&ok).unwrap(),
            vec![("assets/0a1b2c3d.png".to_string(), 12)]
        );
        for bad in [
            serde_json::json!({}),
            serde_json::json!({ "assets": [{ "rel": "../x.png", "size": 1 }] }),
            serde_json::json!({ "assets": [{ "rel": "assets/../../x.png", "size": 1 }] }),
            serde_json::json!({ "assets": [{ "rel": "assets/sub/x.png", "size": 1 }] }),
            serde_json::json!({ "assets": [{ "rel": "assets/.hidden", "size": 1 }] }),
            serde_json::json!({ "assets": [{ "rel": "assets/a.png", "size": -1 }] }),
            serde_json::json!({ "assets": [{ "rel": "assets/a.png", "size": ASSETS_MAX + 1 }] }),
        ] {
            assert!(plan_assets(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_frame_is_length_header_then_bytes_in_order() {
        let export = serde_json::json!({ "kind": "objects" });
        let assets = vec![
            ("assets/a.png".to_string(), 2),
            ("assets/b.png".to_string(), 1),
        ];
        let f = build_frame(&export, "Acme", &assets, &[vec![1, 2], vec![3]]).unwrap();
        let n = u32::from_be_bytes([f[0], f[1], f[2], f[3]]) as usize;
        let header: serde_json::Value = serde_json::from_slice(&f[4..4 + n]).unwrap();
        assert_eq!(header["project"], "Acme");
        assert_eq!(header["clip"], export);
        assert_eq!(header["assets"][1]["rel"], "assets/b.png");
        assert_eq!(&f[4 + n..], &[1, 2, 3]);
    }

    #[test]
    fn the_answered_handle_is_checked() {
        let good = br#"{"handle":{"id":"c_0123456789abcdef","kind":"artboards","count":1,"from":"ui/A.tsx"}}"#;
        assert_eq!(handle_of(good).unwrap().id, ID);
        for bad in [
            &br#"{"handle":{"id":"../x","kind":"artboards","count":1,"from":"ui/A.tsx"}}"#[..],
            &br#"{"handle":{"id":"c_0123456789abcdef","kind":"x","count":1,"from":"ui/A.tsx"}}"#[..],
            &br#"{"nope":1}"#[..],
        ] {
            assert!(handle_of(bad).is_err());
        }
    }

    #[test]
    fn urls_stay_on_loopback() {
        assert!(url_with(
            "http://localhost:4401",
            "/_api/shell/clip-export",
            &[("id", ID)]
        )
        .is_ok());
        assert!(url_with("https://evil.example", "/_api/shell/clip-export", &[]).is_err());
        let u = url_with(
            "http://127.0.0.1:4401",
            "/_api/shell/clip-asset",
            &[("rel", "assets/a b&c.png")],
        )
        .unwrap();
        assert_eq!(u.query(), Some("rel=assets%2Fa+b%26c.png"));
    }
}
