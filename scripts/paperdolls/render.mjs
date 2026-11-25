// Renders build.mjs previews to PNG in Chrome (other rasterisers ignore the transform-origin the
// Boxy SVG fill paths rely on and draw them out of place).
//
//   node scripts/paperdolls/render.mjs [previewDir] <name> ...     e.g. biped-armor vehicle-turret
//
// playwright-core and Chrome are found as in masks.mjs.
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const dir = args.length && fs.existsSync(args[0]) && fs.statSync(args[0]).isDirectory()
  ? args.shift() : path.join(ROOT, 'tmp/paperdolls/out/preview');
const names = args;
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
for (const name of names) {
  const svg = fs.readFileSync(`${dir}/${name}.svg`, 'utf8').replace(/<\?xml[^>]*\?>/, '');
  const width = Number(/<svg[^>]*\swidth="(\d+)"/.exec(svg)[1]), height = Number(/<svg[^>]*\sheight="(\d+)"/.exec(svg)[1]);
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<body style="margin:0;background:#fff">${svg}</body>`);
  await page.screenshot({ path: `${dir}/${name}.png` });
  await page.close();
}
await browser.close();
