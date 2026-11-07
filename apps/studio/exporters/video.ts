// DDR-148 — video/animation exporter (mp4 · webm · gif).
//
// Drives bin/_video-playwright.mjs, which picks one of two capture strategies:
//   • mp4/webm of a registered video-comp — DDR-148 addendum (audio export):
//     window.__maude_render_video__ → @remotion/web-renderer's renderMediaOnWeb,
//     video+audio in one pass (Remotion owns the TransitionSeries/volume-closure
//     timeline math). `getWebRendererBundle()` supplies the in-page renderer.
//   • everything else (gif, ordinary/CSS-WAAPI artboards, or no registered
//     comp) — the original frame-step spine: steps the artboard frame-by-frame
//     via window.__maude_seek__ and encodes in-page with mediabunny (H.264/avc
//     MP4, VP9/VP8 WebM fallback) or gifenc. `getEncodeLibBundle()` supplies
//     this in-page encoder, and doubles as the render-lib path's fallback when
//     the target has no registered comp (the shim decides at runtime — see
//     _video-playwright.mjs for the exact routing condition).
// Scope is always `artboard`. No native binaries; the capture Chromium is the
// same one every other exporter already uses (DDR-041).

import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { getEncodeLibBundle, getWebRendererBundle } from './_browser-bundles.ts';
import { exportShimPath, runShim } from './_runtime.ts';
import { type ExportDegradation, hasAudioStream, remedyFor } from './degraded.ts';
import {
  canvasShellUrl,
  type ExportContext,
  type ExportHooks,
  type ExportOptions,
  type ExportResult,
} from './index.ts';
import type { Target } from './scope.ts';
import {
  audioRefusalMessage,
  scanUnsupportedMedia,
  type UnsupportedFinding,
} from './unsupported-media.ts';

/** Resolve a client-influenced canvas `file` to an absolute path inside the
 * design root, following symlinks — .tsx/.html only. Mirrors jobs.ts's guard
 * (security review F2). Returns null on any failure. */
function safeCanvasAbs(repoRoot: string, designRoot: string, file: string): string | null {
  if (!/\.(tsx|html)$/i.test(file)) return null;
  try {
    const designReal = realpathSync(path.resolve(designRoot));
    // `file` is repo-relative (carries the `.design/` prefix) — resolve against
    // repoRoot, require the realpath under designRoot.
    const abs = realpathSync(path.resolve(repoRoot, file));
    return abs === designReal || abs.startsWith(designReal + path.sep) ? abs : null;
  } catch {
    return null;
  }
}

/**
 * `options.unsupportedMedia` — the cell's pre-resolved `scanUnsupportedMedia`
 * findings for a remote job, or null when absent (local lane: scan the disk).
 * Shape-checked: it crosses the cell→worker HTTP boundary.
 */
function shippedUnsupportedMedia(options: ExportOptions): UnsupportedFinding[] | null {
  const raw = (options as { unsupportedMedia?: unknown }).unsupportedMedia;
  if (!Array.isArray(raw)) return null;
  return raw.filter(
    (f): f is UnsupportedFinding =>
      !!f &&
      typeof f === 'object' &&
      ((f as UnsupportedFinding).element === 'Audio' ||
        (f as UnsupportedFinding).element === 'OffthreadVideo') &&
      typeof (f as UnsupportedFinding).sourceFile === 'string'
  );
}

// DDR-045: resolve via DEV_SERVER_ROOT, never `import.meta.dir`. See _runtime.ts.
const VIDEO_PLAYWRIGHT = exportShimPath('_video-playwright.mjs');

type VideoFormat = 'mp4' | 'webm' | 'gif';

const CONTENT_TYPE: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  gif: 'image/gif',
};

/** Default frame ceiling — 2 min @ 30 fps. Raisable per-export via
 *  `options.maxFrames` (an editor invites longer cuts than the original 30 s
 *  cap; the flatmap RCA's real 90 s reel already violated it). A request that
 *  exceeds the resolved ceiling is REFUSED with remediation, never silently
 *  truncated. */
const DEFAULT_MAX_FRAMES = 3600;
/** Absolute backstop for `options.maxFrames` itself (10 min @ 30 fps). */
const MAX_FRAMES_CEILING = 18000;
/** Above this, the frame-step fallback path gets slow (~2.5 s/frame) and 1080p
 *  captures have died from memory pressure — warn loudly, recommend ≤720p. */
const HEAVY_FRAMES_WARNING = 900; // 30 s @ 30 fps

/** `--scale` for the capture shim: the user's 1–3× choice, or `auto` (the shim picks by artboard size). */
export function resolveScaleArg(options: Pick<ExportOptions, 'scale'>): string {
  const raw: unknown = options.scale;
  if (raw === undefined || raw === null || raw === '') return 'auto';
  const scale = clampInt(raw, 1, 3);
  return scale ? String(scale) : 'auto';
}

async function runVideo(
  format: VideoFormat,
  targets: Target[],
  options: ExportOptions,
  ctx: ExportContext,
  hooks?: ExportHooks
): Promise<ExportResult> {
  const el = targets.find((t): t is Extract<Target, { kind: 'element' }> => t.kind === 'element');
  if (!el) {
    throw new Error(
      `${format} export needs an artboard target — make the artboard a video-comp or add motion`
    );
  }

  // Pre-flight the two elements the audio renderer rejects, BEFORE launching a
  // browser (RCA issue-mp4-audio-export-html5audio-silent-degrade). This is
  // decidable from source and always fails, so discovering it 37 minutes later
  // via a muted file is pure waste. GIF is silent by format, so it is exempt.
  let preStamped: ExportDegradation | undefined;
  if (format !== 'gif' && options.allowUnsupportedMedia !== true) {
    // The scan reads the canvas SOURCE, which only the process holding the
    // checkout has. On the render worker (DDR-230: no tenant files) the read
    // fails quietly — an empty finding list — and the export went on to do
    // EXACTLY what this guard exists to prevent: renderMediaOnWeb rejected
    // <Audio>, the frame-step fallback ran ~40× slower and shipped a muted
    // file. So the cell resolves the findings up front and ships them in the
    // job (`options.unsupportedMedia`, exporters/jobs.ts), same as printProps.
    // `el.file` is client-influenced (canvasFile / selection.file). On the
    // local/in-cell lane we scan it off disk — bound to the DESIGN root,
    // realpath-checked (a `startsWith` prefix alone is escaped by an
    // in-checkout symlink), .tsx/.html only (defender W1 / attacker F2).
    const canvasAbs = safeCanvasAbs(ctx.repoRoot, ctx.designRoot, el.file);
    const findings =
      shippedUnsupportedMedia(options) ?? (canvasAbs ? scanUnsupportedMedia(canvasAbs) : []);
    for (const finding of findings) {
      if (finding.element === 'Audio' && options.audio !== false) {
        // Refuse. A vanished music bed is worse than an export that did not run.
        throw new Error(audioRefusalMessage(finding, el.file));
      }
      if (finding.element === 'OffthreadVideo') {
        // Warn, don't refuse — <OffthreadVideo> is often legitimately silent
        // b-roll, so blocking the export would be the wrong trade.
        preStamped = {
          audioDropped: true,
          reason: `<OffthreadVideo> in ${el.file} is not supported by @remotion/web-renderer`,
          remedy: remedyFor('OffthreadVideo'),
        };
      }
    }
  }

  // gif has no renderMediaOnWeb container support (and no audio need — GIF is a
  // silent format), so it never needs the render-lib bundle; mp4/webm build it
  // alongside the frame-step encode-lib (the shim decides per-target at runtime
  // whether the artboard has a registered comp to hand the renderer).
  // These Bun.build calls happen BEFORE the render shim spawns. On the headless
  // render worker a mp4 job hung here in total silence (no shim ever launched,
  // so the shim's own hard-kill never fired) — bound it so a stuck bundle build
  // FAILS with a named reason instead of eating the whole render budget.
  console.error(`[video] building bundles (format=${format})…`);
  const bundleStart = Date.now();
  const withTimeout = (p: Promise<unknown>, label: string, ms: number) =>
    Promise.race([
      p,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} did not finish within ${ms}ms`)), ms)
      ),
    ]);
  const [lib, renderLib] = (await Promise.all([
    withTimeout(getEncodeLibBundle(), 'encode-lib bundle', 90_000),
    format === 'gif'
      ? Promise.resolve(null)
      : withTimeout(getWebRendererBundle(), 'web-renderer bundle', 90_000),
  ])) as [string, string | null];
  console.error(`[video] bundles ready in ${Date.now() - bundleStart}ms`);
  const tmp = mkdtempSync(path.join(tmpdir(), 'maude-video-'));
  const outPath = path.join(tmp, `export.${format}`);

  const args = [
    VIDEO_PLAYWRIGHT,
    '--url',
    canvasShellUrl(ctx, el.file),
    '--selector',
    el.cssPath,
    '--encode-lib',
    lib,
    '--format',
    format,
    '--out',
    outPath,
    '--timeout',
    String((options.timeoutSec as number | undefined) ?? 120),
  ];
  if (renderLib) args.push('--render-lib', renderLib);
  if (el.widen) args.push('--widen', '1');
  // Ordinary artboards animate on wall-clock (WAAPI); video-comps on frame index.
  if (options.mode === 'ordinary') args.push('--mode', 'ordinary');

  // Export-with-audio (DDR-148 addendum) — default ON; only the render-lib path
  // (mp4/webm of a registered comp) can actually produce audio, but the flag is
  // harmless for the frame-step fallback (video-only, always has been).
  const wantAudio = options.audio !== false;
  args.push('--audio', wantAudio ? '1' : '0');
  // Remotion license posture — MAUDE_REMOTION_LICENSE env (config-driven, per
  // project); the shim defaults to 'free-license' when unset. Network egress
  // for web-renderer's optional telemetry is blocked at the CSP layer regardless
  // (cspForCapture's `connect-src 'self'`, http.ts) — no additional code needed
  // for the offline posture beyond passing the key through.
  if (process.env.MAUDE_REMOTION_LICENSE) {
    args.push('--license-key', process.env.MAUDE_REMOTION_LICENSE);
  }

  // Resolution multiplier (1–3×) — the artboard's native size × scale. The shim applies it as
  // deviceScaleFactor AND sizes the encoder to match. When the user passed none, `auto` makes the
  // shim measure the artboard and pick the default (1× from a 1080 px short side up, else 2× —
  // decision maude/burndown-d6-default-export-scale); the exporter cannot, it never sees the size.
  args.push('--scale', resolveScaleArg(options));

  const fps = clampInt(options.fps, 1, 60);
  if (fps) args.push('--fps', String(fps));

  const maxFrames = resolveMaxFrames(options);
  const frames = resolveFrames(options, fps, maxFrames);
  if (frames) args.push('--frames', String(frames));
  // The shim clamps its comp-meta fallback to this same ceiling (and reports
  // loudly when it has to), so raising the cap here raises it end-to-end.
  args.push('--max-frames', String(maxFrames));
  if ((frames ?? 0) > HEAVY_FRAMES_WARNING) {
    console.error(
      `⚠ long export: ${frames} frames. If the fast renderer falls back to ` +
        `frame-step capture this runs ~2.5 s/frame; scale ≤2× (≈720–1080p) is ` +
        'recommended for memory headroom.'
    );
  }

  if (format === 'gif') {
    const colors = clampInt(options.gifColors, 2, 256);
    if (colors) args.push('--gifColors', String(colors));
  }

  // Frame-step screenshot intermediate — opt-in only, default stays PNG. Task
  // 9's own measurement (ΔE2000 on a high-contrast-edge mask, post-H.264, plus
  // Task 1's telemetry showing transport owning > 30% of per-frame cost) has
  // not run yet, so nothing here flips the default on its own. GIF ignores
  // this — its own palette quantization already loses precision, so stacking
  // a lossy JPEG intermediate under it is pure downside with no measured case.
  if (options.frameFormat === 'jpeg' && format !== 'gif') {
    args.push('--frame-format', 'jpeg');
  }

  try {
    const stdoutLines = await runShim(args, {
      cwd: path.dirname(VIDEO_PLAYWRIGHT),
      signal: hooks?.signal,
      // Frame-step capture emits `MAUDE_PROGRESS {current,total}` per frame → a
      // live "N of M" progress bar in the Exports panel. This is exactly the
      // slow path (the renderMediaOnWeb-overflow fallback can run many minutes);
      // the fast one-pass renderer finishes before progress matters and reports
      // none until done (it exposes no per-frame hook) — acceptable.
      onProgress: hooks?.onProgress,
      // One line per export naming where the time actually went, and which of
      // the two capture paths ran. Previously neither was recoverable after the
      // fact — "which path did this take?" needed a dig through the desktop
      // app's stderr, if it was still there.
      onTiming: (timing) => {
        console.error(`⏱ ${format} export: ${JSON.stringify(timing)}`);
      },
    });
    const body = new Uint8Array(readFileSync(outPath));
    // The container can differ from the request (mp4 → webm fallback when the
    // browser has no H.264 encoder). Read the summary line for the real ext, and
    // for the degradation marker the shim sets when it had to fall back from the
    // renderMediaOnWeb audio path to frame-step screenshots (RCA
    // issue-video-mp4-rendermediaonweb-stack-overflow) — surfaced here so the
    // dropped audio isn't silent (job stderr / logs; a UI toast is a follow-up).
    let ext: string = format;
    // A pre-flight finding stands unless the shim reports its own, more specific
    // cause below — never let a clean-looking summary erase a known defect.
    let degraded: ExportDegradation | undefined = preStamped;
    try {
      const lastLine = stdoutLines.at(-1) ?? '{}';
      const summary = JSON.parse(lastLine) as {
        container?: string;
        degraded?: boolean;
        audioDropped?: boolean;
        fallbackReason?: string;
      };
      if (summary.container) ext = summary.container;
      if (summary.degraded) {
        const reason = summary.fallbackReason ?? 'unknown';
        console.error(
          `⚠ ${format} export degraded: the audio renderer failed ` +
            `(${reason}), so this file was captured ` +
            'frame-by-frame and has no audio.'
        );
        // This used to stop at the console.error above — the flags were parsed
        // and then dropped on the floor, so `jobs.ts` set `done` with nothing to
        // say otherwise and the user got a muted file with a green checkmark.
        // RCA issue-mp4-audio-export-html5audio-silent-degrade.
        degraded = {
          audioDropped: summary.audioDropped !== false,
          reason,
          remedy: remedyFor(reason),
        };
      }
    } catch {
      /* keep the requested ext */
    }
    // Artifact-level backstop. Everything above trusts a report; this checks the
    // bytes. The RCA's defining property was that every other signal said the
    // export was fine — so the last word belongs to the file itself.
    if (!degraded && wantAudio && format !== 'gif' && !hasAudioStream(body, ext)) {
      degraded = {
        audioDropped: true,
        reason: `the produced ${ext} has no audio track, though audio was requested`,
        remedy:
          'Check that the comp mounts <Audio>/<Video> from @remotion/media — ' +
          "elements imported from 'remotion' are dropped by the audio renderer.",
      };
      console.error(`⚠ ${format} export produced no audio track despite audio being requested.`);
    }

    return {
      filename: `${el.canvasSlug}.${ext}`,
      contentType: CONTENT_TYPE[ext] ?? 'application/octet-stream',
      body,
      degraded,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Coerce an option to an int within [lo, hi], or undefined when absent/invalid. */
function clampInt(raw: unknown, lo: number, hi: number): number | undefined {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return undefined;
  return Math.max(lo, Math.min(hi, n));
}

/** The frame ceiling for this export: `options.maxFrames` (clamped to the
 *  absolute backstop) or the raised default. */
function resolveMaxFrames(options: ExportOptions): number {
  return clampInt(options.maxFrames, 1, MAX_FRAMES_CEILING) ?? DEFAULT_MAX_FRAMES;
}

/** Resolve the frame count from options (frames | durationMs×fps). A request
 *  over the ceiling is REFUSED with remediation — never silently truncated. */
function resolveFrames(
  options: ExportOptions,
  fps: number | undefined,
  maxFrames: number
): number | undefined {
  const explicit = clampInt(options.frames, 1, MAX_FRAMES_CEILING);
  const durationMs = Number(options.durationMs);
  const fromDuration =
    Number.isFinite(durationMs) && durationMs > 0 && fps
      ? Math.max(1, Math.round((durationMs / 1000) * fps))
      : undefined;
  const requested = explicit ?? fromDuration;
  if (requested != null && requested > maxFrames) {
    throw new Error(
      `export of ${requested} frames exceeds the ${maxFrames}-frame cap — ` +
        'pass options.maxFrames to raise it (long exports can take minutes and real memory)'
    );
  }
  if (requested != null) return requested;
  // No hint → the shim falls back to the in-page comp meta (durationInFrames),
  // clamped to the --max-frames ceiling we pass it (loudly, never silently).
  return undefined;
}

export const mp4 = {
  run: (t: Target[], o: ExportOptions, c: ExportContext, h?: ExportHooks) =>
    runVideo('mp4', t, o, c, h),
};
export const webm = {
  run: (t: Target[], o: ExportOptions, c: ExportContext, h?: ExportHooks) =>
    runVideo('webm', t, o, c, h),
};
export const gif = {
  run: (t: Target[], o: ExportOptions, c: ExportContext, h?: ExportHooks) =>
    runVideo('gif', t, o, c, h),
};
