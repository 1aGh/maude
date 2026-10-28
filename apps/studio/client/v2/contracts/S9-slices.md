# S9 — Share, collaboration, cloud: slice plan (Phase 5 planning spike)

Package `S9` · plan row "S9 Share, collaboration, cloud" · canvases `10 Share and Collaboration` (20 artboards),
web parts of `02 Onboarding`, viewer parts of `05 Empty States` · contracts V2-1.7 (roles/ACL), V2-1.16 (leak
matrix), V2-1.14 (outbox), V2-1.9 (history.aside), V2-1.11 (verbs), V2-1.12 (formats), V2-4.9 (shell parity) ·
Gate 0 A6, A18, A19, A3, C7, C30, C32, C33 · owner steps G0-E E1 (mail domain), E2 (live payments), E3 (OAuth),
E6 (staging cell).

## 1. Scope and what Phase 4 already ships

Scope:

- **Hub/ACL:** four roles with `observer` = Can view (V2-1.7); canvas grants with server-computed closure; every
  V2-1.16 leak row closed at both doors; A19 (Can view refused every byte route; courtesy limit, not DRM).
- **Doors:** invites, links, access requests, the comment door, presence (`summon`) gating, presentation-route and
  ballot support for S3/S4.
- **Control plane:** the authority half of the same (D1, `/internal/projects/:p/access/*`, link redeem).
- **cloud.maude.sh:** sign-in, invite and link pages, account pages (people, billing + trial A3, Macs, download
  everything, delete), mention e-mails + preferences.
- **Client:** the Invite-first Share sheet, Ask to edit, access states, presence (Follow / Go to / Bring everyone
  here), comments v2, mention delivery, offline / back online / object conflict, local → cloud.

Phase 4 already ships:

- Share cluster (`client/v2/shell/share-cluster*.jsx`) with faces, save/access word, Comments count, mode switch,
  Share and Ask to edit buttons. The Ask to edit button is a stub toast at `share-cluster-host.jsx:166`, and
  `share.open` opens the old `client/share-dialog.jsx`.
- Comments island (`client/shell/comments-panel.jsx`, right side).
- `isEditRole` fail-closed gate in `sync/hubs-config.ts`; registry `minRole` gating plus `role-gate.js`.
- The empty `test/_role-refusals.ts` table (V2-1.11 rule 7, vacuous until S9 declares `server`).
- An outbox with no senders (`http.ts:1589`).
- `notify.rs` Dock badge set (V2-3.5).

**Nothing of V2-1.7 §5 is in the tree yet:** no `apps/studio/access/`, H-1 is still `claims.role ?? 'member'`
(`hub/src/cloud-identity.mjs:127`), no `tokens.access`, and no `roles-v2`. V2-2.18 did not carry the matrix.

## 2. Open questions resolved here

| # | Decision | Why |
| --- | --- | --- |
| Q1 | The **server half of V2-1.16 studio rows (L6–L13, L15, L16) runs on L4 now**, not on L2. It covers `apps/studio/access/*` and the per-role suites. Call sites in `http.ts`, `server.ts`, `api.ts` and `ws.ts` are lead patch requests. | Hidden ≠ refused (rule 12): Can view must be refused on the server before any client draws it. L2 is the UI lane and is busy with S1 in wave A. |
| Q2 | The **control-plane access authority** (`apps/cloud` D1 tables, forward endpoints, link redeem, requests) is part of the "hub" bullet and runs **L4 now**. cloud.maude.sh *pages* run in wave B. | The plan row puts invites, links and requests under **hub**. A cloud cell cannot honour a grant that the control plane cannot store. |
| Q3 | **No second 1.x release is needed for S9.** v1.9.x desktops are protected by format (old verifier `malformed` on `m2.`; mint door 426 without `X-Maude-Access: 2`). `accessFor` ships with v2 only. | V2-1.7 §8 assumed V2-2.18 would carry `accessFor`; it didn't. The format fence already fails closed. No release without Michal. |
| Q4 | Comments filters are **Open · Mine · Resolved · All**, default Open. The inventory's "All dropped" is overruled. | CONTRACT §6 (C7, D8) outranks the inventory. |
| Q5 | Of the 22 `S6, S9` rows in canvas 02, **S9 verifies five**: `ob-signin-browser`, `ob-invite-page` (web pages), `ob-local-share`, `ob-local-moved` (Move to cloud lives inside the Share sheet, CONTRACT §6) and `ob-settings` (the account block and its cloud.maude.sh pages). **S6 verifies the other 17.** | Each row is assigned to the slice whose landing makes it verifiable. S6's row owns the desktop journey; S9's row owns the cloud.maude.sh pages and the Share sheet. |
| Q6 | **Deferred deep link** (invite → install → sign-in → the comment) is **server-side**. The invite page sets a 30-minute `maude_pending_invite` cookie on cloud.maude.sh. Sign-in redeems it into the account. The handoff exchange response gains `landing: { project, canvas?, thread? }` (additive), and S6's Home opens it. | No fingerprinting or clipboard tricks. Works across a fresh install. A v1 app ignores the unknown key. |
| Q7 | **Mention delivery is decided on the hub.** It parses mentions from the comment op (never from a client-stated list). It sends `maude.mention { thread, canvas, from }` to the mentioned person's live connections, which drives the toast and count, and the native notification + Dock badge when the window is unfocused. Only when the person has **no** live connection to the project does it forward to the control plane for e-mail. One e-mail per mention, never a digest. AI comments never mention (C3). A self-hosted hub sends no mention e-mail in v2.0. | That is the inventory's three-path rule. The hub is the only place that knows "app closed". Self-hosted has no mail transport. |
| Q8 | **Unread / mention markers** live per person in the existing ui-prefs lane (`/_api/ui-prefs`, capability `session`). There is **no new `_*` runtime path**, so the four DDR-115 lists are unchanged. | Rule 9 is avoided rather than paid. Unread is per Mac, like today's comment counts. |
| Q9 | **Presence fields** (awareness, additive): `artboard`, `idleSince`, `surface: 'app' \| 'browser'`, `inComments`, `summon?: { id, at }`, and `role` (`owner` · `member` · `viewer` · `observer`): the collab room stamps each connection's role from that socket's own access onto the awareness states it owns and overwrites any client-sent value; a connection with no access carries no role (P8 G2 lead decision (b)). So presence is names + colour + role, and the faces' menu reads "· Can edit" (`roleWord`). Idle is 3 min without pointer or key input (cursor greys and shrinks to an initial). The hub (S9.5) and the studio room bridge (S9.11) strip `summon` from connections lacking `summon`. The latest `summon.at` on a canvas wins. Each follower leaves with esc; Stop clears the field. | C33; V2-1.7 §5.5. v1 peers render only the fields they know, which is the mixed-peer test. |
| Q10 | **Object-level conflict unit = element id** (V2-1.4), detected as a three-way overlap on one element at proposal replay (DDR-241 / DDR-116 card, now per element). **Keep both** = duplicate the element with a fresh id beside it (S2's ⌘D op). The losing body is recorded with `history.aside` (V2-1.9 §4.9) so Version history · this sticky lists it with Restore. | Reuses V2-1.4, V2-1.9 and V2-1.14 G4. Invents no merge engine. |
| Q11 | **Trial A3:** the trial belongs to the account and starts at its first sign-in (`accounts.trial_started_at`, 14 days, no Stripe object). The first cloud project provisions a workspace without checkout. "Choose a plan" = today's checkout converting to a paid subscription. At expiry with no subscription, `decideAccess` marks every project the account owns `paused`. The cell answers reads and exports, and refuses writes and sync with `402 { reason: 'plan', error: 'Choose a plan to keep editing.' }`. A v1 desktop sees a refused write, retried by the outbox. Stripe stays in test mode (E2). | It is signed A3. 402 is distinct from 403, so a v2 client shows the plan callout and never renews credentials on it. |
| Q12 | **Hub v2 routes go through one table**, `apps/hub/src/routes-v2/index.mjs`, with per-area files. Each row is `{ method, path, cap, scope: 'none'\|'canvas'\|'filtered'\|'project', handler }`. `server.mjs onRequest` calls it once (S9.3), and the hub U3 classification test reads it. | `server.mjs` is 4 141 lines and five slices would otherwise edit it in parallel. This mirrors studio `routes/index.ts` (V2-2.5). |
| Q13 | **The `roles-v2` capability is advertised by a lead step**, only after S9.5, S9.8 and S9.12 are green (all L-rows plus both canary sweeps). Until then `/health.access` reports `roles: ['owner','member','viewer'], scopes: ['project']`. The Share sheet hides Can view, This canvas and links on that hub. | V2-1.7 §5.8 step 4. One flip, auditable. |

**Interface S6 codes against (Q6), defined here:**

- **Sign-in:** the app opens `https://cloud.maude.sh/login?next=<return-to>`. `return-to.mjs` validates it.
  - The page has its own **Cancel**, which navigates to `maude://auth/cancelled?state=<s>`. The app restores the
    card at once (ob-edge-timeout). The app's own 10-minute wait stays S6's.
  - "Use a code instead" is today's device code (`/activate`).
- **Invite:** `https://cloud.maude.sh/invite/<id>` keeps today's URL; the v1 e-mails already sent keep working.
  - "Open in Maude" goes to `maude://invite/<id>`.
  - The download path goes through Q6.
- **Link:** `https://cloud.maude.sh/l/<id>.<secret>` (V2-1.7 §5.6).
- **Exchange:** `POST /auth/handoff/exchange` gains an optional `landing`. Nothing else changes.

**Cross-lane contracts to write first** (neighbour writes the file; S9 codes against it):

| Contract file | Writer | Needed by | Content |
| --- | --- | --- | --- |
| `apps/studio/client/v2/contracts/S3-present-session.md` | S3 spike/planner | S9.13 | `/present/<canvas>` auth (which link roles may open it), the presenter-position stateless message, Catch up |
| `apps/studio/client/v2/contracts/S4-S9-votes-comments.md` (written; was `S4-votes-ballots.md`) | S4 planner | S9.13, S9.7, S9.9, S9.22 | ballot shape, timer, reveal, the `vote` capability, secrecy lanes; A18: the hub holds ballots in linked projects, local = UI-hidden; comment `from` + sticky ↔ comment; D5 |
| `apps/studio/client/v2/contracts/S1-canvas-row-slots.md` | S1 planner | S9.21, S9.24 | Canvases panel row meta + foot slots ("Shared with you · Can view", "not sent" / "sending", "In the trash · open here", the canvas-only foot); Trash store id + `POST /api/trash/clear` route (the gate is S9's: `delete`); Version history calling `access/filters.ts visibleHistoryRows` |
| (no file — a patch note in S5's plan) | S5 | S9.9, S9.11 | `/_ws/acp` + `/_api/acp/*` refused without `edit` (D2) through `access/request.ts acpRefusal`; V2-1.15 run records filtered for canvas-only (L13) |
| (no file — a patch note in S7's plan) | S7 | S9.22 | the timeline renders comment markers from `commentsAt(videoArtboard)`; print mm needs the artboard's physical size from the kind props |

## 3. Slices

Lanes: **H** = L4-hub now (beside wave A) · **C** = L4-cloud / native wave B · **U** = L2-client wave B (after
S1). Every H/C slice, and every U slice touching invites, links, access or sync, is a risk class, so it runs on
**Opus** (agent-routing). Every hub/cloud change is additive.

Every H slice extends **`apps/hub/test/v1-client-compat.test.mjs`** (created in S9.2). It runs a frozen 1.9.1
client script against the new hub: `/auth/login` without `X-Maude-Access`, v1 token parse, journal pull, file PUT,
Yjs auth and the comment path. That slice's door must answer exactly as v1.9.1 does for owner, member and viewer.

Lead patches are listed by file and symbol. The builder sends the patch text and does not edit the file.

| id | lane | title | ledger rows made verifiable | files owned | lead patch requests | model | deps | est. turns |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S9.1 | H | Access core: one matrix, claim, closure | — (substrate) | new `apps/studio/access/{roles,scope,closure}.ts`; `apps/hub/src/role-matrix.mjs` (re-export); `apps/cloud/{project-access,membership}.mjs` (import the matrix, delete the copies) | `http.ts` `localDepsFromSource`: move into `access/closure.ts` and import it back | Opus | — | 80 |
| S9.2 | H | Credentials v2 + mint door | — | `apps/hub/src/{cloud-identity,tokens,render-token,auth-routes,browser-auth}.mjs`; `apps/cloud/{cell-token,handoff}.mjs`; new `apps/hub/test/v1-client-compat.test.mjs` | — | Opus | S9.1 | 130 |
| S9.3 | H | A19 on the hub: capability gate, byte routes, v2 route table | — (A19 hub half) | new `apps/hub/src/{access-gate.mjs, routes-v2/index.mjs}`; `server.mjs` `onRequest` gate + `readOnlyAllowedPath` only; `studio-manifest.mjs`; `studio-proxy.mjs` `upstreamHeaders` (inject `x-maude-access`) | — | Opus | S9.2 | 120 |
| S9.4 | H | Canvas scope, peer door, files: L1 + L3 + L5 | — | new `apps/hub/src/access-files.mjs`; `journal.mjs`, `file-manifest.mjs`, `file-door.mjs`, `upload-sessions.mjs`, `files-ctl.mjs`, `document-events.mjs`, `assets.mjs` (scope calls only) | — | Opus | S9.3 | 130 |
| S9.5 | H | Canvas scope, peer door, docs: L2 + L4 + L6 + L11 hub + hub canary sweep | — | new `apps/hub/src/access-docs.mjs`; `server.mjs` `onAuthenticate` + `beforeHandleAwareness` bodies; `project-transactions/hub-integration.mjs`, `kernel.mjs` (scope check); `history.mjs` | — | Opus | S9.3 | 140 |
| S9.6 | H | Access API, self-hosted authority + notices + people | — | new `apps/hub/src/routes-v2/access.mjs`, `notices.mjs`; `users.mjs`, `invites.mjs` (`access` column, canvas scope), `revocations.mjs`; `server.mjs` `/health` body only | — | Opus | S9.3 | 140 |
| S9.7 | H | Comment door + comment ops + mentions + comments substrate | (D8 server half) | new `apps/studio/comments/{ops,mentions,anchors}.ts`, `apps/studio/schema/comments.*`; `apps/studio/bin/comments.*` (reply / resolve / reopen / `add --as-ai`); new `apps/hub/src/routes-v2/comments.mjs`; `plugins/design/skills/design/_guide-05*` comments section | `api.ts` `commentsAddReply` / `backfillComment` call the new `ops.ts` (≤ 20 lines); registry `agent` rows for the comment verbs (`actions/agents.ts`) | Opus | S9.3 | 130 |
| S9.8 | H | Control-plane access authority | — | `apps/cloud/migrate.mjs` (v17), new `apps/cloud/{access-forward,links}.mjs`; `project-routes.mjs`, `invites.mjs`, `handoff.mjs` (`access` + `landing`), `worker.mjs` (mount) | — | Opus | S9.2 | 140 |
| S9.9 | H | Studio local gate + browser door; D2 / D3 / D5 | — (A19 studio half) | new `apps/studio/access/request.ts`; `sync/hubs-config.ts` (`accessFor`, D3), `cloud/renew.ts` (D3); `test/_role-refusals.ts` rows | `http.ts` `guardedRoutes` / `guardedFetch` (+ `canvasScopeRefusal`), `READ_ONLY_ALLOWED_WRITES` split into SESSION / COMMENT / EXPORT, `projectReadOnly` derived; `server.ts` `withSession` → AsyncLocalStorage, `/_ws/acp` upgrade + `/_api/acp/*` via `acpRefusal` | Opus | S9.3 | 120 |
| S9.10 | H | Studio canvas-only filters: L6 git + L7 + L8 + L9 + L10 | — | new `apps/studio/access/filters.ts` | `http.ts` `/_config`, `/_comments-all`, `/_index-data`, `/_system-data`, git log / diff routes, `/_api/export-jobs` POST target; `api.ts` `buildIndexData`, `loadAllComments` (call the filters) | Opus | S9.9 | 130 |
| S9.11 | H | Studio canvas-only filters: L11 + L12 + L13 + L15 + L16 | — | `collab/awareness-bridge.ts`, `collab/ai-activity.ts`; `access/filters.ts` (add `visibleTo`) | `ws.ts` `broadcast` / `broadcastHmr` (call `visibleTo`); `http.ts` `isCanvasSafeRoute` + `serveHistoricalCanvas` (render-token `g` against the closure), `/_sync-status` | Opus | S9.9 | 130 |
| S9.12 | H | The ACL gate: studio canary sweep, U3, U7 parity, revert guard | — (V2-1.16 bar) | new `apps/studio/test/{acl-canary-sweep,access-route-classes,acl-u7-parity,acl-revert-guard}.test.ts`; a test seam in `access/filters.ts` | — | Opus | S9.4, S9.5, S9.6, S9.10, S9.11 | 110 |
| S9.13 | H | Hub support for S3 / S4: presentation route + hub-held ballots (A18) | (rows stay S3's / S4's) | new `apps/hub/src/routes-v2/{present,votes}.mjs` | — | Opus | S9.3 + both contracts | 90 |
| S9.14 | C | cloud.maude.sh pages: v2 shell, sign-in, invite, link pages | 02/ob-signin-browser, 02/ob-invite-page | `apps/cloud/{pages,brand,auth-routes}.mjs` (page bodies), `invites.mjs` (landing page), `links.mjs` (pages); `apps/hub/src/join-page.mjs` (self-hosted invite words) | — | Opus | S9.8 | 120 |
| S9.15 | C | Trial A3 + "Choose a plan" pause | — (A3) | `apps/cloud/{accounts,billing,checkout,checkout-routes,pricing-core,provisioning,stripe-webhook,project-access}.mjs`; `apps/hub/src/access-gate.mjs` (`paused` → 402 `plan`) | — | Opus | S9.8, S9.3 | 140 |
| S9.16 | C | Account pages: people, billing + plan, Macs, download everything, delete | — (feeds ob-settings) | `apps/cloud/{people-page,dashboard,device-auth,project-admin}.mjs`, new `apps/cloud/account-pages.mjs` | — | Opus | S9.14, S9.15 | 120 |
| S9.17 | C | Native: cell tabs for the browser door + mention notification / Dock badge | — (feeds co-ask-edit, co-mention-notify) | `apps/desktop/src-tauri/src/{windows.rs, tabs.rs, notify.rs}` | — | Opus | S9.2 (409 shape) | 120 |
| S9.18 | C | Mention e-mails + preferences | 10/co-mention-notify | `apps/cloud/{email,email-tokens}.mjs`, new `apps/cloud/mentions.mjs` (`/internal/mentions`, prefs table + page); `apps/hub/src/routes-v2/comments.mjs` (forward when no live connection) | — | Opus | S9.7, S9.14, S9.17, S9.22 | 130 |
| S9.19 | U | Share sheet: invite, roles, scope, people, pending | 10/co-share-sheet, 10/co-share-roles | new `client/v2/share/{share-sheet,invite-row,people-list,role-menu,share-model}.*`, `share.css`; new `routes/share.ts` (desktop proxy of `/api/access/*` to the linked hub); retire `client/share-dialog.jsx` (nothing-deleted rows re-homed) | registry: `share.invite`, `share.set-role`, `share.remove`, `share.resend` (agent `human: invite / roles`, `minRole` owner, `server` route); `http.ts:1589` outbox sender `share.invite`; `menu-runner.js` `share.open` → new sheet | Opus | S1 (lane), S9.6 | 140 |
| S9.20 | U | Share links, Advanced, self-hosted, local → cloud, Settings account block | 10/co-share-advanced, 10/co-local-cloud, 02/ob-local-share, 02/ob-local-moved, 02/ob-settings | new `client/v2/share/{link-row,share-advanced,move-to-cloud}.jsx`; new `client/v2/settings/account.jsx` | registry `share.link-settings`, `share.copy-link` (exists) gains `server`; Settings sheet mounts `account.jsx` (S11's file — lead or S11 patch) | Opus | S9.19, S9.8, S9.16 | 130 |
| S9.21 | U | Ask to edit + access states + browser view + trashed while open | 10/co-ask-edit, 10/co-access-ends, 10/co-browser-view, 10/co-trashed | new `client/v2/access/{ask-to-edit,access-card,link-off-card,trashed-banner,access-client}.*` | registry `share.ask-to-edit` (minRole view, `request`), `share.request-approve` / `-decline` (owner); `http.ts:1589` sender `share.ask-to-edit`; `share-cluster-host.jsx:166` stub → the action | Opus | S9.19, S9.6, S9.17, S1 (Trash + row slots) | 130 |
| S9.22 | U | Comments v2: panel, thread, mentions in app, video time, print mm | 10/co-comment-thread, 10/co-comment-video, 10/co-comment-print | new `client/v2/comments/*` (replaces `client/shell/comments-panel.jsx`); `comments-overlay.tsx` (thread popover, mention popover with roles); `canvas-comment-mount.tsx` | registry `comments.filter-*` (or a param), `comments.open-thread` (deep link), existing `view.comments` / `tool.comment` keep their ids | Sonnet (substrate is S9.7's) | S9.7, S9.6 | 140 |
| S9.23 | U | Presence: faces menu, people list, Follow, Go to, Bring everyone here + spotlight | 10/co-presence, 10/co-follow, 10/co-bring, 10/co-spotlight, 10/co-twelve | new `client/v2/presence/*`; `use-collab.tsx` (awareness fields Q9); `participants-chrome.tsx` (retired into `presence/`, its testids re-emitted) | registry `presence.follow`, `presence.go-to`, `presence.bring-everyone` (minRole edit, cap `summon`, agent `human: summon`), `presence.stop` | Sonnet | S9.5, S9.6, S9.11 | 140 |
| S9.24 | U | Offline, back online, object conflict with Keep both | 10/co-sync-offline, 10/co-sync-back, 10/co-conflict | new `client/v2/sync-states/{offline-foot,back-online,conflict-card}.*`; object-conflict detection in the sync replay module the builder locates (`sync/`, DDR-116 path), with a new `sync/object-conflict.ts` | Canvases row meta via S1's slot; `history.aside` from V2-1.9 (S1) | Opus | S1, S2 (⌘D), V2-1.14 outbox | 150 |

### Done-when and red-first tests per slice

Every route test is per role: owner · member · viewer · observer, plus canvas-only where the row applies.
"v1" means the `v1-client-compat` extension described in §3.

- **S9.1:** V2-1.7 R1–R6 hold; the `viewer` row equals the pre-v2 snapshot; `localDepsFromSource` has one home.
  - Tests: `studio/test/access-roles.test.ts`, `access-scope.test.ts`, `access-closure.test.ts` (Alligators
    fixture); `hub/test/role-matrix.test.mjs` (extended); `cloud/test/one-matrix.test.mjs` (grep-pin: no local
    `ROLES` / `CAPABILITIES`).
- **S9.2:** `m2.` tokens round-trip, and a frozen copy of today's `verifyAccessToken` answers `malformed`.
  - H-1: no role means refused.
  - `rotateToken` keeps `access`; render token floor is `observer` and carries `g`.
  - Mint door table: 200 / 426 / 409 browser-door; `viewer` is admitted on the app lane only when the client declares.
  - Tests: `access-token-v2`, `tokens-access`, `render-token-floor`, `auth-login-role` (extended),
    `cloud/test/handoff-v2`; v1 (created).
- **S9.3:** an observer, including one sending a cookie as Bearer, gets 403 on `/_project-file/`,
  `/api/history/file`, `/assets/<key>` and `v1/{lane,blobs,bootstrap}`; a viewer gets 200.
  - `studio-manifest` export rows refuse observer; `/_api/canvas-source` and `/_api/git/diff` are `export`.
  - `/api/studio/comments` is gone; every hub path has a class.
  - Tests: `access-byte-routes`, `access-http-gate`, `studio-manifest` (extended), `hub/test/access-route-classes`; v1.
- **S9.4:** a token scoped to canvas A lists, pulls and probes only A's closure; B is answered exactly as a missing
  path (U1); `head` does not move on a B-only write.
  - Tests: `acl-l1-file-plane`, `acl-l3-poke`, `acl-l5-assets` (hub); v1.
- **S9.5:** B's document is refused with today's reason; the kernel answers `rejected / not-in-scope`; history is
  filtered with subjects rewritten (U4); a viewer's `summon` field never reaches a peer.
  - The hub canary sweep (`acl-canary-sweep.test.mjs`) is green and finds no `canary-b`.
  - Tests: `acl-l2-docs`, `acl-l4-accepted`, `acl-l6-history`, `acl-l11-awareness`, `access-awareness-summon`,
    `acl-canary-sweep`; v1.
- **S9.6:** the `/api/access/*` routes of V2-1.7 §5.6 work on a self-hosted hub.
  - 422 `link-role` and `role-unsupported`; 409 `pending`.
  - A demotion revokes and sends `maude.access`, and the kick waits `switchGraceMs`, so a flush lands first. That is
    the server half of "Your last changes were saved first", tested with a write in flight.
  - Owners get `maude.access-request`; a non-owner `people` answer has no e-mails (L17); `/health.access` posture.
  - Tests: `access-api`, `acl-l17-people`, `access-notices`; v1.
- **S9.7:** a viewer desktop's comment lands in the Y lane with the session's author, and a forged author is ignored.
  - Observer → 403. Ops on someone else's comment other than reply / resolve / reopen → 403.
  - Mentions are parsed on the server and `maude.mention` reaches only the mentioned person's connections.
  - Anchors `t` (video seconds) and `mm` (print) pass the V2-1.12 mixed v1/v2 test in both directions.
  - The comments schema validates; the verbs pass parity, and `pendingMax` stays 0.
  - Tests: `access-peer-door` (comment rows), `comments-ops`, `comments-anchors-mixed`, `ai-parity-coverage`
    (extended); v1.
- **S9.8:** the D1 v17 rebuild copies every row verbatim and is idempotent.
  - The forwarder re-decides the actor from D1 (a forged role is ignored); audit row; invite cap of 50 per day.
  - Link redeem needs sign-in, never lowers a role and ends with the link; expiry sweep; `/internal/access-changed`.
  - v2 tokens are minted only for `roles-v2` cells.
  - Tests: `migrate-v2-roles`, `access-forward`, `links`.
- **S9.9:** `x-maude-access` is read per request.
  - Observer: every EXPORT and COMMENT write → 403; SESSION writes → 200.
  - Viewer: comment and export 200, edit 403. Canvas-only member: A 200, B 403 `not-in-scope` with the same body as a
    missing file.
  - ACP is refused without `edit` (D2). `hubs.json` holding `observer` is enforced.
  - D3: a record without a role is read-only until a sign-in heals it, and renewal never stores `undefined`.
  - Every `_role-refusals.ts` row is exercised (V2-1.11 rule 7, now non-vacuous).
  - Tests: `access-local-gate`, `access-acp-refused`, `sync-access-v1-compat` (frozen 1.x `isHubReadOnly`),
    `access-role-matrix` (extended with observer).
- **S9.10:** as A-only, `/_index-data`, `/_system-data`, `/_config`, `/_comments-all`, git log and usage contain no
  B; an export targeting B → 403; project export is refused for canvas-only sessions.
  - Tests: `acl-l6-git`, `acl-l7-export` (canvas-only rows; S8 owns the everyone-fixes), `acl-l8-tree`,
    `acl-l9-usage`, `acl-l10-comments`.
- **S9.11:** an A-only socket receives no B frame; AI activity on B is invisible; an A-only render token gets 404 for
  `B.tsx` and B's assets; `/_sync-status` → 403 with no slug.
  - Tests: `acl-l11-presence`, `acl-l12-broadcast`, `acl-l13-ai`, `acl-l15-canvas-origin`, `acl-l16-sync`.
- **S9.12:** the studio canary sweep is green; U7 parity holds for owner, member and viewer; removing any row's
  check turns the sweep red (rule 10, proven); every studio route and ws type has a class.
  - **Then the lead flips `roles-v2`** (Q13).
- **S9.13:** `/present/<canvas>` opens for the link roles named in S3's contract, and Catch up carries the
  presenter's position; ballots stay secret until reveal in cloud projects (A18), and a viewer cannot read
  another person's ballot.
  - Tests: `present-route`, `votes-ballots` (per role); v1.
- **S9.14:** sign-in page (Google / e-mail, page Cancel → `maude://auth/cancelled`, return-to); invite page (who
  invited you, to what, her comment, one download, Open in Maude, Q6 cookie); "This link was turned off." page;
  copy per CONTRACT §3–§4.
  - Scenario: `.ai/scenarios/maude-v2/s9-cloud-pages.md` (agent-browser on a local cell, Node 24).
  - Tests: `cloud/test/pages-v2` (CSP, no-referrer, the cancel URL), `invites` (extended: landing).
- **S9.15:** a new account carries a 14-day trial with no Stripe object; the first cloud project provisions; at
  expiry, owned projects pause (reads and exports 200, writes 402 `plan`); Choose a plan converts in Stripe test
  mode.
  - Tests: `trial-a3`, `checkout` (extended), `hub/test/access-plan-paused`; v1 (a v1 write → refused, nothing lost).
- **S9.16:**
  - People shows grants and v2 role words.
  - Billing shows plan and trial days left.
  - "Your Macs" lists device tokens with revoke.
  - Download everything (owner-only zip per project) and Delete the account (confirm, revoke, purge schedule).
  - Tests: `account-pages`, `people-page` (extended).
- **S9.17:** a 409 browser-door opens a `c-*` cell tab inside the cloud zone (no file-plane copy); a mention in an
  unfocused project posts one notification and joins the Dock badge set; a click opens the thread.
  - Tests: cargo tests for the tab kind and the badge set; e2e `cell-tab-browser-door.e2e.ts`.
- **S9.18:** with no live connection, a mention sends one e-mail (fake transport; E1 is owner-run); with a live
  connection, none.
  - Preferences page plus an unsubscribe token; "Change which e-mails you get in Settings › General."
  - Tests: `mentions`, `email` (extended), `hub/test/mention-forward`.
- **S9.19:** Share opens on Invite (rule `share-opens-on-invite`).
  - Scope segment from `/health.access.scopes`; role menu with the CONTRACT words; Make owner; Remove → dialog.
  - Pending invites show "expires in N days" and Resend; an offline invite queues with "Invites send when this Mac
    is online."
  - Hidden ≠ refused: each new action has a `_role-refusals` row.
  - e2e: rewrite `share-link.e2e.ts` → `share-sheet.e2e.ts`; nothing-deleted test stays 100 %.
- **S9.20:** Advanced: link rules, app link (`share-app-url`), local link (`share-local-url`), GitHub invite (takes
  over `project.share-github`), Where it syncs, roles matrix; the self-hosted variant from `/health.access`.
  - Move to cloud sheet + toast; Settings › General › Account block with "Free trial · N days left" and the five
    account links.
  - e2e: extend `cloud-attach.e2e.ts` (local → cloud).
- **S9.21:**
  - Petra (observer) sees Viewing, no toolbar and the tip; Ask to edit queues `share.ask-to-edit`.
  - The owner gets the toast → Review → request block → Let Petra edit; Petra gets "You can edit … now" and a
    toolbar after re-exchange.
  - Removed mid-edit: the last change lands, then the access card → Back to Home (Q6 of V2-1.7: the local copy is
    removed).
  - Link off → card. Trashed-while-open banner + Restore.
  - Rule `access-in-words` closes.
  - e2e: `share-roles.e2e.ts` (V2-1.7 §7).
- **S9.22:**
  - Filters Open · Mine · Resolved · All (re-emits `comment-filter-all`), grouped by canvas, Reopen, Delete own
    (D8 closes).
  - @mention popover with roles from `/api/access/people`; mention toast with Open plus the unread count on
    `share-cluster-comments-count`.
  - A video pin shows only at its time; print chip "14 mm from the left · 2 mm above the trim".
  - e2e: `comments.e2e.ts`.
- **S9.23:**
  - The face menu: "On A4 · plakát · Can edit", Follow, Go to, Bring everyone here.
  - Follow frame + pill, ending on esc / scroll / click.
  - Bring motion per spec: spring 420 ms, 40 ms stagger, reduced motion = appear.
  - Spotlight pill + Stop for all; people list "12 on …" with idle; C32 colours (never coral).
  - Mixed v1/v2 awareness test.
  - e2e: `presence-follow.e2e.ts` (two windows, V2-3.2 harness).
- **S9.24:**
  - Offline: "Offline — kept on this Mac", row "not sent", foot "14 changes since … — kept on this Mac", queued pin.
  - Back online: Syncing…, "sending", "Sending 14 changes · 9 sent", "Tereza changed this · 09:15", the toast with
    Show.
  - A concurrent sticky edit → the "2 versions" mark → card with Keep yours / Keep Jonas's / Keep both; the loser is
    in Version history · this sticky with Restore.
  - Tests: `sync-object-conflict` (both directions — memory: sync is asymmetric).
  - e2e: `offline-conflict.e2e.ts`.

## 4. Ledger coverage

Every `package: S9` artboard row is in exactly one slice:

| Slice | Rows |
| --- | --- |
| S9.14 | `02/ob-signin-browser`, `02/ob-invite-page` |
| S9.18 | `10/co-mention-notify` (verifiable only when toast + native + e-mail all exist: last landing) |
| S9.19 | `10/co-share-sheet`, `10/co-share-roles` |
| S9.20 | `10/co-share-advanced`, `10/co-local-cloud`, `02/ob-local-share`, `02/ob-local-moved`, `02/ob-settings` |
| S9.21 | `10/co-ask-edit`, `10/co-access-ends`, `10/co-browser-view`, `10/co-trashed` |
| S9.22 | `10/co-comment-thread`, `10/co-comment-video`, `10/co-comment-print` |
| S9.23 | `10/co-presence`, `10/co-follow`, `10/co-bring`, `10/co-spotlight`, `10/co-twelve` |
| S9.24 | `10/co-sync-offline`, `10/co-sync-back`, `10/co-conflict` |

That is 25 rows: all 20 `co-*` rows plus 5 `ob-*` rows.

**Assigned elsewhere:**

- **To S6:** the other 17 `02` rows (`ob-first-launch`, `ob-home-new`, `ob-ai-connect`, `ob-first-draw`,
  `ob-sig-draw`, `ob-invite-landed`, `ob-home-team`, `ob-local-name`, `ob-local-first`, `ob-adv-open`,
  `ob-adv-sheets`, `ob-edge-offline`, `ob-edge-timeout`, `ob-edge-other-mac`, `ob-edge-accounts`,
  `ob-edge-ai-missing`, `ob-edge-whats-new`). They are desktop journeys. S9 supplies Q6 `landing`, the page Cancel
  and the trial (S9.15).
- **To S11:** `05/es-viewer` and `05/es-edge-panels` are ledger-owned by S11 ("+ owners"). S9 supplies the observer
  and viewer server path (S9.9) and the Share sheet's empty people list (S9.19).

**Rule and home rows:**

- **S9 closes:**
  - `00/rule/share-opens-on-invite` (S9.19)
  - `00/rule/access-in-words` (S9.21)
  - `G0-D/D8` (S9.22)
- **S9 contributes; another package closes:**
  - `00/rule/moved-to-the-trash` (S1 closes). S9 supplies the `trash` / `delete` split in S9.3 and S9.9.
  - `G0-D/D12` (S11 closes). S9.21 supplies the access-status word that replaces CloudRoleBanner.
  - `G0-D/D11` (S6 / S11 close). S9.14 supplies the device-code page.
- **Owner steps:** E1 (S9.18 builds against a fake transport), E2 (S9.15 in test mode), E3 (S9.14 reuses the
  existing Google client), E6 (cloud verification on a local cell, Node 24).

## 5. Risks and run order

**Run order:**

- **H, now:**
  1. S9.1 → S9.2 → S9.3.
  2. Then in parallel worktrees: **S9.4 ∥ S9.5 ∥ S9.6 ∥ S9.7 ∥ S9.9**, plus **S9.8**, which is in `apps/cloud` and
     needs only S9.2.
  3. Then **S9.10 ∥ S9.11** (each needs only S9.9).
  4. Then S9.12, then the lead's `roles-v2` flip.
  - S9.13 waits for the S3 and S4 contracts.
- **C, wave B:**
  1. S9.14 ∥ S9.15 ∥ S9.17.
  2. Then S9.16.
  3. Then S9.18, last.
- **U, wave B (after S1):**
  1. S9.19 → S9.20 ∥ S9.21.
  2. S9.22 ∥ S9.23, any time after their H deps.
  3. S9.24 after S1 and S2.

**Why the parallel sets don't collide:**

- S9.4 and S9.5 each add their own module (`access-files` / `access-docs`) and touch disjoint handler files. In
  `server.mjs`, S9.5 owns only the two Hocuspocus hooks and S9.6 only `/health`; S9.3 lands the `routes-v2` table
  first.
- S9.7, S9.9 and S9.10 are in `apps/studio` but own disjoint new modules. Their `http.ts`, `api.ts` and `ws.ts`
  edits are lead patches, serialised by the lead.
- The single test lane (`scripts/v2-test-lane.sh`) is the real limit, so run at most two H builders at once. The hub
  and studio suites never run together (memory).

**Risks:**

- **Size.** There are 24 slices against an expected 12–20. The hub/ACL work is split per leak-row group because the
  V2-2.4b Opus builders overran at about 420k context. Merging S9.4 + S9.5 or S9.10 + S9.11 would repeat that.
- **v1 compatibility.** Any H slice that changes a v1 answer for owner, member or viewer is a red `v1-client-compat`
  (U7 / R3). The fleet is touched only by a release tag, and there is no release without Michal.
- **A3 trial cost and abuse.** Free cells for any sign-up. The default is one trial workspace per verified e-mail.
  **Ask Michal before any live rollout**; the live-payments plan E2 stays separate.
- **S9.24** depends on S1's slots and S2's duplicate op landing first. If either slips, S9.24 waits; it is not
  forked.
- **S9.17 (native)** shares `windows.rs` with any Phase 3 follow-up on L4. Sequence it after open L4 native work.
- **The closure scanner (G3)** misses dynamic references. The Share sheet warning (V2-1.7 Q9) is S9.19's.
- **The canary sweep** must enumerate the route tables, not a hand list. Otherwise a new route added by S1, S5 or S8
  escapes it. S9.12's U3 test is the guard, and every later lane hits it.

## Decisions

- `decision:maude/v2-S9-studio-acl-on-l4-now`
  - **What:** the server halves of the V2-1.16 studio rows and the per-role suites run on L4 now, not on L2.
  - **Why:** rule 12 (refuse on the server before the client draws it); L2 is the UI lane.
  - **Rejected:** waiting for L2 wave B.
- `decision:maude/v2-S9-control-plane-authority-is-hub-scope`
  - **What:** the D1 access tables and forwarders are built with the hub (L4 now); cloud pages wait for wave B.
- `decision:maude/v2-S9-no-second-1x-release`
  - **What:** v1 desktops are protected by the format fence (`m2.` / 426); `accessFor` ships in v2 only.
  - **Rejected:** a 1.x compat release carrying the matrix.
- `decision:maude/v2-S9-hub-v2-route-table`
  - **What:** one `routes-v2` table with a scope column, called once from `onRequest`.
  - **Rejected:** more branches in `server.mjs`.
- `decision:maude/v2-S9-mentions-decided-on-hub`
  - **What:** mentions are parsed on the server, with live delivery first; e-mail goes only when there is no live
    connection; no e-mail from a self-hosted hub.
- `decision:maude/v2-S9-unread-in-ui-prefs`
  - **What:** unread and mention markers live in ui-prefs, so there is no new runtime-state path.
- `decision:maude/v2-S9-deferred-deep-link-server-side`
  - **What:** a pending-invite cookie, redeemed at sign-in, plus `landing` in the exchange response.
- `decision:maude/v2-S9-object-conflict-per-element-id`
  - **What:** the conflict unit is the V2-1.4 element id; Keep both = duplicate the element; the loser is recorded
    via `history.aside`.
- `decision:maude/v2-S9-trial-per-account-paused-402`
  - **What:** A3 is enforced as a per-account trial; at expiry, owned projects pause with 402 `plan`.
- `decision:maude/v2-S9-roles-v2-flip-by-lead`
  - **What:** `roles-v2` is advertised only after S9.5, S9.8 and S9.12 are green.
- `decision:maude/v2-S9-02-row-split`
  - **What:** S9 verifies 5 of the 22 `S6, S9` rows; S6 verifies 17.
- `decision:maude/v2-S9-comments-filters-include-all`
  - **What:** Open · Mine · Resolved · All, because CONTRACT §6 outranks the inventory.
