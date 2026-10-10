// Internal shim behind index.sh (`maude design index`). See index.sh for usage.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const JSON_OUT = args.includes('--json');
const root = path.resolve(opt('--root') ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const designRoot = path.join(root, '.design');
if (!existsSync(path.join(designRoot, 'config.json'))) {
  console.error(`maude design index: no .design/config.json under ${root}`);
  process.exit(2);
}

async function fromServer(query) {
  try {
    // The PORT only, on loopback — never the file's `url`: a planted or synced _server.json must
    // not turn this verb into a fetch of any host (security review, Phase 1 gate).
    const info = JSON.parse(readFileSync(path.join(designRoot, '_server.json'), 'utf8'));
    const port = Number(info?.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    if (Number.isInteger(info?.pid)) {
      try {
        process.kill(info.pid, 0);
      } catch {
        return null; // a dead server's file
      }
    }
    // and only a studio serving THIS root: a reused port may be another project's (server-up.sh's rule)
    const health = await fetch(`http://127.0.0.1:${port}/_health`, {
      signal: AbortSignal.timeout(1500),
    }).then((r) => (r.ok ? r.json() : null));
    const id = createHash('sha256').update(realpathSync(root)).digest('hex').slice(0, 12);
    if (health?.app !== 'design' || health.rootId !== id) return null;
    const res = await fetch(`http://127.0.0.1:${port}/_api/index${query}`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function fromStatic() {
  const { createIndexService } = await import('../index/service.ts');
  const cfg = JSON.parse(readFileSync(path.join(designRoot, 'config.json'), 'utf8'));
  const groups = cfg.canvasGroups ?? [
    { label: 'UI', path: 'ui' },
    { label: 'Design system', path: 'system' },
  ];
  return createIndexService({
    root,
    designRel: '.design',
    context: () => ({
      designRoot,
      groups,
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
  });
}

const q = opt('--q');
const canvasRel = opt('--canvas');
let result;
let source = 'server';
if (q !== undefined) {
  result = await fromServer(`?q=${encodeURIComponent(q)}`);
  if (!result) {
    source = 'static';
    result = (await fromStatic()).search(q);
  }
} else {
  result = await fromServer('');
  if (!result) {
    source = 'static';
    result = (await fromStatic()).snapshot();
  }
  if (canvasRel) {
    const row = result.canvases.find((c) => c.rel === canvasRel);
    if (!row) {
      console.error(`maude design index: no canvas ${canvasRel}`);
      process.exit(1);
    }
    result = row;
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ source, ...result }, null, 2));
} else if (q !== undefined) {
  if (!result.rows.length) console.log(`Nothing called "${q}".`);
  else if (result.closeOnly) console.log(`Nothing called "${q}". Close matches:`);
  for (const r of result.rows)
    console.log(
      `${r.group === 'artboards' ? '  artboard' : 'canvas  '}  ${r.key}${r.group === 'artboards' ? `  (${r.name})` : ''}`
    );
} else if (canvasRel) {
  console.log(
    `${result.rel}  ${result.artboards.length} artboards${result.dynamic ? ' + some built in code' : ''}  ds=${result.ds ?? '-'}`
  );
  for (const a of result.artboards)
    console.log(
      `  ${a.id}${a.label ? `  "${a.label}"` : ''}${a.kind ? `  ${a.kind}` : ''}${a.w ? `  ${a.w}×${a.h}` : ''}`
    );
} else {
  const c = result.counts;
  const kinds = Object.entries(c.byKind)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ');
  console.log(
    `${c.canvases} canvases · ${c.artboards} artboards${kinds ? ` (${kinds})` : ''} — from the ${source} index`
  );
  for (const row of result.canvases)
    console.log(`  ${row.rel}  ${row.artboards.length}${row.dynamic ? '+' : ''}`);
}
