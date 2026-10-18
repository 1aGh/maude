### 5. Apply edit

Read the canvas file. **If the selection is valid**, build a scoped prompt (the object's `data-cd-id`, selector, path, markup, bounds and the feedback); the pattern is in `design/SKILL.md` "Scoped edit prompt". Edit with the `Edit` tool, with `old_string` matched to a unique substring of the selected element (if its markup appears several times, use the path context to disambiguate).

**If there is no selection**, the edit is canvas-wide. Use Edit for a minimal diff (preferred). Write only on a new file: over an existing canvas longer than 40 lines the hook refuses it (`whole-file-rewrite`), because Edit is what keeps element ids. Whatever you change, preserve:
- every `data-cd-id`, each on the element that had it. A new element gets a new readable id; never reuse or renumber one ([Editing in Maude v2](../../skills/design/_guide-editing-v2.md));
- `data-cd-locked` and `data-cd-hidden` attributes, and the elements they sit on. A locked element is the person's: do not change it or anything inside it;
- the canvas wrapper (`DesignCanvas` / `DCSection` / `DCArtboard` from `@maude/canvas-lib`), the root class, the tokens import and the `data-theme` handling;
- all existing tokens (`var(--*)` references). New values use tokens, not hex colors or raw font families.

Each Edit is checked by the hooks as it lands: a write that breaks the canvas is put back, and a write the artboard's current holder refuses comes back with a named reason (step 4.5). Fix the cause; do not retry the same edit.

**Touch the paired `.tsx` after editing a sibling `.css` (D-2).** For `css_mode` canvases that carry a sibling `<slug>.css` (not Tailwind or inline modes), the canvas build inlines the CSS at module init and its cache keys on the `.tsx` mtime. A CSS-only edit stays invisible until something bumps the `.tsx` mtime. After editing any `<slug>.css`, `touch <slug>.tsx`, otherwise the confirmation screenshot in step 7 shows the pre-edit CSS (studyfi burned 5 identical "nothing changed" screenshots on this). Tailwind and inline-mode canvases have no sibling `.css`, so it does not apply to them.
