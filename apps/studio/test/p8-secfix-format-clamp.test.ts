// p8-secfix-studio item 1 (V2-8.9 final delta F5 + D4): a hub-supplied format
// must not lock the project for good. The hub's format reaches the person's
// VERSIONED config.json on detach (studio), unlink/detach (CLI) and the pull
// seed — and `/health` is unauthenticated, so a hostile hub (or a plain-http
// MITM) saying 9007199254740991 used to leave the project "newer than this
// build" after leaving the hub, and in git. What is persisted is clamped to
// SUPPORTED_FORMAT; the in-memory mirror keeps an honest newer hub's value.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hubFormatToCarry } from '../../../cli/lib/design-link.mjs';
import { createCloudEndpoints } from '../cloud/endpoints.ts';
import type { Context } from '../context.ts';
import {
  asFormat,
  FORMAT_GATE_OPTS,
  formatGate,
  formatToKeep,
  noteHubFormat,
  persistableFormat,
  projectFormat,
  readHubFormatCache,
  SUPPORTED_FORMAT,
} from '../format.ts';
import { formatFromHub, MAX_HUB_FORMAT } from '../sync/format-sync.ts';
import { seedProjectConfig } from '../sync/index.ts';

const HUB = 'https://hostile.example.com';
const HUGE = Number.MAX_SAFE_INTEGER; // 9007199254740991
let scratch = '';

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'p8-fmt-clamp-'));
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

function linkedProject(name: string, mirror: number | null, cfg: Record<string, unknown> = {}) {
  const repoRoot = join(scratch, name);
  const designRoot = join(repoRoot, '.design');
  mkdirSync(designRoot, { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({ designRoot: '.design', ...cfg, linkedHub: { url: HUB, linkedAt: 1 } })
  );
  if (mirror !== null) noteHubFormat(designRoot, { hub: HUB, formatVersion: mirror });
  const read = () => JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
  return { repoRoot, designRoot, read };
}

describe('studio detach persists at most SUPPORTED_FORMAT', () => {
  async function detach(mirror: number | null, cfg: Record<string, unknown> = {}) {
    const p = linkedProject(`detach-${mirror}-${JSON.stringify(cfg).length}`, mirror, cfg);
    const api = createCloudEndpoints({
      paths: { repoRoot: p.repoRoot, designRoot: p.designRoot },
      syncControl: { restart: async () => ({ syncing: false, canvases: 0, reason: 'unlinked' }) },
    });
    expect((await api.detach()).status).toBe(200);
    return p;
  }

  test('a hub reporting 9007199254740991 leaves an editable format-2 project', async () => {
    const p = await detach(HUGE);
    const cfg = p.read();
    expect(cfg.linkedHub).toBeUndefined();
    expect(cfg.formatVersion).toBe(SUPPORTED_FORMAT);
    expect(formatGate({ cfg, paths: { designRoot: p.designRoot } }, FORMAT_GATE_OPTS)).toBeNull();
  });

  test('an honest format-2 hub still writes 2', async () => {
    expect((await detach(2)).read().formatVersion).toBe(2);
  });

  test('a config the person already set higher is never lowered', async () => {
    expect((await detach(HUGE, { formatVersion: 3 })).read().formatVersion).toBe(3);
  });
});

describe('pull seed persists at most SUPPORTED_FORMAT', () => {
  function seed(hubFormat: number) {
    const designRoot = join(scratch, `seed-${hubFormat}`, '.design');
    mkdirSync(designRoot, { recursive: true });
    const ctx = {
      cfg: { name: 'p', canvasGroups: [] },
      paths: { designRoot, designRel: '.design' },
    } as unknown as Context;
    expect(seedProjectConfig(ctx, new Set(['screens']), false, hubFormat)).toBe(true);
    return JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
  }

  test('a hub at 9007199254740991 seeds formatVersion 2', () => {
    expect(seed(HUGE).formatVersion).toBe(SUPPORTED_FORMAT);
  });
  test('an honest format-2 hub seeds 2; a 1.x hub seeds nothing', () => {
    expect(seed(2).formatVersion).toBe(2);
    expect('formatVersion' in seed(1)).toBe(false);
  });
});

describe('CLI hubFormatToCarry clamps exactly like the studio (parity pin)', () => {
  for (const [name, cfgFormat, mirror] of [
    ['huge mirror, absent config', undefined, HUGE],
    ['mirror one above this build', undefined, SUPPORTED_FORMAT + 1],
    ['huge mirror, config 1', 1, HUGE],
    ['huge mirror, config 3', 3, HUGE],
    ['honest mirror 2', undefined, 2],
  ] as Array<[string, unknown, number]>) {
    test(name, () => {
      const p = linkedProject(`parity-${name.replace(/\W+/g, '-')}`, mirror);
      const cfg = { formatVersion: cfgFormat, linkedHub: { url: HUB } };
      const kept = formatToKeep({ cfg, paths: { designRoot: p.designRoot } });
      expect(kept).toBeLessThanOrEqual(Math.max(SUPPORTED_FORMAT, asFormat(cfgFormat)));
      expect(hubFormatToCarry(cfg, p.designRoot) ?? asFormat(cfgFormat)).toBe(kept);
    });
  }
});

describe('the in-memory mirror keeps an honest newer hub, drops nonsense', () => {
  test('a newer-than-this-build hub still gates the project view only', () => {
    expect(formatFromHub({ formatVersion: SUPPORTED_FORMAT + 1 })).toBe(SUPPORTED_FORMAT + 1);
    expect(formatFromHub({ formatVersion: MAX_HUB_FORMAT })).toBe(MAX_HUB_FORMAT);
    const p = linkedProject('newer-hub', SUPPORTED_FORMAT + 1);
    const ctx = { cfg: { linkedHub: { url: HUB } }, paths: { designRoot: p.designRoot } };
    expect(projectFormat(ctx).value).toBe(SUPPORTED_FORMAT + 1);
    expect(formatGate(ctx, FORMAT_GATE_OPTS)).not.toBeNull();
  });
  test('a value no format numbering will reach is not a format', () => {
    expect(formatFromHub({ formatVersion: HUGE })).toBeNull();
    expect(formatFromHub({ formatVersion: MAX_HUB_FORMAT + 1 })).toBeNull();
    expect(formatFromHub({ formatVersion: 2.5 })).toBeNull();
    expect(formatFromHub({ formatVersion: 0 })).toBeNull();
  });
  test('persistableFormat never exceeds this build', () => {
    expect(persistableFormat(HUGE)).toBe(SUPPORTED_FORMAT);
    expect(persistableFormat(2)).toBe(2);
    expect(persistableFormat('junk')).toBe(1);
  });
});

// p8-secfix-hook-2 R5 (V2-8.9 final delta recheck): a mirror file written BEFORE the F5/D4 fix
// still holds the hostile hub's 2^53-1, and the mirror is raise-only, so an honest hub could never
// bring it back down: the project stayed view-only for as long as it was linked. The reader now
// clamps what it reads — past MAX_HUB_FORMAT a value is nonsense, read as the format detach would
// keep (SUPPORTED_FORMAT); an honest newer hub's value (≤ MAX_HUB_FORMAT) is kept as it was.
describe('a pre-fix mirror file is clamped on read (R5)', () => {
  test('2^53-1 on disk reads back ≤ MAX_HUB_FORMAT and leaves the project editable', () => {
    const p = linkedProject('pre-fix-mirror', HUGE);
    expect(
      JSON.parse(readFileSync(join(p.designRoot, '_state', 'hub-format.json'), 'utf8'))
    ).toMatchObject({ formatVersion: HUGE });
    const read = readHubFormatCache(p.designRoot, HUB);
    expect(read?.formatVersion).toBeLessThanOrEqual(MAX_HUB_FORMAT);
    expect(read?.formatVersion).toBe(SUPPORTED_FORMAT);
    const ctx = { cfg: { linkedHub: { url: HUB } }, paths: { designRoot: p.designRoot } };
    expect(formatGate(ctx, FORMAT_GATE_OPTS)).toBeNull();
    // an honest hub one format ahead can still raise it (raise-only from the clamped value)
    expect(noteHubFormat(p.designRoot, { hub: HUB, formatVersion: SUPPORTED_FORMAT + 1 })).toBe(
      true
    );
    expect(readHubFormatCache(p.designRoot, HUB)?.formatVersion).toBe(SUPPORTED_FORMAT + 1);
  });
  test('an honest newer hub up to MAX_HUB_FORMAT reads back unchanged', () => {
    for (const v of [SUPPORTED_FORMAT + 1, MAX_HUB_FORMAT]) {
      const p = linkedProject(`honest-mirror-${v}`, v);
      expect(readHubFormatCache(p.designRoot, HUB)?.formatVersion).toBe(v);
    }
  });
});

test('the CLI restatement of SUPPORTED_FORMAT matches the studio', async () => {
  const { CLI_SUPPORTED_FORMAT } = await import('../../../cli/lib/design-link.mjs');
  expect(CLI_SUPPORTED_FORMAT).toBe(SUPPORTED_FORMAT);
});
