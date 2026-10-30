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

pub(crate) fn list_in(file: &Path) -> Vec<Profile> {
    load_registry(file).profiles
}

pub(crate) fn create_in(file: &Path, label: &str) -> Result<Profile, String> {
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

pub(crate) fn registry_file() -> PathBuf {
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

// ── which profile a sign-in lands on (V2-3.8) ───────────────────────────────

/// The two credentials a profile holds. A profile is ONE account bundle: a
/// project's GitHub token and its Maude Cloud credential always live in the
/// same profile (V2-3.8), so both kinds go through the same decision.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SignInKind {
    GitHub,
    Cloud,
}

/// Where a sign-in's credential goes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SignInTarget {
    /// The calling project's own profile.
    Keep,
    /// A fresh profile, which the calling project is rebound to.
    NewProfile,
}

/// V2-3.8 "each project keeps its own sign-in". `prior_credential`: the
/// caller's profile holds a credential of this kind right now. `recorded`: the
/// account last signed in on it (kept across a sign-out). `others_bound`:
/// other projects bound to the same profile.
///
/// - the same account again ⇒ Keep (a token refresh changes nobody's account);
/// - a credential of another (or an unknown) account ⇒ NewProfile — the slot
///   is never overwritten under the projects that use it;
/// - signed out, but other projects are bound to it under another account ⇒
///   NewProfile (never re-sign a shared profile as someone else);
/// - otherwise (a first sign-in, or the caller's own signed-out profile) ⇒ Keep.
pub fn sign_in_target(
    prior_credential: bool,
    recorded: Option<&str>,
    others_bound: usize,
    account: &str,
) -> SignInTarget {
    if recorded.is_some_and(|r| r.eq_ignore_ascii_case(account)) {
        return SignInTarget::Keep;
    }
    if prior_credential || (recorded.is_some() && others_bound > 0) {
        return SignInTarget::NewProfile;
    }
    SignInTarget::Keep
}

/// The account last signed in on profile `id` for `kind` (public handles only).
pub(crate) fn recorded_account_in(file: &Path, id: &str, kind: SignInKind) -> Option<String> {
    let p = list_in(file).into_iter().find(|p| p.id == id)?;
    match kind {
        SignInKind::GitHub => p.github_login,
        SignInKind::Cloud => p.cloud_email,
    }
    .filter(|a| !a.is_empty())
}

/// Record the public account handle (GitHub login / cloud e-mail) on a profile
/// after sign-in. Best-effort: display data and the V2-3.8 decision input; the
/// credential itself is never here.
pub(crate) fn set_account_in(file: &Path, id: &str, kind: SignInKind, account: &str) {
    if validate_id(id).is_err() {
        return;
    }
    let _guard = REGISTRY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut reg = load_registry(file);
    if let Some(p) = reg.profiles.iter_mut().find(|p| p.id == id) {
        let v = Some(crate::notify::sanitize_notify_field(account));
        match kind {
            SignInKind::GitHub => p.github_login = v,
            SignInKind::Cloud => p.cloud_email = v,
        }
        let _ = save_registry(file, &reg);
    }
}

/// `create_in` under the `MAX_PROFILES` cap (V2-3.6 M2) — the one way a new
/// profile is made, from Home or from a V2-3.8 sign-in.
pub(crate) fn create_capped_in(file: &Path, label: &str) -> Result<Profile, String> {
    if list_in(file).len() >= MAX_PROFILES {
        return Err(format!(
            "You can keep up to {MAX_PROFILES} accounts. Remove one in Home first."
        ));
    }
    create_in(file, label)
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// Every profile, for the shell itself (Home's `shell_state`) — not a command.
pub fn list_all() -> Vec<Profile> {
    list_in(&registry_file())
}

/// At most this many profiles (V2-3.6 M2: `profiles_create` in a loop must not
/// grow profiles.json without bound).
pub const MAX_PROFILES: usize = 16;

/// Who may manage profiles (V2-3.6 M2). Profile management reads every
/// profile's GitHub login and cloud e-mail and can delete another account's
/// token, so it is Home's power, never a project page's. `allow_project` is
/// `cfg!(debug_assertions)` at the call site: the debug-only e2e capability
/// grants these to `p-*` for `project-tabs-identity`, and a release build has
/// neither that capability nor this exception.
pub fn profiles_gate(caller: &crate::windows::Caller, allow_project: bool) -> Result<(), String> {
    match caller {
        crate::windows::Caller::Home => Ok(()),
        crate::windows::Caller::Project(_) if allow_project => Ok(()),
        crate::windows::Caller::Project(_) => Err("Only the Home window can manage accounts.".to_string()),
    }
}

fn gate(webview: &tauri::Webview) -> Result<(), String> {
    profiles_gate(&crate::windows::caller_any(webview, false)?, cfg!(debug_assertions))
}

#[tauri::command]
pub fn profiles_list(webview: tauri::Webview) -> Result<Vec<Profile>, String> {
    gate(&webview)?;
    Ok(list_in(&registry_file()))
}

#[tauri::command]
pub fn profiles_create(webview: tauri::Webview, label: String) -> Result<Profile, String> {
    gate(&webview)?;
    create_capped_in(&registry_file(), &label)
}

/// `async`: it also clears the profile's keychain slot, and a keychain call can
/// park on a macOS access prompt (see keychain.rs `github_is_signed_in`).
#[tauri::command]
pub async fn profiles_delete(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    id: String,
) -> Result<(), String> {
    gate(&webview)?;
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

// ── Maude Cloud sign-in binding (V2-3.8) ─────────────────────────────────────
//
// The cloud device flow runs in the project's server (cloud/endpoints.ts), which
// writes `cloud.json` at MAUDE_CLOUD_CONFIG — the profile its env names — and
// cannot rebind anything itself. So the project page brackets the flow with
// two shell calls: `cloud_sign_in_prepare` BEFORE it starts (a profile that
// already holds a cloud credential is never overwritten: the project moves to
// a fresh profile first) and `cloud_signed_in` AFTER the server stored the
// credential (the same `sign_in_target` decision GitHub uses, on the account's
// e-mail). The hub link needs no step of its own: its credential is derived
// from this cloud account and lands in the same profile's `hubs.json`
// (HUBS_CONFIG_PATH comes from the same `profile_env`).

/// The e-mail in a `cloud.json` (public handle; the token is never read out).
fn cloud_email_of(raw: &[u8]) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(raw).ok()?;
    v.get("email")?.as_str().map(str::to_string).filter(|e| !e.is_empty())
}

// ── Low 2c: `cloud_signed_in` needs this caller's own `cloud_sign_in_prepare` ──

/// How long a prepared cloud sign-in stays valid (a device code lives ~15 min).
const CLOUD_PREPARE_TTL: std::time::Duration = std::time::Duration::from_secs(15 * 60);

/// What `cloud_sign_in_prepare` saw for one caller: the project and the
/// profile the flow will write. Keyed by the caller's label (from the IPC
/// webview, never an argument); taken once by `cloud_signed_in`.
#[derive(Clone, Debug)]
struct Prepared {
    root: String,
    profile: String,
    at: std::time::Instant,
}

#[derive(Default)]
pub(crate) struct PreparedBook(std::collections::HashMap<String, Prepared>);

impl PreparedBook {
    fn prepare(&mut self, label: &str, root: &str, profile: &str, now: std::time::Instant) {
        self.0
            .retain(|_, p| now.duration_since(p.at) <= CLOUD_PREPARE_TTL);
        self.0.insert(
            label.to_string(),
            Prepared {
                root: root.to_string(),
                profile: profile.to_string(),
                at: now,
            },
        );
    }

    /// One-shot: Ok only for the same label, project and profile, in time.
    fn take(
        &mut self,
        label: &str,
        root: &str,
        profile: &str,
        now: std::time::Instant,
    ) -> Result<(), String> {
        let again = || "Start the Maude Cloud sign-in again.".to_string();
        let p = self.0.remove(label).ok_or_else(again)?;
        if p.root != root || p.profile != profile || now.duration_since(p.at) > CLOUD_PREPARE_TTL {
            return Err(again());
        }
        Ok(())
    }

    fn forget(&mut self, label: &str) {
        self.0.remove(label);
    }
}

static PREPARED: std::sync::Mutex<Option<PreparedBook>> = std::sync::Mutex::new(None);

fn with_prepared<T>(f: impl FnOnce(&mut PreparedBook) -> T) -> T {
    let mut g = PREPARED.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(PreparedBook::default))
}

/// A tab closed: its prepared cloud sign-in (if any) dies with it.
pub fn forget_prepared(label: &str) {
    with_prepared(|b| b.forget(label));
}

/// Before a Maude Cloud sign-in from a project page. Ok(true) = the project
/// was moved to a fresh profile (its profile already held a cloud credential)
/// and its server is restarting — the page reloads and the person starts the
/// sign-in again there. Ok(false) = go ahead on the current profile.
#[tauri::command]
pub async fn cloud_sign_in_prepare(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<bool, String> {
    let caller = crate::windows::caller_project(&webview, false)?;
    let current = crate::app_state::profile_for(&app, &caller.root);
    if !paths(&current)?.cloud_config.exists() {
        // 2c: the one sign-in `cloud_signed_in` will accept from this caller.
        with_prepared(|b| {
            b.prepare(
                &caller.label,
                &caller.root,
                &current,
                std::time::Instant::now(),
            )
        });
        return Ok(false);
    }
    let label = crate::windows::project_display_name(&caller.root);
    let fresh = create_capped_in(&registry_file(), &label)?;
    crate::app_state::bind_chosen(&app, &caller.root, &fresh.id)?;
    crate::sidecar::restart_on_binding(&app, &caller.label, &caller.root);
    Ok(true)
}

/// After the project's server stored a cloud credential in its profile's
/// `cloud.json`: record the account, and when that sign-in would re-sign a
/// profile other projects use under another account, move the credential to a
/// fresh profile, rebind the project and restart its server. Ok(true) = rebound.
#[tauri::command]
pub async fn cloud_signed_in(app: tauri::AppHandle, webview: tauri::Webview) -> Result<bool, String> {
    let caller = crate::windows::caller_project(&webview, false)?;
    let current = crate::app_state::profile_for(&app, &caller.root);
    // 2c: only after THIS caller's `cloud_sign_in_prepare` on this project and
    // profile — a page that skipped it can't move a shared profile's cloud.json.
    with_prepared(|b| {
        b.take(
            &caller.label,
            &caller.root,
            &current,
            std::time::Instant::now(),
        )
    })?;
    let src = paths(&current)?.cloud_config;
    let raw = std::fs::read(&src).map_err(|_| "Maude Cloud sign-in didn't finish.".to_string())?;
    let email = cloud_email_of(&raw).unwrap_or_else(|| "Maude Cloud".to_string());
    let out = crate::app_state::settle_sign_in_app(
        &app,
        &caller.root,
        SignInKind::Cloud,
        &email,
        // `cloud_sign_in_prepare` made sure nothing was there before the flow.
        |_| false,
        |target| move_cloud_credential(&src, &paths(target)?.cloud_config, &raw),
    )?;
    if out.rebound {
        crate::sidecar::restart_on_binding(&app, &caller.label, &caller.root);
    }
    Ok(out.rebound)
}

/// Store a cloud credential on the target profile: nothing to do when it is
/// already there; otherwise write it there (0600, atomic) and put the shared
/// profile back the way it was before the flow — signed out.
fn move_cloud_credential(src: &Path, dest: &Path, raw: &[u8]) -> Result<(), String> {
    if dest == src {
        return Ok(());
    }
    atomic_write(dest, raw).map_err(|e| format!("Couldn't save the sign-in: {e}"))?;
    let _ = std::fs::remove_file(src);
    Ok(())
}

// ── S6.7: Home signs in to Maude Cloud by itself ─────────────────────────────
//
// Contract S6-S9-signin-invite-home §5.1, S6-slices Q3. On a first launch there
// is no project server, so the Home server runs the device flow and writes the
// `cloud.json` of a profile RUST picks. Three Home-only calls bracket it:
//
//   1. `home_cloud_sign_in_prepare({profile?, forInvite?})` → the profile id. A
//      profile that holds a cloud credential (any account) is never re-signed —
//      a fresh profile is made instead (V2-3.8). Rust tells the Home server
//      (internal route, bearer) which profile the next `start` may write.
//   2. `home_cloud_sign_in_open({userCode, state})` — Rust composes
//      `<cloud>/activate?code=…&state=…[&invite=…]` itself (the invite is the
//      prepared one, never the page's) and opens it in the browser. The
//      `state` becomes the attempt the `maude://auth/{done,cancelled}` nudges
//      must name (deep_link.rs): single use, `HOME_SIGNIN_TTL`.
//   3. `home_cloud_signed_in({profile})` — after the Home server stored the
//      credential: record the account and `lastSignInProfile`, and when that
//      would re-sign a profile other projects use under another account, move
//      the credential to a fresh profile (V2-3.8). Returns where it landed.
//
// No credential crosses these calls: the page passes ids and the attempt's
// `state`; the device code and the token stay in the Home process and on disk.

/// How long a Home sign-in attempt stays live — the Home server's own wait
/// (`expiresIn: 600`); the device code itself lives 15 min.
pub const HOME_SIGNIN_TTL: std::time::Duration = std::time::Duration::from_secs(10 * 60);

/// Sign-in attempts Home may prepare (each may make a profile) / browser opens,
/// per `SIGNIN_BUDGET_WINDOW`.
const MAX_SIGNIN_PREPARES: usize = 5;
const MAX_SIGNIN_OPENS: usize = 5;
const SIGNIN_BUDGET_WINDOW: std::time::Duration = std::time::Duration::from_secs(60);

/// What a fresh profile made for a Home sign-in is called until the account is
/// known (`home_cloud_signed_in` relabels it with the e-mail).
const FRESH_SIGNIN_LABEL: &str = "Maude Cloud";

/// An invite id as the cloud mints it (`^[0-9a-f-]{36}$`, contract §5.1 step 2).
pub fn valid_invite_id(id: &str) -> bool {
    id.len() == 36 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f' | b'-'))
}

/// An attempt's `state`: 16 random bytes as 32 lowercase hex (contract §5.1).
pub fn valid_signin_state(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// A device-flow user code (`ABCD-1234`, apps/cloud/device-auth.mjs).
fn valid_user_code(c: &str) -> bool {
    (1..=16).contains(&c.len())
        && c.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-')
        && c.bytes().any(|b| b != b'-')
}

/// Where a Home sign-in goes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HomePick {
    /// This profile (empty, or signed out on its own).
    Use(String),
    /// A fresh profile.
    Fresh,
}

/// THE rule for which profile a Home sign-in writes (S6.7, V2-3.8 for Home).
/// `requested`: the profile Home named (`default` when none). `holds_credential`:
/// its `cloud.json` exists right now. `recorded`: the account last signed in on
/// it. `bound`: projects bound to it.
///
/// - a profile holding a cloud credential is never re-signed — whichever
///   account the person is about to use, its projects keep theirs ⇒ Fresh;
/// - for an invite (Home found no profile of the invite's account), only an
///   untouched profile is used — never one with an account history or projects;
/// - otherwise the profile is used (a first sign-in, or signing a signed-out
///   profile in again — `home_cloud_signed_in` still moves the credential off
///   if the account turns out to be another one under shared projects).
pub fn home_sign_in_pick(
    requested: &str,
    holds_credential: bool,
    recorded: Option<&str>,
    bound: usize,
    for_invite: bool,
) -> HomePick {
    if holds_credential || (for_invite && (recorded.is_some() || bound > 0)) {
        return HomePick::Fresh;
    }
    HomePick::Use(requested.to_string())
}

/// A sliding-window count of attempts (the sign-in rate limit).
#[derive(Debug, Default)]
pub(crate) struct Budget(std::collections::VecDeque<std::time::Instant>);

impl Budget {
    pub(crate) const fn new() -> Self {
        Budget(std::collections::VecDeque::new())
    }

    /// Records one at `now`; false once `max` are inside `window`.
    pub(crate) fn allow(&mut self, max: usize, window: std::time::Duration, now: std::time::Instant) -> bool {
        while self.0.front().is_some_and(|&t| now.duration_since(t) >= window) {
            self.0.pop_front();
        }
        if self.0.len() >= max {
            return false;
        }
        self.0.push_back(now);
        true
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct HomePrepared {
    pub profile: String,
    /// Made by this prepare — relabelled with the e-mail once signed in, and
    /// reused by the next prepare while it is still untouched.
    pub fresh: bool,
    pub invite: Option<String>,
    pub at: std::time::Instant,
}

#[derive(Clone, Debug)]
struct Attempt {
    state: String,
    at: std::time::Instant,
    /// A `done` / `cancelled` nudge already used it.
    spent: bool,
}

/// Home's one sign-in in flight: the prepared profile and the attempt `state`.
#[derive(Debug, Default)]
pub(crate) struct HomeSignInBook {
    prepared: Option<HomePrepared>,
    attempt: Option<Attempt>,
    prepares: Budget,
    opens: Budget,
}

const TOO_MANY: &str = "Too many sign-in attempts. Wait a minute and try again.";
const AGAIN: &str = "Start the Maude Cloud sign-in again.";

impl HomeSignInBook {
    /// The rate limit of `home_cloud_sign_in_prepare`.
    pub(crate) fn may_prepare(&mut self, now: std::time::Instant) -> Result<(), String> {
        if self
            .prepares
            .allow(MAX_SIGNIN_PREPARES, SIGNIN_BUDGET_WINDOW, now)
        {
            Ok(())
        } else {
            Err(TOO_MANY.to_string())
        }
    }

    /// The fresh profile an earlier prepare made, if that attempt never finished.
    pub(crate) fn unfinished_fresh(&self) -> Option<String> {
        self.prepared
            .as_ref()
            .filter(|p| p.fresh)
            .map(|p| p.profile.clone())
    }

    /// A new attempt: replaces any earlier one (a second start cancels the first).
    pub(crate) fn prepare(&mut self, p: HomePrepared) {
        self.prepared = Some(p);
        self.attempt = None;
    }

    fn live(&self, now: std::time::Instant) -> Option<&HomePrepared> {
        self.prepared
            .as_ref()
            .filter(|p| now.duration_since(p.at) <= HOME_SIGNIN_TTL)
    }

    /// The browser is opened for `state`: only inside a live prepare. The same
    /// state again ("Open the page again") keeps its clock; a spent one is
    /// refused; another state starts a new attempt. Returns the prepared invite.
    pub(crate) fn open(&mut self, state: &str, now: std::time::Instant) -> Result<Option<String>, String> {
        if !valid_signin_state(state) {
            return Err(AGAIN.to_string());
        }
        let invite = self.live(now).ok_or_else(|| AGAIN.to_string())?.invite.clone();
        match &self.attempt {
            Some(a) if a.state == state && a.spent => return Err(AGAIN.to_string()),
            Some(a) if a.state == state && now.duration_since(a.at) > HOME_SIGNIN_TTL => {
                return Err(AGAIN.to_string())
            }
            _ => {}
        }
        if !self.opens.allow(MAX_SIGNIN_OPENS, SIGNIN_BUDGET_WINDOW, now) {
            return Err(TOO_MANY.to_string());
        }
        if self.attempt.as_ref().is_none_or(|a| a.state != state) {
            self.attempt = Some(Attempt {
                state: state.to_string(),
                at: now,
                spent: false,
            });
        }
        Ok(invite)
    }

    /// A `maude://auth/{done,cancelled}?state=` nudge: true only for the live
    /// attempt's own state, once. Anything else — a forged, an old, a replayed
    /// or an expired state — is false, and the link is dropped.
    pub(crate) fn nudge(&mut self, state: &str, now: std::time::Instant) -> bool {
        match self.attempt.as_mut() {
            Some(a) if !a.spent && a.state == state && now.duration_since(a.at) <= HOME_SIGNIN_TTL => {
                a.spent = true;
                true
            }
            _ => false,
        }
    }

    /// `home_cloud_signed_in`: the prepare for exactly `profile`, in time, once.
    pub(crate) fn finish(&mut self, profile: &str, now: std::time::Instant) -> Result<HomePrepared, String> {
        let p = self.prepared.take().ok_or_else(|| AGAIN.to_string())?;
        self.attempt = None;
        if p.profile != profile || now.duration_since(p.at) > HOME_SIGNIN_TTL {
            return Err(AGAIN.to_string());
        }
        Ok(p)
    }
}

static HOME_SIGNIN: std::sync::Mutex<Option<HomeSignInBook>> = std::sync::Mutex::new(None);

pub(crate) fn with_home_signin<T>(f: impl FnOnce(&mut HomeSignInBook) -> T) -> T {
    let mut g = HOME_SIGNIN.lock().unwrap_or_else(|e| e.into_inner());
    f(g.get_or_insert_with(HomeSignInBook::default))
}

/// deep_link.rs: may this `maude://auth/*?state=` reach Home? (Consumes it.)
pub fn home_auth_nudge(state: &str) -> bool {
    with_home_signin(|b| b.nudge(state, std::time::Instant::now()))
}

/// The device-activation page for an attempt, composed from validated parts
/// only (never the page's URL): `<cloud origin>/activate?code=…&state=…
/// [&invite=…]`. Every byte is in `[A-Za-z0-9:/.?=&-]` plus the origin's own,
/// which `oauth::cloud_base` already vetted — no `%`, quote or space can reach
/// the OS launcher (on Windows `cmd /c start "" "<url>"` keeps `&` literal
/// inside the quotes; `%` and `"` are what it would expand).
pub fn sign_in_url(base: &reqwest::Url, user_code: &str, state: &str, invite: Option<&str>) -> Option<String> {
    if !matches!(base.scheme(), "http" | "https") || !valid_user_code(user_code) || !valid_signin_state(state) {
        return None;
    }
    if invite.is_some_and(|i| !valid_invite_id(i)) {
        return None;
    }
    let origin = base.origin().ascii_serialization();
    let mut url = format!("{origin}/activate?code={user_code}&state={state}");
    if let Some(i) = invite {
        url.push_str("&invite=");
        url.push_str(i);
    }
    let safe = url
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'/' | b'.' | b'?' | b'=' | b'&' | b'-' | b'[' | b']'));
    safe.then_some(url)
}

/// Rename profile `id` (Home's fresh sign-in profile, once its account is known).
pub(crate) fn set_label_in(file: &Path, id: &str, label: &str) {
    let Ok(label) = clean_label(label) else { return };
    let _guard = REGISTRY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut reg = load_registry(file);
    if let Some(p) = reg.profiles.iter_mut().find(|p| p.id == id) {
        p.label = label;
        let _ = save_registry(file, &reg);
    }
}

/// Pure-ish half of `home_cloud_signed_in` (registry file passed in, `store`
/// injected): the V2-3.8 decision on the account's e-mail, with no project to
/// bind. The credential is stored in the target profile's own dir FIRST; only
/// then is the account recorded. Returns the profile the credential is in.
pub(crate) fn settle_home_sign_in(
    registry: &Path,
    prepared: &HomePrepared,
    account: &str,
    bound: usize,
    store: impl FnOnce(&str) -> Result<(), String>,
) -> Result<String, String> {
    let recorded = recorded_account_in(registry, &prepared.profile, SignInKind::Cloud);
    let target = match sign_in_target(false, recorded.as_deref(), bound, account) {
        SignInTarget::Keep => prepared.profile.clone(),
        SignInTarget::NewProfile => create_capped_in(registry, account)?.id,
    };
    store(&target)?;
    if prepared.fresh && target == prepared.profile {
        set_label_in(registry, &target, account);
    }
    set_account_in(registry, &target, SignInKind::Cloud, account);
    Ok(target)
}

/// `home_cloud_sign_in_prepare({profile?, forInvite?})` — Home only. Picks the
/// profile the Home server's next sign-in may write (`home_sign_in_pick`) and
/// tells the Home server so; returns its id. Rate-limited.
#[tauri::command]
pub async fn home_cloud_sign_in_prepare(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    profile: Option<String>,
    for_invite: Option<String>,
) -> Result<String, String> {
    crate::home::caller_home(&webview, false)?;
    if for_invite.as_deref().is_some_and(|i| !valid_invite_id(i)) {
        return Err("That invitation link is not valid.".to_string());
    }
    let requested = profile.unwrap_or_else(default_id);
    validate_id(&requested)?;
    let registry = registry_file();
    if !list_in(&registry).iter().any(|p| p.id == requested) {
        return Err("That account profile doesn't exist.".to_string());
    }
    let now = std::time::Instant::now();
    with_home_signin(|b| b.may_prepare(now))?;
    let st = crate::app_state::load(&app);
    let bound_to = |id: &str| st.others_on_profile(id, "");
    let untouched = |id: &str| {
        paths(id).is_ok_and(|p| !p.cloud_config.exists())
            && recorded_account_in(&registry, id, SignInKind::Cloud).is_none()
            && bound_to(id) == 0
    };
    let pick = home_sign_in_pick(
        &requested,
        paths(&requested)?.cloud_config.exists(),
        recorded_account_in(&registry, &requested, SignInKind::Cloud).as_deref(),
        bound_to(&requested),
        for_invite.is_some(),
    );
    let (id, fresh) = match pick {
        HomePick::Use(id) => (id, false),
        HomePick::Fresh => match with_home_signin(|b| b.unfinished_fresh()).filter(|id| exists(id) && untouched(id)) {
            // An earlier attempt's fresh profile, still untouched: no second one.
            Some(id) => (id, true),
            None => (create_capped_in(&registry, FRESH_SIGNIN_LABEL)?.id, true),
        },
    };
    crate::home::register_sign_in_profile(&app, &id, for_invite.as_deref()).await?;
    with_home_signin(|b| {
        b.prepare(HomePrepared {
            profile: id.clone(),
            fresh,
            invite: for_invite,
            at: now,
        })
    });
    Ok(id)
}

/// `home_cloud_sign_in_open({userCode, state})` — Home only. Opens the device
/// page of the prepared attempt in the browser; `state` becomes the attempt the
/// `maude://auth/*` nudges must name.
#[tauri::command]
pub async fn home_cloud_sign_in_open(
    webview: tauri::Webview,
    user_code: String,
    state: String,
) -> Result<(), String> {
    crate::home::caller_home(&webview, false)?;
    let invite = with_home_signin(|b| b.open(&state, std::time::Instant::now()))?;
    let url = sign_in_url(&crate::oauth::cloud_base(), &user_code, &state, invite.as_deref())
        .ok_or_else(|| "Refusing to open that sign-in page.".to_string())?;
    // Off the UI thread (a Linux launcher can wait for the browser) — as open_cloud_url.
    tauri::async_runtime::spawn_blocking(move || open::that(url))
        .await
        .map_err(|e| format!("Couldn't launch the browser task: {e}"))?
        .map_err(|e| format!("Couldn't open the browser: {e}"))
}

/// `home_cloud_signed_in({profile})` — Home only, after the Home server stored
/// a credential in the prepared profile's `cloud.json`. Records the account
/// and `lastSignInProfile`, tells Home (`shell://state`), and returns the
/// profile the credential ended in.
#[tauri::command]
pub async fn home_cloud_signed_in(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    profile: String,
) -> Result<String, String> {
    crate::home::caller_home(&webview, false)?;
    validate_id(&profile)?;
    let prepared = with_home_signin(|b| b.finish(&profile, std::time::Instant::now()))?;
    let src = paths(&profile)?.cloud_config;
    let raw = std::fs::read(&src).map_err(|_| "Maude Cloud sign-in didn't finish.".to_string())?;
    let email = cloud_email_of(&raw).unwrap_or_else(|| "Maude Cloud".to_string());
    let bound = crate::app_state::load(&app).others_on_profile(&profile, "");
    let target = settle_home_sign_in(&registry_file(), &prepared, &email, bound, |t| {
        move_cloud_credential(&src, &paths(t)?.cloud_config, &raw)
    })?;
    crate::app_state::set_last_sign_in_profile(&app, &target);
    crate::home::state_changed(&app);
    Ok(target)
}

// ── S1.22b: the accounts on this Mac, for the account card by the faces ──────

/// The projects of an account, as far as the calling tab may know them: the
/// names on its OWN account (the projects its sign-out signs out with it), only
/// a count on any other (V2-3.6 M2 — a project page never learns another
/// account's e-mail or projects; decision `maude/v2-S1.22b-accounts-own-only`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum AccountProjects {
    Names(Vec<String>),
    Count(usize),
}

/// One row of `accounts_list` — `[{id, label, email, projects}]`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Account {
    pub id: String,
    pub label: String,
    pub email: Option<String>,
    pub projects: AccountProjects,
}

/// Pure half of `accounts_list`: every profile on this Mac, from the caller's
/// view. `caller_profile` (the calling tab's own binding) gets its e-mail and
/// the sanitized names of every project bound to it (the caller included);
/// every other profile gets its label and a project count — no e-mail, no
/// names. A project's binding reads as `profile_for` does (missing/invalid ⇒
/// `default`). `name_of(root, registry_name)` names a project.
pub fn accounts_for(
    profiles: &[Profile],
    st: &crate::app_state::AppState,
    caller_profile: &str,
    name_of: impl Fn(&str, &str) -> String,
) -> Vec<Account> {
    let bound_to = |e: &crate::app_state::ProjectEntry| {
        if validate_id(&e.profile).is_ok() {
            e.profile.clone()
        } else {
            DEFAULT_ID.to_string()
        }
    };
    profiles
        .iter()
        .take(MAX_PROFILES)
        .map(|p| {
            let on_it = st.projects.values().filter(|e| bound_to(e) == p.id);
            let mine = p.id == caller_profile;
            let projects = if mine {
                let mut names: Vec<String> = on_it
                    .map(|e| crate::notify::sanitize_title(&name_of(&e.root, &e.name)))
                    .filter(|n| !n.is_empty())
                    .collect();
                names.sort();
                AccountProjects::Names(names)
            } else {
                AccountProjects::Count(on_it.count())
            };
            Account {
                id: p.id.clone(),
                label: crate::notify::sanitize_title(&p.label),
                email: if mine { p.cloud_email.clone() } else { None },
                projects,
            }
        })
        .collect()
}

/// `accounts_list()` — the shell side of S1.22a's account card (`accountsList()`).
/// Project tabs only (label + own server origin, `caller_project`); the
/// caller's account is the binding of ITS project, never an argument.
#[tauri::command]
pub fn accounts_list(app: tauri::AppHandle, webview: tauri::Webview) -> Result<Vec<Account>, String> {
    let caller = crate::windows::caller_project(&webview, false)?;
    let st = crate::app_state::load(&app);
    let mine = st.profile_for(&caller.root);
    Ok(accounts_for(&list_all(), &st, &mine, |root, name| {
        if Path::new(root).is_dir() {
            crate::windows::project_display_name(root)
        } else {
            name.to_string()
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// S1.22b (V2-3.6 M2 kept): a project tab learns its own account's e-mail and
    /// project names, and only a label + a count of every other account.
    #[test]
    fn accounts_list_names_only_the_callers_own_account() {
        let prof = |id: &str, label: &str, email: Option<&str>| Profile {
            id: id.into(),
            label: label.into(),
            github_login: Some(format!("{id}-gh")),
            cloud_email: email.map(str::to_string),
            created_at: 0,
        };
        let profiles = vec![
            prof("default", "Personal", Some("you@gmail.com")),
            prof("work", "Work\u{202e}", Some("you@work-studio.cz")),
            prof("empty", "Spare", None),
        ];
        let mut st = crate::app_state::AppState::default();
        for (root, profile) in [
            ("/p/alligators", "work"),
            ("/p/matchday", "work"),
            ("/p/portfolio", "default"),
            ("/p/odd", "../bad"),
        ] {
            let pid = st.upsert(root, 1);
            st.projects.get_mut(&pid).unwrap().profile = profile.into();
        }
        let name_of = |root: &str, _: &str| root.trim_start_matches("/p/").to_string();
        let out = accounts_for(&profiles, &st, "work", name_of);
        assert_eq!(out.len(), 3);
        // The caller's own account: its e-mail and every project on it, sanitized label.
        assert_eq!(out[1].id, "work");
        assert_eq!(out[1].label, "Work");
        assert_eq!(out[1].email.as_deref(), Some("you@work-studio.cz"));
        assert_eq!(
            out[1].projects,
            AccountProjects::Names(vec!["alligators".into(), "matchday".into()])
        );
        // Another account: no e-mail, no names — a count (an invalid binding reads as default).
        assert_eq!(out[0].email, None);
        assert_eq!(out[0].projects, AccountProjects::Count(2));
        assert_eq!(out[2].projects, AccountProjects::Count(0));
        let wire = serde_json::to_string(&out).unwrap();
        for leak in ["you@gmail.com", "portfolio", "odd", "-gh"] {
            assert!(!wire.contains(leak), "{leak} reached a project page: {wire}");
        }
        assert!(wire.contains(r#""projects":2"#) && wire.contains(r#""projects":["alligators","matchday"]"#));
    }

    /// Low 2c: `cloud_signed_in` acts only on this caller's own prepare — same
    /// label, project and profile, once, within the TTL.
    #[test]
    fn cloud_signed_in_needs_this_callers_prepare() {
        let t0 = std::time::Instant::now();
        let mut b = PreparedBook::default();
        // A page that skipped prepare is refused.
        assert!(b.take("p-a", "/a", "default", t0).is_err());
        b.prepare("p-a", "/a", "default", t0);
        // Another tab can't use p-a's prepare; nor can p-a on another profile.
        assert!(b.take("p-b", "/a", "default", t0).is_err());
        assert!(b.take("p-a", "/a", "other", t0).is_err());
        assert!(
            b.take("p-a", "/a", "default", t0).is_err(),
            "a mismatched take consumes it"
        );
        b.prepare("p-a", "/a", "default", t0);
        assert!(b.take("p-a", "/a", "default", t0).is_ok());
        assert!(b.take("p-a", "/a", "default", t0).is_err(), "one-shot");
        // Expired.
        b.prepare("p-a", "/a", "default", t0);
        let late = t0 + CLOUD_PREPARE_TTL + std::time::Duration::from_secs(1);
        assert!(b.take("p-a", "/a", "default", late).is_err());
        // A closed tab forgets it.
        b.prepare("p-a", "/a", "default", t0);
        b.forget("p-a");
        assert!(b.take("p-a", "/a", "default", t0).is_err());
    }

    /// S6.7: which profile a Home sign-in writes. Home cannot pick a profile that
    /// holds an account without getting a fresh one; an invite never lands on a
    /// profile with an account history or projects.
    #[test]
    fn home_signin_profile_rules() {
        use HomePick::{Fresh, Use};
        // First launch: nothing anywhere ⇒ default.
        assert_eq!(home_sign_in_pick("default", false, None, 0, false), Use("default".into()));
        // A profile holding a credential — whichever account — is never re-signed.
        assert_eq!(home_sign_in_pick("default", true, Some("a@x.cz"), 0, false), Fresh);
        assert_eq!(home_sign_in_pick("work", true, None, 3, false), Fresh);
        assert_eq!(home_sign_in_pick("work", true, Some("a@x.cz"), 0, true), Fresh);
        // Signing a signed-out profile in again: kept (settle decides on the e-mail).
        assert_eq!(home_sign_in_pick("work", false, Some("a@x.cz"), 2, false), Use("work".into()));
        // An invite: only an untouched profile.
        assert_eq!(home_sign_in_pick("default", false, None, 0, true), Use("default".into()));
        assert_eq!(home_sign_in_pick("default", false, Some("a@x.cz"), 0, true), Fresh);
        assert_eq!(home_sign_in_pick("default", false, None, 1, true), Fresh);
        // Ids from the page are ids: never a path.
        assert!(valid_invite_id("0b6f3d4e-1c2a-4b5d-8e9f-0123456789ab"));
        for bad in [
            "",
            "0B6F3D4E-1C2A-4B5D-8E9F-0123456789AB",
            "0b6f3d4e-1c2a-4b5d-8e9f-0123456789a",
            "0b6f3d4e-1c2a-4b5d-8e9f-0123456789abc",
            "../../../../../../../../../../../etc",
            "0b6f3d4e-1c2a-4b5d-8e9f-0123456789a?",
        ] {
            assert!(!valid_invite_id(bad), "{bad:?}");
        }
    }

    /// S6.7: the attempt book — a nudge counts only for the live attempt's own
    /// state, once, in time; signed_in needs this exact prepare; the browser
    /// opens only inside a prepare; prepares and opens are rate-limited.
    #[test]
    fn home_signin_state_is_single_use_with_a_ttl() {
        let t0 = std::time::Instant::now();
        let s = "0123456789abcdef0123456789abcdef";
        let other = "fedcba9876543210fedcba9876543210";
        let prep = |profile: &str, invite: Option<&str>| HomePrepared {
            profile: profile.into(),
            fresh: false,
            invite: invite.map(str::to_string),
            at: t0,
        };
        let mut b = HomeSignInBook::default();
        // No prepare: no browser, no nudge, no signed_in.
        assert!(b.open(s, t0).is_err());
        assert!(!b.nudge(s, t0));
        assert!(b.finish("default", t0).is_err());
        b.prepare(prep("default", Some("0b6f3d4e-1c2a-4b5d-8e9f-0123456789ab")));
        // A malformed state never becomes an attempt.
        assert!(b.open("0123456789ABCDEF0123456789ABCDEF", t0).is_err());
        assert!(b.open("xyz", t0).is_err());
        // The open hands back the PREPARED invite (the page never names one).
        assert_eq!(
            b.open(s, t0).unwrap().as_deref(),
            Some("0b6f3d4e-1c2a-4b5d-8e9f-0123456789ab")
        );
        // A forged nudge (another state) is dropped and spends nothing.
        assert!(!b.nudge(other, t0));
        // "Open the page again" keeps the attempt.
        assert!(b.open(s, t0 + std::time::Duration::from_secs(1)).is_ok());
        assert!(b.nudge(s, t0), "the attempt's own state, once");
        assert!(!b.nudge(s, t0), "a replayed nudge is dropped");
        assert!(b.open(s, t0).is_err(), "a spent state is not reopened");
        // signed_in: only for the prepared profile, once.
        assert!(b.finish("work", t0).is_err());
        assert!(b.finish("default", t0).is_err(), "a mismatched finish consumes it");
        b.prepare(prep("work", None));
        assert!(b.open(s, t0).unwrap().is_none());
        assert_eq!(b.finish("work", t0).unwrap().profile, "work");
        assert!(b.finish("work", t0).is_err(), "one-shot");
        assert!(!b.nudge(s, t0), "finishing ends the attempt");
        // Expired: the attempt and the prepare.
        let late = t0 + HOME_SIGNIN_TTL + std::time::Duration::from_secs(1);
        let mut b = HomeSignInBook::default();
        b.prepare(prep("default", None));
        b.open(s, t0).unwrap();
        assert!(!b.nudge(s, late));
        assert!(b.open(other, late).is_err());
        assert!(b.finish("default", late).is_err());
        // A new prepare cancels the attempt before it.
        let mut b = HomeSignInBook::default();
        b.prepare(prep("default", None));
        b.open(s, t0).unwrap();
        b.prepare(prep("default", None));
        assert!(!b.nudge(s, t0), "the old attempt's state is dead");
        // Rate limits.
        let mut b = HomeSignInBook::default();
        for i in 0..MAX_SIGNIN_PREPARES {
            assert!(b.may_prepare(t0 + std::time::Duration::from_millis(i as u64)).is_ok());
        }
        assert!(b.may_prepare(t0 + std::time::Duration::from_secs(1)).is_err());
        assert!(b.may_prepare(t0 + SIGNIN_BUDGET_WINDOW).is_ok(), "the window refills");
        b.prepare(prep("default", None));
        for _ in 0..MAX_SIGNIN_OPENS {
            assert!(b.open(s, t0).is_ok());
        }
        assert!(b.open(s, t0).is_err(), "opens are capped");
    }

    /// S6.7: the activation URL is composed from vetted parts only.
    #[test]
    fn home_signin_url_is_composed_not_passed() {
        let base = reqwest::Url::parse("https://cloud.maude.sh/some/path").unwrap();
        let s = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            sign_in_url(&base, "ABCD-1234", s, None).as_deref(),
            Some("https://cloud.maude.sh/activate?code=ABCD-1234&state=0123456789abcdef0123456789abcdef")
        );
        assert_eq!(
            sign_in_url(&base, "ABCD-1234", s, Some("0b6f3d4e-1c2a-4b5d-8e9f-0123456789ab")).as_deref(),
            Some("https://cloud.maude.sh/activate?code=ABCD-1234&state=0123456789abcdef0123456789abcdef&invite=0b6f3d4e-1c2a-4b5d-8e9f-0123456789ab")
        );
        let local = reqwest::Url::parse("http://127.0.0.1:8788").unwrap();
        assert!(sign_in_url(&local, "ABCD-1234", s, None).unwrap().starts_with("http://127.0.0.1:8788/activate?"));
        for code in ["", "abcd-1234", "AB CD", "AB%41", "AB&x=1", "----", &"A".repeat(17)] {
            assert_eq!(sign_in_url(&base, code, s, None), None, "{code:?}");
        }
        assert_eq!(sign_in_url(&base, "ABCD", "0123", None), None);
        assert_eq!(sign_in_url(&base, "ABCD", s, Some("x@y.cz")), None);
        let file = reqwest::Url::parse("file:///etc/passwd").unwrap();
        assert_eq!(sign_in_url(&file, "ABCD", s, None), None);
    }

    /// S6.7: after a Home sign-in the credential sits in ITS profile's own dir;
    /// another account on a shared profile moves to a fresh profile; a fresh
    /// profile takes the e-mail as its name.
    #[test]
    fn home_signed_in_settles_into_the_profiles_own_dir() {
        let dir = tmp("homesettle");
        let registry = dir.join("profiles.json");
        let home = dir.join("home");
        let path_of = |id: &str| paths_in(id, &dir, &home).unwrap().cloud_config;
        let t0 = std::time::Instant::now();
        // A first sign-in on default.
        let first = HomePrepared {
            profile: "default".into(),
            fresh: false,
            invite: None,
            at: t0,
        };
        let mut wrote = Vec::new();
        let got = settle_home_sign_in(&registry, &first, "a@x.cz", 0, |t| {
            wrote.push(path_of(t));
            Ok(())
        })
        .unwrap();
        assert_eq!(got, "default");
        assert_eq!(recorded_account_in(&registry, "default", SignInKind::Cloud).as_deref(), Some("a@x.cz"));
        // The same account again on default (a re-sign-in): kept.
        assert_eq!(settle_home_sign_in(&registry, &first, "A@x.cz", 4, |_| Ok(())).unwrap(), "default");
        // Another account on default while 2 projects use it: a NEW profile.
        let got = settle_home_sign_in(&registry, &first, "b@y.cz", 2, |t| {
            wrote.push(path_of(t));
            Ok(())
        })
        .unwrap();
        assert_ne!(got, "default");
        assert_eq!(recorded_account_in(&registry, "default", SignInKind::Cloud).as_deref(), Some("A@x.cz"));
        assert_eq!(recorded_account_in(&registry, &got, SignInKind::Cloud).as_deref(), Some("b@y.cz"));
        // A fresh prepare profile takes the e-mail as its label.
        let fresh = create_capped_in(&registry, FRESH_SIGNIN_LABEL).unwrap();
        let p = HomePrepared {
            profile: fresh.id.clone(),
            fresh: true,
            invite: None,
            at: t0,
        };
        assert_eq!(settle_home_sign_in(&registry, &p, "c@z.cz", 0, |_| Ok(())).unwrap(), fresh.id);
        assert_eq!(list_in(&registry).iter().find(|x| x.id == fresh.id).unwrap().label, "c@z.cz");
        // Every write was the target profile's own cloud.json.
        assert_eq!(wrote[0], home.join(".config/maude/cloud.json"));
        assert_eq!(wrote[1], dir.join("profiles").join(&got).join("cloud.json"));
        // A failed store records nothing.
        let before = list_in(&registry);
        assert!(settle_home_sign_in(&registry, &p, "d@z.cz", 0, |_| Err("disk".into())).is_err());
        assert_eq!(list_in(&registry), before);
        let _ = std::fs::remove_dir_all(&dir);
    }

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

    /// V2-3.8: where a sign-in lands.
    #[test]
    fn a_sign_in_never_re_signs_a_profile_under_another_account() {
        use SignInTarget::{Keep, NewProfile};
        // first sign-in, shared or not
        assert_eq!(sign_in_target(false, None, 0, "x"), Keep);
        assert_eq!(sign_in_target(false, None, 3, "x"), Keep);
        // the same account again (case-insensitive handle)
        assert_eq!(sign_in_target(true, Some("X"), 3, "x"), Keep);
        // a credential of another / an unknown account
        assert_eq!(sign_in_target(true, Some("x"), 0, "y"), NewProfile);
        assert_eq!(sign_in_target(true, None, 0, "y"), NewProfile);
        // signed out: shared ⇒ new; the caller's own ⇒ keep
        assert_eq!(sign_in_target(false, Some("x"), 1, "y"), NewProfile);
        assert_eq!(sign_in_target(false, Some("x"), 0, "y"), Keep);
    }

    /// V2-3.8 cloud: a credential moved off a shared profile leaves it signed out.
    #[test]
    fn a_moved_cloud_credential_leaves_the_shared_profile_signed_out() {
        let dir = tmp("cloudmove");
        ensure_private_dir(&dir).unwrap();
        let src = dir.join("cloud.json");
        let raw = br#"{"url":"https://c.test","token":"t","email":"y@c.test"}"#;
        std::fs::write(&src, raw).unwrap();
        assert_eq!(cloud_email_of(raw).as_deref(), Some("y@c.test"));
        // Same profile: nothing moves.
        move_cloud_credential(&src, &src, raw).unwrap();
        assert!(src.exists());
        let dest = dir.join("profiles").join("y").join("cloud.json");
        move_cloud_credential(&src, &dest, raw).unwrap();
        assert!(!src.exists(), "the shared profile is signed out again");
        assert_eq!(std::fs::read(&dest).unwrap(), raw.to_vec());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&dest).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// V2-3.6 M2: profile management is refused from a project page in a
    /// release build; Home may; the debug e2e exception is explicit.
    #[test]
    fn profiles_are_refused_from_a_project_window() {
        use crate::windows::{Caller, CallerProject};
        let project = Caller::Project(CallerProject {
            label: "p-l0123456789abcdef".into(),
            pid: "l0123456789abcdef".into(),
            root: "/tmp/a".into(),
        });
        assert!(profiles_gate(&project, false).is_err());
        assert!(profiles_gate(&Caller::Home, false).is_ok());
        assert!(profiles_gate(&project, true).is_ok(), "the debug e2e lane");
    }
}
