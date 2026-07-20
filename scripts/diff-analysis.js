const fs = require('fs');
const path = require('path');

const origDir = 'C:/Projects/megamek/svgexport/unitfiles';
const ourDir = 'C:/Projects/megamek/svgexport/mbunitfiles';

function strip(t) {
  return t.split(/\r?\n/)
    .filter(l => !l.trimStart().startsWith('#'))
    .map(l => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const dr = new Map();

function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) { walk(f); continue; }
    if (!e.name.endsWith('.blk') && !e.name.endsWith('.mtf')) continue;
    const r = path.relative(origDir, f);
    const o = path.join(ourDir, r);
    if (!fs.existsSync(o)) continue;
    const a = strip(fs.readFileSync(f, 'utf-8'));
    const b = strip(fs.readFileSync(o, 'utf-8'));
    if (a === b) continue;
    const al = a.split('\n');
    const bl = b.split('\n');
    for (let i = 0; i < Math.max(al.length, bl.length); i++) {
      if (al[i] !== bl[i]) {
        const k = 'O:' + (al[i] || 'EOF').substring(0, 60) + ' | M:' + (bl[i] || 'EOF').substring(0, 60);
        dr.set(k, (dr.get(k) || 0) + 1);
        break;
      }
    }
  }
}

walk(origDir);
[...dr.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30)
  .forEach(([r, c]) => console.log(String(c).padStart(6) + '  ' + r));
