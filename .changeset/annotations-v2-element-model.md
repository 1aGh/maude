---
'@1agh/maude': minor
---

Whiteboard annotations are now saved as a board of individual elements. Edits sync per element, and several long-standing editing bugs are fixed.

- **Your existing boards convert themselves.** On the next start, each `<canvas>.annotations.svg` becomes `<canvas>.annotations.json`. The original stays in `.design/_history/` and `.design/_trash/`. Nothing changes in how the board looks or works.
- **Edits no longer overwrite each other.** A move, a recolour or a text edit now sends only what changed. Two people editing different stickies, or different properties of the same sticky, both keep their change. Two people typing in the same sticky keep both edits.
- **Large boards stay light.** Saving one change costs the same whether the board has 20 elements or 2,000.
- **The caret stays on the new line.** Before, it jumped back to the start after Shift+Enter in a sticky, shape label or text.
- **Double-clicking a word while editing selects the word.** Before, it threw the view to the top-left.
- **Double-clicking a standalone text opens it for editing.** Before, the editor closed right away.
- **A marquee over a section's contents selects just those contents.** The section is selected only when the marquee encloses all of it.
- **Shift-click on a selected element removes it from the selection.**
