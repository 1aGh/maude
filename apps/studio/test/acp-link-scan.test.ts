// S3 (universal-ACP security review, defender H1) — acp/agents/link-scan.ts: an agent whose reads
// are judged by its own permission engine (opencode, Gemini, Copilot) does not start while a root
// it is given holds a link out of the read roots. The walk never follows a link and fails closed
// on what it cannot finish.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CLAUDE, CODEX, COPILOT, GEMINI, OPENCODE } from '../acp/agents/catalog.ts';
import type { AgentDescriptor } from '../acp/agents/descriptor.ts';
import { assertNoUnsafeLinks, scanLinks, UnsafeLinkError } from '../acp/agents/link-scan.ts';
import { agentSpawn } from '../acp/agents/spawn.ts';

let tmp: string;
let n = 0;
beforeAll(() => {
  // Spelled as tmpdir() spells it (`/var/folders/…` → `/private/var/…` on macOS) on purpose.
  tmp = mkdtempSync(join(tmpdir(), 'acp-link-scan-'));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const NO_CRED = { dirs: [], files: [] };

function world() {
  const base = join(tmp, `w${++n}`);
  const project = join(base, 'proj');
  const outside = join(base, 'outside');
  mkdirSync(join(project, 'src'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(project, 'src', 'a.txt'), 'a');
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  return { base, project, outside };
}

const scan = (project: string, over: Partial<Parameters<typeof scanLinks>[0]> = {}) =>
  scanLinks({ roots: [project], readRoots: [project], credentialPaths: NO_CRED, ...over });

describe('scanLinks', () => {
  test('a project with no link, or only links inside it, is ok', () => {
    const w = world();
    expect(scan(w.project)).toMatchObject({ ok: true });
    symlinkSync(join(w.project, 'src', 'a.txt'), join(w.project, 'in-link'));
    symlinkSync('src', join(w.project, 'dir-link')); // relative, to a folder inside
    symlinkSync('.', join(w.project, 'self')); // to the root itself
    expect(scan(w.project)).toMatchObject({ ok: true });
  });

  test('a link to a file outside the read roots → escape, naming the link', () => {
    const w = world();
    const link = join(w.project, 'src', 'ref-link');
    symlinkSync(join(w.outside, 'secret.txt'), link);
    const r = scan(w.project);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('escape');
    expect(realpathSync(r.path as string)).toBe(realpathSync(link));
    expect(r.target).toBe(realpathSync(join(w.outside, 'secret.txt')));
  });

  test('a link to a folder outside → escape (never followed); a dangling one inside it is not reached', () => {
    const w = world();
    symlinkSync(join(w.outside, 'gone'), join(w.outside, 'dangling'));
    symlinkSync(w.outside, join(w.project, 'out-dir'));
    expect(scan(w.project)).toMatchObject({ ok: false, reason: 'escape' });
  });

  test('a link into another read root is ok; the same link with that root dropped is not', () => {
    const w = world();
    symlinkSync(join(w.outside, 'secret.txt'), join(w.project, 'shared'));
    expect(scan(w.project, { readRoots: [w.project, w.outside] })).toMatchObject({ ok: true });
    expect(scan(w.project, { readRoots: [w.project] })).toMatchObject({ reason: 'escape' });
  });

  test('a link into a credential folder inside the read roots → credential, case-folded', () => {
    const w = world();
    const keys = join(w.outside, 'Keys');
    mkdirSync(keys);
    writeFileSync(join(keys, 'id'), 'k');
    symlinkSync(join(keys, 'id'), join(w.project, 'key-link'));
    const roots = { readRoots: [w.project, w.outside] };
    expect(scan(w.project, roots)).toMatchObject({ ok: true });
    expect(
      scan(w.project, { ...roots, credentialPaths: { dirs: [keys], files: [] } })
    ).toMatchObject({ ok: false, reason: 'credential' });
    // `~/.SSH` is `~/.ssh` on a case-insensitive disk: the fold only ever adds a refusal.
    const upper = join(realpathSync(w.outside), 'KEYS');
    expect(
      scan(w.project, { ...roots, credentialPaths: { dirs: [upper], files: [] } })
    ).toMatchObject({ reason: 'credential' });
    expect(
      scan(w.project, {
        ...roots,
        credentialPaths: { dirs: [], files: [join(realpathSync(keys), 'id')] },
      })
    ).toMatchObject({ reason: 'credential' });
  });

  test('a dangling link is ignored', () => {
    const w = world();
    symlinkSync(join(w.outside, 'nope.txt'), join(w.project, 'dangling'));
    symlinkSync('missing/deeper', join(w.project, 'src', 'dangling-rel'));
    expect(scan(w.project)).toMatchObject({ ok: true });
  });

  test('a link loop → loop', () => {
    const w = world();
    symlinkSync(join(w.project, 'b'), join(w.project, 'a'));
    symlinkSync(join(w.project, 'a'), join(w.project, 'b'));
    expect(scan(w.project)).toMatchObject({ ok: false, reason: 'loop' });
  });

  test('past the entry cap or the time cap → too-large (fail closed)', () => {
    const w = world();
    for (let i = 0; i < 20; i++) writeFileSync(join(w.project, `f${i}`), '');
    expect(scan(w.project, { maxEntries: 10 })).toMatchObject({ ok: false, reason: 'too-large' });
    expect(scan(w.project, { maxEntries: 1000 })).toMatchObject({ ok: true });
    let t = 0;
    expect(scan(w.project, { maxMs: 5, now: () => (t += 10) })).toMatchObject({
      ok: false,
      reason: 'too-large',
    });
  });

  test.skipIf(process.getuid?.() === 0)(
    'a folder it cannot read → unreadable (fail closed)',
    () => {
      const w = world();
      const locked = join(w.project, 'locked');
      mkdirSync(locked);
      chmodSync(locked, 0o000);
      try {
        expect(scan(w.project)).toMatchObject({ ok: false, reason: 'unreadable' });
      } finally {
        chmodSync(locked, 0o700);
      }
    }
  );

  test('every root is walked (a write root that is no read root too); a missing root holds nothing', () => {
    const w = world();
    const scratch = join(w.base, 'scratch');
    mkdirSync(scratch);
    symlinkSync(join(w.outside, 'secret.txt'), join(scratch, 'x'));
    expect(scan(w.project, { roots: [w.project, join(w.base, 'missing')] })).toMatchObject({
      ok: true,
    });
    expect(scan(w.project, { roots: [w.project, scratch] })).toMatchObject({ reason: 'escape' });
  });

  test('assertNoUnsafeLinks throws agent-unsafe-link with the link relative to the project', () => {
    const w = world();
    symlinkSync(join(w.outside, 'secret.txt'), join(w.project, 'src', 'ref-link'));
    let err: unknown;
    try {
      assertNoUnsafeLinks({
        roots: [w.project],
        readRoots: [w.project],
        credentialPaths: NO_CRED,
        label: 'opencode',
        projectRoot: w.project,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnsafeLinkError);
    const u = err as UnsafeLinkError;
    expect(u.code).toBe('agent-unsafe-link');
    expect(u.link).toBe(join('src', 'ref-link'));
    expect(u.message).toContain('src/ref-link');
    expect(u.message).toContain('opencode');
  });
});

describe('agentSpawn refuses an agent-permission-engine agent in a project with a link out', () => {
  function spawnIn(d: AgentDescriptor, project: string) {
    return agentSpawn({
      descriptor: d,
      scrubbed: { PATH: '/bin' },
      agentBin: '/opt/agent',
      adapterEntry: '/adapter.js',
      runtime: { bin: '/bun', bunBeBun: false },
      policyCtx: {
        scopeRoot: project,
        readRoots: [project],
        writeRoots: [project],
        credentialPaths: NO_CRED,
        may: { assets: true, web: true },
        designRoots: [join(project, '.design')],
        agentBin: '/opt/agent',
      },
      actor: { sessionRoot: project, readRoots: [project] },
      teams: false,
      delimiter: ':',
      chatKeyEnv: {},
    });
  }
  // The launch policy is not under test here: the link check runs before it.
  const noPolicy = (d: AgentDescriptor): AgentDescriptor => ({
    ...d,
    enforcement: d.enforcement && { ...d.enforcement, launchPolicy: () => ({ env: {} }) },
  });

  test('the catalog: opencode, Gemini and Copilot judge reads by their own engine; Codex by its sandbox', () => {
    for (const d of [OPENCODE, GEMINI, COPILOT])
      expect([d.id, d.enforcement?.readGate]).toEqual([d.id, 'agent-permission-engine']);
    expect(CODEX.enforcement?.readGate).toBe('os-sandbox');
  });

  for (const d of [OPENCODE, GEMINI, COPILOT]) {
    test(`${d.id}: refused with agent-unsafe-link; starts once the link is gone`, () => {
      const w = world();
      const link = join(w.project, 'ref-link');
      symlinkSync(join(w.outside, 'secret.txt'), link);
      expect(() => spawnIn(noPolicy(d), w.project)).toThrow(UnsafeLinkError);
      rmSync(link);
      expect(spawnIn(noPolicy(d), w.project).cmd.length).toBeGreaterThan(0);
    });
  }

  test('Codex (os-sandbox) and Claude are not checked', () => {
    const w = world();
    symlinkSync(join(w.outside, 'secret.txt'), join(w.project, 'ref-link'));
    expect(spawnIn(noPolicy(CODEX), w.project).cmd).toEqual(['/bun', '/adapter.js']);
    expect(spawnIn(CLAUDE, w.project).cmd).toEqual(['/bun', '/adapter.js']);
  });
});
