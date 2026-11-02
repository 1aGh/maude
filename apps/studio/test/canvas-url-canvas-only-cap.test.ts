// p8-e2e-link-viewer (lead decision v2-p8-canvas-only-browser-opens-via-follow-capability) — a canvas-only
// browser session on a cell (a Can view link: no project role, only grants) holds no project-wide canvas
// capability (S3.7c). The shell asks the cell for a read-only one PER CANVAS it holds
// (`/_config?follow=1&canvas=<rel>`, hub follow-capability.mjs) and frames each canvas with its own.

import { afterEach, describe, expect, test } from 'bun:test';

import {
  canvasCapAsks,
  canvasCapUrl,
  canvasFrameCfg,
  canvasUrl,
  setCanvasCaps,
  setLiveCanvasToken,
} from '../client/canvas-url.js';

const A = 'ui/Smoke.tsx';
const B = 'ui/Private.tsx';
const canvasOnly = {
  designRel: '.design',
  cloud: { projectName: 'P' },
  canvasOrigin: 'http://canvas.cell.localhost:1',
  access: { role: null, grants: [{ c: A, r: 'observer' }] },
};
const tOf = (url: string) => new URLSearchParams(url.split('?')[1] ?? '').get('t');

afterEach(() => {
  setCanvasCaps({});
  setLiveCanvasToken(null);
});

describe('which canvases a session asks a capability for', () => {
  test('a canvas-only cloud session asks for exactly the canvases it holds', () => {
    expect(canvasCapAsks(canvasOnly)).toEqual([A]);
    expect(
      canvasCapAsks({
        ...canvasOnly,
        access: {
          role: null,
          grants: [
            { c: A, r: 'observer' },
            { c: A, r: 'member' },
            { c: B, r: 'commenter' },
          ],
        },
      })
    ).toEqual([A, B]);
  });

  test('nobody else asks: a project session, a desktop, a session with a project-wide capability', () => {
    expect(canvasCapAsks({ ...canvasOnly, access: { role: 'observer', grants: [] } })).toEqual([]);
    expect(canvasCapAsks({ ...canvasOnly, cloud: null })).toEqual([]);
    expect(canvasCapAsks({ ...canvasOnly, canvasToken: 'project-wide' })).toEqual([]);
    expect(canvasCapAsks({ ...canvasOnly, access: null })).toEqual([]);
    expect(canvasCapAsks(null)).toEqual([]);
  });

  test('a grant that is not a canvas path is not asked for', () => {
    const odd = { role: null, grants: [{ c: '../x.tsx' }, { c: '' }, { c: 7 }, { c: 'ui/a.css' }] };
    expect(canvasCapAsks({ ...canvasOnly, access: odd })).toEqual([]);
  });

  test('the ask is the follow ask, one canvas, encoded once', () => {
    expect(canvasCapUrl('ui/My Canvas.tsx')).toBe('/_config?follow=1&canvas=ui%2FMy+Canvas.tsx');
  });
});

describe('a frame carries its own canvas’s capability', () => {
  test('the canvas it holds: that canvas’s token; any other canvas: none', () => {
    setCanvasCaps({ [A]: 'token-a' });
    expect(tOf(canvasUrl(`.design/${A}`, canvasOnly))).toBe('token-a');
    expect(tOf(canvasUrl(`.design/${B}`, canvasOnly))).toBeNull();
  });

  test('the frame’s identity holds across a re-mint, and changes when the first capability arrives', () => {
    const before = canvasUrl(`.design/${A}`, canvasFrameCfg(canvasOnly));
    setCanvasCaps({ [A]: 'token-a' });
    const first = canvasUrl(`.design/${A}`, canvasFrameCfg(canvasOnly));
    setCanvasCaps({ [A]: 'token-a2' });
    const again = canvasUrl(`.design/${A}`, canvasFrameCfg(canvasOnly));
    expect(first).not.toBe(before);
    expect(again).toBe(first);
    expect(again).not.toContain('token-a');
  });

  test('a project-wide capability still wins, and a per-canvas one never leaks onto it', () => {
    setCanvasCaps({ [A]: 'token-a' });
    expect(tOf(canvasUrl(`.design/${A}`, { ...canvasOnly, canvasToken: 'project' }))).toBe(
      'project'
    );
  });
});
