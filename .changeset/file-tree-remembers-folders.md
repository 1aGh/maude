---
'@1agh/maude': patch
---

The Files panel starts collapsed and remembers which folders and sections you opened (#124). The choice used to live in each folder row, so every folder opened again after switching to the Layers tab, collapsing a section, reloading, or restarting the app. It is now kept per project on disk (per member in a cloud workspace), so it survives restarts in the desktop app too. Search opens the folders that hold results without changing what is remembered, and opening a canvas unfolds the folders above it.
