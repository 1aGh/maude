/**
 * @canvas      CreateProject — start or open a shared project from inside Maude (native app, epic E3) · create a new GitHub repo (name · private/public · description), open an existing one (your projects list or a pasted link), watch it set up, and share it by GitHub username · 4 artboards docked in the studio shell · dark studio
 * @ds          maude
 * @platform    desktop
 * @opt_out     palette
 * @artboards   new-project | open-existing | creating | share
 * @brief       Phase 28 (native collab app, epic E3). The "New project" wizard creates a GitHub repo (private by default for non-technical safety — DDR), then clones + opens it as a working Maude project. "Open existing" lists your repos (listUserRepos) or takes a pasted link. The share sheet invites collaborators by GitHub username and copies an invite link. Vocabulary stays plain — "project" (repo), "private/public", "Invite", "people with access" — never "repository", "clone", "remote", "collaborator API". Lifts the GitPanel shell + Studio Hub card/field anatomy.
 * @stack       React 19 · TSX · Bun.build · css_mode=inline (sibling CreateProject.css)
 * @history     .design/_history/createproject/
 *
 * Authored under the `maude` DS ("Unified Pro Studio", dark-first). Shared classes
 * (.panel/.btn/.callout/.input/.field/.textarea/.seg/.kbd/.chip/.tab) are LIFTED.
 * Every artboard is a wizard/sheet DOCKED in the studio shell (menubar + dotted
 * canvas peek + scrim), so the surface always reads in context. Mirrors GitPanel.tsx.
 */

import "../../system/maude/colors_and_type.css";
import "../../system/maude/preview/_components.css";
import "./CreateProject.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

/* ───────────────────────────── Icon set (thin-stroke 1.4, no emoji) ─────────── */
type IconName = keyof typeof ICONS;
const ICONS = {
  plus: (<><line x1="8" y1="3" x2="8" y2="13" /><line x1="3" y1="8" x2="13" y2="8" /></>),
  lock: (<><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" /></>),
  globe: (<><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c1.7 1.5 2.6 3.5 2.6 5.5S9.7 12.5 8 13.5C6.3 12 5.4 10 5.4 8S6.3 3.5 8 2.5z" /></>),
  check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
  copy: (<><rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1.2" /><path d="M3 10.5V3.2A.7.7 0 0 1 3.7 2.5H10" /></>),
  external: (<><path d="M6 3.5H3.2A.7.7 0 0 0 2.5 4.2v8.6a.7.7 0 0 0 .7.7h8.6a.7.7 0 0 0 .7-.7V10" /><line x1="8" y1="8" x2="13" y2="3" /><polyline points="9.5 3 13 3 13 6.5" /></>),
  "chevron-down": <polyline points="3.5 6 8 10.5 12.5 6" />,
  "chevron-right": <polyline points="6 3.5 10.5 8 6 12.5" />,
  x: (<><line x1="3.5" y1="3.5" x2="12.5" y2="12.5" /><line x1="12.5" y1="3.5" x2="3.5" y2="12.5" /></>),
  folder: <path d="M2 4.5h4l1.3 1.5H14V13H2z" />,
  file: (<><path d="M4 2h5l3 3v9H4z" /><polyline points="9 2 9 5 12 5" /></>),
  link: (<><path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-1 1" /><path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l1-1" /></>),
  invite: (<><circle cx="6" cy="5.5" r="2.5" /><path d="M2 13.5a4 4 0 0 1 8 0" /><line x1="13" y1="5" x2="13" y2="9" /><line x1="11" y1="7" x2="15" y2="7" /></>),
  arrow: (<><line x1="3" y1="8" x2="12.5" y2="8" /><polyline points="9 4.5 12.5 8 9 11.5" /></>),
  spinner: <path d="M8 2.2a5.8 5.8 0 1 0 5.8 5.8" />,
} as const;

function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function Mark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span className={"cp-mark" + (className ? " " + className : "")} style={{ fontSize: size > 22 ? "var(--type-xl)" : undefined }}>
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.4 7.2a5 5 0 1 1 1.7 3.8L2.2 13.6l.5-2.7a5 5 0 0 1-.3-3.7z" fill="var(--bg-3)" stroke="var(--border-strong)" strokeWidth="0.8" />
        <path className="cp-mark-spark" d="M9.6 4.4l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z" fill="currentColor" />
      </svg>
      Maude
    </span>
  );
}

function Avatar({ initials, hue, size = 22 }: { initials: string; hue?: string; size?: number }) {
  return (
    <span className="cp-avatar" style={{ background: hue ?? "var(--accent)", width: size, height: size, fontSize: size > 30 ? "var(--type-base)" : undefined }}>{initials}</span>
  );
}

/* ── studio chrome (menubar + sidebar + canvas peek), shared by every artboard ── */
function MenuBar() {
  return (
    <div className="cp-menubar">
      <Mark />
      <span className="cp-context" title="Project and shared draft"><Icon name="folder" size={13} /><b>maude</b><span className="cp-sep">/</span>main</span>
      <span className="cp-spacer" />
      <span className="cp-avatars"><Avatar initials="YO" hue="var(--accent)" /><Avatar initials="AN" hue="var(--presence-online)" /></span>
    </div>
  );
}

function ShellFrame({ children }: { children?: React.ReactNode }) {
  return (
    <div className="cp-shell">
      <MenuBar />
      <div className="cp-main">
        <nav className="cp-side" aria-label="Projects">
          <button type="button" className="btn btn--primary cp-newbtn"><Icon name="plus" size={15} /> New project</button>
          <div className="cp-side-label">Your projects</div>
          <div className="cp-side-list">
            <div className="cp-side-proj is-active"><Icon name="lock" size={13} className="cp-side-vis" /><span className="cp-side-name">maude</span></div>
            <div className="cp-side-proj"><Icon name="lock" size={13} className="cp-side-vis" /><span className="cp-side-name">Acme Rebrand</span></div>
            <div className="cp-side-proj"><Icon name="globe" size={13} className="cp-side-vis" /><span className="cp-side-name">Portfolio 2026</span></div>
          </div>
        </nav>
        <div className="cp-stage cp-canvas-bleed">
          <div className="panel cp-mini">
            <div className="cp-mini-bar"><span className="cp-mini-dot" /><span className="cp-mini-dot" /><span className="cp-mini-dot" /></div>
            <div className="cp-mini-body">
              <div className="cp-sk" style={{ width: "58%", height: 14 }} />
              <div className="cp-sk" style={{ width: "90%" }} />
              <div className="cp-sk" style={{ width: "76%" }} />
              <div className="cp-sk is-accent" />
            </div>
          </div>
        </div>
        <div className="cp-scrim" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

function ModalShell({ title, sub, wide, children }: { title: string; sub?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="cp-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className={"cp-modal-card panel" + (wide ? " cp-modal-card--wide" : "")}>
        <div className="cp-modal-hd">
          <span className="cp-modal-titles">
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </span>
          <button type="button" className="btn btn--icon" aria-label="Close"><Icon name="x" size={15} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ─────────────────────────── A · New project wizard ────────────────────────── */
function NewProject() {
  return (
    <ModalShell title="Create a new project" sub="A private project on GitHub, set up and opened for you.">
      <div className="cp-body">
        <label className="cp-field">
          <span className="cp-field-label">Project name</span>
          <input className="input cp-input" type="text" defaultValue="Acme Rebrand" aria-label="Project name" />
          <span className="cp-field-help">This is the name your team will see. You can change it later.</span>
        </label>

        <div className="cp-field">
          <span className="cp-field-label">Who can see it</span>
          <div className="seg cp-seg" role="group" aria-label="Project visibility">
            <button type="button" aria-pressed="true"><Icon name="lock" size={14} /> Private</button>
            <button type="button" aria-pressed="false"><Icon name="globe" size={14} /> Public</button>
          </div>
          <span className="cp-field-help">Private — only you and people you invite. The safe default; switch to Public any time.</span>
        </div>

        <label className="cp-field">
          <span className="cp-field-label">Description <span className="cp-optional">optional</span></span>
          <textarea className="textarea cp-textarea" rows={2} placeholder="What is this project for?" aria-label="Project description" defaultValue="Rebrand explorations — logo, color, and the new marketing site." />
        </label>
      </div>

      <div className="cp-foot">
        <span className="cp-foot-note"><Icon name="folder" size={13} /> Creates <b>github.com/octocat/acme-rebrand</b></span>
        <span className="cp-spacer" />
        <button type="button" className="btn btn--ghost">Cancel</button>
        <button type="button" className="btn btn--primary"><Icon name="plus" size={15} /> Create project</button>
      </div>
    </ModalShell>
  );
}

/* ─────────────────────────── B · Open an existing project ───────────────────── */
type Repo = { name: string; vis: "lock" | "globe"; when: string; owner?: string };
const REPOS: Repo[] = [
  { name: "Acme Rebrand", vis: "lock", when: "edited 2 days ago" },
  { name: "Portfolio 2026", vis: "globe", when: "edited last week" },
  { name: "Studio Marketing", vis: "lock", when: "edited 3 weeks ago", owner: "acme-co" },
  { name: "Onboarding Kit", vis: "lock", when: "edited last month" },
];

function OpenExisting() {
  return (
    <ModalShell title="Open a project" sub="Pick one of your projects, or paste a link someone shared.">
      <div className="tabbar cp-tabs" role="tablist" aria-label="Open a project">
        <button type="button" className="tab" role="tab" aria-selected="true">Your projects</button>
        <button type="button" className="tab" role="tab" aria-selected="false">Paste a link</button>
      </div>

      <div className="cp-body cp-body--list">
        <input className="input cp-search" type="search" placeholder="Search your projects…" aria-label="Search your projects" />
        <div className="cp-repolist" role="group" aria-label="Your projects">
          {REPOS.map((r, i) => (
            <button type="button" key={r.name} className={"cp-repo" + (i === 0 ? " is-active" : "")} aria-current={i === 0 ? "true" : undefined}>
              <Icon name={r.vis} size={14} className="cp-repo-vis" />
              <span className="cp-repo-tx">
                <span className="cp-repo-name">{r.name}</span>
                <span className="cp-repo-meta">{r.owner ? `${r.owner} · ` : "octocat · "}{r.when}</span>
              </span>
              <Icon name="arrow" size={15} className="cp-repo-go" />
            </button>
          ))}
        </div>
      </div>

      <div className="cp-foot">
        <span className="cp-foot-note"><Icon name="link" size={13} /> Or paste a <b>github.com/…</b> link on the next tab</span>
        <span className="cp-spacer" />
        <button type="button" className="btn btn--ghost">Cancel</button>
        <button type="button" className="btn btn--primary"><Icon name="arrow" size={15} /> Open project</button>
      </div>
    </ModalShell>
  );
}

/* ─────────────────────────── C · Creating (set-up progress) ─────────────────── */
type Step = { label: string; sub: string; state: "done" | "active" | "todo" };
const STEPS: Step[] = [
  { label: "Created your project on GitHub", sub: "github.com/octocat/acme-rebrand · private", state: "done" },
  { label: "Setting up your copy", sub: "Downloading the project to your computer…", state: "active" },
  { label: "Opening in Maude", sub: "Your canvas will appear in a moment", state: "todo" },
];

function StepRow({ step }: { step: Step }) {
  return (
    <div className={"cp-step is-" + step.state}>
      <span className="cp-step-mark" aria-hidden="true">
        {step.state === "done" ? <Icon name="check" size={14} /> : step.state === "active" ? <Icon name="spinner" size={15} className="cp-spin" /> : <span className="cp-step-dot" />}
      </span>
      <span className="cp-step-tx"><span className="cp-step-label">{step.label}</span><span className="cp-step-sub">{step.sub}</span></span>
    </div>
  );
}

function Creating() {
  return (
    <div className="cp-modal" role="dialog" aria-modal="true" aria-label="Creating your project">
      <div className="cp-modal-card cp-modal-card--sm panel">
        <div className="cp-creating-hero">
          <Mark size={34} className="cp-creating-mark" />
          <h2>Setting up “Acme Rebrand”</h2>
          <p>This takes a few seconds — no need to do anything.</p>
        </div>
        <div className="cp-steps" role="status" aria-live="polite">
          {STEPS.map((s) => <StepRow key={s.label} step={s} />)}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── D · Share sheet ───────────────────────────────── */
type Person = { initials: string; name: string; login: string; role: string; hue: string; pending?: boolean };
const PEOPLE: Person[] = [
  { initials: "OC", name: "Octo Cat", login: "@octocat", role: "Owner", hue: "var(--presence-online)" },
  { initials: "AN", name: "Anna Novák", login: "@anovak", role: "Can edit", hue: "var(--accent)" },
  { initials: "RY", name: "@ryan-w", login: "invite sent", role: "Pending", hue: "var(--status-info)", pending: true },
];

function PersonRow({ p }: { p: Person }) {
  return (
    <div className={"cp-person" + (p.pending ? " is-pending" : "")}>
      <Avatar initials={p.initials} hue={p.hue} size={30} />
      <span className="cp-person-tx"><span className="cp-person-name">{p.name}</span><span className="cp-person-login">{p.login}</span></span>
      <span className={"chip cp-role" + (p.pending ? " cp-role--pending" : "")}>{p.role}</span>
    </div>
  );
}

function Share() {
  return (
    <ModalShell title="Share “Acme Rebrand”" sub="Invite teammates by their GitHub username — they'll get an email to open it in Maude.">
      <div className="cp-body">
        <div className="cp-invite">
          <span className="cp-invite-at" aria-hidden="true">@</span>
          <input className="input cp-invite-input" type="text" placeholder="github-username" aria-label="GitHub username to invite" defaultValue="anovak" />
          <button type="button" className="btn btn--primary cp-invite-btn"><Icon name="invite" size={15} /> Invite</button>
        </div>

        <div className="callout callout--success cp-invited">
          <span style={{ color: "var(--status-success)", flex: "0 0 auto" }}><Icon name="check" /></span>
          <span><b style={{ color: "var(--fg-0)" }}>Invited @anovak.</b> They'll get a GitHub email and show up below once they accept.</span>
        </div>

        <div className="cp-sect-label">People with access</div>
        <div className="cp-people">{PEOPLE.map((p) => <PersonRow key={p.login} p={p} />)}</div>
      </div>

      <div className="cp-foot cp-foot--share">
        <span className="cp-invite-link">
          <Icon name="link" size={14} />
          <span className="cp-invite-link-url">github.com/octocat/acme-rebrand/invitations</span>
        </span>
        <button type="button" className="btn btn--ghost"><Icon name="copy" size={14} /> Copy invite link</button>
        <span className="cp-spacer" />
        <button type="button" className="btn btn--primary">Done</button>
      </div>
    </ModalShell>
  );
}

/* ───────────────────────────── World wrapper ──────────────────────────────── */
function Board({ children }: { children: React.ReactNode }) {
  return <div className="maude" data-theme="dark" style={{ position: "absolute", inset: 0 }}>{children}</div>;
}

export default function CreateProject() {
  return (
    <DesignCanvas>
      <DCSection id="project" title="CreateProject — start, open, share" subtitle="MAUDE/GH · 4 artboards · create repo (private default) → clone → open · invite by username">
        <DCArtboard id="new-project" label="A · Create a new project" width={1360} height={900}>
          <Board><ShellFrame><NewProject /></ShellFrame></Board>
        </DCArtboard>
        <DCArtboard id="open-existing" label="B · Open an existing project" width={1360} height={900}>
          <Board><ShellFrame><OpenExisting /></ShellFrame></Board>
        </DCArtboard>
        <DCArtboard id="creating" label="C · Setting up your project" width={1360} height={900}>
          <Board><ShellFrame><Creating /></ShellFrame></Board>
        </DCArtboard>
        <DCArtboard id="share" label="D · Share — invite by GitHub username" width={1360} height={900}>
          <Board><ShellFrame><Share /></ShellFrame></Board>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
