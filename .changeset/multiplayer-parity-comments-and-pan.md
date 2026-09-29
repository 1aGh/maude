---
'@1agh/maude': patch
---

Comments now stay where you put them and reach every peer, and large boards pan smoothly with something selected or a teammate on the canvas (#134, #136, #133, #131).

- **Comments on stickies and empty canvas stay.** A comment placed on a sticky, a drawing or empty canvas was saved and then deleted for everyone about three seconds later. Software no longer deletes comments. A comment on a sticky now follows the sticky. A comment on empty canvas keeps its place through pan and zoom. A comment whose target is gone is shown as detached, with a dashed pin, until a person removes it.
- **Web comments reach the desktop app.** A desktop app that was closed while a comment was deleted on the web stopped receiving comments after it reopened. In legacy projects, the deleted comment also came back for everyone. Both are fixed. A comment written before sync had started is now sent to the project when the app starts, instead of staying only on that machine.
- **Large boards pan smoothly.** With an element selected, a theme check ran again on every frame of a pan and recalculated the styles of the whole page. On a board with many artboards in the desktop app, this could drop panning to about one frame a second. It now runs once.
- The server log now says when comments on this machine have not reached the shared project yet.
