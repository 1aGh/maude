// Internal shim behind assets.sh (`maude design assets`). See USAGE.
//
// The project's assets (`.design/assets/`): kind, size, the canvases that use each, and which are
// not used (S8.11, contract V2-1.17 §5.3/§5.5). Read-only → effect none → auto tier.
//
// Source: the running studio's `GET /_api/index?part=assets` (which can read older versions), else
// the static index built in-process. Statically the history of a canvas cannot be read, so
// "Not used" says it is still checking rather than risk calling a picture unused that an older
// version of a canvas still shows (§5.5: a false "used" is safe, a false "not used" is not).

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DESIGN_REL } from '../../../cli/lib/studio-locate.mjs';
import {
  call,
  clean,
  parseWords,
  projectRoot,
  runVerb,
  studioFor,
  UsageError,
} from './_studio-verb.mjs';

export const USAGE = `usage: maude design assets [--usage <asset>] [--not-used] [--json] [--root <project>]
  (none)          every asset: kind, size, canvases using it
  --usage <asset> the canvases that use one asset (assets/a1b2c3d4.png, or just a1b2c3d4.png)
  --not-used      assets nothing uses; lists nothing until older versions have been checked
  --json          machine-readable
Read-only. Pictures that an older version of a canvas still shows, and today's AI takes nobody
placed yet, are never listed as not used.
Exit 0 ok · 1 unknown asset · 2 usage.
`;

const kb = (n) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

async function fromStatic(root) {
  const { createIndexService } = await import('../index/service.ts');
  const designRoot = path.join(root, DESIGN_REL);
  const cfg = JSON.parse(readFileSync(path.join(designRoot, 'config.json'), 'utf8'));
  const svc = createIndexService({
    root,
    designRel: DESIGN_REL,
    context: () => ({
      designRoot,
      groups: cfg.canvasGroups ?? [
        { label: 'UI', path: 'ui' },
        { label: 'Design system', path: 'system' },
      ],
      defaultDs: cfg.defaultDesignSystem ?? cfg.designSystems?.[0]?.name ?? null,
      designSystems: cfg.designSystems ?? [],
    }),
    project: () => ({
      name: cfg.name ?? path.basename(root),
      label: null,
      formatVersion: cfg.formatVersion ?? 1,
      linkedHub: null,
      managed: false,
    }),
    persist: false,
    hashAssets: false,
  });
  const answer = svc.assetsAnswer();
  svc.stop();
  return answer;
}

async function main(words) {
  const { flags, pos } = parseWords(words, {
    bool: ['--not-used', '--json'],
    value: ['--usage', '--root'],
  });
  if (pos.length) throw new UsageError('assets takes no positional argument');
  if (flags['--usage'] && flags['--not-used'])
    throw new UsageError('--usage and --not-used are exclusive');
  const root = projectRoot(flags['--root']);
  if (!root) {
    process.stderr.write(
      'maude design assets: no .design/config.json here or above — run it inside a Maude project\n'
    );
    return 2;
  }

  let answer = null;
  let source = 'studio';
  const studio = await studioFor(root);
  if (studio) {
    const r = await call(studio, '/_api/index?part=assets');
    // an older studio answers the whole snapshot: no `assets` key — build it here instead
    if (r?.status === 200 && Array.isArray(r.body?.assets)) answer = r.body;
  }
  if (!answer) {
    source = 'static';
    answer = await fromStatic(root);
  }
  const rows = answer.assets;
  const checking = answer.history !== 'ready';
  const json = flags['--json'];

  if (flags['--usage']) {
    const want = flags['--usage'].replace(/^\.design\//, '');
    const rel = want.startsWith('assets/') ? want : `assets/${want}`;
    const row = rows.find((r) => r.rel === rel);
    if (!row) {
      process.stderr.write(`maude design assets: no asset ${clean(rel)}\n`);
      return 1;
    }
    if (json) console.log(JSON.stringify({ source, history: answer.history, ...row }, null, 2));
    else {
      console.log(`${clean(row.rel)}  ${row.kind}  ${kb(row.size)}`);
      for (const c of row.usedIn) console.log(`  used in ${clean(c)}`);
      if (row.usedElsewhere) console.log('  also named by a design-system or other file');
      if (row.olderVersions === true) console.log('  an older version of a canvas still shows it');
      if (row.olderVersions === 'checking') console.log('  older versions: still checking');
      if (!row.usedIn.length && !row.usedElsewhere && row.olderVersions === false)
        console.log(row.recentTake ? "  not placed yet (today's AI take)" : '  not used');
    }
    return 0;
  }

  if (flags['--not-used']) {
    const list = checking ? [] : rows.filter((r) => r.notUsed === true);
    if (json) console.log(JSON.stringify({ source, checking, assets: list }, null, 2));
    else if (checking)
      console.log(
        source === 'static'
          ? 'Checking older versions… they can only be read through the running studio, so nothing is listed. Open this project in Maude and ask again.'
          : 'Checking older versions… nothing is listed until that finishes. Ask again in a moment.'
      );
    else if (!list.length) console.log('Every asset is used.');
    else {
      console.log(`${list.length} not used`);
      for (const r of list) console.log(`  ${clean(r.rel)}  ${r.kind}  ${kb(r.size)}`);
    }
    return 0;
  }

  if (json) console.log(JSON.stringify({ source, history: answer.history, assets: rows }, null, 2));
  else {
    const by = {};
    for (const r of rows) by[r.kind] = (by[r.kind] ?? 0) + 1;
    const kinds = Object.entries(by)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ');
    console.log(`${rows.length} assets${kinds ? ` (${kinds})` : ''} — from the ${source} index`);
    for (const r of rows)
      console.log(
        `  ${clean(r.rel)}  ${r.kind}  ${kb(r.size)}  ${r.usedBy ? `${r.usedBy} canvas${r.usedBy === 1 ? '' : 'es'}` : r.usedElsewhere ? 'design system' : '-'}`
      );
  }
  return 0;
}

if (import.meta.main) await runVerb('assets', USAGE, main);
