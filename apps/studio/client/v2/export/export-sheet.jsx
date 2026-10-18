// client/v2/export/export-sheet.jsx — S8.2: the ONE Export sheet (09 Export; Gate 0 D3).
//
//   ⇧⌘E · Menu › Export… · the inspector's export buttons · a world-menu entry · Version history all come
//   here (`openExport`, use-export-spec.js). Scope sits on top every time with its artboard counts; the
//   section below it is what the kind needs (a post → PNG/JPG, a web page → full page or PDF), Other…
//   lists every other format, and the verb in the title is the verb on the button. ↵ runs it.
//
// Props are the v1 dialog's (client/dialogs/export-dialog.jsx is now a shim over this), plus:
//   request          the shell's `exportDialog` object: { mode, scope?, format?, scale?, … }
//   designRel        the design root, repo-relative (a spec's `canvas` is designRoot-relative)
//   hasSelection     is something selected on the active canvas? (nothing → This canvas)
//   selectedArtboards / selectedElements   DCArtboard ids · V2-1.4 element ids of that selection
//   selectionLabel   the one selected thing's name, for the title

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultScopeForFormat, isScopeValidForFormat } from '../../../exporters/format-scopes.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { StIcon } from '../../shell/icons.jsx';
import { basename, displayName } from '../../shell/util.js';
import { menuRunner } from '../shell/menu-runner.js';
import { useModalFocus } from '../shell/modal-focus.js';
import {
  AGAIN_LABEL,
  HANDOFF_BODY,
  HANDOFF_BUTTON,
  HANDOFF_TITLE,
  LANE_NONE_NOTE,
  otherFormats,
  primaryLabel,
  RECENT_LABEL,
  SCOPE_LABEL,
  sheetSub,
  sheetTitle,
  summaryWords,
} from './export-copy.js';
import { AdvancedSection } from './advanced/advanced.jsx';
import { OtherFormats } from './other-formats.jsx';
import { laneBlocked, replayBody, runExport } from './run-export.js';
import { ScopeBar } from './scope-bar.jsx';
import { picksForOther } from './sections/batch-model.js';
import { BatchSection } from './sections/batch.jsx';
import { ImageSection } from './sections/image.jsx';
import { WebSection } from './sections/web.jsx';
import { ShareHint } from './share-hint.jsx';
import {
  browserLaneRequest,
  canvasRel,
  effectiveScale,
  folderRel,
  kindsOf,
  scopeAvailability,
  useExportPeople,
  useExportSpec,
} from './use-export-spec.js';

const ENGINE_SCOPE_LABEL = {
  selection: 'Current selection',
  artboard: 'Active artboard',
  'canvas-as-separate': 'Canvas · artboards separate',
  'canvas-whole': 'Whole canvas · one image',
  'selection-bounds': 'Selection area · one image',
  'project-raw': 'Whole project (raw)',
};

export function ExportSheet({
  mode: modeProp = 'export',
  initialScope,
  request,
  activePath,
  designRel = '.design',
  hasComps = false,
  activeArtboardId = null,
  selection = null,
  selectedArtboards,
  selectedElements,
  hasSelection,
  selectionLabel = null,
  projectName = '',
  exportLane = 'local',
  onBrowserCapture = null,
  onClose,
}) {
  const [mode, setMode] = useState(modeProp);
  const canvasOpen = !!activePath && activePath !== SYSTEM_TAB;
  const selected = hasSelection ?? (selection != null || (selectedArtboards?.length ?? 0) > 0);
  const ctx = useMemo(
    () => ({
      designRel,
      activePath: canvasOpen ? activePath : null,
      canvasOpen,
      artboards: selectedArtboards ?? [],
      elements: selectedElements ?? [],
      activeArtboardId,
      exportLane,
      estimate: mode === 'export',
    }),
    [
      designRel,
      activePath,
      canvasOpen,
      selectedArtboards,
      selectedElements,
      activeArtboardId,
      exportLane,
      mode,
    ]
  );
  const req = useMemo(
    () => ({
      ...(request ?? {}),
      ...(initialScope && !request?.scope ? { scope: initialScope } : {}),
    }),
    [request, initialScope]
  );
  const {
    state,
    set,
    setFormat,
    setScope,
    spec,
    est,
    kind,
    section,
    batch,
    kinds: specKinds,
  } = useExportSpec(req, {
    ...ctx,
    hasSelection: selected,
  });
  // S8.3 — what the Advanced fold's file-name preview is made from
  const kindSet = useMemo(() => new Set(specKinds), [specKinds]);
  const nameFacts = useMemo(
    () => ({
      project: projectName || basename(designRel) || 'Project',
      canvas: canvasRel(ctx),
      label: selectionLabel,
    }),
    [projectName, designRel, ctx, selectionLabel]
  );
  const people = useExportPeople();

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { ok, msg }
  const [otherOpen, setOtherOpen] = useState(false);
  const [recent, setRecent] = useState([]);
  const primary = useRef(null);
  const root = useModalFocus({ onClose, esc: false, initialRef: primary });

  // DDR-231 T7 — wake the render service the moment the sheet opens on a remote-lane workspace.
  useEffect(() => {
    if (exportLane !== 'remote') return;
    fetch('/_api/export-warmup').catch(() => {});
  }, [exportLane]);

  const loadRecent = useCallback(() => {
    fetch('/_api/export-history')
      .then((r) => r.json())
      .then((d) => setRecent(Array.isArray(d?.history) ? d.history.slice(0, 6) : []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const counts = est?.counts ?? null;
  const available = scopeAvailability(counts, {
    canvasOpen,
    hasSelection: selected || !!activeArtboardId,
    hasFolder: !!folderRel(ctx),
  });
  const kinds = useMemo(() => {
    const k = kindsOf(est);
    if (hasComps) k.add('video');
    return k;
  }, [est, hasComps]);
  const groups = useMemo(
    () => otherFormats({ kinds, laneBlocked: (f) => laneBlocked(f, exportLane) }),
    [kinds, exportLane]
  );

  const count = counts?.[state.scope] ?? null;
  const canvasName = canvasOpen ? displayName(basename(activePath)) : '';
  const folder = folderRel(ctx);
  const title =
    mode === 'handoff'
      ? HANDOFF_TITLE
      : sheetTitle({
          scope: state.scope,
          label: selectionLabel,
          canvas: canvasName,
          folder: folder ? basename(folder) : '',
          count,
        });
  const sub =
    mode === 'handoff'
      ? ''
      : sheetSub({
          canvas: canvasName,
          folder: state.scope === 'folder' ? folder : null,
          nothingSelected: state.nothingSelected && state.scope === 'canvas',
        });
  const summary = mode === 'export' ? summaryWords(est) : null;
  const button = mode === 'handoff' ? HANDOFF_BUTTON : primaryLabel({ count, busy });

  // ── submit ───────────────────────────────────────────────────────────────────────────────────
  const submit = () => {
    if (busy) return;
    if (mode === 'handoff') {
      const p = canvasOpen ? activePath : '<canvas>.tsx';
      const cmd = `/design:handoff ${p}`;
      Promise.resolve(navigator.clipboard?.writeText(cmd)).catch(() => {});
      setStatus({ ok: true, msg: `Copied: ${cmd} — run it in Claude Code.` });
      return;
    }
    runExport({
      body: { v: 2, spec },
      format: state.format,
      legacy: browserLaneRequest(state, { ...ctx, kind }),
      exportLane,
      onBrowserCapture,
      activePath,
      ui: { setStatus, setBusy, onClose },
    });
  };

  // "Export again" on a Recent row — through the sheet's own submit path (D3; S8.4 moves the row).
  const exportAgain = (h) => {
    const body = replayBody(h, { isScopeValidForFormat, defaultScopeForFormat });
    runExport({
      body,
      format: body.v === 2 ? body.spec.format : body.format,
      legacy: body.v === 2 ? null : body,
      exportLane,
      onBrowserCapture,
      activePath,
      ui: { setStatus, setBusy, onClose },
    });
  };

  const pickOther = (row) => {
    if (row.handoff) {
      setMode('handoff');
      setStatus(null);
      return;
    }
    // a batch: the format goes to every kind that can be made in it (a deck or a ZIP is one format for all)
    const picks = batch ? picksForOther(row, specKinds, state.kindPicks) : null;
    if (picks) set({ kindPicks: picks });
    else setFormat(row.format);
    setStatus(null);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'Enter' && !e.defaultPrevented && !e.shiftKey) {
      // ↵ runs it from anywhere a native Enter would do nothing useful (a radio, a checkbox, the sheet)
      const t = e.target;
      const role = t.getAttribute?.('role');
      const isCheck = t.tagName === 'INPUT' && t.type === 'checkbox';
      if (role === 'radio' || isCheck || t === e.currentTarget) {
        e.preventDefault();
        submit();
      }
    }
  };

  const copyLink = () => {
    menuRunner.run('share.copy-link');
  };
  const handoff = () => {
    setMode('handoff');
    setStatus(null);
  };

  const other = (
    <OtherFormats
      groups={groups}
      format={state.format}
      onPick={pickOther}
      open={otherOpen}
      setOpen={setOtherOpen}
    />
  );
  const annotationsOff = false;
  const Section =
    section === 'batch' ? BatchSection : section === 'web' ? WebSection : ImageSection;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim closes the sheet on a press outside it
    <div
      className="ex-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={root}
        className="ex-sheet island"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ex-title"
        tabIndex={-1}
        data-testid="export-sheet"
        data-mode={mode}
        data-scope={state.scope}
        onKeyDown={onKeyDown}
      >
        <div className="ex-sheet-hd">
          <h2 className="ex-title" id="ex-title" data-testid="export-title">
            {title}
          </h2>
          {sub ? (
            <p className="ex-sheet-sub" data-testid="export-sub">
              {sub}
            </p>
          ) : null}
        </div>

        {mode === 'handoff' ? (
          <p className="ex-hand" data-testid="export-handoff-body">
            {HANDOFF_BODY}
          </p>
        ) : (
          <>
            <ScopeBar
              scope={state.scope}
              counts={counts}
              available={available}
              onPick={(s) => {
                setScope(s);
                setStatus(null);
              }}
            />
            {exportLane === 'none' ? (
              <p className="ex-lane" data-testid="export-lane-note">
                {LANE_NONE_NOTE}
              </p>
            ) : null}
            <div className="ex-rows" data-testid="export-rows" data-section={section}>
              <Section
                state={state}
                set={set}
                setFormat={(f) => {
                  setFormat(f);
                  setStatus(null);
                }}
                other={other}
                onHandoff={handoff}
                annotationsOff={annotationsOff}
                est={est}
              />
            </div>
            <AdvancedSection
              state={state}
              set={set}
              spec={spec}
              kinds={kindSet}
              exportLane={exportLane}
              facts={nameFacts}
              batch={batch}
              sheetScale={effectiveScale(state, kind)}
            />
            <ShareHint names={people} onCopyLink={copyLink} />
          </>
        )}

        {status ? (
          <div
            className={`ex-status ${status.ok ? 'ex-status--ok' : 'ex-status--err'}`}
            data-testid="export-status"
            data-ok={status.ok ? '1' : '0'}
            role="status"
          >
            {status.msg}
          </div>
        ) : null}
        {summary ? (
          <p className="ex-sum" data-testid="export-summary">
            {summary}
          </p>
        ) : null}

        {mode === 'export' && recent.length > 0 ? (
          <div className="st-export-recent ex-recent" data-testid="export-recent">
            <p className="ex-recent-h">{RECENT_LABEL}</p>
            {recent.map((h, i) => (
              <div className="st-export-recent-row ex-recent-row" key={`${h.at ?? ''}-${i}`}>
                <span>
                  {String(h.format || '').toUpperCase()} ·{' '}
                  {ENGINE_SCOPE_LABEL[h.scope] || SCOPE_LABEL[h.scope] || h.scope}
                </span>
                <span className="ex-recent-f">{h.filename}</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  data-testid={`export-recent-again-${i}`}
                  disabled={busy}
                  onClick={() => exportAgain(h)}
                >
                  {AGAIN_LABEL}
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="ex-sheet-a">
          {mode === 'handoff' ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setMode('export')}
            >
              Back to export
            </button>
          ) : (
            <span />
          )}
          <span className="ex-btns">
            <button type="button" className="btn" data-testid="export-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              ref={primary}
              type="button"
              className="btn btn--primary ex-go"
              data-testid="export-submit"
              disabled={busy}
              onClick={submit}
            >
              {mode === 'handoff' ? null : <StIcon name="download" size={14} />}
              <span data-testid="export-submit-label">{button}</span>
              <span className="ex-ret" aria-hidden="true">
                ↵
              </span>
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
