// client/v2/diagnostics/sync-details/sync-details.jsx — S11.12 (06 ad-syncd): Menu › Diagnostics ›
// Sync, rebuilt. The controls carry the v1 hooks the e2e scenarios drive (S11.12b): sync-panel (root) ·
// sync-ai-held · sync-ai-publish · sync-ai-discard · sync-assets-cancel · sync-signin-again ·
// sync-delivery-attention · sync-deletes-held (+ -delete / -keep / -confirm / -cancel / -said /
// -folders / -confirming) · sync-deletes-purging · sync-hub-only. Replaces the v1 Sync panel's mount in the sheet (its routes stay; SyncPanel.jsx and
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
import { readCodeConsent } from '../../code/code-consent.js';
import { CodeConsentSheet } from '../../code/code-consent-sheet.jsx';
import { menuRunner } from '../../shell/menu-runner.js';
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

/**
 * fix/207 — shared code from the project's hub: the held row's "Allow shared code…" and, once it is
 * allowed on this Mac, "Stop allowing shared code…". Both open the confirm sheet; the server writes
 * the answer (POST /_api/sync/code-consent/set) and the next pass brings what was held.
 */
export function useCodeConsent(fetchImpl, seq = 0) {
  const [consent, setConsent] = useState(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read when the held rows change
  useEffect(() => {
    let live = true;
    readCodeConsent(fetchImpl).then((c) => {
      if (live) setConsent(c);
    });
    return () => {
      live = false;
    };
  }, [seq]);
  return [consent, setConsent];
}

function CodeConsentButton({ mode, host, fetchImpl, onDone }) {
  const [open, setOpen] = useState(false);
  const stop = mode === 'stop';
  return (
    <>
      <button
        type="button"
        className="sd-link"
        data-action={stop ? 'sync.stop-code' : 'sync.allow-code'}
        data-testid={stop ? 'diag-sync-stop-code' : 'diag-sync-allow-code'}
        onClick={() => setOpen(true)}
      >
        {stop ? 'Stop allowing shared code…' : 'Allow shared code…'}
      </button>
      {open ? (
        <CodeConsentSheet
          mode={mode}
          host={host}
          fetchImpl={fetchImpl}
          onClose={() => setOpen(false)}
          onDone={(c) => {
            setOpen(false);
            onDone?.(c);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * #167 T5.3 — held rows whose way out is the canvas folders: the hub's code-held list (the owner's
 * read) and this Mac's own canvases outside the canvas folders (item 6). "Open canvas folders"
 * (`sync.open-canvas-folders`) opens config.json, where they are set — a native door, so only in
 * the Mac app; the row's sentence names the verb everywhere.
 */
export const FOLDERS_HELD_KINDS = new Set(['code-held', 'canvas-outside-folders']);

/** "Adopt as code" (`sync.adopt-as-code`) on one file of the hub's code-held list — owner only:
 *  that list reaches the owner alone, and the hub's door refuses anyone else. */
function AdoptButton({ rel, index, fetchImpl }) {
  const [said, setSaid] = useState(null);
  const [busy, setBusy] = useState(false);
  if (said)
    return (
      <span className="dg-hint" data-testid={`diag-sync-held-adopt-said-${index}`}>
        {said}
      </span>
    );
  return (
    <button
      type="button"
      className="sd-link"
      data-action="sync.adopt-as-code"
      data-testid={`diag-sync-held-adopt-${index}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await postJson(fetchImpl, '/_api/sync/adopt-held', { path: rel });
        setBusy(false);
        setSaid(
          r?.ok
            ? 'Kept as code. It syncs on the next pass.'
            : cleanName(r?.detail || r?.message, 'That didn’t work. Nothing changed.', 200)
        );
      }}
    >
      Adopt as code
    </button>
  );
}

const filesWord = (n) => `${n.toLocaleString('en-US')} ${n === 1 ? 'file' : 'files'}`;

/** Issue #207 (7b) — the words after an answer to held deletes (CONTRACT §3–§4: plain, no "we"). */
export function heldDeletesWords(answer) {
  if (!answer?.ok) return safeDetail(answer?.detail, 'That didn’t work. Nothing was deleted.');
  if (answer.how === 'keep')
    return `Kept on the hub. ${filesWord(answer.count)} stay there and aren’t downloaded again.`;
  if (answer.how === 'purge')
    return `Deleting ${filesWord(answer.count)} on the hub. A batch this big takes a few minutes.`;
  return `Deleting ${filesWord(answer.count)} on the hub.`;
}

/**
 * Issue #207 (7b) — Deleted on this Mac, held: a batch of local deletes larger than sync sends unasked.
 * Delete on the hub too… asks once more (the batch reaches every teammate), then sends it as one
 * confirmed batch; Keep on the hub leaves the files there and never downloads them again. Both
 * `POST /_api/sync/held-deletes`; the server picks the hub's door or the owner's confirmed purge.
 */
function HeldDeletesCard({ need, fetchImpl }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [done, setDone] = useState(false);
  async function answer(kind) {
    setBusy(true);
    setSaid('');
    const r = await postJson(fetchImpl, '/_api/sync/held-deletes', { answer: kind, folder: null });
    setBusy(false);
    setConfirming(false);
    setSaid(heldDeletesWords(r));
    if (r?.ok) setDone(true);
  }
  const n = need.count;
  return (
    <div className="sd-card" data-testid="sync-deletes-held">
      <strong className="sd-ct">Deleted on this Mac · {filesWord(n)}</strong>
      <span className="sd-cd">{need.detail}</span>
      {need.folders.length ? (
        <ul className="sd-failed" data-testid="sync-deletes-held-folders">
          {need.folders.map((f) => (
            <li key={f.folder}>
              <span className="dg-mono">{cleanName(f.folder, 'the project folder')}</span>{' '}
              {filesWord(f.count)}
            </li>
          ))}
        </ul>
      ) : null}
      {done ? null : confirming ? (
        <div className="sd-acts" data-testid="sync-deletes-held-confirming">
          <span className="sd-cd">
            Move {filesWord(n)} to the hub’s trash? Each teammate confirms on their own Mac.
          </span>
          <button
            type="button"
            className="dg-btn dg-btn--primary"
            data-testid="sync-deletes-held-confirm"
            disabled={busy}
            onClick={() => answer('delete')}
          >
            Move to the hub’s trash
          </button>
          <button
            type="button"
            className="dg-btn"
            data-testid="sync-deletes-held-cancel"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="sd-acts">
          <button
            type="button"
            className="dg-btn"
            data-action="sync.delete-held-on-hub"
            data-testid="sync-deletes-held-delete"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            Move to the hub’s trash too…
          </button>
          <button
            type="button"
            className="dg-btn"
            data-action="sync.keep-held-on-hub"
            data-testid="sync-deletes-held-keep"
            disabled={busy}
            onClick={() => answer('keep')}
          >
            Keep on the hub
          </button>
        </div>
      )}
      {said ? (
        <p className="dg-hint" role="status" data-testid="sync-deletes-held-said">
          {said}
        </p>
      ) : null}
    </div>
  );
}

/** Issue #207 (7b) — the owner's purge of held deletes: how far it is, or why it stopped. */
function DeletesPurgingCard({ need }) {
  return (
    <div className="sd-card" data-testid="sync-deletes-purging">
      <strong className="sd-ct">
        {need.error
          ? 'Deleting on the hub stopped.'
          : `Deleting on the hub · ${need.done.toLocaleString('en-US')} of ${filesWord(need.total)}`}
      </strong>
      {need.error ? <span className="sd-cd">{need.error}</span> : null}
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

/** 1 234 567 890 → "1.1 GB"; below a gigabyte, whole megabytes. */
function sizeWord(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`;
}

/**
 * Issue #207 — a long run of pictures going up (a render sequence), and the folders this project
 * leaves out. Never a warning: the pictures sync like every other file; leaving the folder out is
 * an option, and "Sync it again" undoes it. Both write `linkedHub.ignoreFolders` through
 * `/_api/sync/settings`; the next pass applies it.
 */
function FoldersSection({ sequences, ignored, fetchImpl }) {
  const [left, setLeft] = useState(() => new Set());
  const [back, setBack] = useState(() => new Set());
  const [said, setSaid] = useState('');
  const change = async (body, done) => {
    setSaid('');
    const res = await postJson(fetchImpl, '/_api/sync/settings', body);
    if (res?.ok) done();
    else setSaid('That didn’t save. Nothing changed — try again.');
  };
  const shown = sequences.filter((s) => !ignored.includes(s.folder));
  const still = ignored.filter((f) => !back.has(f));
  if (!shown.length && !still.length) return null;
  return (
    <section aria-label="Large folders" data-testid="sync-folders">
      {shown.map((s, i) => (
        <div className="sd-card" key={s.folder} data-testid={`sync-large-seq-${i}`}>
          <strong className="sd-ct">
            {cleanName(s.folder)} · {s.files.toLocaleString()} pictures · {sizeWord(s.bytes)}
          </strong>
          {left.has(s.folder) ? (
            <span className="sd-cd" role="status" data-testid={`sync-large-seq-left-${i}`}>
              Left out from the next sync. What’s already in the project stays there.
            </span>
          ) : (
            <>
              <span className="sd-cd">
                They go up like every other file, and a run this long takes a while. You can keep
                this folder on this Mac only.
              </span>
              <div className="sd-acts">
                <button
                  type="button"
                  className="dg-btn"
                  data-action="sync.ignore-folder"
                  data-testid={`sync-large-seq-ignore-${i}`}
                  onClick={() =>
                    change({ addIgnoreFolder: s.folder }, () =>
                      setLeft((prev) => new Set(prev).add(s.folder))
                    )
                  }
                >
                  Don’t sync this folder
                </button>
              </div>
            </>
          )}
        </div>
      ))}
      {still.length ? (
        <div data-testid="sync-ignored-folders">
          <p className="sd-sub">Not synced · {still.length}</p>
          {still.map((f, i) => (
            <div className="dg-row" key={f} data-testid={`sync-ignored-folder-${i}`}>
              <span className="dg-k dg-mono">{cleanName(f)}</span>
              <button
                type="button"
                className="dg-btn"
                data-action="sync.sync-folder-again"
                data-testid={`sync-ignored-folder-resume-${i}`}
                onClick={() =>
                  change({ removeIgnoreFolder: f }, () => setBack((prev) => new Set(prev).add(f)))
                }
              >
                Sync it again
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {said ? (
        <p className="dg-hint" role="alert">
          {said}
        </p>
      ) : null}
    </section>
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
  // #167 T5.3 — a held row's registry actions (sync.open-canvas-folders) run through the one runner
  runAction = (id, params) => menuRunner.run(id, params),
}) {
  const p = syncPresentation(status, { project });
  const m = syncDetailsModel(status, { project, cloud, native, refused: p?.phase === 'refused' });
  const [cancelled, setCancelled] = useState(false);
  const codeHeld = m.lists.held.find((h) => h.kind === 'code-consent');
  const [consent, setConsent] = useCodeConsent(fetchImpl, codeHeld ? codeHeld.paths.length + 1 : 0);
  const canChange = consent?.changeable === true;
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
            ) : need.kind === 'deletes-held' ? (
              <HeldDeletesCard key="deletes-held" need={need} fetchImpl={fetchImpl} />
            ) : need.kind === 'deletes-purging' ? (
              <DeletesPurgingCard key="deletes-purging" need={need} />
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

      <FoldersSection
        sequences={m.lists.sequences}
        ignored={m.lists.ignoredFolders}
        fetchImpl={fetchImpl}
      />

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
            <div key={h.kind}>
              <details className="sd-held" data-testid={`diag-sync-held-${h.kind}`}>
                <summary>{h.detail}</summary>
                <ul>
                  {h.paths.map((rel, i) => (
                    <li key={rel}>
                      {cleanName(rel)}
                      {h.kind === 'code-held' ? (
                        <>
                          {' '}
                          <AdoptButton rel={rel} index={i} fetchImpl={fetchImpl} />
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
              {FOLDERS_HELD_KINDS.has(h.kind) && native ? (
                <button
                  type="button"
                  className="sd-link"
                  data-action="sync.open-canvas-folders"
                  data-testid={`diag-sync-held-open-folders-${h.kind}`}
                  onClick={() => runAction('sync.open-canvas-folders')}
                >
                  Open canvas folders
                </button>
              ) : null}
              {h.kind === 'code-consent' && canChange && !consent.allowed ? (
                <CodeConsentButton
                  mode="allow"
                  host={consent.host}
                  fetchImpl={fetchImpl}
                  onDone={setConsent}
                />
              ) : null}
            </div>
          ))}
          {canChange && consent.allowed && consent.how !== 'cell' ? (
            <p className="dg-hint" data-testid="diag-sync-code-allowed">
              Shared code from {consent.host} is allowed on this Mac.{' '}
              <CodeConsentButton
                mode="stop"
                host={consent.host}
                fetchImpl={fetchImpl}
                onDone={setConsent}
              />
            </p>
          ) : null}
          {m.lists.hubOnly.count ? (
            <details className="sd-held" data-testid="sync-hub-only">
              <summary>
                On the hub only · {filesWord(m.lists.hubOnly.count)} — deleted on this Mac and kept
                on the hub. They aren’t downloaded again.
              </summary>
              <ul>
                {m.lists.hubOnly.paths.map((rel) => (
                  <li key={rel}>{cleanName(rel)}</li>
                ))}
              </ul>
            </details>
          ) : null}
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
