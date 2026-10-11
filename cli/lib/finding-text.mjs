// finding-text.mjs — the one sanitiser for file-derived text in a check finding (Phase 2 gate,
// security review of V2-2.4b; contract V2-1.11 §5.4).
//
// A finding's `where` / `what` reach the model as a PostToolUse / Stop `decision: block` reason —
// with harness authority, on every edit. A cloned or peer canvas can plant text in an artboard
// id, a `.meta.json` key or a hand-off field, so every string that came out of a file is:
//   - stripped of everything invisible — every format character (Cf: zero-width, bidi, soft
//     hyphen, word joiner, invisible operators, the Unicode Tags block that smuggles ASCII), every
//     default-ignorable code point (variation selectors, fillers, the unassigned Tags), surrogates,
//     private use and unassigned code points — so the model reads only what a person sees;
//   - controls and line/paragraph separators turned into one space (no newline can start a line
//     of its own in the reason);
//   - capped in CODE POINTS after stripping (FILE_TEXT_MAX, with an ellipsis; never splits a pair);
//   - JSON-quoted, so it reads as data.
// `fileText` is that, applied where findings are built; `cleanFinding` / `findingLine` are the
// second net for the hook (every field stripped and capped, whoever built the finding).
//
// Leaf module: no imports (the hook stays node built-ins only; Bun's check/ imports it too).

export const FILE_TEXT_MAX = 60;
const FIELD_MAX = { where: 200, what: 400, fix: 400 };

// Principled classes, not a hand list (Phase 2 gate round 3: the list missed the Tags block,
// U+2060–2064, variation selectors, U+00AD, U+180E, U+FFF9–FFFB, U+1D173–1D17A …).
// Invisible → removed: Cf + Default_Ignorable_Code_Point + Cs (lone surrogates) + Co + Cn.
const INVISIBLE = /[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Cs}\p{Co}\p{Cn}]+/gu;
// A break → one space: Cc (C0, DEL, C1 — newline, CR and tab included) + Zl + Zp (U+2028/2029).
const BREAK = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

/**
 * `s` with every invisible character removed and every control / separator run replaced by one
 * space, cut to `max` CODE POINTS (the last one "…").
 */
export function cleanText(s, max) {
  const t = String(s ?? '')
    .replace(INVISIBLE, '')
    .replace(BREAK, ' ');
  if (t.length <= max) return t; // code units ≥ code points
  const cps = [...t];
  if (cps.length <= max) return t;
  return `${cps.slice(0, Math.max(0, max - 1)).join('')}…`;
}

/** A file-derived string as it may appear in a finding: cleaned, ≤ FILE_TEXT_MAX, JSON-quoted. */
export const fileText = (s, max = FILE_TEXT_MAX) => JSON.stringify(cleanText(s, max));

/** A finding with every text field cleaned and capped; `code` kept only when it is a code. */
export function cleanFinding(f) {
  const code = typeof f?.code === 'string' && /^[a-z0-9-]{1,48}$/.test(f.code) ? f.code : 'finding';
  return {
    ...f,
    code,
    where: cleanText(f?.where, FIELD_MAX.where),
    what: cleanText(f?.what, FIELD_MAX.what),
    fix: cleanText(f?.fix, FIELD_MAX.fix),
  };
}

/** `<label> [code] where · what · fix` — one line, whatever the finding carried. */
export function findingLine(f, label = 'error') {
  const c = cleanFinding(f);
  return `${label} [${c.code}] ${c.where} · ${c.what} · ${c.fix}`;
}
