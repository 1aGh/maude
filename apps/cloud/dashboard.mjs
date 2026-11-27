// The one place — Cloud Phase 22 Task 4 (DDR-204).
//
// Before this, a customer with three projects signed in four times: once to
// the platform and once to each project's own admin, because a project is a
// hub and a hub was originally something one person self-hosted. This is the
// page that makes that history invisible.
//
// It is a CONTROL surface. It shows what you have, what it costs, and what
// state it is in — and hands you into a project rather than asking you to
// find it. Per-project detail is fetched from the project itself; the person
// never types a second address and never learns that a "cell" exists.
//
// Server-rendered, no script. The dashboard is where somebody goes when
// something is wrong, and a page that needs JavaScript to tell you your
// project is paused is a page that cannot tell you anything when it is broken.

import { appShell, avatar, icon, stat, statusWord, thumb } from './brand.mjs';
import pricing from './pricing.json' with { type: 'json' };

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/**
 * What a project's state means to the person who owns it.
 *
 * Our state names are ours. `past_due` is an accounting word, `suspended`
 * sounds like a punishment, and `pending` tells somebody nothing about whether
 * to wait or to worry. Each one gets a sentence that says what is true and
 * what, if anything, they should do.
 */
export const STATE_COPY = {
  pending: {
    tone: 'warn',
    label: 'Setting up',
    // No email promise — no such email exists yet, and the setup page is the
    // thing that actually finishes the job (it drives settlement as it polls).
    note: 'This usually takes a minute or two. The setup page shows each step live.',
  },
  active: { tone: 'ok', label: 'Ready', note: null },
  past_due: {
    tone: 'warn',
    label: 'Payment did not go through',
    note: 'Your work is safe and the project keeps running. Update your card to avoid it pausing.',
  },
  suspended: {
    tone: 'stop',
    label: 'Paused',
    note: 'Nothing has been deleted. Restart it, or download everything and keep it.',
  },
  exported: {
    tone: 'warn',
    label: 'Downloaded, ready to delete',
    note: 'You have a full copy. Deleting is permanent from here.',
  },
  purged: {
    tone: 'stop',
    label: 'Deleted',
    note: 'This project was deleted. If you downloaded it, that copy is still yours.',
  },
};

/** The doors of one project, filtered by what this person may actually do. */
function projectMenu(project, { can }) {
  const p = `/projects/${esc(project.id)}`;
  const menu = [];
  // "Open" goes to OUR connect page, never to a bare hostname (Cloud Phase 23
  // A1). A pending project opens its live setup instead; a deleted one has
  // nothing to open.
  if (project.state === 'pending') menu.push(`<a href="${p}/setup">Setup progress</a>`);
  else if (project.state !== 'purged') menu.push(`<a href="${p}/connect">Open</a>`);
  // The same four doors as the project's own strip (Open, People, Activity,
  // Settings), then the two an owner reaches for in a hurry. Download stays
  // one click away in every state: an export you can only reach while
  // everything is fine is not a guarantee.
  if (can('invite')) menu.push(`<a href="${p}/people">People</a>`);
  menu.push(`<a href="${p}/audit">Activity</a>`);
  if (can('delete')) {
    menu.push(`<a href="${p}/settings">Settings</a>`);
    menu.push('<div class="menu-sep"></div>');
    menu.push(`<a href="${p}/download">Download everything</a>`);
    if (project.state !== 'purged')
      menu.push(`<a class="danger" href="${p}/delete">Delete project…</a>`);
  }
  return `<details class="menu ma-hover-menu">
    <summary aria-label="More for ${esc(project.name || project.id)}">${icon('more', 14)}</summary>
    <div class="menu-list">${menu.join('\n')}</div>
  </details>`;
}

const primaryHref = (project) =>
  `/projects/${esc(project.id)}/${project.state === 'pending' ? 'setup' : 'connect'}`;

/** The state of a project as a word with a dot (the old three tones, said the DS way). */
const SW = { ok: 'ok', warn: 'warn', stop: 'off' };

/** What a role lets a person do, in the words of the People page. */
const ROLE_WORD = {
  owner: 'Owner',
  admin: 'Can edit',
  member: 'Can edit',
  editor: 'Can edit',
  viewer: 'Can comment',
  commenter: 'Can comment',
  observer: 'Can view',
};

function faces(people) {
  if (!people?.length) return '';
  return `<span class="ma-faces">${people
    .slice(0, 3)
    .map((who) => avatar(who.name || who.email, { size: 'sm', seed: who.email }))
    .join('')}</span>`;
}

/**
 * One project card (canvas 16, cl-account): its picture, its name, one quiet
 * line, and its state said in a word.
 *
 * The picture is the same neutral one for every project — the control plane
 * never sees what is on a canvas. Actions are filtered by what this person may
 * actually do: a menu that shows everything and then refuses teaches people
 * that the interface lies.
 */
function projectCard(project, { can, plan = null, week = null, people = null }) {
  const copy = STATE_COPY[project.state] ?? { tone: 'warn', label: project.state, note: null };
  const meta =
    week !== null
      ? `${week} ${week === 1 ? 'change' : 'changes'} this week`
      : project.role === 'owner'
        ? ''
        : (ROLE_WORD[project.role] ?? '');
  return `<article class="ma-proj">
    ${thumb()}
    <span class="ma-proj-b">
      <strong><a href="${primaryHref(project)}">${esc(project.name || project.id)}</a></strong>
      <span class="ma-proj-m"><span>${esc(meta)}</span>${faces(people)}</span>
      ${statusWord(SW[copy.tone] ?? 'warn', copy.label)}
      ${copy.note ? `<span class="ma-proj-n">${esc(copy.note)}</span>` : ''}
      ${
        // The plan, for the OWNER only (plan-copy.mjs): a trial with the date
        // it is free until, Promo, or that a plan is due. A member's card has
        // no such line — a plan is the owner's business (canvas 16).
        plan?.line ? `<span class="ma-proj-n plan-line">${esc(plan.line)}</span>` : ''
      }
    </span>
    ${projectMenu(project, { can })}
  </article>`;
}

function bytesWord(n) {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let v = Number(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const shortDay = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/**
 * "Changes per day", thirty UTC days ending today — bars drawn in HTML and
 * CSS, no script (this page's CSP allows none, and it is the page somebody
 * opens when something is wrong).
 *
 * The bars are a picture (`role="img"`) with the whole story in its label: a
 * screen reader hears the range and the total instead of thirty unlabeled
 * boxes. Every number here is an integer that changes.mjs validated; the only
 * text is a date this function formatted itself.
 */
function changesChart(changes) {
  const days = changes.days;
  const max = Math.max(...days.map((d) => d.count));
  const total = days.reduce((n, d) => n + d.count, 0);
  const peak = days.reduce((a, d) => (d.count > a.count ? d : a), days[0]);
  const low = Math.min(...days.map((d) => d.count));
  const summary = `Changes per day over ${days.length} days: lowest ${low}, highest ${max}${max > 0 ? ` on ${shortDay(peak.day)}` : ''}, ${total} in total, ${days.at(-1).count} today.`;
  const bars = days
    .map((d) => {
      const pct = max > 0 ? Math.max(d.count > 0 ? 3 : 0, Math.round((d.count / max) * 100)) : 0;
      return `<i style="height:100%"><b style="height:${pct}%"></b></i>`;
    })
    .join('');
  return `<div class="ma-card chart">
    <h2 class="ma-card-h">Changes per day <span class="ma-legend" aria-hidden="true"><span><i></i>Earlier days</span><span><i class="ma-lg-a"></i>Today</span></span></h2>
    <div class="ma-bars" role="img" aria-label="${esc(summary)}">${bars}</div>
    <div class="ma-bars-x" aria-hidden="true"><span>${esc(shortDay(days[0].day))}</span><span>${esc(shortDay(days[Math.floor(days.length / 2)].day))}</span><span>Today</span></div>
    ${changes.reporting < changes.of ? `<p class="ma-card-p">From the ${changes.reporting} of your ${changes.of} projects that report it.</p>` : ''}
  </div>`;
}

/** Where people open their work: the places a person recognises, each with its picture. */
const SURFACE_WORD = { desktop: 'Mac app', browser: 'Browser', cli: 'Command line' };
const SURFACE_GLYPH = { desktop: 'laptop', browser: 'web', cli: 'file' };

/**
 * How the owner's projects are used (canvas 16, cl-account): the row of
 * tiles, then "Changes per day" beside "Where people open their work".
 *
 * EVERY TILE IS OPTIONAL, AND ABSENT RATHER THAN EMPTY. A figure the platform
 * could not read is `null` and its tile is not rendered: a "0" under Exports
 * that means "the read failed" is a number somebody will repeat. The row
 * re-divides itself over the tiles that are there.
 */
function overviewSection(overview) {
  if (!overview) return '';
  const tiles = [];
  const approx = overview.sampled ? '~' : '';
  if (overview.activeThisWeek !== null) {
    tiles.push(
      stat({
        label: 'Active this week',
        glyph: 'people',
        value: `${approx}${overview.activeThisWeek}`,
        unit: overview.people !== null ? `of ${overview.people}` : null,
        href: '/account/people',
      })
    );
  } else if (overview.people !== null) {
    tiles.push(
      stat({
        label: 'People',
        glyph: 'people',
        value: String(overview.people),
        unit: `in ${overview.projects} ${overview.projects === 1 ? 'project' : 'projects'}`,
        href: '/account/people',
      })
    );
  }
  // Changes this week — the workspaces' own count (changes.mjs). Present only
  // when at least one of the owner's projects reports it.
  const changes = overview.changes ?? null;
  if (changes) {
    const top = changes.perProject[0];
    const max = Math.max(1, ...changes.days.map((d) => d.count));
    tiles.push(
      stat({
        label: 'Changes',
        glyph: 'edit',
        value: String(changes.week),
        spark: changes.days.slice(-14).map((d) => (d.count / max) * 100),
        foot: `<span>${esc(
          [
            'this week',
            ...(changes.perProject.length > 1 && top.week > 0 ? [`most in ${top.name}`] : []),
            ...(changes.reporting < changes.of
              ? [`${changes.reporting} of ${changes.of} projects report`]
              : []),
          ].join(' · ')
        )}</span>`,
      })
    );
  }
  if (overview.canvases !== null) {
    tiles.push(stat({ label: 'Canvases', glyph: 'file', value: String(overview.canvases) }));
  }
  if (overview.exports !== null) {
    tiles.push(
      stat({
        label: 'Exports',
        glyph: 'export',
        value: `${approx}${overview.exports}`,
        foot: '<span>last 30 days</span>',
      })
    );
  }
  if (overview.storageBytes !== null) {
    const [amount, unit] = bytesWord(overview.storageBytes).split(' ');
    tiles.push(stat({ label: 'Storage', glyph: 'server', value: amount, unit }));
  }

  const rows = [];
  const opens = overview.opens ? Object.entries(overview.opens).filter(([, n]) => n > 0) : [];
  const total = opens.reduce((sum, [, n]) => sum + n, 0);
  const row = (glyph, name, line) =>
    rows.push(
      `<div class="ma-need${rows.length ? '' : ' ma-need--first'}">${icon(glyph)}<span class="ma-need-t"><strong>${esc(name)}</strong><span>${esc(line)}</span></span></div>`
    );
  for (const [surface, n] of opens.sort((a, b) => b[1] - a[1])) {
    row(
      SURFACE_GLYPH[surface] ?? 'file',
      SURFACE_WORD[surface] ?? surface,
      `${approx}${n} opens · ${Math.round((n / total) * 100)} %`
    );
  }
  if (overview.invites) {
    const i = overview.invites;
    row('people', 'Invites', `${i.sent} sent · ${i.joined} joined · ${i.waiting} waiting`);
  }
  if (!tiles.length && !rows.length) return '';
  const where = rows.length
    ? `<div class="ma-card where">
         <h2 class="ma-card-h">${opens.length ? 'Where people open their work' : 'Invitations'} <small>last 30 days</small></h2>
         <div class="ma-feed">${rows.join('\n')}</div>
       </div>`
    : '';
  const chart = changes ? changesChart(changes) : '';
  return `<section class="overview" aria-label="How your projects are used">
    ${tiles.length ? `<div class="ma-stats" style="--n:${tiles.length}">${tiles.join('\n')}</div>` : ''}
    ${chart && where ? `<div class="ma-cols ma-cols--2-1 ma-cols--even">${chart}${where}</div>` : `${chart}${where}`}
  </section>`;
}

/** How many project cards the Overview's strip shows before "All N" takes over. */
const STRIP = 5;

const newProjectTile = `<a class="ma-proj ma-proj--new" href="/projects/new"><span class="ma-plus">${icon('plus', 16)}</span>New project</a>`;

/** The strip of project cards, with the "New project" tile at its end. */
function projectStrip(projects, { can, plans, overview, limit = STRIP }) {
  const weekOf = new Map((overview?.changes?.perProject ?? []).map((p) => [p.id, p.week]));
  const shown = limit ? projects.slice(0, limit) : projects;
  const cards = shown.map((p) =>
    projectCard(p, {
      can: (capability) => can(p.role, capability),
      plan: p.role === 'owner' ? (plans?.get(p.id) ?? null) : null,
      week: p.role === 'owner' && weekOf.has(p.id) ? weekOf.get(p.id) : null,
      people: p.role === 'owner' ? (overview?.faces?.get(p.id) ?? null) : null,
    })
  );
  return `<div class="ma-projects" style="--n:${limit ? STRIP + 1 : 4}">${cards.join('\n')}${newProjectTile}</div>`;
}

/**
 * A member's Overview (canvas 16, un-member-cl): what is shared with them and
 * what they may do in each — and, apart from that, their own account.
 *
 * No plan, no billing and no People of the projects here: those are the
 * owner's. What a member is offered is a project of their OWN.
 */
function memberOverview({ projects, can }) {
  const owners = [...new Set(projects.map((p) => p.ownerName).filter(Boolean))];
  const rows = projects
    .map((p) => {
      const copy = STATE_COPY[p.state] ?? { tone: 'warn', label: p.state, note: null };
      return `<tr>
        <td><a class="ma-who" href="${primaryHref(p)}">${thumb('ma-thumb--row')}<span class="ma-who-t"><strong>${esc(p.name || p.id)}</strong><span>${esc(owners.length === 1 ? copy.label : p.ownerName ? `${p.ownerName} · ${copy.label}` : copy.label)}</span></span></a></td>
        <td><span class="ma-mrole">${esc(ROLE_WORD[p.role] ?? 'Can view')}</span></td>
        <td><span class="ma-row-a">${projectMenu(p, { can: (capability) => can(p.role, capability) })}${p.state === 'purged' ? '' : `<a class="btn btn--ghost btn--sm" href="${primaryHref(p)}">${p.state === 'pending' ? 'Setup progress' : 'Open'}</a>`}</span></td>
      </tr>${copy.note ? `<tr class="is-dim"><td colspan="3" class="ma-wrap">${esc(copy.note)}</td></tr>` : ''}`;
    })
    .join('\n');
  return `<div class="ma-cols ma-cols--2-1">
    <div class="ma-card ma-card--clip">
      <h2 class="ma-card-h">Shared with you${owners.length === 1 ? ` by ${esc(owners[0])}` : ''}</h2>
      <div class="ma-scroll"><table class="ma-table">
        <thead><tr><th scope="col">Project</th><th scope="col">You can</th><th scope="col"><span class="ma-sr">Action</span></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>
    <div class="ma-stack">
      <div class="ma-card">
        <h2 class="ma-card-h">Your own account</h2>
        <div class="ma-need ma-need--first">${icon('folder')}<span class="ma-need-t"><strong>No projects of your own yet</strong><span>${pricing.trialDays} days free, no card. Only you pay for what you start.</span></span><span class="ma-need-a"><a class="btn btn--sm" href="/projects/new">Start a project</a></span></div>
      </div>
      <div class="ma-card">
        <h2 class="ma-card-h">Devices</h2>
        <div class="ma-need ma-need--first">${icon('laptop')}<span class="ma-need-t"><strong>Where the Maude app is signed in</strong><span>Mac, Windows or Linux — see them, and sign one out.</span></span><span class="ma-need-a"><a class="btn btn--ghost btn--sm" href="/account/devices">Manage</a></span></div>
      </div>
      <div class="ma-card">
        <h2 class="ma-card-h">Notifications</h2>
        <div class="ma-need ma-need--first">${icon('pulse')}<span class="ma-need-t"><strong>Mentions</strong><span>Which e-mails Maude Cloud sends you.</span></span><span class="ma-need-a"><a class="btn btn--ghost btn--sm" href="/account/notifications">Change</a></span></div>
      </div>
    </div>
  </div>`;
}

const EMPTY = `<div class="ma-card ma-empty empty">
  <p><strong>No projects yet.</strong></p>
  <p class="note">A project is one design system and the work around it.
    You can invite people to it once it exists.</p>
  <form method="get" action="/projects/new"><button type="submit" class="btn btn--primary">Start a project</button></form>
</div>`;

/**
 * The Overview — what "/" is for a signed-in person.
 *
 * An OWNER gets how their projects are used and the strip of project cards
 * (cl-account). A MEMBER — somebody who owns nothing here — gets what is
 * shared with them and their own account beside it (un-member-cl).
 *
 * @param {object} args
 * @param {{email: string, name?: string}} args.account
 * @param {object[]} args.projects  each with `role`, so actions can be filtered
 * @param {(role: string, capability: string) => boolean} args.can
 * @param {boolean} [args.isOperator]  Cloud Phase 26 — adds the operator's way
 *   in to the avatar menu. Default false keeps a customer's shell free of it.
 */
export function dashboardPage({
  account,
  projects = [],
  can,
  isOperator = false,
  overview = null,
  plans = null,
}) {
  const owned = projects.filter((p) => p.role === 'owner');
  const name = String(account?.name ?? '').trim() || String(account?.email ?? '').split('@')[0];
  const first = name.split(/\s+/)[0];

  if (projects.length && !owned.length) {
    const owners = [...new Set(projects.map((p) => p.ownerName).filter(Boolean))];
    const n = `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`;
    return appShell({
      account,
      title: 'Your projects',
      heading: `Hi ${first}.`,
      lede: owners.length === 1 ? `${owners[0]} shares ${n} with you` : `${n} shared with you`,
      active: 'overview',
      wide: true,
      body: memberOverview({ projects, can }),
      isOperator,
    });
  }

  const facts = [];
  if (owned.length) facts.push(`${owned.length} ${owned.length === 1 ? 'project' : 'projects'}`);
  if (overview?.people != null) {
    facts.push(`${overview.people} ${overview.people === 1 ? 'person' : 'people'}`);
  }
  const body = projects.length
    ? `${overviewSection(overview)}
       <div class="ma-card ma-gap">
         <h2 class="ma-card-h">Projects <a class="ma-link" href="/projects">All ${projects.length}</a></h2>
         ${projectStrip(projects, { can, plans, overview })}
       </div>`
    : EMPTY;

  return appShell({
    account: owned.length ? { ...account, owns: account?.owns ?? owned.length } : account,
    title: 'Your projects',
    heading: owned.length ? `${name} on Maude Cloud` : `Hi ${first}.`,
    lede: facts.join(' · ') || null,
    actions: `${owned.length ? `<a class="btn" href="/account/people?sheet=invite">${icon('people', 14)}Invite people</a>` : ''}<a class="btn btn--primary" href="/projects/new">${icon('plus', 14)}New project</a>`,
    active: 'overview',
    wide: true,
    foot: true,
    body,
    isOperator,
  });
}

/**
 * Every project this person can see, as one grid — the Projects tab.
 */
export function projectsPage({ account, projects = [], can, overview = null, plans = null }) {
  const owned = projects.filter((p) => p.role === 'owner');
  return appShell({
    account: owned.length ? { ...account, owns: account?.owns ?? owned.length } : account,
    title: 'Projects',
    lede: projects.length
      ? `${projects.length} ${projects.length === 1 ? 'project' : 'projects'} you can open`
      : null,
    actions: `<a class="btn btn--primary" href="/projects/new">${icon('plus', 14)}New project</a>`,
    active: 'projects',
    wide: true,
    body: projects.length
      ? `<div class="ma-card"><h2 class="ma-card-h">All projects <small>${projects.length}</small></h2>${projectStrip(projects, { can, plans, overview, limit: 0 })}</div>`
      : EMPTY,
  });
}

/** Every customer-facing string on this surface, for the vocabulary lint. */
export function allDashboardHtml() {
  const can = () => true;
  const projects = Object.keys(STATE_COPY).map((state, i) => ({
    id: `p${i}`,
    name: `Project ${i}`,
    state,
    role: 'owner',
  }));
  return [
    dashboardPage({ account: { email: 'a@example.com' }, projects: [], can }),
    dashboardPage({ account: { email: 'a@example.com' }, projects, can }),
    dashboardPage({
      account: { email: 'a@example.com', name: 'Anna Example' },
      projects: projects.map((p) => ({ ...p, role: 'viewer', ownerName: 'Example Studio' })),
      can,
    }),
    projectsPage({ account: { email: 'a@example.com' }, projects, can }),
    projectsPage({ account: { email: 'a@example.com' }, projects: [], can }),
    dashboardPage({
      account: { email: 'a@example.com' },
      projects,
      can,
      overview: {
        projects: 2,
        people: 12,
        invites: { sent: 7, joined: 5, waiting: 2 },
        activeThisWeek: 9,
        canvases: 208,
        exports: 48,
        storageBytes: 3.2 * 1024 ** 3,
        opens: { desktop: 1104, browser: 214 },
        sampled: false,
        changes: {
          days: Array.from({ length: 30 }, (_, i) => ({
            day: `2026-10-${String(i + 1).padStart(2, '0')}`,
            count: (i * 7) % 23,
          })),
          week: 96,
          perProject: [
            { id: 'p0', name: 'Project 0', week: 70 },
            { id: 'p1', name: 'Project 1', week: 26 },
          ],
          reporting: 2,
          of: 3,
        },
      },
      plans: new Map([
        ['p0', { line: 'Promo from Maude · free' }],
        ['p1', { line: 'Free trial · 12 days left · free until 6 October 2026' }],
        ['p2', { line: 'Paused · Choose a plan to keep editing.' }],
        ['p3', { line: 'Paused by Maude · nothing is deleted' }],
      ]),
    }),
  ].join('\n');
}
