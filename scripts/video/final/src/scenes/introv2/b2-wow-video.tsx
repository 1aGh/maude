import { Img, staticFile } from 'remotion';
import { Chip, SparkRing } from './shared';
import { CUE, EASE, lerp, sp, tw, useT } from './motion';

/**
 * Beat 2 · Wow 1 (6.4–18 s). "Drop in your raw footage. Forty clips. Mostly your thumb. The AI
 * watches all of it, picks the good bits and cuts the film. Captions and music included."
 *
 * A recreation of the AI cut (an AI run is not deterministic). The camera is in close on the
 * pile: the clips (stills from one generated shoot, each one slowly playing) fall onto the canvas
 * under gravity and settle, several with a thumb over the lens; "40 clips" lands; the spark draws
 * its ring round the pile; the six good clips fly on arcs into a timeline and the rest fade away;
 * the captions and music tracks fill in; the 9:16 reel plays the cut with word-by-word captions
 * (rising where the pile was, centred over the timeline) and the camera punches in on it until
 * it fills most of the frame.
 */
export const photo = (name: string) => staticFile(`introv2/photos/${name}.jpg`);

const SHOTS = ['01-tunnel', '02-sprint', '03-huddle', '04-throw', '07-kick', '09-leap']; // the cut, in order
const REST = ['05-hands', '06-cleats', '08-bench', '10-ball', '02-sprint', '07-kick', '04-throw', '03-huddle'];
const KEEP = [0, 2, 4, 7, 9, 12]; // which pile clips the AI keeps (their order in the cut)
const THUMB = [1, 5, 8, 10, 13]; // the clips with a thumb over the lens
const CW = 230;
const CH = 130;

/** The pile: where each clip settles (world px), its tilt, its picture and whether it is kept. */
const PILE = Array.from({ length: 14 }, (_, i) => {
  const r = (n: number) => {
    const s = Math.sin((i + 1) * n * 91.7) * 4375.85;
    return s - Math.floor(s);
  };
  const keep = KEEP.indexOf(i);
  const pic = keep >= 0 ? SHOTS[keep] : REST[(i * 3) % REST.length];
  return { pic, x: 1900 + r(1.3) * 420, y: -150 + r(2.1) * 330 + (i % 3) * 18, rot: (r(3.7) - 0.5) * 30, at: CUE.w1.drop + i * 0.07 + r(4.4) * 0.12, keep, thumb: THUMB.includes(i), dur: 2 + Math.floor(r(5.1) * 9), pan: r(6.3) };
});

export const TL = { x: 1900, y: 420, w: 1300 }; // the timeline (world px)
const TRACK = { x: TL.x + 128, w: 1152 }; // the tracks' left edge and width
const SLOT = TRACK.w / 6;
const ROW = { ruler: 26, video: 80, cap: 44, music: 44, gap: 10 };
export const VID = { x: 2348, y: -420, w: 405, h: 720 }; // the 9:16 reel: rises out of the pile, centred over the timeline
const WORDS = ['and', "that's", 'the', 'whole', 'trick'];
const CUT_TITLES = ['Game day', 'Touchdown', 'Season 26', 'Tryouts', 'Saturday', 'Go Gators'];
const PLAY_END = CUE.w1.out;
const playAt = (t: number) => tw(t, CUE.w1.play, PLAY_END, 0, 1, (n) => n);

/** A clip's picture, playing: a slow push and drift, so the pile is footage, not tiles. */
const Footage = ({ pic, t, seed, w, h, thumb = false }: { pic: string; t: number; seed: number; w: number; h: number; thumb?: boolean }) => (
  <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: 'var(--object-ink)' }}>
    <Img
      src={photo(pic)}
      style={{
        position: 'absolute', inset: 0, width: w, height: h, objectFit: 'cover', objectPosition: `50% ${30 + seed * 30}%`,
        transform: `scale(${1.12 + 0.05 * Math.sin(t * 0.7 + seed * 6)}) translateX(${Math.sin(t * 0.5 + seed * 9) * 3}%)`,
      }}
    />
    {thumb ? (
      // mostly your thumb: a soft, out-of-focus finger over a corner of the lens
      <i style={{ position: 'absolute', left: '-22%', bottom: '-48%', width: '70%', height: '120%', borderRadius: '50%', background: 'var(--object-coral)', filter: 'blur(9px) saturate(0.7)', opacity: 0.95 }} />
    ) : null}
  </div>
);

/** One clip: free fall, settle on landing, then (if kept) an arc into its timeline slot. */
const Clip = ({ c, t }: { c: (typeof PILE)[number]; t: number }) => {
  const fallT = Math.max(0, t - c.at);
  const H = 1100; // drop height
  const g = 5200; // px/s², snappy cartoon gravity
  const tLand = Math.sqrt((2 * H) / g);
  let y = c.y - H + 0.5 * g * fallT * fallT;
  let squash = 1;
  if (fallT >= tLand) {
    const settle = sp(t, c.at + tLand, 'bouncy');
    y = c.y - 22 * Math.sin(Math.PI * Math.min(1, settle)) * (1 - settle);
    squash = 1 - 0.07 * Math.max(0, 1 - (t - c.at - tLand) * 8);
  }
  let x = c.x;
  let rot = c.rot * Math.min(1, fallT / tLand);
  let w = CW;
  let h = CH;
  let o = fallT > 0 ? 1 : 0;
  const fly = c.keep >= 0 ? tw(t, CUE.w1.fly + c.keep * 0.09, CUE.w1.fly + 0.8 + c.keep * 0.09, 0, 1, EASE.move) : 0;
  if (fly > 0) {
    const tx = TRACK.x + c.keep * SLOT + 3;
    const ty = TL.y + 16 + ROW.ruler + ROW.gap + 2;
    x = lerp(c.x, tx, fly);
    y = lerp(c.y, ty, fly) - Math.sin(Math.PI * fly) * 200; // an arc, not a slide
    rot = lerp(c.rot, 0, fly);
    w = lerp(CW, SLOT - 6, fly);
    h = lerp(CH, ROW.video - 4, fly);
  }
  if (c.keep < 0) o *= 1 - tw(t, CUE.w1.fly + 0.2, CUE.w1.fly + 1.2, 0, 1, EASE.exit); // the rest leave
  if (o <= 0.001) return null;
  return (
    <div
      style={{
        position: 'absolute', left: x, top: y, width: w, height: h, opacity: o, borderRadius: 10, overflow: 'hidden',
        transform: `rotate(${rot}deg) scaleY(${squash})`, boxShadow: 'var(--shadow-md)', border: '3px solid var(--bg-0)', background: 'var(--object-ink)',
      }}
    >
      <Footage pic={c.pic} t={t} seed={c.pan} w={w} h={h} thumb={c.thumb} />
      <span style={{ position: 'absolute', right: 8, bottom: 6, padding: '1px 7px', borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 15, color: 'var(--object-grey)', background: 'var(--object-ink)', opacity: 0.85 * (1 - fly) }}>
        0:{String(c.dur).padStart(2, '0')}
      </span>
    </div>
  );
};

const Label = ({ children }: { children: string }) => <span style={{ width: 96, flex: 'none', color: 'var(--fg-1)', fontSize: 20, fontWeight: 600 }}>{children}</span>;

export const WowVideo = () => {
  const t = useT();
  if (t < 5.5 || (t > 18.8 && t < 46) || t > 54.2) return null;
  const ring = tw(t, CUE.w1.ring, CUE.w1.ring + 1.3, 0, 1, EASE.move);
  const ringOut = tw(t, CUE.w1.fly + 0.1, CUE.w1.fly + 0.5);
  const tl = sp(t, CUE.w1.fly - 0.3, 'calm');
  const vid = sp(t, CUE.w1.play - 0.5, 'snappy');
  const play = playAt(t);
  const shot = Math.min(SHOTS.length - 1, Math.floor(play * SHOTS.length));
  const count = sp(t, CUE.w1.count, 'snappy') * (1 - tw(t, CUE.w1.ring - 0.3, CUE.w1.ring));
  const head = TRACK.x - TL.x + play * TRACK.w; // the playhead, from the panel's left edge
  return (
    <>
      {/* the timeline: rises in under the pile as the AI starts cutting */}
      <div
        style={{
          position: 'absolute', left: TL.x, top: TL.y, width: TL.w, opacity: tl, transform: `translateY(${(1 - tl) * 40}px)`,
          background: 'var(--bg-1)', borderRadius: 18, boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-subtle)', padding: '16px 20px 18px',
        }}
      >
        <div style={{ position: 'relative', height: ROW.ruler, marginLeft: 108, color: 'var(--fg-1)', fontSize: 18, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} style={{ position: 'absolute', left: i * SLOT - (i ? 22 : 0) }}>0:{String(i * 2).padStart(2, '0')}</span>
          ))}
        </div>
        {(['Video', 'Captions', 'Music'] as const).map((name, row) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: ROW.gap, height: [ROW.video, ROW.cap, ROW.music][row] }}>
            <Label>{name}</Label>
            <div style={{ position: 'relative', flex: 1, height: '100%', background: 'var(--bg-2)', borderRadius: 8, overflow: 'hidden' }}>
              {row === 1
                ? // a caption chip lands on the track as each word appears in the reel
                  WORDS.map((w, i) => {
                    const at = CUE.w1.cap + i * 0.28;
                    const k = sp(t, at, 'snappy');
                    return (
                      <span key={w} style={{ position: 'absolute', left: playAt(at) * TRACK.w, top: 7, height: 30, padding: '0 10px', display: 'grid', placeItems: 'center', borderRadius: 6, fontSize: 17, fontWeight: 700, color: 'var(--object-ink)', background: 'var(--object-lilac)', opacity: k, transform: `scaleX(${0.6 + 0.4 * k})`, transformOrigin: '0 50%' }}>
                        {w}
                      </span>
                    );
                  })
                : null}
              {row === 2
                ? Array.from({ length: 62 }, (_, i) => {
                    const grow = tw(t, 13.9 + i * 0.012, 14.25 + i * 0.012);
                    const near = Math.max(0, 1 - Math.abs(i * 18.6 + 8 - play * TRACK.w) / 60) * (play > 0 && play < 1 ? 1 : 0);
                    return <i key={i} style={{ position: 'absolute', left: 6 + i * 18.6, bottom: 5, width: 10, borderRadius: 3, background: 'var(--object-sky)', height: `${(22 + ((i * 37) % 66)) * grow * (1 + 0.25 * near)}%`, opacity: 0.75 + 0.25 * near }} />;
                  })
                : null}
            </div>
          </div>
        ))}
        {/* the playhead */}
        <i style={{ position: 'absolute', left: head, top: 10, bottom: 10, width: 4, marginLeft: -2, borderRadius: 2, background: 'var(--accent)', opacity: play > 0 ? 1 : 0 }} />
      </div>

      {PILE.map((c, i) => <Clip key={i} c={c} t={t} />)}

      <div style={{ position: 'absolute', left: 1960, top: -215, transform: `scale(${count})`, transformOrigin: '0 100%', opacity: count > 0.01 ? 1 : 0 }}>
        <Chip>40 clips</Chip>
      </div>

      <SparkRing x={1820} y={-250} w={720} h={570} draw={ring} out={ringOut} />
      <div style={{ position: 'absolute', left: 2300, top: -310, opacity: ring > 0 ? 1 - ringOut : 0, transform: `scale(${sp(t, CUE.w1.ring, 'snappy')})`, transformOrigin: '0 100%', zIndex: 5 }}>
        <Chip ai>{t < CUE.w1.ring + 1.0 ? 'AI is watching' : 'AI is cutting'}</Chip>
      </div>

      {/* the 9:16 reel that plays the cut */}
      <div style={{ position: 'absolute', left: VID.x, top: VID.y - 36, opacity: vid, transform: `translateY(${(1 - vid) * 50}px) scale(${0.94 + 0.06 * vid})`, transformOrigin: '50% 100%' }}>
        <span style={{ display: 'block', marginBottom: 8, fontSize: 22, fontWeight: 600, color: 'var(--fg-1)' }}>Reel 9:16</span>
        <div style={{ position: 'relative', width: VID.w, height: VID.h, borderRadius: 16, overflow: 'hidden', background: 'var(--object-ink)', boxShadow: 'var(--shadow-lg)' }}>
          {/* the cut: one shot per kept clip, hard cuts, each with a slow push */}
          <Img
            src={photo(SHOTS[shot])}
            style={{ position: 'absolute', inset: 0, width: VID.w, height: VID.h, objectFit: 'cover', transform: `scale(${1.04 + 0.08 * ((play * SHOTS.length) % 1)})` }}
          />
          <span style={{ position: 'absolute', left: 24, top: 24, display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            <i style={{ width: 40, height: 40, borderRadius: '8px 999px 8px 999px', background: 'var(--object-green)' }} />
            <b style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--bg-0)', textShadow: '0 2px 12px var(--object-ink)' }}>{CUT_TITLES[shot]}</b>
          </span>
          <div style={{ position: 'absolute', left: 24, right: 24, bottom: 110, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 14px' }}>
            {WORDS.map((w, i) => {
              const at = CUE.w1.cap + i * 0.28;
              const on = sp(t, at, 'snappy');
              const live = t >= at && t < at + 0.28;
              return (
                <span key={i} style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 58, letterSpacing: '-0.02em', color: live ? 'var(--object-yellow)' : 'var(--bg-0)', opacity: on, transform: `translateY(${(1 - on) * 18}px) scale(${live ? 1.08 : 1})`, textShadow: '0 3px 16px var(--object-ink)' }}>
                  {w}
                </span>
              );
            })}
          </div>
          {/* the reel's own progress bar */}
          <i style={{ position: 'absolute', left: 24, bottom: 40, height: 6, width: (VID.w - 48) * play, borderRadius: 3, background: 'var(--bg-0)', opacity: 0.9 }} />
        </div>
      </div>
    </>
  );
};
