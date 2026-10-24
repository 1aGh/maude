// P8 C6 (V2-8.5 stage C, 03 AI Chat) — the panel is built the way the board draws it: the header, the
// transcript, the field. Render tests + source pins; the pixels are the stage-D pairs.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';

import { ChatHeader } from '../client/panels/chat-header.jsx';

const STUDIO = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');
const noop = () => {};

describe('the header (03 `.k-ai-hd`)', () => {
  const render = (props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ChatHeader connected running={0} onToggleList={noop} onNew={noop} onHide={noop} {...props}>
        <span className="chat-switch">Make it greener</span>
      </ChatHeader>
    );

  test('Hide is the chevron-down glyph (the panel folds to its corner), not chevron-right', () => {
    const html = render();
    const hide = html.slice(html.indexOf('data-testid="ai-chat-hide"'));
    expect(hide).toContain('3.5 6 8 10.5 12.5 6'); // chevron-down
    expect(hide).not.toContain('6 3.5 10.5 8 6 12.5'); // chevron-right
  });

  test('the "✦ N" chip ends in a chevron (it opens the run list)', () => {
    const html = render({ running: 2 });
    const chip = html.slice(
      html.indexOf('data-testid="ai-chat-count"'),
      html.indexOf('data-testid="ai-chat-new"')
    );
    expect(chip).toContain('<b>2</b>');
    expect(chip).toContain('3.5 6 8 10.5 12.5 6');
  });

  test('the chat title has no status dot and no text caret: a chevron icon says it opens the list', () => {
    const src = read('client/panels/ChatPanel.jsx');
    expect(src).not.toContain('chat-dot');
    expect(src).not.toContain('chat-switch-caret">▾');
    expect(src).toContain('chat-switch-chev');
  });

  test('the header spark is the AI colour, vermilion --spark, not --accent', () => {
    const css = read('client/styles/6-acp-chat.css');
    const rule = css.slice(css.indexOf('.chat-bar--v2 .chat-hd-spark'));
    expect(rule.slice(0, rule.indexOf('}'))).toContain('var(--spark)');
    expect(rule.slice(0, rule.indexOf('}'))).not.toContain('var(--accent)');
  });
});

describe('the empty chat (03 `.ai-hint`)', () => {
  test('one quiet left-aligned paragraph with both sentences, not a centred title + sub-line', async () => {
    const { ChatEmpty } = await import('../client/v2/ai/Suggest.jsx');
    const html = renderToStaticMarkup(<ChatEmpty />);
    expect(html).toContain('class="ai-hint"');
    expect(html).toContain(
      'Ask for a change, a few variants, or an answer. AI works on what the chip says.'
    );
    expect(html).not.toContain('chat-empty');
  });
});

describe('the transcript (03 `.k-ai-msg`)', () => {
  const css = read('client/styles/6-acp-chat.css');
  const rule = (sel: string) => {
    const at = css.indexOf(`${sel} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };

  test('AI replies are 14 px (--type-base) on bg-3; yours sit right on bg-4 with no border', () => {
    expect(rule('.chat-msg--assistant .chat-bubble')).toContain('font-size: var(--type-base)');
    expect(rule('.chat-msg--assistant .chat-bubble')).toContain('background: var(--bg-3)');
    expect(rule('.chat-msg--user .chat-bubble')).toContain('font-size: var(--type-base)');
    expect(rule('.chat-msg--user .chat-bubble')).toContain('background: var(--bg-4)');
    expect(rule('.chat-msg--user .chat-bubble')).toContain('border: 0');
    expect(rule('.chat-msg--user')).toContain('align-self: flex-end');
  });

  test('no "AI" / "Claude" role label above a reply', () => {
    expect(read('client/v2/ai/Feed.jsx')).not.toContain('chat-msg-role');
  });

  test('tool calls are not in the feed (only the two "everything" views draw them)', async () => {
    const { showsToolSteps } = await import('../client/panels/transcript-view.js');
    expect(['normal', 'summary', 'nonsense'].map(showsToolSteps)).toEqual([false, false, false]);
    expect(['thinking', 'verbose'].map(showsToolSteps)).toEqual([true, true]);
  });
});

describe('the working line (03 `ai-working`, `ai-same-artboard`)', () => {
  test('it shows for a run that is working, never beside a Waiting card or a question', async () => {
    const { showsWorkingLine } = await import('../client/v2/ai/run-model.js');
    expect(showsWorkingLine(true, { state: 'running' })).toBe(true);
    expect(showsWorkingLine(true, { state: 'starting' })).toBe(true);
    expect(showsWorkingLine(true, null)).toBe(true); // a turn is in flight before its run frame arrives
    expect(showsWorkingLine(true, { state: 'waiting' })).toBe(false);
    expect(showsWorkingLine(true, { state: 'needs-you' })).toBe(false);
    expect(showsWorkingLine(false, { state: 'running' })).toBe(false);
  });
});

describe('the rest of the panel (03 `.k-dialog`, `.k-iconbtn--ai`, `ai-attach`)', () => {
  const block = (file: string, sel: string) => {
    const css = read(file);
    const at = css.indexOf(`${sel} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };
  test('the quit dialog has its 24 px padding and the kit dialog material', () => {
    // --space-5 IS 24 px on the v2 ladder (--space-6 is 32); the dialog rides `.gi-dialog`, which owns the material
    // since P8-C1-kit (bg-2, radius-xl), so the pin reads the token's value and the shared rule.
    const r = block('client/v2/ai/quit.css', '.ai-quit-dialog');
    expect(r).toContain('padding: var(--space-5)');
    expect(read('client/styles/1-tokens-maude-v2.css')).toMatch(/--space-5:\s*24px/);
    const material = block('client/styles/3-shell-maude.css', '.gi-dialog,\n  .cp-dialog');
    expect(material).toContain('var(--radius-xl)');
    expect(material).toContain('background: var(--bg-2)');
  });
  test('the folded AI corner is vermilion with a presence dot, and the island is 340 wide', () => {
    const css = read('client/v2/ai/panel.css');
    expect(css).toContain('color: var(--spark)');
    expect(css).toContain('background: var(--presence-agent)');
    expect(block('client/v2/ai/panel.css', '.st-body--float .st-dockslot-ai')).toContain(
      'width: 340px'
    );
  });
  test('an attached picture keeps its 40 px (the chip row no longer collapses in the field)', () => {
    expect(block('client/v2/ai/attach.css', '.ai-ask-chips-wrap')).toContain('flex: none');
    expect(block('client/v2/ai/attach.css', '.ai-ach')).toContain('flex: none');
  });
  test('the field stays while AI works (only the strip and banners hide)', () => {
    const jsx = read('client/v2/ai/Composer.jsx');
    const field = jsx.slice(jsx.indexOf('className="chat-cmd-anchor"'));
    expect(field.indexOf('ThreadPrimitive.If running')).toBeGreaterThan(field.indexOf('chat-box'));
    expect(jsx).toContain('chat-box--multi');
  });
});

describe('the suggestion strip (03 `Suggest`)', () => {
  test('the lead chip carries the context glyph; the why line is fg-2, not the disabled fg-3', () => {
    const jsx = read('client/v2/ai/Suggest.jsx');
    expect(jsx).toContain('ai-sugg-lead');
    const css = read('client/v2/ai/ai.css');
    const at = css.indexOf('.ai-suggest-why {');
    expect(css.slice(at, css.indexOf('}', at))).toContain('color: var(--fg-2)');
    expect(css.slice(at, css.indexOf('}', at))).not.toContain('--fg-3');
  });
});
