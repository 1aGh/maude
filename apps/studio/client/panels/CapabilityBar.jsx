// The model / effort / mode picker row (feature-acp-panel-dynamic-claude-code-
// capabilities) — replaces the two hardcoded MODELS/EFFORTS `<select>`s that
// used to live in ChatPanel.jsx's Composer. Model/effort/mode come from the
// LIVE ACP session (`modes`/`configOptions`) — never a static list. Any OTHER
// advertised option (e.g. an "Agent persona" selector) is deliberately NOT
// rendered here — user call: keep this row to the three controls people
// actually reach for, not every generic config option the session offers.

import { flattenSelectOptions } from './acp-capabilities.js';

function OptionSelect({ id, label, currentValue, options, onChange, disabled }) {
  const flat = flattenSelectOptions(options);
  if (!flat.length) return null;
  return (
    <select
      className="chat-select"
      value={currentValue ?? ''}
      aria-label={label}
      title={flat.find((o) => o.value === currentValue)?.description || label}
      disabled={disabled}
      onChange={(e) => onChange(id, e.target.value)}
    >
      {flat.map((o) => (
        <option key={o.value} value={o.value}>
          {o.name || o.value}
        </option>
      ))}
    </select>
  );
}

export default function CapabilityBar({ modes, configOptions, onSetMode, onSetConfig, disabled }) {
  const modeList = modes?.availableModes ?? [];
  const model = configOptions?.model ?? null;
  const effort = configOptions?.effort ?? null;
  const fast = configOptions?.fast ?? null;

  // Nothing arrived yet — the session is still establishing (a fresh chat
  // spawns `claude` on first view; see ChatThread's warmedOnVisibleRef). Show
  // a placeholder instead of rendering nothing at all, so this row doesn't
  // read as "the picker disappeared" while it's just still connecting.
  if (!modeList.length && !model && !effort && !fast) {
    return (
      <span className="chat-caps chat-caps--connecting" data-testid="chat-caps-connecting">
        Connecting…
      </span>
    );
  }

  return (
    <div className="chat-caps" data-testid="chat-caps-bar">
      {modeList.length ? (
        <select
          className="chat-select"
          value={modes?.currentModeId ?? ''}
          aria-label="Permission mode"
          data-testid="chat-mode-picker"
          title={
            modeList.find((m) => m.id === modes?.currentModeId)?.description || 'Permission mode'
          }
          disabled={disabled}
          onChange={(e) => onSetMode(e.target.value)}
        >
          {modeList.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || m.id}
            </option>
          ))}
        </select>
      ) : null}
      {model ? (
        <OptionSelect
          id={model.id}
          label="Model"
          currentValue={model.currentValue}
          options={model.options}
          onChange={onSetConfig}
          disabled={disabled}
        />
      ) : null}
      {effort ? (
        <OptionSelect
          id={effort.id}
          label="Effort"
          currentValue={effort.currentValue}
          options={effort.options}
          onChange={onSetConfig}
          disabled={disabled}
        />
      ) : null}
      {fast ? (
        <OptionSelect
          id={fast.id}
          label="Fast mode"
          currentValue={fast.currentValue}
          options={fast.options}
          onChange={onSetConfig}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}
