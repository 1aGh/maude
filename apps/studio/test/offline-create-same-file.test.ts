// 2.0.2 — a desktop never forks its own canvas because the project already has the same file.
//
// The field (Brno Alligators, Maude Cloud 2.0.1, 2026-11-03): the cloud cell's 2.0 conversion made
// a document for every `.tsx` of its checkout; the owner's Mac, holding the SAME files, replayed
// its queued `doc.create`s after a restart ("resent 43 unanswered change(s)"), each was refused
// `path-conflict`, and the S6.13b rename moved ten of them to "<name> 2" — ten duplicate canvases
// in the project and ten renamed files on the Mac. Against a REAL hub (Node fixture):
//
//   • the project already holds this Mac's file byte for byte → joined: no " 2" anywhere, one
//     create, and what queued behind the create lands on that document;
//   • the project holds the Mac's file as it is NOW (edited after the create) → the same;
//   • a `_` module the project holds differently → never renamed, nothing forked.
//
// Two DIFFERENT canvases under one name still both survive (offline-create-collision-rename).

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
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

if (!HUB_READY) console.warn('[offline-create-same-file] SKIPPED — needs apps/hub deps.');

const src = (title: string) =>
  `export default function Canvas() {\n  return <h1 title="${title}">${title}</h1>;\n}\n`;
const COMMENT = JSON.stringify([{ id: 'c-queued', text: 'queued behind the create' }]);

interface HistoryRow {
  kind: string;
  effects: { afterPath: string | null }[];
}
interface BootDoc {
  doc: string;
  path: string;
  retired: boolean;
}

describe.skipIf(!HUB_READY)('offline create of a file the project already has', () => {
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
    );
  const twin = (rel: string) => rel.replace(/\.tsx$/, ' 2.tsx');

  /**
   * The field sequence: the desktop makes `rel` while the project is unreachable (its create and
   * a comment queue), then quits; the project meanwhile gets `rel` from elsewhere as `theirs`.
   */
  const desktopAwayWhileProjectGets = async (
    rel: string,
    slug: string,
    made: string,
    onDisk: string,
    theirs: string
  ) => {
    const d = peers.desktop as Peer;
    await stopHub(hub);
    d.write(rel, made);
    await d.runtime.rescanNow();
    await waitFor(() => queued(d), 'the create to be kept on this Mac');
    if (onDisk !== made) d.write(rel, onDisk);
    const comment = d.runtime.proposeLanes?.(
      slug,
      [{ lane: 'comments', text: COMMENT, baseText: '[]' }],
      { kind: 'comment.add', label: 'Add comment' }
    );
    void comment?.catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    await stop('desktop');
    await restartHub();
    const c = peers.cloud as Peer;
    c.write(rel, theirs);
    await c.runtime.rescanNow();
    await waitFor(() => hubDocAt(rel), 'the project to have it from elsewhere');
    const back = await start('desktop');
    await waitFor(() => !queued(back), 'the outbox to drain', 60_000);
    return back;
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'create-same-file-'));
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

  test('the project already has this very file → joined, never renamed', async () => {
    const rel = 'ui/Combine-admin.tsx';
    const same = src('Combine admin');
    const back = await desktopAwayWhileProjectGets(rel, 'ui-combine-admin', same, same, same);
    // Never forked: no second canvas in the project or on this Mac, one create.
    expect(await hubDocAt(twin(rel))).toBe(false);
    expect(existsSync(join(back.ctx.paths.designRoot, twin(rel)))).toBe(false);
    expect(back.read(rel)).toBe(same);
    expect(await createsOf(rel)).toBe(1);
    // What queued behind the create landed on that document.
    await waitFor(
      async () => (await laneAt(rel, 'comments'))?.includes('c-queued') === true,
      'the queued comment on the project document',
      30_000
    );
    expect(back.runtime.conflictVersions?.(`design/${rel}`) ?? null).toBeNull();
    expect(renameJournals(back)).toEqual([]);
  }, 180_000);

  test('the project has the file as it is on this Mac NOW (edited after the create) → joined', async () => {
    const rel = 'ui/Combine-letak.tsx';
    const now = src('letak v2');
    const back = await desktopAwayWhileProjectGets(
      rel,
      'ui-combine-letak',
      src('letak v1'),
      now,
      now
    );
    expect(await hubDocAt(twin(rel))).toBe(false);
    expect(existsSync(join(back.ctx.paths.designRoot, twin(rel)))).toBe(false);
    expect(back.read(rel)).toBe(now);
    expect(await createsOf(rel)).toBe(1);
    expect(renameJournals(back)).toEqual([]);
  }, 180_000);

  test('a `_` module the project holds differently is never renamed', async () => {
    const rel = 'ui/_combine-admin-public.tsx';
    const mine = src('module on the Mac');
    const back = await desktopAwayWhileProjectGets(
      rel,
      'ui-_combine-admin-public',
      mine,
      mine,
      src('module in the cloud')
    );
    expect(await hubDocAt(twin(rel))).toBe(false);
    expect(existsSync(join(back.ctx.paths.designRoot, twin(rel)))).toBe(false);
    expect(await createsOf(rel)).toBe(1);
    expect(renameJournals(back)).toEqual([]);
    // Nothing of this Mac's lost: its bytes are on disk or kept as the other version.
    const kept =
      back.read(rel) === mine ||
      JSON.stringify(back.runtime.conflictVersions?.(`design/${rel}`) ?? null).includes(
        'module on the Mac'
      );
    expect(kept).toBe(true);
  }, 180_000);
});
