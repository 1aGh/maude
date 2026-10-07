# maude-v2 — product contract (menu · shortcuts · words · voice)

The one source of truth that every maude-v2 specimen and every Maude v2 canvas copies.
When a specimen disagrees with this file, the specimen is wrong. Written 2026-10-06 from
the Round-3 copy/typography critic findings; `components-toast-menu` (menu) and
`components-keyboard` (keys) are the specimens that render it.

## 1 · The one menu (under the project pill)

- Opened by the **project pill** (mark + project name, top-left). Accessible name: **"Project menu"**.
- In "where it lives" chips and copy, write the path as **`Menu › File › Export…`** — never "Icon menu", never "the icon menu".
- The Mac's own menu bar is untouched (native File/Edit/… stay as macOS provides).

```
Menu
├─ Back to Home
├─ File ›        New canvas ⌘N · New project… ⇧⌘N · Open project… ⌘O
│                Duplicate canvas · Rename canvas · Move to…
│                Import from Figma… · Import a brand… · Assemble clips into a video
│                Export… ⇧⌘E · Handoff to production ⇧⌘H · Close canvas
├─ Edit ›        Undo ⌘Z · Redo ⇧⌘Z · Cut ⌘X · Copy ⌘C · Paste ⌘V
│                Select all ⌘A · Deselect all esc · Select all annotations ⇧⌘A
│                Advanced ▸ New artboard (Desktop · Laptop · Tablet · Mobile · A4 · Letter)
├─ View ›        Hide panels / Show panels ⌘\ · Comments ⇧⌘M · Assets · Annotations ⇧P · Present the canvas
│                Zoom in ⌘+ · Zoom out ⌘− · Zoom to fit ⌘0 · Actual size ⌘1
│                Advanced ▸ Layers as a panel · Inspector ⇧⌘I · Open inspector on select ·
│                           Keep timeline open ⇧⌘T · Minimap · Zoom controls · Print guides · Hidden files ·
│                           Pin panels to the side
├─ Help ›        Keyboard shortcuts ? · Help and guides F1 · What's new · Take the tour ·
│                Watch the intro · How sharing works · Report a bug…
├─ Version history        ⌥⌘H   (top level — one click; never under File)
├─ Share…                 (opens the Share sheet)
├─ Export…                ⇧⌘E
├─ Diagnostics ›          Sync (status word) · Server (status word) · AI setup (status word) ·
│                         Logs · Reload canvas ⌘R · Check AI setup again
│                         Advanced ▸ Address · Process · Project folder · Resync now · Download all
│                         (a SUBMENU — never "its own window"; Report a bug lives in Help only)
└─ Settings…              ⌘,   (General · Connections · Advanced)
```

## 2 · Keyboard

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| V | Select | ⌘K | Search (canvases, actions, AI, every hidden tool) |
| H | Hand (or hold Space) | ⌘\ | Hide / show panels |
| F | Frame (draws an artboard, or a frame inside one) | ⌘/ | Ask AI (selection attached) |
| R | Shape | ? | All shortcuts |
| P | Pen | esc | Step back (deselect, close, leave tool) |
| T | Text | ⌘Z / ⇧⌘Z | Undo / Redo (includes changes made by AI) |
| N | Sticky | ⌘0 / ⌘1 | Zoom to fit / Actual size |
| C | Comment | ⌥⌘H | Version history |

- Dock order (left → right): **Select · Hand · Frame · Shape · Pen · Text · Sticky · Comment · More (…)**. "More" holds Arrow, Highlighter, Section, Eraser, Insert. The AI is NOT a dock tool — it is the AI chat panel (its folded icon is the spark).
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

## 4 · Voice rules

- The app never says **"we"** or **"I"**, and never names itself in running copy. Sole exception: the Home question **"What shall we make?"** (you + AI).
- The AI's own messages describe the result, not itself: "Done — three hero variants are on the canvas. Pick one." (no "I made…").
- Status / errors: *what happened · what is safe · one verb*. No exclamation marks, no "Oops".
- Dialogs: the title asks with the same verb the primary button does ("Move "Pricing" to the trash?" → **Move to trash**). The other button is **Cancel**.
- Callouts and toasts carry **one** action at most.
- People: the signed-in person is **"You"**; collaborators are **Tereza** and **Jonas**. Projects: **Studio site**, **Alligators brand**. Canvases: Homepage, Pricing, Onboarding, Mobile — detail.
- No results: **"Nothing called "pricng". Try another word, or ask AI to find it."**
- Times: relative first ("2 min ago", "yesterday"); absolute as **"6 Oct, 14:05"** (24-hour). Counts: write the number with a noun that reads for 1 and many ("1 canvas", "5 canvases") — plural rules are i18n's job; never "canvas(es)".
- Panel copy: "Panels hidden. Press ⌘\ to bring them back."

## 5 · Type roles that must not drift

- **Home question** ("What shall we make?"): `--type-3xl`, `--font-rounded`, `--w-semibold`, tracking 0.
- Specimen/page H1: `--type-3xl`, `--font-display`, `--w-semibold`, `--tracking-tight`.
- Panel titles: `--type-xs`, `--w-semibold`, `--fg-2`. AI chat replies: `--type-base` (14), never 12.
- Running captions: max **60ch** (SF's `ch` runs ~25 % wide). Lede: max 56ch.
- Weights stop at `--w-semibold` (600). Tabular figures for any live number (sizes, zoom, counts).

## 6 · Settled details (copy round 2, 2026-10-06)

- **Empty canvas line:** "Your canvas is ready. Ask AI for a first draft, or start drawing." (never "screen").
- **Share sheet:** primary button **Invite**; "Copy link" is a secondary button in the link row.
- **Project-tab menu (right-click a tab):** Rename… · Move to a new window · Sign in as another account… · Close tab.
- **Save status:** one word next to the faces in the Share cluster — *Saved* · *Syncing…* · *Offline — kept on this Mac* · *Local project*. No dot on the project pill.
- **Access status** (people without edit rights, same slot): *Can view* (look only) · *Can comment* (look, comment and download) — with *Ask to edit* (a request to the owner) as the one action.
- **Project-tab avatar:** the project's initial (S = Studio site, A = Alligators brand), not the person's.
- **Search results count:** "N results". Key names lower-case in running copy: esc, ↵, tab.

## 7 · Cross-canvas behaviour rules (v2 canvases, 2026-10-06 — proposed, Michal to confirm)

- **AI offline:** Ask AI stays enabled. A prompt sent offline is **queued** — the prompt shows "Queued — sends when this Mac is online." The empty-canvas line keeps its first sentence and adds "AI is back when this Mac is online."
- **AI not connected yet:** Ask AI looks the same as always. The first time it's used, one sheet asks to connect a Claude account ("Connect your Claude account to let AI draft this." → **Connect**, Cancel); after connecting, the waiting prompt runs. The empty-canvas line never changes for this case. Cloud does not include AI — people bring their own Claude subscription or API key.
- **Home always has a way in without AI:** "Start with an empty canvas ⌘N" under the starters (kit `Home` renders it by default).
- **One AI per artboard:** a second ask on a busy artboard waits in line (or "Run on a copy"); different artboards run side by side; a whole-canvas ask starts on the free artboards first.
- **Trash words:** things are "moved to the trash", never "deleted"; Trash keeps them until you clear it out.
- **Mode switch:** Edit · Preview · Present lives in the Share cluster; read-only people see a non-editing state there instead of Edit.
- **Export done:** the done toast's one action is **Show in Finder** (the file is on this Mac either way); share links live in Share (Copy link). A partial failure says "Exported 114 of 115" and offers one Retry.
- **Export scope:** ⇧⌘E with nothing selected exports the current canvas; the sheet always shows Scope (Selection · This canvas · Folder · Whole project) with a size/time estimate.
- **Print colour line:** "RGB — the print shop converts to CMYK" (no CMYK option in v2).
- **Timeline:** the timeline appears when a video artboard is selected and folds away when it is deselected. ⇧⌘T toggles View › Advanced › "Keep timeline open" (shows it now and keeps it open after deselect). Tap Space plays/pauses a selected video artboard; hold Space is always Hand.
- **Assets:** the left panel's third tab (Canvases · Layers · Assets); Menu › View › Assets and ⌘K open it (no key). Every tile can be placed by keyboard: select a tile, ↵ places it on the selected artboard (or a "Place" button in the tile menu).
- **Search in pictures:** names and tags always. Searching what's *in* pictures is opt-in once per project — "Let AI describe your pictures so search can find what's in them" (uses your Claude account) — and falls back to names when AI isn't connected.
- **Figma import:** frames arrive as Figma's exact picture; "Make editable" converts one artboard (needs Figma Dev Mode on a paid seat). Never claim text stays editable on import.
- **Not here yet vs missing:** a file that exists on someone's device but hasn't synced = "Waiting for Jonas's Mac" (quiet, no error). Only a file no device has is "Missing" with Relink….
- **Photo edits** (crop, look, background removal) apply to that one use; "Apply to every use" is an explicit choice.
