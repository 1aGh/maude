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

/// One thing a launch (or a running app) was handed: a project folder, or a `maude://` link
/// (routed by `deep_link::route_now`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Arrival {
    Folder(PathBuf),
    Link(String),
}

/// The arrivals of one `Opened` event, in the event's order: each `file://` URL validated as a
/// project folder, each `maude://` link (bounded like a URL). Each once, at most `MAX_PER_EVENT`
/// folders and `MAX_PER_EVENT` links; anything else is dropped. Refusals are returned for the log.
pub fn arrivals(urls: &[tauri::Url]) -> (Vec<Arrival>, Vec<(String, Refusal)>) {
    let mut out: Vec<Arrival> = Vec::new();
    let mut refused = Vec::new();
    let count = |out: &Vec<Arrival>, folder: bool| {
        out.iter()
            .filter(|a| matches!(a, Arrival::Folder(_)) == folder)
            .count()
    };
    for url in urls {
        if url.scheme() == "maude" {
            let link = Arrival::Link(url.as_str().to_string());
            if url.as_str().len() <= MAX_URL
                && !out.contains(&link)
                && count(&out, false) < MAX_PER_EVENT
            {
                out.push(link);
            }
            continue;
        }
        match project_root_from_url(url) {
            Ok(root) if out.contains(&Arrival::Folder(root.clone())) => {}
            Ok(root) if count(&out, true) < MAX_PER_EVENT => out.push(Arrival::Folder(root)),
            Ok(root) => refused.push((root.display().to_string(), Refusal::Malformed)),
            Err(Refusal::NotFile) => {}
            Err(why) => refused.push((url.path().to_string(), why)),
        }
    }
    (out, refused)
}

/// The project roots of one `Opened` event (`arrivals`' folders).
#[cfg(test)]
pub fn project_roots(urls: &[tauri::Url]) -> (Vec<PathBuf>, Vec<(String, Refusal)>) {
    let (all, refused) = arrivals(urls);
    let roots = all
        .into_iter()
        .filter_map(|a| match a {
            Arrival::Folder(p) => Some(p),
            Arrival::Link(_) => None,
        })
        .collect();
    (roots, refused)
}

/// fix/205-open-a-cold — on a COLD launch (`open -a Maude <folder>` with the app not running)
/// `Opened` arrives while `setup` is still building the shell, Home and the boot tabs. Opening
/// then raced the boot's own open of the same project: both wrote the tab's book entry, the
/// loser's failed webview build took the winner's entry back out, and the tab stayed on
/// "Still starting" with the strip answering "no tab p-…". So folders wait here until boot is
/// done (`open`), then open through File ▸ Open's open-once path — a folder the restored session
/// already shows focuses its tab. A cold-launch `maude://` link waits here too (it would race
/// the boot the same way, and before `setup` no listener even hears it): restore first, then
/// every arrival in its order.
pub struct BootGate {
    inner: std::sync::Mutex<GateInner>,
}

struct GateInner {
    booted: bool,
    queued: Vec<Arrival>,
}

impl BootGate {
    pub const fn new() -> Self {
        Self {
            inner: std::sync::Mutex::new(GateInner {
                booted: false,
                queued: Vec::new(),
            }),
        }
    }

    /// The arrivals of one event: returned to handle NOW once boot is done; before that queued
    /// (each once, at most `MAX_PER_EVENT` folders and `MAX_PER_EVENT` links in all — a burst
    /// past it is dropped) and nothing is returned.
    pub fn offer(&self, items: Vec<Arrival>) -> Vec<Arrival> {
        // One lock for the check and the queue: an offer racing `open` is either drained by
        // it or sees `booted` — never lost in between.
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if g.booted {
            return items;
        }
        for item in items {
            let folder = matches!(item, Arrival::Folder(_));
            let same_kind = g
                .queued
                .iter()
                .filter(|q| matches!(q, Arrival::Folder(_)) == folder)
                .count();
            if !g.queued.contains(&item) && same_kind < MAX_PER_EVENT {
                g.queued.push(item);
            }
        }
        Vec::new()
    }

    /// Boot is done: the queued arrivals, in arrival order. Every later `offer` passes through.
    pub fn open(&self) -> Vec<Arrival> {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.booted = true;
        std::mem::take(&mut g.queued)
    }
}

impl Default for BootGate {
    fn default() -> Self {
        Self::new()
    }
}

/// The app's one gate: `RunEvent::Opened` offers, `setup` opens it after the boot tabs.
pub static BOOT_GATE: BootGate = BootGate::new();

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> Arrival {
        Arrival::Folder(PathBuf::from(s))
    }

    fn l(s: &str) -> Arrival {
        Arrival::Link(s.to_string())
    }

    /// 2.0.5: a cold-launch `maude://` link raced the boot like a folder did (and before
    /// `setup` no listener heard it at all). It waits, and comes out in its place among the
    /// folders — after the restore, which `setup` does before it opens the gate.
    #[test]
    fn a_link_offered_before_boot_waits_in_its_place_among_the_folders() {
        let gate = BootGate::new();
        assert!(
            gate.offer(vec![p("/a"), l("maude://open/x")]).is_empty(),
            "no link is routed before boot"
        );
        assert!(gate.offer(vec![p("/b"), l("maude://open/y")]).is_empty());
        assert_eq!(
            gate.open(),
            vec![p("/a"), l("maude://open/x"), p("/b"), l("maude://open/y")]
        );
        // Warm: a link passes straight through, unchanged.
        assert_eq!(
            gate.offer(vec![l("maude://open/x")]),
            vec![l("maude://open/x")]
        );
    }

    #[test]
    fn the_queue_holds_each_link_once_and_at_most_three_besides_the_folders() {
        let gate = BootGate::new();
        let links: Vec<Arrival> = (0..5).map(|i| l(&format!("maude://open/p{i}"))).collect();
        assert!(gate
            .offer(vec![links[0].clone(), links[0].clone()])
            .is_empty());
        assert!(gate.offer(links[1..].to_vec()).is_empty());
        assert!(gate.offer(vec![p("/a")]).is_empty());
        let mut want = links[..MAX_PER_EVENT].to_vec();
        want.push(p("/a"));
        assert_eq!(
            gate.open(),
            want,
            "the link cap does not eat the folder's place"
        );
    }

    #[test]
    fn an_opened_event_keeps_its_folders_and_links_in_order() {
        let tmp = scratch("arrivals");
        let a = project(tmp.as_path(), "a");
        let b = project(tmp.as_path(), "b");
        let urls = vec![
            tauri::Url::parse("maude://open/one").unwrap(),
            url_for(&a),
            tauri::Url::parse("https://example.com/x").unwrap(),
            tauri::Url::parse("maude://open/one").unwrap(),
            url_for(&b),
            tauri::Url::parse("maude://open/two").unwrap(),
        ];
        let (got, refused) = arrivals(&urls);
        assert_eq!(
            got,
            vec![
                l("maude://open/one"),
                Arrival::Folder(a),
                Arrival::Folder(b),
                l("maude://open/two"),
            ]
        );
        assert!(refused.is_empty(), "an https URL is not ours to refuse");
        let long = tauri::Url::parse(&format!("maude://open/{}", "a".repeat(MAX_URL))).unwrap();
        assert!(
            arrivals(&[long]).0.is_empty(),
            "an over-long link is dropped"
        );
    }

    #[test]
    fn a_folder_offered_before_boot_waits_and_opens_once_boot_is_done() {
        let gate = BootGate::new();
        assert!(
            gate.offer(vec![p("/a"), p("/b")]).is_empty(),
            "nothing opens before boot"
        );
        assert!(gate.offer(vec![p("/c")]).is_empty());
        assert_eq!(
            gate.open(),
            vec![p("/a"), p("/b"), p("/c")],
            "arrival order"
        );
        // Drained: a second `open` hands out nothing again.
        assert!(gate.open().is_empty());
    }

    #[test]
    fn after_boot_a_folder_opens_at_once() {
        let gate = BootGate::new();
        assert!(gate.open().is_empty());
        assert_eq!(gate.offer(vec![p("/a")]), vec![p("/a")]);
        assert_eq!(
            gate.offer(vec![p("/a")]),
            vec![p("/a")],
            "open-once is the window book's job"
        );
        assert!(gate.open().is_empty(), "nothing was queued");
    }

    #[test]
    fn the_queue_holds_each_folder_once_and_at_most_three() {
        let gate = BootGate::new();
        assert!(gate.offer(vec![p("/a"), p("/b")]).is_empty());
        assert!(gate.offer(vec![p("/a"), p("/c"), p("/d")]).is_empty());
        assert!(gate.offer(vec![p("/e")]).is_empty());
        assert_eq!(gate.open(), vec![p("/a"), p("/b"), p("/c")]);
    }

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
