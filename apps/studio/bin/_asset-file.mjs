// Internal shim behind asset-trash.sh / asset-rename.sh (`maude design asset-trash`, `asset-rename`).
//
// The Assets panel's own Move to trash and Rename… on a picture, for the AI chat and a terminal
// (fix-bulk 2026-11-10 follow-up):
//   trash   POST /_api/assets/trash  { assets: [...] }   per item: moved, or used | kept-by-versions | checking
//   rename  POST /_api/assets/rename { asset, name }     the new base name; the extension is kept
// Both refuse a picture a canvas uses or an older version still shows (asset-trash.ts, asset-rename.ts):
// `maude design assets --not-used` lists the ones that can go.
//
// Why verbs and not `curl-local`: since 2.1.0 the studio's main origin needs its key from every caller
// (contract sec-loopback-bearer §7). `curl-local` sends none, by design, so the recipes it carried
// answered 401 against the app. These find the studio and its key the way every verb does
// (studio-locate.mjs) and send it with each request (`call`).

import { call, clean, connect, field, parseWords, runVerb, UsageError } from './_studio-verb.mjs';

export const TRASH_USAGE = `usage: maude design asset-trash <asset>... [--json] [--root <project>]
  Moves pictures (and their sidecars) to the Trash, as Assets › Move to trash does. Trash brings
  them back. A picture a canvas uses, or an older version still shows, stays where it is:
  \`maude design assets --not-used\` lists the ones that can go.
  <asset>  assets/<name>.<ext> (or .design/assets/<name>.<ext>), up to 500
Exit 0 every one moved · 1 one or more stayed / refused · 2 usage · 3 no studio running.
`;

export const RENAME_USAGE = `usage: maude design asset-rename <asset> <new name> [--json] [--root <project>]
  Renames a picture and its sidecars, as Assets › Rename… does; the extension is kept. A picture a
  canvas uses, or an older version still shows, keeps its name (its references would break).
  <asset>     assets/<name>.<ext> (or .design/assets/<name>.<ext>)
  <new name>  the new name, without the extension
Exit 0 renamed · 1 refused · 2 usage · 3 no studio running.
`;

const MAX_ASSETS = 500;

/** `assets/x.png`, `.design/assets/x.png` or `./assets/x.png` → `assets/x.png`, or a UsageError. */
export function assetOperand(word) {
  const rel = String(word)
    .replace(/^\.\//, '')
    .replace(/^\.design\//, '');
  if (!rel.startsWith('assets/') || rel.split('/').includes('..') || rel.length <= 7)
    throw new UsageError(`${clean(word)} is not an asset path (assets/<name>.<ext>)`);
  return rel;
}

/** The words after `asset-trash` → the `/_api/assets/trash` body. Pure; throws UsageError. */
export function trashBody(words) {
  const { flags, pos } = parseWords(words, { bool: ['--json'], value: ['--root'] });
  if (!pos.length) throw new UsageError('name at least one asset');
  if (pos.length > MAX_ASSETS) throw new UsageError(`at most ${MAX_ASSETS} assets at once`);
  return { flags, body: { assets: pos.map(assetOperand) } };
}

/** The words after `asset-rename` → the `/_api/assets/rename` body. Pure; throws UsageError. */
export function renameBody(words) {
  const { flags, pos } = parseWords(words, { bool: ['--json'], value: ['--root'] });
  if (pos.length !== 2) throw new UsageError('name one asset and its new name');
  const name = String(pos[1]).trim();
  if (!name) throw new UsageError('the new name is empty');
  return { flags, body: { asset: assetOperand(pos[0]), name } };
}

function refused(name, r) {
  const b = r?.body ?? {};
  const why = clean(
    b.reason ?? b.error ?? (r ? r.text?.trim() || `HTTP ${r.status}` : 'no answer')
  );
  process.stderr.write(`maude design ${name}: refused — ${why}\n`);
  return 1;
}

async function runTrash(words) {
  const { flags, body } = trashBody(words);
  const c = await connect('asset-trash', flags['--root']);
  if (c.exit) return c.exit;
  const r = await call(c.studio, '/_api/assets/trash', { method: 'POST', json: body });
  const b = r?.body ?? {};
  if (r?.status !== 200 || !b.ok || !Array.isArray(b.results)) return refused('asset-trash', r);
  if (flags['--json']) process.stdout.write(`${JSON.stringify(b)}\n`);
  else
    for (const it of b.results)
      process.stdout.write(
        it.ok
          ? `→ moved ${field(it.rel)} to the Trash\n`
          : `· kept ${field(it.rel)} — ${field(it.reason)}\n`
      );
  return b.results.every((it) => it.ok) ? 0 : 1;
}

async function runRename(words) {
  const { flags, body } = renameBody(words);
  const c = await connect('asset-rename', flags['--root']);
  if (c.exit) return c.exit;
  const r = await call(c.studio, '/_api/assets/rename', { method: 'POST', json: body });
  const b = r?.body ?? {};
  if (r?.status === 200 && b.ok) {
    if (flags['--json']) process.stdout.write(`${JSON.stringify(b)}\n`);
    else process.stdout.write(`→ renamed ${field(b.rel ?? body.asset)} to ${field(b.to)}\n`);
    return 0;
  }
  return refused('asset-rename', r);
}

if (import.meta.main) {
  const sub = process.argv[2];
  if (sub === 'trash') {
    process.argv.splice(2, 1);
    runVerb('asset-trash', TRASH_USAGE, runTrash);
  } else if (sub === 'rename') {
    process.argv.splice(2, 1);
    runVerb('asset-rename', RENAME_USAGE, runRename);
  } else {
    process.stderr.write(
      '_asset-file.mjs: run it through `maude design asset-trash|asset-rename`\n'
    );
    process.exit(2);
  }
}
