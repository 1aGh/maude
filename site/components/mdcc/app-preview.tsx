/**
 * AppPreview — a decorative sketch of the v2 desktop window for the marketing hero (V2-7.2).
 *
 * Not a screenshot and not interactive (aria-hidden): a project tab, the AI chat panel on the
 * left, a canvas with artboards on the right. The wording is the v2 vocabulary
 * (.design/system/maude-v2/CONTRACT.md §3–§4: canvas, artboard, AI chat panel, a result-first AI
 * message). It replaces the v1 sketch that showed a file tree and a git panel.
 */
export function AppPreview() {
  return (
    <aside className="mdcc-dl-preview" aria-hidden="true">
      <div className="mdcc-dl-preview-bar">
        <span className="mdcc-dl-dot" />
        <span className="mdcc-dl-dot" />
        <span className="mdcc-dl-dot" />
        <span className="mdcc-dl-preview-title">Studio site</span>
      </div>
      <div className="mdcc-dl-preview-body mdcc-dl-preview-body--app">
        <div className="mdcc-dl-preview-chat">
          <span className="mdcc-dl-preview-chat-label">AI chat</span>
          <p className="mdcc-dl-preview-msg mdcc-dl-preview-msg--you">Three hero variants.</p>
          <p className="mdcc-dl-preview-msg">
            Done — three hero variants are on the canvas. Pick one.
          </p>
        </div>
        <div className="mdcc-dl-preview-stage">
          <div className="mdcc-dl-preview-ab" />
          <div className="mdcc-dl-preview-ab" />
          <div className="mdcc-dl-preview-ab" />
        </div>
      </div>
    </aside>
  );
}
