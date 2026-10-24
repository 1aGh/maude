# critic-d — 02 Onboarding — V2-8.5 stage D re-check (impl on 2739edc35, board re-rendered)

One critic, four lenses, both themes. Read every re-shot pair (jpg + full-size where a detail mattered). Rulings applied: CONTRACT over board; owning board wins (11 owns Home: dot grid and 880 width are board debt, 05 owns Home starters/shelves, 04/14 own the left panel); fixture content (recents, names, toast not run in the lane, probes) is not a blocker.

Light and dark agree for every id (Home pairs sit on the DS ladder), so one row per id.

| id | theme | verdict | remaining blockers |
| --- | --- | --- | --- |
| ob-first-launch | L+D | match | none. Warnings only: placeholder text, starters (05 owns), Send looks disabled when empty, no brand-starter edge, title-to-sub gap, no dot grid (11 owns) |
| ob-signin-browser | L+D | match | none (browser window and OS prompt are outside the app) |
| ob-home-new | L+D | match | none. Face present, quiet shelf; toast not run in the lane (fixture); starters follow 05 |
| ob-ai-connect | L+D | differs | design: Connect sheet still INLINE in the AI panel, foot clipped, no Advanced row, no strong veil (`v2/ai/NeedsYouSlot.jsx:216-223`, `ConnectSheet.jsx`); copy/a11y: Cancel / Connect not visible, focus stays in the composer; left panel full-height column, not an island |
| ob-first-draw | L+D | differs | signature/design: no dashed artboard, no "AI is writing the headline" tag, no AI cursor, no "3 of 4" step, plain "AI is working"; project-open toast not reached (`canvas-lib.tsx` artboard AI state, `v2/ai/Working.jsx`, `runs-model.js`); left panel column |
| ob-sig-draw | L+D | unreachable | motion study, no app counterpart; needs the draft-progress layer (dashed placeholders, per-piece tags, AI cursor, Made by AI, one-time hint) |
| ob-invite-page | - | unreachable | web page on cloud.maude.sh, not in the app |
| ob-invite-landed | L+D | differs | landing on her comment not shown (camera, thread, "Tereza invited you here", cursor); only the Join sheets shot; needs a hub project + second peer and the deep-link to comment path (`home/invite-flow.js`) |
| ob-home-team | L+D | differs | copy: "Nothing shared with you yet." printed beside "Alligators brand · Tereza's · Can edit"; chip "a new project" vs "Alligators brand"; spec Recent canvases/projects not present (list vs cards is 11-owned, fixture) (`Shelves.jsx` SharedWithYou, `home-model.js` target default) |
| ob-local-name | L+D | differs | design: Advanced row has no hairline, regular weight, "Location" sits next to the label; sheet is shorter with tight foot padding (`v2/signin/CreateLocalSheet.jsx:68-81`, `signin.css`); name is the placeholder (fixture) |
| ob-local-first | L+D | differs | left panel full-height column + extra rows vs floating island; populated canvas, not the empty "Your canvas is ready." (05 es-canvas-ai covers that) (`v2/canvases/canvases-panel.jsx`) |
| ob-local-share | L+D | differs | popover now untitled with Cancel as `.btn` (fixed) but still ~430 px vs 360 (`v2/share/share.css:17`); left panel column |
| ob-local-moved | - | unreachable | needs the local project moved to a hub; Share then opens on Invite with the moved toast |
| ob-adv-open | L+D | match | none. Flyout rows, foot sentence with Kbd, card 600 + btn--lg all as drawn |
| ob-adv-sheets | L+D | differs | cannot confirm material: Connect AI frame caught mid-fade; Connect AI first option is the spark row, not a radio list; Figma sheet has no link field / "Figma connected" / Advanced · Access token; probe states not shot; GitHub-invite sheet not covered (`v2/onboarding/ConnectAiSheet.jsx`, `FigmaSheet.jsx`) |
| ob-settings | L+D | differs | impl is the 06 full-window sheet with sidebar; General has no Account block (You · Signed in, Plan, Manage, account links); Connections rows have bare icons, no "AI — your Claude account" row; Figma token field shown by default (`v2/settings/general-section.jsx`, `connections-section.jsx`, `connections-model.js`) |
| ob-edge-offline | L+D | match | none. Offline line, swapped doors, warn-coloured "AI is back when this Mac is online." |
| ob-edge-timeout | L+D | match | none |
| ob-edge-other-mac | L+D | differs | copy: "Nothing shared with you yet." beside "Alligators brand · Tereza's · Can edit" (same contradiction as ob-home-team); chip "a new project" vs "Studio site". "You's" is fixed ("Yours · Owner") |
| ob-edge-accounts | L+D | differs | copy: rows say "you@studio.cz" / "A new tab", spec "You · personal" / "Work · a new tab", lead says "signed in as" vs "with your personal account"; design: no team badge on the work face (`home/invite-flow.js:46-47,194`, `home/InviteSheet.jsx:73-80`) |
| ob-edge-ai-missing | L+D | differs | same inline clipped Connect sheet as ob-ai-connect, no centred sheet over a veil; solo project, not the team canvas |
| ob-edge-whats-new | L+D | differs | Menu › Help flyout shows only "What's new 1 new"; spec lists Keyboard shortcuts, Help and guides, What's new, Take the tour, Watch the intro, How sharing works, Report a bug…; the line lacks the version ("What's new in 2.0 — …") (`home-app.jsx` Home pill menu, `WhatsNewLine.jsx:11`) |

Stage-B blockers closed since: Home first run quiet, sign-in card 600 + `.btn--lg`, account face, Home pill menu, "Enter a code instead", chip word (board edited to match), offline hint colour, sheet field wells and segment ring, Create sheet Tab trap, "You's".
