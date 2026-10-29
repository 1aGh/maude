// p8-sweep-leftovers item 5: the Design system tab is not a comp.
//
// The dynamic crawler clicked the inspector's "Uses <system>" link, which opens the Design system tab
// (`SYSTEM_TAB` = '__system__'), and the inspector of its selected video artboard then asked
// `GET /_api/comp-media?canvas=__system__…` — a 400 on every visit. The store is the one place every
// reader (formats, artboard-video, transcript feed, captions) goes through, so it refuses the sentinel.
import { afterEach, describe, expect, test } from 'bun:test';
import { SYSTEM_TAB } from '../client/shell/constants.js';
import { compMediaStore } from '../client/v2/transcript/comp-media-store.js';

afterEach(() => compMediaStore.reset());

describe('comp-media store and the Design system tab', () => {
  test('never asks the server for the system tab', async () => {
    const asked: string[] = [];
    const fetchImpl = async (url: string) => {
      asked.push(url);
      return new Response('bad canvas', { status: 400 });
    };
    const got = await compMediaStore.load(SYSTEM_TAB, 'landscape-16-9-10', { fetchImpl: fetchImpl as any });
    expect(got).toBeNull();
    expect(asked).toEqual([]);
    expect(compMediaStore.status(SYSTEM_TAB, 'landscape-16-9-10')).toBeNull();
  });

  test('a real canvas is still read', async () => {
    const asked: string[] = [];
    const fetchImpl = async (url: string) => {
      asked.push(url);
      return Response.json({ fps: 30, clips: [] });
    };
    const got = await compMediaStore.load('ui/Reel.tsx', 'a1', { fetchImpl: fetchImpl as any });
    expect(got).toEqual({ fps: 30, clips: [] });
    expect(asked.length).toBe(1);
  });
});
