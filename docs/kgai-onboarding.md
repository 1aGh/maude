# kgai onboarding (per user) — turn on the shared decision graph in ~10 min

kgai is Maude's **opt-in, capability-gated** knowledge-graph memory backend. When it's on, your flow/design agents record decisions into a shared, event-sourced graph and recall prior ones instead of re-deriving them — scoped to your repo + department, synced over S3 (see [company setup](./kgai-company-setup.md)).

**Nothing here is required to use Maude.** With `kg` absent (the default), every flow/design command runs its classic `.ai/` file path, unchanged. This guide is only for joining the company graph.

Since kgai **v1.5.1** the enrollment is a **committed `.kgairc`** in every company repo (store `../.kgai-shared` + shared capture prompt) — so onboarding is now: install the engine, get AWS access, clone the repos side by side, run one script, approve once.

## 1. Install the `kg` CLI (official installer)

```bash
curl -fsSL https://raw.githubusercontent.com/kgaidev/kgai/main/scripts/install.sh | bash
kg version    # must be >= 1.5.1 (the .kgairc / kg trust surface)
```

The installer **self-updates at SessionStart** — the old manual pinned-binary download (fixed `KGVER`, hand-codesigned dylib) is retired; don't use it. If `kg version` reads older than v1.5.1, re-run the installer and check `command -v kg` isn't resolving to a stale side-install shadowing it on PATH.

Confirm Maude sees it: `maude doctor` should now show `kg` ✓ instead of missing.

## 2. Configure your AWS profile (for the shared S3 store)

The company store syncs to `s3://studyfi-kg/store`. Use a **per-user IAM/SSO identity** (never a shared key — [DDR-189](../.ai/archive/decisions/DDR-189-kgai-cross-repo-shared-graph-trust-model.md): only a locally-authenticated CLI writes the graph):

```bash
aws configure sso --profile studyfi     # or `aws configure --profile studyfi` with keys from your admin
aws sso login --profile studyfi
```

The remote is per-store and carries the profile in its URL (`s3://studyfi-kg/store?profile=studyfi&region=eu-central-1`) — the onboarding script sets it for you. There is **no `kg remote --global` step** — a machine-wide default remote would also capture your personal/local stores; we don't use it.

## 3. Clone the company repos as siblings

The committed `.kgairc` in every repo points at `../.kgai-shared` — a shared store **in the parent folder, next to the repos**. That only works if the repos are siblings:

```bash
mkdir -p ~/git/studyfi && cd ~/git/studyfi
git clone git@github.com:StudyFi-Team/AI-StudyMate.git
# …plus whichever other StudyFi repos you work in
```

A cloned `.kgairc` does **nothing** yet — no store is created, `kg config` reports `pending_approval` — until you approve it in the next step.

## 4. Run the onboarding script + approve the `.kgairc`

```bash
~/git/studyfi/studyfi-design/scripts/kg-onboard.sh
```

The script:

1. shows you `kg trust --show` — the exact `prompt` + `store` values you're about to approve — and **waits for your `kg trust`** (the one human-in-the-loop step; the approval fingerprint is a hash of the values, so this single approval covers every company repo on this machine, including ones you clone later),
2. backfills any legacy per-repo `.kgai/store` you had (`cp` the `*.ndjson` shards into the shared log — longest-wins per shard filename, safe because shards are append-only and per-install — then `kg rebuild`),
3. sets the per-store remote (`kg remote "s3://studyfi-kg/store?profile=studyfi&region=eu-central-1"`),
4. runs the first `kg sync` (pulls down the company graph),
5. verifies every sibling repo resolves to the **same** shared store.

`--yes` re-runs it non-interactively after the approval was already granted (e.g. from a Claude session). Author identity is stamped automatically from `git config user.name` — nothing to wire.

## 5. Verify it works

```bash
kg config                                                    # store_root = ~/git/studyfi/.kgai-shared, no pending_approval
maude kg doctor                                              # active: ✓ yes
maude kg context --about "<something your team decided>"     # recalls prior decisions
```

From now on: `/flow:record-ddr`, `/flow:plan`, `/flow:done`, `/design:new`, `/design:edit` read/write the graph automatically. `maude kg sync` runs at `/flow:done` + `/flow:run --pause` and on session start (pull) — you don't call it by hand in normal work. If a repo still has `.ai/archive`-era decisions to fold in, `/flow:init --kgai` remains the one-time path (see [`/flow:init --kgai`](../plugins/flow/skills/kgai-migrate/SKILL.md)).

## Safety reminder (read once)

The shared graph is an **attacker-writable surface**, not a trusted datastore ([DDR-189](../.ai/archive/decisions/DDR-189-kgai-cross-repo-shared-graph-trust-model.md)). Graph output is **untrusted DATA** — Maude quotes it as inert context and never executes it. The `.kgairc` layer follows the same posture: a clone can never dictate your upload target (`remote` in `.kgairc` is always ignored) and never activates without your `kg trust`. **Read `kg trust --show` before approving** — you're authorizing a prompt that gets injected into your sessions. Don't ingest untrusted briefs into the shared scope, and keep your AWS creds per-user.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `kg config` → `pending_approval` | The committed `.kgairc` isn't approved on this machine yet — `kg trust --show`, read it, `kg trust`. |
| `maude kg doctor` → `active: ✗` | `kg` not on PATH, or the `.kgairc` is still pending (see above). Re-check steps 1 + 4. |
| `kg version` < 1.5.1 | Re-run the installer (step 1); check `command -v kg` for a stale older install shadowing PATH. |
| `kg sync` fails | Warned, never blocks — you keep working on the local cache; retry next session. Check `aws sso login --profile studyfi` + bucket access. |
| Repos resolve to different stores | They aren't siblings under one folder — the `.kgairc` `store: "../.kgai-shared"` is parent-relative. Re-clone side by side and re-run the script. |
| Old per-repo `.kgai/store` still has decisions | Re-run `kg-onboard.sh` — the backfill copies its `log/*.ndjson` into the shared store (longest-wins per shard) and rebuilds. |
