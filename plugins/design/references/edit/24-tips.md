## Tips

- **Edit one object.** In Edit mode, click an object to select it (double-click enters a frame, Esc steps out). The next `/design:edit "<feedback>"` changes **only that object**, not the whole canvas. Select several, or an artboard, to scope the edit to them.
- **Ask AI about the selection.** ⌘/ opens the AI chat panel with the selection attached; the scope chip shows what the chat may change, and the chat stays inside it. Widen the chip to let it reach more.
- **Clear the selection** by clicking empty canvas or pressing Esc. Switching to another canvas clears it too: a selection belongs to one canvas.
- **Nothing to reload.** The canvas redraws as the file changes.
- **Go back.** Every change is a version. ⌥⌘H opens Version history; `/design:history` and `/design:rollback` do the same from here, and ⌘Z takes back the last run in one step.
- **Annotated screenshot.** `/design:screenshot`, mark up the PNG in any image editor, then `/design:edit "..." --screenshot <path>`. With an object selected, the screenshot is scoped to it by default.
- **Comments are feedback.** `/design:comments` makes the changes the open threads ask for, replies, and resolves them in one run.

After an edit, continue with `/design:edit "<more feedback>"`, `/design:screenshot`, `/design:critic` or `/design:handoff`, and `/design:rollback` if the edit didn't work out.
