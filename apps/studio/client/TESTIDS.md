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
- **v2** (from `.ai/plans/notes/v2-inventory/F-codebase-survey.md` §5, extended to every hook): **stable — re-emit** = the element keeps its meaning in v2 and must carry the same hook; **moves — map in Phase 4** = its region is replaced by the v2 shell (menubar, status bar, dock, bottom-of-sidebar switcher and cloud rail, banners, ⌘K, inspector container, onboarding, export, timeline, settings, palette mode switch), so the hook and every consumer get a v2 equivalent in the Phase 4 change that moves it; **historical** = no live element (spotlight or consumer of DOM that is gone).

## Hooks by region

### menubar

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `menubar` | testid | The in-app menubar row (top chrome of the shell). | `client/app.jsx` · `Menubar` | e2e-mp:surface, e2e:shell-parity | moves — map in Phase 4 |
| `menu-<key>` | testid (pattern) | One top-level menu trigger, `role="menuitem"`. `<key>` is the lower-cased name from `MENU_NAMES`: file, edit, view, selection, tools, help. `aria-expanded` reflects an open dropdown. *Menubar itself focuses `[data-testid="menu-file"]` when the Share shortcut fires.* | `client/app.jsx` · `Menubar` | e2e-mp:surface | moves — map in Phase 4 |
| `cloud-back` | testid | Cloud shell only: the "← Dashboard" back link at the left of the menubar. | `client/app.jsx` · `Menubar` | test:cloud-shell-surfaces (source text) | moves — map in Phase 4 |
| `cloud-project-name` | testid | Cloud shell only: the project name shown next to the back link. | `client/app.jsx` · `Menubar` | test:cloud-shell-surfaces (source text) | moves — map in Phase 4 |
| `view-only-stamp` | testid | The "View only" stamp shown in the menubar for a read-only (viewer) session. | `client/app.jsx` · `Menubar` | — | moves — map in Phase 4 |
| `cloud-account` | testid | Signed-in cloud account control. Emitted by TWO different elements: the menubar account chip in the cloud shell (`Menubar`) and the account menu button in the sidebar cloud rail (`CloudBar`). Scenarios reach the CloudBar one. *Duplicate testid across two components.* | `client/app.jsx` · `Menubar`<br>`client/panels/CloudBar.jsx` · `CloudBar` | e2e:cloud-attach | moves — map in Phase 4 |
| `cloud-signout` | testid | Cloud shell only: the sign-out button next to the account chip. | `client/app.jsx` · `Menubar` | — | moves — map in Phase 4 |
| `assistant-toggle` | testid | Menubar button that opens/closes the Assistant (ACP chat) panel. Native app only. | `client/app.jsx` · `Menubar` | e2e:acp-ask-user-question, e2e:acp-capability-picker, e2e:acp-cold-start, e2e:acp-write-scope, tour:quick-setup-tour | moves — map in Phase 4 |
| `share-btn` | testid | Menubar Share button; opens the share dialog for the active canvas. Disabled when no canvas is open. | `client/app.jsx` · `Menubar` | e2e:share-link, whats-new | moves — map in Phase 4 |
| `report-bug-toggle` | testid | Menubar bug icon that opens the Report-a-bug dialog. | `client/app.jsx` · `Menubar` | — | moves — map in Phase 4 |
| `[data-tour="brand"]` | data-tour | The maude wordmark at the left of the menubar. | `client/app.jsx` · `Menubar` | whats-new | moves — map in Phase 4 |
| `[data-tour="menus"]` | data-tour | The `nav.st-menus` group holding the six menu triggers (`role="menubar"`). | `client/app.jsx` · `Menubar` | tour:usage-tour, whats-new | moves — map in Phase 4 |
| `[data-tour="help"]` | data-tour | The Help menu trigger (same element as `menu-help`). | `client/app.jsx` · `Menubar` | e2e:report-bug-dialog, tour:usage-tour, whats-new | moves — map in Phase 4 |
| `[data-tour="status"]` | data-tour | The right-hand menubar cluster `.st-mb-right` (presence, view-only stamp, cloud account, Assistant, Exports, Share, bug, What's New). *Despite its name this anchor is in the menubar, not the status bar.* | `client/app.jsx` · `Menubar` | tour:collab-tour, whats-new | moves — map in Phase 4 |
| `[data-tour="whatsnew"]` | data-tour | The What's New button in the menubar (`.st-whatsnew`, `data-unseen`). *`WhatsNewBadge` also emits this anchor but is exported and never mounted.* | `client/app.jsx` · `Menubar`<br>`client/whats-new.jsx` · `WhatsNewBadge` | tour:usage-tour, whats-new | moves — map in Phase 4 |
| `[data-tour="exports"]` | data-tour | The Exports badge in the menubar (`.st-exports`, `data-busy`); opens the export job list. *Mounted by `Menubar` only when the export center exists.* | `client/export-center.jsx` · `ExportBadge` | whats-new | moves — map in Phase 4 |
| `.st-menus` | selector | The menu-trigger group; must keep `role="menubar"` (the outer `.st-menubar` must have no role). *Source-text consumer only: `test/shell-accessibility.test.ts` parses `app.jsx` and finds these by className.* | `client/app.jsx` · `Menubar` | test:shell-accessibility (source text) | moves — map in Phase 4 |
| `.st-menubar` | selector | The outer menubar row (same element as `menubar`); must carry no ARIA role. *Source-text consumer only (see `.st-menus`).* | `client/app.jsx` · `Menubar` | test:shell-accessibility (source text) | moves — map in Phase 4 |
| `.st-dd-item` | selector | A dropdown menu item in the menubar dropdowns and the tree row menu. `report-bug-dialog` uses `button.st-dd-item*=Report a bug` (Help menu item by text). | `client/app.jsx` · `DropdownMenu`<br>`client/app.jsx` · `ViewDropdown`<br>`client/tree-row-menu.jsx` · `TreeRowMenu` | e2e:report-bug-dialog | moves — map in Phase 4 |
| `.st-mb-proj` | selector | Menubar project name text. *CSS consumer: `test/shell-text-contrast.test.ts` reads the rule in `styles/3-shell-maude.css`, not the DOM.* | `client/app.jsx` · `Menubar` | test:shell-text-contrast | moves — map in Phase 4 |
| `.st-cloudwho-out` | selector | Cloud account sign-out text in the menubar. *CSS consumer (rule in `styles/4-components.css`).* | `client/app.jsx` · `Menubar` | test:shell-text-contrast | moves — map in Phase 4 |
| menuitem by name (menubar) | selector | Menubar triggers and dropdown rows reached by accessible name: "Edit" (menu trigger), "Close canvas" (File/Edit), "New artboard: Mobile" (Edit). *`surface.e2e.ts` `Surface.menu(text)` = Playwright `getByRole('menuitem', { name, exact: true })`.* | `client/app.jsx` · `Menubar`<br>`client/app.jsx` · `FileDropdown`<br>`client/app.jsx` · `EditDropdown` | e2e-mp:surface | moves — map in Phase 4 |

### status bar

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `statusbar` | testid | The bottom status bar `footer.st-statusbar`. | `client/app.jsx` · `StatusBar` | e2e:shell-parity | moves — map in Phase 4 |
| `statusbar-sync` | testid | Value text of the hub-sync chip (`data-phase` carries the sync phase, `title` the detail). Linked projects only. | `client/app.jsx` · `StatusBar` | — | moves — map in Phase 4 |
| `open-changes` | testid | Status-bar Changes chip; toggles the Changes (git) panel. `aria-pressed` = panel open. | `client/app.jsx` · `StatusBar` | runner:reliable-project-multiplayer/f3/s11-browser.mjs, runner:reliable-project-multiplayer/f3/s19-browser.mjs, e2e-mp:surface, e2e:git-lifecycle, e2e:team-project | moves — map in Phase 4 |
| `open-sync` | testid | Status-bar hub-sync chip in its button form; toggles the Sync panel. `aria-pressed` = panel open. Linked projects only. | `client/app.jsx` · `StatusBar` | e2e-mp:surface, e2e:cloud-attach, e2e:team-project, whats-new, test:sync-panel-surface (source text) | moves — map in Phase 4 |
| `statusbar-version` | testid | The `v<version>` text in the status bar (absent when `/_config` has no version). | `client/app.jsx` · `StatusBar` | — | moves — map in Phase 4 |
| `.st-sb-sync` | selector | The hub-sync chip (button or span form); its text is read as the sync status word; `title`/`data-tip` carry detail; `.val` holds the value. | `client/app.jsx` · `StatusBar` | runner:reliable-project-multiplayer/f3/s18-desktop.mjs, e2e-mp:surface, e2e:team-project | moves — map in Phase 4 |
| `.st-sb-sel` | selector | The status-bar selection chip; `.st-sb-sel .val` = the selected element's name. | `client/app.jsx` · `StatusBar` | e2e-mp:surface | moves — map in Phase 4 |
| `.st-sb-theme` | selector | The theme toggle button in the status bar. | `client/app.jsx` · `StatusBar` | e2e:team-project | moves — map in Phase 4 |
| `.st-sb-slot` | selector | A status-bar slot; the `.st-sb-slot .lbl` rule is contrast-tested. *CSS consumer.* | `client/app.jsx` · `StatusBar` | test:shell-text-contrast | moves — map in Phase 4 |
| `.st-sb-version` | selector | The version slot; the `.st-sb-version .val` rule is contrast-tested. *CSS consumer.* | `client/app.jsx` · `StatusBar` | test:shell-text-contrast | moves — map in Phase 4 |
| `[aria-label="Selected element"]` | selector | The selection chip group; `[aria-label="Selected element"] .val` = selected element name. | `client/app.jsx` · `StatusBar` | e2e-mp:surface | moves — map in Phase 4 |
| `[aria-label="Clear selection"]` | selector | Clear-selection button in the selection chip. | `client/app.jsx` · `StatusBar` | e2e-mp:surface | moves — map in Phase 4 |
| button "Switch to &lt;theme&gt; theme" | selector | The theme toggle by accessible name (same element as `.st-sb-theme`). *Playwright `getByRole('button', { name: 'Switch to <theme> theme' })`.* | `client/app.jsx` · `StatusBar` | runner:reliable-project-multiplayer/f3/s19-browser.mjs | moves — map in Phase 4 |

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
| menuitem by name (row menu) | selector | Tree row-menu items by accessible name: "Rename…", "Duplicate", "Move to…", "Delete", "New folder here", "Rename folder", "Delete folder", "Share…", and Move-to destinations named `ui/<folder>`. *Labels are defined in `Sidebar` (row-menu items) and rendered by `TreeRowMenu`. `share-link` uses the WebdriverIO text selector `button=Share…`; `surface.e2e.ts` uses `getByRole('menuitem', { name })`.* | `client/app.jsx` · `Sidebar`<br>`client/tree-row-menu.jsx` · `TreeRowMenu` | e2e-mp:surface, e2e:share-link | stable — re-emit |

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
| `[aria-label="Command palette"]` | selector | The ⌘K command palette dialog. It has no testid. | `client/app.jsx` · `CommandPalette` | e2e-mp:surface | moves — map in Phase 4 |

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

### comments panel

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `comment-filter-all` | testid | Comments panel filter: All. | `client/app.jsx` · `CommentsPanel` | — | stable — re-emit |
| `comment-filter-open` | testid | Comments panel filter: Open. | `client/app.jsx` · `CommentsPanel` | — | stable — re-emit |
| `comment-filter-resolved` | testid | Comments panel filter: Resolved. | `client/app.jsx` · `CommentsPanel` | e2e-mp:surface | stable — re-emit |
| `comment-item-<id>` | testid (pattern) | One comment thread row in the Comments panel (`<id>` = comment id). | `client/app.jsx` · `CommentsPanel` | e2e-mp:surface | stable — re-emit |
| `[aria-label="Reopen"]` | selector | Reopen button on a resolved comment in the Comments panel. | `client/app.jsx` · `CommentsPanel` | e2e-mp:surface | stable — re-emit |

### banners

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `cloud-role-banner` | testid | Cloud shell banner that states what your role (owner / member / viewer) can do in this project. | `client/app.jsx` · `CloudRoleBanner` | — | moves — map in Phase 4 |
| `cloud-role-banner-dismiss` | testid | Dismiss button on the cloud role banner. | `client/app.jsx` · `CloudRoleBanner` | — | moves — map in Phase 4 |
| `notice-<id>` | testid (pattern) | One notification card in the shared notification stack (`<id>` = notice id). | `notifications.tsx` · `NoticeCard` | test:notifications | stable — re-emit |
| `.maude-notice / -action / -summary` | selector | A notification card, its action button and its summary line. | `notifications.tsx` · `NoticeCard`<br>`client/export-center.jsx` · `ExportJobNotice` | test:notifications | stable — re-emit |
| button "Got it" / "Dismiss" | selector | Onboarding-hint and banner dismiss buttons, clicked by accessible name before timed actions. *`surface.e2e.ts` clicks every visible match; there is no single producer.* | `client/app.jsx` · `App` | e2e-mp:surface | moves — map in Phase 4 |

### help/shortcuts

No hooks. Nothing outside the components in this region targets their DOM (`HelpModal` and `ShortcutsOverlay` emit no testid; the Help menu trigger is listed under menubar).

### settings

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `figma-connect-card` | testid | Settings: the Figma connection card. | `client/panels/SettingsPanel.jsx` · `FigmaConnectCard` | — | moves — map in Phase 4 |
| `figma-connect-input` | testid | Settings: Figma token input. | `client/panels/SettingsPanel.jsx` · `FigmaConnectCard` | — | moves — map in Phase 4 |
| `figma-connect-save` | testid | Settings: save the Figma token. | `client/panels/SettingsPanel.jsx` · `FigmaConnectCard` | — | moves — map in Phase 4 |
| `figma-disconnect` | testid | Settings: disconnect Figma. | `client/panels/SettingsPanel.jsx` · `FigmaConnectCard` | — | moves — map in Phase 4 |
| `figma-connected-as` | testid | Settings: "connected as …" status line. | `client/panels/SettingsPanel.jsx` · `FigmaConnectCard` | — | moves — map in Phase 4 |
| `figma-connect-error` | testid | Settings: Figma connection error line. | `client/panels/SettingsPanel.jsx` · `FigmaConnectCard` | — | moves — map in Phase 4 |

### chat/ACP

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `acp-not-connected` | testid | Chat panel body shown while the ACP agent is not connected (holds the readiness list). | `client/panels/ChatPanel.jsx` · `NotConnected` | e2e:acp-ask-user-question, e2e:acp-capability-picker, e2e:acp-cold-start, e2e:acp-write-scope | stable — re-emit |
| `acp-setup-install` | testid | Readiness row action: install Claude Code. | `client/panels/ReadinessList.jsx` · `SetupAction` | e2e:acp-cold-start | stable — re-emit |
| `acp-setup-signin` | testid | Readiness row action: sign in to Claude Code. | `client/panels/ReadinessList.jsx` · `SetupAction` | — | stable — re-emit |
| `rdy-row-<id>` | testid (pattern) | One readiness check row (e.g. `rdy-row-claude`). Also rendered in onboarding and the readiness dialog. | `client/panels/ReadinessList.jsx` · `Row` | e2e:acp-cold-start | stable — re-emit |
| `chat-composer` | testid | The chat composer (input area). | `client/panels/ChatPanel.jsx` · `Composer` | e2e:acp-ask-user-question, e2e:acp-capability-picker, e2e:acp-cold-start, e2e:acp-write-scope | stable — re-emit |
| `chat-context-chip` | testid | The context chip in the composer (what the agent will see). | `client/panels/ChatPanel.jsx` · `Composer` | — | stable — re-emit |
| `chat-mode-banner` | testid | Top-of-thread alert shown only while the current permission mode blocks edits (e.g. Plan). | `client/panels/ChatPanel.jsx` · `ModeBanner` | — | stable — re-emit |
| `chat-mode-banner-switch` | testid | Button on that alert that switches to the least-privilege mode that can edit. | `client/panels/ChatPanel.jsx` · `ModeBanner` | — | stable — re-emit |
| `chat-tool-row` | testid | One tool-call row inside a tool card. | `client/panels/ChatPanel.jsx` · `ChatToolCard` | — | stable — re-emit |
| `chat-tool-group` | testid | "Ran N tools" row that folds 2+ consecutive tool calls (expands to the individual cards). | `client/panels/ToolGroup.jsx` · `ToolGroup` | — | stable — re-emit |
| `chat-msg-actions` | testid | The action row under a message. Emitted by both `UserMessage` and `AssistantMessage`. | `client/panels/ChatPanel.jsx` · `UserMessage`<br>`client/panels/ChatPanel.jsx` · `AssistantMessage` | e2e:acp-write-scope | stable — re-emit |
| `chat-transcript-menu` | testid | The transcript menu button in the chat status row. | `client/panels/ChatPanel.jsx` · `StatusRow` | — | stable — re-emit |
| `chat-foot-info-btn` | testid | "Chat info" button in the chat footer. | `client/panels/ChatPanel.jsx` · `ChatFootInfo` | — | stable — re-emit |
| `chat-foot-popover` | testid | The chat info popover opened by `chat-foot-info-btn`. | `client/panels/ChatPanel.jsx` · `ChatFootInfo` | — | stable — re-emit |
| `chat-usage-banner` | testid | Rate-limit / usage banner in the chat. | `client/panels/ChatPanel.jsx` · `RateLimitBanner` | — | stable — re-emit |
| `chat-error-card` | testid | Error card in the chat transcript (`role="alert"`). | `client/panels/ChatPanel.jsx` · `ErrorCard` | — | stable — re-emit |
| `chat-qa-implement-comments` | testid | Quick action "implement comments". | `client/panels/ChatPanel.jsx` · `QuickActions` | — | stable — re-emit |
| `chat-cmd-menu` | testid | The slash-command popover (`role="listbox"`). | `client/panels/ChatPanel.jsx` · `CommandPopover` | — | stable — re-emit |
| `chat-cmd-item-<name>` | testid (pattern) | One slash-command item; `<name>` = command name with non-alphanumerics → `-`. | `client/panels/ChatPanel.jsx` · `CommandPopover` | — | stable — re-emit |
| `chat-overflow-menu` | testid | The chat panel overflow (⋯) menu. | `client/panels/ChatPanel.jsx` · `ChatPanel` | — | stable — re-emit |
| `chat-caps-connecting` | testid | Capability bar placeholder while the agent connects. | `client/panels/CapabilityBar.jsx` · `CapabilityBar` | — | stable — re-emit |
| `chat-caps-bar` | testid | The capability bar (live model/mode/effort pickers). | `client/panels/CapabilityBar.jsx` · `CapabilityBar` | — | stable — re-emit |
| `chat-mode-picker` | testid | The permission-mode picker in the capability bar. | `client/panels/CapabilityBar.jsx` · `CapabilityBar` | e2e:acp-capability-picker, whats-new | stable — re-emit |
| `chat-permission-prompt` | testid | The tool-permission prompt card. | `client/panels/PermissionPrompt.jsx` · `PermissionPrompt` | e2e:acp-write-scope | stable — re-emit |
| `chat-perm-queue` | testid | Queue counter on the permission prompt. | `client/panels/PermissionPrompt.jsx` · `PermissionPrompt` | — | stable — re-emit |
| `chat-perm-outside` | testid | Warning that a requested write is outside the project. | `client/panels/PermissionPrompt.jsx` · `PermissionPrompt` | e2e:acp-write-scope, test:acp-permission-prompt | stable — re-emit |
| `chat-perm-paths` | testid | The list of paths a permission request touches. | `client/panels/PermissionPrompt.jsx` · `PermissionPrompt` | e2e:acp-write-scope | stable — re-emit |
| `chat-elicit-prompt` | testid | The "Claude is asking you" elicitation card. | `client/panels/ElicitationPrompt.jsx` · `ElicitationPrompt` | e2e:acp-ask-user-question, whats-new | stable — re-emit |
| `chat-elicit-step` | testid | Step counter on a multi-question elicitation. | `client/panels/ElicitationPrompt.jsx` · `ElicitationPrompt` | — | stable — re-emit |
| `chat-elicit-back` | testid | Elicitation Back button. | `client/panels/ElicitationPrompt.jsx` · `ElicitationPrompt` | — | stable — re-emit |
| `chat-elicit-submit` | testid | Elicitation Submit button. | `client/panels/ElicitationPrompt.jsx` · `ElicitationPrompt` | e2e:acp-ask-user-question | stable — re-emit |
| `chat-elicit-next` | testid | Elicitation Next button. | `client/panels/ElicitationPrompt.jsx` · `ElicitationPrompt` | — | stable — re-emit |
| `chat-elicit-skip` | testid | Elicitation Skip button. | `client/panels/ElicitationPrompt.jsx` · `ElicitationPrompt` | — | stable — re-emit |
| `chat-elicit-cancel` | testid | Elicitation Cancel button. | `client/panels/ElicitationPrompt.jsx` · `ElicitationPrompt` | — | stable — re-emit |
| `chat-elicit-question-<id>` | testid (pattern) | One question fieldset (`<id>` = question id). | `client/panels/ElicitationPrompt.jsx` · `Question` | — | stable — re-emit |
| `chat-elicit-option-<id>-<i>` | testid (pattern) | Option `<i>` of question `<id>`; `chat-elicit-option-<id>-other` is the free-text "Other" option. | `client/panels/ElicitationPrompt.jsx` · `Question` | e2e:acp-ask-user-question | stable — re-emit |
| `chat-elicit-custom-<id>` | testid (pattern) | Free-text input behind the "Other" option. | `client/panels/ElicitationPrompt.jsx` · `Question` | — | stable — re-emit |
| `chat-elicit-text-<id>` | testid (pattern) | Text answer input for a text question. | `client/panels/ElicitationPrompt.jsx` · `Question` | — | stable — re-emit |
| `chat-elicit-secret-warning` | testid | Warning shown when a question asks for a secret. | `client/panels/ElicitationPrompt.jsx` · `Question` | — | stable — re-emit |
| `.chat-input` | selector | The composer textarea. | `client/panels/ChatPanel.jsx` · `HighlightedInput` | e2e:acp-ask-user-question, e2e:acp-capability-picker, e2e:acp-write-scope | stable — re-emit |
| `[aria-label="Send message"]` | selector | Composer send button. | `client/panels/ChatPanel.jsx` · `Composer` | e2e:acp-ask-user-question, e2e:acp-write-scope | stable — re-emit |
| `.btn--danger (permission prompt)` | selector | The deny/destructive button on the permission prompt (`[data-testid="chat-permission-prompt"] .btn--danger`). | `client/panels/PermissionPrompt.jsx` · `PermissionPrompt` | e2e:acp-write-scope | stable — re-emit |
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
| `sync-settings` | testid | Sync settings section. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-setting-syncFiles` | testid | Setting: sync project files (camelCase id, breaks the kebab-case convention). | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-setting-propagateDeletes` | testid | Setting: propagate deletes (camelCase id). | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-setting-firstAnchor` | testid | Setting: first-link anchor (camelCase id). | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-ownership` | testid | Ownership section. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-ownership-mode` | testid | Current ownership mode line. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-ownership-adopt` | testid | Adopt ownership button. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-ownership-detach` | testid | Detach ownership button. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-ownership-confirm` | testid | Ownership change confirmation. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
| `sync-ownership-confirm-yes` | testid | Confirm ownership change. | `client/panels/SyncPanel.jsx` · `SyncPanel` | — | stable — re-emit |
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
| `.dc-tool-palette` | selector | The in-canvas tool palette (bottom toolbar, `role="toolbar"`). | `tool-palette.tsx` · `ToolPalette` | spec:canvas-format-tsx/canvas-annotations-figjam, spec:canvas-format-tsx/canvas-context-menu, spec:canvas-format-tsx/canvas-input-grammar, runner:reliable-project-multiplayer/f3/s09-browser.mjs, e2e-mp:surface, test:canvas-hide-chrome, test:input-router, whats-new | moves — map in Phase 4 |
| `.dc-tp-insert-popover` | selector | Insert (Div/Text/Image) popover of the palette. | `tool-palette.tsx` · `ToolPalette` | e2e-mp:surface | moves — map in Phase 4 |
| Tool palette buttons | selector | Palette buttons by `aria-label` = "&lt;Tool&gt; (&lt;key&gt;)" from `TOOLS` in `use-tool-mode.tsx` (Select (V), Hand (H), Comment (C), Pen (B), Shape (R), Sticky (N), Section (⇧S), Eraser (E), Browse); plus "Insert element", "Insert element — Div, Text, or Image", "Shape type", "Stickers", "Presentation mode". *`aria-label^="Comment"` also matches the Comments panel / timeline comment controls.* | `tool-palette.tsx` · `ToolPalette` | runner:reliable-project-multiplayer/f3/s09-browser.mjs, e2e-mp:surface, test:mode-toggle | moves — map in Phase 4 |
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

### other

| Hook | Kind | Meaning | Producer | Consumers | v2 |
| --- | --- | --- | --- | --- | --- |
| `dock-tab-<id>` | testid (pattern) | Panel dock tab; `<id>` ∈ tree, layers, inspector, comments, changes, sync, assistant (`DOCK_PANELS`). *Region: the configurable left/right panel dock, which v2 removes.* | `client/app.jsx` · `DockSlot` | e2e-mp:surface | moves — map in Phase 4 |
| `shell-prompt-input` | testid | Input of the shell's own prompt dialog (`.st-prompt`, replaces `window.prompt`). | `client/app.jsx` · `App` | e2e-mp:surface | stable — re-emit |
| `shell-prompt-ok` | testid | OK button of the shell prompt dialog. | `client/app.jsx` · `App` | e2e-mp:surface | stable — re-emit |
| `embed-view` | testid | Root of the embed shell (`?embed` location). | `client/embed-view.jsx` · `EmbedView` | — | stable — re-emit |
| `embed-canvas-frame` | testid | The canvas iframe in the embed shell. | `client/embed-view.jsx` · `EmbedView` | — | stable — re-emit |
| `[data-testid$="-dialog"]` | selector | Any testid ending in `-dialog`, used with `[role="dialog"]` to assert that no dialog is open. Matches today: share-dialog, report-bug-dialog, cloud-deeplink-dialog, cloud-device-dialog, file-deeplink-dialog, team-projects-dialog. *Keep the `-dialog` suffix on new dialog roots.* | `client/share-dialog.jsx` · `ShareDialog`<br>`client/report-bug.jsx` · `ReportBugDialog`<br>`client/panels/CloudBar.jsx` · `CloudBar`<br>`client/panels/file-deep-link-dialog.jsx` · `FileDeepLinkDialog`<br>`client/panels/TeamProjects.jsx` · `TeamProjectsDialog` | e2e:cloud-attach | stable — re-emit |
| `[role="dialog"] / [aria-modal="true"]` | selector | Any open dialog/modal (most shell dialogs and in-canvas popovers carry the role). *`App()` checks `[role="dialog"][aria-modal="true"]` to suppress shortcuts while a modal is open.* | `client/app.jsx` · `App` | runner:reliable-project-multiplayer/f3/s19-browser.mjs, e2e:cloud-attach, app.jsx, test:history-preview-focus | stable — re-emit |
| `[role="status"]` | selector | Live status regions (loading, banners, notes). | `client/app.jsx` · `App` | runner:reliable-project-multiplayer/f3/s19-browser.mjs | stable — re-emit |
| `.st-dialog-hd / .st-iconbtn` | selector | A dialog header and its close (×) icon button; `report-bug-dialog` closes via `[data-testid="report-bug-dialog"] .st-dialog-hd .st-iconbtn`. | `client/report-bug.jsx` · `ReportBugDialog` | e2e:report-bug-dialog | stable — re-emit |
| `.st-scrim` | selector | Modal backdrop shared by shell dialogs. | `client/app.jsx` · `App` | runner:reliable-project-multiplayer/f3/s19-browser.mjs | stable — re-emit |
| `.st-prompt` | selector | The shell prompt dialog (holds `shell-prompt-input` / `shell-prompt-ok`). | `client/app.jsx` · `App` | e2e-mp:surface | stable — re-emit |
| `[aria-label="Close"]` | selector | Generic close button (many dialogs and panels). | `client/app.jsx` · `InspectorPanel` | e2e-mp:surface | stable — re-emit |
| `[aria-label="Choose media"] / .st-ap-cell` | selector | Replace-media asset picker dialog and one asset cell. | `client/app.jsx` · `AssetPicker` | e2e-mp:surface | stable — re-emit |
| `.st-sp-body / .st-sp-cell` | selector | Sticker picker body and one sticker cell. | `client/panels/StickerPicker.jsx` · `StickerPicker` | e2e-mp:surface | stable — re-emit |
| `[aria-label="Stickers"]` | selector | Sticker picker dialog (shell) and the palette Stickers button (iframe) share this label. | `client/panels/StickerPicker.jsx` · `StickerPicker`<br>`tool-palette.tsx` · `ToolPalette` | e2e-mp:surface | stable — re-emit |
| `.st-docktab` | selector | A panel dock tab (same element as `dock-tab-<id>`). *CSS consumer.* | `client/app.jsx` · `DockSlot` | test:shell-text-contrast | moves — map in Phase 4 |
| `.maude[data-theme]` | selector | The shell root `div.maude` and its `data-theme="light\|dark"` (mirrored on `<html data-theme>`). The token blocks in `styles/1-tokens-maude.css` are scoped to `.maude[data-theme=…]`. *`team-project` reads `<html data-theme>`; `shell-text-contrast` reads the CSS token blocks.* | `client/app.jsx` · `App` | runner:reliable-project-multiplayer/f3/s19-browser.mjs, e2e:team-project, test:shell-text-contrast | stable — re-emit |

## What's New spotlights

Every `tour[].target` in `apps/studio/whats-new.json`. The tour overlay (`client/tour/overlay.jsx`) resolves a target with `document.querySelector` on the shell document and shows the step centred, without a spotlight, when nothing matches, so a broken target fails silently. No test checks these targets today. "Needs state" means the element exists only in some shell state; the setup directives (`canvas`, `inspector`, `tab`, `requireSelection`) are noted where the step has them.

| # | Entry (version) | Target | Resolves today | v2 |
| --- | --- | --- | --- | --- |
| 1 | `share-link-deeplink` step 0 (1.3.0) | `[data-testid="share-btn"]` | live — menubar; `canvas: true` opens a canvas first | moves — map in Phase 4 |
| 2 | `sync-panel-per-file` step 0 (0.59.0) | `[data-testid="open-sync"]` | needs state — only in a hub-linked project (the status bar renders no sync chip otherwise) | moves — map in Phase 4 |
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
| `test/cloud-shell-surfaces.test.ts` | `client/app.jsx` | `cloud-back`, then `cloud-project-name` in the same block |
| `test/sync-panel-surface.test.ts` | `client/app.jsx`, `client/panels/SyncPanel.jsx` | `open-sync` (app.jsx); `sync-assets`, `sync-resync`, `sync-assets-cancel`, `` data-testid={`sync-held-${h.kind}`} `` (SyncPanel.jsx) |
| `test/cloud-history-posture.test.ts` | `client/panels/GitPanel.jsx` | `git-history-unreachable`, `git-history-retry` |
| `test/cloud-managed-save-surfaces.test.ts` | `client/panels/GitPanel.jsx` | `git-cloud-managed` |
| `test/git-cloud-posture.test.ts` | `client/panels/GitPanel.jsx` | `git-cloud-managed`, `className="gp-tabs"` under `!withdrawn`, `className="gp-cloud-note"` under `cloudManaged` |
| `test/shell-accessibility.test.ts` | `client/app.jsx` (oxc AST), `client/index.html` | `.st-menus` has `role="menubar"`, `.st-menubar` has no role; the iframe with `data-path` has a `title` template literal "Canvas: " + `t.path`; `<FileTree aria-label="Project file tree"` (the `canvas-list` element); `DirRow`/`DsFolderRow`/`FileRow`/`CanvasRow`/`Sidebar` each contain `<FileTreeItem` |

The other source-reading tests named by the survey (`config-projection`, `comment-relay-origin-gate`, `export-format-scope-coherence`, `history-preview-routing`, `tree-expansion`, plus `acp-branch-guard` and `exporters/degraded-propagation`) pin code shapes such as function bodies and message branches, not DOM hooks, so they are not listed per hook here.

## Dangling consumers

Consumers that target a hook no producer emits today. Each one is a test, spec or spotlight that fails, or passes for the wrong reason.

| Hook | Consumer | What happened | Effect |
| --- | --- | --- | --- |
| `[data-tour="menubar-file"]` | whats-new `ai-media-generation` step 0 | Never emitted. The File menu trigger carries `data-testid="menu-file"` and no `data-tour`. | Spotlight shows centred, pointing at nothing. |
| `.dc-media-toast` | `e2e:canvas-text-editing`, test "persistence: mixed <p> gets NO dead-end editor" (double-clicks a mixed text node inside the canvas frame and expects a toast containing `/design:edit`) | Removed in `d50954df2` (2026-09-11, "stack notifications and contain export diagnostics"). An embedded canvas now posts `{dgn:'canvas-notice'}` and the hint renders as a shell notice (`notice-<id>`, `.maude-notice`) in the top document, outside the frame the test is switched into. | That test fails at `expect(toast.exists).toBe(true)`. |
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

- **Producers.** 338 `data-testid` hooks (275 static, 63 patterns) from 359 emit sites, plus 15 `data-tour` anchors from 16 emit sites. 154 testids and 15 anchors have at least one consumer; the other 184 testids are emitted but nothing outside their component targets them yet.
- **Other selectors.** 120 non-testid selector entries (classes, `aria-label`s, roles, data attributes, accessible-name locators) that consumers target.
- **Consumers.** 136 files reference at least one hook (691 hook–file pairs); 68 of them reference a `data-testid`. By kind: test 50, e2e 22, spec 21, bin 17, runner 7, test-e2e 6, e2e-mp 4, tour 3, e2e-helper 2, app.jsx 1, skill 1, frame-probe 1, whats-new 1.
- **Spotlights.** 26 What's New targets: 10 live, 14 need a shell state, 1 dangling, 1 unreachable.
- **Dangling consumers.** 7 hooks with no producer (listed above), plus the unreachable spotlight.
