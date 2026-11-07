// #156 §2/§3: every agent `description:` is listed to the model in EVERY session that has the
// plugin enabled, so it is a fixed per-session cost. It only has to decide WHEN to spawn the
// agent; the detail belongs in the body. This test holds the cap and the one-line form of the
// internal-only agents (spawned by a command or the debate protocol, never auto-delegated).

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Longest allowed agent description, in characters (#156 §2). */
const DESCRIPTION_CAP = 200;

/** Agents only a command / the debate protocol spawns: a one-line "Internal — spawned only by …". */
const INTERNAL_AGENTS = {
  flow: ['breaker', 'builder', 'investigator', 'shipper', 'user-advocate'],
  design: [
    'asset-describer',
    'draw-agent',
    'ds-migrator',
    'footage-analyst',
    'footage-director',
    'reconstruct-agent',
    'reconstruct-critic',
  ],
};
const INTERNAL_CAP = 170;

function loadAgents(plugin) {
  const dir = join(ROOT, 'plugins', plugin, 'agents');
  const out = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(join(dir, file), 'utf8');
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    // `_*.md` files are rule catalogs read on demand, not agents (no frontmatter).
    if (!fm) continue;
    let description = fm[1].match(/^description:[ \t]*(.*)$/m)?.[1].trim() ?? '';
    assert.ok(
      description && !/^[>|]/.test(description),
      `${plugin}/${file}: description must be a single-line scalar`
    );
    if (description.startsWith('"')) description = JSON.parse(description);
    out.push({ plugin, name: file.replace(/\.md$/, ''), description });
  }
  return out;
}

const agents = [...loadAgents('flow'), ...loadAgents('design')];

test('the agent lists were read (guards against an empty glob)', () => {
  assert.ok(agents.filter((a) => a.plugin === 'flow').length >= 14);
  assert.ok(agents.filter((a) => a.plugin === 'design').length >= 21);
});

test(`every agent description is at most ${DESCRIPTION_CAP} characters`, () => {
  const offenders = agents
    .filter((a) => a.description.length > DESCRIPTION_CAP)
    .map((a) => `${a.plugin}:${a.name} (${a.description.length})`);
  assert.deepEqual(
    offenders,
    [],
    `These agent descriptions exceed ${DESCRIPTION_CAP} characters. A description only decides WHEN to spawn the agent (keep the trigger words); move the detail into the agent body (#156 §2):\n  ${offenders.join('\n  ')}`
  );
});

test('internal-only agents carry a one-line "Internal — spawned only by …" description', () => {
  const offenders = [];
  for (const [plugin, names] of Object.entries(INTERNAL_AGENTS)) {
    for (const name of names) {
      const a = agents.find((x) => x.plugin === plugin && x.name === name);
      if (!a) {
        offenders.push(`${plugin}:${name} (agent file missing — update INTERNAL_AGENTS)`);
        continue;
      }
      const d = a.description;
      if (!/^Internal — spawned only by /.test(d)) offenders.push(`${plugin}:${name} (form)`);
      else if (d.length > INTERNAL_CAP) offenders.push(`${plugin}:${name} (${d.length} chars)`);
      else if (!/spawned only by [^;]+; never auto-delegated/.test(d))
        offenders.push(`${plugin}:${name} (never auto-delegated)`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Internal agents must read "Internal — spawned only by <caller>; never auto-delegated. …" in at most ${INTERNAL_CAP} characters (#156 §3):\n  ${offenders.join('\n  ')}`
  );
});
