# maude-v2 — product contract (menu · shortcuts · words · voice)

The one source of truth that every maude-v2 specimen and every Maude v2 canvas copies.
When a specimen disagrees with this file, the specimen is wrong. Written 2026-10-06 from
the Round-3 copy/typography critic findings; `components-toast-menu` (menu) and
`components-keyboard` (keys) are the specimens that render it.

**Gate 0 folded in (2026-10-09).** Every row of the Gate 0 decisions register in
`.ai/plans/feature-maude-v2-redesign.md` was signed by Michal on 2026-10-08; the outcomes are
written into the sections below (row ids in brackets, e.g. [A7], [C26]). Nothing here is
"proposed" any more. The register DDR records each row with Michal's answer.

## 1 · The one menu (under the project pill)

- Opened by the **project pill** (mark + project name, top-left). Accessible name: **"Project menu"**.
- In "where it lives" chips and copy, write the path as **`Menu › File › Export…`** — never "Icon menu", never "the icon menu".
- **The Mac's own menu bar** [C3, D19] keeps **Maude** (About · Check for Updates… · Quit), **Edit** (the predefined undo/redo/cut/copy/paste/select-all WKWebView needs) and **Help › Report a Bug…** as today. Its **File** menu becomes **New canvas ⌘N · New project… ⇧⌘N · Open project… ⌘O · New Home tab ⌘T**, and a **Window** menu carries the native tab commands.
- **Project tabs are native macOS window tabs** [A1]. Home is its own window tab (⌘T, "Back to Home"). A tab shows no avatar and no status glyph — that state lives in the project pill and the Share cluster. Right-clicking a tab gives the native tab menu; **"Sign in as another account…"** lives in the project pill menu.

```
Menu
├─ Back to Home
├─ File ›        New canvas ⌘N · New project… ⇧⌘N · Open project… ⌘O
│                Duplicate canvas · Rename canvas · Move to…
│                Import from Figma… · Import a brand… · Assemble clips into a video
│                Export… ⇧⌘E · Handoff to production ⇧⌘H · Close canvas
│                Sign in as another account…   [A1, C6]
├─ Edit ›        Undo ⌘Z · Redo ⇧⌘Z · Undo history… · Cut ⌘X · Copy ⌘C · Paste ⌘V · Copy / Paste properties ⌥⌘C / ⌥⌘V
│                Select all ⌘A · Deselect all esc · Select all annotations ⇧⌘A
│                Advanced ▸ New artboard (Desktop · Laptop · Tablet · Mobile · A4 · Letter)
├─ View ›        Hide panels / Show panels ⌘\ · Comments ⇧⌘M · Assets · Exports · Annotations ⇧P · Present the canvas
│                Zoom in ⌘+ · Zoom out ⌘− · Zoom to fit ⌘0 · Actual size ⌘1
│                Advanced ▸ Layers as a panel · Inspector ⇧⌘I · Open inspector on select ·
│                           Keep timeline open ⇧⌘T · Minimap · Zoom controls · Print guides · Hidden files ·
│                           Pin panels to the side
├─ Help ›        Keyboard shortcuts ? · Help and guides F1 · What's new · Take the tour ·
│                Set up Maude… · Watch the intro · How sharing works · Report a bug…
├─ Version history        ⌥⌘H   (top level — one click; never under File)
├─ Share…                 (opens the Share sheet)
├─ Export…                ⇧⌘E
├─ Diagnostics ›          Sync (status word) · Server (status word) · AI setup (status word) ·
│                         Logs · Reload canvas ⌘R · Check AI setup again
│                         Advanced ▸ Address · Process · Project folder · Resync now · Download all
│                         (a SUBMENU — never "its own window"; Report a bug lives in Help only)
└─ Settings…              ⌘,   (General · Connections · Advanced; Advanced also has "Check for updates" [D19])
```

- **Exports** [C9]: an Exports icon with a progress ring joins the Share cluster once any export exists; also ⌘K "Exports" and Menu › View › Exports.
- **Trash** [C10]: the last row of the Canvases panel and ⌘K "Trash". Clearing it out is owner-only [A6].
- **Help** [D13]: "Take the tour" runs the v2 tours; "Set up Maude…" is today's setup checklist; What's new keeps a quiet dot; Report a bug keeps its three-step flow.

## 2 · Keyboard

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| V | Select | ⌘K | Search (canvases, actions, AI, every hidden tool) |
| H | Hand (or hold Space) | ⌘\ | Hide / show panels |
| F | Frame (draws an artboard, or a frame inside one) | ⌘/ | Ask AI (selection attached) |
| R | Shape | ? | All shortcuts |
| P | Pen | esc | Step back (deselect, close, leave tool) |
| T | Text | ⌘Z / ⇧⌘Z | Undo / Redo (includes changes made by AI) |
| I / ⇧I | Image / Component | ⌘0 / ⌘1 | Zoom to fit / Actual size |
| N C M A E S | Sticky · Comment · Marker · Arrow · Stickers · Section — switch to Preview with that tool | ⌥⌘H | Version history |
| ⌥⌘P | Preview [A7] | ⌥⌘↵ / ⇧⌥⌘↵ | Present from the selected artboard / from the start [A7] |
| L | Pointer (in Present) [A7] | ⇧⌘C | Copy as PNG (inspector Export section) [C21] |
| ⌘N / ⇧⌘N / ⌘O / ⌘T | New canvas / New project… / Open project… / New Home tab [C3] | ⇧⌘E / ⇧⌘H | Export… / Handoff to production |

- **Two toolbars, one per mode (Michal 2026-10-08):**
  - **Edit** — tools that make things *inside artboards*: **Select · Hand · Frame · Shape · Pen · Text · Image · Component · More (…)**. "More" holds Line, Ellipse, Polygon, Crop, Export area.
  - **Preview** — annotation tools only, FigJam-style: **Hand · Sticky · Comment · Marker · Arrow · Shape · Text · Stickers · Section**. The design is live, not editable. **Stickers (E)** opens the sticker gallery: quick stamps for voting on top, then the bundled sticker packs (FigJam Doodle · Life Style · Opposing Thoughts · Project status) with keyword search and Recent; a picked sticker lands at 160 px.
  - Annotation keys (N C M A E S) pressed in Edit switch to Preview with that tool; esc steps back to Edit. The AI is NOT a toolbar tool — it is the AI chat panel (its folded icon is the spark).
- **Object keys in Edit** [A11]: ⌥⌘G frame selection (⌘G works too) · ⇧⌘G remove frame · ] / [ forward / backward · ⌘] / ⌘[ to front / back · arrows nudge 1 px (⇧ 10 px), inside auto layout arrows reorder · double-click enters a frame, esc steps out · ⌘D duplicate · ⌫ removes (⌘Z and Version history bring it back). Hide has no key (⇧⌘H is Handoff). **In Preview** ⌘G / ⇧⌘G group / ungroup annotations.
- **⇧⌘L** locks / unlocks the selection — objects in Edit, annotations in Preview (shipped behaviour). A locked item rides along with its artboard but can't be dragged by itself.
- **Focus decides** [C26]: a key goes to the first owner that wants it — focused text field › timeline focus (S split, I / O loop, ← / → frames, ⌘+ / ⌘− timeline zoom) › selection (a generated image's ← / → other takes) › mode tools › global. **⌘B always splits.**
- **Keys and tools that moved** (listed in "?" under that heading) [D1–D4, D17]: the Browse tool is Preview mode (Hand + click uses the design) · Pen B → **P** · Rect R → **Shape R** · Ellipse O → Edit › More › Ellipse · Highlighter I → the Marker's Highlighter tip · Eraser E → the Marker's Eraser tip · Section ⇧S → **S** · the canvas palette's Export ⌘E → one sheet ⇧⌘E (**⌘E is unbound**; "Export again" sits on every Exports row) · ⇧⌘R Refresh tree stays (Canvases › Advanced + ⌘K) · T toggle tree → ⌘\ / the panel icon · H hidden files → the Canvases › Advanced switch (no key) · S design-system view → the pinned Design system row · N new board → ⌘N · Toggle theme → ⌘K "Theme" + Settings › General · New video… → ⌘K "New video" + New artboard › Video.
- A v2 key lands in the same change that removes the v1 binding it collides with (T / H / S / N / I / E / B, ⇧⌘A, ⇧⌘G, ⌘E, native ⌘N); every scope's bindings are unique.
- Write modifier order as macOS does: **⌥⇧⌘** (e.g. `⇧⌘E`, `⌥⌘H`). Return key glyph: **↵**.

## 3 · Words (use exactly these)

| Say | Not | Meaning |
| --- | --- | --- |
| canvas | board, file, page | the infinite surface a project holds many of |
| artboard | screen, frame (as a noun for top-level) | a sized top-level area on the canvas |
| frame | container, group box | a box inside an artboard (also the F tool) |
| project / project tab | repo, workspace, folder | one project per macOS window tab |
| panel | island (in UI copy), sidebar | any floating piece of chrome. "Island" is the DS component name only |
| toolbar | dock (in UI copy) | the bottom tool island. "Dock" is the DS component name only |
| AI chat panel (first mention) · AI (after) | Assistant, Claude, the assistant, AI panel | the AI's panel |
| AI (a name, no article) | the AI | "Ask AI", "AI is drawing the footer", "Made by AI" |
| Search | command palette, ⌘K menu, quick find (in UI copy) | ⌘K. "Command palette" is the DS name only |
| Version history | Changes, commits, history log | saved versions with Restore |
| Hide panels / Show panels | fold, tuck, collapse (in UI copy) | ⌘\. "Fold into its icon" is how the DS describes the motion |
| Share | publish, invite (as the button) | the one Share button; "Invite people" lives inside the sheet |
| Advanced | Pro, Expert, More settings | the disclosure at the foot of a panel |
| Diagnostics | Debug, Status, Developer | the Menu submenu |
| Stickers | Stamps (as the tool) | the E tool and its gallery [C12]. "Stamp" in copy means only a **vote stamp**; the internal id may stay `stamp` |
| Linked library — view only | Can view (for a library) | the state of a design system linked from a team library [C18]. "Can view" is a people permission only |
| Untitled canvas | New canvas 1, Canvas | a new canvas's name (+ " 2", " 3") [C4]; Home names it from the prompt with a non-AI heuristic, offline create too |

## 4 · Voice rules

- The app never says **"we"** or **"I"**, and never names itself in running copy. Sole exception: the Home question **"What shall we make?"** (you + AI).
- The AI's own messages describe the result, not itself: "Done — three hero variants are on the canvas. Pick one." (no "I made…").
- Status / errors: *what happened · what is safe · one verb*. No exclamation marks, no "Oops".
- Dialogs: the title asks with the same verb the primary button does ("Move "Pricing" to the trash?" → **Move to trash**). The other button is **Cancel**.
- Callouts and toasts carry **one** action at most. A retry is the button **"Retry <name>"**, pressed by hand — never automatic [C20].
- People: the signed-in person is **"You"**; collaborators are **Tereza** and **Jonas**. Projects: **Studio site**, **Alligators brand**. Canvases: Homepage, Pricing, Onboarding, Mobile — detail.
- No results: **"Nothing called "pricng". Try another word, or ask AI to find it."**
- Times: relative first ("2 min ago", "yesterday"); absolute as **"6 Oct, 14:05"** (24-hour). Counts: write the number with a noun that reads for 1 and many ("1 canvas", "5 canvases"); never "canvas(es)".
- **English only in v2.0** [A20]: no message catalog; a later translation is a separate project. Counts still use the real noun for 1 and for many.
- Panel copy: "Panels hidden. Press ⌘\ to bring them back."

## 5 · Type roles that must not drift

- **Home question** ("What shall we make?"): `--type-3xl`, `--font-rounded`, `--w-semibold`, tracking 0.
- Specimen/page H1: `--type-3xl`, `--font-display`, `--w-semibold`, `--tracking-tight`.
- Panel titles: `--type-xs`, `--w-semibold`, `--fg-2`. AI chat replies: `--type-base` (14), never 12.
- Running captions: max **60ch** (SF's `ch` runs ~25 % wide). Lede: max 56ch.
- Weights stop at `--w-semibold` (600). Tabular figures for any live number (sizes, zoom, counts).

## 6 · Settled details (copy round 2, 2026-10-06 · Gate 0, 2026-10-08)

- **Empty canvas line:** "Your canvas is ready. Ask AI for a first draft, or start drawing." (never "screen").
- **Share sheet:** primary button **Invite**; "Copy link" is a secondary button in the link row. It is the ONE Share surface everywhere [C11]; a local project's state ("Move to cloud…") lives inside it.
- **Project tabs** [A1]: native window tabs, no avatar, no status glyph; the native tab menu on right-click; "Sign in as another account…" in the project pill menu.
- **Accounts** [C6]: Settings › General lists every account on this Mac; each project tab is bound to one.
- **Save status:** one word next to the faces in the Share cluster — *Saved* · *Syncing…* · *Offline — kept on this Mac* · *Local project*. No dot on the project pill. A failed, un-queued write shows a fifth word, **Not saved**, only while it is true, with one action (**Retry**) [C2].
- **Errors & recovery** [C37]: after a crash the relaunch shows one line, "Maude quit unexpectedly. Your work up to 14:05 is here." + Report a bug…; a full disk shows *Not saved* + "This Mac is out of space — changes wait here until there's room." + Show in Finder.
- **Access status** (people without edit rights, same slot): *Can view* (look only) · *Can comment* (look, comment and download) — with *Ask to edit* (a request to the owner) as the one action. No AI chat panel for Can view / Can comment [C30].
- **Search results count:** "N results". Key names lower-case in running copy: esc, ↵, tab.
- **Comments** [C7, C8, D8]: a floating panel on the RIGHT, like the AI chat panel (the left slot stays Canvases · Layers · Assets); filters **Open · Mine · Resolved · All**, default Open; grouped by canvas; Reopen in a resolved thread; "Delete comment" on your own comments.
- **Stickers** [C13]: pack order FigJam Doodle · Life Style · Opposing Thoughts · Project status (display names trimmed); authors as in the manifests. **Marker** [C14]: tips Marker · Highlighter · Eraser; inks Ink (default) · red · amber · green · blue + more. **Resolved stickies** [C29]: struck through in place; ⌘K "Hide resolved stickies" toggles it per person.
- **Spacing** [C15]: one control — a Spacing segment *Packed · Space between*; the Gap menu lists tokens + "A number, no token…".
- **Inspector kind chip** [C16]: always the artboard kind (Web page · Fixed size · Print · Video); height mode is a row, not a chip.
- **Removing** [C17]: ⌫ on an object inside an artboard *removes* it (⌘Z and Version history bring it back). Artboards, canvases, assets, chats and tokens are *moved to the trash*.
- **Export** [C19, C21, B5]: one export sheet (09) everywhere — video's sheet (07) only supplies content (format ticks, captions, render location); captions default Off; estimates are computed, never copy. The inspector's Export section (+ / −, presets, Copy as PNG ⇧⌘C) uses 08's buttons as its default presets per kind. Print PDF defaults to **300 dpi**.
- **Video length** [C22]: a cap per artboard; a warning everywhere past 3,600 frames; "Allow longer" stored per artboard, up to the exporter ceiling (18,000 frames).
- **Figma** [C23, C24]: design comments arrive as comment pins, FigJam comments as stickies; frames arrive as *Fixed size* at Figma px.
- **Print guides** [C25]: View › Advanced › Print guides is the default for all; the per-artboard switch in the print inspector overrides it.
- **Chats** [C27]: personal and kept on this Mac (as today); others' *running* runs on a shared canvas show as View only; others' finished chats are not listed. The AI chat panel has one canonical header — 03's [C28].
- **Present** [C31]: canvas order (row by row, left to right) unless "Order and notes…" set an order; notes, order and skip live in `.meta.json` (versioned).
- **Presence colours** [C32]: stable per person per project; coral is reserved for AI; "You" is yellow locally. **Bring everyone here** [C33]: editors and owners only; followers leave with esc.
- **Settings › Advanced** [C34]: "Local server port" is display only; "Faster canvas engine" and "Send anonymous usage data" are not built (no-telemetry); "Decision memory" shows a count when kgai is set up, else "Not set up".
- **Timeline tracks** [C35]: Text · Graphics · Video · Music by default; "+ track" under the timeline's Advanced adds Video 2 / Music 2; existing comps' overlay lanes migrate to Video 2. **Sound only** is .m4a (AAC; .wav under Advanced); the **captions file** is .srt (.vtt under Advanced) [C36].
- **Home tab backend** [C38]: one project-less Home server mode (shared, loopback) serves the same client bundle in Home mode; the shell owns the cross-project index (recents, pins, open tabs, thumbnails cache).

## 7 · Cross-canvas behaviour rules (decided — Gate 0, Michal 2026-10-08)

- **AI = your own Claude account** [A2]: cloud does not include AI; people bring their Claude Pro/Max sign-in or an API key.
- **AI offline:** Ask AI stays enabled. A prompt sent offline is **queued** — the prompt shows "Queued — sends when this Mac is online." The empty-canvas line keeps its first sentence and adds "AI is back when this Mac is online."
- **AI not connected yet:** Ask AI looks the same as always. The first time it's used, one sheet asks to connect a Claude account ("Connect your Claude account to let AI draft this." → **Connect**, Cancel); after connecting, the waiting prompt runs. The empty-canvas line never changes for this case.
- **Home always has a way in without AI:** "Start with an empty canvas ⌘N" under the starters (kit `Home` renders it by default).
- **One AI per artboard** [A4]: a second ask on a busy artboard waits in line (or "Run on a copy"); different artboards run side by side; a whole-canvas ask starts on the free artboards first. There is no "Run anyway".
- **Quitting while AI runs** [A5]: AI runs on this Mac and stops; the dialog warns; "Keep going" on the next launch resumes the session. No server-side AI in v2.0.
- **AI and the pointer** [A8, Michal's override]: AI changes show **live in Preview**, under the pointer too. In **Present** a change lands when you move on to the next artboard (the audience never sees an artboard change under them).
- **Cloud trial** [A3]: 14 days, no card, starting at the first sign-in. At the end projects stay readable and exportable; editing and sync pause behind "Choose a plan".
- **Roles** [A6, A19]: Can view = look only · Can comment = look, comment, download · Can edit · Owner. Editors move things to the trash; only owners clear it out. A self-hosted hub without view-only accounts hides Can view and links. Can view is refused every download/export on the server — a courtesy limit, not DRM (a viewer's browser still holds what it renders).
- **Editing the same object** [A10]: while someone edits an object, others see it in that person's colour ring with readable, read-only fields and one action (Comment); it frees on deselect, blur, 30 s idle or disconnect. AI holds its run's objects the same way. Different objects in the same artboard are editable by everyone at once. One AI run is one undo step; Edit › Undo history… lists You and AI steps.
- **Trash words:** things are "moved to the trash", never "deleted"; Trash keeps them until you clear it out.
- **Mode switch** [A7]: Edit · Preview · Present lives in the Share cluster; read-only people see a non-editing state ("Viewing") there instead of Edit.
- **Export done:** the done toast's one action is **Show in Finder** (the file is on this Mac either way); share links live in Share (Copy link). A partial failure says "Exported 114 of 115" and offers one Retry.
- **Export scope:** ⇧⌘E with nothing selected exports the current canvas; the sheet always shows Scope (Selection · This canvas · Folder · Whole project) with a size/time estimate.
- **Print colour line:** "RGB — the print shop converts to CMYK" (no CMYK option in v2).
- **Timeline:** the timeline appears when a video artboard is selected and folds away when it is deselected. ⇧⌘T toggles View › Advanced › "Keep timeline open" (shows it now and keeps it open after deselect). Tap Space plays/pauses a selected video artboard; hold Space is always Hand.
- **Assets:** the left panel's third tab (Canvases · Layers · Assets); Menu › View › Assets and ⌘K open it (no key). Every tile can be placed by keyboard: select a tile, ↵ places it on the selected artboard (or a "Place" button in the tile menu).
- **Search in pictures:** names and tags always. Searching what's *in* pictures is opt-in once per project — "Let AI describe your pictures so search can find what's in them" (uses your Claude account) — and falls back to names when AI isn't connected.
- **Figma import:** frames arrive as Figma's exact picture; "Make editable" converts one artboard (needs Figma Dev Mode on a paid seat). Never claim text stays editable on import.
- **Not here yet vs missing:** a file that exists on someone's device but hasn't synced = "Waiting for Jonas's Mac" (quiet, no error). Only a file no device has is "Missing" with Relink….
- **Photo edits** (crop, look, background removal) apply to that one use; "Apply to every use" is an explicit choice.
- **AI buttons and elevation (Michal's review, 2026-10-08):** send / Ask AI buttons are azure with a white spark glyph (an AI action is still an action); vermilion fills only for AI presence (cursor, working tag, progress). Elevation tokens lowered — islands float on a soft shadow, not a drop shadow.
- **Hidden votes** [A18]: hidden ballots are truly secret only in cloud projects (the hub holds ballots and the timer); in local projects "hidden" means hidden in the UI, and the vote sheet says so.
- **Several systems in one project** [A12] (13 · ds-multi-*): each canvas uses one system; a project may use several (e.g. the club system + a campaign system), each with its own Design system canvas, all pinned together in the Canvases panel; one is the default for new canvases (a folder whose canvases share a system passes it on); switching is a review like "Update N canvases" with a Scope (This canvas · Folder · Whole project), primary **Switch N canvases**; a mixed folder falls back to the default; a system no canvas uses is a draft; migration turns every used `system/<ds>/` folder into its own Design system canvas.
- **Design system lives on a canvas** [A9]: each design system is ONE canvas — called "Design system" in UI copy (with several systems, each canvas is named after its system in the pill, the row and ⌘K) (never "board", §3) — pinned above every canvas in the Canvases panel (kit `CanvasesPanel system`), also reachable from ⌘K and the inspector's "Uses <DS name>" link. Sections on the board: Brand (logo, voice) · Colour · Type · Space & shape · Motion · Components · Patterns. Tokens and components are edited in place on the board; changes reach every canvas that uses them after a review ("Update 12 canvases"). Files (tokens CSS, specimens) are its Advanced layer, never the default view.
- **Design system — source of truth** [A15]: until the Design system canvas can edit tokens, the system CSS stays authoritative and `tokens.json` is generated from it; from then on the canvas is the source and the CSS is generated. A change made to the files outside the app (git, an agent, Claude Code) arrives on the canvas as a review ("2 tokens changed outside the app"); if both sides changed the same token, both are kept side by side until one is picked. The "Update N canvases" review lists every canvas with a tick (leave some out — they get the "update available" dot); Cancel leaves everything as it was. Every colour has a Light and a Dark value; the canvas has a Light · Dark switch and shows both on each swatch.
- **Design-system schema** [A14, A16]: three tiers — **core** roles (95 required names, Light + Dark, swapped mechanically on a switch), **expressive slots** (`<kind>-N`, optional, paired by kind), and a system's **own** tokens (`--x-*`, handed to AI on a switch). People never map tokens (only under Advanced). `maude design ds-check` checks structure, never values or looks. The run brings Maude's own systems up to the schema; other projects' systems get an in-app "Bring it up to the schema" offer and are never edited behind anyone's back.
- **How Claude drives Maude — files are the API** [A13]: Claude works through skills and direct edits of the project's readable JSX / JSON in `.design/`, plus `maude` verbs for what isn't a file edit (render/export, generation, sync, Version history and Trash, opening things in the window, checks). No MCP layer. One writer per AI run; sub-agents only read, verify or write files nobody else is editing. Every `.design/**` edit is checked (`maude design check`) and rolled back when it fails.
- **Versions across peers** [A17]: a v2 project carries `formatVersion: 2`; Maude 1.x opens it read-only with "Update Maude to edit"; `maude migrate v2` upgrades files with a dry-run and a way back.
