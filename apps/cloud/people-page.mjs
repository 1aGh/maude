// Who is on a project — Cloud Phase 22 Task 5 (DDR-204).
//
// The panel where somebody adds a teammate and, more consequentially, removes
// one. Removal is the reason this page needs care: it looks instantaneous and
// is not, because a project token is verified offline so that a control-plane
// outage cannot lock anyone out of their own work (DDR-204). An admin who
// believes "removed" means "out right now" makes a decision they would not
// otherwise make, so the page says how long it actually takes, in hours.
//
// Server-rendered, no script — same reason as the dashboard. This is a page
// people open when something is wrong, including "the wrong person has
// access".

import { appShell, avatar, icon } from './brand.mjs';
import { STATE_COPY } from './dashboard.mjs';
import { ROLES, removalEffect } from './membership.mjs';

// Styling comes from the design system shell (brand.mjs); only what this page
// adds lives here. The table wears the same one-material card the admin
// surfaces use.
const CSS = `
  form.inline { display: inline-flex; align-items: center; gap: var(--space-1); margin: 0; }
  .pp-add { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); max-width: 56rem; }
  .pp-add input[type=email] { flex: 1; min-width: 16rem; max-width: none; }
  .pp-add select { width: auto; }
  .pp-list .ma-table td:nth-child(2) { width: 40%; }
  .pp-list .ma-mrole .k-ic { margin-left: 2px; color: var(--fg-2); }
  .pp-list .pp-key { margin: 0; max-width: none; padding: var(--space-3) var(--space-5); font-size: var(--type-xs); line-height: var(--lh-xs); color: var(--fg-2); box-shadow: inset 0 0.5px 0 var(--border-subtle); }
  .pp-list .pp-key strong { color: var(--fg-1); font-weight: var(--weight-semibold); }
  .ma-table td .quiet { color: var(--fg-2); }
  .ma-table tr.is-dim .ma-who-t strong { font-weight: var(--weight-regular); }
`;

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function page(title, body, { account, project, isOwner, lede = null } = {}) {
  const copy = project ? (STATE_COPY[project.state] ?? null) : null;
  return appShell({
    account,
    title,
    body,
    project,
    isOwner,
    active: 'people',
    lede,
    pill: copy ? { tone: copy.tone, label: copy.label } : null,
    extraCss: CSS,
  });
}

/** Roles a person can be given here. `owner` is a transfer, not a role change. */
const ASSIGNABLE = ROLES.filter((r) => r !== 'owner');

/**
 * The four v2 role words (V2-1.7 §5.1, CONTRACT §6). Wire ids never reach the
 * page: `member` reads Can edit, `viewer` Can comment, `observer` Can view.
 */
export const ROLE_WORD = Object.freeze({
  owner: 'Owner',
  member: 'Can edit',
  viewer: 'Can comment',
  observer: 'Can view',
});

/** What each role can actually do, in one line. */
export const ROLE_MEANING = Object.freeze({
  owner: 'Everything, plus billing, people and deleting the project.',
  member: 'Change the designs, comment and download.',
  viewer: 'Look, comment and download.',
  observer: 'Look only.',
});

/** A role id → its word, never the id itself. */
export const roleWord = (role) => ROLE_WORD[role] ?? 'Can view';

/**
 * What each option says WHILE it is being chosen (Cloud Phase 24 A12a, canvas
 * board D1). With no script on this page, the option text is the only place
 * the meaning can appear at the moment of the decision.
 *
 * `owner` is deliberately absent: it is a transfer, not a role change, and
 * handing a project over is its own deliberate step that this page does not
 * offer (lead decision v2-lead-make-owner-hidden).
 */
const ROLE_OPTION = Object.freeze({
  member: 'Can edit — change the designs',
  viewer: 'Can comment — look, comment and download',
  observer: 'Can view — look only',
});

export function roleSelect(name, current, { label = 'What they can do', canView = true } = {}) {
  // Can view needs a workspace that holds v2 credentials (`roles-v2`). Where
  // it does not, the option is not offered — an invitation to a role the
  // workspace refuses at its door reads to the invitee as "That link has
  // expired". Someone who already IS Can view keeps the option, so the form
  // shows what is true and saving it changes nothing.
  const offered = ASSIGNABLE.filter((r) => canView || r !== 'observer' || r === current);
  return `<select name="${name}" aria-label="${esc(label)}">${offered
    .map(
      (r) =>
        `<option value="${r}"${r === current ? ' selected' : ''}>${esc(ROLE_OPTION[r] ?? roleWord(r))}</option>`
    )
    .join('')}</select>`;
}

/** `ui/Poster.tsx` → `Poster` — the name a person sees for a canvas. */
export function canvasName(path) {
  const base =
    String(path ?? '')
      .split('/')
      .pop() ?? '';
  return base.replace(/\.[^.]+$/, '') || base;
}

/** `20 Oct` — the day an invitation stops working. */
function day(ms) {
  return new Date(Number(ms)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * Who a row is, for THIS viewer.
 *
 * E-mail addresses go to the owner only — the one who invites (V2-1.7 §5.6:
 * `email`, invited and requested rows go only to `invite` holders). Everyone
 * else sees a name and the role word; a person with no name yet reads "No name
 * yet", never a piece of their address. The signed-in person is "You".
 */
export function personLabel(person, { isOwner, selfId = null }) {
  if (selfId && person.account_id === selfId) return 'You';
  const name = String(person.name ?? '').trim();
  if (isOwner) {
    return name
      ? `${esc(name)} <span class="quiet">${esc(person.email ?? '')}</span>`
      : esc(person.email ?? '');
  }
  return name ? esc(name) : '<span class="quiet">No name yet</span>';
}

/**
 * Who a row is, drawn: a face, the name, and (owner only) the address under
 * it. The same rules as `personLabel` — this only lays them out.
 */
function whoCell(person, { isOwner, selfId }) {
  const self = selfId && person.account_id === selfId;
  const name = String(person.name ?? '').trim();
  const email = String(person.email ?? '');
  const title = self
    ? 'You'
    : name
      ? esc(name)
      : isOwner
        ? esc(email)
        : '<span class="quiet">No name yet</span>';
  const sub = isOwner && (self || name) && email ? `<span>${esc(email)}</span>` : '';
  return `<span class="ma-who">${avatar(self ? 'You' : name || email || '?', { seed: email || person.account_id || name })}<span class="ma-who-t"><strong>${title}</strong>${sub}</span></span>`;
}

/** The one line that says why a role is missing from the list. */
export const CAN_VIEW_UNAVAILABLE =
  'Can view is not available for this project yet. Use Can comment to let someone look without changing anything.';

/**
 * One person: who, and what they can do as a word. For the owner of the
 * project the word opens a small panel — change the role, or remove them —
 * so a row is one quiet line until somebody wants to change it (owner,
 * 2026-11-27: a select, Save and Remove on every row read as a form, not a list).
 */
function personRow(person, { projectId, isOwner, selfId, withControls = true, canView = true }) {
  const who = whoCell(person, { isOwner, selfId });
  const word = esc(roleWord(person.role));
  if (person.role === 'owner') {
    // No controls at all, rather than disabled ones. A disabled button invites
    // somebody to hunt for the way to enable it. Make owner stays hidden.
    return `<tr><td>${who}</td><td><span class="ma-mrole ma-mrole--own">${word}</span></td><td></td></tr>`;
  }
  const label = String(person.name ?? '').trim() || String(person.email ?? '');
  const cell =
    isOwner && withControls
      ? `<details class="ma-at-d"><summary aria-label="Change what ${esc(label)} can do"><span class="ma-mrole">${word}${icon('chevron', 12)}</span></summary>
          <div class="ma-pop">
            <form method="post" action="/projects/${esc(projectId)}/people">
              <input type="hidden" name="account" value="${esc(person.account_id)}">
              ${roleSelect('role', person.role, { canView })}
              <button type="submit" name="do" value="role" class="btn btn--sm btn--primary">Save</button>
            </form>
            <form method="get" action="/projects/${esc(projectId)}/people/remove">
              <input type="hidden" name="account" value="${esc(person.account_id)}">
              <button type="submit" class="btn btn--sm btn--ghost">Remove…</button>
            </form>
          </div>
        </details>`
      : `<span class="ma-mrole">${word}</span>`;
  return `<tr><td>${who}</td><td>${cell}</td><td></td></tr>`;
}

/** A canvas grant: somebody with access to ONE canvas, not the project. */
function grantRow(grant, { isOwner, selfId }) {
  return `<tr><td>${whoCell(grant, { isOwner, selfId })}</td><td><span class="ma-mrole">${esc(roleWord(grant.role))}</span> <span class="quiet">on ${esc(canvasName(grant.canvas_path))} only</span></td><td></td></tr>`;
}

/** An invitation nobody has followed yet. Owner-only: it carries an address. */
function inviteRow(invite, { projectId = null, withControls = false, csrf = null } = {}) {
  const where = invite.canvas_path ? ` on ${esc(canvasName(invite.canvas_path))}` : '';
  // Send again mails the SAME link and renews it; Cancel ends it. Only where
  // the page can act on it: the project's own page, for a row that has an id.
  const controls =
    withControls && projectId && invite.id
      ? `<form class="inline" method="post" action="/projects/${esc(projectId)}/people">
           <input type="hidden" name="csrf" value="${esc(csrf ?? '')}">
           <input type="hidden" name="invite" value="${esc(invite.id)}">
           <button type="submit" name="do" value="invite-resend" class="btn btn--sm">Send again</button>
           <button type="submit" name="do" value="invite-cancel" class="btn btn--sm btn--ghost">Cancel invite</button>
         </form>`
      : '';
  return `<tr class="is-dim"><td><span class="ma-who">${avatar(invite.email, { seed: invite.email, tone: 'grey' })}<span class="ma-who-t"><strong>${esc(invite.email)}</strong><span>Invited, not joined yet · the link works until ${esc(day(invite.expires_at))}</span></span></span></td><td><span class="ma-mrole">${esc(roleWord(invite.role))}</span>${where ? ` <span class="quiet">${where}</span>` : ''}</td><td class="right">${controls}</td></tr>`;
}

/** What each word means — said once, under the list, instead of on every row. */
function roleKey({ canView }) {
  const words = ['member', 'viewer', ...(canView ? ['observer'] : [])];
  return `<p class="pp-key">${words.map((r) => `<strong>${esc(roleWord(r))}</strong> ${esc(ROLE_MEANING[r].replace(/\.$/, '').toLowerCase())}`).join(' · ')}${
    canView ? '' : `<br>${esc(CAN_VIEW_UNAVAILABLE)}`
  }</p>`;
}

/**
 * The list of who is on a project — people, canvas grants and (owner only)
 * the invitations still open, in ONE table. The project's People page uses it.
 */
export function peopleRowsTable({
  people = [],
  grants = [],
  invites = [],
  isOwner,
  selfId = null,
  projectId = null,
  withControls = false,
  csrf = null,
  canView = true,
}) {
  const rows = [
    ...people.map((p) => personRow(p, { projectId, isOwner, selfId, withControls, canView })),
    ...grants.map((g) => grantRow(g, { isOwner, selfId })),
    ...(isOwner ? invites.map((i) => inviteRow(i, { projectId, withControls, csrf })) : []),
  ];
  return `<div class="ma-card ma-card--clip pp-list"><table class="ma-table">
       <thead><tr><th scope="col">Person</th><th scope="col">Can</th><th scope="col"><span class="ma-sr">Invitation</span></th></tr></thead>
       <tbody>${rows.join('\n')}</tbody>
     </table>${roleKey({ canView })}</div>`;
}

/**
 * The people panel.
 *
 * @param {object} args
 * @param {{id: string, name: string}} args.project
 * @param {{account_id: string, email: string, name?: string|null, role: string}[]} args.people
 * @param {{account_id: string, email: string, name?: string|null, role: string, canvas_path: string}[]} [args.grants]
 *   people with access to one canvas (V2-1.7 canvas grants)
 * @param {{email: string, role: string, canvas_path?: string|null, expires_at: number}[]} [args.invites]
 *   pending invitations — rendered for the owner only
 * @param {boolean} args.isOwner
 */
export function peoplePage({
  account,
  project,
  people = [],
  grants = [],
  invites = [],
  isOwner,
  error = null,
  notice = null,
  csrf = null,
  canView = true,
}) {
  const selfId = account?.id ?? null;
  const invite = isOwner
    ? `<form class="pp-add ma-gap-b" method="post" action="/projects/${esc(project.id)}/people">
         <input type="email" name="email" placeholder="Invite by e-mail" aria-label="Their email"
                required>
         ${roleSelect('role', 'member', { canView })}
         <button type="submit" name="do" value="invite" class="btn btn--primary">Send invitation</button>
       </form>
`
    : '';
  return page(
    'People',
    `${error ? `<p class="error">${esc(error)}</p>` : ''}
     ${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
     ${invite}
     ${peopleRowsTable({ people, grants, invites, isOwner, selfId, projectId: project.id, withControls: true, csrf, canView })}
     ${isOwner ? '' : '<p class="quiet">Only the project’s owner can add or remove people.</p>'}`,
    {
      account,
      project,
      isOwner,
      lede: null,
    }
  );
}

/**
 * The confirmation before a removal.
 *
 * Its whole job is to be honest about timing. "Remove" reads as instantaneous;
 * it is not, and the person clicking needs to know that BEFORE they decide,
 * not afterwards from a support reply.
 */
export function removeConfirmPage({ account, project, person, tokenTtlMs, csrf }) {
  const effect = removalEffect({ tokenTtlMs });
  return page(
    `Remove ${person.email}?`,
    `<p class="quiet" style="margin:0 0 var(--space-5)"><a href="/projects/${esc(project.id)}/people">← Back to People</a></p>
     <div class="card warn">
       <ul>
         <li>${esc(effect.immediate[0])}</li>
         <li>${esc(effect.delayed)}</li>
       </ul>
       <p class="quiet" style="font-size:.9rem;margin:.8rem 0 0">${esc(effect.ifUrgent)}</p>
     </div>
     <form method="post" action="/projects/${esc(project.id)}/people">
       <input type="hidden" name="account" value="${esc(person.account_id)}">
       ${csrf ? `<input type="hidden" name="csrf" value="${esc(csrf)}">` : ''}
       <button type="submit" name="do" value="remove">Remove them</button>
       <a href="/projects/${esc(project.id)}/people" style="margin-left:1rem">Cancel</a>
     </form>`,
    // The shell options were destructured but never passed, so the confirm
    // step dropped the nav and the account chip — the one page in the flow
    // where somebody most needs to see which project they are acting on.
    // Only an owner reaches removal, hence isOwner.
    { account, project, isOwner: true }
  );
}

/** Every customer-facing string here, for the vocabulary lint. */
export function allPeopleHtml() {
  const project = { id: 'alligators', name: 'Brno Alligators' };
  const people = [
    { account_id: 'a1', email: 'owner@example.com', role: 'owner' },
    { account_id: 'a2', email: 'member@example.com', role: 'member' },
    { account_id: 'a3', email: 'viewer@example.com', role: 'viewer' },
  ];
  const account = { id: 'a1', email: 'owner@example.com' };
  const grants = [
    {
      account_id: 'a4',
      email: 'grant@example.com',
      name: 'Jonas',
      role: 'viewer',
      canvas_path: 'ui/Homepage.tsx',
    },
  ];
  const invites = [
    { email: 'new@example.com', role: 'observer', canvas_path: null, expires_at: 1760000000000 },
  ];
  return [
    peoplePage({ account, project, people, grants, invites, isOwner: true }),
    peoplePage({ account: { id: 'a3' }, project, people, grants, invites, isOwner: false }),
    peoplePage({ account, project, people, isOwner: true, error: 'That is not an email address.' }),
    peoplePage({ account, project, people, isOwner: true, notice: 'Invitation sent.' }),
    removeConfirmPage({ account, project, person: people[1], tokenTtlMs: 12 * 3_600_000 }),
  ].join('\n');
}
