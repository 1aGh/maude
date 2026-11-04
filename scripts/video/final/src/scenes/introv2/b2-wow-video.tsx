import { GatorMock, Thumb } from '../../../vendor/maude-v2/_kit';
import { Chip, SparkRing } from './shared';
import { CUE, EASE, lerp, sp, tw, useT } from './motion';

/**
 * Beat 2 · Wow 1 (6.4–18 s). "Drop in your raw footage. Forty clips. Mostly your thumb. The AI
 * watches all of it, picks the good bits and cuts the film. Captions and music included."
 *
 * A recreation of the AI cut (an AI run is not deterministic). The clips fall onto the canvas
 * under gravity and settle; "40 clips" lands; the spark ring wraps the pile; the picked clips fly
 * on arcs into a timeline (video, captions and music tracks); the 9:16 artboard plays the cut
 * with word-by-word captions while the playhead runs.
 */
type Art = Parameters<typeof Thumb>[0]['art'];
const ARTS: Art[] = ['video', 'gator-reel', 'brand', 'gator-social', 'board', 'home', 'gator-poster', 'mobile', 'gator-web', 'video', 'brand', 'gator-numbers', 'gator-reel', 'board'];
const CW = 230;
const CH = 130;

/** The pile: where each clip settles (world px), its tilt, and whether the AI keeps it. */
const PILE = ARTS.map((art, i) => {
  const r = (n: number) => {
    const s = Math.sin((i + 1) * n * 91.7) * 4375.85;
    return s - Math.floor(s);
  };
  return { art, x: 1900 + r(1.3) * 420, y: -150 + r(2.1) * 330 + (i % 3) * 18, rot: (r(3.7) - 0.5) * 34, at: CUE.w1.drop + i * 0.07 + r(4.4) * 0.12, keep: [0, 2, 4, 7, 9, 12].indexOf(i) };
});

const TL = { x: 2040, y: 380, w: 1300 }; // the timeline (world px)
const SLOT = 196;
const VID = { x: 2990, y: -470, w: 360, h: 640 }; // the 9:16 video artboard
const WORDS = ['and', "that's", 'the', 'whole', 'trick'];
const CUT_TITLES = ['Game day', 'Touchdown', 'Season 26', 'Tryouts', 'Saturday', 'Go Gators'];

/** One clip: free fall, bounce on landing, then (if kept) an arc into its timeline slot. */
const Clip = ({ c, t }: { c: (typeof PILE)[number]; t: number }) => {
  const fallT = Math.max(0, t - c.at);
  const H = 1100; // drop height
  const g = 5200; // px/s² — snappy, cartoon gravity
  const tLand = Math.sqrt((2 * H) / g);
  let y = c.y - H + 0.5 * g * fallT * fallT;
  let squash = 1;
  if (fallT >= tLand) {
    const settle = sp(t, c.at + tLand, 'bouncy'); // a small bounce on impact
    y = c.y - 26 * Math.sin(Math.PI * Math.min(1, settle)) * (1 - settle);
    squash = 1 - 0.08 * Math.max(0, 1 - (t - c.at - tLand) * 8);
  }
  let x = c.x;
  let rot = c.rot * Math.min(1, fallT / tLand);
  let w = CW;
  let h = CH;
  let o = fallT > 0 ? 1 : 0;
  const fly = c.keep >= 0 ? tw(t, CUE.w1.fly + c.keep * 0.09, CUE.w1.fly + 0.75 + c.keep * 0.09, 0, 1, EASE.move) : 0;
  if (fly > 0) {
    const tx = TL.x + 96 + c.keep * SLOT;
    const ty = TL.y + 62;
    x = lerp(c.x, tx, fly);
    y = lerp(c.y, ty, fly) - Math.sin(Math.PI * fly) * 220; // an arc, not a slide
    rot = lerp(c.rot, 0, fly);
    w = lerp(CW, SLOT - 6, fly);
    h = lerp(CH, 70, fly);
  }
  if (c.keep < 0) o *= 1 - 0.75 * tw(t, CUE.w1.fly, CUE.w1.fly + 0.5); // the rest step back
  return (
    <div
      style={{
        position: 'absolute', left: x, top: y, width: w, height: h, opacity: o, borderRadius: 10, overflow: 'hidden',
        transform: `rotate(${rot}deg) scaleY(${squash})`, boxShadow: 'var(--shadow-md)', border: '3px solid var(--bg-0)', background: 'var(--bg-2)',
      }}
    >
      <Thumb art={c.art} w={w} h={h} />
    </div>
  );
};

export const WowVideo = () => {
  const t = useT();
  if (t < 5.5) return null;
  const ring = tw(t, CUE.w1.ring, CUE.w1.ring + 1.3, 0, 1, EASE.move);
  const ringOut = tw(t, CUE.w1.fly + 0.2, CUE.w1.fly + 0.6);
  const tl = sp(t, CUE.w1.fly - 0.3, 'calm');
  const vid = sp(t, CUE.w1.play - 0.5, 'snappy');
  const play = tw(t, CUE.w1.play, 17.6, 0, 1, (n) => n);
  const kept = PILE.filter((c) => c.keep >= 0).sort((a, b) => a.keep - b.keep);
  const shot = kept[Math.min(kept.length - 1, Math.floor(play * kept.length))];
  const count = sp(t, CUE.w1.count, 'bouncy') * (1 - tw(t, CUE.w1.ring, CUE.w1.ring + 0.3));
  return (
    <>
      {/* the timeline: rises in under the pile as the AI starts cutting */}
      <div
        style={{
          position: 'absolute', left: TL.x, top: TL.y, width: TL.w, opacity: tl, transform: `translateY(${(1 - tl) * 40}px)`,
          background: 'var(--bg-1)', borderRadius: 18, boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-subtle)', padding: '14px 18px 18px',
        }}
      >
        <div style={{ display: 'flex', gap: 0, marginLeft: 78, color: 'var(--fg-2)', fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
          {Array.from({ length: 7 }, (_, i) => <span key={i} style={{ width: SLOT }}>0:0{i * 2}</span>)}
        </div>
        {[0, 1, 2].map((row) => (
          <div key={row} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, height: row === 0 ? 76 : 34 }}>
            <span style={{ width: 68, color: 'var(--fg-2)', fontSize: 15, fontWeight: 600 }}>{['Video', 'Captions', 'Music'][row]}</span>
            <div style={{ position: 'relative', flex: 1, height: '100%', background: 'var(--bg-2)', borderRadius: 8, overflow: 'hidden' }}>
              {row === 1
                ? Array.from({ length: 6 }, (_, i) => (
                    <i key={i} style={{ position: 'absolute', left: 8 + i * SLOT, top: 6, height: 22, width: (SLOT - 30) * tw(t, CUE.w1.fly + 0.9 + i * 0.08, CUE.w1.fly + 1.3 + i * 0.08), borderRadius: 6, background: 'var(--object-lilac)' }} />
                  ))
                : null}
              {row === 2
                ? Array.from({ length: 64 }, (_, i) => (
                    <i key={i} style={{ position: 'absolute', left: 6 + i * 18.5, bottom: 4, width: 10, borderRadius: 3, background: 'var(--object-sky)', height: `${(20 + ((i * 37) % 70)) * tw(t, CUE.w1.fly + 1.2 + i * 0.012, CUE.w1.fly + 1.5 + i * 0.012)}%` }} />
                  ))
                : null}
            </div>
          </div>
        ))}
        {/* the playhead */}
        <i style={{ position: 'absolute', left: 18 + 78 + play * (TL.w - 130), top: 8, bottom: 8, width: 3, borderRadius: 2, background: 'var(--accent)', opacity: play > 0 ? 1 : 0 }} />
      </div>

      {PILE.map((c, i) => <Clip key={i} c={c} t={t} />)}

      <div style={{ position: 'absolute', left: 2050, top: -330, transform: `scale(${count})`, transformOrigin: '0 100%' }}>
        <Chip>40 clips</Chip>
      </div>

      <SparkRing x={1820} y={-250} w={720} h={570} draw={ring} out={ringOut} />
      <div style={{ position: 'absolute', left: 2300, top: -310, opacity: ring > 0 ? 1 - ringOut : 0, transform: `scale(${sp(t, CUE.w1.ring, 'bouncy')})`, transformOrigin: '0 100%' }}>
        <Chip ai>{t < CUE.w1.ring + 1.5 ? 'AI is watching' : 'AI is cutting'}</Chip>
      </div>

      {/* the 9:16 artboard that plays the cut */}
      <div style={{ position: 'absolute', left: VID.x, top: VID.y, opacity: vid, transform: `translateY(${(1 - vid) * 50}px) scale(${0.94 + 0.06 * vid})`, transformOrigin: '50% 100%' }}>
        <span style={{ display: 'block', marginBottom: 8, fontSize: 18, fontWeight: 600, color: 'var(--fg-1)' }}>Reel 9:16</span>
        <div style={{ position: 'relative', width: VID.w, height: VID.h, borderRadius: 14, overflow: 'hidden', background: 'var(--object-ink)', boxShadow: 'var(--shadow-lg)' }}>
          {play > 0 && shot ? (
            // the cut: one branded shot per kept clip, each with a slow push (Ken Burns)
            <div style={{ position: 'absolute', inset: 0, transform: `scale(${1.04 + 0.06 * ((play * kept.length) % 1)})` }}>
              <GatorMock variant="reel" headline={CUT_TITLES[kept.indexOf(shot) % CUT_TITLES.length]} />
            </div>
          ) : null}
          <div style={{ position: 'absolute', left: 20, right: 20, top: 96, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 10px' }}>
            {WORDS.map((w, i) => {
              const at = CUE.w1.cap + i * 0.28;
              const on = sp(t, at, 'snappy');
              const live = t >= at && t < at + 0.28;
              return (
                <span key={i} style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 36, color: live ? 'var(--object-yellow)' : 'var(--bg-0)', opacity: on, transform: `translateY(${(1 - on) * 14}px) scale(${live ? 1.08 : 1})`, textShadow: '0 2px 10px var(--object-ink)' }}>
                  {w}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
};
