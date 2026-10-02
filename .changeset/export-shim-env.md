---
"@1agh/maude": patch
---

Cloud video export no longer spends 90 seconds on a render path that never finishes on the cloud worker before falling back to frame capture: the worker's setting now actually reaches the export process.
