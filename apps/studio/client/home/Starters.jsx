// client/home/Starters.jsx — the three starters under Home's question (S6.4, decision Q5).
// The catalogue and its picking are home-starters.js; this draws them. A click FILLS the prompt and
// does not send; "Bring my existing brand" (an action, not a sentence) runs `import-brand` in the target.

/** A small lifted illustration (the kit's `Thumb art`): four token-filled shapes, decorative. */
export function StarterArt({ art }) {
  return (
    <span className={`home-art home-art--${art}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * @param {{ starters: Array<{id:string,title:string,detail:string,art:string,intent?:string}>,
 *           onPick: (starter: object) => void }} props
 */
export function Starters({ starters, onPick }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled run of buttons, not a form fieldset
    <div className="home-starters" role="group" aria-label="Ways to start">
      {starters.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`home-starter${s.intent ? ' home-starter--action' : ''}`}
          data-testid={`home-starter-${s.id}`}
          onClick={() => onPick(s)}
        >
          <StarterArt art={s.art} />
          <span className="home-starter-t">
            <strong>{s.title}</strong>
            <span>{s.detail}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
