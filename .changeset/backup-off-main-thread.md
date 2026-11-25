---
"@1agh/maude": patch
---

A team server no longer pauses while it backs up. The database copy and its final flush ran on the main thread, so on a slow disk every connected person waited for it (1.4 s measured for a 260 MB store). The copy now runs on a worker thread, uploads go in 8 MB parts, and the repository bundle is uploaded from a file.
