## Cross-references

- `skill design` § "Comments — element-pinned annotations" and § "Whiteboard annotation layer" (now a pointer here) — the sibling per-element feedback channel; comments are explicit user requests, this whiteboard layer is the freeform sketch surface.
- `/design:board` — the command that drives this skill's read→understand→author→verify loop end to end.
- `apps/studio/bin/canvas-rects.sh`, `read-annotations.mjs`, `annotate.mjs` — the implementation; `apps/studio/canvas-lib.tsx` § "Whiteboard toolkit" — the client-side `window.__maudeCanvasRects()` hook these verbs read.
- `apps/studio/annotations/` — the v2 element model the verbs are built on: `registry.ts` + `elements/*.model.ts` (types and fields), `schema.ts` (the board file), `ops.ts` (`put | patch | delete` and the merge rule), `ai-read.ts` / `ai-write.ts` (the projection and the op builder). Architecture: `docs/architecture/annotations-v2.md`; decision: DDR-242.
