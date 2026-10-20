// S10.13: POST /_api/canvas takes the system a new canvas starts on (its folder's one system, else the
// default — client/v2/ds/new-canvas-default.js). The server trusts the NAME only when the project holds it.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

async function post(port: number, body: unknown) {
  const r = await fetch(`http://localhost:${port}/_api/canvas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as Record<string, string> };
}

describe('POST /_api/canvas — designSystem', () => {
  test('a held system is stamped; an unknown one and none fall back to the default', async () => {
    const { root, designRoot } = makeSandbox();
    for (const n of ['club', 'campaign'])
      mkdirSync(join(designRoot, 'system', n), { recursive: true });
    writeFileSync(
      join(designRoot, 'config.json'),
      JSON.stringify({
        name: 'test',
        designRoot: '.design',
        canvasGroups: [
          { label: 'System', path: 'system' },
          { label: 'UI', path: 'ui' },
        ],
        designSystems: [
          { name: 'club', path: 'system/club' },
          { name: 'campaign', path: 'system/campaign' },
        ],
        defaultDesignSystem: 'club',
      })
    );
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      const metaOf = (rel: string) =>
        JSON.parse(readFileSync(join(designRoot, rel.replace(/\.tsx$/, '.meta.json')), 'utf8'));
      const a = await post(port, { designSystem: 'campaign' });
      expect(a.status).toBe(201);
      expect(metaOf(a.json.rel).designSystem).toBe('campaign');
      const b = await post(port, { designSystem: 'nope' });
      expect(metaOf(b.json.rel).designSystem).toBe('club');
      const c = await post(port, {});
      expect(metaOf(c.json.rel).designSystem).toBe('club');
    } finally {
      await killProc(proc);
    }
  });
});
