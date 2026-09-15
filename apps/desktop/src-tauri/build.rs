fn main() {
    // Declare the app commands in the ACL manifest so they can be GRANTED to the
    // remote dev-server origin in a capability (Phase 28 / DDR-108). Tauri v2 rejects
    // custom-command invokes from a remote (non-local) origin unless the resolved ACL
    // allows the command; declaring them here generates per-command `allow-*`
    // permissions the capability references.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
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
                "list_crash_logs",
                "read_crash_log",
                "take_pending_deep_link",
                "managed_project_open",
                "managed_projects_list",
                "resolve_project_for_link",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}
