// The "which class names can still be on a live element" half of scripts/v2-css-inventory.mjs, split out so it
// is testable. Input: source texts (bundle, html, client sources). Output: `classLive(name)`.
//
// Dynamic names are honoured:
//   `foo-${x}` / 'foo-' + x / 'a b foo-' + x   → every `foo-*` class is live (the LAST word of a literal that
//                                                 ends in -/_ before a `+` or `${`; "sh-dockslot sh-dockslot--" + side)
//   `${x}-bar` / x + '-bar'                     → `<token>-bar` is live for every token
export function collectLive(texts) {
  const tokens = new Set();
  const prefixes = new Set();
  const suffixes = new Set();
  for (const src of texts) {
    for (const m of src.matchAll(/[A-Za-z_][A-Za-z0-9_-]*/g)) tokens.add(m[0]);
    for (const m of src.matchAll(/([A-Za-z][\w-]*-)\$\{/g)) prefixes.add(m[1]);
    // a quoted literal whose last word ends in - or _ and is concatenated onward: the last word is a prefix
    for (const m of src.matchAll(/['"`][^'"`\n]*?([A-Za-z][\w-]*[-_])['"`]\s*\+/g))
      prefixes.add(m[1]);
    for (const m of src.matchAll(/\}(-[A-Za-z][\w-]*)/g)) suffixes.add(m[1]);
    for (const m of src.matchAll(/\+\s*['"`](-[A-Za-z][\w-]*)['"`]/g)) suffixes.add(m[1]);
  }
  const prefixList = [...prefixes].filter((p) => p.length >= 3);
  return function classLive(c) {
    if (tokens.has(c)) return true;
    for (const p of prefixList) if (c.startsWith(p) && c.length > p.length) return true;
    for (const s of suffixes)
      if (c.endsWith(s) && c.length > s.length && tokens.has(c.slice(0, -s.length))) return true;
    return false;
  };
}
