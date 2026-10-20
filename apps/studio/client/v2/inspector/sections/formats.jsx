// client/v2/inspector/sections/formats.jsx — S7.13 (07 ve-formats): "Three formats, one edit."
//
// The Video inspector's Formats rows: the artboards that share this cut ("Reels 9:16 · this one", "16:9 · 1920 × 1080"),
// "+ Add a format" (a linked copy at another size), and "Make an unlinked copy" (this artboard forks the cut and keeps its
// own). A link is DERIVED — artboards that mount one comp (video/linked-formats.ts, read from GET /_api/comp-media) —
// so a trim or a retitle once shows in every row, and each format keeps its own framing and title position. Unlinked
// copies are listed under the cut they came from, so nothing the fork leaves behind is lost.
//
// Both writes are one edit-op each (formats-write.js, minRole edit; a viewer's refusal is a sentence). Safe zones follow
// as their own section (S7.22); Advanced names the comp (`linkedTo`) and says framing is per format.

import { useEffect, useRef, useState } from 'react';
import { shellToast } from '../../../shell/util.js';
import { compMediaStore, useCompMedia } from '../../transcript/comp-media-store.js';
import { formatsUi, useAddRequests } from '../formats-ui.js';
import { addedWords, addFormat, makeUnlinked, unlinkedWords } from '../formats-write.js';
import { registerSlot } from '../slots.js';
import { Quiet, Row } from './row.jsx';

// the four marks these rows use (the shell's set has `link` and `plus`; the broken link and the copy are drawn here)
const MARKS = {
  link: 'M6.8 9.2l2.4-2.4M5.6 7.4L4.2 8.8a2.5 2.5 0 0 0 3.5 3.5l1.4-1.4M10.4 8.6l1.4-1.4a2.5 2.5 0 0 0-3.5-3.5L6.9 5.1',
  'link-off':
    'M5.6 7.4L4.2 8.8a2.5 2.5 0 0 0 3.5 3.5l1.4-1.4M10.4 8.6l1.4-1.4a2.5 2.5 0 0 0-3.5-3.5L6.9 5.1M2.5 2.5l11 11',
  plus: 'M8 3.5v9M3.5 8h9',
  duplicate: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
};

function Mark({ name }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      <path d={MARKS[name]} />
    </svg>
  );
}

const first = (selection) => (Array.isArray(selection) ? selection[0] : selection);
const kindOf = (selection) => first(selection)?.attrs?.['data-dc-kind'] || 'digital';

function FormatLine({ f }) {
  return (
    <span
      className="insp-fmt-row"
      data-on={f.current ? 'true' : undefined}
      data-testid={`insp-fmt-${f.artboardId}`}
    >
      <Mark name={f.unlinkedCopy ? 'link-off' : 'link'} />
      {f.name}
      <span>{f.current ? 'this one' : f.unlinkedCopy ? 'its own cut' : f.size}</span>
    </span>
  );
}

export function FormatsBody({ el, ctx }) {
  const canvas = ctx?.canvasFile ?? el?.file ?? null;
  const id =
    el?.artboardId || /^\[data-dc-screen="([^"]+)"\]$/.exec(el?.selector || '')?.[1] || null;
  const { media } = useCompMedia(canvas, id);
  const [adding, setAdding] = useState(false);
  const [said, setSaid] = useState('');
  // the Timeline's feed keeps this fresh for the video it follows; a video selected first is read here
  useEffect(() => {
    if (canvas && id && !compMediaStore.get(canvas, id)) void compMediaStore.load(canvas, id);
  }, [canvas, id]);
  // another artboard: nothing said, nothing open
  // biome-ignore lint/correctness/useExhaustiveDependencies: the selection is the trigger
  useEffect(() => {
    setAdding(false);
    setSaid('');
  }, [id]);

  const f = media?.formats ?? null;
  // An artboard has no element id, so the frame's `editable` is false for it; the server judges the role (403).
  const can = true;

  const record = (r, label) => {
    if (!r.actionId && !r.queued && r.writeId)
      ctx?.onRecordEdit?.({ op: 'edit-op', writeId: r.writeId, label });
  };
  const add = async (p) => {
    setAdding(false);
    setSaid('');
    const r = await addFormat({ canvas, artboardId: id, width: p.w, height: p.h });
    if (!r.ok) {
      setSaid(r.message);
      return;
    }
    record(r, 'add a format');
    shellToast(addedWords(p.name), true);
    void compMediaStore.load(canvas, id);
  };
  const unlink = async () => {
    setSaid('');
    const r = await makeUnlinked({ canvas, artboardId: id });
    if (!r.ok) {
      setSaid(r.message);
      return;
    }
    record(r, 'make an unlinked copy');
    shellToast(unlinkedWords, true);
    void compMediaStore.load(canvas, id);
  };

  // ⌘K reaches these rows through formats-ui: "Add a format" opens the size list, "Make an unlinked copy" runs here
  const unlinkNow = useRef(unlink);
  unlinkNow.current = unlink;
  const canUnlink = !!f?.canUnlink;
  const shown = !!(canvas && id && f);
  // biome-ignore lint/correctness/useExhaustiveDependencies: registered while a video's rows are showing
  useEffect(() => {
    if (!shown) return undefined;
    return formatsUi.register({ canUnlink, unlink: () => void unlinkNow.current() });
  }, [shown, canUnlink]);
  const asked = useAddRequests();
  const seen = useRef(asked);
  useEffect(() => {
    if (asked === seen.current) return;
    seen.current = asked;
    setAdding(true);
  }, [asked]);

  if (!shown) return null;
  return (
    <>
      <Row k="Formats" name="formats">
        <span className="insp-fmts" data-testid="insp-formats">
          {f.formats.map((row) => (
            <FormatLine key={row.artboardId} f={row} />
          ))}
          {f.copies.map((row) => (
            <FormatLine key={row.artboardId} f={row} />
          ))}
          {can && f.free.length ? (
            <button
              type="button"
              className="insp-fmt-row insp-fmt-row--add"
              data-testid="insp-format-add"
              aria-expanded={adding}
              onClick={() => setAdding((v) => !v)}
            >
              <Mark name="plus" />
              Add a format
            </button>
          ) : null}
          {adding
            ? f.free.map((p) => (
                <button
                  key={`${p.w}x${p.h}`}
                  type="button"
                  className="insp-fmt-row insp-fmt-pick"
                  data-testid={`insp-format-add-${p.w}x${p.h}`}
                  onClick={() => add(p)}
                >
                  {p.name}
                  <span>
                    {p.w} × {p.h}
                  </span>
                </button>
              ))
            : null}
        </span>
      </Row>
      {f.unlinkedFrom ? (
        <Quiet testid="insp-format-own-cut">Unlinked copy — its own cut.</Quiet>
      ) : null}
      {can && f.canUnlink ? (
        <Row k="" name="format-unlink">
          <button
            type="button"
            className="insp-quietlink"
            data-testid="insp-format-unlink"
            onClick={unlink}
          >
            <Mark name="duplicate" /> Make an unlinked copy
          </button>
        </Row>
      ) : null}
      {said ? <Quiet testid="insp-formats-said">{said}</Quiet> : null}
    </>
  );
}

/** @returns {() => void} take the Formats rows back out of the registry */
export function registerFormatsSlot() {
  return registerSlot('formats', {
    id: 'formats.video',
    order: 10,
    kinds: ['artboard'],
    when: ({ selection }) => kindOf(selection) === 'video',
    Body: FormatsBody,
  });
}

export const offFormats = registerFormatsSlot();
