// client/v2/shell/account-card-model.js — S1.22a: the account chip beside the faces and its card
// (canvas 11 · pn-accounts, CONTRACT §6 "Accounts": each project tab is bound to one account).
//
// PURE: what the chip and the card SAY. The binding itself is the shell's (V2-3.1 / V2-3.8: a project
// carries a profile, `/_config.profile` is `{ id, label? }`); this module only words it.
//
// Two inputs the page has and one it may have:
//   profile   `/_config.profile` — which account THIS tab runs as (always known on the desktop)
//   email     `/_api/cloud/status` — the signed-in address of that profile (absent when signed out)
//   accounts  OPTIONAL — every account on this Mac, `[{ id, label, email, projects }]`: `projects` is
//             the project names for the caller's own account and a count (a number) for every other
//             one (S1.22b `accounts_list`, option B). A project page cannot read the shell's profile registry (the page
//             capability deliberately omits it), so this arrives only from a shell command that returns
//             it for the caller (patch request S1.22a-1). Without it the card still says everything that
//             is known and leaves out the lines that would need it — never an invented list.
//
// The canvas draws the chip "only when this Mac has two or more accounts". A tab on a profile other than
// `default` proves a second account exists (the default profile always does); a tab on `default` needs the
// list to say so.

import { ACTIONS_BY_ID } from '../../../actions/index.ts';

const DEFAULT_ID = 'default';

const labelOf = (p) => String(p?.label || p?.id || '').trim();
const initialOf = (label) => (label ? Array.from(label)[0].toUpperCase() : '·');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "A" · "A and B" · "A, B and C" · "A, B and 4 more" — the canvas's project lists. */
export function projectsPhrase(names) {
  const list = (names ?? []).filter((n) => typeof n === 'string' && n.trim());
  if (list.length === 0) return '';
  if (list.length === 1) return list[0];
  if (list.length <= 3) return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return `${list[0]}, ${list[1]} and ${list.length - 2} more`;
}

/** Two tones only (the DS's accent and its warm status colour, as the canvas's sky / yellow): the same
 *  id is always the same tone, two accounts rarely look alike. */
export function toneOf(id) {
  let h = 0;
  for (const ch of String(id ?? '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % 2 === 0 ? 'a' : 'b';
}

/**
 * The chip in the Share cluster, or null when there is nothing to show.
 * @param native   the desktop app (a browser tab / cloud tab has no Mac accounts)
 * @param connected this profile holds a cloud sign-in (an account is what a sign-in IS)
 * @param cloud    a cloud tab (its account is the hub's, not the Mac's)
 */
export function accountChip({ native, connected, cloud = false, profile, email, accounts = null }) {
  if (!native || cloud || !connected) return null;
  const id = profile?.id || DEFAULT_ID;
  const twoOrMore = Array.isArray(accounts) ? accounts.length >= 2 : id !== DEFAULT_ID;
  if (!twoOrMore) return null;
  const label = labelOf(profile) || id;
  return {
    id,
    label,
    initial: initialOf(label),
    tone: toneOf(id),
    title: email ? `${label} · ${email}` : label,
  };
}

/** Everything the open card says. */
export function accountCard({ project, profile, email, accounts = null }) {
  const id = profile?.id || DEFAULT_ID;
  const label = labelOf(profile) || id;
  const list = Array.isArray(accounts) ? accounts : null;
  const mine = list?.find((a) => a?.id === id) ?? null;
  const here = (Array.isArray(mine?.projects) ? mine.projects : []).filter(
    (n) => typeof n === 'string'
  );
  const who = email || label;
  const effect = 'Signs out every project on it';
  const named = projectsPhrase(here);
  return {
    current: {
      initial: initialOf(label),
      tone: toneOf(id),
      title: email ? `${label} · ${email}` : label,
      sub: project ? `${project} uses this account` : 'This project uses this account',
    },
    others: (list ?? [])
      .filter((a) => a && a.id !== id)
      .map((a) => {
        const l = labelOf(a) || a.id;
        return {
          id: a.id,
          initial: initialOf(l),
          tone: toneOf(a.id),
          title: a.email ? `${l} · ${a.email}` : l,
          // S1.22b `accounts_list` (option B): another account carries a COUNT, not names.
          sub: Array.isArray(a.projects)
            ? projectsPhrase(a.projects) || plural(a.projects.length, 'project', 'projects')
            : plural(Number(a.projects) || 0, 'project', 'projects'),
        };
      }),
    // The registry's own label — one label on every surface (CONTRACT §3).
    switchLabel: ACTIONS_BY_ID.get('account.switch')?.label ?? 'Sign in as another account…',
    signOut: {
      label: `Sign out of ${who}…`,
      sub: named ? `${effect}: ${named}.` : `${effect}.`,
      confirm: {
        title: `Sign out of ${who}?`,
        body: 'Every project on it is signed out. Your work stays on this Mac.',
        primary: 'Sign out',
        cancel: 'Cancel',
      },
    },
    foot: project
      ? `Kept on this Mac — ${project} opens as ${label} next time.`
      : `Kept on this Mac — this project opens as ${label} next time.`,
  };
}
