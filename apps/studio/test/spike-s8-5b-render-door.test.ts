// SPIKE S8.5b — the cloud render door (contract: client/v2/contracts/S8.5b-cloud-render-door.md).
//
// Throwaway prototype of the two risky parts, against fakes only (no hub, cell, maude-render):
//   1. FRESHNESS — the cell renders its OWN synced copy. Before it does, it compares the desktop's
//      closure fingerprint (taken at SEND time) with its checkout. Does one closure walk agree on both
//      sides, name exactly the files that are behind, ignore teammates' edits outside the closure,
//      and never answer about a file the session cannot see (no existence oracle)? And is it cheap
//      enough to run on every send (measured on a real 191-canvas design root when present)?
//   2. THE BEARER SESSION — the hub door builds the cookie proxy's session from a peer token and
//      reuses `upstreamHeaders`. What must the door strip that the cookie lane forwards?
//   3. IDEMPOTENCY — the client's job id keyed by (owner, id); a foreign id answers like a missing one.
//
// The builder slices (S8.5b-1..3) replace these inline functions with the real modules.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
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
import { dirname, join, relative } from 'node:path';

import { sessionKeyFor, upstreamHeaders } from '../../hub/src/studio-proxy.mjs';
import { closureFor } from '../access/closure.ts';
import { diskProjectReader } from '../access/request.ts';
import { type Access, resolveAccess, sees } from '../access/scope.ts';

// ── 1. freshness ────────────────────────────────────────────────────────────────────────────────

const CODE_RE = /\.(tsx|ts|jsx|js|css|json)$/i;
/** One closure entry: code by content hash; a content-addressed asset by presence (its name IS its hash). */
type Expect = { rel: string; sha256: string | null };

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function closureOf(designRoot: string, canvasRel: string) {
  const access = resolveAccess({ v: 1, role: null, grants: [{ c: canvasRel, r: 'viewer' }] });
  return closureFor(
    access,
    diskProjectReader(designRoot, () => 'spike')
  );
}

/** Desktop side, at send time: what this Mac expects the cloud copy to hold for one canvas. */
function closureFingerprint(designRoot: string, canvasRel: string): Expect[] {
  const out: Expect[] = [];
  for (const rel of [...closureOf(designRoot, canvasRel).read].sort()) {
    const abs = join(designRoot, rel);
    if (CODE_RE.test(rel)) {
      out.push({ rel, sha256: existsSync(abs) ? sha(readFileSync(abs)) : null });
    } else if (rel.startsWith('assets/') && existsSync(abs)) {
      out.push({ rel, sha256: null });
    }
  }
  return out.filter((e) => e.sha256 !== null || e.rel.startsWith('assets/'));
}

/**
 * Cell side: is the checkout at least what the desktop sent? Only rels the SESSION can see are
 * judged (T9 — an out-of-closure rel in `expect` is skipped silently, so the answer is no oracle).
 */
function judgeFreshness(
  expectList: Expect[],
  cellRoot: string,
  visible: (rel: string) => boolean
): { ok: true } | { ok: false; behind: string[] } {
  const behind: string[] = [];
  for (const e of expectList.slice(0, 2000)) {
    if (!visible(e.rel)) continue;
    const abs = join(cellRoot, e.rel);
    if (!existsSync(abs)) behind.push(e.rel);
    else if (e.sha256 !== null && sha(readFileSync(abs)) !== e.sha256) behind.push(e.rel);
  }
  return behind.length ? { ok: false, behind } : { ok: true };
}

const FILES: Record<string, string> = {
  'config.json': JSON.stringify({ designSystems: [{ name: 'brand', path: 'system/brand' }] }),
  'ui/Hype.tsx': [
    `import { Card } from '../shared/Card';`,
    `import './Hype.css';`,
    `export default () => <><Card /><img src="assets/a1b2c3d4.png" /></>;`,
  ].join('\n'),
  'ui/Hype.meta.json': JSON.stringify({ designSystem: 'brand' }),
  'ui/Hype.css': '.h {}',
  'ui/Other.tsx': 'export default () => <div>other</div>;',
  'shared/Card.tsx': `import './card.css';\nexport const Card = () => <b>card</b>;`,
  'shared/card.css': '.card {}',
  'shared/Secret.tsx': 'export const Secret = 1;',
  'system/brand/colors_and_type.css': ':root{--bg-0:#fff}',
  'assets/a1b2c3d4.png': 'PNG',
};

function writeTree(root: string, files: Record<string, string>) {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
}

describe('freshness: the cell renders its synced copy only when it holds what this Mac sent', () => {
  let desk: string;
  let cell: string;
  beforeAll(() => {
    desk = mkdtempSync(join(tmpdir(), 's85b-desk-'));
    cell = mkdtempSync(join(tmpdir(), 's85b-cell-'));
    writeTree(desk, FILES);
    writeTree(cell, FILES);
  });
  afterAll(() => {
    rmSync(desk, { recursive: true, force: true });
    rmSync(cell, { recursive: true, force: true });
  });
  const all = () => true;

  test('the closure walk is the canvas, its sidecars, its imports, the DS and its static assets', () => {
    const rels = closureFingerprint(desk, 'ui/Hype.tsx').map((e) => e.rel);
    expect(rels).toContain('ui/Hype.tsx');
    expect(rels).toContain('ui/Hype.css');
    expect(rels).toContain('shared/Card.tsx');
    expect(rels).toContain('shared/card.css');
    expect(rels).toContain('system/brand/colors_and_type.css');
    expect(rels).toContain('assets/a1b2c3d4.png');
    expect(rels).not.toContain('ui/Other.tsx');
    expect(rels).not.toContain('shared/Secret.tsx');
  });

  test('in sync: ok', () => {
    expect(judgeFreshness(closureFingerprint(desk, 'ui/Hype.tsx'), cell, all)).toEqual({
      ok: true,
    });
  });

  test('a shared module edited on this Mac and not yet up: behind names exactly it', () => {
    writeFileSync(
      join(desk, 'shared/Card.tsx'),
      `import './card.css';\nexport const Card = () => <i>new</i>;`
    );
    expect(judgeFreshness(closureFingerprint(desk, 'ui/Hype.tsx'), cell, all)).toEqual({
      ok: false,
      behind: ['shared/Card.tsx'],
    });
    writeFileSync(join(cell, 'shared/Card.tsx'), readFileSync(join(desk, 'shared/Card.tsx')));
    expect(judgeFreshness(closureFingerprint(desk, 'ui/Hype.tsx'), cell, all)).toEqual({
      ok: true,
    });
  });

  test('a teammate edit OUTSIDE the closure never blocks the render', () => {
    writeFileSync(join(cell, 'ui/Other.tsx'), 'export default () => <div>teammate</div>;');
    expect(judgeFreshness(closureFingerprint(desk, 'ui/Hype.tsx'), cell, all)).toEqual({
      ok: true,
    });
  });

  test('a new import + asset made offline: both behind until they arrive', () => {
    writeFileSync(
      join(desk, 'ui/Hype.tsx'),
      `import { Card } from '../shared/Card';\nimport { Badge } from '../shared/Badge';\nimport './Hype.css';\nexport default () => <><Card /><Badge /><img src="assets/a1b2c3d4.png" /><img src="assets/feedface.png" /></>;`
    );
    writeFileSync(join(desk, 'shared/Badge.tsx'), 'export const Badge = () => null;');
    writeFileSync(join(desk, 'assets/feedface.png'), 'PNG2');
    const r = judgeFreshness(closureFingerprint(desk, 'ui/Hype.tsx'), cell, all);
    expect(r.ok).toBe(false);
    expect((r as { behind: string[] }).behind.sort()).toEqual(
      ['assets/feedface.png', 'shared/Badge.tsx', 'ui/Hype.tsx'].sort()
    );
  });

  test('no oracle: a canvas-only session listing a file outside its closure hears nothing about it', () => {
    const access: Access = resolveAccess({
      v: 1,
      role: null,
      grants: [{ c: 'ui/Hype.tsx', r: 'member' }],
    });
    const cl = closureOf(cell, 'ui/Hype.tsx');
    const visible = (rel: string) => sees(access, cl, rel);
    // a probe: one rel that exists outside the closure, one that does not exist at all
    const probe: Expect[] = [
      { rel: 'shared/Secret.tsx', sha256: 'x'.repeat(64) },
      { rel: 'shared/Nope.tsx', sha256: 'x'.repeat(64) },
    ];
    expect(judgeFreshness(probe, cell, visible)).toEqual({ ok: true });
    // …while an in-closure mismatch is still named
    expect(judgeFreshness([{ rel: 'ui/Hype.css', sha256: 'y'.repeat(64) }], cell, visible)).toEqual(
      {
        ok: false,
        behind: ['ui/Hype.css'],
      }
    );
  });
});

// Measured on a real design root (read-only). Skipped where it is absent.
const REAL = '/Users/iagh/git/studyfi/studyfi-design/.design';
test.skipIf(!existsSync(REAL))(
  'cost: one closure fingerprint per send on a 191-canvas design root',
  () => {
    const canvases: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('_') || e.name.startsWith('.') || e.name === 'node_modules') continue;
        const abs = join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else if (/\.tsx$/.test(e.name)) canvases.push(relative(REAL, abs));
      }
    };
    walk(REAL);
    const ms: number[] = [];
    const sizes: number[] = [];
    for (const c of canvases) {
      const t0 = performance.now();
      const fp = closureFingerprint(REAL, c);
      ms.push(performance.now() - t0);
      sizes.push(fp.length);
    }
    ms.sort((a, b) => a - b);
    sizes.sort((a, b) => a - b);
    const pick = (a: number[], q: number) =>
      a[Math.min(a.length - 1, Math.floor(a.length * q))] ?? 0;
    console.log(
      `[S8.5b] ${canvases.length} canvases · fingerprint ms p50 ${pick(ms, 0.5).toFixed(1)} p95 ${pick(ms, 0.95).toFixed(1)} max ${pick(ms, 1).toFixed(1)} · entries p50 ${pick(sizes, 0.5)} max ${pick(sizes, 1)}`
    );
    expect(canvases.length).toBeGreaterThan(0);
    // budget: a send may cost a fingerprint, not a second
    expect(pick(ms, 0.95)).toBeLessThan(1000);
  },
  // the budget under test is the per-send p95 above; walking ~200 canvases once is not bounded by bun's 5 s default
  // (25–30 s on a busy machine, p95 still 0.4 s) — that default turned a load spike into a red test
  120_000
);

// ── 2. the bearer session ───────────────────────────────────────────────────────────────────────

const hash = (s: string) => sha(s);

/** What `acceptedAuth` (hub server.mjs) answers for a peer token, as the door's session. */
function bearerSession(
  who: {
    actor: string;
    readOnly: boolean;
    access: { v: 1; role: string | null; grants?: { c: string; r: string }[] };
  },
  project: string
) {
  return {
    email: who.actor,
    role: who.access.role,
    access: who.access,
    canvasOnly: who.access.role === null,
    sessionKey: sessionKeyFor(project, who.actor, hash),
  };
}

/** The door's forward headers: the cookie lane's `upstreamHeaders`, minus the bearer itself. */
function doorHeaders(incoming: Record<string, string>, session: ReturnType<typeof bearerSession>) {
  const h = upstreamHeaders(incoming, {
    role: session.role ?? 'observer',
    access: session.access,
    user: session.email,
    sessionKey: session.sessionKey,
    publicUrl: 'https://alligators.cloud.maude.test',
    canvasOnly: session.canvasOnly,
    renderToken: 'R.viewer',
  }) as Record<string, string>;
  for (const k of Object.keys(h))
    if (k.toLowerCase() === 'authorization' || k.toLowerCase() === 'cookie') delete h[k];
  return h;
}

describe('bearer session: the cookie proxy’s session, built from a peer token', () => {
  const who = {
    actor: 'ann@example.com',
    readOnly: false,
    access: { v: 1 as const, role: 'member' },
  };
  const incoming = {
    authorization: 'Bearer T-peer-token',
    'x-maude-role': 'owner',
    'x-maude-job-id': 'i_attackerchosen00000',
    'x-maude-render-token': 'forged',
    'content-type': 'application/json',
  };

  test('the cookie lane would forward the bearer to the studio child — the door must drop it', () => {
    const raw = upstreamHeaders(incoming, { role: 'member', user: who.actor }) as Record<
      string,
      string
    >;
    expect(raw.authorization).toBe('Bearer T-peer-token');
    expect(doorHeaders(incoming, bearerSession(who, 't1')).authorization).toBeUndefined();
  });

  test('inbound x-maude-* never survives; the injected ones are the session’s', () => {
    const h = doorHeaders(incoming, bearerSession(who, 't1'));
    expect(h['x-maude-role']).toBe('member');
    expect(h['x-maude-readonly']).toBe('0');
    expect(h['x-maude-render-token']).toBe('R.viewer');
    expect(h['x-maude-job-id']).toBeUndefined();
  });

  test('a canvas-only token projects read-only and carries its grants in the claim', () => {
    const co = {
      actor: 'cy@example.com',
      readOnly: false,
      access: { v: 1 as const, role: null, grants: [{ c: 'ui/Hype.tsx', r: 'member' }] },
    };
    const h = doorHeaders(incoming, bearerSession(co, 't1'));
    expect(h['x-maude-readonly']).toBe('1');
    expect(h['x-maude-access']).toBeTruthy();
  });

  test('the desktop’s jobs share the person’s browser session key (one Exports list per person)', () => {
    expect(bearerSession(who, 't1').sessionKey).toBe(sessionKeyFor('t1', 'ann@example.com', hash));
  });
});

// ── 3. idempotency by the client's job id ───────────────────────────────────────────────────────

const JOB_ID_RE = /^i_[a-z0-9]{20}$/;

function createDoorLedger() {
  const byId = new Map<string, { owner: string; specHash: string }>();
  return {
    submit(
      owner: string,
      jobId: string,
      specHash: string
    ): 'new' | 'same' | 'conflict' | 'invalid' {
      if (!JOB_ID_RE.test(jobId)) return 'invalid';
      const had = byId.get(jobId);
      if (!had) {
        byId.set(jobId, { owner, specHash });
        return 'new';
      }
      // a replay is the same owner AND the same spec; anything else is not this job
      return had.owner === owner && had.specHash === specHash ? 'same' : 'conflict';
    },
    status(owner: string, jobId: string): 'known' | 'absent' {
      const had = byId.get(jobId);
      return had && had.owner === owner ? 'known' : 'absent';
    },
  };
}

describe('idempotency: the record id is the job id, end to end', () => {
  test('a replay after a crash gets the first job; a foreign owner hears absent', () => {
    const l = createDoorLedger();
    const id = 'i_abcdefghij0123456789';
    expect(l.submit('ann', id, 's1')).toBe('new');
    expect(l.submit('ann', id, 's1')).toBe('same');
    expect(l.submit('ann', id, 's2')).toBe('conflict');
    expect(l.submit('bob', id, 's1')).toBe('conflict');
    expect(l.status('bob', id)).toBe('absent');
    expect(l.status('ann', id)).toBe('known');
    expect(l.submit('ann', '../../etc', 's1')).toBe('invalid');
  });
});
