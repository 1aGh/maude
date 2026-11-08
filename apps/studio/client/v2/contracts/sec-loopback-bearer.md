# Loopback API key for credential routes

Status: phase 1 built (GitHub routes); phase 2 open — see §6.
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

## 6. Open — phase 2

1. **Header forgery.** `Origin` and `Sec-Fetch-Site` are forgeable by a non-browser caller, so
   phase 1 stops only a caller that sends neither. Closing it needs the shell to send the key:
   the desktop mints the key per spawn (`sidecar.rs`, env as above, plus `apiKey` in the 0600
   `servers.json` entry for CLI callers), the project webview reads it through a Tauri command
   scoped to that webview (as Home's page secret), and the client adds `x-maude-api-key` on
   credential paths. Then, on a desktop-spawned server (key from env), the key is required from
   every caller. A CLI-started server has no shell to hand it to; its browser page would need a
   launch-URL token. Decision needed.
2. **Paid generation is agent-reachable by design** (`maude design generate`). Gating it with the
   key breaks the verb; leaving it open leaves money-spending reachable from any local process.
   Options: (a) gate it and move the verb to a human-tier path; (b) keep it open and cap spend.
3. **`maude design sync resync`** needs the key from `servers.json` / a 0600 file next to the
   app-owned info file before `/_api/sync/*` is gated.
