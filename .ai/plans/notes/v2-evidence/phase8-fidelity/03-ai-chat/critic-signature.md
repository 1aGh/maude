# signature-moment-critic — 03 AI Chat (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/03 AI Chat.tsx` vs the live app (pairs in `03-ai-chat/`, full-size under `.claude/worktrees/agent-a45b4750975bd8337/.scr/`) · type: product surface (AI panel + canvas overlay) · aspiration score of the IMPL against the board: **2.5/5**_

Read-only review. Lens: does the app carry each of the board's signature moments (AI working line + spark, Before/After wipe, solid ring + Made by AI tag, suggestion strip, permission card with thumbnails), or a plainer stand-in? Fixture-only differences (Alligators artwork, flat canvas list, local project, generic tool titles from the fake agent = harness H) are not findings.

## TL;DR

**Aspiration: 2.5/5** · Specificity: pass · Verdict: divergent

The running half of the ring idea is real: a dashed spark outline and a spark tag on the artboard, "· 1 waiting", the azure needs-you ring. The finish, which is the board's hero, never shows. No frame has a solid ring, a Before/After wipe or a "Made by AI" tag, and the code path that should draw them has no caller. Around that, the panel loses the spark as its identity: the header glyph is indigo `--accent`, the working moment is three stacked items instead of one spark line, and the permission card has no thumbnails.

## Per-artboard differences (lens: signature moments)

### ai-hero · both themes
| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| Finish moment absent: no solid spark ring, no Before/After wipe, no "Made by AI" on Post after the run | `<Ring kind="done">` + `<Wipe at={30}/>` + `aiMade="Made by AI"` (03 AI Chat.tsx:517-518, Wipe :338-345) | Post keeps only the blue selection | `artboard-activity-overlay.tsx:131-160` draws `done`, but `runs-store.js:94 markDone` has **no caller** anywhere in `client/`, so `doneRings` (runs-model.js:244) is always empty. `made-by-ai.js` needs a `kind:'ai'` `project:action` (sync/action-stage.ts:691), and this local-project run never emitted one | blocker |
| When it fires, the "wipe" is a 2 px line sweeping once, with no before image under it and no Before/After pills | `.ai-wipe-before` clip + `.ai-wipe-lab--b/--a` pills | `.dc-ai-sweep` 2 px bar | `artboard-activity-overlay.tsx:155-160, 268` | blocker (same row family) |
| Tereza's AI tag and outline | `TheirAi` (03:311-318) | — | lane: needs a hub project with a second person | n/a (lane) |

### ai-open · both
| Panel header spark is indigo `--accent`, not vermilion `--spark` (on every panel artboard) | `.k-ai-hd { color: var(--spark) }` (_kit.css:322) | `.chat-bar--v2 .chat-hd-spark { color: var(--accent) }` | `client/styles/6-acp-chat.css:1816-1819`, `panels/chat-header.jsx:24` | blocker |
|---|---|---|---|---|
| No suggestion strip in the empty chat | comments-context strip | none | fixture: no open comments (`SuggestStrip` gets `openComments=0`) | not a finding |

### ai-working · both
| difference | spec | impl | owner | sev |
|---|---|---|---|---|
| The working moment is not ONE line. The app stacks a "✦ AI" role label, streamed text ("Making it greener —"), a mono tool row ("Edit the canvas ●") and then the working card | one `Working` row: spark + "AI is making it greener" / step + Stop (03:81-89, kit `.k-ai-working`) | 4 stacked elements | role label `v2/ai/Feed.jsx:343`, tool row `Feed.jsx:94` (`ChatToolCard flat`), card `v2/ai/Working.jsx:31` | blocker |
| The artboard ring and tag are present (dashed spark, "AI is working"). The spec words are the model's verb ("AI is making it greener"). The fixed tag is a recorded decision (v2-lead-neutral-ai-ring-tags) | — | — | `runs-model.js:175` | warning |

### ai-done · both
| Finish missing on the artboard (same root as ai-hero) | wipe + solid ring + Made by AI | none | see ai-hero | blocker |
|---|---|---|---|---|
| Follow-up chips sit in the composer's `above` slot and carry a "Because…" line. The spec puts them inside the result block with no reason ("Follow-ups under an answer need no reason", 03:564) | chips in the Result block | strip above the field + why line | `panels/ChatPanel.jsx:463-472`, `v2/ai/Suggest.jsx:114-117` | warning |
| The chips are generic: "Same on the other artboards / A darker shade / Apply it everywhere" against the spec's named "Same on Story 9:16 / A darker green" | named artboard | generic | `v2/ai/suggest-why.js` (colour branch) | warning |

### ai-suggest · both
| The context glyph sits on the why line. The spec puts it on the lead chip (`ai-sugg-lead`, 03:248) | lead chip glyph | why-line glyph | `Suggest.jsx:115` | warning |
|---|---|---|---|---|
| Only 1 of 4 contexts can be reached | — | — | fixture (comments, clips, share) | not a finding |

### ai-scope · both
| The chip shows the artboard id "post", not the label "◆ Post 1:1" | `k-selchip` label | id | `v2/ai/ScopeChip.jsx` / `scope.js` (C6) | warning |
|---|---|---|---|---|

### ai-two-artboards · both
| Two rings with the same fixed tag, where the spec has two verbs. There is also no "Working" popover list | per-run verb + list popover | "AI is working" ×2 | `runs-model.js:175` (decided), `RunList.jsx` | warning |
|---|---|---|---|---|

### ai-copy · both
| The frame is mid-run, so "Made by AI" on the finished copy and the "Copied from…" caption were never seen | done copy | working copy | recapture after completion; same done-ring root | warning |
|---|---|---|---|---|

### ai-permission · both
| No thumbnail strip of the 4 photos | `<Thumb … className="ai-perm-th"/>` ×4 (03:502) | title + detail text only | `v2/ai/PermissionCard.jsx:73-105` (no media slot) | blocker |
|---|---|---|---|---|
| The needs-you ring is on all five artboards, not only on what changes | ring on the 4 team artboards | 5 azure outlines + 5 tags | `runs-model.js:305` (scope → every artboard) | warning |

### ai-question · both
| Azure "Waiting for you" tags on every artboard while a question is open. The spec instead points with a small spark ring ("9 pt") | `Ring kind="point"` | 5 azure tags | `runs-model.js:305`, `pointsFor` | warning |
|---|---|---|---|---|

### ai-needs-hidden · both
| The toast is a card with ×, not the one-line pill with "Show". All five artboards are tagged | pill + one ring | card + 5 tags | `needs-you-toast.js`, `runs-model.js:305` | warning |
|---|---|---|---|---|

### ai-panel-closed · both
| The busy dot on the folded corner spark can't be made out | dot on spark | faint/absent | `v2/shell/corner-icons.jsx:54` | warning |
|---|---|---|---|---|

### ai-choice-fail · both
| Choice rows have no colour swatch | `sw` dot + hint (03:131) | text rows (hint slot exists, no swatch) | `v2/ai/ChoiceCard.jsx:72` | warning |
|---|---|---|---|---|

### ai-history · both
| No "Made by AI" rows and no before/after compare (harness attribution plus the done-ring root) | Made by AI chips | "changed outside the app" | `v2/history/rows.ts:336` needs kind `ai` | warning |
|---|---|---|---|---|

### ai-chat-list · both
| Running rows use an orange dot, not the spark avatar | spark disc | dot | `v2/ai/ChatList.jsx` | warning |
|---|---|---|---|---|

### ai-long · both
| No "Jump to latest" pill and no resize tooltip | pill + tip | — | not driven (`jump-model.js` exists) | warning |
|---|---|---|---|---|

### ai-not-ready · both
| The connect sheet opens inside the panel. The spec shows it as a card beside the panel with "Your prompt waits here" | beside | inside | `v2/ai/ConnectSheet.jsx` | warning |
|---|---|---|---|---|

### Verified in this lens (no signature difference)
ai-same-artboard (ring tag "AI is working · 1 waiting" plus the Waiting card match), ai-quit, ai-attach-menu, ai-adv-edges (slash panel), ai-advanced (fold), ai-long-pinned. Each in dark and light.

### Unreachable (lane, not product)
ai-queue-rule (documentation). ai-other-tab and ai-needs-tab need a second project tab in the desktop shell. ai-needs-away needs a native notification. ai-tereza needs a hub project with a second person. ai-attach drag overlay was not driven.

## Root causes (several artboards)
1. **The done ring is dead code for a local run.** `markDone` (runs-store.js:94) has no caller, and Made-by-AI depends on a `kind:'ai'` action that only the staged/sync path proposes. This hits ai-hero, ai-done, ai-copy, ai-history and 04 md-edge-ai.
2. **The sweep is not the wipe.** `.dc-ai-sweep` is a moving 2 px line. It never shows the before image and has no Before/After labels.
3. **The spark is not the AI colour in the panel.** The header glyph uses `--accent` (6-acp-chat.css:1819), so every panel board loses the vermilion identity.
4. **The working moment shows three times** (role label, tool row, working card), against the board's single line.
5. **Needs-you rings cover the whole scope**, not the objects that change (runs-model.js:305). This hits permission, question and needs-hidden.

## Axis scores (IMPL against the board)

| Axis | Score | Weight | Weighted | Verdict |
|---|---|---|---|---|
| Signature moment | 2/5 | 1.5 | 3.0 | The running ring is there; the finish (wipe + solid ring + Made by AI) is missing everywhere |
| Brand prominence (spark as the AI's mark) | 3/5 | 1.0 | 3.0 | Spark is right on the artboard tags, indigo in the panel header |
| Mock fidelity | 3/5 | 1.0 | 3.0 | Real states, but the permission card has no media and the choice rows have no swatches |
| Restraint | 2/5 | 1.5 | 3.0 | Four stacked progress items; five azure tags where the spec has one ring |
| Negative space | 3/5 | 1.0 | 3.0 | Panel density is comparable; the stacking crowds the working state |
| **Specificity gate** | **pass** | — | — | No lorem. The id-shaped chip "post" and the file-named permission title are borderline |

Weighted total: 15.0/30 → **2.5/5**

## What's working
- The dashed spark outline and spark-led tag on the artboard, plus "· N waiting" (overlay.tsx:129, :143).
- The Waiting card and Run on a copy (ai-same-artboard), the Quit dialog, the attach menu and the slash menu.

## Verdict

```json
{
  "agent": "signature-moment-critic",
  "iter": 1,
  "blockers": 1,
  "warnings": 2,
  "aspiration_score": 2.5,
  "axes": {
    "signature_moment": { "score": 2, "weight": 1.5 },
    "brand_prominence": { "score": 3, "weight": 1.0 },
    "mock_fidelity": { "score": 3, "weight": 1.0 },
    "restraint": { "score": 2, "weight": 1.5 },
    "negative_space": { "score": 3, "weight": 1.0 }
  },
  "specificity": "pass",
  "specificity_findings": [],
  "top_blockers": [
    { "category": "aspiration-signature_moment", "line": null, "summary": "signature_moment 2/5 — the finish (Before/After wipe, solid ring, Made by AI) never renders; markDone has no caller", "fix": "Call markDone(touched artboards) on run end (or emit the kind:'ai' action locally) and turn the sweep into the clip-path before/after wipe with pills." },
    { "category": "aspiration-restraint", "line": null, "summary": "restraint 2/5 — the working state stacks role label + tool row + card; needs-you tags every artboard", "fix": "Collapse to the one spark working line; ring only the objects the ask changes." }
  ],
  "opt_out_applied": "palette",
  "passed": false
}
```

```json
{"canvas":"03 AI Chat","critic":"signature-moment-critic","blockers":6,"warnings":16,"verified_ids":["ai-same-artboard-dark","ai-same-artboard-light","ai-quit-dark","ai-quit-light","ai-attach-menu-dark","ai-attach-menu-light","ai-adv-edges-dark","ai-adv-edges-light","ai-advanced-dark","ai-advanced-light","ai-long-pinned-dark","ai-long-pinned-light"]}
```
