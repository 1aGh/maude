// #195 (2.0.4) — "I can't add or rename folder". The folder routes answer a refusal in plain words the
// tree's folder dialog shows as they are: a reserved `_` name, a name already used, a folder outside the
// canvases, a folder renamed into itself. Before, the person read developer strings in a toast
// ("parent must be inside a managed canvas group", `"x" already exists in ui`).

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FOLDER_WORDS } from '../canvas-create.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const post = (port: number, route: string, body: unknown) =>
  fetch(`http://localhost:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('#195 folder create / rename — plain words', () => {
  test('create, rename, and every refusal says why', async () => {
    const { root, designRoot } = makeSandbox();
    mkdirSync(join(designRoot, 'ui', '2026'), { recursive: true });
    writeFileSync(join(designRoot, 'ui', '2026', '.gitkeep'), '');
    mkdirSync(join(designRoot, 'ui', 'social'), { recursive: true });
    writeFileSync(join(designRoot, 'ui', 'social', '.gitkeep'), '');
    const port = nextPort();
    const proc = await bootServer(root, port);
    try {
      // New folder here — inside a folder
      let r = await post(port, '/_api/fs-mkdir', { parent: '.design/ui/2026', name: 'dresy' });
      expect(r.status).toBe(201);
      expect(existsSync(join(designRoot, 'ui', '2026', 'dresy', '.gitkeep'))).toBe(true);

      // the same name again: taken, in words
      r = await post(port, '/_api/fs-mkdir', { parent: '.design/ui/2026', name: 'dresy' });
      expect(r.status).toBe(409);
      expect((await r.json()).error).toBe(FOLDER_WORDS.taken('dresy'));

      // reserved `_` name: the runtime-state mark, with the way out
      r = await post(port, '/_api/fs-mkdir', { parent: '.design/ui/2026', name: '_drafts' });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe('Names can’t start with _. Try “drafts”.');

      // outside the canvases (the design root itself)
      r = await post(port, '/_api/fs-mkdir', { parent: '.design', name: 'Loose' });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe(FOLDER_WORDS.notHere);

      // Rename folder — a move to a new name in the same parent
      r = await post(port, '/_api/fs-move', {
        file: '.design/ui/2026/dresy',
        toDir: '.design/ui/2026',
        toName: 'jerseys',
      });
      expect(r.status).toBe(200);
      expect(existsSync(join(designRoot, 'ui', '2026', 'jerseys'))).toBe(true);
      expect(existsSync(join(designRoot, 'ui', '2026', 'dresy'))).toBe(false);

      // a rename onto a sibling's name
      r = await post(port, '/_api/fs-move', {
        file: '.design/ui/2026',
        toDir: '.design/ui',
        toName: 'social',
      });
      expect(r.status).toBe(409);
      expect((await r.json()).error).toBe(FOLDER_WORDS.taken('social'));

      // a folder moved into itself
      r = await post(port, '/_api/fs-move', {
        file: '.design/ui/2026',
        toDir: '.design/ui/2026/jerseys',
      });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe(FOLDER_WORDS.intoItself);

      // the canvas group's own root
      r = await post(port, '/_api/fs-move', { file: '.design/ui', toDir: '.design', toName: 'x' });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe(FOLDER_WORDS.groupRoot);
    } finally {
      await killProc(proc);
    }
  }, 60_000);
});
