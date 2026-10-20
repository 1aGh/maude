### 7. Validate output

TSX canvas (the only format). The hooks already check every write and put the file back when it no longer parses or draws, so this is the closing pass over the finished draft, not the first time anything is looked at:

- Default-exported React component (`export default function <Name>() { … }` — kebab-PascalCase ok; the module must have exactly one default export).
- Standard `import` statements for `react` (when hooks are used), framework primitives, and any sibling components. **No** `<!doctype>`, no `<html>` / `<body>` — those live in `_canvas-shell.html`.
- Imports envelope primitives from `@maude/canvas-lib`: `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib"`. The dev-server resolves that virtual specifier to its bundled canvas-lib at `apps/studio/canvas-lib.tsx` (single source, ships with the dev-server install per DDR-025). `/design:handoff` AST-inlines the used exports on emit so the registry-item drop is self-contained.
- Contains every `<DCArtboard …>` of the Artboard plan, each with the `kind` and size the catalogue gives it ([Artboards of a kind](../../skills/design/_guide-28-artboards.md)): an App or Social artboard has `kind="digital" fixed`, a Web page one has `kind="web"` and no `fixed`, a Print one has the `print` prop and the px size of its paper, a Video one hosts a `<VideoComp>`. The first artboard sits in `<DCSection id="main">`.
- Class strings reference the project DS `_components.css` classes (`.btn`, `.tile`, `.sku`, `.seg`, …). Inline `style={{}}` is the escape hatch for arbitrary one-offs — gradients / radii honor the opt-out scope.
- No hardcoded colors / fonts / radii in `style={{}}` — use `var(--*)` tokens or DS classes.
- **Theme model (two isolated layers — system-review D9).** The canvas-shell **chrome** (workspace plane, floating toolbar, minimap, zoom HUD, halos) auto-follows the Maude dev-server theme via `data-maude-theme` on the iframe `<html>` — the dev-server owns it; **never** theme the chrome from canvas code, and never read/`--maude-chrome-*` from the artboard. **Artboards** keep their DS theme: the `data-theme="<THEME_DEFAULT>"` on the `rootClass` wrapper pins this artboard to a DS theme block — leave it at the DS default. Do **NOT** hardcode a non-default `data-theme` on artboards unless the canvas is intentionally single-theme — a reviewer flips an individual artboard at runtime via right-click → **Theme ▸ DS default / Light / Dark / Follow chrome** (Light/Dark enabled only when the DS ships both light + dark token blocks). Toggling the chrome theme re-themes the canvas chrome in every open canvas; artboards are unaffected.
- Parses and draws cleanly: `maude design check "$TARGET_PATH" --tier stop --json` (the same check the hooks run; exit 0, no errors) and `maude design layout-check "$TARGET_REL"` (no overlapping artboards).

#### 7x. Schema lint (V2-2.15 — S-rules, V2-1.13 §5.7)

Run the checker on the generated canvas **before** stage 8 writes it:

```bash
maude design ds-check --canvas "$TARGET" --json --root "$PROJECT_ROOT"   # 0 ok · 12 = a blocking finding
```

- **Block the write** on S2 `undefined` / `foreign` (a `var()` name the system doesn't declare, or another system's name), S5 `kit-module` / `other-system` (an import of a system's private code) and S9 (no `meta.designSystem`). Regenerate with the cheat-sheet names; never paper over with a literal.
- **Warn** on everything else (S1 literal colours, S3/S4 type and box literals, S6 wrapper, S8 fonts) and list them in the stage-12 print. Under `dsFidelity: strict` S1 is a blocker too.
- Mechanical kinds (`alias`, `own-css`, `wrapper`) may be applied with `maude design ds-check --fix=mechanical --canvas "$TARGET"` — report what changed; never silently.
