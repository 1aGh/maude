---
'@1agh/maude': patch
---

The Sync panel no longer reports project files as "waiting" when nothing is left to deliver, and Resync now actually rechecks a stuck file.

- **Files that became part of a canvas stop showing as stuck.** A stylesheet created before its canvas becomes that canvas's own file and travels with the canvas. Its old entry used to stay in the panel as "stuck" or "conflict" for good. It is now dropped.
- **A file the project changed during an upload arrives.** If the project changed a file while this machine was uploading it, and nobody touched it afterwards, the newer copy never came down. The next sync — or a Resync — now reads the project's full file list once and brings it down.
- **Identical code files are in step.** A `.ts` or `.js` file that is byte-for-byte the same here and on a self-hosted project no longer shows as refused.
