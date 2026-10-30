# critic-bar4 — 02 Onboarding — judged on the FINAL (D6, 3d58f57df) merged-tip shots, both themes read for every id

Bar: kg `v2-michal-verified-bar`. Lead decisions honoured: owning board wins (11 Home owns the shelves / Projects list, 05 empty states, 04/14 left panel + toolbar), contract over board, Connect modal without an API-key row (ob-ai-connect, ob-edge-ai-missing), API-key option RESTS in Home's Connect AI sheet (DDR-123, `onboarding/ConnectAiSheet.jsx`), toast dock/top rule, Always-allowed row not built, first-run card once (c8), view-only opens in Preview. Inputs: `critic-bar3.md`, `fix-c7-oboard.md`, D6 pairs (`.scr/pairs/02`), board `02 Onboarding.tsx`. No new shots.

Round-8/D5 changes confirmed in the D6 pairs: the Connect modal's Cancel / Connect are now DS buttons (ghost Cancel, filled blue Connect, visible focus ring on Connect) in both themes (commits 0f5665f41 + 89551df72, `portalToBody` keeps `.maude`); the Settings Connections status lines carry only the state ("Not signed in", "Not connected", "No token") with no repeated description. Both bar3 MUSTs are closed.

## Per id
- ob-first-launch · verified (L+D) · none
- ob-signin-browser · verified (L+D) · none (the browser window + OS "Open Maude?" prompt are outside the app: side row)
- ob-home-new · verified (L+D) · none (the "Signed in…" toast is not in the frame: side row)
- ob-ai-connect · verified (L+D) · none (was MUST in bar3: unstyled native buttons; fixed — ghost Cancel + filled Connect with focus ring, both themes)
- ob-first-draw · unreachable · needs an AI run (piece-by-piece draft, dashed poster, AI cursor, step); verify in e2e
- ob-sig-draw · unreachable · motion study, needs an AI run; verify in e2e
- ob-invite-page · unreachable · web page on cloud.maude.sh, not part of the app
- ob-invite-landed · unreachable · needs a hub project and a second person (Tereza's invite + comment); verify in e2e
- ob-home-team · verified (L+D) · none (Shared with you shelf + Projects list row "not on this Mac yet" instead of Recent canvases / Recent projects shelves: 11 Home owns it; fixture)
- ob-local-name · verified (L+D) · none (Advanced-opened is a side row)
- ob-local-first · verified (L+D) · none (shot is the populated Smoke fixture with the What's new notice up; the "Your canvas is ready." block is 05 es-project-new, verified there)
- ob-local-share · verified (L+D) · none
- ob-local-moved · unreachable · needs a local project actually moved to a hub; verify in e2e
- ob-adv-open · verified (L+D) · none
- ob-adv-sheets · verified (L+D) · none (five sheets present with the board's controls: hub, folder/GitHub, Connect AI, maude command, Figma link + "Advanced · Access token" fold; the Connect AI frame is caught mid-entrance by the harness in both themes, but the same shared sheet is shown settled in ob-ai-connect; sixth sheet "Share › Advanced invite" is a side row)
- ob-settings · verified (L+D) · none (was MUST in bar3: repeated description in the status line; fixed. Connections order cloud, team server, Claude account, Figma, GitHub, AI images; Not signed in General is the unreachable-signed-in side state)
- ob-edge-offline · verified (L+D) · none
- ob-edge-timeout · verified (L+D) · none
- ob-edge-other-mac · verified (L+D) · none (shelves, chip and toast are fixture / 11-owned / side)
- ob-edge-accounts · verified (L+D) · none (account-row labels are profile-label fixture)
- ob-edge-ai-missing · verified (L+D) · none (was MUST in bar3, same fix as ob-ai-connect)
- ob-edge-whats-new · verified (L+D) · none for the main frame (one-line notice, Recent canvases, Shared with you / Projects); the Help flyout is a side row

## Polish list
- ob-first-launch, ob-signin-browser, ob-home-new, ob-adv-open, ob-edge-* · send button reads disabled grey on the placeholder text (board shows it blue); no hairline above "Advanced options" in light; starter chips and placeholder wording (fixture); no window chrome / dot grid in the browser lane
- ob-home-new · avatar "Y" vs "M" (fixture); Projects shelf a little wider than the board's
- ob-local-name · sheet ~10 % narrower than the board; "Location" sits beside the "Advanced" label; tight foot padding; value is the placeholder "Untitled project"
- ob-local-share · "Move to the cloud?" popover about 20 % wider than the board; project name e2e-fixture (fixture)
- ob-local-first · populated Smoke fixture instead of the empty canvas; What's new notice caught in the frame (harness)
- ob-home-team, ob-edge-other-mac · starters not project-themed, chip "a new project", Recent canvases / Recent projects shelves are Shared with you / Projects (11-owned), "Open project…" row solid not dashed (fixture / 11-owned)
- ob-edge-accounts · rows read "you@studio.cz / A new tab" instead of "You · personal / Work · a new tab"; no team badge on the work face; no tab strip behind the sheet
- ob-edge-whats-new · notice text "A new look: the canvas fills the window" vs "in 2.0 — one menu, calmer panels, cloud first" (feed content)
- ob-adv-sheets · Connect AI sheet: Claude row has no radio / selected ring (the API-key option RESTS, DDR-123); mid-entrance capture; Install sheet shows "Not installed" where the board shows "Installed" (fixture); folder sheet opens on "A folder on this Mac" (board shows From GitHub); Figma "Not connected" vs "Figma connected" (fixture)
- ob-settings · Connections status has no coloured dot / toned chip (text carries the state, grey in the signed-out fixture anyway); icons are bare glyphs, not the board's tiles; General carries extra rows owned by other boards (Minimap, Zoom controls, Annotations, Auto-open Inspector, Single-key shortcuts); "Where every old door went" is a board legend, not an app surface; Advanced folds under cloud.maude.sh / GitHub / AI images add rows the board lacks (contract)
- ob-ai-connect, ob-edge-ai-missing · "Advanced · Use an API key instead" row absent (lead decision); panel behind the veil is 04/14-owned

## Side states
- ob-home-new/signed-in-toast · "Signed in. What you make now lives on cloud.maude.sh." (`home-signin-toast`, `signin/SignInToast.jsx`) · reachable (harness dismisses notices before each shot; not shot)
- ob-edge-other-mac/signed-in-toast · "Signed in — your 2 cloud projects are here." · reachable (not shot)
- ob-local-name/advanced-opened · Advanced fold opened with "Location ~/Maude/<name>" and "Choose another folder…" · reachable (not shot opened)
- ob-edge-whats-new/help-flyout · Menu › Help flyout: impl shows only "What's new · 1 new"; board lists Keyboard shortcuts, Help and guides, What's new ●, Take the tour, Watch the intro, How sharing works, Report a bug… · reachable (differs; does not block the main id)
- ob-signin-browser/os-open-prompt · the browser's own "Open Maude?" prompt (and the cloud.maude.sh sign-in page) · unreachable (outside the app)
- ob-adv-sheets/hub-probe · "Reachable — hub 1.4" after Test connection · unreachable (needs a hub)
- ob-adv-sheets/github-list · From GitHub repo list with Private / Public · unreachable (needs a GitHub sign-in)
- ob-adv-sheets/github-invite · Share › Advanced invite by GitHub username sheet · unreachable (needs a hub project)
- ob-settings/signed-in-account · General Account block (You · Signed in, Plan · Free trial, Manage on cloud.maude.sh, account links) and signed-in Connections (Sign out, Change…, Disconnect) · unreachable (needs a cloud sign-in)
