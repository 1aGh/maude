# T8 self-host persistence experiment — local SQLite process-crash boundary

**Outcome:** 13/13 executable tests pass using the actually installed SQLite binding. A single local SQLite database can atomically retain action bytes, ordered head, idempotency result and coordinator epoch across the tested process kills. This is a candidate primitive, **not completion of T8, selection of the production adapter, AWS durability proof, or permission to integrate T9–T12**.

Initial experiment code/data lived in `/tmp/maude-multiplayer-t8-selfhost`. Reviewed source now lives in this repository; each run prints a fresh temporary evidence directory (override `MAUDE_SPIKE_EVIDENCE_DIR`). No dependencies were installed, no remote service was changed, and no E2E build/source snapshot was edited.

## Reproduce and inspect

```sh
MAUDE_REPO=/path/to/maude /path/to/node24 --test scripts/dev/sync-e2e/durable-store-spike/selfhost/probe.test.mjs
```

- `sqlite-store.mjs`: append/head/result/replay/epoch experiment, no production imports except the installed SQLite dependency.
- `crash-child.mjs`: real child process; writes the exact reached boundary to inherited fd 4 synchronously, then blocks until the parent sends **SIGKILL**.
- `coordinator-child.mjs`: second live process opened before a coordinator handoff, subsequently attempting its stale write.
- `probe.test.mjs`: assertions, fault injection, fresh checkout reconstruction and latency samples.
- `test-output.txt`: first complete run, 13 passed / 0 failed; rerun after adding authenticated-actor dedup scoping.
- `latest-run.txt`: most recent data directory. Current run: `runs/2026-09-14T11-24-43.627Z/evidence.json`.
- Each test retains its actual `durable/accepted.sqlite` independently from renderer checkout directories. Per-case database files remain available for inspection.

Installed runtime: **Node v24.13.0**, **better-sqlite3 12.11.1**, **SQLite 3.53.2**. The binding resolves through `MAUDE_REPO/apps/hub/package.json`, or by finding the Maude repository among current-directory ancestors. No personal absolute path is embedded in the adapter. Production packaging remains unproved.

## Storage sequence actually executed

The experiment is deliberately a small file-assignment action vocabulary, not an implementation of the full source/manifest/effect protocol. Action bytes are kept inline in the authoritative SQLite log, bounded at 2 MiB, with SHA-256 verification during replay. No object-store reference or remote I/O is involved.

1. Validate the probe payload's byte cap, file count and path shape before opening a transaction.
2. `BEGIN IMMEDIATE` acquires the database write lock.
3. Read the project epoch, owner and head inside that transaction. Reject stale epoch/owner.
4. Resolve a retained result for `(project, authenticated actor, transaction ID)` before base comparison. Equal payload bytes return the exact retained result; changed payload bytes reject ID reuse.
5. Check base revision, insert the ordered action/payload row, insert its result, and conditionally advance head under the same epoch/owner/base fence.
6. `COMMIT` under `journal_mode=WAL`, `synchronous=FULL`.
7. Return the retained result. The child can emit this result as its ACK. No event publication implementation is claimed.

The epoch is stored in SQLite and incremented under its own `BEGIN IMMEDIATE` transaction. Multiple connections/processes using **the same local database** therefore serialize takeover and acceptance. A writer which commits before takeover is ordered before that takeover; after it commits, the old epoch is fenced. No distributed lease, object-store head, separate-volume fencing or multi-region guarantee is implied.

## Fault oracle and results

| Fault / boundary | Actual observation after opening a fresh store connection |
| --- | --- |
| SIGKILL after action insert | Head 0, no action/result retained; exact retry produces revision 1 once |
| SIGKILL after result insert | Head 0, no action/result retained; exact retry produces revision 1 once |
| SIGKILL after head update, before COMMIT | Head 0, no action/result retained; exact retry produces revision 1 once |
| SIGKILL after COMMIT, before ACK | Head 1, action and result retained; retry returns identical result and does not append again |
| SIGKILL after emitted ACK | Emitted result equals retained/retried result; head remains 1 |
| Epoch takeover while stale coordinator process remains alive | Old process returns `epoch-stale`; no old action retained; new coordinator commits revision 1 |
| Same transaction ID, different authenticated actors | Each actor receives an independent revision and retained result; exact retries remain actor scoped |
| Same transaction ID, same actor, changed bytes | `transaction-id-reused`; original result/head preserved |
| Destroy old renderer checkout; create distinct empty directory | Replay reconstructs both accepted files at revision 2 from independent SQLite store |
| Existing write lock, 30 ms busy timeout | Actual `SQLITE_BUSY`; no accepted result; retry after lock rollback commits once |
| SQLite `max_page_count` quota | Actual `SQLITE_FULL` during append; action/result/head all roll back |
| Oversized payload / mutated stored payload | Capacity rejected before append; SHA mismatch prevents replay instead of silently restoring corrupt bytes |

The kill harness records child PID, exact checkpoint marker, OS termination signal, acknowledged result if present and recovered head. It does not substitute provider teardown, an exception, or removal of a directory for process death. `integrity_check` passes after every killed writer.

The quota test is a **real SQLite database page quota**, not a physical disk-full or AWS volume-quota test. The busy test uses real independent SQLite connections. The epoch test uses a real second child process kept alive across takeover.

## Measured local acceptance cost

Thirty sequential samples per size, including JSON construction/parse, hashing and actual local FULL/WAL transaction commit. These are descriptive local measurements, not a statistically qualified product p95 or an end-to-end budget proof.

| File content size | Samples | Median | Sample p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| 1 KiB | 30 | 0.431 ms | 2.020 ms | 2.850 ms |
| 64 KiB | 30 | 1.662 ms | 4.204 ms | 4.338 ms |
| 1 MiB | 30 | 14.878 ms | 54.362 ms | 108.764 ms |

No network, authentication/membership lookup, source parser, candidate application, object-store upload, rendering, fanout or durable remote journal cost appears here. Large source files and media should not be extrapolated from the 1 MiB row. The 2 MiB experiment cap and 1,000-file cap are probe bounds, **not selected production limits**.

## Decision history checked

Read current plan T8 and `docs/architecture/project-transactions.md`, and queried the local graph for reliable-multiplayer persistence, SQLite backup, and DDR-199; raw search/context outputs are retained here. Relevant existing constraints:

- The current plan explicitly makes persistent SQLite + a verified object-storage journal/conditional durable head an unproven self-host candidate. Periodic SQLite backup cannot establish per-action durable acceptance.
- DDR-205 records the Alligators backup incident: nominally successful archives were not restorable. Its requirement to exercise restore when producing recovery artifacts motivates the separate, actually empty checkout test here. This probe does not claim to have repaired or verified those backups.
- The accepted transaction draft requires atomic head/action/result/effect/manifest acceptance and durable payload availability before acknowledgement. This tiny experiment proves the local atomic storage primitive for head/action/result, but does not implement the complete effect/manifest transaction kernel.

## Remaining gates before selecting an adapter

1. **AWS durable storage:** inspect and test the actual configured volume/mount lifecycle across container replacement, host replacement, attach/detach, failover and disaster recovery. Process SIGKILL on a local Mac does not prove power-loss survival, host loss, durable-volume provisioning or remote recovery. FULL synchronization is requested; physical media/controller and power-failure semantics were not tested.
2. **S3 journal and conditional fenced head:** implement the actual candidate against the existing S3 integration. Prove payload-before-head ordering, conditional epoch/head CAS, exact retries after ambiguous network results, stale writers on distinct disks, and recovery with the SQLite disk also lost. No file-target fake is S3 evidence. If the candidate cannot establish this boundary, evaluate the plan's transactional PostgreSQL alternative rather than weakening ACK semantics.
3. **Blobs and media:** inline action bytes cannot prove durable blob availability. Add immutable payload/blob writes with digest/length verification and test absent, partial, corrupt, expired and unauthorized references; acknowledge no action referencing unavailable content. Verify upload resume and object-store lifecycle rules.
4. **Snapshots / compaction:** this probe reads the whole retained log; it has no bounded paging or snapshots. Design immutable snapshots carrying revision/manifest/effect provenance and checksums, an atomic retained head/snapshot pointer, a declared idempotency horizon, replay from snapshot plus suffix, and compaction that cannot delete required results/dependencies. Kill during snapshot write, pointer commit and compaction; verify empty-disk recovery and reject corrupt/missing snapshots.
5. **Production protocol:** finish authorization, tenant isolation, canonical envelope hashes, generation/dependency validation, manifest/effect records, personal undo, stable identities and source validation. Probe caller-supplied actor/owner/project fields are trusted test inputs, not an authentication layer; production must derive actor identity from authentication. Dedup keys include actor explicitly. Payload validation here does not parse TSX or execute any canvas code.
6. **Projection/publication:** projection is per-file temp-write/rename into a fresh directory, not atomic multi-file visibility or a live UI publication gate. Test crashes after commit/before publication, ordered catch-up, replay gaps, independent accepted replica visibility, and the documented weaker filesystem boundary. No DOM/native E2E is claimed by this storage test.
7. **Operational contract:** migrations, database location outside disposable checkout, WAL/SHM handling, filesystem permissions, verified online backups, alerting, corruption response, startup readiness, space limits and capacity planning. Do not copy only a live main `.sqlite` file and omit its WAL. Packaging must prove the selected binding/runtime works on every actual self-host target.
8. **Two-backend conformance and staging:** the sibling `../conformance/` corpus now normalizes strict ProposalV1 and result retention over both local adapters (22 passing tests). Still run the same full contract and crash oracle on actual Cloudflare DO/R2 and self-host AWS storage; measure realistic validation/upload/ACK latency and restore/compaction cost before recording a production adapter decision.

Recommendation from this bounded evidence: retain SQLite as a viable **single-volume metadata primitive** for the next self-host candidate experiment. It supplies local transaction/idempotency/fencing behavior; it does not yet satisfy the plan's remote durability boundary. Keep T8 open and dependent production integration gated.

## Follow-through — 2026-09-14

The sibling `../object-journal/README.md` now records a small real AWS S3
conditional head/journal experiment: two owner processes race, a live old owner
is fenced across handoff, and SIGKILL after S3 head/before ACK recovers exactly
once. Eleven local failure checks and three actual S3 cases pass; the scratch
prefix's 16 versions were removed and zero remained. This addresses the initial
missing S3 primitive experiment above, but does not establish the full SQLite
cache+object journal, snapshots/compaction, immutable IAM, cost or product gates.
