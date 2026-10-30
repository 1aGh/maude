# signature-moment-critic — 11 Projects and Navigation (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/11 Projects and Navigation.tsx` · impl = release client + the real `apps/desktop/src/strip.html` with a stubbed Tauri channel (G4 pairs: 16 ids + 3 extra crops × dark/light; 7 unreachable) · opt_out_applied: palette_

Lens: the board's signature moments and craft. The question for each one: does the impl carry it, or something plainer? Every pair was read in both themes. I cropped the full-size PNGs for the tab strip rows, Version history, the organise panel, ⌘K close matches and Home ⌘K. **Theme "both"** means one finding counted once. The seed data (75 small canvases, gradient covers, no peers, signed-out hub) is not a finding.

## TL;DR

**Aspiration (impl vs board): 2.6/5** · Specificity: pass · Verdict: **divergent**

The in-canvas ⌘K palette is the one signature moment carried almost whole: grouped by project, squares, place words, close-match notice. **Home's centred palette** does not exist; ⌘K on Home focuses a top-right field. **Version history** shows empty picture squares, and the Now row's layout breaks while you view a version. The **tab strip** is a flat folder-tab row, not the board's raised pill with separators.

| Axis | Score | Weight | Weighted | Verdict |
|---|---|---|---|---|
| Signature moment | 2/5 | 1.5 | 3.0 | No Home palette. Version thumbnails empty. Strip flat. ⌘K in-canvas is good. |
| Brand prominence | 3/5 | 1.0 | 3.0 | Project squares are carried (strip, ⌘K, Home). The accent is v1 periwinkle. |
| Mock fidelity | 2/5 | 1.0 | 2.0 | Canvas rows and version rows show blank thumb squares. Pictures never arrive in the lane. |
| Restraint | 3/5 | 1.5 | 4.5 | An extra accent-filled kind-chip row ("All 87") sits on the panel. Outlined v1 buttons everywhere. |
| Negative space | 3/5 | 1.0 | 3.0 | The Home scroll is fine. Keyboard shortcuts is a 92-key, 3-column wall vs the board's focused list. |
| Specificity gate | pass | — | — | — |

Weighted 15.5/30 → **2.6/5**

## Per-artboard findings

### pn-tab-b (strip)
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Active tab is a top-rounded folder tab, not a raised pill | `.k-tab[data-on]` radius-md all round, canvas-bg, shadow-sm, semibold (`_kit.css:75,81`) | `.tab {border-radius:7px 7px 0 0}`, no shadow, regular weight | `apps/desktop/src/strip.html:112-131` | blocker |
| both | No separators between resting tabs | `.k-tab + .k-tab::before` 1 px border-default (`_kit.css:80`) | none | `strip.html` | warning |
| both | × sits at the right of the active tab; the spec puts it at the left | × first | `el.appendChild(close)` last | `apps/desktop/src/strip.js:235` | warning |
| both | Working spark is a bare glyph; the spec puts it in an 18 px spark-muted disc | `.pn-tab-ai` (`11 … .css:39`) | `.dot.working` glyph | `strip.html:157-171` | warning |
| both | No "+" and no traffic lights | — | by decision (v2-3.7-own-tab-bar) / native | — | not-a-finding |

### pn-tab-b20 · pn-relaunch-strip
| both | "11 more" text control instead of the "»" list; tabs shrink to 9 visible | "»" | "N more" | `strip.js` overflow | warning |
| both | Resting ring marks present | — | ✓ | — | ok |

### pn-switch-ai-strip
| both | The spec crop is variant A (titles only, native), so it's not comparable to the B strip | — | — | superseded board frame | not-a-finding |

### pn-home
| both | **The "Ask AI for a new canvas…" bar + "Start with an empty canvas ⌘N" don't stay on top when scrolled** (board note 9: "Scrolled, Ask AI … stay on top") | `pn-askrow` in the top row | the top bar holds only the Home pill + Sign in + Search; the ask scrolls away | `client/home/home.css:204-216` (`.home-top` sticky without the ask) + `home-app.jsx` | blocker |
| both | Projects list has no "Find a project" field or Recent sort | `pn-h-right` search + sort | none | `home/Shelves.jsx` | blocker |
| both | Project rows: thumbnail, no right-aligned tone square | `Sq ini tone` | thumbnail | `home/Shelves.jsx` | warning |
| both | Pinned row / Shared with you missing | — | seed (nothing pinned, signed out) | — | not-a-finding |
| both | "What's new" strip on top | — | harness | — | not-a-finding |

### pn-home-search — Home's centred palette (signature)
| both | **⌘K focuses the top-right search field and drops a hint under it; no centred palette over a veil** | `<Veil/>` + `PnPalette` centred, 560 px, groups Recent searches / Open tabs (with AI state) / Recent canvases, foot "every project, open or not" | `searchRef.current.focus()`. `.home-pal` is right-anchored under the field (`right:0`). The empty state is one line. | `client/home/home-app.jsx:420-431`, `home-app.jsx:1378-1404`, `home/home.css:268-276` | blocker |
| both | With no history, no "Open tabs" / "Recent canvases" groups | 3 groups | `home-pal-none` line | `home-app.jsx:1380-1405` | blocker |

### pn-ds
| both | The DS is two plain rows with a sliders glyph, not the accent-tinted "Design system" card | `DsRow`: accent-soft card, grid glyph, "Alligators brand system · used by 3 projects" (board line 486) | `StIcon name="sliders"`, "Default · 37 canvases" | `client/v2/left-panel/canvases-pinned.jsx:80`, `v2/ds/pinned-rows.js:119-125` | blocker |
| both | No "used by N projects" line | — | — | `ds/pinned-rows.js` | warning |

### pn-ds-search
| both | DS rows read "Design system · not on a canvas yet". The spec has one project group with "Alligators brand system · used by 3 projects" and DS-section rows ("Colour · section of the Design system") | — | grouped by type | `client/v2/search/search-ds.js` | warning |
| both | Row icons are generic squares; the spec uses the DS grid glyph | grid glyph | sliders/square | `search-ds.js` | warning |

### pn-organise
| both | An extra row of kind filter chips ("All 87 · 0 · 80 · 1 · 6") with an accent-filled "All", plus a +/folder icon row above Search | none on this board | `KindChips` + icon row | `client/v2/canvases/canvases-panel.jsx:574` (KindChips from 08 Artboard Kinds; board conflict) | warning |
| both | Canvas rows show empty dark thumb squares | `Thumb art` | `.cv-thumb` with no `row.cover` | `canvases-panel.jsx:992-1000` | warning (no covers in lane) |
| both | Pinned row shows only a pin; the spec has the person badge + pin | `Avatar T` + pin | pin | `v2/left-panel/canvases-pinned.jsx` | warning |
| both | Sort menu matches (Recently opened / Name / Kind with meta / Folders on top) | — | ✓ | — | ok |

### pn-move
| both | Drag ghost + "Move here" target chip + "Double-click a name" tooltip not shot | — | not driven | `v2/canvases/use-move.js` | unverified |
| both | Inline rename + "↵ rename · esc keep" hint present; the hint is smaller | — | ✓ | — | warning |

### pn-trash
| both | No Restore button on the trash row (hover-only?) and no Today/Earlier who+when grouping | `Restore` primary sm on the row | none visible | `client/v2/left-panel/trash-view.jsx` | blocker |
| both | Toast is a bottom-right 360 px card with an accent left rule; the spec is a one-line pill above the dock ("'ahoj' moved to the trash. · Undo") | `.k-toast--dock` | sonner `.maude-notice` | `apps/studio/notifications.tsx:224-225` | blocker (R4) |
| both | "Clear out the trash?" confirm with the red Clear out not shot | — | — | — | unverified |

### pn-jump
| both | Jump rows lack kind icons and the board name header ("Combine campaign") | kind glyphs | frame glyph only | `client/v2/canvases/jump-list.jsx` | warning |

### pn-k-across
| both | Result rows use icons; the spec shows canvas thumbnails | `Thumb` | icon chips | `client/dialogs/command-palette.jsx` | warning |
| both | Groups with project square + place words: **carried** | — | ✓ | — | ok |

### pn-k-close
| both | The close-match notice is a plain line; the spec is a tinted chip with a search glyph | `pn-notice` chip | text line | `command-palette.jsx` + `v2/search/search.css` | warning |
| both | Canvas result has a generic page glyph, not its thumbnail; artboards use a square glyph, not the kind glyph (print) | thumb / print glyph | generic | `command-palette.jsx` | warning |
| both | Kbd "⌘K" in the field; the spec shows "esc" | esc | ⌘K | `command-palette.jsx` | warning |

### pn-history — Version history chips + thumbnails (signature)
| both | **Pictures never render**: every row's thumb is an empty dark square | `Thumb` per version | `Picture` falls to `data-state=none/pending` | `client/v2/history/history-panel.jsx:47-60` (picture pipeline didn't deliver in the lane) | blocker |
| both | **The Now row breaks while viewing a version**: "Now" centres on its own line, the status wraps at body size | dot · "Now" / "Uniformy-2027 · Saved" left-aligned, xs | `.vh-row` (later, same specificity) overrides `.vh-now-t`'s `align-items`/`font`/`gap` on the `<button class="vh-now-t vh-row">` | `client/v2/history/history.css:83-106` vs `126-140`, `history-panel.jsx:445-456` | blocker |
| both | Author is a grey two-letter "so"; the spec has tone avatars | `Avatar` tone | grey initials | `history-panel.jsx` row meta | warning |
| both | Named / Made by AI chips | — | none in seed (no named/AI versions) | — | not-a-finding |
| both | Panel narrower (~300 vs ~350 px) and titles truncate | — | — | `history.css` | warning |

### pn-compare
| both | Compare caption sits at the very top and clips; the spec puts it in-canvas with the A/B labels on the boards | `co`-style labels on boards | clipped bar | `client/v2/history/compare-view.jsx` | warning |
| both | Thumbnails empty (same as pn-history) | — | — | — | (counted above) |

### pn-switch-ai
| both | ⌘K › Keyboard shortcuts opens a 3-column, 92-key sheet; the board is a compact single-column list led by "Tabs and windows" / "Finding a canvas" with search | focused list ~330 px | full sheet | `client/dialogs/shortcuts-overlay.jsx` | blocker |

### pn-relaunch
| both | "20 tabs reopened…" is a bottom card with × and a left rule; the spec is a top-centre one-line pill with a tabs glyph | `.k-toast--top` | sonner card | `notifications.tsx:224-225`, `shell-events.js:52-53` | blocker (R4) |

### pn-deeplink
| both | No "Opened from Tereza's link — Pozvánka · story" toast, and the target artboard isn't framed/centred | toast + framed artboard + comment popover | artboard selected only | `client/shell-events.js:10` (`take_pending_navigate`) | blocker |

### Unreachable
pn-tab-a, pn-tab-a20, pn-ab (superseded variant / decision board: not a finding). pn-tab-menu, pn-windows (native NSMenu / multi-window: native lane needed). **pn-accounts**: the account card by the faces is not built. **pn-cant-open**: needs moved-root / removed-access states in the Rust shell + hub. The last two are findings: the states don't exist.

## Root causes that hit several artboards
1. **R1 — v1 accent and v1 buttons in the shell** (`styles/1-tokens-maude.css:41,154`; `styles/4-components-maude.css:12-60`), the same as canvas 10.
2. **R2 — no pictures**: version rows and canvas rows depend on rendered covers/thumbs that never arrive in the browser lane. Every "picture" moment reads as an empty square.
3. **R3 — Home ⌘K is a field, not a palette**: the centred palette and its three empty-state groups were not built (`home-app.jsx:420-431`).
4. **R4 — toasts are sonner cards** (`notifications.tsx:224-225`), not the kit's one-line island pill (`_kit.css:606-625`). Hits pn-trash and pn-relaunch, and pn-deeplink has none.
5. **R5 — the strip is tab-folder styled** (`strip.html:112-131`), not the kit's `.k-tab` pill with separators.
6. **R6 — panel extras from other boards** (KindChips, icon row) crowd the 11 panel. Needs a call between 08 and 11.

## What's working
- In-canvas ⌘K: project groups with squares and place words, close-match notice, Ask AI row.
- The sort menu, the "Viewing … · back to now" bar words, "Name this version…", and the relaunch sentence verbatim.

## Verdict

```json
{"canvas":"11 Projects and Navigation","critic":"signature-moment-critic","blockers":13,"warnings":20,"verified_ids":[],
 "aspiration_score":2.6,"axes":{"signature_moment":{"score":2,"weight":1.5},"brand_prominence":{"score":3,"weight":1.0},"mock_fidelity":{"score":2,"weight":1.0},"restraint":{"score":3,"weight":1.5},"negative_space":{"score":3,"weight":1.0}},
 "specificity":"pass","specificity_findings":[],"opt_out_applied":"palette","passed":false,
 "unreachable":["pn-tab-a","pn-tab-a20","pn-ab","pn-tab-menu","pn-windows","pn-accounts","pn-cant-open"]}
```
