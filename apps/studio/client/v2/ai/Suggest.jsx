// v2/ai/Suggest.jsx — the empty state, the quick-action verbs (moved from ChatPanel.jsx, S5.8) and the
// suggestion strip with its one-line why.

import { ThreadPrimitive, useThread } from '@assistant-ui/react';
import { StIcon } from '../../shell/icons.jsx';
import { lastUserText } from '../../panels/acp-runtime.js';
import { deriveSuggestions } from './suggest-why.js';

// Persistent quick-action verbs (prefill the composer; never fire blind). The
// one-time `/design:setup-ds` is offered contextually in the empty state, not here.
export const QUICK_ACTIONS = [
  { label: '/design:edit', prompt: '/design:edit ' },
  { label: '/design:new', prompt: '/design:new ' },
  { label: '/design:critic', prompt: '/design:critic' },
  { label: '/design:screenshot', prompt: '/design:screenshot' },
];

export function ChatEmpty() {
  return (
    <div className="chat-empty">
      <div className="chat-empty-title" data-testid="ai-hint">
        Ask for a change, a few variants, or an answer.
      </div>
      <div className="chat-empty-sub">AI works on what the chip says.</div>
      {/* S5.17 G4 — 03 `ai-open` draws only this hint and the one suggestion strip above the field
          (SuggestStrip). The v1 "Create new design system" CTA, the four /design:* verb buttons and the
          three slash suggestions are gone from the EMPTY state only: every /design:* verb (setup-ds
          included) is still one `/` away in the composer's slash menu, and QuickActions stays exported. */}
    </div>
  );
}

export function QuickActions({ openComments = 0 }) {
  return (
    <div className="chat-quick">
      {/* Issue #74 — the reporter asked for a button that IMPLEMENTS the
          comments they already dropped on the canvas, not one that adds a new
          one. `/design:edit` already owns the whole behaviour (edit.md §3: a
          generic feedback string + open comments → iterate each as a scoped
          edit, resolve each after it lands), so this is purely a shortcut to
          the phrasing that triggers it. Shown only when there IS something to
          implement — a permanently-disabled verb would just be noise.
          Prefill, never fire blind: same rule as QUICK_ACTIONS above, so the
          user can narrow the ask ("…but skip the one about the colour")
          before sending. */}
      {openComments > 0 ? (
        <ThreadPrimitive.Suggestion
          prompt="/design:edit fix open comments"
          send={false}
          className="btn btn--ghost btn--sm chat-qa chat-qa--comments"
          data-testid="chat-qa-implement-comments"
        >
          {`✓ Implement ${openComments} comment${openComments === 1 ? '' : 's'}`}
        </ThreadPrimitive.Suggestion>
      ) : null}
      {QUICK_ACTIONS.map((a) => (
        <ThreadPrimitive.Suggestion
          key={a.label}
          prompt={a.prompt}
          send={false}
          className="btn btn--ghost btn--sm chat-qa"
        >
          {a.label}
        </ThreadPrimitive.Suggestion>
      ))}
    </div>
  );
}

const STRIP_ICON = {
  comments: 'comment',
  clips: 'presentation',
  shared: 'share',
  'last-ask': 'reload',
};

/**
 * S5.8 (03 `ai-suggest`): up to three chips from what the person was doing, and one quiet line that says
 * why. A chip fills the composer and never sends. Hidden while a turn runs and when Advanced › Suggestions
 * is off. Mount it inside the thread (it reads the last ask from it).
 */
export function SuggestStrip({
  openComments = 0,
  selectedClips = 0,
  justShared = null,
  enabled = true,
  lastFailed = false,
}) {
  const lastAsk = useThread((t) => lastUserText(t.messages) || '');
  const sug = deriveSuggestions({
    enabled,
    openComments,
    selectedClips,
    justShared,
    lastAsk: lastAsk ? { text: lastAsk } : null,
    lastFailed,
  });
  if (!sug) return null;
  return (
    <div className="ai-suggest" data-testid="ai-suggest" data-context={sug.context}>
      <div className="ai-suggest-chips">
        {sug.chips.map((c) => (
          <ThreadPrimitive.Suggestion
            key={c.id}
            prompt={c.prompt}
            send={false}
            className="ai-chip"
            data-testid={c.testid || 'ai-suggest-chip'}
          >
            {c.label}
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
      <p className="ai-suggest-why" data-testid="ai-suggest-why">
        <StIcon name={STRIP_ICON[sug.context] || 'sparkle'} size={11} />
        {sug.why}
      </p>
    </div>
  );
}
