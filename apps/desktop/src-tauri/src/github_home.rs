// github_home.rs — GitHub from Home (S6.10; completes 02 ob-adv-sheets' "From GitHub" segment).
//
// Home has no project, so no sidecar and no token bridge key: everything a GitHub token touches
// happens here, in Rust, for a profile Home names (Home is trusted to name profiles, as in S6.7's
// `home_cloud_sign_in_prepare`; a PROJECT page never can, V2-3.2).
//
//   github_repos({profile?})                 → the profile's repos, from GitHub REST, read here
//   home_github_sign_in({profile?})          → the device flow for Home; the token goes to a keychain
//                                              slot only, under the V2-3.8 rule (another account ⇒ a
//                                              fresh profile, never an overwrite)
//   github_clone({fullName, profile?, chooseFolder?}) → root: `~/Maude/<repo>` (" 2", " 3" … — C4),
//                                              or a folder the person picks in the native dialog
//   github_create({name, profile?, chooseFolder?})    → root: "New project on GitHub — private by
//                                              default" — the repo is created PRIVATE here, then
//                                              cloned by the same path
//
// SECURITY — the token is a secret (DDR-108/132):
//   • No command returns it, or anything derived from it (`github_home_token_never_serialized`):
//     the page sees repo names, a visibility flag, the public login and a folder path.
//   • It is never put in a URL (the clone URL is rebuilt from a validated `owner/repo` and the
//     token travels as auth only — the Home server builds `https://github.com/<owner>/<repo>.git`
//     from the validated pair Rust sends), never logged, never written to disk by us.
//   • The clone itself runs in the Home server (`/_home/internal/github/clone`, the per-spawn
//     bearer — the page cannot reach it), because the app bundles no git and the person's machine
//     may have none (DDR-177). The token rides that one loopback request body to our own process,
//     the same lane the token bridge already serves to every project server; the Home server hands
//     it to iso-git's `onAuth`, which only ever offers it to github.com (`gitClone`).
//   • Every GitHub error becomes fixed words — a response body never reaches the page.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::profiles::{self, SignInKind, SignInTarget};

const REPOS_URL: &str = "https://api.github.com/user/repos";
const CREATE_URL: &str = "https://api.github.com/user/repos";
pub const CLONE_ROUTE: &str = "/_home/internal/github/clone";
/// The most rows one list shows (GitHub's page size; sorted by last push).
const MAX_REPOS: usize = 100;
const MAX_SUFFIX: u32 = 999;
/// A big repository takes a while; the Home server's own clone has no shorter limit.
const CLONE_TIMEOUT: Duration = Duration::from_secs(15 * 60);

const WORDS_OFFLINE: &str = "Couldn't reach GitHub. Check your internet connection and try again.";
const WORDS_GITHUB: &str = "GitHub didn't answer as expected. Try again in a moment.";
const WORDS_NOT_A_REPO: &str = "That isn't a GitHub project link.";
const WORDS_SIGN_IN: &str = "Sign in with GitHub first.";

// ── what the page may see ───────────────────────────────────────────────────────────────────

/// One row of the list: the name and whether it is private. Nothing else from GitHub's answer.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRow {
    pub full_name: String,
    pub private: bool,
}

/// `github_repos`'s answer. `signed_in: false` = this profile has no GitHub token (or GitHub no
/// longer takes it) — the segment then offers the sign-in.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepos {
    pub profile: String,
    pub signed_in: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login: Option<String>,
    pub repos: Vec<RepoRow>,
}

/// `github_clone` / `github_create`: the project folder, bound to `profile` (open it with
/// `open_project({root})`). `None` from the command = the person closed the folder picker.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClonedProject {
    pub root: String,
    pub profile: String,
    pub name: String,
}

/// `home_github_sign_in`'s answer: where the token landed and whose it is.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeGithubSignedIn {
    pub profile: String,
    pub login: String,
}

// ── pure rules ──────────────────────────────────────────────────────────────────────────────

/// A GitHub owner: 1–39 chars, alphanumeric or single inner hyphens.
fn valid_owner(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 39
        && b[0] != b'-'
        && b[b.len() - 1] != b'-'
        && !s.contains("--")
        && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'-')
}

/// A repo name: `[A-Za-z0-9._-]{1,100}`, never `.`/`..` and never starting with a dot (so it is
/// always one safe folder name, too).
fn valid_repo(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && !s.starts_with('.')
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
}

/// `owner/repo`, a `https://github.com/owner/repo(.git)` link or `git@github.com:owner/repo.git`
/// → `(owner, repo)`. The host is anchored to exactly github.com (the phase-28 D-1 lesson: a
/// substring match let `https://evil.example/github.com/o/r` through), https only.
pub fn parse_repo_ref(input: &str) -> Option<(String, String)> {
    let s = input.trim();
    if s.is_empty() || s.len() > 300 || s.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    let path = if let Some(rest) = s.strip_prefix("git@github.com:") {
        rest.to_string()
    } else if s.contains("://") {
        let u = reqwest::Url::parse(s).ok()?;
        let host_ok = u
            .host_str()
            .is_some_and(|h| h.eq_ignore_ascii_case("github.com"));
        if u.scheme() != "https"
            || !host_ok
            || u.port().is_some()
            || !u.username().is_empty()
            || u.password().is_some()
        {
            return None;
        }
        if u.query().is_some() || u.fragment().is_some() {
            return None;
        }
        u.path().trim_start_matches('/').to_string()
    } else {
        s.to_string()
    };
    let path = path.trim_end_matches('/');
    let mut parts = path.split('/');
    let (owner, repo) = (parts.next()?, parts.next()?);
    if parts.next().is_some() {
        return None;
    }
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    (valid_owner(owner) && valid_repo(repo)).then(|| (owner.to_string(), repo.to_string()))
}

/// GitHub's `/user/repos` answer → rows: valid names only, `private` only, at most `MAX_REPOS`.
pub fn rows_from_api(v: &Value) -> Vec<RepoRow> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|r| {
                    let full = r.get("full_name")?.as_str()?;
                    let (o, n) = parse_repo_ref(full)?;
                    Some(RepoRow {
                        full_name: format!("{o}/{n}"),
                        private: r.get("private").and_then(Value::as_bool).unwrap_or(true),
                    })
                })
                .take(MAX_REPOS)
                .collect()
        })
        .unwrap_or_default()
}

/// The common Latin letters with a mark → their base letter (`Plakát` → `Plakat`), so a Czech name
/// keeps its words; NFKD + strip in github/endpoints.ts, without a Unicode table here.
fn fold_latin(c: char) -> char {
    const FROM: &str = "áàâäãåčćçďéèêëěíìîïľĺłňńñóòôöõőřŕšśťúùûüůűýÿžźżÁÀÂÄÃÅČĆÇĎÉÈÊËĚÍÌÎÏĽĹŁŇŃÑÓÒÔÖÕŐŘŔŠŚŤÚÙÛÜŮŰÝŸŽŹŻ";
    const TO: &str = "aaaaaacccdeeeeeiiiilllnnnoooooorrsstuuuuuuyyzzzAAAAAACCCDEEEEEIIIILLLNNNOOOOOORRSSTUUUUUUYYZZZ";
    FROM.chars()
        .position(|f| f == c)
        .and_then(|i| TO.chars().nth(i))
        .unwrap_or(c)
}

/// A human project name → a GitHub repo name (github/endpoints.ts `slugifyRepoName`, the existing
/// create's rule): ASCII letters, digits, `.`, `_`, `-`; runs of anything else become one hyphen.
pub fn repo_slug(raw: &str) -> Option<String> {
    let mut out = String::new();
    let mut dash = false;
    for c in raw.chars().map(fold_latin) {
        if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
            if c == '-' {
                if !dash && !out.is_empty() {
                    out.push('-');
                }
                dash = true;
            } else {
                out.push(c.to_ascii_lowercase());
                dash = false;
            }
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    let s: String = out.trim_matches(['-', '.']).chars().take(100).collect();
    let s = s.trim_end_matches(['-', '.']).to_string();
    valid_repo(&s).then_some(s)
}

/// Claim the folder a clone goes into: `<base>/<repo>`, then `<repo> 2`, `<repo> 3` … (C4, the
/// rule Home's create-local follows). The claim is a NON-recursive mkdir, so two clones racing
/// for one name get two folders, never a shared one. Returns the claimed (empty) folder.
pub fn claim_clone_dir(base: &Path, repo: &str) -> Result<PathBuf, String> {
    if !valid_repo(repo) {
        return Err(WORDS_NOT_A_REPO.to_string());
    }
    std::fs::create_dir_all(base).map_err(|_| format!("Couldn't create {}.", base.display()))?;
    for i in 1..=MAX_SUFFIX {
        let name = if i == 1 {
            repo.to_string()
        } else {
            format!("{repo} {i}")
        };
        let dir = base.join(&name);
        match std::fs::create_dir(&dir) {
            Ok(()) => return Ok(dir),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("Couldn't create the project folder.".to_string()),
        }
    }
    Err(format!("Too many projects named “{repo}”."))
}

/// `$MAUDE_HOME_PROJECTS_DIR`, else `~/Maude` — exactly home/create-local.ts `projectsBaseDir`.
fn projects_base() -> PathBuf {
    if let Some(v) = std::env::var_os("MAUDE_HOME_PROJECTS_DIR").filter(|v| !v.is_empty()) {
        return PathBuf::from(v);
    }
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Maude")
}

/// A GitHub status → the words the page shows. The body is never read into them.
fn api_words(status: u16) -> &'static str {
    match status {
        401 => WORDS_SIGN_IN,
        403 | 429 => "GitHub is limiting requests right now. Try again in a minute.",
        404 => "GitHub couldn't find that — it may be private or renamed.",
        422 => "A project with that name is already on your GitHub.",
        _ => WORDS_GITHUB,
    }
}

/// The Home server's clone answer → the page's words (fixed; the server's own are fixed too).
fn clone_words(status: u16, body: &Value) -> String {
    if body.get("authRequired").and_then(Value::as_bool) == Some(true) || status == 401 {
        return "GitHub sign-in is needed to download this project.".to_string();
    }
    "Couldn't download the project. Check the link and try again.".to_string()
}

/// V2-3.8 for a Home GitHub sign-in (no project to rebind): the named profile keeps its token
/// when it is the same account again or has none of anyone's; a token of another account — or a
/// signed-out profile other projects use under another account — gets a fresh profile instead.
/// The token is stored (`store`) BEFORE the account is recorded. Returns the profile it is in.
pub(crate) fn settle_home_github(
    registry: &Path,
    requested: &str,
    prior_token: bool,
    bound: usize,
    login: &str,
    store: impl FnOnce(&str) -> Result<(), String>,
) -> Result<String, String> {
    let recorded = profiles::recorded_account_in(registry, requested, SignInKind::GitHub);
    let target = match profiles::sign_in_target(prior_token, recorded.as_deref(), bound, login) {
        SignInTarget::Keep => requested.to_string(),
        SignInTarget::NewProfile => profiles::create_capped_in(registry, login)?.id,
    };
    store(&target)?;
    profiles::set_account_in(registry, &target, SignInKind::GitHub, login);
    Ok(target)
}

// ── shell glue ──────────────────────────────────────────────────────────────────────────────

/// The profile a Home GitHub call acts on: the one Home named, else the profile of the last
/// sign-in on this Mac, else `default`. It must exist.
fn home_profile(app: &AppHandle, profile: Option<String>) -> Result<String, String> {
    let id = profile
        .or_else(|| crate::app_state::load(app).last_sign_in_profile)
        .filter(|p| profiles::validate_id(p).is_ok())
        .unwrap_or_else(|| profiles::DEFAULT_ID.to_string());
    profiles::validate_id(&id)?;
    if !profiles::exists(&id) {
        return Err("That account profile doesn't exist.".to_string());
    }
    Ok(id)
}

/// The profile's token, read off the main thread (a keychain read can park on a macOS prompt).
async fn token_of(profile: &str) -> Option<String> {
    #[cfg(debug_assertions)]
    if std::env::var_os("MAUDE_E2E_NO_KEYCHAIN").is_some()
        && !crate::keychain::test_store::e2e_installed()
    {
        return None;
    }
    let p = profile.to_string();
    tauri::async_runtime::spawn_blocking(move || crate::keychain::get_token(&p))
        .await
        .ok()
        .flatten()
}

fn api_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("maude-desktop")
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| WORDS_GITHUB.to_string())
}

async fn list_repos(token: &str) -> Result<Result<Vec<RepoRow>, u16>, String> {
    let resp = api_client()?
        .get(REPOS_URL)
        .query(&[
            ("per_page", "100"),
            ("sort", "pushed"),
            ("affiliation", "owner,collaborator,organization_member"),
        ])
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| WORDS_OFFLINE.to_string())?;
    let status = resp.status().as_u16();
    if !resp.status().is_success() {
        return Ok(Err(status));
    }
    let v = resp
        .json::<Value>()
        .await
        .map_err(|_| WORDS_GITHUB.to_string())?;
    Ok(Ok(rows_from_api(&v)))
}

/// Where the clone goes: the folder the person picks (None = they closed the picker), or `~/Maude`.
async fn clone_base(
    app: &AppHandle,
    webview: &tauri::Webview,
    choose: bool,
) -> Result<Option<PathBuf>, String> {
    if !choose {
        return Ok(Some(projects_base()));
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_parent(&webview.window())
        .set_title("Choose where to save the project")
        .pick_folder(move |f| {
            let _ = tx.send(f.and_then(|f| f.as_path().map(Path::to_path_buf)));
        });
    rx.await
        .map_err(|_| "The folder picker closed unexpectedly.".to_string())
}

/// Clone `owner/repo` into a freshly claimed folder under `base` through the Home server, bind
/// the folder to `profile`, and answer it. A failed clone removes the folder it claimed.
async fn clone_into(
    app: &AppHandle,
    base: &Path,
    owner: &str,
    repo: &str,
    profile: &str,
    token: Option<String>,
) -> Result<ClonedProject, String> {
    let dir = claim_clone_dir(base, repo)?;
    let fail = |e: String| {
        let _ = std::fs::remove_dir_all(&dir); // ours: claimed empty a moment ago
        Err(e)
    };
    let Some((home, bearer)) = crate::home::endpoint(app) else {
        return fail("Maude Home is still starting. Try again in a moment.".to_string());
    };
    let client = match reqwest::Client::builder()
        .no_proxy()
        .timeout(CLONE_TIMEOUT)
        .build()
    {
        Ok(c) => c,
        Err(_) => return fail(WORDS_GITHUB.to_string()),
    };
    let sent = client
        .post(format!("{home}{CLONE_ROUTE}"))
        .header(crate::home::HOME_HEADER, "1")
        .bearer_auth(bearer)
        .json(&json!({
            "owner": owner,
            "repo": repo,
            "target": dir.to_string_lossy(),
            "token": token,
        }))
        .send()
        .await;
    let resp = match sent {
        Ok(r) => r,
        Err(_) => return fail("Couldn't download the project. Try again.".to_string()),
    };
    let status = resp.status().as_u16();
    let body = resp.json::<Value>().await.unwrap_or(Value::Null);
    if status != 200 || body.get("ok").and_then(Value::as_bool) != Some(true) {
        return fail(clone_words(status, &body));
    }
    let root = std::fs::canonicalize(&dir).unwrap_or(dir.clone());
    let root_s = root.to_string_lossy().to_string();
    crate::app_state::bind_profile(app, &root_s, profile)?;
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| repo.to_string());
    Ok(ClonedProject {
        root: root_s,
        profile: profile.to_string(),
        name,
    })
}

// ── commands (Home only) ────────────────────────────────────────────────────────────────────

/// `github_repos({profile?})` — the profile's repos (owner, collaborator, organization member),
/// most recently pushed first. Home only.
#[tauri::command]
pub async fn github_repos(
    app: AppHandle,
    webview: tauri::Webview,
    profile: Option<String>,
) -> Result<GithubRepos, String> {
    crate::home::caller_home(&webview, false)?;
    let profile = home_profile(&app, profile)?;
    let login =
        profiles::recorded_account_in(&profiles::registry_file(), &profile, SignInKind::GitHub);
    let signed_out = |profile: String| GithubRepos {
        profile,
        signed_in: false,
        login: None,
        repos: Vec::new(),
    };
    let Some(token) = token_of(&profile).await else {
        return Ok(signed_out(profile));
    };
    match list_repos(&token).await? {
        Ok(repos) => Ok(GithubRepos {
            profile,
            signed_in: true,
            login,
            repos,
        }),
        Err(401) => Ok(signed_out(profile)), // revoked or expired: offer the sign-in again
        Err(status) => Err(api_words(status).to_string()),
    }
}

/// `home_github_sign_in({profile?})` — the GitHub device flow for Home (oauth.rs's, emitting the
/// code to Home on its own channel). Home only.
#[tauri::command]
pub async fn home_github_sign_in(
    app: AppHandle,
    webview: tauri::Webview,
    profile: Option<String>,
) -> Result<HomeGithubSignedIn, String> {
    crate::home::caller_home(&webview, false)?;
    let requested = home_profile(&app, profile)?;
    let label = webview.label().to_string();
    let (login, token) = crate::oauth::device_flow(&label).await?;
    let prior = token_of(&requested).await.is_some();
    let bound = crate::app_state::load(&app).others_on_profile(&requested, "");
    let profile = settle_home_github(
        &profiles::registry_file(),
        &requested,
        prior,
        bound,
        &login,
        |p| {
            crate::keychain::set_token(p, &token)
                .map_err(|e| format!("Signed in, but couldn't save it securely: {e}"))
        },
    )?;
    crate::home::state_changed(&app);
    Ok(HomeGithubSignedIn { profile, login })
}

/// `github_clone({fullName, profile?, chooseFolder?})` → the project folder (bound to the
/// profile), or `None` when the person closed the folder picker. `fullName` may be `owner/repo`
/// or a github.com link. A public repo clones without a token. Home only.
#[tauri::command]
pub async fn github_clone(
    app: AppHandle,
    webview: tauri::Webview,
    full_name: String,
    profile: Option<String>,
    choose_folder: Option<bool>,
) -> Result<Option<ClonedProject>, String> {
    crate::home::caller_home(&webview, false)?;
    let (owner, repo) = parse_repo_ref(&full_name).ok_or_else(|| WORDS_NOT_A_REPO.to_string())?;
    let profile = home_profile(&app, profile)?;
    let Some(base) = clone_base(&app, &webview, choose_folder == Some(true)).await? else {
        return Ok(None);
    };
    let token = token_of(&profile).await;
    clone_into(&app, &base, &owner, &repo, &profile, token)
        .await
        .map(Some)
}

/// `github_create({name, profile?, chooseFolder?})` — "New project on GitHub — private by
/// default": the existing create's rule (private unless asked otherwise; this sheet never asks),
/// then the same clone. Home only.
#[tauri::command]
pub async fn github_create(
    app: AppHandle,
    webview: tauri::Webview,
    name: String,
    profile: Option<String>,
    choose_folder: Option<bool>,
) -> Result<Option<ClonedProject>, String> {
    crate::home::caller_home(&webview, false)?;
    let slug = repo_slug(&name)
        .ok_or_else(|| "Enter a project name (letters, numbers, hyphens).".to_string())?;
    let profile = home_profile(&app, profile)?;
    let token = token_of(&profile)
        .await
        .ok_or_else(|| WORDS_SIGN_IN.to_string())?;
    let Some(base) = clone_base(&app, &webview, choose_folder == Some(true)).await? else {
        return Ok(None);
    };
    let resp = api_client()?
        .post(CREATE_URL)
        .header("Accept", "application/vnd.github+json")
        .bearer_auth(&token)
        .json(&json!({ "name": slug, "private": true, "auto_init": false }))
        .send()
        .await
        .map_err(|_| WORDS_OFFLINE.to_string())?;
    if !resp.status().is_success() {
        return Err(api_words(resp.status().as_u16()).to_string());
    }
    let v = resp
        .json::<Value>()
        .await
        .map_err(|_| WORDS_GITHUB.to_string())?;
    let (owner, repo) = v
        .get("full_name")
        .and_then(Value::as_str)
        .and_then(parse_repo_ref)
        .ok_or_else(|| WORDS_GITHUB.to_string())?;
    clone_into(&app, &base, &owner, &repo, &profile, Some(token))
        .await
        .map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "gho_s6x10SECRETtoken0000000000000000";

    /// The token never leaves Rust in anything a command returns. Every answer type is built here
    /// from inputs that CARRY the token (a hostile or buggy GitHub answer echoing it in fields we
    /// do not keep, a token-shaped login), and none of them serializes it.
    #[test]
    fn github_home_token_never_serialized() {
        let api = json!([
            { "full_name": "brno-alligators/brand", "private": true, "token": SECRET,
              "clone_url": format!("https://{SECRET}@github.com/brno-alligators/brand.git") },
            { "full_name": "1aGh/personal-page", "private": false, "description": SECRET },
            // A name that is not a repo name (here: the token in a URL) is dropped, not echoed.
            { "full_name": format!("https://x:{SECRET}@evil.example/a/b"), "private": true },
        ]);
        let rows = rows_from_api(&api);
        assert_eq!(
            rows,
            vec![
                RepoRow {
                    full_name: "brno-alligators/brand".into(),
                    private: true
                },
                RepoRow {
                    full_name: "1aGh/personal-page".into(),
                    private: false
                },
            ]
        );
        let answers = [
            serde_json::to_string(&GithubRepos {
                profile: "default".into(),
                signed_in: true,
                login: Some("tereza".into()),
                repos: rows,
            })
            .unwrap(),
            serde_json::to_string(&ClonedProject {
                root: "/Users/t/Maude/brand".into(),
                profile: "default".into(),
                name: "brand".into(),
            })
            .unwrap(),
            serde_json::to_string(&HomeGithubSignedIn {
                profile: "default".into(),
                login: "tereza".into(),
            })
            .unwrap(),
        ];
        for a in &answers {
            assert!(
                !a.contains(SECRET),
                "a command answer carries the token: {a}"
            );
            assert!(
                !a.to_ascii_lowercase().contains("token"),
                "no token-named field: {a}"
            );
        }
        // Errors are fixed words: no status maps to anything carrying a body.
        for s in [0u16, 400, 401, 403, 404, 422, 429, 500, 502] {
            assert!(!api_words(s).contains(SECRET));
        }
        let echoed = json!({ "ok": false, "error": SECRET, "authRequired": false });
        assert!(!clone_words(502, &echoed).contains(SECRET));
        assert!(!clone_words(401, &echoed).contains(SECRET));
        // A link carrying a credential is not a repo reference at all.
        assert_eq!(
            parse_repo_ref(&format!("https://{SECRET}@github.com/o/r")),
            None
        );
        assert_eq!(
            parse_repo_ref(&format!("https://x:{SECRET}@github.com/o/r")),
            None
        );
    }

    /// Home's GitHub commands answer only through types with no secret field (a source ratchet:
    /// no command in this file returns a bare `String`/`Value` a token could be smuggled in).
    #[test]
    fn home_github_commands_return_typed_answers() {
        let src = include_str!("github_home.rs");
        for sig in [
            "pub async fn github_repos(",
            "pub async fn home_github_sign_in(",
            "pub async fn github_clone(",
            "pub async fn github_create(",
        ] {
            let at = src.find(sig).unwrap_or_else(|| panic!("{sig} missing"));
            let head = &src[at..at + src[at..].find('{').unwrap()];
            assert!(
                head.contains("Result<GithubRepos")
                    || head.contains("Result<HomeGithubSignedIn")
                    || head.contains("Result<Option<ClonedProject>"),
                "{sig} must answer a typed, token-free shape"
            );
            let body = &src[at..at + src[at..].find("\n}\n").unwrap()];
            assert!(
                body.contains("caller_home(&webview, false)?"),
                "{sig} checks it is Home"
            );
        }
    }

    #[test]
    fn clone_name_collision() {
        let base = std::env::temp_dir().join(format!("maude-s610-clone-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let a = claim_clone_dir(&base, "brand").unwrap();
        let b = claim_clone_dir(&base, "brand").unwrap();
        let c = claim_clone_dir(&base, "brand").unwrap();
        assert_eq!(a, base.join("brand"));
        assert_eq!(b, base.join("brand 2"));
        assert_eq!(c, base.join("brand 3"));
        // A folder freed in the middle is taken again first (C4: the lowest free name).
        std::fs::remove_dir(&b).unwrap();
        assert_eq!(
            claim_clone_dir(&base, "brand").unwrap(),
            base.join("brand 2")
        );
        // A FILE with the name holds it, too — never cloned into or over.
        std::fs::write(base.join("club-web"), b"x").unwrap();
        assert_eq!(
            claim_clone_dir(&base, "club-web").unwrap(),
            base.join("club-web 2")
        );
        // Every claim is a fresh empty folder.
        assert_eq!(std::fs::read_dir(&c).unwrap().count(), 0);
        // A name that is not a repo name never reaches the filesystem.
        for bad in ["..", ".hidden", "a/b", "", "a b"] {
            assert!(claim_clone_dir(&base, bad).is_err(), "{bad:?}");
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn repo_refs_are_anchored_to_github() {
        let ok = |s: &str| parse_repo_ref(s).map(|(o, r)| format!("{o}/{r}"));
        assert_eq!(
            ok("brno-alligators/brand").as_deref(),
            Some("brno-alligators/brand")
        );
        assert_eq!(
            ok(" https://github.com/1aGh/maude ").as_deref(),
            Some("1aGh/maude")
        );
        assert_eq!(
            ok("https://github.com/1aGh/maude.git").as_deref(),
            Some("1aGh/maude")
        );
        assert_eq!(
            ok("https://github.com/1aGh/maude/").as_deref(),
            Some("1aGh/maude")
        );
        assert_eq!(
            ok("https://GitHub.com/1aGh/maude").as_deref(),
            Some("1aGh/maude")
        );
        assert_eq!(
            ok("git@github.com:1aGh/maude.git").as_deref(),
            Some("1aGh/maude")
        );
        for bad in [
            "https://evil.example/github.com/o/r",
            "https://github.com.evil.example/o/r",
            "https://github.com@evil.example/o/r",
            "http://github.com/o/r",
            "https://github.com:8443/o/r",
            "ssh://git@github.com/o/r",
            "https://github.com/o/r/tree/main",
            "https://github.com/o/r?tab=readme",
            "https://github.com/o",
            "o/r/x",
            "-o/r",
            "o--o/r",
            "o/..",
            "o/.git",
            "o/r b",
            "../r",
            "file:///etc/passwd",
        ] {
            assert_eq!(parse_repo_ref(bad), None, "should refuse {bad}");
        }
    }

    #[test]
    fn repo_slug_follows_the_existing_create() {
        assert_eq!(
            repo_slug("Poster for Saturday").as_deref(),
            Some("poster-for-saturday")
        );
        assert_eq!(repo_slug("  Brand -- 2026 ").as_deref(), Some("brand-2026"));
        assert_eq!(
            repo_slug("Plakát na zápas").as_deref(),
            Some("plakat-na-zapas")
        );
        assert_eq!(repo_slug("Žluťoučký kůň").as_deref(), Some("zlutoucky-kun"));
        assert_eq!(repo_slug("...").as_deref(), None);
        assert_eq!(fold_latin('ž'), 'z');
        assert_eq!(fold_latin('Ř'), 'R');
        assert_eq!(fold_latin('ť'), 't');
        assert_eq!(repo_slug("").as_deref(), None);
    }

    #[test]
    fn a_home_github_sign_in_never_overwrites_another_account() {
        let dir = std::env::temp_dir().join(format!("maude-s610-signin-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let reg = dir.join("profiles.json");
        let a = profiles::create_capped_in(&reg, "Work").unwrap().id;
        let mut stored = Vec::new();
        // A first sign-in lands on the named profile.
        let got = settle_home_github(&reg, &a, false, 0, "tereza", |p| {
            stored.push(p.to_string());
            Ok(())
        })
        .unwrap();
        assert_eq!(got, a);
        // The same account again (a token refresh) keeps it.
        assert_eq!(
            settle_home_github(&reg, &a, true, 2, "Tereza", |_| Ok(())).unwrap(),
            a
        );
        // Another account while it holds a token → a fresh profile; the old slot is untouched.
        let other = settle_home_github(&reg, &a, true, 0, "michal", |p| {
            stored.push(p.to_string());
            Ok(())
        })
        .unwrap();
        assert_ne!(other, a);
        assert_eq!(stored, vec![a.clone(), other.clone()]);
        // (the refresh recorded the login as GitHub spelled it last)
        assert_eq!(
            profiles::recorded_account_in(&reg, &a, SignInKind::GitHub).as_deref(),
            Some("Tereza")
        );
        assert_eq!(
            profiles::recorded_account_in(&reg, &other, SignInKind::GitHub).as_deref(),
            Some("michal")
        );
        // A store that fails records nothing.
        let before = profiles::recorded_account_in(&reg, &other, SignInKind::GitHub);
        assert!(
            settle_home_github(&reg, &other, false, 0, "michal", |_| Err("no".into())).is_err()
        );
        assert_eq!(
            profiles::recorded_account_in(&reg, &other, SignInKind::GitHub),
            before
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
