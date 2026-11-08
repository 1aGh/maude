// #172 — a picture dropped or pasted onto a canvas (`/_api/asset`) or sent in chunks (`/_api/asset/chunk-finish`)
// writes `assets/<sha8>.added.json`, the record every peer's Assets details read "Added by" from (contract
// client/v2/contracts/172-asset-origins.md). A NAME only, never an e-mail; first writer wins; in a cell the name is
// the proxy-vouched member (`x-maude-user`), on a Mac it is the git user — a header a browser sets on a Mac is ignored.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { asUser, bootAclCell, MEMBER } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  )
);
const PNG_B = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
);
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
function mp4(len: number): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (i * 31 + 7) & 0xff;
  out.set([0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii('isom')], 0);
  return out;
}

const procs: Subprocess[] = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

const addedFiles = (designRoot: string): string[] => {
  const dir = join(designRoot, 'assets');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.added.json')) : [];
};
const readAdded = (designRoot: string, f: string) =>
  JSON.parse(readFileSync(join(designRoot, 'assets', f), 'utf8')) as Record<string, unknown>;
/** The asset's full file name: the record is keyed by it (burndown F6), not by the stem. */
const stemOf = (path: string) => path.replace(/^assets\//, '');

const post = (base: string, bytes: Uint8Array, headers: Record<string, string> = {}) =>
  fetch(`${base}/_api/asset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', ...headers },
    body: bytes,
  });

describe('#172 — the canvas drop / paste routes record who added the picture', () => {
  test('on a Mac: the git user names it; an x-maude-user header a browser sets is ignored; no e-mail', async () => {
    const { root, designRoot } = makeSandbox();
    const gitcfg = join(root, 'gitconfig');
    writeFileSync(gitcfg, '[user]\n\tname = Tereza Novak\n');
    const port = nextPort();
    const proc = await bootServer(root, port, {
      GIT_CONFIG_GLOBAL: gitcfg,
      GIT_CONFIG_NOSYSTEM: '1',
    });
    procs.push(proc);
    const res = await post(`http://localhost:${port}`, PNG, {
      'x-maude-user': 'mallory@evil.example',
    });
    expect(res.status).toBe(201);
    const stem = stemOf(((await res.json()) as { path: string }).path);
    expect(addedFiles(designRoot)).toEqual([`${stem}.added.json`]);
    const rec = readAdded(designRoot, `${stem}.added.json`);
    expect(rec.by).toBe('Tereza Novak');
    expect(rec.format).toBe('maude.added');
    expect(JSON.stringify(rec)).not.toContain('@');
    expect(JSON.stringify(rec)).not.toContain('Mallory');
  });

  test('in a cell: the vouched member, reduced to a name; a second person adding the same bytes keeps the first', async () => {
    const cell = await bootAclCell();
    procs.push(cell.proc);
    const first = await post(cell.base, PNG_B, asUser(MEMBER, 'tereza.novak@example.com'));
    expect(first.status).toBe(201);
    const stem = stemOf(((await first.json()) as { path: string }).path);
    const rec = readAdded(cell.designRoot, `${stem}.added.json`);
    expect(rec.by).toBe('Tereza Novak');
    expect(JSON.stringify(rec)).not.toContain('@');
    const again = await post(cell.base, PNG_B, asUser(MEMBER, 'jonas@example.com'));
    expect(again.status).toBe(201);
    expect(readAdded(cell.designRoot, `${stem}.added.json`).by).toBe('Tereza Novak');
  });

  test('a chunked upload records the vouched member as a name', async () => {
    const CHUNK = 1024;
    const cell = await bootAclCell({
      MAUDE_ASSET_CHUNK_BYTES: String(CHUNK),
      MAUDE_ASSET_MAX_VIDEO_BYTES: String(2 * CHUNK),
      MAUDE_ASSET_MAX_CHUNKED_BYTES: String(16 * CHUNK),
    });
    procs.push(cell.proc);
    const bytes = mp4(CHUNK * 3 + 17);
    const h = asUser(MEMBER, 'jonas.kral@example.com');
    const s = (await (
      await fetch(`${cell.base}/_api/asset/chunk-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...h },
        body: JSON.stringify({ totalSize: bytes.length }),
      })
    ).json()) as { session: string; chunkBytes: number; chunkCount: number };
    for (let i = 0; i < s.chunkCount; i++) {
      const r = await fetch(`${cell.base}/_api/asset/chunk?session=${s.session}&index=${i}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...h },
        body: bytes.slice(i * s.chunkBytes, (i + 1) * s.chunkBytes),
      });
      expect(r.status).toBe(204);
    }
    const fin = await fetch(`${cell.base}/_api/asset/chunk-finish?session=${s.session}`, {
      method: 'POST',
      headers: h,
    });
    expect(fin.status).toBe(201);
    const stem = stemOf(((await fin.json()) as { path: string }).path);
    const rec = readAdded(cell.designRoot, `${stem}.added.json`);
    expect(rec.by).toBe('Jonas Kral');
    expect(JSON.stringify(rec)).not.toContain('@');
  });

  test('no name to give (no git user) → the picture lands, no record', async () => {
    const { root, designRoot } = makeSandbox();
    const gitcfg = join(root, 'gitconfig');
    writeFileSync(gitcfg, '');
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    const port = nextPort();
    const proc = await bootServer(root, port, {
      GIT_CONFIG_GLOBAL: gitcfg,
      GIT_CONFIG_NOSYSTEM: '1',
    });
    procs.push(proc);
    const res = await post(`http://localhost:${port}`, PNG);
    expect(res.status).toBe(201);
    expect(addedFiles(designRoot)).toEqual([]);
  });
});
