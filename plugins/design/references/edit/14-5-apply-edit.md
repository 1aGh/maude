### 5. Apply edit

Read the canvas file. **If selection is valid**, build a scoped prompt (selector + dom_path + outerHTML + bounds + feedback) — the orchestrator knows the pattern from `design/SKILL.md` "Scoped edit prompt". Edit using the `Edit` tool with `old_string` matched to a unique substring of the selected element (if outerHTML appears multiple times, use the dom-path context to disambiguate).

**If there's no selection**, the edit is canvas-wide. Use Edit for a minimal diff (preferred). Write only when the change is a substantial rewrite, but preserve:
- `<link rel="stylesheet" href=".../<TOKENS_REL>">`
- `<body class="<ROOT_CLASS>" data-theme="…">`
- The Babel/UMD React mount pattern (if present)
- All existing tokens (`var(--*)` references)

**Touch the paired `.tsx` after editing a sibling `.css` (D-2 — highest-ROI fix).** For `css_mode` canvases that carry a sibling `<slug>.css` (NOT Tailwind / inline modes), the dev-server's canvas-build **inlines the CSS at module init and the bundle cache keys on the `.tsx` mtime** — so a CSS-only edit is invisible until something bumps the `.tsx` mtime (or a server restart). After editing any `<slug>.css`, `touch <slug>.tsx` so the canvas-build re-inlines the CSS. Without this, the confirmation screenshot in step 7 reflects the *pre-edit* CSS — studyfi burned 5 identical "nothing changed" screenshots on exactly this. (Tailwind/inline-mode canvases have no sibling `.css`, so this does not apply to them.)
