---
"@1agh/maude": patch
---

The desktop app no longer freezes after switching canvases back and forth.

Switching away from a canvas and straight back, while it was still loading, could leave the app's page stuck at full CPU: nothing on screen responded again until the app was quit. It took a while to happen — the first switch late in a long session, or the sixteenth in ten minutes of editing — and it only happened in the desktop app. Each canvas now finishes starting up in a way that cannot get stuck like that; a fifteen-minute session of edits and switches ran without it.
