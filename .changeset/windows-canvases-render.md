---
"@1agh/maude": patch
---

Canvases render on Windows again. Every canvas there failed with "Failed to fetch dynamically imported module" while the canvas list, comments and the Assistant worked: the studio mixed `/` and `\` in file paths, did not recognise a canvas file as a design, and sent it to the browser as plain text instead of compiled code.
