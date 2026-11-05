// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
import { Sticky } from './kit/canvas';
import { Icon, Spark } from './kit/glyphs';
import { Avatar } from './kit/people';
import { Thumb } from './kit/thumb';

export function How() {
  return (
    <section className="ps-wrap ps-section--tight" aria-labelledby="h-how">
      <div className="ps-head">
        <span className="ps-eyebrow">How it feels</span>
        <h2 id="h-how" className="ps-h2">
          Feels like a design tool. Works like a teammate.
        </h2>
      </div>
      <div className="ps-grid-3">
        <article className="ps-card ps-tile">
          <div className="ps-tile-pic" aria-hidden="true">
            <span className="ps-mini-board" style={{ left: 40, top: 32, width: 220, height: 132 }}>
              <Thumb art="price" />
            </span>
            <span className="ps-mini-ring" style={{ left: 36, top: 28, width: 228, height: 140 }} />
            <span className="ps-mini-tag" style={{ left: 168, top: 14 }}>
              <Spark size={10} /> AI is drawing
            </span>
            <span className="island ps-mini-ask" style={{ left: 64, top: 166 }}>
              Make the price bigger
              <span className="ps-send">
                <Icon name="arrow" size={12} />
              </span>
            </span>
          </div>
          <div className="ps-tile-txt">
            <h3 className="ps-h3">Draw it, or ask for it</h3>
            <p className="ps-body">
              The tools you expect are all there. When typing is faster than drawing, ask AI about
              the thing you selected.
            </p>
          </div>
        </article>
        <article className="ps-card ps-tile">
          <div className="ps-tile-pic" aria-hidden="true">
            <span className="ps-check-row" style={{ left: 32, top: 34 }}>
              <span className="ps-t">
                <Icon name="check" size={14} />
              </span>{' '}
              Colours from your system
            </span>
            <span className="ps-check-row" style={{ left: 64, top: 86 }}>
              <span className="ps-t">
                <Icon name="check" size={14} />
              </span>{' '}
              Type scale, spacing, radii
            </span>
            <span className="ps-check-row" style={{ left: 40, top: 138 }}>
              <span className="ps-w">
                <Icon name="problem" size={14} />
              </span>{' '}
              Button text 3.1:1, raise it to 4.5
            </span>
          </div>
          <div className="ps-tile-txt">
            <h3 className="ps-h3">Your design system, on every artboard</h3>
            <p className="ps-body">
              Colours, type and components come from your own system. New work is checked against
              it, so drafts stay on brand.
            </p>
          </div>
        </article>
        <article className="ps-card ps-tile">
          <div className="ps-tile-pic" aria-hidden="true">
            <span className="ps-mini-board" style={{ left: 36, top: 36, width: 190, height: 140 }}>
              <Thumb art="home" />
            </span>
            <Sticky color="lilac" x={200} y={52} rotate={3} w={120}>
              Love this hero
            </Sticky>
            <Sticky color="green" x={250} y={118} rotate={-2} w={96}>
              Ship it
            </Sticky>
            <span style={{ position: 'absolute', left: 44, top: 186, display: 'flex', gap: 4 }}>
              <Avatar who="tereza" size="sm" />
              <Avatar who="jonas" size="sm" />
            </span>
          </div>
          <div className="ps-tile-txt">
            <h3 className="ps-h3">Share a link, talk on the canvas</h3>
            <p className="ps-body">
              Invite people to a project. They leave stickies and comments in Preview, and you
              present straight from the canvas.
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}
