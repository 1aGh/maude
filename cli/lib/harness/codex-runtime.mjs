import { spawnSync } from 'node:child_process';
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { parseDocument } from '@decimalturn/toml-patch';

import { discoverClaude } from './discover-claude.mjs';
import { acquireScopeLock } from './managed-state.mjs';
import { sha256 } from './model.mjs';
import { classifyCredential, containsRejectedLiteral, sanitizeUntrustedValue } from './secrets.mjs';

const RUNTIME_SCHEMA_VERSION = 8;

export async function syncCodexRuntime({
  codexExecutable = 'codex',
  codexHome,
  home,
  projectRoot,
  stateRoot = join(home, '.config', 'maude', 'harness', 'codex-runtime'),
}) {
  await mkdir(stateRoot, { mode: 0o700, recursive: true });
  await assertCanonicalDirectory(stateRoot);
  await chmod(stateRoot, 0o700);
  const releaseLock = await acquireScopeLock(stateRoot);
  try {
    return await syncCodexRuntimeLocked({
      codexExecutable,
      codexHome,
      home,
      projectRoot,
      stateRoot,
    });
  } finally {
    await releaseLock();
  }
}

async function syncCodexRuntimeLocked({
  codexExecutable,
  codexHome,
  home,
  projectRoot,
  stateRoot,
}) {
  const statePath = join(stateRoot, 'state.json');
  if (await pathExists(statePath)) await assertOwnedRegularFile(statePath, stateRoot);
  const codexConfig = await readCodexConfig(codexHome);
  const projectTrusted = codexProjectTrusted(codexConfig, projectRoot);
  const ir = await discoverClaude({
    home,
    includeProjectSettings: projectTrusted,
    profile: 'runtime',
    projectRoot,
  });
  const desiredPlugins = ir.items
    .filter((item) => item.category === 'plugins' && !item.value?.missing)
    .sort((left, right) => left.name.localeCompare(right.name));
  const projectCodexConfig = projectTrusted ? await readProjectCodexConfig(projectRoot) : {};
  const permissionLaunch = hasLegacySandboxConfig([codexConfig, projectCodexConfig])
    ? { args: [], mode: null, reason: 'A Codex sandbox_mode setting disables permission profiles.' }
    : buildCodexPermissionLaunch(ir.items, projectRoot, projectTrusted);
  for (const item of desiredPlugins) item.sourceHash = await hashPluginTree(item.value.installPath);
  const prior = await readJson(statePath, {
    managedMarketplaces: {},
    agents: {},
    mcps: {},
    plugins: {},
  });
  if (prior.schemaVersion !== RUNTIME_SCHEMA_VERSION) prior.plugins = {};
  const marketplaceList = runCodexJson(
    codexExecutable,
    ['plugin', 'marketplace', 'list', '--json'],
    projectRoot,
    codexHome
  );
  const configuredMarketplaces = new Map(
    (marketplaceList.marketplaces ?? []).map((entry) => [entry.name, entry])
  );
  const marketplaceSources = await resolveMarketplaceSources({
    desiredPlugins,
    priorPluginHashes: prior.plugins,
    stateRoot,
  });

  for (const [name, source] of marketplaceSources) {
    const configured = configuredMarketplaces.get(name);
    if (configured) {
      const current = await canonicalIfPresent(configured.marketplaceSource?.source);
      const desired = await realpath(source);
      if (current !== desired) {
        const previouslyManaged = prior.managedMarketplaces[name];
        if (current !== (await canonicalIfPresent(previouslyManaged))) {
          throw new Error(
            `Codex marketplace ${name} is user-owned at ${configured.marketplaceSource?.source}; refusing to replace it with ${source}`
          );
        }
        runCodexJson(
          codexExecutable,
          ['plugin', 'marketplace', 'remove', name, '--json'],
          projectRoot,
          codexHome
        );
      } else {
        prior.managedMarketplaces[name] = source;
        continue;
      }
    }
    runCodexJson(
      codexExecutable,
      ['plugin', 'marketplace', 'add', source, '--json'],
      projectRoot,
      codexHome
    );
    prior.managedMarketplaces[name] = source;
  }

  const pluginList = runCodexJson(
    codexExecutable,
    ['plugin', 'list', '--json'],
    projectRoot,
    codexHome
  );
  const installedEntries = new Map(
    (pluginList.installed ?? []).map((entry) => [entry.pluginId, entry])
  );
  const installed = new Set(installedEntries.keys());
  const desiredIds = new Set(desiredPlugins.map((item) => item.name));
  for (const pluginId of Object.keys(prior.plugins)) {
    if (desiredIds.has(pluginId)) continue;
    if (installed.has(pluginId)) {
      await assertManagedPluginEntry(installedEntries.get(pluginId), pluginId, stateRoot);
      runCodexJson(
        codexExecutable,
        ['plugin', 'remove', pluginId, '--json'],
        projectRoot,
        codexHome
      );
    }
    delete prior.plugins[pluginId];
  }
  for (const item of desiredPlugins) {
    if (!installed.has(item.name) || prior.plugins[item.name] !== item.sourceHash) {
      if (installed.has(item.name)) {
        await assertManagedPluginEntry(installedEntries.get(item.name), item.name, stateRoot);
      }
      runCodexJson(codexExecutable, ['plugin', 'add', item.name, '--json'], projectRoot, codexHome);
    }
    prior.plugins[item.name] = item.sourceHash;
  }

  const mcp = await syncStandaloneMcp({
    codexExecutable,
    codexHome,
    home,
    prior: prior.mcps,
    projectRoot,
  });
  const agents = await removeManagedCodexAgents({
    codexHome,
    prior: prior.agents ?? {},
  });
  prior.agents = agents.state;
  prior.mcps = mcp.state;
  prior.schemaVersion = RUNTIME_SCHEMA_VERSION;
  await writeOwnedFile(statePath, `${JSON.stringify(prior, null, 2)}\n`, stateRoot);
  return {
    launchArguments: ['-c', 'skills.max_context_tokens=10000', ...permissionLaunch.args],
    launchEnvironment: {},
    permissionMode: permissionLaunch.mode,
    summary: {
      marketplaces: [...marketplaceSources.keys()].sort(),
      agents: [],
      unsupportedAgents: 'Codex custom agents inherit the parent tool registry',
      mcps: Object.keys(mcp.state).sort(),
      plugins: [...desiredIds].sort(),
      permissionMode: permissionLaunch.mode,
      permissionProjection: permissionLaunch.reason,
    },
  };
}

export function buildCodexPermissionLaunch(items, projectRoot, projectTrusted) {
  if (!projectTrusted) {
    return {
      args: [],
      mode: null,
      reason: 'Codex project trust is required for permission projection.',
    };
  }
  const applicable = items.filter((item) => projectTrusted || item.scope !== 'project');
  const mode = applicable
    .filter((item) => item.category === 'permission-mode')
    .sort((left, right) => (left.precedence ?? 0) - (right.precedence ?? 0))
    .at(-1)?.value;
  if (mode !== 'bypassPermissions') {
    return { args: [], mode: null, reason: 'No exact runtime permission mode requested.' };
  }
  if (applicable.some((item) => item.category === 'permissions-ask')) {
    return {
      args: [],
      mode: null,
      reason: 'Claude ask rules cannot be preserved in no-prompt mode.',
    };
  }

  const denies = [];
  for (const item of applicable.filter((candidate) => candidate.category === 'permissions-deny')) {
    const match = /^Read\((.+)\)$/.exec(item.value);
    if (!match || match[1].startsWith('~')) {
      return {
        args: [],
        mode: null,
        reason: 'Claude deny rule cannot be represented by Codex.',
      };
    }
    denies.push(resolve(projectRoot, match[1]));
  }
  const filesystem = [
    `${JSON.stringify(':root')}=${JSON.stringify('write')}`,
    ...[...new Set(denies)]
      .sort()
      .map((path) => `${JSON.stringify(path)}=${JSON.stringify('deny')}`),
  ].join(',');

  return {
    args: [
      '-c',
      'approval_policy="never"',
      '-c',
      'default_permissions="maude-claude-bypass"',
      '-c',
      'permissions.maude-claude-bypass.description="Projected Claude bypassPermissions"',
      '-c',
      `permissions.maude-claude-bypass.filesystem={${filesystem}}`,
      '-c',
      'permissions.maude-claude-bypass.network={enabled=true,mode="full"}',
    ],
    mode: 'bypassPermissions',
    reason: 'Projected as approval never with full network and filesystem access plus deny globs.',
  };
}

export async function removeManagedCodexAgents({ codexHome, prior }) {
  const root = join(codexHome, 'agents');
  await assertCanonicalDirectory(codexHome);
  await mkdir(root, { recursive: true });
  await assertCanonicalDirectory(root);
  for (const entry of Object.values(prior)) {
    if (!(await pathExists(entry.path))) continue;
    assertContained(entry.path, root);
    const contents = await readFile(entry.path, 'utf8');
    if (sha256(contents) !== entry.hash) {
      throw new Error(`managed Codex agent was externally modified: ${entry.path}`);
    }
    await rm(entry.path);
  }
  return { state: {} };
}

async function readCodexConfig(codexHome) {
  const path = join(codexHome, 'config.toml');
  await assertOwnedRegularFile(path, codexHome);
  return parseDocument(await readFile(path, 'utf8')).toJsObject;
}

function codexProjectTrusted(config, projectRoot) {
  return config.projects?.[projectRoot]?.trust_level === 'trusted';
}

async function readProjectCodexConfig(projectRoot) {
  const path = join(projectRoot, '.codex', 'config.toml');
  try {
    const canonical = await realpath(path);
    assertContained(canonical, projectRoot);
    await assertOwnedRegularFile(canonical, projectRoot);
    return parseDocument(await readFile(canonical, 'utf8')).toJsObject;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export function hasLegacySandboxConfig(configs) {
  return configs.some(
    (config) =>
      config.sandbox_mode !== undefined ||
      config.profile !== undefined ||
      config.profiles !== undefined
  );
}

async function assertManagedPluginEntry(entry, pluginId, stateRoot) {
  const [name, marketplace] = pluginId.split('@');
  const expected = join(stateRoot, 'marketplaces', marketplace, 'plugins', name);
  const current = await canonicalIfPresent(entry?.source?.path);
  if (current !== (await canonicalIfPresent(expected))) {
    throw new Error(`Codex plugin ${pluginId} was replaced outside Maude ownership`);
  }
}

export async function assertCodexPermissionAuthority({ codexHome, projectRoot }) {
  if ((await realpath(projectRoot)) !== projectRoot) {
    throw new Error('Codex project path changed after permission authorization');
  }
  const config = await readCodexConfig(codexHome);
  if (!codexProjectTrusted(config, projectRoot)) {
    throw new Error('Codex project trust changed after permission authorization');
  }
  const projectConfig = await readProjectCodexConfig(projectRoot);
  if (hasLegacySandboxConfig([config, projectConfig])) {
    throw new Error('Codex sandbox settings changed after permission authorization');
  }
}

async function resolveMarketplaceSources({ desiredPlugins, priorPluginHashes, stateRoot }) {
  const byMarketplace = new Map();
  for (const item of desiredPlugins) {
    const marketplace = marketplaceName(item.name);
    const entries = byMarketplace.get(marketplace) ?? [];
    entries.push(item);
    byMarketplace.set(marketplace, entries);
  }
  const sources = new Map();
  for (const [marketplace, plugins] of byMarketplace) {
    sources.set(
      marketplace,
      await materializeRuntimeMarketplace({
        marketplace,
        plugins,
        priorPluginHashes,
        stateRoot,
      })
    );
  }
  return sources;
}

async function materializeRuntimeMarketplace({
  marketplace,
  plugins,
  priorPluginHashes,
  stateRoot,
}) {
  const root = join(stateRoot, 'marketplaces', marketplace);
  const pluginRoot = join(root, 'plugins');
  const manifestRoot = join(root, '.claude-plugin');
  await mkdir(pluginRoot, { mode: 0o700, recursive: true });
  await mkdir(manifestRoot, { mode: 0o700, recursive: true });
  await assertCanonicalDirectory(root);
  await assertCanonicalDirectory(pluginRoot);
  await assertCanonicalDirectory(manifestRoot);
  await Promise.all([chmod(root, 0o700), chmod(pluginRoot, 0o700), chmod(manifestRoot, 0o700)]);
  const entries = [];
  for (const item of plugins) {
    const name = pluginName(item.name);
    const target = join(pluginRoot, name);
    if (priorPluginHashes[item.name] !== item.sourceHash || !(await pathExists(target))) {
      await materializePluginSource(item, target, root);
    }
    entries.push({
      description: `Runtime mirror of ${item.name}`,
      name,
      source: `./plugins/${name}`,
      ...(item.value.version ? { version: item.value.version } : {}),
    });
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  await writeOwnedFile(
    join(manifestRoot, 'marketplace.json'),
    `${JSON.stringify({ name: marketplace, plugins: entries }, null, 2)}\n`,
    root
  );
  return root;
}

export async function materializePluginSource(item, target, ownedRoot) {
  await removeOwnedPath(target, ownedRoot);
  await assertTreeHasNoSymlinks(item.value.installPath);
  await cp(item.value.installPath, target, { recursive: true });
  const copiedHash = await hashPluginTree(target);
  if (copiedHash !== item.sourceHash) {
    await rm(target, { recursive: true });
    throw new Error(
      `plugin changed while materializing: ${item.name} (${item.sourceHash} != ${copiedHash})`
    );
  }
  // A source-owned native package already supplies its entry points and paths.
  // Flattening Claude commands over it would break relative reference links.
  if (await pathExists(join(target, '.codex-plugin', 'plugin.json'))) return;
  const commands = await snapshotCommandFiles(target);
  const generatedRoot = join(target, 'skills');
  await mkdir(generatedRoot, { recursive: true });
  for (const commandPath of commands) {
    const command = parseClaudeCommand(await readFile(commandPath, 'utf8'), commandPath);
    const skillRoot = join(generatedRoot, `source-command-${command.name}`);
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, 'SKILL.md'), renderCommandSkill(command), 'utf8');
  }
  const codexManifestRoot = join(target, '.codex-plugin');
  const codexManifestPath = join(codexManifestRoot, 'plugin.json');
  const claudeManifest = await readJson(join(target, '.claude-plugin', 'plugin.json'), {});
  await mkdir(codexManifestRoot, { recursive: true });
  await writeFile(
    codexManifestPath,
    `${JSON.stringify(
      {
        description: claudeManifest.description ?? `Runtime mirror of ${item.name}`,
        name: pluginName(item.name),
        skills: './skills/',
        version: claudeManifest.version ?? item.value.version,
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

export function parseClaudeCommand(contents, path = 'command.md') {
  if (!contents.startsWith('---\n')) throw new Error(`Claude command lacks frontmatter: ${path}`);
  const end = contents.indexOf('\n---\n', 4);
  if (end < 0) throw new Error(`Claude command has unterminated frontmatter: ${path}`);
  const frontmatter = contents.slice(4, end);
  const sourceName = frontmatterValue(frontmatter, 'name') ?? basename(path, '.md');
  assertSafeQualifiedName(sourceName, 'command');
  const name = sourceName.replaceAll(':', '-');
  return {
    body: contents.slice(end + 5),
    description: frontmatterValue(frontmatter, 'description') ?? `Run the ${name} command`,
    name,
  };
}

export function renderCommandSkill(command) {
  return `---\nname: ${JSON.stringify(`source-command-${command.name}`)}\ndescription: ${JSON.stringify(command.description)}\n---\n\n# source-command-${command.name}\n\nUse this skill when the user asks to run the migrated source command \`${command.name}\`.\n\n## Command Template\n\n${command.body}`;
}

export function parseClaudeAgent(contents, path = 'agent.md') {
  if (!contents.startsWith('---\n')) throw new Error(`Claude agent lacks frontmatter: ${path}`);
  const end = contents.indexOf('\n---\n', 4);
  if (end < 0) throw new Error(`Claude agent has unterminated frontmatter: ${path}`);
  const frontmatter = contents.slice(4, end);
  const name = frontmatterValue(frontmatter, 'name') ?? basename(path, '.md');
  assertSafeName(name, 'agent');
  return {
    body: contents.slice(end + 5),
    description: frontmatterValue(frontmatter, 'description') ?? `Run the ${name} agent`,
    name,
  };
}

async function syncStandaloneMcp({ codexExecutable, codexHome, home, prior, projectRoot }) {
  const servers = await readClaudeMcp(home);
  const current = runCodexJson(codexExecutable, ['mcp', 'list', '--json'], projectRoot, codexHome);
  const installedEntries = new Map(
    (Array.isArray(current) ? current : []).map((entry) => [entry.name, entry])
  );
  const installed = new Set(installedEntries.keys());
  const desired = new Map();
  for (const [name, value] of Object.entries(servers).sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (value?.disabled === true || value?.enabled === false) continue;
    assertSafeName(name, 'MCP server');
    const prepared = prepareMcp(name, value);
    desired.set(name, prepared);
  }
  for (const name of Object.keys(prior)) {
    if (desired.has(name)) continue;
    if (installed.has(name)) {
      assertManagedMcpEntry(installedEntries.get(name), name, prior[name]);
      runCodex(codexExecutable, ['mcp', 'remove', name], projectRoot, codexHome);
    }
  }
  const state = {};
  for (const [name, prepared] of desired) {
    const hash = sha256(JSON.stringify(prepared.redacted));
    const currentHash = installed.has(name) ? mcpEntryHash(installedEntries.get(name)) : null;
    if (installed.has(name) && prior[name] === undefined) {
      throw new Error(`Codex MCP ${name} already exists and is not managed by Maude`);
    }
    if (
      installed.has(name) &&
      !mcpEntryMatchesHash(installedEntries.get(name), prior[name]) &&
      currentHash !== hash
    ) {
      throw new Error(`Codex MCP ${name} was replaced outside Maude ownership`);
    }
    if (!installed.has(name) || currentHash !== hash) {
      if (installed.has(name)) {
        runCodex(codexExecutable, ['mcp', 'remove', name], projectRoot, codexHome);
      }
      runCodex(codexExecutable, prepared.args, projectRoot, codexHome);
    }
    state[name] = hash;
  }
  return { state };
}

function assertManagedMcpEntry(entry, name, expectedHash) {
  if (!mcpEntryMatchesHash(entry, expectedHash)) {
    throw new Error(`Codex MCP ${name} was replaced outside Maude ownership`);
  }
}

export function mcpEntryMatchesHash(entry, expectedHash) {
  if (!expectedHash) return false;
  if (mcpEntryHash(entry) === expectedHash) return true;
  const transport = entry?.transport ?? {};
  if (
    entry?.enabled === false ||
    entry?.startup_timeout_sec != null ||
    entry?.tool_timeout_sec != null ||
    transport.cwd ||
    Object.keys(transport.env ?? {}).length > 0
  ) {
    return false;
  }
  return sha256(JSON.stringify(legacyMcpFingerprint(entry))) === expectedHash;
}

function mcpEntryHash(entry) {
  return sha256(JSON.stringify(mcpFingerprint(entry)));
}

export function mcpFingerprint(entry) {
  const transport = entry?.transport ?? {};
  const settings = {
    ...(entry?.enabled === false ? { enabled: false } : {}),
    ...(entry?.startup_timeout_sec != null
      ? { startupTimeoutSeconds: entry.startup_timeout_sec }
      : {}),
    ...(entry?.tool_timeout_sec != null ? { toolTimeoutSeconds: entry.tool_timeout_sec } : {}),
  };
  if (transport.type === 'streamable_http') {
    return {
      ...(transport.bearer_token_env_var
        ? { bearerTokenEnvVar: transport.bearer_token_env_var }
        : {}),
      type: 'http',
      url: transport.url,
      ...settings,
    };
  }
  if (transport.type === 'stdio') {
    return {
      command: [transport.command, ...(transport.args ?? [])],
      ...(transport.cwd ? { cwd: transport.cwd } : {}),
      ...(Object.keys(transport.env ?? {}).length > 0
        ? {
            env: Object.fromEntries(
              Object.entries(transport.env)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, value]) => [key, sha256(String(value))])
            ),
          }
        : {}),
      ...((transport.env_vars ?? []).length > 0 ? { envKeys: [...transport.env_vars].sort() } : {}),
      type: 'stdio',
      ...settings,
    };
  }
  return { unsupported: true };
}

function legacyMcpFingerprint(entry) {
  const transport = entry?.transport ?? {};
  if (transport.type === 'streamable_http') {
    return {
      ...(transport.bearer_token_env_var
        ? { bearerTokenEnvVar: transport.bearer_token_env_var }
        : {}),
      type: 'http',
      url: transport.url,
    };
  }
  if (transport.type === 'stdio') {
    return {
      command: [transport.command, ...(transport.args ?? [])],
      envKeys: transport.env_vars ?? [],
      type: 'stdio',
    };
  }
  return { unsupported: true };
}

async function readClaudeMcp(home) {
  const claude = await readJson(join(home, '.claude.json'), {});
  return claude.mcpServers ?? {};
}

export function prepareMcp(name, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Claude MCP ${name} has an invalid definition`);
  }
  if (typeof value.url === 'string') {
    if (classifyCredential(value.url)) {
      throw new Error(`Claude MCP ${name} URL contains a literal credential`);
    }
    const args = ['mcp', 'add', name, '--url', value.url];
    const headers = value.headers ?? {};
    const unsupported = Object.keys(headers).filter(
      (header) => header.toLowerCase() !== 'authorization'
    );
    if (unsupported.length > 0) {
      throw new Error(
        `Claude MCP ${name} uses unsupported HTTP headers: ${unsupported.join(', ')}`
      );
    }
    if (headers.Authorization !== undefined || headers.authorization !== undefined) {
      const authorization = headers.Authorization ?? headers.authorization;
      if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) {
        throw new Error(`Claude MCP ${name} Authorization must use a Bearer token`);
      }
      const raw = authorization.slice('Bearer '.length);
      const envName = environmentReference(raw) ?? matchingEnvironmentName(raw);
      if (!envName) {
        throw new Error(
          `Claude MCP ${name} bearer token must reference an existing environment variable`
        );
      }
      args.push('--bearer-token-env-var', envName);
      return {
        args,
        redacted: { bearerTokenEnvVar: envName, type: 'http', url: value.url },
      };
    }
    return { args, redacted: { type: 'http', url: value.url } };
  }
  if (typeof value.command !== 'string' || !value.command) {
    throw new Error(`Claude MCP ${name} requires url or command`);
  }
  const command = [value.command, ...(Array.isArray(value.args) ? value.args.map(String) : [])];
  if (containsRejectedLiteral(sanitizeUntrustedValue({ args: command }).value)) {
    throw new Error(`Claude MCP ${name} command contains a literal credential`);
  }
  for (const [key, raw] of Object.entries(value.env ?? {})) {
    const referenced = environmentReference(raw);
    if (!referenced || referenced !== key) {
      throw new Error(
        `Claude MCP ${name} environment ${key} must use the same-name environment reference`
      );
    }
  }
  if (Object.keys(value.env ?? {}).length > 0) {
    throw new Error(
      `Claude MCP ${name} cannot preserve STDIO environment references through the Codex CLI`
    );
  }
  return {
    args: ['mcp', 'add', name, '--', ...command],
    redacted: { command, envKeys: Object.keys(value.env ?? {}).sort(), type: 'stdio' },
  };
}

function runCodexJson(executable, args, cwd, codexHome, extraEnv = {}) {
  const output = runCodex(executable, args, cwd, codexHome, extraEnv);
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`codex ${args.slice(0, 3).join(' ')} returned invalid JSON: ${error.message}`);
  }
}

function runCodex(executable, args, cwd, codexHome, extraEnv = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv, CODEX_HOME: codexHome },
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `codex ${args.slice(0, 3).join(' ')} failed: ${result.stderr || result.stdout}`
    );
  }
  return result.stdout;
}

async function removeOwnedPath(path, ownedRoot) {
  let current;
  try {
    current = await lstat(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (current) {
    const canonicalRoot = await realpath(ownedRoot);
    const canonicalParent = await realpath(dirname(path));
    if (canonicalParent !== canonicalRoot && !canonicalParent.startsWith(`${canonicalRoot}/`)) {
      throw new Error(`runtime marketplace path escapes its owned root: ${path}`);
    }
    await rm(path, { recursive: current.isDirectory() && !current.isSymbolicLink() });
  }
}

function marketplaceName(pluginId) {
  const index = pluginId.lastIndexOf('@');
  if (index <= 0 || index === pluginId.length - 1) throw new Error(`invalid plugin id ${pluginId}`);
  return assertSafeName(pluginId.slice(index + 1), 'marketplace');
}

function pluginName(pluginId) {
  return assertSafeName(pluginId.slice(0, pluginId.lastIndexOf('@')), 'plugin');
}

function environmentReference(value) {
  if (typeof value !== 'string') return null;
  const match =
    /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value) ?? /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(value);
  return match?.[1] ?? null;
}

function matchingEnvironmentName(value) {
  return Object.entries(process.env).find(
    ([name, candidate]) => /(?:TOKEN|SECRET|PASSWORD|KEY|AUTH)/i.test(name) && candidate === value
  )?.[0];
}

function assertSafeName(value, label) {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/.test(value)) {
    throw new Error(`invalid ${label} name ${JSON.stringify(value)}`);
  }
  return value;
}

function assertSafeQualifiedName(value, label) {
  for (const segment of value.split(':')) assertSafeName(segment, label);
  return value;
}

function frontmatterValue(frontmatter, key) {
  const raw = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(frontmatter)?.[1]?.trim();
  if (!raw || raw === '>' || raw === '|') return null;
  if (
    raw.length >= 2 &&
    ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

async function commandFiles(root) {
  return markdownSourceFiles(root);
}

export async function snapshotCommandFiles(pluginSnapshotRoot) {
  return commandFiles(join(pluginSnapshotRoot, 'commands'));
}

async function markdownSourceFiles(root) {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter(
        (entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_')
      )
      .map((entry) => join(root, entry.name))
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function assertTreeHasNoSymlinks(root) {
  await assertCanonicalDirectory(root);
  const pending = [root];
  let entries = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      entries += 1;
      if (entries > 20_000) throw new Error(`plugin tree exceeds 20000 entries: ${root}`);
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`plugin tree contains symlink: ${path}`);
      if (entry.isDirectory()) pending.push(path);
      else if (!entry.isFile()) throw new Error(`plugin tree contains non-regular file: ${path}`);
    }
  }
}

async function hashPluginTree(root) {
  await assertCanonicalDirectory(root);
  const canonicalRoot = root;
  const pending = [canonicalRoot];
  const files = [];
  let entries = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      entries += 1;
      if (entries > 20_000) throw new Error(`plugin tree exceeds 20000 entries: ${root}`);
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`plugin tree contains symlink: ${path}`);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`plugin tree contains non-regular file: ${path}`);
    }
  }
  const closure = [];
  for (const path of files.sort()) {
    const contents = await readFile(path);
    bytes += contents.byteLength;
    if (bytes > 100 * 1024 * 1024) throw new Error(`plugin tree exceeds 100 MiB: ${root}`);
    closure.push(`${relative(canonicalRoot, path)}\0${sha256(contents)}`);
  }
  return sha256(closure.join('\n'));
}

async function assertCanonicalDirectory(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory() || (await realpath(path)) !== resolve(path)) {
    throw new Error(`runtime root is not a canonical directory: ${path}`);
  }
}

async function assertOwnedRegularFile(path, ownedRoot) {
  await assertCanonicalDirectory(ownedRoot);
  assertContained(path, ownedRoot);
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile())
    throw new Error(`runtime file is not regular: ${path}`);
}

async function writeOwnedFile(path, contents, ownedRoot) {
  assertContained(path, ownedRoot);
  const parent = dirname(path);
  await assertCanonicalDirectory(parent);
  if (await pathExists(path)) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile())
      throw new Error(`runtime file is not regular: ${path}`);
  }
  const temporary = join(parent, `.${basename(path)}.${process.pid}.tmp`);
  await writeFile(temporary, contents, { flag: 'wx', mode: 0o600 });
  try {
    await assertCanonicalDirectory(parent);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function assertContained(path, root) {
  const nested = relative(resolve(root), resolve(path));
  if (nested === '..' || nested.startsWith(`..${sep}`)) {
    throw new Error(`runtime path escapes its owned root: ${path}`);
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function canonicalIfPresent(path) {
  if (typeof path !== 'string') return null;
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    throw new Error(`invalid JSON at ${path}: ${error.message}`);
  }
}
