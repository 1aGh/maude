// client/v2/ai/FoldNeeds.jsx — S5.13 (03 `ai-needs-hidden`): the folded spark when a chat needs you. The azure
// count wins over the busy dot — a chat that is working is a dot, a chat that waits for YOU is a number.
// Rendered inside the corner icon (v2/shell/corner-icons.jsx); the count is `useNeedsYou()` from the store.

export function foldState({ needs = 0, busy = false } = {}) {
  if (needs > 0) return { kind: 'needs', count: needs };
  if (busy) return { kind: 'busy', count: 0 };
  return { kind: 'idle', count: 0 };
}

export default function FoldNeeds({ count }) {
  if (!(count > 0)) return null;
  return (
    <i
      className="ai-fold-badge"
      data-testid="ai-fold-needs"
      role="status"
      aria-label={count === 1 ? 'AI needs you' : `AI needs you in ${count} chats`}
    >
      {count > 9 ? '9+' : count}
    </i>
  );
}
