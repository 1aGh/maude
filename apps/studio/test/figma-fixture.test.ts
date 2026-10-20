// S8.17b — MAUDE_FIGMA_FIXTURE: the Figma client answers from a local directory (JSON + pictures) with no network call, so
// the desktop scenario can drive the frame leg. The other half of the contract: with the variable UNSET none of it is
// reachable — the client asks api.figma.com exactly as before, and a `maude-fixture:` URL is just a string.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importFramePictures, listFigmaFrames } from '../bin/_import-figma.mjs';
import {
  FigmaApiError,
  fetchIdentity,
  fetchImageUrls,
  fetchPages,
  fixtureAsset,
  fixtureDir,
  fixtureFileFor,
} from '../figma/client.ts';

const KEY = 'k8Fq2abcdEFGH12345678';
const URL_D = `https://www.figma.com/design/${KEY}/Uniformy-2027`;
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 12"><rect width="9" height="12" fill="#0a0"/></svg>';
const box = (width: number, height: number) => ({ x: 0, y: 0, width, height });
const frame = (id: string, name: string, w: number, h: number) => ({
  id,
  name,
  type: 'FRAME',
  visible: true,
  absoluteBoundingBox: box(w, h),
  fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
  children: [],
});

let dir: string;
let sandbox: string;
let realFetch: typeof fetch;
let calls: string[];

function put(name: string, body: unknown) {
  writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maude-figma-fixture-'));
  sandbox = mkdtempSync(join(tmpdir(), 'maude-figma-fixture-root-'));
  mkdirSync(join(sandbox, '.design', 'ui'), { recursive: true });
  put(`files_${KEY}.json`, {
    name: 'Uniformy-2027',
    document: {
      id: '0:0',
      type: 'DOCUMENT',
      children: [{ id: '1:1', name: 'Dresy', type: 'CANVAS' }],
    },
  });
  put(`files_${KEY}_nodes.json`, {
    nodes: {
      '1:1': {
        document: {
          id: '1:1',
          name: 'Dresy',
          type: 'CANVAS',
          children: [frame('2:1', 'Dres domácí', 900, 1280), frame('2:2', 'Helma', 600, 600)],
        },
      },
    },
  });
  put(`files_${KEY}_comments.json`, { comments: [] });
  put(`images_${KEY}.json`, { images: { '2:1': 'maude-fixture:frame-2-1.svg' } });
  put('frame-2-1.svg', SVG);
  put('me.json', { handle: 'fixture' });
  calls = [];
  realFetch = globalThis.fetch;
  // the fixture lane must never reach the network: any fetch is a failure
  globalThis.fetch = mock(async (input: unknown) => {
    calls.push(String(input));
    throw new Error('network is not allowed in the fixture lane');
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.MAUDE_FIGMA_FIXTURE;
  delete process.env.MAUDE_GEN_KEYS_PATH;
  rmSync(dir, { recursive: true, force: true });
  rmSync(sandbox, { recursive: true, force: true });
});

describe('with MAUDE_FIGMA_FIXTURE set', () => {
  beforeEach(() => {
    process.env.MAUDE_FIGMA_FIXTURE = dir;
    // no token anywhere: the lane needs none
    process.env.MAUDE_GEN_KEYS_PATH = join(dir, 'no-keys.json');
  });

  test('file names are the request path with / as _', () => {
    expect(fixtureFileFor('/files/KEY')).toBe('files_KEY.json');
    expect(fixtureFileFor('/files/KEY/nodes')).toBe('files_KEY_nodes.json');
    expect(fixtureFileFor('/me')).toBe('me.json');
  });

  test('pages, identity, image urls and the frame list come from the directory — no fetch, no token', async () => {
    expect(fixtureDir()).toBe(dir);
    expect((await fetchPages(KEY)).map((p) => p.id)).toEqual(['1:1']);
    expect((await fetchIdentity()).handle).toBe('fixture');
    expect((await fetchImageUrls(KEY, ['2:1'], 'svg')).images).toEqual({
      '2:1': 'maude-fixture:frame-2-1.svg',
    });
    const listed = await listFigmaFrames({ url: URL_D });
    expect(listed.frames.map((f: { id: string }) => f.id)).toEqual(['2:1', '2:2']);
    expect(calls).toEqual([]);
  });

  test('a file the fixture lacks is a plain not_found, not a network call', async () => {
    rmSync(join(dir, `files_${KEY}.json`));
    const err = await fetchPages(KEY).catch((e) => e);
    expect(err).toBeInstanceOf(FigmaApiError);
    expect((err as FigmaApiError).kind).toBe('not_found');
    expect(calls).toEqual([]);
  });

  test('a picture is read only for a `maude-fixture:<plain name>` url; anything else is not the fixture’s', () => {
    expect(fixtureAsset('maude-fixture:frame-2-1.svg')).toMatchObject({ ext: 'svg' });
    expect(fixtureAsset('maude-fixture:../me.json')).toBeNull();
    expect(fixtureAsset('maude-fixture:a/b.svg')).toBeNull();
    expect(fixtureAsset('maude-fixture:missing.png')).toBeNull();
    expect(fixtureAsset('https://s3-alpha.figma.com/x.svg')).toBeNull();
  });

  test('the frame leg end to end: a picked frame becomes an artboard whose picture is the fixture file', async () => {
    const r = await importFramePictures({
      url: URL_D,
      root: sandbox,
      frames: ['2:1'],
      folder: 'ui',
      comments: false,
    });
    expect(r.canvas).toBe('ui/Uniformy-2027.tsx');
    expect(r.assets.resolved).toBe(1);
    const tsx = readFileSync(join(sandbox, '.design', r.canvas), 'utf8');
    expect(tsx).not.toContain('maude-fixture');
    expect(tsx).toMatch(/assets\/[0-9a-f]{8}\.svg/);
    expect(calls).toEqual([]);
  });
});

describe('with MAUDE_FIGMA_FIXTURE unset the fixture code is unreachable', () => {
  const keysDirs: string[] = [];
  afterEach(() => {
    for (const d of keysDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  test('no directory, no picture: fixtureDir is null and a fixture url is not read', () => {
    delete process.env.MAUDE_FIGMA_FIXTURE;
    expect(fixtureDir()).toBeNull();
    expect(fixtureAsset('maude-fixture:frame-2-1.svg')).toBeNull();
    // an empty or blank value is "unset" too
    process.env.MAUDE_FIGMA_FIXTURE = '   ';
    expect(fixtureDir()).toBeNull();
    process.env.MAUDE_FIGMA_FIXTURE = '';
    expect(fixtureDir()).toBeNull();
  });

  test('the client asks api.figma.com with the token, and the files in the directory are never read', async () => {
    delete process.env.MAUDE_FIGMA_FIXTURE;
    const keysDir = mkdtempSync(join(tmpdir(), 'maude-figma-fixture-keys-'));
    keysDirs.push(keysDir);
    const keysPath = join(keysDir, 'keys.json');
    writeFileSync(keysPath, JSON.stringify({ keys: { figma: 'figd_FIXTURECANARY' } }), {
      mode: 0o600,
    });
    process.env.MAUDE_GEN_KEYS_PATH = keysPath;
    globalThis.fetch = mock(async (input: unknown, init?: { headers?: Record<string, string> }) => {
      calls.push(String(input));
      expect(init?.headers?.['X-Figma-Token']).toBe('figd_FIXTURECANARY');
      return new Response(JSON.stringify({ handle: 'real' }), { status: 200 });
    }) as unknown as typeof fetch;
    expect((await fetchIdentity()).handle).toBe('real'); // not 'fixture' from me.json
    expect(calls).toEqual(['https://api.figma.com/v1/me']);
    expect(existsSync(join(dir, 'me.json'))).toBe(true);
  });

  test('without a token and without the variable the client refuses, as it always did', async () => {
    delete process.env.MAUDE_FIGMA_FIXTURE;
    process.env.MAUDE_GEN_KEYS_PATH = join(dir, 'no-keys.json');
    const err = await fetchIdentity().catch((e) => e);
    expect((err as FigmaApiError).kind).toBe('not_configured');
    expect(calls).toEqual([]);
  });
});
