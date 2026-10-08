# Implementation inventory — 06 Advanced · 10 Share and Collaboration

Sources: `.design/ui/v2/06 Advanced.tsx` (+ `.meta.json`, 25 artboards), `.design/ui/v2/10 Share and Collaboration.tsx` (+ `.meta.json`, 20 artboards), `CONTRACT.md` §1–§7, `_kit.tsx`, `.ai/plans/notes/v2-feature-inventory.md`, `v2-triage-draft.md`, `v2-open-questions.md`. Spot checks in code: `apps/hub/src/role-matrix.mjs`, `apps/hub/src/invites.mjs`, `apps/studio/participants-chrome.tsx`.

Legend: **EXISTS** (inventory ref → v2 home) · **NEW** (no counterpart today) · **PROPOSED** (drawn, but marked "Proposed / Michal to confirm"). Inventory refs use its own section numbers (§1–§19) and file:line where it gives them. `C/` = `apps/studio/client/`, `P/` = `apps/studio/client/panels/`.

---

## Canvas 06 — Advanced

### 0. The decision this canvas encodes (read before building anything)

- **There is no global "Advanced mode" switch** [ad-why]. "Advanced" is:
  1. a **disclosure at the foot of each panel** (`Fold`: one quiet row "› Advanced" plus a hint of 3 or fewer nouns when closed, the body when open; mono text is allowed only inside the body);
  2. **Menu › View › Advanced** (an indented group in the View submenu);
  3. **Menu › Diagnostics** (status words) and its **Advanced** group;
  4. **Settings › Advanced** (the third tab of three: General · Connections · Advanced);
  5. **⌘K Search**: every hidden tool is findable by name, shows its home path, and ↵ runs it;
  6. a **one-shot ⌘K action "Open all Advanced sections"**, inverted by "Close all Advanced sections" [ad-open-all].
- **Folds are remembered per panel, on this Mac** [ad-edge-remember]. Opening one panel's fold never opens another's.
- **Open does not swap rows.** Advanced *adds* a layer under the plain rows, and the plain rows stay put [ad-inspector sub].
- The map [ad-map] lists **124** things that left the default view: 115 homes drawn on this canvas, 7 in other v2 canvases, 2 not drawn yet, 0 deleted. The counts are computed from the `ITEMS` array in the TSX, which is the authoritative ledger. **Use that array as the implementation checklist** (see "Nothing-deleted map" below).
- Out of scope for the count (but still must ship): tools that moved into a toolbar (Line/Ellipse/Polygon/Crop/Export area in Edit › More; Arrow, Highlighter = Marker's 2nd tip, Eraser = Marker option, Section on Preview's toolbar; Insert → Image I + Component ⇧I), Trash (still the Canvases panel's last row), Export's Scope (now on the sheet), and new Advanced rows (fps, codec, colour profile, link expiry, file-name tokens).

### 1. Surfaces / components

#### 1.1 Shared fold component (kit candidate `Fold` / `.k-adv`)
- Closed: chevron + "Advanced" + a hint (e.g. "Code, tokens, CSS"; "Files, folder, Trash"; "Model, images, log"; "Links, link rules, sync"; "Frames, keyframes, the cut as code"; "Scale, colour, file names"; "Branch, git, changed files"; "Folder, tokens, file"; "Hub, commands").
- Open: body with `ASub` subheads, `ARow` (plain-word key on the left, value on the right, often mono, optional Copy icon button), `Cmd` (mono command line + Copy), `Css` rows (property/value; attributes styled differently).
- Optional "kept open" pin chip (title "Stays open next time") when the state is remembered.
- Persistence: per panel id, per Mac (localStorage, or disk-mirrored via `/_api/ui-prefs` like `mdcc-*` keys). Needs a registry of fold ids for Open all / Close all / Reset.

#### 1.2 Inspector › Advanced [ad-inspector] — EXISTS (Inspector §4, CSS tab Advanced/Designer toggle `C/app.jsx:7796`) → the vocabulary toggle becomes this fold
- **Element (button "Book a call") closed rows:** Size 150×48 · Padding "12 · 24" · Fill Ink · Text "SF Pro · 19 · Semibold" · Corners Round. Fold hint "Code, tokens, CSS".
- **Element, open:**
  - *Element*: Tag `a` · Classes `btn btn--primary` · Selector `nav > a.btn` · Element id `cd-4f1a2c` (copy).
  - *Used in*: "Edits apply to: Shared · 4 places" + **Detach** (EXISTS edit-scope strip `C/app.jsx:9779`).
  - *Tokens bound*: Fill `--ink`, Text colour `--paper`, Corners `--radius-pill` (from the token popover, EXISTS `C/app.jsx:6315`).
  - *CSS* (aside link **Edit as text**, NEW): raw rows `padding`, `border-radius`, `background`, `font`, plus the attribute `aria-label`.
  - Buttons **+ Property**, **+ Attribute** (EXISTS RawKnob/AttrKnob `C/app.jsx:8332/8367`).
  - Actions: **Copy style**, **Paste style**, **Copy CSS**, **Copy code** (primary; NEW = copy the JSX of the element).
- **Artboard ("Desktop") closed rows:** Preset, Size, Fill. Open = 08 · ak-advanced sections first, then 06's:
  - *Exact size*: "1440 × 900 px"; Position "x 0 · y 0" + **Reset position**.
  - *Resolution*: Canvas "96 px per inch"; Exports at "2× · 2880 × 1800".
  - *Colour*: Designed in sRGB.
  - *Guides* (aside **Add**): Columns "12 · gutter 24 · margin 80".
  - *Look and layout*: Theme select (DS default · Light · Dark · Follow the app) · Body layout select (Column) · Grid tracks **Edit tracks…** (EXISTS GridTracksEditor) · Layout **Convert to absolute…**.
  - *In code*: `<DCArtboard id="desktop" kind="web" width={1440} height={900}>` snippet; File "Homepage.tsx · line 18" (copy); **Copy code**.
- Caption: "With an artboard selected, ⌘0 fits just that one" (replaces the right-click "Fit just this artboard"). Print artboard adds bleed, trim and the print-shop colour line (→ 08 · ak-advanced).

#### 1.3 Canvases / Layers › Advanced, and Trash [ad-left]
- Left panel = segmented **Canvases · Layers · Assets**, a Search field (⌘K hint), and the tree. **One Advanced per panel; its content follows the active tab.**
- **Canvases closed:** hint "Files, folder, Trash"; Trash is the last row (icon, "Trash", count 12).
- **Canvases open** (shown with "kept open"):
  - Show file names (switch): each row gets a 2nd mono line `Name.tsx`.
  - Show hidden files **H** (switch): sidecars dimmed in place under their canvas (`_history/`, `Combine-kampan.meta.json`, `Combine-kampan.css`), plus the runtime folder at the root (`_canvas-state/`). EXISTS (Show hidden files, RUNTIME · GITIGNORED section).
  - Folder `~/Maude/alligators` (copy).
  - Design system: `system/alligators` + **Open**.
  - Trash: "12 things" + **Open**.
  - Foot: "N of N shown · updated just now" + **Refresh** (EXISTS ⇧⌘R refresh + live dot/count).
  - **Row menu** on a canvas (Advanced on): Reveal in Finder · Open in editor · View code · Copy file path · ─ · Rename file… (NEW except Rename supporting file).
- **Trash panel** (opened from the row or Advanced): back chevron, "Trash", count chip; rows with thumbnail, name, "who · when" ("Jonas · yesterday", "Tereza · 6 Oct, 14:05"), **Restore**; "+ 8 more · 48 MB. Trash keeps things until you clear it out."; **Clear out older than 30 days…**. EXISTS (Sync panel trash restore + prune `P/SyncPanel.jsx`; tree delete) → moves here and to 11 · pn-trash.
- **Layers open:** Show tags and ids (switch; mono tag beside each layer, e.g. `a.btn#cta`, `artboard#post-1x1`) · On this canvas "15 artboards · 214 layers" (replaces the menubar "N ARTBOARDS") · **Select by selector** input (`section#hero a`; NEW) · Element id `cd-91be07` (copy).

#### 1.4 AI chat panel › Advanced (short) [ad-ai] — full spec in 03 · ai-advanced
- Closed: header (spark, chat title "Make it greener", + new, ⌄), messages, ask field with selection chip "◆ Post 1:1", azure send with a spark. Hint "Model, images, log".
- Open rows: Model (select, Opus) · Effort (Low/Medium/High) · Fast mode (switch) · **Ask before** "Replace or move to the trash" (= Permission mode) · **Show in chat** "Normal" (= transcript View) · *Images, video and voice*: Provider (Gemini) · Shape ("As the artboard" = aspect) · Place on the canvas (switch) — from the old GenerateDialog · *This chat*: Context used 38% · 5-hour limit "64% · resets 18:40" · Session `c-mg4x1k-7f3a9`.
- Buttons: **Raw log** (was the tool-call cards) · **Copy transcript** · **Open in terminal** (NEW).
- Hint: "Type / in the field for slash commands. Keys for images live in Settings › Connections."
- EXISTS: CapabilityBar `P/CapabilityBar.jsx:32`, ⓘ popover `P/ChatPanel.jsx:854`, View select `P/ChatPanel.jsx:703`, GenerateDialog `C/generate-dialog.jsx:207`.

#### 1.5 Share › Advanced [ad-share] (same as 10 · co-share-advanced)
- Details in §10 below. Fold hint "Links, link rules, sync". Rows: This link (Who can open · Role · Expires · New people join as) · Other ways in (App link `maude://…` · This Mac only `localhost:4402/?c=…` · Invite by GitHub username) · Where it syncs (Hub · Last synced) · hint "Sync details live in Menu › Diagnostics › Sync."

#### 1.6 Timeline › Advanced, at the foot [ad-timeline] (07 · ve-advanced wins)
- Timeline shows only when a video artboard is selected.
- Closed: play, readout "0:12 / 0:30", artboard name, **+ Title**, **✦ AI clip**, ruler in seconds, tracks (clips, caption track, music waveform), foot "› Advanced  Frames, keyframes, the cut as code".
- Open: readout becomes mono timecode `00:00:12:08 / 00:00:30:00`; the ruler is in frames (0, 150, …); clips show frame counts (`165f`); keyframe diamonds on the caption track (one selected); foot right "30 fps · frame 368 of 900 · 00:00:12:08" + seg **Timecode · Frames**.
- Body, 3 sections: *This video* (Frame rate 30 fps · Size 1080 × 1920 · Codec "H.264 · AAC 48 kHz" · Length 900 frames · Long videos "One part — up to 3 600 frames" = the long-comp badge) · *Keyframe · STAŇ SE GATOREM* (chip "y · opacity"; Easing `cubic-bezier(...)`; y "48px → 0px"; Frames "330 → 342"; **Copy timecode**) · *The cut as code* (seg **EDL · Code**, JSON snippet, "reels-nabor.edl.json · Open in code view").

#### 1.7 Export › Advanced [ad-export] (09 is the source of truth)
- Sheet title "Export 3 artboards"; scope thumbnails + names; rows Scope ("Selection · 3 artboards") · Format (PNG · JPG · PDF · Other…) · Size (1× · 2× · 3×) · Save to (Downloads). Footer **Cancel** / **Export**.
- Fold hint "Scale, colour, file names". Open: *Size* Exact scale (input "2.5×") · For print (300 dpi) · *Colour* profile sRGB · Display P3 · *Files* pattern `{canvas} — {artboard}@{scale}` with a live preview list · *From the terminal*: `maude design export png --scope artboard --option scale=2`, Claude Code `/design:export …`, AI handoff `/design:handoff 2026/combine/Combine-kampan`.
- Side cards: **Exports** list (done / "Rendering · 62%" / done; Show in Finder icon) — "was the export badge in the menu bar; now the Exports icon in the Share cluster" (→ 09 · ex-history) · **Print PDF** when a print artboard is included: Colour "RGB — the print shop converts to CMYK." · Image quality 300 dpi · Text "Keep as text" · Bleed 3 mm · Crop marks · Registration marks · **Other…**: PowerPoint · Canva · Web page (HTML) · SVG · Project ZIP · Code… ⇧⌘H; video adds frame rate, codec, bitrate.

#### 1.8 Version history › Advanced — the git, folded [ad-history]
- Panel header: history icon, "Version history", ⌥⌘H, close.
- Closed list: "Now · Saved" · "14:32 · Made by AI — Post 1:1 greener" (spark dot, selected) · "14:05 · Tereza — Story copy" · "Yesterday, 18:40 · Jonas — A4 · plakát". Actions **Compare**, **Restore this version** (primary). **No commit ids, no branch.** Hint "Branch, git, changed files".
- Open (kept open): Branch select (main) · Drafts `tereza/uniformy-v2` + **Continue** (was "Continue on <draft>") · Remote `github.com/brno-alligators/brand` (copy) · *Changed in this version* (aside SHA `a41f9c2`): file rows with M/A badge + `+14 −6` · inline diff lines · "Not in a version yet": M `brief.md` + **Discard**.
- Git actions (plain words): **Save a version with a note…** · **New branch…** · **Fetch** · **Publish 2 versions** · **Pull a copy to this Mac…** · **Add to main · opens a pull request**.
- Note: Get latest moved to Sync details [ad-syncd].
- EXISTS: GitPanel `P/GitPanel.jsx:520`, RepoBranchSwitcher, IdentityBar "Pull a local copy".

#### 1.9 The old design system view → Design system › Advanced [ad-ds] (superseded by 13)
- Ways in: Canvases › Advanced "Design system · Open" · ⌘K "design system" → row "Design system — alligators · View".
- View: header "Design system › Advanced", DS picker (alligators, "1 of 2 in this project"), close · Colours swatches · Type ladder (Display/Headline/Body/Caption, theme-fixed light) · Components and specimens gallery · fold "Folder, tokens, file": Folder `system/alligators` (copy) · Tokens file "colors_and_type.css · 48 tokens" · Code `MAUDE-DSN/01` · token CSS rows · **Copy token names**, **Open in editor**.
- The S key is freed (S = Section). EXISTS SystemView `C/app.jsx:5115`.

#### 1.10 The one menu [ad-menus] (CONTRACT §1; kit `ProjectMenu`)
- Top of the main menu: a Search row with ⌘K (kit). Main: Back to Home · File › · Edit › · View › · Help › (dot when What's new is unseen) · Version history ⌥⌘H · Share… · Export… ⇧⌘E · Diagnostics › · Settings… ⌘,.
- Rows marked as having taken in old items:
  - **Back to Home** ← browser "← Dashboard".
  - **File › Open project… ⌘O** ← "Open another folder or team project"; **Import from Figma…**, **Import a brand…** ← Quick setup; **Handoff to production ⇧⌘H** ← was in Help/File.
  - **View › Comments ⇧⌘M** shows the note "3 open" ← status bar count; **Present the canvas** ← Presentation mode; **View › Advanced**: Layers as a panel · Inspector ⇧⌘I · Open inspector on select (checked) · Keep timeline open ⇧⌘T · Minimap · Zoom controls · Print guides · Hidden files · Pin panels to the side.
  - **Help**: Keyboard shortcuts ? · Help and guides F1 (holds the old slash commands / opt-out / critic loop sections) · What's new (dot) · Take the tour · Watch the intro · How sharing works · ─ · Report a bug….
- Edit › Advanced = New artboard (Desktop · Laptop · Tablet · Mobile · A4 · Letter) — kit only, not on this artboard.

#### 1.11 Menu › Diagnostics, Advanced open [ad-diag] (a submenu, never a window)
- ① Status rows with StatusWord: **Sync** "Up to date" · **Server** "Running" · **AI setup** "Ready" (states ok/warn/error/busy/off).
- ② **Logs** · **Reload canvas ⌘R** · **Check AI setup again**.
- ③ Advanced group: Address `localhost:4402` · Process `41207` (PID) · Project folder `~/Maude/alligators` · chips **Resync now**, **Download all**.
- Clicking Sync opens Sync details [ad-syncd]; Server and AI setup open their cards [ad-logs].

#### 1.12 Logs, Server, AI setup [ad-logs] — mostly NEW surfaces over existing data
- **Logs** window/panel: seg All · Sync · Server · AI · Export; Filter field; **Copy all**; **Show in Finder**; mono lines `time · source · message` (warn level styled, e.g. "hub replied 429 · retry in 40 s"). Footer "Kept 7 days on this Mac · Help › Report a bug can attach the last 200 lines." (NEW: a persisted, multi-source, 7-day log store; today only a server log tail in the bug report.)
- **Server** card: Running · Showing "Canvas · Combine-kampan" (= old mode stamp) · Live connection "Connected" (= live dot) · Address (copy) · Version "2.0.0 · build 412". Hint: was the status bar's live dot and version, the IDLE · CANVAS · SYSTEM stamp and the port line on the empty canvas.
- **AI setup** card: "Checked just now"; ✓ Claude Code installed 2.1.240 · ✓ Found at `~/.local/bin/claude` · ✓ Signed in "You" · ✓ Plugins ready "design 2.0.0 · flow 2.0.0". EXISTS ReadinessList `P/ReadinessList.jsx:386`.
- Reload confirmation toast "Combine-kampan reloaded."

#### 1.13 Sync details — the old Sync panel, whole [ad-syncd] (Menu › Diagnostics › Sync) — EXISTS SyncPanel `P/SyncPanel.jsx:559`
- Header "Sync · Alligators brand" + StatusWord warn "2 need you".
- **Get latest** row: avatar + "2 new versions from Tereza · Uniformy-2027" + **Get latest** (primary).
- *Needs you · 2*:
  - Conflict card: "Uniformy-2027 changed here and in the cloud." / "Helma z boku — you at 14:02, Tereza at 14:04. Both versions are kept until you choose." → **Keep mine · Use theirs · Keep both** + **Compare** link. (EXISTS SourceConflictPanel has Keep mine/Use theirs; **Keep both is NEW** here, per DDR-116.)
  - Unfinished AI edit: "AI stopped halfway on Combine-video-AI." / "The app quit at 13:58 while AI was cutting the trailer. The half-done cut is on this Mac only." → **Publish · Discard**.
- *Moving now*: transfer rows (mono file name, progress bar, %, ✕ cancel).
- Side: *Counts* Project files "1 318 · all here" · Assets "247 · 2 moving" · Held · rate-limited · failed "0 · 0 · 0" · Trash "12 things — the Canvases panel's last row". Fold "Hub, commands": Hub (copy) · Last good sync · `maude design status` · `/design:rollback Uniformy-2027`.
- "When the sign-in runs out" card: "Sync stopped — the sign-in to the cloud ran out." / "Your changes are kept on this Mac and go out after you sign in." → **Sign in again**.

#### 1.14 Settings › Advanced [ad-settings] (Settings sheet, 3-tab rail General · Connections · Advanced, foot "Maude 2.0.0")
- **This Mac**: Version "2.0.0 · build 412" · Update "2.0.1 is ready" + **Restart now** (was UpdateBanner) · Local server port (editable input 4402; NEW: user-settable port) · Runtime "Bun 1.3.4 · built in" · Server build `maude-dev-srv` (was the Help SKU MAUDE-DEV-SRV) · Keys are kept in "macOS Keychain". Hint: "Or ~/.config/maude/keys.json when the Keychain is off. An update you skip installs when you next quit."
- **Claude Code**: Plugins "design 2.0.0 · flow 2.0.0" · **Use my own plugin copy** (switch; = `MAUDE_NO_PLUGIN_BOOTSTRAP`, DDR-168; NEW as a UI) · **Install and sign in automatically** (switch; EXISTS AutoSetupToggle) · maude in the terminal **Copy install command** · Draw a mark with the SVG agent **Copy command** (was ⌘K "Draw") · Import a brand from the terminal **Copy command** (was BrandUpload "Copy command").
- **Decision memory** (NEW): Remember design decisions (switch) · In this project "523 decisions · kgai".
- **Engines — Auto picks for you**: Subtitles select (Auto) + model card "whisper.cpp · base · 142 MB · On this Mac · Remove · `brew install whisper-cpp`" · Video keyframes select (Auto) + "Gemma 3 · 4B scout · 3.3 GB · Not downloaded · Download · `ollama pull gemma3:4b`". Hint: "Without a model, Auto uses ElevenLabs or Groq for subtitles and ffmpeg scene cuts for keyframes."
- **Privacy** (NEW): Send anonymous usage data (switch off) · Logs in bug reports ("Ask each time").
- **This project — Studio site**: Sync project files, not only canvases (= Sync consent + "Sync project files") · Follow the trash from other devices (= Propagate deletions; hint "Moved to the trash on another Mac — moved to the trash here too. Trash keeps it until you clear it out.") · When a folder first links ("Keep asking" = first-link conflicts) · Who keeps .design/ "This project · Hand over…" (= ownership adopt/detach).
- **Experimental** (NEW): AI reviews argue it out (teams) (= agent-teams debate) · Faster canvas engine (preview).
- **Reset**: Reset panel layout · Close all Advanced sections · **Reset all settings…** (warning style). Hint: "⌘K "open advanced" opens them all, once."

#### 1.15 Settings › Connections [ad-edge-hub]
- Rows (each with its own "› Advanced"): **Maude Cloud** "Signed in as You" + Sign out · **Studio site — your team's own server** "Connected · saved 1 min ago" + Sign out, Advanced open: Address `https://hub.studio-brno.cz` (copy) · Access token "•••• •••• a91f" + **Replace…** · Signed in as `you@studio-brno` · Hub version `maude-hub 2.0.0` · **GitHub** "Not connected" + Connect · **AI images, video and voice** "2 keys · Gemini, ElevenLabs" + Manage · **Figma** "Connected · for imports" + Disconnect.
- Settings › General (theme, account, cloud dashboard, e-mail prefs) is drawn in 02 · ob-settings.

#### 1.16 Pin panels to the side [ad-pinned] — View › Advanced toggle
- Docked layout: left column (project pill, Canvases panel flush and transparent, its fold at the foot) · drag handle · canvas centre · drag handle (active) · right column (Share cluster + inspector flush, Advanced open + "kept open").
- Handle tip: "Drag · double-click resets · ← → move 8" (EXISTS resize grips: drag, arrows, double-click).
- ⌘\ still hides all panels. Each panel keeps its fold.

#### 1.17 ⌘K and ? [ad-search]
- ⌘K "copy" → group **Actions** (aside "6 hidden tools"): Copy code (Inspector › Advanced) · Copy element id (Inspector › Advanced) · Copy file path (Canvases › Advanced) · Copy export command (Export › Advanced) · Copy transcript (AI chat panel › Advanced) · Copy logs (Menu › Diagnostics › Logs) · group **Also**: Copy link (Share). Footer "7 results". **Every hidden action must be registered with its label, icon and `where` path; ↵ runs it without opening the menu.**
- **? sheet** "Keyboard shortcuts" with a "Find a shortcut" field, 3 columns: Edit tools (V H F R P T I ⇧I) · Preview tools "the key switches to Preview" (N C M A E S) + File (⌘N, ⌥⌘H, ⇧⌘E, ⌘,) · Canvas (⌘0 ⌘1 ⌘Z ⇧⌘Z esc) + Panels and AI (⌘\ ⌘/ ⇧⌘M ⌘K ?).
- Fold (kept open): advanced keys with path — Inspector ⇧⌘I (View › Advanced) · Keep timeline open ⇧⌘T (View › Advanced) · Reload canvas ⌘R (Diagnostics). *Keys and tools that moved*: Changes ⇧⌘G → Version history ⌥⌘H · Assistant ⇧⌘A → Ask AI ⌘/ ("⇧⌘A now selects all annotations") · Files tree T → Hide panels ⌘\ ("T is Text") · Hidden files H → Canvases › Advanced ("H is Hand") · Design system S → ⌘K "design system" ("S is Section") · New board N → New canvas ⌘N ("N is Sticky, in Preview") · Search / and ⌘F → ⌘K · Arrow, Highlighter → Preview's toolbar · Section, Eraser → Preview's toolbar · Insert → Image I · Component ⇧I.

#### 1.18 Open all / Close all [ad-open-all]
- ⌘K "advanced" → Actions: **Open all Advanced sections** ("Once · every panel") · **Close all Advanced sections** ("Settings › Advanced › Reset"); Places: Inspector › Advanced · Menu › View › Advanced · Menu › Diagnostics › Advanced · Settings › Advanced. Footer "6 results".
- ↵ → every panel fold, the menu's Advanced groups and the ? sheet's fold open; toast "All Advanced sections are open." + **Close all** (its one action).
- Rules: nothing stays switched on; each panel then remembers its own fold; ⌘Z does not undo it — Close all does; no badge.

#### 1.19 The canvas as code, read-only [ad-code] — NEW
- Floating code island over the canvas: file icon, canvas name, mono path `2026/combine/Combine-kampan.tsx`, chip "🔒 Read only", **Copy**, **Open in editor** (primary), close.
- Line-numbered, syntax-highlighted source; **the selected artboard's lines are highlighted** (needs a source map from artboard id to line range).
- Fold open: *From the terminal — this canvas* (`maude design screenshot --canvas … --screen post-1x1`, `maude design export png --scope canvas-as-separate --option scale=2`, `maude design read-annotations …`) · *In Claude Code* (`/design:edit "…"`, `/design:critic --agent brand-critic`).
- Entry: Canvases › Advanced row menu **View code**, or ⌘K.

#### 1.20 Edge surfaces
- **Sync problem callout [ad-edge-sync]**: the cluster says "Syncing…"; callout with a caret under the status: "3 changes are waiting to reach the cloud." / "They're safe on this Mac. The cloud is busy and asked to wait — the next try is in 40 s, by itself." → **Try now**. Fold: Hub · Reply "429 · rate limited" · Next try 14:06:40 · Last good sync 14:02:51 · Waiting · 3 (copy) with file list · hint "A full compare is Resync now, in Menu › Diagnostics › Advanced."
- **Broken canvas code [ad-edge-syntax]**: artboard ghosts on the canvas + card "Pricing can't be drawn right now." / "Its code was changed outside the app 2 min ago and stops halfway on line 212. Other canvases are fine; the last good version is in Version history." → **✦ Ask AI to fix it** (spark button). Fold: Error `SyntaxError: Expected "}" but found ")"` · Where "Pricing.tsx · line 212, column 19" (copy) · code excerpt lines 210–213 with the bad line and a caret · **Open in editor**, **Copy error**, **Last good version**. Replaces today's load-error card with "Reload canvas" (`C/app.jsx:4895`).
- **Self-hosted hub [ad-edge-hub]**: see 1.15; the window says Saved like any cloud project.
- **Where you are [ad-edge-where] — PROPOSED**: browser chrome at `alligators.cloud.maude.sh/...`; Canvases row menu in the browser: **Open in the Mac app** · View code · Copy link to this canvas · ─ · Rename file…; Diagnostics in the browser: Sync "Up to date" · Server "Runs in the cloud" · Logs · Reload canvas ⌘R · Advanced: Hub · Download all. A matrix of 10 rows × 5 contexts (see §3).
- **Remembered fold [ad-edge-remember]**: Monday, Inspector › Advanced opened on Studio site; Tuesday, a different element in another project already has it open ("kept open"); the Canvases panel was never opened, so it stays folded. Reset card: Settings › Advanced › Reset · "Close all Advanced sections · Close all" · *Open now, on this Mac*: a per-fold switch list (Inspector ✓, Version history ✓, Canvases ✗, Share ✗) · "Or ⌘K "close advanced"." → **Fold state is global across projects (per Mac), not per project.**

### 2. User flows (06)

1. **Find a hidden tool**: ⌘K → type a name ("raw css", "resync", "branch", "port") → result shows its home path → ↵ runs it directly. The alternative is to navigate to the home (panel fold / menu / Settings).
2. **Resync, end to end [ad-trace]**: Menu › Diagnostics › Advanced › Resync now (or ⌘K "resync", or from Sync details) → compares all files with the cloud copy; newer here is sent, newer there is fetched; never overwrites (both-side changes become a conflict in Sync details) → progress "Resyncing… 1 204 of 1 318" while you keep working; cluster says Syncing… → toast "Resync done — 3 files sent, nothing else differed." → Save status Saved, Sync "Up to date" → log line `sync · resync · 1 318 checked · 3 sent · 0 conflicts`.
3. **Open an Advanced fold**: click "› Advanced" at the panel foot → body opens → the state persists for that panel on this Mac → reopening the panel later (any canvas or project) shows it open.
4. **Open all**: ⌘K "advanced" → Open all Advanced sections → every fold opens + toast with Close all. Undo = Close all (from the toast, ⌘K "close advanced" or Settings › Advanced › Reset).
5. **Reset**: Settings › Advanced › Reset → Close all / per-fold switches / Reset panel layout / Reset all settings… (should confirm with a dialog; not drawn).
6. **Pin panels**: Menu › View › Advanced › Pin panels to the side → docked layout with handles → drag, double-click to reset, ←/→ move by 8 → ⌘\ hides all.
7. **View code**: Canvases › Advanced on → canvas row menu › View code (or ⌘K) → read-only code view with the selected artboard's lines marked → Open in editor / Copy / terminal commands.
8. **Sync problem**: hub rate-limits → status Syncing… → callout with Try now → auto-retry in 40 s → details in the fold → full compare via Resync now.
9. **Broken canvas**: an external edit breaks the file → in-place card with Ask AI to fix it → fold: Open in editor / Copy error / Last good version (→ Version history).
10. **Sync conflict (Sync details)**: Diagnostics › Sync → Needs you → Keep mine / Use theirs / Keep both / Compare.
11. **Sign-in expiry**: Sync stops → Sync details card → Sign in again → queued changes go out.
12. **Engine model**: Settings › Advanced › Engines → Download / Remove a model card, or copy the install command.
13. **Self-hosted hub token**: Settings › Connections › server row › Advanced → Replace… token.

### 3. States & edge cases (06) — key copy verbatim

- Map header: "Nothing deleted. 124 things left the default view — each has one new home." Stats "moved out of sight" / "0 deleted" / "not drawn yet".
- Why: "A disclosure where you are, never a second app."; "One switch opens raw detail in every panel at once." (rejected).
- Trace toast: "Resync done — 3 files sent, nothing else differed."; progress "Resyncing… 1 204 of 1 318"; hint "You keep working; the status beside the faces says Syncing… until it's done."
- Trash: "+ 8 more · 48 MB. Trash keeps things until you clear it out."; button "Clear out older than 30 days…".
- Logs: "Kept 7 days on this Mac · Help › Report a bug can attach the last 200 lines."
- Reload toast: "Combine-kampan reloaded."
- Sync details: "2 need you"; "Uniformy-2027 changed here and in the cloud."; "Both versions are kept until you choose."; "AI stopped halfway on Combine-video-AI."; "The half-done cut is on this Mac only."; "Sync stopped — the sign-in to the cloud ran out."; "Your changes are kept on this Mac and go out after you sign in."
- Settings update: "2.0.1 is ready" → Restart now; "An update you skip installs when you next quit."
- Open all toast: "All Advanced sections are open." [Close all].
- Sync callout: "3 changes are waiting to reach the cloud." / "They're safe on this Mac. The cloud is busy and asked to wait — the next try is in 40 s, by itself." [Try now].
- Broken code: "Pricing can't be drawn right now." / "Its code was changed outside the app 2 min ago and stops halfway on line 212. Other canvases are fine; the last good version is in Version history." [Ask AI to fix it].
- **Context matrix [ad-edge-where] (PROPOSED)**, columns Mac app · In the browser · Can comment (Jonas) · Local project · Offline:
  - Save status: Saved · Saved · "Can comment" · "Local project" · "Offline — kept on this Mac".
  - Reveal in Finder · Open in editor: ✓ · swap → "Open in the Mac app" · hidden · ✓ · ✓.
  - Open in terminal: ✓ · hidden · "hidden — no AI" · ✓ · ✓.
  - This Mac only link: ✓ · hidden · hidden · ✓ · ✓.
  - Link rules · GitHub invite: ✓ · ✓ · hidden · swap → "Move to the cloud to share" · "greyed — needs the internet".
  - Address · Process · Project folder: ✓ · "Runs in the cloud" · ✓ · ✓ · ✓.
  - Resync now · Download all: ✓ · "Download all only" · "Download all only" · "hidden — nothing syncs" · "greyed — back online".
  - Raw CSS · Property · Attribute: ✓ · ✓ · "read-only · Copy CSS" · ✓ · ✓.
  - Branch · Publish · Fetch: ✓ · "hidden — cloud versions" · hidden · "✓ if it's a git folder" · "Save ✓ · Publish waits".
  - Settings › Advanced › This Mac: ✓ · "hidden — General, Connections" · ✓ · ✓ · ✓.
  - Rule: Mac-only rows are hidden or swapped, never shown broken; offline greys only what needs the internet.
- Status word for "sync stuck but safe" = **Syncing…** (open question in v2-open-questions; the canvas picks Syncing…).

### 4. Keys & menu paths (06)

- ⌘K Search (all hidden tools) · ? shortcuts sheet · F1 Help and guides · ⌘, Settings · ⌥⌘H Version history · ⇧⌘E Export · ⇧⌘H Handoff · ⌘R Reload canvas (Diagnostics) · ⇧⌘I Inspector (View › Advanced) · ⇧⌘T Keep timeline open (View › Advanced) · ⇧⌘M Comments · ⌘\ Hide/Show panels · ⌘/ Ask AI · ⇧⌘A Select all annotations · ⌘0 with an artboard selected = fit just that artboard · H in Canvases › Advanced label "Show hidden files H" (**conflict**: H is Hand; see cross-cutting) · ⌘N New canvas · ⌘O Open project.
- Menu paths: Menu › Diagnostics › {Sync, Server, AI setup, Logs, Reload canvas, Check AI setup again, Advanced › Address, Process, Project folder, Resync now, Download all}; Menu › View › Advanced › {Layers as a panel, Inspector, Open inspector on select, Keep timeline open, Minimap, Zoom controls, Print guides, Hidden files, Pin panels to the side}; Settings › Advanced › Reset.
- ⌘K action names to register: Open all Advanced sections · Close all Advanced sections · Resync now · Download all · Copy code · Copy element id · Copy file path · Copy export command · Copy transcript · Copy logs · Copy link · View code · Design system (open) · Reveal in Finder · Open in editor · Raw log · Open in terminal · Get latest · New branch · Fetch · Publish · Pull a copy · Check AI setup again · Logs · and each Place (Inspector › Advanced, etc.).

### 5. Classification (06)

| Surface | Class | Today (inventory) | v2 home |
|---|---|---|---|
| Per-panel Fold + memory | NEW | Inspector Advanced/Designer toggle (§4) | every panel foot |
| Open all / Close all | NEW | — | ⌘K, Settings › Advanced › Reset |
| Inspector Advanced rows | EXISTS | CssKnobs Advanced mode, Inspect tab Tag/Class, edit-scope strip, token popover, RawKnob/AttrKnob (§4) | Inspector › Advanced |
| Copy code, Edit as text, artboard "In code" | NEW | — | Inspector › Advanced |
| Canvases Advanced (file names, hidden files, folder, refresh, count) | EXISTS (file names NEW) | Sidebar header + Show hidden files + sections (§2) | Canvases › Advanced |
| Row menu Reveal in Finder / Open in editor / View code / Copy file path | NEW (Rename file EXISTS) | tree-row-menu (§2) | Canvases › Advanced row menu |
| Trash panel | EXISTS | Sync panel trash + tree delete (§2, §8) | Canvases last row + Advanced (11 · pn-trash) |
| Layers tags/ids, select by selector, counts | EXISTS partly (select-by-selector NEW) | LayerRow, "N ARTBOARDS" (§1, §4) | Layers › Advanced |
| AI chat Advanced | EXISTS | CapabilityBar, ⓘ, View select, GenerateDialog (§11, §12) | AI chat panel › Advanced |
| Open in terminal, Raw log | NEW | tool-call cards (§12) | AI chat panel › Advanced |
| Share Advanced | EXISTS (link rules NEW) | ShareDialog 3 links, IdentityBar GitHub invite (§9) | Share › Advanced |
| Timeline Advanced | EXISTS partly | frame readout, long-comp badge, keyframe markers (§13) | Timeline foot fold |
| Export Advanced | EXISTS partly | ExportDialog PNG dpi, PDF options (§10); colour profile, file-name pattern NEW | Export › Advanced |
| Version history + git fold | EXISTS | GitPanel, DiffView, RepoBranchSwitcher (§7) | Version history (⌥⌘H) › Advanced |
| DS specimen view | EXISTS | SystemView (§3) | Design system › Advanced (13) |
| One menu | EXISTS → merged | 6-menu Menubar (§1) | project pill menu |
| Diagnostics submenu | NEW container | status bar chips, mode stamp, empty-state port line, readiness (§1, §18) | Menu › Diagnostics |
| Logs viewer | NEW | bug-report log tail only (§17) | Diagnostics › Logs |
| Server / AI setup cards | EXISTS data, NEW surface | StatusBar, ReadinessList | Diagnostics |
| Sync details | EXISTS | SyncPanel whole (§8); Keep both NEW | Diagnostics › Sync |
| Settings 3 tabs | EXISTS → regrouped | SettingsPanel 7 tabs (§Settings A) | General · Connections · Advanced |
| Port input, Privacy, Decision memory, Experimental, Use my own plugin copy, Reset all | NEW | — | Settings › Advanced |
| Pin panels to the side | EXISTS → option | Dock system, panel sides (§1, Settings Layout) | View › Advanced |
| ? sheet with "moved" fold | EXISTS → reworked | ShortcutsOverlay (§17) | ? |
| Code view | NEW | — | Canvases › Advanced / ⌘K |
| Sync callout, broken-code card | EXISTS → reworded | SyncBanner, load-error card (§1, §3) | in place |
| Context matrix | PROPOSED | — | — |

### 6. Backend / native / hub needs (06)

- **Fold state store**: per-Mac prefs (`/_api/ui-prefs` → `~/.config/maude/prefs.json`), keyed by fold id; enumerate for Reset. It does not sync between Macs.
- **⌘K action registry**: each action has id, label, icon, `where` path, run(), and a visibility predicate (role, browser, local, offline — see the matrix).
- **Logs store**: structured log lines from sync, server, AI and export sources; 7-day retention on disk; filter, copy, Show in Finder; an "attach last 200 lines" hook into ReportBugDialog.
- **Diagnostics status providers**: sync state, server (live/reconnecting, mode, port, PID, version, build), AI readiness (claude path, version, signed in, plugin versions).
- **Resync / Download all** RPCs (EXISTS in SyncPanel); emit a progress stream and a completion summary (files checked/sent/conflicts).
- **Sync details**: needs-you list (conflicts with both versions + Compare; Keep both = DDR-116 copy), unfinished AI edit (Publish/Discard), transfers with cancel, counts, sign-in-expired state, hub reply code + next-retry time + waiting files (for the ad-edge-sync fold).
- **Native (Tauri)**: Reveal in Finder, Open in editor (default editor or `$EDITOR`), Open in terminal (spawn Terminal with `claude --resume <session>` or similar), Show in Finder for logs/exports, Restart now for updates (updater exists), Keychain backend indicator.
- **Code view**: read the canvas source; map artboard id → line range (parse `DCArtboard id=`); handle syntax errors (line/column from the Bun.build error) for ad-edge-syntax; "Last good version" = the latest history entry that builds.
- **Ask AI to fix it**: start an AI run scoped to the broken file with the error attached.
- **Port setting**: the server must accept a configured port (today it is chosen at boot); persist it; restart flow.
- **Engines**: whisper/Gemma download/remove/status (EXISTS in Settings Subtitles/Video).
- **Decision memory**: kgai toggle + count (`maude kg doctor` / node count). Experimental flags: `orchestration.mode`/agent teams env; "Faster canvas engine" = unspecified.
- **Privacy**: anonymous usage telemetry (does any exist? NEW backend), bug-report log policy.
- **Git (Version history Advanced)**: branch list/switch, drafts, remote URL, per-version SHA + changed files + diff, uncommitted files with Discard, save-with-message, new branch, fetch, publish N versions, pull a copy, PR creation (EXISTS RepoBranchSwitcher/GitPanel endpoints).
- **Export**: exact scale (fractional), colour profile sRGB/P3 (NEW in the render service), file-name token pattern (NEW), command-string generator.
- **Browser (cloud) variant**: swap Mac-only rows; Diagnostics shows "Runs in the cloud".

### 7. Dependencies (06)

- Kit: `ProjectMenu` (diagnostics submenu with advanced), `SearchPalette` (`where` column), `ShareCluster`, `CanvasesPanel` (Trash row, file-name second line), `Fold` (kit candidate), `Insp`.
- Other canvases: 03 · ai-advanced (full AI fold), 07 · ve-advanced (timeline), 08 · ak-advanced (artboard sections), 09 · ex-formats / ex-advanced / ex-history (export), 10 · co-share-advanced (share fold), 11 · pn-trash / pn-history / pn-compare (Trash, Version history, compare), 12 · ia-assets-panel (Assets), 13 · ds-advanced / ds-board-studio (Design system), 02 · ob-settings / ob-adv-sheets (Settings General, new-project sheets), 05 · es-all-trashed, 04 · md-comment-only.
- Build order: Fold + prefs store → ⌘K registry → one menu + Diagnostics → per-panel folds → Settings regroup → Logs → code view / edge cards.

---

## Canvas 10 — Share and Collaboration

### 0. Ground rules drawn on this canvas
- **One Share button** (primary, in the Share cluster). The sheet opens on **Invite**; **Copy link** is secondary in the link row; **This canvas · Whole project** scope comes first (CONTRACT §6).
- Roles in words: **Owner · Can edit · Can comment · Can view**. Can comment = "Look, comment and download"; Can view = "Look only"; downloads/export start at Can comment. **Trash rule (PROPOSED)**: editors move to the trash; only owners clear it out.
- Presence colours: people wear sky / green / yellow / lilac / grey only, never coral (reserved next to the AI spark). You = yellow, Tereza = sky, Jonas = green, Petra = lilac, Lukáš = grey; a crowd repeats tones and names carry identity. Only AI wears the spark.
- Save-status words in the cluster (CONTRACT §6): Saved · Syncing… · Offline — kept on this Mac · Local project; access words for non-editors: Can view / Can comment + **Ask to edit** in place of Share.
- Mode switch Edit · Preview · Present lives in the Share cluster; read-only people see "Viewing". Comments and stickers are Preview (annotate toolbar).

### 1. Surfaces / components

#### 1.1 Share cluster (kit `ShareCluster` + local `CoCluster`)
- Faces (overflow as a grey "+N" face), save/access word, optional Comments icon with an unread count, mode switch, panels button (⌘\), **Share** or **Ask to edit**.
- Hooks: a follow ring on one face (in their colour), a ring on all faces (everyone following you, yellow), an open-face state, an open-Share state, a comment count badge.

#### 1.2 Share sheet [co-share-sheet] — EXISTS (ShareDialog `C/share-dialog.jsx:47`, links only) → rebuilt as an Invite-first sheet (NEW)
- Popover under Share: title "Share Combine-kampan"; seg **This canvas · Whole project**; invite row = input "Name or email" (typed state shows an email chip `lukas.novak@gmail.com` + caret), role select (default **Can edit**), **Invite** (primary).
- People header: "3 people · 1 invited" / "+ 9 in Alligators brand".
- Rows: You — Owner (quiet, no chevron) · Tereza `tereza@alligators.cz` — Can edit ⌄ · Jonas `jonas@alligators.cz` — Can comment ⌄ · Petra "Invited 2 days ago · expires in 5 days" — Can view + **Resend** · team row "Everyone in Alligators brand" "9 people · change it in Whole project" — Can edit (quiet, read-only in canvas scope).
- Link row: link icon, "Anyone in Alligators brand with the link" / "Can view" + **Copy link**.
- Foot: "› Advanced  Links, link rules, sync".
- The cluster shows the mode switch (Edit).

#### 1.3 Role menu & scope [co-share-roles]
- Role menu on a person's row: ✓-able items with descriptions:
  - **Can edit** — "Change artboards, draw, use AI, move to the trash"
  - **Can comment** — "Look, comment and download"
  - **Can view** — "Look only"
  - ─ **Make owner** — "Owners also invite people and clear out the trash"
  - **Remove from Combine-kampan** (danger).
- **This canvas** share: the recipient's Canvases panel shows just that canvas, sub "Shared with you · Can view", foot "Only Combine-kampan was shared with you."; no New canvas; "The project's other 92 canvases stay out of sight."
- **Whole project** share: the full tree (93), foot "New canvases join this list for him too."
- PROPOSED: "a role on one canvas adds to the project role, never lowers it".

#### 1.4 Link opened in a browser [co-browser-view] — EXISTS partly (cloud browser tab, VIEW ONLY stamp) → NEW layout
- URL `alligators.cloud.maude.sh/c/combine-kampan`; the canvas live in **Preview**, others' cursors + pins, **no toolbar**; project pill; cluster with access "Can view", mode "Preview"/Viewing, **Ask to edit**; zoom-only island (27%); a quiet island **Open in the Mac app** (logo mark).

#### 1.5 Presence [co-presence] — EXISTS partly (participants chrome `apps/studio/participants-chrome.tsx`, menubar avatars, Claude avatar; DDR-078 agents as presence peers)
- Faces: Tereza, Jonas, Petra + "+4". Named cursors per person; a selection ring in the person's colour around what they select (Jonas: Web, green ring). Your AI: dashed spark outline, tag "AI is making it greener" below the artboard, AI cursor. **Tereza's AI**: spark outline + tag led by her face "Tereza's AI · translating to English" + an AI cursor stroked in her colour.
- Legend under the artboard (Jonas Web · selected; Tereza A4 · plakát; Petra 16:9 · teaser; AI yours, Post 1:1; Tereza's AI Story 9:16).
- **Face menu** (click a face): header avatar + "Tereza" / "On A4 · plakát · Can edit"; **Follow Tereza**; **Go to A4 · plakát**; ─ Tereza's AI "Story 9:16 · view only"; ─ **Bring everyone here**.
- The AI panel icon has a dot (AI activity).

#### 1.6 Following [co-follow] — EXISTS (participants-chrome Follow, soft one-way viewport mirroring) → restyled + exit rules
- A thin window frame in her colour; pill "Following Tereza [esc]"; her selection drawn in her colour (`Selection editing`), her cursor "Tereza · typing"; a ring on her face in the cluster; the viewport mirrors hers (57% here).
- Stops on **esc, a scroll, or a click**.

#### 1.7 Bring everyone here [co-bring] (signature moment) + [co-spotlight] — NEW
- Trigger: ⌘K "bring" → "Bring everyone here" (meta "3 people") / "Follow Tereza", or any face menu, or the people list.
- Motion: 0 ms you ask → ≈250 ms they glide (each cursor on its own curve with a dotted wake in its colour; your frame draws in from the corners) → ≈420 ms they land around your cursor with a small spring.
- Spec: **Cursors** spring, 420 ms, nearest first, 40 ms apart · **Wake** dots in the person's colour, gone 160 ms after landing · **Frame** draws in from the corners, 220 ms · **Reduced motion**: everyone appears at once, no wake, the frame fades in.
- End state [co-spotlight]: yellow frame; pill "Everyone here is following you · 3 people [Stop]"; rings on all faces. On their screens the camera eases to your view and their pill reads "Following You" with esc. **Stop** ends it for all; each person can leave with esc.

#### 1.8 Comments [co-comment-thread] — EXISTS (CommentsPanel `C/app.jsx:5429`, comments-overlay) → v2 thread popover + panel
- C switches to Preview with Comment in hand (annotate toolbar, tool comment); cluster shows the Comments icon and mode Preview.
- Thread popover: where-chip (print icon "A4 · plakát"), **Resolve**; messages (avatar, name, relative time, text); composer with an **@mention** popover listing people **with their role** ("Tereza · Can edit").
- Comments panel (floating island): header + close; seg **Open 4 · Mine 1 · Resolved 6**; rows (avatar, "on" artboard incl. "Reels · nábor · at 0:12", body, meta "2 h ago · 1 reply"); the current row is highlighted.
- Resolve moves a thread to Resolved ("kept").

#### 1.9 Mention notifications [co-mention-notify] — NEW (PROPOSED e-mail)
- In the app, another canvas: toast "Jonas mentioned you on A4 · plakát" [**Open**] + an unread count on the cluster's Comments icon until read.
- App in the background: macOS notification "Maude · now / Jonas mentioned you / Alligators brand · A4 · plakát — "…"" + **Dock badge 1**.
- App closed: e-mail "From cloud.maude.sh · 14:05 / Jonas mentioned you in Alligators brand", quoted thumbnail + text, **Open in the Mac app**, footer "Change which e-mails you get in Settings › General." PROPOSED "one e-mail per mention, never a digest".
- All three open **the thread**, not the top of the canvas (deep link to a thread id).

#### 1.10 Comment on a video frame [co-comment-video] — EXISTS partly (Timeline comment tool/strip `P/TimelinePanel.jsx:1526`)
- Pin on Reels · nábor at 0:12 shows **only at that moment**; thread chip "⏱ at 0:12"; timeline header "2 comments on this video"; a marker row with one avatar dot per thread (T at 12 s, J at 21 s); clicking a marker jumps the playhead.

#### 1.11 Comment on a print artboard [co-comment-print] — NEW position wording
- Thread chip in mm: "14 mm from the left · 2 mm above the trim"; print guides visible (trim + safe margin); tag "Bleed 3 mm · trim · safe margin 5 mm".

#### 1.12 Offline [co-sync-offline] — EXISTS partly (SyncBanner offline) → reworded, NEW queues
- Cluster: no faces, status "Offline — kept on this Mac", mode Preview. Canvases panel rows with meta **"not sent"**; panel foot "14 changes since yesterday 18:20 — kept on this Mac". The comment pin shows "Queued — sends when this Mac is online." Tooltip on Share: "Invites send when this Mac is online."

#### 1.13 Back online [co-sync-back]
- Status Syncing…; row meta **"sending"**; foot "Sending 14 changes · 9 sent"; a change mark "[avatar] Tereza changed this · 09:15" under her changed artboard; a conflict mark "[You][Jonas] 2 versions" on the sticky; toast (top, sync icon) "Back online. Your changes are going up; one sticky needs a look." [**Show**].

#### 1.14 Object-level conflict [co-conflict] — EXISTS concept (DDR-116, SourceConflictPanel is file-level) → NEW per-object UI
- Card "You and Jonas both changed this sticky while offline." / "Both versions are here. Keep one, or keep both side by side."; the two stickies side by side with who · when · where ("Yours · yesterday 21:40 · this Mac", "Jonas · today 7:55 · his Mac"); **Keep yours**, **Keep Jonas's**, "or", **Keep both**.
- Version history scoped to the object ("Version history · this sticky"): rows with Restore; an older row without Restore; footer "Both stay here whatever you keep. ⌥⌘H".

#### 1.15 Trashed while open [co-trashed]
- Banner island: trash icon, "Tereza moved Combine-cisla to the trash · 2 min ago" / "You can keep looking. Anything you change now stays with it." [**Restore**] (primary).
- Canvases panel: count drops to 92; the row is dimmed with sub "🗑 In the trash · open here".

#### 1.16 Local → cloud [co-local-cloud] (= 02 Onboarding steps)
1. Share on a Local project (cluster status "Local project") → sheet "Move "Portfolio 2026" to the cloud?" / "Sharing needs the cloud. People you invite can open it there, and so can your other Macs. It stays on this Mac too." [Cancel] [**Move to cloud**]; footer "Only need a file? Menu › Export… ⇧⌘E".
2. Only if signed out: browser `cloud.maude.sh/sign-in` — "Sign in to cloud.maude.sh" / "Then this page sends you back to the app." Continue with Google · email field · Continue with email · "Cancel and go back to the app".
3. Share opens on Invite (scope Whole project; typed `tereza@alligators.cz`; you Owner; link "Anyone with the link · Can view"); cluster status Syncing…; toast "Moved to the cloud — 3 canvases are going up now."

#### 1.17 Twelve people [co-twelve]
- Cluster: 3 faces + "+8"; clicking +8 opens the people list "12 on Combine-kampan" / "you + 11": rows with avatar, name and where ("A4 · plakát", "in a browser · Can view", "in Comments"); idle rows ("idle · 4 min / 12 min / 25 min") dimmed; ─ **Bring everyone here**.
- Idle cursors turn grey and shrink to an initial (E, R, H).

#### 1.18 Can view meets an edit [co-ask-edit] — NEW
- Petra's Mac: cluster access "Can view", **Ask to edit**; mode switch reads **Viewing**; no toolbar; her drag does nothing and one dark tip appears: "You can look at Combine-kampan, not change it." / "Ask to edit, top right, sends a request to its owner."
- Owner's Mac: toast "[Petra] Petra asks to edit Combine-kampan" [**Review**] → Share sheet with a request block at the top: "Petra asks to edit Combine-kampan" / "2 min ago · she can view it now" [Not now] [**Let Petra edit**].
- On approval, Petra sees the toast "You can edit Combine-kampan now."

#### 1.19 Access ends [co-access-ends]
- Owner: Share "Share Alligators brand" (Whole project) → role menu Remove → Dialog "Remove Lukáš from Alligators brand?" / "He stops seeing its 93 canvases right away. Everything he made stays in the project." [Cancel] [**Remove**] (danger).
- Lukáš's Mac: canvas dims; card (lock icon) "You no longer have access to Alligators brand." / "Your last changes were saved first. If this is a surprise, ask someone on the team." [**Back to Home**].
- Viewer on a turned-off link, browser: card "This link was turned off." / "Ask the person who shared Combine-kampan for a new one." (no action).

#### 1.20 Share › Advanced [co-share-advanced] (= 06 ad-share row for row)
- Cloud project: This link (Who can open "Team only" · Role "Can view" · Expires "In 7 days" · New people join as "Can edit") · Other ways in (App link `maude://alligators/combine-kampan` copy · This Mac only `localhost:4402/?c=Combine-kampan` copy · Invite by GitHub username `@username` [Invite]) · Where it syncs (Hub `alligators.cloud.maude.sh` copy · Last synced "6 Oct, 14:05 · 247 assets") · "Sync details live in Menu › Diagnostics › Sync."
- **Roles matrix** "What each role can do" (Owner / Can edit / Can comment / Can view): Look ✓✓✓✓ · Comment ✓✓✓— · Download and export ✓✓✓— · Draw annotations ✓✓—— · Change artboards ✓✓—— · Use AI on it ✓✓—— · Move to the trash ✓✓—— · Invite people ✓——— · Clear out the trash ✓———. Hint: "AI runs on each person's own Claude account. A link can give Can view or Can comment, never more. Can view is look only — downloads start at Can comment. The trash keeps things until an owner clears it out."
- **Self-hosted hub** (Kavárna Na Rohu · Homepage): sub "syncs to the studio's own hub"; no link row; fold label "Other ways in, sync, roles"; no link rules; Hub `https://hub.studio-brno.cz`; *Roles on this hub*: ✓ Can edit "Available"; ✗ "Can comment · Can view — Not on this hub — it has no view-only accounts, so no link either"; hint "People you invite get an account on this hub — the e-mail tells them where to sign in."
- Sub: "Who changed what lives in Version history ⌥⌘H."

### 2. User flows (10)

1. **Invite** (happy path): Share → scope (This canvas default when a canvas is open) → type an email → role (default Can edit) → Invite → a pending row with "Invited just now · expires in 7 days" (expiry from hub invites) → Resend available.
2. **Change a role**: row chevron → role menu → pick; Make owner; Remove → confirm dialog (1.19).
3. **Copy link**: Copy link in the link row (role from the link rules, max Can comment). Link rules in Advanced (who/role/expiry/default join role).
4. **Open a link with no app**: browser → Preview live → Viewing → Ask to edit / Open in the Mac app.
5. **Ask to edit**: viewer clicks Ask to edit (or tries to drag → tip) → owner toast Review → request at the top of Share → Let Petra edit / Not now → viewer toast "You can edit Combine-kampan now." and the toolbar appears (not drawn: the "Not now" outcome on the viewer side).
6. **Follow**: face → Follow X → frame + pill → esc / scroll / click stops.
7. **Go to**: face → "Go to A4 · plakát" → the camera jumps to their artboard (no follow).
8. **Bring everyone here**: ⌘K / face menu / people list → glide → spotlight → Stop (all) or esc (individual).
9. **Comment**: C → click to pin → thread → @mention with role → send → Resolve → Resolved tab. The Comments panel filters Open / Mine / Resolved.
10. **Mention delivery**: toast with Open (in app) / macOS notification + Dock badge (background) / e-mail (closed) → opens the thread.
11. **Video comment**: select the video artboard → Comment at the playhead time → the pin is visible only at that time → markers on the timeline → click a marker = seek.
12. **Offline day**: work continues → canvases "not sent" → comments "Queued…" → invites wait (tooltip) → back online: Syncing…, "sending", count, toast Show → conflict marks.
13. **Resolve an object conflict**: Show (toast) or "2 versions" mark → side-by-side card → Keep yours / Keep Jonas's / Keep both → the loser is still in Version history with Restore.
14. **Trashed while open**: banner → keep working (changes stay with it) → Restore (puts it back for everyone).
15. **Local → cloud**: Share → Move to cloud → (browser sign-in) → Share on Invite while uploading.
16. **Remove a person**: Remove → confirm → their session ends (revocations) → their screen shows the access-ended card → Back to Home.
17. **Turn off a link** (where the toggle lives is not drawn; presumably Share › Advanced "Who can open") → open viewers get the "This link was turned off." card.

### 3. States & edge cases (10) — key copy verbatim

- Share sheet: placeholder "Name or email"; "3 people · 1 invited"; "+ 9 in Alligators brand"; "Invited 2 days ago · expires in 5 days"; "9 people · change it in Whole project"; "Anyone in Alligators brand with the link".
- Roles: "Change artboards, draw, use AI, move to the trash"; "Look, comment and download"; "Look only"; "Owners also invite people and clear out the trash"; "Remove from Combine-kampan".
- Scope: "Shared with you · Can view"; "Only Combine-kampan was shared with you."; "New canvases join this list for him too."
- Browser: "Open in the Mac app".
- Face menu: "On A4 · plakát · Can edit"; "Follow Tereza"; "Go to A4 · plakát"; "Tereza's AI · Story 9:16 · view only"; "Bring everyone here". AI tag: "Tereza's AI · translating to English".
- Follow: "Following Tereza" + esc; spotlight "Everyone here is following you · 3 people" [Stop]; theirs "Following You".
- Comments: "Open 4 · Mine 1 · Resolved 6"; "Reply…"; "2 comments on this video"; "at 0:12"; "14 mm from the left · 2 mm above the trim"; "Bleed 3 mm · trim · safe margin 5 mm".
- Mentions: "Jonas mentioned you on A4 · plakát" [Open]; "Jonas mentioned you"; "Jonas mentioned you in Alligators brand"; "Change which e-mails you get in Settings › General."
- Offline: "Offline — kept on this Mac"; "not sent"; "14 changes since yesterday 18:20 — kept on this Mac"; "Queued — sends when this Mac is online."; "Invites send when this Mac is online."
- Back online: "Syncing…"; "sending"; "Sending 14 changes · 9 sent"; "Tereza changed this · 09:15"; "2 versions"; "Back online. Your changes are going up; one sticky needs a look." [Show].
- Conflict: "You and Jonas both changed this sticky while offline."; "Both versions are here. Keep one, or keep both side by side."; "Yours · yesterday 21:40 · this Mac"; "Jonas · today 7:55 · his Mac"; Keep yours / Keep Jonas's / Keep both; "Both stay here whatever you keep."
- Trashed: "Tereza moved Combine-cisla to the trash · 2 min ago"; "You can keep looking. Anything you change now stays with it."; "In the trash · open here".
- Local: "Move "Portfolio 2026" to the cloud?"; "Sharing needs the cloud. People you invite can open it there, and so can your other Macs. It stays on this Mac too."; "Only need a file? Menu › Export…"; "Sign in to cloud.maude.sh"; "Then this page sends you back to the app."; "Cancel and go back to the app"; "Moved to the cloud — 3 canvases are going up now."
- Crowd: "12 on Combine-kampan"; "you + 11"; "in a browser · Can view"; "in Comments"; "idle · 4 min".
- Ask to edit: "You can look at Combine-kampan, not change it."; "Ask to edit, top right, sends a request to its owner."; "Petra asks to edit Combine-kampan"; "2 min ago · she can view it now"; Not now / Let Petra edit; "You can edit Combine-kampan now."
- Access ends: "Remove Lukáš from Alligators brand?"; "He stops seeing its 93 canvases right away. Everything he made stays in the project."; "You no longer have access to Alligators brand."; "Your last changes were saved first. If this is a surprise, ask someone on the team."; "This link was turned off."; "Ask the person who shared Combine-kampan for a new one."
- Self-hosted: "Not on this hub — it has no view-only accounts, so no link either"; "People you invite get an account on this hub — the e-mail tells them where to sign in."
- Edge states not drawn: an invite to an existing member, an invalid email, an expired invite after Resend fails, an owner removing themselves / the last owner, a request declined (viewer side), several pending requests, a mention of someone without access to that canvas.

### 4. Keys & menu paths (10)

- **C** = Comment (switches to Preview) · **esc** stops following / leaves the spotlight / steps back · **⌥⌘H** Version history (object-scoped from the conflict) · **⇧⌘E** Export (from the local-project sheet) · **⇧⌘M** Comments panel · **⌘K** "bring" → Bring everyone here, "Follow Tereza" · **⌘\** panels.
- Menu › Share… opens the same sheet; Menu › Help › How sharing works; Menu › Diagnostics › Sync for sync details; Settings › General for e-mail preferences; Settings › Connections for cloud/hub/GitHub accounts.
- Mode keys (04, proposed): ⌥⌘P / ⌥⌘↵ / ⇧⌥⌘↵ — not on this canvas.

### 5. Classification (10)

| Surface | Class | Today | Notes |
|---|---|---|---|
| Share sheet, Invite by email + role | NEW (sheet) on EXISTS hub invites (`invites.mjs`: single-use, expiring, email + role) | ShareDialog links only; GitHub username invite | Invites are project-level today; **per-canvas scope NEW** |
| Pending invite expiry + Resend | EXISTS backend, NEW UI | invites `expires_at` | Resend = new invite / re-mail |
| Role menu, Make owner, Remove | NEW UI; EXISTS hub roles owner/member/viewer + revocations | — | Can view (look-only) role does NOT exist in the hub |
| Team row, link row, link rules | NEW | ShareDialog web link | link expiry, "who can open", default join role are NEW |
| Browser Preview view + Ask to edit + Open in Mac app | EXISTS partly (cloud tab, embed-view, VIEW ONLY stamp, CloudRoleBanner) | | Ask-to-edit request flow NEW |
| Faces, cursors, agents as peers | EXISTS (participants-chrome, use-agent-presence, DDR-078) | | other people's AI tag NEW styling (03) |
| Face menu (Follow / Go to / Bring) | Follow EXISTS (participants-chrome popover); Go to + Bring NEW | | |
| Follow frame + pill + exit on scroll/click | EXISTS logic (one-way viewport mirror; release by clicking the avatar) → NEW exit rules + chrome | | the canvas header wrongly says Follow doesn't exist |
| Bring everyone here + spotlight | NEW | | needs a "summon" awareness broadcast + "Following You" on peers |
| People list with idle | NEW | | idle detection from awareness timestamps |
| Comments thread, Resolve, panel | EXISTS (CommentsPanel, comments-overlay) | All/Open/Resolved filters | **Mine NEW; All dropped** |
| @mentions with role autocomplete | NEW | none in comments | |
| Mention toast / macOS notification / Dock badge | NEW (OS notifications exist for AI: "Claude finished") | | |
| Mention e-mail from cloud.maude.sh | NEW, PROPOSED | | needs an e-mail service + preferences |
| Video frame comments + markers | EXISTS (Timeline comment strip/pins) | | "visible only at that moment" on the canvas pin may be NEW |
| Print mm-position comments | NEW | | |
| Offline queue for comments + invites | NEW | | |
| "not sent" / "sending" row meta, panel-foot counts | NEW | SyncBanner, hub sync chip | |
| "X changed this · time" marks | NEW | | |
| Per-object conflict, Keep both, object-scoped history | NEW UI (DDR-116 semantics) | SourceConflictPanel file-level | |
| Trashed-while-open banner + Restore | NEW | | |
| Editors move to trash / owners clear | PROPOSED | hub `delete` owner-only | split the capability |
| Local → cloud | EXISTS partly (CloudBar connect, 02 flow) | | |
| Remove + access-ended card | EXISTS backend (revocations end sessions) / NEW UI | | |
| Link turned off card | NEW | | |
| Roles matrix | NEW (doc surface) | role-matrix.mjs | |
| Self-hosted hub roles | EXISTS constraint (no view-only accounts) / NEW UI | | |

### 6. Backend / native / hub needs (10)

- **Roles**: the hub has `owner · member · viewer` (`role-matrix.mjs`; viewer = read, session, comment, export/download; member has `delete:false`; invite/delete/mirror owner-only). v2 needs:
  - **Can view** = a new look-only role (no comment, no export) → add a 4th role or a viewer sub-flag; update the matrix + tests ("the hub would need a look-only viewer").
  - **Can comment** = today's viewer. **Can edit** = member. Owner = owner.
  - Split `delete` into **trash** (member+) and **purge/clear out** (owner) — PROPOSED.
  - "Use AI on it" for editors only: enforce in the studio (ACP) and the cell.
- **Per-canvas sharing** (NEW): ACL per canvas path; the project tree filtered for canvas-scoped members; no New canvas for them; additive rule (max(project role, canvas role)).
- **Invites**: email + role + scope (canvas|project); list pending with expiry; Resend; offline-queued invites; self-hosted hub invite e-mail "tells them where to sign in".
- **Links**: share links with role ≤ Can comment, "Who can open" (Team only / anyone), expiry, turn off (revoke), default join role for new people; the cloud web link `…/c/<canvas>`; the app link `maude://<project>/<canvas>` (deep-link handler in Tauri; exists per 11 · pn-deeplink); the this-Mac link `localhost:<port>/?c=…`.
- **Access requests** (NEW): request object (requester, canvas, time), delivery to owners (toast + Share sheet top + probably notification/e-mail), approve → role change pushed live → requester toast; decline.
- **Presence**: Yjs awareness already carries cursors/viewport/follow target; add: current artboard ("On A4 · plakát"), role, idle timestamp, "in a browser", "in Comments", selection rect; **summon** event (Bring everyone here) with leader id; peers enter follow mode on the leader, the spotlight UI, Stop broadcast; per-peer esc leaves.
- **Agent presence**: others' AI runs visible as view-only (DDR-078; 03 · runs.canvas).
- **Comments**: mentions (user ids in the body), unread state per user, a "Mine" filter, thread deep links, video time anchor (`t`) + timeline markers, print mm anchor computed from the artboard's physical size, an offline outbox.
- **Notifications**: in-app toast; macOS notification + Dock badge (Tauri notification + `set_badge_count`); e-mail from cloud.maude.sh for mentions when the app is closed (needs cloud-side "is the user online" + an e-mail provider + preferences in Settings › General); one per mention.
- **Sync**: per-canvas unsent/sending state for the Canvases panel; aggregate counters for the panel foot; the "changed by X at time" annotation from journal metadata; object-level (sticky/element) conflict detection on top of file-level merges; Keep both = duplicate the object; object-scoped history query for Version history.
- **Trash propagation**: a canvas trashed remotely while open → banner; edits after trashing stay attached to the trashed canvas; Restore for everyone.
- **Revocation**: removal ends sessions (exists) → client shows the access-ended card after the last save flushes ("Your last changes were saved first" → a flush-before-revoke guarantee); link revocation → viewer card.
- **Local → cloud**: create a cloud project from a local one, upload in the background, open Share immediately; browser OAuth sign-in with return-to (exists `return-to.mjs`, `browser-auth.mjs`).
- **Self-hosted hub**: report supported roles (member only, "no view-only accounts") so the UI greys roles and hides the link.

### 7. Dependencies (10)
- Kit: ShareCluster (mode/canEdit/access), CanvasesPanel (foot, sub, meta words), Cursor, CommentPin, Toast, Dialog, SearchPalette, Toolbar annotate mode.
- 02 Onboarding (ob-local-moved, ob-local-share, sign-in), 03 AI Chat (TheirAi, runs), 04 Modes (md-comment, md-comment-only, md-edge-viewer, md-present-link, mode switch), 05 Empty States (es-viewer), 06 (ad-share, Sync details, Diagnostics), 07 (timeline), 08 (print guides), 11 (Version history, Trash, deep links).
- Hub: role matrix, invites, revocations, OIDC/browser auth; studio: use-collab awareness, comments store.

---

## Nothing-deleted map (06)

Built from `ITEMS` in `06 Advanced.tsx` (124 rows; one home and one "drawn in" ref each) plus a sweep of the inventory for items that are not in `ITEMS`.

### A. The 124 ledger rows (grouped by v2 home)

| v2 home | Existing features (inventory) → drawn in |
|---|---|
| **Inspector › Advanced** | Selected element's selector (status bar) · Copy CSS · Copy data-cd-id (→ "Copy element id") · Copy style / Paste style · Convert layout to absolute · Artboard theme DS default / Follow chrome · Reset position / Fit just this artboard (Fit = ⌘0 with an artboard selected) · CSS tab raw properties · Tag and Class · Custom CSS property rows · HTML attribute rows · Token popover per DS · Grid tracks editor · Body layout select · Edit scope Local/Shared + Detach · Inspector vocabulary Advanced/Designer (Settings) — all → ad-inspector |
| **Canvases › Advanced** | Active file path (menubar) · Refresh tree ⇧⌘R · Live dot + shown/total · Show hidden files (H) · Sidecar files · Runtime · gitignored section · Rename a supporting file · DS folder path · Trash clear-out (sync) → ad-left · Preview of non-canvas files (md, fonts, audio) → **not drawn yet** · Imported-from-Figma and experimental badges → **not drawn yet** |
| **Layers › Advanced** | "N artboards" count · Layer tags · Layer ids → ad-left |
| **Assets tab** | Asset picker (Upload…, thumbnails, Insert) → 12 · ia-assets-panel |
| **Design system › Advanced** | DS view S key + picker · Token/type ladders, galleries · raw system folder + MAUDE-DSN/01 → 13 · ds-advanced (specimen also on ad-ds) |
| **AI chat panel › Advanced** | Generate with AI… (provider, model, aspect) · Model/Effort/Fast mode · Permission mode · Transcript view · Context % and tokens · Slash-command quick actions (→ typing /) · Tool-call cards (→ Raw log) → ad-ai |
| **Share › Advanced** | Local link (this Mac only) · Open in Maude app link · Invite by GitHub username → ad-share |
| **Timeline › Advanced** | Frame readout · Long-comp badge · Keyframe markers → ad-timeline |
| **Export › Advanced** | Export jobs badge (→ Exports list; 09 says Exports icon in the Share cluster) · PNG 150/300/600 dpi · PDF quality + text outlines · Crop/registration marks · AI handoff `/design:handoff` → ad-export · Export project ZIP, canvas as separate · HTML/PowerPoint/Canva → 09 · ex-formats · Render service note → 09 · ex-advanced |
| **Version history › Advanced** | Changes chip "N unsaved" · Unsaved badges M/A/D/U · Branch switcher · Pull a local copy · "Continue on <draft>" · Branch names + New branch · SHA · Fetch remote branches · "Add to shared" PR · Save version with message · Publish changes · Discard a file's changes → ad-history |
| **Menu › File · Edit · View · Help** | Six menus (→ one menu) · What's new megaphone (→ Help + dot) · Report-a-bug icon (→ Help) · "← Dashboard" (→ Back to Home) · Open comments count (→ View › Comments "3 open") · Open another folder / team project (→ File › Open project…) → ad-menus · New GitHub project (visibility, description) → 02 · ob-adv-sheets · Help sections: slash commands, opt-out, critic loop (→ Help and guides) · Quick setup brand/Figma (→ File › Import…) · Handoff ⇧⌘H (→ File) → ad-menus |
| **Menu › View › Advanced** | Dock resize grips + tab strips → ad-pinned · Minimap · Zoom controls · Print guides · Layers as a separate panel · Auto-open inspector on select → ad-menus · Panel positions left/right → ad-pinned |
| **Menu › Diagnostics** | Mode stamp Idle/Canvas/System · Live/reconnecting dot · Readiness list (Claude Code) · claude binary path · Server log tail → ad-logs · Hub sync chip · "localhost:PORT" + version line · Resync · Download all · "Repo state changed — reload?" · Check AI editing readiness… · Reload canvas ⌘R → ad-diag · Get latest · Held/rate-limited/failed lists · Asset transfers with Cancel · Conflict Keep mine/Use theirs/Keep both · Unfinished AI edit Publish/Discard · "Sign in again" · Hints `maude design status`, `/design:rollback` → ad-syncd |
| **Settings › General** | Light/dark toggle (status bar) · Open the cloud dashboard → 02 · ob-settings |
| **Settings › Connections** | Cloud account email + Sign out · Sign in with GitHub · AI provider keys · Figma token · Team hub address + access token · "Your team's own server" email/password → ad-edge-hub |
| **Settings › Advanced** | Update banner Restart now/Later · App version · Sync project files / Propagate deletions · First-link conflicts rule · Hand .design/ to the workspace · Sync canvases only or everything · Where keys are kept (keys.json) · Transcription engine + whisper model · Keyframe engine + Gemma model · Install Claude Code automatically · Server build MAUDE-DEV-SRV · Draw with the SVG agent (copy) · Brand upload "Copy command" → ad-settings |

### B. Inventory features NOT in the ledger and NOT given a home in 06/10 (flag; other canvases may place them)

- **Native OS menu** (About, Check for Updates…, Quit, Help › Report a Bug) — CONTRACT says it is untouched; not drawn, which is fine. "Check for Updates…" has no in-app twin besides the Settings › Advanced Update row.
- **Browse tool** (Tools menu / `DEFAULT_TOOLS`) — not in either v2 toolbar or the ? "moved" list. Probably subsumed by Preview; needs an explicit line.
- **Pen key B → P**, **Ellipse O → Edit › More**, **Rect → Shape R** — the remaps are not listed in the ? "Keys and tools that moved" fold.
- **Canvas palette Export ⌘E** (`S/tool-palette.tsx:641`) — ⌘E is not reassigned or listed as moved (only ⇧⌘E exists).
- **⇧⌘R Refresh tree** — the Refresh button is drawn in Canvases › Advanced, but the key is not in the ? sheet or its moved list.
- **Files panel header**: New folder, inline composer, "+" new brief board (→ ⌘N?), folder row menu (New folder here, Rename folder, Delete folder), drag-and-drop between folders, keyboard tree navigation → likely 11 · pn-organise / pn-move; not in 06.
- **Open-comment count badge on tree rows** — not drawn in 06/10 (10 shows a Comments count only on the cluster).
- **Right-click menus** (world, artboard, element, multi-select align/distribute, Tidy up, Duplicate at width, Artboard kind, Open Timeline, Hide/Lock, Insert ▸, Replace image, Convert children to absolute, Select layer, Inspect, Export selection/artboard) — 06 maps only the items that moved to Inspector › Advanced; whether the context menus survive is for 14 Editing / 08 / 09.
- **Contextual element toolbar** (copy selector, copy id, inspect, align, Tidy up) — not in 06.
- **CommentsPanel "All" filter, Reopen, Delete comment row actions, file group headers** — 10 draws Open / Mine / Resolved and Resolve only.
- **Chat quick action "Implement N comments"** and the AI empty-state CTAs ("Create new design system" + suggestions) — 03.
- **Chat switcher per-chat menu** (Rename, Archive, Delete) — 03 (only Copy transcript is in 06).
- **ModeBanner, rate-limit banner, ErrorCard, PermissionPrompt, ElicitationPrompt, AI OS notifications** — 03.
- **GitPanel empty states** ("Not versioned yet", "Nothing to save", "N versions ready to publish"), "Cloud is saving" note, result banners, **History Undo (of a restore)**, **Retry when cloud history is unreachable**, **Save all** — not drawn in ad-history.
- **DiffView** (Compare against select, Side by side / Overlay wipe slider, zoom bar, "How to resolve" picker) — only a "Compare" button and link in 06; presumably 11 · pn-compare.
- **RepoBranchSwitcher chat-guard confirm before switching branches** — not drawn.
- **CloudBar account menu project list** (Connect / Disconnect / viewer state per project), **"Connect this folder" deep-link dialog**, **file deep-link dialog** (Open in browser, Copy web link, Open project, Not now) — not in 06/10 (likely 11 · pn-deeplink / 02).
- **Sign in to Maude Cloud device-code dialog** — 10 uses a browser sign-in instead; the device-code flow's fate is unstated.
- **TeamProjects dialog** "Your team's own server" (Server address, Email, Password) — ledger points to ad-edge-hub, but that artboard shows only an already-connected hub (address, token, signed-in-as); the **add-a-hub form** is not drawn.
- **SyncConsentDialog** (auto-shown once per hub) — the setting lives in Settings › Advanced; the first-time dialog itself isn't drawn (02?).
- **Sync panel notice "Dismiss"** and the delivery-attention list — not explicit.
- **Banners**: CloudRoleBanner ("Got it"), first-run mode hint toast — not mapped. SyncBanner states diverged/rejected — only the offline/back-online/rate-limit cases are drawn.
- **Tours**: collab tour (N-only) and quick-setup tour — only "Take the tour" is in Help; **SetupChecklistDialog** (Start guided setup, Bring my existing brand, Import from Figma, re-check) — not mapped; the empty-state "Start quick setup" button — not mapped.
- **What's new panel** (per-entry Learn more, Take tour) and the auto toast — only the Help row is drawn.
- **ReportBugDialog** 3 steps (screenshot, redact, consent checkboxes, Save locally & open GitHub) — only referenced.
- **Figma token Test/probe** — Connections shows Disconnect only.
- **Transcription engine explicit options** (local whisper.cpp / ElevenLabs Scribe / Groq Whisper) and **keyframe options** (Gemma / ffmpeg / Blind) — only "Auto" is drawn; the hint names them. The select must still offer every option.
- **Generate dialog "Model" select and the Generate / Insert buttons** — the AI fold has Provider/Shape/Place but no image model select.
- **Timeline AI clip "Generate ✨" right-click**, ClipInspector, transport (Loop, Mute, Volume, comp picker) — 07.
- **Photo knobs** — 12.
- **Theme toggle via the palette** ("Toggle theme") and the palette "New video…" — not mentioned (theme → Settings › General).
- **Native context menu suppression**, the generic prompt dialog — infra, no UI home needed.
- **Persisted UI prefs** (`mdcc-*` keys) — must migrate to the v2 homes (e.g. `mdcc-panel-sides`, `mdcc-layers-mode`, `maude-cp-mode` → fold state).

### C. The ledger's own "not drawn yet" rows (2)
- Preview of non-canvas files (md, text, image, video, audio, font) → home Canvases panel.
- Imported-from-Figma / reconstructed / experimental badges → home Canvases panel.

---

## Cross-cutting notes (contradictions, ambiguities, easy to forget)

1. **Follow already exists.** The 10 header says "Follow and Bring everyone here do not exist today", but `apps/studio/participants-chrome.tsx` ships an avatar popover with **Follow / Stop following** (one-way viewport mirroring through awareness `followTarget`). Treat Follow as EXISTS → restyle (frame, pill, esc/scroll/click exit). Only Go to, Bring everyone here, the spotlight and "Following You" on peers are NEW.
2. **H conflict.** Canvases › Advanced labels "Show hidden files **H**", while CONTRACT §2 makes H = Hand and the ? "moved" fold says "Hidden files H → Canvases › Advanced — H is Hand". Drop the key hint from the switch or define the key as panel-focus-only.
3. **⇧⌘A** was both Assistant (shell) and Select all annotations (Edit menu) today; v2 gives it to Select all annotations only. Make sure the Assistant binding is removed.
4. **Exports badge location.** The ledger maps "Export jobs badge" → Export › Advanced (ad-export), but the ad-export caption says "now the Exports icon in the Share cluster" (09 · ex-history). The kit `ShareCluster` has no Exports icon. One of the two needs fixing.
5. **"Repo state changed — reload?"** is mapped to ad-diag, but ad-diag does not draw it; triage says it becomes automatic. Implement as an auto reload plus a log line, with Reload canvas ⌘R as the manual path.
6. **Roles vs hub.** Can view (look-only) has no hub role; the hub's viewer = Can comment. Editors moving to the trash conflicts with member `delete:false`. Per-canvas sharing has no backend. Links "never more than Can comment" need link-role enforcement. A self-hosted hub has only admin/member, so hide Can comment/Can view and the link there.
7. **Comments filters**: today All/Open/Resolved (default Open); v2 Open/Mine/Resolved. "All" disappears, which conflicts with the nothing-deleted rule. Keep All reachable (e.g. ⌘K or a fourth segment), or get it accepted as a deletion.
8. **Fold memory scope**: [ad-edge-remember] shows it is per Mac and **across projects** (Monday Studio site → Tuesday Alligators). [ad-why] says "for that panel, on this Mac". Don't key it by project.
9. **Open all** also opens "the menu's Advanced groups and the ? sheet's" — the menu Advanced groups (View, Edit › New artboard, Diagnostics) need a persisted open state too. Kit `ProjectMenu` already takes an `advanced` prop.
10. **Version history** is a top-level menu item, never under File; the Get latest action lives in Sync details, not Version history. In the browser the branch/publish/fetch rows are hidden ("cloud versions").
11. **Status word for stuck sync**: the canvas picks **Syncing…** for both normal syncing and a rate-limited stall (open question). The callout under the status carries the difference; the status itself never says "error" while data is safe.
12. **Ask before** (permission mode) reads "Replace or move to the trash" — copy follows the trash words (CONTRACT §7). Map the permission-mode enum values to designer phrases; only one is drawn.
13. **AI fold "Show in chat"** values beyond "Normal" (thinking, verbose, summary) aren't drawn — keep all four.
14. **Settings › Advanced "Local server port"** is editable in the mock — today the port is dynamic. Decide: display-only, or a real setting with a restart.
15. **"Use my own plugin copy"** turns the `MAUDE_NO_PLUGIN_BOOTSTRAP` env var into a UI switch — it needs a desktop restart / ACP respawn and must only affect the ACP panel (DDR-168).
16. **Experimental "Faster canvas engine (preview)"** has no known backing feature — confirm or drop before build.
17. **Decision memory** row shows "523 decisions · kgai" — that is this repo's count; in user projects it depends on kgai being installed. Needs a not-installed state.
18. **Telemetry** ("Send anonymous usage data") implies a telemetry pipeline that may not exist; ship it off and wire it later, or drop it.
19. **Code view lines highlight** needs reliable artboard → source-range mapping; the canvas lib resolves artboards at runtime. A static parse of `DCArtboard id=` works for the common case only.
20. **Context matrix [ad-edge-where] is PROPOSED** — in the browser, Settings shows only General and Connections; Diagnostics says "Runs in the cloud" and keeps Download all. Can comment hides git and AI and makes CSS read-only. Every ⌘K action needs the same visibility predicates as the folds, or ⌘K would leak hidden rows.
21. **Mention e-mails** need a cloud-side e-mail sender plus per-user preferences in Settings › General (02 · ob-settings must carry "which e-mails you get") — not drawn there per this canvas.
22. **Offline invites** queue client-side, but invites are created on the hub/dashboard — the outbox must survive app restarts.
23. **"Your last changes were saved first"** on removal requires flushing the removed user's pending writes before the revocation takes effect, or saying something weaker.
24. **Trash rule wording** "only owners clear it out" vs [ad-left] "Clear out older than 30 days…" in Canvases › Advanced: that button must be owner-only on shared projects (hidden or disabled for editors). Also "Trash keeps things until you clear it out" (no auto retention) vs a "Clear out older than 30 days…" action — consistent (manual), but don't add auto-prune.
25. **Share scope default**: [co-share-sheet] defaults to This canvas; [co-local-cloud] step 3 defaults to Whole project. Rule: canvas open → This canvas; first share after Move to cloud → Whole project. State it in code.
26. **Team row** ("Everyone in Alligators brand · Can edit") is read-only in canvas scope — editing the team role happens in Whole project. The underlying "team" = project members; there is no org/team entity in the hub today.
27. **Bring everyone here** without permission: followers can leave with esc; consider owner/editor only (not drawn). Reduced-motion spec must be honoured.
28. **Idle cursors** (grey, initial only) and the people list's "in Comments" / "in a browser" need extra awareness fields.
29. **Presence colours**: coral is reserved for AI. Assign peer colours from {sky, green, yellow, lilac, grey} with You = yellow locally — the "you" colour is per viewer, so the same person may appear in different tones on different screens. Decide whether the tone is per user (stable) or per session.
30. **Version history object scope** ("this sticky") needs history at object granularity — today history is per file/commit. It could be derived from the Yjs/journal, but that is non-trivial.
31. **Two Share sheets in code today** (ShareDialog + IdentityBar CreateProject "Share this project") must collapse into the one sheet. The GitHub invite survives only under Advanced.
32. **⌘K must find people actions** too ("Follow Tereza", "Bring everyone here").
33. Mono text is allowed **only** inside Advanced bodies, Diagnostics and the code view — a lint/review rule for implementers (e.g. no mono in the closed Version history: "no commit ids").
