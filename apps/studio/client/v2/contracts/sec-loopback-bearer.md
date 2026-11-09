# Loopback API key for credential routes

Status: phase 1 built (GitHub routes); phase 2 decided 2026-11-08 (Michal) and specified in §7 — being built.
Module: `apps/studio/shell/api-key.ts`. Pins: `test/sec-loopback-bearer.test.ts`, `test/acp-env.test.ts`.

## 1. The problem

A project server listens on loopback. Its privileged main-origin routes have two gates:
`sameOriginWrite` (an `Origin` header, when present, must name this host) and
`isTrustedRequestHost` (the `Host` must be loopback). A caller that is not a browser sends no
`Origin` and a loopback `Host`, so both gates pass. Any local process can therefore use the
credentials the server holds for the person: another account on the same Mac, or a process of
the same user that is not the studio page. Since #206 the desktop can also start such a server
by itself for a known folder.

## 2. The rule

A **credential route** is a route that uses a credential this computer holds for the person
(GitHub token via the token bridge, the Maude Cloud or team-server credential, a provider key,
the Figma token) or spends the person's money. On a credential route:

| Request | Answer |
| --- | --- |
| carries `x-maude-api-key: <key>` (or `Authorization: Bearer <key>`) that matches | the route's own gates run |
| carries a key that does not match | 401 `{ ok:false, error:'api-key-invalid' }` |
| no key, has `Origin` or `Sec-Fetch-Site` (a browser) | `Origin` must name this host and `Sec-Fetch-Site` must be `same-origin`/`none`, else 403; then the route's own gates run |
| no key, neither header (not a browser) | 401 `{ ok:false, error:'api-key-required' }` |

The gate runs before the route (and before the read-only gate), on both the exact route map and
the fall-through (dynamic table paths). A cell (`isWorkspaceMode()`) is exempt: the hub proxy
authenticates every request there, and the secret-bearing route families are pruned out of a
cell's table.

## 3. The key

- `MAUDE_SHELL_API_KEY` (64 hex) from the environment, read once at first import and deleted from
  `process.env`, the same way `MAUDE_SHELL_ATTEST_KEY` is. A malformed value reads as none.
- Otherwise the server mints a random key per process and writes it nowhere. In phase 1 no
  legitimate non-browser caller uses a credential route (§5), so nothing needs it.
- It is never written to `_server.json` or anywhere in the project.
- The AI chat agent never holds it: `scrubAgentEnv` drops every `MAUDE_SHELL_*` variable
  (`acp/env.ts`), and the server has already deleted it from its own env before it spawns anything.

## 4. Routes

Phase 1 (gated now): `/_api/github/identity`, `/repos`, `/create-repo`, `/invite`, `/clone`,
`/create-project` (regex `^/_api/github/`).

Phase 2 candidates (credential use read from the handlers' own comments — confirm each before
gating it; not gated yet):

| Family | Paths | Credential | Known non-browser caller |
| --- | --- | --- | --- |
| Cloud | `/_api/cloud/{status,signin/start,signin/poll,signout,history,projects,attach,attach/code,detach,plan,move}` | cloud credential | none |
| Team server | `/_api/hub/link`, `/_api/hub-signin/*`, `/_api/connections/hub`, `/_api/projects/prepare` | hub credential | none |
| Sharing | `/_api/share/{invites,people,links,requests}…` | cloud/hub credential | none |
| Figma | `/_api/figma/{status,connect,probe,import,explode,frames,import-frames}` | Figma token | none (`import-figma` runs in process) |
| Keys | `/_api/generate/keys`, `/_api/import-link/key` | provider keys | none |
| Sync | `/_api/sync/{link,link/confirm,resync,…}` | hub credential | `_sync.mjs` → `POST /_api/sync/resync` |
| Paid generation | `/_api/generate-jobs`, `/_api/generate-takes*`, `/_api/generate/{providers,audio-search,audio-reuse}` | provider keys, money | `generate.sh`, `_transcribe.mjs`, `_audio-search.mjs` — run by the AI agent through `maude design generate` |
| Git remote | `/_api/git/{push,pull,fetch}` | GitHub token when the remote is GitHub | none |

Not credential routes: the Home server's `/_home/internal/*` (already bearer-gated by
`MAUDE_HOME_TOKEN`), `/_api/shell/status` (`MAUDE_SHELL_TOKEN`), local git reads
(`_history.mjs` → `/_api/git/{log,diff}`).

## 5. Callers inventory (grep of `cli/`, `plugins/`, `apps/studio/bin/`, `apps/desktop/src-tauri/src/`)

- Shell page (studio client): always a browser — `Origin` on writes, `Sec-Fetch-Site` on reads.
- Rust: no direct call to any route in §4 (`managed.rs`, `oauth.rs`, `keychain.rs` only mention them).
- CLI / bin: only the Sync and Paid-generation rows above. No caller of the phase-1 routes.

## 6. Phase 2 — decisions (Michal, 2026-11-08; decision `burndown-michal-loopback-key-every-caller`)

1. **Header forgery — closed by requiring the key everywhere.** A server the desktop app starts
   requires its per-spawn key from EVERY caller on the main origin, the app's own page included
   (§7). The page gets the key through a Tauri command scoped to project webviews; CLI callers read
   it from the app's 0600 registry. A server started from the terminal and opened in a browser gets
   a one-time token in its opening URL (§7.4).
2. **Paid generation stays open to the AI flow.** `maude design generate` keeps working: the verb
   reads the key the same way every other verb does (§7.6). Not a separate gate.
3. **`maude design sync resync`** reads the key like every other verb (§7.6).

## 7. Phase 2 — the rule

### 7.1 Required mode

A server is in **required mode** when its starter handed it a key: `MAUDE_SHELL_API_KEY` in its
environment (the desktop app does this for every project spawn). Phase 2b adds terminal-started
servers (§7.5). A cell (`isWorkspaceMode()`) never is. The Home server is a different program
(`--home`) with its own bearer and is not affected.

In required mode the gate runs on the **main listener only** — first in the routes map wrapper
and first in `fetch`, before WebSocket upgrades (`server.ts` `withSession` + `startServer`), so
it covers every route, the fall-through and every socket. The canvas and capture listeners are
separate listeners with their own frame-capability model and are untouched. Phase 1's
`credentialRouteRefusal` keeps running behind it.

### 7.2 What counts as the key

| Credential | Accepted when |
| --- | --- |
| `x-maude-api-key: <key>` or `Authorization: Bearer <key>` | it matches (constant time); a wrong one is 401 `api-key-invalid` |
| the session cookie `maude_k_<12 hex>=<64 hex>` | the value names a live session of this process AND `Sec-Fetch-Site` is absent, `same-origin` or `none` AND any `Origin` is this server's host — so the canvas origin (same host, other port: same-site to a cookie) never rides it |

Anything else → 401 `{ ok:false, error:'api-key-required' }` (`Cache-Control: no-store`).
`Origin`/`Sec-Fetch-Site` alone never pass. The cookie is `HttpOnly; SameSite=Strict; Path=/`, no
`Max-Age` (dies with the webview session); its name is derived from the key so two servers on
`127.0.0.1` never overwrite each other's. Its **value is random** (32 bytes), held only in the
server's memory as `sha256(value) → { last use, opened, helper }` (`api-key.ts` `SESSIONS`): never
derived from the key, gone after **12 h unused** (`SESSION_IDLE_MS`), **24 h after it opened, used or
not** (`SESSION_MAX_AGE_MS`), or a restart. The desktop page re-trades its key once, unseen, when a
request answers `401 api-key-required` (`api-session.js`). Every exchange mints a fresh one and drops
the session the request presented (rotation); two windows of one project hold two sessions. The
person's sessions are capped at 256; a **helper** session (opened by an `h<ts>.<nonce>.<mac>` link,
MAC domain `maude-launch-helper/1`, which only capture helpers mint) has its own cap of 32 and ends
after 30 min unused — eviction stays within a kind, so helper runs never push out the person. The canvas and capture listeners never read it (the gate runs on the main listener
only) and nothing logs it. The key itself is never placed in a URL or a log.

The gate records what authenticated each request (`requestCredential(req)`: `'key'` | `'session'`,
a `WeakMap` over the `Request`), on exempt paths too — §7.3 and §7.8 read it.

### 7.3 Exempt (answered without a credential)

- `GET|HEAD /_health` — the CLI's locate probe (it names the root, nothing else).
- `GET|HEAD /`, `/index.html` — the shell document (static HTML + CSP, the bootstrap that
  fetches the key); `GET|HEAD /_client/*` — the shipped client bundle, styles, fonts;
  `GET|HEAD /_canvas-runtime/*` — the shipped dependency bundles (`runtime-health.sh` probes them).
- `GET|HEAD /_canvas-shell`, `/_canvas-shell.html` — a 307 to the capture origin while the split
  is on (every headless capture follows it, §CLAUDE.md "Captures never render on the main origin").
  **The 307 carries a frame capability only for a caller that sent the key or the session**
  (`authenticatedCaller`, http.ts); a keyless caller gets the 307 frame-less, so the capture reads
  nothing. With the split off (`MAUDE_CANVAS_ORIGIN_SPLIT=0`) a keyless caller gets the bare shell
  (no past-version meta, no system fallbacks or aliases). Headless callers therefore authenticate:
  the server's own captures (exporters, thumbnails) resolve the redirect in-process
  (`shell/capture-url.ts` `localCaptureUrl`); the bash helpers (screenshot, canvas-rects,
  draw-proof, smoke, visual-sanity, perf's bare page) ask with the key through `studio_capture_url`
  (`_desktop-locate.sh`) and open the capture-origin URL it prints; a helper that drives the studio
  page holds the session cookie from its opening link.
- `GET /_api/hub-signin/return` — the team server's page sends the person's own browser back
  here, and that browser holds no session. The route acts only on a single-use `state` this
  process minted, and the code needs the PKCE verifier that never left it (2.1.1 fix: 2.1.0
  answered `api-key-required` and every team-server sign-in failed).
- `/_api/shell/{status,attest,clip-export,clip-asset,clip-import}` — each carries its own
  credential (the per-spawn shell token, or the attest MAC).

Everything else, every method, needs §7.2. `/_api/shell/session` (below) needs the header form.
`POST /_api/shell/session` and the launch exchange answer a loopback `Host` only (C7).

### 7.4 How a page gets a session

- **Desktop page.** The Tauri command `project_api_session` (project webviews `p-*` only — the
  `default` capability; it checks the caller is a project tab whose URL is its own server) returns
  `{ key }`. The page sends it once as `POST /_api/shell/session` with `x-maude-api-key`; the
  server answers 204 + `Set-Cookie` (§7.2). The client does this before the shell renders, and a
  fetch wrapper holds every same-origin `fetch` until it settles (`client/v2/shell/api-session.js`).
  Images, media, fonts and WebSockets then carry the cookie by themselves; no key in any URL.
- **Browser (terminal-started server, phase 2b).** The opening URL carries
  `?maude-launch=<ts>.<nonce>.<mac>`, `mac = HMAC-SHA256(key, "maude-launch/1\n" + ts + "\n" + nonce)`
  (hex), `ts` = unix seconds, `nonce` = 32 hex. `GET /` (or `/index.html`) with a valid token not
  older than 300 s and never used before → 303 to the same URL without the parameter +
  `Set-Cookie`. A used, expired or forged token → 401 page. Anyone holding the key can mint one
  (the server at boot, `maude design server-up --open`); the server remembers used nonces with
  their `ts` (at most 4096): when full it forgets only expired ones, and while it is still full of
  live ones it answers 429 — a live token is never forgotten.

### 7.5 Terminal-started servers (phase 2b)

A server started by a terminal starter — role `cli` (`MAUDE_SERVER_ROLE=cli`, set by
`maude design serve` and `maude design server-up`; `shell/cli-yield.ts` `isCliRole`) — that was
handed no key mints its own and is in required mode (`api-key.ts` `terminalKeyMode`). Before it
writes `_server.json` it writes `{ v:1, port, pid, rootId, apiKey }` to a 0600 file in a 0700
directory outside the project, `<state>/maude/servers/<rootId>.json` (`<state>` = `$XDG_STATE_HOME`
when absolute, else `~/.local/state`; `shell/key-file.ts`), and removes it on shutdown while it still
names its pid. Only the CLI reads it (`desktop-locate.mjs` `terminalKeyFor`): a regular file of this
user with nothing for group or others, naming the port being called and a live pid, and only for a
port whose `/_health` names the project. The AI chat agent's Read tool is denied the folder
(`credentialDenyRules`).

Its opening URL carries a launch token (§7.4): the server opens the browser with one, and prints one
only to a terminal (a nohup'd `server-up` log keeps the plain address). **No auto-tier verb prints a
launch token or the key** — the AI chat reads their stdout and stderr: `maude design server-up --url`
prints the plain address; `--open` (`/design:browse`) hands a fresh link to `open`/`xdg-open` and
prints the plain address. `desktop-locate.mjs key|launch-url` are internal to the helpers (captured
into a variable, never echoed). Every helper log line goes through one redaction (`maude_redact`,
`_url-guard.sh`; `redactUrl` in JS), which hides `maude-launch=` and `fc=` values, and agent-browser's
own `open` output goes to `/dev/null` (`test/sec-loopback-bearer-p2d.test.ts` pins both statically).

**No browser helper redeems a link it was handed.** `_url-guard.mjs` `urlRefusal` — the check every
browser helper runs (screenshot `--url`, canvas-rects, smoke, visual-sanity, perf, photo-bg-remove,
`agent-browser-safe open`) — parses the URL as the server does and refuses any query key or value
containing `maude-launch` (any case, any encoding) and any URL whose escapes do not decode. The only
redeemers are: `open`/`xdg-open` in `server-up --open` (the person's browser); `screenshot --shell`
with a link it minted itself; `screenshot --url-file` with the server's link (the bug-report
capture); the perf probes. The two screenshot paths pass `--launch-ok` and run in a browser session
named at random and closed on exit — never one the caller named — so no session outlives the capture.

**A link reaches a helper process never through argv or a folder the agent reads.** The perf probes
get it on an inherited pipe (`--launch-fd 3 3< <(studio_launch_url …)`, `readLaunchFd`). The
bug-report capture's link is a 0600 `<32 hex>.url` in `<state>/maude/servers/links/` (0700, inside the
key folder the agent's Read is denied; `key-file.ts` `writeLinkFile`), removed in `finally`;
`screenshot --url-file` takes only such a file (this user's, 0600, not a symlink, in that exact folder)
and refuses any other path without reading or removing it (`takeLinkFile`). Helpers mint **helper**
links (`studio_launch_url … --helper`, §7.2). A page that already holds the session and opens a launch
link again (a reload, a helper navigating twice) gets a 303 without the parameter; its token is not
spent.

**Split off** (`MAUDE_CANVAS_ORIGIN_SPLIT=0`): a terminal starter stays key-less (phase 1, no key file)
and the boot line says so (`terminalKeylessForSplitOff`) — there is no capture origin to mint a frame
capability for, so key-less captures could not render, and canvas code already runs on the main origin
with the page's session. A key the app hands over keeps required mode; the app never turns the split
off.

**A server started with neither a key nor role `cli`** (a bare `bun server.ts`, `npm run start`, the
test harnesses) keeps phase 1: credential routes only, no key file. That is the starter's choice —
every starter a person uses (the app, `serve`, `server-up`) asks for required mode.

### 7.6 Callers

- **Rust** (`export_save.rs` download, `notify.rs` runs poll, `quit.rs` stop-all) sends the
  spawn's key as `x-maude-api-key`; the shell-token routes stay as they are.
- **CLI** (`desktop-locate.mjs`, `studio-locate.mjs`, the in-process verbs, the design hook,
  `_studio-verb.mjs`, the bash helpers through `_desktop-locate.sh`) sends the key of the
  registry entry it attested (`apiKey` in `servers.json`), else a terminal server's key file
  (§7.5) — never a key from any project file. A key is passed to `curl` through a config on stdin,
  never argv (`studio_curl`); a JS helper builds its headers with `studioHeaders` /
  `studioHeadersFor`. `cli/lib/helper-studio-key.test.mjs` fails on a helper that calls the studio
  any other way. A browser a helper drives opens the page through `studio_launch_url`.
- **Present audience window** (`present.rs`) — its own webview and cookie jar: Rust opens the
  follower root with a launch token minted from the tab's server key.
- **AI chat agent.** Its env never carries the key (`scrubAgentEnv` drops `MAUDE_SHELL_*`); it
  reaches the server only through `maude design` verbs, which read the registry like any CLI
  caller. `credentialDenyRules` keep its Read tool off the registry.
- **Paid generation** stays open to that flow (§6.2).

### 7.7 Registry

`servers.json` entries gain `apiKey` (64 hex) beside `attestKey`, present only on a running entry,
dropped on rest/reap with the attest key. Tests: `test/sec-loopback-bearer.test.ts` (§7.1–7.4),
`sidecar.rs`/`cli_registry.rs` unit tests (§7.7), `cli/lib/desktop-locate.test.mjs` (§7.6).

### 7.8 The person (decision `burndown-loopback-p2c-person-is-the-page-session`)

Some routes are the person's alone: they spend money, publish, or share. In required mode they need
**the page's session on a `Sec-Fetch-Site: same-origin` request whose `Origin` is this server**
(`personRequest`, `api-key.ts`); a request authenticated only by the header key — what every helper
and verb sends — gets 403. Outside required mode (phase 1, a cell behind its proxy) the old rule
stands: `Origin` present.

| Route | Where |
| --- | --- |
| spend approval / decline (`POST /_api/generate-jobs` with `approve`/`decline`) | http.ts |
| spend limits (`generateSpend` in `POST /_api/ui-prefs`) | http.ts |
| `POST /_api/git/push` | the gate (`PERSON_ONLY`) → 403 `person-only` |
| `POST /_api/share/invites`, `…/invites/:id/resend` | the gate |
| `POST /_api/cloud/attach`, `/attach/code`, `/move`, `/signin/start` | the gate |

Left as they are, with the reason: pull, commit and file writes (project effects the verbs make on
purpose); `cloud/detach`, `signout`, share revoke and role changes (they remove access, they send no
data or money out); permission answers over `/_ws/acp` (no verb sends them; follow-up below).

### 7.9 Accepted residuals

- **A process holding the raw key can become the person.** It can trade the key for a session and
  forge browser headers: §7.8 separates helpers and verbs from the page, not a raw-key holder. The
  AI agent gets the raw key only through a command the person approves (Read is denied the registry
  and the key files; no auto verb prints it). Closing it needs a page-only secret (a second key only
  the Tauri command hands out) or a native confirm — follow-up, with the `/_ws/acp` answers.
- **Browser cookies cross localhost ports.** In the terminal case the cookie rides to every
  `localhost:<port>` the browser visits. Mitigated: random, server-held, 12 h idle expiry, a 24 h
  absolute lifetime, rotation; the canvas and capture listeners never read or log it. The desktop
  webviews have their own stores. **Not done:** tying §7.8 to a per-page value the page holds in
  memory and sends as a header, which a copied cookie alone would not carry — follow-up, with the
  page-only secret above.
- **The link folder and the session kind are not proof of origin.** Any process of this user can
  write a file into `<state>/maude/servers/links/` or mint a helper link — but only a key holder can
  mint a link at all, and a capture that redeems one does so in its own closed session; the folder
  rule exists so `--url-file` cannot read or delete an arbitrary file.
- **Desktop with the split off.** A key the app hands over keeps required mode, so exports and
  thumbnails render nothing if someone starts the app's server with `MAUDE_CANVAS_ORIGIN_SPLIT=0`;
  the app never does.
- **Fetch Metadata on old WebKit.** The session and §7.8 rely on `Sec-Fetch-Site`; WebKit has had
  wrong values on iframes (bugs 256472, 260284). Follow-up: a desktop e2e check of the headers a
  canvas-iframe request to the main origin carries on the oldest supported macOS.
- **A launch link on `open`/agent-browser argv** for the moment of the navigation, which spends it.
- **An `XDG_STATE_HOME` the AI session does not know.** The Read deny covers the default
  `~/.local/state/maude/servers` and the session env's own `XDG_STATE_HOME`, not an arbitrary one.
- **The key-file reader trusts `/_health` + a live pid** (both CLI paths, the synchronous
  `_write-claim.mjs` one included, check `/_health` first); a key-possession challenge before the key
  is sent to a terminal server is a follow-up.
- **The bg-remove harness redirect** still mints its capability on the harness nonce alone.
