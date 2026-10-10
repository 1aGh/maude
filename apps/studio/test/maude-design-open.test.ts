// V2-2.4b — `maude design open <canvas>[#artboard][@element]` (contract V2-1.11 §5.3, §7):
// with an attached shell it shows / selects the target; without one it exits 3.
//
// Three layers, each red before the build: the route (routes/agent.ts), the CLI against a fixture
// studio (Bun.serve with the same RouteSpecs + a /_health naming the root), and the shell's plan
// (client/ui-open.js) — the same registry actions the UI runs.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootIdentity } from '../../../cli/lib/studio-locate.mjs';
import { applyUiOpen, OPEN_LADDER_MS, uiOpenPlan } from '../client/ui-open.js';
import { agentRouteSpecs, isLoopbackHostHeader } from '../routes/agent.ts';
import { mountRoutes } from '../routes/table.ts';

const ROOT = join(import.meta.dir, '..', '..', '..');
const MAUDE = join(ROOT, 'cli', 'bin', 'maude.mjs');

let project: string;
let shells = 1;
const emitted: { event: string; payload: unknown }[] = [];
let server: ReturnType<typeof Bun.serve>;

function deps() {
  return {
    repoRoot: project,
    designRel: '.design',
    shells: () => shells,
    emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
  };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://127.0.0.1:4399/_api/ui/open', {
    method: 'POST',
    headers: { host: '127.0.0.1:4399', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeAll(() => {
  project = realpathSync(mkdtempSync(join(tmpdir(), 'maude-open-')));
  mkdirSync(join(project, '.design', 'ui'), { recursive: true });
  writeFileSync(join(project, '.design', 'config.json'), '{}');
  writeFileSync(join(project, '.design', 'ui', 'Pricing.tsx'), 'export default () => null;\n');
  const { exact } = mountRoutes(agentRouteSpecs(deps()));
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/_health')
        return Response.json({ app: 'design', rootId: rootIdentity(project) });
      const h = exact[url.pathname];
      return h ? h(req) : new Response('not found', { status: 404 });
    },
  });
  writeFileSync(
    join(project, '.design', '_server.json'),
    JSON.stringify({ pid: process.pid, port: server.port, url: `http://127.0.0.1:${server.port}` })
  );
});

afterAll(() => {
  server?.stop(true);
  rmSync(project, { recursive: true, force: true });
});

describe('POST /_api/ui/open (routes/agent.ts)', () => {
  const handle = (req: Request) => {
    const spec = agentRouteSpecs(deps()).find((s) => s.path === '/_api/ui/open');
    if (!spec) throw new Error('no /_api/ui/open spec');
    return spec.handle(req, {});
  };

  test('relays a valid target to the shells as `ui-open`', async () => {
    emitted.length = 0;
    shells = 1;
    const r = await handle(post({ canvas: 'ui/Pricing.tsx', artboard: 'ab', element: 'cta' }));
    expect(r.status).toBe(200);
    expect(emitted).toEqual([
      {
        event: 'ui-open',
        payload: {
          canvas: 'ui/Pricing.tsx',
          file: '.design/ui/Pricing.tsx',
          artboard: 'ab',
          element: 'cta',
        },
      },
    ]);
  });

  test('no shell attached → 409 no-window, nothing emitted', async () => {
    emitted.length = 0;
    shells = 0;
    const r = await handle(post({ canvas: 'ui/Pricing.tsx' }));
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe('no-window');
    expect(emitted).toEqual([]);
    shells = 1;
  });

  test('a missing canvas is 404; traversal, runtime and non-tsx paths are 400', async () => {
    expect((await handle(post({ canvas: 'ui/Nope.tsx' }))).status).toBe(404);
    for (const canvas of [
      '../x.tsx',
      '/etc/x.tsx',
      '_history/x.tsx',
      'ui/.x.tsx',
      'ui/x.json',
      'a\\b.tsx',
    ])
      expect({ canvas, s: (await handle(post({ canvas }))).status }).toEqual({ canvas, s: 400 });
    expect((await handle(post({ canvas: 'ui/Pricing.tsx', artboard: 'a b' }))).status).toBe(400);
    expect((await handle(post({ canvas: 'ui/Pricing.tsx', mode: 'wild' }))).status).toBe(400);
    expect((await handle(post({ canvas: 'ui/Pricing.tsx', extra: 1 }))).status).toBe(400);
    expect(
      (await handle(post({ canvas: 'ui/Pricing.tsx', element: 'x', select: 'all' }))).status
    ).toBe(400);
  });

  test('only a local non-browser client: foreign Host, Origin or Sec-Fetch-Site → 403', async () => {
    for (const h of [
      { host: 'evil.example' },
      { origin: 'http://127.0.0.1:4399' },
      { 'sec-fetch-site': 'same-origin' },
    ])
      expect({ h, s: (await handle(post({ canvas: 'ui/Pricing.tsx' }, h))).status }).toEqual({
        h,
        s: 403,
      });
    expect(isLoopbackHostHeader('[::1]:4399')).toBe(true);
    expect(isLoopbackHostHeader('127.0.0.9')).toBe(true);
    expect(isLoopbackHostHeader('localhost.evil.example')).toBe(false);
  });

  test('GET → 405 through the table; main origin, effect none (readOnly allowed)', async () => {
    const { exact } = mountRoutes(agentRouteSpecs(deps()));
    const get = exact['/_api/ui/open'];
    expect(get).toBeDefined();
    expect(
      (
        await (get as (r: Request) => Promise<Response>)(
          new Request('http://127.0.0.1/_api/ui/open')
        )
      ).status
    ).toBe(405);
    const spec = agentRouteSpecs(deps()).find((s) => s.path === '/_api/ui/open');
    expect(spec?.origin).toBe('main');
    expect(spec?.readOnly).toBe('allowed');
  });
});

describe('`maude design open` (the CLI against a fixture studio)', () => {
  // async: the fixture studio lives in THIS process, so a spawnSync would block its event loop
  const run = async (...a: string[]) => {
    const p = Bun.spawn(['node', MAUDE, 'design', 'open', ...a], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, MAUDE_NO_UPDATE_CHECK: '1', CLAUDE_PROJECT_DIR: '' },
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
      p.exited,
    ]);
    return { status, stdout, stderr };
  };

  test('with an attached shell, X#ab selects ab (exit 0)', async () => {
    emitted.length = 0;
    shells = 1;
    const r = await run('ui/Pricing.tsx#ab', '--root', project);
    expect({ status: r.status, err: r.stderr }).toEqual({ status: 0, err: '' });
    expect(emitted.map((e) => e.payload)).toEqual([
      { canvas: 'ui/Pricing.tsx', file: '.design/ui/Pricing.tsx', artboard: 'ab' },
    ]);
  });

  test('.design/-prefixed and @element@mode forms', async () => {
    emitted.length = 0;
    const r = await run('.design/ui/Pricing.tsx@cta', '--mode', 'present', '--root', project);
    expect(r.status).toBe(0);
    expect(emitted[0]?.payload).toEqual({
      canvas: 'ui/Pricing.tsx',
      file: '.design/ui/Pricing.tsx',
      element: 'cta',
      mode: 'present',
    });
  });

  test('without a shell → exit 3 "No Maude window is showing this project"', async () => {
    shells = 0;
    const r = await run('ui/Pricing.tsx#ab', '--root', project);
    shells = 1;
    expect(r.status).toBe(3);
    expect(r.stderr).toContain('No Maude window is showing this project');
  });

  test('no studio for this root → exit 3; a missing canvas → 1; usage → 2; --help → 0', async () => {
    const lone = realpathSync(mkdtempSync(join(tmpdir(), 'maude-open-none-')));
    mkdirSync(join(lone, '.design', 'ui'), { recursive: true });
    writeFileSync(join(lone, '.design', 'config.json'), '{}');
    // a _server.json pointing at the fixture studio, which serves ANOTHER root: not ours
    writeFileSync(
      join(lone, '.design', '_server.json'),
      JSON.stringify({ pid: process.pid, port: server.port })
    );
    expect((await run('ui/Pricing.tsx', '--root', lone)).status).toBe(3);
    rmSync(lone, { recursive: true, force: true });
    expect((await run('ui/Nope.tsx', '--root', project)).status).toBe(1);
    expect((await run('ui/Pricing.tsx#a b', '--root', project)).status).toBe(2);
    expect((await run('--root', project)).status).toBe(2);
    expect((await run('../outside.tsx', '--root', project)).status).toBe(2);
    expect((await run('--help')).status).toBe(0);
  });
});

describe('the shell side (client/ui-open.js) runs the registry actions', () => {
  test('the plan: artboard → zoom-to-artboard, element → select-by-id, select → select.*', () => {
    expect(
      uiOpenPlan({ file: '.design/ui/P.tsx', artboard: 'ab', element: 'cta', mode: 'present' })
    ).toEqual({
      file: '.design/ui/P.tsx',
      posts: [
        { dgn: 'run-action', v: 1, id: 'view.zoom-to-artboard', params: { id: 'ab' } },
        { dgn: 'select-by-id', id: 'cta', artboardId: 'ab', index: 0 },
      ],
      present: true,
    });
    for (const [select, id] of [
      ['all', 'select.all'],
      ['none', 'select.none'],
      ['annotations', 'select.all-annotations'],
    ])
      expect(uiOpenPlan({ file: 'f', select })?.posts).toEqual([{ dgn: 'run-action', v: 1, id }]);
    expect(uiOpenPlan({ file: 'f', mode: 'edit' })?.present).toBe(false);
    expect(uiOpenPlan({ file: 'f' })?.present).toBe(null);
    expect(uiOpenPlan({ nope: 1 })).toBe(null);
  });

  test('apply: opens the tab, sets present, posts on the ladder to that file’s frame', () => {
    const calls: unknown[] = [];
    const timers: number[] = [];
    const posted: unknown[] = [];
    const frame = { contentWindow: { postMessage: (m: unknown) => posted.push(m) } };
    applyUiOpen(
      { file: '.design/ui/P.tsx', artboard: 'ab', mode: 'present' },
      {
        openTab: (f: string) => calls.push(['openTab', f]),
        setPresent: (on: boolean) => calls.push(['present', on]),
        frameFor: (f: string) => (f === '.design/ui/P.tsx' ? frame : null),
        schedule: (fn: () => void, ms: number) => {
          timers.push(ms);
          fn();
        },
      }
    );
    expect(calls).toEqual([
      ['openTab', '.design/ui/P.tsx'],
      ['present', true],
    ]);
    expect(timers).toEqual(OPEN_LADDER_MS);
    expect(posted.length).toBe(OPEN_LADDER_MS.length);
  });

  test('apply: @element selects in that frame, --select runs select.*, edit turns present off', () => {
    const run = (open: Record<string, unknown>, mounted = true) => {
      const calls: unknown[] = [];
      const posted: unknown[] = [];
      const win = { contentWindow: { postMessage: (m: unknown) => posted.push(m) } };
      const plan = applyUiOpen(open, {
        openTab: (f: string) => calls.push(['openTab', f]),
        setPresent: (on: boolean) => calls.push(['present', on]),
        frameFor: () => (mounted ? win : null),
        schedule: (fn: () => void) => fn(),
      });
      return { plan, calls, posted };
    };
    const sel = run({ file: '.design/ui/P.tsx', artboard: 'ab', element: 'cta', mode: 'edit' });
    expect(sel.calls).toEqual([
      ['openTab', '.design/ui/P.tsx'],
      ['present', false],
    ]);
    // every rung re-posts the same two idempotent messages: zoom to the artboard, then select
    expect(sel.posted.slice(0, 2)).toEqual([
      { dgn: 'run-action', v: 1, id: 'view.zoom-to-artboard', params: { id: 'ab' } },
      { dgn: 'select-by-id', id: 'cta', artboardId: 'ab', index: 0 },
    ]);
    expect(sel.posted.length).toBe(2 * OPEN_LADDER_MS.length);
    const all = run({ file: '.design/ui/P.tsx', select: 'all' });
    expect(all.calls).toEqual([['openTab', '.design/ui/P.tsx']]); // no mode → present untouched
    expect(all.posted[0]).toEqual({ dgn: 'run-action', v: 1, id: 'select.all' });
    // the frame not mounted yet → nothing posted, nothing thrown (the next rung retries)
    expect(run({ file: 'f', element: 'x' }, false).posted).toEqual([]);
    // not a ui-open payload → nothing at all
    const none = run({ nope: 1 });
    expect([none.plan, none.calls, none.posted]).toEqual([null, [], []]);
  });

  test('app.jsx routes the ws `ui-open` frame to applyUiOpen through a ref', () => {
    // The socket handler is installed once (an effect that must not re-subscribe), so the tab
    // opener — which changes with activePath — is read through a ref refreshed every render.
    const app = readFileSync(join(import.meta.dir, '..', 'client', 'app.jsx'), 'utf8');
    const has = (needle: string) => ({ needle, present: app.includes(needle) });
    expect(has("import { applyUiOpen } from './ui-open.js';").present).toBe(true);
    const at = app.indexOf("m.type === 'ui-open'");
    expect(at).toBeGreaterThan(0);
    const arm = app.slice(at, app.indexOf('} else if', at));
    expect(arm.includes('applyUiOpen(m.open, uiOpenRef.current)')).toBe(true);
    expect(has('const uiOpenRef = useRef(null);').present).toBe(true);
    const assign = app.indexOf('uiOpenRef.current = {');
    expect(assign).toBeGreaterThan(app.indexOf('} = useTabs({')); // after openTab exists
    const deps = app.slice(assign, app.indexOf('};', assign));
    for (const k of ['openTab,', 'frameFor:', 'iframesRef.current.get', 'setPresent:'])
      expect({ k, present: deps.includes(k) }).toEqual({ k, present: true });
  });
});
