// apps/studio/kinds/print-guides.ts — S7.23 / Gate 0 C25: which print artboards show their bleed, trim and margin.
//
//   View › Advanced › Print guides is the DEFAULT for every print artboard on the canvas;
//   a print artboard's own switch (inspector › Print guides) overrides it either way.
//
// The override is `print.showGuides` — one boolean inside the artboard's own `print` prop, so it travels with the
// artboard (copy, duplicate, sync, undo) and a 1.x peer, which keeps every key of `print` it does not know, loses
// nothing. Absent = follow the View default. The View default itself is the person's own view state
// (`_canvas-state/<slug>.view.json` `overlays.print`), never in the versioned file.
//
// decision:maude/v2-S7.23-print-guides-override-in-the-print-prop

/** The artboard's own choice: true / false, or null when it follows View. */
export function printGuidesOverride(print: unknown): boolean | null {
  if (print === null || typeof print !== 'object') return null;
  const v = (print as { showGuides?: unknown }).showGuides;
  return typeof v === 'boolean' ? v : null;
}

/** Are the guides drawn on this artboard? The artboard's switch wins; otherwise the View default. */
export function effectivePrintGuides(print: unknown, viewDefault: boolean): boolean {
  return printGuidesOverride(print) ?? viewDefault === true;
}
