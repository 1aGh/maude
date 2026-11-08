// #172 — "Added by Tereza" on an asset a teammate brought in, on EVERY peer (contract
// client/v2/contracts/172-asset-origins.md). Two desktops, one REAL hub (spawned under Node —
// Bun cannot load the hub's better-sqlite3), both directions: cloud and desktop are not
// symmetric, and a lane that works one way has hidden defects the other way before.
//
// Each peer imports a picture on its own Mac, the who-added sidecar travels through the hub's
// file door, and the other peer's Assets details say who added it — while the per-Mac original
// path (`_canvas-state/asset-origins.json`) never leaves the Mac that imported it.

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addedRelOf, recordAssetAdded } from '../asset-added.ts';
import { assetDetails } from '../asset-details.ts';
import { ORIGINS_REL, recordAssetOrigin } from '../asset-origins.ts';
import { createFileLedger } from '../sync/file-ledger.ts';
import { createFilePlane } from '../sync/file-plane.ts';
import { hasAssetAddedV1 } from '../sync/journal-client.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY) {
  console.warn('[sync-asset-added-two-peer] real-hub test SKIPPED — apps/hub deps not installed.');
}

let work: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'asset-added-2peer-'));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

interface Hub {
  proc: ChildProcess;
  http: string;
  tokens: Record<string, string>;
}

function startHub(dataDir: string, repoDir: string): Promise<Hub> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0', '--asset-write-rate-limit', '100000'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // A workspace-mode hub holds a checkout, so its file door takes writes (as a cell's does).
      env: { ...process.env, MAUDE_WORKSPACE_MODE: '1', MAUDE_REPO_DIR: repoDir, NO_OPEN: '1' },
    });
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`hub did not start: ${buf}`)), 20_000);
    proc.stdout?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
      for (const line of buf.split('\n')) {
        if (!line.startsWith('{')) continue;
        clearTimeout(timer);
        const info = JSON.parse(line);
        resolve({ proc, http: info.http, tokens: info.tokens });
        return;
      }
    });
    proc.stderr?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
    });
  });
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Import a picture on one Mac, as `maude design import-asset --added-by` does: bytes, origin, who added it. */
function importOn(designRoot: string, label: string, by: string): string {
  const bytes = Buffer.concat([PNG_SIG, Buffer.from(`picture from ${label}`)]);
  const rel = `assets/${createHash('sha256').update(bytes).digest('hex').slice(0, 8)}.png`;
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  writeFileSync(join(designRoot, rel), bytes);
  recordAssetOrigin(designRoot, rel, `/Users/${label}/Pictures/${label}.png`, Date.now(), by);
  expect(recordAssetAdded(designRoot, rel, by)).toBe(true);
  return rel;
}

/** What the Assets details say on a Mac that did NOT import the picture (a project session there). */
const detailsOn = (designRoot: string, rel: string) =>
  assetDetails(rel, {
    designRoot,
    usedIn: [],
    readCanvas: () => null,
    includeOriginal: true,
    home: '/Users/nobody',
  });

test.skipIf(!HUB_READY)(
  'who added an asset reaches the other desktop through a real hub, in both directions',
  async () => {
    mkdirSync(join(work, 'hubrepo', '.design'), { recursive: true });
    const hub = await startHub(join(work, 'hub'), join(work, 'hubrepo'));
    try {
      const health = (await (await fetch(`${hub.http}/health`)).json()) as {
        capabilities?: string[];
      };
      // the hub says the word, so each desktop offers the sidecar instead of holding it
      expect(hasAssetAddedV1(health.capabilities ?? null)).toBe(true);
      const peer = (label: string, token: string) => {
        const designRoot = join(work, label, 'design');
        mkdirSync(designRoot, { recursive: true });
        const ledger = createFileLedger({ designRoot, hubUrl: hub.http, flushMs: 0 });
        const plane = createFilePlane({
          designRoot,
          hubUrl: hub.http,
          token: () => token,
          ledger,
          allowCodeModules: false,
          label,
          hubTakesAddedFiles: hasAssetAddedV1(health.capabilities ?? null),
          log: { log() {}, warn() {} },
        });
        return { designRoot, plane };
      };
      // two teammates, each with her own member credential (the fixture hub's `tereza` and `bob`)
      const tereza = peer('tereza', hub.tokens.tereza as string);
      const jonas = peer('jonas', hub.tokens.bob as string);
      expect(typeof hub.tokens.tereza).toBe('string');
      expect(typeof hub.tokens.bob).toBe('string');

      // A → B: Tereza brings a picture in on her Mac
      const hers = importOn(tereza.designRoot, 'tereza', 'Tereza');
      const up = await tereza.plane.reconcile();
      expect(up.failed).toEqual([]);
      expect(up.hubRefused).toBeUndefined();
      expect(up.pushed.sort()).toEqual([addedRelOf(hers), hers].sort());
      const down = await jonas.plane.reconcile();
      expect(down.failed).toEqual([]);
      expect(existsSync(join(jonas.designRoot, hers))).toBe(true);
      const onJonas = detailsOn(jonas.designRoot, hers);
      expect(onJonas?.addedBy).toBe('Tereza');
      expect(onJonas?.advanced.original).toBeUndefined(); // the path stayed on her Mac
      expect(existsSync(join(jonas.designRoot, ORIGINS_REL))).toBe(false);

      // B → A: Jonas brings one in on his
      const his = importOn(jonas.designRoot, 'jonas', 'Jonas');
      const up2 = await jonas.plane.reconcile();
      expect(up2.failed).toEqual([]);
      expect(up2.pushed.sort()).toEqual([addedRelOf(his), his].sort());
      const down2 = await tereza.plane.reconcile();
      expect(down2.failed).toEqual([]);
      const onTereza = detailsOn(tereza.designRoot, his);
      expect(onTereza?.addedBy).toBe('Jonas');
      expect(onTereza?.advanced.original).toBeUndefined();
      // her own Mac still knows her own picture's Original, and her record was not touched by the round trip
      expect(detailsOn(tereza.designRoot, hers)?.addedBy).toBe('Tereza');
      expect(readFileSync(join(tereza.designRoot, ORIGINS_REL), 'utf8')).not.toContain('jonas');

      // nothing synced names a path or an e-mail
      for (const rel of [addedRelOf(hers), addedRelOf(his)] as string[]) {
        for (const root of [tereza.designRoot, jonas.designRoot]) {
          const text = readFileSync(join(root, rel), 'utf8');
          expect(text).not.toContain('/Users/');
          expect(text).not.toContain('@');
        }
      }
    } finally {
      hub.proc.kill('SIGTERM');
    }
  },
  120_000
);
