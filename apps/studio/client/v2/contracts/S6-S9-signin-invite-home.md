# S6 ↔ S9 — sign-in return links, invites, `GET /api/home`, background move

Writer: **S6.0** (contract only, 2026-10-18). Signers: S9 (planner / lead relay). Coded against by S6.5, S6.7, S6.8,
S6.11, S6.14 (desktop + Home) and S9.14, S9.16, S9.20 (cloud pages, Share sheet). Sources: `S6-slices.md` §2.1 Q1–Q4,
Q8, Q12 and §2.3; `S9-slices.md` Q5, Q6 and "Interface S6 codes against"; `V2-1.1-home-window.md` §5.7–§5.8;
`V2-1.7-roles-acl.md`; `V2-1.14-outbox.md` §8 "S6".

## 1. Question

S6.0 row: write §2.3 items 1–5 with shapes, error codes, the CSRF and `state` rules and v1 compatibility, reconciled
with what is already built on `feat/maude-v2` (S9.8 landing, links, `maude_pending_invite`; S9.6/S9.6b hub doors;
S3.7b return-to follow form).

## 2. What exists today (read from the tree, 2026-10-18)

| Piece | Where | State |
| --- | --- | --- |
| Device flow | `apps/cloud/device-auth.mjs` `handleDeviceAuth`: `POST /auth/device/code` → `{device_code, user_code, verification_url: <origin>/activate?code=<user_code>, interval: 5, expires_in: 900}`; `POST /auth/device/token` → 202 `{pending, interval}` · 400 `{error:'expired'}` · 200 `{token:'mpt_…', account:{email}}`; `/activate` redirects a signed-out browser to `/login?next=<path+search>` | built (Phase 23 C) |
| Return-to on cloud | `apps/cloud/auth-routes.mjs` `safeNext` / `isSameOriginPath` (same-origin relative path, no `//`, no `\`) | built — this IS the "return-to.mjs" the S9 plan names for cloud |
| Return-to on a hub | `apps/hub/src/return-to.mjs` `validateReturnTo` (`/?open=<rel>[&present=follow]`, S3.7b, branch `s3-7b`) | cell/self-hosted browser lane only — **not** used by the account sign-in |
| Pending invite | `apps/cloud/invites.mjs`: `GET /invite/<id>` sets `maude_pending_invite=<id>` (30 min, HttpOnly, Secure, Lax); `redeemPendingInvite(env, request, account)`; `landingForInvite(db, {email, projectId})` | built (S9.8) — **`redeemPendingInvite` has no caller yet** (grep: only `handoff-v2.test.mjs`) |
| Handoff landing | `apps/cloud/handoff.mjs` `mintHandoffCode(…, {canvas})` stores `landing`, exchange re-checks with `seesCanvas` and returns `landing` additively (v1 claims get no key) | built (S9.8) |
| Invite row | `project_invites (id, project_id, email, role, created_at, expires_at, redeemed_at, revoked_at, canvas_path)` (D1 v17). **No inviter, no thread.** | built |
| Hub doors | `/join`, `/studio/signin`, OIDC callback mint through `peerTokenDoor` (S9.6b, branch `s9-6b`) | self-hosted only; S6 does not touch them |
| Studio sign-in | `http.ts` `/_api/cloud/signin/{start,poll}` → `cloud/endpoints.ts` `signinStart`/`signinPoll` (device code returned to the page) | project lane; Home gets its own (S6.5) |
| Deep links | `deep_link.rs` `parse_link`: only `maude://open/<project>…` routes to a project; everything else goes to Home | built; S6.7 adds `auth/*` and `invite/*` |

kg: `decision:maude/v2-S9-deferred-deep-link-server-side` (cookie + additive `landing`), "Desktop signs into Maude
Cloud natively — rides the device-flow pattern", `decision:maude/v2-S6-new-project-local-first`. Nothing here
re-decides them.

## 3. Options (only where the tree forced a choice)

**Where the sign-in `landing` comes from** (S6 §2.3 item 2 puts it on the device-token reply; S9 Q6 put it on the
handoff exchange — both are kept, they answer different moments):

1. **Derive at token time** from the newest invite this account's e-mail redeemed in the last 30 min, re-checked
   with `loadClaim` + `seesCanvas`. No migration. *Chosen.*
2. Store it on the `device_codes` row at `/activate` approval. Needs a D1 column and binds the landing to one browser
   session; a person who redeemed in another tab ten minutes earlier would get none. Rejected.
3. Put a handoff code in the `maude://auth/done` URL. A URL would carry a claim on the account (S6 Q1). Rejected.

**Separator for invite thread data** — a new D1 column on `project_invites`, not a JSON blob in `canvas_path`
(R3-style: no new shape in an old field).

## 4. Decision (DDR draft)

**Context.** First launch signs in on cloud.maude.sh through the device flow, and an invite must survive
download → install → sign-in. The cloud already has the cookie and the handoff `landing`; it has no return link into
the app, no inviter/thread on invites, no app-facing invite API, no `/api/home`, and no move route.

**Decision.**
1. The app opens `<verification_url>&state=<32 lowercase hex>[&invite=<uuid>]`. The cloud carries `state` (and
   `invite`) through `/login?next=` untouched; the `/activate` done page and every Cancel link navigate to
   `maude://auth/done?state=<s>` / `maude://auth/cancelled?state=<s>`. Those links are **nudges only** — `done` makes
   Home poll now, `cancelled` with the current attempt's state restores the card. No credential ever rides a URL.
2. `POST /auth/device/token` 200 gains optional `landing {project, canvas?, thread?}` (option 1 above).
3. `GET /api/invites/<id>/peek` (no auth, shows only what the public invite page shows) and
   `POST /api/invites/<id>/accept` (Bearer `mpt_…`) → a handoff code, traded on the existing link lane.
4. `GET /api/home` keeps the V2-1.1 §5.7 shape; S6.14 builds it in `apps/cloud/home-api.mjs`.
5. `POST /_api/cloud/move` is a studio project route; until it exists (404) a Home-created project stays local.

**Consequences.** One D1 migration (v18: `project_invites.invited_by`, `project_invites.thread`). The sign-in
completion paths gain a `redeemPendingInvite` call. v1 apps see byte-identical answers (no `state` → no links; extra
JSON keys ignored).

**Rejected.** A handoff code in `maude://auth/done` (account claim in a URL); storing landing on `device_codes`
(migration, narrower); an e-mail or project name in any `maude://` URL (privacy, Q12); provisioning a cloud project
before the first canvas (S6 Q4); a cloud-side "cancel this device code" form (adds a column for a 15-minute TTL that
already ends it).

## 5. Contract

### 5.1 Sign-in return links and `state`

| Step | Who | Exact behaviour |
| --- | --- | --- |
| 1 | Home server (S6.5) | `POST <cloud>/auth/device/code {client:'Maude on macOS'}`. Generates `state = 16 random bytes → lowercase hex (32 chars)` per attempt; keeps `{deviceCode, state, startedAt}` in the Home process only. A second `start` cancels the first (its state is dropped). |
| 2 | Home → Rust | opens `verification_url + '&state=' + state [+ '&invite=' + id]` in the system browser. `invite` only when Home is handling an invite (S6.11), `^[0-9a-f-]{36}$`. |
| 3 | cloud `/activate` GET | accepts `state` iff `/^[0-9a-f]{32}$/`, `invite` iff `/^[0-9a-f-]{36}$/`; anything else is **dropped silently** (page works, no app links). Signed out → `302 /login?next=<encodeURIComponent(path+search)>` (today's line; `isSameOriginPath` already admits it). `invite` present → also sets `maude_pending_invite=<id>` exactly like `GET /invite/<id>` (one redemption path). |
| 4 | cloud `/login`, `/signup`, Google leg | `inviteHintFor(next)` extended: also reads `invite=` from a `next` of `/activate?…` → pre-fills/preselects that invite's address server-side. The e-mail is never put in a URL. |
| 5 | cloud, every sign-in completion | password login, signup, Google callback and `/activate` POST approval each call `redeemPendingInvite(env, request, account)` once a session/account exists, and append its `clear` cookie. |
| 6 | cloud `/activate` POST approve → done page | renders "You're signed in — go back to Maude." plus, when a valid `state` was posted (hidden field), `<meta http-equiv="refresh" content="0;url=maude://auth/done?state=<s>">` and a visible **Open Maude** link to the same URL. |
| 7 | cloud Cancel | `/activate` and `/login` (when `next` is an `/activate?…state=` path) show **Cancel** = a plain link `maude://auth/cancelled?state=<s>`. No server state changes; the device code dies by TTL. |
| 8 | Rust (S6.7) | `maude://auth/done?state=<s>` and `maude://auth/cancelled?state=<s>` → Home window only (`auth://return {kind:'done'|'cancelled', state}`), never a project window; malformed state → dropped. |
| 9 | Home server (S6.5) | `done` with any state → one immediate poll (a forged `done` costs one poll). `cancelled` with the **current** state → attempt cancelled, card back; wrong/old state → no-op. Own wait: 10 min (device TTL 15) → `expired`. |

Page headers stay as today (CSP `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'`, `no-referrer`,
`no-store`). The `maude://` scheme is never placed in `Location` headers — only in page markup.

Home routes (S6.5, Home's own table, all behind the page secret per V2-1.1 §5.8.1):

```ts
POST /_home/cloud/signin/start  {profile?: string, forInvite?: string}
  → 200 {ok:true, userCode:string, state:string, expiresIn:600}     // device code stays in the Home process
  → 502 {ok:false, reason:'unreachable', error:'Maude Cloud could not be reached. Try again in a moment.'}
POST /_home/cloud/signin/poll   {state:string}
  → 200 {status:'pending'} | {status:'done', email:string, landing?:Landing} | {status:'expired'} | {status:'cancelled'}
  → 409 {reason:'stale-state'}            // not the current attempt
POST /_home/cloud/signin/cancel {state:string} → 200 {ok:true}
type Landing = { project: string; canvas?: string; thread?: string };
```

### 5.2 `landing` on the device-token reply

```js
// POST /auth/device/token → 200
{ token: 'mpt_…', account: { email }, landing?: { project, canvas?, thread? } }
```

- Computed at token time by a new `landingAfterSignIn(env, { accountId, email, now })` in `invites.mjs`: the newest
  `project_invites` row with `email = account.email` and `redeemed_at > now − 30 min`; then `loadClaim(db, project,
  accountId)` must be ok, `canvas` kept only if `accessOf(verdict).seesCanvas(canvas)` (else `{project}` alone),
  `thread` kept only with its canvas. No row / no claim → key absent.
- Additive; a v1 desktop (`signinPoll` reads `token` + `account.email` only) is unaffected.
- The handoff-exchange `landing` (S9.8) stays the per-project landing; the device-token `landing` is the
  "which project first" hint for a fresh install. Home opens it through the normal `prepareCloudLink` →
  `managed_project_open` → `open_project({target:{canvas, thread}})`.

### 5.3 Invite peek and accept (cloud, built by S9 — see §8)

D1 **v18**: `ALTER TABLE project_invites ADD COLUMN invited_by TEXT;` (account id) and `ADD COLUMN thread TEXT;`.
`POST /api/access/invite` (access-forward) records `invited_by = actor.id` and accepts optional `thread`
(`/^[A-Za-z0-9_-]{1,64}$/`, only together with a `canvas`; else 422 `bad-thread`). Rows from before v18 have NULLs.

```
GET /api/invites/<id>/peek            (no auth; rate-limited 30/min/IP on the plane's budget)
  200 { projectName, fromName: string|null, email, role: 'observer'|'viewer'|'member',
        canvas?: { path, name }, thread?: string }
  404 { reason:'gone', error:'This invitation link is not valid. Ask the person who invited you for a new one.' }
  429 (Retry-After)
POST /api/invites/<id>/accept         (Authorization: Bearer mpt_…; X-Maude-Access: 2)
  200 { code: 'mhc_…', landing: { project, canvas?, thread? } }
  401 { reason:'signed-out' }                     // no/invalid token
  403 { reason:'other-account', email }           // the invite's address, already shown by peek
  404 { reason:'gone', error: <same sentence> }
  426 ACCESS_VERSION_REFUSAL                      // no X-Maude-Access: 2 and the invite is canvas-scoped
```

- `peek` returns exactly the invite page's facts. `fromName` = the inviter's `accounts.name` (null when unset or
  pre-v18 — never the inviter's e-mail). `canvas.name` = file stem of `canvas_path`. Same 404 body for wrong,
  expired, revoked and spent ids (DEAD_LINK rule).
- `accept`: live invite + `account.email` equals the invite e-mail (case-insensitive) → `redeem` → `mintHandoffCode(env,
  {account, projectId, surface:'app', declaredAccess: 2, canvas: invite.canvas_path})` → the code is traded by
  Home through the existing `/_home/cloud/prepare` / `openManagedCode` lane. **Idempotent**: an invite already
  redeemed by this same account in the last 30 min answers 200 with a fresh code; by anyone else → 404.
- `mhc_` codes keep their 120 s TTL and single use. A viewer on the app lane works because `declaredAccess: 2`.
- Self-hosted hubs have no `maude://invite`; their invites stay on the hub `/join` door (S9.6b).

### 5.4 `GET /api/home` (cloud, S6.14)

Exactly V2-1.1 §5.7 (Bearer `mpt_…`; `projects[]`, `shared[]` only the caller's own grants, link grants dropped when
the link is off/expired, effective role = max(project, canvas), `grantedAt`, `grantedBy` as a name). Additions:

- 401 `{reason:'signed-out'}` → Home marks that profile "Signed out" (it does not delete `cloud.json` on its own;
  the person chooses Sign in again). 404 → fall back to `GET /api/projects` (no `shared`).
- `ownerName` / `grantedBy` are `accounts.name` or null; **no e-mail of anyone but the caller** (L17).
- `Cache-Control: no-store`; Home caches 60 s per profile (V2-1.1 §5.7).

### 5.5 `POST /_api/cloud/move` (studio project route)

Main-origin only (not in `CANVAS_SAFE_API`, not in `routes/canvas-origin.ts`), `sameOriginWrite` +
`isTrustedRequestHost`, writer-registry class `local`, `access/request.ts` session class (owner of the folder).
Registered through `routes/index.ts` (`routes/cloud-move.ts`).

```
POST /_api/cloud/move {name?: string}     // name defaults to config.json project name
  200 {ok:true, project:string, state:'provisioning'|'ready'}     // idempotent per folder (repeat = same answer)
  401 {ok:false, reason:'signed-out'}
  402 {ok:false, reason:'plan', error:'Choose a plan to keep editing.'}   // S9.15 trial ended
  409 {ok:false, reason:'linked-elsewhere'}                              // already linked to another hub
  503 {ok:false, reason:'offline'}
GET  /_api/cloud/move → 200 {state:'idle'|'provisioning'|'linking'|'uploading'|'ready'|'failed', project?, error?}
```

- Progress lives in `_state/cloud-move.json` (an existing ignored runtime class — no DDR-115 list changes).
- Order: create the cloud project (`POST <cloud>/api/projects {name}` with the device token, S9.15 provisions the
  first one under the trial) → poll until `active` → raise the hub format marker (V2-1.12 §5.2) → `attach` → the
  normal seed-up. The canvas never waits on any step; a failure leaves the project local and `failed` with words.
- S6 calls it once after a Home create while signed in; S9.20's "Move to cloud…" calls the same route.
- 404 (route absent) → S6 keeps the project local, status word "This Mac only".

### 5.6 Invariants (each a test)

1. No `mpt_`, `mhc_`, `mdc_` value, e-mail or project name appears in any `maude://` URL the cloud renders.
2. `state` outside `/^[0-9a-f]{32}$/` never reaches markup (an injected `state="><…` renders no link).
3. A `cancelled` link with a stale state changes nothing in Home.
4. `landing` never names a canvas the claim cannot see; a revoked invite between redeem and token gives no landing.
5. `peek` for a dead id and a wrong id are byte-identical.
6. `accept` with another account's token never redeems the invite.

## 6. Evidence

Read-only reconciliation (no prototype was needed): `grep -rn redeemPendingInvite apps/` → only the export and
`handoff-v2.test.mjs`; `project_invites` columns from `migrate.mjs` v17; `device-auth.mjs` reply shapes; `deep_link.rs`
`parse_link` routes non-`open` hosts to Home; `accounts.name` exists in `schema.mjs`.

## 7. Tests that will prove it (red first)

| Test | Fails today because |
| --- | --- |
| `cloud/device-auth.test.mjs` + state: `/activate?code=X&state=<hex>` done page links `maude://auth/done?state=<hex>`; bad state → no link | no state handling |
| `cloud/invites.test.mjs` + `landingAfterSignIn`: redeemed 10 min ago → landing; 31 min → none; canvas not seen → `{project}` | function absent |
| `cloud/auth-routes.test.mjs`: password login with the pending cookie redeems and clears it | no caller |
| `cloud/invites-api.test.mjs`: peek fields + identical 404s; accept 200/403/404/426, idempotent re-accept | routes absent |
| `cloud/migrate-v18.test.mjs`: invited_by/thread added, old rows NULL, idempotent | v18 absent |
| `cloud/test/home-api.test.mjs` (S6.14) per role; planted foreign grant → red | route absent |
| `studio/test/cloud-move-route.test.ts`: idempotent, 401/402/409/503, not canvas-origin reachable | route absent |
| `home-signin.test.ts` (S6.5) stale state 409, cancel rules; `cargo test deep_link_auth_state` (S6.7) | — |

## 8. Feeds (and follow-up work)

- **S6.5 / S6.7 / S6.11 / S6.14** code against §5.1–§5.4 as written.
- **S9.14** builds §5.1 steps 3–7 (page bodies, Cancel, done page, hint) and **§5.3 + v18** (it owns `invites.mjs`
  and the invite page that shows "her comment"); it also wires step 5 (`redeemPendingInvite` callers) in
  `auth-routes.mjs` / `device-auth.mjs`, and §5.2 `landingAfterSignIn`.
- **S9.15** exposes `POST /api/projects {name}` (Bearer) for the trial-provisioned project §5.5 needs.
- **New task (L4/studio)**: `routes/cloud-move.ts` §5.5 — not in any slice today (S9.20 is UI only).
- Must not: put credentials or names in URLs; widen `CANVAS_SAFE_API`; add a `_*` runtime path.

## 9. Open questions (conservative default)

| # | Question | Default |
| --- | --- | --- |
| O1 | An invite to someone who **already has an account** creates no invite row today (`{id:null, added:true}`), so no link and no landing. | Keep. They see it in Home › Shared with you ("new this week"); S6.11's toast fires only for invite-row journeys. |
| O2 | Should Cancel also burn the device code server-side? | No — TTL (15 min) ends it; Home stops polling at once. |
| O3 | `fromName` when the inviter has no `name`. | null; Home says "You're invited to <project>". |
