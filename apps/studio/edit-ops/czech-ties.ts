// edit-ops/czech-ties.ts — S2.12: the Czech typesetting rules, and `text.set-language`.
//
// A one-letter word (v k s z o u i a — and any other single letter) must not end a line: the space after
// it becomes a no-break space (U+00A0). Straight and English "quotes" become Czech „quotes“. Both are
// plain characters in the copy, so a v1 peer, an export and a screen reader read exactly what the canvas
// shows; nothing here is canvas-only.
//
// Pure and React-free (the server writer and the canvas's tie arcs both import it). Never inside a URL,
// an e-mail address or a `code` span: those spans are found first and skipped.
//
// `text.set-language` (the writer) is in text-copy.ts: this file stays free of the source parser so the
// canvas bundle can import it for the tie arcs.

export const NBSP = ' ';

/** `cs`, `cs-CZ`, `CS` — the Czech language tags. */
export const isCzech = (lang: unknown): boolean =>
  typeof lang === 'string' && /^cs(?:-[A-Za-z0-9]+)*$/i.test(lang.trim());

// URLs, e-mail addresses and `code` spans: untouched.
const PROTECTED = /`[^`\n]*`|(?:https?:\/\/|www\.)\S+|[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/giu;

function protectedSpans(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const m of text.matchAll(PROTECTED))
    out.push([m.index as number, (m.index as number) + m[0].length]);
  return out;
}
const inside = (spans: ReadonlyArray<[number, number]>, from: number, to: number): boolean =>
  spans.some(([a, b]) => from < b && to > a);

// A one-letter word: a letter that starts the text or follows white space / an opening mark, then ONE
// ordinary space, then something that is not white space.
const TIE = /(?<=^|[\s([{„“”"‚‘«»])(\p{L})( )(?=\S)/gu;

/** The indices of the spaces `tieCzech` turns into no-break spaces (the arcs the canvas draws under them).
 *  A space already tied counts too: the arc stays while you type. */
export function tiePositions(text: string): number[] {
  const spans = protectedSpans(text);
  const at: number[] = [];
  for (const m of text.matchAll(TIE)) {
    const i = (m.index as number) + m[1]!.length;
    if (!inside(spans, m.index as number, i + 1)) at.push(i);
  }
  // spaces that are already no-break after a one-letter word
  for (const m of text.matchAll(/(?<=^|[\s([{„“”"‚‘«»])\p{L} (?=\S)/gu)) {
    const i = (m.index as number) + m[0].length - 1;
    if (!inside(spans, m.index as number, i + 1) && !at.includes(i)) at.push(i);
  }
  return at.sort((a, b) => a - b);
}

const QUOTE = /["“”„]/gu;
const OPENS_AFTER = /[\s([{–—\-„]/u;

/** Straight, English and Czech double quotes → „opening“ / closing“, by where each stands. */
function czechQuotes(text: string, spans: ReadonlyArray<[number, number]>): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(QUOTE)) {
    const i = m.index as number;
    if (inside(spans, i, i + 1)) continue;
    const prev = i === 0 ? '' : (text[i - 1] as string);
    const opening = prev === '' || OPENS_AFTER.test(prev);
    out += text.slice(last, i) + (opening ? '„' : '“');
    last = i + 1;
  }
  return out + text.slice(last);
}

/** The copy as Czech sets it: ties after one-letter words, „quotes“. Idempotent. */
export function tieCzech(text: string): string {
  const spans = protectedSpans(text);
  const quoted = czechQuotes(text, spans); // 1:1 character replacement — the spans still line up
  let out = '';
  let last = 0;
  for (const m of quoted.matchAll(TIE)) {
    const at = (m.index as number) + m[1]!.length;
    if (inside(spans, m.index as number, at + 1)) continue;
    out += quoted.slice(last, at) + NBSP;
    last = at + 1;
  }
  return out + quoted.slice(last);
}
