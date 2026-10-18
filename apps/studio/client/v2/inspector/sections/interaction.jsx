// client/v2/inspector/sections/interaction.jsx — S2.5: Interaction (14 Editing, ed-inspector §9).
// "Where a click goes and what a hover does. Preview plays it; Edit shows the link while selected."
//
//   On hover   `data-hover="<preset>"` from the closed vocabulary (edit-ops/hover-rules.ts, S2-hover-format.md). Written
//              through the existing /_api/edit-attr lane; one undo entry. It is design, so it is outside `data-cd-*`.
//   On click   `data-cd-link` (S3-links-format.md). The row reads the link and says what it does; "None" clears it
//              (`element.clear-link` through S2.1's /_api/edit-op, ./link-write.js). Choosing a new place to go from
//              here is not built yet: Claude or the file sets it; the chip and Preview play it.

import { useCallback, useEffect, useState } from 'react';
import {
  HOVER_ATTR,
  HOVER_PRESETS,
  hoverLabel,
  hoverOf,
  hoverWrite,
} from '../../../../edit-ops/hover-rules.ts';
import { trackRecordableWrite } from '../../../inspector/css-knobs.jsx';
import { writeLink } from '../link-write.js';
import { registerSlot } from '../slots.js';
import { elementKey, requestAdd, useAddRequest } from './add-requests.js';
import { Quiet, Row } from './row.jsx';

/** `element.set-link` / `element.clear-link` are in the op table (S3.10a): the row can clear a link. */
export const LINK_WRITES_READY = true;

export const LINK_ATTR = 'data-cd-link';

const words = (s) => s.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * What a link does, in the words the canvas uses. The attribute value is read as data: nothing here follows it or
 * trusts it, and a value that is not one of the three forms (S3-links-format §2) reads "Custom link".
 * @returns {{ kind: 'none' | 'artboard' | 'canvas' | 'external' | 'custom', label: string }}
 */
export function clickWords(raw) {
  if (raw == null || raw === '') return { kind: 'none', label: 'None' };
  const v = String(raw);
  if (/^#[A-Za-z0-9_-]{1,64}$/.test(v)) return { kind: 'artboard', label: `Go to ${v.slice(1)}` };
  if (/^https?:\/\//.test(v)) {
    try {
      const u = new URL(v);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && u.hostname && !u.username) {
        const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
        return { kind: 'external', label: `Open ${u.host}${path}` };
      }
    } catch {
      /* falls through to Custom */
    }
    return { kind: 'custom', label: 'Custom link' };
  }
  const m = /^([A-Za-z0-9_][A-Za-z0-9_./ -]*)\.tsx(?:#[A-Za-z0-9_-]{1,64})?$/.exec(v);
  if (m && !m[1].split('/').some((s) => s === '' || s === '.' || s === '..' || s.startsWith('_'))) {
    const base = m[1].split('/').pop();
    return { kind: 'canvas', label: `Go to ${words(base)}` };
  }
  return { kind: 'custom', label: 'Custom link' };
}

let chain = Promise.resolve();

async function post(payload) {
  try {
    const res = await fetch('/_api/edit-attr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    return res.ok && j?.ok ? j : null;
  } catch {
    return null;
  }
}

export function InteractionBody({ el, ctx }) {
  const editable = !!el?.id && ctx?.editable !== false;
  const file = el?.file ?? ctx?.canvasFile;
  const fromFile = hoverOf(el?.attrs);
  // what the user just picked, until the canvas re-posts the file; a fresh payload for the object drops it
  const [picked, setPicked] = useState(undefined);
  const fresh = `${elementKey(el)}~${el?.attrs?.[HOVER_ATTR] ?? ''}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear on a fresh selection payload only
  useEffect(() => setPicked(undefined), [fresh]);
  const preset = picked === undefined ? fromFile.preset : picked;
  const known = picked === undefined ? fromFile.known : true;

  const set = useCallback(
    (next) => {
      if (!editable || next === preset) return;
      const before = preset;
      setPicked(next);
      const payload = { canvas: file, id: el.id, ...hoverWrite(next) };
      chain = trackRecordableWrite(
        chain.then(async () => {
          const j = await post(payload);
          if (!j) {
            setPicked(undefined); // nothing was written: the file’s own value again
            return;
          }
          const prev = Object.hasOwn(j, 'previous') ? j.previous : before;
          if ((prev ?? null) === (next ?? null)) return; // nothing changed to undo
          ctx?.onRecordEdit?.({
            op: 'attr',
            canvas: file,
            id: el.id,
            key: HOVER_ATTR,
            before: prev == null || prev === '' ? null : prev,
            after: next,
          });
        })
      );
    },
    [editable, preset, file, el?.id, ctx]
  );

  // "None": drop the link — one edit-op write, one undo step; the id stays
  const clearClick = useCallback(async () => {
    if (!editable || !file || !el?.artboardId) return;
    await writeLink({
      canvas: file,
      artboardId: el.artboardId,
      id: el.id,
      index: el.index,
      target: null,
    });
  }, [editable, file, el?.artboardId, el?.id, el?.index]);

  // the "+": a trigger — the first lift, when nothing is set yet
  useAddRequest('interaction', el, () => {
    if (!preset) set(HOVER_PRESETS[0]);
  });

  const click = clickWords(el?.attrs?.[LINK_ATTR]);
  const canClear = LINK_WRITES_READY && editable && click.kind !== 'none';
  const options = [
    { value: 'none', label: hoverLabel(null) },
    ...HOVER_PRESETS.map((p) => ({ value: p, label: hoverLabel(p) })),
    ...(known ? [] : [{ value: 'custom', label: 'Custom' }]),
  ];
  const face = !preset ? 'none' : known ? preset : 'custom';

  return (
    <>
      <Row k="On click" name="click">
        <select
          className="st-cp-nsel"
          aria-label="On click"
          data-testid="insp-ctl-click"
          value="current"
          disabled={!canClear}
          onChange={(e) => {
            if (e.target.value === 'none') clearClick();
          }}
        >
          <option value="current">{click.label}</option>
          {canClear ? <option value="none">None</option> : null}
        </select>
      </Row>
      <Row k="On hover" name="hover">
        <select
          className="st-cp-nsel"
          aria-label="On hover"
          data-testid="insp-ctl-hover"
          value={face}
          disabled={!editable}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'custom') return;
            set(v === 'none' ? null : v);
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      {!LINK_WRITES_READY ? (
        <Quiet testid="insp-click-pending">
          Changing where a click goes isn’t available yet; the link is shown as the file has it.
        </Quiet>
      ) : null}
      {!editable ? (
        <Quiet testid="insp-hover-locked">
          This object has no id yet. Edit element id… gives it one.
        </Quiet>
      ) : null}
      <Quiet testid="insp-interaction-note">
        Preview plays it; the link shows on the canvas while this is selected — as in 04 Modes.
      </Quiet>
    </>
  );
}

export const offInteraction = registerSlot('interaction', {
  id: 'interaction.words',
  order: 10,
  // an artboard has no click of its own (a click goes from an object); several objects have no one link
  when: ({ kind }) => kind !== 'artboard' && kind !== 'multi',
  Body: InteractionBody,
  add: ({ el }) => requestAdd('interaction', el),
});
