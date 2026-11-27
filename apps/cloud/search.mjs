// Search (GET /search?q=) — the field in the nav, for everyone signed in.
//
// The pages ship no script, so search is a page: the nav's field is a GET form
// and this route answers it with what the person may already see, grouped —
// their projects (owned and shared), the people on projects they own (and the
// invitations still open there), and the Settings pages by name. Nothing is
// searched that the person could not open from the nav; a match is a link.
//
// The operator's search (/operator/search) lives in operator-routes.mjs and
// searches the whole service; this one never leaves the account.

import { peopleViewData } from './account-pages.mjs';
import { projectsFor } from './auth-routes.mjs';
import { appShell, avatar, esc, icon } from './brand.mjs';
import { pageCsp } from './edge.mjs';
import { roleWord as roleWordFor } from './people-page.mjs';

/** The Settings pages a person can find by name — words they would type. */
export const SETTINGS_INDEX = Object.freeze([
  {
    label: 'Settings',
    href: '/account',
    words: 'settings account e-mail email name trial sign out',
  },
  {
    label: 'Plans',
    href: '/account/plans',
    words: 'plans plan billing pay payment invoice card stripe price',
    owners: true,
  },
  {
    label: 'Notifications',
    href: '/account/notifications',
    words: 'notifications e-mails emails mentions unsubscribe',
  },
  {
    label: 'Devices',
    href: '/account/devices',
    words: 'devices macs mac windows linux computers apps sign out',
  },
  {
    label: 'Download everything',
    href: '/account/download',
    words: 'download export zip backup data',
  },
  { label: 'Delete the account', href: '/account/delete', words: 'delete remove close account' },
  { label: 'Start a project', href: '/projects/new', words: 'new project start create' },
]);

const MAX = 12;

/** `text` with the first match of `needle` marked — both already plain text. */
export function markHit(text, needle) {
  const t = String(text ?? '');
  const i = needle ? t.toLowerCase().indexOf(needle) : -1;
  if (i < 0) return esc(t);
  return `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + needle.length))}</mark>${esc(t.slice(i + needle.length))}`;
}

/**
 * The results page. Pure.
 *
 * @param {object} args
 * @param {{id: string, name: string, role: string, ownerName?: string|null}[]} args.projects
 * @param {{account_id: string, email: string, name?: string|null, projects: string[]}[]} args.people
 * @param {{email: string, project: string, projectId: string}[]} args.invites
 */
export function searchPage({ account, q, projects = [], people = [], invites = [] }) {
  const needle = String(q ?? '')
    .trim()
    .toLowerCase();
  const owns = Number(account?.owns ?? 0) > 0;
  const has = (...xs) =>
    xs.some((x) =>
      String(x ?? '')
        .toLowerCase()
        .includes(needle)
    );
  const P = needle ? projects.filter((p) => has(p.name, p.id)).slice(0, MAX) : [];
  const H = needle ? people.filter((p) => has(p.name, p.email)).slice(0, MAX) : [];
  const I = needle ? invites.filter((i) => has(i.email)).slice(0, MAX) : [];
  const S = needle
    ? SETTINGS_INDEX.filter((x) => (!x.owners || owns) && has(x.label, x.words)).slice(0, MAX)
    : [];
  const group = (title, rows) =>
    rows.length
      ? `<section class="ma-card ma-card--clip"><h2 class="ma-card-h">${esc(title)} <small>${rows.length}</small></h2>${rows.join('')}</section>`
      : '';
  const body = !needle
    ? '<div class="ma-card ma-card--pad"><p class="ma-set-p">Type a project, a person’s name or e-mail, or a setting — Plans, Devices, Notifications.</p></div>'
    : P.length + H.length + I.length + S.length === 0
      ? `<div class="ma-card ma-empty"><p><strong>Nothing matches “${esc(q)}”.</strong></p><p class="ma-quiet">Search looks through your projects${owns ? ', the people on them' : ''} and Settings.</p></div>`
      : `<div class="ma-results">${[
          group(
            'Projects',
            P.map(
              (p) =>
                `<a class="ma-hit" href="/projects/${esc(p.id)}/connect">${icon('folder', 16)}<span class="ma-who-t"><strong>${markHit(p.name || p.id, needle)}</strong><span>${p.role === 'owner' ? 'Yours' : `${esc(p.ownerName ?? 'Someone')}’s · you ${esc(roleWordFor(p.role).toLowerCase())}`}</span></span><span class="ma-hit-k">Open</span></a>`
            )
          ),
          group(
            'People',
            H.map(
              (p) =>
                `<a class="ma-hit" href="/account/people?q=${encodeURIComponent(p.email)}">${avatar(String(p.name ?? '').trim() || p.email, { seed: p.email })}<span class="ma-who-t"><strong>${markHit(String(p.name ?? '').trim() || p.email, needle)}</strong><span>${markHit(p.email, needle)}</span></span><span class="ma-hit-k">${esc(p.projects.join(', '))}</span></a>`
            )
          ),
          group(
            'Invitations not opened',
            I.map(
              (i) =>
                `<a class="ma-hit" href="/projects/${esc(i.projectId)}/people">${avatar(i.email, { seed: i.email, tone: 'grey' })}<span class="ma-who-t"><strong>${markHit(i.email, needle)}</strong><span>invited to ${esc(i.project)}</span></span><span class="ma-hit-k">Send again or cancel</span></a>`
            )
          ),
          group(
            'Settings',
            S.map(
              (x) =>
                `<a class="ma-hit" href="${esc(x.href)}">${icon('chevron-r', 14)}<span class="ma-who-t"><strong>${markHit(x.label, needle)}</strong></span></a>`
            )
          ),
        ].join('')}</div>`;
  return appShell({
    account,
    title: needle ? `“${q}”` : 'Search',
    heading: needle ? `Results for “${q}”` : 'Search',
    active: 'search',
    q,
    body,
  });
}

/** GET /search — null for any other path. */
export async function handleSearch(request, env, { account } = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/search') return null;
  if (!account)
    return Response.redirect(new URL(`/login?next=${encodeURIComponent('/search')}`, url), 303);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Not allowed.', { status: 405 });
  }
  const q = String(url.searchParams.get('q') ?? '').slice(0, 80);
  let projects = [];
  let people = [];
  const invites = [];
  if (q.trim()) {
    const [list, view] = await Promise.all([
      projectsFor(env, account.id),
      peopleViewData(env, account.id, { analytics: false }).catch(() => ({ owned: [] })),
    ]);
    projects = list;
    const byId = new Map();
    for (const { project, people: rows = [], invites: open = [] } of view.owned ?? []) {
      for (const p of rows) {
        if (p.account_id === account.id) continue;
        const row = byId.get(p.account_id) ?? { ...p, projects: [] };
        row.projects.push(project.name || project.id);
        byId.set(p.account_id, row);
      }
      for (const i of open)
        invites.push({
          email: i.email,
          project: project.name || project.id,
          projectId: project.id,
        });
    }
    people = [...byId.values()];
  }
  return new Response(searchPage({ account, q, projects, people, invites }), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': pageCsp(),
      'referrer-policy': 'no-referrer',
    },
  });
}
