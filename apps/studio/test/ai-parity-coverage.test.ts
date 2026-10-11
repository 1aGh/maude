// ai-parity-coverage.test.ts — contract V2-1.11 §5.7 (V2-2.4b): every action has exactly one AI
// path, and the count of actions without a real one only ratchets down.
//
// Reads the GENERATED apps/studio/actions.manifest.json (scripts/gen-actions.mjs; drift-gated
// below) and the lead-owned apps/studio/actions.parity.json:
//   { humanMax, pendingMax, pending: [{ id, package }], humanDecisions: { <reason>: <decision> } }
// Raising humanMax / pendingMax, or adding a HumanReason, is a lead change citing a decision id.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AGENT_PATHS } from '../actions/agents.ts';
import { ACTIONS } from '../actions/index.ts';
import type { ActionDefAI, Role } from '../actions/types.ts';
import { ROLE_RANK } from '../actions/types.ts';
import { ROLES } from '../actions/uniqueness.ts';
import { ROLE_REFUSALS, type RoleRefusal, refusalKey } from './_role-refusals.ts';

const ROOT = join(import.meta.dir, '..', '..', '..');
const STUDIO = join(ROOT, 'apps', 'studio');

type Agent =
  | { path: 'file'; format: string; skill: string; how: string }
  | { path: 'cli'; verb: string; skill?: string }
  | { path: 'human'; because: string; note?: string }
  | { path: 'pending'; package: string; want: Agent };
type Row = { id: string; kind: string; effect?: string; fromCanvas?: boolean; agent?: Agent };
type Manifest = { manifestVersion: string; actions: Row[]; verbs: { verb: string }[] };
type Parity = {
  humanMax: number;
  pendingMax: number;
  pending: { id: string; package: string }[];
  humanDecisions: Record<string, string>;
};

const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(STUDIO, rel), 'utf8')) as T;
const manifest = readJson<Manifest>('actions.manifest.json');
const parity = readJson<Parity>('actions.parity.json');
const rows = manifest.actions.filter((r) => r.kind !== 'place');

// ── rule 7: an action with `server` has a per-role refusal test ───────────────────────────────
// A refusal test is RECOGNISED by its row in test/_role-refusals.ts: the V2-1.7/S9 role suite
// iterates that table to generate one refusal case per (route, refused role), so a row IS a test
// once a suite consumes the table. The rule asserts (a) every `server` route has a row, (b) the row
// refuses every role ranked below the action's minRole, (c) a non-empty table has a consumer — a
// test file other than this one that imports `_role-refusals`.
type ServerAction = { id: string; server: NonNullable<ActionDefAI['server']>; minRole?: Role };

function refusalGaps(
  actions: readonly ServerAction[],
  table: readonly RoleRefusal[],
  consumers: readonly string[]
): string[] {
  const gaps: string[] = [];
  const byKey = new Map(table.map((r) => [refusalKey(r.method, r.route), r]));
  for (const a of actions) {
    const key = refusalKey(a.server.method, a.server.route);
    const row = byKey.get(key);
    if (!row) {
      gaps.push(
        `${a.id}: no per-role refusal test for ${key} (add a row to test/_role-refusals.ts)`
      );
      continue;
    }
    const below = ROLES.filter((r) => a.minRole && ROLE_RANK[r] < ROLE_RANK[a.minRole]);
    const missing = below.filter((r) => !row.refused.includes(r));
    if (missing.length) gaps.push(`${a.id}: ${key} must also refuse ${missing.join(', ')}`);
  }
  if (table.length && !consumers.length)
    gaps.push('test/_role-refusals.ts has rows but no role suite imports it');
  return gaps;
}

/** Every registered action whose AI entry (or definition) declares `server`. */
function serverActions(): ServerAction[] {
  const out: ServerAction[] = [];
  for (const def of ACTIONS) {
    const ai = (AGENT_PATHS as Record<string, ActionDefAI | undefined>)[def.id];
    const d = def as unknown as { server?: ActionDefAI['server']; visible?: { minRole?: Role } };
    const server = ai?.server ?? d.server;
    if (server) out.push({ id: def.id, server, minRole: ai?.minRole ?? d.visible?.minRole });
  }
  return out;
}

/** Test files (not this one) that import the refusal table. */
function refusalConsumers(): string[] {
  const dir = join(STUDIO, 'test');
  return readdirSync(dir).filter(
    (f) =>
      /\.test\.(?:ts|tsx|mjs)$/.test(f) &&
      f !== 'ai-parity-coverage.test.ts' &&
      /from ['"]\.\/_role-refusals(?:\.ts)?['"]/.test(readFileSync(join(dir, f), 'utf8'))
  );
}

describe('AI parity coverage (§5.7)', () => {
  test('the manifest is current — gen-actions --check', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/gen-actions.mjs'), '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, BUN_BE_BUN: '1' },
    });
    expect(`${r.stdout}${r.stderr}`).not.toMatch(/stale/);
    expect(r.status).toBe(0);
  });

  test('the manifest lists exactly the registry', () => {
    expect(manifest.actions.map((r) => r.id).sort()).toEqual(ACTIONS.map((a) => a.id).sort());
    expect(manifest.manifestVersion).toMatch(/^[0-9a-f]{12}$/);
  });

  test('1. every action (kind !== place) has an agent path and an effect', () => {
    expect(rows.filter((r) => !r.agent || !r.effect).map((r) => r.id)).toEqual([]);
  });

  test('2. pending actions are listed with their package, and stay ≤ pendingMax', () => {
    const pending = rows.filter((r) => r.agent?.path === 'pending');
    expect(pending.length).toBeLessThanOrEqual(parity.pendingMax);
    const listed = new Map(parity.pending.map((p) => [p.id, p.package]));
    for (const r of pending) {
      const pkg = (r.agent as { package: string }).package;
      expect({ id: r.id, listed: listed.get(r.id) }).toEqual({ id: r.id, listed: pkg });
    }
    // and no stale entry stays behind once an action gets its real path
    const ids = new Set(pending.map((r) => r.id));
    expect(parity.pending.filter((p) => !ids.has(p.id)).map((p) => p.id)).toEqual([]);
  });

  test('3. human actions stay ≤ humanMax; 4. each reason cites a decision', () => {
    const human = rows.filter((r) => r.agent?.path === 'human');
    expect(human.length).toBeLessThanOrEqual(parity.humanMax);
    for (const r of human) {
      const because = (r.agent as { because: string }).because;
      expect({ because, decision: parity.humanDecisions[because] ?? null }).toEqual({
        because,
        decision: expect.stringMatching(/^decision:maude\//),
      });
    }
  });

  test('5a. a file action names a skill that exists', () => {
    for (const r of rows) {
      const a = r.agent?.path === 'pending' ? r.agent.want : r.agent;
      if (a?.path !== 'file') continue;
      const [plugin, rest] = a.skill.split(':') as [string, string];
      const skill = (rest ?? '').split('#')[0] as string;
      const md = join(ROOT, 'plugins', plugin, 'skills', skill, 'SKILL.md');
      expect({ id: r.id, skill: a.skill, exists: existsSync(md) }).toEqual({
        id: r.id,
        skill: a.skill,
        exists: true,
      });
      expect(a.how.length).toBeGreaterThan(8);
    }
  });

  test('5b. a file action’s format has a schema under apps/studio/schema/ and a skill section', () => {
    const listed = new Map(
      (
        manifest as unknown as { schemas: { format: string; schema: string; skill: string }[] }
      ).schemas.map((s) => [s.format, s])
    );
    const formats = new Set<string>();
    for (const r of rows) {
      const a = r.agent?.path === 'pending' ? r.agent.want : r.agent;
      if (a?.path === 'file') formats.add(a.format);
    }
    expect(formats.size).toBeGreaterThan(0);
    for (const format of formats) {
      const s = listed.get(format);
      const schemaOk =
        !!s && s.schema.startsWith('apps/studio/schema/') && existsSync(join(ROOT, s.schema));
      // the skill section: `plugin:skill#_guide-NN` → that guide file; `plugin:skill#anchor` → a
      // heading in SKILL.md; no anchor → the SKILL.md names the format's file pattern or the format.
      let skillOk = false;
      if (s) {
        const [plugin, rest] = s.skill.split(':') as [string, string];
        const [skill, anchor] = (rest ?? '').split('#') as [string, string | undefined];
        const dir = join(ROOT, 'plugins', plugin, 'skills', skill);
        if (anchor?.startsWith('_guide-'))
          skillOk = readdirSync(dir).some(
            (f) => f.startsWith(`${anchor}-`) || f === `${anchor}.md`
          );
        else if (existsSync(join(dir, 'SKILL.md'))) {
          const md = readFileSync(join(dir, 'SKILL.md'), 'utf8');
          skillOk = anchor
            ? md.includes(anchor)
            : md.includes(format) || md.includes(`.${format}.json`);
        }
      }
      expect({ format, schemaOk, skillOk }).toEqual({ format, schemaOk: true, skillOk: true });
    }
  });

  test('7. every action with `server` has a per-role refusal test (rule 12)', () => {
    expect(refusalGaps(serverActions(), ROLE_REFUSALS, refusalConsumers())).toEqual([]);
  });

  test('7 bites: a planted `server` action without a refusal row fails', () => {
    const planted: ServerAction = {
      id: 'fixture.server-write',
      server: { route: '/_api/fixture-write', method: 'POST' },
      minRole: 'edit',
    };
    const row: RoleRefusal = {
      method: 'POST',
      route: '/_api/fixture-write',
      refused: ['view', 'comment'],
    };
    const suite = ['fixture-roles.test.ts'];
    // no row → red, whatever the table holds today
    expect(refusalGaps([planted], ROLE_REFUSALS, suite)).toEqual([
      'fixture.server-write: no per-role refusal test for POST /_api/fixture-write (add a row to test/_role-refusals.ts)',
    ]);
    // a row that lets a role below minRole through → red
    expect(refusalGaps([planted], [{ ...row, refused: ['view'] }], suite)).toEqual([
      'fixture.server-write: POST /_api/fixture-write must also refuse comment',
    ]);
    // a row nobody runs → red
    expect(refusalGaps([planted], [row], [])).toEqual([
      'test/_role-refusals.ts has rows but no role suite imports it',
    ]);
    // a row a suite runs → green
    expect(refusalGaps([planted], [row], suite)).toEqual([]);
  });

  test('6. a cli action’s verb is a real `maude` verb in the tier table', () => {
    const verbs = new Set(manifest.verbs.map((v) => v.verb));
    for (const r of rows) {
      if (r.agent?.path !== 'cli') continue;
      const words = r.agent.verb.replace(/^maude /, '').split(' ');
      const key = words[0] === 'design' ? `design ${words[1]}` : words.slice(0, 2).join(' ');
      const hit = verbs.has(key) || verbs.has(key.split(' ')[0] as string);
      expect({ id: r.id, verb: r.agent.verb, hit }).toEqual({
        id: r.id,
        verb: r.agent.verb,
        hit: true,
      });
    }
  });

  test('6b. … is listed by `maude design help` and exits 0 on `--help`', () => {
    const env = {
      ...process.env,
      NO_OPEN: '1',
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_NO_UPDATE_CHECK: '1',
    };
    const maude = (args: string[]) =>
      spawnSync('node', [join(ROOT, 'cli/bin/maude.mjs'), ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 30_000,
        env,
      });
    const help = maude(['design', 'help']);
    expect(help.status).toBe(0);
    const listed = new Set(help.stdout.split(/[\s·]+/).filter(Boolean));
    const designVerbs = new Set<string>();
    for (const r of rows) {
      if (r.agent?.path !== 'cli') continue;
      const words = r.agent.verb.replace(/^maude /, '').split(' ');
      if (words[0] === 'design' && words[1]) designVerbs.add(words[1]);
    }
    expect(designVerbs.size).toBeGreaterThan(0);
    for (const v of designVerbs) {
      const h = maude(['design', v, '--help']);
      expect({ verb: v, listed: listed.has(v), helpExit: h.status }).toEqual({
        verb: v,
        listed: true,
        helpExit: 0,
      });
    }
  }, 120_000);

  test('fromCanvas ⇒ effect none (V2-1.3 invariant 3)', () => {
    expect(rows.filter((r) => r.fromCanvas && r.effect !== 'none').map((r) => r.id)).toEqual([]);
  });
});
