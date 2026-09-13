---
name: self-host
type: skill
description: "Set up and verify a self-hosted Maude hub workspace with project storage and media."
keywords: [self-host, hub, workspace, deploy, aws, oidc, auth0, backups, credentials]
---

# Standing up a self-hosted workspace

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

A staged interview over **`maude hub workspace-up`**. Everything executable
lives in that command (DDR-062 — plugins reach executable logic through
`maude`, never a raw script path). Your job is to gather what it needs,
run it, and read the result back honestly.

**Self-hosting is first-class.** It is the product for anyone who is not on
Maude Cloud, not a lesser path, and never a step on the way to a hosted plan.
Do not steer.

## Before anything: is a workspace even the right answer

Stage 0, and it is a real gate rather than a formality.

- **Everyone has a git clone and is comfortable with it** → a **plain hub**
  (`maude hub deploy`) relays between peers. Smaller, less to operate. Say so
  plainly and stop; recommending the bigger thing to someone who needs the
  smaller one is not service.
- **Someone should never have to think about git**, or you want one copy that
  is backed up and reachable without anybody's laptop open → **workspace**.
  Continue.

One workspace holds **one project**. Six projects is six containers. Say this
before they plan around the opposite.

## The stages

Ask only what you cannot infer, one interaction per stage, in plain words. If
they have a config file already, `--config <file>.json` takes all of it.

### 1 · Where

Laptop trial · VPS with Docker · AWS EC2 · another Docker host.

A laptop trial is `--local --dev-minio` and needs nothing else — no domain, no
certificate, no account. It is the honest first step and it runs every
verification a real deployment gets. Say plainly that it is testing only:
local mode serves plain HTTP, so a password would travel in the clear.

For AWS, read `_targets.md` before answering anything specific — two of its
defaults break a workspace, and guessing here is expensive.

### 2 · The address

A hostname they control DNS for, pointed at the box. An email for certificate
notices. Not optional off `--local`: TLS needs both.

### 3 · Storage

An S3-compatible bucket — AWS S3, Cloudflare R2, or MinIO. Endpoint, bucket,
key, secret. If they have none yet, say what it buys (media stops bloating
every clone; backups have somewhere to go) and that it can be added later.

Two things to say **at this moment**, not later:

- **Never put a lifecycle/expiry rule on the `assets/` prefix.** A canvas in
  git history can reference media no *current* canvas does, so "unreferenced"
  never means "unreachable".
- **One hub per keyspace.** A second hub pointed at the same prefix is refused
  rather than allowed to interleave — which is safe, but it means that hub has
  no backups until it is fixed.

### 4 · Identity

Built-in (email + password, scrypt) or their own provider.

If OIDC: issuer, client id, client secret, allowed email domains, and the
callback URL they must register — `https://<domain>/auth/oidc/callback`.

State the rule that surprises everyone, before they configure it:
**signing in successfully grants nothing.** A verified identity with no account
here waits in a pending queue until an admin links or creates one — including,
especially, when its email matches an existing account. Anything else would be
an account takeover.

### 5 · Start from what

Fresh, or an existing repository URL to seed from.

### 5b · Exports (the render sidecar)

Ask whether people will export **video (MP4/WebM/GIF), PDF, or
multi-artboard scopes** from the hosted studio in a browser. PNG/SVG of the
active artboard and the PPTX deck need NO sidecar — they capture in the
member's own browser (DDR-231) — so don't sell `--render` for those. If yes →
add `--render`: it deploys the `maude-render` sidecar, the one container in
the stack that carries a browser (DDR-230). The hub itself stays browser-free
either way — that is a security invariant, not an omission.

Say the trade honestly, in both directions:

- **Without it** nothing breaks silently: PNG/SVG of the active artboard, the
  PPTX deck, ZIP and handoff all work; video/PDF are disabled in the export
  dialog with the reason, and the desktop app exports everything. It can be
  added later by re-running `workspace-up` with `--render`.
- **With it** the sidecar runs alongside the hub, unreachable from outside
  (compose-network only), holds no hub secret and no data volume, and refuses
  to boot if a secret variable reaches it. It costs the memory of an idle
  Chromium.
- **It constrains the machine.** The image is ~3 GB and carries a browser, and
  it is published for arm64 only from after v1.0.3 — so on AWS this decides
  between `t4g.small` and `t3.small`, and 2 GB is tight for both containers.
  Ask it BEFORE §5 lands on an instance type, not after. It is also published
  for release tags only (no `:latest`), so a `--render` run must pass
  `--image-tag vX.Y.Z`. `workspace-up` refuses up front when the host and the
  image cannot match, rather than leaving an `exec format error` in a log.

### 6 · Durability

Backup target (the same bucket is fine), and two commitments worth extracting
now rather than discovering later:

- schedule `maude hub restore-drill` — a backup nobody has restored is a
  hypothesis
- **remove `MAUDE_SEED_REPO` after the first successful boot**

### 7 · Dry run, review, run

```sh
maude hub workspace-up --dry-run --domain <host> --acme-email <email> \
  --admin-email <email> [--s3-* …] [--seed-repo <url>] [--render]
```

Show what it would write and what it would check. This is the moment a wrong
domain or a bucket typo is cheap; every configuration problem is reported at
once, so fix them together rather than one round-trip per mistake.

Then the same command without `--dry-run`.

### 8 · Read the verification honestly

A step that could not be automated prints as **skipped**, never as passed. If
you see one, say it is unverified and name what would prove it. Never summarise
a partially-verified run as "done" — counting an unrun check as green is the
fastest way to make a verification suite worthless.

If Docker is missing, the command writes the files, says nothing was verified,
and exits non-zero. Relay that as-is: they have a rendered deployment, not a
working one.

### 9 · Hand over the duties

Read `operatorDuties()` back **in full**. Do not compress it into "you're all
set" — this command scaffolded and verified once; it does not operate anything,
and implying otherwise is how somebody finds out in six months that nobody was
watching the backups.

## Notes

- Never print a secret back in your output.
- `_credentials.md` is the inventory: what each credential is, where to get it,
  what it may do, and how to rotate it. Load it at stage 3 and stage 4.
- `_targets.md` carries the per-target facts. Load it at stage 1.
- Re-running is the upgrade path: files are regenerated, existing secrets in
  `.env` are reused. Say so — someone whose first attempt failed needs to know
  that trying again is safe.
- The workspace never renders or executes a canvas. If they ask why they cannot
  export from the server, that is why; exports happen on their machine.
