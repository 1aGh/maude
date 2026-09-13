### 4.6. Artboard-count + scope pre-question (when count is ambiguous from brief)

**Fires when:** the brief doesn't explicitly name an artboard count (no "3 artboardy", "5-screen flow", "single canvas with 2 artboards" phrasing). Goal: surface the **render-budget cost** of large canvases BEFORE generation, so users opting for 8+ artboards know the pan/zoom perf wall they'll hit on trackpad-driven zoom.

System-review 2026-05-27 (D-3) flagged that a previous run offered "8 (recommended)" without surfacing perf cost — user picked 8 and reported "pan/zoom stutters badly" once the canvas mounted. The "recommended" tag pushed the choice without surfacing the trade-off. Render-budget heuristic: **≥ 8 artboards on a `--perfect`-shaped canvas with non-trivial CSS hits the canvas-lib pan/zoom perf wall** (~ 2000+ DOM nodes inside a transformable root).

Surface a one-shot `AskUserQuestion` (skip when `--no-critic` or `--quick` — those modes user opted-out of `--perfect`'s default density):

```
Brief implies a multi-screen canvas but doesn't fix the artboard count. Pick:
  (a) 4–5 artboards — snappy pan/zoom; covers the brief's headline flows.
  (b) 6–7 artboards — balanced; pan/zoom feels normal on trackpad. (default)
  (c) 8+ artboards — comprehensive coverage; expect pan/zoom to stutter on
      trackpad-based zoom (canvas-lib transform-root hits perf wall around
      ~2000 DOM nodes). Use when the brief explicitly demands breadth.
```

**Do NOT mark any option "recommended" without naming the trade-off in the same label.** The label IS the trade-off; the "recommended" tag is for cost-neutral defaults. Render budget is not cost-neutral.

**Auto Mode (AskUserQuestion denied):** default to (b) 6–7 artboards (median safe density). Stamp the auto-pick in the final print: `Artboard density: 6–7 (Auto Mode default; brief did not name a count)`.

**Brief explicitly names a count:** skip this question, use the brief's count verbatim. Even when the count crosses the 8-threshold (user explicitly opted in), still flag the perf cost in the final print so the connection between "I asked for 10" and "now my zoom stutters" is documented: `Artboard density: 10 (per brief) — pan/zoom may stutter on trackpad; consider /design:edit "reduce to N artboards" if interaction feels heavy.`
