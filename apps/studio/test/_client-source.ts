// The studio client's source text, independent of which file a piece of it
// lives in.
//
// A family of source-level tests (cloud-shell-surfaces, sync-panel-surface,
// comment-relay-origin-gate, …) pins properties of the shell's code by reading
// its text — `App()` cannot be mounted in isolation. They used to read
// `client/app.jsx` directly, so a MOVE-ONLY split of that file (plan V2-0.2:
// components, functions and effect groups move verbatim into
// `client/{shell,tree,inspector,dialogs,menus,hooks}/…`) would turn them red
// with no behaviour change. Reading through this helper makes them indifferent
// to the file layout while still asserting the same property:
//
//   clientSource()        every client source file, concatenated — for "this
//                         code exists in the shell" and "this code exists
//                         NOWHERE in the shell" assertions.
//   clientFiles()         the same set, one entry per file — for scans that
//                         must not run across a file boundary.
//   clientMatches(re)     every match of a regex, file by file — for a
//                         `[\s\S]`-style pattern that could otherwise match
//                         from the end of one file into the next.
//   fnBody(name)          one top-level function's text, wherever it is defined.
//   fileDefining(name)    the whole file that defines it.
//   fileContaining(text)  the ONE file holding a literal — for slices taken
//                         relative to a usage (`<StatusBar\n`, `fetch('/_config')`).
//
// The set is every *.js / *.jsx / *.mjs / *.ts / *.tsx under client/, recursive,
// sorted by relative path (stable across machines). CSS, HTML, node_modules and
// Syncthing `*.sync-conflict-*` copies (this tree is Syncthing-synced; a conflict
// copy would duplicate every definition) are not part of it.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const CLIENT_DIR = join(import.meta.dir, '..', 'client');

const SOURCE_FILE = /\.(?:jsx?|mjs|tsx?)$/;

export type ClientFile = { path: string; src: string };

let cachedFiles: readonly ClientFile[] | null = null;
let cachedSource: string | null = null;

function collect(dir: string, out: string[]): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules') continue;
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) collect(abs, out);
    else if (ent.isFile() && SOURCE_FILE.test(ent.name) && !ent.name.includes('.sync-conflict-')) {
      out.push(abs);
    }
  }
}

/** Every client source file as `{ path, src }`, `path` relative to client/ with `/` separators. */
export function clientFiles(): readonly ClientFile[] {
  if (cachedFiles) return cachedFiles;
  const abs: string[] = [];
  collect(CLIENT_DIR, abs);
  const files = abs
    .map((p) => ({ path: relative(CLIENT_DIR, p).split(sep).join('/'), abs: p }))
    // Plain code-unit order, not localeCompare: identical on every machine.
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(({ path, abs: p }) => Object.freeze({ path, src: readFileSync(p, 'utf8') }));
  if (files.length === 0) throw new Error(`_client-source: no source files under ${CLIENT_DIR}`);
  cachedFiles = Object.freeze(files);
  return cachedFiles;
}

/** All client source files concatenated, each preceded by a `// ── file: <relpath>` line. */
export function clientSource(): string {
  if (cachedSource == null) {
    cachedSource = clientFiles()
      .map((f) => `// ── file: ${f.path}\n${f.src}`)
      .join('\n');
  }
  return cachedSource;
}

/** Every match of `re` (made global if it is not), searched one file at a time. */
export function clientMatches(re: RegExp): string[] {
  const global = re.flags.includes('g') ? re : new RegExp(re.source, `${re.flags}g`);
  return clientFiles().flatMap((f) => [...f.src.matchAll(global)].map((m) => m[0]));
}

/**
 * The ONE client file whose source contains `text`. Throws if none or several
 * do — a slice anchored on an ambiguous usage would silently read the wrong one.
 */
export function fileContaining(text: string): ClientFile {
  const hits = clientFiles().filter((f) => f.src.includes(text));
  if (hits.length !== 1) {
    const where = hits.length === 0 ? 'no client file' : hits.map((f) => f.path).join(', ');
    throw new Error(
      `_client-source: expected exactly one client file containing ${JSON.stringify(text)}, found ${hits.length} (${where})`
    );
  }
  return hits[0];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Where `function <name>(` is declared in one file's source, or -1. */
function declarationIndex(src: string, name: string): number {
  // `function <name>(` with nothing identifier-like in front of the name, so
  // `function Row(` never matches `function DirRow(`. Covers the
  // `export function` / `export default function` forms a moved function gets.
  const re = new RegExp(`(?<![\\w$])function ${escapeRegExp(name)}\\(`);
  return re.exec(src)?.index ?? -1;
}

/**
 * The ONE client file that declares `function <name>(` (also as `export
 * function` / `export default function`). Throws if no file or more than one
 * file declares it — an ambiguous lookup must never silently pick one.
 */
export function fileDefining(name: string): ClientFile {
  const hits = clientFiles().filter((f) => declarationIndex(f.src, name) !== -1);
  if (hits.length !== 1) {
    const where = hits.length === 0 ? 'no client file' : hits.map((f) => f.path).join(', ');
    throw new Error(
      `_client-source: expected exactly one client file declaring \`function ${name}(\`, found ${hits.length} (${where})`
    );
  }
  return hits[0];
}

/**
 * The text of top-level function `<name>`: from `function <name>(` to the next
 * top-level `\nfunction ` / `\nexport function ` / `\nexport default function `
 * in the same file, or to the end of that file. The same slice the source
 * tests always took out of app.jsx, plus the `export` forms a moved function
 * is declared with.
 */
export function fnBody(name: string): string {
  const { src } = fileDefining(name);
  const start = declarationIndex(src, name);
  const ends = ['\nfunction ', '\nexport function ', '\nexport default function ']
    .map((boundary) => src.indexOf(boundary, start + 1))
    .filter((i) => i !== -1);
  return src.slice(start, ends.length ? Math.min(...ends) : src.length);
}
