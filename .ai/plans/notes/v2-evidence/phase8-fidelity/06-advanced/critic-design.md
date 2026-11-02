# design-critic — 06 Advanced · V2-8.5 stage B

_2026-10-22 · board `.design/ui/v2/06 Advanced.tsx` (+ `06 Advanced.css`, `_kit.css`) · DS `.design/system/maude-v2/` (`preview/_components.css` `.switch` / `.seg` / `.chip`, `colors_and_type.css`) · pairs from `06-advanced/INDEX.md`, every full-size pair read (dark for all ids, light where a token could flip: ad-left, ad-settings). Read-only: nothing edited, no server booted._

Lens: layout, spacing, sizes, typography, colour/tokens, material, iconography, and every state the board draws (folds, Diagnostics, Settings, pinned panels, edge cases). Spec "dark" is the host re-theme of the board (INDEX), so dark impl is judged against the DS dark ladder. Not findings: C1 (closed + open drawn side by side), C2 (local project, so no cloud rows), C3 (no title bar / tab strip in the browser lane), C4 (note strips, doc boards), and anything INDEX marks "(fixture)" or "(H)" (fake agent offers no config).

**C0, once:** the shell runs on the v1 `.maude` token ladder and v1 buttons. That gives the indigo accent, `btn--spark` drawn outlined ("Ask AI to fix it"), the bordered `.btn` ("Restart now", "Open in editor") and the radii and surfaces. It's already being fixed, so it is **not repeated below**. The rows below are what is left after C0.

## R — root causes (several artboards; rows cite R2–R9)

| # | root cause | spec | impl | owner |
|---|---|---|---|---|
| R2 | **The fold row has the wrong anatomy, and its hint stays visible when open.** The kit already ships the correct `.k-adv*` (`styles/3-kit-maude-v2.css:217-262`), but no fold uses it. | `.k-adv-btn` 30px · type-sm · **w-semibold · fg-1**, the hint shows only `!open` (`06 Advanced.tsx:316`) | `.v2-fold-btn` / `.lp-adv-btn` 28px · **type-xs · regular · fg-2**; the hint renders open or closed | `v2/fold/fold.css:12-26`, `v2/fold/advanced-fold.jsx:67`, `v2/left-panel/left-panel.css:376-390` |
| R3 | **The rows inside a fold aren't `.ad-row`.** Each panel restyles its rows its own way, so key/value alignment and contrast differ from panel to panel. | key fg-1 type-sm flex:1 · value fg-0 **right-aligned** (mono xs) · Copy = 24px `duplicate` icon-btn | Canvases xs, value fg-2 · Diagnostics a 140px grid, key fg-2, value left · error card 48px key xs fg-2, value left · Share stacks the label above an input · Copy = a "Copy" text button | `left-panel.css:414-436`, `diagnostics.css:150-160`, `code/code.css:280-300`, `share/share.css:301-323` |
| R4 | **"kept open" pill doesn't exist.** The board draws it on every remembered fold. | `.ad-kept`: accent-muted pill, `pin` 11px, xs medium | absent (grep: no producer) | `fold/advanced-fold.jsx` (needs the `remembered` state from `use-fold.js`) |
| R5 | **Three switch implementations, and none of them is the DS `.switch`.** | 34×20 pill · knob 16px **bg-2 + shadow-sm** · off track `--control-off` | `.lp-switch` 30×18, knob 14 **fg-0**, so the knob is *black in light* · `.st-switch` 34×20, off knob 14 fg-2 | `left-panel.css:457-483`, `styles/3-shell-maude.css:1570-1602` |
| R6 | Native `<select>` with OS chevrons where the board draws `select k-in-select` (140×28, bg-3, 12px chevron). Same as 09-R9. | k-in-select | `ai-adv-select` (no `appearance:none`, auto width, 26px, xs), the Inspector's Font/Language/On click, Export › Advanced | `ai/ai-list-advanced.css:463-473`, `export/advanced/fields.jsx`, `inspector-controls.jsx:506` |
| R7 | **Status is drawn as a coloured word with no dot.** | `StatusWord` = `.k-sw`: 7px status dot + word in fg-1 xs | `.st-pm-status[data-tone]` / `.dg-word[data-tone]`: the word itself in success/warn colour | `diagnostics/diagnostics.css:9-30,132-143` |
| R8 | **Palette rows show a fallback chevron in a v1 tile.** Fold actions have no `icon`, so they fall back to `chevron-right` inside a 26px bg-4 tile that turns accent-filled when active. | per-action 14px icon (duplicate / file / download / transcript / logs), no tile · palette 560 wide · `.chip` (radius-sm, fg-1, medium) for the path | chevron tile on every Advanced row · 640 wide · `.st-pal-where` radius-xs, fg-2, regular | `dialogs/command-palette.jsx:29,37`, `styles/3-shell-maude.css:1339-1352`, `v2/search/search.css:6-8,90-100`, action-registry `icon` (shared, patch request) |
| R9 | **The containers don't match the board.** The board floats an island or a menu; the app docks, tabs or scrims. | History 340/400 island · Diagnostics = Menu › Diagnostics submenu + three boxes at once · Settings 1300×700, three columns, no scrim | History is a full-height dock column · Diagnostics is a 760px tabbed sheet · Settings is 860×640, one column, a bg-0 62% scrim | `shell/dock.jsx:21`, `diagnostics.css:37-44`, `settings/settings.css:8-27` |

## Per artboard

**ad-left** (L, D) · reached
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | fold row anatomy | k-adv-btn | v2/lp fold | R2 | blocker |
| L+D | "kept open" pill on the open fold | ad-kept | absent | R4 | blocker |
| L+D | fold rows: label/value size and contrast | type-sm · value fg-0 | type-xs · value fg-2 | R3 · `left-panel.css:414-436` | blocker |
| L | switch knob | bg-2 knob + shadow-sm | **black** knob (`--fg-0` in light) | R5 · `left-panel.css:475` | blocker |
| D | switch size | 34×20 / knob 16 | 30×18 / knob 14 | R5 | warning |
| L+D | Folder copy | 24px duplicate icon | "Copy" text button | R3 · `canvases-advanced.jsx:172-175` | warning |
| L+D | rows the board doesn't draw | Show file names · Show hidden files · Folder · Design system | adds "Open canvas" path + a "12 of 12 shown · updated just now · Refresh" foot | `canvases-advanced.jsx:199-245` | warning |
| L+D (Layers extra) | Select-by-selector field | bg-3 well, ~30px, radius-sm | `.lp-selector` 26px radius-xs | `left-panel.css:1025-1033` | warning |
| — | file-name subtitles, hidden rows, row menu, Trash card | drawn | not driven (toggles off) | — | not verified |
| — | "Design system system/alligators Open" | drawn | absent *(fixture: no DS)* | — | not a finding |

**ad-inspector** (L, D) · partially reached
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | fold row + hint stays visible when open ("Code, tokens, CSS") | k-adv | v2-fold | R2 | blocker |
| L+D | Advanced sits right under 5 plain rows; open, it shows Element / Used in / Tokens bound / CSS + Copy style · Paste style · Copy CSS · **Copy code** (primary) | drawn | the fold is at the foot of about 25 rows, so the body is below the 840px crop and none of it can be seen | `inspector/advanced.jsx:184-197` (placement in the inspector stack) | blocker |
| L+D | Font / Language / On click selects | k-in-select | native select | R6 | blocker |
| — | artboard variant (Exact size, Resolution, Colour, Guides, Look and layout, In code) | drawn | not driven | — | not verified |

**ad-ai** (L, D) · partially reached
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | fold row | k-adv | v2-fold | R2 | blocker |
| L+D | Show in chat / Suggestions selects | k-in-select 140×28, sm | native, auto width, 26px, xs | R6 · `ai/Advanced.jsx:58,280,324,342` | blocker |
| L+D | value "None" | fg-0 type-sm (ad-row-v) | `.ai-adv-val` xs fg-2 | R3 · `ai-list-advanced.css:491` | warning |
| L+D | composer shape (03-owned) | one 40px row: chip + "Ask AI…" + send | chip above a multi-line box, attach + send on their own row | 03 AI Chat | warning |
| — | Model, Effort seg, Fast mode, Images/video/voice, meters, Session, Raw log… | drawn | *(H: fake agent, no config)* | — | not a finding |

**ad-share** (L, D) · local variant (C2)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | fold row + the hint visible when open | k-adv | v2-fold | R2 | blocker |
| L+D | App link / This Mac only | one-line ARow, mono value right, icon copy | xs fg-2 label stacked over a full-width input + "Copy" button | R3 · `share/share-advanced.jsx:42-75`, `share.css:301-323` | blocker |
| L+D | sheet width | 400 | 440 | `share.css:17` | warning |
| — | people rows, "This link" rules, "Where it syncs" | drawn | *(C2: local project)* | — | not a finding |

**ad-export** (L, D) · reached. The sheet itself belongs to 09; see 09 critic R2–R9.
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Advanced body layout | one column: ASub Size / Colour / Files / From the terminal | two-column auto-fit grid (`minmax(260px,1fr)`) | `export/advanced/advanced.css:125` | blocker |
| L+D | Images inside / Text / Background | k-in-select | native | R6 | blocker |
| L+D | "From the terminal" Cmd blocks | visible in the fold | exist (`command.jsx`) but are scrolled out of the fold body | `advanced.css` max-height | warning |
| L+D | Exact scale field | one `2.5×` input, ad-input--sm | "1" input + a separate "×" | `advanced/image.jsx` | warning |
| L+D | sheet width | 420 here · 660 in 09 | 680 | boards disagree; follow 09 | warning |

**ad-history** (L, D) · local, not git (C2)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | container | floating island, 340 closed / 400 open | full-height dock column | R9 · `shell/dock.jsx:21` | blocker |
| L+D | "Compare pictures" | one-line ghost button | wraps onto two lines | `history/history.css:456-460` (`.vh-adv-row`, no nowrap/flex:none) | blocker |
| L+D | fold row + the hint visible when open | k-adv | v2-fold | R2 · `history-panel.jsx:556` | blocker |
| L+D | "kept open" pill | drawn | absent | R4 | blocker |
| L+D | All / Named / Made by AI / People seg | not on this board | drawn above the list | `history.css:27-40` | warning |
| L+D | Compare + Restore this version under the list | drawn | absent while "Now" is selected | `history-panel.jsx` | warning |
| — | Branch, Drafts, Remote, diff, git actions | drawn | *(C2)* | — | not a finding |

**ad-diag** (L, D) · the lane opened the sheet, not the board's menu
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Sync / Server / AI setup status | `.k-sw` dot + fg-1 word | coloured word, no dot (in both the menu rows and the sheet header) | R7 | blocker |
| L+D | key/value rows (Address, Process, Project folder) | ARow: key fg-1 flex, value right | 140px grid, key fg-2, value left | R3 · `diagnostics.css:150-160` | blocker |
| L+D | Copy | icon | "Copy" text, bordered | `diagnostics.css:176-190` | warning |
| — | the Menu › Diagnostics submenu with its Advanced group | drawn | `.st-pm-status` exists; menu not driven | R9 | not verified |

**ad-logs** (L, D) · reached, tabbed
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | layout | Logs (660) + a Server / AI setup column + "reloaded" toast, all at once | one tab at a time; the selected tab is an accent-muted filled pill | R9 · `diagnostics.css:93-96` | blocker |
| L+D | source filter | `InSeg`: bg-3 track, pressed bg-2 + shadow-sm + 1px accent ring | `.dg-seg-b` pressed bg-1, no shadow or ring, so it reads as plain text | `diagnostics.css:249-253` | blocker |
| L+D | log well | bg-3, radius-md · source column fg-0 semibold 7ch · warn row = bg-4 + inset 2px status-warn | bg-2 · source fg-2 regular (ai in accent) · warn/error colour only the message text | `diagnostics.css:269-300` | blocker |
| L+D | Filter field | `k-find` with search icon, compact | full-width bg-0 input, no icon | `diagnostics.css:257-268` | warning |
| L+D | Copy all / Show in Finder | ghost + duplicate / folder icons | bordered `dg-btn`, no icons | `diagnostics.css:176-190` | warning |
| L+D | extra "Refresh" | — | present | `diagnostics-sheet.jsx` | warning |

**ad-syncd** (L, D): the local project says only "nothing to sync" *(C2)*, so nothing to compare. Product work: a cloud-linked fixture in trouble (local cell + hub). `diagnostics/sync-details/sync-details.jsx` exists. Tab chrome is counted under ad-logs. **Not verified.**

**ad-settings** (L, D) · reached
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | layout | 1300×700, three columns (This Mac · Engines · This project) | 860×640, one column. Engines starts below the fold; This project / Experimental / Reset are off-screen | R9 · `settings.css:17-27` | blocker |
| L+D | sheet material | bg-2 · radius-xl · shadow-lg + inset 0.5px island-edge | bg-1 · 1px border · radius-lg | `settings.css:24-27` | blocker |
| L+D | rail | 176 · title type-md semibold · icons (settings / link / more) · selected = accent-muted + accent-text | 188 · title sm · no icons · selected bg-3 / fg-0 · extra "Done" button | `settings.css:60-77`, `settings-sheet.jsx` | blocker |
| L+D | switches | DS `.switch` | `.st-switch` (off knob 14 fg-2) | R5 | blocker |
| L+D | row text | one line + one shared hint per group | a second explanatory line under most labels | `advanced-section.jsx` | warning |
| L+D | command rows | ghost "Copy install command" with duplicate icon | mono chip + "Copy" text | `advanced-section.jsx` | warning |
| L+D | scrim | none | `color-mix(bg-0 62%)` veil | `settings.css:8-16` | warning |
| L+D | Server build value | `maude-dev-srv` | hardcoded literal `MAUDE-DEV-SRV` | `advanced-section.jsx:193-195` | warning |

**ad-pinned** (L, D) · only the AI pin was driven
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Canvases while a panel is pinned | pinned left, full height, tree + Advanced | **collapses to its header, list empty** (layout bug) | `v2/shell/panel-layout.js`, `shell/dock.jsx:109` (pinned `display: contents`) | blocker |
| L+D | fold row / "kept open" | k-adv + ad-kept | v2-fold, no pill | R2 · R4 | blocker |
| L+D | pinned column chrome | flush column, 0.5px divider, project pill inside the left column | AI column flush right, but the top-bar cluster still floats over it | `ai/BigChat.jsx:30-46` | warning |
| L+D | resize chip "Drag · double-click resets" | drawn | tooltip only (`EDGE_TIP`) | `BigChat.jsx:25` | warning |

**ad-search** (L, D) · the palette half
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | row icons | per-action 14px | chevron in a 26px tile, accent-filled when active | R8 | blocker |
| L+D | width | 560 | 640 | `search.css:6-8` | warning |
| L+D | path chip | `.chip` radius-sm, fg-1, medium | radius-xs, fg-2, regular | `search.css:90-100` | warning |
| — | "?" Keyboard shortcuts sheet with its Advanced fold | drawn | `dialogs/shortcuts-overlay.jsx` exists, not driven | — | not verified |

**ad-open-all** (L, D) · reached
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | confirmation | `.k-toast` pill centred at the bottom, 40px, check icon, inline "Close all" link | notification card at the bottom right, title + action on a second line, close ×, no icon | `shell/util.js:155` (`notify`), `v2/shell/menu-runner.js:339` | blocker |

**ad-code** (L, D) · palette rows only
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | palette rows | per-action icon | chevron tile | R8 | blocker |
| — | the read-only code panel (path, Copy, Open in editor, highlighted lines, terminal + Claude Code commands) | drawn | `v2/code/code-view.jsx` exists, not opened | — | not verified |

**ad-edge-syntax** (L, D) · reached, very close
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | fold row ("Advanced" semibold vs "Show details" xs fg-2) | k-adv | v2-fold, `label="Show details"` | R2 · `code/canvas-error-card.jsx:215-217` | blocker |
| L+D | Error / Where rows | ARow: key fg-1 sm, value right | key 48px xs fg-2, value left | R3 · `code/code.css:280-300` | blocker |
| L+D | last good boards behind the card | `.ad-ghost` dashed outlines at 0.6 | plain canvas | `canvas-error-card.jsx` host (no last-good render) | blocker |
| L+D | Where copy | icon | "Copy" ghost text | `canvas-error-card.jsx:237-240` | warning |
| L+D | Copy error | ghost CopyBtn | bordered | `canvas-error-card.jsx:251+` | warning |
| L+D | extra "Reload canvas" | — | present | same | warning |

**ad-edge-remember** (L, D) · not reachable as one state. The remembered fold works (`fold-store.js`), but the board's visible mark of it, the "kept open" pill, does not exist → **blocker ×2** (R4).

### Not reachable — what product work makes them reachable

| id | why | what makes it reachable | sev |
|---|---|---|---|
| ad-map · ad-why · ad-trace | documentation (C4) | — | not a finding |
| ad-ds | no Design system board in the lane: the DS seeds don't produce a real board (wave-B gate) | the DS seed must write a real Design system canvas so `v2/ds/advanced.jsx` can render | blocker ×2 |
| ad-edge-sync | needs a cloud project in trouble | hub-linked fixture (local cell, Node 24) + a forced conflict/auth expiry | blocker ×2 |
| ad-edge-hub | needs a self-hosted-hub-linked project | Connections › team server against a local hub | blocker ×2 |
| ad-edge-where | browser viewer · comment-only role · offline | a viewer-origin lane + role fixture + offline toggle | blocker ×2 |
| ad-timeline | the fixture has no video canvas (product exists: `v2/timeline/advanced/foot.jsx`) | lane gap: add a video canvas | warning ×2 |
| ad-menus | native menu bar | desktop e2e lane (`apps/desktop/e2e`) | warning ×2 |

## Totals

Blockers 77 · warnings 57 (per artboard × theme). No artboard × theme came out with no difference in this lens. The closest is ad-edge-syntax, where only the fold, row alignment and last-good ghost differ.

```json
{"canvas":"06 Advanced","critic":"design-critic","blockers":77,"warnings":57,"verified_ids":[]}
```
