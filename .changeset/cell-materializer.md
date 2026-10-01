---
'@1agh/maude': minor
---

A cloud workspace can now hold a project larger than its disk. The workspace keeps the project's photos and videos in cloud storage and downloads each one when a canvas needs it. Each file is checked against the project's record before it is shown. Files not used for a while are dropped from the workspace's disk and downloaded again on the next request. Every canvas renders with all of its media, including background images and fonts referenced from stylesheets. Large stylesheet images and fonts used to be silently missing everywhere; they now load. Deleting a file the workspace only holds in storage keeps a recoverable copy first.
