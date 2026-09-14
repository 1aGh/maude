# Actual AWS coordinator latency probe — 2026-09-14

This measures the object-journal prototype on the existing StudyFi AWS host,
using synthetic projects in a fresh S3 prefix. It is not a product deployment or
a measurement of editor-to-peer rendering. The measured build used the earlier
inline snapshot format (snapshot version 1 inside head version 2); subsequent
document-page changes require their own evidence.

The standalone 165,202-byte ESM bundle, SHA-256
`72ebe4913ad00c384d89ab7773711c873f14e2669a356a98c2c453cdd21fd903`,
passed its local empty-cwd/no-dependencies test on Node 22.13.1. On AWS it ran in
the exact existing hub image, Node **20.20.2**, Linux x64, with a read-only
filesystem, 256 MiB memory, one CPU, 32 PIDs, no capabilities, and no new
privileges. S3 credentials passed in memory through stdin and are not in the
bundle, evidence, command arguments, or logs. No hub/render restart occurred.

Account: 797601398300; region: eu-central-1; host: i-0e484a007adbf57a5;
bucket: `studyfi-shared-euc1-design-assets`. Run: 12:59:27–41 UTC.
SSM command: `7c10eabb-35bc-407b-9e05-3f7d794494b6`, terminal **Success**.

| Synthetic value | Samples | Median append | Sample p95 | Maximum | Cold state |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 KiB | 20 | 91.38 ms | 106.81 ms | 177.33 ms | 54.85 ms |
| 64 KiB | 20 | 98.93 ms | 109.12 ms | 109.95 ms | 48.97 ms |

Every append used one GET and two conditional PUTs and produced its exact next
revision. Four snapshots per project preserved the final text and oldest exact
receipt on cold reconstruction. Snapshot costs were 227.90–255.36 ms, with one
GET and seven PUTs each. Reported ending RSS was 95,068,160 bytes; this is not peak
memory or a load test. These are descriptive small-sample percentiles, including
the first append; they are not qualified p95/p99 product SLOs. Wire/schema checks,
receipt lookup, replay and S3 commit are included. TSX validation, client RTT,
publication, peer render, contention and background load are excluded.

This replaces the earlier uncertainty about development-host RTT: in-region
metadata latency leaves a plausible, still unproved budget for a 300-ms peer
render. It does not yet select the production adapter. Cloud DO/R2, full source
validation, large document state, retention/compaction, runtime isolation and
full pipeline evidence remain required.

The first attempt failed before probe execution because Python's temporary
directory was not traversable by the image's unprivileged user. Only diagnostic
code is now readable in that directory. That failed attempt's single S3 object
version was deleted. It is not a sync failure or a successful latency sample.

Successful-run evidence: `/tmp/maude-aws-regional-proof-v2/evidence.json`, including
source/bundle copies in `source/`. Its **139 exact object versions were removed**,
and no versions or markers remain beneath
`maude-sync-conformance/9a518259-b783-43cf-9300-4cceedc6f90e/`.
The private command file and temporary container/code directory are removed by
the runner. An uncertain remote dispatch or polling timeout preserves test
objects until remote termination can be established; it never implies a restart.

The static Ajv ESM import required for the bundle also passed the original
20 local journal/snapshot tests: `/tmp/maude-regional-journal-regression.log`.
