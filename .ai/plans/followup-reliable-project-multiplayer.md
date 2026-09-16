# Follow-up: reliable project multiplayer

Deferred by the owner on 2026-09-16 from
`feature-reliable-project-multiplayer.md` (T1 certified with one reservation;
T31 and T35 closed). Everything here was open when the parent plan closed.

## Tasks

- [ ] **F1 — `L15.video.create` on the hub lane.** In a full surface run the hub
  browser's "⌘K → New video → Enter" does not open the name prompt (palette
  closed, no `.st-prompt`, an `INPUT` focused). Failed in 4 of the last 6 full
  runs; passes with `--only L15` and on the native and peer lanes. The stale-Enter
  fix (`aad823ab`) did not change it. Reproduce:
  `caffeinate -dimsu bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode candidate --save-mode accepted`.
  Done when a full run passes with no failed row, which lifts T1's reservation.
- [ ] **F2 — T18 R2 multipart evidence.** One real multipart round-trip against an
  R2 bucket through the hub's S3 client (`apps/hub/src/s3.mjs`). Needs R2
  credentials.
- [ ] **F3 — T32 S01–S19 on real backends.** Run the scenarios and the T8 crash
  oracle on disposable cloud and self-host projects, with cleanup.
- [ ] **F4 — Latency target.** Peer render p95 is still ~480–650 ms against the
  300 ms target; measure under matched conditions and close or re-scope.
- [ ] **F5 — Refused pulled path.** `relocatePulled` still falls back to the slug
  target when a present path is refused (`resolvePulledTarget` returns null only
  for escapes); end the pull instead, as its own comment says.
- [ ] **F6 — Pull-pin release race test.** The stale-scan fix (pull pin kept until
  the scan lists the body) has no dedicated regression test.

## Validation

A full certifying surface run with 0 failed rows, the sync lane and hub suite
green, and each fixed item with a test that fails without its fix.
