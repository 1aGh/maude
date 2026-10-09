// Exp D — subject framing for linked formats (vertical 1080×1920 source → 1:1, 4:5, 16:9 Fill, 2× punch-in).
// Truth: subject centre hand-labelled at 2 fps on the real Alligators clips (contact sheets in out/expD).
// Methods: centre crop · AI-seeded keyframes at the real smart-frames (ffmpeg tier) times, interpolated ·
//          a person's keyframe every 1 s · ffmpeg frame-difference motion centroid (the cheapest "tracker").
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { MEDIA, OUT, r3 } from './lib.mjs';

// [t, x, y] at 2 fps — hand labels from the gridded sheets (x, y as fractions of the source frame)
const LABELS = {
  '25c450fb': [[0.5, 0.5], [0.47, 0.5], [0.4, 0.5], [0.35, 0.45], [0.28, 0.43], [0.28, 0.42], [0.33, 0.5], [0.44, 0.52], [0.76, 0.58], [0.67, 0.52], [0.49, 0.5], [0.27, 0.53], [0.56, 0.48]],
  '3f5fd5f3': [[0.46, 0.5], [0.46, 0.5], [0.46, 0.5], [0.46, 0.5], [0.43, 0.49], [0.4, 0.42], [0.26, 0.45], [0.16, 0.55], [0.22, 0.55], [0.42, 0.58], [0.83, 0.6], [0.65, 0.5], [0.39, 0.48], [0.34, 0.48], [0.44, 0.45], [0.57, 0.43], [0.57, 0.44], [0.57, 0.44], [0.56, 0.47], [0.54, 0.47]],
  c3619ca5: [[0.63, 0.65], [0.62, 0.66], [0.58, 0.77], [0.51, 0.6], [0.4, 0.72], [0.44, 0.7], [0.51, 0.7], [0.65, 0.72]],
  '381b5d7c': [[0.62, 0.45], [0.56, 0.58], [0.42, 0.72], [0.42, 0.55], [0.62, 0.4], [0.79, 0.43], [0.92, 0.4], [0.7, 0.55], [0.37, 0.55], [0.49, 0.46], [0.49, 0.43], [0.27, 0.38], [0.28, 0.55], [0.28, 0.58], [0.79, 0.42], [0.59, 0.39], [0.57, 0.43], [0.72, 0.44]],
};
const SRC_W = 1080, SRC_H = 1920;
// crop window as fractions of the source frame (Fill)
const FORMATS = {
  '1:1': { w: 1, h: 1080 / 1920 },
  '4:5': { w: 1, h: 1350 / 1920 },
  '16:9 fill': { w: 1, h: 607.5 / 1920 },
  '2x punch-in': { w: 0.5, h: 0.5 },
};
const MARGIN = 0.8; // the subject centre must sit inside the central 80 % of the crop

const interp = (keys, t) => {
  if (t <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
    const [t0, x0, y0] = keys[i - 1], [t1, x1, y1] = keys[i];
    const a = (t - t0) / (t1 - t0 || 1);
    return [x0 + a * (x1 - x0), y0 + a * (y1 - y0)];
  }
  return keys[keys.length - 1].slice(1);
};
const labelAt = (lab, t) => interp(lab.map(([x, y], i) => [i * 0.5, x, y]), t);

function inFrame([fx, fy], [sx, sy], f) {
  // clamp the crop centre so the window stays inside the source (what a real crop does)
  const cx = Math.min(1 - f.w / 2, Math.max(f.w / 2, fx));
  const cy = Math.min(1 - f.h / 2, Math.max(f.h / 2, fy));
  return Math.abs(sx - cx) <= (f.w / 2) * MARGIN && Math.abs(sy - cy) <= (f.h / 2) * MARGIN;
}

/** Motion centroid: frame differences at 10 fps on 54×96 grey, centroid of |diff| above the 90th pct, EMA-smoothed. */
function motionTrack(id) {
  const W = 54, H = 96, FPS = 10;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', `${MEDIA}/clips/${id}.mp4`, '-vf', `fps=${FPS},scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
  const buf = r.stdout;
  const n = Math.floor(buf.length / (W * H));
  const keys = [];
  let ex = 0.5, ey = 0.5;
  for (let f = 1; f < n; f++) {
    const d = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) d[i] = Math.abs(buf[f * W * H + i] - buf[(f - 1) * W * H + i]);
    const thr = [...d].sort((a, b) => a - b)[Math.floor(0.9 * d.length)];
    let sx = 0, sy = 0, sw = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = d[y * W + x]; if (v > thr) { sx += v * x; sy += v * y; sw += v; } }
    if (sw > 0) { ex = 0.7 * ex + 0.3 * (sx / sw / W); ey = 0.7 * ey + 0.3 * (sy / sw / H); }
    keys.push([f / FPS, ex, ey]);
  }
  return keys;
}

const methods = {
  centre: () => () => [0.5, 0.5],
  'AI keyframes @ smart-frames times': (id, lab) => {
    const sf = JSON.parse(readFileSync(`${OUT}/expD/sf-${id}.json`, 'utf8'));
    const keys = sf.frames.map((f) => [f.t, ...labelAt(lab, f.t)]); // a perfect vision read at each keyframe
    return (t) => interp(keys, t);
  },
  'person: keyframe every 1 s': (id, lab) => {
    const keys = [];
    for (let t = 0; t <= (lab.length - 1) * 0.5 + 1e-9; t += 1) keys.push([t, ...labelAt(lab, t)]);
    return (t) => interp(keys, t);
  },
  'motion centroid (ffmpeg diff)': (id) => {
    const keys = motionTrack(id);
    return (t) => interp(keys, t);
  },
};

const rows = [];
const totals = {};
for (const [m, mk] of Object.entries(methods)) {
  const row = { method: m };
  for (const [fname, f] of Object.entries(FORMATS)) {
    let ok = 0, n = 0;
    for (const [id, lab] of Object.entries(LABELS)) {
      const at = mk(id, lab);
      lab.forEach(([x, y], i) => { n++; if (inFrame(at(i * 0.5), [x, y], f)) ok++; });
    }
    row[fname] = r3(ok / n);
  }
  rows.push(row);
}
console.log(`Subject kept in frame (centre inside the central ${MARGIN * 100} % of the crop), ${Object.values(LABELS).reduce((a, l) => a + l.length, 0)} labelled frames, 4 clips`);
console.table(rows);
