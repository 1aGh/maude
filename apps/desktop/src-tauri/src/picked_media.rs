//! Files the user picked in the native "Open file" dialog, read in slices.
//!
//! `pick_media_file(s)` used to return the whole file as `Vec<u8>`, which serde
//! sends over IPC as a JSON array of numbers — roughly four bytes of JSON per
//! byte of media, all held in the webview at once. Fine for a screenshot, not
//! for the 512 MB clips chunked upload (issue #126) accepts. Now the dialog
//! registers the path here under an unguessable token, and the page reads
//! `[offset, offset+len)` slices as raw `ipc::Response` bytes (an ArrayBuffer,
//! no JSON), one chunk at a time. The path itself never reaches the page.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use tauri::State;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::Semaphore;

/// One slice is at most this big — the studio's chunk size is 16 MiB.
const MAX_SLICE_BYTES: u64 = 64 * 1024 * 1024;
/// Registered picks kept at once; the oldest is forgotten past this, so a page
/// that never releases cannot grow the registry without bound.
const MAX_PICKS: usize = 64;
/// A pick unused this long is forgotten — a token is a read grant on a user
/// file, and it should not outlive the upload it was made for.
const PICK_IDLE_TTL: Duration = Duration::from_secs(30 * 60);
/// Slices read at once. The uploader is sequential; this bounds memory if a
/// page ever fires many reads in parallel (each holds up to MAX_SLICE_BYTES).
const MAX_CONCURRENT_READS: usize = 2;

struct Pick {
    token: String,
    path: PathBuf,
    size: u64,
    modified: Option<SystemTime>,
    last_used: Instant,
}

pub struct PickedMediaRegistry {
    picks: Mutex<VecDeque<Pick>>,
    reads: Semaphore,
}

impl Default for PickedMediaRegistry {
    fn default() -> Self {
        Self {
            picks: Mutex::new(VecDeque::new()),
            reads: Semaphore::new(MAX_CONCURRENT_READS),
        }
    }
}

#[derive(serde::Serialize)]
pub struct PickedMediaRef {
    token: String,
    name: String,
    size: u64,
}

fn new_token() -> Result<String, String> {
    let mut buf = [0u8; 16];
    getrandom::getrandom(&mut buf).map_err(|e| format!("secure RNG unavailable: {e}"))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

impl PickedMediaRegistry {
    /// Register a picked path; the returned ref is all the page ever sees.
    pub fn register(&self, path: PathBuf) -> Result<PickedMediaRef, String> {
        let meta = std::fs::metadata(&path).map_err(|e| format!("Couldn’t read the file: {e}"))?;
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("upload")
            .to_string();
        let token = new_token()?;
        let mut picks = self
            .picks
            .lock()
            .map_err(|_| "picked-media registry poisoned")?;
        let now = Instant::now();
        picks.retain(|p| now.duration_since(p.last_used) < PICK_IDLE_TTL);
        while picks.len() >= MAX_PICKS {
            picks.pop_front();
        }
        picks.push_back(Pick {
            token: token.clone(),
            path,
            size: meta.len(),
            modified: meta.modified().ok(),
            last_used: now,
        });
        Ok(PickedMediaRef {
            token,
            name,
            size: meta.len(),
        })
    }

    fn lookup(&self, token: &str) -> Option<(PathBuf, u64, Option<SystemTime>)> {
        let mut picks = self.picks.lock().ok()?;
        let now = Instant::now();
        picks.retain(|p| now.duration_since(p.last_used) < PICK_IDLE_TTL);
        let pick = picks.iter_mut().find(|p| p.token == token)?;
        pick.last_used = now;
        Some((pick.path.clone(), pick.size, pick.modified))
    }
}

/// Read one slice of a picked file. Returns raw bytes (an ArrayBuffer in JS).
#[tauri::command]
pub async fn read_picked_media(
    registry: State<'_, PickedMediaRegistry>,
    token: String,
    offset: u64,
    len: u64,
) -> Result<tauri::ipc::Response, String> {
    let (path, size, modified) = registry
        .lookup(&token)
        .ok_or_else(|| "That file is no longer available — pick it again.".to_string())?;
    if len > MAX_SLICE_BYTES {
        return Err(format!("slice larger than {MAX_SLICE_BYTES} bytes"));
    }
    if offset > size {
        return Err("slice starts past the end of the file".to_string());
    }
    let want = len.min(size - offset);
    let _permit = registry
        .reads
        .acquire()
        .await
        .map_err(|_| "picked-media reader closed".to_string())?;
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| format!("Couldn’t read the file: {e}"))?;
    // The file changed since it was picked — refuse rather than upload bytes
    // that no longer match what the user chose (or the size the upload declared).
    let meta = file
        .metadata()
        .await
        .map_err(|e| format!("Couldn’t read the file: {e}"))?;
    if meta.len() != size || meta.modified().ok() != modified {
        return Err("The file changed after it was picked — pick it again.".to_string());
    }
    file.seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(|e| format!("Couldn’t read the file: {e}"))?;
    let mut buf = vec![0u8; want as usize];
    file.read_exact(&mut buf)
        .await
        .map_err(|e| format!("Couldn’t read the file: {e}"))?;
    Ok(tauri::ipc::Response::new(buf))
}

/// Forget a pick once its upload is done (or abandoned).
#[tauri::command]
pub fn release_picked_media(registry: State<'_, PickedMediaRegistry>, token: String) {
    if let Ok(mut picks) = registry.picks.lock() {
        picks.retain(|p| p.token != token);
    }
}
