// client/v2/ai/AgentPicker.jsx — universal ACP B6, Design Decision 4: which agent a chat runs on.
//
//   • The chip sits in the composer, beside the scope chip, and shows only when two or more agents are
//     connected (Claude counts when it is connected). Claude-only: nothing is drawn.
//   • A NEW chat (nothing sent yet) starts on the last agent used in this profile (or Claude, or the one
//     connected agent) and the person may pick another. The pick rides the WS `attach` frame (`agent`).
//   • A chat that has started keeps its agent: the chip turns read-only. No switching mid-chat.
//
// The binding runs even while the chip is hidden: someone with only Codex connected gets Codex.

import { useThread } from '@assistant-ui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CLAUDE_ID,
  connectedAgents,
  pickerVisible,
  readChatAgent,
  readLastAgent,
  resolveNewChatAgent,
  writeChatAgent,
  writeLastAgent,
} from './agents-model.js';
import { currentProfileId, loadProfileId, useAgents } from './agents-store.js';

/** The chip itself (controlled). `locked` = the chat has started: its agent, read-only. */
export function AgentPickerChip({ agents, value, locked = false, lockedLabel = null, onPick }) {
  if (!pickerVisible(agents)) return null;
  const on = connectedAgents(agents);
  const current = on.find((a) => a.id === value);
  if (locked) {
    const label = lockedLabel ?? current?.label ?? 'Claude';
    return (
      <span
        className="chip ai-agent-chip ai-agent-chip--locked"
        data-testid="ai-agent-picker"
        data-agent={value ?? CLAUDE_ID}
        title={`This chat runs on ${label}. Start a new chat to use another agent.`}
      >
        {label}
      </span>
    );
  }
  return (
    <select
      className="chip ai-agent-chip"
      data-testid="ai-agent-picker"
      data-agent={value ?? ''}
      aria-label="Agent for this chat"
      value={value ?? ''}
      onChange={(e) => onPick?.(e.target.value)}
    >
      {on.map((a) => (
        <option key={a.id} value={a.id}>
          {a.label}
        </option>
      ))}
    </select>
  );
}

/**
 * The composer's picker, wired to this chat's connection. Mount it inside the thread (it reads whether the
 * chat has started from it).
 */
export function AgentPicker({ conn, chatId }) {
  const { agents, loaded } = useAgents();
  const started = useThread((t) => t.messages.length > 0);
  const others = useMemo(() => connectedAgents(agents).some((a) => a.id !== CLAUDE_ID), [agents]);
  // the chat's agent as the server reports it (`ready` / `caps`), else what this Mac recorded
  const [live, setLive] = useState(null);
  useEffect(() => conn?.onAgent?.(setLive), [conn]);
  const recorded = useMemo(() => readChatAgent(chatId), [chatId]);
  const [picked, setPicked] = useState(null);
  const [profile, setProfile] = useState(currentProfileId);
  useEffect(() => {
    if (!others) return undefined;
    let alive = true;
    void loadProfileId().then((id) => alive && setProfile(id));
    return () => {
      alive = false;
    };
  }, [others]);

  // what a new chat is set to; kept when the first send starts it (the server's word follows)
  const chosen = useRef(null);
  if (!started) chosen.current = picked ?? resolveNewChatAgent(agents, readLastAgent(profile));
  const value = started
    ? (live?.id ?? recorded ?? chosen.current ?? CLAUDE_ID)
    : (chosen.current ?? CLAUDE_ID);

  // a new chat asks for its agent on attach; Claude (or none) leaves the frame as it always was
  useEffect(() => {
    if (started || !loaded || !conn?.setAgent) return;
    conn.setAgent(value);
  }, [started, loaded, conn, value]);
  // a started chat this Mac recorded on another agent re-attaches to that agent (a reload, a reopened chat)
  useEffect(() => {
    if (recorded && recorded !== CLAUDE_ID && conn?.setAgent && !conn.attachAgent)
      conn.setAgent(recorded);
  }, [recorded, conn]);

  // the first send fixes the chat's agent, and makes it the profile's last-used one
  const wasStarted = useRef(started);
  useEffect(() => {
    const first = started && !wasStarted.current;
    wasStarted.current = started;
    if (!first || !loaded || !others || !chosen.current) return;
    writeChatAgent(chatId, chosen.current);
    writeLastAgent(profile, chosen.current);
  }, [started, loaded, others, chatId, profile]);

  return (
    <AgentPickerChip
      agents={agents}
      value={value}
      locked={started}
      lockedLabel={started ? (live?.label ?? null) : null}
      onPick={setPicked}
    />
  );
}
