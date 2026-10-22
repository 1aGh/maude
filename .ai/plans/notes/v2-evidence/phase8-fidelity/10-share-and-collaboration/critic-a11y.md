# a11y-critic — 10 Share and Collaboration (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/10 Share and Collaboration.tsx` · impl = release client (stage A pairs) · standard: WCAG 2.1 AA (no project a11y-rules skill exists; CONTRACT/README carry only the token a11y notes)_

Method: every pair (dark + light) read full-size; contrast **measured on impl pixels** from the raw 1440×860 frames (`.scr/impl/10-share-and-collaboration/`, darkest/lightest glyph pixel vs the dominant background of a tight crop, sRGB WCAG formula); spec values from the board pixels and the v2 token math (`colors_and_type.css`). Roles/labels/focus read from the impl JSX/CSS. No server was booted. "(fixture)" rows of the INDEX are not findings.

Global facts that hold for every artboard below:
- The shell paints on the **v1 indigo ladder** (`.maude[data-theme]` → `client/styles/1-tokens-maude.css:21-48,138-159`), not the v2 azure one. Measured: Share/primary buttons dark #698fff with dark ink 6.2:1, light #3a5ad7 with white 5.7:1 (spec azure + white 4.75 / 4.9). Text: fg-1 8.7:1 / 8.9:1, fg-2 5.4:1 / 5.6:1 on bg-2. **All measured body/meta text passes 4.5:1 in both themes** unless a row says otherwise.
- Focus: impl buttons get the shared ring `client/styles/3-shell-maude.css:4880-4884` (`outline 2px var(--accent)` + 5px tint) — indigo #698fff on #191e24 ≈ 6:1, #3a5ad7 on white ≈ 5.8:1, passes 3:1. Spec uses `--focus-ring` (azure, lighter in dark). Hue differs, contrast holds → not a finding.
- Reduced motion: every v2 share/comments/access/sync animation runs on `--dur-*` tokens which `1-tokens-maude.css:313-321` collapses to 1 ms. Passes.
- Target size: impl icon buttons 24×24 (`share.css:53-57`, `.v2sh-av`), conflict/composer buttons ~20 px tall; the board draws the same sizes. WCAG 2.1 AA has no target-size criterion (2.5.5 is AAA); noted once here, not per row.

## co-share-sheet

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Selected scope segment loses its 3:1 indicator | `.k-seg-b[aria-pressed=true]` bg-2 + `inset 0 0 0 1px var(--accent)` ring (`_kit.css:229`) | bg-3 fill only: #22272d vs track #12161b ≈ 1.25:1 dark, #eef0f3 vs #fff ≈ 1.13:1 light, so the choice shows mostly through text weight (fails 1.4.11 for the selected state) | `client/v2/share/share.css:99-103` (does not use the kit `.seg`, `3-kit-maude-v2.css:94-102`, which has the ring) | blocker |
| dark · light | Avatars lose identity colour | tone-coloured faces (yellow/blue/green/lilac) with object ink | neutral grey disc for everyone (bg-3, fg-1 letter 7.8:1) | `client/v2/share/people-list.jsx:53` + `share.css:160-166` | warning (decorative, aria-hidden) |
| dark · light | Role select is a native `<select>` with an OS chevron, not the kit InSelect | kit select (bg-3 well, drawn chevron) | native control. Labelled (`aria-label="What they can do"`), so it is accessible | `client/v2/share/invite-row.jsx:45-57` | warning |
| dark · light | Team row "Everyone in Alligators brand · 9 people" and "+ 9 in …" count missing | drawn | absent | `people-list.jsx` (no team row) | blocker (missing state) |
| dark · light | Link-row subline wording | "Can view" (fg-2) | "Opens it for people who already have access" (fg-2, 5.4/5.6:1) | `link-row.jsx:18-30` | — (copy, other critic) |

Labels: email `aria-label`, select `aria-label`, role buttons `aria-haspopup="menu"` + `aria-label="<name>: <role>. Change"`, close `aria-label`, scope `role=group` + `aria-pressed`. Good.

## co-share-roles

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Role menu is cut off by the sheet: "Make owner" and "Remove from …" are below the visible edge (the separator shows at y≈436, then the sheet clips) | full menu, 6 rows, floats over the canvas | `.v2sh-menu` is `position:absolute` inside `.v2sh-sheet{overflow:auto}`, so it scrolls inside the sheet instead of overlaying it. A mouse user cannot see the owner and danger rows | `share.css:19` (overflow) + `share.css:224-229` (menu) | blocker |
| dark · light | Focused and checked rows look the same | checked row: accent check + soft tint | `.v2sh-mi:focus-visible` and `[aria-checked=true]` share bg-3 (`share.css:251-254`); the global outline ring still separates focus | `share.css:251-254` | warning |
| dark · light | Description text | fg-2 | fg-2 5.4:1 / 5.6:1, 4.85 / 5.05 on bg-3 | — | — |

Keyboard: `role=menu` + `menuitemradio`, focus to the checked item, ↑↓/Home/End/Tab (`role-menu.jsx:24-57`). Good.

## co-browser-view

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | No project / canvas pill top-left for a viewer; only the logo plus a "Previewing Print · esc" pill | "Alligators brand / Combine-kampan" pill | missing, so the viewer cannot see which project they are in | viewer chrome (`client/v2/preview/preview.css:25-40` pbar replaces it) | blocker |
| dark · light | "Can view" word is dimmer | fg-1 8.8:1 | fg-2 5.15:1 dark / 4.91:1 light | share cluster host `client/v2/shell/share-cluster-host.jsx` | warning (passes) |
| dark · light | Peer faces / cursors (Jonas, Tereza tags) | drawn | none (no peers in the lane) | — | (fixture) |

"Ask to edit" 6.25 / 5.69:1, "Open in the Mac app" 15.9 / 17.1:1. Pass.

## co-presence (partially reachable)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Face menu not reachable (one local user); in code, `role="menu"` has no arrow-key roving and no focus-on-open (only Esc, `faces.jsx:32-42`) | menu with Follow / Go to / Tereza's AI row / Bring everyone | menu exists, but its ARIA pattern is incomplete. No "<name>'s AI" row in the menu | `client/v2/presence/faces.jsx:101-150` | blocker (keyboard: a menu role you cannot arrow through) |
| dark · light | AI work tags ("AI is making it greener", "Tereza's AI · translating") | spark fill + dark ink 6.4 / 5.4:1 | not reachable | needs a hub + a second peer running AI | blocker (state missing) |
| dark · light | Cluster word "Local project" | — | fg-2 5.86 / 5.77:1 | — | — |

Reachable by: a hub-backed lane with a second presence peer (a scripted y-websocket peer).

## co-follow · co-bring · co-spotlight · co-twelve — **unreachable**
Need ≥1 / ≥2 / 12 live presence peers on a hub. Product work: a peer-simulator fixture for the presence channel (fake awareness states over the hub socket), so Follow / Bring / Spotlight / 12-face overflow can be driven. Code exists in `client/v2/presence/faces.jsx` and `client/v2/present/follow-view.jsx`, but it is unverified in this lens (the board's glide is spring motion, which also needs a reduced-motion check once reachable). 4 artboards × 2 themes = blockers (state does not exist in the lane).

## co-mention-notify — **unreachable**
OS banner + Dock badge + e-mail, so it cannot be shot in a browser lane. Needs the desktop e2e harness (`apps/desktop/e2e`) plus a mail sink. Blocker (state not verifiable).

## co-comment-thread

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Comments panel has no close button | × top-right of the panel | `onClose` is never passed, so `comments-panel.jsx:222` renders no button. No visible way out except the toolbar toggle | `client/hooks/use-palette-and-panels.jsx:877-895` | blocker |
| dark · light | Mention picker ("Tereza · Can edit") and the thread with replies + Resolve | drawn | not shown (no other authors; "@Te" did not open the picker) | — | blocker (state missing; needs a 2nd author in the fixture) |
| dark · light | Filter "tabs" are `role=tablist/tab` without arrow-key roving or a tabpanel | segmented filter | each tab is a Tab stop; ARIA pattern incomplete | `comments-panel.jsx:235-247` | warning |
| dark · light | Selected comment row on the board fails contrast (board defect) | meta "2 h ago · 1 reply" fg-2 on accent-soft = **4.38:1 dark / 4.01:1 light** | impl has no selected-row tint | board `.design/ui/v2/10 Share and Collaboration.tsx` comments card (co-cm row) | warning (spec-side) |
| dark · light | Author shown as "?" avatar, "Smoke" | coloured face, name | fg-2 author 5.0 / 4.77:1 | — | (fixture) |

Pin "1": dark ink on #698fff 6.4:1, white on #3a5ad7 5.7:1. Pass.

## co-comment-video (partial)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Timeline strip with comment pins and "2 comments on this video" missing under the clip | timeline + T/J pins (keyboard-reachable markers) | composer only | timeline comment markers (`client/v2/timeline/`) not rendered for comments in this state | blocker (state missing) |
| dark · light | Placeholder contrast is better in impl than on the board (board defect) | "Reply…" fg-3 **2.29:1 dark / 2.37:1 light** (fails 1.4.3) | "Add a comment — @ mentions someone" fg-1 9.96 / 8.58:1 | board composer uses `--fg-3` for the placeholder | warning (spec-side) |
| dark · light | Send button disabled while empty | — | 2.4 / 2.2:1 (disabled, exempt; it is distinguishable) | — | — |

## co-comment-print (partial)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark | Selection size tag "422 × 584" fails contrast | (not on the board; board shows "Bleed 3 mm · trim · safe margin 5 mm" in fg-2, 7.3:1) | **white on #698fff = 3.01:1**, 10 px (needs 4.5:1). The name chip beside it uses dark ink (6.25:1) | `apps/studio/inspect-overlay.tsx:36-41` (`color:#ffffff` hard-coded over `--maude-hud-accent`) | blocker |
| light | same tag | — | white on #3a5ad7 5.80:1 | same | — |
| dark · light | Print guides (bleed/trim/safe) overlay and the existing Jonas thread | drawn | none on the artboard | print-guide overlay | blocker (state missing) |

## co-sync-offline

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Per-row "not sent" tags and the queued-comment line "Queued — sends when this Mac is online." | fg-2 5.2–6.1:1, warn-text 7.85 / 5.19:1 | none, so offline status shows only in the cluster + foot | `client/v2/canvases/canvases-panel.jsx` row slots (no `not sent` sub) | blocker (state missing) |
| dark · light | Invite tooltip "Invites send when this Mac is online." | inverted tooltip 16.9:1 | absent | share cluster | blocker (state missing) |
| dark · light | Foot tone | fg-2 grey 6.6 / 5.8:1 | warn-text 9.6 / 6.16:1 | `client/v2/sync-states/offline-foot.jsx` | warning (passes) |

Cluster "Offline — kept on this Mac" 9.6 / 6.16:1. Pass.

## co-sync-back

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Per-row "sending" tags, "Tereza changed this · 09:15" tag, "2 versions" chip | 6.6 / 5.8:1, 7.7 / 10.5:1, 7.85 / 5.19:1 | absent | canvases row slots + canvas tags | blocker (state missing) |
| dark · light | Toast bottom-centre, no "Show" | top banner with "Show" (accent-text 6.8 / 6.2:1) | Show appears only when a conflict waits (`back-online.jsx:30-45`), and none was faked | — | (fixture) |

Toast is a sonner live region with a labelled dismiss button; it pauses on hover/focus (`notifications.tsx:126-131, 280-290`). Pass.

## co-conflict

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Version history card ("Restore" ×2, ⌥⌘H) beside the conflict is missing, so its Restore controls are not reachable | drawn | absent | `client/v2/sync-states/conflict-card.jsx` (no history pairing) | blocker |
| dark · light | The two versions are plain text wells, not stickies on the canvas | yellow stickies with object ink | `p.sy-sticky` on bg-2 (fg-0 14.7 / 16.5:1) | `conflict-card.jsx:130-139` | warning |
| dark · light | Keep buttons are outlined, not filled pills; the border is ≈1.7:1 against the card | bg-3 filled pills | `btn--sm` outlined. The text label identifies them, so 1.4.11 is not strictly required | `conflict-card.jsx` / kit `.btn--sm` | warning |

Card is `role=…` with `aria-label={card.title}`; close labelled. Hint 5.86 / 5.77:1, "or" 5.2 / 5.0:1.

## co-trashed

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Ghost row name fails contrast | fg-2 on the selected tint, 5.18 / 4.87:1 | `.cv-row.is-dim .cv-name{opacity:.55}`, measured **3.64:1 dark / 2.83:1 light** | `client/v2/canvases/canvases.css:154-157` | blocker |
| dark · light | Zoom readout "100%" overlaps the left panel's project switcher ("ligators brand") | zoom chip lives left of the toolbar, panel unobscured | `.st-zoomonly` fixed at left 16 / bottom 16, z 30, whatever the panel state | `client/v2/preview/preview.css:110-114` | blocker |
| dark · light | Banner position: lower, overlapping the artboard label | top-centre | — | `client/v2/access/trashed-banner.jsx` | warning |

Banner sub 5.86 / 5.77:1; Restore 6.25 / 5.80:1.

## co-local-cloud

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Extra heading "Share Smoke" above the question; dialog name ≠ the question; both are `<p>`, no heading semantics | one heading "Move … to the cloud?" | `aria-label={view.title}` = "Share Smoke"; question in `<p className="v2sh-move-t">` | `share-sheet.jsx:366-376`, `move-to-cloud.jsx:34` | warning |
| dark · light | Body tone | fg-1 | fg-2 5.4 / 5.6:1 | `move-to-cloud.jsx:35` | warning (passes) |
| dark · light | Cancel is a ghost text button | bg-3 filled | ghost (8.7 / 8.9:1) | `move-to-cloud.jsx:45` | warning |

## co-ask-edit (partial)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | View-only tip ("You can look at …, not change it.") not triggered; owner-side "Ask to edit waits at the top of Share" card absent | inverted tip 2 lines | none in frame | `apps/studio/view-only-gesture.tsx` (needs an in-canvas drag message in the lane) | blocker (state not shown) |
| dark · light | No project pill for the viewer (same as co-browser-view) | pill | missing | preview chrome | blocker |

## co-access-ends (middle frame only)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Access card is `role="alertdialog"` with no `aria-modal`, no `aria-describedby`, no focus moved to Back to Home, and the dimmed shell behind is not `inert`. Tab walks into dead controls under the scrim | modal card, one way on | as described | `client/v2/access/access-card.jsx:11-30` | blocker (keyboard) |
| dark · light | Back to Home has no home glyph; card type smaller than the board (raw frame: card ≈340 px wide, the same as the spec; the pair crop is scaled, so the INDEX's "≈210 px" is a crop artefact) | filled azure + home icon | filled indigo, no icon; 6.26 / 5.69:1 | `access-card.jsx:21-28` | warning |
| dark · light | Zoom chip again overlaps the panel foot ("100% inced") | — | same root cause as co-trashed | `preview.css:110-114` | blocker |
| dark · light | Left "Remove Lukáš?" confirm and right link-off card not shot | drawn | not reached | — | blocker (state not shot; reachable via owner role + link API fake) |

Card title 14.7 / 16.5:1, body 8.7 / 8.9:1. The dimmed shell measures 1.7–2.8:1, which is fine because it is meant to be inert (once it is).

## co-share-advanced (partial)

| id · theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark · light | Link-rule selects show no chevron (Who can open / Role / Expires / New people join as), so they read as static values | kit select with a chevron | `<select className="input v2sh-pick">`: the `.input` recipe sets `appearance:none` (`3-kit-maude-v2.css:152-166`) and draws no chevron | `client/v2/share/share-advanced.jsx:87-89` | blocker |
| dark · light | Role matrix column + "Where it syncs" rows (Hub, Last synced, the Diagnostics pointer) not shown | 3 groups | partly | needs owner + links caps in the fake | blocker (state missing) |
| dark · light | Disabled "Role" select | — | dimmer, distinguishable (exempt) | `share-advanced.jsx:250` | — |

Labels: every row is a real `<label htmlFor>`; copy buttons `aria-label="Copy …"`. Good.

## Root causes (hit several artboards)
1. **Hand-rolled controls skip the kit's a11y affordances.** The share segment drops the accent ring (`share.css:99`), the advanced selects use `.input` with no chevron (`share-advanced.jsx:87`), and the role select is native. The kit `.seg` / `.select` already carry both.
2. **The zoom-only island ignores the left panel.** `preview.css:110-114` pins it bottom-left over the panel's project switcher in every Preview/Viewer frame with the panel open (co-trashed, co-access-ends).
3. **Dimming by opacity drops text below 4.5:1.** `canvases.css:154-157` (0.55) gives ghost rows 2.8–3.6:1. Dim the thumb and badges, keep the name on fg-2.
4. **Overlays clipped by a scrolling parent.** The role menu lives inside the `overflow:auto` sheet (`share.css:19`).
5. **Hard-coded white ink on the HUD accent.** `inspect-overlay.tsx:41`: 3.0:1 on the dark indigo.
6. **Modal-ish surfaces without the full dialog contract.** The access card (`access-card.jsx:13`) has no modal, focus or inert. The face menu (`faces.jsx:101`) and comment filter tablist have no roving keys.
7. **Collaboration states need peers the lane cannot fake.** 5 artboards plus half of co-presence/co-comment-thread are unverifiable until a scripted presence peer exists.
8. Shell on the v1 indigo token ladder: contrast holds everywhere it was measured, but every accent hue and focus-ring colour differs from the board.

```json
{"canvas":"10 Share and Collaboration","critic":"a11y-critic","blockers":57,"warnings":30,"verified_ids":[]}
```
_Blocker count = per artboard × theme rows marked blocker (unreachable artboards count 2 each: co-follow, co-bring, co-spotlight, co-twelve, co-mention-notify = 10). No artboard × theme is free of a difference in this lens; co-browser-view and co-sync-back come closest (their text contrast is all ≥ AA)._
