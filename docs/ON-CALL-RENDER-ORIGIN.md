# On-call: the cell renders now

> Cloud Phase 25 A3. Written **before** the origin existed, because DDR-206's
> unpriceable line was on-call for a code-execution host, and a runbook written
> after the first incident is a runbook that was not there for it.
>
> Read the first two sections now. They are what you need at 03:00.

## The one thing to know

**A cell builds a tenant's canvas; the viewer's browser runs it.** The build is
a bundler pass — parse, transform, write a string. It does not evaluate the
canvas, and no browser exists in the cell image (three assertions hold that:
`scripts/check-containment.sh` at review, `infra/cell/assert-containment.sh` at
image build, `infra/cell/entrypoint.sh` at boot).

So the surface you are on call for is: **our compute parses source a customer
wrote, in that customer's own container, for members of that project.**

## Stop it now

Rendering is paused per tenant, two ways. Both leave the project itself
working — sync, git, backups, mirror and the desktop app are untouched.

```sh
# 1. INSTANT, no restart, from a shell on the cell's volume:
touch /repo/.render-off          # or the volume's parent: /.render-off

# 2. Operator, needs a restart (survives a volume wipe):
#    set MAUDE_RENDER_DISABLED=1 on the cell and restart it
curl -X POST https://<project>.cloud.maude.sh/_cell/restart \
  -H "authorization: Bearer $(derived cell secret)"
```

The member sees: *"Rendering is paused for this project while we look into
something. Your work is safe and nothing has been changed. Maude Desktop still
opens it normally."* — which is true, and is the whole reason the switch is
per-tenant.

To undo: delete the file (or unset the variable and restart).

**Fleet-wide?** There is deliberately no single switch. Pausing everybody
because of one project is a decision, not a reflex — do it by looping the
per-tenant switch, and say so in the incident channel.

## What is monitored

| Signal | Where | What it means |
| --- | --- | --- |
| `failures`, `timeouts`, `memoryKills` | `GET /api/studio/stats` (per cell, session-authenticated) | The ceilings are firing. A few is a bad canvas; a spike on one tenant is a pathological import graph or an attempt. |
| `cacheHitRatio` | same | Below ~0.7 in steady use means the cache key is churning — cost scales with views again (A1b). |
| `p95Ms` | same | The corpus builds at p95 ≈ 70 ms. Sustained seconds means something is wrong with the sandbox, not with the canvas. |
| container CPU / memory | Cloudflare Containers dashboard | The ceilings bound ONE build; many concurrent builds still cost. |
| `/health` | per cell | Unchanged — the door being paused does not make a cell unhealthy. |

There is no alerting integration yet. **This is a two-person team and the
honest statement is that discovery is: a customer tells us, or the weekly look
at the board does.** If that changes, it changes here first.

## Pages a human when

- A cell is unhealthy AND its build counters are climbing → pause rendering for
  that tenant, then look.
- Any evidence of a build reading outside its design root (the allowlist is
  supposed to make this impossible — a report of it is a **stop everything**).
- R2 credentials appearing anywhere they should not: they are per-tenant,
  prefix-scoped and TTL-bounded (A-1), so the blast radius is one project for
  hours — but rotate the parent key and re-mint anyway.

## If you think a canvas is malicious

1. Pause rendering for that tenant (above).
2. Take a copy of the canvas source from the cell's checkout — it is a file,
   nothing has to be reproduced.
3. Confirm what the sandbox actually allowed: the build ran with an EMPTY
   environment, an import allowlist confined to the design root, a wall-clock
   deadline and an RSS ceiling. Anything it reached that is not a project file
   is a bug in `apps/studio/canvas-build.ts` → `importAllowlist`, and it is the
   most serious bug class this system has.
4. The tenant's storage credentials are temporary and scoped to
   `tenants/<id>/`; rotate the PARENT key (`R2_PARENT_ACCESS_KEY_ID` +
   `R2_CREDS_TOKEN` on the control plane) if you believe any credential leaked.
   Existing temporary credentials cannot be revoked individually — they expire
   (12 h), which is exactly why the TTL is short.
5. Render tokens (A4) are stateless HMACs, 15 minutes, read-only, and reach no
   mutating route. Rotating `CELL_SECRET_MASTER` invalidates every one of them
   fleet-wide — a big hammer, and it also kicks every session.

## What this does NOT cover

- **Anonymous visitors.** There are none: a build runs only for an
  authenticated member of that project. If that ever changes, this runbook is
  insufficient and DDR-206's original refusal is back on the table.
- **The agent.** `claude` does not run on our infrastructure and will not
  (DDR-123). If you find a process spawning it in a cell, that is an incident.
- **Alerting.** See above. Named rather than implied.

## After an incident

Write it up in `.ai/archive/logs/rca/`, and — if the sandbox's bounds were the
thing that failed — amend `scripts/check-containment.sh` so the same shape
cannot come back quietly. A guard added after the fact is the only one that
was ever proven necessary.

---

## Operator: two secrets turn per-tenant storage on

**Until these exist on the control plane, A-1's isolation is NOT active** —
minting refuses, every cell falls back to the fleet-wide R2 key it already
holds, and nothing breaks. That fallback is deliberate (a cell without storage
must not start), and it is also exactly how a security change stays shipped-
but-not-deployed. `GET https://cloud.maude.sh/health` answers the question:

```json
{ "ok": true, "r2Creds": "legacy-shared" }   ← not on it yet
{ "ok": true, "r2Creds": "per-tenant" }      ← on it
```

To switch:

```sh
# 1. An R2 API token with Object Read & Write on the bucket. Note BOTH values —
#    the Access Key ID is the parent key the temporary credentials sign against.
#    Cloudflare dashboard → R2 → Manage API Tokens → Create Account API token.

cd apps/cloud
npx wrangler secret put R2_PARENT_ACCESS_KEY_ID   # the token's Access Key ID
npx wrangler secret put R2_CREDS_TOKEN            # a Cloudflare API token with
                                                  # Account → Workers R2 Storage: Edit
# (CF_ACCOUNT_ID is already set; MAUDE_R2_BUCKET defaults to maude-cloud-assets)

# 2. Confirm the posture flipped, then restart a cell so it mints on next boot:
curl -s https://cloud.maude.sh/health           # expect "r2Creds":"per-tenant"

# 3. Once a cell has come up on minted credentials, DELETE the fleet-wide key —
#    it is the whole point of A-1 and it is not gone until it is gone:
cd ../cells
npx wrangler secret delete MAUDE_R2_ACCESS_KEY_ID
npx wrangler secret delete MAUDE_R2_SECRET_ACCESS_KEY
```

Step 3 is the one that actually removes the credential from every container. A
cell whose mint fails after that refuses to start rather than running without
storage — which is the correct, loud failure, and the reason to do step 2's
check first.

---

## Operator: rolling the fleet onto a new cell image

The `cells` lane of the private `1aGh/maude-deploy` (dispatched with the release tag) builds, pushes and deploys. Two things about it are worth
knowing before you trust a green run.

**The image tag in `apps/cells/wrangler.toml` IS the instruction.** The
workflow reads the tag from there and builds THAT tag. Leaving it unchanged is
not "deploy the same thing" — it pushes new content to an existing tag, the
container configuration comes out byte-identical, and the deploy prints
`no changes maude-cells-maudecell` while every instance keeps running the old
digest. A green deploy that changed nothing. **Bump the tag.**

**A deployed image is not a running image.** A cell is a Durable Object
container: it keeps serving the old image until it stops (idle `sleepAfter`,
20 m) and starts again. So after a deploy:

```sh
# What the APPLICATION is configured with:
npx wrangler containers info <APPLICATION_ID> | grep '"image"'

# What is actually RUNNING — the column that matters:
npx wrangler containers instances <APPLICATION_ID>
```

An `inactive` instance is good news: the next request starts it on the new
image. To force the roll rather than wait for the idle timeout, create a
rollout against the target configuration (`POST
/accounts/{id}/containers/applications/{app}/rollouts`, `strategy: rolling`,
`step_percentage: 100`, and a full `target_configuration` — the field is
required and the error if you omit it names it).

**Do not probe the cell while you wait.** A poll loop keeps it awake and it
will never idle out — which reads exactly like a stuck rollout.

**Expect a slow first boot.** The Phase-25 image carries the build sandbox
(Bun, the studio engine, the runtime bundles), so the first cold start after a
roll pulls a much larger image and can exceed a 45 s client timeout. A `000`
from curl during that window is a cold start, not an outage; a `000` that
persists past a few minutes is not.

---

## Incident, 2026-08-02: A-1 was switched on ahead of the fleet

**What happened.** Per-tenant R2 minting was enabled on the control plane while
every cell was still running the pre-Phase-25 image. Temporary credentials
carry a **session token**, and `MAUDE_S3_SESSION_TOKEN` is a variable that
image has never heard of — so it signed every S3 call with two thirds of a
credential, the rehydrate could not complete, and the cell never bound its
port. The project was unreachable.

**The ordering rule this produces, and it is not optional:**

1. Roll the fleet onto an image that understands session tokens **first**.
2. Verify a real cell serves on that image.
3. **Then** put `R2_CREDS_TOKEN` + `R2_PARENT_ACCESS_KEY_ID` on the control
   plane, and confirm `/health` says `per-tenant`.
4. Only then delete the fleet-wide `MAUDE_R2_*` secrets.

Doing 3 before 1 is what this incident was. The fallback that was supposed to
make A-1 safe — "no credentials ⇒ use the legacy key" — does not cover it,
because minting **succeeded**; what failed was the consumer.

**Two things that made it much harder to diagnose than it should have been:**

- **Every intervention restarted the clock.** A rollout, a `wrangler deploy`
  and a scale change each move the instance, and a moved instance has an empty
  disk and pays a full rehydrate (~280 MB here) under a 600 s port deadline.
  Impatient probing on top of that reads as "still broken" when it is "started
  again from zero". Change ONE thing, then wait the full deadline.
- **`mintingConfigured()` accepts `CF_PROVISION_TOKEN` as a fallback for
  `R2_CREDS_TOKEN`.** Deleting `R2_CREDS_TOKEN` therefore did NOT turn minting
  off, and `/health` kept saying `per-tenant` — correctly, and confusingly.
  To disable minting you must also delete `R2_PARENT_ACCESS_KEY_ID`.
