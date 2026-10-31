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
                // S3.10b (external_link.rs): a canvas link to a website, after the shell's confirmation.
                "open_link_external",
                "github_is_signed_in",
                "github_sign_out",
                // V2-3.8 (profiles.rs): a Maude Cloud sign-in keeps its project's profile.
                "cloud_sign_in_prepare",
                "cloud_signed_in",
                "pick_directory",
                "resolve_dev_server_url",
                "open_local_project",
                "app_get_last_project",
                "app_set_last_project",
                "app_recent_projects",
                "restart_to_update",
                // V2-4.7c: Settings › Advanced › Check for updates (the menu's check).
                "check_for_updates",
                "prefs_get_crash_reporting",
                "prefs_set_crash_reporting",
                "prefs_get_claude_auto_setup",
                "prefs_set_claude_auto_setup",
                // S8.23 (export_save.rs): Save to, Show in Finder for a saved export, Copy as PNG.
                "save_export",
                "reveal_export",
                "clipboard_write_png",
                "pick_media_file",
                "pick_media_files",
                "read_picked_media",
                "release_picked_media",
                "list_crash_logs",
                "read_crash_log",
                "take_pending_deep_link",
                // S6.7 (profiles.rs, deep_link.rs): Home's own Maude Cloud sign-in
                // and the invite link parked for Home (Home-only, HOME_PERMISSIONS).
                "home_cloud_sign_in_prepare",
                "home_cloud_sign_in_open",
                "home_cloud_signed_in",
                "take_pending_invite",
                // S6.10 (github_home.rs): GitHub from Home (Home-only, HOME_PERMISSIONS).
                "github_repos",
                "home_github_sign_in",
                "github_clone",
                "github_create",
                "managed_project_open",
                "managed_projects_list",
                "resolve_project_for_link",
                "profiles_list",
                "profiles_create",
                "profiles_delete",
                // S1.22b (profiles.rs): the account card's list — own account named, others counted.
                "accounts_list",
                // S5.10 (lib.rs): the AI composer's folder picker (never remembered as an open pick).
                "pick_attach_folder",
                // V2-3.2 window model (windows.rs).
                "open_project",
                // S9.17 (windows.rs): a `409 browser-door` opens the cell as a `c-*` tab.
                "open_cell_tab",
                // S9.17 (notify.rs): a project tab's unread mentions → Dock badge + notice.
                "mention_notice",
                // V2-8.9 M1 (windows.rs): a project tab's web switch → its navigation gate.
                "set_tab_web",
                // V2-3.7 the tab strip (tabs.rs; granted to `strip` only,
                // capabilities/strip.json).
                "tabs_state",
                "tab_activate",
                "tab_close",
                "tab_reorder",
                // S1.22b: the tab menu (native, right-click), Rename…, the tab overview.
                "tab_menu",
                "tab_rename",
                "tab_overview",
                // V2-3.3 Home window (home.rs, lib.rs). The Home-only ones are
                // granted by the RUNTIME `home` capability (home::HOME_PERMISSIONS).
                "shell_state",
                // V2-3.6 H1: the Home page secret (Home only).
                "home_session",
                "new_home_tab",
                "take_pending_intent",
                "index_search",
                // S3.6a (present.rs): displays + the audience window.
                "present_displays",
                "present_audience_open",
                "present_audience_close",
                // S1.5: ⌘K across projects — open another project's result.
                "open_search_result",
                "relink_project",
                // r1 (img 6): New project › Advanced › "Choose another folder…" (Home only).
                "pick_project_location",
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
                // V2-3.7 (tabs.rs): the shell's child bounds after a resize / fullscreen.
                "e2e_shell_bounds",
                // V2-3.9 (menu.rs): click a menu item / read its enablement.
                "e2e_menu_state",
                // V2-3.9 (notify.rs): the dot half of one poll tick.
                "e2e_ai_transition",
                // S5.14 (notify.rs): the Dock badge count (ai-needs-away).
                "e2e_dock_badge",
                // V2-3.5 (windows.rs, notify.rs), same rule.
                "e2e_bind_profile",
                "e2e_notification_click",
                // V2-3.8 (oauth.rs): the real sign-in write path on a fake keychain.
                "e2e_github_sign_in_as",
                // V2-3.6 M5: e2e delivers a deep link through the shell (pages
                // can no longer emit events).
                "e2e_deliver_deep_link",
                // S6.7: run a link through the real routing (debug only).
                "e2e_route_deep_link",
                // V2-3.6 L1: the "Opened from a link" toast of a NEW tab.
                "take_link_opened",
                // Finding 1d (bus.rs): every shell → page message goes through
                // the Channel a page hands this — never an event.
                "shell_subscribe",
                // S5.14 (quit.rs): the asked project tab's answer to the quit dialog.
                "quit_answer",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}

/// Release builds compile only the top-level capability files (V2-3.6 L3).
/// `windows.rs` `capabilities_grant_no_emit_no_profiles_and_no_debug_commands` pins it.
const RELEASE_CAPABILITIES: &str = "./capabilities/*.json";
