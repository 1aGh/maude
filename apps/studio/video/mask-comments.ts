// video/mask-comments.ts — the comp readers (derive.ts, reframe-read.ts, canvas-edit's title motion) scan the
// canvas SOURCE TEXT for `<Captions>`, `<Duck>`, `<TitleMotion>`, `<Reframe>` (DDR-150's two-tokenizer rule). A
// comment that merely names one of them — `// <Captions> goes here` — read as "present". This blanks every
// comment to spaces first: same length, newlines kept, so every offset the readers compute stays valid.
//
// The comment list comes from the parser (oxc), never a hand-rolled lexer, so a `//` inside a string, a template
// literal or JSX text (`<a>https://x</a>`) is not mistaken for one. A source that does not parse still yields the
// comments the parser recovered; if the parser itself throws, the text is returned untouched (the old behaviour).

import { parseSync } from 'oxc-parser';

let lastIn: string | null = null;
let lastOut = '';

/** `source` with every comment replaced by spaces (newlines kept), so a tag inside one is invisible. */
export function maskComments(source: string): string {
  if (!source.includes('//') && !source.includes('/*')) return source;
  if (source === lastIn) return lastOut;
  let out = source;
  try {
    const parsed = parseSync('comp.tsx', source, { sourceType: 'module' });
    const comments = (parsed.comments ?? []) as Array<{ start: number; end: number }>;
    if (comments.length) {
      const chars = source.split('');
      for (const c of comments)
        for (let i = c.start; i < c.end && i < chars.length; i++)
          if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
      out = chars.join('');
    }
  } catch {
    out = source;
  }
  lastIn = source;
  lastOut = out;
  return out;
}
