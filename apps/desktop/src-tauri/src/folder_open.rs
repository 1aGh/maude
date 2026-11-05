// fix/ds-convert-hooks-cli #13b — a folder handed to the app by macOS (`open -a Maude <folder>`,
// Finder's Open With, a folder dropped on the Dock icon) arrives as `RunEvent::Opened` with
// `file://` URLs. Info.plist declares `public.folder` (rank Alternate, so Maude never becomes the
// folder default). Any local process can send that event, so a URL is untrusted input exactly
// like a deep link: only a `file://` URL naming an existing folder with a `.design/` directory
// opens, and it opens through File ▸ Open's own path (open-once: an open project focuses its tab).

use std::path::PathBuf;

/// Longest URL this shell reads (deep links use the same bound).
const MAX_URL: usize = 4096;
/// Folders one `Opened` event may open — a burst past this is dropped, not queued.
pub const MAX_PER_EVENT: usize = 3;

/// Why a URL does not open a project.
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    /// Not a `file://` URL (a `maude://` link takes the deep-link path).
    NotFile,
    /// Too long, a remote host, or not an absolute local path.
    Malformed,
    /// No folder at that path.
    NotAFolder,
    /// A folder, but not a Maude project (no `.design/`).
    NotAProject,
}

/// `file://` URL → the project root it names: canonical (symlinks and `..` resolved), a
/// directory, holding a `.design/` directory. Pure apart from the filesystem reads.
pub fn project_root_from_url(url: &tauri::Url) -> Result<PathBuf, Refusal> {
    if url.scheme() != "file" {
        return Err(Refusal::NotFile);
    }
    if url.as_str().len() > MAX_URL {
        return Err(Refusal::Malformed);
    }
    // `file://host/…` names another machine; only the local spellings open.
    if !matches!(url.host_str(), None | Some("") | Some("localhost")) {
        return Err(Refusal::Malformed);
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(Refusal::Malformed);
    }
    let path = url.to_file_path().map_err(|_| Refusal::Malformed)?;
    if !path.is_absolute() {
        return Err(Refusal::Malformed);
    }
    let root = std::fs::canonicalize(&path).map_err(|_| Refusal::NotAFolder)?;
    if !root.is_dir() {
        return Err(Refusal::NotAFolder);
    }
    // The dev-server fails loud on a folder with no `.design/` (load-bearing, CLAUDE.md) — refuse
    // here instead of crash-looping its sidecar.
    if !root.join(".design").is_dir() {
        return Err(Refusal::NotAProject);
    }
    Ok(root)
}

/// The project roots of one `Opened` event: `file://` URLs only, each validated, deduplicated,
/// at most `MAX_PER_EVENT`. Refusals are returned for the log.
pub fn project_roots(urls: &[tauri::Url]) -> (Vec<PathBuf>, Vec<(String, Refusal)>) {
    let mut roots: Vec<PathBuf> = Vec::new();
    let mut refused = Vec::new();
    for url in urls {
        match project_root_from_url(url) {
            Ok(root) if roots.contains(&root) => {}
            Ok(root) if roots.len() < MAX_PER_EVENT => roots.push(root),
            Ok(root) => refused.push((root.display().to_string(), Refusal::Malformed)),
            // A `maude://` URL is the deep-link plugin's; not a refusal worth logging.
            Err(Refusal::NotFile) => {}
            Err(why) => refused.push((url.path().to_string(), why)),
        }
    }
    (roots, refused)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "maude-folder-open-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn url_for(p: &std::path::Path) -> tauri::Url {
        tauri::Url::from_file_path(p).unwrap()
    }

    fn project(base: &std::path::Path, name: &str) -> PathBuf {
        let p = base.join(name);
        std::fs::create_dir_all(p.join(".design")).unwrap();
        std::fs::canonicalize(p).unwrap()
    }

    #[test]
    fn a_project_folder_url_maps_to_its_canonical_root() {
        let tmp = scratch("root");
        let root = project(tmp.as_path(), "proj");
        assert_eq!(project_root_from_url(&url_for(&root)), Ok(root.clone()));
        // A trailing slash (Finder sends one for a folder) and a `..` both land on the same root.
        let slashed = tauri::Url::parse(&format!("{}/", url_for(&root))).unwrap();
        assert_eq!(project_root_from_url(&slashed), Ok(root.clone()));
        let dotted = url_for(&root.join("sub").join(".."));
        std::fs::create_dir_all(root.join("sub")).unwrap();
        assert_eq!(project_root_from_url(&dotted), Ok(root.clone()));
        let local = tauri::Url::parse(&format!("file://localhost{}", root.display())).unwrap();
        assert_eq!(project_root_from_url(&local), Ok(root));
    }

    #[test]
    fn a_symlinked_folder_opens_as_its_target() {
        let tmp = scratch("link");
        let root = project(tmp.as_path(), "real");
        let link = tmp.as_path().join("link");
        std::os::unix::fs::symlink(&root, &link).unwrap();
        assert_eq!(project_root_from_url(&url_for(&link)), Ok(root));
    }

    #[test]
    fn anything_but_a_local_project_folder_is_refused() {
        let tmp = scratch("refuse");
        let plain = tmp.as_path().join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        let file = tmp.as_path().join("a.tsx");
        std::fs::write(&file, "x").unwrap();
        // `.design` as a FILE is not a project either.
        let fake = tmp.as_path().join("fake");
        std::fs::create_dir_all(&fake).unwrap();
        std::fs::write(fake.join(".design"), "x").unwrap();
        let root = project(tmp.as_path(), "proj");

        let cases: Vec<(tauri::Url, Refusal)> = vec![
            (
                tauri::Url::parse("maude://open/proj").unwrap(),
                Refusal::NotFile,
            ),
            (
                tauri::Url::parse("https://example.com/proj").unwrap(),
                Refusal::NotFile,
            ),
            (url_for(&plain), Refusal::NotAProject),
            (url_for(&fake), Refusal::NotAProject),
            (url_for(&file), Refusal::NotAFolder),
            (url_for(&tmp.as_path().join("missing")), Refusal::NotAFolder),
            (
                tauri::Url::parse(&format!("file://evil.example{}", root.display())).unwrap(),
                Refusal::Malformed,
            ),
            (
                tauri::Url::parse(&format!("{}?open=ui/a.tsx", url_for(&root))).unwrap(),
                Refusal::Malformed,
            ),
            (
                tauri::Url::parse(&format!(
                    "file://{}/{}",
                    root.display(),
                    "a".repeat(MAX_URL)
                ))
                .unwrap(),
                Refusal::Malformed,
            ),
        ];
        for (url, want) in cases {
            assert_eq!(project_root_from_url(&url), Err(want), "{url}");
        }
    }

    #[test]
    fn one_event_opens_each_project_once_and_at_most_three() {
        let tmp = scratch("burst");
        let roots: Vec<PathBuf> = (0..5)
            .map(|i| project(tmp.as_path(), &format!("p{i}")))
            .collect();
        let mut urls: Vec<tauri::Url> = vec![url_for(&roots[0]), url_for(&roots[0])];
        urls.push(tauri::Url::parse("maude://open/p1").unwrap());
        urls.extend(roots[1..].iter().map(|r| url_for(r)));
        urls.push(url_for(&tmp.as_path().join("missing")));
        let (open, refused) = project_roots(&urls);
        assert_eq!(open, roots[..MAX_PER_EVENT].to_vec());
        // Two over the cap and the missing folder; the duplicate and the maude:// link are silent.
        assert_eq!(refused.len(), 3);
    }
}
