// A produced-but-lesser export result, and the remedy for it when one exists.
//
// Its own module rather than living in `index.ts`, because `index.ts` re-exports
// every adapter (including `video.ts`) — so a test that wants `remedyFor` alone
// would pull the whole adapter graph and hit a circular-init ReferenceError.
//
// RCA `issue-mp4-audio-export-html5audio-silent-degrade`.

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
  return undefined;
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
