---
"@1agh/maude": patch
---

Team server backups complete or fail loudly. On a project store of a few hundred MB the backup could stop after its small files and leave a generation with no project store, no repository bundle and no manifest, with nothing in the log. The store is now snapshotted in steps and uploaded in parts with deadlines; a failed attempt removes its half generation and is said in the log, in Activity and on the Overview; the first backup runs three minutes after a start; leftover snapshot files are swept at boot; and the Overview offers Back up now when the last good backup is old.
