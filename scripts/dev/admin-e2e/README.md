# admin-e2e

Local end-to-end scenario harnesses for the admin surfaces. Each one stands up real processes on
loopback in a scratch directory, drives them over HTTP / WebSocket and through a real browser
(`agent-browser`), prints PASS/FAIL per scenario with its evidence, exits non-zero on any FAIL and
kills what it started by pid.

Always run through the test lane (one suite per machine):

```sh
FARM_LOCAL=1 scripts/v2-test-lane.sh -- node scripts/dev/admin-e2e/hub-scenarios.mjs
```

## `hub-scenarios.mjs` — the self-hosted team server

```sh
… hub-scenarios.mjs                  # everything, S1–S9 (about 80 s)
… hub-scenarios.mjs --only S3,S5     # just these
… hub-scenarios.mjs --keep-dir       # keep the scratch dir (logs/, shots/) even when green
… hub-scenarios.mjs --no-browser     # HTTP half only; browser scenarios then FAIL as "not run"
```

Needs Node 24, `bun`, `git`, `openssl` and `agent-browser` on PATH. A red run always keeps its
scratch directory and prints where.

### What it stands up

The shape of the production team server, read off its environment:

| Production | Here |
| --- | --- |
| `HUB_WORKSPACE_MODE=1`, `MAUDE_WORKSPACE_MODE=1`, `MAUDE_REPO_DIR` (a checkout with a design project) | the same, on a scratch git repo |
| `HUB_OIDC_MODE=hybrid`, issuer on its own domain, `HUB_OIDC_ALLOWED_DOMAINS` | hybrid, issuer `https://auth.example.test`, domain `studyfi.test` |
| `MAUDE_ADMIN_EMAIL` + `MAUDE_ADMIN_PASSWORD` seeded | seeded |
| `HUB_PUBLIC_URL` + `MAUDE_PUBLIC_CANVAS_ORIGIN` (same site, separate origins) | `studio.cell.localhost:<port>` + `canvas.cell.localhost:<port>` |
| `HUB_TRUSTED_PROXIES` (a reverse proxy in front) | both loopbacks trusted; every person sends their own `X-Forwarded-For` |
| `MAUDE_CELL_PAIRING=1`, supervised studio child | on, studio child ON |
| file / S3 backups | `file://` backups |
| `MAUDE_CLOUD_IDENTITY` unset | unset (S9 sets it on a second hub) |
| sign-in rate limits | ON — which is why each person has their own address |

The hub is its real entry point (`runAsMain`, through `apps/hub/test/fixtures/serve-team-server.mjs`).
Only the identity provider is a stand-in, in two halves: its token and key endpoints are the hub's
`oidcFetch` seam (the hub refuses a non-https or loopback issuer), and its sign-in **page** is a local
https server the browser reaches through a host-resolver rule, so the hub still sees the issuer it
was configured with. The page asks who you are every time.

Desktop peers are the studio server the desktop app runs as its sidecar
(`bun apps/studio/server.ts --root <scratch project>`), each with its own scratch `HOME` and
`hubs.json`.

### Scenarios

| | |
| --- | --- |
| S1 | Browser: the seeded admin signs in at `/admin` with the password (a session admin, no admin key), sees Overview, links their sign-in on Settings, signs out, comes back through the provider. The seeded password then no longer works. |
| S2 | Invite by email; the invitee opens `/join/<token>` in a clean browser, uses the provider button and lands signed in. No pending row; a member in People; `invite-create` + `invite-redeem` in the log, the invite value nowhere. |
| S3 | Browser: an invitation for a@ used while signed in at the provider as b@ gives a refusal naming a@; b@ gets no session and no account; the invitation stays open; "Use another account" then lets a@ in. |
| S4 | An uninvited person from the allowed domain under `ask` (pending → Let in → next sign-in works), `invite-only` (turned away, no row), `domain` (walks in as a member). An address outside the domain is refused and never queued in all three. |
| S5 | Desktop sign-in by browser hand-off, done as the app does it (`?client=desktop`, PKCE, loopback return, `/auth/desktop/exchange`), by an invitee in a real browser. The credential lists the project, opens a file and syncs; the code is single use. Then two linked folders for two people: a project comes down into an empty folder, a canvas edit goes A → hub checkout → B and B → hub → A, a design-system file crosses, the hub commits. A member's code-module write is refused (403), a write with no credential is refused (401). |
| S6 | Browser: a member signs in through the provider at the studio door; the shell mounts, lists the canvases, no "Opening…" after 20 s, the canvas frame is on the canvas origin, no page errors. |
| S7 | Role member → admin → member (sessions end each time, the next sign-in has the new rights), Turn off (sync connection closed, reconnect / browser session / desktop credential / new sign-in all refused), Turn back on, Sign out, Remove under `domain` (lands in Asks to join, does not walk back in), and the guards: an admin cannot demote / turn off / remove themselves, and nobody can do it to the only admin. |
| S8 | The hub's whole process group is SIGKILLed and started on the same data dir: people, links, invitations, settings and every log entry are intact, an invitation made before still works, the CSV download parses (RFC 4180) and has one row per event, desktop peers reconnect and an edit still crosses. |
| S9 | A second hub in the cloud-cell shape (`MAUDE_CLOUD_IDENTITY=strict`, the environment `apps/cells/cell-config.mjs` hands a cell): no session way in, no password, no invitation door, no provider sign-in, every people action 409, no 5xx across the sweep. |

Each scenario makes the people it needs, so `--only` works for any subset. S8 checks more when
S1, S3, S4, S5 and S7 ran before it in the same run.

### What it does not cover

- **`maude design link` itself.** The verb refuses to run in an AI session by design, and a hook
  blocks it there. Peers are linked by writing what the verb writes (`linkedHub` in the project
  config, the credential in a scratch `hubs.json`), as `scripts/dev/local-cell.mjs` does.
  `--cli-link` runs the real verb instead; use it from your own terminal. That branch has not
  been run.
- **The desktop's own sign-in code.** S5 replays the protocol of
  `apps/studio/sync/hub-browser-signin.ts` from this script. The studio's `/_api/hub-signin/*`
  routes are not driven: the studio accepts plain http only for a loopback host name, and this
  hub's public name is `studio.cell.localhost` so that the two origins are same-site.
- **Canvas pixels.** The canvas frame is another origin; S6 asserts the shell and the frame's
  address, not what the canvas draws.
- **Canvas-only access.** No admin route creates a canvas-only account on a team server, so the
  refused write in S5 is the member-versus-owner gate on code modules.
- **A real provider, real TLS, S3, the reverse proxy, e-mail delivery, the packaged desktop app.**
- **S9 runs without a studio child** and with a control plane that is not there.

---

# Maude Cloud scenarios (`cloud-scenarios.mjs`)

The control plane, a paying customer, a project, its people, the browser studio, the desktop
side and the operator — C1…C9, on this machine, from source. C9 is the operator's People in this project,
the read-only "See it as the owner does" view, Delete with Undo and the overview lists; C4 and C7
also drive the owner's People lists, a bulk role change and Make owner (offer, then accept) in the browser.

```sh
FARM_LOCAL=1 scripts/v2-test-lane.sh -- node scripts/dev/admin-e2e/cloud-scenarios.mjs
FARM_LOCAL=1 scripts/v2-test-lane.sh -- node scripts/dev/admin-e2e/cloud-scenarios.mjs --only C3      # or C3,C8
#   --keep      keep the scratch dir (D1, cell checkouts, desk folders, screenshots)
#   --verbose   cell and studio logs on stderr
```

About two and a half minutes. Exit code 1 when any scenario has a failed check. Needs Node 24
(the hub), `bun`, `agent-browser`, `openssl`, and the repo's `wrangler` + `miniflare`
(`pnpm install`). Every child is killed by pid / process group on exit, and everything lives in
one `maude-cloud-e2e-*` folder under the OS temp dir. Secrets are generated per run and never
written into the repo.

To poke at the same stack by hand: `node scripts/dev/admin-e2e/cloud-serve.mjs` (prints the
dashboard URL and a loopback control port for mail, D1, the cron and the operator list).

## What is real

| Part | How it runs |
| --- | --- |
| Control plane | `apps/cloud/worker.mjs`, bundled by `wrangler deploy --dry-run` (no upload), in local workerd with a local D1 and R2. The schema is created the way production creates it: by the cron handler. |
| Cell | `apps/hub/src/server.mjs` in workspace mode with its studio child, one per project, with the env `apps/cells/cell-config.mjs` `cellEnv()` derives and the config `/internal/cell-config` answers. Cloud identity, project tokens, the browser door, access forwarding and revocation sweeps are the product's own. |
| Desktop side | `apps/studio/server.ts` on a fresh folder; sign-in, project list and attach go through its `/_api/cloud/*` routes (`apps/studio/cloud/endpoints.ts`) — the code the app's sidecar runs. |
| Browser | `agent-browser`, one session per person. |

## What is a stand-in, and why

- **Miniflare instead of `wrangler dev --local`.** The Worker calls `api.stripe.com`,
  `api.resend.com`, `api.cloudflare.com` and `https://<project>.<CELL_ZONE>` by absolute URL; there
  is no base-URL seam for any of them. Miniflare's `outboundService` answers those fetches locally
  without touching product source. A host nothing local answers gets a 502 and is listed at the
  end of the run.
- **Stripe** — `cloud-stripe-standin.mjs`: customers, Checkout Sessions, subscriptions, the billing
  portal, invoices, and signed webhooks (`t=…,v1=…`). Its hosted Checkout page takes
  `4242 4242 4242 4242` (pays) and `4000 0000 0000 0002` (declined). Tax, 3-D Secure, dunning and
  proration are not modelled.
- **E-mail** — the `POST api.resend.com/emails` body is captured; nothing is sent.
- **Cloudflare** — the Workers custom-domain API is a registry; a project hostname routes only
  while its domain is attached. Container start, R2 and per-tenant R2 credentials are not there:
  a cell is a local process with a seeded git checkout and a `file://` backup target.
- **The edge** — one local TLS listener with a self-signed certificate (`*.localhost` names). The
  browser is started with `--host-resolver-rules="MAP * 127.0.0.1:<port>"`, so
  `checkout.stripe.com` is the stand-in and no name can reach the internet.
- **Time** — workerd has no settable clock. "The trial ended" and "the subscription has stayed
  ended for six hours" are written into the D1 row (`trial_ends_at`, `adverse_since`) before the
  cron handler is run.
- **Operator list** — `OPERATOR_ACCOUNT_IDS` is a deploy-time var, so setting it restarts the
  local Worker.
- **Forms** are clicked in the browser and nothing is posted over HTTP in their place: a form
  the control plane refuses from a real browser is a failed check.

## Not covered

Google sign-in past the redirect, the packaged desktop app (Rust shell, `maude://` links, the
managed-copy folder), container cold start, R2 and exports (`send-export` reports failed here),
the retention / purge clock, the canvas iframe's contents, and real Stripe behaviour.

## Found by this harness and fixed (2026-11-24)

Each has a route-level test in `apps/cloud/browser-gates.test.mjs`.

- **csrf forms refused Chromium** — pages are `referrer-policy: no-referrer`, so the browser sends
  `Origin: null` on a same-origin form POST. `edge.mjs` `sameOriginPost` now takes `null` as "not
  stated" only beside `Sec-Fetch-Site: same-origin`.
- **the hand-off to Stripe was blocked by the page's own CSP** — every page that sets a CSP now
  builds it with `edge.mjs` `pageCsp`; the pages whose form can end at Stripe name Stripe.
- **a cancelled subscription never suspended** — `reconcile.mjs` `settle()` now keeps the debounce
  clock. `cloud-repro-suspend-debounce.test.mjs` is the reproduction and passes.
- **Can view could not open a project** — no hub advertises `roles-v2` yet, so the People pages
  no longer offer Can view (and refuse it) until a project's workspace reports the capability.
- **a paused project still got a project token** — `/projects/open` answers 409 for a project an
  operator paused.
