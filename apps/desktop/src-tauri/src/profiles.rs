// profiles.rs — identity PROFILES: which GitHub / Maude Cloud account a project
// talks as (V2-3.1; plan feature-desktop-project-tabs-and-identity-profiles T1,
// contract V2-1.1 §5.5 `profile`).
//
// A profile is a named slot for credentials. `default` IS today's install — the
// legacy files (`~/.config/maude/cloud.json`, `hubs.json`) and the legacy keychain
// account `maude-github-token` — so every existing user migrates with zero change.
// Any other profile owns `<config>/maude/profiles/<id>/{cloud.json,hubs.json}` and
// keychain account `maude-github-token:<id>`.
//
// Registry: `<config>/maude/profiles.json` = `{ "profiles": [...], "default": "default" }`.
// It holds labels and public handles only — the GitHub token is never here, never on
// disk at all (DDR-108 / DDR-132: OS keychain only).
//
// THE ID IS A PATH SEGMENT AND A KEYCHAIN ACCOUNT SUFFIX. It reaches us from the
// webview (`profiles_delete`, `github_*`), so every entry point runs
// `validate_id` — `[a-z0-9-]{1,32}` — before the id touches a path or the keychain.
// `../x` must never become `profiles/../x/cloud.json`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

pub const DEFAULT_ID: &str = "default";
const DEFAULT_LABEL: &str = "Default";
/// The legacy keychain account (keychain.rs, DDR-108) — `default` keeps it verbatim.
pub const LEGACY_KEYCHAIN_ACCOUNT: &str = "maude-github-token";
const MAX_ID_LEN: usize = 32;
const MAX_LABEL_LEN: usize = 64;

/// Serialises read-modify-write of `profiles.json` within this process. Cross-
/// process writers (none today — only the shell writes it) would still be safe
/// against torn files thanks to the atomic rename, at worst losing one create.
static REGISTRY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_login: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloud_email: Option<String>,
    #[serde(default)]
    pub created_at: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct Registry {
    #[serde(default)]
    profiles: Vec<Profile>,
    #[serde(default = "default_id")]
    default: String,
}

fn default_id() -> String {
    DEFAULT_ID.to_string()
}

impl Default for Registry {
    fn default() -> Self {
        Registry {
            profiles: Vec::new(),
            default: default_id(),
        }
    }
}

/// Where a profile's server-side config files live. Handed to the sidecar as
/// `MAUDE_CLOUD_CONFIG` / `HUBS_CONFIG_PATH` for non-default profiles (sidecar.rs).
#[derive(Clone, Debug, PartialEq)]
pub struct ProfilePaths {
    pub cloud_config: PathBuf,
    pub hubs_config: PathBuf,
}

/// `[a-z0-9-]{1,32}`. Refuses everything else — empty, `..`, `/`, uppercase,
/// whitespace, 33+ chars — so an id is always a single safe path segment.
pub fn validate_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if ok {
        Ok(())
    } else {
        Err("That account profile id isn't valid.".to_string())
    }
}

/// `$XDG_CONFIG_HOME/maude`, else `$HOME/.config/maude` — EXACTLY the rule
/// `apps/studio/sync/hubs-config.ts` `hubsConfigPath` uses (an empty
/// XDG_CONFIG_HOME counts as unset), or the shell and the server would disagree on
/// where `hubs.json` lives.
fn config_root_from(xdg: Option<String>, home: &Path) -> PathBuf {
    match xdg {
        Some(x) if !x.is_empty() => PathBuf::from(x).join("maude"),
        _ => home.join(".config").join("maude"),
    }
}

/// Node's `os.homedir()`: `$HOME` on unix, `%USERPROFILE%` on Windows.
fn home_dir() -> PathBuf {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn config_root() -> PathBuf {
    config_root_from(std::env::var("XDG_CONFIG_HOME").ok(), &home_dir())
}

/// Path mapping, with the roots passed in so it is testable without touching the
/// process env. `default` returns the LEGACY paths unchanged:
/// - `hubs.json` under the XDG-aware root (hubs-config.ts),
/// - `cloud.json` under `$HOME/.config/maude` — `cloud/endpoints.ts` and
///   `cloud/renew.ts` do NOT honour XDG_CONFIG_HOME, and `default` must keep
///   pointing at the file the server already reads.
fn paths_in(id: &str, config_root: &Path, home: &Path) -> Result<ProfilePaths, String> {
    validate_id(id)?;
    if id == DEFAULT_ID {
        return Ok(ProfilePaths {
            cloud_config: home.join(".config").join("maude").join("cloud.json"),
            hubs_config: config_root.join("hubs.json"),
        });
    }
    let dir = config_root.join("profiles").join(id);
    Ok(ProfilePaths {
        cloud_config: dir.join("cloud.json"),
        hubs_config: dir.join("hubs.json"),
    })
}

pub fn paths(id: &str) -> Result<ProfilePaths, String> {
    paths_in(id, &config_root(), &home_dir())
}

/// `default` → `maude-github-token` (legacy, unchanged); other → `maude-github-token:<id>`.
pub fn keychain_account(id: &str) -> Result<String, String> {
    validate_id(id)?;
    Ok(if id == DEFAULT_ID {
        LEGACY_KEYCHAIN_ACCOUNT.to_string()
    } else {
        format!("{LEGACY_KEYCHAIN_ACCOUNT}:{id}")
    })
}

// ── atomic file IO (shared with app_state.rs) ───────────────────────────────

/// Create `dir` (and parents) owner-only (0700 on unix).
pub(crate) fn ensure_private_dir(dir: &Path) -> std::io::Result<()> {
    let mut b = std::fs::DirBuilder::new();
    b.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        b.mode(0o700);
    }
    b.create(dir)
}

/// Write `bytes` to `path` via tmp + rename, file mode 0600 — a crash mid-write
/// leaves the old file intact, never a torn one (pattern: `sync/hub-link.ts`).
pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let dir = path
        .parent()
        .ok_or_else(|| std::io::Error::other("path has no parent"))?;
    ensure_private_dir(dir)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(".{name}.tmp-{}-{nanos}", std::process::id()));
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let result = (|| {
        let mut f = opts.open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ── registry ────────────────────────────────────────────────────────────────

fn load_registry(file: &Path) -> Registry {
    let mut reg: Registry = std::fs::read(file)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    // A hand-edited or older file must not smuggle an invalid id past
    // `validate_id` just because it came from disk rather than the webview.
    reg.profiles.retain(|p| validate_id(&p.id).is_ok());
    // `default` always exists, even before profiles.json does.
    if !reg.profiles.iter().any(|p| p.id == DEFAULT_ID) {
        reg.profiles.insert(
            0,
            Profile {
                id: DEFAULT_ID.to_string(),
                label: DEFAULT_LABEL.to_string(),
                github_login: None,
                cloud_email: None,
                created_at: 0,
            },
        );
    }
    reg
}

fn save_registry(file: &Path, reg: &Registry) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(reg).map_err(|e| e.to_string())?;
    atomic_write(file, &json).map_err(|e| format!("Couldn't save account profiles: {e}"))
}

fn clean_label(label: &str) -> Result<String, String> {
    let cleaned: String = label
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .chars()
        .take(MAX_LABEL_LEN)
        .collect();
    if cleaned.is_empty() {
        Err("Give the account a name.".to_string())
    } else {
        Ok(cleaned)
    }
}

/// `[a-z0-9-]` slug of the label, never `default`, deduplicated with `-2`, `-3`…
fn derive_id(label: &str, taken: &[String]) -> String {
    let mut slug = String::new();
    for c in label.chars().flat_map(|c| c.to_lowercase()) {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
    }
    let mut base: String = slug.trim_matches('-').chars().take(24).collect();
    base = base.trim_end_matches('-').to_string();
    if base.is_empty() || base == DEFAULT_ID {
        base = "profile".to_string();
    }
    if !taken.iter().any(|t| t == &base) {
        return base;
    }
    (2u32..)
        .map(|n| format!("{base}-{n}"))
        .find(|cand| !taken.iter().any(|t| t == cand))
        .expect("an unbounded counter always finds a free id")
}

fn list_in(file: &Path) -> Vec<Profile> {
    load_registry(file).profiles
}

fn create_in(file: &Path, label: &str) -> Result<Profile, String> {
    let label = clean_label(label)?;
    let _guard = REGISTRY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut reg = load_registry(file);
    let taken: Vec<String> = reg.profiles.iter().map(|p| p.id.clone()).collect();
    let id = derive_id(&label, &taken);
    validate_id(&id)?;
    let profile = Profile {
        id,
        label,
        github_login: None,
        cloud_email: None,
        created_at: now_ms(),
    };
    reg.profiles.push(profile.clone());
    save_registry(file, &reg)?;
    Ok(profile)
}

/// Remove `id` from the registry. Refuses `default` and any id `is_bound` reports
/// as still bound to a project — deleting it would silently drop that project
/// back to `default` and talk to the wrong account.
fn delete_in(file: &Path, id: &str, is_bound: impl Fn(&str) -> bool) -> Result<(), String> {
    validate_id(id)?;
    if id == DEFAULT_ID {
        return Err("The default account can't be removed.".to_string());
    }
    if is_bound(id) {
        return Err(
            "A project still uses this account. Switch that project to another account first."
                .to_string(),
        );
    }
    let _guard = REGISTRY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut reg = load_registry(file);
    let before = reg.profiles.len();
    reg.profiles.retain(|p| p.id != id);
    if reg.profiles.len() == before {
        return Err("That account profile doesn't exist.".to_string());
    }
    save_registry(file, &reg)
}

fn registry_file() -> PathBuf {
    config_root().join("profiles.json")
}

pub fn exists(id: &str) -> bool {
    validate_id(id).is_ok() && list_in(&registry_file()).iter().any(|p| p.id == id)
}

/// The profile's display label (`MAUDE_PROFILE_LABEL`); falls back to the id.
pub fn label_of(id: &str) -> String {
    list_in(&registry_file())
        .into_iter()
        .find(|p| p.id == id)
        .map(|p| p.label)
        .unwrap_or_else(|| id.to_string())
}

/// Record the public GitHub handle on the profile after sign-in (oauth.rs).
/// Best-effort: the handle is display-only; the token itself is keychain-only.
pub fn set_github_login(id: &str, login: &str) {
    if validate_id(id).is_err() {
        return;
    }
    let file = registry_file();
    let _guard = REGISTRY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut reg = load_registry(&file);
    if let Some(p) = reg.profiles.iter_mut().find(|p| p.id == id) {
        p.github_login = Some(crate::notify::sanitize_notify_field(login));
        let _ = save_registry(&file, &reg);
    }
}

// ── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn profiles_list() -> Vec<Profile> {
    list_in(&registry_file())
}

#[tauri::command]
pub fn profiles_create(label: String) -> Result<Profile, String> {
    create_in(&registry_file(), &label)
}

/// `async`: it also clears the profile's keychain slot, and a keychain call can
/// park on a macOS access prompt (see keychain.rs `github_is_signed_in`).
#[tauri::command]
pub async fn profiles_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    delete_in(&registry_file(), &id, |pid| {
        crate::app_state::is_profile_bound(&app, pid)
    })?;
    // A removed profile must not leave a live token behind in the keychain.
    let _ = crate::keychain::delete_token(&id);
    if let Ok(p) = paths(&id) {
        let _ = std::fs::remove_file(&p.cloud_config);
        let _ = std::fs::remove_file(&p.hubs_config);
        // Non-recursive on purpose: only our own two files are ours to delete.
        if let Some(dir) = p.cloud_config.parent() {
            let _ = std::fs::remove_dir(dir);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "maude-profiles-{tag}-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn profile_ids_are_validated() {
        for bad in [
            "../x",
            "",
            &"a".repeat(33),
            "Work",
            "a/b",
            "a b",
            "..",
            "a.b",
            "a\0b",
            "é",
        ] {
            assert!(validate_id(bad).is_err(), "{bad:?} must be refused");
            assert!(paths(bad).is_err(), "{bad:?} must not map to a path");
            assert!(
                keychain_account(bad).is_err(),
                "{bad:?} must not map to an account"
            );
        }
        for good in ["default", "work", "a", "client-2", &"a".repeat(32)] {
            assert!(validate_id(good).is_ok(), "{good:?} must be accepted");
        }
    }

    #[test]
    fn path_mapping_default_vs_non_default_with_xdg() {
        let home = PathBuf::from("/home/u");
        // XDG set: hubs + profiles follow it; default cloud.json stays on the
        // XDG-blind legacy path the server reads (cloud/endpoints.ts).
        let root = config_root_from(Some("/xdg".into()), &home);
        assert_eq!(root, PathBuf::from("/xdg/maude"));
        let d = paths_in("default", &root, &home).unwrap();
        assert_eq!(d.hubs_config, PathBuf::from("/xdg/maude/hubs.json"));
        assert_eq!(
            d.cloud_config,
            PathBuf::from("/home/u/.config/maude/cloud.json")
        );
        let w = paths_in("work", &root, &home).unwrap();
        assert_eq!(
            w.hubs_config,
            PathBuf::from("/xdg/maude/profiles/work/hubs.json")
        );
        assert_eq!(
            w.cloud_config,
            PathBuf::from("/xdg/maude/profiles/work/cloud.json")
        );
        // Unset or EMPTY XDG ⇒ ~/.config/maude, like hubs-config.ts.
        for xdg in [None, Some(String::new())] {
            let root = config_root_from(xdg, &home);
            assert_eq!(root, PathBuf::from("/home/u/.config/maude"));
            let d = paths_in("default", &root, &home).unwrap();
            assert_eq!(
                d.hubs_config,
                PathBuf::from("/home/u/.config/maude/hubs.json")
            );
        }
        assert_eq!(keychain_account("default").unwrap(), "maude-github-token");
        assert_eq!(keychain_account("work").unwrap(), "maude-github-token:work");
    }

    #[test]
    fn registry_create_list_delete() {
        let dir = tmp("reg");
        let file = dir.join("profiles.json");
        // No file yet ⇒ just `default`.
        let ids: Vec<String> = list_in(&file).into_iter().map(|p| p.id).collect();
        assert_eq!(ids, vec!["default"]);

        let a = create_in(&file, "Work Account").unwrap();
        assert_eq!(a.id, "work-account");
        let b = create_in(&file, "Work Account").unwrap();
        assert_eq!(b.id, "work-account-2");
        let c = create_in(&file, "Default").unwrap();
        assert_eq!(
            c.id, "profile",
            "a label slugging to `default` gets a fresh id"
        );
        assert!(create_in(&file, " \u{7} ").is_err());

        let ids: Vec<String> = list_in(&file).into_iter().map(|p| p.id).collect();
        assert_eq!(
            ids,
            vec!["default", "work-account", "work-account-2", "profile"]
        );

        assert!(delete_in(&file, "default", |_| false).is_err());
        assert!(delete_in(&file, "work-account", |id| id == "work-account").is_err());
        assert!(delete_in(&file, "../x", |_| false).is_err());
        delete_in(&file, "work-account", |_| false).unwrap();
        let ids: Vec<String> = list_in(&file).into_iter().map(|p| p.id).collect();
        assert_eq!(ids, vec!["default", "work-account-2", "profile"]);

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&file).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
            let dmode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
            assert_eq!(dmode, 0o700);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_ids_on_disk_are_dropped() {
        let dir = tmp("disk");
        let file = dir.join("profiles.json");
        ensure_private_dir(&dir).unwrap();
        std::fs::write(
            &file,
            r#"{"profiles":[{"id":"../evil","label":"x"},{"id":"ok","label":"Ok"}],"default":"default"}"#,
        )
        .unwrap();
        let ids: Vec<String> = list_in(&file).into_iter().map(|p| p.id).collect();
        assert_eq!(ids, vec!["default", "ok"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
