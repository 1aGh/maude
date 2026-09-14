# Project transaction V1 contract review block

Status: **T6 executable draft, not production approved and not a completed T6/T7 milestone.** Authored in `/tmp/maude-multiplayer-t6-contract/` while the repository was frozen for native E2E. No dependencies were installed. Reviewed source is now integrated in this directory; generated exports are reproducible and ignored.

The destination is `scripts/dev/sync-e2e/contracts/` initially, or a reviewed canonical shared protocol package once T9 owns it. Keep this separate from the accepted-candidate publication spike: it does not replace that spike, prove publication fencing or select storage.

## Contents and execution

- `schemas.mjs`: dependency-free JSON Schema 2020-12 factory. All objects reject additional properties, no arbitrary payload dictionary or source-execution operation. Runtime-neutral imports only.
- `limits.mjs`: finite, positive safe-integer configurable limits with consistency validation. Every default is a proposal for T8 measurement, **not a measured service guarantee**.
- `validate.mjs`: injected Ajv 2020 constructor; wire byte/UTF-8/depth/duplicate-key validation, schema validation and explicitly bounded structural cross-checks. No network, storage, project imports, source execution or mutation.
- `fixtures.mjs`, `sidecar-fixtures.mjs`, `invalid-fixtures.mjs`: transferable representative valid and invalid values.
- `sidecar-schemas.mjs`: concrete FootageAnalysis/EDL/public configuration variants and bounded cross-field checks.
- `coverage.mjs`: 11 direct writer-to-schema bindings plus explicit residual variant gaps; `sidecars.test.mjs` checks current source symbols, enum/shape parity and representative values against actual footage validators.
- `contract.test.mjs`: Node test harness using the repository's already installed Ajv. Runtime modules do not depend on Node; the test/export tooling does.
- `export.mjs`: writes standalone default-limit `.schema.json` files and `corpus.json` into `exported/`. Re-run after schema/fixture changes.
- `test-output.txt`: validation evidence for this exact staged block.

From the repository root after copying the block:

```sh
node --test scripts/dev/sync-e2e/contracts/*.test.mjs scripts/dev/sync-e2e/contracts/sidecars.test.mjs
node scripts/dev/sync-e2e/contracts/export.mjs
```

While this directory remains outside the repository:

```sh
CONTRACT_REPO_ROOT=/Users/iagh/git/personal/maude node --test /tmp/maude-multiplayer-t6-contract/contract.test.mjs /tmp/maude-multiplayer-t6-contract/sidecars.test.mjs
node /tmp/maude-multiplayer-t6-contract/export.mjs
```

The repository root is supplied only to the test harness to resolve existing `ajv/dist/2020.js`. No package manifest or lockfile change is required for this review block. The injected compiler currently compiles schemas at startup; T8 must verify Worker compatibility and may require a build-time standalone validator instead of runtime code generation.

## What is schema-conformant

There are **25 named operation families** with **69 representative operation/proposal fixtures**. Passing these means a wire value conforms to this draft's restricted shape; it does not mean the operation has an implementation, authorization, source fidelity, effect algebra or E2E coverage.

| Families | Explicit represented variants | Not yet covered by these schemas/fixtures |
|---|---|---|
| `source.text.assign`, `source.css.assign`, `source.attribute.assign` | Stable element + bounded text/string assignment, property reset via null | Full current property support matrix, typed expression/boolean values, occurrence-vs-component semantics, evaluated CSS safety and exact source transform |
| `source.replace` | Exact base SHA-256 plus declared immutable candidate | Proving base receipt ownership, parsing/validation and conflict resolution |
| `source.structure` | Insert, duplicate, delete, reorder, detach, convert-to-absolute | Every existing artboard/element control, templates, semantic parent compatibility, generated stable IDs and byte-preservation corpus |
| `manifest.create/move/delete` | Explicit empty directory or file, logical paths, parent identity, payload/dependencies, recursive deletion flag | Parent/descendant footprint, cycle/collision detection, source import rewrites, identity allocation, generation retirement and runtime path classifier |
| `manifest.replace` | Existing supporting-file identity/path, exact base hash, declared content blob and dependencies; includes zero-byte files | Positive membership/owner policy, content validation, source/module dependency closure and immutable projection |
| `config.assign` | Seven explicit variants: transcription provider, keyframe engine, DS upsert/remove, default DS, project name, completeness profile | Other public fields, classifier-affecting canvasGroups and local/public physical config split |
| `footage.assign` | Strict full analysis assignment with version 1, asset identity/path, exact prior hash or explicit absent base, shots/tags/speech/provenance | Authoritative source hash/duration lookup, granular shot effects and inverse implementation |
| `edl.edit` | Strict full EDL replacement with beats/music/audioTracks/captions and identity bindings for every referenced media path | Stable beat/track identity migration, granular edits, media-duration validation, codegen/source dependency atomicity |
| `layout.assign` | x, y, width, height, rotation, title; viewport rejected | Guides/print/hug/kind/style schemas and exact source-vs-layout ownership |
| `annotation.create/update/delete` | Stable stroke identity; typed path/rectangle/ellipse/line/text/image shapes; image asset required | Current complete stroke vocabulary, per-field updates/inverses, concurrent stroke merge and sanitization |
| `comment.create/reply/update/delete` | Stable thread/comment/parent, bounded body, anchor, body update or resolved state | Author/role checks, mentions, full anchor vocabulary, deleting another author's records |
| `photo.assign` | Adjustment object, mask, crop, explicit reset | Complete photo-store property vocabulary/ranges, grouped slider semantics and original asset relationship |
| `timeline.edit` | 21 variants: retime, remove, insert, reorder, toggle-hide, replace-src plus **all 15 current clip-edit verbs** | Full parameter domain parity, textual/generated placeholders, transition/grade vocabulary parity, timebase constraints and source operation implementation |
| `history.restore/undo/redo` | Retained revision/action/effect references; no arbitrary replacement payload; one matching history action per proposal | Server-built inverse eligibility, current effect/generation checks, retained history horizon and personal stack replay |

All four former family gaps now have strict representative schemas. Unsupported **variants** continue to fail closed; there is no arbitrary JSON escape hatch and support/config/footage/EDL are not reduced to `source.replace`. `SCHEMA_GAP_FAMILIES` is empty while `RESIDUAL_VARIANTS` remains nonempty. This is a distinction between family shape coverage and complete product capability, not a completion claim.

The source bindings correct one inventory inference: `_import-brand.mjs:importBrand` writes logo assets and returns palette/font cues; it does not itself persist public config. Its direct mapping is `manifest.create(file)`, while the caller's later configuration action is separate. `clip-ops.ts` actually accepts `none`, `fade`, `slide`, `wipe`, `flip`, `clock-wipe`; the earlier review enum's `clockWipe` and `iris` values were wrong and now fail. Tests exercise all six real presentations.

## Deliberate clarifications/additions to the prose contract

These require technical review before updating the canonical protocol documentation:

1. Results carry `status`: `accepted`, `rejected`, `retryable`, `pending`, or transaction-lookup `unavailable`. Terminal `rejected` cannot use `retryable`/`capacity`; those live in retryable attempt responses. `pending` is not saved. `unavailable.reason` distinguishes `absent` from `result-expired`, without pretending either is a terminal acceptance result. The coordinator must still distinguish pending-ID bindings and recover unknown outcomes.
2. Epoch/generation/revision and wall-clock millisecond timestamps are safe integers. Epoch and generation start at 1; initial revision is 0. IDs are bounded opaque ASCII strings. These are proposed encodings, not inferred existing identifiers.
3. Read/write `target` is structured (`lane`, optional stable `recordId`/`property`). Schema validation verifies only the declaration shape and declared document identity, **not the complete operation-derived footprint**. Server-derived read/write sets and validation against accepted state remain mandatory.
4. Effects specify `effectId`, operation index, target identity, previous effect ID, before/after hashes and `undoable`. Null indicates absent previous effect/hash. This describes provenance; it does not implement inverse construction. One operation may yield multiple effects.
5. Events are `revision.accepted` (complete accepted result), `epoch.changed`, or `replay.required`. Only an accepted result advances content. Epoch/revision cross-field ordering is checked within an event; stream continuity, signatures/authentication and authoritative hash validation require a subscriber implementation.
6. Raw wire bytes are returned unchanged for hashing/retention. JSON duplicate keys (including escaped aliases), reserved prototype-related object keys, malformed UTF-8 and oversized/deep payloads fail. Re-serializing the parsed object is not the proposal hash contract. No hash authenticity/durable retention claim is made by this validator.
7. `manifest.replace` is replacement of an existing manifest file: `baseHash` is mandatory and cannot be null. New files use `manifest.create`. Zero-length immutable content is valid and declared as size 0; a zero-byte file must not be confused with an empty directory. Its hash is still verified by the blob store, not by the schema.
8. `footage.assign` uses a required version-1 analysis object and explicit source identity/path. Its `baseHash:null` means an expected absent prior sidecar, never an unproven arbitrary overwrite. Shot ranges retain the existing half-second probe tolerance. `edl.edit` currently exposes strict whole-record `replace` because that is what `saveEdl` writes; per-beat semantic effects still require stable identity migration. All asset paths in beats/music/audioTracks must have exactly one identity/hash binding. The server must resolve those bindings from its accepted manifest.
9. Sidecar normalization must omit absent optional values, stamp version 1 and provide required shot/beat/caption range fields. Legacy validators sometimes accept null/missing required-by-interface fields or any numeric version; this new contract deliberately does not. Imported old records require validated normalization or retained conflict, not coercion that guesses missing time values. New checks also reject first-beat overlaps, hard-cut overlaps, transitions that consume an adjacent beat, reversed captions, duplicate nonempty beat/track names and incoherent fade durations. Full source-media duration checks remain stateful.
10. The config allowlist only names concrete public writer fields. `linkedHub`, credentials, local trust, `designRoot` and classifier-affecting `canvasGroups` cannot travel through it. DS entry paths still require coordinator-side project policy and accepted dependency validation; syntax validity alone does not authorize a directory. Partial public config projection must preserve local settings without echoing them into canonical state.
11. This block chooses constrained example fields/variants deliberately and rejects everything else. Schema approval must not be mistaken for production support or automatic migration of a current UI control.

## Proposed finite limits

Defaults are in `REVIEW_LIMITS`; the same values must be advertised by bootstrap and used by validation. `checkedLimits` rejects unknown/zero/infinite/unsafe values and a per-blob cap above the action total. `maxDependencyDepth` and `offlineReplayHorizonMs` are advertised contract values whose enforcement needs coordinator state; a schema cannot measure either.

| Bound | Review default | Evidence still required |
|---|---:|---|
| Proposal / response bytes | 1 MiB / 2 MiB | Worst-case validation CPU/memory and real media/import action size |
| JSON depth | 24 | Legitimate maximum nested operation envelope |
| Operations / reads / writes | 128 / 1024 / 1024 | Large paste/AI/move fan-out and server-computed descendant sets |
| Direct dependencies / dependency depth | 128 / 32 | Offline chains, bounded graph walk and rejected-parent rebase |
| Blobs / individual blob / action blob sum | 256 / 10 GiB / 20 GiB | Actual storage/runtime quotas, streaming and resumable upload probes; these are metadata caps, never permission to buffer a blob |
| Text chars / property chars / comment chars | 65,536 / 4,096 / 4,000 | Source/UI parity; total byte cap remains authoritative for Unicode |
| Stroke points / effects / selected undo effects | 8,192 / 4,096 / 1,024 | Real whiteboard/large-action stress and bounded inverse computation |
| Footage shots/tags; EDL beats/audio tracks/captions | 512/64; 512/64/5,000 | Existing footage/schema.ts bounds retained; tag text newly bounded to 120 chars |
| Sidecar bytes / total timeline frames / themes | 256 KiB / 10,368,000 / 16 | Existing footage-store byte cap; aggregate frame and theme caps are new review proposals |
| Retry delay / offline replay horizon | 1 hour / 30 days | Retention cost, crash/retry semantics and compaction recovery |

Changing limits is an advertised capability change. Clients must preserve proposals that no longer fit instead of splitting/resubmitting an ambiguous transaction under new IDs automatically. Compatibility/rollout policy for changed limits is still open.

## Validation results and next integration gate

The staged run passes **125 Node tests**: valid operation and proposal per representative variant, unexpected-key rejection per variant, 25-family coverage, 24 reusable invalid fixtures, all new sidecar/config variants, current source-validator parity and direct writer mappings, finite limits, UTF-8/duplicate-key defenses, identity retention, generation shape, payload declaration, result discrimination, effect uniqueness and event ordering. Standalone schemas/corpus (146 valid records, 24 invalid records) are generated from the same factory. The fixture/source binding check is a reachability review aid, not a proof that every writer has been migrated. No product runtime changed, so this block does not claim a new native E2E result.

T6 still requires the complete writer-to-variant/schema/test binding, remaining strict variants listed above, permission/read/write/inverse registry, full example corpus and protocol review. T7 still owns rejection before public mutation and dependent proposal replay. T8 should now use these executable envelopes to probe actual Cloudflare/self-host persistence and validation runtimes, including lost ACK, crash atomicity, fencing, payload limits and restart/restore. T9 must derive footprints, verify payload readiness and accepted-state dependencies, then invoke a storage transaction; this validator alone must never be used as an acceptance gateway.

### Concrete migration gap exposed by this block

At inspection time `apps/studio/sync/file-membership.ts` and its hub mirror positively allow only `.photo.json` and `.audio.json` JSON sidecars, and companion text `css/md/srt`. The actual `saveAnalysis` / `saveEdl` files (`.footage.json` / `.edl.json`) do not enter that file plane. The new schemas do not change this runtime behavior. T17/T18/T20 must explicitly admit the appropriate accepted manifest kinds and projections on both backends, with classifier parity tests and real peer rendering/codegen checks. Do not simply add broad `.json` membership or sync physical config files.
