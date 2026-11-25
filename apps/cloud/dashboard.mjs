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

import { appShell } from './brand.mjs';

// Styling comes from the design system shell (brand.mjs). What is left here
// is a GALLERY of project cards: a decorative mini-canvas header (the
// showcase's artboards-on-dots motif, in pure CSS), the name + state, one
// primary action, and everything secondary folded into a ⋯ menu — a native
// <details> dropdown, because these pages ship no script.
const CSS = `
  .main-inner { max-width: 72rem; }
  .projects { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-5); }
  .project {
    display: flex; flex-direction: column;
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: visible;
    box-shadow: var(--shadow-sm);
    transition: border-color var(--dur-soft) var(--ease-out), box-shadow var(--dur-soft) var(--ease-out);
  }
  .project:hover { border-color: var(--border-default); box-shadow: var(--shadow-md); }

  .pcanvas {
    display: block; position: relative; height: 96px;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    border-bottom: 1px solid var(--border-subtle);
    background-color: var(--bg-0);
    background-image: radial-gradient(var(--canvas-dot) 1px, transparent 1px);
    background-size: 16px 16px;
    overflow: hidden;
  }
  .pcanvas .ab { position: absolute; background: var(--bg-3); border: 1px solid var(--border-default); border-radius: var(--radius-xs); }
  .pcanvas .ab-1 { left: 14%; top: 22%; width: 26%; height: 52%; }
  .pcanvas .ab-2 { left: 46%; top: 34%; width: 20%; height: 40%; }
  .pcanvas .ab-3 { left: 72%; top: 18%; width: 14%; height: 34%; }
  .project:hover .pcanvas .ab-1 { border-color: var(--accent-muted); }

  .pbody { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4) var(--space-5) var(--space-5); flex: 1; }
  .prow { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
  .prow h2 { margin: 0; font-size: var(--type-md); line-height: var(--lh-md); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prow h2 a { color: var(--fg-0); text-decoration: none; }
  .prow h2 a:hover { color: var(--accent-hover); }
  .note { color: var(--fg-2); font-size: var(--type-sm); line-height: var(--lh-sm); margin: 0; }
  .pfoot { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-top: auto; padding-top: var(--space-4); }
  .pfoot .btn { font-size: var(--type-sm); line-height: var(--lh-sm); padding: var(--space-2) var(--space-4); }

  .menu { position: relative; }
  .menu > summary {
    list-style: none; cursor: pointer;
    display: grid; place-items: center;
    width: 30px; height: 30px; border-radius: var(--radius-md);
    color: var(--fg-2); font-weight: 600; letter-spacing: 0.08em;
    border: 1px solid transparent;
    transition: background var(--dur-soft) var(--ease-out), color var(--dur-soft) var(--ease-out);
  }
  .menu > summary::-webkit-details-marker { display: none; }
  .menu > summary:hover { background: var(--bg-2); color: var(--fg-0); }
  .menu[open] > summary { background: var(--bg-3); color: var(--fg-0); border-color: var(--border-default); }
  .menu-list {
    position: absolute; right: 0; top: calc(100% + var(--space-2)); z-index: 20;
    min-width: 210px; padding: var(--space-2);
    background: var(--bg-2); border: 1px solid var(--border-default);
    border-radius: var(--radius-md); box-shadow: var(--shadow-md);
    display: flex; flex-direction: column;
  }
  .menu-list a {
    display: block; padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--fg-1); text-decoration: none; font-size: var(--type-base);
  }
  .menu-list a:hover { background: var(--bg-3); color: var(--fg-0); }
  .menu-list a.danger { color: var(--status-error); }
  .menu-list .menu-sep { height: 1px; background: var(--border-subtle); margin: var(--space-2) var(--space-2); }

  .overview { margin: 0 0 var(--space-7); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--space-4); margin: 0 0 var(--space-4); }
  .tile { background: var(--bg-1); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: var(--space-4) var(--space-5); margin: 0; }
  .tile dt { font-family: var(--font-mono); font-size: var(--type-xs); text-transform: uppercase; letter-spacing: .06em; color: var(--fg-2); margin: 0 0 var(--space-2); }
  .tile dd { margin: 0; font-family: var(--font-display); font-size: var(--type-xl); line-height: var(--lh-xl); color: var(--fg-0); font-variant-numeric: tabular-nums; }
  .tile .sub { font-family: var(--font-sans); font-size: var(--type-sm); color: var(--fg-2); }
  .where { background: var(--bg-1); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: var(--space-4) var(--space-5); }
  .where h2 { margin: 0 0 var(--space-2); font-size: var(--type-md); }
  .where ul { list-style: none; margin: 0; padding: 0; }
  .where li { display: flex; gap: var(--space-4); justify-content: space-between; padding: var(--space-2) 0; border-top: 1px solid var(--border-subtle); }
  .where li:first-child { border-top: 0; }
  .where li span { color: var(--fg-2); font-variant-numeric: tabular-nums; }
  .plan-line { color: var(--fg-1); }
  .chart { margin-bottom: var(--space-4); }
  .bars { display: flex; align-items: flex-end; gap: 3px; height: 96px; padding-top: var(--space-2); }
  .bar { flex: 1; min-width: 2px; background: var(--border-strong); border-radius: 2px 2px 0 0; }
  .bar-today { background: var(--accent); }
  .axis { display: flex; justify-content: space-between; margin: var(--space-2) 0 0; font-size: var(--type-xs); color: var(--fg-2); }
  .empty {
    border: 1px dashed var(--border-default); border-radius: var(--radius-lg);
    padding: var(--space-8) var(--space-6); text-align: center; background: var(--bg-1);
    max-width: 34rem;
  }
`;

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

/**
 * One project card.
 *
 * Actions are filtered by what this person may actually do — a menu that shows
 * everything and then refuses is worse than a shorter menu, because it teaches
 * people that the interface lies.
 */
function projectCard(project, { can, plan = null }) {
  const copy = STATE_COPY[project.state] ?? { tone: 'warn', label: project.state, note: null };
  const p = `/projects/${esc(project.id)}`;

  // "Open" goes to OUR connect page, never to a bare hostname (Cloud Phase 23
  // A1) — the workspace's front door is an operator surface until the
  // one-click handoff lands, and a link that promises the project must not
  // deliver infrastructure. A pending project opens its live setup instead.
  const primary =
    project.state === 'pending'
      ? `<a class="btn" href="${p}/setup">Setup progress</a>`
      : project.state !== 'purged'
        ? `<a class="btn" href="${p}/connect">Open</a>`
        : '';
  const primaryHref = project.state === 'pending' ? `${p}/setup` : `${p}/connect`;

  // Everything secondary folds into the ⋯ menu, filtered by what this person
  // may actually do. "Download everything" is in EVERY state, including the
  // ones where somebody is deciding whether to leave — an export you can only
  // reach while everything is fine is not a guarantee.
  const menu = [];
  if (can('invite')) menu.push(`<a href="${p}/people">People</a>`);
  if (can('billing')) menu.push(`<a href="${p}/billing">Billing</a>`);
  if (can('mirror')) menu.push(`<a href="${p}/mirror">GitHub copy</a>`);
  menu.push(`<a href="${p}/audit">Activity</a>`);
  menu.push(`<a href="${p}/download">Download everything</a>`);
  if (can('delete') && project.state !== 'purged') {
    menu.push('<div class="menu-sep"></div>');
    menu.push(`<a class="danger" href="${p}/delete">Delete project…</a>`);
  }

  return `<article class="project">
    <a class="pcanvas" href="${primaryHref}" aria-hidden="true" tabindex="-1">
      <span class="ab ab-1"></span><span class="ab ab-2"></span><span class="ab ab-3"></span>
    </a>
    <div class="pbody">
      <div class="prow">
        <h2><a href="${primaryHref}">${esc(project.name || project.id)}</a></h2>
        <span class="state ${copy.tone}">${esc(copy.label)}</span>
      </div>
      ${copy.note ? `<p class="note">${esc(copy.note)}</p>` : ''}
      ${
        // The plan, for the OWNER only (plan-copy.mjs): a trial with the date
        // it is free until, Promo, or that a plan is due. A member's card has
        // no such line — a plan is the owner's business (canvas 16).
        plan?.line ? `<p class="note plan-line">${esc(plan.line)}</p>` : ''
      }
      <div class="pfoot">
        ${primary}
        <details class="menu">
          <summary aria-label="More for ${esc(project.name || project.id)}">⋯</summary>
          <div class="menu-list">${menu.join('\n')}</div>
        </details>
      </div>
    </div>
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
    .map((d, i) => {
      const pct = max > 0 ? Math.max(d.count > 0 ? 3 : 0, Math.round((d.count / max) * 100)) : 0;
      return `<span class="bar${i === days.length - 1 ? ' bar-today' : ''}" style="height: ${pct}%"></span>`;
    })
    .join('');
  return `<div class="where chart">
    <h2>Changes per day</h2>
    <div class="bars" role="img" aria-label="${esc(summary)}">${bars}</div>
    <p class="axis" aria-hidden="true"><span>${esc(shortDay(days[0].day))}</span><span>${esc(shortDay(days[Math.floor(days.length / 2)].day))}</span><span>Today</span></p>
    <p class="note">${changes.reporting < changes.of ? `From the ${changes.reporting} of your ${changes.of} projects that report it. ` : ''}Days are counted in UTC.</p>
  </div>`;
}

/** Where people open their work: the two places a person recognises. */
const SURFACE_WORD = { desktop: 'Mac app', browser: 'Browser', cli: 'Command line' };

/**
 * How the owner's projects are used (canvas 16, cl-account).
 *
 * EVERY TILE IS OPTIONAL, AND ABSENT RATHER THAN EMPTY. A figure the platform
 * could not read is `null` and its tile is not rendered: a "0" under Exports
 * that means "the read failed" is a number somebody will repeat. For the same
 * reason there is no Edits tile at all — nothing counts edits.
 */
function overviewSection(overview) {
  if (!overview) return '';
  const tiles = [];
  const tile = (label, value, sub = '') =>
    tiles.push(
      `<dl class="tile"><dt>${esc(label)}</dt><dd>${esc(value)}${sub ? ` <span class="sub">${esc(sub)}</span>` : ''}</dd></dl>`
    );
  const approx = overview.sampled ? '~' : '';
  if (overview.activeThisWeek !== null) {
    tile(
      'Active this week',
      `${approx}${overview.activeThisWeek}`,
      overview.people !== null ? `of ${overview.people}` : ''
    );
  }
  if (overview.people !== null) {
    tile(
      'People',
      String(overview.people),
      `in ${overview.projects} ${overview.projects === 1 ? 'project' : 'projects'}`
    );
  }
  // Changes this week — the cells' own count (changes.mjs). Present only when
  // at least one of the owner's projects reports it.
  const changes = overview.changes ?? null;
  if (changes) {
    const top = changes.perProject[0];
    tile(
      'Changes',
      String(changes.week),
      [
        'this week',
        ...(changes.perProject.length > 1 && top.week > 0 ? [`most in ${top.name}`] : []),
        ...(changes.reporting < changes.of
          ? [`${changes.reporting} of ${changes.of} projects report`]
          : []),
      ].join(' · ')
    );
  }
  if (overview.canvases !== null) tile('Canvases', String(overview.canvases));
  if (overview.exports !== null) tile('Exports', `${approx}${overview.exports}`, 'last 30 days');
  if (overview.storageBytes !== null) tile('Storage', bytesWord(overview.storageBytes));

  const rows = [];
  const opens = overview.opens ? Object.entries(overview.opens).filter(([, n]) => n > 0) : [];
  const total = opens.reduce((sum, [, n]) => sum + n, 0);
  for (const [surface, n] of opens.sort((a, b) => b[1] - a[1])) {
    rows.push(
      `<li><strong>${esc(SURFACE_WORD[surface] ?? surface)}</strong> <span>${approx}${n} opens · ${Math.round((n / total) * 100)} %</span></li>`
    );
  }
  if (overview.invites) {
    const i = overview.invites;
    rows.push(
      `<li><strong>Invites</strong> <span>${i.sent} sent · ${i.joined} joined · ${i.waiting} waiting</span></li>`
    );
  }
  if (!tiles.length && !rows.length) return '';
  return `<section class="overview" aria-label="How your projects are used">
    ${tiles.length ? `<div class="tiles">${tiles.join('\n')}</div>` : ''}
    ${changes ? changesChart(changes) : ''}
    ${
      rows.length
        ? `<div class="where"><h2>${opens.length ? 'Where people open their work' : 'Invitations'}</h2><ul>${rows.join('\n')}</ul>
             <p class="note">Opens and invitations are for the last 30 days. <a href="/account/people">People across your projects</a></p></div>`
        : ''
    }
  </section>`;
}

/**
 * The dashboard.
 *
 * @param {object} args
 * @param {{email: string}} args.account
 * @param {object[]} args.projects  each with `role`, so actions can be filtered
 * @param {(role: string, capability: string) => boolean} args.can
 * @param {boolean} [args.isOperator]  Cloud Phase 26. The shell can render the
 *   Fleet section, but only `operator-pages.mjs` ever asked it to — so the
 *   surface had no way IN except typing the URL. This is the way in, and the
 *   only customer-facing page that gets one: the dashboard is where a signed-in
 *   person starts. Default false keeps every other caller's shell unchanged.
 */
export function dashboardPage({
  account,
  projects = [],
  can,
  isOperator = false,
  overview = null,
  plans = null,
}) {
  const cards =
    projects.length === 0
      ? `<div class="empty">
           <p><strong>No projects yet.</strong></p>
           <p class="note">A project is one design system and the work around it.
             You can invite people to it once it exists.</p>
           <form method="get" action="/projects/new"><button type="submit">Start a project</button></form>
         </div>`
      : `<div class="projects">${projects
          .map((p) =>
            projectCard(p, {
              can: (capability) => can(p.role, capability),
              plan: p.role === 'owner' ? (plans?.get(p.id) ?? null) : null,
            })
          )
          .join('\n')}</div>`;
  const body = `${overviewSection(overview)}${cards}`;

  return appShell({
    account,
    title: 'Your projects',
    active: 'projects',
    extraCss: CSS,
    body,
    isOperator,
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
