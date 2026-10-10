// ai-parity-coverage.test.ts — contract V2-1.11 §5.7 (V2-2.4b): every action has exactly one AI
// path, and the count of actions without a real one only ratchets down.
//
// Reads the GENERATED apps/studio/actions.manifest.json (scripts/gen-actions.mjs; drift-gated
// below) and the lead-owned apps/studio/actions.parity.json:
//   { humanMax, pendingMax, pending: [{ id, package }], humanDecisions: { <reason>: <decision> } }
// Raising humanMax / pendingMax, or adding a HumanReason, is a lead change citing a decision id.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ACTIONS } from '../actions/index.ts';

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

  // 5b (schema per format) lands with the §5.2 schemas; 7 (per-role refusal test per `server`
  // route) with the V2-1.7/S9 role suite.
  test.todo('5b. a file action’s format has a schema under apps/studio/schema/');
  test.todo('7. every action with `server` has a per-role refusal test');

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

  test('fromCanvas ⇒ effect none (V2-1.3 invariant 3)', () => {
    expect(rows.filter((r) => r.fromCanvas && r.effect !== 'none').map((r) => r.id)).toEqual([]);
  });
});
