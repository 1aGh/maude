// client/v2/presence/faces.jsx — S9.23: the Share cluster's faces, the face menu and the people list
// (canvas 10 co-presence · co-twelve). Retires the Faces strip that lived in share-cluster.jsx and the
// avatar popover in participants-chrome.tsx; every testid they had is re-emitted (nothing renamed).
//
//   a face           an initial in the person's tone (never coral); click opens the face menu
//   the face menu    "On A4 · plakát · Can edit" · Follow · Go to · Bring everyone here
//   the crowd        three faces and "+8"; the list says where each person is (12 on …, you + 11)
//
// PRESENTATIONAL. The words and the order come from presence/model.ts (the canvas reads the same rules);
// the actions go out through `presence.run(id, params)` — the shell's `presence.*` registry rows, sent
// to the active canvas over the parent-gated `run-action` lane. Without a `presence` prop the strip is
// the pre-S9.23 one (a peer's face is the Follow control), so a host that has not wired it keeps working.

import { useEffect, useRef, useState } from 'react';
import {
  collapseFaces,
  firstName,
  menuSubline,
  peopleList,
  whereOf,
} from '../../../presence/model.ts';
import { toneFor, toneVar, YOU_TONE } from '../../../presence/tones.ts';

const isPeer = (f) => !f.you && !f.agent && typeof f.clientID === 'number';

function useDismiss(open, onClose, ref) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, ref]);
}

function toneStyle(name, you = false) {
  return { '--face-tone': toneVar(you ? YOU_TONE : toneFor(name)) };
}

/** The pre-S9.23 strip: a peer's face IS the Follow control. */
function LegacyFaces({ faces, onFollow }) {
  return (
    <ul className="st-faces" aria-label="People here" data-testid="share-cluster-faces">
      {faces.map((f) => {
        const key = `${f.you ? 'you' : f.agent ? 'agent' : `peer-${f.clientID}`}:${f.name}`;
        if (isPeer(f) && onFollow) {
          const label = f.following
            ? `Stop following ${firstName(f.name)}`
            : `Follow ${firstName(f.name)}`;
          return (
            <li key={key} className="st-face-li">
              <button
                type="button"
                className={`st-face${f.following ? ' is-following' : ''}`}
                title={`${f.name} · ${label}`}
                aria-label={label}
                aria-pressed={f.following ? 'true' : 'false'}
                data-testid={`share-cluster-face-${f.clientID}`}
                onClick={() => onFollow(f.clientID)}
              >
                {f.initials}
              </button>
            </li>
          );
        }
        return (
          <li
            key={key}
            className={`st-face${f.agent ? ' is-agent' : ''}`}
            title={f.name}
            aria-label={f.name}
          >
            {f.initials}
          </li>
        );
      })}
    </ul>
  );
}

function FaceMenu({ peer, presence, close, now }) {
  const first = firstName(peer.name);
  const where = { labelOf: presence.labelOf, roleOf: presence.roleOf, now };
  const board = peer.artboard ? presence.labelOf?.(peer.artboard) : null;
  const run = (id, params) => {
    close();
    presence.run(id, params);
  };
  return (
    <div
      className="st-pmenu island"
      role="menu"
      data-testid="presence-face-menu"
      aria-label={peer.name}
    >
      <div className="st-pmenu-hd">
        <span className="st-pface st-pface--lg" style={toneStyle(peer.name)} aria-hidden="true">
          {peer.initials}
        </span>
        <span className="st-pmenu-who">
          <strong>{peer.name}</strong>
          <em data-testid="presence-face-menu-where">{menuSubline(peer, where)}</em>
        </span>
      </div>
      <hr className="st-pmenu-sep" />
      <button
        type="button"
        role="menuitem"
        className="st-pmenu-row"
        data-testid="presence-face-menu-follow"
        onClick={() => run('presence.follow', { clientID: peer.clientID })}
      >
        {peer.following ? `Stop following ${first}` : `Follow ${first}`}
      </button>
      {board && (
        <button
          type="button"
          role="menuitem"
          className="st-pmenu-row"
          data-testid="presence-face-menu-go-to"
          onClick={() => run('presence.go-to', { clientID: peer.clientID })}
        >
          Go to {board}
        </button>
      )}
      {presence.canSummon && (
        <>
          <hr className="st-pmenu-sep" />
          <button
            type="button"
            role="menuitem"
            className="st-pmenu-row"
            data-testid="presence-face-menu-bring"
            onClick={() => run('presence.bring-everyone')}
          >
            Bring everyone here
          </button>
        </>
      )}
    </div>
  );
}

function PeopleList({ peers, presence, close, now, onPick }) {
  const list = peopleList(peers, {
    labelOf: presence.labelOf,
    roleOf: presence.roleOf,
    now,
    canvasLabel: presence.canvasLabel || 'this canvas',
  });
  return (
    <div
      className="st-pmenu st-plist island"
      role="group"
      data-testid="presence-people-list"
      aria-label="People here"
    >
      <p className="st-plist-h">
        <span>{list.heading}</span>
        {list.sub && <span>{list.sub}</span>}
      </p>
      <ul className="st-plist-rows">
        {list.rows.map((r) => {
          const peer = peers.find((p) => p.clientID === r.clientID);
          return (
            <li key={r.clientID}>
              <button
                type="button"
                className={`st-plist-row${r.idle ? ' is-idle' : ''}`}
                data-testid={`presence-people-row-${r.clientID}`}
                onClick={() => onPick(peer)}
              >
                <span className="st-pface" style={toneStyle(r.name)} aria-hidden="true">
                  {peer?.initials}
                </span>
                <span className="st-plist-name">{r.name}</span>
                <em>{r.where}</em>
              </button>
            </li>
          );
        })}
      </ul>
      {presence.canSummon && (
        <>
          <hr className="st-pmenu-sep" />
          <button
            type="button"
            className="st-pmenu-row"
            data-testid="presence-people-bring"
            onClick={() => {
              close();
              presence.run('presence.bring-everyone');
            }}
          >
            Bring everyone here
          </button>
        </>
      )}
    </div>
  );
}

export function PresenceFaces({ faces, onFollow, presence = null }) {
  const [open, setOpen] = useState(null); // { kind: 'face', clientID } | { kind: 'list' } | null
  const hostRef = useRef(null);
  const close = () => setOpen(null);
  useDismiss(!!open, () => setOpen(null), hostRef);
  if (!faces?.length) return null;
  if (!presence) return <LegacyFaces faces={faces} onFollow={onFollow} />;

  const lead = faces.filter((f) => !isPeer(f));
  const peers = faces.filter(isPeer);
  const { shown, more } = collapseFaces(peers);
  const now = Date.now();
  const menuPeer = open?.kind === 'face' ? peers.find((p) => p.clientID === open.clientID) : null;

  return (
    <span className="st-faces-host" ref={hostRef}>
      <ul className="st-faces" aria-label="People here" data-testid="share-cluster-faces">
        {lead.map((f) => (
          <li
            key={f.you ? `you:${f.name}` : `agent:${f.name}`}
            className={`st-face${f.agent ? ' is-agent' : ''}${f.you ? ' is-you' : ''}`}
            style={f.you ? toneStyle(f.name, true) : undefined}
            title={f.name}
            aria-label={f.name}
          >
            {f.initials}
          </li>
        ))}
        {shown.map((f) => {
          const idle = typeof f.idleSince === 'number' && f.idleSince > 0;
          const label = `${f.name} — ${whereOf(f, { labelOf: presence.labelOf, roleOf: presence.roleOf, now })}`;
          return (
            <li key={`peer-${f.clientID}:${f.name}`} className="st-face-li">
              <button
                type="button"
                className={`st-face${f.following ? ' is-following' : ''}${idle ? ' is-idle' : ''}`}
                style={toneStyle(f.name)}
                title={label}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={
                  open?.kind === 'face' && open.clientID === f.clientID ? 'true' : 'false'
                }
                data-testid={`share-cluster-face-${f.clientID}`}
                onClick={() =>
                  setOpen((o) =>
                    o?.kind === 'face' && o.clientID === f.clientID
                      ? null
                      : { kind: 'face', clientID: f.clientID }
                  )
                }
              >
                {f.initials}
              </button>
            </li>
          );
        })}
        {more > 0 && (
          <li className="st-face-li">
            <button
              type="button"
              className="st-face st-face--more"
              aria-label={`${more} more — see everyone`}
              aria-haspopup="true"
              aria-expanded={open?.kind === 'list' ? 'true' : 'false'}
              data-testid="share-cluster-faces-more"
              onClick={() => setOpen((o) => (o?.kind === 'list' ? null : { kind: 'list' }))}
            >
              +{more}
            </button>
          </li>
        )}
      </ul>
      {menuPeer && <FaceMenu peer={menuPeer} presence={presence} close={close} now={now} />}
      {open?.kind === 'list' && (
        <PeopleList
          peers={peers}
          presence={presence}
          close={close}
          now={now}
          onPick={(p) => p && setOpen({ kind: 'face', clientID: p.clientID })}
        />
      )}
    </span>
  );
}
