// Renders public/icons/icon.svg into the PNG icons used by the PWA manifest.
// Usage: node scripts/make-icons.mjs  (requires Playwright + Chromium, dev-only)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const svg = readFileSync(join(root, 'public/icons/icon.svg'), 'utf8');
// Full-bleed variant (no rounded corners) for maskable + Apple icons: OS applies its own mask.
const square = svg.replace('rx="112"', 'rx="0"');
// Maskable: shrink artwork into the 80% safe zone.
const maskable = square.replace('<g fill', '<g transform="translate(51.2 51.2) scale(0.8)" fill');

const jobs = [
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['icon-maskable-512.png', 512, maskable],
  ['apple-touch-icon-180.png', 180, square],
  ['favicon-32.png', 32, svg],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, markup] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: join(root, 'public/icons', name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', name);
}
await browser.close();
