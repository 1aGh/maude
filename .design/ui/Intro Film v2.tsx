/**
 * @canvas      Intro Film v2 — storyboard and script
 * @ds          maude-v2
 * @platform    desktop
 * @kind        canvas
 * @stack       React 19 · TSX · Bun.build
 * @history     .design/_history/ui-intro_film_v2
 *
 * The intro film v2 for review: the concept and energy curve (with what the creative debate
 * proposed and what we took), the 8-shot storyboard, and the voice-over script. BEATS is the one
 * source both the storyboard and the script render from. When it is approved, the Remotion
 * composition (scripts/video/final, Intro2) is rebuilt from it.
 */

// The v2 canvases import their system explicitly: the capture path does not inject maude-v2.
import "../system/maude-v2/colors_and_type.css";
import "../system/maude-v2/preview/_components.css";
import "./v2/_kit.css";
import "./Intro Film v2.css";
import { DCArtboard, DCSection, DesignCanvas } from "@maude/canvas-lib";
import type { ReactNode } from "react";
import { Cursor, Icon, Mark, Spark, Sticky, Thumb, V2 } from "./v2/_kit";

/* ═══ The film, as data: one source for the storyboard and the script ═══════════════════════ */

type Beat = { n: number; tc: string; title: string; wow?: string; what: string; vo: string; dir?: string; snd: string; dark?: boolean; shot: ReactNode };

const BEATS: Beat[] = [
  {
    n: 1, tc: "0:00–0:06", title: "Hook",
    what: "Dot-grid canvas. The three lines land as a selected text layer; the AI cursor glides in on “Meet Maude.”",
    vo: "You like Figma. You like Claude. Meet Maude. A canvas with an AI that actually does stuff.",
    dir: "deadpan on “actually does stuff”", snd: "room tone, one sub pulse on “Meet”",
    shot: <>
      <div className="if-pos if-sel" style={{ left: "22%", top: "20%", width: "56%", height: "58%" }} />
      <div className="if-pos if-type" style={{ left: "25%", top: "24%", fontSize: 17 }}><span className="if-quiet">You like Figma.</span><br /><span className="if-quiet">You like Claude.</span><br />Meet Maude.</div>
      <span className="if-pos" style={{ left: "80%", top: "62%" }}><Cursor name="AI" agent x={0} y={0} /></span>
    </>,
  },
  {
    n: 2, tc: "0:06–0:18", title: "Drop video, AI cuts the film", wow: "Wow 1",
    what: "A stack of 40 raw clips falls onto the canvas. The spark ring wraps them, they fly into a timeline, a video artboard plays the cut with captions.",
    vo: "Drop in your raw footage. Forty clips. Mostly your thumb. The AI watches all of it, picks the good bits and cuts the film. Captions and music included.",
    dir: "tiny pause before “Mostly your thumb”", snd: "paper-drop whoosh, then the beat kicks in on the first cut",
    shot: <>
      {[0, 1, 2, 3, 4].map((k) => <div key={k} className="if-pos if-clip" style={{ left: `${8 + k * 4}%`, top: `${14 + k * 6}%`, transform: `rotate(${k * 5 - 8}deg)` }} />)}
      <div className="if-pos if-ring" style={{ left: "44%", top: "12%", width: "50%", height: "50%" }} />
      <div className="if-pos" style={{ left: "45.5%", top: "15%", width: "47%", height: "44%", borderRadius: 4, overflow: "hidden" }}><Thumb art="gator-reel" /></div>
      <span className="if-pos if-cap" style={{ left: "52%", top: "50%" }}>“and that's the whole trick”</span>
      <span className="if-pos if-tag" style={{ left: "72%", top: "5%" }}><Spark size={8} color="currentColor" /> AI is cutting</span>
      {[0, 1, 2, 3].map((k) => <div key={k} className="if-pos if-track" style={{ left: `${10 + k * 21}%`, top: "76%", width: "19%" }} />)}
    </>,
  },
  {
    n: 3, tc: "0:18–0:29", title: "Drop photos, AI makes the posts", wow: "Wow 2",
    what: "Photos from a shoot land; they fan out into a grid of 1:1 posts and 9:16 stories, in the brand's colours and type.",
    vo: "Drop in photos from the shoot. Out come the Instagram posts. On brand, because it knows your design system.",
    dir: "light, a bit smug on “On brand”", snd: "camera-shutter ticks, one per post",
    shot: <>
      {[0, 1, 2].map((k) => <div key={k} className="if-pos if-photo" style={{ left: `${5 + k * 3}%`, top: `${20 + k * 5}%`, width: "18%", height: "30%", transform: `rotate(${k * 6 - 6}deg)` }}><Thumb art="brand" /></div>)}
      {[0, 1, 2, 3, 4, 5].map((k) => <div key={k} className="if-pos if-photo" style={{ left: `${38 + (k % 3) * 15}%`, top: `${10 + Math.floor(k / 3) * 42}%`, width: "13%", height: "36%" }}><Thumb art={k % 2 ? "gator-social" : "brand"} /></div>)}
      <span className="if-pos if-tag" style={{ left: "70%", top: "88%" }}><Spark size={8} color="currentColor" /> Made by AI</span>
    </>,
  },
  {
    n: 4, tc: "0:29–0:42", title: "Draw an idea, AI builds the screens", wow: "Wow 3 · the big one",
    what: "A wobbly hand sketch on the canvas (boxes, a squiggle for text). Silence. The spark ring, then the sketch snaps into real app screens. The cursor taps “Sign up” and the next screen slides in.",
    vo: "Draw your idea. Badly. I do. The AI turns it into real screens you can click through.",
    dir: "“Badly. I do.” as a throwaway; then sincere", snd: "music drops to silence on the sketch, a full hit when it snaps into screens",
    shot: <>
      <div className="if-pos if-sketch" style={{ left: "6%", top: "16%", width: "24%", height: "66%" }} />
      <div className="if-pos if-scribble" style={{ left: "10%", top: "30%", width: "15%" }} />
      <div className="if-pos if-scribble" style={{ left: "10%", top: "38%", width: "11%" }} />
      <div className="if-pos if-sketch" style={{ left: "10%", top: "64%", width: "15%", height: "9%", borderRadius: 20 }} />
      <span className="if-pos" style={{ left: "35%", top: "44%", color: "var(--spark)" }}><Icon name="arrow" size={18} /></span>
      <div className="if-pos if-ring" style={{ left: "47%", top: "10%", width: "46%", height: "80%" }} />
      {[0, 1].map((k) => <div key={k} className="if-pos" style={{ left: `${50 + k * 22}%`, top: "14%", width: "19%", height: "72%", borderRadius: 6, overflow: "hidden", border: "1.5px solid var(--fg-0)", background: "var(--bg-0)" }}><Thumb art={k ? "onb" : "mobile"} /></div>)}
      <span className="if-pos if-btn" style={{ left: "53%", top: "75%" }}>Sign up</span>
      <span className="if-pos" style={{ left: "60%", top: "80%" }}><Cursor name="you" x={0} y={0} tag={false} /></span>
    </>,
  },
  {
    n: 5, tc: "0:42–0:48", title: "No handoff", dark: true,
    what: "Kinetic type on dark. File names stack up and get struck out one by one, then the line lands.",
    vo: "No handoff. No final_v7_really_final. Just pure creativity.",
    dir: "say the file name like you've seen it too many times", snd: "three hard stops, one per strike",
    shot: <>
      {["handoff_notes.pdf", "specs_v3.fig", "final_v7_really_final.fig"].map((t, k) => <span key={t} className="if-pos if-strike" style={{ left: "12%", top: `${18 + k * 14}%`, color: "var(--bg-4)" }}>{t}</span>)}
      <div className="if-pos if-type" style={{ left: "12%", top: "62%", fontSize: 20, color: "var(--bg-0)" }}>Just pure creativity.</div>
    </>,
  },
  {
    n: 6, tc: "0:48–0:55", title: "The whole team",
    what: "Wide pull-back: the same canvas with all three wows on it. Cursors arrive, stickies land, the project link ripples out.",
    vo: "Bring the whole team. Everyone on one canvas, live. You pay for the project, never per seat.",
    snd: "layered pops as people join, warmth comes in",
    shot: <>
      {["gator-reel", "gator-social", "mobile"].map((a, k) => <div key={a} className="if-pos" style={{ left: `${6 + k * 31}%`, top: "16%", width: "26%", height: "48%", borderRadius: 4, overflow: "hidden", boxShadow: "var(--shadow-sm)" }}><Thumb art={a as "mobile"} /></div>)}
      <span className="if-pos" style={{ left: "22%", top: "62%" }}><Cursor name="tereza" x={0} y={0} /></span>
      <span className="if-pos" style={{ left: "58%", top: "66%" }}><Cursor name="jonas" x={0} y={0} /></span>
      <div className="if-pos" style={{ left: "74%", top: "58%", transform: "scale(.55)", transformOrigin: "0 0" }}><Sticky color="yellow" x={0} y={0} rotate={3} w={130}>Ship it</Sticky></div>
    </>,
  },
  {
    n: 7, tc: "0:55–1:05", title: "The secret: good ol' HTML", wow: "The kicker",
    what: "One artboard lifts and flips like a playing card (the debate's “Flip”). The back is its own code, the <button> right behind the button. It lands face up and the button responds to the cursor.",
    vo: "Oh, the secret? It's all good ol' HTML. The language AI grew up on. So it's fluent. And the work is yours.",
    dir: "conspiratorial on “Oh, the secret?”", snd: "music cuts to silence for the flip, a wide chord when it lands",
    dark: true,
    shot: <>
      <div className="if-pos if-card3d" style={{ left: "10%", top: "14%", width: "34%", height: "72%", overflow: "hidden" }}><Thumb art="price" /></div>
      <div className="if-pos if-code" style={{ left: "54%", top: "16%" }}>{`<section class="pricing">
  <h2>Simple pricing</h2>
  <article class="plan">
    <b>Studio</b>
    <button>Get started</button>
  </article>
</section>`}</div>
    </>,
  },
  {
    n: 8, tc: "1:05–1:12", title: "End card",
    what: "The Mark and “maude”, the line, Download free · maude.sh. The spark cursor lands as the full stop.",
    vo: "Maude. Built around AI, not bent to fit one. Free to download at maude.sh.",
    snd: "resolved chord, long tail",
    shot: <>
      <div className="if-pos" style={{ left: "50%", top: "50%", transform: "translate(-50%,-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <span className="if-row" style={{ gap: 6, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 20 }}><Mark size={22} /> maude</span>
        <span style={{ fontSize: 10, color: "var(--fg-1)" }}>Built around AI, not bent to fit one.</span>
        <span className="if-btn">Download free · maude.sh</span>
      </div>
    </>,
  },
];

const words = BEATS.reduce((n, b) => n + b.vo.split(/\s+/).length, 0);

/* ═══ 0 · The concept ═══════════════════════════════════════════════════════════════════════ */

function Concept() {
  // the energy curve: x = seconds (0–72), y = intensity
  const pts: [number, number][] = [[0, 30], [6, 40], [12, 62], [18, 58], [24, 70], [29, 66], [33, 20], [36, 80], [42, 80], [45, 70], [48, 60], [55, 64], [58, 18], [61, 78], [66, 70], [72, 40]];
  const X = (t: number) => (t / 72) * 100;
  const Y = (v: number) => 100 - v;
  const d = pts.map(([t, v], i) => `${i ? "L" : "M"}${X(t)},${Y(v)}`).join(" ");
  const pins: [number, number, string, boolean][] = [[3, 30, "Hook", false], [12, 62, "Wow 1 · video", true], [24, 70, "Wow 2 · posts", true], [36, 80, "Wow 3 · sketch → app", true], [45, 70, "No handoff", false], [61, 78, "Good ol' HTML", true], [70, 44, "maude.sh", false]];
  return (
    <V2 className="ds if-page">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", maxWidth: 1000 }}>
        <span className="if-eyebrow"><Icon name="video" size={14} /> Intro film v2 · storyboard for review</span>
        <h1 className="if-h1">Three wows, <span className="if-quiet">no handoff,</span><br />and a secret at the end.</h1>
        <p className="if-lede">A 72-second film built on three “drop it in, watch AI do it” moments, a beat that kills the handoff, and the good ol' HTML secret as the kicker. Dry, a bit funny, written in Michal's voice.</p>
      </div>

      <div className="if-arc" aria-label="Energy curve of the film">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={d} fill="none" stroke="var(--accent)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" style={{ strokeWidth: 2 }} />
        </svg>
        {pins.map(([t, v, label, wow]) => (
          <span key={label} className="if-arc-pin" data-wow={wow ? "true" : undefined} style={{ left: `${X(t)}%`, top: `${Y(v)}%` }}>{label}<i /></span>
        ))}
        {[0, 12, 24, 36, 48, 60, 72].map((t) => <span key={t} className="if-arc-t" style={{ left: `${Math.min(97, Math.max(3, X(t)))}%` }}>0:{String(t).padStart(2, "0")}</span>)}
      </div>

      <div className="if-grid-3">
        <div className="if-card">
          <span className="if-eyebrow"><Spark size={14} /> Act 1 · setup</span>
          <b>Hook, then two quick wows</b>
          <p className="if-small">“Meet Maude”, then drop video (AI cuts the film) and drop photos (AI makes the posts). Each wow is one drop and one payoff, under 12 seconds.</p>
        </div>
        <div className="if-card">
          <span className="if-eyebrow"><Spark size={14} /> Act 2 · the big one</span>
          <b>Sketch → real screens</b>
          <p className="if-small">The music drops out on a bad hand sketch, then it snaps into clickable app screens. Lands straight into “No handoff. Just pure creativity.”</p>
        </div>
        <div className="if-card">
          <span className="if-eyebrow"><Spark size={14} /> Act 3 · the secret</span>
          <b>Good ol' HTML, shown not told</b>
          <p className="if-small">One artboard flips like a card and its back is its own code. “The language AI grew up on.” Then the end card.</p>
        </div>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <h2 className="if-h3">How we got here: the creative debate</h2>
        <div className="if-grid-3">
          <div className="if-card if-seat">
            <b>Creative director · “Made Twice”</b>
            <p className="if-small">Every design gets built twice; Maude builds it once. The wow: the artboard flips and its back is its code.</p>
            <span className="if-took"><Icon name="check" size={12} /> Took: the Flip, as the HTML kicker</span>
            <span className="if-left">Left: the slow “ritual” cold open</span>
          </div>
          <div className="if-card if-seat">
            <b>Scriptwriter · “Friday, 17:42”</b>
            <p className="if-small">Tereza before a Monday launch; the film turns out to be a canvas itself.</p>
            <span className="if-took"><Icon name="check" size={12} /> Took: short dry lines, one joke per beat</span>
            <span className="if-left">Left: the meta “this film was a canvas” reveal (only honest if the film is built as a Maude video canvas)</span>
          </div>
          <div className="if-card if-seat">
            <b>Director · “It was never a picture”</b>
            <p className="if-small">One continuous canvas, the spark as the signature device, silence before the peaks, no cross-fades.</p>
            <span className="if-took"><Icon name="check" size={12} /> Took: silence-then-hit, the spark, camera moves instead of fades</span>
            <span className="if-left">Left: cutting “You like Figma. You like Claude.”</span>
          </div>
        </div>
        <p className="if-small">Michal's call: build it around the three “drop it in” wows and “No handoff, just pure creativity”, keep the good ol' HTML ending, VO in his own voice with humour, a dry friendly male narrator.</p>
      </section>
    </V2>
  );
}

/* ═══ 1 · The storyboard ════════════════════════════════════════════════════════════════════ */

function Storyboard() {
  return (
    <V2 className="ds if-page">
      <div className="if-row" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span className="if-eyebrow"><Icon name="video" size={14} /> Storyboard · 8 shots · 1:12 · 1920×1080, 30 fps</span>
          <h2 className="if-h2">Drop it in. Watch it happen.</h2>
        </div>
        <span className="if-small">Orange outline = a wow shot</span>
      </div>
      <div className="if-board">
        {BEATS.map((b) => (
          <article key={b.n} className="if-frame">
            <div className="if-shot" data-dark={b.dark ? "true" : undefined} data-wow={b.wow ? "true" : undefined} role="img" aria-label={`Shot ${b.n}: ${b.title}`}>{b.shot}</div>
            <div className="if-tc"><span>{b.n} · {b.tc}</span>{b.wow ? <span className="if-wow"><Spark size={10} /> {b.wow}</span> : null}</div>
            <b>{b.title}</b>
            <p className="if-what">{b.what}</p>
            <p className="if-vo">“{b.vo}”</p>
            <p className="if-snd"><Icon name="play" size={10} /> {b.snd}</p>
          </article>
        ))}
      </div>
    </V2>
  );
}

/* ═══ 2 · The script ════════════════════════════════════════════════════════════════════════ */

function Script() {
  return (
    <V2 className="ds if-page">
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <span className="if-eyebrow"><Icon name="file" size={14} /> Voice-over script · {words} words · ≈145 wpm</span>
        <h2 className="if-h2">The script</h2>
        <p className="if-small">Written in Michal's EN voice: short lines, dry humour, no dashes joining clauses. Every claim is a shipped feature; no price on screen or in the VO.</p>
      </div>
      <div className="if-script">
        <div className="if-sh">Time</div><div className="if-sh">Line</div><div className="if-sh">Read it</div>
        {BEATS.map((b) => (
          <>
            <div key={`t${b.n}`} className="if-mono if-small">{b.tc}</div>
            <div key={`l${b.n}`}><p className="if-line">{b.vo}</p></div>
            <div key={`d${b.n}`} className="if-dir">{b.dir ?? "plain"}</div>
          </>
        ))}
      </div>
      <div className="if-grid-3">
        <div className="if-card">
          <b>Voice</b>
          <p className="if-small">Male, dry, friendly. Low-to-mid, close to the mic, unhurried, a smile you can hear. A designer telling a friend, never an announcer. Three ElevenLabs candidates read beat 1 and beat 4; Michal picks.</p>
        </div>
        <div className="if-card">
          <b>Music</b>
          <p className="if-small">Minimal electronic, ~112 BPM, muted piano motif. Hard stops before Wow 3 and the Flip, so the silence lands. Full kit in the team beat, one resolved chord on the end card.</p>
        </div>
        <div className="if-card">
          <b>Truth check</b>
          <p className="if-small">Reel from raw clips, social posts from photos on brand, whiteboard sketch to artboards, clickable screens (real code), live team, per-project Cloud, plain web code: all shipped. The sketch-to-app beat says “real screens you can click through”, not a deployed app.</p>
        </div>
      </div>
    </V2>
  );
}

export default function IntroFilmV2() {
  return (
    <DesignCanvas>
      <DCSection id="film" title="Intro film v2" subtitle="Three wows, no handoff, and good ol' HTML at the end">
        <DCArtboard id="if-concept" label="0 · Concept and arc" kind="web" width={1440} height={900}>
          <Concept />
        </DCArtboard>
        <DCArtboard id="if-board" label="1 · Storyboard" kind="web" width={1600} height={900}>
          <Storyboard />
        </DCArtboard>
        <DCArtboard id="if-script" label="2 · Voice-over script" kind="web" width={1200} height={900}>
          <Script />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
