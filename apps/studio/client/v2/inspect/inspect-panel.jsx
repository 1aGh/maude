// client/v2/inspect/inspect-panel.jsx — S3.11: the Inspect panel (04 Modes · md-inspect, Gate 0 "specs without
// the knobs"). A floating island on the right, 300 wide, for the one element a ⌘-click (Preview) or a plain
// click (Viewing) is pointing at.
//
//   Book a call  [Button]
//   Size and spacing      Size · Padding · Corners · Gap to <neighbour>
//   Colour and type       Fill · Text · Text colour — tokens by name
//   Export                PNG 1× · PNG 2× · SVG · Handoff…      → the shell's Export sheet
//   [ Copy code ]  [ Edit ↵ ]
//   › Advanced CSS        the authored declarations
//
// READ-ONLY by construction: values are words and numbers, there is no input, no select, no toggle. The two
// actions are the only doors out: Copy code (the element's JSX through the S11.8 slice; Can view is refused
// by the server and never shown the button) and Edit ↵ (asks for Edit, only drawn for a role that can).
// Pure presentational — the host (inspect-host.jsx) supplies the selection, the role and the handlers.

import { useEffect, useRef, useState } from 'react';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import { copyText } from '../inspector/advanced-rows-default.jsx';
import { bindInspectorActions } from '../inspector/inspector-actions.js';
import { NO_CODE_FOR_VIEW, readElementCode } from '../inspector/element-code.js';
import { Kbd, StIcon } from '../../shell/icons.jsx';
import { inspectRows } from './inspect-model.js';

/** The four Export buttons and what each asks the sheet for (S8 reads `format` / `scale` when it lands). */
export const EXPORT_BUTTONS = Object.freeze([
  {
    id: 'png-1x',
    label: 'PNG 1×',
    ask: { mode: 'export', scope: 'selection', format: 'png', scale: 1 },
  },
  {
    id: 'png-2x',
    label: 'PNG 2×',
    ask: { mode: 'export', scope: 'selection', format: 'png', scale: 2 },
  },
  { id: 'svg', label: 'SVG', ask: { mode: 'export', scope: 'selection', format: 'svg' } },
  { id: 'handoff', label: 'Handoff…', ask: { mode: 'handoff', scope: 'selection' } },
]);

function Group({ title, children }) {
  return (
    <>
      <p className="sh-inspect-g">{title}</p>
      {children}
    </>
  );
}

function ValueRow({ k, v, swatch }) {
  return (
    <div className="insp-arow">
      <span className="insp-ak">{k}</span>
      <span className="insp-av sh-inspect-v">
        {swatch ? (
          <span className="sh-inspect-sw" style={{ background: swatch }} aria-hidden="true" />
        ) : null}
        {v}
      </span>
    </div>
  );
}

/**
 * @param selected the selection payload (one element), or null → nothing drawn
 * @param layersTree the canvas's layer tree (the layer's own name)
 * @param canvasFile the open canvas's path (Copy code reads its source)
 * @param access `{ readOnly, canEdit, canCode }` — S11.8's advancedAccess(cfg, role)
 * @param onExport ({ mode, scope, format?, scale? }) → the shell's Export sheet
 * @param onEdit asks the shell for Edit with this element selected
 * @param fetchImpl tests inject
 */
export function InspectPanel({
  selected,
  layersTree,
  canvasFile,
  access,
  onExport,
  onEdit,
  fetchImpl,
  style,
}) {
  const el = Array.isArray(selected) ? (selected.length === 1 ? selected[0] : null) : selected;
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  // a different element starts with a clean line
  // biome-ignore lint/correctness/useExhaustiveDependencies: resets on a fresh selection only.
  useEffect(() => setNote(''), [el?.id, el?.index]);

  const canCode = !!access?.canCode;
  const canEdit = !!access?.canEdit;

  const copyCode = async () => {
    setNote('');
    if (!canCode) return NO_CODE_FOR_VIEW;
    const r = await readElementCode({ canvasFile, id: el.id, index: el.index ?? 0, fetchImpl });
    if (!r.ok) {
      setNote(r.message);
      return r.message;
    }
    const ok = await copyText(r.code);
    setCopied(ok);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
    return ok ? 'Copied the code.' : 'Not copied; try again.';
  };
  const copyRef = useRef(copyCode);
  copyRef.current = copyCode;

  // ⌘K "Copy code" runs on the element this panel shows (the same bus the Inspector's fold binds)
  const bindable = !!el?.id;
  useEffect(() => {
    if (!bindable) return undefined;
    return bindInspectorActions({ 'inspect.copy-code': () => copyRef.current() });
  }, [bindable]);

  if (!el) return null;
  const rows = inspectRows(el, layersTree);

  return (
    <aside
      className="island island--pad sh-inspect"
      style={style}
      aria-label="Inspect"
      data-testid="inspect-panel"
    >
      <div className="insp-hd">
        <strong className="insp-title" data-testid="inspect-name">
          {rows.name}
        </strong>
        <span className="insp-chip" data-testid="inspect-kind">
          {rows.kind}
        </span>
      </div>

      <Group title="Size and spacing">
        {rows.size.map((r) => (
          <ValueRow key={r.k} {...r} />
        ))}
      </Group>

      {rows.colour.length ? (
        <Group title="Colour and type">
          {rows.colour.map((r) => (
            <ValueRow key={r.k} {...r} />
          ))}
        </Group>
      ) : null}

      <Group title="Export">
        <div className="sh-inspect-ex">
          {EXPORT_BUTTONS.map((b) => (
            <button
              key={b.id}
              type="button"
              className="btn btn--sm"
              data-testid={`inspect-export-${b.id}`}
              onClick={() => onExport?.(b.ask)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </Group>

      {canCode || canEdit ? (
        <div className="sh-inspect-acts">
          {canCode ? (
            <button
              type="button"
              className="btn btn--primary"
              data-testid="inspect-copy-code"
              onClick={() => void copyCode()}
            >
              <StIcon name="code" size={14} />
              {copied ? 'Copied' : 'Copy code'}
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className="btn"
              data-testid="inspect-edit"
              onClick={() => onEdit?.()}
            >
              Edit
              <Kbd>↵</Kbd>
            </button>
          ) : null}
        </div>
      ) : null}
      {note ? (
        <p className="insp-err sh-inspect-note" role="alert" data-testid="inspect-copy-code-note">
          {note}
        </p>
      ) : null}

      {rows.css.length ? (
        <AdvancedFold panel="inspect" hint="CSS" testid="inspect-advanced">
          <div className="insp-csslist">
            {rows.css.map(([k, v]) => (
              <div className="sh-inspect-css" key={k}>
                <span className="insp-mono sh-inspect-ck">{k}</span>
                <span className="insp-mono sh-inspect-cv">{v}</span>
              </div>
            ))}
          </div>
        </AdvancedFold>
      ) : null}
    </aside>
  );
}
