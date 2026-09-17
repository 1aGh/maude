---
"@1agh/maude": patch
---

Sticky notes, drawings and comments in the browser studio of a self-hosted hub now show the project's current state, not the version from the first time the canvas was opened there.

On a hub without live pairing, the browser studio kept each canvas's annotations and comments at the state they had when someone first opened that canvas in the browser. The desktop and the hub document had the current board; the browser kept showing the old one, even after a reload. The browser studio now picks up those changes while a canvas is open. When a canvas is opened again, anything saved after the studio's last cached copy replaces that copy.
