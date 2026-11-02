// V2-2.17 — R2 / R5: the renderer's only accepted output is a JPEG the server validates
// (contract V2-1.17 §5.8 "Server-side validation"). Non-JPEG, truncated, oversized or
// larger-than-asked bytes are refused and nothing is stored; the size the server records is read
// from the JPEG itself, never from what the renderer claims.

import { afterAll, describe, expect, test } from 'bun:test';

import { pidOf } from '../index/snapshot.ts';
import { createThumbService, type ThumbService } from '../thumbs/service.ts';
import { readThumb } from '../thumbs/store.ts';
import { checkJpeg, MAX_THUMB_BYTES } from '../thumbs/validate.ts';
import { makeSandbox } from './_helpers.ts';
import { type Answer, b64, fakeJpeg, fakeShim, PNG } from './_thumbs-fake.ts';
import { indexFor, settle, writeFiles } from './_thumbs-helpers.ts';

const CANVAS = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
export default function A() {
  return (<DesignCanvas><DCSection id="s" title="A">
    <DCArtboard id="one" label="One" width={960} height={600}><div /></DCArtboard>
  </DCSection></DesignCanvas>);
}
`;

const services: ThumbService[] = [];
afterAll(() => {
  for (const s of services) s.stop();
});

function serviceAnswering(answer: Answer) {
  const { root, designRoot } = makeSandbox();
  writeFiles(designRoot, { 'ui/A.tsx': CANVAS });
  const index = indexFor(root, designRoot);
  const shim = fakeShim(answer);
  const svc = createThumbService({
    pid: pidOf(root),
    designRoot,
    index,
    config: () => ({ theme: 'dark' }),
    serverOrigin: () => 'http://localhost:1',
    captureOrigin: () => 'http://localhost:2',
    spawnShim: shim.handle,
  });
  services.push(svc);
  return { root, svc, index, sent: shim.sent };
}

const shot =
  (bytes: Uint8Array | string, extra: Record<string, unknown> = {}): Answer =>
  () => ({
    ok: true,
    runtime: { artboards: [] },
    shots: [
      {
        target: 0,
        artboard: 'one',
        jpeg: typeof bytes === 'string' ? bytes : b64(bytes),
        ...extra,
      },
    ],
  });

const COVER = { canvas: 'ui/A.tsx', artboard: null, size: 'card', priority: 'visible' } as const;

describe('checkJpeg (V2-2.17 R2/R5)', () => {
  test('accepts a JPEG up to the asked size (+1 px), refuses everything else', () => {
    expect(checkJpeg(fakeJpeg(480, 300), 480)).toEqual({ ok: true, w: 480, h: 300 });
    expect(checkJpeg(fakeJpeg(481, 300), 480).ok).toBe(true);
    expect(checkJpeg(fakeJpeg(482, 300), 480)).toEqual({ ok: false, reason: 'too-big' });
    expect(checkJpeg(fakeJpeg(160, 500), 480)).toEqual({ ok: false, reason: 'too-big' });
    expect(checkJpeg(PNG, 480)).toEqual({ ok: false, reason: 'not-jpeg' });
    expect(checkJpeg(fakeJpeg(100, 100).slice(0, -2), 480)).toEqual({
      ok: false,
      reason: 'truncated',
    });
    expect(checkJpeg(fakeJpeg(100, 100, MAX_THUMB_BYTES), 480)).toEqual({
      ok: false,
      reason: 'too-large',
    });
    expect(checkJpeg(new Uint8Array(), 480)).toEqual({ ok: false, reason: 'empty' });
    // SOI … EOI with no frame header is not a picture
    expect(checkJpeg(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), 480).ok).toBe(false);
  });
});

describe('the service stores only validated bytes (V2-2.17 R2/R5)', () => {
  for (const [name, answer] of [
    ['a PNG', shot(PNG)],
    ['a JPEG larger than asked', shot(fakeJpeg(960, 600))],
    ['a JPEG over 1 MB', shot(fakeJpeg(480, 300, MAX_THUMB_BYTES))],
    ['a truncated JPEG', shot(fakeJpeg(480, 300).slice(0, -2))],
    ['text that is not base64 of anything', shot('<script>alert(1)</script>')],
  ] as const) {
    test(`${name} is refused and nothing is stored`, async () => {
      const { root, svc, index } = serviceAnswering(answer);
      const first = await svc.thumb(COVER);
      expect(first.status).toBe('pending');
      const key = (first as { key: string }).key;
      expect(await settle(svc, COVER)).toEqual({ status: 'unavailable', reason: 'failed' });
      expect(readThumb(pidOf(root), key)).toBeNull();
      expect(index.canvas('ui/A.tsx')?.cover).toBeNull();
    });
  }

  test('a valid JPEG is stored; its size comes from the bytes, not the renderer’s claim', async () => {
    const { root, svc, index, sent } = serviceAnswering(
      shot(fakeJpeg(480, 300), { w: 9999, h: 9999 })
    );
    const r = await settle(svc, COVER);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect({ w: r.w, h: r.h }).toEqual({ w: 480, h: 300 });
    expect(r.url).toBe(`/_api/thumb/${r.key}`);
    expect(readThumb(pidOf(root), r.key)?.length).toBeGreaterThan(0);
    expect(index.canvas('ui/A.tsx')?.cover).toEqual({
      key: r.key,
      w: 480,
      h: 300,
      ofSrc: index.canvas('ui/A.tsx')?.srcHash as string,
    });
    // R2: the URL, the targets and the sizes were the server's
    const op = sent[0] as { url: string; expectOrigin: string; targets: unknown };
    expect(op.expectOrigin).toBe('http://localhost:2');
    expect(new URL(op.url).origin).toBe('http://localhost:1');
    expect(op.targets).toEqual([{ artboard: null, px: 480 }]);
  });

  test('three failures for one key stop retries until the next change', async () => {
    let calls = 0;
    const { svc } = serviceAnswering(() => {
      calls++;
      return { ok: false, error: 'error' };
    });
    for (let i = 0; i < 6; i++) {
      await svc.thumb(COVER);
      await svc.idle();
    }
    expect(calls).toBe(3);
    expect(await svc.thumb(COVER)).toEqual({ status: 'unavailable', reason: 'failed' });
  });
});
