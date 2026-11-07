// Every shell <iframe> that can load a canvas must carry a sandbox attribute without
// allow-popups: a canvas-origin window outside the shell page escapes the per-page
// sibling-frame guard that protects persisted stills (#212 T2.2 re-review). Two frames
// (Version history compare, the legacy diff) were missing it.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT = join(import.meta.dir, '..', 'client');
function* jsx(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* jsx(p);
    else if (/\.(jsx|tsx)$/.test(name)) yield p;
  }
}

test('every client <iframe> declares a sandbox and none allows popups', () => {
  const missing: string[] = [];
  for (const file of jsx(CLIENT)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/<iframe\b[\s\S]*?\/>/g)) {
      const tag = m[0];
      if (!/sandbox/.test(tag) || /allow-popups/.test(tag)) {
        missing.push(
          `${file.slice(CLIENT.length + 1)}:${src.slice(0, m.index).split('\n').length}`
        );
      }
    }
  }
  expect(missing).toEqual([]);
});
