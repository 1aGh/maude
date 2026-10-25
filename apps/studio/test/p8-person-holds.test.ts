// p8-fixups1 — `deps.personHolds` is WIRED (V2-1.15 §4 #13). routes/agent.ts denies an AI write that
// reaches an element a person holds, but only when it is handed the holds; http.ts never passed
// them, so the shipped build never refused (found by the V2-8.16b eval port). These tests drive the
// real path: a canvas room's awareness `holding` → collab/holds.ts → the hook route's verdict.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAgentRuns } from '../agent-runs.ts';
import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry, type RunRegistry } from '../ai/runs.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import { HOLD_FREE_MS, liveHoldElement, personHoldsOf } from '../collab/holds.ts';
import { createRegistry, type Registry } from '../collab/registry.ts';
import { agentRouteSpecs } from '../routes/agent.ts';
import { mountRoutes } from '../routes/table.ts';
import { sanitizeHoldingState } from '../use-collab.tsx';

const CANVAS = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function C() {
  return (
    <DesignCanvas>
      <DCArtboard id="hero" width={800} height={600}><h1 data-cd-id="title">Hi</h1><p data-cd-id="lead">Sub</p></DCArtboard>
    </DesignCanvas>
  );
}
`;

let project: string;
let reg: RunRegistry;
let collab: Registry;
let exact: Record<string, (req: Request) => Response | Promise<Response>>;
let clock = 1_000_000;

const slugOf = (rel: string) => canvasSlugFromRel(rel, '.design');
const hold = (element: string, at = clock) => ({ artboard: 'hero', element, at });
/** a person's tab: a client joins the canvas room and publishes its awareness */
function person(rel: string, name: string, holding: unknown) {
  const room = collab.get(slugOf(rel));
  room.awareness.setLocalState({ name, holding });
}

beforeEach(() => {
  clock = 1_000_000;
  project = realpathSync(mkdtempSync(join(tmpdir(), 'maude-p8holds-')));
  mkdirSync(join(project, '.design', 'ui'), { recursive: true });
  writeFileSync(join(project, '.design', 'config.json'), '{}');
  writeFileSync(join(project, '.design', 'ui', 'C.tsx'), CANVAS);
  reg = createRunRegistry({
    designRoot: null,
    designRel: '.design',
    home: createLocalLeaseHome({ actor: 'you' }),
    autoRenew: false,
    artboardsOf: () => ['hero'],
  });
  collab = createRegistry({
    async seed() {},
    async persistJson() {},
    async persistBinary() {},
  });
  ({ exact } = mountRoutes(
    agentRouteSpecs({
      repoRoot: project,
      designRel: '.design',
      shells: () => 0,
      emit: () => {},
      runs: createAgentRuns({}, undefined, reg),
      personHolds: personHoldsOf(collab, slugOf, () => clock),
    })
  ));
});
afterEach(async () => {
  reg.close();
  await collab.destroyAll();
  rmSync(project, { recursive: true, force: true });
});

async function check(edit: { old: string; new: string }) {
  const route = '/_api/agent/edit/check';
  const r = await exact[route](
    new Request(`http://127.0.0.1:4399${route}`, {
      method: 'POST',
      headers: { host: '127.0.0.1:4399', 'content-type': 'application/json' },
      body: JSON.stringify({
        session: 's1',
        toolUseId: `t${Math.random().toString(36).slice(2, 10)}`,
        tool: 'Edit',
        path: 'ui/C.tsx',
        edit,
      }),
    })
  );
  return (await r.json()) as Record<string, unknown>;
}
const TITLE = { old: '>Hi<', new: '>Hello<' };
const LEAD = { old: '>Sub<', new: '>Subtitle<' };

describe('a person’s live hold denies the AI’s write (V2-1.15 §4 #13)', () => {
  test('holding the title: an edit of the title is soft-locked, naming the person; the lead is free', async () => {
    person('ui/C.tsx', 'Tereza', hold('title'));
    const r = await check(TITLE);
    expect(r.decision).toBe('deny');
    expect(r.code).toBe('soft-locked');
    expect(String(r.reason)).toContain('Tereza is editing title');
    expect(await check(LEAD)).toEqual({ decision: 'none' });
  });

  test('nobody holding → allow', async () => {
    person('ui/C.tsx', 'Tereza', null);
    expect(await check(TITLE)).toEqual({ decision: 'none' });
  });

  test('no live room for the canvas → allow', async () => {
    expect(await check(TITLE)).toEqual({ decision: 'none' });
  });

  test('a hold on ANOTHER canvas does not lock this one', async () => {
    person('ui/Other.tsx', 'Tereza', hold('title'));
    expect(await check(TITLE)).toEqual({ decision: 'none' });
  });

  test('a hold nobody refreshed for 30 s is free', async () => {
    person('ui/C.tsx', 'Tereza', hold('title', clock - HOLD_FREE_MS - 1));
    expect(await check(TITLE)).toEqual({ decision: 'none' });
    person('ui/C.tsx', 'Tereza', hold('title', clock - HOLD_FREE_MS + 1000));
    expect((await check(TITLE)).code).toBe('soft-locked');
  });

  test('the wiring: http.ts hands the registry’s holds to the agent routes', () => {
    const http = readFileSync(join(import.meta.dir, '..', 'http.ts'), 'utf8');
    const server = readFileSync(join(import.meta.dir, '..', 'server.ts'), 'utf8');
    expect(http).toMatch(/personHolds: opts\.personHolds/);
    expect(server).toMatch(/personHolds: .*personHoldsOf\(/);
  });
});

describe('collab/holds.ts reads a hold exactly as the receiver’s sanitizer does', () => {
  const fixtures: unknown[] = [
    hold('title'),
    { ...hold('title'), print: 'x'.repeat(10) },
    { ...hold('title'), print: 'x'.repeat(600) },
    { ...hold('title'), actor: 'a@b.c' },
    { ...hold('title'), extra: 1 },
    { ...hold('Title') },
    { ...hold('a b') },
    { ...hold('a'.repeat(60)) },
    { ...hold('0123abcd') },
    { artboard: '', element: 'title', at: clock },
    { artboard: 'hero', element: 'title', at: clock + 6000 },
    { artboard: 'hero', element: 'title', at: -1 },
    { artboard: 'hero', element: 'title', at: Number.NaN },
    { artboard: 'hero', element: 3, at: clock },
    null,
    'title',
    [],
  ];
  test('same accept/reject verdict and the same element on every fixture', () => {
    for (const f of fixtures) {
      const theirs = sanitizeHoldingState(f, clock);
      expect({ f, el: liveHoldElement(f, clock) }).toEqual({ f, el: theirs?.element ?? null });
    }
  });
});
