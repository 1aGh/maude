// S8.5 — cloud or this Mac, and the offline queue (09 ex-offline; V2-1.14 `export.cloud`).
//
// Real outbox store + drain on a temp design root, a fake clock, and a FAKE cloud door — nothing here
// reaches the real render service. Proves: images and PDFs never go to the cloud; a cloud video asked
// offline waits ("Queued — starts when this Mac is online") and starts by itself; the record id is the
// job id (dedupe + replay after a restart); a gone target (canvas or artboard in the trash, Can view)
// and a day's wait end the row with words; "Render on this Mac now" takes the row back.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { estimateSpec } from '../exporters/estimate.ts';
import {
  CLOUD_EXPIRED_WORDS,
  CLOUD_QUEUED_WORDS,
  type CloudJobStatus,
  type CloudRenderDoor,
  chooseRenderLane,
  cloudTargetFacts,
  compSecondsFromSource,
  createCloudExports,
  desktopCloudFacts,
  intentRole,
  renderSuggestion,
} from '../exporters/remote.ts';
import type { SpecUnit } from '../exporters/scope.ts';
import type { GroupPlan } from '../exporters/spec-run.ts';
import type { ExportSpecV2 } from '../exporters/spec-v2.ts';
import {
  createOutbox,
  type GateFacts,
  type TargetAnswer,
  type TargetFacts,
} from '../outbox/index.ts';
import { exportCloudSender, NO_CLOUD_WORDS } from '../outbox/senders/export-cloud.ts';
import { cloudExportResponse } from '../routes/export.ts';

const OPEN: GateFacts = {
  online: true,
  hubReachable: true,
  signedIn: true,
  aiConnected: true,
  aiReady: true,
  allowanceResetsAt: null,
};

const VIDEO: ExportSpecV2 = {
  v: 2,
  scope: 'selection',
  canvas: 'ui/video-hype.tsx',
  selection: { artboards: ['reels'] },
  format: 'mp4',
  options: { lane: 'cloud' },
} as ExportSpecV2;

interface FakeDoor extends CloudRenderDoor {
  online: boolean;
  submits: string[];
  jobs: Map<string, CloudJobStatus>;
  answer: TargetAnswer | null;
}

function fakeDoor(): FakeDoor {
  const d: FakeDoor = {
    online: false,
    submits: [],
    jobs: new Map(),
    answer: null,
    async submit({ jobId }) {
      if (!d.online) return { ok: false, network: true };
      if (d.answer) return d.answer;
      d.submits.push(jobId);
      if (!d.jobs.has(jobId)) d.jobs.set(jobId, { state: 'running' });
      return { ok: true, ref: jobId };
    },
    async status(jobId) {
      if (!d.online) return { state: 'unreachable' };
      return d.jobs.get(jobId) ?? { state: 'gone' };
    },
    async artifact(jobId) {
      if (!d.online || d.jobs.get(jobId)?.state !== 'done') return null;
      return { filename: '../../Hype trailer.mp4', body: new Uint8Array([0, 0, 0, 24, 102, 116]) };
    },
  };
  return d;
}

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function rig(
  over: { root?: string; door?: FakeDoor | null; facts?: Partial<TargetFacts>; probe?: Probe } = {}
) {
  const root = over.root ?? mkdtempSync(path.join(tmpdir(), 'export-cloud-'));
  if (!over.root) roots.push(root);
  const clock = { t: 1_760_000_000_000 };
  const door = over.door === undefined ? fakeDoor() : over.door;
  const probe: Probe = over.probe ?? {
    canvas: () => 'present',
    artboards: () => new Set(['reels', 'wide']),
  };
  const base: TargetFacts = { projectId: null, projectName: 'Alligators brand', role: 'owner' };
  let cloud: ReturnType<typeof createCloudExports>;
  const senders = {} as Parameters<typeof createOutbox>[0]['senders'];
  const outbox = createOutbox({
    designRoot: root,
    senders,
    gates: () => OPEN,
    target: (r) =>
      r.kind === 'export.cloud'
        ? cloudTargetFacts(r, { ...base, ...over.facts }, probe)
        : { ...base, ...over.facts },
    contentPending: () => [],
    now: () => clock.t,
    rand: () => 0.5,
    setTimer: () => 0,
    clearTimer: () => {},
    log: { warn: () => {} },
  });
  outbox.store.load();
  const rows: string[] = [];
  cloud = createCloudExports({
    designRoot: root,
    outbox,
    door: () => door,
    emit: (row) => rows.push(`${row.id}:${row.status}`),
    now: () => clock.t,
    setTimer: () => 0,
    clearTimer: () => {},
    log: { warn: () => {} },
  });
  senders['export.cloud'] = exportCloudSender({ door: () => door, accepted: cloud.accepted });
  const start = (spec: ExportSpecV2 = VIDEO, label = 'Hype trailer · 2 videos') =>
    cloud.start({
      spec,
      label,
      actor: 'you',
      device: 'mac',
      project: { id: null, hub: null },
    });
  return { root, clock, door, outbox, cloud, rows, start };
}
type Probe = Parameters<typeof cloudTargetFacts>[2];

describe('S8.5 the choice — cloud or this Mac', () => {
  test('images and PDFs export on this Mac even when the cloud is asked for', () => {
    for (const format of ['png', 'jpg', 'pdf', 'svg'])
      expect(chooseRenderLane({ ...VIDEO, format } as ExportSpecV2, { cloud: true })).toBe(
        'this-mac'
      );
  });
  test('a video goes to the cloud only when asked and a door exists; P3 and a past version stay here', () => {
    expect(chooseRenderLane(VIDEO, { cloud: true })).toBe('cloud');
    expect(chooseRenderLane(VIDEO, { cloud: false })).toBe('this-mac');
    expect(chooseRenderLane({ ...VIDEO, options: { lane: 'auto' } }, { cloud: true })).toBe(
      'this-mac'
    );
    expect(
      chooseRenderLane(
        { ...VIDEO, options: { lane: 'cloud', colorProfile: 'display-p3' } },
        { cloud: true }
      )
    ).toBe('this-mac');
    expect(chooseRenderLane({ ...VIDEO, at: { sha: 'abc1234' } }, { cloud: true })).toBe(
      'this-mac'
    );
  });
  test('4K and long video suggest the cloud; a 15-second 1080p one suggests this Mac', () => {
    const s = (shortSide: number | null, seconds: number | null) =>
      renderSuggestion(VIDEO, { cloud: true, shortSide, seconds });
    expect(s(2160, 15)).toEqual({ cloud: true, suggest: 'cloud', why: '4k' });
    expect(s(1080, 61)).toEqual({ cloud: true, suggest: 'cloud', why: 'long' });
    expect(s(1080, 15)).toEqual({ cloud: true, suggest: 'this-mac', why: null });
    expect(renderSuggestion(VIDEO, { cloud: false, shortSide: 2160, seconds: 90 })).toEqual({
      cloud: false,
      suggest: 'this-mac',
      why: null,
    });
    expect(
      renderSuggestion({ ...VIDEO, format: 'png' } as ExportSpecV2, {
        cloud: true,
        shortSide: 4000,
        seconds: null,
      }).cloud
    ).toBe(false);
  });
  test('a comp says its length in its own source', () => {
    expect(compSecondsFromSource('<Comp durationInFrames={450} fps={30} />')).toBe(15);
    expect(
      compSecondsFromSource('<A durationInFrames={900} /><B durationInFrames={2400} fps={24}/>')
    ).toBe(100);
    expect(compSecondsFromSource('<Comp durationInFrames={TOTAL} />')).toBeNull();
  });
});

describe('S8.5 the export door — POST /_api/export-jobs on a desktop', () => {
  const group = (spec: ExportSpecV2) =>
    ({ spec, units: [], project: 'Alligators brand', date: new Date() }) as unknown as GroupPlan;
  const who = {
    label: 'video-hype · MP4',
    actor: 'you',
    device: 'mac',
    project: { id: null, hub: null },
  };

  test('a cloud video becomes a queued record whose id is the job id', async () => {
    const { cloud, outbox } = rig();
    const res = cloudExportResponse(group(VIDEO), { cloud, renderLane: 'local', ...who });
    expect(res?.status).toBe(202);
    const body = (await res?.json()) as { jobId: string; queued: boolean; words: string };
    expect(body.queued).toBe(true);
    expect(body.words).toBe(CLOUD_QUEUED_WORDS);
    expect(outbox.store.get(body.jobId)?.kind).toBe('export.cloud');
  });

  test('offline, images and PDFs export as usual — on this Mac, never queued', () => {
    const { cloud, outbox } = rig();
    for (const format of ['png', 'pdf'])
      expect(
        cloudExportResponse(group({ ...VIDEO, format } as ExportSpecV2), {
          cloud,
          renderLane: 'local',
          ...who,
        })
      ).toBeNull();
    expect(
      cloudExportResponse(group({ ...VIDEO, options: { lane: 'this-mac' } }), {
        cloud,
        renderLane: 'local',
        ...who,
      })
    ).toBeNull();
    // a workspace cell IS the cloud: its own lane, no outbox
    expect(cloudExportResponse(group(VIDEO), { cloud, renderLane: 'remote', ...who })).toBeNull();
    expect(outbox.store.list()).toHaveLength(0);
  });

  test('the estimate ticks the cloud for a 4K video and tells the sheet it is on offer', () => {
    const units = [
      {
        id: 'u1',
        format: 'mp4',
        scope: 'artboard',
        options: { scale: 2 },
        v2: { size: { scale: 2 } },
        canvas: 'ui/video-hype.tsx',
        artboards: [{ id: 'reels', label: 'Reels', kind: 'video', w: 1080, h: 1920 }],
      },
    ] as unknown as SpecUnit[];
    const facts = {
      canvases: [],
      canvas: null,
      canvasOnly: false,
      history: [],
      renderLane: 'local' as const,
    };
    const spec = { ...VIDEO, options: { lane: 'auto' as const, size: { scale: 2 } } };
    expect(estimateSpec(spec, { units, skipped: [] }, { ...facts, cloud: true }).render).toEqual({
      cloud: true,
      suggest: 'cloud',
      why: '4k',
    });
    const short = units.map((u) => ({ ...u, options: {}, v2: {} })) as unknown as SpecUnit[];
    expect(
      estimateSpec(
        spec,
        { units: short, skipped: [] },
        { ...facts, cloud: true, videoSeconds: () => 75 }
      ).render
    ).toEqual({ cloud: true, suggest: 'cloud', why: 'long' });
    expect(estimateSpec(spec, { units, skipped: [] }, facts).render.cloud).toBe(false);
  });
});

describe('S8.5 the boot facts — read from this Mac', () => {
  test('a canvas in the Trash or gone is trashed; its artboards and comp length come from its source', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'export-cloud-facts-'));
    roots.push(root);
    mkdirSync(path.join(root, 'ui'), { recursive: true });
    writeFileSync(
      path.join(root, 'ui/video-hype.tsx'),
      '<DCArtboard id="reels" kind="video"><Comp durationInFrames={2700} fps={30} /></DCArtboard>'
    );
    const stopped = new Set<string>();
    const f = desktopCloudFacts(root, () => stopped);
    expect(f.canvas('ui/video-hype.tsx')).toBe('present');
    expect([...(f.artboards('ui/video-hype.tsx') ?? [])]).toEqual(['reels']);
    expect(f.videoSeconds('ui/video-hype.tsx')).toBe(90);
    expect(f.canvas('ui/gone.tsx')).toBe('trashed');
    expect(f.canvas('../../etc/passwd.tsx')).toBe('trashed');
    expect(f.artboards('../outside.tsx')).toBeNull();
    stopped.add('ui/video-hype');
    expect(f.canvas('ui/video-hype.tsx')).toBe('trashed');
    // the write stop is built after the outbox at boot: a throw reads as "nothing stopped"
    const early = desktopCloudFacts(root, () => {
      throw new ReferenceError('not yet');
    });
    expect(early.canvas('ui/video-hype.tsx')).toBe('present');
  });
  test('the hub role reads as the replay table role (observer = Can view)', () => {
    expect(intentRole('owner')).toBe('owner');
    expect(intentRole('member')).toBe('edit');
    expect(intentRole('viewer')).toBe('comment');
    expect(intentRole('observer')).toBe('view');
    expect(intentRole(null)).toBeNull();
  });
});

describe('S8.5 the offline queue — export.cloud', () => {
  test('offline, a cloud video waits in words and starts by itself once this Mac is online', async () => {
    const { door, outbox, cloud, clock, start } = rig();
    const r = start();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await outbox.drain.wake();
    expect(door.submits).toEqual([]);
    const waiting = cloud.rows().find((x) => x.id === r.jobId);
    expect(waiting?.status).toBe('queued');
    expect(waiting?.waiting).toBe(CLOUD_QUEUED_WORDS);
    expect(outbox.store.get(r.jobId)?.state).toBe('queued');

    door.online = true;
    clock.t += 60_000; // past the backoff
    await outbox.drain.wake();
    // the record id IS the job id the cloud got
    expect(door.submits).toEqual([r.jobId]);
    expect(outbox.store.get(r.jobId)?.state).toBe('done');
    expect(outbox.store.get(r.jobId)?.outcome).toMatchObject({ code: 'sent', ref: r.jobId });
    expect(cloud.rows().find((x) => x.id === r.jobId)?.status).toBe('running');

    door.jobs.set(r.jobId, { state: 'done' });
    await cloud.pollNow(r.jobId);
    const done = cloud.rows().find((x) => x.id === r.jobId);
    expect(done?.status).toBe('done');
    // the untrusted name is reduced to a basename
    expect(done?.filename).toBe('Hypetrailer.mp4');
    const b = cloud.bytes(r.jobId);
    expect(b.ok && b.body.byteLength).toBe(6);
  });

  test('the same export asked twice while offline is one row with one job id', () => {
    const { outbox, start } = rig();
    const a = start();
    const b = start();
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.jobId).toBe(a.jobId);
    expect(b.deduped).toBe(true);
    expect(outbox.store.list().filter((r) => r.kind === 'export.cloud')).toHaveLength(1);
  });

  test('a restart replays the queued record with the same id, and resumes a render by its id', async () => {
    const first = rig();
    const r = first.start();
    if (!r.ok) throw new Error('enqueue failed');
    first.cloud.stop();
    first.outbox.drain.stop();

    // boot two: the queue is read back from disk and sent under the SAME id
    const door = fakeDoor();
    door.online = true;
    const second = rig({ root: first.root, door });
    second.clock.t += 60_000;
    await second.outbox.drain.wake();
    expect(door.submits).toEqual([r.jobId]);
    second.cloud.stop();
    second.outbox.drain.stop();

    // boot three: the cloud already has it; the tracker resumes polling, it is never submitted again
    const third = rig({ root: first.root, door });
    expect(third.cloud.resume()).toBe(1);
    door.jobs.set(r.jobId, { state: 'done' });
    await third.cloud.pollNow(r.jobId);
    await third.outbox.drain.wake();
    expect(door.submits).toEqual([r.jobId]);
    expect(third.cloud.rows().find((x) => x.id === r.jobId)?.status).toBe('done');
  });

  test('the canvas moved to the trash: the export did not start, and says so', async () => {
    const { door, outbox, cloud, start } = rig({
      probe: { canvas: () => 'trashed', artboards: () => null },
    });
    door.online = true;
    const r = start();
    if (!r.ok) throw new Error('enqueue failed');
    await outbox.drain.wake();
    expect(door.submits).toEqual([]);
    expect(outbox.store.get(r.jobId)?.outcome?.code).toBe('target-trashed');
    expect(cloud.rows().find((x) => x.id === r.jobId)).toMatchObject({
      status: 'failed',
      error: "Hype trailer · 2 videos is in the trash, so its export didn't start.",
    });
  });

  test('every artboard it names moved to the trash: the same answer', async () => {
    const { door, outbox, start } = rig({
      probe: { canvas: () => 'present', artboards: () => new Set(['wide']) },
    });
    door.online = true;
    const r = start();
    if (!r.ok) throw new Error('enqueue failed');
    await outbox.drain.wake();
    expect(door.submits).toEqual([]);
    expect(outbox.store.get(r.jobId)?.outcome?.code).toBe('target-trashed');
  });

  test('the role was lowered to Can view: not exported (A19), never sent', async () => {
    const { door, outbox, cloud, start } = rig({ facts: { role: 'view' } });
    door.online = true;
    const r = start();
    if (!r.ok) throw new Error('enqueue failed');
    await outbox.drain.wake();
    expect(door.submits).toEqual([]);
    expect(outbox.store.get(r.jobId)?.outcome?.code).toBe('access-reduced');
    expect(cloud.rows().find((x) => x.id === r.jobId)?.status).toBe('failed');
  });

  test('a day of waiting: "Not exported — it waited a day."', async () => {
    const { outbox, cloud, clock, start } = rig();
    const r = start();
    if (!r.ok) throw new Error('enqueue failed');
    clock.t += 24 * 3600 * 1000 + 1;
    await outbox.drain.wake();
    expect(outbox.store.get(r.jobId)?.outcome?.code).toBe('expired');
    expect(cloud.rows().find((x) => x.id === r.jobId)?.error).toBe(CLOUD_EXPIRED_WORDS);
  });

  test('"Render on this Mac now" takes the queued row back with lane this-mac', async () => {
    const { door, outbox, cloud, clock, start } = rig();
    const r = start();
    if (!r.ok) throw new Error('enqueue failed');
    await outbox.drain.wake(); // the offline attempt is over: the row waits
    const back = cloud.takeBack(r.jobId);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.spec.options?.lane).toBe('this-mac');
    expect(outbox.store.get(r.jobId)?.outcome?.code).toBe('cancelled');
    expect(cloud.rows().find((x) => x.id === r.jobId)).toBeUndefined();
    door.online = true;
    clock.t += 60_000;
    await outbox.drain.wake();
    expect(door.submits).toEqual([]);
  });

  test('a Mac without a cloud door refuses with one sentence instead of waiting a day', async () => {
    const { outbox, start } = rig({ door: null });
    const r = start();
    if (!r.ok) throw new Error('enqueue failed');
    await outbox.drain.wake();
    const rec = outbox.store.get(r.jobId);
    expect(rec?.state).toBe('dropped');
    expect(rec?.outcome).toMatchObject({ code: 'refused', ref: 'no-cloud' });
    expect(NO_CLOUD_WORDS).toContain('render it on this Mac');
  });
});
