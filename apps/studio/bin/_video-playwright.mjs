// _video-playwright.mjs — DDR-148 deterministic video/animation capture shim.
//
// The export counterpart to _png-playwright.mjs. Two capture strategies:
//
//   1. WHOLE-COMP RENDER (DDR-148 addendum, audio export) — mp4/webm export of
//      an artboard with a registered VideoComp goes through
//      window.__maude_render_video__ (video-comp.tsx bridge → the injected
//      render-lib's renderMediaOnWeb). Remotion renders video+audio in ONE
//      pass, owning the TransitionSeries offset math and <Audio volume={fn}>
//      closures internally — no hand-rolled frame loop, no separate mixing.
//   2. FRAME-STEP CAPTURE (original DDR-148 spine) — everything else: gif
//      (no audio, no renderMediaOnWeb container support), ordinary
//      (non-comp/CSS-WAAPI) artboards, and the fallback when no VideoComp is
//      registered on the target artboard. Steps the artboard frame-by-frame
//      via window.__maude_seek__, screenshots each frame, encodes in-page via
//      mediabunny/gifenc (video-encode-lib.ts). A video-comp is deterministic
//      BY CONSTRUCTION (Remotion's useCurrentFrame + the seek bridge), so two
//      capture runs to frame N are pixel-identical.
//
// Seek model (path 2 only):
//   • video-comp artboard → window.__maude_seek__(frame) (Player frame prop).
//   • ordinary artboard  → time-based: document.getAnimations() currentTime +
//     every <video>.currentTime, awaiting `seeked`. Selected by --mode.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  addScriptCspSafe,
  assertRenderOutputSizeOk,
  launchChromium,
  newShellContext,
} from './_pw-launch.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, all) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), all[i + 1] ?? '1']);
    return acc;
  }, [])
);

const {
  url,
  artboard, // data-dc-screen id to capture (default: first artboard)
  selector: selectorArg, // explicit CSS selector (overrides --artboard); from the export target
  fps: fpsArg,
  frames: framesArg,
  'dump-frames': dumpDir,
  'encode-lib': encodeLib, // path to the bundled in-page frame encoder (mediabunny/gifenc)
  'render-lib': renderLib, // path to the bundled in-page whole-comp renderer (renderMediaOnWeb)
  format, // 'mp4' | 'webm' | 'gif' — enables the encode sink (with --out)
  out, // encoded file destination
  mode = 'comp', // 'comp' | 'ordinary'
  audio, // '1' | '0' — include audio in the render-lib path (default on; presence-checked below)
  'frame-format': frameFormatArg, // 'jpeg' | 'png' (default) — the frame-step screenshot intermediate, Task 9
  'license-key': licenseKeyArg,
  timeout = '60',
  scale = '1',
  'max-frames': maxFramesArg, // frame ceiling (exporters/video.ts resolveMaxFrames)
} = args;

if (!url) {
  console.error(
    'usage: _video-playwright.mjs --url <shell-url> [--artboard <id>] [--fps N] [--frames N] --dump-frames <dir>'
  );
  process.exit(2);
}

const timeoutMs = Number(timeout) * 1000;
const deviceScaleFactor = Math.max(1, Math.min(4, Number(scale) || 1));

// Hard self-kill — the whole shim, not just individual Playwright calls, has a
// wall-clock ceiling. `launchChromium` has NO timeout, and on headless Linux
// `--enable-gpu` can hang Chromium at GPU-process init before a single log line
// — a silent wedge that ate the full 600s render budget with nothing to show.
// This guarantees the process EXITS with a diagnostic instead of hanging, so
// the render worker (and the export gate) fail fast and legibly. Generous
// enough for a slow software encode; well under any job/test budget.
const HARD_KILL_MS = Math.max(timeoutMs, 150_000);
const hardKill = setTimeout(() => {
  console.error(
    `_video-playwright: HARD TIMEOUT after ${HARD_KILL_MS}ms — exiting. The render did not ` +
      `complete (see the last stage logged above; on headless Linux this is usually the video ` +
      `encoder or GPU init). gpu=${process.env.MAUDE_CAPTURE_GPU === '1' ? 'on' : 'off'}.`
  );
  process.exit(7);
}, HARD_KILL_MS);
hardKill.unref?.();
// `--audio` is presence-checked (Object.fromEntries maps a bare flag to '1'), so
// absence of the flag entirely (not passed) still defaults to audio ON — video.ts
// always passes an explicit '0'/'1'.
const wantAudio = audio !== '0';
const licenseKey = licenseKeyArg || 'free-license';
// Task 9 — opt-in JPEG frame-step intermediate; unrecognized/absent value is PNG.
const frameFormat = frameFormatArg === 'jpeg' ? 'jpeg' : 'png';

/** Wait a real turn of the event loop + a frame so a seek settles before shot. */
const SETTLE_MS = 16;

/**
 * Run a `page.evaluate` with a hard wall-clock cap. A `page.evaluate` awaits its
 * in-page promise with NO Playwright timeout, so a WebCodecs encoder that never
 * resolves (headless Linux without a working encoder) hangs the whole render
 * indefinitely. This races the evaluate against a timer and throws a NAMED
 * error on overrun, so the shim exits (fail-fast + diagnostic) instead of
 * wedging the render worker until the job timeout.
 */
async function evalWithTimeout(page, fn, arg, ms, stage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `encode stage "${stage}" did not resolve within ${ms}ms — headless WebCodecs ` +
              `likely has no working video encoder (see the "webcodecs caps" line above).`
          )
        ),
      ms
    );
  });
  try {
    return await Promise.race([page.evaluate(fn, arg), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// GPU opt-in, measured not assumed (2026-08-09, M-series mac, 1920x1080):
//
//   config                        h264 prefer-hardware   png        jpeg q90
//   headless-shell (default)      FALSE                  51ms/187KB 33ms/43KB
//   headless-shell --enable-gpu   true                   34ms/84KB  33ms/43KB
//   full chromium / real Chrome   true                   34-49ms    17-33ms
//
// So today's engine is the ONE configuration that cannot reach a hardware
// encoder at all — `chrome-headless-shell` forces ANGLE/SwiftShader, and
// Chromium then reports ACCELERATED_VIDEO_ENCODE as disabled. `--enable-gpu`
// flips that.
//
// It is NOT on by default, deliberately: with the GPU the same page rasterizes
// to a materially different PNG (84KB vs 187KB), i.e. it is a VISUAL change to
// every export, and encode is not the bottleneck anyway (~50ms of a ~1050ms
// frame — see the MAUDE_TIMING line). Changing how a design tool renders is not
// something to smuggle in behind a perf flag. Opt in with MAUDE_CAPTURE_GPU=1.
const gpuArgs =
  process.env.MAUDE_CAPTURE_GPU === '1' ? ['--enable-gpu', '--ignore-gpu-blocklist'] : [];
console.error(
  `_video-playwright: launching chromium (gpu=${gpuArgs.length ? 'on' : 'off'}, format=${format})`
);
const browser = await launchChromium(gpuArgs.length ? { args: gpuArgs } : undefined);
console.error('_video-playwright: browser launched');
try {
  // gate-b-c4d — confined to the origin the shell lands on (popups, other origins refused).
  const { ctx, goto: gotoShell } = await newShellContext(browser, {
    serviceWorkers: 'block',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor,
  });
  const page = await ctx.newPage();
  await gotoShell(page, url, { waitUntil: 'load', timeout: timeoutMs });
  await page.evaluate(() => document.fonts.ready);
  console.error('_video-playwright: page loaded');

  // UNCONDITIONAL WebCodecs capability probe — logged for every video render
  // regardless of which encode path runs, so the render worker's log always
  // names what this headless box can actually encode. This is THE fact that
  // differs between a mac dev machine and headless Linux/the cloud worker, and
  // the answer decides whether video needs a different encoder entirely. Bounded
  // so a hung isConfigSupported (seen on some headless builds) can't wedge here.
  try {
    const caps = await evalWithTimeout(
      page,
      async () => {
        const probe = async (codec) => {
          try {
            if (typeof VideoEncoder?.isConfigSupported !== 'function') return 'no-webcodecs';
            const r = await VideoEncoder.isConfigSupported({ codec, width: 320, height: 180 });
            return r?.supported ? 'yes' : 'no';
          } catch (e) {
            return `err:${e?.name || 'x'}`;
          }
        };
        return {
          avc: await probe('avc1.42001f'),
          vp9: await probe('vp09.00.10.08'),
          vp8: await probe('vp8'),
          av1: await probe('av01.0.04M.08'),
        };
      },
      undefined,
      15_000,
      'isConfigSupported probe'
    );
    console.error(
      `_video-playwright: webcodecs caps avc=${caps.avc} vp9=${caps.vp9} vp8=${caps.vp8} av1=${caps.av1}`
    );
  } catch (e) {
    console.error(`_video-playwright: cap probe failed: ${e instanceof Error ? e.message : e}`);
  }

  // Resolve the target artboard handle. Priority: explicit --selector (from the
  // export scope Target) → --artboard id → first artboard. `--widen` climbs to
  // the enclosing [data-dc-screen] (the descendant-selector export case).
  const widen = args.widen !== undefined;
  const selector = selectorArg
    ? selectorArg
    : artboard
      ? `[data-dc-screen="${cssEscape(artboard)}"]`
      : '[data-dc-screen]';
  const located = page.locator(selector).first();
  await located.waitFor({ state: 'visible', timeout: timeoutMs });
  const handle = widen
    ? await located.evaluateHandle((el) => el.closest('[data-dc-screen]') ?? el)
    : located;

  // DDR-041 world-plane reset + pin the target artboard to (0,0) — needed by
  // both capture strategies: the frame-step path screenshots this rect; the
  // whole-comp path still benefits from a settled, non-panned layout when it
  // reads the comp's registered width/height (defensive, cheap).
  await page.evaluate(() => {
    const world = document.querySelector('.dc-world');
    if (world) {
      world.style.zoom = '1';
      world.style.transform = 'none';
    }
  });
  await handle.evaluate((el) => {
    const ab = el.closest('[data-dc-screen]') ?? el;
    ab.style.left = '0px';
    ab.style.top = '0px';
  });

  // Resolve the compId of the nearest VideoComp mounted inside the target
  // artboard (the artboard's `data-dc-screen` id and the comp's own `id` prop
  // are independent — an author rarely sets the latter — so we resolve by DOM
  // containment). Null for an ordinary/CSS artboard with no registered comp.
  const compId = await handle.evaluate(
    (el) => el.querySelector('[data-comp-id]')?.getAttribute('data-comp-id') ?? null
  );

  // Whole-comp render path: mp4/webm export of a registered video-comp. GIF has
  // no renderMediaOnWeb container support (and no audio need); an artboard with
  // no registered comp (ordinary/CSS) has nothing for renderMediaOnWeb to render
  // — both fall through to the frame-step path below.
  //
  // MAUDE_RENDER_SKIP_WHOLE_COMP=1 forces the frame-step path even for a
  // registered comp. @remotion/web-renderer's renderMediaOnWeb never RESOLVES on
  // the headless Linux render worker (measured on the cloud fleet AND CI — even
  // a 12-frame comp and even muted; WebCodecs itself works, per the caps probe,
  // so it is something in web-renderer's whole-comp pipeline that wedges). On
  // that host it only ever burned the renderMediaOnWeb timeout and then fell to
  // frame-step anyway — so the worker skips it and goes straight to the path
  // that WORKS, reclaiming those minutes for the actual (muted) render. The
  // desktop, where renderMediaOnWeb works and carries audio, leaves it on.
  const skipWholeComp = process.env.MAUDE_RENDER_SKIP_WHOLE_COMP === '1';
  const useRenderer = !skipWholeComp && !!renderLib && format !== 'gif' && !!compId;

  // When the whole-comp renderer path throws we DON'T fail the export. The most
  // common cause is a `RangeError: Maximum call stack size exceeded` from
  // @remotion/web-renderer's guardless recursive DOM precompositing on a
  // deeply-nested comp (RCA issue-video-mp4-rendermediaonweb-stack-overflow):
  // one native recursion level per nested opacity/transform/filter/mask layer,
  // no depth cap. Instead we degrade to the frame-step screenshot + mediabunny
  // path below, which goes through Chromium's native compositor and is immune to
  // that recursion. The one cost is audio — the frame-step path is video-only —
  // so a comp that overflows the audio renderer still exports, just muted. That
  // beats a hard failure with no file. `video.ts` always passes --encode-lib
  // (only --render-lib is conditional), so the fallback has all it needs here.
  let renderFallbackReason = null;

  if (useRenderer) {
    try {
      const t0 = Date.now();
      const libSrc = readFileSync(renderLib, 'utf8');
      await addScriptCspSafe(page, { content: libSrc, type: 'module', name: 'render-lib' });
      await page.waitForFunction(() => typeof window.__maudeRenderVideo__ === 'function', {
        timeout: timeoutMs,
      });

      const explicitFrames = Number(framesArg);
      const frameRange =
        Number.isFinite(explicitFrames) && explicitFrames > 0 ? [0, explicitFrames - 1] : null;

      // Bound the whole-comp render: @remotion/web-renderer drives WebCodecs,
      // which on headless Linux without a working encoder never resolves — a
      // hang, not a throw, so the graceful frame-step fallback below never
      // fires. A wall-clock cap turns that hang INTO a throw, which the catch
      // converts into exactly that fallback (frame-step, muted) — the video
      // still exports instead of wedging the render worker.
      const rendered = await evalWithTimeout(
        page,
        async ({ compId, container, scale, muted, frameRange, licenseKey }) => {
          return window.__maude_render_video__(compId, {
            container,
            scale,
            muted,
            frameRange,
            licenseKey,
          });
        },
        {
          compId,
          container: format,
          scale: deviceScaleFactor,
          muted: !wantAudio,
          frameRange,
          licenseKey,
        },
        Math.min(timeoutMs, 90_000),
        `renderMediaOnWeb(${format})`
      );

      writeFileSync(out, Buffer.from(rendered.b64, 'base64'));

      // Comp meta for the summary (diagnostic only — video.ts reads `container`).
      const compMeta = await page.evaluate(
        (id) =>
          (typeof window.__maude_comps__ === 'function' ? window.__maude_comps__() : []).find(
            (c) => c.id === id
          ) ?? null,
        compId
      );
      const frameCount = frameRange
        ? frameRange[1] - frameRange[0] + 1
        : (compMeta?.durationInFrames ?? 0);

      const result = {
        fps: compMeta?.fps ?? null,
        frameCount,
        width: Math.round((compMeta?.width ?? 0) * deviceScaleFactor),
        height: Math.round((compMeta?.height ?? 0) * deviceScaleFactor),
        out,
        bytes: rendered.bytes,
        container: rendered.container,
        codec: rendered.videoCodec,
        audioCodec: rendered.audioCodec,
      };
      const ms = Date.now() - t0;
      // Same shape as the frame-step line, so the two paths are directly
      // comparable — that comparison is the whole speed story (~45 s vs ~37 min
      // on the same canvas, per RCA issue-mp4-audio-export-html5audio-silent-degrade).
      console.log(
        `MAUDE_TIMING ${JSON.stringify({
          path: 'renderer',
          frames: frameCount,
          totalMs: ms,
          msPerFrame: Math.round((ms / Math.max(1, frameCount)) * 10) / 10,
          scale: deviceScaleFactor,
          audioCodec: rendered.audioCodec,
        })}`
      );
      console.error(
        `✓ rendered ${rendered.container}/${rendered.videoCodec}` +
          `${rendered.audioCodec ? `+${rendered.audioCodec}` : ' (muted)'} → ${out} (${rendered.bytes} B) in ${ms}ms`
      );
      console.log(JSON.stringify(result));
    } catch (err) {
      // Collapse newlines — the message carries an in-page (untrusted canvas,
      // DDR-054) error + stack, and it flows to console.error / the job's
      // persisted error, so a forged "\n[FATAL] …" line can't be injected into
      // the dev-server's stderr or the history ledger.
      renderFallbackReason = oneLine(err instanceof Error ? err.message : String(err));
      console.error(
        `⚠ renderMediaOnWeb failed (${renderFallbackReason}); falling back to ` +
          'frame-step screenshot capture — video will export WITHOUT audio'
      );
    }
  }

  // Frame-step path: the normal route for gif / ordinary / comp-less artboards
  // (useRenderer === false), AND the graceful-degradation fallback when the
  // renderer above threw (renderFallbackReason !== null).
  if (!useRenderer || renderFallbackReason !== null) {
    try {
      await frameStepCapture({
        page,
        handle,
        compId,
        fpsArg,
        framesArg,
        dumpDir,
        encodeLib,
        format,
        out,
        mode,
        deviceScaleFactor,
        timeoutMs,
        frameFormat,
        fallbackReason: renderFallbackReason,
      });
    } catch (fallbackErr) {
      // If we only reached the frame-step path because the renderer already
      // failed, surface BOTH failures so a genuine bug isn't hidden behind the
      // fallback's own error.
      if (renderFallbackReason !== null) {
        const fb = oneLine(
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
        );
        throw new Error(
          `video export failed on both paths — renderMediaOnWeb: ${renderFallbackReason}; ` +
            `frame-step fallback: ${fb}`,
          { cause: fallbackErr }
        );
      }
      throw fallbackErr;
    }
  }
} finally {
  await browser.close();
}

/**
 * Original DDR-148 frame-step + mediabunny/gifenc capture (gif, ordinary
 * artboards, and the no-registered-comp fallback). Unchanged behavior from the
 * pre-addendum shim.
 */
async function frameStepCapture({
  page,
  handle,
  compId,
  fpsArg,
  framesArg,
  dumpDir,
  encodeLib,
  format,
  out,
  mode,
  deviceScaleFactor,
  timeoutMs,
  // Task 9 — 'jpeg' | 'png' (default). Only ever affects the encode transport,
  // never a --dump-frames debug dump (that always stays lossless PNG) and
  // never gif (video.ts refuses to pass 'jpeg' through for gif).
  frameFormat = 'png',
  // Set (to the renderer's error message) only when this run is the
  // graceful-degradation fallback for a failed renderMediaOnWeb path; stamps
  // `degraded`/`audioDropped` onto the stdout summary so video.ts can warn.
  fallbackReason = null,
}) {
  const rect0 = await handle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  await page.setViewportSize({
    width: Math.max(1, Math.ceil(rect0.width)),
    height: Math.max(1, Math.ceil(rect0.height)),
  });
  await handle.evaluate((el) => {
    el.scrollIntoView({ block: 'start', inline: 'start' });
    window.scrollTo(0, 0);
  });
  const clip = await handle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(r.left)),
      y: Math.max(0, Math.floor(r.top)),
      width: Math.max(1, Math.ceil(r.width)),
      height: Math.max(1, Math.ceil(r.height)),
    };
  });

  // Resolve fps + frame count. Prefer explicit args (the exporter computes them
  // from comp meta / options); fall back to the registered comp meta in-page —
  // matched by the RESOLVED compId when the target has one (not just "the
  // first comp on the page", which mis-hit on multi-comp canvases).
  const compMeta = await page.evaluate((id) => {
    try {
      const comps = typeof window.__maude_comps__ === 'function' ? window.__maude_comps__() : [];
      if (id) return comps.find((c) => c.id === id) ?? comps[0] ?? null;
      return comps[0] ?? null;
    } catch {
      return null;
    }
  }, compId);
  const fps = Number(fpsArg) || compMeta?.fps || 30;
  // Frame ceiling so a runaway/huge comp can't spawn an unbounded screenshot
  // loop — passed by exporters/video.ts (resolveMaxFrames; raisable per-export
  // via options.maxFrames). Clamping is LOUD: a truncated export says so on
  // stderr instead of silently shipping a shorter file.
  const maxFrames = Number(maxFramesArg) > 0 ? Number(maxFramesArg) : 3600;
  const wantedFrames = Number(framesArg) || compMeta?.durationInFrames || Math.round(fps * 3); // 3 s default
  const frameCount = Math.min(maxFrames, wantedFrames);
  if (wantedFrames > maxFrames) {
    console.error(
      `⚠ _video-playwright: comp is ${wantedFrames} frames but the export cap is ` +
        `${maxFrames} — capturing only the first ${maxFrames} frames. Pass ` +
        'options.maxFrames to raise the cap.'
    );
  }
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(frameCount) || frameCount <= 0) {
    console.error('_video-playwright: could not resolve fps/frameCount (no comp meta, no args)');
    process.exit(2);
  }

  // For ordinary artboards, prime the <video> elements (await first seeked).
  if (mode === 'ordinary') {
    await page.evaluate(async () => {
      const vids = Array.from(document.querySelectorAll('video'));
      await Promise.all(
        vids.map(
          (v) =>
            new Promise((res) => {
              if (v.readyState >= 2) return res(undefined);
              v.addEventListener('loadeddata', () => res(undefined), { once: true });
              // safety timeout
              setTimeout(() => res(undefined), 2000);
            })
        )
      );
    });
  }

  // A comma operator hid the side effect here; the directory has to exist
  // before anything writes a frame into it, so the effect is the point and
  // deserves its own line.
  if (dumpDir) mkdirSync(dumpDir, { recursive: true });
  const dump = dumpDir ?? null;
  const framePaths = [];
  const t0 = Date.now();

  // Output resolution = the artboard's CSS clip × deviceScaleFactor. `clip` is in
  // CSS px, but `page.screenshot` emits deviceScaleFactor× device pixels, so the
  // encoder canvas must match the SCREENSHOT's real pixel size — otherwise every
  // frame is drawn down to the native artboard size (the "tiny resolution" bug:
  // scale was accepted but never applied to the encode). scale=2 → 960×540 comp
  // exports at 1920×1080. Even dims (H.264 requires width/height divisible by 2).
  // The video path is the ONE capture path that holds a full-resolution surface
  // across thousands of frames, and it was the only one with no output-size
  // guard — _pdf-playwright.mjs has enforced this since it existed. A scale-3
  // 1080p comp allocates ~74MB per frame here.
  assertRenderOutputSizeOk(clip.width, clip.height, deviceScaleFactor, '_video-playwright');
  const outW = Math.max(2, Math.round((clip.width * deviceScaleFactor) / 2) * 2);
  const outH = Math.max(2, Math.round((clip.height * deviceScaleFactor) / 2) * 2);

  // Encode sink (Task 6) — inject the in-page mediabunny/gifenc lib and start it.
  const encoding = !!(encodeLib && format && out);
  const isGif = format === 'gif';
  if (encoding) {
    const libSrc = readFileSync(encodeLib, 'utf8');
    await addScriptCspSafe(page, { content: libSrc, type: 'module', name: 'encode-lib' });
    await page.waitForFunction(() => typeof window.__maudeEnc === 'object', { timeout: timeoutMs });
    // Bound the encoder start: on headless Linux without a working WebCodecs
    // encoder this promise never resolves, so a wall-clock cap converts the hang
    // into a fast, diagnostic failure instead of consuming the whole render
    // budget in silence.
    const started = await evalWithTimeout(
      page,
      async ({ width, height, fps, isGif, gifColors, fmt }) => {
        if (isGif) {
          window.__maudeEnc.startGif({ width, height, fps, maxColors: gifColors });
          return { container: 'gif', codec: 'gif' };
        }
        return window.__maudeEnc.startVideo({ width, height, fps, format: fmt });
      },
      {
        width: outW,
        height: outH,
        fps,
        isGif,
        gifColors: Number(args.gifColors) || 256,
        fmt: format,
      },
      Math.min(timeoutMs, 45_000),
      `startVideo(${format})`
    );
    console.error(`encoder: ${started.container} / ${started.codec} @ ${outW}×${outH}`);
  }

  // Per-stage accumulators. "The export takes 15 minutes" was, for a long time,
  // answerable only by guessing which stage owned the second — so every
  // optimization was aimed at a suspicion. One line at the end fixes that.
  // Task 9 — a debug dump must stay lossless (it's for human inspection), and
  // gif never gets a lossy intermediate stacked under its own quantization —
  // so the knob only actually applies to a plain video encode.
  const useJpeg = frameFormat === 'jpeg' && !isGif && !dump;
  const shotFormat = useJpeg ? 'jpeg' : 'png';
  const stageMs = { seek: 0, settle: 0, screenshot: 0, encode: 0 };
  for (let f = 0; f < frameCount; f += 1) {
    const tSeek = Date.now();
    await seekFrame(page, f, fps, mode);
    stageMs.seek += Date.now() - tSeek;
    const tSettle = Date.now();
    await page.waitForTimeout(SETTLE_MS);
    stageMs.settle += Date.now() - tSettle;
    const tShot = Date.now();
    const shot = await page.screenshot(useJpeg ? { clip, type: 'jpeg', quality: 90 } : { clip });
    stageMs.screenshot += Date.now() - tShot;
    if (dump) {
      const p = join(dump, `frame-${String(f).padStart(5, '0')}.png`);
      writeFileSync(p, shot);
      framePaths.push(p);
    }
    if (encoding) {
      const tEnc = Date.now();
      const b64 = shot.toString('base64');
      await evalWithTimeout(
        page,
        async ({ b64, isGif, format }) => {
          if (isGif) return window.__maudeEnc.addGifFrame(b64);
          return window.__maudeEnc.addVideoFrame(b64, format);
        },
        { b64, isGif, format: shotFormat },
        30_000,
        `addFrame#${f}`
      );
      // NB: this stage is the double CDP crossing — the screenshot bytes go out
      // to node as base64 and straight back into the same page, to an encoder
      // that lives in that page. Its share of the total is what decides whether
      // transport work is worth doing at all.
      stageMs.encode += Date.now() - tEnc;
    }
    // Machine-readable progress (stdout) — spawnShim parses `MAUDE_PROGRESS`
    // lines → onProgress → job.progress → the live bar in the Exports panel, so
    // a long frame-step render (the renderMediaOnWeb-overflow fallback) shows
    // "N of M" instead of a static "Exporting…". Filtered out of the summary
    // stdout the exporter reads. Human log stays throttled on stderr.
    console.log(`MAUDE_PROGRESS {"current":${f + 1},"total":${frameCount}}`);
    if (f % 30 === 0) console.error(`frame ${f + 1}/${frameCount}`);
  }

  // A seek that never landed means at least one encoded frame shows the wrong
  // content. There is no way to tell WHICH from the outside and no way for the
  // user to notice, so the export dies here rather than shipping a file that
  // looks fine. Counted in-page by the seek bridge (video-comp.tsx).
  const seekFailures = await page.evaluate(() => window.__maude_seek_failures__ ?? 0);
  if (seekFailures > 0) {
    throw new Error(
      `${seekFailures} frame seek(s) never landed — the capture would contain stale ` +
        'frames. Refusing to encode. This usually means the comp failed to mount.'
    );
  }

  let result = { fps, frameCount, width: outW, height: outH, framePaths };
  // Degradation marker — this run only encodes video (no audio), so when we're
  // standing in for a failed audio renderer, tell the exporter the export is
  // degraded and audio was dropped (RCA issue-video-mp4-rendermediaonweb-stack-overflow).
  if (fallbackReason !== null) {
    result = { ...result, degraded: true, audioDropped: true, fallbackReason };
  }
  if (encoding) {
    const enc = await evalWithTimeout(
      page,
      async ({ isGif }) =>
        isGif ? window.__maudeEnc.finishGif() : window.__maudeEnc.finishVideo(),
      { isGif },
      Math.min(timeoutMs, 45_000),
      `finish(${format})`
    );
    writeFileSync(out, Buffer.from(enc.b64, 'base64'));
    result = { ...result, out, bytes: enc.bytes, container: enc.container, codec: enc.codec };
    console.error(`✓ encoded ${enc.container}/${enc.codec} → ${out} (${enc.bytes} B)`);
  }

  const ms = Date.now() - t0;
  console.error(
    `✓ captured ${frameCount} frames @ ${fps}fps (${clip.width}×${clip.height}) in ${ms}ms`
  );
  // Machine-readable, filtered out of stdoutLines by _runtime.ts (the adapters
  // parse the LAST stdout line as their summary, so this must never be it).
  console.log(
    `MAUDE_TIMING ${JSON.stringify({
      path: 'frame-step',
      frames: frameCount,
      totalMs: ms,
      msPerFrame: Math.round((ms / Math.max(1, frameCount)) * 10) / 10,
      stageMs,
      scale: deviceScaleFactor,
      out: { width: outW, height: outH },
    })}`
  );
  // stdout = machine-readable summary for the exporter.
  console.log(JSON.stringify(result));
}

/** Seek one frame via the right bridge. Resolves after the frame has painted. */
async function seekFrame(page, frame, fps, mode) {
  if (mode === 'ordinary') {
    await page.evaluate(
      async ({ frame, fps }) => {
        const ms = (frame / fps) * 1000;
        for (const a of document.getAnimations()) {
          try {
            a.pause();
            a.currentTime = ms;
          } catch {
            /* unseekable */
          }
        }
        const vids = Array.from(document.querySelectorAll('video'));
        await Promise.all(
          vids.map(
            (v) =>
              new Promise((res) => {
                const target = ms / 1000;
                if (Math.abs(v.currentTime - target) < 1e-3) return res(undefined);
                v.addEventListener('seeked', () => res(undefined), { once: true });
                v.currentTime = target;
                setTimeout(() => res(undefined), 500);
              })
          )
        );
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      },
      { frame, fps }
    );
    return;
  }
  // comp mode — the seek bridge pauses + seeks the Player and resolves post-paint.
  // It now REJECTS when a seek never lands (video-comp.tsx), instead of resolving
  // as if it had; that rejection propagates out of this evaluate and fails the
  // export, which is the point — a stale frame is a valid-looking file with the
  // wrong pixels, and no downstream check would ever catch it.
  // A comp with classic remotion <Video>/<OffthreadVideo> renders a real <video>
  // whose seek is ASYNC — 2 rAF isn't enough, so wait for every video to land on
  // its frame (`seeked` / readyState) before the screenshot, else a stale frame
  // is caught. @remotion/media's <Video> decodes to a <canvas> (no <video> tag),
  // and empirically settles within the same 2-rAF window this wait already ends
  // on (verified across mid-clip + mid-transition frames — DDR-148 addendum).
  await page.evaluate(async (frame) => {
    if (typeof window.__maude_seek__ === 'function') {
      // strict: a capture must never proceed on a seek that did not land.
      await window.__maude_seek__(frame, { strict: true });
    }
    const vids = Array.from(document.querySelectorAll('video'));
    if (vids.length) {
      await Promise.all(
        vids.map(
          (v) =>
            new Promise((res) => {
              if (v.readyState >= 2 && !v.seeking) return res(undefined);
              let done = false;
              const finish = () => {
                if (done) return;
                done = true;
                clearInterval(iv);
                res(undefined);
              };
              const iv = setInterval(() => {
                if (v.readyState >= 2 && !v.seeking) finish();
              }, 16);
              v.addEventListener('seeked', finish, { once: true });
              setTimeout(finish, 1500); // never hang a frame
            })
        )
      );
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    }
  }, frame);
}

/** Minimal CSS.escape for the data-dc-screen attribute selector. */
function cssEscape(s) {
  return String(s).replace(/["\\\]]/g, '\\$&');
}

/** Collapse CR/LF runs to a single space — used to neutralize log/ledger
 *  injection from untrusted in-page (canvas-origin, DDR-054) error text. */
function oneLine(s) {
  return String(s).replace(/[\r\n]+/g, ' ');
}
