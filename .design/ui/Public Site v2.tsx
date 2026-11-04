/**
 * @canvas      Public Site v2
 * @ds          maude-v2
 * @platform    desktop
 * @kind        canvas
 * @stack       React 19 · TSX · Bun.build
 * @history     .design/_history/ui-public_site_v2
 *
 * A blank canvas (V2 S6.1): an empty DesignCanvas, no artboards, no content. ⌘N makes this, and
 * so does Home's "Start with an empty canvas". The first thing on it is whatever the person
 * (or AI) adds — an artboard (F), a sticky, or a sentence in the AI chat panel.
 *
 * To add an artboard, put a <DCSection> inside <DesignCanvas> and a <DCArtboard> in that. Give
 * each artboard a stable id, a label, and a width/height — and a `kind` when it is not a digital
 * screen. Capture-safe by construction: it imports the canvas library and nothing else.
 */

// The v2 canvases import their system explicitly: the export/capture path does not inject maude-v2 for a ui canvas.
import "../system/maude-v2/colors_and_type.css";
import "../system/maude-v2/preview/_components.css";
import "./v2/_kit.css";
import "./Public Site v2.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import { Fragment, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  AIPanel, Artboard, Avatar, Canvas, Cursor, HeroMock, Icon, Kbd, Mark, PhoneMock, ProjectPill,
  ShareCluster, Spark, Sticky, TABS, Thumb, Toolbar, V2, Window, ZoomUndo,
} from "./v2/_kit";

/** A timed entrance: `d` is the delay in ms on the page's intro clock (see the motion board). */
const at = (d: number): CSSProperties => ({ ["--d" as string]: `${d}ms` });

/* ═══ Shared site pieces ═══════════════════════════════════════════════════════════════════════
   Three links and two buttons (UX research: Product · Docs · Pricing). What's new moves into the
   release chip and a teaser above the footer; Changelog, Roadmap, About and the coffee live in the
   footer; "Advanced" is the second door inside Docs. */

type Page = "product" | "docs" | "cloud";

function SiteNav({ on, quietBuy = false, main }: { on?: Page; /** id of the page's <main>, for the skip link */ main: string; /** Home's hero owns the primary (Download); the nav's buy button steps back until the hero scrolls away. */ quietBuy?: boolean }) {
  const links: [Page, string][] = [["product", "Product"], ["docs", "Docs"], ["cloud", "Pricing"]];
  return (
    <header className="ps-nav-row">
      <a className="ps-skip" href={`#${main}`}>Skip to content</a>
      <nav className="island ps-nav" aria-label="Main">
        <a className="ps-brand" href="/"><Mark size={24} /> maude</a>
        <span className="ps-links">
          {links.map(([id, t]) => <a key={id} className="ps-link" data-on={on === id ? "true" : undefined} aria-current={on === id ? "page" : undefined} href="#">{t}</a>)}
        </span>
        <span className="ps-nav-end">
          <a className="ps-gh" href="https://github.com/1aGh/maude">GitHub</a>
          <a className="btn btn--ghost btn--sm" href="/desktop">Download</a>
          <a className={`btn btn--sm ${quietBuy ? "" : "btn--primary"}`} href="/cloud">Get Maude Cloud</a>
        </span>
      </nav>
    </header>
  );
}

function SiteFoot() {
  const cols: [string, string[]][] = [
    ["Product", ["Download for Mac", "Maude Cloud", "Pricing", "What's new", "Maude vs Figma"]],
    ["Docs", ["Getting started", "Using Maude", "Advanced", "Recipes"]],
    ["Project", ["GitHub", "Changelog", "Roadmap", "About", "Buy me a coffee"]],
    ["Legal", ["Terms", "Privacy", "Data processing"]],
  ];
  return (
    <footer className="ps-foot">
      <div className="ps-wrap">
        <div className="ps-foot-grid">
          <div className="ps-foot-col">
            <a className="ps-brand" href="/" style={{ fontSize: "var(--type-xl)" }}><Mark size={40} /> maude</a>
            <p className="ps-small">A design canvas built around AI. Free and open-source, made in Brno by Michal.</p>
          </div>
          {cols.map(([h, items]) => (
            <div key={h} className="ps-foot-col">
              <b>{h}</b>
              {items.map((i) => <a key={i} href="#">{i}</a>)}
            </div>
          ))}
        </div>
        <div className="ps-foot-base"><span>MIT license · no telemetry</span><span>maude.sh</span></div>
      </div>
    </footer>
  );
}

function Tick({ no = false, children }: { no?: boolean; children: ReactNode }) {
  return <li><span className={no ? "ps-x" : "ps-t"}><Icon name={no ? "close" : "check"} size={14} /></span><span>{children}</span></li>;
}

/* The intro clock (ms), shared by the hero and the motion board — one source for both. */
const T = {
  line1: 0, line2: 90, line3: 360, spark: 520, lede: 500, ctas: 620, shot: 760,
  ask: 1300, reply: 1800, working: 2100, cursor: 2100, card1: 2700, card2: 2820, card3: 2940,
  prices: 3260, done: 3700, sticky: 3900,
};

/** One pricing card the AI draws on the Pricing artboard in the product shot. */
function RunCard({ left, price, pick = false, d }: { left: number; price: string; pick?: boolean; d: number }) {
  return (
    <span className="ps-run-card ps-a ps-a--draw" data-pick={pick ? "true" : undefined} style={{ left, height: pick ? 176 : 156, ...at(d) }}>
      <i style={{ width: "60%" }} />
      <b className="ps-a ps-a--fade" style={at(T.prices)}>{price}</b>
      <i /><i style={{ width: "80%" }} /><i style={{ width: "70%" }} />
      <span className="ps-run-btn" style={{ marginTop: "auto" }} />
    </span>
  );
}

/** The product shot plays one scripted AI run on load (UX research: product-shot-ai-run), then offers Replay.
 *  Reduced motion: the final frame only — cards drawn, the run done, Tereza's sticky placed. */
function HeroShot() {
  const [run, setRun] = useState(0);
  return (
    <div className="ps-shot-wrap">
      {/* The window's entrance plays once; Replay restarts only the AI run inside it (run 1+ starts at once). */}
      <div className="ps-shot ps-a ps-a--shot" style={at(T.shot)}>
      <div key={run} style={{ display: "contents", ["--t0" as string]: run ? `${T.ask - 150}ms` : "0ms" }}>
        <Window tabs={[TABS.studio, TABS.alligators]} activeTab={0} label="Maude with the Studio site project open: AI draws a pricing page while Tereza leaves a sticky">
          <Canvas>
            <Artboard label="Home · Web desktop" kind="web" x={56} y={92} w={420} h={292}><HeroMock /></Artboard>
            <Artboard label="Pricing · Web desktop" kind="web" x={512} y={92} w={300} h={292}>
              <span style={{ position: "absolute", left: 20, top: 22, right: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <span className="ps-a ps-a--fade" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "var(--type-md)", ...at(T.card1 - 120) }}>Simple pricing</span>
                <span className="ps-a ps-a--fade" style={{ fontSize: 10, color: "var(--fg-2)", ...at(T.card1) }}>Monthly · Yearly</span>
              </span>
              <RunCard left={22} price="€0" d={T.card1} />
              <RunCard left={112} price="€19" pick d={T.card2} />
              <RunCard left={202} price="€99" d={T.card3} />
            </Artboard>
            <Artboard label="Home · Mobile" kind="web" x={56} y={420} w={136} h={190}><PhoneMock title="Studio site" tone="sky" /></Artboard>
            <Artboard label="Post 1:1" kind="digital" x={228} y={420} w={190} h={190} aiMade="Made by AI"><Thumb art="brand" w={190} h={190} /></Artboard>

            {/* The run on the Pricing artboard: a spark ring + tag while it works, a quiet "Made by AI" after. */}
            <span className="ps-a ps-a--on" style={at(T.working)}><span className="ps-a ps-a--out" style={at(T.done)}>
              <span className="ps-run-ring" style={{ left: 508, top: 88, width: 308, height: 300 }} />
              <span className="ps-run-tag ps-run-tag--work" style={{ left: 660, top: 64 }}><Spark size={10} color="currentColor" /> AI is drawing</span>
            </span></span>
            <span className="ps-run-tag ps-run-tag--done ps-a ps-a--on" style={{ left: 712, top: 66, ...at(T.done) }}><Spark size={10} /> Made by AI</span>
            <span className="ps-float ps-a ps-a--glide" style={{ left: 0, top: 0, ["--fx" as string]: "260px", ["--fy" as string]: "180px", ...at(T.cursor) }}>
              <Cursor name="AI" agent x={744} y={262} />
            </span>

            {/* Only the sticky moves: a box the sticky's own size, not a full-canvas layer. */}
            <div className="ps-a ps-a--land" style={{ position: "absolute", left: 540, top: 432, width: 180, ...at(T.sticky) }}>
              <Sticky color="yellow" x={0} y={0} rotate={-2} w={180}>Can the yearly price sit next to the monthly one?</Sticky>
            </div>
            <Cursor name="tereza" x={694} y={524} />
          </Canvas>
          <ProjectPill project="Studio site" canvas="Landing page" />
          <ShareCluster people={["tereza", "jonas"]} status="saved" mode="edit" />
          <ZoomUndo zoom={42} />
          <Toolbar />
          <AIPanel chat="Pricing page" scope="Pricing · Web desktop"
            messages={[
              { from: "you", text: <span className="ps-a ps-a--fade" style={at(T.ask)}>Make a pricing page with three plans. Use Tereza's yearly note.</span> },
              { from: "ai", text: <span className="ps-a ps-a--fade" style={at(T.reply)}>Three cards on the Pricing artboard, monthly and yearly side by side.</span> },
            ]}>
            <span className="ps-a ps-a--on" style={at(T.working)}><span className="ps-a ps-a--out k-ai-msg" style={{ display: "flex", gap: 6, alignItems: "center", color: "var(--spark-text)", ...at(T.done) }}><Spark size={12} /> AI is drawing the pricing cards</span></span>
            <p className="k-ai-msg k-ai-msg--ai ps-a ps-a--on" style={at(T.done)}>Done. Pricing has three plans, and the yearly price sits under each monthly one.</p>
          </AIPanel>
        </Window>
      </div>
      </div>
      <button type="button" className="ps-replay" style={at(T.sticky + 600)} onClick={() => setRun((n) => n + 1)}><Icon name="play" size={14} /> Replay</button>
    </div>
  );
}

/* ═══ The interactive hero ═══════════════════════════════════════════════════════════════════
   The headline is a selected text layer on the canvas. Ask Maude for a rewrite and it plays a
   short scripted AI run on it (UX research: hero-you-can-touch); ⌘Z puts the first one back.
   The stickies drag like they would in the app. Reduced motion: the rewrite swaps at once. */

type Head = { id: string; ask: string; lang?: string; lines: { t: string; quiet?: boolean }[] };
const HEADS: Head[] = [
  { id: "start", ask: "", lines: [{ t: "You like Figma.", quiet: true }, { t: "You like Claude.", quiet: true }, { t: "Meet Maude." }] },
  { id: "bold", ask: "Make it bolder", lines: [{ t: "Design with AI." }, { t: "Own every pixel.", quiet: true }] },
  { id: "mum", ask: "Say it so my mum gets it", lines: [{ t: "Draw it yourself.", quiet: true }, { t: "Or just ask.", quiet: true }, { t: "Either way, it's real." }] },
  { id: "cs", ask: "Now in Czech", lang: "cs", lines: [{ t: "Líbí se ti Figma.", quiet: true }, { t: "Líbí se ti Claude.", quiet: true }, { t: "Tohle je Maude." }] },
];

/** The weight bubble: letters near the pointer grow from semibold to heavy, a small lens that follows
 *  the mouse. The radius is a multiple of the glyph height, so it reads the same at any canvas zoom.
 *  No pointer (touch, keyboard, a capture): the headline simply stays semibold. */
function useWeightBubble() {
  const ref = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const chars = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(".ps-ch") ?? []);
  const move = (e: { clientX: number; clientY: number }) => {
    const { clientX: x, clientY: y } = e;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      for (const el of chars()) {
        const r = el.getBoundingClientRect();
        const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
        const k = Math.max(0, 1 - d / (r.height * 1.3));
        el.style.fontWeight = k ? String(Math.round(600 + 300 * k * k * (3 - 2 * k))) : "";
      }
    });
  };
  const leave = () => { cancelAnimationFrame(raf.current); for (const el of chars()) el.style.fontWeight = ""; };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return { ref, onPointerMove: move, onPointerLeave: leave };
}

/** One headline line split into letters for the bubble; the letters are hidden from screen readers, the line is not. */
function BubbleLine({ text }: { text: string }) {
  return (
    <>
      <span className="ps-sr">{text}</span>
      <span aria-hidden="true">{Array.from(text).map((c, i) => <span key={i} className="ps-ch">{c}</span>)}</span>
    </>
  );
}

function HeroHeadline() {
  const [ver, setVer] = useState(0);
  const [gen, setGen] = useState(0);
  const [byAI, setByAI] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const ask = (i: number) => {
    if (busy !== null || i === ver) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setBusy(i);
    timer.current = window.setTimeout(() => { setVer(i); setGen((g) => g + 1); setByAI(true); setBusy(null); }, still ? 0 : 1100);
  };
  const undo = () => { if (busy !== null || ver === 0) return; setVer(0); setGen((g) => g + 1); setByAI(false); };
  const h = HEADS[ver];
  const first = [T.line1, T.line2, T.line3];
  const bubble = useWeightBubble();
  return (
    <div className="ps-play">
      <div className="ps-layer ps-bubble" data-busy={busy !== null ? "true" : undefined} {...bubble}>
        <i /><i /><i /><i />
        <span className="ps-layer-tag ps-a ps-a--pop" data-ai={busy !== null || byAI ? "true" : undefined} style={at(T.spark)} aria-hidden="true">
          {busy !== null ? <><Spark size={10} color="currentColor" /> AI is rewriting</> : byAI ? <><Spark size={10} color="currentColor" /> Made by AI</> : "Text · Display"}
        </span>
        <h1 key={gen} id="h-home" className="ps-h1" lang={h.lang}>
          {h.lines.map((l, j) => (
            <Fragment key={j}>
              <span className={`${l.quiet ? "ps-quiet " : ""}ps-a`} style={{ display: "inline-block", ...at(gen === 0 ? first[j] : j * 90) }}><BubbleLine text={l.t} /></span>
              {j < h.lines.length - 1 ? <br /> : null}
            </Fragment>
          ))}
        </h1>
      </div>
      <div className="island ps-ask ps-a" role="group" aria-label="Ask Maude to rewrite the headline" style={at(T.ctas + 200)}>
        <span className="ps-ask-lead"><Spark size={14} /> Ask Maude</span>
        {HEADS.slice(1).map((v, k) => (
          <button key={v.id} type="button" className="ps-ask-chip" aria-pressed={ver === k + 1} aria-disabled={busy !== null || undefined} onClick={() => ask(k + 1)}>{v.ask}</button>
        ))}
        <button type="button" className="ps-ask-undo" aria-label="Undo the rewrite" aria-disabled={ver === 0 || busy !== null || undefined} onClick={undo}><Kbd>⌘Z</Kbd></button>
      </div>
      <span className="ps-fine" style={{ fontSize: "var(--type-xs)", marginTop: "calc(-1 * var(--space-3))" }}>A scripted demo. In the app, the AI runs on your own Claude account.</span>
      <span className="ps-sr" aria-live="polite">{busy !== null ? "AI is rewriting the headline." : gen > 0 ? `New headline: ${h.lines.map((l) => l.t).join(" ")}` : ""}</span>
    </div>
  );
}

/** A sticky the visitor can drag around the hero, like on a real canvas. Decorative, so mouse and touch only. */
function DragFloat({ style, children }: { style: CSSProperties; children: ReactNode }) {
  const [p, setP] = useState({ x: 0, y: 0 });
  const from = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  return (
    <div className="ps-float ps-drag" style={{ ...style, translate: `${p.x}px ${p.y}px` }} aria-hidden="true"
      onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); from.current = { x: e.clientX, y: e.clientY, px: p.x, py: p.y }; }}
      onPointerMove={(e) => { const f = from.current; if (f) setP({ x: f.px + e.clientX - f.x, y: f.py + e.clientY - f.y }); }}
      onPointerUp={() => { from.current = null; }}>
      {children}
    </div>
  );
}

/* ═══ Good ol' HTML ═══════════════════════════════════════════════════════════════════════════
   The file story for people who never opened one: a private format vs the web's own language,
   told in four short beats, with a slider that wipes the design into the file behind it. */

function PlainHtml() {
  const [pos, setPos] = useState(42);
  return (
    <section className="ps-wrap ps-section" aria-labelledby="h-html">
      <div className="ps-html">
        <div className="ps-head" style={{ marginBottom: 0 }}>
          <span className="ps-eyebrow">No secret file format</span>
          <h2 id="h-html" className="ps-h2">Good ol' HTML.<br /><span className="ps-quiet">The AI knows it best.</span></h2>
          <ol className="ps-story">
            <li><span className="ps-num">1</span><p className="ps-body"><b>Most design tools keep your work in their own format.</b> Only their app can open it. Leave, and the work stays behind.</p></li>
            <li><span className="ps-num">2</span><p className="ps-body"><b>Maude saves designs the way the web has been written for 30 years.</b> HTML and CSS, the stuff every website is made of.</p></li>
            <li><span className="ps-num">3</span><p className="ps-body"><b>That's the language AI grew up on.</b> It has read more web pages than anyone ever will. Ask for a change and it isn't decoding a strange file. It's writing in its mother tongue.</p></li>
            <li><span className="ps-num">4</span><p className="ps-body"><b>So the design is already the real thing.</b> A developer ships it as it is, instead of rebuilding it from a picture.</p></li>
          </ol>
        </div>
        <div className="ps-html-demo">
          <div className="ps-wipe" style={{ ["--pos" as string]: `${pos}%` }}>
            <div className="ps-wipe-see">
              <article className="ps-wipe-card">
                <span className="ps-small">Cloud Project</span>
                <span className="ps-wipe-price"><b>€19</b> a month</span>
                <ul className="ps-ticks"><Tick>Everyone you invite</Tick><Tick>Full history</Tick></ul>
                <span className="btn btn--primary">Get started</span>
              </article>
            </div>
            <pre className="ps-code ps-wipe-file" aria-hidden="true">{`<article className="plan">
  <span>Cloud Project</span>
  <p className="price">
    <b>€19</b> a month
  </p>
  <ul>
    <li>Everyone you invite</li>
    <li>Full history</li>
  </ul>
  <a className="button">Get started</a>
</article>`}</pre>
            <span className="ps-wipe-bar" aria-hidden="true"><span className="ps-wipe-knob">‹ ›</span></span>
            <span className="ps-wipe-l" aria-hidden="true">What you see</span>
            <span className="ps-wipe-r" aria-hidden="true">Pricing.tsx</span>
            <input className="ps-wipe-range" type="range" min={22} max={78} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Slide from the design to the file behind it" />
          </div>
          <div className="ps-vs">
            <div className="ps-vs-cell">
              <span className="ps-who">A private format</span>
              <span className="ps-bytes" aria-hidden="true">PK▒▒ ▓░ 0x7f ▒▓▒░ ▓▒ ░░▓ 0x1c ▒▓</span>
              <span className="ps-small"><Icon name="lock" size={12} /> Opens in one app</span>
            </div>
            <div className="ps-vs-cell" data-on="true">
              <span className="ps-who" style={{ color: "var(--accent-text)" }}>Maude</span>
              <span className="ps-vs-plain">&lt;b&gt;€19&lt;/b&gt; a month</span>
              <span className="ps-small"><Icon name="check" size={12} /> Opens in any editor, browser or AI</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══ What Maude can do ══════════════════════════════════════════════════════════════════════
   The big features in one bento, each with a small picture of itself. Only shipped features, named
   the way the What's new feed names them (apps/studio/whats-new.json). */

function Feat({ wide = false, icon, title, children, pic, ai = false }: { wide?: boolean; icon: string; title: string; children: ReactNode; pic: ReactNode; ai?: boolean }) {
  return (
    <article className="ps-card ps-feat ps-r" data-wide={wide ? "true" : undefined}>
      <div className="ps-feat-pic" aria-hidden="true">{pic}</div>
      <div className="ps-feat-txt">
        <h3 className="ps-h3"><span className={`ps-ico${ai ? " ps-ico--ai" : ""}`}>{ai ? <Spark size={14} /> : <Icon name={icon} size={14} />}</span>{title}</h3>
        <p className="ps-small">{children}</p>
      </div>
    </article>
  );
}

function Features() {
  return (
    <section className="ps-wrap ps-section--tight" aria-labelledby="h-feat">
      <div className="ps-head ps-center">
        <span className="ps-eyebrow">What Maude can do</span>
        <h2 id="h-feat" className="ps-h2">One canvas. Screens, reels,<br />slides and print.</h2>
      </div>
      <div className="ps-bento">
        <Feat wide ai icon="video" title="AI video editing" pic={
          <div className="fp-video">
            <span className="fp-frame"><Thumb art="video" /><span className="fp-cap">“and that's the whole trick”</span></span>
            <span className="fp-track">{[18, 26, 14, 22, 20].map((w, i) => <i key={i} style={{ flex: w }} />)}</span>
            <span className="fp-track fp-track--audio">{Array.from({ length: 36 }, (_, i) => <i key={i} style={{ height: `${30 + ((i * 37) % 60)}%` }} />)}</span>
            <span className="fp-head" style={{ left: "46%" }} />
          </div>}>
          Drop in raw clips. AI watches them, picks the good moments and cuts a reel with captions, music and transitions. Then fine-tune it on a timeline.
        </Feat>
        <Feat icon="print" title="Print-ready" pic={
          <div className="fp-print"><span className="fp-paper"><b>Open studio</b><i /><i /></span><span className="fp-crop" /></div>}>
          Flyers, posters and business cards, exported as PDFs a print shop will accept.
        </Feat>
        <Feat icon="pulse" title="Interactive prototypes" pic={
          <div className="fp-proto"><span className="fp-phone"><i /><span className="fp-btn">Sign up</span></span><span className="fp-arrow" /><span className="fp-phone"><i /><b>Welcome!</b></span><span className="fp-tap" /></div>}>
          A design is real code, so buttons click, forms type and a whole user flow plays, before anyone builds it.
        </Feat>
        <Feat icon="play" title="Present" pic={
          <div className="fp-present"><span className="fp-slide"><b>Q4 launch</b><i /></span><span className="fp-count">3 / 8</span></div>}>
          Preview, Edit and Present in one switch. Your artboards, full screen, straight from the canvas.
        </Feat>
        <Feat icon="people" title="Work together, live" pic={
          <div className="fp-multi">
            <span className="fp-board" />
            <Cursor name="tereza" x={40} y={34} /><Cursor name="jonas" x={74} y={104} />
            <Sticky color="yellow" x={168} y={22} rotate={3} w={88}>Bigger logo?</Sticky>
          </div>}>
          Everyone in the same version at once: cursors, stickies and comments that stay where you put them.
        </Feat>
        <Feat wide ai icon="system" title="A design system from a moodboard" pic={
          <div className="fp-mood">
            <span className="fp-tiles"><i style={{ background: "var(--object-lilac)" }} /><i style={{ background: "var(--object-sky)" }} /><i style={{ background: "var(--object-yellow)" }} /><i style={{ background: "var(--object-green)" }} /></span>
            <span className="fp-to" />
            <span className="fp-ds"><b>Aa</b><span className="fp-sw"><i /><i /><i /><i /></span><span className="fp-btns"><span className="btn btn--primary btn--sm">Button</span><span className="btn btn--sm">Button</span></span></span>
          </div>}>
          Describe your brand. AI researches the field, shows moodboard directions to pick from, then builds the colours, type, components and logo. Critics check it before you see it.
        </Feat>
        <Feat ai icon="image" title="AI images, music and voice" pic={
          <div className="fp-gen"><span className="fp-img"><Thumb art="brand" w={120} h={120} /></span><span className="fp-wave">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ height: `${25 + ((i * 53) % 70)}%` }} />)}</span></div>}>
          Generate pictures, clips, music, voiceover and subtitles with your own AI key, placed right on the canvas.
        </Feat>
        <Feat icon="insert" title="Bring your Figma work" pic={
          <div className="fp-import"><span className="fp-file">Brand.fig</span><span className="fp-to" /><span className="fp-art" /></div>}>
          Import a Figma file, no Figma account needed. Fonts and boards come along, and artboards turn editable.
        </Feat>
        <Feat icon="crop" title="Photo editing" pic={
          <div className="fp-photo"><span className="fp-pic"><Thumb art="brand" w={150} h={120} /></span><span className="fp-cut" /></div>}>
          Adjust and retouch photos right on the canvas, or remove a background in one click.
        </Feat>
        <Feat icon="export" title="Export anywhere" pic={
          <div className="fp-exp">{["PNG", "PDF", "Slides", "MP4", "Lottie", "Code"].map((t) => <span key={t} className="chip">{t}</span>)}</div>}>
          Images, documents, slides, video, Lottie animations, or a handoff a developer can drop into the app.
        </Feat>
      </div>
    </section>
  );
}

/* ═══ 1 · Home ══════════════════════════════════════════════════════════════════════════════ */

function HomePage() {
  return (
    <V2 className="ds ps-page">
      <SiteNav on="product" quietBuy main="main-home" />
      <main id="main-home">

      {/* The hero sits ON the canvas: the headline is a selected text layer, people and the AI are around it. */}
      <section className="ps-wrap ps-hero ps-stage" aria-labelledby="h-home">
        <DragFloat style={{ left: 40, top: 150 }}>
          <div className="ps-a ps-a--fade" style={at(T.ctas)}><Sticky color="lilac" x={0} y={0} rotate={-4} w={150}>Go on, drag me. It's a canvas.</Sticky></div>
        </DragFloat>
        <DragFloat style={{ right: 56, top: 120 }}>
          <div className="ps-a ps-a--fade" style={at(T.ctas + 120)}><Sticky color="green" x={0} y={0} rotate={3} w={132}>Ship it ✓</Sticky></div>
        </DragFloat>
        <div className="ps-float ps-a ps-a--fade" style={{ left: 200, top: 330, ...at(T.ctas + 80) }} aria-hidden="true"><Cursor name="tereza" x={0} y={0} /></div>
        <div className="ps-float ps-a ps-a--glide" style={{ right: 250, top: 300, ["--fx" as string]: "120px", ["--fy" as string]: "-60px", ...at(T.spark) }} aria-hidden="true"><Cursor name="AI" agent x={0} y={0} /></div>

        <div className="ps-hero-copy">
          <a className="ps-announce ps-a ps-a--fade" href="/whats-new" style={at(0)}>
            <b>Maude 2 is here</b> The canvas fills the window, and AI shows its work
            <span className="ps-announce-go">See what's new <Icon name="submenu" size={12} /></span>
          </a>
          <HeroHeadline />
          <p className="ps-lede ps-a" style={at(T.lede)}>
            A design canvas built around AI, not bent to fit one. Draw it yourself or ask AI. Every design is a real file, in a project that is yours.
          </p>
          <div className="ps-row ps-a" style={{ justifyContent: "center", ...at(T.ctas) }}>
            <a className="btn btn--primary btn--lg" href="/desktop">Download for Mac · free</a>
            <a className="btn btn--lg" href="/cloud">Try Maude Cloud</a>
          </div>
          <span className="ps-fine ps-a ps-a--fade" style={at(T.ctas + 100)}>macOS app, free and open-source. Maude Cloud from €19 a month per project, for the whole team.</span>
        </div>
      </section>

      <div className="ps-wrap"><HeroShot /></div>

      {/* Honest proof for a young indie tool: what can be checked, no borrowed logos. */}
      <div className="ps-wrap ps-proof" aria-label="Facts about Maude">
        <span><Icon name="history" size={16} /> <b>145 releases</b> since May 2026</span>
        <span><Icon name="file" size={16} /> <b>MIT</b> license, source on GitHub</span>
        <span><Icon name="eye-off" size={16} /> <b>No telemetry</b>, no signup to start</span>
        <span><Mark size={16} /> Made in <b>Brno</b></span>
      </div>

      {/* The one argument, in three cards: Figma's canvas + Claude's AI = Maude. */}
      <section className="ps-wrap ps-section" aria-labelledby="h-why">
        <div className="ps-head ps-center">
          <span className="ps-eyebrow">Why Maude</span>
          <h2 id="h-why" className="ps-h2">A real canvas and a real AI. Finally on speaking terms.</h2>
        </div>
        <div className="ps-trio">
          <div className="ps-card ps-card--flat ps-r">
            <span className="ps-who">From design tools</span>
            <h3 className="ps-h3">A real canvas</h3>
            <ul className="ps-ticks">
              <Tick>Artboards for apps, web pages, social, print and video</Tick>
              <Tick>Shape, Pen, Text, Frame and Components</Tick>
              <Tick>Stickies, comments and Present</Tick>
            </ul>
          </div>
          <span className="ps-plus ps-r ps-r--fade" aria-hidden="true">+</span>
          <div className="ps-card ps-card--flat ps-r">
            <span className="ps-who">From Claude</span>
            <h3 className="ps-h3">An AI that does the work</h3>
            <ul className="ps-ticks">
              <Tick>Select anything, press <Kbd>⌘/</Kbd>, say what you want</Tick>
              <Tick>It draws on the artboard while you watch</Tick>
              <Tick>One <Kbd>⌘Z</Kbd> takes back a whole AI run</Tick>
            </ul>
          </div>
          <span className="ps-plus ps-r ps-r--fade" aria-hidden="true">=</span>
          <div className="ps-card ps-card--you ps-r">
            <span className="ps-who" style={{ color: "var(--accent-text)" }}>Maude</span>
            <h3 className="ps-h3">Both, and the work stays yours</h3>
            <ul className="ps-ticks">
              <Tick>Every design is a real file, not a cloud blob</Tick>
              <Tick>Your design system checks new work</Tick>
              <Tick>Version history with Restore, on every canvas</Tick>
              <Tick>Free to self-host, the same software</Tick>
            </ul>
          </div>
        </div>
        <div className="ps-works">
          <span>Works with what you already use:</span>
          <span className="chip">Your own Claude account</span>
          <span className="chip"><Icon name="terminal" size={12} /> Claude Code</span>
          <span className="chip">Git and GitHub</span>
          <span className="chip">Codex</span>
        </div>
      </section>

      <section className="ps-wrap ps-section--tight" aria-labelledby="h-how">
        <div className="ps-head">
          <span className="ps-eyebrow">How it feels</span>
          <h2 id="h-how" className="ps-h2">Feels like a design tool. Works like a teammate.</h2>
        </div>
        <div className="ps-grid-3">
          <article className="ps-card ps-tile">
            <div className="ps-tile-pic">
              <span className="ps-mini-board" style={{ left: 40, top: 32, width: 220, height: 132 }}><Thumb art="price" /></span>
              <span className="ps-mini-ring" style={{ left: 36, top: 28, width: 228, height: 140 }} />
              <span className="ps-mini-tag" style={{ left: 168, top: 14 }}><Spark size={10} /> AI is drawing</span>
              <span className="island ps-mini-ask" style={{ left: 64, top: 166 }}>Make the price bigger<span className="ps-send"><Icon name="arrow" size={12} /></span></span>
            </div>
            <div className="ps-tile-txt">
              <h3 className="ps-h3">Draw it, or ask for it</h3>
              <p className="ps-body">The tools you expect are all there. When typing is faster than drawing, ask AI about the thing you selected.</p>
            </div>
          </article>
          <article className="ps-card ps-tile">
            <div className="ps-tile-pic">
              <span className="ps-check-row" style={{ left: 32, top: 34 }}><span className="ps-t"><Icon name="check" size={14} /></span> Colours from your system</span>
              <span className="ps-check-row" style={{ left: 64, top: 86 }}><span className="ps-t"><Icon name="check" size={14} /></span> Type scale, spacing, radii</span>
              <span className="ps-check-row" style={{ left: 40, top: 138 }}><span className="ps-w"><Icon name="problem" size={14} /></span> Button text 3.1:1, raise it to 4.5</span>
            </div>
            <div className="ps-tile-txt">
              <h3 className="ps-h3">Your design system, on every artboard</h3>
              <p className="ps-body">Colours, type and components come from your own system. New work is checked against it, so drafts stay on brand.</p>
            </div>
          </article>
          <article className="ps-card ps-tile">
            <div className="ps-tile-pic">
              <span className="ps-mini-board" style={{ left: 36, top: 36, width: 190, height: 140 }}><Thumb art="home" /></span>
              <Sticky color="lilac" x={200} y={52} rotate={3} w={120}>Love this hero</Sticky>
              <Sticky color="green" x={250} y={118} rotate={-2} w={96}>Ship it</Sticky>
              <span style={{ position: "absolute", left: 44, top: 186, display: "flex", gap: 4 }}><Avatar who="tereza" size="sm" /><Avatar who="jonas" size="sm" /></span>
            </div>
            <div className="ps-tile-txt">
              <h3 className="ps-h3">Share a link, talk on the canvas</h3>
              <p className="ps-body">Invite people to a project. They leave stickies and comments in Preview, and you present straight from the canvas.</p>
            </div>
          </article>
        </div>
      </section>

      <Features />

      <section className="ps-wrap ps-section" aria-labelledby="h-yours">
        <div className="ps-yours">
          <div className="ps-head" style={{ marginBottom: 0 }}>
            <span className="ps-eyebrow">It's yours</span>
            <h2 id="h-yours" className="ps-h2">Like Figma. Except it's yours.</h2>
            <p className="ps-lede">Canvases are plain files in a folder you own. Keep them on your Mac, in Git, or in Maude Cloud, and take them with you whenever you want.</p>
            <div className="ps-facts" style={{ marginTop: "var(--space-4)" }}>
              <div className="ps-fact"><span className="ps-ico"><Icon name="file" size={16} /></span><div><b>Real files</b><p className="ps-small">Each canvas is a .tsx file a developer can ship.</p></div></div>
              <div className="ps-fact"><span className="ps-ico"><Icon name="history" size={16} /></span><div><b>Version history</b><p className="ps-small">Every change is kept, with Restore.</p></div></div>
              <div className="ps-fact"><span className="ps-ico"><Icon name="server" size={16} /></span><div><b>Self-host for free</b><p className="ps-small">The same software, on your own box.</p></div></div>
              <div className="ps-fact"><span className="ps-ico"><Icon name="lock" size={16} /></span><div><b>Open-source</b><p className="ps-small">MIT license, no telemetry, no signup.</p></div></div>
            </div>
          </div>
          <div className="ps-files" aria-label="A Maude project's files">
            <span className="ps-file"><Icon name="folder" size={14} /> studio-site</span>
            <span className="ps-file" style={{ paddingLeft: 24 }}><Icon name="folder" size={14} /> .design</span>
            <span className="ps-file" style={{ paddingLeft: 40 }}><Icon name="folder" size={14} /> system <span className="ps-meta">your design system</span></span>
            <span className="ps-file" style={{ paddingLeft: 40 }}><Icon name="folder" size={14} /> ui</span>
            <span className="ps-file" data-on="true" style={{ paddingLeft: 56 }}><Icon name="file" size={14} /> Landing page.tsx <span className="ps-meta">edited by AI · 2 min ago</span></span>
            <span className="ps-file" style={{ paddingLeft: 56 }}><Icon name="file" size={14} /> Pricing.tsx <span className="ps-meta">Tereza · today</span></span>
            <span className="ps-file" style={{ paddingLeft: 56 }}><Icon name="file" size={14} /> Launch post.tsx <span className="ps-meta">you · yesterday</span></span>
            <span className="ps-file" style={{ paddingLeft: 24 }}><Icon name="folder" size={14} /> src <span className="ps-meta">the real app</span></span>
          </div>
        </div>
      </section>

      <PlainHtml />

      {/* The Buy CTA: one dark band, the price in the open, two actions. */}
      <section className="ps-wrap ps-section--tight" aria-labelledby="h-cloud">
        <div className="ps-band">
          <div className="ps-head" style={{ marginBottom: 0 }}>
            <span className="ps-eyebrow" style={{ color: "var(--bg-3)", fontSize: "var(--type-md)", gap: "var(--space-3)" }}><Mark size={44} /> Maude Cloud</span>
            <h2 id="h-cloud" className="ps-h2">Invite everyone. Pay for the project.</h2>
            <p className="ps-body">Your project online with its own address. Invite everyone who needs it, never pay per seat, and they open it in the app or the browser.</p>
            <div className="ps-row" style={{ marginTop: "var(--space-3)" }}>
              <a className="btn btn--primary btn--lg" href="/cloud">Get Maude Cloud</a>
              <a className="btn btn--ghost btn--lg" href="/cloud#pricing">See pricing</a>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
            <div className="ps-band-price"><b>€19</b><span>a month per project</span></div>
            <ul className="ps-band-list">
              <li><Icon name="people" size={14} /> Everyone you invite is included</li>
              <li><Icon name="history" size={14} /> Full history and one-click export</li>
              <li><Icon name="sync" size={14} /> An automatic copy in your own GitHub</li>
            </ul>
            <span className="ps-fine">Private pilot. Prices without VAT. €190 a year, two months free. AI runs on your own Claude account.</span>
          </div>
        </div>
      </section>

      {/* Advanced keeps its own door: nothing from the old catalog is dropped. */}
      <section className="ps-wrap ps-section--tight" aria-labelledby="h-adv">
        <div className="ps-adv">
          <div className="ps-head" style={{ marginBottom: 0 }}>
            <span className="ps-chip-adv"><Icon name="terminal" size={12} /> Advanced</span>
            <h3 id="h-adv" className="ps-h3">Live in a terminal? It's all still here.</h3>
            <p className="ps-body">The Mac app runs on two Claude Code plugins and a CLI. Use them on their own, with the same files and the same design system.</p>
            <a className="btn btn--sm" href="/docs/advanced" style={{ alignSelf: "flex-start" }}>Open the Advanced docs</a>
          </div>
          <div className="ps-grid-2">
            <div className="ps-adv-item"><b>design</b><span className="ps-small">Canvases, critics and the dev server, in Claude Code.</span><span className="ps-mono">/plugin install design@maude</span></div>
            <div className="ps-adv-item"><b>flow</b><span className="ps-small">Plan, build and ship the whole feature.</span><span className="ps-mono">/plugin install flow@maude</span></div>
            <div className="ps-adv-item"><b>CLI</b><span className="ps-small">Scaffold, configure and run Maude from a shell.</span><span className="ps-mono">npm i -g @1agh/maude</span></div>
            <div className="ps-adv-item"><b>Self-hosted hub</b><span className="ps-small">Your team's server, on your own box.</span><span className="ps-mono">maude hub workspace-up</span></div>
          </div>
        </div>
      </section>

      {/* What's new: the changelog's home on Home, not a nav link. Titles from apps/studio/whats-new.json. */}
      <section className="ps-wrap ps-section--tight" aria-labelledby="h-rel">
        <div className="ps-row" style={{ justifyContent: "space-between", marginBottom: "var(--space-4)" }}>
          <h2 id="h-rel" className="ps-h3">What's new</h2>
          <a className="btn btn--ghost btn--sm" href="/changelog">All releases <Icon name="submenu" size={12} /></a>
        </div>
        <div className="ps-grid-3">
          {[
            ["2.0.0", "A new look: the canvas fills the window", "Everything else floats around it: one project menu, Home, a tab per project, Share and the AI chat panel."],
            ["2.0.0", "See what the AI is doing", "The chat says what AI is doing right now: reading a canvas, thinking, drawing an artboard."],
            ["2.0.0", "Setting up Claude shows what is happening", "Connecting your Claude account shows each step, and your browser opens to sign in by itself."],
          ].map(([v, t, d]) => (
            <a key={t} className="ps-card ps-rel" href="/whats-new">
              <span className="ps-rel-v"><span className="chip chip--accent">{v}</span> 3 Nov 2026</span>
              <b>{t}</b>
              <span className="ps-small">{d}</span>
            </a>
          ))}
        </div>
      </section>

      </main>
      <SiteFoot />
    </V2>
  );
}

/* ═══ 2 · Maude Cloud and pricing ═══════════════════════════════════════════════════════════
   Numbers from site/content/docs/cloud/pricing.mdx (private pilot, intended prices, net of VAT). */

function CloudPage() {
  return (
    <V2 className="ds ps-page">
      <SiteNav on="cloud" main="main-cloud" />
      <main id="main-cloud">

      <section className="ps-wrap ps-hero" aria-labelledby="h-cloudp">
        <span className="ps-pilot"><Icon name="cloud" size={14} /> Private pilot · these are the intended prices</span>
        <h1 id="h-cloudp" className="ps-h1" style={{ fontSize: "calc(var(--type-3xl) * 1.7)" }}>Your project online.<br /><span className="ps-quiet">For the whole team.</span></h1>
        <p className="ps-lede">Maude Cloud keeps your project on its own address, with people, roles and full history. Pay per project, never per seat, and invite everyone who needs it.</p>
      </section>

      <section id="pricing" className="ps-wrap" aria-labelledby="h-plans">
        <h2 id="h-plans" className="ps-h3" style={{ textAlign: "center", marginBottom: "var(--space-5)" }}>Pricing</h2>
        <div className="ps-plans">
          <article className="ps-card ps-plan">
            <span className="ps-who">Self-host</span>
            <div className="ps-price"><b>Free</b><span>forever</span></div>
            <p className="ps-body">The same software on your own box. Nothing taken out.</p>
            <ul className="ps-ticks">
              <Tick>Everything in Maude Cloud</Tick>
              <Tick>Your server, your backups</Tick>
              <Tick>One command to stand it up</Tick>
            </ul>
            <a className="btn btn--lg" href="/docs/hub">Read the setup guide</a>
          </article>
          <article className="ps-card ps-plan" data-pick="true">
            <span className="ps-row" style={{ justifyContent: "space-between" }}>
              <span className="ps-who" style={{ color: "var(--accent-text)" }}>Cloud Project</span>
              <span className="chip chip--accent">Most teams</span>
            </span>
            <span className="seg" role="group" aria-label="Billing for Cloud Project">
              <button type="button" aria-pressed="true">Monthly</button>
              <button type="button" aria-pressed="false">Yearly <span className="ps-save">−17%</span></button>
            </span>
            <div className="ps-price"><b>€19</b><span>a month per project</span></div>
            <p className="ps-body">One project online, with everyone you invite included.</p>
            <ul className="ps-ticks">
              <Tick>People, roles and invitations</Tick>
              <Tick>10 GB of media included</Tick>
              <Tick>Full history and one-click export</Tick>
              <Tick>An automatic copy in your own GitHub</Tick>
            </ul>
            <a className="btn btn--primary btn--lg" href="#">Get Maude Cloud</a>
            <span className="ps-small" style={{ textAlign: "center" }}>Yearly: €190, two months free</span>
          </article>
          <article className="ps-card ps-plan">
            <span className="ps-who">Dedicated</span>
            <div className="ps-price"><b>€99</b><span>a month</span></div>
            <p className="ps-body">A pinned instance for a team that needs its own.</p>
            <ul className="ps-ticks">
              <Tick>Everything in Cloud Project</Tick>
              <Tick>100 GB of media included</Tick>
              <Tick>Region pinning and a custom domain</Tick>
              <Tick>Priority support</Tick>
            </ul>
            <a className="btn btn--lg" href="#">Get Dedicated</a>
            <span className="ps-small" style={{ textAlign: "center" }}>monthly only</span>
          </article>
        </div>
        <p className="ps-small" style={{ textAlign: "center", marginTop: "var(--space-4)" }}>Prices without VAT. Stripe adds your country's VAT at checkout and shows the total before you enter a card. Extra storage is €5 per 50 GB a month.</p>
        {/* Answer "is AI included?" next to the cards, not only in the questions (UX research: Zed). */}
        <div className="ps-ai-note">
          <span className="ps-ico ps-ico--ai"><Spark size={16} /></span>
          <span><b>AI runs on your own Claude account</b>, about €20 a month, paid to Anthropic on their terms. Maude never resells it and gets no part of it.</span>
        </div>
      </section>

      <section className="ps-wrap ps-section" aria-labelledby="h-seat">
        <div className="ps-card ps-vs" style={{ padding: "var(--space-6)" }}>
          <div className="ps-head" style={{ marginBottom: 0 }}>
            <span className="ps-eyebrow">Per project, never per seat</span>
            <h2 id="h-seat" className="ps-h2" style={{ fontSize: "var(--type-3xl)" }}>Inviting people is the point. So it's free.</h2>
            <p className="ps-body">A team of five on one project pays the same as a team of one.</p>
          </div>
          <div className="ps-bars" role="img" aria-label="Monthly cost for five people on one project: Maude Cloud €19, a per-seat tool five times its seat price">
            {/* cost-bars-grow: the bars draw to their value once; the numbers stay plain text for screen readers. */}
            <div className="ps-bar" data-you="true"><span>Maude Cloud</span><span><i className="ps-r ps-r--grow" style={{ width: "24%" }} /></span><b>€19</b></div>
            <div className="ps-bar"><span>Per-seat tool</span><span><i className="ps-r ps-r--grow" style={{ width: "100%" }} /></span><b>5 × a seat</b></div>
            <span className="ps-small">Five people, one project, one month. Add a sixth person: Maude Cloud stays €19.</span>
          </div>
        </div>
      </section>

      <section className="ps-wrap ps-section--tight" aria-labelledby="h-host">
        <div className="ps-head ps-center">
          <span className="ps-eyebrow">Same software, two ways to run it</span>
          <h2 id="h-host" className="ps-h2" style={{ fontSize: "var(--type-3xl)" }}>Self-host it, or let us run it.</h2>
        </div>
        <table className="ps-compare">
          <thead><tr><th scope="col"><span className="ps-sr">Question</span></th><th scope="col">Self-host · free</th><th scope="col">Maude Cloud · €19</th></tr></thead>
          <tbody>
            <tr><td>Who runs the server</td><td>You, with one command</td><td>We do</td></tr>
            <tr><td>Updates</td><td>When you pull a new release</td><td>Automatic</td></tr>
            <tr><td>Backups</td><td>Your own backup target</td><td>Included, with full history</td></tr>
            <tr><td>Your address</td><td>Your own domain</td><td>Its own address on Maude Cloud</td></tr>
            <tr><td>Leaving</td><td>It's already yours</td><td>One-click export, plus your GitHub copy</td></tr>
          </tbody>
        </table>
        <div className="ps-trust" style={{ marginTop: "var(--space-6)" }}>
          <span><Icon name="export" size={16} /> Leave any time, with everything</span>
          <span><Icon name="sync" size={16} /> A copy in your own GitHub</span>
          <span><Icon name="lock" size={16} /> An isolated workspace per project</span>
          <span><Icon name="server" size={16} /> Or self-host it, for free</span>
        </div>
      </section>

      <section className="ps-wrap ps-section" aria-labelledby="h-faq">
        <h2 id="h-faq" className="ps-h2" style={{ fontSize: "var(--type-3xl)", marginBottom: "var(--space-6)" }}>Questions</h2>
        <div className="ps-faq">
          <div className="ps-q"><b>What counts as a project?</b><p className="ps-body">One shared Maude project: all its canvases, its design system, its people and its history. Make as many canvases inside it as you like.</p></div>
          <div className="ps-q"><b>Do I pay for each person I invite?</b><p className="ps-body">No. Everyone you invite is included, whatever their role.</p></div>
          <div className="ps-q"><b>Do I need a Claude subscription?</b><p className="ps-body">For AI, yes. You connect your own Claude account. We don't resell it and get no part of it.</p></div>
          <div className="ps-q"><b>Is self-hosting a smaller version?</b><p className="ps-body">No. It's the same software, and the hosting costs are published in the docs.</p></div>
          <div className="ps-q"><b>Who can open a Cloud project?</b><p className="ps-body">Anyone you invite, in the Mac app or in the browser. You choose who can edit, comment or view.</p></div>
          <div className="ps-q"><b>Can I leave?</b><p className="ps-body">Yes. Export the whole project in one click, and your GitHub copy is always there.</p></div>
        </div>
      </section>

      <section className="ps-wrap ps-section--tight" aria-labelledby="h-cloud-cta">
        <div className="ps-band" style={{ gridTemplateColumns: "1fr auto" }}>
          <div className="ps-head" style={{ marginBottom: 0 }}>
            <h2 id="h-cloud-cta" className="ps-h2" style={{ fontSize: "var(--type-3xl)" }}>Start a Cloud project.</h2>
            <p className="ps-body">Move a project from your Mac in the Share sheet, or start a new one here.</p>
          </div>
          <div className="ps-row">
            <a className="btn btn--primary btn--lg" href="#">Get Maude Cloud</a>
            <a className="btn btn--ghost btn--lg" href="/desktop">Download for Mac</a>
          </div>
        </div>
      </section>

      </main>
      <SiteFoot />
    </V2>
  );
}

/* ═══ 3 · Docs — two doors ══════════════════════════════════════════════════════════════════
   The same content/docs tree, split at the one seam it already has ("Using Maude" / "Advanced"). */

const ADVANCED_GROUPS: [string, string[]][] = [
  ["Explore", ["Claude Code plugins", "design plugin", "flow plugin", "The maude CLI", "Self-hosted hub", "Orchestration", "Codex", "Config", "Security"]],
  ["Look up", ["Design commands", "Flow commands", "Config schema", "Design system schema"]],
  ["Recipes", ["All recipes"]],
];

function DocsPage() {
  const using: [string, string][] = [["Getting started", "5 min"], ["The Mac app", ""], ["Share links and inviting", ""], ["Maude Cloud", ""], ["Moving from Maude 1", ""]];
  return (
    <V2 className="ds ps-page">
      <SiteNav on="docs" main="main-docs" />
      <main id="main-docs">
      <section className="ps-wrap ps-hero" style={{ paddingBottom: "var(--space-6)" }} aria-labelledby="h-docs">
        <h1 id="h-docs" className="ps-h1" style={{ fontSize: "calc(var(--type-3xl) * 1.5)" }}>Maude docs</h1>
        <p className="ps-lede">Start with the app. Go as deep as you like.</p>
        <button type="button" className="ps-search" style={{ width: 560 }}><Icon name="search" size={16} /> Search the docs <Kbd>⌘K</Kbd></button>
      </section>

      <section className="ps-wrap" aria-label="Two ways in">
        <div className="ps-grid-2">
          <article className="ps-card ps-door">
            <div className="ps-row"><span className="ps-ico"><Icon name="home" size={18} /></span><div><h2 className="ps-h3">Using Maude</h2><p className="ps-door-for">For designers and teams. No terminal needed.</p><p className="ps-door-mode">Tutorials and how-to guides</p></div></div>
            <div className="ps-door-list">
              {using.map(([t, m]) => <a key={t} className="ps-door-link" href="#">{t}{m ? <span className="ps-small">{m}</span> : null}<span className="ps-small" style={{ marginLeft: m ? "var(--space-2)" : "auto" }}><Icon name="submenu" size={14} /></span></a>)}
            </div>
          </article>
          <article className="ps-card ps-door ps-door--adv">
            <div className="ps-row"><span className="ps-ico ps-ico--plain"><Icon name="terminal" size={18} /></span><div><h2 className="ps-h3">Advanced</h2><p className="ps-door-for">For Claude Code, the command line and self-hosting.</p><p className="ps-door-mode">Reference, explanations and recipes · every page kept</p></div></div>
            <div className="ps-grid-2" style={{ gap: "var(--space-2)" }}>
              {ADVANCED_GROUPS.map(([g, items]) => (
                <div key={g} className="ps-door-list">
                  <span className="ps-door-group">{g}</span>
                  {items.slice(0, g === "Explore" ? 5 : 4).map((t) => <a key={t} className="ps-door-link" href="#">{t}</a>)}
                  {g === "Explore" ? <a className="ps-door-link" href="#"><span className="ps-small" style={{ marginLeft: 0 }}>+ Orchestration, Codex, Config, Security</span></a> : null}
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="ps-wrap ps-section--tight" aria-labelledby="h-pop">
        <h2 id="h-pop" className="ps-h3" style={{ marginBottom: "var(--space-4)" }}>People start here</h2>
        <div className="ps-grid-4">
          {[["frame", "Make your first canvas", "Ask AI for a draft, or draw it."], ["people", "Invite your team", "One Share button, three roles."], ["system", "Bring your design system", "Colours, type, components."], ["export", "Export anything", "PNG, PDF, video, or code."]].map(([i, t, d]) => (
            <a key={t} className="ps-card" href="#"><span className="ps-ico"><Icon name={i} size={16} /></span><b>{t}</b><span className="ps-small">{d}</span></a>
          ))}
        </div>
      </section>

      <section className="ps-wrap" aria-label="Latest release">
        <div className="ps-card ps-card--flat" style={{ flexDirection: "row", alignItems: "center" }}>
          <span className="chip chip--accent">New</span>
          <span className="ps-body"><b>Maude 2.0</b> · the redesign: floating panels, Preview and Present, Maude Cloud.</span>
          <a className="btn btn--sm btn--ghost" href="/changelog" style={{ marginLeft: "auto" }}>Read the changelog</a>
        </div>
      </section>
      </main>
      <SiteFoot />
    </V2>
  );
}

/* ═══ 4 · An Advanced docs page ═════════════════════════════════════════════════════════════
   Advanced stays whole: same pages, same reference, one click deeper. Mono is allowed here. */

function AdvancedPage() {
  return (
    <V2 className="ds ps-page">
      <SiteNav on="docs" main="main-adv" />
      <main id="main-adv">
      <div className="ps-docs">
        <aside className="ps-side" aria-label="Docs">
          <div className="ps-side-search"><Icon name="search" size={14} /> Search <span style={{ marginLeft: "auto" }}><Kbd>⌘K</Kbd></span></div>
          <span className="ps-side-head"><Icon name="home" size={14} /> Using Maude <span className="ps-caret"><Icon name="submenu" size={14} /></span></span>
          <span className="ps-side-head"><Icon name="terminal" size={14} /> Advanced <span className="ps-caret"><Icon name="chevron" size={14} /></span></span>
          {ADVANCED_GROUPS.map(([g, items]) => (
            <div key={g} style={{ display: "contents" }}>
              <span className="ps-side-sub">{g}</span>
              {items.map((t) => <a key={t} className="ps-side-link" data-on={t === "The maude CLI" ? "true" : undefined} href="#">{t}</a>)}
            </div>
          ))}
          <span className="ps-side-head" style={{ marginTop: "var(--space-3)" }}><Icon name="file" size={14} /> Legal <span className="ps-caret"><Icon name="submenu" size={14} /></span></span>
        </aside>

        <article className="ps-article">
          <span className="ps-crumbs">Docs <Icon name="submenu" size={12} /> Advanced <Icon name="submenu" size={12} /> Explore</span>
          <span className="ps-chip-adv" style={{ alignSelf: "flex-start" }}><Icon name="terminal" size={12} /> Advanced</span>
          <div className="ps-row" style={{ justifyContent: "space-between" }}>
            <h1 className="ps-h2">The maude CLI</h1>
            {/* The site already serves llms.txt / .mdx twins: an AI-native tool's docs should be easy to hand to Claude. */}
            <span className="ps-doc-actions">
              <button type="button" className="btn btn--sm"><Icon name="duplicate" size={14} /> Copy page as Markdown</button>
            </span>
          </div>
          <p className="ps-lede">The command line under the Mac app. It sets up a project, reads and writes its config, and runs the design server, with the same files the app uses.</p>
          <div className="callout"><Icon name="help" size={16} /> <span>You don't need this to use Maude. The Mac app does all of it for you. <a href="#" style={{ color: "var(--accent-text)", textDecoration: "underline" }}>Back to Using Maude</a></span></div>

          <h3>Install</h3>
          <div className="ps-code">{"npm i -g @1agh/maude\nmaude init --name studio-site   "}<span className="ps-c">{"# sets up .ai/ and .design/"}</span></div>

          <h3>Common commands</h3>
          <table className="ps-table">
            <thead><tr><th>Command</th><th>What it does</th></tr></thead>
            <tbody>
              <tr><td>maude init</td><td>Set up a project: the .ai/ workspace and its config</td></tr>
              <tr><td>maude config get &lt;key&gt;</td><td>Read one value from .ai/workflows.config.json</td></tr>
              <tr><td>maude design serve</td><td>Start the design server for this project</td></tr>
              <tr><td>maude doctor</td><td>Check dependencies, config and quality gates in one report</td></tr>
              <tr><td>maude hub workspace-up</td><td>Stand up a self-hosted team server</td></tr>
            </tbody>
          </table>

          <h3>Next</h3>
          <div className="ps-pager">
            <a className="ps-card ps-card--flat" href="#"><span className="ps-small">Previous</span><b>flow plugin</b></a>
            <a className="ps-card ps-card--flat" href="#" style={{ textAlign: "right" }}><span className="ps-small">Next</span><b>Self-hosted hub</b></a>
          </div>
        </article>

        <nav className="ps-toc" aria-label="On this page">
          <b>On this page</b>
          <a href="#" data-on="true">Install</a>
          <a href="#">Common commands</a>
          <a href="#">Next</a>
          <span className="ps-divider" style={{ margin: "var(--space-3) 0" }} />
          <a href="#" className="ps-small">Edit this page on GitHub</a>
        </nav>
      </div>
      </main>
      <SiteFoot />
    </V2>
  );
}

/* ═══ 0 · The message and the map ═══════════════════════════════════════════════════════════ */

function DirectionBoard() {
  return (
    <V2 className="ds ps-page">
      <div className="ps-dir">
        <div className="ps-head" style={{ marginBottom: 0, maxWidth: 900 }}>
          <span className="ps-eyebrow"><Mark size={18} /> maude.sh · Maude 2</span>
          <h1 className="ps-h1" style={{ fontSize: "calc(var(--type-3xl) * 1.5)" }}>One message, three links, one button to buy.</h1>
          <p className="ps-lede">The public site in the maude-v2 language: the page is the canvas, the nav is one floating island, azure is the only action colour. Nothing in the docs goes away.</p>
        </div>

        <div className="ps-dir-grid">
          <section aria-labelledby="h-msg" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <h2 id="h-msg" className="ps-h3">The message</h2>
            <article className="ps-card ps-line" data-pick="true">
              <span className="chip chip--accent" style={{ alignSelf: "flex-start" }}>Picked · the Home headline</span>
              <p className="ps-line-h">You like Figma. You like Claude. Meet Maude.</p>
              <span className="ps-line-use">Names two tools people already love and says Maude has both. It never says it replaces either.</span>
            </article>
            <article className="ps-card ps-line">
              <span className="chip" style={{ alignSelf: "flex-start" }}>The second line · "It's yours"</span>
              <p className="ps-line-h">Like Figma. Except it's yours.</p>
              <span className="ps-line-use">Your "it's Figma but it's yours", as a comparison rather than a claim to be Figma. The ownership section's headline, and social posts.</span>
            </article>
            <article className="ps-card ps-line">
              <span className="chip" style={{ alignSelf: "flex-start" }}>The one sentence · subhead and meta</span>
              <p className="ps-line-h">A design canvas built around AI, not bent to fit one.</p>
              <span className="ps-line-use">The positioning line every version keeps.</span>
            </article>
            <article className="ps-card ps-line">
              <span className="chip" style={{ alignSelf: "flex-start" }}>The file story · "Good ol' HTML"</span>
              <p className="ps-line-h">Good ol' HTML. The AI knows it best.</p>
              <span className="ps-line-use">Why plain web files matter, told as a four-beat story for people who never opened a file: private format, the web's own language, the AI's mother tongue, already the real thing.</span>
            </article>
            <p className="ps-small">Left out: "Figma for the AI revolution". Peers sell control and ownership, not revolutions (UX research: Paper, pen.dev, Penpot), and "It's Figma" on its own sounds like we are Figma. A fair "Maude vs Figma" page lives in the footer.</p>
          </section>

          <section aria-labelledby="h-nav" className="ps-navcmp">
            <h2 id="h-nav" className="ps-h3">The navigation</h2>
            <span className="ps-who">Today · 6 links, the coffee in the top bar</span>
            <div className="ps-navcmp-row">
              {["Docs", "Download", "Advanced", "Changelog", "Source", "Buy me a coffee"].map((t) => <span key={t} className="ps-old">{t}</span>)}
            </div>
            <span className="ps-who" style={{ marginTop: "var(--space-3)" }}>Maude 2 · 3 links, GitHub and 2 buttons</span>
            <div className="ps-navcmp-row">
              {["Product", "Docs", "Pricing"].map((t) => <span key={t} className="ps-new">{t}</span>)}
              <span style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                <span className="ps-small">GitHub</span>
                <span className="btn btn--ghost btn--sm">Download</span>
                <span className="btn btn--primary btn--sm">Get Maude Cloud</span>
              </span>
            </div>
            <ul className="ps-ticks" style={{ marginTop: "var(--space-2)" }}>
              <Tick>Advanced is the second door inside Docs, not a top link</Tick>
              <Tick>What's new is the release chip above the headline and a teaser above the footer</Tick>
              <Tick>Changelog, Roadmap, About and the coffee live in the footer</Tick>
              <Tick>Pricing is its own page, with the price in the open and one Buy button</Tick>
              <Tick>On Home the hero owns the primary button (Download); the nav's Get Maude Cloud steps back until you scroll</Tick>
              <Tick>Every old address keeps working, with a redirect</Tick>
            </ul>
          </section>
        </div>

        <section aria-labelledby="h-map">
          <h2 id="h-map" className="ps-h3" style={{ marginBottom: "var(--space-3)" }}>The map</h2>
          <div className="ps-map">
            <div className="ps-map-col"><b><Icon name="home" size={14} /> Product</b><span>Home</span><span>Download for Mac</span><span className="ps-from">today: / and /desktop</span></div>
            <div className="ps-map-col"><b><Icon name="cloud" size={14} /> Pricing</b><span>Three plans, Buy</span><span>Self-host vs Cloud</span><span>Questions</span><span className="ps-from">new page, from docs/cloud/pricing</span></div>
            <div className="ps-map-col"><b><Icon name="file" size={14} /> Docs · Using Maude</b><span>Getting started</span><span>The Mac app</span><span>Share links</span><span>Maude Cloud</span><span>Moving from Maude 1</span></div>
            <div className="ps-map-col ps-map-col--adv"><b><Icon name="terminal" size={14} /> Docs · Advanced</b><span>Explore: plugins, CLI, hub, flow, config, security</span><span>Look up: commands, schemas</span><span>Recipes</span><span className="ps-from">every page kept, one click deeper</span></div>
          </div>
        </section>

        <section aria-labelledby="h-rules">
          <h2 id="h-rules" className="ps-h3" style={{ marginBottom: "var(--space-3)" }}>Three rules for every page</h2>
          <div className="ps-rules">
            <div className="ps-card ps-card--flat" style={{ flexDirection: "row" }}><span className="ps-num">1</span><p className="ps-body">One main action per page: Download on Home, Get Maude Cloud on Cloud.</p></div>
            <div className="ps-card ps-card--flat" style={{ flexDirection: "row" }}><span className="ps-num">2</span><p className="ps-body">Plain words. Code type only in Advanced and code samples.</p></div>
            <div className="ps-card ps-card--flat" style={{ flexDirection: "row" }}><span className="ps-num">3</span><p className="ps-body">Nothing removed. Advanced moved one click deeper, every page is still there.</p></div>
          </div>
        </section>
      </div>
    </V2>
  );
}

/* ═══ 6 · Intro motion ══════════════════════════════════════════════════════════════════════
   The hero's intro as four frames on the same clock (T) the Home artboard plays, plus every motion
   on the site with its tokens and its reduced-motion fallback (UX research motion_patterns). */

function MotionBoard() {
  const frames: { t: number; title: string; note: string; lines: number; spark?: boolean; win?: "ghost" | "in"; done?: boolean }[] = [
    { t: T.line1, title: "Line one", note: "\"You like Figma.\" rises 8 px and fades in, --dur-route on --ease-out.", lines: 1 },
    { t: T.line3, title: "Meet Maude.", note: "Lines arrive 90 ms apart. The last one lands, then its selection tag pops on --ease-spring.", lines: 3, spark: true },
    { t: T.shot, title: "The app rises", note: "Lede and buttons follow; the product shot rises 24 px over --dur-spring.", lines: 3, spark: true, win: "ghost" },
    { t: T.sticky, title: "AI draws, then a sticky lands", note: "The prompt, the ring, three cards 120 ms apart, Done, then Tereza's sticky on spring. Replay sits under it.", lines: 3, spark: true, win: "in", done: true },
  ];
  const rows: [string, string, string, string][] = [
    ["Headline stagger", "Home hero", "--dur-route · --ease-out · 90 ms stagger · spring on the tag", "Final state at first paint"],
    ["Headline rewrite", "Home hero, on a click", "spark ring + \"AI is rewriting\" ≈1.1 s, old text dims, new lines rise 90 ms apart; ⌘Z puts the first back", "Instant swap, tag only"],
    ["Weight bubble", "Home headline, under the pointer", "letters within ~1.3 glyph heights go 600 → 900, smoothstep, one rAF per move; --dur-flip ease back on leave", "Same (it follows the pointer, it doesn't move on its own)"],
    ["Drag a sticky", "Home hero", "follows the pointer 1:1, no inertia", "Same"],
    ["Design ↔ file wipe", "Good ol' HTML", "a range slider moves the clip edge, no easing", "Same"],
    ["Product-shot AI run", "Home product shot", "≈4.3 s once on load; a 44 px Replay appears after and replays only the run", "The finished frame; Replay hidden"],
    ["Formula assembles", "Why Maude cards", "on entry (view timeline, 0–30 %): cards rise, + and = fade", "Static trio"],
    ["Cost bars grow", "Pricing, per project vs per seat", "on entry: scaleX 0 → 1 along the view timeline", "Bars at full width"],
    ["Sections reveal", "Below the fold (real site)", "view timeline, entry 0–30 %, 8 px rise", "Visible by default; never hide-then-reveal"],
    ["Nav condenses (real site)", "The nav island after the hero", "--dur-panel · --ease-out; Get Maude Cloud turns primary", "Instant switch"],
    ["Hover and press", "Cards, doors, buttons", "--dur-flip, lift 2 px and one shadow step; press 0.98", "Colour and shadow only"],
  ];
  return (
    <V2 className="ds ps-page">
      <div className="ps-dir">
        <div className="ps-head" style={{ marginBottom: 0, maxWidth: 900 }}>
          <span className="ps-eyebrow"><Icon name="play" size={14} /> Intro motion</span>
          <h1 className="ps-h1" style={{ fontSize: "calc(var(--type-3xl) * 1.5)" }}>Under five seconds, then out of the way.</h1>
          <p className="ps-lede">Gentle, with one drop of spring, on the same tokens the app uses. The Home artboard plays it for real; open it in Preview and press Replay.</p>
        </div>
        <div className="ps-frames">
          {frames.map((f, i) => (
            <article key={f.t} className="ps-card ps-frame">
              <div className="ps-frame-pic" aria-hidden="true">
                {["You like Figma.", "You like Claude.", "Meet Maude."].map((l, j) => (
                  <span key={l} className="ps-frame-line" data-on={j === 2 ? "last" : undefined} data-ghost={j >= f.lines ? "true" : undefined}>{l}{j === 2 && f.spark ? " " : ""}</span>
                ))}
                {f.win ? <span className="ps-frame-win" data-ghost={f.win === "ghost" ? "true" : undefined}>
                  {f.done ? <><span className="ps-run-ring" style={{ left: 120, top: 12, width: 86, height: 56, borderColor: "var(--border-default)" }} /><span className="ps-run-tag ps-run-tag--done" style={{ left: 150, top: -10 }}><Spark size={9} /> Made by AI</span></> : null}
                </span> : null}
                {f.done ? <span style={{ position: "absolute", right: 22, bottom: 30, transform: "rotate(-3deg)", width: 54, height: 40, background: "var(--object-yellow)", borderRadius: 3, boxShadow: "var(--shadow-sm)" }} /> : null}
              </div>
              <div className="ps-frame-txt">
                <span className="ps-frame-t">{i + 1} · {f.t} ms</span>
                <b>{f.title}</b>
                <span className="ps-small">{f.note}</span>
              </div>
            </article>
          ))}
        </div>
        <section aria-labelledby="h-mt">
          <h2 id="h-mt" className="ps-h3" style={{ marginBottom: "var(--space-3)" }}>Every motion on the site</h2>
          <table className="ps-table ps-motion-table">
            <thead><tr><th>Motion</th><th>Where</th><th>Timing</th><th>With reduced motion</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((c) => <td key={c}>{c}</td>)}</tr>)}</tbody>
          </table>
          <p className="ps-small" style={{ marginTop: "var(--space-3)" }}>Never: scroll-jacking, smooth-scroll libraries, parallax heroes or looping decoration. Motion carries meaning or it doesn't run.</p>
        </section>
      </div>
    </V2>
  );
}

/* ═══ 5 · Home on a phone ═══════════════════════════════════════════════════════════════════ */

function HomeMobile() {
  return (
    <V2 className="ds ps-page ps-m">
      <header><a className="ps-skip" href="#main-m">Skip to content</a>
      <nav className="island ps-m-nav" aria-label="Main">
        <a className="ps-brand" href="/"><Mark size={22} /> maude</a>
        <span className="ps-row" style={{ gap: "var(--space-2)" }}>
          <a className="btn btn--primary ps-m-cta" href="/cloud">Get Maude Cloud</a>
          <button type="button" className="icon-btn ps-m-menu" aria-label="Menu" aria-expanded="false"><Icon name="menu" size={18} /></button>
        </span>
      </nav>
      </header>
      <main id="main-m">
      <section className="ps-wrap ps-hero" aria-labelledby="h-m">
        <span className="chip chip--accent">Maude 2 is here</span>
        <h1 id="h-m" className="ps-h1"><span className="ps-quiet">You like Figma.</span><br /><span className="ps-quiet">You like Claude.</span><br />Meet Maude.</h1>
        <p className="ps-lede">A design canvas built around AI, not bent to fit one. Every design is a real file, in a project that is yours.</p>
        <div className="ps-m-ctas">
          <a className="btn btn--primary btn--lg" href="/desktop">Download for Mac · free</a>
          <span className="ps-fine" style={{ textAlign: "center" }}>Maude is a Mac app. Maude Cloud also opens in the browser.</span>
        </div>
      </section>
      <div className="ps-wrap">
        <div className="ps-m-shot" role="img" aria-label="An artboard with AI drawing on it">
          <span className="ps-mini-board" style={{ left: 24, top: 36, width: 220, height: 150 }}><Thumb art="price" /></span>
          <span className="ps-mini-ring" style={{ left: 20, top: 32, width: 228, height: 158 }} />
          <span className="ps-mini-tag" style={{ left: 120, top: 18 }}><Spark size={10} /> AI is drawing</span>
          <Sticky color="yellow" x={226} y={120} rotate={3} w={110}>Yearly too?</Sticky>
          <span className="island ps-mini-ask" style={{ left: 24, top: 196 }}>Make the price bigger<span className="ps-send"><Icon name="arrow" size={12} /></span></span>
        </div>
      </div>
      <section className="ps-wrap ps-section--tight" aria-label="Why Maude">
        <div className="ps-m-list">
          <div className="ps-card" style={{ flexDirection: "row" }}><span className="ps-ico ps-ico--ai"><Spark size={16} /></span><div><b>Draw it, or ask for it</b><p className="ps-small">The canvas you know, with AI on <Kbd>⌘/</Kbd>.</p></div></div>
          <div className="ps-card" style={{ flexDirection: "row" }}><span className="ps-ico"><Icon name="system" size={16} /></span><div><b>Your design system, on every artboard</b><p className="ps-small">New work is checked against it.</p></div></div>
          <div className="ps-card" style={{ flexDirection: "row" }}><span className="ps-ico"><Icon name="file" size={16} /></span><div><b>Good ol' HTML, yours to keep</b><p className="ps-small">No secret format. The language AI knows best.</p></div></div>
        </div>
      </section>
      <section className="ps-wrap ps-section--tight" aria-labelledby="h-m-feat" style={{ paddingTop: 0 }}>
        <h2 id="h-m-feat" className="ps-h3" style={{ marginBottom: "var(--space-3)" }}>One canvas. Screens, reels, slides and print.</h2>
        <div className="ps-m-feats">{["AI video editing", "Print-ready", "Interactive prototypes", "Present", "Work together, live", "Design system from a moodboard", "AI images and music", "Figma import"].map((t) => <span key={t} className="chip">{t}</span>)}</div>
      </section>
      <section className="ps-wrap" aria-labelledby="h-m-cloud">
        <div className="ps-band">
          <span className="ps-eyebrow" style={{ color: "var(--bg-3)" }}><Icon name="cloud" size={14} /> Maude Cloud</span>
          <h2 id="h-m-cloud" className="ps-h2">Bring the whole team.</h2>
          <div className="ps-band-price"><b>€19</b><span>a month per project</span></div>
          <p className="ps-body">Everyone you invite is included. Pay for the project, not the seats.</p>
          <a className="btn btn--primary btn--lg" href="/cloud">Get Maude Cloud</a>
        </div>
      </section>
      <section className="ps-wrap ps-section--tight" aria-label="Advanced">
        <a className="ps-card ps-card--flat" href="/docs/advanced" style={{ flexDirection: "row", alignItems: "center" }}><span className="ps-chip-adv"><Icon name="terminal" size={12} /> Advanced</span><span className="ps-small">Plugins, CLI and the hub</span><span style={{ marginLeft: "auto", color: "var(--fg-2)" }}><Icon name="submenu" size={14} /></span></a>
      </section>
      </main>
      <footer className="ps-foot">
        <div className="ps-wrap" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div className="ps-m-foot-links">{["Download", "Maude Cloud", "Docs", "What's new", "Changelog", "GitHub", "About", "Buy me a coffee"].map((t) => <a key={t} href="#">{t}</a>)}</div>
          <span className="ps-small">MIT license · no telemetry · maude.sh</span>
        </div>
      </footer>
    </V2>
  );
}

export default function PublicSiteV2() {
  // A headless capture (export, screenshot, critic) never waits for the intro clock, so it gets the
  // final frame straight away. People in the studio and in Preview see the motion play.
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.webdriver) document.documentElement.classList.add("ps-still");
  }, []);
  return (
    <DesignCanvas>
      <DCSection id="main" title="maude.sh, redesigned for Maude 2" subtitle="One message, four links, a Maude Cloud button — and the Advanced docs kept whole">
        <DCArtboard id="ps-direction" label="0 · The message and the map" kind="web" width={1440} height={900}>
          <DirectionBoard />
        </DCArtboard>
        <DCArtboard id="ps-home" label="1 · Home" kind="web" width={1440} height={900}>
          <HomePage />
        </DCArtboard>
        <DCArtboard id="ps-cloud" label="2 · Maude Cloud and pricing" kind="web" width={1440} height={900}>
          <CloudPage />
        </DCArtboard>
        <DCArtboard id="ps-docs" label="3 · Docs — two doors" kind="web" width={1440} height={900}>
          <DocsPage />
        </DCArtboard>
        <DCArtboard id="ps-advanced" label="4 · An Advanced docs page" kind="web" width={1440} height={900}>
          <AdvancedPage />
        </DCArtboard>
        <DCArtboard id="ps-home-mobile" label="5 · Home on a phone" kind="web" width={390} height={844}>
          <HomeMobile />
        </DCArtboard>
        <DCArtboard id="ps-motion" label="6 · Intro motion" kind="web" width={1440} height={900}>
          <MotionBoard />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
