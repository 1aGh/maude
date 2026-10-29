# Moving from Maude 1 to Maude 2

Maude 2 is a new window around the same files. Canvases, the design system, comments, Version history and the sync hub carry over. The chrome around them changed: one menu, one search, one Share cluster, one toolbar per mode, and a Home that sits outside any project.

This guide covers four things:

1. what happens to a project when Maude 2 opens it (the `formatVersion` story);
2. what a person still on Maude 1 sees in a project that moved;
3. where each Maude 1 control went;
4. what changes for Claude Code, the `maude` command line and the plugins.

The in-app version of the "where did it go" table is [Coming from Maude 1](../site/content/docs/moving-from-1.mdx). The exhaustive list, one row per Maude 1 feature with its Maude 2 home, is [`apps/studio/client/v2/nothing-deleted.json`](../apps/studio/client/v2/nothing-deleted.json) (`rows[].v2.where`). A script, `scripts/check-v2-nothing-deleted.mjs`, fails the build when a Maude 1 feature has no home there.

## 1. The short version

| Question | Answer |
| --- | --- |
| Do I have to do anything to my files? | A project opens in Maude 2 for **viewing** straight away. To **edit** it, update it once (**Update project** in the app, or `maude migrate v2`). Nothing in the project is lost. |
| Can I go back? | Yes. `maude migrate v2 --reverse` returns the project to Maude 1's format. Every changed file is copied to `_history/_migrate/v2-<stamp>/` first. |
| What happens to people still on Maude 1? | They can look at the updated project but not change it, until they update. See section 3. |
| Are canvases rewritten? | No. Canvas `.tsx` files, design-system CSS, `assets/`, comments and the trash are never touched by the update. |
| What about my window layout, theme and "seen" flags? | Maude 2 carries them over on first launch. The Maude 1 keys stay where they are, so Maude 1 on the same Mac still works. |

## 2. Updating a project

### The marker

A Maude 2 project carries `"formatVersion": 2` in `.design/config.json`. A project without the key is format 1. A project linked to a team hub keeps the authoritative value on the hub (`store_meta.formatVersion`); the desktop app mirrors it, and a hub can raise a local value but never lower it.

| Build | Project is format 1 | Project is format 2 |
| --- | --- | --- |
| Maude 1.9.0 or later (the compatibility gate) | edits | opens read-only: *This project now uses Maude 2. Update Maude to edit it.* |
| Maude 2 | opens view-only: *View only — this project still uses Maude 1.* with the action **Update project** | edits |

### Updating in the app

Open the project, then choose **Update project** in the view-only line. The dialog asks *Update "<project>" for Maude 2?* and says what it means: *People still on Maude 1 can look at it but can't change it until they update. Nothing in the project is lost.* For a project that is local, or shared but already saving with accepted revisions, the toast when it finishes says *Updated for Maude 2. People on Maude 1 can look but not edit.* A shared project that still saves the old way also switches how it saves in the same step; see the next section for its words.

### How a shared project saves

A project linked to a team server either saves the old way or with **accepted revisions**: each change counts as saved once the team server confirms it, and Undo takes back only your own. **Update project** moves a shared project to accepted revisions too. Only the owner can, and nothing in the project is lost.

- **A Maude 1 project that still saves the old way.** The same Update does both steps. The dialog has a second paragraph: *It also starts saving with accepted revisions: each change counts as saved once the team server confirms it. Anyone with the project open switches over by themselves.* The toast says *Updated for Maude 2 and saving with accepted revisions. People on Maude 1 can look but not edit.*
- **A Maude 2 project that still saves the old way.** It is not view only, so the line is quieter and never asks by itself: *This project still saves the old way.* with **Update project**. The dialog asks *Update how "<project>" saves?* and says: *Each change counts as saved once the team server confirms it, and Undo takes back only your own. Anyone with the project open switches over by themselves, and nothing in it is lost. People on Maude 1 older than 1.3 can look at it but can't save changes.* The toast says *Updated. The project now saves with accepted revisions.*

Other toasts and lines:

| When | What Maude says |
| --- | --- |
| The team server is still bringing changes in after the switch | *Updated. The team server is still bringing changes in — nothing is lost.* |
| The format moved but the switch did not happen | *Updated for Maude 2, but it still saves the old way. Nothing is lost — Update project again to finish.* |
| The switch did not happen on a Maude 2 project | The dialog says *The project still saves the old way. Nothing in it changed — Update project again to switch.* |
| You own the project and opened it in a cloud tab | *This project still saves the old way. Switch it in the dashboard, under Saving.* with **Open dashboard**. A cloud tab cannot run the switch itself. |

Anyone who is not the owner sees no line about saving.

Maude 2 never updates a project by itself: opening a Maude 1 project only asks, once. A project Maude 2 creates is a Maude 2 project from the start, and so is a brand-new team project that a Maude 2 app starts on a Maude 2 team server.

Who can update:

| Situation | What the view-only line says |
| --- | --- |
| You own the project, or it is not shared | **Update project** |
| Somebody else owns the shared project | *View only — the owner hasn't updated this project for Maude 2 yet.* |
| The team server is too old to move projects | *View only — the team server needs an update before this project can move to Maude 2.* The owner also gets **How to update**: on the server, run `maude hub workspace-up --image-tag <release>` again (it keeps the settings, secrets and data). Once the server is updated, the line turns into **Update project**. |
| You own a team project and this Mac is offline | *View only — updating the project needs the team server, and this Mac is offline.* |

### Updating from a terminal: `maude migrate v2`

```sh
maude migrate v2                      # dry run: prints what would change, writes nothing
maude migrate v2 --apply              # write it
maude migrate v2 --reverse            # return the project to format 1
maude migrate v2 --reverse --strip    # ... and remove Maude 2-only fields (for peers that cannot keep them)
maude migrate v2 --json               # the report as JSON (also what the app's dialog shows)
maude migrate v2 --root <repo>        # another project than the current directory
```

The default is a dry run, and it writes nothing. In Claude Code every form of `maude migrate`, the dry run included, shows a permission card (the verb's tier is *destructive*). Two applies refuse to run without a terminal (exit 2): one on a project linked to a team server, which changes the format for every teammate, and any `--strip`. Run those in your own terminal, or use **Update project** in the app.

What the update does, in order:

| Step | Forward | Bytes changed on an unedited project |
| --- | --- | --- |
| `project.marker` | flips the hub first when the project is linked, then writes `formatVersion: 2` in `config.json` | one file |
| `annotations.check` | converts any legacy SVG annotation file, then checks that every annotation file loads with nothing dropped; refuses otherwise | none |
| `meta.check` | checks that every `.meta.json` is an object; refuses otherwise | none |
| `comps.tracks` | nothing: video tracks are derived | none |
| `chats.canvas` | per Mac: adds the canvas to a chat that lacks one, from its first context line | the chat records |
| `ds.tokens` | writes `system/<ds>/tokens.json` for each design system that lacks one (see [the design-system schema](../site/content/docs/design-system-schema.mdx)) | one file per system |

Guarantees the engine keeps (pinned by `apps/studio/test/migrate-v2-*.test.ts`):

- **Nothing is written in a dry run**, not even a lock.
- **All or nothing.** Every file to change is copied to `_history/_migrate/v2-<stamp>/` with a `report.json` before the first write. A failed snapshot refuses the run. Any failure after that restores from the snapshot.
- **Idempotent.** Running it again on an updated project exits `10` and writes nothing.
- **Exact reverse.** On an unedited tree, `--reverse` restores the original bytes.
- **Never deletes what it did not create.** Removals go to `_trash/migrate-v2/`.
- **Never touches** canvas `.tsx`, design-system CSS and previews, `assets/`, `_comments/`, `_trash/`, `_canvas-state/` or `.git`.
- **A linked project flips on the hub before the first local write and unflips after the last.** A crash between the two resumes on the next Maude 2 start.

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | done, or a clean dry run |
| `10` | already at the target format; nothing written |
| `11` | refused, nothing written (project format above 2, `config.json` missing or not JSON, a file that does not load, a team server that is too old or read-only for you) |
| `1` | error |
| `2` | usage |

## 3. What a person on Maude 1 sees

The compatibility gate ships in Maude 1.9.0 and later, so keep Maude 1 up to date until everyone on a project has moved.

| Peer | What happens in a project that moved to format 2 |
| --- | --- |
| Maude 1.x with the gate, any transport | The project opens for looking. A banner says *This project now uses Maude 2. It's open here to look at — nothing in it is lost.* with **Update Maude to edit**. Edits and annotation changes are refused with the same reason. Pan and zoom still work, because they are per person. |
| Maude 1.x with the gate, on a team hub | Read-only from the first paint, and live when an owner flips the project while it is open (about one second). Its last write before the notice still lands. |
| Maude 1.x without the gate, on a team hub | The hub refuses its writes with HTTP `426` (not `403`, so old clients do not renew credentials). Proposals are rejected as final. Content stays intact. |
| A cloud tab on a build that predates Maude 2 | *This project now uses Maude 2. It's open here to look at.* |
| A canvas that needs a Maude 2 feature | *This canvas uses Maude 2. Update Maude to see it.* |
| Maude 1.x without the gate, with git or Syncthing only | There is no server to refuse it, so it can still write. Canvas `.meta.json` fields from Maude 2 survive its writes. Annotation extension fields (for example a resolved sticky's extra keys) can be dropped when it moves an annotation. Update everyone on a git or Syncthing project together, or use `--reverse --strip` to take the project back to format 1. |

Maude 2 never writes to a project it opened view-only, and an old peer's edit never triggers a format flip. Only an owner flips a project.

## 4. Where it went

The full mapping is in `nothing-deleted.json`. These are the changes people notice first.

### The window

| In Maude 1 | In Maude 2 |
| --- | --- |
| Status bar: changes chip, sync dot, server dot | The Share cluster shows one word for the save state: *Saved*, *Syncing…*, *Offline — kept on this Mac*, *Local project*. Details are in **Menu › Diagnostics**. |
| In-window menubar with six menus, the Idle · Canvas · System stamp, path bar and artboard count | The **project pill** opens one **Menu**. Search (⌘K) shows where every action lives. The artboard count is on the Layers panel header; the open canvas's path is under Canvases › Advanced. |
| View → History, History tab, ⇧⌘G | **Version history**, top level of the Menu, ⌥⌘H. ⇧⌘G now removes a frame. |
| Banners | Callouts and toasts with at most one action. |
| Dock, rail, sidebar, canvas browser, file tree | The bottom **toolbar** (one per mode) and the left panel's tabs **Canvases · Layers · Assets**. ⌘\\ hides panels. |
| Command palette | **Search** (⌘K): canvases, actions, AI and every hidden tool. |
| Assistant (⇧⌘A) | The **AI chat panel**. **Ask AI** is ⌘/. ⇧⌘A selects all annotations. |
| Inspector Designer / Advanced switch | Gone. The Inspector speaks designer; its **Advanced** fold is the raw editor, unchanged. |
| Project switcher at the foot of the sidebar | **Home** and project tabs. |
| Export dialog ⌘E | One **Export sheet**, ⇧⌘E. ⌘E is unbound. |

### Home and tabs

Maude 2 opens on **Home**, a tab that belongs to no project. Home has the one question, *What shall we make?*, a way in without AI (*Start with an empty canvas ⌘N*), recent and pinned projects, and a first-run line. Each project opens in its own tab, to the right of Home; opening an open project focuses its tab. ⌘T opens Home, ⌘1–⌘8 pick a tab and ⌘9 the last. At most five projects run at once; a tab past that rests and wakes when focused (never one with AI running or unsent changes). Relaunch restores the same tabs.

### Modes

Three modes sit in the Share cluster: **Edit**, **Preview** and **Present**.

| Mode | What it is | Toolbar |
| --- | --- | --- |
| Edit | The design is editable | Select · Hand · Frame · Shape · Pen · Text · Image · Component · More |
| Preview (⌥⌘P) | The design is live (click to use it); annotations are drawn on top. This replaces the Browse tool. | Hand · Sticky · Comment · Marker · Arrow · Shape · Text · Stickers · Section |
| Present (⌥⌘↵) | Full-screen walk through the artboards for an audience | Pointer (L) |

Keys that moved: Pen B is **Marker M** (P is Edit's Pen), Rect R is **Shape R**, Ellipse O is Edit › More › Ellipse, Highlighter I and Eraser E are tips of the Marker, Section ⇧S is **S**, Actual size ⌘1 is ⇧0, Search canvases ⌘/ is `/`. Press `?` in Maude for the whole sheet; each key appears once.

### Accounts and profiles

A **profile** is a named sign-in slot (GitHub and cloud). The `default` profile is the one Maude 1 already used: the same `~/.config/maude/cloud.json` and `hubs.json`, the same keychain entry. Nothing moves on upgrade.

Each project tab is bound to one profile. Signing in to a different account from a project that shares its profile creates a new profile for that project and restarts its server; it never silently replaces the account other projects use. **Settings › General** lists every account on this Mac. **Menu › File › Sign in as another account…** starts the flow. The AI never sees profile credentials.

### Diagnostics, Settings, history

| In Maude 1 | In Maude 2 |
| --- | --- |
| Hub sync chip, Resync, Download all, conflict buttons, held and failed lists | **Menu › Diagnostics › Sync** (status word) and Sync details; Resync and Download all under Diagnostics › Advanced |
| `localhost:PORT` and the version line | Diagnostics › Advanced › Address; Settings › Advanced › This Mac › Version |
| Claude Code readiness list, claude binary path | **Menu › Diagnostics › AI setup** |
| Server log tail | Diagnostics › Logs (or `maude design logs`) |
| Save version, Publish, Get latest, branch switcher | Maude saves for you. The Canvases panel foot keeps the draft switcher; Version history › Advanced shows authors and short SHAs. |
| Light / dark toggle | Settings › General › Look › Theme (Light · Dark · Auto) |
| Cloud account, Sign in with GitHub, AI provider keys, Figma token, team hub address | Settings › Connections |
| Update banner, app version, engines, panel positions | Settings › Advanced, and Settings › General › Layout |

## 5. The design-system schema

Maude 2 checks a design system's structure so a canvas can switch systems without mapping tokens: 95 named roles in light and dark, optional numbered slots, and a system's own `--x-*` names. [The schema page](../site/content/docs/design-system-schema.mdx) lists them.

For existing projects: `maude design ds-check` reports a level (`Conformant`, `Missing roles`, `Private-only`) and never changes a system. A system below Conformant keeps working, because a fallback layer supplies the roles it does not declare. **Bring it up to the schema** (`maude design ds-upgrade`, or the offer in the app) rewrites the system under a visual proof and applies as one undo step. It never runs on its own, and it does not touch other projects' systems.

## 6. Claude Code, the CLI and the plugins

- **Files are the API.** Claude edits a project's readable files (canvas `.tsx`, `.meta.json`, `*.annotations.json`, `*.edl.json`) and uses `maude` verbs for what is not a file edit: rendering and export, generation, sync, Version history and Trash, opening things in the window, checks. There is no MCP layer. Every edit under `.design/` is checked (`maude design check`) and restored when the check fails.
- **The permission tier of each verb** is registry-driven: `maude design help` prints it. `auto` verbs run without a prompt in the Maude chat, `prompt` verbs show a permission card, `human` verbs are terminal-only and are never taught to the AI.
- **Where a capability lives** is the `studio-actions` skill (generated from the action registry). **How the AI talks** is the `contract-voice` skill (generated from the product contract). Both are regenerated by `node scripts/gen-actions.mjs` and `node scripts/gen-plugin-surfaces.mjs`; `--check` fails when they drift.
- **Command names.** `/design:*` and `/flow:*` keep working. Design copy uses the Maude 2 words (canvas, artboard, panel, Search, Version history); a ratchet test keeps the old ones out.
- **The ACP chat panel** loads the app's bundled copy of the plugins. A marketplace install adds nothing there and does no harm.
- **Keys.** A shortcut is a registry entry, not a handler; the "?" sheet, ⌘K, the native menu and the canvas iframe all read the same table.

## 7. If something looks wrong

| Symptom | What to do |
| --- | --- |
| A project is view-only in Maude 2 | Choose **Update project** (owners), or ask the owner. `maude migrate v2` shows the reason as a refusal when it cannot proceed. |
| A teammate cannot edit after you updated | They need Maude 2, or Maude 1.9.0 or later to see the banner. Until then they can look. |
| You want Maude 1's format back | `maude migrate v2 --reverse`. Add `--strip` only when a peer cannot keep Maude 2 fields. The pre-update copy is in `_history/_migrate/`. |
| A control from Maude 1 is missing | Search for it with ⌘K, then check `nothing-deleted.json`. A feature without a home is a bug: report it from **Menu › Help › Report a bug…**. |
| The dry run exits `11` | Read the refusal in the output (or the JSON report). Nothing was written. |
