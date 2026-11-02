# critic-bar3 — 02 Onboarding — re-evaluated on the FINAL (D5, e37e7d82a) merged-tip shots, both themes read for every id

Bar: v2-michal-verified-bar. Lead decisions honoured: owning board wins (11 Home, 05 empty states, 04/14 left panel + toolbar), contract over board, Connect modal without an API-key row (ob-ai-connect), toast dock/top rule, API-key option RESTS in Home's Connect AI sheet (DDR-123 guardrail), Always-allowed row not built. No new shots; judged from `.scr/impl-raw/02` + `spec-raw/02` of the D5 worktree.

## Per id
- ob-first-launch · verified · none
- ob-signin-browser · verified · none (browser window + OS "Open Maude?" prompt are outside the app)
- ob-home-new · verified · none (the "Signed in…" toast is not in the frame: side row)
- ob-ai-connect · differs · MUST: Cancel / Connect render as unstyled NATIVE buttons (system font, grey bevel, no primary fill, light + dark). `ConnectModal` portals the sheet into `document.body`, outside `.maude`, and every `.btn` / `.btn--primary` rule is `.maude .btn…` (`styles/3-kit-maude-v2.css` L503-L548), so the DS button never applies. Fails "DS tokens, nothing hard-coded" and the board's filled blue Connect (`apps/studio/client/v2/ai/ConnectSheet.jsx` ConnectModal)
- ob-first-draw · unreachable · needs an AI run (piece-by-piece draft, dashed poster, AI cursor, "3 of 4" step); verify in e2e
- ob-sig-draw · unreachable · motion study, needs an AI run
- ob-invite-page · unreachable · web page on cloud.maude.sh
- ob-invite-landed · unreachable · needs a hub project + a second person
- ob-home-team · verified · none (empty "Shared with you" shelf, "Projects" list row "not on this Mac yet" instead of Recent canvases / Recent projects shelves, chip "a new project" = hub project not on this Mac, 11 Home owns the shelves)
- ob-local-name · verified · none (Advanced-opened is a side row)
- ob-local-first · verified · none (shot is a populated Smoke fixture canvas with the What's new notice up, not the empty "Your canvas is ready." block; that block and the left panel are 05 / 04-14 owned)
- ob-local-share · verified · none
- ob-local-moved · unreachable · needs a local project moved to a hub
- ob-adv-open · verified · none
- ob-adv-sheets · verified · none (Figma link + "Advanced · Access token" fold now match in both themes; five sheets present; Connect AI frame caught mid-fade by the harness)
- ob-settings · differs · MUST: each Connections row repeats its description inside the status line ("Where your projects live." then "Where your projects live. Not signed in."; hub: "A self-hosted server, beside the cloud." twice) where the board draws one description plus a toned status chip ("Signed in" / "Connected" / "Not connected"). Source: status strings in `settings/connections-model.js` L72 / L91 echo the `desc` passed in `settings/connections-section.jsx` L307 / L387. The Claude account and Figma "No token / Add token…" rows from round 7 are in
- ob-edge-offline · verified · none
- ob-edge-timeout · verified · none
- ob-edge-other-mac · verified · none (shelves, chip and toast are fixture / 11-owned / side)
- ob-edge-accounts · verified · none (account-row labels are profile-label fixture)
- ob-edge-ai-missing · differs · MUST: same defect as ob-ai-connect, the shared modal's Cancel / Connect are native unstyled buttons (the board shows ghost Cancel + filled Connect). Same one fix
- ob-edge-whats-new · verified · none for the main frame (one-line notice, Recent canvases, Shared with you / Projects); the Help flyout is a side row

## Polish list
- ob-first-launch, ob-signin-browser, ob-home-new, ob-adv-open, ob-edge-* · send button reads disabled grey on the placeholder (board shows it blue); no hairline above "Advanced options" in light; starter chips and placeholder wording (fixture); no window chrome / dot grid in the browser lane
- ob-local-name · sheet ~10 % narrower than the board; "Location" sits beside the "Advanced" label; tight foot padding; value is the placeholder "Untitled project"
- ob-local-share · "Move to the cloud?" popover about 20 % wider than the board
- ob-local-first · populated Smoke fixture instead of the empty canvas; What's new notice caught in the frame (harness)
- ob-home-team, ob-edge-other-mac · starters not project-themed, chip "a new project", no Recent canvases / Recent projects shelves, "Open project…" row solid not dashed (fixture / 11-owned)
- ob-edge-accounts · rows read "you@studio.cz / A new tab" instead of "You · personal / Work · a new tab"; lead sentence names the address; no team badge on the work face; no window tab strip behind the sheet
- ob-edge-whats-new · notice text "A new look: the canvas fills the window" vs "in 2.0 — one menu, calmer panels, cloud first" (feed content)
- ob-adv-sheets · Connect AI frame caught mid-fade; its Claude row has no radio / selected ring (API-key option RESTS, DDR-123); Install sheet shows "Not installed" where the board shows "Installed" (fixture); folder sheet opens on "A folder on this Mac" (board shows From GitHub)
- ob-settings · icons are bare glyphs, not the board's tiles; General carries extra rows owned by other boards (Minimap, Zoom controls, Annotations, Auto-open Inspector, Single-key shortcuts); "Where every old door went" is a board legend, not an app surface; Figma Add token… / GitHub Advanced folds add rows the board lacks (contract)
- ob-ai-connect · "Advanced · Use an API key instead" row absent (lead decision); panel behind the veil is 04/14-owned

## Side states
- ob-home-new/signed-in-toast · "Signed in. What you make now lives on cloud.maude.sh." (testid `home-signin-toast`, built in `signin/SignInToast.jsx`) · reachable (harness dismisses notices before each shot; not shot)
- ob-edge-other-mac/signed-in-toast · "Signed in — your 2 cloud projects are here." · reachable (not shot)
- ob-local-name/advanced-opened · Advanced fold opened with "Location ~/Maude/<name>" and "Choose another folder…" · reachable (not shot opened)
- ob-edge-whats-new/help-flyout · Home pill Menu › Help › What's new "1 new" shot, board lists Keyboard shortcuts, Help and guides, What's new ●, Take the tour, Watch the intro, How sharing works, Report a bug… · reachable (differs, does not block the main id)
- ob-signin-browser/os-open-prompt · the browser's own "Open Maude?" prompt · unreachable (outside the app)
- ob-adv-sheets/hub-probe · "Reachable — hub 1.4" after Test connection · unreachable (needs a hub)
- ob-adv-sheets/github-list · From GitHub repo list with Private / Public · unreachable (needs a GitHub sign-in)
- ob-adv-sheets/github-invite · Share › Advanced invite by GitHub username sheet · unreachable (needs a hub project)
- ob-settings/signed-in-account · General Account block (You · Signed in, Plan · Free trial, Manage on cloud.maude.sh, account links) · unreachable (needs a cloud sign-in)
