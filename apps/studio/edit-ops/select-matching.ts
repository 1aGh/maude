// edit-ops/select-matching.ts — `object.select-matching` ("Select matching · same style", S2.6).
//
// Select matching is a SELECTION gesture, not a write: no edit-op, no route, nothing in the file
// changes. The canvas already holds the rendered elements, so it compares signatures on its own DOM;
// this leaf module is the one definition of "same style" the canvas and the tests share, so the menu
// row, ⌘K and the agent's grep agree on it. (Agent path: grep the canvas for the same `className`
// and inline `style` — the signature below is exactly that pair plus the tag.)
//
// Same style = same tag + the same set of classes + the same inline declarations. Order never
// matters; property names are case-insensitive; whitespace and a trailing `;` do not count.

export interface MatchParts {
  tag: string;
  className?: string | null;
  /** the element's inline `style` attribute text (`a: b; c: d`) */
  style?: string | null;
}

/** Inline declarations as sorted `prop:value` pairs. */
export function styleDeclarations(style: string | null | undefined): string[] {
  if (!style) return [];
  return style
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':');
      if (i < 0) return d.toLowerCase();
      const prop = d.slice(0, i).trim().toLowerCase();
      const value = d
        .slice(i + 1)
        .trim()
        .replace(/\s+/g, ' ');
      return `${prop}:${value}`;
    })
    .sort();
}

/** The "same style" key of an element. */
export function matchSignature(p: MatchParts): string {
  const classes = (p.className ?? '').split(/\s+/).filter(Boolean).sort().join(' ');
  return `${p.tag.toLowerCase()}|${classes}|${styleDeclarations(p.style).join(';')}`;
}

/** An element carrying neither a class nor an inline style has no style to match on. */
export function hasStyleToMatch(p: MatchParts): boolean {
  return Boolean((p.className ?? '').trim() || styleDeclarations(p.style).length);
}
