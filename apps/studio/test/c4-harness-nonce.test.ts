// gate-b-c4c — the bg-remove harness frame is minted only for the helper's one-time nonce.
//
// The main origin 307s `?canvas=_photo/<hash>.bgremove.tsx` to the INTERACTIVE canvas origin with
// a frame capability over the harness plus every canvas using its photo (gate-b-c4b). Before this
// fix any requester got it: canvas A's code iframes that (guessable) main-origin URL, lands on the
// canvas origin — A's own origin — with `fc` in the URL, reads `iframe.contentWindow.location`,
// and holds a capability over every canvas using the photo. A failed helper run left the harness
// on disk, minting forever.
//
// Now: the helper writes `// maude-harness-nonce: <32 hex>` into the harness and opens the URL
// with `&nonce=`; the redirect requires exactly {canvas, nonce}, a matching nonce
// (timingSafeEqual) and a top-level navigation the user agent started (`Sec-Fetch-Site` absent,
// `none` or `same-origin`). Anything else falls through to the read-only capture origin, as every
// other main-origin shell does. The frame's users are `.tsx` canvases only.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { frameCap, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const SHA = 'cafebabe';
const ASSET = `assets/${SHA}.png`;
const REL = `_photo/${SHA}.bgremove.tsx`;
const NONCE = '00112233445566778899aabbccddeeff';
const harness = (nonceLine: string) =>
  `import { PhotoBgRemoveHarness } from '@maude/canvas-lib';\n${nonceLine}export default function H() {\n  return <PhotoBgRemoveHarness source="${ASSET}" />;\n}\n`;

/** The canvases a frame capability names (its body is b64url of the newline-joined list). */
function usersOf(fc: string | null): string[] {
  if (!fc) return [];
  return Buffer.from(fc.split('.')[0] ?? '', 'base64url')
    .toString('utf8')
    .split('\n');
}

async function withProject(
  nonceLine: string,
  fn: (env: { main: string; canvas: string; port: number; designRoot: string }) => Promise<void>
) {
  const { root, designRoot } = makeSandbox();
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  mkdirSync(join(designRoot, 'system', 'ds'), { recursive: true });
  mkdirSync(join(designRoot, '_photo'), { recursive: true });
  writeFileSync(join(designRoot, ASSET), 'PNG-BYTES');
  // a canvas that uses the photo (the frame must reach it)…
  writeFileSync(
    join(designRoot, 'ui', 'photo.tsx'),
    `export default function P(){return <img src="/assets/${SHA}.png" alt="" />}\n`
  );
  // …canvas A, the attacker, naming the harness module (its closure must not widen to it)…
  writeFileSync(
    join(designRoot, 'ui', 'a.tsx'),
    `import H from '../${REL}';\nexport default function A(){return <H/>}\n`
  );
  // …and two non-canvas files that merely name the photo (no frame over them).
  writeFileSync(join(designRoot, 'system', 'ds', 'x.css'), `.hero{background:url(${ASSET})}\n`);
  writeFileSync(join(designRoot, 'notes.md'), `![hero](${ASSET})\n`);
  writeFileSync(join(designRoot, REL), harness(nonceLine));
  const port = nextPort();
  const proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' });
  try {
    let canvas = '';
    for (let i = 0; i < 40 && !canvas; i++) {
      try {
        canvas = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8')).canvasOrigin;
      } catch {
        /* not written yet */
      }
      if (!canvas) await Bun.sleep(50);
    }
    expect(canvas).toBeTruthy();
    await fn({ main: `http://localhost:${port}`, canvas, port, designRoot });
  } finally {
    await killProc(proc);
  }
}

async function open(main: string, query: string, headers: Record<string, string> = {}) {
  const r = await fetch(`${main}/_canvas-shell.html${query}`, { redirect: 'manual', headers });
  expect(r.status).toBe(307);
  return new URL(r.headers.get('location') ?? '');
}

describe('gate-b-c4c — the bg-remove harness frame needs the one-time nonce', () => {
  test('the correct nonce: canvas origin, a frame over the harness + the .tsx canvases using the photo', async () => {
    await withProject(`// maude-harness-nonce: ${NONCE}\n`, async ({ main, canvas }) => {
      for (const site of [null, 'none', 'same-origin']) {
        const loc = await open(
          main,
          `?canvas=${REL}&nonce=${NONCE}`,
          site ? { 'sec-fetch-site': site } : {}
        );
        expect(`${site} ${loc.origin}`).toBe(`${site} ${canvas}`);
        // the nonce is spent here — it never rides on to the canvas origin
        expect([...loc.searchParams.keys()].sort()).toEqual(['canvas', 'fc']);
        // .tsx canvases only: not the stylesheet, not the notes, not A (A does not use the photo)
        expect(usersOf(loc.searchParams.get('fc')).sort()).toEqual([REL, 'ui/photo.tsx']);
      }
    });
  }, 60_000);

  test('a planted harness without the nonce line, or the wrong nonce, gets no canvas-origin frame', async () => {
    await withProject('', async ({ main, canvas }) => {
      // the guessable URL alone, or with any nonce: the file holds none
      for (const q of [`?canvas=${REL}`, `?canvas=${REL}&nonce=${NONCE}`]) {
        const loc = await open(main, q);
        expect(`${q} ${loc.origin}`).not.toBe(`${q} ${canvas}`);
        expect(usersOf(loc.searchParams.get('fc'))).not.toContain('ui/photo.tsx');
        expect(loc.searchParams.has('nonce')).toBe(false);
      }
    });
    await withProject(`// maude-harness-nonce: ${NONCE}\n`, async ({ main, canvas }) => {
      for (const q of [
        `?canvas=${REL}`, // what canvas A can guess
        `?canvas=${REL}&nonce=${'f'.repeat(32)}`, // wrong
        `?canvas=${REL}&nonce=${NONCE.toUpperCase()}`, // not the shape
        `?canvas=${REL}&nonce=${NONCE.slice(1)}`, // short
        `?canvas=${REL}&nonce=${NONCE}&nonce=${NONCE}`, // twice
        `?canvas=${REL}&nonce=${NONCE}&designRel=.design`, // an extra key
      ]) {
        const loc = await open(main, q);
        expect(`${q} ${loc.origin}`).not.toBe(`${q} ${canvas}`);
        expect(usersOf(loc.searchParams.get('fc'))).not.toContain('ui/photo.tsx');
        expect(loc.searchParams.has('nonce')).toBe(false);
      }
      // belt over the nonce: a navigation another site started (A's iframe is same-site)
      for (const site of ['same-site', 'cross-site']) {
        const loc = await open(main, `?canvas=${REL}&nonce=${NONCE}`, { 'sec-fetch-site': site });
        expect(`${site} ${loc.origin}`).not.toBe(`${site} ${canvas}`);
      }
    });
  }, 90_000);

  test("canvas A's frame cannot read the harness module (nor its nonce)", async () => {
    await withProject(`// maude-harness-nonce: ${NONCE}\n`, async ({ main, canvas, port }) => {
      const fcA = await frameCap({ base: `http://localhost:${port}` }, {}, 'ui/a.tsx');
      expect(fcA).toBeTruthy();
      const at = (p: string) => fetch(`${canvas}${p}`, { signal: AbortSignal.timeout(5000) });
      // gate-b-c4e — A's own module no longer builds at all: its import of the harness is an
      // import of runtime state (`_photo/`), which the build refuses (and never inlines)…
      const own0 = await at(withFc('/.design/ui/a.tsx', fcA));
      expect(own0.status).not.toBe(200);
      expect(await own0.text()).not.toContain(NONCE);
      // …the harness does not serve to A's frame either, nor its meta lane, nor frame-less
      for (const p of [
        withFc(`/.design/${REL}`, fcA),
        withFc(`/_api/canvas-meta?file=.design/${REL}`, fcA),
        `/.design/${REL}`,
      ]) {
        const r = await at(p);
        const body = await r.text();
        expect(`${p} ${r.status}`).not.toBe(`${p} 200`);
        expect(body).not.toContain(NONCE);
      }
      // the harness's own frame does read it (control: the lane is narrowed, not closed)
      const loc = await open(main, `?canvas=${REL}&nonce=${NONCE}`);
      const own = await at(withFc(`/.design/${REL}`, loc.searchParams.get('fc')));
      expect(own.status).toBe(200);
    });
  }, 60_000);
});
