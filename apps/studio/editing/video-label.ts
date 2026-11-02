// editing/video-label.ts — P8 round 7 (07 · M1): what a video artboard's label says after its name.
//
// The board draws "Hype trailer · Reels · 0:14" with a size chip ("1080 × 1920") once it is selected. The name is
// the author's own text; the format and the length are read off the comp the page registered, so they never go
// stale. Pure: no DOM, no IO.

export interface VideoLabelFacts {
  fps: number;
  durationInFrames: number;
  /** the comp's output size, px */
  width: number;
  height: number;
}

export interface VideoLabelParts {
  /** "Reels", "16:9", "1:1", "4:5" — '' when the label says it already or the ratio is not a plain one */
  format: string;
  /** "0:14" — whole seconds, FLOOR (the Length row, the readout and the ruler all floor) — '' when the label has one */
  length: string;
  /** "1080 × 1920" — the chip; '' when the label already carries a size */
  dims: string;
}

const pos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const SIZE_IN_LABEL = /\d+\s*[×x]\s*\d+/i;
const CLOCK_IN_LABEL = /\b\d+:\d\d\b/;

/** The format's short word: the catalogue's own presets by name, else the reduced ratio when it is a plain one. */
function formatWord(w: number, h: number): string {
  if (w === 1080 && h === 1920) return 'Reels';
  const g = gcd(Math.round(w), Math.round(h));
  const a = Math.round(w) / g;
  const b = Math.round(h) / g;
  if (a > 21 || b > 21) return '';
  return `${a}:${b}`;
}

export function mssFloor(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds + 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function videoLabelParts(label: string, c: VideoLabelFacts): VideoLabelParts {
  const text = String(label ?? '');
  const hasSize = SIZE_IN_LABEL.test(text);
  const known = pos(c.width) && pos(c.height);
  let format = known && !hasSize ? formatWord(c.width, c.height) : '';
  if (format && text.toLowerCase().includes(format.toLowerCase())) format = '';
  if (format === 'Reels' && /reel/i.test(text)) format = '';
  const length =
    pos(c.fps) && pos(c.durationInFrames) && !CLOCK_IN_LABEL.test(text)
      ? mssFloor(c.durationInFrames / c.fps)
      : '';
  const dims = known && !hasSize ? `${Math.round(c.width)} × ${Math.round(c.height)}` : '';
  return { format, length, dims };
}

/** The text after the name: " · Reels · 0:14", and, selected, the size chip after an em space. */
export function videoLabelTail(label: string, c: VideoLabelFacts, selected: boolean): string {
  const { format, length, dims } = videoLabelParts(label, c);
  const words = [format, length].filter(Boolean).join(' · ');
  const head = words ? ` · ${words}` : '';
  if (selected && dims) return head ? `${head}  ${dims}` : ` ${dims}`;
  return head;
}
