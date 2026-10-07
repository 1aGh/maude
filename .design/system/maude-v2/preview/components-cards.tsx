/**
 * SPECIMEN — components-cards · maude-v2
 *
 * DEMONSTRATES: the canvas card (Home + canvas finder) — --bg-1 body, --radius-lg outer › --radius-md
 *               thumbnail (concentric), --shadow-sm at rest, --shadow-lg on hover via an opacity-faded
 *               layer, lift by transform only (--dur-flip + --ease-out) · .chip--spark "Made by AI" ·
 *               --presence-agent · --object-* inside thumbnails only · --accent as the selection ring.
 * COMPOSITION:  hero = Home for "Studio site": pinned and recent canvases as thumbnail-first cards, with
 *               one card held in its hover state and one the AI is editing right now · the card magnified
 *               with numbered anatomy · every state side by side · a live density switch (large / small /
 *               list — the same five canvases) · project cards whose canvases fan out on hover · the
 *               empty "New canvas" card and the empty project · right / wrong (developer chrome on a card).
 * COPY VOICE:   the user's canvases and people — "Edited 2 min ago by Tereza", never paths or hashes.
 *               Times per CONTRACT.md §4: relative first, then "28 Sep, 16:20".
 * A11Y:         a card is NOT a focusable article — its name is a link stretched over the card
 *               (accessible name = the visible canvas name); Pin and More sit above it as their
 *               own buttons. Focus on the link draws the ring on the whole card (:has).
 * NOTES:        The card's anatomy (padding 8 / 8 / 12, 120 px thumbnail, name then meta) matches the
 *               loading card in skeletons.tsx exactly, so nothing moves when the real card arrives.
 *               Colour lives in the thumbnail — the card itself stays neutral.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import "./_layout.css";
import "./components-cards.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

type Art = "home" | "onb" | "price" | "mobile" | "brand" | "board";
type Who = "T" | "J" | "Y";
type Canvas = { name: string; art: Art; meta: string; people?: Who[]; pinned?: boolean; ai?: boolean; agent?: boolean };

const CANVASES: Canvas[] = [
  { name: "Homepage", art: "home", meta: "Edited 2 min ago by Tereza", people: ["T", "J"], pinned: true },
  { name: "Pricing", art: "price", meta: "Edited yesterday by Jonas", people: ["J"], pinned: true },
  { name: "Onboarding", art: "onb", meta: "Edited just now", ai: true, agent: true },
  { name: "Mobile — detail", art: "mobile", meta: "Edited yesterday", people: ["T"] },
  { name: "Brand moodboard", art: "board", meta: "Edited 28 Sep, 16:20", ai: true },
];

const WHO: Record<Who, { name: string; c: string }> = {
  T: { name: "Tereza", c: "sky" },
  J: { name: "Jonas", c: "green" },
  Y: { name: "You", c: "lilac" },
};

function Ic({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const PIN = "M6 2.5h4M7 2.5v3.5L4.5 8.5h7L9 6V2.5M8 8.5v5";
const MORE = "M3.5 8h.01M8 8h.01M12.5 8h.01";
const PLUS = "M8 3v10M3 8h10";
const SEARCH = "M10.25 10.25l3.25 3.25M11.25 7a4.25 4.25 0 1 1-8.5 0 4.25 4.25 0 0 1 8.5 0z";

/** What is on the canvas, drawn small — the only place a card carries colour. */
function Thumb({ art, children }: { art: Art; children?: ReactNode }) {
  return (
    <div className={`cd-thumb cd-art--${art}`}>
      <i /><i /><i /><i />
      {children}
    </div>
  );
}

function Faces({ who }: { who?: Who[] }) {
  if (!who?.length) return null;
  return (
    <span className="cd-faces" role="img" aria-label={`Here now: ${who.map((w) => WHO[w].name).join(", ")}`}>
      {who.map((w) => <span key={w} className={`cd-face cd-face--${WHO[w].c}`} aria-hidden="true">{w}</span>)}
    </span>
  );
}

function Card({ c, state }: { c: Canvas; state?: "hover" | "selected" | "focus" | "opening" }) {
  return (
    <article className="cd-card" data-state={state}>
      <Thumb art={c.art}>
        {c.ai ? <span className="chip chip--spark cd-ai"><Spark size={9} color="var(--spark)" />Made by AI</span> : null}
        {c.agent ? <span className="cd-agent"><span className="cd-agent-dot" />AI is editing</span> : null}
        <span className="cd-tools">
          <button className="icon-btn cd-tool" type="button" aria-label={c.pinned ? "Unpin" : "Pin"} aria-pressed={c.pinned ? "true" : "false"}><Ic d={PIN} size={14} /></button>
          <button className="icon-btn cd-tool" type="button" aria-label={`More for ${c.name}`}><Ic d={MORE} size={14} /></button>
        </span>
      </Thumb>
      <div className="cd-body">
        <strong><a className="cd-open" href="#" onClick={(e) => e.preventDefault()}>{c.name}</a></strong>
        <span className="cd-meta">
          {c.pinned ? <span className="cd-pinned"><Ic d={PIN} size={11} /><span className="cd-sr">Pinned · </span></span> : null}
          {c.meta}
        </span>
        <Faces who={c.people} />
      </div>
    </article>
  );
}

function NewCard({ big = false }: { big?: boolean }) {
  return (
    <button className={`cd-new${big ? " cd-new--big" : ""}`} type="button">
      <span className="cd-new-plus"><Ic d={PLUS} size={18} /></span>
      <strong>New canvas</strong>
      <span>or ask AI for a first draft</span>
    </button>
  );
}

const STATES: { k: string; note: string; c: Canvas; state?: "hover" | "selected" | "focus" | "opening" }[] = [
  { k: "Rest", note: "Picture, name, when. Nothing else asks for attention.", c: { name: "Mobile — detail", art: "mobile", meta: "Edited yesterday" } },
  { k: "Hover", note: "Lifts 4 px, the shadow deepens, pin and More appear.", state: "hover", c: { name: "Mobile — detail", art: "mobile", meta: "Edited yesterday" } },
  { k: "Selected", note: "Azure ring — picked for moving or duplicating.", state: "selected", c: { name: "Pricing", art: "price", meta: "Edited yesterday by Jonas" } },
  { k: "Keyboard focus", note: "Same ring, 3 px out. ↵ opens the canvas.", state: "focus", c: { name: "Pricing", art: "price", meta: "Edited yesterday by Jonas" } },
  { k: "Pinned", note: "A small pin before the time; pinned cards sit first.", c: CANVASES[0] },
  { k: "Made by AI", note: "A quiet spark chip in the thumbnail's corner.", c: { ...CANVASES[4], people: undefined } },
  { k: "AI at work", note: "The agent's dot and a short line, in the spark.", c: CANVASES[2] },
  { k: "Opening", note: "The thumbnail dims while the canvas loads.", state: "opening", c: { name: "Homepage", art: "home", meta: "Opening…" } },
];

const PROJECTS: { name: string; count: string; arts: Art[]; who: Who[] }[] = [
  { name: "Studio site", count: "5 canvases", arts: ["home", "price", "onb"], who: ["T", "J"] },
  { name: "Alligators brand", count: "8 canvases", arts: ["brand", "board", "mobile"], who: ["Y"] },
];

type Density = "large" | "small" | "list";

export default function ComponentsCards() {
  const [density, setDensity] = useState<Density>("large");

  return (
    <>
      <SpecimenHeader crumbs={["Components", "Cards"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>The picture first. The name second. Everything else on hover.</h1>
          <p className="lede">
            You find a canvas by what's on it, so every card leads with its thumbnail. Below it, the name and
            when it last changed. Pin and More wait until you point at the card — at rest, the work does the talking.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Corners</dt><dd>card 14 › thumbnail 10</dd></div>
          <div><dt>Padding</dt><dd>8 · 8 · 12 — same as the loading card</dd></div>
          <div><dt>Hover</dt><dd>lift 4 px · transform only</dd></div>
          <div><dt>Colour</dt><dd>inside the thumbnail only</dd></div>
        </dl>

        <h2 data-no>Home<span className="h2-aside">“Studio site” — pinned first, then recent</span></h2>
        <div className="stage cd-hero">
          <div className="island cd-pill">
            <Mark size={22} />
            <span>Studio site</span>
          </div>
          <div className="island cd-tr">
            <span className="cd-search">
              <Ic d={SEARCH} size={14} />
              <span>Search</span>
              <span className="kbd">⌘K</span>
            </span>
            <button className="btn btn--primary" type="button">New canvas</button>
          </div>

          <div className="cd-home">
            <p className="cd-group">Pinned</p>
            <div className="cd-grid cd-grid--4">
              <Card c={CANVASES[0]} state="hover" />
              <Card c={CANVASES[1]} />
            </div>
            <p className="cd-group">Recent</p>
            <div className="cd-grid cd-grid--4">
              <Card c={CANVASES[2]} />
              <Card c={CANVASES[3]} />
              <Card c={CANVASES[4]} />
              <NewCard />
            </div>
          </div>
        </div>

        <p className="cd-hero-cap">
          Homepage is held in its hover state — lifted, with pin and More showing. Onboarding was made by
          AI, and AI is in there working right now.
        </p>

        <h2 data-no>Anatomy<span className="h2-aside">one card, every part named</span></h2>
        <div className="cd-anat">
          <div className="cd-anat-stage">
            <div className="cd-anat-card">
              <Card c={CANVASES[0]} state="hover" />
              <span className="cd-n cd-n--1">1</span>
              <span className="cd-n cd-n--2">2</span>
              <span className="cd-n cd-n--3">3</span>
              <span className="cd-n cd-n--4">4</span>
              <span className="cd-n cd-n--5">5</span>
            </div>
          </div>
          <ol className="cd-anat-key">
            <li><span className="cd-n">1</span><div><strong>Thumbnail</strong><span>A live picture of the canvas, corner 10 inside the card's 14. Object colours belong here — and only here.</span></div></li>
            <li><span className="cd-n">2</span><div><strong>Pin and More</strong><span>Small icon buttons on a solid chip — no frost on your work. Hidden at rest, there the moment you point or tab in.</span></div></li>
            <li><span className="cd-n">3</span><div><strong>Name</strong><span>The canvas name, one line, semibold — and the link that opens it, so the whole card is one click. Long names end with an ellipsis.</span></div></li>
            <li><span className="cd-n">4</span><div><strong>When, and who</strong><span>“Edited 2 min ago by Tereza”. Relative while fresh, then “28 Sep, 16:20”. A real name, never a timestamp.</span></div></li>
            <li><span className="cd-n">5</span><div><strong>Who's here</strong><span>Faces of the people on the canvas now, in their canvas colours. Gone when nobody is.</span></div></li>
          </ol>
        </div>

        <h2 data-no>States<span className="h2-aside">eight moments of the same card</span></h2>
        <div className="cd-states">
          {STATES.map((s) => (
            <figure className="cd-state" key={s.k}>
              <div className="cd-state-slot"><Card c={s.c} state={s.state} /></div>
              <figcaption><strong>{s.k}</strong><span>{s.note}</span></figcaption>
            </figure>
          ))}
        </div>

        <h2 data-no>Three densities<span className="h2-aside">the same five canvases — switch it</span></h2>
        <div className="cd-density-bar">
          <span className="seg" role="group" aria-label="Card size">
            <button type="button" aria-pressed={density === "large"} onClick={() => setDensity("large")}>Large</button>
            <button type="button" aria-pressed={density === "small"} onClick={() => setDensity("small")}>Small</button>
            <button type="button" aria-pressed={density === "list"} onClick={() => setDensity("list")}>List</button>
          </span>
          <span className="cd-density-note">
            {density === "large" && "Home's default — big enough to recognise a layout at a glance."}
            {density === "small" && "For projects with dozens of canvases. Faces hide; the picture stays."}
            {density === "list" && "Inside an island — the canvas finder and the left panel. The thumbnail shrinks to a swatch."}
          </span>
        </div>
        <div className="stage cd-density" data-density={density}>
          {density === "list" ? (
            <div className="island island--pad cd-list">
              <p className="island-title">Canvases</p>
              {CANVASES.map((c, i) => (
                <div className="row-item" key={c.name} aria-current={i === 0 ? "true" : undefined}>
                  <span className={`thumb cd-sw--${c.art}`} aria-hidden="true" />
                  <span className="cd-list-name">{c.name}</span>
                  {c.ai ? <><Spark size={10} color="var(--spark)" /><span className="cd-sr">Made by AI</span></> : null}
                  {c.pinned ? <span className="cd-list-pin"><Ic d={PIN} size={11} /><span className="cd-sr">Pinned</span></span> : null}
                </div>
              ))}
            </div>
          ) : (
            <div className={`cd-grid ${density === "large" ? "cd-grid--3" : "cd-grid--5 cd-grid--small"}`}>
              {CANVASES.map((c) => <Card c={c} key={c.name} />)}
            </div>
          )}
        </div>

        <h2 data-no>Projects<span className="h2-aside">a stack of its canvases — point at one</span></h2>
        <div className="cd-projects">
          {PROJECTS.map((p) => (
            <article className="cd-project" key={p.name}>
              <div className="cd-fan" aria-hidden="true">
                {p.arts.map((a, i) => <span key={a} className={`cd-fan-card cd-fan-card--${i}`}><Thumb art={a} /></span>)}
              </div>
              <div className="cd-project-body">
                <strong><a className="cd-open" href="#" onClick={(e) => e.preventDefault()}>{p.name}</a></strong>
                <span className="cd-meta cd-count">{p.count}</span>
                <Faces who={p.who} />
              </div>
            </article>
          ))}
          <div className="cd-project-note">
            <strong>Projects hold canvases.</strong>
            <span>
              A project card shows its three most recent canvases, stacked. Point at it and they fan out — a
              drop of spring, because this is a playful moment, not a working one.
            </span>
          </div>
        </div>

        <h2 data-no>Starting something<span className="h2-aside">the empty card, and the empty project</span></h2>
        <div className="cd-empty">
          <div className="cd-empty-cell">
            <NewCard />
            <span className="cd-empty-cap">Last in the grid, always. A quiet outline in rounded type — it's an invitation, not a button shouting.</span>
          </div>
          <div className="stage cd-empty-stage">
            <div className="cd-empty-hero">
              <span className="cd-empty-mark"><Mark size={40} /></span>
              <strong>Alligators brand is empty.</strong>
              <span>Start a canvas, or ask AI for a first draft.</span>
              <div className="cd-empty-acts">
                <button className="btn btn--primary btn--lg" type="button"><Ic d={PLUS} size={14} />New canvas</button>
                <button className="btn btn--ghost btn--lg cd-ask" type="button"><Spark size={12} color="var(--spark)" />Ask AI</button>
              </div>
            </div>
          </div>
        </div>

        <h2 data-no>Right and wrong</h2>
        <div className="cd-compare">
          <figure className="cd-case">
            <div className="cd-case-slot"><Card c={{ name: "Homepage", art: "home", meta: "Edited 2 min ago by Tereza", people: ["T"] }} /></div>
            <figcaption><strong className="cd-ok">Right</strong> The picture, the name, a plain time and a face. Everything technical waits under Advanced in the canvas's own panel.</figcaption>
          </figure>
          <figure className="cd-case">
            <div className="cd-case-slot">
              <article className="cd-card cd-wrong">
                <div className="cd-thumb cd-wrong-thumb"><span className="cd-wrong-stamp">IDLE</span></div>
                <div className="cd-body">
                  <strong className="cd-wrong-mono">ui/homepage.tsx</strong>
                  <span className="cd-meta cd-wrong-mono">a3f9c21 · main · 2026-10-05T19:42</span>
                </div>
              </article>
            </div>
            <figcaption><strong className="cd-bad">Wrong</strong> A file path for a name, a commit and a branch for a time, a status stamp on the picture. Nobody recognises their work from this.</figcaption>
          </figure>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · cards</span>
        <span>Thumbnail-first · loading card lives in skeletons.tsx</span>
      </footer>
    </>
  );
}
