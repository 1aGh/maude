# @maude/hub

Self-hostable Yjs sync hub for Maude cross-machine canvas collaboration.

> **⚠ Linked mode is an experimental v1.1 preview.** Hub-pushed content is
> written to a peer's `.design/` files as untrusted input (treat it like
> `git pull` from a stranger). **Only link to hubs you operate or fully
> trust.** See [DDR-054](../../../.ai/archive/decisions/DDR-054-linked-mode-trust-model-and-task-4-hardening.md)
> for the trust model and the four architectural items that must land before
> linked mode is supported for general use.

**Two shapes, one image.**

A **plain hub** relays documents between peers who each own their own clone.
A **workspace** (`HUB_WORKSPACE_MODE=1`) owns the project: it holds the
authoritative checkout, turns autosave into append-only git commits, keeps
media in object storage, serves the studio in a browser, and gives people
accounts instead of tokens to paste.

Start at **[Self-hosting](https://maude.sh/docs/hub/self-host)**; this file is
a map, not a second copy of the docs.

| Page | What it answers |
| --- | --- |
| [Deploy a hub](https://maude.sh/docs/hub/deploy) | Fly, Docker, any VPS |
| [Workspace mode](https://maude.sh/docs/hub/workspace) | one command, and what it verifies |
| [On AWS](https://maude.sh/docs/hub/aws) | EC2 + EBS + S3, and what NOT to use |
| [Durability](https://maude.sh/docs/hub/durability) | what survives what, and how to prove it |
| [People](https://maude.sh/docs/hub/people) | accounts, invites, offboarding |
| [Identity](https://maude.sh/docs/hub/identity) | built-in sign-in, or your own Auth0 / Google |

## Run locally

```sh
# From repo root, install workspace deps once:
pnpm install --filter @maude/hub

# Plain Node, no bundle (fastest iteration):
node apps/hub/src/server.mjs

# Watch mode:
pnpm --filter @maude/hub dev

# Bundled (matches the published binary path):
pnpm --filter @maude/hub build
node apps/hub/dist/hub.bundle.mjs
```

The hub listens on `$PORT` (default `1234`), persists Y.Doc state to
`$DATA_DIR/hub.db`, and stores tokens in `$DATA_DIR/tokens.db` (HMAC-SHA256 —
the raw token value is never written to disk).

## Environment

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `1234` | Listen port. TLS terminates upstream (Caddy / Fly auto-cert / ALB). |
| `DATA_DIR` | `./data` | `hub.db` (Y.Doc state) + `tokens.db` (HMAC token store) + `admin.json` / `bootstrap.json`. Mount as a volume in Docker / Fly. |
| `HUB_SECRET` | _(unset)_ | Escape-hatch bearer token. The token store is primary; `HUB_SECRET` is a fallback for headless setups. **Store empty AND `HUB_SECRET` unset = permissive dev mode** (accepts any token, warns). |
| `HUB_PUBLIC_URL` | `https://localhost:$PORT` | Base URL printed in admin / bootstrap logs and embedded in invite commands. Must be `https://` for any non-loopback host (see transport hardening). May include a **path prefix** (e.g. `https://example.com/hub`) to mount the hub under a sub-path behind a path-stripping proxy — see [Reverse proxy & sub-path](#reverse-proxy--sub-path). |
| `HUB_INSECURE_HTTP` | _(unset)_ | If `1`, allows the hub to boot with a plaintext `http://` `HUB_PUBLIC_URL` to a non-loopback host. **Local testing only.** |
| `HUB_ADMIN_RATE_LIMIT` | _(on)_ | `off` disables the per-IP admin-API rate limiter (dev only). |
| `HUB_WORKSPACE_MODE` | _(unset)_ | `1` turns a relay hub into a **workspace**: it owns the checkout at `MAUDE_REPO_DIR`, commits autosaves, and requires accounts. |
| `MAUDE_REPO_DIR` | `/repo` | The server-side checkout. A SEPARATE volume from `DATA_DIR`, so an operator can reset one without the other. |
| `MAUDE_BACKUP_TARGET` / `MAUDE_S3_*` | _(unset)_ | Where backup generations go. Configuring object storage arms the schedule automatically. |
| `MAUDE_BACKUP_PREFIX` | _(unset)_ | This hub's keyspace inside the bucket. Unset means the bare root — safe now (a generation names its owner and a second hub is refused), but a prefix is what makes automatic recovery decidable. **Never point two hubs at one prefix.** |
| `MAUDE_ALLOW_EMPTY_START` | _(unset)_ | `1` overrides the boot refusal. For a genuinely fresh deployment, never as a way past an unexplained one. |
| `MAUDE_SEED_REPO` | _(unset)_ | Cloned on FIRST boot only. Remove it once the workspace has real history — see [Durability](https://maude.sh/docs/hub/durability). |
| `HUB_OIDC_MODE` | _(unset)_ | `hybrid` (password + OIDC) or `strict` (OIDC only). Explicit — naming an issuer is not consent to a mode. |
| `HUB_OIDC_ISSUER` / `HUB_OIDC_CLIENT_ID` / `HUB_OIDC_CLIENT_SECRET` | — | Required once a mode is set. |
| `HUB_OIDC_ALLOWED_DOMAINS` | — | Required once a mode is set. A filter, never a grant: a permitted domain with no account still waits for an admin. |
| `HUB_OIDC_LABEL` | issuer hostname | What the sign-in button says.
| `MAUDE_EMBED_ORIGINS` | _(unset)_ | Apps allowed to **frame** the studio read-only (`/?open=<file>&embed=1`), space- or comma-separated origins (`https://orbit.acme.com`). Invalid entries and wildcards are dropped. Framing only — an embed origin is **never** a cross-origin writer, unlike `MAUDE_EXTRA_SHELL_ORIGINS`. See [Embedding the hub](https://maude.sh/docs/hub/embedding). |

## Embedding the hub

Another app can show a design next to its own content by framing
`https://<hub>/?open=<path under .design>&embed=1` (optionally `&artboard=<id>`).
The studio renders that one canvas chromeless and read-only, and tells the
parent `ready` / `not-found` / `auth-required` by `postMessage` — to the
parent's exact origin, and only if it is on `MAUDE_EMBED_ORIGINS`. A signed-out
viewer gets a frameable page with a link to sign in in a new tab instead of the
(unframeable) sign-in redirect. `maude hub workspace-up --embed-origin <origin>`
writes the variable for you. Full contract: [Embedding the hub](https://maude.sh/docs/hub/embedding).

## Transport hardening (Task 6)

- **TLS is mandatory for public hubs.** The hub serves plaintext HTTP/WS and
  expects TLS to terminate at the proxy in front of it. It **refuses to boot**
  when `HUB_PUBLIC_URL` is `http://` to a non-loopback host unless
  `HUB_INSECURE_HTTP=1` is set. Terminate TLS with one of:
  - **Fly.io** — automatic certificate (set `HUB_PUBLIC_URL=https://<app>.fly.dev`).
  - **Docker / VPS** — Caddy with an `acme_email` for auto Let's Encrypt (Task 7 ships the `Caddyfile`).
  - **Cloudflare Tunnel** — terminates TLS upstream; point `HUB_PUBLIC_URL` at the public hostname.
  - **Tailscale Funnel** — same pattern for tailnet-fronted hubs.
- **Tokens are hashed at rest.** `tokens.db` stores `hmac_sha256(token, hubKey)`;
  a leaked store does not yield replayable credentials.
- **Per-token connection rate limit.** Each token is capped at 100 authentication
  attempts per 60s window — a leaked token can't drive a reconnection / replay flood.
- **Scope-bound tokens.** A token authorizes only its own `documentName` prefix
  unless minted with `scope: '*'` (DDR-053 §3).

## Reverse proxy & sub-path

The hub serves its admin UI with **mount-relative** asset + API references, so it
runs correctly either at a domain root (`https://hub.example.com/admin`) **or**
under a path prefix (`https://example.com/hub/admin`) behind a proxy that strips
the prefix. The hub always sees root paths (`/admin`, `/admin/api/*`, `/health`);
the prefix lives only in the browser URL and in `HUB_PUBLIC_URL`.

To mount under `/hub`, set `HUB_PUBLIC_URL=https://example.com/hub` (so the
bootstrap + invite links carry the prefix) and strip the prefix in the proxy:

```nginx
location /hub/ {
    rewrite ^/hub/(.*)$ /$1 break;   # strip /hub before forwarding
    proxy_pass http://127.0.0.1:1234;
    proxy_set_header Host $host;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # Yjs WebSocket sync
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 7d;
}
```

Caddy: `handle_path /hub/* { reverse_proxy 127.0.0.1:1234 }` (strips the prefix
automatically). Full deployment guide: [Deploy a hub → sub-path mount](https://github.com/1aGh/maude/blob/main/site/content/docs/hub/deploy.mdx).

## Connect a peer

```js
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

const doc = new Y.Doc();
const provider = new HocuspocusProvider({
  url: 'ws://localhost:1234',
  name: 'projects/<projectId>/canvases/<canvasSlug>',
  token: process.env.HUB_SECRET ?? 'dev',
  document: doc,
});
```

`name` is the Hocuspocus `documentName` — a single hub multiplexes many
canvases per project. Phase 9 Task 4 builds the file-sync agent that wraps
this provider for `.design/*.html` mirroring.

## Acceptance (Phase 9 Task 1)

- `node dist/hub.bundle.mjs` boots on `localhost:1234`. ✅
- Two `@hocuspocus/provider` clients connect to the same `documentName`,
  mutate a shared `Y.Text`, and converge.
- SQLite at `$DATA_DIR/hub.db` persists state across a restart.
