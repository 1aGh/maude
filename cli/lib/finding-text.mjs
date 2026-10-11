// finding-text.mjs — the one sanitiser for file-derived text in a check finding (Phase 2 gate,
// security review of V2-2.4b; contract V2-1.11 §5.4).
//
// A finding's `where` / `what` reach the model as a PostToolUse / Stop `decision: block` reason —
// with harness authority, on every edit. A cloned or peer canvas can plant text in an artboard
// id, a `.meta.json` key or a hand-off field, so every string that came out of a file is:
//   - stripped of control, line/paragraph-separator, zero-width and bidi characters (no newline
//     can start a line of its own in the reason);
//   - capped (FILE_TEXT_MAX, with an ellipsis);
//   - JSON-quoted, so it reads as data.
// `fileText` is that, applied where findings are built; `cleanFinding` / `findingLine` are the
// second net for the hook (every field stripped and capped, whoever built the finding).
//
// Leaf module: no imports (the hook stays node built-ins only; Bun's check/ imports it too).

export const FILE_TEXT_MAX = 60;
const FIELD_MAX = { where: 200, what: 400, fix: 400 };

// C0 + DEL + C1, U+2028/2029, zero-width (200B–200F), bidi embeddings/isolates, BOM
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]+/g;

/** `s` with every unsafe character run replaced by one space, cut to `max` chars (with "…"). */
export function cleanText(s, max) {
  const t = String(s ?? '').replace(UNSAFE, ' ');
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
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
