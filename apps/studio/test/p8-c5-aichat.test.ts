// P8 stage C round 5 (area AI chat surfaces, 03 + 01 AI ids): pins for the pieces a render test reaches cheaply.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');

describe('P8 c5: the failure card names the file and the verb that fixes it (03 ai-choice-fail)', () => {
  test('a missing footage file: cause, detail and "Pick another clip" (the board\'s own words), no Advanced fold', async () => {
    const { failureModel } = await import('../client/v2/ai/needs-you.js');
    const f = failureModel(
      { message: "ENOENT: no such file or directory, open '/Users/me/Assets/trenink-0412.mov'" },
      { changed: false }
    );
    expect(f?.title).toBe("Couldn't finish — the footage file is missing. Nothing changed.");
    expect(f?.detail).toBe(
      'trenink-0412.mov was moved or renamed. Put it back in Assets to try again, or pick another clip.'
    );
    expect(f?.verb).toBe('Pick another clip');
    expect(f?.pick).toBe(true);
    expect(f?.raw).toBeNull();
  });

  test('a picture, a track and a plain file get their own noun; an unnamed failure keeps "Try again" and its raw line', async () => {
    const { failureModel } = await import('../client/v2/ai/needs-you.js');
    expect(failureModel({ message: 'file not found: logo.png' })?.verb).toBe(
      'Pick another picture'
    );
    expect(failureModel({ message: 'missing music-bed.wav' })?.verb).toBe('Pick another track');
    expect(failureModel({ message: 'ENOENT brief.pdf' })?.verb).toBe('Pick another file');
    const generic = failureModel({ message: 'socket hang up' });
    expect(generic?.verb).toBe('Try again');
    expect(generic?.pick).toBe(false);
    expect(generic?.detail).toBeNull();
    expect(generic?.raw).toBe('socket hang up');
  });

  test('an error that already speaks plainly is not repeated under Advanced', async () => {
    const { failureModel } = await import('../client/v2/ai/needs-you.js');
    const f = failureModel({
      message: "Couldn't finish — Claude is too busy to answer right now. Nothing changed.",
    });
    expect(f?.raw).toBeNull();
    expect(f?.verb).toBe('Try again');
  });

  test('the card draws the detail and the Pick verb opens Assets, not a retry', () => {
    const feed = read('client/v2/ai/Feed.jsx');
    expect(feed.includes('data-testid="chat-error-detail"')).toBe(true);
    expect(feed.includes('failure.pick ?')).toBe(true);
  });
});

describe('P8 c5: the attach menu is anchored to the field, the scope menu escapes the card', () => {
  test('both menus place from the composer field rect (fixed), 8 px over its top', () => {
    const attach = read('client/v2/ai/AttachMenu.jsx');
    expect(attach.includes("closest('.chat-box, .chat-input-wrap')")).toBe(true);
    const scope = read('client/v2/ai/ScopeChip.jsx');
    expect(scope.includes("position: 'fixed'")).toBe(true);
    expect(scope.includes("closest('.chat-box, .chat-input-wrap')")).toBe(true);
  });
});

describe('P8 c5: the pinned AI column (03 ai-long-pinned)', () => {
  test('with the chat pinned the slot is the wider of the open panel and the 420 column — never the 264 card the chat overran', async () => {
    const { rightPanelWidth, rightMainWidth } = await import('../client/v2/shell/panel-layout.js');
    expect(rightPanelWidth({ active: 'inspector', base: 304, aiPinned: true })).toBe(420);
    expect(rightPanelWidth({ active: 'changes', base: 304, aiPinned: true })).toBe(420);
    expect(rightPanelWidth({ active: 'inspector', base: 304 })).toBe(264);
    expect(rightPanelWidth({ active: null, base: 470, aiPinned: true })).toBe(470);
    // the open panel keeps its own width inside the wider slot
    expect(rightMainWidth({ active: 'inspector', base: 304 })).toBe(264);
    expect(rightMainWidth({ active: 'changes', base: 304 })).toBe(372);
    expect(rightMainWidth({ active: 'comments', base: 304 })).toBe(304);
  });

  test('the canvas re-fits when the pinned chat appears or goes away: one ask, the registry Fit, nothing else', async () => {
    const { fitOnAiPinDue, postFitAll } = await import('../client/v2/shell/use-fit-on-ai-pin.js');
    expect(fitOnAiPinDue(undefined, true)).toBe(false); // first render
    expect(fitOnAiPinDue(false, false)).toBe(false);
    expect(fitOnAiPinDue(false, true)).toBe(true);
    expect(fitOnAiPinDue(true, false)).toBe(true);
    const sent: unknown[][] = [];
    postFitAll({ postMessage: (...a: unknown[]) => sent.push(a) } as unknown as Window);
    expect(sent).toEqual([[{ dgn: 'run-action', v: 1, id: 'view.zoom-fit' }, '*']]);
  });

  test('no new dgn message: the fit rides the existing parent-gated run-action, which carries no payload here', () => {
    const proto = read('bridge/dgn-protocol.ts');
    expect(proto).not.toMatch(/'fit-all'/);
    const shell = read('canvas-shell.tsx');
    expect(shell).toContain("else if (id === 'view.zoom-fit') zoomController.fit();");
    // the gate: only the shell itself
    expect(shell.slice(shell.indexOf("if (m.dgn === 'run-action')") - 400)).toContain(
      'window.parent'
    );
  });

  test("app.jsx asks for the fit and hands the dock slot the open panel's own width", () => {
    const app = read('client/app.jsx');
    expect(app.includes('useFitOnAiPin({')).toBe(true);
    expect(app.includes('mainWidth={rightMainWidth(')).toBe(true);
    expect(read('client/shell/dock.jsx').includes('--dock-main-w')).toBe(true);
  });
});
