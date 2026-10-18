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
//   › Advanced · Other ways in                             (web / app / this Mac links)
//
// Every change ASKS the project server through `/_api/share/*` (routes/share.ts → the linked hub's
// `/api/access/*`); the hub decides and its words are shown. What is drawn follows what the server
// reports (share-model.js `sheetView`), never the role name.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AdvancedFold } from '../fold/advanced-fold.jsx';
import { useModalFocus } from '../shell/modal-focus.js';
import { InviteRow } from './invite-row.jsx';
import { copyShareLink } from './link-dialog.js';
import { PeopleList } from './people-list.jsx';
import { errorWords, peopleRows, roleWord, shareApi, sheetView } from './share-model.js';

const LINK_KINDS = [
  ['web', 'Web link'],
  ['app', 'Open in Maude app'],
  ['local', 'Local link (this Mac only)'],
];

function OtherWaysIn({ links, shell }) {
  const [copied, setCopied] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (kind, value) => {
    if (await copyShareLink(value)) {
      setCopied(kind);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 1500);
    }
  };
  const rows = LINK_KINDS.filter(([kind]) => links?.[kind]);
  if (!rows.length) return null;
  return (
    <AdvancedFold
      panel="share"
      hint="Other ways in"
      testid="share-other-ways"
      buttonTestid="share-other-ways-toggle"
    >
      {rows.map(([kind, label]) => (
        <div key={kind} className="v2sh-arow">
          <label className="v2sh-arow-k" htmlFor={`share-${kind}-url`}>
            {label}
          </label>
          <div className="v2sh-arow-v">
            <input
              id={`share-${kind}-url`}
              className="input v2sh-mono"
              data-testid={`share-${kind}-url`}
              readOnly
              value={links[kind]}
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              aria-label={`Copy ${label}`}
              data-testid={`share-copy-${kind}`}
              onClick={() => copy(kind, links[kind])}
            >
              {copied === kind ? 'Copied' : 'Copy'}
            </button>
          </div>
          {kind === 'app' && links.appIsLocalOnly && (
            <p className="v2sh-hint">Opens the folder on this Mac only.</p>
          )}
          {kind === 'app' && shell !== 'native' && (
            <a className="v2sh-hint" href={links.app} data-testid="share-open-app">
              Open in app
            </a>
          )}
        </div>
      ))}
    </AdvancedFold>
  );
}

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
  const emailRef = useRef(null);
  const sheetRef = useModalFocus({ onClose });

  const view = sheetView({ posture, me, target, project, scope });
  const canvas = view.canvas;

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
  }, [api]);

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
    if (inviteShown) emailRef.current?.focus({ preventScroll: true });
  }, [inviteShown]);

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

        {posture && !view.linked && (
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
            defaultRole={view.defaultInviteRole}
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

        {view.showLinkRow && links?.web && (
          <div className="v2sh-link" data-testid="share-link-row">
            <span className="v2sh-link-t">
              {`Anyone in ${project || 'this project'} with the link`}
              <span>Opens it in any browser</span>
            </span>
            <button
              type="button"
              className="btn btn--sm"
              data-testid="share-link-copy"
              onClick={() => copyShareLink(links.web)}
            >
              Copy link
            </button>
          </div>
        )}

        <OtherWaysIn links={links} shell={shell} />

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
