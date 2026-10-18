// client/v2/empty/empty-canvas.jsx — S11.2 (05 es-canvas-ai · es-canvas-three): "Your canvas is ready."
//
// A new canvas says one line (CONTRACT §6, rule/the-empty-canvas-line) in the middle of the page, above the
// Edit toolbar, with Ask AI ⌘/ as the one spark button. Three situations, one line:
//   ready      online, AI connected — the line + Ask AI.
//   offline    the line keeps its first sentence and adds S5.13's "AI is back when this Mac is online."; the
//              spot goes quiet; Ask AI stays enabled (the prompt waits in line, S5.13).
//   connect    no Claude account yet — the line never changes; the first Ask AI asks once (ConnectSheet).
// W7 "no door": next to Ask AI sits "New artboard" — a way in that is not the AI (and the only action where
// the AI chat does not exist: a cloud tab, a browser tab).
//
// Presentational: the model (use-empty-canvas.js `emptyCanvasModel`) decides what is shown; the host
// (empty-host.jsx) supplies the handlers. `model === null` renders nothing at all.

import { copy } from './empty-copy.js';
import { AskButton } from './ask-button.jsx';
import { Empty } from './empty.jsx';
import { StIcon } from '../../shell/icons.jsx';
import ConnectSheet from '../ai/ConnectSheet.jsx';

const COPY_ID = {
  ready: 'es-canvas-ai.canvas-ready',
  connect: 'es-canvas-ai.canvas-ready', // "The empty-canvas line never changes for this case."
  offline: 'es-canvas-three.offline',
};

/**
 * @param {{ model: ReturnType<typeof import('./use-empty-canvas.js').emptyCanvasModel>,
 *   onAsk: () => void, onNewArtboard: () => void }} props
 */
export function EmptyCanvas({ model, onAsk, onNewArtboard }) {
  if (!model) return null;
  const words = copy(COPY_ID[model.variant]);
  const door = copy('es-canvas-ai.door');
  const actions = (
    <>
      {model.ask ? (
        <AskButton keys={words.keys} onClick={onAsk} testid="empty-canvas-ask">
          {words.action}
        </AskButton>
      ) : null}
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        data-testid="empty-canvas-door"
        onClick={onNewArtboard}
      >
        {door.action}
      </button>
    </>
  );
  return (
    <div className="es-ec" data-testid="empty-canvas" data-variant={model.variant}>
      <Empty
        size="canvas"
        spot="canvas"
        land
        quiet={model.quiet}
        title={words.title}
        next={
          model.offlineLine ? (
            <>
              {words.next}
              <br />
              <span className="es-off-line" data-testid="empty-canvas-offline">
                <StIcon name="offline" size={13} />
                {model.offlineLine}
              </span>
            </>
          ) : (
            words.next
          )
        }
        actions={actions}
      />
    </div>
  );
}

/**
 * The one sheet that asks to connect a Claude account (S5's ConnectSheet, as drawn in 05 es-canvas-three's third
 * column): a window sheet over a veil. The host owns what Connect does.
 * @param {{ phase?: 'idle'|'installing'|'waiting', error?: string|null, onConnect: () => void, onCancel: () => void }} props
 */
export function EmptyConnect({ phase = 'idle', error = null, onConnect, onCancel }) {
  return (
    <div className="es-conn-veil" data-testid="empty-connect">
      <ConnectSheet phase={phase} error={error} onConnect={onConnect} onCancel={onCancel} />
    </div>
  );
}
