import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type LocalHome, OUTSIDE_KIND, openLocalHome } from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

test('G9: a second outside edit of the same canvas is its own outside row', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-g9-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  const f = path.join(designRoot, 'ui/a.tsx');
  const src = (c: string, extra = '') =>
    `export default () => <p style={{ color: "${c}" }}>hi</p>;\n${extra}`;
  writeFileSync(f, src('#111'));
  const h = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: { id: 'm_g9', name: 'g9' },
    bootId: 'b',
    lockRetryMs: 0,
    settleMs: 5,
    log: { warn() {}, error() {} },
  });
  homes.push(h);
  await h.ready();
  writeFileSync(f, src('#111', '// edited outside Maude\n'));
  h.observe('ui/a.tsx');
  await h.flush();
  writeFileSync(f, src('#c00', '// edited outside Maude\n'));
  h.observe('ui/a.tsx');
  await h.flush();
  const rows = await h.runtime.acceptedHistory({});
  expect(rows.filter((r) => r.kind === OUTSIDE_KIND).length).toBe(2);
});
