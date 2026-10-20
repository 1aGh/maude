// describe/claude.ts — the real describer: the `asset-describer` agent, headless, through the person's own `claude`
// (S12.13; V2-1.17 §5.9, S12-slices S12.13). batch.ts's `Describer` seam; the stub stays behind MAUDE_DESCRIBE_STUB=1.
//
// One batch = one `claude -p` run:
//
//   bin     the bundled `claude` (acp/probe.ts `resolveClaudePath`: the content-pinned MAUDE_CLAUDE_BIN the guided
//           install provisioned, else `claude` on PATH) — never a shell, never a login-shell lookup
//   cwd     the batch's OS temp dir (batch.ts made it; it holds ONLY `<sha256>.jpg` tiles ≤ 1024 px)
//   argv    `--agents` defines exactly ONE agent, `asset-describer`, from the design plugin's agents/asset-describer.md
//           (tools forced to Read, whatever the file says); `--agent` runs it as the main thread; `--tools Read` +
//           `--allowedTools Read` + `--permission-mode dontAsk` leave nothing else to call or approve; `--restricted`
//           ignores the person's settings files and confines Read to the cwd; `--strict-mcp-config` with no config
//           loads no MCP server; no session is kept. The prompt names the files by sha only.
//   env     an allow-list (HOME, USER, locale, TMPDIR, CLAUDE_CONFIG_DIR) plus a fixed PATH: no ANTHROPIC_* (the
//           person's subscription, DDR-123), no MAUDE_*, no CLAUDE_PROJECT_DIR, no PWD of the project
//   time    killed after `timeoutMs` (default 3 min); its stdout is capped
//
// No project path, file name or folder ever reaches the agent. What it answers is untrusted: batch.ts runs it through
// validate.ts before a word is kept. The agent file is the authored source; when the layout ships no design plugin
// (npm / web serve) there is no describer — describing is the desktop's (A5), and the panel says AI is not connected.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveClaudePath } from '../acp/probe.ts';
import { DESIGN_PLUGIN_DIR } from '../paths.ts';
import type { DescribeBatch, Describer } from './batch.ts';
import { HANDOFF_FORMAT } from './validate.ts';

export const AGENT_NAME = 'asset-describer';
export const AGENT_TOOLS = ['Read'] as const;
export const DESCRIBE_TIMEOUT_MS = 3 * 60_000;
const STDOUT_MAX = 1024 * 1024;
/** How long "is a describer there?" is remembered (status() asks on every read; the spawn re-resolves). */
const AVAILABLE_TTL_MS = 30_000;

/** The env keys a describe run inherits. Everything else is dropped. */
export const ENV_ALLOW = [
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'CLAUDE_CONFIG_DIR',
  // Windows needs these to start a process and find the person's profile
  'SystemRoot',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
] as const;
const POSIX_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];

export interface AgentDef {
  description: string;
  prompt: string;
}

/** agents/asset-describer.md → its description and body. Null when absent, or when its tools are not Read alone. */
export function readAgentDef(pluginDir: string | null = DESIGN_PLUGIN_DIR): AgentDef | null {
  if (!pluginDir) return null;
  let src: string;
  try {
    src = readFileSync(path.join(pluginDir, 'agents', `${AGENT_NAME}.md`), 'utf8');
  } catch {
    return null;
  }
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const fm = m[1] ?? '';
  const field = (k: string) =>
    fm
      .match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]
      ?.trim()
      .replace(/^"([\s\S]*)"$/, '$1') ?? '';
  if (field('name') !== AGENT_NAME) return null;
  // a widened copy of the file (a planted `tools: Read, Bash`) is not run at all
  const tools = field('tools')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tools.length !== 1 || tools[0] !== 'Read') return null;
  const prompt = (m[2] ?? '').trim();
  if (!prompt) return null;
  return { description: field('description'), prompt };
}

/** The user turn: the batch's file names, nothing else. */
export function describePrompt(batch: DescribeBatch): string {
  const names = batch.items.map((i) => i.file).join('\n');
  return [
    `Describe these ${batch.items.length} pictures in the current folder:`,
    names,
    `Answer with only the ${HANDOFF_FORMAT} JSON object.`,
  ].join('\n');
}

export function describeArgv(batch: DescribeBatch, agent: AgentDef): string[] {
  const agents = {
    [AGENT_NAME]: { description: agent.description, prompt: agent.prompt, tools: [...AGENT_TOOLS] },
  };
  return [
    '-p',
    describePrompt(batch),
    '--agents',
    JSON.stringify(agents),
    '--agent',
    AGENT_NAME,
    '--tools',
    AGENT_TOOLS.join(','),
    '--allowedTools',
    AGENT_TOOLS.join(','),
    '--permission-mode',
    'dontAsk',
    '--restricted',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--output-format',
    'json',
  ];
}

export function describeEnv(
  bin: string,
  cwd: string,
  source: Record<string, string | undefined> = process.env
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of ENV_ALLOW) {
    const v = source[k];
    if (typeof v === 'string' && v) env[k] = v;
  }
  // the binary's own folder first: an npm-installed `claude` is a `#!/usr/bin/env node` script beside its node
  env.PATH = [path.dirname(bin), ...(process.platform === 'win32' ? [] : POSIX_PATH)].join(
    path.delimiter
  );
  env.PWD = cwd;
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  return env;
}

export interface SpawnSpec {
  cmd: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}
export type SpawnRun = (spec: SpawnSpec) => Promise<{ code: number; stdout: string }>;

/** Bun.spawn with a hard timeout and a capped stdout. */
export const bunSpawn: SpawnRun = async (spec) => {
  const child = Bun.spawn({
    cmd: spec.cmd,
    cwd: spec.cwd,
    env: spec.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, spec.timeoutMs);
  try {
    const reader = child.stdout.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > STDOUT_MAX) {
        child.kill('SIGKILL');
        throw new Error('describe: answer too large');
      }
      chunks.push(value);
    }
    const code = await child.exited;
    if (timedOut) throw new Error('describe: timed out');
    return { code, stdout: Buffer.concat(chunks).toString('utf8') };
  } finally {
    clearTimeout(timer);
  }
};

/** A `{ usedUpUntil }` throw (batch.ts pauses until then) when claude says the account is used up. */
function usedUp(text: string, now: number): { usedUpUntil: number } | null {
  if (!/limit/i.test(text)) return null;
  // Claude Code's "…usage limit reached|<epoch seconds>"; otherwise wait an hour rather than burn the daily cap
  const epoch = Number(text.match(/\|(\d{10})\b/)?.[1]);
  return {
    usedUpUntil: Number.isFinite(epoch) && epoch * 1000 > now ? epoch * 1000 : now + 3_600_000,
  };
}

/** The agent's answer out of `--output-format json`: the parsed hand-off when it is JSON, else its raw text. */
export function parseAnswer(stdout: string, now = Date.now()): unknown {
  let out: Record<string, unknown>;
  try {
    out = JSON.parse(stdout);
  } catch {
    throw new Error('describe: claude printed no result');
  }
  const result = typeof out?.result === 'string' ? out.result : '';
  if (out?.is_error === true || out?.subtype !== 'success') {
    const u = usedUp(result, now);
    if (u) throw u;
    throw new Error('describe: claude failed');
  }
  const body = result
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  let answer: unknown = body;
  if (start !== -1 && end > start) {
    try {
      answer = JSON.parse(body.slice(start, end + 1));
    } catch {
      answer = body;
    }
  }
  // the model id comes from claude's own report, not from what the agent says about itself
  const usage = out.modelUsage;
  const model =
    usage && typeof usage === 'object' && !Array.isArray(usage) ? Object.keys(usage)[0] : '';
  if (model && answer && typeof answer === 'object' && !Array.isArray(answer))
    return { ...(answer as Record<string, unknown>), model };
  return answer;
}

export interface ClaudeDescriberOptions {
  /** the `claude` to run; default: resolveClaudePath() at every spawn */
  bin?: () => string | null;
  /** where agents/asset-describer.md is; default: the bundled design plugin */
  pluginDir?: string | null;
  timeoutMs?: number;
  spawn?: SpawnRun;
  env?: Record<string, string | undefined>;
  now?: () => number;
}

/** The describer that runs the asset-describer agent, or null when there is no `claude` or no agent file. */
export function claudeDescriber(o: ClaudeDescriberOptions = {}): Describer | null {
  const bin = o.bin ?? resolveClaudePath;
  const agent = readAgentDef(o.pluginDir === undefined ? DESIGN_PLUGIN_DIR : o.pluginDir);
  if (!agent || !bin()) return null;
  const run = o.spawn ?? bunSpawn;
  return async (batch) => {
    // re-resolved per spawn: the pinned override is re-hashed here (acp/probe.ts), never trusted from a cache
    const exe = bin();
    if (!exe || !existsSync(exe)) throw new Error('describe: claude is gone');
    const { stdout } = await run({
      cmd: [exe, ...describeArgv(batch, agent)],
      cwd: batch.dir,
      env: describeEnv(exe, batch.dir, o.env ?? process.env),
      timeoutMs: o.timeoutMs ?? DESCRIBE_TIMEOUT_MS,
    });
    return parseAnswer(stdout, (o.now ?? Date.now)());
  };
}

let cached: { at: number; d: Describer | null } | null = null;
/** The studio's real describer, its availability remembered for 30 s (status() asks on every read). */
export function realDescriber(now = Date.now()): Describer | null {
  if (cached && now - cached.at < AVAILABLE_TTL_MS) return cached.d;
  cached = { at: now, d: claudeDescriber() };
  return cached.d;
}
