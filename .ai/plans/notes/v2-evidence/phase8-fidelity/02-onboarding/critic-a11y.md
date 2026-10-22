# a11y-critic — 02 Onboarding (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/02 Onboarding.tsx` · impl frames `.claude/worktrees/agent-af49de751057c2ee5/.scr/impl-raw/02/` (lossless PNG) · standard: WCAG 2.1 AA. There is no project a11y-rules skill, so the WCAG defaults apply. · opt_out_applied: n/a — a11y enforces at every scope_

**Method and severity** are the same as in `01-create-flow/critic-a11y.md`: contrast from the impl PNG pixels, cross-checked with the token maths; dark SPEC is a host re-theme; each root cause counts once; code-only findings are warnings. Home renders on the maude-v2 ladder (`.maude-v2` at `client/home/home-app.jsx:727`), so its contrast matches the board almost value for value. The canvas frames render on the v1 shell ladder (01 R1).

## Root causes

| # | cause | spec | impl | owner | sev |
|---|---|---|---|---|---|
| RO1 | Signed-in Home has no account control. The board's top-right cluster (count "1" · ⌘K · avatar "M") becomes the search field alone; the account face appears only inside the Projects shelf, as "Y You · you@…". Seen in ob-home-new, ob-home-team, ob-edge-other-mac, ob-edge-accounts and ob-edge-whats-new. | avatar button | absent | `client/home/home-app.jsx:733-745` (top-end), face only at `:1170` | blocker |
| RO3 | The Connect sheet is drawn inline in the AI panel (`role=group`) instead of as a window sheet (`role=dialog aria-modal`, scrim). Its foot sentence is cut mid-line, **Cancel / Connect are out of view**, and the suggestion chips stay over it. Seen in ob-ai-connect, ob-edge-ai-missing and 05 es-canvas-three. A source fix (`e1c8dea26`, `needs-you.css:15-22`) landed after these frames, but `dist/styles.css` has not been rebuilt with it (the `:has(.ai-conn-sheet)` rule is absent), so it needs a re-capture. | centred sheet, 290 px, Cancel · Connect | clipped inline group | `client/v2/ai/NeedsYouSlot.jsx:217-223`, `client/v2/ai/ConnectSheet.jsx:38-45`, `client/v2/ai/needs-you.css:5-22` | blocker |
| RO2 | Home's sheets are `aria-modal` with no focus trap, so Tab can leave into the dimmed Home: Create a local project, the invite sheets, the What's new dialog. Esc does close them (`home-app.jsx:692,718`). AdvSheet uses `useModalFocus` and these do not. Code only. | trapped | not trapped | `client/v2/signin/CreateLocalSheet.jsx:36-41`, `client/home/InviteSheet.jsx`, `client/v2/signin/WhatsNewLine.jsx:37`; compare `client/v2/onboarding/AdvSheet.jsx:14` | warning |
| R3 | The canvas dock's buttons are 32 px where the board has 40 (ob-local-first, ob-local-share, ob-ai-connect, ob-edge-ai-missing; behind ob-settings). | 40 × 40 | 32 × 32 | `apps/studio/toolbars/toolbar-css.ts:48-62` | blocker |
| R4 | The undo / redo / zoom pill is not on canvas frames. | drawn | off by default | `client/v2/shell/menu-runner.js:468` | warning |
| R7 | There is no piece-by-piece AI drafting language on the canvas: dashed placeholders, "AI is writing the headline" tags (`--spark-fg` on spark 5.38), an AI cursor and a "Made by AI" label. ob-first-draw shows the whole artboard appearing at once. | `_kit.css:456-462,481-482` | panel row only (`client/v2/ai/Working.jsx:70` live region) | — | blocker |

## Per artboard

| id | theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|---|
| ob-first-launch | L/D | None in this lens. Sign in is white on azure (4.90 L / 4.75 D, the same as the board), Just a local project 16.4 / 13.4, foot fg-2 5.5+. The prompt has a focus-within ring. The extra shelves are a design finding. | — | — | `client/v2/signin/SignInCard.jsx:106-140` | ✓ |
| ob-signin-browser | L/D | The in-app waiting card matches: pill `role=status`, Cancel, "Open the page again", note `role=alert`. The browser window and the OS "Open Maude?" prompt are outside the app (not app work). | — | — | `client/v2/signin/SignInCard.jsx:120-140` | ✓ |
| ob-home-new | L/D | RO1. The "Signed in. What you make now lives…" toast was not reached because the lane never ran sign-in completion. `SignInToast.jsx` exists. | — | — | — | (root) |
| ob-ai-connect | L/D | RO3. Focus also stays in the composer because the inline group takes no focus, so the one action on screen is not where the keyboard is. | sheet takes focus | group | `client/v2/ai/ConnectSheet.jsx:41` | warning |
| ob-first-draw | L/D | R7. The "Open studio is your first project, on cloud.maude.sh · Rename" toast is unverified: Home → project window is a Tauri open the lane cannot do. | — | — | — | warning |
| ob-sig-draw | L/D | **Unreachable.** This is a motion study (colour → picture → words → done) and the app shows none of it. Product work: per-piece AI placeholders with labels, plus their reduced-motion final frame. | four frames | — | — | blocker |
| ob-invite-page | L/D | **Unreachable.** It is the cloud.maude.sh invite web page, not part of the app; it needs the cloud page to exist before it can be audited. | — | — | cloud site | blocker |
| ob-invite-landed | L/D | Partial. The Join sheet passes: rows fg-2 5.89 / 5.97 and a visible double ring on the focused Join. Landing on Tereza's comment (camera on the poster, her cursor, the "Tereza invited you here" pill, a ready reply field) needs a hub project and a second person. RO2 also applies. | — | sheet only | hub + peer | blocker |
| ob-home-team | L/D | RO1. Recents with faces need the project on this Mac (fixture/lane). | — | — | — | (root) |
| ob-local-name | L/D | Contrast passes: visible `<label>` "Name", hint fg-2 5.82 / 6.60, Create white on #0068b4 5.77 / 5.61, autofocused field with a ring. RO2 applies. | — | — | `client/v2/signin/CreateLocalSheet.jsx:52-68` | (root) |
| ob-local-first | L/D | Partial: a populated canvas, not the empty one (the empty canvas is covered at es-canvas-ai). "Local project" passes (5.77 / 5.86). R3 and R4 apply. | — | — | — | (root) |
| ob-local-share | L/D | The Move-to-cloud sheet passes: body fg-2 5.56 / 5.41, Move to cloud 5.69 L / 6.25 D. R3 applies. | — | — | — | (root) |
| ob-local-moved | L/D | **Unreachable.** It needs the local project actually moved to a hub, after which Share opens on Invite. | — | — | hub | blocker |
| ob-adv-open | L/D | None in this lens. The flyout has five button rows, and Esc closes it and hands focus back to "Advanced options". | — | — | `client/v2/signin/SignInCard.jsx:67-75` | ✓ |
| ob-adv-sheets | L/D | Hub sheet: the disabled Connect keeps the azure fill and dims only the label, because `.home-root .btn--primary` beats `.btn[disabled]`. The DS disabled primary is bg-3 / fg-3. | `_components.css:229` | azure + fg-3 | `client/home/home.css:106-110,767-770` | warning |
| ob-adv-sheets | L/D | Email and Password have an `aria-label` but show only a placeholder as their visible label. The board draws the same, so this is board intent too. | placeholder-label | same | `client/v2/onboarding/HubSheet.jsx:212-231` | warning |
| ob-adv-sheets | L/D | The Connect AI frame was caught mid-fade, so it was not measurable. The GitHub-invite sheet was not covered. The post-probe states (Reachable, Installed, Figma connected) need a real hub, CLI and Figma (lane). | — | — | re-capture | warning |
| ob-settings | L/D | Controls pass: switch knob 5.77 / 5.86, hints 5.56 / 5.41, Figma token field `aria-label` ✓. The "Where every old door went" card is a board explainer. Account shows "Not signed in" (fixture). R3 is behind. | — | — | `client/v2/settings/connections-section.jsx:241-264` | (root) |
| ob-edge-offline | L/D | None in this lens. "Offline" status-warn-text 5.19 L / 7.85 D; the disabled Sign in is distinguishable. | — | — | — | ✓ |
| ob-edge-timeout | L/D | None in this lens. | — | — | — | ✓ |
| ob-edge-other-mac | L/D | RO1. The toast and recents were not reached (lane). | — | — | — | (root) |
| ob-edge-accounts | L/D | RO1 and RO2. The sheet passes: account rows fg-2 5.89 / 5.97, focused Open ringed. The "personal" / "Work" words are a copy finding. | — | — | — | (root) |
| ob-edge-ai-missing | L | RO3. In the browser lane ⌘/ toggled Preview + Stickers instead of Ask AI, so the keyboard route to Ask AI on a selection is unverified. | ⌘/ opens Ask AI | Stickers | `apps/studio/input-router.tsx` | warning |
| ob-edge-ai-missing | D | No impl frame was captured. | — | — | re-capture | (in row above) |
| ob-edge-whats-new | L/D | **The Home pill is a `<span>`, not a menu button**, so Menu › Help › What's new ● is not reachable from Home by keyboard or pointer. | "Home ⌄" opens Menu | static span | `client/home/home-app.jsx:729-732` | blocker |
| ob-edge-whats-new | L/D | The line passes (fg-1 8.33 / 8.66). Its Dismiss × (`aria-label` ✓) is about 16 px wide (0 4 px padding). The board draws no ×. | — | small target | `client/v2/signin/WhatsNewLine.jsx:15-22`, `client/v2/signin/signin.css:356-362` | warning |

## Verdict

```json
{"canvas":"02 Onboarding","critic":"a11y-critic","blockers":9,"warnings":9,"verified_ids":["ob-first-launch·light","ob-first-launch·dark","ob-signin-browser·light","ob-signin-browser·dark","ob-adv-open·light","ob-adv-open·dark","ob-edge-offline·light","ob-edge-offline·dark","ob-edge-timeout·light","ob-edge-timeout·dark"],"opt_out_applied":"n/a — a11y enforces at every scope"}
```
