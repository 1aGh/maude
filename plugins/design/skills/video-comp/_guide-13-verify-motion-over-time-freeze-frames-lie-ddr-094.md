## Verify motion over time — freeze-frames lie (DDR-094)

A single screenshot can look right while nothing actually animates. When you
check a comp, seek to **two** different frames (or scrub in the Player) and
confirm the output changes. The motion-critic enforces this as a hard gate.

**Seek any frame to verify without a full export:** the Player exposes
`window.__maude_seek__(frame)` on the capture shell — open
`_canvas-shell.html?canvas=…&hide-chrome=1`, `__maude_seek__(N)`, screenshot. Far
cheaper than a multi-minute render when checking a specific beat / motion-graphic.

Two conditions on that URL, or it comes back blank with a `Failed to fetch
dynamically imported module` error that looks like a broken canvas rather than
a bad call:

1. **`?canvas=` must carry the `.tsx` extension** — the canvas-origin route
   gate (`isCanvasSafeRoute` in `apps/studio/http.ts`) only serves paths whose
   extension is on its allowlist.
2. **The port must be the `canvasPort` from `_server.json`**, not the main
   `port` — the shell is served from the segregated canvas origin, not the
   main studio origin.

```sh
maude design screenshot --url \
  "http://localhost:<canvasPort>/_canvas-shell.html?canvas=ui/…/Foo.tsx&hide-chrome=1" \
  --full --out /tmp/x.png
```

If a canvas screenshot comes back empty, check both of the above before
concluding the environment can't do it — an empty screenshot is far more often
a malformed URL than a broken renderer.
