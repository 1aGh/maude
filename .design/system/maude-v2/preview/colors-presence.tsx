/**
 * SPECIMEN — colors-presence · maude-v2
 *
 * DEMONSTRATES: --presence-online, --presence-away, --presence-offline and --presence-agent
 *   (= --spark): presence dots on avatars, people's cursors and selections on the canvas,
 *   and the AI agent as its own kind of presence.
 * COMPOSITION: hero = a live "Pricing" canvas with Tereza selecting the Pro plan, Jonas typing
 *   on a sticky and the AI sketching the footer — every cursor anchored to a specific
 *   artboard, sticky or layer row, and the people popover open from the share island.
 *   Then the four presence states, person-vs-agent cursor anatomy, the people-colour rule
 *   (which canvas colours a person may wear, and which are reserved), and three wrong turns.
 * COPY VOICE: real names, what each person is doing to the work ("selecting Pro"), no
 *   timestamps-as-codes, no "user 3".
 * WHEN SCAFFOLDED: presence family (maude-v2 is multiplayer).
 * NOTES: People's cursor colours borrow the canvas object palette (cursors live ON the
 *   canvas). Coral is never given to a person — it sits beside the spark, and the spark is
 *   the AI's alone. Presence dots never blink.
 */
import "./_layout.css";
import "./colors-presence.css";
import { Spark, SpecimenHeader } from "./_specimen-controls";

/* People wear light canvas colours, so their arrow gets an ink edge; the agent's spark arrow keeps a paper edge. */
function Cursor({ color, size = 18 }: { color: string; size?: number }) {
  const edge = color === "var(--presence-agent)" ? "var(--bg-2)" : "var(--object-ink)";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 2l9 4.4-4 1.1-1.1 4z" fill={color} stroke={edge} strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

function NoSign() {
  return (
    <svg className="pr-no" width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="var(--bg-2)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="14" cy="14" r="11" />
      <path d="M6.5 21.5l15-15" />
    </svg>
  );
}

type State = "online" | "away" | "offline" | "agent";

function Avatar({ initials, state, size = "md" }: { initials?: string; state: State; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={`pr-av pr-av--${size}${state === "agent" ? " pr-av--agent" : ""}`}>
      {state === "agent" ? <Spark size={size === "lg" ? 18 : 12} color="var(--spark)" /> : initials}
      <span className={`pr-dot pr-dot--${state}`} aria-hidden="true" />
    </span>
  );
}

const PEOPLE: { name: string; ini?: string; state: State; doing: string }[] = [
  { name: "Tereza", ini: "T", state: "online", doing: "Selecting the Pro plan" },
  { name: "Jonas", ini: "J", state: "online", doing: "Writing on a sticky" },
  { name: "AI", state: "agent", doing: "Sketching the footer" },
  { name: "Petr", ini: "P", state: "away", doing: "Away for 12 minutes" },
  { name: "Klára", ini: "K", state: "offline", doing: "Here yesterday" },
];

const STATES: { state: State; ini?: string; word: string; token: string; note: string }[] = [
  { state: "online", ini: "T", word: "Here now", token: "--presence-online", note: "Their cursor is on the canvas." },
  { state: "away", ini: "P", word: "Away", token: "--presence-away", note: "Tab open, no movement. Cursor hidden." },
  { state: "offline", ini: "K", word: "Not here", token: "--presence-offline", note: "Listed so you know who has access." },
  { state: "agent", word: "AI at work", token: "--presence-agent", note: "Only while it's doing something you asked." },
];

const PALETTE = [
  { c: "sky", ok: true, who: "Tereza" },
  { c: "green", ok: true, who: "Jonas" },
  { c: "lilac", ok: true, who: "Petr" },
  { c: "yellow", ok: true, who: "Klára" },
];

export default function ColorsPresence() {
  return (
    <>
      <SpecimenHeader crumbs={["Colour", "Presence"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>People in calm colours. The AI in the spark.</h1>
          <p className="lede">
            When Tereza and Jonas are on the same canvas, you see where they are and what they're touching —
            quietly. The AI shows up the same way, in the one colour nobody else is allowed to wear.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Online</dt><dd>hue 152</dd></div>
          <div><dt>Away</dt><dd>hue 80</dd></div>
          <div><dt>Offline</dt><dd>neutral ink</dd></div>
          <div><dt>Agent</dt><dd>= --spark</dd></div>
        </dl>

        {/* ── Hero: a shared canvas ──────────────────────────────────────── */}
        <h2 data-no>A shared canvas<span className="h2-aside">every cursor is on something</span></h2>
        <div className="stage pr-hero">
          <div className="pr-ab-label">Pricing</div>
          <div className="pr-artboard">
            <div className="pr-plans">
              <div className="pr-plan"><b>Free</b><span>For trying it out</span></div>
              <div className="pr-plan pr-plan--sel">
                <b>Pro</b><span>For one designer</span>
                {/* Tereza → the Pro plan (cursor lives inside what it points at) */}
                <div className="pr-cur pr-cur-tereza"><Cursor color="var(--object-sky)" /><span className="pr-tag pr-tag--sky">Tereza</span></div>
              </div>
              <div className="pr-plan"><b>Team</b><span>For studios</span></div>
            </div>
            <div className="pr-footer">
              <span className="pr-skel" /><span className="pr-skel pr-skel--short" />
              {/* The AI → the footer it's sketching */}
              <div className="pr-cur pr-cur-ai"><Cursor color="var(--presence-agent)" /><span className="pr-tag pr-tag--ai"><Spark size={10} color="var(--spark-fg)" /> AI is sketching the footer</span></div>
            </div>
          </div>

          <div className="sticky sticky--green pr-sticky">
            Move the CTA up<span className="pr-caret" aria-hidden="true" />
            {/* Jonas → his sticky */}
            <div className="pr-cur pr-cur-jonas"><Cursor color="var(--object-green)" /><span className="pr-tag pr-tag--green">Jonas</span></div>
          </div>

          <div className="island island--pad pr-layers">
            <p className="island-title">Layers</p>
            <div className="row-item"><span className="pr-li" />Pricing</div>
            <div className="row-item pr-indent"><span className="pr-li" />Free</div>
            <div className="row-item pr-indent"><span className="pr-li" />Pro<span className="pr-row-who"><Avatar initials="T" state="online" size="sm" /></span></div>
            <div className="row-item pr-indent"><span className="pr-li" />Team</div>
            <div className="row-item pr-indent"><span className="pr-li" />Footer<span className="pr-row-who pr-row-ai"><Spark size={10} color="var(--spark)" />AI</span></div>
          </div>

          <div className="island pr-share">
            <span className="pr-stack">
              <Avatar initials="T" state="online" />
              <Avatar initials="J" state="online" />
              <Avatar state="agent" />
            </span>
            <button className="btn btn--primary" type="button">Share</button>
          </div>

          <div className="pr-people">
            <p className="pr-people-hd">On this canvas</p>
            {PEOPLE.map((p) => (
              <div className="pr-person" key={p.name}>
                <Avatar initials={p.ini} state={p.state} />
                <span className="pr-person-t"><b>{p.name}</b><span>{p.doing}</span></span>
              </div>
            ))}
          </div>
        </div>

        {/* ── States ─────────────────────────────────────────────────────── */}
        <h2 data-no>Four states<span className="h2-aside">a dot plus a word — never the dot alone</span></h2>
        <div className="pr-states">
          {STATES.map((s) => (
            <div className="pr-state" key={s.state}>
              <Avatar initials={s.ini} state={s.state} size="lg" />
              <strong>{s.word}</strong>
              <code>{s.token}</code>
              <span>{s.note}</span>
            </div>
          ))}
        </div>

        {/* ── Cursor anatomy ─────────────────────────────────────────────── */}
        <h2 data-no>Two kinds of cursor<span className="h2-aside">a person points; the agent works</span></h2>
        <div className="pr-anatomy">
          <div className="pr-anat">
            <div className="pr-anat-stage">
              <div className="pr-anat-box pr-anat-box--person">Hero image</div>
              <div className="pr-cur pr-anat-cur"><Cursor color="var(--object-sky)" size={20} /><span className="pr-tag pr-tag--sky">Tereza</span></div>
            </div>
            <ul>
              <li><b>Arrow</b> in their canvas colour</li>
              <li><b>Name</b> only — no verb, no status</li>
              <li><b>Selection</b> solid, in the same colour</li>
            </ul>
          </div>
          <div className="pr-anat">
            <div className="pr-anat-stage">
              <div className="pr-anat-box pr-anat-box--agent">Footer</div>
              <div className="pr-cur pr-anat-cur"><Cursor color="var(--presence-agent)" size={20} /><span className="pr-tag pr-tag--ai"><Spark size={10} color="var(--spark-fg)" /> AI is sketching…</span></div>
            </div>
            <ul>
              <li><b>Arrow</b> in --presence-agent, which is the spark</li>
              <li><b>Spark + verb</b> — it says what it's doing</li>
              <li><b>Working area</b> dashed, so it reads as not done yet</li>
            </ul>
          </div>
        </div>

        {/* ── People colours ─────────────────────────────────────────────── */}
        <h2 data-no>Colours for people<span className="h2-aside">borrowed from the canvas, with two kept back</span></h2>
        <div className="pr-palette">
          {PALETTE.map((p) => (
            <div className="pr-pal" key={p.c}>
              <span className={`pr-pal-fill pr-pal-${p.c}`}><Cursor color={`var(--object-${p.c})`} size={22} /></span>
              <strong>{p.who}</strong>
              <code>--object-{p.c}</code>
            </div>
          ))}
          <div className="pr-pal pr-pal--kept">
            <span className="pr-pal-fill pr-pal-coral"><NoSign /></span>
            <strong>Nobody</strong>
            <span>Coral sits next to the spark. If a person wore it, the AI would stop being obvious.</span>
          </div>
          <div className="pr-pal pr-pal--kept">
            <span className="pr-pal-fill pr-pal-accent"><NoSign /></span>
            <strong>Only you</strong>
            <span>Azure is your own selection. Other people never take it.</span>
          </div>
        </div>

        {/* ── Wrong turns ────────────────────────────────────────────────── */}
        <h2 data-no>Three wrong turns</h2>
        <div className="pr-wrong">
          <figure className="pr-case">
            <div className="stage pr-mini">
              <div className="pr-cur pr-mini-cur1"><Cursor color="var(--object-sky)" /><span className="pr-tag pr-tag--sky">Tereza</span></div>
              <div className="pr-cur pr-mini-cur2"><Cursor color="var(--object-lilac)" /><span className="pr-tag pr-tag--lilac">Jonas</span></div>
            </div>
            <figcaption><strong className="pr-bad">Cursors in empty canvas</strong> Pointing at nothing tells you nothing. Show where people are working.</figcaption>
          </figure>
          <figure className="pr-case">
            <div className="stage pr-mini">
              <div className="pr-mini-box">Footer</div>
              <div className="pr-cur pr-mini-cur3"><Cursor color="var(--object-lilac)" /><span className="pr-tag pr-tag--lilac">Assistant</span></div>
            </div>
            <figcaption><strong className="pr-bad">The AI as one more person</strong> In a lilac cursor with a name, nobody can tell the agent is the one changing the footer.</figcaption>
          </figure>
          <figure className="pr-case">
            <div className="stage pr-mini">
              <div className="pr-mini-box">Pricing</div>
              <div className="pr-cur pr-mini-cur3"><Cursor color="var(--object-coral)" /><span className="pr-tag pr-tag--coral">Jonas</span></div>
            </div>
            <figcaption><strong className="pr-bad">A person in coral</strong> At a glance Jonas reads as the AI. Coral stays on stickies.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · presence</span>
        <span>The spark is the AI's alone</span>
      </footer>
    </>
  );
}
