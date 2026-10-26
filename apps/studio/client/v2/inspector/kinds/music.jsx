// client/v2/inspector/kinds/music.jsx — S7.12: the inspector of a song you select on the Timeline's Music track
// (07 · ve-music: "Music knows its beat and steps aside for speech").
//
//   Music   Volume · Lower under speech · Snap to the beat · Song (Change…) · Cut to the beat
//           › Advanced: bpm 120 (detected) [Half · Double] · duck −12 dB · 200 ms · gainDb −2
//
// Every write goes through the Timeline's ONE pipe (`selection.onOp` → `/_api/edit-op`, so the undo, the refusal
// and the held-by-AI rules are a clip gesture's): Volume = `video.music.volume`, Lower under speech =
// `video.music.duck`, Cut to the beat = `video.cut-to-beat`. Snap to the beat is the artboard's meta
// (`video.snap` → `PATCH /_api/present-meta`), Find the beat / Half · Double are the beats analysis
// (`video.music.beats` → `POST /_api/media-analysis`). The numbers are READ from the comp-media store the
// Timeline feeds (lanes/music-media.js) — a song's beats and dip are derived, never typed in here.

import { SliderField, Toggle } from '../../../inspector-controls.jsx';
import { shellToast } from '../../../shell/util.js';
import { AdvancedFold } from '../../fold/advanced-fold.jsx';
import { refusalText } from '../../timeline/clip-verb.js';
import { TGlyph } from '../../timeline/glyphs.jsx';
import {
  findBeats,
  isFinding,
  mediaOf,
  musicEntry,
  saveSnap,
  storedSnap,
  useMusicVersion,
} from '../../timeline/lanes/music-media.js';
import {
  bpmValue,
  cutToBeatParams,
  cutToBeatWords,
  duckValue,
  gainDbValue,
  halfDouble,
  hasClearBeat,
  MUSIC_WORDS,
  snapMode,
  volumePercent,
} from '../../timeline/lanes/music-model.js';
import { Quiet, Row } from '../sections/row.jsx';
import { registerSlot } from '../slots.js';
import { registerKind, singleOf } from './index.js';
import { LengthRow, SpeedRow } from './clip.jsx';

const timelineOf = (selection) => singleOf(selection)?.timeline ?? null;

registerKind({
  id: 'music',
  label: 'Music',
  order: 3,
  match: (s) => timelineOf(s)?.kind === 'music',
  sections: ['music'],
  Advanced: MusicAdvanced,
  advancedHint: () => '3 properties',
});

/** What the lane knows about the selected song (re-reads when the media or a choice changes). */
function useSong(t) {
  useMusicVersion();
  return t ? musicEntry(t.canvas, t.artboardId, t.stableId) : null;
}

const musicOf = (t) => mediaOf(t.canvas, t.artboardId)?.music ?? [];

/** Half · Double · Find the beat all run the same analysis; a refusal is said once, in words. */
async function reanalyse(t, info, bpm) {
  const r = await findBeats({ canvas: t.canvas, artboardId: t.artboardId, src: info.src, bpm });
  if (!r.ok && r.message) shellToast(r.message);
}

/** Cut to the beat: the cuts roll to the music's beats; the video stays the same length. */
export async function runCutToBeat(t) {
  const sources = (await t.probeSources?.()) ?? {};
  const params = cutToBeatParams({ music: musicOf(t), sources });
  if (!params.beats.length) {
    shellToast(MUSIC_WORDS.noBeatYet);
    return null;
  }
  const r = await t.onOp('cut-to-beat', params, { quiet: true });
  if (r?.ok) shellToast(cutToBeatWords(r.detail), true);
  else if (r) shellToast(`${MUSIC_WORDS.cutToBeat} refused — ${refusalText(r)}`);
  return r;
}

// ── the rows ─────────────────────────────────────────────────────────────────────────────────────────────
function VolumeRow({ t, info }) {
  const v = info ? info.volume : (t.seq.mediaProps?.volume ?? 1);
  return (
    <Row k={MUSIC_WORDS.volume} name="music-volume">
      <span data-testid="insp-music-volume">
        <SliderField
          value={volumePercent(v)}
          min={0}
          max={100}
          step={5}
          unit="%"
          ariaLabel="Music volume"
          onCommit={(n) => t.onOp('music.volume', { volume: Math.round(n) / 100 })}
        />
      </span>
    </Row>
  );
}

function DuckRow({ t, info }) {
  return (
    <Row k={MUSIC_WORDS.duck} name="music-duck">
      <span data-testid="insp-music-duck">
        <Toggle
          checked={!!info?.duck}
          ariaLabel={MUSIC_WORDS.duck}
          onChange={(on) => t.onOp('music.duck', on ? {} : { off: true })}
        />
      </span>
    </Row>
  );
}

function SnapRow({ t }) {
  const music = musicOf(t);
  const mode = snapMode(storedSnap(t.canvas, t.artboardId), music);
  const clear = music.some((m) => hasClearBeat(m.grid));
  return (
    <Row k={MUSIC_WORDS.snap} name="music-snap">
      {clear ? (
        <span data-testid="insp-music-snap">
          <Toggle
            checked={mode === 'beat'}
            ariaLabel={MUSIC_WORDS.snap}
            onChange={async (on) => {
              // on = back to the default (V2-1.10 §5.5: "beat" when absent and the song has a clear beat — the
              // only time this switch is drawn): the stored choice is taken out, never a "beat" written over it
              const r = await saveSnap(t.canvas, t.artboardId, on ? null : 'off');
              if (!r.ok) shellToast(r.message);
            }}
          />
        </span>
      ) : (
        <span className="insp-quiet" data-testid="insp-music-snap-off">
          {MUSIC_WORDS.noClearBeat}
        </span>
      )}
    </Row>
  );
}

function SongRow({ t }) {
  if (!t.changeSong) return null;
  return (
    <Row k={MUSIC_WORDS.song} name="music-song">
      <button
        type="button"
        className="btn btn--sm"
        data-testid="insp-music-change"
        onClick={() => t.changeSong()}
      >
        <TGlyph name="music" size={12} />
        {MUSIC_WORDS.change}
      </button>
    </Row>
  );
}

function BeatRows({ t, info }) {
  if (!info) return null;
  const finding = isFinding(t.canvas, info.src);
  return (
    <>
      {!info.grid ? (
        <Row k="Beat" name="music-beat">
          <button
            type="button"
            className="insp-quietlink"
            data-testid="insp-music-find"
            disabled={finding}
            onClick={() => reanalyse(t, info)}
          >
            {finding ? MUSIC_WORDS.finding : MUSIC_WORDS.findBeat}
          </button>
        </Row>
      ) : null}
      {hasClearBeat(info.grid) ? (
        <Row k={MUSIC_WORDS.cutToBeat} name="music-cut-to-beat">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="insp-music-cut-to-beat"
            onClick={() => runCutToBeat(t)}
          >
            {MUSIC_WORDS.cutToBeat}
          </button>
        </Row>
      ) : null}
    </>
  );
}

function MusicRows({ el }) {
  const t = el?.timeline;
  const info = useSong(t);
  if (!t) return null;
  return (
    <div data-testid="timeline-inspector">
      <VolumeRow t={t} info={info} />
      <DuckRow t={t} info={info} />
      <SnapRow t={t} />
      <SongRow t={t} />
      <BeatRows t={t} info={info} />
    </div>
  );
}

// ── Advanced ─────────────────────────────────────────────────────────────────────────────────────────────
function MusicAdvanced({ el, open, onToggle }) {
  const t = el?.timeline;
  const info = useSong(t);
  if (!t) return null;
  const grid = info?.grid ?? null;
  const hd = grid && hasClearBeat(grid) ? halfDouble(grid.bpm) : null;
  const fix = (bpm) => reanalyse(t, info, bpm);
  return (
    <AdvancedFold panel="inspector" hint="3 properties" open={open} onToggle={onToggle}>
      <div className="insp-adv insp-adv--music" data-testid="insp-adv-music">
        <div className="insp-css" data-testid="insp-adv-music-bpm">
          <span className="insp-css-k k-mono">bpm</span>
          <span className="insp-css-v k-mono">{bpmValue(grid)}</span>
        </div>
        {hd ? (
          <div className="insp-chips">
            <button
              type="button"
              className="insp-chip"
              data-testid="insp-music-half"
              disabled={hd.half == null}
              onClick={() => hd.half != null && fix(hd.half)}
            >
              {MUSIC_WORDS.half}
            </button>
            <button
              type="button"
              className="insp-chip"
              data-testid="insp-music-double"
              disabled={hd.double == null}
              onClick={() => hd.double != null && fix(hd.double)}
            >
              {MUSIC_WORDS.double}
            </button>
          </div>
        ) : null}
        <div className="insp-css" data-testid="insp-adv-music-duck">
          <span className="insp-css-k k-mono">duck</span>
          <span className="insp-css-v k-mono">{duckValue(info?.duck ?? null)}</span>
        </div>
        <div className="insp-css" data-testid="insp-adv-music-gain">
          <span className="insp-css-k k-mono">gainDb</span>
          <span className="insp-css-v k-mono">
            {gainDbValue(info ? info.volume : (t.seq.mediaProps?.volume ?? 1))}
          </span>
        </div>
        {!t.loose ? (
          <div className="insp-adv-g" data-testid="insp-adv-music-clip">
            <p className="insp-adv-h insp-sub">
              <span>Clip</span>
            </p>
            <LengthRow t={t} />
            <SpeedRow t={t} />
          </div>
        ) : (
          <Quiet testid="insp-adv-music-bed">
            This song plays under the whole video — its length follows the video.
          </Quiet>
        )}
      </div>
    </AdvancedFold>
  );
}

// ── the slot ─────────────────────────────────────────────────────────────────────────────────────────────
export const MUSIC_SLOTS = Object.freeze([
  ['music', { id: 'music.rows', order: 10, kinds: ['music'], title: 'Music', Body: MusicRows }],
]);

/** @returns {() => void} take the Music section back out of the registry */
export function registerMusicSlots() {
  const offs = MUSIC_SLOTS.map(([section, entry]) => registerSlot(section, entry));
  return () => {
    for (const off of offs) off();
  };
}

export const offMusic = registerMusicSlots();
