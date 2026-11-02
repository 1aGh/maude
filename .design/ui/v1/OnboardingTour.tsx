/**
 * @canvas      OnboardingTour — the version-control "rychlý kurz" · the built-in, re-openable walkthrough that teaches a non-technical first-timer the whole collaboration model in one pass · the two-layer infographic (live layer over the Save → Publish → Pull cycle) + the per-step coach-mark cards as they appear over the real controls · 5 artboards · dark studio
 * @ds          maude
 * @platform    desktop
 * @opt_out     palette
 * @artboards   infographic | save | publish | pull | hard-thing
 * @brief       Phase 29 (native collab app, epic E4). The collab tour runs on the EXISTING tour engine (overlay.jsx) — a centered infographic step plus coach-marks that spotlight the real Save / Publish / Get-latest controls + the presence layer. This canvas specs the surface. Teaching-model DDR: we REVERSE collab-model-design.md § Part 2's "hide the duality" — we surface a visible three-verb action-cycle (Save changes locally / Publish for everyone / Pull changes) and teach the live-vs-async split honestly, because the cycle must match real buttons and pure-hiding is leaky. The infographic is the hero (it carries the whole mental model): a LIVE layer (cursors · who's here · comments — automatic, no buttons) floating ABOVE the work cycle — the two layers NEVER mixed into one diagram. No raw git terms anywhere.
 * @stack       React 19 · TSX · Bun.build · css_mode=inline (sibling OnboardingTour.css)
 * @history     .design/_history/onboardingtour/
 *
 * Authored under the `maude` DS ("Unified Pro Studio", dark-first). The coach-mark
 * artboards show the card docked over a dimmed mini studio-shell with a spotlight
 * ring on the anchored control — exactly how overlay.jsx renders at runtime.
 */

import "../../system/maude/colors_and_type.css";
import "../../system/maude/preview/_components.css";
import "./OnboardingTour.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

type IconName = keyof typeof ICONS;
const ICONS = {
  cursor: <path d="M3 2.5l9 4.2-3.8 1.2-1.2 3.8z" />,
  people: (<><circle cx="6" cy="6" r="2.2" /><path d="M2.4 13a3.6 3.6 0 0 1 7.2 0" /><path d="M11 4.2a2.2 2.2 0 0 1 0 4.1M11.5 13a3.6 3.6 0 0 0-2-3.2" /></>),
  comment: <path d="M2.5 3.5h11v7h-6l-3 2.2V10.5h-2z" />,
  save: (<><path d="M3 2.5h7.5L13.5 5.5V13.5H3z" /><path d="M5 2.5V6h5V2.5" /><rect x="5.5" y="9" width="5" height="3" /></>),
  publish: (<><line x1="8" y1="13.4" x2="8" y2="6" /><polyline points="5 9 8 6 11 9" /><polyline points="3 4 3 2.6 13 2.6 13 4" /></>),
  download: (<><line x1="8" y1="2.5" x2="8" y2="10" /><polyline points="4.5 7 8 10.5 11.5 7" /><polyline points="3 12.8 3 13.6 13 13.6 13 12.8" /></>),
  "arrow-right": (<><line x1="2.5" y1="8" x2="13" y2="8" /><polyline points="9 4 13 8 9 12" /></>),
  check: <polyline points="3 8.2 6.4 11.5 13 4.2" />,
  branch: (<><circle cx="5" cy="4" r="1.6" /><circle cx="5" cy="12" r="1.6" /><circle cx="11" cy="8" r="1.6" /><path d="M5 5.6v4.8M6.4 4.4A4 4 0 0 0 9.6 7.2" /></>),
} as const;

function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill={name === "cursor" ? "currentColor" : "none"}
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/* The maude mark — the canonical spark-on-bubble tile (system/maude/preview/logo):
 * a four-point star in --accent-fg on the one indigo, bottom-right corner squared
 * (a message bubble), with the in-app accent-tint halo. NOT a hand-drawn glyph. */
function Mark({ size = 26 }: { size?: number }) {
  return (
    <span className="ot-mark" style={{ width: size, height: size }} role="img" aria-label="maude">
      <svg viewBox="0 0 32 32" fill="none">
        <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="currentColor" />
      </svg>
    </span>
  );
}

/* ── the infographic — the hero. Two layers, never mixed. ─────────────────────── */
function CycleStep({ icon, label, sub }: { icon: IconName; label: string; sub: string }) {
  return (
    <span className="ot-step">
      <span className="ot-step-icon"><Icon name={icon} size={18} /></span>
      <span className="ot-step-label">{label}</span>
      <span className="ot-step-sub">{sub}</span>
    </span>
  );
}
function Infographic() {
  return (
    <div className="ot-info">
      <div className="ot-live">
        <div className="ot-live-hd"><span className="ot-live-dot" aria-hidden="true" /><span><b>Together</b> · automatic — no buttons</span></div>
        <div className="ot-live-items">
          <span className="ot-live-item"><Icon name="cursor" size={14} /> cursors</span>
          <span className="ot-live-item"><Icon name="people" size={14} /> who's here</span>
          <span className="ot-live-item"><Icon name="comment" size={14} /> comments</span>
        </div>
        <div className="ot-live-note">When you're both here, you see each other instantly.</div>
      </div>
      <div className="ot-bridge" aria-hidden="true"><span className="ot-bridge-line" /><span className="ot-bridge-label">the work itself</span><span className="ot-bridge-line" /></div>
      <div className="ot-cycle">
        <CycleStep icon="save" label="Save changes locally" sub="a checkpoint, just for you" />
        <span className="ot-cyc-arrow" aria-hidden="true"><Icon name="arrow-right" size={16} /></span>
        <CycleStep icon="publish" label="Publish for everyone" sub="put it on the shared shelf" />
        <span className="ot-cyc-arrow" aria-hidden="true"><Icon name="arrow-right" size={16} /></span>
        <CycleStep icon="download" label="Pull changes" sub="get everyone else's work" />
      </div>
    </div>
  );
}

/* ── a coach-mark over a dimmed mini studio-shell with a spotlight on the anchor ── */
function CoachShell({ spotlight, children }: { spotlight: "save" | "publish" | "pull" | "presence"; children: React.ReactNode }) {
  return (
    <div className="ot-coach">
      <div className="ot-mini">
        <div className="ot-mini-bar">
          <Mark size={16} />
          <span className="ot-mini-ctx">maude · Shared version</span>
          <span className="ot-grow" />
          <span className={"ot-mini-presence" + (spotlight === "presence" ? " is-lit" : "")}>
            <span className="ot-pdot" style={{ background: "var(--accent)" }}>YO</span>
            <span className="ot-pdot" style={{ background: "var(--presence-online)" }}>AN</span>
          </span>
        </div>
        <div className="ot-mini-body">
          <div className="ot-mini-side">
            <div className="ot-mini-changes">
              <div className="ot-mini-changes-hd">Changes</div>
              <div className={"ot-mini-btn ot-mini-btn--save" + (spotlight === "save" ? " is-lit" : "")}><Icon name="save" size={13} /> Save changes locally</div>
              <div className={"ot-mini-btn ot-mini-btn--publish" + (spotlight === "publish" ? " is-lit" : "")}><Icon name="publish" size={13} /> Publish for everyone</div>
              <div className={"ot-mini-btn ot-mini-btn--pull" + (spotlight === "pull" ? " is-lit" : "")}><Icon name="download" size={13} /> Pull changes</div>
            </div>
          </div>
          <div className="ot-mini-stage">
            <div className="ot-mini-sk" style={{ width: "60%", height: 12 }} />
            <div className="ot-mini-sk" style={{ width: "88%" }} />
            <div className="ot-mini-sk is-accent" />
          </div>
        </div>
        <div className="ot-scrim" aria-hidden="true" />
      </div>
      {children}
    </div>
  );
}
function CoachCard({ n, title, body, primary = "Next" }: { n: number; title: string; body: string; primary?: string }) {
  return (
    <div className="ot-card" role="dialog" aria-modal="true" aria-label={title}>
      <div className="ot-card-step">{n} / 6</div>
      <div className="ot-card-title">{title}</div>
      <div className="ot-card-body">{body}</div>
      <div className="ot-card-actions">
        <span className="ot-card-skip">Skip</span>
        <span className="ot-card-nav"><span className="ot-card-back">Back</span><span className="btn btn--primary ot-card-next">{primary}</span></span>
      </div>
    </div>
  );
}

export default function OnboardingTour() {
  return (
    <DesignCanvas background="var(--bg-0)">
      <DCSection id="tour" title="OnboardingTour · maude" subtitle="MAUDE/E4 · 5 artboards · the collab rychlý kurz · two-layer infographic + coach-marks">
        <DCArtboard id="infographic" label="A · The infographic — the two-layer model (hero)" width={1180} height={840}>
          <div className="maude ot-frame" data-theme="dark">
            <div className="ot-hero-card ot-hero-card--big" role="dialog" aria-modal="true" aria-label="Working together, in one picture">
              <div className="ot-hero-top">
                <span className="ot-hero-brand"><Mark size={28} /> <b>maude</b></span>
                <span className="ot-card-step">1 / 6</span>
              </div>
              <Infographic />
              <div className="ot-hero-tx">
                <h2>Working together, in one picture</h2>
                <p>Two layers. Up top, being together just happens. Below, your work moves through three simple steps. Let's walk them.</p>
              </div>
              <div className="ot-card-actions">
                <span className="ot-card-skip">Skip</span>
                <span className="ot-card-nav"><span className="btn btn--primary ot-card-next">Next <Icon name="arrow-right" size={14} /></span></span>
              </div>
            </div>
          </div>
        </DCArtboard>

        <DCArtboard id="save" label="B · Coach-mark — Save changes locally" width={1180} height={840}>
          <div className="maude ot-frame" data-theme="dark">
            <CoachShell spotlight="save">
              <CoachCard n={2} title="Save changes locally" body="When something looks right, save it. That keeps a version on your computer you can always come back to — like a checkpoint, just for you." />
            </CoachShell>
          </div>
        </DCArtboard>

        <DCArtboard id="publish" label="C · Coach-mark — Publish for everyone" width={1180} height={840}>
          <div className="maude ot-frame" data-theme="dark">
            <CoachShell spotlight="publish">
              <CoachCard n={3} title="Publish for everyone" body="Ready to share? Publish sends your saved work to the whole team. Think of it as putting your version on the shared shelf." />
            </CoachShell>
          </div>
        </DCArtboard>

        <DCArtboard id="pull" label="D · Coach-mark — the live layer is automatic" width={1180} height={840}>
          <div className="maude ot-frame" data-theme="dark">
            <CoachShell spotlight="presence">
              <CoachCard n={5} title="Being together is automatic" body="Cursors, who's here, and comments need no buttons at all. When you're both in a canvas, you see each other live — that's the top layer, always on." />
            </CoachShell>
          </div>
        </DCArtboard>

        <DCArtboard id="hard-thing" label="F · The one honest hard thing — apart, you pick (never a merge)" width={1180} height={840}>
          <div className="maude ot-frame" data-theme="dark">
            <div className="ot-hero-card ot-hero-card--narrow" role="dialog" aria-modal="true" aria-label="The one thing worth knowing">
              <div className="ot-card-step">6 / 6</div>
              <div className="ot-hard">
                <span className="ot-hard-icon"><Icon name="branch" size={26} /></span>
                <div className="ot-hard-pick">
                  <span className="ot-pick ot-pick--mine">Keep mine</span>
                  <span className="ot-pick ot-pick--theirs">Keep theirs</span>
                  <span className="ot-pick ot-pick--both">Keep both</span>
                </div>
              </div>
              <div className="ot-hero-tx">
                <h2>The one thing worth knowing</h2>
                <p>When you're here together, publishing already covers your teammate — they've seen it live. Only when you work <b>apart</b> can two versions drift. If that happens, Maude shows you both and lets you pick. <b>Never a confusing merge.</b></p>
              </div>
              <div className="ot-card-actions">
                <span className="ot-card-skip" />
                <span className="ot-card-nav"><span className="ot-card-back">Back</span><span className="btn btn--primary ot-card-next">Done</span></span>
              </div>
            </div>
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
