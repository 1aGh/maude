/**
 * SPECIMEN — logo · maude-v2
 *
 * DEMONSTRATES: the maude mark (the spark on a message-bubble tile, bottom-right corner
 *   squared) in its canonical contexts — light and dark islands, the project pill that
 *   opens the one menu, the tucked state, favicon / app-icon sizes — plus the bare spark
 *   as the AI glyph, the wordmark lockup, construction, clear space, minimum size and
 *   the don'ts. Tokens: --accent (tile) · --accent-fg (star) · --spark (the AI glyph
 *   only) · --font-display (the word "maude") · .island · .row-item · .kbd.
 * COMPOSITION: hero = the mark on a light and a dark island (each a scoped
 *   .maude-v2[data-theme] pane, so both themes show at once whatever the page theme) ·
 *   the mark at work in the project pill + its open menu, and folded to the mark alone ·
 *   mark vs spark, with the two star cuts overlaid · the lockup at four sizes · a size
 *   ladder with the browser tab and the Dock · construction + clear space + minimum ·
 *   six don'ts.
 * COPY VOICE: tiny everyday labels ("In the Dock", "Project pill") — no SKU eyebrows.
 * SOURCE OF TRUTH: system/maude-v2/assets/logos/ — mark.svg (a verbatim copy of the v1 mark),
 *   spark.svg (the mark's star scaled exactly 26/22), favicon.svg (azure tile, white star),
 *   wordmark.svg. v1's system/maude/assets/logos/ is history, not the source.
 * V2 MIGRATION NOTES (the last section renders them): outline the wordmark; ship the macOS 26
 *   app icon as the mark on a plate (Icon Composer); re-tint every hardcoded indigo raster and
 *   favicon in one commit.
 *
 * PLACEHOLDER POLICY: nothing here is a placeholder. Every mark is <Mark /> from
 *   ./_specimen-controls — the paths lifted verbatim from assets/logos/mark.svg, never
 *   redrawn. The bare spark is <Spark /> — the same path as assets/logos/spark.svg.
 *   wordmark.svg still sets the word as a live <text> in Inter Tight; until the outlined v2
 *   wordmark ships, the lockup is composed as <Mark /> + "maude" in var(--font-display).
 * RELATIVE-URL SAFETY: no <img>, no url() to a file — all SVG is inline. The one
 *   gradient (a don't) gets its id from useId().
 */
import { useId } from "react";
import type { ReactNode } from "react";
import "./_layout.css";
import "./logo.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

/* ─── Icons — copied verbatim from iconography.tsx GLYPHS (16-unit grid, 1.5 rounded stroke) ── */
const PATHS: Record<string, ReactNode> = {
  home: <path d="M2.5 7.25L8 2.75l5.5 4.5v5.25a1 1 0 0 1-1 1h-2.75V10h-3.5v3.5H3.5a1 1 0 0 1-1-1z" />,
  file: (<><path d="M4 2.5h5.25l2.75 2.75v8.25H4z" /><path d="M9 2.5v3h3" /></>),
  edit: (<><path d="M9.5 3.5l2 2L6 11l-2.75.75L4 9z" /><path d="M3 13.5h10" /></>),
  view: (<><path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z" /><circle cx="8" cy="8" r="1.75" /></>),
  help: (<><circle cx="8" cy="8" r="5.75" /><path d="M6.4 6.4a1.7 1.7 0 0 1 3.2.6c0 1.2-1.6 1.4-1.6 2.5M8 11.4h.01" /></>),
  export: (<><path d="M8 2.5V10M5.25 7.25L8 10l2.75-2.75" /><path d="M2.75 10.5V12a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-1.5" /></>),
  submenu: <path d="M6 4.5l3.5 3.5L6 11.5" />,
  history: <path d="M2.75 8A5.25 5.25 0 1 0 4.3 4.3M4.3 1.8v2.5h2.5M8 5.25V8l2 1.5" />,
  share: (
    <>
      <path d="M8 9.5v-7M5.25 5.25L8 2.5l2.75 2.75" />
      <path d="M5 7.5h-.5A1.5 1.5 0 0 0 3 9v3a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12V9a1.5 1.5 0 0 0-1.5-1.5H11" />
    </>
  ),
  settings: (
    <>
      <path d="M2.5 5h4.5M10 5h3.5M2.5 11h1.5M7 11h6.5" />
      <circle cx="8.5" cy="5" r="1.5" />
      <circle cx="5.5" cy="11" r="1.5" />
    </>
  ),
  chevron: <path d="M5 6.5l3 3 3-3" />,
  check: <path d="M3.5 8.5l3 3 6-7" />,
  pulse: <path d="M1.75 8.5h2.5l1.5-4 2.5 7.5 1.75-5.5 1 2h3.25" />,
  x: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
};

function Ico({ id, size = 16 }: { id: string; size?: number }) {
  return (
    <svg className="lg-ico" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[id]}
    </svg>
  );
}

/** The lockup: <Mark /> + "maude" in --font-display. Mark = 1.4 × the type size. */
function Lockup({ type, mark }: { type: string; mark: number }) {
  return (
    <span className="lg-lockup" style={{ fontSize: `var(${type})`, gap: Math.round(mark * 0.3) }}>
      <Mark size={mark} title="maude" />
      <span className="lg-word" aria-hidden="true">maude</span>
    </span>
  );
}

function Pane({ theme }: { theme: "light" | "dark" }) {
  return (
    <div className="maude-v2 stage lg-pane" data-theme={theme}>
      <span className="chip lg-pane-tag">{theme === "light" ? "Light" : "Dark"}</span>
      <div className="island lg-pane-isle">
        <Mark size={120} />
      </div>
      <div className="lg-pane-foot">
        <Lockup type="--type-xl" mark={34} />
        <div className="island lg-pane-pill">
          <Mark size={22} />
          <span>Studio site</span>
          <span className="lg-caret"><Ico id="chevron" size={14} /></span>
        </div>
      </div>
    </div>
  );
}

const SIZES = [
  { px: 16, where: "Browser tab", note: "favicon · the floor" },
  { px: 22, where: "Project pill", note: "in every window" },
  { px: 32, where: "Menus & dialogs", note: "About, update notes" },
  { px: 64, where: "In the Dock", note: "app icon" },
  { px: 128, where: "Finder & About", note: "app icon, large" },
];

const LOCKUPS = [
  { type: "--type-base", label: "14", mark: 20 },
  { type: "--type-lg", label: "20", mark: 28 },
  { type: "--type-2xl", label: "29", mark: 40 },
  { type: "--type-3xl", label: "35", mark: 48 },
];

/** The one menu's top level — CONTRACT §1, in order. Glyphs from the iconography family. */
type MenuRow = { label: string; icon: string; keys?: string; sub?: boolean } | "sep";
const MENU: MenuRow[] = [
  { label: "Back to Home", icon: "home" }, "sep",
  { label: "File", icon: "file", sub: true }, { label: "Edit", icon: "edit", sub: true },
  { label: "View", icon: "view", sub: true }, { label: "Help", icon: "help", sub: true }, "sep",
  { label: "Version history", icon: "history", keys: "⌥⌘H" }, { label: "Share…", icon: "share" },
  { label: "Export…", icon: "export", keys: "⇧⌘E" }, "sep",
  { label: "Diagnostics", icon: "pulse", sub: true }, { label: "Settings…", icon: "settings", keys: "⌘," },
];

const NOTES: { t: string; d: ReactNode }[] = [
  {
    t: "The spark has its own file",
    d: <>assets/logos/spark.svg is the mark's star scaled exactly 26/22 about the centre — same path family, same waist. Every AI glyph lifts it; nobody redraws the spark again.</>,
  },
  {
    t: "Outline the wordmark",
    d: <>wordmark.svg still sets “maude” as live Inter Tight text, so the word changes with the platform. v2 ships the word as outlined paths in currentColor; the build rule (mark 1.4 × type, gap 0.3 × mark, lowercase, semibold) stays.</>,
  },
  {
    t: "App icon on a macOS 26 plate",
    d: <>macOS 26 fits every app icon to its own rounded plate, and a full-bleed tile gets masked — the square tail is lost. The v2 app icon is the lifted mark centred on a light plate in the system template, made in Icon Composer. The plate is allowed in the OS icon slot only.</>,
  },
  {
    t: "Re-tint the rasters in one go",
    d: <>The Studio favicon data-URI, the maude.sh icon and the desktop icon set are still indigo. Regenerate them from the azure master in the same commit, so the Dock and the app never show two brand colours.</>,
  },
  {
    t: "One source",
    d: <>system/maude-v2/assets/logos is the brand's source of truth — mark.svg verbatim from v1, favicon.svg re-tinted to the accent, spark.svg new.</>,
  },
];

export default function Logo() {
  const rawId = useId();
  const gradId = `lg-grad-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const DONTS: { el: ReactNode; title: string; why: string }[] = [
    { el: <Mark size={64} tile="var(--spark)" />, title: "Don't paint it the AI's colour", why: "The spark colour belongs to the AI. The tile stays azure." },
    { el: <Mark size={64} tile="var(--object-lilac)" star="var(--object-ink)" />, title: "Don't borrow canvas colours", why: "Sticky and shape colours live on the canvas, never on the mark." },
    { el: <span className="lg-stretch"><Mark size={64} /></span>, title: "Don't stretch or squash", why: "Scale it evenly, or not at all." },
    { el: <span className="lg-rotate"><Mark size={64} /></span>, title: "Don't rotate it", why: "The square corner is the bubble's tail. It stays bottom-right." },
    { el: <span className="lg-glow"><Mark size={64} tile={`url(#${gradId})`} /></span>, title: "No gradients, no glow", why: "One flat accent tile. Depth comes from the island, not the mark." },
    {
      el: (
        <span className="lg-sku">
          <Mark size={40} />
          <span className="lg-sku-txt"><span>MAUDE/LOGO · 01</span><span>MDCC-DSN</span></span>
        </span>
      ),
      title: "No part numbers beside it",
      why: "The mark speaks for itself. Codes and slugs stay in Advanced.",
    },
  ];

  return (
    <>
      {/* Gradient for the "no gradients" don't — referenced by id, never by file. */}
      <svg width="0" height="0" className="lg-defs" aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--spark)" />
          </linearGradient>
        </defs>
      </svg>

      <SpecimenHeader crumbs={["Brand & voice", "Logo"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>One mark: the spark on a speech tile.</h1>
          <p className="lede">
            The star is the spark the AI carries; the tile is a message bubble with its tail at the bottom-right
            corner, so the mark reads as a conversation about your work. It is lifted from the asset, never redrawn, and
            takes the accent — it re-tints with the theme on its own.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Source</dt><dd>maude-v2/assets/logos</dd></div>
          <div><dt>Tile</dt><dd>--accent</dd></div>
          <div><dt>Star</dt><dd>--accent-fg</dd></div>
          <div><dt>Grid</dt><dd>32 × 32 · corner radius 7</dd></div>
          <div><dt>Smallest</dt><dd>16 px</dd></div>
          <div><dt>Word</dt><dd>“maude”, lowercase, --font-display</dd></div>
        </dl>

        {/* ── Hero: both themes at once ──────────────────────────────────── */}
        <h2 data-no>Light and dark<span className="h2-aside">same mark, same file — the tokens do the rest</span></h2>
        <div className="lg-hero">
          <Pane theme="light" />
          <Pane theme="dark" />
        </div>

        {/* ── In the app ─────────────────────────────────────────────────── */}
        <h2 data-no>In the app<span className="h2-aside">the mark and the project name open the one menu</span></h2>
        <div className="lg-app">
          <figure className="lg-fig">
            <div
              className="stage lg-app-stage"
              role="img"
              aria-label="The project pill, open: the one menu — Back to Home, File, Edit, View, Help, Version history, Share, Export, Diagnostics and Settings."
            >
              <div className="island lg-app-pill">
                <span aria-hidden="true"><Mark size={22} title="" /></span>
                <span>Studio site</span>
                <span className="lg-caret"><Ico id="chevron" size={14} /></span>
              </div>
              <div className="island island--pad lg-menu">
                {MENU.map((m, i) =>
                  m === "sep" ? (
                    <span className="lg-menu-div" key={i} />
                  ) : (
                    <div className={`row-item${m.label === "Diagnostics" ? " lg-menu-quiet" : ""}`} key={m.label}>
                      <Ico id={m.icon} /> {m.label}
                      {m.keys ? <span className="lg-menu-end lg-menu-keys">{m.keys}</span> : null}
                      {m.sub ? <span className="lg-menu-end"><Ico id="submenu" size={12} /></span> : null}
                    </div>
                  ),
                )}
              </div>
              <div className="lg-board">
                <div className="lg-board-img" />
                <div className="lg-board-body"><strong>Homepage</strong><span>Hero, pricing and footer.</span></div>
              </div>
              <div className="sticky sticky--yellow lg-st">Bigger photo in the hero?</div>
            </div>
            <figcaption><strong>Project pill, open.</strong> Everything that used to be chrome lives in this one menu — down to Diagnostics, for the people who need it.</figcaption>
          </figure>
          <figure className="lg-fig">
            <div className="stage lg-app-stage">
              <div className="island lg-tucked">
                <button className="icon-btn lg-tucked-btn" type="button" aria-label="Project menu" aria-haspopup="menu"><span aria-hidden="true"><Mark size={22} title="" /></span></button>
              </div>
              <div className="lg-board lg-board--wide" aria-hidden="true">
                <div className="lg-board-img" />
                <div className="lg-board-body"><strong>Homepage</strong><span>Hero, pricing and footer.</span></div>
              </div>
              <div className="island lg-toast" role="status">Panels hidden. Press <span className="kbd">⌘\</span> to bring them back.</div>
            </div>
            <figcaption><strong>Panels hidden.</strong> The pill shrinks to the mark alone, and it still opens the same menu.</figcaption>
          </figure>
        </div>

        {/* ── Mark vs spark ──────────────────────────────────────────────── */}
        <h2 data-no>The mark and the spark<span className="h2-aside">maude itself vs the AI at work</span></h2>
        <div className="lg-pair">
          <div className="lg-pair-card">
            <div className="lg-pair-hero"><Mark size={72} /></div>
            <div className="lg-pair-txt">
              <strong>The mark — who</strong>
              <span>Tile and star together, in azure. It stands for the app and your project: the project pill, the Dock, the browser tab, About.</span>
            </div>
            <div className="lg-pair-uses">
              <span className="island lg-use-pill"><Mark size={18} /> Studio site</span>
              <span className="lg-use-tab"><Mark size={16} /> maude.sh</span>
            </div>
          </div>
          <div className="lg-pair-card">
            <div className="lg-pair-hero"><Spark size={72} color="var(--spark)" /></div>
            <div className="lg-pair-txt">
              <strong>The spark — what the AI does</strong>
              <span>The star alone, no tile, in the spark colour. It appears only where the AI speaks or acts.</span>
            </div>
            <div className="lg-pair-uses">
              <span className="ask lg-use-ask"><span className="lg-use-ph">Ask AI…</span><span className="send" aria-hidden="true"><Spark size={12} color="var(--spark-fg)" /></span></span>
              <span className="chip chip--spark"><Spark size={10} color="var(--spark)" /> Made by AI</span>
              <span className="lg-use-cursor"><Spark size={10} color="var(--spark-fg)" /> AI is sketching…</span>
            </div>
          </div>
          <figure className="lg-cut">
            <div className="lg-cut-stack" aria-hidden="true">
              <span className="lg-cut-spark"><Spark size={176} color="var(--spark)" /></span>
              <span className="lg-cut-mark"><Mark size={176} tile="transparent" star="var(--fg-0)" title="" /></span>
            </div>
            <figcaption>
              <strong>One star, two scales.</strong> spark.svg is the mark's star scaled exactly 26/22: its points reach 3 → 29
              on the 32 grid where the mark's stop at 5 → 27 to leave the tile a margin. Same proportions, so the AI's glyph and
              the logo are one shape. Shown with the mark's tile hidden, for comparison only.
            </figcaption>
          </figure>
        </div>

        {/* ── Wordmark ───────────────────────────────────────────────────── */}
        <h2 data-no>Wordmark<span className="h2-aside">the mark + “maude” in the display face</span></h2>
        <div className="lg-words">
          {LOCKUPS.map((l) => (
            <div className="lg-word-row" key={l.type}>
              <Lockup type={l.type} mark={l.mark} />
              <span className="lg-word-meta">{l.type} · {l.label} px type · {l.mark} px mark</span>
            </div>
          ))}
          <p className="lg-word-note">
            For now the lockup is composed: <code>&lt;Mark /&gt;</code> plus the word in <code>--font-display</code>. The mark is
            1.4 × the type size, the gap 0.3 × the mark, the word always lowercase and semibold. The outlined v2 wordmark
            replaces the live word — see the migration notes below.
          </p>
        </div>

        {/* ── Sizes ──────────────────────────────────────────────────────── */}
        <h2 data-no>Sizes<span className="h2-aside">from the browser tab to the About window</span></h2>
        <div className="lg-sizes">
          {SIZES.map((s) => (
            <div className="lg-size" key={s.px}>
              <div className="lg-size-box"><Mark size={s.px} /></div>
              <div className="lg-size-meta"><strong>{s.px} px</strong><span>{s.where}</span><span className="lg-dim">{s.note}</span></div>
            </div>
          ))}
        </div>
        <div className="lg-contexts">
          <figure className="lg-fig">
            <div className="lg-browser">
              <div className="lg-tab lg-tab--on"><Mark size={16} /> <span>Docs — maude.sh</span></div>
              <div className="lg-tab"><span className="lg-tab-blank" /> <span>Homepage review</span></div>
            </div>
            <figcaption><strong>Browser tab.</strong> 16 px is the floor — one bold shape still reads as the star on its tile.</figcaption>
          </figure>
          <figure className="lg-fig">
            <div className="stage lg-dock-stage">
              <div className="island lg-mac-dock">
                <span className="lg-dock-app lg-dock-app--today"><Mark size={56} title="Today: the full-bleed tile" /><span className="lg-dock-dot" /></span>
                <span className="lg-dock-app"><span className="lg-plate" role="img" aria-label="v2: the mark on a macOS 26 plate"><span aria-hidden="true"><Mark size={40} title="" /></span></span><span className="lg-dock-dot" /></span>
              </div>
            </div>
            <figcaption><strong>In the Dock.</strong> Left, today's full-bleed tile. Right, the v2 app icon: the same mark on a light plate in the macOS 26 template, so the system never masks the square tail. No badge.</figcaption>
          </figure>
        </div>

        {/* ── Construction + clear space ─────────────────────────────────── */}
        <h2 data-no>Construction and clear space</h2>
        <div className="lg-build">
          <div className="lg-build-fig">
            <div className="lg-clear">
              <span className="lg-clear-zone" aria-hidden="true" />
              <span className="lg-build-mark">
                <Mark size={160} />
                <svg className="lg-guides" viewBox="0 0 32 32" aria-hidden="true">
                  {[4, 8, 12, 16, 20, 24, 28].map((v) => (
                    <g key={v}>
                      <line x1={v} y1="0" x2={v} y2="32" />
                      <line x1="0" y1={v} x2="32" y2={v} />
                    </g>
                  ))}
                  <circle className="lg-g-key" cx="7" cy="7" r="7" />
                  <circle className="lg-g-key" cx="25" cy="7" r="7" />
                  <circle className="lg-g-key" cx="7" cy="25" r="7" />
                  <path className="lg-g-tail" d="M26 32H32V26" />
                  {[[16, 5], [27, 16], [16, 27], [5, 16]].map(([x, y]) => (
                    <circle className="lg-g-pt" key={`${x}-${y}`} cx={x} cy={y} r="0.8" />
                  ))}
                </svg>
              </span>
            </div>
          </div>
          <ul className="lg-build-notes">
            <li><strong>Tile.</strong> 32 × 32, corner radius 7 on three corners.</li>
            <li><strong>Tail.</strong> The bottom-right corner is square — the bubble's tail. It never moves.</li>
            <li><strong>Star.</strong> Four points at 5 and 27, centred; the waist pinches to 2.8 units from the centre lines.</li>
            <li><strong>Clear space.</strong> One corner radius on every side — 7/32 of the mark's size. Nothing else enters it, not even the project name.</li>
            <li><strong>Smallest.</strong> 16 px. Below that the star closes up — use the spark, or nothing.</li>
          </ul>
          <div className="lg-min">
            <div className="lg-min-cell"><Mark size={16} /><span className="lg-ok">16 px</span></div>
            <div className="lg-min-cell"><Mark size={12} /><span className="lg-bad">12 px</span></div>
            <div className="lg-min-cell"><Spark size={12} color="var(--spark)" /><span className="lg-dim">spark, for the AI</span></div>
          </div>
        </div>

        {/* ── Don'ts ─────────────────────────────────────────────────────── */}
        <h2 data-no>Don'ts<span className="h2-aside">the mark is lifted, never redrawn or restyled</span></h2>
        <div className="lg-donts">
          {DONTS.map((d) => (
            <figure className="lg-dont" key={d.title}>
              <div className="stage lg-dont-stage">{d.el}</div>
              <figcaption>
                <strong><span className="lg-x"><Ico id="x" size={12} /></span>{d.title}</strong>
                <span>{d.why}</span>
              </figcaption>
            </figure>
          ))}
        </div>

        {/* ── v2 migration notes ─────────────────────────────────────────── */}
        <h2 data-no>Before v2 ships<span className="h2-aside">migration notes for the brand files</span></h2>
        <ol className="lg-notes">
          {NOTES.map((n, i) => (
            <li key={n.t}>
              <span className="lg-notes-n">{i + 1}</span>
              <div><strong>{n.t}</strong><span>{n.d}</span></div>
            </li>
          ))}
        </ol>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · logo · source maude-v2/assets/logos (mark.svg lifted, spark.svg exact)</span>
        <span>Locked direction: ui/v2/maude-v2-moodboard.tsx → direction-mix</span>
      </footer>
    </>
  );
}
