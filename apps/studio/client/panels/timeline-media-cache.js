// timeline-media-cache.js — feature-enhanced-video-editing (Task 7).
// Client-side extraction of REAL clip visuals for the Timeline: filmstrip
// thumbnails (a hidden <video> seeked N times → canvas → JPEG dataURLs) and
// audio waveform peaks (fetch → WebAudio decodeAudioData → max-abs bins).
//
// Contract:
//   • async + cancellable-by-neglect: callers pass an onReady callback; a
//     stale generation simply ignores the result. Today's plain blocks are the
//     instant fallback while extraction runs.
//   • never blocks the scrub: extraction is queued (max 2 concurrent decodes —
//     WKWebView memory) and kicked from idle callbacks.
//   • cached in memory keyed `<src>|<bucket>` AND persisted server-side under
//     `<designRoot>/_canvas-state/timeline-media/` (per-machine runtime state,
//     DDR-115) via /_api/timeline-media.

const memory = new Map(); // key → { strip?: string[], peaks?: number[] }
const pending = new Map(); // key → Promise
let running = 0;
const queue = [];
const MAX_CONCURRENT = 2;
const THUMB_W = 160;

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    running += 1;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 40));
    idle(() => {
      job()
        .catch(() => {})
        .finally(() => {
          running -= 1;
          pump();
        });
    });
  }
}

function enqueue(fn) {
  return new Promise((resolve) => {
    queue.push(() => fn().then(resolve, () => resolve(null)));
    pump();
  });
}

/** Server-persisted cache key — the content-addressed sha8 in the asset path
 *  when present (stable across machines/paths), else a djb2 of the src. */
export function mediaCacheKey(src, bucket) {
  const sha = String(src)
    .match(/([a-f0-9]{8,})\.[a-z0-9]+$/i)?.[1]
    ?.slice(0, 12);
  if (sha) return `${sha}-${bucket}`;
  let h = 5381;
  for (let i = 0; i < src.length; i += 1) h = ((h << 5) + h + src.charCodeAt(i)) >>> 0;
  return `h${h.toString(16)}-${bucket}`;
}

async function serverGet(key) {
  try {
    const r = await fetch(`/_api/timeline-media?key=${encodeURIComponent(key)}`);
    if (!r.ok) return null;
    const j = await r.json();
    return j?.ok && j.data && typeof j.data === 'object' ? j.data : null;
  } catch {
    return null;
  }
}

function serverPut(key, data) {
  fetch(`/_api/timeline-media?key=${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(() => {});
}

/** Thumbnail bucket for a block width in px: 1 / 3 / 5 / 7 frames by zoom. */
export function stripBucket(widthPx) {
  if (widthPx < 90) return 1;
  if (widthPx < 200) return 3;
  if (widthPx < 340) return 5;
  return 7;
}

/** Hidden <video>, loaded and waited on through `loadedmetadata`/`canplay` so
 *  `.duration`/`.videoWidth`/`.videoHeight` are readable. Caller owns cleanup
 *  (`video.remove()`) once done with it. */
async function loadVideoMetadata(url, timeoutMs) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  // WKWebView refuses to decode a detached <video> in some codec paths (the
  // desktop "no filmstrips" bug) — keep it in the document, invisible, for the
  // whole extraction, and kick the load explicitly.
  video.style.cssText =
    'position:fixed;left:-9999px;top:-9999px;width:2px;height:2px;opacity:0;pointer-events:none;';
  document.body.appendChild(video);
  video.src = url;
  try {
    video.load();
  } catch {
    /* load() is best-effort */
  }
  try {
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('metadata timeout')), timeoutMs);
      const ok = () => {
        clearTimeout(to);
        res();
      };
      video.addEventListener('loadedmetadata', ok, { once: true });
      video.addEventListener('canplay', ok, { once: true });
      video.addEventListener(
        'error',
        () => rej(new Error(`video error (${video.error?.code ?? '?'})`)),
        { once: true }
      );
    });
  } catch (err) {
    video.remove();
    throw err;
  }
  return video;
}

/** Real duration (seconds) of a video/audio src, probed via a hidden <video>
 *  element — never throws, resolves null on failure so callers (e.g. the
 *  timeline drop handler) can fall back to a default duration cleanly. */
export async function probeMediaDuration(url) {
  let video;
  try {
    video = await loadVideoMetadata(url, 6000);
  } catch {
    return null;
  }
  const dur = video.duration;
  video.remove();
  return Number.isFinite(dur) && dur > 0 ? dur : null;
}

/** durationInFrames for a clip dropped on the timeline: the real probed
 *  duration when available, else a fallback (probe failure, or synthetic
 *  content with no inherent duration like a title/image). */
export function durationFramesForDrop(fps, probedSeconds, fallbackSeconds = 3) {
  const sec = Number.isFinite(probedSeconds) && probedSeconds > 0 ? probedSeconds : fallbackSeconds;
  return Math.max(1, Math.round(fps * sec));
}

async function extractStrip(url, count) {
  let video;
  try {
    video = await loadVideoMetadata(url, 8000);
  } catch (err) {
    console.warn('[timeline] filmstrip extraction failed for', url, err?.message || err);
    throw err;
  }
  const dur = video.duration;
  if (!Number.isFinite(dur) || dur <= 0) throw new Error('no duration');
  const ratio = (video.videoHeight || 9) / (video.videoWidth || 16);
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W;
  canvas.height = Math.max(2, Math.round(THUMB_W * ratio));
  const g = canvas.getContext('2d');
  const strip = [];
  try {
    for (let k = 0; k < count; k += 1) {
      const t = ((k + 0.5) / count) * dur;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('seek timeout')), 6000);
        video.addEventListener(
          'seeked',
          () => {
            clearTimeout(to);
            res();
          },
          { once: true }
        );
        video.currentTime = Math.min(dur - 0.01, Math.max(0, t));
      });
      g.drawImage(video, 0, 0, canvas.width, canvas.height);
      strip.push(canvas.toDataURL('image/jpeg', 0.55));
    }
  } catch (err) {
    // WKWebView quirk — some codecs never fire `seeked` when paused. A partial
    // strip (or a single poster frame) still beats an anonymous slab.
    if (strip.length === 0) {
      try {
        await new Promise((res, rej) => {
          if (video.readyState >= 2) {
            res();
            return;
          }
          const to = setTimeout(() => rej(new Error('data timeout')), 4000);
          video.addEventListener(
            'loadeddata',
            () => {
              clearTimeout(to);
              res();
            },
            { once: true }
          );
        });
        g.drawImage(video, 0, 0, canvas.width, canvas.height);
        strip.push(canvas.toDataURL('image/jpeg', 0.55));
      } catch {
        video.remove();
        console.warn('[timeline] filmstrip seek+poster both failed for', url, err?.message || err);
        throw err; // truly nothing extractable
      }
    }
    while (strip.length < count) strip.push(strip[strip.length - 1]);
  }
  video.removeAttribute('src');
  try {
    video.load();
  } catch {
    /* teardown */
  }
  video.remove();
  return strip;
}

async function extractPeaks(url, bins = 400) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const buf = await res.arrayBuffer();
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) throw new Error('no AudioContext');
  const ctx = new Ctor();
  try {
    const decoded = await ctx.decodeAudioData(buf);
    const data = decoded.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / bins));
    const peaks = [];
    for (let b = 0; b < bins; b += 1) {
      let max = 0;
      const start = b * step;
      const end = Math.min(data.length, start + step);
      // Sample sparsely inside the bin — full max over 10M samples is wasted work.
      const inner = Math.max(1, Math.floor((end - start) / 64));
      for (let i = start; i < end; i += inner) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
      peaks.push(Math.round(max * 100) / 100);
    }
    return peaks;
  } finally {
    ctx.close?.().catch?.(() => {});
  }
}

/** Filmstrip for a video src (resolved URL). Resolves to string[] | null. */
export function getFilmstrip(url, bucket) {
  const key = mediaCacheKey(url, `s${bucket}`);
  const hit = memory.get(key);
  if (hit?.strip) return Promise.resolve(hit.strip);
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    const cached = await serverGet(key);
    if (Array.isArray(cached?.strip)) {
      memory.set(key, { strip: cached.strip });
      return cached.strip;
    }
    const strip = await enqueue(() => extractStrip(url, bucket));
    if (!strip) return null;
    memory.set(key, { strip });
    serverPut(key, { strip });
    return strip;
  })().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

/** Waveform peaks for an audio src (resolved URL). Resolves to number[] | null. */
export function getPeaks(url) {
  const key = mediaCacheKey(url, 'peaks');
  const hit = memory.get(key);
  if (hit?.peaks) return Promise.resolve(hit.peaks);
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    const cached = await serverGet(key);
    if (Array.isArray(cached?.peaks)) {
      memory.set(key, { peaks: cached.peaks });
      return cached.peaks;
    }
    const peaks = await enqueue(() => extractPeaks(url));
    if (!peaks) return null;
    memory.set(key, { peaks });
    serverPut(key, { peaks });
    return peaks;
  })().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

/** Build the SVG path for a peak array in a 100×12 viewBox (mirrored wave). */
export function peaksToPath(peaks) {
  if (!peaks?.length) return '';
  const n = peaks.length;
  const top = [];
  const bottom = [];
  for (let i = 0; i < n; i += 1) {
    const px = (i / (n - 1)) * 100;
    const a = Math.max(0.04, Math.min(1, peaks[i])) * 5;
    top.push(`${px.toFixed(2)} ${(6 - a).toFixed(2)}`);
    bottom.unshift(`${px.toFixed(2)} ${(6 + a).toFixed(2)}`);
  }
  return `M${top.join(' L')} L${bottom.join(' L')} Z`;
}
