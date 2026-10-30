// S11.12 — Keep both for a FILE-level held source conflict (06 ad-syncd; contract S11 Q7).
//
// Theirs becomes the canvas; this Mac's version is written as "<name> this Mac" (fresh slug, meta
// re-keyed) and kept aside in the original's history. Two halves:
//
//   1. The orchestration (sync/keep-both.ts) against fakes — the ORDER (copy first, take only while
//      the disk still holds what the copy holds) and BOTH races: an edit on this Mac landing mid-
//      resolution (desktop wins: the copy follows it, nothing is written over) and a newer project
//      version landing mid-resolution (cloud wins: that is what is taken; the copy keeps mine).
//   2. Two studio runtimes on a REAL hub (like sync-accepted-runtime.test.ts): the copy joins the
//      project as ONE action (plus the aside, which moves no head), reaches the peer, and both
//      canvases keep syncing in both directions afterwards. The runtime's `ifMine` guard refuses a
//      take whose disk moved.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApi } from '../api.ts';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import { type Context, createBus } from '../context.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';
import {
  createKeepBothResolver,
  KEEP_BOTH_ASIDE_LABEL,
  type KeepBothCopy,
  type KeepBothDeps,
  keepBoth,
} from '../sync/keep-both.ts';
import { makeSandbox } from './_helpers.ts';

// ── 1 · orchestration, against fakes ─────────────────────────────────────────────────────────────

function fakeWorld(o: { mine: string | null; theirs: string }) {
  const log: string[] = [];
  const state = { disk: o.mine, accepted: o.theirs, held: true, copy: null as string | null };
  const asides: string[] = [];
  const hooks = { afterCopy: () => {}, beforeTake: () => {} };
  const copy: KeepBothCopy = {
    file: 'design/ui/a this Mac.tsx',
    rel: 'ui/a this Mac.tsx',
    slug: 'ui-a_this_mac',
  };
  const deps: KeepBothDeps = {
    sides: () => (state.held ? { mine: state.disk, theirs: state.accepted } : null),
    makeCopy: async (source) => {
      log.push('copy');
      state.copy = source;
      hooks.afterCopy();
      return { ok: true, copy };
    },
    rewriteCopy: async (_c, source) => {
      log.push('rewrite');
      state.copy = source;
    },
    takeTheirs: async (ifMine) => {
      hooks.beforeTake();
      if (!state.held) return null;
      // the runtime's synchronous check-and-take
      if (state.disk !== ifMine) return { status: 'rejected', code: 'changed' };
      log.push('take');
      state.disk = state.accepted;
      state.held = false;
      return { status: 'taken' };
    },
    aside: async (content) => {
      log.push('aside');
      asides.push(content);
      return { status: 'accepted' };
    },
  };
  return { deps, state, log, asides, hooks, copy };
}

describe('keepBoth — the order and the races (sync/keep-both.ts)', () => {
  test('copy first, then theirs, then the aside; both versions survive', async () => {
    const w = fakeWorld({ mine: 'MINE', theirs: 'THEIRS' });
    const r = await keepBoth(w.deps);
    expect(r).toEqual({ status: 'kept-both', copy: w.copy, aside: 'kept' });
    expect(w.log).toEqual(['copy', 'take', 'aside']);
    expect(w.state.copy).toBe('MINE');
    expect(w.state.disk).toBe('THEIRS');
    expect(w.asides).toEqual(['MINE']);
  });

  test('desktop wins the race: an edit lands after the copy — the copy follows it, nothing is written over', async () => {
    const w = fakeWorld({ mine: 'MINE', theirs: 'THEIRS' });
    let once = true;
    w.hooks.beforeTake = () => {
      if (once) w.state.disk = 'MINE, edited a moment later';
      once = false;
    };
    const r = await keepBoth(w.deps);
    expect(r.status).toBe('kept-both');
    expect(w.log).toEqual(['copy', 'rewrite', 'take', 'aside']);
    expect(w.state.copy).toBe('MINE, edited a moment later');
    expect(w.asides).toEqual(['MINE, edited a moment later']);
    expect(w.state.disk).toBe('THEIRS');
  });

  test('cloud wins the race: a newer project version lands mid-resolution — that is what is taken', async () => {
    const w = fakeWorld({ mine: 'MINE', theirs: 'THEIRS v1' });
    w.hooks.afterCopy = () => {
      w.state.accepted = 'THEIRS v2';
    };
    const r = await keepBoth(w.deps);
    expect(r.status).toBe('kept-both');
    expect(w.state.disk).toBe('THEIRS v2');
    expect(w.state.copy).toBe('MINE');
  });

  test('an edit that never stops: the press gives up, the conflict stays held, the copy holds the latest', async () => {
    const w = fakeWorld({ mine: 'MINE', theirs: 'THEIRS' });
    let n = 0;
    w.hooks.beforeTake = () => {
      n += 1;
      w.state.disk = `MINE ${n}`;
    };
    const r = await keepBoth(w.deps);
    expect(r.status).toBe('rejected');
    if (r.status === 'rejected') expect(r.code).toBe('still-editing');
    expect(w.state.held).toBe(true);
    expect(w.log).not.toContain('take');
  });

  test('resolved meanwhile: the copy stays, nothing is taken twice', async () => {
    const w = fakeWorld({ mine: 'MINE', theirs: 'THEIRS' });
    w.hooks.afterCopy = () => {
      w.state.held = false;
    };
    const r = await keepBoth(w.deps);
    expect(r).toEqual({ status: 'rejected', code: 'not-taken', copy: w.copy });
  });

  test('nothing held → none; no local version → refused without a copy', async () => {
    const none = fakeWorld({ mine: 'M', theirs: 'T' });
    none.state.held = false;
    expect(await keepBoth(none.deps)).toEqual({ status: 'none' });
    const gone = fakeWorld({ mine: null, theirs: 'T' });
    expect(await keepBoth(gone.deps)).toEqual({ status: 'rejected', code: 'no-local-version' });
    expect(gone.log).toEqual([]);
  });

  test('two presses at once share one attempt (one copy)', async () => {
    const w = fakeWorld({ mine: 'MINE', theirs: 'THEIRS' });
    const resolve = createKeepBothResolver({
      runtime: () => ({
        conflictVersions: () => {
          const s = w.deps.sides();
          return s ? { slug: 'ui-a', ...s } : null;
        },
        resolveConflict: (_f, _c, o) => w.deps.takeTheirs(o?.ifMine ?? ''),
        acceptedAside: async (_f, _l, c) => {
          w.asides.push(c);
          return { status: 'accepted' };
        },
      }),
      designRoot: '/nowhere',
      fileForSlug: async () => 'design/ui/a.tsx',
      duplicate: async (input) => {
        await w.deps.makeCopy(input.source);
        return { ok: true, ...w.copy };
      },
    });
    const [a, b] = await Promise.all([resolve('design/ui/a.tsx'), resolve('design/ui/a.tsx')]);
    expect(a).toBe(b);
    expect(w.log.filter((x) => x === 'copy')).toHaveLength(1);
  });
});

// ── 1b · the copy's name and meta (api.duplicateCanvas with Keep both's options) ────────────────

describe('the copy — "<name> this Mac", a fresh slug, meta re-keyed', () => {
  function mkCtx(root: string, designRoot: string): Context {
    return {
      cfg: { canvasGroups: [{ label: 'Canvases', path: 'ui' }] } as Context['cfg'],
      projectLabel: 'test',
      bus: createBus(),
      paths: {
        repoRoot: root,
        designRel: '.design',
        designRoot,
        serverInfoFile: join(designRoot, '_server.json'),
        activeFile: join(designRoot, '_active.json'),
        commentsDir: join(designRoot, '_comments'),
        canvasStateDir: join(designRoot, '_canvas-state'),
        historyDir: join(designRoot, '_history'),
        tokensUrlRel: '',
        systemDirRel: 'system',
      },
    };
  }

  test('writes the version it was handed, takes the next free name, re-keys the meta', async () => {
    const { root, designRoot } = makeSandbox();
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    writeFileSync(join(designRoot, 'ui', 'Uniformy.tsx'), 'export default () => "on disk";\n');
    writeFileSync(
      join(designRoot, 'ui', 'Uniformy.meta.json'),
      JSON.stringify({ title: 'Uniformy', created: '2020-01-01T00:00:00.000Z', layout: { a: 1 } })
    );
    // the first name is taken already
    writeFileSync(join(designRoot, 'ui', 'Uniformy this Mac.tsx'), 'export default () => null;\n');
    const api = createApi(mkCtx(root, designRoot), {
      onCommentsChanged: () => {},
      isRoomPinned: () => false,
      flushAndDropRoom: async () => {},
    });
    const r = await api.duplicateCanvas({
      file: 'ui/Uniformy.tsx',
      suffix: 'this Mac',
      title: 'Uniformy (this Mac)',
      source: 'export default () => "mine";\n',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rel).toBe('ui/Uniformy this Mac 2.tsx');
    expect(r.slug).not.toBe('ui-uniformy');
    expect(readFileSync(join(designRoot, r.rel), 'utf8')).toBe('export default () => "mine";\n');
    const meta = JSON.parse(
      readFileSync(join(designRoot, 'ui', 'Uniformy this Mac 2.meta.json'), 'utf8')
    );
    expect(meta.title).toBe('Uniformy (this Mac)');
    expect(meta.created).not.toBe('2020-01-01T00:00:00.000Z');
    expect(meta.layout).toEqual({ a: 1 });
    // the original is untouched
    expect(readFileSync(join(designRoot, 'ui', 'Uniformy.tsx'), 'utf8')).toBe(
      'export default () => "on disk";\n'
    );
    // a plain duplicate still says "copy"
    const plain = await api.duplicateCanvas({ file: 'ui/Uniformy.tsx' });
    expect(plain.ok && plain.rel).toBe('ui/Uniformy copy.tsx');
  });
});

// ── 2 · two studio runtimes on a real hub ────────────────────────────────────────────────────────

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));

const src = (title: string) =>
  `export default function Home() {\n  return <h1 title="${title}">Home</h1>;\n}\n`;

async function waitFor<T>(
  fn: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  what: string,
  ms = 20_000
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

interface Hub {
  proc: ChildProcess;
  http: string;
  port: string;
  tokens: Record<'owner' | 'alice' | 'bob', string>;
}

function startHub(dataDir: string): Promise<Hub> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0', '--transactions'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`hub did not start: ${buf}`)), 20_000);
    proc.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      for (const line of buf.split('\n')) {
        if (!line.startsWith('{')) continue;
        clearTimeout(timer);
        const info = JSON.parse(line);
        resolve({ proc, http: info.http, port: info.port, tokens: info.tokens });
        return;
      }
    });
    proc.stderr?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
    });
  });
}

function stopHub(hub: Hub): Promise<void> {
  return new Promise((resolve) => {
    if (hub.proc.exitCode !== null) return resolve();
    hub.proc.once('exit', () => resolve());
    hub.proc.kill('SIGTERM');
  });
}

const noopCallbacks = (): RoomCallbacks => ({
  async seed() {},
  async persistJson() {},
  async persistBinary() {},
});

function makeCtx(repoRoot: string, url: string): Context {
  const designRoot = join(repoRoot, 'design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({ canvasGroups: [{ label: 'Canvases', path: 'ui' }] })
  );
  return {
    canvasOrigin: 'http://canvas.localhost',
    sharedDoc: true,
    cfg: {
      name: 'test',
      projectLabel: null,
      designRoot: 'design',
      canvasGroups: [{ label: 'Canvases', path: 'ui' }],
      rootClass: 'app',
      themeDefault: 'dark',
      tokensCssRel: 'system/colors.css',
      teamAccentDefault: null,
      handoffTargets: [],
      newCanvasDir: 'ui',
      newComponentDir: 'ui/components',
      linkedHub: { url, linkedAt: 0, fileEvents: false },
      _source: 'defaults',
    },
    projectLabel: 'test',
    paths: {
      repoRoot,
      designRel: 'design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: 'design/system/colors.css',
      systemDirRel: 'system',
    },
    bus: createBus(),
  } as unknown as Context;
}

interface Peer {
  name: string;
  ctx: Context;
  runtime: SyncRuntime;
  read: (rel: string) => string | null;
  write: (rel: string, text: string) => void;
  keepBoth: ReturnType<typeof createKeepBothResolver>;
}

async function startPeer(name: string, repoRoot: string, url: string): Promise<Peer> {
  const ctx = makeCtx(repoRoot, url);
  const runtime = createSyncRuntime(ctx, {
    registry: createRegistry(noopCallbacks()),
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
  });
  if (!runtime) throw new Error(`${name}: runtime refused to start`);
  await runtime.start();
  const file = (rel: string) => join(ctx.paths.designRoot, rel);
  const read = (rel: string) => {
    try {
      return readFileSync(file(rel), 'utf8');
    } catch {
      return null;
    }
  };
  const write = (rel: string, text: string) => {
    writeFileSync(file(rel), text);
    ctx.bus.emit('fs:any', rel);
  };
  const api = createApi(ctx, {
    onCommentsChanged: () => {},
    isRoomPinned: () => false,
    flushAndDropRoom: async () => {},
  });
  // the http.ts wiring, minus HTTP
  const keepBoth = createKeepBothResolver({
    runtime: () => runtime,
    designRoot: ctx.paths.designRoot,
    fileForSlug: (slug) => api.fileForSlug(slug),
    duplicate: async (input) => {
      const r = await api.duplicateCanvas(input);
      if (r.ok) ctx.bus.emit('fs:any', r.rel);
      return r;
    },
  });
  return { name, ctx, runtime, read, write, keepBoth };
}

describe.skipIf(!HUB_READY)('Keep both — two studio runtimes on a real hub', () => {
  let root: string;
  let hub: Hub;
  let alice: Peer;
  let bob: Peer;
  const saved: Record<string, string | undefined> = {};

  const history = async () => {
    const res = await fetch(`${hub.http}/api/projects/current/v1/history`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}` },
    });
    return ((await res.json()) as { history: { kind: string; label?: string | null }[] }).history;
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'keep-both-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
      saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'));
    const aliceUrl = `http://127.0.0.1:${hub.port}`;
    const bobUrl = `http://localhost:${hub.port}`;
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(
      hubsFile,
      JSON.stringify({
        hubs: { [aliceUrl]: { token: hub.tokens.alice }, [bobUrl]: { token: hub.tokens.bob } },
      }),
      { mode: 0o600 }
    );
    process.env.HUBS_CONFIG_PATH = hubsFile;
    mkdirSync(join(root, 'alice', 'design', 'ui'), { recursive: true });
    writeFileSync(join(root, 'alice', 'design', 'ui', 'home.tsx'), src('Hello'));
    alice = await startPeer('alice', join(root, 'alice'), aliceUrl);
    await waitFor(async () => {
      const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const b = (await res.json()) as { docs: { path: string }[] };
      return b.docs.some((d) => d.path === 'ui/home.tsx');
    }, 'the hub to accept ui/home.tsx');
    bob = await startPeer('bob', join(root, 'bob'), bobUrl);
  }, 60_000);

  afterAll(async () => {
    await alice?.runtime.stop();
    await bob?.runtime.stop();
    if (hub) await stopHub(hub);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  const make = async (name: string) => {
    alice.write(`ui/${name}.tsx`, src(`${name} base`));
    await alice.runtime.rescanNow();
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return bob.read(`ui/${name}.tsx`) === src(`${name} base`);
    }, `${name} on bob`);
  };
  const clash = async (name: string) => {
    alice.write(`ui/${name}.tsx`, src(`${name} by Alice`));
    bob.write(`ui/${name}.tsx`, src(`${name} by Bob`));
    const rel = `design/ui/${name}.tsx`;
    return waitFor(() => {
      for (const [me, other] of [
        [alice, bob],
        [bob, alice],
      ] as const) {
        const sides = me.runtime.conflictVersions?.(rel);
        if (sides) return { loser: me, winner: other, sides, rel };
      }
      return null;
    }, `a held conflict on ${name}`);
  };

  test('the runtime refuses a take whose disk moved (ifMine), and takes it when it did not', async () => {
    await make('guard');
    const c = await clash('guard');
    const stale = await c.loser.runtime.resolveConflict?.(c.rel, 'theirs', {
      ifMine: 'not what is on disk',
    });
    expect(stale).toEqual({ status: 'rejected', code: 'changed' });
    expect(c.loser.read('ui/guard.tsx')).toBe(c.sides.mine);
    expect(c.loser.runtime.conflictVersions?.(c.rel)).not.toBeNull();
    const took = await c.loser.runtime.resolveConflict?.(c.rel, 'theirs', {
      ifMine: c.sides.mine ?? '',
    });
    expect(took?.status).toBe('taken');
    await waitFor(() => c.loser.read('ui/guard.tsx') === c.sides.theirs, 'theirs on the loser');
  }, 60_000);

  test('Keep both: theirs is the canvas, mine a new canvas everyone gets, one action + the aside, then both keep syncing both ways', async () => {
    await make('uniformy');
    const count = (h: { kind: string }[], kind: string) => h.filter((a) => a.kind === kind).length;
    const before = await history();
    const c = await clash('uniformy');
    const mine = c.sides.mine as string;
    const theirs = c.sides.theirs;
    const r = await c.loser.keepBoth(c.rel);
    expect(r.status).toBe('kept-both');
    if (r.status !== 'kept-both') return;
    expect(r.copy.rel).toBe('ui/uniformy this Mac.tsx');
    expect(r.aside).toBe('kept');
    await c.loser.runtime.rescanNow();

    // the loser: theirs on the canvas, mine on the copy; the conflict is gone
    await waitFor(() => c.loser.read('ui/uniformy.tsx') === theirs, 'theirs on the loser');
    expect(c.loser.read('ui/uniformy this Mac.tsx')).toBe(mine);
    expect(c.loser.runtime.conflictVersions?.(c.rel)).toBeNull();

    // the copy reaches the winner (loser → winner)
    await waitFor(async () => {
      await c.winner.runtime.pullRemoteNow();
      return c.winner.read('ui/uniformy this Mac.tsx') === mine;
    }, 'the copy on the winner');
    expect(c.winner.read('ui/uniformy.tsx')).toBe(theirs);

    // one head-moving action (the copy) + the aside — the clash's own accepted edit aside
    const after = await history();
    expect(count(after, 'aside') - count(before, 'aside')).toBe(1);
    expect(count(after, 'canvas.create') - count(before, 'canvas.create')).toBe(1);
    expect(after.filter((a) => a.kind === 'aside').map((a) => a.label ?? null)).toContain(
      KEEP_BOTH_ASIDE_LABEL
    );

    // both keep syncing: winner → loser on the original, loser → winner on the copy
    c.winner.write('ui/uniformy.tsx', src('uniformy after, from the winner'));
    await c.winner.runtime.rescanNow();
    await waitFor(async () => {
      await c.loser.runtime.pullRemoteNow();
      return c.loser.read('ui/uniformy.tsx') === src('uniformy after, from the winner');
    }, 'winner → loser on the original');
    c.loser.write('ui/uniformy this Mac.tsx', src('the copy, edited where it was made'));
    await c.loser.runtime.rescanNow();
    await waitFor(async () => {
      await c.winner.runtime.pullRemoteNow();
      return (
        c.winner.read('ui/uniformy this Mac.tsx') === src('the copy, edited where it was made')
      );
    }, 'loser → winner on the copy');
  }, 90_000);
});
