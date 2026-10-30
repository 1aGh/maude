# signature-moment-critic — 02 Onboarding (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/02 Onboarding.tsx` · impl = release v2 client (stage-A frames, `full-size-path.txt`) · opt_out_scope: palette · READ-ONLY_

## TL;DR

**Aspiration (impl vs board): 3.0/5** · Specificity: pass · Verdict: **fix-and-retry**

Home's question and the **sign-in card** are carried. Their edge states nearly match pixel for pixel: waiting, offline, never finished, work invite. Three of the board's moments are not carried:

- **ob-sig-draw** is the canvas's signature artboard: the first draft arrives piece by piece, never a spinner. It has no implementation. There is no colour → picture → words choreography, no per-piece tag, no AI cursor and no one-time "⌘/ Select anything" hint.
- **The Connect sheet** is drawn as a centred modal over a strong veil. The impl squeezes it inline into the AI panel column, with its foot cut and suggestion chips under it.
- **First launch** is "one headline, one obvious button". The impl adds two empty shelves under the card, so the button no longer stands alone.

Two more gaps: Home has no account face and no Home menu, so What's new is unreachable from Home. Settings is a long toggle page, not the calm Account / Plan / Theme card.

Dark: the board is drawn light only (INDEX). The dark impl re-themes cleanly, and every finding repeats unchanged. No dark-only finding.

Not findings (lane / fixture per INDEX): no window chrome or tabs, fixture data, the board's numbered `Callout` markers (board annotations, not UI), the sign-in completion toasts (`signedInToast`, `client/home/home-app.jsx:369`; that path was not run), the project toast "… is your first project · Rename" (`client/v2/create/take-intent.js:46`; Home → project window is a Tauri open), and ob-local-first (a populated Smoke canvas stood in; the fresh empty canvas is compared in 05 es-canvas-ai).

## Per artboard (a "both" row counts once per theme in the totals)

### ob-first-launch — one headline, one obvious button
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Spark + question + prompt + sign-in card (Sign in to cloud.maude.sh · Just a local project · Advanced options) | `ObHome below={<SignInCard/>}` | match | `client/home/home-app.jsx:394` (first-run card) | verified (element) |
| both | Two empty shelves under the card: "Recent canvases — Canvases you open show up here." and "Your projects — No projects on this Mac yet." with ghost cards | nothing below the card ("Everything else waits behind Advanced options") | both shelves | `client/home/home-app.jsx:864-922`, `client/home/Shelves.jsx` | blocker |
| both | Target chip "a project on this Mac" + other starters | "a new project"; A landing page / Three logo ideas / Bring my existing brand | differs | `client/home/HomeAsk.jsx` | warning |
| both | Flat Home surface, no dot field | Canvas dots | none | `client/home/home.css:18` | warning (boards disagree, see 01) |

### ob-signin-browser
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | In-app waiting row ✓. Browser page + OS "Open Maude?" prompt are outside the app | — | — | — | not-a-finding |
| both | The same empty shelves under the card | none | shelves | as ob-first-launch | warning |

### ob-home-new
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No account face top right (signed in) | yellow "M" face + compact search | wide search field only. The face exists only in the Projects group header | `client/home/home-app.jsx:1170` (ProfileGroup), top bar `:1350` | blocker |
| both | Extra "Recent canvases" empty line above "Your projects · cloud.maude.sh — No projects yet." | shelf only | line + shelf | `client/home/home-app.jsx:922` | warning |

### ob-ai-connect — the Connect sheet as a centred modal
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The sheet is inline in the AI panel column (≈235 px). The foot (Cancel / Connect) is cut below the panel edge. No veil over the canvas | centred 440 px window sheet over `<Veil strong/>`, panel dimmed | inline card | `client/v2/ai/NeedsYouSlot.jsx:216-222` (`<ConnectSheet inline>`). The window variant exists (`client/v2/empty/empty-canvas.jsx:85-90` `EmptyConnect`) | blocker |
| both | Suggestion chips ("Same on the other artboards / A bit larger / Check every text size") show under an unconnected sheet | none | chips | `client/v2/ai/Suggest.jsx` strip | warning |

### ob-first-draw
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No dashed build state and no "AI is writing the headline" tag below the artboard. The page appears whole | dashed A4 + spark tag below + "3 of 4 · button next" | whole Desktop at once, "AI is working · Stop" | ring `apps/studio/artboard-activity-overlay.tsx:129` needs leases (`client/v2/ai/runs-model.js:205`); tag fixed `:175` | blocker |
| both | No AI cursor on the artboard | spark cursor at the typing point | none (`apps/studio/editing/ai-point-ring.tsx` is the question ring only) | new | blocker |

### ob-sig-draw — not reachable (the board's signature)
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No choreography (0 s paper + colour, 1 s picture with `--dur-spring`, 3 s words at the cursor, 6 s done) | four-frame film | the agent writes a whole page | none. **Product work:** a draft-progress layer driven by run progress, with ordered reveal and reduced-motion "each piece simply appears" | blocker |
| both | No per-piece tags ("AI is placing the colour / drawing the picture / writing the headline") and no AI cursor | tags + cursor | — | `runs-model.js:175` (fixed tag) | blocker |
| both | No one-time hint "⌘/ Select anything, then ask AI to change it." after the first draft, and no "Made by AI" | tip under the selected A4 | none (no string in `client/`) | new | blocker |

### ob-invite-page — not reachable
| — | The invite is a cloud.maude.sh web page. **Product work:** the hub's invite page (outside the app) | — | — | — | blocker (state not shown) |

### ob-invite-landed
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The Join / Open-as sheets are reached. The landing is not: the camera on the poster, Tereza's cursor, the "Tereza invited you here — her comment is on the poster." pill, her open comment with a reply field | landing | own composer from 01 | **product work:** a hub project + second person in the lane | blocker |

### ob-home-team
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The chip falls back to "a new project" when nothing is local. Starters are generic | "Alligators brand" + A matchday poster / Three reel covers / A sponsors post | "a new project" | `client/home/HomeAsk.jsx` target pick | warning |

### ob-local-name
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The sheet is ~10 % narrower (235 vs 258 px at the same scale). Otherwise close | — | — | `client/home/*` local-project sheet | warning |

### ob-local-share
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | A titled sheet "Share Smoke" with × and an Advanced foot, not the light popover under Share. Copy ✓ | popover, no title row | sheet | `client/v2/share` move-to-cloud sheet | warning |

### ob-local-moved — not reachable
| — | needs the local project actually moved to a hub. **Product work:** a hub in the lane | — | — | — | blocker (state not shown) |

### ob-adv-open / ob-adv-sheets
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both (open) | The five flyout rows and the foot sentence ✓. The flyout is 10 % narrower and sits higher | — | — | `client/home` advanced flyout | warning |
| both (sheets) | First states only (no "Reachable — hub 1.4", repo list, "Installed", "Figma connected"). The Connect AI frame was caught mid-fade | probed states | empty | lane (no probes) | warning |

### ob-settings
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | General is a long toggle page (Minimap, Zoom controls, Annotations, Auto-open Inspector, Single-key shortcuts, Search in pictures…), not the calm card: Account "You · Signed in to cloud.maude.sh", Plan "Free trial · 12 days left", Manage, account links, Theme | 3-group card | full page | `client/v2/settings` (General) | blocker |
| both | "Where every old door went" card | board explainer | — | — | not-a-finding |

### ob-edge-offline / ob-edge-timeout
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both (offline) | Near pixel match: "Offline — Sign-in waits…", "Just a local project" primary. Only the shelves under the card differ | — | shelves | as ob-first-launch | warning |
| both (timeout) | Near pixel match: "Sign-in didn't finish". Shelves under the card | — | shelves | as ob-first-launch | warning |

### ob-edge-other-mac / ob-edge-accounts
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both (other-mac) | The chip says "a new project" although two cloud projects exist | "Studio site" | "a new project" | `client/home/HomeAsk.jsx` target | warning |
| both (accounts) | Account rows lack "personal" / "Work" and a face. The sheet otherwise matches | "You · personal" → "Work · a new tab" | address only | `client/home/InviteSheet.jsx` | warning |

### ob-edge-ai-missing
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Same inline Connect sheet. The team canvas behind should dim under a veil | centred sheet, canvas dimmed | inline | `client/v2/ai/NeedsYouSlot.jsx:216-222` | blocker |

### ob-edge-whats-new
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The one-line notice under the starters ✓ (with ×) | — | — | — | verified (element) |
| both | The Home pill opens no menu, so Menu › Help › What's new ● is unreachable on Home | Home ⌄ → Help flyout with "What's new ●" | plain "Home" pill | `client/home/home-app.jsx` (pill). Project menu: `client/v2/shell/project-pill.jsx` | blocker |

## Root causes (several artboards)

1. **R1: no first-draft choreography layer.** Rings need leases, and tags are fixed "AI is working". There is no AI cursor and no post-draft hint. This hits ob-first-draw and ob-sig-draw (and 01 cf-ai-drafting).
2. **R2: the panel's first send uses the inline ConnectSheet** (`NeedsYouSlot.jsx:217`). The window sheet + veil variant exists, unused there (ob-ai-connect, ob-edge-ai-missing, 05 es-canvas-three).
3. **R3: the first-run Home renders the empty shelves under the sign-in card** (`home-app.jsx:864-922`). The board defers them, and this hits 5 artboards.
4. **R4: Home has no account face and no Home menu.** The top bar is a wide search field (`home-app.jsx:1350`), which breaks ob-home-new and ob-edge-whats-new.
5. **R5: four states need a hub + a second person** (invite page, invite landing, local-moved; 01 cf-busy). No lane exists for them.

## What's working (preserve)

- The sign-in card and all its edge states, word for word: waiting, offline, didn't finish, work-invite sheet.
- The Connect sheet's own content (Claude Pro or Max, Advanced → API key, "Your prompt waits here…"). Only its placement is wrong.
- The Advanced options flyout: five rows and the foot sentence.

## Verdict

```json
{
  "canvas": "02 Onboarding",
  "critic": "signature-moment-critic",
  "agent": "signature-moment-critic",
  "iter": 1,
  "blockers": 26,
  "warnings": 28,
  "aspiration_score": 3.0,
  "axes": {
    "signature_moment": { "score": 3, "weight": 1.5 },
    "brand_prominence": { "score": 3, "weight": 1.0 },
    "mock_fidelity": { "score": 3, "weight": 1.0 },
    "restraint": { "score": 3, "weight": 1.5 },
    "negative_space": { "score": 3, "weight": 1.0 }
  },
  "specificity": "pass",
  "specificity_findings": [],
  "top_blockers": [],
  "opt_out_applied": "palette",
  "passed": false,
  "verified_ids": []
}
```
