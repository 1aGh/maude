// gate-b-c4i — a media upload from a canvas frame lands again, for a frame that may edit.
//
// Since gate-b-c4 every canvas-listener request is a canvas-only session narrowed to its frame
// (access/frame.ts). `POST /_api/asset` (and the chunked trio) names no canvas — the bytes are a
// new content-addressed file — so the write gate had no target to judge and refused it from EVERY
// frame, the owner's included: a drop of a photo onto a canvas, a board image, and the bg-remove
// harness (`maude design photo-bg-remove`, canvas-lib `PhotoBgRemoveHarness`) all answered 403.
//
// Now: an upload that names no target passes when the frame holds `edit` on at least one canvas
// of its grant. Still refused: a read-only frame (its canvas imports another canvas — c4h
// `readOnlyBecause`), a Can view member's frame, and a request with no frame capability at all.
// The upload's own caps (sniff, size, content-addressed name) are untouched.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import type { AccessClaim } from '../access/scope.ts';
import { asUser, frameCap, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const SHA = 'cafebabe';
const PHOTO = `assets/${SHA}.png`;
const HARNESS = `_photo/${SHA}.bgremove.tsx`;
const NONCE = '00112233445566778899aabbccddeeff';
const PLAIN = 'ui/plain.tsx';
const IMPORTER = 'ui/imports-plain.tsx';

const FILES: Record<string, string> = {
  [PLAIN]: `export default function P() { return <img src="/${PHOTO}" alt="" />; }\n`,
  [IMPORTER]:
    "import P from './plain.tsx';\nexport default function I() { return <div><P /></div>; }\n",
  [HARNESS]: `import { PhotoBgRemoveHarness } from '@maude/canvas-lib';\n// maude-harness-nonce: ${NONCE}\nexport default function H() {\n  return <PhotoBgRemoveHarness source="${PHOTO}" />;\n}\n`,
};

interface Booted {
  proc: Subprocess;
  base: string;
  canvasBase: string;
}

async function boot(env: Record<string, string>): Promise<Booted> {
  const { root, designRoot } = makeSandbox();
  for (const [rel, text] of Object.entries(FILES)) {
    mkdirSync(join(designRoot, rel, '..'), { recursive: true });
    writeFileSync(join(designRoot, rel), text);
  }
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  writeFileSync(join(designRoot, PHOTO), PNG);
  const port = nextPort();
  const proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1', ...env });
  let canvasBase = '';
  for (let i = 0; i < 40 && !canvasBase; i++) {
    try {
      canvasBase = String(
        JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8')).canvasOrigin ?? ''
      );
    } catch {
      /* not written yet */
    }
    if (!canvasBase) await Bun.sleep(50);
  }
  return { proc, base: `http://localhost:${port}`, canvasBase };
}

/** A fresh (never-deduped) PNG: the same 1×1 image with a unique trailer. */
const freshPng = () => Buffer.concat([PNG, Buffer.from(`${Math.random()}`)]);

async function upload(b: Booted, fc: string | null, who: Record<string, string> = {}) {
  const url = fc ? withFc(`${b.canvasBase}/_api/asset`, fc) : `${b.canvasBase}/_api/asset`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { ...who, 'content-type': 'image/png' },
    body: freshPng(),
  });
  return { status: r.status, body: await r.text() };
}

async function chunkStart(b: Booted, fc: string | null, who: Record<string, string> = {}) {
  const url = fc
    ? withFc(`${b.canvasBase}/_api/asset/chunk-start`, fc)
    : `${b.canvasBase}/_api/asset/chunk-start`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { ...who, 'content-type': 'application/json' },
    body: JSON.stringify({ totalSize: 20 * 1024 * 1024 }),
  });
  return { status: r.status, body: await r.text() };
}

describe('a desktop — the owner', () => {
  let b: Booted;
  beforeAll(async () => {
    b = await boot({});
  }, 60000);
  afterAll(async () => {
    if (b) await killProc(b.proc);
  });

  test("the bg-remove harness's frame (from the nonce redirect) uploads its cut-out", async () => {
    const r = await fetch(`${b.base}/_canvas-shell.html?canvas=${HARNESS}&nonce=${NONCE}`, {
      redirect: 'manual',
    });
    expect(r.status).toBe(307);
    const loc = new URL(r.headers.get('location') ?? '');
    expect(loc.origin).toBe(b.canvasBase);
    const up = await upload(b, loc.searchParams.get('fc'));
    expect({ status: up.status, path: /"path":"assets\/[0-9a-f]+\.png"/.test(up.body) }).toEqual({
      status: 201,
      path: true,
    });
  }, 30000);

  test("a plain canvas's frame uploads (one-shot and chunked start)", async () => {
    const fc = await frameCap(b, {}, PLAIN);
    expect((await upload(b, fc)).status).toBe(201);
    expect((await chunkStart(b, fc)).status).toBe(201);
  }, 30000);

  test('a frame read-only because its canvas imports another canvas: refused', async () => {
    const fc = await frameCap(b, {}, IMPORTER);
    const up = await upload(b, fc);
    expect({ status: up.status, read: /read-only/.test(up.body) }).toEqual({
      status: 403,
      read: true,
    });
    expect((await chunkStart(b, fc)).status).toBe(403);
  }, 30000);

  test('no frame capability: refused', async () => {
    expect((await upload(b, null)).status).toBe(403);
    expect((await chunkStart(b, null)).status).toBe(403);
  }, 30000);
});

const header = (claim: AccessClaim) => Buffer.from(JSON.stringify(claim)).toString('base64url');
const role = (r: string, user: string) =>
  asUser(
    {
      'x-maude-access': header({ v: 1, role: r } as AccessClaim),
      'x-maude-role': r,
      'x-maude-readonly': r === 'member' || r === 'owner' ? '0' : '1',
    },
    user
  );

describe('a cell', () => {
  let b: Booted;
  beforeAll(async () => {
    b = await boot({
      MAUDE_WORKSPACE_MODE: '1',
      MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
      HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
      MAUDE_PROJECT_NAME: 'C4i',
    });
  }, 60000);
  afterAll(async () => {
    if (b) await killProc(b.proc);
  });

  test("a Can edit member's frame uploads", async () => {
    const who = role('member', 'm@example.com');
    expect((await upload(b, await frameCap(b, who, PLAIN), who)).status).toBe(201);
  }, 30000);

  test("a Can view member's frame is refused", async () => {
    const who = role('observer', 'o@example.com');
    const fc = await frameCap(b, who, PLAIN);
    expect((await upload(b, fc, who)).status).toBe(403);
    expect((await chunkStart(b, fc, who)).status).toBe(403);
  }, 30000);

  test("a Can comment member's frame is refused", async () => {
    const who = role('viewer', 'v@example.com');
    expect((await upload(b, await frameCap(b, who, PLAIN), who)).status).toBe(403);
  }, 30000);
});
