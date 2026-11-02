// S7.17 — the caption word lock (07 · ve-together): Tereza's word is hers until she leaves it.
//
//   canvas   createTimelinePublisher: my playhead (throttled) and my word (at once, cleared when I leave it);
//            timelinePeersPayload: teammates' heads + words, from SANITIZED awareness, capped
//   bridge   `timeline-peers` (c2s, active frame only) and `timeline-word` (s2c, parent only), junk refused whole
//   shell    the lane believes the active canvas only; a clip op on the clip showing her word answers `locked`
//            with nothing sent; a fix / a cut by transcript on her word answers `locked`; another word, another
//            clip, go through; the Transcript panel will not open her word; the lane wears her ring; the island
//            draws her thin sky line and "Tereza is fixing a caption"
//
// Advisory between people (Gate 0 A10, V2-1.15 §13): no server refuses on it, so every refusal here is the UI's.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import {
  createTimelinePublisher,
  HEAD_THROTTLE_MS,
  timelinePeersPayload,
} from '../collab/timeline-presence.tsx';
import { sanitizeForeignState } from '../use-collab.tsx';
import { A, FILE, install, mediaOf, source, video, WORDS } from './_captions-harness.ts';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
let off = () => {};
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  off();
  off = () => {};
  const { timelinePeers } = await import('../client/v2/timeline/peers.jsx');
  timelinePeers.reset();
});

const CAPTIONS = '    <Captions data-cd-id="captions" words="line" position="bottom" />';
const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

/** The comp's words as shown (their keys name src|wordId|clip). */
function shownWords() {
  const v = video({ transcripts: { [A]: { words: WORDS } } });
  v.source = source(CAPTIONS);
  return {
    v,
    words: mediaOf(v).words as Array<{ wordId: string; src: string; clip: string; f0: number }>,
  };
}
const keyOf = (w: { src: string; wordId: string; clip: string }) =>
  `${w.src}|${w.wordId}|${w.clip}`;

// ── the canvas side ─────────────────────────────────────────────────────────────────────────────────

describe('the canvas publisher', () => {
  function rig() {
    let t = 1_000;
    const timers: Array<{ at: number; fn: () => void } | null> = [];
    const sent: Array<Record<string, unknown>> = [];
    const pub = createTimelinePublisher({
      publish: (p) => sent.push(p),
      now: () => t,
      setTimer: (fn, ms) => timers.push({ at: t + ms, fn }) - 1,
      clearTimer: (id) => {
        timers[id as number] = null;
      },
    });
    const advance = (ms: number) => {
      t += ms;
      for (let i = 0; i < timers.length; i++) {
        const x = timers[i];
        if (x && x.at <= t) {
          timers[i] = null;
          x.fn();
        }
      }
    };
    return { pub, sent, advance };
  }

  test('a moving playhead goes out at most every HEAD_THROTTLE_MS, the last frame always lands', () => {
    const { pub, sent, advance } = rig();
    pub.head('reel', 0);
    pub.head('reel', 3);
    pub.head('reel', 6);
    expect(sent).toEqual([{ timeline: { artboardId: 'reel', frame: 0 } }]);
    advance(HEAD_THROTTLE_MS);
    expect(sent.at(-1)).toEqual({ timeline: { artboardId: 'reel', frame: 6 } });
    pub.head('reel', 6);
    advance(HEAD_THROTTLE_MS);
    expect(sent).toHaveLength(2); // nothing new, nothing sent
    pub.head(null, null);
    expect(sent.at(-1)).toEqual({ timeline: null }); // leaving the video is said at once
  });

  test('a word is published at once, once, and cleared when I leave it', () => {
    const { pub, sent } = rig();
    pub.word('reel', 'assets/a.mp4|w1|a');
    pub.word('reel', 'assets/a.mp4|w1|a');
    expect(sent).toEqual([
      {
        editing: {
          since: 1_000,
          kind: 'caption-word',
          artboardId: 'reel',
          wordKey: 'assets/a.mp4|w1|a',
        },
      },
    ]);
    pub.word(null);
    expect(sent.at(-1)).toEqual({ editing: null });
    pub.word('reel', 'not a key');
    expect(sent).toHaveLength(2); // a bad key is no word: still cleared, nothing new
  });

  test('timelinePeersPayload: teammates with a head or a word, from sanitized awareness only', () => {
    const peers = [
      sanitizeForeignState(1, {
        name: 'Tereza',
        timeline: { artboardId: 'reel', frame: 222 },
        editing: { since: 5, kind: 'caption-word', artboardId: 'reel', wordKey: 'a|w1|c' },
      }),
      sanitizeForeignState(2, { name: 'Jonas', timeline: { artboardId: 'reel', frame: 'x' } }),
      sanitizeForeignState(3, { name: 'Vera', timeline: { artboardId: 'other', frame: 9 } }),
    ].filter((p) => p !== null);
    expect(timelinePeersPayload(peers)).toEqual([
      { clientID: 1, name: 'Tereza', artboardId: 'reel', frame: 222, word: 'a|w1|c' },
      { clientID: 3, name: 'Vera', artboardId: 'other', frame: 9 },
    ]);
  });
});

// ── the bridge rows ─────────────────────────────────────────────────────────────────────────────────

describe('the bridge rows', () => {
  const { c2s, s2c } = DGN_TABLE;
  test('timeline-peers: a good list passes; a bad entry or an oversized list refuses the message', () => {
    const ok = {
      peers: [{ clientID: 1, name: 'Tereza', artboardId: 'reel', frame: 7, word: 'a|w1|c' }],
    };
    expect(c2s['timeline-peers'].parse(ok)).toEqual(ok);
    const bad = (p: Record<string, unknown>) => ({ peers: [{ ...ok.peers[0], ...p }] });
    expect(c2s['timeline-peers'].parse(bad({ frame: 1.5 }))).toBeNull();
    expect(c2s['timeline-peers'].parse(bad({ word: 'a|b\u0000|c' }))).toBeNull();
    expect(c2s['timeline-peers'].parse(bad({ artboardId: '../x' }))).toBeNull();
    expect(c2s['timeline-peers'].parse(bad({ name: 'x'.repeat(65) }))).toBeNull();
    expect(c2s['timeline-peers'].parse({ peers: Array(33).fill(ok.peers[0]) })).toBeNull();
    expect(c2s['timeline-peers'].parse(bad({ html: '<img>' }))).toEqual(ok); // unknown keys stripped
    expect(c2s['timeline-peers'].gate).toBe('active');
  });
  test('timeline-word: an artboard + a word key, or a clear', () => {
    expect(s2c['timeline-word'].parse({ artboardId: 'reel', wordKey: 'a|w1|c' })).toEqual({
      artboardId: 'reel',
      wordKey: 'a|w1|c',
    });
    expect(s2c['timeline-word'].parse({ artboardId: null })).toEqual({ artboardId: null });
    expect(s2c['timeline-word'].parse({ artboardId: 'reel', wordKey: 'x'.repeat(600) })).toBeNull();
    expect(s2c['timeline-word'].gate).toBe('parent');
  });
});

// ── the shell side ──────────────────────────────────────────────────────────────────────────────────

describe('the shell lane believes the active canvas only', () => {
  test('the active frame sets the teammates; another frame, another origin, junk do not', async () => {
    const { createPeersLane } = await import('../client/v2/timeline/peers.jsx');
    const active = {} as Window;
    const other = {} as Window;
    const set: unknown[] = [];
    const lane = createPeersLane({
      canvasOrigin: () => 'http://canvas.test',
      activeWin: () => active,
      store: { set: (p: unknown[]) => set.push(p) },
    });
    const msg = {
      dgn: 'timeline-peers',
      peers: [{ clientID: 1, name: 'Tereza', artboardId: 'reel', frame: 3 }],
    };
    lane.onMessage({ data: msg, origin: 'http://canvas.test', source: other });
    lane.onMessage({ data: msg, origin: 'http://evil.test', source: active });
    lane.onMessage({
      data: { ...msg, peers: [{ ...msg.peers[0], frame: -1 }] },
      origin: 'http://canvas.test',
      source: active,
    });
    expect(set).toEqual([]);
    lane.onMessage({ data: msg, origin: 'http://canvas.test', source: active });
    expect(set).toEqual([msg.peers]);
  });
});

describe('a clip op touching her word answers locked, with nothing sent', () => {
  async function run(verb: string, stableId: string, held: string | null) {
    const { runClipVerb } = await import('../client/v2/timeline/clip-verb.js');
    const { timelinePeers } = await import('../client/v2/timeline/peers.jsx');
    timelinePeers.set(
      held ? [{ clientID: 1, name: 'Tereza', artboardId: 'reel', frame: 40, word: held }] : []
    );
    const posts: string[] = [];
    const answer = await runClipVerb({
      fetch: async (url: string, init?: { method?: string }) => {
        if (init?.method === 'POST') posts.push(url);
        return Response.json(
          url.includes('comp-clips') ? { clips: [{ stableId }] } : { ok: true, writeId: 'w' }
        );
      },
      canvas: FILE,
      artboardId: 'reel',
      clipRef: { stableId },
      verb,
      params: {},
      resolveClip: (cc: { clips: Array<{ stableId: string }> }) => cc.clips[0],
      record: () => {},
    });
    return { answer, posts };
  }

  test('a trim of the clip that shows her word: locked, "Tereza is fixing a caption."', async () => {
    const { answer, posts } = await run('retime', 'huddle', 'assets/h.mp4|w4|huddle');
    expect(answer).toEqual({ ok: false, code: 'locked', message: 'Tereza is fixing a caption.' });
    expect(posts).toEqual([]);
  });
  test('the same trim with her word on another clip — or nobody in a word — goes through', async () => {
    expect((await run('retime', 'huddle', 'assets/i.mp4|w4|interview')).posts).toEqual([
      '/_api/edit-op',
    ]);
    expect((await run('split', 'huddle', null)).posts).toEqual(['/_api/edit-op']);
  });
});

describe('the Transcript: her word is hers', () => {
  test('a fix of her word and a cut that takes it answer locked; another word is fixed', async () => {
    const { v, words } = shownWords();
    off = install(v);
    const { compMediaStore } = await import('../client/v2/transcript/comp-media-store.js');
    await compMediaStore.load(FILE, 'reel');
    const { timelinePeers } = await import('../client/v2/timeline/peers.jsx');
    const { cutSelection, fixWord, transcriptUi } = await import(
      '../client/v2/transcript/captions-api.js'
    );
    const hers = keyOf(words[1]);
    timelinePeers.set([{ clientID: 1, name: 'Tereza', artboardId: 'reel', frame: 40, word: hers }]);

    const fix = await fixWord({ key: hers, wordId: words[1].wordId }, 'Hm');
    expect(fix).toMatchObject({ ok: false, code: 'locked', reason: 'locked' });
    expect(transcriptUi.get().notice).toBe('Tereza is fixing a caption.');
    transcriptUi.select([hers], hers);
    expect(await cutSelection()).toMatchObject({ ok: false, code: 'locked' });
    expect(v.calls).toEqual([]); // nothing reached the pipe

    const mine = keyOf(words[0]);
    transcriptUi.select([mine], mine);
    expect((await cutSelection()).ok).toBe(true);
    expect(v.calls.map((c) => c.verb)).toEqual(['cut-source-range']);
  });

  test('the panel will not open her word, wears her ring, and says whose it is', async () => {
    const { v, words } = shownWords();
    off = install(v);
    const { buildTranscriptModel } = await import('../client/v2/transcript/transcript-model.js');
    const { TranscriptPanel } = await import('../client/v2/transcript/TranscriptPanel.jsx');
    const model = buildTranscriptModel(mediaOf(v));
    const hers = keyOf(words[1]);
    const editing: Array<string | null> = [];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const render = (selection: string[]) =>
      act(async () =>
        root.render(
          h(TranscriptPanel, {
            model,
            ui: {
              working: null,
              noEngine: false,
              notice: null,
              selection,
              anchor: selection[0] ?? null,
              tip: null,
            },
            frame: 0,
            canEdit: true,
            onSelect: () => {},
            onCut: () => {},
            onFix: () => {},
            onFindSpeech: () => {},
            onSetUp: () => {},
            onClose: () => {},
            lockedBy: (k: string) => (k === hers ? 'Tereza' : null),
            onEditing: (k: string | null) => editing.push(k),
          })
        )
      );
    await render([]);
    const her = q(host, `transcript-word-${words[1].wordId}`) as HTMLElement;
    expect(her.getAttribute('data-held')).toBe('true');
    expect(her.title).toBe('Tereza is fixing a caption');
    await act(
      async () => void her.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))
    );
    expect(q(host, 'transcript-edit')).toBeNull();
    const mine = q(host, `transcript-word-${words[0].wordId}`) as HTMLElement;
    await act(
      async () => void mine.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))
    );
    expect(q(host, 'transcript-edit')).not.toBeNull();
    expect(editing.at(-1)).toBe(keyOf(words[0])); // my word goes to the canvas as mine
  });
});

describe('the island draws her', () => {
  test('her thin sky line at her frame, the tag over her word, her ring on the caption lane', async () => {
    const { v, words } = shownWords();
    off = install(v);
    const { compMediaStore } = await import('../client/v2/transcript/comp-media-store.js');
    await compMediaStore.load(FILE, 'reel');
    const { PeerHeads, timelinePeers } = await import('../client/v2/timeline/peers.jsx');
    const { CaptionLane } = await import('../client/v2/timeline/lanes/caption-lane.jsx');
    const hers = keyOf(words[1]);
    timelinePeers.set([
      { clientID: 7, name: 'Tereza', artboardId: 'reel', frame: 40, word: hers },
      { clientID: 8, name: 'Jonas', artboardId: 'elsewhere', frame: 10 },
    ]);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const x = (f: number) => f * 4;
    await act(async () =>
      root.render(
        h('div', null, [
          h(PeerHeads, { key: 'p', canvas: FILE, artboardId: 'reel', x, gutter: 100, total: 150 }),
          h(CaptionLane, {
            key: 'c',
            canvas: FILE,
            artboardId: 'reel',
            fps: 30,
            frame: 0,
            x,
            axisPx: 600,
          }),
        ])
      )
    );
    await settle();
    expect(q(host, 'timeline-peer-head-7')?.style.left).toBe('260px');
    expect(q(host, 'timeline-peer-head-8')).toBeNull(); // another video's playhead is not drawn here
    const tag = q(host, 'timeline-peer-tag-7') as HTMLElement;
    expect(tag.textContent).toBe('Tereza is fixing a caption');
    expect(tag.style.left).toBe(`${100 + words[1].f0 * 4}px`);
    expect(q(host, `timeline-caption-${words[1].wordId}`)?.getAttribute('data-held')).toBe('true');
    expect(q(host, `timeline-caption-${words[0].wordId}`)?.getAttribute('data-held')).toBeNull();
  });
});
