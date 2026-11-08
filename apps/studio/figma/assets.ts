/**
 * @file       figma/assets.ts — resolving image + vector fills (DDR-216 T8).
 * @scope      apps/studio/figma/assets.ts
 * @purpose    Turn `pendingImages` / `pendingExports` into real, local,
 *             content-addressed assets — batched, capped, and through the
 *             existing gates rather than a second download path.
 *
 * @invariant  BATCH, NEVER ONE CALL PER NODE. `IMAGE_COST = 200` ⇒ ~30 req/min
 *             on the images endpoint — the tight one. Figma's own translator
 *             emitted 22 exports for a trivial 990×648 frame; a real page would
 *             be hundreds. `to-artboard`'s vector-cluster collapse is the other
 *             half of this mitigation.
 *
 * @invariant  DOWNLOADS GO THROUGH `_fetch-asset.mjs`, WITH THE FIGMA LANE'S
 *             NARROWING. The URLs `/v1/images` returns are RESPONSE-CONTROLLED
 *             — Maude did not choose them. They get the full resolved-IP gate
 *             plus a host allowlist, a pinned port, and a tight byte cap. There
 *             is no second downloader here.
 *
 * @invariant  FAIL CLOSED. A vector goes through TWO processes in TWO runtimes
 *             (node for the download, bun for the DDR-167 SVG lane). DDR-177
 *             documents that runtime-spawned helpers have shipped broken inside
 *             the packaged `.app` more than once. If the sanitize step is
 *             unavailable, the staged bytes are DELETED and the node is reported
 *             `asset-skipped` — never "we already have the bytes", which is the
 *             natural and wrong recovery.
 *
 * @invariant  DOWNLOADS STAGE OUTSIDE THE DESIGN ROOT. The caller's per-run
 *             staging directory lives under the OS temp root, never under
 *             `<designRoot>/_history/` — "gitignored" is not "not replicated",
 *             and `~/git/.stignore` excludes neither.
 *
 * @limitation ASSETS PROMOTE PER-ASSET, NOT ONCE AT THE END. `deps.promote`
 *             writes into `<designRoot>/assets/` as each download completes, so
 *             a failure on frame 7 of 60 leaves earlier assets committed while
 *             the report says the import failed. D5 asked for a single
 *             directory rename; this is N renames. Stated as a KNOWN GAP rather
 *             than described as the guarantee it is not (post-implementation
 *             review F6) — content-addressing makes the residue harmless-but-
 *             untidy (orphan assets, no wrong content), which is why it is a
 *             limitation and not a blocker.
 */

import { fetchImageUrls, MAX_IMAGE_BATCH } from './client.ts';
import type { Disposition, ImportReport } from './sanitize.ts';

/** Hosts the Figma image lane may reach. Exact-or-dotted-suffix, frozen. */
export const FIGMA_ASSET_HOSTS = Object.freeze([
  'figma.com',
  'figma-alpha-api.s3.us-west-2.amazonaws.com',
]);

/**
 * D5 — total DISTINCT assets per import (post-dedupe).
 *
 * Raised from 200 on measurement, not on request. A normal 6-page product file
 * — the live StudyFi onboarding file — carries 984 vector clusters that dedupe
 * to ~530 distinct component renders. At 200 it dropped a THIRD of the file's
 * artwork, which is not a backstop against an engineered document, it is a
 * refusal to import normal work.
 *
 * The bound that actually protects the tree is `MAX_ASSET_BYTES_PER_IMPORT`:
 * 530 icons are a few MB, while one photo-heavy board is tens. A count cap is
 * the wrong dimension for vector art and was calibrated before anyone had run
 * the thing on a real file.
 */
export const MAX_ASSETS_PER_IMPORT = 1500;
/** D5 — cumulative bytes, the cap the per-item ones do not give you. */
export const MAX_ASSET_BYTES_PER_IMPORT = 64 * 1024 * 1024;
/**
 * A UI vector export is kilobytes. The shared helper's 10 MB default was sized
 * for a hero photograph; this lane pins far below it, which is also what closes
 * the "200 assets × 10 MB = 2 GB into a replicated tree" shape.
 */
export const FIGMA_ASSET_MAX_BYTES = 2 * 1024 * 1024;
/** D11 — well below DDR-167's 5 MB, because these bytes are now REMOTE. */
export const FIGMA_SVG_MAX_BYTES = 1 * 1024 * 1024;
/** Politeness + bounded local work. */
export const MAX_CONCURRENT_DOWNLOADS = 4;

/**
 * SVGs handed to ONE `promoteSvgBatch` call.
 *
 * The DDR-167 execution canary launches a browser per call, which is why the
 * batch exists at all — a per-file promote made a real icon set a ~40-minute
 * import. But the batch runs under `agent-browser`'s fixed 20 s spawn budget
 * (`_import-asset.mjs`), so an UNBOUNDED batch trades one pathology for another:
 * at 272 frame renders the canary timed out and the caller's fail-closed rule
 * discarded every asset in one go.
 *
 * 24 is deliberately well under where it was measured to break (60 timed out;
 * the same run had previously survived 272 by luck of timing) — the cost of a
 * chunk too small is a few extra browser launches, and the cost of a chunk too
 * large is losing the chunk.
 */
export const MAX_SVG_PROMOTE_CHUNK = 24;

/**
 * Promote many staged SVGs through the shared lane, CHUNKED and with one retry,
 * failing closed per chunk. One `promoteBatch` call is one browser session, so
 * the chunk size trades browser launches against blast radius — see
 * `MAX_SVG_PROMOTE_CHUNK`. Returns one ref (or null) per input, in order.
 *
 * CHUNKED, because "fail closed for the whole batch" and "one batch for the
 * whole import" together turn a single browser timeout into total asset loss.
 * Measured on a live 6-page import: the DDR-167 execution canary spawns
 * `agent-browser` with a fixed 20 s budget (`_import-asset.mjs`), one session
 * for the whole array — at 272 frame renders it blew that budget, the promote
 * threw, and every one of the 272 became `asset-skipped`. The import still
 * exited 0, so it reported success while producing a folder of broken images.
 * Reproduced at 60 SVGs, and it reproduces WITHOUT any of the Figma-lane
 * changes, so this is the shared lane's shape, not the caller's. Fail-closed is
 * KEPT (the DDR-177 rule); what changes is the blast radius: a timeout costs
 * its own chunk, and the rest of the artwork still lands.
 *
 * ONE RETRY, because the canary's failure is measurably TRANSIENT rather than a
 * property of the input (the same lane promoted 4/4 and 24/24 but threw on 12).
 * A chunk lost to a coin-flip is a permanently broken image in a versioned
 * artifact, and a second attempt is one browser launch. Bounded at one: a lane
 * that is genuinely down must fail fast rather than retry a dozen chunks into a
 * multi-minute stall.
 */
export async function promoteSvgInChunks(
  promoteBatch: (stagedPaths: string[]) => Promise<Array<string | null>>,
  stagedPaths: readonly string[]
): Promise<Array<string | null>> {
  const refs: Array<string | null> = [];
  for (let start = 0; start < stagedPaths.length; start += MAX_SVG_PROMOTE_CHUNK) {
    const chunk = stagedPaths.slice(start, start + MAX_SVG_PROMOTE_CHUNK);
    let got: Array<string | null> | null = null;
    for (let attempt = 0; attempt < 2 && got === null; attempt += 1) {
      try {
        got = await promoteBatch(chunk);
      } catch {
        got = null;
      }
    }
    if (got === null) {
      // FAIL CLOSED: the bun-side lane being unavailable must never become
      // "we already have the bytes" (DDR-177's packaged-app failure mode).
      for (let i = 0; i < chunk.length; i += 1) refs.push(null);
      continue;
    }
    // A short return would silently shift every later ref onto the wrong
    // node — pad rather than trust the length.
    for (let i = 0; i < chunk.length; i += 1) refs.push(got[i] ?? null);
  }
  return refs;
}

export interface AssetRequest {
  nodeId: string;
  format: 'svg' | 'png';
  /** What the emitted source currently references. */
  placeholder: string;
}

/**
 * Per-call knobs for the render-first lane. Both default to the icon-export
 * behaviour, so the existing fill/vector path is byte-identical without them.
 */
export interface ResolveOptions {
  /**
   * `false` keeps real `<text>` runs in a rendered SVG instead of converting
   * them to outlines. Whole-frame renders want that — an artboard whose text is
   * curves is a picture of a screen, not a screen you can search.
   */
  outlineText?: boolean;
  /**
   * Overrides `FIGMA_SVG_MAX_BYTES`. A single icon is kilobytes, but a whole
   * rendered frame carries its raster fills inline as data URIs, so the 1 MB
   * icon ceiling would reject perfectly normal screens.
   */
  svgMaxBytes?: number;
}

/** D11 — the whole-frame ceiling. Still far under DDR-167's own 5 MB. */
export const FIGMA_RENDER_MAX_BYTES = 4 * 1024 * 1024;

export interface ResolvedAsset {
  nodeId: string;
  placeholder: string;
  /** The canvas reference path, e.g. `/assets/<sha8>.png`. */
  ref: string;
  bytes: number;
}

export interface ResolveDeps {
  /**
   * Download to a staged path under the FULL gate. Injected so this module is
   * testable without the network — the real implementation is
   * `_fetch-asset.mjs`'s `fetchAsset({ rawOut })`.
   */
  stage(url: string, outPath: string, maxBytes: number): Promise<{ bytes: number; ext: string }>;
  /**
   * Sanitize + promote a staged file into `assets/`, returning the canvas ref.
   * The real implementation routes SVG through `_import-asset.mjs`'s DDR-167
   * lane and rasters through the content-addressed write.
   */
  promote(stagedPath: string, kind: 'svg' | 'png'): Promise<{ ref: string }>;
  /**
   * Optional: promote MANY svg files in one pass. The DDR-167 execution canary
   * launches a browser per call, so a per-file promote made a real icon set a
   * ~40-minute import. When present this is used for every staged SVG; when
   * absent the per-file `promote` is, so a caller that has not been updated
   * still works.
   */
  promoteSvgBatch?(stagedPaths: readonly string[]): Promise<Array<string | null>>;
  /** Where staged bytes live — OUTSIDE the design root (D5). */
  stagingPath(nodeId: string, ext: string): string;
  /** Drop a staged file on any failure path. */
  discard(path: string): void;
}

/**
 * The caps, as ONE mutable budget for a whole import.
 *
 * They were function-locals of `resolveAssets`, which reads correctly and is
 * wrong: `importFrames` calls it once PER FRAME, so the ceiling reset every
 * frame and 60 frames reconstructed exactly the multi-GB, Syncthing-replicated
 * shape D5 says it closed — while spending a browser launch per SVG canary.
 * A budget you can only bound by asking "who owns the counter?" is not a bound
 * (post-implementation review F4).
 */
export interface AssetBudget {
  count: number;
  bytes: number;
}

export function makeAssetBudget(): AssetBudget {
  return { count: 0, bytes: 0 };
}

export interface ResolveResult {
  resolved: ResolvedAsset[];
  /** placeholder → ref, for rewriting the emitted source in one pass. */
  rewrites: Map<string, string>;
  totalBytes: number;
}

/**
 * The id to RENDER for a node — an instance renders as its component.
 *
 * Figma scopes a node inside a component instance as `I<instancePath>;<compId>`,
 * so 40 placements of one icon are 40 distinct node ids that render to
 * byte-identical SVG. Measured on a live StudyFi file: 984 vector clusters
 * across 6 pages collapsed to a small fraction once keyed this way. Without it
 * the 200-asset cap eats a real file's icon set alive, and every duplicate also
 * costs a download AND a browser canary.
 *
 * Content-addressing already dedupes on DISK; this dedupes the WORK.
 */
export function renderKey(nodeId: string): string {
  const semi = nodeId.lastIndexOf(';');
  return semi > 0 ? nodeId.slice(semi + 1) : nodeId;
}

/** Split ids into `/v1/images`-sized batches. Never one call per node. */
export function batchIds(ids: readonly string[], size = MAX_IMAGE_BATCH): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push([...ids.slice(i, i + size)]);
  return out;
}

/** Run `tasks` with bounded concurrency, preserving input order in the result. */
async function pooled<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await run(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Resolve every pending asset for one import.
 *
 * Caps are enforced BEFORE work is done where possible (asset count) and
 * during it where they cannot be (cumulative bytes) — and a cap trip is a
 * REPORTED bounded degradation (`asset-cap-reached`), not a silent stop: the
 * import continues without that asset and the summary names it.
 */
export async function resolveAssets(
  fileKey: string,
  requests: readonly AssetRequest[],
  deps: ResolveDeps,
  report: ImportReport,
  budget: AssetBudget = makeAssetBudget(),
  opts: ResolveOptions = {}
): Promise<ResolveResult> {
  const rewrites = new Map<string, string>();
  const resolved: ResolvedAsset[] = [];
  let totalBytes = 0;

  if (requests.length === 0) return { resolved, rewrites, totalBytes };

  // Dedupe by RENDER KEY first — the cap should bound distinct artwork, not
  // repeated placements of the same icon.
  const byKey = new Map<string, AssetRequest[]>();
  for (const r of requests) {
    const key = `${renderKey(r.nodeId)}:${r.format}`;
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }
  const unique = [...byKey.values()].map((group) => group[0]);

  const room = Math.max(0, MAX_ASSETS_PER_IMPORT - budget.count);
  const accepted = unique.slice(0, room);
  budget.count += accepted.length;
  for (const dropped of unique.slice(room)) {
    report.add(dropped.nodeId, 'ASSET', 'asset-cap-reached', `>${MAX_ASSETS_PER_IMPORT}`);
  }

  // ── Batched URL resolution, per format ──
  const urlByNode = new Map<string, string>();
  /** Effective format per node — an SVG that fell back to raster is tracked here. */
  const formatByNode = new Map<string, 'svg' | 'png'>();
  for (const format of ['svg', 'png'] as const) {
    const ids = accepted.filter((r) => r.format === format).map((r) => r.nodeId);
    if (ids.length === 0) continue;
    for (const batch of batchIds(ids)) {
      const { images } = await fetchImageUrls(
        fileKey,
        batch,
        format,
        2,
        opts.outlineText !== undefined ? { outlineText: opts.outlineText } : {}
      );
      for (const [nodeId, url] of Object.entries(images)) {
        if (typeof url === 'string' && url.length > 0) {
          urlByNode.set(nodeId, url);
          formatByNode.set(nodeId, format);
        }
      }
    }
  }

  // RASTER FALLBACK. Figma answers `null` — not an error — for nodes it will
  // not vectorize, and a null with no retry is an artboard whose <img> points
  // at a placeholder that never resolves: a broken image where a screen should
  // be. Ask for the same node as PNG before giving up on it.
  const missing = accepted
    .filter((r) => r.format === 'svg' && !urlByNode.has(r.nodeId))
    .map((r) => r.nodeId);
  for (const batch of batchIds(missing)) {
    const { images } = await fetchImageUrls(fileKey, batch, 'png', 2);
    for (const [nodeId, url] of Object.entries(images)) {
      if (typeof url === 'string' && url.length > 0) {
        urlByNode.set(nodeId, url);
        formatByNode.set(nodeId, 'png');
        report.add(nodeId, 'ASSET', 'asset-degraded', 'vector unavailable — rasterized');
      }
    }
  }

  // ── Bounded-concurrency download; SVG promotes are batched afterwards ──
  const stagedSvgs: Array<{ req: AssetRequest; staged: string }> = [];

  await pooled(accepted, MAX_CONCURRENT_DOWNLOADS, async (req) => {
    const url = urlByNode.get(req.nodeId);
    if (!url) {
      report.add(req.nodeId, 'ASSET', 'asset-skipped', 'figma declined to render');
      return;
    }
    if (budget.bytes >= MAX_ASSET_BYTES_PER_IMPORT) {
      report.add(req.nodeId, 'ASSET', 'asset-cap-reached', 'total bytes');
      return;
    }

    // What we ACTUALLY got, which is not always what we asked for — see the
    // raster fallback above.
    const eff = formatByNode.get(req.nodeId) ?? req.format;
    const staged = deps.stagingPath(req.nodeId, eff);
    try {
      const cap = eff === 'svg' ? (opts.svgMaxBytes ?? FIGMA_SVG_MAX_BYTES) : FIGMA_ASSET_MAX_BYTES;
      const { bytes, ext } = await deps.stage(url, staged, cap);
      // Counted HERE, not after a successful promote: bytes that crossed the
      // network and landed on disk cost the same whether the promote succeeded.
      budget.bytes += bytes;
      // The staged kind must agree with what we asked Figma to render. A
      // mismatch means the response is not what the request implied — refuse
      // rather than promote something into a versioned, peer-synced tree.
      const kindOk = eff === 'svg' ? ext === 'svg' : ext !== 'svg';
      if (!kindOk) {
        deps.discard(staged);
        report.add(req.nodeId, 'ASSET', 'asset-skipped', 'format mismatch');
        return;
      }
      if (eff === 'svg' && deps.promoteSvgBatch) {
        // Defer — one browser session for all of them beats one each.
        stagedSvgs.push({ req, staged });
        totalBytes += bytes;
        return;
      }
      const { ref } = await deps.promote(staged, eff);
      totalBytes += bytes;
      resolved.push({ nodeId: req.nodeId, placeholder: req.placeholder, ref, bytes });
      // Every placement that shares this render key gets the same asset.
      for (const sibling of byKey.get(`${renderKey(req.nodeId)}:${req.format}`) ?? [req]) {
        rewrites.set(sibling.placeholder, ref);
      }
    } catch {
      // FAIL CLOSED — including when the bun-side sanitizer is simply not
      // available in a packaged app (DDR-177). Delete the staged bytes and
      // report; never keep them and never reference them.
      deps.discard(staged);
      report.add(req.nodeId, 'ASSET', 'asset-skipped', 'download or sanitize failed');
    }
  });

  if (stagedSvgs.length > 0 && deps.promoteSvgBatch) {
    const promoteBatch = deps.promoteSvgBatch.bind(deps);
    const refs = await promoteSvgInChunks(
      promoteBatch,
      stagedSvgs.map((x) => x.staged)
    );
    for (let i = 0; i < stagedSvgs.length; i += 1) {
      const { req, staged } = stagedSvgs[i];
      const ref = refs[i];
      if (!ref) {
        deps.discard(staged);
        report.add(req.nodeId, 'ASSET', 'asset-skipped', 'sanitize refused');
        continue;
      }
      resolved.push({ nodeId: req.nodeId, placeholder: req.placeholder, ref, bytes: 0 });
      for (const sibling of byKey.get(`${renderKey(req.nodeId)}:svg`) ?? [req]) {
        rewrites.set(sibling.placeholder, ref);
      }
    }
  }

  return { resolved, rewrites, totalBytes };
}

/**
 * Rewrite placeholders in emitted source. A placeholder that never resolved is
 * left in place deliberately — the canvas shows a visibly broken image, which
 * is a far better failure than a silently-missing element, and the summary
 * already names the node.
 */
export function applyRewrites(source: string, rewrites: ReadonlyMap<string, string>): string {
  let out = source;
  for (const [placeholder, ref] of rewrites) {
    out = out.split(placeholder).join(ref);
  }
  return out;
}

/** The disposition set this module can emit — kept in sync with `sanitize.ts`.
 *  `asset-degraded` was missing here as well as from the union; both halves of
 *  the drift are closed together (DDR-219 D9). */
export const ASSET_DISPOSITIONS: readonly Disposition[] = [
  'asset-pending',
  'asset-skipped',
  'asset-cap-reached',
  'asset-degraded',
];
