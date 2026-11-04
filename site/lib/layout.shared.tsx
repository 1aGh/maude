import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { MaudeMark } from '@/components/mdcc/maude-mark';
import { gitConfig } from './shared';

// Mobile theme toggle — fumadocs renders it inside the burger menu (HomeLayout
// Header → NavigationMenuContent) and the sidebar drawer footer (DocsLayout).
// Keyboard-reachable via the menu trigger; we deliberately do NOT shadow the
// fumadocs button because DDR-011 mandates re-skin, not fork.
export function baseOptions(): BaseLayoutProps {
  const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2">
          <MaudeMark size={22} />
          <span className="mdcc-wm">maude</span>
        </span>
      ),
    },
    // The same three links and two buttons as the Home island (components/v2/site-nav.tsx).
    links: [
      { text: 'Product', url: '/', active: 'url' },
      { text: 'Docs', url: '/docs', active: 'nested-url' },
      { text: 'Pricing', url: '/cloud', active: 'nested-url' },
      { text: 'GitHub', url: githubUrl, external: true },
      { type: 'button', text: 'Download', url: '/desktop', secondary: true },
      { type: 'button', text: 'Get Maude Cloud', url: '/cloud' },
    ],
    // NB: no `githubUrl` here — the fumadocs GitHub *icon* it renders ships an
    // unlabeled `role="img"` <svg> (axe svg-img-alt, serious). The "GitHub"
    // text link above already covers GitHub, so the icon is redundant. DDR-09X.
  };
}
