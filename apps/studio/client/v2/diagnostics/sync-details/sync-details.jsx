// client/v2/diagnostics/sync-details/sync-details.jsx — S11.12 (06 ad-syncd): Menu › Diagnostics ›
// Sync, rebuilt. The controls carry the v1 hooks the e2e scenarios drive (S11.12b): sync-panel (root) ·
// sync-ai-held · sync-ai-publish · sync-ai-discard · sync-assets-cancel · sync-signin-again ·
// sync-delivery-attention. Replaces the v1 Sync panel's mount in the sheet (its routes stay; SyncPanel.jsx and
// SourceConflictPanel.jsx keep their files). What needs the person comes first, each with its own
// choice; the transfer, the counts and the lists follow.
//
// The picks run registry actions — sync.keep-mine · sync.use-theirs · sync.keep-both (the held source
// conflict, `POST /_api/project/conflict`), sync.publish-ai-edit · sync.discard-ai-edit
// (`POST /_api/project/ai-action`), sync.cancel-transfer (`POST /_api/sync/cancel-assets`) and
// sync.sign-in-again (the sign-in dialog). The server gates every write (minRole edit for the picks).

import { useEffect, useRef, useState } from 'react';
import { MEDIA_STAYS_LINE, MEDIA_STAYS_NEXT } from '../../../../sync/media-gate.ts';
import { safeDetail, syncPresentation } from '../../../../sync/presentation.ts';
import { lineDiff } from '../../../panels/SourceConflictPanel.jsx';
import { DELIVERY_WORD, cleanName, resolvedWords, syncDetailsModel } from './sync-details-model.js';

/** Registry id → the `choice` the conflict route takes. */
export const CONFLICT_PICK = Object.freeze({
  'sync.keep-mine': 'mine',
  'sync.use-theirs': 'theirs',
  'sync.keep-both': 'keep-both',
});
export const AI_PICK = Object.freeze({
  'sync.publish-ai-edit': 'publish',
  'sync.discard-ai-edit': 'discard',
});

async function postJson(fetchImpl, url, body) {
  try {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    return await r.json().catch(() => ({ ok: r.ok }));
  } catch {
    return { ok: false, error: 'Maude isn’t reachable right now.' };
  }
}

/** The held source conflict's pick (`sync.keep-mine` / `sync.use-theirs` / `sync.keep-both`). */
export function resolveFileConflict(slug, actionId, fetchImpl = fetch) {
  return postJson(fetchImpl, '/_api/project/conflict', {
    file: slug,
    choice: CONFLICT_PICK[actionId],
  });
}

/** `focusSeq` > 0 opens it at once and scrolls it into view — the Share cluster's Compare (Not saved while a
 *  held conflict waits) and its toast land here (p8-held-conflict-status); a new seq re-opens it. */
function Compare({ slug, fetchImpl, focusSeq = 0 }) {
  const [sides, setSides] = useState(null);
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  async function load() {
    const r = await fetchImpl(`/_api/project/conflict?file=${encodeURIComponent(slug)}`)
      .then((x) => x.json())
      .catch(() => null);
    setSides(r?.ok ? r : { ok: false });
  }
  async function toggle() {
    if (!open && !sides) await load();
    setOpen((o) => !o);
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new focus request re-opens it
  useEffect(() => {
    if (!focusSeq) return;
    let live = true;
    (sides ? Promise.resolve() : load()).then(() => {
      if (!live) return;
      setOpen(true);
      btnRef.current?.scrollIntoView?.({ block: 'nearest' });
    });
    return () => {
      live = false;
    };
  }, [focusSeq]);
  const rows = sides?.ok
    ? lineDiff(sides.mine ?? '', sides.theirs ?? '').filter((r) => r.kind !== 'same')
    : [];
  return (
    <>
      <button
        type="button"
        className="sd-link"
        ref={btnRef}
        aria-expanded={open}
        data-testid={`diag-sync-compare-${slug}`}
        onClick={toggle}
      >
        Compare
      </button>
      {open ? (
        <ol
          className="sd-diff"
          data-testid={`diag-sync-compare-lines-${slug}`}
          aria-label="What differs"
        >
          {sides && !sides.ok ? <li>The two versions can’t be read right now.</li> : null}
          {rows.slice(0, 80).map((r, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a static diff, never reordered
            <li key={i} data-side={r.kind}>
              <span className="sd-side">{r.kind === 'mine' ? 'Yours' : 'Cloud'}</span>
              <code>{r.text}</code>
            </li>
          ))}
        </ol>
      ) : null}
    </>
  );
}

function ConflictCard({ slug, canvasName, fetchImpl, onResolved, focusSeq = 0 }) {
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState('');
  const name = cleanName(canvasName || slug, 'This canvas');
  async function pick(actionId) {
    setBusy(actionId);
    setSaid('');
    const r = await resolveFileConflict(slug, actionId, fetchImpl);
    setBusy('');
    setSaid(resolvedWords(CONFLICT_PICK[actionId], r));
    if (r?.ok) onResolved?.(actionId, r);
  }
  const btn = (id, label) => (
    <button
      type="button"
      className="dg-btn"
      disabled={!!busy}
      data-action={id}
      data-testid={`diag-sync-${id.slice('sync.'.length)}-${slug}`}
      onClick={() => pick(id)}
    >
      {busy === id ? `${label}…` : label}
    </button>
  );
  return (
    <div className="sd-card" data-testid={`diag-sync-conflict-${slug}`}>
      <strong className="sd-ct">{name} changed here and in the cloud.</strong>
      <span className="sd-cd">Both versions are kept until you choose.</span>
      <div className="sd-acts">
        {btn('sync.keep-mine', 'Keep mine')}
        {btn('sync.use-theirs', 'Use theirs')}
        {btn('sync.keep-both', 'Keep both')}
        <Compare slug={slug} fetchImpl={fetchImpl} focusSeq={focusSeq} />
      </div>
      {said ? (
        <p className="dg-hint" role="status" data-testid={`diag-sync-conflict-note-${slug}`}>
          {said}
        </p>
      ) : null}
    </div>
  );
}

// The team server holds no media checkout (sync/media-gate.ts words): said once, with the next step.
function AssetsStayCard() {
  return (
    <div className="sd-card" data-testid="sync-assets-stay">
      <strong className="sd-ct">{MEDIA_STAYS_LINE}</strong>
      <span className="sd-cd">{MEDIA_STAYS_NEXT}</span>
    </div>
  );
}

function AssetsFailedCard({ need }) {
  const n = need.count;
  return (
    <div className="sd-card" data-testid="sync-assets-failed">
      <strong className="sd-ct">
        {n} media upload{n === 1 ? '' : 's'} failed.
      </strong>
      <span className="sd-cd">They try again the next time Maude starts. Nothing is lost.</span>
      {need.failures.length ? (
        <ul className="sd-failed" data-testid="sync-assets-failed-list">
          {need.failures.map((f) => (
            <li key={f.name}>
              <span className="dg-mono">{f.name}</span> {f.reason}
            </li>
          ))}
          {n > need.failures.length ? <li>+{n - need.failures.length} more</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function AiCard({ need, fetchImpl }) {
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState('');
  async function pick(actionId) {
    setBusy(actionId);
    setSaid('');
    const r = await postJson(fetchImpl, '/_api/project/ai-action', { choice: AI_PICK[actionId] });
    setBusy('');
    if (!r?.ok) setSaid(safeDetail(r?.error, 'That didn’t work. The edit is still on this Mac.'));
  }
  const n = need.canvases;
  return (
    <div className="sd-card" data-testid="sync-ai-held">
      <strong className="sd-ct">AI stopped halfway on {need.label}.</strong>
      <span className="sd-cd">
        It changed {n} canvas{n === 1 ? '' : 'es'} and didn’t finish. The half-done edit is on this
        Mac only.
      </span>
      <div className="sd-acts">
        {[
          ['sync.publish-ai-edit', 'Publish'],
          ['sync.discard-ai-edit', 'Discard'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="dg-btn"
            disabled={!!busy}
            data-action={id}
            data-testid={`sync-ai-${AI_PICK[id]}`}
            onClick={() => pick(id)}
          >
            {busy === id ? `${label}…` : label}
          </button>
        ))}
      </div>
      {said ? (
        <p className="dg-hint" role="alert">
          {said}
        </p>
      ) : null}
    </div>
  );
}

export default function SyncDetails({
  status,
  project,
  cloud,
  native = false,
  names = null,
  onSignInAgain,
  fetchImpl = fetch,
  // p8-held-conflict-status — open this held conflict's Compare (a slug), once per new `focusSeq`
  focusConflict = null,
  focusSeq = 0,
}) {
  const p = syncPresentation(status, { project });
  const m = syncDetailsModel(status, { project, cloud, native, refused: p?.phase === 'refused' });
  const [cancelled, setCancelled] = useState(false);
  return (
    <div className="sd" data-testid="sync-panel">
      <div className="dg-hd">
        <strong data-testid="diag-sync-title">{m.title}</strong>
        {m.needWord ? (
          <span className="dg-word" data-state="warn" data-testid="diag-sync-need-word">
            {m.needWord}
          </span>
        ) : null}
      </div>

      {m.needs.length ? (
        <section aria-label={`Needs you · ${m.needs.length}`} data-testid="diag-sync-needs">
          <p className="sd-sub">Needs you · {m.needs.length}</p>
          {m.needs.map((need) =>
            need.kind === 'conflict' ? (
              <ConflictCard
                key={need.slug}
                slug={need.slug}
                canvasName={names?.get?.(need.slug)}
                fetchImpl={fetchImpl}
                focusSeq={need.slug === focusConflict ? focusSeq || 1 : 0}
              />
            ) : need.kind === 'assets-failed' ? (
              <AssetsFailedCard key="assets-failed" need={need} />
            ) : need.kind === 'assets-stay' ? (
              <AssetsStayCard key="assets-stay" />
            ) : (
              <AiCard key="ai" need={need} fetchImpl={fetchImpl} />
            )
          )}
        </section>
      ) : null}

      {m.moving && !cancelled ? (
        <section aria-label="Moving now" data-testid="diag-sync-moving">
          <p className="sd-sub">Moving now</p>
          <div className="sd-xfer">
            <span className="dg-mono">
              {m.moving.name || `${m.moving.done} of ${m.moving.total}`}
            </span>
            <span
              className="dg-bar"
              role="progressbar"
              aria-label="Transfer"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={m.moving.pct}
            >
              <i style={{ width: `${m.moving.pct}%` }} />
            </span>
            <span className="sd-xfer-n">{m.moving.pct}%</span>
            <button
              type="button"
              className="dg-x"
              aria-label="Cancel the transfer"
              data-action="sync.cancel-transfer"
              data-testid="sync-assets-cancel"
              onClick={async () => {
                await postJson(fetchImpl, '/_api/sync/cancel-assets');
                setCancelled(true);
              }}
            >
              ✕
            </button>
          </div>
        </section>
      ) : null}

      {m.counts.length ? (
        <section aria-label="Counts" data-testid="diag-sync-counts">
          <p className="sd-sub">Counts</p>
          {m.counts.map(([id, k, v]) => (
            <div className="dg-row" key={id} data-testid={`diag-sync-count-${id}`}>
              <span className="dg-k">{k}</span>
              <span className="dg-v">{v}</span>
            </div>
          ))}
          {m.lists.rateLimited ? (
            <p className="dg-hint" data-testid="diag-sync-rate-limited">
              Syncing paused for a moment — the cloud asked this Mac to slow down.{' '}
              {m.lists.rateLimited.waiting > 0
                ? `${m.lists.rateLimited.waiting} file${m.lists.rateLimited.waiting === 1 ? '' : 's'} still on the way. Nothing is lost.`
                : 'It goes on by itself.'}
            </p>
          ) : null}
          {m.lists.held.map((h) => (
            <details className="sd-held" key={h.kind} data-testid={`diag-sync-held-${h.kind}`}>
              <summary>{h.detail}</summary>
              <ul>
                {h.paths.map((rel) => (
                  <li key={rel}>{cleanName(rel)}</li>
                ))}
              </ul>
            </details>
          ))}
          {m.lists.failed > 0 || m.lists.attention.length ? (
            <div data-testid="diag-sync-failed">
              {m.lists.attention.length ? (
                <ul className="sd-failed" data-testid="sync-delivery-attention">
                  {m.lists.attention.map(([rel, state]) => (
                    <li key={rel}>
                      <span className="dg-mono">{cleanName(rel, '(unnamed)')}</span>{' '}
                      {DELIVERY_WORD[state] || state}
                    </li>
                  ))}
                </ul>
              ) : null}
              {m.lists.failed > 0 ? (
                <ul className="sd-failed">
                  <li>
                    {m.lists.failed} file{m.lists.failed === 1 ? '' : 's'} didn’t come through —
                    sync tries again by itself.
                  </li>
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {m.signIn ? (
        <div className="sd-card" data-testid="diag-sync-signin">
          <strong className="sd-ct">Sync stopped — the sign-in to the cloud ran out.</strong>
          <span className="sd-cd">
            Your changes are kept on this Mac and go out after you sign in.
          </span>
          <div className="sd-acts">
            <button
              type="button"
              className="dg-btn dg-btn--primary"
              data-action="sync.sign-in-again"
              data-testid="sync-signin-again"
              onClick={() => onSignInAgain?.(typeof status?.url === 'string' ? status.url : '')}
            >
              Sign in again
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
