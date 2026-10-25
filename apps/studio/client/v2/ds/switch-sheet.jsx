// client/v2/ds/switch-sheet.jsx — S10.14: "Switch canvases to …?" (13 · ds-multi-switch).
//
// One review, nothing to map. The sheet asks with the verb its button repeats ("Switch canvases to Alligators brand?"
// → "Switch 5 canvases"). Every canvas has a tick: one that can move is ticked, one that is pinned or blocked
// cannot be ticked and says why. The Scope segments (This canvas · Folder · Whole project) re-ask the server, so
// the list is always what the server would write. The AI row is a switch: on, the person's Claude account restyles
// the canvases' own tokens in one undo step after the switch; off, they keep their look, marked off-system.
//
// Sheet only: the host (switch-host.jsx) fetches the review and does the write. `onScope(kind)` and `onTo(name)`
// ask the host for a new review; `onSwitch(rows, { restyle })` resolves to `{ ok: true }` or `{ ok: false, message }`.

import { useEffect, useMemo, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { useModalFocus } from '../shell/modal-focus.js';
import {
  defaultTicks,
  folderNote,
  groupByFolder,
  headWords,
  primaryWords,
  restyleSummary,
  restyleWords,
  rowNote,
  SWITCH_WORDS,
  schemaLine,
  switchRows,
  switchTitle,
  tickState,
  withTicks,
} from './switch-model.js';

const GROUP_FROM = 12; // as many canvases as review-sheet groups by folder

function Tick({ state, disabled, label, testid, onToggle, path, folder }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'mixed' ? 'mixed' : state === 'all' || state === true}
      aria-label={label}
      disabled={disabled}
      className="dsr-tick"
      data-state={state === true ? 'all' : state === false ? 'none' : state}
      data-testid={testid}
      data-path={path}
      data-folder={folder}
      onClick={onToggle}
    >
      <StIcon name="check" size={12} />
    </button>
  );
}

function Row({ row, fromLabel, onToggle, cover }) {
  return (
    <span
      className="dsr-row"
      data-off={row.ticked ? undefined : 'true'}
      data-locked={row.locked ? 'true' : undefined}
      data-testid="ds-switch-row"
      data-path={row.path}
    >
      <Tick
        state={row.ticked}
        disabled={row.locked}
        label={`Switch ${row.name}`}
        testid="ds-switch-tick"
        path={row.path}
        onToggle={() => onToggle(row.path)}
      />
      <span className="dsr-thumb" aria-hidden="true">
        {cover ? <img src={cover} alt="" /> : null}
      </span>
      <span className="dsr-name">
        <b>{row.name}</b>
        <em data-testid="ds-switch-note">{rowNote(row, { fromLabel })}</em>
      </span>
    </span>
  );
}

/**
 * @param {{
 *   review: any,
 *   to: string, toLabel: string,
 *   targets: { name: string, label: string }[],
 *   scope: string, scopes: { id: string, label: string }[],
 *   labelOf: (name: string | null) => string,
 *   coverOf?: (path: string) => string | null,
 *   fromOnly?: string | null,
 *   canAskAI?: boolean,
 *   onScope: (id: string) => void,
 *   onTo: (name: string) => void,
 *   onSwitch: (rows: any[], o: { restyle: boolean }) => Promise<{ ok: boolean, message?: string }>,
 *   onClose: () => void,
 * }} props
 */
export function DsSwitchSheet({
  review,
  to,
  toLabel,
  targets,
  scope,
  scopes,
  labelOf,
  coverOf,
  fromOnly = null,
  canAskAI = false,
  onScope,
  onTo,
  onSwitch,
  onClose,
  onBringUp,
}) {
  const base = useMemo(() => switchRows(review, { fromOnly }), [review, fromOnly]);
  const [ticks, setTicks] = useState(() => defaultTicks(base));
  // a new review (another scope or system) starts from the server's ticks again
  useEffect(() => setTicks(defaultTicks(base)), [base]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [restyleOn, setRestyleOn] = useState(true);
  const primaryRef = useRef(null);
  const ref = useModalFocus({ onClose, initialRef: primaryRef });

  const rows = useMemo(() => withTicks(base, ticks), [base, ticks]);
  const n = rows.filter((r) => r.ticked).length;
  const state = tickState(rows);
  const grouped = rows.length > GROUP_FROM;
  const groups = useMemo(() => (grouped ? groupByFolder(rows) : []), [grouped, rows]);
  const line = schemaLine(review);
  const restyle = restyleSummary(rows);
  const fromNames = [...new Set(rows.filter((r) => r.ticked && r.from).map((r) => r.from))];
  const words = restyleWords(restyle, {
    fromLabel: fromNames.length === 1 ? labelOf(fromNames[0]) : null,
  });
  const scopeLabel = scopes.find((s) => s.id === scope)?.label.replace(/^Folder · /, '') ?? '';
  const refused = review.refused;

  const flip = (paths, on) =>
    setTicks((t) => {
      const next = { ...t };
      for (const p of paths) next[p] = on;
      return next;
    });
  const toggle = (path) => flip([path], !ticks[path]);
  const toggleGroup = (g) =>
    flip(
      g.rows.filter((r) => !r.locked).map((r) => r.path),
      g.state !== 'all'
    );
  const toggleAll = () =>
    flip(
      rows.filter((r) => !r.locked).map((r) => r.path),
      state !== 'all'
    );

  const go = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    let res;
    try {
      res = await onSwitch(rows, { restyle: canAskAI && restyle.any && restyleOn });
    } catch {
      res = { ok: false, message: SWITCH_WORDS.failed };
    }
    setBusy(false);
    if (res?.ok === false) setError(res.message || SWITCH_WORDS.failed);
  };

  const list = (items) =>
    items.map((r) => (
      <Row
        key={r.path}
        row={r}
        fromLabel={r.from ? labelOf(r.from) : null}
        onToggle={toggle}
        cover={coverOf ? coverOf(r.path) : null}
      />
    ));

  return (
    <div className="dsr-scrim" data-testid="ds-switch-scrim">
      <div
        ref={ref}
        className="island dsr-dialog dss-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-switch-title"
        tabIndex={-1}
        data-testid="ds-switch"
        data-to={to}
      >
        <h2 id="ds-switch-title" className="dsr-title" data-testid="ds-switch-title">
          {switchTitle(toLabel)}
        </h2>
        <div className="dsr-body">
          <div className="dss-scope">
            <span className="dss-scope-k" id="ds-switch-scope-k">
              {SWITCH_WORDS.scope}
            </span>
            <span
              className="seg dss-seg"
              role="group"
              aria-labelledby="ds-switch-scope-k"
              data-testid="ds-switch-scope"
            >
              {scopes.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="k-seg-b"
                  aria-pressed={scope === s.id}
                  data-testid={`ds-switch-scope-${s.id}`}
                  onClick={() => scope !== s.id && onScope(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </span>
            {targets.length > 2 ? (
              <label className="dss-to">
                <span>{SWITCH_WORDS.to}</span>
                <select
                  value={to}
                  data-testid="ds-switch-to"
                  onChange={(e) => onTo(e.target.value)}
                >
                  {targets.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <p className="dsr-head">
            <Tick
              state={state}
              disabled={rows.every((r) => r.locked)}
              label="Switch every canvas"
              testid="ds-switch-head-tick"
              onToggle={toggleAll}
            />
            <b data-testid="ds-switch-head">{headWords(rows, scopeLabel)}</b>
          </p>

          <div
            className="dsr-list"
            data-testid="ds-switch-list"
            data-grouped={grouped || undefined}
          >
            {grouped
              ? groups.map((g) => (
                  <div key={g.folder || '.'} className="dsr-group" data-folder={g.folder}>
                    <span
                      className="dsr-row dsr-folder"
                      data-off={g.state === 'none' ? 'true' : undefined}
                      data-testid="ds-switch-folder"
                      data-folder={g.folder}
                    >
                      <Tick
                        state={g.state}
                        disabled={g.rows.every((r) => r.locked)}
                        label={`Switch ${g.folder || 'the top level'}`}
                        testid="ds-switch-folder-tick"
                        folder={g.folder}
                        onToggle={() => toggleGroup(g)}
                      />
                      <StIcon name="folder" size={14} />
                      <span className="dsr-name">
                        <b>{g.folder || 'Top level'}</b>
                      </span>
                      <em className="dsr-count">{folderNote(g)}</em>
                    </span>
                    {g.state !== 'all' ? <div className="dsr-in">{list(g.rows)}</div> : null}
                  </div>
                ))
              : list(rows)}
          </div>

          {refused ? (
            <p className="dss-line" data-tone="warn" role="alert" data-testid="ds-switch-refused">
              <StIcon name="problem" size={14} />
              <span>{SWITCH_WORDS.level11}</span>
              {onBringUp && refused.system ? (
                <button
                  type="button"
                  className="btn btn--sm dss-bring"
                  data-testid="ds-switch-bring-up"
                  data-ds={refused.system}
                  onClick={() => onBringUp(refused.system)}
                >
                  {SWITCH_WORDS.bringUp}
                </button>
              ) : null}
            </p>
          ) : (
            <p className="dss-line" data-tone={line.tone} data-testid="ds-switch-line">
              <StIcon name={line.tone === 'ok' ? 'check' : 'problem'} size={14} />
              {line.text}
            </p>
          )}

          {canAskAI && restyle.any && !refused ? (
            <span
              className="dss-ai"
              data-on={restyleOn ? 'true' : undefined}
              data-testid="ds-switch-ai-row"
            >
              <span className="dss-ai-t">
                <b>{words.title}</b>
                <em>{restyleOn ? words.sub : SWITCH_WORDS.restyleOff}</em>
              </span>
              <button
                type="button"
                role="switch"
                className="dss-switch"
                aria-checked={restyleOn}
                aria-label={words.title}
                data-testid="ds-switch-ai"
                onClick={() => setRestyleOn((v) => !v)}
              />
            </span>
          ) : null}

          <p className="dsr-fine" data-testid="ds-switch-fine">
            {SWITCH_WORDS.fine}
          </p>
          {error ? (
            <p className="dsr-err" role="alert" data-testid="ds-switch-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dsr-acts">
          <button
            type="button"
            className="btn"
            disabled={busy}
            data-testid="ds-switch-cancel"
            onClick={onClose}
          >
            {SWITCH_WORDS.cancel}
          </button>
          <button
            ref={primaryRef}
            type="button"
            className="btn btn--primary"
            disabled={busy || n === 0 || !!refused}
            data-testid="ds-switch-go"
            onClick={go}
          >
            {primaryWords(n)}
          </button>
        </div>
      </div>
    </div>
  );
}
