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

// The rules V2-8.0 part D moved into an area file from the retired styles/ layer files sit in ONE marked region at
// the top of that file. A pin about an area's own v2 rules (a contract the old layers never held — tokens only,
// no mono, --dur durations) reads the file past that region; the moved rules are pinned through shellCss().
const MOVED =
  /\/\* ── V2-8\.0: (?:rules moved here|the legacy v1 frame rules)[\s\S]*?\/\* ── end of the moved rules ── \*\//g;
export function withoutMovedRules(css: string): string {
  return css.replace(MOVED, '');
}

export function shellCss(): string {
  if (text != null) return text;
  text = shellCssFiles()
    .map((rel) => `/* ── ${rel} ── */\n${readFileSync(join(CLIENT, rel), 'utf8')}`)
    .join('\n');
  return text;
}
