//! Resolve file links using remembered local projects. Never open or switch here.
use std::path::{Path, PathBuf};

pub(crate) fn valid_project(project: &str) -> bool {
    let bytes = project.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 40
        && bytes[0].is_ascii_alphanumeric()
        && bytes[bytes.len() - 1].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

/// The IPC value is already decoded by the client. Decoding again changes names.
/// RETURN_RULES twin: studio/client/share-link.js and hub/src/return-to.mjs.
pub fn validate_open_param(open: &str) -> Option<String> {
    if open.is_empty()
        || open.encode_utf16().count() > 512
        || open.chars().any(|c| c.is_control() || c == '\\')
        || (open.as_bytes().get(1) == Some(&b':') && open.as_bytes()[0].is_ascii_alphabetic())
    {
        return None;
    }
    let rel = open.strip_prefix(".design/").unwrap_or(open);
    if rel
        .split('/')
        .any(|s| s.is_empty() || s == "." || s == "..")
    {
        return None;
    }
    Some(rel.to_string())
}

fn folder_slug(path: &Path) -> String {
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();
    name.split(|c: char| !c.is_ascii_lowercase() && !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
        .chars()
        .take(40)
        .collect::<String>()
        .trim_end_matches('-')
        .to_string()
}

fn linked_project(path: &Path) -> Option<String> {
    let config: serde_json::Value =
        serde_json::from_slice(&std::fs::read(path.join(".design/config.json")).ok()?).ok()?;
    hub_slug(config.get("linkedHub")?.get("url")?.as_str()?)
}

/// A hub URL's project slug — the first label of a (≥3-label, non-IP,
/// non-`.localhost`) host: `https://alligators.cloud.maude.sh` → `alligators`.
fn hub_slug(raw: &str) -> Option<String> {
    let url = tauri::Url::parse(raw).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.host_str()?;
    if host.parse::<std::net::IpAddr>().is_ok() || host.ends_with(".localhost") {
        return None;
    }
    let labels: Vec<_> = host.split('.').collect();
    (labels.len() >= 3 && valid_project(labels[0])).then(|| labels[0].to_string())
}

fn resolve_from_paths(project: &str, paths: impl IntoIterator<Item = String>) -> Option<String> {
    if !valid_project(project) {
        return None;
    }
    let candidates: Vec<PathBuf> = paths
        .into_iter()
        .map(PathBuf::from)
        .filter(|p| p.is_absolute() && p.join(".design").is_dir())
        .collect();
    // Prefer a configured identity across the entire list before folder names.
    let found = candidates
        .iter()
        .find(|p| linked_project(p).as_deref() == Some(project))
        .or_else(|| {
            candidates
                .iter()
                .find(|p| linked_project(p).is_none() && folder_slug(p) == project)
        });
    found.map(|p| p.to_string_lossy().into_owned())
}

/// Every folder a link may resolve to: the project registry (V2-3.1 — what
/// Home lists), then the legacy recent list and the last project. Remembered
/// folders only; `resolve_from_paths` still drops any without `.design/`.
/// `profile`: only folders bound to it (N-M1 — a project page asks for its own
/// profile); `None` = every profile (the shell's own routing).
pub(crate) fn resolve_known_in(
    state: &crate::app_state::AppState,
    project: &str,
    profile: Option<&str>,
) -> Option<String> {
    let mut paths: Vec<String> = state.projects.values().map(|e| e.root.clone()).collect();
    paths.extend(state.recent_projects.iter().cloned());
    paths.extend(state.last_project.iter().cloned());
    paths.retain(|p| profile.is_none_or(|id| state.profile_for(p) == id));
    resolve_from_paths(project, paths)
}

pub(crate) fn resolve_known(state: &crate::app_state::AppState, project: &str) -> Option<String> {
    resolve_known_in(state, project, None)
}

/// Where a CONNECT link (one carrying a `?code=`) may go besides Home (V2-3.6
/// N-M4): the one folder the APP bound to that hub — a managed copy, by the
/// registry's own descriptor or the app-owned managed index (`legacy`:
/// `(root, server)`, copies made before the registry carried one). Never a
/// folder's own committed `linkedHub` claim. None, or two candidates: Home.
pub(crate) fn resolve_connect(
    state: &crate::app_state::AppState,
    legacy: &[(String, String)],
    project: &str,
) -> Option<String> {
    if !valid_project(project) {
        return None;
    }
    let mut roots: Vec<String> = Vec::new();
    let bound = state
        .projects
        .iter()
        .filter_map(|(pid, e)| Some((e.root.clone(), state.managed_server_of(pid)?)));
    for (root, server) in bound.chain(legacy.iter().cloned()) {
        let same = roots
            .iter()
            .any(|r| crate::windows::pid_for_root(r) == crate::windows::pid_for_root(&root));
        if !same
            && hub_slug(&server).as_deref() == Some(project)
            && Path::new(&root).join(".design").is_dir()
        {
            roots.push(root);
        }
    }
    match roots.as_slice() {
        [one] => Some(one.clone()),
        _ => None,
    }
}

/// `resolve_project_for_link(project)` — the file-link dialog's "is it on this
/// Mac?": the calling project window's OWN profile only (N-M1), so a page
/// never reads where another profile's projects live.
#[tauri::command]
pub fn resolve_project_for_link(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    project: String,
) -> Result<Option<String>, String> {
    let caller = crate::windows::caller_project(&webview, false)?;
    let st = crate::app_state::load(&app);
    let profile = st.profile_for(&caller.root);
    Ok(resolve_known_in(&st, &project, Some(&profile)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project_dir(tag: &str, linked: Option<&str>) -> String {
        let d = std::env::temp_dir().join(format!("maude-nm4-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".design")).unwrap();
        if let Some(url) = linked {
            std::fs::write(
                d.join(".design/config.json"),
                serde_json::json!({ "linkedHub": { "url": url } }).to_string(),
            )
            .unwrap();
        }
        d.to_string_lossy().into_owned()
    }

    /// N-M4 (audit 2): a connect link goes to the folder the APP bound to the
    /// hub, never to one whose own config.json claims it; two claimants or
    /// none ⇒ Home.
    #[test]
    fn a_connect_link_routes_only_by_the_apps_own_binding() {
        let claimant = project_dir("claim", Some("https://alligators.cloud.maude.sh"));
        let copy = project_dir("copy", None);
        let mut st = crate::app_state::AppState::default();
        st.upsert(&claimant, 1);
        assert_eq!(resolve_known(&st, "alligators").as_deref(), Some(claimant.as_str()));
        assert_eq!(resolve_connect(&st, &[], "alligators"), None, "a claim is not a binding");
        st.bind_managed(&copy, "default", "https://alligators.cloud.maude.sh", "alligators", 2);
        assert_eq!(resolve_connect(&st, &[], "alligators").as_deref(), Some(copy.as_str()));
        // The app-owned managed index (a copy made before the registry carried it).
        let other = project_dir("legacy", None);
        let legacy = vec![(other.clone(), "https://alligators.cloud.maude.sh".to_string())];
        assert_eq!(resolve_connect(&st, &legacy, "alligators"), None, "two copies ⇒ Home");
        let mut st2 = crate::app_state::AppState::default();
        st2.upsert(&claimant, 1);
        assert_eq!(resolve_connect(&st2, &legacy, "alligators").as_deref(), Some(other.as_str()));
        assert_eq!(resolve_connect(&st2, &legacy, "Bad/slug"), None);
    }

    /// N-M1: a project page resolves only inside its own profile.
    #[test]
    fn link_resolution_for_a_page_stays_in_its_profile() {
        let mine = project_dir("mine", None);
        let theirs = project_dir("theirs", Some("https://beta.cloud.maude.sh"));
        let mut st = crate::app_state::AppState::default();
        let t = st.upsert(&theirs, 1);
        st.projects.get_mut(&t).unwrap().profile = "work".into();
        st.upsert(&mine, 2);
        assert_eq!(resolve_known_in(&st, "beta", Some("default")), None);
        assert_eq!(resolve_known_in(&st, "beta", Some("work")).as_deref(), Some(theirs.as_str()));
        assert_eq!(resolve_known_in(&st, "beta", None).as_deref(), Some(theirs.as_str()));
    }

    #[test]
    fn project_resolve_rejects_hostile_paths_and_keeps_unicode_and_literal_percent() {
        for value in [
            "",
            "..",
            "/etc/passwd",
            "//host",
            "a/../b",
            "a/./b",
            "a//b",
            "a\\b",
            "C:/a",
            "a\0b",
        ] {
            assert_eq!(validate_open_param(value), None, "{value:?}");
        }
        assert_eq!(validate_open_param(&"a".repeat(513)), None);
        for value in ["ui/Žába.tsx", "ui/%2e%2e.tsx", "ui/100%.tsx"] {
            assert_eq!(validate_open_param(value).as_deref(), Some(value));
        }
        assert_eq!(
            validate_open_param(".design/ui/A.tsx").as_deref(),
            Some("ui/A.tsx")
        );
    }

    #[test]
    fn project_resolve_prefers_linked_identity_and_never_guesses_similar_names() {
        let root = std::env::temp_dir().join(format!("maude-link-resolve-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let named = root.join("target");
        let linked = root.join("other-folder");
        for path in [&named, &linked] {
            std::fs::create_dir_all(path.join(".design")).unwrap();
        }
        std::fs::write(
            linked.join(".design/config.json"),
            r#"{"linkedHub":{"url":"https://target.cloud.maude.sh"}}"#,
        )
        .unwrap();
        let paths = vec![
            named.to_string_lossy().into_owned(),
            linked.to_string_lossy().into_owned(),
        ];
        assert_eq!(
            resolve_from_paths("target", paths.clone()),
            Some(linked.to_string_lossy().into_owned())
        );
        for project in [
            "target-evil",
            "..",
            "UPPER",
            "x/y",
            "žába",
            "-evil",
            "evil-",
        ] {
            assert_eq!(resolve_from_paths(project, paths.clone()), None);
        }
        assert_eq!(resolve_from_paths("other-folder", paths), None);
        std::fs::remove_dir_all(root).unwrap();
    }
}
