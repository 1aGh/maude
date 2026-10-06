# Annotations v2 — perf + token benchmarks (Task 30)

Run 2026-09-30 on a MacBook, headless Chromium, commit after Task 25. Raw data is in
`bench-2026-09-30.json`. To reproduce:

```sh
git show c18014b5:apps/studio/bin/read-annotations.mjs > /tmp/old-read-annotations.mjs
node apps/studio/test/e2e/annotations-bench.mjs --sizes 200,1000,5000 \
  --old-reader /tmp/old-read-annotations.mjs --out bench.json
```

Boards come from `test/fixtures/perf-annotations-mixed.mjs` (the Task 3 generator) and
mix every kind: nested sections, bound arrows, labelled shapes, groups, pen, text. N is
the v1 stroke count; v2 merges shape labels into their shapes, so it holds about 20 %
fewer elements.

## Results

| board (v1 strokes → v2 elements) | 200 → 161 | 1000 → 808 | 5000 → 4034 |
| --- | --- | --- | --- |
| AI read, v2 (bytes) | 13,995 | 71,066 | 364,828 |
| AI read, pre-v2 reader on the same board (bytes) | 40,085 | 203,872 | 1,040,558 |
| **read ratio** | **2.86×** | **2.87×** | **2.85×** |
| single `annotate update` op | 47 B ≈ 12 tokens | same | same |
| canvas load (navigation → every element node drawn) | 109 ms | 114 ms | 334 ms |
| drag p95 frame interval (30-step sticky drag) | 17.9 ms | 17.8 ms | 18.0 ms |
| layer renders during the drag | 31 | 32 | 32 |
| **element-node renders during the drag** | **30** (= 1 per tick) | **30** | **30** |
| **bytes sent per edit** (the drag's op batch) | **174** | **174** | **176** |

The size of a Yjs update per field edit was measured in Task 9: under 120 B for both 2
and 2,002 elements.

## Gates

| gate | result |
| --- | --- |
| Bytes per edit don't depend on board size (±10 % from 200 to 5000) | ✅ 174 → 176 B (+1.1 %) |
| Drag p95 at 1000 no worse than baseline | ✅ 17.8 ms. The Task 3 baseline is the pan/zoom gesture (p95 16.7 ms at 1000; 33.4 ms `--fit-all`). The drag stays at one frame at every size. |
| Renders during drag ≤ selected + bound | ✅ Only the dragged element's node re-renders: one render per tick for one selected element with no bound arrows. Every other node keeps its identity. |
| AI read ≥ 3× smaller | ❌ **2.86×**, a near miss. *Re-baselined to ≥ 2.8× on 2026-10-05 ([DDR-244](../../../archive/decisions/DDR-244-annotations-v2-stroke-view-is-the-editing-end-state.md) §3) → ✅.* |
| Single write ≤ 40 tokens | ✅ about 12 tokens |
| `rbush` only if a 5000-element marquee or hit test exceeds 8 ms | Not added. The drag stays at one frame at 4,034 elements. |

### Why the read ratio stops at about 2.9×

The v2 projection is already compact:

- whole-unit world boxes;
- style only with `--full`;
- sections nest their members instead of listing them twice.

What remains per element is its id, its type, a box, its text, and for arrows the
computed endpoints plus the ids at each end. The plan's schema requires those
endpoints. Dropping `pts` for arrows bound at both ends would clear 3×, but agents
would then have to resolve the geometry themselves. That changes the AI contract, so it
is left as a decision for the owner and is not made here.

## Not measured here

- **Safari (WebKit) lane.** `perf.sh --engine safari` needs `safaridriver --enable`
  (a one-time, password-gated step).
- **Pan/zoom on the v2 layer.** `perf.sh --fixture --mix` still generates a legacy SVG
  board. The board is migrated at boot, so the pan/zoom lane does run on v2, but that
  run hasn't been repeated here.
