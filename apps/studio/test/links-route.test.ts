// S3.10a — `GET /_api/links?file=` (contract client/v2/contracts/S3-links-format.md §4, §10 row 3).
//
// Main origin only (absent from CANVAS_SAFE_API and the canvas routes map → 404 from the canvas origin);
// a read a read-only session may make; under a canvas-scoped session an unreadable target reads `dangling`
// byte-equal to a missing one, and a missing file and a forbidden file give one status and one body.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CANVAS_SAFE_API, type Http } from '../http.ts';
import { canvasOriginRoutes } from '../routes/canvas-origin.ts';
import { allSpecs } from '../routes/index.ts';
import { createLinksRoutes, type LinksRouteDeps } from '../routes/links.ts';
import { mountRoutes } from '../routes/table.ts';
import { stubDeps } from './_route-stubs.ts';

const ROOT = mkdtempSync(join(tmpdir(), 'links-route-'));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));
const DESIGN = join(ROOT, '.design');
mkdirSync(join(DESIGN, 'site'), { recursive: true });

const HOME = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <button data-cd-id="see-pricing" data-cd-link="site/pricing.tsx#desktop">See pricing</button>
        <a data-cd-id="book" data-cd-link="https://cal.com/studio">Book</a>
        <a data-cd-id="faq" data-cd-link="#faq">FAQ</a>
        <a data-cd-id="gone" data-cd-link="#nope">Gone</a>
        <a data-cd-id="secret" data-cd-link="site/secret.tsx">Secret</a>
        <a data-cd-id="plain" data-cd-link="site/pricing.tsx">Pricing</a>
        <a data-cd-id="bad" data-cd-link="javascript:alert(1)">Bad</a>
        <a data-cd-link="#faq">No id</a>
      </DCArtboard>
      <DCArtboard id="faq" label="Questions" width={800} height={500}><p>Q</p></DCArtboard>
    </DesignCanvas>
  );
}
`;
const PRICING = `export default () => (
  <DesignCanvas>
    <DCArtboard id="mobile" label="Mobile" width={390} height={800}><p>M</p></DCArtboard>
    <DCArtboard id="desktop" label="Desktop" width={1200} height={800}><p>D</p></DCArtboard>
  </DesignCanvas>
);
`;
writeFileSync(join(DESIGN, 'Home.tsx'), HOME);
writeFileSync(join(DESIGN, 'site/pricing.tsx'), PRICING);
writeFileSync(join(DESIGN, 'site/secret.tsx'), PRICING);

const handlerFor = (deps: Partial<LinksRouteDeps> = {}) => {
  const [spec] = createLinksRoutes({ designRoot: DESIGN, designRel: '.design', ...deps });
  return spec as NonNullable<typeof spec>;
};
const get = async (q: string, deps?: Partial<LinksRouteDeps>) => {
  const res = await handlerFor(deps).handle(new Request(`http://127.0.0.1/_api/links${q}`), {});
  return { status: res.status, text: await res.text(), cache: res.headers.get('cache-control') };
};

describe('the spec', () => {
  test('GET, main origin only, a read a read-only session may make', () => {
    const s = handlerFor();
    expect([s.method, s.path, s.origin, s.readOnly]).toEqual([
      'GET',
      '/_api/links',
      'main',
      'allowed',
    ]);
  });

  test('registered in the table; absent from CANVAS_SAFE_API and the canvas routes map', () => {
    const specs = allSpecs(stubDeps());
    expect(specs.some((s) => s.path === '/_api/links' && s.method === 'GET')).toBe(true);
    const table = mountRoutes(specs);
    expect(table.exact['/_api/links']).toBeDefined();
    expect(table.canvasPaths).not.toContain('/_api/links');
    expect(CANVAS_SAFE_API.has('/_api/links')).toBe(false);
    const map = canvasOriginRoutes({
      routes: {},
      canvasRoutes: {},
      tableCanvasPaths: table.canvasPaths,
    } as unknown as Pick<Http, 'routes' | 'canvasRoutes' | 'tableCanvasPaths'>);
    expect(Object.keys(map)).not.toContain('/_api/links');
  });
});

describe('the answer', () => {
  test('every kind, its state and its label', async () => {
    const r = await get('?file=.design/Home.tsx');
    expect(r.status).toBe(200);
    expect(r.cache).toBe('no-store');
    const body = JSON.parse(r.text);
    expect(body.v).toBe(1);
    expect(body.file).toBe('Home.tsx');
    const by = Object.fromEntries(body.links.map((l: { id: string }) => [l.id, l]));
    expect(Object.keys(by)).toEqual([
      'see-pricing',
      'book',
      'faq',
      'gone',
      'secret',
      'plain',
      'bad',
    ]);
    expect(by['see-pricing']).toEqual({
      id: 'see-pricing',
      artboard: 'desktop',
      target: 'site/pricing.tsx#desktop',
      kind: 'canvas',
      canvas: 'site/pricing.tsx',
      toArtboard: 'desktop',
      state: 'ok',
      label: 'Go to Pricing',
    });
    expect(by.plain.toArtboard).toBe('mobile'); // no artboard named → the first
    expect(by.book).toEqual({
      id: 'book',
      artboard: 'desktop',
      target: 'https://cal.com/studio',
      kind: 'external',
      url: 'https://cal.com/studio',
      host: 'cal.com',
      state: 'ok',
      label: 'Opens cal.com/studio',
    });
    expect([by.faq.state, by.faq.label, by.faq.toArtboard]).toEqual([
      'ok',
      'Go to Questions',
      'faq',
    ]);
    expect([by.gone.state, by.gone.label]).toEqual(['dangling', 'Go to nope']);
    expect([by.bad.kind, by.bad.state]).toEqual(['invalid', 'invalid']);
  });

  test('a canvas-scoped session: an unreadable target is byte-equal to a missing one', async () => {
    const scoped = { sees: (_req: Request, rel: string) => rel !== 'site/secret.tsx' };
    const hidden = await get('?file=Home.tsx', scoped);
    unlinkSync(join(DESIGN, 'site/secret.tsx'));
    try {
      const missing = await get('?file=Home.tsx');
      expect(hidden.text).toBe(missing.text);
      const secret = JSON.parse(hidden.text).links.find((l: { id: string }) => l.id === 'secret');
      expect(secret.state).toBe('dangling');
    } finally {
      writeFileSync(join(DESIGN, 'site/secret.tsx'), PRICING);
    }
  });

  test('a missing file and a forbidden file give one status and one body; bad grammar is 400', async () => {
    const missing = await get('?file=site/nothing.tsx');
    const forbidden = await get('?file=site/secret.tsx', { sees: () => false });
    expect(missing.status).toBe(404);
    expect([forbidden.status, forbidden.text]).toEqual([missing.status, missing.text]);
    for (const q of ['', '?file=', '?file=../x.tsx', '?file=/etc/x.tsx', '?file=Home.ts'])
      expect((await get(q)).status).toBe(400);
    expect((await get('?file=_draw/x.tsx')).status).toBe(404);
  });
});
