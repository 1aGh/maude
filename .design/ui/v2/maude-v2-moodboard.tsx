/**
 * @canvas      maude-v2 moodboard — Stage-3 direction gate (3 direction tiles)
 * @ds          maude-v2 (pending — nothing scaffolded under system/ yet)
 * @platform    desktop
 * @artboards   direction-a · direction-b · direction-c
 * @brief       Seed-only collage tiles composed from the Stage-2 research payload
 *              (.design/_history/_system/maude-v2-a160c4e7-domain-research-discovery.json).
 *              One hand on purpose: the comparison variable is the DIRECTION, not
 *              the collage craft. Images are local copies fetched through
 *              `maude design fetch-asset`; captions/anchors are quoted as inert text.
 *              Fonts are the real macOS faces where the direction allows it; where
 *              research named a commercial face, the tile says which stand-in renders.
 * @history     .design/_history/_system/
 */

import type { CSSProperties, ReactNode } from "react";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

const W = 1280;
const H = 900;

const SF = 'system-ui, -apple-system, "SF Pro Text", sans-serif';
const SFD = '"SF Pro Display", system-ui, -apple-system, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const AVN = '"Avenir Next", "General Sans", "Figtree", system-ui, sans-serif';
const NY = '"New York", ui-serif, Georgia, serif';
const HAND = '"Marker Felt", "Bradley Hand", "Chalkboard SE", cursive';

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

/* deterministic jitter so the torn edges are irregular but stable across renders */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
function torn(seed: number, edges: "tb" | "b" | "r" = "tb") {
  const r = rng(seed);
  const pts: string[] = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * 100;
    pts.push(`${x.toFixed(1)}% ${edges.includes("t") ? (r() * 3.2).toFixed(1) : 0}%`);
  }
  if (edges === "r") {
    for (let i = 0; i <= n; i++) pts.push(`${(100 - r() * 3).toFixed(1)}% ${((i / n) * 100).toFixed(1)}%`);
    pts.push("0% 100%");
    return `polygon(0% 0%, ${pts.slice(n + 1).join(", ")})`;
  }
  for (let i = n; i >= 0; i--) {
    const x = (i / n) * 100;
    pts.push(`${x.toFixed(1)}% ${(100 - (edges.includes("b") ? r() * 3.6 : 0)).toFixed(1)}%`);
  }
  return `polygon(${pts.join(", ")})`;
}

type Box = { x: number; y: number; w?: number; h?: number; r: number; z?: number };

function Board({ base, children }: { base: string; children: ReactNode }) {
  return (
    <div style={{ position: "relative", width: W, height: H, overflow: "hidden", background: base, boxShadow: "inset 0 0 140px rgba(0,0,0,.22)" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.07, mixBlendMode: "multiply", pointerEvents: "none" }} />
      {children}
    </div>
  );
}

function Scrap({ x, y, w, h, r, z = 2, bg = "#fbfaf7", shadow = "2px 6px 14px rgba(0,0,0,.24)", clip, pad = 0, children, style }: Box & { bg?: string; shadow?: string; clip?: string; pad?: number; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, transform: `rotate(${r}deg)`, zIndex: z, filter: clip ? `drop-shadow(${shadow.replace(/^(\S+) (\S+) (\S+) /, "$1 $2 $3 ")})` : undefined }}>
      <div style={{ width: "100%", height: "100%", background: bg, boxShadow: clip ? undefined : shadow, clipPath: clip, padding: pad, boxSizing: "border-box", overflow: "hidden", ...style }}>{children}</div>
    </div>
  );
}

function Tape({ x, y, r, w = 74, color = "rgba(246,232,170,.62)", z = 30 }: { x: number; y: number; r: number; w?: number; color?: string; z?: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: 24, background: color, transform: `rotate(${r}deg)`, zIndex: z, clipPath: "polygon(3% 8%, 97% 0%, 100% 22%, 96% 48%, 99% 76%, 95% 100%, 4% 94%, 0% 70%, 4% 45%, 0% 18%)", boxShadow: "0 1px 2px rgba(0,0,0,.08)" }} />
  );
}

function Pin({ x, y, color, z = 31 }: { x: number; y: number; color: string; z?: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 15, height: 15, borderRadius: "50%", zIndex: z, background: `radial-gradient(circle at 35% 32%, #fff 0 14%, ${color} 38%, rgba(0,0,0,.55) 100%)`, boxShadow: "1px 3px 4px rgba(0,0,0,.35)" }} />
  );
}

function Photo({ src, alt, x, y, w, h, r, z = 3, caption, lip = false, fit = "cover", shadow }: Box & { src: string; alt: string; caption?: string; lip?: boolean; fit?: "cover" | "contain"; shadow?: string }) {
  return (
    <Scrap x={x} y={y} w={w} h={h} r={r} z={z} bg="#fafafa" pad={lip ? 9 : 0} shadow={shadow} style={lip ? { paddingBottom: 40 } : undefined}>
      <img
        src={src}
        alt={alt}
        style={{ width: "100%", height: "100%", objectFit: fit, display: "block", background: "#eee" }}
        onError={(e) => {
          const el = e.currentTarget;
          el.style.display = "none";
          if (el.parentElement) el.parentElement.setAttribute("data-fallback", alt);
        }}
      />
      {lip && caption ? (
        <div style={{ position: "absolute", left: 12, right: 12, bottom: 8, fontFamily: HAND, fontSize: 15, color: "#3a3a3a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{caption}</div>
      ) : null}
    </Scrap>
  );
}

function ChipFan({ x, y, r, chips, z = 12 }: { x: number; y: number; r: number; chips: { c: string; v: string; n: string; fg?: string }[]; z?: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, zIndex: z, transform: `rotate(${r}deg)` }}>
      {chips.map((ch, i) => (
        <div key={ch.v} style={{ position: "absolute", left: i * 52, top: (i % 2) * 9, width: 92, height: 150, background: "#fdfcf9", transform: `rotate(${(i - chips.length / 2) * 3.1 + (i % 2 ? 1.7 : -0.9)}deg)`, transformOrigin: "50% 92%", boxShadow: `${1 + i}px ${4 + i}px ${9 + i * 2}px rgba(0,0,0,.22)`, padding: 7, boxSizing: "border-box" }}>
          <div style={{ height: 88, background: ch.c, position: "relative" }}>
            <div style={{ position: "absolute", left: "50%", top: 7, width: 9, height: 9, marginLeft: -4.5, borderRadius: "50%", background: "#fdfcf9", boxShadow: "inset 0 1px 2px rgba(0,0,0,.3)" }} />
          </div>
          <div style={{ fontFamily: SF, fontSize: 10.5, fontWeight: 600, color: "#2b2b2b", marginTop: 6 }}>{ch.n}</div>
          <div style={{ fontFamily: MONO, fontSize: 8.5, color: "#555", marginTop: 2, lineHeight: 1.25 }}>{ch.v}</div>
        </div>
      ))}
    </div>
  );
}

function Strip({ x, y, w, r, parts, z = 9 }: { x: number; y: number; w: number; r: number; parts: { c: string; pct: number; label: string; fg: string }[]; z?: number }) {
  return (
    <Scrap x={x} y={y} w={w} h={58} r={r} z={z} bg="#fdfcf8" pad={6} clip={torn(w + y, "r")}>
      <div style={{ display: "flex", height: 46 }}>
        {parts.map((p) => (
          <div key={p.label} style={{ width: `${p.pct}%`, background: p.c, color: p.fg, fontFamily: MONO, fontSize: 9.5, padding: "5px 6px", boxSizing: "border-box" }}>
            {p.pct}% · {p.label}
          </div>
        ))}
      </div>
    </Scrap>
  );
}

function Tag({ x, y, r, name, why, url, q, z = 14, w = 210 }: { x: number; y: number; r: number; name: string; why: string; url: string; q?: string; z?: number; w?: number }) {
  return (
    <Scrap x={x} y={y} w={w} r={r} z={z} bg="#fffdf2" pad={9} shadow="1px 4px 9px rgba(0,0,0,.2)" style={{ borderLeft: "3px solid rgba(0,0,0,.12)" }}>
      <div style={{ fontFamily: SF, fontSize: 11.5, fontWeight: 700, color: "#222" }}>{name}</div>
      <div style={{ fontFamily: SF, fontSize: 10.5, lineHeight: 1.35, color: "#444", marginTop: 3 }}>{why}</div>
      <div style={{ fontFamily: MONO, fontSize: 8.5, color: "#7a7468", marginTop: 5, wordBreak: "break-all" }}>{url}</div>
      {q ? <div style={{ fontFamily: MONO, fontSize: 8, color: "#9a9384", marginTop: 2 }}>q: {q}</div> : null}
    </Scrap>
  );
}

function Mark({ size, tile, star }: { size: number; tile: string; star: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-label="maude mark">
      <path d="M7 0H25A7 7 0 0 1 32 7V32H7A7 7 0 0 1 0 25V7A7 7 0 0 1 7 0Z" fill={tile} />
      <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill={star} />
    </svg>
  );
}

/* hand-drawn marker marks in the tile's accent */
function Circled({ x, y, w, h, color, r = -4, z = 40 }: { x: number; y: number; w: number; h: number; color: string; r?: number; z?: number }) {
  return (
    <svg style={{ position: "absolute", left: x, top: y, zIndex: z, transform: `rotate(${r}deg)`, overflow: "visible" }} width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <path d={`M${w * 0.08} ${h * 0.55} C ${w * 0.02} ${h * 0.12}, ${w * 0.62} ${-h * 0.06}, ${w * 0.93} ${h * 0.3} C ${w * 1.04} ${h * 0.62}, ${w * 0.6} ${h * 1.02}, ${w * 0.22} ${h * 0.9} C ${w * 0.02} ${h * 0.82}, ${w * 0.04} ${h * 0.4}, ${w * 0.3} ${h * 0.16}`} stroke={color} strokeWidth={2.6} strokeLinecap="round" />
    </svg>
  );
}
function Arrow({ x, y, w, h, color, d, z = 40 }: { x: number; y: number; w: number; h: number; color: string; d: string; z?: number }) {
  return (
    <svg style={{ position: "absolute", left: x, top: y, zIndex: z, overflow: "visible" }} width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <path d={d} stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function Hand({ x, y, r, size = 20, color, children, z = 41, w }: { x: number; y: number; r: number; size?: number; color: string; children: ReactNode; z?: number; w?: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, transform: `rotate(${r}deg)`, fontFamily: HAND, fontSize: size, color, zIndex: z, lineHeight: 1.15 }}>{children}</div>
  );
}

function Dots({ color, pitch = 18 }: { color: string; pitch?: number }) {
  return <div style={{ position: "absolute", inset: 0, backgroundImage: `radial-gradient(${color} 1px, transparent 1.3px)`, backgroundSize: `${pitch}px ${pitch}px` }} />;
}

/* ───────────────────────── Tile A — Mac-native light glass ───────────────────────── */

const A = {
  canvas: "oklch(0.975 0.004 240)",
  ink: "oklch(0.24 0.012 250)",
  muted: "oklch(0.52 0.012 250)",
  accent: "oklch(0.62 0.175 238)",
  glass: "oklch(0.995 0.002 240 / 0.86)",
  base: "oklch(0.885 0.014 235)",
};

function TileA() {
  const island: CSSProperties = { background: A.glass, backdropFilter: "blur(14px) saturate(1.4)", WebkitBackdropFilter: "blur(14px) saturate(1.4)", borderRadius: 14, boxShadow: "0 8px 28px rgba(20,30,60,.16), 0 0 0 .5px rgba(20,30,60,.12)" };
  return (
    <Board base={A.base}>
      {/* anchor photo — Apple Liquid Glass */}
      <Photo src="/assets/61730bab.jpg" alt="Apple macOS Tahoe — Liquid Glass" x={38} y={31} w={452} h={238} r={-2.3} z={3} />
      <Tape x={196} y={18} r={4.1} />
      <Photo src="/assets/6120f657.png" alt="Craft" x={447} y={148} w={236} h={124} r={3.4} z={5} lip caption="Craft — install & create" shadow="3px 8px 16px rgba(0,0,0,.26)" />
      <Pin x={559} y={142} color={A.accent} />
      <Photo src="/assets/fbda390e.png" alt="Framer" x={1011} y={36} w={233} h={122} r={2.7} z={4} />
      <Tape x={1100} y={24} r={-5.6} w={62} color="rgba(190,214,240,.6)" />
      <Photo src="/assets/fecffded.jpg" alt="Figma UI3" x={973} y={540} w={274} h={154} r={-3.1} z={6} lip caption="Figma UI3 — vrátili floating panely" />
      <Pin x={1104} y={534} color="#d33" />

      {/* signature-treatment hero: frosted islands floating over a full-window canvas */}
      <Scrap x={116} y={300} w={760} h={452} r={-1.2} z={8} bg={A.canvas} shadow="4px 14px 30px rgba(10,20,50,.3)" style={{ borderRadius: 10 }}>
        <Dots color="oklch(0.82 0.01 240)" />
        {/* a colourful artboard on the canvas so the frost has something to read through */}
        <div style={{ position: "absolute", left: 218, top: 62, width: 318, height: 300, borderRadius: 6, background: "linear-gradient(160deg, oklch(0.78 0.12 60), oklch(0.66 0.17 20) 55%, oklch(0.45 0.12 300))", boxShadow: "0 2px 10px rgba(0,0,0,.18)" }}>
          <div style={{ position: "absolute", left: 22, top: 22, fontFamily: SFD, fontWeight: 700, fontSize: 26, color: "white", letterSpacing: -0.4 }}>Homepage</div>
          <div style={{ position: "absolute", left: 22, top: 60, width: 150, height: 8, borderRadius: 4, background: "rgba(255,255,255,.7)" }} />
          <div style={{ position: "absolute", left: 22, bottom: 24, padding: "7px 14px", borderRadius: 999, background: "white", fontFamily: SF, fontSize: 12, fontWeight: 600, color: "oklch(0.4 0.12 20)" }}>Get the app</div>
        </div>
        {/* top-left pill: one menu under the icon + file name */}
        <div style={{ ...island, position: "absolute", left: 14, top: 14, height: 36, display: "flex", alignItems: "center", gap: 9, padding: "0 12px 0 8px", borderRadius: 11 }}>
          <Mark size={22} tile={A.accent} star="white" />
          <span style={{ fontFamily: SF, fontSize: 12.5, fontWeight: 600, color: A.ink }}>Homepage</span>
          <span style={{ fontFamily: SF, fontSize: 11, color: A.muted }}>⌄</span>
        </div>
        {/* left island: layers */}
        <div style={{ ...island, position: "absolute", left: 14, top: 62, width: 168, padding: "10px 10px 12px" }}>
          <div style={{ fontFamily: SF, fontSize: 10.5, fontWeight: 600, color: A.muted, marginBottom: 7 }}>Canvasy</div>
          {["Homepage", "Onboarding", "Ceník", "Mobil — detail"].map((t, i) => (
            <div key={t} style={{ fontFamily: SF, fontSize: 12, color: i === 0 ? "white" : A.ink, background: i === 0 ? A.accent : "transparent", borderRadius: 6, padding: "5px 7px", marginBottom: 2 }}>{t}</div>
          ))}
        </div>
        {/* collapsed icon (the right panel folded away) */}
        <div style={{ ...island, position: "absolute", right: 14, top: 14, width: 36, height: 36, borderRadius: 11, display: "grid", placeItems: "center" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={A.ink} strokeWidth="1.4"><rect x="2" y="3" width="12" height="10" rx="2" /><line x1="10" y1="3" x2="10" y2="13" /></svg>
        </div>
        {/* AI island, simple mode */}
        <div style={{ ...island, position: "absolute", right: 14, bottom: 70, width: 238, padding: 10 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: SF, fontSize: 10.5, color: A.accent, background: "oklch(0.62 0.175 238 / .1)", borderRadius: 6, padding: "3px 7px", marginBottom: 8 }}>◆ Homepage · hero</div>
          <div style={{ fontFamily: SF, fontSize: 12.5, color: A.muted, padding: "9px 10px", borderRadius: 9, background: "oklch(1 0 0 / .7)", boxShadow: "inset 0 0 0 .5px rgba(0,0,0,.12)" }}>Zeptej se AI…</div>
        </div>
        {/* bottom tool dock */}
        <div style={{ ...island, position: "absolute", left: "50%", bottom: 14, transform: "translateX(-50%)", height: 42, display: "flex", alignItems: "center", gap: 4, padding: "0 7px", borderRadius: 13 }}>
          {["M4 3l9 4.5-4 1.2L8 13z", "M3 8h10M8 3v10", "M3 12l6-9 4 6", "M3 3h10v10H3z", "M3 4h10M3 8h7M3 12h9"].map((d, i) => (
            <div key={d} style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: i === 0 ? A.accent : "transparent" }}>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke={i === 0 ? "white" : A.ink} strokeWidth="1.4" strokeLinejoin="round"><path d={d} /></svg>
            </div>
          ))}
          <div style={{ width: 1, height: 20, background: "rgba(0,0,0,.12)", margin: "0 3px" }} />
          <div style={{ padding: "6px 12px", borderRadius: 8, background: A.accent, color: "white", fontFamily: SF, fontSize: 12, fontWeight: 600 }}>Sdílet</div>
        </div>
      </Scrap>
      <Tape x={140} y={290} r={-8.3} />
      <Tape x={790} y={735} r={6.9} w={66} />

      {/* type in context */}
      <Scrap x={724} y={152} w={300} h={170} r={2.1} z={11} bg="#fefefe" pad={16} clip={torn(41)} shadow="2px 7px 12px rgba(0,0,0,.2)">
        <div style={{ fontFamily: SFD, fontSize: 30, fontWeight: 650, letterSpacing: -0.6, color: A.ink, lineHeight: 1.08 }}>Tvůj canvas je připravený.</div>
        <div style={{ fontFamily: SF, fontSize: 13.5, color: A.muted, marginTop: 8, lineHeight: 1.4 }}>Požádej AI o první obrazovku, nebo začni kreslit.</div>
        <div style={{ fontFamily: MONO, fontSize: 8.5, color: "#9aa0aa", marginTop: 9 }}>SF Pro Display 650 · SF Pro Text · nativní systémové písmo</div>
      </Scrap>
      {/* giant glyph crop */}
      <Scrap x={884} y={420} w={128} h={150} r={-4.4} z={7} bg={A.canvas} clip={torn(77, "b")}>
        <div style={{ fontFamily: SFD, fontWeight: 700, fontSize: 150, lineHeight: 0.9, color: A.accent, marginLeft: 8 }}>Aa</div>
      </Scrap>

      {/* palette */}
      <ChipFan x={1052} y={176} r={3.2} chips={[{ c: A.canvas, v: "oklch .975 .004 240", n: "canvas" }, { c: A.ink, v: "oklch .24 .012 250", n: "ink" }, { c: A.accent, v: "oklch .62 .175 238", n: "azure" }]} />
      <Strip x={1010} y={352} w={236} r={-2.6} parts={[{ c: A.canvas, pct: 60, label: "canvas", fg: A.ink }, { c: "oklch(0.995 0.002 240)", pct: 30, label: "glass", fg: A.ink }, { c: A.accent, pct: 10, label: "", fg: "white" }]} />

      {/* feeling + voice */}
      <Hand x={540} y={296} r={-6} size={36} color={A.accent} z={42}>lehkost</Hand>
      <Circled x={520} y={284} w={170} h={64} color={A.accent} r={-5} z={43} />
      <Scrap x={520} y={770} w={292} h={84} r={-1.7} z={12} bg="#fffef8" pad={12} shadow="1px 5px 10px rgba(0,0,0,.2)" style={{ backgroundImage: "repeating-linear-gradient(transparent 0 19px, rgba(80,120,200,.18) 19px 20px)" }}>
        <div style={{ fontFamily: SF, fontSize: 13.5, color: A.ink, lineHeight: 1.45 }}>„Panely schované. ⌘\ je vrátí.“</div>
        <div style={{ fontFamily: SF, fontSize: 11, color: A.muted }}>hlas: quiet-pro — klidný profík</div>
      </Scrap>
      <Tape x={630} y={760} r={3.2} w={58} />

      {/* name + thesis */}
      <Scrap x={46} y={772} w={448} h={96} r={1.4} z={13} bg="#fbfbfa" pad={14} clip={torn(9)}>
        <div style={{ fontFamily: SFD, fontSize: 21, fontWeight: 700, color: A.ink, letterSpacing: -0.3 }}>Mac-nativní lehké sklo</div>
        <div style={{ fontFamily: SF, fontSize: 12, color: A.muted, marginTop: 4, lineHeight: 1.4 }}>Canvas přes celé okno, kompaktní matné ostrůvky nad ním se sbalí do ikony. Nativní písmo, azurová jen šetrně.</div>
      </Scrap>
      <div style={{ position: "absolute", left: 452, top: 744, zIndex: 44, transform: "rotate(8deg)" }}><Mark size={50} tile={A.accent} star="white" /></div>

      {/* provenance */}
      <Tag x={1018} y={714} r={-1.9} name="Figma UI3" why="Floating panely v betě stáhli: zpomalovaly, ubíraly canvas, design „vykukoval“. Kompaktní + sbalitelné!" url="figma.com/blog/our-approach-to-designing-ui3" w={226} />
      <Tag x={712} y={20} r={-2.8} name="Apple Liquid Glass · Craft · Framer" why="Sklo jen na navigační vrstvě, nikdy na obsahu. Craft = laťka „nainstaluj a tvoř“." url="developer.apple.com/videos/play/wwdc2025/310" w={250} />
      <Hand x={922} y={498} r={-3} size={15} color="#c0392b" w={140}>NE: sklo všude / průsvit</Hand>
      <Arrow x={860} y={470} w={70} h={60} color={A.accent} d="M64 6 C 40 12, 20 28, 8 52 M8 52 l 1 -12 M8 52 l 11 -5" />
    </Board>
  );
}

/* ───────────────────────── Tile B — playful workshop with a spark ───────────────────────── */

const B = {
  canvas: "oklch(0.985 0.008 80)",
  ink: "oklch(0.25 0.02 40)",
  muted: "oklch(0.52 0.02 50)",
  accent: "oklch(0.65 0.205 34)",
  select: "oklch(0.67 0.18 249)",
  base: "oklch(0.79 0.055 68)",
  yellow: "oklch(0.9 0.13 95)",
  green: "oklch(0.72 0.15 150)",
  lilac: "oklch(0.8 0.08 300)",
};

function TileB() {
  const panel: CSSProperties = { background: "white", borderRadius: 16, boxShadow: "0 14px 30px -6px rgba(60,30,10,.22), 0 2px 6px rgba(60,30,10,.08)" };
  return (
    <Board base={B.base}>
      <Photo src="/assets/330a111d.png" alt="FigJam" x={724} y={28} w={330} h={174} r={3.3} z={3} />
      <Pin x={884} y={22} color={B.accent} />
      <Photo src="/assets/ff57e8bd.png" alt="Kinopio" x={1027} y={182} w={228} h={120} r={-4.2} z={5} lip caption="Kinopio — barvy na plátně" />
      <Tape x={1100} y={170} r={6.1} />
      <Photo src="/assets/175329c6.png" alt="Kinopio mascot" x={36} y={42} w={150} h={128} r={-5.1} z={4} fit="contain" shadow="1px 5px 11px rgba(0,0,0,.2)" />
      <Photo src="/assets/0a293589.png" alt="tldraw" x={196} y={30} w={192} h={96} r={2.4} z={3} />
      <Tape x={262} y={20} r={-3.7} w={60} color="rgba(255,190,170,.62)" />

      {/* treatment hero: opaque lifted islands, chunky rounded dock, colour lives on the canvas */}
      <Scrap x={92} y={218} w={796} h={470} r={1.3} z={8} bg={B.canvas} shadow="5px 16px 32px rgba(70,35,10,.32)" style={{ borderRadius: 14 }}>
        <Dots color="oklch(0.86 0.02 70)" pitch={22} />
        {/* stickies on the canvas carry the colour */}
        {[
          { l: 250, t: 70, c: B.yellow, tx: "Hero: větší fotka", rr: -3 },
          { l: 388, t: 92, c: B.green, tx: "CTA nahoru?", rr: 2.5 },
          { l: 300, t: 214, c: B.lilac, tx: "3 varianty od AI", rr: -1.4 },
          { l: 452, t: 236, c: "oklch(0.83 0.11 30)", tx: "Mobil první", rr: 3.6 },
        ].map((s) => (
          <div key={s.tx} style={{ position: "absolute", left: s.l, top: s.t, width: 116, height: 104, background: s.c, transform: `rotate(${s.rr}deg)`, boxShadow: "0 6px 12px rgba(0,0,0,.14)", fontFamily: AVN, fontWeight: 600, fontSize: 14, color: B.ink, padding: 11, boxSizing: "border-box", borderRadius: 3 }}>{s.tx}</div>
        ))}
        {/* selection ring stays a separate functional blue */}
        <div style={{ position: "absolute", left: 296, top: 208, width: 126, height: 116, border: `2px solid ${B.select}`, borderRadius: 4 }} />
        {/* top-left pill */}
        <div style={{ ...panel, position: "absolute", left: 16, top: 16, height: 42, display: "flex", alignItems: "center", gap: 10, padding: "0 14px 0 9px", borderRadius: 14 }}>
          <Mark size={26} tile={B.accent} star="white" />
          <span style={{ fontFamily: AVN, fontWeight: 700, fontSize: 14, color: B.ink }}>Nápady na web</span>
        </div>
        {/* left panel */}
        <div style={{ ...panel, position: "absolute", left: 16, top: 72, width: 172, padding: 12 }}>
          {["Nápady na web", "Moodboard", "Wireframy"].map((t, i) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: AVN, fontSize: 13, fontWeight: i === 0 ? 700 : 500, color: B.ink, background: i === 0 ? "oklch(0.65 0.205 34 / .12)" : "transparent", borderRadius: 9, padding: "7px 8px", marginBottom: 2 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: [B.accent, B.yellow, B.green][i] }} />
              {t}
            </div>
          ))}
        </div>
        {/* AI panel */}
        <div style={{ ...panel, position: "absolute", right: 16, top: 16, width: 230, padding: 12 }}>
          <div style={{ fontFamily: AVN, fontWeight: 700, fontSize: 13, color: B.ink, marginBottom: 6 }}>✦ AI</div>
          <div style={{ fontFamily: SF, fontSize: 12.5, lineHeight: 1.4, color: B.ink, background: "oklch(0.97 0.012 70)", borderRadius: 11, padding: "8px 10px" }}>Hotovo — přidala jsem tři varianty hero sekce. Vyber si.</div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {["Varianta 2", "Ještě jinak"].map((t) => (
              <span key={t} style={{ fontFamily: SF, fontSize: 11.5, fontWeight: 600, color: B.accent, border: `1.5px solid ${B.accent}`, borderRadius: 999, padding: "4px 10px" }}>{t}</span>
            ))}
          </div>
        </div>
        {/* chunky bottom dock */}
        <div style={{ ...panel, position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)", height: 54, display: "flex", alignItems: "center", gap: 6, padding: "0 10px", borderRadius: 18 }}>
          {[B.select, B.yellow, B.green, B.lilac, "oklch(0.83 0.11 30)"].map((c, i) => (
            <div key={c} style={{ width: 38, height: 38, borderRadius: 12, background: i === 0 ? "oklch(0.67 0.18 249 / .14)" : "transparent", display: "grid", placeItems: "center" }}>
              {i === 0 ? (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke={B.select} strokeWidth="1.8" strokeLinejoin="round"><path d="M4 3l9 4.5-4 1.2L8 13z" /></svg>
              ) : (
                <div style={{ width: 22, height: 22, background: c, borderRadius: 4, transform: `rotate(${i * 3 - 6}deg)`, boxShadow: "0 2px 4px rgba(0,0,0,.15)" }} />
              )}
            </div>
          ))}
          <div style={{ padding: "9px 16px", borderRadius: 13, background: B.accent, color: "white", fontFamily: AVN, fontSize: 13.5, fontWeight: 700, marginLeft: 4 }}>+ Nový canvas</div>
        </div>
      </Scrap>
      <Tape x={110} y={206} r={-6.4} color="rgba(255,190,170,.6)" />
      <Pin x={860} y={226} color={B.green} />

      {/* type */}
      <Scrap x={900} y={322} w={346} h={182} r={-2.6} z={11} bg="#fffdf9" pad={18} clip={torn(133)} shadow="2px 8px 14px rgba(0,0,0,.22)">
        <div style={{ fontFamily: AVN, fontSize: 36, fontWeight: 700, letterSpacing: -0.8, color: B.ink, lineHeight: 1.02 }}>Co dnes vytvoříme?</div>
        <div style={{ fontFamily: SF, fontSize: 13.5, color: B.muted, marginTop: 9, lineHeight: 1.4 }}>Napiš nápad a AI ho rozkreslí na canvas. Barvy si nech na práci.</div>
        <div style={{ fontFamily: MONO, fontSize: 8.5, color: "#a09080", marginTop: 8 }}>display: General Sans / Figtree (v náhledu Avenir Next 700) · body: systémové sans</div>
      </Scrap>
      <Scrap x={1044} y={520} w={154} h={168} r={4.8} z={9} bg={B.canvas} clip={torn(64, "b")}>
        <div style={{ fontFamily: AVN, fontWeight: 800, fontSize: 168, lineHeight: 0.86, color: B.accent, marginLeft: 6 }}>a</div>
      </Scrap>

      {/* palette */}
      <ChipFan x={918} y={690} r={-4.1} chips={[{ c: B.accent, v: "oklch .65 .205 34", n: "jiskra" }, { c: B.canvas, v: "oklch .985 .008 80", n: "canvas" }, { c: B.select, v: "oklch .67 .18 249", n: "výběr" }, { c: B.yellow, v: "oklch .90 .13 95", n: "sticky" }]} />
      <Strip x={540} y={706} w={262} r={2.2} parts={[{ c: B.canvas, pct: 60, label: "canvas", fg: B.ink }, { c: "white", pct: 30, label: "panely", fg: B.ink }, { c: B.accent, pct: 10, label: "", fg: "white" }]} />

      {/* feeling + voice */}
      <Hand x={430} y={44} r={5} size={38} color={B.accent}>hravost</Hand>
      <Circled x={412} y={34} w={176} h={66} color={B.accent} r={4} />
      <Scrap x={70} y={716} w={318} h={90} r={2.6} z={12} bg="#fffef6" pad={12} shadow="1px 6px 11px rgba(0,0,0,.2)" style={{ backgroundImage: "repeating-linear-gradient(transparent 0 19px, rgba(220,90,60,.16) 19px 20px)" }}>
        <div style={{ fontFamily: SF, fontSize: 13.5, color: B.ink, lineHeight: 1.45 }}>„Hotovo — AI přidala tři varianty. Vyber si.“</div>
        <div style={{ fontFamily: SF, fontSize: 11, color: B.muted }}>hlas: warm-companion — přátelský parťák</div>
      </Scrap>
      <Tape x={180} y={704} r={-4.4} w={62} />

      {/* name + thesis */}
      <Scrap x={404} y={792} w={470} h={96} r={-1.5} z={13} bg="#fffcf6" pad={14} clip={torn(17)}>
        <div style={{ fontFamily: AVN, fontSize: 22, fontWeight: 800, color: B.ink, letterSpacing: -0.3 }}>Hravá dílna s jiskrou</div>
        <div style={{ fontFamily: SF, fontSize: 12, color: B.muted, marginTop: 4, lineHeight: 1.4 }}>Teplý bílý canvas, neprůhledné panely s měkkým stínem, buclatý dock. Vermilionová jiskra vede, barvy žijí na plátně.</div>
      </Scrap>
      <div style={{ position: "absolute", left: 846, top: 770, zIndex: 44, transform: "rotate(-9deg)" }}><Mark size={56} tile={B.accent} star="white" /></div>

      {/* provenance */}
      <Tag x={566} y={132} r={-3.4} name="FigJam" why="Tvoje linie: panely plavou a sbalí se do ikony. Barvy objektů, ne chrome." url="figma.com/figjam" w={170} z={15} />
      <Tag x={612} y={30} r={2.1} name="tldraw · Kinopio" why="Celé UI z malých plovoucích ostrůvků; vše se dá schovat, nic nezmizí." url="tldraw.com · kinopio.club" w={186} />
      <Arrow x={1180} y={700} w={70} h={80} color={B.accent} d="M10 74 C 30 50, 44 30, 50 8 M50 8 l -10 8 M50 8 l 4 12" />
      <Hand x={1140} y={792} r={-4} size={15} color="#b03a1e" w={120}>barva jen na plátně!</Hand>
    </Board>
  );
}

/* ───────────────────────── Tile C — quiet paper studio ───────────────────────── */

const C = {
  paper: "oklch(0.965 0.012 85)",
  ink: "oklch(0.23 0.012 70)",
  muted: "oklch(0.5 0.015 70)",
  accent: "oklch(0.6 0.11 172)",
  slip: "oklch(0.985 0.008 85)",
  base: "oklch(0.72 0.06 62)",
};

function TileC() {
  const slip: CSSProperties = { background: C.slip, borderRadius: 6, boxShadow: "0 0 0 .5px oklch(0.23 0.012 70 / .18), 0 3px 8px rgba(60,40,10,.08)" };
  return (
    <Board base={C.base}>
      <Photo src="/assets/548455b9.jpg" alt="Notion" x={846} y={34} w={392} h={204} r={-2.1} z={3} />
      <Tape x={1000} y={22} r={3.4} color="rgba(240,236,220,.66)" />
      <Photo src="/assets/748e3cfa.jpg" alt="Procreate" x={904} y={612} w={330} h={174} r={3.6} z={5} lip caption="Procreate — nástroje zmizí" />
      <Pin x={1062} y={606} color={C.accent} />
      <Photo src="/assets/c1658844.png" alt="MacPaint 1984" x={40} y={28} w={232} h={156} r={-4.3} z={4} lip caption="MacPaint, 1984 — Susan Kare" />
      <Photo src="/assets/94c89fcd.png" alt="MacPaint 2.0" x={250} y={92} w={150} h={112} r={5.6} z={5} />
      <Photo src="/assets/61d9ad45.png" alt="Heptabase" x={606} y={46} w={214} h={112} r={1.9} z={4} />
      <Tape x={662} y={34} r={-6.2} w={58} color="rgba(240,236,220,.66)" />

      {/* treatment hero: vanishing chrome — flat paper slips that slide away entirely */}
      <Scrap x={96} y={236} w={780} h={460} r={-0.9} z={8} bg={C.paper} shadow="3px 12px 26px rgba(60,35,10,.3)" style={{ borderRadius: 4 }}>
        {/* the page on the canvas */}
        <div style={{ position: "absolute", left: 252, top: 52, width: 340, height: 340, background: "white", boxShadow: "0 1px 3px rgba(0,0,0,.12)", padding: 26, boxSizing: "border-box" }}>
          <div style={{ fontFamily: NY, fontSize: 30, fontWeight: 600, color: C.ink, letterSpacing: -0.4 }}>Ranní skici</div>
          <div style={{ fontFamily: SF, fontSize: 12.5, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>Tři obrazovky onboardingu. Komentáře od Terezy jsou u druhé.</div>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ position: "absolute", left: 26 + i * 98, top: 132, width: 86, height: 168, borderRadius: 8, background: "oklch(0.95 0.01 85)", boxShadow: "inset 0 0 0 .5px rgba(0,0,0,.1)" }}>
              {i === 1 ? <div style={{ position: "absolute", right: -9, top: -9, width: 20, height: 20, borderRadius: "50% 50% 50% 0", background: C.accent, color: "white", fontFamily: SF, fontSize: 10, display: "grid", placeItems: "center" }}>2</div> : null}
            </div>
          ))}
        </div>
        {/* left slip mid-slide (dashed ghost shows where it came from) */}
        <div style={{ position: "absolute", left: 14, top: 18, width: 168, height: 300, border: "1px dashed oklch(0.23 0.012 70 / .25)", borderRadius: 6 }} />
        <div style={{ ...slip, position: "absolute", left: -84, top: 26, width: 168, padding: "12px 12px", opacity: 0.92 }}>
          {["Skici", "Onboarding", "Archiv"].map((t, i) => (
            <div key={t} style={{ fontFamily: SF, fontSize: 12.5, color: C.ink, padding: "5px 2px", borderBottom: i < 2 ? "0.5px solid oklch(0.23 0.012 70 / .12)" : "none" }}>{t}</div>
          ))}
        </div>
        {/* hint pill */}
        <div style={{ position: "absolute", left: "50%", bottom: 18, transform: "translateX(-50%)", ...slip, padding: "7px 14px", display: "flex", gap: 10, alignItems: "center" }}>
          <Mark size={18} tile={C.ink} star={C.paper} />
          <span style={{ fontFamily: SF, fontSize: 12, color: C.muted }}>Nástroje ustoupily · ⌘\ je vrátí</span>
        </div>
        {/* one signal at a time — the teal comment dot is the only colour */}
        <div style={{ ...slip, position: "absolute", right: 18, top: 70, width: 196, padding: 12 }}>
          <div style={{ fontFamily: SF, fontSize: 11, color: C.accent, fontWeight: 600 }}>● Tereza · komentář</div>
          <div style={{ fontFamily: NY, fontSize: 14, color: C.ink, marginTop: 5, lineHeight: 1.35 }}>Druhá obrazovka — méně textu, víc vzduchu?</div>
        </div>
      </Scrap>
      <Tape x={120} y={226} r={5.3} color="rgba(240,236,220,.66)" />
      <Arrow x={38} y={206} w={60} h={70} color={C.accent} d="M50 6 C 34 22, 22 40, 14 64 M14 64 l -2 -12 M14 64 l 10 -7" />
      <Hand x={92} y={198} r={-3} size={16} color={C.accent} w={260}>vyjede, jen když ho chceš</Hand>

      {/* type */}
      <Scrap x={902} y={262} w={336} h={196} r={2.4} z={11} bg="#fffdf8" pad={18} clip={torn(211)} shadow="2px 7px 13px rgba(0,0,0,.22)">
        <div style={{ fontFamily: NY, fontSize: 34, fontWeight: 600, color: C.ink, lineHeight: 1.05, letterSpacing: -0.5 }}>Místo pro přemýšlení.</div>
        <div style={{ fontFamily: SF, fontSize: 13.5, color: C.muted, marginTop: 9, lineHeight: 1.45 }}>Otevři projekt, pokračuj tam, kde jsi skončil. Nic nenastavuješ.</div>
        <div style={{ fontFamily: MONO, fontSize: 8.5, color: "#a49a88", marginTop: 8 }}>display: New York (Newsreader na webu) · body: systémové sans</div>
      </Scrap>
      <Scrap x={886} y={466} w={146} h={136} r={-3.9} z={9} bg={C.paper} clip={torn(88, "b")}>
        <div style={{ fontFamily: NY, fontWeight: 600, fontStyle: "italic", fontSize: 150, lineHeight: 0.84, color: C.ink, marginLeft: 10 }}>g</div>
      </Scrap>

      {/* palette */}
      <ChipFan x={1074} y={464} r={4.4} chips={[{ c: C.paper, v: "oklch .965 .012 85", n: "papír" }, { c: C.ink, v: "oklch .23 .012 70", n: "inkoust" }, { c: C.accent, v: "oklch .60 .11 172", n: "teal" }]} />
      <Strip x={520} y={712} w={268} r={-2.3} parts={[{ c: C.paper, pct: 60, label: "papír", fg: C.ink }, { c: C.ink, pct: 30, label: "inkoust", fg: C.paper }, { c: C.accent, pct: 10, label: "", fg: "white" }]} />

      {/* feeling + voice */}
      <Hand x={468} y={172} r={-4} size={40} color={C.accent}>klid</Hand>
      <Circled x={446} y={160} w={130} h={64} color={C.accent} r={-3} />
      <Scrap x={76} y={714} w={330} h={88} r={-2.2} z={12} bg="#fffef9" pad={12} shadow="1px 5px 10px rgba(0,0,0,.2)" style={{ backgroundImage: "repeating-linear-gradient(transparent 0 19px, rgba(60,140,120,.16) 19px 20px)" }}>
        <div style={{ fontFamily: NY, fontSize: 14, color: C.ink, lineHeight: 1.45 }}>„Nástroje ustoupily. Jen ty a canvas.“</div>
        <div style={{ fontFamily: SF, fontSize: 11, color: C.muted }}>hlas: vanishing-craft — tichý řemeslník</div>
      </Scrap>
      <Pin x={234} y={708} color={C.accent} />

      {/* name + thesis */}
      <Scrap x={420} y={790} w={474} h={94} r={1.1} z={13} bg="#fdfbf5" pad={14} clip={torn(23)}>
        <div style={{ fontFamily: NY, fontSize: 22, fontWeight: 600, color: C.ink }}>Tichý papírový ateliér</div>
        <div style={{ fontFamily: SF, fontSize: 12, color: C.muted, marginTop: 4, lineHeight: 1.4 }}>Inkoust na teplém papíru. Téměř monochromní chrome z papírových proužků, který odjede; teal jen pro jeden signál.</div>
      </Scrap>
      <div style={{ position: "absolute", left: 892, top: 798, zIndex: 44, transform: "rotate(6deg)" }}><Mark size={50} tile={C.ink} star={C.accent} /></div>

      {/* provenance */}
      <Tag x={420} y={20} r={-1.6} name="Notion · Heptabase" why="Klidná typografie, dokument jako plátno; myšlení na mapě karet." url="notion.com · heptabase.com" w={178} />
      <Tag x={1040} y={782} r={-3.1} name="Procreate · Figma Minimize UI" why="Chrome jedním gestem zmizí — signature je chování, ne materiál." url="procreate.com" w={206} z={15} />
    </Board>
  );
}

/* ───────────────────────── Expanded — A base + a touch of B's play ───────────────────────── */

const M = {
  canvas: "oklch(0.978 0.005 240)",
  ink: "oklch(0.24 0.014 250)",
  muted: "oklch(0.53 0.012 250)",
  accent: "oklch(0.62 0.175 238)",
  spark: "oklch(0.66 0.2 36)",
  glass: "oklch(0.995 0.002 240 / 0.88)",
  base: "oklch(0.885 0.016 230)",
  yellow: "oklch(0.91 0.12 95)",
  green: "oklch(0.8 0.13 152)",
  lilac: "oklch(0.82 0.08 300)",
  coral: "oklch(0.82 0.1 32)",
};
const RND = '"SF Pro Rounded", ui-rounded, system-ui, sans-serif';
const MW = 1600;
const MH = 1120;

function Spark({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none"><path d="M16 3l3.2 9.8L29 16l-9.8 3.2L16 29l-3.2-9.8L3 16l9.8-3.2z" fill={color} /></svg>
  );
}

function TileMix() {
  const island: CSSProperties = { background: M.glass, backdropFilter: "blur(16px) saturate(1.5)", WebkitBackdropFilter: "blur(16px) saturate(1.5)", borderRadius: 16, boxShadow: "0 10px 30px rgba(20,30,60,.16), 0 0 0 .5px rgba(20,30,60,.12)" };
  return (
    <div style={{ position: "relative", width: MW, height: MH, overflow: "hidden", background: M.base, boxShadow: "inset 0 0 160px rgba(0,0,0,.2)" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.07, mixBlendMode: "multiply" }} />

      {/* provenance photos — glass lineage + a little FigJam / Kinopio play */}
      <Photo src="/assets/61730bab.jpg" alt="Apple macOS Tahoe — Liquid Glass" x={34} y={28} w={380} h={200} r={-2.6} />
      <Tape x={170} y={16} r={4.4} />
      <Photo src="/assets/fecffded.jpg" alt="Figma UI3" x={392} y={118} w={250} h={142} r={3.1} z={4} lip caption="Figma UI3 — malé, sbalitelné" />
      <Pin x={512} y={112} color="#d33" />
      <Photo src="/assets/330a111d.png" alt="FigJam" x={1268} y={34} w={300} h={158} r={2.9} z={3} />
      <Tape x={1380} y={22} r={-5.2} w={64} color="rgba(255,190,170,.6)" />
      <Photo src="/assets/ff57e8bd.png" alt="Kinopio" x={1328} y={176} w={226} h={118} r={-3.8} z={4} lip caption="Kinopio — barva na plátně" />
      <Photo src="/assets/6120f657.png" alt="Craft" x={1110} y={20} w={176} h={92} r={-4.6} z={5} />
      <Photo src="/assets/fbda390e.png" alt="Framer" x={34} y={862} w={220} h={116} r={-3.3} z={4} />
      <Tape x={110} y={852} r={6.1} w={58} />
      <Photo src="/assets/175329c6.png" alt="Kinopio mascot" x={1474} y={500} w={104} h={90} r={8.4} z={6} fit="contain" shadow="1px 4px 8px rgba(0,0,0,.2)" />

      {/* 3 · signature treatment + 6 · real UI fragment: frosted islands over a full-window canvas, a rounder dock, spark only for AI */}
      <Scrap x={262} y={272} w={912} h={560} r={-0.8} z={8} bg={M.canvas} shadow="5px 16px 34px rgba(10,20,50,.3)" style={{ borderRadius: 12 }}>
        <Dots color="oklch(0.83 0.01 240)" pitch={20} />
        {/* artboard + colourful stickies: colour lives on the canvas */}
        <div style={{ position: "absolute", left: 250, top: 70, width: 330, height: 330, borderRadius: 8, background: "white", boxShadow: "0 2px 12px rgba(0,0,0,.12)", overflow: "hidden" }}>
          <div style={{ height: 170, background: "linear-gradient(150deg, oklch(0.8 0.12 70), oklch(0.68 0.17 25) 60%, oklch(0.5 0.13 300))" }} />
          <div style={{ padding: 18 }}>
            <div style={{ fontFamily: SFD, fontWeight: 700, fontSize: 22, color: M.ink, letterSpacing: -0.4 }}>Homepage</div>
            <div style={{ fontFamily: SF, fontSize: 12.5, color: M.muted, marginTop: 6 }}>Hero, ceník a patička.</div>
            <div style={{ display: "inline-block", marginTop: 14, padding: "7px 14px", borderRadius: 999, background: M.ink, color: "white", fontFamily: SF, fontSize: 12, fontWeight: 600 }}>Get the app</div>
          </div>
          <div style={{ position: "absolute", inset: -2, border: `2px solid ${M.accent}`, borderRadius: 9 }} />
        </div>
        {[
          { l: 600, t: 84, c: M.yellow, tx: "Větší fotka v hero?", rr: 3.2 },
          { l: 618, t: 214, c: M.green, tx: "CTA nahoru", rr: -2.4 },
          { l: 590, t: 330, c: M.lilac, tx: "Mobil první", rr: 1.6 },
        ].map((s) => (
          <div key={s.tx} style={{ position: "absolute", left: s.l, top: s.t, width: 118, height: 104, background: s.c, transform: `rotate(${s.rr}deg)`, boxShadow: "0 6px 12px rgba(0,0,0,.13)", fontFamily: RND, fontWeight: 600, fontSize: 14.5, color: M.ink, padding: 11, boxSizing: "border-box", borderRadius: 4 }}>{s.tx}</div>
        ))}
        {/* AI's live cursor — the spark */}
        <div style={{ position: "absolute", left: 548, top: 300, display: "flex", alignItems: "center", gap: 4 }}>
          <svg width="18" height="18" viewBox="0 0 16 16"><path d="M3 2l9 4.4-4 1.1-1.1 4z" fill={M.spark} stroke="white" strokeWidth="1" /></svg>
          <span style={{ fontFamily: RND, fontSize: 11.5, fontWeight: 600, color: "white", background: M.spark, borderRadius: 999, padding: "2px 8px" }}>AI kreslí…</span>
        </div>

        {/* top-left: one menu under the icon + project name */}
        <div style={{ ...island, position: "absolute", left: 16, top: 16, height: 40, display: "flex", alignItems: "center", gap: 9, padding: "0 13px 0 8px", borderRadius: 13 }}>
          <Mark size={24} tile={M.accent} star="white" />
          <span style={{ fontFamily: SF, fontSize: 13, fontWeight: 600, color: M.ink }}>Homepage</span>
          <span style={{ fontFamily: SF, fontSize: 11, color: M.muted }}>⌄</span>
        </div>
        {/* left island: canvases */}
        <div style={{ ...island, position: "absolute", left: 16, top: 68, width: 196, padding: "11px 10px 12px" }}>
          <div style={{ fontFamily: SF, fontSize: 11, fontWeight: 600, color: M.muted, margin: "0 4px 7px" }}>Canvasy</div>
          {[
            ["Homepage", M.coral],
            ["Onboarding", M.yellow],
            ["Ceník", M.green],
            ["Mobil — detail", M.lilac],
          ].map(([t, c], i) => (
            <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: SF, fontSize: 12.5, fontWeight: i === 0 ? 600 : 400, color: M.ink, background: i === 0 ? "oklch(0.62 0.175 238 / .12)" : "transparent", borderRadius: 8, padding: "6px 7px", marginBottom: 2 }}>
              <span style={{ width: 22, height: 16, borderRadius: 4, background: c, boxShadow: "inset 0 0 0 .5px rgba(0,0,0,.1)" }} />
              {t}
            </div>
          ))}
        </div>
        {/* collapsed right panel → a single icon */}
        <div style={{ ...island, position: "absolute", right: 16, top: 16, display: "flex", gap: 4, padding: 4, borderRadius: 13 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, display: "grid", placeItems: "center" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={M.ink} strokeWidth="1.4"><rect x="2" y="3" width="12" height="10" rx="2.2" /><line x1="10" y1="3" x2="10" y2="13" /></svg>
          </div>
          <div style={{ padding: "0 12px", height: 32, borderRadius: 10, background: M.accent, color: "white", fontFamily: SF, fontSize: 12.5, fontWeight: 600, display: "grid", placeItems: "center" }}>Sdílet</div>
        </div>
        {/* AI island — simple mode; the spark marks AI, azure stays functional */}
        <div style={{ ...island, position: "absolute", right: 16, bottom: 92, width: 286, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Spark size={16} color={M.spark} />
            <span style={{ fontFamily: RND, fontSize: 13, fontWeight: 700, color: M.ink }}>AI</span>
          </div>
          <div style={{ fontFamily: SF, fontSize: 12.5, lineHeight: 1.4, color: M.ink, background: "oklch(1 0 0 / .75)", borderRadius: 11, padding: "8px 10px" }}>Hotovo — tři varianty hero jsou na canvasu. Vyber si.</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9, padding: "7px 7px 7px 10px", borderRadius: 12, background: "oklch(1 0 0 / .8)", boxShadow: "inset 0 0 0 .5px rgba(0,0,0,.12)" }}>
            <span style={{ fontFamily: SF, fontSize: 11, color: M.accent, background: "oklch(0.62 0.175 238 / .1)", borderRadius: 6, padding: "2px 6px" }}>◆ hero</span>
            <span style={{ flex: 1, fontFamily: SF, fontSize: 12.5, color: M.muted }}>Zeptej se AI…</span>
            <span style={{ width: 26, height: 26, borderRadius: 9, background: M.spark, display: "grid", placeItems: "center" }}><Spark size={13} color="white" /></span>
          </div>
        </div>
        {/* rounder, friendlier dock */}
        <div style={{ ...island, position: "absolute", left: "50%", bottom: 16, transform: "translateX(-50%)", height: 56, display: "flex", alignItems: "center", gap: 5, padding: "0 9px", borderRadius: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 13, background: M.accent, display: "grid", placeItems: "center" }}>
            <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="white" strokeWidth="1.6" strokeLinejoin="round"><path d="M4 3l9 4.5-4 1.2L8 13z" /></svg>
          </div>
          {["M2 8h12M8 2v12", "M3 12l5-9 5 9z", "M3 4h10M3 8h7M3 12h9"].map((d) => (
            <div key={d} style={{ width: 40, height: 40, borderRadius: 13, display: "grid", placeItems: "center" }}>
              <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke={M.ink} strokeWidth="1.5" strokeLinejoin="round"><path d={d} /></svg>
            </div>
          ))}
          <div style={{ width: 1, height: 24, background: "rgba(0,0,0,.12)", margin: "0 4px" }} />
          {[M.yellow, M.green, M.lilac, M.coral].map((c, i) => (
            <div key={c} style={{ width: 40, height: 40, borderRadius: 13, display: "grid", placeItems: "center" }}>
              <div style={{ width: 22, height: 22, borderRadius: 5, background: c, transform: `rotate(${[-6, 4, -3, 7][i]}deg)`, boxShadow: "0 2px 4px rgba(0,0,0,.14)" }} />
            </div>
          ))}
        </div>
      </Scrap>
      <Tape x={288} y={262} r={-7.4} />
      <Tape x={1110} y={812} r={5.8} w={70} />
      <Pin x={742} y={266} color={M.spark} />

      {/* collapse sequence: island → icon */}
      <Scrap x={1186} y={326} w={286} h={150} r={2.3} z={11} bg={M.canvas} pad={14} shadow="2px 8px 15px rgba(0,0,0,.22)" style={{ borderRadius: 8 }}>
        <div style={{ fontFamily: SF, fontSize: 11, fontWeight: 600, color: M.muted, marginBottom: 10 }}>sbalit do ikony · ⌘\</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ ...island, width: 108, height: 84, padding: 8 }}>
            {[0, 1, 2].map((i) => <div key={i} style={{ height: 8, borderRadius: 4, background: i ? "rgba(0,0,0,.08)" : "oklch(0.62 0.175 238 / .35)", marginBottom: 8 }} />)}
          </div>
          <svg width="40" height="16" viewBox="0 0 40 16" fill="none" stroke={M.accent} strokeWidth="2" strokeLinecap="round"><path d="M2 8h32M28 3l6 5-6 5" /></svg>
          <div style={{ ...island, width: 36, height: 36, borderRadius: 11, display: "grid", placeItems: "center" }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke={M.ink} strokeWidth="1.4"><rect x="2" y="3" width="12" height="10" rx="2.2" /><line x1="6" y1="3" x2="6" y2="13" /></svg>
          </div>
        </div>
      </Scrap>
      <Tape x={1290} y={316} r={-3.6} w={60} />

      {/* 2 · type pairing */}
      <Scrap x={660} y={40} w={420} h={214} r={1.6} z={11} bg="#fefefe" pad={20} clip={torn(301)} shadow="2px 8px 14px rgba(0,0,0,.2)">
        <div style={{ fontFamily: SFD, fontSize: 36, fontWeight: 650, letterSpacing: -0.8, color: M.ink, lineHeight: 1.04 }}>Tvůj canvas je připravený.</div>
        <div style={{ fontFamily: SF, fontSize: 14, color: M.muted, marginTop: 9, lineHeight: 1.45 }}>Požádej AI o první obrazovku, nebo začni kreslit. Nic nenastavuješ.</div>
        <div style={{ fontFamily: RND, fontSize: 18, fontWeight: 700, color: M.spark, marginTop: 10 }}>Co dnes vytvoříme?</div>
        <div style={{ fontFamily: MONO, fontSize: 9, color: "#9aa0aa", marginTop: 7 }}>SF Pro Display 650 · SF Pro Text · SF Pro Rounded (hravá místa) · SF Mono jen v Advanced</div>
      </Scrap>
      <Scrap x={1196} y={496} w={164} h={176} r={-4.1} z={9} bg={M.canvas} clip={torn(97, "b")}>
        <div style={{ fontFamily: RND, fontWeight: 800, fontSize: 168, lineHeight: 0.86, color: M.accent, marginLeft: 8 }}>a</div>
      </Scrap>
      <Scrap x={1346} y={624} w={150} h={150} r={5.2} z={8} bg="white" clip={torn(55, "b")}>
        <div style={{ fontFamily: SFD, fontWeight: 700, fontSize: 150, lineHeight: 0.88, color: M.ink, marginLeft: 12 }}>A</div>
      </Scrap>

      {/* 1 · palette */}
      <ChipFan x={1166} y={792} r={-3.4} chips={[
        { c: M.canvas, v: "oklch .978 .005 240", n: "canvas" },
        { c: M.ink, v: "oklch .24 .014 250", n: "inkoust" },
        { c: M.accent, v: "oklch .62 .175 238", n: "azure — akce" },
        { c: M.spark, v: "oklch .66 .20 36", n: "jiskra — AI" },
        { c: M.yellow, v: "oklch .91 .12 95", n: "sticky" },
      ]} />
      <Strip x={846} y={868} w={300} r={2.1} parts={[{ c: M.canvas, pct: 60, label: "canvas", fg: M.ink }, { c: "oklch(0.995 0.002 240)", pct: 30, label: "sklo", fg: M.ink }, { c: M.accent, pct: 8, label: "", fg: "white" }, { c: M.spark, pct: 2, label: "", fg: "white" }]} />
      <Hand x={862} y={940} r={-2} size={15} color={M.muted} w={300}>azure = akce & výběr · jiskra = jen AI</Hand>
      <Arrow x={1080} y={958} w={90} h={40} color={M.spark} d="M4 30 C 30 34, 60 26, 84 10 M84 10 l -11 1 M84 10 l -4 10" />

      {/* 4 · feeling + voice */}
      <Hand x={60} y={248} r={-6} size={40} color={M.accent} z={42}>lehkost</Hand>
      <Circled x={38} y={234} w={190} h={72} color={M.accent} r={-5} z={43} />
      <Hand x={1188} y={258} r={4} size={30} color={M.spark} z={42}>+ trochu hry</Hand>
      <Scrap x={300} y={880} w={340} h={98} r={-1.4} z={12} bg="#fffef8" pad={13} shadow="1px 5px 10px rgba(0,0,0,.2)" style={{ backgroundImage: "repeating-linear-gradient(transparent 0 19px, rgba(80,120,200,.18) 19px 20px)" }}>
        <div style={{ fontFamily: SF, fontSize: 14, color: M.ink, lineHeight: 1.45 }}>„Hotovo — tři varianty jsou na canvasu. Vyber si.“</div>
        <div style={{ fontFamily: SF, fontSize: 14, color: M.ink, lineHeight: 1.45 }}>„Panely schované. ⌘\ je vrátí.“</div>
        <div style={{ fontFamily: SF, fontSize: 11, color: M.muted }}>hlas: quiet-pro s teplým dotekem</div>
      </Scrap>
      <Tape x={420} y={868} r={2.8} w={60} />

      {/* 5 · name + thesis + provenance */}
      <Scrap x={300} y={996} w={560} h={100} r={1.1} z={13} bg="#fbfbfa" pad={15} clip={torn(19)}>
        <div style={{ fontFamily: SFD, fontSize: 23, fontWeight: 700, color: M.ink, letterSpacing: -0.3 }}>Lehké sklo s jiskrou</div>
        <div style={{ fontFamily: SF, fontSize: 12.5, color: M.muted, marginTop: 4, lineHeight: 1.4 }}>Mac-nativní matné ostrůvky nad canvasem přes celé okno + trocha hry z dílny: barvy na plátně, kulatější dock, jiskra jen pro AI.</div>
      </Scrap>
      <div style={{ position: "absolute", left: 822, top: 970, zIndex: 44, transform: "rotate(9deg)" }}><Mark size={58} tile={M.accent} star="white" /></div>
      <div style={{ position: "absolute", left: 876, top: 1022, zIndex: 44, transform: "rotate(-7deg)" }}><Mark size={40} tile={M.spark} star="white" /></div>
      <Tag x={22} y={600} r={-2.2} name="Figma UI3 — poučení" why="Floating panely v Designu stáhli (zpomalovaly, ubíraly canvas, design vykukoval). Proto: malé, ~88 % neprůhledné, sbalitelné; ukotvený režim v Advanced." url="figma.com/blog/our-approach-to-designing-ui3" w={226} z={15} />
      <Tag x={26} y={444} r={1.8} name="Apple Liquid Glass · Craft" why="Sklo jen na navigační vrstvě. Craft = laťka „nainstaluj a tvoř“." url="developer.apple.com/videos/play/wwdc2025/310" w={200} z={14} />
      <Tag x={1376} y={914} r={2.6} name="FigJam · Kinopio" why="Barvy objektů na plátně, chrome klidný; panely plavou a sbalí se." url="figma.com/figjam · kinopio.club" w={196} />
      <Hand x={1260} y={1050} r={-3} size={15} color="#c0392b" w={300}>NE: sklo všude · jiskra jako dekorace</Hand>
    </div>
  );
}

export default function MaudeV2Moodboard() {
  return (
    <DesignCanvas>
      <DCSection id="picked" title="maude-v2 — vybraný směr (A + hravost z B)">
        <DCArtboard id="direction-mix" label="Lehké sklo s jiskrou · expanded" width={MW} height={MH}>
          <TileMix />
        </DCArtboard>
      </DCSection>
      <DCSection id="directions" title="maude-v2 — směry (Stage 3)">
        <DCArtboard id="direction-a" label="Mac-nativní lehké sklo · glass-over-canvas" width={W} height={H}>
          <TileA />
        </DCArtboard>
        <DCArtboard id="direction-b" label="Hravá dílna s jiskrou · playful-workshop" width={W} height={H}>
          <TileB />
        </DCArtboard>
        <DCArtboard id="direction-c" label="Tichý papírový ateliér · paper-studio" width={W} height={H}>
          <TileC />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
