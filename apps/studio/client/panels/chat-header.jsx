// panels/chat-header.jsx — V2-4.4b: the AI chat panel's header, 03 AI Chat's canonical one (kit
// `AIPanel chat=…`): spark · the chat's title ⌄ (opens the chat list) · "✦ N" YOUR running chats ·
// New chat · Hide. Hide folds the island to its spark corner icon (corner-icons.jsx). The title +
// list is the caller's (`children`: ChatPanel owns the chat state); this is the row around it.
//
// Words: "Hide", never close / collapse (CONTRACT §3). Presentational and DOM-free of chat state so
// test/v2-ai-chat-header.test.tsx can render it.

import { StIcon } from '../shell/icons.jsx';

export function ChatHeader({
  connected,
  running = 0,
  onToggleList,
  onNew,
  onHide,
  pin = null,
  children,
}) {
  const n = running > 0 ? running : 0;
  const runLabel = `${n} ${n === 1 ? 'chat' : 'chats'} running`;
  return (
    <div className="chat-bar chat-bar--v2" data-testid="ai-chat-header">
      <span className="chat-hd-spark" aria-hidden="true">
        <StIcon name="sparkle" size={14} />
      </span>
      {connected ? children : <span className="chat-hd-title">AI</span>}
      {connected && n > 0 ? (
        <button
          type="button"
          className="chat-hd-count"
          data-testid="ai-chat-count"
          title={runLabel}
          aria-label={runLabel}
          onClick={onToggleList}
        >
          <StIcon name="sparkle" size={10} />
          <b>{n}</b>
          <StIcon name="chevron-down" size={12} />
        </button>
      ) : null}
      {connected ? (
        <button
          type="button"
          className="sh-iconbtn"
          data-testid="ai-chat-new"
          aria-label="New chat"
          title="New chat"
          onClick={onNew}
        >
          <StIcon name="plus" size={14} />
        </button>
      ) : null}
      {pin}
      <button
        type="button"
        className="sh-iconbtn"
        data-testid="ai-chat-hide"
        aria-label="Hide the AI chat panel"
        title="Hide the AI chat panel"
        onClick={onHide}
      >
        <StIcon name="chevron-down" size={14} />
      </button>
    </div>
  );
}
