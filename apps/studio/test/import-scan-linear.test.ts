// 2.0.7 (#207) — `importScanText` is linear and says exactly what it said before.
//
// The scan used to grow its output with `+=` and test the WHOLE output at every string literal
// (a `$`-anchored regex, `out[k]` on a rope), so it was quadratic: ~3 s for one 1 MB canvas, and
// `/_index-data` ran it for every file every canvas reaches (StudyFi: 43 s cold). This file keeps
// the old implementation verbatim as the oracle — the scanner is a security gate (gate-b-c4e/c4l:
// what the closure walk sees as an import), so the rewrite must not move one character.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { importScanText } from '../skip-dirs.ts';

// ---- the pre-#207 implementation, verbatim (the oracle) -------------------------------------
const isWs = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch);
const isIdent = (ch: string | undefined): boolean => ch !== undefined && /[\w$]/.test(ch);
function wordEndsAt(s: string, k: number, w: string): boolean {
  if (k < w.length || s.slice(k - w.length, k) !== w) return false;
  return !isIdent(s[k - w.length - 1]);
}
function endsInSpecifierLead(out: string): boolean {
  let k = out.length;
  while (k > 0 && isWs(out[k - 1])) k--;
  if (out[k - 1] === '(') {
    k--;
    while (k > 0 && isWs(out[k - 1])) k--;
    return wordEndsAt(out, k, 'import') || wordEndsAt(out, k, 'require');
  }
  return wordEndsAt(out, k, 'from') || wordEndsAt(out, k, 'import');
}
function endsInCallLead(out: string): boolean {
  let k = out.length;
  while (k > 0 && isWs(out[k - 1])) k--;
  if (out[k - 1] !== '(') return false;
  k--;
  while (k > 0 && isWs(out[k - 1])) k--;
  return wordEndsAt(out, k, 'import') || wordEndsAt(out, k, 'require');
}
const CSS_IMPORT_URL_LEAD_RE = /@import\s+url\(\s*$/i;
function oldImportScanText(source: string, css = false): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i] as string;
    const next = source[i + 1];
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (!css && c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || (!css && c === '`')) {
      let j = i + 1;
      while (j < n) {
        const d = source[j];
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === c) break;
        if (d === '\n' && c !== '`') break;
        j++;
      }
      const stop = Math.min(j, n);
      const body = source.slice(i + 1, stop);
      const keep =
        c === '`'
          ? !body.includes('${') && endsInCallLead(out)
          : endsInSpecifierLead(out) || (css && CSS_IMPORT_URL_LEAD_RE.test(out));
      out += c + (keep ? body : body.replace(/[^\n]/g, ' ')) + (source[j] === c ? c : '');
      i = source[j] === c ? j + 1 : stop;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
// ---------------------------------------------------------------------------------------------

const same = (src: string, css = false) => {
  const got = importScanText(src, css);
  const want = oldImportScanText(src, css);
  if (got !== want) {
    let at = 0;
    while (at < got.length && got[at] === want[at]) at++;
    throw new Error(
      `scan differs at ${at} (css=${css}): ${JSON.stringify(src.slice(Math.max(0, at - 40), at + 40))}`
    );
  }
  expect(got.length).toBe(src.length); // length-preserving (gate-b-c4l)
};

describe('importScanText — same output as before (#207)', () => {
  test('hand-picked leads, comments, strings, templates and CSS imports', () => {
    const cases = [
      `import a from './a.tsx';\nimport('./b.ts');\nrequire ( "./c.js" )`,
      `// import x from './no.tsx'\n/* from './no2.tsx' */ import y from /* long\ncomment */ './yes.tsx'`,
      'const s = `./t.tsx`; import(`./u.tsx`); import(`./${v}.tsx`); require(`./w.js`)',
      `x = 'from'; y = "import"; reimport('./not'); fromage './cheese'`,
      `import './nbsp.tsx'; from './ls.tsx'; import　('./ideo')`,
      `'unterminated\nimport './after.tsx'; "esc \\" quote" from './q.tsx' 'a\\\nb'`,
      `$import './dollar'; _from './under'; import$ './x'; froM './y'`,
      `trailing escape '\\`,
      `/* never closed import './z.tsx'`,
      `"\ud800lone" from '\udc00x.tsx' import('\u{1f600}')`,
    ];
    for (const c of cases) same(c);
    const css = [
      `@import url("./a.css"); @IMPORT   URL(  './b.css' ); @import url('./c.css')`,
      `@import "./d.css"; @import\turl(\n"./e.css"); x@import url("./f.css") @importurl("./g")`,
      `/* @import url("./no.css") */ a { background: url("./img.png") } // not a comment url("./x")`,
      `@imporT Url( "./nbsp.css") @import url ("./space.css")`,
    ];
    for (const c of css) same(c, true);
  });

  test('fuzz: random sources over the scanner alphabet', () => {
    const atoms = [
      'import', 'from', 'require', '(', ')', ' ', '\n', '\t', ' ', "'", '"', '`', '\\', '/',
      '*', '//', '/*', '*/', '${', '}', './a.tsx', 'x', '$', '_', '@import', 'url', 'URL', ';',
      '\r', '\ud83d', '\ude00', 'é',
    ];
    let seed = 207;
    const rnd = (k: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % k;
    };
    for (let round = 0; round < 3000; round++) {
      let src = '';
      const parts = 1 + rnd(60);
      for (let p = 0; p < parts; p++) src += atoms[rnd(atoms.length)];
      same(src, false);
      same(src, true);
    }
  });

  test("the studio's own sources (real-world corpus)", () => {
    const root = path.join(import.meta.dir, '..');
    const files: string[] = [];
    const walk = (dir: string, depth: number) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
        const abs = path.join(dir, name);
        const st = statSync(abs);
        if (st.isDirectory()) {
          if (depth < 3) walk(abs, depth + 1);
        } else if (/\.(tsx?|jsx?|mjs|css)$/.test(name) && st.size < 400_000) files.push(abs);
      }
    };
    walk(root, 0);
    expect(files.length).toBeGreaterThan(100);
    for (const f of files.slice(0, 400)) same(readFileSync(f, 'utf8'), f.endsWith('.css'));
  });
});

describe('importScanText — linear time (#207)', () => {
  test('a 1 MB canvas with thousands of string literals scans in well under a second', () => {
    // ~StudyFi's onboard-upload-db.tsx shape: JSX with a string literal every few dozen characters.
    const line = `  <div className="row" data-id='x' title="label">{t('copy.key')}</div>\n`;
    const src = `import { DesignCanvas } from '@maude/canvas-lib';\n${line.repeat(Math.ceil(1_000_000 / line.length))}`;
    const t0 = performance.now();
    const out = importScanText(src);
    const ms = performance.now() - t0;
    expect(out.length).toBe(src.length);
    expect(out.startsWith(`import { DesignCanvas } from '@maude/canvas-lib';`)).toBe(true);
    // quadratic took seconds here; linear takes a few tens of ms — a generous bound for slow CI
    expect(ms).toBeLessThan(500);
  });
});
