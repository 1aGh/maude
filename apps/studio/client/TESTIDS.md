# Studio DOM hook contract

This file lists every DOM hook in the Maude studio UI that something outside the component that renders it depends on: every `data-testid` the client and the canvas chrome emit, every `data-tour` anchor, and every other selector (class, `aria-label`, role, data attribute, text) that a desktop e2e scenario, a studio test, a tour, a What's New spotlight, a script or a scenario spec targets. It exists so that the move-only split of `client/app.jsx` (plan task V2-0.2) and the v2 reshell (Phase 4) can prove that they kept each hook.

**The rule** (plan `.ai/plans/feature-maude-v2-redesign.md`, rule 5): testids are an API. Re-emit an existing `data-testid` on the v2 element that carries the same meaning; new ones follow `<area>-<thing>[-<id>]`, kebab-case. Update tours (`data-tour`) and What's New spotlight targets in the same change.

**Keeping it current:** a change that renames, removes or moves a hook updates this file and [`testids.json`](testids.json) in the same commit. A new hook that a scenario, tour or spotlight needs is added here when it is added to the component.

`testids.json` holds the same data as an array of `{hook, kind, pattern, meaning, producer: {file, symbol}, region, consumers, v2}` (plus `alsoProducedBy`, `sourceConsumers`, `notes`, `dangling` where they apply), so a test can assert that every consumer resolves to a producer. `producer` is `null` only on the `dangling: true` entries. A `selector` entry whose hook is a phrase rather than a CSS selector (for example `menuitem by name (row menu)` or `Tool palette buttons`) groups accessible-name locators; its meaning lists the names.

Inventory taken on 2026-10-09 from the tree at `aec26e06`. Producers are named by file and component, never by line, because lines move.

## How to read the tables

- **Hook.** A bare name is a `data-testid` (selector `[data-testid="<name>"]`). `[data-tour="…"]` is a tour anchor. Anything else is a CSS selector or an accessible-name locator. `<slug>`, `<id>`, `<i>` and similar mark the dynamic part of a pattern; the meaning says how it is built.
- **Producer.** `file` · `component` that emits the hook, paths relative to `apps/studio/`. A second line is another emitter of the same hook.
- **Consumers.** Abbreviated paths:
  `e2e:<name>` = `apps/desktop/e2e/scenarios/<name>.e2e.ts`; `e2e-mp:<name>` = `apps/desktop/e2e/multiplayer/<name>` (`surface` = `surface.e2e.ts`); `e2e-helper:<name>` = `apps/desktop/e2e/helpers/<name>.ts`;
  `test:<name>` = `apps/studio/test/<name>.test.ts(x)`; `test-e2e:<file>` = `apps/studio/test/e2e/<file>`; `tour:<name>` = `apps/studio/client/tour/<name>.js`; `whats-new` = `apps/studio/whats-new.json`;
  `spec:<slug>` = `.ai/scenarios/<slug>/spec.md`; `runner:<slug>/<file>` = `.ai/scenarios/<slug>/runners/<file>`; `bin:<file>` = `apps/studio/bin/<file>`; `frame-probe` = `apps/desktop/src-tauri/src/e2e-frame-probe.js` (debug-only init script); `skill:desktop-e2e` = `.claude/skills/desktop-e2e/SKILL.md`; `app.jsx` = an internal cross-component query in `client/app.jsx`.
  "(source text)" = the test reads the source file and greps for the hook, so it breaks on a pure move (see [Source-text consumers](#source-text-consumers)).
- **v2** (from `.ai/plans/notes/v2-inventory/F-codebase-survey.md` §5, extended to every hook): **stable — re-emit** = the element keeps its meaning in v2 and must carry the same hook; **moves — map in Phase 4** = its region is replaced by the v2 shell (menubar, status bar, dock, bottom-of-sidebar switcher and cloud rail, banners, ⌘K, inspector container, onboarding, export, timeline, settings, palette mode switch), so the hook and every consumer get a v2 equivalent in the Phase 4 change that moves it; **retired** (V2-4.8a) = the element was deleted with the in-app menubar; the row's meaning says where its job went and its consumers were re-pointed;
  **historical** = no live element (spotlight or consumer of DOM that is gone).

## Hooks by region

### menubar

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `menubar` | testid | The in-app menubar row (top chrome of the shell). *Deleted: the shell starts with the project pill (`project-pill`) and the Share cluster.* | `client/menus/menubar.jsx` · `Menubar` (deleted) | — | retired — V2-4.8a |
| `menu-<key>` | testid (pattern) | One top-level menu trigger of the menubar (file, edit, view, selection, tools, help). *File · Edit · View · Help are now submenu rows of the project pill's menu (`project-menu-row-sub-<name>`); Selection's two rows are in Edit, Tools are the canvas toolbar's slots.* | `client/menus/menubar.jsx` · `Menubar` (deleted) | — | retired — V2-4.8a |
| `cloud-back` | testid | Cloud shell only: the "← Dashboard" back link. *Now the project menu's "Back to Home" row in a cloud tab (`project-menu-row-nav.home`); a hub with no dashboard leaves the row out.* | `client/menus/menubar.jsx` · `Menubar` (deleted) | — | retired — V2-4.8a |
| `cloud-project-name` | testid | Cloud shell only: the project name shown next to the back link. *The project pill carries it (`project-pill`, `.st-pill-name`).* | `client/menus/menubar.jsx` · `Menubar` (deleted) | — | retired — V2-4.8a |
| `view-only-stamp` | testid | The "View only" stamp for a read-only (viewer) session. *Now the access word in the Share cluster (`share-cluster-status`, `data-status="access"`).* | `client/menus/menubar.jsx` · `Menubar` (deleted) | — | retired — V2-4.8a |
| `cloud-account` | testid | Signed-in cloud account control: the account menu button in the sidebar cloud rail. *V2-4.8a: the menubar account chip (the second emitter) is deleted; a cloud tab's account is the email on project menu › File › "Sign in as another account…".* | `client/panels/CloudBar.jsx` · `CloudBar` | e2e:cloud-attach | moves — map in Phase 4 |
| `cloud-signout` | testid | Cloud shell only: the sign-out button next to the account chip. *Now project menu › File › "Sign in as another account…" in a cloud tab (`project-menu-row-account.switch`): a form POST to `/auth/browser/signout`; the row shows the account email.* | `client/menus/menubar.jsx` · `Menubar` (deleted) | — | retired — V2-4.8a |
| `assistant-toggle` | testid | Menubar button that opened/closed the Assistant (ACP chat). *Now the AI chat's own island: `ai-chat-header` while it shows, the spark corner icon `panel-icon-assistant` while it is folded; `e2e-helper:assistant` reads both.* | `client/menus/menubar.jsx` · `Menubar` (deleted) | — | retired — V2-4.8a |
| `share-btn` | testid | Menubar Share button. *Now `share-cluster-share` (the Share cluster's primary button).* | `client/menus/menubar.jsx` · `Menubar` (deleted) | whats-new | retired — V2-4.8a |
| `report-bug-toggle` | testid | Menubar bug icon. *Now Menu › Help › Report a bug… (`project-menu-row-help.report-bug`).* | `client/menus/menubar.jsx` · `Menubar` (deleted) | — | retired — V2-4.8a |
| `[data-tour="brand"]` | data-tour | The maude mark in the project pill. *Re-emitted V2-4.8a (was the menubar wordmark).* | `client/v2/shell/project-pill.jsx` · `ProjectPill` | whats-new | stable — re-emit |
| `[data-tour="menus"]` | data-tour | The project pill button that opens the one menu. *Re-emitted V2-4.8a (was the menubar's six-menu group).* | `client/v2/shell/project-pill.jsx` · `ProjectPill` | tour:usage-tour, whats-new | stable — re-emit |
| `[data-tour="help"]` | data-tour | The Help menu trigger. *Help is a submenu of the project pill's menu (`project-menu-row-sub-help`).* | `client/menus/menubar.jsx` · `Menubar` (deleted) | whats-new | retired — V2-4.8a |
| `[data-tour="status"]` | data-tour | The Share cluster (faces, status word, comments, mode switch, Exports, Hide panels, Share). *Re-emitted V2-4.8a on the cluster root (was the menubar's right-hand cluster).* | `client/v2/shell/share-cluster.jsx` · `ShareCluster` | tour:collab-tour, whats-new | stable — re-emit |
| `[data-tour="whatsnew"]` | data-tour | The What's New button of the menubar. *Now Menu › Help › What's new (`project-menu-row-help.whats-new`); the Help row carries the unseen count as its status word. `WhatsNewBadge` still emits the anchor but is exported and never mounted.* | `client/whats-new.jsx` · `WhatsNewBadge` | whats-new | retired — V2-4.8a |
| `[data-tour="exports"]` | data-tour | The Exports icon in the Share cluster (`data-busy`); opens the export job list. *Re-emitted V2-4.8a; present once any export exists (the v1 menubar badge was always there).* | `client/v2/shell/share-cluster.jsx` · `ShareCluster` | whats-new | stable — re-emit |
| `.st-menus` | selector | The menu-trigger group of the menubar. *Deleted: there is no menubar landmark; the project menu is a popup `role=menu` (`test/shell-accessibility.test.ts` pins that).* | `client/menus/menubar.jsx` · `Menubar` (deleted) | — | retired — V2-4.8a |
| `.st-menubar` | selector | The outer menubar row. *Deleted.* | `client/menus/menubar.jsx` · `Menubar` (deleted) | — | retired — V2-4.8a |
| `.st-dd-item` | selector | A dropdown row in the tree row menu (`.st-dropdown`). *The menubar dropdowns that shared it are deleted (V2-4.8a).* | `client/tree-row-menu.jsx` · `TreeRowMenu` | — | moves — map in Phase 4 |
| `.st-mb-proj` | selector | Menubar project name text. *The pill's name is `.st-pill-name`.* | `client/menus/menubar.jsx` · `Menubar` (deleted) | — | retired — V2-4.8a |
| `.st-cloudwho-out` | selector | Cloud account sign-out text in the menubar. *See `cloud-signout`.* | `client/menus/menubar.jsx` · `Menubar` (deleted) | — | retired — V2-4.8a |
| menuitem by name (menubar) | selector | Menubar triggers and dropdown rows reached by accessible name. *Now the same rows in the project pill's menu, by `role=menuitem` and name: "File", "Edit", "Advanced", "New artboard" (submenus), "Close canvas", "New artboard: Mobile" (rows); `surface.e2e.ts` `Surface.menu(text)`.* | `client/v2/shell/project-pill.jsx` · `ProjectPill` | e2e-mp:surface | retired — V2-4.8a |

### status bar

Retired in V2-4.8b: the bottom `footer.st-statusbar` is gone, and with it `statusbar`, `statusbar-sync`, `statusbar-version`, `open-changes`, `open-sync`, `.st-sb-sync`, `.st-sb-sel`, `.st-sb-theme`, `.st-sb-slot`, `.st-sb-version`, `[aria-label="Selected element"]`, `[aria-label="Clear selection"]` and the theme button. Where each slot went:

| Slot | v2 home | Hook |
| --- | --- | --- |
| active file path | Canvases panel › Advanced › Open canvas | `canvases-active-path` |
| selected element | Inspector header (selector + text) | `inspector-selection`, `inspector-selection-text` |
| open comments | Share cluster Comments badge | `share-cluster-comments-count` |
| changes chip (N unsaved) | Menu › Version history (opens the Changes panel; `git-panel` is its root) | `project-menu-row-history.open`, `git-panel` |
| live / reconnecting dot | Menu › Diagnostics › Server | `diag-live` |
| hub sync chip | Share cluster word (`data-status`) and Menu › Diagnostics › Sync | `share-cluster-status`, `project-menu-status-diag.sync` |
| `v<version>` | Settings › Advanced › This Mac › Version | `settings-app-version` |
| light / dark toggle | Settings › General › Look › Theme | `settings-theme` |

### sidebar/tree

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `canvas-list` | testid | The project file tree (`FileTree`, `role="tree"`, class `st-tree`) in the sidebar. | `client/app.jsx` · `Sidebar` | spec:app-boots-and-renders-canvas, skill:desktop-e2e, e2e:app-boots-and-renders-canvas, e2e:backspace-no-active-canvas-no-hang, e2e:canvas-text-editing, e2e:cloud-attach, e2e:export-formats, e2e:file-tree-move, e2e:s20-deployment, e2e:shell-parity, e2e:sidecar-respawn-canvas-switch, e2e:splash-recovers-after-return-to-entry, test:export-e2e-lanes, test:shell-accessibility (source text) | stable — re-emit |
| `canvas-search` | testid | The sidebar search box that filters the tree. | `client/app.jsx` · `Sidebar` | e2e:shell-parity | stable — re-emit |
| `canvas-row-<slug>` | testid (pattern) | A canvas row in the tree (`role="treeitem"`). `<slug>` = the path with the leading designRoot dot-folder and the canvas extension stripped, non-alphanumerics → `-`, lower-cased (`.design/ui/Smoke.tsx` → `canvas-row-ui-smoke`). *Built inline in `FileRow` (same rule as `pathTestIdSlug`). A canvas with sidecars rendered by `CanvasRow` while "show hidden files" is on gets NO `canvas-row-*` id. `App()` clicks `.st-sidebar [data-testid^="canvas-row-"]` to open the first canvas.* | `client/app.jsx` · `FileRow` | spec:app-boots-and-renders-canvas, spec:artboard-kinds, runner:reliable-project-multiplayer/f3/peer-render.mjs, runner:reliable-project-multiplayer/f3/s09-browser.mjs, runner:reliable-project-multiplayer/f3/s11-browser.mjs, runner:reliable-project-multiplayer/f3/s19-browser.mjs, runner:video-timeline-badge/web-desktop.sh, spec:video-timeline-badge, spec:web-artboards, skill:desktop-e2e, e2e-helper:tree, e2e-mp:cloud-entry, e2e-mp:selfhost-entry, e2e-mp:surface, e2e:app-boots-and-renders-canvas, e2e:canvas-text-editing, e2e:export-formats, e2e:file-tree-move, e2e:onboarding, e2e:s20-deployment, e2e:share-link, e2e:shell-parity, e2e:sidecar-respawn-canvas-switch, e2e:team-project, e2e:timeline-manual-cut, bin:_perf-probe-safari.mjs, bin:screenshot.sh, app.jsx, test:export-e2e-lanes | stable — re-emit |
| `file-row-<slug>` | testid (pattern) | A supporting (non-canvas) file row inside a canvas folder (notes, styles, images, media). `<slug>` from `pathTestIdSlug`. | `client/app.jsx` · `FileRow` | e2e-mp:surface | stable — re-emit |
| `tree-folder-<slug>` | testid (pattern) | A folder row in the tree; `aria-expanded` = open. `<slug>` from `pathTestIdSlug(dirPath)`. | `client/app.jsx` · `DirRow` | e2e-helper:tree, e2e-mp:surface, e2e:file-tree-move, test:export-e2e-lanes | stable — re-emit |
| `tree-row-menu-<slug>` | testid (pattern) | The "⋯" row-menu trigger on a folder, file or canvas row. `<slug>` from `pathTestIdSlug`. | `client/app.jsx` · `DirRow`<br>`client/app.jsx` · `FileRow`<br>`client/app.jsx` · `CanvasRow` | e2e-mp:surface, e2e:share-link | stable — re-emit |
| `tree-section-<label>` | testid (pattern) | A top-level tree section header (e.g. `tree-section-design-system`); `aria-expanded` = open. `<label>` = group label lower-cased, non-alphanumerics → `-`. | `client/app.jsx` · `Sidebar` | e2e-helper:tree, e2e-mp:surface, test:export-e2e-lanes | stable — re-emit |
| `tree-loading` | testid | The tree loading/failed-to-load placeholder (`role="status"`). | `client/app.jsx` · `TreeLoading` | — | stable — re-emit |
| `tree-new-folder` | testid | The sidebar "new folder" button. | `client/app.jsx` · `Sidebar` | e2e-mp:surface, e2e:file-tree-move | stable — re-emit |
| `[data-tour="sidebar"]` | data-tour | The whole left sidebar `aside.st-sidebar`. | `client/app.jsx` · `Sidebar` | tour:quick-setup-tour, tour:usage-tour | moves — map in Phase 4 |
| `.st-tree` | selector | The file tree element (same element as `canvas-list`). | `client/file-tree.jsx` · `FileTree` | skill:desktop-e2e | stable — re-emit |
| `.st-sb-title` | selector | The sidebar title row (clicked to dismiss an open row menu). "sb" means sidebar here, not status bar. | `client/app.jsx` · `Sidebar` | e2e-mp:surface | moves — map in Phase 4 |
| `[role="tree"] / [role="treeitem"]` | selector | Tree semantics of the file tree and its rows (`file-tree-navigation` drives keyboard navigation by role and `aria-label`). | `client/file-tree.jsx` · `FileTree`<br>`client/app.jsx` · `FileRow`<br>`client/app.jsx` · `DirRow`<br>`client/app.jsx` · `CanvasRow` | test:file-tree-navigation | stable — re-emit |
| `[aria-expanded] on tree rows` | selector | Open/closed state of `tree-section-*` / `tree-folder-*` rows; `expandTree()` clicks every `[aria-expanded="false"]` one. | `client/app.jsx` · `DirRow`<br>`client/app.jsx` · `Sidebar` | e2e-helper:tree, e2e-mp:surface, test:export-e2e-lanes | stable — re-emit |
| `[aria-label="Create folder"]` | selector | Confirm button of the new-folder row. | `client/app.jsx` · `Sidebar` | e2e-mp:surface | stable — re-emit |
| `[aria-label="New folder name"]` | selector | Name input of the new-folder row. | `client/app.jsx` · `Sidebar` | e2e-mp:surface, e2e:file-tree-move | stable — re-emit |
| `[aria-label="New blank brief board"]` | selector | Sidebar button that starts a new blank brief board. *`App()` also clicks it by this selector from three places (⌘K action, menu action, empty state).* | `client/app.jsx` · `Sidebar` | e2e-mp:cloud-entry, e2e-mp:selfhost-entry, e2e-mp:surface, app.jsx | stable — re-emit |
| `[aria-label="New brief board name"]` | selector | Name input for the new brief board. | `client/app.jsx` · `Sidebar` | e2e-mp:cloud-entry, e2e-mp:selfhost-entry, e2e-mp:surface | stable — re-emit |
| `[aria-label="Create brief board"]` | selector | Confirm button for the new brief board. | `client/app.jsx` · `Sidebar` | e2e-mp:cloud-entry, e2e-mp:selfhost-entry, e2e-mp:surface | stable — re-emit |
| `[aria-label="Delete canvas <name>"]` | selector | Delete button on a canvas row (`[aria-label^="Delete canvas"]` matches any). | `client/app.jsx` · `FileRow` | e2e-mp:surface, e2e:s20-deployment | stable — re-emit |
| `.st-search input` | selector | The sidebar search input (focused by keyboard handlers in `App()`). *Internal cross-component consumer: `App()`.* | `client/app.jsx` · `Sidebar` | app.jsx | stable — re-emit |
| `.st-sidebar [data-testid^="canvas-row-"]` | selector | First canvas row inside the sidebar; `App()` clicks it to open a canvas. *Internal cross-component consumer: `App()`.* | `client/app.jsx` · `Sidebar` | app.jsx | stable — re-emit |
| menuitem by name (row menu) | selector | Tree row-menu items by accessible name: "Rename…", "Duplicate", "Move to…", "Delete", "New folder here", "Rename folder", "Delete folder", "Share…", and Move-to destinations named `ui/<folder>`. *Labels are defined in `Sidebar` (row-menu items) and rendered by `TreeRowMenu`. `share-link` uses the WebdriverIO text selector `button=Share…`; `surface.e2e.ts` uses `getByRole('menuitem', { name })`.* S1.2: a canvas row in the Canvases panel has its own menu (`canvas-row-menu`): "Open", "Pin"/"Unpin", "Rename", "Duplicate", "Move to…", "Copy link", "Move to trash". | `client/app.jsx` · `Sidebar`<br>`client/tree-row-menu.jsx` · `TreeRowMenu` | e2e-mp:surface, e2e:share-link | stable — re-emit |
| `canvases-pinned` | testid | The pinned strip above the Canvases list that holds the Design system row(s). | `client/v2/left-panel/canvases-pinned.jsx` · `DsPinnedRows` | — | stable — re-emit |
| `canvases-ds-row` | testid | A pinned Design system row (one per system; `data-ds` carries the system). Click opens the design-system view (the old S key). | `client/v2/left-panel/canvases-pinned.jsx` · `DsPinnedRows` | — | stable — re-emit |
| `canvases-trash-row` | testid | The Canvases panel's last row: Trash and its count. Click opens the Trash list. | `client/v2/left-panel/canvases-pinned.jsx` · `TrashRow` | — | stable — re-emit |
| `canvases-trash` | testid | The Trash list that replaces the Canvases list while it is open. | `client/v2/left-panel/trash-view.jsx` · `TrashView` | — | stable — re-emit |
| `canvases-trash-back` | testid | Back from the Trash list to the Canvases list. | `client/v2/left-panel/trash-view.jsx` · `TrashView` | — | stable — re-emit |
| `canvases-trash-empty` | testid | The "Trash is empty." state. | `client/v2/left-panel/trash-view.jsx` · `TrashView` | — | stable — re-emit |
| `canvases-trash-item` | testid | One parked thing in the Trash list. | `client/v2/left-panel/trash-view.jsx` · `TrashView` | — | stable — re-emit |
| `canvases-trash-restore` | testid | Restore on a Trash item (hidden for a viewer). | `client/v2/left-panel/trash-view.jsx` · `TrashView` | — | stable — re-emit |
| `canvases-trash-clear` | testid | "Clear out…" in the Trash foot (hidden for a viewer); asks before it does anything. | `client/v2/left-panel/trash-view.jsx` · `TrashView` | — | stable — re-emit |
| `canvases-trash-ask` | testid | The "Clear out the trash?" confirmation. | `client/v2/left-panel/trash-view.jsx` · `TrashView` | — | stable — re-emit |
| `canvases-trash-clear-yes` | testid | The primary button of the clear-out confirmation. | `client/v2/left-panel/trash-view.jsx` · `TrashView` | — | stable — re-emit |
| `canvases-trash-count` | testid | Trash view header: what is in the shared Trash, "3 canvases · 1 artboard" (only the parts there are). | `client/v2/left-panel/trash-view.jsx` · `TrashView` | test:v2-trash-view | new (S1.8) |
| `canvases-trash-group-today` | testid | Trash view: the Today group (heading + its rows). Absent while nothing was trashed today. | `client/v2/left-panel/trash-view.jsx` · `TrashView` | test:v2-trash-view | new (S1.8) |
| `canvases-trash-group-earlier` | testid | Trash view: the Earlier group (heading + its rows). Absent while nothing is older. | `client/v2/left-panel/trash-view.jsx` · `TrashView` | test:v2-trash-view | new (S1.8) |
| `canvases-trash-sub` | testid | A Trash row's second line: "root · You, just now" / "artboard of Combine-kampan · Jonas, 14:05". | `client/v2/left-panel/trash-view.jsx` · `TrashView` | test:v2-trash-view | new (S1.8) |
| `canvases-trash-note` | testid | The one status line under the Trash list after Restore / Clear out (`data-outcome` ok | not-yet | refused). An artboard's Restore shows the not-yet line here, quietly. | `client/v2/left-panel/trash-view.jsx` · `TrashView` | test:v2-trash-view | new (S1.8) |
| `canvases-trash-unreachable` | testid | Trash view: "The team server did not answer" — the list shown is from a moment ago. | `client/v2/left-panel/trash-view.jsx` · `TrashView` | test:v2-trash-view | new (S1.8) |
| `canvases-trash-foot` | testid | The Trash view's foot: "Kept until you clear it out." plus Clear out… for an owner. | `client/v2/left-panel/trash-view.jsx` · `TrashView` | test:v2-trash-view | new (S1.8) |
| `canvases-trash-ask-body` | testid | The clear-out confirmation's body: what goes for good, and for whom. | `client/v2/left-panel/trash-view.jsx` · `TrashView` | test:v2-trash-view | new (S1.8) |
| `canvases-trash-clear-cancel` | testid | Cancel on the clear-out confirmation. | `client/v2/left-panel/trash-view.jsx` · `TrashView` | test:v2-trash-view | new (S1.8) |
| `canvases-kept` | testid | Canvases > Advanced > "Kept on this Mac": the per-Mac list (conflict losers, sync quarantine, migration copies) moved out of the shared Trash. Absent when nothing is parked or for a viewer. | `client/v2/canvases/kept-on-this-mac.jsx` · `KeptRow` | test:v2-trash-view | new (S1.8) |
| `canvases-kept-toggle` | testid | Open / Hide on the "Kept on this Mac" row (`aria-expanded`); its list uses the canvases-trash-item / -restore / -clear / -ask ids. | `client/v2/canvases/kept-on-this-mac.jsx` · `KeptRow` | test:v2-trash-view | new (S1.8) |
| `canvases-advanced` | testid | The "Advanced" disclosure row at the foot of the Canvases panel (`aria-expanded`). | `client/v2/left-panel/canvases-advanced.jsx` · `CanvasesAdvanced` | — | stable — re-emit |
| `canvases-advanced-fold` | testid | The Canvases > Advanced container (`data-open` while open). | `client/v2/left-panel/canvases-advanced.jsx` · `CanvasesAdvanced` | — | stable — re-emit |
| `canvases-hidden-files` | testid | The "Show hidden files" switch in Canvases > Advanced (`role="switch"`). Same function as Menu > View > Advanced > Hidden files. | `client/v2/left-panel/canvases-advanced.jsx` · `CanvasesAdvanced` | — | stable — re-emit |
| `canvases-refresh` | testid | "Refresh" in Canvases > Advanced (re-reads the index; also Shift-Cmd-R and the search row "Refresh tree"). | `client/v2/left-panel/canvases-advanced.jsx` · `CanvasesAdvanced` | — | stable — re-emit |
| `canvases-advanced-trash` | testid | "Open" on the Trash row inside Canvases > Advanced. | `client/v2/left-panel/canvases-advanced.jsx` · `CanvasesAdvanced` | — | stable — re-emit |
| `canvases-ds-files` | testid | The design system's files (tokens CSS, specimens) as a tree, inside Canvases > Advanced. | `client/tree/tree.jsx` · `Sidebar` | — | stable — re-emit |
| `canvases-head-pinned` | testid | The Pinned group's heading row in the Canvases list (its aside is the number pinned). Absent while nothing is pinned. | `client/v2/canvases/canvases-panel.jsx` · `PanelHead` | — | new |
| `canvases-head-project` | testid | The project's row in the Canvases list: its name, the Sort button, and the drop target for "move back to the top level". | `client/v2/canvases/canvases-panel.jsx` · `PanelHead` | — | new |
| `canvases-sort` | testid | The Sort button on the project row (shows Recent / Name / Kind); opens the Sort menu (`aria-expanded`). | `client/v2/canvases/canvases-panel.jsx` · `PanelHead` | — | new |
| `canvases-sort-menu` | testid | The Sort menu: Recently opened · Name · Kind, then Folders on top. | `client/v2/canvases/canvases-panel.jsx` · `CanvasesPanel` | — | new |
| `canvases-sort-<by>` | testid (pattern) | One order in the Sort menu (`role=menuitemradio`, `aria-checked`); `<by>` is recent, name or kind. Choosing it saves the order for this project. | `client/v2/canvases/canvases-panel.jsx` · `CanvasesPanel` | — | new |
| `canvases-sort-folders` | testid | "Folders on top" in the Sort menu (`role=menuitemcheckbox`). | `client/v2/canvases/canvases-panel.jsx` · `CanvasesPanel` | — | new |
| `canvas-pin-<slug>` | testid (pattern) | The hover Pin button on a canvas row (`aria-pressed=false`); `<slug>` as `canvas-row-<slug>`. POSTs `/_api/pins`. | `client/v2/canvases/canvases-panel.jsx` · `PanelCanvasRow` | — | new |
| `canvas-unpin-<slug>` | testid (pattern) | The Unpin button on a pinned canvas row (`aria-pressed=true`); a pinned canvas's copy under Pinned adds a `-pinned` suffix. | `client/v2/canvases/canvases-panel.jsx` · `PanelCanvasRow` | — | new |
| `canvas-pinned-<slug>` | testid (pattern) | A canvas's copy under the Pinned group (the same canvas also keeps its `canvas-row-<slug>` row in its folder). | `client/v2/canvases/canvases-panel.jsx` · `PanelCanvasRow` | — | new |
| `canvas-pinned-menu-<slug>` | testid (pattern) | The ⋯ button on a canvas's copy under Pinned (the folder copy keeps `tree-row-menu-<slug>`). | `client/v2/canvases/canvases-panel.jsx` · `PanelCanvasRow` | — | new |
| `canvases-empty-<slug>` | testid (pattern) | The empty-folder card ("Nothing in 2027 yet.") under an open folder with nothing in it; `<slug>` from the folder path. | `client/v2/canvases/canvases-panel.jsx` · `PanelEmptyFolder` | — | new |
| `canvases-empty-new` | testid | "New canvas in <folder>" on the empty-folder card (hidden for a viewer). Opens the new-canvas composer aimed at that folder. | `client/v2/canvases/canvases-panel.jsx` · `PanelEmptyFolder` | — | new |
| `canvases-foot` | testid | The line under the Canvases list: "93 canvases · ⌘K searches every project" ("3 results · …" while searching). `data-slot` = sync / jump / access / default. | `client/v2/canvases/canvases-panel.jsx` · `CanvasesPanel` | — | new |
| `canvas-row-meta-<slug>` | testid (pattern) | One short word at a canvas row's right, before its badges, published by a slice through `row-slots.js` ("Needs you", "not sent", "sending"). `data-tone` quiet/warn/azure, `data-source` ai/sync/access/trash. The Pinned copy uses `canvas-pinned-meta-<slug>`. | `client/v2/canvases/canvases-panel.jsx` · `PanelCanvasRow` | — | new |
| `canvas-pinned-meta-<slug>` | testid (pattern) | The same meta word on a canvas's copy under Pinned (so a pinned canvas that goes offline says "not sent" in both places). | `client/v2/canvases/canvases-panel.jsx` · `PanelCanvasRow` | — | new |
| `canvas-row-sub-<slug>` | testid (pattern) | The second words after a canvas's name from a slot ("Shared with you · Can view", "In the trash · open here"); never drawn while a search draws its own sub. The Pinned copy uses `canvas-pinned-sub-<slug>`. | `client/v2/canvases/canvases-panel.jsx` · `PanelCanvasRow` | — | new |
| `canvas-pinned-sub-<slug>` | testid (pattern) | The same slot sub on a canvas's copy under Pinned. | `client/v2/canvases/canvases-panel.jsx` · `PanelCanvasRow` | — | new |
| `canvas-row-trashed-<slug>` | testid (pattern) | A ghost row: a canvas open in a tab that is not in the index any more (trashed while open), drawn dim at its last path with its provider's words; click or Enter focuses that tab. Not counted by its folder. | `client/v2/canvases/canvases-panel.jsx` · `PanelGhostRow` | — | new |
| `canvas-row-menu` | testid | A canvas row's menu (`role=menu`): Open · Pin · Rename · Duplicate · Move to… › · Copy link, then Move to trash. A viewer sees Open · Pin · Copy link. | `client/v2/canvases/row-menu.jsx` · `CanvasRowMenu` | — | new |
| `canvas-menu-<id>` | testid (pattern) | One row of the canvas row menu (`role=menuitem`); `<id>` is open, pin, rename, duplicate, move, copy-link or trash. `move` drills into the folder list. | `client/v2/canvases/row-menu.jsx` · `CanvasRowMenu` | — | new |
| `canvas-rename-input-<slug>` | testid (pattern) | The field a canvas's name turns into on double-click, F2 or Rename (↵ renames, esc keeps the name); `<slug>` as `canvas-row-<slug>`. | `client/v2/canvases/inline-rename.jsx` · `InlineRename` | — | new |
| `canvas-rename-error` | testid | The reason under the rename field when a name is refused (taken in this folder, not allowed); `role=alert`. | `client/v2/canvases/inline-rename.jsx` · `InlineRename` | — | new |
| `canvas-move-sheet` | testid | The "Move to…" list inside the row menu: a filter field over the project's folders. | `client/v2/canvases/move-sheet.jsx` · `MoveSheet` | — | new |
| `canvas-move-filter` | testid | The "Find a folder" field in the Move to… list (↑ ↓ choose, ↵ moves, ← goes back). | `client/v2/canvases/move-sheet.jsx` · `MoveSheet` | — | new |
| `canvas-move-target-<slug>` | testid (pattern) | One folder in the Move to… list (`role=option`); `<slug>` from the folder path. Choosing it moves the canvas there. | `client/v2/canvases/move-sheet.jsx` · `MoveSheet` | — | new |
| `canvas-move-none` | testid | The Move to… list's answer when the filter matches no folder ("Nothing called …"). | `client/v2/canvases/move-sheet.jsx` · `MoveSheet` | — | new |
| `present-order-notes` | testid | The "Order and notes…" sheet (`role=dialog`): the Present order, the skipped artboards and the speaker notes of the open canvas (S3.5). | `client/v2/present/order-notes-sheet.jsx` · `OrderNotesSheet` | test/order-notes-sheet.test.tsx | new in v2 (S3.5) |
| `present-order-row-<id>` | testid (pattern) | One artboard in the Order and notes list, in the order Present plays it; `<id>` is the artboard id. `aria-current` on the selected row (its notes show below). | `client/v2/present/order-notes-sheet.jsx` · `OrderNotesSheet` | test/order-notes-sheet.test.tsx | new in v2 (S3.5) |
| `present-order-up-<id>` | testid (pattern) | Move this artboard one place earlier in the Present order (also ⌥↑ on the row). | `client/v2/present/order-notes-sheet.jsx` · `OrderNotesSheet` | test/order-notes-sheet.test.tsx | new in v2 (S3.5) |
| `present-order-down-<id>` | testid (pattern) | Move this artboard one place later in the Present order (also ⌥↓ on the row). | `client/v2/present/order-notes-sheet.jsx` · `OrderNotesSheet` | test/order-notes-sheet.test.tsx | new in v2 (S3.5) |
| `present-order-skip-<id>` | testid (pattern) | Skip toggle (`aria-pressed`): the artboard stays on the canvas, out of the run and the counter. | `client/v2/present/order-notes-sheet.jsx` · `OrderNotesSheet` | test/order-notes-sheet.test.tsx | new in v2 (S3.5) |
| `present-order-notes-field` | testid | The speaker-notes field of the selected artboard (`artboardMeta.<id>.notes`). | `client/v2/present/order-notes-sheet.jsx` · `OrderNotesSheet` | test/order-notes-sheet.test.tsx | new in v2 (S3.5) |
| `present-order-counts` | testid | The counter line: "N artboards · M skipped". | `client/v2/present/order-notes-sheet.jsx` · `OrderNotesSheet` | test/order-notes-sheet.test.tsx | new in v2 (S3.5) |
| `present-order-reset` | testid | "Use canvas order" — present only while a custom order is set. | `client/v2/present/order-notes-sheet.jsx` · `OrderNotesSheet` | test/order-notes-sheet.test.tsx | new in v2 (S3.5) |
| `present-order-save` | testid | Save: sends only what changed, with the ETag the sheet read (PATCH /_api/present-meta). | `client/v2/present/order-notes-sheet.jsx` · `OrderNotesSheet` | test/order-notes-sheet.test.tsx | new in v2 (S3.5) |
| `present-order-cancel` | testid | Cancel: closes the sheet without saving (esc does the same). | `client/v2/present/order-notes-sheet.jsx` · `OrderNotesSheet` | test/order-notes-sheet.test.tsx | new in v2 (S3.5) |
| `present-order-error` | testid | Why a read or a save failed (`role=alert`), e.g. a stale ETag. | `client/v2/present/order-notes-sheet.jsx` · `OrderNotesSheet` | test/order-notes-sheet.test.tsx | new in v2 (S3.5) |
| `canvases-drop-tag` | testid | "Move here" on the folder (or the project row) a canvas is being dragged over; absent over the folder it already sits in. | `client/v2/canvases/canvases-panel.jsx` · `PanelFolderRow` | — | new |
| `canvas-jump-toggle-<slug>` | testid (pattern) | The disclosure twisty on a canvas row of the Canvases panel (`aria-expanded`): opens the canvas's artboards underneath (the jump list). Right arrow also opens it, left arrow closes it. A canvas with no artboards written out and not dynamic has none. | `client/v2/canvases/jump-list.jsx` · `JumpToggle` | — | new |
| `jump-artboard-<slug>-<artboardId>` | testid (pattern) | One artboard in a canvas's jump list (`data-kind` web|digital|print|video; `aria-current` on the one in view). Click or Enter jumps there: opens the canvas if needed, then glides + flashes (`reveal-artboard`), or frames it with today's jump until the bridge has the message. While searching, the artboards that matched. | `client/v2/canvases/jump-list.jsx` · `JumpBoardRow` | — | new |
| `jump-dynamic-<slug>` | testid (pattern) | The line under a dynamic canvas's artboards: "Its artboards are made when it runs." | `client/v2/canvases/jump-list.jsx` · `JumpNoteRow` | — | new |
| `canvases-nothing` | testid | The "Nothing called …" line when the panel search finds nothing. | `client/v2/canvases/canvases-panel.jsx` · `CanvasesPanel` | — | new |
| `canvases-other-files` | testid | While searching: the other groups' hits (Design system, project and runtime files) under the canvases list. | `client/tree/tree.jsx` · `Sidebar` | — | new |
| `assets-panel` | testid | The Assets tab body (the left panel's third tab). | `client/v2/left-panel/assets-panel.jsx` · `AssetsPanel` | — | stable — re-emit |
| `assets-search` | testid | The Assets tab's search field (names). | `client/v2/left-panel/assets-panel.jsx` · `AssetsPanel` | — | stable — re-emit |
| `assets-add` | testid | "Add files..." in the Assets tab head (hidden for a viewer). | `client/v2/left-panel/assets-panel.jsx` · `AssetsPanel` | — | stable — re-emit |
| `assets-empty` | testid | The Assets tab's empty state ("No images or footage yet."). | `client/v2/left-panel/assets-panel.jsx` · `AssetsPanel` | — | stable — re-emit |
| `assets-nohits` | testid | The Assets tab's "Nothing called ..." state. | `client/v2/left-panel/assets-panel.jsx` · `AssetsPanel` | — | stable — re-emit |
| `assets-tile` | testid | One asset tile in the Assets tab (`aria-pressed` when picked). | `client/v2/left-panel/assets-panel.jsx` · `AssetsPanel` | — | stable — re-emit |
| `canvases-count` | testid | The "N of M shown" readout with the live dot in the foot of Canvases > Advanced (the status bar's files count and live dot, moved). | `client/v2/left-panel/canvases-advanced.jsx` · `CanvasesAdvanced` | — | new |
| `canvas-row-unsaved` | testid | The unsaved-change badge (M / A / D / U) on a canvas or file row in Canvases (`data-kind` carries the letter). | `client/tree/tree.jsx` · `FileRow` | — | new |

### viewport

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `canvas-frame` | testid | The ACTIVE canvas `<iframe>` (only the active tab carries it). `data-path` = the canvas path, `title` = "Canvas: &lt;path&gt;". | `client/app.jsx` · `Viewport` | spec:app-boots-and-renders-canvas, runner:reliable-project-multiplayer/f3/peer-render.mjs, runner:reliable-project-multiplayer/f3/s09-browser.mjs, runner:reliable-project-multiplayer/f3/s11-browser.mjs, runner:reliable-project-multiplayer/f3/s19-browser.mjs, runner:video-timeline-badge/web-desktop.sh, spec:video-timeline-badge, skill:desktop-e2e, e2e-helper:canvas-frame, e2e-mp:surface, e2e:app-boots-and-renders-canvas, e2e:canvas-text-editing, e2e:export-formats, e2e:file-tree-move, e2e:share-link, e2e:shell-parity, e2e:timeline-manual-cut, frame-probe, bin:_perf-probe-safari.mjs, test-e2e:annotations-bench.mjs, test-e2e:annotations-ui.e2e.mjs, test-e2e:harness.mjs, test-e2e:shoot-board.mjs, test:export-e2e-lanes | stable — re-emit |
| `canvas-load-error` | testid | The canvas load-error card over the viewport (`role="alert"`). | `client/app.jsx` · `Viewport` | e2e-mp:surface, e2e:sidecar-respawn-canvas-switch, frame-probe | stable — re-emit |
| `canvas-load-retry` | testid | The Retry button on the canvas load-error card. | `client/app.jsx` · `Viewport` | — | stable — re-emit |
| `canvas-loading` | testid | The canvas loading skeleton (`role="status"`). | `client/app.jsx` · `CanvasLoading` | — | stable — re-emit |
| `st-empty-start-quick-setup` | testid | "Start quick setup" button in the empty viewport (no canvas open). Does not follow the `<area>-<thing>` convention. | `client/app.jsx` · `Viewport` | — | moves — map in Phase 4 |
| `[data-tour="viewport"]` | data-tour | The viewport stage `div.viewport.st-stage`; also carries `data-canvas-state` (e.g. `ready`). | `client/app.jsx` · `Viewport` | e2e:sidecar-respawn-canvas-switch, tour:quick-setup-tour, tour:usage-tour, whats-new | moves — map in Phase 4 |
| `[data-canvas-state]` | selector | Attribute on the viewport stage (`[data-tour="viewport"]`): canvas lifecycle; `"ready"` once the active canvas has rendered. | `client/app.jsx` · `Viewport` | e2e:sidecar-respawn-canvas-switch | moves — map in Phase 4 |
| `[data-path] on canvas-frame` | selector | Attribute on every open canvas iframe = the canvas path (e.g. `.design/ui/Smoke.tsx`). *`test/shell-accessibility.test.ts` also asserts (source text) that this iframe's `title` is the template literal "Canvas: " + `t.path`.* | `client/app.jsx` · `Viewport` | e2e-mp:surface, e2e:app-boots-and-renders-canvas, e2e:export-formats, e2e:share-link, e2e:shell-parity, test:export-e2e-lanes, test:shell-accessibility (source text) | stable — re-emit |
| `.st-canvas-loading` | selector | The canvas loading skeleton (same element as `canvas-loading`). | `client/app.jsx` · `CanvasLoading` | frame-probe | stable — re-emit |

### ⌘K palette

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `[aria-label="Command palette"]` | selector | The ⌘K command palette dialog (V2-4.6: Search ⌘K; the aria-label is kept). | `client/dialogs/command-palette.jsx` · `CommandPalette` | e2e-mp:surface | stable — re-emit |
| `palette-input` | testid | The ⌘K search box (placeholder “Search canvases, actions, or ask AI…”). | `client/dialogs/command-palette.jsx` · `CommandPalette` | test/v2-search-ui.test.tsx | new |
| `palette-list` | testid | The ⌘K result list (scroll container). | `client/dialogs/command-palette.jsx` · `CommandPalette` | test/v2-search-ui.test.tsx | new |
| `palette-row-<id>` | testid | One ⌘K row; <id> is `action:<registry id>`, `tool:<id>`, `setting:<section>:<testid>:<n>`, `canvas:<rel>`, `artboard:<rel>#<id>`, `project:<pid>:canvas:<rel>` / `project:<pid>:artboard:<rel>#<id>` (another project's row, S1.5), `ask-ai`, or a short-list action id. The active row also has `.is-active`. | `client/dialogs/command-palette.jsx` · `CommandPalette` | test/v2-search-ui.test.tsx | new |
| `palette-group-<id>` | testid | A ⌘K result group: `canvases`, `artboards`, `actions` (with the “N hidden tools” aside), `tools`, `settings`, `did-you-mean` (typo-only hits, S1.4), or — once another project answers (desktop, S1.5) — `project-self` (this tab) and `project-<pid>` per other project, each headed by its square and where it is. | `client/dialogs/command-palette.jsx` · `CommandPalette` | test/v2-search-ui.test.tsx | new |
| `palette-project-square` | testid | The project's square (initial + Home's tone for its pid) on a ⌘K project group header (S1.5, desktop only). | `client/dialogs/command-palette.jsx` · `CommandPalette` | test/v2-search-ui.test.tsx | new |
| `palette-project-label` | testid | On another project's row in "Did you mean" (one flat list): its square, name and where it is ("in another tab" / "not open — opens a tab") — ↵ switches project (S15-A2, desktop only). | `client/dialogs/command-palette.jsx` · `CommandPalette` | test/v2-search-ui.test.tsx | new |
| `palette-ask-ai` | testid | The wrapper of the last row, Ask AI (desktop only; ⌘↵ runs it). | `client/dialogs/command-palette.jsx` · `CommandPalette` | test/v2-search-ui.test.tsx | new |
| `palette-empty` | testid | The “Nothing called …” empty state. | `client/dialogs/command-palette.jsx` · `CommandPalette` | test/v2-search-ui.test.tsx | new |
| `palette-did-you-mean-note` | testid | The “Nothing called …” line above the “Did you mean” group, when every hit is a typo and no word of the query was right. | `client/dialogs/command-palette.jsx` · `CommandPalette` | test/v2-search-ui.test.tsx | new |
| `palette-recent-empty` | testid | The “Nothing opened yet.” line under Recent when nothing was opened on this Mac (Start here follows). | `client/dialogs/command-palette.jsx` · `CommandPalette` | test/v2-search-ui.test.tsx | new |
| `palette-close-note` | testid | The “Showing close matches for …” note when every hit is a typo match. | `client/dialogs/command-palette.jsx` · `CommandPalette` | test/v2-search-ui.test.tsx | new |
| `palette-count` | testid | The ⌘K footer: “Type to search”, “N results”, “N close matches”, “0 results · N close match”, or on a Mac with nothing opened “Every tool is here — type its name”. | `client/dialogs/command-palette.jsx` · `CommandPalette` | test/v2-search-ui.test.tsx | new |

### export dialog

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `export-format-<id>` | testid (pattern) | A format card in the Export dialog. `<id>` ∈ png, pdf, svg, html, pptx, mp4, gif, canva, zip, shadcn (temporal ones only when the canvas has comps). | `client/app.jsx` · `ExportDialog` | e2e:export-formats, test:export-e2e-lanes | moves — map in Phase 4 |
| `export-lane-note` | testid | Note in the Export dialog that explains a blocked/degraded export lane. | `client/app.jsx` · `ExportDialog` | — | moves — map in Phase 4 |
| `export-scope` | testid | The scope selector (canvas / artboard / selection…) in the Export dialog. | `client/app.jsx` · `ExportDialog` | e2e:export-formats, test:export-e2e-lanes | moves — map in Phase 4 |
| `export-include-annotations` | testid | "Include annotations" checkbox. Emitted by the shell Export dialog AND by the in-canvas export dialog (`DialogShell`, inside the iframe). *Same testid in two documents (shell and canvas iframe).* | `client/app.jsx` · `ExportDialog`<br>`export-dialog.tsx` · `DialogShell` | — | moves — map in Phase 4 |
| `export-long-comp-notice` | testid | Notice that a long video comp will export slowly. | `client/app.jsx` · `ExportDialog` | — | moves — map in Phase 4 |
| `export-pdf-text` | testid | PDF "selectable text" option. Emitted by the shell Export dialog AND by the in-canvas export dialog. *Same testid in two documents (shell and canvas iframe).* | `client/app.jsx` · `ExportDialog`<br>`export-dialog.tsx` · `DialogShell` | — | moves — map in Phase 4 |
| `export-status` | testid | Export status line; `data-ok="1"\|"0"` carries success/failure. | `client/app.jsx` · `ExportDialog` | test:export-e2e-lanes | moves — map in Phase 4 |
| `export-recent` | testid | The recent-exports list in the Export dialog. | `client/app.jsx` · `ExportDialog` | — | moves — map in Phase 4 |
| `export-submit` | testid | The Export submit button. | `client/app.jsx` · `ExportDialog` | e2e:export-formats, test:export-e2e-lanes | moves — map in Phase 4 |
| `export-job-<id>` | testid (pattern) | One job row in the background Exports panel (`<id>` = job id). | `client/export-center.jsx` · `ExportPanel` | test:export-center | moves — map in Phase 4 |
| `export-degraded-note` | testid | Note on an export job that finished in a degraded mode. | `client/export-center.jsx` · `DegradedNote` | test:exporters/degraded-propagation (source text) | moves — map in Phase 4 |
| `[data-ok] on export-status` | selector | `data-ok="1"\|"0"` on `export-status` = last export succeeded/failed. | `client/app.jsx` · `ExportDialog` | test:export-e2e-lanes | moves — map in Phase 4 |
| `export-png-resolution` | testid | The PNG resolution select (1x-3x and 150 / 300 / 600 dpi). Shown once the PNG card is picked. | `client/dialogs/export-dialog.jsx` · `ExportDialog` | — | new |
| `export-pdf-quality` | testid | The PDF raster-quality (dpi) select. Shown once the PDF card is picked. | `client/dialogs/export-dialog.jsx` · `ExportDialog` | — | new |
| `export-pdf-marks` | testid | The PDF "Marks" disclosure (crop and registration marks). Shown once the PDF card is picked. | `client/dialogs/export-dialog.jsx` · `ExportDialog` | — | new |

### inspector

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `inspector-panel` | testid | The Inspector panel container (`InspectorPanel` rendered for dock id `inspector`). *Passed as the `testId` prop from `renderPanelBody` in `App()`.* | `client/app.jsx` · `InspectorPanel` | e2e:shell-parity | moves — map in Phase 4 |
| `layers-panel` | testid | The separate Layers panel container (`InspectorPanel` with `layersOnly`, dock id `layers`). *Passed as the `testId` prop from `renderPanelBody` in `App()`.* | `client/app.jsx` · `InspectorPanel` | — | moves — map in Phase 4 |
| `inspector-section-<name>` | testid (pattern) | A collapsible CSS-knob section header in Advanced mode (`aria-expanded` = open). `<name>` = section title lower-cased, non-alphanumerics → `-` (e.g. `inspector-section-advanced`). Designer-mode sections (`dsec`) carry no testid. | `client/app.jsx` · `CssKnobs` | e2e-mp:surface | stable — re-emit |
| `photo-knobs` | testid | Body of the Photo tab (photo adjustment knobs) in the Inspector. | `client/photo-knobs.jsx` · `PhotoKnobs` | e2e-mp:photo-trace.js, e2e-mp:surface | stable — re-emit |
| `photo-remove-bg` | testid | Photo tab "Remove background" button. | `client/photo-knobs.jsx` · `PhotoKnobs` | — | stable — re-emit |
| `[data-tour="inspector"]` | data-tour | The Inspector panel root. | `client/app.jsx` · `InspectorPanel` | tour:usage-tour, whats-new | moves — map in Phase 4 |
| `[data-tour="inspector-tabs"]` | data-tour | The Inspector tab strip (Inspect · Layers · CSS · Photo). | `client/app.jsx` · `InspectorPanel` | whats-new | moves — map in Phase 4 |
| `[data-tour="css-panel"]` | data-tour | The CSS tab body for the selected element (`.st-cp`). Exists only with a selection. | `client/app.jsx` · `CssKnobs` | whats-new | moves — map in Phase 4 |
| `[data-tour="cp-mode"]` | data-tour | The Advanced/Designer mode switch in the CSS tab header. Exists only with a selection. | `client/app.jsx` · `CssKnobs` | whats-new | moves — map in Phase 4 |
| `.st-cp-row` | selector | One property row in the CSS tab. | `client/app.jsx` · `CssKnobs`<br>`client/inspector-controls.jsx` · `Field` | whats-new | moves — map in Phase 4 |
| `.st-cp-tokbtn` | selector | The "bind a design token" button on a property row. | `client/app.jsx` · `TokenPopover`<br>`client/inspector-controls.jsx` · `ValueTokenField` | whats-new | moves — map in Phase 4 |
| `.st-cp-sechd-row` | selector | A CSS-tab section header row. | `client/app.jsx` · `CssKnobs`<br>`client/app.jsx` · `ArtboardKnobs`<br>`client/inspector-controls.jsx` · `PanelSection` | whats-new | moves — map in Phase 4 |
| `.st-layer-eye` | selector | Visibility toggle on a Layers row. | `client/app.jsx` · `LayerRow` | whats-new | moves — map in Phase 4 |
| `.st-cp-idtag` | selector | The element id tag in the CSS tab header. | `client/app.jsx` · `CssKnobs` | e2e-mp:surface | moves — map in Phase 4 |
| `.st-cp-num` | selector | A numeric property input. | `client/app.jsx` · `CssKnobs`<br>`client/inspector-controls.jsx` · `NumberField` | e2e-mp:surface | moves — map in Phase 4 |
| `.st-cp-box--inset / .st-cp-boxv[aria-label="<side>"]` | selector | The inner ring of the box-model widget and its side inputs (`aria-label` = top/right/bottom/left). | `client/app.jsx` · `CssKnobs` | spec:element-editing-resize-and-position | moves — map in Phase 4 |
| `.st-rpanel / .st-rp-tab` | selector | Right-panel container and its tab buttons (`.st-rp-tab.is-active` = current tab). | `client/app.jsx` · `InspectorPanel`<br>`client/panels/ChatPanel.jsx` · `ChatPanel` | spec:element-editing-resize-and-position | moves — map in Phase 4 |
| `.st-scope` | selector | Edit-scope pill (`st-scope--local` / `st-scope--shared`, built as `st-scope--${scope}`). | `client/app.jsx` · `InspectorPanel` | spec:element-editing-resize-and-position, spec:structural-and-scope | moves — map in Phase 4 |
| `[aria-label="Inspector"]` | selector | The Inspector panel by accessible name. | `client/app.jsx` · `InspectorPanel` | spec:element-editing-resize-and-position | moves — map in Phase 4 |
| Inspector field labels | selector | Inspector inputs reached by `aria-label`: "custom attribute name", "custom attribute value" (`AttrKnob`), "custom property name", "custom property value" (`RawKnob`), "font-weight". | `client/app.jsx` · `CssKnobs`<br>`client/app.jsx` · `AttrKnob`<br>`client/app.jsx` · `RawKnob` | e2e-mp:surface | moves — map in Phase 4 |
| Photo tab field labels | selector | Photo tab inputs by `aria-label`: "Brightness", "Contrast", "Duotone on", "Grain on", "Mask preset", "Pattern on", "Pattern type", "Pattern blend", and "reset Adjustments section" (built as `reset ${title} section`). | `client/photo-knobs.jsx` · `PhotoKnobs`<br>`client/inspector-controls.jsx` · `PanelSection` | e2e-mp:surface, test:photo-knobs-state | stable — re-emit |
| `inspector-custom-css` | testid | The custom CSS property row (name + value) in the Inspector > Advanced section. | `client/inspector/css-knobs.jsx` · `RawKnob` | — | new |
| `inspector-html-attrs` | testid | The custom HTML attribute row (name + value) in the Inspector > Advanced section. | `client/inspector/css-knobs.jsx` · `AttrKnob` | — | new |
| `inspector-grid-tracks` | testid | The grid columns / rows track editor in the Inspector, for an element whose display is grid. | `client/inspector/grid-tracks-editor.jsx` · `GridTracksEditor` | — | new |
| `inspector-body-layout` | testid | The artboard body-layout select in the artboard Inspector. | `client/inspector/artboard-knobs.jsx` · `ArtboardKnobs` | — | new |

### comments panel

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `comment-filter-all` | testid | Comments panel filter: All. | `client/v2/comments/comments-panel.jsx` · `CommentsPanel` | — | stable — re-emit |
| `comment-filter-open` | testid | Comments panel filter: Open. | `client/v2/comments/comments-panel.jsx` · `CommentsPanel` | — | stable — re-emit |
| `comment-filter-resolved` | testid | Comments panel filter: Resolved. | `client/v2/comments/comments-panel.jsx` · `CommentsPanel` | e2e-mp:surface | stable — re-emit |
| `comment-item-<id>` | testid (pattern) | One comment thread row in the Comments panel (`<id>` = comment id). | `client/v2/comments/comments-panel.jsx` · `CommentsPanel` | e2e-mp:surface | stable — re-emit |
| `[aria-label="Reopen"]` | selector | Reopen button on a resolved comment in the Comments panel. | `client/app.jsx` · `CommentsPanel` | e2e-mp:surface | stable — re-emit |
| `comments-panel` | testid | The Comments panel (S9.22): the floating right panel; filters Open · Mine · Resolved · All, grouped by canvas. | `client/v2/comments/comments-panel.jsx` · `CommentsPanel` | test:v2-comments-panel-render | new in v2 (S9.22) |
| `comments-panel-close` | testid | The × in the Comments panel header (present when the host passes `onClose`). | `client/v2/comments/comments-panel.jsx` · `CommentsPanel` | test:v2-comments-panel-render | new in v2 (S9.22) |
| `comment-filter-mine` | testid | Comments panel filter: Mine — threads you started, in every status (the verb `comments list --mine`). | `client/v2/comments/comments-panel.jsx` · `CommentsPanel` | test:v2-comments-panel-render | new in v2 (S9.22) |
| `comment-group-<slug>` | testid (pattern) | One canvas group in the Comments panel (`<slug>` = the canvas file name, kebab-cased); its header opens the canvas. | `client/v2/comments/comments-panel.jsx` · `CommentsPanel` | test:v2-comments-panel-render | new in v2 (S9.22) |
| `comments-empty` | testid | The Comments panel empty state; names the empty filter ("No open comments."). | `client/v2/comments/comments-panel.jsx` · `CommentsPanel` | test:v2-comments-panel-render | new in v2 (S9.22) |
| `comment-resolve-<id>` | testid (pattern) | Resolve a thread: the Comments panel row button, and the Resolve button in the in-canvas thread header (`<id>` = comment id). | `client/v2/comments/comments-panel.jsx` · `CommentsPanel`<br>`comments-overlay.tsx` · `CommentThread` | test:v2-comments-panel-render | new in v2 (S9.22) |
| `comment-reopen-<id>` | testid (pattern) | Reopen a resolved thread: the Comments panel row (`aria-label="Reopen"`, kept) and the in-canvas thread header. | `client/v2/comments/comments-panel.jsx` · `CommentsPanel`<br>`comments-overlay.tsx` · `CommentThread` | test:v2-comments-panel-render | new in v2 (S9.22) |
| `comment-delete-<id>` | testid (pattern) | Delete comment — on YOUR OWN threads only (CONTRACT §6, D8): the Comments panel row and the in-canvas thread header. The server refuses anyone else’s (`not-yours`). | `client/v2/comments/comments-panel.jsx` · `CommentsPanel`<br>`comments-overlay.tsx` · `CommentThread` | test:v2-comments-panel-render | new in v2 (S9.22) |
| `comment-where-<id>` | testid (pattern) | Where a thread sits, in words: the artboard name ("A4 · plakát"), with "at 0:12" for a video moment — the Comments panel row, and the in-canvas thread header (artboard name). | `client/v2/comments/comments-panel.jsx` · `CommentsPanel`<br>`comments-overlay.tsx` · `CommentThread` | test:v2-comments-panel-render | new in v2 (S9.22) |
| `comment-chip-<id>` | testid (pattern) | The chip under a thread header: "at 0:12" (a button that parks the video there) or "14 mm from the left · 2 mm above the trim" on a print artboard. | `comments-overlay.tsx` · `CommentThread` | test:v2-comments-panel-render | new in v2 (S9.22) |
| `comment-from-<id>` | testid (pattern) | Thread header line for a converted sticky: "From Jonas’s sticky · turned into a comment by You" (S4-S9-votes-comments §3.4; Undo and "Turn back into a sticky" wait for the S4.7 routes). | `comments-overlay.tsx` · `CommentThread` | test:v2-comments-panel-render | new in v2 (S9.22) |
| `comment-composer-where` | testid | The composer header chip: where the new comment will be pinned ("at 0:12", millimetres) before it is saved. | `comments-overlay.tsx` · `CommentComposer` | test:v2-comments-panel-render | new in v2 (S9.22) |
| `comment-notice` | testid | A refused comment write said in one sentence ("That did not go through."); the typed text stays in the composer. | `comments-overlay.tsx` · `CommentsOverlay` | test:v2-comments-panel-render | new in v2 (S9.22) |

### banners

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `callouts` | testid | The callout stack (V2-4.8b) that replaced the top banners: sync diverged / rejected / long offline, the cloud role line, update ready, repo changed, the format-gate notice. A child of `.maude`, so Presentation mode does not hide it. | `client/v2/shell/callouts.jsx` · `CalloutStack` | test:v2-callouts | new in v2 (V2-4.8b) |
| `callout-<kind>` | testid (pattern) | One callout; `<kind>` = `sync-diverged`, `sync-rejected`, `sync-offline-long`, `sync-back`, `role`, `update`, `repo-changed`, `mention` (S9.22: "Jonas mentioned you on A4 · plakát", action Open). `data-tone` = ok / info / warn / error. A short offline spell has no callout: `share-cluster-status` says it. | `client/v2/shell/callouts.jsx` · `Callout` | test:v2-callouts, e2e-mp:surface | new in v2 (V2-4.8b) |
| `callout-<kind>-action` | testid (pattern) | The callout's one action: Details (→ Diagnostics › Sync), Restart now, Reload, Got it. | `client/v2/shell/callouts.jsx` · `Callout` | test:v2-callouts | new in v2 (V2-4.8b) |
| `callout-<kind>-dismiss` | testid (pattern) | The × on a callout (absent on `role`, whose Got it closes it). | `client/v2/shell/callouts.jsx` · `Callout` | test:v2-callouts | new in v2 (V2-4.8b) |
| `notice-<id>` | testid (pattern) | One notification card in the shared notification stack (`<id>` = notice id). *Canvas hints land here too: an embedded canvas posts `{dgn:'canvas-notice'}` and the shell shows it through `notifyCanvasText` as `notice-canvas-notice-<slot>` (two reused slots). `e2e:canvas-text-editing` matches that prefix for the mixed-text `/design:edit` hint (it replaced the in-frame `.dc-media-toast`, removed in `d50954df2`).* | `notifications.tsx` · `NoticeCard` | e2e:canvas-text-editing, test:notifications | stable — re-emit |
| `.maude-notice / -action / -summary` | selector | A notification card, its action button and its summary line. | `notifications.tsx` · `NoticeCard`<br>`client/export-center.jsx` · `ExportJobNotice` | test:notifications | stable — re-emit |
| button "Got it" / "Dismiss" | selector | Onboarding-hint and banner dismiss buttons, clicked by accessible name before timed actions. *`surface.e2e.ts` clicks every visible match; there is no single producer.* | `client/app.jsx` · `App` | e2e-mp:surface | moves — map in Phase 4 |

### help/shortcuts

V2-4.6: the “?” sheet is registry-built and carries hooks; `HelpModal` still emits none (the Help menu trigger is listed under menubar).

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `shortcuts-sheet` | testid | The “?” sheet dialog. | `client/dialogs/shortcuts-overlay.jsx` · `ShortcutsOverlay` | test/v2-search-ui.test.tsx | new |
| `shortcuts-find` | testid | The sheet’s “Find a shortcut” box. | `client/dialogs/shortcuts-overlay.jsx` · `ShortcutsOverlay` | test/v2-search-ui.test.tsx | new |
| `shortcuts-group-<id>` | testid | A sheet group (`edit-tools`, `preview-tools`, `file`, `tabs-windows`, `finding`, `canvas`, `panels-ai`, `objects`, `timeline`, `present`). | `client/dialogs/shortcuts-overlay.jsx` · `ShortcutsOverlay` | test/v2-search-ui.test.tsx | new |
| `shortcuts-row-<id>` | testid | One sheet row; <id> is the registry action id (also in the Advanced fold). | `client/dialogs/shortcuts-overlay.jsx` · `ShortcutsOverlay` | test/v2-search-ui.test.tsx | new |
| `shortcuts-advanced` | testid | The sheet’s Advanced fold (View › Advanced / Diagnostics keys, then the moved keys). | `client/dialogs/shortcuts-overlay.jsx` · `ShortcutsOverlay` | test/v2-search-ui.test.tsx | new |
| `shortcuts-advanced-toggle` | testid | The Advanced fold’s disclosure button (`aria-expanded`; remembered). | `client/dialogs/shortcuts-overlay.jsx` · `ShortcutsOverlay` | test/v2-search-ui.test.tsx | new |
| `fold-<panel>` | testid (pattern) | A shared Advanced fold (`<AdvancedFold>`) that has no hook of its own; `<panel>` is its prefs key (e.g. `inspector`). Carries `data-fold=<panel>` and `data-open` while open. The migrated folds keep their old hooks (`canvases-advanced-fold`, `shortcuts-advanced`, `diag-sync-hints`). | `client/v2/fold/advanced-fold.jsx` · `AdvancedFold` | test:v2-fold | new in v2 (V2-4.10) |
| `fold-<panel>-toggle` | testid (pattern) | That fold's disclosure button (`aria-expanded`, `aria-controls` the body while open). | `client/v2/fold/advanced-fold.jsx` · `AdvancedFold` | test:v2-fold | new in v2 (V2-4.10) |
| `fold-<panel>-body` | testid (pattern) | That fold's body: rendered only while the fold is open. Every migrated fold has one too (`fold-left.canvases-body`, `fold-help-body`, `fold-diagnostics-body`). | `client/v2/fold/advanced-fold.jsx` · `AdvancedFold` | test:v2-fold | new in v2 (V2-4.10) |
| `shortcuts-moved-hd` | testid | The “Keys and tools that moved” heading. | `client/dialogs/shortcuts-overlay.jsx` · `ShortcutsOverlay` | test/v2-search-ui.test.tsx | new |
| `shortcuts-moved` | testid | The list of moved keys and tools (old → new). | `client/dialogs/shortcuts-overlay.jsx` · `ShortcutsOverlay` | test/v2-search-ui.test.tsx | new |
| `shortcuts-none` | testid | The sheet’s “Nothing called …” line. | `client/dialogs/shortcuts-overlay.jsx` · `ShortcutsOverlay` | test/v2-search-ui.test.tsx | new |

### settings

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `figma-connect-card` | testid | Settings: the Figma connection card. | `client/panels/SettingsPanel.jsx` · `FigmaConnectCard` | — | stable |
| `figma-connect-input` | testid | Settings: Figma token input. | `client/panels/SettingsPanel.jsx` · `FigmaConnectCard` | — | stable |
| `figma-connect-save` | testid | Settings: save the Figma token. | `client/panels/SettingsPanel.jsx` · `FigmaConnectCard` | — | stable |
| `figma-disconnect` | testid | Settings: disconnect Figma. | `client/panels/SettingsPanel.jsx` · `FigmaConnectCard` | — | stable |
| `figma-connected-as` | testid | Settings: "connected as …" status line. | `client/panels/SettingsPanel.jsx` · `FigmaConnectCard` | — | stable |
| `figma-connect-error` | testid | Settings: Figma connection error line. | `client/panels/SettingsPanel.jsx` · `FigmaConnectCard` | — | stable |
| `settings-scrim` | testid | The veil behind the Settings sheet; a pointer-down on it closes the sheet. | `client/v2/settings/settings-sheet.jsx` · `SettingsSheet` | — | stable |
| `settings-sheet` | testid | The Settings sheet itself (role=dialog): a vertical tablist of sections beside the open section’s groups. | `client/v2/settings/settings-sheet.jsx` · `SettingsSheet` | — | stable |
| `settings-tab-<id>` | testid (pattern) | A section tab on the sheet’s rail; `<id>` ∈ general, connections, advanced. Connections and Advanced exist only on the desktop. | `client/v2/settings/settings-sheet.jsx` · `SettingsSheet` | — | stable |
| `settings-panel-<id>` | testid (pattern) | The tabpanel of one section (`<id>` as above); a section opened once stays mounted, hidden. | `client/v2/settings/settings-sheet.jsx` · `SettingsSheet` | — | stable |
| `settings-close` | testid | The sheet’s Done button. | `client/v2/settings/settings-sheet.jsx` · `SettingsSheet` | — | stable |
| `settings-account` | testid | General › Account group (shown when a dashboard address is known). | `client/v2/settings/general-section.jsx` · `GeneralSection` | — | stable |
| `settings-open-dashboard` | testid | General › Account › Open the cloud dashboard. | `client/v2/settings/general-section.jsx` · `GeneralSection` | — | stable |
| `settings-theme` | testid | General › Look › the Light / Dark radio group. | `client/panels/SettingsPanel.jsx` · `AppearanceTab` | — | stable |
| `settings-inspector-vocabulary` | testid | General › Look › the Inspector words radio group (Advanced / Designer). | `client/panels/SettingsPanel.jsx` · `AppearanceTab` | — | stable |
| `settings-canvas-view` | testid | General › Canvas and view group (minimap, zoom controls, annotations, auto-open Inspector). | `client/v2/settings/general-section.jsx` · `GeneralSection` | — | stable |
| `settings-keyboard` | testid | General › Keyboard group (the Single-key shortcuts switch). | `client/v2/settings/general-section.jsx` · `GeneralSection` | — | stable |
| `settings-single-keys` | testid | General › Keyboard › the Single-key shortcuts switch: off, only shortcuts with ⌘ or ⌥ fire (V, H, N, /, ? go quiet). | `client/v2/settings/general-section.jsx` · `GeneralSection` | — | stable |
| `settings-layout` | testid | General › Layout group (panel positions, Layers mode). | `client/v2/settings/general-section.jsx` · `GeneralSection` | — | stable |
| `settings-cloud` | testid | Connections › Maude Cloud group. | `client/v2/settings/connections-section.jsx` · `ConnectionsSection` | — | stable |
| `settings-cloud-projects` | testid | Connections › Maude Cloud › the cloud projects on this Mac (Connect · Disconnect · View in the browser rows). | `client/panels/CloudBar.jsx` · `CloudBar` | — | stable |
| `settings-hub-address` | testid | Connections › Maude Cloud › the linked workspace’s address; the access token stays in the keychain and is never shown. | `client/panels/CloudBar.jsx` · `CloudBar` | — | stable |
| `cloud-sign-out` | testid | Connections › Maude Cloud › Sign out. | `client/panels/CloudBar.jsx` · `CloudBar` | — | stable |
| `cloud-host` | testid | The left panel footer’s CloudBar host: no visible rail, it only hosts the maude:// deep-link dialogs. | `client/panels/CloudBar.jsx` · `CloudBar` | — | stable |
| `settings-team-server-add` | testid | Connections › Your team’s own server › Add a team server… (opens the address / email / password form). | `client/v2/settings/connections-section.jsx` · `ConnectionsSection` | — | stable |
| `settings-github` | testid | Connections › GitHub row (sign-in state). | `client/panels/IdentityBar.jsx` · `IdentityBar` | — | stable |
| `settings-github-signin` | testid | Connections › GitHub › Sign in. | `client/panels/IdentityBar.jsx` · `IdentityBar` | — | stable |
| `settings-github-signout` | testid | Connections › GitHub › Disconnect. | `client/panels/IdentityBar.jsx` · `IdentityBar` | — | stable |
| `settings-ai-keys` | testid | Connections › AI images, video and voice row (the provider keys, masked). | `client/v2/settings/connections-section.jsx` · `ConnectionsSection` | — | stable |
| `settings-ai-keys-toggle` | testid | Connections › AI keys › Manage / Hide. | `client/v2/settings/connections-section.jsx` · `ConnectionsSection` | — | stable |
| `figma-test` | testid | Connections › Figma › Test connection. | `client/panels/SettingsPanel.jsx` · `FigmaConnectCard` | — | stable |
| `settings-app-version` | testid | Advanced › This Mac › Version. | `client/v2/settings/advanced-section.jsx` · `AdvancedSection` | — | stable |
| `settings-update` | testid | Advanced › This Mac › Update row. | `client/v2/settings/advanced-section.jsx` · `AdvancedSection` | — | stable |
| `settings-update-restart` | testid | Advanced › This Mac › Update › Restart now (idle until a build is staged). | `client/v2/settings/advanced-section.jsx` · `AdvancedSection` | — | stable |
| `settings-update-later` | testid | Advanced › This Mac › Update › Later (only while a build is staged). | `client/v2/settings/advanced-section.jsx` · `AdvancedSection` | — | stable |
| `settings-server-build` | testid | Advanced › This Mac › Server build (MAUDE-DEV-SRV). | `client/v2/settings/advanced-section.jsx` · `AdvancedSection` | — | stable |
| `settings-keys-store` | testid | Advanced › This Mac › where provider keys are kept (keychain / keys.json). | `client/v2/settings/advanced-section.jsx` · `AdvancedSection` | — | stable |
| `settings-claude-autosetup` | testid | Advanced › Claude Code › Install and sign in automatically (Tauri pref; desktop app only). | `client/v2/settings/advanced-section.jsx` · `AdvancedSection` | — | stable |
| `settings-check-updates` | testid | Advanced › This Mac › Update › Check for updates (desktop app only; hidden while a build is staged). | `client/v2/settings/advanced-section.jsx` · `UpdateRow` | — | new |
| `settings-copy-draw` | testid | Advanced › Claude Code › Draw a mark with the SVG agent › Copy command. | `client/v2/settings/advanced-section.jsx` · `AdvancedSection` | — | stable |
| `settings-copy-brand` | testid | Advanced › Claude Code › Import a brand from the terminal › Copy command. | `client/v2/settings/advanced-section.jsx` · `AdvancedSection` | — | stable |
| `settings-reset-folds` | testid | Advanced › Reset › Reset Advanced sections: the row (every panel's Advanced fold goes back to a fresh Mac's). | `client/v2/settings/advanced-section.jsx` · `ResetFoldsRow` | test:v2-settings | new in v2 (V2-4.10) |
| `settings-reset-folds-btn` | testid | The Reset button inside that row. | `client/v2/settings/advanced-section.jsx` · `ResetFoldsRow` | test:v2-settings | new in v2 (V2-4.10) |
| `settings-transcription` | testid | Advanced › Engines › Subtitles (engine + whisper model cards). | `client/v2/settings/advanced-section.jsx` · `AdvancedSection` | — | stable |
| `settings-transcription-engine` | testid | Advanced › Engines › the transcription engine radio group (Auto / whisper.cpp / Scribe / Groq). | `client/panels/SettingsPanel.jsx` · `TranscriptionEngineCard` | — | stable |
| `settings-keyframes` | testid | Advanced › Engines › Video keyframes (engine + Gemma model cards). | `client/v2/settings/advanced-section.jsx` · `AdvancedSection` | — | stable |
| `settings-keyframe-engine` | testid | Advanced › Engines › the keyframe engine radio group (Auto / Gemma / ffmpeg / Blind). | `client/panels/SettingsPanel.jsx` · `KeyframeEngineCard` | — | stable |
| `settings-this-project` | testid | Advanced › This project group (sync switches, .design/ ownership). | `client/v2/settings/advanced-section.jsx` · `AdvancedSection` | — | stable |
| `settings-project-unlinked` | testid | Advanced › This project › the one-line note shown when the project is not linked to a workspace. | `client/v2/settings/project-sync-settings.jsx` · `ProjectSyncSettings` | — | stable |

### chat/ACP

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `acp-not-connected` | testid | Chat panel body shown while the ACP agent is not connected (holds the readiness list). | `client/panels/ChatPanel.jsx` · `NotConnected` | e2e:acp-ask-user-question, e2e:acp-capability-picker, e2e:acp-cold-start, e2e:acp-write-scope | stable — re-emit |
| `acp-setup-install` | testid | Readiness row action: install Claude Code. | `client/panels/ReadinessList.jsx` · `SetupAction` | e2e:acp-cold-start | stable — re-emit |
| `acp-setup-signin` | testid | Readiness row action: sign in to Claude Code. | `client/panels/ReadinessList.jsx` · `SetupAction` | — | stable — re-emit |
| `rdy-row-<id>` | testid (pattern) | One readiness check row (e.g. `rdy-row-claude`). Also rendered in onboarding and the readiness dialog. | `client/panels/ReadinessList.jsx` · `Row` | e2e:acp-cold-start | stable — re-emit |
| `readiness-autosetup-where` | testid | Readiness dialog: the one line saying the Claude Code auto-setup switch lives in Settings › Advanced. | `client/panels/ReadinessList.jsx` · `ReadinessDialog` | — | new |
| `chat-composer` | testid | The chat composer (input area). | `client/v2/ai/Composer.jsx` · `Composer` | e2e-helper:assistant, e2e:acp-ask-user-question, e2e:acp-capability-picker, e2e:acp-cold-start, e2e:acp-write-scope | stable — re-emit |
| `chat-context-chip` | testid | The context chip in the composer (what the agent will see). | `client/v2/ai/ScopeChip.jsx` · `ScopeChip` | — | stable — re-emit |
| `chat-mode-banner` | testid | "AI is set to suggest only" banner above the thread while the mode blocks edits (plan / dontAsk). | `client/v2/ai/Advanced.jsx` · `SuggestOnlyBanner` | e2e:acp-capability-picker | stable — re-emit |
| `chat-mode-banner-switch` | testid | "Allow changes" on that banner: switches to the least-privilege mode that can edit. | `client/v2/ai/Advanced.jsx` · `SuggestOnlyBanner` | — | stable — re-emit |
| `chat-tool-row` | testid | One tool-call row inside a tool card. | `client/v2/ai/Feed.jsx` · `ChatToolCard` | — | stable — re-emit |
| `chat-tool-group` | testid | "Ran N tools" row that folds 2+ consecutive tool calls (expands to the individual cards). | `client/panels/ToolGroup.jsx` · `ToolGroup` | — | stable — re-emit |
| `chat-msg-actions` | testid | The action row under a message. Emitted by both `UserMessage` and `AssistantMessage`. *Hover/focus-revealed (`opacity: 0` otherwise), so `isDisplayed()` never reports it, and it exists on the user message the moment it is sent — not a turn-finished signal. `e2e-helper:assistant` only counts it (one per message).* | `client/v2/ai/Feed.jsx` · `UserMessage`<br>`client/panels/ChatPanel.jsx` · `AssistantMessage` | e2e-helper:assistant | stable — re-emit |
| `chat-transcript-menu` | testid | The "Show in chat" select in Advanced (transcript view: normal, thinking, verbose, summary). | `client/v2/ai/Advanced.jsx` · `ChatAdvanced` | — | stable — re-emit |
| `chat-foot-info-btn` | testid | "Chat info" button in the chat footer. | `client/v2/ai/Composer.jsx` · `ChatFootInfo` | — | stable — re-emit |
| `chat-foot-popover` | testid | The chat info popover opened by `chat-foot-info-btn`. | `client/v2/ai/Composer.jsx` · `ChatFootInfo` | — | stable — re-emit |
| `chat-usage-banner` | testid | Rate-limit / usage banner in the chat. | `client/v2/ai/Composer.jsx` · `RateLimitBanner` | — | stable — re-emit |
| `chat-error-card` | testid | Error card in the chat transcript (`role="alert"`). | `client/v2/ai/Feed.jsx` · `ErrorCard` | — | stable — re-emit |
| `chat-qa-implement-comments` | testid | Quick action "implement comments". | `client/v2/ai/Suggest.jsx` · `QuickActions` | — | stable — re-emit |
| `chat-cmd-menu` | testid | The slash-command popover (`role="listbox"`). | `client/v2/ai/Composer.jsx` · `CommandPopover` | — | stable — re-emit |
| `chat-cmd-item-<name>` | testid (pattern) | One slash-command item; `<name>` = command name with non-alphanumerics → `-`. | `client/v2/ai/Composer.jsx` · `CommandPopover` | — | stable — re-emit |
| `chat-overflow-menu` | testid | A chat row's ⋯ menu in the chat list: Open · Rename… · Copy transcript · Archive · Move to trash. | `client/v2/ai/ChatList.jsx` · `RowMenu` | — | stable — re-emit |
| `chat-caps-connecting` | testid | Advanced placeholder while the agent connects. | `client/v2/ai/Advanced.jsx` · `ChatAdvanced` | — | stable — re-emit |
| `chat-caps-bar` | testid | The Advanced fold's picker rows (live model / effort / fast mode / Ask before), under the AI chat panel's Advanced. | `client/v2/ai/Advanced.jsx` · `ChatAdvanced` | — | stable — re-emit |
| `chat-mode-picker` | testid | The "Ask before" picker in Advanced (the permission mode, in plain words). | `client/v2/ai/Advanced.jsx` · `ChatAdvanced` | e2e-helper:assistant, e2e:acp-capability-picker, whats-new | stable — re-emit |
| `chat-permission-prompt` | testid | The tool-permission prompt card. | `client/panels/PermissionPrompt.jsx` · `PermissionPrompt` | e2e:acp-write-scope | stable — re-emit |
| `chat-perm-queue` | testid | Queue counter on the permission prompt. | `client/panels/PermissionPrompt.jsx` · `PermissionPrompt` | — | stable — re-emit |
| `chat-perm-outside` | testid | Warning that a requested write is outside the project. | `client/panels/PermissionPrompt.jsx` · `PermissionPrompt` | e2e:acp-write-scope, test:acp-permission-prompt | stable — re-emit |
| `chat-perm-paths` | testid | The list of paths a permission request touches. | `client/panels/PermissionPrompt.jsx` · `PermissionPrompt` | e2e:acp-write-scope | stable — re-emit |
| `chat-elicit-prompt` | testid | The "Claude is asking you" elicitation card. | `client/panels/ElicitationPrompt.jsx` · `ElicitationPrompt` | e2e:acp-ask-user-question, whats-new | stable — re-emit |
| `chat-overflow-menu` | testid | The chat panel overflow (⋯) menu. | `client/panels/ChatPanel.jsx` · `ChatPanel` | — | stable — re-emit |
| `chat-caps-connecting` | testid | Capability bar placeholder while the agent connects. | `client/panels/CapabilityBar.jsx` · `CapabilityBar` | — | stable — re-emit |
| `chat-caps-bar` | testid | The capability bar (live model/mode/effort pickers). | `client/panels/CapabilityBar.jsx` · `CapabilityBar` | — | stable — re-emit |
| `chat-mode-picker` | testid | The permission-mode picker in the capability bar. | `client/panels/CapabilityBar.jsx` · `CapabilityBar` | e2e-helper:assistant, e2e:acp-capability-picker, whats-new | stable — re-emit |
| `chat-permission-prompt` | testid | The tool-permission prompt card. | `client/panels/PermissionPrompt.jsx` · `PermissionPrompt`<br>`client/v2/ai/PermissionCard.jsx` · `PermissionCard` | e2e:acp-write-scope | stable — re-emit |
| `chat-perm-queue` | testid | Queue counter on the permission prompt. | `client/panels/PermissionPrompt.jsx` · `PermissionPrompt`<br>`client/v2/ai/PermissionCard.jsx` · `PermissionCard` | — | stable — re-emit |
| `chat-perm-outside` | testid | Warning that a requested write is outside the project. | `client/panels/PermissionPrompt.jsx` · `PermissionPrompt`<br>`client/v2/ai/PermissionCard.jsx` · `PermissionCard` | e2e:acp-write-scope, test:acp-permission-prompt | stable — re-emit |
| `chat-perm-paths` | testid | The list of paths a permission request touches. | `client/panels/PermissionPrompt.jsx` · `PermissionPrompt`<br>`client/v2/ai/PermissionCard.jsx` · `PermissionCard` | e2e:acp-write-scope | stable — re-emit |
| `chat-elicit-prompt` | testid | The "Claude is asking you" elicitation card. | `client/panels/ElicitationPrompt.jsx` · `ElicitationPrompt`<br>`client/v2/ai/ChoiceCard.jsx` · `ChoiceCard` | e2e:acp-ask-user-question, whats-new | stable — re-emit |
| `chat-elicit-step` | testid | Step counter on a multi-question elicitation. | `client/panels/ElicitationPrompt.jsx` · `ElicitationPrompt` | — | stable — re-emit |
| `chat-elicit-back` | testid | Elicitation Back button. | `client/panels/ElicitationPrompt.jsx` · `ElicitationPrompt` | — | stable — re-emit |
| `chat-elicit-submit` | testid | Elicitation Submit button. | `client/panels/ElicitationPrompt.jsx` · `ElicitationPrompt`<br>`client/v2/ai/ChoiceCard.jsx` · `ChoiceCard` | e2e:acp-ask-user-question | stable — re-emit |
| `chat-elicit-next` | testid | Elicitation Next button. | `client/panels/ElicitationPrompt.jsx` · `ElicitationPrompt` | — | stable — re-emit |
| `chat-elicit-skip` | testid | Elicitation Skip button. | `client/panels/ElicitationPrompt.jsx` · `ElicitationPrompt`<br>`client/v2/ai/ChoiceCard.jsx` · `ChoiceCard` | — | stable — re-emit |
| `chat-elicit-cancel` | testid | Elicitation Cancel button. | `client/panels/ElicitationPrompt.jsx` · `ElicitationPrompt` | — | stable — re-emit |
| `chat-elicit-question-<id>` | testid (pattern) | One question fieldset (`<id>` = question id). | `client/panels/ElicitationPrompt.jsx` · `Question` | — | stable — re-emit |
| `chat-elicit-option-<id>-<i>` | testid (pattern) | Option `<i>` of question `<id>`; `chat-elicit-option-<id>-other` is the free-text "Other" option. | `client/panels/ElicitationPrompt.jsx` · `Question`<br>`client/v2/ai/ChoiceCard.jsx` · `ChoiceCard` | e2e:acp-ask-user-question | stable — re-emit |
| `chat-elicit-custom-<id>` | testid (pattern) | Free-text input behind the "Other" option. | `client/panels/ElicitationPrompt.jsx` · `Question`<br>`client/v2/ai/ChoiceCard.jsx` · `ChoiceCard` | — | stable — re-emit |
| `chat-elicit-text-<id>` | testid (pattern) | Text answer input for a text question. | `client/panels/ElicitationPrompt.jsx` · `Question` | — | stable — re-emit |
| `chat-elicit-secret-warning` | testid | Warning shown when a question asks for a secret. | `client/panels/ElicitationPrompt.jsx` · `Question` | — | stable — re-emit |
| `.chat-input` | selector | The composer textarea. | `client/v2/ai/Composer.jsx` · `HighlightedInput` | e2e-helper:assistant, e2e:acp-ask-user-question, e2e:acp-capability-picker, e2e:acp-write-scope | stable — re-emit |
| `[aria-label="Send message"]` | selector | Composer send button. | `client/v2/ai/Composer.jsx` · `Composer` | e2e:acp-ask-user-question, e2e:acp-write-scope | stable — re-emit |
| `[aria-label="Stop"]` | selector | The composer's Stop button; rendered only while the thread is running. | `client/v2/ai/Composer.jsx` · `Composer` | e2e-helper:assistant | stable — re-emit |
| `.btn--danger (permission prompt)` | selector | The deny/destructive button on the permission prompt (`[data-testid="chat-permission-prompt"] .btn--danger`). | `client/panels/PermissionPrompt.jsx` · `PermissionPrompt`<br>`client/v2/ai/PermissionCard.jsx` · `PermissionCard` | e2e:acp-write-scope | stable — re-emit |
| `.rdy-copy / .rdy-fix-tx / .rdy-fix-tx--err` | selector | Readiness list: copy-command button, fix transcript, and its error state. | `client/panels/ReadinessList.jsx` · `Row`<br>`client/panels/ReadinessList.jsx` · `SetupAction` | e2e:acp-cold-start | stable — re-emit |

### timeline

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `timeline-panel` | testid | The Timeline (video) panel root. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | e2e-mp:surface, e2e:timeline-manual-cut | moves — map in Phase 4 |
| `timeline-resize-handle` | testid | Drag handle that resizes the Timeline panel height. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-playpause` | testid | Play/pause button. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-loop` | testid | Loop toggle. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-mute` | testid | Mute toggle. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-volume` | testid | Volume slider. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-artboard` | testid | Artboard (comp) picker. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-readout` | testid | Current-time readout. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | e2e-mp:surface | moves — map in Phase 4 |
| `timeline-split` | testid | Split-at-playhead button. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-add-title` | testid | Add-title-clip button. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | e2e-mp:surface | moves — map in Phase 4 |
| `timeline-add-image` | testid | Add-image-clip button. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-placeholder-add` | testid | Add an AI placeholder clip at the end of the storyline. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-comment-tool` | testid | Timeline comment tool toggle. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-long-badge` | testid | Badge warning that the comp is long (slow export). | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-zoom` | testid | Timeline zoom control. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | e2e:timeline-manual-cut | moves — map in Phase 4 |
| `timeline-empty` | testid | Empty state (no video comp on the canvas). | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | runner:video-timeline-badge/web-desktop.sh, spec:video-timeline-badge | moves — map in Phase 4 |
| `timeline-track` | testid | The scrollable track area. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | e2e:timeline-manual-cut | moves — map in Phase 4 |
| `timeline-storyline` | testid | The storyline (main clip) row. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | e2e:timeline-manual-cut | moves — map in Phase 4 |
| `timeline-playhead` | testid | The playhead. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-drop-caret` | testid | Insertion caret shown while dragging a clip (two render sites). | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-newlayer-zone` | testid | Drop zone below the lanes that creates a new layer. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-trim-in-tip` | testid | Tooltip while trimming a clip in-point. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-trim-tip` | testid | Tooltip while retiming/trimming a clip. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-move-tip` | testid | Tooltip while moving a clip. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-comments-strip` | testid | The strip of comment markers above the track. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-comment-<id>` | testid (pattern) | One comment marker on the strip. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-comment-composer` | testid | Timeline comment composer. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-comment-submit` | testid | Timeline comment submit. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-comment-popover` | testid | Popover showing a timeline comment. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-seq-<i>` | testid (pattern) | Storyline clip block `<i>` (0-based); `title` includes "drag to move". | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | e2e-mp:surface, e2e:timeline-manual-cut, test:timeline-drag-commit | moves — map in Phase 4 |
| `timeline-speed-chip-<i>` | testid (pattern) | Speed chip on clip `<i>`. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-mute-chip-<i>` | testid (pattern) | Muted chip on clip `<i>`. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-kf-<i>-<k>` | testid (pattern) | Keyframe marker `<k>` on clip `<i>` (click seeks to it). | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-clip-pin-<id>` | testid (pattern) | Comment pin on a clip (`<id>` = comment id). | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-beat-expand-<i>` | testid (pattern) | Show/collapse the layers of beat `<i>`. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-resize-<i>` | testid (pattern) | Right-edge handle: drag to retime clip `<i>`. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | e2e-mp:surface | moves — map in Phase 4 |
| `timeline-trim-in-<i>` | testid (pattern) | Left-edge handle: drag to trim the in-point of clip `<i>`. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-replace-<i>` | testid (pattern) | Replace-media button on clip `<i>`. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-seam-add-<k>` | testid (pattern) | Add-transition button at seam `<k>` (between clips). | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-seam-<k>` | testid (pattern) | Transition chip at seam `<k>` (click to edit). | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-audio-<i>` | testid (pattern) | Audio row `<i>`. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-audio-replace-<i>` | testid (pattern) | Replace-audio button on audio row `<i>`. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-row-<i>` | testid (pattern) | Overlay/audio lane row `<i>` (three render sites). | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-lane-chip-<i>` | testid (pattern) | Lane label chip on row `<i>` (drag up/down to reorder layers). | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-expand-<i>` | testid (pattern) | Show/collapse the layers of row `<i>`. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-layer-<i>-<li>` | testid (pattern) | Layer `<li>` of lane `<i>` (two render sites). | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-layer-block-<i>-<li>` | testid (pattern) | The draggable block of layer `<li>` in lane `<i>`. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-layer-replace-<i>-<li>` | testid (pattern) | Replace-media button on a layer block. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | — | moves — map in Phase 4 |
| `timeline-inspector` | testid | The clip inspector beside the timeline. | `client/panels/ClipInspector.jsx` · `ClipInspector` | e2e-mp:surface | moves — map in Phase 4 |
| `timeline-inspector-tab-<tab>` | testid (pattern) | Clip inspector tab; `<tab>` = tab label lower-cased. | `client/panels/ClipInspector.jsx` · `TabBar` | — | moves — map in Phase 4 |
| `timeline-speed-<speed>` | testid (pattern) | Speed preset button; `<speed>` with `.` → `_` (e.g. `timeline-speed-0_5`). | `client/panels/ClipInspector.jsx` · `ClipInspector` | — | moves — map in Phase 4 |
| `timeline-detach-audio` | testid | Detach-audio button. | `client/panels/ClipInspector.jsx` · `ClipInspector` | — | moves — map in Phase 4 |
| `timeline-grade-readonly` | testid | Note that grading is read-only for this clip. | `client/panels/ClipInspector.jsx` · `ClipInspector` | — | moves — map in Phase 4 |
| `timeline-grade-<name>` | testid (pattern) | Colour-grade control; `<name>` lower-cased. | `client/panels/ClipInspector.jsx` · `ClipInspector` | — | moves — map in Phase 4 |
| `timeline-inspector-text` | testid | Text input for a title clip. | `client/panels/ClipInspector.jsx` · `ClipInspector` | e2e-mp:surface | moves — map in Phase 4 |
| `timeline-inspector-text-apply` | testid | Apply button for the title text. | `client/panels/ClipInspector.jsx` · `ClipInspector` | e2e-mp:surface | moves — map in Phase 4 |
| `timeline-transition-grid` | testid | Grid of transition presets. | `client/panels/ClipInspector.jsx` · `ClipInspector` | — | moves — map in Phase 4 |
| `timeline-transition-<p>` | testid (pattern) | One transition preset (`<p>` = preset id). | `client/panels/ClipInspector.jsx` · `ClipInspector` | — | moves — map in Phase 4 |
| `timeline-transition-remove` | testid | Remove-transition button. | `client/panels/ClipInspector.jsx` · `ClipInspector` | — | moves — map in Phase 4 |
| `.tl-panel` | selector | Timeline panel root (same element as `timeline-panel`). | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | runner:video-timeline-badge/web-desktop.sh, spec:video-timeline-badge | moves — map in Phase 4 |
| `.tl-seq-block` | selector | A storyline clip block; `.is-selected` = selected. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | e2e-mp:surface, e2e:timeline-manual-cut | moves — map in Phase 4 |
| `.tl-beat` | selector | A beat in the storyline. | `client/panels/TimelinePanel.jsx` · `TimelinePanel` | e2e:timeline-manual-cut | moves — map in Phase 4 |
| `.tlci-x` | selector | Close button of the clip inspector. | `client/panels/ClipInspector.jsx` · `ClipInspector` | e2e-mp:surface | moves — map in Phase 4 |

### git/history

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `git-panel` | testid | The Changes (git) panel root. | `client/panels/GitPanel.jsx` · `GitPanel` | e2e:git-lifecycle, e2e:s20-deployment, e2e:team-project | stable — re-emit |
| `git-panel-repo` | testid | Project / shared-draft label in the Changes panel header (the cloud project when history comes from the cloud). | `client/panels/GitPanel.jsx` · `GitPanel` | — | stable — re-emit |
| `git-cloud-managed` | testid | Note in a cloud-managed project that saving is automatic (replaces the commit form). | `client/panels/GitPanel.jsx` · `GitPanel` | test:cloud-managed-save-surfaces (source text), test:git-cloud-posture (source text) | stable — re-emit |
| `git-get-latest` | testid | "Get latest" (pull) button (two render sites). | `client/panels/GitPanel.jsx` · `GitPanel` | e2e:git-lifecycle | stable — re-emit |
| `git-commit-message` | testid | Commit message input. | `client/panels/GitPanel.jsx` · `GitPanel` | e2e:git-lifecycle | stable — re-emit |
| `git-save-all` | testid | "Save all" (commit) button. | `client/panels/GitPanel.jsx` · `GitPanel` | e2e:git-lifecycle | stable — re-emit |
| `git-publish` | testid | "Publish" (push) button. | `client/panels/GitPanel.jsx` · `GitPanel` | e2e:git-lifecycle | stable — re-emit |
| `git-history-unreachable` | testid | History tab: the server history could not be reached. | `client/panels/GitPanel.jsx` · `GitPanel` | test:cloud-history-posture (source text) | stable — re-emit |
| `git-history-retry` | testid | History tab: Retry button. | `client/panels/GitPanel.jsx` · `GitPanel` | test:cloud-history-posture (source text) | stable — re-emit |
| `project-history-row-<revision>` | testid (pattern) | One accepted project-history version row. | `client/panels/GitPanel.jsx` · `AcceptedRow` | runner:reliable-project-multiplayer/f3/s19-browser.mjs, e2e-mp:surface, test:history-preview-restore | stable — re-emit |
| `project-history-preview-<revision>` | testid (pattern) | Preview button on a history row. | `client/panels/GitPanel.jsx` · `AcceptedRow` | runner:reliable-project-multiplayer/f3/s11-browser.mjs, runner:reliable-project-multiplayer/f3/s19-browser.mjs, e2e-mp:surface | stable — re-emit |
| `project-history-restore-<revision>` | testid (pattern) | Restore button on a history row. | `client/panels/GitPanel.jsx` · `AcceptedRow` | e2e-mp:surface | stable — re-emit |
| `project-history-undo-<revision>` | testid (pattern) | Undo button on the latest history row. | `client/panels/GitPanel.jsx` · `AcceptedRow` | e2e-mp:surface, e2e:s20-deployment | stable — re-emit |
| `history-preview-version` | testid | Version label in the history preview (diff) sheet. | `client/panels/DiffView.jsx` · `DiffView` | runner:reliable-project-multiplayer/f3/s11-browser.mjs, runner:reliable-project-multiplayer/f3/s19-browser.mjs, e2e-mp:surface | stable — re-emit |
| `history-preview-restore` | testid | Restore button in the history preview sheet. | `client/panels/DiffView.jsx` · `DiffView` | runner:reliable-project-multiplayer/f3/s11-browser.mjs, e2e-mp:surface | stable — re-emit |
| `repo-switcher-trigger` | testid | Bottom-of-sidebar project/branch switcher button (two render branches). | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | spec:git-branch-switcher, e2e:cloud-attach, e2e:git-branch-switcher, e2e:git-lifecycle, e2e:git-switch-repos, e2e:team-project | moves — map in Phase 4 |
| `repo-switcher-popup` | testid | The switcher popup menu (two render branches). | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | spec:git-branch-switcher, e2e:git-branch-switcher, e2e:git-lifecycle, e2e:team-project | moves — map in Phase 4 |
| `branch-row-<branch>` | testid (pattern) | A branch row in the switcher; `<branch>` from the module-local `slugify`/`tid` (e.g. `branch-row-main`, `branch-row-feat-local-work`). | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | spec:git-branch-switcher, spec:git-lifecycle, e2e:git-branch-switcher, e2e:git-lifecycle | moves — map in Phase 4 |
| `switcher-open-team` | testid | Switcher item that opens the team-projects dialog. | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | e2e:cloud-attach, e2e:team-project | moves — map in Phase 4 |
| `switcher-get-latest` | testid | Switcher "Get latest" button. | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | — | moves — map in Phase 4 |
| `switcher-resume` | testid | "Resume where you left off" strip in the switcher. | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | — | moves — map in Phase 4 |
| `switcher-resume-dismiss` | testid | Dismiss for the resume strip. | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | — | moves — map in Phase 4 |
| `switcher-merge` | testid | Switcher item "add this draft to &lt;shared&gt;" (merge). | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | e2e:git-lifecycle | moves — map in Phase 4 |
| `switcher-merge-confirm` | testid | Confirm button for the merge. | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | e2e:git-lifecycle | moves — map in Phase 4 |
| `switcher-fetch` | testid | Switcher item that refreshes remote drafts. | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | e2e:git-lifecycle | moves — map in Phase 4 |
| `switcher-new-branch` | testid | Switcher item "new draft". | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | e2e:git-lifecycle | moves — map in Phase 4 |
| `switcher-new-branch-input` | testid | Branch-name input for a new draft. | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | e2e:git-lifecycle | moves — map in Phase 4 |
| `switcher-new-branch-create` | testid | Create button for a new draft. | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | e2e:git-lifecycle | moves — map in Phase 4 |
| `switcher-chat-guard` | testid | Dialog that warns a branch switch would interrupt a running chat. | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | — | moves — map in Phase 4 |
| `switcher-chat-guard-cancel` | testid | Cancel on the chat guard. | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | — | moves — map in Phase 4 |
| `switcher-chat-guard-confirm` | testid | Confirm on the chat guard. | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | — | moves — map in Phase 4 |
| `switcher-pr-link` | testid | Button that opens/copies the pull-request link after a merge. | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | — | moves — map in Phase 4 |
| `switcher-pr-dismiss` | testid | "Got it" on the pull-request result. | `client/panels/RepoBranchSwitcher.jsx` · `RepoBranchSwitcher` | — | moves — map in Phase 4 |
| `[data-tour="save-local"]` | data-tour | The local save (commit) control in the Changes panel. | `client/panels/GitPanel.jsx` · `GitPanel` | tour:collab-tour | stable — re-emit |
| `[data-tour="publish"]` | data-tour | The Publish (push) button in the Changes panel (same element as `git-publish`). | `client/panels/GitPanel.jsx` · `GitPanel` | tour:collab-tour | stable — re-emit |
| `[data-tour="pull"]` | data-tour | The Get-latest (pull) button in the Changes panel (same element as one `git-get-latest`). | `client/panels/GitPanel.jsx` · `GitPanel` | tour:collab-tour | stable — re-emit |
| `.gp-panel` | selector | Changes panel body. | `client/panels/GitPanel.jsx` · `GitPanel` | e2e-mp:surface | stable — re-emit |
| `.gp-version` | selector | A version row in the Changes panel history. | `client/panels/GitPanel.jsx` · `AcceptedRow` | e2e-mp:surface | stable — re-emit |
| `.gp-tabs / .gp-cloud-note` | selector | Changes panel tab strip (hidden when withdrawn) and the cloud-managed note. *Source-text consumer only: `test/git-cloud-posture.test.ts` regex-matches `className="gp-tabs"` / `className="gp-cloud-note"` in `GitPanel.jsx`.* | `client/panels/GitPanel.jsx` · `GitPanel` | test:git-cloud-posture (source text) | stable — re-emit |
| `.dv-frame` | selector | The canvas frame inside the history preview (diff) sheet. | `client/panels/DiffView.jsx` · `CanvasView` | e2e-mp:surface | stable — re-emit |
| `.dv-zoom-sync` | selector | Zoom-sync label in the diff zoom bar. *CSS consumer.* | `client/panels/DiffView.jsx` · `ZoomBar` | test:shell-text-contrast | stable — re-emit |
| `git-compare` | testid | The compare-before/after button on a changed canvas in the Changes list. | `client/panels/GitPanel.jsx` · `GitPanel` | — | new |
| `git-discard` | testid | The discard button on a changed file (or canvas with its supporting files) in the Changes list. Desktop only (read-only elsewhere). | `client/panels/GitPanel.jsx` · `GitPanel` | — | new |

### sync/cloud

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `sync-panel` | testid | The Sync panel root (per-file hub sync). | `client/panels/SyncPanel.jsx` · `SyncPanel` | e2e:cloud-attach, e2e:team-project | stable — re-emit |
| `sync-row-<slug>` | testid (pattern) | One per-file sync row (`<slug>` = item slug); class `is-<state>`. | `client/panels/SyncPanel.jsx` · `Row` | — | stable — re-emit |
| `sync-offline` | testid | "Download all" button: fetch every project file to this device for offline work (local shell only). | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-resync` | testid | "Resync" button. | `client/panels/SyncPanel.jsx` · `SyncPanel` | e2e:cloud-attach, test:sync-panel-surface (source text) | stable — re-emit |
| `sync-offline-note` | testid | Live-region note shown while offline/resyncing. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-signin-again` | testid | "Sign in again" button when the hub session expired. | `client/panels/SyncPanel.jsx` · `SyncPanel` | e2e:team-project | stable — re-emit |
| `sync-ai-held` | testid | Section for an unfinished AI edit held back from sync. | `client/panels/SyncPanel.jsx` · `SyncPanel` | e2e-mp:surface | stable — re-emit |
| `sync-ai-publish` | testid | Publish the held AI edit. | `client/panels/SyncPanel.jsx` · `SyncPanel` | e2e-mp:surface | stable — re-emit |
| `sync-ai-discard` | testid | Discard the held AI edit. | `client/panels/SyncPanel.jsx` · `SyncPanel` | e2e-mp:surface | stable — re-emit |
| `sync-notices` | testid | The notices section. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-notice-<id>` | testid (pattern) | One sync notice. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-resolve-<doc>` | testid (pattern) | Resolve button on a source-conflict notice; `<doc>` = notice id without the `source-conflict-` prefix. | `client/panels/SyncPanel.jsx` · `SyncPanel` | runner:reliable-project-multiplayer/f3/s18-desktop.mjs | stable — re-emit |
| `sync-notice-dismiss-<id>` | testid (pattern) | Dismiss button on a notice. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-assets` | testid | The assets transfer section. | `client/panels/SyncPanel.jsx` · `SyncPanel` | test:sync-panel-surface (source text) | stable — re-emit |
| `sync-assets-cancel` | testid | Cancel the assets transfer. | `client/panels/SyncPanel.jsx` · `SyncPanel` | test:sync-panel-surface (source text) | stable — re-emit |
| `sync-files` | testid | The project-files transfer section. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-files-progress` | testid | File transfer progress track. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-files-remaining` | testid | Files-remaining line. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-files-phase` | testid | Transfer phase line. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-blocked-<class>` | testid (pattern) | A blocked-files group by reason class (e.g. `sync-blocked-too-large`). | `client/panels/SyncPanel.jsx` · `SyncPanel` | e2e-mp:surface | stable — re-emit |
| `sync-files-conflicts` | testid | Conflicted files callout. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-files-rate-limited` | testid | Rate-limited callout. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-files-failed` | testid | Failed transfers callout. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-held-<kind>` | testid (pattern) | A held-back-files callout by kind. | `client/panels/SyncPanel.jsx` · `SyncPanel` | test:sync-panel-surface (source text) | stable — re-emit |
| `sync-delivery-attention` | testid | List of files whose delivery needs attention. | `client/panels/SyncPanel.jsx` · `SyncPanel` | e2e-mp:surface | stable — re-emit |
| `sync-delivery-fine` | testid | Collapsed list of files delivered fine. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-trash` | testid | Sync trash section. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-trash-list` | testid | Sync trash list. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-trash-restore-<sourceRel>` | testid (pattern) | Restore button for a trashed file (`<sourceRel>` = its original relative path). | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-trash-prune` | testid | Empty-trash button. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-trash-prune-confirm` | testid | Empty-trash confirmation. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-trash-prune-yes` | testid | Confirm empty-trash. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-settings` | testid | Sync settings section. | `client/v2/settings/project-sync-settings.jsx` · `ProjectSyncSettings` | — | stable — re-emit |
| `sync-setting-syncFiles` | testid | Setting: sync project files (camelCase id, breaks the kebab-case convention). | `client/v2/settings/project-sync-settings.jsx` · `ProjectSyncSettings` | — | stable — re-emit |
| `sync-setting-propagateDeletes` | testid | Setting: propagate deletes (camelCase id). | `client/v2/settings/project-sync-settings.jsx` · `ProjectSyncSettings` | — | stable — re-emit |
| `sync-setting-firstAnchor` | testid | Setting: first-link anchor (camelCase id). | `client/v2/settings/project-sync-settings.jsx` · `ProjectSyncSettings` | — | stable — re-emit |
| `sync-ownership` | testid | Ownership section. | `client/v2/settings/project-sync-settings.jsx` · `ProjectSyncSettings` | — | stable — re-emit |
| `sync-ownership-mode` | testid | Current ownership mode line. | `client/v2/settings/project-sync-settings.jsx` · `ProjectSyncSettings` | — | stable — re-emit |
| `sync-ownership-adopt` | testid | Adopt ownership button. | `client/v2/settings/project-sync-settings.jsx` · `ProjectSyncSettings` | — | stable — re-emit |
| `sync-ownership-detach` | testid | Detach ownership button. | `client/v2/settings/project-sync-settings.jsx` · `ProjectSyncSettings` | — | stable — re-emit |
| `sync-ownership-confirm` | testid | Ownership change confirmation. | `client/v2/settings/project-sync-settings.jsx` · `ProjectSyncSettings` | — | stable — re-emit |
| `sync-ownership-confirm-yes` | testid | Confirm ownership change. | `client/v2/settings/project-sync-settings.jsx` · `ProjectSyncSettings` | — | stable — re-emit |
| `sync-consent` | testid | First-link sync consent dialog. | `client/panels/SyncConsentDialog.jsx` · `SyncConsentDialog` | — | stable — re-emit |
| `sync-consent-limit` | testid | Size-limit line in the consent dialog. | `client/panels/SyncConsentDialog.jsx` · `SyncConsentDialog` | — | stable — re-emit |
| `sync-consent-accept` | testid | Accept button in the consent dialog. | `client/panels/SyncConsentDialog.jsx` · `SyncConsentDialog` | e2e-mp:cloud-entry, e2e-mp:selfhost-entry | stable — re-emit |
| `source-conflict-panel` | testid | Source-conflict resolution dialog. | `client/panels/SourceConflictPanel.jsx` · `SourceConflictPanel` | runner:reliable-project-multiplayer/f3/s18-desktop.mjs | stable — re-emit |
| `source-conflict-close` | testid | Close button. | `client/panels/SourceConflictPanel.jsx` · `SourceConflictPanel` | test:source-conflict-dialog | stable — re-emit |
| `source-conflict-original` | testid | "Original draft" side. | `client/panels/SourceConflictPanel.jsx` · `SourceConflictPanel` | test:source-conflict-dialog | stable — re-emit |
| `source-conflict-base` | testid | "Starting version" side. | `client/panels/SourceConflictPanel.jsx` · `SourceConflictPanel` | test:source-conflict-dialog | stable — re-emit |
| `source-conflict-diff` | testid | The differences region. | `client/panels/SourceConflictPanel.jsx` · `SourceConflictPanel` | test:source-conflict-dialog | stable — re-emit |
| `source-conflict-error` | testid | Error line. | `client/panels/SourceConflictPanel.jsx` · `SourceConflictPanel` | — | stable — re-emit |
| `source-conflict-keep-mine` | testid | "Keep mine" button. | `client/panels/SourceConflictPanel.jsx` · `SourceConflictPanel` | — | stable — re-emit |
| `source-conflict-use-theirs` | testid | "Use theirs" button. | `client/panels/SourceConflictPanel.jsx` · `SourceConflictPanel` | runner:reliable-project-multiplayer/f3/s18-desktop.mjs, test:source-conflict-dialog | stable — re-emit |
| `cloud-bar` | testid | The Maude Cloud rail at the bottom of the sidebar (local, non-cloud shell only). | `client/panels/CloudBar.jsx` · `CloudBar` | e2e:cloud-attach | moves — map in Phase 4 |
| `cloud-signin` | testid | Cloud rail "Sign in" button (signed out). | `client/panels/CloudBar.jsx` · `CloudBar` | e2e:cloud-attach | moves — map in Phase 4 |
| `cloud-connect-note` | testid | Cloud rail status note (`role="status"`, `title` carries detail). | `client/panels/CloudBar.jsx` · `CloudBar` | e2e:cloud-attach | moves — map in Phase 4 |
| `cloud-project-<id>` | testid (pattern) | A cloud project item in the account menu (three render forms: view-only, connected, connectable). | `client/panels/CloudBar.jsx` · `CloudBar` | e2e:cloud-attach | moves — map in Phase 4 |
| `cloud-disconnect-<id>` | testid (pattern) | Disconnect this folder from cloud project `<id>`. | `client/panels/CloudBar.jsx` · `CloudBar` | — | moves — map in Phase 4 |
| `cloud-device-dialog` | testid | Cloud device-code sign-in dialog. | `client/panels/CloudBar.jsx` · `CloudBar` | — | stable — re-emit |
| `cloud-user-code` | testid | The device code in that dialog. | `client/panels/CloudBar.jsx` · `CloudBar` | — | stable — re-emit |
| `cloud-signin-link` | testid | Verification link in the device dialog. | `client/panels/CloudBar.jsx` · `CloudBar` | — | stable — re-emit |
| `cloud-signin-refused` | testid | Warning: the verification address is not Maude Cloud. | `client/panels/CloudBar.jsx` · `CloudBar` | — | stable — re-emit |
| `cloud-signin-badurl` | testid | Warning: the verification address is not displayable. | `client/panels/CloudBar.jsx` · `CloudBar` | — | stable — re-emit |
| `cloud-deeplink-dialog` | testid | "Connect this folder to &lt;project&gt;" dialog opened by a cloud deep link. | `client/panels/CloudBar.jsx` · `CloudBar` | e2e:cloud-attach, e2e:share-link | stable — re-emit |
| `cloud-deeplink-local` | testid | The local folder name in the deep-link dialog. | `client/panels/CloudBar.jsx` · `CloudBar` | — | stable — re-emit |
| `cloud-deeplink-mismatch` | testid | Warning that the open folder does not match the link. | `client/panels/CloudBar.jsx` · `CloudBar` | e2e:cloud-attach | stable — re-emit |
| `cloud-deeplink-open` | testid | Open the managed copy instead. | `client/panels/CloudBar.jsx` · `CloudBar` | — | stable — re-emit |
| `cloud-deeplink-connect` | testid | Connect / "Connect anyway" (two render forms). | `client/panels/CloudBar.jsx` · `CloudBar` | e2e:cloud-attach | stable — re-emit |
| `cloud-deeplink-dismiss` | testid | Dismiss the deep-link dialog (two render forms). | `client/panels/CloudBar.jsx` · `CloudBar` | e2e:cloud-attach | stable — re-emit |
| `file-deeplink-dialog` | testid | Dialog for a shared file link whose project is not open/on this machine. | `client/panels/file-deep-link-dialog.jsx` · `FileDeepLinkDialog` | e2e:share-link | stable — re-emit |
| `file-deeplink-dismiss` | testid | "Not now" in the file deep-link dialog. | `client/panels/file-deep-link-dialog.jsx` · `FileDeepLinkDialog` | e2e:share-link | stable — re-emit |
| `file-deeplink-open` | testid | "Open project" in the file deep-link dialog. | `client/panels/file-deep-link-dialog.jsx` · `FileDeepLinkDialog` | — | stable — re-emit |
| `team-projects` | testid | Team projects list (onboarding team door and the team dialog). | `client/panels/TeamProjects.jsx` · `TeamProjects` | e2e-mp:cloud-entry, e2e-mp:selfhost-entry, e2e:s20-deployment, e2e:team-project | stable — re-emit |
| `team-error` | testid | Error callout in team projects. | `client/panels/TeamProjects.jsx` · `ErrorLine` | e2e:cloud-attach, e2e:team-project, test:team-projects-empty | stable — re-emit |
| `team-opening` | testid | "Opening…" live callout. | `client/panels/TeamProjects.jsx` · `TeamProjects` | — | stable — re-emit |
| `team-recent-<key>` | testid (pattern) | A recently opened team project. | `client/panels/TeamProjects.jsx` · `TeamProjects` | e2e:team-project | stable — re-emit |
| `team-cloud-signin` | testid | Sign in to Maude Cloud from team projects. | `client/panels/TeamProjects.jsx` · `TeamProjects` | e2e-mp:cloud-entry | stable — re-emit |
| `team-cloud-device` | testid | Inline device-code block. | `client/panels/TeamProjects.jsx` · `TeamProjects` | — | stable — re-emit |
| `team-cloud-code` | testid | The device code. | `client/panels/TeamProjects.jsx` · `TeamProjects` | e2e-mp:cloud-entry | stable — re-emit |
| `team-cloud-empty` | testid | Empty state: no cloud projects. | `client/panels/TeamProjects.jsx` · `TeamProjects` | test:team-projects-empty | stable — re-emit |
| `team-cloud-project-<id>` | testid (pattern) | A cloud project button (view-in-browser or open; two render forms). | `client/panels/TeamProjects.jsx` · `TeamProjects` | e2e-mp:cloud-entry, e2e:cloud-attach, test:team-projects-empty | stable — re-emit |
| `team-hub-url` | testid | Self-hosted hub: server address input. | `client/panels/TeamProjects.jsx` · `TeamProjects` | e2e-mp:selfhost-entry, e2e:s20-deployment, e2e:team-project | stable — re-emit |
| `team-hub-email` | testid | Self-hosted hub: email input. | `client/panels/TeamProjects.jsx` · `TeamProjects` | e2e-mp:selfhost-entry, e2e:s20-deployment, e2e:team-project | stable — re-emit |
| `team-hub-password` | testid | Self-hosted hub: password input. | `client/panels/TeamProjects.jsx` · `TeamProjects` | e2e-mp:selfhost-entry, e2e:s20-deployment, e2e:team-project | stable — re-emit |
| `team-hub-open` | testid | Self-hosted hub: Open submit. | `client/panels/TeamProjects.jsx` · `TeamProjects` | e2e-mp:selfhost-entry, e2e:s20-deployment, e2e:team-project | stable — re-emit |
| `team-projects-dialog` | testid | The team projects dialog (opened from the switcher or the Sync panel). | `client/panels/TeamProjects.jsx` · `TeamProjectsDialog` | e2e:cloud-attach, e2e:team-project | stable — re-emit |
| `team-projects-close` | testid | Close button of that dialog. | `client/panels/TeamProjects.jsx` · `TeamProjectsDialog` | e2e:team-project | stable — re-emit |
| `.sp-note / .sp-note-dot` | selector | Sync panel status note and its dot; `.sp-note-dot.is-<phase>` (e.g. `is-refused`) reflects the phase. | `client/panels/SyncPanel.jsx` · `SyncPanel` | e2e-mp:surface, e2e:team-project | stable — re-emit |

### onboarding

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `onboarding-wizard` | testid | The first-run onboarding overlay (`role="dialog"`). | `client/panels/OnboardingWizard.jsx` · `OnboardingWizard` | skill:desktop-e2e, e2e:onboarding | moves — map in Phase 4 |
| `onboarding-watch-intro` | testid | "Watch the intro" button on the welcome step. | `client/panels/OnboardingWizard.jsx` · `Welcome` | — | moves — map in Phase 4 |
| `ob-door-github` | testid | Door: continue with GitHub. | `client/panels/OnboardingWizard.jsx` · `Welcome` | skill:desktop-e2e, e2e:onboarding | moves — map in Phase 4 |
| `ob-door-team` | testid | Door: open a project you were invited to. | `client/panels/OnboardingWizard.jsx` · `Welcome` | e2e-mp:cloud-entry, e2e-mp:selfhost-entry, e2e:s20-deployment, e2e:team-project | moves — map in Phase 4 |
| `ob-door-local` | testid | Door: open a folder on this computer. | `client/panels/OnboardingWizard.jsx` · `Welcome` | skill:desktop-e2e, e2e:onboarding | moves — map in Phase 4 |
| `ob-door-hub` | testid | Door: connect to a team hub (advanced). | `client/panels/OnboardingWizard.jsx` · `Welcome` | skill:desktop-e2e, e2e:onboarding | moves — map in Phase 4 |
| `ob-back` | testid | Back button in a door. | `client/panels/OnboardingWizard.jsx` · `BackBar` | skill:desktop-e2e, e2e:onboarding | moves — map in Phase 4 |
| `ob-github-create` | testid | GitHub door: start a new project. | `client/panels/OnboardingWizard.jsx` · `GitHubDoor` | skill:desktop-e2e, e2e:onboarding | moves — map in Phase 4 |
| `ob-local-setup` | testid | Local door: "Set up Maude here". | `client/panels/OnboardingWizard.jsx` · `LocalDoor` | skill:desktop-e2e, e2e:onboarding | moves — map in Phase 4 |
| `ob-local-choose` | testid | Local door: choose a project folder. | `client/panels/OnboardingWizard.jsx` · `LocalDoor` | skill:desktop-e2e, e2e:onboarding | moves — map in Phase 4 |
| `ob-device-modal` | testid | GitHub device-code modal. | `client/panels/OnboardingWizard.jsx` · `DeviceCodeModal` | skill:desktop-e2e, e2e:onboarding | moves — map in Phase 4 |
| `ob-device-code` | testid | The GitHub device code. | `client/panels/OnboardingWizard.jsx` · `DeviceCodeModal` | skill:desktop-e2e, e2e:onboarding | moves — map in Phase 4 |
| `setup-cl-row-<id>` | testid (pattern) | One setup-checklist row. | `client/panels/SetupChecklist.jsx` · `SetupChecklist` | — | moves — map in Phase 4 |
| `setup-cl-start-tour` | testid | Checklist button that starts the tour. | `client/panels/SetupChecklist.jsx` · `SetupChecklist` | — | moves — map in Phase 4 |
| `onboarding-bring-brand` | testid | Checklist button "Bring my existing brand" (two render forms). | `client/panels/SetupChecklist.jsx` · `SetupChecklist` | whats-new | moves — map in Phase 4 |
| `onboarding-import-figma` | testid | Checklist button "Import from Figma". | `client/panels/SetupChecklist.jsx` · `SetupChecklist` | — | moves — map in Phase 4 |
| `brand-up-pick-file` | testid | Brand upload: pick a file. | `client/panels/BrandUploadPanel.jsx` · `BrandUploadPanel` | — | stable — re-emit |
| `brand-up-error` | testid | Brand upload: error line. | `client/panels/BrandUploadPanel.jsx` · `BrandUploadPanel` | — | stable — re-emit |
| `brand-up-result` | testid | Brand upload: extracted result. | `client/panels/BrandUploadPanel.jsx` · `BrandUploadPanel` | — | stable — re-emit |
| `brand-up-palette` | testid | Brand upload: extracted palette swatches. | `client/panels/BrandUploadPanel.jsx` · `PaletteSwatches` | — | stable — re-emit |
| `brand-up-fonts` | testid | Brand upload: extracted fonts. | `client/panels/BrandUploadPanel.jsx` · `FontList` | — | stable — re-emit |
| `brand-up-copy-command` | testid | Brand upload: copy the follow-up command. | `client/panels/BrandUploadPanel.jsx` · `BrandUploadPanel` | — | stable — re-emit |
| `brand-up-again` | testid | Brand upload: start over. | `client/panels/BrandUploadPanel.jsx` · `BrandUploadPanel` | — | stable — re-emit |
| `figma-import-panel` | testid | Figma import dialog. | `client/panels/FigmaImportPanel.jsx` · `FigmaImportPanel` | — | stable — re-emit |
| `figma-not-connected` | testid | Notice: Figma is not connected. | `client/panels/FigmaImportPanel.jsx` · `FigmaImportPanel` | — | stable — re-emit |
| `figma-import-url` | testid | Figma file URL input. | `client/panels/FigmaImportPanel.jsx` · `FigmaImportPanel` | — | stable — re-emit |
| `figma-import-mode-<id>` | testid (pattern) | Import mode option. | `client/panels/FigmaImportPanel.jsx` · `FigmaImportPanel` | — | stable — re-emit |
| `figma-import-preview` | testid | Preview button. | `client/panels/FigmaImportPanel.jsx` · `FigmaImportPanel` | — | stable — re-emit |
| `figma-import-run` | testid | Import button. | `client/panels/FigmaImportPanel.jsx` · `FigmaImportPanel` | — | stable — re-emit |
| `figma-import-error` | testid | Error line. | `client/panels/FigmaImportPanel.jsx` · `FigmaImportPanel` | — | stable — re-emit |
| `figma-import-summary` | testid | Import summary. | `client/panels/FigmaImportPanel.jsx` · `Summary` | — | stable — re-emit |
| `welcome-artboard-content` | testid | Content of the starter `Welcome` canvas that `scaffoldDesign` writes into a new project (renders inside the canvas iframe). | `scaffold-design.ts` · `STARTER_CANVAS_TSX` | e2e:onboarding | stable — re-emit |

### share

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `share-dialog` | testid | The share-link dialog (`role="dialog"`). | `client/share-dialog.jsx` · `ShareDialog` | e2e:share-link | stable — re-emit |
| `share-<kind>-url` | testid (pattern) | Read-only link input; `<kind>` ∈ web, app, local (only the kinds that have a value render). | `client/share-dialog.jsx` · `ShareDialog` | e2e:share-link | stable — re-emit |
| `share-copy-<kind>` | testid (pattern) | Copy button for that link. | `client/share-dialog.jsx` · `ShareDialog` | e2e:share-link | stable — re-emit |
| `share-open-app` | testid | "Open in app" link (not in the native shell). | `client/share-dialog.jsx` · `ShareDialog` | — | stable — re-emit |
| `[aria-label="Close share dialog"]` | selector | Close button of the share dialog. | `client/share-dialog.jsx` · `ShareDialog` | e2e:share-link | stable — re-emit |

### report-bug

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `report-bug-dialog` | testid | The Report-a-bug dialog (on its scrim). | `client/report-bug.jsx` · `ReportBugDialog` | e2e:report-bug-dialog | stable — re-emit |
| `report-bug-description` | testid | Description textarea (the one mandatory field). | `client/report-bug.jsx` · `ReportBugDialog` | e2e:report-bug-dialog | stable — re-emit |
| `report-bug-preview` | testid | "Review & attach" button that moves to the consent/preview step; disabled while the description is empty. | `client/report-bug.jsx` · `ReportBugDialog` | e2e:report-bug-dialog | stable — re-emit |
| `report-bug-attach` | testid | Attach-screenshot control. | `client/report-bug.jsx` · `ReportBugDialog` | — | stable — re-emit |
| `report-bug-redact` | testid | Redact control for the screenshot. | `client/report-bug.jsx` · `ReportBugDialog` | — | stable — re-emit |
| `report-bug-shell-pending` | testid | Hint while the shell screenshot is still being taken. | `client/report-bug.jsx` · `ReportBugDialog` | — | stable — re-emit |
| `report-bug-consent-logs` | testid | Consent checkbox for including logs. | `client/report-bug.jsx` · `ReportBugDialog` | — | stable — re-emit |
| `report-bug-send` | testid | Send button on the consent step. | `client/report-bug.jsx` · `ReportBugDialog` | e2e:report-bug-dialog | stable — re-emit |
| `report-bug-issue-link` | testid | Link to the created issue. | `client/report-bug.jsx` · `ReportBugDialog` | — | stable — re-emit |
| `report-bug-error` | testid | Error line. | `client/report-bug.jsx` · `ReportBugDialog` | — | stable — re-emit |
| `report-bug-shot` | testid | Attached screenshot tile. | `client/report-bug.jsx` · `ShotTile` | — | stable — re-emit |
| `report-bug-shot-remove` | testid | Remove the attached screenshot. | `client/report-bug.jsx` · `ShotTile` | — | stable — re-emit |

### canvas iframe chrome

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `palette-mode-preview` | testid | Tool palette mode segment: Preview (`aria-pressed`). | `tool-palette.tsx` · `ToolPalette` | test:mode-toggle | moves — map in Phase 4 |
| `palette-mode-edit` | testid | Tool palette mode segment: Edit (`aria-pressed`). | `tool-palette.tsx` · `ToolPalette` | runner:reliable-project-multiplayer/f3/s09-browser.mjs, e2e-mp:cloud-entry, e2e-mp:selfhost-entry, e2e-mp:surface, test:mode-toggle | moves — map in Phase 4 |
| `palette-mode-present` | testid | Tool palette mode segment: Present (posts `present-enter` to the shell). | `tool-palette.tsx` · `ToolPalette` | test:mode-toggle | moves — map in Phase 4 |
| `artboard-rename-<id>` | testid (pattern) | The editable artboard label button (double-click to rename) of artboard `<id>`. | `canvas-lib.tsx` · `DCArtboard` | e2e-mp:surface | stable — re-emit |
| `annot-lock-badge` | testid | Lock badge on a locked annotation selection. | `annotations-layer.tsx` · `LockBadge` | test-e2e:annotations-lock.e2e.mjs | stable — re-emit |
| `annot-ctx-lock` | testid | Annotation context toolbar: Lock (when not all selected are locked). | `annotations-context-toolbar.tsx` · `AnnotationContextToolbar` | test-e2e:annotations-lock.e2e.mjs | stable — re-emit |
| `annot-ctx-unlock` | testid | Annotation context toolbar: Unlock (when all selected are locked). | `annotations-context-toolbar.tsx` · `AnnotationContextToolbar` | test-e2e:annotations-lock.e2e.mjs | stable — re-emit |
| `comment-edit` | testid | Edit textarea inside an in-canvas comment thread. | `comments-overlay.tsx` · `CommentThread` | e2e-mp:surface | stable — re-emit |
| `comment-edit-save` | testid | Save button for that edit. | `comments-overlay.tsx` · `CommentThread` | e2e-mp:surface | stable — re-emit |
| `[data-theme] on DS/artboard wrappers` | selector | Theme attribute on design-system / artboard theme wrappers inside the canvas; `screenshot.sh --theme` forces it on every match. | `canvas-lib.tsx` · `useTheme`<br>`canvas-lib.tsx` · `ThemeToggle` | bin:_screenshot-playwright.mjs, bin:screenshot.sh | stable — re-emit |
| `toolbar-<mode>` | testid (pattern) | The canvas toolbar island for the current mode: `toolbar-edit`, `toolbar-preview`, `toolbar-viewing` (`role="toolbar"`, also `.dc-tool-palette`). Absent in Present and for Can view. `data-morph` is set while ToolbarMorph runs. | `tool-palette.tsx` · `ToolPalette` | test:tool-palette | new |
| `tool-panel-<panel>` | testid (pattern) | A tool panel the SHELL draws for a canvas toolbar slot (V2-4.5c; `tool-panel-open`). `stickers` is the Stickers gallery (S4.3) pinned above/below the toolbar island (`data-placement` = `above` or `below`, absent when it falls back to the centred dialog). Only a focused canvas opens it, once per 500 ms, on the toolbar it reported (EH-P4-2). Assets opens the left panel's Assets tab; `templates` is the Templates panel (S4.4, `client/v2/annotations/templates-panel.jsx`), same placement and gate; the Component picker has no surface yet (S2). | `client/v2/annotations/stickers-gallery.jsx` · `StickersGallery` | test:v2-tool-panels | new |
| `toolbar-slot-<toolId>` | testid (pattern) | One toolbar slot (`aria-pressed` on armed tools; the momentary Frame / Text / Image and the panel-only Stickers have none). `<toolId>`: `move`, `hand`, `frame`, `el-text`, `image` (Edit); `browse`, `sticky`, `comment`, `pen` (Marker), `arrow`, `shape`, `text`, `stickers`, `section` (Preview); `inspect`, `comment` (Viewing). A slot whose tool is not built yet (S2) is not rendered. | `tool-palette.tsx` · `ToolPalette` | test:tool-palette | new |
| `toolbar-popover-<which>` | testid (pattern) | An in-iframe toolbar popover: `shape-kinds` (aria-label "Shape type") or `marker-tips`. | `tool-palette.tsx` · `ToolPalette` | test:tool-palette | new |
| `toolbar-tip-<tool>` | testid (pattern) | A Marker tip in its popover: `pen` (Marker), `highlighter`, `eraser`. | `tool-palette.tsx` · `ToolPalette` | test:tool-palette | new |
| `.dc-tool-palette` | selector | The in-canvas toolbar island (bottom, `role="toolbar"`); one per mode since V2-4.5a, class kept for the chrome selectors. | `tool-palette.tsx` · `ToolPalette` | spec:canvas-format-tsx/canvas-annotations-figjam, spec:canvas-format-tsx/canvas-context-menu, spec:canvas-format-tsx/canvas-input-grammar, runner:reliable-project-multiplayer/f3/s09-browser.mjs, e2e-mp:surface, test:canvas-hide-chrome, test:input-router, whats-new | stable |
| Tool palette buttons | selector | Toolbar buttons by `aria-label` = "&lt;Tool&gt; (&lt;key&gt;)" from `MODE_TOOLS` (CONTRACT §2/§3): Edit — Select (V), Hand (H), Frame (F), Text (T), Image (I); Preview — Hand (H), Sticky (N), Comment (C), Marker (M) (tips Highlighter, Eraser in its popover), Arrow (A), Shape (R), Text (T), Stickers (E), Section (S); "Shape type" popover. Retired with the v1 palette: "Pen (B)", "Highlighter (I)", "Eraser (E)", "Section (⇧S)", "Browse", "Insert element…", "Export (⌘E)". *`aria-label^="Comment"` also matches the Comments panel / timeline comment controls.* | `tool-palette.tsx` · `ToolPalette` | runner:reliable-project-multiplayer/f3/s09-browser.mjs, e2e-mp:surface, test:mode-toggle | moves — map in Phase 4 |
| `[aria-pressed] / [aria-selected] on canvas tools` | selector | Pressed/selected state of palette tools, mode segments and toolbar toggles. *`aria-pressed` is also read with `getAttribute` on `open-changes`, `open-sync` and `palette-mode-*`.* | `tool-palette.tsx` · `ToolPalette` | spec:canvas-format-tsx/canvas-annotations-figjam, spec:canvas-format-tsx/canvas-input-grammar, runner:reliable-project-multiplayer/f3/s11-browser.mjs, runner:reliable-project-multiplayer/f3/s19-browser.mjs, e2e-mp:surface | moves — map in Phase 4 |
| `[data-active-tool]` | selector | Active tool id on the canvas host. | `canvas-shell.tsx` · `CanvasCore`<br>`canvas-comment-mount.tsx` · `CommentHost` | spec:canvas-figjam-feel, spec:canvas-format-tsx/canvas-annotations, spec:canvas-format-tsx/canvas-artboard-drag, spec:video-timeline-badge | moves — map in Phase 4 |
| `.dc-canvas / .dc-world` | selector | Canvas root and the transformed world plane. | `canvas-lib.tsx` · `DesignCanvasInner` | spec:canvas-figjam-feel, spec:canvas-format-tsx/canvas-annotations-figjam, spec:canvas-format-tsx/canvas-annotations, spec:canvas-format-tsx/canvas-artboard-drag, spec:canvas-format-tsx/canvas-input-grammar, spec:canvas-text-editing, spec:canvas-wheel-pan-speed, spec:element-editing-resize-and-position, runner:video-timeline-badge/web-desktop.sh, spec:video-timeline-badge, e2e-mp:surface, e2e:canvas-text-editing, bin:_html-playwright.mjs, bin:_pdf-playwright.mjs, bin:_perf-shared.mjs, bin:_png-playwright.mjs, bin:_pptx-playwright.mjs, bin:_region.mjs, bin:_svg-playwright.mjs, bin:_video-playwright.mjs, test:camera-reveal, test-e2e:harness.mjs, test:input-router, test:specimen-select | stable — re-emit |
| `.dc-artboard / .dc-artboard-body / .dc-artboard-label` | selector | Artboard article, its body, and its label strip. | `canvas-lib.tsx` · `DCArtboard` | spec:artboard-kinds, spec:canvas-figjam-feel, spec:canvas-format-tsx/canvas-artboard-drag, spec:canvas-format-tsx/canvas-context-menu, runner:reliable-project-multiplayer/f3/s09-browser.mjs, spec:video-timeline-badge, spec:web-artboards, e2e-mp:surface, test:camera-reveal, test:canvas-hide-chrome, test:export-capture-hygiene, test:export-e2e-lanes, test:input-router, test:video-comp | stable — re-emit |
| `.dc-artboard-kind-chip / .dc-artboard-video-badge` | selector | Kind chip in the artboard label; video badge (click opens the Timeline). | `canvas-lib.tsx` · `DCArtboard` | spec:artboard-kinds, runner:video-timeline-badge/web-desktop.sh, spec:video-timeline-badge, test:input-router | stable — re-emit |
| `.dc-dragging` | selector | Class on an artboard while it is dragged. | `canvas-lib.tsx` · `DCArtboard` | spec:canvas-format-tsx/canvas-artboard-drag | stable — re-emit |
| `[data-dc-screen]` | selector | Artboard id attribute on the artboard root; the anchor every exporter, screenshot helper and selection resolver uses. | `canvas-lib.tsx` · `DCArtboard` | spec:canvas-figjam-feel, spec:cloud-export-jobs, spec:element-editing-resize-and-position, runner:reliable-project-multiplayer/f3/s09-browser.mjs, runner:reliable-project-multiplayer/f3/s19-browser.mjs, spec:specimen-and-media-editing, spec:structural-and-scope, spec:video-timeline-badge, e2e-mp:surface, bin:_enumerate-artboards-playwright.mjs, bin:_html-playwright.mjs, bin:_pdf-playwright.mjs, bin:_perf-probe-safari.mjs, bin:_perf-probe.mjs, bin:_png-playwright.mjs, bin:_pptx-playwright.mjs, bin:_region.mjs, bin:_svg-playwright.mjs, bin:_video-playwright.mjs, bin:canvas-rects.sh, bin:screenshot.sh, bin:smoke.sh, bin:visual-sanity.sh, test:artboard-selection-attrs, test:comments-overlay, test:dom-selection, test:export-capture-fidelity, test:export-capture-hygiene, test:export-e2e-lanes, test:export-shim-multi-capture, test:exporters/scope, test:input-router, test:pdf-print-boxes, test:specimen-select, test:use-collab, test:video-render-bridge | stable — re-emit |
| `[data-dc-kind]` | selector | Artboard kind attribute (web/print/video…). | `canvas-lib.tsx` · `DCArtboard` | spec:artboard-kinds | stable — re-emit |
| `[data-cd-id]` | selector | Stable element id on authored canvas elements; the selection/edit anchor. *Stamped into the canvas source at build time and read by the selection model (`dom-selection.ts`) and many other modules.* | `canvas-pipeline.ts` · `walkInjectIds` | spec:canvas-figjam-feel, runner:canvas-format-tsx/specimen-render-and-edit/web-desktop.sh, spec:canvas-format-tsx/specimen-render-and-edit, spec:canvas-format-tsx/tsx-canvas-render-and-edit, spec:element-editing-resize-and-position, spec:specimen-and-media-editing, spec:structural-and-scope, spec:whiteboard-ai-loop, e2e-mp:surface, bin:smoke.sh, test:annotate-write, test:artboard-selection-attrs, test:comments-detached, test:comments-overlay, test:dom-selection, test:knob-props-authored, test:marquee-overlay, test:peer-selection-follows-camera, test:presence-render-budget, test:read-annotations, test:selection-hmr-delivery, test:specimen-select, test:use-artboard-drag | stable — re-emit |
| `[data-dc-element]` | selector | Author-given semantic element id in canvas source (also written by the Figma importer and the starter templates); `screenshot.sh --element` targets it and the selection path prefers it. *Read by `dom-selection.ts` (`cssPath`, `domPath`) and the Layers tree (`canvas-shell.tsx` `serializeArtboardTree`).* | `figma/to-artboard.ts` · `emitNode`<br>`scaffold-design.ts` · `HOW_TO_USE_MAUDE_TSX` | bin:screenshot.sh | stable — re-emit |
| `.dc-video-comp / [data-comp-id]` | selector | Video comp root and its comp id. | `video-comp.tsx` · `VideoComp` | bin:_video-playwright.mjs, test:video-comp, test:video-render-bridge | stable — re-emit |
| `[data-photo-bgremove-status]` | selector | Status attribute of the background-removal harness. | `canvas-lib.tsx` · `PhotoBgRemoveHarness` | bin:photo-bg-remove.sh | stable — re-emit |
| `.dc-mm / .dc-zoom-tb` | selector | Minimap and zoom toolbar. | `canvas-lib.tsx` · `DCMiniMap`<br>`canvas-lib.tsx` · `DCZoomToolbar` | spec:canvas-format-tsx/canvas-annotations-figjam, test:canvas-hide-chrome, test:input-router | stable — re-emit |
| `.dc-snap-guide` | selector | Snap guide line during artboard drag. | `canvas-lib.tsx` · `SnapGuideOverlay` | spec:canvas-format-tsx/canvas-artboard-drag, test:canvas-hide-chrome | stable — re-emit |
| `.dc-artboard-guides` | selector | Per-kind artboard guides overlay (print bleed, web breakpoints). | `artboard-guides-overlay.tsx` · `ArtboardGuidesOverlay` | test:canvas-hide-chrome | stable — re-emit |
| `.dc-cv-halo (--hover/--selected) / .dc-cv-group-bbox` | selector | Hover and selection halos, and the group bounding box. | `canvas-shell.tsx` · `SelectionHalos`<br>`canvas-shell.tsx` · `HoverHalo`<br>`canvas-shell.tsx` · `GroupBbox` | spec:canvas-figjam-feel, spec:canvas-format-tsx/canvas-annotations-figjam, spec:canvas-format-tsx/canvas-annotations, spec:canvas-format-tsx/canvas-input-grammar, spec:element-editing-resize-and-position, e2e-mp:surface, test:canvas-hide-chrome | stable — re-emit |
| `.dc-cv-measure-line / .dc-cv-measure-pill` | selector | Alt-measure guides. | `measure-overlay.tsx` · `ensureAxisNodes` | spec:element-editing-resize-and-position | stable — re-emit |
| `.dc-el-resize-handle / .dc-el-resize-readout / [data-corner]` | selector | Element resize handles (`data-corner`) and size readout. | `use-element-resize.tsx` · `ElementResizeOverlay`<br>`use-annotation-resize.tsx` · `AnnotationResizeOverlay` | spec:element-editing-resize-and-position, spec:specimen-and-media-editing, e2e-mp:surface, test-e2e:annotations-parity.e2e.mjs, test-e2e:annotations-ui.e2e.mjs | stable — re-emit |
| `.dc-spacing-handle` | selector | Padding/margin drag handle. | `use-spacing-handles.tsx` · `SpacingHandlesOverlay` | spec:element-editing-resize-and-position | stable — re-emit |
| `.dc-elem-ctx-tb / [data-on]` | selector | Element contextual toolbar ("Tidy up into a grid", …) and its toggled-on state attribute. | `contextual-toolbar.tsx` · `ContextualToolbar` | spec:canvas-figjam-feel, spec:element-editing-resize-and-position | stable — re-emit |
| `.dc-multi-artboard-tb` | selector | Multi-artboard toolbar ("Align top", "Distribute horizontally"). | `canvas-shell.tsx` · `MultiArtboardToolbar` | spec:canvas-figjam-feel, spec:element-editing-resize-and-position | stable — re-emit |
| `.dc-context-menu / [data-action]` | selector | Canvas and annotation context menus; items carry `data-action`. | `context-menu.tsx` · `ContextMenuView`<br>`annotations-layer.tsx` · `AnnotationContextMenu` | spec:artboard-kinds, spec:canvas-format-tsx/canvas-context-menu, spec:canvas-format-tsx/canvas-input-grammar, spec:element-editing-resize-and-position, e2e-mp:surface, test-e2e:annotations-parity.e2e.mjs, test:input-router | stable — re-emit |
| `[role="menu"] / [role="menuitem"] / [role="menuitemradio"]` | selector | Menu semantics of canvas context menus and toolbar dropdowns (the shell dropdowns use the same roles). | `annotations-context-toolbar.tsx` · `IconDropdown`<br>`client/app.jsx` · `DropdownMenu` | e2e-mp:surface | stable — re-emit |
| `[role="radiogroup"]` | selector | Radio groups in the annotation toolbar (colours, strokes). | `annotations-context-toolbar.tsx` · `AnnotationContextToolbar` | test-e2e:annotations-parity.e2e.mjs | stable — re-emit |
| `.dc-text-editing` | selector | Class on the canvas host while inline text editing is active. | `canvas-shell.tsx` · `CanvasRouter` | e2e:canvas-text-editing | stable — re-emit |
| `[data-maude-caret]` | selector | The synthetic text caret element. | `text-caret.ts` · `mountCaret` | spec:canvas-text-editing, e2e:canvas-text-editing, test-e2e:harness.mjs | stable — re-emit |
| `.dc-hmr-holding` | selector | "Holding last good render" toast after a broken hot reload. | `canvas-comment-mount.tsx` · `HmrHoldingToast` | test:canvas-hmr-loaded | stable — re-emit |
| `.dc-annot-svg / .dc-annot-scene / [data-mdcc-annotations]` | selector | Annotation layer SVG, the scene, and the annotations marker attribute (export region filter). | `annotations-layer.tsx` · `AnnotationsSvg`<br>`annotations/ui/scene.tsx` · `AnnotationScene` | spec:canvas-format-tsx/canvas-annotations-figjam, spec:canvas-format-tsx/canvas-annotations, spec:whiteboard-ai-loop, e2e-mp:surface, e2e:canvas-text-editing, bin:_region.mjs, test:canvas-hide-chrome, test-e2e:annotations-ui.e2e.mjs, test-e2e:harness.mjs, test:exporters/region | stable — re-emit |
| `.dc-annot-chrome / .dc-annot-input / .dc-annot-marquee` | selector | Annotation chrome layer, pointer input layer, and marquee. | `annotations-layer.tsx` · `AnnotationsChrome`<br>`annotations-layer.tsx` · `AnnotationsInput` | spec:canvas-format-tsx/canvas-annotations-figjam, runner:reliable-project-multiplayer/f3/s09-browser.mjs, e2e-mp:surface, e2e:canvas-text-editing, test-e2e:annotations-ui.e2e.mjs | stable — re-emit |
| `.dc-annot-el / .dc-annot-text / [data-id] / [data-type] / [data-tool]` | selector | One annotation element node, its text, and its id/type/tool attributes. | `annotations/ui/element-node.tsx` · `Node`<br>`annotations-layer.tsx` · `AnnotationsLayer` | spec:canvas-format-tsx/canvas-annotations-figjam, spec:canvas-format-tsx/canvas-annotations, spec:whiteboard-ai-loop, e2e-mp:surface, e2e:canvas-text-editing, test:comments-annotation-anchor, test:comments-detached, test-e2e:annotations-bench.mjs, test-e2e:annotations-ui.e2e.mjs, test-e2e:harness.mjs | stable — re-emit |
| `.dc-annot-editor / [data-annot-editor]` | selector | Inline annotation text editor. | `annotations/ui/text-editor.tsx` · `TextEditor` | e2e:canvas-text-editing, test-e2e:annotations-ui.e2e.mjs, test-e2e:harness.mjs | stable — re-emit |
| `[data-section-chip] / [data-edit-notice]` | selector | Section label chip ("Rename section") and the "being edited by …" notice on an annotation. | `annotations/ui/element-node.tsx` · `SectionChip`<br>`annotations/ui/element-node.tsx` · `EditNotice` | e2e-mp:surface, e2e:canvas-text-editing, test-e2e:annotations-ui.e2e.mjs | stable — re-emit |
| Annotation node labels | selector | "Edit sticky note text", "Edit text" on annotation nodes. | `annotations/ui/element-node.tsx` · `StickyView`<br>`annotations/ui/element-node.tsx` · `TextView` | e2e-mp:surface | stable — re-emit |
| `.dc-annot-resize-handle / .dc-annot-rotate-zone / .dc-annot-conn-dot` | selector | Annotation resize handles, rotate zone, connector dots. | `use-annotation-resize.tsx` · `AnnotationResizeOverlay`<br>`annotations-layer.tsx` · `ConnectorDots` | e2e-mp:surface, test:annotations-v2-interaction, test-e2e:annotations-lock.e2e.mjs, test-e2e:annotations-parity.e2e.mjs, test-e2e:annotations-ui.e2e.mjs | stable — re-emit |
| `.dc-annot-ctx (+ -sw, -fs-trigger, -fs-item, -fs-px)` | selector | Annotation context toolbar, its swatch, and the font-size dropdown parts. | `annotations-context-toolbar.tsx` · `AnnotationContextToolbar`<br>`annotations-context-toolbar.tsx` · `FontSizeDropdown` | spec:canvas-format-tsx/canvas-annotations-figjam, test-e2e:annotations-lock.e2e.mjs, test-e2e:annotations-parity.e2e.mjs | stable — re-emit |
| Annotation toolbar labels | selector | Annotation toolbar controls by `aria-label`: "Align and distribute", "Annotation properties", "Color", "No fill", "Swatch target", "Dashed line", "Thin stroke", "Thick stroke", "Font size", "Font size: &lt;v&gt;", "Custom font size in pixels", "Group selection", "Ungroup selection", "Delete selected annotations", "Locked selection", "Start arrowhead: &lt;v&gt;", "End arrowhead: &lt;v&gt;", "Line type: &lt;v&gt;", "Text alignment: &lt;v&gt;", "Sticky color &lt;c&gt;". | `annotations-context-toolbar.tsx` · `AnnotationContextToolbar`<br>`annotations-context-toolbar.tsx` · `IconDropdown`<br>`annotations-layer.tsx` · `AnnotationsChrome` | e2e-mp:surface, test-e2e:annotations-lock.e2e.mjs, test-e2e:annotations-parity.e2e.mjs | stable — re-emit |
| `[data-mediaref-player]` | selector | Media-reference player overlays on annotations. | `annotations-layer.tsx` · `MediaRefPlayers` | e2e-mp:surface, test:input-router | stable — re-emit |
| `.cm-layer / .cm-pin / [data-comment-pin]` | selector | In-canvas comments layer and comment pins (`data-comment-pin`, `data-detached`). | `comments-overlay.tsx` · `CommentPin`<br>`comments-overlay.tsx` · `CommentsOverlay` | e2e-mp:surface, test:canvas-hide-chrome, test:comments-detached, test:input-router | stable — re-emit |
| `.cm-composer / .cm-mention-popup` | selector | Comment composer and its @mention popup; body textarea `[aria-label="Comment body"]`. | `comments-overlay.tsx` · `CommentComposer`<br>`comments-overlay.tsx` · `MentionAwareTextarea` | spec:canvas-figjam-feel, runner:reliable-project-multiplayer/f3/s09-browser.mjs, e2e-mp:surface, test:input-router | stable — re-emit |
| `.cm-thread (+ __actions, __reply-actions) / .cm-btn--primary / .cm-btn--danger` | selector | Comment thread popover, its action rows, primary and destructive buttons; "Edit comment", "Reply" by `aria-label`. | `comments-overlay.tsx` · `CommentThread` | runner:reliable-project-multiplayer/f3/s09-browser.mjs, e2e-mp:surface, test:comment-edit, test:input-router | stable — re-emit |
| `.dc-participants / .dc-participant(--agent)` | selector | Participants chrome (avatars; `--agent` = the AI participant). | `participants-chrome.tsx` · `ParticipantsChrome` | e2e-mp:surface, test:canvas-hide-chrome | stable — re-emit |
| `.dc-cursor / .dc-peer-selection / [data-peer-gesture]` | selector | Remote cursors, peer selection outlines, and peer gesture previews. | `cursors-overlay.tsx` · `Cursor`<br>`cursors-overlay.tsx` · `PeerSelection`<br>`cursors-overlay.tsx` · `PeerAnnotationGesture` | e2e-mp:surface, test-e2e:annotations-ui.e2e.mjs, test:peer-selection-follows-camera, test:presence-gesture-preview | stable — re-emit |
| `canvas-menu-item-<id>` | testid (pattern) | One row of the canvas right-click menu; `<id>` is the registry item id (copy-css, copy-id, copy-style, paste-style, convert-to-absolute, theme, fit-one, ...). | `context-menu.tsx` · `MenuItemRow` | — | new |

### home

The Home window page (V2-3.3, `client/home/`). New v2 hooks, not part of the v1 inventory; the V2-3.3 e2e targets them.

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `home-root` | testid | The Home page root (`.maude-v2`, `data-theme` follows the Mac). Rendered instead of the project shell when `/_config.mode === 'home'`. | `client/home/home-app.jsx` · `HomeApp` | — | new in v2 (V2-3.3) |
| `home-search` | testid | Home Search field (`role="combobox"`); ⌘K focuses it. Searches `/_home/search` over every registered project; empty + focused lists Recent searches. | `client/home/home-app.jsx` · `HomeSearch` | — | new in v2 (V2-3.3) |
| `home-search-row-<pid>-<slug>[-<artboard>]` | testid (pattern) | One Search result (`role="option"`); `<slug>` as `canvas-row-<slug>` (from the canvas rel), `-<artboard>` for an artboard hit. ↵ / click → `open_project({pid, target})`. | `client/home/home-app.jsx` · `HomeSearch` | — | new in v2 (V2-3.3) |
| `home-recent-row-<pid>-<slug>` | testid (pattern) | A Recent canvases card (newest `openedAt` first); `<pid>` = `l` + 16 hex, `<slug>` = the canvas rel by the `canvas-row-<slug>` rule. Click → `open_project({pid, target:{canvas}})`. Disabled outside the desktop app. | `client/home/home-app.jsx` · `HomeApp` | — | new in v2 (V2-3.3) |
| `home-recent-filter` | testid | The Recent canvases project filter (`<select>`, "All projects" + each project with recent rows). Shown with two or more such projects. | `client/home/home-app.jsx` · `HomeApp` | — | new in v2 (V2-3.3) |
| `home-pin-<pid>-<slug>` | testid (pattern) | Pin toggle on a Recent canvases card (`aria-pressed` = pinned) → `POST /_home/pins {pid, canvas, pinned}`. | `client/home/home-app.jsx` · `PinButton` | — | new in v2 (V2-3.3) |
| `home-pinned-row-<pid>-<slug>` | testid (pattern) | A Pinned card (most recently pinned first). Click → `open_project({pid, target:{canvas}})`. | `client/home/home-app.jsx` · `HomeApp` | — | new in v2 (V2-3.3) |
| `home-pinned-unpin-<pid>-<slug>` | testid (pattern) | Unpin toggle on a Pinned card (the same pin toggle; a separate id so it never collides with the Recent card of the same canvas). | `client/home/home-app.jsx` · `PinButton` | — | new in v2 (V2-3.3) |
| `home-project-row-<pid>` | testid (pattern) | A local project row in Projects (`data-place` = tab / resting / closed). Click → `open_project({pid})`. A project whose folder moved renders a non-button row with "<name> isn't where it was." and `home-relink-<pid>`. | `client/home/home-app.jsx` · `ProfileGroup` | — | new in v2 (V2-3.3) |
| `home-relink-<pid>` | testid (pattern) | "Find the folder…" on a project that isn't where it was → `relink_project({pid})`. | `client/home/home-app.jsx` · `ProfileGroup` | — | new in v2 (V2-3.3) |
| `home-project-ai-<pid>` | testid (pattern) | AI state on a local project row, from `shell_state` `projects[].ai`: "Needs you" (`data-ai="awaiting"`, wins) or "AI working" with a spark (`data-ai="running"`). Absent when the tab has no AI turn. | `client/home/home-app.jsx` · `RowLive` | test:home-page | new in v2 (V2-3.3) |
| `home-project-resting-<pid>` | testid (pattern) | "Resting" (ring) on a local project row whose tab is resting (`place: 'resting'`: its server is stopped; opening the tab wakes it). | `client/home/home-app.jsx` · `RowLive` | test:home-page | new in v2 (V2-3.3) |
| `home-link-dialog` | testid | The decision for a connect link (`maude://open/<project>?code=…`) Rust routed to Home: "Open <project>?" (its own copy on this Mac). | `client/home/home-app.jsx` · `HomeApp` | test:home-page | new in v2 (V2-3.5) |
| `home-link-open` | testid | "Open <project>" in the link decision → `/_home/cloud/prepare {profile, projectId, code}` → `managed_project_open` → `open_project({root})`. | `client/home/home-app.jsx` · `HomeApp` | test:home-page | new in v2 (V2-3.5) |
| `home-link-dismiss` | testid | Cancel in the link decision (Escape and the scrim answer the same). | `client/home/home-app.jsx` · `HomeApp` | test:home-page | new in v2 (V2-3.5) |
| `home-link-note` | testid | The calm note for a file link to a project this Mac doesn't have: "That link is for a project that isn't on this Mac." (`role="status"`). | `client/home/home-app.jsx` · `HomeApp` | test:home-page | new in v2 (V2-3.5) |
| `home-cloud-row-<projectId>` | testid (pattern) | A cloud project with no copy on this Mac ("not on this Mac yet"). | `client/home/home-app.jsx` · `ProfileGroup` | — | new in v2 (V2-3.3) |
| `home-cloud-open-<projectId>` | testid (pattern) | Open on a cloud row: Can edit / Can comment → `/_home/cloud/prepare` → `managed_project_open` → `open_project({root})`; Can view → `open_cloud_url`. | `client/home/home-app.jsx` · `ProfileGroup` | — | new in v2 (V2-3.3) |
| `home-profile-<id>` | testid (pattern) | One account group in Projects (`<id>` = the shell profile id, e.g. `default`). | `client/home/home-app.jsx` · `ProfileGroup` | — | new in v2 (V2-3.3) |
| `home-open-folder` | testid | "Open project… ⌘O" at the foot of Projects → `open_project_folder`. | `client/home/home-app.jsx` · `HomeApp` | — | new in v2 (V2-3.3) |
| `home-new-project` | testid | "New project… ⇧⌘N" at the foot of Projects: opens the create sheet (the same sheet File ▸ New Project… opens on Home — `menu://action {id:'project.new'}`). | `client/home/home-app.jsx` · `HomeApp` | test:home-page | new in v2 (V2-3.9) |
| `home-create-dialog` | testid | The New project sheet on Home (V2-3.9): a name → `/_home/projects/create-local` → `open_project({root})`. | `client/home/home-app.jsx` · `HomeApp` | test:home-page | new in v2 (V2-3.9) |
| `home-create-name` | testid | The project name in the New project sheet (empty = "Untitled project", C4 naming in create-local). | `client/home/home-app.jsx` · `HomeApp` | test:home-page | new in v2 (V2-3.9) |
| `home-create-submit` | testid | "Create project" in the New project sheet. | `client/home/home-app.jsx` · `HomeApp` | test:home-page | new in v2 (V2-3.9) |
| `home-create-cancel` | testid | Cancel in the New project sheet (Escape and the scrim answer the same). | `client/home/home-app.jsx` · `HomeApp` | test:home-page | new in v2 (V2-3.9) |
| `root-missing-card` | testid | The moved-folder card a project tab shows when its folder is gone (11 · pn-cant-open): the app-local `root-missing.html`, shown once `resolve_dev_server_url` answers `{missing}`. | `../desktop/src/root-missing.html` · (page) | — | new in v2 (S1.19) |
| `root-missing-title` | testid | "<name> isn't where it was." on the card (the registry's name for the tab's own project). | `../desktop/src/root-missing.html` · (page) | — | new in v2 (S1.19) |
| `root-missing-place` | testid | "It was in Desktop › Portfolio 2026. Nothing inside has changed — the folder was moved or renamed." | `../desktop/src/root-missing.html` · (page) | — | new in v2 (S1.19) |
| `root-missing-find` | testid | "Find the folder…" on the card → `relink_project({pid})` for the tab's own pid; on a relink Rust moves the tab to the new folder. | `../desktop/src/root-missing.html` · (page) | — | new in v2 (S1.19) |
| `root-missing-error` | testid | Why the picked folder could not be used (`role="alert"`, hidden when empty). | `../desktop/src/root-missing.html` · (page) | — | new in v2 (S1.19) |

### other

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `panel-tab-<id>` | testid (pattern) | A tab of the left panel's own header strip; `<id>` ∈ tree (reads "Canvases"), layers, assets (and any other panel a person docks on the left, Settings › Layout). Replaces the dock tab strip `dock-tab-<id>` (V2-4.4b). | `client/shell/dock.jsx` · `PanelTabs` | — | stable |
| `panel-head-<side>` | testid (pattern) | The panel's own header row (the tab strip + its Hide icon); `<side>` ∈ left, right. Only a side that hosts Canvases · Layers · Assets and more than one panel has one. | `client/shell/dock.jsx` · `PanelTabs` | — | stable |
| `panel-fold-<side>` | testid (pattern) | The Hide icon in the panel's header: folds the panel to its corner icon. | `client/shell/dock.jsx` · `PanelTabs` | — | stable |
| `panel-grip-<side>` | testid (pattern) | The resize grip on the inner edge of the left / right panel (drag, arrow keys, Home / End, double-click resets). Role separator. | `client/shell/dock.jsx` · `PanelGrip` | — | stable |
| `panel-side-<id>` | testid (pattern) | Settings › General › Layout › Panel positions: the Left / Right radio group of one panel (`<id>` ∈ tree, layers, assets, inspector, comments, changes, assistant). Persisted as prefs `panelSides`. | `client/panels/SettingsPanel.jsx` · `SideToggle` | — | stable |
| `dock-ai-<side>` | testid (pattern) | The AI chat's own island in a dock slot (always mounted; `hidden` while the chat is folded to its corner icon). Floating and showing, it carries `data-occludes` for its side. | `client/shell/dock.jsx` · `DockSlot` | — | stable |
| `ai-chat-header` | testid | The AI chat panel's header row (03 AI Chat): spark · chat title ⌄ · ✦ N running · New chat · Hide. | `client/panels/chat-header.jsx` · `ChatHeader` | — | stable |
| `ai-chat-new` | testid | The AI chat header's New chat icon. | `client/panels/chat-header.jsx` · `ChatHeader` | — | stable |
| `ai-chat-hide` | testid | The AI chat header's Hide icon (replaces the old "Close assistant" button): folds the island to its spark corner icon. | `client/panels/chat-header.jsx` · `ChatHeader` | — | stable |
| `ai-chat-count` | testid | The AI chat header's "✦ N" chip: how many of YOUR AI runs are live (a waiting ask counts; other people's AI never does); absent at zero. Click opens the run list (`ai-runs-list`). | `client/v2/ai/RunList.jsx` · `RunsCount` | — | stable |
| `ai-chat-count` | testid | The AI chat header's "✦ N" chip: how many of YOUR chats are running; absent at zero. Click opens the chat list. | `client/panels/chat-header.jsx` · `ChatHeader` | — | stable |
| `ai-quit-dialog` | testid | S5.14: "Quit while AI is working?" — the shell's quit:// ask shown in the project tab with AI (03 ai-quit). Desktop only. | `client/v2/ai/QuitDialog.jsx` · `QuitDialog` | `apps/desktop/e2e/scenarios/ai-quit.e2e.ts` | stable |
| `ai-quit-confirm` | testid | S5.14: the quit dialog's Quit button — every chat stops, what AI finished is kept as a version, then the app quits. | `client/v2/ai/QuitDialog.jsx` · `QuitDialog` | `apps/desktop/e2e/scenarios/ai-quit.e2e.ts` | stable |
| `ai-quit-cancel` | testid | S5.14: the quit dialog's Cancel — nothing stops, the app stays open. | `client/v2/ai/QuitDialog.jsx` · `QuitDialog` | `apps/desktop/e2e/scenarios/ai-quit.e2e.ts` | stable |
| `ai-stopped-divider` | testid | S5.14: the end-of-chat line "Stopped when the app quit · <time>" (or Stopped / when the tab closed / when Maude quit unexpectedly) for a chat whose last run stopped. `data-run` = the run id. | `client/v2/ai/StoppedDivider.jsx` · `StoppedDivider` | `apps/desktop/e2e/scenarios/ai-quit.e2e.ts` | stable |
| `ai-keep-going` | testid | S5.14: Keep going under the Stopped line — a new ask in the same chat resuming the stopped run (registry action ai.keep-going). | `client/v2/ai/StoppedDivider.jsx` · `StoppedDivider` | `apps/desktop/e2e/scenarios/ai-quit.e2e.ts` | stable |
| `ai-chat-island` | testid | The AI chat panel itself (the `aside` frame, landmark "AI chat panel"). Hidden, never unmounted, while folded. | `client/v2/ai/AiChatIsland.jsx` · `AiChatIsland` | — | stable |
| `ai-runs-list` | testid | The list under "✦ N": "Yours", then "On this canvas" (other people's runs, View only). Esc closes; a row takes you to its artboard. | `client/v2/ai/RunList.jsx` · `RunList` | — | stable |
| `ai-run-<runId>` | testid | One row of the run list. `data-state` = working | waiting | needs, `data-view-only="true"` on another person's run. | `client/v2/ai/RunList.jsx` · `RunList` | — | stable |
| `ai-waiting-stack` | testid | The waiting cards of the open chat (absent when nothing waits). | `client/v2/ai/WaitingCard.jsx` · `WaitingCards` | — | stable |
| `ai-waiting-card` | testid | The card for a second ask on a busy artboard: "Waiting for “<run>” to finish on <artboard>." `data-run` = the waiting run id. | `client/v2/ai/WaitingCard.jsx` · `WaitingCard` | — | stable |
| `ai-waiting-cancel` | testid | The × on the waiting card: cancels the ask (no turn ran). | `client/v2/ai/WaitingCard.jsx` · `WaitingCard` | — | stable |
| `ai-waiting-copy` | testid | The waiting card's "Run on a copy" (POST /_api/ai/runs/:id/copy, S5.11b). | `client/v2/ai/WaitingCard.jsx` · `WaitingCard` | — | stable |
| `ai-waiting-note` | testid | The one line under the waiting card when × or Run on a copy was refused. | `client/v2/ai/WaitingCard.jsx` · `WaitingCard` | — | stable |
| `ai-rings` | testid | Inside the canvas iframe: the layer that holds the AI rings (dgn `ai-runs`). Absent when no AI is on any artboard. | `artboard-activity-overlay.tsx` · `ArtboardRingsLayer` | — | stable |
| `ai-ring-<artboardId>` | testid | Inside the canvas iframe: one artboard's ring + tag. `data-state` = running | needs-you | done, `data-who` = you or the other person. | `artboard-activity-overlay.tsx` · `ArtboardRingsLayer` | — | stable |
| `ai-attach-clip` | testid | The paperclip in the AI prompt row; opens the attach menu. | `client/v2/ai/AttachMenu.jsx` · `AttachMenu` | — | new (S5.10) |
| `ai-attach-menu` | testid | The paperclip's menu (Attach files… · Choose a folder… · From Assets · Paste a screenshot ⌘V · Or drag files here). | `client/v2/ai/AttachMenu.jsx` · `AttachMenu` | — | new (S5.10) |
| `ai-attach-menu-<id>` | testid | One row of the attach menu: `files`, `folder` (desktop app only), `assets`, `screenshot`, `drag` (disabled reminder). | `client/v2/ai/AttachMenu.jsx` · `AttachMenu` | — | new (S5.10) |
| `ai-attach-input` | testid | The hidden file input behind Attach files… (e2e sets files on it). | `client/v2/ai/AttachMenu.jsx` · `AttachMenu` | — | new (S5.10) |
| `ai-attach-chips` | testid | The attachment chips row inside the prompt. | `client/v2/ai/AChip.jsx` · `AttachChips` | — | new (S5.10) |
| `ai-attach-chip-<n>` | testid | One attachment chip, by position. `data-state` = uploading / ready / wait / error; `data-kind` = image / video / audio / file / folder. | `client/v2/ai/AChip.jsx` · `AChip` | — | new (S5.10) |
| `ai-attach-chip-x-<n>` | testid | A chip's × (removes it; a folder chip also detaches the folder from this chat). | `client/v2/ai/AChip.jsx` · `AChip` | — | new (S5.10) |
| `ai-attach-held` | testid | The line under the chips naming a folder that won't be sent (asked, or Not now). | `client/v2/ai/AChip.jsx` · `AttachChips` | — | new (S5.10) |
| `ai-attach-notice` | testid | The status line for a refused attachment (type, size, a folder AI may not read). | `client/v2/ai/AChip.jsx` · `AttachChips` | — | new (S5.10) |
| `ai-attach-drop` | testid | "Drop to attach" — painted over the AI chat panel while files are dragged over it. | `client/v2/ai/DropOverlay.jsx` · `DropOverlay` | — | new (S5.10) |
| `ai-attach-consent` | testid | The folder consent card: Let AI read “<folder>” (N files)? | `client/v2/ai/Consent.jsx` · `Consent` | — | new (S5.10) |
| `ai-attach-consent-path` | testid | The consent card's full path line, shown only for a folder outside the project. | `client/v2/ai/Consent.jsx` · `Consent` | — | new (S5.10) |
| `ai-attach-consent-allow` | testid | Let AI read — the only control that records a folder grant. | `client/v2/ai/Consent.jsx` · `Consent` | — | new (S5.10) |
| `ai-attach-consent-notnow` | testid | Not now — keeps the chip, sends without it. | `client/v2/ai/Consent.jsx` · `Consent` | — | new (S5.10) |
| `ai-scope-chip` | testid | The composer's scope chip (◆ Whole canvas · ◆ <artboard> · ◆ N artboards · No canvas). `data-scope` = whole | artboards | none. Click opens its menu. | `client/v2/ai/ScopeChip.jsx` · `ScopeChip` | — | stable |
| `ai-chat-list` | testid | The chat list (03 ai-chat-list) that the panel title ⌄ opens in place of the thread. | `client/v2/ai/ChatList.jsx` · `ChatList` | — | stable |
| `ai-chat-list-back` | testid | "‹ Chats": back from the chat list to the chat. | `client/v2/ai/ChatList.jsx` · `ChatList` | — | stable |
| `ai-chat-list-search` | testid | The chat list's search field (words inside chats, not just titles). | `client/v2/ai/ChatList.jsx` · `ChatList` | — | stable |
| `ai-chat-row-<id>` | testid | A chat row in the chat list. `<id>` = the chat id. `data-state` = working | needs | idle. | `client/v2/ai/ChatList.jsx` · `ChatList` | — | stable |
| `ai-chat-trash-dialog` | testid | The "Move … to the trash?" dialog; names a queued prompt that will not send. | `client/v2/ai/ChatList.jsx` · `ChatList` | — | stable |
| `ai-chat-trash-confirm` | testid | The dialog's "Move to trash" button (absent while the chat is still working). | `client/v2/ai/ChatList.jsx` · `ChatList` | — | stable |
| `ai-advanced` | testid | The AI chat panel's "› Advanced" fold toggle (remembered per Mac under fold key `ai.chat`). | `client/v2/ai/Advanced.jsx` · `ChatAdvanced` | — | stable |
| `ai-advanced-fold` | testid | The Advanced fold's root element. | `client/v2/ai/Advanced.jsx` · `ChatAdvanced` | — | stable |
| `ai-advanced-root` | testid | Wrapper around one chat's Advanced fold (⌘K rows are found inside it). | `client/v2/ai/Advanced.jsx` · `ChatAdvanced` | — | stable |
| `ai-adv-suggestions` | testid | Advanced › Suggestions On / Off. | `client/v2/ai/Advanced.jsx` · `ChatAdvanced` | — | stable |
| `ai-adv-context-pct` | testid | Advanced › Context used: the percent (used / size). | `client/v2/ai/Advanced.jsx` · `ChatAdvanced` | — | stable |
| `ai-adv-session` | testid | Advanced › Session: the Claude Code session id behind the chat. | `client/v2/ai/Advanced.jsx` · `ChatAdvanced` | — | stable |
| `ai-adv-raw-log` | testid | Advanced › Raw log button (opens the raw tool-log island). | `client/v2/ai/Advanced.jsx` · `ChatAdvanced` | — | stable |
| `ai-adv-copy-transcript` | testid | Advanced › Copy transcript button. | `client/v2/ai/Advanced.jsx` · `ChatAdvanced` | — | stable |
| `ai-adv-open-terminal` | testid | Advanced › Open in terminal button (desktop app only). | `client/v2/ai/Advanced.jsx` · `ChatAdvanced` | — | stable |
| `ai-raw-log` | testid | The raw tool-log island under Advanced: one line per tool call. | `client/v2/ai/RawLog.jsx` · `RawLog` | — | stable |
| `ai-scope-menu` | testid | The scope chip's menu (`role=menu`): Whole canvas · the artboard in view · Choose artboards… · No canvas — just ask. | `client/v2/ai/ScopeChip.jsx` · `ScopeChip` | — | stable |
| `ai-scope-item-<id>` | testid | One row of the scope menu. `<id>` = whole | artboard:<artboardId> | choose | none; while choosing artboards: artboard-<artboardId> and done. | `client/v2/ai/ScopeChip.jsx` · `ScopeChip` | — | stable |
| `ai-suggest` | testid | The suggestion strip above the composer: up to three chips and one why line. `data-context` = comments | clips | shared | last-ask. | `client/v2/ai/Suggest.jsx` · `SuggestStrip` | — | stable |
| `ai-suggest-chip` | testid | One suggestion chip (fills the composer, never sends). The comments chip keeps its v1 id `chat-qa-implement-comments`. | `client/v2/ai/Suggest.jsx` · `SuggestStrip` | — | stable |
| `ai-suggest-why` | testid | The one quiet line that says why the suggestions are there ("Because 3 comments are open on this canvas"). | `client/v2/ai/Suggest.jsx` · `SuggestStrip` | — | stable |
| `ai-hint` | testid | The empty chat's hint line ("Ask for a change, a few variants, or an answer."). | `client/v2/ai/Suggest.jsx` · `ChatEmpty` | — | stable |
| `ai-canvas-unchanged` | testid | The note that ends an answer which touched nothing: "The canvas didn't change." | `client/v2/ai/Feed.jsx` · `AssistantMessage` | — | stable |
| `ai-working` | testid | The working line (03 `ai-working`): one line in the feed — spark, "AI is …", the step under it, Stop. Shown while a run is on a turn; gone when it ends. | `client/v2/ai/Working.jsx` · `WorkingLine` | — | new |
| `ai-working-text` | testid | The words of the working line ("AI is making it greener") — the same words as the artboard tag. | `client/v2/ai/Working.jsx` · `WorkingLine` | — | new |
| `ai-stop` | testid | Stop in the working line: the registry's `POST /_api/ai/runs/:id/stop` for the chat's run (cancels the thread when the server has no run for it). | `client/v2/ai/Working.jsx` · `WorkingLine` | — | new |
| `ai-live` | testid | The panel's one polite live region (`role=status`): each state of a run — working, Needs you, Done, Stopped — is read once. | `client/v2/ai/Working.jsx` · `RunLiveRegion` | — | new |
| `ai-result` | testid | The result card under a finished run (03 `ai-done`). `data-status` = idle | busy | undone | kept. | `client/v2/ai/Result.jsx` · `ResultCard` | — | new |
| `ai-result-undo` | testid | Undo on the result card: takes the run's whole change back (`POST /_api/project/undo` for the run's own action). First verb. | `client/v2/ai/Result.jsx` · `ResultCard` | — | new |
| `ai-result-redo` | testid | Redo on the result card, shown in place of the verbs after Undo. | `client/v2/ai/Result.jsx` · `ResultCard` | — | new |
| `ai-result-keep-going` | testid | Keep going on the result card: carries a cut-short run on (`POST /_api/ai/runs/:id/keep-going`); after a finished run it puts focus in the composer. | `client/v2/ai/Result.jsx` · `ResultCard` | — | new |
| `ai-result-keep-copy` | testid | Keep the copy, on the result of a run made on a copy. | `client/v2/ai/Result.jsx` · `ResultCard` | — | new |
| `ai-result-compare` | testid | Compare, on a result that has a before/after to show. | `client/v2/ai/Result.jsx` · `ResultCard` | — | new |
| `ai-result-state` | testid | The word that replaces the verbs once one is used: "Undone." or "Kept the copy." | `client/v2/ai/Result.jsx` · `ResultCard` | — | new |
| `ai-result-note` | testid | The one line under the result when a verb did not happen (someone changed it since, undo not available, could not reach the project). | `client/v2/ai/Result.jsx` · `ResultCard` | — | new |
| `ai-steps` | testid | The folded "What AI did · N steps · T" under a result; the steps are behind it. | `client/v2/ai/Result.jsx` · `ResultCard` | — | new |
| `ai-followups` | testid | The follow-up chip row under a result ("Same on Story 9:16"). | `client/v2/ai/Result.jsx` · `ResultCard` | — | new |
| `ai-followup-chip` | testid | One follow-up chip: fills the composer with its words, never sends. | `client/v2/ai/Result.jsx` · `ResultCard` | — | new |
| `ai-jump` | testid | The "Jump to latest" pill at the foot of a long chat, shown while you read earlier turns; click scrolls to the newest. | `client/v2/ai/BigChat.jsx` · `JumpPill` | — | new |
| `ai-jump-count` | testid | The "N new" beside Jump to latest: messages that arrived since you left the bottom. | `client/v2/ai/BigChat.jsx` · `JumpPill` | — | new |
| `ai-chat-pin` | testid | The AI chat header's pin: Pin to the side / Unpin (`aria-pressed`). The shell's pin model — View › Advanced › Pin panels to the side. | `client/v2/ai/BigChat.jsx` · `PinButton` | — | new |
| `ai-needs-slot` | testid | The place between the chat feed and the field where the open question, a failure and the kept prompt's line live. | `client/v2/ai/NeedsYouSlot.jsx` · `NeedsYouSlot` | — | new |
| `ai-permission-title` | testid | The permission card's title ("Edit Foo.tsx?"). Its verb is the verb on the allow button. | `client/v2/ai/PermissionCard.jsx` · `PermissionCard` | — | new |
| `ai-permission-detail` | testid | What the agent called the call, under the title (never hidden behind the short title). | `client/v2/ai/PermissionCard.jsx` · `PermissionCard` | — | new |
| `ai-permission-always` | testid | "Always for this canvas" check on the permission card. Absent when the agent offered no `allow_always` option, and for an out-of-project write. | `client/v2/ai/PermissionCard.jsx` · `PermissionCard` | — | new |
| `ai-permission-allow` | testid | The permission card's primary button; its label is the title's verb. Answers with the once-only option, or the standing one when the box is ticked. | `client/v2/ai/PermissionCard.jsx` · `PermissionCard` | — | new |
| `ai-permission-decline` | testid | "Not now" on the permission card (also `.btn--danger`, drawn quiet). | `client/v2/ai/PermissionCard.jsx` · `PermissionCard` | — | new |
| `ai-permission-option` | testid | One button of a multi-way permission set (ExitPlanMode and the like); repeats. | `client/v2/ai/PermissionCard.jsx` · `PermissionCard` | — | new |
| `ai-choice-question` | testid | The choice card's question line. | `client/v2/ai/ChoiceCard.jsx` · `ChoiceCard` | — | new |
| `ai-problem-card` | testid | A refusal the server coded (`read-only`, `not-queued`): what happened and what is safe. `data-code` = the code. | `client/v2/ai/ProblemCard.jsx` · `ProblemCard` | — | new |
| `ai-problem-title` | testid | The problem card's sentence. | `client/v2/ai/ProblemCard.jsx` · `ProblemCard` | — | new |
| `ai-problem-verb` | testid | The problem card's one verb, when it has one. | `client/v2/ai/ProblemCard.jsx` · `ProblemCard` | — | new |
| `ai-not-ready` | testid | The state of a kept prompt. `data-kind` = offline | connect | setting-up | used-up | waiting. | `client/v2/ai/NotReady.jsx` · `QueuedState` | — | new |
| `ai-queued-line` | testid | "Queued — sends when this Mac is online." | `client/v2/ai/NotReady.jsx` · `QueuedState` | — | new |
| `ai-offline-line` | testid | "AI is back when this Mac is online." | `client/v2/ai/NotReady.jsx` · `QueuedState` | — | new |
| `ai-quota-line` | testid | The almost-used-up meter above the field ("90% of this 5-hour allowance used · resets 18:40"). | `client/v2/ai/NotReady.jsx` · `QuotaLine` | — | new |
| `ai-connect-sheet` | testid | The one "Connect your Claude account?" sheet (CONTRACT §7). `data-phase` = idle | installing | waiting. | `client/v2/ai/ConnectSheet.jsx` · `ConnectSheet` | — | new |
| `ai-connect-go` | testid | The sheet's Connect button (installs Claude Code if missing, then opens the browser sign-in). | `client/v2/ai/ConnectSheet.jsx` · `ConnectSheet` | — | new |
| `ai-connect-cancel` | testid | The sheet's Cancel (withdraws a sign-in in flight, else drops the kept prompt). | `client/v2/ai/ConnectSheet.jsx` · `ConnectSheet` | — | new |
| `ai-connect-error` | testid | Why Connect did not finish. | `client/v2/ai/ConnectSheet.jsx` · `ConnectSheet` | — | new |
| `ai-fold-needs` | testid | The azure count on the folded AI spark when chats wait for you (wins over the busy dot). | `client/v2/ai/FoldNeeds.jsx` · `FoldNeeds` | — | new |
| `shell-prompt-input` | testid | Input of the shell's own prompt dialog (`.st-prompt`, replaces `window.prompt`). | `client/app.jsx` · `App` | e2e-mp:surface | stable — re-emit |
| `shell-prompt-ok` | testid | OK button of the shell prompt dialog. | `client/app.jsx` · `App` | e2e-mp:surface | stable — re-emit |
| `embed-view` | testid | Root of the embed shell (`?embed` location). | `client/embed-view.jsx` · `EmbedView` | — | stable — re-emit |
| `embed-canvas-frame` | testid | The canvas iframe in the embed shell. | `client/embed-view.jsx` · `EmbedView` | — | stable — re-emit |
| `follow-view` | testid | Root of the Present follower page (`?present=follow`; `data-audience="1"` in the locked audience window). | `client/v2/present/follow-view.jsx` · `FollowView` | — | stable |
| `follow-canvas-frame` | testid | The read-only canvas iframe the follower page frames (`ro=1&comments=0&follow=1`). | `client/v2/present/follow-view.jsx` · `FollowView` | — | stable |
| `follow-bar` | testid | The follow bar: Live · presenter · "<name> is on 6 of 14 · you're on 5" · Catch up; or Waiting / ended. Absent with `audience=1`. | `client/v2/present/follow-view.jsx` · `FollowBar` | — | stable |
| `follow-live` | testid | The Live mark in the follow bar (`st-follow-live--off` once you looked away). | `client/v2/present/follow-view.jsx` · `FollowBar` | — | stable |
| `follow-catch-up` | testid | Catch up: back to the presenter's artboard, Live again (only while drifted). | `client/v2/present/follow-view.jsx` · `FollowBar` | — | stable |
| `follow-open-canvas` | testid | "Open the canvas" after the presenter ended the presentation. | `client/v2/present/follow-view.jsx` · `FollowBar` | — | stable |
| `follow-watchers` | testid | "N watching" ("99+" above 99), this follower included. | `client/v2/present/follow-view.jsx` · `FollowBar` | — | stable |
| `[data-testid$="-dialog"]` | selector | Any testid ending in `-dialog`, used with `[role="dialog"]` to assert that no dialog is open. Matches today: share-dialog, report-bug-dialog, cloud-deeplink-dialog, cloud-device-dialog, file-deeplink-dialog, team-projects-dialog. *Keep the `-dialog` suffix on new dialog roots.* | `client/share-dialog.jsx` · `ShareDialog`<br>`client/report-bug.jsx` · `ReportBugDialog`<br>`client/panels/CloudBar.jsx` · `CloudBar`<br>`client/panels/file-deep-link-dialog.jsx` · `FileDeepLinkDialog`<br>`client/panels/TeamProjects.jsx` · `TeamProjectsDialog` | e2e:cloud-attach | stable — re-emit |
| `[role="dialog"] / [aria-modal="true"]` | selector | Any open dialog/modal (most shell dialogs and in-canvas popovers carry the role). *`App()` checks `[role="dialog"][aria-modal="true"]` to suppress shortcuts while a modal is open.* | `client/app.jsx` · `App` | runner:reliable-project-multiplayer/f3/s19-browser.mjs, e2e:cloud-attach, app.jsx, test:history-preview-focus | stable — re-emit |
| `[role="status"]` | selector | Live status regions (loading, banners, notes). | `client/app.jsx` · `App` | runner:reliable-project-multiplayer/f3/s19-browser.mjs | stable — re-emit |
| `.st-dialog-hd / .st-iconbtn` | selector | A dialog header and its close (×) icon button; `report-bug-dialog` closes via `[data-testid="report-bug-dialog"] .st-dialog-hd .st-iconbtn`. | `client/report-bug.jsx` · `ReportBugDialog` | e2e:report-bug-dialog | stable — re-emit |
| `.st-scrim` | selector | Modal backdrop shared by shell dialogs. | `client/app.jsx` · `App` | runner:reliable-project-multiplayer/f3/s19-browser.mjs | stable — re-emit |
| `.st-prompt` | selector | The shell prompt dialog (holds `shell-prompt-input` / `shell-prompt-ok`). | `client/app.jsx` · `App` | e2e-mp:surface | stable — re-emit |
| `[aria-label="Close"]` | selector | Generic close button (many dialogs and panels). | `client/app.jsx` · `InspectorPanel` | e2e-mp:surface | stable — re-emit |
| `[aria-label="Choose media"] / .st-ap-cell` | selector | Replace-media asset picker dialog and one asset cell. | `client/app.jsx` · `AssetPicker` | e2e-mp:surface | stable — re-emit |
| `.st-sp-body / .st-sp-cell` | selector | The Stickers gallery body and one sticker cell (S4.3; the V2-4.5c picker's hooks, re-emitted). | `client/v2/annotations/stickers-gallery.jsx` · `StickersGallery` | e2e-mp:surface | stable — re-emit |
| `[aria-label="Stickers"]` | selector | The Stickers gallery dialog (shell, S4.3) and the toolbar Stickers button (iframe) share this label. | `client/v2/annotations/stickers-gallery.jsx` · `StickersGallery`<br>`tool-palette.tsx` · `ToolPalette` | e2e-mp:surface | stable — re-emit |
| `stickers-search` | testid | The Stickers gallery search field ("Search stickers…"). | `client/v2/annotations/stickers-gallery.jsx` · `StickersGallery` | test:stickers-gallery | new |
| `stickers-stamps` | testid | The Stamps row at the top of the Stickers gallery (six vote stamps). | `client/v2/annotations/stickers-gallery.jsx` · `StickersGallery` | test:stickers-gallery | new |
| `stickers-stamp-<id>` | testid (pattern) | One vote stamp in the gallery (`yes`, `no`, `star`, `heart`, `ask`, `plus`); disabled until the canvas can place stamps (S4.13). | `client/v2/annotations/stickers-gallery.jsx` · `StickersGallery` | test:stickers-gallery | new |
| `stickers-recent` | testid | The gallery's Recent section (the last 12 stickers or fewer this person placed); absent until one was placed. | `client/v2/annotations/stickers-gallery.jsx` · `StickersGallery` | test:stickers-gallery | new |
| `stickers-pack-<slug>` | testid (pattern) | One bundled pack's section in the gallery (`figjam-doodle`, `life-style`, `opposing-thoughts`, `project-status`), in browse and in search. | `client/v2/annotations/stickers-gallery.jsx` · `StickersGallery` | test:stickers-gallery | new |
| `stickers-more-<slug>` | testid (pattern) | A pack's "+N" cell: opens the rest of that pack in place. | `client/v2/annotations/stickers-gallery.jsx` · `StickersGallery` | test:stickers-gallery | new |
| `sticker-<pack>-<file>` | testid (pattern) | One sticker cell in the gallery (Recent, a pack, or a search hit). | `client/v2/annotations/stickers-gallery.jsx` · `StickersGallery` | test:stickers-gallery | new |
| `stickers-chips` | testid | The word chips of a gallery search ("All · 6", "done · 4", …). | `client/v2/annotations/stickers-gallery.jsx` · `StickersGallery` | test:stickers-gallery | new |
| `stickers-chip-<word>` | testid (pattern) | One word chip of a gallery search; `aria-pressed` while it narrows the hits. | `client/v2/annotations/stickers-gallery.jsx` · `StickersGallery` | test:stickers-gallery | new |
| `stickers-empty` | testid | The gallery's no-match state: "No stickers match “…”" with English suggestions. | `client/v2/annotations/stickers-gallery.jsx` · `StickersGallery` | test:stickers-gallery | new |
| `stickers-none` | testid | The line under a gallery search naming the packs (and stamps) with no hit. | `client/v2/annotations/stickers-gallery.jsx` · `StickersGallery` | test:stickers-gallery | new |
| `stickers-credits` | testid | The gallery's credits line: "Packs from the Figma Community: …" with each pack's source link. | `client/v2/annotations/stickers-gallery.jsx` · `StickersGallery` | test:stickers-gallery | new |
| `templates-grid` | testid | The Templates panel's tile grid (eight tiles; arrow keys move the highlight). | `client/v2/annotations/templates-panel.jsx` · `TemplatesPanel` | test:templates-panel | new |
| `templates-tile-<id>` | testid (pattern) | One template tile (`kanban`, `retro`, `flow`, `calendar`, `roadmap`, `brainstorm`, `checklist`, `blank`); a click emits the pick and closes the panel. | `client/v2/annotations/templates-panel.jsx` · `TemplatesPanel` | test:templates-panel | new |
| `templates-ask` | testid | The Templates panel's "describe it" form: Enter or the send button fills the AI chat composer (never sends). | `client/v2/annotations/templates-panel.jsx` · `TemplatesPanel` | test:templates-panel | new |
| `templates-ask-input` | testid | The "describe it" text field ("Describe it — AI builds it on the canvas"). | `client/v2/annotations/templates-panel.jsx` · `TemplatesPanel` | test:templates-panel | new |
| `templates-ask-send` | testid | The "describe it" send button; disabled until there are words. | `client/v2/annotations/templates-panel.jsx` · `TemplatesPanel` | test:templates-panel | new |
| `dock-slot-<side>` | testid (pattern) | The MAIN panel island of a dock slot (`.st-dockslot-inner`); `<side>` ∈ left (Canvases · Layers · Assets), right (Inspector / Comments / Changes / Sync — one at a time, no tab strip). The AI chat is its own island, `dock-ai-<side>` (V2-4.4b). Floating, it is the `.island` that carries `data-occludes` (V2-4.1); pinned, `display: contents`. | `client/shell/dock.jsx` · `DockSlot` | — | stable |
| `panel-icon-<which>` | testid (pattern) | The folded corner icon of a panel that is not showing (closed, or hidden by ⌘\); `<which>` ∈ left (Canvases), right (Inspector / Comments), assistant (the AI chat's spark). Click brings the panel up and un-hides. | `client/v2/shell/corner-icons.jsx` · `CornerIcons` | — | stable |
| `project-pill` | testid | The project pill (mark + project name, top-left): the `.island` button that opens the one menu; accessible name "Project menu"; `data-occludes="top"` on its island (V2-4.2). | `client/v2/shell/project-pill.jsx` · `ProjectPill` | — | new in v2 (V2-4.2) |
| `project-menu` | testid | The root `role=menu` of the one menu (CONTRACT §1). | `client/v2/shell/project-pill.jsx` · `Level` | — | new in v2 (V2-4.2) |
| `project-menu-row-<action-id>` | testid (pattern) | One row of the one menu; `<action-id>` is the registry action id (`export.open`, `settings.open`, …). Disabled rows carry `aria-disabled`; `export.open` shows twice with File open (top level and File). | `client/v2/shell/project-pill.jsx` · `Level` | — | new in v2 (V2-4.2) |
| `project-menu-row-sub-<name>` | testid (pattern) | A submenu row; `<name>` ∈ file, edit, view, help, diagnostics, advanced, new-artboard. | `client/v2/shell/project-pill.jsx` · `Level` | — | new in v2 (V2-4.2) |
| `project-menu-sub-<name>` | testid (pattern) | An open submenu's `role=menu`; `<name>` as above. | `client/v2/shell/project-pill.jsx` · `Level` | — | new in v2 (V2-4.2) |
| `project-menu-status-<action-id>` | testid (pattern) | The status word or value on a Diagnostics row of the one menu (`data-tone` ∈ ok, warn, error, neutral): Sync · Server · AI setup carry a word, Address · Process · Project folder a mono value. | `client/v2/shell/project-pill.jsx` · `Level` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diagnostics-sheet` | testid | The Diagnostics sheet (`role=dialog`, `data-view` ∈ logs, server, ai, sync) that Menu › Diagnostics opens. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `DiagnosticsSheet` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diagnostics-close` | testid | The sheet's × (Esc closes it too). | `client/v2/diagnostics/diagnostics-sheet.jsx` · `DiagnosticsSheet` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-tab-<view>` | testid (pattern) | One tab of the sheet; `<view>` ∈ logs, server, ai, sync. Carries that source's status word. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `DiagnosticsSheet` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-logs` | testid | The Logs card: the four sources' ring buffers (sync · server · AI · export). | `client/v2/diagnostics/diagnostics-sheet.jsx` · `LogsView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-logs-filter-<source>` | testid (pattern) | One source filter of the Logs card (`aria-pressed`); `<source>` ∈ all, sync, server, ai, export. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `LogsView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-logs-search` | testid | The Logs card's substring filter. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `LogsView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-logs-refresh` | testid | Re-read `GET /_api/diagnostics`. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `LogsView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-logs-copy-all` | testid | Copy the scrubbed diagnostic report (`GET /_api/diagnostics/report`). | `client/v2/diagnostics/diagnostics-sheet.jsx` · `LogsView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-logs-lines` | testid | The log tail (`ol`; each `li` carries `data-source` and `data-level`). | `client/v2/diagnostics/diagnostics-sheet.jsx` · `LogsView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-logs-empty` | testid | The Logs card with nothing to show (no lines yet / still reading). | `client/v2/diagnostics/diagnostics-sheet.jsx` · `LogsView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-logs-error` | testid | The Logs card when `/_api/diagnostics` could not be read. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `LogsView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-server` | testid | The Server card: mode stamp, live connection, address, version, process, project folder. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `ServerView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-row-<key>` | testid (pattern) | One labelled row of the Server card; `<key>` ∈ mode, live, address, version, process, folder (and `hub` in the Sync tab's hints). | `client/v2/diagnostics/diagnostics-sheet.jsx` · `Row` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-copy-<key>` | testid (pattern) | The Copy button beside a mono row; `<key>` as in `diag-row-<key>`. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `CopyBtn` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-mode-stamp` | testid | Was the menu bar's IDLE · CANVAS · SYSTEM stamp; `data-mode` ∈ idle, canvas, system. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `ServerView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `canvases-active-path` | testid | Canvases panel › Advanced › Open canvas: the open canvas's path (the status bar's "active" slot); `title` = the full path. | `client/v2/left-panel/canvases-advanced.jsx` · `CanvasesAdvanced` | test:v2-callouts | new in v2 (V2-4.8b) |
| `layers-artboard-count` | testid | The Layers panel header's "N artboards" for the open canvas. | `client/inspector/inspector-panel.jsx` · `InspectorPanel` | test:v2-callouts | new in v2 (V2-4.8b) |
| `inspector-selection` | testid | The Inspector header: the selection's selector (the status bar's "selected" chip); `title` = the DOM path. | `client/inspector/inspector-panel.jsx` · `InspectorPanel` | e2e-mp:surface | new in v2 (V2-4.8b) |
| `inspector-selection-text` | testid | The element's own text beside the selector in the Inspector header (first 60 characters). | `client/inspector/inspector-panel.jsx` · `InspectorPanel` | e2e-mp:surface | new in v2 (V2-4.8b) |
| `inspector-frame` | testid | The Inspector's body for a selection: crumbs, name + kind chip, the numbered sections, › Advanced. `data-kind` = the kind id. | `client/v2/inspector/frame.jsx` · `InspectorFrame` | test:v2-inspector-render | new in v2 (S2.2) |
| `inspector-title` | testid | The selection's name (the layer name, else its own text, else its tag; `N objects` for several; the artboard id for an artboard). | `client/v2/inspector/frame.jsx` · `InspectorFrame` | test:v2-inspector-render | new in v2 (S2.2) |
| `inspector-kind` | testid | The kind chip beside the name: an artboard shows its artboard kind (Web page · Fixed size · Print · Video), an object Button · Text · Image · Frame, several objects Mixed. | `client/v2/inspector/frame.jsx` · `InspectorFrame` | test:v2-inspector-render | new in v2 (S2.2) |
| `inspector-crumbs` | testid | The path above the name — artboard › frames › object (the canvas's own crumbs, S2.1; the layer-tree path for an old canvas bundle). Absent for an artboard. | `client/v2/inspector/crumbs.jsx` · `InspectorCrumbs` | test:edit-op-crumbs | new in v2 (S2.2, S2.1) |
| `inspector-crumb-<i>` | testid | One rung of the inspector crumbs, 0 = the artboard. Every rung above the selection is a button that selects that level. | `client/v2/inspector/crumbs.jsx` · `InspectorCrumbs` | test:edit-op-crumbs | new in v2 (S2.1) |
| `inspector-crumbs-esc` | testid | The esc key cap after the crumbs: esc steps out one level (object.step-out). Only for an object selection. | `client/v2/inspector/crumbs.jsx` · `InspectorCrumbs` | test:edit-op-crumbs | new in v2 (S2.1) |
| `edit-parent-outline` | testid | Canvas iframe: the dashed outline on the frame a single selected object sits in (where you are inside). | `editing/selection.tsx` · `EditingSelection` | — | new in v2 (S2.1) |
| `edit-name-tag` | testid | Canvas iframe: the name tag over a single selected object, "Brand systems · 400 × 232" (world px). | `editing/selection.tsx` · `EditingSelection` | — | new in v2 (S2.1) |
| `edit-lock-badge` | testid | Canvas iframe: the lock badge with the name of a locked object the pointer is on ("Logo"). Shared lock — everyone sees it. | `editing/lock-badge.tsx` · `LockBadge` | test:edit-object-client | new in v2 (S2.6) |
| `edit-lock-tip` | testid | Canvas iframe: the line beside the pointer on a locked object, "Logo is locked · ⇧⌘L unlocks". | `editing/lock-badge.tsx` · `LockBadge` | — | new in v2 (S2.6) |
| `edit-nudge-tag` | testid | Canvas iframe: the position tag beside the selection while the arrows nudge ("Y 434" for ↑↓, "X 120" for ←→, world px); fades after a moment. | `editing/nudge.tsx` · `NudgeReadout` | — | new in v2 (S2.6) |
| `edit-nudge-gaps` | testid | Canvas iframe: the ⌥-held distance guides from the selection to the edges of the frame it sits in. | `editing/nudge.tsx` · `NudgeReadout` | — | new in v2 (S2.6) |
| `edit-gap-<side>` | testid (pattern) | Canvas iframe: one distance chip of the ⌥ guides; `<side>` is top, right, bottom or left (world px). | `editing/nudge.tsx` · `NudgeReadout` | — | new in v2 (S2.6) |
| `inspector-uses` | testid | "Uses <design system>": the system the open canvas is built on. | `client/v2/inspector/frame.jsx` · `InspectorFrame` | test:v2-inspector-render | new in v2 (S2.2) |
| `insp-sec-<id>` | testid (pattern) | One numbered section of the frame; `<id>` ∈ position, size, layout, fill, corners, border, effects, type, interaction, export. `data-n` = its number. Drawn only when a slice registered a body for the selected kind. | `client/v2/inspector/frame.jsx` · `Section` | test:v2-inspector-render | new in v2 (S2.2) |
| `insp-add-<id>` | testid (pattern) | The "+" in a section header (Fill, Border, Effects, Interaction, Export), drawn only when the section's body can add. | `client/v2/inspector/frame.jsx` · `Section` | test:v2-inspector-render | new in v2 (S2.2) |
| `insp-row-<name>` | testid (pattern) | One labelled row inside a section body; `<name>` ∈ width, height, clip, xy, rotation, direction, gap, spacing, padding, pad-top/right/bottom/left, align. `data-dim="true"` when the control is inert (an object inside auto layout has no X · Y of its own). | `client/v2/inspector/sections/row.jsx` · `Row` | test:v2-inspector-sections | new in v2 (S2.3) |
| `insp-num-<name>` | testid (pattern) | A number field of a section: Width, Height, X, Y and Rotation wrap the v1 number field (the `input` is inside); a length control's plain number (`gap`, `pad-h`, `pad-v`, `pad-<side>`) is the input itself. Enter or leaving the field writes it. | `client/v2/inspector/sections/size.jsx` · `Axis` | test:v2-inspector-sections | new in v2 (S2.3) |
| `insp-mode-<axis>` | testid (pattern) | Size: the Hug · Fill · Fixed select of `width` or `height`. Hug writes `fit-content`, Fill `flex: 1` / `align-self: stretch` / `100%` by the parent, Fixed a number. | `client/v2/inspector/sections/size.jsx` · `Axis` | test:v2-inspector-sections | new in v2 (S2.3) |
| `insp-ctl-<name>` | testid (pattern) | The control of a row: `clip` (Clip content switch), `direction` (Row · Column · Grid · Free), `spacing` (Packed · Space between), `align` (the 3×3 pad), and each length control (`gap`, `pad-h`, `pad-v`, `pad-<side>`). | `client/v2/inspector/sections/layout.jsx` · `LayoutBody` | test:v2-inspector-sections | new in v2 (S2.3) |
| `insp-chip-<name>` | testid (pattern) | A length's token chip, "Space 24": the name the design system gives the step. Also reads "None", "Auto" (Gap while Spacing is Space between) or CSS the words cannot say. Absent while the length is a plain number. | `client/v2/inspector/token-chip.jsx` · `LengthControl` | test:v2-inspector-sections | new in v2 (S2.3) |
| `insp-bind-<name>` | testid (pattern) | **Bind** beside a plain number ("V 10 · not a token"): takes the nearest stop of the system's space; a tie goes to the smaller. Absent for 0 and when the system declares no space tokens. | `client/v2/inspector/token-chip.jsx` · `LengthControl` | test:v2-inspector-sections | new in v2 (S2.3) |
| `insp-menu-<name>` | testid (pattern) | The token menu of a length control (`role=menu`): the system's stops, then "A number, no token…", then "None" where a value may be absent. | `client/v2/inspector/token-chip.jsx` · `LengthControl` | test:v2-inspector-sections | new in v2 (S2.3) |
| `insp-stop-<name>-<px>` | testid (pattern) | One stop in the token menu, by its size in px (`insp-stop-gap-16`). Picking it writes `var(--space-N)` with the system's own name. | `client/v2/inspector/token-chip.jsx` · `LengthControl` | test:v2-inspector-sections | new in v2 (S2.3) |
| `insp-number-<name>` | testid (pattern) | The token menu's "A number, no token…" row: turns the chip into a number field (a token's own size is kept). | `client/v2/inspector/token-chip.jsx` · `LengthControl` | test:v2-inspector-sections | new in v2 (S2.3) |
| `insp-none-<name>` | testid (pattern) | The token menu's "None" row (Gap): removes the declaration. | `client/v2/inspector/token-chip.jsx` · `LengthControl` | test:v2-inspector-sections | new in v2 (S2.3) |
| `insp-extra-<name>-<id>` | testid (pattern) | A menu row ahead of the stops: the Gap menu's `insp-extra-gap-auto` ("Auto — space between") sets Spacing = Space between, the same property as the Spacing segment (decision Q7). | `client/v2/inspector/token-chip.jsx` · `LengthControl` | test:v2-inspector-sections | new in v2 (S2.3) |
| `insp-sides` | testid | Layout › Padding: opens the four per-side rows (Top · Right · Bottom · Left). `aria-pressed` while open; an uneven box opens it itself and the H / V controls say "Mixed" (`insp-mixed-h`, `insp-mixed-v`). | `client/v2/inspector/sections/layout.jsx` · `LayoutBody` | test:v2-inspector-sections | new in v2 (S2.3) |
| `insp-cons` | testid | Position › Constraints: the picture of the four pinned edges (`insp-cons-p` buttons toggle an edge); beside it the Horizontal / Vertical selects `insp-pin-h` and `insp-pin-v`. Shown for an absolutely placed object; changing a pin needs the object measured (`el.geometry`), else `insp-pin-unmeasured` says so. | `client/v2/inspector/sections/position.jsx` · `Pins` | test:v2-inspector-sections | new in v2 (S2.3) |
| `insp-fill-add` | testid | Fill › the add row the header "+" opens: Colour · Gradient · an Image address. | `client/v2/inspector/sections/fill.jsx` · `FillBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-fill-add-colour` | testid | Fill › add row: a colour fill (the system's first colour). Disabled while the object has one — change it above. | `client/v2/inspector/sections/fill.jsx` · `FillBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-fill-add-gradient` | testid | Fill › add row: a top-to-bottom gradient between the system's first two colours, as a layer over the colour. | `client/v2/inspector/sections/fill.jsx` · `FillBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-fill-add-image` | testid | Fill › add row: the Image address field (a file in the project or an https:// address); Enter adds it as a `cover` layer. | `client/v2/inspector/sections/fill.jsx` · `FillBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-fill-image-error` | testid | Fill › the one-line reason an image address was refused ("Use a file in the project or an https:// address."). Nothing was written. | `client/v2/inspector/sections/fill.jsx` · `FillBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-fill-remove-<n>` | testid (pattern) | Fill › removes layer n (gradient or image, top first); the colour has None in its own menu. | `client/v2/inspector/sections/fill.jsx` · `Layer` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-fill-locked` | testid | Fill › the line shown instead of a write when the object has no id yet. | `client/v2/inspector/sections/fill.jsx` · `FillBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-opacity-<name>` | testid (pattern) | The opacity number beside a colour chip (`fill`): below 100 the colour is written as a `color-mix` of its token. | `client/v2/inspector/sections/color-control.jsx` · `ColorControl` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-color-<name>-<token>` | testid (pattern) | One colour token in a colour menu, by the system's own name without `--` (`insp-color-fill-ink`). Picking it writes `var(--<token>)`. | `client/v2/inspector/sections/color-control.jsx` · `ColorControl` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-colorcss-<name>` | testid (pattern) | The colour menu's "A colour, no token…" row: opens a field for one CSS colour. | `client/v2/inspector/sections/color-control.jsx` · `ColorControl` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-colorin-<name>` | testid (pattern) | The field behind "A colour, no token…": Enter writes the colour if it is one colour (anything else is refused, `aria-invalid`). | `client/v2/inspector/sections/color-control.jsx` · `ColorControl` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-corners-unlink` | testid | Corners › the header toggle: one value for all four corners, or each of ↖ ↗ ↙ ↘. `aria-pressed` while unlinked; corners that already differ open unlinked. | `client/v2/inspector/sections/corners.jsx` · `UnlinkToggle` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-corners` | testid | Corners › the unlinked grid (↖ ↗ / ↙ ↘); each corner is a length control `corner-tl|tr|bl|br`, row `insp-row-corner-<k>`. | `client/v2/inspector/sections/corners.jsx` · `CornersBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-corners-exotic` | testid | Corners › the quiet line for an elliptical radius the corner controls cannot say. | `client/v2/inspector/sections/corners.jsx` · `CornersBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-border-none` | testid | Border › "None": nothing until the header "+" adds one (a Pen path or line says Stroke). | `client/v2/inspector/sections/border.jsx` · `BorderBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-num-border-width` | testid | Border › the width in px (0 removes the border); wraps the number field. | `client/v2/inspector/sections/border.jsx` · `BorderBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-ctl-border-position` | testid | Border › Position: Inside · Centre · Outside. Inside is an inset ring (the object keeps its size); Centre and Outside are an outline. | `client/v2/inspector/sections/border.jsx` · `BorderBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-border-locked` | testid | Border › the line shown instead of a write when the object has no id yet. | `client/v2/inspector/sections/border.jsx` · `BorderBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-ctl-shadow` | testid | Effects › Shadow: Flat, then the design system's own elevation names in the order it declares them (a Select above five steps; "Custom" for a shadow the system does not name). | `client/v2/inspector/sections/effects.jsx` · `EffectsBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-shadow-none` | testid | Effects › the quiet line when the system declares no shadow steps. | `client/v2/inspector/sections/effects.jsx` · `EffectsBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-num-opacity` | testid | Opacity in percent (wraps the number field); written as a 0–1 `opacity`, 100 removes it. Under Effects for one object, under Fill for several. | `client/v2/inspector/sections/opacity-row.jsx` · `OpacityRow` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-mixed-opacity` | testid | Opacity › "Mixed": the selected objects differ; typing a number sets all of them. | `client/v2/inspector/sections/opacity-row.jsx` · `OpacityRow` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-weight` | testid | Type › the weight select (Regular · Medium · Semibold · Bold, "Inherited" removes it, "Mixed" for several that differ). | `client/v2/inspector/sections/type.jsx` · `TypeBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-type-locked` | testid | Type › the line shown instead of a write when the object has no id yet. | `client/v2/inspector/sections/type.jsx` · `TypeBody` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-multi-note` | testid | Several objects › "Changes go to all 3. Text settings show when only text is selected." | `client/v2/inspector/kinds/multi.jsx` · `MultiOpacity` | test:v2-inspector-paint | new in v2 (S2.4) |
| `insp-ctl-click` | testid | Interaction › On click: what the object's `data-cd-link` does, in words ("Open cal.com/studio", "Go to Pricing", "None"). Read-only until the link writer (S3 through S2.1's edit-op) is wired; the select is disabled. | `client/v2/inspector/sections/interaction.jsx` · `InteractionBody` | test:v2-inspector-interaction | new in v2 (S2.5) |
| `insp-ctl-hover` | testid | Interaction › On hover: None, Lift to Resting / Floating / Sheet, Darken, Underline (a closed set; "Custom" for a value outside it). Writes `data-hover` through /_api/edit-attr. | `client/v2/inspector/sections/interaction.jsx` · `InteractionBody` | test:v2-inspector-interaction | new in v2 (S2.5) |
| `insp-click-pending` | testid | Interaction › the quiet line saying the click target cannot be changed from the inspector yet. | `client/v2/inspector/sections/interaction.jsx` · `InteractionBody` | test:v2-inspector-interaction | new in v2 (S2.5) |
| `insp-hover-locked` | testid | Interaction › the line shown instead of a write when the object has no id yet. | `client/v2/inspector/sections/interaction.jsx` · `InteractionBody` | test:v2-inspector-interaction | new in v2 (S2.5) |
| `insp-interaction-note` | testid | Interaction › "Preview plays it; the link shows on the canvas while this is selected — as in 04 Modes." | `client/v2/inspector/sections/interaction.jsx` · `InteractionBody` | test:v2-inspector-interaction | new in v2 (S2.5) |
| `insp-export-presets` | testid | Export › the row holding the default export presets for the selected kind (object PNG 2× + SVG; Fixed size / Web page PNG 1×; Print PDF; Video MP4; several objects: "N files…"). S8 fills the section later. | `client/v2/inspector/sections/export-slot.jsx` · `ExportSlotBody` | test:v2-inspector-interaction | new in v2 (S2.5) |
| `insp-export-preset` | testid | Export › one preset chip (repeats inside insp-export-presets). | `client/v2/inspector/sections/export-slot.jsx` · `ExportSlotBody` | test:v2-inspector-interaction | new in v2 (S2.5) |
| `insp-export-more` | testid | Export › "Export… — every option ⇧⌘E": the pointer at the export sheet. | `client/v2/inspector/sections/export-slot.jsx` · `ExportSlotBody` | test:v2-inspector-interaction | new in v2 (S2.5) |
| `inspector-element-id` | testid | › Advanced › Element id: the id field. Enter or leaving it renames the id (and every reference to it); esc puts the old one back; a computed id shows as the placeholder. | `client/v2/inspector/advanced.jsx` · `ElementId` | test:v2-inspector-render | new in v2 (S2.2) |
| `inspector-id-error` | testid | The one-line reason an id was not changed (invalid, taken, locked, held by AI). `role=alert`. | `client/v2/inspector/advanced.jsx` · `ElementId` | test:v2-inspector-render | new in v2 (S2.2) |
| `inspector-copy-id` | testid | › Advanced › Copy id: the element id on the clipboard. | `client/v2/inspector/advanced.jsx` · `CopyButton` | test:v2-inspector-render | new in v2 (S2.2) |
| `inspector-copy-css` | testid | › Advanced › Copy CSS: the element's declarations (authored, then custom properties) on the clipboard. | `client/v2/inspector/advanced.jsx` · `CopyButton` | test:v2-inspector-render | new in v2 (S2.2) |
| `inspector-tokens-used` | testid | › Advanced › Tokens it uses: one `li` per design-system token the element's CSS refers to; `title` = the variable. | `client/v2/inspector/advanced.jsx` · `TokensUsed` | test:v2-inspector-render | new in v2 (S2.2) |
| `inspector-facts` | testid | › Advanced: where it is, how big, its tag and class, the resolved fill / text / radius — what the Inspect tab showed. | `client/v2/inspector/advanced.jsx` · `InspectFacts` | test:v2-inspector-render | new in v2 (S2.2) |
| `diag-live` | testid | Was the status bar's live / reconnecting dot: Connected or Reconnecting…. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `ServerView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-repo-changed` | testid | "Repo state changed — reload?" (the git lifecycle notice) in the Server card. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `ServerView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-repo-reload` | testid | Reload the page from the repo-changed notice. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `ServerView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-repo-dismiss` | testid | Dismiss the repo-changed notice. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `ServerView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-ai` | testid | The AI setup card: the readiness list whole (`rdy-row-<id>` rows, the claude binary path, Re-check). | `client/v2/diagnostics/diagnostics-sheet.jsx` · `AiView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-ai-recheck` | testid | Check AI setup again (re-probes `/_api/preflight`). | `client/v2/diagnostics/diagnostics-sheet.jsx` · `AiView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-ai-when` | testid | "Checking…" / "Checked just now" beside the AI setup word. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `AiView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-sync` | testid | The Sync tab for a linked project: Get latest, today's Sync panel (`sync-panel`) whole, and the hints. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `SyncView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-sync-solo` | testid | The Sync tab for an unlinked project ("nothing to sync"). | `client/v2/diagnostics/diagnostics-sheet.jsx` · `SyncView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-get-latest-row` | testid | The row offering Get latest while the team has new versions. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `SyncView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-get-latest` | testid | Get latest (the Version history panel's pull, reached from Sync details). | `client/v2/diagnostics/diagnostics-sheet.jsx` · `SyncView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-get-latest-note` | testid | The sentence after Get latest ran. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `SyncView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-sync-hints` | testid | The "Hub, commands" fold: hub host, `maude design status`, `/design:rollback`. | `client/v2/diagnostics/diagnostics-sheet.jsx` · `SyncView` | test:v2-diagnostics-render | new in v2 (V2-4.7b) |
| `diag-sync-hints-toggle` | testid | The "Hub, commands" fold's disclosure button (`aria-expanded`; remembered as fold `diagnostics`). | `client/v2/diagnostics/diagnostics-sheet.jsx` · `SyncView` | test:v2-diagnostics-render | new in v2 (V2-4.10) |
| `share-cluster` | testid | The Share cluster (top-right `.island`): faces, status word, comments, Exports, Hide panels, Share. Carries `data-occludes="top"` (none when docked at the head of the pinned right column). | `client/v2/shell/share-cluster.jsx` · `ShareCluster` | — | new in v2 (V2-4.3a) |
| `share-cluster-faces` | testid | The faces list inside the Share cluster (you, Claude while it edits, other people). | `client/v2/shell/share-cluster.jsx` · `Faces` | — | new in v2 (V2-4.3a) |
| `share-cluster-status` | testid | The status word (CONTRACT §6): `data-status` ∈ saved, syncing, offline, local, not-saved, or `access` (Can view / Can comment) for a person without edit rights. | `client/v2/shell/share-cluster.jsx` · `ShareCluster` | — | new in v2 (V2-4.3a) |
| `share-cluster-<action>` | testid (pattern) | The one action beside a failed status; `<action>` ∈ retry, show-in-finder. Retry runs the Sync panel's Resync. | `client/v2/shell/share-cluster.jsx` · `ShareCluster` | — | new in v2 (V2-4.3a) |
| `share-cluster-detail` | testid | The full-disk sentence under the cluster (C37), shown only while Not saved carries one. | `client/v2/shell/share-cluster.jsx` · `ShareCluster` | — | new in v2 (V2-4.3a) |
| `share-cluster-comments` | testid | The comments button in the Share cluster; runs `view.comments`. `aria-pressed` while the Comments panel shows. | `client/v2/shell/share-cluster.jsx` · `ShareCluster` | — | new in v2 (V2-4.3a) |
| `share-cluster-comments-count` | testid | The open-comments count badge on the comments button; absent at zero. | `client/v2/shell/share-cluster.jsx` · `ShareCluster` | — | new in v2 (V2-4.3a) |
| `share-cluster-exports` | testid | The Exports icon (C9): present once any export exists; a progress ring while one runs (`data-busy`). Runs `view.exports`. | `client/v2/shell/share-cluster.jsx` · `ShareCluster` | — | new in v2 (V2-4.3a) |
| `share-cluster-panels` | testid | Hide panels / Show panels (`view.panels`, ⌘\); the label flips and there is no `aria-pressed` (V2-4.gate). | `client/v2/shell/share-cluster.jsx` · `ShareCluster` | — | new in v2 (V2-4.3a) |
| `share-cluster-share` | testid | Share (primary, editors): runs `share.open`; `aria-disabled` with no canvas open. | `client/v2/shell/share-cluster.jsx` · `ShareCluster` | — | new in v2 (V2-4.3a) |
| `share-cluster-ask` | testid | Ask to edit (primary, people without edit rights) — in place of Share. | `client/v2/shell/share-cluster.jsx` · `ShareCluster` | — | new in v2 (V2-4.3a) |
| `share-cluster-account` | testid | The account chip, first in the Share cluster (desktop, signed in, two or more accounts on this Mac): which account this project tab is bound to (`data-account` = the profile id). Opens `account-card`. S1.22a (canvas 11 pn-accounts). | `client/v2/shell/account-card.jsx` · `AccountChip` | — | new in v2 (S1.22a) |
| `account-card` | testid | The account card under the chip (`role=dialog`): this account, the other accounts on this Mac, Sign in as another account…, Sign out of …, the footnote. | `client/v2/shell/account-card.jsx` · `AccountChip` | — | new in v2 (S1.22a) |
| `account-card-current` | testid | The card's first row: the face, `<label> · <email>` and `<project> uses this account`. | `client/v2/shell/account-card.jsx` · `AccountChip` | — | new in v2 (S1.22a) |
| `account-card-other-<id>` | testid (pattern) | One other account on this Mac with its projects ("Also on this Mac"); `<id>` = the profile id. Present only when the shell supplies the account list. | `client/v2/shell/account-card.jsx` · `AccountChip` | — | new in v2 (S1.22a) |
| `account-card-switch` | testid | Sign in as another account… — runs the shell's own `account.switch` handler. | `client/v2/shell/account-card.jsx` · `AccountChip` | — | new in v2 (S1.22a) |
| `account-card-signout` | testid | Sign out of <email>… with the line naming every project on it; pressing it only asks (`account-card-confirm`). | `client/v2/shell/account-card.jsx` · `AccountChip` | — | new in v2 (S1.22a) |
| `account-card-confirm` | testid | The inline confirm (`role=alertdialog`): `Sign out of <email>?` · Cancel · Sign out. | `client/v2/shell/account-card.jsx` · `AccountChip` | — | new in v2 (S1.22a) |
| `account-card-signout-confirm` | testid | The confirm's primary button: calls the existing `POST /_api/cloud/signout` (clears this profile's credential; projects on it are signed out). | `client/v2/shell/account-card.jsx` · `AccountChip` | — | new in v2 (S1.22a) |
| `account-card-signout-cancel` | testid | The confirm's Cancel: signs nothing out. | `client/v2/shell/account-card.jsx` · `AccountChip` | — | new in v2 (S1.22a) |
| `account-card-foot` | testid | "Kept on this Mac — <project> opens as <account> next time." | `client/v2/shell/account-card.jsx` · `AccountChip` | — | new in v2 (S1.22a) |
| `mode-present-from-selection` | testid | Present ⌄ › Present (⌥⌘↵): Present · Artboards from the selected artboard (else the one in view, else the start). Reads Present from “<label>” when the artboard's label is known. | `client/v2/shell/mode-switch.jsx` · `ModeSwitch` | test:mode-toggle | new in v2 (S3.1) |
| `mode-present-from-start` | testid | Present ⌄ › Present from the start (⇧⌥⌘↵): Present · Artboards from the first artboard in canvas order. | `client/v2/shell/mode-switch.jsx` · `ModeSwitch` | test:mode-toggle | new in v2 (S3.1) |
| `mode-present-order-notes` | testid | Present ⌄ › Order and notes… (editors only, under a rule): runs `present.order-notes`, the sheet for the Present order, skips and speaker notes. | `client/v2/shell/mode-switch.jsx` · `ModeSwitch` | test:mode-toggle | new in v2 (S3.5) |
| `present-controls` | testid | Present · Artboards controls (shell DOM, over the canvas): ‹ · 3 / 14 · › · label · slots · esc to leave. `data-shown` is false while faded; `data-motion=reduced` under Reduce motion. | `client/v2/present/present-controls.jsx` · `PresentControls` | test:present-controls | new in v2 (S3.2b) |
| `present-zone` | testid | The transparent strip under the controls where a mouse move is heard (the canvas iframe's moves never reach the shell). A click on it steps to the next artboard. | `client/v2/present/present-controls.jsx` · `PresentControls` | test:present-controls | new in v2 (S3.2b) |
| `present-prev` | testid | ‹ Previous artboard (disabled on the first). Posts `present-step {to:'prev'}` through the mode lane. | `client/v2/present/present-controls.jsx` · `PresentControls` | test:present-controls | new in v2 (S3.2b) |
| `present-next` | testid | › Next artboard (disabled on the last). Posts `present-step {to:'next'}` through the mode lane. | `client/v2/present/present-controls.jsx` · `PresentControls` | test:present-controls | new in v2 (S3.2b) |
| `present-counter` | testid | "3 / 14" — the place in the run (`present-position`); skipped artboards are not counted. | `client/v2/present/present-controls.jsx` · `PresentControls` | test:present-controls | new in v2 (S3.2b) |
| `present-label` | testid | The presented artboard's name, from the canvas index; absent when it has none. | `client/v2/present/present-controls.jsx` · `PresentControls` | test:present-controls | new in v2 (S3.2b) |
| `present-slot-transport` | testid | Slot for S3.3's media transport (pause · time · sound); absent while empty. | `client/v2/present/present-controls.jsx` · `PresentControls` | — | new in v2 (S3.2b) |
| `present-slot-presenter` | testid | Slot for the Presenter view button (desktop, another display); absent while empty. | `client/v2/present/present-controls.jsx` · `PresentControls` | test/presenter-view.test.tsx | new in v2 (S3.2b) |
| `presenter-view` | testid | Presenter view on the Mac while Present · Artboards runs with it on: now, next, notes, the clock and the order map. Hidden with one display. | `client/v2/present/presenter-view.jsx` · `PresenterView` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-end` | testid | Presenter view › End (esc): leaves Present and closes the audience window. | `client/v2/present/presenter-view.jsx` · `PresenterView` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-audience` | testid | Presenter view's top bar: "Audience on <display>", or why the audience screen would not open. | `client/v2/present/presenter-view.jsx` · `PresenterView` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-audience-retry` | testid | Presenter view › Try again, shown when the audience screen would not open. | `client/v2/present/presenter-view.jsx` · `PresenterView` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-elapsed` | testid | Presenter view clock: time since Present started. | `client/v2/present/presenter-view.jsx` · `PresenterView` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-wall` | testid | Presenter view clock: the wall time. | `client/v2/present/presenter-view.jsx` · `PresenterView` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-now` | testid | Presenter view › the Now box (the presented artboard). | `client/v2/present/presenter-view.jsx` · `PresenterView` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-now-label` | testid | Presenter view › "Now · 3 of 14 · <artboard>". | `client/v2/present/presenter-view.jsx` · `PresenterView` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-next-box` | testid | Presenter view › the Next box (the artboard after this one in the run). | `client/v2/present/presenter-view.jsx` · `PresenterView` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-next-label` | testid | Presenter view › "Next · <artboard>" (or "Next · the end"). | `client/v2/present/presenter-view.jsx` · `PresenterView` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-prev` | testid | Presenter view › Previous artboard. | `client/v2/present/presenter-view.jsx` · `PresenterView` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-next` | testid | Presenter view › Next artboard. | `client/v2/present/presenter-view.jsx` · `PresenterView` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-notes` | testid | Presenter view › the presented artboard's speaker notes, one paragraph per line. | `client/v2/present/presenter-view.jsx` · `PresenterView` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-order-map` | testid | Presenter view › the run drawn as the canvas layout; one cell per artboard. | `client/v2/present/order-map.jsx` · `OrderMap` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-order-count` | testid | Presenter view › "Order · 15 artboards · 1 skipped". | `client/v2/present/presenter-view.jsx` · `PresenterView` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-cell-<id>` | testid (pattern) | One artboard in the order map, where it sits on the canvas; `<id>` is the artboard id. `data-n` is its run number, `aria-current` marks the one on screen, `data-skip` a skipped one (dimmed, eye-off, not clickable). A click jumps both screens. | `client/v2/present/order-map.jsx` · `OrderMap` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `presenter-skipped-mark` | testid | The eye-off mark on a skipped artboard in the order map. | `client/v2/present/order-map.jsx` · `OrderMap` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `present-presenter-view` | testid | Present controls › Presenter view (laptop glyph); `aria-pressed` while on. Only with another display. | `client/v2/present/presenter-button.jsx` · `PresenterViewButton` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `mode-present-presenter-view` | testid | Present ⌄ › Presenter view on another display (a check while on, the display's name). Only in the desktop app with another display. | `client/v2/shell/mode-switch.jsx` · `ModeSwitch` | test/presenter-view.test.tsx | new in v2 (S3.6b) |
| `present-leave` | testid | "esc to leave" — leaves Present for where it was entered from. | `client/v2/present/present-controls.jsx` · `PresentControls` | test:present-controls | new in v2 (S3.2b) |
| `present-pill` | testid | Present the canvas: "Presenting the canvas · 21% · esc to leave". Replaces the v1 exit button and keeps its `.st-present-exit` class and `aria-label="Exit presentation mode"`. | `client/v2/present/canvas-pill.jsx` · `CanvasPill` | test:present-controls | new in v2 (S3.2b) |
| `present-pointer` | testid | The presenter's Pointer layer in the canvas document (L): a fixed, click-through overlay holding the dot and its trail. | `present/pointer-dot.tsx` · `createPointerDot` | test:pointer-dot | new in v2 (S3.2b) |
| `present-pointer-dot` | testid | The Pointer: a ringed dot in the presenter's presence colour (`data-hidden` while the mouse is out of the window). | `present/pointer-dot.tsx` · `createPointerDot` | test:pointer-dot | new in v2 (S3.2b) |
| `present-pointer-trail` | testid | The Pointer's short trail (empty under Reduce motion). | `present/pointer-dot.tsx` · `createPointerDot` | test:pointer-dot | new in v2 (S3.2b) |
| `present-peer-pointers` | testid | Layer holding other people's Pointers, drawn from awareness `pointer`. | `present/pointer-dot.tsx` · `PointerPeers` | — | new in v2 (S3.2b) |
| `present-peer-pointer` | testid | One peer's Pointer dot. | `present/pointer-dot.tsx` · `PointerPeers` | — | new in v2 (S3.2b) |
| `.maude[data-theme]` | selector | The shell root `div.maude` and its `data-theme="light\|dark"` (mirrored on `<html data-theme>`). The token blocks in `styles/1-tokens-maude.css` are scoped to `.maude[data-theme=…]`. *`team-project` reads `<html data-theme>`; `shell-text-contrast` reads the CSS token blocks.* | `client/app.jsx` · `App` | runner:reliable-project-multiplayer/f3/s19-browser.mjs, e2e:team-project, test:shell-text-contrast | stable — re-emit |

### empty states

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `empty-<copy-id>` | testid (pattern) | The root of an empty state read from the copy table; `<copy-id>` is the copy id (`es-panels-canvas.comments-none`), also on `data-copy`. Carries the situation, the next step, chips and at most one action. | `client/v2/empty/empty.jsx` · `Empty` | test:v2-empty-kit | new |
| `empty-spot-<name>` | testid (pattern) | A spot (`canvas`, `ai`, `none`, `comment`, `image`, `done`, `offline`, `trash`); decorative, `aria-hidden`. | `client/v2/empty/spot.jsx` · `Spot` | test:v2-empty-kit | new |
| `empty-ask` | testid | The "Ask AI" button of an empty state (azure, spark glyph); a real button, takes the keys label (`⌘/`). | `client/v2/empty/ask-button.jsx` · `AskButton` | test:v2-empty-kit | new |
| `empty-confetti` | testid | The sticky-confetti tile behind Comments "All done." — the one celebration; decorative. | `client/v2/empty/confetti.jsx` · `Confetti` | test:v2-empty-kit | new |
| `arriving-row` | testid | One canvas or folder still coming down to this Mac: always named, dimmed and quietly pulsing. | `client/v2/empty/skeleton.jsx` · `ArrivingRow` | test:v2-empty-kit | new |
| `skeleton-artboard` | testid | An artboard whose content has not arrived: its label and its exact rectangle, page-shaped placeholder. | `client/v2/empty/skeleton.jsx` · `SkeletonArtboard` | test:v2-empty-kit | new |

## What's New spotlights

Every `tour[].target` in `apps/studio/whats-new.json`. The tour overlay (`client/tour/overlay.jsx`) resolves a target with `document.querySelector` on the shell document and shows the step centred, without a spotlight, when nothing matches, so a broken target fails silently. No test checks these targets today. "Needs state" means the element exists only in some shell state; the setup directives (`canvas`, `inspector`, `tab`, `requireSelection`) are noted where the step has them.

| # | Entry (version) | Target | Resolves today | v2 |
| --- | --- | --- | --- | --- |
| 1 | `share-link-deeplink` step 0 (1.3.0) | `[data-testid="share-btn"]` | live — menubar; `canvas: true` opens a canvas first | moves — map in Phase 4 |
| 2 | `sync-panel-per-file` step 0 (0.59.0) | `[data-testid="open-sync"]` | historical — the chip is gone (V2-4.8b); the Sync panel opens from Menu › Diagnostics › Sync | historical |
| 3 | `report-a-bug-from-the-app` step 0 (0.52.0) | `[data-tour="help"]` | live | moves — map in Phase 4 |
| 4 | `acp-ask-user-question` step 0 (0.45.2) | `[data-testid="chat-elicit-prompt"]` | needs state — only while Claude is asking a question; no setup directive, so the step usually shows centred | stable — re-emit |
| 5 | `acp-live-capabilities` step 0 (0.45.2) | `[data-testid="chat-mode-picker"]` | needs state — only with the Assistant panel open and connected (native app); no setup directive | stable — re-emit |
| 6 | `bring-your-brand` step 0 (0.44.0) | `[data-testid="onboarding-bring-brand"]` | needs state — only while the setup checklist dialog is open; no setup directive | moves — map in Phase 4 |
| 7 | `inspector-designer-mode` step 0 (0.44.0) | `[data-tour="cp-mode"]` | needs state — setup opens the Inspector on the CSS tab and waits for a selection | moves — map in Phase 4 |
| 8 | `watch-the-intro` step 0 (0.44.0) | `[data-tour="help"]` | live | moves — map in Phase 4 |
| 9 | `ai-media-generation` step 0 (0.44.0) | `[data-tour="menubar-file"]` | dangling — no element carries `data-tour="menubar-file"`; the File menu is `data-testid="menu-file"` | historical spotlight |
| 10 | `photo-editor` step 0 (0.43.0) | `[data-tour="inspector-tabs"]` | needs state — only if the Inspector is already open (the step has no `inspector: true`) | moves — map in Phase 4 |
| 11 | `background-export-notification-center` step 0 (0.42.0) | `[data-tour="exports"]` | live — menubar Exports badge | moves — map in Phase 4 |
| 12 | `in-canvas-token-editor` step 0 (0.30.0) | `[data-tour='inspector-tabs']` | needs state — setup opens the Inspector on the CSS tab | moves — map in Phase 4 |
| 13 | `in-canvas-token-editor` step 1 (0.30.0) | `[data-tour='css-panel']` | needs state — setup + selection | moves — map in Phase 4 |
| 14 | `in-canvas-token-editor` step 2 (0.30.0) | `.st-cp-row` | needs state — setup + selection | moves — map in Phase 4 |
| 15 | `in-canvas-token-editor` step 3 (0.30.0) | `.st-cp-tokbtn` | needs state — setup + selection | moves — map in Phase 4 |
| 16 | `in-canvas-token-editor` step 4 (0.30.0) | `.st-cp-sechd-row` | needs state — setup + selection | moves — map in Phase 4 |
| 17 | `in-canvas-direct-edit` step 0 (0.30.0) | `[data-tour='inspector-tabs']` | needs state — setup opens the Inspector on the Layers tab + selection | moves — map in Phase 4 |
| 18 | `in-canvas-direct-edit` step 1 (0.30.0) | `.st-layer-eye` | needs state — setup + selection | moves — map in Phase 4 |
| 19 | `canvas-annotations-figjam-v3` step 0 (0.30.0) | `.dc-tool-palette` | unreachable — the palette lives inside the canvas iframe; the tour overlay queries the shell `document`, so this never resolves | historical spotlight |
| 20 | `studio-full-functionality` step 0 (0.29.0) | `[data-tour='status']` | live — the menubar right cluster | moves — map in Phase 4 |
| 21 | `studio-full-functionality` step 1 (0.29.0) | `[data-tour='inspector']` | needs state — setup opens the Inspector | moves — map in Phase 4 |
| 22 | `studio-maude-ds-redesign` step 0 (0.29.0) | `[data-tour='brand']` | live | moves — map in Phase 4 |
| 23 | `studio-maude-ds-redesign` step 1 (0.29.0) | `[data-tour='menus']` | live | moves — map in Phase 4 |
| 24 | `annotation-tooling-polish` step 0 (0.29.0) | `[data-tour='viewport']` | live — `canvas: true` | moves — map in Phase 4 |
| 25 | `in-app-whats-new-tour` step 0 (0.29.0) | `[data-tour='whatsnew']` | live | moves — map in Phase 4 |
| 26 | `in-app-whats-new-tour` step 1 (0.29.0) | `[data-tour='help']` | live | moves — map in Phase 4 |

Totals: 26 targets — 10 live, 14 need a shell state, 1 dangling, 1 unreachable.

## Tours

The built-in tours in `client/tour/*.js` spotlight these anchors (all resolve today; a missing one degrades to a centred card).

| Tour | Steps (in order) |
| --- | --- |
| `usage-tour.js` | `[data-tour="sidebar"]`, `[data-tour="viewport"]`, `[data-tour="menus"]`, `[data-tour="inspector"]` (`inspector: true`), `[data-tour="whatsnew"]`, `[data-tour="help"]` |
| `collab-tour.js` | centred intro, `[data-tour="save-local"]`, `[data-tour="publish"]`, `[data-tour="pull"]` (each `changes: true`), `[data-tour="status"]` |
| `quick-setup-tour.js` | centred intro, `[data-tour="sidebar"]`, `[data-testid="assistant-toggle"]`, `[data-tour="viewport"]` |

## Source-text consumers

These tests read a source file and assert that a hook appears in it. They pin the hook to a file, so V2-0.2 breaks them even when the rendered DOM is unchanged. V2-0.1 converts them to behaviour tests; until then a move of the producer must move the assertion with it.

| Test | Reads | Hooks it pins |
| --- | --- | --- |
| `test/cloud-shell-surfaces.test.ts` | `client/app.jsx` | V2-4.8a: the `onOpenDashboard` handler (`cfg?.cloud?.dashboardUrl`, `window.location.assign`) and the `noDashboard` gate on the `nav.home` row (was `cloud-back`, then `cloud-project-name`) |
| `test/sync-panel-surface.test.ts` | `client/app.jsx`, `client/panels/SyncPanel.jsx` | `sync-assets`, `sync-resync`, `sync-assets-cancel`, `` data-testid={`sync-held-${h.kind}`} `` (SyncPanel.jsx) |
| `test/cloud-history-posture.test.ts` | `client/panels/GitPanel.jsx` | `git-history-unreachable`, `git-history-retry` |
| `test/cloud-managed-save-surfaces.test.ts` | `client/panels/GitPanel.jsx` | `git-cloud-managed` |
| `test/git-cloud-posture.test.ts` | `client/panels/GitPanel.jsx` | `git-cloud-managed`, `className="gp-tabs"` under `!withdrawn`, `className="gp-cloud-note"` under `cloudManaged` |
| `test/shell-accessibility.test.ts` | `client/app.jsx` (oxc AST), `client/index.html` | no element has `role="menubar"` and the `project-pill` has `aria-haspopup="menu"` (V2-4.8a; was `.st-menus` / `.st-menubar`); the iframe with `data-path` has a `title` template literal "Canvas: " + `t.path`; `<FileTree aria-label="Project file tree"` (the `canvas-list` element); `DirRow`/`DsFolderRow`/`FileRow`/`CanvasRow`/`Sidebar` each contain `<FileTreeItem` |

The other source-reading tests named by the survey (`config-projection`, `comment-relay-origin-gate`, `export-format-scope-coherence`, `history-preview-routing`, `tree-expansion`, plus `acp-branch-guard` and `exporters/degraded-propagation`) pin code shapes such as function bodies and message branches, not DOM hooks, so they are not listed per hook here.

## Dangling consumers

Consumers that target a hook no producer emits today. Each one is a test, spec or spotlight that fails, or passes for the wrong reason.

| Hook | Consumer | What happened | Effect |
| --- | --- | --- | --- |
| `[data-tour="menubar-file"]` | whats-new `ai-media-generation` step 0 | Never emitted. The File menu trigger carries `data-testid="menu-file"` and no `data-tour`. | Spotlight shows centred, pointing at nothing. |
| `.dc-artboard-ghost` | `spec:canvas-format-tsx/canvas-artboard-drag` (asserts it exists after a drag, and is absent otherwise) | No component renders it: `DCArtboard` drags the article itself ("no ghost placeholder" in `canvas-lib.tsx`). | The positive assertion fails; the negative ones pass vacuously. |
| `.dc-error-overlay` | `spec:web-artboards` (asserts it is absent) | No component has ever rendered this class (it appears only in the spec). | Passes vacuously; it cannot detect a render error. |
| `[data-canvas-row]` | `spec:canvas-format-tsx/tsx-canvas-render-and-edit` | Never emitted; tree rows use `data-testid="canvas-row-<slug>"`. | Selector check fails. |
| `[data-dc-slot]` | `bin:screenshot.sh`, `bin:smoke.sh` | Legacy artboard-slot attribute; no current component emits it. Both helpers query it next to `[data-dc-screen]`. | Harmless fallback today; dead code. |
| `.st-skel-cap` | `test:shell-text-contrast` (CSS rule contrast) | The rule still exists in `styles/3-shell-maude.css`, but `CanvasLoading` stopped rendering the class in `ee05b957` (it now renders `.st-skel-card/-thumb/-line`). | Test passes on dead CSS. |
| `.dc-tool-palette` (spotlight) | whats-new `canvas-annotations-figjam-v3` step 0 | The element exists, but inside the canvas iframe; the tour overlay only searches the shell document. | Spotlight never resolves. |

Related producer-side gaps (not dangling, but they bite the same way):

- **`canvas-row-<slug>` is missing in one state.** Only `FileRow` builds it. A canvas that has sidecars is rendered by `CanvasRow` when "show hidden files" is on, and that row has no `canvas-row-*` id, so `canvasRow()` / `expandTree()` cannot find it in that mode.
- **`data-tour="whatsnew"` on an unmounted component.** `WhatsNewBadge` (`client/whats-new.jsx`) emits it but is never rendered; the live anchor is the `.st-whatsnew` button in `Menubar`.
- **Same testid on two elements:** `cloud-account` (menubar chip in the cloud shell, and the CloudBar account button in the local shell); `export-include-annotations` and `export-pdf-text` (the shell Export dialog and the in-canvas export dialog `DialogShell`, two documents); `chat-msg-actions` (user and assistant messages, intended).
- **Convention breaks:** `st-empty-start-quick-setup` (class-style name), `sync-setting-syncFiles` / `-propagateDeletes` / `-firstAnchor` (camelCase), `notice-<id>` (no area prefix).
- **Survey corrections** (F-codebase-survey §5): `inspector-open` is a screenshot label in `shell-parity`, not a hook; there is no `menu-ui` hook (the `share-link` consumer is `tree-row-menu-ui-export`); `.st-sb-title` is the sidebar title, not a status-bar element.

## Not in this contract

These selectors appear in consumers but target content that is not studio UI, so they are not hooks:

- **Fixture canvas content** (authored in `apps/desktop/e2e/fixtures/project/.design/ui/*.tsx` or by the test itself): `smoke-artboard-content`, `smoke-h1`, `smoke-p`, `smoke-mixed`, `smoke-cards`, `smoke-card-body`, `export-artboard-content`, `surface-dep`, `surface-photo`, `surface-video`, `surface-moved-media`, `[data-surface-note]`, the `eel-*` classes in the element-editing specs, and the canvas classes (`.hero`, `.card`, `.cta`, `.stamp`…) used by unit tests of the canvas edit pipeline.
- **Test-local markup:** `print-bleed`, `breakpoint-band`, `v1`, `v2` (`test:artboard-guides-overlay` renders its own overlays), `[data-good]` (`test:canvas-hmr-runtime`), `[data-x]` (`test:read-annotations`, selector validation input).
- **Third-party overlays** probed by `bin:smoke.sh`: `#__react-error-overlay`, `.react-error-overlay`, `[data-error-overlay]`, `pre.error-stack`.
- **The docs site** (`.ai/scenarios/docs-site/**`) and recorded evidence (`.ai/scenarios/**/evidence/**`).
- **The desktop splash** (`apps/desktop/src/index.html` queries its own `.status` / `.splash`).
- **Boot gates:** `scripts/check-client-boots-source.mjs` and `apps/desktop/scripts/check-client-boots.mjs` only check that `#root` has children; they target no hook. `#root` itself is the mount point in `client/index.html`.

## Counts

- **Producers.** 338 `data-testid` hooks (275 static, 63 patterns) from 359 emit sites, plus 15 `data-tour` anchors from 16 emit sites. 155 testids and 15 anchors have at least one consumer; the other 183 testids are emitted but nothing outside their component targets them yet.
- **Other selectors.** 121 non-testid selector entries (classes, `aria-label`s, roles, data attributes, accessible-name locators) that consumers target.
- **Consumers.** 137 files reference at least one hook (694 hook–file pairs); 69 of them reference a `data-testid`. By kind: test 50, e2e 22, spec 21, bin 17, runner 7, test-e2e 6, e2e-mp 4, tour 3, e2e-helper 3, app.jsx 1, skill 1, frame-probe 1, whats-new 1.
- **Spotlights.** 26 What's New targets: 10 live, 14 need a shell state, 1 dangling, 1 unreachable.
- **Dangling consumers.** 6 hooks with no producer (listed above), plus the unreachable spotlight.
