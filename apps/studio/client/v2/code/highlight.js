// client/v2/code/highlight.js — S11.7: a small, honest syntax colouring for a canvas's TSX.
//
// PURE: text in, token rows out. No HTML is ever produced — the code view draws every token as a React
// text node, so a canvas's own source (untrusted: anyone who can edit the file wrote it) can never
// become markup. Colours are four classes (`com` comment · `kw` keyword · `str` string · `at` JSX
// attribute · `fn` a declared name), mapped to tokens in code.css; everything else is plain text.
//
// This is a colouring aid, not a parser: it follows block comments and template strings across lines
// and knows when it is inside a `<Tag …>`; anything it cannot place stays plain. The exact lines of an
// artboard come from the server's source map (S11.6), never from here.

/** @typedef {{ t: string, c: 'com'|'kw'|'str'|'at'|'fn'|null }} Token */

const KEYWORDS = new Set([
  'import',
  'export',
  'default',
  'from',
  'as',
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'of',
  'in',
  'new',
  'type',
  'interface',
  'extends',
  'class',
  'async',
  'await',
  'true',
  'false',
  'null',
  'undefined',
]);

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[A-Za-z0-9_$-]/;

/** Lines as an editor shows them: a trailing newline opens no new line (matches the server's count). */
export function splitLines(text) {
  if (typeof text !== 'string' || text === '') return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Colour `lines` (an array of strings). State (block comment, template string, open tag) carries
 * across lines.
 * @param {string[]} lines
 * @returns {Token[][]} one token row per line
 */
export function highlightLines(lines) {
  /** @type {Token[][]} */
  const out = [];
  let inBlock = false;
  /** the open template literal's quote, or '' */
  let inTemplate = '';
  let inTag = false;
  let afterDecl = false;
  for (const line of lines) {
    /** @type {Token[]} */
    const row = [];
    let plain = '';
    const flush = () => {
      if (plain) row.push({ t: plain, c: null });
      plain = '';
    };
    const push = (t, c) => {
      flush();
      row.push({ t, c });
    };
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i);
        const stop = end === -1 ? line.length : end + 2;
        push(line.slice(i, stop), 'com');
        i = stop;
        if (end !== -1) inBlock = false;
        continue;
      }
      if (inTemplate) {
        let j = i;
        while (j < line.length && line[j] !== inTemplate) j += line[j] === '\\' ? 2 : 1;
        const stop = Math.min(j + 1, line.length);
        push(line.slice(i, stop), 'str');
        i = stop;
        if (j < line.length) inTemplate = '';
        continue;
      }
      const ch = line[i];
      const two = line.slice(i, i + 2);
      if (two === '//') {
        push(line.slice(i), 'com');
        i = line.length;
      } else if (two === '/*') {
        const end = line.indexOf('*/', i + 2);
        const stop = end === -1 ? line.length : end + 2;
        push(line.slice(i, stop), 'com');
        i = stop;
        inBlock = end === -1;
        continue;
      } else if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
        const stop = Math.min(j + 1, line.length);
        push(line.slice(i, stop), 'str');
        i = stop;
      } else if (ch === '`') {
        inTemplate = '`';
        let j = i + 1;
        while (j < line.length && line[j] !== '`') j += line[j] === '\\' ? 2 : 1;
        const stop = Math.min(j + 1, line.length);
        push(line.slice(i, stop), 'str');
        i = stop;
        if (j < line.length) inTemplate = '';
      } else if (ch === '<' && IDENT_START.test(line[i + 1] ?? '')) {
        plain += ch;
        inTag = true;
        i += 1;
      } else if (ch === '>' && inTag && line[i - 1] !== '=') {
        inTag = false;
        plain += ch;
        i += 1;
      } else if (IDENT_START.test(ch)) {
        let j = i + 1;
        while (j < line.length && IDENT.test(line[j])) j += 1;
        const word = line.slice(i, j);
        let k = j;
        while (line[k] === ' ') k += 1;
        const attr = inTag && line[k] === '=' && line[k + 1] !== '=' && line[k + 1] !== '>';
        if (attr) push(word, 'at');
        else if (afterDecl) push(word, 'fn');
        else if (KEYWORDS.has(word) && !inTag) push(word, 'kw');
        else plain += word;
        afterDecl = !attr && (word === 'function' || word === 'class' || word === 'interface');
        i = j;
        continue;
      } else {
        plain += ch;
        i += 1;
      }
      if (ch !== ' ') afterDecl = false;
    }
    flush();
    out.push(row);
  }
  return out;
}

/** Colour a whole source text. */
export function highlight(text) {
  return highlightLines(splitLines(text));
}
