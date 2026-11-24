---
'@1agh/maude': patch
---

**Four reported bugs fixed** (#227, #228, #229, #230).

- **Comments panel finds the comment** (#229). Clicking a comment in the Comments panel moves the canvas to its pin and opens the thread there. Before, the pin was only highlighted, so on a large canvas the click seemed to do nothing.
- **Creating a folder is quick again** (#230). In a project that syncs with a workspace, "Create folder" waited up to 8 seconds for the workspace to answer before the folder appeared. It now appears after about a second at most; the workspace gets the folder in the background.
- **Report a bug at the bottom left** (#228). The island with Undo, Redo and the zoom now ends with a Report a bug button. It opens the same dialog as Help › Report a bug….
- **The window screenshot in a bug report shows the window** (#228). The automatic "Maude window" screenshot was covered by the "This project syncs with…" question in every synced project. The question is no longer drawn in that screenshot.
- **A canvas with only annotations is not empty** (#227). "Your canvas is ready." and Ask AI no longer sit over a canvas that has no artboards but already holds stickies, drawings or other annotations.
