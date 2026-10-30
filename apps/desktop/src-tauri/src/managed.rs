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

/// The copy's folder name for `profile` (N-H1): two profiles never share one
/// copy (each holds its own hub credential). Default keeps the 1.x key; any
/// other profile prefixes `<id>@` — `@` never appears in `managed_key`.
pub fn managed_key_for(profile: &str, server_url: &str, project_id: &str) -> String {
    let key = managed_key(server_url, project_id);
    if profile == crate::profiles::DEFAULT_ID {
        key
    } else {
        format!("{profile}@{key}")
    }
}

/// Which profile a managed open is for (N-H1). Home names the profile it
/// prepared for (`None` = default); it must be a valid, existing id. A project
/// window always gets its OWN profile and may not name another.
pub fn managed_profile(
    caller: &crate::windows::Caller,
    requested: Option<&str>,
    caller_profile: impl Fn(&str) -> String,
    exists: impl Fn(&str) -> bool,
) -> Result<String, String> {
    let id = match caller {
        crate::windows::Caller::Home => requested
            .unwrap_or(crate::profiles::DEFAULT_ID)
            .to_string(),
        crate::windows::Caller::Project(c) => {
            let own = caller_profile(&c.root);
            if requested.is_some_and(|r| r != own) {
                return Err("This window can only open projects for its own account.".to_string());
            }
            own
        }
    };
    crate::profiles::validate_id(&id)?;
    if !exists(&id) {
        return Err("That account profile doesn't exist.".to_string());
    }
    Ok(id)
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
///
/// What a caller may do with `managed_project_open` (V2-3.6 M3, contract
/// V2-1.1 §5.8 item 3: the command is Home's).
#[derive(Debug, PartialEq)]
pub enum ManagedGate {
    Allow,
    /// A project window naming a server it has no standing with: the person
    /// confirms the host in a NATIVE dialog (a page cannot click it).
    Confirm,
}

/// Pure policy. Home may open any validated (server, project). A project
/// window — the v1 team-project dialog, the onboarding door and the
/// CloudBar handoff still call it there — may open without asking only a copy
/// this computer already keeps (`known`) or a project on the configured Maude
/// Cloud / its zone (`in_cloud`, where the person's own account decides
/// membership). Anything else — a self-hosted hub typed into the dialog, or
/// a page naming its own server — needs the person's native confirmation.
pub fn managed_gate(
    caller: &crate::windows::Caller,
    server: &str,
    id: &str,
    known: &[ManagedProject],
    in_cloud: bool,
) -> ManagedGate {
    match caller {
        crate::windows::Caller::Home => ManagedGate::Allow,
        crate::windows::Caller::Project(_)
            if in_cloud || known.iter().any(|p| p.server_url == server && p.project_id == id) =>
        {
            ManagedGate::Allow
        }
        crate::windows::Caller::Project(_) => ManagedGate::Confirm,
    }
}

/// The native "open a team project on <host>?" confirmation, parented to the
/// calling window. Debug builds honour `MAUDE_E2E_CONFIRM_TEAM_SERVER=1` (a
/// native dialog is not DOM-reachable); a release build never reads it.
async fn confirm_team_server(webview: &tauri::Webview, server: &str) -> bool {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    #[cfg(debug_assertions)]
    if std::env::var("MAUDE_E2E_CONFIRM_TEAM_SERVER").as_deref() == Ok("1") {
        return true;
    }
    let host = server.split("://").nth(1).unwrap_or(server).to_string();
    let (tx, rx) = tokio::sync::oneshot::channel();
    webview
        .app_handle()
        .dialog()
        .message(format!(
            "Open a team project from {host}? Its canvases will sync with that server."
        ))
        .title("Open team project")
        .parent(&webview.window())
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Open".to_string(),
            "Cancel".to_string(),
        ))
        .show(move |ok| {
            let _ = tx.send(ok);
        });
    rx.await.unwrap_or(false)
}

/// From Home (V2-3.3, contract §5.4): ONLY creates/locates the copy and returns
/// its folder — the page then calls `open_project({root})`, which opens it as a
/// tab. From a project window (the pre-Home cloud picker): also switches that
/// window in-tab, as before — narrowed by `managed_gate` (V2-3.6 M3).
#[tauri::command]
pub async fn managed_project_open(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    server_url: String,
    project_id: String,
    name: String,
    canvas_groups: Vec<String>,
    profile: Option<String>,
) -> Result<String, String> {
    let who = crate::windows::caller_any(&webview, false)?;
    let server = validate_server_url(&server_url)?;
    let id = validate_project_id(&project_id)?;
    let profile = managed_profile(
        &who,
        profile.as_deref(),
        |root| crate::app_state::profile_for(&app, root),
        |p| p == crate::profiles::DEFAULT_ID || crate::profiles::exists(p),
    )?;
    let known = load_index(&app).projects;
    let gate = managed_gate(&who, &server, &id, &known, crate::oauth::in_cloud_zone(&server));
    if gate == ManagedGate::Confirm {
        if !confirm_team_server(&webview, &server).await {
            return Err("Opening the team project was cancelled.".to_string());
        }
        // The window may have moved while the dialog was up: it must still be
        // the same caller on its own origin.
        if crate::windows::caller_any(&webview, false)? != who {
            return Err("This window changed while you were deciding.".to_string());
        }
    }
    let caller = match who {
        crate::windows::Caller::Home => None,
        crate::windows::Caller::Project(c) => Some(c),
    };
    let display: String = name.trim().chars().filter(|c| !c.is_control()).take(120).collect();
    let display = if display.is_empty() { id.clone() } else { display };
    let key = managed_key_for(&profile, &server, &id);
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
            server_url: server.clone(),
            project_id: id.clone(),
            name: display,
            path: dir.to_string_lossy().to_string(),
            last_opened: now_ms(),
        },
    );
    idx.projects.truncate(50);
    save_index(&app, &idx);
    // N-H1: bound to the profile it was prepared for BEFORE anything opens it,
    // so its server spawns with that profile's hub/cloud files and token key.
    crate::app_state::bind_managed(&app, &dir, &profile, &server, &id)?;

    if let Some(caller) = caller {
        crate::app_state::set_last_project(&app, &dir);
        crate::sidecar::switch_project(&app, &caller.label, dir.clone(), None);
    }
    Ok(dir.to_string_lossy().to_string())
}

/// `(path, server)` of every managed copy in the app-owned index — the
/// routing half of N-M4 for copies made before the registry carried a binding.
pub fn bound_copies(app: &tauri::AppHandle) -> Vec<(String, String)> {
    load_index(app)
        .projects
        .into_iter()
        .map(|p| (p.path, p.server_url))
        .collect()
}

/// The projects this computer keeps a managed copy of, most recent first.
#[tauri::command]
pub fn managed_projects_list(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<Vec<ManagedProject>, String> {
    let caller = crate::windows::caller_any(&webview, false)?;
    let st = crate::app_state::load(&app);
    let copies = load_index(&app)
        .projects
        .into_iter()
        .filter(|p| Path::new(&p.path).join(".design").is_dir())
        .collect();
    Ok(visible_copies(&caller, &st, copies))
}

/// Which copies `caller` may list (V2-3.10 low (d)): Home all of them (it
/// serves every profile); a project window only those bound to its own account
/// profile — the `open_project` same-profile rule, so one profile's page never
/// learns another's cloud projects.
pub fn visible_copies(
    caller: &crate::windows::Caller,
    st: &crate::app_state::AppState,
    copies: Vec<ManagedProject>,
) -> Vec<ManagedProject> {
    match caller {
        crate::windows::Caller::Home => copies,
        crate::windows::Caller::Project(c) => {
            let mine = st.profile_for(&c.root);
            copies
                .into_iter()
                .filter(|p| st.profile_for(&p.path) == mine)
                .collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// V2-3.10 low (d): a project window lists only the copies bound to its
    /// own account profile; Home (which serves every profile) lists all.
    #[test]
    fn a_project_window_lists_only_its_own_profiles_copies() {
        use crate::windows::{pid_for_root, Caller, CallerProject};
        let copy = |path: &str| ManagedProject {
            key: path.into(),
            server_url: "https://hub.example".into(),
            project_id: "p".into(),
            name: path.into(),
            path: path.into(),
            last_opened: 0,
        };
        let mut st = crate::app_state::AppState::default();
        for (root, profile) in [("/me", "work"), ("/c-work", "work"), ("/c-home", "default")] {
            st.projects.insert(
                pid_for_root(root),
                serde_json::from_value(serde_json::json!({ "root": root, "profile": profile }))
                    .unwrap(),
            );
        }
        let all = vec![copy("/c-work"), copy("/c-home"), copy("/c-unbound")];
        let me = Caller::Project(CallerProject {
            label: format!("p-{}", pid_for_root("/me")),
            pid: pid_for_root("/me"),
            root: "/me".into(),
        });
        let paths = |v: Vec<ManagedProject>| v.into_iter().map(|p| p.path).collect::<Vec<_>>();
        assert_eq!(paths(visible_copies(&me, &st, all.clone())), vec!["/c-work"]);
        // An unbound copy reads as `default`, as profile_for does.
        let mut st_default = st.clone();
        st_default.projects.remove(&pid_for_root("/me"));
        assert_eq!(
            paths(visible_copies(&me, &st_default, all.clone())),
            vec!["/c-home", "/c-unbound"]
        );
        assert_eq!(paths(visible_copies(&Caller::Home, &st, all)).len(), 3);
    }

    /// V2-3.6 M3: from a `p-*` window, an arbitrary (server, project) is never
    /// opened silently — only a known copy or the configured cloud's zone.
    #[test]
    fn managed_project_open_is_refused_silently_from_a_project_window() {
        use crate::windows::{Caller, CallerProject};
        let project = Caller::Project(CallerProject {
            label: "p-l0123456789abcdef".into(),
            pid: "l0123456789abcdef".into(),
            root: "/tmp/a".into(),
        });
        let known = vec![ManagedProject {
            key: "k".into(),
            server_url: "https://hub.example".into(),
            project_id: "kept".into(),
            name: "Kept".into(),
            path: "/tmp/kept".into(),
            last_opened: 0,
        }];
        // A page naming its own server: the person must confirm natively.
        assert_eq!(
            managed_gate(&project, "http://127.0.0.1:6666", "x", &known, false),
            ManagedGate::Confirm
        );
        assert_eq!(
            managed_gate(&project, "https://hub.example", "other", &known, false),
            ManagedGate::Confirm,
            "a known server does not vouch for a new project id"
        );
        assert_eq!(managed_gate(&project, "https://hub.example", "kept", &known, false), ManagedGate::Allow);
        assert_eq!(
            managed_gate(&project, "https://acme.cloud.maude.sh", "x", &[], true),
            ManagedGate::Allow
        );
        // Home is the command's owner (contract §5.8 item 3).
        assert_eq!(managed_gate(&Caller::Home, "https://evil.example", "x", &[], false), ManagedGate::Allow);
        assert!(crate::oauth::in_cloud_zone("https://acme.cloud.maude.sh"));
        assert!(!crate::oauth::in_cloud_zone("https://evil.example"));
        assert!(!crate::oauth::in_cloud_zone("http://127.0.0.1:6666"));
    }

    /// N-H1 (audit 2): Home names the profile it prepared for (validated, and it
    /// must exist); a project window always gets its OWN profile and cannot name
    /// another; two profiles never share one copy.
    #[test]
    fn the_managed_copy_belongs_to_one_validated_profile() {
        use crate::windows::{Caller, CallerProject};
        let exists = |id: &str| id == "default" || id == "work";
        let own = |_: &str| "work".to_string();
        assert_eq!(managed_profile(&Caller::Home, Some("work"), own, exists).unwrap(), "work");
        assert_eq!(managed_profile(&Caller::Home, None, own, exists).unwrap(), "default");
        assert!(managed_profile(&Caller::Home, Some("gone"), own, exists).is_err());
        assert!(managed_profile(&Caller::Home, Some("../x"), own, exists).is_err());
        let project = Caller::Project(CallerProject {
            label: "p-l0123456789abcdef".into(),
            pid: "l0123456789abcdef".into(),
            root: "/tmp/a".into(),
        });
        assert_eq!(managed_profile(&project, None, own, exists).unwrap(), "work");
        assert_eq!(managed_profile(&project, Some("work"), own, exists).unwrap(), "work");
        assert!(managed_profile(&project, Some("default"), own, exists).is_err());

        let d = managed_key_for("default", "https://acme.cloud.maude.sh", "alligators");
        let w = managed_key_for("work", "https://acme.cloud.maude.sh", "alligators");
        assert_eq!(d, "acme.cloud.maude.sh--alligators", "default keeps the 1.x key");
        assert_eq!(w, "work@acme.cloud.maude.sh--alligators");
        assert_ne!(d, w);
        assert!(!w.contains('/'));
    }

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
