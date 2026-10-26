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
//   selectionSize   {w,h} of the one selected thing as the canvas draws it (an element has no size in the estimate)
//   access           S8.9 — the shell's `{ canEdit, role }` (access-line.jsx): Can comment gets one line on top and
//                    "Needs Can edit" on Handoff; Can view gets no sheet at all (the server refuses too)
//   lastFinishedAt   S8.9 — ms timestamp of the last finished version, for "From 14:05" while AI is working
//   aiRuns           S8.9 — a `GET /_api/ai/runs` view (tests); default = the shell's runs store
//   printGuidesVisible  S8.7 — View › Print guides is on? "Show on canvas" turns it on when it is not (false only)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultScopeForFormat, isScopeValidForFormat } from '../../../exporters/format-scopes.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { useFold } from '../fold/use-fold.js';
import { useAiRuns } from '../ai/runs-store.js';
import { basename, displayName } from '../../shell/util.js';
import { dispatchArtboardJump } from '../left-panel/left-panel-bus.js';
import { menuRunner } from '../shell/menu-runner.js';
import { useModalFocus } from '../shell/modal-focus.js';
import {
  AGAIN_LABEL,
  HANDOFF_BUTTON,
  HANDOFF_TITLE,
  LANE_NONE_NOTE,
  folderLabel,
  otherFormats,
  primaryLabel,
  RECENT_LABEL,
  SCOPE_LABEL,
  sheetSub,
  sheetTitle,
  estimateForLane,
  summaryWords,
} from './export-copy.js';
import { AdvancedSection, AdvancedToggle } from './advanced/advanced.jsx';
import { nameSamples } from './advanced/model.js';
import {
  FILE_NAMES_OPTIONS,
  FILE_NAMES_TEMPLATE,
  FOLDERS_OPTIONS,
  FileRows,
  fileNamesPick,
  SAVE_TO_DEFAULT,
} from './file-rows.jsx';
import { fitBox, Pic, PreviewColumn, sizeLine, useBoardPicture } from './preview.jsx';
import { AccessLine, exportAccess } from './access-line.jsx';
import { annotationsState } from './annotations-policy.js';
import { OtherFormats } from './other-formats.jsx';
import { canvasDir } from '../../../exporters/file-names.ts';
import { laneBlocked, replayBody, runExport } from './run-export.js';
import { ScopeBar } from './scope-bar.jsx';
import { picksForOther } from './sections/batch-model.js';
import { BatchAdvancedRows, BatchSection } from './sections/batch.jsx';
import { ImageSection } from './sections/image.jsx';
import { PrintSection, printChoices } from './sections/print.jsx';
import { AiHint, aiOnTarget, HANDOFF_NEEDS_EDIT, VersionRow } from './sections/version.jsx';
import { videoButtonLabel } from './sections/video-copy.js';
import { VideoFilm, VideoSection } from './sections/video.jsx';
import { VISIBLE_HEIGHT, WebCodeLine, WebSection } from './sections/web.jsx';
import { Select } from './advanced/fields.jsx';
import { Row } from './parts.jsx';
import { FOLD_HINT, FOLD_HINT_BATCH } from './advanced/advanced-copy.js';
import { RenderRow } from './sections/render-row.jsx';
import { useOnline } from './cloud-queue.js';
import { readLanePref, renderChoice, withRenderLane } from '../../export-lane.js';
import { usePreflight } from './preflight/use-preflight.js';
import { HandoffSheet } from '../handoff/handoff-sheet.jsx';
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

/** Save to is `options.saveTo`: the sheet always says where the file lands, so it always sends it. */
export const withSaveTo = (spec, saveTo) => ({
  ...spec,
  options: { ...(spec.options ?? {}), saveTo },
});

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
  selectionSize = null,
  projectName = '',
  exportLane = 'local',
  onBrowserCapture = null,
  access = null,
  lastFinishedAt = null,
  aiRuns = null,
  printGuidesVisible = null,
  onClose,
}) {
  // Handoff writes code into the project: a Can comment opener lands on Export, never on Handoff (S8.9)
  const [mode, setMode] = useState(() =>
    modeProp === 'handoff' && !exportAccess(access).canHandoff ? 'export' : modeProp
  );
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
    pictures,
    kind,
    section,
    batch,
    kinds: specKinds,
    video,
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
  // 09 — the File name row: the server's own naming (`renderStem`) of this export's first file
  const fileSamples = useMemo(
    () => nameSamples(spec, state.adv?.nameTemplate, [...kindSet], nameFacts),
    [spec, state.adv?.nameTemplate, kindSet, nameFacts]
  );
  const people = useExportPeople();
  // S8.9 — who may export, and whether AI is changing what this export reaches
  const acc = useMemo(() => exportAccess(access), [access]);
  const liveRuns = useAiRuns();
  const aiInfo = aiOnTarget(aiRuns ?? liveRuns.view, {
    activeCanvas: canvasOpen ? activePath : null,
    scope: state.scope,
    artboards: selectedArtboards,
    activeArtboardId,
  });
  const waitForAi = aiInfo.working && aiInfo.mine && state.wait === 'ai';
  // S8.7 — a print page: paper, the back, the safe margin and the fonts, asked once per thing exported
  const preflight = usePreflight(spec, { enabled: mode === 'export' && section === 'print' });
  // the back is page 2 by default ("back as page 2", 09 ex-formats): once the pairing is found and the person has
  // not said otherwise, the box is ticked in the state — so the spec the button sends is the preview they see
  const foundBack = preflight?.boards?.[0]?.back ?? null;
  const backTouched = state.adv?.back != null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a back appearing matters
  useEffect(() => {
    if (foundBack && !backTouched) set({ adv: { ...(state.adv ?? {}), back: true } });
  }, [foundBack?.id, backTouched]);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { ok, msg }
  // S8.5 — a video's Render row: cloud or this Mac (Suggest each time / always, export-lane.js)
  const online = useOnline();
  const [pickedLane, setPickedLane] = useState(null);
  const lanePref = state.adv?.lane ?? readLanePref();
  const render = useMemo(
    () =>
      renderChoice({
        pref: lanePref,
        render: est?.render ?? null,
        online,
        picked: pickedLane,
        seconds: est?.seconds ?? null,
      }),
    [lanePref, est, online, pickedLane]
  );
  // 09 — one artboard exported (a post, a web page, a video, a print page): its picture + its size line beside the rows
  const videoRow = section === 'video' ? (video.rows?.[0] ?? null) : null;
  const board =
    mode !== 'export' || state.scope !== 'selection'
      ? null
      : est?.boards?.length === 1
        ? sizedBoard(est.boards[0], selectionSize)
        : videoRow
          ? {
              canvas: videoRow.canvas,
              id: videoRow.artboard,
              label: videoRow.label,
              kind: 'video',
              w: videoRow.w,
              h: videoRow.h,
            }
          : null;
  const picture = useBoardPicture(onBrowserCapture, board, {
    enabled: !!board && section !== 'batch',
  });
  const [advOpen, setAdvOpen] = useFold('export');
  const [otherOpen, setOtherOpen] = useState(false);
  const [recent, setRecent] = useState([]);
  const primary = useRef(null);
  // The sheet runs its own esc ladder (the "Other…" menu first); 'bubble' adds the net under it: the Export
  // button disables itself while it works, which drops focus to <body> — and esc reached nobody (P8 B1).
  const root = useModalFocus({ onClose, esc: 'bubble', initialRef: primary });

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
    () =>
      otherFormats({
        kinds,
        laneBlocked: (f) => laneBlocked(f, exportLane),
        canHandoff: acc.canHandoff,
      }),
    [kinds, exportLane, acc.canHandoff]
  );

  const count = counts?.[state.scope] ?? null;
  // the one artboard the sheet exports is named by the artboard's own label (the server's index knows it even
  // when the canvas's selection carried only an id — a video, a comp)
  const titleLabel =
    state.scope === 'selection' && est?.boards?.length === 1 && est.boards[0].label
      ? est.boards[0].label
      : selectionLabel;
  const canvasName = canvasOpen ? displayName(basename(activePath)) : '';
  const folder = folderRel(ctx);
  const canvasCounts = est?.canvasCounts ?? null;
  // 09 ex-print: the print file's own choices (the back page, the PDF) name themselves in the title and the summary
  const printChoice =
    section === 'print' ? printChoices(state, preflight) : { printPdf: false, withBack: false };
  const title =
    mode === 'handoff'
      ? HANDOFF_TITLE
      : sheetTitle({
          scope: state.scope,
          label: titleLabel,
          canvas: canvasName,
          folder,
          count,
          canvases: canvasCounts,
          project: projectName,
          withBack: printChoice.withBack,
        });
  const sub =
    mode === 'handoff'
      ? ''
      : sheetSub({
          scope: state.scope,
          canvas: canvasName,
          folder: state.scope === 'folder' ? folder : null,
          nothingSelected: state.nothingSelected && state.scope === 'canvas',
          where: folderLabel(folder) || projectName || '',
          kind: section === 'print' ? 'print' : null,
          canvases: canvasCounts,
        });
  const summary =
    mode === 'export'
      ? summaryWords(
          // 09 ex-video / 07 ve-export: the words follow the Render card that is ticked, not the estimate's lane
          estimateForLane(est, render),
          printChoice.printPdf ? { pdfPages: printChoice.withBack ? 2 : 1 } : undefined
        )
      : null;
  const button =
    mode === 'handoff'
      ? HANDOFF_BUTTON
      : section === 'video'
        ? videoButtonLabel({ n: video.ticked.length, format: state.format, busy })
        : primaryLabel({ count, busy });

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
      body: {
        v: 2,
        spec: withRenderLane(
          withSaveTo(waitForAi ? { ...spec, wait: 'ai' } : spec, state.saveTo ?? SAVE_TO_DEFAULT),
          render
        ),
      },
      format: state.format,
      // a held export is a server job; the browser lane captures NOW, which is the other choice
      legacy: waitForAi ? null : browserLaneRequest(state, { ...ctx, kind }),
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

  // S8.7 — Show on canvas: the sheet gets out of the way, the camera goes to the artboard (and its flash),
  // and the print guides — the dashed safe margin — come on if they were off
  const showOnCanvas = (finding) => {
    if (printGuidesVisible === false) menuRunner.run('view.print-guides');
    if (activePath && finding?.artboard) dispatchArtboardJump(activePath, finding.artboard);
    onClose();
  };

  const pickOther = (row) => {
    if (row.format === 'pdf') set({ printPdf: row.id === 'print-pdf' });
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
    if (!acc.canHandoff) {
      setStatus({ ok: false, msg: HANDOFF_NEEDS_EDIT });
      return;
    }
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
  // S4.20 (an-print) — a print file never carries the layer: the box is disabled, with the line saying why
  const annot = annotationsState(state.format, { kinds: specKinds });
  const Section =
    section === 'batch'
      ? BatchSection
      : section === 'web'
        ? WebSection
        : section === 'print'
          ? PrintSection
          : section === 'video'
            ? VideoSection
            : ImageSection;

  // Can view has no Export (A19): the entry points are absent and the server answers 403; if a stale
  // opener still gets here, there is nothing to draw.
  if (!acc.canExport) return null;

  // S8.10 — Handoff to production is its own sheet (client/v2/handoff/): targets, one scoped AI run, Ready.
  // Design system › Hand off tokens (S10.19) asks for `target: 'tokens'` of a system, not a canvas.
  if (mode === 'handoff') {
    const tokensOf =
      request?.target === 'tokens' && typeof request?.ds === 'string' ? request.ds : null;
    return (
      <HandoffSheet
        subject={tokensOf ? { ds: tokensOf } : { canvas: canvasRel(ctx) }}
        name={tokensOf ?? canvasName}
        askedTarget={request?.target ?? null}
        onClose={onClose}
        onBack={modeProp === 'handoff' ? null : () => setMode('export')}
        onShowOnCanvas={
          activePath && activeArtboardId
            ? () => {
                dispatchArtboardJump(activePath, activeArtboardId);
                onClose();
              }
            : onClose
        }
      />
    );
  }

  const filesMore = Math.max(0, (est?.files ?? 1) - 1);
  const single = (est?.files ?? 1) === 1;
  const fileRows = (
    <FileRows
      file={fileSamples[0] ?? ''}
      more={filesMore}
      onName={single ? (stem) => set({ adv: { ...(state.adv ?? {}), nameTemplate: stem } }) : null}
      saveTo={state.saveTo}
      onSaveTo={(saveTo) => set({ saveTo })}
      folders={
        batch ? (
          state.scope === 'selection' ? (
            // 09 ex-batch-pick: several artboards picked → how the files are named; the folder row is for a canvas / more
            <Row k="File names" testid="export-row-file-names">
              <Select
                label="File names"
                testid="export-file-names"
                value={fileNamesPick(state.adv?.nameTemplate)}
                options={FILE_NAMES_OPTIONS}
                onChange={(id) =>
                  set({
                    adv: { ...(state.adv ?? {}), nameTemplate: FILE_NAMES_TEMPLATE[id] },
                  })
                }
              />
              <span className="ex-row-n ex-row-n--in" data-testid="export-file-names-note">
                {fileSamples[0] ?? ''}
              </span>
            </Row>
          ) : (
            <Row k="Folders" testid="export-row-folders">
              {/* 09: a select with the path it makes under it: all in one folder, or one folder per canvas (spec options.folders) */}
              <Select
                label="Folders"
                testid="export-folders"
                value={state.adv?.folders === 'per-canvas' ? 'per-canvas' : 'one'}
                options={FOLDERS_OPTIONS}
                onChange={(id) => set({ adv: { ...(state.adv ?? {}), folders: id } })}
              />
              <span className="ex-row-n ex-row-n--in" data-testid="export-folders-note">
                {state.adv?.folders === 'per-canvas' && nameFacts.canvas
                  ? `${canvasDir(nameFacts.canvas)} · ${fileSamples[0] ?? ''}`
                  : (fileSamples[0] ?? '')}
              </span>
            </Row>
          )
        ) : null
      }
    />
  );

  // the preview column: one artboard → its picture and its size line (print draws its own paper)
  const previewCol =
    board && section !== 'print' ? (
      <PreviewColumn>
        {section === 'web' ? (
          <WebPreview board={board} src={picture} />
        ) : section === 'video' ? (
          <VideoPreview board={board} src={picture} />
        ) : (
          <ImagePreview board={board} src={picture} />
        )}
      </PreviewColumn>
    ) : null;

  const sectionProps = {
    state,
    set,
    setFormat: (f) => {
      setFormat(f);
      setStatus(null);
    },
    other,
    onHandoff: handoff,
    annotationsOff: annot.off,
    annotationsNote: annot.note,
    est,
    pictures,
    video,
    preflight,
    onShowOnCanvas: showOnCanvas,
    board,
  };

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
        data-section={section}
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

        <div className="ex-sheet-main" data-testid="export-main">
          <AccessLine line={acc.line} />
          <AiHint info={aiInfo} />
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
          <VersionRow
            info={aiInfo}
            value={waitForAi ? 'ai' : 'now'}
            lastFinishedAt={lastFinishedAt}
            onPick={(v) => set({ wait: v === 'ai' ? 'ai' : null })}
          />
          <div className="ex-sheet-body" data-testid="export-body">
            {previewCol}
            {section === 'print' ? (
              <Section {...sectionProps} picture={picture} tail={fileRows} />
            ) : (
              <div className="ex-rows" data-testid="export-rows" data-section={section}>
                <Section {...sectionProps} />
                <RenderRow choice={render} onPick={setPickedLane} />
                {fileRows}
                {section === 'web' ? <WebCodeLine onHandoff={handoff} /> : null}
              </div>
            )}
          </div>
          {section === 'video' ? <VideoFilm video={video} designRel={designRel} /> : null}
          <AdvancedSection
            open={advOpen}
            state={state}
            set={set}
            spec={spec}
            kinds={kindSet}
            exportLane={exportLane}
            facts={nameFacts}
            sheetScale={effectiveScale(state, kind)}
            bleedMm={preflight?.boards?.[0]?.paper?.bleedMm ?? 3}
            extra={
              batch ? (
                <BatchAdvancedRows
                  state={state}
                  set={set}
                  other={other}
                  annotationsOff={annot.off}
                  annotationsNote={annot.note}
                />
              ) : null
            }
          />
          <ShareHint names={people} onCopyLink={copyLink} />

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

          {recent.length > 0 ? (
            <div className="ex-export-recent ex-recent" data-testid="export-recent">
              <p className="ex-recent-h">{RECENT_LABEL}</p>
              {recent.map((h, i) => (
                <div className="ex-export-recent-row ex-recent-row" key={`${h.at ?? ''}-${i}`}>
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
        </div>

        {summary ? (
          <p className="ex-sum" data-testid="export-summary">
            {summary}
          </p>
        ) : null}

        <div className="ex-sheet-a">
          <AdvancedToggle
            open={advOpen}
            onToggle={() => setAdvOpen((v) => !v)}
            hint={batch ? FOLD_HINT_BATCH : FOLD_HINT}
          />
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

/** 09 ex-social — a post: its picture, then "1080 × 1350". */
/**
 * p8-bugs3 #1 — the estimate indexes ARTBOARDS: for one selected element it answers a board with no size. The
 * selection knows how big the canvas draws that element, so the chips and the size line read it from there
 * (never "0 × 0").
 */
function sizedBoard(board, size) {
  if (!board || Number.isFinite(board.w) || !size) return board;
  return { ...board, w: size.w, h: size.h };
}

function ImagePreview({ board, src }) {
  const box = fitBox(board.w, board.h, 136, 170);
  return <Pic w={box.w} h={box.h} src={src} cap={sizeLine(board.w, board.h)} />;
}

/** 09 ex-web — a long page: its picture, the first screen dashed, and its size line. */
function WebPreview({ board, src }) {
  const box = fitBox(board.w, board.h, 92, 200);
  const fold = Math.min(1, VISIBLE_HEIGHT / Math.max(1, board.h ?? VISIBLE_HEIGHT));
  return (
    <Pic
      w={box.w}
      h={box.h}
      src={src}
      cap={
        <>
          {sizeLine(board.w, board.h)}
          <br />
          dashed: visible area
        </>
      }
    >
      <span className="ex-long-fold" style={{ height: `${fold * 100}%` }} aria-hidden="true" />
    </Pic>
  );
}

/** 09 ex-video — the poster frame (the artboard as it draws) and the way to pick another. */
function VideoPreview({ board, src }) {
  const box = fitBox(board.w, board.h, 120, 213);
  return (
    <Pic
      w={box.w}
      h={box.h}
      src={src}
      cap={
        <>
          Frame at 0:00
          <br />
          scrub the strip below
        </>
      }
    />
  );
}
