// V2-2.19 rewrite fixture (contract V2-1.4 §6/§7): a three-artboard canvas with authored readable
// ids, one locked object, one hidden object, a shared component and a mapped list. The rewrite
// test stamps the remaining elements, rewrites one artboard the way an AI would, and checks that
// every id survives.
import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';

const PLANS = [
  { name: 'Starter', price: '0 €' },
  { name: 'Studio', price: '12 €' },
  { name: 'Team', price: '29 €' },
];

function Card({ title, body }: { title: string; body: string }) {
  return (
    <article className="card">
      <h3 className="card-title">{title}</h3>
      <p className="card-body">{body}</p>
      <a className="card-link" href="#more">
        Read more
      </a>
    </article>
  );
}

export default function Landing() {
  return (
    <DesignCanvas>
      <DCSection id="web" title="Web">
        <DCArtboard id="home" label="Home" width={1280} height={900}>
          <header data-cd-id="site-header" className="site-header" data-dc-element="site-header">
            <img data-cd-id="logo" data-cd-locked className="logo" src="/logo.svg" alt="Acme" />
            <nav className="nav">
              <a className="nav-link" href="#features">
                Features
              </a>
              <a className="nav-link" href="#pricing">
                Pricing
              </a>
              <a className="nav-link" href="#blog">
                Blog
              </a>
              <button data-cd-id="sign-in" className="btn btn-ghost" type="button">
                Sign in
              </button>
            </nav>
          </header>
          <section data-cd-id="hero" className="hero">
            <p className="eyebrow">New in 2026</p>
            <h1 data-cd-id="hero-title" className="hero-title">
              Design together, ship faster
            </h1>
            <p className="hero-lede">
              One canvas for the whole team. Comments, versions and handoff in the same place.
            </p>
            <div className="hero-actions">
              <button data-cd-id="see-pricing" className="btn btn-primary" type="button">
                See pricing
              </button>
              <button className="btn btn-secondary" type="button">
                Watch the demo
              </button>
            </div>
            <div
              data-cd-id="promo-banner"
              data-cd-hidden="flex"
              className="promo"
              style={{ display: 'none' }}
            >
              <span className="promo-text">Spring sale ends Friday</span>
            </div>
          </section>
          <section className="features">
            <h2 className="section-title">Why teams pick it</h2>
            <div className="feature-grid">
              <Card title="Live cursors" body="See who is where, as they work." />
              <Card title="Versions" body="Every save is a version you can name." />
              <Card title="Handoff" body="Specs and assets in one link." />
            </div>
          </section>
          <footer data-cd-id="footer" className="footer">
            <p className="footer-note">Made in Brno</p>
            <a className="footer-link" href="#privacy">
              Privacy
            </a>
            <a className="footer-link" href="#terms">
              Terms
            </a>
          </footer>
        </DCArtboard>
        <DCArtboard id="pricing" label="Pricing" width={1280} height={900}>
          <section className="pricing">
            <h2 data-cd-id="pricing-title" className="section-title">
              Simple pricing
            </h2>
            <p className="section-lede">Start free. Upgrade when the team grows.</p>
            <ul className="plan-list">
              {PLANS.map((p) => (
                <li key={p.name} className="plan">
                  <span className="plan-name">{p.name}</span>
                  <span className="plan-price">{p.price}</span>
                  <button className="btn btn-primary" type="button">
                    Choose
                  </button>
                </li>
              ))}
            </ul>
            <div className="faq">
              <h3 className="faq-title">Questions</h3>
              <details className="faq-item">
                <summary className="faq-q">Can I cancel any time?</summary>
                <p className="faq-a">Yes. Your canvases stay yours.</p>
              </details>
              <details className="faq-item">
                <summary className="faq-q">Is there a student plan?</summary>
                <p className="faq-a">Starter is free for students and teachers.</p>
              </details>
            </div>
          </section>
        </DCArtboard>
        <DCArtboard id="signup" label="Sign up" width={480} height={720}>
          <form data-cd-id="signup-form" className="form">
            <h2 className="form-title">Create your account</h2>
            <label className="field">
              <span className="field-label">Email</span>
              <input className="input" type="email" placeholder="you@studio.com" />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input className="input" type="password" />
            </label>
            <label className="check">
              <input type="checkbox" />
              <span className="check-label">Send me product news</span>
            </label>
            <button data-cd-id="create-account" className="btn btn-primary" type="submit">
              Create account
            </button>
            <p className="form-foot">
              Already have one? <a href="#sign-in">Sign in</a>
            </p>
          </form>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
