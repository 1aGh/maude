// V2-3.3 — Home's half of V2-1.16 L14 (V2-1.1 §5.8 items 4 and 5):
//   - `/_home/internal/search?pids=A` never returns a row of B, and never a field outside the
//     V2-1.17 cross-project projection
//   - a picture key not referenced by A's snapshot gets the SAME 404 (status, headers, body) as a
//     key that does not exist — no "is X cached" oracle, even for a key B really has

import { beforeAll, describe, expect, test } from 'bun:test';
import { writeThumb } from '../thumbs/store.ts';
import {
  addCover,
  freshIndexDir,
  homeFetch,
  homeReq,
  makeProject,
  rustReq,
  tinyJpeg,
} from './_home-fixtures.ts';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const KEY_NONE = 'c'.repeat(64);
/** a picture IN A's cache that A's snapshot does not reference (an old render, a planted file) */
const KEY_ORPHAN = 'd'.repeat(64);
let A: ReturnType<typeof makeProject>;
let B: ReturnType<typeof makeProject>;

beforeAll(() => {
  freshIndexDir();
  A = makeProject('alpha', { 'ui/Pricing.tsx': 'Pricing poster' });
  B = makeProject('beta', { 'ui/Pricing secret.tsx': 'Pricing secret' });
  addCover(A, 'ui/Pricing.tsx', KEY_A);
  addCover(B, 'ui/Pricing secret.tsx', KEY_B);
  writeThumb(A.pid, KEY_ORPHAN, tinyJpeg());
});

const f = () => homeFetch();

describe('internal/search scope', () => {
  test('pids=A returns A only, however well B matches', async () => {
    const r = await f()(rustReq(`/_home/internal/search?q=pricing&pids=${A.pid}`));
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      groups: Array<{ pid: string; rows: Array<{ key: string }> }>;
    };
    expect(body.groups.map((g) => g.pid)).toEqual([A.pid]);
    const text = JSON.stringify(body);
    expect(text).not.toContain('secret');
    expect(text).not.toContain(B.pid);
  });

  test('both pids → both groups (the scope is the list, nothing wider)', async () => {
    const body = (await (
      await f()(rustReq(`/_home/internal/search?q=pricing&pids=${A.pid},${B.pid}`))
    ).json()) as {
      groups: Array<{ pid: string }>;
    };
    expect(body.groups.map((g) => g.pid).sort()).toEqual([A.pid, B.pid].sort());
  });

  test('rows carry only projection fields: no root, no hashes, no hub', async () => {
    const text = JSON.stringify(
      await (await f()(rustReq(`/_home/internal/search?q=pricing&pids=${A.pid}`))).json()
    );
    expect(text).not.toContain(A.root);
    for (const banned of ['srcHash', 'metaHash', 'depsHash', 'linkedHub', 'root', 'designRel'])
      expect(text).not.toContain(banned);
  });
});

describe('picture keys (no existence oracle)', () => {
  const thumb = (pid: string, key: string) => f()(homeReq(`/_home/thumb/${pid}/${key}.jpg`));
  const shape = async (r: Response) => ({
    status: r.status,
    type: r.headers.get('content-type'),
    cache: r.headers.get('cache-control'),
    body: await r.text(),
  });

  test('A’s own cover is served as an immutable JPEG', async () => {
    const r = await thumb(A.pid, KEY_A);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/jpeg');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  });

  test('B’s real key under A, a key nobody has, and a bad pid all answer the same 404', async () => {
    const forbidden = await shape(await thumb(A.pid, KEY_B));
    const missing = await shape(await thumb(A.pid, KEY_NONE));
    const orphan = await shape(await thumb(A.pid, KEY_ORPHAN));
    const badPid = await shape(await thumb('l0000000000000000', KEY_A));
    const notAPid = await shape(await thumb('nope', KEY_A));
    const junk = await shape(await thumb(A.pid, 'not-a-key'));
    expect(forbidden.status).toBe(404);
    expect(forbidden).toEqual(missing);
    expect(orphan).toEqual(missing);
    expect(badPid).toEqual(missing);
    expect(notAPid).toEqual(missing);
    expect(junk).toEqual(missing);
  });

  test('internal/thumbs: a key outside the pid’s snapshot is simply absent', async () => {
    const body = (await (
      await f()(
        rustReq(
          `/_home/internal/thumbs?pid=${A.pid}&keys=${KEY_A},${KEY_B},${KEY_NONE},${KEY_ORPHAN}`
        )
      )
    ).json()) as {
      thumbs: Record<string, string>;
    };
    expect(Object.keys(body.thumbs)).toEqual([KEY_A]);
  });
});
