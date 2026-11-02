# UX audit rc.1: reduce pass

_2026-10-31 · inputs: the 7 critic reports in `critics/`, `INDEX.md`, Michal's 20 rc.1 findings (`.ai/scenarios/maude-v2/lead/brief-michal-rc1-findings.md`), the Inspector rules (`inspector-ux-rules.md`, IR-1..17, O1–O4), and kg `v2-michal-*`. Shots are from product `20b4215eb`. Fixes merged since then, `17551ec58..97a610d61`, are marked as covered. Read-only pass._

**Seat keys:** UA user-advocate · DE design · IA info-architecture · CP copy · GD graphic-design · AX a11y · MO motion. Every row keeps each seat's own id, so the reasoning can be traced back to its report.

**Bands:**
- **blocker:** breaks a core task or loses work.
- **before-merge:** a designer hits it in the first hour. Michal's rule `v2-michal-before-merge-everything-works` also puts every dead control here.
- **rc-patch.**

**Severity and order.** A row keeps the highest severity any seat gave it. Within a band, rows go by the number of seats that reported them, then by impact.

**Verify flags:**
- `verify-in-app`: the evidence is one headless shot with no visible result, and it may be a harness artefact. Re-check it in the `.app` before building.
- `verify-on-tip`: a merged fix touched the same code and may already cover it.

Shot paths are relative to `shots/`.

## Findings (ordered)

### Blocker (2)

| id | band | finding | seats | rules | shots | covered-by / verify |
| --- | --- | --- | --- | --- | --- | --- |
| F01 | blocker | **The Text tool can't type.** T + click places "Text" at the artboard's 0,0 (390×19), not at the click. No caret appears. The text renders in browser-default serif (Font "Inherited"). Typing "Sharp pencils" runs the letters as tool keys: S/N cross to Preview, E opens stickers. The input is lost and the window rearranges itself. The keyboard route (T, ↵, ↵) works, so only the click route is broken. | UA U01 · DE D1 · AX A1 · MO M6 · GD GD-10 (5) | new UX-EDIT-1 / UX-A11Y-4 ("a create tool ends in the object's edit state; no single-key shortcut fires while a caret is live"); CONTRACT §2 "Focus decides"; V2-1.2 C26 | `03-edit/01-text-click-placed.png`, `03-edit/02-text-typed.png` | Not covered. #8 and #12 touched other tools. |
| F02 | blocker | **New objects are invisible.** A drawn Rectangle and an F-drag Frame get Fill None and Border None. After deselect nothing shows, so the user thinks the tool failed. | UA U02 · DE D2 (2) | M6, UX-ACT-8 (inverse); IR-11; proposed IR addendum "a fresh object is never invisible" | `03-edit/04-shape-drawn.png`, `04-inspector/07-frame.png`, `03-edit/08-frame-drawn.png` | **Partly fixed in r1-canvas-tools `dcd91f6b3`:** shapes and lines now default to `var(--accent, currentColor)` / `var(--fg-0, currentColor)`. **What remains:** frames are still None. The `currentColor` fallback contradicts IR-11 ("never currentColor") and UA's "the accent is a signal" (TD3). verify-on-tip in dark chrome. |

### Before-merge (34)

| id | band | finding | seats | rules | shots | covered-by / verify |
| --- | --- | --- | --- | --- | --- | --- |
| F03 | before-merge | **Toasts.** The "What's new" toast never leaves: it is in about 30 shots across every flow and has no ×. The "You're in Edit" toast is drawn over it, and both texts clip. The cause is Sonner's collapsed stack with `width: fit-content` (`notifications.tsx`). The toast also covers the toolbar More menu (a shell toast at z 8000 sits over an in-iframe popover) and sits on the selection handles. Two live notices are read at once. | UA U18 · DE D9 · GD GD-1, GD-2 · MO M1, M2 · AX A13 · IA IA-38 (6) | UX-MOT-1, UX-MOT-3, UX-CONT-3; new UX-TOAST-1 ("one slot, queued; menus above toasts") | `02-first-canvas/03-empty-canvas.png`, `02-first-canvas/06-toolbar-more.png`, `05-preview-vs-edit/01-edit-mode-smoke.png`, `08-left-panel/13-assets-dragging.png` | Not covered. Overlap and z-order are proven in code. Duration: MO reads a 10 s timer that acknowledges the toast, so confirm the persistence in the `.app` (TD5). |
| F04 | before-merge | **? opens nothing.** Help › "Keyboard shortcuts ?" and Settings both promise it. The sheet is the documented home of the keys that moved. | UA U15 · DE D30 · IA IA-3 · CP CP-34 · GD GD-31 · AX A10 (6) | CONTRACT §2 "? All shortcuts"; WCAG 2.1.1 | `11-palette-settings-menus/03-shortcuts-sheet.png` | **verify-in-app.** `chordFromEvent` maps ⇧/ to ?, and focus may have been in the Advanced fold. Re-run from canvas, panel and Inspector focus. Add a dead-control crawler rule. |
| F05 | before-merge | **The mode is not legible.** The switch is three unlabelled icons, and the Edit glyph is a crossed pencil and ruler. A toast that leaves is the only statement of the mode. In Preview the project pill shrinks to the mark, so the project and canvas names vanish. The cluster drops the avatar, undo/redo leave, and the canvas jumps about 75 px. A screen reader hears nothing: `PreviewBar` is not a live region. | UA U06 · DE D14 · IA IA-22, IA-23 · GD GD-6 · AX A2 · MO M7, M9 (6) | UX-NAV-1, UX-FORM-1, UX-MOT-2; WCAG 3.2.1 / 4.1.3 | `05-preview-vs-edit/01-edit-mode-smoke.png`, `05-preview-vs-edit/05-preview-mode.png` | Not covered. The labels and the frame are **TD1**. The polite live-region announcement doesn't wait on taste. |
| F06 | before-merge | **The first canvas is a v1 brief board.** "New canvas" opens a placeholder-only "brief board name…" field at the top of the panel, about 450 px from the row. It lands on "Brief — annotate me", which says "run `/design:new` again to have Claude read your notes": a terminal command, the word Claude, and N/T/A keys that leave Edit. The Empty-artboard hint ("Empty artboard.") points back at the brief. New folder has the same far-away, unlabelled "folder name…" field. kg already records the "New blank brief board" aria-label gap. | UA U07 · DE D7, D8, D39, D24 · IA IA-16, IA-17 · CP CP-01, CP-02, CP-03 · GD GD-8 (5) | UX-COPY-1/3, UX-FORM-1/2, UX-HIER-2; CONTRACT §3 (board, Claude), §4, §6 empty line | `02-first-canvas/01-new-canvas-menu.png`, `02-first-canvas/03-empty-canvas.png`, `02-first-canvas/08-after-pick-size.png`, `08-left-panel/08-new-folder.png` | Not covered. What a new canvas opens is **TD2**. In-place naming and removing the slash command and "Claude" don't wait. |
| F07 | before-merge | **Share is a dead end on a local project.** The only filled primary in the chrome opens "Invite people once it is in the cloud", with no verb to get there. Advanced promises "Links, link rules, sync" but holds a `maude://` link and a `127.0.0.1` link that work only on this Mac. CONTRACT §6 puts "Move to cloud…" inside Share. | UA U08 · DE D25, D26 · IA IA-28 · CP CP-27, CP-28 · GD GD-26 (5) | UX-ACT-1, UX-ACT-2, UX-COPY-1, UX-HIER-8; CONTRACT §6 Share | `09-share-export-history/01-share-open.png`, `09-share-export-history/02-share-advanced.png` | Not covered. r1-format-ds added Connect to the format callout, not to Share. The verb's wording is **TD8**. |
| F08 | before-merge | **Comment identity.** The author shows as "U" or as "Smoke" (the canvas name), the pins show "?", the top bar shows "Y", and Mine reads 0 after two posts. | UA U19, U20 · DE D17 · IA IA-25 · CP CP-20, CP-21 · GD GD-16 (5) | CONTRACT §4 People ("the signed-in person is You"); UX-DATA-1, UX-ICON-1 | `06-comments/07-two-comments.png`, `06-comments/08-open-pin.png`, `06-comments/06-comment-on-empty-space.png` | Not covered. Not taste: CONTRACT §4 already says "You", so DE's T6 is dropped. |
| F09 | before-merge | **⌘K noise.** "new" gives seven "New artboard: <preset>" rows, each with the chip "Menu › Edit › Advanced". It also gives "New brief", "New video" plus "New video…", "Generate with AI…" where the contract says Ask AI, "Open design system view" (v1), the group header "Actions · 7 hidden tools", Settings filed under Canvas, a bare "ui" folder tag on Recent rows, and "Copy share link" where Share says "Copy link". | UA U24 · DE D32 · IA IA-31, IA-33 · CP CP-29, CP-32, CP-33 · GD GD-30 (5) | M4, UX-ACT-6/7, UX-NAV-3; CONTRACT §2 moved keys, §3 ("Ask AI", "Design system") | `11-palette-settings-menus/01-command-palette.png`, `11-palette-settings-menus/02-palette-typed-new.png` | Not covered. Whether "New brief" stays is part of TD2. |
| F10 | before-merge | **The Image tool (I) answers 600 px away.** It switches the left panel to Assets, opens no file chooser, and leaves Select and Image pressed together. The user loses Canvases or Layers as a side effect. | UA U03 · DE D6 · IA IA-14 · AX A16 · MO M15 (5) | UX-ACT-5, UX-MOT-2, UX-NAV-1, M6 | `03-edit/10-image-tool.png` | Not covered. #10 fixed dragging an Assets tile, not the tool. What I opens is **TD10**. |
| F11 | before-merge | **Home has no visible New project.** It exists only under Home pill › File. "a project on this Mac" is a lowercase fragment that reads like "pick one". Followed by "Start with an empty canvas", it skips the Create-a-local-project dialog that File › New project… shows. The Home pill menu is File (3 rows) plus a one-row Help, with no Settings. | UA U09 · DE D37 · IA IA-18, IA-19, IA-20 · CP CP-05 · GD GD-34 (5) | UX-ACT-7, UX-HIER-8, UX-NAV-3, UX-COPY-1, M4 | `01-home-new-project/01-home-default.png`, `01-home-new-project/02-home-pill-menu.png`, `01-home-new-project/03-home-target-menu.png`, `01-home-new-project/06-new-project-dialog.png` | **Partly fixed in r1-home-tabs:** the target menu's layering, same-name hints and pill height (`35867e4ec`), and the folder picker (`79cbb75d8`). **What remains:** the button, one route, and the row name. |
| F12 | before-merge | **The left panel folds on every selection.** At 1600 px, selecting anything folds Canvases/Layers to its icon, and deselecting brings it back. The tree vanishes exactly when you need it. Both islands move four times for "pick A, click empty, pick B". If the pick came from inside the panel, focus drops to `<body>` (`use-shell-core.jsx:985`). | UA U04 · DE D11 · AX A3 · MO M3 (4) | new UX-NAV-5; UX-MOT-2; WCAG 2.4.3 | `02-first-canvas/08-after-pick-size.png`, `07-ai-chat/05-chat-and-inspector.png`, `08-left-panel/11-layers-selected.png`; INDEX "00-panels-exclusive" | Not covered. r1-panels did widths, not the fold. This is recorded decision `maude/v2-s6-16b-canvases-fold-panel-only`, so the fold rule is **TD4**. The AX focus-loss guard doesn't wait. |
| F13 | before-merge | **Annotation keys in Edit change the mode without saying so.** N/C/M/A/E/S pressed in Edit cross to Preview. "Preview" holds nine drawing tools, which a Figma user reads as "see the prototype". Every crossing also eases the camera. | UA U05 · DE (T2) · AX A2 · MO M8 (4) | UX-COPY-1, M6; WCAG 3.2.1; decisions V2-4.5b (crossing key), "two toolbars — Edit makes, Preview annotates", `v2-S3.9-camera-ease-engine` | `03-edit/09-sticky.png`, `06-comments/01-comment-tool-c.png`, `05-preview-vs-edit/05-preview-mode.png` | The V half is **fixed in r1-preview-comments** (`1b55ae8e9`, `cd6b06963`): V keeps Preview. The rest is **TD1** (name, keys, camera). |
| F14 | before-merge | **Clicking a pin opens no thread.** The app drops back to Edit, the list shows no active row, and there is no reply or resolve on the canvas. | UA U14 · DE D18 · IA IA-26 · GD GD-16 (4) | UX-ACT-5; new "a pin and its thread select together" | `06-comments/08-open-pin.png` | **verify-in-app.** One headless shot. The drop to Edit may be the old V/crossing behaviour that r1-preview-comments changed. |
| F15 | before-merge | **Right-clicking an object shows no menu.** Artboard and empty-canvas menus open. | UA U13 · DE D4 · IA IA-7 · GD GD-3 (4) | UX-ACT-5/7, M6 | `03-edit/15-context-object.png` | **verify-in-app. Likely a harness artefact:** `e6a227a28` names "the object menu's Duplicate", so an object menu exists. If it is real, build it from the registry (DE D4's row list). |
| F16 | before-merge | **The Comment tool icon is a rounded square.** It reads as Shape, while the Comments panel uses a speech bubble. | UA U21 · DE D12 · IA IA-24 · GD GD-18 (4) | UX-ICON-1, UX-ACT-6/8 | `06-comments/01-comment-tool-c.png`, `06-comments/03-comment-on-element.png`, `06-comments/04-comment-typed.png` | Not covered. r1-preview-comments rebuilt the Preview toolbar (Select, Hand), so check the glyph on the tip. |
| F17 | before-merge | **The empty-canvas menu disagrees with View.** It shows "Fit to view 1" and "Reset view ⌘0" where View has "Zoom to fit ⌘0" and "Actual size ⇧0", so ⌘0 has two names. It has no Paste, Select all or New artboard. It carries "Export canvas as separate…" and "Export project (ZIP)…", which bypass the one Export sheet. | UA U22 · DE D5 · IA IA-5, IA-6 · CP CP-08, CP-09 (4) | M4, UX-COPY-1; CONTRACT §2 keys, §6 Export | `03-edit/17-context-empty-canvas.png`, `11-palette-settings-menus/07-menu-view.png` | Not covered. |
| F18 | before-merge | **The canvas row menu mixes designer and developer rows.** It has "Rename" and "Rename file…", plus "View code", "Copy file path" and "Open in the Mac app" (inside the app) on its face. Copy link shows on a local project, and Pin is both a row and a hover icon. | UA U25 · DE D20 · IA IA-10 · CP CP-23 (4) | UX-ACT-7, UX-COPY-1, M4; IR-3 by analogy | `08-left-panel/06-row-actions.png` | Not covered. r1-panels closed Advanced folds, but this is a menu. |
| F19 | before-merge | **Comment pins don't sit on what they're about.** "Make this bigger" was left on a heading, but its pin floats about 50 px above the artboard label. The composer is titled with the canvas ("Smoke"), not the element, and opens on top of the heading it is about. | DE D16 · GD GD-16, GD-17 · CP CP-21 (3) | new UX-ANCH-1; UX-FORM-2 | `06-comments/03-comment-on-element.png`, `06-comments/04-comment-typed.png`, `06-comments/07-two-comments.png` | verify-on-tip. `65f632c4b` says the anchor already stores the element and adds an e2e for the element anchor, so the remaining fault may be render placement only. |
| F20 | before-merge | **The design system can't be reached.** Opening `system/maude` shows "No canvas open". There is no pinned Design system row (CONTRACT A9), and Canvases › Advanced offers "Make a design system" in a project that has two. | UA U16 · DE D29, D21 · IA IA-4 (3) | UX-NAV-2; CONTRACT §2 S → Design system row | `10-design-system/01-ds-canvas-maude.png`, `10-design-system/03-ds-click-specimen.png`, `07-ai-chat/02-chat-advanced.png` | **verify-in-app.** The fixture may register no DS, and r1-ds-specimens (`1bd11e6c9`, 9A) has since reshaped the DS canvas. |
| F21 | before-merge | **No AI entry is visible.** No 07 shot shows "Ask AI ⌘/" or the spark. The click opened nothing, and "Advanced" opened Canvases › Advanced. | UA U17 · DE D19 · IA IA-1 (3; GD/CP/MO name it an evidence gap) | UX-ACT-1/5; new UX-DISC-1 | `07-ai-chat/01-chat-open.png`, `07-ai-chat/02-chat-advanced.png`, `07-ai-chat/06-chat-collapsed.png` | **verify-in-app.** Michal's `18.webp` shows the spark. Per IA, raise it to **blocker** if it reproduces in the `.app`. r1-panels changed the chat collapse. |
| F22 | before-merge | **The Inspector shows stale geometry after a drag.** The guide reads 846, but the Inspector keeps Y 286. The path card says "Pins show what the file says. Select the object again to change them." | UA U11 · DE D3 · CP CP-10 (3) | UX-DATA-1; new UX-STATE-1 "Inspector values follow the object live" | `03-edit/13-object-outside-artboard.png`, `03-edit/14-duplicate.png`, `04-inspector/06-path.png` | verify-on-tip. r1-canvas-tools #12 reworked the clipped drag. |
| F23 | before-merge | **Artboard and Frame are one noun for two things.** F/# opens an artboard size picker, but F-drag inside an artboard makes a Frame (a div). New artboard sits three levels deep (Menu › Edit › Advanced). | UA U10 · IA IA-32 · GD GD-30 (3) | UX-COPY-1, UX-NAV-3 | `02-first-canvas/05-frame-tool.png`, `03-edit/08-frame-drawn.png`, `11-palette-settings-menus/02-palette-typed-new.png` | Not covered. Where New artboard lives is **TD10**. |
| F24 | before-merge | **Layers can't be worked.** Rows have no eye or lock and there is no name search. Every frame is "Frame". Hide has no key (CONTRACT §2), so a control is the only route. | DE D23 · IA IA-12 · CP CP-26 (known, Michal img 18) (3) | M6, M2; new "a tree past ~20 rows gets a find field" | `08-left-panel/10-layers-tab.png`, Michal `18.webp` | Not covered. Michal's img-18 "Lane/Card" label echo isn't named in any r1 merge, so confirm whether it is fixed. |
| F25 | before-merge | **Canvas overlays paint over the floating chrome.** With an object below the artboard, its handles and the "Rectangle · 230 × 144" label paint over the toolbar. | GD GD-3 · UA U23 (2) | new "canvas overlays render under floating chrome" | `03-edit/13-object-outside-artboard.png`, `03-edit/15-context-object.png` | Not covered. |
| F26 | before-merge | **Preview hides undo and redo** while every annotation made there is undoable with ⌘Z. | IA IA-21 · DE D13 (2) | M4, UX-ACT-5 | `05-preview-vs-edit/05-preview-mode.png` | verify-on-tip. r1-preview-comments rebuilt the Preview toolbar (the V/marquee half of IA-21 is fixed). |
| F27 | before-merge | **Clicking the active left tab hides the whole panel.** `onPick` = `togglePanel` (`app.jsx:3184/3234`). Hide (`lp-fold`) already closes the panel, so there are two close controls. | UA U04 · MO M4 (2) | UX-ACT-5 | `08-left-panel/01-canvases-tab.png`; INDEX | Not covered. |
| F28 | before-merge | **Focus rings are too faint.** Nine focus rules draw only an accent-tint box-shadow with `outline:none`, at 1.36:1 light and 1.56:1 dark against bg-1: `.insp-cp-pop-row` (the picker), `.sh-layer-eye/lock`, `.chat-foot-info-btn`, `.chat-lightbox-close`, and others. `.insp-cp-boxv:focus` = hover. | AX A4 (1) | WCAG 1.4.11 / 2.4.7 | `04-inspector/06-path.png`, `08-left-panel/10-layers-tab.png` | Not covered. Add a CSS pin test. |
| F29 | before-merge | **Selected and focused look the same.** Both are an accent ring, on segmented controls, left tabs, kind chips and the Settings theme control. | AX A5 (1) | WCAG 2.4.7 | `12-light-theme/02-selection-inspector-light.png`, `11-palette-settings-menus/20-settings.png` | The look is **TD9**. |
| F30 | before-merge | **The colour menu can't be driven by keyboard.** Focus doesn't enter the `role=menu`, arrows do nothing, and Tab out leaves it open. | AX A6 (1) | WCAG 2.1.1, ARIA menu pattern; IR-8 | `04-inspector/04-artboard-fill-dropdown.png` | Folded into the IR-8 picker (P6, **TD7** O2). |
| F31 | before-merge | **The Fill popover runs off the window edge** and covers Safe zones. | GD GD-4 (1) | new "a popover flips or shifts to stay inside the window" | `04-inspector/04-artboard-fill-dropdown.png` | P6 (the IR-8 popover). Michal #10/#12 is the content side. |
| F32 | before-merge | **A cross-canvas paste can't be finished by keyboard.** It is confirmed only by a 10 s toast ("Paste 2 objects copied in Home?"), which focus can't reach from the iframe. | AX A7 (1) | WCAG 2.1.1 / 2.2.1 | `03-edit/12-finder-drop-simulated.png` | verify-on-tip. r1-clipboard-drop (`7bfb088ce`) fixed ⌘C/X/V between artboards, not this cross-canvas confirm. |
| F33 | before-merge | **Comments and stickies need a pointer.** C or N arms a tool that waits for a click, and ↵ is scoped to R/T/F only (`actions/defs/tool.ts:125`). | AX A8 (1) | WCAG 2.1.1 | `06-comments/01-comment-tool-c.png` | Not covered. |
| F34 | before-merge | **Submenus don't forgive the diagonal.** Moving from File toward its submenu crosses Edit/View and closes it (`project-pill.jsx` `onHover`, and the same in `home-menu.js`). | MO M5 (1) | new UX-NAV-5 "submenus forgive the diagonal" | `11-palette-settings-menus/05-menu-file.png` | Not covered. #11 (`a0df37085`) fixed the tool panel, not menus. |
| F35 | before-merge | **The Canvases panel body sits 8 px off.** In the 09 shots it is shifted 8 px left: the content is flush with the border and leaves a gap on the right (horizontal scroll, or lost padding). | GD GD-23 (1) | UX-HIER-5 | `09-share-export-history/01-share-open.png`, `09-share-export-history/04-version-history.png` | verify-on-tip. r1-panels' scroll lock covers the shell root, not the panel body. |
| F36 | before-merge | **The cloud has four names:** "cloud.maude.sh" (Home, Settings), "Maude Cloud" (format lines), "the cloud", and "in a cloud project". | CP CP-06, CP-18 (1; it shows in F07's verbs for DE, IA, UA) | UX-COPY-1; CONTRACT §3 has no row | `01-home-new-project/01-home-default.png`, `11-palette-settings-menus/20-settings.png`, `05-preview-vs-edit/10-present-options.png` | The name is **TD8**. |

### rc-patch (33)

| id | band | finding | seats | rules | shots | covered-by / verify |
| --- | --- | --- | --- | --- | --- | --- |
| R01 | rc-patch | **Settings.** "Auto-open Inspector on select" here vs "Open inspector on select" in the menu. The Account row says "Sign in under Connections" with no button. The "Zoom controls" switch is off, yet the pill shows. "Advanced" names three things in Connections. Done stays hidden until it has focus, so there is no visible close. | DE D33 · IA IA-35, IA-36 · CP CP-35, CP-36 · GD GD-38 · AX A14 (5) | UX-COPY-1, M4, UX-ACT-1 | `11-palette-settings-menus/20-settings.png`, `11-palette-settings-menus/21-settings-connections.png` | Not covered. |
| R02 | rc-patch | **Export everywhere.** About 8 routes under 5 names: root plus File, Inspector "Export 1 file" plus "Export… — every option", and context-menu variants. Scope "Folder 13" = "Whole project 13". Print PDF offers "Include annotations", then says it can't. The file is named "Print — Print 1@1x.pdf". | UA U25 · DE D27 · IA IA-29, IA-30 · CP CP-13, CP-30 (4) | M4, UX-ACT-5; CONTRACT §6 Export | `09-share-export-history/03-export.png`, `04-inspector/01-artboard.png`, `11-palette-settings-menus/05-menu-file.png` | Not covered. **TD6.** |
| R03 | rc-patch | **The Inspector header names the kind 3–4 times:** "Mobile › Rectangle", title "Rectangle", chip "Shape", row "Kind · Rectangle", and "Text / Text / Text". It also uses the id "mobile" for "Mobile". | DE D34 · CP CP-11 · GD GD-11 (3) | IR-7, UX-HIER-1/3, M2; proposed IR addendum "named once: crumb + chip" | `03-edit/01-text-click-placed.png`, `04-inspector/06-path.png`, `04-inspector/07-frame.png` | P6. |
| R04 | rc-patch | **Inspector prose.** 3–4 helper paragraphs per card ("Mobile places things freely…", "This system has no shadow steps.", "It sits where its frame's layout puts it…") push Fill and Border below the fold. "Rectangle 57" reads as a name. | DE D35 · GD GD-12 · CP CP-10, CP-15, CP-16 (3) | IR-3, M2, UX-HIER-4 | `03-edit/04-shape-drawn.png`, `03-edit/07-pen-finished.png`, `07-ai-chat/05-chat-and-inspector.png` | P6. Where explanations live is part of **TD7**. |
| R05 | rc-patch | **The Pen leaves a stray 18 px focus square at the window's 0,0** and an empty blue pill under the path, and focus leaves the canvas. | DE D36 · GD GD-36 · AX A9 (3) | UX-ACT-8; WCAG 2.4.3 | `03-edit/07-pen-finished.png`, `04-inspector/06-path.png` | verify-on-tip. `dcd91f6b3` rewrote `pen/overlay.tsx` and `draw.tsx`. |
| R06 | rc-patch | **The zoom readout is one action (Zoom to fit), not a zoom menu**, and it widens on hover ("Zoom to fit · 95%"). | UA U28 · IA IA-8 · GD GD-37 (3) | UX-NAV-2, M6 | `02-first-canvas/04-zoom-menu.png`, `02-first-canvas/10-zoom-to-fit.png` | Not covered. |
| R07 | rc-patch | **Kind chips:** an icon plus a number with no word, zero-count chips shown, unequal cells, repeated in Layers (0 · 0 · 2 · 0). | UA U26 · GD GD-21 · DE D23 (3) | UX-FORM-1, UX-HIER-7, M2 | `08-left-panel/01-canvases-tab.png`, `08-left-panel/10-layers-tab.png` | Not covered. |
| R08 | rc-patch | **Canvases › Advanced.** The Trash row is "Empty · Open", destructive first, as bare words. "Make a design system" wraps onto two centred lines. The value column wanders, and the list's last row is cut with no fade. | DE D21 · CP CP-22 · GD GD-24 (3) | UX-ACT-3/5/7, UX-HIER-5 | `07-ai-chat/02-chat-advanced.png`, `08-left-panel/09-canvases-advanced.png` | Not covered. |
| R09 | rc-patch | **Comment strings and chrome.** The placeholder is a fragment ("Add a comment — @ mentions someone"). Each row repeats "Smoke" under a "Smoke 2" header. The Comments toggle appears only after the first comment. | CP CP-21 · GD GD-19 · IA IA-27 (3) | UX-FORM-2, M2, UX-ACT-5 | `06-comments/03-comment-on-element.png`, `06-comments/08-open-pin.png`, `02-first-canvas/01-new-canvas-menu.png` | Not covered. |
| R10 | rc-patch | **Preview tool popovers.** Sticker pack credits take 15 % of the popover. The sticky text bar overlaps the "On Mobile · moves with it" label, which is set at about 8 px. A toast says "⌘Enter commits…". | DE D38 · GD GD-28 · CP CP-17 (3) | M2; CONTRACT §2 (↵); type-xs floor | `03-edit/02-text-typed.png`, `03-edit/09-sticky.png` | Not covered. |
| R11 | rc-patch | **Inspector words and columns covered by IR-5 and IR-16:** "Border › Border", "Stroke › Stroke", values pushed to the right edge, Advanced indented 12 px with its code cut off, "Follow chrome" theme copy, the `esc` kbd and kind pills that look like buttons, scrub off. | CP CP-12, CP-14 · GD GD-13, GD-15 · AX A15, A17 (3) | IR-5, IR-13, IR-16, UX-ACT-8 | `04-inspector/04-artboard-fill-dropdown.png`, `04-inspector/08-frame-advanced.png`, `03-edit/16-context-artboard.png`, `04-inspector/05-shape.png` | P6 (T4/T5). |
| R12 | rc-patch | **What moves on a mode crossing.** Seven things change in the same 220 ms with no order. The pill and the cluster snap. The toolbar grows 420→494 px in one frame. C opens the Comments island in the same frame as the fold. Content looks different between modes (sticky beige vs yellow). | MO M7, M9, M11 · GD GD-7 (2) | UX-MOT-1/2/3 | `05-preview-vs-edit/01-edit-mode-smoke.png`, `05-preview-vs-edit/05-preview-mode.png`, `06-comments/01-comment-tool-c.png` | **TD1** (d) and **TD9** (dimming). |
| R13 | rc-patch | **"Recent" repeats the top rows** of a Recently-opened list in an 11-canvas project. | DE D22 · IA IA-13 (2) | M2, UX-CONT-3 | `08-left-panel/01-canvases-tab.png` | Not covered. |
| R14 | rc-patch | **Version history credits "MM · maude-migration"**, an internal process shown as a person. | DE D28 · CP CP-31 (2) | CONTRACT §4 | `09-share-export-history/04-version-history.png` | Not covered. |
| R15 | rc-patch | **The size picker.** Three kind vocabularies (chip, picker groups, sort hint). "FB event cover". One accent tag. The picker is about 730 px tall. | CP CP-24 · GD GD-29 (2) | CONTRACT §6 [C16], UX-ACT-2 | `02-first-canvas/05-frame-tool.png`, `08-left-panel/05-sort-menu.png` | Not covered. |
| R16 | rc-patch | **Assets.** Three icon-only header actions plus a "From this Mac…" row. Tiles have no names. The tooltip is white in dark. | IA IA-15 · GD GD-25 (2) | UX-ACT-5/6, M8, UX-TOK-1 | `08-left-panel/12-assets-tab.png`, `08-left-panel/13-assets-dragging.png` | Not covered. #10 (drop) is fixed. |
| R17 | rc-patch | **Home chrome.** Each row has two identity marks (thumbnail plus an initial badge about 1000 px away). The top-right isn't the cluster pill. Home's ⌘K placeholder promises actions but lists none. | GD GD-32, GD-33 · IA IA-39 (2) | UX-HIER-2, UX-NAV-2, M4 | `01-home-new-project/01-home-default.png`, `01-home-new-project/14-home-search-open.png` | Not covered. |
| R18 | rc-patch | **Sort is hidden in the "11 canvases" count**, with no affordance. | GD GD-20 · IA (T2) (2) | UX-ACT-8 inverse | `08-left-panel/05-sort-menu.png` | Small taste call (IA T2 C). |
| R19 | rc-patch | **Small targets.** Row actions are 22 px, the eye and lock 18 px, Home's What's-new × about 12 px. The tab × is hover-only and 16 px. | AX A11, A12 (1) | WCAG 2.5.8 | `08-left-panel/06-row-actions.png`, `02-first-canvas/03-empty-canvas.png`; `strip.html:303` | Small taste call (AX T3). r1-home-tabs kept the × hover-only on inactive tabs. |
| R20 | rc-patch | **Menu anatomy and elevation.** Icons on some rows only. Shortcuts as keycaps in one menu and plain text in another. Menus open flush on a panel of the same surface, and the edge disappears in light. | GD GD-5, GD-14 (1) | UX-HIER-9, UX-ACT-6 | `03-edit/16-context-artboard.png`, `11-palette-settings-menus/04-project-menu.png`, `12-light-theme/03-project-menu-light.png` | **TD9**. |
| R21 | rc-patch | **Accent rationing.** About nine accent marks in one view: tabs, chips, "kept open", tags, links. | GD GD-27 (1) | UX-ACT-2 | `02-first-canvas/03-empty-canvas.png`, `02-first-canvas/05-frame-tool.png` | **TD9**. |
| R22 | rc-patch | **The empty-artboard hint is a dark shadowed card**, the strongest object on screen, and its keycaps wrap away from their words. The copy is in F06. | GD GD-9 (1) | UX-HIER-3, UX-CONT-3 | `02-first-canvas/08-after-pick-size.png` | With F06 (P2). |
| R23 | rc-patch | **Picking a size doesn't frame the new artboard.** | DE D10 (1) | M3 | `02-first-canvas/08-after-pick-size.png` | Not covered. |
| R24 | rc-patch | **Menu rows lack their registry keys:** ⌘N, ⇧⌘N and ⌘O are missing in File and ⌘K. | DE D31 (1) | CONTRACT §1 | `11-palette-settings-menus/05-menu-file.png` | Not covered. |
| R25 | rc-patch | **View is incomplete.** It lists Assets but not Canvases or Layers. The Inspector is under View › Advanced. The AI chat has no menu row. The top-right toggles have no names. | IA IA-2, IA-34 (1) | UX-NAV-2, UX-HIER-7 | `11-palette-settings-menus/04-project-menu.png`, `11-palette-settings-menus/07-menu-view.png` | Not covered. |
| R26 | rc-patch | **The Canvases search shows a ⌘K badge but filters in place.** | IA IA-9 (1) | M4 | `08-left-panel/01-canvases-tab.png` | Not covered. |
| R27 | rc-patch | **Artboards are listed in two trees** (an expanded Canvases row and Layers), each with its own selection. | IA IA-11 (1) | UX-HIER-1 | `08-left-panel/07-row-expanded.png` | Small taste call (IA T5 C). |
| R28 | rc-patch | **The panel inset and height jump between tabs:** 8 px vs 20 px, and hug vs stretch. | GD GD-22 (1) | UX-HIER-5 | `08-left-panel/01-canvases-tab.png`, `08-left-panel/10-layers-tab.png` | Not covered. |
| R29 | rc-patch | **Motion.** Islands come back with a centred fade instead of growing out of their icon. Advanced folds snap open. Sonner toasts run at 400 ms with a `height` transition. Hand-rolled durations escape reduced motion. | MO M10, M12, M13, M14 (1) | UX-MOT-2/4, UX-TOK-1, new UX-MOT-6 | `07-ai-chat/05-chat-and-inspector.png`, `04-inspector/02-artboard-advanced.png` | Not covered. |
| R30 | rc-patch | **Copy sweep.** What's new has three link names and CLI words in its entries. The Present menu says "no chrome, no pins". No results is missing its AI half. The format toast says "still saves the old way" and "accepted revisions". | CP CP-04, CP-18, CP-25, CP-40 (1) | UX-COPY-1/3; CONTRACT §4 | `01-home-new-project/19-home-whatsnew.png`, `05-preview-vs-edit/10-present-options.png`, `08-left-panel/04-search-no-match.png` | Not covered. Check CP-40 against `c848d35b0`, which rewrote the neighbouring lines. |
| R31 | rc-patch | **New project: Create stays enabled with an empty name**, and "Untitled project" is a placeholder acting as the value. | CP CP-07 (1) | UX-FORM-2 | `01-home-new-project/08-new-project-empty-name.png` | The Location half is **fixed in r1-home-tabs `23afb1b93`**. |
| R32 | rc-patch | **The print callout's "Fix size" is plain text**, not a button. | GD GD-35 (1) | UX-HIER-8, UX-ACT-4 | `12-light-theme/02-selection-inspector-light.png` | Not covered. |
| R33 | rc-patch | **The project menu root may not start with "Back to Home".** | IA IA-37 (1) | CONTRACT §1 | `11-palette-settings-menus/04-project-menu.png` | **verify-in-app** (may be shell-only). |

### Covered by the merged fixes (not counted)

| seats' ids | what | covered by |
| --- | --- | --- |
| UA U12 | ⌘D made no visible duplicate | r1-canvas-tools `e6a227a28` (⌘D +10/+10, selected; decision `v2-michal-duplicate-offset-10`) |
| DE D15 · IA IA-21 (V half) · CP CP-19 · AX A2 (V half) · IA T3 · DE T3 | Preview has no pointer or Select; V leaves Preview; no marquee or ⇧-click | r1-preview-comments `cd6b06963`, `1b55ae8e9` (decision 17, `v2-michal-preview-multiselect-marquee`) |
| CP CP-37, CP-38, CP-39 · CP T3, T4 | the two new format lines, and CONTRACT §6 still saying "never updates by itself" | r1-roleless-signin `c848d35b0` (host named; one not-signed-in line; §6 rewritten), `17551ec58` |
| UA U27 | developer rows (paths, `<DCArtboard>`) visible because Advanced was kept open | r1-panels `58a74c980` (folds closed by default). Residue check only. |
| part of F11 / CP-07 | target menu layering, same-name rows, Home pill height, Location said twice | r1-home-tabs `35867e4ec`, `23afb1b93` |
| (Michal's own, excluded by every seat) | Pen close, tool panel hover, drag back, ⌥-drag, clipboard, Assets drop, quiet-picture tip, comment hover, panel widths, chat, shell scroll, DS specimens, stale localhost link, empty Move to… | the r1 merges listed in `git log 20b4215eb..97a610d61` |

## Taste decisions

Only the questions whose answer depends on Michal's taste. **Dropped, because they are already decided:**
- V in Preview and Preview multiselect (17).
- ⌘D +10.
- The roleless Sign in line (A).
- The dead linkedHub (1C).
- DS specimens as artboards (9A).
- The two format-line wordings (shipped in `c848d35b0`).
- The comment author: CONTRACT §4 already says "You", so DE T6 is not taste.

### TD1 · Modes: name, switch, keys, motion
Seats: UA T1/T2/T5, DE T2/T4, IA-22, AX T1, MO T1/T4, GD T3.

This collides with recorded decisions:
- "two toolbars — Edit makes things, Preview annotates";
- V2-4.5b (crossing keys);
- `v2-S3.9-camera-ease-engine`.

Any change supersedes them explicitly.

- **(a) Name of the annotation mode.**
  - **a1 keep "Preview":** no seat.
  - **a2 "Review":** UA. One word for what the mode holds (comments, stickies, stamps).
  - **a3 split into Preview + Annotate:** no seat. A fourth mode.
  - *Trade-off:* a rename touches CONTRACT §2/§3, the registry, the v2-words ratchet and every board. It is cheap now and costly after rc.
- **(b) The mode switch.**
  - **b1 a labelled segmented control "Edit · Preview" plus the Present icon:** UA, DE.
  - **b2 label only the active segment:** IA.
  - **b3 icons with tooltips, as now:** no seat.
  - *Trade-off:* b1 is always readable but costs about 80 px of top-right width. b2 halves that, but the mode you'd switch to stays a glyph.
- **(c) Annotation keys pressed in Edit.**
  - **c1 keep the switch, add a persistent label, and never fire while a caret or field is live:** UA, DE.
  - **c2 N/C arm the tool inside Edit with no mode change:** AX. One key, one meaning.
  - **c3 the first press asks once:** no pick.
  - *Trade-off:* c1 keeps the contract and needs F01's focus guard anyway. c2 removes the surprise but blurs "Edit makes, Preview annotates".
- **(d) What moves on a crossing.**
  - **d1 the same frame; only the toolbar contents and the toggle change:** GD.
  - **d2 the camera stays still unless the artboard would be hidden, with a 0/40/120 ms stagger:** MO.
  - **d3 as now:** no seat.
  - *Trade-off:* d1 and d2 are compatible (frame constancy plus a still camera). Together they are the larger rc change, because they touch the S3.9 engine and the C5 fold.

### TD2 · What "New canvas" opens
Seats: UA T3, DE T1, CP T5, IA-17, IA-31.

- **a. An empty canvas with the size picker open, named "Untitled canvas" in place; the brief is opt-in:** UA, DE, CP. CP keeps the brief only as ⌘K "New brief canvas".
- **b. An empty canvas with one default artboard** (Desktop, or the last size used): no seat.
- **c. Keep the brief board as the default, rewritten in v2 voice:** no seat.

*Trade-off:* (a) matches Figma and Framer and removes the v1 words. It demotes the AI-first brief flow that Phase 22 built, so the open sub-question is whether the brief survives in v2.0 at all (CP T5 b drops it; IA-31 drops "New brief" from ⌘K).

### TD3 · The default look of a new object
Seats: UA T4, DE D2, IR-11, GD-10. This conflicts with `dcd91f6b3`'s shipped `var(--accent, currentColor)`.

- **a. Neutral role tokens:** shape = surface or border role, frame = the surface fill, text = the DS body role or else the system UI sans. UA, DE, IR-11, GD.
- **b. The accent, as shipped** (`var(--accent, currentColor)`): no seat.
- **c. currentColor** (#8's fallback): no seat. IR-11 forbids it.

*Trade-off:* (a) never shouts and never vanishes, but needs a fallback role when a project has no DS. (b) is already merged and visible, but it spends the signal colour on every rectangle, and its fallback can read near-black in dark chrome.

### TD4 · The left panel when the Inspector opens
Seats: UA U04, DE T5, MO T2, AX A3. Recorded decision: `maude/v2-s6-16b-canvases-fold-panel-only`.

- **a. Fold only below the width where both islands fit** (about 1280 px), with about 600 ms of hysteresis on restore: UA, DE, MO.
- **b. Never auto-fold;** at narrow widths the Inspector overlays the canvas: no seat.
- **c. As now, but remember a person's manual unfold:** no seat.

*Trade-off:* (a) keeps Layers in view where it fits and still protects small windows. (b) is simplest, but covers the canvas on a 13" screen.

### TD5 · Where "What's new" and first-run hints live
Seats: GD T4, MO T3, UA U18, DE D9.

- **a. Home line plus the Help › What's new badge only, never a canvas toast:** GD.
- **b. One toast slot, queued; the mode hint first and What's new after it, self-dismissing after about 8 s:** MO, UA, DE.
- **c. Merge into one pill, "You're in Edit · What's new (3)":** no seat.

*Trade-off:* (a) removes the problem class but makes the update quieter. (b) keeps the announcement at the cost of a queue the shell doesn't have yet.

### TD6 · Export entry points
Seats: IA T1, DE D27, UA U25, IA-30, CP-13.

- **A. Keep root plus File, as the contract has it:** no seat.
- **B. Root only;** File drops it: IA.
- **C. File only, with ⇧⌘E:** no seat.

*Sub-question,* the Inspector's export rows:
- keep "Export 1 file" plus Copy as PNG and drop "Export… — every option" (IA);
- or keep it, renamed "Export… ⇧⌘E" (CP).

*Trade-off:* (B) keeps the one-click trio Version history · Share · Export together, but leaves File without its conventional Export row.

### TD7 · Inspector O1–O4, plus where its explanations go
Seats: IR §4, AX, GD, CP. All three seats that spoke pick ★ on every option, so the panel can likely confirm these quickly.

- **O1 density:** ★a calm, 28 px rows (AX: 24 px is exactly the 2.5.8 floor). b compact. c collapsible.
- **O2 picker:** ★a popover from the chip (GD, provided it is the top layer and collision-aware). b inline. c split.
- **O3 paint naming:** ★a section "Fill", row Background / Fill / Colour by kind (CP). b "Background". c "Fill" plus a hint.
- **O4 scrub handle:** ★a the label or icon inside the field, not a separate tab stop (AX). b the row label. c a hover grip.
- **O5 helper prose (GD T6, DE D35):**
  - a: behind a "?" on the section title (GD);
  - b: at most one fg-3 line per section;
  - c: as now.

*Trade-off on O5:* (a) clears the face but hides "why can't I set X" until asked. (b) keeps one line visible.

### TD8 · The cloud's name and Share's primary verb
Seats: CP T1, CP-06; F07's verbs from DE, IA, UA.

- **a. "Maude Cloud" in every title and line;** the domain only under Advanced. The verb is "Move to Maude Cloud…". CP, UA.
- **b. "cloud.maude.sh" everywhere:** no seat.
- **c. "the cloud" in running copy and "Maude Cloud" in titles;** the verb stays CONTRACT's "Move to cloud…". DE.

*Trade-off:* (a) is one noun to learn and gives CONTRACT §3 a new row. (c) reads lighter but keeps two names.

### TD9 · The chrome's visual language
Seats: AX T2, GD T1, GD T2, GD T5.

- **(a) Selected vs focus.**
  - **a1 selected = filled wash with no ring, so the ring means focus:** AX.
  - **a2 keep the selected ring, and make focus a 2 px offset ring in fg-0.**
- **(b) The accent.**
  - **b1 primary action plus selection plus one active state per group;** tags, chips, links and "kept open" go neutral: GD.
  - **b2 primary action and selection only.**
- **(c) Menu vs panel elevation.**
  - **c1 one surface step lighter plus a 1 px border:** GD.
  - **c2 a stronger shadow only.**
- **(d) Edit dims annotations.**
  - **d1 content renders identically in both modes:** GD.
  - **d2 dim only annotations, behind a View toggle.** S4.9 "quiet annotation layer" is a recorded decision.

*Trade-off:* a1 and b1 together free the accent and the ring for one meaning each. The cost is restyling segmented controls, tabs and chips across the kit (a CSS-wide change).

### TD10 · Where creation lives
Seats: IA T4, UA U10, F10's seats.

- **(a) New artboard.**
  - **a1 File › New artboard › (presets):** IA, UA.
  - **a2 Edit › Advanced, as now (the contract).**
  - **a3 the face of Edit.**
- **(b) What I (Image) does.**
  - **b1 opens the Mac file chooser at once and places at the next click:** UA, DE.
  - **b2 a picker anchored to the toolbar (Assets · From this Mac… · Generate):** IA, MO.
  - **b3 a command that opens Assets with "From this Mac…" focused and is not a held tool:** AX.
- **(c) Tool tooltip naming.**
  - **c1 "Artboard / Frame (F)", which explains the two once:** UA.
  - **c2 separate tools.**

*Trade-off:* b1 is the fastest path and matches Figma's ⇧⌘K. b2 keeps Assets and Generate one click away without moving the left panel.

**Small calls the lead can settle without the panel:**
- IA T2 C: a sort glyph on the count.
- IA T5 C: an artboard row in Canvases jumps to Layers.
- AX T3 a: the tab × always shown at 40 %, with a 24 px hit box.
- AX T4 a: show Settings' Done.
- CP T2 a: the "kept open" chip becomes a pin glyph with the tooltip "Stays open next time".

## Fix packages

Before any builder starts: **P0 verify sweep (scout, about 0.25 d).** Run the `.app` on the merged tip, at an unlocked screen with `NO_OPEN=1` and a fixture clone. Cover:
- the verify-in-app rows: F04 (?), F14 (pin click), F15 (object menu), F20 (DS canvas), F21 (AI entry) and R33 (Back to Home);
- the verify-on-tip rows: F02 (frames, fallback colour), F16, F19, F22, F26, F32, F35, R05;
- whether the What's-new toast really persists (F03).

A row that doesn't reproduce is closed, not built. F21 becomes a blocker if it reproduces.

| package | items | files (owner) | waits on | est. |
| --- | --- | --- | --- | --- |
| **P1 · Canvas tools + new-object defaults** (Opus builder; touches `canvas-lib.tsx` / `input-router.tsx`, so WebKit re-measure) | F01 text tool (place at pointer, caret, focus guard for crossing keys, default font); F02 frame and shape defaults; F10 Image tool; F22 Inspector re-read on drag end (canvas → shell geometry message); F25 overlays under chrome; R05 pen stray square; R23 frame new artboard | `apps/studio/input-router.tsx`, `canvas-lib.tsx`, `edit-ops/insert-shape.ts` + the text insert, `editing/pen/*`, `use-keyboard-discipline.tsx`, `actions/defs/tool.ts` | F01, F22, F25 and R05: none. F02 waits on **TD3**. F10 waits on **TD10 (b)**. | 2.5 d |
| **P2 · First canvas, Canvases panel, Home entry** | F06 new canvas / new folder in place, no slash command or "Claude"; R22 hint; F18 row menu; F20 pinned Design system row (if P0 reproduces it); F24 Layers eye/lock/search; R07 chips; R08 Canvases › Advanced; R13 Recent; R26 search badge; R28 inset; F11 Home New project button, one create route, row name, flat Home menu; R31; R17 | `client/tree/tree.jsx` (+ testids, the frozen v1 manifests for the aria-label), the Layers panel, `home/*` (`home-menu.js`, the target menu, `create-local`), `TESTIDS.md`, `testids.json` | F06's landing state waits on **TD2**. The rest doesn't. | 2 d |
| **P3 · Shell chrome + modes** (touches `app.jsx`: run the boot check plus `opening-card-clears.mjs`) | F03 toasts (one queued slot, z-order menu > popover > toast, dismissal); F12 fold rule plus the focus guard; F27 tab `onPick` selects only; F05 mode label, pill constancy, polite live-region announcement; F13 crossing-key behaviour; F26 Preview undo/redo; F34 submenu aim; F35 panel overflow; F28 focus-ring CSS plus a pin test (shell and Layers rules; the `.insp-*` rules are coordinated with P6); R12 and R29 motion; R25 View menu rows | `notifications.tsx`, `hooks/use-shell-core.jsx`, `v2/shell/inspector-follow.js`, `app.jsx` (`:3184/3234` only), `v2/shell/project-pill.jsx` (+ `home-menu.js` aim), `share-cluster.css`, `v2/preview/preview-bar.jsx`, `toolbars/toolbar-css.ts`, `floating-panels.css` | F03 waits on **TD5**. F12 waits on **TD4**. F05, F13 and R12 wait on **TD1**. F27, F34, F35, F28 and the announcement don't wait, so they can go first. | 2.5 d |
| **P4 · Comments** | F08 identity ("You", one initial, Mine count); F14 pin click opens the thread and keeps the mode (if P0 reproduces it); F19 pin on the element, composer beside it, titled with the element; F16 bubble glyph; F33 ↵ places a comment or sticky; R09 strings, row echo, the always-on toggle | `client/comments-overlay.*`, the comments panel, `actions/defs/tool.ts` (`tool.create-default` scope; one registry entry, then regen), the Preview toolbar glyph | None. CONTRACT §4 decides the author. | 1.5 d |
| **P5 · Menus, ⌘K, Export, Share** (registry-driven: `node scripts/gen-actions.mjs`, then `--check`) | F15 object context menu (if P0 reproduces it); F17 empty-canvas menu rows and keys; F09 ⌘K grouping and words; F04 ? routing plus a crawler rule (if P0 reproduces it); F23 New artboard placement and tooltip; F07 Share primary verb, Advanced summary, loopback links demoted; F36 cloud noun (CONTRACT §3 row); F32 cross-canvas paste confirm that takes focus; R02 export routes, Scope, Print PDF tick; R24 keys on rows; R01 Settings words, Account button, visible Done; R14 version author; R30 copy sweep | `apps/studio/actions/` (defs, `menu.actions.json`), the palette, the share sheet, the export sheet, `hooks/use-canvas-bridge.jsx` (paste), settings, `.design/system/maude-v2/CONTRACT.md` §1–§3 (+ `contract-voice` regen) | F07 and F36 wait on **TD8**. R02 waits on **TD6**. F23 waits on **TD10 (a/c)**. F09 waits on **TD2** for "New brief". The rest doesn't. | 2 d |
| **P6 · Inspector** (the existing plan, `inspector-ux-rules.md` §5 T0–T6, up to 4 builders; T4 and T6 run serially) | IR-1..17 plus F30 picker keyboard (into T2); F31 collision-aware popover (T2); R03 header named once (new IR); R04 prose (O5); R11 (IR-5, IR-13, IR-16 columns, `esc` kbd, pills); F02's IR-11 slot defaults (T3, shared with P1: P6 owns `sections/fill.jsx`, P1 owns insert-shape) | `client/v2/inspector/**`, `client/inspector/ds-tokens.js`, `client/inspector-controls.jsx`, board `.design/ui/v2/14 Editing.tsx` (T0 first, owning-board rule) | **TD7** (O1–O5) blocks T0. TD3 settles T3. | 5.5 d builder plus 0.5 d T0 |

**Collisions to watch:**
- P1 and P3 both read crossing keys. P1 owns the focus guard in `input-router.tsx`, and P3 owns what the mode does after it.
- P3 and P6 both edit focus-ring CSS. P3 owns the pin test and the non-`insp-*` rules.
- P2 and P5 both touch the testids lists. Merge them in order: P2, then P5.

**Wall-clock.** About 3 days with P1, P2, P4 and P6's T1 running in parallel while the taste panel sits. P3 and P5 start on their no-taste items, and P6 T0 starts once TD7 lands.

```json
{"blockers": 2, "before_merge": 34, "rc_patch": 33, "taste": 10, "verify_in_app": 6}
```
