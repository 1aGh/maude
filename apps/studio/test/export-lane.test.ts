// feature-cloud-export-render-workers (DDR-230) — the render-lane dispatch.
//
// The queue's contract must hold in all three lanes:
//   local  — pre-render-workers behavior, byte-identical (covered by
//            test/exporters/jobs.test.ts; not re-proven here).
//   none   — browser formats refuse BEFORE taking a render slot, with the
//            remedy message; zip still runs in-cell.
//   remote — browser formats POST the fully-resolved job to the render
//            service with the member's canvas grant, and the artifact comes
//            back as a normal job result.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBus } from '../context.ts';
import type { ExportContext } from '../exporters/index.ts';
import { createExportJobQueue, type EnqueueArgs } from '../exporters/jobs.ts';
import { NO_RENDER_SERVICE_MESSAGE, REMOTE_UNSUPPORTED_MESSAGE } from '../exporters/remote.ts';
import { resolveRenderLane } from '../workspace-mode.ts';

const SAVED = {
  mode: process.env.MAUDE_WORKSPACE_MODE,
  url: process.env.MAUDE_RENDER_URL,
  secret: process.env.MAUDE_RENDER_SECRET,
};

function setLane(lane: 'local' | 'remote' | 'none', url?: string): void {
  if (lane === 'local') {
    delete process.env.MAUDE_WORKSPACE_MODE;
    delete process.env.MAUDE_RENDER_URL;
  } else {
    process.env.MAUDE_WORKSPACE_MODE = '1';
    if (lane === 'remote') process.env.MAUDE_RENDER_URL = url ?? 'http://127.0.0.1:1';
    else delete process.env.MAUDE_RENDER_URL;
  }
}

afterEach(() => {
  if (SAVED.mode === undefined) delete process.env.MAUDE_WORKSPACE_MODE;
  else process.env.MAUDE_WORKSPACE_MODE = SAVED.mode;
  if (SAVED.url === undefined) delete process.env.MAUDE_RENDER_URL;
  else process.env.MAUDE_RENDER_URL = SAVED.url;
  if (SAVED.secret === undefined) delete process.env.MAUDE_RENDER_SECRET;
  else process.env.MAUDE_RENDER_SECRET = SAVED.secret;
});

function sandboxDesignRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'maude-lane-'));
  const design = join(root, '.design');
  mkdirSync(join(design, 'ui'), { recursive: true });
  writeFileSync(join(design, 'ui', 'Home.tsx'), 'export default function Home(){return null}\n');
  return design;
}

function baseArgs(
  designRoot: string,
  format: EnqueueArgs['format'],
  scope: EnqueueArgs['scope']
): EnqueueArgs {
  const repoRoot = join(designRoot, '..');
  const ctx: ExportContext = {
    designRoot,
    repoRoot,
    serverOrigin: 'http://127.0.0.1:1', // never reached in these tests
  };
  return {
    format,
    scope,
    options: {},
    resolve: {
      activeJson: { active: '.design/ui/Home.tsx', selected: null },
      designRoot,
      repoRoot,
    },
    ctx,
    remoteCanvas: { origin: 'https://tenant.example', token: 'tok-abc' },
  };
}

describe('resolveRenderLane', () => {
  test('local off-workspace; remote/none track MAUDE_RENDER_URL in a workspace', () => {
    setLane('local');
    expect(resolveRenderLane()).toBe('local');
    setLane('none');
    expect(resolveRenderLane()).toBe('none');
    setLane('remote', 'http://127.0.0.1:9');
    expect(resolveRenderLane()).toBe('remote');
    // A laptop with MAUDE_RENDER_URL exported by accident stays local — the
    // lane never dispatches outside workspace mode.
    delete process.env.MAUDE_WORKSPACE_MODE;
    expect(resolveRenderLane()).toBe('local');
  });
});

describe('lane none', () => {
  test('a browser format fails fast with the remedy, without taking a slot', async () => {
    setLane('none');
    const design = sandboxDesignRoot();
    const queue = createExportJobQueue(createBus(), design);
    const { id, result } = queue.enqueue(baseArgs(design, 'png', 'artboard'));
    await expect(result).rejects.toThrow(NO_RENDER_SERVICE_MESSAGE);
    const job = queue.get(id);
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe(NO_RENDER_SERVICE_MESSAGE);
  });

  test('zip still exports in-cell — browser-free formats ignore the lane', async () => {
    setLane('none');
    const design = sandboxDesignRoot();
    const queue = createExportJobQueue(createBus(), design);
    const { result } = queue.enqueue(baseArgs(design, 'zip', 'project-raw'));
    const res = await result;
    expect(res.contentType).toBe('application/zip');
    expect(res.body.byteLength).toBeGreaterThan(0);
  });
});

describe('lane remote', () => {
  test('canva refuses with the desktop remedy even when a service is configured', async () => {
    setLane('remote', 'http://127.0.0.1:9');
    const design = sandboxDesignRoot();
    const queue = createExportJobQueue(createBus(), design);
    const { id, result } = queue.enqueue(baseArgs(design, 'canva', 'canvas-as-separate'));
    await expect(result).rejects.toThrow(REMOTE_UNSUPPORTED_MESSAGE);
    expect(queue.get(id)?.status).toBe('failed');
  });

  test('a browser format POSTs the resolved job and the artifact comes back', async () => {
    const seen: { auth?: string | null; body?: Record<string, unknown> } = {};
    const service = Bun.serve({
      // the lane asks 127.0.0.1:<port>; bound to every address, another listener on the same port's
      // IPv4 loopback (seen on the mini) answers instead
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (req) => {
        seen.auth = req.headers.get('authorization');
        seen.body = (await req.json()) as Record<string, unknown>;
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: {
            'content-type': 'image/png',
            'x-maude-filename': 'home.png',
            // A realistic degradation PLUS the hostile shapes the sanitizer
            // exists for: `fontsNotEmbedded` is rendered with `.join(', ')` in
            // the panel, so a non-array there would TypeError the export UI,
            // and unbounded strings land in the on-disk history ledger.
            'x-maude-degraded': JSON.stringify({
              reason: 'r',
              remedy: 'm',
              fontsNotEmbedded: ['Ok-Font', 42, { evil: true }, 'x'.repeat(500)],
              audioDropped: 'yes-please',
              // #150 §4 — the worker's pre-render parity warning: strings only, clamped
              unsupportedFeatures: [
                'a background-image url() is not drawn - div.camo',
                7,
                'y'.repeat(900),
              ],
              extra: 'dropped',
            }),
          },
        });
      },
    });
    try {
      setLane('remote', `http://127.0.0.1:${service.port}`);
      process.env.MAUDE_RENDER_SECRET = 'shh';
      const design = sandboxDesignRoot();
      const queue = createExportJobQueue(createBus(), design);
      const { id, result } = queue.enqueue(baseArgs(design, 'png', 'artboard'));
      const res = await result;

      expect(res.filename).toBe('home.png');
      expect(res.contentType).toBe('image/png');
      expect(res.body).toEqual(new Uint8Array([137, 80, 78, 71]));
      // Sanitized at the boundary, not passed through: non-strings dropped from
      // the array, over-long entries clamped, `audioDropped` kept only when it
      // is literally true, unknown keys discarded.
      expect(res.degraded?.reason).toBe('r');
      expect(res.degraded?.remedy).toBe('m');
      expect(res.degraded?.fontsNotEmbedded).toEqual(['Ok-Font', 'x'.repeat(200)]);
      expect(res.degraded?.audioDropped).toBeUndefined();
      expect(res.degraded?.unsupportedFeatures).toEqual([
        'a background-image url() is not drawn - div.camo',
        'y'.repeat(400),
      ]);
      expect(Object.keys(res.degraded ?? {})).not.toContain('extra');

      // The wire contract: bearer ingress, resolved targets (pure data), the
      // member's canvas grant — and nothing else (no fs paths leak).
      expect(seen.auth).toBe('Bearer shh');
      expect(seen.body?.format).toBe('png');
      const targets = seen.body?.targets as Array<Record<string, unknown>>;
      expect(targets).toHaveLength(1);
      expect(targets[0]?.kind).toBe('element');
      expect(targets[0]?.file).toBe('.design/ui/Home.tsx');
      expect(seen.body?.canvas).toEqual({ origin: 'https://tenant.example', token: 'tok-abc' });

      // Job lifecycle + bytes-on-disk contract holds on the remote lane too.
      const job = queue.get(id);
      expect(job?.status).toBe('done');
      expect(job?.degraded?.reason).toBe('r');
      expect(job?.degraded?.fontsNotEmbedded).toEqual(['Ok-Font', 'x'.repeat(200)]);
      const dl = await queue.getBytes(id);
      expect(dl.ok).toBe(true);
    } finally {
      service.stop(true);
    }
  });

  test('a hostile filename header cannot escape the job directory (path traversal)', async () => {
    // security-review defender: x-maude-filename lands in Bun.write(join(dir, name)).
    const service = Bun.serve({
      // the lane asks 127.0.0.1:<port>; bound to every address, another listener on the same port's
      // IPv4 loopback (seen on the mini) answers instead
      hostname: '127.0.0.1',
      port: 0,
      fetch: () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            'content-type': 'image/png',
            // Traversal AND a header-injection attempt in one — both must die.
            'x-maude-filename': '../../../../etc/pw"ned.png',
          },
        }),
    });
    try {
      setLane('remote', `http://127.0.0.1:${service.port}`);
      const design = sandboxDesignRoot();
      const queue = createExportJobQueue(createBus(), design);
      const { result } = queue.enqueue(baseArgs(design, 'png', 'artboard'));
      const res = await result;
      // basename() drops the whole directory prefix — no separators, no `..`.
      expect(res.filename).toBe('pwned.png');
      expect(res.filename).not.toContain('/');
      expect(res.filename).not.toContain('..');
    } finally {
      service.stop(true);
    }
  });

  test('an oversized artifact is refused rather than buffered whole (OOM cap)', async () => {
    // A body over the cap (the cap floors at 1 MB, so the body must clear it).
    const service = Bun.serve({
      // the lane asks 127.0.0.1:<port>; bound to every address, another listener on the same port's
      // IPv4 loopback (seen on the mini) answers instead
      hostname: '127.0.0.1',
      port: 0,
      fetch: () =>
        new Response(new Uint8Array(1_100_000), { headers: { 'content-type': 'image/png' } }),
    });
    try {
      setLane('remote', `http://127.0.0.1:${service.port}`);
      process.env.MAUDE_RENDER_MAX_ARTIFACT_BYTES = '1000000';
      const design = sandboxDesignRoot();
      const queue = createExportJobQueue(createBus(), design);
      const { id, result } = queue.enqueue(baseArgs(design, 'png', 'artboard'));
      await expect(result).rejects.toThrow(/too large|exceeded/);
      expect(queue.get(id)?.status).toBe('failed');
    } finally {
      service.stop(true);
      delete process.env.MAUDE_RENDER_MAX_ARTIFACT_BYTES;
    }
  });

  test('a refusing service surfaces its reason as the job error', async () => {
    const service = Bun.serve({
      // the lane asks 127.0.0.1:<port>; bound to every address, another listener on the same port's
      // IPv4 loopback (seen on the mini) answers instead
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response('bad token', { status: 403 }),
    });
    try {
      setLane('remote', `http://127.0.0.1:${service.port}`);
      const design = sandboxDesignRoot();
      const queue = createExportJobQueue(createBus(), design);
      const { id, result } = queue.enqueue(baseArgs(design, 'pdf', 'artboard'));
      await expect(result).rejects.toThrow(/render service refused the job: bad token/);
      expect(queue.get(id)?.status).toBe('failed');
    } finally {
      service.stop(true);
    }
  });
});
