// S6.1 — C4: a canvas and a project named from the first sentence, with no AI call.

import { describe, expect, test } from 'bun:test';

import {
  nameFromPrompt,
  UNTITLED_CANVAS,
  UNTITLED_PROJECT,
  validateCanvasName,
} from '../canvas-create.ts';

const CASES: Array<[string, string, string]> = [
  // The canvases' own prompts (01 / 02 / 05).
  [
    'A calm landing page for Studio site — hero, three services, a pricing teaser',
    'Landing page',
    'Studio site',
  ],
  ['A poster for my open studio on Thursday, in warm colours', 'Poster', 'Open studio'],
  ['A matchday poster for Saturday — Gators vs. Steelers', 'Poster', UNTITLED_PROJECT],
  ['Three logo ideas for a new brand', 'Logo ideas', UNTITLED_PROJECT],
  ['Three reel covers for Krpole v pohybu', 'Reel covers', 'Krpole v pohybu'],
  ['A landing page for a small café, warm and simple', 'Landing page', 'Café'],
  // More English.
  ['Business card for Anna Nováková', 'Business card', 'Anna Nováková'],
  ['Pitch deck for our seed round', 'Pitch deck', 'Seed round'],
  ['Pricing page for Acme', 'Pricing page', 'Acme'],
  ['Instagram story for the spring sale', 'Story', 'Spring sale'],
  ['Mobile app onboarding for a fitness tracker', 'Onboarding', 'Fitness tracker'],
  ['An email newsletter for Studio site', 'Newsletter', 'Studio site'],
  // Czech.
  ['Plakát na zápas v sobotu', 'Plakát', UNTITLED_PROJECT],
  ['Vizitka pro Annu Novákovou', 'Vizitka', 'Annu Novákovou'],
  ['Leták na koncert', 'Leták', UNTITLED_PROJECT],
  // No noun at all.
  ['Make it pop', UNTITLED_CANVAS, UNTITLED_PROJECT],
  ['', UNTITLED_CANVAS, UNTITLED_PROJECT],
];

describe('nameFromPrompt (C4)', () => {
  for (const [prompt, canvas, project] of CASES) {
    test(`"${prompt.slice(0, 48)}"`, () => {
      expect(nameFromPrompt(prompt)).toEqual({ canvas, project });
    });
  }

  test('a non-string prompt is the fallback, not a throw', () => {
    for (const bad of [undefined, null, 42, {}, ['poster']]) {
      expect(nameFromPrompt(bad)).toEqual({ canvas: UNTITLED_CANVAS, project: UNTITLED_PROJECT });
    }
  });

  test('the project is capped at 40 characters, at a word boundary', () => {
    const long = `A poster for ${'Wonderful '.repeat(20)}`;
    const { project } = nameFromPrompt(long);
    expect(project.length).toBeLessThanOrEqual(40);
    expect(project.endsWith(' ')).toBe(false);
    expect(project.startsWith('Wonderful')).toBe(true);
  });

  test('a huge prompt does not hang or blow up', () => {
    const t = Date.now();
    const r = nameFromPrompt(`poster for ${'x '.repeat(200_000)}`);
    expect(Date.now() - t).toBeLessThan(500);
    expect(r.canvas).toBe('Poster');
    expect(r.project.length).toBeLessThanOrEqual(40);
  });

  test('unsafe characters never reach a name (path, JSX, JSON)', () => {
    const hostile = [
      'poster for ../../etc/passwd',
      'poster for <script>alert(1)</script>',
      'poster for {evil} "quoted" \\back',
      'poster for a/b\\c\u0000d',
    ];
    for (const prompt of hostile) {
      const { canvas, project } = nameFromPrompt(prompt);
      for (const n of [canvas, project]) {
        expect(n).toMatch(/^[\p{L}\p{N}][\p{L}\p{N} -]*$/u);
        expect(n).not.toContain('..');
        expect(n.length).toBeLessThanOrEqual(60);
      }
    }
  });

  test("every name passes the create endpoint's own allowlist", () => {
    for (const [prompt] of CASES) {
      const { canvas, project } = nameFromPrompt(prompt);
      expect(validateCanvasName(canvas).ok).toBe(true);
      expect(validateCanvasName(project).ok).toBe(true);
    }
  });
});
