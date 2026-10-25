# 10 Share and collaboration — round 7b (p8-c7-ex10b): done / open

Budget went to 09 (Include row, job rows, batch harness, handoff sub line); nothing in 10 changed, so no 10 id was re-shot. The four MUST items named in the brief stay open, with what each needs:

## Open

- **co-ask-edit** — the tip beside the pointer. The shell cannot know where the drag happened: the canvas iframe is a separate origin and `{ dgn: 'view-only-gesture', v: 1 }` carries no coordinates. Needs `x`/`y` (numbers only, still no text) on that message — `bridge/dgn-protocol.ts` (shared, line ~152 + the entry at ~1262), `view-only-gesture.tsx` (send the pointer's client position) and `use-canvas-bridge.jsx` (~870, hand it to the host). Then `AccessLayer` anchors `.v2ac-tip` at iframe origin + (x + 80, y + 18) like the board's callout and falls back to the cluster anchor when absent. Patch request, not done.
- **co-trashed** — the two-line ghost row. `canvases-panel.jsx` ~905 draws name and sub in one flex line inside a fixed-height virtual row; a two-line row needs the row height to grow for ghost rows (the virtual list's row-height source, owned by 11) — a layout change in the list, not a CSS tweak. The Edit cluster kept while the open canvas is trashed is `setTrashedOpen` (the Share cluster's mode lane goes to Viewing) — a product decision (the board keeps Edit; the server refuses the writes anyway).
- **co-conflict** — the decision card on the canvas under the pair, "Keep both" attached, no ×: today a top banner over the Canvases panel; the card has to be anchored in canvas space (a canvas-lib overlay) from the conflict's two artboard rects.
- **co-comment-video** — the timeline strip with comment markers and "2 comments on this video": a new strip under the clip (video canvas) reading comments by time.
