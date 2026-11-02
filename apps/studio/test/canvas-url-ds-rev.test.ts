// S10.4 (V2-1.6 §5.8) — which revision a canvas renders. The matrix: an unconverted system is byte-identical
// to today; a converted one hands its followers the head's two sibling files and a left-out canvas its own
// `dsRev`'s; the Design system canvas and the specimens keep the working files; a revision that is not here
// (referenced but not offered — DDR-226) falls back dsRev → head → working files and names who we wait for;
// `?dsPreview=` is a session-only override that is stored nowhere.

import { describe, expect, test } from 'bun:test';

import { canvasDsRender, canvasUrl } from '../client/canvas-url.js';

const R1 = 'a'.repeat(64);
const R2 = 'b'.repeat(64);
const R3 = 'c'.repeat(64);

const base = {
  designRel: '.design',
  designSystems: [
    {
      name: 'studio-site',
      path: 'system/studio-site',
      tokensCssRel: 'system/studio-site/colors_and_type.css',
    },
    { name: 'plain', path: 'system/plain', tokensCssRel: 'system/plain/colors_and_type.css' },
  ],
};
const converted = {
  ...base,
  dsConverted: { 'studio-site': true, plain: false },
  systemHeads: { 'studio-site': R2 },
  canvasDesignSystems: {
    '.design/ui/Pricing.tsx': 'studio-site',
    '.design/ui/Landing.tsx': 'studio-site',
    '.design/ui/Old.tsx': 'plain',
    '.design/system/studio-site/design-system.tsx': 'studio-site',
  },
  canvasDsRevs: { '.design/ui/Landing.tsx': R1 },
};

const q = (url: string) => new URLSearchParams(url.split('?')[1] ?? '');
const siblings = (rev: string) => ({
  tokens: `system/studio-site/revisions/${rev}.tokens.css`,
  components: `system/studio-site/revisions/${rev}.components.css`,
});

describe('canvasUrl — §5.8 which revision a canvas renders', () => {
  test('an unconverted system is byte-identical to today (the fields change nothing)', () => {
    const today = canvasUrl('.design/ui/Old.tsx', {
      ...base,
      canvasDesignSystems: converted.canvasDesignSystems,
    });
    expect(canvasUrl('.design/ui/Old.tsx', converted)).toBe(today);
    // …and a project with none of the new fields at all
    expect(canvasUrl('.design/ui/Old.tsx', base)).toBe(
      canvasUrl('.design/ui/Old.tsx', { ...base, dsConverted: {}, systemHeads: {} })
    );
    expect(q(today).get('tokens')).toBe('system/plain/colors_and_type.css');
  });

  test('a follower of a converted system renders the head siblings', () => {
    const p = q(canvasUrl('.design/ui/Pricing.tsx', converted));
    expect(p.get('tokens')).toBe(siblings(R2).tokens);
    expect(p.get('components')).toBe(siblings(R2).components);
  });

  test('a left-out canvas (dsRev = R) renders R, not head', () => {
    const p = q(canvasUrl('.design/ui/Landing.tsx', converted));
    expect(p.get('tokens')).toBe(siblings(R1).tokens);
    expect(p.get('components')).toBe(siblings(R1).components);
  });

  test('the relative path form finds the same canvas', () => {
    expect(q(canvasUrl('ui/Landing.tsx', converted)).get('tokens')).toBe(siblings(R1).tokens);
  });

  test('the Design system canvas and a specimen keep the working files', () => {
    const ds = q(canvasUrl('.design/system/studio-site/design-system.tsx', converted));
    expect(ds.get('tokens')).toBe('system/studio-site/colors_and_type.css');
    expect(ds.get('components')).toBe('system/studio-site/preview/_components.css');
    const spec = q(canvasUrl('.design/system/studio-site/preview/buttons.tsx', converted));
    expect(spec.get('tokens')).toBe('system/studio-site/colors_and_type.css');
    expect(spec.get('components')).toBe('system/studio-site/preview/_components.css');
  });

  test('a head of null (a system still being made) renders the working files', () => {
    const p = q(
      canvasUrl('.design/ui/Pricing.tsx', { ...converted, systemHeads: { 'studio-site': null } })
    );
    expect(p.get('tokens')).toBe('system/studio-site/colors_and_type.css');
  });

  test('a malformed dsRev is ignored, never put in a path', () => {
    const p = q(
      canvasUrl('.design/ui/Landing.tsx', {
        ...converted,
        canvasDsRevs: { '.design/ui/Landing.tsx': '../../etc/passwd' },
      })
    );
    expect(p.get('tokens')).toBe(siblings(R2).tokens);
  });

  test('a missing dsRev falls back to head and names who we wait for', () => {
    const cfg = { ...converted, dsRevGaps: { [R1]: 'Jonas' } };
    const url = canvasUrl('.design/ui/Landing.tsx', cfg);
    expect(q(url).get('tokens')).toBe(siblings(R2).tokens);
    const r = canvasDsRender('.design/ui/Landing.tsx', cfg);
    expect(r.waiting).toEqual({ rev: R1, peer: 'Jonas' });
    expect(r.rev).toBe(R2);
  });

  test('a missing head too: the working files, still waiting', () => {
    const cfg = { ...converted, dsRevGaps: { [R1]: null, [R2]: null } };
    const p = q(canvasUrl('.design/ui/Landing.tsx', cfg));
    expect(p.get('tokens')).toBe('system/studio-site/colors_and_type.css');
    const r = canvasDsRender('.design/ui/Landing.tsx', cfg);
    expect(r.rev).toBeNull();
    expect(r.waiting).toEqual({ rev: R1, peer: null });
  });

  test('a follower whose head is missing waits for the head', () => {
    const r = canvasDsRender('.design/ui/Pricing.tsx', {
      ...converted,
      dsRevGaps: { [R2]: 'Tereza' },
    });
    expect(r.rev).toBeNull();
    expect(r.waiting).toEqual({ rev: R2, peer: 'Tereza' });
  });

  test('nothing is waited for when nothing is missing, or the system is not converted', () => {
    expect(canvasDsRender('.design/ui/Pricing.tsx', converted).waiting).toBeNull();
    expect(canvasDsRender('.design/ui/Old.tsx', converted)).toBeNull();
  });
});

describe('canvasUrl — ?dsPreview= is a session-only override', () => {
  test('<ds> previews the system at its head', () => {
    const p = q(canvasUrl('.design/ui/Old.tsx', converted, { dsPreview: 'studio-site' }));
    expect(p.get('tokens')).toBe(siblings(R2).tokens);
    expect(p.get('components')).toBe(siblings(R2).components);
  });

  test('<ds>@<id> previews that revision', () => {
    const p = q(canvasUrl('.design/ui/Pricing.tsx', converted, { dsPreview: `studio-site@${R3}` }));
    expect(p.get('tokens')).toBe(siblings(R3).tokens);
  });

  test('an unconverted system previews its working files', () => {
    const p = q(canvasUrl('.design/ui/Pricing.tsx', converted, { dsPreview: 'plain' }));
    expect(p.get('tokens')).toBe('system/plain/colors_and_type.css');
    expect(p.get('components')).toBe('system/plain/preview/_components.css');
  });

  test('an unknown system or a malformed id is ignored', () => {
    const plain = canvasUrl('.design/ui/Pricing.tsx', converted);
    expect(canvasUrl('.design/ui/Pricing.tsx', converted, { dsPreview: 'nope' })).toBe(plain);
    expect(canvasUrl('.design/ui/Pricing.tsx', converted, { dsPreview: 'studio-site@zz' })).toBe(
      plain
    );
  });

  test('the override is stored nowhere: it adds no query parameter', () => {
    const url = canvasUrl('.design/ui/Pricing.tsx', converted, { dsPreview: 'studio-site' });
    expect([...q(url).keys()].some((k) => /preview/i.test(k))).toBe(false);
  });
});
