## Preview + export

- **Preview/scrub** is free — the Player shows transport controls in the canvas,
  and the **Timeline panel** (View → Timeline) scrubs + retimes sequence blocks.
- **Export** via the ⌘E dialog or the slash command (DDR-062 — go through the
  command, never a bin path):
  - `\/design:export mp4 --scope artboard` — fps/duration come from the comp meta.
  - `\/design:export gif --scope artboard --option fps=15 --option gifColors=128`.
  - MP4 is H.264 (falls back to WebM if the capture browser has no H.264 encoder);
    GIF is palette-quantized. Both render deterministically through the capture
    spine — **no native binaries, no user install**.

**Exporting from a CLI/script instead of the ⌘E dialog:** a plain `curl` to
`localhost:<port>` can fail with "fetch failed" — `_server.json` advertises
`localhost`, but the server binds the IPv4 loopback `127.0.0.1`, and on macOS
`localhost` can resolve to the IPv6 `::1` first. Call the API through
`127.0.0.1` directly. Prefer the **non-blocking** `POST /_api/export-jobs`
over the blocking `POST /_api/export` — a render kicked off through the
blocking route keeps running orphaned (burning CPU) if the client disconnects,
where a background job is tracked and can be checked/downloaded independently:

```sh
curl -X POST "http://127.0.0.1:<port>/_api/export-jobs" \
  -H "Origin: http://127.0.0.1:<port>" -H "Content-Type: application/json" \
  -d '{"format":"mp4","scope":"artboard","options":{"scale":1}}'
# status:   GET /_api/export-jobs
# download: GET /_api/export-jobs/download?id=<jobId>
```

**Cancelling a stuck render:** `kill <PID>` the specific `_video-playwright.mjs`
process — never `pkill` by pattern on a shared machine. A pattern match can hit
an unrelated headless-browser process (including the dev server's own) and take
down more than the render you meant to stop.
