#!/usr/bin/env bun
// agent-evals/harness/hook.mjs — PROTOTYPE of `maude design hook <event>` (V2-1.11 §5.4), the
// edit-safety harness V2-1.18 measures. Deny-only and fail-open: it never emits `ask` or `allow`;
// any internal error exits 0 silently (the guard is lost for that call, the write is not blocked).
//
//   bun hook.mjs prompt | pre-edit | pre-bash | post-edit | post-bash | stop | subagent-start | subagent-stop
//
// Reads the Claude Code hook JSON on stdin. State lives in <designRoot>/_runs/<run>/:
//   snap/<tool_use_id>.json  bytes before each edit (rollback source)
//   base/<path>.json         bytes before the run first touched the file (stop-tier `against`)
//   touched.json             files this run changed (+ last edit time)
//   hooklog.jsonl            every decision with its latency (graders read it)
//   agents.json              sub-agent starts (agent_id → type, at)
// The studio-dependent parts of V2-1.11 (run registry, leases, attribution routes) are stood in for
// by `<designRoot>/_state/eval-runs.json` — the shape of V2-1.15's GET /_api/ai/runs.

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { checkFile, formatFindings, primeRegistry } from '../lib/check.mjs';
import { attributeArtboards, scanCanvas } from '../lib/tsx.mjs';
import {
  appendJsonl,
  encPath,
  findDesignRoot,
  inside,
  isRuntime,
  liveState,
  readJson,
  runDir,
  runKey,
  slugOf,
  writeJson,
} from './common.mjs';

const T0 = performance.now();
const EVENT = process.argv[2];
// Sub-agent types that may write ONLY under _runs/ (their hand-off `owns`). Prototype list (S12 builds
// the real one from each agent's hand-off).
const RUNS_ONLY_AGENTS = /(^|:)(board-reader|artboard-drafter|ds-switcher)$/;
const LAZY_WRITE_LINES = 40; // V2-1.11 Q5

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}

function out(obj) {
  if (obj) process.stdout.write(JSON.stringify(obj));
}
function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

const ctx = findDesignRoot(input.cwd ?? process.cwd());
if (!ctx) process.exit(0);
const { designRoot } = ctx;
const RUN = runDir(designRoot, input.session_id);
const log = (rec) => {
  try {
    appendJsonl(join(RUN, 'hooklog.jsonl'), {
      at: Date.now(),
      event: EVENT,
      ms: +(performance.now() - T0).toFixed(1),
      agent: input.agent_type ?? null,
      agentId: input.agent_id ?? null,
      tool: input.tool_name ?? null,
      ...rec,
    });
  } catch {}
};

function relOf(p) {
  if (!p) return null;
  const abs = resolve(input.cwd ?? process.cwd(), p);
  if (!inside(designRoot, abs)) return null;
  return { abs, rel: relative(designRoot, abs).split('\\').join('/') };
}

function readOr(abs) {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function applyEdit(cur, ti) {
  if (input.tool_name === 'Write') return ti.content ?? '';
  if (cur == null) return null;
  if (input.tool_name === 'Edit') {
    if (typeof ti.old_string !== 'string' || !cur.includes(ti.old_string)) return null;
    return ti.replace_all
      ? cur.split(ti.old_string).join(ti.new_string ?? '')
      : cur.replace(ti.old_string, () => ti.new_string ?? '');
  }
  if (input.tool_name === 'MultiEdit' && Array.isArray(ti.edits)) {
    let s = cur;
    for (const e of ti.edits) {
      if (!s.includes(e.old_string)) return null;
      s = e.replace_all
        ? s.split(e.old_string).join(e.new_string)
        : s.replace(e.old_string, () => e.new_string);
    }
    return s;
  }
  return null;
}

/** Canvases whose module scope the file `rel` is (the canvas itself, or a CSS/TS file it imports). */
function canvasesReachedBy(rel) {
  if (/\.(tsx|jsx)$/.test(rel)) return [rel];
  const out = [];
  if (/\.(css|ts)$/.test(rel)) {
    const name = rel.split('/').pop();
    // Cheap import scan of the canvases that live next to the file (a shared stylesheet or kit).
    const dir = join(designRoot, rel.split('/').slice(0, -1).join('/'));
    for (const f of safeList(dir)) {
      if (!/\.(tsx|jsx)$/.test(f)) continue;
      const src = readOr(join(dir, f)) ?? '';
      if (src.includes(name.replace(/\.(ts)$/, '')))
        out.push(relative(designRoot, join(dir, f)).split('\\').join('/'));
    }
  }
  return out;
}
function safeList(d) {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
}

function busyFor(canvasRel) {
  const s = liveState(designRoot);
  const live = (s.others ?? []).filter((r) => r.state === 'running' || r.state === 'needs-you');
  const busy = [];
  for (const r of live)
    for (const a of r.artboards ?? [])
      if (a.canvas === canvasRel) busy.push({ artboard: a.artboard, who: r.actor, label: r.label });
  const holds = (s.holds ?? []).filter((h) => h.canvas === canvasRel);
  return { busy, holds };
}

async function preEdit() {
  const ti = input.tool_input ?? {};
  const t = relOf(ti.file_path ?? ti.notebook_path);
  if (!t) return;
  const { abs, rel } = t;
  const agent = input.agent_type ?? null;
  // 1. Sub-agent scope (V2-1.11 §5.4 "Subagents"): helpers write only their hand-off `owns` (under _runs/);
  //    no sub-agent writes a versioned file of the canvas.
  if (agent) {
    if (RUNS_ONLY_AGENTS.test(agent) && !rel.startsWith('_runs/')) {
      log({ path: rel, decision: 'deny', code: 'out-of-scope' });
      return deny(
        `out-of-scope: ${agent} writes only its hand-off files under .design/_runs/${runKey(input.session_id)}/ — the main agent applies changes to ${rel}.`
      );
    }
    if (!isRuntime(rel) && !/(^|:)(draw-agent|footage-director|reconstruct-agent)$/.test(agent)) {
      log({ path: rel, decision: 'deny', code: 'out-of-scope' });
      return deny(
        `out-of-scope: sub-agents never write ${rel}; return your result in the hand-off and let the main agent edit.`
      );
    }
  }
  if (isRuntime(rel)) {
    log({ path: rel, decision: 'none', kind: 'runtime' });
    return;
  }
  const cur = readOr(abs);
  // 2. Snapshot for rollback (no studio needed) + the run's base copy.
  if (input.tool_use_id)
    writeJson(join(RUN, 'snap', `${input.tool_use_id}.json`), {
      path: rel,
      existed: cur !== null,
      content: cur,
    });
  const baseP = join(RUN, 'base', `${encPath(rel)}.json`);
  if (!existsSync(baseP)) writeJson(baseP, { path: rel, existed: cur !== null, content: cur });
  // 3. Lazy whole-file rewrite guard.
  if (
    input.tool_name === 'Write' &&
    cur !== null &&
    /\.(tsx|jsx)$/.test(rel) &&
    cur.split('\n').length > LAZY_WRITE_LINES
  ) {
    log({ path: rel, decision: 'deny', code: 'whole-file-rewrite' });
    return deny(
      `whole-file-rewrite: ${rel} already exists (${cur.split('\n').length} lines). Use Edit on existing canvases — it keeps element ids and locked elements.`
    );
  }
  // 4. One AI per artboard (A4/V2-1.15) + people's holds (A10).
  const next = applyEdit(cur, ti);
  if (next === null) return; // the tool will fail on its own (old_string not found)
  for (const canvas of canvasesReachedBy(rel)) {
    const { busy, holds } = busyFor(canvas);
    if (!busy.length && !holds.length) continue;
    const canvasAbs = join(designRoot, canvas);
    let att;
    if (canvas === rel) att = attributeArtboards(abs, cur ?? '', next);
    else att = { scope: 'file', artboards: [], reason: 'shared-file' };
    for (const b of busy) {
      if (att.scope === 'file' || att.artboards.includes(b.artboard)) {
        const why =
          att.scope === 'file'
            ? ` (this change reaches every artboard of ${canvas}: ${att.reason})`
            : '';
        log({ path: rel, decision: 'deny', code: 'artboard-busy', artboard: b.artboard });
        return deny(
          `artboard-busy: ${b.artboard} is busy — ${b.who}'s AI is changing it ("${b.label}")${why}. ` +
            `Work on the other artboards without touching shared code they use; ${b.artboard} comes back to this chat when it is free. ` +
            `Or duplicate the ${b.artboard} DCArtboard beside it with a new id and edit the copy.`
        );
      }
    }
    if (canvas === rel && cur !== null) {
      const before = scanCanvas(canvasAbs, cur);
      const after = scanCanvas(canvasAbs, next);
      for (const h of holds) {
        const a = before.elements.find((e) => e.cdId === h.element);
        const b = after.elements.find((e) => e.cdId === h.element);
        if (a && (!b || a.print !== b.print)) {
          log({ path: rel, decision: 'deny', code: 'soft-locked', element: h.element });
          return deny(
            `soft-locked: ${h.actor} is editing "${a.text || h.element}" (${h.element}) in ${h.artboard}. Leave it until ${h.actor} moves on.`
          );
        }
      }
    }
  }
  log({ path: rel, decision: 'none' });
}

function preBash() {
  const cmd = String(input.tool_input?.command ?? '');
  if (!cmd.includes('.design') && !/\b(ui|system)\//.test(cmd)) return;
  const versioned =
    /(\.design\/)?[^\s'"]*(\.tsx|\.jsx|\.meta\.json|\.annotations\.json|\/system\/[^\s'"]*)/;
  const runtimeOnly = (s) =>
    (s.match(/\.design\/[^\s'"]+/g) ?? []).every((p) => /\.design\/_/.test(p));
  const maude = /^\s*maude\s+design\b/.test(cmd) && !/[;&|]/.test(cmd.replace(/\|\|/g, ''));
  if (maude) {
    const m = cmd.match(/maude\s+design\s+annotate\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
    if (m) {
      const canvas = (m[1] ?? m[2] ?? m[3]).replace(/^\.design\//, '');
      const board = `${slugOf(canvas)}.annotations.json`;
      const abs = join(designRoot, board);
      const baseP = join(RUN, 'base', `${encPath(board)}.json`);
      const cur = readOr(abs);
      if (!existsSync(baseP))
        writeJson(baseP, { path: board, existed: cur !== null, content: cur });
    }
    return;
  }
  let code = null;
  if (/(^|[\s;&|(])(rm|unlink|rmdir|trash)\s/.test(cmd) || /\bgit\s+rm\b/.test(cmd))
    code = 'use-trash';
  else if (/(^|[\s;&|(])mv\s/.test(cmd) || /\bgit\s+mv\b/.test(cmd)) code = 'use-verb';
  else if (
    /\bsed\s+(-[a-zA-Z]*i|--in-place)|\bperl\s+-[a-zA-Z]*i|\btee\b|>>?\s*['"]?[^\s'"&|;]*\.design\/|\b(cp|rsync|install|ditto)\b|\b(node|bun|python3?|ruby|deno)\s+(-e|-c|--eval)/.test(
      cmd
    )
  )
    code = 'not-a-writer';
  if (!code) return;
  if (runtimeOnly(cmd) && code !== 'use-trash') return;
  if (code === 'use-trash' && !versioned.test(cmd) && runtimeOnly(cmd)) return;
  log({ decision: 'deny', code, cmd: cmd.slice(0, 300) });
  const msg = {
    'use-trash':
      'use-trash: canvases and design files are never deleted with Bash. Move a canvas to the trash: `maude design trash move "<canvas path>"`; remove one artboard by deleting its DCArtboard block with Edit.',
    'use-verb':
      'use-verb: canvases are never moved with Bash — keep the path, or ask the person to move it in Canvases.',
    'not-a-writer':
      'not-a-writer: files in .design/ are written with Edit/Write only, so every change is checked. Edit the file instead.',
  }[code];
  return deny(msg);
}

async function postEdit() {
  const ti = input.tool_input ?? {};
  const t = relOf(ti.file_path ?? ti.notebook_path);
  if (!t) return;
  const { abs, rel } = t;
  if (isRuntime(rel)) {
    log({ path: rel, decision: 'none', kind: 'runtime' });
    return;
  }
  await primeRegistry();
  const snap = input.tool_use_id
    ? readJson(join(RUN, 'snap', `${input.tool_use_id}.json`), null)
    : null;
  const res = checkFile(abs, { against: snap?.content ?? null });
  if (!res.ok) {
    // Roll back: the file still holds what the tool just wrote (the hook runs right after the tool).
    if (snap) {
      try {
        if (snap.existed) writeFileSync(abs, snap.content);
        else unlinkSync(abs);
      } catch {}
    }
    log({
      path: rel,
      decision: 'block',
      codes: res.errors.map((e) => e.code),
      checkMs: res.ms,
      restored: !!snap,
    });
    return {
      decision: 'block',
      reason: `${formatFindings(rel, res)}\nThe file was restored to before this edit — make the change again without these problems.`,
    };
  }
  const touched = readJson(join(RUN, 'touched.json'), {});
  touched[rel] = { at: Date.now(), by: input.agent_type ?? 'main' };
  writeJson(join(RUN, 'touched.json'), touched);
  log({ path: rel, decision: 'none', checkMs: res.ms, infos: res.infos.length });
}

function postBash() {
  const cmd = String(input.tool_input?.command ?? '');
  const m = cmd.match(/^\s*maude\s+design\s+annotate\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (!m || /--dry-run/.test(cmd)) return;
  const canvas = (m[1] ?? m[2] ?? m[3]).replace(/^\.design\//, '');
  const board = `${slugOf(canvas)}.annotations.json`;
  const touched = readJson(join(RUN, 'touched.json'), {});
  touched[board] = { at: Date.now(), by: input.agent_type ?? 'main', via: 'bash' };
  writeJson(join(RUN, 'touched.json'), touched);
  log({ path: board, decision: 'none', via: 'bash' });
}

function shotsSince(canvas, since) {
  const p = join(designRoot, '_runs', 'shots.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((s) => s && s.canvas === canvas && s.at >= since);
}

async function stop() {
  const touched = readJson(join(RUN, 'touched.json'), {});
  const files = Object.keys(touched);
  if (!files.length) {
    log({ decision: 'none', files: 0 });
    return;
  }
  await primeRegistry();
  const problems = [];
  const missing = [];
  for (const rel of files) {
    const abs = join(designRoot, rel);
    const base = readJson(join(RUN, 'base', `${encPath(rel)}.json`), null);
    const res = checkFile(abs, { against: base?.content ?? null });
    if (!res.ok) problems.push(formatFindings(rel, res));
    if (/\.(tsx|jsx)$/.test(rel) && existsSync(abs)) {
      const now = readFileSync(abs, 'utf8');
      const att = attributeArtboards(abs, base?.content ?? '', now);
      const scan = scanCanvas(abs, now);
      const want =
        att.scope === 'file' || !base?.content
          ? scan.artboards.map((a) => a.id)
          : att.artboards.filter((id) => scan.artboards.some((a) => a.id === id));
      const shots = shotsSince(rel, touched[rel].at);
      const all = shots.some((s) => s.all);
      for (const id of want)
        if (!all && !shots.some((s) => s.artboard === id)) missing.push(`${rel} › ${id}`);
    }
  }
  if (!problems.length && !missing.length) {
    log({ decision: 'none', files: files.length, outcome: 'clean' });
    return;
  }
  const sig = JSON.stringify({ problems, missing });
  const last = readJson(join(RUN, 'stop-last.json'), null);
  if (input.stop_hook_active && last?.sig === sig) {
    log({
      decision: 'none',
      outcome: 'ended-with-warnings',
      problems: problems.length,
      missing: missing.length,
    });
    return;
  }
  writeJson(join(RUN, 'stop-last.json'), { sig, at: Date.now() });
  log({ decision: 'block', problems: problems.length, missing: missing.length });
  const parts = [];
  if (problems.length) parts.push(`These files don't pass the check:\n${problems.join('\n')}`);
  if (missing.length)
    parts.push(
      `Screenshot each artboard you changed and look at it before you finish (\`maude design screenshot --canvas "<path>" --screen <id> --out <png>\`). Missing: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ` (+${missing.length - 20})` : ''}`
    );
  return { decision: 'block', reason: parts.join('\n\n') };
}

function subagentStart() {
  const agents = readJson(join(RUN, 'agents.json'), {});
  agents[input.agent_id ?? `?${Date.now()}`] = { type: input.agent_type ?? null, at: Date.now() };
  writeJson(join(RUN, 'agents.json'), agents);
  log({ decision: 'none' });
}

async function subagentStop() {
  const type = input.agent_type ?? '';
  if (!RUNS_ONLY_AGENTS.test(type)) {
    log({ decision: 'none' });
    return;
  }
  const agents = readJson(join(RUN, 'agents.json'), {});
  const since = agents[input.agent_id]?.at ?? 0;
  const outs = [];
  const walk = (d) => {
    for (const f of safeList(d)) {
      const p = join(d, f);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (f.endsWith('.out.json') && st.mtimeMs >= since - 1000) outs.push(p);
    }
  };
  walk(RUN);
  const { validateHandoff } = await import('./handoff.mjs');
  const mine = outs
    .map((p) => ({ p, v: readJson(p, null) }))
    .filter((x) => x.v && String(x.v.agent ?? '').replace(/^.*:/, '') === type.replace(/^.*:/, ''));
  if (!mine.length) {
    if (input.stop_hook_active) {
      log({ decision: 'none', outcome: 'no-handoff' });
      return;
    }
    log({ decision: 'block', code: 'handoff-missing' });
    return {
      decision: 'block',
      reason: `Write your hand-off result (contract maude.agent-handoff/1, role "out") to the \`output\` path from your hand-off before you finish.`,
    };
  }
  const bad = mine
    .map((x) => ({ p: x.p, errs: validateHandoff(x.v) }))
    .filter((x) => x.errs.length);
  if (bad.length && !input.stop_hook_active) {
    log({ decision: 'block', code: 'handoff-invalid' });
    return {
      decision: 'block',
      reason: `Your hand-off file doesn't match maude.agent-handoff/1:\n${bad.map((b) => `${relative(designRoot, b.p)}: ${b.errs.slice(0, 5).join('; ')}`).join('\n')}`,
    };
  }
  log({ decision: 'none', outcome: bad.length ? 'handoff-invalid-accepted' : 'handoff-ok' });
}

function prompt() {
  writeJson(join(RUN, 'run.json'), {
    run: runKey(input.session_id),
    session: input.session_id,
    at: Date.now(),
  });
  log({ decision: 'none' });
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `Maude run folder for this conversation: .design/_runs/${runKey(input.session_id)}/ (run id ${runKey(input.session_id)}). Hand-offs, drafts and proposals go there.`,
    },
  };
}

try {
  const handlers = {
    prompt,
    'pre-edit': preEdit,
    'pre-bash': preBash,
    'post-edit': postEdit,
    'post-bash': postBash,
    stop,
    'subagent-start': subagentStart,
    'subagent-stop': subagentStop,
  };
  const h = handlers[EVENT];
  if (!h) process.exit(0);
  const r = await h();
  out(r);
} catch (e) {
  try {
    log({ decision: 'error', error: String(e?.stack ?? e).slice(0, 500) });
  } catch {}
}
process.exit(0);
