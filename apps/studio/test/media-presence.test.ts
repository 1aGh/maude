// S3.8 (md-edge-offline) — which clips are on THIS Mac, and what the audience sees when one is not.
//   · present/media-presence.ts: a clip's media src → its project asset path; the local list is the
//     existing GET /_api/assets (no new endpoint); a source that is not in it is "not on this Mac"
//   · present-media.ts: a clip whose media will not load HOLDS its first frame (no play, frame 0) and
//     says so — the audience window runs the same engine, so it holds too
//   · the `present-media` row carries `sources` and `missing`, and drops junk whole
import { describe, expect, test } from 'bun:test';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import {
  assetPathOf,
  CLIP_MISSING_NOTICE,
  fetchLocalAssets,
  localAssetsOf,
  missingSources,
} from '../present/media-presence.ts';
import {
  type ClipRef,
  createPresentMedia,
  type MediaWatch,
  type PlayerLike,
} from '../present/present-media.ts';

describe('assetPathOf — a media src becomes the asset path the list uses', () => {
  const o = { designRel: '.design' };
  test('absolute, root-relative and bare forms of a project asset', () => {
    expect(assetPathOf('http://localhost:4399/.design/assets/ab12cd34.mp4', o)).toBe(
      'assets/ab12cd34.mp4'
    );
    expect(assetPathOf('/.design/assets/ab12cd34.mp4?t=9#x', o)).toBe('assets/ab12cd34.mp4');
    expect(assetPathOf('assets/ab12cd34.mp4', o)).toBe('assets/ab12cd34.mp4');
    expect(assetPathOf('/assets/ab12cd34.mp4', o)).toBe('assets/ab12cd34.mp4');
    expect(assetPathOf('http://127.0.0.1:5000/.design/assets/My%20Clip.mp4', o)).toBe(
      'assets/My Clip.mp4'
    );
  });

  test('anything that is not a project asset is not ours to judge', () => {
    for (const src of [
      '',
      'blob:http://localhost/1234',
      'data:video/mp4;base64,AAAA',
      'https://cdn.example.com/.design/assets/x.mp4', // someone else's host
      '/.design/system/maude/assets/logo.mp4', // a design system's own asset
      '/.design/assets/sub/x.mp4', // the list is flat
      '/.design/assets/../config.json',
      '/.design/assets/',
      'javascript:alert(1)',
    ])
      expect(assetPathOf(src, o)).toBeNull();
    expect(assetPathOf(undefined as unknown as string, o)).toBeNull();
  });

  test('a host the caller names is accepted (a cloud tab’s own canvas origin)', () => {
    expect(
      assetPathOf('https://p.canvas.maude.sh/.design/assets/x.mp4', {
        ...o,
        hosts: ['p.canvas.maude.sh'],
      })
    ).toBe('assets/x.mp4');
  });
});

describe('the local list (GET /_api/assets) and what is missing from it', () => {
  const body = (n: number, names: string[] = []) => ({
    ok: true,
    assets: [
      ...names.map((name) => ({ path: `assets/${name}` })),
      ...Array.from({ length: n }, (_, i) => ({ path: `assets/f${i}.png` })),
    ],
  });

  test('a clip whose file is listed is local; one that is not is missing; a remote src is neither', () => {
    const local = localAssetsOf(body(0, ['a.mp4', 'b.mp3']));
    expect(local).not.toBeNull();
    const srcs = [
      'http://localhost:1/.design/assets/a.mp4',
      'http://localhost:1/.design/assets/c.mp4',
      'https://cdn.example.com/x.mp4',
    ];
    expect(missingSources(srcs, local, { designRel: '.design' })).toEqual(['assets/c.mp4']);
  });

  test('a capped list cannot prove absence: nothing is called missing from it', () => {
    const local = localAssetsOf(body(500, ['a.mp4']));
    expect(local?.complete).toBe(false);
    expect(missingSources(['/.design/assets/zzz.mp4'], local, { designRel: '.design' })).toEqual(
      []
    );
  });

  test('no list (the route failed, or junk came back) means no verdict', () => {
    expect(localAssetsOf(null)).toBeNull();
    expect(localAssetsOf({ ok: false })).toBeNull();
    expect(localAssetsOf({ ok: true, assets: 'x' })).toBeNull();
    expect(missingSources(['/.design/assets/a.mp4'], null, { designRel: '.design' })).toEqual([]);
  });

  test('fetchLocalAssets asks the existing route, once, and swallows a failure', async () => {
    const asked: string[] = [];
    const ok = await fetchLocalAssets((async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify(body(0, ['a.mp4'])));
    }) as unknown as typeof fetch);
    expect(asked).toEqual(['/_api/assets']);
    expect(ok?.paths.has('assets/a.mp4')).toBe(true);
    const bad = await fetchLocalAssets((async () => new Response('no', { status: 500 })) as never);
    expect(bad).toBeNull();
    const boom = await fetchLocalAssets((async () => {
      throw new Error('offline');
    }) as never);
    expect(boom).toBeNull();
  });

  test('the notice is the canvas’s words', () => {
    expect(CLIP_MISSING_NOTICE).toBe("Clip isn't on this Mac — the audience sees its first frame");
  });
});

// ── the engine: a clip that will not load holds its first frame ────────────────────────────────────
class P implements PlayerLike {
  playing = false;
  muted = false;
  frame = 0;
  calls: string[] = [];
  private on = new Map<string, Set<() => void>>();
  emit(ev: string) {
    for (const f of [...(this.on.get(ev) ?? [])]) f();
  }
  addEventListener(ev: string, f: () => void) {
    if (!this.on.has(ev)) this.on.set(ev, new Set());
    this.on.get(ev)?.add(f);
  }
  removeEventListener(ev: string, f: () => void) {
    this.on.get(ev)?.delete(f);
  }
  play() {
    this.calls.push('play');
    this.playing = true;
    this.emit('play');
  }
  pause() {
    this.calls.push('pause');
    this.playing = false;
    this.emit('pause');
  }
  seekTo(f: number) {
    this.calls.push(`seek:${f}`);
    this.frame = f;
    this.emit('seeked');
  }
  isPlaying() {
    return this.playing;
  }
  getCurrentFrame() {
    return this.frame;
  }
  mute() {
    this.muted = true;
  }
  unmute() {
    this.muted = false;
  }
  isMuted() {
    return this.muted;
  }
}

const SRC = 'http://localhost:4399/.design/assets/ab12cd34.mp4';

function rig() {
  const posts: Record<string, unknown>[] = [];
  const timers: Array<{ fn: () => void; live: boolean }> = [];
  const p = new P();
  const clip: ClipRef = { artboardId: 'reel', fps: 30, durationInFrames: 450, ref: { current: p } };
  const watches: Array<{ id: string; fail: () => void; off: number; sources: string[] }> = [];
  const eng = createPresentMedia({
    clips: () => [clip],
    post: (m) => posts.push(m),
    setTimer: (fn) => {
      const t = { fn, live: true };
      timers.push(t);
      return t as unknown as number;
    },
    clearTimer: (h) => {
      (h as unknown as { live: boolean }).live = false;
    },
    watch: (id, onFail): MediaWatch => {
      const w = { id, fail: onFail, off: 0, sources: [SRC] };
      watches.push(w);
      return {
        sources: () => w.sources,
        off: () => {
          w.off += 1;
        },
      };
    },
  });
  const fire = () => {
    for (const t of timers.splice(0)) if (t.live) t.fn();
  };
  const last = () => posts.filter((m) => m.dgn === 'present-media').at(-1);
  return { eng, p, posts, watches, fire, last };
}

describe('createPresentMedia — a clip that is not on this Mac holds its first frame', () => {
  test('a healthy clip plays and the shell is told which files it uses', () => {
    const { eng, p, last } = rig();
    eng.arrive('reel');
    expect(p.playing).toBe(true);
    expect(last()).toMatchObject({ playing: true, sources: [SRC] });
    expect(last()).not.toHaveProperty('missing');
  });

  test('the media failing to load pauses it on frame 0 and says missing', () => {
    const { eng, p, watches, last } = rig();
    eng.arrive('reel');
    p.frame = 40;
    watches[0].fail();
    expect(p.playing).toBe(false);
    expect(p.frame).toBe(0);
    expect(last()).toMatchObject({ playing: false, t: 0, missing: true, sources: [SRC] });
  });

  test('a failure that is reported twice, or after the clip is left, changes nothing more', () => {
    const { eng, p, watches, posts } = rig();
    eng.arrive('reel');
    watches[0].fail();
    const n = posts.length;
    watches[0].fail();
    expect(posts.length).toBe(n);
    eng.leave();
    p.calls.length = 0;
    watches[0].fail();
    expect(p.calls).toEqual([]);
    expect(watches[0].off).toBeGreaterThan(0); // the watch was released
  });

  test('once held, the sound check does not start it again, and the next artboard is clean', () => {
    const { eng, p, watches, fire, last } = rig();
    eng.arrive('reel');
    watches[0].fail();
    fire();
    expect(p.playing).toBe(false);
    eng.leave();
    eng.arrive('reel'); // coming back plays it from the start, judged afresh
    expect(watches.length).toBe(2);
    expect(p.playing).toBe(true);
    expect(last()).not.toHaveProperty('missing');
  });

  test('stopping releases the watch', () => {
    const { eng, watches } = rig();
    eng.arrive('reel');
    eng.stop();
    expect(watches[0].off).toBeGreaterThan(0);
  });
});

describe('the present-media row carries sources and missing', () => {
  const row = DGN_TABLE.c2s['present-media' as keyof typeof DGN_TABLE.c2s] as unknown as {
    parse(raw: Record<string, unknown>): Record<string, unknown> | null;
  };
  const base = { playing: false, t: 0, duration: 15, muted: false };

  test('both are optional, so an older canvas still parses', () => {
    expect(row.parse(base)).toEqual(base);
    expect(row.parse({ ...base, sources: [SRC], missing: true })).toEqual({
      ...base,
      sources: [SRC],
      missing: true,
    });
  });

  test('junk drops the whole message: too many, too long, not strings, not a boolean', () => {
    expect(row.parse({ ...base, sources: Array.from({ length: 9 }, () => SRC) })).toBeNull();
    expect(row.parse({ ...base, sources: ['x'.repeat(401)] })).toBeNull();
    expect(row.parse({ ...base, sources: [1] })).toBeNull();
    expect(row.parse({ ...base, sources: 'a' })).toBeNull();
    expect(row.parse({ ...base, missing: 'yes' })).toBeNull();
  });
});
