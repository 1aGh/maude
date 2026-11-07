/**
 * @canvas      16 Team Server and Cloud Admin — the team server's admin and the Maude Cloud dashboard, redrawn for Maude 2
 * @ds          maude-v2
 * @platform    desktop
 * @kind        canvas
 * @stack       React 19 · TSX · Bun.build
 * @history     .design/_history/ui-v2-16_team_server_and_cloud_admin
 * @artboards   ts-overview | ts-people | ts-invitee | ts-settings |
 *              cl-account | cl-people | cl-operator
 * @brief       "udelej redesign hub admin cell ale i hub cloud.maude dashboard … zvani uzivatelu je celkem komplikovane
 *              a matouci. Musi se tam prihlasit, pak ja to musim potvrdit a pak stejne potrebuji vygenerovany token aby si
 *              napojili repo … V cloud maude dashboard bych zase rad videl vic statistik a taky moznost masaz members a
 *              projects a zakladat nove dle libosti jako admin" — 6–7 artboards; Cloud = account owner AND operator.
 *
 * Ground truth (apps/hub + apps/cloud, 2026-11-03, main @ edda61698):
 *   · Hub admin today (apps/hub/src/admin/*): Overview · Peers · People · Tokens · Canvases · Activity · Settings, signed in
 *     with HUB_SECRET. People = accounts (admin/member) + "Waiting for access" (OIDC pending) + invite by link. Tokens =
 *     ownerless peer tokens handed over as `maude design link <url> --token=…`. No role change, no account delete in UI.
 *   · The pain Michal hit on design.studyfi.com: under OIDC the join page's Google button drops the invite
 *     (studio-door.mjs → /auth/oidc/start), so every invited person lands in pending (oidc-routes.mjs:178), the admin
 *     approves in a prompt(), and desktop has no browser sign-in for a team server — so the admin mints a token by hand.
 *   · Proposed here (ts-invitee): the invite rides through Google sign-in and IS the approval; the app connects by a
 *     matching code confirmed in the browser (Cloud's device-auth.mjs + handoff codes, ported to the hub). Tokens stay —
 *     owned by a person, behind Settings › Advanced (ts-settings).
 *   · v2 hub pieces with no admin UI today, surfaced: access requests (routes-v2/access.mjs), backups (backup.mjs),
 *     Maude 2 conversion (v2-convert.mjs), saving to Git (workspace-agent.mjs), design-system grants (ds-grants.mjs).
 *   · Cloud: the customer dashboard (dashboard.mjs) shows project cards only; events.mjs / analytics.mjs already record
 *     project_opened by surface, invite_created/redeemed, exports, logins — never shown to the customer (cl-account).
 *     /projects/<id>/people has no resend/revoke, no owner transfer, no request queue (cl-people). The operator console
 *     (operator-pages.mjs) is read-only except reconcile; "create for anyone, no card" is Proposed (cl-operator).
 *
 * Words (CONTRACT §3, §6): a self-hosted hub is a "team server" and shows its own name — never "Maude Cloud". Roles in
 * words: Can edit · Can comment · Can view · Owner; on a team server Admin is the extra word for whoever runs it. Status is
 * always a word with a dot. No tokens, ports or commands in the default view — they live in Advanced.
 *
 * Layout: these are web pages, not the app — a browser frame, a page on --bg-0, one floating nav island (chrome floats;
 * no full-height sidebar). Cards on --bg-1. Tables lifted from preview/components-tables (header on bg-3, no rules, the
 * row's one action). Charts: neutral bars, today in azure. The operator console carries an Operator tag in the nav so "the whole
 * service" never reads as "my account" (a nested dark scope loses to the studio host's theme rule). All pieces local with prefix `ad-`; chrome from ./_kit.
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./16 Team Server and Cloud Admin.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import type { CSSProperties, ReactNode } from "react";
import { Avatar, Icon, Kbd, Mark, Note, Stage, StatusWord, Thumb } from "./_kit";
import type { Art, Tone } from "./_kit";

const W = 1440;
const H = 980;

/* ═══ Browser + page shell ═══════════════════════════════════════════════════════════════════ */
function Browser({ host, path = "", children }: { host: string; path?: string; children: ReactNode }) {
  return (
    <div className="ad-br" role="group" aria-label={`Browser — ${host}${path}`}>
      <div className="ad-br-bar">
        <span className="k-lights"><i /><i /><i /></span>
        <span className="ad-br-url"><Icon name="lock" size={11} /><span><b>{host}</b>{path}</span></span>
        <span className="ad-br-sp" />
      </div>
      <div className="ad-br-page">{children}</div>
    </div>
  );
}

type NavTab = { label: string; count?: number; quiet?: boolean };
function Nav({ name, place, tabs, current, me, tag, op = false, ini, tone }: { ini?: string; tone?: Tone; op?: boolean; name: string; place: string; tabs: NavTab[]; current: string; me: string; tag?: ReactNode }) {
  return (
    <nav className={`island ad-nav${op ? " ad-nav--op" : ""}`} aria-label={name}>
      <span className="ad-nav-id"><Mark size={24} />{name}<small>{place}</small>{tag}</span>
      <span className="ad-nav-tabs">
        {tabs.map((t) => (
          <span key={t.label} className="ad-nav-tab" aria-current={t.label === current ? "page" : undefined}>
            {t.label}{t.count ? <span className={`ad-count${t.quiet ? " ad-count--quiet" : ""}`}>{t.count}</span> : null}
          </span>
        ))}
      </span>
      <span className="ad-nav-sp" />
      <span className="ad-nav-search"><Icon name="search" size={14} />Search<Kbd>⌘K</Kbd></span>
      <span className="ad-nav-me">{ini ? <Avatar ini={ini} tone={tone ?? "grey"} /> : <Avatar who="you" />}{me}</span>
    </nav>
  );
}

const TS_TABS: NavTab[] = [{ label: "Overview" }, { label: "People", count: 2 }, { label: "Projects" }, { label: "Settings" }];
const TS = { name: "StudyFi Design", place: "Team server", me: "Michal · Admin" };

function Stat({ label, icon, value, unit, foot, spark }: { label: string; icon: string; value: string; unit?: string; foot?: ReactNode; spark?: number[] }) {
  return (
    <div className="ad-card ad-stat">
      <span className="ad-stat-go"><Icon name="chevron-r" size={14} /></span>
      <span className="ad-stat-l"><Icon name={icon} size={14} />{label}</span>
      <span className="ad-stat-v">{value}{unit ? <small>{unit}</small> : null}</span>
      {spark ? <span className="ad-spark">{spark.map((v, i) => <i key={i} style={{ height: `${v}%` }} />)}</span> : null}
      {foot ? <span className="ad-stat-f">{foot}</span> : null}
    </div>
  );
}

function Who({ name, email, tone, ini }: { name: string; email?: string; tone: Tone; ini?: string }) {
  return (
    <span className="ad-who">
      <Avatar ini={ini ?? name.slice(0, 1)} tone={tone} size="lg" />
      <span className="ad-who-t"><strong>{name}</strong>{email ? <span>{email}</span> : null}</span>
    </span>
  );
}

function Role({ children }: { children: ReactNode }) {
  return <span className="ad-role">{children}<Icon name="chevron" size={12} /></span>;
}

function Ev({ icon, children, when, who }: { icon?: string; children: ReactNode; when: string; who?: { ini: string; tone: Tone } }) {
  return (
    <div className="ad-ev">
      {who ? <Avatar ini={who.ini} tone={who.tone} /> : <span className="ad-ev-ic"><Icon name={icon ?? "pulse"} size={13} /></span>}
      <span className="ad-ev-t">{children}</span>
      <time>{when}</time>
    </div>
  );
}

function Bars({ data, labels, summary }: { data: number[]; labels: [string, string, string]; summary: string }) {
  return (
    <>
      <div className="ad-bars" role="img" aria-label={summary}>{data.map((v, i) => <i key={i} style={{ height: "100%" }}><b style={{ height: `${v}%` }} /></i>)}</div>
      <div className="ad-bars-x"><span>{labels[0]}</span><span>{labels[1]}</span><span>{labels[2]}</span></div>
    </>
  );
}

/* ═══ Team server pieces ════════════════════════════════════════════════════════════════════ */
type PersonRow = { name: string; email: string; tone: Tone; role: string; state: ReactNode; seen: string; macs: string; action: ReactNode; cls?: string; ini?: string };
const PEOPLE_ROWS: PersonRow[] = [
  { name: "Lukáš Dvořák", email: "lukas.dvorak@studyfi.com", tone: "grey", role: "Can edit", state: <span className="chip ad-chip ad-chip--warn"><Icon name="people" size={12} />Asks to join</span>, seen: "12 min ago", macs: "—", action: <><span className="btn btn--sm">Dismiss</span><span className="btn btn--sm btn--primary">Let in</span></>, cls: "is-hl" },
  { name: "Petra Svobodová", email: "petra@studyfi.com", tone: "lilac", role: "Can edit", state: <StatusWord state="busy">Invited · 5 days left</StatusWord>, seen: "Not yet", macs: "—", action: <><span className="btn btn--ghost btn--sm">Copy link</span><span className="btn btn--sm">Send again</span></> },
  { name: "Tereza Nováková", email: "tereza@studyfi.com", tone: "sky", role: "Admin", state: <StatusWord state="ok">Online</StatusWord>, seen: "Now", macs: "2 Macs", action: <span className="btn btn--ghost btn--sm"><Icon name="more" size={14} /></span> },
  { name: "Jonas Berger", email: "jonas@studyfi.com", tone: "green", role: "Can edit", state: <StatusWord state="ok">Online</StatusWord>, seen: "Now", macs: "1 Mac", action: <span className="btn btn--ghost btn--sm"><Icon name="more" size={14} /></span> },
  { name: "Anna Králová", email: "anna.kralova@studyfi.com", tone: "yellow", ini: "A", role: "Can comment", state: <StatusWord state="off">Away</StatusWord>, seen: "Yesterday, 17:40", macs: "1 Mac", action: <span className="btn btn--ghost btn--sm"><Icon name="more" size={14} /></span> },
  { name: "Ondřej Malý", email: "ondrej@studyfi.com", tone: "green", role: "Can edit", state: <StatusWord state="off">Away</StatusWord>, seen: "28 Oct", macs: "1 Mac", action: <span className="btn btn--ghost btn--sm"><Icon name="more" size={14} /></span> },
  { name: "Filip Horák", email: "filip@studyfi.com", tone: "grey", role: "Can edit", state: <StatusWord state="off">Turned off</StatusWord>, seen: "2 Sep", macs: "—", action: <span className="btn btn--ghost btn--sm">Turn back on</span>, cls: "is-dim" },
];

function PeopleTable({ rows, picked }: { rows: PersonRow[]; picked?: string }) {
  return (
    <table className="ad-table">
      <thead>
        <tr><th scope="col">Person</th><th scope="col">Can</th><th scope="col">Status</th><th scope="col">Last here</th><th scope="col"><span className="ad-sr">Action</span></th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.email} className={`${r.cls ?? ""}${picked === r.email ? " is-picked" : ""}`}>
            <td><Who name={r.name} email={r.email} tone={r.tone} ini={r.ini} /></td>
            <td><Role>{r.role}</Role></td>
            <td>{r.state}</td>
            <td className="ad-quiet">{r.seen}</td>
            <td><span className="ad-row-a">{r.action}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PickOpt({ on, title, sub }: { on?: boolean; title: string; sub: string }) {
  return (
    <span className="ad-pick-o" role="radio" aria-checked={on ? "true" : "false"}>
      <span className="ad-radio" />
      <span><strong>{title}</strong><span>{sub}</span></span>
    </span>
  );
}

/* ═══ Cloud pieces ══════════════════════════════════════════════════════════════════════════ */
const CL_TABS: NavTab[] = [{ label: "Overview" }, { label: "Projects" }, { label: "People", count: 3 }, { label: "Settings" }];
const CL = { name: "Maude Cloud", place: "StudyFi", me: "Michal · Owner" };

type Proj = { name: string; art: Art; people: { ini: string; tone: Tone }[]; canvases: number; edits: string; state: ReactNode };
const PROJECTS: Proj[] = [
  { name: "Alligators brand", art: "gator-poster", people: [{ ini: "T", tone: "sky" }, { ini: "J", tone: "green" }, { ini: "P", tone: "lilac" }], canvases: 93, edits: "412 edits this week", state: <StatusWord state="ok">3 here now</StatusWord> },
  { name: "StudyFi app", art: "mobile", people: [{ ini: "M", tone: "yellow" }, { ini: "A", tone: "yellow" }], canvases: 61, edits: "188 edits this week", state: <StatusWord state="ok">1 here now</StatusWord> },
  { name: "Marketing site", art: "home", people: [{ ini: "O", tone: "green" }], canvases: 24, edits: "36 edits this week", state: <StatusWord state="off">Quiet since Fri</StatusWord> },
  { name: "Pricing tests", art: "price", people: [{ ini: "J", tone: "green" }, { ini: "M", tone: "yellow" }], canvases: 12, edits: "9 edits this week", state: <StatusWord state="off">Quiet since Mon</StatusWord> },
  { name: "Onboarding", art: "onb", people: [{ ini: "T", tone: "sky" }], canvases: 18, edits: "71 edits this week", state: <StatusWord state="ok">1 here now</StatusWord> },
];

function Faces({ people }: { people: { ini: string; tone: Tone }[] }) {
  return <span className="ad-faces">{people.map((p, i) => <Avatar key={i} ini={p.ini} tone={p.tone} size="sm" />)}</span>;
}

function MRole({ r }: { r: string }) {
  const cls = r === "Owner" ? " ad-mrole--own" : r === "—" ? " ad-mrole--none" : "";
  return <span className={`ad-mrole${cls}`}>{r === "—" ? "No access" : r}</span>;
}

/* ═══ The canvas ═══════════════════════════════════════════════════════════════════════════ */
export default function TeamServerAndCloudAdmin() {
  return (
    <DesignCanvas>
      {/* ── 1 · Team server ──────────────────────────────────────────────────────────────── */}
      <DCSection id="team-server" title="Team server — StudyFi Design" subtitle="design.studyfi.com, run by StudyFi: is everything working, who's here, who's waiting — and an invite that needs no approval and no token">
        <DCArtboard id="ts-overview" label="1 · At a glance — working, who's here, what needs you" width={W} height={H} fixed>
          <Stage note={<Note n={1} title="Is it working, and does anything need me?">One line says the team server is healthy; four numbers open their list; the only red things are the ones you can act on. Ports, data folders and the admin key moved to Settings › Advanced.</Note>}>
            <Browser host="design.studyfi.com" path="/">
              <Nav {...TS} tabs={TS_TABS} current="Overview" />
              <div className="ad-main">
                <div className="ad-head">
                  <div>
                    <h1 className="ad-h1">Good evening, Michal. Everything is running.</h1>
                    <p className="ad-sub">StudyFi Design runs Maude 2 · backed up at 03:00 · saved to Git 4 minutes ago</p>
                  </div>
                  <div className="ad-head-a"><span className="btn"><Icon name="link" size={14} />Copy invite link</span><span className="btn btn--primary"><Icon name="plus" size={14} />Invite people</span></div>
                </div>

                {/* The signature of this page: what needs you is the biggest thing on it, and it acts in place. */}
                <section className="ad-hero" aria-labelledby="ts-needs">
                  <h2 id="ts-needs" className="ad-hero-h"><span className="ad-hero-n">2</span>things need you</h2>
                  <div className="ad-hero-rows">
                    <div className="ad-need">
                      <Avatar ini="L" tone="grey" size="lg" />
                      <span className="ad-need-t"><strong>Lukáš Dvořák asks to join</strong><span>Signed in with Google as lukas.dvorak@studyfi.com — nobody has invited Lukáš yet</span></span>
                      <span className="ad-need-a"><span className="btn btn--sm">Dismiss</span><span className="btn btn--sm btn--primary">Let Lukáš in · Can edit</span></span>
                    </div>
                    <div className="ad-need">
                      <Avatar ini="P" tone="lilac" size="lg" />
                      <span className="ad-need-t"><strong>Petra's invite hasn't been opened</strong><span>Sent 2 days ago · the link works for 5 more days</span></span>
                      <span className="ad-need-a"><span className="btn btn--sm">Send again</span></span>
                    </div>
                  </div>
                </section>

                <div className="ad-stats" style={{ "--n": 4 } as CSSProperties}>
                  <Stat label="People" icon="people" value="14" foot={<><span>2 invited · 1 asks to join</span></>} />
                  <Stat label="Here now" icon="pulse" value="3" foot={<span>Tereza, Jonas, you</span>} />
                  <Stat label="Projects" icon="folder" value="2" unit="186 canvases" foot={<span>+7 canvases this week</span>} />
                  <Stat label="Changes this week" icon="history" value="1 240" spark={[30, 42, 38, 55, 61, 20, 12, 48, 66, 52, 70, 58, 74, 81]} />
                </div>

                <div className="ad-cols ad-cols--2-1">
                  <div className="ad-stack">
                    <div className="ad-card">
                      <h2 className="ad-card-h">Health <span className="ad-link">Details in Settings</span></h2>
                      <div className="ad-health">
                        <span className="ad-hl"><span>Version</span><strong>Maude 2.0.0</strong><StatusWord state="ok">Up to date</StatusWord></span>
                        <span className="ad-hl"><span>Backups</span><strong>Today, 03:00</strong><StatusWord state="ok">7 kept</StatusWord></span>
                        <span className="ad-hl"><span>Saving to Git</span><strong>4 min ago</strong><StatusWord state="ok">studyfi/design</StatusWord></span>
                        <span className="ad-hl"><span>Moved to Maude 2</span><strong>3 Nov, 09:12</strong><StatusWord state="ok">2 of 2 projects</StatusWord></span>
                      </div>
                    </div>
                  </div>
                  <div className="ad-card">
                    <h2 className="ad-card-h">What happened <span className="ad-link">All activity</span></h2>
                    <div className="ad-feed">
                      <Ev who={{ ini: "T", tone: "sky" }} when="2 min"><strong>Tereza</strong> <span>changed Onboarding v3</span></Ev>
                      <Ev who={{ ini: "J", tone: "green" }} when="9 min"><strong>Jonas</strong> <span>exported Paywall · 4 images</span></Ev>
                      <Ev icon="people" when="12 min"><strong>Lukáš Dvořák</strong> <span>signed in and asks to join</span></Ev>
                      <Ev icon="sync" when="14 min"><span>Saved to Git — 12 changes</span></Ev>
                      <Ev who={{ ini: "A", tone: "yellow" }} when="1 h"><strong>Anna</strong> <span>joined from your invite</span></Ev>
                      <Ev icon="server" when="03:00"><span>Backup made · 182 MB</span></Ev>
                      <Ev who={{ ini: "M", tone: "yellow" }} when="Yesterday"><strong>You</strong> <span>invited Petra and Anna</span></Ev>
                    </div>
                  </div>
                </div>
              </div>
            </Browser>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ts-people" label="2 · People — one list, and Invite that is the approval" width={W} height={H} fixed>
          <Stage note={<Note n={2} title="One list, one Invite, no tokens.">Everyone is in one table, and their status says where they are: invited, asking to join, here, turned off. An invite already says what they can do, so whoever opens it is in. The domain rule lets colleagues in without you.</Note>}>
            <Browser host="design.studyfi.com" path="/people">
              <Nav {...TS} tabs={TS_TABS} current="People" />
              <div className="ad-main">
                <div className="ad-head">
                  <div><h1 className="ad-h1">People</h1><p className="ad-sub">14 people · who can come in is set in Settings › Who can join</p></div>
                  <div className="ad-head-a"><span className="btn btn--primary"><Icon name="plus" size={14} />Invite people</span></div>
                </div>
                <div className="ad-card ad-people-card">
                  <div className="ad-tabs">
                    <span className="ad-tab" aria-pressed="true">Everyone <span className="ad-count">14</span></span>
                    <span className="ad-tab">Asks to join <span className="ad-count ad-count--hot">1</span></span>
                    <span className="ad-tab">Invited <span className="ad-count">1</span></span>
                    <span className="ad-tab">Turned off <span className="ad-count">1</span></span>
                    <span className="ad-tabs-sp" />
                    <span className="ad-filter"><Icon name="search" size={13} />Find someone</span>
                  </div>
                  <PeopleTable rows={PEOPLE_ROWS.slice(0, 6)} />
                </div>
              </div>
              <div className="ad-veil" />
              {/* The invite sheet: emails, then what they can do, then where — and the promise in words. */}
              <section className="ad-sheet" style={{ right: 28, top: 108, width: 420 }} aria-label="Invite people">
                <div><h2 className="ad-sheet-t">Invite people to StudyFi Design</h2></div>
                <p className="ad-sheet-s">They sign in with their StudyFi Google account — the invite lets them straight in.</p>
                <span className="field">
                  <span className="field-label">Emails</span>
                  <span className="ad-emails"><span className="chip">marek@studyfi.com</span><span className="chip">eva.pokorna@studyfi.com</span><i className="ad-caret" /></span>
                </span>
                <span className="field">
                  <span className="field-label">They can</span>
                  <span className="ad-pick" role="radiogroup">
                    <PickOpt on title="Can edit" sub="Change canvases, draw, use AI, move things to the trash" />
                    <PickOpt title="Can comment" sub="Look, comment and download" />
                    <PickOpt title="Admin" sub="Also invites people and runs this team server · asks you to confirm" />
                  </span>
                </span>
                <span className="field">
                  <span className="field-label">In</span>
                  <span className="ad-sel">All projects — now and new ones<Icon name="chevron" size={12} /></span>
                </span>
                <div className="ad-promise"><Icon name="check" size={14} /><span>No approving and no token afterwards. They open the email, sign in, and the Maude app connects with one click.</span></div>
                <div className="ad-sheet-a">
                  <span className="btn btn--ghost"><Icon name="link" size={14} />Copy a one-time link</span>
                  <span className="ad-sp" />
                  <span className="btn">Cancel</span>
                  <span className="btn btn--primary">Send 2 invites</span>
                </div>
              </section>
            </Browser>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ts-invitee" label="3 · What Marek sees — three screens, no waiting, no token" width={W} height={H} fixed>
          <Stage note={<Note n={3} title="Proposed: the invite rides through Google sign-in.">Today Google sign-in forgets the invite, so everyone waits for approval and then for a token. Now the invite is the approval, and the app links itself: the same code shows in the app and on the page, and one click confirms it.</Note>}>
            <div className="ds k-v2 ad-closeup" data-theme="light">
              <div className="ad-story">
                <div className="ad-story-h">
                  <div><h1 className="ad-h1">From the email to working in the app</h1><p className="ad-sub">Marek, invited a minute ago as Can edit. Marek never sees a token, a command or a waiting room.</p></div>
                </div>
                <div className="ad-steps">
                  <div className="ad-step">
                    <span className="ad-step-l"><span className="ad-step-n">1</span>Open the invite</span>
                    <Browser host="design.studyfi.com" path="/join/…">
                      <div className="ad-web">
                        <span className="ad-web-who"><Mark size={48} /><Avatar who="you" size="lg" /></span>
                        <h2 className="ad-web-t">Michal invited you to StudyFi Design</h2>
                        <p className="ad-web-s">The StudyFi team's designs · 14 people</p>
                        <span className="ad-web-role"><Icon name="edit" size={12} />You can edit</span>
                        <span className="btn btn--primary btn--lg"><span className="ad-g">G</span>Continue with Google</span>
                        <p className="ad-web-fine">Use marek@studyfi.com — that's who the invite is for. Signed in as someone else? The page says so and offers <u>Use another account</u>.</p>
                      </div>
                    </Browser>
                    <p className="ad-step-cap">The page says who invited Marek, to what, and what Marek can do. Google is the only button.</p>
                  </div>
                  <div className="ad-step">
                    <span className="ad-step-l"><span className="ad-step-n">2</span>Marek is in</span>
                    <Browser host="design.studyfi.com" path="/welcome">
                      <div className="ad-web">
                        <span className="ad-done"><Icon name="check" size={22} /></span>
                        <h2 className="ad-web-t">You're in, Marek.</h2>
                        <p className="ad-web-s">StudyFi app and Marketing site are ready for you.</p>
                        <span className="btn btn--primary btn--lg"><Mark size={16} tile="var(--accent-fg)" star="var(--accent)" />Open in Maude</span>
                        <span className="btn btn--ghost">Don't have it? Download Maude for Mac</span>
                        <span className="ad-web-code"><span>Maude will ask you to check this code</span><b>K7F-Q2M</b></span>
                        <p className="ad-web-fine">Just looking? <u>Open in the browser</u></p>
                      </div>
                    </Browser>
                    <p className="ad-step-cap">The invite was the approval: no "waiting for access". The page already shows the code the app will ask Marek to check.</p>
                  </div>
                  <div className="ad-step">
                    <span className="ad-step-l"><span className="ad-step-n">3</span>The app connects — check the code</span>
                    <div className="ad-br" style={{ height: 470 }}>
                      <div className="ad-br-bar"><span className="k-lights"><i /><i /><i /></span><span className="ad-br-url" style={{ background: "transparent" }}><b>Maude</b></span><span className="ad-br-sp" /></div>
                      <div className="ad-br-page">
                        <div className="ad-app">
                          <section className="ad-sheet">
                            <Mark size={48} />
                            <h2 className="ad-sheet-t">Connect StudyFi Design?</h2>
                            <p className="ad-sheet-s" style={{ margin: 0 }}>The browser shows the same code. If it matches, connect.</p>
                            <span className="ad-code-band"><span className="ad-code" aria-label="Code K7F Q2M"><b>K</b><b>7</b><b>F</b><i /><b>Q</b><b>2</b><b>M</b></span></span>
                            <span className="btn btn--primary">Connect</span>
                            <span className="btn btn--ghost btn--sm">It doesn't match</span>
                          </section>
                        </div>
                      </div>
                    </div>
                    <p className="ad-step-cap">It doesn't match → nothing connects and the page offers Try again. A match: Home shows both projects and the Mac joins Marek's Macs.</p>
                  </div>
                </div>
                <div className="ad-compare">
                  <div className="ad-card ad-flow ad-flow--before">
                    <span className="ad-flow-l">Today on design.studyfi.com — 5 steps, 2 of them yours</span>
                    <span className="chip">Sign in</span><Icon name="chevron-r" size={12} />
                    <span className="chip ad-wait">Waiting for access</span><Icon name="chevron-r" size={12} />
                    <span className="chip ad-wait">You approve</span><Icon name="chevron-r" size={12} />
                    <span className="chip ad-wait">You make a token</span><Icon name="chevron-r" size={12} />
                    <span className="chip">Paste a command</span>
                  </div>
                  <div className="ad-card ad-flow">
                    <span className="ad-flow-l">With Maude 2 — 3 steps, all Marek's</span>
                    <span className="chip chip--accent">Open the invite</span><Icon name="chevron-r" size={12} />
                    <span className="chip chip--accent">Continue with Google</span><Icon name="chevron-r" size={12} />
                    <span className="chip chip--accent">Open in Maude · Connect</span>
                  </div>
                </div>
              </div>
            </div>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ts-settings" label="4 · Settings — who can join, backups, Git, and Advanced" width={W} height={H} fixed>
          <Stage note={<Note n={4} title="Nothing deleted, only folded.">Every switch the old admin had is still here. Join rules, backups and Git come first, each with a status word and one action. Tokens for scripts, connected sessions and the admin key wait in Advanced — and a token now belongs to a person.</Note>}>
            <Browser host="design.studyfi.com" path="/settings">
              <Nav {...TS} tabs={TS_TABS} current="Settings" />
              <div className="ad-main">
                <div className="ad-head"><div><h1 className="ad-h1">Settings</h1><p className="ad-sub">StudyFi Design · design.studyfi.com</p></div></div>
                <div className="ad-set">
                  <div className="ad-card">
                    <span className="ad-set-h"><Icon name="people" size={16} />Who can join<StatusWord state="ok">Google · studyfi.com</StatusWord></span>
                    <span className="ad-pick" role="radiogroup">
                      <PickOpt title="Only people you invite" sub="Anyone else who signs in is turned away" />
                      <PickOpt on title="Colleagues ask, you let them in" sub="Anyone @studyfi.com can ask; you see it under Needs you" />
                      <PickOpt title="Colleagues come straight in" sub="Anyone @studyfi.com joins as Can comment" />
                    </span>
                  </div>
                  <div className="ad-card">
                    <span className="ad-set-h"><Icon name="server" size={16} />Backups<StatusWord state="ok">Today, 03:00</StatusWord></span>
                    <dl className="ad-kv">
                      <dt>Kept</dt><dd>7 daily · 4 weekly</dd>
                      <dt>Where</dt><dd>S3 · studyfi-design-backups</dd>
                      <dt>Restore check</dt><dd><StatusWord state="ok">Passed on Sunday</StatusWord></dd>
                    </dl>
                    <span className="ad-head-a"><span className="btn btn--sm">Back up now</span><span className="btn btn--ghost btn--sm">See all backups</span></span>
                  </div>
                  <div className="ad-card">
                    <span className="ad-set-h"><Icon name="sync" size={16} />Saving to Git<StatusWord state="ok">4 min ago</StatusWord></span>
                    <dl className="ad-kv">
                      <dt>Repository</dt><dd>github.com/studyfi/design</dd>
                      <dt>Last save</dt><dd>12 changes by Tereza and Jonas</dd>
                    </dl>
                    <span className="ad-head-a"><span className="btn btn--sm">Save now</span><span className="btn btn--ghost btn--sm">Change repository</span></span>
                  </div>
                  <div className="ad-card">
                    <span className="ad-set-h"><Icon name="done" size={16} />Maude 2<StatusWord state="ok">Up to date</StatusWord></span>
                    <dl className="ad-kv">
                      <dt>Version</dt><dd>2.0.0 · moved to Maude 2 on 3 Nov</dd>
                      <dt>Projects</dt><dd>2 of 2 moved · a copy of the old files is in the backup</dd>
                    </dl>
                    <span className="ad-head-a"><span className="btn btn--ghost btn--sm">See the report</span></span>
                  </div>
                  <div className="ad-card ad-adv">
                    <span className="k-adv-btn" style={{ padding: 0 }}><Icon name="chevron" size={12} />Advanced<span className="ad-sub" style={{ margin: 0 }}>— for scripts and whoever runs the server</span></span>
                    <div className="ad-adv-b">
                      <div>
                        <h4>Tokens for scripts and CI</h4>
                        <div className="ad-adv-row"><span>Figma import bot <span className="ad-quiet">· Tereza's</span></span><span className="ad-quiet">used today</span></div>
                        <div className="ad-adv-row"><span>Render on CI <span className="ad-quiet">· yours</span></span><span className="ad-quiet">used 2 days ago</span></div>
                        <div className="ad-adv-row"><span className="ad-link">+ New token</span><span className="ad-quiet">belongs to you</span></div>
                      </div>
                      <div>
                        <h4>Connected right now</h4>
                        <div className="ad-adv-row"><span>Tereza · Onboarding v3</span><span className="btn btn--ghost btn--sm">Disconnect</span></div>
                        <div className="ad-adv-row"><span>Jonas · Paywall</span><span className="btn btn--ghost btn--sm">Disconnect</span></div>
                        <div className="ad-adv-row"><span className="ad-mono">https · port 8443 · /var/lib/maude-hub</span></div>
                      </div>
                      <div>
                        <h4>Admin key and sign-in</h4>
                        <div className="ad-adv-row"><span>Google sign-in</span><StatusWord state="ok">Connected</StatusWord></div>
                        <div className="ad-adv-row"><span>Admin key for the command line</span><span className="btn btn--sm">Change key</span></div>
                        <div className="ad-adv-row"><span>Design-system links</span><span className="ad-quiet">2 projects read StudyFi v3</span></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Browser>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 2 · Maude Cloud ──────────────────────────────────────────────────────────────── */}
      <DCSection id="cloud" title="Maude Cloud — your account, and the whole service" subtitle="cloud.maude.sh for the owner of an account (how the projects are used, people across them, make new ones) and for the operator (every account, make anything for anyone)">
        <DCArtboard id="cl-account" label="5 · Your account — how your projects are used" width={W} height={H} fixed>
          <Stage note={<Note n={5} title="Numbers you already have, finally shown.">Opens by surface, edits, exports and invites are recorded today; the owner never saw them. Each number opens its list. New project is on the page, not behind checkout.</Note>}>
            <Browser host="cloud.maude.sh" path="/">
              <Nav {...CL} tabs={CL_TABS} current="Overview" />
              <div className="ad-main">
                <div className="ad-head">
                  <div><h1 className="ad-h1">StudyFi on Maude Cloud</h1><p className="ad-sub">Team plan · 12 of 20 seats · 5 projects</p></div>
                  <div className="ad-head-a"><span className="btn"><Icon name="people" size={14} />Invite people</span><span className="btn btn--primary"><Icon name="plus" size={14} />New project</span></div>
                </div>
                <div className="ad-stats" style={{ "--n": 5 } as CSSProperties}>
                  <Stat label="Active this week" icon="people" value="9" unit="of 12" foot={<span className="ad-up">+2 vs last week</span>} />
                  <Stat label="Edits" icon="edit" value="716" spark={[40, 52, 47, 60, 35, 18, 22, 58, 63, 70, 66, 49, 72, 80]} />
                  <Stat label="Canvases" icon="file" value="208" foot={<span>+11 this week</span>} />
                  <Stat label="Exports" icon="export" value="48" foot={<span>31 images · 12 PDF · 5 video</span>} />
                  <Stat label="Storage" icon="server" value="3.2" unit="of 50 GB" foot={<span>Most in Alligators brand</span>} />
                </div>
                <div className="ad-cols ad-cols--2-1">
                  <div className="ad-card">
                    <h2 className="ad-card-h">Edits per day <span className="ad-legend"><span><i />Earlier days</span><span><i className="ad-lg-a" />Today</span></span></h2>
                    <Bars data={[30, 41, 38, 52, 22, 12, 15, 44, 57, 61, 49, 35, 16, 20, 58, 66, 72, 54, 47, 18, 14, 62, 70, 64, 76, 59, 24, 21, 68, 81]} labels={["5 Oct", "19 Oct", "Today"]} summary="Edits per day over 30 days: lowest 12 on weekends, highest 81 today; about 45 on a typical weekday." />
                  </div>
                  <div className="ad-card">
                    <h2 className="ad-card-h">Where people open their work</h2>
                    <div className="ad-feed">
                      <div className="ad-need" style={{ boxShadow: "none" }}><Icon name="laptop" /><span className="ad-need-t"><strong>Mac app</strong><span>1 104 opens · 82 %</span></span></div>
                      <div className="ad-need"><Icon name="web" /><span className="ad-need-t"><strong>Browser</strong><span>214 opens · 16 % — mostly Can view links</span></span></div>
                      <div className="ad-need"><Icon name="people" /><span className="ad-need-t"><strong>Invites</strong><span>7 sent · 5 joined · 2 waiting</span></span></div>
                    </div>
                  </div>
                </div>
                <div className="ad-card" style={{ marginTop: "var(--space-4)" }}>
                  <h2 className="ad-card-h">Projects <span className="ad-link">All 5</span></h2>
                  <div className="ad-projects" style={{ gridTemplateColumns: "repeat(6, 1fr)" }}>
                    {PROJECTS.map((p) => (
                      <div key={p.name} className="ad-proj">
                        <Thumb art={p.art} className="ad-thumb" />
                        <span className="ad-proj-b"><strong>{p.name}</strong><span className="ad-proj-m"><span>{p.canvases} canvases</span><Faces people={p.people} /></span>{p.state}</span>
                      </div>
                    ))}
                    <span className="ad-proj ad-proj--new"><span className="ad-plus"><Icon name="plus" size={16} /></span>New project</span>
                  </div>
                </div>
              </div>
            </Browser>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cl-people" label="6 · People across projects — roles, requests, many at once" width={W} height={H} fixed>
          <Stage note={<Note n={6} title="Everyone, every project, one table.">A row is a person, a column is a project, a cell is what they can do there — click it to change. Requests and unopened invites sit on top. Select several to change or remove together; the row menu can make someone the owner.</Note>}>
            <Browser host="cloud.maude.sh" path="/people">
              <Nav {...CL} tabs={CL_TABS} current="People" />
              <div className="ad-main">
                <div className="ad-head">
                  <div><h1 className="ad-h1">People</h1><p className="ad-sub">12 people in 5 projects · 2 ask to edit · 2 invites not opened</p></div>
                  <div className="ad-head-a"><span className="btn btn--primary"><Icon name="plus" size={14} />Invite people</span></div>
                </div>
                <div className="ad-cols ad-cols--1-1" style={{ marginBottom: "var(--space-4)" }}>
                  <div className="ad-card">
                    <h2 className="ad-card-h">Asks to edit <small>2</small></h2>
                    <div className="ad-need"><Avatar ini="V" tone="grey" size="lg" /><span className="ad-need-t"><strong>Vojta · Combine-kampan</strong><span>Can view · "chci upravit text na plakátu"</span></span><span className="ad-need-a"><span className="btn btn--sm">Not now</span><span className="btn btn--sm btn--primary">Allow editing</span></span></div>
                    <div className="ad-need"><Avatar ini="A" tone="yellow" size="lg" /><span className="ad-need-t"><strong>Anna · Marketing site</strong><span>Can view · asked yesterday</span></span><span className="ad-need-a"><span className="btn btn--sm">Not now</span><span className="btn btn--sm btn--primary">Allow editing</span></span></div>
                  </div>
                  <div className="ad-card">
                    <h2 className="ad-card-h">Invites not opened <small>2</small></h2>
                    <div className="ad-need"><Avatar ini="E" tone="grey" size="lg" /><span className="ad-need-t"><strong>eva.pokorna@studyfi.com · StudyFi app</strong><span>Can edit · sent 3 days ago, works 4 more</span></span><span className="ad-need-a"><span className="btn btn--ghost btn--sm">Cancel invite</span><span className="btn btn--sm">Send again</span></span></div>
                    <div className="ad-need"><Avatar ini="R" tone="grey" size="lg" /><span className="ad-need-t"><strong>radek@alligators.cz · Alligators brand</strong><span>Can comment · sent 6 days ago, works 1 more</span></span><span className="ad-need-a"><span className="btn btn--ghost btn--sm">Cancel invite</span><span className="btn btn--sm">Send again</span></span></div>
                  </div>
                </div>
                <div className="ad-card">
                  <div className="ad-tabs">
                    <span className="ad-tab" aria-pressed="true">Everyone <span className="ad-count">12</span></span>
                    <span className="ad-tab">Owners <span className="ad-count">2</span></span>
                    <span className="ad-tab">Not here in 30 days <span className="ad-count">3</span></span>
                    <span className="ad-tabs-sp" /><span className="ad-filter"><Icon name="search" size={13} />Find someone</span>
                  </div>
                  <table className="ad-table ad-matrix">
                    <thead><tr><th scope="col">Person</th><th scope="col">Alligators brand</th><th scope="col">StudyFi app</th><th scope="col">Marketing site</th><th scope="col">Pricing tests</th><th scope="col">Last here</th><th scope="col"><span className="ad-sr">Action</span></th></tr></thead>
                    <tbody>
                      {([
                        ["Tereza Nováková", "tereza@studyfi.com", "sky", ["Owner", "Can edit", "Can edit", "—"], "Now", true],
                        ["Jonas Berger", "jonas@studyfi.com", "green", ["Can edit", "Can comment", "—", "Can edit"], "Now", true],
                        ["Anna Králová", "anna.kralova@studyfi.com", "yellow", ["—", "Can edit", "Can view", "—"], "Yesterday", false],
                        ["Ondřej Malý", "ondrej@studyfi.com", "green", ["Can comment", "—", "Owner", "—"], "28 Oct", true],
                        ["Vojta Černý", "vojta@alligators.cz", "grey", ["Can view", "—", "—", "—"], "2 Oct", false],
                      ] as [string, string, Tone, string[], string, boolean][]).map(([n, e, t, roles, seen, pick]) => (
                        <tr key={e} className={pick ? "is-picked" : ""}>
                          <td><span className="ad-chk" data-on={pick ? "true" : "false"} /><Who name={n} email={e} tone={t} /></td>
                          {roles.map((r, i) => <td key={i} className="ad-cell"><MRole r={r} /></td>)}
                          <td className="ad-quiet">{seen}</td>
                          <td><span className="btn btn--ghost btn--sm"><Icon name="more" size={14} /></span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="island ad-bulk"><strong>3 selected</strong><span className="btn btn--sm">Change role in…</span><span className="btn btn--sm">Add to project</span><span className="btn btn--sm k-btn-danger">Remove from account</span><span className="btn btn--ghost btn--sm"><Icon name="close" size={14} /></span></div>
            </Browser>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cl-operator" label="7 · Operator — the whole service, and making a project for anyone" width={W} height={H} fixed>
          <Stage note={<Note n={7} title="Proposed: you can make anything, for anyone.">An ink band says you see every account. New project for an account also makes the account, can be Promo from the first minute (storage and a reason in the same sheet), skips checkout and sends one invite — logged as yours.</Note>}>
            <Browser host="cloud.maude.sh" path="/operator">
              <div className="ad-op-band"><Icon name="server" size={13} />Operator — you are looking at every account on Maude Cloud. Changes here are logged as yours.</div>
              <Nav op name="Maude Cloud" place="Whole service" tag={<span className="ad-op-tag" style={{ marginLeft: "var(--space-2)" }}>Operator</span>} tabs={[{ label: "Overview" }, { label: "Accounts" }, { label: "Projects" }, { label: "Fleet", count: 1 }, { label: "Events" }]} current="Overview" me="Michal" />
              <div className="ad-main">
                <div className="ad-head">
                  <div><h1 className="ad-h1">The service today</h1><p className="ad-sub">3 Nov · cells on 1.10.0 until 2.0.0 is promoted</p></div>
                  <div className="ad-head-a"><span className="btn"><Icon name="people" size={14} />New account</span><span className="btn btn--primary"><Icon name="plus" size={14} />New project for an account</span></div>
                </div>
                <div className="ad-stats" style={{ "--n": 5 } as CSSProperties}>
                  <Stat label="Accounts" icon="people" value="412" foot={<span className="ad-up">+18 this week</span>} />
                  <Stat label="Projects running" icon="folder" value="268" unit="of 301" foot={<span>33 asleep</span>} />
                  <Stat label="People active" icon="pulse" value="1 940" unit="week" spark={[52, 58, 55, 61, 40, 31, 36, 63, 66, 70, 68, 54, 72, 77]} />
                  <Stat label="Monthly revenue" icon="export" value="€8 460" foot={<span>cost €1 120 · model ok</span>} />
                  <Stat label="Cold start" icon="clock" value="1.8" unit="s p95" foot={<span>canvas builds 94 % cached</span>} />
                </div>
                <div className="ad-cols ad-cols--2-1">
                  <div className="ad-card">
                    <div className="ad-tabs"><span className="ad-tab" aria-pressed="true">Newest accounts</span><span className="ad-tab">Most active</span><span className="ad-tab">Trial ends soon <span className="ad-count">6</span></span><span className="ad-tab">Promo <span className="ad-count">3</span></span><span className="ad-tabs-sp" /><span className="ad-filter"><Icon name="search" size={13} />Email, project or id</span></div>
                    <table className="ad-table">
                      <thead><tr><th scope="col">Account</th><th scope="col">Plan</th><th scope="col" className="ad-num">Projects</th><th scope="col" className="ad-num">People</th><th scope="col">Last here</th><th scope="col"><span className="ad-sr">Action</span></th></tr></thead>
                      <tbody>
                        <tr><td><Who name="Alligators Brno" email="tomas@alligators.cz" tone="green" /></td><td>Team</td><td className="ad-num">3</td><td className="ad-num">9</td><td className="ad-quiet">Now</td><td><span className="btn btn--ghost btn--sm">Open</span></td></tr>
                        <tr className="is-hl"><td><Who name="Ateliér Kolář" email="jan@kolar.studio" tone="lilac" /></td><td><StatusWord state="warn">Trial · 2 days left</StatusWord></td><td className="ad-num">1</td><td className="ad-num">2</td><td className="ad-quiet">1 h ago</td><td><span className="btn btn--ghost btn--sm">Open</span></td></tr>
                        <tr><td><Who name="StudyFi" email="team@studyfi.com" tone="yellow" ini="S" /></td><td><span className="ad-promo">Promo · Dedicated 250 GB</span></td><td className="ad-num">5</td><td className="ad-num">12</td><td className="ad-quiet">Now</td><td><span className="btn btn--ghost btn--sm">Open</span></td></tr>
                        <tr><td><Who name="Open studio Brno" email="hello@openstudio.cz" tone="sky" ini="O" /></td><td>Solo</td><td className="ad-num">2</td><td className="ad-num">1</td><td className="ad-quiet">Yesterday</td><td><span className="btn btn--ghost btn--sm">Open</span></td></tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="ad-card">
                    <h2 className="ad-card-h">Needs a look <small>2</small></h2>
                    <div className="ad-alarm"><StatusWord state="warn">Slow start</StatusWord><span>alligators — 6.2 s cold start</span><span>12 min</span></div>
                    <div className="ad-alarm"><StatusWord state="error">Stopped</StatusWord><span>kolar-web — out of memory twice</span><span>1 h</span></div>
                  </div>
                </div>
              </div>
              <div className="ad-veil" />
              <section className="ad-sheet" style={{ right: 28, top: 108, width: 420 }} aria-label="New project for an account">
                <h2 className="ad-sheet-t">New project for an account</h2>
                <p className="ad-sheet-s">For a customer, a friend or a demo — no checkout.</p>
                <span className="field"><span className="field-label">Owner's email</span><span className="ad-in ad-in--focus">jana@novakova.design<i className="ad-caret" style={{ marginLeft: 2 }} /></span><span className="field-hint">No account yet — one is made, and Jana gets one invite email.</span></span>
                <span className="field"><span className="field-label">Project name</span><span className="ad-in">Novaková — identita 2027</span></span>
                <span className="field">
                  <span className="field-label">Plan</span>
                  <span className="ad-pick" role="radiogroup">
                    <PickOpt on title="Promo" sub="Never a trial, never paused · you pick the storage" />
                    <PickOpt title="Trial, 14 days" sub="Then Jana picks a plan" />
                  </span>
                </span>
                <span className="field">
                  <span className="field-label">Promo storage</span>
                  <span className="seg ad-seg"><span className="ad-seg-b">Project · 25 GB</span><span className="ad-seg-b" aria-pressed="true">Dedicated · 250 GB</span><span className="ad-seg-b">Unlimited</span></span>
                  <span className="field-hint">Why: <b>Design studio we work with</b> · Ends: never</span>
                </span>
                <span className="field"><span className="field-label">Also invite</span><span className="ad-in ad-in--ph">Emails, as Can edit</span></span>
                <div className="ad-sheet-a"><span className="ad-quiet" style={{ fontSize: "var(--type-xs)" }}>Logged as yours in the audit</span><span className="ad-sp" /><span className="btn">Cancel</span><span className="btn btn--primary">Make project</span></div>
              </section>
            </Browser>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cl-op-promo" label="11 · Operator — mark a project as Promo" width={W} height={H} fixed>
          <Stage note={<Note n={11} title="Proposed: Promo is a plan state you set, not an accident.">The operator marks a project Promo with a reason, a storage tier (25 GB, 250 GB or Unlimited) and an optional end. It never becomes a trial and is never paused; every change lands in the log.</Note>}>
            <Browser host="cloud.maude.sh" path="/operator/projects/alligators">
              <div className="ad-op-band"><Icon name="server" size={13} />Operator — you are looking at every account on Maude Cloud. Changes here are logged as yours.</div>
              <Nav op name="Maude Cloud" place="Whole service" tag={<span className="ad-op-tag" style={{ marginLeft: "var(--space-2)" }}>Operator</span>} tabs={[{ label: "Overview" }, { label: "Accounts" }, { label: "Projects" }, { label: "Fleet", count: 1 }, { label: "Events" }]} current="Projects" me="Michal" />
              <div className="ad-main">
                <div className="ad-head">
                  <div><h1 className="ad-h1">Alligators brand</h1><p className="ad-sub">Owner Tomáš · tomas@alligators.cz · 93 canvases · 9 people · cell up</p></div>
                  <div className="ad-head-a"><span className="btn">Reconcile</span><span className="btn btn--primary"><Icon name="spark" size={14} />Mark as Promo</span></div>
                </div>
                <div className="ad-cols ad-cols--2-1">
                  <div className="ad-stack">
                    <div className="ad-card">
                      <h2 className="ad-card-h">Plan <StatusWord state="warn">No plan — never paused, but nothing says why</StatusWord></h2>
                      <dl className="ad-kv" style={{ padding: "0 var(--space-5) var(--space-4)" }}>
                        <dt>Made</dt><dd>By hand, 12 Mar — before trials existed</dd>
                        <dt>Trial</dt><dd>Never started on this project</dd>
                        <dt>Storage</dt><dd>3.1 GB used · no limit set</dd>
                      </dl>
                    </div>
                    <div className="ad-card">
                      <h2 className="ad-card-h">Log <span className="ad-link">All events</span></h2>
                      <div className="ad-feed">
                        <Ev icon="sync" when="Today"><span>Reconciled · cell up, 2.0.0</span></Ev>
                        <Ev icon="people" when="2 Nov"><strong>Tomáš</strong> <span>invited radek@alligators.cz</span></Ev>
                        <Ev icon="folder" when="12 Mar"><strong>Michal</strong> <span>made the project by hand</span></Ev>
                      </div>
                    </div>
                  </div>
                  <div className="ad-card">
                    <h2 className="ad-card-h">Recent jobs</h2>
                    <div className="ad-feed">
                      <Ev icon="export" when="9 min"><span>Export · 4 images</span></Ev>
                      <Ev icon="server" when="03:00"><span>Backup · 412 MB</span></Ev>
                    </div>
                  </div>
                </div>
              </div>
              <div className="ad-veil" />
              <section className="ad-sheet" style={{ right: 28, top: 140, width: 420 }} aria-label="Mark as Promo">
                <h2 className="ad-sheet-t">Mark Alligators brand as Promo</h2>
                <p className="ad-sheet-s">It stays free, never becomes a trial and is never paused.</p>
                <span className="field"><span className="field-label">Why</span><span className="ad-in ad-in--focus">Our own club — showcase project<i className="ad-caret" style={{ marginLeft: 2 }} /></span><span className="field-hint">Only operators see this.</span></span>
                <span className="field">
                  <span className="field-label">Storage</span>
                  <span className="ad-pick" role="radiogroup">
                    <PickOpt title="Project · 25 GB" sub="Like the €29 plan" />
                    <PickOpt on title="Dedicated · 250 GB" sub="Like the €129 plan" />
                    <PickOpt title="Unlimited" sub="No storage limit at all" />
                  </span>
                </span>
                <span className="field"><span className="field-label">Ends</span><span className="ad-sel">Never<Icon name="chevron" size={12} /></span><span className="field-hint">With a date, the owner hears 30 days before.</span></span>
                <div className="ad-sheet-a"><span className="ad-quiet" style={{ fontSize: "var(--type-xs)" }}>Logged as yours</span><span className="ad-sp" /><span className="btn">Cancel</span><span className="btn btn--primary">Mark as Promo</span></div>
              </section>
            </Browser>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cl-promo-owner" label="12 · What Promo looks like to the owner — and when it changes" width={W} height={H} fixed>
          <Stage note={<Note n={12} title="Promo instead of Choose a plan.">The owner sees Promo where a plan or a trial banner would be, and members see nothing about money. If Promo has an end date, the owner hears 30 days before and nothing is paused until a choice is due; a paid plan simply takes over from Promo, never both at once.</Note>}>
            <div className="ds k-v2 ad-closeup" data-theme="light">
              <h1 className="ad-h1">Promo, from the owner's side</h1>
              <p className="ad-sub" style={{ marginBottom: "var(--space-5)" }}>Settings › Plan on cloud.maude.sh, for Tomáš, the owner of Alligators brand.</p>
              <div className="ad-promo-grid">
                <div className="ad-card ad-card--pad">
                  <span className="ad-promo-l">Today</span>
                  <h2 className="ad-sheet-t"><span className="ad-promo">Promo</span> Alligators brand</h2>
                  <dl className="ad-kv">
                    <dt>Plan</dt><dd>Promo from Maude · free</dd>
                    <dt>Storage</dt><dd>3.1 of 250 GB</dd>
                    <dt>Ends</dt><dd>Never</dd>
                  </dl>
                  <p className="ad-sub">No trial, no card, nothing to choose. Where other owners see Choose a plan, this says Promo.</p>
                </div>
                <div className="ad-card ad-card--pad">
                  <span className="ad-promo-l">With an end date — 30 days before</span>
                  <h2 className="ad-sheet-t"><span className="ad-promo">Promo</span> ends on 31 Dec</h2>
                  <p className="ad-sub">Pick a plan to keep editing after that. Nothing is deleted, and until you choose, everyone can still open and export everything.</p>
                  <span className="ad-head-a"><span className="btn btn--primary">Choose a plan</span><span className="btn btn--ghost">Ask Maude for more time</span></span>
                </div>
                <div className="ad-card ad-card--pad">
                  <span className="ad-promo-l">A paid plan starts</span>
                  <h2 className="ad-sheet-t">Project · €29 a month</h2>
                  <p className="ad-sub">Promo ends the moment the plan starts — never both, never charged twice. The log keeps that it was Promo until 4 Nov.</p>
                </div>
                <div className="ad-card ad-card--pad">
                  <span className="ad-promo-l">Members of a Promo project</span>
                  <h2 className="ad-sheet-t">Nothing changes for them</h2>
                  <p className="ad-sub">Anna and Radek work as in any project. Plan, Promo and storage live only in the owner's Settings; their own accounts and trials are separate and untouched.</p>
                </div>
              </div>
            </div>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 3 · One page, the role decides ─────────────────────────────────────────────────── */}
      <DCSection id="roles" title="One web page for both — the role decides what's on it" subtitle="A member and an admin open the same page at the same address; the team server and Maude Cloud share one set of pages and differ only where the service itself differs">
        <DCArtboard id="un-member-ts" label="8 · A member on the team server — Marek, Can edit" width={W} height={H} fixed>
          <Stage note={<Note n={8} title="Same address, a member's page.">Marek opens design.studyfi.com and lands on a Home of Marek's own: projects, who's here, Macs and how to bring a colleague. No health, no settings, no one else's sessions — Michal sees those on the same page, as Admin.</Note>}>
            <Browser host="design.studyfi.com" path="/">
              <Nav name={TS.name} place={TS.place} tabs={[{ label: "Overview" }, { label: "Projects" }, { label: "People" }]} current="Overview" me="Marek · Can edit" ini="M" tone="green" />
              <div className="ad-main">
                <div className="ad-head">
                  <div><h1 className="ad-h1">Hi Marek.</h1><p className="ad-sub">You can edit everything on StudyFi Design · Michal and Tereza run it</p></div>
                  <div className="ad-head-a"><span className="btn btn--primary"><Mark size={16} tile="var(--accent-fg)" star="var(--accent)" />Open in Maude</span></div>
                </div>
                <div className="ad-cols ad-cols--2-1">
                  <div className="ad-card">
                    <h2 className="ad-card-h">Your projects <small>2</small></h2>
                    <div className="ad-projects" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                      {[PROJECTS[1], PROJECTS[2]].map((p) => (
                        <div key={p.name} className="ad-proj">
                          <Thumb art={p.art} className="ad-thumb" />
                          <span className="ad-proj-b"><strong>{p.name}</strong><span className="ad-proj-m"><span>{p.canvases} canvases · Can edit</span><Faces people={p.people} /></span>{p.state}</span>
                        </div>
                      ))}
                    </div>
                    <h2 className="ad-card-h">Lately you opened</h2>
                    <div className="ad-feed">
                      <Ev icon="file" when="Today"><strong>Paywall</strong> <span>· StudyFi app — Jonas is in it now</span></Ev>
                      <Ev icon="file" when="Yesterday"><strong>Pricing hero</strong> <span>· Marketing site</span></Ev>
                    </div>
                  </div>
                  <div className="ad-stack">
                    <div className="ad-card">
                      <h2 className="ad-card-h">Here now</h2>
                      <div className="ad-need" style={{ boxShadow: "none" }}><Faces people={[{ ini: "T", tone: "sky" }, { ini: "J", tone: "green" }, { ini: "M", tone: "yellow" }]} /><span className="ad-need-t"><strong>Tereza, Jonas and Michal</strong><span>Onboarding v3 · Paywall · Overview</span></span></div>
                    </div>
                    <div className="ad-card">
                      <h2 className="ad-card-h">Your Macs</h2>
                      <div className="ad-need" style={{ boxShadow: "none" }}><Icon name="laptop" /><span className="ad-need-t"><strong>Marek's MacBook Air</strong><span>Connected today · this one</span></span><span className="ad-need-a"><span className="btn btn--ghost btn--sm">Sign out</span></span></div>
                    </div>
                    <div className="ad-card">
                      <h2 className="ad-card-h">Bring a colleague</h2>
                      <div className="ad-need" style={{ boxShadow: "none" }}><Icon name="people" /><span className="ad-need-t"><strong>Anyone @studyfi.com can sign in and ask</strong><span>Michal or Tereza lets them in. Only admins send invites.</span></span><span className="ad-need-a"><span className="btn btn--sm">Copy the address</span></span></div>
                    </div>
                  </div>
                </div>
              </div>
            </Browser>
          </Stage>
        </DCArtboard>

        <DCArtboard id="un-member-cl" label="9 · A member on Maude Cloud — Anna, in two projects she doesn't own" width={W} height={H} fixed>
          <Stage note={<Note n={9} title="On Maude Cloud a member is also somebody's customer.">Anna sees what StudyFi shares and what Anna can do in each — and, separately, Anna's own account: empty, a free trial one click away. No Billing and no People for StudyFi; those are Michal's, as Owner.</Note>}>
            <Browser host="cloud.maude.sh" path="/">
              <Nav name="Maude Cloud" place="Anna Králová" tabs={[{ label: "Overview" }, { label: "Projects" }]} current="Overview" me="Anna" ini="A" tone="yellow" />
              <div className="ad-main">
                <div className="ad-head">
                  <div><h1 className="ad-h1">Hi Anna.</h1><p className="ad-sub">StudyFi shares 2 projects with you</p></div>
                  <div className="ad-head-a"><span className="btn btn--primary"><Mark size={16} tile="var(--accent-fg)" star="var(--accent)" />Open in Maude</span></div>
                </div>
                <div className="ad-cols ad-cols--2-1">
                  <div className="ad-card">
                    <h2 className="ad-card-h">Shared with you by StudyFi</h2>
                    <table className="ad-table">
                      <thead><tr><th scope="col">Project</th><th scope="col">You can</th><th scope="col">Last change</th><th scope="col"><span className="ad-sr">Action</span></th></tr></thead>
                      <tbody>
                        <tr><td><span className="ad-who"><Thumb art="mobile" w={48} h={32} /><span className="ad-who-t"><strong>StudyFi app</strong><span>61 canvases</span></span></span></td><td><span className="ad-mrole">Can edit</span></td><td className="ad-quiet">Jonas · 9 min ago</td><td><span className="btn btn--ghost btn--sm">Open</span></td></tr>
                        <tr><td><span className="ad-who"><Thumb art="home" w={48} h={32} /><span className="ad-who-t"><strong>Marketing site</strong><span>24 canvases</span></span></span></td><td><span className="ad-mrole">Can view</span></td><td className="ad-quiet">Ondřej · Fri</td><td><span className="ad-row-a"><span className="btn btn--ghost btn--sm">Ask to edit</span><span className="btn btn--ghost btn--sm">Open</span></span></td></tr>
                      </tbody>
                    </table>
                    <h2 className="ad-card-h">Waiting for you</h2>
                    <div className="ad-feed">
                      <Ev who={{ ini: "T", tone: "sky" }} when="2 h"><strong>Tereza</strong> <span>mentioned you on Onboarding · "Anna, sedí ty texty?"</span></Ev>
                    </div>
                  </div>
                  <div className="ad-stack">
                    <div className="ad-card">
                      <h2 className="ad-card-h">Your own account</h2>
                      <div className="ad-need" style={{ boxShadow: "none" }}><Icon name="folder" /><span className="ad-need-t"><strong>No projects of your own yet</strong><span>14 days free, no card. Only you pay for what you start.</span></span><span className="ad-need-a"><span className="btn btn--sm">Start a project</span></span></div>
                    </div>
                    <div className="ad-card">
                      <h2 className="ad-card-h">Your Macs</h2>
                      <div className="ad-need" style={{ boxShadow: "none" }}><Icon name="laptop" /><span className="ad-need-t"><strong>Anna's iMac</strong><span>Signed in yesterday</span></span><span className="ad-need-a"><span className="btn btn--ghost btn--sm">Sign out</span></span></div>
                    </div>
                    <div className="ad-card">
                      <h2 className="ad-card-h">Emails</h2>
                      <div className="ad-need" style={{ boxShadow: "none" }}><span className="ad-need-t"><strong>Mentions and invites</strong><span>Right away · a daily summary for the rest</span></span><span className="ad-need-a"><span className="btn btn--ghost btn--sm">Change</span></span></div>
                    </div>
                  </div>
                </div>
              </div>
            </Browser>
          </Stage>
        </DCArtboard>

        <DCArtboard id="un-one" label="10 · One set of pages — team server and Maude Cloud, every role" width={W} height={H} fixed>
          <Stage note={<Note n={10} title="Proposed: merge the two into one web app.">One codebase serves both; the role decides what's shown, and each service adds only its own: Billing on Maude Cloud, Health and backups on a team server. Admin becomes a role on your own sign-in.</Note>}>
            <div className="ds k-v2 ad-closeup" data-theme="light">
              <h1 className="ad-h1">Five people, one page — what each of them gets</h1>
              <p className="ad-sub" style={{ marginBottom: "var(--space-5)" }}>One set of tab names and addresses for every role; the role only narrows what's on them. Your Macs lives in the avatar menu.</p>
              <div className="ad-navs">
                {([
                  ["Team server · Admin", TS.name, TS.place, ["Overview", "People", "Projects", "Settings"], "Michal · Admin"],
                  ["Team server · Member", TS.name, TS.place, ["Overview", "Projects", "People"], "Marek · Can edit"],
                  ["Maude Cloud · Owner", "Maude Cloud", "StudyFi", ["Overview", "Projects", "People", "Settings"], "Michal · Owner"],
                  ["Maude Cloud · Member", "Maude Cloud", "Anna Králová", ["Overview", "Projects"], "Anna"],
                  ["Maude Cloud · Operator", "Maude Cloud", "Whole service", ["Overview", "Accounts", "Projects", "Fleet", "Events"], "Michal"],
                ] as [string, string, string, string[], string][]).map(([who, name, place, tabs, me]) => (
                  <div key={who} className="ad-navrow">
                    <span className="ad-navrow-l">{who}</span>
                    <div className="ad-navrow-n"><Nav name={name} place={place} tabs={tabs.map((label) => ({ label }))} current={tabs[0]} me={me} ini={me.slice(0, 1)} tone={me.startsWith("Marek") ? "green" : me.startsWith("Anna") ? "yellow" : "yellow"} /></div>
                  </div>
                ))}
              </div>
              <div className="ad-card" style={{ marginTop: "var(--space-5)" }}>
                <table className="ad-table ad-roles">
                  <thead><tr><th scope="col">Page</th><th scope="col">Team server Admin</th><th scope="col">Team server Member</th><th scope="col">Cloud Owner</th><th scope="col">Cloud Member</th><th scope="col">Operator</th></tr></thead>
                  <tbody>
                    {([
                      ["Overview", "All the numbers", "Your work", "All the numbers", "Your work", "Whole service"],
                      ["Projects", "All · make new", "Yours · open", "All · make new", "Filter: Shared with you", "Every account's · mark Promo"],
                      ["People", "See · invite · change", "See who's here", "See · invite · change", "—", "Every account's"],
                      ["Who can join", "Change", "Read the rule", "—", "—", "—"],
                      ["Health · backups · Git", "Settings", "—", "Run for you", "—", "Fleet"],
                      ["Settings › Billing", "—", "—", "Plan · Promo shown here", "Your own account", "Plans and Promo for anyone"],
                      ["Your Macs (avatar menu)", "✓", "✓", "✓", "✓", "✓"],
                      ["Address", "/people", "/people", "/people", "/projects", "/operator/…"],
                    ] as string[][]).map((r) => (
                      <tr key={r[0]}><th scope="row">{r[0]}</th>{r.slice(1).map((c, i) => <td key={i} className={c === "—" ? "ad-quiet" : ""}>{c === "—" ? "Not shown" : c}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Stage>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
