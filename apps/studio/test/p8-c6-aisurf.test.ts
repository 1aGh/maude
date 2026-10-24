// P8 stage C round 6 (03 AI chat surfaces, 01 AI frames): pure rules the board draws.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { followUps, foldedSteps } from '../client/v2/ai/run-model.js';
import { deriveSuggestions } from '../client/v2/ai/suggest-why.js';

const run = (over: Record<string, unknown> = {}) => ({
  runId: 'r_aaaaaaaaaaaa',
  state: 'ended',
  outcome: 'done',
  label: 'Make it greener, keep the logo white',
  touched: { 'Combine.tsx': ['post'] },
  ...over,
});
const BOARDS = [
  { id: 'post', label: 'Post 1:1 · Combine 2026' },
  { id: 'story', label: 'Story 9:16 · Zapiš se' },
  { id: 'poster', label: 'A4 · plakát' },
];

describe('ai-done chips: "Same on Story 9:16" + a variation of the ask (board 03)', () => {
  test('a colour ask gets "A darker shade" after the one "Same on"', () => {
    expect(followUps(run(), BOARDS)).toEqual(['Same on Story 9:16', 'A darker shade']);
  });
  test('a text ask gets "A bit larger"; an unclassified ask only the "Same on"', () => {
    expect(followUps(run({ label: 'Make the date line bigger' }), BOARDS)).toEqual([
      'Same on Story 9:16',
      'A bit larger',
    ]);
    expect(followUps(run({ label: 'Translate the poster' }), BOARDS)).toEqual([
      'Same on Story 9:16',
    ]);
  });
});

describe('"What AI did" folds only a long run (ai-done draws none, the recap draws 4 and 6 steps)', () => {
  test('under four steps there is nothing to unfold', () => {
    expect(foldedSteps(['a', 'b', 'c'])).toEqual([]);
    expect(foldedSteps(['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('the suggestion strip does not repeat the result card’s chips', () => {
  test('the last-ask context is dropped once the result card carries the follow-ups', () => {
    const base = { lastAsk: { text: 'Make it greener' } };
    expect(deriveSuggestions(base)?.context).toBe('last-ask');
    expect(deriveSuggestions({ ...base, resultShown: true })).toBeNull();
    // the other contexts (comments, clips, shared) keep their strip
    expect(deriveSuggestions({ ...base, resultShown: true, openComments: 3 })?.context).toBe(
      'comments'
    );
  });
});

describe('the chat is titled from the ask while it runs, not "New chat" (03 ai-working, 01 cf-ai-drafting)', () => {
  test('the first clause of the ask, clipped; nothing to say = no title', async () => {
    const { askTitle } = await import('../client/v2/ai/chat-list-model.js');
    expect(askTitle('Make it greener, keep the logo white')).toBe('Make it greener');
    expect(askTitle('  Translate the poster to English. Keep the layout ')).toBe(
      'Translate the poster to English'
    );
    expect(askTitle('x'.repeat(80))?.length).toBeLessThanOrEqual(40);
    expect(askTitle('/design:edit fix open comments')).toBeNull();
    expect(askTitle('')).toBeNull();
  });
  test('the panel names a chat from its live run when the agent has not titled it yet', async () => {
    const { runTitleFor } = await import('../client/v2/ai/chat-list-model.js');
    const view = { mine: [{ chatId: 'c1', label: 'Make it greener, keep the logo white' }] };
    expect(runTitleFor(view, 'c1')).toBe('Make it greener');
    expect(runTitleFor(view, 'c2')).toBeNull();
  });
});

describe('the file-write rim yields to the AI ring layer (03 ai-done / 01 cf-ai-done draw one spark outline)', () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  test('the ring layer marks the document while a run of yours is live; the legacy rim + wash hide under it', () => {
    const overlay = read('artboard-activity-overlay.tsx');
    expect(overlay).toContain("'data-maude-ai-live'");
    const css = read('inspect.ts');
    expect(css).toMatch(/html\[data-maude-ai-live\] \.dc-activity-rim/);
    expect(css).toMatch(/html\[data-maude-ai-live\] \.dc-activity-scan/);
  });
});

describe('01 cf-ai-drafting: the camera frames every artboard that has landed while the AI draws', () => {
  test('a landing during a live run asks for a Fit; nothing else does', async () => {
    const { fitOnLandingDue } = await import('../client/v2/shell/use-fit-while-ai-drafts.js');
    expect(fitOnLandingDue({ prev: 1, next: 2, working: true })).toBe(true);
    expect(fitOnLandingDue({ prev: undefined, next: 3, working: true })).toBe(false); // first reading
    expect(fitOnLandingDue({ prev: 2, next: 2, working: true })).toBe(false);
    expect(fitOnLandingDue({ prev: 2, next: 1, working: true })).toBe(false); // an artboard removed
    expect(fitOnLandingDue({ prev: 1, next: 2, working: false })).toBe(false); // a person adding one
  });
  test('the shell mounts it from app.jsx and asks only the existing parent-gated Fit', () => {
    const app = readFileSync(new URL('../client/app.jsx', import.meta.url), 'utf8');
    expect(app).toContain('useFitWhileAiDrafts({');
    const hook = readFileSync(
      new URL('../client/v2/shell/use-fit-while-ai-drafts.js', import.meta.url),
      'utf8'
    );
    expect(hook).toContain('postFitAll');
    expect(hook).not.toContain('postToCanvas(');
  });
  test('a re-announced selection (the canvas reloaded after an AI edit) is not a new pick for the Inspector', () => {
    const src = readFileSync(
      new URL('../client/hooks/use-shell-core.jsx', import.meta.url),
      'utf8'
    );
    expect(src).toContain('lastFollowPickRef');
    expect(src).toMatch(/pickKey === lastFollowPickRef\.current\) return;/);
    expect(src).toMatch(/if \(!hasSelection\) lastFollowPickRef\.current = null/);
  });
  test('an artboard selection with the chat open is an ask scope, not an Inspector (board 03)', async () => {
    const { isArtboardSelection } = await import('../client/v2/shell/inspector-follow.js');
    expect(isArtboardSelection({ selector: '[data-dc-screen="post"]' })).toBe(true);
    expect(isArtboardSelection({ id: 'hero', selector: '[data-cd-id="hero"]' })).toBe(false);
  });
});

describe('ai-permission / ai-needs-hidden: the question is the work, not "Allow — …" (board 03)', () => {
  const ask = (title: string, kind = 'other') => ({
    id: 'p1',
    toolCall: { kind, title, rawInput: {} },
    options: [
      { optionId: 'a', kind: 'allow_once', name: 'Allow' },
      { optionId: 'r', kind: 'reject_once', name: 'Not now' },
    ],
  });
  test('a sentence-shaped tool title is the headline; the button names the work, not "Allow"', async () => {
    const { permissionModel } = await import('../client/v2/ai/needs-you.js');
    const m = permissionModel(ask('Replace 4 team photos in Uniformy-2027'));
    expect(m.title).toBe('Replace 4 team photos in Uniformy-2027?');
    expect(m.verb).toBe('Replace 4 team photos');
    expect(m.line).toBe('Replace 4 team photos');
    expect(m.detail).toBeNull();
  });
  test('a machine-shaped title keeps the "Allow" words', async () => {
    const { permissionModel } = await import('../client/v2/ai/needs-you.js');
    expect(permissionModel(ask('mcp__studio__run_thing')).verb).toBe('Allow');
    expect(permissionModel(ask('Bash: ls -la')).verb).toBe('Allow');
  });
  test('the needs-you toast is one short line: "AI needs you on <canvas> — replace 4 team photos?"', async () => {
    const { needsYouNotice } = await import('../client/v2/ai/needs-you-toast.js');
    const n = needsYouNotice({
      id: 'x',
      canvas: '.design/ui/Uniformy-2027.tsx',
      line: 'Replace 4 team photos',
      onOpen: () => {},
    });
    expect(n.title).toBe('AI needs you on Uniformy-2027 — replace 4 team photos?');
  });
});
