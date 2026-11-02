# signature-moment-critic — 05 Empty States (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/05 Empty States.tsx` · impl = release v2 client (stage-A frames, `full-size-path.txt`) · opt_out_scope: palette · READ-ONLY_

## TL;DR

**Aspiration (impl vs board): 3.4/5** · Specificity: pass · Verdict: **fix-and-retry**

Of the three canvases, this one carries its moments best. The **empty-state cards with their one verb** are mostly verbatim, and they come from one copy table (`client/v2/empty/empty-copy.js`). Matching cards: the canvas spot art with "Your canvas is ready." + Ask AI, the empty folder with "+ New canvas in 2027", "All done." with its confetti, "Versions appear here as you work.", Assets "Generate an image", ⌘K "Nothing called “pricng”." + Ask AI to find, the panel search over 93 canvases, the filter card with "Clear filter", "Smoke isn't on this Mac yet." and the chat search miss. The **sticky landing** (the one playful beat) is real.

The richer moments are missing:

- **Empty AI chat:** no spot art and no "Ask about Pricing." with canvas-written chips. The copy exists but is unused.
- **New-artboard hint card:** code exists, and it did not fire.
- **Timeline:** no ruler, clip drop track or Captions / Music lanes.
- **Arriving canvas:** no skeleton artboards with names. One centred line stands in.
- **All-trashed outlines with Restore:** unreachable.
- **New-project prompt:** collapses to a 200 px clipped field.

Dark: the board is drawn light only (INDEX). The dark impl repeats the light findings. One dark-only evidence gap: in es-landing every dark frame caught only the "Opening Untitled canvas…" loading card, so the landing is unverified in dark.

Not findings (lane / fixture per INDEX): window chrome, fixture names (Smoke, e2e-fixture), "Did you mean Pricing" (no Pricing canvas), the empty-assets generic winning over "Nothing called “zzz”" (the fixture has no assets), the timeline's AI chip (`timeline-empty.jsx:44-52` correctly drops it with no footage), the hub-linked status words.

## Per artboard (a "both" row counts once per theme in the totals)

### es-home-cloud / es-home-local / es-home-shared
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both (cloud) | "No projects yet. Your first canvas starts one — and everyone you invite sees it here." ✓ | — | — | `client/home/Shelves.jsx` | verified (element) |
| both (cloud) | An extra "Recent canvases — Canvases you open show up here." line above the shelf | shelf only | line + shelf | `client/home/home-app.jsx:922` | warning |
| both (cloud) | Flat Home surface, no dot field | Canvas dots | none | `client/home/home.css:18` | warning (boards disagree, see 01) |
| both (local) | Extra Recent line. The registered project row replaces the empty card (fixture) | — | — | `home-app.jsx:922` | warning |
| both (shared) | Two columns (Shared left, Projects right), not Your projects first and Shared below | stacked | side by side | `client/home/home-app.jsx:927` | warning (follows 11 `pn-home`) |
| both (shared) | The ghost words do not name the people | "When Tereza or Jonas share a project with you…" | "When someone shares a project with you…" | `client/home/Shelves.jsx:145` | warning |

### es-project-new
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Spark + sticky spot, "<Project> has no canvases yet.", "Start with an empty canvas ⌘N" ✓ | — | — | `client/v2/create/empty-project.jsx` | verified (element) |
| both | The prompt card collapses to ~200 px: placeholder clipped ("A one-page portfolio with"), grey idle send | ~395 px card, round blue send | 200 px pill | `client/v2/create/empty-project.css:22` (`width: min(520px, 100%)` resolves against a shrink-to-fit parent) | blocker |
| both | The panel shows a stray root label "Studio site" under "+ New canvas", and "Folders appear when you make one." sits in the foot | "0 canvases" header, line under the list | — | `client/v2/create/empty-project.jsx:141-150` + canvases panel | warning |

### es-canvas-ai — verified
| both | Spot art, "Your canvas is ready.", "Ask AI for a first draft, or start drawing.", Ask AI ⌘/ + New artboard ✓ (the board draws both buttons) | — | — | `client/v2/empty/empty-canvas.jsx` | verified |

### es-landing — one drop of spring
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| light | The stickies drop in order and settle ✓. But the first frame is the loading card, not the line ("0 ms — the line is already there. Words never wait for the art.") | line at 0 ms | "Opening Untitled canvas…" first | viewport loading card (`client/shell/viewport.jsx`) | warning |
| dark | All four frames are the loading card, so the landing is not evidenced in dark | — | — | re-shoot (lane timing) | warning |

### es-canvas-three
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Online ✓ and offline ✓ ("AI is back when this Mac is online."). Not-connected: the Connect sheet is inline in the AI panel with chips under it. The board has a centred 290 px card | centred sheet | inline | `client/v2/ai/NeedsYouSlot.jsx:216-222` (the window variant `EmptyConnect` exists, `client/v2/empty/empty-canvas.jsx:85-90`) | blocker |

### es-artboard-new
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No floating "Empty artboard." hint card, which reads "Draw a frame with F, place an image I … + Ask AI to fill Tablet" | 236 px hint centred on the board | none | `client/v2/empty/artboard-hint.jsx` exists. Its feed `apps/studio/editing/empty-report.ts:7` needs the ONE selected artboard to be empty, and it did not post for the "New artboard" result | blocker |
| both | No compact inspector (Preset Tablet · W 834 · H 1194) beside it | card | none / full column | `client/v2/inspector/sections.js` | warning |

### es-panels-canvas
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Words and spot art ✓ for the empty folder, Comments none, All done (confetti), Version history before the first change. The panels are full-height islands, not 205 px floating cards with × | content-height cards | full height | `client/v2/shell/floating-panels.css` (islands stretch) | warning |

### es-panels-make
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The empty AI chat has no spot (spark + sticky), no "Ask about Pricing.", no line and no three chips written for the canvas | `es-panels-make.ai-none` | "Ask for a change, a few variants, or an answer. AI works on what the chip says." | copy ready `client/v2/empty/empty-copy.js:121-126`, unused. `client/v2/ai/Suggest.jsx:19-24` (`ChatEmpty`) draws 03 `ai-open` | blocker (03 and 05 disagree: one empty state per chat needed) |
| both | Assets ✓ (Generate an image), Exports ✓, Trash ✓. The Trash header lacks the "Studio site" project chip | chip | none | `client/v2/left-panel/trash-view.jsx` | warning |

### es-timeline
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No 0:00–0:30 ruler, no empty clip track drawn as the drop zone, no Captions / Music lanes. A flat "No clips on reel yet." sits under the transport bar | ruler + track + lanes | kit block only | `client/v2/timeline/Timeline.jsx:2067` (`tl-empty`) | blocker |
| both | The video artboard inspector (Preset Reels 9:16 · Size · Length "Set by its clips" · Frame rate) is not shown | card | — | inspector sections (selection = the page element) | warning |

### es-search-k / es-search-panel — verified
| both | Spot + "Nothing called “…”." + "Ask AI to find …" ✓. Panel: "Searched 93 canvases and their artboards" ✓ | — | — | ⌘K + `client/v2/canvases/canvases-panel.jsx` | verified |

### es-search-more
| both | ⌘K "Nothing opened yet." + Start here list + Ask AI ✓. Assets no-hits not reached (fixture has no assets) | — | — | — | not-a-finding |

### es-filter
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Card ✓ (Clear filter, "1 other artboard is dimmed · Show all"). The chip lacks its × | "Print 0 ×" | "Print 0" | `client/v2/left-panel` kind chips | warning |

### es-viewer — not reachable
| — | a comment-only member session. **Product work:** a hub / workspace cell vouching a role in the lane (`MAUDE_WORKSPACE_MODE`) | — | — | — | blocker (state not shown) |

### es-arriving
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No skeleton artboards (names and sizes kept), no "4 artboards on their way" tag, no pulse. One line, "Smoke is on its way.", centred on blank canvas | skeleton layout | Q13 fallback | `client/v2/empty/not-local.jsx:43-55` (`ArrivingCanvas`). **Product work:** the hub listing must carry artboard names + sizes | blocker |
| both | No foot progress bar and no "Syncing…" status. The foot words "Getting … · 41 of 93" ✓ | bar | words only | `client/v2/empty/arriving.jsx` | warning |

### es-offline-uncached — verified
| both | Icon, "Smoke isn't on this Mac yet.", both sentences, "Show canvases on this Mac", dimmed rows with the cloud ✓ | — | — | `client/v2/empty/not-local.jsx:17-40` | verified |

### es-all-trashed — not reachable
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No dashed outlines where the artboards stood and no "<Canvas> has no artboards left. · Restore 4 artboards" card. The generic "Your canvas is ready." shows | outlines + card | generic empty | built: `apps/studio/artboard-ghosts-overlay.tsx`, `client/v2/empty/all-trashed.jsx`. They need every artboard in the Trash, and the UI refuses to trash the last one. **Product work:** a sync / second-person route in the lane | blocker |

### es-edge-panels
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Chat search miss ✓ word for word. The "team of one" Share sheet ("Only you on Studio site so far.") is not reached (needs a cloud project) | sheet | — | `client/v2/share` | warning (unverified) |

## Root causes (several artboards)

1. **R1: the copy table is ahead of the views.** `empty-copy.js` holds `es-panels-make.ai-none`, but ChatEmpty never reads it. The timeline's empty block has no track skeleton. The project prompt collapses in its parent (`empty-project.css:22`).
2. **R2: the inline ConnectSheet in the panel** (`NeedsYouSlot.jsx:217`). Same cause as 02 ob-ai-connect.
3. **R3: states that need peer data are unreachable or fall back to plain text:** arriving skeletons (no sizes in the listing), all-trashed (Trash must hold every board), viewer (a role).
4. **R4: the artboard-empty reporter's trigger** (`editing/empty-report.ts:7`, one selected, nothing on it) did not fire for "New artboard", so the hint card never shows.
5. **R5: islands stretch full height** (`floating-panels.css`) where the board's empty panels are content-height cards.

## What's working (preserve)

- One copy table per artboard part, used verbatim by most empty states. Spot art is shared with the DS empty-state specimen.
- The sticky landing on `--ease-spring`, and the "nothing is lost" offline card.
- Every search miss offers exactly one verb (Ask AI to find it / Start a chat about it / Clear filter).

## Verdict

```json
{
  "canvas": "05 Empty States",
  "critic": "signature-moment-critic",
  "agent": "signature-moment-critic",
  "iter": 1,
  "blockers": 15,
  "warnings": 28,
  "aspiration_score": 3.4,
  "axes": {
    "signature_moment": { "score": 3, "weight": 1.5 },
    "brand_prominence": { "score": 3, "weight": 1.0 },
    "mock_fidelity": { "score": 3, "weight": 1.0 },
    "restraint": { "score": 4, "weight": 1.5 },
    "negative_space": { "score": 4, "weight": 1.0 }
  },
  "specificity": "pass",
  "specificity_findings": [],
  "top_blockers": [],
  "opt_out_applied": "palette",
  "passed": false,
  "verified_ids": ["es-canvas-ai · light", "es-canvas-ai · dark", "es-search-k · light", "es-search-k · dark", "es-search-panel · light", "es-search-panel · dark", "es-offline-uncached · light", "es-offline-uncached · dark"]
}
```
