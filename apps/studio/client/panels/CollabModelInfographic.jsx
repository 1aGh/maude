// Phase 29 (epic E4) Task 6 — the two-layer collab model, in one picture.
//
// Carries the whole mental model the collab tour teaches (see the teaching-model
// DDR): a LIVE layer (cursors · who's here · comments — automatic, no buttons)
// floating ABOVE the work cycle (Save changes locally → Publish for everyone →
// Pull changes — visible, has buttons). The two layers are NEVER mixed into one
// diagram — that split is the whole point. Rendered as the centered tour step's
// graphic (overlay.jsx `render` field) and embeddable elsewhere (e.g. the wizard
// success state). Pure presentational; cm-* classes live in 3-shell-maude.css.

function Glyph({ name, size = 16 }) {
  const p = {
    cursor: <path d="M3 2.5l9 4.2-3.8 1.2-1.2 3.8z" />,
    people: (
      <>
        <circle cx="6" cy="6" r="2.2" />
        <path d="M2.4 13a3.6 3.6 0 0 1 7.2 0" />
        <path d="M11 4.2a2.2 2.2 0 0 1 0 4.1M11.5 13a3.6 3.6 0 0 0-2-3.2" />
      </>
    ),
    comment: (
      <>
        <path d="M2.5 3.5h11v7h-6l-3 2.2V10.5h-2z" />
      </>
    ),
    save: (
      <>
        <path d="M3 2.5h7.5L13.5 5.5V13.5H3z" />
        <path d="M5 2.5V6h5V2.5" />
        <rect x="5.5" y="9" width="5" height="3" />
      </>
    ),
    publish: (
      <>
        <line x1="8" y1="13.4" x2="8" y2="6" />
        <polyline points="5 9 8 6 11 9" />
        <polyline points="3 4 3 2.6 13 2.6 13 4" />
      </>
    ),
    download: (
      <>
        <line x1="8" y1="2.5" x2="8" y2="10" />
        <polyline points="4.5 7 8 10.5 11.5 7" />
        <polyline points="3 12.8 3 13.6 13 13.6 13 12.8" />
      </>
    ),
    'arrow-right': (
      <>
        <line x1="2.5" y1="8" x2="13" y2="8" />
        <polyline points="9 4 13 8 9 12" />
      </>
    ),
  }[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={name === 'cursor' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {p}
    </svg>
  );
}

function CycleStep({ icon, label, sub }) {
  return (
    <span className="cm-step">
      <span className="cm-step-icon">
        <Glyph name={icon} size={16} />
      </span>
      <span className="cm-step-label">{label}</span>
      <span className="cm-step-sub">{sub}</span>
    </span>
  );
}

export default function CollabModelInfographic() {
  return (
    <div className="cm-info">
      {/* LIVE layer — floats above the work; presented as automatic. */}
      <div className="cm-live">
        <div className="cm-live-hd">
          <span className="cm-live-dot" aria-hidden="true" />
          <span>
            <b>Together</b> · automatic — no buttons
          </span>
        </div>
        <div className="cm-live-items">
          <span className="cm-live-item">
            <Glyph name="cursor" size={13} /> cursors
          </span>
          <span className="cm-live-item">
            <Glyph name="people" size={13} /> who's here
          </span>
          <span className="cm-live-item">
            <Glyph name="comment" size={13} /> comments
          </span>
        </div>
        <div className="cm-live-note">When you're both here, you see each other instantly.</div>
      </div>

      <div className="cm-bridge" aria-hidden="true">
        <span className="cm-bridge-line" />
        <span className="cm-bridge-label">the work itself</span>
        <span className="cm-bridge-line" />
      </div>

      {/* THE WORK — the visible three-verb cycle. */}
      <div className="cm-cycle">
        <CycleStep icon="save" label="Save changes locally" sub="keep a version on your machine" />
        <span className="cm-cyc-arrow" aria-hidden="true">
          <Glyph name="arrow-right" size={15} />
        </span>
        <CycleStep icon="publish" label="Publish for everyone" sub="share it with the team" />
        <span className="cm-cyc-arrow" aria-hidden="true">
          <Glyph name="arrow-right" size={15} />
        </span>
        <CycleStep icon="download" label="Pull changes" sub="get everyone else's work" />
      </div>
    </div>
  );
}
