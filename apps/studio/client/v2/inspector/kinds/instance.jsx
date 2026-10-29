// client/v2/inspector/kinds/instance.jsx — S2.17: an instance of a design-system component (14 Editing,
// ed-comp-instance).
//
//   Kind chip   "Instance" — an object the server reads as `<Button …>` from `@maude/ds` (or the div around
//               one that cannot forward its props). The canvas cannot tell (a component's DOM is its host
//               element), so the frame asks `GET /_api/edit-instance` for a single selection and the answer
//               rides on the selection as `instanceInfo` (useInstanceSelection).
//   Component   Component · Variant — "Your text and colour come along". A swap is ONE edit-op
//               (`component.swap-variant`); the studio checks the variant against the system's own list.
//   Content     Text · Fill, each with the "Changed here" dot when it differs from the master; the line
//               "2 changes from Tlačítko." with Reset (`component.reset` takes back only the overrides);
//               "Update Tlačítko for every canvas…" once S10 registers `ds.review-update` (Q13).
//   Main        Go to <master> (S10's `ds.go-to`, hidden until it is registered) · Detach (`component.detach`):
//               "keeps this exact look as a plain frame … stops following <master>".
//
// Every change is asked of the canvas through `run-action` (`ctx.onRunAction`), like the Type section; the
// canvas measures what only it can (what the instance renders to, for Detach) and the studio writes the TSX.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ACTIONS_BY_ID } from '../../../../actions/index.ts';
import { fillFromCss, fillToCss } from '../../../../edit-ops/words-paint.ts';
import { Select } from '../../../inspector-controls.jsx';
import { StIcon } from '../../../shell/icons.jsx';
// S10.8 — the Update available block mounts itself in this kind's slot (client/v2/ds/update-available.jsx)
import '../../ds/update-available.jsx';
import { registerBlock } from '../blocks.js';
import { useCssWrite } from '../css-write.js';
import { bindInspectorActions } from '../inspector-actions.js';
import { ColorControl } from '../sections/color-control.jsx';
import { Quiet, Row } from '../sections/row.jsx';
import { useDsFamilies } from '../token-chip.jsx';
import { isArtboardSelection, registerKind, singleOf } from './index.js';
import { editReason, reasonProps } from '../../access/disabled-reason.js';

const refOf = (el) => (Array.isArray(el?.refs) ? el.refs[0] : null);

/** Ask the canvas to run an instance action over the one selected instance. true = asked. */
function ask(ctx, id, el, params = {}) {
  const ref = refOf(el);
  if (!ref || !ctx?.onRunAction) return false;
  ctx.onRunAction({ dgn: 'run-action', v: 1, id, params: { targets: [ref], ...params } });
  // the canvas re-renders on its own time; read the instance again once it has
  setTimeout(() => ctx.refreshInstance?.(), 450);
  return true;
}

// ── asking the server what the selection is ────────────────────────────────────────────────

const selKey = (file, el) => `${file}|${el.id}|${el.index ?? 0}`;
const sigOf = (el) => `${el.text ?? ''}|${JSON.stringify(el.authored ?? el.attrs?.style ?? '')}`;

/**
 * The selection with `instanceInfo` on its one element when the server says it is an instance. Other
 * selections pass through untouched (same object). `refresh()` asks again (after an op).
 * @returns {{ selected: any, refresh: () => void }}
 */
export function useInstanceSelection(selected, canvasFile) {
  const el1 = Array.isArray(selected) ? (selected.length === 1 ? selected[0] : null) : selected;
  const askable = !!el1 && !!el1.id && !!canvasFile && !isArtboardSelection(el1);
  const key = askable ? selKey(canvasFile, el1) : '';
  const sig = askable ? sigOf(el1) : '';
  const [state, setState] = useState({ key: '', info: null });
  const [rev, setRev] = useState(0);
  const refresh = useCallback(() => setRev((r) => r + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `sig` and `rev` are the triggers; the body reads the live element
  useEffect(() => {
    if (!askable) {
      setState((s) => (s.key ? { key: '', info: null } : s));
      return undefined;
    }
    let dead = false;
    (async () => {
      let info = null;
      try {
        const q = `file=${encodeURIComponent(canvasFile)}&id=${encodeURIComponent(el1.id)}`;
        const r = await fetch(`/_api/edit-instance?${q}`);
        const j = r.ok ? await r.json() : null;
        info = j?.ok && j.instance ? j.instance : null;
      } catch {
        info = null;
      }
      if (!dead) setState({ key, info });
    })();
    return () => {
      dead = true;
    };
  }, [key, sig, rev, askable]);
  // the answer for ANOTHER object is not this one's: wait for it rather than flash a wrong kind
  const info = key && state.key === key ? state.info : null;
  const out = useMemo(() => {
    if (!info || !el1) return selected;
    const withInfo = { ...el1, instanceInfo: info };
    return Array.isArray(selected) ? [withInfo] : withInfo;
  }, [selected, el1, info]);
  return { selected: out, refresh };
}

const infoOf = (el) => singleOf(el)?.instanceInfo ?? null;
const isInstance = (s) => !!infoOf(s);

// ── Component · Variant ────────────────────────────────────────────────────────────────────

function ComponentBody({ el, ctx }) {
  const info = infoOf(el);
  if (!info) return null;
  const editable = ctx?.editable !== false && !!ctx?.onRunAction && !info.repeats;
  const swaps = info.swappable.map((s) => ({ value: s.name, label: s.label }));
  const variants = [
    { value: '', label: 'Default' },
    ...info.variants.map((v) => ({ value: v.key, label: v.label })),
  ];
  const inCode = info.variant === 'code';
  return (
    <section className="insp-sec" data-testid="insp-sec-component" aria-label="Component">
      <p className="insp-sec-t">
        <span className="insp-sec-name">Component</span>
      </p>
      <Row k="Component" name="component">
        <span className="insp-row-ctl" aria-disabled={!editable || swaps.length < 2 || undefined}>
          <Select
            value={info.component}
            options={swaps}
            ariaLabel="Component"
            testId="insp-component-select"
            onChange={(component) => {
              if (component !== info.component)
                ask(ctx, 'component.swap-variant', el, { component });
            }}
          />
        </span>
      </Row>
      {info.variants.length > 0 || inCode ? (
        <Row k="Variant" name="variant">
          <Select
            value={inCode ? '' : (info.variant ?? '')}
            options={inCode ? [{ value: '', label: 'Set in code' }] : variants}
            ariaLabel="Variant"
            testId="insp-variant-select"
            onChange={(v) => {
              if (editable && !inCode)
                ask(ctx, 'component.swap-variant', el, { variant: v === '' ? null : v });
            }}
          />
        </Row>
      ) : null}
      <Quiet testid="insp-instance-hint">Your text and colour come along.</Quiet>
      {info.repeats ? (
        <Quiet testid="insp-instance-repeats">
          This one repeats in the code; change it where it is written.
        </Quiet>
      ) : null}
    </section>
  );
}

// ── Content ────────────────────────────────────────────────────────────────────────────────

function TextRow({ el, info, ctx, editable }) {
  const [draft, setDraft] = useState(info.text ?? '');
  const source = info.text ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new value from the file replaces a stale draft
  useEffect(() => setDraft(source), [source, el?.id]);
  const commit = () => {
    const next = draft.trim();
    if (!editable || next === source || next === '') return setDraft(source);
    ask(ctx, 'text.set', el, { text: next });
  };
  if (info.textInCode)
    return (
      <Row k="Text" name="content-text">
        <input
          className="insp-num-in"
          value=""
          placeholder="Set in code"
          disabled
          readOnly
          aria-label="Text"
        />
      </Row>
    );
  return (
    <Row k="Text" name="content-text" mod={info.overrides.text}>
      <input
        className="insp-num-in"
        type="text"
        aria-label="Text"
        data-testid="insp-content-text"
        value={draft}
        disabled={!editable}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            setDraft(source);
            e.currentTarget.blur();
          }
        }}
      />
    </Row>
  );
}

function FillRow({ el, info, ctx, editable }) {
  const { cssAll, write } = useCssWrite(el, ctx);
  const fam = useDsFamilies(ctx);
  const fill = fillFromCss(cssAll[0] ?? {});
  return (
    <Row
      k="Fill"
      name="content-fill"
      mod={info.overrides.fill}
      dim={!fill.color && !info.overrides.fill}
    >
      <ColorControl
        name="content-fill"
        label="Fill"
        value={fill.color ?? null}
        colors={fam.color}
        allowNone
        disabled={!editable}
        onChange={(color) => editable && write(fillToCss({ ...fill, color }))}
      />
    </Row>
  );
}

function ContentBody({ el, ctx }) {
  const info = infoOf(el);
  if (!info) return null;
  const editable = ctx?.editable !== false && !!ctx?.onRunAction && !info.repeats;
  const n = info.overrides.count;
  const canUpdate = n > 0 && ACTIONS_BY_ID.has('ds.review-update');
  return (
    <section className="insp-sec" data-testid="insp-sec-content" aria-label="Content">
      <p className="insp-sec-t">
        <span className="insp-sec-name">Content</span>
      </p>
      {info.holdsText ? <TextRow el={el} info={info} ctx={ctx} editable={editable} /> : null}
      {info.wrapper ? null : <FillRow el={el} info={info} ctx={ctx} editable={editable} />}
      {n > 0 ? (
        <div className="insp-line" data-testid="insp-instance-changes">
          <span>{`${n} change${n === 1 ? '' : 's'} from ${info.label}.`}</span>
          <button
            type="button"
            className="insp-line-act"
            data-testid="insp-instance-reset"
            disabled={!editable}
            {...reasonProps(!editable && !info.repeats, editReason(ctx))}
            onClick={() => ask(ctx, 'component.reset', el)}
          >
            Reset
          </button>
        </div>
      ) : (
        <Quiet testid="insp-instance-follows">{`Follows ${info.label}.`}</Quiet>
      )}
      {canUpdate ? (
        <button
          type="button"
          className="insp-quietlink"
          data-testid="insp-instance-update"
          onClick={() =>
            ctx?.onShellAction?.('ds.review-update', {
              canvas: ctx?.canvasFile,
              elementId: el?.id,
              target: {
                kind: 'component',
                name: info.component,
                ...(info.variant && info.variant !== 'code' ? { variant: info.variant } : {}),
              },
            })
          }
        >
          {`Update ${info.label} for every canvas…`}
        </button>
      ) : null}
    </section>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────────────────

function MainBody({ el, ctx }) {
  const info = infoOf(el);
  const component = info?.component;
  const onShellAction = ctx?.onShellAction;
  // ⌘K "Go to the main component" runs on the instance this block shows; S10's `ds.go-to` does the going
  useEffect(() => {
    if (!component) return undefined;
    return bindInspectorActions({
      'component.go-to-main': () => {
        if (!ACTIONS_BY_ID.has('ds.go-to') || !onShellAction)
          return 'The main component opens with the Design system view; not yet.';
        onShellAction('ds.go-to', { component });
        return null;
      },
    });
  }, [component, onShellAction]);
  if (!info) return null;
  const editable = ctx?.editable !== false && !!ctx?.onRunAction && !info.repeats;
  const canGo = ACTIONS_BY_ID.has('ds.go-to');
  return (
    <section className="insp-sec" data-testid="insp-sec-main" aria-label="Main component">
      <p className="insp-sec-t">
        <span className="insp-sec-name">Main component</span>
      </p>
      <div className="insp-addrow">
        {canGo ? (
          <button
            type="button"
            className="insp-chip"
            data-testid="insp-instance-goto"
            onClick={() => ctx?.onShellAction?.('ds.go-to', { component: info.component })}
          >
            <StIcon name="layers" size={12} />
            {`Go to ${info.label}`}
          </button>
        ) : null}
        <button
          type="button"
          className="insp-chip"
          data-testid="insp-instance-detach"
          disabled={!editable}
          {...reasonProps(!editable && !info.repeats, editReason(ctx))}
          onClick={() => ask(ctx, 'component.detach', el)}
        >
          Detach
        </button>
      </div>
      <Quiet testid="insp-instance-detach-line">
        {`Detach keeps this exact look as a plain frame. Nothing breaks; it stops following ${info.label}.`}
      </Quiet>
    </section>
  );
}

let offs = [];

/** Register the kind and its blocks (idempotent; tests that unregistered call it again). */
export function registerInstanceKind() {
  if (offs.length) return;
  offs = [
    registerKind({ id: 'instance', label: 'Instance', order: 24, match: isInstance }),
    registerBlock({
      id: 'instance.component',
      kinds: ['instance'],
      at: 'top',
      order: 10,
      Body: ComponentBody,
    }),
    registerBlock({
      id: 'instance.content',
      kinds: ['instance'],
      at: 'top',
      order: 20,
      Body: ContentBody,
    }),
    registerBlock({
      id: 'instance.main',
      kinds: ['instance'],
      at: 'bottom',
      order: 10,
      Body: MainBody,
    }),
  ];
}

export const offInstance = () => {
  for (const off of offs) off();
  offs = [];
};

registerInstanceKind();
