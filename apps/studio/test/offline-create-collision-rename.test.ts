// S6.13b — a canvas made offline whose name a peer took meanwhile is RENAMED, not held as a
// conflict (lead decision `maude/v2-lead-offline-create-collision-renames`). Against a REAL hub
// (Node fixture), both directions (memory: test sync in both directions):
//
//   • desktop away, cloud takes the name  → the desktop's canvas is "<name> 2", with its edits;
//   • cloud away, desktop takes the name  → the mirror;
//   • both make it while apart, nobody restarts → the one that lands second is "<name> 2";
//   • a crash inside the rename           → recovered once (same name, one create, no "3").
//
// Never written over: the peer's canvas keeps its name and bytes. Never lost: this Mac's canvas
// joins under the next free C4 name (`nextFreeCanvasName`), and an edit queued behind its create
// follows it. The oracle is the other peer's disk or the hub's own log.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HUB_READY,
  type Hub,
  type Peer,
  startHub,
  startPeer,
  stopHub,
  waitFor,
} from './fixtures/sync-peer.ts';

if (!HUB_READY) console.warn('[offline-create-collision-rename] SKIPPED — needs apps/hub deps.');

const src = (title: string) =>
  `export default function Canvas() {\n  return <h1 title="${title}">${title}</h1>;\n}\n`;
const COMMENT = JSON.stringify([{ id: 'c-offline', text: 'kept with the offline canvas' }]);
const renamedText = (from: string, to: string) =>
  `“${from}” was also made on another device — this one is now “${to}”.`;

interface HistoryRow {
  kind: string;
  effects: { afterPath: string | null }[];
}
interface BootDoc {
  doc: string;
  path: string;
  retired: boolean;
}

describe.skipIf(!HUB_READY)('offline create collision — renamed, on a real hub', () => {
  let root: string;
  let hub: Hub;
  const peers: Record<'desktop' | 'cloud', Peer | null> = { desktop: null, cloud: null };
  const urls: Record<'desktop' | 'cloud', string> = { desktop: '', cloud: '' };
  const saved: Record<string, string | undefined> = {};

  const api = async (route: string) => {
    const res = await fetch(`${hub.http}/api/projects/current/v1/${route}`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}` },
    });
    return (await res.json()) as Record<string, unknown>;
  };
  const liveDocs = async () =>
    ((await api('bootstrap')).docs as BootDoc[]).filter((d) => !d.retired);
  const hubDocAt = async (rel: string) => (await liveDocs()).some((d) => d.path === rel);
  const createsOf = async (rel: string) =>
    ((await api('history?limit=400')).history as HistoryRow[]).filter(
      (a) => a.kind === 'canvas.create' && a.effects.some((e) => e.afterPath === rel)
    ).length;
  const laneAt = async (rel: string, lane: string) => {
    const b = await api('bootstrap');
    const doc = (b.docs as BootDoc[]).find((d) => d.path === rel && !d.retired);
    if (!doc) return null;
    const r = await api(
      `lane?doc=${encodeURIComponent(doc.doc)}&lane=${lane}&rev=${b.revision as number}`
    );
    return r.body as string;
  };
  const outboxOf = (p: Peer) => join(p.ctx.paths.designRoot, '_state', 'outbox');
  const queued = (p: Peer) =>
    existsSync(outboxOf(p)) && readdirSync(outboxOf(p)).some((n) => /^\d+-tx_/.test(n));
  const renameJournals = (p: Peer) => {
    const dir = join(p.ctx.paths.designRoot, '_state', 'create-renames');
    return existsSync(dir) ? readdirSync(dir) : [];
  };
  const start = async (who: 'desktop' | 'cloud') => {
    peers[who] = await startPeer(join(root, who), urls[who]);
    return peers[who] as Peer;
  };
  const stop = async (who: 'desktop' | 'cloud') => {
    await peers[who]?.runtime.stop();
    peers[who] = null;
  };
  const restartHub = async () => {
    hub = await startHub(join(root, 'hub'), hub.port);
  };
  const pulled = async (p: Peer, rel: string, text: string) =>
    waitFor(
      async () => {
        await p.runtime.pullRemoteNow();
        return p.read(rel) === text;
      },
      `${rel} on ${p.ctx.paths.repoRoot}`,
      60_000
    ).catch(async (err) => {
      throw new Error(
        `${(err as Error).message}\n  disk: ${JSON.stringify(p.read(rel))}\n  project: ${JSON.stringify(await laneAt(rel, 'html'))}`
      );
    });

  /** Make `rel` on `p` while the project is unreachable: the create and a lane edit queue. */
  const makeOffline = async (p: Peer, rel: string, slug: string, made: string, edited: string) => {
    p.write(rel, src(made));
    await p.runtime.rescanNow();
    await waitFor(() => queued(p), 'the create to be kept on this Mac');
    // …then edited, still offline: on disk, and a comment queued behind the create.
    p.write(rel, src(edited));
    const comment = p.runtime.proposeLanes?.(
      slug,
      [{ lane: 'comments', text: COMMENT, baseText: '[]' }],
      { kind: 'comment.add', label: 'Add comment' }
    );
    expect(comment).toBeTruthy();
    void comment?.catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'create-collision-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
      saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'));
    urls.desktop = `http://127.0.0.1:${hub.port}`;
    urls.cloud = `http://localhost:${hub.port}`;
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(
      hubsFile,
      JSON.stringify({
        hubs: {
          [urls.desktop]: { token: hub.tokens.alice },
          [urls.cloud]: { token: hub.tokens.bob },
        },
      }),
      { mode: 0o600 }
    );
    process.env.HUBS_CONFIG_PATH = hubsFile;
    mkdirSync(join(root, 'desktop', 'design', 'ui'), { recursive: true });
    writeFileSync(join(root, 'desktop', 'design', 'ui', 'home.tsx'), src('Home'));
    await start('desktop');
    await waitFor(() => hubDocAt('ui/home.tsx'), 'the project to have ui/home.tsx');
    const cloud = await start('cloud');
    await pulled(cloud, 'ui/home.tsx', src('Home'));
  }, 90_000);

  afterEach(async () => {
    if (hub.proc.exitCode !== null || hub.proc.signalCode !== null) await restartHub();
    for (const who of ['desktop', 'cloud'] as const) if (!peers[who]) await start(who);
  });

  afterAll(async () => {
    await stop('desktop');
    await stop('cloud');
    if (hub) await stopHub(hub);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  for (const [away, here] of [
    ['desktop', 'cloud'],
    ['cloud', 'desktop'],
  ] as const) {
    const name = away === 'desktop' ? 'Untitled canvas' : 'Poster';
    const rel = `ui/${name}.tsx`;
    const rel2 = `ui/${name} 2.tsx`;
    const slug = away === 'desktop' ? 'ui-untitled_canvas' : 'ui-poster';

    test(`${away} away: its offline "${name}" whose name the ${here} took becomes "${name} 2", with its edits`, async () => {
      const a = peers[away] as Peer;
      await stopHub(hub);
      await makeOffline(a, rel, slug, `${away} made it`, `${away} edited it`);
      await stop(away);
      await restartHub();
      const b = peers[here] as Peer;
      b.write(rel, src(`${here} made it`));
      await b.runtime.rescanNow();
      await waitFor(() => hubDocAt(rel), `the ${here} canvas in the project`);

      const back = await start(away);
      // The away canvas reaches the other peer under the next free name, edited.
      await pulled(b, rel2, src(`${away} edited it`));
      await waitFor(() => !queued(back), 'the outbox to drain', 60_000);
      // Never written over: the peer's canvas keeps its name and bytes, everywhere.
      await pulled(back, rel, src(`${here} made it`));
      expect(b.read(rel)).toBe(src(`${here} made it`));
      expect(back.read(rel2)).toBe(src(`${away} edited it`));
      // Each created exactly once; no third name.
      expect(await createsOf(rel)).toBe(1);
      expect(await createsOf(rel2)).toBe(1);
      expect(await hubDocAt(`ui/${name} 3.tsx`)).toBe(false);
      // The edit queued behind the create followed it — and never landed on the peer's canvas.
      expect(await laneAt(rel2, 'comments')).toContain('c-offline');
      expect(await laneAt(rel, 'comments')).not.toContain('c-offline');
      // Not a conflict, and said once, in words.
      expect(back.runtime.conflictVersions?.(`design/${rel}`) ?? null).toBeNull();
      const notices = (back.runtime.status()?.notices ?? []).filter(
        (n) => n.text === renamedText(name, `${name} 2`)
      );
      expect(notices.length).toBe(1);
      expect(renameJournals(back)).toEqual([]);
    }, 180_000);
  }

  test('both make "Flyer" while apart and nobody restarts: the second to land is "Flyer 2"', async () => {
    const d = peers.desktop as Peer;
    const c = peers.cloud as Peer;
    await stopHub(hub);
    d.write('ui/Flyer.tsx', src('desktop flyer'));
    c.write('ui/Flyer.tsx', src('cloud flyer'));
    await d.runtime.rescanNow();
    await c.runtime.rescanNow();
    await waitFor(() => queued(d) && queued(c), 'both creates kept');
    await restartHub();
    await waitFor(
      async () => (await hubDocAt('ui/Flyer.tsx')) && (await hubDocAt('ui/Flyer 2.tsx')),
      'both canvases in the project',
      60_000
    );
    const first = (await laneAt('ui/Flyer.tsx', 'html')) as string;
    const second = (await laneAt('ui/Flyer 2.tsx', 'html')) as string;
    expect(new Set([first, second])).toEqual(new Set([src('desktop flyer'), src('cloud flyer')]));
    for (const p of [d, c]) {
      await pulled(p, 'ui/Flyer.tsx', first);
      await pulled(p, 'ui/Flyer 2.tsx', second);
      expect(p.runtime.conflictVersions?.('design/ui/Flyer.tsx') ?? null).toBeNull();
    }
    expect(await createsOf('ui/Flyer.tsx')).toBe(1);
    expect(await createsOf('ui/Flyer 2.tsx')).toBe(1);
  }, 180_000);

  for (const [point, name] of [
    ['moved-primary', 'Logo'],
    ['sealed', 'Menu'],
  ] as const) {
    test(`a crash inside the rename (${point}) is recovered once`, async () => {
      const rel = `ui/${name}.tsx`;
      const rel2 = `ui/${name} 2.tsx`;
      const slug = `ui-${name.toLowerCase()}`;
      const d = peers.desktop as Peer;
      await stopHub(hub);
      await makeOffline(d, rel, slug, 'desktop made it', 'desktop edited it');
      await stop('desktop');
      await restartHub();
      const c = peers.cloud as Peer;
      c.write(rel, src('cloud made it'));
      await c.runtime.rescanNow();
      await waitFor(() => hubDocAt(rel), 'the cloud canvas in the project');

      // A relaunch killed at `point`, then a normal relaunch.
      const code = await new Promise<number | null>((resolve) => {
        const child = spawn(
          process.execPath,
          [
            join(import.meta.dir, 'fixtures', 'create-rename-crash.ts'),
            join(root, 'desktop'),
            urls.desktop,
            point,
          ],
          { stdio: ['ignore', 'inherit', 'inherit'], env: process.env }
        );
        child.on('exit', (c2, sig) => resolve(sig === 'SIGKILL' ? -9 : c2));
      });
      expect(code).toBe(-9);
      const back = await start('desktop');
      await pulled(c, rel2, src('desktop edited it'));
      await waitFor(() => !queued(back), 'the outbox to drain', 60_000);
      await pulled(back, rel, src('cloud made it'));
      expect(await createsOf(rel)).toBe(1);
      expect(await createsOf(rel2)).toBe(1);
      expect(await hubDocAt(`ui/${name} 3.tsx`)).toBe(false);
      expect(existsSync(join(back.ctx.paths.designRoot, 'ui', `${name} 3.tsx`))).toBe(false);
      expect(await laneAt(rel2, 'comments')).toContain('c-offline');
      expect(await laneAt(rel, 'comments')).not.toContain('c-offline');
      expect(renameJournals(back)).toEqual([]);
    }, 180_000);
  }
});
