/**
 * @canvas      01 Create Flow — making a canvas and working on it, told as a story on two real projects
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   cf-home-prompt | cf-ai-drafting | cf-ai-done | cf-select-tweak | cf-sticky-comment | cf-undo-before | cf-undo-ai |
 *              cf-blank | cf-add-artboard | cf-duplicate-width | cf-duplicate-done | cf-frames-text |
 *              cf-big-tree | cf-panel-search | cf-search-k | cf-open-big |
 *              cf-busy | cf-status-words | cf-render-error | cf-offline-create
 * @brief       "zakladni user flow tvorby a praci s canvasem" — the basic flow of creating and working on a
 *              canvas, drawn as edge cases on real projects (Studio site = simple, Alligators brand = 93 canvases).
 *
 * Convention: every app artboard is a <Stage> — a 1440 × 900 window with its note strip underneath
 * (artboard 1440 × 980). Close-ups are sized to content. All chrome comes from ./_kit; the few local
 * pieces (preset list, error card, status board, page close-up, ghost outline, gap guides, presence
 * ring, legend) use the `cf-` prefix. The empty canvas is lifted from the DS empty-state specimen.
 *
 * Scale honesty: every frame draws its artboards at ONE zoom and the zoom readout says that zoom
 * (Landing 28%, Combine-kampan 20%, busy 22%, fit-to-view 10%, text close-up 56%).
 * Combine-kampan is drawn as it really is — 21 artboards, 19 fixed size + 2 print (08 Artboard Kinds).
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "../../system/maude-v2/preview/empty-state.css";
import "./_kit.css";
import "./01 Create Flow.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import type { CSSProperties, ReactNode } from "react";
import {
  AIPanel, ALLIGATORS_COUNT, ALLIGATORS_FOLDERS, ALLIGATORS_ROOT, Artboard, Canvas, CanvasesPanel, CommentPin, Cursor, GatorMock, HeroMock, Home, Icon, InButton, InFill, InNum,
  InSeg, InSelect, InSize, InSwitch, Inspector, Menu, Note, PanelIcon, PhoneMock, ProjectPill, SearchPalette,
  Selection, ShareCluster, Spark, Stage, Sticky, TABS, Toast, Toolbar, V2, Veil, Window, ZoomUndo,
} from "./_kit";
import type { Art, CanvasItem, Folder } from "./_kit";

const W = 1440;
const H = 980;

/* ─── Studio site: the simple project ────────────────────────────────────────────────────── */
const STUDIO: CanvasItem[] = [
  { name: "Homepage", art: "home" },
  { name: "Pricing", art: "price", people: ["tereza"] },
  { name: "Onboarding", art: "onb" },
  { name: "Mobile — detail", art: "mobile" },
];
/** Home before Landing page exists: Studio site has its 4 canvases (5 once the draft lands). */
const HOME_PROJECTS_BEFORE = [
  { name: "Studio site", arts: ["home", "price", "onb"] as [Art, Art, Art], meta: "4 canvases", ini: "S", tone: "yellow" as const },
  { name: "Alligators brand", arts: ["gator-poster", "gator-web", "gator-reel"] as [Art, Art, Art], meta: "93 canvases", ini: "A", tone: "lilac" as const },
];
const PROMPT = "A calm landing page for Studio site — hero, three services, a pricing teaser";

/* The new "Landing page" canvas at 28%: Desktop 1440 × 900 → 403 × 252, Tablet 834 × 1194 → 234 × 334,
   Mobile 390 × 844 → 109 × 236. `room` = the same zoom, panned left to make room for the inspector. */
const LANDING_ZOOM = 28;
type Cam = "open" | "room";
const CAMS: Record<Cam, { d: [number, number]; t: [number, number]; m: [number, number] }> = {
  open: { d: [296, 120], t: [727, 120], m: [989, 120] },
  room: { d: [96, 132], t: [527, 132], m: [789, 132] },
};

function Landing({
  cam = "open", drawing = false, sel, darkHero = false, made = false, desk, children,
}: { cam?: Cam; drawing?: boolean; sel?: "desktop"; darkHero?: boolean; made?: boolean; desk?: { w: number; size: string }; children?: ReactNode }) {
  const g = CAMS[cam];
  const dw = desk?.w ?? 403;
  return (
    <>
      <Artboard label="Desktop" kind="web" x={g.d[0]} y={g.d[1]} w={dw} h={252} selected={sel === "desktop"} size={desk?.size ?? "1440 × 900"} aiMade={made || drawing}>
        {darkHero ? <div className="cf-dark-hero"><HeroMock /></div> : <HeroMock />}
      </Artboard>
      <Artboard label="Tablet" kind="web" x={g.t[0]} y={g.t[1]} w={234} h={334} aiWorking={drawing ? "AI is drawing Tablet" : undefined} aiMade={made}>
        {drawing ? <div className="cf-drawing"><HeroMock headline="Calm software," sub="" cta="See the work" /></div> : <HeroMock headline="Calm software, made in Brno." />}
      </Artboard>
      {drawing ? (
        <span className="cf-ghost" style={{ left: g.m[0], top: g.m[1], width: 109, height: 236 }}><span className="cf-ghost-l"><Spark size={9} />Mobile — next</span></span>
      ) : (
        <Artboard label="Mobile" kind="web" x={g.m[0]} y={g.m[1]} w={109} h={236} aiMade={made}>
          <PhoneMock title="Calm software" tone="sky" />
        </Artboard>
      )}
      {children}
    </>
  );
}

function StudioChrome({ canvas = "Landing page", left = true, ai, insp, tool = "select", zoom = LANDING_ZOOM, status = "saved" as const, selected = "Landing page", landingAi = false, items }: { canvas?: string; left?: boolean; ai?: ReactNode; insp?: ReactNode; tool?: string; zoom?: number; status?: "saved" | "syncing" | "offline" | "local"; selected?: string; landingAi?: boolean; items?: CanvasItem[] }) {
  return (
    <>
      <ProjectPill project="Studio site" canvas={canvas} />
      {left ? (
        <CanvasesPanel advanced project="Studio site" count={(items?.length ?? 4) + 1} selected={selected} items={[...(items ?? STUDIO), { name: "Landing page", art: "home", ai: landingAi ? "AI is drawing" : undefined }]} />
      ) : (
        <PanelIcon icon="panel-left" at="left" />
      )}
      <ShareCluster people={["tereza"]} status={status} mode="edit" />
      {insp}
      <ZoomUndo zoom={zoom} />
      <Toolbar tool={tool} />
      {ai}
    </>
  );
}

/* ─── Alligators brand: the complicated project (modelled on ~/Maude/alligators) ─────────── */
/* The kit's canonical tree — 93 canvases: 2026 (combine 6 + dresy 4 + social 6 = 16) + club-web 9 + print 6 + social 31
   + legacy 27 + 4 at the root. Here Combine-video-AI carries the spark of a chat running there. */
const GATOR_FOLDERS: Folder[] = ALLIGATORS_FOLDERS.map((f) => f.name !== "2026" ? f : {
  ...f, folders: f.folders?.map((sf) => sf.name !== "combine" ? sf : {
    ...sf, items: sf.items?.map((it) => it.name === "Combine-video-AI" ? { ...it, ai: "AI is cutting the teaser" } : it),
  }),
});
const GATOR_JUNK: CanvasItem[] = ALLIGATORS_ROOT;
/** The same tree after ⌘N offline: one new local canvas in 2026/social (94; 2026 → 17, social → 7). */
const OFFLINE_FOLDERS: Folder[] = ALLIGATORS_FOLDERS.map((f) => f.name !== "2026" ? f : {
  ...f, count: (f.count ?? 0) + 1, folders: f.folders?.map((sf) => sf.name === "combine" ? { ...sf, open: false } : sf.name !== "social" ? sf : {
    ...sf, open: true, count: (sf.count ?? 0) + 1, items: [
      { name: "Super-Bowl-Watch-Party", art: "gator-social" },
      { name: "Reprezentace-U19", art: "gator-social" },
      { name: "Krpole-v-pohybu", art: "gator-reel", kinds: ["video"] },
      { name: "Krpole-v-pohybu-2", art: "blank", local: true },
      { name: "summer-camp", art: "gator-poster" },
      { name: "Flag-turnaj-jaro", art: "gator-social" },
      { name: "Merch-drop", art: "gator-jersey" },
    ],
  }),
});
const GATOR_TABS = [TABS.studio, TABS.alligators];

/* Combine-kampan as it really is (08 Artboard Kinds · 11 Projects and Navigation): 21 artboards — 19 fixed size
   (social) + 2 print sheets — in the real file's rows: plan · event covers + IG announcement · the disciplines
   carousel · posts and stories · the score card (two A4-landscape print sheets). */
type KA = { label: string; kind: "digital" | "print"; w: number; h: number; body: ReactNode };
const SLIDES = ["40 YARD DASH", "BENCH PRESS", "VERTICAL JUMP", "BROAD JUMP", "3-CONE DRILL", "20-YARD SHUTTLE", "POSITION DRILLS"];
const FB = { w: 1920, h: 1005 };
const POST = { w: 1080, h: 1350 };
const STORY = { w: 1080, h: 1920 };
const ARCH = { w: 1144, h: 816 };
const KA_PLAN: KA = { label: "Release plan · Combine 2026 (4 týdny)", kind: "digital", w: 1920, h: 2760, body: <div className="cf-plan"><b /><i /><i /><i /><i /><i /><i /></div> };
const KA_EVENT: KA[] = [
  { label: "FB event cover · FB Event · 1.91:1", kind: "digital", ...FB, body: <GatorMock variant="web" headline="COMBINE 1. 10." sub="" /> },
  { label: "FB event cover · varianta B, datum vpředu", kind: "digital", ...FB, body: <GatorMock variant="web" headline="ST 1. 10. · 9:00" sub="" /> },
  { label: "FB event cover · varianta C, žlutá", kind: "digital", ...FB, body: <GatorMock variant="invite" headline="COMBINE 2026" sub="" /> },
  { label: "FB event cover · kontrola safe zóny (nenahrávat)", kind: "digital", ...FB, body: <GatorMock variant="web" headline="COMBINE 1. 10." sub="" /> },
  { label: "Oznámení události · Instagram · IG Post · 4:5", kind: "digital", ...POST, body: <GatorMock variant="social" headline="COMBINE 1. 10." sub="CESA VUT" /> },
];
const KA_CAROUSEL: KA[] = [
  { label: "Carousel cover · sedm disciplín · IG Post · 4:5", kind: "digital", ...POST, body: <GatorMock variant="poster" headline="SEDM DISCIPLÍN" sub="" /> },
  ...SLIDES.map((d, i): KA => ({ label: `Slide 0${i + 1} · ${d} · IG Post · 4:5`, kind: "digital", ...POST, body: <GatorMock variant="numbers" headline={d} /> })),
  { label: "Přehled všech sedmi · IG Post · 4:5", kind: "digital", ...POST, body: <GatorMock variant="numbers" headline="PŘEHLED" /> },
];
const KA_POSTS: KA[] = [
  { label: "Pozvánka na combine · IG Post · 4:5", kind: "digital", ...POST, body: <GatorMock variant="social" headline="COMBINE 2026" sub="1. 10." /> },
  { label: "Obálka videosérie · pozvánka od hosta · IG Story · 9:16", kind: "digital", ...STORY, body: <GatorMock variant="reel" headline="HOST ZE ZÁMOŘÍ" sub="díl 1 ze 6" /> },
  { label: "Pozvánka · story · IG Story · 9:16", kind: "digital", ...STORY, body: <GatorMock variant="reel" headline="ZAPIŠ SE" sub="do 25. 9." /> },
  { label: "Zítra se měří · countdown story · IG Story · 9:16", kind: "digital", ...STORY, body: <GatorMock variant="reel" headline="ZÍTRA" sub="9:00" /> },
  { label: "Arch 1 · vnějšek (str. 4 + str. 1) · A4 landscape, spadávka 3 mm", kind: "print", ...ARCH, body: <GatorMock variant="print" headline="SCORE CARD" sub="" /> },
  { label: "Arch 2 · vnitřek (str. 2 + str. 3) · A4 landscape, spadávka 3 mm", kind: "print", ...ARCH, body: <GatorMock variant="print" headline="VÝSLEDKY" sub="" /> },
];

/** One real artboard at a zoom (z = 0.2 → 20%). */
function KA_({ a, x, y, z, dim, selected, size }: { a: KA; x: number; y: number; z: number; dim?: boolean; selected?: boolean; size?: string }) {
  return <Artboard label={a.label} kind={a.kind} x={x} y={y} w={Math.round(a.w * z)} h={Math.round(a.h * z)} dim={dim} selected={selected} size={size}>{a.body}</Artboard>;
}

/* Combine-kampan at 20%, scrolled to its event row and score card: FB cover 1920 × 1005 → 384 × 201,
   IG post 4:5 1080 × 1350 → 216 × 270, IG story 9:16 → 216 × 384, A4 landscape sheet 1144 × 816 → 229 × 163. */
const KAMPAN_ZOOM = 20;
function KampanSlice({ dim = false }: { dim?: boolean }) {
  const z = KAMPAN_ZOOM / 100;
  return (
    <>
      <KA_ a={KA_EVENT[0]} x={320} y={110} z={z} dim={dim} />
      <KA_ a={KA_EVENT[4]} x={744} y={110} z={z} dim={dim} />
      <KA_ a={KA_POSTS[2]} x={1000} y={110} z={z} dim={dim} />
      <KA_ a={KA_POSTS[4]} x={320} y={420} z={z} dim={dim} />
      <KA_ a={KA_POSTS[5]} x={589} y={420} z={z} dim={dim} />
    </>
  );
}

/* All 21 at fit-to-view, 10%: the plan on the left, then the file's three rows. */
const FIT_ZOOM = 10;
function KampanFit() {
  const z = FIT_ZOOM / 100;
  const x1 = 306;
  const rowA = 150;
  const rowB = rowA + Math.round(POST.h * z) + 38;
  const rowC = rowB + Math.round(POST.h * z) + 38;
  const step = (w: number) => Math.round(w * z) + 12;
  let xa = x1; let xc = x1;
  return (
    <>
      <KA_ a={KA_PLAN} x={90} y={rowA} z={z} />
      {KA_EVENT.map((a) => { const x = xa; xa += step(a.w); return <KA_ key={a.label} a={a} x={x} y={rowA} z={z} />; })}
      {KA_CAROUSEL.map((a, i) => <KA_ key={a.label} a={a} x={x1 + i * step(POST.w)} y={rowB} z={z} />)}
      {KA_POSTS.map((a) => { const x = xc; xc += step(a.w); return <KA_ key={a.label} a={a} x={x} y={rowC} z={z} />; })}
    </>
  );
}

/* ─── Local pieces (kit candidates) ──────────────────────────────────────────────────────── */

/** The preset list under the inspector's Preset field — grouped by artboard kind. */
function PresetList() {
  return (
    <div className="k-menu cf-presets">
      <span className="k-mgroup cf-pg"><Icon name="web" size={12} />Web</span>
      {[["Desktop", "1440 × 900"], ["Laptop", "1280 × 800"], ["Tablet", "834 × 1194"], ["Mobile", "390 × 844"]].map(([a, b]) => (
        <span key={a} className="row-item k-mi" data-hl={a === "Laptop" ? "true" : undefined}><span className="k-mi-lab">{a}</span><span className="k-mi-keys">{b}</span></span>
      ))}
      <span className="k-msep" />
      <span className="k-mgroup cf-pg"><Icon name="digital" size={12} />Social</span>
      {[["Post", "1080 × 1080"], ["Story", "1080 × 1920"]].map(([a, b]) => (
        <span key={a} className="row-item k-mi"><span className="k-mi-lab">{a}</span><span className="k-mi-keys">{b}</span></span>
      ))}
      <span className="k-msep" />
      <span className="k-mgroup cf-pg"><Icon name="print" size={12} />Print</span>
      {[["A4", "210 × 297 mm"], ["A5", "148 × 210 mm"], ["Letter", "8.5 × 11 in"]].map(([a, b]) => (
        <span key={a} className="row-item k-mi"><span className="k-mi-lab">{a}</span><span className="k-mi-keys">{b}</span></span>
      ))}
      <span className="k-msep" />
      <span className="k-mgroup cf-pg"><Icon name="video" size={12} />Video</span>
      {[["Landscape 16:9", "1920 × 1080"], ["Vertical 9:16", "1080 × 1920"]].map(([a, b]) => (
        <span key={a} className="row-item k-mi"><span className="k-mi-lab">{a}</span><span className="k-mi-keys">{b}</span></span>
      ))}
    </div>
  );
}

/** Desktop artboard drawn large, with real frames inside (for the text-in-place close-up). */
function DesktopPage() {
  return (
    <div className="cf-page">
      <div className="cf-page-nav"><b /><span>Work</span><span>Services</span><span>Pricing</span><em>Book a call</em></div>
      <div className="cf-page-hero">
        <div className="cf-page-copy">
          <strong className="cf-page-h1">Calm software, made in Brno<i className="k-caretline cf-caret" /></strong>
          <span>A small studio for product and brand.</span>
          <em>See the work</em>
        </div>
        <div className="cf-page-art"><span className="cf-sun" /><span className="cf-hill" /></div>
      </div>
      <div className="cf-page-services">
        <span><b className="cf-dot cf-dot--coral" />Product design</span>
        <span><b className="cf-dot cf-dot--green" />Brand systems</span>
        <span><b className="cf-dot cf-dot--lilac" />Small apps</span>
      </div>
    </div>
  );
}

/** The four save-status words, side by side (close-up). */
function StatusBoard() {
  const rows: { status: "saved" | "syncing" | "offline" | "local"; t: string; d: string }[] = [
    { status: "saved", t: "Saved", d: "Everything is in the cloud. Nothing to do." },
    { status: "syncing", t: "Syncing…", d: "Changes are on their way up. Keep working." },
    { status: "offline", t: "Offline — kept on this Mac", d: "Every change stays on this Mac and goes up by itself once it's online." },
    { status: "local", t: "Local project", d: "Lives only on this Mac. Share offers to move it to the cloud." },
  ];
  return (
    <div className="cf-status">
      {rows.map((r) => (
        <div className="cf-status-row" key={r.status}>
          <div className="cf-status-chrome"><ShareCluster people={r.status === "local" ? [] : ["tereza", "jonas"]} status={r.status} mode="edit" style={{ position: "relative", right: "auto", top: "auto" }} /></div>
          <p className="cf-status-txt"><strong>{r.t}</strong>{r.d}</p>
        </div>
      ))}
    </div>
  );
}

/** Spacing guide between two artboards: an azure line + the gap in canvas px (Figma-style, in the accent). */
function GapGuide({ x, y, len, dir = "v", value }: { x: number; y: number; len: number; dir?: "v" | "h"; value: string }) {
  const style: CSSProperties = dir === "v" ? { left: x, top: y, height: len } : { left: x, top: y, width: len };
  return <span className={`cf-gap cf-gap--${dir}`} style={style}><span className="cf-gap-v">{value}</span></span>;
}

/* ─── The empty canvas — lifted from 05 Empty States (`Empty size="canvas" spot="canvas"`): the
       spot-empty-canvas art (dot field, page, three stickies), the CONTRACT line, Ask AI ⌘/. Offline keeps
       Ask AI on (CONTRACT §7), quiets the spot and adds "AI is back when this Mac is online." Kit candidate
       `EmptyCanvas` (01 · 02 · 05 draw the same block). ─── */
const DOT_RINGS: [string, number][] = [
  ["88,40 104,40 120,40 136,40 152,40 56,56 72,56 88,56 104,56 120,56 136,56 152,56 168,56 184,56 56,72 72,72 88,72 104,72 120,72 136,72 152,72 168,72 184,72 56,88 72,88 88,88 104,88 120,88 136,88 152,88 168,88 184,88 56,104 72,104 88,104 104,104 120,104 136,104 152,104 168,104 184,104 88,120 104,120 120,120 136,120 152,120", 1],
  ["72,24 88,24 104,24 120,24 136,24 152,24 168,24 40,40 56,40 72,40 168,40 184,40 200,40 40,56 200,56 24,72 40,72 200,72 216,72 24,88 40,88 200,88 216,88 40,104 200,104 40,120 56,120 72,120 168,120 184,120 200,120 72,136 88,136 104,136 120,136 136,136 152,136 168,136", 0.6],
  ["72,8 88,8 104,8 120,8 136,8 152,8 168,8 40,24 56,24 184,24 200,24 24,40 216,40 8,56 24,56 216,56 232,56 8,72 232,72 8,88 232,88 8,104 24,104 216,104 232,104 24,120 216,120 40,136 56,136 184,136 200,136 72,152 88,152 104,152 120,152 136,152 152,152 168,152", 0.3],
];
const LINE = { stroke: "var(--fg-2)", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function SpotSticky({ x, y, s, rot, fill, lines = 2 }: { x: number; y: number; s: number; rot: number; fill: string; lines?: number }) {
  const p = s * 0.2;
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot} ${s / 2} ${s / 2})`}>
      <rect x="0" y="2" width={s} height={s} rx="4" fill="var(--object-ink)" opacity="0.08" />
      <rect x="0" y="0" width={s} height={s} rx="4" fill={fill} {...LINE} />
      <line x1={p} y1={p} x2={s - p} y2={p} stroke="var(--object-ink)" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" />
      {lines > 1 ? <line x1={p} y1={p + 6} x2={p + (s - 2 * p) * 0.6} y2={p + 6} stroke="var(--object-ink)" strokeWidth="1.5" strokeLinecap="round" opacity="0.35" /> : null}
    </g>
  );
}
function EmptyCanvas({ offline = false }: { offline?: boolean }) {
  return (
    <div className="cf-empty">
      <svg className={`cf-spot${offline ? " cf-spot--quiet" : ""}`} width={240} height={160} viewBox="0 0 240 160" fill="none" aria-hidden="true">
        {DOT_RINGS.map(([pts, o]) => (
          <g key={o} fill="var(--canvas-dot)" opacity={o}>
            {pts.split(" ").map((pt) => { const [cx, cy] = pt.split(","); return <circle key={pt} cx={cx} cy={cy} r="1" />; })}
          </g>
        ))}
        <g transform="translate(116 20)">
          <rect x="0" y="2" width="96" height="72" rx="8" fill="var(--object-ink)" opacity="0.08" />
          <rect x="0" y="0" width="96" height="72" rx="8" fill="var(--bg-1)" {...LINE} />
          {/* the artboard's label row: a kind glyph + its name, so the stroke reads as part of the drawing */}
          <rect x="0" y="-11" width="6" height="6" rx="1.5" {...LINE} opacity="0.55" />
          <line x1="11" y1="-8" x2="40" y2="-8" {...LINE} opacity="0.55" />
        </g>
        <SpotSticky x={36} y={96} s={40} rot={-6} fill="var(--object-yellow)" />
        <SpotSticky x={100} y={76} s={36} rot={5} fill="var(--object-lilac)" />
        <SpotSticky x={184} y={116} s={28} rot={-3} fill="var(--object-green)" lines={1} />
      </svg>
      <p className="es-sit">Your canvas is ready.</p>
      <p className="es-next">
        Ask AI for a first draft, or start drawing.
        {offline ? <><br /><span className="cf-offline-line"><Icon name="offline" size={13} />AI is back when this Mac is online.</span></> : null}
      </p>
      <div className="es-acts"><span className="btn btn--spark btn--sm cf-ask"><Spark size={10} color="var(--spark-fg)" />Ask AI<span className="cf-ask-k">⌘/</span></span></div>
    </div>
  );
}

/** Who is touching what (busy canvas) — sits in the note strip, outside the window. */
function Legend() {
  const rows: [string, string, string][] = [
    ["cf-lg--you", "You", "FB event cover · selected"],
    ["cf-lg--ai", "AI", "Pozvánka na combine · making it greener"],
    ["cf-lg--tereza", "Tereza", "the sticky · typing"],
    ["cf-lg--jonas", "Jonas", "Arch 1 · selected"],
  ];
  return (
    <div className="cf-legend">
      {rows.map(([c, who, what]) => <span key={who} className="cf-lg"><i className={c} /><strong>{who}</strong>{what}</span>)}
    </div>
  );
}

/* ═══ The canvas ═══════════════════════════════════════════════════════════════════════════ */
export default function CreateFlow() {
  return (
    <DesignCanvas>
      {/* ── 1 · Happy path ─────────────────────────────────────────────────────────────── */}
      <DCSection id="first-canvas" title="First canvas in two minutes" subtitle="Studio site — from one sentence on Home to a canvas you are editing">
        <DCArtboard id="cf-home-prompt" label="1 · Home — one sentence" width={W} height={H} fixed>
          <Stage note={<Note n={1} title="Home asks one question.">Type what you want; the chip under the prompt says which project the new canvas lands in. ↵ sends. Nothing to set up first.</Note>}>
            <Window tabs={[TABS.studio, TABS.alligators, TABS.home]} activeTab="home">
              <Canvas><Home prompt={PROMPT} target="Studio site" projects={HOME_PROJECTS_BEFORE} /></Canvas>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cf-ai-drafting" label="2 · AI drafts on a new canvas" width={W} height={H} fixed>
          <Stage note={<Note n={2} title="AI drafts in the open.">Desktop is done and yours to touch. A dashed spark-coloured outline marks Tablet, still being drawn; a faint ghost shows where Mobile lands next. Stop is one click.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={0}>
              <Canvas><Landing drawing /></Canvas>
              <StudioChrome landingAi ai={
                <AIPanel chat="A calm landing page" advanced
                  messages={[{ from: "you", text: PROMPT }]}
                  working="AI is drawing Tablet" step="Desktop done · Mobile next"
                />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cf-ai-done" label="3 · Done — the result toast" width={W} height={H} fixed>
          <Stage note={<Note n={3} title="The result, in one line.">The three artboards land with a small spring and a quiet “Made by AI” mark. With the AI chat panel folded, the result is a one-action toast and a dot on the spark.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={0}>
              <Canvas><Landing made /></Canvas>
              <StudioChrome ai={<PanelIcon icon="spark" at="ai" dot />} />
              <Toast icon="spark" action="Undo">Done — Desktop, Tablet and Mobile are on the canvas.</Toast>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cf-select-tweak" label="4 · Select — the inspector arrives" width={W} height={H} fixed>
          <Stage note={<Note n={4} title="Select, and the view makes room.">The inspector comes with the selection; the Canvases panel folds and the canvas slides left. Width 1280 is typed, so the preset reads Custom.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={0}>
              <Canvas><Landing cam="room" sel="desktop" desk={{ w: 358, size: "1280 × 900" }} /></Canvas>
              <StudioChrome left={false}
                insp={
                  <Inspector title="Desktop" rows={[
                    ["Preset", <InSelect value="Custom" />],
                    ["Size", <span className="cf-focus"><InSize w={1280} h={900} /></span>],
                    ["Fill", <InFill name="White" />],
                    ["Corners", <InNum value={0} icon="corner" />],
                    ["Clip content", <InSwitch on />],
                    ["Export", <InButton icon="export">PNG · 2×</InButton>],
                  ]} />
                }
                ai={<AIPanel chat="A calm landing page" advanced scope="Desktop" chips={["Make it calmer", "Tighter spacing", "Add a pricing teaser"]} messages={[{ from: "ai", text: "Done — Desktop, Tablet and Mobile are on the canvas. Pick one to refine." }]} />}
              />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cf-sticky-comment" label="5 · A sticky and a comment" width={W} height={H} fixed>
          <Stage note={<Note n={5} title="Think out loud, or ask someone.">N drops a sticky anywhere — for you. C pins a comment to the exact spot; Tereza's sits on the button and waits for an answer.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={0}>
              <Canvas>
                <Landing>
                  <Sticky color="yellow" x={330} y={420} rotate={-2.5}>Shorter headline?</Sticky>
                  <Sticky color="green" x={480} y={428} rotate={2}>Services as three cards</Sticky>
                  <CommentPin who="tereza" x={408} y={306} text="Could the button say “Book a call”? It's what people want." />
                </Landing>
              </Canvas>
              <StudioChrome tool="sticky" ai={<PanelIcon icon="spark" at="ai" />} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cf-undo-before" label="6 · AI went too far" width={W} height={H} fixed>
          <Stage note={<Note n={6} title="AI's dark hero went too far.">The Desktop hero is ink now, the sun kept warm. It reads heavy next to Tablet and Mobile — one key takes it back.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={0}>
              <Canvas><Landing darkHero /></Canvas>
              <StudioChrome ai={
                <AIPanel chat="Try a dark hero" advanced
                  scope="Desktop"
                  messages={[
                    { from: "you", text: "Try a dark hero" },
                    { from: "ai", text: "Done — the hero on Desktop is dark now, with the sun kept warm." },
                  ]}
                  chips={["Try it on Tablet", "Lighter dark"]}
                />
              } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cf-undo-ai" label="7 · ⌘Z undoes AI too" width={W} height={H} fixed>
          <Stage note={<Note n={7} title="One undo for everything.">⌘Z takes AI's change back like any other — AI's edits sit in the same undo, and in Version history. The chat keeps what was said.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={0}>
              <Canvas><Landing /></Canvas>
              <StudioChrome ai={
                <AIPanel chat="Try a dark hero" advanced
                  scope="Desktop"
                  messages={[
                    { from: "you", text: "Try a dark hero" },
                    { from: "ai", text: "Done — the hero on Desktop is dark now, with the sun kept warm." },
                  ]}
                />
              } />
              <Toast icon="undo" action="Redo">Undone — the dark hero by AI.</Toast>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 2 · Working on a canvas ─────────────────────────────────────────────────────── */}
      <DCSection id="working" title="Working on a canvas" subtitle="A blank canvas, a new artboard, another width of the same one, frames and text inside it">
        <DCArtboard id="cf-blank" label="8 · ⌘N — a blank canvas" width={W} height={H} fixed>
          <Stage note={<Note n={8} title="No AI needed to start.">⌘N opens an empty canvas with one line in the middle. Ask AI, or press F and drag — the toolbar is the way in.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={0}>
              <Canvas>
                <EmptyCanvas />
              </Canvas>
              <ProjectPill project="Studio site" canvas="Untitled canvas" />
              <CanvasesPanel advanced project="Studio site" count={6} selected="Untitled canvas" items={[...STUDIO, { name: "Landing page", art: "home" }, { name: "Untitled canvas", art: "blank" }]} />
              <ShareCluster people={["tereza"]} mode="edit" />
              <ZoomUndo zoom={100} />
              <Toolbar tip="frame" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cf-add-artboard" label="9 · F — a new artboard, any kind" width={W} height={H} fixed>
          <Stage note={<Note n={9} title="F draws an artboard where you drag.">Pick a preset and it snaps to size. Print and video sizes live in the same list — the artboard's kind follows the preset, no separate mode.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={0}>
              <Canvas>
                <Landing cam="room">
                  <Artboard label="Artboard 4" x={96} y={430} w={358} h={224} selected size="1280 × 800" page={false}>
                    <div className="cf-new-ab" />
                  </Artboard>
                </Landing>
              </Canvas>
              <StudioChrome left={false} tool="frame"
                insp={
                  <Inspector title="Artboard 4" rows={[
                    ["Preset", <span className="cf-open-select"><InSelect value="Laptop" /></span>],
                    ["Size", <InSize w={1280} h={800} />],
                    ["Fill", <InFill name="White" />],
                    ["Clip content", <InSwitch on />],
                  ]} />
                }
                ai={<PanelIcon icon="spark" at="ai" />}
              />
              <PresetList />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cf-duplicate-width" label="10 · Duplicate at another width" width={W} height={H} fixed>
          <Stage note={<Note n={10} title="Same artboard, another width.">Right-click an artboard: Duplicate at another width › Laptop. The next frame shows where the copy lands.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={0}>
              <Canvas>
                <Landing sel="desktop" />
                <Menu style={{ left: 520, top: 230 }} width={248} items={[
                  { label: "Ask AI about Desktop", icon: "spark", keys: "⌘/" }, "sep",
                  { label: "Duplicate", icon: "duplicate", keys: "⌘D" },
                  { label: "Duplicate at another width", icon: "web", sub: true, highlight: true },
                  { label: "Rename", icon: "edit" }, "sep",
                  { label: "Copy", keys: "⌘C" }, { label: "Paste", keys: "⌘V" }, "sep",
                  { label: "Export…", icon: "export", keys: "⇧⌘E" }, "sep",
                  { label: "Move to trash", icon: "trash", danger: true },
                ]} />
                <Menu style={{ left: 776, top: 292 }} width={210} items={[
                  { label: "Laptop", keys: "1280", highlight: true }, { label: "Tablet", keys: "834" }, { label: "Mobile", keys: "390" }, "sep", { label: "Custom width…" },
                ]} />
              </Canvas>
              <StudioChrome ai={<PanelIcon icon="spark" at="ai" />} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cf-duplicate-done" label="11 · The copy lands in line" width={W} height={H} fixed>
          <Stage note={<Note n={11} title="The copy, reflowed and in line.">Laptop lands under Desktop, left edges aligned, the hero reflowed to 1280. Drag it and the gaps measure themselves — equal gaps snap.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={0}>
              <Canvas>
                <Landing />
                <Artboard label="Desktop — Laptop" kind="web" x={296} y={412} w={358} h={224} selected size="1280 × 800">
                  <HeroMock />
                </Artboard>
                <GapGuide x={620} y={372} len={40} value="144" />
                <span className="cf-align" style={{ left: 296, top: 100, height: 556 }} />
              </Canvas>
              <StudioChrome ai={<PanelIcon icon="spark" at="ai" />} />
              <Toast icon="duplicate" action="Undo">Duplicated at Laptop — 1280 wide.</Toast>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cf-frames-text" label="12 · Frames and text in place" width={W} height={H} fixed>
          <Stage note={<Note n={12} title="Type right on the artboard.">Double-click text to type in place. Layers shows the frames nested inside; the inspector switches to type.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={300} y={96} w={806} h={504}>
                  <DesktopPage />
                  <Selection x={26} y={80} w={410} h={124} label="Hero copy · frame" />
                  <Selection x={30} y={86} w={372} h={36} editing />
                  <span className="cf-frame-hint" style={{ left: 24, top: 344, width: 758, height: 104 }}><span>Services · frame</span></span>
                </Artboard>
              </Canvas>
              <ProjectPill project="Studio site" canvas="Landing page" />
              <CanvasesPanel project="Landing page" tab="layers" layers={[
                { name: "Desktop", icon: "frame" },
                { name: "Nav", icon: "frame", depth: 1 },
                { name: "Hero", icon: "frame", depth: 1 },
                { name: "Hero copy", icon: "frame", depth: 2 },
                { name: "Calm software, made in Brno", icon: "text", depth: 3, selected: true },
                { name: "A small studio for product…", icon: "text", depth: 3 },
                { name: "See the work", icon: "shape", depth: 3 },
                { name: "Illustration", icon: "image", depth: 2, locked: true },
                { name: "Services", icon: "frame", depth: 1 },
                { name: "Product design", icon: "text", depth: 2 },
                { name: "Brand systems", icon: "text", depth: 2 },
                { name: "Small apps", icon: "text", depth: 2 },
                { name: "Old footer", icon: "frame", depth: 1, hidden: true },
              ]} />
              <ShareCluster people={["tereza"]} mode="edit" />
              <Inspector title="Calm software, made in Brno" kind="Text" style={{ top: 68 }} rows={[
                ["Font", <InSelect value="SF Pro Display" />],
                ["Size", <InSelect value="56" />],
                ["Weight", <InSelect value="Semibold" />],
                ["Colour", <InFill name="Ink" tone="ink" />],
                ["Align", <InSeg options={["Left", "Centre", "Right"]} value="Left" />],
              ]} advanced={[["font-size", "56px"], ["font-weight", "600"], ["letter-spacing", "-0.015em"], ["line-height", "1.08"]]} />
              <ZoomUndo zoom={56} />
              <Toolbar tool="text" />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 3 · Finding the right canvas ────────────────────────────────────────────────── */}
      <DCSection id="finding" title="Finding the right canvas in a big project" subtitle="Alligators brand — 93 canvases in folders, test files at the root, long Czech names">
        <DCArtboard id="cf-big-tree" label="13 · 93 canvases in folders" width={W} height={H} fixed>
          <Stage note={<Note n={13} title="Folders, recents and the honest leftovers.">Canvases keep their folders and pictures. Long names cut short and show in full on hover. Test files stay as they are — nothing is hidden, dimmed or tidied away for you.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas><KampanSlice /></Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <CanvasesPanel
                project="Alligators brand" count={ALLIGATORS_COUNT} selected="Combine-kampan"
                recents={[{ name: "Uniformy-2027", art: "gator-jersey", meta: "1 h ago" }]}
                folders={GATOR_FOLDERS} items={GATOR_JUNK}
                tooltip={{ row: "Combine-kampan — varianta pro partnery a sponzory", text: "Combine-kampan — varianta pro partnery a sponzory · 2026/combine" }}
              />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <ZoomUndo zoom={KAMPAN_ZOOM} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" dot />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cf-panel-search" label="14 · Search inside the panel" width={W} height={H} fixed>
          <Stage note={<Note n={14} title="Type in the panel, the tree flattens.">“letak” finds canvases by name and by the artboards inside them; the folder, or the artboard that matched, sits under each name. Accents don't matter: letak finds leták.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas><KampanSlice /></Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <CanvasesPanel
                project="Alligators brand" search="letak" selected="Combine-letak-registrace"
                items={[
                  { name: "Combine-letak-registrace", art: "gator-print", sub: "2026/combine" },
                  { name: "LetakA6", art: "gator-print", sub: <>print · “Náborový <mark className="k-mark">leták</mark> A6 · FLAG” and 3 more</> },
                  { name: "letak-nabor-2023-FINAL", art: "gator-poster", sub: "legacy" },
                ]}
                foot="3 results · ⌘K searches every project"
              />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <ZoomUndo zoom={KAMPAN_ZOOM} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cf-search-k" label="15 · ⌘K — canvases first, then tools" width={W} height={H} fixed>
          <Stage note={<Note n={15} title="Search finds canvases and hidden tools.">Canvases come first, with pictures and their project. Tools that aren't on screen follow, each naming where it lives. Ask AI is always last.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas><KampanSlice /></Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <ZoomUndo zoom={KAMPAN_ZOOM} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
              <Veil />
              <SearchPalette query="letak" groups={[
                {
                  title: "Canvases", rows: [
                    { label: "Combine-letak-registrace", art: "gator-print", meta: "Alligators brand · 2026/combine · Tereza, yesterday", selected: true },
                    { label: "LetakA6", art: "gator-print", via: "Náborový leták A6 · FLAG", meta: "Alligators brand · print · 4 artboards" },
                    { label: "letak-nabor-2023-FINAL", art: "gator-poster", meta: "Alligators brand · legacy" },
                  ],
                },
                {
                  title: "Tools and settings", aside: "not on screen, found by search", rows: [
                    { label: "Print guides", icon: "print", via: "leták → print", where: "Menu › View › Advanced" },
                    { label: "New artboard — A4", icon: "frame", via: "leták", where: "Menu › Edit › Advanced" },
                    { label: "Export…", icon: "export", via: "PDF for print", where: "⇧⌘E" },
                  ],
                },
              ]} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cf-open-big" label="16 · 21 artboards, fit to view" width={W} height={H} fixed>
          <Stage note={<Note n={16} title="The whole campaign at a glance.">⌘0 fits all 21 at 10% — 19 fixed-size social pieces and 2 print sheets, each kind beside its name. ⌘\ hides the panels.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                <div className="cf-fit"><KampanFit /></div>
              </Canvas>
              <ProjectPill project="Alligators brand" folded />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster zen people={[]} />
              <Toolbar folded />
              <PanelIcon icon="spark" at="ai" />
              <Toast at="top">Panels hidden. Press ⌘\ to bring them back.</Toast>
              <span className="island cf-zoomword">Zoom to fit · {FIT_ZOOM}%</span>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 4 · Edge cases ──────────────────────────────────────────────────────────────── */}
      <DCSection id="edges" title="When it gets busy, slow or broken" subtitle="Several people and AI at once, status in words, a canvas that won't draw, no internet">
        <DCArtboard id="cf-busy" label="17 · Tereza, Jonas, AI and you" width={W} height={H} fixed>
          <Stage note={<div className="cf-note-row"><Note n={17} title="Everyone on one canvas.">Each person is on their own object, in their own colour; AI's tag sits off the art. Two of your AI chats run at once — the second on a story out of view.</Note><Legend /></div>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                {/* Combine-kampan at 22%: FB cover 1920 × 1005 → 422 × 221, IG post 4:5 → 238 × 297, A4-landscape sheet → 252 × 180. */}
                <KA_ a={KA_EVENT[0]} x={96} y={110} z={0.22} selected size="1920 × 1005" />
                <Artboard label={KA_POSTS[0].label} kind="digital" x={560} y={110} w={238} h={297} aiWorking="AI is making it greener" aiCursor={{ x: "82%", y: "22%" }}>{KA_POSTS[0].body}</Artboard>
                <KA_ a={KA_POSTS[4]} x={846} y={110} z={0.22} />
                <span className="cf-presence cf-presence--jonas" style={{ left: 844, top: 108, width: 256, height: 184 }} />
                <Cursor name="jonas" x={1070} y={262} />
                <Sticky color="yellow" x={590} y={470} rotate={2.5}>Logo větší<i className="k-caretline cf-sticky-caret" /></Sticky>
                <Cursor name="tereza" x={692} y={500} />
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza", "jonas"]} status="syncing" mode="edit" />
              <Inspector title="FB event cover · FB Event · 1.91:1" style={{ top: 68 }} rows={[
                ["Preset", <InSelect value="FB event" />],
                ["Size", <InSize w={1920} h={1005} />],
                ["Fill", <InFill name="White" />],
                ["Clip content", <InSwitch on />],
              ]} />
              <ZoomUndo zoom={22} />
              <Toolbar />
              <AIPanel chat="Make the post greener" advanced
                runs={{ open: true, yours: [
                  { title: "Make the post greener", state: "working", where: "Pozvánka na combine · IG Post · 4:5", current: true },
                  { title: "Countdown story in English", state: "working", where: "Zítra se měří · countdown story · IG Story · 9:16" },
                ] }}
                messages={[{ from: "you", text: "Make the Combine post greener, keep the logo white" }]}
                working="AI is making it greener" step="Background done · the logo stays white"
                scope="IG Post 4:5"
              />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cf-status-words" label="18 · Save status, in words" width={1160} height={440} fixed>
          <V2 className="cf-closeup">
            <p className="cf-closeup-h">Save status is a word, not a control.</p>
            <StatusBoard />
            <div className="cf-closeup-note"><Note n={18} title="Shown, never operated.">One word beside the faces. Resync and the rest live in Menu › Diagnostics, for when something is actually wrong.</Note></div>
          </V2>
        </DCArtboard>

        <DCArtboard id="cf-render-error" label="19 · A canvas that won't draw" width={W} height={H} fixed>
          <Stage note={<Note n={19} title="What happened, what's safe, one verb.">The last good version stays visible, dimmed, behind the card; Go back restores it. AI can try a repair from its panel. Show details holds the technical part — the only place it appears.</Note>}>
            <Window tabs={GATOR_TABS} activeTab={1}>
              <Canvas>
                <KampanSlice dim />
                <span className="cf-lastgood"><Icon name="history" size={12} />Last good version · 6 Oct, 14:05</span>
                <div className="cf-err">
                  <span className="cf-err-ic"><Icon name="problem" size={20} /></span>
                  <p className="cf-err-t">Combine-kampan can't be drawn right now.</p>
                  <p className="cf-err-d">The last change has a mistake the canvas can't show. Behind this card is the last good version, from 6 Oct, 14:05 — nothing is lost, and every version stays in Version history.</p>
                  <span className="btn btn--primary"><Icon name="history" size={14} />Go back to 14:05</span>
                  <div className="cf-err-adv">
                    <span className="k-adv-btn cf-err-advbtn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Show details</span>
                  </div>
                </div>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <PanelIcon icon="panel-left" at="left" />
              <ShareCluster people={["tereza"]} mode="edit" />
              <ZoomUndo zoom={KAMPAN_ZOOM} />
              <Toolbar />
              <AIPanel chat="New chat" advanced scope="Combine-kampan" chips={["Ask AI to fix it"]} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="cf-offline-create" label="20 · A new canvas with no internet" width={W} height={H} fixed>
          <Stage note={<Note n={20} title="Offline is a status, not a stop.">⌘N still makes a canvas, kept on this Mac until it syncs. Ask AI stays on; the prompt is queued until the Mac is online.</Note>}>
            <Window tabs={[TABS.studio, { ...TABS.alligators, syncing: false }]} activeTab={1}>
              <Canvas>
                <EmptyCanvas offline />
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Krpole-v-pohybu-2" />
              <CanvasesPanel advanced project="Alligators brand" count={ALLIGATORS_COUNT + 1} selected="Krpole-v-pohybu-2" folders={OFFLINE_FOLDERS} />
              <ShareCluster people={[]} status="offline" mode="edit" />
              <ZoomUndo zoom={100} />
              <Toolbar />
              <AIPanel chat="Three reel covers" advanced scope="Whole canvas" messages={[{ from: "you", text: <>Three reel covers for Krpole v pohybu<span className="cf-queued"><Icon name="clock" size={12} />Queued — sends when this Mac is online.</span></> }]} />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
