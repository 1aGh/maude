# signature-moment-critic — 06 Advanced (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/06 Advanced.tsx` vs the live app (pairs in `06-advanced/`) · type: product surface (Advanced folds, Diagnostics, Settings) · aspiration score of the IMPL against the board: **3.2/5**_

Read-only review. Lens: **the Advanced fold**, the board's one idea (`Fold`, 06 Advanced.tsx:311-322). Closed, it is one quiet row plus ≤ 3 nouns of hint. Open, it is a layer under the plain rows. Remembered, it carries a "kept open" pin. The second moment is the **Diagnostics popover** (Menu › Diagnostics: one status word each for Sync, Server and AI setup, then the tools under its own Advanced; `DiagBoard` :1411-1417). Lane differences (local project instead of cloud/git, C2) are not findings.

## TL;DR

**Aspiration: 3.2/5** · Specificity: pass · Verdict: fix-and-retry

The fold is real and consistent. `AdvancedFold` (`client/v2/fold/advanced-fold.jsx`) is the same disclosure on the Canvases panel, Inspector, AI panel, Export, History and Settings, with the hint nouns ("Code, tokens, CSS", "Files, folder, Trash"). ⌘K › Open all Advanced sections works, with its toast and Close all. What's missing is the remembered "kept open" pin, an AI fold that renders empty group headings, and evidence for the Diagnostics popover: the frame captured the Diagnostics sheet's Server tab, not the menu popover with status words. That popover exists in code (`v2/shell/project-menu-model.js:52`) but was not captured.

## Per-artboard differences (lens: the fold, the Diagnostics popover)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| ad-left · both | No "kept open" pin beside a remembered Advanced | `<span className="ad-kept"><Icon name="pin"/>kept open</span>` (06:316) | label + hint only | `v2/fold/advanced-fold.jsx:52-70` (the fold-store remembers it, `fold-store.js:75`, but never shows it) | warning |
| ad-inspector · both | The fold sits at the foot under about 15 plain rows (Position … Export). The spec's closed card is 5 rows plus the fold, so here "a layer underneath" reads as one more row in a long list, and the open body was cut off in the frame | 5 rows + fold (06 ad-inspector) | dense Inspector | `client/v2/inspector/*` (density is design-critic's; the fold placement is mine) | warning |
| ad-ai · both | Fold body shows group headings with nothing under them ("AI may", "This chat") and "Connecting…" | rows under every heading | empty headings | `v2/ai/Advanced.jsx` (should hide empty groups). Partly harness H: no session config | warning |
| ad-diag · both | Diagnostics popover not captured. The frame is the Diagnostics sheet (tabs Logs / Server / AI setup / Sync) docked top right. The spec's moment is the menu popover with one status word per row and its Advanced (Address, Process, Project folder, Resync now, Download all) | popover from the project menu | sheet | popover rows: `project-menu-model.js:52`, `use-diagnostics-menu.js`; recapture via project pill › Diagnostics | warning |
| ad-logs · both | Tabbed (one source at a time) where the spec shows Logs, Server and AI setup as three boxes at once | 3 boxes | tabs | `v2/diagnostics/diagnostics-sheet.jsx` | warning |
| ad-export · both | No artboard thumbnail strip at the head of the sheet. The Advanced body is two dense columns, not one quiet column | 3 thumbs "Post 1:1 · Story 9:16 · A4" + single column | text header, 2 columns | `v2/export/*` sheet | warning |
| ad-edge-syntax · both | No dimmed last-good board behind the card. Card, Show details and Ask AI to fix it match | grey last-good tiles behind | plain canvas | broken-canvas card host | warning |
| ad-settings · both | Advanced is one scrolling column, clipped by the window. The spec has three columns (This Mac / Engines / This project) | 3 columns | 1 column | `v2/settings/*` | warning |

**Verified in this lens:** ad-open-all (toast "All Advanced sections are open. Close all", fold open), ad-search (path chips "… › Advanced" on every row), ad-pinned (AI panel pinned with its fold open; the spec's Inspector/Canvases pin was not driven, so this is no lens difference), ad-code (palette rows). Each in dark and light.

**Unreachable / lane:** ad-map, ad-why and ad-trace are documentation. ad-timeline needs a video canvas in the fixture. ad-ds needs a real DS board in the lane. ad-menus is the native menu bar. ad-edge-sync, ad-edge-hub and ad-edge-where need hub, roles or offline. ad-edge-remember is a multi-day per-Mac story. ad-share, ad-history and ad-syncd only reached their local-project variants (C2).

## Root causes
1. **The fold does not show that it remembers.** fold-store keeps the choice per panel, but `AdvancedFold` has no "kept open" slot.
2. **Fold bodies render empty groups** when their data is absent (AI fold without a session).
3. **The Diagnostics moment was captured on the wrong surface** (sheet instead of the menu popover), so the status-in-words popover has no evidence yet.

## Axis scores (IMPL against the board)

| Axis | Score | Weight | Weighted | Verdict |
|---|---|---|---|---|
| Signature moment (the fold, the popover) | 3/5 | 1.5 | 4.5 | One consistent fold across panels; the pin is missing and the popover is unseen |
| Brand prominence | 3/5 | 1.0 | 3.0 | Mono is allowed inside folds and used well; nothing marks the "Advanced side" |
| Mock fidelity | 4/5 | 1.0 | 4.0 | Real logs, real settings, real syntax-error card |
| Restraint | 3/5 | 1.5 | 4.5 | Closed surfaces are already dense (Inspector, Export), so the fold's "quiet on top" promise is diluted |
| Negative space | 3/5 | 1.0 | 3.0 | Settings clipped; Export Advanced packed in two columns |
| **Specificity gate** | **pass** | — | — | — |

Weighted total: 19.0/30 → **3.2/5**

## What's working
- One `AdvancedFold` everywhere, with hint nouns. ⌘K Open all / Close all. Search path chips.
- The syntax-error card (sentence, Ask AI to fix it, Show details with line and column).

## Verdict

```json
{
  "agent": "signature-moment-critic",
  "iter": 1,
  "blockers": 1,
  "warnings": 4,
  "aspiration_score": 3.2,
  "axes": {
    "signature_moment": { "score": 3, "weight": 1.5 },
    "brand_prominence": { "score": 3, "weight": 1.0 },
    "mock_fidelity": { "score": 4, "weight": 1.0 },
    "restraint": { "score": 3, "weight": 1.5 },
    "negative_space": { "score": 3, "weight": 1.0 }
  },
  "specificity": "pass",
  "specificity_findings": [],
  "top_blockers": [],
  "opt_out_applied": "palette",
  "passed": false
}
```

```json
{"canvas":"06 Advanced","critic":"signature-moment-critic","blockers":0,"warnings":8,"verified_ids":["ad-open-all-dark","ad-open-all-light","ad-search-dark","ad-search-light","ad-pinned-dark","ad-pinned-light","ad-code-dark","ad-code-light"]}
```
