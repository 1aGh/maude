'use client';

// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
import { useState } from 'react';
import { Tick } from './tick';

const CODE = `<article className="plan">
  <span>Cloud Project</span>
  <p className="price">
    <b>€19</b> a month
  </p>
  <ul>
    <li>Everyone you invite</li>
    <li>Full history</li>
  </ul>
  <a className="button">Get started</a>
</article>`;

/**
 * The design-to-file wipe: a native range input slides the clip edge between the design and the
 * file behind it, no easing. Only the input is exposed to assistive tech; the picture is decoration.
 */
export function Wipe({ price, tier }: { price: string; tier: string }) {
  const [pos, setPos] = useState(42);
  return (
    <div className="ps-wipe" style={{ ['--pos' as string]: `${pos}%` }}>
      <div style={{ display: 'contents' }} aria-hidden="true">
        <div className="ps-wipe-see">
          <article className="ps-wipe-card">
            <span className="ps-small">{tier}</span>
            <span className="ps-wipe-price">
              <b>{price}</b> a month
            </span>
            <ul className="ps-ticks">
              <Tick>Everyone you invite</Tick>
              <Tick>Full history</Tick>
            </ul>
            <span className="btn btn--primary">Get started</span>
          </article>
        </div>
        <pre className="ps-code ps-wipe-file">
          {CODE.replace('€19', price).replace('Cloud Project', tier)}
        </pre>
        <span className="ps-wipe-bar">
          <span className="ps-wipe-knob">‹ ›</span>
        </span>
        <span className="ps-wipe-l">What you see</span>
        <span className="ps-wipe-r">Pricing.tsx</span>
      </div>
      <input
        className="ps-wipe-range"
        type="range"
        min={22}
        max={78}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Slide from the design to the file behind it"
        aria-valuetext={`Design ${pos}%, file ${100 - pos}%`}
      />
    </div>
  );
}
