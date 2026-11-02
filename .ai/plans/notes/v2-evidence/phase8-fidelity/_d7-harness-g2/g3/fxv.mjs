// Round 9 (p8-c9-video): the three video fixtures the 07 / 06 boards need and the e2e project does not have.
//   HypeFormats    one cut, THREE formats (Reels 9:16 · 16:9 · 1:1 mount the same comp) - the Formats list, link badges,
//                  "Shared by 3 formats", the Re-frame window's format pills, the Export sheet's three-format grid.
//   NaborKeyframes a 16:9 cut with a TITLE that animates with interpolate(frame, [a, b], [x, y]) + Easing.bezier - the
//                  diamonds on the title clip, the Easing card's curve (07 ve-advanced, 06 ad-timeline).
//   ZapasLong      a 4:12 match: 40 clips, 18 titles, 6 graphics, a song, four ruler markers (07 ve-long).
// They are written into a copy of the Alligators fixture (fx3.alli), so every other canvas stays available.
import { copyFileSync, cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { alli } from './fx3.mjs';

const PHOTOS = ['0fce52c7.jpg', '12bb32b7.jpg', '4282d546.jpg', '431f956e.jpg', '16ebea35.jpg', '548455b9.jpg'];
const CTX = 'import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";';

const text = (s) => JSON.stringify(s);
const title = (from, dur, words, y = 0.72) =>
  `    <Sequence from={${from}} durationInFrames={${dur}}>\n      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: ${Math.round(y * 100)}, color: "#fff", fontWeight: 800, fontSize: 64, textShadow: "0 2px 12px #0008" }}>{${text(words)}}</AbsoluteFill>\n    </Sequence>`;
const gfx = (name, from, dur, words) =>
  `    <Sequence name="${name}" from={${from}} durationInFrames={${dur}}>\n      <AbsoluteFill style={{ alignItems: "flex-start", justifyContent: "flex-start", padding: 32 }}><div style={{ background: "#e8f34a", color: "#111", padding: "6px 14px", fontWeight: 700, fontSize: 28 }}>${words}</div></AbsoluteFill>\n    </Sequence>`;
const beat = (name, dur, photo) =>
  `      <TransitionSeries.Sequence name="${name}" durationInFrames={${dur}}>\n        <Img src="assets/${photo}" style={{ width: "100%", height: "100%", objectFit: "cover" }} />\n      </TransitionSeries.Sequence>`;

// ── HypeFormats: 15 s, six beats, four titles, two graphics, the song ─────────────────────────────────────────────
const HYPE_BEATS = [['Tunel', 0], ['Tackle', 1], ['Touchdown', 2], ['Dron-nad-lajnou', 3], ['Oslava', 4], ['Logo', 5]];
function hypeFormats() {
  return `/**
 * @canvas   hype-formats · one 0:15 cut in three formats (round 9 harness fixture: the 07 ve-formats / ve-reframe / ve-fullscreen states)
 */
${CTX}
import { AbsoluteFill, Audio, Img, Sequence } from "remotion";
import { TransitionSeries } from "@remotion/transitions";

const TOTAL = 450;
const FPS = 30;

const Hype = () => (
  <AbsoluteFill style={{ background: "#101014" }}>
    <TransitionSeries>
${HYPE_BEATS.map(([n, i]) => beat(n, 75, PHOTOS[i])).join('\n')}
    </TransitionSeries>
${title(45, 60, 'DŘINA')}
${title(105, 75, 'RYCHLOST')}
${title(255, 90, 'SRDCE')}
${title(345, 90, 'STAŇ SE ALLIGATOREM')}
${gfx('logo-v-rohu', 0, 360, 'Alligators')}
${gfx('url-alligators-cz', 370, 80, 'alligators.cz/nabor')}
    <Audio src="assets/song.mp3" volume={0.8} />
  </AbsoluteFill>
);

export default function HypeFormats() {
  return (
    <DesignCanvas>
      <DCSection id="hype" title="Hype trailer">
        <DCArtboard id="reels" kind="video" label="Hype trailer · Reels · 0:15" width={1080} height={1920}>
          <VideoComp component={Hype} durationInFrames={TOTAL} fps={FPS} width={1080} height={1920} />
        </DCArtboard>
        <DCArtboard id="wide" kind="video" label="Hype trailer · 16:9 · 0:15" width={1920} height={1080}>
          <VideoComp component={Hype} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
        </DCArtboard>
        <DCArtboard id="square" kind="video" label="Hype trailer · 1:1 · 0:15" width={1080} height={1080}>
          <VideoComp component={Hype} durationInFrames={TOTAL} fps={FPS} width={1080} height={1080} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
}

// ── NaborKeyframes: a title that slides up and fades (interpolate + a bezier), over three beats and a song ─────────
function naborKeyframes() {
  return `/**
 * @canvas   nabor-keyframes · a 0:10 cut whose title is animated with interpolate(frame, …) + Easing.bezier (round 9 harness fixture)
 */
${CTX}
import { AbsoluteFill, Audio, Easing, Img, Sequence, interpolate, useCurrentFrame } from "remotion";
import { TransitionSeries } from "@remotion/transitions";

const TOTAL = 300;
const FPS = 30;

const Headline = () => {
  const frame = useCurrentFrame();
  const y = interpolate(frame, [0, 12], [48, 0], { easing: Easing.bezier(0.22, 1, 0.36, 1), extrapolateRight: "clamp" });
  const opacity = interpolate(frame, [0, 12], [0, 1], { easing: Easing.bezier(0.22, 1, 0.36, 1), extrapolateRight: "clamp" });
  const out = interpolate(frame, [96, 108], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "flex-start", justifyContent: "flex-start", padding: 96 }}>
      <div style={{ transform: "translateY(" + y + "px)", opacity: opacity * out, color: "#8be28b", fontWeight: 800, fontSize: 120, letterSpacing: 2 }}>NAUČÍME TĚ HRÁT</div>
    </AbsoluteFill>
  );
};

const Nabor = () => (
  <AbsoluteFill style={{ background: "#101014" }}>
    <TransitionSeries>
${[['Kabina', 0], ['Rozhovor', 1], ['Trenink-v-hale', 2]].map(([n, i]) => beat(n, 100, PHOTOS[i])).join('\n')}
    </TransitionSeries>
    <Sequence from={30} durationInFrames={108}>
      <Headline />
    </Sequence>
    <Audio src="assets/song.mp3" volume={0.8} />
  </AbsoluteFill>
);

export default function NaborKeyframes() {
  return (
    <DesignCanvas>
      <DCSection id="nabor" title="Nábor trailer">
        <DCArtboard id="nabor" kind="video" label="Nábor trailer · 16:9 · 0:10" width={1920} height={1080}>
          <VideoComp component={Nabor} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
}

// ── ZapasLong: 252 s = 40 clips of 189 frames, 18 titles, 6 graphics, a song ───────────────────────────────────────
function zapasLong() {
  const beats = Array.from({ length: 40 }, (_, i) => beat(`Akce-${i + 1}`, 189, PHOTOS[i % PHOTOS.length]));
  const titles = Array.from({ length: 18 }, (_, i) => title(i * 420 + 60, 150, i % 3 === 0 ? `BRNO ${10 + i} : ${7 + i}` : `Akce číslo ${i + 1}`));
  const gfxs = Array.from({ length: 6 }, (_, i) => gfx(`logo-bug-${i + 1}`, i * 1200 + 100, 240, 'Alligators'));
  return `/**
 * @canvas   zapas-long · a whole match: 40 clips, 18 titles, 6 graphics, a song, four markers (round 9 harness fixture: 07 ve-long)
 */
${CTX}
import { AbsoluteFill, Audio, Img, Sequence } from "remotion";
import { TransitionSeries } from "@remotion/transitions";

const TOTAL = 7560;
const FPS = 30;

const Zapas = () => (
  <AbsoluteFill style={{ background: "#101014" }}>
    <TransitionSeries>
${beats.join('\n')}
    </TransitionSeries>
${titles.join('\n')}
${gfxs.join('\n')}
    <Audio src="assets/song.mp3" volume={0.8} />
  </AbsoluteFill>
);

export default function ZapasLong() {
  return (
    <DesignCanvas>
      <DCSection id="zapas" title="Zápas · Prague Lions">
        <DCArtboard id="zapas" kind="video" label="Zápas · Prague Lions · sestřih · 4:12" width={1920} height={1080}>
          <VideoComp component={Zapas} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
}

const meta = (extra = {}) => JSON.stringify({ designSystem: 'Alligators', ...extra }, null, 2);
const sec = (s) => Math.round(s * 30);

export async function vid() {
  const d = await alli();
  const ui = join(d, '.design/ui');
  const assets = join(d, '.design/assets');
  mkdirSync(ui, { recursive: true });
  // the song + its beat grid (the e2e fixture's committed 120 BPM sidecar)
  if (!existsSync(join(assets, 'song.mp3'))) {
    const src = existsSync(join(assets, 'music.mp3')) ? 'music.mp3' : 'song.mp3';
    if (src !== 'song.mp3') copyFileSync(join(assets, src), join(assets, 'song.mp3'));
  }
  const put = (name, body, m) => {
    writeFileSync(join(ui, `${name}.tsx`), body);
    writeFileSync(join(ui, `${name}.meta.json`), m);
  };
  put('HypeFormats', hypeFormats(), meta());
  put('NaborKeyframes', naborKeyframes(), meta());
  put(
    'ZapasLong',
    zapasLong(),
    meta({
      artboardMeta: {
        zapas: {
          markers: [
            { frame: sec(14), name: 'Výkop' },
            { frame: sec(44), name: 'TD 1' },
            { frame: sec(98), name: 'Poločas' },
            { frame: sec(202), name: 'TD 2' },
          ],
        },
      },
    })
  );
  return d;
}
