//! S8.23 — the native export doors: Save to, Show in Finder, Copy as PNG.
//!
//! Three caller-checked commands, the posture of the S11.16 doors (doors.rs):
//!
//!   - `save_export({jobId, filename, saveTo?})` — writes one finished export job to
//!     this Mac and returns the path it wrote (`None` = the person cancelled the panel).
//!     `saveTo` (ExportSpecV2 §5.3): `ask` (default, and what a v1 caller gets) opens the
//!     native save panel in the remembered folder; `remembered` writes straight into the
//!     project's remembered folder, or asks once when there is none; `downloads` writes
//!     straight into Downloads. Every pick in the panel becomes the project's remembered
//!     folder — kept in app-state (`ProjectEntry.export_folder`), never in the project.
//!   - `reveal_export({path})` — Finder with that file selected, ONLY for a path
//!     `save_export` wrote for this project in this run of the app (`Written`).
//!   - `clipboard_write_png(<raw PNG bytes>)` — the ⇧⌘C fallback where WKWebView refuses
//!     `navigator.clipboard.write` (S8 Q13): size-capped, PNG-shaped, then the general
//!     pasteboard as `public.png`.
//!
//! Who may call: a project tab on its own server's origin (`caller_project`), and only the
//! tab in front (`caller_in_front`). Both run before anything else in each command.
//!
//! WHERE THE BYTES COME FROM (save): Rust fetches them from the calling project's own
//! loopback server (`/_api/export-jobs/download?id=`, origin from the app-owned info file —
//! V2-3.6 M1), never from the page. The page can only name a job its own server produced
//! for its session; it cannot hand Rust arbitrary bytes to put on the disk, and a
//! hundreds-of-MB print PDF never crosses the IPC (RCA
//! issue-desktop-print-pdf-save-as-hang-large-payload). The clipboard is the exception on
//! purpose: the page already holds the PNG for `navigator.clipboard.write` (Q13), the
//! pasteboard is something any page may write from a gesture anyway, and the bytes arrive
//! as a raw IPC body (no JSON array), capped and checked.
//!
//! WRITES without the panel (`remembered` / `downloads`): the name is cleaned (§5.4: no
//! separators, no leading dot, never empty), the file is created with `create_new` (never
//! overwrites, never follows a symlink planted at that name) and numbered ` (2)`, ` (3)`… on
//! a clash. A download that fails removes what it started.
//!
//! REVEAL answers "Maude didn't save that file." for anything it did not write — a path it
//! never saw, a `..` or `.` spelling of one it did, another project's file, a file that has
//! since moved or been swapped for a symlink — so a page cannot use it to probe the disk.

use std::collections::{BTreeMap, VecDeque};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

use crate::{app_state, doors, server_json, sidecar, windows};

/// The one answer `reveal_export` gives for anything it did not write.
pub const NOT_SAVED_HERE: &str = "Maude didn't save that file.";
/// `clipboard_write_png` for anything that is not one whole PNG.
pub const NOT_A_PNG: &str = "That isn't a PNG image.";
/// `clipboard_write_png` past the cap.
pub const TOO_BIG: &str = "That image is too big to copy. Export it instead.";
const COULDNT_WRITE: &str = "Couldn’t write the export.";

/// The most `clipboard_write_png` takes: a 2× 4K artboard is ~30 MB of PNG at worst.
pub const MAX_CLIPBOARD_PNG: usize = 64 * 1024 * 1024;
/// The paths remembered per project for `reveal_export` (oldest forgotten first).
pub const MAX_WRITTEN_PER_PROJECT: usize = 256;
/// §5.4: the most a file name may be before its extension.
pub const MAX_NAME_STEM: usize = 120;
const MAX_NAME_EXT: usize = 16;
/// ` (2)` … ` (999)`, then the save fails rather than loop on a full folder.
const MAX_NUMBERED: usize = 999;

const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
/// The first chunk of every PNG: length 13, type IHDR.
const PNG_IHDR: [u8; 8] = [0, 0, 0, 13, b'I', b'H', b'D', b'R'];
/// The last chunk of every whole PNG: length 0, IEND, its CRC.
const PNG_IEND: [u8; 12] = [0, 0, 0, 0, b'I', b'E', b'N', b'D', 0xAE, 0x42, 0x60, 0x82];

/// §5.4: what a file name loses.
const FORBIDDEN: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

// ── Save to ──────────────────────────────────────────────────────────────────

/// ExportSpecV2 `saveTo`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SaveTo {
    Ask,
    Remembered,
    Downloads,
}

impl SaveTo {
    /// Absent = `ask` (a v1 caller); anything else unknown is refused.
    pub fn parse(raw: Option<&str>) -> Result<SaveTo, String> {
        match raw {
            None | Some("ask") => Ok(SaveTo::Ask),
            Some("remembered") => Ok(SaveTo::Remembered),
            Some("downloads") => Ok(SaveTo::Downloads),
            Some(_) => Err("Unknown place to save to.".to_string()),
        }
    }
}

/// §5.4: the name a file is written under — separators, `: * ? " < > |` and control
/// characters stripped, whitespace collapsed, no leading dot (so never `..` or a hidden
/// file), the stem capped at 120 characters, never empty (→ `export`).
pub fn clean_file_name(raw: &str) -> String {
    let kept: String = raw
        .chars()
        .filter(|c| !c.is_control() && !FORBIDDEN.contains(c))
        .collect();
    let one = kept.split_whitespace().collect::<Vec<_>>().join(" ");
    let one = one.trim_start_matches(['.', ' ']).trim_end_matches(['.', ' ']);
    let (stem, ext) = match one.rfind('.') {
        Some(i) if i > 0 && i + 1 < one.len() => (&one[..i], Some(&one[i + 1..])),
        _ => (one, None),
    };
    let stem: String = stem.chars().take(MAX_NAME_STEM).collect();
    let stem = stem.trim();
    let stem = if stem.is_empty() { "export" } else { stem };
    match ext {
        Some(e) => format!("{stem}.{}", e.chars().take(MAX_NAME_EXT).collect::<String>()),
        None => stem.to_string(),
    }
}

/// `name` the `n`th time it is tried in one folder: `n = 1` is the name itself,
/// then `stem (2).ext`, `stem (3).ext`…
pub fn numbered(name: &str, n: usize) -> String {
    if n <= 1 {
        return name.to_string();
    }
    match name.rfind('.') {
        Some(i) if i > 0 => format!("{} ({n}){}", &name[..i], &name[i..]),
        _ => format!("{name} ({n})"),
    }
}

/// `dir` resolved (every symlink) when it is a folder that exists.
fn usable_dir(dir: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(dir).ok().filter(|d| d.is_dir())
}

/// The one route `save_export` may fetch (V2-3.6 M1): a fixed path on the
/// project's own loopback origin, with only the validated id varying.
const EXPORT_DOWNLOAD_PATH: &str = "/_api/export-jobs/download";

/// Resolve the `/_api/export-jobs/download` URL for `job_id` against the origin
/// the app-owned shell info file names (`sidecar::read_shell_origin`, loopback
/// only — DDR-109). `None` = no running child of ours for that project.
/// Validates the id looks like the `crypto.randomUUID()` the server actually
/// generates (`exporters/jobs.ts`) before it's interpolated into a URL —
/// defense in depth, since this string arrives from the studio client, and a
/// Rust command has no other gate of its own on what it's handed.
pub(crate) fn export_download_url(info_file: Option<&Path>, job_id: &str) -> Result<String, String> {
    let looks_like_id = !job_id.is_empty()
        && job_id.len() <= 64
        && job_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !looks_like_id {
        return Err("Invalid export job id.".to_string());
    }
    let unreachable = || "Couldn't reach the local Maude server to fetch the export.".to_string();
    let origin = sidecar::read_shell_origin(info_file.ok_or_else(unreachable)?).ok_or_else(unreachable)?;
    let url: tauri::Url = format!("{origin}{EXPORT_DOWNLOAD_PATH}?id={job_id}")
        .parse()
        .map_err(|_| unreachable())?;
    // Belt and braces: the assembled URL is loopback and on the one route.
    if !server_json::is_loopback_url(&url) || url.path() != EXPORT_DOWNLOAD_PATH {
        return Err(unreachable());
    }
    Ok(url.to_string())
}

/// The export download client: loopback only, so no proxy (an `HTTP_PROXY` in
/// the login env must never see the request) and no redirects (a 3xx must not
/// carry the fetch off the project's own server — V2-3.6 M1). No timeout: a
/// print PDF can take a while to stream.
fn export_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: std::sync::OnceLock<Option<reqwest::Client>> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .ok()
        })
        .as_ref()
        .ok_or_else(|| "Couldn't start the export download.".to_string())
}

/// Ask the project's server for the job's bytes; a non-2xx (a 3xx too) is an error
/// before any file is touched.
async fn fetch(url: &str) -> Result<reqwest::Response, String> {
    let resp = export_client()?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the local Maude server: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("The export isn't ready to download ({}).", resp.status()));
    }
    Ok(resp)
}

/// Stream `resp` into `file` in chunks, never holding the whole payload — a
/// print-ready PDF can be hundreds of MB.
async fn stream_into(resp: reqwest::Response, mut file: tokio::fs::File) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Couldn't download the export: {e}"))?;
        file
            .write_all(&chunk)
            .await
            .map_err(|e| format!("Couldn’t write the export: {e}"))?;
    }
    file.flush().await.map_err(|e| format!("Couldn’t write the export: {e}"))
}

/// The panel's pick: `dest` is the path the person chose (the panel already asked
/// about replacing a file there), so it is created or truncated.
pub(crate) async fn stream_download_to_file(url: &str, dest: &Path) -> Result<(), String> {
    let resp = fetch(url).await?;
    let file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("Couldn’t write the export: {e}"))?;
    let out = stream_into(resp, file).await;
    if out.is_err() {
        let _ = tokio::fs::remove_file(dest).await;
    }
    out
}

/// No panel: a NEW file named `name` (or `name (2)`, …) in `dir`. `create_new` never
/// replaces a file and never follows a symlink sitting at that name.
pub(crate) async fn download_new_in(url: &str, dir: &Path, name: &str) -> Result<PathBuf, String> {
    let resp = fetch(url).await?;
    for n in 1..=MAX_NUMBERED {
        let dest = dir.join(numbered(name, n));
        match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest)
            .await
        {
            Ok(file) => {
                let out = stream_into(resp, file).await;
                if let Err(e) = out {
                    let _ = tokio::fs::remove_file(&dest).await;
                    return Err(e);
                }
                return Ok(dest);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Couldn’t write the export: {e}")),
        }
    }
    Err(COULDNT_WRITE.to_string())
}

/// The native save panel, seeded with the name and (when there is one) the remembered
/// folder. `None` = cancelled.
async fn ask_where(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
    name: &str,
    start: Option<&Path>,
) -> Result<Option<PathBuf>, String> {
    // E2E (debug builds only): a native save panel can't be DOM-driven, so the
    // harness names the destination via MAUDE_E2E_SAVE_PATH. Never compiled into
    // the release `.app`; the bytes still go through the real fetch-and-stream.
    #[cfg(debug_assertions)]
    if let Ok(p) = std::env::var("MAUDE_E2E_SAVE_PATH") {
        if !p.is_empty() {
            return Ok(Some(PathBuf::from(p)));
        }
    }
    let window = webview.window();
    let mut panel = app.dialog().file().set_parent(&window).set_file_name(name);
    if let Some(dir) = start {
        panel = panel.set_directory(dir);
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    panel.save_file(move |dest| {
        let _ = tx.send(dest.and_then(|f| f.into_path().ok()));
    });
    rx.await.map_err(|_| "Save dialog closed unexpectedly.".to_string())
}

// ── Show in Finder ───────────────────────────────────────────────────────────

/// The files `save_export` wrote in this run of the app, per project (pid), as the
/// canonical paths it returned. Bounded: the oldest are forgotten first.
#[derive(Debug, Default)]
pub struct Written {
    by_project: BTreeMap<String, VecDeque<PathBuf>>,
}

impl Written {
    pub const fn new() -> Self {
        Written { by_project: BTreeMap::new() }
    }

    pub fn record(&mut self, pid: &str, canonical: PathBuf) {
        let q = self.by_project.entry(pid.to_string()).or_default();
        q.retain(|p| p != &canonical);
        q.push_back(canonical);
        while q.len() > MAX_WRITTEN_PER_PROJECT {
            q.pop_front();
        }
    }

    /// The file to reveal: `asked` byte-for-byte as `save_export` returned it for `pid`,
    /// and still that very file (no symlink swapped in, not moved, not a folder).
    pub fn resolve(&self, pid: &str, asked: &str) -> Result<PathBuf, String> {
        let refuse = || NOT_SAVED_HERE.to_string();
        if asked.is_empty() || asked.contains('\0') {
            return Err(refuse());
        }
        let p = Path::new(asked);
        if !p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir)) {
            return Err(refuse());
        }
        let known = self
            .by_project
            .get(pid)
            .and_then(|q| q.iter().find(|w| w.as_os_str() == p.as_os_str()))
            .ok_or_else(refuse)?;
        match std::fs::canonicalize(known) {
            Ok(c) if &c == known && c.is_file() => Ok(c),
            _ => Err(refuse()),
        }
    }
}

static WRITTEN: Mutex<Written> = Mutex::new(Written::new());

fn written() -> std::sync::MutexGuard<'static, Written> {
    WRITTEN.lock().unwrap_or_else(|e| e.into_inner())
}

// ── The remembered folder of a project the registry does not hold ───────────

/// The folders picked in this run for a project the app-state registry does not hold. The
/// `MAUDE_PROJECT_ROOT` launch folder and the welcome project are deliberately never
/// registered (lib.rs boot windows), so `set_export_folder` refuses their pid — and the pick
/// was forgotten at once: `saveTo: 'remembered'` asked again and again. The pick is kept for
/// the rest of this run instead (G2). Registered projects keep it in app-state, as before.
#[derive(Debug, Default)]
pub struct SessionFolders {
    by_project: BTreeMap<String, PathBuf>,
}

impl SessionFolders {
    pub const fn new() -> Self {
        SessionFolders { by_project: BTreeMap::new() }
    }

    /// The remembered folder: the registry's, else this run's pick.
    pub fn recall(&self, pid: &str, persisted: Option<String>) -> Option<PathBuf> {
        persisted.map(PathBuf::from).or_else(|| self.by_project.get(pid).cloned())
    }

    /// A pick: `persisted` is what the registry answered to `set_export_folder`.
    pub fn keep(&mut self, pid: &str, dir: PathBuf, persisted: Result<(), String>) {
        match persisted {
            Ok(()) => {
                self.by_project.remove(pid);
            }
            Err(_) => {
                self.by_project.insert(pid.to_string(), dir);
            }
        }
    }
}

static SESSION_FOLDERS: Mutex<SessionFolders> = Mutex::new(SessionFolders::new());

fn session_folders() -> std::sync::MutexGuard<'static, SessionFolders> {
    SESSION_FOLDERS.lock().unwrap_or_else(|e| e.into_inner())
}

// ── Copy as PNG ──────────────────────────────────────────────────────────────

/// `bytes` when they are one whole PNG under the cap: the signature, IHDR first, IEND last.
pub fn check_png(bytes: &[u8]) -> Result<&[u8], String> {
    if bytes.len() > MAX_CLIPBOARD_PNG {
        return Err(TOO_BIG.to_string());
    }
    let whole = bytes.len() >= PNG_MAGIC.len() + PNG_IHDR.len() + 17 + PNG_IEND.len()
        && bytes.starts_with(&PNG_MAGIC)
        && bytes[PNG_MAGIC.len()..].starts_with(&PNG_IHDR)
        && bytes.ends_with(&PNG_IEND);
    if whole {
        Ok(bytes)
    } else {
        Err(NOT_A_PNG.to_string())
    }
}

/// The general pasteboard, as `public.png` — what a browser's `ClipboardItem('image/png')`
/// writes, so Figma, Keynote, Slack and Preview paste it.
#[cfg(target_os = "macos")]
fn put_png(png: &[u8]) -> Result<(), String> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypePNG};
    use objc2_foundation::NSData;
    let pasteboard = NSPasteboard::generalPasteboard();
    let data = NSData::with_bytes(png);
    pasteboard.clearContents();
    // SAFETY: an AppKit constant string, valid for the life of the process.
    let png_type = unsafe { NSPasteboardTypePNG };
    if pasteboard.setData_forType(Some(&data), png_type) {
        Ok(())
    } else {
        Err("Couldn't copy the image.".to_string())
    }
}

/// WebView2 and WebKitGTK write `ClipboardItem('image/png')` themselves (Q13's fallback is
/// for WKWebView), so the shell has no pasteboard of its own there.
#[cfg(not(target_os = "macos"))]
fn put_png(_png: &[u8]) -> Result<(), String> {
    Err("Copy as PNG isn't available here. Export it instead.".to_string())
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// `save_export({jobId, filename, saveTo?})` → the path written, or `None` when the person
/// cancelled the panel. See the module comment for `saveTo` and where the bytes come from.
#[tauri::command]
pub async fn save_export(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    job_id: String,
    filename: String,
    save_to: Option<String>,
) -> Result<Option<String>, String> {
    // The CALLING window's project (V2-3.2): with two tabs, an export from tab
    // B must download from B's server, not from whichever tab is in front.
    let caller = windows::caller_project(&webview, false)?;
    windows::caller_in_front(&webview)?; // 1g: no save sheet from a hidden tab
    let mode = SaveTo::parse(save_to.as_deref())?;
    // The origin comes from the app-owned info file of THAT project's running
    // child (V2-1.1 decision 8), never the in-project `_server.json` (V2-3.6 M1).
    let info_file = sidecar::shell_info_file(&app, &caller.root);
    let url = export_download_url(info_file.as_deref(), &job_id)?;
    let name = clean_file_name(&filename);
    let remembered = session_folders()
        .recall(&caller.pid, app_state::export_folder_of(&app, &caller.pid))
        .and_then(|d| usable_dir(&d));
    let straight_in = match mode {
        SaveTo::Ask => None,
        SaveTo::Remembered => remembered.clone(),
        SaveTo::Downloads => app.path().download_dir().ok().and_then(|d| usable_dir(&d)),
    };
    let wrote = match straight_in {
        Some(dir) => download_new_in(&url, &dir, &name).await?,
        None => {
            let Some(dest) = ask_where(&app, &webview, &name, remembered.as_deref()).await? else {
                return Ok(None); // cancelled — not an error
            };
            stream_download_to_file(&url, &dest).await?;
            // The folder the person picked is the project's from now on (on this Mac).
            if let Some(dir) = dest.parent().and_then(usable_dir) {
                let persisted = app_state::set_export_folder(&app, &caller.pid, &dir);
                session_folders().keep(&caller.pid, dir, persisted);
            }
            dest
        }
    };
    let canonical = std::fs::canonicalize(&wrote).map_err(|_| COULDNT_WRITE.to_string())?;
    written().record(&caller.pid, canonical.clone());
    Ok(Some(canonical.to_string_lossy().into_owned()))
}

/// `reveal_export({path})` — Finder with `path` selected, when `save_export` wrote it for
/// this project in this run; `NOT_SAVED_HERE` for anything else.
#[tauri::command]
pub async fn reveal_export(webview: tauri::Webview, path: String) -> Result<(), String> {
    let caller = windows::caller_project(&webview, false)?;
    windows::caller_in_front(&webview)?;
    let target = written().resolve(&caller.pid, &path)?;
    // E2E (debug builds only): stop short of popping Finder over the test window.
    #[cfg(debug_assertions)]
    if std::env::var("MAUDE_E2E_NO_REVEAL").is_ok_and(|v| v == "1") {
        return Ok(());
    }
    doors::spawn_or_say(&doors::reveal_argv(&target), "show it in Finder")
}

/// `clipboard_write_png(<Uint8Array>)` — the PNG on the general pasteboard. The page sends
/// the bytes as the raw IPC body (`invoke(cmd, bytes)`); a JSON body is refused.
#[tauri::command]
pub fn clipboard_write_png(webview: tauri::Webview, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    windows::caller_project(&webview, false)?;
    windows::caller_in_front(&webview)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(NOT_A_PNG.to_string());
    };
    put_png(check_png(bytes)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::windows::{check_caller, front_only, Role, WindowBook};

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "maude-export-save-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::canonicalize(d).unwrap()
    }

    /// A smallest whole PNG: signature, IHDR (1×1), IEND.
    fn tiny_png() -> Vec<u8> {
        let mut v = PNG_MAGIC.to_vec();
        v.extend_from_slice(&PNG_IHDR);
        v.extend_from_slice(&[0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1F, 0x15, 0xC4, 0x89]);
        v.extend_from_slice(&PNG_IEND);
        v
    }

    // ── reveal ──

    #[test]
    fn reveal_takes_only_what_it_wrote_for_that_project() {
        let d = scratch("reveal");
        let ours = d.join("Pricing.png");
        let theirs = d.join("other.png");
        std::fs::write(&ours, "x").unwrap();
        std::fs::write(&theirs, "y").unwrap();
        let mut w = Written::new();
        w.record("la", ours.clone());
        assert_eq!(w.resolve("la", ours.to_str().unwrap()), Ok(ours.clone()));
        // A file that exists but was not written by save_export, one that does not
        // exist, and another project's tab asking for ours: one answer for all.
        let refused = Err(NOT_SAVED_HERE.to_string());
        assert_eq!(w.resolve("la", theirs.to_str().unwrap()), refused);
        assert_eq!(w.resolve("la", d.join("nope.png").to_str().unwrap()), refused);
        assert_eq!(w.resolve("lb", ours.to_str().unwrap()), refused);
        assert_eq!(w.resolve("la", "/etc/hosts"), refused);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn reveal_refuses_traversal_and_other_spellings_of_a_written_path() {
        let d = scratch("trav");
        std::fs::create_dir_all(d.join("sub")).unwrap();
        let ours = d.join("out.png");
        std::fs::write(&ours, "x").unwrap();
        let mut w = Written::new();
        w.record("la", ours.clone());
        let base = d.to_str().unwrap();
        for asked in [
            format!("{base}/sub/../out.png"),
            format!("{base}/./out.png"),
            format!("{base}//out.png"),
            "out.png".to_string(),
            "../out.png".to_string(),
            String::new(),
            format!("{base}/out.png\0"),
        ] {
            assert_eq!(w.resolve("la", &asked), Err(NOT_SAVED_HERE.to_string()), "{asked:?}");
        }
        let _ = std::fs::remove_dir_all(d);
    }

    #[cfg(unix)]
    #[test]
    fn reveal_refuses_a_written_file_that_moved_or_became_a_symlink() {
        let d = scratch("swap");
        let ours = d.join("out.png");
        let secret = d.join("secret.txt");
        std::fs::write(&ours, "x").unwrap();
        std::fs::write(&secret, "s").unwrap();
        let mut w = Written::new();
        w.record("la", ours.clone());
        std::fs::remove_file(&ours).unwrap();
        std::os::unix::fs::symlink(&secret, &ours).unwrap();
        assert_eq!(w.resolve("la", ours.to_str().unwrap()), Err(NOT_SAVED_HERE.to_string()));
        std::fs::remove_file(&ours).unwrap();
        assert_eq!(w.resolve("la", ours.to_str().unwrap()), Err(NOT_SAVED_HERE.to_string()));
        std::fs::create_dir(&ours).unwrap(); // a folder at the name is not the file
        assert_eq!(w.resolve("la", ours.to_str().unwrap()), Err(NOT_SAVED_HERE.to_string()));
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn the_written_set_is_bounded_per_project() {
        let mut w = Written::new();
        for i in 0..(MAX_WRITTEN_PER_PROJECT + 10) {
            w.record("la", PathBuf::from(format!("/x/{i}.png")));
        }
        w.record("la", PathBuf::from("/x/20.png")); // re-recording moves it, never duplicates
        let q = &w.by_project["la"];
        assert_eq!(q.len(), MAX_WRITTEN_PER_PROJECT);
        assert!(!q.contains(&PathBuf::from("/x/0.png")), "the oldest are forgotten first");
        assert_eq!(q.back(), Some(&PathBuf::from("/x/20.png")));
        assert_eq!(q.iter().filter(|p| p.as_path() == Path::new("/x/20.png")).count(), 1);
    }

    // ── clipboard ──

    #[test]
    fn clipboard_takes_one_whole_png_under_the_cap() {
        let png = tiny_png();
        assert_eq!(check_png(&png), Ok(png.as_slice()));
        let not = Err(NOT_A_PNG.to_string());
        assert_eq!(check_png(&[]), not);
        assert_eq!(check_png(&PNG_MAGIC), not);
        // JPEG, GIF, an SVG, a PNG cut short (no IEND), a signature with no IHDR.
        assert_eq!(check_png(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, b'J', b'F', b'I', b'F', 0, 1]), not);
        assert_eq!(check_png(b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00;"), not);
        assert_eq!(check_png(b"<svg xmlns='http://www.w3.org/2000/svg'/>"), not);
        assert_eq!(check_png(&png[..png.len() - 4]), not);
        let mut no_ihdr = png.clone();
        no_ihdr[12..16].copy_from_slice(b"tEXt");
        assert_eq!(check_png(&no_ihdr), not);
        // Over the cap: refused before anything else is looked at.
        let mut big = vec![0u8; MAX_CLIPBOARD_PNG + 1];
        big[..png.len() - PNG_IEND.len()].copy_from_slice(&png[..png.len() - PNG_IEND.len()]);
        let n = big.len();
        big[n - PNG_IEND.len()..].copy_from_slice(&PNG_IEND);
        assert_eq!(check_png(&big), Err(TOO_BIG.to_string()));
        assert!(check_png(&big[..MAX_CLIPBOARD_PNG]).is_err()); // and cut: no IEND
    }

    // ── names, folders ──

    #[test]
    fn a_pick_for_a_project_the_registry_does_not_hold_is_remembered_for_the_run() {
        // The boot project (MAUDE_PROJECT_ROOT / welcome) is never registered: the registry refuses it.
        let mut st = app_state::AppState::default();
        let refused = app_state::set_export_folder_in(&mut st, "lboot", Path::new("/d/social"));
        assert!(refused.is_err());
        let mut s = SessionFolders::new();
        assert_eq!(s.recall("lboot", None), None);
        s.keep("lboot", PathBuf::from("/d/social"), refused);
        assert_eq!(s.recall("lboot", None), Some(PathBuf::from("/d/social")));
        // another project does not inherit it
        assert_eq!(s.recall("lother", None), None);
        // a later pick replaces it
        s.keep("lboot", PathBuf::from("/d/print"), Err("no".into()));
        assert_eq!(s.recall("lboot", None), Some(PathBuf::from("/d/print")));
    }

    #[test]
    fn a_registered_project_keeps_its_folder_in_app_state_not_in_the_run() {
        let mut s = SessionFolders::new();
        // the registry took it: nothing is held here, and the registry's word wins
        s.keep("lreg", PathBuf::from("/d/a"), Ok(()));
        assert_eq!(s.recall("lreg", None), None);
        assert_eq!(s.recall("lreg", Some("/d/b".into())), Some(PathBuf::from("/d/b")));
        // a stale run pick never outranks the registry
        s.keep("lreg", PathBuf::from("/d/old"), Err("no".into()));
        assert_eq!(s.recall("lreg", Some("/d/b".into())), Some(PathBuf::from("/d/b")));
    }

    #[test]
    fn a_file_name_never_leaves_its_folder_and_is_never_empty() {
        assert_eq!(clean_file_name("Pricing — Hero@2x.png"), "Pricing — Hero@2x.png");
        assert_eq!(clean_file_name("../../etc/passwd"), "etcpasswd");
        assert_eq!(clean_file_name(".."), "export");
        assert_eq!(clean_file_name(""), "export");
        assert_eq!(clean_file_name("  .hidden.png "), "hidden.png");
        assert_eq!(clean_file_name("a/b\\c:d*e?f\"g<h>i|j.pdf"), "abcdefghij.pdf");
        assert_eq!(clean_file_name("tab\there\nnew\u{0}line.png"), "tabherenewline.png");
        assert_eq!(clean_file_name("a    b.png"), "a b.png");
        let long = format!("{}.png", "x".repeat(300));
        assert_eq!(clean_file_name(&long), format!("{}.png", "x".repeat(MAX_NAME_STEM)));
        assert_eq!(numbered("out.png", 1), "out.png");
        assert_eq!(numbered("out.png", 3), "out (3).png");
        assert_eq!(numbered("README", 2), "README (2)");
        assert_eq!(SaveTo::parse(None), Ok(SaveTo::Ask));
        assert_eq!(SaveTo::parse(Some("remembered")), Ok(SaveTo::Remembered));
        assert_eq!(SaveTo::parse(Some("downloads")), Ok(SaveTo::Downloads));
        assert!(SaveTo::parse(Some("/etc")).is_err());
    }

    #[test]
    fn the_remembered_folder_lives_in_app_state_not_the_project() {
        let mut st = app_state::AppState::default();
        let pid = st.upsert("/Users/x/proj", 1);
        assert!(app_state::set_export_folder_in(&mut st, "nope", Path::new("/d")).is_err());
        app_state::set_export_folder_in(&mut st, &pid, Path::new("/Users/x/Downloads/social")).unwrap();
        let json = serde_json::to_value(&st).unwrap();
        assert_eq!(json["projects"][&pid]["exportFolder"], "/Users/x/Downloads/social");
        // An entry written before S8.23 has none, and one without it writes no key.
        let old: app_state::ProjectEntry = serde_json::from_value(serde_json::json!({"root": "/a"})).unwrap();
        assert_eq!(old.export_folder, None);
        assert!(serde_json::to_value(&old).unwrap().get("exportFolder").is_none());
        let src = include_str!("export_save.rs");
        let code = &src[..src.find("#[cfg(test)]").unwrap()];
        assert!(!code.contains("config.json"), "the folder is never written into the project");
    }

    /// Serve canned HTTP responses on a loopback port, one per connection; returns the port.
    fn serve(responses: Vec<String>) -> u16 {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for response in responses {
                if let Ok((mut s, _)) = listener.accept() {
                    let mut buf = [0u8; 4096];
                    let _ = s.read(&mut buf);
                    let _ = s.write_all(response.as_bytes());
                }
            }
        });
        port
    }

    fn ok_body(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    #[cfg(unix)]
    #[test]
    fn a_save_without_the_panel_never_replaces_a_file_or_follows_a_planted_link() {
        let d = scratch("new-in");
        let folder = d.join("Downloads");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("out.png"), "mine").unwrap();
        let outside = d.join("outside.txt");
        std::fs::write(&outside, "keep").unwrap();
        std::os::unix::fs::symlink(&outside, folder.join("out (2).png")).unwrap();
        let port = serve(vec![ok_body("PNGDATA")]);
        let url = format!("http://127.0.0.1:{port}/_api/export-jobs/download?id=a");
        let got = tauri::async_runtime::block_on(download_new_in(&url, &folder, "out.png")).unwrap();
        assert_eq!(got, folder.join("out (3).png"));
        assert_eq!(std::fs::read(&got).unwrap(), b"PNGDATA");
        assert_eq!(std::fs::read(folder.join("out.png")).unwrap(), b"mine");
        assert_eq!(std::fs::read(&outside).unwrap(), b"keep");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn a_failed_download_leaves_no_file_behind() {
        let d = scratch("fail");
        let port = serve(vec!["HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()]);
        let url = format!("http://127.0.0.1:{port}/_api/export-jobs/download?id=a");
        assert!(tauri::async_runtime::block_on(download_new_in(&url, &d, "out.png")).is_err());
        assert!(!d.join("out.png").exists());
        let _ = std::fs::remove_dir_all(d);
    }

    /// V2-3.6 M1: the download origin is the app-owned info file's, loopback
    /// only, on the one export route — a planted `_server.json` plays no part.
    #[test]
    fn save_export_url_comes_from_the_info_file_and_is_loopback_only() {
        let project = scratch("export-url");
        std::fs::create_dir_all(project.join(".design")).unwrap();
        std::fs::write(
            project.join(".design/_server.json"),
            r#"{"pid":1,"port":443,"url":"https://evil.example"}"#,
        )
        .unwrap();
        let info = project.join("info.json");
        std::fs::write(&info, r#"{"url":"http://localhost:4403","port":4403}"#).unwrap();
        assert_eq!(
            export_download_url(Some(&info), "0b6c-41f2").unwrap(),
            "http://localhost:4403/_api/export-jobs/download?id=0b6c-41f2"
        );
        // No running child of ours ⇒ no download, whatever `_server.json` says.
        assert!(export_download_url(None, "0b6c-41f2").is_err());
        // An info file off loopback is refused too (DDR-109).
        std::fs::write(&info, r#"{"url":"https://evil.example"}"#).unwrap();
        assert!(export_download_url(Some(&info), "0b6c-41f2").is_err());
        // The id cannot reshape the URL.
        std::fs::write(&info, r#"{"url":"http://localhost:4403"}"#).unwrap();
        for bad in ["", "a/../b", "x?y", "x#y", "a&id=b", &"a".repeat(65)] {
            assert!(export_download_url(Some(&info), bad).is_err(), "{bad}");
        }
        let _ = std::fs::remove_dir_all(&project);
    }

    /// V2-3.6 M1: a 3xx from the project's server must not carry the fetch
    /// elsewhere — the redirect target's bytes never reach the chosen file.
    #[test]
    fn save_export_download_refuses_a_redirect() {
        let evil = serve(vec![ok_body("evil")]);
        let first = serve(vec![format!(
            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{evil}/x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        )]);
        let dir = scratch("export-redirect");
        let dest = dir.join("out.pdf");
        let url = format!("http://127.0.0.1:{first}/_api/export-jobs/download?id=a");
        let res = tauri::async_runtime::block_on(stream_download_to_file(&url, &dest));
        assert!(res.is_err(), "a redirect must fail the download, got {res:?}");
        assert!(std::fs::read(&dest).map(|b| b != b"evil").unwrap_or(true));
        let res = tauri::async_runtime::block_on(download_new_in(&url, &dir, "x.pdf"));
        assert!(res.is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ── callers ──

    /// Each command's own sequence — caller (label + origin), then front — on a book: a
    /// label the shell did not create, Home, a tab off its own origin and a tab not in
    /// front are refused before any path or byte is looked at; a foreign project's tab
    /// resolves under ITS pid, so it never reveals A's file.
    #[test]
    fn a_caller_that_is_not_the_project_tab_in_front_is_refused() {
        let d = scratch("caller");
        let ours = d.join("out.png");
        std::fs::write(&ours, "x").unwrap();
        let mut book = WindowBook::default();
        book.insert("p-a", Role::Project { pid: "la".into(), root: "/a".into() }, 0);
        book.set_origin("p-a", "http://localhost:4401");
        book.insert("p-b", Role::Project { pid: "lb".into(), root: "/b".into() }, 1);
        book.set_origin("p-b", "http://localhost:4402");
        book.focus("p-a", 2);
        let mut w = Written::new();
        w.record("la", ours.clone());
        let asked = ours.to_str().unwrap();
        let reveal = |book: &WindowBook, label: &str, at: &str| -> Result<PathBuf, String> {
            let c = check_caller(book, label, Some(&at.parse::<tauri::Url>().unwrap()), false)?;
            front_only(book, label)?;
            w.resolve(&c.pid, asked)
        };
        assert_eq!(reveal(&book, "p-a", "http://localhost:4401/"), Ok(ours.clone()));
        assert!(reveal(&book, "p-zzz", "http://localhost:4401/").is_err());
        assert!(reveal(&book, "home", "http://localhost:4401/").is_err());
        assert!(reveal(&book, "p-a", "http://localhost:4499/").is_err());
        assert!(reveal(&book, "p-a", "http://localhost:4402/").is_err());
        assert_eq!(
            reveal(&book, "p-b", "http://localhost:4402/"),
            Err("Switch to this tab first.".to_string())
        );
        book.focus("p-b", 3);
        assert_eq!(reveal(&book, "p-b", "http://localhost:4402/"), Err(NOT_SAVED_HERE.to_string()));
        let _ = std::fs::remove_dir_all(d);
    }

    /// Source ratchet: each command checks its caller, then the front tab, before it
    /// parses an argument, touches a path, or reads a byte; none runs a shell.
    #[test]
    fn each_command_checks_caller_and_front_first_and_never_runs_a_shell() {
        let src = include_str!("export_save.rs");
        let code = &src[..src.find("#[cfg(test)]").unwrap()];
        for (cmd, first_use) in [
            ("save_export", "SaveTo::parse("),
            ("reveal_export", "written().resolve("),
            ("clipboard_write_png", "request.body()"),
        ] {
            let start = code
                .find(&format!("pub async fn {cmd}("))
                .or_else(|| code.find(&format!("pub fn {cmd}(")))
                .unwrap_or_else(|| panic!("{cmd} not found"));
            let body = &code[start..];
            let body = &body[..body[1..].find("#[tauri::command]").map_or(body.len(), |e| e + 1)];
            let c = body.find("windows::caller_project(&webview, false)?").unwrap();
            let f = body.find("windows::caller_in_front(&webview)?").unwrap();
            let u = body.find(first_use).unwrap_or_else(|| panic!("{cmd}: {first_use}"));
            assert!(c < f && f < u, "{cmd}: caller, then front, then {first_use}");
        }
        for shell in ["\"sh\"", "\"bash\"", "\"zsh\"", "\"-c\"", "cmd.exe", "\"/C\""] {
            assert!(!code.contains(shell), "never a shell ({shell})");
        }
    }
}
