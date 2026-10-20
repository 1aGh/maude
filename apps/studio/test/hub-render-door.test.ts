// S8.5b-3 — the desktop half of the cloud render door, against a FAKE hub on loopback. Nothing here
// reaches a real hub, cell, maude-render or Cloudflare. Pins contract §9's answer table row by row, the
// untrusted-hub rules (redirect, byte cap, names, clamps), the capability gate that shows or hides the
// Render row, and the send-time halves of the sender (fingerprint, 10-minute `not-synced` bound).

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createHubRenderDoor,
  createHubRenderDoorGetter,
  RENDER_DOOR_CAPABILITY,
} from '../exporters/hub-render-door.ts';
import {
  CLOUD_FINGERPRINT_MAX,
  CLOUD_NOT_SYNCED_AFTER_MS,
  CloudArtifactTooLargeError,
  type CloudOutbox,
  type CloudRenderDoor,
  cloudNotSyncedWords,
  createCloudExports,
  renderSuggestion,
} from '../exporters/remote.ts';
import type { ExportSpecV2 } from '../exporters/spec-v2.ts';
import { judgeAnswer } from '../outbox/policy.ts';
import { exportCloudSender } from '../outbox/senders/export-cloud.ts';
import type { IntentRecord } from '../outbox/types.ts';

const TOKEN = 'tok_SECRET_peer_token_0123456789';
const JOB = 'i_abcdefghij0123456789';
const SPEC = {
  v: 2,
  scope: 'selection',
  canvas: 'ui/video-hype.tsx',
  selection: { artboards: ['reels'] },
  format: 'mp4',
  options: { lane: 'cloud' },
} as unknown as ExportSpecV2;

interface Seen {
  method: string;
  path: string;
  auth: string | null;
  body: unknown;
}
type Handler = (req: Request, url: URL) => Response | Promise<Response>;

const servers: Array<ReturnType<typeof Bun.serve>> = [];
function fakeHub(handler: Handler) {
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      const text = req.method === 'POST' ? await req.text() : '';
      seen.push({
        method: req.method,
        path: url.pathname + url.search,
        auth: req.headers.get('authorization'),
        body: text ? JSON.parse(text) : null,
      });
      return handler(req, url);
    },
  });
  servers.push(server);
  return { seen, url: `http://127.0.0.1:${server.port}`, server };
}
afterEach(() => {
  while (servers.length) servers.pop()?.stop(true);
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function doorFor(
  hub: { url: string },
  extra: Partial<Parameters<typeof createHubRenderDoor>[0]> = {}
) {
  return createHubRenderDoor({ hubUrl: hub.url, token: () => TOKEN, ...extra });
}

const submitWith = async (
  door: CloudRenderDoor,
  expectList?: Array<{ rel: string; sha256: string | null }>
) =>
  door.submit({
    jobId: JOB,
    spec: SPEC,
    label: 'video-hype · MP4',
    ...(expectList ? { expect: expectList } : {}),
  });

describe('submit — contract §9 answer table', () => {
  test('202: accepted; the bearer is sent in the header only, never in a URL', async () => {
    const hub = fakeHub(() => json(202, { jobId: 'i_somethingelse00000000' }));
    const expectList = [{ rel: 'ui/video-hype.tsx', sha256: 'a'.repeat(64) }];
    const a = await submitWith(doorFor(hub), expectList);
    expect(a).toEqual({ ok: true });
    expect(hub.seen).toHaveLength(1);
    const s = hub.seen[0]!;
    expect(s.method).toBe('POST');
    expect(s.path).toBe('/api/projects/current/v1/render-jobs');
    expect(s.auth).toBe(`Bearer ${TOKEN}`);
    expect(s.path).not.toContain(TOKEN);
    expect(s.body).toMatchObject({ jobId: JOB, label: 'video-hype · MP4', expect: expectList });
  });

  test('200 already: same job, replay', async () => {
    const hub = fakeHub(() => json(200, { jobId: JOB, already: true }));
    expect(await submitWith(doorFor(hub))).toEqual({ ok: true, already: true });
  });

  test('signed out: no request at all, the signed-in gate', async () => {
    const hub = fakeHub(() => json(202, {}));
    const a = await submitWith(doorFor(hub, { token: () => null }));
    expect(a).toEqual({ ok: false, status: 401 });
    expect(hub.seen).toHaveLength(0);
  });

  const rows: Array<[string, number, unknown, Record<string, unknown>]> = [
    ['401', 401, {}, { status: 401 }],
    ['402 plan', 402, {}, { status: 402, code: 'plan' }],
    ['403 forbidden', 403, {}, { status: 403, code: 'forbidden' }],
    [
      '404 unknown-project',
      404,
      { code: 'unknown-project' },
      { status: 404, code: 'unknown-project' },
    ],
    [
      '404 invisible canvas = any other 404',
      404,
      { code: 'whatever' },
      { status: 404, code: 'not-found' },
    ],
    ['409 id-taken', 409, { code: 'id-taken' }, { status: 409, code: 'id-taken' }],
    ['5xx transient', 503, {}, { status: 503 }],
    [
      '429 busy',
      429,
      { retryAfterMs: 20_000 },
      { status: 429, code: 'busy', retryAfterMs: 20_000 },
    ],
    ['an unlisted 4xx is final, its code kept', 413, {}, { status: 413, code: 'http-413' }],
  ];
  for (const [name, status, body, want] of rows) {
    test(`${name}`, async () => {
      const hub = fakeHub(() => json(status, body));
      expect(await submitWith(doorFor(hub))).toMatchObject({ ok: false, ...want });
    });
  }

  test('409 not-synced is final and carries the words', async () => {
    const hub = fakeHub(() => json(409, { code: 'not-synced' }));
    const a = await submitWith(doorFor(hub));
    expect(a).toMatchObject({ ok: false, status: 409, code: 'not-synced' });
    expect((a as { message: string }).message).toContain('haven’t reached the cloud');
  });

  test('425 is transient, names the first behind file by BASENAME only, clamps retryAfterMs', async () => {
    const hub = fakeHub(() =>
      json(425, { code: 'not-synced', behind: ['ui/sub/../Hype<script>.tsx'], retryAfterMs: 1e12 })
    );
    const a = await submitWith(doorFor(hub));
    expect(a).toMatchObject({ ok: false, status: 425, code: 'not-synced', retryAfterMs: 600_000 });
    const msg = (a as { message: string }).message;
    expect(msg).toContain('Hypescript.tsx');
    expect(msg).not.toContain('<');
    expect(msg).not.toContain('/');
  });

  test('422: the cap line is shown as text, capped at 300 chars', async () => {
    const hub = fakeHub(() => json(422, { message: `Reels is 1:30 long. ${'x'.repeat(1000)}` }));
    const a = (await submitWith(doorFor(hub))) as { status: number; code: string; message: string };
    expect(a).toMatchObject({ status: 422, code: 'cap' });
    expect(a.message.startsWith('Reels is 1:30 long.')).toBe(true);
    expect(a.message.length).toBeLessThanOrEqual(300);
  });

  test('no answer at all is a network answer (transient)', async () => {
    const hub = fakeHub(() => json(200, {}));
    const dead = hub.url;
    hub.server.stop(true);
    expect(await submitWith(createHubRenderDoor({ hubUrl: dead, token: () => TOKEN }))).toEqual({
      ok: false,
      network: true,
    });
  });

  test('over 2000 fingerprint entries: answered locally, the hub is never asked', async () => {
    const hub = fakeHub(() => json(202, {}));
    const many = Array.from({ length: CLOUD_FINGERPRINT_MAX + 1 }, (_, i) => ({
      rel: `a/${i}.tsx`,
      sha256: null,
    }));
    const a = await submitWith(doorFor(hub), many);
    expect(a).toMatchObject({ ok: false, status: 409, code: 'too-big' });
    expect((a as { message: string }).message).toContain('Render it on this Mac');
    expect(hub.seen).toHaveLength(0);
  });

  test('a redirect is never followed: the bearer does not reach the second host', async () => {
    const other = fakeHub(() => json(202, {}));
    const hub = fakeHub(
      () => new Response(null, { status: 302, headers: { location: `${other.url}/steal` } })
    );
    expect(await submitWith(doorFor(hub))).toEqual({ ok: false, network: true });
    expect(other.seen).toHaveLength(0);
  });
});

describe('status — the hub is untrusted', () => {
  const run = (
    hub: { url: string },
    extra: Partial<Parameters<typeof createHubRenderDoor>[0]> = {}
  ) => {
    // `lastHeard` starts null (a first poll after a restart asks the park probe once): answer it
    // as a running cell unless the test says otherwise.
    return doorFor(hub, extra);
  };
  const cellRunning = (url: URL) =>
    url.pathname === '/_cell/state' ? json(200, { state: 'running', changedAt: 1, at: 2 }) : null;

  test('queued / running with progress clamped to a sane range', async () => {
    const hub = fakeHub(
      (_r, url) =>
        cellRunning(url) ??
        json(200, { status: 'running', jobId: 'other', progress: { current: 9e9, total: 50 } })
    );
    expect(await run(hub).status(JOB)).toEqual({
      state: 'running',
      progress: { current: 50, total: 50 },
    });
    const hub2 = fakeHub(
      (_r, url) =>
        cellRunning(url) ?? json(200, { state: 'queued', progress: { current: -3, total: 'x' } })
    );
    expect(await run(hub2).status(JOB)).toEqual({ state: 'queued' });
  });

  test('done, and failed with capped text', async () => {
    const hub = fakeHub((_r, url) => cellRunning(url) ?? json(200, { job: { status: 'done' } }));
    expect(await run(hub).status(JOB)).toEqual({ state: 'done' });
    const hub2 = fakeHub(
      (_r, url) => cellRunning(url) ?? json(200, { state: 'failed', error: 'x'.repeat(900) })
    );
    const st = (await run(hub2).status(JOB)) as { state: string; error: string };
    expect(st.state).toBe('failed');
    expect(st.error.length).toBe(500);
  });

  const rows: Array<[string, number, Record<string, unknown>]> = [
    ['404 -> gone', 404, { state: 'gone' }],
    [
      '403 -> failed with the access-removed words',
      403,
      { state: 'failed', error: 'Not sent — you’re no longer in this project.' },
    ],
    ['401 -> unreachable', 401, { state: 'unreachable' }],
    ['5xx -> unreachable', 502, { state: 'unreachable' }],
    ['429 -> unreachable', 429, { state: 'unreachable' }],
  ];
  for (const [name, status, want] of rows) {
    test(name, async () => {
      const hub = fakeHub((_r, url) => cellRunning(url) ?? json(status, {}));
      expect(await run(hub).status(JOB)).toEqual(want as never);
    });
  }

  test('a state it does not know is "ask again", never believed', async () => {
    const hub = fakeHub((_r, url) => cellRunning(url) ?? json(200, { state: 'exploded' }));
    expect(await run(hub).status(JOB)).toEqual({ state: 'unreachable' });
  });

  test('the poll carries the bearer and the job id only in the path', async () => {
    const hub = fakeHub((_r, url) => cellRunning(url) ?? json(200, { state: 'done' }));
    await run(hub).status(JOB);
    const poll = hub.seen.find((s) => s.path.includes('render-jobs'))!;
    expect(poll.path).toBe(`/api/projects/current/v1/render-jobs/${JOB}`);
    expect(poll.auth).toBe(`Bearer ${TOKEN}`);
  });

  test('a job id that is not ours never leaves this Mac', async () => {
    const hub = fakeHub(() => json(200, { state: 'done' }));
    expect(await run(hub).status('../../etc/passwd')).toEqual({ state: 'gone' });
    expect(hub.seen).toHaveLength(0);
  });

  test('an ASLEEP cell: gone, without a status call (a sleeping cell lost its jobs)', async () => {
    const hub = fakeHub((_r, url) =>
      url.pathname === '/_cell/state'
        ? json(200, { state: 'asleep', changedAt: 1, at: 2 })
        : json(200, { state: 'running' })
    );
    expect(await run(hub).status(JOB)).toEqual({ state: 'gone' });
    expect(hub.seen.some((s) => s.path.includes('render-jobs'))).toBe(false);
    const probe = hub.seen[0]!;
    expect(probe.path).toBe('/_cell/state');
    expect(probe.auth).toBe(`Bearer ${TOKEN}`);
  });

  test('the probe is asked after silence only: not before every 5-s poll', async () => {
    let t = 1_000_000;
    const hub = fakeHub((_r, url) => cellRunning(url) ?? json(200, { state: 'running' }));
    const door = run(hub, { now: () => t });
    await door.status(JOB); // first poll after a start: probe + status
    t += 5_000;
    await door.status(JOB); // 5 s later: status only
    const probes = () => hub.seen.filter((s) => s.path === '/_cell/state').length;
    expect(probes()).toBe(1);
    t += 61_000; // the Mac slept
    await door.status(JOB);
    expect(probes()).toBe(2);
  });

  test('a self-hosted hub (404 on the probe) is skipped, the status call goes ahead', async () => {
    const hub = fakeHub((_r, url) =>
      url.pathname === '/_cell/state' ? json(404, {}) : json(200, { state: 'running' })
    );
    expect(await run(hub).status(JOB)).toEqual({ state: 'running' });
  });
});

describe('artifact — streamed with a hard cap', () => {
  const okHub = (body: Uint8Array | string, headers: Record<string, string> = {}) =>
    fakeHub(
      () =>
        new Response(body, { status: 200, headers: { 'content-type': 'text/html', ...headers } })
    );

  test('the bytes and the raw name come back; the content type is ignored', async () => {
    const hub = okHub(new Uint8Array([1, 2, 3]), { 'x-maude-filename': 'Hype.mp4' });
    const a = await doorFor(hub).artifact(JOB);
    expect(a?.filename).toBe('Hype.mp4');
    expect([...a!.body]).toEqual([1, 2, 3]);
    expect(hub.seen[0]!.path).toBe(`/api/projects/current/v1/render-jobs/${JOB}/file`);
  });

  test('over the cap (declared or mid-stream) ends the job instead of buffering it', async () => {
    const declared = okHub(new Uint8Array(2048), { 'content-length': '2048' });
    await expect(
      doorFor(declared, { maxArtifactBytes: 1024 }).artifact(JOB)
    ).rejects.toBeInstanceOf(CloudArtifactTooLargeError);
    const chunked = fakeHub(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(600));
              c.enqueue(new Uint8Array(600));
              c.close();
            },
          })
        )
    );
    await expect(doorFor(chunked, { maxArtifactBytes: 1024 }).artifact(JOB)).rejects.toBeInstanceOf(
      CloudArtifactTooLargeError
    );
  });

  test('404 / offline: null (the tracker asks again; status says gone)', async () => {
    const hub = fakeHub(() => json(404, {}));
    expect(await doorFor(hub).artifact(JOB)).toBeNull();
  });

  test('through the tracker, a hostile name lands as a safe basename inside the job folder', async () => {
    const designRoot = mkdtempSync(join(tmpdir(), 'hub-door-'));
    const hub = fakeHub((_r, url) => {
      if (url.pathname === '/_cell/state') return json(200, { state: 'running' });
      if (url.pathname.endsWith('/file'))
        return new Response(new Uint8Array([7, 7]), {
          headers: { 'x-maude-filename': '../../evil".mp4' },
        });
      return json(200, { state: 'done' });
    });
    const rows: unknown[] = [];
    const ex = createCloudExports({
      designRoot,
      outbox: {
        enqueue: () => ({ ok: false, code: 'x' }),
        store: { list: () => [], get: () => null, cancel: () => ({ ok: false, code: 'x' }) },
      } as CloudOutbox,
      door: () => doorFor(hub),
      emit: (r) => rows.push(r),
      setTimer: () => 0,
    });
    ex.accepted({
      id: JOB,
      label: 'video-hype · MP4',
      createdAt: Date.now(),
      payload: { kind: 'export.cloud', spec: SPEC as never, saveTo: 'downloads' },
    } as unknown as IntentRecord);
    await ex.pollNow(JOB);
    const folder = join(designRoot, '_state', 'export-cloud', JOB);
    const names = readdirSync(folder);
    expect(names).toHaveLength(1);
    expect(names[0]).toBe('evil.mp4');
    expect([...readFileSync(join(folder, names[0]!))]).toEqual([7, 7]);
  });
});

describe('the boot getter — the Render row exists only while the linked hub lists the capability', () => {
  const link = (hub: { url: string }) => () => ({ url: hub.url, token: TOKEN });
  const mp4 = { format: 'mp4' } as Pick<ExportSpecV2, 'format' | 'byKind' | 'options' | 'at'>;
  const emptyOutbox = {
    enqueue: () => ({ ok: false, code: 'x' }),
    store: { list: () => [], get: () => null, cancel: () => ({ ok: false, code: 'x' }) },
  } as unknown as CloudOutbox;

  test('a hub that lists render-jobs-v1: a door, the cloud is on offer, the Render row appears', async () => {
    const hub = fakeHub((_r, url) =>
      url.pathname === '/health'
        ? json(200, { ok: true, capabilities: ['annotations-v2', RENDER_DOOR_CAPABILITY] })
        : json(404, {})
    );
    const g = createHubRenderDoorGetter({ hub: link(hub) });
    expect(g.door()).toBeNull(); // not yet asked: never a dead-end door
    expect(await g.settle()).toBe(true);
    expect(g.door()).not.toBeNull();
    const ex = createCloudExports({
      designRoot: tmpdir(),
      outbox: emptyOutbox,
      door: g.door,
      setTimer: () => 0,
    });
    expect(ex.available()).toBe(true);
    expect(
      renderSuggestion(mp4, { cloud: ex.available(), shortSide: 2160, seconds: null })
    ).toEqual({
      cloud: true,
      suggest: 'cloud',
      why: '4k',
    });
    expect(hub.seen.every((s) => s.auth === null)).toBe(true); // /health carries no token
  });

  test('a hub without the capability (older, no render service, flag off): no door, no Render row', async () => {
    const hub = fakeHub(() => json(200, { ok: true, capabilities: ['annotations-v2', 'ledger'] }));
    const g = createHubRenderDoorGetter({ hub: link(hub) });
    expect(await g.settle()).toBe(true);
    expect(g.door()).toBeNull();
    const ex = createCloudExports({
      designRoot: tmpdir(),
      outbox: emptyOutbox,
      door: g.door,
      setTimer: () => 0,
    });
    expect(ex.available()).toBe(false);
    expect(
      renderSuggestion(mp4, { cloud: ex.available(), shortSide: 2160, seconds: null }).cloud
    ).toBe(false);
  });

  test('not linked, or signed out: no door and nothing asked', async () => {
    const hub = fakeHub(() => json(200, { capabilities: [RENDER_DOOR_CAPABILITY] }));
    const g = createHubRenderDoorGetter({ hub: () => null });
    expect(await g.settle()).toBe(true);
    expect(g.door()).toBeNull();
    expect(hub.seen).toHaveLength(0);
  });

  test('a hub that cannot be asked is "unknown", not "no": settle says so', async () => {
    const hub = fakeHub(() => json(200, {}));
    const url = hub.url;
    hub.server.stop(true);
    const g = createHubRenderDoorGetter({ hub: () => ({ url, token: TOKEN }) });
    expect(await g.settle()).toBe(false);
    expect(g.door()).toBeNull();
  });

  test('a hub that gains the capability appears without a restart (a "no" is re-asked)', async () => {
    let caps: string[] = [];
    const hub = fakeHub(() => json(200, { capabilities: caps }));
    let t = 0;
    const g = createHubRenderDoorGetter({ hub: link(hub), now: () => t, noMs: 30_000 });
    await g.settle();
    expect(g.door()).toBeNull();
    caps = [RENDER_DOOR_CAPABILITY];
    t += 31_000;
    g.door(); // stale "no": re-asked in the background
    await g.settle();
    await Bun.sleep(30);
    expect(g.door()).not.toBeNull();
  });

  test('a re-link to another hub forgets the old answer', async () => {
    const yes = fakeHub(() => json(200, { capabilities: [RENDER_DOOR_CAPABILITY] }));
    const no = fakeHub(() => json(200, { capabilities: [] }));
    let cur = yes;
    const g = createHubRenderDoorGetter({ hub: () => ({ url: cur.url, token: TOKEN }) });
    await g.settle();
    expect(g.door()).not.toBeNull();
    cur = no;
    expect(g.door()).toBeNull(); // the old hub's "yes" is not this hub's
  });

  test('the door reads the token per call: a re-sign-in swaps it without a rebuild', async () => {
    const hub = fakeHub((_r, url) =>
      url.pathname === '/health'
        ? json(200, { capabilities: [RENDER_DOOR_CAPABILITY] })
        : json(202, {})
    );
    let tok = 'tok_one';
    const g = createHubRenderDoorGetter({ hub: () => ({ url: hub.url, token: tok }) });
    await g.settle();
    await submitWith(g.door()!);
    tok = 'tok_two';
    await submitWith(g.door()!);
    expect(hub.seen.filter((s) => s.method === 'POST').map((s) => s.auth)).toEqual([
      'Bearer tok_one',
      'Bearer tok_two',
    ]);
  });
});

describe('the sender — send-time fingerprint, the capability wait, the 10-minute bound', () => {
  const record = {
    id: JOB,
    kind: 'export.cloud',
    label: 'video-hype · MP4',
    payload: { kind: 'export.cloud', spec: SPEC, saveTo: 'downloads' },
  } as unknown as IntentRecord;
  const fake = (answers: Array<Awaited<ReturnType<CloudRenderDoor['submit']>>>) => {
    const sent: unknown[] = [];
    const door: CloudRenderDoor = {
      async submit(job) {
        sent.push(job);
        return answers.shift() ?? { ok: true };
      },
      async status() {
        return { state: 'running' };
      },
      async artifact() {
        return null;
      },
    };
    return { door, sent };
  };

  test('the fingerprint is taken at EACH send, not once at ask time', async () => {
    const { door, sent } = fake([
      { ok: false, status: 425, code: 'not-synced', retryAfterMs: 1000 },
      { ok: true },
    ]);
    let n = 0;
    const fingerprints: Array<Array<{ rel: string; sha256: string | null }>> = [
      [{ rel: 'ui/video-hype.tsx', sha256: 'a'.repeat(64) }],
      [{ rel: 'ui/video-hype.tsx', sha256: 'b'.repeat(64) }],
    ];
    const accepted: string[] = [];
    const send = exportCloudSender({
      door: () => door,
      accepted: (r) => accepted.push(r.id),
      fingerprint: () => fingerprints[n++]!,
    });
    await send(record);
    await send(record);
    expect((sent as Array<{ expect: unknown }>).map((s) => s.expect)).toEqual(fingerprints);
    expect(accepted).toEqual([JOB]);
  });

  test('a fingerprint that cannot be read waits (transient); the ask never goes out unchecked', async () => {
    const { door, sent } = fake([]);
    const send = exportCloudSender({
      door: () => door,
      accepted: () => {},
      fingerprint: () => null,
    });
    expect(await send(record)).toMatchObject({ ok: false, status: 503, code: 'retryable' });
    const throws = exportCloudSender({
      door: () => door,
      accepted: () => {},
      fingerprint: () => {
        throw new Error('disk');
      },
    });
    expect(await throws(record)).toMatchObject({ ok: false, status: 503 });
    expect(sent).toHaveLength(0);
  });

  test('not-synced is retried for 10 minutes, then final with the words (G26)', async () => {
    const msg = cloudNotSyncedWords('Hype.tsx');
    const { door } = fake(
      Array.from({ length: 3 }, () => ({
        ok: false as const,
        status: 425,
        code: 'not-synced',
        retryAfterMs: 15_000,
        message: msg,
      }))
    );
    let t = 5_000_000;
    const send = exportCloudSender({ door: () => door, accepted: () => {}, now: () => t });
    const first = await send(record);
    expect(first).toMatchObject({ ok: false, status: 425 });
    expect(judgeAnswer(record, first).kind).toBe('transient');
    t += CLOUD_NOT_SYNCED_AFTER_MS - 1000;
    expect(await send(record)).toMatchObject({ status: 425 });
    t += 2000; // past ten minutes online
    const last = await send(record);
    expect(last).toMatchObject({ ok: false, status: 409, code: 'not-synced', message: msg });
    const verdict = judgeAnswer(record, last);
    expect(verdict.kind).toBe('decision');
    const words = (verdict as { decision: { words: { text: string } | null } }).decision.words
      ?.text;
    expect(words).toBe(msg);
    expect(words).toContain('Hype.tsx');
    expect(words).toContain('Render it on this Mac');
  });

  test('the clock restarts after an answer that was not not-synced', async () => {
    const nsync = { ok: false as const, status: 425, code: 'not-synced', retryAfterMs: 1000 };
    const { door } = fake([nsync, { ok: false, status: 503 }, nsync]);
    let t = 1_000_000;
    const send = exportCloudSender({ door: () => door, accepted: () => {}, now: () => t });
    await send(record);
    t += CLOUD_NOT_SYNCED_AFTER_MS - 1000;
    await send(record); // 503 resets
    t += 5_000;
    expect(await send(record)).toMatchObject({ status: 425 }); // a fresh clock, still transient
  });

  test('a 409 not-synced from the hub is final and always carries words', async () => {
    const { door } = fake([{ ok: false, status: 409, code: 'not-synced' }]);
    const send = exportCloudSender({ door: () => door, accepted: () => {} });
    const a = (await send(record)) as { message?: string };
    expect(a.message).toContain('haven’t reached the cloud');
  });

  test('no door yet and the hub unreachable: the record waits; known and absent: final no-cloud', async () => {
    const waits = exportCloudSender({
      door: () => null,
      accepted: () => {},
      settle: async () => false,
    });
    expect(await waits(record)).toEqual({ ok: false, network: true });
    const refuses = exportCloudSender({
      door: () => null,
      accepted: () => {},
      settle: async () => true,
    });
    expect(await refuses(record)).toMatchObject({ ok: false, status: 409, code: 'no-cloud' });
  });

  test('a door that appears while settling is used', async () => {
    const { door, sent } = fake([{ ok: true }]);
    let have: CloudRenderDoor | null = null;
    const send = exportCloudSender({
      door: () => have,
      accepted: () => {},
      settle: async () => {
        have = door;
        return true;
      },
    });
    expect(await send(record)).toEqual({ ok: true, ref: JOB });
    expect(sent).toHaveLength(1);
  });
});
