---
"@1agh/maude": patch
---

Canvases render on Windows again. Every canvas there failed with "Failed to fetch dynamically imported module" while the canvas list, comments and the Assistant worked: the studio mixed `/` and `\` in file paths, did not recognise a canvas file as a design, and sent it to the browser as plain text instead of compiled code.

**Security (Windows):** the same path handling let a URL with an encoded backslash (`..%5c`) step out of the project, so a canvas synced from a team project could read files elsewhere on the machine. Requests are now resolved with Windows path rules and refuse backslashes, drive letters, streams, device names and encoded `..` segments. Separately, a canvas whose project sits behind a symbolic link (or a `subst` drive or junction on Windows) could import any file on disk into its bundle; the import check now compares real paths and refuses an importer that is neither the project nor Maude itself. Update if you use Maude on Windows or open team projects.
