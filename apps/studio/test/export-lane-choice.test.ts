// S8.5 — the client half of cloud or this Mac (09 ex-offline, ex-advanced "Where it renders").
//
// Pure: `renderChoice` (Suggest each time · Always the cloud · Always this Mac, online and offline
// words), the stored choice surviving a throwing storage, the Exports row's waiting words, and
// "Render on this Mac now" against a scripted fetch (no studio, no cloud).

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CLOUD_WAITS,
  readLanePref,
  renderChoice,
  THIS_MAC_OFFLINE,
  withRenderLane,
  writeLanePref,
} from '../client/export-lane.js';
import {
  ALREADY_IN_CLOUD,
  isQueuedCloud,
  RENDER_HERE,
  renderHereNow,
} from '../client/v2/export/cloud-queue.js';
import { jobMeta } from '../client/v2/export/exports-model.js';
import { JobRow } from '../client/v2/export/job-row.jsx';
import { RenderRow } from '../client/v2/export/sections/render-row.jsx';

const FOUR_K = { cloud: true, suggest: 'cloud', why: '4k' };
const SHORT = { cloud: true, suggest: 'this-mac', why: null };

describe('S8.5 Suggest each time / always', () => {
  test('no cloud on offer (an image, a PDF, no door): no Render row, this Mac', () => {
    expect(
      renderChoice({ render: { cloud: false, suggest: 'this-mac', why: null } })
    ).toMatchObject({
      show: false,
      lane: 'this-mac',
    });
    expect(renderChoice({ render: null }).show).toBe(false);
  });
  test('Suggest each time ticks the cloud for 4K and says why; a short 1080p one stays here', () => {
    const c = renderChoice({ pref: 'auto', render: FOUR_K });
    expect(c).toMatchObject({ show: true, lane: 'cloud', suggested: true });
    expect(c.why).toContain('4K');
    expect(renderChoice({ pref: 'auto', render: SHORT })).toMatchObject({
      lane: 'this-mac',
      suggested: false,
      why: null,
    });
  });
  test('always the cloud · always this Mac win over the suggestion; a click in the sheet wins over both', () => {
    expect(renderChoice({ pref: 'this-mac', render: FOUR_K }).lane).toBe('this-mac');
    expect(renderChoice({ pref: 'cloud', render: SHORT }).lane).toBe('cloud');
    expect(renderChoice({ pref: 'cloud', render: SHORT, picked: 'this-mac' }).lane).toBe(
      'this-mac'
    );
  });
  test('offline the words change: the cloud waits, this Mac starts now', () => {
    const c = renderChoice({ render: FOUR_K, online: false });
    expect(c.options.find((o) => o.id === 'cloud')?.sub).toBe(CLOUD_WAITS);
    expect(c.options.find((o) => o.id === 'this-mac')?.sub).toBe(THIS_MAC_OFFLINE);
    const timed = renderChoice({ render: FOUR_K, online: false, seconds: 180 });
    expect(timed.options.find((o) => o.id === 'this-mac')?.sub).toBe(
      "Starts now. About 3 min — keep this window open until it's done."
    );
  });
  test('the button sends the chosen lane on a video, and leaves every other spec alone', () => {
    const spec = { v: 2, format: 'mp4', scope: 'selection', options: { fps: 30 } };
    const c = renderChoice({ render: FOUR_K });
    expect(withRenderLane(spec, c).options).toEqual({ fps: 30, lane: 'cloud' });
    const png = { ...spec, format: 'png' };
    expect(withRenderLane(png, renderChoice({ render: null }))).toBe(png);
  });
  test('the standing choice is remembered, and a throwing storage falls back to Suggest each time', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    expect(readLanePref(storage)).toBe('auto');
    writeLanePref('cloud', storage);
    expect(readLanePref(storage)).toBe('cloud');
    writeLanePref('bogus', storage);
    expect(readLanePref(storage)).toBe('cloud');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readLanePref(broken)).toBe('auto');
    expect(() => writeLanePref('cloud', broken)).not.toThrow();
  });
  test('the Render row draws both options with their testids, the picked one checked', () => {
    const html = renderToStaticMarkup(
      createElement(RenderRow, { choice: renderChoice({ render: FOUR_K }), onPick: () => {} })
    );
    expect(html).toContain('data-testid="export-row-render"');
    expect(html).toContain('data-testid="export-render-cloud"');
    expect(html).toContain('data-testid="export-render-this-mac"');
    expect(html).toMatch(/aria-checked="true"[^>]*data-testid="export-render-cloud"/);
    expect(
      renderToStaticMarkup(
        createElement(RenderRow, { choice: renderChoice({ render: null }), onPick: () => {} })
      )
    ).toBe('');
  });
});

describe('S8.5 the queued cloud row', () => {
  const queued = {
    id: 'i_aaaaaaaaaaaaaaaaaaaa',
    format: 'mp4',
    scope: 'selection',
    status: 'queued',
    runsOn: 'cloud',
    waiting: 'Queued — starts when this Mac is online',
    createdAt: new Date().toISOString(),
  };
  test('the row says what it waits for and offers Render on this Mac now', () => {
    expect(jobMeta(queued)).toBe('In the cloud · Queued — starts when this Mac is online');
    expect(isQueuedCloud(queued)).toBe(true);
    expect(isQueuedCloud({ ...queued, waiting: undefined })).toBe(false);
    const html = renderToStaticMarkup(
      createElement(JobRow, { job: queued, on: { renderHere: () => {} } })
    );
    expect(html).toContain(`data-testid="export-job-here-${queued.id}"`);
    expect(html).toContain(RENDER_HERE);
  });

  test('Render on this Mac now withdraws the record and runs the same spec with lane this-mac', async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const spec = { v: 2, format: 'mp4', scope: 'selection', options: { lane: 'cloud' } };
    const fetch = async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
      if (url.endsWith('/cancel')) return new Response('{}', { status: 200 });
      if (url === '/_api/export-jobs') return Response.json({ jobId: 'local-1' }, { status: 202 });
      return Response.json({ payload: { kind: 'export.cloud', spec } });
    };
    const r = await renderHereNow(queued.id, {
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(r).toEqual({ ok: true, jobId: 'local-1' });
    expect(calls.map((c) => c.url)).toEqual([
      `/_api/outbox/${queued.id}`,
      `/_api/outbox/${queued.id}/cancel`,
      '/_api/export-jobs',
    ]);
    expect(calls[2]?.body).toEqual({ v: 2, spec: { ...spec, options: { lane: 'this-mac' } } });
  });

  test('one the cloud already took cannot be taken back: one sentence, nothing runs here', async () => {
    const urls: string[] = [];
    const fetch = async (url: string) => {
      urls.push(url);
      if (url.endsWith('/cancel')) return Response.json({ error: 'in-flight' }, { status: 409 });
      return Response.json({ payload: { kind: 'export.cloud', spec: { format: 'mp4' } } });
    };
    const r = await renderHereNow(queued.id, {
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(r).toEqual({ ok: false, words: ALREADY_IN_CLOUD });
    expect(urls).not.toContain('/_api/export-jobs');
  });
});
