#!/usr/bin/env bun
// scripts/v2-index-bench.ts — the V2-1.17 §5.11 budgets for the project index and the thumbnail
// renderer (V2-2.17; V2-8.14 re-runs it). Measures on a REAL project tree, which must be an
// UNLINKED COPY: the script refuses a root whose config still names a `linkedHub` or that carries
// `_sync.json` / `_state/` (a copied synced project re-links to the live cloud hub).
//
//   bun scripts/v2-index-bench.ts --root <copy> [--port 4797] [--skip-artboards] [--skip-assets]
//                                 [--skip-versions] [--runs 5]
//
// Everything it writes goes to a throwaway dir: the index/picture cache (MAUDE_INDEX_DIR), the
// studio's prefs/config (XDG_CONFIG_HOME, MAUDE_UI_PREFS_PATH, MAUDE_CLOUD_CONFIG) and logs —
// for this process and the studio server it boots (NO_OPEN=1, MAUDE_NO_AUTOBUILD=1). The version
// pass commits the canvas sources into a git repo INSIDE the copy and edits them there.

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(k);
const opt = (k: string, d: string) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : d;
};
const root = path.resolve(opt('--root', ''));
const port = Number(opt('--port', '4797'));
const RUNS = Number(opt('--runs', '5'));
if (!opt('--root', '')) throw new Error('--root <unlinked copy> is required');
const designRoot = path.join(root, '.design');
const cfgRaw = JSON.parse(readFileSync(path.join(designRoot, 'config.json'), 'utf8'));
// an EMPTY _state/ is what the studio itself creates on boot; anything in it came with the copy
const stateDir = path.join(designRoot, '_state');
if (
  cfgRaw.linkedHub ||
  existsSync(path.join(designRoot, '_sync.json')) ||
  (existsSync(stateDir) && readdirSync(stateDir).length > 0)
)
  throw new Error(
    'refusing a LINKED project: strip linkedHub, _sync.json and _state from the copy first'
  );

const scratch = mkdtempSync(path.join(tmpdir(), 'maude-bench-'));
for (const [k, v] of Object.entries({
  MAUDE_INDEX_DIR: path.join(scratch, 'index'),
  MAUDE_LOG_DIR: path.join(scratch, 'logs'),
  XDG_CONFIG_HOME: path.join(scratch, 'config'),
  MAUDE_UI_PREFS_PATH: path.join(scratch, 'config', 'maude', 'prefs.json'),
  MAUDE_CLOUD_CONFIG: path.join(scratch, 'config', 'maude', 'cloud.json'),
}))
  process.env[k] = v;

// imported after the env is pinned: the index/picture cache resolves MAUDE_INDEX_DIR per call
const { extractCanvas, stampOf } = await import('../apps/studio/index/extract.ts');
const { createIndexService } = await import('../apps/studio/index/service.ts');
const { pidOf, readSnapshot, writeSnapshot } = await import('../apps/studio/index/snapshot.ts');
const { createThumbService, spawnRendererShim } = await import('../apps/studio/thumbs/service.ts');
const { fileHash } = await import('../apps/studio/thumbs/keys.ts');
const { thumbsDir } = await import('../apps/studio/thumbs/store.ts');

const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] as number);
};
const ms = (t0: number) => Math.round(performance.now() - t0);
const out: Record<string, unknown> = { root, at: new Date().toISOString() };

// ---------------------------------------------------------------- index
const ctx = () => ({
  designRoot,
  repoRoot: root,
  groups: cfgRaw.canvasGroups ?? [],
  defaultDs: cfgRaw.defaultDesignSystem ?? cfgRaw.designSystems?.[0]?.name ?? null,
  designSystems: cfgRaw.designSystems ?? [],
});
const project = () => ({
  name: cfgRaw.name ?? 'bench',
  label: null,
  formatVersion: 1,
  linkedHub: null,
  managed: false,
});
const builds: number[] = [];
const stamps: number[] = [];
let index = createIndexService({
  root,
  designRel: '.design',
  context: ctx,
  project,
  persist: false,
});
for (let i = 0; i < RUNS; i++) {
  index.stop();
  index = createIndexService({ root, designRel: '.design', context: ctx, project, persist: false });
  builds.push(index.buildMs());
  const t = performance.now();
  stampOf(
    ctx(),
    index.snapshot().canvases.map((c) => c.rel)
  );
  stamps.push(performance.now() - t);
}
const pid = pidOf(root);
writeSnapshot(index.snapshot());
const merges: number[] = [];
for (let r = 0; r < RUNS; r++) {
  const t = performance.now();
  for (let i = 0; i < 20; i++) {
    const s = readSnapshot(pid);
    stampOf(
      ctx(),
      (s?.canvases ?? []).map((c) => c.rel)
    );
  }
  merges.push(performance.now() - t);
}
const counts0 = index.counts();
out.index = {
  canvases: counts0.canvases,
  staticArtboards: counts0.artboards,
  buildMs: { p50: pct(builds, 0.5), p95: pct(builds, 0.95), budgetP95: 250 },
  stampMs: { p50: pct(stamps, 0.5), p95: pct(stamps, 0.95), budget: 10 },
  homeMerge20Ms: {
    p50: pct(merges, 0.5),
    p95: pct(merges, 0.95),
    budget: 150,
    note: '20 × (read + stamp) of this snapshot',
  },
};

// ---------------------------------------------------------------- studio server
const server = Bun.spawn(
  [
    'bun',
    'run',
    path.join(import.meta.dir, '..', 'apps', 'studio', 'server.ts'),
    '--port',
    String(port),
    '--root',
    root,
  ],
  {
    cwd: path.join(import.meta.dir, '..', 'apps', 'studio'),
    env: { ...process.env, NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1' },
    stdout: 'ignore',
    stderr: 'ignore',
  }
);
const main = `http://localhost:${port}`;
let capture: string | null = null;
try {
  for (let i = 0; i < 300; i++) {
    try {
      const h = await fetch(`${main}/_health`, { signal: AbortSignal.timeout(300) });
      if (h.ok && (await h.json()).pid === server.pid) break;
    } catch {
      /* not up */
    }
    await Bun.sleep(100);
  }
  const r = await fetch(`${main}/_canvas-shell.html?canvas=ui/x.tsx`, { redirect: 'manual' });
  capture = r.status === 307 ? new URL(r.headers.get('location') ?? '').origin : null;
  if (!capture) throw new Error('no capture origin — is the origin split on?');

  // ------------------------------------------------------------ thumbnails
  const replies: Array<Record<string, unknown>> = [];
  const shim = () => {
    const h = spawnRendererShim();
    h.onMessage((m) => replies.push(m));
    return h;
  };
  const ready: number[] = [];
  let t0 = performance.now();
  const ds = cfgRaw.designSystems?.[0];
  const service = () =>
    createThumbService({
      pid,
      designRoot,
      index,
      config: () => ({
        theme: cfgRaw.themeDefault ?? 'dark',
        tokensCssRel: ds?.tokensCssRel ?? cfgRaw.tokensCssRel,
      }),
      serverOrigin: () => main,
      captureOrigin: () => capture ?? undefined,
      freshDepsHash: (rel) => extractCanvas(ctx(), rel).depsHash,
      readVersion: async (rel, at) => {
        if (!('sha' in at)) return null;
        const p = Bun.spawn(['git', '-C', root, 'show', `${at.sha}:.design/${rel}`], {
          stdout: 'pipe',
          stderr: 'ignore',
        });
        const text = await new Response(p.stdout).text();
        return (await p.exited) === 0 ? text : null;
      },
      onReady: () => ready.push(ms(t0)),
      spawnShim: shim,
    });
  let svc = service();
  const shotsOf = (from: number) =>
    replies
      .slice(from)
      .flatMap((m) => (Array.isArray(m.shots) ? (m.shots as Array<Record<string, unknown>>) : []));
  const coverStatus = async () => {
    const tally: Record<string, number> = {};
    let bytes = 0;
    for (const c of index.snapshot().canvases) {
      const r = await svc.thumb({
        canvas: c.rel,
        artboard: null,
        size: 'card',
        priority: 'background',
      });
      const k = r.status === 'unavailable' ? `unavailable:${r.reason}` : r.status;
      tally[k] = (tally[k] ?? 0) + 1;
      if (r.status === 'ready') bytes += svc.read(r.key)?.length ?? 0;
    }
    return { tally, avgBytes: Math.round(bytes / Math.max(1, tally.ready ?? 1)) };
  };

  // covers — cold (first browser launch, nothing cached)
  t0 = performance.now();
  let from = replies.length;
  await svc.startBackground();
  await svc.idle();
  const coldMs = ms(t0);
  const first12 = ready[11] ?? null;
  const launchCold = replies.find((m) => typeof m.launchMs === 'number')?.launchMs ?? null;
  const coldJobs = replies
    .slice(from)
    .map((m) => Number(m.ms))
    .filter(Number.isFinite);
  out.coversCold = {
    totalMs: coldMs,
    first12Ms: first12,
    budget: { totalMs: 45_000, first12Ms: 3000 },
    perCanvasMs: { p50: pct(coldJobs, 0.5), p95: pct(coldJobs, 0.95) },
    ...(await coverStatus()),
    artboardsAfterHarvest: index.counts().artboards,
  };

  // Chromium launch, warm: a second renderer process on a warm disk cache
  svc.stop();
  rmSync(thumbsDir(pid), { recursive: true, force: true });
  svc = service();
  ready.length = 0;
  t0 = performance.now();
  from = replies.length;
  await svc.startBackground();
  await svc.idle();
  const warmJobs = replies
    .slice(from)
    .map((m) => Number(m.ms))
    .filter(Number.isFinite);
  out.coversWarm = {
    totalMs: ms(t0),
    first12Ms: ready[11] ?? null,
    perCanvasMs: { p50: pct(warmJobs, 0.5), p95: pct(warmJobs, 0.95) },
  };
  out.chromiumLaunchMs = {
    cold: launchCold,
    warm: replies.slice(from).find((m) => typeof m.launchMs === 'number')?.launchMs ?? null,
    budgetWarm: 500,
  };

  // every artboard (on demand only): one shot per artboard, card size
  if (!flag('--skip-artboards')) {
    from = replies.length;
    t0 = performance.now();
    const asks: Array<Promise<unknown>> = [];
    for (const c of index.snapshot().canvases)
      for (const a of c.artboards)
        asks.push(
          svc.thumb({ canvas: c.rel, artboard: a.id, size: 'card', priority: 'background' })
        );
    const n = asks.length;
    await Promise.all(asks);
    await svc.idle();
    const shots = shotsOf(from);
    const per = shots.map((s) => Number(s.ms)).filter(Number.isFinite);
    out.everyArtboard = {
      requested: n,
      shots: per.length,
      missing: shots.filter((s) => s.missing === true).length,
      totalMs: ms(t0),
      perShotMs: { p50: pct(per, 0.5), p95: pct(per, 0.95), budgetP95: 120 },
    };
  }

  // asset tiles (raster pictures under <designRoot>/assets, top level)
  if (!flag('--skip-assets')) {
    const dir = path.join(designRoot, 'assets');
    const names = existsSync(dir)
      ? readdirSync(dir).filter(
          (n) => /\.(png|jpe?g|gif|webp|avif)$/i.test(n) && statSync(path.join(dir, n)).isFile()
        )
      : [];
    let t = performance.now();
    for (const n of names) fileHash(path.join(dir, n), 'full');
    const hashMs = ms(t);
    from = replies.length;
    t = performance.now();
    await Promise.all(names.map((n) => svc.assetTile(`assets/${n}`, 'card')));
    await svc.idle();
    const tilesMs = ms(t);
    const per = replies
      .slice(from)
      .map((m) => Number(m.ms))
      .filter(Number.isFinite);
    const shots = shotsOf(from);
    let bytes = 0;
    let ok = 0;
    for (const s of shots)
      if (typeof s.jpeg === 'string') {
        ok++;
        bytes += Math.floor((s.jpeg.length * 3) / 4);
      }
    out.assetTiles = {
      pictures: names.length,
      failed: replies
        .slice(from)
        .filter((m) => m.ok !== true)
        .map((m) => `${m.error}: ${m.detail}`)
        .slice(0, 6),
      ok,
      glyph: shots.filter((s) => s.missing === true).length,
      totalMs: tilesMs,
      perTileMs: { p50: pct(per, 0.5), p95: pct(per, 0.95) },
      avgBytes: Math.round(bytes / Math.max(1, ok)),
      budget: { totalMsFor250: 30_000 },
      contentHashColdMs: hashMs,
    };
  }

  // version pictures: commit the canvas sources, edit 12 canvases, picture the committed version
  if (!flag('--skip-versions')) {
    const git = async (...a: string[]) => {
      const p = Bun.spawn(['git', '-C', root, ...a], {
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'bench',
          GIT_AUTHOR_EMAIL: 'bench@example.invalid',
          GIT_COMMITTER_NAME: 'bench',
          GIT_COMMITTER_EMAIL: 'bench@example.invalid',
        },
      });
      const text = await new Response(p.stdout).text();
      if ((await p.exited) !== 0)
        throw new Error(`git ${a[0]}: ${await new Response(p.stderr).text()}`);
      return text.trim();
    };
    if (!existsSync(path.join(root, '.git'))) await git('init', '-q');
    const rows = index
      .snapshot()
      .canvases.filter((c) => c.artboards.length > 0)
      .slice(0, 12);
    const rels = rows.map((c) => c.rel);
    // V2-1.9's shape: a version row pictures one named artboard (its most-changed), row size
    const boardOf = new Map(rows.map((c) => [c.rel, c.artboards[0]?.id ?? null]));
    await git('add', '--', ...rels.map((r) => `.design/${r}`));
    await git('commit', '-qm', 'bench: versions', '--allow-empty');
    const sha = await git('rev-parse', 'HEAD');
    const originals = new Map(rels.map((r) => [r, readFileSync(path.join(designRoot, r), 'utf8')]));
    try {
      for (const r of rels)
        writeFileSync(path.join(designRoot, r), `${originals.get(r)}\n// bench edit\n`);
      index.update(rels);
      const pass = async () => {
        const f = replies.length;
        const t = performance.now();
        await Promise.all(
          rels.map((r) =>
            svc.thumb({
              canvas: r,
              artboard: boardOf.get(r) ?? null,
              size: 'row',
              at: { sha },
              priority: 'visible',
            })
          )
        );
        await svc.idle();
        const per = replies
          .slice(f)
          .map((m) => Number(m.ms))
          .filter(Number.isFinite);
        return {
          totalMs: ms(t),
          jobs: per.length,
          perPictureMs: { p50: pct(per, 0.5), p95: pct(per, 0.95) },
        };
      };
      const cold = await pass();
      rmSync(thumbsDir(pid), { recursive: true, force: true });
      await Bun.sleep(10_000); // a fresh ≤ 12 / 10 s window
      const warm = await pass();
      out.versionPictures = {
        canvases: rels.length,
        coldBuild: cold,
        warmBuild: warm,
        budget: { p50: 300, p95: 800 },
      };
    } finally {
      for (const [r, text] of originals) writeFileSync(path.join(designRoot, r), text);
      index.update(rels);
    }
  }
  svc.stop();
} finally {
  server.kill();
  await server.exited;
  index.stop();
  rmSync(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 2));
