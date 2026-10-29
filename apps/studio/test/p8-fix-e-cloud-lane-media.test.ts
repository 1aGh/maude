// F9 (p8-fix-e) — the desktop cloud lane's media uploads failed against its local "cell" in 3 of 3 V2-8.3
// runs ("3 changes need your attention in project: 3 media uploads failed."), and cloud-attach.e2e.ts accepted
// that as a terminal state.
//
// Cause: the RIG. The lane's cell was a plain local hub with no checkout (no MAUDE_WORKSPACE_MODE). A hub with
// no checkout carries no journal, so the desktop took the legacy asset lane and every `PUT /assets/<key>` was
// answered `405 this hub does not accept file writes` (and `426` before a format-2 config reached it). Every real
// cell owns a checkout (a file door + journal), so the lane was testing a hub shape no cloud project has.
//
// This drives the lane's own cell helper (`startCloudLaneCell`, the one wdio.cloud.conf.ts starts) with the real
// sync runtime on a copy of the lane's fixture project, BOTH directions (desktop and cloud are not symmetric):
//   • desktop → cloud: the fixture's three media files land in the cell's checkout, byte-identical, and the
//     desktop's sync status reports no failed media;
//   • cloud → desktop: a file a teammate writes on the cell reaches the desktop's disk.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findNode24, startCloudLaneCell } from '../../desktop/e2e/fixtures/local-hub.mjs';
import { createRegistry } from '../collab/registry.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(import.meta.dir, '..', '..', 'desktop', 'e2e', 'fixtures', 'project');
const MEDIA = ['assets/aaaa1111.transcript.json', 'assets/pic.png', 'assets/song.beats.json'];

let node24: string | null = null;
try {
  node24 = findNode24();
} catch {
  node24 = null;
}
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3')) && node24 !== null;
if (!HUB_READY)
  console.warn('[p8-fix-e-cloud-lane-media] SKIPPED — needs apps/hub deps + Node 24.');

async function waitFor<T>(
  fn: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  what: string,
  ms = 30_000
): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (err) {
      last = err;
    }
    if (Date.now() > end)
      throw new Error(`timed out waiting for ${what}${last ? ` (${last})` : ''}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

function makeCtx(repoRoot: string, url: string): Context {
  const designRoot = join(repoRoot, '.design');
  const fixtureCfg = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
  return {
    canvasOrigin: 'http://canvas.localhost',
    sharedDoc: true,
    cfg: {
      name: fixtureCfg.name,
      projectLabel: null,
      designRoot: '.design',
      canvasGroups: fixtureCfg.canvasGroups,
      rootClass: fixtureCfg.rootClass,
      themeDefault: 'dark',
      tokensCssRel: 'system/colors.css',
      teamAccentDefault: null,
      handoffTargets: [],
      newCanvasDir: 'ui',
      newComponentDir: 'ui/components',
      formatVersion: 2,
      linkedHub: { url, linkedAt: 0, fileEvents: false },
      _source: 'defaults',
    },
    projectLabel: fixtureCfg.name,
    paths: {
      repoRoot,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '.design/system/colors.css',
      systemDirRel: 'system',
    },
    bus: createBus(),
  } as unknown as Context;
}

describe.skipIf(!HUB_READY)(
  'F9 — the cloud lane cell takes the desktop’s media, both directions',
  () => {
    let root: string;
    let cell: Awaited<ReturnType<typeof startCloudLaneCell>>;
    let runtime: SyncRuntime;
    let ctx: Context;
    const saved: Record<string, string | undefined> = {};

    beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), 'p8-fix-e-cloud-'));
      for (const k of [
        'HUBS_CONFIG_PATH',
        'MAUDE_SYNC_IN_CI',
        'MAUDE_SHARED_DOC',
        'MAUDE_CANVAS_ORIGIN_SPLIT',
      ])
        saved[k] = process.env[k];
      process.env.MAUDE_SYNC_IN_CI = '1';
      process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '1'; // as wdio.cloud.conf.ts
      const projectConfig = JSON.parse(
        readFileSync(join(FIXTURE, '.design', 'config.json'), 'utf8')
      );
      cell = await startCloudLaneCell({
        dir: join(root, 'cell'),
        cloudKey: `k-${Date.now()}-${'x'.repeat(32)}`,
        projectConfig,
        node: node24 as string,
      });
      // The lane's project: a copy of the fixture, `_*` runtime state left behind (wdio.cloud.conf.ts).
      const repo = join(root, 'project');
      cpSync(FIXTURE, repo, { recursive: true, filter: (src) => !/[/\\]_[^/\\]*$/.test(src) });
      const hubsFile = join(root, 'hubs.json');
      writeFileSync(
        hubsFile,
        JSON.stringify({ hubs: { [cell.http]: { token: cell.tokens.owner } } }),
        {
          mode: 0o600,
        }
      );
      process.env.HUBS_CONFIG_PATH = hubsFile;
      ctx = makeCtx(repo, cell.http);
      const registry = createRegistry({
        async seed() {},
        async persistJson() {},
        async persistBinary() {},
      });
      const rt = createSyncRuntime(ctx, {
        registry,
        transactionRetryMs: 100,
        auth: { renewCredential: async () => null },
      });
      if (!rt) throw new Error('the sync runtime refused to start');
      runtime = rt;
      await runtime.start();
    }, 60_000);

    afterAll(async () => {
      await runtime?.stop?.();
      cell?.stop();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(root, { recursive: true, force: true });
    });

    const syncStatus = () => {
      try {
        return JSON.parse(readFileSync(join(ctx.paths.designRoot, '_sync.json'), 'utf8')) as {
          assets?: { failedCount?: number; failures?: { key: string; reason: string }[] };
        };
      } catch {
        return null;
      }
    };

    test('desktop → cloud: the three media files land in the cell checkout and none is reported failed', async () => {
      // A cell with no checkout can never hold them — the wait then ends on the failed-media status.
      const checkout = cell.checkout ?? join(root, 'no-checkout');
      const landed = await waitFor(
        () => {
          const failed = syncStatus()?.assets?.failedCount ?? 0;
          if (failed > 0)
            throw new Error(
              `${failed} media upload(s) failed: ${JSON.stringify(syncStatus()?.assets?.failures)}`
            );
          return MEDIA.every((rel) => existsSync(join(checkout, '.design', rel)));
        },
        'the fixture media in the cell checkout',
        45_000
      ).catch((err) => {
        throw new Error(
          `${err.message} — sync status: ${JSON.stringify(syncStatus()?.assets ?? null)}`
        );
      });
      expect(landed).toBe(true);
      for (const rel of MEDIA) {
        expect(
          readFileSync(join(checkout, '.design', rel)).equals(
            readFileSync(join(FIXTURE, '.design', rel))
          )
        ).toBe(true);
      }
      expect(syncStatus()?.assets?.failedCount ?? 0).toBe(0);
    }, 60_000);

    test('cloud → desktop: a file a teammate writes on the cell reaches the desktop', async () => {
      const rel = 'assets/teammate.beats.json';
      const body = JSON.stringify({ bpm: 120, from: 'alice' });
      const res = await fetch(`${cell.http}/api/file/${rel}`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${cell.tokens.alice}`,
          'x-maude-format': '2',
          'content-type': 'application/json',
        },
        body,
      });
      expect(res.status).toBe(200);
      const onDesktop = join(ctx.paths.designRoot, rel);
      await waitFor(() => existsSync(onDesktop), 'the teammate file on the desktop', 45_000);
      expect(readFileSync(onDesktop, 'utf8')).toBe(body);
    }, 60_000);
  }
);
