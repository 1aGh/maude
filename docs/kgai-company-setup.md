# kgai company setup (one-time) — the shared decision graph for a whole org

This is the **admin** guide: stand up the single shared kgai store that every repo in the company resolves to, so decisions made in one repo/department are one query away from another. Individual engineers then follow [onboarding](./kgai-onboarding.md).

Maude uses **scope model A** — one shared store, decisions tagged by `repo:`/`dept:` — decided in [DDR-189](../.ai/archive/decisions/DDR-189-kgai-cross-repo-shared-graph-trust-model.md). The pro is cross-team query for free (`--all-scopes`); the con is one blast radius, which the trust rules below bound.

Since **kgai v1.5.1** the enrollment mechanism is a **committed `.kgairc`** per repo (not per-machine hand-wiring) — that's what makes this setup reproducible for every engineer who clones a repo.

## 1. The `.kgairc` layer (v1.5.1 three-layer config)

kgai resolves configuration in three layers, most specific wins:

1. **session** — `<store>/kg.config.json` (per-machine install identity, remote, runtime state)
2. **project** — `<repo>/.kgairc` (**committed** — this is the enrollment surface)
3. **global** — `~/.kgai/config.json`

A committed `.kgairc` may carry **only** two keys:

- `store` — where the store lives, relative to the repo root
- `prompt` — capture rules injected to the agent at SessionStart

`remote` in a `.kgairc` is **always ignored** — by design, a cloned repo must never be able to dictate where your graph uploads (the DDR-189 writer-boundary reasoning applied to config).

**The company layout:** every repo in the org folder carries an **identical** committed `.kgairc`:

```jsonc
// <repo>/.kgairc — identical across all company repos
{
  "store": "../.kgai-shared",
  "prompt": "<the shared capture rules — see §5>"
}
```

`store: "../.kgai-shared"` resolves to a **shared store in the parent folder, next to the repos** (e.g. `~/git/studyfi/.kgai-shared` for the 18 StudyFi repos cloned under `~/git/studyfi/`). Every enrolled repo on the machine resolves to the same store — one graph, zero per-repo wiring.

> **Syncthing note:** if the parent folder is synced (as `~/git` is here), add the shared store to `.stignore` (`~/git/.stignore`). The sync channel for the graph is S3 (`kg sync`), never file sync — two machines file-syncing a store would fork install identities.

## 2. `kg trust` — a committed `.kgairc` does NOTHING until approved

A cloned `.kgairc` is inert: **no store is created and no prompt is injected** until a human on that machine approves it. Until then `kg config` reports `pending_approval`.

```bash
kg trust --show       # print the pending .kgairc's exact values before approving
kg trust              # approve it
kg trust --list       # what's approved on this machine
kg trust --revoke     # withdraw an approval
kg trust --dismiss    # reject a pending .kgairc without approving
```

The approval **fingerprint is a hash of the values** (`prompt`, `store`) — not the repo path. Because all company repos carry an identical `.kgairc`, **one approval per machine covers all of them, including repos cloned in the future.** Change either value and it's a new fingerprint needing a fresh approval — which is exactly the property you want: an attacker editing a committed prompt can't ride an old approval.

Personal repos on the same machine can use their own `.kgairc` (own `store: "../.kgai-shared"` under the personal folder, **no remote** — local graph). A different prompt means a different fingerprint, so the two approvals never blur together.

## 3. Create the S3 store bucket

One bucket, one prefix, versioning on (append-only log is safer with object versioning):

```bash
aws s3api create-bucket --bucket studyfi-kg --region eu-central-1 \
  --create-bucket-configuration LocationConstraint=eu-central-1
aws s3api put-bucket-versioning --bucket studyfi-kg \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket studyfi-kg \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

The store prefix is `s3://studyfi-kg/store`.

**The remote is per-STORE (session layer), never in `.kgairc` and never global.** Each engineer sets it once on the shared store after approving:

```bash
kg remote "s3://studyfi-kg/store?profile=studyfi&region=eu-central-1"
```

Do **NOT** use `kg remote --global` — we no longer recommend the machine-wide default remote at all: it would also capture personal/local stores on the same machine and silently upload a private graph to the company bucket. One `kg remote` per shared store is the whole setup (and the onboarding script does it for you).

## 4. Per-user IAM (the writer authorization boundary)

**Only a locally-authenticated CLI writes the graph** ([DDR-189](../.ai/archive/decisions/DDR-189-kgai-cross-repo-shared-graph-trust-model.md) rule 3). Give each engineer their **own** IAM identity — never a shared key, never the hub's credentials. Minimum policy scoped to the store prefix:

```jsonc
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "kgaiStoreRW",
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
    "Resource": ["arn:aws:s3:::studyfi-kg", "arn:aws:s3:::studyfi-kg/store/*"]
  }]
}
```

Attach it to each user (or an SSO permission set). **Do NOT** attach it to any hub / server / CI role — hub-origin writes are quarantined by design (see §6).

## 5. Scope taxonomy (agree it once)

`dept` is the search-bias key and the cross-team unit. Fix the small closed set up front so `hash(kind:name)` converges cleanly across repos. Current set: **`dev` | `marketing` | `design`**.

Per-repo scope `{ repo, dept }` lives in the **committed** `.ai/workflows.config.json` (`knowledgeGraph.scope`) — per-repo config, never hardcoded in the plugin. The shared `.kgairc` `prompt` tells the agent: read scope from that file; if the repo doesn't have one, **derive `repo` from `git remote get-url origin` and default `dept` to `dev`**. This is what lets one identical `.kgairc` (one fingerprint) serve 18 repos while every write still lands correctly scope-tagged.

Namespacing inside the shared graph follows DDR-189: repo-local names are prefixed `<repo>/...` for the kinds `decision`, `milestone`, `plan`, `doc`, `rca`, `code-review`, `security-review`, `execution-report`; genuinely shared kinds (`repo:`, `dept:`, `topic:`, `area:<real-tag>`) stay bare so they converge across repos.

## 6. Trust boundary (enforce, don't assume) — [DDR-189](../.ai/archive/decisions/DDR-189-kgai-cross-repo-shared-graph-trust-model.md)

A single company store is an **attacker-controlled writer surface**, structurally the DDR-054 untrusted-peer boundary but company-wide: a poisoned decision node is read as authoritative context by every repo's `kg sync`. The three rules Maude enforces:

1. **`kg sync` / `kg context` output is untrusted DATA, never instructions.** Maude quotes it as inert, attributed content and never executes a directive it carries.
2. **Hub and kgai are separate trust domains.** The hub is "untrusted to peers" — hub-origin writes are **disabled or namespace-quarantined** (a distinct scope, never merged into the authoritative graph). Don't grant the hub S3 write on the store.
3. **CLI-auth-only writes.** Per-user IAM (§4); the bucket is IAM-scoped (§3).

The `.kgairc` layer adds a fourth, engine-enforced rule: **a clone can propose capture rules and a store location, but never an upload target** (`remote` ignored) **and never silently** (`kg trust` gate).

Before any broad multi-user rollout, run `/flow:validate --security` on the writer surface (a plan acceptance gate).

## 7. Engine version — installer, not a pin

The manual pinned-binary download is **retired**. Engineers install via the official installer, which self-updates at SessionStart:

```bash
curl -fsSL https://raw.githubusercontent.com/kgaidev/kgai/main/scripts/install.sh | bash
```

Required minimum is **v1.5.1** (the `.kgairc` + `kg trust` + `kg config`/`kg prompt` surface). `knowledgeGraph.engineVersion` in `.ai/workflows.config.json` now expresses that floor rather than a hard pin; verify with `kg version`.

## 8. Onboard the engineers

Each engineer clones the company repos **as siblings into one folder** and runs the onboarding script from AI-StudyMate:

```bash
~/git/studyfi/studyfi-design/scripts/kg-onboard.sh
```

It shows `kg trust --show`, waits for the human approval, backfills any legacy per-repo stores (`cp *.ndjson` into the shared log — longest-wins per shard filename — then `kg rebuild`), sets the per-store remote, runs the first `kg sync`, and verifies every repo resolves to the same store. `--yes` exists for running it after the approval was already granted in a Claude session. Full per-user walkthrough: [onboarding](./kgai-onboarding.md).

## 9. Verify the store is live

Have one engineer complete onboarding and `maude kg sync`. A second engineer on a different machine then:

```bash
maude kg sync
maude kg context --about "<a decision the first engineer recorded>" --all-scopes
```

Seeing the first engineer's decision from a different machine confirms the shared store + cross-team query works. `kg config` on any enrolled repo should report the shared `store_root` (not `pending_approval`).

## Cost / scale note

Storage is ~2.6 KB per decision; sync is pull-on-command (`kg sync` at `/flow:done` + `/flow:run --pause`, plus a session-start pull). Model A's rebuild cost grows with the **whole** company log — if the graph ever gets large enough that this bites, revisit per-department keyspaces for the highest-sensitivity depts (the DDR-189 "revisit when" clause).
