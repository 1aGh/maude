// client/v2/share/people-list.jsx — S9.19: who has access, in the Share sheet (10 co-share-sheet).
//
//   3 people · 1 invited
//   (Y) You                                   Owner
//   (T) Tereza   tereza@alligators.cz         Can edit ⌄
//   (P) petra@…  Invited · expires in 5 days  Resend   Can view ⌄
//
// Only what the hub answered is drawn — it already filtered the list by the caller's role (V2-1.16
// L17: no other person's e-mail and no pending invitation reach a non-owner). A role is a button
// (with its menu) only for a person who may change it; the owner's own row is always quiet.

import { useCallback, useState } from 'react';

import { Empty } from '../empty/index.js';
import { RoleMenu } from './role-menu.jsx';
import { countLine, roleWord } from './share-model.js';

const safeId = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '-');

export function PeopleList({ rows, canChange, roles, makeOwner, scopeName, busy, onAction }) {
  const [open, setOpen] = useState(null);
  // One stable callback: the menu's focus effect keys on it.
  const closeMenu = useCallback(() => setOpen(null), []);
  // 05 · es-edge-panels: nobody but you (or nobody listed at all) is the reason to invite — a quiet line under
  // your own row. The Invite row above stays the one door; this block adds no button.
  const alone = rows.every((r) => r.you);
  const aloneBlock = alone ? (
    <Empty
      glyph="people"
      align="left"
      className="v2sh-alone"
      copyId="es-edge-panels.share-alone"
      vars={{ project: scopeName }}
      testid="share-people-empty"
    />
  ) : null;
  if (!rows.length) return aloneBlock;
  return (
    <div className="v2sh-ppl" data-testid="share-people">
      <p className="v2sh-ppl-h">{countLine(rows)}</p>
      <ul className="v2sh-ppl-list">
        {rows.map((r) => {
          const tid = safeId(r.id);
          const changeable = canChange && !r.you && r.role !== 'owner';
          return (
            <li
              key={r.id}
              className="v2sh-pp"
              data-testid={`share-person-${tid}`}
              data-state={r.invited ? 'invited' : undefined}
              data-hl={open === r.id ? 'true' : undefined}
            >
              <span className="v2sh-av" aria-hidden="true">
                {r.initial}
              </span>
              <span className="v2sh-pp-t">
                <span className="v2sh-pp-n">{r.name}</span>
                {r.sub ? <span className="v2sh-pp-s">{r.sub}</span> : null}
              </span>
              {r.invited && canChange && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm v2sh-pp-act"
                  data-testid={`share-person-resend-${tid}`}
                  disabled={busy}
                  onClick={() => onAction(r, { kind: 'resend' })}
                >
                  Resend
                </button>
              )}
              {changeable ? (
                <button
                  type="button"
                  className="v2sh-role"
                  aria-haspopup="menu"
                  aria-expanded={open === r.id}
                  aria-label={`${r.name}: ${roleWord(r.role)}. Change`}
                  data-testid={`share-person-role-${tid}`}
                  disabled={busy}
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                >
                  {roleWord(r.role)}
                  <span className="v2sh-role-ch" aria-hidden="true">
                    ⌄
                  </span>
                </button>
              ) : (
                <span
                  className="v2sh-role v2sh-role--quiet"
                  data-testid={`share-person-role-${tid}`}
                >
                  {roleWord(r.role)}
                </span>
              )}
              {open === r.id && (
                <RoleMenu
                  row={r}
                  roles={roles}
                  makeOwner={makeOwner}
                  scopeName={scopeName}
                  onClose={closeMenu}
                  onPick={(choice) => {
                    setOpen(null);
                    if (choice.kind === 'role' && choice.role === r.role) return;
                    onAction(r, choice);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      {aloneBlock}
    </div>
  );
}
