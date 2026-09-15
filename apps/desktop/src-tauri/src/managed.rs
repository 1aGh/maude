//! Managed projects — plan T21 (feature-reliable-project-multiplayer).
//!
//! A designer who was added to a project opens it without choosing a folder:
//! the app keeps the project's own local copy under its data directory, keyed
//! by (server, project id), and switches to it. The studio prepares the
//! credential and describes the project first (`/_api/projects/prepare`); this
//! module only creates/updates the copy's `.design/config.json` from that
//! description and remembers it.
//!
//! SECURITY: the webview chooses NO path. The directory is derived here from a
//! validated server URL and project id; the name is display text only; canvas
//! groups are validated like the studio's own group rule. An existing copy's
//! config keeps everything the project wrote into it — only `linkedHub`,
//! `managed` and missing groups are (re)stated.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const MAX_GROUPS: usize = 32;

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
pub struct ManagedProject {
    pub key: String,
    pub server_url: String,
    pub project_id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub last_opened: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct ManagedIndex {
    #[serde(default)]
    projects: Vec<ManagedProject>,
}

/// Validate a server URL: https anywhere, http only for loopback (DDR-054 §2e).
pub fn validate_server_url(raw: &str) -> Result<String, String> {
    let url = tauri::Url::parse(raw.trim()).map_err(|_| "That server address isn't valid.".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("A server address must not contain credentials.".to_string());
    }
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    if host.is_empty() {
        return Err("That server address has no host.".to_string());
    }
    let loopback = host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1";
    match url.scheme() {
        "https" => {}
        "http" if loopback => {}
        _ => return Err("The server must use https:// (http:// only on this computer).".to_string()),
    }
    let mut s = format!("{}://{}", url.scheme(), host);
    if let Some(port) = url.port() {
        s.push_str(&format!(":{port}"));
    }
    Ok(s)
}

pub fn validate_project_id(raw: &str) -> Result<String, String> {
    let id = raw.trim();
    let ok = !id.is_empty()
        && id.len() <= 128
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !id.starts_with('.');
    if ok {
        Ok(id.to_string())
    } else {
        Err("That project id isn't valid.".to_string())
    }
}

/// A canvas group name, by the studio's own folder rule: letters/numbers in any
/// script, then spaces/underscores/hyphens; never a path.
pub fn valid_group(g: &str) -> bool {
    let mut chars = g.chars();
    match chars.next() {
        Some(c) if c.is_alphanumeric() => {}
        _ => return false,
    }
    g.chars().count() <= 60 && chars.all(|c| c.is_alphanumeric() || c == ' ' || c == '_' || c == '-')
}

/// The folder name for (server, project): readable and collision-free.
pub fn managed_key(server_url: &str, project_id: &str) -> String {
    let host = server_url
        .split("://")
        .nth(1)
        .unwrap_or(server_url)
        .replace(':', "-");
    let clean = |s: &str| -> String {
        s.chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '-' })
            .collect()
    };
    format!("{}--{}", clean(&host), clean(project_id))
}

fn managed_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("projects"))
        .map_err(|_| "Couldn't find this app's data folder.".to_string())
}

fn index_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("managed-projects.json"))
}

fn load_index(app: &tauri::AppHandle) -> ManagedIndex {
    index_path(app)
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_index(app: &tauri::AppHandle, idx: &ManagedIndex) {
    let Some(p) = index_path(app) else { return };
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(idx) {
        let _ = std::fs::write(p, json);
    }
}

/// Create or update the managed copy's `.design/config.json`.
pub fn write_managed_config(
    dir: &Path,
    server_url: &str,
    project_id: &str,
    name: &str,
    groups: &[String],
    now_ms: u64,
) -> std::io::Result<()> {
    let design = dir.join(".design");
    std::fs::create_dir_all(&design)?;
    let cfg_path = design.join("config.json");
    let mut cfg: serde_json::Value = std::fs::read(&cfg_path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .filter(|v: &serde_json::Value| v.is_object())
        .unwrap_or_else(|| serde_json::json!({}));
    let obj = cfg.as_object_mut().expect("object");
    obj.entry("name").or_insert_with(|| serde_json::Value::String(name.to_string()));
    obj.entry("designRoot").or_insert_with(|| serde_json::Value::String(".design".into()));
    // Groups: keep the project's own, add any it uses that are missing.
    let mut declared: Vec<serde_json::Value> = obj
        .get("canvasGroups")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let have: Vec<String> = declared
        .iter()
        .filter_map(|g| g.get("path").and_then(|p| p.as_str()).map(String::from))
        .collect();
    for g in groups.iter().filter(|g| valid_group(g)).take(MAX_GROUPS) {
        if !have.contains(g) {
            declared.push(serde_json::json!({ "label": g, "path": g }));
        }
        std::fs::create_dir_all(design.join(g))?;
    }
    obj.insert("canvasGroups".into(), serde_json::Value::Array(declared));
    obj.insert(
        "linkedHub".into(),
        serde_json::json!({ "url": server_url, "linkedAt": now_ms }),
    );
    obj.insert(
        "managed".into(),
        serde_json::json!({ "server": server_url, "projectId": project_id }),
    );
    let text = serde_json::to_string_pretty(&cfg).map_err(std::io::Error::other)?;
    let tmp = design.join("config.json.tmp");
    std::fs::write(&tmp, format!("{text}\n"))?;
    std::fs::rename(tmp, cfg_path)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Open (creating on first use) the managed copy of a project and switch to it.
/// Returns the local path. Idempotent: a second open of the same project reuses
/// the same copy — pending work in it is never replaced.
#[tauri::command]
pub fn managed_project_open(
    app: tauri::AppHandle,
    server_url: String,
    project_id: String,
    name: String,
    canvas_groups: Vec<String>,
) -> Result<String, String> {
    let server = validate_server_url(&server_url)?;
    let id = validate_project_id(&project_id)?;
    let display: String = name.trim().chars().filter(|c| !c.is_control()).take(120).collect();
    let display = if display.is_empty() { id.clone() } else { display };
    let key = managed_key(&server, &id);
    let dir = managed_root(&app)?.join(&key);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create the project folder: {e}"))?;
    write_managed_config(&dir, &server, &id, &display, &canvas_groups, now_ms())
        .map_err(|e| format!("Couldn't prepare the project folder: {e}"))?;

    let mut idx = load_index(&app);
    idx.projects.retain(|p| p.key != key);
    idx.projects.insert(
        0,
        ManagedProject {
            key,
            server_url: server,
            project_id: id,
            name: display,
            path: dir.to_string_lossy().to_string(),
            last_opened: now_ms(),
        },
    );
    idx.projects.truncate(50);
    save_index(&app, &idx);

    crate::app_state::set_last_project(&app, &dir);
    crate::sidecar::switch_project(&app, dir.clone(), None);
    Ok(dir.to_string_lossy().to_string())
}

/// The projects this computer keeps a managed copy of, most recent first.
#[tauri::command]
pub fn managed_projects_list(app: tauri::AppHandle) -> Vec<ManagedProject> {
    load_index(&app)
        .projects
        .into_iter()
        .filter(|p| Path::new(&p.path).join(".design").is_dir())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_urls_are_https_or_loopback_http_and_never_carry_credentials() {
        assert_eq!(validate_server_url("https://Acme.cloud.maude.sh/").unwrap(), "https://acme.cloud.maude.sh");
        assert_eq!(validate_server_url("http://127.0.0.1:4599").unwrap(), "http://127.0.0.1:4599");
        assert!(validate_server_url("http://studio.example.com").is_err());
        assert!(validate_server_url("https://user:pw@example.com").is_err());
        assert!(validate_server_url("file:///etc").is_err());
        assert!(validate_server_url("not a url").is_err());
    }

    #[test]
    fn project_ids_cannot_become_paths() {
        assert!(validate_project_id("alligators").is_ok());
        assert!(validate_project_id("../../etc").is_err());
        assert!(validate_project_id("a/b").is_err());
        assert!(validate_project_id(".hidden").is_err());
        assert!(validate_project_id("").is_err());
    }

    #[test]
    fn the_key_is_stable_and_distinct_per_server_and_project() {
        let a = managed_key("https://acme.cloud.maude.sh", "alligators");
        let b = managed_key("https://studio.example.com", "alligators");
        let c = managed_key("http://127.0.0.1:4599", "local");
        assert_eq!(a, "acme.cloud.maude.sh--alligators");
        assert_ne!(a, b);
        assert_eq!(c, "127.0.0.1-4599--local");
        assert!(!c.contains('/'));
    }

    #[test]
    fn groups_follow_the_studio_folder_rule() {
        assert!(valid_group("ui"));
        assert!(valid_group("Návrhy"));
        assert!(valid_group("Screens 2"));
        assert!(!valid_group("_state"));
        assert!(!valid_group("../x"));
        assert!(!valid_group("a/b"));
        assert!(!valid_group(""));
    }

    #[test]
    fn config_is_created_then_updated_without_losing_the_projects_own_keys() {
        let dir = std::env::temp_dir().join(format!("maude-managed-{}", now_ms()));
        write_managed_config(&dir, "https://h", "p", "Proj", &["ui".into(), "screens".into()], 1).unwrap();
        let cfg: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join(".design/config.json")).unwrap()).unwrap();
        assert_eq!(cfg["linkedHub"]["url"], "https://h");
        assert_eq!(cfg["managed"]["projectId"], "p");
        assert_eq!(cfg["canvasGroups"].as_array().unwrap().len(), 2);
        assert!(dir.join(".design/screens").is_dir());
        // The project later declares its own name/keys; a re-open keeps them.
        let mut edited = cfg.clone();
        edited["name"] = serde_json::json!("Renamed by the project");
        edited["designSystems"] = serde_json::json!([{ "path": "system/brand" }]);
        std::fs::write(dir.join(".design/config.json"), edited.to_string()).unwrap();
        write_managed_config(&dir, "https://h", "p", "Proj", &["ui".into(), "../bad".into()], 2).unwrap();
        let again: serde_json::Value =
            serde_json::from_slice(&std::fs::read(dir.join(".design/config.json")).unwrap()).unwrap();
        assert_eq!(again["name"], "Renamed by the project");
        assert_eq!(again["designSystems"][0]["path"], "system/brand");
        assert_eq!(again["canvasGroups"].as_array().unwrap().len(), 2, "no duplicate, no bad group");
        assert_eq!(again["linkedHub"]["linkedAt"], 2);
        let _ = std::fs::remove_dir_all(dir);
    }
}
