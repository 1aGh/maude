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

import {
  checkLocation,
  checkLocationReason,
  LOCATION_IN_PROJECT,
  LOCATION_REFUSED,
} from '../home/create-local.ts';
import { createHomeFetch } from '../home/routes.ts';
import { freshIndexDir, homeDeps, homeReq } from './_home-fixtures.ts';

const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'maude-r1-home-')));
// Never under /Volumes: an attached drive is an allowed location, and the Mac mini lane's TMPDIR lives on one
const OUTSIDE = realpathSync(
  mkdtempSync(join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'maude-r1-outside-'))
);
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

// V2-8.9 r2 C2 (attacker) — "a new project" reads as fresh and empty, but a picked folder inside a tree
// someone else controls (a team share, a downloaded repo) hands the project that tree's `.git/config`
// (core.fsmonitor), its `CLAUDE.md` and its `.design/`. A folder with such an ancestor — itself included,
// up to (not including) the home folder, or up to the drive root — is refused with its own plain reason.
describe('create-local refuses a folder inside another project or repository', () => {
  const H = realpathSync(mkdtempSync(join(tmpdir(), 'maude-r2-c2-home-')));
  mkdirSync(join(H, 'Share', '.git'), { recursive: true });
  mkdirSync(join(H, 'Share', 'inner', 'deeper'), { recursive: true });
  mkdirSync(join(H, 'Team', 'sub'), { recursive: true });
  writeFileSync(join(H, 'Team', 'CLAUDE.md'), 'be helpful\n');
  mkdirSync(join(H, 'Proj', '.design'), { recursive: true });
  mkdirSync(join(H, 'Clean', 'Place'), { recursive: true });

  for (const [why, location] of [
    ['a parent holds .git', join(H, 'Share', 'inner', 'deeper')],
    ['the folder itself holds .git', join(H, 'Share')],
    ['a parent holds CLAUDE.md', join(H, 'Team', 'sub')],
    ['the folder is a Maude project (.design)', join(H, 'Proj')],
  ] as const) {
    test(`refused: ${why}`, () => {
      const r = checkLocationReason(location, H);
      expect(r).toEqual({ ok: false, error: LOCATION_IN_PROJECT });
      expect(checkLocation(location, H)).toBe(null);
    });
  }

  test('the route says why, and nothing is made', async () => {
    const deps = homeDeps({ homeDir: H });
    const res = await createHomeFetch(deps)(
      homeReq('/_home/projects/create-local', {
        method: 'POST',
        body: JSON.stringify({ name: 'Nope', location: join(H, 'Team', 'sub') }),
        headers: { 'content-type': 'application/json' },
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: LOCATION_IN_PROJECT });
    expect(existsSync(join(H, 'Team', 'sub', 'Nope'))).toBe(false);
  });

  test('a clean folder is fine; a home folder that is itself a repo (dotfiles) does not refuse everything', () => {
    expect(checkLocation(join(H, 'Clean', 'Place'), H)).toBe(join(H, 'Clean', 'Place'));
    const dot = realpathSync(mkdtempSync(join(tmpdir(), 'maude-r2-c2-dot-')));
    mkdirSync(join(dot, '.git'));
    mkdirSync(join(dot, 'Clients'));
    expect(checkLocation(join(dot, 'Clients'), dot)).toBe(join(dot, 'Clients'));
  });

  test('~/Library is refused whatever its case on disk', () => {
    const h = realpathSync(mkdtempSync(join(tmpdir(), 'maude-r2-c2-case-')));
    mkdirSync(join(h, 'LIBRARY', 'Caches'), { recursive: true });
    expect(checkLocation(join(h, 'LIBRARY', 'Caches'), h)).toBe(null);
  });
});
