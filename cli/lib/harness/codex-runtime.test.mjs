import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildCodexPermissionLaunch,
  hasLegacySandboxConfig,
  materializePluginSource,
  mcpEntryMatchesHash,
  mcpFingerprint,
  parseClaudeAgent,
  parseClaudeCommand,
  prepareMcp,
  removeManagedCodexAgents,
  renderCommandSkill,
  snapshotCommandFiles,
} from './codex-runtime.mjs';
import { sha256 } from './model.mjs';

test('reuses an existing bearer environment variable without pooling its value', () => {
  const previous = process.env.STUDYFI_ADMIN_MCP_TOKEN;
  process.env.STUDYFI_ADMIN_MCP_TOKEN = 'literal-secret';
  const prepared = prepareMcp('studyfi-admin', {
    headers: { Authorization: 'Bearer literal-secret' },
    url: 'https://example.invalid/mcp',
  });
  if (previous === undefined) delete process.env.STUDYFI_ADMIN_MCP_TOKEN;
  else process.env.STUDYFI_ADMIN_MCP_TOKEN = previous;

  assert.deepEqual(prepared.args, [
    'mcp',
    'add',
    'studyfi-admin',
    '--url',
    'https://example.invalid/mcp',
    '--bearer-token-env-var',
    'STUDYFI_ADMIN_MCP_TOKEN',
  ]);
  assert.doesNotMatch(JSON.stringify(prepared.redacted), /literal-secret/);
});

test('rejects a literal bearer credential without an existing environment variable', () => {
  assert.throws(
    () =>
      prepareMcp('remote', {
        headers: { Authorization: 'Bearer bridge-only-literal-credential' },
        url: 'https://example.invalid/mcp',
      }),
    /existing environment variable/i
  );
});

test('preserves referenced bearer credentials without reading their value', () => {
  const prepared = prepareMcp('remote', {
    headers: { Authorization: 'Bearer $' + '{REMOTE_TOKEN}' },
    url: 'https://example.invalid/mcp',
  });

  assert.equal(prepared.args.at(-1), 'REMOTE_TOKEN');
});

test('fails closed when the Codex CLI cannot preserve STDIO environment references', () => {
  assert.throws(
    () =>
      prepareMcp('local', {
        command: 'server',
        env: { API_TOKEN: '$' + '{API_TOKEN}' },
      }),
    /cannot preserve STDIO environment references/i
  );
});

test('MCP ownership fingerprints include settings users can change outside Maude', () => {
  const base = {
    enabled: true,
    startup_timeout_sec: null,
    tool_timeout_sec: null,
    transport: { args: [], command: 'server', cwd: null, env: {}, env_vars: [], type: 'stdio' },
  };

  assert.deepEqual(mcpFingerprint(base), {
    command: ['server'],
    type: 'stdio',
  });
  assert.notDeepEqual(mcpFingerprint({ ...base, enabled: false }), mcpFingerprint(base));
  assert.notDeepEqual(mcpFingerprint({ ...base, startup_timeout_sec: 30 }), mcpFingerprint(base));
  assert.notDeepEqual(
    mcpFingerprint({ ...base, transport: { ...base.transport, cwd: '/tmp/work' } }),
    mcpFingerprint(base)
  );
});

test('accepts the previous runtime MCP fingerprint only for state migration', () => {
  const entry = {
    enabled: true,
    startup_timeout_sec: null,
    tool_timeout_sec: null,
    transport: { args: [], command: 'server', cwd: null, env: {}, env_vars: [], type: 'stdio' },
  };
  const legacyHash = sha256(JSON.stringify({ command: ['server'], envKeys: [], type: 'stdio' }));

  assert.equal(mcpEntryMatchesHash(entry, legacyHash), true);
  assert.equal(mcpEntryMatchesHash({ ...entry, enabled: false }, legacyHash), false);
});

test('command discovery reads the verified plugin snapshot, not the mutable source tree', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'maude-codex-command-snapshot-')));
  t.after(() => rm(root, { force: true, recursive: true }));
  const source = join(root, 'source');
  const snapshot = join(root, 'snapshot');
  await mkdir(join(source, 'commands'), { recursive: true });
  await mkdir(join(snapshot, 'commands'), { recursive: true });
  await writeFile(join(source, 'commands', 'plan.md'), 'source');
  await writeFile(join(snapshot, 'commands', 'plan.md'), 'snapshot');

  assert.deepEqual(await snapshotCommandFiles(snapshot), [join(snapshot, 'commands', 'plan.md')]);
});

test('rejects HTTP headers Codex cannot represent exactly', () => {
  assert.throws(
    () =>
      prepareMcp('remote', {
        headers: { 'X-Custom': 'value' },
        url: 'https://example.invalid/mcp',
      }),
    /unsupported HTTP headers/i
  );
});

test('rejects traversal-bearing command and agent names', () => {
  assert.throws(
    () => parseClaudeCommand('---\nname: ../../config\n---\nBad\n'),
    /invalid command/i
  );
  assert.throws(() => parseClaudeAgent('---\nname: ../../config\n---\nBad\n'), /invalid agent/i);
});

test('normalizes qualified Claude command names into portable Codex skill names', () => {
  assert.equal(parseClaudeCommand('---\nname: posthog:ingest\n---\nRun\n').name, 'posthog-ingest');
});

test('rejects literal credentials in MCP URLs and command arguments', () => {
  assert.throws(
    () => prepareMcp('remote', { url: 'https://example.invalid/mcp?token=literal-secret' }),
    /literal credential/i
  );
  assert.throws(
    () => prepareMcp('remote', { args: ['--token', 'literal-secret'], command: 'server' }),
    /literal credential/i
  );
});

test('converts rich Claude command frontmatter into a native Codex skill', () => {
  const command = parseClaudeCommand(
    `---\nname: plan\ncategory: daily\ntype: command\ndescription: Plan work\nargument-hint: feature\n---\n# Plan: $ARGUMENTS\n`
  );
  const skill = renderCommandSkill(command);

  assert.match(skill, /name: "source-command-plan"/);
  assert.match(skill, /description: "Plan work"/);
  assert.match(skill, /# Plan: \$ARGUMENTS/);
  assert.doesNotMatch(skill, /argument-hint/);
});

test('preserves a source-owned native plugin after verifying its snapshot', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'maude-codex-native-source-')));
  t.after(() => rm(root, { force: true, recursive: true }));
  const source = join(root, 'source');
  const target = join(root, 'target');
  const files = {
    '.codex-plugin/plugin.json': '{"name":"flow","skills":"./skills/","version":"1.0.0"}\n',
    'commands/plan.md': '---\nname: plan\ndescription: Plan work\n---\n# Original procedure\n',
    'skills/source-command-plan/SKILL.md':
      '---\nname: source-command-plan\ndescription: Plan work\n---\nRead [plan](../../commands/plan.md).\n',
    'skills/source-command-plan/agents/openai.yaml':
      'policy:\n  allow_implicit_invocation: false\n',
  };
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(source, path, '..'), { recursive: true });
    await writeFile(join(source, path), contents);
  }
  const sourceHash = sha256(
    Object.entries(files)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([path, contents]) => `${path}\0${sha256(contents)}`)
      .join('\n')
  );
  const item = { name: 'flow@maude', sourceHash, value: { installPath: source } };
  await materializePluginSource(item, target, root);
  for (const [path, contents] of Object.entries(files)) {
    assert.equal(await readFile(join(target, path), 'utf8'), contents);
  }

  await assert.rejects(
    materializePluginSource({ ...item, sourceHash: 'changed' }, target, root),
    /plugin changed while materializing/
  );
  await assert.rejects(access(target), /ENOENT/);
});

test('converts Claude agent frontmatter without carrying privilege fields', () => {
  const agent = parseClaudeAgent(
    `---\nname: reviewer\ndescription: Review code\ntools: Bash\n---\nReview carefully.\n`
  );

  assert.deepEqual(agent, {
    body: 'Review carefully.\n',
    description: 'Review code',
    name: 'reviewer',
  });
});

test('removes previously managed Codex agents and reports source agents as unsupported', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'maude-codex-agents-')));
  t.after(() => rm(root, { force: true, recursive: true }));
  const codexHome = join(root, '.codex');
  const managedPath = join(codexHome, 'agents', 'flow-reviewer.toml');
  const managedContents = 'name = "flow:reviewer"\n';
  await mkdir(join(codexHome, 'agents'), { recursive: true });
  await writeFile(managedPath, managedContents);

  const result = await removeManagedCodexAgents({
    codexHome,
    prior: { 'flow:reviewer': { hash: sha256(managedContents), path: managedPath } },
  });

  assert.deepEqual(result, { state: {} });
  await assert.rejects(access(managedPath), /ENOENT/);
});

test('rejects additional literal credential flags in STDIO MCP arguments', () => {
  for (const flag of [
    '--auth-token',
    '--bearer-token',
    '--client-secret',
    '--credentials',
    '--pass',
    '--secret-key',
  ]) {
    assert.throws(
      () => prepareMcp('remote', { args: [flag, 'ordinary-secret'], command: 'server' }),
      /literal credential/i
    );
    assert.throws(
      () => prepareMcp('remote', { args: [`${flag}=ordinary-secret`], command: 'server' }),
      /literal credential/i
    );
  }
});

test('maps trusted Claude bypassPermissions to a no-prompt Codex profile with conservative read denies', () => {
  const launch = buildCodexPermissionLaunch(
    [
      {
        category: 'permission-mode',
        precedence: 40,
        scope: 'project',
        value: 'bypassPermissions',
      },
      { category: 'permissions-deny', scope: 'project', value: 'Read(.env)' },
      { category: 'permissions-deny', scope: 'project', value: 'Read(**/*.key)' },
    ],
    '/workspace/orbit',
    true
  );

  assert.equal(launch.mode, 'bypassPermissions');
  assert.deepEqual(launch.args, [
    '-c',
    'approval_policy="never"',
    '-c',
    'default_permissions="maude-claude-bypass"',
    '-c',
    'permissions.maude-claude-bypass.description="Projected Claude bypassPermissions"',
    '-c',
    'permissions.maude-claude-bypass.filesystem={":root"="write","/workspace/orbit/**/*.key"="deny","/workspace/orbit/.env"="deny"}',
    '-c',
    'permissions.maude-claude-bypass.network={enabled=true,mode="full"}',
  ]);
});

test('keeps bypassPermissions inert when Codex cannot preserve a deny or ask rule', () => {
  const base = [
    {
      category: 'permission-mode',
      precedence: 40,
      scope: 'project',
      value: 'bypassPermissions',
    },
  ];

  assert.deepEqual(
    buildCodexPermissionLaunch(
      [...base, { category: 'permissions-deny', scope: 'project', value: 'Bash(curl *)' }],
      '/workspace/orbit',
      true
    ),
    { args: [], mode: null, reason: 'Claude deny rule cannot be represented by Codex.' }
  );
  assert.deepEqual(
    buildCodexPermissionLaunch(
      [...base, { category: 'permissions-ask', scope: 'project', value: 'Bash(git push *)' }],
      '/workspace/orbit',
      true
    ),
    { args: [], mode: null, reason: 'Claude ask rules cannot be preserved in no-prompt mode.' }
  );
});

test('never projects bypassPermissions for an untrusted Codex project', () => {
  assert.deepEqual(
    buildCodexPermissionLaunch(
      [
        {
          category: 'permission-mode',
          precedence: 10,
          scope: 'global',
          value: 'bypassPermissions',
        },
      ],
      '/workspace/untrusted',
      false
    ),
    { args: [], mode: null, reason: 'Codex project trust is required for permission projection.' }
  );
});

test('detects legacy Codex sandbox settings that disable permission profiles', () => {
  assert.equal(
    hasLegacySandboxConfig([{ model: 'gpt' }, { sandbox_mode: 'workspace-write' }]),
    true
  );
  assert.equal(hasLegacySandboxConfig([{ profile: 'legacy' }]), true);
  assert.equal(hasLegacySandboxConfig([{ profiles: { legacy: {} } }]), true);
  assert.equal(hasLegacySandboxConfig([{ model: 'gpt' }, {}]), false);
});
