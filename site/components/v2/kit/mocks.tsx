// Ported once from .design/ui/v2/_kit.tsx on 2026-11-04; site/ is the source now.
// Picture content for the product shot: the user's designs in object colours, pinned to the
// light palette (`mdcc-pin-light`) so they never re-colour with the site theme.

export function HeroMock({
  headline = 'Calm software, made in Brno.',
  sub = 'A small studio for product and brand.',
  cta = 'See the work',
}: {
  headline?: string;
  sub?: string;
  cta?: string;
}) {
  return (
    <div className="k-mk k-hp mdcc-pin-light k-fixed">
      <div className="k-hp-nav">
        <b />
        <i />
        <i />
        <i />
      </div>
      <div className="k-hp-hero">
        <span className="k-hp-sun" />
        <span className="k-hp-hill" />
      </div>
      <div className="k-hp-copy">
        <strong>{headline}</strong>
        <span>{sub}</span>
        <em>{cta}</em>
      </div>
      <div className="k-hp-tiles">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

export function PhoneMock({
  title = 'Your plan',
  tone = 'lilac',
}: {
  title?: string;
  tone?: 'yellow' | 'green' | 'lilac' | 'coral' | 'sky';
}) {
  return (
    <div className={`k-mk k-ph k-ph--${tone} mdcc-pin-light k-fixed`}>
      <span className="k-ph-notch" />
      <span className="k-ph-img" />
      <strong>{title}</strong>
      <i />
      <i />
      <em>Continue</em>
    </div>
  );
}
