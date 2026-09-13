## Safety invariants

- **Archive-preserving.** `.ai/decisions/` is NEVER deleted (DDR-044). Migration is additive.
- **Idempotent.** Writes an `.ai/.kgai-migrated` marker; re-running refuses without `--force`. Deterministic `hash(kind:name)` converges the *elements* on re-ingest, but re-ingest still appends duplicate decision *events* — hence the guard.
- **Dry-run first.** `--dry-run` prints counts + a sample subgraph, writes nothing.
- **Author is automatic** — `git config user.name` via kgai's `guessActor()`.
