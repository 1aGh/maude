// client/v2/create/empty-project.jsx — S6.2: a project with no canvases (05 es-project-new, 01 cf-blank).
//
// The card is the S11.1 kit's `Empty size:'canvas' spot:'ai'`: the situation ("Portfolio 2026 has no canvases
// yet."), what to do ("Describe the first one and AI drafts it — or start blank."), the prompt box, and the one
// plain way out — "Start with an empty canvas ⌘N". NO toolbar: there is nothing to draw on yet, and the card
// is not drawn over a canvas, it stands in for the "No canvas open" placeholder (the viewport mounts it through
// <EmptyProjectSlot>). Every line is the kit table's (`es-project-new.*`), none is ours.
//
//   ↵ in the prompt   creates a canvas from the sentence — `fromPrompt` on the one create call (S6.1); the
//                     server names the canvas from it and S6.3 takes the sentence on to draft the first version.
//                     The Connect sheet does not appear here; it waits for the first SEND in the chat.
//   the button / ⌘N   a blank canvas, named by the server; it arrives with S11.2's "Your canvas is ready."
//   Can view          the situation only — no prompt, no button (the server still refuses the create).

import { useContext, useEffect, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { shellToast } from '../../shell/util.js';
import { ShellStoreContext } from '../../stores/shell-store.jsx';
import { SparkGlyph } from '../empty/ask-button.jsx';
import { copy, Empty } from '../empty/index.js';
import { projectEmptyModel, useProjectStarter } from './use-project-empty.js';

const PROMPT_LABEL = 'Describe the first canvas';

/** The prompt box: one line, a send on the right. ↵ and the send are the same door. */
function PromptBox({ placeholder, busy, onSubmit }) {
  // Uncontrolled: ↵ and the send read what is in the box now, so they never depend on a change event having
  // been seen. `hasText` only decides how the send button looks.
  const [hasText, setHasText] = useState(false);
  const input = useRef(null);
  // a fresh project is the one place the next thing to do is type — unless focus is already somewhere
  useEffect(() => {
    const active = globalThis.document?.activeElement;
    if (!active || active === globalThis.document.body) input.current?.focus();
  }, []);
  const send = () => onSubmit(input.current?.value ?? '');
  return (
    <div className="ep-ask">
      <input
        ref={input}
        type="text"
        className="ep-ask-in"
        data-testid="empty-project-prompt"
        aria-label={PROMPT_LABEL}
        placeholder={placeholder}
        readOnly={busy}
        onChange={(e) => setHasText(!!e.target.value.trim())}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent?.isComposing) return;
          e.preventDefault();
          send();
        }}
      />
      <button
        type="button"
        className="ep-ask-send"
        data-testid="empty-project-send"
        aria-label="Send"
        aria-disabled={busy || !hasText}
        data-idle={busy || !hasText ? '' : undefined}
        onClick={send}
      >
        <SparkGlyph size={14} />
      </button>
    </div>
  );
}

/**
 * The card. `deps` ({ fetchImpl, open, toast }) is for tests; the shell passes nothing.
 * @param {{ model: { project: string, canCreate: boolean },
 *   deps?: { fetchImpl?: typeof fetch, open?: (file: string) => void, toast?: (m: string) => void } }} props
 */
export function EmptyProject({ model, deps }) {
  const { busy, submit, blank } = useProjectStarter({ toast: shellToast, ...deps });
  const words = copy('es-project-new.project-none', { project: model.project });
  if (!model.canCreate) {
    return (
      <div className="ep-host" data-testid="empty-project-host">
        <Empty size="canvas" spot="ai" land title={words.title} testid="empty-project" />
      </div>
    );
  }
  return (
    <div className="ep-host" data-testid="empty-project-host">
      <Empty
        size="canvas"
        spot="ai"
        land
        testid="empty-project"
        title={words.title}
        next={words.next}
        chips={<PromptBox placeholder={words.placeholder} busy={busy} onSubmit={submit} />}
        actions={
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="empty-project-blank"
            disabled={busy}
            onClick={blank}
          >
            {words.action}
            <span className="es-keys">{words.keys}</span>
          </button>
        }
      />
    </div>
  );
}

/**
 * The viewport's mount (client/shell/viewport.jsx wraps its "No canvas open" placeholder in this): the card
 * when the project is loaded and holds no canvas; the placeholder (children) otherwise. Outside the shell store
 * (a bare Viewport in a test) it is only the placeholder. While the tree is still loading it draws nothing, so
 * the card does not flash in over a project that has canvases; a failed load shows the placeholder.
 */
export function EmptyProjectSlot({ children }) {
  const store = useContext(ShellStoreContext);
  const core = store?.shellCore;
  if (!core) return children ?? null;
  if (!core.treeLoaded) return core.treeLoadFailures > 0 ? (children ?? null) : null;
  const model = projectEmptyModel({
    groups: core.groups,
    treeLoaded: true,
    tabCount: core.tabs?.length ?? 0,
    viewerMode: !!core.viewerMode,
    project: core.project,
  });
  return model ? <EmptyProject model={model} /> : (children ?? null);
}

/**
 * The Canvases panel's line for a project with no canvases (05 es-project-new, the left panel): "No canvases
 * yet." through the kit, then the "New canvas" row — absent for a role that cannot edit.
 * @param {{ readOnly?: boolean, fetchImpl?: typeof fetch }} props
 */
export function PanelNoCanvases({ readOnly = false, fetchImpl }) {
  const { busy, blank } = useProjectStarter({ toast: shellToast, fetchImpl });
  const words = copy('es-project-new.panel-none');
  return (
    <div className="ep-panel-none">
      <Empty glyph="file" title={words.title} testid="canvases-none" className="es-e--inpanel">
        {words.next}
      </Empty>
      {readOnly ? null : (
        <button
          type="button"
          className="ep-panel-new"
          data-testid="canvases-none-new"
          disabled={busy}
          onClick={blank}
        >
          <StIcon name="plus" size={14} />
          {words.action}
        </button>
      )}
    </div>
  );
}

/** The panel's foot while the project has no canvases: why there are no folders either. */
export const PANEL_NONE_FOOT = copy('es-project-new.panel-none').foot;
