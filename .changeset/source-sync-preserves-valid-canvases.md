---
"@1agh/maude": patch
---

Protect canvas source files from malformed shared-document updates (issue #121).

Preserve unchanged code between concurrent edits, repair exact duplicate seeds in the shared-document sync path, and reject source with syntax errors or duplicate declarations before it overwrites a local file. Keep bounded recovery copies outside rolling history, preserve valid migration backups, and show held updates in the Sync panel. Locally edited files are preserved when a remote update arrives before the file watcher imports them.
