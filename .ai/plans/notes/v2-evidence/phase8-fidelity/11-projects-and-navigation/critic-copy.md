# copy-critic — 11 Projects and Navigation (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/11 Projects and Navigation.tsx` · voice: CONTRACT §3 words + §4 voice · impl frames: `.claude/worktrees/agent-a0a73ec7448623bcc/.scr/impl/11-projects-and-navigation/` (dark read frame by frame incl. the extra `pn-home-top`, `pn-home-search-typed`, `pn-k-close-2`, `strip-*` frames; light sampled on pn-trash — copy identical, so every row holds for both themes)_

Fixture content (75 harness canvases, "Wide" / "Artboard 1…21", seed project names, gradient covers, `ui/` designRoot folder) is not a finding. **board-side** = the board disagrees with another board or CONTRACT, impl follows the other source.

## pn-tab-b · dark + light (strip.html, stubbed)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Tab tooltip carries no state | `Matchday 2026 · AI is drawing the score card` | title = name only (state only as aria on the mark) | `apps/desktop/src/strip.js:203` | warning |
| Home tab name | CONTRACT §1: Home tab = "Back to Home" | `title="Home"` | `apps/desktop/src/strip.html:466` | warning |
| Marks' names | `AI is working` / `AI needs you` | same aria words | `strip.js:103-104` | — ok |

## pn-tab-b20 · dark + light (strip.html, stubbed)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Overflow rows say where in generic words | `Studio team · cloud` · `Alligators · cloud` · `~/Maude/Trenérský manuál · this Mac` | `On this Mac` / `In the cloud` on every row | `apps/desktop/src/strip.js:426-431` | blocker |
| List head | (only the rest, with `Find a tab`) | `All tabs` heading + `Find a tab` | `strip.html:494-501` | warning |
| Active tab name truncated | active tab is wide, full name | `Alligator…` on the active tab (strip-relaunch frame) | strip CSS (`.tab` width rules) | warning |
| State chips | `AI working` · `Needs you` · `Resting` | same + `Done` | `strip.js:122-125` | — ok |
| Resting tooltip | `Trenérský manuál · resting — opens in a second` | `<name> — resting, opens in a second` (dash vs ·) | `strip.js:203` | warning |

## pn-home · dark + light (Home server)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Scrolled Home loses its way in | `Ask AI for a new canvas…` + `in Studio site` + `Start with an empty canvas ⌘N` stay on top | scrolled away (no sticky ask row) | `client/home/home-app.jsx` (+ `HomeAsk.jsx:182-183`) | blocker |
| Projects header controls | `Find a project` · `Recent ▾` | absent | `home-app.jsx` Projects section | blocker |
| Recent header action | `All projects ▾` + `See all` | `All projects` only; `See all` has no string | `home-app.jsx` | warning |
| Pinned aside | `pin any canvas from its row or its menu` | `pin any canvas from its card` | `client/home/home-app.jsx:829` | warning (section unreached — nothing pinned in seed) |
| Project list foot | `15 more` · `Open project… ⌘O` | `New project… ⇧⌘N` · `Open project… ⌘O`; no "N more" string | `home-app.jsx` | warning |
| Stray banner | — | `What's new — A new look: the canvas fills the window · See what's new` | What's new banner (CONTRACT §1: "What's new keeps a quiet dot") | warning |
| Shared with you | `canvases from other people's projects · 3 new this week` + role chips | section absent (signed out) — string matches (`home-model.js:392`) | — | not-a-finding (state) |
| Row metas | `93 canvases · in a tab`, `this Mac only`, `not on this Mac yet` + `Open` | same words (`home-app.jsx:1112-1116`) | — | — ok |

## pn-home-search · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Empty Search is a shortcut list | `Recent searches` (with `5 results`), `Open tabs`, `Recent canvases` | one line `Search every project on this Mac, open or not.` | `client/home/home-app.jsx:1384-1404` (no "Open tabs" group string anywhere) | blocker |
| Same phrase twice | foot `every project, open or not` | hint line and foot both say it | `home-app.jsx:1404` + foot | warning |
| Field placeholder | `Search canvases, artboards, actions, or ask AI…` | `Search canvases and artboards…` | `client/home/home-app.jsx:1364` | blocker |
| Typed result meta (extra frame) | `Portfolio 2026 · not open` · `opens a tab` | `Mobilni-app ui` (file name + folder, no separator, no state) | Home palette rows (`home-app.jsx` ~1410-1440) | warning |

## pn-ds · dark + light (this repo's two systems)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| System row meta | `Alligators brand system · used by 3 projects` | `Default · 37 canvases` / `16 canvases · v2`; no "used by N projects" | DS rows in `client/v2/canvases/` (system row) | warning |
| Group head | single `Design system` row | `Design systems · 2 in use` | same | not-a-finding (CONTRACT §7 [A12]: several systems → each named, pinned together) |
| Panel search field | `Search` · `⌘K` | `Search canvases…` · `/` | `client/tree/tree.jsx:1401` | warning **board-side?** (CONTRACT §2 moved panel search to `/`; board 11 still draws ⌘K) |
| Inspector `Uses …` link | `Uses Alligators brand system` | not shot | — | warning (unreached) |

## pn-ds-search · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| DS row meta | `Design system · used by 3 projects` | `Design system · not on a canvas yet` | search provider for systems | not-a-finding (this repo's systems aren't canvases yet) |
| Section rows | `Colour · section of the Design system` | absent (needs a DS canvas) | `search-model.js:31-34` has the group | warning (unreached) |
| Grouping | one project group (`Alligators brand` + square) | `Design system / Canvases / Artboards` kind groups | `client/v2/search/search-model.js:30-44` | warning **board-side** (pn-k-across note: group by project only from 2+ projects) |
| Field key hint | `esc` | `⌘K` | `client/dialogs/command-palette.jsx:444` | warning (all ⌘K frames) |

## pn-organise · dark + light

Sort menu `Sort by · Recently opened · Name · Kind web · social · print · video · Folders on top`, `Pinned 2`, footer `87 canvases · ⌘K searches every project` — **match**. Only the panel search field (`Search canvases… /` vs `Search ⌘K`) differs — see pn-ds. → warning only.

## pn-move · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Rename hint | `↵ rename · esc keep "Test2"` | `↵ rename · esc keep "Wide"` | — | — ok |
| Drop target | `Move here` | not driven; string exists (`v2/canvases/canvases-panel.jsx:91`) | — | warning (unreached) |
| Tip | `Double-click a name` | not shown (board inset label, not UI copy) | — | not-a-finding |

## pn-trash · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Group heads in capitals | `Today` / `Earlier` | `TODAY` | `client/v2/left-panel/left-panel.css:269` (`text-transform: uppercase`) | blocker (CONTRACT: caps only for status badges) |
| Header count, row sub, foot, toast | `3 canvases · 1 artboard` · `root · You, just now` · `Kept until you clear it out.` · `Clear out…` · `"ahoj" moved to the trash.` + `Undo` | same patterns (`trash-model.js:91-125`, toast) | — | — ok |
| Clear out dialog (code) | `Clear out the trash?` · `… go for good — for everyone on Alligators brand. Restore can't bring them back after this.` · `Clear out` | same template (`client/v2/left-panel/trash-model.js:164-166`) | — | — ok |
| Second Clear-out dialog with other words | — | `Everything that has been in the trash for N days or more goes for good. Newer things stay…` | `client/v2/canvases/kept-on-this-mac.jsx:105-110` (the per-Mac list) | warning (two dialogs, one title, two meanings) |
| Empty canvas after trashing the open one | (fixture) | `No canvas open` / `Open a canvas from the Canvases panel, or start a new one.` + button `Start quick setup` — the button doesn't do what the line says | empty-canvas view | warning |
| Owner-only tooltip | `Only an owner clears out the trash — editors see Restore only.` | board inset caption; impl's refusal line is `Only an owner clears out the trash. Nothing was changed.` (`trash-model.js:262`) | — | not-a-finding |

## pn-jump · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Foot | `21 artboards · 19 digital, 2 print` | `21 artboards · 21 web` (same form, fixture kinds) | — | — ok |
| Count on the canvas row | `21` | none | canvas row meta | warning |

## pn-k-across · dark + light (stubbed index_search)

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Hidden-tools group | `Tools and settings` · `not on screen, found by search` | `Actions` · `1 hidden tool` | `client/v2/search/search-model.js:39-43,381` | warning **board conflict**: 01/11 say "Tools and settings", 06 ad-search says "Actions · N hidden tools" — pick one on the boards |
| Hidden-tool row | `New artboard — Mobile` + chip `Menu › Edit › Advanced` | `New artboard: Mobile` + `Menu › Edit › Advanced › New artboard` | action label + `search.where` | warning |
| Closed project row | `12 artboards · on this Mac` | `12 artboards` | `client/v2/search/search-projects.js` | warning |
| Group asides | `in another tab` · `not open — opens a tab` | match (`search-projects.js:24`) | — | — ok |
| `This tab` group | `this tab` | absent (no match in this project) | — | not-a-finding |
| Ask AI row + foot | `Ask AI — find "mobil" by what it looks like` ⌘↵ · `7 results` | match (`4 results`) | — | — ok |

## pn-k-close · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Notice quotes the whole query and capitalises | `Nothing called "unifromy". Showing close matches for **uniformy**.` | `Nothing called "unifromy 2027". Showing close matches for **Uniformy**.` | `client/dialogs/command-palette.jsx:322` (+ `search-model.js:463`, whose own comment has the board's form) | blocker |
| One list vs two | `Canvases and artboards` | `Canvases` + `Artboards` | `search-model.js:35-36` | warning |
| Canvas row meta | `Alligators brand · 2026/dresy · 12 artboards` | `Alligators brand · 6 artboards` (folder dropped) | canvas result meta | warning |
| Foot | `4 close matches` | `7 close matches` | — | — ok |

## pn-history · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Version titles are machine change-lines | `Číslo 27 větší`, `Logo na helmě` (short, human) | `Artboard "Kalhoty doma" renamed to "Kalhoty doma v2"` (nested quotes, truncated), Viewing bar adds `+ 1 more` | `apps/studio/history/describe.ts:669`, `history/titles.ts:247` | blocker |
| Row sub-line | `14:05 · You` | `16:56 · You · changed outside the app` (truncated) | `apps/studio/history/titles.ts:247` | warning |
| Unknown author | — | `Version history starts here` · `SO` · `Someone` | `history/versions.ts:363`, `client/v2/history/rows.ts:306,328` | warning |
| Advanced fold hint | `branch, version ids` | `Branch, git, changed files` (truncated) | `client/v2/history/git-model.js:25` | blocker |
| Viewing bar | `Viewing "Schváleno trenéry" · 5 Oct, 18:40 · Jonas · esc back to now` | same frame and date form (`22 Oct, 16:56`) | `app.jsx:3029` | — ok |
| Filters, Now row, actions | `All · Named · Made by AI · People`, `Now · Uniformy-2027 · Saved`, `Name this version…`, `Compare` / `Restore this version` | match | — | — ok |

## pn-compare · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Per-change who | `Made by AI, 14:32` · `You, 14:05` · `Tereza, 11:20` | `changed in between` on every line | `client/v2/history/blame.js:31,109` (no blame row matched) | warning |
| A label | `A · Schváleno trenéry · 5 Oct, 18:40` | `A · Artboard "Kalhoty doma" renamed to … · 22 Oct, …` (clipped) | same title source as pn-history | blocker (same root) |
| Summary, Restore line, buttons | `N changes between A and B — …`, `Restores the whole canvas as it was at A, as a new version… Now stays in the list.`, `Stop comparing` · `Restore only <artboard>` · `Restore this version` | match (`blame.js:25,136`) | — | — ok |
| Fold hint | `branch main · a41f9c2` | `Branch, git, changed files` | `git-model.js:25` | blocker (same as pn-history) |
| Unexplained faces | — | `A`, `A7` faces in the cluster | presence faces in a compare session | warning |

## pn-switch-ai · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| `Tabs and windows` / `Finding a canvas` groups | `Next tab ⌃Tab` … `Show all tabs ⇧⌘\`; `Search every project ⌘K` … | not in the browser lane (native actions, `apps/studio/actions/defs/native.ts:61-210`, group `actions/help.ts:20`) | — | not-a-finding (desktop-only rows) |
| Sheet foot | `⌘W closes the project's tab, as on every Mac. Close canvas (Menu › File) has no key. A closed tab comes back from Home or ⌘K — ⇧⌘T stays Timeline.` | `close with esc` · `92 keys` | `client/dialogs/shortcuts-overlay.jsx` | warning |
| Extra row | — | `Find a canvas ⌘F` (a second "find" word beside `Search canvases /`) | `actions/shell-key-handlers.js:247`, `left-panel-model.js:172` | warning |
| Mac notification `Alligators brand — AI is done` | — | native, not in lane | — | warning (unreached) |

## pn-relaunch · dark + light

Toast `20 tabs reopened. Each one starts when you open it.` — **exact match** (`client/shell-events.js:53`). No copy difference (placement/× are not this lens).

## pn-deeplink · dark + light

| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Arrival toast missing | `Opened from Tereza's link — Pozvánka · story.` | no toast in the frame (string exists: `client/v2/canvases/open-link.js:54`, `shell-events.js:40`) | the `take_pending_navigate` path doesn't call the toast | blocker |
| Comment opens | Tereza's comment popover | not reached (no comment) | — | warning |

## Unreachable artboards (product work they need)

- **pn-tab-a / pn-tab-a20 / pn-windows**: variant A not picked (decision v2-3.7-own-tab-bar) — not findings, superseded boards.
- **pn-ab**: decision board, no UI.
- **pn-tab-menu**: native NSMenu (`tab_menu_rows`, tabs.rs) — words `Rename…` · `Move to a new window` · `Sign in as another account…` · `Close tab` not checkable here; note CONTRACT §1 says no drag-out/merge in v2.0, so "Move to a new window" must not ship.
- **pn-accounts**: the account card by the faces is not built (`Work · you@work-studio.cz` form) — product work: the account chip/card.
- **pn-cant-open**: needs a moved project root + revoked access in the Rust shell + hub.

## Root causes that hit several artboards

1. **Search field key hint ⌘K where the board draws esc** (`command-palette.jsx:444`): pn-ds-search, pn-k-across, pn-k-close.
2. **Version titles are change descriptions** (`history/describe.ts:669`, `titles.ts:247`) and the fold hint is `Branch, git, changed files` (`git-model.js:25`): pn-history, pn-compare.
3. **Home is missing drawn words**: sticky ask row, `Find a project`, `See all`, `N more`, the empty-Search shortcut list, placeholder (`home-app.jsx`).
4. **Metas drop the folder / place**: tab overflow rows (`strip.js:426-431`), ⌘K canvas meta (folder), closed-project meta (`on this Mac`).
5. **Uppercase group heads** (`left-panel.css:269`): pn-trash; check other `.lp-*-grp` users.
6. **Board conflicts to settle on the boards**: hidden-tools group name (01/11 vs 06), panel search key (board 11 ⌘K vs CONTRACT `/`).

```json
{"canvas":"11 Projects and Navigation","critic":"copy-critic","blockers":12,"warnings":38,"verified_ids":["pn-relaunch-dark","pn-relaunch-light"]}
```
