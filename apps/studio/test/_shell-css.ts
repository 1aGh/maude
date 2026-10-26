// The shell stylesheet as the bundle sees it: every file `client/styles/_index.css` imports, in import order, as
// one source text (comments and @layer wrappers kept — the same text the tests used to read file by file).
// CSS pins read rules through this instead of naming the file a rule lives in, so moving a rule between files
// (V2-8.0 part D) never edits a test. `shellCssFiles()` lists the files, in that order.
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const CLIENT = join(import.meta.dir, '..', 'client');
const INDEX = join(CLIENT, 'styles', '_index.css');

let files: string[] | null = null;
let text: string | null = null;

export function shellCssFiles(): string[] {
  if (files) return files;
  const idx = readFileSync(INDEX, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  files = [...idx.matchAll(/@import\s+url\(["']([^"']+)["']\)/g)].map((m) =>
    relative(CLIENT, resolve(dirname(INDEX), m[1]))
  );
  return files;
}

export function shellCss(): string {
  if (text != null) return text;
  text = shellCssFiles()
    .map((rel) => `/* ── ${rel} ── */\n${readFileSync(join(CLIENT, rel), 'utf8')}`)
    .join('\n');
  return text;
}
