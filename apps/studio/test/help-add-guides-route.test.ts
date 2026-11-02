// S6.15 — POST /_api/help/add-guides (routes/help-guides.ts): the one write behind Help › Help and
// guides › "Add the guide canvases to this project". It adds the two guides, never over a file; it
// is main-origin only and refused to a read-only session (the role rows of test/_role-refusals.ts
// run it against the access gate).
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CANVAS_SAFE_API } from '../http.ts';
import { createHelpGuidesRoutes } from '../routes/help-guides.ts';
import { allSpecs } from '../routes/index.ts';
import { mountRoutes } from '../routes/table.ts';
import { stubDeps } from './_route-stubs.ts';

const ROUTE = '/_api/help/add-guides';

function handler(ui: string) {
  const spec = createHelpGuidesRoutes({ uiDir: () => ui })[0];
  if (!spec) throw new Error('no spec');
  return () =>
    Promise.resolve(
      spec.handle(new Request(`http://127.0.0.1:4399${ROUTE}`, { method: 'POST' }), {})
    );
}

describe('POST /_api/help/add-guides', () => {
  test('adds both guides to the project’s UI folder and says which', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maude-help-guides-'));
    try {
      const ui = join(root, '.design', 'ui');
      const res = await handler(ui)();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        ok: true,
        added: ['How to use Maude', 'How to make video'],
        skipped: [],
      });
      expect(existsSync(join(ui, 'How to use Maude.tsx'))).toBe(true);
      expect(existsSync(join(ui, 'How to make video.meta.json'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a guide that is already there is skipped and left as it is', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maude-help-guides-'));
    try {
      const ui = join(root, '.design', 'ui');
      mkdirSync(ui, { recursive: true });
      writeFileSync(join(ui, 'How to make video.tsx'), '// edited\n');
      const res = await handler(ui)();
      expect(await res.json()).toEqual({
        ok: true,
        added: ['How to use Maude'],
        skipped: ['How to make video'],
      });
      expect(readFileSync(join(ui, 'How to make video.tsx'), 'utf8')).toBe('// edited\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an unwritable folder answers 500 with words, not a stack', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maude-help-guides-'));
    try {
      const blocker = join(root, 'ui');
      writeFileSync(blocker, 'a file where the folder should be');
      const res = await handler(blocker)();
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Could not add the guides.');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the route table', () => {
  test('it is a main-origin, read-only-refused POST in the one table, in neither canvas allowlist', () => {
    const specs = allSpecs(stubDeps());
    expect(specs.find((s) => s.path === ROUTE)).toMatchObject({
      method: 'POST',
      origin: 'main',
      readOnly: 'refused',
    });
    expect(mountRoutes(specs).canvasPaths).not.toContain(ROUTE);
    expect(CANVAS_SAFE_API.has(ROUTE)).toBe(false);
  });
});
