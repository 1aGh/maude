// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
// The product shot plays one scripted AI run on a CSS clock (no JS), then offers Replay.
// Reduced motion and `?still=1`: the final frame only (cards drawn, run done, Tereza's sticky placed).
import { at, T } from './clock';
import { Artboard, Canvas, Cursor, Sticky, TABS, Window } from './kit/canvas';
import { Icon, Spark } from './kit/glyphs';
import { HeroMock, PhoneMock } from './kit/mocks';
import { AIPanel, ProjectPill, ShareCluster, Toolbar, ZoomUndo } from './kit/panels';
import { Thumb } from './kit/thumb';
import { ReplayShot } from './replay.client';

/** One pricing card the AI draws on the Pricing artboard in the product shot. */
function RunCard({
  left,
  price,
  pick = false,
  d,
}: {
  left: number;
  price: string;
  pick?: boolean;
  d: number;
}) {
  return (
    <span
      className="ps-run-card ps-a ps-a--draw"
      data-pick={pick ? 'true' : undefined}
      style={{ left, height: pick ? 176 : 156, ...at(d) }}
    >
      <i style={{ width: '60%' }} />
      <b className="ps-a ps-a--fade" style={at(T.prices)}>
        {price}
      </b>
      <i />
      <i style={{ width: '80%' }} />
      <i style={{ width: '70%' }} />
      <span className="ps-run-btn" style={{ marginTop: 'auto' }} />
    </span>
  );
}

export function HeroShot() {
  return (
    <ReplayShot shotAt={T.shot} replayAt={T.sticky + 600} runFrom={T.ask - 150}>
      <Window
        tabs={[TABS.studio, TABS.alligators]}
        activeTab={0}
        label="Maude with the Studio site project open: AI draws a pricing page while Tereza leaves a sticky"
      >
        <Canvas>
          <Artboard label="Home · Web desktop" kind="web" x={56} y={92} w={420} h={292}>
            <HeroMock />
          </Artboard>
          <Artboard label="Pricing · Web desktop" kind="web" x={512} y={92} w={300} h={292}>
            <span
              style={{
                position: 'absolute',
                left: 20,
                top: 22,
                right: 20,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span
                className="ps-a ps-a--fade"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: 'var(--type-md)',
                  ...at(T.card1 - 120),
                }}
              >
                Simple pricing
              </span>
              <span
                className="ps-a ps-a--fade"
                style={{ fontSize: 10, color: 'var(--fg-2)', ...at(T.card1) }}
              >
                Monthly · Yearly
              </span>
            </span>
            <RunCard left={22} price="Solo" d={T.card1} />
            <RunCard left={112} price="Studio" pick d={T.card2} />
            <RunCard left={202} price="Team" d={T.card3} />
          </Artboard>
          <Artboard label="Home · Mobile" kind="web" x={56} y={420} w={136} h={190}>
            <PhoneMock title="Studio site" tone="sky" />
          </Artboard>
          <Artboard
            label="Post 1:1"
            kind="digital"
            x={228}
            y={420}
            w={190}
            h={190}
            aiMade="Made by AI"
          >
            <Thumb art="brand" w={190} h={190} />
          </Artboard>

          {/* The run on the Pricing artboard: a spark ring + tag while it works, a quiet "Made by AI" after. */}
          <span className="ps-a ps-a--on" style={at(T.working)}>
            <span className="ps-a ps-a--out" style={at(T.done)}>
              <span
                className="ps-run-ring"
                style={{ left: 508, top: 88, width: 308, height: 300 }}
              />
              <span className="ps-run-tag ps-run-tag--work" style={{ left: 660, top: 64 }}>
                <Spark size={10} color="currentColor" /> AI is drawing
              </span>
            </span>
          </span>
          <span
            className="ps-run-tag ps-run-tag--done ps-a ps-a--on"
            style={{ left: 712, top: 66, ...at(T.done) }}
          >
            <Spark size={10} /> Made by AI
          </span>
          <span
            className="ps-float ps-a ps-a--glide"
            style={{
              left: 0,
              top: 0,
              ['--fx' as string]: '260px',
              ['--fy' as string]: '180px',
              ...at(T.cursor),
            }}
          >
            <Cursor name="AI" agent x={744} y={262} />
          </span>

          {/* Only the sticky moves: a box the sticky's own size, not a full-canvas layer. */}
          <div
            className="ps-a ps-a--land"
            style={{ position: 'absolute', left: 540, top: 432, width: 180, ...at(T.sticky) }}
          >
            <Sticky color="yellow" x={0} y={0} rotate={-2} w={180}>
              Can the yearly price sit next to the monthly one?
            </Sticky>
          </div>
          <Cursor name="tereza" x={694} y={524} />
        </Canvas>
        <ProjectPill project="Studio site" canvas="Landing page" />
        <ShareCluster people={['tereza', 'jonas']} />
        <ZoomUndo zoom={42} />
        <Toolbar />
        <AIPanel
          chat="Pricing page"
          scope="Pricing · Web desktop"
          messages={[
            {
              from: 'you',
              text: (
                <span className="ps-a ps-a--fade" style={at(T.ask)}>
                  Make a pricing page with three plans. Use Tereza's yearly note.
                </span>
              ),
            },
            {
              from: 'ai',
              text: (
                <span className="ps-a ps-a--fade" style={at(T.reply)}>
                  Three cards on the Pricing artboard, monthly and yearly side by side.
                </span>
              ),
            },
          ]}
        >
          <span className="ps-a ps-a--on" style={at(T.working)}>
            <span
              className="ps-a ps-a--out k-ai-msg"
              style={{
                display: 'flex',
                gap: 6,
                alignItems: 'center',
                color: 'var(--spark-text)',
                ...at(T.done),
              }}
            >
              <Spark size={12} /> AI is drawing the pricing cards
            </span>
          </span>
          <p className="k-ai-msg k-ai-msg--ai ps-a ps-a--on" style={at(T.done)}>
            Done. Pricing has three plans, and the yearly price sits under each monthly one.
          </p>
        </AIPanel>
      </Window>
    </ReplayShot>
  );
}

/** Under 720 px the full window does not fit, so the phone gets one artboard with the AI drawing on it. */
export function HeroShotMobile() {
  return (
    <div className="ps-m-shot" role="img" aria-label="An artboard with AI drawing on it">
      <span className="ps-mini-board" style={{ left: 24, top: 36, width: 220, height: 150 }}>
        <Thumb art="price" />
      </span>
      <span className="ps-mini-ring" style={{ left: 20, top: 32, width: 228, height: 158 }} />
      <span className="ps-mini-tag" style={{ left: 120, top: 18 }}>
        <Spark size={10} /> AI is drawing
      </span>
      <Sticky color="yellow" x={226} y={120} rotate={3} w={110}>
        Yearly too?
      </Sticky>
      <span className="island ps-mini-ask" style={{ left: 24, top: 196 }}>
        Make the price bigger
        <span className="ps-send">
          <Icon name="arrow" size={12} />
        </span>
      </span>
    </div>
  );
}
