// S9.17b — the 409 browser door, studio side. A Can view account gets `409 {reason:'browser-door', url}`
// from a mint door (access/scope.ts `peerTokenDoor`): no peer token, no local copy. The studio declares
// `X-Maude-Access: 2` on every mint door it calls for a managed open, relays a VALIDATED cell front door
// (the same shape rules as Rust `cell_door`) and nothing else; the page hands it to `open_cell_tab`
// (Home names its profile, a project tab doesn't) and falls back to the browser when cell tabs are
// unavailable. A hostile `url` never reaches `invoke`.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  browserDoorOf,
  CELL_TABS_UNSUPPORTED,
  cellDoorUrl,
  openBrowserDoor,
} from '../client/v2/cloud/browser-door.js';
import { createCloudEndpoints } from '../cloud/endpoints.ts';
import { prepareManagedProject } from '../managed-projects.ts';

const GOOD = 'https://alligators.cloud.maude.sh/c/ui/Poster.tsx';

// Rust windows.rs `cell_door_takes_only_a_cell_front_door`, plus the brief's list.
const HOSTILE = [
  'http://alligators.cloud.maude.sh/',
  'https://alligators.cloud.maude.sh:8443/',
  'https://evil.example/',
  'https://evilcloud.maude.sh/',
  'https://cloud.maude.sh.attacker.com/',
  'https://cloud.maude.sh/',
  'https://canvas.cloud.maude.sh/alligators/x',
  'https://view-alligators.cloud.maude.sh/',
  'https://canvas-x.cloud.maude.sh/',
  'https://a.b.cloud.maude.sh/',
  'https://Alli_gators.cloud.maude.sh/',
  'https://u:p@alligators.cloud.maude.sh/',
  'https://u@alligators.cloud.maude.sh/',
  'https://alligators.cloud.maude.sh/?next=https://evil.example',
  'https://alligators.cloud.maude.sh/?',
  'https://alligators.cloud.maude.sh/#x',
  'https://alligators.cloud.maude.sh/admin',
  'https://alligators.cloud.maude.sh/c/',
  'https://alligators.cloud.maude.sh/c/../secret',
  'https://alligators.cloud.maude.sh/c/ui%2F..%2Fsecret',
  'https://alligators.cloud.maude.sh/c/ui%5Cx.tsx',
  'https://alligators.cloud.maude.sh/c/ui/%ZZ',
  'https://alligators.cloud.maude.sh/c/C:/x.tsx',
  'https://alligators.cloud.maude.sh/\\evil',
  'https://alligators.cloud.maude.sh/ c',
  'javascript:alert(1)',
  'javascript://alligators.cloud.maude.sh/%0aalert(1)',
  'https://127.0.0.1/',
  'https://localhost/',
  '',
  `https://alligators.cloud.maude.sh/c/${'a'.repeat(2100)}`,
];
const NOT_STRINGS = [null, undefined, 42, {}, ['https://alligators.cloud.maude.sh/']];

describe('cellDoorUrl — the Rust cell_door shape, rebuilt from its parts', () => {
  test('a cell front door and one canvas on it pass', () => {
    expect(cellDoorUrl('https://alligators.cloud.maude.sh')).toBe(
      'https://alligators.cloud.maude.sh/'
    );
    expect(cellDoorUrl('https://alligators.cloud.maude.sh/')).toBe(
      'https://alligators.cloud.maude.sh/'
    );
    expect(cellDoorUrl('https://alligators.cloud.maude.sh/c/ui/A%20B.tsx')).toBe(
      'https://alligators.cloud.maude.sh/c/ui/A%20B.tsx'
    );
    expect(cellDoorUrl(GOOD)).toBe(GOOD);
    expect(cellDoorUrl('https://e2e-cell.cloud.maude.sh/c/.design/ui/x.tsx')).toBe(
      'https://e2e-cell.cloud.maude.sh/c/ui/x.tsx'
    );
  });
  test('everything else is refused', () => {
    for (const bad of [...HOSTILE, ...NOT_STRINGS]) {
      expect({ bad, got: cellDoorUrl(bad as string) }).toEqual({ bad, got: null });
    }
  });
  test('browserDoorOf reads only a browser-door answer with a valid door', () => {
    expect(browserDoorOf({ ok: false, reason: 'browser-door', url: GOOD })).toEqual({ url: GOOD });
    expect(browserDoorOf({ ok: false, reason: 'server-update', url: GOOD })).toBeNull();
    expect(
      browserDoorOf({ ok: false, reason: 'browser-door', url: 'https://evil.example/' })
    ).toBeNull();
    expect(browserDoorOf(null)).toBeNull();
  });
});

// ── the studio's mint-door calls (cloud/endpoints.ts) ────────────────────────
type Seen = { path: string; access: string | null };
let stub: ReturnType<typeof Bun.serve> | null = null;
let scratch = '';
let seen: Seen[] = [];
/** per-test answers: path → [status, body] */
let answers: Record<string, [number, unknown]> = {};

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'maude-browser-door-'));
  stub = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (req) => {
      const url = new URL(req.url);
      seen.push({ path: url.pathname, access: req.headers.get('x-maude-access') });
      const a = answers[url.pathname];
      return Response.json(a ? a[1] : { error: 'not stubbed' }, { status: a ? a[0] : 404 });
    },
  });
  process.env.MAUDE_CLOUD_URL = `http://127.0.0.1:${stub.port}`;
  process.env.MAUDE_CLOUD_CONFIG = join(scratch, 'cloud.json');
  process.env.HUBS_CONFIG_PATH = join(scratch, 'hubs.json');
  writeFileSync(
    join(scratch, 'cloud.json'),
    JSON.stringify({ url: `http://127.0.0.1:${stub.port}`, token: 'mpt_device' })
  );
});
afterAll(() => {
  stub?.stop(true);
  rmSync(scratch, { recursive: true, force: true });
  delete process.env.MAUDE_CLOUD_URL;
  delete process.env.MAUDE_CLOUD_CONFIG;
  delete process.env.HUBS_CONFIG_PATH;
});
beforeEach(() => {
  seen = [];
  answers = {};
});

const cloud = () => createCloudEndpoints({ paths: { repoRoot: '', designRoot: '' } });
const door = (url: unknown): [number, unknown] => [409, { reason: 'browser-door', url }];
const CODE = `mhc_${'b'.repeat(64)}`;

describe('mint doors declare X-Maude-Access: 2 and relay only a valid browser door', () => {
  test('/projects/open: the header is sent; a 409 browser-door comes back as {reason, url}', async () => {
    answers['/projects/open'] = door(GOOD);
    const r = await cloud().openManaged('alligators');
    expect(seen).toEqual([{ path: '/projects/open', access: '2' }]);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ ok: false, reason: 'browser-door', url: GOOD });
  });

  test('/auth/handoff/exchange: the header is sent; a 409 browser-door is relayed', async () => {
    answers['/auth/handoff/exchange'] = door('https://alligators.cloud.maude.sh');
    const r = await cloud().openManagedCode(CODE, 'alligators');
    expect(seen).toEqual([{ path: '/auth/handoff/exchange', access: '2' }]);
    expect(r.json).toMatchObject({
      reason: 'browser-door',
      url: 'https://alligators.cloud.maude.sh/',
    });
  });

  test('exchangeCredential (the cell /auth/login): the header is sent; a 409 browser-door is relayed', async () => {
    answers['/projects/open'] = [
      200,
      { token: 'm2.x.y', role: 'observer', url: `http://127.0.0.1:${stub?.port}` },
    ];
    answers['/auth/login'] = door(GOOD);
    const r = await cloud().openManaged('alligators');
    expect(seen).toEqual([
      { path: '/projects/open', access: '2' },
      { path: '/auth/login', access: '2' },
    ]);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ ok: false, reason: 'browser-door', url: GOOD });
  });

  test('a hostile door url gets the existing error words, never a url', async () => {
    for (const bad of [...HOSTILE, ...NOT_STRINGS]) {
      answers = { '/projects/open': door(bad), '/auth/handoff/exchange': door(bad) };
      const a = (await cloud().openManaged('alligators')).json as Record<string, unknown>;
      expect({ bad, a }).toEqual({
        bad,
        a: { ok: false, error: 'The project could not be opened with this account.' },
      });
      const b = (await cloud().openManagedCode(CODE)).json as Record<string, unknown>;
      expect(b.reason).toBeUndefined();
      expect(b.url).toBeUndefined();
      expect(String(b.error)).toContain('That link expired');
    }
    answers = {
      '/projects/open': [200, { token: 'm2.x.y', url: `http://127.0.0.1:${stub?.port}` }],
      '/auth/login': door('https://evil.example/'),
    };
    expect((await cloud().openManaged('alligators')).json).toEqual({
      ok: false,
      error: 'The workspace did not accept the sign-in. Try again in a minute.',
    });
  });

  test('a door naming another project than the one opened is no door', async () => {
    answers['/projects/open'] = door('https://other.cloud.maude.sh/');
    expect((await cloud().openManaged('alligators')).json).toEqual({
      ok: false,
      error: 'The project could not be opened with this account.',
    });
    answers['/auth/handoff/exchange'] = door('https://other.cloud.maude.sh/');
    expect(
      ((await cloud().openManagedCode(CODE, 'alligators')).json as { reason?: string }).reason
    ).toBeUndefined();
  });

  test('another 409 (the cell needs an update) is not a browser door', async () => {
    answers['/projects/open'] = [409, { reason: 'server-update', url: GOOD }];
    expect((await cloud().openManaged('alligators')).json).toEqual({
      ok: false,
      error: 'The project could not be opened with this account.',
    });
  });

  test('prepareManagedProject carries the browser door to the page', async () => {
    answers['/projects/open'] = door(GOOD);
    const r = await prepareManagedProject({}, { kind: 'cloud', projectId: 'alligators' });
    expect(r).toMatchObject({ ok: false, status: 409, reason: 'browser-door', url: GOOD });
  });
});

// ── the page side: openBrowserDoor (Home + a project tab) ─────────────────────
function fakeShell(fail?: (cmd: string) => unknown) {
  const calls: Array<{ cmd: string; args: unknown }> = [];
  const opened: string[] = [];
  return {
    calls,
    opened,
    deps: {
      invoke: async (cmd: string, args: unknown) => {
        calls.push({ cmd, args });
        const e = fail?.(cmd);
        if (e) throw e;
        return { label: 'c-0123456789abcdef', opened: 'new' };
      },
      openInBrowser: (url: string) => {
        opened.push(url);
      },
    },
  };
}

describe('openBrowserDoor — the page relays a door to open_cell_tab', () => {
  test('Home passes its profile', async () => {
    const s = fakeShell();
    expect(await openBrowserDoor({ url: GOOD, profile: 'work' }, s.deps)).toEqual({
      ok: true,
      via: 'tab',
    });
    expect(s.calls).toEqual([{ cmd: 'open_cell_tab', args: { url: GOOD, profile: 'work' } }]);
  });

  test('a project tab names no profile', async () => {
    const s = fakeShell();
    await openBrowserDoor({ url: GOOD }, s.deps);
    expect(s.calls).toEqual([{ cmd: 'open_cell_tab', args: { url: GOOD } }]);
  });

  test('a hostile url never reaches invoke (nor the browser)', async () => {
    for (const bad of [...HOSTILE, ...NOT_STRINGS]) {
      const s = fakeShell();
      const r = await openBrowserDoor({ url: bad as string, profile: 'work' }, s.deps);
      expect({ bad, ok: r.ok, calls: s.calls, opened: s.opened }).toEqual({
        bad,
        ok: false,
        calls: [],
        opened: [],
      });
    }
  });

  test('no cell tabs here (macOS < 14 / not a Mac) → open_cloud_url with the origin only', async () => {
    const s = fakeShell((cmd) => (cmd === 'open_cell_tab' ? CELL_TABS_UNSUPPORTED : null));
    expect(await openBrowserDoor({ url: GOOD, profile: 'work' }, s.deps)).toEqual({
      ok: true,
      via: 'browser',
    });
    expect(s.calls).toEqual([
      { cmd: 'open_cell_tab', args: { url: GOOD, profile: 'work' } },
      { cmd: 'open_cloud_url', args: { url: 'https://alligators.cloud.maude.sh' } },
    ]);
  });

  test('any other refusal is not a fallback: it is reported, the browser stays shut', async () => {
    const s = fakeShell((cmd) =>
      cmd === 'open_cell_tab' ? "That isn't a Maude Cloud project address." : null
    );
    const r = await openBrowserDoor({ url: GOOD }, s.deps);
    expect(r).toEqual({ ok: false, error: "That isn't a Maude Cloud project address." });
    expect(s.calls.map((c) => c.cmd)).toEqual(['open_cell_tab']);
  });

  test('the browser shell (no Tauri) opens the door in the browser, as today', async () => {
    const s = fakeShell();
    const r = await openBrowserDoor(
      { url: GOOD },
      { invoke: null, openInBrowser: s.deps.openInBrowser }
    );
    expect(r).toEqual({ ok: true, via: 'browser' });
    expect(s.opened).toEqual([GOOD]);
  });
});

// ── a project tab: github.js openTeamProject relays the prepare's door ────────
describe('openTeamProject (a project tab) — open_cell_tab({url}), no profile', () => {
  test('a browser-door prepare answer opens a cell tab; managed_project_open is never called', async () => {
    const { openTeamProject } = await import('../client/github.js');
    const calls: Array<{ cmd: string; args: unknown }> = [];
    const g = globalThis as unknown as Record<string, unknown>;
    const prevWindow = g.window;
    const prevFetch = globalThis.fetch;
    g.window = {
      __TAURI__: {
        core: {
          invoke: async (cmd: string, args: unknown) => {
            calls.push({ cmd, args });
            return { label: 'c-0123456789abcdef', opened: 'new' };
          },
        },
      },
    };
    let body: unknown = { ok: false, status: 409, reason: 'browser-door', url: GOOD, error: 'x' };
    globalThis.fetch = (async () =>
      Response.json(body, { status: 409 })) as unknown as typeof fetch;
    try {
      const r = await openTeamProject({ kind: 'cloud', projectId: 'alligators' });
      expect(r).toMatchObject({ ok: true, via: 'tab' });
      expect(calls).toEqual([{ cmd: 'open_cell_tab', args: { url: GOOD } }]);

      calls.length = 0;
      body = {
        ok: false,
        status: 409,
        reason: 'browser-door',
        url: 'https://evil.example/',
        error: 'x',
      };
      const bad = await openTeamProject({ kind: 'cloud', projectId: 'alligators' });
      expect(bad.ok).toBe(false);
      expect(calls).toEqual([]);
    } finally {
      g.window = prevWindow;
      globalThis.fetch = prevFetch;
    }
  });
});
