// Two quick changes to an open canvas must leave the NEWER one on screen.
//
// The shell's soft reload re-imports the canvas module for every change. Two
// changes in quick succession start two imports, and the first can finish
// last. Remounting whatever resolved last put the older body over the newer
// one while the file on disk was right — a peer's view stuck one edit behind
// (surface row L21, 2026-09-16).
//
// Runs the shell's own `softReload` (lifted from the template between its
// markers) with the module loader stubbed, so the order of completion is the
// test's to choose.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHELL = readFileSync(
  join(import.meta.dir, '..', '..', '..', 'plugins', 'design', 'templates', '_shell.html'),
  'utf8'
);

function liftSoftReload(loader: (url: string) => Promise<unknown>) {
  const begin = SHELL.indexOf('// soft-reload:begin');
  const end = SHELL.indexOf('// soft-reload:end');
  expect(begin).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  // The template's loader is the one line swapped for the stub.
  const body = SHELL.slice(begin, end).replace(
    /const loadCanvasModule = \(url\) => import\(url\);/,
    'const loadCanvasModule = __loader;'
  );
  expect(body).toContain('const loadCanvasModule = __loader;');
  const mounted: string[] = [];
  const holding: Array<[boolean, string | undefined]> = [];
  const window = {
    __maudeCanvasRuntime: {
      remount: (c: { tag: string }) => mounted.push(c.tag),
      setHolding: (on: boolean, msg?: string) => holding.push([on, msg]),
    },
  };
  const location = {
    reload: () => {
      throw new Error('a soft reload must not fall back to a page reload here');
    },
  };
  const make = new Function(
    '__loader',
    'window',
    'location',
    'canvasUrl',
    'diagnoseImportFailure',
    `${body}\nreturn softReload;`
  );
  const softReload = make(
    loader,
    window,
    location,
    '/.design/ui/Foo.tsx',
    async () => 'build error'
  ) as (v: number) => void;
  return { softReload, mounted, holding };
}

const component = (tag: string) => Object.assign(() => null, { tag });
const settle = () => new Promise((r) => setTimeout(r, 20));

test('the older import finishing last does not replace the newer render', async () => {
  const pending = new Map<string, (m: unknown) => void>();
  const { softReload, mounted } = liftSoftReload(
    (url) =>
      new Promise((resolve) =>
        pending.set(new URL(url, 'http://x').searchParams.get('v') ?? '', resolve)
      )
  );
  softReload(1);
  softReload(2);
  // The newer build is quicker…
  pending.get('2')?.({ default: component('v2') });
  await settle();
  // …and the older one lands after it.
  pending.get('1')?.({ default: component('v1') });
  await settle();
  expect(mounted).toEqual(['v2']);
});

test('an older import failing late does not hold a newer good render', async () => {
  const pending = new Map<string, { ok: (m: unknown) => void; fail: (e: Error) => void }>();
  const { softReload, mounted, holding } = liftSoftReload(
    (url) =>
      new Promise((ok, fail) =>
        pending.set(new URL(url, 'http://x').searchParams.get('v') ?? '', { ok, fail })
      )
  );
  softReload(1);
  softReload(2);
  pending.get('2')?.ok({ default: component('v2') });
  await settle();
  pending.get('1')?.fail(new Error('Failed to fetch dynamically imported module'));
  await settle();
  expect(mounted).toEqual(['v2']);
  expect(holding.filter(([on]) => on)).toEqual([]);
});

test('in order, every change is shown', async () => {
  const { softReload, mounted } = liftSoftReload(async (url) => ({
    default: component(`v${new URL(url, 'http://x').searchParams.get('v')}`),
  }));
  softReload(1);
  await settle();
  softReload(2);
  await settle();
  expect(mounted).toEqual(['v1', 'v2']);
});
