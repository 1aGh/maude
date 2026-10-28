// agent-journeys/lanes/common.mjs — what both live lanes share: the scratch project, the studio,
// the stand-in shell, the harness-side setup (another AI holding an artboard), and turning
// machine events into the trial logs graders read (denies.jsonl, tools.jsonl, ui-open.jsonl).
//
// Every studio this harness boots runs with NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 and its own
// MAUDE_MACHINE_FILE (a temp file), on an UNLINKED scratch copy of an agent-evals fixture — never
// this repo's `.design`, never ~/.config/maude, never a hub.

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { locateStudio, postStudio } from '../../../../../cli/lib/studio-locate.mjs';
import { buildFixture, REPO } from '../../agent-evals/lib/fixtures.mjs';
import { plantAll, plantContext } from '../plant.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const JOURNEYS_DIR = join(HERE, '..');
export const CLI = join(REPO, 'cli', 'bin', 'maude.mjs');
export { REPO };

/** Setup ops the harness runs against a live studio (not planted on disk). */
export const LIVE_SETUP_OPS = new Set(['hold']);

/** Reason codes the design hook and the studio's edit/check put first in a refusal. */
export const DENY_CODES = [
  'artboard-busy',
  'soft-locked',
  'out-of-scope',
  'lease-lost',
  'read-only',
  'whole-file-rewrite',
  'use-trash',
  'use-verb',
  'not-a-writer',
  'human-only',
  'out-of-project',
];
const DENY_RE = new RegExp(`\\b(${DENY_CODES.join('|')}):`);

/** The env every process the harness starts gets: no browser pop-up, no autobuild, a throwaway machine file. */
export function harnessEnv(base = process.env, machineFile = null) {
  return {
    ...base,
    NO_OPEN: '1',
    MAUDE_NO_AUTOBUILD: '1',
    MAUDE_FORCE_SOURCE: '1',
    // the harness's studios stay out of the person's 4399–4408 (port.ts); 48399–48408 is clear of e2e's 47399+
    MAUDE_PORT_BASE: base.MAUDE_PORT_BASE ?? '48399',
    MAUDE_MACHINE_FILE:
      machineFile ??
      base.MAUDE_MACHINE_FILE ??
      join(mkdtempSync(join(tmpdir(), 'maude-journey-machine-')), 'machine.json'),
  };
}

/**
 * Build the scratch project for one trial: the fixture (built once into `cacheDir`, git baseline,
 * then APFS-cloned — `cp -c` costs no disk), unlinked, plus the journey's on-disk setup. Returns
 * { project, ctx } — `ctx` is the plant context (the --dry recipe continues on it).
 */
export function prepareProject(journey, trialDir, { cacheDir }) {
  const cached = join(cacheDir, journey.fixture, 'project');
  if (!existsSync(join(cached, '.git')) && !buildFixture(journey.fixture, cached))
    throw new Error(`fixture ${journey.fixture} is not available on this Mac`);
  const project = join(trialDir, 'project');
  rmSync(project, { recursive: true, force: true });
  mkdirSync(trialDir, { recursive: true });
  if (spawnSync('cp', ['-cR', cached, project]).status !== 0)
    spawnSync('cp', ['-R', cached, project]);
  // unlinked: no hub link, no sync state, no store a previous run left (memory: unlink cloned projects)
  for (const f of ['_sync.json', 'linkedHub.json'])
    rmSync(join(project, '.design', f), { force: true });
  rmSync(join(project, '.design', '_state'), { recursive: true, force: true });
  const cfg = join(project, '.design', 'config.json');
  try {
    const c = JSON.parse(readFileSync(cfg, 'utf8'));
    if (c.linkedHub !== undefined) {
      delete c.linkedHub;
      writeFileSync(cfg, `${JSON.stringify(c, null, 2)}\n`);
    }
  } catch {}
  const ctx = plantContext(project, trialDir);
  plantAll(
    ctx,
    (journey.setup ?? []).filter((op) => !LIVE_SETUP_OPS.has(op.op))
  );
  return { project, ctx };
}

export function studioUp(project, env) {
  // A loaded machine (the shared test lane, load average 30-60) takes minutes to boot a studio:
  // 30 s read as a harness failure although the studio came up two minutes later.
  const secs = Number(process.env.MAUDE_JOURNEYS_STUDIO_TIMEOUT_S) || 300;
  const r = spawnSync(
    'node',
    [CLI, 'design', 'server-up', '--root', project, '--timeout', String(secs)],
    {
      env: { ...env, CLAUDE_PROJECT_DIR: project },
      encoding: 'utf8',
      timeout: (secs + 30) * 1000,
    }
  );
  const port = String(r.stdout ?? '')
    .trim()
    .split('\n')
    .pop();
  if (!/^\d+$/.test(port))
    throw new Error(`studio did not start: ${String(r.stderr ?? '').slice(-400)}`);
  return Number(port);
}

export function studioDown(project) {
  const p = join(project, '.design', '_server.json');
  if (!existsSync(p)) {
    // The studio never reported ready (a start timeout): do not leave it booting behind the run.
    spawnSync('pkill', ['-f', `server.ts --root ${project}`]);
    return;
  }
  try {
    const { pid } = JSON.parse(readFileSync(p, 'utf8'));
    if (pid) process.kill(pid, 'SIGTERM');
  } catch {}
}

/**
 * The stand-in Maude window: an inspector socket on the studio (a desktop-shaped shell, no
 * Origin), so `maude design open` has a shell to reach (exit 0, not 3). Every `ui-open` frame it
 * receives is logged — the UI ≡ verb half of the Present journey. Returns { close }.
 */
export async function shellTap(port, trialDir) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/_ws`);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('shell tap: the studio socket refused'));
  });
  ws.onmessage = (ev) => {
    try {
      const m = JSON.parse(String(ev.data));
      if (m?.type === 'ui-open')
        appendFileSync(
          join(trialDir, 'ui-open.jsonl'),
          `${JSON.stringify({ open: m.open, at: Date.now() })}\n`
        );
    } catch {}
  };
  return { close: () => ws.close() };
}

/**
 * `hold`: another Claude Code session on this Mac (not the agent under test) starts a run and
 * claims `artboard` through the same two routes the design hook calls (run/begin + edit/check
 * with a replayable edit that reaches only that artboard). The edit is never written to disk.
 */
export async function holdArtboard(project, op) {
  const studio = await locateStudio(project, { timeoutMs: 1500 });
  if (!studio) throw new Error('hold: no studio');
  const session = 'journeyholder';
  await postStudio(studio, '/_api/agent/run/begin', { session, actor: 'claude-code' });
  const r = await postStudio(studio, '/_api/agent/edit/check', {
    session,
    toolUseId: 'journeyhold1',
    tool: 'Edit',
    path: op.canvas,
    edit: { old: op.old, new: op.new },
  });
  if (!r || r.status !== 200 || r.body?.decision === 'deny')
    throw new Error(`hold: claim refused ${JSON.stringify(r?.body ?? null)}`);
  return { session, end: () => postStudio(studio, '/_api/agent/run/end', { session }) };
}

export async function runLiveSetup(project, journey) {
  const held = [];
  for (const op of journey.setup ?? [])
    if (op.op === 'hold') held.push(await holdArtboard(project, op));
  return held;
}

const append = (trialDir, name, v) =>
  appendFileSync(join(trialDir, name), `${JSON.stringify(v)}\n`);

/** One tool call the agent made. */
export function logTool(trialDir, lane, name, input) {
  append(trialDir, 'tools.jsonl', { lane, name, input: input ?? {} });
}

/** A refusal text from a tool result → a deny line, when it carries a known reason code. */
export function logDenyIfAny(trialDir, lane, tool, text) {
  const m = DENY_RE.exec(String(text ?? ''));
  if (!m) return false;
  append(trialDir, 'denies.jsonl', { lane, tool, code: m[1], reason: String(text).slice(0, 400) });
  return true;
}

export function writeJson(path, v) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(v, null, 2)}\n`);
}
