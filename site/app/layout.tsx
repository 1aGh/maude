import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Track } from '@/components/v2/track.client';
import { appName, gitConfig, siteDescription, siteUrl, tagline } from '@/lib/shared';
import stats from '@/lib/stats.json';
import './global.css';

// maude type system — Inter (body/UI), Inter Tight (display headings),
// JetBrains Mono (code + numerics). Wired to --font-body / --font-display /
// --font-mono in global.css. See DDR-09X token retarget.
// Self-hosted variable woff2 (latin, SIL OFL 1.1 — licences beside the files in
// app/fonts/), so the build never fetches from Google: next/font/google failed
// the CI site build whenever the fetch did.
const jetbrains = localFont({
  src: './fonts/jetbrains-mono-latin-wght-normal.woff2',
  variable: '--font-mdcc-mono',
  weight: '100 800',
  display: 'swap',
});

const inter = localFont({
  src: './fonts/inter-latin-wght-normal.woff2',
  variable: '--font-inter',
  weight: '100 900',
  display: 'swap',
});

const interTight = localFont({
  src: './fonts/inter-tight-latin-wght-normal.woff2',
  variable: '--font-inter-tight',
  weight: '100 900',
  display: 'swap',
});

// Site-wide structured data (schema.org). Disambiguates "Maude" (this Claude
// Code toolkit) from the many other "Maude" entities — the rewriting-logic
// language, getmaude.com, etc. — for search engines and AI answer engines.
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${siteUrl}/#website`,
      url: `${siteUrl}/`,
      name: 'Maude',
      description: tagline,
      inLanguage: 'en',
      publisher: { '@id': `${siteUrl}/#person` },
    },
    {
      '@type': 'Person',
      '@id': `${siteUrl}/#person`,
      name: 'Michal Dovrtěl',
      url: `${siteUrl}/about`,
      sameAs: [`https://github.com/${gitConfig.user}`],
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${siteUrl}/#software`,
      name: appName,
      alternateName: '@1agh/maude',
      applicationCategory: 'DesignApplication',
      applicationSubCategory: 'Desktop app for designing with AI',
      operatingSystem: 'macOS, Windows, Linux',
      softwareVersion: stats.version.replace(/^v/, ''),
      description:
        'A desktop app for designing with AI. Canvases are real TSX files in your git repo, so the work does not disappear with the chat. Also ships as two Claude Code plugins (design + flow), a CLI and an optional self-hosted sync hub. Open-source, MIT, no telemetry.',
      url: `${siteUrl}/`,
      downloadUrl: `${siteUrl}/desktop`,
      installUrl: 'https://www.npmjs.com/package/@1agh/maude',
      codeRepository: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
      license: 'https://opensource.org/licenses/MIT',
      isAccessibleForFree: true,
      author: { '@id': `${siteUrl}/#person` },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ],
};

// Cloudflare Web Analytics (cookieless). The token is a public identifier that the
// beacon sends to Cloudflare, but it is supplied by the deploy (GitHub variable
// CF_BEACON_TOKEN → NEXT_PUBLIC_CF_BEACON_TOKEN), never committed. Unset = no beacon.
const cfBeaconToken = process.env.NEXT_PUBLIC_CF_BEACON_TOKEN;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'maude: a design canvas built around AI',
    template: '%s | maude',
  },
  description: siteDescription,
  openGraph: {
    title: 'maude',
    description: siteDescription,
    type: 'website',
    siteName: 'maude',
  },
  twitter: { card: 'summary_large_image' },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${jetbrains.variable} ${inter.variable} ${interTight.variable} mdcc`}
      data-theme="light"
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static, build-time JSON-LD structured data
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <a className="mdcc-skip-link" href="#main-content">
          Skip to main
        </a>
        <RootProvider>{children}</RootProvider>
        <Track />
        {cfBeaconToken ? (
          <script
            defer
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: cfBeaconToken })}
          />
        ) : null}
      </body>
    </html>
  );
}
