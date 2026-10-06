---
"@1agh/maude": minor
---

PNG and PDF exports can now capture the whole canvas as one image or one page, with the layout between artboards kept. Pick **Whole canvas** in the export dialog's Scope menu, or **Selection area** for the bounding box around everything you have selected. Tick **Include annotations** to bring stickies, shapes, arrows and the rest of the whiteboard layer along. Comment pins are never exported. The CLI takes the same scopes: `maude design export png --scope canvas-whole --option includeAnnotations=true`.
