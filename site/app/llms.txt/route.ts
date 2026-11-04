import { llms } from 'fumadocs-core/source';
import { siteDescription, siteUrl } from '@/lib/shared';
import { source } from '@/lib/source';

export const revalidate = false;

// What a model should know before it reads the page list: the one-line pitch, then the two ways in.
const INTRO = `${siteDescription} Maude is a Mac app (also on Windows) that opens real TSX files in your own git project, so the work does not vanish with a chat. It also ships as two Claude Code plugins, a CLI and an optional self-hosted hub. Free and open-source (MIT), no telemetry. Maude Cloud puts a project online for a team, priced per project, never per seat: ${siteUrl}/cloud. Start with "Using Maude" for the app; "Advanced" holds the plugins, the CLI, the references and the recipes.`;

export function GET() {
  const [title, ...rest] = llms(source).index().split('\n');
  return new Response([title, '', `> ${INTRO}`, ...rest].join('\n'));
}
