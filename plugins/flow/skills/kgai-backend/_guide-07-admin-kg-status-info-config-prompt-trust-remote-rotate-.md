### ADMIN — `kg status` / `info` / `config` / `prompt` / `trust` / `remote` / `rotate` (troubleshooting, not part of the read/write/sync recipes)

```
maude kg doctor            # already wired — hash-chain + store health
kg status                  # config + graph summary at a glance: version, remote, counts (info is an exact alias)
kg config                  # v1.5.1: resolved three-layer config — store_root, prompt source, pending_approval state
kg prompt                  # v1.5.1: the capture prompt the .kgairc injects at SessionStart
kg trust --show|--list|--dismiss|--revoke   # v1.5.1: the .kgairc approval gate — HUMAN-ONLY, see §2
kg remote                  # no args: shows the store's sync remote and its source — read-only, does not mutate
kg remote "s3://bucket/prefix"   # set the resolved STORE's sync remote (session layer, per-store)
kg rotate                  # gives the LOCAL STORE a fresh install identity — mutating, not a query
```

- `status`/`info` and `remote` (no args) are safe to run directly (they don't create a store — v1.1.0 made every read command side-effect-free in an unrelated directory).
- **The remote is per-STORE.** `remote` in a `.kgairc` is always ignored by the engine (a clone must never dictate an upload target), and `kg remote --global` is no longer recommended — a machine-wide default remote also captures personal/local stores. Set the remote once on the shared store; the company onboarding script does it.
- **`kg trust` is a human decision.** `kg trust --show` (read-only) is fine for diagnosis; the bare approving `kg trust` must never be run by the skill on its own — see the `pending_approval` rule in §2.
- **`kg rotate` is NOT a read despite living in the same help block as `doctor`/`status` — it mutates.** It exists to fix a copied-store shard fork, not for routine use, and **it has no `--help` flag** — passing one runs the real command instead of erroring. Don't probe it speculatively.
