// windows.rs — project/window IDENTITY helpers (V2-1.1 home-window contract §5.2).
//
// V2-3.1 lands only the pure derivations every other piece keys on: the project id
// (`pid`) the app-state registry is keyed by, the window label a project's tab will
// carry, and the per-window WebKit data-store id. V2-3.2 extends this file with the
// real window model (labels on live windows, focus, rest policy); nothing here
// touches a window yet.
//
// PARITY IS LOAD-BEARING. The same `pid` is derived in TS
// (`apps/studio/index/snapshot.ts` `pidOf`, and `apps/studio/home/pid.ts`): the
// Home server indexes `index/v1/projects/<pid>/` under it and the shell's registry
// is keyed by it, so a one-character drift silently splits one project into two.
// The vectors in the tests below are the TS outputs, pinned on both sides.

use sha2::{Digest, Sha256};

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The realpath string TS's `realpathSync` would produce, or `None` when the path
/// cannot be resolved (gone, permission) — the caller then hashes the input as
/// given, exactly like `pidOf`'s `catch`.
fn realpath_string(root: &str) -> Option<String> {
    let real = std::fs::canonicalize(root).ok()?;
    // `canonicalize` returns a verbatim `\\?\C:\…` path on Windows where Node's
    // `realpathSync` returns `C:\…`; hash the ordinary form or every Windows pid
    // would disagree with the server's (#141 is the same verbatim-path class).
    Some(
        crate::win_process::strip_verbatim(&real)
            .to_string_lossy()
            .into_owned(),
    )
}

/// `pid = "l" + hex(sha256(realpath(root)))[0..16]` — a project on THIS Mac (a
/// managed cloud copy too: its root is under app data). When realpath fails the
/// string is hashed as given, so a vanished root keeps the pid it was registered
/// under (contract §5.5: vanished entries are kept, not re-keyed).
pub fn pid_for_root(root: &str) -> String {
    let subject = realpath_string(root).unwrap_or_else(|| root.to_string());
    format!("l{}", &sha256_hex(subject.as_bytes())[..16])
}

/// A project window's label: `p-<pid>` (contract regex `^p-l[0-9a-f]{16}$`).
/// Labels never change for the life of a window.
pub fn label_for_pid(pid: &str) -> String {
    format!("p-{pid}")
}

/// `sha256("maude-window:" + label)[0..16]` — the WKWebView data-store identifier
/// (macOS ≥ 14) that gives each window its own cookie/localStorage jar. Derived
/// from the LABEL, not the root, so Home (`home`) gets a stable store too.
#[allow(dead_code)] // first caller: V2-3.2's window builder
pub fn data_store_id_for_label(label: &str) -> [u8; 16] {
    let digest = Sha256::digest(format!("maude-window:{label}").as_bytes());
    let mut out = [0u8; 16];
    out.copy_from_slice(&digest[..16]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn pid_parity_vector_for_a_path_that_does_not_exist() {
        // Nonexistent ⇒ realpath fails ⇒ hashed as given. Same value TS pidOf prints.
        assert_eq!(
            pid_for_root("/Users/x/Maude/alligators"),
            "l6ff9cde02f1b516d"
        );
    }

    #[test]
    fn pid_hashes_the_realpath_when_the_root_exists() {
        let dir = std::env::temp_dir().join(format!("maude-pid-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let real = std::fs::canonicalize(&dir).unwrap();
        let expected = format!("l{}", &sha256_hex(real.to_string_lossy().as_bytes())[..16]);
        // A trailing `/.` resolves to the same realpath → the same pid.
        let dotted = format!("{}/.", dir.to_string_lossy());
        assert_eq!(pid_for_root(&dotted), expected);
        assert_eq!(pid_for_root(&dir.to_string_lossy()), expected);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn labels_and_data_store_ids() {
        let pid = pid_for_root("/Users/x/Maude/alligators");
        let label = label_for_pid(&pid);
        assert_eq!(label, "p-l6ff9cde02f1b516d");
        assert_eq!(label.len(), 19);
        assert_eq!(
            hex(&data_store_id_for_label("home")),
            "98df3f4077c6a139537de9d66d4c18fd"
        );
        assert_ne!(
            data_store_id_for_label(&label),
            data_store_id_for_label("home")
        );
    }
}
