// r1 (Michal rc.1, img 6) — "pri vytvarenni noveho projekty nemuzu zadat cestu". New project › Advanced ›
// "Choose another folder…" picks a folder in the native picker; `POST /_home/projects/create-local` then
// takes `{name, location}` and makes the project INSIDE that folder. The page hands the folder over, so the
// route re-checks it: an existing folder, absolute, inside the home folder (or an attached drive), never a
// hidden folder or ~/Library, every symlink resolved first. Anything else is refused and nothing is made.

import { beforeAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkLocation, LOCATION_REFUSED } from '../home/create-local.ts';
import { createHomeFetch } from '../home/routes.ts';
import { freshIndexDir, homeDeps, homeReq } from './_home-fixtures.ts';

const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'maude-r1-home-')));
const OUTSIDE = realpathSync(mkdtempSync(join(tmpdir(), 'maude-r1-outside-')));
mkdirSync(join(HOME, 'Clients'));
mkdirSync(join(HOME, '.config'));
mkdirSync(join(HOME, 'Library', 'Application Support'), { recursive: true });
writeFileSync(join(HOME, 'note.txt'), 'x');
symlinkSync(OUTSIDE, join(HOME, 'escape'));

beforeAll(() => {
  freshIndexDir();
});

async function create(body: unknown) {
  const deps = homeDeps({ homeDir: HOME });
  const res = await createHomeFetch(deps)(
    homeReq('/_home/projects/create-local', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, deps };
}

describe('create-local in a picked folder', () => {
  test('the project is made inside the picked folder', async () => {
    const { status, json } = await create({ name: 'Tralala', location: join(HOME, 'Clients') });
    expect(status).toBe(200);
    expect(json.root).toBe(join(HOME, 'Clients', 'Tralala'));
    expect(existsSync(join(HOME, 'Clients', 'Tralala', '.design'))).toBe(true);
  });

  test('no location: the Maude folder, as before', async () => {
    const { json, deps } = await create({ name: 'Plakaty' });
    expect(json.root).toBe(realpathSync(join(deps.projectsDir, 'Plakaty')));
  });

  for (const [why, location] of [
    ['a relative path', 'Clients'],
    ['a folder that does not exist', join(HOME, 'Nowhere')],
    ['a file', join(HOME, 'note.txt')],
    ['a hidden folder', join(HOME, '.config')],
    ['~/Library', join(HOME, 'Library', 'Application Support')],
    ['outside the home folder', OUTSIDE],
    ['a symlink that leads out of the home folder', join(HOME, 'escape')],
    ['not text', { path: HOME }],
  ] as const) {
    test(`refused: ${why} — and nothing is made`, async () => {
      const { status, json } = await create({ name: 'Nope', location });
      expect(status).toBe(400);
      expect(json).toEqual({ ok: false, error: LOCATION_REFUSED });
      expect(existsSync(join(OUTSIDE, 'Nope'))).toBe(false);
    });
  }

  test('checkLocation answers the resolved folder', () => {
    expect(checkLocation(join(HOME, 'Clients', '..', 'Clients'), HOME)).toBe(join(HOME, 'Clients'));
    expect(checkLocation(HOME, HOME)).toBe(HOME);
  });
});
