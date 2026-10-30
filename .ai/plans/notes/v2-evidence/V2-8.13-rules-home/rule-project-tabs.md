# 00/rule/project-tabs — verified with a recorded deviation

Board rule (00 Index): one tab per project, initial avatar, right-click → Rename… · Move to a new window · Sign in as another account… · Close tab.

Shipped: tab strip with the initial avatar; native right-click menu Rename… · Sign in as another account… · Close tab (apps/desktop/src-tauri/src/tabs.rs `tab_menu_rows`), pinned by `desktop-strip.test.ts` and the Rust test `tab_menu_rows_use_the_registry_labels`.

Deviation, overruled by recorded decisions (the verified bar lets a recorded decision overrule the board):
- kg decision "S1.22b: the tab right-click menu is a native popup built in Rust (Rename… / Sign in as another account… / Close tab)" — "no 'Move to a new window' (V2-3.7 §10)".
- V2-3.7 own tab bar: one native shell window holding every tab (decision v2-3.7-own-tab-bar); §10 question 2 answered "No in v1".
