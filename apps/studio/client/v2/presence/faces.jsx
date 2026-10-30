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
import { Glyph, SparkGlyph } from '../share/glyphs.jsx';

const isPeer = (f) => !f.you && !f.agent && typeof f.clientID === 'number';

function useDismiss(open, onClose, ref, restore) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        // esc from inside the menu: focus goes back to the face that opened it
        restore?.();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, ref, restore]);
}

/**
 * WAI-ARIA menu keys for the face menu and the people list: focus moves in when it opens (the first
 * item), ↑ / ↓ / Home / End rove, and an esc hands focus back to the face that opened it (P8 C7 —
 * the menu had `role="menu"` and no way to arrow through it).
 */
function useMenuKeys(ref, selector) {
  useEffect(() => {
    const items = ref.current?.querySelectorAll(selector);
    items?.[0]?.focus({ preventScroll: true });
  }, [ref, selector]);
  return (e) => {
    const items = [...(ref.current?.querySelectorAll(selector) ?? [])];
    if (!items.length) return;
    const at = items.indexOf(document.activeElement);
    const go = (i) => items[(i + items.length) % items.length]?.focus();
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at < 0 ? -1 : at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else return;
    e.preventDefault();
  };
}

function toneStyle(name, you = false) {
  return { '--face-tone': toneVar(you ? YOU_TONE : toneFor(name)) };
}

/** The pre-S9.23 strip: a peer's face IS the Follow control. */
function LegacyFaces({ faces, onFollow }) {
  return (
    <ul className="sh-faces" aria-label="People here" data-testid="share-cluster-faces">
      {faces.map((f) => {
        const key = `${f.you ? 'you' : f.agent ? 'agent' : `peer-${f.clientID}`}:${f.name}`;
        if (isPeer(f) && onFollow) {
          const label = f.following
            ? `Stop following ${firstName(f.name)}`
            : `Follow ${firstName(f.name)}`;
          return (
            <li key={key} className="sh-face-li">
              <button
                type="button"
                className={`sh-face${f.following ? ' is-following' : ''}`}
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
            className={`sh-face${f.agent ? ' is-agent' : ''}`}
            title={f.name}
            aria-label={f.name}
          >
            {f.agent ? <SparkGlyph size={12} /> : f.initials}
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
  const ref = useRef(null);
  const onKeyDown = useMenuKeys(ref, '[role="menuitem"]');
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the keys live on the menu (roving), not on the wrapper
    <div
      ref={ref}
      className="sh-pmenu island"
      role="menu"
      data-testid="presence-face-menu"
      aria-label={peer.name}
      onKeyDown={onKeyDown}
    >
      <div className="sh-pmenu-hd">
        <span className="sh-pface sh-pface--lg" style={toneStyle(peer.name)} aria-hidden="true">
          {peer.initials}
        </span>
        <span className="sh-pmenu-who">
          <strong>{peer.name}</strong>
          <em data-testid="presence-face-menu-where">{menuSubline(peer, where)}</em>
        </span>
      </div>
      <hr className="sh-pmenu-sep" />
      <button
        type="button"
        role="menuitem"
        className="sh-pmenu-row"
        data-testid="presence-face-menu-follow"
        onClick={() => run('presence.follow', { clientID: peer.clientID })}
      >
        <span className="sh-pmenu-ic" aria-hidden="true">
          <Glyph name="view" size={14} />
        </span>
        {peer.following ? `Stop following ${first}` : `Follow ${first}`}
      </button>
      {board && (
        <button
          type="button"
          role="menuitem"
          className="sh-pmenu-row"
          data-testid="presence-face-menu-go-to"
          onClick={() => run('presence.go-to', { clientID: peer.clientID })}
        >
          <span className="sh-pmenu-ic" aria-hidden="true">
            <Glyph name="arrow" size={14} />
          </span>
          Go to {board}
        </button>
      )}
      {presence.canSummon && (
        <>
          <hr className="sh-pmenu-sep" />
          <button
            type="button"
            role="menuitem"
            className="sh-pmenu-row"
            data-testid="presence-face-menu-bring"
            onClick={() => run('presence.bring-everyone')}
          >
            <span className="sh-pmenu-ic" aria-hidden="true">
              <Glyph name="people" size={14} />
            </span>
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
  const ref = useRef(null);
  const onKeyDown = useMenuKeys(ref, 'button');
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useSemanticElements: the keys rove the buttons inside (↑ ↓ Home End); a labelled list of people, not a form fieldset
    <div
      ref={ref}
      className="sh-pmenu sh-plist island"
      role="group"
      data-testid="presence-people-list"
      aria-label="People here"
      onKeyDown={onKeyDown}
    >
      <p className="sh-plist-h">
        <span>{list.heading}</span>
        {list.sub && <span>{list.sub}</span>}
      </p>
      <ul className="sh-plist-rows">
        {list.rows.map((r) => {
          const peer = peers.find((p) => p.clientID === r.clientID);
          return (
            <li key={r.clientID}>
              <button
                type="button"
                className={`sh-plist-row${r.idle ? ' is-idle' : ''}`}
                data-testid={`presence-people-row-${r.clientID}`}
                onClick={() => onPick(peer)}
              >
                <span className="sh-pface" style={toneStyle(r.name)} aria-hidden="true">
                  {peer?.initials}
                </span>
                <span className="sh-plist-name">{r.name}</span>
                <em>{r.where}</em>
              </button>
            </li>
          );
        })}
      </ul>
      {presence.canSummon && (
        <>
          <hr className="sh-pmenu-sep" />
          <button
            type="button"
            className="sh-pmenu-row"
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
  const openerRef = useRef(null);
  const close = () => setOpen(null);
  useDismiss(
    !!open,
    () => setOpen(null),
    hostRef,
    () => openerRef.current?.focus()
  );
  if (!faces?.length) return null;
  if (!presence) return <LegacyFaces faces={faces} onFollow={onFollow} />;

  const lead = faces.filter((f) => !isPeer(f));
  const peers = faces.filter(isPeer);
  const { shown, more } = collapseFaces(peers);
  const now = Date.now();
  const menuPeer = open?.kind === 'face' ? peers.find((p) => p.clientID === open.clientID) : null;

  return (
    <span className="sh-faces-host" ref={hostRef}>
      <ul className="sh-faces" aria-label="People here" data-testid="share-cluster-faces">
        {lead.map((f) => (
          <li
            key={f.you ? `you:${f.name}` : `agent:${f.name}`}
            className={`sh-face${f.agent ? ' is-agent' : ''}${f.you ? ' is-you' : ''}`}
            style={f.you ? toneStyle(f.name, true) : undefined}
            title={f.name}
            aria-label={f.name}
          >
            {f.agent ? <SparkGlyph size={12} /> : f.initials}
          </li>
        ))}
        {shown.map((f) => {
          const idle = typeof f.idleSince === 'number' && f.idleSince > 0;
          const label = `${f.name} — ${whereOf(f, { labelOf: presence.labelOf, roleOf: presence.roleOf, now })}`;
          return (
            <li key={`peer-${f.clientID}:${f.name}`} className="sh-face-li">
              <button
                type="button"
                className={`sh-face${f.following ? ' is-following' : ''}${idle ? ' is-idle' : ''}`}
                style={toneStyle(f.name)}
                title={label}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={
                  open?.kind === 'face' && open.clientID === f.clientID ? 'true' : 'false'
                }
                data-testid={`share-cluster-face-${f.clientID}`}
                onClick={(e) => {
                  openerRef.current = e.currentTarget;
                  setOpen((o) =>
                    o?.kind === 'face' && o.clientID === f.clientID
                      ? null
                      : { kind: 'face', clientID: f.clientID }
                  );
                }}
              >
                {f.initials}
              </button>
            </li>
          );
        })}
        {more > 0 && (
          <li className="sh-face-li">
            <button
              type="button"
              className="sh-face sh-face--more"
              aria-label={`${more} more here`}
              title={`${more} more here`}
              aria-haspopup="true"
              aria-expanded={open?.kind === 'list' ? 'true' : 'false'}
              data-testid="share-cluster-faces-more"
              onClick={(e) => {
                openerRef.current = e.currentTarget;
                setOpen((o) => (o?.kind === 'list' ? null : { kind: 'list' }));
              }}
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
