// #195 follow-up (2.0.4) — the studio's browser code never opens a native dialog.
//
// Tauri's WKWebView implements none of `window.prompt` (answers null at once), `window.confirm` (always false)
// or `window.alert` (shows nothing useful). #195 "can't add or rename a folder" was exactly that; the same
// bug class sat in the version diff (a failed Restore alerted into the void), the diff's Restore confirm and
// History's Discard confirm (always "no", so Discard could never be used on the desktop).
//
// This guard scans the browser-side source (the client bundle's tree, the canvas-side `*.tsx`/`*.jsx` beside
// canvas-lib, and the home server's page code) for a call to any of the three, bare or on `window`/
// `globalThis`/`self`. Comments are ignored (the workarounds say why they exist). A new call must use the
// shell's own dialog (`ConfirmAskDialog` / `NameDialog`) or a toast; there is deliberately no allowlist —
// canvases are user code and live outside these directories.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const STUDIO = join(import.meta.dir, '..');
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const SKIP_DIR = new Set(['node_modules', 'dist', 'contracts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIR.has(name)) walk(p, out);
    } else if (SOURCE.test(name) && !/\.(?:test|gen)\./.test(name)) out.push(p);
  }
  return out;
}

/** The browser-side files: client tree, home, and the top-level canvas-side modules. */
function files(): string[] {
  const top = readdirSync(STUDIO)
    .filter((n) => /\.(?:tsx|jsx)$/.test(n))
    .map((n) => join(STUDIO, n));
  return [...walk(join(STUDIO, 'client')), ...walk(join(STUDIO, 'home')), ...top];
}

/** Blank block comments (keeping line numbers) and trailing `//` comments. */
function code(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlock
    .split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

const CALL = /(?:\b(?:window|globalThis|self)\s*\.\s*|(?<![.\w$]))(prompt|confirm|alert)\s*\(/g;
/** `async *prompt(text) {` / `confirm() {` — a method definition, not a call. */
const DEFINITION = /^\s*(?:async\s+)?\*?\s*(?:prompt|confirm|alert)\s*\([^)]*\)\s*\{/;

export function nativeDialogCalls(src: string): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = [];
  code(src)
    .split('\n')
    .forEach((text, i) => {
      if (DEFINITION.test(text)) return;
      CALL.lastIndex = 0;
      if (CALL.test(text)) hits.push({ line: i + 1, text: text.trim() });
    });
  return hits;
}

describe('no native browser dialogs in the studio client', () => {
  test('the scanner sees calls, ignores comments and method definitions', () => {
    expect(nativeDialogCalls('if (!window.confirm("x")) return;')).toHaveLength(1);
    expect(nativeDialogCalls('window.alert(res.error);')).toHaveLength(1);
    expect(nativeDialogCalls('const n = prompt("Name");')).toHaveLength(1);
    expect(nativeDialogCalls('globalThis.confirm(m)')).toHaveLength(1);
    expect(nativeDialogCalls('// window.prompt() is a no-op\nconst a = 1;')).toHaveLength(0);
    expect(nativeDialogCalls('/* window.confirm(x)\n window.alert(y) */')).toHaveLength(0);
    expect(nativeDialogCalls('async *prompt(text, chatId) {')).toHaveLength(0);
    expect(nativeDialogCalls('conn.prompt(x); links.confirm(); toast.alert(1)')).toHaveLength(0);
  });

  test('no file under client/, home/ or the canvas-side modules calls prompt, confirm or alert', () => {
    const found: string[] = [];
    for (const file of files()) {
      for (const h of nativeDialogCalls(readFileSync(file, 'utf8')))
        found.push(`${relative(STUDIO, file)}:${h.line}  ${h.text}`);
    }
    expect(found).toEqual([]);
  });
});
