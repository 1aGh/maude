## Step 0 — the geometry manifest (unblocks everything below)

Both the read and write verbs need world-coordinate rects for artboards and elements. `.meta.json` alone can't supply them (position-only since DDR-027; no element data exists on disk at all) — the manifest resolves them from a live render:

```bash
maude design canvas-rects "<rel-path>" --root "$REPO" > /tmp/rects.json
```

Emits `{ artboards: [{id,x,y,w,h}], elements: [{cdId,selector,index,artboard,x,y,w,h,tag,text}], elementsTruncated }`, all in **world coordinates**. Prefers a live/headless render (via the running dev-server + `agent-browser`, falling back to `playwright`) so element rects reflect actual CSS/content; when no server is reachable it degrades to a **static, artboard-only** manifest (meta positions + JSX `width`/`height`) with `elements: []` and a stderr note — read/write still work, just without element-level resolution. Boot the server first (`maude design server-up`) when you need element context.

**Always regenerate the manifest after the canvas layout changes** (an artboard moved, an element resized) — it's a snapshot, not a live subscription.
