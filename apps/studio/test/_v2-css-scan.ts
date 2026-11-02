// S11.18 — a small CSS reader for the elevation lint (test/v2-elevation-lint.test.ts). It is not a CSS parser: it
// walks braces, remembers the selector text in front of each block, and hands back every declaration with the
// selector it sits under (at-rules are walked through, their own text is not a selector).

export interface Decl {
  selector: string;
  prop: string;
  value: string;
  line: number;
}

export function readDecls(css: string): Decl[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out: Decl[] = [];
  const stack: string[] = [];
  let buf = '';
  let line = 1;
  let bufLine = 1;
  const flushDecls = (text: string, startLine: number, selector: string) => {
    let ln = startLine;
    for (const part of text.split(';')) {
      const m = /^\s*([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(part);
      const nl = (part.match(/\n/g) ?? []).length;
      if (m) {
        const lead = (part.match(/^\s*/)?.[0].match(/\n/g) ?? []).length;
        out.push({ selector, prop: m[1], value: m[2].replace(/\s+/g, ' '), line: ln + lead });
      }
      ln += nl;
    }
  };
  for (const ch of src) {
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
      bufLine = line;
    } else if (ch === '}') {
      const sel = stack.pop() ?? '';
      if (buf.trim() && !sel.startsWith('@')) flushDecls(buf, bufLine, sel);
      buf = '';
      bufLine = line;
    } else {
      if (buf === '' && ch === '\n') bufLine = line + 1;
      buf += ch;
    }
    if (ch === '\n') line++;
  }
  return out;
}

/** The last compound selector of each comma part: `.a .b.island:hover` → `.b.island:hover`. */
export function lastCompounds(selector: string): string[] {
  return selector
    .split(',')
    .map(
      (s) =>
        s
          .trim()
          .split(/[\s>+~]+/)
          .pop() ?? ''
    )
    .filter(Boolean);
}
