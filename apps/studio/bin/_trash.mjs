// Internal shim behind trash.sh (`maude design trash`). See USAGE.
//
// The shared Trash from a terminal (S1.17; S1-trash.md; routes/trash.ts):
//   list      GET  /_api/trash                      (effect none → auto)
//   restore   POST /_api/trash/restore { id }       (effect project → auto)
//   clear     POST /_api/trash/clear   { items? }   (OWNER only; asks first)
// The requests come from history/surface-requests.ts — the same builders the Trash view uses, so a
// click and this verb reach one route with one body. Who trashed what, and the labels, are other
// people's text: printed inside the one untrusted block (`--json`: `untrusted: true`).
//
// `clear` deletes for good what the whole team could still restore. The studio's route refuses
// every role but the owner whatever this verb sends; the verb adds the question a person is owed
// (a terminal prompt, or `--yes` in a script). The registry action `trash.clear` stays human-only
// (decision:maude/v2-lead-trash-clear-human-only): this verb is the owner's own hands, tiered
// `human` in actions/verbs.ts so the AI chat never runs it.

import { createInterface } from 'node:readline';
import {
  isTrashId,
  trashClearRequest,
  trashListRequest,
  trashRestoreRequest,
} from '../history/surface-requests.ts';
import {
  call,
  clean,
  connect,
  field,
  parseWords,
  runVerb,
  UsageError,
  untrustedJson,
  writeUntrusted,
} from './_studio-verb.mjs';

export const USAGE = `usage: maude design trash list [--json] [--root <project>]
       maude design trash restore <id | canvas path> [--json] [--root <project>]
       maude design trash clear [--item <id>]... [--yes] [--json] [--root <project>]
  list     what is in the Trash, newest first: id, kind, canvas, who trashed it, when
  restore  bring one item back (an id from \`list\`, or the canvas path when only one item has it);
           a canvas whose path was taken comes back under a new name
  clear    delete for good — everything, or the --item ids. Restore can't bring them back.
           Only the project owner may; the studio refuses everyone else. Asks first (--yes skips
           the question, for a script).
list reads only; restore changes the project; clear is the owner's, at a terminal.
Exit 0 ok · 1 not found / refused / not available · 2 usage · 3 no studio running.
`;

const when = (ms) =>
  Number.isFinite(ms) ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '';

/** GET /_api/trash → { legacy, items, canClear }, or throws (unreachable / no answer). */
async function listing(studio) {
  const req = trashListRequest();
  const r = await call(studio, req.route);
  if (r?.status !== 200 || !r.body) throw new Error('the studio did not answer');
  if (!r.body.ok) {
    if (r.body.reason === 'unreachable')
      throw new Error('the team server is unreachable — try again in a moment');
    throw new Error(`the Trash is not available (${clean(r.body.reason ?? r.status)})`);
  }
  return {
    legacy: r.body.legacy === true,
    items: Array.isArray(r.body.items) ? r.body.items : [],
    canClear: r.body.canClear === true,
  };
}

function itemLine(i) {
  const who = `${field(i.who ?? '?')}${i.mine ? ' (you)' : ''}`;
  const what =
    i.kind === 'artboard'
      ? `${field(i.label ?? i.artboard ?? '')}  ·  artboard of ${field(i.path ?? '')}`
      : field(i.path ?? '');
  return `${field(i.id)}  ${field(i.kind)}  ${what}  ${who}  ${when(i.at)}`;
}

const LEGACY =
  'this project has no shared Trash — its canvases were parked on this Mac under <designRoot>/_trash/';

async function list(words) {
  const { flags, pos } = parseWords(words, { bool: ['--json'], value: ['--root'] });
  if (pos.length) throw new UsageError('list takes no operands');
  const c = await connect('trash', flags['--root']);
  if (c.exit) return c.exit;
  const l = await listing(c.studio);
  if (flags['--json']) {
    process.stdout.write(
      `${JSON.stringify(untrustedJson({ legacy: l.legacy, items: l.items, canClear: l.canClear }))}\n`
    );
    return 0;
  }
  if (l.legacy) {
    process.stdout.write(`${LEGACY}\n`);
    return 0;
  }
  if (!l.items.length) {
    process.stdout.write('The Trash is empty.\n');
    return 0;
  }
  writeUntrusted(`${l.items.map(itemLine).join('\n')}\n`);
  return 0;
}

const REFUSALS = {
  cleared: 'it was cleared out for good — it can’t be restored',
  taken: 'a canvas with that name is already there',
  forbidden: 'you can’t restore this one',
  'not-in-scope': 'you can’t restore this one',
  'not-in-trash': 'it is not in the Trash (restored already?)',
  'canvas-trashed': 'its canvas is in the Trash too — restore the canvas first',
  legacy: 'this project has no shared Trash to restore from',
  unreachable: 'the team server is unreachable — try again in a moment',
};

/** The one-line refusal of a write: `maude design trash <sub>: refused (<reason>) — <why>`. */
function refusal(sub, r) {
  const b = r?.body ?? {};
  const reason = b.reason ?? b.code ?? (r ? `HTTP ${r.status}` : 'no answer');
  const why = clean(b.line ?? REFUSALS[reason] ?? '');
  process.stderr.write(
    `maude design trash ${sub}: refused (${clean(reason)})${why ? ` — ${why}` : ''}\n`
  );
  return 1;
}

async function restore(words) {
  const { flags, pos } = parseWords(words, { bool: ['--json'], value: ['--root'] });
  if (pos.length !== 1) throw new UsageError('restore takes one id (or canvas path)');
  let id = pos[0];
  const looksLikeId = /^(canvas|artboard):/.test(id);
  if (looksLikeId && !isTrashId(id)) throw new UsageError(`${clean(id)} is not a Trash id`);
  if (!looksLikeId && /\.(tsx|html)$/i.test(id) === false)
    throw new UsageError(`${clean(id)} is not a Trash id or a canvas path`);
  const c = await connect('trash', flags['--root']);
  if (c.exit) return c.exit;
  if (!looksLikeId) {
    const path = id.replace(/^\.design\//, '');
    const hits = (await listing(c.studio)).items.filter((i) => i.path === path);
    if (hits.length !== 1) {
      process.stderr.write(
        hits.length
          ? `maude design trash restore: ${hits.length} items in the Trash have ${clean(path)} — name one: ${hits.map((i) => field(i.id)).join(' · ')}\n`
          : `maude design trash restore: nothing in the Trash is ${clean(path)} — \`maude design trash list\`\n`
      );
      return hits.length ? 2 : 1;
    }
    id = hits[0].id;
  }
  const req = trashRestoreRequest(id);
  const r = await call(c.studio, req.route, { method: req.method, json: req.body });
  const b = r?.body ?? {};
  if (r && (r.status === 200 || r.status === 202) && b.ok) {
    if (flags['--json']) process.stdout.write(`${JSON.stringify(untrustedJson(b))}\n`);
    else if (r.status === 202)
      process.stdout.write(`→ queued ${clean(id)} (it restores when the team server answers)\n`);
    else
      process.stdout.write(
        `→ restored ${clean(id)}${b.path ? ` at ${field(b.path)}` : ''}${b.renamed ? ' (the old name was taken, so it came back under a new one)' : ''}\n`
      );
    return 0;
  }
  return refusal('restore', r);
}

/** The question a person is owed before a delete-for-good. */
function confirm(question) {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (a) => {
      rl.close();
      done(a.trim().toLowerCase() === 'clear');
    });
  });
}

async function clear(words) {
  const { flags, pos, items } = (() => {
    // --item repeats, which parseWords' one-value flags can't carry: peel them off first.
    const rest = [];
    const items = [];
    for (let i = 0; i < words.length; i++) {
      if (words[i] === '--item') {
        const v = words[++i];
        if (v === undefined || v === '') throw new UsageError('--item needs a Trash id');
        items.push(v);
      } else if (String(words[i]).startsWith('--item=')) items.push(String(words[i]).slice(7));
      else rest.push(words[i]);
    }
    return { ...parseWords(rest, { bool: ['--json', '--yes'], value: ['--root'] }), items };
  })();
  if (pos.length) throw new UsageError('clear takes no operands (use --item <id>)');
  for (const id of items)
    if (!isTrashId(id)) throw new UsageError(`${clean(id)} is not a Trash id`);
  if (new Set(items).size !== items.length) throw new UsageError('an --item is named twice');
  const what = items.length
    ? `${items.length} item${items.length === 1 ? '' : 's'}`
    : 'everything in the Trash';
  if (flags['--yes'] !== true) {
    if (!process.stdin.isTTY || !process.stderr.isTTY)
      throw new UsageError('clear deletes for good — run it in a terminal, or pass --yes');
  }
  const c = await connect('trash', flags['--root']);
  if (c.exit) return c.exit;
  if (flags['--yes'] !== true) {
    const ok = await confirm(
      `Clear out ${what} for good? Restore can't bring them back. Type "clear" to go on: `
    );
    if (!ok) {
      process.stderr.write('maude design trash clear: not cleared\n');
      return 1;
    }
  }
  const req = trashClearRequest(items.length ? items : undefined);
  const r = await call(c.studio, req.route, { method: req.method, json: req.body });
  const b = r?.body ?? {};
  if (r && (r.status === 200 || r.status === 202) && b.ok) {
    const cleared = Array.isArray(b.cleared) ? b.cleared : [];
    const skipped = Array.isArray(b.skipped) ? b.skipped : [];
    if (flags['--json']) process.stdout.write(`${JSON.stringify(untrustedJson(b))}\n`);
    else if (r.status === 202)
      process.stdout.write('→ queued (it clears when the team server answers)\n');
    else
      process.stdout.write(
        `→ cleared ${cleared.length} item${cleared.length === 1 ? '' : 's'}${skipped.length ? `; ${skipped.length} left as they were: ${skipped.map((s) => `${field(s.id ?? '?')} (${field(s.reason)})`).join(', ')}` : ''}\n`
      );
    return 0;
  }
  if (r?.status === 403) {
    process.stderr.write(
      `maude design trash clear: refused (${clean(b.reason ?? 'forbidden')}) — only the project owner can clear out the Trash\n`
    );
    return 1;
  }
  return refusal('clear', r);
}

const SUBS = { list, restore, clear };

if (import.meta.main) {
  runVerb('trash', USAGE, async (words) => {
    const sub = words[0];
    if (!sub || !Object.hasOwn(SUBS, sub))
      throw new UsageError(sub ? `unknown sub-verb ${sub}` : 'name a sub-verb');
    return SUBS[sub](words.slice(1));
  });
}
