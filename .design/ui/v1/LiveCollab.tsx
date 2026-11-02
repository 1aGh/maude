/**
 * @canvas      LiveCollab — phase-30 branch-scoped live multiplayer + soft editing-presence (maude DS) · 5 artboards
 * @ds          maude
 * @platform    desktop
 * @opt_out     palette
 * @artboards   same-branch-human | agent-editing | branch-scoped-tree | get-latest | room-cue
 * @brief       The UX of phase-30: two collaborators on the SAME branch see each other's cursors + a SOFT "is editing" heads-up (never a lock); an AI agent editing shows the same way in the --presence-agent hue; the canvas tree is branch-scoped (a teammate on another draft is a coordinate cue, not a tree item); a new canvas arrives via "Get latest". Documents the shipped surface (cursors-overlay.tsx + participants-chrome.tsx editing treatment, DDR-120/121). Reference lifted: Studio Hub artboard D (presence map + agent cursor).
 * @stack       React 19 · TSX · Bun.build · css_mode=inline (sibling LiveCollab.css)
 * @history     .design/_history/livecollab/
 *
 * Authored under the `maude` DS (dark-first), self-contained: tokens +
 * component classes imported in-file. Each artboard is a `.lc.maude[data-theme="dark"]`
 * wrapper so the token ladder + the canvas chrome (sibling LiveCollab.css) scope
 * cleanly. Microcopy follows the collab-model-design.md vocabulary contract —
 * "draft" / "Shared version" / "Get latest", never branch/merge/commit/pull.
 */

import "../../system/maude/colors_and_type.css";
import "../../system/maude/preview/_components.css";
import "./LiveCollab.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

const ICONS: Record<string, JSX.Element> = {
  canvas: (<><polygon points="8 2.4 13.6 5.6 8 8.8 2.4 5.6" /><polyline points="2.4 9 8 12.2 13.6 9" /></>),
  branch: (<><circle cx="4.5" cy="4" r="1.6" /><circle cx="4.5" cy="12" r="1.6" /><circle cx="11" cy="4.5" r="1.6" /><path d="M4.5 5.6v4.8M11 6.1c0 2.4-1.6 3.4-4 3.9" /></>),
  "arrow-right": (<><line x1="3" y1="8" x2="12.5" y2="8" /><polyline points="9 4.5 12.5 8 9 11.5" /></>),
  eye: (<><path d="M1.8 8s2.3-4 6.2-4 6.2 4 6.2 4-2.3 4-6.2 4S1.8 8 1.8 8z" /><circle cx="8" cy="8" r="1.6" /></>),
  pencil: (<><path d="M11 2.5l2.5 2.5M3 13l.7-2.6 7-7 2.5 2.5-7 7L3.5 13z" /></>),
};
const SPARK = "M8 1.5l1.4 4.1L13.5 7l-4.1 1.4L8 12.5 6.6 8.4 2.5 7l4.1-1.4z";

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

// One peer cursor — the colors-presence Pointer (tinted by its owner), with an
// optional ✎ mark + pulse when that peer is editing. Matches the shipped
// cursors-overlay.tsx treatment.
function Cursor({ x, y, label, color, editing, fg = "var(--accent-fg)" }:
  { x: number; y: number; label: string; color: string; editing?: boolean; fg?: string }) {
  return (
    <div className={`lc-cursor${editing ? " lc-cursor--editing" : ""}`} style={{ left: x, top: y }}>
      <svg className="lc-cursor-arrow" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 3 L20 11.5 L12.5 13 L10 21 Z" fill={color} />
      </svg>
      <span className="lc-cursor-tag" style={{ background: color, color: fg }}>
        {label}{editing ? <span aria-hidden="true">✎</span> : null}
      </span>
    </div>
  );
}

function Avatar({ initials, color, editing, agent }:
  { initials: string; color: string; editing?: boolean; agent?: boolean }) {
  // `--lc-ring` drives the editing-ring + mark off the peer's OWN identity hue,
  // so the agent pulses violet (--presence-agent), not the indigo accent.
  const st = { background: color, "--lc-ring": color } as React.CSSProperties;
  return (
    <span className={`lc-avatar${editing ? " lc-avatar--editing" : ""}`} style={st}>
      {initials}
      {(editing || agent) && (
        <span className="lc-avatar-mark" aria-hidden="true">{agent ? "✦" : "✎"}</span>
      )}
    </span>
  );
}

// The presence header — "you're both in this draft, live".
function RoomBar({ draft, here }: { draft: string; here: { initials: string; color: string; editing?: boolean; agent?: boolean }[] }) {
  return (
    <div className="lc-room">
      <span className="lc-room-draft"><span className="lc-room-dot" aria-hidden="true" /> {draft}</span>
      <span className="lc-room-here">· everyone here sees the same thing, live</span>
      <span className="lc-room-spacer" />
      <span className="lc-avatars">
        {here.map((p, i) => <Avatar key={i} initials={p.initials} color={p.color} editing={p.editing} agent={p.agent} />)}
      </span>
    </div>
  );
}

function FrameNode({ x, y, title, editing, accent }:
  { x: number; y: number; title: string; editing?: boolean; accent?: boolean }) {
  return (
    <div className="lc-frame-node" data-editing={editing ? "true" : undefined} style={{ left: x, top: y }}>
      <div className="lc-frame-node-hd"><Icon name="canvas" size={13} /> {title}</div>
      <div className="lc-frame-thumb">
        <span className="lc-frame-bar w70" />
        <span className={`lc-frame-bar${accent ? " w45" : " w45"}`} />
        <span className="lc-frame-bar w70" />
      </div>
    </div>
  );
}

function Cap({ sku, label }: { sku: string; label: string }) {
  return <div className="lc-cap"><b>{sku}</b><span>{label}</span></div>;
}

export default function LiveCollab() {
  return (
    <DesignCanvas>
      <DCSection id="livecollab" title="LiveCollab · maude" subtitle="Branch-scoped live multiplayer + soft editing-presence · 5 artboards (phase-30)">

        {/* A — same branch, human editing */}
        <DCArtboard id="same-branch-human" label="A · same draft · Anna is editing" width={780} height={560}>
          <div className="lc maude" data-theme="dark">
            <Cap sku="LC/A" label="two people in one draft — cursors + a soft 'is editing' heads-up (never a lock)" />
            <RoomBar draft="Redesign" here={[
              { initials: "AN", color: "var(--presence-online)", editing: true },
              { initials: "YO", color: "var(--accent)" },
            ]} />
            <div className="lc-stage">
              <span className="lc-stage-cap"><Icon name="eye" size={13} /> Redesign · live</span>
              <FrameNode x={56} y={120} title="Login" editing />
              <div className="lc-editing-badge" style={{ left: 56, top: 110 }}>
                <span className="lc-pip" style={{ background: "var(--presence-online)" }} aria-hidden="true" />
                Anna is editing <span className="lc-editing-soft">· you can still look around</span>
              </div>
              <FrameNode x={430} y={180} title="Pricing" />
              <Cursor x={250} y={210} label="Anna" color="var(--presence-online)" fg="var(--bg-0)" editing />
              <Cursor x={470} y={300} label="you" color="var(--accent)" />
            </div>
            <p className="lc-note">
              On the same draft you can't overwrite each other while you're together — the live layer keeps both
              screens identical. The badge is a courtesy so you don't both jump into <code>Login</code> at once;
              it never blocks you.
            </p>
          </div>
        </DCArtboard>

        {/* B — agent editing */}
        <DCArtboard id="agent-editing" label="B · the AI agent is editing" width={780} height={560}>
          <div className="lc maude" data-theme="dark">
            <Cap sku="LC/B" label="an AI edit (via /design:edit) shows the same way — in the agent's own violet hue" />
            <RoomBar draft="Redesign" here={[
              { initials: "AN", color: "var(--presence-agent)", agent: true },
              { initials: "YO", color: "var(--accent)" },
            ]} />
            <div className="lc-stage">
              <span className="lc-stage-cap"><Icon name="eye" size={13} /> Redesign · live</span>
              <FrameNode x={56} y={120} title="Onboarding" editing accent />
              <div className="lc-editing-badge lc-editing-badge--agent" style={{ left: 56, top: 110 }}>
                <span className="lc-pip" aria-hidden="true" />
                Anna's agent is editing <span className="lc-editing-soft">· changes arrive live</span>
              </div>
              <FrameNode x={430} y={180} title="Settings" />
              <Cursor x={250} y={205} label="agent" color="var(--presence-agent)" fg="var(--bg-0)" editing />
              <Cursor x={500} y={290} label="you" color="var(--accent)" />
            </div>
            <p className="lc-note">
              The agent's "is editing" heads-up reaches a teammate on another computer too — they see exactly
              what you see, live, while the agent works.
            </p>
          </div>
        </DCArtboard>

        {/* C — branch-scoped tree + cross-branch coordinate cue */}
        <DCArtboard id="branch-scoped-tree" label="C · you see only your draft" width={780} height={520}>
          <div className="lc maude" data-theme="dark">
            <Cap sku="LC/C" label="the tree is your draft's canvases — a teammate on another draft is a cue, not a row" />
            <div className="lc-cols">
              <section className="panel">
                <div className="lc-tree">
                  <div className="lc-tree-sect">Redesign · your draft</div>
                  <div className="lc-row" aria-current="true"><span className="lc-row-ic"><Icon name="canvas" size={14} /></span> Login <span className="lc-row-spacer" /></div>
                  <div className="lc-row"><span className="lc-row-ic"><Icon name="canvas" size={14} /></span> Pricing <span className="lc-row-spacer" /><span className="lc-row-here" title="Bob is here" aria-hidden="true" /></div>
                  <div className="lc-row"><span className="lc-row-ic"><Icon name="canvas" size={14} /></span> Settings <span className="lc-row-spacer" /></div>
                  <div className="lc-row"><span className="lc-row-ic"><Icon name="canvas" size={14} /></span> Onboarding <span className="lc-row-spacer" /></div>
                </div>
                <div className="lc-coord">
                  <div className="lc-coord-row"><Icon name="branch" size={14} /> <b>Carol</b> is working in another draft</div>
                  Her canvases live in <b>Marketing site</b>. To see them, open that draft together.
                  <div style={{ marginTop: "var(--space-3)" }}>
                    <button type="button" className="btn btn--ghost btn--sm">Open “Marketing site”</button>
                  </div>
                </div>
              </section>
              <section className="panel" style={{ minHeight: 320 }}>
                <div className="panel-hd">Login <span className="lc-room-here" style={{ marginLeft: "auto" }} /></div>
                <div className="lc-stage" style={{ height: 250, marginTop: "var(--space-3)" }}>
                  <span className="lc-stage-cap"><Icon name="eye" size={13} /> Redesign · live</span>
                  <FrameNode x={40} y={70} title="Login" />
                  <Cursor x={210} y={150} label="Bob" color="var(--presence-away)" fg="var(--bg-0)" />
                </div>
              </section>
            </div>
          </div>
        </DCArtboard>

        {/* D — get-latest names the new canvas */}
        <DCArtboard id="get-latest" label="D · a new canvas → Get latest" width={780} height={460}>
          <div className="lc maude" data-theme="dark">
            <Cap sku="LC/D" label="a teammate's new canvas arrives through 'Get latest' — named, never a silent surprise" />
            <div className="lc-nudge">
              <span className="lc-nudge-spark" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d={SPARK} /></svg>
              </span>
              <span className="lc-nudge-tx"><b>Anna</b> added <b>Login</b> and 2 more to <b>Redesign</b></span>
              <span className="lc-nudge-spacer" />
              <button type="button" className="btn btn--primary btn--sm">Get latest</button>
            </div>
            <div className="lc-cols" style={{ marginTop: "var(--space-4)" }}>
              <section className="panel">
                <div className="lc-tree">
                  <div className="lc-tree-sect">Redesign · your draft</div>
                  <div className="lc-row"><span className="lc-row-ic"><Icon name="canvas" size={14} /></span> Pricing</div>
                  <div className="lc-row"><span className="lc-row-ic"><Icon name="canvas" size={14} /></span> Settings</div>
                </div>
              </section>
              <section className="panel">
                <p className="lc-note" style={{ margin: "var(--space-2)" }}>
                  Two windows on the <i>same</i> computer update on their own. A teammate on another computer
                  taps <b>Get latest</b> — then <code>Login</code> joins the tree above, named. Nothing ever
                  appears without you knowing.
                </p>
              </section>
            </div>
          </div>
        </DCArtboard>

        {/* E — the room cue (the one thing a user must understand) */}
        <DCArtboard id="room-cue" label="E · the room cue" width={780} height={360}>
          <div className="lc maude" data-theme="dark">
            <Cap sku="LC/E" label="the only mental model: are we in the same draft right now, or not?" />
            <RoomBar draft="Redesign" here={[
              { initials: "AN", color: "var(--presence-online)" },
              { initials: "BO", color: "var(--presence-away)" },
              { initials: "YO", color: "var(--accent)" },
            ]} />
            <div className="lc-cols">
              <section className="panel">
                <div className="panel-hd">Together now</div>
                <p className="lc-note" style={{ margin: "var(--space-3)" }}>
                  In the same draft you see each other's cursors, annotations, comments — and edits — live.
                  Everything is the room's job; you just agree who Saves.
                </p>
              </section>
              <section className="panel">
                <div className="panel-hd">Apart</div>
                <p className="lc-note" style={{ margin: "var(--space-3)" }}>
                  When someone's away, you find their finished work waiting — and they find yours. Like a live
                  call versus a voicemail. <code>Get latest</code> brings you up to date.
                </p>
              </section>
            </div>
          </div>
        </DCArtboard>

      </DCSection>
    </DesignCanvas>
  );
}
