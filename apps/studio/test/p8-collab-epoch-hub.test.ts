// p8-collab-epoch (decision v2-p8-collab-epoch) — the HUB direction.
//
// The handshake epoch is a studio-room rule (`/_ws/collab`, browser and canvas
// peers). A desktop's sync agent does not speak that socket: it reaches the hub
// through a Hocuspocus provider, and the hub's documents survive a hub restart
// (sqlite), so a reconnecting desktop replays into the SAME lineage. This file
// pins that both directions stay single-copy across a restart, on a REAL hub
// (Node fixture), with the epoch change in the tree:
//   - the hub restarts while a desktop and a cell's studio stay up;
//   - the cell's studio restarts (a new studio instance → a new epoch) while
//     the desktop stays up.
// Each side's next edit must reach the other once: no doubled body, no second
// create, nothing resurrected.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

if (!HUB_READY) console.warn('[p8-collab-epoch-hub] SKIPPED — needs apps/hub deps.');

const src = (title: string) =>
  `export default function Canvas() {\n  return <h1 title="${title}">${title}</h1>;\n}\n`;

interface HistoryRow {
  kind: string;
  effects: { afterPath: string | null }[];
}
interface BootDoc {
  doc: string;
  path: string;
  retired: boolean;
}

describe.skipIf(!HUB_READY)('collab epoch — both directions on a real hub', () => {
  let root: string;
  let hub: Hub;
  const peers: Record<'desktop' | 'cloud', Peer | null> = { desktop: null, cloud: null };
  const urls: Record<'desktop' | 'cloud', string> = { desktop: '', cloud: '' };
  const saved: Record<string, string | undefined> = {};
  const REL = 'ui/home.tsx';

  const api = async (route: string) => {
    const res = await fetch(`${hub.http}/api/projects/current/v1/${route}`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}` },
    });
    return (await res.json()) as Record<string, unknown>;
  };
  const liveDocs = async () =>
    ((await api('bootstrap')).docs as BootDoc[]).filter((d) => !d.retired);
  const creates = async () =>
    ((await api('history?limit=400')).history as HistoryRow[]).filter(
      (a) => a.kind === 'canvas.create' && a.effects.some((e) => e.afterPath === REL)
    ).length;
  const body = async () => {
    const b = await api('bootstrap');
    const doc = (b.docs as BootDoc[]).find((d) => d.path === REL && !d.retired);
    if (!doc) return null;
    const r = await api(
      `lane?doc=${encodeURIComponent(doc.doc)}&lane=html&rev=${b.revision as number}`
    );
    return r.body as string;
  };
  const start = async (who: 'desktop' | 'cloud') => {
    peers[who] = await startPeer(join(root, who), urls[who]);
    return peers[who] as Peer;
  };
  const pulled = (p: Peer, text: string) =>
    waitFor(
      async () => {
        await p.runtime.pullRemoteNow();
        return p.read(REL) === text;
      },
      `${REL} on ${p.ctx.paths.repoRoot}`,
      60_000
    ).catch(async (err) => {
      throw new Error(
        `${(err as Error).message}\n  disk: ${JSON.stringify(p.read(REL))}\n  project: ${JSON.stringify(await body())}`
      );
    });
  /** One project, one copy: the hub's body, both disks, one create, one live doc. */
  const singleCopy = async (text: string) => {
    expect(await body()).toBe(text);
    expect(peers.desktop?.read(REL)).toBe(text);
    expect(peers.cloud?.read(REL)).toBe(text);
    expect(await creates()).toBe(1);
    expect((await liveDocs()).filter((d) => d.path === REL).length).toBe(1);
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'collab-epoch-hub-'));
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
    await waitFor(
      async () => (await liveDocs()).some((d) => d.path === REL),
      'the project to have ui/home.tsx'
    );
    const cloud = await start('cloud');
    await pulled(cloud, src('Home'));
  }, 90_000);

  afterAll(async () => {
    await peers.desktop?.runtime.stop();
    await peers.cloud?.runtime.stop();
    if (hub) await stopHub(hub);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('the hub restarts: the desktop reconnects into the same lineage, one copy each way', async () => {
    await stopHub(hub);
    hub = await startHub(join(root, 'hub'), hub.port);
    const cloud = peers.cloud as Peer;
    const desktop = peers.desktop as Peer;
    cloud.write(REL, src('after the hub restart (cell)'));
    await cloud.runtime.rescanNow();
    await pulled(desktop, src('after the hub restart (cell)'));
    desktop.write(REL, src('after the hub restart (desktop)'));
    await desktop.runtime.rescanNow();
    await pulled(cloud, src('after the hub restart (desktop)'));
    await singleCopy(src('after the hub restart (desktop)'));
  }, 120_000);

  test("the cell's studio restarts (a new epoch): the desktop's next edit lands once", async () => {
    await peers.cloud?.runtime.stop();
    peers.cloud = null;
    const cloud = await start('cloud');
    const desktop = peers.desktop as Peer;
    desktop.write(REL, src('after the cell restart (desktop)'));
    await desktop.runtime.rescanNow();
    await pulled(cloud, src('after the cell restart (desktop)'));
    cloud.write(REL, src('after the cell restart (cell)'));
    await cloud.runtime.rescanNow();
    await pulled(desktop, src('after the cell restart (cell)'));
    await singleCopy(src('after the cell restart (cell)'));
  }, 120_000);
});
