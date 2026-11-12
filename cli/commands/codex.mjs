import { spawnSync } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { parseArgs } from '../lib/argv.mjs';
import { assertCodexPermissionAuthority, syncCodexRuntime } from '../lib/harness/codex-runtime.mjs';

/**
 * #226 — Codex commands that read nothing Maude projects (version, help, sign-in, shell
 * completion) go straight to the real binary: no Claude-state sync, no plugin-CLI calls.
 */
const PASS_THROUGH_FIRST = new Set([
  '--version',
  '-V',
  '--help',
  '-h',
  'help',
  'login',
  'logout',
  'completion',
]);

export function isPassThroughCodexCommand(args) {
  return args.length > 0 && PASS_THROUGH_FIRST.has(args[0]);
}

export async function run({ args, io = defaultIo(), sync = syncCodexRuntime, stdio = 'inherit' }) {
  const syncOnly = args[0] === 'sync';
  if (!syncOnly && isPassThroughCodexCommand(args)) {
    if (process.env.MAUDE_CODEX_BRIDGE_ACTIVE === '1') {
      throw new Error(
        'refusing recursive maude codex launch; set MAUDE_CODEX_REAL to the real binary'
      );
    }
    const executable = await resolveCodexExecutable(undefined);
    const result = spawnSync(executable, args, {
      env: { ...process.env, MAUDE_CODEX_BRIDGE_ACTIVE: '1' },
      stdio,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
    return { passThrough: true, exitCode: process.exitCode };
  }
  const { flags } = syncOnly ? parseArgs(args.slice(1), { booleans: ['json'] }) : { flags: {} };
  const launchArgs = [...args];
  if (!syncOnly) assertLocalCodexTarget(launchArgs);
  let explicitExecutable = flags.real;
  if (!syncOnly && launchArgs[0] === '--real') {
    if (!launchArgs[1]) throw new Error('--real requires an executable path');
    explicitExecutable = launchArgs[1];
    launchArgs.splice(0, 2);
  }
  if (process.env.MAUDE_CODEX_BRIDGE_ACTIVE === '1') {
    throw new Error(
      'refusing recursive maude codex launch; set MAUDE_CODEX_REAL to the real binary'
    );
  }
  process.env.MAUDE_CODEX_BRIDGE_ACTIVE = '1';
  const home = resolve(process.env.HOME || homedir());
  const projectRoot = await realpath(
    resolve(flags.project || codexProjectDirectory(launchArgs) || process.cwd())
  );
  const requestedCodexHome = resolve(process.env.CODEX_HOME || join(home, '.codex'));
  if (isContained(requestedCodexHome, projectRoot)) {
    throw new Error('CODEX_HOME must be outside the current project for maude codex');
  }
  const codexHome = await realpath(requestedCodexHome);
  if (isContained(codexHome, projectRoot)) {
    throw new Error('CODEX_HOME must resolve outside the current project for maude codex');
  }
  const executable = await resolveCodexExecutable(explicitExecutable);
  const synced = await sync({
    codexExecutable: executable,
    codexHome,
    home,
    projectRoot,
  });
  if (syncOnly) {
    if (flags.json) io.stdout.write(`${JSON.stringify(synced.summary, null, 2)}\n`);
    return synced.summary;
  }
  if (synced.permissionMode && hasCodexPermissionOverride(launchArgs)) {
    throw new Error('refusing a Codex sandbox override that could disable projected Claude denies');
  }
  const canonicalLaunchArgs = canonicalizeCodexProjectArguments(launchArgs, projectRoot);
  if (synced.permissionMode) {
    await assertCodexPermissionAuthority({ codexHome, projectRoot });
  }
  const result = spawnSync(executable, [...synced.launchArguments, ...canonicalLaunchArgs], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...synced.launchEnvironment,
      CODEX_HOME: codexHome,
      MAUDE_CODEX_BRIDGE_ACTIVE: process.env.MAUDE_CODEX_BRIDGE_ACTIVE,
    },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  return { ...synced.summary, exitCode: process.exitCode };
}

export function codexProjectDirectory(args) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') return null;
    if (argument === '-C' || argument === '--cd') return args[index + 1] ?? null;
    if (argument.startsWith('-C')) return argument.slice(2) || null;
    if (argument.startsWith('--cd=')) return argument.slice('--cd='.length) || null;
  }
  return null;
}

export function hasCodexRemoteTarget(args) {
  for (const argument of args) {
    if (argument === '--') return false;
    if (argument === '--remote' || argument.startsWith('--remote=')) return true;
    if (argument === 'cloud') return true;
  }
  return false;
}

export function assertLocalCodexTarget(args) {
  if (hasCodexRemoteTarget(args)) {
    throw new Error('refusing to synchronize local Claude state into a remote Codex session');
  }
}

export function canonicalizeCodexProjectArguments(args, projectRoot) {
  const output = [];
  let found = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--')
      return [...(found ? ['-C', projectRoot] : []), ...output, ...args.slice(index)];
    if (argument === '-C' || argument === '--cd') {
      if (found) throw new Error('multiple Codex working-directory overrides are not supported');
      if (args[index + 1] === undefined) throw new Error(`${argument} requires a directory`);
      found = true;
      index += 1;
      continue;
    }
    if (argument.startsWith('-C')) {
      if (found) throw new Error('multiple Codex working-directory overrides are not supported');
      if (!argument.slice(2)) throw new Error('-C requires a directory');
      found = true;
      continue;
    }
    if (argument.startsWith('--cd=')) {
      if (found) throw new Error('multiple Codex working-directory overrides are not supported');
      if (!argument.slice('--cd='.length)) throw new Error('--cd requires a directory');
      found = true;
      continue;
    }
    output.push(argument);
  }
  return [...(found ? ['-C', projectRoot] : []), ...output];
}

export function hasCodexPermissionOverride(args) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') return false;
    if (
      argument === '-s' ||
      /^-s.+/.test(argument) ||
      argument === '--sandbox' ||
      argument.startsWith('--sandbox=') ||
      argument === '--dangerously-bypass-approvals-and-sandbox' ||
      argument === '--yolo' ||
      argument === '--approve-for-me' ||
      argument === '-p' ||
      /^-p.+/.test(argument) ||
      argument === '--profile' ||
      argument.startsWith('--profile=') ||
      argument === '-P' ||
      /^-P.+/.test(argument) ||
      argument === '--permission-profile' ||
      argument.startsWith('--permission-profile=')
    ) {
      return true;
    }
    if (
      argument === '-c' ||
      /^-c.+/.test(argument) ||
      argument === '--config' ||
      argument.startsWith('--config=')
    ) {
      return true;
    }
  }
  return false;
}

function isContained(path, root) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

async function resolveCodexExecutable(explicit) {
  if (explicit) return await canonicalExecutable(explicit);
  if (process.env.MAUDE_CODEX_REAL) return await canonicalExecutable(process.env.MAUDE_CODEX_REAL);
  for (const root of String(process.env.PATH || '').split(delimiter)) {
    if (!root) continue;
    const candidate = join(root, 'codex');
    try {
      await access(candidate);
      return await realpath(candidate);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Codex executable not found; pass --real <path>');
}

async function canonicalExecutable(path) {
  await access(path);
  return await realpath(path);
}

function defaultIo() {
  return { stderr: process.stderr, stdout: process.stdout };
}
