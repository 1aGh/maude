// client/v2/assets/describe-consent.jsx — "Describe the pictures in <project>?" (S8.20; 12 · ia-assets-find col 1–2 and
// "AI not connected", 05 · es-search-more; CONTRACT §7).
//
// Asked once per project, per person, on this Mac, and never assumed:
//   DescribeOffer        under a search: "Search what's in the pictures too?" · Turn on… (or Connect… with no AI)
//   DescribeSheet        the one sheet — Cancel is the safe default and is remembered as an answer
//   DescribeProgress     "Describing 12 of 193 pictures" with Stop (Resume after a Stop)
//   DescribeSettingsRow  Settings › General: "Search in pictures" — off at once, on only through the sheet
// Every answer goes to the studio (`/_api/describe/*`), which enforces it; nothing here sends a picture anywhere.

import { useEffect, useRef, useState } from 'react';
import { Group } from '../settings/parts.jsx';
import { restoreFocus, trapTab } from '../shell/modal-focus.js';
import { progressWords, readDescribe, sendConsent, DESCRIBE_EVENT } from './describe-client.js';

/** Col 1 / "AI not connected": the line under the first search's results. */
export function DescribeOffer({ kind, onTurnOn, onConnect }) {
  if (kind === 'connect')
    return (
      <div className="lp-offer" data-testid="assets-describe-offer" data-kind="connect">
        <p>Connect your Claude account to search what's in pictures, too.</p>
        <button
          type="button"
          className="btn btn--sm"
          data-testid="assets-describe-connect"
          onClick={onConnect}
        >
          Connect…
        </button>
      </div>
    );
  if (kind !== 'turn-on') return null;
  return (
    <div className="lp-offer" data-testid="assets-describe-offer" data-kind="turn-on">
      <p>
        <strong>Search what's in the pictures too?</strong> AI can describe every picture and clip
        once, so a word finds IMG_2231.jpg as well.
      </p>
      <button
        type="button"
        className="btn btn--sm"
        data-testid="assets-describe-turn-on"
        onClick={onTurnOn}
      >
        Turn on…
      </button>
    </div>
  );
}

/** Col 2: the one question. `count` = pictures and clips that would be described. */
export function DescribeSheet({ project, count, onCancel, onConfirm }) {
  const ref = useRef(null);
  const cancelRef = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    cancelRef.current?.focus(); // the safe answer first: Enter on open must not send anything
    return () => restoreFocus(opener);
  }, []);
  const name = project || 'this project';
  return (
    <div
      className="gi-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lp-describe-t"
      data-testid="assets-describe-sheet"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else trapTab(e, ref.current);
      }}
    >
      <div className="gi-scrim" aria-hidden="true" onClick={onCancel} />
      <div className="gi-dialog v2s-confirm-dialog">
        <h2 id="lp-describe-t" className="v2s-confirm-t">
          Describe the pictures in {name}?
        </h2>
        <p className="v2s-confirm-d">
          Let AI describe your pictures so search can find what's in them.
        </p>
        <ul className="lp-describe-bul">
          <li>
            Uses your Claude account — one short look at each of {count}{' '}
            {count === 1 ? 'picture or clip' : 'pictures and clips'}.
          </li>
          <li>New pictures are described when they arrive.</li>
          <li>The words stay on this Mac, so search works offline.</li>
          <li>Only for {name}. Turn it off in Settings › General.</li>
        </ul>
        <div className="v2s-confirm-foot">
          <button
            type="button"
            className="btn"
            ref={cancelRef}
            data-testid="assets-describe-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="assets-describe-confirm"
            onClick={onConfirm}
          >
            Describe pictures
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Describing 12 of 193 pictures" · Stop — or "Stopped at 12 of 193 pictures" · Resume. Nothing while done or off. */
export function DescribeProgress({ status, onStop }) {
  const words = progressWords(status);
  if (!words) return null;
  const stopped = status.paused === 'stopped';
  return (
    <p className="lp-foot lp-describe-progress" data-testid="assets-describe-progress">
      <span>{words}</span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        data-testid="assets-describe-stop"
        onClick={() => onStop(!stopped)}
      >
        {stopped ? 'Resume' : 'Stop'}
      </button>
    </p>
  );
}

/**
 * Settings › General › Search in pictures. Off at once; on opens the same sheet (never a silent yes). Hidden where the
 * studio does not describe (a cloud tab, an older studio).
 */
export function DescribeSettingsRow({ project, fetchImpl, Row }) {
  const get = fetchImpl || ((...a) => fetch(...a));
  const [status, setStatus] = useState(null);
  const [asking, setAsking] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once on mount, and when an answer is announced
  useEffect(() => {
    let alive = true;
    const read = () =>
      readDescribe(get).then((got) => {
        if (alive) setStatus(got?.status ?? null);
      });
    read();
    window.addEventListener(DESCRIBE_EVENT, read);
    return () => {
      alive = false;
      window.removeEventListener(DESCRIBE_EVENT, read);
    };
  }, []);
  if (!status) return null;
  const answer = async (on) => {
    setAsking(false);
    const s = await sendConsent(on, get);
    if (s) setStatus(s);
  };
  return (
    <Group title="Search" testid="settings-describe">
      <Row
        label="Search in pictures"
        note={`AI describes the pictures in ${project || 'this project'} once, with your Claude account, so search finds what's in them.`}
        checked={!!status.consent?.on}
        onChange={(on) => (on ? setAsking(true) : void answer(false))}
      />
      {asking ? (
        <DescribeSheet
          project={project}
          count={status.total}
          onCancel={() => void answer(false)}
          onConfirm={() => void answer(true)}
        />
      ) : null}
    </Group>
  );
}
