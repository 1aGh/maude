# critic-final — 02 Onboarding — V2-8.5 stage D2 (impl on merged tip d3881fe41)

One critic, four lenses. Every id judged fresh from the FINAL (D2) full-size pairs, both themes read. Rulings: CONTRACT over board; owning board wins (11 Home, 05 starters/shelves, 04/14 left panel); lead decisions applied (Connect modal without the API-key row, '+ New canvas' row + switcher in the pill, toast/dock rule, Comments icon per 10, Diagnostics three boxes); fixture content and the browser lane's missing window chrome are not blockers. Spec/impl are scaled 1.0 / 0.9 in the pair image, so widths compared after that correction.

Light and dark agree for every id.

| id | theme | verdict | remaining blockers |
| --- | --- | --- | --- |
| ob-first-launch | L+D | match | none |
| ob-signin-browser | L+D | match | none (browser window + OS prompt are outside the app) |
| ob-home-new | L+D | match | none (toast and "1" marker not run = fixture; avatar present) |
| ob-ai-connect | L+D | match | none after lead decision: centred modal over veil, Cancel / Connect, focus on Connect, same width after scale correction; API-key row dropped by decision; left panel behind the veil is the 04/14-owned panel |
| ob-first-draw | L+D | differs | signature/design: no dashed poster while built, no "AI is writing the headline" tag, no AI cursor, no "3 of 4 · button next" step in the chat card, no "Open studio is your first project … Rename" toast; whole artboards land at once with "AI is drawing Tablet" + stacked "AI is working" tags (`runs-model.js`, `hold-rings.tsx`, `v2/ai/Working.jsx`). Made-by-AI label correct |
| ob-sig-draw | L+D | unreachable | motion study with no app counterpart; needs a draft-progress layer (dashed placeholders, per-piece tags, AI cursor, "Made by AI", one-time ⌘/ hint) |
| ob-invite-page | - | unreachable | web page on cloud.maude.sh, not in the app |
| ob-invite-landed | L+D | differs | landing on Tereza's comment not shown (camera on the poster, her cursor + thread, "Tereza invited you here" pill); only the Join / Open-as sheets and own composer shot. Needs hub project + second peer + deep-link-to-comment (`home/invite-flow.js`) |
| ob-home-team | L+D | differs | copy: "Nothing shared with you yet." beside the shared "Alligators brand · Tereza's · Can edit"; chip "a new project" vs "Alligators brand"; no project-themed starters (`Shelves.jsx` SharedWithYou, `home-model.js`) |
| ob-local-name | L+D | differs | design: Advanced row has no hairline / weight, "Location" sits beside the label; sheet shorter, tight foot padding (`v2/signin/CreateLocalSheet.jsx:68-81`, `signin.css`) |
| ob-local-first | L+D | differs | design: Undo/Redo/zoom island present, but Canvases panel still carries "Make a design system", kind chips, Trash, "N canvases · ⌘K…" foot, Advanced fold; board draws tabs, search, one project list + New canvas; populated canvas not the empty "Your canvas is ready." (`v2/canvases/canvases-panel.jsx`) |
| ob-local-share | L+D | differs | design: popover ~437 px real vs 360 spec (`v2/share/share.css:17`); left panel as ob-local-first |
| ob-local-moved | - | unreachable | needs the local project moved to a hub (Share opens on Invite + moved toast) |
| ob-adv-open | L+D | match | none |
| ob-adv-sheets | L+D | differs (cannot confirm: sheets shot only in first states) | no probe states ("Reachable — hub 1.4", GitHub repo list, Claude/API radios, "Installed", "Figma connected"); Connect AI frame mid-fade; Figma sheet lacks link field / Advanced · Access token; GitHub-invite sheet not covered (`v2/onboarding/ConnectAiSheet.jsx`, `FigmaSheet.jsx`) |
| ob-settings | L+D | differs | design/copy: 06-style full-window sheet with sidebar; General has no Account block (You · Signed in, Plan · Free trial, Manage, account links), Theme not in the Account card layout, no "Where every old door went" card; Connections lack the "AI — your Claude account" row, Figma token field open (`v2/settings/general-section.jsx`, `connections-section.jsx`) |
| ob-edge-offline | L+D | match | none |
| ob-edge-timeout | L+D | match | none |
| ob-edge-other-mac | L+D | differs | copy: "Nothing shared with you yet." beside "Alligators brand · Tereza's"; chip "a new project" vs "Studio site"; starters not project-themed (`Shelves.jsx`, `home-model.js`) |
| ob-edge-accounts | L+D | differs | copy: rows "you@studio.cz" / "A new tab" vs "You · personal" / "Work · a new tab"; lead "signed in as you@studio.cz" vs "with your personal account"; no team badge on the work face (`home/invite-flow.js:46-47,194`, `home/InviteSheet.jsx:73-80`) |
| ob-edge-ai-missing | L+D | match | none after lead decision (same modal as ob-ai-connect; solo canvas behind is fixture) |
| ob-edge-whats-new | L+D | differs | Home pill menu Help flyout lists only "What's new 1 new"; spec lists Keyboard shortcuts, Help and guides, What's new ●, Take the tour, Watch the intro, How sharing works, Report a bug…; line lacks "in 2.0 — one menu, calmer panels, cloud first" (`home-app.jsx`, `home/home-menu.js`, `WhatsNewLine.jsx:11`) |
