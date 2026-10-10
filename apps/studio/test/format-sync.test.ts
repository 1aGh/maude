// The sync side of the project file format — V2-1.12 §5.4, §5.6, §5.7 P1, §5.9
// (V2-2.18). What a studio DECLARES to its hub, what it LEARNS from it, that it
// sends nothing up while gated, that a 426 is never a credential failure, and
// the first-sight cold-start row.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CELL_SELF_HUB, formatHubUrl, readHubFormatCache, SUPPORTED_FORMAT } from '../format.ts';
import {
  decideAnnotationsColdStart,
  decideColdStart,
  decideCssColdStart,
} from '../sync/cold-start.ts';
import { applyColdStart } from '../sync/cold-start-apply.ts';
import {
  declaredFormat,
  formatFromHub,
  formatGated,
  isFormatFirstSight,
  isFormatRefusal,
  learnHubFormat,
  SYNC_FORMAT_GATE_OPTS,
  withFormatHeader,
  withFormatParam,
} from '../sync/format-sync.ts';
import { hubHealth } from '../sync/journal-client.ts';
import { createTransactionClient, type ProposalResult } from '../sync/transaction-client.ts';

const HUB = 'https://hub.test';
const quiet = { log() {}, warn() {}, error() {} };
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'format-sync-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ctx = (formatVersion?: number) => ({
  cfg: { formatVersion, linkedHub: { url: HUB } },
  paths: { designRoot: dir },
});
/** A format NEWER than this build — what 1.x sees on a Maude 2 project. */
const NEWER = SUPPORTED_FORMAT + 1;

describe('declare', () => {
  test('the header rides every request; the base fetch is resolved at call time', async () => {
    const seen: Array<string | null> = [];
    const base = (async (_u: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('x-maude-format'));
      return new Response('{}');
    }) as unknown as typeof fetch;
    let n = 1;
    const f = withFormatHeader(base, () => n);
    await f(`${HUB}/api/file/a`, { method: 'PUT', headers: { authorization: 'Bearer t' } });
    n = 2;
    await f(`${HUB}/x`);
    expect(seen).toEqual(['1', '2']);
  });

  test('the socket URL carries maude-format and keeps its own query', () => {
    expect(withFormatParam('wss://h.test', 1)).toBe('wss://h.test/?maude-format=1');
    expect(withFormatParam('ws://127.0.0.1:4400/?a=b', 2)).toBe(
      'ws://127.0.0.1:4400/?a=b&maude-format=2'
    );
    expect(withFormatParam('wss://h.test', undefined)).toBe('wss://h.test');
  });

  test('editable → the project format; gated → this build’s own (a mismatch the hub sees)', () => {
    expect(declaredFormat(ctx())).toBe(1);
    expect(formatGated(ctx())).toBe(false);
    // The hub says the project is newer than this build: gated, declares its own.
    learnHubFormat(ctx(), { formatVersion: NEWER });
    expect(formatGated(ctx())).toBe(true);
    expect(declaredFormat(ctx())).toBe(SUPPORTED_FORMAT);
  });

  test('the sync gate uses the SAME options as the HTTP gate (http.ts FORMAT_GATE_OPTS)', () => {
    const http = readFileSync(join(import.meta.dir, '..', 'http.ts'), 'utf8');
    const m = /const FORMAT_GATE_OPTS = (\{[^}]*\})/.exec(http);
    expect(m).not.toBeNull();
    const opts = Function(`return (${(m as RegExpExecArray)[1]})`)();
    expect(opts).toEqual(SYNC_FORMAT_GATE_OPTS);
  });
});

describe('learn', () => {
  test('/health → formatVersion (null when unread or absent)', async () => {
    const f = (body: unknown) =>
      (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
    expect(
      await hubHealth({
        hubUrl: HUB,
        fetchImpl: f({ capabilities: ['format-v2'], formatVersion: 2 }),
      })
    ).toEqual({ capabilities: ['format-v2'], formatVersion: 2 });
    expect(
      (await hubHealth({ hubUrl: HUB, fetchImpl: f({ formatVersion: null }) })).formatVersion
    ).toBe(null);
    expect(
      (await hubHealth({ hubUrl: HUB, fetchImpl: f({ capabilities: [] }) })).formatVersion
    ).toBe(null);
    expect(formatFromHub({ type: 'maude.mode', formatVersion: 2 })).toBe(2);
    expect(formatFromHub({ type: 'maude.mode' })).toBe(null);
  });

  test('raise-only from /health; the owner’s unflip lowers only with a NEWER epoch', () => {
    expect(learnHubFormat(ctx(), { formatVersion: 2, epoch: 3 })).toBe(true);
    expect(learnHubFormat(ctx(), { formatVersion: 1 })).toBe(false); // /health has no epoch
    expect(learnHubFormat(ctx(), { formatVersion: 1, epoch: 3 })).toBe(false); // not newer
    expect(readHubFormatCache(dir, HUB)?.formatVersion).toBe(2);
    expect(learnHubFormat(ctx(), { formatVersion: 1, epoch: 4 })).toBe(true); // the unflip
    expect(readHubFormatCache(dir, HUB)?.formatVersion).toBe(1);
    // Unlinked: nothing to learn.
    expect(learnHubFormat({ cfg: {}, paths: { designRoot: dir } }, { formatVersion: 2 })).toBe(
      false
    );
  });

  test('a hostile epoch (not a safe integer) can neither lower nor freeze the mirror', () => {
    expect(learnHubFormat(ctx(), { formatVersion: 2, epoch: 1e308 })).toBe(true);
    expect(readHubFormatCache(dir, HUB)?.epoch).toBe(0); // not recorded
    expect(learnHubFormat(ctx(), { formatVersion: 1, epoch: Number.POSITIVE_INFINITY })).toBe(
      false
    );
    expect(learnHubFormat(ctx(), { formatVersion: 1, epoch: 1 })).toBe(true); // a real unflip
  });

  test('in a cell the studio reads its OWN hub’s mirror (cell:self), linked or not', () => {
    const prev = process.env.MAUDE_WORKSPACE_MODE;
    const prevFile = process.env.MAUDE_HUB_FORMAT_FILE;
    // The hub-owned file (server.mjs onFormat → studio-child env), OUTSIDE the
    // checkout.
    const hubData = mkdtempSync(join(tmpdir(), 'format-sync-hub-'));
    const file = join(hubData, 'project-format.json');
    process.env.MAUDE_WORKSPACE_MODE = '1';
    process.env.MAUDE_HUB_FORMAT_FILE = file;
    try {
      const cellCtx = { cfg: {}, paths: { designRoot: dir } };
      expect(formatHubUrl(cellCtx)).toBe(CELL_SELF_HUB);
      expect(formatGated(cellCtx)).toBe(false);
      writeFileSync(file, JSON.stringify({ hub: CELL_SELF_HUB, formatVersion: NEWER, epoch: 1 }));
      expect(readHubFormatCache(dir, CELL_SELF_HUB)?.formatVersion).toBe(NEWER);
      expect(formatGated(cellCtx)).toBe(true);
      // The child never writes its hub's mirror, and nothing lands in the checkout.
      expect(learnHubFormat(cellCtx, { formatVersion: 1, epoch: 9 })).toBe(false);
      expect(existsSync(join(dir, '_state', 'hub-format.json'))).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.MAUDE_WORKSPACE_MODE;
      else process.env.MAUDE_WORKSPACE_MODE = prev;
      if (prevFile === undefined) delete process.env.MAUDE_HUB_FORMAT_FILE;
      else process.env.MAUDE_HUB_FORMAT_FILE = prevFile;
      rmSync(hubData, { recursive: true, force: true });
    }
  });

  test('a hub BELOW this copy’s config (an unflip not taken here yet) pauses outbound too', () => {
    learnHubFormat(ctx(2), { formatVersion: 2, epoch: 1 });
    expect(formatGated(ctx(2))).toBe(false);
    learnHubFormat(ctx(2), { formatVersion: 1, epoch: 2 }); // the owner's unflip
    expect(formatGated(ctx(2))).toBe(true);
  });

  test('a mirror an OLDER build wrote is first sight for this build', () => {
    mkdirSync(join(dir, '_state'), { recursive: true });
    writeFileSync(
      join(dir, '_state', 'hub-format.json'),
      JSON.stringify({ hub: HUB, formatVersion: 2, epoch: 1, seenAt: '' })
    );
    expect(isFormatFirstSight(ctx(), 2)).toBe(SUPPORTED_FORMAT > 1);
  });

  test('first sight = the mirror is absent or older than the hub (format 1 is never a flip)', () => {
    expect(isFormatFirstSight(ctx(), 1)).toBe(false);
    expect(isFormatFirstSight(ctx(), 2)).toBe(true);
    learnHubFormat(ctx(), { formatVersion: 2 });
    expect(isFormatFirstSight(ctx(), 2)).toBe(false);
    expect(isFormatFirstSight(ctx(), 3)).toBe(true);
  });

  test('426 with a format body is a format refusal; a 401/403 never is', () => {
    expect(isFormatRefusal(426, { reason: 'format' })).toBe(true);
    expect(isFormatRefusal(426, { status: 'rejected', code: 'format' })).toBe(true);
    expect(isFormatRefusal(426, null)).toBe(true);
    expect(isFormatRefusal(403, { reason: 'format' })).toBe(false);
    expect(isFormatRefusal(401, {})).toBe(false);
  });
});

describe('proposals while gated', () => {
  function hub() {
    const posts: string[] = [];
    let format = 1;
    const ok = (status: number, v: unknown) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const route = new URL(String(url)).pathname.replace(/^\/api\/projects\/[^/]+\/v1\//, '');
      if (route === 'bootstrap')
        return ok(200, {
          projectId: 'p1',
          mode: 'transactions',
          epoch: 1,
          revision: 0,
          docs: [],
          dirs: [],
        });
      if (route.startsWith('transactions/')) return ok(404, { code: 'absent' });
      const body = JSON.parse(String(init?.body)) as {
        transactionId: string;
        action: { label: string };
      };
      posts.push(body.action.label);
      const declared = Number(new Headers(init?.headers).get('x-maude-format') ?? '1');
      if (declared !== format)
        return ok(426, { protocol: 1, status: 'rejected', code: 'format', formatVersion: format });
      return ok(200, {
        protocol: 1,
        status: 'accepted',
        transactionId: body.transactionId,
        revision: posts.length,
      });
    }) as unknown as typeof fetch;
    return { posts, fetchImpl, setFormat: (n: number) => (format = n) };
  }
  const outbox = () =>
    existsSync(join(dir, '_state', 'outbox'))
      ? readdirSync(join(dir, '_state', 'outbox')).filter((n) => n.endsWith('.json'))
      : [];

  test('paused: nothing is sent, the proposal stays in the outbox, and goes once the gate lifts', async () => {
    const h = hub();
    let paused = true;
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: withFormatHeader(h.fetchImpl, () => 1),
      paused: () => paused,
      retryMs: 2,
      log: quiet,
    });
    try {
      await client.bootstrap();
      const p = client.propose({ label: 'held', operations: [{ op: 'dir.create', path: 'ui/H' }] });
      await new Promise((r) => setTimeout(r, 1300));
      expect(h.posts).toEqual([]);
      expect(outbox()).toHaveLength(1);
      paused = false;
      const r = await p;
      expect(r.status).toBe('accepted');
      expect(h.posts).toEqual(['held']);
    } finally {
      client.stop();
    }
  });

  test('a 426 format rejection is FINAL — one POST, no retry loop, no credential flag', async () => {
    const h = hub();
    h.setFormat(2);
    const results: ProposalResult[] = [];
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: withFormatHeader(h.fetchImpl, () => 1),
      retryMs: 2,
      log: quiet,
      onResult: (r) => results.push(r),
    });
    try {
      await client.bootstrap();
      const r = await client.propose({
        label: 'v1',
        operations: [{ op: 'dir.create', path: 'ui/V' }],
      });
      expect(r).toMatchObject({ status: 'rejected', code: 'format' });
      expect(h.posts).toEqual(['v1']);
      expect(outbox()).toEqual([]);
      expect(client.stats().credentialRefused ?? false).toBe(false);
      // Final, but the person's edit is KEPT ASIDE, never deleted.
      const kept = readdirSync(join(dir, '_history', '_outbox-recovery'));
      expect(kept.some((n) => n.endsWith('.format.json'))).toBe(true);
    } finally {
      client.stop();
    }
  });
});

describe('a queued proposal declares the format it was WRITTEN in', () => {
  test('an entry made under format 1 is sent as format 1, whatever the build declares later', async () => {
    const seen: Array<string | null> = [];
    let declared = 1;
    let paused = true;
    const ok = (status: number, v: unknown) =>
      new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const route = new URL(String(url)).pathname.replace(/^\/api\/projects\/[^/]+\/v1\//, '');
      if (route === 'bootstrap')
        return ok(200, {
          projectId: 'p1',
          mode: 'transactions',
          epoch: 1,
          revision: 0,
          docs: [],
          dirs: [],
        });
      if (route.startsWith('transactions/')) return ok(404, { code: 'absent' });
      const body = JSON.parse(String(init?.body)) as { transactionId: string };
      seen.push(new Headers(init?.headers).get('x-maude-format'));
      return ok(200, {
        protocol: 1,
        status: 'accepted',
        transactionId: body.transactionId,
        revision: 1,
      });
    }) as unknown as typeof fetch;
    const client = createTransactionClient({
      hubUrl: 'http://hub',
      token: () => 't',
      designRoot: dir,
      fetchImpl: withFormatHeader(fetchImpl, () => declared),
      paused: () => paused,
      declaredFormat: () => declared,
      retryMs: 2,
      log: quiet,
    });
    try {
      await client.bootstrap();
      const p = client.propose({ label: 'old', operations: [{ op: 'dir.create', path: 'ui/O' }] });
      await new Promise((r) => setTimeout(r, 50));
      declared = 2; // the build was updated while it waited
      paused = false;
      await p;
      expect(seen).toEqual(['1']);
    } finally {
      client.stop();
    }
  });
});

describe('§5.9 — first sight of a format flip (evaluated before newest-wins)', () => {
  const base = {
    journalHash: null,
    localMtimeMs: 2_000,
    docBodyEditAtMs: 1_000, // local is NEWER — newest-wins would keep local
  };

  test('a divergent newer local loses to the hub, as a first-sight conflict', () => {
    const plain = decideColdStart({ ...base, localBody: 'local', docBody: 'hub' });
    expect(plain).toMatchObject({ action: 'conflict', winner: 'local' });
    const d = decideColdStart({
      ...base,
      localBody: 'local',
      docBody: 'hub',
      formatFirstSight: true,
    });
    expect(d).toMatchObject({ action: 'conflict', winner: 'hub', firstSight: true });
  });

  test('nothing is pushed: an empty hub keeps local on disk (noop), a seed-dup is hub-wins', () => {
    expect(
      decideColdStart({ ...base, localBody: 'local', docBody: '', formatFirstSight: true }).action
    ).toBe('noop');
    // A doubled body is still COLLAPSED (no new bytes; a hub-wins would write
    // the unbuildable doubled body to disk).
    expect(
      decideColdStart({ ...base, localBody: 'ab', docBody: 'abab', formatFirstSight: true }).action
    ).toBe('recover-seed-dup');
    // Rows that only read the hub stand.
    expect(
      decideColdStart({ ...base, localBody: null, docBody: 'hub', formatFirstSight: true }).action
    ).toBe('materialize-hub');
  });

  test('the per-lane tables never push local on first sight', () => {
    const ann = decideAnnotationsColdStart({
      local: '{"x":1}',
      doc: '',
      isEmpty: (s) => !s,
      localMtimeMs: 1,
      docEditAtMs: null,
      bodyWinner: 'hub',
      formatFirstSight: true,
    });
    expect(ann.winner).toBe('none');
    const css = decideCssColdStart({
      local: '.a{}',
      doc: null,
      journalHash: null,
      hash: (s) => s,
      bodyWinner: 'hub',
      formatFirstSight: true,
    });
    expect(css.winner).toBe('none');
  });

  test('apply: local snapshotted as pre-format-flip-local, conflict format-flip-local-kept, hub taken', async () => {
    const snaps: string[] = [];
    const conflicts: Array<{ kind: string; winner?: string }> = [];
    let took = '';
    const decision = decideColdStart({
      ...base,
      localBody: 'local',
      docBody: 'hub',
      formatFirstSight: true,
    });
    const r = await applyColdStart({
      slug: 'ui-a',
      decision,
      localBody: 'local',
      docBody: 'hub',
      takeHub: () => {
        took = 'hub';
      },
      takeLocal: () => {
        took = 'local';
      },
      snapshot: async (_c, reason) => {
        snaps.push(reason);
        return 't1';
      },
      onConflict: (i) => conflicts.push(i),
      log: quiet,
    });
    expect(took).toBe('hub');
    expect(snaps[0]).toBe('pre-format-flip-local');
    expect(conflicts).toEqual([
      expect.objectContaining({ kind: 'format-flip-local-kept', winner: 'hub' }),
    ]);
    expect(r.bodyWinner).toBe('hub');
  });

  test('apply, snapshot FAILED: local untouched AND nothing pushed (fail-closed)', async () => {
    let took = '';
    const decision = decideColdStart({
      ...base,
      localBody: 'local',
      docBody: 'hub',
      formatFirstSight: true,
    });
    const conflicts: Array<{ kind: string; snapshotFailed?: boolean }> = [];
    await applyColdStart({
      slug: 'ui-a',
      decision,
      localBody: 'local',
      docBody: 'hub',
      takeHub: () => {
        took = 'hub';
      },
      takeLocal: () => {
        took = 'local';
      },
      snapshot: async () => null,
      onConflict: (i) => conflicts.push(i),
      log: quiet,
    });
    expect(took).toBe('');
    expect(conflicts[0]).toMatchObject({ kind: 'format-flip-local-kept', snapshotFailed: true });
  });
});

describe('§5.8 — a canvas that needs a newer canvas-lib says so', () => {
  test('a missing @maude/canvas-lib export in a NEWER project leads with the canvas line', async () => {
    const { buildCanvasModule } = await import('../canvas-build.ts');
    const { canvasFormatLine, isMissingCanvasLibExport, FORMAT_COPY } = await import(
      '../format.ts'
    );
    const src =
      "import { DCArtboard, ThisExportOnlyExistsInMaude2 } from '@maude/canvas-lib';\n" +
      'export default () => <DCArtboard><ThisExportOnlyExistsInMaude2 /></DCArtboard>;\n';
    const abs = join(dir, 'v2-only.tsx');
    await Bun.write(abs, src);
    let message = '';
    try {
      await buildCanvasModule(abs, src);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(isMissingCanvasLibExport(message)).toBe(true);
    const newer = {
      projectFormat: SUPPORTED_FORMAT + 1,
      supported: SUPPORTED_FORMAT,
      source: 'hub' as const,
    };
    expect(canvasFormatLine(message, newer)).toBe(FORMAT_COPY.newerCanvas);
    // Not gated, or another kind of error: the raw error stands alone.
    expect(canvasFormatLine(message, null)).toBeNull();
    expect(canvasFormatLine('Unexpected token', newer)).toBeNull();
  });
});
