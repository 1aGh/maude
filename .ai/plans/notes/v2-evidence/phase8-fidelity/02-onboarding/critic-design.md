# design-critic — 02 Onboarding · V2-8.5 stage B

_2026-10-22 · board `.design/ui/v2/02 Onboarding.tsx` (+ `02 Onboarding.css`, `_kit.css`, DS `preview/_components.css`) · pairs from `02-onboarding/INDEX.md`. I read all 40 full-size frames, light and dark, and cropped them at 1:1 where a detail mattered. Read-only review: nothing was edited and no server was booted._

**Scale note.** The IMPL frames are 1600 × 1000 windows scaled to 900 px tall, so the impl renders at **0.9×** next to a 1.0× spec. Every px below has been corrected for that. One correction to the INDEX follows from it: the "local-name sheet 235 vs 258 px" difference does not exist. The impl sheet is 419 px and the spec sheet is 420 px. The flyout (392 / 392) and the accounts sheet (459 / 460) also match.

**Dark.** The spec dark is the host re-theme of a light-pinned board (INDEX). Home runs on `.maude-v2.home-root` (`home-app.jsx:727`), so **Home's dark matches the DS dark ladder** in every Home pair. The project-window pairs (ai-connect, first-draw, local-first, local-share, invite-landed, ai-missing, settings) have dark-only differences, and all of them come from R1.

Fixture-only differences are not findings: no typed prompt, names, covers and faces, project-square tones (hashed from the id), the e2e Smoke canvas instead of Portfolio boards, and recents missing from the lane. Copy differences (starter wording, "Use a code" / "Enter a code", placeholder text) belong to the copy critic and are only mentioned where they change layout.

## R — root causes (rows below cite R1–R12)

| # | root cause | spec | impl | owner | sev |
|---|---|---|---|---|---|
| R1 | **Cross-cutting, already in progress — the shell still runs on v1 `.maude` tokens.** Named once here and not re-listed. Effects: indigo accent on Share, Move to cloud, artboard selection, the active tool, Settings switches and the comment composer. The dark canvas is near-black navy. The toolbar buttons are about 28 px. v1 buttons, selects and toasts are part of the same work. | azure oklch(0.53 0.175 238) · v2 dark ladder · 40 px tool buttons | indigo oklch(0.52 0.195 268) · v1 dark · about 28 px | `app.jsx:2986` (`'maude'`), `styles/1-tokens-maude.css:41,154`, `styles/1-tokens-maude-v2-shell.css:3-7` | blocker |
| R2 | **Home has no `.btn--lg`.** home.css lifted only `.btn` and `.btn--sm` from the DS, so both sign-in doors render at 32 px / type-sm / radius-md. | `.btn--lg` 40 px · padding space-4 · type-base · radius-lg (`_components.css:81`) | 32 px · type-sm · radius-md | `home/home.css:79-124` (rule missing); used at `v2/signin/SignInCard.jsx:83,95` | blocker |
| R3 | **The sign-in card shrink-wraps.** `.home-below` is a flex child of an `align-items:center` column and has no width, so `.si-door { width:min(600px,100%) }` resolves to its content: about 538 px idle and about 490 px while waiting. | 600 px | about 538 / about 490 px | `home/home.css` `.home-below` (:1032, no `width:100%` / `align-self:stretch`), `v2/signin/signin.css:8` | blocker |
| R4 | **Home's column is 1080 px wide; the board's is 880 px.** The shelves span 1080. Recents use `auto-fill minmax(160px)` (about 6 narrow columns) instead of 4 equal cards. | `.k-home` width 880 · `.k-cards` repeat(4) · `.k-projects` repeat(3) | `.home-page` min(1080px…) · `.home-cards` auto-fill 160 | `home/home.css:368`, `home/home.css:577-581` | blocker |
| R5 | **First run is not quiet.** "Recent canvases" with its empty line and the "Your projects — No projects on this Mac yet" shelf always render under the card. The board draws the card alone on first launch, and only the cloud shelf once signed in. | nothing under the card (ob-first-launch, -signin-browser, -adv-open, -edge-offline, -edge-timeout, -local-name) | two extra sections, about 240 px | `home/home-app.jsx:862-924` (recent section unconditional), `:988-992` (`ProjectsEmpty`) | blocker |
| R6 | **Home has no dot grid.** The kit `<Canvas>` draws dots by default and ObHome sits on it. | `k-canvas--dots` radial canvas-dot / canvas-grid | flat `--canvas-bg` | `home/home.css:14-24` (`.maude-v2.home-root`) | blocker |
| R7 | **Home top bar.** There is no account face (a circle, with a 2 px bg-1 ring) once signed in, and the "Home" pill has no chevron or menu, so Menu › Help is unreachable on Home. The search is a 320 px field where the board draws an icon plus ⌘K. That field follows 11 `pn-home`, so it is board drift (warning), not an impl error. | `ob-acct` Avatar · `ProjectPill home` with chevron · icon-btn search | search field only · bare pill | `home/home-app.jsx:728-744`, `home/home.css:219-236` | blocker (face, chevron) / warning (search) |
| R8 | **The Send button looks disabled when the prompt is empty.** The board draws the azure send on the placeholder. This is a behaviour-versus-drawing choice: either the board or the impl should change. | `.ask .send` accent + white spark | bg-3 / fg-3 | `home/home.css:1001-1005` | warning |
| R9 | **Onboarding sheet controls do not match the DS.** Text fields are white with a hairline and radius-sm instead of the bg-3 well. The pressed segment has no azure ring. | `.input` bg-3 · radius-md · inset 0.5px border-subtle · `.seg [aria-pressed]` inset 1px accent | `.ob-input` bg-1 · radius-sm · 0.5px border-default · `.ob-seg-b[aria-pressed]` bg-1 + shadow-sm | `v2/onboarding/onboarding.css:38-50`, `:141-145` | blocker |
| R10 | **The Connect-Claude sheet is drawn inline in the AI panel.** The board puts a centred window sheet over a strong Veil. The inline sheet has btn--sm foot buttons, no "Advanced · Use an API key instead" row, and is cropped at the panel foot, with the Suggest chips still showing beneath it. | `ConnectSheet` k-dialog 440 px, Veil strong, `.btn` foot, k-adv row | `ConnectSheet inline` in the queued slot, btn--sm, no children | `v2/ai/NeedsYouSlot.jsx:216-223`, `v2/ai/ConnectSheet.jsx:72,80`, `v2/ai/needs-you.css:16` (suggest-hide not taking effect) | blocker |
| R11 | **The artboard has no "AI working" state.** canvas-lib draws no dashed spark frame, no "AI is …" chip under the label, no AI cursor, no dashed spark placeholders and no "Made by AI" in the label row. The agent stream also carries no per-piece step text. | `Artboard aiWorking` / `aiMade` (kit) | plain artboard, generic "AI is working" | `apps/studio/canvas-lib.tsx:508-580` (artboard label/frame, no AI state), `v2/ai/Working.jsx:31-45` (step text only if the agent sends it) | blocker |
| R12 | **Board drift, not impl error (warnings).** Home projects appear as the 11 `pn-projlist` list instead of the kit's `k-projects` cards. "Shared with you" sits beside Projects (11 `pn-home`). Settings is the 06 `ad-settings` full-window sheet with a sidebar, not the 02 close-up card with a segmented control. 02 should lift 11 and 06 here. | 02 kit Home / ob-set | 11 / 06 shapes | `.design/ui/v2/02 Onboarding.tsx:139-157, 758-787` | warning |

## Per artboard (L+D = both themes, same finding)

**ob-first-launch** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | doors 32 px / type-sm | btn--lg 40 px | 32 px | R2 | blocker |
| L+D | card width | 600 | ≈538 | R3 | blocker |
| L+D | Recent canvases + projects shelf under the card | absent | present | R5 | blocker |
| L+D | dot grid | dots | flat | R6 | blocker |
| L+D | pill chevron; search field vs icon | `Home ⌄`, icon + ⌘K | bare pill; 320 px field | R7 | blocker / warning |
| L+D | send on empty prompt | azure | bg-3/fg-3 | R8 | warning |
| L+D | brand starter stronger edge (`ob-starter-brand`, inset 1px border-strong) | drawn | not drawn: first-run starters omit "Bring my existing brand" | `home/home-starters.js:14-20,124-133` | warning |
| L+D | title → sub gap | ≈38 px | ≈29 px | `home/home.css` `.home-question-t` margin space-2 + lh-3xl | warning |

**ob-signin-browser** (L, D) — the browser window and the OS prompt are outside the app (INDEX)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | waiting card width | 600 | ≈490 (shrink-wrap) | R3 | blocker |
| L+D | shelves under the card, no dots, top bar | — | — | R5, R6, R7 | blocker |
| L+D | waiting pill, Cancel `.btn`, link, hint rule | ✓ | ✓ (`signin.css:125-143`) | — | — |

**ob-home-new** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | account face top right | yellow circle "M" | absent | R7 | blocker |
| L+D | shelf width / ghost tiles | 880 / ≈132 px tiles | 1080 / ≈164 px | R4 · `home/home.css:1400-1427` | blocker |
| L+D | "Recent canvases — Canvases you open show up here." above the shelf | absent | present | R5 | blocker |
| L+D | sign-in toast | top toast | not run in lane (exists: `signin-model.js:119`) | *(fixture)* | — |
| L+D | dots | | | R6 | blocker |

**ob-ai-connect** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | sheet placement and plane | centred 440 px k-dialog over Veil strong | inline in AI panel, cropped | R10 | blocker |
| L+D | Advanced › Use an API key instead row | drawn | absent | `NeedsYouSlot.jsx:217` (no children) | blocker |
| L+D | foot buttons | `.btn` 32 px | `btn--sm` 26 px, below the fold | `ConnectSheet.jsx:72,80` | blocker |
| L+D | Suggest chips visible under the sheet | hidden | shown | `needs-you.css:16` | warning |
| L+D | accent / dark ladder / toolbar | | | R1 | (R1) |

**ob-first-draw** (L, D) — partial
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | artboard while AI builds: dashed frame, "AI is writing the headline" chip below, AI cursor, dashed spark placeholders | drawn | plain artboard | R11 | blocker |
| L+D | chat working card with step "3 of 4 · button next" | step line | "AI is working" + clock | `Working.jsx:31-45` (agent-driven; fake agent sends none) | warning |
| L+D | "Open studio is your first project · Rename" toast | drawn | exists (`v2/create/take-intent.js:46`), not reached from the lane's Home | *(lane)* | — |
| L+D | selection / Share accent | azure | indigo | R1 | (R1) |

**ob-sig-draw** (L, D) — **unreachable**. The four frames need R11 in canvas-lib (spark placeholders, label chips, AI cursor, `Made by AI` in the label row, selection label in azure), the one-time `k-tip` "⌘/ Select anything, then ask AI to change it", and per-piece progress from the agent so the order "colour → picture → words → done" can be drawn. Reduced motion needs the same order without the springs. Severity: blocker (state missing).

**ob-invite-page** — **unreachable.** It is a cloud.maude.sh web page. Making it reachable is web work: an invite route on the cloud site, not an app state. Blocker for the product, outside `apps/studio`.

**ob-invite-landed** (L, D) — partial
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | landing on her comment: camera eased to the pin, `ob-focus` halo, thread island 340 px bg-2 radius-xl shadow-lg, reply field focused, "Tereza invited you here" toast, Tereza's cursor | drawn | not reachable. Needs a hub project + second person in the lane, and the invite-deep-link → camera-to-comment path. The toast copy does not exist in client/ | `home/invite-flow.js` (stops at Join) | blocker |
| L+D | the reached Join sheet | matches `ob-edge-accounts` anatomy | ✓ | `home/InviteSheet.jsx` | — |
| L+D | comment composer | thread input, azure focus | indigo ring + indigo send | R1 | (R1) |

**ob-home-team** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | account face | circle | absent | R7 | blocker |
| L+D | target chip default | "Alligators brand" (the one cloud project) | "a new project" | `home/home-model.js` target default / `TargetChip.jsx` | warning |
| L+D | Recent projects cards (stack thumbs, 3-col) vs Projects list | k-projects | `home-projlist` list | R12 | warning |
| L+D | "Shared with you — Nothing shared" ghost shelf | absent | present | R12 (`Shelves.jsx` SharedWithYou) | warning |
| L+D | recent cards | 4 × k-card | none in lane | *(fixture)* | — |

**ob-local-name** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Advanced row: hairline above, label semibold, "Location" pushed right | `.k-adv` inset 0.5px rule · k-adv-btn w-semibold · count margin-left auto | no rule; regular weight; count right next to the label. `.si-adv` is also the class of the card's "Advanced options" button, so the wrapper inherits the button's inline-flex padding | `v2/signin/CreateLocalSheet.jsx:68-81`, `v2/signin/signin.css:103-116, 408-434` | blocker |
| L+D | width, title, field, hint, foot | 420 · ✓ | 419 · ✓ | — | — |
| L+D | name typed / Advanced opened inset | | | *(fixture)* | — |
| L+D | behind the Veil: doors, card, shelves | | | R2, R3, R5 | (R) |

**ob-local-first** (L, D) — partial (populated fixture canvas; the empty canvas is 05 `es-canvas-ai`)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | left panel island sized to content (tabs, search, header, rows, New canvas) | floating island | full-height column + extra rows (Make a design system, kind chips, Trash, Advanced, project foot) | INDEX systematic + `v2/canvases/canvases-panel.jsx` | blocker (systematic) |
| L+D | status cluster "Local project" | ✓ | ✓ (+ YO face, comment icon) | *(fixture)* | — |
| L+D | toolbar size, accent, dark | | | R1 | (R1) |

**ob-local-share** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | popover anatomy: question as the title | no title row | "Share Smoke" title + × + question as a second heading | `v2/share/share-sheet.jsx`, `move-to-cloud.jsx:33-35` | blocker |
| L+D | width | 360 | ≈438 | `v2/share/share.css:17` | blocker |
| L+D | body type | type-sm fg-1 | ≈type-xs | `share.css` `.v2sh-hint` | warning |
| L+D | Cancel | `.btn` (bg-3) | `btn--ghost` | `move-to-cloud.jsx:45` | blocker |
| L+D | extra Advanced foot "Link rules, other ways in, where it syncs" | absent | present | `share-model.js:303` | warning |
| L+D | Move to cloud accent, dark surface | | | R1 | (R1) |

**ob-local-moved** — **unreachable.** Needs the lane to move a local project to a hub. Then the Share popover must open on Invite (email field focused, "You · Owner", "Anyone with the link · Can view · Copy link", Advanced › GitHub) with the "Moved to the cloud — 3 canvases are going up now" toast and a syncing tab. Blocker (state not reached; copy and state live in `v2/share/*`).

**ob-adv-open** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | flyout: 392 px, rows, icon tiles, spark tile, chevrons, foot | ✓ | ✓ | `signin.css:210-295` | — |
| L+D | foot "⌘K" as a Kbd chip | `<Kbd>` | plain text | `v2/signin/advanced-rows.js` `ADVANCED_FOOT` (string), `SignInCard.jsx:248` | warning |
| L+D | card / doors / shelves / dots | | | R2, R3, R5, R6 | (R) |

**ob-adv-sheets** (L, D) — five of six sheets, first states
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | text-field material (hub address, email, password, API key) | bg-3 well | white + hairline | R9 | blocker |
| L+D | pressed segment ring (Email and password / A folder on this Mac) | inset 1px accent | none | R9 | blocker |
| L+D | Connect AI: two radio options, chosen one ringed (`ob-opt[data-on]`) | radio list | first option is the ConnectSheet spark-tile row (no radio, not selectable), second is a radio | `v2/onboarding/ConnectAiSheet.jsx:27-57` (reuses `ConnectSheet` body) | blocker |
| L+D | Install: "Not installed" status colour | `StatusWord off` (grey dot, fg-1) | amber warn (`state:'bad'` for other-link / not-a-link / unavailable) | `v2/onboarding/onboarding-model.js:66-73`, `onboarding.css:114-119` | warning |
| L+D | Figma sheet: Figma link field, "Figma connected" status, Advanced › Access token | drawn | none of the three. The sheet deliberately holds no credential and hands off to the project window | `v2/onboarding/FigmaSheet.jsx:1-12` | blocker (or a board update — decide) |
| L+D | post-probe states (Reachable — hub 1.4, GitHub repo list, Installed, Connected) | drawn | first states only | *(lane: no probes)* | — |
| L+D | Share › Advanced GitHub invite sheet | drawn | not covered by the lane | *(lane)* | — |

**ob-settings** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | sheet shape (card + General/Connections/Advanced seg) | 02 close-up | 06 full-window with sidebar | R12 | warning |
| L+D | Account block: avatar lg + "You · Signed in", Plan "Free trial · N days left", Manage on cloud.maude.sh, list of five account links | drawn | one "Your account on the web · Manage" row, no plan row, no link list | `v2/settings/general-section.jsx`, `v2/settings/account.jsx` | blocker |
| L+D | Connections rows: 32 px icon tile (bg-3, radius-md; spark tile for AI) + StatusWord dot + btn--sm | drawn | bare 16 px icon, plain "Not connected" text, a nested Advanced disclosure per row | `v2/settings/connection-row.jsx`, `connections-section.jsx`, `settings.css` | blocker |
| L+D | "AI — your Claude account · Connected · Change…" row | drawn | absent ("AI images, video and voice" is a different row) | `v2/settings/connections-model.js` | blocker |
| L+D | "Where every old door went" card | drawn | absent (a doc card — product decision whether it ships) | — | warning |
| L+D | switches / seg accent, dark ladder | | | R1 | (R1) |

**ob-edge-offline** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | "AI is back when this Mac is online." hint colour | `--status-warn-text` (`ob-off-hint`) | fg-1 grey | `home/home.css` `.home-ask-hint--off` (:1020) | blocker |
| L+D | offline line, swapped doors, resting cloud door | ✓ | ✓ (`signin.css:67-73,162-183`) | — | — |
| L+D | card / doors / shelves / dots | | | R2, R3, R5, R6 | (R) |

**ob-edge-timeout** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | "Sign-in didn't finish" line | ✓ | ✓ | — | — |
| L+D | card / doors / shelves / dots | | | R2, R3, R5, R6 | (R) |

**ob-edge-other-mac** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | account face | circle | absent | R7 | blocker |
| L+D | target chip | "Studio site" | "a new project" | `home/home-model.js` target default | warning |
| L+D | Recent projects cards vs list; Shared-with-you shelf | k-projects | list + ghost shelf | R12 | warning |
| L+D | "Signed in — your 2 cloud projects are here." toast | top toast | exists (`signin-model.js:128`), not run in lane | *(lane)* | — |

**ob-edge-accounts** (L, D)
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | work account face carries a 16 px team badge (people icon, bg-2 ring) | `ob-acc-work i` | plain avatar | `home/InviteSheet.jsx:73-80` | blocker |
| L+D | sheet width, rows panel, arrow, fine line, foot | 460 · ✓ | 459 · ✓ | — | — |
| L+D | account face top right on Home behind | circle | absent | R7 | blocker |

**ob-edge-ai-missing** (L, D) — same sheet as ob-ai-connect, on a solo project
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | centred sheet over Veil; Advanced row; foot | | | R10 | blocker |
| L+D | AI panel scope chip "A4 · plakát" over a selected poster | drawn | "Whole canvas" (no selection in lane) | *(fixture)* | — |

**ob-edge-whats-new** (L, D) — partial
| | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | one-line pill (pill radius, bg-1, hairline, accent dot, link) | ✓ | ✓ + × | `signin.css:336-366` | — |
| L+D | Menu › Help flyout with "What's new ●" | drawn | unreachable: Home pill has no menu | R7 · `home-app.jsx:729-732` | blocker |
| L+D | recents grid | 4 cards across 880 | ≈168 px auto-fill columns across 1080 | R4 | blocker |
| L+D | account face | circle | absent | R7 | blocker |
| L+D | Recent projects cards vs list; Shared shelf | | | R12 | warning |

## Counting

The counts below count each row once; L+D rows count once. Rows that only point to an R count against that R once.

- **Blockers: 37.** R1–R7 and R9–R11 contribute 10 (R7's warning half goes to the warnings count). The per-artboard rows not already counted under an R contribute 27.
- **Warnings: 20.** R7 (search field), R8, R12, and 17 per-artboard warnings.
- **Verified with no difference in my lens:** none of the 40 frames passes whole. Every Home frame carries R3/R5/R6 and every project frame carries R1. Some components are verified on their own: the Advanced flyout, the waiting / offline / timeout lines, the local-name sheet body, the accounts sheet body, and the What's-new pill. They are listed in the `"verified_components"` key below.

## Verdict

```json
{"canvas":"02 Onboarding","critic":"design-critic","blockers":37,"warnings":20,"verified_ids":[],"verified_components":["ob-adv-open flyout (L,D)","ob-signin-browser waiting line (L,D)","ob-edge-offline offline line + swapped doors (L,D)","ob-edge-timeout line (L,D)","ob-local-name sheet body (L,D)","ob-edge-accounts sheet body except badge (L,D)","ob-edge-whats-new pill (L,D)","Home dark ladder (all Home pairs)"],"unreachable":["ob-sig-draw","ob-invite-page","ob-local-moved"],"opt_out_applied":"palette","ds_blockers_downgraded":0}
```
