# F — Codebase survey for the Maude v2.0.0 client reshell

Read-only survey, repo `/Users/iagh/git/personal/maude` @ `6dcfc02a` (main, clean), 2026-10-08.
All paths are repo-relative. `app.jsx` = `apps/studio/client/app.jsx` (17,444 lines).

---

## 1. Client architecture today

### 1.1 Files and sizes

- `app.jsx` has **17,444 lines**. The backlog's T7–T10 text says "15,936", so the file has grown about 1.5k lines since 2026-08-19.
- `client/panels/` holds 25 `.jsx` panels plus 18 helper `.js` files. The largest:

  | File | Lines |
  | --- | --- |
  | `ChatPanel.jsx` | 2,325 |
  | `TimelinePanel.jsx` | 2,259 |
  | `SettingsPanel.jsx` | 1,457 |
  | `SyncPanel.jsx` | 1,190 |
  | `CloudBar.jsx` | 1,054 |
  | `GitPanel.jsx` | 1,026 |
  | `RepoBranchSwitcher.jsx` | 796 |
  | `OnboardingWizard.jsx` | 642 |
  | `DiffView.jsx` | 619 |

- Other modules already split out of `client/`: `inspector-controls.jsx` (781), `report-bug.jsx` (709), `export-center.jsx` (567), `photo-knobs.jsx` (435), `generate-dialog.jsx`, `share-dialog.jsx`, `embed-view.jsx`, `file-tree.jsx`, `tree-row-menu.jsx`, `whats-new.jsx`, `tour/{overlay.jsx, usage-tour.js, collab-tour.js, quick-setup-tour.js}`, and `command-palette-match.js`.
- Imports into `app.jsx` are at lines 6–152. Panels come in at `app.jsx:56-85`. Shared notifications come from `../notifications.tsx` (`app.jsx:137`).

### 1.2 Regions still defined inline in `app.jsx`

| Region | Defined at | Notes |
| --- | --- | --- |
| `DockSlot` + `DOCK_PANELS` (tree, layers, inspector, comments, changes, sync, assistant) | `:194-244` | Configurable left/right docking (`PANEL_SIDES_DEFAULTS` `:203`). v2 removes this. |
| `CommandPalette` (⌘K) | `:889` | Actions: `paletteActions` useMemo `:15754`. Matcher: `command-palette-match.js`. Toggled at `:15494`. |
| `AssetPicker` | `:1244` | Replace-media picker. |
| `ExportDialog` | `:1559-2216` | |
| File tree: `DirRow` / `DsFolderRow` / `FileRow` / `CanvasRow` / `Tree` / `Sidebar` | `:2224-3440` | `Sidebar` is at `:2907`. Mounts `RepoBranchSwitcher` (bottom dock). |
| `CollapsedRail` | `:3441` | Shown when the left slot is empty. |
| `HelpModal` | `:3461` | |
| `SHORTCUT_GROUPS` + `ShortcutsOverlay` | `:3786`, `:3860` | A static list. **There is no shortcut registry.** Keys are hard-coded in about 15 separate `keydown` listeners (`:412, 1290, 1682, 3467, 3869, 3937, 4496, 6429, 9699, 11668, 15259, 15710`); the main global handler is at `:15468`. |
| `MENU_NAMES` = File / Edit / View / Selection / Tools / Help | `:3926` | **Six** in-app menus. Dropdowns are `ViewDropdown :3946`, `HelpDropdown :4053`, `SelectionDropdown :4082`, `ToolsDropdown :4101`, `FileDropdown :4139`, `EditDropdown :4171`. `DROPDOWN_MENUS` is at `:4451`. |
| `Menubar` | `:4218-4766` | testid `menubar` `:4507`. Brand at `:4511`. Cloud "← Dashboard" + project name at `:4523-4545`. Assistant toggle `:4717`, share button `:4728`, report-bug button `:4733`. Presence avatars are passed in as a prop (`:16316-16332`). |
| `Viewport` | `:4767` | Canvas iframes. testid `canvas-frame` `:4916`. Loading/error states `:4940-4992`. Empty-state quick setup `:4883`. |
| `TokenLadder` / `TypeLadder` / `SystemView` / `Gallery` | `:5049-5263` | The design-system tab (`SYSTEM_TAB='__system__'` `:158`). |
| `StatusBar` | `:5264-5473` | testids `statusbar`, `statusbar-sync`, `open-changes`, `open-sync`, `statusbar-version`. Also holds the theme toggle (`.st-sb-theme`) and selection text (`.st-sb-sel`). |
| `CommentsPanel` | `:5474` | |
| `CloudRoleBanner` / `UpdateBanner` / `SyncBanner` | `:5671-5833` | |
| Inspector: CSS vocabulary consts, `ColorPicker`, `TokenPopover`, `GridTracksEditor`, `CssKnobs`, `LayerRow`, `InspectComputed`, `ArtboardKnobs`, `InspectorPanel` | `:5834-10035` | About 4.2k lines. `CssKnobs` alone is `:6760-8376`. Inspector tabs: `inspect` / `css` / `layers` / `photo` (state at `:10781`). |
| `App()` | `:10036-17443` | About 7.4k lines. Render root `:16183`. `createRoot` `:17444`. |

The render order in `App` (`:16183-17440`) is:

1. Root `<div className="maude" data-theme>`.
2. `OnboardingWizard`, the banners, `SyncConsentDialog`, `NotificationHost`, `WhatsNewToast`, `ExportToast`, and the git-lifecycle banner.
3. `.st-shell`, containing `Menubar` and `.st-body`. Inside `.st-body`: `CollapsedRail`, the left `DockSlot` (`ChatPanel` stays always-mounted when docked left), `PanelGrip`, `.main` with `Viewport`, the right `DockSlot`, and `TimelinePanel` (bottom).
4. `StatusBar`.
5. Modals: `CommandPalette`, `ExportDialog`, `SettingsPanel`, `GenerateDialog`, `AssetPicker`, `StickerPicker`, `DiffView`, `ShortcutsOverlay`, `HelpModal`, `ReportBugDialog`, `WhatsNewPanel`, `ExportPanel`, `ReadinessDialog`, `IntroVideoDialog`, `SetupChecklistDialog`, `BrandUploadPanel`, `FigmaImportPanel`, `TourOverlay`.

Panel bodies are chosen by `renderPanelBody(id)` at `:15964`.

### 1.3 State

- **Everything lives in `App()` local state.** There are **160 `useState`** calls and no React context in `app.jsx` (`createContext` returns nothing). Shared logic goes through prop drilling or hooks: `useExportCenter` (`export-center.jsx:78`), `useWhatsNew` (`whats-new.jsx:45`), `useSetupReadiness`, `useTreeExpansion`, `useRowMenu`, `useTreeDrag`. `Menubar` alone takes about 70 props (`:16219-16333`).
- **Config:** `fetch('/_config')` at `:10460` and `:11046`. `viewerMode = !!cfg.readOnly` (`:10458`). `cfg.cloud` signals the browser/cloud shell. `isNativeApp()` comes from `client/github.js` and gates native-only UI such as the Assistant, the quick-setup tour and native pickers.
- **WebSocket:** `new WebSocket(.../_ws)` at `:12223`. It carries file-change, sync, AI-activity and git-lifecycle events.
- **localStorage keys.** There are 40+ keys, using a mixed `mdcc-*` / `maude-*` prefix:
  - Shell: `mdcc-theme`, `mdcc-show-hidden`, `mdcc-sidebar-open`, `mdcc-minimap-visible`, `mdcc-zoomctl-visible`, `mdcc-annotations-visible`, `maude-auto-open-inspector`, `maude-cp-mode`, `mdcc-panel-sides`, `mdcc-layers-mode` (`:159-213`); `maude-sb-w`, `maude-rp-w` (panel widths).
  - Tours and hints: `mdcc-usage-tour-seen`, `mdcc-collab-tour-seen`, `maude-mode-hint-seen`, `maude-browse-hint-seen`, `mdcc-tour-nudge`.
  - What's New: `mdcc-whatsnew-seen`, `mdcc-whatsnew-toast-dismissed`.
  - Other: `mdcc-settings-tab`, `mdcc-sections-expanded`.
  - Sync: `maude-sync-consent`, `maude-sync-notice-ack`.
  - Chat: `maude-acp-model`, `maude-acp-effort`, `maude-acp-picks`, `maude-acp-transcript-view`.
  - Identity: `maude-install-id`, `maude-hub`.
- **Disk-durable preferences:** `/_api/ui-prefs` writes `~/.config/maude/prefs.json` (`app.jsx:178-191`; schema in `apps/studio/ui-prefs.ts:32-66`): `theme`, `minimap`, `zoom`, `annotations`, `autoOpenInspector`, `panelSides`, `layersMode`. **Drift:** client `DOCK_PANELS` includes `sync`, but `ui-prefs.ts:20-27` `DOCK_PANEL_IDS` does not.

### 1.4 Styles and tokens

- **Entry:** `client/styles/_index.css`. It declares `@layer reset, tokens, layout, shell, components, utilities` and imports `0-reset`, `1-tokens`, `1-tokens-maude`, `2-layout`, `3-shell`, `3-shell-maude` (3,158 lines), `4-components`, `4-components-maude`, `5-maude-overrides`, `6-acp-chat` (2,042), and `5-utilities`. Lightning CSS bundles it into `dist/styles.css` (`build.ts:205-209`, DDR-014).
- **`client/styles.css`** (1,264 lines, the legacy zinc `--u-*` ladder) is **not** the bundle entry. It looks like dead weight to delete.
- **Two coexisting token systems:**
  1. Legacy `:root` `--u-*` amber/zinc in `1-tokens.css`.
  2. The **old `maude` DS** ladder ("Plan B") in `1-tokens-maude.css`, lifted verbatim from `.design/system/maude/colors_and_type.css` and scoped to `.maude[data-theme="dark|light"]` (`1-tokens-maude.css:1-30`).

  The Plan B notes say "once the last legacy chrome rule is gone… delete `1-tokens.css`". That never finished. `5-maude-overrides.css` restyles legacy surfaces in place (HelpModal, tour, What's New, SystemView, CommentBar).
- **maude-v2 tokens** are scoped `.maude-v2[data-theme="light"|"dark"]` (`.design/system/maude-v2/colors_and_type.css:25,109,196,261`), with light declared first. The v2 component classes (`.island` with `backdrop-filter`, `.btn`, `.chip`, `.seg`, `.row-item`…) are in `preview/_components.css`. The kit `.design/ui/v2/_kit.tsx` (1,577 lines) is **static mocks** (spans and divs, no real buttons, `_kit.tsx:17-21`). It is a visual and spec reference, not liftable runtime components.
- **Theme application:** `readInitialTheme()` `:325`; `<html data-theme>` sync `:11958`. The theme is posted to every iframe as `{dgn:'theme'}` (`:11974`, `:14193`).
- **Fonts:** `client/index.html` loads Google Fonts (Inter, Inter Tight, JetBrains Mono) and `/_client/styles.css` + `/_client/client.bundle.js`.

### 1.5 Build and release rules

- `build.ts` builds `client/app.jsx` into `dist/client.bundle.js` as **ESM**, not IIFE: Bun IIFE + minify + React 19 hits a TDZ (`build.ts:116-137`). Minification is on in `--release` (`:134`).
- `MAUDE_SKIP_CLIENT_BUILD=1` ships the committed bundle (`:531-560`). `MAUDE_SKIP_RUNTIME_BUILD=1` pins `dist/runtime/*.js` (`:579-588`).
- The committed bundle is **2,156,770 B** minified (5,689 lines) and `styles.css` is 301 KB. CLAUDE.md's "250 KB release artifact" figure is stale.
- `client.bundle.js` is **rebuilt at package time**. The committed copy is not what ships.
- Rule: after editing `client/**`, run `cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release` and commit `dist/client.bundle.js` + `dist/styles.css`.

---

## 2. Canvas-side (iframe) surfaces

The canvas runs on a **separate, untrusted origin** (DDR-054, served by `startCanvasServer`). The shell talks to it only through `postMessage({dgn:…})`, plus `/_ws` and the canvas-safe API allowlist.

- **`apps/studio/canvas-lib.tsx`** (4,615 lines) is the authoring API: `DesignCanvas :1791`, `DCSection :2297`, `DCArtboard :2395`, `DrawProof`, `PhotoLayer`, `DCPostIt :3656`, `DCMiniMap :3815`, `DCZoomToolbar :3954`, specimen helpers, and motion helpers. It also holds the viewport controller (`useViewportController :1090`, `computeFit :727`) and `window.__maudeCanvasRects()` (after `:2800`). `ENGINE_CSS` (`:298+`) styles the workspace plane with the `--maude-chrome-*` tokens.
- **`apps/studio/canvas-shell.tsx`** (4,644 lines) holds the in-canvas editor chrome. `CanvasShell :709` / `CanvasCore :773` mount, at `:3478-3507`:
  - `AnnotationsLayer` (whiteboard / annotations v2, `annotations-layer.tsx` + `annotations-*.ts`)
  - **`ToolPalette`**
  - marquee overlays, `HoverHalo`, `SelectionHalos`, resize/spacing/grid-track handles, `ReorderDrag`, `LayersLiveSync`, `GroupBbox`, `MeasureOverlay`
  - `ContextualToolbar` and `MultiArtboardToolbar`
  - `SnapGuideOverlay`, `PhotoPreviewBridge`, `UndoHud`, `CursorsOverlay`, `AiBanner`, `ParticipantsChrome`

  `HUD_TOKENS_CSS` (`:160-200`) **hard-codes old-maude OKLCH values** (accent hue 268, neutral hue 255) for in-iframe chrome under `:root[data-maude-theme]`. **v2 must re-skin this separately**, because the shell CSS does not reach the iframe.
- **Tool palette** (`apps/studio/tool-palette.tsx`, 663 lines): bottom-centre floating toolbar inside the iframe (`.dc-tool-palette`, `:39+`). It has:
  - navigate tools V/H/C, draw tools B/R/O/A/E with a shape popover, Insert (Div/Text/Image), Stickers, Export;
  - **the mode toggle Preview · Edit · Present**, testids `palette-mode-preview|edit|present` (`:518-545`).

  Mode state (`CanvasMode = 'preview'|'edit'`) is owned **in the iframe** by `ToolProvider` (`use-tool-mode.tsx:55,151-178`). Present enters by posting `{dgn:'present-enter'}` up to the shell (`tool-palette.tsx:547`). The shell sets `is-present` on `.maude` (`app.jsx:16185`), and Esc exits (`:15476`).
  - **v2 implication:** v2 moves the mode switch into the shell Share cluster and splits it into two bottom toolbars (Edit vs Preview/annotate). That needs a new shell→canvas `set-mode` message plus a canvas→shell mode echo. `tool-set` and `view-chrome` exist today; `set-mode` does not. Alternatively, keep the bottom toolbars in-iframe and drive only the mode from the shell.
- **Selection → inspector bridge.** Canvas → shell messages include `select-set` / `selection-clear` / `layers-tree` / `open-inspector` / `request-layers`. Shell → canvas messages include `apply-style` / `record-edit` / `select-by-id` / `force-clear` / `undo-barrier` / `apply-edit` (with `apply-edit-result` coming back).
  - Listener: `app.jsx:13300-14450`. Senders: `:10116-10180`, `:14415-14446`.
  - Selection model: `dom-selection.ts`, `use-selection-set.tsx`.
  - Full message vocabulary in the canvas sources: active-artboard, ai-activity, comment-compose, comments-set, delete/duplicate/rename/resize/set-artboard-kind-request, edit-text, export-capture*, export-selection, freeze-and-set-kind, insert-image/sticker/annotation-media, locked-set, open-sticker-picker, open-timeline-request, op-toast, paste/copy-style, photo-busy, present-enter, reorder*, theme, tool-cursor, tool-set, undo/redo, view-annotations, view-chrome, zoom.
- **Artboard chrome and the label-strip bug.** `DCArtboard` renders `<article class="dc-artboard">` with a `<header class="dc-artboard-label sku">` (a button when positioned; `canvas-lib.tsx:2602, 2684, 2709`) followed by `.dc-artboard-body` (`flex:1`).
  - The label strip (`:426-436`: 6px+6px padding, 10px font, 1px border, so about 24px) is **inside** the article.
  - When `fixed`, the article gets `height: rect.h` (`:2665`), so the body is about **24px shorter than the declared height**. This is the known bug in `.ai/plans/notes/v2-open-questions.md:40`.
  - The unpositioned fallback has the same shape (`:2598-2600`).
  - Fix options: move the label outside the article as a world-coord sibling (like `ArtboardGuidesOverlay`), or add the label height to the article in fixed mode. Both touch `__maudeCanvasRects`, `computeFit` and export capture.
- **Artboard kinds** are badged in the label (`data-dc-kind`, kind chip, video badge `:2730`). Read-back attrs for the Inspector are at `:2575-2596`.
- **Stickers:** palette → `{dgn:'open-sticker-picker'}` (`tool-palette.tsx:628`) → shell `StickerPicker` (`app.jsx:13858`, `:17312`) → `{dgn:'insert-sticker'}` (`:15406`). Served by `/_api/stickers` and `/_stickers/`.
- **Comments:** the shell-owned `canvas-comment-mount.tsx` (separate bundle, `build.ts:175`), `comments-overlay.tsx`, and `/_comments`.
- **Minimap / zoom HUD / annotations visibility** are toggled from the shell via `view-chrome` / `view-annotations` (`app.jsx:11802-11815`).

---

## 3. Server/API surfaces the v2 UI will reuse (`apps/studio/http.ts`, 6,364 lines)

| Group | Routes | Purpose |
| --- | --- | --- |
| Boot/config | `/_config`, `/_health`, `/_index-data`, `/_system-data`, `/_active`, `/_canvas-state`, `/_hmr`, `/_ws` | Project config projection (readOnly, cloud, designRoot); canvas index for tree and search; DS data; active selection; per-user camera; HMR. |
| Canvases/files | `/_api/canvas` (`:2654`, create + soft-delete), `/_api/canvas-meta`, `/_api/canvas-source`, `/_api/fs-move`, `/_api/fs-mkdir`, `/_api/tree-state` (per-user disclosure), `/_api/toggle-hide` | Canvases panel and file operations. |
| Editing | `/_api/edit-css` `/edit-text` `/edit-attr` `/edit-array-src` `/edit-scope`; `/_api/insert-element` `/insert-artboard`; `/_api/duplicate-*`, `/_api/delete-*`, `/_api/reorder(-revert)`, `/_api/resize-artboard`, `/_api/set-artboard-{label,kind,hug,style,guides,print}`, `/_api/convert-to-absolute`, `/_api/detach-component`, `/_api/component-map` | Inspector and canvas edits. |
| Comments | `/_comments`, `/_comments-all` | Thread CRUD; pins. Viewer-writable. |
| Annotations | `/_api/annotations`, `/_api/annotations/ops` | Whiteboard board + op batches (canvas-safe). |
| Assets/import | `/_api/assets` (`:4320`, AssetPicker list), `/_api/asset` (+ `chunk-start` / `chunk` / `chunk-finish`), `/_api/import-asset`, `/_api/import-brand` (`:4841`), `/_api/figma/{connect,status,probe,import,explode}`, `/_api/stickers`, `/_api/photo-edit` | v2 Assets tab and import flows. |
| Export | `/_api/export` (`:4943`), `/_api/export-jobs` (+ `/download`), `/_api/export-history`, `/_api/export-assemble`, `/_api/export-warmup` | Export sheet and export center. |
| Git/history | `/_api/git/{status,log,diff,commit,push,pull,fetch,branch,branches,checkout,discard,fold,resolve}`, `/_api/git-user`, `/_api/git-committers`, `/_api/project/{history,restore,undo,conflict,ai-action}`, `/_api/github/{identity,repos,clone,create-repo,create-project,invite}` | Version history (⌥⌘H), save/publish, branch switcher, held AI stage. |
| Sync/cloud/hub | `/_sync-status`, `/_api/sync/{settings,ownership,resync,offline,trash,cancel-assets}`, `/_api/cloud/{status,signin/start,signin/poll,signout,projects,attach,attach/code,detach,history}`, `/_api/hub/link`, `/_api/workspace/{sign-in,disclosure}` | Share cluster, Diagnostics › Sync, Trash (`/_api/sync/trash` `:3334`). |
| AI/ACP | `/_api/acp/{chat,chats,status,running,activity,focus,attachment}`, `/_api/ai{,/start,/heartbeat,/end}`, `/_api/claude/{install,install-status,signin,signin-status,signin-cancel}` | AI chat panel, AI setup status, "agent editing" banner. |
| Generate | `/_api/generate/{providers,keys,prefs,audio-search,audio-reuse,keyframe-model,whisper-model}`, `/_api/generate-jobs`, `/_api/footage`, `/_api/timeline-media`, `/_api/clip-edit`, `/_api/comp-clips`, `/_api/insert/remove/reorder/retime-sequence` | Settings › Connections/Advanced; video timeline. |
| Settings/diagnostics | `/_api/ui-prefs` (`:5433`), `/_api/setup-readiness` (`:1667`), `/_api/preflight` (`:1653`), `/_api/debug-bundle` (`:2036`), `/_api/report` + `/_api/report-fallback` (`:2138`), `/_api/shell-shot` (`:2068`) | Settings, Diagnostics submenu, Report a bug. |
| What's New | `/_api/whats-new` (`:2028`) | In-app feed. |
| Project create | `/_api/project/create-local`, `/_api/projects/prepare`, `/_api/design/init` | Home / Create flow. |

Two route gates to respect:

- **`READ_ONLY_ALLOWED_WRITES`** (`http.ts:456-500`): viewers may write ui-prefs, tree-state, export*, report, `/_comments`, cloud sign-in, and `git/fetch`.
- **`CANVAS_SAFE_API`** (`http.ts:6216-6231`): the canvas-origin allowlist. Any new route the canvas must reach goes in it and in the `server.ts` routes map.

---

## 4. Desktop shell (`apps/desktop/src-tauri/src/`)

- **`menu.rs`** (71 lines) defines the native menu bar:
  - **Maude**: About, Check for Updates…, Quit
  - **File**: New Project… ⌘N, Open Project… ⌘O
  - **Edit**: predefined undo/redo/cut/copy/paste/select-all. These are load-bearing for WKWebView clipboard, `menu.rs:56-66`.
  - **Help**: Report a Bug…

  Handlers in `lib.rs` emit `menu://new-project` and `menu://report-bug` and run the open-project flow. Note that native ⌘N (New Project) and the CONTRACT's ⌘N (New canvas) / ⇧⌘N (New project) **conflict**, so the accelerator must move.
- **`lib.rs`** (692 lines) has a single `"main"` window. It calls `get_webview_window("main")` at `lib.rs:420` (single-instance focus) and `:599` (boot navigate). `tauri.conf.json` `app.windows` has one window: 1280×800, `decorations: true`, no `titleBarStyle` or `tabbingIdentifier`. The CSP allows `http://localhost:*` frames.
- **`sidecar.rs`** (1,302 lines) runs a pool of project servers: `MAX_INSTANCES = 3` (`:145`), `spawn_for :272`, `switch_project :781` (navigates `"main"` at `:843`, loopback-guarded), `has_running_chat :873`, `reap_instances :948`, and the respawn navigate at `:664`.
- **The project-tabs plan has NOT been implemented.**
  - `windows.rs` and `profiles.rs` do not exist.
  - There is no `tabbing_identifier`, `data_store_identifier` or `WebviewWindowBuilder` anywhere in `src-tauri/src`.
  - `MAX_INSTANCES = 3` already existed before the plan; the plan cites it as current state.
  - The plan file (`status: active`, tasks T1–T14, all acceptance boxes unchecked, `:306-319`) has a single commit, `31d52bff docs(plan): …`.
  - Later commits on `src-tauri/src` (`2e1aa732`, `f88ab3f4`, `94cee8a7`, `aa99e609`, `7d22dbbd`, `8d143f0e`) are unrelated fixes.
  - The plan's UI half (T10 "Open in new tab" in `RepoBranchSwitcher`, T11 profile chip in `IdentityBar`/`CloudBar`, T12 boot-window tabbing) is exactly what v2 re-designs. `v2-redesign-approach.md` phase 5 says to rewrite the plan's UI part for the v2 shell and keep the Rust/backend part.
  - v2-open-questions Q1 recommends **option A: native macOS window tabs** for 2.0.
- **Home tab.** The kit has `TABS.home`, but the plan has no "Home" window concept: it navigates every window to a project's sidecar origin. A Home/launcher tab needs either a project-less origin (the splash `apps/desktop/src/index.html`?) or a Home route served by some sidecar. **This is an open architecture gap.**

---

## 5. Tests and gates

- **Desktop e2e** (`apps/desktop/e2e/`, WebdriverIO + `@wdio/tauri-service`, debug build only; the WebDriver plugin is `#[cfg(debug_assertions)]`).
  - 22 scenarios: `acp-ask-user-question`, `acp-capability-picker`, `acp-cold-start`, `acp-write-scope`, `app-boots-and-renders-canvas`, `backspace-no-active-canvas-no-hang`, `canvas-text-editing`, `cloud-attach`, `export-formats`, `file-tree-move`, `git-branch-switcher`, `git-lifecycle`, `git-switch-repos`, `onboarding`, `report-bug-dialog`, `s20-deployment`, `share-link`, `shell-parity`, `sidecar-respawn-canvas-switch`, `splash-recovers-after-return-to-entry`, `team-project`, `timeline-manual-cut`.
  - Plus `e2e/multiplayer/{surface,cloud-entry,selfhost-entry}.e2e.ts`.
  - 11 `wdio.*.conf.ts` files; dedicated confs are excluded from the default glob (E3).
  - Run via the `desktop-e2e` skill, or `pnpm test:e2e:desktop:build` then `pnpm test:e2e:desktop[:git|:cloud|:parity|…]`.
- **Studio bun tests** (`apps/studio/test/`, 437 files).
  - UI-relevant: `mode-toggle.test.tsx`, `tool-palette.test.tsx`, `tool-palette-insert-anchor`, `use-tool-mode`, `command-palette-enter`, `tour-overlay`, `notifications`, `whats-new`, `file-tree-navigation`, `tree-expansion`, `shell-accessibility`, `shell-text-contrast`, `embed-mode`, `read-only-gate`/`read-only-role`, `canvas-origin-gate`, `csp-canvas-shell`, `presence-*`, the `annotations-*` family, `chat-*`/`acp-*`, `sync-panel-surface`, `source-conflict-*`, `history-preview-*`, `team-projects-empty`.
  - **11 tests grep `app.jsx` source text** and will break on a move even when behaviour is unchanged: `cloud-history-posture`, `cloud-shell-surfaces`, `cloud-managed-save-surfaces`, `config-projection`, `comment-relay-origin-gate`, `export-format-scope-coherence`, `history-preview-routing`, `git-cloud-posture`, `shell-accessibility` (parses `app.jsx` AST), `sync-panel-surface`, `tree-expansion`.
  - `shell-text-contrast` reads `styles/3-shell-maude.css` directly.
  - About 40 tests import `client/panels/*` helpers.
- **Boot gates:**
  - `scripts/check-client-boots-source.mjs` runs in CI via `.github/workflows/client-boot.yml`, path-filtered to `client/**`, `canvas-lib.tsx`, `build.ts` and `dist/**`. It builds `--release`, boots the source server in Chromium with a `__TAURI__` stub, asserts `#root` mounted, and reports committed-bundle drift without failing.
  - `apps/desktop/scripts/check-client-boots.mjs <.app>` runs in `build-desktop.yml`.
  - `check-bundle-completeness.mjs --smoke` is also run on the packaged app.
- **Quality gates** (`.ai/workflows.config.json` `quality`):
  - `lint`: `pnpm lint` (biome)
  - `format`
  - `typecheck`: `bunx tsc --noEmit` + `check-tsc-coverage.sh`. tsconfig includes `**/*.jsx` with `allowJs` but **no `checkJs`**, so the client is not type-checked.
  - `tests`: `pnpm test` + the sync lane
  - `build`: site
  - `parity`, `tarball`, `tokens` (`site sync:tokens:check`; source is the **old `maude`** DS via `site/scripts/sync-mdcc-tokens.mjs`), `site-content`
- **Biome excludes the client:** `biome.jsonc:27` `"!**/apps/studio/client"`. This is backlog item T3.
- **Scenario skill:** there is no repo `.claude/skills/scenario`. Use the `flow:scenario` plugin skill plus `.claude/skills/desktop-e2e/SKILL.md`. Config: `platforms: ["web-desktop"]`.
- **testid convention:** `<area>-<thing>[-<id>]`, kebab-case. Established hooks: `canvas-list`, `canvas-row-<slug>`, `canvas-frame`. Paths use `pathTestIdSlug` (`app.jsx:2405`).
- **Tour and spotlight selectors are a second contract:**
  - `data-tour` anchors (11 in `app.jsx`) are targeted by `tour/*.js`: sidebar, viewport, menus, inspector, whatsnew, help, save-local, publish, pull, status.
  - `apps/studio/whats-new.json` has 26 spotlight `target`s, including `.st-layer-eye`, `.st-cp-*` and `[data-tour='menus'|'brand'|'status'|…]`.

### Testids and selectors that v2 will move or remove

| Selector (owner) | Used by |
| --- | --- |
| `menubar` / `menu-*` / `menu-file` | `shell-parity`, multiplayer `surface`, `share-link` (`menu-ui`) |
| `statusbar`, `statusbar-sync`, `statusbar-version`, `.st-sb-sync`, `.st-sb-theme`, `.st-sb-sel`, `.st-sb-title` | `shell-parity`, `team-project`, multiplayer `surface` |
| `open-changes`, `open-sync` (status bar chips) | `git-lifecycle`, `team-project`, `cloud-attach` |
| `dock-tab-*` (docking removed) | none directly; panels via `renderPanelBody` |
| `assistant-toggle` (menubar) | all four `acp-*` scenarios; quick-setup tour |
| `share-btn` (menubar) | `share-link` |
| `report-bug-toggle`, `.st-dd-item`, `.st-iconbtn`, `[data-tour="help"]` | `report-bug-dialog` |
| `repo-switcher-trigger` / `-popup` / `switcher-*` (bottom dock, likely replaced by the project pill/menu) | `git-branch-switcher`, `git-lifecycle`, `git-switch-repos`, `team-project`, `cloud-attach` |
| `cloud-back`, `cloud-project-name`, `cloud-account`, `cloud-signout`, `view-only-stamp` | `cloud-attach`, cloud parity |
| `palette-mode-*` (iframe; mode moves to the Share cluster) | `mode-toggle.test.tsx` |
| `[data-tour="viewport"]` | `sidecar-respawn-canvas-switch` |
| `onboarding-wizard`, `ob-*` (02 Onboarding redesign) | `onboarding`, `s20-deployment`, `team-project` |
| `export-*` (09 Export redesign) | `export-formats` |
| `timeline-*` (07 Video redesign) | `timeline-manual-cut`, multiplayer `surface` |
| `inspector-panel`, `inspector-open` | `shell-parity` |

**Probably stable** if v2 re-emits them, which is recommended as a hard rule: `canvas-list`, `canvas-row-*`, `canvas-frame`, `canvas-search`, `tree-*`, `git-panel`, `sync-panel`, `chat-*`, `share-dialog`, `report-bug-dialog`.

---

## 6. Hardening backlog overlap (`.ai/plans/feature-post-1.0-hardening-backlog.md`)

Key: **(a)** prerequisite or directly needed · **(b)** adjacent / optional · **(c)** unrelated to v2.

| Item | Class | Reason |
| --- | --- | --- |
| Binding block (A7 notices, consent, `_trash`, OIDC, hub-trust) | done | Shipped 2026-08-20; nothing open except the B14/B15 scope half, which is a sync feature, so (c). |
| T21′ prerelease channel | (c), recommend upgrading to (b) | No v2 code needs it. It is the only way to soak a big-bang 2.0 before the auto-updater pushes it to every install (`bump-version.sh:77` rejects rc versions today). |
| T22 nightly ecosystem-verify | (c) | npm/install/upgrade CI. Its "built-`.app` boot legs" would help, but `check-client-boots` already covers the blank-app class. |
| **T23 local diagnostics + no-telemetry DDR** | **(a)** | The v2 Diagnostics submenu (Logs, status words, "Copy diagnostic report") is exactly this ring-buffer log + Help ▸ Copy report work. |
| T5b npm trusted publishing | (c) | Release credentials. |
| Full studio suite → required | (b) | The reshell will break about 11 `app.jsx` source-grep tests. Making the suite required makes that visible instead of `continue-on-error`. |
| **T3 remove Biome client exclusion** | **(a)** | New v2 modules land in `client/`. Lint them from day one: do the format-only commit before the reshell, or the diff becomes unreviewable. |
| T5 JSDoc `@ts-check` over `cli/lib` | (c) | CLI only. |
| T2′ cloud/cells type gate, T15c cells → TS | (c) | Cloud infrastructure types. |
| **T6 characterization tests + e2e for panels about to move** | **(a)** | Explicitly the prerequisite for any decomposition. The testid churn table above is its input. |
| **T7–T10 `app.jsx` decomposition** | **(a)** | The reshell must cut along the panel seam anyway. App is about 7.4k lines with 160 `useState`, no context, and a ~70-prop `Menubar`. Do move-and-export first, then replace the chrome. |
| T11 duplication census | (b) | Useful for deciding the shell vs canvas-HUD token sharing. Not blocking. |
| T12 five-environment reachability canary (pnpm, studio bun.lock, sidecar, .app, tarball) | (b) | Only matters if v2 extracts `packages/*`. The backlog says it blocks T13+ content moves. |
| **T13 `packages/tokens`** | **(a) / (b)** | v2 tokens have ≥3 real consumers: shell CSS, iframe `HUD_TOKENS_CSS` (hard-coded values in `canvas-shell.tsx:160`), and site `mdcc-tokens.css` (sync script pinned to the old `maude` DS). The minimum is to retarget `sync-mdcc-tokens.mjs` to maude-v2 and generate the HUD block; full DTCG is optional. |
| T14 `packages/protocol` | (b) | As scoped (runtime-state lists, slug conformance) it does not cover the `dgn:` postMessage protocol, which v2 extends (mode switch). A typed bridge would be a natural extension. |
| T15 crypto-portable, T15b hub COPY-manifest | (c) | Security primitives and hub image. |
| T16 `@maude/ds-css` pilot | (b) | Possible vehicle for shipping maude-v2 `_components.css` to the client; a kill-switch pilot only. |
| **T17 shell vocabulary convergence** | **(a)** | This is the v2 shell's words and classes. CONTRACT.md §1 plus words/voice is the target vocabulary, and the `.st-*` / `--u-*` / `.maude` split is what v2 collapses. |
| T18 handoff `--check` + self-containment | (c) | Handoff CLI. |
| T19 DiffView inversion pilot | (b) | DiffView is a moving panel; trust-boundary review only if it is restructured. |
| T20 TypeScript policy DDR | (b) | Decides whether new v2 client modules are `.tsx` and checked; the client is currently unchecked. Worth deciding before writing about 10k new lines. |
| E1 load-sensitive write-through waits (`canvas-text-editing`) | (b) | Flaky e2e will muddy the v2 regression signal. |
| E-1 five server-booting studio tests race on CI | (c) | Server test timing. |
| D-2 fleet-drill chicken-and-egg | (c) | Cloud release mechanics. |
| S1–S3 DS specimen defects (colors-presence, iconography, commands_overview) | (c) | Old `maude` DS specimens, found 2026-08-19, before maude-v2 existed. They die with that DS. |
| Increment 8, cloud-assets RCA §3/§4, DDR-223 duplicate numbering | (c) | Sync residue and docs hygiene. |

---

## 7. Docs and site

- **Docs root** is `site/content/docs/` (fumadocs). `meta.json` order:
  1. index, getting-started, codex
  2. ---Learn---: cli, design, flow, orchestration, hub, cloud, desktop, share-links, security, config
  3. ---Look up---: commands-design, commands-flow, config-schema
  4. Recipes, Legal
- **`getting-started.mdx`** is CLI-first ("`npm i -g @1agh/maude` is required"). Desktop is only a Callout pointing to `/docs/desktop`.
- **`desktop/index.mdx`** (97 lines) covers install, system requirements, Linux media, what AI editing needs, auto-update, unsigned builds, teams and what's included. This page is the natural seed for the v2 "Getting started = install desktop" page.
- **Marketing site:** `site/app/(home)/` has `page.tsx`, `desktop/` (download page + `download-button.tsx`), changelog, roadmap, whats-new and about. The home CTAs point at `/docs` and `/docs/design` (`page.tsx:104,196`).
- **Old-chrome copy that must change:**
  - `hub/team-projects.mdx:31`: "changes chip in the status bar", "View → History", ⌘⇧G.
  - `hub/workspace.mdx:90`: "the menubar names the project".
  - `design/index.mdx:17,57`: V tool / inspector.
  - `design/print.mdx:17`: Inspector.
  - `getting-started.mdx:96`.
- **Generated and gated content:** `site/lib/{stats,roadmap,whats-new}.json` and `content/docs/reference` are regenerated by the `site-content` gate. `site/app/mdcc-tokens.css` is generated from the old `maude` DS by the `tokens` gate. Retargeting to maude-v2 is a deliberate decision, not drift.

---

## 8. Risks for a big-bang reshell

1. **Minified-only and Tauri-only failures (v0.51.1 class).** A new shell tree means new code paths under `window.__TAURI__` and minification. `check-client-boots` only asserts `#root` has children. It would not catch a mounted-but-broken v2 shell, such as a project pill or menu that is not interactive. Extend the gate to assert a v2 landmark (for example `data-testid="project-pill"`) in both browser and Tauri-stub modes, and run `check-client-boots.mjs` against the built `.app` before every 2.0 rc.
2. **Bundle size and CSS cascade.**
   - The bundle is already 2.16 MB minified and `styles.css` 301 KB, with three token generations coexisting (`--u-*`, `.maude`, and `.maude-v2` next).
   - Running old and new chrome side by side behind a flag roughly doubles CSS. Ship v2 under one root class (`.maude-v2[data-theme]`), and delete `1-tokens.css`, `styles.css`, the `*-maude.css` files and `5-maude-overrides.css` in the same release, or the cascade fights.
   - maude-v2 uses `backdrop-filter` islands floating **over the canvas iframe**. On WKWebView that is a per-frame blur during pan/zoom of `will-change` artboards. Measure with `maude design perf --engine safari --studio` before committing to the material.
3. **Floating panels change viewport geometry.** Today docked panels narrow the iframe. v2 floating panels overlay a full-width iframe, so `computeFit` / zoom-to-fit / reveal (`canvas-lib.tsx:727`, `canvas-shell.tsx:2406-2490`) must learn an **occluded-insets** rect (shell → canvas message), or "fit" lands under panels. Positive side effect: no more mock reflow on panel resize.
4. **Canvas-side chrome is a separate re-skin.** The tool palette, contextual toolbar, HUDs and halos live in the iframe with hard-coded old-maude values (`HUD_TOKENS_CSS`), and the mode toggle state is iframe-owned. Moving Edit · Preview · Present to the shell Share cluster and splitting two bottom toolbars needs new `dgn` messages: `set-mode` and a mode echo. Every new canvas-reachable route needs both allowlists (`CANVAS_SAFE_API` + `server.ts` routes).
5. **Keyboard collisions.**
   - There is no shortcut registry: about 15 `keydown` listeners plus iframe-owned letter keys (V/H/C/B/R/O/A/E).
   - CONTRACT adds ⌥⌘P, ⌥⌘↵, ⇧⌥⌘↵, ⌥⌘H, ⇧⌘C, S, L, and ⌘\.
   - The native menu already binds ⌘N/⌘O to New/Open *Project* (`menu.rs:41-46`), while CONTRACT wants ⌘N = New canvas.
   - Build a single registry first (it also feeds the Search ⌘K and the shortcuts overlay).
6. **E2E testid churn.** About 12 of 22 desktop scenarios plus `multiplayer/surface` and `mode-toggle.test.tsx` touch chrome that moves (see the §5 table). There are also 11 `app.jsx` source-grep tests, the tour `data-tour` anchors, and 26 What's New spotlight selectors, which point at historical entries' DOM. Treat testids as API: carry them onto the v2 equivalents where the meaning survives, rewrite tours, and mark old spotlight entries as non-replayable.
7. **Preference keys.**
   - About 40 localStorage keys plus the disk `prefs.json` (`panelSides`, `layersMode`) encode the docking model that v2 deletes.
   - v2 needs a versioned migration (read old, write new, ignore unknown) in both `ui-prefs.ts` and the client.
   - Native tabs make this worse: localStorage is per origin (port), and the 4399+ port ladder is assigned in spawn order, so a project can inherit another project's prefs. Only `data_store_identifier` (macOS 14+) fixes that.
   - Tour/hint "seen" flags will suppress v2 onboarding for upgraders unless they are re-keyed.
8. **One client, several shells.** The same bundle renders in:
   - the desktop `.app` (Tauri),
   - local browser `maude design serve`,
   - the cloud cell in a browser tab (`cfg.cloud`: no native tabs, needs the "← Dashboard" escape and project name, `app.jsx:4523`),
   - viewer / read-only mode (`cfg.readOnly`: mutating UI absent, comments allowed),
   - embed view (`isEmbedLocation` → `EmbedView`, DDR-242).

   v2's "native macOS tabs + Home" exists only in the desktop shell. The browser shells need the project pill/menu without native tabs or a Home, plus Settings tabs that are hidden in cloud (`SettingsPanel.jsx:963-987`, the `local: true` tabs). `shell-parity.e2e.ts` asserts the shared surface (menubar, statusbar, Inspector/Layers visible to viewers) and must be rewritten as the v2 parity contract, run in both `:parity` and `:parity:cloud`.
9. **Home tab has no backend shape yet.** The project-tabs plan navigates every window to a project sidecar. Home or a launcher needs a decision first: the splash origin or a sidecar-less route. That decision is a prerequisite for T5/T12 of that plan.
10. **Plan drift and concurrent sessions.**
    - `app.jsx` grew about 1.5k lines since the backlog was written. The project-tabs plan's line anchors (for example `app.jsx:9644 App()`, `:4270 menubar`) are stale; actual values are `App()` at `:10036` and `Menubar` at `:4218`.
    - The Syncthing tree has parallel sessions editing `app.jsx`. A big-bang branch against a 17k-line file that other work keeps touching will rebase painfully, which argues for doing T7–T10 move-only commits on main first.
11. **Undecided scope items** that CONTRACT and the canvases draw as if they exist (v2-open-questions §"Features that don't exist today"): links between artboards, presenter view, per-artboard notes, Follow, captions/beat detection, JPG/batch export, and so on. These should be fenced out of the reshell PRD explicitly.
