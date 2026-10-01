---
'@1agh/maude': patch
---

A cloud workspace whose project is larger than its disk no longer restarts in a loop. The workspace now notices when its disk is nearly full. Uploads get a "try again in two minutes" answer, which the desktop treats as a pause rather than a conflict, instead of the workspace crashing on a full disk. On start-up, it restores canvas code and styles first and leaves the remaining photos in storage once its disk budget is spent. It also stops asking desktops to re-upload files that storage already holds. `/health` now reports disk use and start-up restore progress.
