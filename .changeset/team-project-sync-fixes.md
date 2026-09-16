---
"@1agh/maude": patch
---

Team projects: nine fixes to what a shared project does under ordinary work.

An edit you made against a canvas a teammate moved (or whose folder they renamed) now follows the canvas instead of coming back as a conflict, and renaming a folder no longer makes the person who renamed it miss later edits to the canvases inside it. A canvas made again under a name that was deleted is accepted — before, that one proposal could sit in a desktop's outbox forever and quietly hold back everything queued behind it.

A teammate's desktop now shows the project's design system: the project's own group labels and design systems travel with its bootstrap and a linked copy fills in only what it lacks. Replacing an image no longer leaves the old picture on the screen that replaced it. A workspace whose disk refuses a write answers at once (instead of leaving the upload hanging until it times out), the waiting file is named in the Sync panel and delivers itself when the disk takes writes again, and a too-big file you remove stops being reported. A timeline drag commits once.
