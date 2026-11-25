// Samples which location contour is visible at every point of the biped paperdolls, exactly as the
// app's hit testing sees it, so build.mjs can lay rails out inside the real silhouettes.
//
//   node scripts/paperdolls/masks.mjs
//
// Needs playwright-core, which the repo does not depend on: install it without saving, or point
// PLAYWRIGHT_CORE at an installed copy (a file:// URL of its index.mjs). CHROME overrides the browser.
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = path.join(ROOT, 'public/images/paperdolls');
const outDir = path.join(ROOT, 'tmp/paperdolls/masks');
const files = ['biped-armor.svg', 'biped-armor-back.svg', 'biped-structure.svg'];
const SCALE = 5; // samples per unit
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
for (const file of files) {
  const source = fs.readFileSync(`${srcDir}/${file}`, 'utf8').replace(/<\?xml[^>]*\?>/, '');
  const viewBox = /viewBox="([^"]+)"/.exec(source)[1].split(/[\s,]+/).map(Number);
  const width = Math.ceil(viewBox[2] * SCALE), height = Math.ceil(viewBox[3] * SCALE);
  const page = await browser.newPage({ viewport: { width: width + 2, height: height + 2 } });
  const sized = source.replace(/<svg\b([^>]*)>/, (match, attributes) =>
    `<svg${attributes.replace(/\s(width|height)="[^"]*"/g, '')} width="${viewBox[2] * SCALE}" height="${viewBox[3] * SCALE}" preserveAspectRatio="xMinYMin meet">`);
  await page.setContent(`<body style="margin:0">${sized}</body>`);
  const result = await page.evaluate(({ width, height }) => {
    const keys = [], index = new Map(), rows = [];
    for (let y = 0; y < height; y++) {
      const row = new Uint8Array(width);
      for (let x = 0; x < width; x++) {
        const hit = document.elementsFromPoint(x + 0.5, y + 0.5).find((element) => element.classList.contains('unitLocation')
          && (element.classList.contains('armor') || element.classList.contains('structure')));
        if (!hit) continue;
        const key = `${hit.classList.contains('armor') ? 'armor' : 'structure'}:${hit.getAttribute('data-loc')}${hit.hasAttribute('data-rear') ? '_R' : ''}`;
        if (!index.has(key)) { index.set(key, keys.length + 1); keys.push(key); }
        row[x] = index.get(key);
      }
      rows.push(String.fromCharCode(...Array.from(row, (value) => 48 + value)));
    }
    return { keys, rows };
  }, { width, height });
  fs.writeFileSync(`${outDir}/${file}.json`, JSON.stringify({ viewBox, scale: SCALE, width, height, ...result }));
  console.log(file, width, height, result.keys.join(' '));
  await page.close();
}
await browser.close();
