/**
 * Vendors the Font Awesome Free icons this dashboard uses into a single
 * generated TypeScript module.
 *
 * Why not the npm package or the CDN: the CDN is a third-party request on every
 * page load (and the Workers CSP would have to allow it), and the full npm
 * package is ~2000 icons for the ~50 used here. Extracting the paths at build
 * time gives inline SVG with no runtime dependency and no network.
 *
 * Font Awesome Free icons are CC BY 4.0 — see NOTICE.md for the attribution
 * this obligation requires. Do not remove it.
 *
 *   node scripts/build-icons.mjs /path/to/Font-Awesome
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const SOLID = [
  'heart-pulse', 'gauge-high', 'diagram-project', 'sterling-sign', 'users', 'robot',
  'calendar-days', 'arrow-trend-up', 'arrow-trend-down', 'circle-check', 'circle-exclamation',
  'triangle-exclamation', 'code-branch', 'code-commit', 'bolt', 'cloud', 'credit-card',
  'chart-line', 'wallet', 'seedling', 'clock', 'plus', 'pen', 'trash', 'arrow-right',
  'arrow-up-right-from-square', 'moon', 'sun', 'database', 'gear', 'envelope', 'building',
  'hourglass-half', 'ban', 'rotate', 'play', 'scale-balanced', 'magnifying-glass-chart',
  'link', 'flask', 'list-check', 'bullseye', 'circle-nodes', 'tower-broadcast',
  'money-bill-trend-up', 'handshake', 'user-plus', 'file-invoice-dollar', 'chart-pie',
  'server', 'shield-halved', 'xmark', 'check', 'spinner', 'ellipsis', 'crosshairs', 'signal',
];
const BRANDS = ['github', 'stripe', 'cloudflare', 'google'];

const root = process.argv[2] ?? process.env.FONT_AWESOME_DIR;
if (!root) {
  console.error('Usage: node scripts/build-icons.mjs /path/to/Font-Awesome');
  process.exit(1);
}

/** Pull the viewBox and every path `d` out of one Font Awesome SVG. */
async function extract(dir, name) {
  const file = join(root, 'svgs', dir, `${name}.svg`);
  await access(file);
  const svg = await readFile(file, 'utf8');

  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  if (!viewBox) throw new Error(`${name}: no viewBox`);

  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (paths.length === 0) throw new Error(`${name}: no path data`);

  return { viewBox, path: paths.join(' ') };
}

const icons = {};
const missing = [];

for (const [dir, names] of [['solid', SOLID], ['brands', BRANDS]]) {
  for (const name of names) {
    // Brand icons share the namespace with solid ones; prefix so `github` and a
    // hypothetical solid `github` cannot collide.
    const key = dir === 'brands' ? `brand-${name}` : name;
    try {
      icons[key] = await extract(dir, name);
    } catch (error) {
      missing.push(`${dir}/${name}: ${error.message}`);
    }
  }
}

if (missing.length) {
  console.error('Could not extract:\n  ' + missing.join('\n  '));
  process.exit(1);
}

const body = Object.entries(icons)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([key, { viewBox, path }]) => `  '${key}': { viewBox: '${viewBox}', path: '${path}' },`)
  .join('\n');

const out = `/**
 * GENERATED — do not edit. Run \`npm run icons:build\` to regenerate.
 *
 * Font Awesome Free icon paths, vendored so the dashboard makes no third-party
 * request to render a chevron. Icons are CC BY 4.0; the attribution in
 * NOTICE.md is a licence obligation, not a courtesy.
 *
 * Source: https://github.com/FortAwesome/Font-Awesome
 */

export interface IconDef {
  viewBox: string;
  path: string;
}

export const ICONS: Record<string, IconDef> = {
${body}
};

export type IconName = keyof typeof ICONS;
`;

await writeFile('lib/icons.generated.ts', out);
console.log(`Wrote lib/icons.generated.ts — ${Object.keys(icons).length} icons.`);
