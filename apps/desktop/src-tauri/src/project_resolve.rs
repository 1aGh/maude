//! Resolve file links using remembered local projects. Never open or switch here.
use std::path::{Path, PathBuf};

fn valid_project(project: &str) -> bool {
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
    let url = tauri::Url::parse(config.get("linkedHub")?.get("url")?.as_str()?).ok()?;
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

#[tauri::command]
pub fn resolve_project_for_link(app: tauri::AppHandle, project: String) -> Option<String> {
    let state = crate::app_state::load(&app);
    resolve_from_paths(
        &project,
        state.recent_projects.into_iter().chain(state.last_project),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

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
