// agent-evals/lib/runstate.mjs — what the SHIPPED hooks and run registry left behind, read for grading.
//
// The released design plugin keeps no decision log. Its evidence is (a) the run folder it writes per
// Claude Code session, `<designRoot>/_runs/<session>/` (cli/lib/design-hook.mjs header: touched.json,
// stop-last*.json, shots.jsonl, base/<sha(path)>, agents.json), (b) what the model saw — a denied tool
// call comes back as an error tool_result that starts with the reason code — and (c) the live
// registry the trial's studio answers (`maude design runs list --json`, lib/trial.mjs). Pure fs +
// text: no studio, no model.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The reason codes the design hook and the studio's edit/check put first in a refusal. */
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
const DENY_RE = new RegExp(`(?:^|\\s)(${DENY_CODES.join('|')}):`);

const readJson = (p, dflt = null) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return dflt;
  }
};

/**
 * → { sessions: [{ name, touched, stopBlocks, shots, bases, agents, dir }] } over every run folder.
 *
 * The released Stop hook DELETES `_runs/<session>/` when the run ends cleanly (design-hook.mjs `stop`:
 * `rmSync(ctx.run)`), so after a finished trial the project holds nothing. The harness therefore archives the
 * folder while the run is alive (`lib/trial.mjs` `snapshotRuns`, into `<trial>/runlog/<session>/`); this reads
 * the archive and the project's own folders (the project's wins: a crashed run leaves its folder behind).
 */
export function readRunState(project, runlog = null) {
  const dirs = new Map();
  for (const root of [runlog, join(project, '.design', '_runs')]) {
    if (!root || !existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const p = join(root, name);
      if (name !== 'sessions' && statSync(p).isDirectory()) dirs.set(name, p);
    }
  }
  const out = { sessions: [] };
  for (const [name, p] of dirs) {
    const stop = readdirSync(p).filter((f) => /^stop-last(\..+)?\.json$/.test(f));
    let shots = [];
    try {
      shots = readFileSync(join(p, 'shots.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } catch {}
    out.sessions.push({
      name,
      touched: readJson(join(p, 'touched.json'), {}),
      stopBlocks: stop.length,
      shots,
      bases: existsSync(join(p, 'base')) ? readdirSync(join(p, 'base')) : [],
      agents: readJson(join(p, 'agents.json'), {}),
      dir: p,
    });
  }
  return out;
}

/** The run base of `rel` (designRoot-relative): the bytes before the run first touched it, or undefined. */
export function runBase(project, rel, runlog = null) {
  const key = createHash('sha256').update(rel, 'utf8').digest('hex').slice(0, 16);
  for (const s of readRunState(project, runlog).sessions) {
    const p = join(s.dir, 'base', key);
    if (existsSync(p)) return readFileSync(p, 'utf8');
    if (existsSync(`${p}.new`)) return null; // the file did not exist before the run
  }
  return undefined;
}

/**
 * The hook decisions of one trial, as a flat list the report counts:
 *   { event: 'pre-edit' | 'pre-bash' | 'stop' | 'post-edit', decision: 'deny' | 'block', code?, tool?, agent? }
 * Denies come from the error tool_results the model saw (the reason's first word is the code), blocks from
 * the run folder (`stop-last*.json` = the Stop gate held the run once) and from hook events in the
 * transcript (`--include-hook-events`: a hook output carrying `decision: "block"`).
 */
export function hookDecisions(tr, runState) {
  const out = [];
  const byId = new Map(tr.toolUses.map((t) => [t.id, t]));
  for (const r of tr.toolResults ?? []) {
    if (!r.isError) continue;
    const m = DENY_RE.exec(r.text);
    if (!m) continue;
    const t = byId.get(r.id);
    out.push({
      event: t?.name === 'Bash' ? 'pre-bash' : 'pre-edit',
      decision: 'deny',
      code: m[1],
      tool: t?.name ?? null,
      agent: t?.parent ? 'sub-agent' : null,
    });
  }
  for (const ev of tr.hookEvents ?? []) {
    const raw = typeof ev.stdout === 'string' ? ev.stdout : (ev.output ?? '');
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {}
    const event = String(ev.hook_event ?? ev.hook_event_name ?? 'hook').toLowerCase();
    // a Stop block is counted once, from the run folder below
    if (body?.decision === 'block' && !/^(subagent)?stop$/.test(event))
      out.push({ event, decision: 'block', code: String(body.reason ?? '').slice(0, 60) });
  }
  for (const s of runState.sessions)
    for (let i = 0; i < s.stopBlocks; i++)
      out.push({ event: 'stop', decision: 'block', code: 'run-folder' });
  return out;
}

/** Is `artboard` of `canvas` still held by a live run, per `maude design runs list --json`? */
export function holdInForce(view, canvas, artboard) {
  const runs = [...(view?.others ?? []), ...(view?.mine ?? []), ...(view?.runs ?? [])];
  return runs.some(
    (r) =>
      r.state !== 'waiting' &&
      (r.artboards ?? []).some((a) => a.artboard === artboard && String(a.canvas).endsWith(canvas))
  );
}
