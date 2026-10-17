// v2/ai/Suggest.jsx — the empty state, the quick-action verbs (moved from ChatPanel.jsx, S5.8) and the
// suggestion strip with its one-line why.

import { ThreadPrimitive } from '@assistant-ui/react';
import { Spark, Swatches } from './icons.jsx';

// Persistent quick-action verbs (prefill the composer; never fire blind). The
// one-time `/design:setup-ds` is offered contextually in the empty state, not here.
export const QUICK_ACTIONS = [
  { label: '/design:edit', prompt: '/design:edit ' },
  { label: '/design:new', prompt: '/design:new ' },
  { label: '/design:critic', prompt: '/design:critic' },
  { label: '/design:screenshot', prompt: '/design:screenshot' },
];

export const SUGGESTIONS = [
  '/design:edit make the primary button more prominent',
  '/design:critic',
  '/design:new Pricing "a 3-tier pricing page"',
];

export function ChatEmpty() {
  return (
    <div className="chat-empty">
      <span className="chat-empty-mark">
        <Spark size={28} />
      </span>
      <div className="chat-empty-title">Edit this canvas with Claude</div>
      <div className="chat-empty-sub">
        Ask for a change, a critique, or a new screen — Claude runs on your own subscription.
      </div>
      {/* One-time contextual CTA: bootstrap a design system. Prefills the guided
          wizard (name is required, so we never fire it blind — the composer opens
          ready for the slug). Canvas verbs live in the persistent quick-action row. */}
      <ThreadPrimitive.Suggestion
        prompt="/design:setup-ds "
        send={false}
        className="chat-empty-cta"
      >
        <span className="chat-empty-cta-ic">
          <Swatches size={15} />
        </span>
        Create new design system
      </ThreadPrimitive.Suggestion>
      <div className="chat-sugs">
        {SUGGESTIONS.map((s) => (
          <ThreadPrimitive.Suggestion key={s} prompt={s} send={false} className="chat-sug">
            {s}
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
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
