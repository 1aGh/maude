// DDR-061 + DDR-062 regression guard.
//
// DDR-061: a plugin must NEVER invoke a `cli/lib/*.mjs` module by a relative
// path unconditionally: in a marketplace install the plugin is copied alone into
// `cache/<marketplace>/<plugin>/<version>/`, so the sibling `cli/` does not
// exist and the call crashes with MODULE_NOT_FOUND. The reachable contract is
// the on-PATH `maude` binary (a declared plugin dependency).
//
// So any plugin file that runs `node … cli/lib/<x>.mjs` is only allowed when the
// SAME file also offers a `command -v maude` fallback (the sibling-first /
// maude-fallback pattern). This test fails loudly if a new straggler lands.
//
// DDR-062: plugin MARKDOWN must reach the studio bash helpers through
// `maude design <verb>`, never `bash "$CLAUDE_PLUGIN_ROOT/dev-server/bin/<x>.sh"`
// or `bash apps/studio/bin/<x>.sh`. The marketplace never copies the studio app
// beside a plugin, and a flow command's $CLAUDE_PLUGIN_ROOT points at
// plugins/flow (no bin/ at all). Per DDR-095 the helpers live under
// apps/studio/bin (was plugins/design/dev-server/bin). Prose mentions of the
// path are fine; INVOCATIONS (bash/sh/exec/$( prefixed) are banned.

import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

test('no plugin runs `node cli/lib/*.mjs` without an on-PATH maude fallback', () => {
  const out = execSync(
    String.raw`grep -rlE 'node[^\n]*cli/lib/[a-z0-9_-]+\.mjs' plugins/ || true`,
    {
      encoding: 'utf8',
    }
  );
  const files = out.trim().split('\n').filter(Boolean);
  const offenders = files.filter((f) => !/command -v maude/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(
    offenders,
    [],
    `These plugin files invoke a relative cli/lib module with no \`command -v maude\` fallback — they will crash in a marketplace install (DDR-061). Route through \`maude <subcommand>\` or guard with a sibling-exists check + maude fallback:\n  ${offenders.join('\n  ')}`
  );
});

test('no plugin markdown invokes a $CLAUDE_PLUGIN_ROOT/dev-server/bin/*.sh helper (DDR-062)', () => {
  // INVOCATION = the bin path preceded by bash / sh / exec, or inside a $(…)
  // command substitution. Prose mentions of the path (backtick-wrapped, no verb)
  // are exempt — they don't run anything. Matches both the $CLAUDE_PLUGIN_ROOT
  // form and the repo-relative `plugins/<x>/dev-server/bin/` form.
  const pattern = String.raw`(bash|sh|exec) +"?(\$\{?CLAUDE_PLUGIN_ROOT\}?|plugins/[a-z]+)/dev-server/bin/[A-Za-z0-9_-]+\.sh|\$\("?\$?\{?CLAUDE_PLUGIN_ROOT\}?/dev-server/bin/[A-Za-z0-9_-]+\.sh|(bash|sh|exec) +"?[^"\n]*apps/studio/bin/[A-Za-z0-9_-]+\.sh|\$\("?[^"\n]*apps/studio/bin/[A-Za-z0-9_-]+\.sh`;
  const out = execSync(`grep -rnE '${pattern}' plugins --include='*.md' || true`, {
    encoding: 'utf8',
  });
  const hits = out.trim().split('\n').filter(Boolean);
  assert.deepEqual(
    hits,
    [],
    `These plugin markdown lines INVOKE a dev-server bin helper directly — they break in marketplace installs (the dev-server is never copied beside a plugin) and in flow commands (whose $CLAUDE_PLUGIN_ROOT has no dev-server/). Route through \`maude design <verb>\` instead (DDR-062):\n  ${hits.join('\n  ')}`
  );
});

// V2-2.15 (V2-1.13 §7): the design-system schema verbs are whitelisted bin verbs with their
// bundled .sh, so plugin markdown reaches them as `maude design <verb>`.
test('ds-check and ds-upgrade are whitelisted `maude design` bin verbs with its bundled helper', () => {
  const src = readFileSync('cli/commands/design.mjs', 'utf8');
  const set = src.slice(
    src.indexOf('const BIN_VERBS = new Set(['),
    src.indexOf(']);', src.indexOf('const BIN_VERBS'))
  );
  for (const verb of ['ds-check', 'ds-upgrade']) {
    assert.match(set, new RegExp(`'${verb}'`), `${verb} missing from BIN_VERBS`);
    const sh = readFileSync(`apps/studio/bin/${verb}.sh`, 'utf8');
    assert.match(sh, /exec bun run "\$SCRIPT_DIR\/_ds-/);
  }
});

// V2-2.4b (contract V2-1.11 §5.3): the AI-path verbs. In-process node verbs sit in SUBCOMMANDS
// (they talk to the studio and need no helper); the rest are whitelisted bin verbs with a .sh.
// Each answers `--help` with exit 0 (§5.7 rule 6).
const V2_24B_SUBCOMMANDS = ['open'];
const V2_24B_BIN_VERBS = ['check', 'place', 'layout-check'];
test('the V2-2.4b verbs are reachable as `maude design <verb>` and answer --help', () => {
  const src = readFileSync('cli/commands/design.mjs', 'utf8');
  const slice = (name) =>
    src.slice(
      src.indexOf(`const ${name} = new Set([`),
      src.indexOf(']);', src.indexOf(`const ${name}`))
    );
  for (const verb of V2_24B_SUBCOMMANDS)
    assert.match(slice('SUBCOMMANDS'), new RegExp(`'${verb}'`), `${verb} missing from SUBCOMMANDS`);
  for (const verb of V2_24B_BIN_VERBS) {
    assert.match(slice('BIN_VERBS'), new RegExp(`'${verb}'`), `${verb} missing from BIN_VERBS`);
    readFileSync(`apps/studio/bin/${verb}.sh`, 'utf8');
  }
  for (const verb of [...V2_24B_SUBCOMMANDS, ...V2_24B_BIN_VERBS]) {
    const out = execSync(`node cli/bin/maude.mjs design ${verb} --help`, {
      encoding: 'utf8',
      env: { ...process.env, MAUDE_NO_UPDATE_CHECK: '1' },
    });
    assert.match(out, new RegExp(`maude design ${verb}`), `${verb} --help prints its usage`);
  }
});

// S12.9: a plugin never `curl`s a studio route that has a verb or a hook behind it. The v1
// /design:edit step 4.5 did (`/_api/ai/start|heartbeat|end`): in v2 the hooks open and close the
// run and the run folder line names it, so a second, hand-made bracket would fork the run
// registry (two runs for one edit). A `curl` at a route with no verb (footage, export-jobs) stays
// legal until its own verb lands; `curl-local` is the loopback-only wrapper, not a raw curl.
const ROUTES_WITH_A_VERB = [
  ['/_api/ai/start', 'the hooks, which open the run'],
  ['/_api/ai/heartbeat', 'the hooks, which renew the run'],
  ['/_api/ai/end', 'the hooks, which close the run'],
  ['/_api/ai/runs', '`maude design runs`'],
  ['/_api/comments', '`maude design comments`'],
  ['/_api/trash', '`maude design trash`'],
  ['/_api/project/history', '`maude design history`'],
  ['/_api/project/undo', '`maude design history undo`'],
  ['/_api/ui/open', '`maude design open`'],
  ['/_api/annotations/ops', '`maude design annotate`'],
  ['/_api/generate', '`maude design generate`'],
  ['/_api/photo-edit', '`maude design photo-adjust`'],
];

function markdownUnder(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') markdownUnder(p, out);
    } else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

test('no plugin markdown curls a studio route that has a verb (S12.9)', () => {
  const hits = [];
  for (const file of markdownUnder('plugins')) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/\bcurl\b(?!-local)/.test(line)) return;
      // a continued command: the route may sit on the next two lines
      const cmd = lines.slice(i, i + 3).join('\n');
      for (const [route, via] of ROUTES_WITH_A_VERB) {
        const at = cmd.indexOf(route);
        if (at !== -1 && !/[A-Za-z0-9_-]/.test(cmd.charAt(at + route.length)))
          hits.push(`${file}:${i + 1} curls ${route}; use ${via}`);
      }
    });
  }
  assert.deepEqual(
    hits,
    [],
    `A plugin must reach these through their verb or hook, not a raw curl:\n  ${hits.join('\n  ')}`
  );
});

// S10.15b (S10 Q13): the `--upgrade-schema` skill section and its command are wired to the verbs that exist.
// Every `maude design ds-upgrade …` the section tells the agent to run names a sub-verb or a step flag the
// helper really has, the steps that write are named, and it stops before `--apply`.
test('the upgrade-schema skill section names only ds-upgrade steps that exist, and stops before --apply', async () => {
  const { SUB_VERBS } = await import('./sub-verbs.mjs');
  const skill = readFileSync('plugins/design/skills/design-system/SKILL.md', 'utf8');
  const at = skill.indexOf('\n## upgrade-schema');
  assert.ok(at > 0, 'SKILL.md has a "## upgrade-schema" section');
  const section = skill.slice(at, skill.indexOf('\n## ', at + 5));
  const help = readFileSync('apps/studio/bin/ds-upgrade.sh', 'utf8');
  const flags = new Set([...help.matchAll(/ds-upgrade\.sh <ds> (--[a-z-]+)/g)].map((m) => m[1]));
  assert.ok(flags.has('--prove') && flags.has('--status') && flags.has('--cancel'));
  const subs = new Set(Object.keys(SUB_VERBS['ds-upgrade']));
  const cmds = [...section.matchAll(/`maude design ds-upgrade ([^`]*)`/g)].map((m) => m[1]);
  assert.ok(cmds.length >= 5, 'the section names the verbs');
  for (const c of cmds) {
    for (const tok of c.split(/\s+/)) {
      if (tok.startsWith('--')) assert.ok(flags.has(tok), `ds-upgrade ${c}: ${tok} is not a step`);
    }
    const first = c.split(/\s+/)[0];
    if (!first.startsWith('<') && !first.startsWith('--'))
      assert.ok(subs.has(first), `ds-upgrade ${c}: ${first} is not a sub-verb`);
  }
  for (const step of ['--stage', '--prove', '--status', '--cancel', '--discard'])
    assert.ok(section.includes(step), `the section names ${step}`);
  assert.match(section, /Do not run `--apply`/);
});

test('/design:setup-ds documents --upgrade-schema and points at the skill section', () => {
  const cmd = readFileSync('plugins/design/commands/setup-ds.md', 'utf8');
  assert.match(cmd, /^## Upgrade-schema mode \(`--upgrade-schema`/m);
  assert.match(cmd, /design-system\/SKILL\.md` § upgrade-schema/);
  assert.match(cmd, /^upgrade_schema: true\|false/m);
  // the argument-hint already offered the flag
  assert.match(cmd, /argument-hint:.*--upgrade-schema/);
});
