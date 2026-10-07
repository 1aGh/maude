/**
 * SPECIMEN — components-tables · maude-v2
 *
 * DEMONSTRATES: --bg-1 table body inside a sheet (--bg-2) · --bg-3 header + row hover ·
 *               --accent-muted for the picked row (selection is azure's job) · --border-subtle
 *               row rules · tabular numerals · the 4 px half-step density (--space-1) used ONLY
 *               once Advanced is open · --font-mono only inside Advanced.
 * COMPOSITION:  hero = version history as a designer's table over the canvas: a thumbnail, a
 *               name, who, when, and "Restore" as the row action — grouped Today / Yesterday /
 *               Earlier, AI's own checkpoints marked with the spark. An Advanced switch adds
 *               commit, branch and file columns in a denser grid (live toggle) — no SHA by
 *               default, nothing removed · the export list with status as icon + sentence ·
 *               empty / loading / can't-load states · column words keep-or-kill · four rules.
 * COPY VOICE:   column labels are short everyday nouns ("Who", "When"); times per CONTRACT.md §4 —
 *               relative first ("4 min ago", "Yesterday, 17:40"), then "28 Sep, 16:20" (24-hour).
 * WHEN SCAFFOLDED: universal (default-on).
 * NOTES:        Tables in Maude are lists of your work, not logs. Thumbnails lead, numbers sit
 *               right-aligned, and actions appear where your pointer already is.
 */
import { useState } from "react";
import "./_layout.css";
import "./components-tables.css";
import { Mark, Spark, SpecimenHeader } from "./_specimen-controls";

type Who = "You" | "Tereza" | "Jonas" | "AI";
type Version = {
  id: string; name: string; named?: boolean; who: Who; when: string; thumb: string;
  sha: string; branch: string; files: string; current?: boolean;
};

const GROUPS: { label: string; rows: Version[] }[] = [
  {
    label: "Today",
    rows: [
      { id: "v0", name: "What you see now", who: "You", when: "Now", thumb: "a", sha: "—", branch: "main", files: "unsaved", current: true },
      { id: "v1", name: "Three plans, annual toggle", named: true, who: "Tereza", when: "4 min ago", thumb: "a", sha: "9c41e2a", branch: "main", files: "+3 −1" },
      { id: "v2", name: "Before AI rewrote Pro", who: "AI", when: "12 min ago", thumb: "b", sha: "e07b3d9", branch: "main", files: "+1 −1" },
      { id: "v3", name: "Edits to the FAQ", who: "You", when: "1 h ago", thumb: "b", sha: "41fa0c8", branch: "main", files: "+2 −2" },
    ],
  },
  {
    label: "Yesterday",
    rows: [
      { id: "v4", name: "FAQ moved under the plans", who: "Jonas", when: "Yesterday, 17:40", thumb: "c", sha: "b2d9917", branch: "pricing-faq", files: "+4 −3" },
      { id: "v5", name: "First full draft", named: true, who: "You", when: "Yesterday, 10:02", thumb: "c", sha: "7a10e5f", branch: "main", files: "+9 −0" },
    ],
  },
  {
    label: "Earlier",
    rows: [{ id: "v6", name: "Brought in from Figma", who: "You", when: "28 Sep, 16:20", thumb: "d", sha: "0d3c6b2", branch: "main", files: "+14 −0" }],
  },
];

function WhoCell({ who }: { who: Who }) {
  if (who === "AI") {
    return <span className="tb-who"><span className="tb-av tb-av--ai"><Spark size={11} color="var(--spark-fg)" /></span>AI checkpoint</span>;
  }
  const tone = who === "You" ? "you" : who === "Tereza" ? "sky" : "green";
  return <span className="tb-who"><span className={`tb-av tb-av--${tone}`} aria-hidden="true">{who.slice(0, 1)}</span>{who}</span>;
}

function Thumb({ v }: { v: string }) {
  return (
    <span className={`tb-thumb tb-thumb--${v}`} aria-hidden="true">
      <span /><span /><span />
    </span>
  );
}

type Kind = "ok" | "busy" | "err";
function StatusGlyph({ kind }: { kind: Kind }) {
  return (
    <svg className={`tb-glyph tb-glyph--${kind}`} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" />
      {kind === "ok" && <path d="M5.4 8.2l1.8 1.8 3.4-3.7" />}
      {kind === "err" && <path d="M6 6l4 4M10 6l-4 4" />}
      {kind === "busy" && <path d="M8 4.6V8l2.2 1.4" />}
    </svg>
  );
}

const EXPORTS: { name: string; what: string; size: string; when: string; kind: Kind; status: string; pct?: number; action: string; thumb: string }[] = [
  { name: "Homepage", what: "Images · 4 artboards", size: "6.1 MB", when: "2 min ago", kind: "ok", status: "Ready", action: "Show in Finder", thumb: "a" },
  { name: "Onboarding", what: "Video · 1080p", size: "—", when: "Now", kind: "busy", status: "Exporting", pct: 64, action: "Cancel", thumb: "c" },
  { name: "Pricing", what: "PDF · 3 artboards", size: "—", when: "6 min ago", kind: "err", status: "Couldn't export — a font isn't on this Mac", action: "Try again", thumb: "b" },
  { name: "Mobile — detail", what: "Handoff for developers", size: "1.2 MB", when: "Yesterday", kind: "ok", status: "Ready", action: "Show in Finder", thumb: "d" },
];

const WORDS = [
  ["Who", "Author"],
  ["When", "Timestamp (UTC)"],
  ["4 min ago", "2026-10-05T19:42:11Z"],
  ["Restore", "Checkout"],
  ["Version history", "Changes"],
];

export default function ComponentsTables() {
  const [adv, setAdv] = useState(false);
  const [picked, setPicked] = useState("v2");

  return (
    <>
      <SpecimenHeader crumbs={["Components", "Tables"]} />
      <main className="specimen">
        <section className="specimen-title">
          <h1>Version history reads like a contact sheet, not a log.</h1>
          <p className="lede">
            A table in Maude is a list of your work: a picture of it, a name, who made it, when.
            The one action you need shows up on the row you're on. The technical columns are still
            there — open Advanced and the table gets denser and tells you everything.
          </p>
        </section>

        <dl className="specimen-meta">
          <div><dt>Header</dt><dd>--bg-3 · no rules</dd></div>
          <div><dt>Picked row</dt><dd>--accent-muted</dd></div>
          <div><dt>Hover</dt><dd>--bg-3</dd></div>
          <div><dt>Advanced</dt><dd>+ commit, branch, files · denser</dd></div>
        </dl>

        {/* ── Hero: version history ─────────────────────────────────────── */}
        <h2 data-no>Version history<span className="h2-aside">pick a row, or open Advanced to see the commits</span></h2>
        <div className="stage tb-hero">
          <div className="tb-bg-board"><div className="tb-bg-img" /><div className="tb-bg-body"><strong>Pricing</strong><span>Three plans and a FAQ.</span></div></div>
          <div className="island tb-pill"><Mark size={22} /><span>Studio site</span><svg className="tb-caret" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg></div>

          <section className={`tb-sheet${adv ? " tb-sheet--adv" : ""}`} aria-labelledby="tb-vh-t">
            <header className="tb-sheet-hd">
              <h3 id="tb-vh-t">Version history</h3>
              <span className="tb-sheet-sub">Pricing · 7 versions</span>
              <label className="tb-adv-l">
                Advanced
                <button type="button" role="switch" aria-checked={adv} className="switch" aria-label="Advanced columns" onClick={() => setAdv((v) => !v)} />
              </label>
            </header>

            <div className="tb-scroll">
              <table className="tb-table">
                <thead>
                  <tr>
                    <th scope="col" className="tb-c-thumb"><span className="tb-sr">Preview</span></th>
                    <th scope="col">Version</th>
                    <th scope="col">Who</th>
                    {adv && <th scope="col" className="tb-adv-col">Commit</th>}
                    {adv && <th scope="col" className="tb-adv-col">Branch</th>}
                    {adv && <th scope="col" className="tb-adv-col tb-num">Files</th>}
                    <th scope="col" className="tb-num">When</th>
                    <th scope="col" className="tb-c-act"><span className="tb-sr">Action</span></th>
                  </tr>
                </thead>
                {GROUPS.map((g) => (
                  <tbody key={g.label}>
                    <tr className="tb-group"><th scope="rowgroup" colSpan={adv ? 8 : 5}>{g.label}</th></tr>
                    {g.rows.map((v) => {
                      const sel = v.id === picked;
                      return (
                        <tr key={v.id} className={`tb-row${sel ? " is-picked" : ""}${v.current ? " is-current" : ""}`} onClick={() => !v.current && setPicked(v.id)}>
                          <td className="tb-c-thumb"><Thumb v={v.thumb} /></td>
                          <td>
                            <span className="tb-name">{v.name}</span>
                            {v.named && <span className="chip tb-chip">Named</span>}
                            {v.current && <span className="chip chip--accent tb-chip">Current</span>}
                          </td>
                          <td><WhoCell who={v.who} /></td>
                          {adv && <td className="tb-adv-col"><code>{v.sha}</code></td>}
                          {adv && <td className="tb-adv-col"><code>{v.branch}</code></td>}
                          {adv && <td className="tb-adv-col tb-num"><code>{v.files}</code></td>}
                          <td className="tb-num tb-when">{v.when}</td>
                          <td className="tb-c-act">
                            {!v.current && (
                              <button className={`btn btn--sm ${sel ? "btn--primary" : "btn--ghost"} tb-restore`} type="button">Restore</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
            </div>

            {adv && (
              <footer className="tb-adv-ft">
                <code>3 commits ahead of origin/main</code>
                <span className="tb-adv-links"><button className="btn btn--ghost btn--sm" type="button">Copy commit ID</button><button className="btn btn--ghost btn--sm" type="button">Show what changed</button></span>
              </footer>
            )}
          </section>
        </div>
        <div className="tb-hero-notes">
          <p><strong>Pictures first.</strong> You recognise a version by how it looked, so the thumbnail leads and the name follows.</p>
          <p><strong>AI's checkpoints</strong> carry the spark. They're made just before AI changes something, so you can always step back.</p>
          <p><strong>Restore</strong> is the one row action. Commit, branch and files are under Advanced, in a tighter grid and in mono — nothing technical by default.</p>
        </div>

        {/* ── Exports ───────────────────────────────────────────────────── */}
        <h2 data-no>Exports<span className="h2-aside">status is an icon and a sentence, the action matches it</span></h2>
        <div className="tb-exports">
          <table className="tb-table tb-table--ex">
            <thead>
              <tr>
                <th scope="col" className="tb-c-thumb"><span className="tb-sr">Preview</span></th>
                <th scope="col">Canvas</th>
                <th scope="col">Status</th>
                <th scope="col" className="tb-num">Size</th>
                <th scope="col" className="tb-num">When</th>
                <th scope="col" className="tb-c-act"><span className="tb-sr">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {EXPORTS.map((e) => (
                <tr className="tb-row tb-row--show" key={e.name}>
                  <td className="tb-c-thumb"><Thumb v={e.thumb} /></td>
                  <td><span className="tb-name">{e.name}</span><span className="tb-what">{e.what}</span></td>
                  <td>
                    <span className={`tb-status tb-status--${e.kind}`} role={e.kind === "busy" ? "status" : undefined}>
                      <StatusGlyph kind={e.kind} />
                      <span>{e.status}{e.pct !== undefined && <span className="tb-pct"> · {e.pct}%</span>}</span>
                    </span>
                    {e.pct !== undefined && <span className="tb-bar" aria-hidden="true"><span style={{ transform: `scaleX(${e.pct / 100})` }} /></span>}
                  </td>
                  <td className="tb-num">{e.size}</td>
                  <td className="tb-num tb-when">{e.when}</td>
                  <td className="tb-c-act"><button className={`btn btn--sm ${e.kind === "err" ? "" : "btn--ghost"} tb-restore`} type="button">{e.action}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <details className="tb-ex-adv">
            <summary>Advanced</summary>
            <p>Exports run on this Mac. Raw logs for the failed one: <code>render: font "Söhne Buch" not found (pricing.pdf)</code></p>
          </details>
        </div>

        {/* ── States ────────────────────────────────────────────────────── */}
        <h2 data-no>Empty, loading, can't load<span className="h2-aside">the table's shape stays; only the rows change</span></h2>
        <div className="tb-states">
          <div className="tb-state">
            <div className="tb-state-head"><span>Version</span><span>When</span></div>
            <div className="tb-empty">
              <span className="tb-empty-art" aria-hidden="true"><span /><span /><span /></span>
              <strong>No versions yet</strong>
              <span>Versions appear here as you work. There's nothing to save.</span>
            </div>
          </div>
          <div className="tb-state" aria-busy="true">
            <div className="tb-state-head"><span>Version</span><span>When</span></div>
            <span className="tb-sr" role="status">Loading versions</span>
            {[0.7, 0.5, 0.62, 0.45].map((w, i) => (
              <div className="tb-skel-row" key={i}>
                <span className="tb-skel tb-skel--thumb" aria-hidden="true" />
                <span className="tb-skel" style={{ width: `${w * 100}%` }} aria-hidden="true" />
                <span className="tb-skel tb-skel--when" aria-hidden="true" />
              </div>
            ))}
          </div>
          <div className="tb-state">
            <div className="tb-state-head"><span>Version</span><span>When</span></div>
            <div className="tb-empty">
              <StatusGlyph kind="err" />
              <strong>Couldn't load Version history</strong>
              <span>The project folder didn't open. Your versions are safe on this Mac.</span>
              <button className="btn btn--sm" type="button">Try again</button>
            </div>
          </div>
        </div>

        {/* ── Words + rules ─────────────────────────────────────────────── */}
        <h2 data-no>Column words<span className="h2-aside">keep or kill</span></h2>
        <div className="tb-words">
          {WORDS.map(([k, x]) => (
            <div className="tb-word" key={k}><span className="tb-keep">{k}</span><span className="tb-kill">{x}</span></div>
          ))}
        </div>

        <div className="tb-rules">
          <div><strong>Names left, numbers right</strong><span>Thumbnail and name lead; sizes and times sit right-aligned in tabular figures.</span></div>
          <div><strong>Fresh dates are relative</strong><span>“4 min ago” today, “Yesterday, 17:40”, then “28 Sep, 16:20” — always 24-hour.</span></div>
          <div><strong>One row action</strong><span>Restore appears on the hovered or picked row. Focus reveals it too. No SHA unless Advanced is on.</span></div>
          <div><strong>Picked is azure</strong><span>Hover is a quiet fill. The picked row gets the selection tint, never a status colour.</span></div>
        </div>
      </main>
      <footer className="specimen-ft">
        <span>maude-v2 · tables</span>
        <span>A list of your work, not a log</span>
      </footer>
    </>
  );
}
