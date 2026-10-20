// client/v2/timeline/advanced/cut-as-code.jsx — S7.18: "The cut as code" (07 ve-advanced, 06 ad-timeline).
//
// EDL | Code, in mono, read-only: the selected clip as an edit-list entry (derived from what the video says, so a
// cut that never had an `.edl.json` still reads), or the TSX of the component it plays (the canvas source,
// which needs the same role as the code view — Can comment and up). "Open in code view" hands the whole canvas
// to the code island (S11.7). Nothing here writes.

import { useEffect, useState } from 'react';
import { requestViewCode } from '../../code/code-bus.js';
import { fetchCanvasSource } from '../../code/use-canvas-source.js';
import { componentWindow } from '../../../../video/keyframes.ts';
import { ADV_WORDS, edlEntry, edlSlug, edlText } from './model.js';

const MAX_CODE_LINES = 18;
const SEG = [
  { id: 'edl', label: 'EDL' },
  { id: 'code', label: 'Code' },
];

/** The first lines of a component's source (from the start of its line), `…` when there is more. */
export function codeExcerpt(source, component) {
  const w = componentWindow(source, component);
  if (!w) return null;
  const lineStart = source.lastIndexOf('\n', w.offset - component.length) + 1;
  const lines = source.slice(lineStart, w.offset + w.text.length).split('\n');
  const body = lines.slice(0, MAX_CODE_LINES);
  return lines.length > MAX_CODE_LINES ? `${body.join('\n')}\n…` : body.join('\n');
}

/**
 * @param {{ canvas: string|null, seq: object|null, fps: number, canRead: boolean, fetchImpl?: typeof fetch,
 *   open?: (req: {canvas: string|null}) => void }} p
 */
export function CutAsCode({ canvas, seq, fps, canRead, fetchImpl, open = requestViewCode }) {
  const [mode, setMode] = useState('edl');
  const [code, setCode] = useState(null); // { status, text }
  const slug = edlSlug(canvas);
  const label = seq?.label ?? null;
  // is there a written `<slug>.edl.json`? (the route answers `{}` for none) — only then is its name said
  const [edlFile, setEdlFile] = useState(false);
  useEffect(() => {
    if (!slug) return undefined;
    let live = true;
    const get = fetchImpl ?? ((...a) => fetch(...a));
    Promise.resolve(get(`/_api/footage?slug=${encodeURIComponent(slug)}`))
      .then((r) => (r.ok ? r.json() : {}))
      .then((j) => live && setEdlFile(!!j && typeof j === 'object' && Object.keys(j).length > 0))
      .catch(() => live && setEdlFile(false));
    return () => {
      live = false;
    };
  }, [slug, fetchImpl]);

  useEffect(() => {
    if (mode !== 'code' || !canvas || !canRead) return undefined;
    let live = true;
    setCode(null);
    fetchCanvasSource(canvas, fetchImpl ? { fetchImpl } : undefined).then((r) => {
      if (!live) return;
      if (r.status !== 'ok') return setCode({ status: r.status, text: '' });
      setCode({ status: 'ok', text: (label && codeExcerpt(r.source, label)) || '' });
    });
    return () => {
      live = false;
    };
  }, [mode, canvas, canRead, label, fetchImpl]);

  const entry = edlEntry(seq, { fps });
  let body = '';
  if (mode === 'edl') body = entry ? edlText(entry) : ADV_WORDS.noClip;
  else if (!canRead) body = ADV_WORDS.readOnlyCode;
  else if (!label) body = ADV_WORDS.noClip;
  else if (!code) body = '…';
  else if (code.status === 'view-only' || code.status === 'refused') body = ADV_WORDS.readOnlyCode;
  else body = code.text || ADV_WORDS.noClip;

  return (
    <section className="tla-sec" data-testid="timeline-cut-as-code">
      <h3 className="tla-h">
        {ADV_WORDS.cutAsCode}
        <span className="tla-seg" role="group" aria-label={ADV_WORDS.cutAsCode}>
          {SEG.map((o) => (
            <button
              key={o.id}
              type="button"
              className="tla-seg-btn"
              aria-pressed={mode === o.id}
              data-on={mode === o.id ? 'true' : undefined}
              data-testid={`timeline-cut-${o.id}`}
              onClick={() => setMode(o.id)}
            >
              {o.label}
            </button>
          ))}
        </span>
      </h3>
      <pre className="tla-code" data-testid="timeline-cut-text" tabIndex={0}>
        {body}
      </pre>
      <p className="tla-note">
        {mode === 'edl'
          ? edlFile && slug
            ? `${slug}.edl.json`
            : ADV_WORDS.derived
          : (canvas ?? '').split('/').pop()}
        {' · '}
        <button
          type="button"
          className="tla-link"
          disabled={!canvas || !canRead}
          data-testid="timeline-open-in-code"
          onClick={() => open({ canvas })}
        >
          {ADV_WORDS.openInCode}
        </button>
      </p>
    </section>
  );
}
