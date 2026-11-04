'use client';

// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
// The headline is a selected text layer on the canvas. Ask Maude for a rewrite and it plays a short
// scripted AI run on it; ⌘Z puts the first one back. The first state is real server-rendered <h1>
// text, so search engines and no-JS visitors get the final headline; this island hydrates over it.
import { Fragment, useEffect, useRef, useState } from 'react';
import { at, T } from './clock';
import { Spark } from './kit/glyphs';
import { Kbd } from './kit/people';
import { useWeightBubble } from './use-weight-bubble';

type Head = { id: string; ask: string; lang?: string; lines: { t: string; quiet?: boolean }[] };

export const HEADS: Head[] = [
  {
    id: 'start',
    ask: '',
    lines: [
      { t: 'You like Figma.', quiet: true },
      { t: 'You like Claude.', quiet: true },
      { t: 'Meet Maude.' },
    ],
  },
  {
    id: 'bold',
    ask: 'Make it bolder',
    lines: [{ t: 'Design with AI.' }, { t: 'Own every pixel.', quiet: true }],
  },
  {
    id: 'mum',
    ask: 'Say it so my mum gets it',
    lines: [
      { t: 'Draw it yourself.', quiet: true },
      { t: 'Or just ask.', quiet: true },
      { t: "Either way, it's real." },
    ],
  },
  {
    id: 'cs',
    ask: 'Now in Czech',
    lang: 'cs',
    lines: [
      { t: 'Líbí se ti Figma.', quiet: true },
      { t: 'Líbí se ti Claude.', quiet: true },
      { t: 'Tohle je Maude.' },
    ],
  },
];

/**
 * One headline line. Until a pointer shows up it is plain text, so the h1 reads (and indexes) as
 * the headline exactly once. Once a mouse or pen is over it, it is split into letters for the
 * weight bubble; the letters are the same text, not a second copy.
 */
function BubbleLine({ text, split }: { text: string; split: boolean }) {
  if (!split) return <>{text}</>;
  return (
    <>
      {Array.from(text).map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: letters of a fixed string never reorder
        <span key={i} className="ps-ch">
          {c}
        </span>
      ))}
    </>
  );
}

const NOTE_ID = 'ps-demo-note';

export function HeroHeadline() {
  const [ver, setVer] = useState(0);
  const [gen, setGen] = useState(0);
  const [byAI, setByAI] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  // Letters exist only after a pointer has been over the headline; a rewrite puts plain text back.
  const [split, setSplit] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const ask = (i: number) => {
    if (busy !== null || i === ver) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setBusy(i);
    timer.current = window.setTimeout(
      () => {
        setVer(i);
        setGen((g) => g + 1);
        setSplit(false);
        setByAI(true);
        setBusy(null);
      },
      still ? 0 : 1500
    );
  };
  const undo = () => {
    if (busy !== null || ver === 0) return;
    setVer(0);
    setGen((g) => g + 1);
    setSplit(false);
    setByAI(false);
  };
  // ⌘Z / Ctrl+Z puts the first headline back, like the app does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        const t = e.target as HTMLElement | null;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (ver === 0 || busy !== null) return;
        e.preventDefault();
        undo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const h = HEADS[ver];
  const first = [T.line1, T.line2, T.line3];
  const bubble = useWeightBubble();
  const onPointerMove: typeof bubble.onPointerMove = (e) => {
    if (e.pointerType !== 'touch') setSplit(true);
    bubble.onPointerMove(e);
  };
  return (
    <div className="ps-play">
      <div
        className="ps-layer ps-bubble"
        data-busy={busy !== null ? 'true' : undefined}
        {...bubble}
        onPointerMove={onPointerMove}
      >
        <i />
        <i />
        <i />
        <i />
        <span className="ps-layer-scan" aria-hidden="true" />
        <span
          className="ps-layer-tag ps-a ps-a--pop"
          data-ai={busy !== null || byAI ? 'true' : undefined}
          style={at(T.spark)}
          aria-hidden="true"
        >
          {busy !== null ? (
            <>
              <Spark size={10} color="currentColor" /> AI is rewriting
              <span className="ps-dots">
                <i />
                <i />
                <i />
              </span>
            </>
          ) : byAI ? (
            <>
              <Spark size={10} color="currentColor" /> Made by AI
            </>
          ) : (
            'Text · Display'
          )}
        </span>
        <h1 key={gen} id="h-home" className="ps-h1" lang={h.lang}>
          {h.lines.map((l, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines of a fixed script
            <Fragment key={j}>
              <span
                className={`${l.quiet ? 'ps-quiet ' : ''}ps-a`}
                style={{ display: 'inline-block', ...at(gen === 0 ? first[j] : j * 90) }}
              >
                <BubbleLine text={l.t} split={split} />
              </span>
              {j < h.lines.length - 1 ? (
                <>
                  {' '}
                  <br />
                </>
              ) : null}
            </Fragment>
          ))}
        </h1>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset breaks the island's flex row in Safari */}
      <div
        className="island ps-ask ps-a"
        role="group"
        aria-label="Ask Maude to rewrite the headline"
        aria-describedby={NOTE_ID}
        style={at(T.ctas + 200)}
      >
        <span className="ps-ask-lead">
          <Spark size={14} /> Ask Maude
        </span>
        {HEADS.slice(1).map((v, k) => (
          <button
            key={v.id}
            type="button"
            className="ps-ask-chip"
            aria-pressed={ver === k + 1}
            aria-disabled={busy !== null || undefined}
            onClick={() => ask(k + 1)}
          >
            {v.ask}
          </button>
        ))}
        <button
          type="button"
          className="ps-ask-undo"
          aria-label="⌘Z Undo the rewrite"
          aria-disabled={ver === 0 || busy !== null || undefined}
          onClick={undo}
        >
          <Kbd>⌘Z</Kbd>
        </button>
      </div>
      <span
        id={NOTE_ID}
        className="ps-fine"
        style={{ fontSize: 'var(--type-xs)', marginTop: 'calc(-1 * var(--space-3))' }}
      >
        A scripted demo. In the app, the AI runs on your own Claude account.
      </span>
      <span className="ps-sr" aria-live="polite">
        {busy !== null
          ? 'AI is rewriting the headline.'
          : gen > 0
            ? `New headline: ${h.lines.map((l) => l.t).join(' ')}`
            : ''}
      </span>
    </div>
  );
}
