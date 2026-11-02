// S3.10a-2 — a link write goes through the REAL `POST /_api/edit-op` table (EDIT_OPS, not a test op):
// `element.set-link` stamps the id + sets `data-cd-link` in one write, one snapshot, one undo record
// (`revert {writeId}` restores the bytes); `element.clear-link` removes it and keeps the id; an invalid
// target is refused `invalid` with the file untouched; a locked object keeps its click. A viewer's
// request never reaches the writer (the read-only gate is a row of access-role-matrix).

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { createEditRoutes } from '../routes/edit.ts';

const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <button data-cd-id="see-pricing">See pricing</button>
        <a data-cd-id="locked-cta" data-cd-locked>Buy</a>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'maude-edit-op-link-'));
  dirs.push(root);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  const file = join(designRoot, 'ui', 'Home.tsx');
  writeFileSync(file, SRC);
  const snaps: string[] = [];
  const [spec] = createEditRoutes({
    designRoot,
    designRel: '.design',
    repoRoot: root,
    emit: () => {},
    snapshot: async (rel, _b, reason) => void snaps.push(`${rel} ${reason}`),
  });
  const call = async (body: unknown) => {
    const r = await spec.handle(
      new Request('http://localhost/_api/edit-op', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      {}
    );
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  return { file, snaps, call };
}
const on = (element: string) => [{ artboard: 'desktop', element }];

describe('link ops are in the one op table', () => {
  test('EDIT_OPS lists set-link and clear-link', () => {
    const ids = EDIT_OPS.map((o) => o.id);
    expect(ids).toContain('element.set-link');
    expect(ids).toContain('element.clear-link');
  });
});

describe('POST /_api/edit-op with the link ops', () => {
  test('set-link: one write, one snapshot; revert on the write id restores the bytes', async () => {
    const { file, snaps, call } = sandbox();
    const set = await call({
      file: 'ui/Home.tsx',
      op: 'element.set-link',
      targets: on('see-pricing'),
      params: { target: 'site/pricing.tsx#desktop' },
    });
    expect(set.status).toBe(200);
    expect(set.body.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain(
      'data-cd-id="see-pricing" data-cd-link="site/pricing.tsx#desktop"'
    );
    expect(snaps).toEqual(['ui/Home.tsx pre-element.set-link']);

    const undo = await call({
      file: 'ui/Home.tsx',
      op: 'revert',
      targets: [],
      params: { writeId: set.body.writeId },
    });
    expect(undo.status).toBe(200);
    expect(readFileSync(file, 'utf8')).toBe(SRC);
  });

  test('clear-link removes the link and keeps the id', async () => {
    const { file, snaps, call } = sandbox();
    await call({
      file: 'ui/Home.tsx',
      op: 'element.set-link',
      targets: on('see-pricing'),
      params: { target: 'https://cal.com/studio' },
    });
    const clear = await call({
      file: 'ui/Home.tsx',
      op: 'element.clear-link',
      targets: on('see-pricing'),
    });
    expect(clear.status).toBe(200);
    expect(readFileSync(file, 'utf8')).toBe(SRC);
    expect(snaps.at(-1)).toBe('ui/Home.tsx pre-element.clear-link');
  });

  test('a target the grammar refuses → 400 invalid, file untouched, nothing snapshotted', async () => {
    const { file, snaps, call } = sandbox();
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      '../x.tsx',
      'file:///etc/passwd',
      '',
    ]) {
      const r = await call({
        file: 'ui/Home.tsx',
        op: 'element.set-link',
        targets: on('see-pricing'),
        params: { target: bad },
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('invalid');
    }
    expect(readFileSync(file, 'utf8')).toBe(SRC);
    expect(snaps).toEqual([]);
  });

  test('a locked object keeps its click: 409 locked, file untouched', async () => {
    const { file, call } = sandbox();
    const r = await call({
      file: 'ui/Home.tsx',
      op: 'element.set-link',
      targets: on('locked-cta'),
      params: { target: '#desktop' },
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('locked');
    expect(readFileSync(file, 'utf8')).toBe(SRC);
  });
});
