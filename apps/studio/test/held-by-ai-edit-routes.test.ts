// V2-5 A2 (S5.4 patch 2, S2.18 backstop) — a person's source-write edit routes ask the run
// registry first: an element a running AI run holds answers 409 `held-by-ai`; a waiting run
// holds nothing. The decision itself is `heldByAiRefusal` (routes/agent.ts, pinned end to end in
// agent-runs-hooks S1); this file pins that http.ts's legacy edit routes actually call it, with
// the route body's canvas + id, BEFORE the write — and what the call returns for the two cases.
//
// No booted server: nothing reachable over HTTP sets a run's scope elements yet (S2.18 does), so
// a boot could not build the held state; the route wiring is pinned from the source instead.

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry, type RunRegistry } from '../ai/runs.ts';
import { heldByAiRefusal } from '../routes/agent.ts';

const HTTP = readFileSync(join(import.meta.dir, '..', 'http.ts'), 'utf8');

/** The source of one legacy route handler: from its key to the next `'/_api/` key. */
function handler(route: string): string {
  const start = HTTP.indexOf(`'${route}': async`);
  expect(start).toBeGreaterThan(-1);
  const next = HTTP.indexOf("\n    '/_", start + route.length + 4);
  return HTTP.slice(start, next === -1 ? undefined : next);
}

const WRITES: Array<[string, string]> = [
  ['/_api/edit-css', 'api.editCss(body)'],
  ['/_api/edit-text', 'api.editText(body)'],
  ['/_api/edit-attr', 'api.editAttr(body)'],
];

describe('http.ts edit routes ask heldByAiRefusal before they write', () => {
  for (const [route, write] of WRITES) {
    test(`${route}: held → its 409 is returned before ${write}`, () => {
      const src = handler(route);
      const call = src.indexOf('heldByAiRefusal(runs, ctx.paths.designRel, body.canvas, body.id)');
      expect(call).toBeGreaterThan(-1);
      expect(src.indexOf('if (held) return held;')).toBeGreaterThan(call);
      expect(src.indexOf(write)).toBeGreaterThan(call);
    });
  }
});

describe('what the routes get back', () => {
  let reg: RunRegistry | null = null;
  afterEach(() => {
    reg?.close();
    reg = null;
  });

  const ask = (r: RunRegistry, chatId: string, element: string) =>
    r.ask({
      chatId,
      origin: 'maude-chat',
      label: 'L',
      prompt: 'P',
      scope: {
        canvas: 'ui/C.tsx',
        artboards: ['hero'],
        elements: [{ canvas: r.canvasKey('ui/C.tsx'), artboard: 'hero', element }],
      },
    });

  test('a running run holds its element (409 held-by-ai); a waiting run holds nothing', async () => {
    const t = 1_000;
    reg = createRunRegistry({
      designRoot: null,
      designRel: '.design',
      home: createLocalLeaseHome({ actor: 'you', now: () => t }),
      now: () => t,
      autoRenew: false,
      artboardsOf: () => ['hero'],
    });
    const running = await ask(reg, 'c1', 'title');
    await reg.started(running.runId);
    const r = heldByAiRefusal(reg, '.design', '.design/ui/C.tsx', 'title');
    expect(r?.status).toBe(409);
    expect(((await (r as Response).json()) as { code: string }).code).toBe('held-by-ai');
    // hero is busy, so a second run on it waits — and holds nothing
    const waiting = await ask(reg, 'c2', 'lead');
    expect(waiting.state).toBe('waiting');
    expect(heldByAiRefusal(reg, '.design', '.design/ui/C.tsx', 'lead')).toBeNull();
  });
});
