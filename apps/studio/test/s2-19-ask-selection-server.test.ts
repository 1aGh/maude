// S2.19 — ⌘/ on a selection, the server half (rows: "scope = ElementRef[] stamped before begin" and
// "writes outside the scope refused by the hook").
//
//   · `prompt {scope: {canvas, artboards, elements}}` is validated (parseRunScope): malformed elements are no
//     scope at all, never a guess; the element list is capped and its artboards must be in the lease list.
//   · The registry stamps the elements as the run's `objects` the moment it is asked — BEFORE the run begins
//     (waiting/starting), so a peer's published view and a person's edit route see the hold from the start.
//   · The edit hook refuses a write that changes anything outside the asked elements (S5's artboard-level
//     `out-of-scope` deny, narrowed to the elements): inside an asked element (itself, a child, a new child)
//     is free, a sibling and shared code are not.
//   · The offline outbox carries the elements too.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAskQueue } from '../acp/ask-queue.ts';
import { parseRunScope } from '../acp/index.ts';
import { createAgentRuns, elementsOutsideScope } from '../agent-runs.ts';
import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry, type RunRegistry } from '../ai/runs.ts';
import { agentRouteSpecs, heldByAiRefusal } from '../routes/agent.ts';
import { mountRoutes } from '../routes/table.ts';

const CANVAS = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function C() {
  return (
    <DesignCanvas>
      <DCArtboard id="hero" width={800} height={600}><div data-cd-id="card-a"><h3 data-cd-id="card-a-t">Alpha</h3></div><div data-cd-id="card-b"><h3 data-cd-id="card-b-t">Beta</h3></div><div data-cd-id="card-c"><h3 data-cd-id="card-c-t">Gamma</h3></div><p data-cd-id="lead">Sub</p></DCArtboard>
      <DCArtboard id="pricing" width={800} height={600}><p>x</p></DCArtboard>
    </DesignCanvas>
  );
}
`;
const KEY = 'path:.design/ui/C.tsx';
const WIRE = {
  canvas: 'ui/C.tsx',
  artboards: ['hero'],
  elements: [
    { artboard: 'hero', element: 'card-a' },
    { artboard: 'hero', element: 'card-b' },
  ],
};

describe('parseRunScope — elements', () => {
  test('a valid element list rides, each with the scope canvas', () => {
    const s = parseRunScope(WIRE);
    expect(s?.artboards).toEqual(['hero']);
    expect(s?.elements).toEqual([
      { canvas: 'ui/C.tsx', artboard: 'hero', element: 'card-a' },
      { canvas: 'ui/C.tsx', artboard: 'hero', element: 'card-b' },
    ]);
  });

  test('an occurrence index is kept; a duplicate ref folds', () => {
    const s = parseRunScope({
      ...WIRE,
      elements: [
        { artboard: 'hero', element: 'row', occurrence: 2 },
        { artboard: 'hero', element: 'row', occurrence: 2 },
        { artboard: 'hero', element: 'row', occurrence: 3 },
      ],
    });
    expect(s?.elements?.map((e) => e.occurrence)).toEqual([2, 3]);
  });

  test('a malformed list is no scope at all (never a guess)', () => {
    const bad: unknown[] = [
      { ...WIRE, elements: 'card-a' },
      { ...WIRE, elements: [] },
      { ...WIRE, elements: [{ artboard: 'hero' }] },
      { ...WIRE, elements: [{ artboard: 'hero', element: 'a b' }] },
      { ...WIRE, elements: [{ artboard: 'hero', element: 'x', occurrence: -1 }] },
      // an element of an artboard the ask does not lease
      { ...WIRE, elements: [{ artboard: 'pricing', element: 'x' }] },
      // '*' leases the whole canvas: an element list there has nothing to narrow
      { ...WIRE, artboards: '*' },
      {
        ...WIRE,
        elements: Array.from({ length: 201 }, (_, i) => ({ artboard: 'hero', element: `e${i}` })),
      },
    ];
    for (const raw of bad) expect(parseRunScope(raw)).toBeNull();
  });

  test('no elements key = today’s artboard scope, unchanged', () => {
    expect(parseRunScope({ canvas: 'ui/C.tsx', artboards: ['hero'] })).toEqual({
      canvas: 'ui/C.tsx',
      artboards: ['hero'],
    });
  });
});

let project: string;
let reg: RunRegistry;
let exact: Record<string, (req: Request) => Response | Promise<Response>>;

beforeEach(() => {
  project = realpathSync(mkdtempSync(join(tmpdir(), 'maude-s219-')));
  mkdirSync(join(project, '.design', 'ui'), { recursive: true });
  writeFileSync(join(project, '.design', 'config.json'), '{}');
  writeFileSync(join(project, '.design', 'ui', 'C.tsx'), CANVAS);
  reg = createRunRegistry({
    designRoot: null,
    designRel: '.design',
    home: createLocalLeaseHome({ actor: 'you' }),
    autoRenew: false,
    artboardsOf: () => ['hero', 'pricing'],
  });
  ({ exact } = mountRoutes(
    agentRouteSpecs({
      repoRoot: project,
      designRel: '.design',
      shells: () => 0,
      emit: () => {},
      runs: createAgentRuns({}, undefined, reg),
      personHolds: () => [],
      memberName: () => null,
    })
  ));
});
afterEach(() => {
  reg.close();
  rmSync(project, { recursive: true, force: true });
});

const ask = (chatId: string, scope = parseRunScope(WIRE)) =>
  reg.ask({
    chatId,
    origin: 'maude-chat',
    label: 'Ask',
    prompt: 'PROMPT-SECRET add a link',
    scope,
  });

describe('the registry stamps the asked elements before the run begins', () => {
  test('objects are set the moment the run exists, under the canvas key', async () => {
    const rec = await ask('c1');
    // asked, not started: the bridge has not accepted the turn yet
    expect(['starting', 'running']).toContain(rec.state);
    const stamped = reg
      .get(rec.runId)
      ?.objects.map((o) => `${o.canvas}|${o.artboard}|${o.element}`);
    expect(stamped).toEqual([`${KEY}|hero|card-a`, `${KEY}|hero|card-b`]);
    // the scope keeps its list too (the hook reads it from there)
    expect(reg.get(rec.runId)?.scope?.elements?.map((e) => e.element)).toEqual([
      'card-a',
      'card-b',
    ]);
  });

  test('a person’s edit on an asked element is 409 held-by-ai once the run runs; a sibling is theirs', async () => {
    const rec = await ask('c2');
    await reg.started(rec.runId);
    expect(heldByAiRefusal(reg, '.design', 'ui/C.tsx', 'card-a')?.status).toBe(409);
    expect(heldByAiRefusal(reg, '.design', 'ui/C.tsx', 'card-b')?.status).toBe(409);
    expect(heldByAiRefusal(reg, '.design', 'ui/C.tsx', 'card-c')).toBeNull();
    await reg.stop(rec.runId);
    expect(heldByAiRefusal(reg, '.design', 'ui/C.tsx', 'card-a')).toBeNull();
  });

  test('the run’s public view carries the elements (peers draw the hold) and never the prompt', async () => {
    const rec = await ask('c3');
    const mine = reg.view().mine.find((r) => r.runId === rec.runId);
    expect(mine?.objects.map((o) => o.element)).toEqual(['card-a', 'card-b']);
    expect(JSON.stringify(mine?.objects)).not.toContain('PROMPT-SECRET');
  });
});

describe('the edit hook narrows an element ask to its elements', () => {
  async function post(route: string, body: unknown) {
    const r = await exact[route](
      new Request(`http://127.0.0.1:4399${route}`, {
        method: 'POST',
        headers: { host: '127.0.0.1:4399', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    return (await r.json()) as Record<string, unknown>;
  }
  const check = (edit: { old: string; new: string }) =>
    post('/_api/agent/edit/check', {
      session: 'sx',
      toolUseId: `t${Math.random().toString(36).slice(2, 10)}`,
      tool: 'Edit',
      path: 'ui/C.tsx',
      edit,
      chat: 'cx',
    });

  beforeEach(async () => {
    await ask('cx');
    await post('/_api/agent/run/begin', { session: 'sx', chat: 'cx', actor: 'maude-chat' });
  });

  test('inside an asked element — itself, a child, a new child — is free', async () => {
    expect(await check({ old: '>Alpha<', new: '>Alpha 2<' })).toEqual({ decision: 'none' });
    expect(
      await check({
        old: '<h3 data-cd-id="card-b-t">Beta</h3></div>',
        new: '<h3 data-cd-id="card-b-t">Beta</h3><a href="/b">Read more</a></div>',
      })
    ).toEqual({ decision: 'none' });
  });

  test('a sibling that was not asked, and the lead line, are refused out-of-scope', async () => {
    const sibling = await check({ old: '>Gamma<', new: '>Gamma 2<' });
    expect(sibling.decision).toBe('deny');
    expect(sibling.code).toBe('out-of-scope');
    expect(String(sibling.reason)).toContain('card-c-t');
    expect(String(sibling.reason)).not.toContain('PROMPT-SECRET');
    const lead = await check({ old: '>Sub<', new: '>Sub 2<' });
    expect(lead.code).toBe('out-of-scope');
  });

  test('an ask with no elements keeps the artboard-level rule (the whole artboard is its scope)', async () => {
    await ask('cy', parseRunScope({ canvas: 'ui/C.tsx', artboards: ['pricing'] }));
    await post('/_api/agent/run/begin', { session: 'sy', chat: 'cy', actor: 'maude-chat' });
    const r = await post('/_api/agent/edit/check', {
      session: 'sy',
      toolUseId: 'ty1',
      tool: 'Edit',
      path: 'ui/C.tsx',
      edit: { old: '<p>x</p>', new: '<p>y</p>' },
      chat: 'cy',
    });
    expect(r).toEqual({ decision: 'none' });
  });
});

describe('elementsOutsideScope (pure)', () => {
  const allowed = [
    { artboard: 'hero', element: 'card-a' },
    { artboard: 'hero', element: 'card-b' },
  ];
  test('names the changed elements that are neither asked nor inside one', () => {
    const after = CANVAS.replace('>Gamma<', '>Gamma 2<').replace('>Alpha<', '>Alpha 2<');
    expect(elementsOutsideScope(CANVAS, after, allowed)).toEqual([
      { artboard: 'hero', element: 'card-c-t' },
    ]);
  });
  test('nothing outside when the change is inside; unparseable source asks the artboard rule', () => {
    expect(elementsOutsideScope(CANVAS, CANVAS.replace('>Beta<', '>B<'), allowed)).toEqual([]);
    expect(elementsOutsideScope(CANVAS, 'export default (', allowed)).toEqual([]);
    expect(elementsOutsideScope(null, CANVAS, allowed)).toEqual([]);
  });
});

describe('the offline outbox carries the elements', () => {
  test('a queued ⌘/ ask, released by the drain, asks the registry with the same elements', async () => {
    const asked: Array<{ scope?: { elements?: unknown } | null }> = [];
    const queue = createAskQueue({
      outbox: {} as never,
      gates: () => ({}) as never,
      runs: () =>
        ({
          ask: async (a: (typeof asked)[number]) => {
            asked.push(a);
            return { runId: 'r_x' };
          },
        }) as never,
    });
    const scope = parseRunScope(WIRE);
    const out = await queue.sender({
      id: 'i_1',
      label: 'Ask',
      payload: {
        kind: 'ai.prompt',
        chatId: 'c9',
        text: 't',
        scope,
        attachments: [],
        presentation: 'sent',
      },
    } as never);
    expect(out).toMatchObject({ ok: true });
    expect(asked[0]?.scope?.elements).toEqual(scope?.elements);
  });
});
