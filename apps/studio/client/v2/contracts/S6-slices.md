# S6 · Create, Home, Onboarding — slice plan

Planning spike, Phase 6 wave B. Plan row: `.ai/plans/feature-maude-v2-redesign.md` § Phase 6 "S6" and § Reuse "S6".
Topic owners: canvas **01** (Home, create flow, empty canvas) and **02** (onboarding), plus **05** for the home and
first-run empties. Lanes:

- **L3 client** runs after S5.
- **L4** takes the Rust side and the cloud side.
- **Home server** routes (`apps/studio/home/*`) are S6's own table. They are not the studio `routes/index.ts`.

Read with: `V2-1.1-home-window.md` (§5.3–5.9), `V2-1.14-outbox.md` (§8 "S6"), `S9-slices.md` (Q5, Q6 and its
"Interface S6 codes against"), `S11-slices.md` §2.4–§2.5, `S5-slices.md` (S5.13 ConnectSheet), `S1-slices.md`
(Q11, S1.13, S1.18).

## 1. Scope recap

S6 covers these surfaces:

- **Home:**
  - the question "What shall we make?", the prompt, the target-project chip, starters, and "Start with an empty canvas ⌘N";
  - Pinned, Recent canvases, Shared with you, and Projects by account, with the 05 empties.
- **First canvas from one sentence:**
  - an intent goes to the target project, which creates a canvas named by C4 and starts the AI run;
  - AI drafts artboard by artboard; one run is one undo step (S5).
- **Making and fixing:** ⌘N makes a blank canvas, a new project has no canvases yet, the render-error card (C5),
  and offline create.
- **First launch:** first launch is Home with a sign-in card. Its parts:
  - the cloud.maude.sh browser sign-in, with return-to and "Use a code instead";
  - "Just a local project";
  - Advanced options, with five sheets: self-hosted hub, folder or GitHub, Connect AI, maude command + plugin, Figma;
  - the edges: offline, timeout, another Mac, two accounts, no AI yet, after an update.
- **Invite journey:** download → install → sign-in → land on the comment (deferred deep link).
- **Project naming (C4).**

**Already shipped.** Slices extend these and do not redo them:

- **V2-3.3, functional Home:**
  - files: `client/home/{home-app,home-api,home-model,shell-mode,home-icons}.jsx/js` and `home.css`;
  - sections: Pinned, Recent canvases with pictures, Projects by profile (incl. "not on this Mac" cloud rows and
    Find the folder…), ⌘K search with recent searches, pins;
  - live refetch on `shell://state` / `index://changed`;
  - 24 tests and the `home-*` testids;
  - an empty `data-slot="home-ask"` where the question goes.
- **V2-3.3 Home server:** `home/{routes,create-local,cloud,index-reader,user-state,main}.ts`, with
  `/_home/projects/create-local` (C4 " 2"), `/_home/cloud`, `/_home/cloud/prepare`, `/_home/pins`. The guard
  (page secret, loopback, same-origin, no CORS) is pinned by `home-routes-guard.test.ts`.
- **V2-3.9:** File › New Project on Home opens a create sheet (`home-create-*`). That is name → create-local →
  `open_project({root})`.
- **Rust:**
  - `open_project` with `intent`, parked per window; `take_pending_intent` (validated, `kind: 'create-canvas'` only);
  - `profiles_create`; `cloud_sign_in_prepare` / `cloud_signed_in` (project callers only, V2-3.8);
  - `managed_project_open(profile)`.
- **First launch boots Home** (`lib.rs` `boot_plan`). The v1 `OnboardingWizard` still mounts only under the
  debug `MAUDE_FORCE_ONBOARDING` lane.
- **V2-4.3a:** `client/v2/shell/save-status.js` holds the five save words (cf-status-words is built).
- **Studio routes:**
  - `/_api/cloud/signin/{start,poll}` is the device flow, and the cloud `verification_url` already pre-fills the code;
  - `/_api/canvas` POST (`createCanvas` takes kind brief-board or video-comp; the name is required, and an existing
    name answers 409).
- **S5.13** exports `client/v2/ai/ConnectSheet.jsx` (controlled view).
- **S11** (§2.4, §2.5) builds:
  - the empty kit `client/v2/empty/`;
  - the empty canvas (S11.2, closing `rule/the-empty-canvas-line`);
  - es-landing (S11.1);
  - one `CanvasErrorCard` (S11.7).

  S6 uses these and draws no empty markup of its own.

## 2. Open questions resolved

### 2.1 Decisions

| # | Decision | Why |
| --- | --- | --- |
| Q1 | **Browser sign-in uses the device flow, with the code pre-filled.** The app opens the cloud's `verification_url` plus `&state=<s>`. When the browser is not signed in, `/activate` sends it through `/login?next=…` (S9.14). After approval the page navigates to `maude://auth/done?state=<s>`; its Cancel goes to `maude://auth/cancelled?state=<s>`. Both links only nudge the app: `done` → poll now; `cancelled` with a matching state → card back at once. The token travels only in the app's own poll POST. Rejected: an account-handoff code in the `maude://` URL. | A URL would carry a claim on the whole account, and the device lane is already trusted (kg "Desktop signs into Maude Cloud natively — rides the device-flow pattern"). "Use a code instead" is the same flow with the code shown, so nothing new is needed for it. |
| Q2 | The link reads **"Use a code instead"**, not 02's "Enter a code instead". | Gate 0 G0-D D11 outranks the canvas. |
| Q3 | **Home signs in by itself.** New Home routes `/_home/cloud/signin/{start,poll,cancel}` write the cloud.json of a profile that Rust picks (`home_cloud_sign_in_prepare`). Per V2-3.8, a profile that holds another account is never re-signed; a fresh profile is made instead. | There is no project server on a first launch. Every credential stays in the Home process and Rust; the page sees only `state`. |
| Q4 | **"A new project" while signed in** = create-local now (named from the sentence), then S9.20's local → cloud move starts in the background. If the move route is absent (404), the project stays local and the status word says so. Rejected: provisioning a cloud project first. | The first canvas never waits for provisioning or the network. Offline works. There is one path, and "Move to cloud later" is the same engine. |
| Q5 | **Starters are deterministic**: a fixed catalogue, picked by the target project's dominant artboard kinds (V2-1.17 index) and named after the project. There is no AI call on Home. A click fills the prompt and does not send. "Bring my existing brand" runs `import.brand` in the target. | Instant and offline-safe. AI stays the person's own (A2). |
| Q6 | **C4 naming runs on the server.** `canvas-create.ts` `nextFreeCanvasName` ("Untitled canvas", " 2", " 3"; a canvas in the trash does not hold its name) and `nameFromPrompt(prompt) → {canvas, project}`: a non-AI lexicon of artifact nouns, EN + CZ. Fallback is "Untitled canvas" / "Untitled project". `POST /_api/canvas` accepts no name. | One rule for ⌘N, Home and offline create (C4). The fixtures are the canvases' own prompts. |
| Q7 | **A blank canvas is a new template kind, `blank`**: an empty `DesignCanvas`. The brief board keeps its home as "New brief board" (⌘K, and the Canvases panel's New menu). | 01 cf-blank draws an empty canvas. Nothing is deleted. |
| Q8 | **The Home intent grows to four kinds**: `create-canvas \| create-empty \| import-brand \| import-figma` (Rust `validate_intent`). Home parks them; the prompt is never in a URL (V2-1.1 §5.8.8). The project client takes the intent once. | Home's ⌘N, starters and Figma row all land in a target project. W1 keeps intents Home-only. |
| Q9 | **The render-error card is S11's `CanvasErrorCard kind:'render'`.** S6 adds a runtime signal: dgn c2s `render-error {file, message}` / `render-ok {file}`, emitted from `CanvasErrorBoundary` (`canvas-comment-mount.tsx`). The canvas keeps holding the last good render (DDR-077). The card stays silent while an AI run of this Mac writes the canvas, and shows only if the canvas is still broken when the run ends. On a cold open with no good render, the index thumbnail sits dimmed behind the card. | C5 + 01 "the last good version stays visible, dimmed, behind the card". Broken intermediates during an agent edit are normal (DDR-077). |
| Q10 | **New projects start empty.** `scaffold-design.ts` stops seeding Welcome / "How to use Maude" / "How to make video". Help › Help and guides offers "Add the guide canvases to this project" (the same template strings). | 05 es-project-new ("0 canvases") and 02 ob-local-first ("1 · Untitled canvas"). The guides stay reachable. |
| Q11 | **What's New "seen" moves to ui-prefs (per Mac).** Home and every tab then agree; localStorage is per port origin, so each tab had its own marker. The old key is migrated once. The Home line is the newest unseen entry's `title`, so the schema does not change. | 02 ob-edge-whats-new: "one quiet line once; Help keeps the dot". |
| Q12 | **An invite for another account** opens in its own tab under a new profile (V2-3.8 bind). The invite id carries the address to the sign-in page (`&invite=<id>` → the page pre-fills it on the server), so an e-mail never goes in a URL. | 02 ob-edge-accounts; the privacy rule. |
| Q13 | **Install the maude command** symlinks the bundled `maude` into `~/.local/bin`. It never uses sudo and refuses to overwrite a non-link. When `claude` is present it also adds the plugin with `claude plugin marketplace add 1aGh/maude` + install. Otherwise the sheet shows the two Copy rows. | DDR-177: the app must not assume npm. The canvas's Install button needs a real verb (title verb = button). |
| Q14 | **The 01 row split** follows S1 and S5: `cf-busy` → S5.15 (S5 claims it). S2 and S4 build `cf-select-tweak` / `cf-add-artboard` / `cf-duplicate-*` / `cf-frames-text` / `cf-sticky-comment`, but neither claims those rows; `cf-status-words` was built by V2-4.3a. S6.16 verifies all of these by the S11 Q2 rule (last part lands). | One row, one slice. |
| Q15 | **The 05 rows are S6's** per S11 §4.2: es-home-cloud, es-home-local, es-home-shared, es-project-new. They are built on the S11.1 kit. | Lead message 2026-10-18 + S11 §4.2. |

### 2.2 Open questions with a recommended default (for Michal; GAP-CANVAS rows in the Progress log)

- **ob-edge-other-mac:** "recents arrive by themselves" on a second Mac. v2.0 has no per-account source of recents.
  Default: cloud projects arrive at once ("Signed in — your 2 cloud projects are here."). Recent canvases fill as
  canvases are opened on this Mac. Row verified with this note; `/api/home recent[]` is v2.1.
- **"From GitHub" on Home** needs GitHub on a project-less Home (S6.10).
  - Default: Rust lists repos and clones with the profile's keychain token; the token never reaches JS.
  - If the security fan-out refuses it, the segment says "Pull a local copy… from a project's Menu › File", which is
    the existing `project.pull-copy` home.

### 2.3 Cross-lane contracts (write first)

**`apps/studio/client/v2/contracts/S6-S9-signin-invite-home.md`** — writer: **S6.0** (Opus). S9 signs it; S9.14 and
S9.16 need it before they write page bodies. It fixes:

1. **Account sign-in return-to.**
   - The app opens `<verification_url>&state=<s>[&invite=<id>]`. `state` is 32 hex chars per attempt.
   - The `/activate` done page navigates to `maude://auth/done?state=<s>`. Cancel (on `/activate` or `/login`)
     navigates to `maude://auth/cancelled?state=<s>`.
   - The app's own wait is 10 minutes (the device TTL is 15).
2. **Device token `landing`.** `POST /auth/device/token` 200 gains an optional `landing {project, canvas?, thread?}`.
   It is the invite this account redeemed through the pending cookie during this sign-in (S9 Q6,
   `landingForInvite`, re-checked with `seesCanvas`). It is additive; v1 ignores it.
3. **Invite peek and accept.**
   - `GET /api/invites/<id>/peek` takes no auth. It answers only what the public invite page shows:
     `{projectName, fromName, email, role, canvas?:{path,name}, thread?}`. A dead invite gets a 404 with the page's
     body.
   - `POST /api/invites/<id>/accept` takes `Bearer mpt_…` and answers:
     - 200 `{code:'mhc_…', landing}`: a handoff code, exchanged through the existing link lane;
     - 403 `{reason:'other-account', email}`;
     - 404.
4. **`GET /api/home`** (V2-1.1 §5.7): the shape stays as written there.
   - **S6.14 builds it** in a new `apps/cloud/home-api.mjs`, because the S9 plan has no slice for it.
   - S9 registers the route in its router.
5. **Background move.** S9.20 exposes the local → cloud move as a project route, `POST /_api/cloud/move {name?}` →
   `{ok, project, state:'provisioning'|'ready'}`. It is idempotent per folder and is not tied to the Share sheet UI.
   S6 calls it after a Home create while the person is signed in.

**No new file is needed for the rest.** These are patch notes to the owners:

- **S1.13:** writes and reads `_state/render-ok.json` (the writer runs on dgn `render-ok`) and owns
  `history.go-back`. S6.12 only consumes them.
- **S1.18:** a comment opened by id (`comment-focus`) is reachable from `open_project` `target.thread`.
- **S5:** S6.3 adds one `maude:ai-send {prompt, scope:{canvas}, newChat:true}` listener to `AiChatIsland.jsx`, after
  S5 merges. It runs the composer path, which includes the connect gate and offline queueing.
- **S11:** Settings › Connections (S11.14) mounts S6's `SignInCard` model + sheets, so it does not rebuild them.
  S6 uses `CanvasErrorCard` and the empty kit.

## 3. Slices

Model key: **O** = Opus (risk class named), **S** = Sonnet. "Lead" = a patch request through the lead (registry,
bridge, `app.jsx` / `viewport.jsx` residue, `http.ts` / route tables, `whats-new.json`, `dist/`). Turn counts are
estimates for one fresh builder.

| id | Title | Artboards made verifiable | Files owned | Lead patch requests | Model | Deps | Done when | Red-first tests | e2e / scenario | Turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **S6.0** | Contract S6 ↔ S9: sign-in, invite, `/api/home`, move | — | `client/v2/contracts/S6-S9-signin-invite-home.md` | none | **O** (auth / invites contract) | — | §2.3 items 1–5 are written with shapes, error codes, the CSRF and state rules, and v1 compatibility; S9 lead/planner acks | — | — | 50 |
| **S6.1** | C4 naming + blank canvas + ⌘N | (feeds cf-blank, cf-offline-create) | `canvas-create.ts` (`nextFreeCanvasName`, `nameFromPrompt`, `BLANK_TEMPLATE`), new `plugins/design/templates/blank-canvas.tsx.template`, the `api.ts` `createCanvas` hunk only (kind `blank`, optional name, `fromPrompt`), the `canvas.new` handler in `client/v2/shell/menu-runner.js` (POST → open, no tree composer), `/design:new` skill line "name a new canvas per C4" | registry: new `canvas.new-brief` ("New brief board", minRole edit, agent `file:'canvas-tsx'`); `search-keywords.js` row (S1-owned) | S | — | `POST /_api/canvas {}` → "Untitled canvas", then "Untitled canvas 2"; ⌘N opens the new blank canvas in under 1 s; the 01/02 prompts name "Landing page", "Poster" / "Open studio", "Logo ideas"; "New brief board" still makes the brief board | `canvas-name-c4.test.ts` (today 400 → red); `name-from-prompt.test.ts` (12 EN + CZ fixtures incl. "Plakát na zápas v sobotu" → "Plakát", a prompt with no noun → Untitled); `create-canvas-kinds.test.ts` (blank parses and renders zero artboards) | — | 110 |
| **S6.2** | A new project with no canvases | 05/es-project-new, 01/cf-blank, 02/ob-local-first | new `client/v2/create/{empty-project.jsx,use-project-empty.js}` on the S11.1 kit (`Empty size:'canvas' spot:'ai'`, the prompt box, "Start with an empty canvas ⌘N", no toolbar); the Canvases-panel line "No canvases yet." via the kit (small hunk in S1's `canvases-panel.jsx`) | lead: mount slot in `client/shell/viewport.jsx` for "project has 0 canvases"; copy ids in S11's `empty-copy.js` (S11 file) | S | S6.1, S11.1, S11.2 | A fresh project shows the 05 card; ↵ in its prompt creates a canvas from the sentence (S6.3 path); ⌘N → a blank canvas with S11.2's line; Share cluster reads *Local project* | `v2-empty-project.test.tsx` (no toolbar; the button is absent for Can view; the ↵ path calls create with `fromPrompt`) | rewrite `onboarding.e2e.ts` step "local project → first canvas" (S6.8 owns the lane) | 70 |
| **S6.3** | Intent consumer + first draft | 01/cf-ai-drafting, 02/ob-ai-connect, ob-first-draw, ob-sig-draw, ob-edge-ai-missing | new `client/v2/create/{take-intent.js,first-draft.js}` (take on boot + on `shell://intent`; create-canvas → `POST /_api/canvas {kind:'blank', fromPrompt}` → open → `maude:ai-send`; create-empty; import-brand / import-figma → `import.*`); the `AI_SEND_EVENT` listener hunk in `client/v2/ai/AiChatIsland.jsx`; `plugins/design/skills/design/SKILL.md` § "A first draft from Home" (add every artboard empty with kind and size first, then fill big before small, words last); toast "<project> is your first project, on cloud.maude.sh." + Rename | Rust (L4, opus review): `validate_intent` accepts the four kinds (`home.rs`), `cargo test intents_kinds`; registry `home.ask` (V2-1.1 §5.9 row: agent `file:'canvas-tsx'` + `design:design`) | S | S6.1, S5.6, S5.11, S5.13, S5.15 | Home ↵ → the target tab opens the new canvas and the run starts in under 1.5 s (measured, fake agent); a reload does not re-run the intent; a Can view project refuses with the role line; first send with no Claude → S5's ConnectSheet, and Cancel leaves an empty ready canvas; ⌘Z takes back the whole draft (S5.15) | `v2-take-intent.test.ts` (taken once; prompt never in `location`; unknown kind dropped); `first-draft-brief.test.ts` (skill text names the order); `cargo test intents_kinds` | `home.e2e.ts` + step "sentence → new canvas in target tab" (fake ACP) | 120 |
| **S6.4** | Home page v2 | 01/cf-home-prompt, 11/pn-home, 11/pn-home-search, 05/es-home-cloud, 05/es-home-local, 05/es-home-shared | `client/home/home-app.jsx` (split), new `client/home/{HomeAsk,TargetChip,Starters,Shelves,SharedWithYou}.jsx`, new `client/home/home-starters.js`, `home-model.js` (target default, offline filter, shared rows, "3 new this week"), `home.css` | registry `home.search`, `cloud.open-remote` (V2-1.1 §5.9 rows); Home ⌘N = `menu://action canvas.new` on Home → `create-empty` intent (no new id) | S | S6.1, S6.3 (e2e), S11.1 | The question uses `--type-3xl` rounded semibold; ↵ sends; the chip menu lists projects on this Mac + cloud with a copy + "a new project"; offline it lists only this Mac and greys "not on this Mac yet"; three starters; Shared with you uses ghost cards plus "Nothing shared with you yet." with no button; projects are grouped by account with the person's face circle; every V2-3.3 `home-*` testid is re-emitted | `home-target-chip.test.ts` (default = most recent open; offline filter; "a new project" / "a project on this Mac" words); `home-starters.test.ts`; `home-ask-send.test.tsx` (Tauri stub: `open_project` gets `intent`, the URL has no prompt) | `home.e2e.ts` (extended) | 140 |
| **S6.5** | Home routes: sign-in + invite proxy | (feeds ob-first-launch…edge-timeout, ob-invite-landed) | new `home/{signin,invite}.ts`; `home/routes.ts` (specs `/_home/cloud/signin/{start,poll,cancel}`, `/_home/invite/{peek,accept}`) | none (Home's own table) | **O** (credentials: device code, per-profile cloud.json) | S6.0, S6.7 (profile id) | The device code never leaves the Home process; `poll` answers `pending\|done{email, landing?}\|expired\|cancelled`; a second start cancels the first; `accept` returns only a handoff code; every new route is refused without the page secret | `home-routes-guard.test.ts` (enumerates the table; red until each new spec is guarded); `home-signin.test.ts` (wrong state, expiry, profile path from Rust only); `home-invite.test.ts` (other-account 403 passes through unchanged) | — | 120 |
| **S6.6** | Home routes: hub, AI, CLI, What's New | (feeds ob-adv-sheets, ob-edge-whats-new) | new `home/{hub,ai,cli,whats-new}.ts`; `home/routes.ts` specs `/_home/hub/{test,prepare}` (TeamProjects door logic → `prepareManagedProject`), `/_home/ai/{status,connect}` (readiness + the Claude install/login module), `/_home/cli/{status,install}` (Q13), `/_home/whats-new` (feed + seen in ui-prefs, Q11) | `client/whats-new-seen.js` migration (shared client file, small) | **O** (password + spawns on a privileged origin) | S6.5 (same table, serial) | The hub password is posted once and never stored by Home; Test connection probes `/health` only; CLI install never follows or overwrites a non-link; a project tab and Home share one seen version | guard test (as S6.5); `home-hub.test.ts`; `home-cli-install.test.ts` (refuses a regular file at `~/.local/bin/maude`); `whats-new-seen-shared.test.ts` | — | 110 |
| **S6.7** | Rust: Home sign-in profiles, auth/invite links, intent kinds | (feeds S6.5/S6.8/S6.11) | `apps/desktop/src-tauri/src/{profiles.rs,deep_link.rs,home.rs,windows.rs}`: `home_cloud_sign_in_prepare({profile?, forInvite?})` → profile id, `home_cloud_signed_in({profile})` (lastSignInProfile, `shell://state`), `maude://auth/{done,cancelled}?state` → Home only (`auth://return`), `maude://invite/<id>` → Home (`invite://open`), `open_project` `target.thread?`; permissions TOML + Home runtime capability | L4 review: capability + `windows.rs` caller-check list | **O** (Rust / Tauri, deep links, profiles) | S6.0 | A forged `auth/done` only triggers a poll; `cancelled` with a wrong state is a no-op; an invite link reaching a project window is re-routed to Home; Home cannot pick a profile that holds another account without getting a fresh one | `cargo test home_signin_profile_rules`, `deep_link_auth_state`, `invite_link_to_home`; clippy | `tabs-identity` lane: two-account invite step (with S6.11) | 120 |
| **S6.8** | Sign-in card + first-run states on Home | 02/ob-first-launch, ob-home-new, ob-local-name, ob-adv-open, ob-edge-offline, ob-edge-timeout, ob-edge-other-mac, ob-edge-whats-new | new `client/v2/signin/{SignInCard.jsx,signin-model.js,signin.css}` (exported for S11.14 and S9.20); Home mount via S6.4's slot; the create-local sheet "Create a local project" (Name, hint, Advanced Location + "Choose another folder…"); the Advanced options flyout (5 rows, closed next time); toasts "Signed in. What you make now lives on cloud.maude.sh." / "Signed in — your 2 cloud projects are here."; the Home What's New line | registry `home.signin` ("Sign in to cloud.maude.sh", agent `human:'accounts'`); `whats-new.json` pending entry for the v2 Home (lead) | S | S6.4, S6.5, S6.6, S6.7 | The card shows only on first run (no project, no account); afterwards a quiet "Sign in to cloud.maude.sh" sits top right; waiting = "Waiting for your browser…" + Cancel + "Open the page again" + "Signed in on another device? Use a code instead"; cancel (app or page) restores the card at once; after 10 min, "Sign-in didn't finish" + "Nothing changed on this Mac. Try again whenever you like."; offline swaps the buttons and wakes by itself | `signin-model.test.ts` (state machine; a wrong-state cancel is ignored; the timeout; offline → online); `home-first-run.test.tsx` | **rewrite `onboarding.e2e.ts`** as the Home first run (no `MAUDE_FORCE_ONBOARDING`): card → Just a local project → name → tab on the empty canvas; cloud leg in `wdio.cloud` against a fake control plane | 130 |
| **S6.9** | Advanced sheets | 02/ob-adv-sheets | new `client/v2/onboarding/{HubSheet,FolderGithubSheet,ConnectAiSheet,CliSheet,FigmaSheet}.jsx` + `onboarding.css` (mono only inside these bodies; title verb = primary button); exported for S11.14; Figma opens the target project with the `import-figma` intent | registry `hub.connect`, `project.open-github`, `ai.connect`, `cli.install` (human agents; ⌘K keywords "hub", "figma", "api key") | S | S6.6, S6.8, S5.13 | "Connect to your own hub" → Test connection reads "Reachable — hub 1.4" → Connect opens the managed copy as a tab; Connect AI reuses ConnectSheet + the API key option; Install the maude command shows real status and installs; every sheet has Cancel | `v2-onboarding-sheets.test.tsx` (title verb = button; no token or password echoed back in the DOM) | `team-project.e2e.ts` leg "hub from Home" | 130 |
| **S6.10** | GitHub from Home | (completes ob-adv-sheets' GitHub segment) | Rust `github_repos({profile})`, `github_clone({fullName, profile}) → root` (`oauth.rs` / new `github_home.rs`; clone into `~/Maude/<repo>` with C4 " 2"); the `FolderGithubSheet` GitHub tab | L4 capability review | **O** (Rust, tokens) | S6.9, S6.7 | The repo list comes from REST in Rust; the token never reaches JS (test); a private repo clones and opens as a tab; "New project on GitHub — private by default" reuses the existing create | `cargo test github_home_token_never_serialized`, `clone_name_collision` | — | 110 |
| **S6.11** | Invite landing + two accounts | 02/ob-invite-landed, ob-home-team, ob-edge-accounts | new `client/home/invite-flow.js` + `InviteSheet.jsx` ("Open the invite as you@work-studio.cz?" → Open · Cancel); `invite://open` → peek → profile match → accept → `prepareCloudLink` → `managed_project_open` → `open_project target {canvas, thread}`; deferred path: `landing` from the first sign-in; in the project: Preview + Comment tool with the thread open (S1.18) + toast "Tereza invited you here — her comment is on the poster." | — | **O** (invites, accounts, deep links) | S6.0, S6.5, S6.7, S6.8, S9.14, S1.18 | A matching profile lands on the comment with the reply field focused; another account → the sheet → a new profile in its own tab, and other tabs unchanged; a canvas the person cannot see lands on the project only; next time Home shows the team project with its faces | `invite-flow.test.ts` (match / mismatch / signed-out / dead invite); `cargo` from S6.7 | new `invite-landing.e2e.ts` on a local cell (Node 24, memory) | 130 |
| **S6.12** | Render-error card (C5) | 01/cf-render-error | new `client/v2/create/{render-error.jsx,use-render-error.js}` (mounts S11's `CanvasErrorCard kind:'render'`, "Last good version · 6 Oct, 14:05" from S1.13, **Go back to 14:05** = `history.go-back` (a new version), Show details fold, `onAskAi` pre-fills "Ask AI to fix it"); silent during this Mac's own run on the canvas; cold load uses the dimmed index thumbnail | **lead: dgn c2s `render-error {file, message}`, `render-ok {file}`**; **L1**: emit both from `CanvasErrorBoundary` (`canvas-comment-mount.tsx`) and retire the amber "holding last good render" toast for the shell card (the toast stays only while a run is live) | S | S11.7, S1.13, S5.3 (run registry) | A planted runtime throw shows the card over the dimmed last render; Go back restores and the toast reads "Went back to 14:05"; during an AI run on that canvas no card shows, and it appears if the run ends broken | `v2-render-error.test.tsx` (hidden while `runs.mine` has this canvas; the time in words); `render-signal.test.tsx` (boundary posts `render-error` once per failure, `render-ok` on recovery) | `app-boots-and-renders-canvas.e2e.ts` + a broken-canvas step | 100 |
| **S6.13** | Offline create, durable | 01/cf-offline-create | `sync/accepted-link.ts` `queueCreate` writes to the outbox before the 25 ms window (V2-1.14 §d, if V2-2.8 has not landed it); offline Home targets (S6.4 filter) | none | **O** (sync plane + outbox) | V2-2.16 outbox, S5.6 (queued prompt) | ⌘N offline in a linked project → a canvas kept on this Mac, which syncs on reconnect exactly once; the prompt shows "Queued — sends when this Mac is online."; a crash inside the window loses nothing | `accepted-link-create-durable.test.ts` (V2-1.14 §7); `offline-create-both-directions.test.ts` (desktop-offline create → cloud, and cloud create while the desktop is offline → desktop; memory: test both directions) | `cloud-attach.e2e.ts` + offline step | 110 |
| **S6.14** | `GET /api/home` on cloud | (feeds es-home-shared, ob-home-team) | new `apps/cloud/home-api.mjs` (+ test) per V2-1.1 §5.7: `projects[]`, `shared[]` only the caller's grants, link grants dropped when off or expired, effective role = max, `grantedAt` | S9: route registration in the cloud router | **O** (cloud + ACL, V2-1.16 L14) | S6.0, S9.8 | Home's Shared with you lists Tereza's share; a grant to someone else never appears; the old `/api/projects` fallback still works | `cloud/test/home-api.test.mjs` (per role; a planted foreign grant → red); v1 desktop check | `s9-cloud-pages.md` scenario + Home step | 110 |
| **S6.15** | Retire the v1 first-run doors; empty scaffold; nothing-deleted | — (closes the D11 / D13 S6 halves) | delete the `OnboardingWizard` mount + `MAUDE_FORCE_ONBOARDING` boot path (Rust hunk in `lib.rs`, L4 review); `scaffold-design.ts` stops seeding (Q10) + Help › Help and guides "Add the guide canvases to this project"; `nothing-deleted.json` v2 fields for every OnboardingWizard / CreateProject-door / CloudBar device-dialog entry and the D11 / D13 S6 parts | registry `help.add-guides` (human); `app.jsx` residue (lead): the `firstRun` branch | S | S6.8, S6.9, S6.11 | The nothing-deleted test stays 100 %; no v2 path mounts the wizard; a new project has 0 canvases; Help adds the two guides | `scaffold-empty.test.ts` (red today: three seeded canvases); `check-v2-nothing-deleted` | all lanes that seeded Welcome.tsx updated | 90 |
| **S6.16** | First-canvas journey evidence | 01/cf-select-tweak, cf-sticky-comment, cf-add-artboard, cf-duplicate-width, cf-duplicate-done, cf-frames-text, cf-status-words | `.ai/scenarios/maude-v2/s6-first-canvas.md`, `apps/desktop/e2e/scenarios/first-canvas.e2e.ts`, evidence under `.ai/plans/notes/v2-evidence/S6.16-*` | none | S | S2.2, S2.8, S2.10, S2.12, S4.8, S4.12, S5.11, S5.15, S9 comments, S6.3 | Every listed row is `verified` with hash-pinned evidence (Home sentence → canvas → select → F → duplicate at Laptop → text in place → sticky → comment → status words), or a named gap row | — | `first-canvas.e2e.ts` (fake ACP); an agent-driven variant is S12's | 80 |

## 4. Ledger coverage check

**Canvas 01, package "S6, S1, S5" (20 rows).** S6 verifies 12:

| Row | Slice |
| --- | --- |
| cf-home-prompt | S6.4 |
| cf-ai-drafting | S6.3 |
| cf-blank | S6.2 |
| cf-render-error | S6.12 |
| cf-offline-create | S6.13 |
| cf-select-tweak, cf-sticky-comment, cf-add-artboard, cf-duplicate-width, cf-duplicate-done, cf-frames-text, cf-status-words | S6.16 |

The other 8 go elsewhere:

- **S1:** cf-big-tree (S1.1), cf-panel-search and cf-open-big (S1.3), cf-search-k (S1.4).
- **S5.15:** cf-ai-done, cf-undo-before, cf-undo-ai, cf-busy.

**Canvas 02, package "S6, S9" (22 rows).** S6 verifies 17 (S9 Q5):

| Slice | Rows |
| --- | --- |
| S6.8 | ob-first-launch, ob-home-new, ob-local-name, ob-adv-open, ob-edge-offline, ob-edge-timeout, ob-edge-other-mac (§2.2 note), ob-edge-whats-new |
| S6.3 | ob-ai-connect, ob-first-draw, ob-sig-draw, ob-edge-ai-missing |
| S6.11 | ob-invite-landed, ob-home-team, ob-edge-accounts |
| S6.2 | ob-local-first |
| S6.9 | ob-adv-sheets |

S9 verifies the other 5: ob-signin-browser, ob-invite-page, ob-local-share, ob-local-moved, ob-settings.

**Rows other packages assigned to S6:**

- 11/pn-home and pn-home-search → S6.4 (S1 Q11).
- 05/es-home-cloud, es-home-local and es-home-shared → S6.4; es-project-new → S6.2 (S11 §4.2). **The lead re-tags
  these four rows' `package`.**
- es-landing, es-canvas-ai and es-canvas-three stay with S11 (S11.1 / S11.2).

**Rules:**

- **S6 closes `00/rule/a-way-in-without-ai`.** "Start with an empty canvas ⌘N" sits on Home (S6.4) and on an empty
  project (S6.2); ⌘N makes a blank canvas (S6.1).
- **S6 contributes evidence** to:
  - `ai-not-connected-yet` (S6.3, Home's first send; S5 closes);
  - `save-status-shown-not-operated` (S6.16 via cf-status-words). Nobody claims to close it: S6 closes it unless
    the lead names another owner.
- `the-empty-canvas-line` and the words rules stay S11's.

**Home rows:**

- **G0-D/D11:** S6.8 supplies the browser sign-in sheet with "Use a code instead"; S11.14 closes the row.
- **G0-D/D13:** S6.8 supplies the Home first-run line and the What's New line; the row closes with V2-7 and S11.
- **G0-D/D12:** S11. S6.9's HubSheet is the "Add a team server…" sheet S11.14 mounts.

## 5. Risks and run order

**Risks:**

- **The Home server gains credential routes** (device code, hub password, AI login, CLI install, GitHub). Answers:
  - every route goes in `home-routes-guard.test.ts` (it enumerates the table);
  - the wave-B security fan-out reviews S6.5, S6.6, S6.7, S6.10 and S6.11 together;
  - nothing credential-shaped is ever returned to the page.
- **`maude://auth` links are forgeable by any web page.** Answers:
  - a link only nudges;
  - `cancelled` needs the attempt's state;
  - `done` only triggers a poll the app would do anyway.
- **An intent starts an AI run.** Only Home parks intents (W1); the consumer re-validates the kind; the prompt is
  capped at 4000 chars and never in a URL.
- **Dependency on S9 cloud work** (S9.14, S9.20, invite peek/accept, `landing`). The client slices feature-detect a
  404 and degrade to local-only or the device code. S6.11 is the only slice blocked on S9.14.
- **Shared-file contention.** Answers:
  - `home-app.jsx` (S6.4 → S6.8 → S6.11) and `home/routes.ts` (S6.5 → S6.6) run serially;
  - `api.ts` (one hunk, S6.1), `AiChatIsland.jsx` (one listener, S6.3) and `canvases-panel.jsx` (S6.2) are touched
    only after their owner merges.
- **Seeding change (S6.15).** Fixtures and lanes that expect Welcome.tsx break. S6.15 sweeps them in the same change.
- **Builds.** `dist/` is rebuilt by the lead after each client slice (rule 6).

**Order** (∥ = separate worktrees, no shared files):

1. **S6.0** first (an S9.14 prerequisite too).
2. **S6.1 ∥ S6.7 ∥ S6.13 ∥ S6.14** (after S9.8).
3. **S6.5** (after S6.0 and S6.7), then **S6.6**. In parallel: **S6.3** (after S6.1 + S5) and **S6.4** (after S6.1).
4. **S6.2** (after S11.1 / S11.2) ∥ **S6.8** (after S6.4–S6.7) ∥ **S6.12** (after S11.7 + S1.13 + the lead's dgn
   patch).
5. **S6.9** (after S6.8), then **S6.10**.
6. **S6.11** (after S9.14 + S1.18).
7. **S6.15**, then **S6.16** last (after the S2 / S4 / S5 / S9 parts land).

Critical path: S6.0 → S6.7 → S6.5 → S6.8 → S6.11 → S6.15. Total ≈ 1 830 turns over 17 slices. Eight are Opus:
S6.0, S6.5, S6.6, S6.7, S6.10, S6.11, S6.13 and S6.14.
