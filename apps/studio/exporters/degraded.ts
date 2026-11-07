// A produced-but-lesser export result, and the remedy for it when one exists.
//
// Its own module rather than living in `index.ts`, because `index.ts` re-exports
// every adapter (including `video.ts`) — so a test that wants `remedyFor` alone
// would pull the whole adapter graph and hit a circular-init ReferenceError.
//
// RCA `issue-mp4-audio-export-html5audio-silent-degrade`.

import { PARITY_FEATURES, type ParityFeature } from './parity-check.ts';

/**
 * The file is real and the job is `done` — but it is NOT clean, and saying so
 * is the whole point.
 *
 * An mp4 export of a comp using `remotion`'s `<Audio>` (= `<Html5Audio>`, which
 * `@remotion/web-renderer` rejects outright) degrades to the video-only
 * frame-step path and ships MUTED. Before this type existed, the job reported
 * `done`, the history entry looked clean, `GET /_api/export-jobs` had no field
 * for it, and the only trace was one `console.error` in the desktop app's
 * stderr — so the artifact and its ledger entry were indistinguishable from a
 * good export. This is what makes them distinguishable.
 *
 * Audio was the first instance of that shape, not the only one: issue #116 is
 * the same failure in a different format. A PDF whose text came out as Type 3
 * fonts is downloadable, opens fine, and looks right on screen — and a print
 * shop's preflight rejects it. Both are "the file is real, the file is wrong",
 * so both ride THIS channel rather than a parallel one: the job record, the
 * history ledger, the WS emit, the pill and the completion toast are already
 * wired to it, and a second notice type would have to re-earn all five.
 *
 * Every cause flag is optional — a degradation carries the one(s) that apply.
 */
export interface ExportDegradation {
  /** The requested audio track is absent from the produced file. */
  audioDropped?: boolean;
  /**
   * Fonts a print shop's preflight will reject — Type 3 or genuinely
   * non-embedded (issue #116). Names only, already stripped of their
   * `AAAAAA+` subset prefixes; the count and the split live in `reason`.
   */
  fontsNotEmbedded?: string[];
  /**
   * Captioned clips (`assets/<sha8>.<ext>`) that have no `assets/<sha8>.transcript.json`, so the
   * comp's <Captions> had no words to show (#128 §7). Names only; the sentence is in `reason`.
   */
  captionsMissing?: string[];
  /**
   * What the video exporter cannot draw the way the preview does (#150 §4, #128 §8): one entry per
   * feature, naming the elements (`a background-image url() is not drawn — div.hero, div.camo`).
   * A warning found BEFORE the render started; the file is otherwise complete.
   */
  unsupportedFeatures?: string[];
  /** Human-readable cause, already newline-collapsed by the shim (DDR-054). */
  reason: string;
  /** One-line remedy — present only when the cause is a fixable authoring mistake. */
  remedy?: string;
}

/**
 * Turn a renderer failure into a one-line fix, when the failure IS fixable.
 *
 * `renderMediaOnWeb` supports ONLY `@remotion/media` media elements; `remotion`'s
 * `Audio` (= `Html5Audio`) and `OffthreadVideo` are both rejected with a typed
 * error that already names the remedy. This carries that remedy to where a user
 * will actually read it — the job row and the toast — instead of leaving it in a
 * log nobody opens.
 *
 * Returns undefined for causes with no honest one-liner (e.g. the DDR-157
 * recursion overflow, which is data-dependent and not the author's to fix).
 * Inventing a remedy there would be worse than silence.
 */
/**
 * Does this container actually carry an audio track?
 *
 * The last line of defence, and deliberately independent of whether the shim
 * noticed anything: the RCA's whole shape was that every OTHER signal said the
 * export was fine. If audio was asked for and the bytes don't have it, the
 * result is degraded — full stop, no matter what the renderer reported.
 *
 * Byte-scan rather than a demuxer, because the question is binary and a parser
 * dependency (or a native `ffprobe`) would cost far more than it buys:
 *  • MP4/ISOBMFF — a track's `hdlr` box names its handler type; audio is `soun`.
 *  • WebM/Matroska — audio tracks carry an `A_*` CodecID string (`A_OPUS`, …).
 *
 * Conservative by construction: an unrecognized container returns `true` (assume
 * fine) so this can never invent a degradation it cannot prove.
 */
export function hasAudioStream(body: Uint8Array, container: string): boolean {
  const ascii = (bytes: Uint8Array, needle: string): boolean => {
    const pat = new TextEncoder().encode(needle);
    outer: for (let i = 0; i + pat.length <= bytes.length; i += 1) {
      for (let j = 0; j < pat.length; j += 1) {
        if (bytes[i + j] !== pat[j]) continue outer;
      }
      return true;
    }
    return false;
  };
  if (container === 'mp4') return ascii(body, 'soun');
  if (container === 'webm') {
    return ['A_OPUS', 'A_VORBIS', 'A_AAC', 'A_MPEG'].some((c) => ascii(body, c));
  }
  return true;
}

export function remedyFor(reason: string): string | undefined {
  if (/Html5Audio/i.test(reason)) {
    return (
      "This comp imports `Audio` from 'remotion', which IS <Html5Audio> — the audio " +
      "renderer can't render it. Import { Audio } from '@remotion/media' instead."
    );
  }
  if (/OffthreadVideo/i.test(reason)) {
    return (
      'This comp uses <OffthreadVideo>, which the audio renderer rejects. Import ' +
      "{ Video } from '@remotion/media' instead — only @remotion/media elements " +
      'carry audio through the export.'
    );
  }
  // Issue #150 §1 — @remotion/web-renderer rejects with exactly this message when
  // the image it makes of an inline <svg> fails to load. It used to look like a
  // renderer bug; it is almost always the svg's own markup, and the file that
  // comes out of the frame-by-frame fallback has no audio.
  if (/Failed to convert SVG to image/i.test(reason)) {
    return (
      'An inline <svg> in this comp could not be turned into an image, so the audio ' +
      'renderer stopped. Check that svg for invalid markup, or save it as a .svg file ' +
      'with a fixed width and height and draw it with <Img>.'
    );
  }
  return undefined;
}

/** Two degradations of one job (the first run's and a retry's, or a render's and a parity note) as one: reasons joined, flags kept. */
export function mergeDegraded(
  a: ExportDegradation | undefined,
  b: ExportDegradation | undefined
): ExportDegradation | undefined {
  if (!a || !b) return a ?? b;
  const union = (x?: string[], y?: string[]): string[] => [
    ...new Set([...(x ?? []), ...(y ?? [])]),
  ];
  const fonts = union(a.fontsNotEmbedded, b.fontsNotEmbedded);
  const captions = union(a.captionsMissing, b.captionsMissing);
  const features = union(a.unsupportedFeatures, b.unsupportedFeatures);
  return {
    ...a,
    ...b,
    ...(a.audioDropped || b.audioDropped ? { audioDropped: true } : {}),
    ...(fonts.length ? { fontsNotEmbedded: fonts } : {}),
    ...(captions.length ? { captionsMissing: captions } : {}),
    ...(features.length ? { unsupportedFeatures: features } : {}),
    // a remedy is a fixable cause's one-liner: keep the first one anybody had
    ...(a.remedy || b.remedy ? { remedy: a.remedy ?? b.remedy } : {}),
    reason: [...new Set([a.reason, b.reason])].join(' '),
  };
}

const PARITY_NAMED_FEATURES = 8;
const PARITY_NAMED_ELEMENTS = 5;

/** A name that came out of the canvas page (untrusted, DDR-054): one line, no control characters, short. */
const cleanName = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  let plain = '';
  for (const ch of v) {
    const code = ch.charCodeAt(0);
    plain += code < 32 || code === 127 ? ' ' : ch;
  }
  const line = plain.replace(/\s+/g, ' ').trim();
  return line ? line.slice(0, max) : null;
};

/**
 * The degradation for a comp that uses CSS the video exporter cannot draw (#150 §4, #128 §8), from the
 * scan the capture page ran before the render. The page is the canvas author's code, so the report is
 * untrusted: only features this module knows are accepted, and every name is cleaned and capped before
 * it reaches a sentence. Never blocks — it rides the same channel as a muted file, as a warning.
 * Returns undefined when there is nothing (usable) to say.
 */
export function parityGap(raw: unknown): ExportDegradation | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const scan = raw as { artboard?: unknown; findings?: unknown };
  if (!Array.isArray(scan.findings)) return undefined;
  const entries: string[] = [];
  const hints: string[] = [];
  for (const f of scan.findings.slice(0, PARITY_NAMED_FEATURES)) {
    if (!f || typeof f !== 'object') continue;
    const feature = (f as { feature?: unknown }).feature;
    if (typeof feature !== 'string' || !Object.hasOwn(PARITY_FEATURES, feature)) continue;
    const known = PARITY_FEATURES[feature as ParityFeature];
    const names = Array.isArray((f as { elements?: unknown }).elements)
      ? ((f as { elements: unknown[] }).elements
          .slice(0, PARITY_NAMED_ELEMENTS)
          .map((n) => cleanName(n, 48))
          .filter((n) => n !== null) as string[])
      : [];
    const count = Number((f as { count?: unknown }).count);
    const more =
      Number.isFinite(count) && count > names.length
        ? ` and ${Math.floor(count) - names.length} more`
        : '';
    entries.push(names.length ? `${known.label} — ${names.join(', ')}${more}` : known.label);
    hints.push(known.hint);
  }
  if (!entries.length) return undefined;
  const board = cleanName(scan.artboard, 60);
  return {
    unsupportedFeatures: entries,
    reason: `${board ? `Artboard "${board}": the` : 'The'} video exporter cannot draw everything in this comp, so the file may differ from the preview: ${entries.join('; ')}.`,
    remedy: `To match the preview, ${[...new Set(hints)].slice(0, 3).join('; ')}. Or check the exported frames before you send it.`,
  };
}

/** At most this many assets are listed by name in the sentence (the array keeps them all). */
const CAPTION_GAP_NAMED = 5;

/**
 * The degradation for a video whose <Captions> sit over clips with no transcript sidecar (#128 §7).
 * The export is real and downloadable; its captions are silently empty, which is what this says —
 * with the asset names, because "some clip" gives a person nothing to act on.
 */
export function captionGap(assets: readonly string[]): ExportDegradation {
  const named = assets.slice(0, CAPTION_GAP_NAMED).join(', ');
  const more =
    assets.length > CAPTION_GAP_NAMED ? ` and ${assets.length - CAPTION_GAP_NAMED} more` : '';
  return {
    captionsMissing: [...assets],
    reason: `No captions for ${named}${more}: no transcript was saved for ${assets.length === 1 ? 'it' : 'them'}.`,
    remedy: 'Make captions for the clip again (Transcript panel, or `maude design transcribe`).',
  };
}
