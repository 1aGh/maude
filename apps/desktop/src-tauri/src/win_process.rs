//! Windows process hygiene for the shell (issue #141).
//!
//! Two things that are invisible on macOS and broke the Windows app:
//!
//! 1. The release shell is `windows_subsystem = "windows"` (main.rs) — it has
//!    no console. Every console program it starts (`curl.exe`) therefore gets a
//!    NEW, visible console window, which flashes open and shut. The activity
//!    poller ran one every 6 s. [`hidden_command`] sets `CREATE_NO_WINDOW`.
//!    (The sidecar itself is fine: tauri-plugin-shell sets the flag for it.)
//!
//! 2. Tauri derives `resource_dir()` from a `std::fs::canonicalize`d exe path,
//!    which on Windows is a verbatim path (`\\?\C:\…`). Exported to the sidecar
//!    as `MAUDE_DEV_SERVER_ROOT`, it reached the ACP adapter's entry path, and
//!    `node \\?\C:\…\index.js` dies with `EISDIR: lstat 'C:'` (nodejs/node#62446)
//!    — the Assistant never started for anyone with Node installed.
//!    [`strip_verbatim`] turns it back into an ordinary path.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;

/// A `std::process::Command` that never opens a console window on Windows.
/// Use this for every child the shell spawns directly; the guard test below
/// fails on any other direct spawn in `src/`.
pub(crate) fn hidden_command<S: AsRef<OsStr>>(program: S) -> Command {
    // no-console-window: this IS the helper.
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// `\\?\C:\x` → `C:\x`, `\\?\UNC\srv\share\x` → `\\srv\share\x`; anything else
/// unchanged. Only the two forms that have an ordinary equivalent are rewritten
/// (`\\?\Volume{…}` has none and is left alone).
pub(crate) fn strip_verbatim(path: &Path) -> PathBuf {
    match strip_verbatim_str(&path.to_string_lossy()) {
        Some(s) => PathBuf::from(s),
        None => path.to_path_buf(),
    }
}

fn strip_verbatim_str(s: &str) -> Option<String> {
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return Some(format!(r"\\{rest}"));
    }
    let rest = s.strip_prefix(r"\\?\")?;
    let b = rest.as_bytes();
    let is_drive = b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':';
    is_drive.then(|| rest.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_drive_verbatim_prefix() {
        assert_eq!(
            strip_verbatim_str(r"\\?\C:\Program Files\Maude\resources\apps\studio").as_deref(),
            Some(r"C:\Program Files\Maude\resources\apps\studio")
        );
    }

    #[test]
    fn strips_unc_verbatim_prefix() {
        assert_eq!(
            strip_verbatim_str(r"\\?\UNC\srv\share\Maude").as_deref(),
            Some(r"\\srv\share\Maude")
        );
    }

    #[test]
    fn leaves_ordinary_and_volume_paths_alone() {
        assert_eq!(strip_verbatim_str(r"C:\Program Files\Maude"), None);
        assert_eq!(
            strip_verbatim_str("/Applications/Maude.app/Contents/Resources"),
            None
        );
        assert_eq!(strip_verbatim_str(r"\\?\Volume{1234}\Maude"), None);
        assert_eq!(strip_verbatim_str(r"\\srv\share"), None);
        let p = Path::new("/Applications/Maude.app");
        assert_eq!(strip_verbatim(p), p.to_path_buf());
    }

    /// The flash in #141 could not turn a Mac test red, so pin the rule
    /// structurally: every direct spawn in the shell goes through
    /// `hidden_command`, or says on the line (or the three above) why it may not
    /// — `no-console-window: <reason>` (unix-only, test-only).
    #[test]
    fn every_spawn_is_hidden_or_justified() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut offenders = Vec::new();
        for entry in std::fs::read_dir(&src).expect("read src/") {
            let path = entry.expect("dir entry").path();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let text = std::fs::read_to_string(&path).expect("read source");
            let lines: Vec<&str> = text.lines().collect();
            for (i, line) in lines.iter().enumerate() {
                if !line.contains(concat!("Command", "::new(")) {
                    continue;
                }
                let from = i.saturating_sub(3);
                if !lines[from..=i]
                    .iter()
                    .any(|l| l.contains("no-console-window:"))
                {
                    offenders.push(format!("{}:{}", path.display(), i + 1));
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "use win_process::hidden_command (or justify with `no-console-window:`): {offenders:?}"
        );
    }
}
