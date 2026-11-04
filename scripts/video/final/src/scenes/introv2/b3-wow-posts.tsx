import { GatorMock, Thumb } from '../../../vendor/maude-v2/_kit';
import { Chip } from './shared';
import { CUE, EASE, lerp, sp, tw, useT } from './motion';

/**
 * Beat 3 · Wow 2 (18–27.5 s). "Drop in photos from the shoot. Out come the Instagram posts. On
 * brand, because it knows your design system."
 *
 * A recreation. Five photos drop and settle on the left; on "Out come the Instagram posts" each
 * one flies out (staggered, one shutter tick each) to a slot: four 1:1 posts and two 9:16
 * stories, first as the plain photo; on "On brand" the brand's own layout and colours (the
 * Alligators kit) wipe up over each one; "Made by AI" lands last.
 */
type Slot = { x: number; y: number; w: number; h: number; variant: 'social' | 'reel'; headline: string };
const SLOTS: Slot[] = [
  { x: 4860, y: -290, w: 270, h: 270, variant: 'social', headline: 'Game day' },
  { x: 5150, y: -290, w: 270, h: 270, variant: 'social', headline: 'Join us' },
  { x: 4860, y: 0, w: 270, h: 270, variant: 'social', headline: 'Season 26' },
  { x: 5150, y: 0, w: 270, h: 270, variant: 'social', headline: 'Tryouts' },
  { x: 5470, y: -290, w: 230, h: 410, variant: 'reel', headline: 'Touchdown' },
  { x: 5730, y: -290, w: 230, h: 410, variant: 'reel', headline: 'Saturday' },
];
const PHOTOS = [
  { x: 4330, y: -250, rot: -7 },
  { x: 4420, y: -120, rot: 5 },
  { x: 4350, y: 20, rot: -3 },
  { x: 4460, y: 120, rot: 8 },
  { x: 4380, y: 230, rot: -5 },
];
const PW = 250;
const PH = 190;

export const WowPosts = () => {
  const t = useT();
  if (t < 17.2) return null;
  const made = sp(t, CUE.w2.made, 'bouncy');
  return (
    <>
      {SLOTS.map((s, i) => {
        const p = PHOTOS[i % PHOTOS.length];
        const drop = sp(t, CUE.w2.drop + i * 0.09, 'snappy');
        const fly = tw(t, CUE.w2.fan + i * 0.32, CUE.w2.fan + 0.62 + i * 0.32, 0, 1, EASE.move);
        const land = sp(t, CUE.w2.fan + 0.55 + i * 0.32, 'bouncy');
        const brand = tw(t, CUE.w2.brand + i * 0.14, CUE.w2.brand + 0.55 + i * 0.14, 0, 1, EASE.enter);
        // the photo falls from above onto the pile, then flies out to its slot on an arc
        const x = lerp(p.x, s.x, fly);
        const y = lerp(p.y - (1 - drop) * 700, s.y, fly) - Math.sin(Math.PI * fly) * 140;
        const w = lerp(PW, s.w, fly);
        const h = lerp(PH, s.h, fly);
        const rot = lerp(p.rot, 0, fly);
        const pop = fly >= 1 ? 1 + 0.05 * Math.sin(Math.PI * Math.min(1, land)) * (1 - land) : 1;
        return (
          <div
            key={i}
            style={{
              position: 'absolute', left: x, top: y, width: w, height: h, transform: `rotate(${rot}deg) scale(${pop})`, opacity: drop,
              borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow-md)', border: `${lerp(8, 0, fly)}px solid var(--bg-0)`, background: 'var(--bg-0)',
            }}
          >
            <Thumb art={i % 2 ? 'gator-reel' : 'brand'} w={w} h={h} />
            {/* the brand layout wipes up over the photo on "On brand" */}
            <div style={{ position: 'absolute', inset: 0, clipPath: `inset(${(1 - brand) * 100}% 0 0 0)` }}>
              <div style={{ width: s.w, height: s.h }}>
                <GatorMock variant={s.variant} headline={s.headline} />
              </div>
            </div>
          </div>
        );
      })}
      {SLOTS.map((s, i) => (
        <span key={`l${i}`} style={{ position: 'absolute', left: s.x, top: s.y - 30, fontSize: 17, fontWeight: 600, color: 'var(--fg-1)', opacity: tw(t, CUE.w2.fan + 0.6 + i * 0.32, CUE.w2.fan + 0.9 + i * 0.32) }}>
          {s.variant === 'reel' ? 'Story 9:16' : 'Post 1:1'}
        </span>
      ))}
      <div style={{ position: 'absolute', left: 5470, top: 160, transform: `scale(${made})`, transformOrigin: '0 0' }}>
        <Chip ai>Made by AI · on brand</Chip>
      </div>
    </>
  );
};
