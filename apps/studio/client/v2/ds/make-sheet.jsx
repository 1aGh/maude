// client/v2/ds/make-sheet.jsx — S10.16b: "Make a design system for <project>" (13 · ds-make-inputs).
//
// Three inputs instead of a long interview. Only the sentence is needed; the rest helps AI learn what the brand is:
//   1  Say what the brand is, in a sentence           (required — the one thing that is passed on verbatim)
//   2  Anything to learn from?  Optional              Logo · Website · Figma library · Your canvases
//   3  Mostly for                                      Websites · Apps · Print and social · A bit of everything
//
// Sheet only: it holds what was typed and says what went wrong. `onMake({ sentence, audience, refs })` is the host's
// (make-host.jsx) — it makes the outline, then sends the brief to AI — and resolves to `{ ok: true }` or
// `{ ok: false, message }`. `onLogo(file)` uploads a picked SVG and resolves to `{ ok, path?, message? }`.

import { useRef, useState } from 'react';
import { Spark } from '../ai/icons.jsx';
import { StIcon } from '../../shell/icons.jsx';
import { useModalFocus } from '../shell/modal-focus.js';
import { AUDIENCES, canMake, MAKE_WORDS } from './make-model.js';

function Chip({ icon, title, note, on, testid, children }) {
  return (
    <span className="dsm-src" data-on={on ? 'true' : undefined} data-testid={testid}>
      <StIcon name={icon} size={16} />
      <b>{title}</b>
      {children ?? <em>{note}</em>}
      {on ? (
        <span className="dsm-src-x" aria-hidden="true">
          <StIcon name="check" size={12} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * @param {{
 *   project: string, canvases?: number, canAskAI?: boolean, label?: string,
 *   onMake: (inp: { sentence: string, audience: string, refs: any }) => Promise<{ ok: boolean, message?: string }>,
 *   onLogo?: (file: File) => Promise<{ ok: boolean, path?: string, message?: string }>,
 *   onClose: () => void,
 * }} props
 */
export function DsMakeSheet({ project, canvases = 0, canAskAI = true, onMake, onLogo, onClose }) {
  const [sentence, setSentence] = useState('');
  const [audience, setAudience] = useState('websites');
  const [website, setWebsite] = useState('');
  const [figma, setFigma] = useState(false);
  const [useCanvases, setUseCanvases] = useState(canvases > 0);
  const [logo, setLogo] = useState(null); // { name, path }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const sentenceRef = useRef(null);
  const ref = useModalFocus({ onClose, initialRef: sentenceRef });
  const ready = canMake({ sentence }) && canAskAI && !busy;

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onLogo) return;
    setError('');
    const r = await onLogo(file);
    if (r.ok && r.path) setLogo({ name: file.name, path: r.path });
    else setError(r.message || MAKE_WORDS.ref.logo.hint);
  };

  const go = async () => {
    if (!ready) return;
    setBusy(true);
    setError('');
    let res;
    try {
      res = await onMake({
        sentence,
        audience,
        refs: {
          logoRef: logo?.path ?? null,
          website,
          figma,
          canvases: useCanvases && canvases > 0,
        },
      });
    } catch {
      res = { ok: false, message: 'Couldn’t do that. Try again.' };
    }
    setBusy(false);
    if (res?.ok === false) setError(res.message || 'Couldn’t do that. Try again.');
  };

  return (
    <div className="dsr-scrim" data-testid="ds-make-scrim">
      <div
        ref={ref}
        className="island dsr-dialog dsm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-make-title"
        tabIndex={-1}
        data-testid="ds-make"
      >
        <h2 id="ds-make-title" className="dsr-title" data-testid="ds-make-title">
          {MAKE_WORDS.title(project)}
        </h2>
        <div className="dsr-body">
          <div className="dsm-f">
            <label className="dsm-l" htmlFor="ds-make-sentence">
              <b>1</b>
              {MAKE_WORDS.sentenceLabel}
            </label>
            <textarea
              id="ds-make-sentence"
              ref={sentenceRef}
              className="textarea dsm-ta"
              data-testid="ds-make-sentence"
              rows={3}
              maxLength={600}
              spellCheck
              placeholder={MAKE_WORDS.sentenceHint}
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) go();
              }}
            />
          </div>

          <div className="dsm-f">
            <p className="dsm-l">
              <b>2</b>
              {MAKE_WORDS.learnLabel} <em>{MAKE_WORDS.optional}</em>
            </p>
            <div className="dsm-srcs">
              <button
                type="button"
                className="dsm-srcb"
                data-testid="ds-make-ref-logo"
                aria-pressed={!!logo}
                onClick={() => fileRef.current?.click()}
              >
                <Chip
                  icon="image"
                  title={MAKE_WORDS.ref.logo.title}
                  note={logo ? logo.name : MAKE_WORDS.ref.logo.empty}
                  on={!!logo}
                />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".svg,image/svg+xml"
                hidden
                data-testid="ds-make-logo-file"
                onChange={pick}
              />
              <Chip
                icon="link"
                title={MAKE_WORDS.ref.website.title}
                on={website.trim().length > 0}
                testid="ds-make-ref-website"
              >
                <input
                  type="text"
                  className="dsm-site"
                  data-testid="ds-make-website"
                  aria-label={MAKE_WORDS.ref.website.title}
                  placeholder={MAKE_WORDS.ref.website.empty}
                  spellCheck={false}
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </Chip>
              <button
                type="button"
                className="dsm-srcb"
                data-testid="ds-make-ref-figma"
                aria-pressed={figma}
                onClick={() => setFigma((v) => !v)}
              >
                <Chip
                  icon="layers"
                  title={MAKE_WORDS.ref.figma.title}
                  note={figma ? 'Included' : MAKE_WORDS.ref.figma.empty}
                  on={figma}
                />
              </button>
              {canvases > 0 ? (
                <button
                  type="button"
                  className="dsm-srcb"
                  data-testid="ds-make-ref-canvases"
                  aria-pressed={useCanvases}
                  onClick={() => setUseCanvases((v) => !v)}
                >
                  <Chip
                    icon="square"
                    title={MAKE_WORDS.ref.canvases.title}
                    note={`${canvases} in ${project}`}
                    on={useCanvases}
                  />
                </button>
              ) : null}
            </div>
          </div>

          <div className="dsm-f">
            <p className="dsm-l" id="ds-make-for-l">
              <b>3</b>
              {MAKE_WORDS.forLabel}
            </p>
            {/* biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form fieldset */}
            <span
              className="seg dsm-seg"
              role="group"
              aria-labelledby="ds-make-for-l"
              data-testid="ds-make-for"
            >
              {AUDIENCES.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="k-seg-b"
                  aria-pressed={audience === a.id}
                  data-testid={`ds-make-for-${a.id}`}
                  onClick={() => setAudience(a.id)}
                >
                  {a.label}
                </button>
              ))}
            </span>
          </div>

          <p className="dsr-fine dsm-fine" data-testid="ds-make-fine">
            <Spark size={12} />
            {canAskAI ? MAKE_WORDS.fine : MAKE_WORDS.noAI}
          </p>
          {error ? (
            <p className="dsr-err" role="alert" data-testid="ds-make-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dsr-acts">
          <button
            type="button"
            className="btn"
            disabled={busy}
            data-testid="ds-make-cancel"
            onClick={onClose}
          >
            {MAKE_WORDS.cancel}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!ready}
            data-testid="ds-make-go"
            onClick={go}
          >
            <Spark size={12} />
            {busy ? MAKE_WORDS.going : MAKE_WORDS.go}
          </button>
        </div>
      </div>
    </div>
  );
}
