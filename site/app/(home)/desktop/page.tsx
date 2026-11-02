import type { Metadata } from 'next';
import Link from 'next/link';
import { AppPreview } from '@/components/mdcc/app-preview';
import { SkuLabel } from '@/components/mdcc/sku-label';
import stats from '@/lib/stats.json';
import { DownloadButton } from './download-button';

export const metadata: Metadata = {
  alternates: { canonical: '/desktop' },
  title: 'Download Maude for Mac',
  description:
    'Download the Maude desktop app for Mac. Ask AI to make a canvas, edit it with real tools, share it. Free, open-source, no terminal needed, and it keeps itself up to date. Windows and Linux builds are listed too.',
};

// What's included — the value-prop trio (lifts the Studio Hub artboard A skeleton,
// rewritten for the native app: the app IS the studio, not the self-hosted hub).
const INCLUDED = [
  {
    title: 'Home and project tabs',
    body: 'Home asks “What shall we make?” and starts a canvas from your answer. Every project opens in its own tab, so a few projects sit side by side in one window.',
  },
  {
    title: 'AI chat panel',
    body: 'Ask for a screen and the result lands on the canvas as real .tsx files. Press ⌘/ on an element to ask about just that one. One ⌘Z takes back a whole AI run.',
  },
  {
    title: 'Edit and Preview',
    body: 'Draw with Shape, Pen, Text and Frame, with an Inspector for each kind. Switch to Preview and the canvas is a whiteboard: stickies, a marker, arrows, votes.',
  },
  {
    title: 'Version history and Share',
    body: 'Version history keeps saved versions, with Restore. Share puts a project in front of other people, and Present gives a stable link to show a canvas.',
  },
];

const FAQ = [
  {
    q: 'Does it require a terminal?',
    a: 'No. Download, install, open a project and start designing. The desktop app covers the same ground as the CLI, in the UI. If you would rather work from a terminal, the CLI and plugins are still there under Advanced.',
  },
  {
    q: 'Is it free?',
    a: 'Yes — open source under MIT. No telemetry, no signup, no “book a demo” button.',
  },
  {
    q: 'What about the AI?',
    a: 'The AI chat panel drives a paired Claude Code on your own Pro/Max subscription, never API billing. It talks to the `claude` you already have installed, and asks to connect the first time you send a message.',
  },
  {
    q: 'Does it update itself?',
    a: 'Yes. Maude downloads new versions in the background and tells you when one is ready to apply. No npm, no terminal.',
  },
  // Cloud Phase 24 A7. Windows is not code-signed yet, so the OS tells a
  // first-time user that the app is dangerous at the exact moment they are
  // following our instructions. Until there is a certificate, the honest thing
  // is to say what they will see BEFORE they see it — an unexplained
  // SmartScreen warning is where a non-technical installer stops.
  {
    q: 'Windows says the app is not recognised. Is something wrong?',
    a: 'No — that warning is expected, and we would rather tell you than let it surprise you. The Windows installer is not code-signed yet (the certificate is an annual cost we have not paid), so SmartScreen shows “Windows protected your PC”. Choose “More info”, then “Run anyway”. macOS builds are signed and notarised by Apple and show no such warning.',
  },
];

export default function DesktopPage() {
  return (
    <main className="mdcc-landing" id="main-content">
      <section className="mdcc-hero" aria-labelledby="desktop-h1">
        <div className="mdcc-hero-copy">
          <div className="mdcc-hero-sku">
            <SkuLabel>MDCC-APP/06</SkuLabel>
            <span aria-hidden="true">·</span>
            <span>DESKTOP</span>
            <span aria-hidden="true">·</span>
            <span>{stats.version}</span>
            <span aria-hidden="true">·</span>
            <span>MAC · WINDOWS · LINUX</span>
          </div>
          <h1 id="desktop-h1">
            Install <span style={{ color: 'var(--accent)' }}>Maude</span>.
          </h1>
          <p className="mdcc-hero-punchline">
            A Mac app built around AI, not bent to fit one. Ask AI for a canvas, edit it with real
            tools, share it. No terminal, and it keeps itself up to date.
          </p>
          <DownloadButton />
          <p className="mdcc-hero-fineprint">
            Free and open source. Requires <strong>macOS 13+</strong> (Apple Silicon or Intel). The
            AI chat panel pairs with your own <Link href="/docs/design">Claude Code</Link>. Windows
            10+ and Linux builds are listed under the button. Prefer a terminal?{' '}
            <Link href="/#advanced">Advanced: install from the command line.</Link>
          </p>
        </div>

        <AppPreview />
      </section>

      <section aria-labelledby="incl-h">
        <div className="mdcc-section-head">
          <h2 id="incl-h">What&apos;s included.</h2>
          <span className="mdcc-eyebrow">one app · zero terminal · {stats.version}</span>
        </div>
        <div className="mdcc-cat-grid">
          {INCLUDED.map((item) => (
            <div key={item.title} className="mdcc-cat-card" style={{ cursor: 'default' }}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="req-h">
        <div className="mdcc-section-head">
          <h2 id="req-h">System requirements.</h2>
        </div>
        <dl className="mdcc-about-meta">
          <div>
            <dt>macOS</dt>
            <dd>13 Ventura or newer · Intel or Apple Silicon · .dmg</dd>
          </div>
          <div>
            <dt>Windows</dt>
            <dd>
              10 or newer · 64-bit · .msi · <strong>not code-signed yet</strong> — SmartScreen will
              warn; choose “More info” then “Run anyway”
            </dd>
          </div>
          <div>
            <dt>Disk</dt>
            <dd>~250 MB</dd>
          </div>
          <div>
            <dt>AI chat panel</dt>
            <dd>
              optional — a paired <Link href="/docs/design">Claude Code</Link>
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="faq-h">
        <div className="mdcc-section-head">
          <h2 id="faq-h">FAQ.</h2>
        </div>
        <dl className="mdcc-desktop-faq">
          {FAQ.map((item) => (
            <div key={item.q}>
              <dt>{item.q}</dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
        <p className="mdcc-hero-fineprint">
          Running a team? Share can connect to a hub you host yourself, see{' '}
          <Link href="/docs/hub">self-hosting the hub</Link>.
        </p>
      </section>
    </main>
  );
}
