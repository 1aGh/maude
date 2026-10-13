fn main() {
    // Declare the app commands in the ACL manifest so they can be GRANTED to the
    // remote dev-server origin in a capability (Phase 28 / DDR-108). Tauri v2 rejects
    // custom-command invokes from a remote (non-local) origin unless the resolved ACL
    // allows the command; declaring them here generates per-command `allow-*`
    // permissions the capability references.
    //
    // V2-3.6 L3: debug-only capabilities live in `capabilities/debug/` (the e2e
    // WebDriver one). A release build reads only the top-level files, so that
    // capability — and every grant in it — is not compiled into a shipped app.
    // A custom pattern needs its own rerun-if-changed (tauri-build docs).
    let mut attributes = tauri_build::Attributes::new();
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        println!("cargo:rerun-if-changed=capabilities");
        attributes = attributes.capabilities_path_pattern(RELEASE_CAPABILITIES);
    }
    tauri_build::try_build(
        attributes.app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "github_sign_in",
                "github_open_verification",
                "open_github_url",
                "open_cloud_url",
                "github_is_signed_in",
                "github_sign_out",
                "pick_directory",
                "resolve_dev_server_url",
                "open_local_project",
                "app_is_first_run",
                "app_get_last_project",
                "app_set_last_project",
                "app_recent_projects",
                "restart_to_update",
                "prefs_get_crash_reporting",
                "prefs_set_crash_reporting",
                "prefs_get_claude_auto_setup",
                "prefs_set_claude_auto_setup",
                "save_export",
                "pick_media_file",
                "pick_media_files",
                "read_picked_media",
                "release_picked_media",
                "list_crash_logs",
                "read_crash_log",
                "take_pending_deep_link",
                "managed_project_open",
                "managed_projects_list",
                "resolve_project_for_link",
                "profiles_list",
                "profiles_create",
                "profiles_delete",
                // V2-3.2 window model (windows.rs).
                "open_project",
                // V2-3.3 Home window (home.rs, lib.rs). The Home-only ones are
                // granted by the RUNTIME `home` capability (home::HOME_PERMISSIONS).
                "shell_state",
                // V2-3.6 H1: the Home page secret (Home only).
                "home_session",
                "new_home_tab",
                "take_pending_intent",
                "index_search",
                "relink_project",
                "open_project_folder",
                // V2-3 patches (windows.rs): one-shot values parked per label.
                "take_tabs_restored",
                "take_pending_navigate",
                // Debug-only e2e helpers: Err stubs in release, granted only by
                // capabilities/debug/e2e-webdriver.json (never default.json; not compiled into a release build).
                "window_labels",
                "e2e_focus_window",
                "e2e_close_window",
                "e2e_open_root",
                // V2-3.5 (windows.rs, notify.rs), same rule.
                "e2e_bind_profile",
                "e2e_notification_click",
                // V2-3.6 M5: e2e delivers a deep link through the shell (pages
                // can no longer emit events).
                "e2e_deliver_deep_link",
                // V2-3.6 L1: the "Opened from a link" toast of a NEW tab.
                "take_link_opened",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}

/// Release builds compile only the top-level capability files (V2-3.6 L3).
/// `windows.rs` `capabilities_grant_no_emit_no_profiles_and_no_debug_commands` pins it.
const RELEASE_CAPABILITIES: &str = "./capabilities/*.json";
