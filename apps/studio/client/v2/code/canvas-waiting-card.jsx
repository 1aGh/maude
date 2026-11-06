// client/v2/code/canvas-waiting-card.jsx — 2.0.4 task B: the card for a canvas that can't load YET,
// because files it imports haven't reached this Mac (first sync) or are held back (a refusal).
//
//   waiting   "Uniformy-2027 is still downloading." · a bar of the files this canvas needs (3 of 5
//             files) · the project's sync (Project sync: 5,029 of 5,041 files) · the names it waits
//             for (five, then "and N more"). No button: the canvas opens by itself when they land
//             (CanvasLoadFailure watches and reloads it).
//   refused   "Uniformy-2027 can't open on this Mac yet." · why, in plain words; for the code consent
//             (fix/207) the card's one button, Allow shared code…, opens the confirm sheet (a Maude
//             Cloud project opened from Home accepts by itself). No "Ask AI to fix it": AI can't change
//             a sync consent, and nothing in the code is wrong.
//
// Same card frame as the broken-canvas card (`.v2-err`); the words are canvas-waiting.js's.

import { useEffect, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { readCodeConsent } from './code-consent.js';
import { CodeConsentSheet } from './code-consent-sheet.jsx';
import {
  BUILDING_BODY,
  baseName,
  buildingTitle,
  fileNote,
  moreCount,
  needLabel,
  projectLabel,
  refusedFile,
  SHOWN_FILES,
  waitingBody,
  waitingTitle,
} from './canvas-waiting.js';
import { canvasTitle } from './use-canvas-source.js';

/** fix/207 — the card's one action for held shared code; drawn only where this Mac may answer. */
function AllowCodeAction({ fetchImpl }) {
  const [consent, setConsent] = useState(null);
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState('');
  useEffect(() => {
    let live = true;
    readCodeConsent(fetchImpl).then((c) => {
      if (live) setConsent(c);
    });
    return () => {
      live = false;
    };
  }, [fetchImpl]);
  if (said)
    return (
      <p className="v2-err-lg" role="status" data-testid="canvas-waiting-allowed">
        {said}
      </p>
    );
  if (!consent?.changeable || consent.allowed) return null;
  return (
    <div className="v2-err-acts">
      <button
        type="button"
        className="btn btn--primary"
        data-action="sync.allow-code"
        data-testid="canvas-waiting-allow-code"
        onClick={() => setOpen(true)}
      >
        Allow shared code…
      </button>
      {open ? (
        <CodeConsentSheet
          mode="allow"
          host={consent.host}
          fetchImpl={fetchImpl}
          onClose={() => setOpen(false)}
          onDone={(c) => {
            setOpen(false);
            setConsent(c);
            setSaid('Shared code is allowed. The canvas opens once it arrives.');
          }}
        />
      ) : null}
    </div>
  );
}

export function CanvasWaitingCard({ canvas, waiting, fetchImpl = globalThis.fetch }) {
  const name = canvasTitle(canvas);
  const held = !!refusedFile(waiting);
  const codeHeld = refusedFile(waiting)?.reason === 'code-consent';
  const { need, progress } = waiting;
  const shown = waiting.files.slice(0, SHOWN_FILES);
  const more = moreCount(waiting);
  const pct = need ? Math.round((need.here / need.total) * 100) : 0;
  return (
    <section
      className="v2-err v2-err--waiting"
      aria-labelledby="v2-err-title"
      data-testid="canvas-waiting-card"
      data-kind={held ? 'refused' : 'waiting'}
      aria-live="polite"
    >
      <header className="v2-err-hd">
        <span className={`v2-err-ic${held ? '' : ' v2-err-ic--calm'}`} aria-hidden="true">
          <StIcon name={held ? 'lock' : 'sync'} size={20} />
        </span>
        <h2 className="v2-err-t" id="v2-err-title" data-testid="canvas-waiting-title">
          {waitingTitle(name, waiting)}
        </h2>
      </header>
      <p className="v2-err-d" data-testid="canvas-waiting-body">
        {waitingBody(waiting)}
      </p>
      {codeHeld ? <AllowCodeAction fetchImpl={fetchImpl} /> : null}
      {need && !held ? (
        <div className="v2-err-prog" data-testid="canvas-waiting-progress">
          <span
            className="v2-err-bar"
            role="progressbar"
            aria-label={`Files ${name} needs`}
            aria-valuemin={0}
            aria-valuemax={need.total}
            aria-valuenow={need.here}
            aria-valuetext={needLabel(need)}
          >
            <i style={{ width: `${pct}%` }} />
          </span>
          <span className="v2-err-prog-l">{needLabel(need)}</span>
        </div>
      ) : null}
      {progress && !held ? (
        <p className="v2-err-lg" data-testid="canvas-waiting-project">
          {projectLabel(progress)}
        </p>
      ) : null}
      {shown.length > (held ? 1 : 0) ? (
        <div className="v2-err-files">
          <span className="v2-err-files-h">Waiting for</span>
          <ul className="v2-err-files-l" data-testid="canvas-waiting-files">
            {shown.map((f) => (
              <li key={f.rel} className="v2-err-file" title={f.rel}>
                <span className="v2-err-file-n">{baseName(f.rel)}</span>
                {fileNote(f) ? <span className="v2-err-file-s">{fileNote(f)}</span> : null}
              </li>
            ))}
            {more > 0 ? (
              <li className="v2-err-file v2-err-file--more" data-testid="canvas-waiting-more">
                and {more} more
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/**
 * 2.0.4 task P — its build is still running (it outlived the request that started it; a big canvas
 * on a busy server). Not a failure: no Ask AI, no Reload. CanvasLoadFailure watches and loads the
 * canvas by itself when the build is done; a build that died past its ceiling turns into the
 * ordinary "can't be drawn" card with "The build timed out" under Show details.
 */
export function CanvasBuildingCard({ canvas }) {
  return (
    <section
      className="v2-err v2-err--waiting"
      aria-labelledby="v2-err-title"
      data-testid="canvas-waiting-card"
      data-kind="building"
      aria-live="polite"
    >
      <header className="v2-err-hd">
        <span className="v2-err-ic v2-err-ic--calm" aria-hidden="true">
          <StIcon name="sync" size={20} />
        </span>
        <h2 className="v2-err-t" id="v2-err-title" data-testid="canvas-waiting-title">
          {buildingTitle(canvas, canvasTitle(canvas))}
        </h2>
      </header>
      <p className="v2-err-d" data-testid="canvas-waiting-body">
        {BUILDING_BODY}
      </p>
    </section>
  );
}
