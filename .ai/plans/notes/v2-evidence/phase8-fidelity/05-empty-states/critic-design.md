# design-critic — 05 Empty States — V2-8.5 stage B (spec vs impl)

_2026-10-22 · board `.design/ui/v2/05 Empty States.tsx` (+ `.css`, `_kit.css`) · DS `maude-v2` · pairs: full-size PNGs from `.scr/pairs/05` (spec left 1440 px, impl right 1600→1440 scaled ×0.9) · read-only, no server booted · opt_out_scope `palette`_

Lens: layout, spacing, sizes, typography, colour/tokens, material, iconography, every drawn state.
Impl px below are de-scaled (÷0.9). "(fixture)" rows from INDEX are not findings. The INDEX systematic differences (no native chrome/tab strip, status word "Local project", fixture data) are not repeated.

## Root causes (named once, not re-listed per artboard)

| # | Root cause | Evidence | Owner | Hits |
|---|---|---|---|---|
| R1 | **Shell not on maude-v2 tokens** (in progress). Accent is v1 indigo, not azure; the canvas is a neutral grey, not the cool canvas-bg; dark surfaces are darker than the v2 dark ladder | pill mark spec `#006EBF`, impl `#5165C6`; Share spec `#0274BB`, impl `#A0AEED`; light canvas spec `#F4F8FB`, impl `#F3F4F6`; dark canvas spec `#16171B`, impl `#0C0F14`; dark island spec `#1C2023`, impl `#12151A`; every Ask AI / Generate / Clear filter is indigo | shell token layer | every in-project artboard × both themes (Home is on v2: azure ✓) |
| R2 | **v1 buttons / selects / toasts** (in progress) | "Show canvases on this Mac" is an outlined v1 button where the spec has a filled `btn btn--sm` (bg-3) | `v2/empty/not-local.jsx:30` + global `.btn` | offline-uncached, project-new, panels |
| R3 | **Left panel is a docked full-height column, not a floating island.** It also adds rows the board does not draw: + / folder icons, a "Search canvases… /" field, "Make a design system", a kind-chip row, a Recent sort, a Trash row, an Advanced foot and a project switcher. This breaks the README hard rule "Chrome floats; it never frames" | spec `.island.k-cp` ≈ 248 × content height | `v2/canvases/canvases-panel.jsx:534-574` (+ left-panel shell) | project-new, canvas-ai, artboard-new, panels-canvas, search-panel, filter, arriving, offline-uncached |
| R4 | **Cascade-layer order defeats the panel-size overrides.** The order `@layer reset, tokens, layout, shell, components, utilities` means every `@layer shell` override of a kit `.es-*` class loses to `empty.css`'s base `.es-sit` (type-md 17 px) / `.es-next` (sm, fg-1), whatever its specificity. Separately, `.es-e--inpanel` defines padding only (`space-6 space-3`). The spec gives it `.es-sit` type-base and `.es-next` type-xs fg-2, with padding `space-5 space-2 space-4` | "Nothing in 2027 yet." draws ≈17 px (spec 12 px) and is not indented; "No canvases yet." draws 17 px (spec 14 px) | `styles/_index.css:17`, `v2/canvases/canvases.css:5,401-418`, `v2/empty/empty.css:400-402` | panels-canvas, timeline (panel), project-new, filter |
| R5 | **Canvas empty blocks are centred on the window, not on the free canvas.** The spec centres them right of the panel (`.es-center--panel`: `left: calc(50% + 132px)`, top 45 %). Impl has `.es-ec { left: 50% }` and `.ep-host { place-items: center }` | text centre x: spec 852, impl 720 | `v2/empty/empty.css:365-372`, `v2/create/empty-project.css:10-17`, `.viewport > .st-not-local` `empty.css:348-354` | project-new, canvas-ai, offline-uncached, arriving |
| R6 | **Kit chrome around the canvas drifts.** Dock ≈40 px tall vs 56 px. The zoom/undo chip is off by default. There is an extra inspector-toggle island top-right and an extra comments icon in the Share cluster. Toolbar glyphs (shape, pen, text) differ from the kit family | spec `Toolbar` / `ZoomUndo` | 01/04 kit owners | every Stage artboard |
| R7 | **Empty renderers that bypass the S11.1 kit** lose the Rounded situation line, the 36 px glyph tile and the spot | `lp-empty-t` (Trash, Assets no-hits) and `.st-pal-sit` (⌘K: body face, sm, 600) | `v2/left-panel/trash-view.jsx:139-145`, `v2/left-panel/assets-panel.jsx:711-713`, `v2/search/search.css:176-185` | panels-make, search-k, search-more |
| R8 | **Kit states built but never mounted, or gated on a selection the flow never makes.** `SkeletonArtboard` has no caller. `AllTrashed` has no caller (the header says "Mount (lead, app.jsx)"). The artboard hint and the empty Layers line need a whole-artboard selection, but "New artboard" does not select the board it makes | `v2/empty/skeleton.jsx:35`, `v2/empty/all-trashed.jsx:13`, `editing/empty-reporter.tsx` `selectedArtboardOf`, `v2/empty/empty-host.jsx:125` | arriving, all-trashed, artboard-new |

## Per artboard

### es-home-cloud
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Home canvas has no dot grid | `Canvas`: canvas-bg + `--canvas-dot` grid | flat `--canvas-bg` | `home/home.css:14-18` | blocker |
| L+D | Extra "Recent canvases — Canvases you open show up here." section above the shelf | first run stays quiet: question → shelf | a section is added | `home/home-app.jsx:862-864` | blocker |
| L+D | Top-right search | icon-button + ⌘K kbd island ≈72 px | 320 px search field "Search canvases and artboards…" | `home/home.css:235-238`, `home-app.jsx:737` | blocker |
| L+D | Shelf width | `.es-shelf` 880 px | 1080 px (`.home-page` min(1080px,…)) | `home/home.css:368` | warning |
| L+D | Home pill has no menu chevron | "Home ⌄" | "Home" | `home/home-app.jsx:729-731` | warning |
| L+D | Send button while the prompt is empty | azure fill | bg-3 grey (disabled until typed) | `home/HomeAsk.jsx:100`, `home.css:1001` | warning |

### es-home-local
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Sign-in sits bare, without its island | `.island.es-signin`, 40 px, right 116 | ghost button straight on the canvas | `v2/signin/SignInCard.jsx` (SignInQuiet, ~l.260) | warning |
| L+D | "No projects on this Mac yet" card replaced by the Studio site row | — | — | (fixture: a project is registered) | — |

The dot-grid / search-field / Recent rows from home-cloud apply here too; they are not recounted.

### es-home-shared
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Shelf layout | stacked: Your projects (880, full width), then Shared with you | two columns: Shared 5fr on the left, Projects 6fr on the right (follows 11 pn-home, so the boards disagree; pick one) | `home/home.css:1385-1390`, `home-app.jsx:929` | blocker |
| L+D | Shared empty row | 2-col: ghosts \| text | 1-col: ghosts above the text (`.home-two .home-shelf-row`) | `home/home.css:1404-1407` | blocker |
| L+D | Project card | 3-thumb `k-stack` + square "S" avatar on the right | one flat thumb + a "Y You · email" header row | `home/home-app.jsx:942+` | warning |
| L+D | Extra shelf aside "canvases from other people's projects" | none | added | `home/Shelves.jsx:30` | warning |

### es-project-new
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | The prompt collapses to a ≈220 px field with a clipped placeholder. `width:min(520px,100%)` inside the shrink-to-fit `.es-chips` falls back to content width | 520 px `island island--pad es-askbox` + `k-ask-lg`, 36 px azure round send | narrow pill, focus ring drawn | `v2/create/empty-project.css:18-22`, `v2/empty/empty.jsx:149` | blocker |
| L+D | Card placement (R5) | free-area centre (+132) | window centre | `v2/create/empty-project.css:10-17` | blocker |
| L+D | Panel header | island title row "Portfolio 2026 · 0 canvases" (find=false), foot "Folders appear when you make one." | no count row; search, Make a design system, Recent, a stray "Studio site" line, Trash/Advanced foot (R3) | `v2/canvases/canvases-panel.jsx:534` | blocker |
| L+D | Prompt has no island wrapper | island (frost) around `.ask` | bg-2 pill straight on the canvas | `v2/create/empty-project.css:18-37` | warning |
| L+D | "No canvases yet." sizes (R4) | sit type-base 14 · next xs fg-2 | 17 · sm fg-1 | `v2/empty/empty.css:400-402` | warning |
| L+D | Share button | azure | pale disabled `#A0AEED` | share cluster | warning |

### es-canvas-ai
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Block placement (R5) | x 852 (free area), top 45 % | x 720 | `v2/empty/empty.css:365-372` | blocker |
| L+D | Kind-chip row "All 1 · 0 0 0 0" in the Canvases panel | none | shown | `v2/canvases/canvases-panel.jsx:574` | warning |

Spot, line and button spacing match (sit→next ≈ 26 px both).

### es-landing
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| D | All four dark frames show the "Opening Untitled canvas…" loading card. The empty canvas never painted (either a capture or timing problem, or the shell stuck on Opening…). Dark is unverified | frames 0 / 90 / 200 / 520 ms | loading card ×4 | `shell/viewport.jsx:244` (loading card); re-capture | blocker |

Light: the real animation matches the frozen frames (drop, stagger, overshoot). The impl's "New artboard" button belongs to es-canvas-ai. Light is verified.

### es-canvas-three
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Connect sheet is cramped inside the AI panel: ≈240 px wide, body clipped ("Your prompt waits…" cut off), Advanced row and Cancel/Connect out of view | `ConnectSheet inline` at full column width (≈430): title, option card, Advanced row, fine print, Cancel + Connect | NeedsYouSlot mount | `v2/ai/NeedsYouSlot.jsx:217` | blocker |
| L+D | After-send slices (Drafting… / Queued) not captured | `AiSlice` | — | evidence gap | warning |

Offline line (warn-text + offline glyph) and the half-strength spot match. The status word is local-only (fixture).

### es-artboard-new
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | No floating hint card: "Empty artboard." + F / I / ⇧I keys + "Ask AI to fill Tablet". The reporter fires only on a whole-artboard selection, and "New artboard" (`artboard.new-desktop`) does not select the new board (R8) | `.es-abhint` 236 px, radius-lg, island material | none | `v2/empty/empty-host.jsx:125`, `editing/empty-reporter.tsx` | blocker |
| L+D | Layers tab has no empty line. It lists "Untitled canvas · 1 artboard · Desktop" | glyph tile + "No layers on Tablet yet." | tree row only | `inspector/inspector-panel.jsx:675` (same store gate) | blocker |
| L+D | No inspector for the selected artboard | Preset Tablet · W 834 H 1194 · Fill White · Clip content | none | follows from the missing selection | blocker |
| L+D | Framing | board at 31 % beside its neighbours; azure label tag "Tablet 834 × 1194" | board zoomed to fill the window; plain "Desktop" label | canvas fit on create | warning |

### es-panels-canvas
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Empty folder line (R4) | sit type-sm 12, next xs fg-2, indented `space-2 + space-5` under the folder | ≈17 px / sm, flush with the folder icon | `v2/canvases/canvases.css:401-418` | blocker |
| L+D | Open 2027 row not marked current | `aria-current` accent-muted row | plain row + "…" | `v2/canvases/canvases-panel.jsx` (~1270) | warning |
| L+D | Comments "none" carries the filter segment | title + × only | Open · Mine · Resolved · All segment | `v2/comments/comments-panel.jsx:235` | warning |
| L+D | "Share for feedback" glyph | kit `share` (tray + up arrow) | v1 share-nodes (`StIcon 'share'`; v2 is `share-up`) | `v2/comments/comments-panel.jsx:98` | warning |
| L+D | Confetti density | `mv2-pattern-confetti` 320 × 240 tile over the whole panel | 2–3 pieces near the top | `v2/comments/comments-panel.jsx:67`, `v2/empty/confetti.jsx` | warning |
| L+D | Version history | "Now" row on accent-muted (44 px) + the empty line | a plain Now row + "Name this version…"; empty line not shown (fixture had one change) | history panel (`v2/history/use-versions.js:32`) | warning |

The 4-tab segment (adds All) follows CONTRACT §6, so the board is behind, not the impl. Not a finding.

### es-panels-make
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | AI chat empty | `spot ai` 168 + Rounded "Ask about Pricing." + 3 `es-sugg` chips | no spot, no chips, body line "Ask for a change, a few variants, or an answer." | `v2/ai/Suggest.jsx:22` | blocker |
| L+D | Assets has no drop-zone frame | `.es-drop`: bg-1, 1.5 px dashed border-strong, radius-lg | spot straight on the panel | `v2/left-panel/assets-panel.jsx:686-698` | blocker |
| L+D | Exports glyph points the wrong way | kit `export`: arrow down into the tray (`_kit.tsx:174`) | arrow up out of the tray | `v2/empty/empty.jsx:22-27` | blocker |
| L+D | Trash bypasses the kit (R7) | 36 px trash glyph tile + centred Rounded `es-sit` | left-aligned small `lp-empty-t` | `v2/left-panel/trash-view.jsx:139-145` | blocker |
| L+D | Composer | one-line `.ask` with the chip inside + azure send | tall textarea + paperclip + separate chip row (03's canonical composer, C28) | 03 owner | warning |
| L+D | Extra "From this Mac…" + search rows on the empty Assets tab | none | shown | `v2/left-panel/assets-panel.jsx:814` | warning |
| L+D | Exports header and door | SidePanel title + ×; "Export… ⇧⌘E" | collapsible header with chevron; no key hint | `v2/export/exports-panel.jsx:51,82` | warning |
| L+D | Trash header | back + "Trash" + "Studio site" chip + × | no chip, inside the left panel | `v2/left-panel/trash-view.jsx` | warning |

### es-timeline
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | The empty timeline has no structure | ruler 0:00–0:30; dashed drop track with a 36 px video glyph tile; Captions + Music lanes (CONTRACT C35 now says Text · Graphics · Video · Music, so the board needs updating too) | a plain left-aligned block "No clips on reel yet." | `v2/timeline/timeline-empty.jsx:66-82`, `TimelineHost.jsx:235` | blocker |
| L+D | Transport on an empty reel | quiet 40 %-opacity play, "0:00 / 0:00", name, Expand | full transport: filled play, skip, loop, volume, scrubber, 6 tool buttons, fps/frames slider, × | `v2/timeline/TimelineHost.jsx` | blocker |
| L+D | Video inspector missing | Preset Reels 9:16 · 1080 × 1920 · Length "Set by its clips" · 30 fps | none (the selection is the page element) | inspector routing for a video artboard | blocker |
| L+D | Empty video artboard | quiet video glyph + "9:16 · 0:00" at 60 % | filled black play-circle overlay | video artboard render | warning |

The "Cut 15 s" chip needs clips in Assets (fixture).

### es-search-k
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Situation line (R7) | Rounded type-md 600 (`es-sit`), next fg-1 | body face type-sm 600, next fg-2 | `v2/search/search.css:176-185` | blocker |
| L+D | Field key cap | `esc` | `⌘K` | `dialogs/command-palette.jsx:444` | warning |
| L+D | Palette geometry | 580 wide, top 97 | ≈640 wide, top ≈120 | palette CSS | warning |

"Did you mean Pricing" is missing because the fixture has no Pricing canvas.

### es-search-more
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | "Start here" icons | plus / folder / insert / help on neutral bg-3 tiles | Open project and Import show a chevron ">" tile (missing registry icon); New canvas tile filled accent | `v2/search/search-recent.js:78` (registry `icon`) | blocker |
| L+D | Assets no-hits (code-verified; the fixture had no assets) | `Empty spot="none"` 150 + Rounded "Nothing called “logo bílé”." + AI chip + fine print | `lp-empty` text only (R7) | `v2/left-panel/assets-panel.jsx:711-713` | blocker |
| L+D | Labels and keys | "New canvas", separate ⌘ and N caps | "New canvas…", one "⌘N" cap | registry labels / `Kbd` | warning |

### es-search-panel
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Search field has two × (clear + close) | one 10 px × in a round chip (`k-find-x`) | two bare × | `v2/canvases/canvases-panel.jsx` (find field) | warning |
| L+D | Foot position | island foot right under the list | under the Trash row at the panel bottom | `v2/canvases/canvases-panel.jsx` | warning |

Spot, words and the Ask AI chip match.

### es-filter
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Active chip | print icon + 0 + × | "Print 0", no × | `v2/kinds/KindChips.jsx:46` | warning |
| L+D | Clear filter | `btn btn--ghost btn--sm` with × icon, fg-1 | azure text link, no icon | `v2/kinds/LayersKindFilter.jsx:70-74` | warning |
| L+D | Layers tree still listed under the empty block | the empty block only | tree (div / h1 / p…) below the block | `v2/kinds/LayersKindFilter.jsx:80+` / inspector | warning |

### es-viewer — not reachable (blocker)
This needs a Can comment member session: the hub or a workspace cell has to vouch a role (`MAUDE_WORKSPACE_MODE`) before 04's Hand · Comment toolbar, the floating right Comments panel, no AI chat, and "Viewing · Can comment · Ask to edit" can render. There is no evidence for this state.

### es-arriving
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | No skeleton artboards and no "4 artboards on their way" tag. `SkeletonArtboard` is never mounted (R8); the viewport shows only the Q13 one-line card | named `.es-skab` outlines, pulsing page, sync tag | "Smoke is on its way." centred | `shell/viewport.jsx:203-205`, `v2/empty/skeleton.jsx:35` | blocker |
| L+D | Panel foot has no progress bar | `.es-bar` 4 px pill, accent fill 44 % | text only | canvases-panel foot | blocker |
| L+D | Canvas dot grid hidden. The not-local/arriving stand-in paints the v1 token `--u-bg-0` over the canvas | canvas-bg + dot grid | flat fill | `v2/empty/empty.css:348-354` | blocker |
| L+D | Toolbar hidden while partly arrived | toolbar shown | none | viewport stand-in | warning |
| L+D | No tab sync glyph and no "Syncing…" word | sync glyph + Syncing… | absent | tab strip / status cluster | warning |

### es-offline-uncached
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Cloud mark on rows that are not on this Mac | right-aligned in the meta slot | inline after the name | canvases-panel row meta | warning |

The rest is a near pixel match: icon tile, plain-face title, two sentences, dimmed rows. The grid hidden by `--u-bg-0` (see es-arriving), R5 and R2 apply here and are not recounted.

### es-all-trashed — not reachable (blocker)
`AllTrashed` (outlines kept in place, azure dashed bracket, "Restore N artboards" card) is built but never mounted. Its header says "Mount (lead, app.jsx)", and there is no caller (`v2/empty/all-trashed.jsx:13`). The empty-canvas host shows "Your canvas is ready." instead. To make it reachable:
- mount it ahead of the empty-canvas line when the canvas has 0 artboards and Trash holds artboards from it;
- give the e2e lane a way to produce the state (the UI refuses to trash the last artboard).

### es-edge-panels
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| L+D | Block position | vertically centred in the 460 px list (`.es-chats > .es-e` justify center) | top, right under the search | `v2/ai/ChatList.jsx:428` | warning |
| L+D | Chats header | back · Chats · project chip · + | no +; the AI header row is stacked above | `v2/ai/ChatList.jsx` | warning |
| L+D | Search clear | 10 px × in a round chip | bare bold azure × | `v2/ai/ChatList.jsx` find field | warning |
| L+D | "Team of one" Share sheet not reached (it needs a cloud project) | Invite sheet with an empty people block | — | evidence gap; needs a cloud/hub fixture | warning |

## Dark-only
Beyond R1 (impl dark canvas and islands are 1–2 ladder steps darker than the v2 dark tokens), the only dark-specific defect is the **es-landing dark** capture (loading card ×4). Every other dark difference repeats its light row.

## Verdict

**Blockers: 30** · Warnings: 37 · Verdict: fix-and-retry

```json
{
  "canvas": "05 Empty States",
  "critic": "design-critic",
  "blockers": 30,
  "warnings": 37,
  "verified_ids": ["es-landing·light"],
  "top_blockers": [
    { "category": "ds-typography", "line": 0, "summary": "@layer order (shell < components) defeats every panel-size .es-* override; .es-e--inpanel lacks spec type sizes", "fix": "Move kit overrides into @layer components (or a later layer) and add the spec's inpanel sit/next sizes." },
    { "category": "ux", "line": 0, "summary": "SkeletonArtboard and AllTrashed are built but never mounted; artboard hint gated on a selection 'New artboard' never makes", "fix": "Mount both; select the new artboard after artboard.new-*." },
    { "category": "ds-tokens", "line": 0, "summary": "st-not-local stand-in paints v1 --u-bg-0 over the canvas (no dot grid) on arriving/offline", "fix": "Use the canvas surface (canvas-bg + dot grid) or a transparent stand-in." }
  ],
  "opt_out_applied": "palette",
  "ds_blockers_downgraded": 0,
  "passed": false
}
```
