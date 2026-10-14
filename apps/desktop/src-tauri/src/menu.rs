// Native OS menu (DDR-106 Task 6). Built from the action registry's generated native slice,
// `menu.actions.json` (scripts/gen-actions.mjs — Maude v2 V2-1.3 §5.8, V2-2.4 step 6): the
// registry names each item, its label and its accelerator; this file only turns the slice into
// Tauri menu items. Never add an item here by hand — add it to apps/studio/actions/native-menu.ts
// (+ the action in defs/) and regenerate.
//
// V2-3.4 (C3): File = New Canvas ⌘N · New Project… ⇧⌘N · Open Project… ⌘O · Show Home ⌘T
// (V2-3.9: was New Home Tab) · Close Tab ⌘W, plus a Window menu with the own tab bar's items
// (Show Next / Previous Tab ⌃Tab / ⌃⇧Tab, Tab 1…8 ⌃⌘1…⌃⌘8, Last Tab ⌃⌘9). `apply_role` sets
// what is enabled on every tab activation (contract V2-3.7 §5). A click routes by the item's registry `exec` (§5.8): `shell` items emit
// `menu://action {id}` to the focused window (the webview runs the action), `native` items have
// an arm in lib.rs. `menu://new-project` and `menu://report-bug` are retired.

use serde::Deserialize;
use tauri::menu::{
    AboutMetadataBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder, WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Runtime};

/// Menu-item id for File ▸ Open Project… — the same flow as the `open_project_folder` command.
pub const MENU_OPEN_PROJECT_FOLDER: &str = "open_project_folder";

/// Menu-item id for File ▸ Show Home (`home.open`) — activate the pinned Home (`new_home_tab`).
pub const MENU_SHOW_HOME: &str = "show_home";

/// File ▸ Close Tab ⌘W (`tab.close`) — the strip's × path.
pub const MENU_CLOSE_TAB: &str = "close_tab";
/// Window ▸ Show Next / Previous Tab (`tab.next` / `tab.prev`).
pub const MENU_NEXT_TAB: &str = "next_tab";
pub const MENU_PREV_TAB: &str = "prev_tab";
/// Window ▸ Tab 1…8 (`tab.select-<n>`, id `select_tab_<n>`) and Last Tab (`tab.select-last`).
pub const MENU_SELECT_TAB_PREFIX: &str = "select_tab_";
pub const MENU_SELECT_LAST_TAB: &str = "select_tab_last";

/// What a tab-bar menu item asks the shell to do (lib.rs runs it on `tabs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TabCommand {
    ShowHome,
    Close,
    Next,
    Prev,
    /// Project tab `n` (1-based, strip order).
    Select(usize),
    /// The last project tab.
    Last,
}

/// The tab command a native menu-item id names, if any.
pub fn tab_command(id: &str) -> Option<TabCommand> {
    match id {
        MENU_SHOW_HOME => Some(TabCommand::ShowHome),
        MENU_CLOSE_TAB => Some(TabCommand::Close),
        MENU_NEXT_TAB => Some(TabCommand::Next),
        MENU_PREV_TAB => Some(TabCommand::Prev),
        MENU_SELECT_LAST_TAB => Some(TabCommand::Last),
        _ => id
            .strip_prefix(MENU_SELECT_TAB_PREFIX)
            .and_then(|n| n.parse::<usize>().ok())
            .filter(|n| (1..=8).contains(n))
            .map(TabCommand::Select),
    }
}

/// Which kind of tab is active — what the File menu offers (contract V2-3.7 §5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuRole {
    Home,
    Project,
}

/// The menu items whose enablement follows the active tab.
pub const ROLE_ITEMS: [&str; 7] = [
    "new_canvas",
    "new_project",
    MENU_OPEN_PROJECT_FOLDER,
    MENU_SHOW_HOME,
    MENU_CLOSE_TAB,
    MENU_NEXT_TAB,
    MENU_PREV_TAB,
];

/// Pure: each `ROLE_ITEMS` id and whether it is enabled. On Home, New Canvas (no project to put
/// it in), Show Home (it is showing) and Close Tab (Home never closes) are off; New Project and
/// Open Project stay on. On a project everything is on. Next / Previous need a project tab to go
/// to.
pub fn enablement(role: MenuRole, project_tabs: usize) -> [(&'static str, bool); 7] {
    let project = role == MenuRole::Project;
    let can_cycle = project_tabs > 0;
    [
        ("new_canvas", project),
        ("new_project", true),
        (MENU_OPEN_PROJECT_FOLDER, true),
        (MENU_SHOW_HOME, project),
        (MENU_CLOSE_TAB, project),
        (MENU_NEXT_TAB, can_cycle),
        (MENU_PREV_TAB, can_cycle),
    ]
}

/// A menu item by id, looked up one submenu deep (`Menu::get` does not descend).
fn find_item<R: Runtime>(app: &AppHandle<R>, id: &str) -> Option<tauri::menu::MenuItem<R>> {
    let menu = app.menu()?;
    for top in menu.items().ok()? {
        let Some(sub) = top.as_submenu() else { continue };
        if let Some(it) = sub.get(id).and_then(|k| k.as_menuitem().cloned()) {
            return Some(it);
        }
    }
    None
}

/// Set the File / Window items for the active tab (`tabs::activate`, and every tab-list
/// change). Never call it holding the book lock: menu calls run on the main thread.
pub fn apply_role<R: Runtime>(app: &AppHandle<R>, role: MenuRole, project_tabs: usize) {
    for (id, on) in enablement(role, project_tabs) {
        if let Some(it) = find_item(app, id) {
            let _ = it.set_enabled(on);
        }
    }
}

/// What AppKit reports now for each `ROLE_ITEMS` id (`e2e_menu_state`).
pub fn menu_state<R: Runtime>(app: &AppHandle<R>) -> serde_json::Map<String, serde_json::Value> {
    let mut out = serde_json::Map::new();
    for id in ROLE_ITEMS {
        let v = find_item(app, id)
            .and_then(|it| it.is_enabled().ok())
            .map_or(serde_json::Value::Null, serde_json::Value::Bool);
        out.insert(id.to_string(), v);
    }
    out
}

/// Menu-item id for the Maude ▸ Check for Updates… action (manual update check).
pub const MENU_CHECK_UPDATES: &str = "check_updates";

/// The one event every `exec:'shell'` item sends, payload `{id: <registry id>}`, to the focused
/// window only (V2-1.3 §5.8). The webview runs the action by id — File ▸ New Canvas, New
/// Project… and Help ▸ Report a Bug… (`menu://new-project` and `menu://report-bug` retired).
pub const MENU_ACTION_EVENT: &str = "menu://action";

/// Every item id lib.rs's `on_menu_event` has its own arm for. The slice may route no other id
/// natively. Test-only: lib.rs matches the `MENU_*` constants directly, so keep this list in step
/// with its arms.
#[cfg(test)]
pub const HANDLED_MENU_IDS: [&str; 15] = [
    MENU_OPEN_PROJECT_FOLDER,
    MENU_SHOW_HOME,
    MENU_CHECK_UPDATES,
    MENU_CLOSE_TAB,
    MENU_NEXT_TAB,
    MENU_PREV_TAB,
    "select_tab_1",
    "select_tab_2",
    "select_tab_3",
    "select_tab_4",
    "select_tab_5",
    "select_tab_6",
    "select_tab_7",
    "select_tab_8",
    MENU_SELECT_LAST_TAB,
];

/// The generated slice, embedded at compile time.
const MENU_ACTIONS_JSON: &str = include_str!("../menu.actions.json");

#[derive(Debug, Deserialize)]
struct MenuSpec {
    menus: Vec<SubmenuSpec>,
}

#[derive(Debug, Deserialize)]
struct SubmenuSpec {
    title: String,
    /// The macOS Windows menu (`NSApp.windowsMenu`): AppKit appends the window-tab commands
    /// (Show Previous / Next Tab, Move Tab to New Window, Merge All Windows, Show All Tabs) and
    /// the window list to it.
    #[serde(default)]
    windows_menu: bool,
    items: Vec<ItemSpec>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ItemSpec {
    /// A registry action: `id` is the menu-item id, `action` the registry id.
    Item {
        id: String,
        action: String,
        label: String,
        exec: String,
        #[serde(default)]
        accel: Option<String>,
    },
    /// An OS-provided item (About, Quit, the Edit items WKWebView needs, the Window items).
    Predefined {
        name: String,
        #[serde(default)]
        macos: bool,
    },
    Separator {
        #[serde(default)]
        macos: bool,
    },
}

fn spec() -> MenuSpec {
    serde_json::from_str(MENU_ACTIONS_JSON)
        .expect("menu.actions.json is generated by scripts/gen-actions.mjs and parses")
}

/// What a click on a menu item does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuRoute {
    /// Emit [`MENU_ACTION_EVENT`] `{id}` (the registry id) to the focused window.
    Action(String),
    /// lib.rs's own arm for this menu-item id.
    Native(String),
}

/// The route for a clicked menu-item id, from the generated slice: `exec:'shell'` → `Action`,
/// otherwise `Native`. `None` for an id the slice does not name — a predefined item, which
/// AppKit handles itself.
pub fn route(menu_id: &str) -> Option<MenuRoute> {
    spec()
        .menus
        .into_iter()
        .flat_map(|m| m.items)
        .find_map(|i| match i {
            ItemSpec::Item {
                id, action, exec, ..
            } if id == menu_id => Some(if exec == "shell" {
                MenuRoute::Action(action)
            } else {
                MenuRoute::Native(id)
            }),
            _ => None,
        })
}

/// The window a `menu://action` goes to: the focused one, with no fallback — a menu action with
/// no focused window does nothing rather than land in a background tab (unlike `front_label`).
pub fn action_target(book: &crate::windows::WindowBook) -> Option<String> {
    book.focused().map(str::to_string)
}

/// [`WINDOW_SUBMENU_ID`] on the Window submenu is what makes Tauri's `init_app_menu` call
/// `set_as_windows_menu_for_nsapp` on it (tauri 2.12 app.rs), which turns on AppKit's window-tab
/// items and window list.
fn submenu_id(menu: &SubmenuSpec) -> Option<&'static str> {
    menu.windows_menu.then_some(WINDOW_SUBMENU_ID)
}

/// Build the application menu. The first submenu becomes the macOS app menu.
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let mut submenus = Vec::new();
    for menu in spec().menus {
        let mut b = match submenu_id(&menu) {
            Some(id) => SubmenuBuilder::with_id(app, id, &menu.title),
            None => SubmenuBuilder::new(app, &menu.title),
        };
        for item in menu.items {
            b = match item {
                ItemSpec::Item {
                    id, label, accel, ..
                } => {
                    let mut it = MenuItemBuilder::with_id(id, label);
                    if let Some(accel) = accel {
                        it = it.accelerator(accel);
                    }
                    b.item(&it.build(app)?)
                }
                // Undo / Redo (and the separator after them) and Bring All to Front are
                // macOS-only — unsupported on Windows / Linux.
                ItemSpec::Predefined { macos: true, .. } | ItemSpec::Separator { macos: true }
                    if !cfg!(target_os = "macos") =>
                {
                    b
                }
                ItemSpec::Predefined { name, .. } => match name.as_str() {
                    "about" => b.about(Some(
                        AboutMetadataBuilder::new()
                            .name(Some("Maude"))
                            .version(Some(env!("CARGO_PKG_VERSION")))
                            .build(),
                    )),
                    "quit" => b.quit(),
                    "undo" => b.undo(),
                    "redo" => b.redo(),
                    "cut" => b.cut(),
                    "copy" => b.copy(),
                    "paste" => b.paste(),
                    "select_all" => b.select_all(),
                    "minimize" => b.minimize(),
                    "zoom" => b.maximize(),
                    "bring_all_to_front" => b.bring_all_to_front(),
                    other => panic!("menu.actions.json: unknown predefined item `{other}`"),
                },
                ItemSpec::Separator { .. } => b.separator(),
            };
        }
        submenus.push(b.build()?);
    }
    let refs: Vec<&dyn tauri::menu::IsMenuItem<R>> = submenus
        .iter()
        .map(|s| s as &dyn tauri::menu::IsMenuItem<R>)
        .collect();
    MenuBuilder::new(app).items(&refs).build()
}

/// Debug-only e2e helper (V2-3.9 T7): optionally click a native menu item by id (`click`, the
/// same `on_menu` path AppKit's click takes — WebDriver keys never reach the menu bar), then
/// answer AppKit's enablement of every `ROLE_ITEMS` id and the active tab. Granted only by
/// capabilities/debug/e2e-webdriver.json; a release build answers Err.
#[tauri::command]
pub async fn e2e_menu_state(
    app: tauri::AppHandle,
    click: Option<String>,
) -> Result<serde_json::Value, String> {
    #[cfg(debug_assertions)]
    {
        if let Some(id) = click {
            if route(&id).is_none() {
                return Err(format!("no menu item {id}"));
            }
            let a = app.clone();
            app.run_on_main_thread(move || crate::on_menu(&a, &id))
                .map_err(|e| e.to_string())?;
            // The click's activation, then `changed`'s debounced menu refresh.
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        }
        let active = tauri::Manager::try_state::<crate::sidecar::SidecarState>(&app)
            .and_then(|s| {
                s.windows
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .focused()
                    .map(str::to_string)
            });
        Ok(serde_json::json!({ "active": active, "enabled": menu_state(&app) }))
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (app, click);
        Err("debug builds only".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::windows::{Role, WindowBook};

    fn items() -> Vec<(String, String, Option<String>)> {
        spec()
            .menus
            .into_iter()
            .flat_map(|m| {
                let title = m.title;
                m.items.into_iter().filter_map(move |i| match i {
                    ItemSpec::Item { id, accel, .. } => Some((title.clone(), id, accel)),
                    _ => None,
                })
            })
            .collect()
    }

    #[test]
    fn menu_actions_every_native_item_has_a_handler_arm() {
        for (_, id, _) in items() {
            if let Some(MenuRoute::Native(n)) = route(&id) {
                assert!(
                    HANDLED_MENU_IDS.contains(&n.as_str()),
                    "menu.actions.json item `{n}` has no arm in lib.rs on_menu_event"
                );
            }
        }
        let ids: Vec<String> = items().into_iter().map(|(_, id, _)| id).collect();
        for handled in HANDLED_MENU_IDS {
            assert!(
                ids.iter().any(|i| i == handled),
                "handled id `{handled}` is not in the menu"
            );
            assert_eq!(route(handled), Some(MenuRoute::Native(handled.into())));
        }
    }

    #[test]
    fn menu_actions_file_menu_per_c3() {
        let titles: Vec<String> = spec().menus.into_iter().map(|m| m.title).collect();
        assert_eq!(titles, ["Maude", "File", "Edit", "Window", "Help"]);
        assert_eq!(
            items(),
            vec![
                ("Maude".into(), "check_updates".into(), None),
                (
                    "File".into(),
                    "new_canvas".into(),
                    Some("CmdOrCtrl+N".into())
                ),
                (
                    "File".into(),
                    "new_project".into(),
                    Some("CmdOrCtrl+Shift+N".into())
                ),
                (
                    "File".into(),
                    "open_project_folder".into(),
                    Some("CmdOrCtrl+O".into())
                ),
                ("File".into(), "show_home".into(), Some("CmdOrCtrl+T".into())),
                ("File".into(), "close_tab".into(), Some("CmdOrCtrl+W".into())),
                ("Window".into(), "next_tab".into(), Some("Ctrl+Tab".into())),
                ("Window".into(), "prev_tab".into(), Some("Ctrl+Shift+Tab".into())),
                ("Window".into(), "select_tab_1".into(), Some("CmdOrCtrl+Ctrl+1".into())),
                ("Window".into(), "select_tab_2".into(), Some("CmdOrCtrl+Ctrl+2".into())),
                ("Window".into(), "select_tab_3".into(), Some("CmdOrCtrl+Ctrl+3".into())),
                ("Window".into(), "select_tab_4".into(), Some("CmdOrCtrl+Ctrl+4".into())),
                ("Window".into(), "select_tab_5".into(), Some("CmdOrCtrl+Ctrl+5".into())),
                ("Window".into(), "select_tab_6".into(), Some("CmdOrCtrl+Ctrl+6".into())),
                ("Window".into(), "select_tab_7".into(), Some("CmdOrCtrl+Ctrl+7".into())),
                ("Window".into(), "select_tab_8".into(), Some("CmdOrCtrl+Ctrl+8".into())),
                ("Window".into(), "select_tab_last".into(), Some("CmdOrCtrl+Ctrl+9".into())),
                ("Help".into(), "report_bug".into(), None),
            ]
        );
        // No two items share an accelerator.
        let mut accels: Vec<String> = items().into_iter().filter_map(|(_, _, a)| a).collect();
        let n = accels.len();
        accels.sort();
        accels.dedup();
        assert_eq!(accels.len(), n, "a duplicated accelerator");
    }

    #[test]
    fn menu_ids_route_to_their_commands_and_events() {
        // exec:'shell' → `menu://action {id}` with the REGISTRY id.
        assert_eq!(
            route("new_canvas"),
            Some(MenuRoute::Action("canvas.new".into()))
        );
        assert_eq!(
            route("new_project"),
            Some(MenuRoute::Action("project.new".into()))
        );
        assert_eq!(
            route("report_bug"),
            Some(MenuRoute::Action("help.report-bug".into()))
        );
        // exec:'native' → lib.rs's arm (the open_project_folder / new_home_tab commands' flows).
        assert_eq!(
            route("open_project_folder"),
            Some(MenuRoute::Native(MENU_OPEN_PROJECT_FOLDER.into()))
        );
        assert_eq!(
            route("show_home"),
            Some(MenuRoute::Native(MENU_SHOW_HOME.into()))
        );
        assert_eq!(route("new_home_tab"), None, "renamed to Show Home");
        assert_eq!(
            route("close_tab"),
            Some(MenuRoute::Native(MENU_CLOSE_TAB.into()))
        );
        assert_eq!(
            route("check_updates"),
            Some(MenuRoute::Native(MENU_CHECK_UPDATES.into()))
        );
        // v1's ids are gone.
        assert_eq!(route("open_project"), None);
        assert_eq!(route("minimize"), None);
    }

    #[test]
    fn menu_new_project_and_report_bug_events_are_retired() {
        // Nothing in the shell sends the v1 events any more; New Project… and Report a Bug…
        // travel as `menu://action {id}`.
        for (name, src) in [
            ("menu.actions.json", MENU_ACTIONS_JSON),
            ("lib.rs", include_str!("lib.rs")),
            ("windows.rs", include_str!("windows.rs")),
            ("home.rs", include_str!("home.rs")),
        ] {
            for retired in ["menu://new-project", "menu://report-bug"] {
                assert!(!src.contains(retired), "{name} still sends {retired}");
            }
        }
    }

    #[test]
    fn menu_action_goes_to_the_focused_window_only() {
        let mut book = WindowBook::default();
        assert_eq!(action_target(&book), None);
        book.insert("home", Role::Home, 1);
        book.insert(
            "p-a",
            Role::Project {
                pid: "a".into(),
                root: "/a".into(),
            },
            2,
        );
        // Nothing focused yet: front_label would fall back to the oldest window — a menu
        // action must not.
        assert!(book.front_label().is_some());
        assert_eq!(action_target(&book), None);
        book.focus("p-a", 3);
        assert_eq!(action_target(&book).as_deref(), Some("p-a"));
        book.focus("home", 4);
        assert_eq!(action_target(&book).as_deref(), Some("home"));
    }

    #[test]
    fn menu_role_home_disables_new_canvas_show_home_and_close_tab() {
        let on = |role, n| {
            enablement(role, n)
                .into_iter()
                .filter(|(_, e)| *e)
                .map(|(id, _)| id)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            on(MenuRole::Home, 2),
            ["new_project", "open_project_folder", "next_tab", "prev_tab"],
            "Home: New Project works, New Canvas / Show Home / Close Tab do not"
        );
        assert_eq!(on(MenuRole::Project, 2), ROLE_ITEMS, "a project: everything");
        // Home with no project tab: nowhere to cycle to.
        assert_eq!(on(MenuRole::Home, 0), ["new_project", "open_project_folder"]);
        // Every role item is in the menu.
        let ids: Vec<String> = items().into_iter().map(|(_, id, _)| id).collect();
        for id in ROLE_ITEMS {
            assert!(ids.iter().any(|i| i == id), "{id} is not in the menu");
        }
    }

    #[test]
    fn menu_tab_commands_parse_from_their_item_ids() {
        assert_eq!(tab_command("show_home"), Some(TabCommand::ShowHome));
        assert_eq!(tab_command("close_tab"), Some(TabCommand::Close));
        assert_eq!(tab_command("next_tab"), Some(TabCommand::Next));
        assert_eq!(tab_command("prev_tab"), Some(TabCommand::Prev));
        assert_eq!(tab_command("select_tab_1"), Some(TabCommand::Select(1)));
        assert_eq!(tab_command("select_tab_8"), Some(TabCommand::Select(8)));
        assert_eq!(tab_command("select_tab_last"), Some(TabCommand::Last));
        for bad in ["select_tab_0", "select_tab_9", "select_tab_x", "new_canvas", "check_updates"] {
            assert_eq!(tab_command(bad), None, "{bad}");
        }
        // Every native tab item of the menu parses.
        for (_, id, _) in items() {
            if id.starts_with(MENU_SELECT_TAB_PREFIX) || id.ends_with("_tab") || id == "show_home" {
                assert!(tab_command(&id).is_some(), "{id}");
            }
        }
    }

    #[test]
    fn menu_window_menu_is_the_nsapp_windows_menu_with_predefined_items() {
        let window = spec()
            .menus
            .into_iter()
            .find(|m| m.title == "Window")
            .expect("a Window menu");
        assert_eq!(submenu_id(&window), Some(WINDOW_SUBMENU_ID));
        let names: Vec<String> = window
            .items
            .iter()
            .map(|i| match i {
                ItemSpec::Predefined { name, .. } => name.clone(),
                ItemSpec::Separator { .. } => "-".into(),
                ItemSpec::Item { id, .. } => format!("item:{id}"),
            })
            .collect();
        assert_eq!(
            names,
            [
                "minimize",
                "zoom",
                "-",
                "item:next_tab",
                "item:prev_tab",
                "-",
                "item:select_tab_1",
                "item:select_tab_2",
                "item:select_tab_3",
                "item:select_tab_4",
                "item:select_tab_5",
                "item:select_tab_6",
                "item:select_tab_7",
                "item:select_tab_8",
                "item:select_tab_last",
                "-",
                "bring_all_to_front"
            ]
        );
        // Only the Window menu is the windows menu.
        let others = spec()
            .menus
            .into_iter()
            .filter(|m| submenu_id(m).is_some())
            .count();
        assert_eq!(others, 1);
    }
}
