import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill } from 'remotion';
import {
  AIPanel, Artboard, Canvas, Cursor, HeroMock, Kbd, PhoneMock, ProjectPill, ShareCluster, Spark,
  Sticky, TABS, Thumb, Toast, Toolbar, Window, ZoomUndo,
} from '../../../vendor/maude-v2/_kit';
import { SiteStage, at, tween, useMs } from './stage';

/**
 * Beats 2 and 3: the AI run and the one undo.
 *
 * A RECREATION, not a capture: the site's HeroShot (Public Site v2 · HeroShot), the scripted AI
 * run on the canvas, played on the film clock. A live AI run is not deterministic, so the film
 * uses the same scripted run the site's hero plays. The pricing cards carry plan names, not
 * prices: the film shows no price (plan Decision 8).
 */

/** The hero's intro clock (ms), copied from the canvas. */
const T = {
  ask: 1300, reply: 1800, working: 2100, cursor: 2100, card1: 2700, card2: 2820, card3: 2940,
  prices: 3260, done: 3700, sticky: 3900,
};

/** Undo progress 0→1 for one drawn element, staggered by `k`. */
type Undo = (k: number) => CSSProperties;
const NO_UNDO: Undo = () => ({});

function RunCard({ left, plan, pick = false, d, undo }: { left: number; plan: string; pick?: boolean; d: number; undo: CSSProperties }) {
  return (
    <span style={{ position: 'absolute', inset: 0, ...undo }}>
      <span className="ps-run-card ps-a ps-a--draw" data-pick={pick ? 'true' : undefined} style={{ left, height: pick ? 176 : 156, ...at(d) }}>
        <i style={{ width: '60%' }} />
        <b className="ps-a ps-a--fade" style={at(T.prices)}>{plan}</b>
        <i />
        <i style={{ width: '80%' }} />
        <i style={{ width: '70%' }} />
        <span className="ps-run-btn" style={{ marginTop: 'auto' }} />
      </span>
    </span>
  );
}

/** The product window with the scripted run, at run time `t` (ms) and undo state `undo`. */
export function RunShot({ t = 99999, undo = NO_UNDO, undone = false, toast }: { t?: number; undo?: Undo; undone?: boolean; toast?: ReactNode }) {
  return (
    <div className="ps-shot">
      <Window tabs={[TABS.studio, TABS.alligators]} activeTab={0} label="Maude with the Studio site project open">
        <Canvas>
          <Artboard label="Home · Web desktop" kind="web" x={56} y={92} w={420} h={292}>
            <HeroMock />
          </Artboard>
          <Artboard label="Pricing · Web desktop" kind="web" x={512} y={92} w={300} h={292}>
            <span style={{ position: 'absolute', left: 20, top: 22, right: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, ...undo(0) }}>
              <span className="ps-a ps-a--fade" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--type-md)', ...at(T.card1 - 120) }}>Simple pricing</span>
              <span className="ps-a ps-a--fade" style={{ fontSize: 10, color: 'var(--fg-2)', ...at(T.card1) }}>Monthly · Yearly</span>
            </span>
            <RunCard left={22} plan="Solo" d={T.card1} undo={undo(1)} />
            <RunCard left={112} plan="Studio" pick d={T.card2} undo={undo(2)} />
            <RunCard left={202} plan="Team" d={T.card3} undo={undo(3)} />
          </Artboard>
          <Artboard label="Home · Mobile" kind="web" x={56} y={420} w={136} h={190}>
            <PhoneMock title="Studio site" tone="sky" />
          </Artboard>
          <Artboard label="Post 1:1" kind="digital" x={228} y={420} w={190} h={190} aiMade="Made by AI">
            <Thumb art="brand" w={190} h={190} />
          </Artboard>

          <span className="ps-a ps-a--on" style={at(T.working)}>
            <span className="ps-a ps-a--out" style={at(T.done)}>
              <span className="ps-run-ring" style={{ left: 508, top: 88, width: 308, height: 300 }} />
              <span className="ps-run-tag ps-run-tag--work" style={{ left: 660, top: 64 }}>
                <Spark size={10} color="currentColor" /> AI is drawing
              </span>
            </span>
          </span>
          <span style={{ position: 'absolute', left: 0, top: 0, ...undo(4) }}>
            <span className="ps-run-tag ps-run-tag--done ps-a ps-a--on" style={{ left: 712, top: 66, ...at(T.done) }}>
              <Spark size={10} /> Made by AI
            </span>
          </span>
          <span className="ps-float ps-a ps-a--glide" style={{ left: 0, top: 0, ['--fx' as string]: '260px', ['--fy' as string]: '180px', ...at(T.cursor) }}>
            <Cursor name="AI" agent x={744} y={262} />
          </span>

          <div className="ps-a ps-a--land" style={{ position: 'absolute', left: 540, top: 432, width: 180, ...at(T.sticky) }}>
            <Sticky color="yellow" x={0} y={0} rotate={-2} w={180}>Can the yearly price sit next to the monthly one?</Sticky>
          </div>
          <Cursor name="tereza" x={694} y={524} />
        </Canvas>
        <ProjectPill project="Studio site" canvas="Landing page" />
        <ShareCluster people={['tereza', 'jonas']} status="saved" mode="edit" />
        <ZoomUndo zoom={42} />
        <Toolbar />
        <AIPanel
          chat="Pricing page"
          scope="Pricing · Web desktop"
          // A message joins the panel when it is sent, so no empty bubble waits for its text.
          messages={[
            { from: 'you' as const, at: T.ask, text: <span className="ps-a ps-a--fade" style={at(T.ask)}>Make a pricing page with three plans. Use Tereza's yearly note.</span> },
            { from: 'ai' as const, at: T.reply, text: <span className="ps-a ps-a--fade" style={at(T.reply)}>Three cards on the Pricing artboard, monthly and yearly side by side.</span> },
          ].filter((m) => t >= m.at).map(({ from, text }) => ({ from, text }))}
        >
          <span className="ps-a ps-a--on" style={at(T.working)}>
            <span className="ps-a ps-a--out k-ai-msg" style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--spark-text)', ...at(T.done) }}>
              <Spark size={12} /> AI is drawing the pricing cards
            </span>
          </span>
          <p className="k-ai-msg k-ai-msg--ai ps-a ps-a--on" style={at(T.done)}>
            {undone ? 'Undone. Pricing is back the way it was.' : 'Done. Pricing has three plans, and the yearly price sits under each monthly one.'}
          </p>
        </AIPanel>
        {toast}
      </Window>
    </div>
  );
}

/** The camera: the 1200x720 window scaled into the frame, pushing in on the Pricing artboard. */
const Camera = ({ ms, from, children }: { ms: number; from: [number, number]; children: ReactNode }) => {
  const s = tween(ms, from, [1.02, 1.12]);
  const x = tween(ms, from, [0, -12]);
  const y = tween(ms, from, [0, -10]);
  return (
    <div style={{ position: 'absolute', left: 120, top: 45, width: 1200, height: 720, transform: `translate(${x}px, ${y}px) scale(${s})`, transformOrigin: '50% 42%' }}>
      {children}
    </div>
  );
};

/** Beat 2 (5–13 s): "Draw it yourself, or just ask. The AI draws right on the canvas while you watch." */
export const I2AiRun = () => {
  const ms = useMs();
  // The run's clock: the ask lands on "just ask" (~1.5 s), the AI starts drawing on "The AI draws" (~2.6 s).
  const t = ms - 200;
  return (
    <SiteStage t0={t}>
      <Camera ms={ms} from={[0, 8000]}>
        <RunShot t={t} />
      </Camera>
    </SiteStage>
  );
};

/** Beat 3 (13–18.5 s): "Don't like it? One undo takes the whole thing back." */
export const I2Undo = () => {
  const ms = useMs();
  const KEY = 1500; // the ⌘Z lands on "One undo"
  const undo: Undo = (k) => {
    const a = KEY + 150 + k * 70;
    const u = tween(ms, [a, a + 260], [0, 1]);
    return { opacity: 1 - u, transform: `scaleY(${1 - 0.7 * u})`, transformOrigin: '50% 0' };
  };
  const keyIn = tween(ms, [KEY - 200, KEY], [0, 1]);
  const keyOut = tween(ms, [KEY + 900, KEY + 1200], [0, 1]);
  const press = tween(ms, [KEY, KEY + 90], [0, 1]) - tween(ms, [KEY + 90, KEY + 220], [0, 1]);
  const toastIn = tween(ms, [KEY + 500, KEY + 800], [0, 1]);
  return (
    <SiteStage t0={60000}>
      <div style={{ position: 'absolute', left: 120, top: 45, width: 1200, height: 720, transform: 'translate(-12px, -10px) scale(1.12)', transformOrigin: '50% 42%' }}>
        <RunShot
          undo={undo}
          undone={ms > KEY + 500}
          toast={
            <div style={{ opacity: toastIn }}>
              <Toast icon="undo">Undid the AI run on Pricing</Toast>
            </div>
          }
        />
      </div>
      <AbsoluteFill style={{ display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
        <div style={{ opacity: keyIn * (1 - keyOut), transform: `scale(${(0.8 + 0.2 * keyIn) * (1 - 0.06 * press)})` }}>
          <span className="island" style={{ display: 'inline-flex', padding: 18, borderRadius: 24, transform: 'scale(2.4)' }}>
            <Kbd>⌘Z</Kbd>
          </span>
        </div>
      </AbsoluteFill>
    </SiteStage>
  );
};
