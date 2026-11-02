// The "Watch the intro" player (DDR-166 Phase 1 / T2). Plays the bundled
// showreel — served from Maude's OWN /_media/ route (paths.ts MEDIA_DIR,
// DDR-045), never the served project's .design/assets/ — so it's available
// identically whether a project is open or not. Reuses the shared help-modal
// chrome (backdrop + header + body), same as ReadinessDialog / What's New.
import { useEffect } from 'react';

export default function IntroVideoDialog({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="help-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="help-modal help-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="intro-video-title"
      >
        <header className="help-modal-hd">
          <span className="title" id="intro-video-title">
            Watch the intro
          </span>
          <button
            type="button"
            className="help-modal-close"
            aria-label="Close (Esc)"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="help-modal-body intro-video-body">
          <video className="intro-video-el" src="/_media/intro.mp4" controls autoPlay playsInline />
        </div>
      </div>
    </div>
  );
}
