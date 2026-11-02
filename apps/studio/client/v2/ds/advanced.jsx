// client/v2/ds/advanced.jsx — S10.19: Design system › Advanced (13 · ds-advanced; 06 · ad-ds is its old home).
//
// With nothing selected on a system's own Design system canvas the inspector shows the SYSTEM: its name, how many
// canvases follow it, its modes, a Check the system button, and — one fold down — everything today's folder had:
// the tokens file as CSS or JSON (read only; mono only here), the `system/<ds>/` folder, Hand off tokens and Reveal
// in Finder. Under it: which way changes flow, the system's own version history, and the check's card.
//
// For designers the canvas is the source; the files are generated from it and are the source for code and agents.
// This file draws what the host (advanced-host.jsx) read; the files are never written from here.

import { useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { ADVANCED_WORDS, FLOW_ROWS, modesLine, usedByLine } from './advanced-model.js';
import { useDsAdvancedStore } from './advanced-store.js';
import { CheckCard } from './check-card.jsx';
import { DsLibrarySlot } from './library-card.jsx';
import { agoWords } from './update-model.js';

function Row({ k, children, testid }) {
  return (
    <div className="dsa-row" data-testid={testid}>
      <span className="dsa-row-k">{k}</span>
      <span className="dsa-row-v">{children}</span>
    </div>
  );
}

function FilesList({ files }) {
  return (
    <div className="dsa-tree dsa-mono" data-testid="ds-advanced-files">
      {files.map((f) => (
        <span
          key={f.names.join('|')}
          className={f.depth === 1 ? 'dsa-tree-1' : undefined}
          data-testid={f.depth === 0 ? 'ds-advanced-folder' : undefined}
        >
          <StIcon name={f.kind === 'folder' ? 'folder' : 'file'} size={12} />
          {f.names.join(' · ')}
          {f.note ? <em>{f.note}</em> : null}
        </span>
      ))}
    </div>
  );
}

function TokensView({ files }) {
  const [which, setWhich] = useState('css');
  const one = which === 'css' ? files?.css : files?.json;
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: a two-file toggle, not a form fieldset */}
      <div className="dsa-seg" role="group" aria-label="Tokens file">
        {['css', 'json'].map((k) => (
          <button
            key={k}
            type="button"
            className="dsa-seg-b"
            aria-pressed={which === k}
            data-testid={`ds-advanced-seg-${k}`}
            onClick={() => setWhich(k)}
          >
            {ADVANCED_WORDS[k]}
          </button>
        ))}
      </div>
      <pre className="dsa-code dsa-mono" data-testid="ds-advanced-code" data-file={one?.file ?? ''}>
        {one?.present ? one.text : ADVANCED_WORDS.noFile}
      </pre>
    </>
  );
}

function History({ rows, onRestore, now }) {
  return (
    <section className="dsa-card" data-testid="ds-history" aria-label={ADVANCED_WORDS.historyTitle}>
      <p className="dsa-card-title">{ADVANCED_WORDS.historyTitle}</p>
      {rows.length === 0 ? <p className="dsa-quiet">{ADVANCED_WORDS.nothingPublished}</p> : null}
      {rows.map((r, i) => (
        <span key={r.rev + r.action + i} className="dsa-hist" data-testid={`ds-history-row-${i}`}>
          <span className={`dsa-hist-ic dsa-hist-ic--${r.kind}`} aria-hidden="true">
            <StIcon
              name={r.kind === 'ai' ? 'sparkle' : r.kind === 'file' ? 'file' : 'pen'}
              size={12}
            />
          </span>
          <span className="dsa-hist-t">
            <b>{r.who}</b>
            {r.text}
          </span>
          {r.at ? <em>{agoWords(r.at, now)}</em> : null}
        </span>
      ))}
      {rows.length ? (
        <span className="dsa-hist-acts">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            data-testid="ds-history-restore"
            onClick={onRestore}
          >
            {ADVANCED_WORDS.restore}
          </button>
        </span>
      ) : null}
    </section>
  );
}

/**
 * @param {{ value: any, actions: any, now?: number }} props
 */
export function DsAdvanced({ value, actions, now }) {
  if (!value?.ds) return null;
  const { files, check, busy, note, native } = value;
  const used = usedByLine(value.canvases, value.project);
  const modes = modesLine(value.modes);
  const a = actions ?? {};
  return (
    <div className="dsa" data-testid="ds-advanced" data-system={value.ds}>
      <div className="dsa-hd">
        <strong>{value.label}</strong>
        <span className="chip">{ADVANCED_WORDS.title}</span>
      </div>
      {/* S10.18c — the card, when this system is a linked team library */}
      <DsLibrarySlot />
      {used ? <Row k="Used by">{used}</Row> : null}
      {modes ? <Row k="Modes">{modes}</Row> : null}
      <Row k="Check">
        <button
          type="button"
          className="btn btn--sm"
          disabled={!!busy}
          data-testid="ds-check-button"
          onClick={() => a.check?.()}
        >
          <StIcon name="check" size={12} />
          {busy ? ADVANCED_WORDS.checking : ADVANCED_WORDS.check}
        </button>
      </Row>
      {note ? (
        <p className="dsa-note" role="status" data-testid="ds-advanced-note">
          {note}
        </p>
      ) : null}
      {/* closed like every Advanced fold (rc.1 finding 5): the tokens, the folder and Hand off are one click down */}
      <details className="dsa-adv" data-testid="ds-advanced-fold">
        <summary>
          {ADVANCED_WORDS.advanced}
          <span>{ADVANCED_WORDS.advancedHint}</span>
        </summary>
        <div className="dsa-adv-body" data-testid="ds-advanced-body">
          <TokensView files={files} />
          <p className="dsa-k">{ADVANCED_WORDS.files}</p>
          <FilesList files={files?.files ?? []} />
          <span className="dsa-acts">
            <button
              type="button"
              className="btn btn--sm"
              data-testid="ds-handoff-tokens"
              onClick={() => a.handoff?.()}
            >
              <StIcon name="export" size={12} />
              {ADVANCED_WORDS.handoff}
              <kbd className="kbd">⇧⌘H</kbd>
            </button>
            {native ? (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                data-testid="ds-reveal-files"
                onClick={() => a.reveal?.()}
              >
                {ADVANCED_WORDS.reveal}
              </button>
            ) : null}
          </span>
        </div>
      </details>
      <section className="dsa-card" data-testid="ds-flow" aria-label={ADVANCED_WORDS.flowTitle}>
        <p className="dsa-card-title">{ADVANCED_WORDS.flowTitle}</p>
        {FLOW_ROWS.map((r) => (
          <span key={r.id} className="dsa-flow">
            <span className="dsa-flow-ic" aria-hidden="true">
              <StIcon name={r.icon} size={14} />
            </span>
            <span>
              <b>{r.lead}</b> — {r.rest}
            </span>
          </span>
        ))}
      </section>
      <History rows={files?.history ?? []} onRestore={() => a.history?.()} now={now} />
      {/* the card closes the column, after the history (the board) */}
      <CheckCard check={check} now={now} onShow={a.show} onAskAi={a.askAi} />
    </div>
  );
}

/** For the inspector's empty place: the system's panel, or null when no system canvas is open. */
export function useDsAdvanced() {
  const { value, actions } = useDsAdvancedStore();
  return value?.ds ? <DsAdvanced value={value} actions={actions} /> : null;
}
