// Internal shim behind canvas-new.sh / canvas-move.sh (`maude design canvas-new`, `canvas-move`).
//
// The app's own whole-file canvas operations, for the AI chat and a terminal (fix-bulk W1 follow-up):
//   new    POST /_api/canvas { kind, name?, group?, clips? }   (effect project → auto)
//          POST /_api/canvas { duplicateOf }                    (--duplicate; the same route)
//   move   POST /_api/fs-move { file, toName?, toDir? }         (effect project → auto)
// The same routes Canvases › New canvas / Duplicate / Rename / Move to… call, so Version history
// records the create or move, and a create in a chat is claimed for that chat's live run
// (X-Maude-Chat, ai/create-claim.ts — `call` adds it on a write).
//
// Why verbs and not `curl-local`: since 2.1.0 the studio's main origin needs its key from every
// caller (contract sec-loopback-bearer §7). `curl-local` sends none, by design — it is a plain
// loopback curl and stays one. These verbs find the studio and its key the one way every verb does
// (studio-locate.mjs: the app's attested server, else a terminal server whose `/_health` names this
// project) and send it with each request (`studioHeaders`, via `call`).

import { call, clean, connect, field, parseWords, runVerb, UsageError } from './_studio-verb.mjs';

export const NEW_USAGE = `usage: maude design canvas-new [<name>] [--kind blank|brief-board|video-comp] [--group <folder>]
                              [--ds <design system>] [--from-prompt <sentence>] [--json] [--root <project>]
       maude design canvas-new --duplicate <canvas path> [--json] [--root <project>]
  Makes a canvas the way Canvases › New canvas does, and prints the file it made (.design/…tsx);
  then Edit that file. No name: the app picks one ("Untitled", or the next free one).
  --kind      blank (default) · brief-board (a brief to annotate) · video-comp (an empty video)
  --group     one of the project's canvas folders (default: the new-canvas folder, usually ui)
  --ds        the canvas's design system (default: what New canvas picks; an unknown one → the default)
  --from-prompt  with no name, a blank canvas is named from this sentence ("A poster for…" → Poster)
  --duplicate a copy of that canvas next to it, as Canvases › Duplicate does
Exit 0 made · 1 refused · 2 usage · 3 no studio running.
`;

export const MOVE_USAGE = `usage: maude design canvas-move <canvas path> [--name <new name>] [--to <folder>]
                               [--json] [--root <project>]
  Renames or moves a canvas (the .tsx and everything that belongs to it) the way Canvases › Rename
  and Move to… do, so Version history keeps it one canvas. Give --name, --to, or both.
  --name  the new name, without .tsx
  --to    the design-root-relative folder to move it to (ui/archive)
Exit 0 moved · 1 refused · 2 usage · 3 no studio running.
`;

const KINDS = new Set(['blank', 'brief-board', 'video-comp']);

/** `ui/home.tsx`, `.design/ui/home.tsx` or `./ui/home.tsx` → `ui/home.tsx`, or a UsageError. */
export function canvasOperand(word) {
  const path = String(word)
    .replace(/^\.\//, '')
    .replace(/^\.design\//, '');
  if (!/\.tsx$/i.test(path) || path.split('/').includes('..') || path.startsWith('/'))
    throw new UsageError(`${clean(word)} is not a canvas path (ui/<name>.tsx)`);
  return path;
}

/** The words after `canvas-new` → the `/_api/canvas` body. Pure; throws UsageError. */
export function newBody(words) {
  const { flags, pos } = parseWords(words, {
    bool: ['--json'],
    value: ['--kind', '--group', '--ds', '--from-prompt', '--duplicate', '--root'],
  });
  if (pos.length > 1) throw new UsageError('give at most one name');
  if (flags['--duplicate'] !== undefined) {
    if (pos.length || ['--kind', '--group', '--ds', '--from-prompt'].some((f) => f in flags))
      throw new UsageError('--duplicate takes no name, --kind, --group, --ds or --from-prompt');
    return { flags, body: { duplicateOf: canvasOperand(flags['--duplicate']) } };
  }
  const kind = flags['--kind'] ?? 'blank';
  if (!KINDS.has(kind)) throw new UsageError(`--kind must be blank, brief-board or video-comp`);
  if (kind !== 'blank' && !pos.length) throw new UsageError(`a ${kind} needs a name`);
  const body = { kind };
  if (pos.length) body.name = pos[0];
  if (flags['--group'] !== undefined) body.group = flags['--group'];
  if (flags['--ds'] !== undefined) body.designSystem = flags['--ds'];
  if (flags['--from-prompt'] !== undefined) {
    if (pos.length || kind !== 'blank')
      throw new UsageError('--from-prompt names an unnamed blank canvas: give it without a name');
    body.fromPrompt = flags['--from-prompt'];
  }
  if (kind === 'video-comp') body.clips = [];
  return { flags, body };
}

/** The words after `canvas-move` → the `/_api/fs-move` body. Pure; throws UsageError. */
export function moveBody(words) {
  const { flags, pos } = parseWords(words, {
    bool: ['--json'],
    value: ['--name', '--to', '--root'],
  });
  if (pos.length !== 1) throw new UsageError('name one canvas path');
  const to = flags['--to'];
  if (flags['--name'] === undefined && to === undefined)
    throw new UsageError('give --name, --to, or both');
  const body = { file: canvasOperand(pos[0]) };
  if (flags['--name'] !== undefined) body.toName = String(flags['--name']).replace(/\.tsx$/i, '');
  if (to !== undefined) body.toDir = to;
  return { flags, body };
}

function refused(name, r) {
  const b = r?.body ?? {};
  const why = clean(b.error ?? (r ? r.text?.trim() || `HTTP ${r.status}` : 'no answer'));
  process.stderr.write(`maude design ${name}: refused — ${why}\n`);
  return 1;
}

async function runNew(words) {
  const { flags, body } = newBody(words);
  const c = await connect('canvas-new', flags['--root']);
  if (c.exit) return c.exit;
  const r = await call(c.studio, '/_api/canvas', { method: 'POST', json: body });
  const b = r?.body ?? {};
  if (r?.status === 201 && b.ok) {
    if (flags['--json']) process.stdout.write(`${JSON.stringify(b)}\n`);
    else process.stdout.write(`→ made ${field(b.file ?? b.rel)} — Edit that file\n`);
    return 0;
  }
  return refused('canvas-new', r);
}

async function runMove(words) {
  const { flags, body } = moveBody(words);
  const c = await connect('canvas-move', flags['--root']);
  if (c.exit) return c.exit;
  const r = await call(c.studio, '/_api/fs-move', { method: 'POST', json: body });
  const b = r?.body ?? {};
  if (r?.status === 200 && b.ok) {
    if (flags['--json']) process.stdout.write(`${JSON.stringify(b)}\n`);
    else process.stdout.write(`→ moved ${field(b.fromRel)} to ${field(b.toRel)}\n`);
    return 0;
  }
  return refused('canvas-move', r);
}

if (import.meta.main) {
  const sub = process.argv[2];
  if (sub === 'new') {
    process.argv.splice(2, 1);
    runVerb('canvas-new', NEW_USAGE, runNew);
  } else if (sub === 'move') {
    process.argv.splice(2, 1);
    runVerb('canvas-move', MOVE_USAGE, runMove);
  } else {
    process.stderr.write(
      '_canvas-file.mjs: run it through `maude design canvas-new|canvas-move`\n'
    );
    process.exit(2);
  }
}
