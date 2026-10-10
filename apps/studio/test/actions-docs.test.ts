// actions-docs.test.ts — contract V2-1.11 §4 decision 1 (V2-2.4b): the registry generates the
// `studio-actions` skill index, the /design:help block, `maude design help`'s tiers and the docs
// page. Drift is gen-actions --check (ai-parity-coverage.test.ts); this pins what they SAY.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { autoAllowRules } from '../actions/verbs.ts';

const ROOT = join(import.meta.dir, '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
type Row = { id: string; kind: string; agent?: { path: string } };
type Verb = { verb: string; tier: string; scope: string };
const manifest = JSON.parse(read('apps/studio/actions.manifest.json')) as {
  manifestVersion: string;
  actions: Row[];
  verbs: Verb[];
};
const rows = manifest.actions.filter((a) => a.kind !== 'place');

describe('generated docs say what the registry says', () => {
  test('studio-actions lists every capability once, under its AI path', () => {
    const md = read('plugins/design/skills/studio-actions/SKILL.md');
    expect(md).toMatch(/^---\nname: studio-actions\ndescription: "/);
    expect(md).toContain(`manifest ${manifest.manifestVersion}`);
    for (const r of rows)
      expect({ id: r.id, n: md.split(`| \`${r.id}\` |`).length - 1 }).toEqual({ id: r.id, n: 1 });
    for (const [path, title] of [
      ['file', 'Edit a file'],
      ['cli', 'Run a verb'],
      ['human', 'Only the person'],
      ['pending', 'Not yet'],
    ])
      expect(md).toContain(`### ${title} (${rows.filter((r) => r.agent?.path === path).length})`);
    for (const v of manifest.verbs) expect(md).toContain(`| \`maude ${v.verb}\` |`);
  });

  test('/design:help carries the generated block and tells the command to print it', () => {
    const md = read('plugins/design/commands/help.md');
    expect(md).toContain('<!-- BEGIN GENERATED: studio capabilities');
    expect(md).toContain('### 5. Studio capabilities');
    const prompt = manifest.verbs.filter((v) => v.scope === 'design' && v.tier === 'prompt');
    const line = md.split('\n').find((l) => l.startsWith('| prompt')) ?? '';
    for (const v of prompt) expect(line).toContain(v.verb.replace(/^design /, ''));
  });

  test('`maude design help` prints every design verb under its tier', () => {
    const r = spawnSync('node', [join(ROOT, 'cli/bin/maude.mjs'), 'design', 'help'], {
      encoding: 'utf8',
      env: { ...process.env, MAUDE_NO_UPDATE_CHECK: '1' },
    });
    expect(r.status).toBe(0);
    const tiers = r.stdout.slice(r.stdout.indexOf('Verbs by permission tier'));
    const section = (t: string) => {
      const a = tiers.indexOf(`  ${t} `);
      const b = tiers.slice(a + 3).search(/\n {2}\S/);
      return tiers.slice(a, b === -1 ? undefined : a + 3 + b);
    };
    for (const v of manifest.verbs.filter((x) => x.scope === 'design'))
      expect({
        verb: v.verb,
        tier: v.tier,
        ok: section(v.tier).includes(v.verb.replace(/^design /, '')),
      }).toEqual({
        verb: v.verb,
        tier: v.tier,
        ok: true,
      });
  });

  test('the docs page’s paste-in allow list is the chat’s generated allow list (§5.5)', () => {
    const r = spawnSync('node', [join(ROOT, 'scripts/gen-actions.mjs'), '--print-docs'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    const json = /```json\n([\s\S]+?)\n```/.exec(r.stdout)?.[1] ?? '[]';
    expect(JSON.parse(json)).toEqual(autoAllowRules());
    expect(r.stdout).not.toContain('Bash(maude:*)');
  });
});
