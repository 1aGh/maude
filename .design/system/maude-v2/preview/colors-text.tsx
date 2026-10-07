/**
 * SPECIMEN — colors-text · maude-v2
 *
 * DEMONSTRATES: --fg-0, --fg-1, --fg-2, --fg-3, plus the three inks that live OFF the
 *   chrome ladder: --object-ink (stickies), --accent-fg (on azure), --spark-fg (on the spark).
 * COMPOSITION: hero = the same slice of the app — canvas · island · popover — in light AND
 *   dark (each pane scoped with `.maude-v2[data-theme]`), with a "Show levels" control that
 *   tags every line with the fg step it uses. Then the ladder, a contrast table computed
 *   live in the browser from the resolved tokens (never hand-written), a pick-by-job
 *   right/wrong pair, and the off-chrome inks.
 * COPY VOICE: everyday labels about the user's work ("Homepage", "Hero image"), no hype.
 * WHEN SCAFFOLDED: always (Core).
 * NOTES: --fg-3 is for disabled text only. WCAG exempts disabled controls from contrast
 *   minimums, and that is the only reason it may sit under the body-text line.
 */
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import "./_layout.css";
import "./colors-text.css";
import { Spark, SpecimenHeader } from "./_specimen-controls";

const LEVELS = [
  { n: 0, role: "Primary", job: "Names, headings, the thing you came for.", sample: "Homepage" },
  { n: 1, role: "Secondary", job: "Descriptions and the second line of a row.", sample: "Hero, pricing and footer." },
  { n: 2, role: "Tertiary", job: "Meta, hints, placeholders, island titles.", sample: "Edited 2 min ago" },
  { n: 3, role: "Disabled", job: "Things you can't use right now. Nothing else.", sample: "Paste style" },
];

const SURFACES = [
  { key: "canvas", label: "Canvas", token: "--bg-0" },
  { key: "island", label: "Island", token: "--island-bg over canvas" },
  { key: "popover", label: "Popover", token: "--bg-2" },
  { key: "well", label: "Input well", token: "--bg-3" },
];

const PROBES = ["--fg-0", "--fg-1", "--fg-2", "--fg-3", "--bg-0", "--bg-2", "--bg-3", "--island-bg"];

/* ─── Live contrast: parse the browser's resolved colour, never a typed-in number ─── */
type RGBA = [number, number, number, number]; // gamma-encoded sRGB, 0..1

function num(s: string, pctScale = 1): number {
  const t = s.trim();
  if (t === "none" || t === "") return 0;
  return t.endsWith("%") ? (parseFloat(t) / 100) * pctScale : parseFloat(t);
}
const encode = (c: number) => {
  const x = Math.min(1, Math.max(0, c));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
};
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function parseColor(str: string): RGBA | null {
  const m = str.trim().match(/^([a-z]+)\((.*)\)$/i);
  if (!m) return null;
  const fn = m[1].toLowerCase();
  const [body, alphaPart] = m[2].split("/");
  const p = body.replace(/,/g, " ").trim().split(/\s+/);
  let a = alphaPart ? num(alphaPart) : 1;
  if (fn === "rgb" || fn === "rgba") {
    if (p.length === 4 && !alphaPart) a = num(p[3]);
    return [num(p[0], 255) / 255, num(p[1], 255) / 255, num(p[2], 255) / 255, a];
  }
  if (fn === "color" && p[0] === "srgb") return [num(p[1]), num(p[2]), num(p[3]), a];
  if (fn === "oklch") {
    const L = num(p[0]);
    const C = num(p[1], 0.4);
    const h = (num(p[2]) * Math.PI) / 180;
    const A = C * Math.cos(h);
    const B = C * Math.sin(h);
    const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
    const mm = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
    const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
    return [
      encode(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
      encode(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
      encode(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
      a,
    ];
  }
  return null;
}
const over = (top: RGBA, under: RGBA): RGBA => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1) as RGBA;
const lum = (c: RGBA) => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
const ratio = (a: RGBA, b: RGBA) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

function useResolvedTokens(root: RefObject<HTMLElement | null>) {
  const [state, setState] = useState<{ theme: string; c: Record<string, RGBA | null> }>({ theme: "light", c: {} });
  useEffect(() => {
    const read = () => {
      const el = root.current;
      if (!el) return;
      const c: Record<string, RGBA | null> = {};
      el.querySelectorAll<HTMLElement>("[data-probe]").forEach((p) => {
        c[p.dataset.probe ?? ""] = parseColor(getComputedStyle(p).color);
      });
      setState({ theme: document.documentElement.dataset.theme ?? "light", c });
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => mo.disconnect();
  }, [root]);
  return state;
}

/* ─── The hero slice — rendered once per theme ─────────────────────────────── */
function TextSlice({ theme }: { theme: "light" | "dark" }) {
  return (
    <div className="maude-v2 stage ct-slice" data-theme={theme}>
      <span className="ct-theme-tag">{theme === "light" ? "Light" : "Dark"}</span>

      <div className="ct-ab-label">
        <span data-fg="1">Homepage</span>
        <span data-fg="2">1440 × 900</span>
      </div>
      <div className="ct-artboard">
        <div className="ct-ab-img" />
        <div className="ct-ab-body">
          <strong data-fg="0">A calmer place to design</strong>
          <span data-fg="1">Hero, pricing and footer.</span>
        </div>
      </div>

      <div className="island island--pad ct-layers">
        <p className="island-title"><span data-fg="2">Layers</span></p>
        <div className="row-item" aria-current="true"><span data-fg="0">Hero image</span><span className="ct-trail" data-fg="2">Frame</span></div>
        <div className="row-item"><span data-fg="0">Headline</span><span className="ct-trail" data-fg="2">Text</span></div>
        <div className="row-item"><span data-fg="0">Pricing</span><span className="ct-trail" data-fg="2">Frame</span></div>
        <div className="row-item"><span data-fg="2">Old hero</span><span className="ct-trail" data-fg="2">Hidden</span></div>
      </div>

      <div className="ct-menu">
        <div className="ct-mi"><span data-fg="0">Duplicate</span><span className="ct-trail" data-fg="2">⌘D</span></div>
        <div className="ct-mi"><span data-fg="0">Copy</span><span className="ct-trail" data-fg="2">⌘C</span></div>
        <div className="ct-mi"><span data-fg="3">Paste style</span><span className="ct-trail" data-fg="3">⌥⌘V</span></div>
        <div className="ct-sep" />
        <div className="ct-mi"><Spark size={12} color="var(--spark)" /><span data-fg="0">Ask AI about this</span></div>
        <p className="ct-mi-hint"><span data-fg="2">Right-click anything on the canvas</span></p>
      </div>
    </div>
  );
}

export default function ColorsText() {
  const [reveal, setReveal] = useState(true);
  const tableRef = useRef<HTMLDivElement>(null);
  const { theme, c } = useResolvedTokens(tableRef);

  const surfaceColor = (key: string): RGBA | null => {
    const canvas = c["--bg-0"];
    if (key === "canvas") return canvas;
    if (key === "popover") return c["--bg-2"];
    if (key === "well") return c["--bg-3"];
    const isl = c["--island-bg"];
    return isl && canvas ? over(isl, canvas) : null;
  };

  return (
    <>
      <SpecimenHeader crumbs={["Colour", "Text"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Four steps of ink, one reading order.</h1>
          <p className="lede">
            The eye should land on the name of your work first, then what it is, then when it changed.
            Four greys carry that order on every surface — the canvas, the islands, the menus — and the
            faintest one is kept for things you can't use yet.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Steps</dt><dd>--fg-0 … --fg-3</dd></div>
          <div><dt>Hue</dt><dd>250, a cool ink — not pure grey</dd></div>
          <div><dt>Light primary</dt><dd>oklch 0.24 0.014 250</dd></div>
          <div><dt>Dark primary</dt><dd>oklch 0.965 0.004 250</dd></div>
        </dl>

        {/* ── Hero: the ladder in the app, both themes ───────────────────── */}
        <h2 data-no>
          On every surface
          <span className="h2-aside">canvas · island · popover — the same slice, light and dark</span>
        </h2>
        <div className="ct-hero-bar">
          <p>Each line is tagged with the step it uses. Turn the tags off to read it the way people will.</p>
          <span className="seg" role="group" aria-label="Level tags">
            <button type="button" aria-pressed={reveal} onClick={() => setReveal(true)}>Show levels</button>
            <button type="button" aria-pressed={!reveal} onClick={() => setReveal(false)}>Plain</button>
          </span>
        </div>
        <div className={`ct-hero${reveal ? " ct-reveal" : ""}`}>
          <TextSlice theme="light" />
          <TextSlice theme="dark" />
        </div>

        {/* ── Ladder ─────────────────────────────────────────────────────── */}
        <h2 data-no>The ladder<span className="h2-aside">pick by job, not by how grey it looks</span></h2>
        <div className="ct-ladder">
          {LEVELS.map((l) => (
            <div className="ct-step" key={l.n}>
              <span className={`ct-aa ct-fg${l.n}`} aria-hidden="true">Aa</span>
              <div className="ct-step-body">
                <strong>--fg-{l.n} · {l.role}</strong>
                <span className={`ct-step-sample ct-fg${l.n}`}>{l.sample}</span>
                <span className="ct-step-job">{l.job}</span>
              </div>
              <span className={`ct-bar ct-bar${l.n}`} aria-hidden="true" />
            </div>
          ))}
        </div>

        {/* ── Contrast, computed ─────────────────────────────────────────── */}
        <h2 data-no>Contrast, computed<span className="h2-aside">measured in your browser · {theme} theme</span></h2>
        <p>
          These numbers are worked out from the colours the browser actually resolved, so they follow
          the theme switch at the top. The island is measured over a plain canvas.
        </p>
        <div className="ct-table-wrap" ref={tableRef}>
          <div hidden>
            {PROBES.map((t) => <span key={t} data-probe={t} style={{ color: `var(${t})` }} />)}
          </div>
          <table className="ct-table">
            <thead>
              <tr>
                <th scope="col">Ink</th>
                {SURFACES.map((s) => (
                  <th scope="col" key={s.key}>{s.label}<span>{s.token}</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LEVELS.map((l) => (
                <tr key={l.n}>
                  <th scope="row"><span className={`ct-dot ct-bar${l.n}`} />--fg-{l.n}</th>
                  {SURFACES.map((s) => {
                    const fg = c[`--fg-${l.n}`];
                    const bg = surfaceColor(s.key);
                    const r = fg && bg ? ratio(fg, bg) : null;
                    const verdict = r === null ? "—" : l.n === 3 ? "disabled only" : r >= 4.5 ? "body text" : r >= 3 ? "large text" : "too faint";
                    const tone = r === null || l.n === 3 ? "na" : r >= 4.5 ? "ok" : r >= 3 ? "warn" : "bad";
                    return (
                      <td key={s.key} className={`ct-cell ct-${tone}`}>
                        <strong>{r === null ? "—" : r.toFixed(1)}</strong>
                        <span><i aria-hidden="true" />{verdict}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ct-note">
          Where a cell reads “large text”, keep that pair to short meta or bigger type, and raise it with the
          accessibility pass rather than nudging the token by eye.
        </p>

        {/* ── Right / wrong ──────────────────────────────────────────────── */}
        <h2 data-no>Pick by job</h2>
        <div className="ct-compare">
          <figure className="ct-case">
            <div className="island island--pad ct-share">
              <strong className="ct-fg0">Share “Homepage”</strong>
              <span className="ct-fg1">Anyone with the link can view and comment.</span>
              <span className="ct-fg2">Tereza and Jonas already have access</span>
              <button className="btn btn--primary btn--sm" type="button">Copy link</button>
            </div>
            <figcaption><strong className="ct-ok-t">Right</strong> Name in fg-0, what it does in fg-1, who already has it in fg-2.</figcaption>
          </figure>
          <figure className="ct-case">
            <div className="island island--pad ct-share">
              <strong className="ct-fg2">Share “Homepage”</strong>
              <span className="ct-fg0">Anyone with the link can view and comment.</span>
              <span className="ct-fg3">Tereza and Jonas already have access</span>
              <button className="btn btn--primary btn--sm" type="button">Copy link</button>
            </div>
            <figcaption><strong className="ct-bad-t">Wrong</strong> The title fades back, the sentence shouts, and real information wears the disabled grey.</figcaption>
          </figure>
        </div>

        {/* ── Off-chrome inks ────────────────────────────────────────────── */}
        <h2 data-no>Ink that isn't grey<span className="h2-aside">fixed pairs · colour as text has its own token</span></h2>
        <div className="ct-inks">
          <div className="sticky sticky--yellow ct-ink-sticky">Bigger photo in the hero?<code>--object-ink</code></div>
          <div className="ct-ink-pair">
            <button className="btn btn--primary" type="button">Share</button>
            <span><strong>--accent-fg</strong> on azure. White in both themes.</span>
          </div>
          <div className="ct-ink-pair">
            <button className="btn btn--spark" type="button"><Spark size={12} color="var(--spark-fg)" /> Ask AI</button>
            <span><strong>--spark-fg</strong> on the spark. A dark warm ink in both themes, so the spark stays bright.</span>
          </div>
          <div className="ct-ink-pair">
            <span className="ct-ink-chips">
              <span className="chip chip--accent">Selected</span>
              <span className="chip chip--spark"><Spark size={10} color="currentColor" /> Made by AI</span>
            </span>
            <span><strong>--accent-text</strong> and <strong>--spark-text</strong> when azure or the spark is the text itself.</span>
          </div>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · text colours</span>
        <span>Contrast figures are computed on the page, never typed in</span>
      </footer>
    </>
  );
}
