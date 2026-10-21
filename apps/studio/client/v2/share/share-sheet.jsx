// client/v2/share/share-sheet.jsx — S9.19: the ONE Share surface (CONTRACT §6 [C11]; 10
// co-share-sheet · co-share-roles). It replaces `client/share-dialog.jsx` (its testids re-emitted:
// `share-dialog` on the root, `share-<kind>-url` / `share-copy-<kind>` / `share-open-app` under
// "Other ways in", the "Close share dialog" button).
//
//   Share Combine-kampan                                   ×
//   [ This canvas | Whole project ]        ← only where the hub holds canvas grants (Q13)
//   [ Name or email ] [ Can edit ⌄ ] [ Invite ]            ← first, and focused (share-opens-on-invite)
//   3 people · 1 invited
//   …people, each with their role in words…
//   Anyone with the link · Can view   [Copy link]          ← only when the hub has links (Q13)
//   › Advanced · This link, other ways in, where it syncs   (S9.20, share-advanced.jsx)
//
// A LOCAL project's Share (desktop) offers Move to cloud instead (S9.20, move-to-cloud.jsx).
//
// Every change ASKS the project server through `/_api/share/*` (routes/share.ts → the linked hub's
// `/api/access/*`); the hub decides and its words are shown. What is drawn follows what the server
// reports (share-model.js `sheetView`), never the role name.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { RequestBlocks } from '../access/ask-to-edit.jsx';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import { useModalFocus } from '../shell/modal-focus.js';
import { InviteRow } from './invite-row.jsx';
import { copyShareLink } from './link-dialog.js';
import { LinkRow } from './link-row.jsx';
import { MoveToCloud, movingWords } from './move-to-cloud.jsx';
import { PeopleList } from './people-list.jsx';
import { ShareAdvanced } from './share-advanced.jsx';
import {
  advancedView,
  DEFAULT_LINK_RULES,
  errorWords,
  expiresAtFor,
  joinAsKey,
  lastSyncedAt,
  peopleRows,
  readJoinAs,
  roleWord,
  shareApi,
  sheetView,
  takeShareFocus,
  writeJoinAs,
} from './share-model.js';

function RemoveDialog({ row, scopeName, onCancel, onConfirm }) {
  const cancelRef = useRef(null);
  const ref = useModalFocus({ onClose: onCancel, initialRef: cancelRef });
  const what = row.invited ? `the invitation for ${row.name}` : row.name;
  return (
    <div className="v2sh-veil" role="presentation">
      <div
        ref={ref}
        className="v2sh-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="share-remove-title"
        data-testid="share-remove-dialog"
      >
        <p id="share-remove-title" className="v2sh-confirm-t">
          {row.invited ? `Take back ${what}?` : `Remove ${row.name} from ${scopeName}?`}
        </p>
        <p className="v2sh-hint">
          {row.invited
            ? 'The link in the e-mail stops working.'
            : `${row.name} can no longer open ${scopeName}. Their last changes are saved first.`}
        </p>
        <div className="v2sh-confirm-b">
          <button ref={cancelRef} type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger"
            data-testid="share-remove-confirm"
            onClick={onConfirm}
          >
            {row.invited ? 'Take back' : 'Remove'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ShareSheet({
  /** `{ path, rel, label }` — the canvas Share was opened for (rel = designRoot-relative). */
  target,
  /** buildShareLinks() — web / app / local addresses for "Other ways in". */
  links,
  shell,
  /** The project's name, for "Whole project" words. */
  project,
  /** The signed-in person's e-mail, to mark "You" (optional). */
  youEmail,
  onClose,
  api: apiProp,
  now,
}) {
  const api = useMemo(() => apiProp ?? shareApi(), [apiProp]);
  const [posture, setPosture] = useState(null);
  const [me, setMe] = useState(null);
  const [people, setPeople] = useState(null);
  const [scope, setScope] = useState('canvas');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirm, setConfirm] = useState(null);
  // S9.20 — the link this sheet made (`{ id, url }`), its rules, the one-shot focus, the move
  const [rules, setRules] = useState(DEFAULT_LINK_RULES);
  const [made, setMade] = useState(null);
  const [copied, setCopied] = useState(false);
  const [focus] = useState(() => takeShareFocus());
  const [postureAsk, setPostureAsk] = useState(0);
  const [moving, setMoving] = useState(null);
  // S9.20b — "New people join as" (this browser, per project) and "Last synced" (the sync runtime)
  const [joinAs, setJoinAs] = useState(null);
  const [lastSynced, setLastSynced] = useState(null);
  // gate-b-sec4 — `{ host }` while the folder's committed link waits for this Mac's Connect
  const [pendingLink, setPendingLink] = useState(null);
  const emailRef = useRef(null);
  const sheetRef = useModalFocus({ onClose });

  const view = sheetView({ posture, me, target, project, scope });
  const canvas = view.canvas;
  const joinKey = joinAsKey({ hub: posture?.hub, project });
  const joinRole = joinAs ?? readJoinAs(joinKey);
  const inviteDefault = view.inviteRoles.includes(joinRole) ? joinRole : view.defaultInviteRole;
  const pickJoinAs = (role) => {
    setJoinAs(role);
    writeJoinAs(joinKey, role);
  };

  // `postureAsk` asks again once a Move to cloud has linked the project.
  // biome-ignore lint/correctness/useExhaustiveDependencies: postureAsk is the re-ask trigger
  useEffect(() => {
    let live = true;
    (async () => {
      const [p, m] = await Promise.all([api.posture(), api.me()]);
      if (!live) return;
      setPosture(p.ok ? p.body : { linked: true, reachable: false });
      setMe(m.ok ? m.body : null);
    })();
    return () => {
      live = false;
    };
  }, [api, postureAsk]);

  // gate-b-sec4 — a local-looking project may be one whose folder names a hub this Mac never linked.
  const unlinkedHere = !!posture && !view.linked;
  useEffect(() => {
    if (!unlinkedHere || typeof api.pendingLink !== 'function') return undefined;
    let live = true;
    api.pendingLink().then((r) => {
      const host = r?.ok ? r.body?.pending?.host : null;
      if (live) setPendingLink(typeof host === 'string' && host ? { host } : null);
    });
    return () => {
      live = false;
    };
  }, [api, unlinkedHere]);

  const connectLink = () =>
    run(async () => {
      const r = await api.confirmLink();
      if (!r.ok || r.body?.ok === false) {
        setError(r.body?.detail || r.body?.message || 'Could not connect. Try again in a minute.');
        return;
      }
      setPendingLink(null);
      setPostureAsk((n) => n + 1);
    });

  // "Last synced" — read once the project is known to sync somewhere; no answer, no line.
  const linkedHere = view.linked;
  useEffect(() => {
    if (!linkedHere || typeof api.syncStatus !== 'function') return undefined;
    let live = true;
    api.syncStatus().then((r) => {
      if (live) setLastSynced(r?.ok ? lastSyncedAt(r.body) : null);
    });
    return () => {
      live = false;
    };
  }, [api, linkedHere]);

  // A move in progress: follow it, and ask the posture again once the project is linked.
  const moveState = moving?.state;
  useEffect(() => {
    if (!moveState || moveState === 'ready' || moveState === 'failed') return undefined;
    const t = setTimeout(async () => {
      const r = await api.moveState();
      const next = r.ok ? r.body : null;
      if (!next) return;
      setMoving(next);
      if (next.state === 'ready' || next.state === 'uploading') setPostureAsk((n) => n + 1);
      if (next.state === 'failed') setError(next.error || 'Moving to the cloud stopped.');
    }, 1500);
    return () => clearTimeout(t);
  }, [api, moveState]);

  // A new scope is another link: the one made for the other scope is not this one's.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on the scope only
  useEffect(() => {
    setMade(null);
  }, [canvas]);

  const loadPeople = useCallback(async () => {
    if (!view.linked || !view.reachable) return;
    const r = await api.people(canvas);
    setPeople(r.ok && Array.isArray(r.body?.people) ? r.body.people : []);
    if (!r.ok) setError(errorWords(r.body));
  }, [api, canvas, view.linked, view.reachable]);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  // Share opens on Invite: the field takes focus as soon as it is drawn.
  const inviteShown = view.linked && view.canInvite;
  useEffect(() => {
    // …unless the sheet was opened for one of its rows (⌘K Link settings…, Share on GitHub…).
    if (inviteShown && !focus) emailRef.current?.focus({ preventScroll: true });
  }, [inviteShown, focus]);

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  };

  const invite = ({ email, role }) =>
    run(async () => {
      setNotice(null);
      const r = await api.invite({ email, role, canvas });
      if (r.status === 202 && r.body?.queued) {
        setNotice({
          kind: 'queued',
          text: r.body.words ?? 'Invites send when this Mac is online.',
        });
        return true;
      }
      if (!r.ok) {
        setError(errorWords(r.body));
        return false;
      }
      // A self-hosted hub sends no mail: the owner passes the invitation link on (S9-slices Q7).
      if (r.body?.sent === false && typeof r.body?.url === 'string')
        setNotice({ kind: 'link', email, url: r.body.url });
      else setNotice({ kind: 'sent', text: `Invited ${email} · ${roleWord(role)}` });
      await loadPeople();
      return true;
    });

  const act = (row, choice) =>
    run(async () => {
      let r;
      if (choice.kind === 'remove') {
        setConfirm(row);
        return;
      }
      if (choice.kind === 'resend') r = await api.resend(row.id);
      else if (choice.kind === 'owner') r = await api.setRole(row.id, 'owner', null);
      else r = await api.setRole(row.id, choice.role, canvas);
      if (!r.ok) setError(errorWords(r.body));
      else if (choice.kind === 'resend' && typeof r.body?.url === 'string')
        setNotice({ kind: 'link', email: row.name, url: r.body.url });
      await loadPeople();
    });

  const remove = (row) =>
    run(async () => {
      setConfirm(null);
      const r = row.invited ? await api.revoke(row.id) : await api.remove(row.id, canvas);
      if (!r.ok) setError(errorWords(r.body));
      await loadPeople();
    });

  const owner = view.canInvite;
  const flash = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  // Copy link: the owner makes the link with the rules (the server refuses anyone else); everyone
  // else copies the location, which grants nothing.
  const copyLink = () =>
    run(async () => {
      if (!owner) {
        if (links?.web && (await copyShareLink(links.web))) flash();
        return;
      }
      let url = made?.url;
      if (!url) {
        const r = await api.createLink({
          role: rules.role,
          who: rules.who,
          expiresAt: expiresAtFor(rules.expires, now ?? Date.now()),
          canvas,
        });
        if (!r.ok || typeof r.body?.id !== 'string' || typeof r.body?.url !== 'string') {
          setError(errorWords(r.body));
          return;
        }
        url = r.body.url;
        setMade({ id: r.body.id, url });
      }
      if (await copyShareLink(url)) flash();
    });
  const changeRule = (patch) =>
    run(async () => {
      const next = { ...rules, ...patch };
      setRules(next);
      if (!made) return; // the rules wait for the link Copy link makes
      const body = {};
      if (patch.who !== undefined) body.who = patch.who;
      if (patch.role !== undefined) body.role = patch.role;
      if (patch.expires !== undefined)
        body.expiresAt = expiresAtFor(patch.expires, now ?? Date.now());
      const r = await api.patchLink(made.id, body);
      if (!r.ok) {
        setRules(rules);
        setError(errorWords(r.body));
        return;
      }
      // Turning a team link into `anyone` mints a new secret: the address changes.
      if (typeof r.body?.url === 'string') setMade({ id: made.id, url: r.body.url });
    });
  const turnOff = () =>
    run(async () => {
      if (!made) return;
      const r = await api.patchLink(made.id, { off: true });
      if (!r.ok) setError(errorWords(r.body));
      else {
        setMade(null);
        setNotice({
          kind: 'sent',
          text: 'The link is off. Anyone who opened it with it no longer can.',
        });
      }
    });
  const adv = advancedView({ view, shell, hubUrl: posture?.hub });
  const offerMove = posture && !view.linked && shell === 'native' && !moving && !pendingLink;

  const rows = peopleRows(people, { youEmail, now });
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim is a pointer convenience (esc and the close button close the sheet for the keyboard)
    <div
      className="v2sh-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className="v2sh-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={view.title}
        tabIndex={-1}
        data-testid="share-dialog"
        data-scope={view.scope}
        data-linked={view.linked ? 'true' : 'false'}
      >
        <div className="v2sh-hd">
          <p className="v2sh-t">{view.title}</p>
          <button
            type="button"
            className="v2sh-x"
            aria-label="Close share dialog"
            data-testid="share-close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {offerMove && (
          <MoveToCloud project={project} api={api} onCancel={onClose} onMoving={setMoving} />
        )}
        {moving && movingWords(moving.state) && (
          <p className="v2sh-hint" role="status" data-testid="share-moved">
            {movingWords(moving.state)}
          </p>
        )}
        {posture && !view.linked && pendingLink && (
          <div className="v2sh-arow v2sh-arow--stack" data-testid="share-link-unconfirmed">
            <p className="v2sh-hint">
              This project says it syncs with {pendingLink.host}. Connect?
            </p>
            <button
              type="button"
              className="btn btn--primary"
              data-testid="share-link-connect"
              disabled={busy}
              onClick={() => void connectLink()}
            >
              Connect
            </button>
          </div>
        )}
        {posture && !view.linked && !offerMove && !moving && !pendingLink && (
          <p className="v2sh-hint" data-testid="share-local-note">
            Local project — kept on this Mac. Invite people once it is in the cloud.
          </p>
        )}
        {posture && view.linked && !view.reachable && (
          <p className="v2sh-hint" data-testid="share-unreachable">
            Sharing is not available right now. Invites you send wait here and go out once this Mac
            reaches the project.
          </p>
        )}

        {/* S9.21 — Ask to edit waits at the top of the owner's Share (10 co-ask-edit). */}
        {view.linked && view.reachable && view.showRequests && view.canInvite && (
          <RequestBlocks now={now} onAnswered={() => void loadPeople()} onError={setError} />
        )}

        {view.showScope && (
          // biome-ignore lint/a11y/useSemanticElements: a two-way segment, as the kit draws it
          <div className="v2sh-seg" role="group" aria-label="Share" data-testid="share-scope">
            {[
              ['canvas', 'This canvas'],
              ['project', 'Whole project'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="v2sh-seg-b"
                aria-pressed={view.scope === id}
                data-testid={`share-scope-${id}`}
                onClick={() => {
                  setScope(id);
                  setNotice(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {inviteShown && (
          <InviteRow
            ref={emailRef}
            roles={view.inviteRoles}
            defaultRole={inviteDefault}
            busy={busy}
            onInvite={invite}
          />
        )}
        {posture && view.linked && view.reachable && !view.canInvite && (
          <p className="v2sh-hint" data-testid="share-owner-only">
            Only the owner invites people. Ask the owner to change this.
          </p>
        )}

        {error && (
          <p className="v2sh-err" role="alert" data-testid="share-error">
            {error}
          </p>
        )}
        {notice?.kind === 'queued' && (
          <p className="v2sh-hint" role="status" data-testid="share-invite-queued">
            {notice.text}
          </p>
        )}
        {notice?.kind === 'sent' && (
          <p className="v2sh-hint" role="status" data-testid="share-invite-sent">
            {notice.text}
          </p>
        )}
        {notice?.kind === 'link' && (
          <div className="v2sh-arow" data-testid="share-invite-link">
            <span className="v2sh-arow-k">{`Send this invitation link to ${notice.email}`}</span>
            <div className="v2sh-arow-v">
              <input
                className="input v2sh-mono"
                readOnly
                value={notice.url}
                aria-label="Invitation link"
                onFocus={(e) => e.target.select()}
              />
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => copyShareLink(notice.url)}
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {view.linked && view.reachable && people && (
          <PeopleList
            rows={rows}
            canChange={view.canInvite}
            roles={view.menuRoles}
            makeOwner={view.makeOwner}
            scopeName={view.scopeName}
            busy={busy}
            onAction={act}
          />
        )}

        {view.showLinkRow && (owner || links?.web) && (
          <LinkRow
            project={project}
            rules={rules}
            owner={owner}
            made={copied ? 'copied' : made ? 'made' : null}
            busy={busy}
            onCopy={copyLink}
          />
        )}

        <ShareAdvanced
          adv={adv}
          links={links}
          shell={shell}
          rules={rules}
          onRule={changeRule}
          made={made}
          onTurnOff={turnOff}
          busy={busy}
          api={api}
          focus={focus}
          joinAs={
            adv.rules
              ? { role: inviteDefault, roles: view.inviteRoles, onChange: pickJoinAs }
              : null
          }
          lastSynced={lastSynced}
          now={now}
        />

        {confirm && (
          <RemoveDialog
            row={confirm}
            scopeName={view.scopeName}
            onCancel={() => setConfirm(null)}
            onConfirm={() => remove(confirm)}
          />
        )}
      </div>
    </div>
  );
}
