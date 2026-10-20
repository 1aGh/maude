// agent-journeys/plant.mjs — write journey state straight to disk, with Maude's own writers.
//
// Two users:
//   - `setup` ops of a journey (both the live lanes and --dry): seed comments a person left, before
//     the studio boots (local comments are per-Mac files, `_comments/<slug>.json`).
//   - the --dry grader self-test: the state a perfect run would leave (`dry.good`), and each
//     grader's planted fault on top of it (`dry.faults`). No model, no studio, no network.
//
// Writers are the real ones wherever a format has one: comments through `applyCommentOp`
// (comments/ops.ts), annotations through `AiBatch` + `serializeBoard` (annotations/), the project
// store through the hub's DDL (`createStoreCore().migrate()`), rows shaped like the kernel's
// (`@manifest create|move|delete`, `kind` per V2-1.9). What --dry does NOT prove: that the live
// kernel writes exactly these rows for what an agent does — the live lanes prove that.

import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { createStoreCore } from '../../../hub/src/project-transactions/store-core.mjs';
import { AiBatch } from '../../annotations/ai-write.ts';
import { parseBoard, serializeBoard } from '../../annotations/schema.ts';
import { canvasSlugFromRel } from '../../canvas-slug.ts';
import { applyCommentOp } from '../../comments/ops.ts';
import { DESIGN, STORE_REL, sqlAdapter } from './graders.mjs';

const write = (abs, text) => {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
};
const readOr = (abs) => {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
};

/** Plant context: the project, the trial dir for logs, the store's path → entry map. */
export function plantContext(project, trialDir) {
  return { project, designRoot: join(project, DESIGN), trialDir, entries: new Map(), rev: 0 };
}

function withStore(ctx, fn) {
  const file = join(ctx.designRoot, STORE_REL);
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file, { create: true, readwrite: true });
  try {
    const sql = sqlAdapter(db);
    createStoreCore(sql).migrate();
    return fn(sql);
  } finally {
    db.close();
  }
}

/** One action row + its effects; keeps `docs` consistent the way the kernel's manifest ops do. */
function plantAction(ctx, op) {
  withStore(ctx, (sql) => {
    const rev = Number(sql.exec('SELECT COALESCE(MAX(rev), 0) AS r FROM actions')[0].r) + 1;
    const actionId = op.actionId ?? `a_${randomUUID()}`;
    const origin = {
      deviceId: 'journey-dry',
      ...(op.run ? { runId: op.run, chatId: op.chat ?? null } : {}),
      ...(op.origin ?? {}),
    };
    sql.exec(
      `INSERT INTO actions (rev, tx, actor, action_id, kind, label, origin, committed_at, undoes, run_id, chat_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      rev,
      `tx_${rev}`,
      op.actor ?? 'local',
      actionId,
      op.kind,
      op.label ?? null,
      JSON.stringify(origin),
      Date.now() + rev,
      op.undoes ? JSON.stringify(op.undoes) : null,
      op.run ?? null,
      op.chat ?? null
    );
    for (const e of op.effects ?? []) {
      const path = e.path ?? e.to ?? e.from;
      let entry = ctx.entries.get(e.from ?? path);
      if (!entry) {
        entry = `ent_${randomUUID().slice(0, 8)}`;
        ctx.entries.set(path, entry);
      }
      const doc = `doc_${entry}`;
      const repo = (p) => (p ? `${DESIGN}/${p}` : null);
      let before = null;
      let after = null;
      if (e.lane === '@manifest' && e.op === 'create') {
        after = repo(path);
        sql.exec(
          `INSERT INTO docs (doc, entry, generation, path, retired, created_rev, updated_rev) VALUES (?, ?, 1, ?, 0, ?, ?)
           ON CONFLICT(doc) DO UPDATE SET retired = 0, path = excluded.path, updated_rev = excluded.updated_rev`,
          doc,
          entry,
          after,
          rev,
          rev
        );
      } else if (e.lane === '@manifest' && e.op === 'move') {
        before = repo(e.from);
        after = repo(e.to);
        ctx.entries.set(e.to, entry);
        sql.exec(`UPDATE docs SET path = ?, updated_rev = ? WHERE doc = ?`, after, rev, doc);
      } else if (e.lane === '@manifest' && e.op === 'delete') {
        before = repo(path);
        sql.exec(`UPDATE docs SET retired = 1, updated_rev = ? WHERE doc = ?`, rev, doc);
      } else if (e.lane === '@manifest' && e.op === 'undelete') {
        // trash.restore: the kernel re-creates the entry's live doc (a `create` effect on the entry)
        after = repo(path);
        sql.exec(
          `UPDATE docs SET retired = 0, path = ?, updated_rev = ? WHERE doc = ?`,
          after,
          rev,
          doc
        );
      } else {
        before = repo(path);
        after = repo(path);
      }
      sql.exec(
        `INSERT INTO effects (effect, rev, action_id, doc, entry, lane, op, before_hash, after_hash, before_path, after_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        `e_${randomUUID()}`,
        rev,
        actionId,
        doc,
        entry,
        e.lane,
        e.op === 'undelete' ? 'create' : e.op,
        before,
        after
      );
    }
  });
}

function planBoard(ctx, op) {
  const abs = join(ctx.designRoot, `${canvasSlugFromRel(op.path, DESIGN)}.annotations.json`);
  const cur = readOr(abs);
  const b = new AiBatch(cur ? parseBoard(cur).elements : []);
  let x = 4000;
  for (const s of op.ops) {
    if (s.create === 'sticky') {
      const id = b.create('sticky', { text: s.text, x, y: 0 });
      if (s.resolve) b.resolveStickies({ id });
    } else if (s.create === 'sticker') {
      b.create('image', {
        href: s.href ?? 'assets/journey-sticker.png',
        sticker: { pack: 'journey', id: 'thumbs-up' },
        x,
        y: 300,
        w: 160,
        h: 160,
      });
    } else if (s.create === 'human-sticky') {
      // a sticky a person wrote (author kind human): the AI-authorship fault
      const id = b.create('sticky', { text: s.text, x, y: 0 });
      const el = b.elements.find((e) => e.id === id);
      el.author = { kind: 'human', name: 'Tereza' };
    }
    x += 300;
  }
  write(abs, serializeBoard(b.elements));
}

function commentsOp(ctx, op) {
  const abs = join(ctx.designRoot, '_comments', `${canvasSlugFromRel(op.path, DESIGN)}.json`);
  let list = JSON.parse(readOr(abs) ?? '[]');
  let n = 0;
  for (const c of op.ops) {
    const actor = c.as === 'ai' ? { name: 'AI', kind: 'ai' } : { name: c.author ?? 'Tereza' };
    const r = applyCommentOp(
      list,
      { file: op.path, ...c },
      {
        actor,
        now: new Date(Date.UTC(2026, 9, 20, 9, n++)).toISOString(),
        newId: () => c.newId ?? `c_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        newReplyId: () => `r_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      }
    );
    if (!r.ok) throw new Error(`comments ${c.op} ${c.id ?? ''}: ${r.code ?? 'refused'}`);
    list = r.list;
  }
  write(abs, `${JSON.stringify(list, null, 2)}\n`);
}

const logLine = (ctx, name, v) => {
  if (!ctx.trialDir) throw new Error(`${name}: no trial dir`);
  mkdirSync(ctx.trialDir, { recursive: true });
  appendFileSync(join(ctx.trialDir, name), `${JSON.stringify(v)}\n`);
};

/** Apply one plant op. Unknown ops throw — a typo in a journey must not pass silently. */
export function plant(ctx, op) {
  const abs = (rel) => join(ctx.designRoot, rel);
  switch (op.op) {
    case 'write':
      return write(abs(op.path), op.text);
    case 'edit': {
      const t = readOr(abs(op.path));
      if (t === null || !t.includes(op.old))
        throw new Error(`edit ${op.path}: text not found: ${op.old.slice(0, 60)}`);
      return write(
        abs(op.path),
        op.all ? t.split(op.old).join(op.new) : t.replace(op.old, () => op.new)
      );
    }
    case 'mv':
      mkdirSync(dirname(abs(op.to)), { recursive: true });
      renameSync(abs(op.from), abs(op.to));
      for (const ext of ['.meta.json', '.css']) {
        const f = abs(op.from.replace(/\.tsx$/, ext));
        if (existsSync(f)) renameSync(f, abs(op.to.replace(/\.tsx$/, ext)));
      }
      return;
    case 'rm':
      return rmSync(abs(op.path), { force: true });
    case 'meta': {
      const p = abs(op.path.replace(/\.tsx$/, '.meta.json'));
      const cur = JSON.parse(readOr(p) ?? '{}');
      return write(p, `${JSON.stringify({ ...cur, ...op.set }, null, 2)}\n`);
    }
    case 'action':
      return plantAction(ctx, op);
    case 'board':
      return planBoard(ctx, op);
    case 'comments':
      return commentsOp(ctx, op);
    case 'deny':
      return logLine(ctx, 'denies.jsonl', {
        lane: 'dry',
        tool: op.tool ?? 'Edit',
        code: op.code,
        reason: `${op.code}: planted`,
      });
    case 'ui-open':
      return logLine(ctx, 'ui-open.jsonl', { open: op.open });
    case 'tool':
      return logLine(ctx, 'tools.jsonl', { lane: 'dry', name: op.name, input: op.input ?? {} });
    default:
      throw new Error(`unknown plant op ${op.op}`);
  }
}

export function plantAll(ctx, ops) {
  for (const op of ops) plant(ctx, op);
}

/** The dry recipe for one fault: the good ops minus `drop` tags, with `replace` by tag, plus `add`. */
export function faultRecipe(good, fault) {
  const drop = new Set(fault.drop ?? []);
  const out = [];
  for (const op of good) {
    if (op.tag && fault.replace?.[op.tag]) out.push(...[fault.replace[op.tag]].flat());
    else if (!(op.tag && drop.has(op.tag))) out.push(op);
  }
  return [...out, ...(fault.add ?? [])];
}
