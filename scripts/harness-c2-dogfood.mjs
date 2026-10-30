import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { stubClaudeEnv } from './lib/stub-claude.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const workspaces = [
  repoRoot,
  resolve(repoRoot, '../../studyfi/studyfi-design'),
  resolve(repoRoot, '../../studyfi/AI-StudyMate'),
];

const root = await realpath(await mkdtemp(join(tmpdir(), 'maude-harness-c2-')));
const sourceHome = join(root, 'source-home');
const installedPlugins = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
const pluginCache = join(homedir(), '.claude', 'plugins', 'cache');

try {
  await mkdir(join(sourceHome, '.claude', 'plugins'), { recursive: true });
  await cp(installedPlugins, join(sourceHome, '.claude', 'plugins', 'installed_plugins.json'));
  const results = [];
  for (const workspace of workspaces) {
    const slug = workspace.split('/').at(-1);
    const isolated = join(root, slug);
    const home = join(isolated, 'home');
    const target = join(isolated, 'target');
    const state = join(isolated, 'state');
    await Promise.all([home, target, state].map((path) => mkdir(path, { recursive: true })));
    const initialized = spawnSync('git', ['init', '-q'], {
      cwd: target,
      encoding: 'utf8',
      timeout: 30_000,
    });
    if (initialized.status !== 0) throw new Error(`${slug}: isolated git init failed`);
    const codexHome = join(home, '.codex');
    await mkdir(codexHome, { recursive: true });
    await writeFile(
      join(codexHome, 'config.toml'),
      `[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n\n[projects.${JSON.stringify(target)}]\ntrust_level = "trusted"\n`
    );
    const env = {
      ...process.env,
      CODEX_HOME: codexHome,
      HOME: home,
      MAUDE_HARNESS_ALLOWED_PLUGIN_ROOTS: [pluginCache].join(delimiter),
      MAUDE_HARNESS_CONFORMANCE: '1',
      MAUDE_HARNESS_PROJECT_TARGET_ROOT: target,
      MAUDE_HARNESS_SKIP_EXECUTABLE_PROOF: '1',
      MAUDE_HARNESS_SOURCE_HOME: sourceHome,
      MAUDE_HARNESS_STATE_ROOT: state,
      MAUDE_NO_UPDATE_CHECK: '1',
      XDG_CONFIG_HOME: join(home, '.config'),
      // never the machine's real `claude` (keychain dialog in a throwaway HOME): scripts/lib/stub-claude.mjs
      ...stubClaudeEnv(home),
    };
    const migrated = spawnSync(
      process.execPath,
      [
        join(repoRoot, 'cli', 'bin', 'maude.mjs'),
        'harness',
        'migrate',
        '--from',
        'claude',
        '--targets',
        'opencode,codex',
        '--project',
        workspace,
        '--yes',
        '--json',
      ],
      { cwd: repoRoot, encoding: 'utf8', env, timeout: 120_000 }
    );
    if (migrated.status !== 0) {
      throw new Error(`${slug}: isolated migration failed\n${migrated.stderr}\n${migrated.stdout}`);
    }
    const child = spawnSync(
      process.execPath,
      [
        join(repoRoot, 'cli', 'bin', 'maude.mjs'),
        'harness',
        'check',
        '--targets',
        'opencode,codex',
        '--project',
        workspace,
        '--strict',
        '--json',
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env,
        timeout: 120_000,
      }
    );
    let report;
    try {
      report = JSON.parse(child.stdout);
    } catch {
      throw new Error(`${slug}: invalid harness JSON\n${child.stderr}\n${child.stdout}`);
    }
    const openCode = spawnSync('opencode', ['debug', 'config'], {
      cwd: target,
      encoding: 'utf8',
      env,
      timeout: 120_000,
    });
    const codex = spawnSync('codex', ['--strict-config', 'doctor', '--json'], {
      cwd: target,
      encoding: 'utf8',
      env,
      timeout: 120_000,
    });
    let openCodeConfig;
    try {
      openCodeConfig = JSON.parse(openCode.stdout);
    } catch {
      openCodeConfig = JSON.parse(
        await readFile(join(target, '.opencode', 'maude-projector.inventory.json'), 'utf8')
      ).config;
    }
    let codexDoctor;
    try {
      codexDoctor = JSON.parse(codex.stdout);
    } catch {
      codexDoctor = null;
    }
    const diagnosticsPassed =
      openCode.status === 0 &&
      openCode.stdout.startsWith('{') &&
      codexDoctor?.checks?.['config.load']?.status === 'ok';
    results.push({
      workspace: slug,
      exitCode: child.status,
      strictPassed:
        child.status === 0 &&
        report.counts.securityFailures === 0 &&
        report.counts.unsupported === 0,
      drift: report.drift,
      diagnosticsPassed,
      loaded: {
        agents: Object.keys(openCodeConfig?.agent ?? {}).length,
        commands: Object.keys(openCodeConfig?.command ?? {}).length,
        instructions: openCodeConfig?.instructions?.length ?? 0,
        mcp: Object.keys(openCodeConfig?.mcp ?? {}).length,
        skillPaths: openCodeConfig?.skills?.paths?.length ?? 0,
      },
      counts: report.counts,
      blocking: report.capabilities.filter(
        (record) =>
          record.status === 'unsupported' ||
          (record.securityRelevant && !record.enabled && !record.acknowledged)
      ),
    });
  }
  const output = `${JSON.stringify({ root, results }, null, 2)}\n`;
  await writeFile(join(root, 'report.json'), output);
  process.stdout.write(output);
  process.exitCode = results.every(
    (result) => result.strictPassed && result.diagnosticsPassed && !result.drift
  )
    ? 0
    : 1;
} finally {
  if (process.env.MAUDE_KEEP_HARNESS_C2 !== '1') await rm(root, { force: true, recursive: true });
}
