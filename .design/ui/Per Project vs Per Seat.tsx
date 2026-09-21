/**
 * @canvas      Per Project vs Per Seat — social share graphic for the Maude Cloud
 *              free-pilot announcement · one argument: flat per-project pricing
 *              vs Figma's climbing per-seat pricing
 * @ds          maude
 * @platform    web
 * @opt_out     palette
 * @artboards   pricing-social
 * @brief       Static 1200×628 (1.91:1) PNG for Bluesky + LinkedIn. Maude Cloud
 *              is €19/mo per project (unlimited people); Figma is priced per
 *              seat ($16 Professional / $55 Organization). A hand-computed line
 *              chart across team sizes 1/3/5/10 shows Maude flat, Figma climbing.
 * @stack       React 19 · TSX · Bun.build · sibling Per Project vs Per Seat.css
 * @history     .design/_history/ui-per_project_vs_per_seat/
 *
 * Authored under the `maude` DS ("Unified Pro Studio", dark-first, one indigo
 * accent). The chart is hand-computed inline SVG (no charting lib, no eval) —
 * 4 category points (1/3/5/10 people), straight segments (real data points,
 * no fake smoothing). Maude is the ONE accent-colored series (the hero);
 * both Figma tiers are grayscale (fg-1/fg-2) and additionally distinguished
 * by stroke pattern (solid vs dashed), never by hue alone. No shared numeric
 * y-axis label is drawn — Maude's € and Figma's $ are never implied
 * equivalent (per the brief); every value is a direct text label in its own
 * currency instead. All numbers are the owner-verified figures — nothing
 * invented, nothing extrapolated beyond team size 10.
 */
import "../system/maude/colors_and_type.css";
import "./Per Project vs Per Seat.css";
import { DesignCanvas, DCArtboard } from "@maude/canvas-lib";

/* ── The spark — maude's one mark shape, lifted verbatim from
 * system/maude/preview/logo.tsx (DDR-141: reuse, don't redraw). */
function Spark() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="currentColor" />
    </svg>
  );
}

/* ── Chart geometry — computed once for this fixed 1120×300 viewBox.
 * Category axis (team size, NOT a linear scale): 4 evenly-spaced columns.
 * Value axis: linear 0→600, mapped y = 266 − (v/600)×244. Higher price ⇒
 * smaller y ⇒ higher on the chart (conventional reading). */
const X = [10, 300, 590, 880]; // 1 / 3 / 5 / 10 people
const TOP = 22;
const BASE = 266;
const yFor = (v: number) => BASE - (v / 600) * (BASE - TOP);

const MAUDE = [19, 19, 19, 19].map((v) => yFor(v)); // flat — unlimited people, €19/mo
const FIG_PRO = [16, 48, 80, 160].map((v) => yFor(v)); // $16/seat
const FIG_ORG = [55, 165, 275, 550].map((v) => yFor(v)); // $55/seat

const pts = (ys: number[]) => X.map((x, i) => `${x},${ys[i]}`).join(" ");

function Leader({ x, y, stroke, dash }: { x: number; y: number; stroke: string; dash?: string }) {
  return <line x1={x} y1={y} x2={x + 30} y2={y} stroke={stroke} strokeWidth={2} strokeDasharray={dash} opacity={0.55} />;
}

function EndLabel({
  y,
  name,
  price,
  nameColor,
  priceColor,
}: {
  y: number;
  name: string;
  price: string;
  nameColor: string;
  priceColor: string;
}) {
  return (
    <>
      <text x={922} y={y - 4} fontFamily="var(--font-display)" fontWeight={600} fontSize={12.5} fill={nameColor}>
        {name}
      </text>
      <text x={922} y={y + 12} fontFamily="var(--font-mono)" fontWeight={600} fontSize={12} fill={priceColor}>
        {price}
      </text>
    </>
  );
}

function PricingChart() {
  return (
    <svg viewBox="0 0 1120 300" preserveAspectRatio="none" role="img" aria-label="Line chart: Maude Cloud stays flat at 19 euros per month regardless of team size, while Figma Professional climbs from 16 to 160 dollars and Figma Organization climbs from 55 to 550 dollars as a team grows from 1 to 10 people.">
      {/* axis caption — no numeric ticks (€ and $ are never put on one shared scale) */}
      <text x={10} y={12} fontFamily="var(--font-mono)" fontSize={10} letterSpacing="0.08em" fill="var(--fg-2)">
        MONTHLY COST AS THE TEAM GROWS →
      </text>

      {/* rhythm gridlines */}
      <line x1={10} y1={144} x2={880} y2={144} stroke="var(--border-subtle)" strokeWidth={1} />
      <line x1={10} y1={BASE} x2={880} y2={BASE} stroke="var(--border-default)" strokeWidth={1} />

      {/* Figma Organization — dashed, brighter gray (the more dramatic climb) */}
      <polyline points={pts(FIG_ORG)} fill="none" stroke="var(--fg-1)" strokeWidth={2} strokeDasharray="7 5" strokeLinejoin="round" />
      {FIG_ORG.map((y, i) => (
        <circle key={"o" + i} cx={X[i]} cy={y} r={3.5} fill="var(--fg-1)" />
      ))}
      <Leader x={880} y={FIG_ORG[3]} stroke="var(--fg-1)" dash="7 5" />
      <EndLabel y={FIG_ORG[3]} name="Figma Organization" price="$550/mo" nameColor="var(--fg-0)" priceColor="var(--fg-1)" />

      {/* Figma Professional — solid, dimmer gray */}
      <polyline points={pts(FIG_PRO)} fill="none" stroke="var(--fg-2)" strokeWidth={2} strokeLinejoin="round" />
      {FIG_PRO.map((y, i) => (
        <circle key={"p" + i} cx={X[i]} cy={y} r={3.5} fill="var(--fg-2)" />
      ))}
      <Leader x={880} y={FIG_PRO[3]} stroke="var(--fg-2)" />
      <EndLabel y={FIG_PRO[3]} name="Figma Professional" price="$160/mo" nameColor="var(--fg-1)" priceColor="var(--fg-2)" />

      {/* Maude Cloud — the one accent line, dead flat */}
      <polyline points={pts(MAUDE)} fill="none" stroke="var(--accent)" strokeWidth={3} strokeLinejoin="round" />
      {MAUDE.map((y, i) => (
        <circle key={"m" + i} cx={X[i]} cy={y} r={4} fill="var(--accent)" stroke="var(--bg-0)" strokeWidth={2} />
      ))}
      <Leader x={880} y={MAUDE[3]} stroke="var(--accent)" />
      <EndLabel y={MAUDE[3]} name="Maude Cloud" price="€19/mo flat" nameColor="var(--fg-0)" priceColor="var(--accent)" />

      {/* x-axis category ticks */}
      {["1", "3", "5", "10 people"].map((label, i) => (
        <text key={label} x={X[i]} y={BASE + 20} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={13} fill="var(--fg-1)">
          {label}
        </text>
      ))}
    </svg>
  );
}

export default function PerProjectVsPerSeat() {
  return (
    <DesignCanvas>
      <DCArtboard id="pricing-social" label="Pricing: per project vs per seat" width={1200} height={628} fixed padding={0} background="var(--bg-0)">
        <div className="maude pps-root" data-theme="dark">
          <div className="pps-frame">
            <header className="pps-header">
              <span className="pps-eyebrow">
                <span className="pps-eyebrow-tick" aria-hidden="true" />
                Pricing, compared
              </span>
              <span className="pps-lockup" role="img" aria-label="Maude Cloud">
                <span className="pps-mark" aria-hidden="true">
                  <Spark />
                </span>
                <span className="pps-word">Maude Cloud</span>
              </span>
            </header>

            <div className="pps-hero">
              <div className="pps-headline-col">
                <h1 className="pps-headline">
                  <span className="pps-headline-l1">
                    You pay per <span className="pps-accent">project</span>.
                  </span>
                  <span className="pps-headline-l2">They pay per seat.</span>
                </h1>
                <p className="pps-sub">
                  A 5-person team: Maude Cloud is <span className="pps-sub-accent">€19/mo</span> flat, <b>unlimited people</b>. Figma Professional runs $80/mo. Figma Organization runs $275/mo.
                </p>
              </div>
              <div className="pps-stat" role="img" aria-label="At 10 people: Maude Cloud 19 euros per month, Figma Organization 550 dollars per month">
                <div className="pps-stat-cap">At 10 people</div>
                <div className="pps-stat-row">
                  <span className="pps-stat-name">Maude Cloud</span>
                  <span className="pps-stat-price pps-stat-price--accent">€19/mo</span>
                </div>
                <div className="pps-stat-row">
                  <span className="pps-stat-name">Figma Org</span>
                  <span className="pps-stat-price">$550/mo</span>
                </div>
              </div>
            </div>

            <div className="pps-chart-wrap">
              <PricingChart />
            </div>

            <footer className="pps-footer">
              Maude Cloud: €19/mo per project, unlimited people. Pilot is currently free; €19 is the target price. Figma: billed per seat, Professional $16/seat/mo, Organization $55/seat/mo. Public Figma pricing, Sep 2026.
            </footer>
          </div>
        </div>
      </DCArtboard>
    </DesignCanvas>
  );
}
