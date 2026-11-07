// #156 §4 (T4.4, DDR-249): video lives in its own opt-in plugin, `design-video`. A terminal user
// who never cuts video no longer pays for the reel / footage / Lottie commands, skills and agents
// in every session; the desktop app still ships it (the ACP chat injects both plugins).
//
// This test holds the split: the moved files exist only under plugins/design-video, the
// manifests agree, and no live reference still names a moved item under `design:`.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

/** Everything that moved, by the path it has inside a plugin. */
export const MOVED = {
  commands: ['reel', 'video-analyze', 'to-lottie'],
  skills: ['video-comp', 'footage-director', 'footage-keyframes', 'video-generation'],
  agents: ['footage-analyst', 'footage-director'],
};
const MOVED_PATHS = [
  ...MOVED.commands.map((c) => `commands/${c}.md`),
  ...MOVED.commands.map((c) => `codex-skills/source-command-${c}/SKILL.md`),
  ...MOVED.skills.map((s) => `skills/${s}/SKILL.md`),
  ...MOVED.agents.map((a) => `agents/${a}.md`),
];

test('the video files ship only in plugins/design-video', () => {
  const stillInDesign = MOVED_PATHS.filter((p) => existsSync(join(ROOT, 'plugins/design', p)));
  const missing = MOVED_PATHS.filter((p) => !existsSync(join(ROOT, 'plugins/design-video', p)));
  assert.deepEqual(stillInDesign, [], 'still under plugins/design');
  assert.deepEqual(missing, [], 'missing under plugins/design-video');
});

test('the design plugin keeps image and audio generation', () => {
  for (const p of ['commands/generate.md', 'skills/ai-generation/SKILL.md'])
    assert.ok(existsSync(join(ROOT, 'plugins/design', p)), p);
});

test('design-video has both manifests at the release version, and the marketplace lists it', () => {
  const version = json('package.json').version;
  for (const m of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    const doc = json(`plugins/design-video/${m}`);
    assert.equal(doc.name, 'design-video', m);
    assert.equal(doc.version, version, m);
  }
  const entry = json('.claude-plugin/marketplace.json').plugins.find(
    (p) => p.name === 'design-video'
  );
  assert.ok(entry, 'marketplace entry');
  assert.equal(entry.source, './plugins/design-video');
});

// .github/workflows/version-parity.yml runs check-version-parity.sh on every PR (no paths filter).
test('the version scripts name the design-video manifests', () => {
  for (const f of ['scripts/bump-version.sh', 'scripts/check-version-parity.sh']) {
    const text = read(f);
    assert.match(text, /plugins\/design-video\/\.claude-plugin\/plugin\.json/, f);
  }
});

test('the desktop bundle stages design-video and the in-app chat injects it', () => {
  assert.match(read('apps/desktop/scripts/stage-resources.mjs'), /'design-video'/);
  assert.match(read('apps/studio/acp/plugin-bootstrap.ts'), /add\(deps\.designVideoDir/);
});

// Places that keep the old names on purpose: history (changelogs, release notes, plans, decision
// records, research snapshots, the v2 contracts), dogfood canvases and built bundles. Anywhere
// else an old name may appear only on a line that maps it to its new name (a rename table, a
// migration note).
const HISTORY = [
  '.ai/',
  '.kgai/',
  '.design/',
  'CHANGELOG.md',
  'apps/studio/whats-new.json',
  'site/lib/whats-new.json',
  'apps/studio/dist/',
  'apps/studio/client/v2/contracts/',
  'docs/research/',
  'cli/lib/plugin-design-video-split.test.mjs',
];

/** True when every old `design:<x>` on the line sits next to its `design-video:<x>`. */
const mapsOldToNew = (line, re) =>
  [...line.matchAll(new RegExp(re, 'g'))].every((m) => line.includes(`design-video:${m[1]}`));

test('no live reference names a moved item under the design: namespace', () => {
  const names = [...new Set([...MOVED.commands, ...MOVED.skills, ...MOVED.agents])];
  const re = `design:(${names.join('|')})([^a-z0-9-]|$)`;
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-InE', re, '--', '.'], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    if (e.status !== 1) throw e; // 1 = no match
  }
  const hits = out
    .split('\n')
    .filter(Boolean)
    .filter((line) => !HISTORY.some((h) => line.startsWith(h)))
    .filter((line) => !mapsOldToNew(line.replace(/^[^:]+:\d+:/, ''), re));
  assert.deepEqual(hits, [], `use design-video:<name>:\n  ${hits.slice(0, 40).join('\n  ')}`);
});
