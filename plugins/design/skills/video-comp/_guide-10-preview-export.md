## Preview + export

- **Preview/scrub** is free — the Player shows transport controls in the canvas,
  and the timeline that comes with a video artboard scrubs + retimes sequence blocks.
- **Export** via **Menu › File › Export…** or the slash command (DDR-062 — go
  through the command, never a bin path):
  - `\/design:export mp4 --scope artboard` — fps/duration come from the comp meta.
  - `\/design:export gif --scope artboard --option fps=15 --option gifColors=128`.
  - MP4 is H.264 (falls back to WebM if the capture browser has no H.264 encoder);
    GIF is palette-quantized. Both render deterministically through the capture
    spine — **no native binaries, no user install**.

**Exporting from a terminal or a script** is `maude design export` (DDR-062), never a raw request: it finds Maude through `.design/_server.json`, sends the same spec the sheet sends, and writes the file.

```sh
maude design export mp4 --scope selection --canvas ui/Recap.tsx --out ~/Downloads/
maude design export mp4 --estimate --scope canvas      # files, size and time, nothing exported
maude design exports list                              # recent exports, and which items failed
```

A render can take minutes and shows up in the Exports panel while it runs. Captions are Off unless the export asks for them. One export goes up to 3,600 frames; "Allow longer" (Advanced › Long videos, stored per artboard) lifts it to at most 18,000 (guide 21).

**Cancelling a stuck render:** `kill <PID>` the specific `_video-playwright.mjs`
process — never `pkill` by pattern on a shared machine. A pattern match can hit
an unrelated headless-browser process (including Maude's own) and take
down more than the render you meant to stop.
