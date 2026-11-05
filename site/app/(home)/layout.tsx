import { SiteFoot } from '@/components/v2/site-foot';
import { SiteNav } from '@/components/v2/site-nav';
import { StillFlag } from '@/components/v2/still-flag.client';
import '../site-v2.css';

// Every (home) route wears the Maude 2 shell: one floating nav island, the page, one footer.
// Docs keep fumadocs' layout with the same links (lib/layout.shared.tsx).
export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <div className="v2-site">
      <StillFlag />
      <SiteNav />
      {children}
      <SiteFoot />
    </div>
  );
}
