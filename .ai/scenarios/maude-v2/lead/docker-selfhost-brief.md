# V2-8.18 docker-selfhost — the real images, run the way an operator runs them (lead brief, 2026-10-28)

Michal (via the keeper, 2026-10-28): "ok otestoval bych to taky, aby to fungovalo pro self hosted hub". This becomes a
gate of its own (V2-8.18), recorded in the final record next to 8.1 / 8.3 / 8.2, not a one-off run. Defects found
are fixed fail-first before the freeze. Read `.ai/scenarios/maude-v2/lead/e2e-round-brief.md` for the shared rules
(test lane, env, never list); this file adds the Docker part.

## Where and what

- **This MacBook only.** Start Docker Desktop (`open -a Docker`; `/usr/local/bin/docker`). The Mac mini is rendering;
  do not use it. Never brew-install anything.
- **Images stay local.** Build tags such as `maude-hub:v2-local`. Never `docker push`, never log in to ghcr, never
  Cloudflare/R2, never a production hub/cell. A v1 image is built from the `v1.9.1` tag's sources (git worktree of
  the tag), not pulled.
- **Storage is local.** The hub's data on a named volume. Any S3/R2 path, such as the media/backup prefix the existing
  fixture `.ai/scenarios/reliable-project-multiplayer/runners/f3/selfhost.mjs` takes from real R2, goes to a local
  stand-in instead: the hub's file backend if it has one, else a local `minio` container. Read the hub code before
  adding a container.

## Scenarios

1. **Operator path.** `apps/hub/Dockerfile` built with the frozen lockfile, exactly as `.github/workflows/hub-image.yml`
   builds it. Then follow `apps/hub/docker-compose.yml.template` and `plugins/design/skills/self-host/` the way an
   operator would: first boot, the admin bootstrap, an invitation, `/join` for a second person. Caddy/TLS is replaced
   by the published port; real Let's Encrypt goes to soak. OIDC only against a local mock IdP, if the hub's OIDC is
   generic enough for one; otherwise soak, with the reason.
2. **The product against the container.**
   - Desktop e2e `selfhost-entry` (`apps/desktop/e2e/multiplayer/selfhost-entry.conf.ts`,
     `MAUDE_SELFHOST_ENTRY_TARGET`).
   - The team-project and share-roles lanes pointed at the container instead of the in-process hub, where their
     fixtures allow a hub URL. Add that switch additively if they do not.
   - The multiplayer `surface` catalogue + L23 soak (`scripts/dev/sync-e2e/surface-run.mjs`) and `ai-runs` (two
     desktops + the browser) synced through the container. Builder p8-t-multi is getting those lanes green on a local
     cell now; reuse its work and do not fork it.
3. **Resilience.**
   - `docker restart`, then `docker kill` + start, both on the same volume. Accounts, sessions, projects and an
     in-flight sync survive; the desktop reconnects and its Share cluster word goes back to Saved.
   - Upgrade: the v1.9.1 image on a volume with a real project, then the v2 image on the same volume.
   - Mixed peers: a 1.x client against the v2 hub sees a `formatVersion: 2` project read-only (`format.ts`), and a v2
     client against a 1.x hub behaves as CONTRACT says.
4. **Cell image** (`infra/cell/Dockerfile`, the tag `apps/cells/wrangler.toml` declares) behind
   `apps/cells/dev-edge.mjs`, with its backup on `file://` instead of R2. Run sync + multiplayer through it. What
   needs Durable Objects, R2, Workers routing or the fleet rollout goes to soak, one line each, with the reason.

## The gate

One entry point, e.g. `scripts/v2-verify/docker-selfhost.mjs`: build → up → scenarios → restart/kill → upgrade → cell
→ down. It writes a report with a final ```json verdict. Add it to `scripts/v2-gates.mjs` as a **command** gate
`V2-8.18` (title "Self-hosted hub + cell images (Docker)"). It needs the screen for its desktop legs, so it runs under
the test lane. Its runtime goes in the hand-back. Clean up containers, volumes and images it created (`--rm`, a
`maude-v2-docker-*` name prefix), even on red.

Hand-back as in the round brief, plus: the gate command, its wall time, and the soak list.
