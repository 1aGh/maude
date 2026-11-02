// client/v2/onboarding/CliSheet.jsx — "Install the maude command" (02 ob-adv-sheets, S6.9; contract Q13). Two rows
// with their real status (the command, the Claude Code plugin) and the two Terminal lines to copy. A view: the
// caller reads `/_home/cli/status` and runs `/_home/cli/install`. The server never overwrites what already sits
// at ~/.local/bin/maude; whatever it refuses with comes back as `error`, in its words, and shows under the rows.

import { useState } from 'react';

import { HIcon } from '../../home/home-icons.jsx';
import { AdvModal, AdvSheet, Sw } from './AdvSheet.jsx';
import { CLI_WORDS as W, cliDone, cliRows } from './onboarding-model.js';

function CopyLine({ text, id, copy }) {
  const [done, setDone] = useState(false);
  return (
    <span className="ob-cmd">
      <span className="ob-mono-txt">{text}</span>
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        data-testid={`onb-cli-copy-${id}`}
        onClick={async () => {
          try {
            await copy(text);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch {
            /* the line stays on screen to select by hand */
          }
        }}
      >
        {done ? W.copied : W.copy}
      </button>
    </span>
  );
}

/**
 * @param {{ status: object|null, busy?: boolean, error?: string|null, onInstall: () => void,
 *           onCancel: () => void, copy?: (text: string) => Promise<unknown> }} props
 */
export function CliSheet({
  status,
  busy = false,
  error = null,
  onInstall,
  onCancel,
  copy = (t) => navigator.clipboard.writeText(t),
}) {
  const rows = cliRows(status);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  const running = by.plugin.state === 'busy';
  return (
    <AdvModal onCancel={onCancel}>
      <AdvSheet
        id="cli"
        title={W.title}
        verb={W.verb}
        busyVerb={W.busy}
        busy={busy || running}
        canSubmit={status != null && !cliDone(status)}
        onSubmit={onInstall}
        onCancel={onCancel}
      >
        <span className="ob-inst">
          <span className="ob-inst-ic" aria-hidden="true">
            <HIcon name="terminal" size={16} />
          </span>
          <span className="ob-inst-t">
            <strong>{W.cmd}</strong>
            <span>{W.cmdSub}</span>
          </span>
          <Sw state={by.cmd.state} testid="onb-cli-cmd-status">
            {by.cmd.word}
          </Sw>
        </span>
        <span className="ob-inst">
          <span className="ob-inst-ic" aria-hidden="true">
            <HIcon name="layers" size={14} />
          </span>
          <span className="ob-inst-t">
            <strong>{W.plugin}</strong>
            <span>{W.pluginSub}</span>
          </span>
          <Sw state={by.plugin.state} testid="onb-cli-plugin-status">
            {by.plugin.word}
          </Sw>
        </span>
        {error ? (
          <p className="ai-conn-err" role="alert" data-testid="onb-cli-error">
            {error}
          </p>
        ) : null}
        <span className="ob-cmds">
          <span className="ob-cmds-h">{W.terminal}</span>
          <CopyLine id="npm" text={W.npm} copy={copy} />
          <CopyLine id="plugin" text={W.marketplace} copy={copy} />
        </span>
      </AdvSheet>
    </AdvModal>
  );
}
