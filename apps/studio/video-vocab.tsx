// video-vocab.tsx — S7.5: the comp vocabulary canvas-lib exports (contract V2-1.10 §5.3, S7 Q5).
//
//   <Captions words position font highlight maxChars fixes />   the Text track, lane 1 (one per comp)
//   <Duck db attackMs releaseMs><Audio …/></Duck>             music lowered under speech
//   <Reframe focus zoom fit formats><OffthreadVideo …/></Reframe>  framing in SOURCE time
//   <Place at formats>…</Place>                                a title's position per format
//
// Literal props only — the Timeline enumerator and the inspector read them as text (DDR-150's
// two-tokenizer rule) and `maude design check` holds the shapes (check/video.ts).
//
// DERIVED DATA IS INJECTED AT BUILD, NEVER WRITTEN TO THE FILE (§5.3). The canvas build
// (video/inject.ts) adds `__words` to each <Captions> and `__speech` to each <Duck>, computed from
// the enclosing comp's clips × the transcripts of their sources. A trim, split, move or speed change
// therefore re-derives the captions and the dip on the next build, with no write to the file. A
// build older than this module has none of these exports: the canvas then fails with "This canvas
// uses Maude 2" (V2-1.12 §5.8, `canvasFormatLine`).
//
// The canvas iframe is untrusted (DDR-054) and its graph may reach no npm package outside the runtime
// externals: this file imports only `react`, `remotion` (both externals) and the pure
// ./video/framing.ts. Words are file/speech text — rendered as React children, never as markup.

import {
  Children,
  type CSSProperties,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import {
  type CaptionWordFrames,
  captionAt,
  captionGroups,
  DUCK_DEFAULTS,
  duckGain,
  type FocusKey,
  focusAt,
  msToFrames,
  placeAt,
  reframeBox,
  sourceSecond,
  type WordsAtATime,
} from './video/framing.ts';

/** `data-cd-id` (and any other `data-*`) from the props, for the root element: the inspector selects
 *  the component by it. */
function dataAttrs(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(props)) if (k.startsWith('data-')) out[k] = props[k];
  return out;
}

const FILL: CSSProperties = { position: 'absolute', inset: 0 };

// ---------------------------------------------------------------------------
// <Captions>

export interface CaptionsProps {
  /** "Words at a time": 1, 3 or a whole line (default) */
  words?: WordsAtATime;
  position?: 'top' | 'middle' | 'bottom';
  /** a token, e.g. var(--font-display) */
  font?: string;
  /** the colour of the word being spoken (a token) */
  highlight?: string;
  /** line reflow (Advanced) */
  maxChars?: number;
  /** the person's word fixes — read by the BUILD (they are already applied in `__words`) */
  fixes?: ReadonlyArray<{ src: string; at: number; text: string | null }>;
  /** @internal injected by the canvas build (video/inject.ts); never written to the file */
  __words?: ReadonlyArray<CaptionWordFrames>;
  [data: `data-${string}`]: unknown;
}

const POSITION_JUSTIFY = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const;

export function Captions(props: CaptionsProps): ReactNode {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const mode: WordsAtATime = props.words === 1 || props.words === 3 ? props.words : 'line';
  const words = props.__words;
  const groups = useMemo(
    () => (Array.isArray(words) ? captionGroups(words, mode, fps, props.maxChars) : []),
    [words, mode, fps, props.maxChars]
  );
  const now = captionAt(groups, frame);
  const position = props.position && props.position in POSITION_JUSTIFY ? props.position : 'bottom';
  return (
    <div
      {...dataAttrs(props as Record<string, unknown>)}
      data-maude-captions=""
      style={{
        ...FILL,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: POSITION_JUSTIFY[position],
        alignItems: 'center',
        padding: '6% 8%',
        boxSizing: 'border-box',
        pointerEvents: 'none',
      }}
    >
      {now ? (
        <div
          data-maude-caption-line=""
          style={{
            fontFamily: props.font ?? 'var(--font-display, system-ui, sans-serif)',
            fontSize: Math.max(16, Math.round(height * 0.055)),
            fontWeight: 700,
            lineHeight: 1.2,
            textAlign: 'center',
            color: 'var(--caption-fg, #fff)',
            textShadow: '0 2px 8px rgb(0 0 0 / 0.6)',
            maxWidth: '100%',
          }}
        >
          {now.group.words.map((w, i) => (
            <span
              key={`${w.clip}:${w.wordId}:${w.f0}`}
              data-word={w.wordId}
              style={
                i === now.active
                  ? { color: props.highlight ?? 'var(--accent, #ffd400)' }
                  : undefined
              }
            >
              {i > 0 ? ' ' : ''}
              {w.text}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// <Duck>

type VolumeProp = number | ((frame: number) => number) | undefined;

export interface DuckProps {
  /** how far the music goes down under speech, −60…0 dB */
  db?: number;
  attackMs?: number;
  releaseMs?: number;
  /** exactly ONE music <Audio> (`maude design check` holds it) */
  children?: ReactNode;
  /** @internal injected by the canvas build: speech regions in comp frames, merged and sorted */
  __speech?: ReadonlyArray<readonly [number, number]>;
}

/**
 * Lowers the volume of the one <Audio> it wraps while someone speaks. The dip is a pure function of
 * the frame (`duckGain`, DDR-148), multiplied into the <Audio>'s own `volume` (number or callback).
 * The <Audio>'s volume callback counts frames from where the bed starts, so <Duck> belongs at the
 * comp root around a bed that starts at frame 0 — the shape the Timeline and the verbs write.
 */
export function Duck(props: DuckProps): ReactNode {
  const { fps } = useVideoConfig();
  const child = Children.toArray(props.children).find(isValidElement) as
    | ReactElement<{ volume?: VolumeProp }>
    | undefined;
  if (!child) return props.children ?? null;
  const speech = Array.isArray(props.__speech) ? props.__speech : [];
  const db =
    typeof props.db === 'number' && Number.isFinite(props.db) ? props.db : DUCK_DEFAULTS.db;
  const o = {
    db: Math.max(-60, Math.min(0, db)),
    attackFrames: msToFrames(props.attackMs ?? DUCK_DEFAULTS.attackMs, fps),
    releaseFrames: msToFrames(props.releaseMs ?? DUCK_DEFAULTS.releaseMs, fps),
  };
  const base = child.props.volume;
  const volume = (f: number): number => {
    const v = typeof base === 'function' ? base(f) : typeof base === 'number' ? base : 1;
    return v * duckGain(f, speech, o);
  };
  return cloneElement(child, { volume });
}

// ---------------------------------------------------------------------------
// <Reframe>

export interface ReframeProps {
  /** [sourceSec, x, y] keys, sorted; x, y fractions of the SOURCE frame */
  focus?: ReadonlyArray<FocusKey>;
  /** ≥ 1, punch-in */
  zoom?: number;
  fit?: 'fill' | 'fit' | 'blur';
  /** per-format override of `focus`, keyed by reduced W:H ("16:9") */
  formats?: Readonly<Record<string, ReadonlyArray<FocusKey>>>;
  /** the media element of ONE clip */
  children?: ReactNode;
  [data: `data-${string}`]: unknown;
}

type MediaChildProps = {
  style?: CSSProperties;
  trimBefore?: number;
  startFrom?: number;
  playbackRate?: number;
  muted?: boolean;
  volume?: VolumeProp;
};

/** The intrinsic size of the first picture under `root` (video, img or a decoder's canvas). */
function intrinsicSize(root: HTMLElement | null): { w: number; h: number } | null {
  const el = root?.querySelector('video, img, canvas');
  if (!el) return null;
  const w =
    el instanceof HTMLVideoElement
      ? el.videoWidth
      : el instanceof HTMLImageElement
        ? el.naturalWidth
        : (el as HTMLCanvasElement).width;
  const h =
    el instanceof HTMLVideoElement
      ? el.videoHeight
      : el instanceof HTMLImageElement
        ? el.naturalHeight
        : (el as HTMLCanvasElement).height;
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * Frames one clip's media for this output: `formats["W:H"] ?? focus`, interpolated in SOURCE time
 * (holding the ends), an output-aspect window scaled by 1/zoom centred on the focus and clamped to
 * the source. Until the source size is known — and with no keys at all — it is centred (B3).
 * `fit="fit"` letterboxes, `fit="blur"` letterboxes over a blurred, muted copy.
 */
export function Reframe(props: ReframeProps): ReactNode {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const ref = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState<{ w: number; h: number } | null>(null);
  const child = Children.toArray(props.children).find(isValidElement) as
    | ReactElement<MediaChildProps>
    | undefined;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const read = () => {
      const s = intrinsicSize(root);
      if (s) setSrc((p) => (p && p.w === s.w && p.h === s.h ? p : s));
    };
    read();
    root.addEventListener('loadedmetadata', read, true);
    root.addEventListener('load', read, true);
    return () => {
      root.removeEventListener('loadedmetadata', read, true);
      root.removeEventListener('load', read, true);
    };
  });

  if (!child) return props.children ?? null;
  const fit = props.fit === 'fit' || props.fit === 'blur' ? props.fit : 'fill';
  const own = child.props.style ?? {};
  const out = { w: width, h: height };
  let media: ReactNode;
  if (fit !== 'fill') {
    media = cloneElement(child, {
      style: { ...own, ...FILL, width: '100%', height: '100%', objectFit: 'contain' },
    });
  } else {
    const trim = Number(child.props.trimBefore ?? child.props.startFrom ?? 0) || 0;
    const rate = Number(child.props.playbackRate ?? 1) || 1;
    const t = sourceSecond(frame, trim, rate, fps);
    const f = focusAt(t, props.focus, props.formats, out);
    const zoom = typeof props.zoom === 'number' && props.zoom >= 1 ? props.zoom : 1;
    let style: CSSProperties;
    if (src) {
      style = {
        position: 'absolute',
        ...reframeBox(f, src, out, zoom),
        maxWidth: 'none',
        objectFit: 'fill',
      };
    } else {
      style = { ...FILL, width: '100%', height: '100%', objectFit: 'cover' };
    }
    media = cloneElement(child, { style: { ...own, ...style } });
  }
  return (
    <div
      ref={ref}
      {...dataAttrs(props as Record<string, unknown>)}
      data-maude-reframe=""
      style={{ ...FILL, overflow: 'hidden' }}
    >
      {fit === 'blur'
        ? cloneElement(child, {
            muted: true,
            volume: 0,
            style: {
              ...own,
              ...FILL,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              filter: 'blur(24px)',
              transform: 'scale(1.1)',
            },
          })
        : null}
      {media}
    </div>
  );
}

// ---------------------------------------------------------------------------
// <Place>

export interface PlaceProps {
  /** centre anchor, fractions of the output frame */
  at?: readonly [number, number];
  /** per-format override, keyed by reduced W:H */
  formats?: Readonly<Record<string, readonly [number, number]>>;
  children?: ReactNode;
  [data: `data-${string}`]: unknown;
}

/** A title's position, per format (S7 Q5): the centre of the content sits at `formats["W:H"] ?? at`. */
export function Place(props: PlaceProps): ReactNode {
  const { width, height } = useVideoConfig();
  const at: readonly [number, number] =
    Array.isArray(props.at) && props.at.length === 2 ? props.at : [0.5, 0.5];
  const p = placeAt(
    {
      at,
      ...(props.formats ? { formats: props.formats as Record<string, [number, number]> } : {}),
    },
    { w: width, h: height }
  );
  return (
    <div
      {...dataAttrs(props as Record<string, unknown>)}
      data-maude-place=""
      style={{
        position: 'absolute',
        left: p.x,
        top: p.y,
        transform: 'translate(-50%, -50%)',
      }}
    >
      {props.children}
    </div>
  );
}
