# copy-critic — UX audit rc.1 (seat: copy)

_2026-10-31 · product 20b4215eb · shots under `../shots/` · rules: ux-patterns (COPY, FORM-2, DLG) + `.design/system/maude-v2/CONTRACT.md` §3–§4 (words, voice) · ~40 shots read_

Michal's 20 findings are not re-reported. Where my lens adds a word-level angle to one of them, the row says
"known". I agree with the Inspector rules IR-5 and IR-7 and with O3 a. CP-12 extends IR-5 to Border and Stroke.

**Not judged (no evidence):**
- AI chat: sending was not captured, and 07/01 shows no chat panel.
- Settings › Advanced: the shot shows Connections.
- Design system canvas: it did not open in 10/01–03.

## Findings

| id | flow | shot | rule | kind | severity | what's wrong | recommended fix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CP-01 | 2 | 02-first-canvas/01-new-canvas-menu.png, 03-empty-canvas.png | CONTRACT §3 (board, Claude), §6 empty-canvas line; UX-COPY-1 | c | before-merge | "New canvas" asks for a "brief board name…". It lands a "Brief — annotate me" artboard: "Empty brief board — annotate me … then run /design:new again to have Claude read your notes". That puts v1 words, a slash command and "Claude" in the first thing a designer sees. | New canvas makes "Untitled canvas" with no name field. The empty line is the contract's: "Your canvas is ready. Ask AI for a first draft, or start drawing." (T5) |
| CP-02 | 2/8 | 08-left-panel/08-new-folder.png | UX-FORM-1, UX-FORM-2 | c | before-merge | The inline name fields have only a lowercase placeholder ("folder name…", "brief board name…"). It vanishes on typing, and there is no visible label. | Prefill a real value ("Untitled folder", selected). Use sentence case. |
| CP-03 | 3 | 04-inspector/04-artboard-fill-dropdown.png | UX-COPY-1; CONTRACT §2 | c | rc-patch | The empty-artboard hint "…or let AI start it from Brief — annotate me." uses another artboard's label as a noun. The heading ends in a period. | "Empty artboard" · "Draw a frame (F), place an image (I) or a component (⇧I), or ask AI to start it." |
| CP-04 | 1/2 | 01-home-new-project/01-home-default.png, 19-home-whatsnew.png; 02-first-canvas/03-empty-canvas.png | UX-COPY-1, UX-COPY-3 | c | rc-patch | The What's new link has three names: "See what's new" (Home), "See all (3)" (canvas toast) and "What's new · 3 new" (Help). The panel body uses CLI words: "scale=2", "--out can be a folder", "a bare zip export just works". | One link: "See what's new". Write each entry as the designer's outcome, e.g. "Exports match what you pick — crop marks and bleed included". |
| CP-05 | 1 | 01-home-new-project/03-home-target-menu.png | UX-COPY-1 | c | rc-patch | The last row of the target menu, "a project on this Mac", is a lowercase fragment. It doesn't say it makes a new project, and it routes differently from File › New project… (INDEX). | "New project on this Mac…", opening the same Create-a-local-project dialog. |
| CP-06 | 1/9/11 | 01-home-new-project/01-home-default.png; 11-palette-settings-menus/20-settings.png, 21-settings-connections.png | no rule: "One product noun per service — a domain is an address, not a name"; CONTRACT §3 has no row | c | before-merge | The cloud has four names: "Sign in to cloud.maude.sh" (Home), "Manage on cloud.maude.sh" (Settings), "Maude Cloud" (format lines), and "the cloud" / "in a cloud project" (Share, Present). | Add a §3 row (T1). |
| CP-07 | 1 | 01-home-new-project/07-new-project-advanced.png, 08-new-project-empty-name.png | UX-FORM-2; M2 | a | rc-patch | The Advanced summary hint "Location" repeats the "Location" row inside it. The Name field's "Untitled project" is a placeholder that acts as the value, and Create project stays enabled when the field is empty. | Hide the summary hint once the fold is open. Make "Untitled project" the selected value, not a placeholder. |
| CP-08 | 3/11 | 03-edit/17-context-empty-canvas.png vs 11-palette-settings-menus/07-menu-view.png | CONTRACT §2 (⌘0 Zoom to fit, ⇧0 Actual size) | c | before-merge | The empty-canvas menu has "Fit to view 1" and "Reset view ⌘0". The View menu has "Zoom to fit ⌘0" and "Actual size ⇧0". So ⌘0 has two names, and a third key appears. | Copy the View menu rows verbatim. |
| CP-09 | 3/9 | 03-edit/17-context-empty-canvas.png | CONTRACT §6 Export (one sheet with Scope); M4 | a | before-merge | The same menu offers "Export canvas as separate…" (the phrase stops mid-thought) and "Export project (ZIP)…". These are v1 exports next to the one Export sheet. | One row, "Export… ⇧⌘E". The sheet's Scope already covers This canvas and Whole project. |
| CP-10 | 4 | 03-edit/15-context-object.png, 04-inspector/06-path.png | UX-COPY-1; no rule: "A number in a sentence carries its unit" | c | rc-patch | "Constraints keep Rectangle 57 from the left and 286 from the top" reads like an object named "Rectangle 57". The path card adds "Pins show what the file says. Select the object again to change them." ("pins" already means comment pins, and "the file" is code talk.) | "…keep it 57 px from the left and 286 px from the top." · "These show the saved constraints. Select the path again to change them." |
| CP-11 | 4 | 04-inspector/06-path.png, 03-edit/01-text-click-placed.png | M2; UX-HIER-3 | a | rc-patch | The header states the kind 3–4 times: breadcrumb "Mobile › Rectangle", title "Rectangle", chip "Shape", row "Kind · Rectangle". A text reads "Text · Text · Text"; a frame reads "Frame · Frame". | The title is the layer name. Show the chip only when it adds something. Drop the Kind row when the chip already shows it. |
| CP-12 | 4 | 04-inspector/08-frame-advanced.png, 06-path.png | extends IR-5; UX-COPY-1 | c | rc-patch | The section/row echo that IR-5 fixes for Fill also hits "Border › Border · None" and "Stroke › Stroke". | Each row says what it sets: "Colour" and "Width". |
| CP-13 | 4 | 04-inspector/04-artboard-fill-dropdown.png, 08-frame-advanced.png | UX-COPY-1; CONTRACT §6 Export | c | rc-patch | Next to the "Export 1 file" button sits a second row: "Export… — every option". | "Export… ⇧⌘E" with the hint "All formats and scope". |
| CP-14 | 4 | 03-edit/16-context-artboard.png | CONTRACT §4 (the app never names itself); UX-COPY-1 | c | rc-patch | The Theme option "Follow chrome" has the help "Follow chrome tracks the studio's light or dark; the others pin this artboard." "Chrome", "studio" and "pin" are builder words. | Option "Match the app". Help: "Follows the app's light or dark. Light or Dark keeps this artboard in one theme." |
| CP-15 | 4 | 07-ai-chat/05-chat-and-inspector.png, 03-edit/01-text-click-placed.png | UX-COPY-1 | c | rc-patch | "It sits where its frame's layout puts it. Place freely makes X and Y yours." names a control that isn't on the card, while X and Y look editable. | "Its frame's auto layout places it. To set X and Y, pick Place freely in Layout." Show X and Y read-only. |
| CP-16 | 4 | 03-edit/15-context-object.png | UX-COPY-1 | c | rc-patch | "Shadow · Flat · This system has no shadow steps." appears in a project with no design system, and "steps" is a word from inside the design system. | "No shadow tokens yet." Or hide the line when there is no system. |
| CP-17 | 3 | 03-edit/09-sticky.png | CONTRACT §2 (↵ glyph) | c | rc-patch | "⌘Enter commits and creates the next one beside it." "Commits" is git talk, and "Enter" breaks the ↵ rule. | "⌘↵ adds the next sticky beside this one." |
| CP-18 | 5 | 05-preview-vs-edit/10-present-options.png | UX-COPY-1; CONTRACT §4 | c | rc-patch | The Present menu's hints say "no chrome, no pins". "Presenter view on another…" is cut off. "in a cloud project" is used as the reason a row is off. | "Panels hidden" · "Presenter view — needs a second display" · "Needs a Maude Cloud project" (T1) |
| CP-19 | 5 | 05-preview-vs-edit/05-preview-mode.png, 06-preview-press-v.png | CONTRACT §2 (no V in Preview; esc steps back) | d | before-merge | The banner names one way out ("esc to edit"), but V also leaves Preview, silently. | V does nothing in Preview, which matches the contract. |
| CP-20 | 6 | 06-comments/06-comment-on-empty-space.png, 08-open-pin.png | CONTRACT §4 People ("You") | e | before-merge | Your own comments show the author "Smoke" (the canvas name) with a "U" avatar, while the top bar shows "Y". The "Mine" filter reads 0 after two posts. | The author line is "You", with the same initial and colour as your face. Mine counts your comments. |
| CP-21 | 6 | 06-comments/03-comment-on-element.png, 07-two-comments.png | UX-FORM-2; UX-ACT-8 | c | rc-patch | The placeholder "Add a comment — @ mentions someone" is a fragment. Pins draw "?", which reads as help or unknown. The composer header names the canvas, not the element. | "Add a comment. Type @ to mention someone." The pin shows the author's initial. The header names the element. |
| CP-22 | 8 | 07-ai-chat/02-chat-advanced.png | CONTRACT §7 Trash words | c | rc-patch | "Trash · Empty · Open": "Empty" reads as the destructive verb, right next to a button. "Design system · Make a design system" wraps a 4-word button under a label that says the same thing. | "Trash · nothing in it · [Open]". Button "Make one…". |
| CP-23 | 8 | 08-left-panel/06-row-actions.png | M4; UX-COPY-1 | a | rc-patch | The row menu has both "Rename" and "Rename file…". "Open in the Mac app" doesn't say which app. "Copy link" shows on a local project, which has no link. | Keep Rename. Move "Rename file…" to Advanced only. Name the target app. Hide Copy link when there is no link. |
| CP-24 | 2/8 | 02-first-canvas/05-frame-tool.png, 08-left-panel/05-sort-menu.png, 04-inspector/01-artboard.png | CONTRACT §6 [C16] | c | rc-patch | There are three kind vocabularies: the chip says "Web page · Fixed size · Print · Video", the size picker groups "App · Web page · Social · Print · Video", and the sort hint says "web · social · print · video". The picker also has "FB event cover" and "Story (still)" next to "Reels (moving)". | Use the C16 kind words everywhere. Groups may stay presets ("Apps", "Social"), but each shows its kind chip. "Facebook event cover" · "Story 9:16 · still" / "Reel 9:16 · video". |
| CP-25 | 8 | 08-left-panel/04-search-no-match.png | CONTRACT §4 No results | c | rc-patch | "Nothing called "zzzz". Try another word." leaves out the contract's AI half. | "…Try another word, or ask AI to find it." |
| CP-26 | 8 | Michal img 18 | known (Michal 18), word angle only; no rule: "A layer's name is the thing; a component's name appears once, on its instance" | c | known | Every descendant repeats "Lane" or "Card" in an unlabelled right column, while the rows themselves read "Frame · Frame · Frame". | Name the instance row "Lane", with the component glyph. Children keep their own names. Drop the echo column. |
| CP-27 | 9 | 09-share-export-history/01-share-open.png | CONTRACT §6 Share ("Move to cloud…" lives inside it); UX-ACT-1 | b | before-merge | The local-project Share sheet says "Invite people once it is in the cloud." and offers no way to get it there. | One primary button, "Move to cloud…", under that line. |
| CP-28 | 9 | 09-share-export-history/02-share-advanced.png | UX-COPY-1 | c | rc-patch | The Advanced summary promises "Links, link rules, sync". Inside are only "Other ways in", an App link and "This Mac only http://127.0.0.1:4450/…". | The summary lists what is inside ("App link, address on this Mac"). Rename "This Mac only" to "Address on this Mac". |
| CP-29 | 9 | 11-palette-settings-menus/01-command-palette.png | CONTRACT §6 Share | c | rc-patch | ⌘K says "Copy share link"; the Share sheet says "Copy link". | "Copy link" |
| CP-30 | 9 | 09-share-export-history/03-export.png | UX-COPY-1; M3 | e | rc-patch | With Print PDF picked, the sheet offers "Include annotations", then says "Print files never carry them — pick PDF for a review copy." The Advanced summary ("File names, colour, scale") repeats rows already shown. The file name reads "Print — Print 1@1x.pdf". | Disable the tick for Print PDF and show that line as the reason. The summary lists only what Advanced holds. Name the file "Print — A · přední.pdf". |
| CP-31 | 9 | 09-share-export-history/04-version-history.png | CONTRACT §4; UX-CONT-1 | c | rc-patch | The first version's author is "maude-migration", a raw id. | "Updated for Maude 2" |
| CP-32 | 11 | 11-palette-settings-menus/01-command-palette.png, 02-palette-typed-new.png | CONTRACT §2 moved keys ("New video"), §3 ("Ask AI"); M4 | a | before-merge | ⌘K lists both "New video…" and "New video", plus an unexplained "New brief". It says "Generate with AI…" where the contract's verb is Ask AI. | One "New video". Rename "New brief" or remove it (T5). "Ask AI…" |
| CP-33 | 11 | same shots | CONTRACT §7 [A9]; UX-COPY-1 | c | rc-patch | "Open design system view" is a v1 idea, listed under View. The group header "Actions · 7 hidden tools" sits over seven New-artboard rows. Recent rows carry the tag "ui", which is a folder name. | "Open Design system". Header "Actions". Drop "ui", or show the kind instead. |
| CP-34 | 11 | 11-palette-settings-menus/03-shortcuts-sheet.png, 08-menu-help.png | CONTRACT §2 (? = all shortcuts) | e | before-merge | Help lists "Keyboard shortcuts ?", but ? opened nothing, so the label promises a dead key. | Bind ? through the registry. |
| CP-35 | 11 | 11-palette-settings-menus/20-settings.png | CONTRACT §1 (View › Advanced › "Open inspector on select") | c | rc-patch | One setting has two names and two casings: "Auto-open Inspector on select" (Settings) and "Open inspector on select" (menu). | Use the menu's words in both places. |
| CP-36 | 4/8/9/11 | 07-ai-chat/02-chat-advanced.png, 09-share-export-history/02-share-advanced.png, 04-inspector/08-frame-advanced.png, 11-palette-settings-menus/21-settings-connections.png | no rule: "A fold's state is its chevron; a chip names content, never state" | c | rc-patch | Every opened Advanced wears a pin chip, "kept open". It reads as a status of the thing, not "stays open next time". Settings › Connections nests two more "Advanced" folds under an "Advanced" tab. | T2. Rename the in-page folds by their content (e.g. "Cloud address", "Providers"). |
| CP-37 | 1 (format) | `format-update.js` `olderLinkUnconfirmed` (new line 1) | UX-COPY-1; CONTRACT §4 (what · safe · one verb) | c | before-merge | See "The two new lines" below. | Rewrite as shown below. |
| CP-38 | 1 (format) | proposed line 2 | UX-COPY-1; CONTRACT §4 | c | before-merge | See below. | Rewrite as shown below. |
| CP-39 | 1 (format) | `CONTRACT.md` §6 "Project format" | CONTRACT is the source of truth | c | before-merge | §6 still says a format-1 project "never updates by itself" and describes an Update dialog. The shipped lines and both new ones say "moves to Maude 2 by itself" (decision `v2-michal-drop-v1-auto-convert`), so specimens copied from §6 are wrong. | Rewrite §6 to the auto-convert lines in the same package as the two new lines. |
| CP-40 | 1 (format) | `format-update.js` SAVE_COPY, `toastUpdated` | UX-COPY-3; CONTRACT §3 | c | rc-patch | "still saves the old way" and "saves with accepted revisions" are engine words a designer can't act on. | "View only — this project needs a one-time update to sync with the team." The toast drops "accepted revisions" and keeps "A copy of the old files is in Version history, on this Mac only." |

## The two new lines

What both get right:
- They open with the "View only —" prefix.
- They use the contract word "team server".
- They state the outcome ("moves to Maude 2 by itself").

**(1)** "View only — this project says it syncs with a team server that isn't connected on this Mac. Connect it, and
the project moves to Maude 2 by itself." [Connect]

What works:
- "says it syncs" is honest. The link comes from a committed file this Mac never made, so the line shouldn't assert it.

What's wrong:
- **It doesn't name the server.** The user is asked to connect to an address a file planted. That is exactly why gate-b-sec4 parks the link. Naming the host is both the clear version and the safe one.
- "Connect it": "it" could mean the project or the server.
- Line (2) names `<hub>` and this one doesn't, so the pair is inconsistent.

→ **"View only — this project points to a team server this Mac isn't connected to: `<host>`. Connect to it, and the
project moves to Maude 2 by itself."** [Connect]

**(2)** "View only — this Mac's link to `<hub>` doesn't say who you are. Sign in, and if you own it the project moves to
Maude 2 by itself." [Sign in]

What's wrong:
- "doesn't say who you are" describes the mechanism, not the state. To the user the state is simply "not signed in".
- That state already has its own line, `olderNotSignedIn`: "this Mac isn't signed in to the team server for this project" + Sign in. That makes two lines for one state the user can't tell apart.
- "if you own it": "it" could mean the link, the hub or the project.

→ **"View only — this Mac isn't signed in to `<hub>`. Sign in, and if you own this project it moves to Maude 2 by
itself."** [Sign in]. Use the same string for `olderNotSignedIn`: one state, one line.

## Taste decisions

- **T1 · The cloud's name** (CP-06, CP-18).
  - a ★ "Maude Cloud" in every title and line; the domain appears only under Advanced and on the web link.
  - b "cloud.maude.sh" everywhere.
  - c "the cloud" in running copy, "Maude Cloud" in titles.
- **T2 · The "kept open" chip** (CP-36).
  - a ★ No text: a pin glyph with the tooltip "Stays open next time".
  - b The words "Stays open".
  - c Keep "kept open" (board 06 as drawn).
- **T3 · Line 1's button** (CP-37).
  - a ★ "Connect", with the host in the line.
  - b "Connect to `<host>`" on the button (long, and 4+ words for a real host).
  - c "Connect…" opening a confirm that shows the host.
- **T4 · Line 2** (CP-38).
  - a ★ Merge it with not-signed-in (one string).
  - b Keep it as its own state: "…this Mac's link to `<hub>` has no account yet."
  - c As proposed.
- **T5 · The brief board** (CP-01, CP-32).
  - a ★ New canvas makes "Untitled canvas"; the brief stays reachable only as ⌘K "New brief canvas".
  - b Drop the brief path from v2.0.
  - c Keep the composer, rename it "Canvas name…", and rewrite the seed copy.

```json
{"blockers": 0, "before_merge": 13, "rc_patch": 26}
```

(CP-26 is Michal's finding 18, so it isn't counted.)
