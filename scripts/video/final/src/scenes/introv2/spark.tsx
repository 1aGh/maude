import { Cursor } from '../../../vendor/maude-v2/_kit';
import { cameraAt } from './camera';
import { EASE, lerp, tw, useT } from './motion';

/**
 * The spark: the AI's signature, one object that travels the whole film. It is the AI cursor,
 * on screen only while the AI acts (hook edit, wow 1 cut, wow 2 posts, wow 3 snap) and gone
 * while people act (the sketch, no handoff, the team, the flip). It ends as the end card's full
 * stop (b8-end lands that one itself). Keys are [t, x, y, opacity] in world px.
 */
type K = [number, number, number, number];
export const SPARK_KEYS: K[] = [
  [0, 620, 360, 0],
  [2.6, 620, 360, 0],
  [3.25, 190, 150, 1], // glides in on "Meet Maude."
  [4.95, 210, 150, 1],
  [5.05, -470, 150, 1],
  [6.05, 230, 140, 1], // runs the weight wave through "Meet Maude."
  [6.7, 2470, -240, 1], // rides the whip to the clip pile
  [11.5, 2470, -240, 1],
  [11.95, 2470, 290, 1], // draws the ring round the pile
  [12.35, 1830, 290, 1],
  [12.75, 1830, -240, 1],
  [13.1, 2250, -240, 1],
  [14.0, 2380, 400, 1], // leads the picked clips into the timeline
  [14.6, 3300, -390, 1], // to the video artboard as it plays
  [17.6, 3300, -390, 1],
  [18.3, 4720, -300, 1], // rides the whip to the photos
  [20.3, 4720, -300, 1],
  [20.65, 4995, -150, 1], // hops post to post as each one builds
  [21.0, 5285, -150, 1],
  [21.35, 4995, 140, 1],
  [21.7, 5285, 140, 1],
  [22.05, 5590, -90, 1],
  [22.4, 5850, -90, 1],
  [23.6, 5930, 270, 1],
  [27.0, 5930, 270, 1],
  [27.35, 6400, 200, 0], // leaves: the next idea is drawn by a person
  [30.7, 7090, -420, 0],
  [30.95, 7090, -390, 1], // back for the snap: round the sketch
  [31.3, 7520, -390, 1],
  [31.65, 7520, 390, 1],
  [32.2, 7470, -250, 1],
  [33.1, 7470, -250, 1],
  [33.5, 7600, -330, 0],
];

export const sparkAt = (t: number) => {
  let i = 0;
  while (i < SPARK_KEYS.length - 1 && SPARK_KEYS[i + 1][0] <= t) i++;
  const a = SPARK_KEYS[i];
  const b = SPARK_KEYS[i + 1];
  if (!b) return { x: a[1], y: a[2], o: a[3] };
  const k = tw(t, a[0], b[0], 0, 1, EASE.move);
  return { x: lerp(a[1], b[1], k), y: lerp(a[2], b[2], k), o: lerp(a[3], b[3], k) };
};

/** In world space, sized to stay readable at the camera's zoom. */
export const SparkTraveler = () => {
  const t = useT();
  const zoom = cameraAt(t).z;
  const s = sparkAt(t);
  if (s.o <= 0.001) return null;
  return (
    <div style={{ position: 'absolute', left: s.x, top: s.y, opacity: s.o, transform: `scale(${(2.6 / Math.max(zoom, 0.6)) * (0.7 + 0.3 * s.o)})`, transformOrigin: '0 0', zIndex: 50 }}>
      <Cursor name="AI" agent x={0} y={0} />
    </div>
  );
};
