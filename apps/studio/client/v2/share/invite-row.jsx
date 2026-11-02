// client/v2/share/invite-row.jsx — S9.19: the first thing in Share (rule `share-opens-on-invite`).
//
//   [ Name or email                ] [ Can edit ⌄ ] [ Invite ]
//
// The field takes focus when the sheet opens; Enter invites. The role select lists only the roles
// this project's server can hold (`/health.access.roles` — Can view is absent until the Q13 flip).
// Invite is the primary button (CONTRACT §6).

import { forwardRef, useEffect, useState } from 'react';

import { looksLikeEmail, ROLE_WORDS } from './share-model.js';

export const InviteRow = forwardRef(function InviteRow(
  { roles, defaultRole, busy, onInvite },
  ref
) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(defaultRole);
  // S9.20b — "New people join as" changes the default: the select follows it.
  useEffect(() => setRole(defaultRole), [defaultRole]);
  const r = roles.includes(role) ? role : defaultRole;
  const ready = looksLikeEmail(email) && !busy;
  return (
    <form
      className="v2sh-inv"
      data-testid="share-invite"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        if (await onInvite({ email: email.trim(), role: r })) setEmail('');
      }}
    >
      <input
        ref={ref}
        className="input v2sh-inv-in"
        type="email"
        autoComplete="off"
        spellCheck={false}
        placeholder="Name or email"
        aria-label="Email of the person to invite"
        data-testid="share-invite-email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <select
        className="v2sh-inv-role"
        aria-label="What they can do"
        data-testid="share-invite-role"
        value={r}
        onChange={(e) => setRole(e.target.value)}
      >
        {roles.map((id) => (
          <option key={id} value={id}>
            {ROLE_WORDS[id].word}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="btn btn--primary"
        data-testid="share-invite-submit"
        disabled={!ready}
      >
        Invite
      </button>
    </form>
  );
});
