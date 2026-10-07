# Maude studio client: inventory of user-facing features (v2 redesign input)

This is a read-only inventory. All references below are file:line.

**File legend:**
- `C/` = `/Users/iagh/git/personal/maude/apps/studio/client/`
- `P/` = `/Users/iagh/git/personal/maude/apps/studio/client/panels/`
- `S/` = `/Users/iagh/git/personal/maude/apps/studio/` (canvas-side, rendered inside the canvas iframe)
- `D/` = `/Users/iagh/git/personal/maude/apps/desktop/src-tauri/src/`

**Access codes:**
- **AV** = always visible
- **MENU** = menubar dropdown
- **NMENU** = native OS menu
- **KB** = keyboard shortcut
- **PAL** = ⌘K command palette
- **CTX** = contextual (appears on selection or state, or via right-click)
- **DLG** = modal dialog
- **N-only** = desktop app only
- **Cloud** = cloud browser tab only

---

## 1. App shell, menubar, native menu

**Native OS menu** (`D/menu.rs:20-71`, dispatched in `D/lib.rs:497-535`), NMENU, N-only:
- **Maude menu:** About, Check for Updates…, Quit.
- **File menu:** New Project… (⌘N, opens the create-project dialog in `P/IdentityBar.jsx:169`) and Open Project… (⌘O, native folder picker, offers to set Maude up if there is no `.design`).
- **Edit menu:** Undo and Redo (macOS only), Cut, Copy, Paste, Select All.
- **Help menu:** Report a Bug….

**In-app menubar** `Menubar` (`C/app.jsx:4173`), AV, 6 menus. It supports arrow-key roving and switches menus on hover.
- **File** (`C/app.jsx:4094`), 10 items for editors:
  - New canvas… (N), Assemble dropped clips → video, Export… (⇧⌘E), Share link…, Handoff to production (⇧⌘H)
  - Generate with AI…, Settings… (⌘,)
  - Reload canvas (⌘R), Close canvas
  - Viewers get 6 items.
- **Edit** (`C/app.jsx:4126`): Undo, Redo, Deselect all, Select all annotations (⇧⌘A), plus 6 "New artboard:" presets when a canvas is open (Desktop, Laptop, Tablet, Mobile, A4 print, Letter print).
- **View** (`C/app.jsx:3901`; panel list at `C/app.jsx:4272-4404`): up to 14 checkbox toggles plus 4 zoom actions.
  - Toggles: Project Tree (T), Changes (⌘⇧G; reads "History" in the cloud), Comments Sidebar (⌘⇧M), Show hidden files (H), Layers, Inspector (⌘⇧I), Auto-open Inspector on select, Timeline (⌘⇧T), Assistant (⌘⇧A, N-only; a disabled "in the desktop app" row in Cloud), Annotations (⇧P), Minimap, Zoom controls, Presentation Mode, Show print guides.
  - Zoom: In, Out, Fit (⌘0), Actual size (⌘1).
- **Selection** (`C/app.jsx:4037`): Deselect all, Select all annotations.
- **Tools** (`C/app.jsx:4056`), 11 items under a "Tool palette" header: Browse, Select (V), Hand (H), Comment (C), Pen (B), Rect (R), Ellipse (O), Sticky (N), Arrow (A), Text (T), Eraser (E).
- **Help** (`C/app.jsx:4008`): Keyboard shortcuts (?), Help · commands & flows (F1), Report a bug…, Take the tour, Watch the intro, What's new. Three more are N-only: How sharing works, Quick setup, Check AI editing readiness….

**Menubar right cluster** (`C/app.jsx:4623-4717`), AV:
- Presence avatars: you (git user initials) and a pulsing "Claude · editing" avatar (`C/app.jsx:16223`).
- "VIEW ONLY" stamp for viewers (`C/app.jsx:4625`).
- Cloud: account email plus a Sign out form (`C/app.jsx:4645`).
- Assistant sparkle toggle with busy and unseen states (`C/app.jsx:4668`, N-only).
- Share button (`C/app.jsx:4683`).
- Export jobs badge (`C/export-center.jsx:371`).
- Report-bug icon (`C/app.jsx:4685`).
- What's new megaphone with unseen dot (`C/app.jsx:4695`).
- Mode stamp IDLE / CANVAS / SYSTEM (`C/app.jsx:4706`).
- Active file path (`C/app.jsx:4707`).
- "N ARTBOARDS" count (`C/app.jsx:4711`).
- Project name (`C/app.jsx:4716`).

**Other shell chrome:**
- Cloud "← Dashboard" link and project name (`C/app.jsx:4477`, Cloud).
- **Dock system:**
  - Left and right `DockSlot` (`C/app.jsx:214`) hold 7 dockable panels (`DOCK_PANELS`, `C/app.jsx:189`): Files, Layers, Inspector, Comments, Changes, Sync, Assistant.
  - Each slot shows one panel at a time, with a tab strip when 2 or more panels are docked there.
  - Resize grips (`C/app.jsx:1070`): drag, arrow keys, Home/End, double-click to reset.
  - A collapsed rail with 3 buttons appears when the left slot is empty (`C/app.jsx:3396`).
- **Bottom dock:** Timeline (see section 13).
- **Banners at the top of the window:**
  - `CloudRoleBanner` (`C/app.jsx:5626`, Cloud, "Got it")
  - `UpdateBanner` (`C/app.jsx:5671`: Restart now / Later)
  - `SyncBanner` (`C/app.jsx:5697`: offline, reconnected, diverged, rejected; dismissible)
  - "Repo state changed — reload to sync?" (`C/app.jsx:16117`: Reload / Dismiss)
- Notification/toast host (`C/app.jsx:16113`; `../notifications.tsx`), WhatsNewToast and ExportToast.
- Generic shell prompt dialog with input, Cancel and OK (`C/app.jsx:17120`).
- Presentation-mode "Exit presentation · Esc" button (`C/app.jsx:17095`).
- The native context menu is suppressed across the shell (`C/app.jsx:15658`).

## 2. Canvas list / file tree (Files panel)

`Sidebar` (`C/app.jsx:2862`), docked left by default, toggled with T.

**Header** (`C/app.jsx:3127-3194`):
- "+" new blank brief board
- New folder
- Refresh (⇧⌘R)
- Live dot with "shown / total" canvas count
- Collapse sidebar

**Other parts of the panel:**
- **Inline composer** (`C/app.jsx:3197`): name input plus a ↵ button, in board or folder mode.
- **Search** (`C/app.jsx:3239`): "Search canvases…", reached with / or ⌘F, Esc clears.
- **Sections** (`SECTION_META`, `C/app.jsx:2808`): PROJECT, DESIGN SYSTEM, UI CANVASES, RUNTIME · GITIGNORED, plus custom groups. They are collapsible, each with a count pill, and act as drop targets.
- **Folder row** `DirRow` (`C/app.jsx:2179`): expand/collapse, "⋯" menu, right-click.
- **Design-system folder row** `DsFolderRow` (`C/app.jsx:2252`): expand, plus open the DS view.
- **File row** `FileRow` (`C/app.jsx:2295`):
  - Click a canvas to open it; click a non-canvas file to open a preview overlay (`P/file-preview.jsx`: md, text, image, video, audio, font).
  - Badges: reconstructed/experimental, Figma-imported third-party, git "Unsaved (M/A/D/U)", open-comment count.
  - Actions: "⋯" menu and a trash delete button (`C/app.jsx:2450`).
- `CanvasRow` (`C/app.jsx:2469`) groups a canvas with its sidecars, which are shown only with "Show hidden files".
- **Row menu** (`C/tree-row-menu.jsx:71`; items at `C/app.jsx:2954-3048`):
  - File: Share…, Rename…, Duplicate, Rename (supporting file), Move to… (submenu with a destinations list), Delete.
  - Folder: New folder here, Rename folder, Delete folder.
  - Rename and new-folder use `window.prompt`.
- Drag and drop of canvases between folders (`C/use-tree-drag.js`).
- Full keyboard tree navigation (`C/file-tree.jsx:6`).
- Loading skeleton (`C/app.jsx:2831`).
- Expansion state is persisted per project via `/_api/tree-state` (`C/tree-expansion.js:1-20`).
- **Bottom docks inside the sidebar:**
  - `RepoBranchSwitcher` (`C/app.jsx:3376`, see section 7)
  - `CloudBar` (`C/app.jsx:3385`, desktop only, see section 8)
  - `IdentityBar` (`C/app.jsx:3389`, N-only, see section 15)

## 3. Canvas workspace and toolbar

**Shell side**, `Viewport` (`C/app.jsx:4722`):
- **Empty state** (`C/app.jsx:4805`): brand, a "CANVAS · PROJECT / vX / localhost:PORT" line, onboarding copy, and a contextual "Start quick setup" button (N-only).
- Canvas iframe; only one active canvas is shown.
- Loading card (`C/app.jsx:4939`).
- Load-error card with "Reload canvas" (`C/app.jsx:4895`).
- **Design system view** `SystemView` (`C/app.jsx:5115`), opened with S, the DS row, or the palette:
  - DS picker select (shown when there are 2 or more design systems)
  - Raw `systemDir` path
  - Token ladders by group, type ladder
  - Preview and UI-kit galleries (click to open)
- **Asset picker** `AssetPicker` (`C/app.jsx:1234`), CTX/DLG, opened from Insert ▸ Image or Replace media:
  - Upload…, thumbnail grid, multi-select
  - "Add to artboard" or "Add as annotation" segment, Insert
- **Sticker picker** (`P/StickerPicker.jsx`): search plus a grid, opened from the canvas palette.

**Canvas side** (inside the iframe):
- **Tool palette** (`S/tool-palette.tsx:563`), AV:
  - Mode group: Preview, Edit, Present (`S/tool-palette.tsx:518`).
  - Tools from `DEFAULT_TOOLS` (`S/use-tool-mode.tsx:87`), 13 total: Browse, Select V, Hand H, Comment C, Pen B, Highlighter I, Shape R (6 kinds, `S/tool-palette.tsx:287`), Sticky N, Section ⇧S, Arrow A, Text T, Eraser E.
  - Insert element (Div, Text, Image) at `S/tool-palette.tsx:591`.
  - Stickers (`S/tool-palette.tsx:624`), Export ⌘E (`S/tool-palette.tsx:641`).
- **Right-click menus** (`S/canvas-shell.tsx:1447-2329`; defaults in `S/context-menu.tsx:120-160`):
  - World: Fit/Reset view, Paste artboard, Export project ZIP, Export canvas as separate.
  - Artboard: Theme (DS default, Light, Dark, Follow chrome), Artboard kind (Digital, Print, Web, Video), Duplicate at width (4 widths), Rename, Duplicate, Fit just this artboard, Reset position, Convert layout to absolute…, Open Timeline, Delete artboard, Export this artboard….
  - Element: Add comment, Copy CSS, Copy data-cd-id, Inspect, Edit Photo…, Select layer, Insert ▸ Div / Text / Image…, Replace image…, Convert children to absolute position, Duplicate, Copy style, Paste style, Delete, Hide, Lock, Deselect, Export selection….
  - Multi-select: 6 align commands, 2 distribute commands.
- **Contextual element toolbar** (`S/contextual-toolbar.tsx`), CTX: comment, copy selector, copy id, inspect, 6 aligns, "Tidy up".
- **Other canvas overlays:** minimap, zoom HUD, print guides overlay, undo HUD (`S/undo-hud.tsx`), participants/cursors chrome (`S/participants-chrome.tsx`), AI activity banner (`S/ai-banner.tsx`), measure/snap guides.
- A second, in-canvas export dialog exists in `S/export-dialog.tsx`.

## 4. Inspector (right dock, ⌘⇧I, auto-opens on select by default)

`InspectorPanel` (`C/app.jsx:9274`).
- **Tabs** (`C/app.jsx:9756`): Inspect, Layers (hidden when Layers is a separate panel), CSS, Photo (CTX), plus a close button.
- **Edit-scope strip** (`C/app.jsx:9779`), CTX: "Local · this element only" or "Shared · N places", with a **Detach** button.
- **Inspect tab** (`C/app.jsx:9835`): read-only Pos X/Y, Size W/H, Tag, Class, plus `InspectComputed` (`C/app.jsx:8724`: radius, font, and similar).
- **Layers tab or panel** (`C/app.jsx:9884`; `LayerRow` at `C/app.jsx:8477`):
  - Per row: expand, rename, lock/unlock, show/hide.
  - Drag to reorder or nest. Keyboard: ↑/↓ select, Alt+↑/↓ move, Alt+Shift+↑/↓ move across parents.
  - Component-instance rows are purple, with an on-screen hint line.
- **Artboard knobs** `ArtboardKnobs` (`C/app.jsx:8821`, CTX when an artboard is selected):
  - W/H fields; preset select (screen, breakpoint, or paper depending on kind); Hug/Fixed.
  - Kind select; "Duplicate at width…".
  - Print: Portrait/Landscape and Bleed (mm).
  - Style: background colour or token, body layout select, Padding, Gap. That is about 10 to 12 controls.
- **CSS tab** `CssKnobs` (`C/app.jsx:6715`):
  - Corner toggle between **Advanced** (raw CSS) and **Designer** (Figma vocabulary) at `C/app.jsx:7796`.
  - Designer mode has 11 clusters: Auto layout, Size, Position, Fill, Stroke, Corner radius, Effects, Opacity, Text, Spacing, Media (CTX).
  - Advanced mode has 10 sections: Layout, Grid (CTX), Position, Grid item (CTX), Typography, Spacing, Size, Media (CTX), Appearance, and Advanced (custom CSS property rows plus custom HTML attribute rows; `RawKnob` and `AttrKnob` at `C/app.jsx:8332` and `C/app.jsx:8367`).
  - Each section has collapse and reset (`C/app.jsx:7195`).
  - About 33 distinct CSS properties are exposed as rows (display, flex-*, align/justify, gap, grid-*, position, z-index, width/height/min/max, font-*, letter-spacing, line-height, text-align/transform, white-space, color, background-color, border*, border-radius, box-shadow, filter, mix-blend-mode, opacity, and others).
  - Supporting widgets: token popover (`C/app.jsx:6315`) with per-DS variables; HSV `ColorPicker` (`C/app.jsx:6129`) with hex field and eyedropper; `GridTracksEditor` (`C/app.jsx:6611`); box-model padding/margin/inset widgets with scrub.
  - The control primitives live in `C/inspector-controls.jsx` (NumberField, Slider, Segmented, Select, Toggle, AlignPad, AngleDial, RadiusControl, ValueTokenField, and others). This file is a library, not a separate feature.

## 5. Whiteboard / draw layer

- **Tools:** shell Tools menu (`C/app.jsx:4056`) and canvas palette (section 3).
- **Annotation context toolbar** (`S/annotations-context-toolbar.tsx`), CTX: colour/swatch target, thin/thick stroke, dashed, no fill, font size plus custom px, B/I/U/S, bulleted/numbered lists, link URL and title, image alt, media reference, group/ungroup, delete.
- Arrow styles (Straight, Curved, Elbow), sizes (Small to Huge), and head shapes come from `S/canvas-lib.tsx` labels.
- Visibility toggle: ⇧P / View ▸ Annotations / Settings. Select all annotations: ⇧⌘A.
- Inserting media as annotations goes through the AssetPicker or stickers. Sections are labelled containers (⇧S).

## 6. Comments

- **`CommentsPanel`** (`C/app.jsx:5429`), toggled with ⌘⇧M:
  - Filter tabs All, Open, Resolved, each with a count. The default filter is Open (`C/app.jsx:10522`).
  - File group headers and comment rows both jump to the pin.
  - Per row: Resolve or Reopen, Delete. Viewers get no row actions.
- Pins are dropped on the canvas with the Comment tool (C) or right-click → Add comment (canvas-side `S/comments-overlay.tsx`).
- Status-bar "comments N open" count (`C/app.jsx:5327`).
- The chat quick action "✓ Implement N comments" (`P/ChatPanel.jsx:1074`) is contextual.
- The Timeline has its own comment tool, strip, composer and popover (`P/TimelinePanel.jsx:1526`, `P/TimelinePanel.jsx:1592-2030`).

## 7. Git: Changes, History, branches

- **`GitPanel`** (`P/GitPanel.jsx:520`), opened with ⌘⇧G, the status-bar chip, or View:
  - Header shows project / branch (`P/GitPanel.jsx:531`). Tabs: Changes, History (`P/GitPanel.jsx:554`).
  - "Cloud is saving" note (`P/GitPanel.jsx:575`); result banners with "Get latest".
  - Empty states: Not versioned yet; Nothing to save; N versions ready to publish.
  - "N new changes from your team" nudge with Get latest (`P/GitPanel.jsx:687`).
  - File list is grouped Canvases / Other files; each file has Compare and Discard (`P/GitPanel.jsx:306-357`).
  - Compose area: select-all checkbox, message textarea, **Save version**, **Save all** (`P/GitPanel.jsx:733`).
  - **Publish changes** bar (`P/GitPanel.jsx:494`).
  - History list: click to preview; accepted-history rows have Preview, **Restore**, **Undo** (`P/GitPanel.jsx:971-1020`); Retry when the cloud history is unreachable.
  - Shows "SHA·7" in row metadata (`P/GitPanel.jsx:909`).
- **`DiffView`** (`P/DiffView.jsx`), CTX/DLG:
  - "Compare against" version select (`P/DiffView.jsx:361`); Side by side or Overlay (`P/DiffView.jsx:379`) with a wipe slider.
  - Zoom bar (out, reset, in, locked sync).
  - Restore; conflict "How to resolve" picker, including Keep both (`P/DiffView.jsx:447`).
- **`RepoBranchSwitcher`** (`P/RepoBranchSwitcher.jsx`), AV at the bottom of the sidebar:
  - Project section: recents, Open a team project…, Open another folder… (`P/RepoBranchSwitcher.jsx:229-260`).
  - Branch section: shared branch, "Other branches" with search, "Add to <shared>" merge which creates a GitHub PR (`P/RepoBranchSwitcher.jsx:622`, `P/RepoBranchSwitcher.jsx:760-786`), Fetch remote branches, New branch (name input plus Create).
  - "Continue on <draft>" resume chip; Get latest button; chat-guard confirm before switching.
  - The branch half is withdrawn when saving is cloud-managed.
- Unsaved badges in the tree, and the status-bar "changes" chip ("N unsaved", "N to publish", "all saved", or "cloud saving"; `C/app.jsx:5333`).

## 8. Sync / Cloud / Hub

- **`CloudBar`** (`P/CloudBar.jsx:704`), AV in the desktop sidebar:
  - "Sign in to Maude Cloud" device-code dialog (`P/CloudBar.jsx:970`: code, copy, link, Cancel).
  - Account menu: project list with Connect / Disconnect / viewer state, Open the dashboard, Sign out (`P/CloudBar.jsx:882-963`).
  - Live connect note; deep-link "Connect this folder" dialog (`P/CloudBar.jsx:715-835`).
  - File deep-link dialog (`P/file-deep-link-dialog.jsx`: Open in browser, Copy web link, Open project, Not now).
- **`SyncPanel`** (`P/SyncPanel.jsx:559`), dockable, only for linked projects, also opened from the status-bar "hub sync" chip:
  - Header: Download all, Resync. Phase note with "Sign in again".
  - Unfinished AI edit: Publish / Discard. Notices: Resolve opens `SourceConflictPanel` (`P/SourceConflictPanel.jsx`: Keep mine / Use theirs), and Dismiss.
  - Lists: Needs attention, per-group rows, Assets (with cancel), Project files (progress, remaining, phase, blocked, conflicts, rate-limited, failed, held), delivery attention list.
  - Trash: restore and prune with confirm.
  - **Settings** section with 3 controls (`P/SyncPanel.jsx:1054`).
  - **Ownership** section: "Hand .design/ to the workspace…" or "Take .design/ back into this repo…" with confirm (`P/SyncPanel.jsx:1110`).
- **`SyncConsentDialog`** (`P/SyncConsentDialog.jsx`), auto-shown once per hub: "Sync canvases only" or "Keep syncing everything".
- **`TeamProjects` dialog** (`P/TeamProjects.jsx`): On this computer (recents), Maude Cloud (sign-in and project list), and "Your team's own server" (Server address, Email, Password).
- Status-bar "hub sync" chip (`C/app.jsx:5379`) and `SyncBanner` (`C/app.jsx:5697`).
- Cloud-tab-only chrome: dashboard back link, account and Sign out, VIEW ONLY stamp, role banner, disabled Assistant row (`C/app.jsx:4351`).

## 9. Share

- **`ShareDialog`** (`C/share-dialog.jsx:47`) shows up to 3 links, each with a read-only field and Copy: Web link, Open in Maude app, Local link (this Mac only). It also has an "Open in app" anchor and a hint to connect to Cloud for a web link.
- Entry points:
  - Menubar share icon (`C/app.jsx:4683`)
  - File ▸ Share link…
  - Tree row ⋯ ▸ Share…
  - Palette "Copy share link", which copies directly without the dialog (`C/app.jsx:15703`)
- Separate feature: IdentityBar ▸ "Share this project" invites a GitHub username (`P/CreateProject.jsx:349`).

## 10. Export

- **`ExportDialog`** "Export & handoff" (`C/app.jsx:1539`), opened with ⇧⌘E, File, PAL, or a canvas context-menu scope hint.
  - **10 format cards** (`C/app.jsx:1118`): PNG, PDF, SVG, HTML, PPTX, MP4 and GIF (CTX, only for video comps), Canva, ZIP, AI handoff.
  - **Scope select**: selection, artboard, canvas-as-separate, or project-raw.
  - **PNG**: Resolution with 6 options (1×, 2×, 3×, 150, 300, 600 dpi) plus a size readout.
  - **Video**: resolution 1–3× plus a long-comp notice.
  - **PDF**: Image quality (4 options), Text (3 options: keep, verify embedded, outlines), Include bleed, Marks ▸ Crop and Registration.
  - "Export with audio" (mp4).
  - AI handoff copies `/design:handoff <path>` to the clipboard.
  - Recent exports list and a lane note when there is no render service.
- **Export center** (`C/export-center.jsx`): menubar badge with running count (`C/export-center.jsx:371`), toast (`C/export-center.jsx:462`), and panel (`C/export-center.jsx:466`) with job rows, progress, Save (native) or Download, "Show error details", degraded note.
- Canvas-side duplicate entry points: palette Export ⌘E and the in-canvas `S/export-dialog.tsx`.
- Handoff to production (⇧⌘H) opens the same dialog in handoff mode.

## 11. Generate / media / import

- **`GenerateDialog`** (`C/generate-dialog.jsx:207`), opened from File or PAL: Prompt, Provider select, Model select, Aspect select, "Place on canvas" checkbox, Generate, Insert, plus a no-key note pointing to Settings.
- **Timeline AI clips:** "+ AI clip" placeholder, then right-click → Generate ✨ (Gemini; `C/app.jsx:16884-16993`).
- **`BrandUploadPanel`** (`P/BrandUploadPanel.jsx`), from Quick setup: pick SVG, see extracted palette and fonts, "Copy command", import again.
- **`FigmaImportPanel`** (`P/FigmaImportPanel.jsx:171`), from Quick setup: URL field; mode choice Design frames, FigJam board, Styles; Preview; Import. Requires the Figma token from Settings.
- **Media placement:** AssetPicker; drag media onto the canvas or timeline; File ▸ Assemble dropped clips → video; PAL "New video…".

## 12. AI chat / ACP panel (Assistant, N-only, ⌘⇧A)

`ChatPanel` (`P/ChatPanel.jsx:2145`). It stays mounted when hidden.
- **Header:**
  - Chat switcher dropdown with a status dot per chat. Per-chat ⋯ menu: Rename, Archive, Copy transcript, Delete (`P/ChatPanel.jsx:2196-2270`).
  - "＋ New" button, Close.
- **Not connected** (`P/ChatPanel.jsx:1441`): `ReadinessList` (install / sign-in buttons, Copy fix, Re-check) and trust rows.
- **Empty state** (`P/ChatPanel.jsx:1027`): "Create new design system" CTA plus 3 suggestions.
- **Quick actions row** (`P/ChatPanel.jsx:1061`): "Implement N comments" (CTX), `/design:edit`, `/design:new`, `/design:critic`, `/design:screenshot`.
- **Status row** (`P/ChatPanel.jsx:703`): Working…/Ready · "Claude Code" · **View** select (normal, thinking, verbose, summary).
- **Feed:**
  - Activity bar with elapsed time; continuation bubble; tool-call cards (`P/ToolGroup.jsx`).
  - Message actions: Copy, Retry.
  - `ModeBanner` (`P/ChatPanel.jsx:232`) when the mode blocks edits, with a "Switch to …" button.
  - Rate-limit banner; connection `ErrorCard` (View details, Try again).
- **Composer** (`P/ChatPanel.jsx:1340`):
  - Removable context chip ("◆ selection"), or "Editing: <canvas>".
  - Slash command popover: 16 static commands (`P/slash-commands.js:20`) plus the live catalogue.
  - Pasted path/URL chips and attachment list.
  - `CapabilityBar` (`P/CapabilityBar.jsx:32`) with 4 selects: **Permission mode**, **Model**, **Effort**, **Fast mode**.
  - ⓘ Chat info popover (`P/ChatPanel.jsx:854`): context %, token counts, rate-limit window, mode footnote.
  - Send, and Stop while a turn runs.
- **`PermissionPrompt`** (`P/PermissionPrompt.jsx:174`), CTX: tool title/path, "+N more waiting", out-of-project path list with scope root, dynamic option buttons.
- **`ElicitationPrompt`** (`P/ElicitationPrompt.jsx:350`), CTX: multi-step questions with options, Other, custom text, secret warning; Back, Next, Submit, Skip, Cancel.
- **Readiness dialog** (Help ▸ Check AI editing readiness…; `P/ReadinessList.jsx:386`) with the `AutoSetupToggle` checkbox (`P/ReadinessList.jsx:348`).
- **OS notifications**, automatic when the panel is hidden or the window is unfocused: "Claude finished" and "Maude needs your input", with a 30 s cooldown (`C/app.jsx:10699-10727`).

## 13. Timeline / video (bottom dock, ⌘⇧T)

- **`TimelinePanel`** (`P/TimelinePanel.jsx:1390`):
  - Transport: Play/Pause, Jump to start, Loop, Mute, Volume slider, artboard/comp picker (`P/TimelinePanel.jsx:1457`), frame readout.
  - Buttons: Split at playhead (⌘B), + Title, + Image, + AI clip, Comment tool (C), long-comp badge, zoom slider, Close, resize handle.
  - **Tracks:**
    - Rows for storyline, overlay, audio and expanded layers; keyframe markers; comment pins; beat expand.
    - Clip actions: retime and trim handles with tips, Replace button, lane-chip drag reordering, drop caret, "new layer" zone.
    - Seams: "+" adds a transition; transition chip to edit it.
  - Empty state: "drop video clips here".
- **Clip context menu** (`P/TimelinePanel.jsx:2100-2259`), about 17 items: Replace…, Comment on clip…, Generate ✨, Move to overlay/storyline, Adjust…, Mute/Unmute clip, Detach audio, Move layer up/down, Bring forward/Send backward (or Move earlier/later), Show/Hide clip, Remove clip.
- **`ClipInspector`** (`P/ClipInspector.jsx:176`), from Adjust…: tabs Speed, Audio, Crop, Grade, Text, Transition. Controls include custom speed, Muted, Volume, Scale, X%, Y%, grade sliders with reset, transition Frames.
- **Keyboard while the timeline is focused** (`C/app.jsx:11508-11582`): Space, ←/→ (⇧ = 1 s), Home/End, `,` and `.` (snap points), ⌘Z/⇧⌘Z (timeline undo stack), Delete/Backspace, Esc, ⌘B.

## 14. Photo

- **`PhotoKnobs`** (`C/photo-knobs.jsx:301-410`) appears in the Inspector **Photo** tab, CTX when a content-addressed image is selected. For annotation images it is the only tab, reached via canvas "Edit Photo…".
- Sections, each with reset:
  - **Adjustments**: 8 sliders (Brightness, Contrast, Saturation, Exposure, Hue, Sepia, Grayscale, Invert)
  - **Duotone**: toggle, Shadow, Highlight, Intensity
  - **Grain**: toggle, Amount, Size
  - **Pattern**: toggle, Type, Blend, Color, Scale, Opacity
  - **Mask**: Preset, Strength
  - **Background**: removal toggle plus re-run
- Has its own undo stack via ⌘Z while the Photo tab is shown (`C/app.jsx:15440`).

## 15. Identity

- **`IdentityBar`** (`P/IdentityBar.jsx:234`), N-only, sidebar bottom:
  - Signed out: "Sign in with GitHub" device-code modal.
  - Signed in: avatar @login menu with New project, Pull a local copy, Share this project, Sign out. Each opens `CreateProject` (`P/CreateProject.jsx`): Where (GitHub/Local), name, visibility, description, repo list, invite by username.
- **Maude Cloud identity:** CloudBar (section 8). In Cloud tabs, account and sign-out sit in the menubar.
- **Presence:** menubar avatars and canvas participants chrome.

## 16. Project switching

- Native File ▸ New Project… / Open Project….
- RepoBranchSwitcher project section; TeamProjects dialog.
- `OnboardingWizard` doors (`P/OnboardingWizard.jsx:191-240`): Continue with GitHub (recommended), Open a project you were invited to, Open a folder on this computer, Connect to a team hub (advanced: Hub address plus Access token, `P/OnboardingWizard.jsx:488-519`).
- CloudBar project Connect; cloud dashboard link; file deep-link dialog.

## 17. Onboarding, tours, What's new, help

- **`OnboardingWizard`**: first run, N-only, full-screen. Includes "Watch the intro", the GitHub repo list or create form, and local folder "Set up Maude here".
- **`IntroVideoDialog`** (`P/IntroVideoDialog.jsx`).
- **Tours** via `TourOverlay` (`C/tour/overlay.jsx`: Skip, Back, Next/Done):
  - Usage tour, 6 steps (`C/tour/usage-tour.js`), with an auto nudge (`C/app.jsx:17293`).
  - Collab tour, 6 steps, N-only (`C/tour/collab-tour.js`), with an auto nudge (`C/app.jsx:17319`).
  - Quick-setup tour, 5 steps (`C/tour/quick-setup-tour.js`).
- **`SetupChecklistDialog`** (`P/SetupChecklist.jsx`): readiness rows, Start guided setup, Bring my existing brand, Import from Figma, re-check.
- **First-run toasts:** mode hint (`C/app.jsx:386`) and cloud role banner.
- **What's new** (`C/whats-new.jsx`): menubar badge, auto toast (10 s, "See all"), panel with per-entry Learn more and Take tour.
- **`HelpModal`** (F1; `C/app.jsx:3416`): 8 collapsible sections (Canvas selection & tools, Annotation tools, Canvas & panels, Slash commands, Opt-out scope, Auto-critic loop, Pin-to-element flow, Comments) plus "Take the tour".
- **`ShortcutsOverlay`** (?; `C/app.jsx:3815`): 4 groups, 24 bindings (`C/app.jsx:3741`).
- **`ReportBugDialog`** (`C/report-bug.jsx:161`), 3 steps:
  - Describe.
  - Review: attach screenshot (up to the max), Redact, consent checkboxes for active canvas path, project name, server log tail plus memory, crash logs.
  - Send, or the fallback "Save locally & open GitHub".

## 18. Status indicators

- **`StatusBar`** (`C/app.jsx:5219`), AV:
  - active file path; selected selector plus text with a clear ×; comments open count
  - Changes chip (button); live/reconnecting dot; hub sync chip (button)
  - version; light/dark theme toggle
- **Elsewhere:**
  - Menubar: stamp, path, artboard count, project, export badge, What's new dot, assistant busy/unseen.
  - Sidebar: live dot plus counts.
  - Tree, canvas and history loading/error states; banners.
  - OS notifications: Claude finished, needs input, Project synced (`C/app.jsx:10208`).

## 19. Keyboard shortcuts and command palette

**Shell keys** (`C/app.jsx:15385-15625`):

| Key | Action |
|---|---|
| ⌘K | Command palette |
| ⌘Z / ⇧⌘Z / ⌘Y | Undo / redo (forwarded to the canvas) |
| ⇧⌘R | Refresh tree |
| ⌘R | Reload canvas |
| ⇧⌘M | Comments panel |
| ⇧⌘G | Changes panel |
| ⇧⌘I | Inspector |
| ⇧⌘A | Assistant (N-only) |
| ⇧⌘E | Export |
| ⇧⌘H | Handoff |
| ⌘, | Settings |
| ⇧⌘T | Timeline |
| / | Focus search |
| ⌘F | Search |
| T | Toggle tree |
| H | Toggle hidden files |
| S | Design system view |
| N | New board composer |
| ? | Shortcuts overlay |
| F1 | Help |
| Esc | Exit presentation, or clear the focused pin |
| Backspace | Prevents navigation and deletes a selected artboard (`C/app.jsx:15155`) |

**Canvas-forwarded shortcuts:** the `shell-shortcut` message (`C/app.jsx:14033`) covers reload, inspector, assistant, comments, changes, timeline, export, handoff.

**`CommandPalette`** (`C/app.jsx:884`; actions at `C/app.jsx:15670`), 17 actions in 4 groups:
- **Canvas:** New canvas, New video, Export, Copy share link, Handoff, Generate with AI, Settings
- **View:** Open design system view, Toggle comments, Open inspector, Reload
- **Tools:** "Draw a mark with the SVG agent" (copies `/design:draw`), Toggle theme
- **Help:** What's new, Keyboard shortcuts, Help, Report a bug

---

## Settings inventory

### A. Settings modal

`SettingsPanel` (`P/SettingsPanel.jsx:1184`), opened with ⌘, / File / PAL. Editors only. 7 tabs (`P/SettingsPanel.jsx:963`); the 4 local tabs are hidden in Cloud.

1. **Appearance:**
   - Theme: Light / Dark
   - Inspector vocabulary: Advanced / Designer
2. **Canvas & View:**
   - Minimap
   - Zoom controls
   - Annotations
   - Auto-open Inspector on select
3. **Layout:**
   - Layers panel: Separate panel / Inside Inspector
   - Panel positions: Left/Right for each of Files, Layers, Inspector, Comments, Changes, Assistant
4. **AI generation** (local): one card per provider with API key input, Save, Remove, and a "Get a key" link (`P/SettingsPanel.jsx:58`).
5. **Figma** (local): personal access token, Save, Disconnect, Test/probe (`P/SettingsPanel.jsx:812`).
6. **Subtitles** (local):
   - Transcription engine: Auto, Local whisper.cpp, ElevenLabs Scribe, Groq Whisper (`P/SettingsPanel.jsx:172`)
   - Whisper model download/remove card, with copy-install commands
7. **Video** (local):
   - Keyframe engine: Auto, Gemma scout, ffmpeg scene-detect, Blind (`P/SettingsPanel.jsx:465`)
   - Gemma model card: setup steps, Ollama/mlx copy commands, download

### B. Settings that live outside the modal

- **Sync panel** (`P/SyncPanel.jsx:1054`): Sync project files (on/off), Propagate deletions (on/off), First-link conflicts (Keep asking / Keep this machine's / Keep the workspace's). Ownership adopt/detach is also here.
- **Sync consent:** canvases only vs everything.
- **Readiness dialog:** "Offer to install Claude Code and sign in automatically" (Tauri-backed).
- **Chat panel:** Permission mode, Model, Effort, Fast mode, transcript View.
- **Inspector:** CSS-panel mode toggle in its corner (same value as Settings ▸ Appearance).
- **View menu only, not in Settings:** Show hidden files, Presentation mode, Show print guides (stored per canvas in `view.json` `overlays.print`, `C/app.jsx:4392`), Project tree open.
- **Status bar:** theme toggle.
- **Comments panel:** filter (not persisted; defaults to Open).

### C. Persisted keys

**localStorage:**
- `mdcc-theme`
- `maude-cp-mode`
- `mdcc-sidebar-open`
- `mdcc-show-hidden`
- `mdcc-minimap-visible`
- `mdcc-zoomctl-visible`
- `mdcc-annotations-visible`
- `maude-auto-open-inspector`
- `mdcc-panel-sides`
- `mdcc-layers-mode`
- `maude-sb-w` / `maude-rp-w` (panel widths, `C/app.jsx:10277`)
- `mdcc-settings-tab`
- `mdcc-usage-tour-seen`
- `mdcc-collab-tour-seen`
- `maude-mode-hint-seen`
- `mdcc-whatsnew-seen`
- `mdcc-whatsnew-toast-dismissed`
- `maude-cloud-role-seen:<role>`
- `maude-acp-picks` (legacy: `maude-acp-model`, `maude-acp-effort`)
- `maude-acp-transcript-view`
- `maude-sync-consent`
- `maude-sync-notice-ack`
- `maude-install-id`
- `mdcc-sections-expanded` (legacy)

**Disk-mirrored** via `/_api/ui-prefs` to `~/.config/maude/prefs.json` (`C/app.jsx:11929-11975`): theme, minimap, zoom, annotations, autoOpenInspector, panelSides, layersMode.

**Server-side:**
- Tree expansion: `/_api/tree-state`
- Generation prefs: `/_api/generate/prefs`
- Provider keys: OS keychain or `~/.config/maude/keys.json`
- Sync settings: `linkedHub.*`

---

## Flags: developer/engineer-oriented surfaces (factual)

**Git jargon in the UI:**
- Branch names and the "Branch" section; Fetch remote branches; New branch; "Add to <shared>" merge, which opens a GitHub PR and "Review on GitHub"
- SHA·7 in history rows; Modified/Added/Deleted/Untracked badges; "Changes · N unsaved"
- SyncBanner text "Consider `git commit && git push`"
- Ownership copy (".design/ is gitignored", "staged as deletions")
- "Repo state changed — reload to sync?"
- RUNTIME · GITIGNORED section; "Unsaved (M/A/D/U)" badges

**Ports, server, paths:**
- Empty-state "localhost:PORT" and version line (`C/app.jsx:4813`)
- Help modal "MAUDE-DEV-SRV" SKU (`C/app.jsx:3444`)
- Design system view "MAUDE-DSN/01" and raw `systemDir` (`C/app.jsx:5141`, `C/app.jsx:5156`)
- Canvas error "Maude's server isn't responding" (`C/app.jsx:4898`)
- Status-bar "live/reconnecting" and full active path (`C/app.jsx:5302`)
- Bug report includes server log tail plus RSS memory MB (`C/report-bug.jsx:584`) and a fallback dir path
- Settings mention `~/.config/maude/keys.json`
- SyncBanner mentions `maude design status`, `.design/_history`, `/design:rollback <slug>`
- Export lane note about the "maude-render service"
- Readiness rows show the resolved `claude` binary path

**Model/permission knobs:** Permission mode, Model, Effort, Fast mode selects; context % and token counts; rate-limit window; transcript view (thinking, verbose); out-of-project path permission cards; "Claude Code" label.

**Raw CSS / ids:**
- Inspector Advanced mode (raw property names, custom CSS property and HTML attribute rows)
- "Copy data-cd-id" (context menu and toolbar)
- Selector strings in the status bar and comment rows
- Inspect tab Tag/Class

**Slash-command / CLI surfacing:**
- Help modal Slash commands, Opt-out scope and Auto-critic loop sections (iteration counts, `opt_out_scope`, `.meta.json`)
- Chat quick actions as literal `/design:*` strings
- Export "AI handoff" copies `/design:handoff`; palette "Draw" copies `/design:draw`
- Brand upload "Copy command"; ClipInspector loose-media item "edit via /design:edit"

**Engines/models setup:** whisper.cpp, Gemma/Ollama/mlx-vlm, ffmpeg install commands (Settings ▸ Subtitles and Video).

**Infra:**
- Team hub URL plus access token (Onboarding "Advanced")
- "Your team's own server" email/password form
- Sync panel Resync, Download all, assets/delivery/rate-limited/held diagnostics, Trash prune

## Observed inconsistencies across surfaces (factual)

- **Tools mismatch.** The shell Tools menu lists Rect (R) and Ellipse (O) (`C/app.jsx:4072-4073`). The canvas `DEFAULT_TOOLS` has Shape (R) with sub-kinds, plus Highlighter (I) and Section (⇧S), and no O (`S/use-tool-mode.tsx:87-102`). The shortcuts overlay follows the canvas version; the Help modal follows the shell menu.
- **Same letter, different action by focus:**
  - T: Project tree (shell) or Text tool (canvas)
  - H: Hidden files or Hand
  - N: New board or Sticky
- **Stale copy:**
  - Usage tour says the Inspector opens with "press I" (`C/tour/usage-tour.js`); it is ⌘⇧I, and I is the Highlighter.
  - The Help modal Comments section still documents ⌘C comment-drop, which the handler marks as deprecated (`C/app.jsx:3714` vs `C/app.jsx:15525`).
- **Duplicated surfaces:**
  - Two export dialogs: shell `ExportDialog` and canvas `S/export-dialog.tsx`.
  - Two "Share" meanings: link dialog vs GitHub invite.
  - Theme is set in 3 places: status bar, Settings, palette.
  - Minimap, zoom, annotations and auto-open are each settable in both the View menu and Settings.
