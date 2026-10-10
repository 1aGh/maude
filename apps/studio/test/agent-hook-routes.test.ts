// V2-2.4b — the hook routes `/_api/agent/*` (contract V2-1.11 §5.4 "Loopback routes") and the run
// registry behind them (agent-runs.ts). The design plugin's hooks call these through
// `maude design hook <event>` (cli/lib/design-hook.mjs; plugins/design/hooks/hooks.test.mjs).
//
// Until V2-1.15 (runs + leases) lands, a run wraps today's beginAiAction/endAiAction through the
// injected bracket, and claims live in this process: "one AI per artboard" (A4) is run vs run.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedArtboards, createAgentRuns } from '../agent-runs.ts';
import { agentRouteSpecs } from '../routes/agent.ts';
import { mountRoutes } from '../routes/table.ts';

const CANVAS = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export const tone = 'warm';
export default function C() {
  return (
    <DesignCanvas>
      <DCArtboard id="hero" width={800} height={600}><h1 data-cd-id="title">Hi</h1></DCArtboard>
      <DCArtboard id="pricing" width={800} height={600}><p>x</p></DCArtboard>
    </DesignCanvas>
  );
}
`;

describe('changedArtboards — which artboards an edit reaches', () => {
  test('an edit inside one artboard names it; module scope reaches the file', () => {
    expect(changedArtboards(CANVAS, CANVAS.replace('<p>x</p>', '<p>y</p>'))).toEqual({
      scope: 'artboards',
      artboards: ['pricing'],
    });
    expect(changedArtboards(CANVAS, CANVAS.replace('Hi', 'Hello'))).toEqual({
      scope: 'artboards',
      artboards: ['hero'],
    });
    expect(changedArtboards(CANVAS, CANVAS.replace("'warm'", "'cool'"))).toEqual({
      scope: 'file',
      artboards: ['hero', 'pricing'],
    });
    // a removed artboard is reached (its span is in `before`)
    const gone = CANVAS.replace(/\n {6}<DCArtboard id="pricing".*<\/DCArtboard>/, '');
    expect(changedArtboards(CANVAS, gone)).toEqual({ scope: 'artboards', artboards: ['pricing'] });
    // a new file reaches every artboard it has
    expect(changedArtboards(null, CANVAS)).toEqual({
      scope: 'new',
      artboards: ['hero', 'pricing'],
    });
    expect(changedArtboards(CANVAS, CANVAS)).toEqual({ scope: 'artboards', artboards: [] });
  });
});

describe('createAgentRuns — the run bracket + claims', () => {
  test('begin is idempotent per session; end releases claims and calls the bracket', () => {
    const calls: string[] = [];
    const runs = createAgentRuns({
      begin: (r) => calls.push(`begin ${r.session}`),
      end: (r, o) => calls.push(`end ${r.session} ${o}`),
    });
    const a = runs.begin({ session: 's1', promptId: 'p1', actor: 'claude-code' });
    expect(runs.begin({ session: 's1', promptId: 'p1', actor: 'claude-code' }).run).toBe(a.run);
    expect(a.run).toMatch(/^r_[0-9a-f]{12}$/);
    runs.claim('s1', 'ui/C.tsx', ['hero']);
    runs.begin({ session: 's2', actor: 'claude-code' });
    expect(runs.conflict('s2', 'ui/C.tsx', ['hero'])?.artboard).toBe('hero');
    expect(runs.conflict('s2', 'ui/C.tsx', ['pricing'])).toBe(null);
    expect(runs.conflict('s1', 'ui/C.tsx', ['hero'])).toBe(null); // its own claim
    runs.end('s1', 'done');
    expect(runs.conflict('s2', 'ui/C.tsx', ['hero'])).toBe(null);
    expect(calls).toEqual(['begin s1', 'begin s2', 'end s1 done']);
    // after end, the next prompt opens a NEW run
    expect(runs.begin({ session: 's1', promptId: 'p2', actor: 'claude-code' }).run).not.toBe(a.run);
  });

  test('a file-scope claim conflicts with every artboard of that canvas, both ways', () => {
    const runs = createAgentRuns();
    runs.begin({ session: 'a', actor: 'claude-code' });
    runs.begin({ session: 'b', actor: 'claude-code' });
    runs.claim('a', 'ui/C.tsx', '*');
    expect(runs.conflict('b', 'ui/C.tsx', ['pricing'])?.artboard).toBe('pricing');
    expect(runs.conflict('b', 'ui/Other.tsx', ['pricing'])).toBe(null);
    runs.end('a', 'done');
    runs.claim('b', 'ui/C.tsx', ['hero']);
    runs.begin({ session: 'a', actor: 'claude-code' });
    expect(runs.conflict('a', 'ui/C.tsx', '*')?.artboard).toBe('hero');
  });
});

describe('POST /_api/agent/* (routes/agent.ts)', () => {
  let project: string;
  let readOnly = false;
  let exact: Record<string, (req: Request) => Response | Promise<Response>>;
  const bracket: string[] = [];

  beforeAll(() => {
    project = realpathSync(mkdtempSync(join(tmpdir(), 'maude-agent-routes-')));
    mkdirSync(join(project, '.design', 'ui'), { recursive: true });
    writeFileSync(join(project, '.design', 'config.json'), '{}');
    writeFileSync(join(project, '.design', 'ui', 'C.tsx'), CANVAS);
    ({ exact } = mountRoutes(
      agentRouteSpecs({
        repoRoot: project,
        designRel: '.design',
        shells: () => 0,
        emit: () => {},
        readOnly: () => readOnly,
        bracket: {
          begin: (r) => bracket.push(`begin ${r.session}`),
          touch: (r, p) => bracket.push(`touch ${r.session} ${p}`),
          end: (r, o) => bracket.push(`end ${r.session} ${o}`),
        },
      })
    ));
  });
  afterAll(() => rmSync(project, { recursive: true, force: true }));

  const post = async (route: string, body: unknown) => {
    const h = exact[route];
    expect({ route, mounted: typeof h }).toEqual({ route, mounted: 'function' });
    const r = await h(
      new Request(`http://127.0.0.1:4399${route}`, {
        method: 'POST',
        headers: { host: '127.0.0.1:4399', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const editHero = { old: 'Hi', new: 'Hello' };

  test('run/begin → a run, idempotent per session + prompt', async () => {
    const a = await post('/_api/agent/run/begin', {
      session: 'sa',
      promptId: 'p1',
      actor: 'claude-code',
    });
    expect(a.status).toBe(200);
    expect(a.body.state).toBe('open');
    const again = await post('/_api/agent/run/begin', {
      session: 'sa',
      promptId: 'p1',
      actor: 'claude-code',
    });
    expect(again.body.run).toBe(a.body.run);
    expect(
      (await post('/_api/agent/run/begin', { session: '../x', actor: 'claude-code' })).status
    ).toBe(400);
    expect((await post('/_api/agent/run/begin', { session: 'sa', actor: 'robot' })).status).toBe(
      400
    );
  });

  test('edit/check: another run on the same artboard → deny artboard-busy; elsewhere → none', async () => {
    const mine = await post('/_api/agent/edit/check', {
      session: 'sa',
      toolUseId: 't1',
      tool: 'Edit',
      path: 'ui/C.tsx',
      edit: editHero,
    });
    expect(mine.body).toEqual({ decision: 'none' });
    await post('/_api/agent/run/begin', { session: 'sb', actor: 'maude-chat' });
    const busy = await post('/_api/agent/edit/check', {
      session: 'sb',
      toolUseId: 't2',
      tool: 'Edit',
      path: 'ui/C.tsx',
      edit: { old: 'Hi', new: 'Hey' },
    });
    expect(busy.body.decision).toBe('deny');
    expect(busy.body.code).toBe('artboard-busy');
    expect(busy.body.artboards).toEqual(['hero']);
    expect(String(busy.body.reason)).toContain('hero');
    const other = await post('/_api/agent/edit/check', {
      session: 'sb',
      toolUseId: 't3',
      tool: 'Edit',
      path: 'ui/C.tsx',
      edit: { old: '<p>x</p>', new: '<p>y</p>' },
    });
    expect(other.body).toEqual({ decision: 'none' });
    // module scope reaches hero too → busy
    const shared = await post('/_api/agent/edit/check', {
      session: 'sb',
      toolUseId: 't4',
      tool: 'Edit',
      path: 'ui/C.tsx',
      edit: { old: "'warm'", new: "'cool'" },
    });
    expect(shared.body.code).toBe('artboard-busy');
  });

  test('edit/check in a read-only session → deny read-only; usage errors are 400', async () => {
    readOnly = true;
    try {
      const r = await post('/_api/agent/edit/check', {
        session: 'sa',
        toolUseId: 't5',
        tool: 'Write',
        path: 'ui/New.tsx',
        edit: { content: CANVAS },
      });
      expect(r.body.decision).toBe('deny');
      expect(r.body.code).toBe('read-only');
    } finally {
      readOnly = false;
    }
    for (const bad of [
      { session: 'sa', toolUseId: 't6', tool: 'Edit', path: '../escape.tsx' },
      { session: 'sa', toolUseId: 'a/b', tool: 'Edit', path: 'ui/C.tsx' },
      { session: 'sa', toolUseId: 't7', tool: 'Bash', path: 'ui/C.tsx' },
    ])
      expect((await post('/_api/agent/edit/check', bad)).status).toBe(400);
  });

  test('check: the warm validator answers ok / errors for a designRoot file', async () => {
    expect(
      (await post('/_api/agent/check', { path: 'ui/C.tsx', tier: 'fast', strict: true })).body
    ).toEqual({
      ok: true,
    });
    writeFileSync(
      join(project, '.design', 'ui', 'Bad.tsx'),
      CANVAS.replace('id="pricing"', 'id="hero"')
    );
    const bad = await post('/_api/agent/check', { path: 'ui/Bad.tsx', tier: 'fast', strict: true });
    expect(bad.body.ok).toBe(false);
    const errors = bad.body.errors as { code: string; where: string; what: string; fix: string }[];
    expect(errors.map((e) => e.code)).toEqual(['artboard-duplicate']);
    expect(Object.keys(errors[0]).sort()).toEqual(['code', 'fix', 'what', 'where']);
    // the snapshot is a designRoot path under _runs/ — anything else is refused
    expect(
      (
        await post('/_api/agent/check', {
          path: 'ui/C.tsx',
          tier: 'fast',
          strict: true,
          snapshot: 'ui/C.tsx',
        })
      ).status
    ).toBe(400);
  });

  test('edit/touched maps the change to artboards + lost ids from the pre-edit snapshot', async () => {
    const snapDir = join(project, '.design', '_runs', 'sa', 'snap');
    mkdirSync(snapDir, { recursive: true });
    writeFileSync(join(snapDir, 't8'), CANVAS);
    writeFileSync(
      join(project, '.design', 'ui', 'C.tsx'),
      CANVAS.replace('<h1 data-cd-id="title">Hi</h1>', '<h1>Hello</h1>')
    );
    const r = await post('/_api/agent/edit/touched', {
      session: 'sa',
      toolUseId: 't8',
      path: 'ui/C.tsx',
      via: 'tool',
    });
    expect(r.body).toEqual({ artboards: ['hero'], lostIds: ['title'], trashed: [] });
    expect(bracket).toContain('touch sa ui/C.tsx');
  });

  test('edit/touched {via:bash} binds the files a write verb changed since `since` to the run', async () => {
    const snapDir = join(project, '.design', '_runs', 'sa', 'snap');
    const bashDir = join(project, '.design', '_runs', 'sa', 'bash');
    mkdirSync(bashDir, { recursive: true });
    const before = CANVAS.replace('<h1 data-cd-id="title">Hi</h1>', '<h1>Hello</h1>');
    writeFileSync(join(snapDir, 'v1.abc'), before);
    await Bun.sleep(5); // every earlier write is outside the window
    const since = Date.now();
    writeFileSync(
      join(bashDir, 'v1.json'),
      JSON.stringify({ at: since, snaps: { 'ui/C.tsx': 'v1.abc' } })
    );
    writeFileSync(join(project, '.design', 'ui', 'C.tsx'), before.replace('<p>x</p>', '<p>v</p>'));
    bracket.length = 0;
    const r = await post('/_api/agent/edit/touched', {
      session: 'sa',
      toolUseId: 'v1',
      via: 'bash',
      since,
    });
    expect(r.body).toEqual({ artboards: ['pricing'], lostIds: [], trashed: [] });
    expect(bracket).toEqual(['touch sa ui/C.tsx']);
    // two runs open and an unknown session → reported, bound to none
    bracket.length = 0;
    const loose = await post('/_api/agent/edit/touched', {
      session: 'sz',
      toolUseId: 'v2',
      via: 'bash',
      since,
    });
    expect(loose.body.artboards).toEqual(['hero', 'pricing']);
    expect(bracket).toEqual([]);
    // a window older than BASH_WINDOW_MS (or missing / in the future) binds nothing
    for (const bad of [0, Date.now() + 60_000, undefined, 'x']) {
      const z = await post('/_api/agent/edit/touched', {
        session: 'sa',
        toolUseId: 'v3',
        via: 'bash',
        since: bad,
      });
      expect(z.body).toEqual({ artboards: [], lostIds: [], trashed: [] });
    }
    expect(bracket).toEqual([]);
  });

  test('edit/check: an edit that changes a locked element → deny soft-locked (A10, V2-2.19)', async () => {
    const locked = CANVAS.replace('<p>x</p>', '<p data-cd-id="lead" data-cd-locked>x</p>');
    writeFileSync(join(project, '.design', 'ui', 'L.tsx'), locked);
    const r = await post('/_api/agent/edit/check', {
      session: 'sl',
      toolUseId: 'l1',
      tool: 'Edit',
      path: 'ui/L.tsx',
      edit: { old: 'data-cd-locked>x</p>', new: 'data-cd-locked>changed</p>' },
    });
    expect(r.body.decision).toBe('deny');
    expect(r.body.code).toBe('soft-locked');
    expect(r.body.artboards).toEqual(['pricing']);
    expect(String(r.body.reason)).toMatch(/^soft-locked: .*lead/);
    // removing the lock is the same refusal; an edit elsewhere is fine
    const unlock = await post('/_api/agent/edit/check', {
      session: 'sl',
      toolUseId: 'l2',
      tool: 'Edit',
      path: 'ui/L.tsx',
      edit: { old: ' data-cd-locked>', new: '>' },
    });
    expect(unlock.body.code).toBe('soft-locked');
    const free = await post('/_api/agent/edit/check', {
      session: 'sl',
      toolUseId: 'l3',
      tool: 'Edit',
      path: 'ui/L.tsx',
      edit: { old: '>Hi<', new: '>Hey<' },
    });
    expect(free.body).toEqual({ decision: 'none' });
    await post('/_api/agent/run/end', { session: 'sl', outcome: 'done' });
  });

  test('edit/check: a selection-scoped run (⌘/, G-AI-6) outside its scope → deny out-of-scope', async () => {
    writeFileSync(join(project, '.design', 'ui', 'S.tsx'), CANVAS);
    const begun = await post('/_api/agent/run/begin', {
      session: 'sq',
      actor: 'maude-chat',
      scope: { canvas: 'ui/S.tsx', artboards: ['hero'] },
    });
    expect(begun.status).toBe(200);
    const ask = (toolUseId: string, path: string, edit: unknown) =>
      post('/_api/agent/edit/check', { session: 'sq', toolUseId, tool: 'Edit', path, edit });
    const inside = await ask('q1', 'ui/S.tsx', { old: 'Hi', new: 'Hello' });
    expect(inside.body).toEqual({ decision: 'none' });
    const other = await ask('q2', 'ui/S.tsx', { old: '<p>x</p>', new: '<p>y</p>' });
    expect(other.body.code).toBe('out-of-scope');
    expect(other.body.artboards).toEqual(['pricing']);
    expect(String(other.body.reason)).toMatch(/^out-of-scope: .*hero/);
    const shared = await ask('q3', 'ui/S.tsx', { old: "'warm'", new: "'cool'" });
    expect(shared.body.code).toBe('out-of-scope');
    const elsewhere = await ask('q4', 'ui/L.tsx', { old: '>Hi<', new: '>Yo<' });
    expect(elsewhere.body.code).toBe('out-of-scope');
    // a bad scope is a usage error
    for (const scope of [
      { canvas: '../x.tsx' },
      { canvas: 'ui/S.tsx', artboards: ['a b'] },
      'ui/S.tsx',
    ])
      expect(
        (await post('/_api/agent/run/begin', { session: 'sr', actor: 'maude-chat', scope })).status
      ).toBe(400);
    await post('/_api/agent/run/end', { session: 'sq', outcome: 'done' });
  });

  test('edit/touched parks an artboard the edit removed in the trash, with its position (C17)', async () => {
    writeFileSync(join(project, '.design', 'ui', 'T.tsx'), CANVAS);
    writeFileSync(
      join(project, '.design', 'ui', 'T.meta.json'),
      JSON.stringify({ layout: { artboards: [{ id: 'pricing', x: 900, y: 40 }] } })
    );
    const snapDir = join(project, '.design', '_runs', 'sa', 'snap');
    mkdirSync(snapDir, { recursive: true });
    writeFileSync(join(snapDir, 'k1'), CANVAS);
    const gone = CANVAS.replace(/\n {6}<DCArtboard id="pricing".*<\/DCArtboard>/, '');
    writeFileSync(join(project, '.design', 'ui', 'T.tsx'), gone);
    const r = await post('/_api/agent/edit/touched', {
      session: 'sa',
      toolUseId: 'k1',
      path: 'ui/T.tsx',
      via: 'tool',
    });
    expect(r.body).toEqual({ artboards: ['pricing'], lostIds: [], trashed: ['pricing'] });
    const trash = join(project, '.design', '_trash');
    const dir = readdirSync(trash).find((d) => d.endsWith('__ui__T__pricing'));
    expect(dir).toBeTruthy();
    const manifest = JSON.parse(
      readFileSync(join(trash, String(dir), '_trash-manifest.json'), 'utf8')
    );
    expect(manifest).toMatchObject({
      kind: 'artboard',
      canvas: 'ui/T.tsx',
      artboard: 'pricing',
      position: { x: 900, y: 40 },
      by: 'ai',
    });
    expect(readFileSync(join(trash, String(dir), 'pricing.artboard.tsx'), 'utf8')).toBe(
      '<DCArtboard id="pricing" width={800} height={600}><p>x</p></DCArtboard>'
    );
  });

  test('run/end closes the run and releases its claims', async () => {
    const r = await post('/_api/agent/run/end', { session: 'sa', outcome: 'done' });
    expect(r.status).toBe(200);
    expect(bracket).toContain('end sa done');
    const free = await post('/_api/agent/edit/check', {
      session: 'sb',
      toolUseId: 't9',
      tool: 'Edit',
      path: 'ui/C.tsx',
      edit: { old: 'Hello', new: 'Hey' },
    });
    expect(free.body).toEqual({ decision: 'none' });
    expect((await post('/_api/agent/run/end', { session: 'sb', outcome: 'nope' })).status).toBe(
      400
    );
  });
});
