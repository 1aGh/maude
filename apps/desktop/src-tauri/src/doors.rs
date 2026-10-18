//! S11.16 — the native doors: Reveal in Finder, Open in editor, Show logs in Finder.
//!
//! Three caller-checked commands, the same posture as `open_in_terminal`
//! (decision `v2-S11-native-doors`; a studio route that spawns processes was rejected):
//!
//!   - `project_reveal_path(rel)` — Finder opens the folder with the file selected.
//!   - `project_open_in_editor(rel)` — `$VISUAL`, else `$EDITOR`, else the default
//!     text editor. Never a shell: argv only.
//!   - `diagnostics_reveal_logs()` — the diagnostics log folder (`$MAUDE_LOG_DIR`, else
//!     `~/.maude/logs`, the folder `apps/studio/diagnostics/store.ts` writes).
//!
//! Who may call: a project tab on its own server's origin (`caller_project`), and only
//! the tab in front (`caller_in_front` — a background page may not pop Finder or an
//! editor over the tab the person is looking at). The path is the caller's OWN project:
//! `rel` is resolved under the root the book holds for the calling label, never a root
//! from an argument.
//!
//! Confinement (`confine`): `rel` is relative, has no `..`, no root and no NUL; the
//! joined path is canonicalized (every symlink resolved) and must still sit under the
//! canonical project root. A file that does not exist and a file outside the root get
//! the SAME answer, so a page cannot probe the disk outside its project.
//!
//! TOCTOU: we hand a path to another process, so no check can be atomic with its use.
//! What we pass is the CANONICAL path (no symlink left to swap), re-confirmed right
//! before the spawn (`reconfirm`). What stays is a swap of a directory on that path for
//! a symlink in the instant between the two — which needs a process already running as
//! this user with write access to the project, i.e. one that could open the file itself.
//! Sync never writes symlinks (it writes file bytes), so a peer cannot set that up.

use std::path::{Component, Path, PathBuf};
use std::process::Stdio;

use crate::windows;

/// One answer for "missing", "outside the project" and "not a path we take".
pub const NOT_IN_PROJECT: &str = "That file isn't in this project.";
/// Open in editor takes a file, not a folder.
pub const NOT_A_FILE: &str = "Open in editor opens a file, not a folder.";

/// `rel` under `root`, or `NOT_IN_PROJECT`. Pure but for the filesystem reads.
pub fn confine(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let refuse = || NOT_IN_PROJECT.to_string();
    if rel.is_empty() || rel.contains('\0') {
        return Err(refuse());
    }
    let p = Path::new(rel);
    if p.is_absolute()
        || p.components()
            .any(|c| matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_)))
    {
        return Err(refuse());
    }
    let root = std::fs::canonicalize(root).map_err(|_| refuse())?;
    let target = std::fs::canonicalize(root.join(p)).map_err(|_| refuse())?;
    if target.starts_with(&root) {
        Ok(target)
    } else {
        Err(refuse())
    }
}

/// Right before the spawn: the canonical target still resolves to itself (nothing on
/// the path became a symlink) and still sits under the root.
pub fn reconfirm(root: &Path, target: &Path) -> Result<(), String> {
    let root = std::fs::canonicalize(root).map_err(|_| NOT_IN_PROJECT.to_string())?;
    match std::fs::canonicalize(target) {
        Ok(t) if t == target && t.starts_with(&root) => Ok(()),
        _ => Err(NOT_IN_PROJECT.to_string()),
    }
}

/// Editors that need a terminal: launched from the app (no tty) they would hang or
/// exit at once, so the door opens the default text editor instead.
const TERMINAL_EDITORS: &[&str] = &[
    "vi", "vim", "nvim", "nano", "pico", "emacs", "ed", "ex", "micro", "hx", "helix", "kak",
    "joe", "mg", "jed", "ne",
];

/// Characters that only mean something to a shell (quotes, escapes, expansions,
/// redirections, separators). We never run a shell, and we do not emulate one: an
/// `$EDITOR` that needs any of these is not used.
const SHELL_CHARS: &[char] = &[
    '\'', '"', '\\', '`', '$', ';', '|', '&', '<', '>', '(', ')', '{', '}', '[', ']', '*', '?',
    '!', '~', '#', '\n', '\r',
];

/// The argv `$VISUAL` / `$EDITOR` names, without the file. `None` = use the default
/// text editor: neither is set, the first non-empty one holds a shell character (we
/// split on whitespace only and refuse what a split cannot mean), or it names a
/// terminal editor.
pub fn editor_argv(visual: Option<&str>, editor: Option<&str>) -> Option<Vec<String>> {
    let spec = [visual, editor]
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|s| !s.is_empty())?;
    if spec.contains(SHELL_CHARS) {
        return None;
    }
    let argv: Vec<String> = spec.split_whitespace().map(str::to_string).collect();
    let prog = Path::new(argv.first()?)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if TERMINAL_EDITORS.contains(&prog.as_str()) {
        return None;
    }
    Some(argv)
}

/// The default text editor for `path` — never "the default app", which for a
/// `.command` / `.app` / script would RUN it.
pub fn default_editor_argv(path: &Path) -> Vec<String> {
    let p = path.to_string_lossy().into_owned();
    if cfg!(target_os = "macos") {
        vec!["open".into(), "-t".into(), p]
    } else if cfg!(target_os = "windows") {
        vec!["notepad.exe".into(), p]
    } else {
        vec!["xdg-open".into(), p]
    }
}

/// Finder (Explorer, the file manager) showing `path` selected. `-R` reveals and
/// never opens, so a bundle or a script is selected, not launched.
pub fn reveal_argv(path: &Path) -> Vec<String> {
    let p = path.to_string_lossy().into_owned();
    if cfg!(target_os = "macos") {
        vec!["open".into(), "-R".into(), p]
    } else if cfg!(target_os = "windows") {
        vec!["explorer.exe".into(), format!("/select,{p}")]
    } else {
        let dir = path.parent().unwrap_or(path).to_string_lossy().into_owned();
        vec!["xdg-open".into(), dir]
    }
}

/// A folder in the file manager — `-a Finder`, so a folder named like a bundle is
/// shown, never launched.
pub fn folder_argv(dir: &Path) -> Vec<String> {
    let d = dir.to_string_lossy().into_owned();
    if cfg!(target_os = "macos") {
        vec!["open".into(), "-a".into(), "Finder".into(), d]
    } else if cfg!(target_os = "windows") {
        vec!["explorer.exe".into(), d]
    } else {
        vec!["xdg-open".into(), d]
    }
}

/// Where the diagnostics logs live: `$MAUDE_LOG_DIR`, else `<home>/.maude/logs`
/// (mirrors `apps/studio/diagnostics/store.ts`).
pub fn log_dir(env: Option<&str>, home: &Path) -> PathBuf {
    match env.filter(|s| !s.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => home.join(".maude").join("logs"),
    }
}

/// Start `argv` detached (no stdin/stdout/stderr, never a shell) and reap it on a
/// thread so it leaves no zombie.
fn spawn(argv: &[String]) -> std::io::Result<()> {
    let (prog, args) = argv
        .split_first()
        .ok_or_else(|| std::io::Error::other("empty argv"))?;
    let mut child = crate::win_process::hidden_command(prog)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

fn spawn_or_say(argv: &[String], what: &str) -> Result<(), String> {
    spawn(argv).map_err(|e| {
        crate::sidecar::log_line(&format!("[maude] {what}: {e}"));
        format!("Couldn't {what}.")
    })
}

/// `project_reveal_path({rel})` — Finder opens the folder with `rel` selected.
#[tauri::command]
pub async fn project_reveal_path(webview: tauri::Webview, rel: String) -> Result<(), String> {
    let caller = windows::caller_project(&webview, false)?;
    windows::caller_in_front(&webview)?;
    let root = Path::new(&caller.root);
    let target = confine(root, &rel)?;
    reconfirm(root, &target)?;
    spawn_or_say(&reveal_argv(&target), "show it in Finder")
}

/// `project_open_in_editor({rel})` — `$VISUAL` / `$EDITOR` (argv, never a shell), else
/// the default text editor. An editor that fails to start falls back to the default.
#[tauri::command]
pub async fn project_open_in_editor(webview: tauri::Webview, rel: String) -> Result<(), String> {
    let caller = windows::caller_project(&webview, false)?;
    windows::caller_in_front(&webview)?;
    let root = Path::new(&caller.root);
    let target = confine(root, &rel)?;
    if !target.is_file() {
        return Err(NOT_A_FILE.to_string());
    }
    reconfirm(root, &target)?;
    let visual = std::env::var("VISUAL").ok();
    let editor = std::env::var("EDITOR").ok();
    if let Some(mut argv) = editor_argv(visual.as_deref(), editor.as_deref()) {
        argv.push(target.to_string_lossy().into_owned());
        match spawn(&argv) {
            Ok(()) => return Ok(()),
            Err(e) => crate::sidecar::log_line(&format!(
                "[maude] $VISUAL/$EDITOR did not start ({e}); opening the default text editor"
            )),
        }
    }
    spawn_or_say(&default_editor_argv(&target), "open it in an editor")
}

/// `diagnostics_reveal_logs()` — the diagnostics log folder in Finder. No argument:
/// the folder is fixed by this process's own environment, never by the page.
#[tauri::command]
pub async fn diagnostics_reveal_logs(webview: tauri::Webview) -> Result<(), String> {
    windows::caller_project(&webview, false)?;
    windows::caller_in_front(&webview)?;
    let home = tauri::Manager::path(&webview)
        .home_dir()
        .map_err(|_| "Couldn't find the log folder.".to_string())?;
    let dir = log_dir(std::env::var("MAUDE_LOG_DIR").ok().as_deref(), &home);
    std::fs::create_dir_all(&dir).map_err(|_| "Couldn't find the log folder.".to_string())?;
    spawn_or_say(&folder_argv(&dir), "show the logs in Finder")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::windows::{check_caller, front_only, Role, WindowBook};

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "maude-doors-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// `<base>/proj/.design/ui/a.tsx` + `<base>/outside/secret.txt`.
    fn fixture(tag: &str) -> (PathBuf, PathBuf) {
        let base = scratch(tag);
        let proj = base.join("proj");
        std::fs::create_dir_all(proj.join(".design/ui")).unwrap();
        std::fs::write(proj.join(".design/ui/a.tsx"), "x").unwrap();
        std::fs::create_dir_all(base.join("outside")).unwrap();
        std::fs::write(base.join("outside/secret.txt"), "s").unwrap();
        (base, proj)
    }

    #[test]
    fn confine_takes_a_file_inside_the_project() {
        let (base, proj) = fixture("ok");
        let got = confine(&proj, ".design/ui/a.tsx").unwrap();
        assert_eq!(got, std::fs::canonicalize(proj.join(".design/ui/a.tsx")).unwrap());
        // A `.` segment is harmless; a folder is a path too (reveal takes it).
        assert!(confine(&proj, "./.design/ui").is_ok());
        assert!(reconfirm(&proj, &got).is_ok());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn confine_refuses_traversal_absolute_and_odd_paths_with_one_answer() {
        let (base, proj) = fixture("trav");
        let outside_abs = base.join("outside/secret.txt");
        for rel in [
            "../outside/secret.txt",
            ".design/../../outside/secret.txt",
            ".design/ui/../../..",
            "..",
            "",
            "a\0b",
            outside_abs.to_str().unwrap(),
            "/etc/hosts",
        ] {
            assert_eq!(confine(&proj, rel), Err(NOT_IN_PROJECT.to_string()), "{rel:?}");
        }
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn missing_and_out_of_root_get_the_same_answer() {
        let (base, proj) = fixture("miss");
        let missing = confine(&proj, ".design/ui/nope.tsx");
        let out = confine(&proj, "../outside/secret.txt");
        assert_eq!(missing, out);
        assert_eq!(missing, Err(NOT_IN_PROJECT.to_string()));
        let _ = std::fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_root_is_refused_and_one_inside_is_taken() {
        let (base, proj) = fixture("link");
        let ui = proj.join(".design/ui");
        std::os::unix::fs::symlink(base.join("outside/secret.txt"), ui.join("leak.tsx")).unwrap();
        std::os::unix::fs::symlink(base.join("outside"), ui.join("leakdir")).unwrap();
        std::os::unix::fs::symlink(ui.join("a.tsx"), ui.join("alias.tsx")).unwrap();
        assert_eq!(confine(&proj, ".design/ui/leak.tsx"), Err(NOT_IN_PROJECT.to_string()));
        assert_eq!(
            confine(&proj, ".design/ui/leakdir/secret.txt"),
            Err(NOT_IN_PROJECT.to_string())
        );
        assert_eq!(confine(&proj, ".design/ui/leakdir"), Err(NOT_IN_PROJECT.to_string()));
        // A link that stays inside resolves to its target, which is inside.
        assert_eq!(
            confine(&proj, ".design/ui/alias.tsx").unwrap(),
            std::fs::canonicalize(ui.join("a.tsx")).unwrap()
        );
        // A root reached through a symlink still confines to where it really is.
        let via = base.join("via");
        std::os::unix::fs::symlink(&proj, &via).unwrap();
        assert!(confine(&via, ".design/ui/a.tsx").is_ok());
        assert_eq!(confine(&via, "../outside/secret.txt"), Err(NOT_IN_PROJECT.to_string()));
        let _ = std::fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[test]
    fn reconfirm_refuses_a_path_that_became_a_symlink_after_the_check() {
        let (base, proj) = fixture("toctou");
        let ui = proj.join(".design/ui");
        let target = confine(&proj, ".design/ui/a.tsx").unwrap();
        // Between the check and the spawn the folder is swapped for a link out.
        std::fs::rename(&ui, proj.join(".design/ui-old")).unwrap();
        std::fs::create_dir_all(base.join("outside/ui")).unwrap();
        std::fs::write(base.join("outside/ui/a.tsx"), "evil").unwrap();
        std::os::unix::fs::symlink(base.join("outside/ui"), &ui).unwrap();
        assert_eq!(reconfirm(&proj, &target), Err(NOT_IN_PROJECT.to_string()));
        let _ = std::fs::remove_dir_all(base);
    }

    /// The command's own sequence — caller (label + origin), front, confine — on a
    /// book: a label the book does not know, Home, another project's tab and a tab
    /// off its own origin are refused before any path is looked at.
    #[test]
    fn a_caller_that_is_not_that_projects_tab_is_refused() {
        let (base, proj) = fixture("caller");
        let other = base.join("outside");
        let root = proj.to_string_lossy().into_owned();
        let mut book = WindowBook::default();
        book.insert("p-a", Role::Project { pid: "la".into(), root: root.clone() }, 0);
        book.set_origin("p-a", "http://localhost:4401");
        book.insert(
            "p-b",
            Role::Project { pid: "lb".into(), root: other.to_string_lossy().into_owned() },
            1,
        );
        book.set_origin("p-b", "http://localhost:4402");
        book.focus("p-a", 2);
        let url = |s: &str| s.parse::<tauri::Url>().unwrap();
        let door = |label: &str, at: &str, rel: &str| -> Result<PathBuf, String> {
            let c = check_caller(&book, label, Some(&url(at)), false)?;
            front_only(&book, label)?;
            confine(Path::new(&c.root), rel)
        };
        assert!(door("p-a", "http://localhost:4401/", ".design/ui/a.tsx").is_ok());
        // A label the shell did not create, Home, the canvas origin, another server.
        assert!(door("p-zzz", "http://localhost:4401/", ".design/ui/a.tsx").is_err());
        assert!(door("home", "http://localhost:4401/", ".design/ui/a.tsx").is_err());
        assert!(door("p-a", "http://localhost:4499/", ".design/ui/a.tsx").is_err());
        assert!(door("p-a", "http://localhost:4402/", ".design/ui/a.tsx").is_err());
        // Another project's tab resolves rel under ITS root, never A's — and it is
        // not in front, so it does not get that far either.
        assert_eq!(
            door("p-b", "http://localhost:4402/", "secret.txt"),
            Err("Switch to this tab first.".to_string())
        );
        let _ = std::fs::remove_dir_all(base);
    }

    /// Source ratchet: each door checks its caller and the front tab before it
    /// touches a path, and spawns argv only.
    #[test]
    fn each_door_checks_caller_and_front_first_and_never_runs_a_shell() {
        let src = include_str!("doors.rs");
        for cmd in ["project_reveal_path", "project_open_in_editor", "diagnostics_reveal_logs"] {
            let start = src.find(&format!("pub async fn {cmd}(")).unwrap();
            let body = &src[start..];
            let body = &body[..body[1..].find("#[tauri::command]").map_or(body.len(), |e| e + 1)];
            let c = body.find("windows::caller_project(&webview, false)?").unwrap();
            let f = body.find("windows::caller_in_front(&webview)?").unwrap();
            assert!(c < f, "{cmd}: caller before front");
            if let Some(p) = body.find("confine(") {
                assert!(f < p, "{cmd}: front before the path");
                assert!(body.contains("reconfirm("), "{cmd}: re-confirm before the spawn");
            }
        }
        let code = &src[..src.find("#[cfg(test)]").unwrap()];
        for shell in ["\"sh\"", "\"bash\"", "\"zsh\"", "\"-c\"", "cmd.exe", "\"/C\""] {
            assert!(!code.contains(shell), "a door must never run a shell ({shell})");
        }
    }

    #[test]
    fn editor_is_split_on_whitespace_or_refused_never_shell_parsed() {
        assert_eq!(editor_argv(None, None), None);
        assert_eq!(editor_argv(Some(""), Some("  ")), None);
        assert_eq!(editor_argv(None, Some("code")), Some(vec!["code".to_string()]));
        // $VISUAL wins over $EDITOR; an empty $VISUAL does not.
        assert_eq!(
            editor_argv(Some("subl -w"), Some("code")),
            Some(vec!["subl".to_string(), "-w".to_string()])
        );
        assert_eq!(editor_argv(Some(" "), Some("zed")), Some(vec!["zed".to_string()]));
        assert_eq!(
            editor_argv(None, Some("/usr/local/bin/code   --wait")),
            Some(vec!["/usr/local/bin/code".to_string(), "--wait".to_string()])
        );
        // Anything only a shell could mean → the default editor, never a shell.
        for spec in [
            "code; rm -rf ~",
            "code && x",
            "code | tee",
            "\"/Applications/My Editor.app/x\"",
            "'code'",
            "code $(whoami)",
            "code `id`",
            "code > /tmp/x",
            "code\nrm",
            "~/bin/ed2",
            "a\\ b",
        ] {
            assert_eq!(editor_argv(None, Some(spec)), None, "{spec:?}");
        }
        // Terminal editors need a tty the app does not have.
        for spec in ["vim", "/usr/bin/nvim", "nano -w", "emacs"] {
            assert_eq!(editor_argv(Some(spec), None), None, "{spec:?}");
        }
    }

    #[test]
    fn the_default_editor_and_reveal_never_launch_the_file() {
        let p = Path::new("/p/run.command");
        let ed = default_editor_argv(p);
        let rv = reveal_argv(p);
        let fo = folder_argv(Path::new("/l/Logs.app"));
        assert_eq!(ed.last().map(String::as_str), Some("/p/run.command"));
        if cfg!(target_os = "macos") {
            assert_eq!(ed, ["open", "-t", "/p/run.command"]);
            assert_eq!(rv, ["open", "-R", "/p/run.command"]);
            assert_eq!(fo, ["open", "-a", "Finder", "/l/Logs.app"]);
        }
    }

    #[test]
    fn the_log_folder_is_the_studios() {
        let home = Path::new("/Users/x");
        assert_eq!(log_dir(None, home), PathBuf::from("/Users/x/.maude/logs"));
        assert_eq!(log_dir(Some(""), home), PathBuf::from("/Users/x/.maude/logs"));
        assert_eq!(log_dir(Some("/tmp/l"), home), PathBuf::from("/tmp/l"));
        let store = include_str!("../../../studio/diagnostics/store.ts");
        assert!(store.contains("process.env.MAUDE_LOG_DIR || join(homedir(), '.maude', 'logs')"));
    }
}
