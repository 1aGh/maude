// Characters a hostile Figma name can carry, built by code point so no invisible or direction-changing
// character sits in this repo's source (and no formatter can silently turn an escape into one).
const cp = (n: number) => String.fromCodePoint(n);

export const RLO = cp(0x202e); // right-to-left override
export const LRO = cp(0x202d); // left-to-right override
export const LRI = cp(0x2066); // left-to-right isolate
export const ZWSP = cp(0x200b); // zero-width space
export const BEL = cp(0x07); // a C0 control

/** Every code point in `s` that no display name should carry: control, format (bidi, zero-width), separators. */
export function hiddenCodePoints(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const n = ch.codePointAt(0) ?? 0;
    if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(ch) || n === 0x7f) out.push(n);
  }
  return out;
}
