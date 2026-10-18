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
