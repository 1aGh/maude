# critic-final-d3 — 02 Onboarding — V2-8.5 stage D3 (impl on merged tip 63592219a)

One critic, four lenses. Every id judged fresh from the FINAL (D3) full-size pairs, light and dark both read. Rulings: CONTRACT over board; owning board wins (11 Home, 05 starters/shelves, 04/14 left panel); lead decisions applied (Connect modal without API-key row, '+ New canvas' row, toast/dock rule, Diagnostics three boxes, undo toast text). Fixture content and the browser lane's missing window chrome / dot grid are not blockers. Light and dark agree for every id.

| id | theme | verdict | remaining blockers |
| --- | --- | --- | --- |
| ob-first-launch | L+D | match | none |
| ob-signin-browser | L+D | match | none (browser window + OS prompt are outside the app) |
| ob-home-new | L+D | match | none (toast / "1" marker not run = fixture) |
| ob-ai-connect | L+D | match | none after lead decision (modal, Cancel / Connect, focus on Connect); panel behind the veil is 04/14-owned |
| ob-first-draw | L+D | differs | signature/design: still no dashed poster while built, no "AI is writing the headline" tag, no AI cursor, no "3 of 4 · button next" step in the chat card, no "Open studio is your first project … Rename" toast; whole artboards land at once with "AI is drawing Tablet" + stacked "AI is working" tags. Finish frame now has "Done — … Undo" toast + Made by AI labels (improved) (`runs-model.js`, `hold-rings.tsx`, `v2/ai/Working.jsx`) |
| ob-sig-draw | L+D | unreachable | motion study with no app counterpart; needs a draft-progress layer (dashed placeholders, per-piece tags, AI cursor, one-time hint) |
| ob-invite-page | - | unreachable | web page on cloud.maude.sh, not in the app |
| ob-invite-landed | L+D | differs | landing on Tereza's comment not shown (camera on the poster, her cursor + thread, "Tereza invited you here" pill); only Join / Open-as sheets + own comment composer shot. Needs hub project + second peer + deep-link-to-comment (`home/invite-flow.js`) |
| ob-home-team | L+D | differs | copy/design: "Nothing shared with you yet." beside shared "Alligators brand · Tereza's · Can edit"; chip "a new project" vs "Alligators brand"; no project-themed starters, no Recent canvases / Recent projects shelves (`Shelves.jsx` SharedWithYou, `home-model.js`) |
| ob-local-name | L+D | differs | design: Advanced row has no hairline / weight, "Location" beside the label; sheet shorter, tight foot padding (`v2/signin/CreateLocalSheet.jsx`, `signin.css`) |
| ob-local-first | L+D | differs | design: Canvases panel still carries kind chips, 10-canvas project list, Advanced fold vs board's one project list + New canvas; canvas is the populated Smoke fixture, not the empty "Your canvas is ready." with Ask AI (`v2/canvases/canvases-panel.jsx`; empty state owned by 05) |
| ob-local-share | L+D | differs | design: "Move to the cloud?" popover wider than spec (~300 vs 247 px at shot scale; `v2/share/share.css:17`), no "Move" wording of project name = fixture; left panel as ob-local-first |
| ob-local-moved | - | unreachable | needs the local project moved to a hub (Share opens on Invite + moved toast) |
| ob-adv-open | L+D | match | none |
| ob-adv-sheets | L+D | differs (cannot confirm: sheets shot only in first states) | no probe states ("Reachable — hub 1.4", GitHub repo list, Claude/API radios, "Installed", "Figma connected"); Connect AI frame mid-fade; Figma sheet lacks link field / Advanced · Access token; GitHub-invite sheet not covered (`v2/onboarding/ConnectAiSheet.jsx`, `FigmaSheet.jsx`) |
| ob-settings | L+D | differs | design/copy: General has no Account block (You · Signed in, Plan · Free trial, Manage, account links), Theme not in Account-card layout, no "Where every old door went" card; Connections lack the "AI — your Claude account" row, Figma token field open (`v2/settings/general-section.jsx`, `connections-section.jsx`) |
| ob-edge-offline | L+D | match | none |
| ob-edge-timeout | L+D | match | none |
| ob-edge-other-mac | L+D | differs | copy: "Nothing shared with you yet." beside "Alligators brand · Tereza's"; chip "a new project" vs "Studio site"; starters not project-themed; no Recent canvases / projects shelves (`Shelves.jsx`, `home-model.js`) |
| ob-edge-accounts | L+D | differs | copy: rows "you@studio.cz" / "A new tab" vs "You · personal" / "Work · a new tab"; lead "signed in as you@studio.cz" vs "with your personal account"; no team badge on the work face (`home/invite-flow.js`, `home/InviteSheet.jsx`) |
| ob-edge-ai-missing | L+D | match | none after lead decision (same modal as ob-ai-connect; solo canvas behind is fixture) |
| ob-edge-whats-new | L+D | differs | Home pill Help flyout lists only "What's new 1 new"; spec lists Keyboard shortcuts, Help and guides, What's new ●, Take the tour, Watch the intro, How sharing works, Report a bug…; line reads "A new look: the canvas fills the window" vs "in 2.0 — one menu, calmer panels, cloud first" (`home-app.jsx`, `home/home-menu.js`, `WhatsNewLine.jsx`) |
