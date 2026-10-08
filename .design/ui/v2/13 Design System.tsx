/**
 * @canvas      13 Design System — each design system lives on its own canvas inside the project: where it is, what it
 *              holds (Light and Dark), editing in place and choosing who follows, the files behind it, making one
 *              with AI, many systems, several systems in one project, edge cases, Advanced
 * @ds          maude-v2
 * @platform    desktop
 * @opt_out     palette
 * @artboards   ds-where-studio | ds-where-gator |
 *              ds-board-studio | ds-board-dark | ds-board-gator |
 *              ds-edit-colour | ds-edit-reach | ds-edit-review | ds-edit-master | ds-edit-instance |
 *              ds-truth-outside | ds-truth-conflict |
 *              ds-make-inputs | ds-make-directions | ds-make-mix | ds-make-filling | ds-make-done |
 *              ds-many-switch | ds-many-library | ds-many-linked |
 *              ds-multi-panel | ds-multi-switch | ds-multi-schema | ds-multi-menu | ds-multi-migrate |
 *              ds-edge-contrast | ds-edge-trash | ds-edge-suggest | ds-edge-migrate |
 *              ds-advanced
 * @brief       "ukaz mi jeste jeden canvas kde uvidim jak bude vypadat tvorba a zobrazeni design systemu, premyslim ze
 *              oproti tomu jak je to dnes by to klidne taky mohlo zit jen v ramci boardu/canvas" — and, on 11:
 *              "kde bude design system?"
 *
 * Today a design system is a folder (system/<ds>/: tokens CSS, README/SKILL/CONTRACT, ~38–42 specimen pages, assets)
 * made by the long /design:setup-ds wizard. v2 proposal (CONTRACT §7 "Design system lives on a canvas" + "source of
 * truth"): each system is ONE canvas — "Design system" in UI copy — pinned above every canvas (several systems → one row each). Sections are artboards:
 * Brand · Colour · Type · Space & shape · Motion · Components · Patterns. Every colour has a Light and a Dark value.
 * For designers this canvas is the source; the files are generated from it and are the source for code. A file
 * changed outside the app comes back as a review. Nothing that exists today is deleted — it is one fold down.
 *
 * Convention: app artboards are <Stage> (1440 × 900 window + note strip, artboard 1440 × 980). Close-ups (the
 * Design system canvas at 100 %, the reach view, the library, Advanced) carry their own note strip. Every section is
 * drawn ONCE at its real size (SECS, design px) and scaled to the frame's zoom — the zoom readout says that zoom.
 * The systems are the user's design content: drawn inside .k-fixed scopes (never re-coloured by the app theme);
 * their own Dark mode is a class on the section (.ds-dark), not the app theme.
 * Studio site system = Studio site's own system (azure). Alligators brand system = the real club system — values
 * 1:1 from ~/Maude/alligators/.design/system/alligators/colors_and_type.css (dark = green, light = paper/print),
 * mark paths verbatim from assets/logos/mark-green.svg. Local pieces use the `ds-` prefix.
 */
import "../../system/maude-v2/colors_and_type.css";
import "../../system/maude-v2/preview/_components.css";
import "./_kit.css";
import "./13 Design System.css";
import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  AIPanel, ALLIGATORS_COUNT, ALLIGATORS_COMBINE, ALLIGATORS_FOLDERS, ALLIGATORS_ROOT, Artboard, Avatar, Callout, Canvas, CanvasesPanel, Cursor,
  Dialog, Home, Icon, InFill, InSeg, InSelect, InSize, InSwitch, Kbd, Menu, Note, PanelIcon, ProjectPill, SearchPalette,
  ShareCluster, Spark, Stage, TABS, Thumb, Toolbar, V2, Veil, Window, ZoomUndo,
} from "./_kit";
import type { Art, CanvasItem, Folder, Tab } from "./_kit";

const W = 1440;
const H = 980;

/* ═══ Projects ═══════════════════════════════════════════════════════════════════════════════ */

const TABS2 = [TABS.studio, TABS.alligators];
const JUNIOR: Tab = { name: "Alligators — junioři", initial: "J", color: "green", account: "Alligators" };
const STUDIO: CanvasItem[] = [
  { name: "Homepage", art: "home" },
  { name: "Pricing", art: "price", people: ["tereza"] },
  { name: "Onboarding", art: "onb" },
  { name: "Mobile — detail", art: "mobile" },
  { name: "Landing page", art: "home" },
];
const JUNIOR_ITEMS: CanvasItem[] = [
  { name: "Nábor 2027 — plakát", art: "gator-poster", kinds: ["print"] },
  { name: "Turnaj U17 — pozvánka", art: "gator-social", kinds: ["digital"] },
  { name: "Junioři — web", art: "gator-web", kinds: ["web"] },
  { name: "Tréninky — rozpis", art: "gator-numbers", kinds: ["digital"] },
];
/** The system names. The pinned row reads "Design system" with "<system name> · used by N projects" (as 11 pn-ds). */
const STUDIO_SYS = "Studio site system";
const GATOR_SYS = "Alligators brand system";
/** The pinned row, two lines (kit candidate: CanvasesPanel `system.sub`). */
function sysRow(meta: string, selected?: boolean, ai?: boolean) {
  const name = <span className="k-cp-two ds-cp-two"><span className="k-cp-name">Design system</span><span className="k-cp-sub">{meta.split(" · ").map((m) => <span key={m} className="ds-cp-l">{m}</span>)}</span></span>;
  return { name: name as unknown as string, selected, ai };
}
const STUDIO_META = `${STUDIO_SYS} · used by 1 project`;
const GATOR_META = `${GATOR_SYS} · used by 3 projects`;

const GATOR_CLOSED: Folder[] = ALLIGATORS_FOLDERS.map((f) => ({ ...f, open: false }));
/** 2026/combine open, Combine-letak-registrace selected (the canvas that was left out of the update). */
const GATOR_COMBINE_OPEN: Folder[] = ALLIGATORS_FOLDERS.map((f) => f.name !== "2026" ? f : {
  ...f, folders: f.folders?.map((sf) => sf.name !== "combine" ? sf : { ...sf, items: ALLIGATORS_COMBINE }),
});

function StudioPanel({ selected, ds, items = STUDIO, dsAi = false, foot }: { selected?: string; ds?: boolean; items?: CanvasItem[]; dsAi?: boolean; foot?: ReactNode }) {
  return <CanvasesPanel advanced project="Studio site" count={items.length} selected={selected} items={items} system={sysRow(STUDIO_META, ds, dsAi)} foot={foot} />;
}
function GatorPanel({ selected, ds, folders = GATOR_CLOSED }: { selected?: string; ds?: boolean; folders?: Folder[] }) {
  return <CanvasesPanel advanced project="Alligators brand" count={ALLIGATORS_COUNT} selected={selected} folders={folders} items={ALLIGATORS_ROOT} system={sysRow(GATOR_META, ds)} />;
}

/* ═══ The Design system canvas — seven sections, each drawn once at its real size ═══════════════ */

type Sys = "studio" | "gator";
type SecId = "brand" | "colour" | "type" | "space" | "motion" | "components" | "patterns";
const SECS: { id: SecId; label: string; x: number; y: number; w: number; h: number }[] = [
  { id: "brand", label: "Brand", x: 0, y: 0, w: 560, h: 620 },
  { id: "colour", label: "Colour", x: 608, y: 0, w: 1000, h: 620 },
  { id: "type", label: "Type", x: 1656, y: 0, w: 600, h: 620 },
  { id: "space", label: "Space & shape", x: 0, y: 700, w: 680, h: 560 },
  { id: "motion", label: "Motion", x: 728, y: 700, w: 440, h: 560 },
  { id: "components", label: "Components", x: 1216, y: 700, w: 1040, h: 560 },
  { id: "patterns", label: "Patterns", x: 0, y: 1340, w: 2256, h: 440 },
];

/** What a frame wants the sections to show (all optional). */
type Opts = {
  /** a swatch / master / type row that is selected (by its name) */
  sel?: string;
  /** Tereza's presence ring on a row (by its name) */
  presence?: string;
  /** Studio's Accent after the edit (Deeper azure) — swatch, masters and Patterns */
  accentNew?: boolean;
  /** Alligators' button master with the new 6 px corners */
  btnNew?: boolean;
  /** Patterns with the Onboarding slot still empty (AI's partial result) */
  partial?: boolean;
  /** Alligators: the darker tertiary text being tried (contrast edge) */
  darkTertiary?: boolean;
  /** Studio in its own Dark mode (the system's dark values — not the app theme) */
  dark?: boolean;
  /** names changed in the files outside the app (marked until reviewed) */
  outside?: string[];
  /** the file's darker Quiet + Corner M 12 (the outside change) */
  fileEdit?: boolean;
  /** a token changed on the canvas AND in the file */
  conflict?: string;
  /** ring every Accent spot in Patterns (the reach view) */
  ring?: boolean;
};

/** A section's content at its real size, scaled to the frame's zoom (transform-origin 0 0). */
function Scaled({ w, h, z, children }: { w: number; h: number; z: number; children: ReactNode }) {
  return <div className="ds-scale" style={{ width: w, height: h, transform: `scale(${z})`, ["--z" as string]: z } as CSSProperties}>{children}</div>;
}

type SecState = "ai" | "ghost" | "made" | "dim" | "sel";
function Board({ sys, z, x, y, st = {}, o = {}, ai = "AI is building the system", only }: { sys: Sys; z: number; x: number; y: number; st?: Partial<Record<SecId, SecState>>; o?: Opts; ai?: string; only?: SecId[] }) {
  return (
    <>
      {SECS.filter((s) => !only || only.includes(s.id)).map((s) => {
        const ax = Math.round(x + s.x * z);
        const ay = Math.round(y + s.y * z);
        const aw = Math.round(s.w * z);
        const ah = Math.round(s.h * z);
        const state = st[s.id];
        if (state === "ghost") {
          return <span key={s.id} className="ds-ghost" style={{ left: ax, top: ay, width: aw, height: ah }}><span className="ds-ghost-l"><Spark size={9} />{s.label} — next</span></span>;
        }
        return (
          <Artboard key={s.id} label={s.label} x={ax} y={ay} w={aw} h={ah} selected={state === "sel"} size={state === "sel" ? `${s.w} × ${s.h}` : undefined}
            aiWorking={state === "ai" ? ai : undefined} aiAt="corner" aiCursor={state === "ai" ? { x: "62%", y: "40%" } : undefined} aiMade={state === "made"} dim={state === "dim"}>
            <Scaled w={s.w} h={s.h} z={z}>
              <div className={`ds-sec ds-sec--${sys}${o.dark ? " ds-dark" : ""}${state === "ai" ? " ds-sec--drawing" : ""}`}>
                {sys === "studio" ? <StudioSec id={s.id} o={o} /> : <GatorSec id={s.id} o={o} />}
              </div>
            </Scaled>
          </Artboard>
        );
      })}
    </>
  );
}

/* ─── Shared section pieces ─── */

/** A swatch: Light | Dark halves, its name in words, where it's used. */
function Sw({ c, name, used, o, lock }: { c: string; name: string; used: string; o: Opts; lock?: boolean }) {
  const out = o.outside?.includes(name);
  const conflict = o.conflict === name;
  return (
    <span className="ds-sw" data-sel={o.sel === name ? "true" : undefined} data-presence={o.presence === name ? "true" : undefined}
      data-outside={out ? "true" : undefined} data-conflict={conflict ? "true" : undefined}>
      <i className={`ds-chip ds-c--${c}`}><span className="ds-chip-l" /><span className="ds-chip-d" /></i>
      <b>{name}{lock ? <span className="ds-lock" title="Brand colour — locked"><Icon name="lock" size={10} /></span> : null}</b>
      <em>{used}</em>
      {out ? <span className="ds-flag">Changed outside</span> : null}
      {conflict ? <span className="ds-flag ds-flag--warn">2 versions</span> : null}
    </span>
  );
}
function SwGroup({ title, children }: { title: string; children: ReactNode }) {
  return <div className="ds-swg"><p className="ds-k">{title}</p><div className="ds-swg-row">{children}</div></div>;
}
/** The legend at the top of Colour: each swatch is Light | Dark. */
function ModeKey({ sys }: { sys: Sys }) {
  return <span className="ds-modekey"><i className={`ds-chip ds-c--${sys === "studio" ? "accent" : "g-bg0"}`}><span className="ds-chip-l" /><span className="ds-chip-d" /></i>Each swatch: <b>Light</b> | <b>Dark</b></span>;
}
/** Text on surfaces — the contrast pairs, Light | Dark (each half drawn in that mode's values). */
type Pair = { name: string; l: [string, string]; d: [string, string]; rl: string; rd: string; warn?: boolean };
function Pairs({ pairs }: { pairs: Pair[] }) {
  return (
    <div className="ds-pairs">
      <p className="ds-k">Text on surfaces — contrast, Light | Dark</p>
      <div className="ds-pairs-row">
        {pairs.map((p) => (
          <span key={p.name} className="ds-pair" data-warn={p.warn ? "true" : undefined}>
            <span className="ds-pair-t">
              <span style={{ color: `var(${p.l[0]})`, background: `var(${p.l[1]})` }}>Aa</span>
              <span style={{ color: `var(${p.d[0]})`, background: `var(${p.d[1]})` }}>Aa</span>
            </span>
            <b>{p.name}</b>
            <em>{p.rl} | {p.rd}{p.warn ? " — large text only in Dark" : ""}</em>
          </span>
        ))}
      </div>
    </div>
  );
}
const used = (n: number) => (n === 0 ? "Not used yet" : `Used in ${n} ${n === 1 ? "canvas" : "canvases"}`);

/** A component master tile: its name, how many canvases use it, the live component. */
function Master({ name, n, sel, children, span = 1, cls = "" }: { name: string; n: number; sel?: string; children: ReactNode; span?: number; cls?: string }) {
  return (
    <div className={`ds-m ${cls}`} style={span > 1 ? { gridColumn: `span ${span}` } : undefined} data-sel={sel === name ? "true" : undefined}>
      <span className="ds-m-hd"><Icon name="system" size={11} /><b>{name}</b><em>{used(n)}</em></span>
      <div className="ds-m-body">{children}</div>
    </div>
  );
}
const STATES = ["Default", "Hover", "Pressed", "Focus", "Disabled"] as const;
/** Variants × states — a designer-grade master shows every state, not one. */
function Variants({ rows, sizes }: { rows: { name: string; cell: (state: (typeof STATES)[number]) => ReactNode }[]; sizes: ReactNode }) {
  return (
    <div className="ds-var">
      <span className="ds-var-h" />{STATES.map((s) => <span key={s} className="ds-var-h">{s}</span>)}
      {rows.map((r) => (
        <Fragment key={r.name}>
          <span className="ds-var-n">{r.name}</span>
          {STATES.map((s) => <span key={s} className="ds-var-c">{r.cell(s)}</span>)}
        </Fragment>
      ))}
      <span className="ds-var-n">Sizes</span>
      <span className="ds-var-sizes">{sizes}</span>
    </div>
  );
}

/** A motion card: the curve, drawn; its name and job. */
function Curve({ kind }: { kind: "out" | "inout" | "spring" | "linear" }) {
  const d = kind === "out" ? "M4 68 C 34 16, 40 6, 116 6" : kind === "inout" ? "M4 68 C 56 68, 52 6, 116 6" : kind === "spring" ? "M4 68 C 18 40, 26 4, 44 -2 S 66 10, 80 6 S 104 5, 116 6" : "M4 68 L 116 6";
  return (
    <svg className="ds-curve" viewBox="0 0 120 74" width="120" height="74" aria-hidden="true">
      <path className="ds-curve-ax" d="M4 6 V 68 H 116" />
      <path className="ds-curve-p" d={d} />
    </svg>
  );
}
function MotionCard({ kind, name, job, ms }: { kind: "out" | "inout" | "spring" | "linear"; name: string; job: string; ms: string }) {
  return <div className="ds-mo"><Curve kind={kind} /><b>{name}<em>{ms}</em></b><span>{job}</span></div>;
}
/** "Rules for AI and code" — the SKILL.md / CONTRACT.md half of Brand. */
function Rules({ rules }: { rules: string[] }) {
  return (
    <>
      <p className="ds-k ds-k--gap">Rules for AI and code</p>
      {rules.map((r) => <p key={r} className="ds-rule"><Icon name="check" size={12} />{r}</p>)}
      <p className="ds-cap">Written to SKILL.md — Claude Code and other agents follow them too.</p>
    </>
  );
}

/* ─── Studio site system (calm, azure) ─── */

function StudioLogo({ size = 44 }: { size?: number | string }) {
  return <span className="ds-slogo" style={{ fontSize: size }}><i />studio</span>;
}
const STUDIO_ICONS = ["search", "home", "people", "comment", "image", "link", "clock", "share", "export", "settings"];

function StudioSec({ id, o }: { id: SecId; o: Opts }) {
  if (id === "brand") {
    return (
      <div className="ds-pad ds-col">
        <p className="ds-k">Logo · clear space</p>
        <div className="ds-clear"><span className="ds-clear-x ds-clear-x--l" /><span className="ds-clear-x ds-clear-x--r" /><StudioLogo size={52} /></div>
        <div className="ds-logos"><span className="ds-logos-tile"><StudioLogo size={22} /></span><span className="ds-logos-tile ds-logos-tile--ink"><StudioLogo size={22} /></span><span className="ds-logos-tile ds-logos-tile--dot"><i /></span></div>
        <p className="ds-k ds-k--gap">Icons · line, 1.5 stroke, 16 grid</p>
        <div className="ds-icons">{STUDIO_ICONS.map((n) => <span key={n}><Icon name={n} size={18} /></span>)}</div>
        <p className="ds-k ds-k--gap">Voice</p>
        <p className="ds-voice">Calm, precise, unhurried.</p>
        <p className="ds-say"><b>Say</b> See the work <b>not</b> Discover our amazing portfolio!</p>
        <Rules rules={["Accent for one action per screen.", "Never Quiet text on Well."]} />
      </div>
    );
  }
  if (id === "colour") {
    return (
      <div className="ds-pad ds-colour">
        <ModeKey sys="studio" />
        <div className="ds-swrow">
          <SwGroup title="Surfaces">
            <Sw o={o} c="page" name="Page" used={used(5)} /><Sw o={o} c="panel" name="Panel" used={used(4)} /><Sw o={o} c="raised" name="Raised" used={used(5)} /><Sw o={o} c="well" name="Well" used={used(3)} />
          </SwGroup>
          <SwGroup title="Text">
            <Sw o={o} c="ink" name="Ink" used={used(5)} /><Sw o={o} c="ink2" name="Secondary" used={used(5)} /><Sw o={o} c={o.fileEdit ? "ink3-new" : "ink3"} name="Quiet" used={used(4)} /><Sw o={o} c="onacc" name="On accent" used={used(5)} />
          </SwGroup>
        </div>
        <div className="ds-swrow">
          <SwGroup title="Accent">
            <Sw o={o} c={o.accentNew ? "accent-new" : "accent"} name="Accent" used={used(5)} /><Sw o={o} c={o.accentNew ? "accent-new-h" : "accent-h"} name="Accent pressed" used={used(5)} /><Sw o={o} c="accent-t" name="Accent tint" used={used(2)} />
          </SwGroup>
          <SwGroup title="Status">
            <Sw o={o} c="ok" name="Success" used={used(1)} /><Sw o={o} c="warn" name="Warning" used={used(1)} /><Sw o={o} c="err" name="Error" used={used(2)} /><Sw o={o} c="info" name="Info" used={used(0)} />
          </SwGroup>
        </div>
        <div className="ds-swrow">
          <SwGroup title="Brand and illustration">
            <Sw o={o} c="o-coral" name="Coral dot" used={used(5)} /><Sw o={o} c="o-sky" name="Sky" used={used(3)} /><Sw o={o} c="o-green" name="Leaf" used={used(2)} /><Sw o={o} c="o-yellow" name="Sun" used={used(2)} />
          </SwGroup>
          <SwGroup title="Links and focus">
            <Sw o={o} c="link" name="Link" used={used(4)} /><Sw o={o} c="focus" name="Focus" used={used(3)} /><Sw o={o} c="hl" name="Highlight" used={used(1)} />
          </SwGroup>
        </div>
        <Pairs pairs={[
          { name: "Ink on Page", l: ["--ds-sl-ink", "--ds-sl-page"], d: ["--ds-sd-ink", "--ds-sd-page"], rl: "15.1", rd: "16.2" },
          { name: "Secondary on Well", l: ["--ds-sl-ink2", "--ds-sl-well"], d: ["--ds-sd-ink2", "--ds-sd-well"], rl: "8.6", rd: "9.9" },
          { name: "Quiet on Well", l: ["--ds-sl-ink3", "--ds-sl-well"], d: ["--ds-sd-ink3", "--ds-sd-well"], rl: "4.9", rd: "4.2", warn: true },
          { name: "Link on Page", l: ["--ds-sl-link", "--ds-sl-page"], d: ["--ds-sd-link", "--ds-sd-page"], rl: "5.9", rd: "7.6" },
        ]} />
      </div>
    );
  }
  if (id === "type") {
    const rows: [string, string, string, ReactNode][] = [
      ["Display", "35 · Semibold", "ds-t-display", "Calm, careful software."],
      ["Heading", "24 · Semibold", "ds-t-heading", "Three ways we help"],
      ["Title", "17 · Semibold", "ds-t-title", "Product design"],
      ["Body", "14 · Regular", "ds-t-body", "We design and build small, careful apps for teams who would rather not shout."],
      ["Small", "12 · Regular", "ds-t-small", "Monthly · Yearly — save two months"],
      ["Caption", "11 · Medium", "ds-t-cap", "Photo: Kraví hora, Brno"],
      ["Link", "14 · Semibold", "ds-t-link", "How we work"],
      ["Numbers", "Tabular figures", "ds-t-num", "12 € · 29 € · 79 €"],
    ];
    return (
      <div className="ds-pad ds-type">
        {rows.map(([n, m, cls, t]) => (
          <div key={n} className="ds-trow" data-sel={o.sel === n ? "true" : undefined} data-presence={o.presence === n ? "true" : undefined}>
            <span className="ds-tname"><b>{n}</b><em>{m}</em></span>
            <span className={cls}>{t}</span>
          </div>
        ))}
        <p className="ds-cap ds-type-foot">System sans for everything — SF Pro on Mac, Segoe on Windows. Same sizes in Light and Dark.</p>
      </div>
    );
  }
  if (id === "space") {
    const m = o.fileEdit ? "12" : "10";
    return (
      <div className="ds-pad ds-col">
        <p className="ds-k">Corners</p>
        <div className="ds-radii">{[["XS", "4"], ["S", "6"], ["M", m], ["L", "14"], ["XL", "20"], ["Round", "∞"]].map(([n, v], i) => (
          <span key={n} className={`ds-rad ds-rad--${i}${n === "M" && o.fileEdit ? " ds-rad--m12" : ""}`} data-outside={n === "M" && o.outside?.includes("Corner M") ? "true" : undefined}><i /><b>{n}</b><em>{v}</em></span>
        ))}</div>
        <p className="ds-k ds-k--gap">Spacing</p>
        <div className="ds-space">{[4, 8, 12, 16, 24, 32, 48, 64].map((v) => <span key={v}><i style={{ height: v }} /><em>{v}</em></span>)}</div>
        <p className="ds-k ds-k--gap">Elevation</p>
        <div className="ds-elev">{[["Flat", "0"], ["Resting", "1"], ["Floating", "2"], ["Sheet", "3"]].map(([n, i]) => <span key={n} className={`ds-el ds-el--${i}`}>{n}</span>)}</div>
        <p className="ds-k ds-k--gap">Layout</p>
        <div className="ds-grid">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</div>
        <p className="ds-bps"><b>12 columns · gutter 24 · max 1200</b><span>Desktop 1440</span><span>Tablet 834</span><span>Mobile 390</span></p>
      </div>
    );
  }
  if (id === "motion") {
    return (
      <div className="ds-pad ds-motion">
        <MotionCard kind="out" name="Quick" ms="120 ms" job="Hover and press" />
        <MotionCard kind="out" name="Soft" ms="160 ms" job="Fades and tooltips" />
        <MotionCard kind="inout" name="Panel" ms="220 ms" job="Menus and panels" />
        <MotionCard kind="spring" name="Spring" ms="420 ms" job="A thing lands" />
        <p className="ds-cap ds-motion-foot">Reduce motion on this Mac: every curve becomes an instant cut.</p>
      </div>
    );
  }
  if (id === "components") {
    const s = o.sel;
    const nw = o.accentNew ? " ds-b--new" : "";
    return (
      <div className="ds-pad ds-comps">
        <Master name="Button" n={5} sel={s} span={3}>
          <Variants
            rows={[
              { name: "Primary", cell: (st) => <span className={`ds-b ds-b--primary${nw}`} data-st={st}>See the work</span> },
              { name: "Line", cell: (st) => <span className="ds-b ds-b--line" data-st={st}>Book a call</span> },
              { name: "Ghost", cell: (st) => <span className={`ds-b ds-b--ghost${nw}`} data-st={st}>Learn more</span> },
            ]}
            sizes={<><span className={`ds-b ds-b--primary ds-b--l${nw}`}>Large</span><span className={`ds-b ds-b--primary${nw}`}>Medium</span><span className={`ds-b ds-b--primary ds-b--sm${nw}`}>Small</span></>}
          />
        </Master>
        <Master name="Field" n={2} sel={s}>
          <span className="ds-fs">
            <span className="ds-f"><em>Email</em><span>you@company.com</span></span>
            <span className="ds-f ds-f--focus"><em>Email · focus</em><span>tereza@studio.cz</span></span>
            <span className="ds-f ds-f--err"><em>Email · error</em><span>tereza@studio</span></span>
          </span>
        </Master>
        <Master name="Toggle" n={1} sel={s}><span className="ds-seg"><span>Monthly</span><span data-on="true">Yearly</span></span><span className="ds-badge">Save two months</span></Master>
        <Master name="Service card" n={3} sel={s}><span className="ds-card"><i /><b>Product design</b><span>From a sketch to an app people enjoy.</span></span></Master>
        <Master name="Price tile" n={1} sel={s}><span className="ds-price"><b>Team</b><strong>29 €<em> / month</em></strong><span className={`ds-b ds-b--primary ds-b--sm${nw}`}>Start</span></span></Master>
        <Master name="Panel" n={2} sel={s}><span className="ds-panel"><b>Next steps</b><span>A reply within a day.</span></span></Master>
      </div>
    );
  }
  return (
    <div className="ds-pad ds-pats">
      <figure><div className="ds-pat ds-pat--web"><SHome nw={o.accentNew} ring={o.ring} /></div><figcaption><b>Homepage — hero</b> Display · Accent · Service card</figcaption></figure>
      <figure><div className="ds-pat ds-pat--web"><SPricing nw={o.accentNew} ring={o.ring} /></div><figcaption><b>Pricing</b> Toggle · Price tile · Heading</figcaption></figure>
      {o.partial ? (
        <figure><div className="ds-pat ds-pat--mid ds-pat--empty"><span><Spark size={14} />Onboarding needs real copy</span></div><figcaption><b>Onboarding</b> waiting for copy</figcaption></figure>
      ) : (
        <figure><div className="ds-pat ds-pat--mid"><SOnb nw={o.accentNew} ring={o.ring} /></div><figcaption><b>Onboarding</b> Title · Field · Button</figcaption></figure>
      )}
      <figure><div className="ds-pat ds-pat--phone"><SMobile nw={o.accentNew} ring={o.ring} /></div><figcaption><b>Mobile — detail</b> Panel · Button</figcaption></figure>
      <figure><div className="ds-pat ds-pat--land"><SLanding nw={o.accentNew} ring={o.ring} /></div><figcaption><b>Landing page</b> Display · Button</figcaption></figure>
    </div>
  );
}

/* Studio site screens — built from the Studio tokens (azure Accent, Service card, Price tile). Sized from their
   own box (container units), so the same piece works as a pattern, a canvas artboard or a review thumbnail.
   `nw` = Deeper azure; `ring` = each Accent spot ringed (what a review or the reach view points at). */
type Scr = { nw?: boolean; ring?: boolean; v?: "desk" | "tab" | "phone" };
const sx = (cls: string, { nw, ring, v }: Scr) => ({ className: `ds-sx ${cls}`, "data-new": nw ? "true" : undefined, "data-ring": ring ? "true" : undefined, "data-v": v });

function SHome(p: Scr) {
  return (
    <div {...sx("ds-shome", p)}>
      <span className="ds-sx-nav"><StudioLogo size="1em" /><i /><i /><i /><span className="ds-sx-btn ds-sx-btn--sm ds-sx-a">Book a call</span></span>
      <span className="ds-sx-hero">
        <span className="ds-sx-copy">
          <strong>Calm software, made in Brno.</strong>
          <span className="ds-sx-p">Small, careful apps for teams who would rather not shout.</span>
          <span className="ds-sx-row"><span className="ds-sx-btn ds-sx-a">See the work</span><span className="ds-sx-link ds-sx-a">How we work</span></span>
        </span>
        <span className="ds-sx-art"><i /><b /></span>
      </span>
      <span className="ds-sx-cards">{["Product design", "Brand", "Websites"].map((t) => <span key={t}><i /><b>{t}</b><em className="ds-sx-a">Read more</em></span>)}</span>
    </div>
  );
}
function SPricing(p: Scr & { offBadge?: boolean }) {
  return (
    <div {...sx("ds-sprice", p)}>
      <strong>Simple pricing</strong>
      <span className="ds-sx-tog"><span className="ds-sx-seg"><span>Monthly</span><span data-on="true">Yearly</span></span>
        {p.offBadge ? <span className="ds-sx-badge ds-sx-badge--off" data-sel="true">Save two months</span> : <span className="ds-sx-badge ds-sx-a">Save two months</span>}</span>
      <span className="ds-sx-tiles">
        {([["Solo", "12 €", false], ["Team", "29 €", true], ["Company", "79 €", false]] as const).map(([n, pr, f]) => (
          <span key={n} className={`ds-sx-tile${f ? " ds-sx-tile--f ds-sx-a" : ""}`}><b>{n}</b><strong>{pr}<em> / month</em></strong><i /><i /><span className={`ds-sx-btn${f ? " ds-sx-a" : " ds-sx-btn--line"}`}>Start</span></span>
        ))}
      </span>
      <span className="ds-sx-faq"><b>Questions</b><span><i /><i /></span><span><i /><i /></span></span>
    </div>
  );
}
function SOnb(p: Scr) {
  return (
    <div {...sx("ds-sphone ds-sonb", p)}>
      <span className="ds-sx-notch" />
      <span className="ds-sx-dot" />
      <strong>Welcome to Studio</strong>
      <span className="ds-sx-p">One account for your projects and invoices.</span>
      <span className="ds-sx-field ds-sx-a">tereza@studio.cz</span>
      <span className="ds-sx-btn ds-sx-btn--full ds-sx-a">Continue</span>
      <span className="ds-sx-link ds-sx-a">I have an account</span>
    </div>
  );
}
function SMobile(p: Scr) {
  return (
    <div {...sx("ds-sphone ds-smob", p)}>
      <span className="ds-sx-notch" />
      <strong>Your plan</strong>
      <span className="ds-sx-panel"><b>Team</b><em>29 € / month</em><i /><i /></span>
      <span className="ds-sx-p">Next invoice 1 Nov</span>
      <span className="ds-sx-btn ds-sx-btn--full ds-sx-a">Upgrade</span>
    </div>
  );
}
function SLanding(p: Scr) {
  return (
    <div {...sx("ds-sland", p)}>
      <span className="ds-sx-nav"><StudioLogo size="1em" /><span className="ds-sx-btn ds-sx-btn--sm ds-sx-a">Book a sprint</span></span>
      <strong>Design sprints, in a week.</strong>
      <span className="ds-sx-p">Five days from question to a tested prototype.</span>
      <span className="ds-sx-btn ds-sx-a">Book a sprint</span>
      <span className="ds-sx-strip"><i /><i /><i /><i /></span>
    </div>
  );
}

/* ─── Alligators brand system (green, frozen brand colours, Czech content) ─── */

/** The Alligators "A" mark — paths verbatim from assets/logos/mark-green.svg, filled with currentColor
 *  (green on paper, white on green — the brand's own rule). */
export function GatorMark({ size = 64 }: { size?: number }) {
  return (
    <svg className="ds-gmark" width={size} height={Math.round(size * 0.952)} viewBox="777.6 1499.8 39.9 38" fillRule="evenodd" aria-hidden="true">
      <path fillRule="nonzero" fill="currentColor" d="M801.109,1529.41L804.796,1529.41L803.269,1525C799.649,1523.74 795.577,1523.31 791.841,1524.38L790.099,1529.41L794.005,1529.41L794.005,1535.43L779.967,1535.43L779.967,1529.41L782.725,1529.41L792.808,1502.12L802.599,1502.12L812.462,1529.41L815.147,1529.41L815.147,1535.43L801.109,1535.43L801.109,1529.41ZM793.798,1518.67C797.592,1519.17 800.672,1521.93 803.244,1525L797.398,1508.16L793.798,1518.67Z" />
      <path fill="currentColor" d="M801.642,1526.66C799.001,1525.880 796.147,1525.59 793.436,1526.13L793.023,1527.32L796.086,1527.32L796.086,1537.51L777.885,1537.51L777.885,1527.32C777.885,1527.32 781.275,1527.32 781.275,1527.32L791.358,1500.03L804.06,1500.03L804.308,1500.72C804.308,1500.72 812.393,1523.09 813.923,1527.32L817.229,1527.32L817.229,1537.51L799.028,1537.51L799.028,1527.32L801.871,1527.32L801.642,1526.66ZM803.334,1528.37L800.068,1528.37L800.068,1536.47L816.188,1536.47L816.188,1528.37L813.192,1528.37L803.329,1501.08L792.083,1501.08L782,1528.37L778.926,1528.37L778.926,1536.47L795.046,1536.47L795.046,1528.37L791.561,1528.37L792.643,1525.24C795.867,1524.45 799.321,1524.81 802.453,1525.82C802.453,1525.82 803.334,1528.37 803.334,1528.37ZM795.169,1517.88L797.405,1511.35L800.732,1520.94C799.059,1519.52 797.211,1518.4 795.169,1517.88ZM796.502,1517.2C797.254,1517.47 797.982,1517.81 798.685,1518.21L797.411,1514.54L796.502,1517.2Z" />
    </svg>
  );
}

/** The Alligators button ("ZAPIŠ SE") — the master everyone uses. `nw` = the new 6 px corners. */
function GButton({ nw, children = "ZAPIŠ SE", line, dot, st, sm }: { nw?: boolean; children?: ReactNode; line?: boolean; dot?: boolean; st?: string; sm?: boolean }) {
  return <span className={`ds-gb${nw ? " ds-gb--new" : ""}${line ? " ds-gb--line" : ""}${sm ? " ds-gb--sm" : ""}`} data-st={st}>{children}{dot ? <i className="ds-upd" /> : null}</span>;
}
/** The club's signs — wide wordmark glyphs (assets/signs/*.svg), set as their words. */
const SIGNS = ["MATCH", "HOME", "AWAY", "SCORE", "WIN", "MVP", "NÁBOR"];

function GatorSec({ id, o }: { id: SecId; o: Opts }) {
  if (id === "brand") {
    return (
      <div className="ds-pad ds-col">
        <p className="ds-k">Logo · clear space</p>
        <div className="ds-clear ds-clear--g"><span className="ds-clear-x ds-clear-x--l" /><span className="ds-clear-x ds-clear-x--r" /><GatorMark size={84} /><span className="ds-gword">BRNO<br />ALLIGATORS</span></div>
        <div className="ds-logos"><span className="ds-logos-tile ds-logos-tile--gpaper"><GatorMark size={28} /></span><span className="ds-logos-tile ds-logos-tile--gink"><GatorMark size={28} /></span><span className="ds-logos-tile ds-logos-tile--gno"><GatorMark size={28} /><i /></span></div>
        <p className="ds-k ds-k--gap">Signs · 12 wordmark glyphs</p>
        <div className="ds-signs">{SIGNS.map((n) => <span key={n}>{n}</span>)}</div>
        <p className="ds-k ds-k--gap">Voice</p>
        <p className="ds-voice ds-voice--g">Parťák z kabiny — stručně, věcně, hrdě.</p>
        <p className="ds-say"><b>Say</b> ZAPIŠ SE <b>not</b> Neváhejte se registrovat!</p>
        <Rules rules={["Zelené logo jen na papíře, bílé jen na zelené.", "Inkoust nikdy na zelené ploše."]} />
      </div>
    );
  }
  if (id === "colour") {
    return (
      <div className="ds-pad ds-colour">
        <ModeKey sys="gator" />
        <div className="ds-swrow">
          <SwGroup title="Brand — locked, same in both">
            <Sw o={o} c="g-green" name="Klubová zelená" used={used(88)} lock /><Sw o={o} c="g-ink" name="Inkoust" used={used(61)} lock /><Sw o={o} c="g-gray" name="Šedá" used={used(40)} lock /><Sw o={o} c="g-yellow" name="Žlutá — akcent" used={used(71)} lock /><Sw o={o} c="g-white" name="Bílá" used={used(90)} lock />
          </SwGroup>
          <SwGroup title="Lines">
            <Sw o={o} c="g-line1" name="Linka — jemná" used={used(40)} /><Sw o={o} c="g-line2" name="Linka — střední" used={used(52)} />
          </SwGroup>
        </div>
        <div className="ds-swrow">
          <SwGroup title="Surfaces — paper in Light, one green in five steps in Dark">
            <Sw o={o} c="g-bg0" name="Plocha" used={used(88)} /><Sw o={o} c="g-bg1" name="Karta" used={used(57)} /><Sw o={o} c="g-bg2" name="Panel" used={used(33)} /><Sw o={o} c="g-bg3" name="Pole" used={used(21)} /><Sw o={o} c="g-bg4" name="Hover" used={used(9)} />
          </SwGroup>
        </div>
        <div className="ds-swrow">
          <SwGroup title="Text">
            <Sw o={o} c="g-fg0" name="Text" used={used(90)} /><Sw o={o} c="g-fg1" name="Sekundární" used={used(64)} /><Sw o={o} c={o.darkTertiary ? "g-fg2-dark" : "g-fg2"} name="Terciární" used={used(37)} />
          </SwGroup>
          <SwGroup title="Status">
            <Sw o={o} c="g-ok" name="Výhra" used={used(14)} /><Sw o={o} c="g-warn" name="Upozornění" used={used(3)} /><Sw o={o} c="g-err" name="Prohra" used={used(12)} /><Sw o={o} c="g-info" name="Info" used={used(6)} />
          </SwGroup>
        </div>
        <Pairs pairs={[
          { name: "Text na Ploše", l: ["--ds-g-ink", "--ds-g-paper"], d: ["--ds-g-white", "--ds-g-green"], rl: "17.9", rd: "13.8" },
          { name: "Sekundární na Kartě", l: ["--ds-gl-fg1", "--ds-gl-bg1"], d: ["--ds-g-gray", "--ds-g-bg1"], rl: "8.3", rd: "8.6" },
          { name: "Terciární na Ploše", l: ["--ds-gl-fg2", "--ds-g-paper"], d: ["--ds-g-fg2", "--ds-g-green"], rl: "5.7", rd: "7.0" },
          { name: "Inkoust na Žluté", l: ["--ds-g-ink", "--ds-g-yellow"], d: ["--ds-g-ink", "--ds-g-yellow"], rl: "11.9", rd: "11.9" },
        ]} />
      </div>
    );
  }
  if (id === "type") {
    const rows: [string, string, string, ReactNode][] = [
      ["Plakát", "120–200 · Heavy", "ds-g-display", "STAŇ SE GATOREM"],
      ["Nadpis", "39 · Heavy", "ds-g-heading", "COMBINE 2026"],
      ["Mezititulek", "25 · Demi Bold", "ds-g-title", "Gameweek 4 · So 15:00"],
      ["Text", "16 · Gators", "ds-g-body", "Combine je den, kdy se měří rychlost, síla a odhodlání. Přijď si to zkusit."],
      ["Popisek", "13 · Gators", "ds-g-cap", "Foto: Kraví hora, Brno"],
    ];
    return (
      <div className="ds-pad ds-type">
        {rows.map(([n, m, cls, t]) => (
          <div key={n} className="ds-trow" data-sel={o.sel === n ? "true" : undefined} data-presence={o.presence === n ? "true" : undefined}>
            <span className="ds-tname"><b>{n}</b><em>{m}</em></span>
            <span className={cls}>{t}</span>
          </div>
        ))}
        <p className="ds-cap ds-type-foot">Avenir Next Condensed for shouting, Gators for talking.</p>
      </div>
    );
  }
  if (id === "space") {
    return (
      <div className="ds-pad ds-col">
        <p className="ds-k">Corners — sharp, collegiate</p>
        <div className="ds-radii ds-radii--g">{[["XS", "2"], ["S", "4"], ["M", "6"], ["L", "10"], ["XL", "16"], ["Round", "∞"]].map(([n, v], i) => <span key={n} className={`ds-rad ds-grad--${i}`}><i /><b>{n}</b><em>{v}</em></span>)}</div>
        <p className="ds-k ds-k--gap">Spacing — base 8</p>
        <div className="ds-space">{[4, 8, 16, 24, 32, 48, 64, 96].map((v) => <span key={v}><i style={{ height: Math.min(v, 72) }} /><em>{v}</em></span>)}</div>
        <p className="ds-k ds-k--gap">Elevation — flat, like print</p>
        <div className="ds-elev ds-elev--g">{[["Flat", "0"], ["Soft", "1"], ["Lifted", "2"]].map(([n, i]) => <span key={n} className={`ds-el ds-gel--${i}`}>{n}</span>)}</div>
        <p className="ds-k ds-k--gap">Layout — formats</p>
        <div className="ds-grid ds-grid--g">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</div>
        <p className="ds-bps"><b>6 columns · margin 48</b><span>Post 1080 × 1350</span><span>Story 1080 × 1920</span><span>Leták A5</span></p>
      </div>
    );
  }
  if (id === "motion") {
    return (
      <div className="ds-pad ds-motion">
        <MotionCard kind="out" name="Rychle" ms="150 ms" job="Přepnutí, stisk" />
        <MotionCard kind="out" name="Měkce" ms="300 ms" job="Panely, nápovědy" />
        <MotionCard kind="inout" name="Přechod" ms="500 ms" job="Změna stránky" />
        <MotionCard kind="inout" name="Velký moment" ms="1000 ms" job="Touchdown" />
        <p className="ds-cap ds-motion-foot">Reduce motion: every curve becomes an instant cut.</p>
      </div>
    );
  }
  if (id === "components") {
    const s = o.sel;
    return (
      <div className="ds-pad ds-comps">
        <Master name="Tlačítko" n={34} sel={s} span={3} cls="ds-m--gbtn">
          <Variants
            rows={[
              { name: "Plné", cell: (st) => <GButton nw={o.btnNew} st={st} sm /> },
              { name: "Obrys", cell: (st) => <GButton nw={o.btnNew} st={st} sm line>VÍCE INFO</GButton> },
            ]}
            sizes={<><GButton nw={o.btnNew}>ZAPIŠ SE</GButton><GButton nw={o.btnNew} sm>ZAPIŠ SE</GButton></>}
          />
        </Master>
        <Master name="Štítek" n={22} sel={s}><span className="ds-gtag">NÁBOR 2027</span><span className="ds-gtag ds-gtag--line">JUNIOŘI</span></Master>
        <Master name="Výsledek" n={14} sel={s}><span className="ds-gscore"><em>VÝHRA</em><b>28 : 14</b></span><span className="ds-gscore ds-gscore--loss"><em>PROHRA</em><b>7 : 21</b></span></Master>
        <Master name="Zápas" n={19} sel={s}><span className="ds-gmatch"><em>GAMEWEEK 4</em><b>So 15:00</b><span>Kraví hora, Brno</span></span></Master>
        <Master name="Pole formuláře" n={4} sel={s}><span className="ds-gf"><em>E-mail</em><span>jmeno@email.cz</span></span></Master>
        <Master name="Karta hráče" n={9} sel={s}><span className="ds-gplayer"><i /><b>#27</b><span>Running back</span></span></Master>
      </div>
    );
  }
  return (
    <div className="ds-pad ds-pats">
      <figure><div className="ds-pat ds-pat--web"><GWeb /></div><figcaption><b>Klubový web — hero</b> Plakát · Tlačítko</figcaption></figure>
      <figure><div className="ds-pat ds-pat--poster"><GPoster headline="COMBINE 2026" nw={o.btnNew} /></div><figcaption><b>Leták A5</b> Nadpis · Tlačítko · Štítek</figcaption></figure>
      <figure><div className="ds-pat ds-pat--post"><GPost /></div><figcaption><b>Matchday post</b> Výsledek · Zápas</figcaption></figure>
      <figure><div className="ds-pat ds-pat--story"><GPoster headline="ZÍTRA SE MĚŘÍ" story nw={o.btnNew} /></div><figcaption><b>Story 9:16</b> Plakát · Tlačítko</figcaption></figure>
      <figure><div className="ds-pat ds-pat--poster"><GBack /></div><figcaption><b>Leták A5 · zadní strana</b> Light — paper</figcaption></figure>
    </div>
  );
}

/* Alligators screens built from the system (user content, Czech). */
function GPoster({ headline = "COMBINE 2026", sub = "So 14. 3. · Kraví hora", nw, story, dot, sel }: { headline?: string; sub?: string; nw?: boolean; story?: boolean; dot?: boolean; sel?: boolean }) {
  return (
    <div className={`ds-gposter${story ? " ds-gposter--story" : ""}`}>
      <span className="ds-gposter-mark"><GatorMark size={story ? 30 : 34} /></span>
      <span className="ds-gtag">NÁBOR 2027</span>
      <strong>{headline}</strong>
      <span className="ds-gposter-sub">{sub}</span>
      <span className="ds-gposter-cta" data-sel={sel ? "true" : undefined}><GButton nw={nw} dot={dot} /></span>
    </div>
  );
}
function GPost() {
  return (
    <div className="ds-gpost">
      <span className="ds-gposter-mark"><GatorMark size={26} /></span>
      <span className="ds-gscore ds-gscore--big"><em>VÝHRA</em><b>28 : 14</b></span>
      <span className="ds-gposter-sub">Gameweek 4 · Kraví hora</span>
    </div>
  );
}
function GWeb() {
  return (
    <div className="ds-gweb">
      <span className="ds-gweb-nav"><GatorMark size={18} /><i /><i /><i /><GButton>ZAPIŠ SE</GButton></span>
      <span className="ds-gweb-hero"><strong>STAŇ SE<br />GATOREM</strong><span>Combine 2026 · nábor pro sezónu 2027</span></span>
    </div>
  );
}

/* ═══ Local chrome pieces (kit candidates) ═══════════════════════════════════════════════════════ */

/** An inspector with free blocks (the kit Inspector takes [label, value] rows only). */
function Insp({ title, kind, children, adv, advOpen = false, advCount, style, cls = "" }: { title: ReactNode; kind?: string; children: ReactNode; adv?: ReactNode; advOpen?: boolean; advCount?: string; style?: CSSProperties; cls?: string }) {
  return (
    <div className={`island island--pad k-insp ds-insp ${cls}`} style={style}>
      <div className="k-insp-hd"><strong>{title}</strong>{kind ? <span className="chip">{kind}</span> : null}</div>
      {children}
      {advCount !== undefined ? (
        <div className="k-adv" data-open={advOpen ? "true" : undefined}>
          <span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced<span className="k-adv-count">{advCount}</span></span>
          {advOpen && adv ? <div className="k-adv-body">{adv}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
function Row({ k, children }: { k: string; children: ReactNode }) {
  return <div className="k-insp-row"><span>{k}</span>{children}</div>;
}
function Css({ k, v }: { k: string; v: string }) {
  return <div className="k-css"><span className="k-mono k-css-k">{k}</span><span className="k-mono k-css-v">{v}</span></div>;
}
/** "Uses Studio site system ›" — the link from any selection to the Design system canvas. */
function Uses({ name }: { name: string }) {
  return <span className="ds-uses"><span className="ds-uses-ic"><Icon name="system" size={12} /></span><span className="ds-uses-t">Uses {name}</span><Icon name="submenu" size={12} /></span>;
}
/** A quiet one-line status block inside the inspector. */
function Line({ tone = "ok", icon, children, action }: { tone?: "ok" | "warn" | "quiet"; icon?: string; children: ReactNode; action?: string }) {
  return (
    <div className={`ds-line ds-line--${tone}`}>
      {icon ? <span className="ds-line-ic">{icon === "spark" ? <Spark size={12} /> : <Icon name={icon} size={14} />}</span> : null}
      <span className="ds-line-t">{children}</span>
      {action ? <span className="btn btn--ghost btn--sm ds-line-act">{action}</span> : null}
    </div>
  );
}
/** A compact colour picker (lightness/chroma square + hue rail), drawn. */
function Picker({ c = "accent", at = [62, 30] as [number, number], hue = 66 }: { c?: string; at?: [number, number]; hue?: number }) {
  return (
    <div className="ds-picker">
      <span className={`ds-picker-sq ds-pk--${c}`}><i style={{ left: `${at[0]}%`, top: `${at[1]}%` }} /></span>
      <span className="ds-picker-hue"><i style={{ left: `${hue}%` }} /></span>
    </div>
  );
}
/** A tick (checkbox look) — on, off or mixed (a folder with some left out). */
function Tick({ on }: { on: boolean | "mixed" }) {
  return <span className="ds-tick" data-on={on === true ? "true" : on === "mixed" ? "mixed" : undefined}>{on === true ? <Icon name="check" size={11} /> : on === "mixed" ? <i /> : null}</span>;
}

/** A banner island at the top of the canvas — one action. */
function Banner({ icon = "system", children, action, sub }: { icon?: string; children: ReactNode; action?: string; sub?: ReactNode }) {
  return (
    <div className="island ds-banner">
      <span className="ds-banner-ic">{icon === "spark" ? <Spark size={14} /> : <Icon name={icon} size={16} />}</span>
      <span className="ds-banner-t">{children}{sub ? <em>{sub}</em> : null}</span>
      {action ? <span className="btn btn--primary btn--sm">{action}</span> : null}
    </div>
  );
}
/** The Design system canvas's own header bar: the system, its Light · Dark switch, and edits waiting for a review
 *  (batched — dragging a picker never opens a dialog). */
function DsBar({ name, mode = "Light", pending, view }: { name: string; mode?: "Light" | "Dark"; pending?: string; view?: string }) {
  return (
    <div className="island ds-bar">
      <span className="ds-bar-ic"><Icon name="system" size={14} /></span>
      <b>{name}</b>
      <span className="seg ds-bar-seg"><span className="k-seg-b" aria-pressed={mode === "Light"}>Light</span><span className="k-seg-b" aria-pressed={mode === "Dark"}>Dark</span></span>
      {view ? <span className="ds-bar-p">{view}</span> : null}
      {pending ? <><span className="ds-bar-sep" /><span className="ds-bar-p"><span className="ds-upd-dot" />{pending}</span><span className="btn btn--primary btn--sm">Review…</span></> : null}
    </div>
  );
}

/* Direction tiles (AI's three directions, drawn on the canvas — moodboard-style). */
type Dir = "a" | "b" | "c";
const DIRS: Record<Dir, { name: string; mood: string; type: string; why: string }> = {
  a: { name: "Calm daylight", mood: "cool white · azure · system sans", type: "System sans", why: "From your sentence: calm, precise." },
  b: { name: "Warm paper", mood: "cream · terracotta · serif headlines", type: "New York serif", why: "From your logo's coral dot." },
  c: { name: "Night shift", mood: "ink · lime · rounded", type: "SF Rounded", why: "From the dark hero on Homepage." },
};
function DirTile({ d }: { d: Dir }) {
  const x = DIRS[d];
  return (
    <div className={`ds-dir ds-dir--${d}`}>
      <span className="ds-dir-strip"><i /><i /><i /><i /><i /></span>
      <strong className="ds-dir-h">Calm software, made in Brno.</strong>
      <span className="ds-dir-p">Small, careful apps for teams who would rather not shout.</span>
      <span className="ds-dir-row"><span className="ds-dir-btn">See the work</span><span className="ds-dir-btn ds-dir-btn--line">Book a call</span></span>
      <span className="ds-dir-pic"><i /><b /></span>
      <span className="ds-dir-cards"><i /><i /><i /></span>
      <span className="ds-dir-meta"><b>{x.mood}</b>{x.why}</span>
    </div>
  );
}

/** A close-up page (no window): dotted ground, title, body, note strip. */
function Closeup({ title, sub, children, note, theme }: { title: string; sub?: string; children: ReactNode; note: ReactNode; theme?: "light" | "dark" }) {
  return (
    <V2 theme={theme} className="ds-cu">
      <div className="ds-cu-hd"><p className="ds-cu-t">{title}</p>{sub ? <p className="ds-cu-s">{sub}</p> : null}</div>
      <div className="ds-cu-body">{children}</div>
      <div className="ds-cu-note">{note}</div>
    </V2>
  );
}

/* Shared chrome for a Design system canvas frame. `preview` = a review / mark-up moment: the cluster reads Preview and
   the toolbar is Preview's annotation toolbar (CONTRACT §2); otherwise Edit with an Edit tool. */
function BoardChrome({ project, ds = true, zoom, ai, insp, people = ["tereza"], left, tool, bar, preview = false }: { project: "studio" | "gator"; ds?: boolean; zoom: number; ai?: ReactNode; insp?: ReactNode; people?: string[]; left?: ReactNode; tool?: string; bar?: ReactNode; preview?: boolean }) {
  return (
    <>
      <ProjectPill project={project === "studio" ? "Studio site" : "Alligators brand"} canvas="Design system" />
      {left ?? (project === "studio" ? <StudioPanel ds={ds} /> : <GatorPanel ds={ds} />)}
      <ShareCluster people={people} mode={preview ? "preview" : "edit"} />
      {bar}
      {insp}
      <ZoomUndo zoom={zoom} />
      <Toolbar tool={tool} mode={preview ? "annotate" : "edit"} />
      {ai ?? <PanelIcon icon="spark" at="ai" />}
    </>
  );
}

/* A review row: tick · the canvas, ringed where Accent sits · name · how many places. */
type RevArt = "home" | "price" | "onb" | "mobile" | "landing";
function RevScreen({ art, nw, ring }: { art: RevArt; nw?: boolean; ring?: boolean }) {
  const p = { nw, ring };
  return art === "home" ? <SHome {...p} /> : art === "price" ? <SPricing {...p} /> : art === "onb" ? <SOnb {...p} /> : art === "mobile" ? <SMobile {...p} /> : <SLanding {...p} />;
}
const STUDIO_REV: [RevArt, string, string, boolean, string?][] = [
  ["home", "Homepage", "14 places — buttons, links, cards", true],
  ["price", "Pricing", "11 places — Tereza has it open", true],
  ["onb", "Onboarding", "6 places", true],
  ["mobile", "Mobile — detail", "4 places", true],
  ["landing", "Landing page", "Left out — keeps Azure, gets an update dot", false],
];
function RevRows({ compact }: { compact?: boolean }) {
  return (
    <div className={`ds-rl${compact ? " ds-rl--c" : ""}`}>
      {STUDIO_REV.map(([a, n, p, on]) => (
        <span key={n} className="ds-rl-r" data-off={on ? undefined : "true"}>
          <Tick on={on} />
          <span className={`ds-rl-th ds-rl-th--${a === "onb" || a === "mobile" ? "phone" : "web"}`}><span className="ds-rl-scr"><RevScreen art={a} nw={on} ring={on} /></span></span>
          <span className="ds-rl-n"><b>{n}</b><em>{p}</em></span>
        </span>
      ))}
    </div>
  );
}

/* ═══ Several systems in one project (Alligators brand: the club system + the Combine 2026 campaign system) ═══ */

const CAMP_SYS = "Combine 2026";
/** The pinned group when a project uses more than one system (kit candidate: CanvasesPanel `systems[]`).
 *  Counts follow the canonical tree: 93 canvases = 87 on the club system + 6 in 2026/combine. */
function MultiGroup({ selected, menuOn, ds, schemaOld }: { selected?: "gator" | "camp"; menuOn?: "gator" | "camp"; ds?: "gator" | "camp"; schemaOld?: "gator" | "camp" }) {
  const rows: [key: "gator" | "camp" | "draft", name: string, sub: string][] = [
    ["gator", GATOR_SYS, "Default · 87 canvases"],
    ["camp", CAMP_SYS, "6 canvases · 2026/combine"],
    ["draft", "Alligators 2023", "Draft · no canvas uses it"],
  ];
  return (
    <span className="ds-mg">
      <span className="ds-mg-h">Design systems<em>2 in use</em></span>
      {rows.map(([k, n, sub]) => (
        <span key={k} className="ds-mg-r" data-sel={selected === k || ds === k ? "true" : undefined} data-menu={menuOn === k ? "true" : undefined} data-draft={k === "draft" ? "true" : undefined}>
          <span className="ds-mg-ic"><Icon name="system" size={14} /></span>
          <span className="ds-mg-t"><b>{n}</b><em>{schemaOld === k ? "Made before the schema" : sub}</em></span>
          {schemaOld === k ? <span className="ds-mg-warn" title="Made before the schema" /> : null}
          {menuOn === k ? <span className="ds-mg-more"><Icon name="more" size={14} /></span> : null}
        </span>
      ))}
    </span>
  );
}
function MultiPanel({ selected, menuOn, ds, schemaOld }: { selected?: string; menuOn?: "gator" | "camp"; ds?: "gator" | "camp"; schemaOld?: "gator" | "camp" }) {
  return <CanvasesPanel advanced project="Alligators brand" count={ALLIGATORS_COUNT} selected={selected} folders={GATOR_COMBINE_OPEN} items={ALLIGATORS_ROOT}
    system={{ name: (<MultiGroup menuOn={menuOn} ds={ds} schemaOld={schemaOld} />) as unknown as string, selected: false }} />;
}
const MULTI_SWITCH: [string, Art, string, boolean][] = [
  ["Combine-kampan", "gator-poster", "Tereza has it open — updates when she next looks", true],
  ["Combine-kampan — varianta pro partnery a sponzory", "gator-web", "Web page", true],
  ["Combine-letak-registrace", "gator-print", "Print · at the printer", true],
  ["Combine-invite", "gator-social", "Post", true],
  ["Combine-cisla", "gator-numbers", "Post", true],
  ["Combine-video-AI", "video", "Left out — keeps Combine 2026", false],
];
const SCHEMA_FIX: [string, string][] = [
  ["Adds 6 roles", "Display ramp, On accent, Focus, Selection, Scrim, Status text — from Combine 2026's own colours and type"],
  ["Renames 2 components", "Tlačítko kampaň → Button · Štítek kampaň → Tag, variants and Czech names kept"],
  ["Keeps 4 own tokens", "Camo pattern, scute height, stripe width, number outline — named as its own, so a switch hands them to AI"],
  ["Updates 6 canvases", "They point at the new names; nothing looks different"],
];
const MULTI_MIGRATE: [string, string, string, string][] = [
  [GATOR_SYS, "system/alligators", "87 canvases · default", "Design system canvas"],
  [CAMP_SYS, "system/combine-2026", "6 canvases in 2026/combine", "Design system canvas"],
  ["Alligators 2023", "system/alligators-2023", "no canvas uses it", "Draft"],
];

/* ═══ Canvas ═══════════════════════════════════════════════════════════════════════════════════ */

export default function DesignSystem() {
  return (
    <DesignCanvas>
      {/* ── 1 · Where it lives ─────────────────────────────────────────────────────────────── */}
      <DCSection id="where" title="Where the design system lives" subtitle="One canvas per system, “Design system”, pinned above every canvas — reached from the panel, ⌘K and the inspector. A project with several systems pins one row per system (see Several systems). The project menu gains nothing.">
        <DCArtboard id="ds-where-studio" label="1 · Studio site — pinned above every canvas" width={W} height={H} fixed>
          <Stage note={<Note n={1} title="It's a canvas, so it lives with the canvases.">“Design system” sits pinned above the list (1). Select anything and the inspector names its system — “Uses Studio site system” (2) opens it on that colour.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={300} y={118} w={403} h={252} selected size="1440 × 900"><SHome /></Artboard>
                <Artboard label="Tablet" kind="web" x={731} y={118} w={234} h={334}><SHome v="tab" /></Artboard>
                <Artboard label="Mobile" kind="web" x={993} y={118} w={109} h={236}><SHome v="phone" /></Artboard>
              </Canvas>
              <ProjectPill project="Studio site" canvas="Homepage" />
              <StudioPanel selected="Homepage" />
              <ShareCluster people={["tereza"]} mode="edit" />
              <Insp title="Desktop" kind="Artboard" advCount="6 properties">
                <Row k="Preset"><InSelect value="Desktop" /></Row>
                <Row k="Size"><InSize w={1440} h={900} /></Row>
                <Row k="Fill"><InFill name="Page" /></Row>
                <div className="ds-insp-sep" />
                <Uses name={STUDIO_SYS} />
              </Insp>
              <Callout n={1} x={272} y={151} outline />
              <Callout n={2} x={1132} y={223} outline />
              <ZoomUndo zoom={28} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-where-gator" label="2 · Alligators brand — ⌘K “design system”" width={W} height={H} fixed>
          <Stage note={<Note n={2} title="Search finds the Design system, and everything in it.">⌘K “design system” opens it. Every colour, type style and component is findable by its own name — Czech names too.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="FB event cover · FB Event · 1.91:1" kind="digital" x={300} y={110} w={384} h={201}><GWebCover /></Artboard>
                <Artboard label="Oznámení události · IG Post · 4:5" kind="digital" x={714} y={110} w={216} h={270}><GPoster headline="COMBINE 1. 10." sub="CESA VUT" /></Artboard>
                <Artboard label="Pozvánka · story · IG Story · 9:16" kind="digital" x={960} y={110} w={216} h={384}><GPoster headline="ZAPIŠ SE" sub="do 25. 9." story /></Artboard>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <GatorPanel selected="Combine-kampan" folders={GATOR_COMBINE_OPEN} />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <ZoomUndo zoom={20} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
              <Veil />
              <SearchPalette query="design system" groups={[
                { title: "Design system", rows: [
                  { label: GATOR_SYS, icon: "system", meta: "Design system · used by 3 projects · 7 sections", selected: true },
                ] },
                { title: "In the Design system", aside: "colours, type and components by name", rows: [
                  { label: "Klubová zelená", icon: "shape", meta: "Colour · brand · used in 88 canvases" },
                  { label: "Plakát — STAŇ SE GATOREM", icon: "type", meta: "Type style · 120–200" },
                  { label: "Tlačítko — ZAPIŠ SE", icon: "system", meta: "Component · used in 34 canvases" },
                ] },
                { title: "Actions", rows: [
                  { label: "Check the system", icon: "done", where: "Design system › Advanced" },
                  { label: "Switch canvases to another system…", icon: "sync", where: "Design system row" },
                ] },
              ]} />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 2 · The Design system canvas ───────────────────────────────────────────────────── */}
      <DCSection id="board" title="The Design system canvas" subtitle="Seven sections as artboards — Brand · Colour · Type · Space & shape · Motion · Components · Patterns. Every colour has a Light and a Dark value; one switch shows the whole system in either.">
        <DCArtboard id="ds-board-studio" label="3 · The Design system canvas — Studio site system, at 100 %" width={2400} height={2140} fixed>
          <V2 className="ds-hero">
            <div className="ds-hero-hd">
              <span className="ds-hero-ic"><Icon name="system" size={22} /></span>
              <div>
                <p className="ds-hero-t">Design system <span>{STUDIO_SYS} · used by Studio site</span></p>
                <p className="ds-hero-s">7 sections · 22 colours, each with a Light and a Dark value · 6 type styles · 6 components with their states · used by 5 canvases. Everything here is live — select a swatch, a style or a component and edit it in place.</p>
              </div>
              <span className="ds-hero-who">
                <span className="seg ds-bar-seg ds-hero-seg"><span className="k-seg-b" aria-pressed="true">Light</span><span className="k-seg-b">Dark</span></span>
                <span className="k-faces"><Avatar who="you" /><Avatar who="tereza" /></span><span className="ds-hero-z">100%</span>
              </span>
            </div>
            <div className="ds-hero-board k-canvas--dots">
              <Board sys="studio" z={1} x={92} y={56} />
            </div>
            <div className="ds-hero-note">
              <Note n={3} title="The specimen pages, as one canvas you can edit.">Colour by role, each swatch Light | Dark, named in words with where it's used; type as real sentences; every component with its sizes and states; Patterns are real screens built from them.</Note>
            </div>
          </V2>
        </DCArtboard>

        <DCArtboard id="ds-board-dark" label="4 · The same system in Dark" width={W} height={H} fixed>
          <Stage note={<Note n={4} title="Dark is the system's own mode, not the app's theme.">Light · Dark at the top switches every section to the system's dark values — swatches, components, Patterns. The app around it keeps its own theme.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas><Board sys="studio" z={0.42} x={300} y={104} o={{ dark: true }} /></Canvas>
              <BoardChrome project="studio" zoom={42} bar={<DsBar name={STUDIO_SYS} mode="Dark" view="22 colours in their dark values" />} />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-board-gator" label="5 · Alligators brand system — the club green" width={W} height={H} fixed>
          <Stage note={<Note n={5} title="Same seven sections, the club's own colours.">Brand colours carry a lock — the 2023 rebrand is frozen. Dark is the club green, Light is paper for print; each swatch shows both. Type shouts in Avenir Next Condensed.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Board sys="gator" z={0.42} x={300} y={104} /></Canvas>
              <BoardChrome project="gator" zoom={42} people={["tereza", "jonas"]} bar={<DsBar name={GATOR_SYS} mode="Dark" />} />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 3 · Editing ────────────────────────────────────────────────────────────────────── */}
      <DCSection id="edit" title="Editing in place — and choosing who follows" subtitle="A swatch, then a component master. Edits wait in one review; every canvas has a tick, left-out canvases get a quiet dot, Cancel changes nothing.">
        <DCArtboard id="ds-edit-colour" label="6 · Select a swatch, edit the colour" width={W} height={H} fixed>
          <Stage note={<Note n={6} title="Edit the Light value; Dark follows unless you say otherwise.">Contrast is checked in both modes as you drag. Edits collect in “1 change waiting” — nothing opens a dialog mid-drag. Tereza is on Type; nothing locks.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Board sys="studio" z={0.48} x={70} y={96} o={{ sel: "Accent", presence: "Heading", accentNew: true }} />
                <Cursor name="tereza" x={1060} y={168} />
              </Canvas>
              <BoardChrome project="studio" zoom={48} left={<PanelIcon icon="panel-left" at="left" />}
                bar={<DsBar name={STUDIO_SYS} pending="1 change waiting" />}
                insp={
                  <Insp title="Accent" kind="Colour" advOpen advCount="OKLCH" adv={<><Css k="light" v="0.50 0.190 255" /><Css k="dark" v="0.60 0.175 255" /><Css k="token" v="--accent" /></>}>
                    <Row k="Editing"><InSeg options={["Light", "Dark"]} value="Light" /></Row>
                    <Row k="Light"><span className="k-fill"><span className="k-fill-sw ds-c--accent-new" />Deeper azure</span></Row>
                    <Picker c="accent-new" at={[70, 34]} hue={70} />
                    <Row k="Dark"><span className="k-fill"><span className="k-fill-sw ds-c--accent-new ds-on-d" />Follows Light</span></Row>
                    <Row k="Dark follows automatically"><InSwitch on /></Row>
                    <Line icon="done">5.6:1 on white · 4.8:1 on the dark page</Line>
                    <Line tone="quiet" icon="layers" action="Show">Used in 5 canvases · was Azure</Line>
                  </Insp>
                } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-edit-reach" label="7 · One colour, everywhere it lands — Show" width={2400} height={1250} fixed>
          <V2 className="ds-reach">
            <div className="ds-reach-hd">
              <p className="ds-cu-t">One colour, everywhere it lands</p>
              <p className="ds-cu-s">Accent went from Azure to Deeper azure on the Design system canvas. “Used in 5 canvases › Show” draws where it goes — the system's own Patterns and every canvas — before anything is updated.</p>
            </div>
            <div className="ds-reach-stage k-canvas--dots">
              <svg className="ds-reach-lines" width="2400" height="920" viewBox="0 0 2400 920" aria-hidden="true">
                <path d="M520 290 C 600 290, 640 200, 720 200" />
                <path d="M520 290 C 680 290, 640 640, 720 640" />
                <path d="M520 290 C 600 290, 640 418, 780 418 L 1600 418 C 1650 418, 1680 436, 1680 470" />
                <circle cx="520" cy="290" r="5" /><circle cx="720" cy="200" r="4" /><circle cx="720" cy="640" r="4" /><circle cx="1680" cy="470" r="4" />
              </svg>
              <div className="island island--pad ds-token">
                <p className="ds-token-k">Colour › Accent</p>
                <span className="ds-token-chip ds-c--accent-new"><span className="ds-chip-l"><em>Light</em></span><span className="ds-chip-d"><em>Dark</em></span></span>
                <p className="ds-token-ch"><span className="ds-rev-chip ds-c--accent" />Azure<Icon name="submenu" size={12} /><span className="ds-rev-chip ds-c--accent-new" /><b>Deeper azure</b></p>
                <Line icon="done">5.6:1 on white · 4.8:1 on the dark page</Line>
                <Line tone="quiet" icon="layers" action="Hide">Used in 5 canvases · showing</Line>
              </div>
              <Artboard label="Patterns — on the Design system canvas" x={720} y={70} w={1580} h={308}>
                <Scaled w={2256} h={440} z={0.7}><div className="ds-sec ds-sec--studio"><StudioSec id="patterns" o={{ accentNew: true, ring: true }} /></div></Scaled>
              </Artboard>
              <span className="ds-reach-tag" style={{ left: 2128, top: 30 }}>4 patterns · 21 places</span>
              <Artboard label="Homepage · Desktop" kind="web" x={720} y={470} w={600} h={375}><SHome nw ring /></Artboard>
              <span className="ds-reach-tag" style={{ left: 1320, top: 438 }}>14 places</span>
              <Artboard label="Pricing · Desktop" kind="web" x={1380} y={470} w={600} h={375}><SPricing nw ring /></Artboard>
              <span className="ds-reach-tag" style={{ left: 1980, top: 438 }}>11 places</span>
              <span className="ds-reach-more"><Icon name="layers" size={14} />Onboarding, Mobile — detail and Landing page are in the review too</span>
              <div className="island island--pad ds-reach-rev">
                <p className="ds-reach-rev-t">Update canvases with the new Accent?</p>
                <RevRows compact />
                <div className="k-dialog-a"><span className="btn">Cancel</span><span className="btn btn--primary">Update 4 canvases</span></div>
              </div>
            </div>
            <div className="ds-reach-note">
              <Note n={7} title="Only a canvas-native system can show its own reach.">Lines run from the swatch to every spot that will change, ringed. The review is the same list — untick a canvas to leave it out.</Note>
            </div>
          </V2>
        </DCArtboard>

        <DCArtboard id="ds-edit-review" label="8 · Update canvases — tick who follows" width={W} height={H} fixed>
          <Stage note={<Note n={8} title="Every canvas has a tick; Cancel changes nothing.">Untick Landing page and it keeps Azure, with an update dot. Cancel puts the swatch back. ⌘Z after Update takes all four back.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas><Board sys="studio" z={0.48} x={70} y={96} o={{ sel: "Accent", accentNew: true }} /></Canvas>
              <BoardChrome project="studio" zoom={48} left={<PanelIcon icon="panel-left" at="left" />} bar={<DsBar name={STUDIO_SYS} pending="1 change waiting" />} />
              <Veil strong />
              <Dialog title="Update canvases with the new Accent?" primary="Update 4 canvases" width={640}>
                <div className="ds-rev">
                  <p className="ds-rev-sw"><span className="ds-rev-chip ds-c--accent" />Azure<Icon name="submenu" size={12} /><span className="ds-rev-chip ds-c--accent-new" />Deeper azure<span className="ds-rev-ok"><Icon name="done" size={12} />Fine in Light and Dark</span></p>
                  <p className="ds-rev-hd"><Tick on="mixed" /><b>4 of 5 canvases in Studio site</b><span className="seg ds-rev-seg"><span className="k-seg-b">Before</span><span className="k-seg-b" aria-pressed="true">After</span></span></p>
                  <RevRows />
                  <p className="ds-rev-fine">Unticked canvases keep the old Accent and show an update dot. Cancel puts the swatch back — nothing changes. Tereza's open Pricing updates when she next looks at it.</p>
                </div>
              </Dialog>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-edit-master" label="9 · Edit a component master — leave a folder out" width={W} height={H} fixed>
          <Stage note={<Note n={9} title="Leave a whole folder out with one tick.">Tlačítko's corners went 2 → 6. 2026/combine stays out — the leták is at the printer — so its 6 canvases keep 2 px and get the update dot.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Board sys="gator" z={0.6} x={-560} y={-300} o={{ sel: "Tlačítko", btnNew: true }} /></Canvas>
              <BoardChrome project="gator" zoom={60} people={["tereza", "jonas"]} />
              <Veil strong />
              <Dialog title="Update canvases with the new Tlačítko?" primary="Update 28 canvases" width={600}>
                <div className="ds-rev">
                  <p className="ds-rev-sw"><span className="ds-rev-g"><GButton sm>ZAPIŠ SE</GButton><Icon name="submenu" size={12} /><GButton sm nw>ZAPIŠ SE</GButton></span>Corners 2 → 6</p>
                  <p className="ds-rev-hd"><Tick on="mixed" /><b>28 of 34 canvases use Tlačítko</b><span className="ds-rev-by">by folder</span></p>
                  <div className="ds-rl ds-rl--f">
                    {([["club-web", 5], ["social", 12], ["2026/social", 4], ["2026/dresy", 3], ["print", 4]] as const).map(([f, n]) => (
                      <span key={f} className="ds-rl-r"><Tick on /><Icon name="folder" size={14} /><span className="ds-rl-n"><b>{f}</b></span><em className="ds-rl-c">{n} {n === 1 ? "canvas" : "canvases"}</em></span>
                    ))}
                    <span className="ds-rl-r" data-off="true"><Tick on={false} /><Icon name="folder" size={14} /><span className="ds-rl-n"><b>2026/combine</b></span><em className="ds-rl-c">6 canvases · left out</em></span>
                    {ALLIGATORS_COMBINE.map((c) => (
                      <span key={c.name} className="ds-rl-r ds-rl-r--in" data-off="true"><Tick on={false} /><Thumb art={(c.art ?? "blank") as Art} w={28} h={20} /><span className="ds-rl-n"><b>{c.name}</b></span>{c.name === "Combine-letak-registrace" ? <em className="ds-rl-c">at the printer</em> : null}</span>
                    ))}
                  </div>
                  <p className="ds-rev-fine">Left-out canvases keep 2 px corners and show an update dot. Cancel puts the master back — nothing changes.</p>
                </div>
              </Dialog>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-edit-instance" label="10 · A canvas that was left out — update available" width={W} height={H} fixed>
          <Stage note={<Note n={10} title="A quiet dot, not a nag.">Canvases left out of an update carry a small dot. Select one: Update brings the new corners; Detach makes it a plain shape. A new one placed with Component (⇧I) arrives current.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Leták A5 · přední strana" kind="print" x={330} y={112} w={280} h={397}><GPoster headline="COMBINE 2026" dot sel /></Artboard>
                <Artboard label="Leták A5 · zadní strana" kind="print" x={650} y={112} w={280} h={397}><GBack /></Artboard>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-letak-registrace" />
              <GatorPanel selected="Combine-letak-registrace" folders={GATOR_COMBINE_OPEN} />
              <ShareCluster people={["tereza", "jonas"]} mode="edit" />
              <Insp title="Tlačítko" kind="Component" advCount="Instance of Tlačítko">
                <Uses name={GATOR_SYS} />
                <Row k="Text"><span className="input ds-in">ZAPIŠ SE</span></Row>
                <div className="ds-insp-sep" />
                <div className="ds-upd-block">
                  <p><span className="ds-upd-dot" />Update available</p>
                  <span className="ds-upd-what">Corners 2 → 6, by You, 10 min ago. 2026/combine was left out of that update.</span>
                  <span className="ds-upd-acts"><span className="btn btn--sm btn--primary">Update</span><span className="btn btn--sm btn--ghost">Detach</span></span>
                </div>
              </Insp>
              <ZoomUndo zoom={50} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 4 · Source of truth ────────────────────────────────────────────────────────────── */}
      <DCSection id="truth" title="The Design system canvas and its files" subtitle="For designers the canvas is the source; the files are written from it and are the source for code. A file changed outside the app comes back as a review; a clash keeps both until one is picked.">
        <DCArtboard id="ds-truth-outside" label="11 · 2 tokens changed outside the app" width={W} height={H} fixed>
          <Stage note={<Note n={11} title="An outside edit arrives as a review, never silently.">Claude Code changed colors_and_type.css. The two tokens show their new values, marked, until you Keep them or Undo — Undo writes the old values back to the file.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas><Board sys="studio" z={0.48} x={64} y={96} o={{ outside: ["Quiet", "Corner M"], fileEdit: true }} /></Canvas>
              <BoardChrome project="studio" zoom={48} left={<PanelIcon icon="panel-left" at="left" />} bar={<DsBar name={STUDIO_SYS} />}
                insp={
                  <Insp title="2 tokens changed outside the app" cls="ds-tr">
                    <p className="ds-tr-src"><Icon name="file" size={14} /><span><b>colors_and_type.css</b> was edited by Claude Code, 4 min ago</span></p>
                    <div className="ds-tr-c"><b>Quiet</b><span className="ds-tr-ba"><span className="ds-rev-chip ds-c--ink3" /><Icon name="submenu" size={12} /><span className="ds-rev-chip ds-c--ink3-new" /></span><em>Text · Light value darker · 4.9 → 5.6:1 on Well</em></div>
                    <div className="ds-tr-c"><b>Corner M</b><span className="ds-tr-ba"><span className="ds-tr-r ds-tr-r--10" /><Icon name="submenu" size={12} /><span className="ds-tr-r ds-tr-r--12" /></span><em>10 → 12 px · cards, fields, panels</em></div>
                    <p className="ds-rev-fine">Keep makes them part of the system. Canvases then follow after the usual review.</p>
                    <span className="ds-tr-acts"><span className="btn btn--sm">Undo</span><span className="btn btn--sm btn--primary">Keep</span></span>
                  </Insp>
                } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-truth-conflict" label="12 · You and the file changed the same token" width={W} height={H} fixed>
          <Stage note={<Note n={12} title="A clash keeps both, side by side, until one is picked.">You set Accent here; Jonas's git pull changed it in the file. Canvases keep Azure meanwhile, and the file is rewritten with the one you pick.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas><Board sys="studio" z={0.48} x={64} y={96} o={{ conflict: "Accent", accentNew: true }} /></Canvas>
              <BoardChrome project="studio" zoom={48} left={<PanelIcon icon="panel-left" at="left" />} people={["tereza", "jonas"]} bar={<DsBar name={STUDIO_SYS} />}
                insp={
                  <Insp title="Accent changed in two places" cls="ds-tr">
                    <p className="ds-tr-src"><Icon name="problem" size={14} /><span>Pick one. Until then canvases keep <b>Azure</b>.</span></p>
                    <div className="ds-cf">
                      <span className="ds-cf-c">
                        <em>On this canvas</em>
                        <span className="ds-cf-chip ds-c--accent-new" />
                        <b>Deeper azure</b>
                        <span className="ds-cf-who"><Avatar who="you" size="sm" />You · 10 min ago</span>
                        <span className="btn btn--sm">Use this</span>
                      </span>
                      <span className="ds-cf-c">
                        <em>In colors_and_type.css</em>
                        <span className="ds-cf-chip ds-c--accent-file" />
                        <b>Sea blue</b>
                        <span className="ds-cf-who"><Avatar who="jonas" size="sm" />Jonas · git pull, 2 min ago</span>
                        <span className="btn btn--sm">Use this</span>
                      </span>
                    </div>
                    <p className="ds-rev-fine">Both stay on the swatch, marked “2 versions”. The one you don't pick stays in Version history.</p>
                  </Insp>
                } />
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 5 · Making a design system ─────────────────────────────────────────────────────── */}
      <DCSection id="make" title="Making a design system" subtitle="How Studio site got its system — a sentence and a few things to learn from, three directions on a canvas, pick or mix, AI builds it live, partial results said plainly">
        <DCArtboard id="ds-make-inputs" label="13 · Make a design system — three quick inputs" width={W} height={H} fixed>
          <Stage note={<Note n={13} title="Three inputs instead of a long interview.">From Home's starters — or the pinned row of a project that has none (“Make a design system”). Only the sentence is needed; the rest helps AI learn.</Note>}>
            <Window tabs={[TABS.home, TABS.studio, TABS.alligators]} activeTab="home">
              <Home compact placeholder="Describe what to make…" target="Studio site" starters={[
                { t: "A design system", l: "for Studio site", art: "brand" },
                { t: "A pricing page", l: "with a yearly toggle", art: "price" },
                { t: "An onboarding flow", l: "four screens, mobile", art: "onb" },
              ]} />
              <Veil strong />
              <div className="k-dialog ds-make">
                <p className="k-dialog-t">Make a design system for Studio site</p>
                <div className="ds-make-f">
                  <p className="ds-make-l"><b>1</b>Say what the brand is, in a sentence</p>
                  <span className="textarea ds-make-ta">A small Brno studio that makes calm software. Friendly, precise, never loud.<i className="k-caretline" /></span>
                </div>
                <div className="ds-make-f">
                  <p className="ds-make-l"><b>2</b>Anything to learn from? <em>Optional</em></p>
                  <div className="ds-make-src">
                    <span className="ds-src ds-src--on"><Icon name="image" size={16} /><b>Logo</b><em>studio-logo.png</em><span className="ds-src-x"><Icon name="check" size={12} /></span></span>
                    <span className="ds-src"><Icon name="link" size={16} /><b>Website</b><em>Paste a link</em></span>
                    <span className="ds-src"><Icon name="layers" size={16} /><b>Figma library</b><em>Connect</em></span>
                    <span className="ds-src ds-src--on"><Icon name="frame" size={16} /><b>Your canvases</b><em>5 in Studio site</em><span className="ds-src-x"><Icon name="check" size={12} /></span></span>
                  </div>
                </div>
                <div className="ds-make-f">
                  <p className="ds-make-l"><b>3</b>Mostly for</p>
                  <span className="seg ds-make-seg"><span className="k-seg-b" aria-pressed="true">Websites</span><span className="k-seg-b">Apps</span><span className="k-seg-b">Print and social</span><span className="k-seg-b">A bit of everything</span></span>
                </div>
                <p className="ds-make-fine"><Spark size={12} />AI puts three directions on a new Design system canvas, each in Light and Dark. Your canvases don't change until you choose.</p>
                <div className="k-dialog-a"><span className="btn">Cancel</span><span className="btn btn--primary"><Spark size={12} color="currentColor" />Make three directions</span></div>
              </div>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-make-directions" label="14 · Three directions, on the Design system canvas" width={W} height={H} fixed>
          <Stage note={<Note n={14} title="Directions are artboards, so you can mark them up.">In Preview: comment, sticky, compare at full size. AI says what it read and what it couldn't, then asks the one question that changes the outcome.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                {(["a", "b", "c"] as Dir[]).map((d, i) => (
                  <Artboard key={d} label={`Direction ${d.toUpperCase()} · ${DIRS[d].name}`} x={296 + i * 264} y={118} w={240} h={440} aiMade><DirTile d={d} /></Artboard>
                ))}
              </Canvas>
              <BoardChrome project="studio" zoom={50} preview left={<StudioPanel ds dsAi />}
                ai={
                  <AIPanel chat="Design system for Studio site" advanced scope="Design system"
                    messages={[
                      { from: "you", text: "A small Brno studio that makes calm software. Friendly, precise, never loud." },
                      { from: "ai", text: "Three directions are on the Design system canvas — read from your sentence, the logo and 5 canvases. Figma wasn't connected, so no library was used." },
                    ]}
                    question={{ text: "One question first: is Studio site mostly for people or for companies? People suit A's calm; companies suit B's more formal serif.", primary: "Mostly people", secondary: "Mostly companies" }}
                  />
                } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-make-mix" label="15 · Pick one, or mix" width={W} height={H} fixed>
          <Stage note={<Note n={15} title="Pick a direction, or borrow a part of another.">Select A and its bar offers Use A or Mix with… — B's type, C's colour, corners. Saying it in the chat works too.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                {(["a", "b", "c"] as Dir[]).map((d, i) => (
                  <Artboard key={d} label={`Direction ${d.toUpperCase()} · ${DIRS[d].name}`} x={296 + i * 264} y={118} w={240} h={440} selected={d === "a"} size={d === "a" ? "Picked" : undefined} dim={d === "c"}><DirTile d={d} /></Artboard>
                ))}
                <div className="island ds-pickbar" style={{ left: 296, top: 576 }}>
                  <span className="btn btn--primary btn--sm">Use A</span>
                  <span className="btn btn--sm ds-pickbar-mix" data-open="true">Mix with…<Icon name="chevron" size={12} /></span>
                </div>
                <Menu style={{ left: 352, top: 614 }} width={232} items={[
                  { group: "From B · Warm paper" }, { label: "B's type — serif headlines", icon: "type", highlight: true }, { label: "B's colours", icon: "shape" },
                  "sep", { group: "From C · Night shift" }, { label: "C's colours", icon: "shape" }, { label: "C's rounder corners", icon: "frame" },
                ]} />
              </Canvas>
              <BoardChrome project="studio" zoom={50} left={<StudioPanel ds dsAi />}
                ai={
                  <AIPanel chat="Design system for Studio site" advanced scope="Direction A"
                    messages={[
                      { from: "ai", text: "One question first: is Studio site mostly for people or for companies?" },
                      { from: "you", text: "Mostly people" },
                      { from: "ai", text: "Then A fits best — its calm reads friendly. B's serif would make headlines a touch more formal; want it in A?" },
                    ]}
                    chips={["Use A as it is", "A with B's serif"]}
                  />
                } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-make-filling" label="16 · The Design system fills in, section by section" width={W} height={H} fixed>
          <Stage note={<Note n={16} title="Watch it being built — and stop it any time.">Each section lands as AI finishes it; the next ones wait as quiet outlines. Brand and Colour are done and already editable while Type is drawn.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas><Board sys="studio" z={0.34} x={300} y={112} ai="AI is setting the type" st={{ brand: "made", colour: "made", type: "ai", space: "ghost", motion: "ghost", components: "ghost", patterns: "ghost" }} /></Canvas>
              <BoardChrome project="studio" zoom={34} left={<StudioPanel ds dsAi />}
                ai={
                  <AIPanel chat="Design system for Studio site" advanced scope="Design system"
                    messages={[
                      { from: "you", text: "A with B's serif — for headlines only" },
                      { from: "ai", text: "Building it: Direction A, with New York for Display and Heading. Every colour gets a Light and a Dark value." },
                    ]}
                    working="AI is setting the type" step="Brand and Colour done · 5 sections to go"
                  />
                } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-make-done" label="17 · Ready — use it as Studio site's style" width={W} height={H} fixed>
          <Stage note={<Note n={17} title="Done, with what's missing said plainly.">Six sections are complete; Patterns waits for Onboarding copy and the logo is a small PNG. One button makes it the project's style — every canvas then picks it up after a review.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas><Board sys="studio" z={0.34} x={300} y={124} o={{ partial: true }} st={{ brand: "made", colour: "made", type: "made", space: "made", motion: "made", components: "made", patterns: "made" }} /></Canvas>
              <BoardChrome project="studio" zoom={34} left={<StudioPanel ds />}
                ai={
                  <AIPanel chat="Design system for Studio site" advanced scope="Design system"
                    messages={[
                      { from: "ai", text: "Done — seven sections are on the Design system canvas. Two things are partial: Patterns has 4 of 5 screens (Onboarding needs real copy), and the logo is a 120 px PNG — an SVG keeps it sharp." },
                    ]}
                    chips={["Draw Onboarding with sample copy", "Check the system"]}
                  />
                } />
              <Banner icon="system" action="Use as Studio site's style" sub="Studio site's 5 canvases update after a review.">Studio site system is ready.</Banner>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 6 · Many systems ───────────────────────────────────────────────────────────────── */}
      <DCSection id="many" title="Many systems" subtitle="Preview canvases in another system before switching; share one as a team library on cloud.maude.sh; a linked project sees it read-only. A project can use several systems at once — next section">
        <DCArtboard id="ds-many-switch" label="18 · Preview the project in another system" width={W} height={H} fixed>
          <Stage note={<Note n={18} title="Try a whole project in another system, then decide.">↑↓ in the row's menu previews each system in every canvas; ↵ opens the switch review (23); esc steps back. Warm paper is direction B — an AI direction kept on the same Design system canvas, not a separate system.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Desktop" kind="web" x={300} y={118} w={403} h={252}><WarmHero /></Artboard>
                <Artboard label="Tablet" kind="web" x={731} y={118} w={234} h={334}><WarmHero small /></Artboard>
                <Artboard label="Mobile" kind="web" x={993} y={118} w={109} h={236}><WarmHero phone /></Artboard>
                <Menu style={{ left: 256, top: 142 }} width={280} items={[
                  { group: "Design systems" },
                  { label: STUDIO_SYS, icon: "system", checked: true, note: "in use" },
                  { label: "Warm paper", icon: "system", highlight: true, note: "draft · previewing" },
                  { label: GATOR_SYS, icon: "people", note: "team library" },
                  "sep",
                  { label: "Open the Design system", keys: "↵" },
                  { label: "Make a design system…" },
                  { label: "Link a team library…" },
                ]} />
              </Canvas>
              <ProjectPill project="Studio site" canvas="Homepage" />
              <StudioPanel selected="Homepage" />
              <ShareCluster people={["tereza"]} mode="edit" />
              <ZoomUndo zoom={28} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
              <Banner icon="view" action="Switch…" sub="5 canvases shown in it · esc to stop">Previewing Studio site in Warm paper.</Banner>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-many-library" label="19 · A team library on cloud.maude.sh — updates arrive as a review" width={W} height={720} fixed>
          <Closeup title="One system, three projects" sub="Alligators brand shares its system as a team library on cloud.maude.sh. A project linking it gets each update as a review — never silently."
            note={<Note n={19} title="Shared once, reviewed everywhere.">The library is the same Design system canvas, read by 3 projects. Alligators — junioři sees 3 changes waiting and takes them in one step, or later.</Note>}>
            <div className="ds-lib-row">
              <div className="island island--pad ds-lib">
                <div className="ds-lib-hd">
                  <span className="ds-lib-pic"><GatorMark size={34} /></span>
                  <div><p className="ds-lib-t">{GATOR_SYS}</p><p className="ds-lib-s"><Icon name="cloud" size={12} />Team library · alligators.cloud.maude.sh</p></div>
                </div>
                <p className="island-title ds-lib-k">Used by 3 projects</p>
                {([["A", "lilac", "Alligators brand", "Where it's edited", "ok"], ["J", "green", "Alligators — junioři", "3 updates waiting", "warn"], ["F", "coral", "Flag turnaj 2026", "Up to date", "ok"]] as const).map(([i, t, n, s, st]) => (
                  <span key={n} className="row-item ds-lib-p"><Avatar ini={i} tone={t} size="sm" /><b>{n}</b><span className={`ds-lib-st ds-lib-st--${st}`}>{s}</span></span>
                ))}
                <p className="island-title ds-lib-k">Can edit the library</p>
                <span className="ds-lib-who"><span className="k-faces"><Avatar who="you" /><Avatar who="tereza" /></span>You and Tereza · others use it</span>
                <span className="ds-lib-acts"><span className="btn btn--sm">Open the Design system</span><span className="btn btn--sm btn--primary"><Icon name="share" size={12} />Share…</span></span>
              </div>
              <span className="ds-lib-arrow"><Icon name="submenu" size={20} /></span>
              <div className="k-dialog ds-lib-rev">
                <p className="ds-lib-proj"><Avatar ini="J" tone="green" size="sm" />Alligators — junioři</p>
                <p className="k-dialog-t">Update from {GATOR_SYS}? 3 changes</p>
                <div className="ds-lib-ch">
                  <span className="ds-lib-c"><span className="ds-lib-cpic"><GButton>ZAPIŠ SE</GButton><Icon name="submenu" size={10} /><GButton nw>ZAPIŠ SE</GButton></span><span><b>Tlačítko</b> corners 2 → 6 · 8 canvases here</span></span>
                  <span className="ds-lib-c"><span className="ds-lib-cpic"><span className="ds-rev-chip ds-c--g-line1" /><Icon name="submenu" size={10} /><span className="ds-rev-chip ds-c--g-line2" /></span><span><b>Linka — jemná</b> moved to the trash · uses switch to Linka — střední</span></span>
                  <span className="ds-lib-c"><span className="ds-lib-cpic"><span className="ds-lib-new">New</span><span className="ds-rev-chip ds-c--g-ok" /></span><span><b>Výhra</b> added to Status</span></span>
                </div>
                <p className="ds-rev-fine">By Tereza, yesterday. The next step lists every canvas here with a tick. Updating keeps a version — Version history can restore it.</p>
                <div className="k-dialog-a"><span className="btn">Cancel</span><span className="btn btn--primary">Update</span></div>
              </div>
            </div>
          </Closeup>
        </DCArtboard>

        <DCArtboard id="ds-many-linked" label="20 · A project that links a team library" width={W} height={H} fixed>
          <Stage note={<Note n={20} title="Linked means read here, edited at home.">Alligators — junioři pins the same “Design system” row, but its canvas is view only. One action takes you to Alligators brand, where it's edited.</Note>}>
            <Window tabs={[TABS.studio, TABS.alligators, JUNIOR]} activeTab={2}>
              <Canvas><Board sys="gator" z={0.42} x={300} y={104} /></Canvas>
              <ProjectPill project="Alligators — junioři" canvas="Design system" />
              <CanvasesPanel advanced project="Alligators — junioři" count={JUNIOR_ITEMS.length} items={JUNIOR_ITEMS} system={sysRow(`${GATOR_SYS} · linked library`, true)} />
              <ShareCluster people={["jonas"]} mode="viewing" canEdit={false} access="Can view" />
              <Banner icon="cloud" action="Open in Alligators brand" sub="View only here — every update arrives as a review.">Linked from Alligators brand.</Banner>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 6b · Several systems in one project ─────────────────────────────────────────────────── */}
      <DCSection id="multi" title="Several systems in one project" subtitle="Each canvas uses one system; a project can hold several — the club's system and a campaign's — each on its own Design system canvas. Systems that follow the Maude schema switch with one review and nothing to map; an older one is brought up to the schema by AI once. One is the default for new canvases; a system nothing uses is a draft">
        <DCArtboard id="ds-multi-panel" label="21 · Two systems in use, pinned together" width={W} height={H} fixed>
          <Stage note={<Note n={21} title="Every system the project uses sits on top.">Alligators brand uses its club system on 87 canvases and Combine 2026 on the 6 in 2026/combine. Select anything — the inspector names the system that canvas uses.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Combine-kampan · A4" kind="print" x={300} y={104} w={300} h={424}><div className="ds-camp"><GPoster sel /></div></Artboard>
                <Artboard label="Post 1:1" kind="digital" x={636} y={104} w={300} h={300}><div className="ds-camp"><GPost /></div></Artboard>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <MultiPanel selected="Combine-kampan" schemaOld="camp" />
              <ShareCluster people={["tereza"]} mode="edit" />
              <Insp title="Tlačítko kampaň" kind="Instance" advCount="Instance of Tlačítko kampaň">
                <Row k="Variant"><span className="k-fill">Plné</span></Row>
                <Row k="Fill"><span className="k-fill"><span className="k-fill-sw ds-c--camp" />Oranžová</span></Row>
                <Uses name={CAMP_SYS} />
                <Line tone="quiet" icon="folder">Same as the rest of 2026/combine.</Line>
              </Insp>
              <ZoomUndo zoom={50} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-multi-schema" label="22 · A system made before the schema — AI brings it up first" width={W} height={H} fixed>
          <Stage note={<Note n={22} title="Old systems are brought up once, by AI.">Opens from the amber dot on its row, or when a switch to or from it starts. AI fills the missing roles from its own colours and type — one review, one undo step.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Combine-kampan · A4" kind="print" x={300} y={104} w={300} h={424}><div className="ds-camp"><GPoster /></div></Artboard>
                <Artboard label="Post 1:1" kind="digital" x={636} y={104} w={300} h={300}><div className="ds-camp"><GPost /></div></Artboard>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <MultiPanel selected="Combine-kampan" schemaOld="camp" />
              <ShareCluster people={["tereza"]} mode="edit" />
              <ZoomUndo zoom={50} />
              <Toolbar />
              <Veil />
              <Dialog title={<>Bring {CAMP_SYS} up to the schema?</>} primary="✦ Bring it up" width={600}>
                <p>{CAMP_SYS} was made before the schema. Until it does, canvases can't switch to or from it cleanly.</p>
                <div className="ds-sch">
                  {SCHEMA_FIX.map(([t, d]) => <span key={t} className="ds-sch-r"><Spark size={12} color="var(--accent-text)" /><b>{t}</b><span>{d}</span></span>)}
                </div>
                <p className="ds-rev-fine">Nothing on the 6 canvases changes how it looks. Uses your Claude account. Design system › Advanced › Map by hand… if you'd rather choose each one.</p>
              </Dialog>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-multi-switch" label="23 · Then move a folder to another system — one review, nothing to map" width={W} height={H} fixed>
          <Stage note={<Note n={23} title="Switching is one review — nothing to map.">Both systems follow the schema now, so nothing needs matching. AI restyles Combine 2026's own tokens; with it off, they keep their look, marked off-system.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Combine-kampan · A4" kind="print" x={300} y={104} w={300} h={424}><GPoster /></Artboard>
                <Artboard label="Post 1:1" kind="digital" x={636} y={104} w={300} h={300}><GPost /></Artboard>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <MultiPanel selected="Combine-kampan" />
              <ShareCluster people={["tereza"]} mode="edit" />
              <ZoomUndo zoom={50} />
              <Toolbar />
              <Banner icon="view" sub="5 canvases shown in it">Previewing 2026/combine in {GATOR_SYS}.</Banner>
              <Veil />
              <Dialog title={<>Switch canvases to {GATOR_SYS}?</>} primary="Switch 5 canvases" width={600}>
                <div className="ds-mt-scope"><span>Scope</span><InSeg options={["This canvas", "Folder · 2026/combine", "Whole project"]} value="Folder · 2026/combine" /></div>
                <div className="ds-mt">
                  <span className="ds-mt-h"><Tick on="mixed" />5 of 6 canvases in 2026/combine</span>
                  {MULTI_SWITCH.map(([n, art, sub, on]) => (
                    <span key={n} className="ds-mt-r" data-off={on ? undefined : "true"}>
                      <Tick on={on} /><Thumb art={art} w={44} h={32} /><span className="ds-mt-n"><b>{n}</b><em>{sub}</em></span>
                    </span>
                  ))}
                </div>
                <Line tone="ok" icon="done">Both follow the schema — core roles and components swap; the display ramp and illustration palette pair by kind.</Line>
                <span className="ds-mt-ai"><Spark size={14} color="var(--accent-text)" /><span><b>AI restyles Combine 2026's 4 own tokens</b><em>Camo pattern, scute height, stripe width, number outline · plus 12 colours picked by hand outside the system · your Claude account · one undo step</em></span><InSwitch on /></span>
                <p className="ds-rev-fine">Version history keeps the old look.</p>
              </Dialog>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-multi-menu" label="24 · A system's own menu — default for new canvases" width={W} height={H} fixed>
          <Stage note={<Note n={24} title="One default; new canvases follow their folder.">⌘N uses the default — inside a folder whose canvases all use one system, that one. A mixed folder falls back to the default.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas>
                <Artboard label="Combine-kampan · A4" kind="print" x={660} y={104} w={300} h={424}><div className="ds-camp"><GPoster /></div></Artboard>
              </Canvas>
              <ProjectPill project="Alligators brand" canvas="Combine-kampan" />
              <MultiPanel menuOn="camp" />
              <Menu style={{ left: 252, top: 300 }} width={340} items={[
                { label: `Open ${CAMP_SYS}`, keys: "↵" },
                { label: "Use for new canvases", highlight: true, note: `now ${GATOR_SYS}` },
                { label: "Switch canvases to another system…" },
                { label: "Rename…" },
              ]} />
              <ShareCluster people={["tereza"]} mode="edit" />
              <ZoomUndo zoom={50} />
              <Toolbar />
              <PanelIcon icon="spark" at="ai" />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-multi-migrate" label="25 · Three old system folders — two canvases and a draft" width={W} height={H} fixed>
          <Stage note={<Note n={25} title="Every folder in use becomes its own canvas.">Today a project can carry several system/ folders. Each folder that canvases use becomes its own Design system canvas; one nothing uses becomes a draft. Nothing is thrown away.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Board sys="gator" z={0.42} x={300} y={104} /></Canvas>
              <BoardChrome project="gator" zoom={42} people={["tereza", "jonas"]} left={<MultiPanel ds="gator" />} />
              <Veil strong />
              <Dialog title="Convert 3 system folders?" primary="Convert" width={640}>
                <p>2 become Design system canvases. Alligators 2023 becomes a draft — listed with the systems, used by no canvas. The files stay exactly where they are.</p>
                <div className="ds-mm">
                  {MULTI_MIGRATE.map(([n, from, use, to]) => (
                    <span key={n} className="ds-mm-r"><b>{n}</b><span>{from}<em>{use}</em></span><span className="chip ds-mm-to">{to}</span></span>
                  ))}
                </div>
                <p className="ds-rev-fine">{GATOR_SYS} stays the default for new canvases. A converted system made before the schema shows an amber dot — Bring it up (22) lines it up. Version history keeps the folder view; Restore undoes the conversion.</p>
              </Dialog>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 7 · Edge cases ─────────────────────────────────────────────────────────────────── */}
      <DCSection id="edges" title="Edge cases" subtitle="A change that breaks contrast · a colour 40 canvases use goes to the trash · AI spots a hand-picked colour outside the system · an old-style folder becomes the Design system canvas">
        <DCArtboard id="ds-edge-contrast" label="26 · A change that breaks contrast on two surfaces" width={W} height={H} fixed>
          <Stage note={<Note n={26} title="A quiet warning, with the fix as the action.">Darker Terciární drops to 3.1:1 on Pole and Hover, which 3 canvases use. Nothing is blocked — Lighten to 4.5:1 fixes it in one step; Show walks the 3 canvases.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Board sys="gator" z={0.6} x={-40} y={110} o={{ sel: "Terciární", darkTertiary: true }} /></Canvas>
              <BoardChrome project="gator" zoom={60} people={["tereza", "jonas"]} left={<PanelIcon icon="panel-left" at="left" />}
                insp={
                  <Insp title="Terciární" kind="Colour" advCount="OKLCH">
                    <Row k="Editing"><InSeg options={["Light", "Dark"]} value="Dark" /></Row>
                    <Row k="Dark"><span className="k-fill"><span className="k-fill-sw ds-c--g-fg2-dark" />Šedozelená</span></Row>
                    <Picker c="g-fg2-dark" at={[38, 46]} hue={44} />
                    <Row k="Light"><span className="k-fill"><span className="k-fill-sw ds-c--g-fg2-dark ds-on-l" />Unchanged</span></Row>
                    <Row k="Role"><span className="ds-role">Text on green — hints</span></Row>
                    <Line tone="warn" icon="problem" action="Lighten to 4.5:1">3.1:1 on Pole and Hover</Line>
                    <Line tone="quiet" icon="layers" action="Show">Falls short in 3 canvases</Line>
                  </Insp>
                } />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-edge-trash" label="27 · A colour 40 canvases use, moved to the trash" width={W} height={H} fixed>
          <Stage note={<Note n={27} title="Moving a token to the trash never breaks a canvas.">Its 40 canvases switch to the closest colour still in the system. Restore from the Trash puts it back everywhere it was.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Board sys="gator" z={0.6} x={-40} y={110} o={{ sel: "Linka — jemná" }} /></Canvas>
              <BoardChrome project="gator" zoom={60} people={["tereza", "jonas"]} left={<PanelIcon icon="panel-left" at="left" />} />
              <Veil strong />
              <Dialog title="Move “Linka — jemná” to the trash?" primary="Move to trash" width={460}>
                <p>40 canvases use it. They switch to <b className="ds-strong">Linka — střední</b>, the closest line colour, so nothing breaks.</p>
                <p className="ds-trash-sw"><span className="ds-rev-chip ds-c--g-line1" />Linka — jemná<Icon name="submenu" size={12} /><span className="ds-rev-chip ds-c--g-line2" />Linka — střední</p>
                <p className="ds-rev-fine">Restore from the Trash puts it back in all 40.</p>
              </Dialog>
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-edge-suggest" label="28 · AI spots a hand-picked colour that isn't in the system" width={W} height={H} fixed>
          <Stage note={<Note n={28} title="Off-system colours get one quiet question.">You picked a blue by hand for the yearly badge. AI offers the closest system colour, or to add this one — the system grows from real work.</Note>}>
            <Window tabs={TABS2} activeTab={0}>
              <Canvas>
                <Artboard label="Pricing · Desktop" kind="web" x={300} y={110} w={640} h={400}><SPricing offBadge /></Artboard>
              </Canvas>
              <ProjectPill project="Studio site" canvas="Pricing" />
              <StudioPanel selected="Pricing" />
              <ShareCluster people={["tereza"]} mode="edit" />
              <Insp title="Badge" kind="Frame" advCount="5 properties" style={{ maxHeight: 280 }}>
                <Row k="Fill"><span className="k-fill"><span className="k-fill-sw ds-c--offblue" />Blue<span className="ds-off">off-system</span></span></Row>
                <Row k="Text"><span className="k-fill"><span className="k-fill-sw ds-c--onacc" />On accent</span></Row>
                <Uses name={STUDIO_SYS} />
              </Insp>
              <ZoomUndo zoom={44} />
              <Toolbar />
              <AIPanel chat="Pricing" advanced scope="Badge"
                messages={[]}
                question={{ text: <>The blue on “Save two months” was picked by hand and isn't in {STUDIO_SYS}. The closest is <b>Accent</b>.</>, primary: "Use Accent", secondary: "Add it to the system" }}
              />
            </Window>
          </Stage>
        </DCArtboard>

        <DCArtboard id="ds-edge-migrate" label="29 · One folder, up close — 42 pages fold into 7 sections" width={W} height={H} fixed>
          <Stage note={<Note n={29} title="One question, then nothing is thrown away.">42 pages fold into 7 sections; showcases stay as their own artboards. The files keep working for code, agents and Tereza's older Maude. Other system folders become their own Design system canvases (25); only one that no canvas uses becomes a draft.</Note>}>
            <Window tabs={TABS2} activeTab={1}>
              <Canvas><Board sys="gator" z={0.42} x={300} y={104} /></Canvas>
              <BoardChrome project="gator" zoom={42} people={["tereza", "jonas"]} />
              <Veil strong />
              <Dialog title="Convert system/alligators into its Design system canvas?" primary="Convert" width={620}>
                <p>42 specimen pages fold into 7 sections. The files stay exactly where they are.</p>
                <div className="ds-map">
                  {([
                    ["Brand", "logo · voice · iconography · mascot · graphics · signs font — plus the rules in SKILL.md", 6],
                    ["Colour", "accent · status · surfaces · text · themes side by side · opacity · marketing surfaces", 7],
                    ["Type", "type scale · marketing display", 2],
                    ["Space & shape", "spacing · radii · borders · elevation · grid", 5],
                    ["Motion", "motion", 1],
                    ["Components", "14 component pages · focus · selection · skeletons · empty state", 18],
                    ["Patterns", "marketing edges", 1],
                    ["Own artboards", "desktop showcase · desktop index — kept as they are", 2],
                  ] as const).map(([s, from, n]) => (
                    <span key={s} className="ds-map-r"><b>{s}</b><span>{from}</span><em>{n}</em></span>
                  ))}
                </div>
                <p className="ds-rev-fine">Version history keeps the folder view — Restore undoes the conversion.</p>
              </Dialog>
            </Window>
          </Stage>
        </DCArtboard>
      </DCSection>

      {/* ── 8 · Advanced ───────────────────────────────────────────────────────────────────── */}
      <DCSection id="advanced" title="Advanced — the files behind the Design system" subtitle="Tokens as CSS or JSON (both modes), the system/<ds>/ folder, which way changes flow, code handoff, the system's own version history, and Check the system">
        <DCArtboard id="ds-advanced" label="30 · Design system › Advanced — files, tokens, history, checks" width={W} height={940} fixed>
          <Closeup title="Design system › Advanced" sub="Nothing selected on the Design system canvas, the inspector shows the system. Advanced holds everything today's folder had — mono only here."
            note={<Note n={30} title="Today's folder, one fold down — written from the canvas.">For designers the canvas is the source; these files are generated from it and are the source for code and agents. A file changed outside the app comes back as a review.</Note>}>
            <div className="ds-adv-row">
              <div className="island island--pad k-insp ds-insp ds-adv-insp">
                <div className="k-insp-hd"><strong>{STUDIO_SYS}</strong><span className="chip">Design system</span></div>
                <Row k="Used by"><span className="ds-role">Studio site · 5 canvases</span></Row>
                <Row k="Modes"><span className="ds-role">Light · Dark</span></Row>
                <Row k="Check"><span className="btn btn--sm"><Icon name="done" size={12} />Check the system</span></Row>
                <div className="k-adv" data-open="true">
                  <span className="k-adv-btn"><span className="k-adv-ch"><Icon name="submenu" size={12} /></span>Advanced<span className="k-adv-count">Tokens · files</span></span>
                  <div className="ds-adv-body">
                    <span className="seg ds-adv-seg"><span className="k-seg-b" aria-pressed="true">CSS</span><span className="k-seg-b">JSON</span></span>
                    <pre className="ds-code k-mono">{`:root {
  --page: oklch(0.978 0.005 240);
  --ink: oklch(0.24 0.014 250);
  --accent: oklch(0.50 0.190 255);
  --link: oklch(0.50 0.170 238);
  --radius-m: 10px;
  --type-display: 35px;
  …  /* 94 more */
}
[data-theme="dark"] {
  --page: oklch(0.205 0.006 250);
  --accent: oklch(0.60 0.175 255);
  …  /* 20 more */
}`}</pre>
                    <p className="ds-adv-k">Files</p>
                    <div className="ds-tree k-mono">
                      <span><Icon name="folder" size={12} />system/studio-site/</span>
                      <span className="ds-tree-1"><Icon name="file" size={12} />colors_and_type.css · tokens.json</span>
                      <span className="ds-tree-1"><Icon name="file" size={12} />README.md · SKILL.md · CONTRACT.md <em>voice, rules</em></span>
                      <span className="ds-tree-1"><Icon name="folder" size={12} />preview/ <em>38 specimen pages</em></span>
                      <span className="ds-tree-1"><Icon name="folder" size={12} />assets/ <em>logo, icons, fonts</em></span>
                    </div>
                    <span className="ds-adv-acts"><span className="btn btn--sm"><Icon name="export" size={12} />Hand off tokens<Kbd>⇧⌘H</Kbd></span><span className="btn btn--sm btn--ghost">Reveal in Finder</span></span>
                  </div>
                </div>
              </div>

              <div className="ds-adv-col">
                <div className="island island--pad ds-flow">
                  <p className="island-title">Which way changes flow</p>
                  <span className="ds-flow-r"><span className="ds-flow-ic"><Icon name="system" size={14} /></span><span><b>Design system canvas</b> — where designers edit. It writes the files.</span></span>
                  <span className="ds-flow-r"><span className="ds-flow-ic"><Icon name="file" size={14} /></span><span><b>The files</b> — what code, Claude Code and other agents read.</span></span>
                  <span className="ds-flow-r"><span className="ds-flow-ic"><Icon name="sync" size={14} /></span><span><b>Changed outside the app</b> — comes back as a review: Keep or Undo. A clash keeps both until one is picked.</span></span>
                </div>
                <div className="island island--pad ds-hist">
                  <p className="island-title">Version history — {STUDIO_SYS} <span className="ds-hist-k">⌥⌘H</span></p>
                  {([["You", "Accent → Deeper azure · 4 canvases updated", "2 min ago", "you"], ["Claude Code", "Quiet and Corner M, kept from the file", "1 hour ago", "file"], ["AI", "Made the Design system from Direction A + B's serif", "6 Oct, 14:05", "ai"]] as const).map(([w, t, when, who]) => (
                    <span key={t} className="row-item ds-hist-r">
                      {who === "ai" ? <span className="ds-hist-ai"><Spark size={12} /></span> : who === "file" ? <span className="ds-hist-file"><Icon name="file" size={12} /></span> : <Avatar who={who} size="sm" />}
                      <span className="ds-hist-t"><b>{w}</b>{t}</span><em>{when}</em>
                    </span>
                  ))}
                  <span className="ds-hist-acts"><span className="btn btn--sm btn--ghost">Restore…</span></span>
                </div>
                <div className="island island--pad ds-check">
                  <p className="island-title">Check the system <span className="ds-hist-k">ran 1 min ago</span></p>
                  <span className="ds-chk"><span className="ds-chk-ic ds-chk-ic--ok"><Icon name="done" size={14} /></span><b>Contrast</b><span>41 of 42 text pairs pass 4.5:1, Light and Dark</span></span>
                  <span className="ds-chk"><span className="ds-chk-ic ds-chk-ic--warn"><Icon name="problem" size={14} /></span><b>Quiet on Well</b><span>Dark: 4.2:1 — large text only</span><span className="btn btn--sm btn--ghost">Show</span></span>
                  <span className="ds-chk"><span className="ds-chk-ic ds-chk-ic--ok"><Icon name="done" size={14} /></span><b>Complete</b><span>7 sections, both modes, reduced motion</span></span>
                  <span className="ds-chk"><span className="ds-chk-ic ds-chk-ic--ok"><Icon name="done" size={14} /></span><b>Schema</b><span>Follows the schema — switches cleanly with any system that does</span></span>
                  <span className="ds-chk ds-chk--adv"><span className="k-mono">critic panel: a11y · completeness · keeper</span></span>
                </div>
              </div>
            </div>
          </Closeup>
        </DCArtboard>
      </DCSection>

    </DesignCanvas>
  );
}

/* ─── Small content pieces used above ─── */

/** The FB event cover (Combine-kampan), built from the system. */
function GWebCover() {
  return (
    <div className="ds-gweb ds-gweb--cover">
      <span className="ds-gweb-hero"><GatorMark size={30} /><strong>COMBINE 1. 10.</strong><span>Brno · CESA VUT · 9:00</span></span>
    </div>
  );
}
/** The leták's back: paper, green text (green logo only on paper). */
function GBack() {
  return (
    <div className="ds-gback">
      <span className="ds-gback-mark"><GatorMark size={30} /></span>
      <strong>CO TĚ ČEKÁ</strong>
      <span>40 yard dash · bench press · vertical jump · broad jump · 3-cone drill</span>
      <span className="ds-gback-qr"><i /></span>
      <em>Přihláška přes QR kód</em>
    </div>
  );
}
/** Homepage previewed in the Warm paper system. */
function WarmHero({ small, phone }: { small?: boolean; phone?: boolean }) {
  return (
    <div className={`ds-warm${small ? " ds-warm--small" : ""}${phone ? " ds-warm--phone" : ""}`}>
      <span className="ds-warm-nav"><i />{phone ? null : <><b /><b /><b /></>}</span>
      <strong>Calm software, made in Brno.</strong>
      <span className="ds-warm-p">A small studio for product and brand.</span>
      <span className="ds-warm-btn">See the work</span>
      <span className="ds-warm-pic" />
    </div>
  );
}
