// client/v2/share/role-menu.jsx — S9.19: a person's role, opened (10 co-share-roles).
//
//   ✓ Can edit      Change artboards, draw, use AI, move to the trash
//     Can comment   Look, comment and download
//     Can view      Look only                      ← only where the hub holds it (Q13)
//   ─────────────
//     Make owner    Owners also invite people and clear out the trash
//     Remove from Combine-kampan                    (danger → the Remove dialog)
//
// A WAI-ARIA menu: ↑/↓ (Home/End) rove, Enter/Space picks, esc closes and gives focus back to the
// role button. Picking only ASKS — the sheet sends it and the hub decides.

import { useEffect } from 'react';

import { useModalFocus } from '../shell/modal-focus.js';
import { ROLE_WORDS } from './share-model.js';

export function RoleMenu({ row, roles, makeOwner, scopeName, onPick, onClose }) {
  // Topmost overlay while open: esc closes the MENU (not the sheet) and focus goes back to the role
  // button that opened it. Not modal — Tab leaves the menu, which closes it.
  const ref = useModalFocus({ onClose, modal: false });
  useEffect(() => {
    const items = [...(ref.current?.querySelectorAll('[role^="menuitem"]') ?? [])];
    const checked = items.find((n) => n.getAttribute('aria-checked') === 'true');
    (checked ?? items[0])?.focus();
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [onClose, ref]);

  const onKeyDown = (e) => {
    const items = [...(ref.current?.querySelectorAll('[role^="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement);
    const go = (i) => items[(i + items.length) % items.length]?.focus();
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') {
      onClose();
      return;
    } else return;
    e.preventDefault();
  };

  const pick = (choice) => () => onPick(choice);
  const roleRows = row.invited ? [] : roles;
  return (
    <div
      ref={ref}
      className="v2sh-menu"
      role="menu"
      aria-label={`${row.name}’s role`}
      data-testid="share-role-menu"
      onKeyDown={onKeyDown}
    >
      {roleRows.map((r) => (
        <button
          key={r}
          type="button"
          role="menuitemradio"
          aria-checked={row.role === r}
          tabIndex={-1}
          className="v2sh-mi"
          data-testid={`share-role-${r}`}
          onClick={pick({ kind: 'role', role: r })}
        >
          <span className="v2sh-mi-ic" aria-hidden="true">
            {row.role === r ? '✓' : ''}
          </span>
          <span className="v2sh-mi-t">
            {ROLE_WORDS[r].word}
            <span>{ROLE_WORDS[r].line}</span>
          </span>
        </button>
      ))}
      {roleRows.length > 0 && <hr className="v2sh-msep" />}
      {makeOwner && !row.invited && (
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="v2sh-mi"
          data-testid="share-role-make-owner"
          onClick={pick({ kind: 'owner' })}
        >
          <span className="v2sh-mi-ic" aria-hidden="true" />
          <span className="v2sh-mi-t">
            Make owner
            <span>{ROLE_WORDS.owner.line}</span>
          </span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="v2sh-mi v2sh-mi--danger"
        data-testid="share-role-remove"
        onClick={pick({ kind: 'remove' })}
      >
        <span className="v2sh-mi-ic" aria-hidden="true" />
        <span className="v2sh-mi-t">{`Remove from ${scopeName}`}</span>
      </button>
    </div>
  );
}
