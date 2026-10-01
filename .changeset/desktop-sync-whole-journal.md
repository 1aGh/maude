---
'@1agh/maude': patch
---

Desktop file sync no longer reports a stream of false conflicts on large projects. It used to read only the first 2,000 entries of the workspace's change log, then forget what the workspace held beyond them and push those files again, getting "changed while uploading" every time. It now reads the whole log and remembers where it stopped, even when some files fail. A file the workspace already holds with identical bytes is recognised as in sync.
