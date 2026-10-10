#!/usr/bin/env bun
// agent-evals/harness/verbs.mjs — eval stand-ins for v2 `maude design` verbs that don't exist yet
// (V2-1.11 §5.3), so the eval can hold the model to the v2 contract today:
//   check <file…> [--json]          prototype fast tier (lib/check.mjs) against the run's base / HEAD
//   trash move <canvas> | list      moves the canvas + siblings to .design/_trash/<id>/ (restorable)
//   runs list [--json]              V2-1.15 GET /_api/ai/runs shape, from _state/eval-runs.json
//   shot-log <exit> <screenshot args…>  (internal) record a screenshot for the Stop gate
// Phase 8 re-runs the eval against the real verbs; this file then goes away.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { checkFile, formatFindings, primeRegistry } from '../lib/check.mjs';
import { scanCanvas } from '../lib/tsx.mjs';
import { appendJsonl, encPath, findDesignRoot, liveState, readJson, slugOf } from './common.mjs';

const [verb, ...args] = process.argv.slice(2);
const ctx = findDesignRoot(process.cwd());
if (!ctx) {
  console.error('maude design: no .design/config.json above this folder');
  process.exit(2);
}
const { repo, designRoot } = ctx;
const json = args.includes('--json');
const pos = args.filter((a) => !a.startsWith('--'));

function relDesign(p) {
  const abs = resolve(
    process.cwd(),
    p.startsWith('.design/') || p.startsWith('/') ? p : join('.design', p)
  );
  const alt = resolve(process.cwd(), p);
  const use = existsSync(abs) ? abs : alt;
  return { abs: use, rel: relative(designRoot, use).split('\\').join('/') };
}

function headContent(rel) {
  try {
    return execFileSync('git', ['show', `HEAD:.design/${rel}`], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function runBase(rel) {
  const runs = join(designRoot, '_runs');
  for (const d of existsSync(runs) ? readdirSync(runs) : []) {
    const b = readJson(join(runs, d, 'base', `${encPath(rel)}.json`), null);
    if (b) return b.content;
  }
  return undefined;
}

async function check() {
  if (!pos.length) {
    console.error('usage: maude design check <file…> [--json]');
    process.exit(2);
  }
  await primeRegistry();
  let bad = 0;
  const results = [];
  for (const p of pos) {
    const { abs, rel } = relDesign(p);
    const base = runBase(rel);
    const r = checkFile(abs, { against: base === undefined ? headContent(rel) : base });
    results.push({ file: rel, ...r });
    if (!r.ok) bad++;
    if (!json)
      console.log(
        r.ok
          ? `✓ ${rel} (${r.kind})${r.infos.length ? ` — ${r.infos.map((i) => i.what).join('; ')}` : ''}`
          : formatFindings(rel, r)
      );
  }
  if (json) console.log(JSON.stringify(results, null, 2));
  process.exit(bad ? 1 : 0);
}

function trash() {
  const sub = pos[0];
  if (sub === 'list') {
    const idx = join(designRoot, '_trash', 'index.jsonl');
    const rows = existsSync(idx)
      ? readFileSync(idx, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : [];
    console.log(
      json
        ? JSON.stringify(rows, null, 2)
        : rows.map((r) => `${r.id}  ${r.canvas}  ${new Date(r.at).toISOString()}`).join('\n') ||
            'The trash is empty.'
    );
    return;
  }
  if (sub !== 'move' || !pos[1]) {
    console.error('usage: maude design trash move "<canvas path>" | trash list');
    process.exit(2);
  }
  const target = pos[1];
  if (target.includes('#')) {
    console.error(
      'Remove one artboard by deleting its <DCArtboard> block with Edit — Maude parks it in the trash.'
    );
    process.exit(2);
  }
  const { abs, rel } = relDesign(target);
  if (!/\.(tsx|jsx)$/.test(rel) || !existsSync(abs)) {
    console.error(`No canvas at ${rel}.`);
    process.exit(2);
  }
  const id = `t_${Date.now().toString(36)}`;
  const stem = rel.replace(/\.(tsx|jsx)$/, '');
  const moved = [];
  for (const f of [
    rel,
    `${stem}.css`,
    `${stem}.meta.json`,
    `${stem}.registry.json`,
    `${slugOf(rel)}.annotations.json`,
  ]) {
    const src = join(designRoot, f);
    if (!existsSync(src)) continue;
    const dst = join(designRoot, '_trash', id, f);
    mkdirSync(dirname(dst), { recursive: true });
    renameSync(src, dst);
    moved.push(f);
  }
  appendJsonl(join(designRoot, '_trash', 'index.jsonl'), {
    id,
    canvas: rel,
    files: moved,
    at: Date.now(),
    by: 'ai',
  });
  console.log(
    `Moved ${rel} to the trash (${moved.length} file${moved.length === 1 ? '' : 's'}). Restore: maude design trash restore ${id}`
  );
}

function runs() {
  if (pos[0] !== 'list') {
    console.error('usage: maude design runs list [--canvas <c>] [--json]');
    process.exit(2);
  }
  const s = liveState(designRoot);
  const view = { others: s.others ?? [], mine: s.mine ?? [], holds: s.holds ?? [] };
  if (json) {
    console.log(JSON.stringify(view, null, 2));
    return;
  }
  const lines = [];
  for (const r of view.others)
    lines.push(
      `${r.actor}'s AI — ${r.state} — "${r.label}" — holds ${r.artboards.map((a) => `${a.canvas} › ${a.artboard}`).join(', ') || 'nothing'} (view only)`
    );
  for (const r of view.mine)
    lines.push(
      `Your ask "${r.label}" — ${r.state}${r.waitingFor?.length ? ` for ${r.waitingFor.map((a) => `${a.canvas} › ${a.artboard} (#${a.position})`).join(', ')}` : ''} — starts by itself`
    );
  for (const h of view.holds)
    lines.push(`${h.actor} is editing ${h.canvas} › ${h.artboard} › ${h.element}`);
  console.log(
    lines.join('\n') || 'No AI is working on this project, and nobody is holding anything.'
  );
}

function shotLog() {
  const code = Number(args[0]);
  if (code !== 0) return;
  const a = args.slice(1);
  const val = (flag) => {
    const i = a.indexOf(flag);
    return i >= 0 ? a[i + 1] : undefined;
  };
  let canvas = val('--canvas');
  if (canvas === undefined) canvas = readJson(join(designRoot, '_active.json'), {})?.active;
  if (!canvas) return;
  canvas = canvas.replace(/^\.design\//, '');
  const screen = val('--screen');
  const all = a.includes('--all-screens') || a.includes('--full');
  let artboard = screen ?? null;
  if (!artboard && val('--element')) artboard = null;
  // A canvas with one artboard: any capture of it counts for that artboard.
  if (!artboard && !all) {
    try {
      const s = scanCanvas(
        join(designRoot, canvas),
        readFileSync(join(designRoot, canvas), 'utf8')
      );
      if (s.artboards.length === 1) artboard = s.artboards[0].id;
    } catch {}
  }
  appendJsonl(join(designRoot, '_runs', 'shots.jsonl'), { at: Date.now(), canvas, artboard, all });
}

const run = { check, trash, runs, 'shot-log': shotLog }[verb];
if (!run) {
  console.error(`unknown eval verb ${verb}`);
  process.exit(2);
}
await run();
