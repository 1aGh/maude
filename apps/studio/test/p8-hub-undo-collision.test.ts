// p8-hub-undo-collision — on a HUB-LINKED project, ⌘Z of an annotation text step is refused
// (409 `undo-conflict`) only when the 3-way merge of the undo against the current text would
// collide (Michal 2026-10-29, kg maude/v2-michal-hub-undo-refuses-on-text-collision). A merge that
// does not overlap goes on to the hub kernel as before: the collaborator's text survives.
//
//   pure   — textRevertCollides: base = what the step left, ours = what it replaced, theirs = now;
//   reads  — hubTextUndoConflict judges the text the hub ACCEPTED (history hashes + blobs), not a
//            proposal, and the hub head as "now";
//   hub    — two studios on a real hub (serve-hub fixture): overlap → 409 and the peer's text is
//            the hub head; no overlap → the undo lands and both texts survive; no peer → a plain undo.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import '../annotations/ops-merge.ts';
import { serializeBoard } from '../annotations/schema.ts';
import { boardTextSlots, textRevertCollides } from '../annotations/text-steps.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { createProjectUndoRoutes } from '../routes/project-undo.ts';
import type { RouteSpec } from '../routes/table.ts';
import { hubTextUndoConflict } from '../sync/hub-text-undo.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const sticky = (id: string, text: string, index = 'a0'): AnnotationElement =>
  ({ id, type: 'sticky', index, x: 0, y: 0, w: 200, h: 200, text }) as AnnotationElement;
const shape = (id: string, text: string): AnnotationElement =>
  ({
    id,
    type: 'shape',
    index: 'a1',
    shape: 'rect',
    x: 300,
    y: 0,
    w: 100,
    h: 100,
    label: { text },
  }) as unknown as AnnotationElement;
const board = (...els: AnnotationElement[]) => serializeBoard(els);

describe('textRevertCollides — the 3-way merge of the undo onto the current text', () => {
  test('a peer who rewrote the word my step typed → collides', () => {
    const before = board(sticky('k', 'Hello world'));
    const after = board(sticky('k', 'Hello brave world'));
    const now = board(sticky('k', 'Hello bold world'));
    expect(textRevertCollides(before, after, now)).toBe(true);
  });

  test('a peer edit elsewhere in the text → no collision (the kernel keeps both)', () => {
    const before = board(sticky('k', 'alpha beta gamma'));
    const after = board(sticky('k', 'alpha BETA gamma'));
    const now = board(sticky('k', 'alpha BETA gamma and then some delta'));
    expect(textRevertCollides(before, after, now)).toBe(false);
  });

  test('nobody changed it since → no collision', () => {
    const before = board(sticky('k', 'one'));
    const after = board(sticky('k', 'one two'));
    expect(textRevertCollides(before, after, after)).toBe(false);
  });

  test('a shape label counts as a text slot', () => {
    const before = board(shape('box', 'Ahoj'));
    const after = board(shape('box', 'Ahoj svete'));
    const now = board(shape('box', 'Ahoj lidi'));
    expect(textRevertCollides(before, after, now)).toBe(true);
  });

  test('a sticky my step created that a peer then rewrote → collides (undo would delete their text)', () => {
    const after = board(sticky('k', 'draft'));
    const now = board(sticky('k', 'their words'));
    expect(textRevertCollides('', after, now)).toBe(true);
  });

  test('a sticky a peer deleted since → nothing of theirs to lose', () => {
    const before = board(sticky('k', 'a'));
    const after = board(sticky('k', 'a b'));
    expect(textRevertCollides(before, after, board(sticky('other', 'x')))).toBe(false);
  });

  test('a step that changed only another field never collides on text', () => {
    const before = board(sticky('k', 'same'));
    const after = board({ ...sticky('k', 'same'), x: 50 } as AnnotationElement);
    const now = board(sticky('k', 'changed by them'));
    expect(textRevertCollides(before, after, now)).toBe(false);
  });
});

describe('hubTextUndoConflict — judges what the hub ACCEPTED', () => {
  const h = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex');
  const reads = (blobs: string[], effects: unknown[], head: string) => ({
    action: async (id: string) => (id === 'a1' ? { effects: effects as never } : null),
    blob: async (hash: string) => blobs.find((b) => h(b) === hash) ?? null,
    head: async () => head,
  });

  test('the accepted after-text (a hub merge), not what this studio proposed, is the base', async () => {
    const before = board(sticky('k', 'Hello world'));
    // the hub merged my "Hello brave world" onto a peer's "Hello world!" — it accepted this:
    const accepted = board(sticky('k', 'Hello brave world!'));
    const now = accepted;
    const effects = [
      { doc: 'k', lane: 'annotations', beforeHash: h(before), afterHash: h(accepted) },
    ];
    expect(
      await hubTextUndoConflict({ actionId: 'a1' }, reads([before, accepted], effects, now))
    ).toBe(false);
    const rewritten = board(sticky('k', 'Hello bold world!'));
    expect(
      await hubTextUndoConflict({ actionId: 'a1' }, reads([before, accepted], effects, rewritten))
    ).toBe(true);
  });

  test('unknown action, unreadable blob, non-annotation lane, several targets → no refusal', async () => {
    const before = board(sticky('k', 'Hello world'));
    const after = board(sticky('k', 'Hello brave world'));
    const now = board(sticky('k', 'Hello bold world'));
    const fx = [{ doc: 'k', lane: 'annotations', beforeHash: h(before), afterHash: h(after) }];
    expect(await hubTextUndoConflict({ actionId: 'zz' }, reads([before, after], fx, now))).toBe(
      false
    );
    expect(await hubTextUndoConflict({ actionId: 'a1' }, reads([after], fx, now))).toBe(false);
    expect(
      await hubTextUndoConflict(
        { actionId: 'a1' },
        reads([before, after], [{ ...fx[0], lane: 'html' }], now)
      )
    ).toBe(false);
    expect(
      await hubTextUndoConflict({ actionIds: ['a1', 'a2'] }, reads([before, after], fx, now))
    ).toBe(false);
    expect(await hubTextUndoConflict({ actionId: 'a1' }, reads([before, after], fx, now))).toBe(
      true
    );
  });
});

// ---------------------------------------------------------------- a real hub, two studios

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));

const CANVAS = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';

export default function K() {
  return (
    <DesignCanvas>
      <DCArtboard id="hero" label="Hero" width={100} height={100}>
        <h1>K</h1>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

async function waitFor<T>(fn: () => T | Promise<T>, what: string, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* retry */
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

interface Hub {
  proc: ChildProcess;
  http: string;
  port: string;
  tokens: Record<'owner' | 'alice' | 'bob' | 'viewer', string>;
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

const noop = (): RoomCallbacks => ({
  async seed() {},
  async persistJson() {},
  async persistBinary() {},
});

interface Peer {
  runtime: SyncRuntime;
  undo: (actionId: string) => Promise<{ status: number; body: Record<string, unknown> }>;
}

async function startPeer(repoRoot: string, url: string): Promise<Peer> {
  const designRoot = join(repoRoot, 'design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({ canvasGroups: [{ label: 'Canvases', path: 'ui' }] })
  );
  const ctx = {
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
  const runtime = createSyncRuntime(ctx, {
    registry: createRegistry(noop()),
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
  });
  if (!runtime) throw new Error('runtime refused to start');
  await runtime.start();
  const spec = createProjectUndoRoutes({
    control: () => runtime as never,
    designRel: 'design',
  }).find((s) => s.method === 'POST' && s.path === '/_api/project/undo') as RouteSpec;
  return {
    runtime,
    undo: async (actionId) => {
      const res = await spec.handle(
        new Request('http://localhost/_api/project/undo', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ actionId, via: 'keys' }),
        }),
        {} as never
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
  };
}

describe.skipIf(!HUB_READY)('⌘Z of a text step on a real hub, two studios', () => {
  let root: string;
  let hub: Hub;
  let alice: Peer;
  let bob: Peer;
  let doc = '';
  const saved: Record<string, string | undefined> = {};
  const SLUG = 'ui-k';

  /** The board at the hub head, read with the owner's token (what everyone pulls). */
  const head = async (): Promise<string> => {
    const res = await fetch(
      `${hub.http}/api/projects/current/v1/lane?doc=${encodeURIComponent(doc)}&lane=annotations&rev=${Number.MAX_SAFE_INTEGER}`,
      { headers: { authorization: `Bearer ${hub.tokens.owner}` } }
    );
    return ((await res.json()) as { body: string }).body;
  };
  const textOf = async (id: string) => boardTextSlots(await head()).get(id);
  /** One stroke: the board with `id`'s text replaced, proposed on the hub head. */
  const stroke = async (who: Peer, el: AnnotationElement) => {
    const base = await head();
    const els = base ? (JSON.parse(base).elements as AnnotationElement[]) : [];
    const next = [...els.filter((e) => e.id !== el.id), el];
    const r = await who.runtime.proposeLane?.(SLUG, 'annotations', serializeBoard(next), {
      baseText: base,
    });
    expect(r?.status).toBe('accepted');
    expect(typeof r?.actionId).toBe('string');
    return r?.actionId as string;
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'p8-hub-undo-collision-'));
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
    writeFileSync(join(root, 'alice', 'design', 'ui', 'k.tsx'), CANVAS);
    alice = await startPeer(join(root, 'alice'), aliceUrl);
    doc = await waitFor(async () => {
      const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const b = (await res.json()) as { docs: { doc: string; path: string }[] };
      return b.docs.find((d) => d.path === 'ui/k.tsx')?.doc ?? '';
    }, 'the hub to accept ui/k.tsx');
    bob = await startPeer(join(root, 'bob'), bobUrl);
    await bob.runtime.pullRemoteNow();
    await waitFor(() => bob.runtime.acceptedMode?.() === true, 'bob in accepted mode');
  }, 60_000);

  afterAll(async () => {
    await alice?.runtime.stop();
    await bob?.runtime.stop();
    if (hub && hub.proc.exitCode === null) {
      const gone = new Promise((r) => hub.proc.once('exit', r));
      hub.proc.kill('SIGTERM');
      await gone;
    }
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('the peer overwrote the word I typed → 409 undo-conflict; their text stays', async () => {
    await stroke(alice, sticky('one', 'Hello world', 'a0'));
    const mine = await stroke(alice, sticky('one', 'Hello brave world', 'a0'));
    await stroke(bob, sticky('one', 'Hello bold world', 'a0'));
    const r = await alice.undo(mine);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('undo-conflict');
    expect(await textOf('one')).toBe('Hello bold world');
  }, 30_000);

  test('the peer edited elsewhere in the text → the undo lands and both survive', async () => {
    await stroke(alice, sticky('two', 'alpha beta gamma', 'a1'));
    const mine = await stroke(alice, sticky('two', 'alpha BETA gamma', 'a1'));
    await stroke(bob, sticky('two', 'alpha BETA gamma and then some delta', 'a1'));
    const r = await alice.undo(mine);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(await textOf('two')).toBe('alpha beta gamma and then some delta');
  }, 30_000);

  test('nobody touched it → a plain undo', async () => {
    await stroke(alice, sticky('three', 'solo', 'a2'));
    const mine = await stroke(alice, sticky('three', 'solo edit', 'a2'));
    const r = await alice.undo(mine);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(await textOf('three')).toBe('solo');
  }, 30_000);
});
