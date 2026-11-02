# critic-bar2 — 02 Onboarding — re-evaluated against the "verified" bar (v2-michal-verified-bar)

Source: critic-final-d3.md (merged tip 63592219a) + the final full-size pairs read again (light and dark agree for every id). Lead decisions applied: owning board wins (11 Home, 05 empty states, 04/14 left panel + toolbar), contract over board, Connect modal without an API-key row, toast/dock rule. No new shots.

## Per id
- ob-first-launch · verified · none
- ob-signin-browser · verified · none (browser window + OS prompt are outside the app)
- ob-home-new · verified · none
- ob-ai-connect · verified · none
- ob-first-draw · unreachable · needs an AI run (the piece-by-piece draft: dashed poster, per-piece tag, AI cursor, "3 of 4" step, project toast with Rename). The fake-agent lane shows whole artboards landing at once, so e2e must verify this; it is a real product gap, not fixture
- ob-sig-draw · unreachable · motion study, needs an AI run
- ob-invite-page · unreachable · web page on cloud.maude.sh
- ob-invite-landed · unreachable · needs a hub project + a second person (landing on her comment); the Join / Open-as sheets themselves match
- ob-home-team · verified · none (empty "Shared with you" shelf, missing Recent shelves, chip "a new project" and starters follow the fixture: the project is not on this Mac; 11 Home owns the shelves)
- ob-local-name · verified · none (side state "advanced-opened" listed below)
- ob-local-first · verified · none (left panel kind chips / Advanced fold are 04/14-owned; empty "Your canvas is ready." + Ask AI is 05-owned and the shot is a populated fixture canvas)
- ob-local-share · verified · none (same copy, controls and anchoring under Share)
- ob-local-moved · unreachable · needs a hub
- ob-adv-open · verified · none
- ob-adv-sheets · differs · MUST: Import from Figma sheet has no Figma link field and no "Advanced · Access token" fold (`FigmaSheet.jsx`)
- ob-settings · differs · MUST: Connections has no "AI — your Claude account" row (Pro or Max / API key, Connected, Change…); Figma row shows an open token field instead of the collapsed "Add token…" state (`connections-section.jsx`)
- ob-edge-offline · verified · none
- ob-edge-timeout · verified · none
- ob-edge-other-mac · verified · none (shelves and chip are fixture / 11-owned)
- ob-edge-accounts · verified · none (account-row labels are profile-label fixture)
- ob-edge-ai-missing · verified · none
- ob-edge-whats-new · verified · none for the main frame (the one-line notice); the Help flyout is its own side row

## Polish list
- ob-local-name · sheet ~10 % narrower than the board; "Location" sits beside the "Advanced" label, no hairline above the row, tight foot padding
- ob-local-share · "Move to the cloud?" popover about 20 % wider than the board
- ob-edge-accounts · rows read "you@studio.cz / A new tab" instead of "You · personal / Work · a new tab"; lead sentence names the address instead of "your personal account"; no team badge on the work face
- ob-edge-accounts · window tab strip and the Studio site tab behind the sheet (browser lane has no window chrome)
- ob-edge-whats-new · notice text "A new look: the canvas fills the window" vs "in 2.0 — one menu, calmer panels, cloud first" (feed content)
- ob-home-team, ob-edge-other-mac · starters not project-themed, chip "a new project", no Recent canvases / Recent projects shelves (fixture)
- ob-first-launch, ob-home-new, ob-signin-browser · chip wording, placeholder and starter wording (fixture); no window chrome / dot grid in the browser lane
- ob-local-first · populated Smoke fixture instead of the empty canvas; toolbar mode shown is the select set
- ob-adv-sheets · Connect AI frame caught mid-fade; Install sheet shows "Not installed" where the board shows "Installed" (fixture)
- ob-settings · "Where every old door went" card is a board legend, not an app surface; General carries extra rows owned by other boards (Minimap, Zoom controls, Annotations, Auto-open Inspector, Single-key shortcuts)

## Side states
- ob-edge-whats-new/help-flyout · Home pill Menu › Help flyout lists only "What's new 1 new"; the board lists Keyboard shortcuts, Help and guides, What's new ●, Take the tour, Watch the intro, How sharing works, Report a bug… · reachable (differs, does not block the main id)
- ob-local-name/advanced-opened · Advanced fold opened with "Location ~/Maude/<name>" and "Choose another folder…" · reachable (not shot opened)
- ob-adv-sheets/hub-probe · "Reachable — hub 1.4" after Test connection · unreachable (needs a hub)
- ob-adv-sheets/github-list · From GitHub repo list with Private / Public · unreachable (needs a GitHub sign-in)
- ob-adv-sheets/github-invite · Share › Advanced invite by GitHub username sheet · unreachable (needs a hub project)
- ob-settings/signed-in-account · General Account block (You · Signed in, Plan · Free trial, Manage, account links) · unreachable (needs a cloud sign-in)
