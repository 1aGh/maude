// client/v2/timeline/timeline-empty.jsx — S7.7 (05 · es-timeline): a video artboard with no clips.
//
// "The timeline arrives with the video artboard — empty, but pointed." The situation, the one next step, and
// the one AI chip, all through the S11.1 kit by copy id (`es-timeline.timeline-none`). The track itself is
// the drop zone (the panel's own drop handler stays on its root); the chip offers to cut from footage the
// project already has, and PRE-FILLS the chat — it never sends.

import { isNativeApp } from '../../github.js';
import { useAssets } from '../assets/use-assets.js';
import { AskButton, copy, Empty } from '../empty/index.js';
import { getPaletteEnv } from '../search/search-env.js';
import { TGlyph } from './glyphs.jsx';

/**
 * The footage the project already has, in the words the line needs: how many clips and where from (the folder
 * most of them sit in).
 * @param {Array<{ kind?: string, path?: string }>|null|undefined} rows the Assets tab's rows
 * @returns {{ count: number, source: string }}
 */
export function footageHint(rows) {
  const videos = (rows ?? []).filter((r) => r?.kind === 'video' && typeof r.path === 'string');
  const byFolder = new Map();
  for (const v of videos) {
    const parts = v.path.split('/');
    const folder = parts.length > 1 ? parts[parts.length - 2] : '';
    byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1);
  }
  let source = '';
  let best = 0;
  for (const [folder, n] of byFolder) {
    if (folder && n > best) {
      best = n;
      source = folder;
    }
  }
  return { count: videos.length, source: source || 'this project' };
}

/**
 * The words for the block: the copy table's, with the "N clips are ready in Assets" sentence left out when
 * there are none (a claim about footage that is not there would be a lie).
 */
export function timelineEmptyWords({ artboard, rows }) {
  const hint = footageHint(rows);
  const words = copy('es-timeline.timeline-none', {
    artboard,
    count: hint.count,
    source: hint.source,
  });
  const next = hint.count > 0 ? words.next : words.next.split(/(?<=\.)\s/)[0];
  return { title: words.title, next, action: words.action, hint };
}

/** The prompt the chip pre-fills (the person presses send). */
export function cutPrompt({ artboard, source }) {
  return `Cut 15 s for ${artboard} from the clips in ${source}.`;
}

/**
 * @param {{ artboard: string, canAsk?: boolean }} props `canAsk`: the AI chat exists here (the desktop app) and
 *   the role may edit; elsewhere the block shows the situation and the drop, no chip.
 */
export function TimelineEmpty({ artboard, canAsk = isNativeApp() }) {
  const { assets } = useAssets();
  const w = timelineEmptyWords({ artboard, rows: assets });
  // 05 es-timeline: the empty comp keeps the timeline's anatomy — a ruler, ONE drop track holding the line and the
  // chip, then the Captions and Music lanes the cut would fill. The ticks are the board's 0:00–0:30 axis.
  return (
    <div className="tl-kit-wrap" data-testid="timeline-empty-comp">
      <div className="tl-kit-ruler" aria-hidden="true" data-testid="timeline-empty-ruler">
        {RULER_TICKS.map((t) => (
          <i key={t}>{t}</i>
        ))}
      </div>
      <div className="tl-kit-drop" data-testid="timeline-empty-drop">
        <span className="tl-kit-drop-ic" aria-hidden="true">
          <TGlyph name="video" size={18} />
        </span>
        <Empty
          size="panel"
          align="left"
          className="tl-kit"
          testid="timeline-empty-kit"
          title={w.title}
          next={w.next}
        />
        {canAsk && w.hint.count > 0 ? (
          <AskButton
            testid="timeline-empty-ask"
            onClick={() => getPaletteEnv().askAI(cutPrompt({ artboard, source: w.hint.source }))}
          >
            {w.action}
          </AskButton>
        ) : null}
      </div>
      <div className="tl-kit-lane" data-testid="timeline-empty-lane-captions">
        <TGlyph name="type" size={12} />
        Captions
      </div>
      <div className="tl-kit-lane" data-testid="timeline-empty-lane-music">
        <TGlyph name="music" size={12} />
        Music
      </div>
    </div>
  );
}

const RULER_TICKS = ['0:00', '0:05', '0:10', '0:15', '0:20', '0:25', '0:30'];
