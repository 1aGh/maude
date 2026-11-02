// client/v2/share/people-list.jsx — S9.19: who has access, in the Share sheet (10 co-share-sheet).
//
//   3 people · 1 invited                                     + 9 in Alligators brand
//   (Y) You                                   Owner
//   (T) Tereza   tereza@alligators.cz         Can edit ⌄
//   (P) Petra    Invited 2 days ago · expires in 5 days     Resend   Can view ⌄
//   [👥] Everyone in Alligators brand   9 people · change it in Whole project     Can edit
//
// Only what the hub answered is drawn — it already filtered the list by the caller's role (V2-1.16
// L17: no other person's e-mail and no pending invitation reach a non-owner). A role is a button
// (with its menu) only for a person who may change it; the owner's own row is always quiet. A face
// wears the person's tone (presence/tones.ts), the same colour as in the Share cluster.

import { useCallback, useState } from 'react';

import { Empty } from '../empty/index.js';
import { Glyph } from './glyphs.jsx';
import { Person } from './person.jsx';
import { RoleMenu } from './role-menu.jsx';
import { countLine, restLine, roleWord } from './share-model.js';

const safeId = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '-');

export function PeopleList({
  rows,
  team = null,
  project = '',
  canChange,
  roles,
  makeOwner,
  scopeName,
  busy,
  onAction,
}) {
  // `{ id, anchor }` — the open role menu and the button it hangs from
  const [open, setOpen] = useState(null);
  // One stable callback: the menu's focus effect keys on it.
  const closeMenu = useCallback(() => setOpen(null), []);
  // 05 · es-edge-panels: nobody but you (or nobody listed at all) is the reason to invite — a quiet line under
  // your own row. The Invite row above stays the one door; this block adds no button.
  const alone = rows.every((r) => r.you) && !team;
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
  if (!rows.length && !team) return aloneBlock;
  const rest = restLine(team, project);
  return (
    <div className="v2sh-ppl" data-testid="share-people">
      <p className="v2sh-ppl-h">
        <span>{countLine(rows)}</span>
        {rest ? <span data-testid="share-people-rest">{rest}</span> : null}
      </p>
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
              data-hl={open?.id === r.id ? 'true' : undefined}
            >
              <Person name={r.name} tone={r.tone} initial={r.initial} />
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
                  aria-expanded={open?.id === r.id}
                  aria-label={`${r.name}: ${roleWord(r.role)}. Change`}
                  data-testid={`share-person-role-${tid}`}
                  disabled={busy}
                  onClick={(e) => {
                    const anchor = e.currentTarget;
                    setOpen(open?.id === r.id ? null : { id: r.id, anchor });
                  }}
                >
                  {roleWord(r.role)}
                  <span className="v2sh-role-ch" aria-hidden="true">
                    <Glyph name="chevron" size={12} />
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
              {open?.id === r.id && (
                <RoleMenu
                  row={r}
                  roles={roles}
                  makeOwner={makeOwner}
                  scopeName={scopeName}
                  anchor={open.anchor}
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
        {team && (
          <li className="v2sh-pp" data-testid="share-team-row">
            <span className="v2sh-pp-team" aria-hidden="true">
              <Glyph name="people" size={14} />
            </span>
            <span className="v2sh-pp-t">
              <span className="v2sh-pp-n">{team.name}</span>
              <span className="v2sh-pp-s">{team.sub}</span>
            </span>
            <span className="v2sh-role v2sh-role--quiet" data-testid="share-team-role">
              {roleWord(team.role)}
            </span>
          </li>
        )}
      </ul>
      {aloneBlock}
    </div>
  );
}
