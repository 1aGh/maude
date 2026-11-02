# signature-moment-critic — 10 Share and Collaboration (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/10 Share and Collaboration.tsx` · impl = release client (G4 pairs, 15 paired ids × dark/light, 5 unreachable) · opt_out_applied: palette_

Lens: the board's signature moments and craft. The question for each one: does the impl carry it, or something plainer? I read every pair (dark + light) and cropped the full-size PNGs for the share sheet, role menu, cluster, conflict card, trash banner, access card and dock. **Theme column:** "both" means the difference shows the same way in dark and light, and it is counted once. Fixture differences (white demo boards, one local user, "Print"/"Smoke" names) are not findings.

## TL;DR

**Aspiration (impl vs board): 2.9/5** · Specificity: pass · Verdict: **divergent**

The impl has every *word* on the board. It drops most of the *craft*: faces in the people's colours, the sticky look in the conflict, the chunky colour dock, the azure accent and the borderless v2 buttons. What's left reads as a correct but plain v1-styled shell under v2 copy.

| Axis | Score | Weight | Weighted | Verdict |
|---|---|---|---|---|
| Signature moment | 2/5 | 1.5 | 3.0 | The conflict stickies come out as grey boxes. The share-sheet faces are grey initials. Presence, Follow and Bring can't be checked or reached. |
| Brand prominence | 3/5 | 1.0 | 3.0 | The pill is there on edit frames. The viewer/Preview frames fold it to the mark. The accent is v1 periwinkle (hue 268), not v2 azure (238). |
| Mock fidelity | 3/5 | 1.0 | 3.0 | Real app throughout. The native `<select>`s and plain text boxes stand in for kit controls. |
| Restraint | 3/5 | 1.5 | 4.5 | One filled CTA per screen is kept. Disabled primaries draw accent outlines, so every sheet carries extra accent rings. |
| Negative space | 4/5 | 1.0 | 4.0 | Sheets and cards breathe. The Comments panel is a full-height rail, not a floating card. |
| Specificity gate | pass | — | — | No placeholder strings (fixture names are data). |

Weighted 17.5/30 → **2.9/5**

## Per-artboard findings

### co-share-sheet
| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Faces are grey initials, not the person's tone | `Avatar who` → `.k-av--sky/green/lilac/yellow` (`_kit.css:116-119`) | `.v2sh-av` is `--bg-3`/`--fg-1` for everyone | `client/v2/share/people-list.jsx:51-53` + `share.css:160-170` (the tone helper `presence/tones.ts toneFor` is not used) | blocker |
| both | Team row "Everyone in Alligators brand · 9 people · change it in Whole project" and "+ 9 in Alligators brand" are missing | `ShareSheet rows` team row, `rowsTitle` aside | absent | `share/people-list.jsx` (no team row model) | blocker |
| both | Role select is a native `<select>` with an OS chevron | `InSelect` (kit tokened select) | `<select className="v2sh-inv-role">` | `share/invite-row.jsx:44-55`, `share.css:115-124` | blocker |
| both | Scope segment: the pressed half has no accent ring | `.k-seg-b[aria-pressed]` bg-2 + shadow-sm + `inset 0 0 0 1px var(--accent)` (`_kit.css:229`) | `.v2sh-seg-b[aria-pressed]` bg-3 only | `share.css:99-103` | warning |
| both | Link row has no link-glyph chip; the subline is different copy | `co-link-ic` + "Can view" | no icon; "Opens it for people who already have access" | `share/link-row.jsx:17-33` | warning |
| both | Invite (empty field) shows as an accent outline, not a muted fill | v2 `.btn[disabled]` keeps the bg-3 fill (`_components.css:66`) | `.maude .btn:disabled` bg-1 + accent border | `styles/4-components-maude.css:43-47` | warning |
| both | Role cell chevron is a text "⌄" | `Icon chevron 12` | literal `⌄` | `share/people-list.jsx:89-91` | warning |

### co-share-roles
| both | **The role menu is cut off by the sheet**: "Make owner" and "Remove from …" fall below the clip | menu overflows the sheet (`co-share-roles`) | `.v2sh-menu` is absolute inside `.v2sh-sheet { overflow:auto }` | `share.css:18-19` + `share.css:226-236` | blocker |
| both | Menu chrome is otherwise close (check, two-line rows) | — | — | — | ok |

### co-browser-view
| both | Project pill folded to the mark; a "Previewing Print · esc for Viewing" pill sits top-centre | full `ProjectPill` "Alligators brand / Combine-kampan" + cluster `mode="preview"`, no centre pill (board line 541-542) | `folded={previewing}` | `client/app.jsx:1966` (S3.9 rule from 04 md-preview, so the two boards disagree) | blocker (board conflict, needs a call) |
| both | Faces stack (T, J) before "Can view" missing | 2 faces | none | fixture (no peers) | — |
| both | Accent: "Ask to edit" is rgb(105,143,255), the spec is rgb(0,119,194) | `--accent: oklch(0.53 0.175 238)` | `oklch(0.68 0.18 268)` (v1 maude ladder) | `styles/1-tokens-maude.css:41,154` | blocker (root cause R1) |

### co-presence
| both | Own face reads "YO" (two letters) in a dark disc with a yellow ring | single initial on a tone fill | `f.initials` | `v2/presence/faces.jsx:235-241` | warning |
| both | Other faces, the "+4" face, the face menu (Follow / Go to / their AI / Bring everyone here), cursors with name tags, the "AI is making it greener" spark tag | — | not reachable (one local user, no hub peer) | product: needs a hub + 2nd peer in the lane | finding: unreachable |
| both | Comments button shows in the cluster (the spec's presence cluster has none) | `comments` off | comment icon | `v2/shell/share-cluster.jsx` | warning |

### co-follow · co-bring · co-spotlight · co-twelve
Unreachable: they need ≥2 live peers on a hub. The board marks co-bring as **the** signature moment (cursor wakes, yellow frame corners, "Everyone here is following you" pill). It can't be judged until a two-peer lane exists. **Finding: the state doesn't exist in any lane yet.**

### co-mention-notify
Unreachable (OS banner + e-mail). Native lane needed.

### co-comment-thread
| both | Comments panel is a full-height right rail; the spec is a floating island card at the left | `CommentsPanel` `.island co-cm` floats top-left | edge-docked rail | `v2/comments/comments-panel.jsx:218` + `comments.css` | blocker |
| both | Thread popover (Jonas + Tereza replies, Resolve, mention suggestion "Tereza · Can edit") not shown | popover under pin | pin only | lane: mention picker didn't open / no other authors | unverified |
| both | **Preview dock is the thin v1 tool palette**: 32 px buttons, monochrome line glyphs | `Toolbar mode="annotate"`: 48 px `k-ad-b`, 22 px glyphs, yellow sticky + coral pen underline + yellow emoji (`_kit.css:297-299`) | `.dc-tool-palette button {width:32px;height:32px}` | `apps/studio/toolbars/toolbar-css.ts:48-60` | blocker (root cause R3; topic owner 15 Annotations) |
| both | "Previewing Smoke · esc to edit" centre pill (not on the board) | — | present | `app.jsx` preview pill | warning |

### co-comment-video
| both | Timeline strip with comment markers (T at 0:12, J at 0:21, "2 comments on this video") not in the frame | `CommentTimeline` | no timeline open | `v2/comments/use-comments-shell.jsx:133` (`commentMarks` exists) | unverified (lane didn't open timeline) |
| both | The "at 0:00" time chip on the composer is there | — | ✓ | — | ok |

### co-comment-print
| both | No trim / safe guides on the print artboard | `.co-pg-trim` / `.co-pg-safe` | none in frame | `apps/studio/print-overlay-content.tsx` (guides toggle off in lane) | warning |
| both | Anchor chip in mm ("47 mm from the left · 70 mm from the top") present, the spec words "above the trim" differ | "14 mm from the left · 2 mm above the trim" | edge-relative words missing | comment anchor words | warning |

### co-sync-offline
| both | Invite tooltip "Invites send when this Mac is online.", queued comment, per-row "not sent" labels missing | `Tooltip`, queued `Msg`, `DRESY_FOLDERS("offline")` | none | `v2/sync-states/offline-foot.jsx` (only foot) | blocker |
| both | Status word in the cluster is right ("Offline — kept on this Mac", warn tone) | — | ✓ | — | ok |

### co-sync-back
| both | Banner: the spec is a top-centre island with "one sticky needs a look · Show"; the impl is a bottom toast "Back online. Your changes are going up." with a left accent rule | `.k-toast--top` pill | sonner card `border-left: 3px solid var(--accent)` | `apps/studio/notifications.tsx:224-225` + `v2/sync-states/back-online.jsx` | blocker (root cause R4) |
| both | "Tereza changed this · 09:15" tag and per-row "sending" tags missing | `co-change` | none | sync-states | warning |

### co-conflict — the signature moment of the sync section
| both | **The two versions are plain dark text boxes, not yellow stickies** | `<Sticky color="yellow">` (`--object-yellow`) | `.sy-sticky { background: var(--sticky-yellow, var(--bg-2)) }`. `--sticky-yellow` is defined nowhere, so it falls back to bg-2 | `v2/sync-states/sync-states.css:95` | blocker |
| both | Author line missing its avatar + time ("Jonas · today 7:55 · his Mac") | `Avatar` + time | "Jonas's" text only | `sync-states-model.js:107-109`, `conflict-card.jsx:132-138` | blocker |
| both | Card floats as a top popover over the canvas; the spec places the pair on the canvas under the sticky | `.co-twin` at the sticky | `.sy-card { position:fixed; top:… }` | `sync-states.css:7-13` | warning |
| both | Version-history side card (3 rows, Restore, ⌥⌘H) missing | `co-vh` island | absent | not built | blocker |
| both | "Keep both" has no duplicate glyph; buttons are v1 bordered | `Icon duplicate` | text | `conflict-card.jsx:101` | warning |

### co-trashed
| both | Banner stacks under the "Previewing" pill (second row) instead of owning the top centre | banner top-centre | `.v2ac-banner top:56px` | `v2/access/access.css:101-110` | warning |
| both | Trash glyph is bare, not in a round chip | round bg-3 chip | bare glyph | `v2/access/trashed-banner.jsx` | warning |
| both | Ghost row "In the trash · open here" is present but dim and tiny | readable sub-row | `fg-3` xs | `v2/canvases/canvases-panel.jsx` | warning |

### co-local-cloud
| both | Two titles stacked: "Share Smoke" header, then "Move … to the cloud?" | the question **is** the title | `v2sh-t` header + `v2sh-move-t` | `share/share-sheet.jsx:375` + `share/move-to-cloud.jsx:34` | blocker |
| both | Advanced fold shows under the offer (not on the board) | none | `AdvancedFold` | `share-sheet.jsx` | warning |

### co-ask-edit
| both | The dark view-only tip by the cursor ("You can look at Combine-kampan, not change it.") isn't in the frame | `Tooltip` | not triggered in the lane | `apps/studio/view-only-gesture.tsx` | unverified |
| both | Owner-side "Ask to edit waits at the top of Share" card | — | not shot | share-sheet `request` slot | unverified |

### co-access-ends
| both | Card craft is plainer: padding space-4 vs space-5, a 28 px square lock chip vs a 36 px round one, title at body size vs `--type-md` semibold, no home glyph on Back to Home | `.co-card*` (`10 … .css:260-264`) | `.v2ac-card*` | `v2/access/access.css:68-98`, `access-card.jsx:22-28` | blocker |
| both | Card sits centred; the spec sets it low so the dimmed work shows above | `.co-card--low` (`… .css:381`) | the class is applied, but `.v2ac-card--low` has no rule | `access/access.css` (missing rule) + `access-card.jsx:13` | warning |
| both | Width: the INDEX "≈210 vs 340 px" is a crop-scale artefact. The real width is 340 px in both. | 340 | 340 | — | not-a-finding |

### co-share-advanced
| both | Link-rule selects have no chevrons and vary in width (Team only wide, Never narrow) | fixed `InSelect` with chevron | bare `<select>` styled as a chip | `share/share-advanced.jsx:87` | blocker |
| both | App link / This Mac lines sit in grey wells with a "Copy" word; the spec has inline right-aligned mono + a copy glyph | `ARow mono copy` | well + text button | `share-advanced.jsx:55-75` | warning |
| both | Row keys in fg-2 grey (spec fg-1) | `.co-arow span` | fg-2 | `share.css` advanced rows | warning |

## Root causes that hit several artboards

1. **R1 — the shell runs the v1 maude ladder.** `--accent` is `oklch(0.68 0.18 268)` dark / `0.52 0.195 268` light (`client/styles/1-tokens-maude.css:41,154`). The board's azure is `0.53 0.175 238`. `1-tokens-maude-v2-shell.css` is additive and "never overrides a shell token", per the decision "Gate B a11y: --accent-text in shell scope" (rejected: mounting `.maude-v2` on the shell). This shows on every primary, focus ring, pressed segment and brand mark.
2. **R2 — buttons are v1 `.maude .btn`**: 1 px border, bg-2, radius-sm, weight 500 (`styles/4-components-maude.css:12-60`). The v2 `.btn` is borderless, bg-3, radius-md, semibold, 32 px (`maude-v2/preview/_components.css:44-70`). So every Cancel / Copy link / Keep yours is outlined, and every disabled primary turns into an accent ring.
3. **R3 — the dock is the v1 `dc-tool-palette`** (32 px, monochrome; `toolbars/toolbar-css.ts:48-60`). The board's chunky colour dock (48 px Preview buttons, yellow sticky, coral pen) is gone from every frame.
4. **R4 — toasts are sonner cards with a 3 px accent left rule** (`apps/studio/notifications.tsx:224-225`), not the kit's one-line island pill `.k-toast` (`_kit.tsx`/`_kit.css:606-625`).
5. **R5 — people have no colour outside the cluster.** `presence/tones.ts toneFor` drives the cluster faces but not the share sheet, the conflict authors or version rows.
6. **R6 — no two-peer lane.** Presence, follow, bring, spotlight and twelve can't be reached, and those are the board's headline moments.

## What's working (keep through any fix)
- Every contract sentence lands verbatim: the conflict, trash, access, offline and back-online words.
- The cluster status words and the warn tone for Offline.
- Comment time/mm anchors.
- The Share sheet is in the right order: Invite first, people, link second, then Advanced.

## Verdict

```json
{"canvas":"10 Share and Collaboration","critic":"signature-moment-critic","blockers":17,"warnings":19,"verified_ids":[],
 "aspiration_score":2.9,"axes":{"signature_moment":{"score":2,"weight":1.5},"brand_prominence":{"score":3,"weight":1.0},"mock_fidelity":{"score":3,"weight":1.0},"restraint":{"score":3,"weight":1.5},"negative_space":{"score":4,"weight":1.0}},
 "specificity":"pass","specificity_findings":[],"opt_out_applied":"palette","passed":false,
 "unreachable":["co-follow","co-bring","co-spotlight","co-twelve","co-mention-notify"]}
```
