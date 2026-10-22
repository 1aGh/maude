# signature-moment-critic — 12 Import and Assets (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/12 Import and Assets.tsx` · impl = release client, browser lane with a Tauri stub, the e2e fixture + 18 generated "plasma" JPEGs + a `Photos` canvas (G4 pairs: 15 ids + 4 extra step pairs × dark/light; 7 unreachable) · opt_out_applied: palette_

Lens: the board's signature moments and craft. The question for each one: does the impl carry it, or something plainer? Every pair was read in both themes. I cropped the full-size PNGs for the Assets panel and the details/Advanced close-ups. **Theme "both"** means one finding counted once. Plasma tiles, 19 assets instead of 247, and no AI/Figma/network are fixture limits, not findings.

## TL;DR

**Aspiration (impl vs board): 2.6/5** · Specificity: pass · Verdict: **divergent**

The two headline moments of this board are not shown by the impl. The photo inspector's **Look tiles** never open: the fixture's `<img>` isn't content-addressed. The **drop chip** "Drop to place 6 photos in …" never appears; a dashed full-canvas frame shows instead. The **Missing** frame shrinks to a thin hatched strip. The Assets panel is a capless wall of tiles where the board has a calm, grouped library with a count foot.

| Axis | Score | Weight | Weighted | Verdict |
|---|---|---|---|---|
| Signature moment | 2/5 | 1.5 | 3.0 | Look tiles, drop chip and Missing card: none carried in the lane. |
| Brand prominence | 3/5 | 1.0 | 3.0 | The AI spark in Assets is a neutral glyph, not the coral spark that marks AI moments. v1 accent. |
| Mock fidelity | 3/5 | 1.0 | 3.0 | Details view lacks used-in thumbnails and the added-by avatar. The rest is real. |
| Restraint | 3/5 | 1.5 | 4.5 | "Not used" pressed is a solid accent fill (spec: accent-muted chip with a check). Disabled primaries draw accent outlines. |
| Negative space | 2/5 | 1.0 | 2.0 | Assets lists every tile in every group, with no 2-row cap and no foot. Details pins Advanced to the bottom over a void. |
| Specificity gate | pass | — | — | — |

Weighted 15.5/30 → **2.6/5**

## Per-artboard findings

### ia-drop-photos — the drop chip (signature)
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No "Drop to place 6 photos in Fotky ze zápasu" chip on the target, no accent ring on the target artboard, no ghost stack with the "6" badge | blue chip above the target + stack | none | `apps/studio/editing/finder-drop.tsx` (built; the synthetic drag didn't trigger its `isFinderDrag`) | unverified: needs a native / real-DataTransfer drag |
| both | A 2 px dashed accent frame round the **whole canvas** shows instead (the board has none) | — | `.dc-media-dragover::after` | `apps/studio/use-canvas-media-drop.tsx:176-184` | blocker |

### ia-placed
| both | Photos are not placed into frames ("Not placed. That picture does not fit there…"); no per-picture upload marks, no cloud status | grid of 6 in frames + "Placed 6 photos in Fotky ze zápasu. They're in Assets too. · Undo" pill | "Just added 6" group only | fixture (one `<img>`, no empty frames, local project) | not-a-finding |
| both | "Just added" group at the top of the panel: **carried** | — | ✓ | — | ok |

### ia-assets-panel
| both | Every group lists **all** its tiles; the spec caps at two rows then "120 ›" | 6 tiles + count chevron | `g.items.map(renderTile)` uncapped | `client/v2/left-panel/assets-panel.jsx:788` | blocker |
| both | No "All kinds ▾" filter chip | `chip ia-ap-kinds` (board line 284) | absent | `assets-panel.jsx:623-640` | blocker |
| both | Foot "247 assets · 1.4 GB" missing | foot | only with a query (`assets-search-foot`) | `assets-panel.jsx:818-835` | warning |
| both | Generate is a neutral sparkle, not the coral spark | `<Spark>` (spark token) | `StIcon name="sparkle"` in fg | `assets-panel.jsx:604` | blocker (spark is AI's identity, CONTRACT) |
| both | Tile gap and radius tighter than the kit's | 3-up, radius-md, space-2 gap | `.lp-grid gap: var(--space-1)` | `client/v2/left-panel/left-panel.css:576-590` | warning |
| both | ⌘K kbd inside the search field (not on the board) | none | `⌘K` | `assets-panel.jsx:582-596` | warning |

### ia-assets-keys
| both | The tile right-click menu "Place in <artboard> ↵ / Show details / Rename… / Copy / Move to trash" is not in this frame | menu | selected tile only | `client/v2/assets/tile-menu.jsx` | unverified |
| both | Selected tile overlay shows name + "Not used" | — | ✓ | — | ok |

### ia-assets-browse
| both | No selection circles on thumbs, no "6 selected · 18.4 MB · Clear · Place 6 in <artboard> ↵" foot bar | circles + foot | none (no multi-select in shot) | `client/v2/assets/browse-view.jsx`, `assets/multi-select.js` | blocker |
| both | Wide view butts against the canvas edge (no gap/shadow separation) | island with gap | flush | `browse-view.jsx` / `left-panel.css` | warning |
| both | Header (Assets › Photos N, search, Newest first, Large/Small) and filename captions: **carried** | — | ✓ | — | ok |

### ia-assets-find
| both | Offer card copy is verbatim; the card is a flat muted block, and "Turn on…" is a v1 outlined button | island card, v2 `.btn` | `lp-empty` block | `client/v2/assets/describe-consent.jsx` + R2 | warning |
| both | Permission sheet, "Seen in the picture" results, AI-not-connected state | — | not reachable (AI stub) | — | unverified |

### ia-assets-tidy
| both | "Not counted: 12 kept only by older versions, 3 AI takes from today" note and the foot "31 assets · 212 MB · Move 31 to the trash…" are missing | info banner + foot | both gated on `hasUsage`. In the lane, list rows had no `usedIn`, although Details knew "Used in 2 canvases". | `assets-panel.jsx:216,681,818` + `v2/assets/tidy.jsx:52-80` | blocker (check whether the list endpoint drops `usedIn`) |
| both | "Not used" pressed is a solid accent fill | `chip chip--accent` = accent-text on accent-muted + check (board line 285, `_components.css:178`) | `.lp-chip[aria-pressed=true]{background:var(--accent)}` | `left-panel.css:1082-1085` | blocker (restraint) |

### ia-asset-details
| both | "Used in" rows have no canvas thumbs and no chevrons | thumb + name + board + › | text rows | `client/v2/assets/details.jsx:228-244` | blocker |
| both | Back header has no "‹" and no "⋯" menu | `‹ Assets … ⋯` | "Assets" text | `details.jsx:124` | warning |
| both | Added row lacks the person avatar; no "AI saw" tag chips | `Avatar` + chips | "just now" | `details.jsx` (no added-by / tags in fixture) | warning |
| both | Picture is square-cornered at panel width; the spec has a large rounded picture | radius-lg hero | flat | `details.jsx` / `left-panel.css` | warning |
| both | "Place" vs "Place in MVP zápasu ↵" | target name | no artboard selected | — | not-a-finding |

### ia-photo-inspector · ia-photo-steps — Look tiles (signature)
| both | The generic element inspector opens; no Photo section (Placement, 8 Look tiles, Light/Colour, Remove background, Only this use changes / Apply to every use…) | `photo-section` | `PhotoSection` mounts only when `photoTarget` is set, which needs an `assets/<sha8>.<ext>` src | `client/inspector/inspector-panel.jsx:31,48-63,553-562,642`. The same shape gate is in `apps/studio/dom-selection.ts:569` and `inspect.ts:315` | unverified: the fixture `<img src="assets/Matchday-01.jpg">` isn't content-addressed (real imports are). **Re-shoot with an imported photo before scoring.** |
| both | Note for the owner: a hand-placed, human-named asset never gets a photo inspector | — | — | same gate | warning |

### ia-gen-ask
| both | The ask is an inline card at the top of the Assets panel; the spec is a popover on the selected artboard in the canvas | popover by the artboard (Gameweek 5 photo) | `GenerateAsk` in the panel | `client/v2/assets/generate-ask.jsx:164` | blocker |
| both | The validation line "Select an artboard first…" shows at once in error red | quiet until asked | red line | `generate-ask.jsx` | warning |

### ia-figma-sheets · ia-figma-sheets-connect
| both | Words verbatim and the structure matches | — | ✓ | — | ok |
| both | Disabled Import / Connect show as accent outlines; the spec has a muted grey fill and a filled Connect | v2 `.btn[disabled]` | `.maude .btn:disabled` + primary border | `styles/4-components-maude.css:43-47` | warning (R2) |
| both | Not-connected row lacks the lock glyph | `Icon lock` | none | `client/v2/import/figma-sheet.jsx` | warning |

### ia-brand-steps (+ -1 / -2 / -3)
| both | The Couldn't-read box lacks the warning triangle; the spec has a glyph + bold lead + Try again | ⚠ + text | text + Try again | `client/v2/import/brand-sheet.jsx` | warning |
| both | Reading state with progress bar not captured (no network, it flashes past) | — | — | — | unverified |
| both | No logo chosen, so no "Continue with the logo" | — | state | — | not-a-finding |

### ia-missing-gone — the Missing card (signature)
| both | **The hatched frame is a thin strip at the top of the picture.** The red hatch over the whole frame, the centred card (⚠, file name, "Missing — no device has it", blue Relink…) never fit. | full-frame hatch + card | the overlay sizes to the broken `<img>`'s own rect, a few px tall | `apps/studio/asset-placeholder.tsx:236-247` (measures `f.el`, the img, not its frame) | blocker |
| both | Inspector "Missing · Added by Tereza…" card not opened in the shot | `AssetAbsentBox` | — | `client/v2/assets/missing-frame.jsx` | unverified |

### ia-advanced
| both | Advanced is pinned to the panel bottom with a void above; the spec flows it under the picture | fold under content | bottom-pinned | `client/v2/assets/details-advanced.jsx` / `left-panel.css` | warning |
| both | Only "Stored as / In canvases"; no "Original / Edits / Cut-out" and no Terminal snippet with Copy | 5 rows + snippet | 2 rows | `details-advanced.jsx` (Original/Edits need data; the snippet is not built) | warning |

### Unreachable
ia-more-ways (paste / native picker for video and logo), ia-gen-placed (provider), ia-figma-arrived and ia-figjam (Figma API), ia-brand (a reachable website), ia-missing (a synced peer that holds the file), ia-edges (nine conditions). ia-gen-placed has the board's "four takes, ← →" moment, and `assets/takes-overlay.jsx` exists. It needs a stub provider lane to be judged.

## Root causes that hit several artboards
1. **R1 / R2 — v1 accent ladder and v1 `.maude .btn`** (`styles/1-tokens-maude.css:41,154`; `styles/4-components-maude.css:12-60`). Every primary is periwinkle; every secondary and disabled button is outlined.
2. **R3 — overlays measure the element, not the frame**: the Missing hatch (`asset-placeholder.tsx:238-247`). The dashed drop frame is also canvas-wide (`use-canvas-media-drop.tsx:176-184`).
3. **R4 — the photo shape gate** (`assets/<sha8>.<ext>` in `inspector-panel.jsx:31`, `dom-selection.ts:569`, `inspect.ts:315`) hides the whole Photo section for any non-content-addressed picture. The lane must use a real import to see the board's headline moment.
4. **R5 — the Assets panel has no rhythm**: uncapped groups, no kinds filter, no foot, and the tidy affordances are gated on `usedIn`.
5. **R6 — AI identity is lost**: the Generate glyph uses fg, not `--spark` (CONTRACT: spark = AI only).

## What's working
- "Just added" lands at the top after an import.
- The browse view header and captions.
- Figma and Brand sheet words verbatim, including the keychain line.
- The ask-once offer copy.

## Verdict

```json
{"canvas":"12 Import and Assets","critic":"signature-moment-critic","blockers":10,"warnings":15,"verified_ids":[],
 "aspiration_score":2.6,"axes":{"signature_moment":{"score":2,"weight":1.5},"brand_prominence":{"score":3,"weight":1.0},"mock_fidelity":{"score":3,"weight":1.0},"restraint":{"score":3,"weight":1.5},"negative_space":{"score":2,"weight":1.0}},
 "specificity":"pass","specificity_findings":[],"opt_out_applied":"palette","passed":false,
 "unreachable":["ia-more-ways","ia-gen-placed","ia-figma-arrived","ia-figjam","ia-brand","ia-missing","ia-edges"],
 "reshoot":["ia-photo-inspector","ia-photo-steps","ia-drop-photos"]}
```
