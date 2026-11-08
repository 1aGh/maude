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
| the session cookie `maude_k_<12 hex>=<HMAC-SHA256(key, "maude-session/1")>` | it matches AND `Sec-Fetch-Site` is absent, `same-origin` or `none` — so the canvas origin (same host, other port: same-site to a cookie) never rides it |

Anything else → 401 `{ ok:false, error:'api-key-required' }` (`Cache-Control: no-store`).
`Origin`/`Sec-Fetch-Site` alone never pass. The cookie is `HttpOnly; SameSite=Strict; Path=/`, no
`Max-Age` (dies with the webview session); its name is derived from the key so two servers on
`127.0.0.1` never overwrite each other's. The key itself is never placed in a URL or a log.

### 7.3 Exempt (answered without a credential)

- `GET|HEAD /_health` — the CLI's locate probe (it names the root, nothing else).
- `GET|HEAD /`, `/index.html` — the shell document (static HTML + CSP, the bootstrap that
  fetches the key); `GET|HEAD /_client/*` — the shipped client bundle, styles, fonts.
- `GET|HEAD /_canvas-shell`, `/_canvas-shell.html` — a 307 to the capture origin while the split
  is on (every headless capture follows it, §CLAUDE.md "Captures never render on the main origin").
- `/_api/shell/{status,attest,clip-export,clip-asset,clip-import}` — each carries its own
  credential (the per-spawn shell token, or the attest MAC).

Everything else, every method, needs §7.2. `/_api/shell/session` (below) needs the header form.

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
  (the server at boot, `maude design browse`); the server remembers used nonces (bounded).

### 7.5 Terminal-started servers (phase 2b — next slice)

The server mints its own key and writes `{ v:1, port, pid, rootId, apiKey }` to a 0600 file in a
0700 user-owned state dir outside the project (`<state>/maude/servers/<rootId>.json`); only the
CLI reads it. Its opening URL carries a launch token (§7.4). Until 2b lands such a server keeps
phase 1 (credential routes only) and writes no file.

### 7.6 Callers

- **Rust** (`export_save.rs` download, `notify.rs` runs poll, `quit.rs` stop-all) sends the
  spawn's key as `x-maude-api-key`; the shell-token routes stay as they are.
- **CLI** (`desktop-locate.mjs`, `studio-locate.mjs`, the in-process verbs, the design hook,
  `_studio-verb.mjs`, the bash helpers through `_desktop-locate.sh`) sends the key of the
  registry entry it attested (`apiKey` in `servers.json`), never a key from any project file.
  A key is passed to `curl` through a config on stdin, never argv.
- **AI chat agent.** Its env never carries the key (`scrubAgentEnv` drops `MAUDE_SHELL_*`); it
  reaches the server only through `maude design` verbs, which read the registry like any CLI
  caller. `credentialDenyRules` keep its Read tool off the registry.
- **Paid generation** stays open to that flow (§6.2).

### 7.7 Registry

`servers.json` entries gain `apiKey` (64 hex) beside `attestKey`, present only on a running entry,
dropped on rest/reap with the attest key. Tests: `test/sec-loopback-bearer.test.ts` (§7.1–7.4),
`sidecar.rs`/`cli_registry.rs` unit tests (§7.7), `cli/lib/desktop-locate.test.mjs` (§7.6).
