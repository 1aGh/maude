// S1.23b — names that collide in sync.
//
// Two names that differ only in characters the sync slug flattens (case, a space vs an underscore,
// `-` vs `--`, `ui/a/b` vs `ui/a-b`; and, for a canvas that was named before S1.23c, an em dash vs a
// hyphen or `a%20b`) land on ONE sync document, and one canvas overwrites the other on every peer.
// Every path that writes a canvas or folder name refuses such a name, in CONTRACT voice; a rename of
// a canvas onto ITSELF with a case change stays allowed. S1.23c narrowed what a name may contain to the
// sync path charset, so the server-side cases below use pairs that are both inside it; the em dash and
// `%20` pairs stay pinned at the key level (above) and in the client model (legacy siblings).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { canvasSlugFromRel } from '../canvas-slug.ts';
import {
  checkRename,
  closeKey,
  RENAME_WORDS,
  siblingNames,
} from '../client/v2/canvases/rename-model.js';
import { buildDocName } from '../sync/doc-name.ts';
import { findCloseName, syncKeyOf, tooCloseText } from '../sync-name-key.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

let port = 0;
let proc: Awaited<ReturnType<typeof bootServer>>;
let designRoot = '';

beforeAll(async () => {
  const sb = makeSandbox();
  designRoot = sb.designRoot;
  port = nextPort();
  proc = await bootServer(sb.root, port);
});
afterAll(async () => {
  await killProc(proc);
});

const post = (route: string, body: unknown) =>
  fetch(`http://localhost:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const create = (name: string) => post('/_api/canvas', { name, kind: 'blank' });
const rename = (file: string, toName: string) => post('/_api/fs-move', { file, toName });
const renameFolder = (file: string, toName: string) =>
  post('/_api/fs-move', { file, toDir: file.split('/').slice(0, -1).join('/'), toName });
const move = (file: string, toDir: string) => post('/_api/fs-move', { file, toDir });
const mkdir = (parent: string, name: string) => post('/_api/fs-mkdir', { parent, name });
const err = async (r: Response) => ((await r.json()) as { error?: string }).error ?? '';
const uiFiles = (dir = 'ui') => readdirSync(join(designRoot, dir));

describe('the key is the real sync slug (no second copy of the algorithm)', () => {
  test('syncKeyOf is the last component of buildDocName for the same path', () => {
    for (const rel of ['ui/Q1—Plan.tsx', 'ui/a%20b.tsx', 'ui/a/b.tsx', 'ui/Poster.tsx']) {
      const doc = buildDocName({
        workspaceId: 'w',
        branch: 'main',
        slug: canvasSlugFromRel(rel, '.design'),
      });
      expect(doc.endsWith(`/${syncKeyOf(rel)}`)).toBe(true);
    }
  });

  test('what collapses: dash, percent-encoding, space, case, folder separators', () => {
    const k = syncKeyOf('ui/q1-plan.tsx');
    expect(syncKeyOf('ui/Q1—Plan.tsx')).toBe(k);
    expect(syncKeyOf('ui/a%20b.tsx')).toBe(syncKeyOf('ui/a b.tsx'));
    expect(syncKeyOf('ui/Poster.tsx')).toBe(syncKeyOf('ui/poster.tsx'));
    expect(syncKeyOf('ui/a/b.tsx')).toBe(syncKeyOf('ui/a-b.tsx'));
    expect(syncKeyOf('ui/Plan A.tsx')).not.toBe(syncKeyOf('ui/Plan B.tsx'));
  });

  test('findCloseName ignores the same path, the excluded one, and a keyless path', () => {
    expect(findCloseName('ui/A.tsx', ['ui/A.tsx'])).toBeNull();
    expect(findCloseName('ui/a.tsx', ['ui/A.tsx'], (r) => r === 'ui/A.tsx')).toBeNull();
    expect(findCloseName('ui/a.tsx', ['ui/A.tsx'])).toBe('ui/A.tsx');
  });

  test('the words are CONTRACT voice and name the other', () => {
    expect(tooCloseText('Q1-Plan', 'ui/Q1—Plan.tsx', 'ui')).toBe(
      '“Q1-Plan” is too close to “Q1—Plan”, which is already here. Try another name.'
    );
    expect(tooCloseText('Plan', 'ui/sub/Plan.tsx', 'ui')).toContain('“ui/sub/Plan”');
  });
});

describe('the rename panel says it before sending (client model)', () => {
  const tree = {
    byPath: new Map([
      [
        'ui',
        {
          canvases: [
            { path: 'ui/Q1—Plan.tsx', name: 'Q1—Plan' },
            { path: 'ui/Mixed.tsx', name: 'Mixed' },
          ],
        },
      ],
    ]),
  };

  test('the client key is the server key, name for name', () => {
    for (const n of ['Q1—Plan', 'Q1-Plan', 'a%20b', 'a b', 'Poster', 'poster', 'Příběh', 'A B']) {
      expect(`ui-${closeKey(n)}`.replace(/-+$/, '')).toBe(syncKeyOf(`ui/${n}.tsx`));
    }
  });

  test('a name too close to a sibling is refused inline, in the server words', () => {
    const siblings = siblingNames(tree, 'ui', 'ui/Other.tsx');
    expect(checkRename({ draft: 'Q1-Plan', current: 'Other', siblings })).toEqual({
      kind: 'error',
      error: tooCloseText('Q1-Plan', 'ui/Q1—Plan.tsx', 'ui'),
    });
    expect(RENAME_WORDS.close('x', 'y')).toBe(tooCloseText('x', 'ui/y.tsx', 'ui'));
  });

  test('a case change of the canvas’s own name is allowed', () => {
    const siblings = siblingNames(tree, 'ui', 'ui/Mixed.tsx');
    expect(checkRename({ draft: 'mixed', current: 'Mixed', siblings })).toEqual({
      kind: 'rename',
      name: 'mixed',
    });
  });
});

describe('create', () => {
  test('an underscore vs a space is refused, nothing written', async () => {
    expect((await create('Dash One')).status).toBe(201);
    const r = await create('Dash_One');
    expect(r.status).toBe(409);
    expect(await err(r)).toBe(tooCloseText('Dash_One', 'ui/Dash One.tsx', 'ui'));
    expect(uiFiles()).not.toContain('Dash_One.tsx');
  });

  test('a hyphen vs a run of hyphens is refused', async () => {
    expect((await create('Pct-two')).status).toBe(201);
    const r = await create('Pct--two');
    expect(r.status).toBe(409);
    expect(await err(r)).toContain('is too close to “Pct-two”');
    expect(uiFiles()).not.toContain('Pct--two.tsx');
  });

  test('a name outside the allowed set is a 400 with the suggestion, not a 409 (S1.23c)', async () => {
    const r = await create('Dash—Two');
    expect(r.status).toBe(400);
    expect(await err(r)).toBe('Names can use letters, numbers, spaces, - and _. Try “Dash-Two”.');
    expect(uiFiles()).not.toContain('Dash—Two.tsx');
    expect(uiFiles()).not.toContain('Dash-Two.tsx');
  });

  test('a case-only difference is refused, on either kind of volume', async () => {
    expect((await create('Poster')).status).toBe(201);
    const r = await create('poster');
    expect(r.status).toBe(409);
    expect(await err(r)).toContain('is too close to “Poster”');
    expect(uiFiles().filter((f) => f.toLowerCase() === 'poster.tsx')).toEqual(['Poster.tsx']);
  });

  test('a different name that merely looks alike is fine', async () => {
    expect((await create('Plan A')).status).toBe(201);
    expect((await create('Plan B')).status).toBe(201);
  });
});

describe('rename and move', () => {
  test('renaming a canvas onto itself with a case change is allowed', async () => {
    const c = (await (await create('Mixed Case')).json()) as { rel: string };
    const r = await rename(c.rel, 'mixed case');
    expect(r.status).toBe(200);
    expect(uiFiles()).toContain('mixed case.tsx');
    expect(uiFiles()).not.toContain('Mixed Case.tsx');
    expect(existsSync(join(designRoot, 'ui', 'mixed case.meta.json'))).toBe(true);
  });

  test('renaming onto a name that is too close to another canvas is refused', async () => {
    await create('Alpha-9');
    const b = (await (await create('Beta 9')).json()) as { rel: string };
    const r = await rename(b.rel, 'Alpha--9');
    expect(r.status).toBe(409);
    expect(await err(r)).toBe(tooCloseText('Alpha--9', 'ui/Alpha-9.tsx', 'ui'));
    expect(uiFiles()).toContain('Beta 9.tsx');
    expect(uiFiles()).not.toContain('Alpha--9.tsx');
  });

  test('moving into a folder that holds a too-close name is refused, source untouched', async () => {
    expect((await mkdir('ui', 'Holds')).status).toBeLessThan(300);
    const first = (await (await create('Q2-Plan')).json()) as { rel: string };
    expect((await move(first.rel, 'ui/Holds')).status).toBe(200);
    const second = (await (await create('Q2--Plan')).json()) as { rel: string };
    const r = await move(second.rel, 'ui/Holds');
    expect(r.status).toBe(409);
    expect(await err(r)).toContain('is too close to “Q2-Plan”');
    expect(uiFiles()).toContain('Q2--Plan.tsx');
    expect(uiFiles('ui/Holds')).not.toContain('Q2--Plan.tsx');
  });

  test('a folder move that would put a canvas on an outsider’s key is refused', async () => {
    expect((await mkdir('ui', 'Src')).status).toBeLessThan(300);
    expect((await mkdir('ui', 'Dst')).status).toBeLessThan(300);
    const inner = (await (await create('Lone-Name')).json()) as { rel: string };
    await move(inner.rel, 'ui/Src');
    // Outside the move: ui/Dst/Src-ish key `ui-dst-src-lone-name` via the flattened `ui/Dst-Src`.
    expect((await mkdir('ui', 'Dst-Src')).status).toBeLessThan(300);
    const clash = (await (await create('Lone--Name')).json()) as { rel: string };
    await move(clash.rel, 'ui/Dst-Src');
    // Moving Src (holding Lone-Name) into Dst makes `ui/Dst/Src/Lone-Name` = key of `ui/Dst-Src/Lone--Name`.
    const r = await move('ui/Src', 'ui/Dst');
    expect(r.status).toBe(409);
    expect(await err(r)).toContain('is too close to');
    expect(existsSync(join(designRoot, 'ui', 'Src', 'Lone-Name.tsx'))).toBe(true);
  });
});

describe('duplicate', () => {
  test('a copy name too close to an existing canvas takes the next one', async () => {
    const orig = (await (await create('Ae')).json()) as { rel: string };
    expect((await create('AE copy')).status).toBe(201);
    const r = await post('/_api/canvas', { duplicateOf: orig.rel });
    expect(r.status).toBe(201);
    expect(((await r.json()) as { rel: string }).rel).toBe('ui/Ae copy 2.tsx');
  });

  test('a canvas named before S1.23c (an accent on disk) still duplicates, to the folded name', async () => {
    writeFileSync(
      join(designRoot, 'ui', 'Plakát.tsx'),
      'export default function X() { return null; }\n'
    );
    const r = await post('/_api/canvas', { duplicateOf: 'ui/Plakát.tsx' });
    expect(r.status).toBe(201);
    expect(((await r.json()) as { rel: string }).rel).toBe('ui/Plakat copy.tsx');
  });
});

describe('folders', () => {
  test('creating a folder too close to a sibling folder is refused', async () => {
    expect((await mkdir('ui', 'Shots A')).status).toBeLessThan(300);
    const r = await mkdir('ui', 'Shots_A');
    expect(r.status).toBe(409);
    expect(await err(r)).toBe(tooCloseText('Shots_A', 'ui/Shots A', 'ui'));
    expect(uiFiles()).not.toContain('Shots_A');
  });

  test('renaming a folder onto a too-close sibling is refused', async () => {
    expect((await mkdir('ui', 'Reel B')).status).toBeLessThan(300);
    expect((await mkdir('ui', 'Other B')).status).toBeLessThan(300);
    const r = await renameFolder('ui/Other B', 'Reel_B');
    expect(r.status).toBe(409);
    expect(await err(r)).toContain('is too close to “Reel B”');
    expect(uiFiles()).toContain('Other B');
  });

  test('renaming a folder onto itself with a case change is allowed', async () => {
    expect((await mkdir('ui', 'Camel Folder')).status).toBeLessThan(300);
    const r = await renameFolder('ui/Camel Folder', 'camel folder');
    expect(r.status).toBe(200);
    expect(uiFiles()).toContain('camel folder');
    expect(uiFiles()).not.toContain('Camel Folder');
  });
});
