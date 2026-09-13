# Reliable project multiplayer

**Plan:** `.ai/plans/feature-reliable-project-multiplayer.md`

**Status:** specified; local baseline runner/evidence required in T1, extended regression checks throughout, backend certification in T31/T32. No scenario is claimed passed by creating this file.

**Persona:** an invited nontechnical designer, a second designer, a local AI/editor author; owner only creates membership, viewer cannot mutate.

## Platforms and backends

- Required: browser web-desktop and bundled native macOS WKWebView; real Cloudflare and self-host/AWS persistence in separate isolated projects.
- Release compatibility: shipped Windows/Linux artifacts and native project-opening smoke.
- N/A: native iOS/Android (no Maude mobile app); mobile authoring is outside existing product scope. Narrow browser layouts still receive UI/accessibility checks.
- Stubbed auth and local file storage are fast checks, never substitutes for real invite, designer role, backend durability or bundled app evidence.

## Fixture contract

Use private per-run config/profile directories and disposable project IDs; never mutate users' personal hubs.json, local projects or production shared content. Create one owner, two designers and a viewer per backend. Seed a source-preserving TSX corpus, styles, DS dependencies, comments, annotations, photo/timeline examples and an asset manifest. Record source version, protocol epoch, backend adapter and build identity.

For scale, use the complete eligible large-project inventory with representative >95MiB and >512MiB objects, documented raw/excluded/eligible bytes and peak disk use. Sparse files are only scanner unit fixtures, not upload proof. Tests that remove disks must remove only a fixture's replaceable checkout/renderer disk and keep the selected durable store independently identified.

## Mandatory early local E2E

[local-e2e.md](local-e2e.md) defines **L01–L24 surface groups with separately asserted operation variants**, all bidirectional and checked on receiving UI, disk/content and media render. It is an additional acceptance matrix, not a replacement for S01–S20. T1 implements and captures the unchanged baseline before sync behavior changes; affected cells run after each change and the entire matrix at every milestone. T31 certifies the completed matrix against that baseline. No cloud credentials are required for the local lane; real vendor durability remains a separate T32 obligation.

The user explicitly requires preserving today's usable product. Passing unit tests, eventual disk equality or a green `synced` badge is insufficient. Newly introduced functional failures, routine false conflicts, manual refresh/resync requirements and reproducible material latency regression block advancement.

## Scenario matrix

Run every applicable row on **both** backends; persistent edit rows in browser→desktop and desktop→browser directions. Use two independent desktop profiles/sidecars plus browser for concurrent rows.

Execution order: T1 implements the local baseline/regression runner for L01–L24; T31 adds/certifies the backend/native runners; T31/T32 execute S01–S19 on isolated projects before rollout. S20 runs in T33 on the upgraded initial deployments. Final T35 acceptance requires L01–L24 and S01–S20, so production verification does not create a circular pre-rollout dependency.

| ID | Flow | Required oracle |
|---|---|---|
| S01 | Owner invites designer → accept → clean app login → project pick → managed copy → first edit | No token/terminal/Git/folder choice; browser peer renders first accepted edit |
| S02 | Same-name projects on different servers; expired/revoked invite; viewer and removed designer | Correct project identity; no unauthorized write; recovery work retained |
| S03 | A changes title, B changes color from previous base, both save | Both independent changes survive, or unproven-base candidate explicitly preserved; no silent loss |
| S04 | Submit invalid U1, create repair U2 depending on it, restart/reconnect | Accepted state/peer/history never contains U1; repair rebases safely; original candidate bytes remain |
| S05 | Raw Yjs Update/SyncStep2 and old epoch on an already-open socket/loopback | Accepted head/log/replicas unchanged; permitted awareness remains bounded |
| S06 | Offline edit → app restart → peer changes → reconnect; first queued action rejected | Durable local queue survives; dependents held/rebased; no cross-account replay |
| S07 | AI canvas+module action interrupted, then valid atomic commit and retried commit | No half-revision rendered; one logical action and one committed result |
| S08 | Text/CSS/attr, element insert/move/delete, canvas rename/delete | Valid current IDs and references; stale generation cannot resurrect content |
| S09 | Comments, annotations, photo transform, timeline edit, artboard layout | Every persistent effect has transaction ID; local camera/presence not in durable content history |
| S10 | A edits property, B edits independent/same property, A undo/redo; ABA; deleted target | Own safe effects compensated; peer effects preserved; partial rejection visible |
| S11 | Open history, preview old media/source, restore during peer activity | Restore is a new action; history and referenced blobs remain readable |
| S12 | Multipart upload interrupted/restarted; completion ACK lost; quota/hash failure | Resume verified bytes; one completed object; no incomplete accepted reference or silent omission |
| S13 | Open project while large media seed/renderer restore ongoing | Project metadata and active document available without full seed; readiness truthful |
| S14 | Complete real scale inventory on two clean clients while editing | Final eligible hash parity; all exclusions/blocks explained; no starvation of doc edits |
| S15 | Kill before/after payload, head, ACK, broadcast; restart with fresh renderer disk | Zero acknowledged actions lost; zero duplicate logical actions; replay equals accepted hash |
| S16 | Two coordinator epochs; timeout/full store; missing blob; compaction and GC | One fenced head; no false ACK; protected current/history/pending references |
| S17 | Migration shadow/drain/epoch flip; stale process; rollback before/after new write | No dual writer; bytes/history/pending work conserved; nonrepresentable downgrade stays recoverable |
| S18 | Statusbar/CloudBar/panel under pending, conflict, failed media, offline, persistence failure | Same truthful state and actionable language; no misleading “Saved” |
| S19 | Dark/light, keyboard navigation, dialog focus/escape, screen-reader statuses | Zero DS/a11y blockers; no protocol jargon required to continue |
| S20 | Invite→open→edit→undo→quit→reopen on actual upgraded initial deployments | Full product works as designer in bundled app; exact build/protocol and evidence recorded |

## Runners to implement in T31

Prerequisite already built in **T1**: `runners/local-e2e.sh --mode baseline|candidate [--baseline <evidence-dir>]`, composing existing sync-e2e and native helpers. The flags are proposed deliverables, not existing commands. T31 extends this runner and must not create a separate competing surface catalogue.

- `runners/web-desktop.sh`: thin entry to extended `scripts/dev/sync-e2e.mjs` with isolated real hub/peer/browser setup and actual backend adapter lane.
- `runners/native-macos.sh`: thin entry to new `apps/desktop/e2e/wdio.multiplayer.conf.ts`; reuse existing fixture/evidence/canvas-frame/sidecar helpers and scenario `project-multiplayer.e2e.ts`.
- Actual backend target selection and authentication are injected through the test harness's secure operator configuration; reports never contain credentials. Do not guess real tenant targets from display names.

## Evidence and result schema

For each backend/platform/row record `pass | fail | not-run`, source/build ID, fixture project ID, protocol epoch, action/revision IDs, expected/actual hashes, timing boundary and evidence paths. Required `not-run` blocks completion. Failure injection records actual process PID termination and replaced-disk identity, not just a disconnected provider.

Reports attach screenshots from both clients for representative states, machine-readable inventory/parity output, transaction oracle results, and latency percentiles under recorded device/network/load. Keep test secrets and user source out of public logs. `--no-browser` results prove only the disk/transport half.

Performance targets from the plan: local ordinary edit p95 ≤50ms; peer render p95 ≤300ms/p99 ≤1s at RTT ≤100ms same region; warm active document ≤2s on recorded hardware. Distinguish shared durable ACK, peer render and full media completion.

**Completion:** L01–L24 pass locally with the no-regression comparison, and S01–S20 pass on both backend families and required surfaces; no blockers, unexplained missing files, lost acknowledged actions or unauthorized writes. Link final reports from the plan and release/PR description.
