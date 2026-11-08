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

// ── Worktrees (#206, DDR-250, contract `206-cli-reuses-desktop.md` §5) ──────────
//
// A git worktree's root holds a `.git` FILE (`gitdir: <main>/.git/worktrees/<name>`)
// instead of a `.git` directory. Detection reads files only — no git process — and
// trusts the folder's own `.git` file for nothing: the main repository has to vouch
// for the worktree (its `worktrees/<name>/gitdir` names this folder's `.git` back), so
// a planted `.git` file in a downloaded folder cannot claim to be a worktree of a
// project Maude already knows.

/// What a worktree's `HEAD` names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Head {
    /// `ref: refs/heads/<branch>`.
    Branch(String),
    /// A bare commit id: its first 7 characters.
    Detached(String),
    /// Anything else (absent, unreadable, a ref outside `refs/heads/`).
    Unknown,
}

impl Head {
    /// The registry's `branch` field: a branch name, or `null`.
    pub fn branch(&self) -> Option<String> {
        match self {
            Head::Branch(b) => Some(b.clone()),
            _ => None,
        }
    }
}

/// A folder that is a linked worktree of another checkout.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Worktree {
    /// The main checkout's realpath (the parent of the common `.git` dir).
    pub main_root: PathBuf,
    pub head: Head,
}

/// `root` as a linked worktree of another checkout, or `None` (an ordinary
/// checkout, not a git folder, a broken or planted `.git` file).
///
/// All of these must hold, or it is not a worktree:
/// 1. `<root>/.git` is a regular file whose first line is `gitdir: <g>` (`<g>`
///    absolute, or relative to `root`), and `<g>` is a directory `…/worktrees/<name>`;
/// 2. `<g>/commondir` resolves to the directory that holds that `worktrees/`;
/// 3. **the back-reference**: `<g>/gitdir` names `<root>/.git` — the main repository
///    vouches for this folder (a planted `.git` file elsewhere fails here);
/// 4. the common dir is a `.git` directory inside a main checkout other than `root`
///    (a bare repository has no checkout to open).
pub fn worktree_of(root: &Path) -> Option<Worktree> {
    let dot_git = root.join(".git");
    if !std::fs::symlink_metadata(&dot_git).ok()?.file_type().is_file() {
        return None;
    }
    let pointer = read_small(&dot_git)?;
    let g_rel = pointer.lines().next()?.strip_prefix("gitdir:")?.trim();
    if g_rel.is_empty() {
        return None;
    }
    let g = std::fs::canonicalize(root.join(g_rel)).ok()?;
    if !g.is_dir() || g.parent()?.file_name()? != "worktrees" {
        return None;
    }
    let holder = g.parent()?.parent()?.to_path_buf();
    let common_rel = read_small(&g.join("commondir"))?;
    let common = std::fs::canonicalize(g.join(common_rel.lines().next()?.trim())).ok()?;
    if common != holder {
        return None;
    }
    let back_rel = read_small(&g.join("gitdir"))?;
    let back = std::fs::canonicalize(g.join(back_rel.lines().next()?.trim())).ok()?;
    if back != std::fs::canonicalize(&dot_git).ok()? {
        return None;
    }
    if common.file_name()? != ".git" || !std::fs::symlink_metadata(&common).ok()?.is_dir() {
        return None;
    }
    let main_root = common.parent()?.to_path_buf();
    if main_root == std::fs::canonicalize(root).ok()? {
        return None;
    }
    Some(Worktree {
        main_root,
        head: parse_head(read_small(&g.join("HEAD")).as_deref()),
    })
}

/// The branch an ORDINARY checkout (`.git` is a directory) is on — the registry's
/// `branch` for a project tab. A worktree reads its own HEAD through `worktree_of`.
pub fn branch_of(root: &Path) -> Option<String> {
    let dot_git = root.join(".git");
    if !std::fs::symlink_metadata(&dot_git).ok()?.is_dir() {
        return None;
    }
    parse_head(read_small(&dot_git.join("HEAD")).as_deref()).branch()
}

/// A git metadata file, capped at 4 KiB (they are one line; a huge one is not git's).
fn read_small(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut buf = String::new();
    std::fs::File::open(path)
        .ok()?
        .take(4096)
        .read_to_string(&mut buf)
        .ok()?;
    Some(buf)
}

fn parse_head(raw: Option<&str>) -> Head {
    let Some(line) = raw.and_then(|r| r.lines().next()).map(str::trim) else {
        return Head::Unknown;
    };
    if let Some(b) = line.strip_prefix("ref: refs/heads/") {
        let sane = !b.is_empty() && b.len() <= 255 && !b.chars().any(|c| c.is_control());
        return if sane { Head::Branch(b.to_string()) } else { Head::Unknown };
    }
    if (line.len() == 40 || line.len() == 64) && line.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Head::Detached(line[..7].to_ascii_lowercase());
    }
    Head::Unknown
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

    // ── #206 worktree detection ────────────────────────────────────────────────

    /// A scratch dir holding `main/` (a checkout with a `.git` DIR) and nothing else yet.
    fn git_scratch(tag: &str) -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("maude-206-wt-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let main = base.join("main");
        std::fs::create_dir_all(main.join(".git/worktrees")).unwrap();
        std::fs::write(main.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        (std::fs::canonicalize(&base).unwrap(), std::fs::canonicalize(&main).unwrap())
    }

    /// The files `git worktree add <wt>` writes, by hand: `<wt>/.git` (a file), and
    /// `<main>/.git/worktrees/<name>/{gitdir,commondir,HEAD}`.
    fn fake_worktree(main: &Path, wt: &Path, name: &str, head: &str) -> PathBuf {
        let g = main.join(".git/worktrees").join(name);
        std::fs::create_dir_all(&g).unwrap();
        std::fs::create_dir_all(wt).unwrap();
        std::fs::write(wt.join(".git"), format!("gitdir: {}\n", g.display())).unwrap();
        std::fs::write(g.join("gitdir"), format!("{}\n", wt.join(".git").display())).unwrap();
        std::fs::write(g.join("commondir"), "../..\n").unwrap();
        std::fs::write(g.join("HEAD"), head).unwrap();
        g
    }

    #[test]
    fn worktree_of_reads_a_dot_git_file_back_to_its_main_checkout() {
        let (base, main) = git_scratch("file");
        let wt = base.join("wt-feat");
        fake_worktree(&main, &wt, "wt-feat", "ref: refs/heads/feat-x\n");
        assert_eq!(
            worktree_of(&wt),
            Some(Worktree { main_root: main.clone(), head: Head::Branch("feat-x".into()) })
        );
        // A relative `gitdir:` (git ≥ 2.48 `worktree.useRelativePaths`) resolves from the worktree.
        std::fs::write(wt.join(".git"), "gitdir: ../main/.git/worktrees/wt-feat\n").unwrap();
        assert_eq!(worktree_of(&wt).map(|w| w.main_root), Some(main.clone()));
        // Detached: the short commit id.
        std::fs::write(
            main.join(".git/worktrees/wt-feat/HEAD"),
            "0123456789abcdef0123456789abcdef01234567\n",
        )
        .unwrap();
        assert_eq!(worktree_of(&wt).map(|w| w.head), Some(Head::Detached("0123456".into())));
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn worktree_of_an_ordinary_checkout_or_a_plain_folder_is_none() {
        let (base, main) = git_scratch("dir");
        assert_eq!(worktree_of(&main), None, "a .git DIRECTORY is an ordinary checkout");
        assert_eq!(branch_of(&main).as_deref(), Some("main"));
        let plain = base.join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        assert_eq!(worktree_of(&plain), None);
        assert_eq!(branch_of(&plain), None);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn worktree_of_refuses_a_broken_or_planted_gitdir() {
        let (base, main) = git_scratch("broken");
        let wt = base.join("wt");
        let g = fake_worktree(&main, &wt, "wt", "ref: refs/heads/feat\n");
        assert!(worktree_of(&wt).is_some(), "the fixture itself is a worktree");

        for content in [
            "gitdir: /definitely/not/here\n".to_string(),
            "not a gitdir line\n".to_string(),
            "gitdir: \n".to_string(),
            // A real git dir, but not a worktree entry (no `worktrees/<name>` parent).
            format!("gitdir: {}\n", main.join(".git").display()),
        ] {
            std::fs::write(wt.join(".git"), &content).unwrap();
            assert_eq!(worktree_of(&wt), None, "{content:?}");
        }

        // A PLANTED `.git` file: another folder claims the real worktree entry. The main
        // repository's `gitdir` back-reference names `wt`, not the impostor.
        std::fs::write(wt.join(".git"), format!("gitdir: {}\n", g.display())).unwrap();
        let impostor = base.join("downloaded");
        std::fs::create_dir_all(&impostor).unwrap();
        std::fs::write(impostor.join(".git"), format!("gitdir: {}\n", g.display())).unwrap();
        assert_eq!(worktree_of(&impostor), None, "the main repo never vouched for it");
        assert!(worktree_of(&wt).is_some());

        // `commondir` that names some other repository.
        std::fs::write(g.join("commondir"), "/tmp\n").unwrap();
        assert_eq!(worktree_of(&wt), None);
        std::fs::write(g.join("commondir"), "../..\n").unwrap();

        // A bare repository has no main checkout to open.
        let bare = base.join("bare.git");
        std::fs::create_dir_all(bare.join("worktrees/b")).unwrap();
        let wb = base.join("wb");
        std::fs::create_dir_all(&wb).unwrap();
        std::fs::write(wb.join(".git"), format!("gitdir: {}\n", bare.join("worktrees/b").display())).unwrap();
        std::fs::write(bare.join("worktrees/b/gitdir"), format!("{}\n", wb.join(".git").display())).unwrap();
        std::fs::write(bare.join("worktrees/b/commondir"), "../..\n").unwrap();
        assert_eq!(worktree_of(&wb), None, "a bare repo is not a project");
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn head_names_only_a_local_branch_with_sane_characters() {
        let (base, main) = git_scratch("head");
        let wt = base.join("wt");
        let g = fake_worktree(&main, &wt, "wt", "ref: refs/heads/feat/nested-1\n");
        assert_eq!(worktree_of(&wt).map(|w| w.head), Some(Head::Branch("feat/nested-1".into())));
        for head in ["ref: refs/remotes/origin/x\n", "ref: refs/heads/\n", "ref: refs/heads/a\u{7}b\n", "garbage\n"] {
            std::fs::write(g.join("HEAD"), head).unwrap();
            assert_eq!(worktree_of(&wt).map(|w| w.head), Some(Head::Unknown), "{head:?}");
        }
        std::fs::remove_dir_all(base).unwrap();
    }

    /// The layout real git writes (absolute or relative paths, whichever this git
    /// defaults to) — skipped when no `git` is on PATH. Isolated from the user's git
    /// config so no hook, signing or template runs.
    #[test]
    fn worktree_of_matches_a_real_git_worktree() {
        let raw = std::env::temp_dir().join(format!("maude-206-realgit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&raw);
        std::fs::create_dir_all(raw.join("main")).unwrap();
        let base = raw.canonicalize().unwrap();
        let main = base.join("main");
        let git = |dir: &Path, args: &[&str]| {
            // no-console-window: test-only, builds a real worktree fixture.
            std::process::Command::new("git")
                .current_dir(dir)
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .env("GIT_CONFIG_NOSYSTEM", "1")
                .env("HOME", &base)
                .args(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main"])
                .args(args)
                .output()
        };
        let Ok(out) = git(&main, &["init", "-q"]) else { return }; // no git on PATH
        assert!(out.status.success());
        assert!(git(&main, &["commit", "-q", "--allow-empty", "-m", "x"]).unwrap().status.success());
        let wt = base.join("wt");
        let out = git(&main, &["worktree", "add", "-q", "-b", "feat-real", wt.to_str().unwrap()]).unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(
            worktree_of(&wt),
            Some(Worktree { main_root: main.clone(), head: Head::Branch("feat-real".into()) })
        );
        assert_eq!(worktree_of(&main), None);
        assert_eq!(branch_of(&main).as_deref(), Some("main"));
        std::fs::remove_dir_all(base).unwrap();
    }
}
