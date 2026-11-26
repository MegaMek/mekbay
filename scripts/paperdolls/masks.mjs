// Samples which location is visible and free of artwork at every point of the paperdolls, as the
// app's hit testing and the eye see it, so build.mjs can size fill areas and rails to the real outlines.
//
//   node scripts/paperdolls/masks.mjs [file ...]
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
const only = process.argv.slice(2);
const files = fs.readdirSync(srcDir)
  .filter((file) => file.endsWith('.svg') && !/transfer|^jumpship|^warship|^spacestation/.test(file))
  .filter((file) => only.length === 0 || only.includes(file));
const SAMPLES = 1400; // along the longer side, at most 5 per unit
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
for (const file of files) {
  // Artwork edited after the conversion is sampled from its row-bearing source (see build.mjs).
  const edited = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sources', file);
  const source = fs.readFileSync(fs.existsSync(edited) ? edited : `${srcDir}/${file}`, 'utf8').replace(/<\?xml[^>]*\?>/, '');
  const viewBox = /viewBox="([^"]+)"/.exec(source)[1].split(/[\s,]+/).map(Number);
  const scale = Math.min(5, SAMPLES / Math.max(viewBox[2], viewBox[3]));
  const width = Math.ceil(viewBox[2] * scale), height = Math.ceil(viewBox[3] * scale);
  const page = await browser.newPage({ viewport: { width: width + 2, height: height + 2 } });
  const sized = source.replace(/<svg\b([^>]*)>/, (match, attributes) =>
    `<svg${attributes.replace(/\s(width|height)="[^"]*"/g, '')} width="${viewBox[2] * scale}" height="${viewBox[3] * scale}" preserveAspectRatio="xMinYMin meet">`);
  await page.setContent(`<body style="margin:0">${sized}</body>`);
  // Biped rails keep clear of the drawn outline by a fixed distance; the other diagrams' rows are
  // stretched up to the artwork, so there a sample under any drawn line is not free.
  const result = await page.evaluate(async ({ width, height, withArt }) => {
    const svg = document.querySelector('svg');
    svg.querySelectorAll('[data-fill], [data-rail], [data-canon]').forEach((element) => element.remove());
    let dark = null;
    if (withArt) {
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, width, height);
      dark = (x, y) => {
        const offset = (y * width + x) * 4;
        return 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2] < 150;
      };
    }
    const keys = [], index = new Map(), rows = [];
    for (let y = 0; y < height; y++) {
      const row = new Uint8Array(width);
      for (let x = 0; x < width; x++) {
        if (dark?.(x, y)) continue;
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
  }, { width, height, withArt: !file.startsWith('biped-') });
  fs.writeFileSync(`${outDir}/${file}.json`, JSON.stringify({ viewBox, scale, width, height, ...result }));
  console.log(file, width, height, result.keys.join(' '));
  await page.close();
}
await browser.close();
