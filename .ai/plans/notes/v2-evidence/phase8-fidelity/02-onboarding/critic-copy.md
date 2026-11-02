# copy-critic — 02 Onboarding — V2-8.5 stage B

_2026-10-22 · board `.design/ui/v2/02 Onboarding.tsx` (+ `_kit.tsx` ConnectSheet) · CONTRACT §3 words, §4 voice (§1 menu, §7 AI rules where copy depends on them) · pairs `02-onboarding/INDEX.md` + full-size PNGs + raw impl frames (`.scr/impl-raw/02`) · voice POV: cloud first, nothing in the way, words not errors_

**Lens and rules.** Same as 01. CONTRACT wins over the board ("**board is stale**"). Board-vs-board conflicts (02 vs 05 / 06 / 11) are warnings that need a ruling. Copy is the same in both themes: I checked every dark impl frame in one contact sheet against the light ones (same states). So each row covers **light and dark**, counted once. Fixture-only differences (e2e-fixture / Smoke canvas, no Tereza, no network probes, an intercepted What's new feed) are not findings.

## TL;DR

**Blockers: 17** · Warnings: 20 · Verdict: **fix-and-retry**

Most of the sign-in card, the sheets and the edge lines match word for word: the timeout and offline cards, the Advanced flyout, Create a local project, the Move-to-cloud body, and the invite sheets, where each title asks with the same verb as its button. The blockers cluster in five places:

- the Home target chip when signed out;
- "Use a code instead";
- the Connect sheet, whose buttons are clipped;
- Settings › Connections, which says "Maude Cloud" and has no Claude-account row;
- Home rows: "You's · Can edit", and "Nothing shared with you yet." printed next to a project someone shared.

## Per artboard

| id · theme | difference | spec (board) | impl | owner file:line | sev |
| --- | --- | --- | --- | --- | --- |
| ob-first-launch · L+D | target chip | "Starts a new canvas in **a new project**" | "… in **a project on this Mac**". Signed out and online, the board says "a new project"; the board itself uses "a project on this Mac" only offline (line 819) | `client/home/home-model.js:238` | **B** |
| ob-first-launch · L+D | placeholder | "Describe it — a poster, a landing page, three logo ideas…" | "A calm landing page, light and airy" (one fixed string for every Home state) | `client/home/HomeAsk.jsx:15` | W |
| ob-first-launch · L+D | starters | "A landing page", "Three logo ideas", "Bring my existing brand" | "A portfolio page", "Three logo ideas", "A moodboard" (impl follows 05 `es-home-local`); needs a ruling | `client/home/home-starters.js:122-123` | W |
| ob-first-launch · L+D | extra shelves | card only | + "Recent canvases / Canvases you open show up here." + "Your projects · On this Mac / No projects on this Mac yet. …" (05's words ✓, but two empty states stacked on 02's one-card screen) | `client/home/home-app.jsx:922` | W |
| ob-signin-browser · L+D | code link | "Signed in on another device? **Enter a code instead**" (also in the ob-settings old-door map) | "… **Use a code instead**" | `client/v2/signin/signin-model.js:109` | **B** |
| ob-signin-browser · L+D | target chip | "a new project" | "a project on this Mac" (as ob-first-launch) | `client/home/home-model.js:238` | **B** |
| ob-signin-browser · L+D | unreached error string | — | "Maude Cloud could not be reached. Try again in a moment." The app names itself (CONTRACT §4), and a retry must be the button "Retry <name>" (§4 C20) | `client/v2/signin/signin-model.js:117`, `client/home/invite-flow.js:38` | W |
| ob-home-new · L+D | account face | yellow "M" avatar, title "You — signed in to cloud.maude.sh" | none (search field only); the toast "Signed in. What you make now lives on cloud.maude.sh." isn't exercised, though it exists ✓ (`signin-model.js:119`) | `client/home/home-app.jsx` (top bar) | W |
| ob-home-new · L+D | starters / extra line | "A landing page…" set; one shelf | "A pricing page", "Three logo ideas", "A matchday poster" (05 `es-home-cloud`) + the empty "Recent canvases" line. The shelf "No projects yet. Your first canvas starts one — and everyone you invite sees it here." is ✓ | `client/home/home-starters.js:122`, `home-app.jsx:922` | W |
| ob-ai-connect · L+D | sheet actions | title "Connect your Claude account?" ✓, lead ✓, "Claude Pro or Max" ✓, **Advanced · Use an API key instead**, **Cancel / Connect** | the sheet sits inside the AI panel. The foot "Your prompt waits here and runs as soon as it's…" is cut off, and the Advanced row and Cancel / Connect can't be seen. CONTRACT §7 names exactly "Connect, Cancel" | `client/v2/ai/ConnectSheet.jsx:15,29-58` (host: AI panel) | **B** |
| ob-ai-connect · L+D | chips under an unsent prompt | none | "Same on the other artboards", "A bit larger", "Check every text size" + "Because you last asked about text": follow-ups for a run that hasn't started | `client/v2/ai/suggest-why.js` | W |
| ob-ai-connect · L+D | panel header | "New chat" (one canonical header, C28) | "AI" here; "New chat" in 01; the prompt title elsewhere | AI panel header (`client/v2/ai/AiChatIsland.jsx`) | W |
| ob-ai-connect · L+D | unreached error strings | — | "Could not reach Maude." (names itself, §4) · "Sign-in timed out. Try again." · "Install failed." (no "what is safe", no retry button) | `client/v2/ai/connect-flow.js:28,54,70` | W |
| ob-first-draw · L+D | working words | "AI is writing the headline" · "3 of 4 · button next"; chat title "A poster for the open studio" | "AI is working" · "Edit the canvas · 0:03"; "New chat" (no `run.doing` writer, see 01 root cause 1) | `client/v2/ai/run-model.js:61-67`, `RunSurface.jsx:227` | **B** |
| ob-first-draw · L+D | project toast | "Open studio is your first project, on cloud.maude.sh." **Rename** | not reached: the Home sentence → project window is a Tauri open the lane can't do. The code exists ✓ | `client/v2/create/take-intent.js:46,115` | W |
| ob-sig-draw · L+D | per-piece labels + hint | "AI is placing the colour / drawing the picture / writing the headline", "Made by AI", hint "⌘ / Select anything, then ask AI to change it." | **unreachable**. The labels need a `doing` writer; the one-time hint string doesn't exist anywhere in `apps/studio` | — (missing) | **B** |
| ob-invite-page · — | web page | "Tereza invited you to Alligators brand", "Download Maude for Mac", … | not part of this app (cloud.maude.sh web). It should be reviewed on the cloud repo | — | W |
| ob-invite-landed · L+D | landing words | "Tereza invited you here — her comment is on the poster.", "Reply to Tereza", "Tereza is on this canvas now" | none of these strings exist in the client. The invite sheets reached are ✓ ("Join Alligators brand from Tereza as you@studio.cz?" → **Join**; "Open the invite as …?" → **Open**, other button **Cancel**). Product work: land on the comment's thread | — (missing) | **B** |
| ob-home-team · L+D | contradiction | "Recent canvases" of the team + chip "Alligators brand" | the Projects shelf lists "Alligators brand · Tereza's · Can edit · not on this Mac yet" while the Shared shelf beside it says "**Nothing shared with you yet.**" | `client/home/Shelves.jsx:185` vs `home-app.jsx:1192` | **B** |
| ob-home-team · L+D | target chip | "Alligators brand" | "a new project" (the target ignores a cloud project that isn't on this Mac) | `client/home/home-model.js:296` | W |
| ob-local-name · L+D | — | "Create a local project" · "Name" · "Kept on this Mac, in your Maude folder. Move it to the cloud any time." · "Advanced · Location" · Cancel / **Create project** | ✓ word for word. The placeholder "Untitled project" fits the board header's PROPOSED rule. The background Home is veiled | — | ✓ |
| ob-local-first · L+D | state | empty "Your canvas is ready." line | a populated Smoke canvas; "Local project" ✓. The empty line was checked on 05 `es-canvas-ai` | — | W |
| ob-local-share · L+D | sheet title | "Move “Portfolio 2026” to the cloud?" (popover, no title row) | "**Share Smoke**" (canvas) above "Move “e2e-fixture” to the cloud?" (project): two titles at two scopes. Body ✓, "Only need a file? Menu › Export… ⇧⌘E" ✓, Cancel / **Move to cloud** ✓ | `client/v2/share/share-sheet.jsx` (title) · `move-to-cloud.jsx:34` | W |
| ob-local-moved · L+D | state | "Share “Portfolio 2026”", **Invite**, "Moved to the cloud — 3 canvases are going up now." | **unreachable**: needs the project moved to a hub | — | **B** |
| ob-adv-open · L+D | flyout / chip | five rows + "Each row opens one sheet. Later they live in Settings › Connections and Settings › Advanced, and Search ⌘K finds them." | flyout ✓ word for word; chip "a project on this Mac" (spec line 676 "a new project") | `client/home/home-model.js:238` | **B** |
| ob-adv-sheets · L+D | Figma sheet | "Figma link" field + "Figma connected" + "Advanced · Access token" | the first state has only the paragraph + Cancel / **Import** (no link field: the verb has no object). The hub, folder/GitHub, Connect AI and maude-command sheets ✓ (titles = button verbs, Cancel). Probe states are fixture | `client/v2/import/` (Figma sheet) | W |
| ob-settings · L+D | cloud row name | "cloud.maude.sh · Where your projects live. · Signed in · Sign out" | "**Maude Cloud** · Where your projects live. Not signed in. · Sign in". CONTRACT §4: the app never names itself, and the rest of the UI says cloud.maude.sh | `client/v2/settings/connections-section.jsx:299` | **B** |
| ob-settings · L+D | AI row | "AI — your Claude account · Pro or Max, or an API key. · Connected · Change…" | no Claude-account row; "AI images, video and voice · No keys yet · Manage" instead. The Advanced flyout promises "Later they live in Settings › Connections" (CONTRACT §7 A2: AI = your Claude account) | `client/v2/settings/connections-model.js:11` | **B** |
| ob-settings · L+D | hub / Figma rows | "Your own hub · … · Connect…"; Figma "For Import from Figma. · No token · Add token…" | "Your team's own server · … Sign in with your email and password. · Add a team server…"; Figma shows "`file_content:read` scope…" + a raw "figd_…" field in the default view (impl follows 06 `ad-edge-hub`) | `connections-section.jsx:378-520` | W |
| ob-settings · L+D | General words | Account "You · Signed in to cloud.maude.sh", Plan "Free trial · 12 days left" | "Auto-open Inspector on select — Open the Inspector automatically when you select an element." (CONTRACT §1 says "Open inspector on select"; "element" isn't a §3 word). Account rows are signed-out (fixture). "Where every old door went" is board-only documentation, so not a finding | `client/v2/settings/general-section.jsx:121` | W |
| ob-edge-offline · L+D | starters | default set | "Offline · Sign-in waits until this Mac is online — the button wakes up by itself." ✓, "Just a local project" first ✓, foot ✓, "AI is back when this Mac is online." ✓, chip ✓; starters differ (as ob-first-launch) | `client/home/home-starters.js:123` | W |
| ob-edge-timeout · L+D | chip | "a new project" | "Sign-in didn't finish · Nothing changed on this Mac. Try again whenever you like." ✓; chip "a project on this Mac" (spec line 827) | `client/home/home-model.js:238` | **B** |
| ob-edge-other-mac · L+D | ownership words | "Studio site · …" with recents | "**You's** · Can edit · not on this Mac yet". The possessive is built as `${ownerName}'s`, which breaks for "You" (CONTRACT §4 "You"). It also shows "Can edit" for your own project (CONTRACT role: Owner). Fix: "Yours · Owner" | `client/home/home-app.jsx:1192` | **B** |
| ob-edge-other-mac · L+D | toast / chip | "Signed in — your 2 cloud projects are here."; chip "Studio site" | toast not exercised (exists ✓ `signin-model.js:128`); chip "a new project" | `client/home/home-model.js:296` | W |
| ob-edge-accounts · L+D | account rows | lead "…This window is signed in with your personal account."; rows "**You · personal** — This window, now" → "you@work-studio.cz — **Work · a new tab**" | lead "…signed in as you@studio.cz."; rows "you@studio.cz — This window, now" → "you@work-studio.cz — A new tab". The signed-in person is "You" (CONTRACT §4), and the personal / work labels are missing | `client/home/invite-flow.js:46-47,194` | **B** |
| ob-edge-ai-missing · L+D | connect sheet | centred sheet, **Cancel / Connect** | the same clipped in-panel sheet as ob-ai-connect (⌘/ didn't open Ask AI in the lane) | `client/v2/ai/ConnectSheet.jsx` | **B** |
| ob-edge-whats-new · L+D | the line | "What's new in 2.0 — one menu, calmer panels, cloud first. See what's new" | "What's new — A new look: the canvas fills the window · See what's new · ×". The entry text is fixture, but the line has no version and a capital letter after the dash | `client/v2/signin/WhatsNewLine.jsx:11` | W |
| ob-edge-whats-new · L+D | Menu › Help | "Keyboard shortcuts ? · Help and guides F1 · What's new ● · Take the tour · Watch the intro · How sharing works · Report a bug…" | **unreachable**: Home's pill opens no menu. The board also omits "Set up Maude…", which CONTRACT §1 Help lists, so the **board is stale** there | Home pill (`client/home/home-app.jsx`) | **B** |

## Root causes (several artboards)

1. **The Home target word depends on sign-in, not on online state.** `home-model.js:238` turns signed out + online into "a project on this Mac". The board keeps that phrase for offline only. Hits first-launch, signin-browser, adv-open, timeout.
2. **No `run.doing` writer** (shared with 01). Every "AI is <doing>" line in first-draw and sig-draw is impossible.
3. **The Connect sheet is hosted inside the AI panel**, so its foot (Cancel / Connect, Use an API key) is clipped. Hits ai-connect, edge-ai-missing, and 05 es-canvas-three.
4. **The product names itself.** "Maude Cloud" (Settings › Connections, `invite-flow.js:38`, `home-app.jsx:1181`) and "Could not reach Maude." break CONTRACT §4 and the cloud.maude.sh wording everywhere else.
5. **Person words assembled from raw fields.** `${ownerName}'s` → "You's"; email addresses where CONTRACT says "You"; "Can edit" on your own project.
6. **Boards 02 / 05 / 06 / 11 disagree** on Home starters, the shelves and the Connections rows. The impl follows 05 / 06 / 11. Board 02 needs a refresh pass, or Michal needs to rule.

```json
{"canvas":"02 Onboarding","critic":"copy-critic","blockers":17,"warnings":20,"verified_ids":["ob-local-name · light","ob-local-name · dark"]}
```
