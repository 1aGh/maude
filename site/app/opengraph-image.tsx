import { generate as DefaultImage } from 'fumadocs-ui/og';
import { ImageResponse } from 'next/og';
import { appName } from '@/lib/shared';

// Default social-share card for every non-docs route (homepage, /about,
// /changelog, /roadmap, /desktop). Docs pages override this with their own
// per-page card via `generateMetadata().openGraph.images` (see app/og/docs).
// Next auto-fills `twitter:image` from this when no twitter-image is present.
export const revalidate = false;
export const alt = 'maude — a Mac app for designing with AI';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    <DefaultImage
      title="maude"
      description="A Mac app for designing with AI. Built around AI, not bent to fit one."
      site={appName}
    />,
    { ...size }
  );
}
