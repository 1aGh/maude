// S8.5b-3 — the boot wiring of the cloud render door, against a REAL studio linked to a FAKE hub on
// loopback (nothing here reaches a real hub, cell, maude-render or Cloudflare). A hub whose /health lists
// `render-jobs-v1` makes the Render row appear (the estimate offers the cloud for a 4K video); a hub that
// does not leaves it hidden. A cloud video then goes up through the outbox to the hub's bearer door and
// comes back as a file on this Mac.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const TOKEN = 'tok_boot_door_SECRET_0123456789';
const CANVAS = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
export default function Hype() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="S8.5b">
        <DCArtboard id="reels" label="Reels" kind="video" width={1080} height={1920}>
          <div />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
const SPEC = {
  v: 2,
  scope: 'selection',
  canvas: 'ui/video-hype.tsx',
  selection: { artboards: ['reels'] },
  format: 'mp4',
  options: { size: { scale: 2 }, lane: 'cloud' },
};

const procs: Subprocess[] = [];
const servers: Array<ReturnType<typeof Bun.serve>> = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
  for (const s of servers) s.stop(true);
});

interface Seen {
  method: string;
  path: string;
  auth: string | null;
  body: Record<string, unknown> | null;
}

function fakeHub(capabilities: string[]) {
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      const text = req.method === 'POST' ? await req.text() : '';
      seen.push({
        method: req.method,
        path: url.pathname,
        auth: req.headers.get('authorization'),
        body: text ? JSON.parse(text) : null,
      });
      if (url.pathname === '/health') return Response.json({ ok: true, capabilities });
      if (url.pathname === '/_cell/state') return Response.json({ state: 'running' });
      if (url.pathname === '/api/projects/current/v1/render-jobs' && req.method === 'POST')
        return Response.json({ jobId: 'ignored' }, { status: 202 });
      if (url.pathname.endsWith('/file'))
        return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), {
          headers: { 'x-maude-filename': 'Hype.mp4' },
        });
      if (url.pathname.startsWith('/api/projects/current/v1/render-jobs/'))
        return Response.json({ state: 'done' });
      return new Response('not found', { status: 404 });
    },
  });
  servers.push(server);
  return { seen, url: `http://127.0.0.1:${server.port}` };
}

async function bootLinked(hubUrl: string) {
  const sb = makeSandbox();
  mkdirSync(join(sb.designRoot, 'ui'), { recursive: true });
  writeFileSync(join(sb.designRoot, 'ui', 'video-hype.tsx'), CANVAS);
  const cfgPath = join(sb.designRoot, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.linkedHub = { url: hubUrl, linkedAt: Date.now() };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const hubsPath = join(sb.root, 'hubs.json');
  writeFileSync(
    hubsPath,
    JSON.stringify({ hubs: { [hubUrl]: { token: TOKEN, linkedAt: Date.now(), role: 'owner' } } })
  );
  const port = nextPort();
  procs.push(await bootServer(sb.root, port, { HUBS_CONFIG_PATH: hubsPath }));
  return { base: `http://localhost:${port}` };
}

const estimate = async (base: string) => {
  const r = await fetch(`${base}/_api/export-estimate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ spec: SPEC }),
  });
  expect(r.status).toBe(200);
  return ((await r.json()) as { render?: { cloud: boolean; suggest: string } }).render;
};

const until = async <T>(fn: () => Promise<T | undefined> | T | undefined, ms = 30_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error('timed out');
    await Bun.sleep(150);
  }
};

describe('S8.5b-3 boot: the Render row follows the linked hub’s capability', () => {
  test('a hub listing render-jobs-v1: the estimate offers the cloud for a 4K video', async () => {
    const hub = fakeHub(['annotations-v2', 'render-jobs-v1']);
    const { base } = await bootLinked(hub.url);
    const render = await until(async () => {
      const r = await estimate(base);
      return r?.cloud ? r : undefined;
    });
    expect(render).toMatchObject({ cloud: true, suggest: 'cloud' });
    // the capability probe carries no credential
    expect(hub.seen.filter((s) => s.path === '/health').every((s) => s.auth === null)).toBe(true);
  }, 90_000);

  test('a hub without it: the Render row stays hidden', async () => {
    const hub = fakeHub(['annotations-v2']);
    const { base } = await bootLinked(hub.url);
    await until(() => (hub.seen.some((s) => s.path === '/health') ? true : undefined));
    expect(await estimate(base)).toEqual({ cloud: false, suggest: 'this-mac', why: null });
  }, 90_000);

  test('a cloud video goes through the outbox to the hub’s door and comes back as a file here', async () => {
    const hub = fakeHub(['annotations-v2', 'render-jobs-v1']);
    const { base } = await bootLinked(hub.url);
    await until(async () => ((await estimate(base))?.cloud ? true : undefined));
    const r = await fetch(`${base}/_api/export-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ v: 2, spec: SPEC }),
    });
    expect(r.status).toBe(202);
    const { jobId, runsOn } = (await r.json()) as { jobId: string; runsOn: string };
    expect(runsOn).toBe('cloud');
    const submit = await until(() =>
      hub.seen.find((s) => s.method === 'POST' && s.path.endsWith('/v1/render-jobs'))
    );
    expect(submit.auth).toBe(`Bearer ${TOKEN}`);
    expect(submit.body).toMatchObject({ jobId, label: expect.stringContaining('MP4') });
    const done = await until(async () => {
      const list = (await (await fetch(`${base}/_api/export-jobs`)).json()) as {
        jobs: Array<{ id: string; status: string }>;
      };
      const row = list.jobs.find((j) => j.id === jobId);
      return row?.status === 'done' ? row : undefined;
    });
    expect(done.status).toBe('done');
    const dl = await fetch(`${base}/_api/export-jobs/download?id=${jobId}`);
    expect(dl.status).toBe(200);
    expect(new Uint8Array(await dl.arrayBuffer()).byteLength).toBe(8);
    // the token travelled in the header only
    expect(hub.seen.some((s) => s.path.includes(TOKEN))).toBe(false);
  }, 120_000);
});
