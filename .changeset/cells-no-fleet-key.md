---
'@1agh/maude': patch
---

Cloud workspaces now only ever receive storage credentials that are scoped to their own project and expire automatically. The old shared storage key is no longer passed to any workspace.
