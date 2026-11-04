import type { ReactNode } from 'react';
import { Img } from 'remotion';
import { photo } from './b2-wow-video';
import { Chip } from './shared';
import { CUE, EASE, lerp, sp, tw, useT } from './motion';

/**
 * Beat 3 · Wow 2 (18–27.5 s). "Drop in photos from the shoot. Out come the Instagram posts. On
 * brand, because it knows your design system."
 *
 * A recreation. Six prints from the shoot drop onto the canvas, big, close to the camera; on "Out
 * come" they snap to a grid in a fast cascade (four 1:1 posts and two 9:16 stories, a shutter
 * tick each) while the camera eases out to hold the whole grid; on "On brand" the club's layout
 * (the Alligators kit: ink, green, the leaf) wipes up over each photo; on "design system" every
 * post swaps to the kit's second layout in one cascade. The photos stay the photos throughout.
 */
type Slot = { x: number; y: number; w: number; h: number; story: boolean; pic: string; headline: string; sub: string };
const P = 360; // post size
const GAP = 24;
const SW = 419; // story width (9:16 at the grid's height)
const GX = 4442;
const GY = -372;
const GH = 2 * P + GAP;
export const SLOTS: Slot[] = [
  { x: GX, y: GY, w: P, h: P, story: false, pic: '05-hands', headline: 'Game day', sub: 'Sat 3 pm · home' },
  { x: GX + P + GAP, y: GY, w: P, h: P, story: false, pic: '09-leap', headline: 'Touchdown', sub: 'Gators 24 · 17' },
  { x: GX, y: GY + P + GAP, w: P, h: P, story: false, pic: '06-cleats', headline: 'Tryouts', sub: 'Open to all · Mon' },
  { x: GX + P + GAP, y: GY + P + GAP, w: P, h: P, story: false, pic: '08-bench', headline: 'Season 26', sub: 'The full roster' },
  { x: GX + 2 * (P + GAP), y: GY, w: SW, h: GH, story: true, pic: '04-throw', headline: 'Under the lights', sub: 'Friday 7 pm' },
  { x: GX + 2 * (P + GAP) + SW + GAP, y: GY, w: SW, h: GH, story: true, pic: '03-huddle', headline: 'One team', sub: 'Join the club' },
];
const PILE = [
  { x: 4760, y: -310, rot: -7 },
  { x: 5180, y: -340, rot: 5 },
  { x: 5560, y: -250, rot: -4 },
  { x: 4860, y: 30, rot: 6 },
  { x: 5260, y: -40, rot: -3 },
  { x: 5540, y: 60, rot: 8 },
];
const PW = 400;
const PH = 300;

const Leaf = ({ size }: { size: number }) => <i style={{ display: 'block', width: size, height: size, borderRadius: `${size * 0.2}px 999px ${size * 0.2}px 999px`, background: 'var(--object-green)' }} />;

/** The club's first layout: the photo full bleed, an ink band with the headline, the leaf. */
const LayoutA = ({ s }: { s: Slot }) => (
  <div style={{ position: 'absolute', inset: 0 }}>
    <span style={{ position: 'absolute', left: 22, top: 22 }}><Leaf size={s.story ? 52 : 44} /></span>
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: s.story ? '28px 28px 34px' : '18px 22px 22px', background: 'var(--object-ink)' }}>
      <b style={{ display: 'block', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: s.story ? 52 : 40, lineHeight: 1.02, letterSpacing: '-0.03em', color: 'var(--object-green)' }}>{s.headline}</b>
      <span style={{ display: 'block', marginTop: 6, fontSize: s.story ? 22 : 18, color: 'var(--object-grey)' }}>{s.sub}</span>
    </div>
  </div>
);

/** The second layout: ink ground, the photo in the kit's arch, the headline under it. */
const LayoutB = ({ s, children }: { s: Slot; children: ReactNode }) => (
  <div style={{ position: 'absolute', inset: 0, background: 'var(--object-ink)' }}>
    <div style={{ position: 'absolute', left: '9%', right: '9%', top: '7%', bottom: s.story ? '24%' : '33%', borderRadius: '999px 999px 18px 18px', overflow: 'hidden' }}>{children}</div>
    <b style={{ position: 'absolute', left: '9%', right: 60, bottom: s.story ? '8%' : '9%', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: s.story ? 50 : 36, lineHeight: 1.02, letterSpacing: '-0.03em', color: 'var(--object-green)' }}>{s.headline}</b>
    <span style={{ position: 'absolute', right: '8%', bottom: s.story ? '8%' : '9%' }}><Leaf size={s.story ? 40 : 30} /></span>
  </div>
);

export const WowPosts = () => {
  const t = useT();
  if (t < 17.2 || (t > 28 && t < 46) || t > 54.2) return null;
  const made = sp(t, CUE.w2.made, 'snappy');
  return (
    <>
      {SLOTS.map((s, i) => {
        const p = PILE[i];
        const drop = sp(t, CUE.w2.drop + i * 0.09, 'snappy');
        // snap to the grid: a fast cascade on one spring, with a small settle past the slot
        const go = sp(t, CUE.w2.fan + i * 0.12, 'bouncy');
        const fly = Math.min(1, go);
        const x = lerp(p.x, s.x, go);
        const y = lerp(p.y - (1 - drop) * 700, s.y, go) - Math.sin(Math.PI * fly) * 90;
        const w = lerp(PW, s.w, fly);
        const h = lerp(PH, s.h, fly);
        const rot = lerp(p.rot, 0, fly);
        const brand = tw(t, CUE.w2.brand + i * 0.12, CUE.w2.brand + 0.5 + i * 0.12, 0, 1, EASE.enter);
        const swap = tw(t, CUE.w2.swap + i * 0.08, CUE.w2.swap + 0.45 + i * 0.08, 0, 1, EASE.enter);
        const pic = <Img src={photo(s.pic)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />;
        return (
          <div
            key={i}
            style={{
              position: 'absolute', left: x, top: y, width: w, height: h, transform: `rotate(${rot}deg)`, opacity: drop, zIndex: go > 0.02 ? 10 + i : i,
              borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-lg)', border: `${lerp(10, 0, fly)}px solid var(--bg-0)`, background: 'var(--object-ink)',
            }}
          >
            {pic}
            {/* "On brand": the club's layout wipes up over the photo */}
            <div style={{ position: 'absolute', inset: 0, clipPath: `inset(${(1 - brand) * 100}% 0 0 0)`, opacity: brand > 0.001 ? 1 : 0 }}>
              <div style={{ position: 'absolute', left: 0, top: 0, width: s.w, height: s.h }}>
                <LayoutA s={s} />
              </div>
            </div>
            {/* "design system": every post swaps to the kit's second layout, top down */}
            <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 0 ${(1 - swap) * 100}% 0)`, opacity: swap > 0.001 ? 1 : 0 }}>
              <div style={{ position: 'absolute', left: 0, top: 0, width: s.w, height: s.h }}>
                <LayoutB s={s}>{pic}</LayoutB>
              </div>
            </div>
          </div>
        );
      })}
      {/* one label per column, above the grid (the 24 px gutter between rows has no room for one) */}
      {SLOTS.map((s, i) =>
        s.y === GY ? (
          <span key={`l${i}`} style={{ position: 'absolute', left: s.x, top: s.y - 36, whiteSpace: 'nowrap', fontSize: 22, fontWeight: 600, color: 'var(--fg-1)', opacity: tw(t, CUE.w2.fan + 0.45 + i * 0.12, CUE.w2.fan + 0.75 + i * 0.12) }}>
            {s.story ? 'Story 9:16' : 'Post 1:1'}
          </span>
        ) : null,
      )}
      <div style={{ position: 'absolute', left: 5257, top: GY + GH + 22, transform: `translateX(-50%) scale(${1.3 * made})`, transformOrigin: '50% 0' }}>
        <Chip ai style={{ fontSize: 24 }}>Made by AI · on brand</Chip>
      </div>
    </>
  );
};
