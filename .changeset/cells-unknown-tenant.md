---
'@1agh/maude': patch
---

The cloud no longer starts a workspace for a project that doesn't exist. Automated scanners probing random addresses were spinning up empty workspaces. They now get a "nothing here" page, and nothing is started.
