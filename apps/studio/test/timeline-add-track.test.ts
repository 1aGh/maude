// S7.18 (C35) — "+ track": Video 2 and Music 2 can be asked for on an empty video; a comp's tracks are DERIVED, so
// it is only drawn, never written. The asked-for tracks live in this browser (a per-viewer convenience) and the
// store tolerates whatever it finds there.
import { describe, expect, test } from 'bun:test';
import { addTrackAtFollowed } from '../client/v2/timeline/advanced/actions.js';
import {
  ADDABLE_TRACKS,
  createAdvancedStore,
  trackKey,
} from '../client/v2/timeline/advanced/advanced-store.js';
import { bindCapTarget } from '../client/v2/timeline/advanced/video-cap.js';
import { deriveTracks } from '../client/v2/timeline/tracks.js';

const memory = (initial: string | null = null) => {
  let text = initial;
  return {
    read: () => text,
    write: (t: string) => {
      text = t;
    },
  };
};

describe('the store', () => {
  test('the four tracks are fixed; only Video 2 and Music 2 can be added', () => {
    expect([...ADDABLE_TRACKS]).toEqual(['video2', 'music2']);
    const s = createAdvancedStore(memory());
    const k = trackKey('ui/Reel.tsx', 'reels');
    expect(s.addTrack(k, 'text')).toBe(false);
    expect(s.addTrack(k, 'video2')).toBe(true);
    expect(s.addTrack(k, 'video2')).toBe(false);
    expect(s.tracksFor(k)).toEqual(['video2']);
    expect(s.tracksFor(trackKey('ui/Reel.tsx', 'wide'))).toEqual([]);
  });

  test('an asked-for empty track is drawn, and nothing else about the comp changes', () => {
    expect(deriveTracks({ sequences: [], audio: [] }).map((t) => t.id)).toEqual([
      'text',
      'gfx',
      'video',
      'music',
    ]);
    expect(
      deriveTracks({ sequences: [], audio: [], extra: ['music2', 'video2'] }).map((t) => t.id)
    ).toEqual(['text', 'gfx', 'video2', 'video', 'music', 'music2']);
  });

  test('it remembers in this browser, and takes a track away again', () => {
    const io = memory();
    const a = createAdvancedStore(io);
    const k = trackKey('ui/Reel.tsx', 'reels');
    a.addTrack(k, 'music2');
    a.setMode('frames');
    const b = createAdvancedStore(io);
    expect(b.tracksFor(k)).toEqual(['music2']);
    expect(b.get().mode).toBe('frames');
    b.removeTrack(k, 'music2');
    expect(b.tracksFor(k)).toEqual([]);
  });

  test('a malformed or hostile value reads as the default', () => {
    for (const bad of [
      'not json',
      '[]',
      JSON.stringify({ mode: 'wild', tracks: { a: ['text', 'video2', 7], b: 'x' } }),
    ]) {
      const s = createAdvancedStore(memory(bad));
      expect(s.get().mode).toBe('timecode');
    }
    const odd = createAdvancedStore(
      memory(JSON.stringify({ tracks: { a: ['text', 'video2', 7], b: 'x' } }))
    );
    expect(odd.tracksFor('a')).toEqual(['video2']);
    expect(odd.tracksFor('b')).toEqual([]);
  });

  test('the keyframe whose curve shows is picked and let go', () => {
    const s = createAdvancedStore(memory());
    s.selectKeyframe({ component: 'Intro', index: 1 });
    expect(s.get().kf).toEqual({ component: 'Intro', index: 1 });
    s.selectKeyframe({ component: 'Intro', index: -0.5 } as never);
    expect(s.get().kf).toBeNull();
  });
});

describe('the ⌘K row', () => {
  test('adds the named track, or the next one that is not there', () => {
    bindCapTarget(() => ({ file: 'ui/Zed.tsx', artboardId: 'z', have: ['text', 'video'] }));
    expect(addTrackAtFollowed('music2')).toBe('Music 2 added under Advanced.');
    expect(addTrackAtFollowed('music2')).toBe('Music 2 is already there.');
    expect(addTrackAtFollowed()).toBe('Video 2 added under Advanced.');
    expect(addTrackAtFollowed()).toBe('Video 2 and Music 2 are already there.');
    expect(addTrackAtFollowed('nope')).toBe('That track is not one to add.');
    bindCapTarget(null);
    expect(addTrackAtFollowed('video2')).toBe('Select a video first.');
  });

  test('a track the video already draws from its clips is not added again', () => {
    bindCapTarget(() => ({ file: 'ui/Y.tsx', artboardId: 'y', have: ['video2', 'video'] }));
    expect(addTrackAtFollowed('video2')).toBe('Video 2 is already there.');
    expect(addTrackAtFollowed()).toBe('Music 2 added under Advanced.');
    bindCapTarget(null);
  });
});
