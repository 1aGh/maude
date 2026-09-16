// A canvas that changes while its module is being built is rebuilt on the
// next request — never served from a cache entry that names the new file but
// holds the old build.
//
// The cache signature used to be taken AFTER the build. On a cell the build
// runs out of process and takes a while; a change landing meanwhile was stored
// under its own signature with the previous body, and the HMR request for that
// change was a cache hit — the hub's view sat one edit behind while its file
// was right (surface row L23, 2026-09-16).

import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '../context.ts';
import { serveCanvasTsx } from '../http.ts';

const root = mkdtempSync(join(tmpdir(), 'canvas-cache-race-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const body = (word: string) => `export default function Canvas() {\n  return '${word}';\n}\n`;

test('a change during the build is not hidden behind the build it raced', async () => {
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  const canvas = join(designRoot, 'ui', 'Race.tsx');
  writeFileSync(canvas, body('first-version'));
  utimesSync(canvas, new Date(1_000_000), new Date(1_000_000));
  const ctx = { paths: { designRoot, designRel: '.design', repoRoot: root } } as unknown as Context;
  const locator = join(designRoot, '_locator.json');
  const req = () => new Request('http://localhost/.design/ui/Race.tsx');

  // The file changes after the server read it and before the build is stored.
  const first = await serveCanvasTsx(canvas, req(), ctx, locator, {
    afterRead: () => {
      writeFileSync(canvas, body('second-version'));
      utimesSync(canvas, new Date(2_000_000), new Date(2_000_000));
    },
  });
  expect(first.status).toBe(200);
  expect(await first.text()).toContain('first-version');

  // The request the change itself triggers.
  const second = await serveCanvasTsx(canvas, req(), ctx, locator);
  expect(second.status).toBe(200);
  expect(await second.text()).toContain('second-version');
});
