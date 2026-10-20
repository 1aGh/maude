// S8.16 — /_api/generate-takes* through a booted studio (the real http.ts wiring: the index's artboard size, the
// generation queue, api.saveAsset, the sidecar writer). The provider is the stub (`MAUDE_GENERATE_STUB=1`, solid PNGs,
// no network); the key store points into the sandbox. A 4:5 artboard gets four 4:5 takes, each with its `.gen.json`.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readGen } from '../generation/gen-sidecar.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const CANVAS = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Matchday() {
  return (
    <DesignCanvas>
      <DCArtboard id="gw5" label="Post 4:5 · Gameweek 5" width={1080} height={1350}>
        <div data-cd-id="frame" style={{ width: 400, height: 500 }} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

const post = (base: string, path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('/_api/generate-takes on a booted studio (stub provider)', () => {
  test('quote → four takes in the artboard shape, one .gen.json each; the placed take knows the others', async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'matchday.tsx'), CANVAS);
    const port = nextPort();
    const proc = await bootServer(root, port, {
      MAUDE_GENERATE_STUB: '1',
      MAUDE_GEN_KEYS_PATH: join(root, 'keys.json'),
      MAUDE_GENERATE_MAX_CONCURRENT: '4',
    });
    cleanup = () => {
      killProc(proc);
      rmSync(root, { recursive: true, force: true });
    };
    const base = `http://localhost:${port}`;
    const ask = { canvas: 'ui/matchday.tsx', artboard: 'gw5', provider: 'stub' };

    // without the consent line nothing starts
    const blind = await post(base, '/_api/generate-takes', {
      ...ask,
      prompt: 'touchdown',
      model: 'stub-solid',
      n: 4,
      aspect: '4:5',
    });
    expect(blind.status).toBe(409);

    let quote: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      const r = await post(base, '/_api/generate-takes/quote', ask);
      quote = (await r.json()) as Record<string, unknown>;
      if (r.status === 200) break;
      await Bun.sleep(100); // the index may not have read the new canvas yet
    }
    expect(quote.aspect).toBe('4:5');
    expect((quote.lines as { time: string }).time).toContain('nothing is billed');

    const run = await post(base, '/_api/generate-takes', {
      ...ask,
      quote: quote.quote,
      prompt: 'touchdown, night stadium',
      model: quote.model,
      n: quote.n,
      aspect: quote.aspect,
    });
    expect(run.status).toBe(202);
    const { group } = (await run.json()) as { group: string };

    let g: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      const r = await fetch(`${base}/_api/generate-takes?group=${group}&canvas=ui/matchday.tsx`);
      g = (await r.json()) as Record<string, unknown>;
      if (g.status !== 'running') break;
      await Bun.sleep(100);
    }
    expect(g.status).toBe('done');
    const takes = g.takes as string[];
    expect(takes).toHaveLength(4);
    expect(g.best).toBe(takes[0] as string);
    for (const t of takes) {
      expect(existsSync(join(designRoot, t))).toBe(true);
      const sha = t.slice(7, 15);
      const doc = readGen(readFileSync(join(designRoot, 'assets', `${sha}.gen.json`), 'utf8'), {
        self: sha,
      });
      expect(doc?.group).toBe(group);
      expect(doc?.takes).toHaveLength(4);
    }
    // the stub drew 4:5 (40 × 50)
    const png = readFileSync(join(designRoot, takes[0] as string));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([40, 50]);

    const of = (await (
      await fetch(`${base}/_api/generate-takes/of?asset=${takes[1]}&canvas=ui/matchday.tsx`)
    ).json()) as Record<string, unknown>;
    expect(of.takes).toEqual(takes);
    expect(of.label).toBe('Take 2 of 4');
  }, 60_000);
});
