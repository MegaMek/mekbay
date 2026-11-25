// Regenerates the pip placeholders of public/images/paperdolls: one blue data-fill outline per
// location and green five-pip data-rail segments (the Grouped pip layout).
//
//   node scripts/paperdolls/masks.mjs                (bipeds only, once: needs playwright-core)
//   node scripts/paperdolls/build.mjs [outDir] [file ...]
//
// Writes <outDir>/<file>, a preview with every rail filled in <outDir>/preview, and report.txt;
// outDir defaults to tmp/paperdolls/out. Copy the results over public/images/paperdolls when happy.
//
// Bipeds: the blue areas, canon rectangles and the hand-made LT/RT rails of biped-armor.svg are kept;
// the other rails are laid out inside the location silhouettes sampled by masks.mjs.
// Everything else: outlines and rails come from the MegaMekLab row rectangles, which the converted
// files no longer contain; they are read from the last commit that had them (ROWS_COMMIT).
// The capital-ship grids (jumpship, warship, spacestation) and the damage-transfer images are left alone.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyMatrix, flattenPath, loopsBounds, loopsToPath, multiply, parseTransform, rectUnionLoops, round,
  erodeRects, signedArea, simplifyLoop, smoothStairs, splitSections,
} from './geom.mjs';
import { generateRails, regionFromLoops } from './rails.mjs';

const { parseDocument } = createRequire(import.meta.url)('htmlparser2');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = 'public/images/paperdolls';
const ROWS_COMMIT = 'd1fd0cccc';
const MASKS = path.join(ROOT, 'tmp/paperdolls/masks');
const [outDir = path.join(ROOT, 'tmp/paperdolls/out'), ...only] = process.argv.slice(2);
const SKIP = /transfer|^jumpship|^warship|^spacestation/;
const STROKE_RATIO = 0.21, PIP_GAP = 0.2;

/** Artwork the authored rows run underneath, in the coordinates of the pip group (measured in the browser). */
const OBSTACLES = {
  // The structural integrity box sits on the last nose rows of the conventional fighter.
  'fighter-conventional.svg|armor|NOS': { x0: 105.44, x1: 172.52, y0: 170.86, y1: 224.25 },
};

/** Requested pip radius of each sheet family, in asset units (see the record sheet layouts). */
function requestedRadius(file, type) {
  if (file.startsWith('biped-')) return type === 'structure' ? 1.55 : 2.15;
  if (/^(quad|quadvee|tripod)-/.test(file)) return 2.45;
  if (file.startsWith('protomek-')) return type === 'structure' ? 1 : 3;
  if (/^(fighter|smallcraft|dropship)-/.test(file)) return 3;
  return 4;
}

/** Pip pitch along a rail; bipeds follow the hand-made torso rails, the rest their authored row height. */
function basePitch(file, type, rowHeight) {
  if (file.startsWith('biped-')) return type === 'structure' ? 4.3 : 5.93;
  return rowHeight;
}

/** Clear space between a pip and the drawn silhouette of a biped location (half the outline plus air). */
/** Share of a row height the merged fill outlines keep clear of their authored rows, which run up to the border. */
const FILL_CLEARANCE = 0.12;
/** Rails are laid out by hand-like rules and keep more air; they give it up only when a location needs the room. */
const RAIL_CLEARANCES = [0.25, 0.12, 0];
const SILHOUETTE_CLEARANCE = 2.1;

function pipMetrics(file, type, pitch) {
  const footprint = 1 + STROKE_RATIO / 2;
  const radius = Math.min(requestedRadius(file, type), (pitch - PIP_GAP) / (2 * footprint));
  const diameter = 2 * radius * footprint;
  const biped = file.startsWith('biped-');
  const clearance = biped ? SILHOUETTE_CLEARANCE * (type === 'structure' ? 0.7 : 1) : 0;
  return { pitch, radius, columnPitch: diameter + PIP_GAP, margin: diameter / 2 + clearance };
}

/** The visible silhouette of a location, as sampled in the browser by masks.mjs. */
function regionFromMask(mask, key) {
  const code = String.fromCharCode(48 + mask.keys.indexOf(key) + 1);
  const { width, height, scale, viewBox } = mask;
  let x0 = width, x1 = -1, y0 = height, y1 = -1;
  const inside = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = mask.rows[y];
    for (let x = 0; x < width; x++) {
      if (row[x] !== code) continue;
      inside[y * width + x] = 1;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) throw new Error(`no silhouette for ${key}`);
  const at = (x, y) => (x >= 0 && x < width && y >= 0 && y < height ? inside[y * width + x] : 0);
  const edge = [];
  for (let y = y0 - 1; y <= y1 + 1; y++) {
    for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (!at(x, y) && (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1))) edge.push([x, y]);
    }
  }
  // Distance of each inside sample to the silhouette edge, in asset units.
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const distance = new Float32Array(w * h);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside[y * width + x]) continue;
      let nearest = Infinity;
      for (const [ex, ey] of edge) {
        const d = (ex - x) * (ex - x) + (ey - y) * (ey - y);
        if (d < nearest) nearest = d;
      }
      distance[(y - y0) * w + (x - x0)] = (Math.sqrt(nearest) - 0.5) / scale;
    }
  }
  const sample = (x, y) => (x >= 0 && x < w && y >= 0 && y < h ? distance[y * w + x] : 0);
  return {
    bounds: { x0: viewBox[0] + x0 / scale, x1: viewBox[0] + (x1 + 1) / scale, y0: viewBox[1] + y0 / scale, y1: viewBox[1] + (y1 + 1) / scale },
    valid: (ux, uy, margin) => {
      const px = (ux - viewBox[0]) * scale - 0.5 - x0, py = (uy - viewBox[1]) * scale - 0.5 - y0;
      const fx = Math.floor(px), fy = Math.floor(py), tx = px - fx, ty = py - fy;
      const value = sample(fx, fy) * (1 - tx) * (1 - ty) + sample(fx + 1, fy) * tx * (1 - ty)
        + sample(fx, fy + 1) * (1 - tx) * ty + sample(fx + 1, fy + 1) * tx * ty;
      return value >= margin;
    },
  };
}

/**
 * The most pips the rules allow in a location, where they set a limit: rails beyond it are never used.
 * Meks: 100 tons (armor twice the internal structure, head 9; a torso shares its total with the rear).
 * ProtoMeks: 15 tons. Vehicles: internal structure of the heaviest chassis of the diagram; their armor
 * has no limit per location. Aerospace: structural integrity of typical designs.
 */
function locationMaximum(file, type, location) {
  const armor = type === 'armor';
  if (/^(biped|quad|quadvee|tripod)-/.test(file)) {
    if (location === 'CT_R') return 30;
    if (location.endsWith('_R')) return 20;
    if (location === 'HD') return armor ? 9 : 3;
    if (location === 'CT') return armor ? 55 : 31;
    if (location === 'LT' || location === 'RT') return armor ? 40 : 21;
    if (location === 'LA' || location === 'RA') return armor ? 34 : 17;
    return armor ? 42 : 21;
  }
  if (file.startsWith('protomek-')) {
    const quad = file === 'protomek-quad.svg';
    const table = armor
      ? { HD: 9, T: 30, RA: 6, LA: 6, L: quad ? 28 : 16, MG: 6 }
      : { HD: 4, T: 15, RA: 4, LA: 4, L: quad ? 14 : 8, MG: 2 };
    return table[location] ?? null;
  }
  if (location === 'RO') return armor ? 2 : 3;
  if (armor) return null;
  if (location === 'SI') return file.startsWith('fighter-') ? 15 : file.startsWith('smallcraft-') ? 20 : 40;
  if (file.startsWith('vtol-')) return 6;
  if (file.startsWith('wige-')) return 8;
  if (file.startsWith('naval-superheavy-')) return 56;
  if (file.startsWith('naval-')) return 30;
  if (file.startsWith('vehicle-superheavy-')) return 30;
  if (file.startsWith('vehicle-')) return 10;
  return null;
}

/** A Mek head never exceeds nine armor: its last rail holds exactly the rest, centred. */
function trimToTarget(result, target, pitch) {
  let filled = 0;
  for (const rail of result.rails) {
    const rest = target - filled;
    if (rest > 0 && rest < rail.capacity) {
      const middle = [(rail.from[0] + rail.to[0]) / 2, (rail.from[1] + rail.to[1]) / 2];
      const length = Math.hypot(rail.to[0] - rail.from[0], rail.to[1] - rail.from[1]);
      const direction = [(rail.to[0] - rail.from[0]) / length, (rail.to[1] - rail.from[1]) / length];
      const at = (distance) => [middle[0] + direction[0] * distance, middle[1] + direction[1] * distance];
      rail.capacity = rest;
      rail.from = at(-rest * pitch / 2);
      rail.to = at(rest * pitch / 2);
      rail.pips = Array.from({ length: rest }, (_, index) => at((index - (rest - 1) / 2) * pitch));
    }
    filled += rail.capacity;
  }
  result.rails = result.rails.filter((rail, index) =>
    result.rails.slice(0, index).reduce((sum, earlier) => sum + earlier.capacity, 0) < target);
  result.capacity = result.rails.reduce((sum, rail) => sum + rail.capacity, 0);
}

/** The largest pips that still give the location enough groups of five. */
function chooseRails(file, location, pitch, outer, symmetric = false) {
  const biped = file.startsWith('biped-');
  const mek = /^(biped|quad|quadvee|tripod)-/.test(file);
  const maximum = locationMaximum(file, location.type, location.location);
  const target = maximum ?? Math.max(2, Math.ceil(location.nominal * 0.6));
  const head = mek && location.type === 'armor' && location.location === 'HD';
  // Biped pips keep their size; only their spacing may tighten toward the hand-made torso rails' limit.
  const scales = biped ? [1, 0.95, 0.9, 0.86] : [1, 0.94, 0.88, 0.82, 0.76];
  // Keep the full clearance from the border whenever the location still holds its pips with it.
  const cache = new Map();
  const attempt = (level, scale) => {
    const key = `${level}:${scale}`;
    if (!cache.has(key)) {
      const metrics = pipMetrics(file, location.type, pitch * scale);
      // A head's five and four sit centred above each other, which already interlocks them.
      const options = { ...metrics, outer, target, symmetric, stagger: !head };
      let result = generateRails(location.regions[level], head ? { ...options, mode: 'H' } : options);
      if (head && result.capacity < target) result = generateRails(location.regions[level], options);
      cache.set(key, { scale, level, metrics, result });
    }
    return cache.get(key);
  };
  const levels = location.regions.map((_, level) => level);
  const reaches = (candidate) => candidate.result.capacity >= target && candidate.result.full;
  const first = (pairs) => {
    for (const [level, scale] of pairs) {
      const candidate = attempt(level, scale);
      if (reaches(candidate)) return candidate;
    }
    return null;
  };
  // The last level has no clearance left (unless the location only exists without one).
  const cleared = levels.length > 1 ? levels.slice(0, -1) : levels;
  const large = scales.filter((scale) => scale >= 0.88), small = scales.filter((scale) => scale < 0.88);
  const worth = (candidate) => candidate.result.capacity * candidate.scale ** 1.5 * (1 - candidate.level * 0.05);
  // Clearance first, but not at the price of much smaller pips; no clearance only when nothing else fits.
  // Bipeds keep the spacing of the hand-made torso rails unless that leaves a location well short.
  const handMade = biped ? attempt(0, 1) : null;
  let chosen = (handMade && handMade.result.full && handMade.result.capacity >= target * 0.8 ? handMade : null)
    ?? first(cleared.flatMap((level) => large.map((scale) => [level, scale])))
    ?? first(cleared.flatMap((level) => small.map((scale) => [level, scale])));
  if (!chosen) {
    const all = levels.flatMap((level) => scales.map((scale) => attempt(level, scale)));
    const withClearance = all.filter((candidate) => cleared.includes(candidate.level) && candidate.result.full);
    chosen = (withClearance.length ? withClearance : all)
      .reduce((best, candidate) => (worth(candidate) > worth(best) + 1e-9 ? candidate : best));
  }
  if (head) trimToTarget(chosen.result, target, chosen.metrics.pitch);
  else if (maximum !== null) {
    // Rails past the location's maximum would never fill: keep the first ones, which sit a lane apart.
    let held = 0;
    const result = { ...chosen.result, rails: chosen.result.rails.filter((rail) => {
      const keep = held < maximum;
      held += rail.capacity;
      return keep;
    }) };
    result.capacity = result.rails.reduce((sum, rail) => sum + rail.capacity, 0);
    chosen = { ...chosen, result };
  }
  return { ...chosen, target };
}

const elements = (node, out = []) => {
  for (const child of node.children ?? []) {
    if (child.type === 'tag') {
      out.push(child);
      elements(child, out);
    }
  }
  return out;
};
const ancestorMatrix = (node, stop = null) => {
  let matrix = [1, 0, 0, 1, 0, 0];
  for (let current = node.parent; current && current !== stop && current.type === 'tag'; current = current.parent) {
    matrix = multiply(parseTransform(current.attribs.transform), matrix);
  }
  return matrix;
};
const invert = ([a, b, c, d, e, f]) => {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};
const indentOf = (source, index) => {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  return /^[ \t]*/.exec(source.slice(lineStart, index))[0];
};
const styleValue = (style, name) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(style ?? '')?.[1].trim();

function mirrorOf(first, second, tolerance = 0.3) {
  const a = loopsBounds(first), b = loopsBounds(second);
  const axis = (a.x0 + a.x1 + b.x0 + b.x1) / 4;
  if (Math.abs((a.x0 + a.x1) / 2 - axis) < 1) return null;
  const pointsA = first.flat(), pointsB = second.flat();
  if (pointsA.length !== pointsB.length) return null;
  const matches = pointsA.every(([x, y]) => pointsB.some(([bx, by]) => Math.hypot(2 * axis - x - bx, y - by) <= tolerance));
  return matches ? axis : null;
}

function railMarkup(location, type, rails, indent, digits, strokeWidth) {
  if (rails.length === 0) return '';
  const style = `fill: none; stroke: rgb(0, 255, 0); stroke-width: ${strokeWidth}; stroke-linecap: round; stroke-dasharray: ${round(strokeWidth * 2, 2)};`;
  const lines = rails.map((rail, index) =>
    `${indent}  <path d="M ${round(rail.from[0], digits)} ${round(rail.from[1], digits)} L ${round(rail.to[0], digits)} ${round(rail.to[1], digits)}" style="${style}" data-rail-capacity="${rail.capacity}" data-rail-index="${index + 1}"/>`);
  return `${indent}<g data-rail="${type}" data-location="${location}">\n${lines.join('\n')}\n${indent}</g>`;
}

function previewPips(rails, radius, limit) {
  let remaining = limit;
  const circles = [];
  for (const rail of rails) {
    for (const [x, y] of rail.pips.slice(0, Math.max(0, remaining))) {
      circles.push(`<circle cx="${round(x)}" cy="${round(y)}" r="${round(radius)}" fill="#fff" stroke="#000" stroke-width="${round(radius * STROKE_RATIO)}"/>`);
    }
    remaining -= rail.capacity;
  }
  return `<g data-preview="1">${circles.join('')}</g>`;
}

/** Fill outline of one location, in the coordinates of the element that will hold its rails. */
function collectLocations(file, document) {
  const locations = [];
  const all = elements(document);
  if (file.startsWith('biped-')) {
    const railGroups = all.filter((node) => node.attribs['data-rail'] && node.name === 'g');
    for (const node of all) {
      const type = node.attribs['data-fill'];
      if (type !== 'armor' && type !== 'structure') continue;
      const location = node.attribs['data-location'];
      const railGroup = railGroups.find((group) => group.attribs['data-rail'] === type && group.attribs['data-location'] === location);
      if (!railGroup) throw new Error(`${file}: no rail group for ${type} ${location}`);
      let loops;
      if (node.name === 'rect') {
        const x = Number(node.attribs.x), y = Number(node.attribs.y), w = Number(node.attribs.width), h = Number(node.attribs.height);
        loops = [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]];
      } else {
        loops = flattenPath(node.attribs.d);
      }
      let matrix = parseTransform(node.attribs.transform);
      if (node.attribs.transform) {
        // Boxy SVG keeps the pivot in CSS.
        const origin = styleValue(node.attribs.style, 'transform-origin');
        let pivot = [0, 0];
        if (origin) {
          if (origin.includes('%')) {
            const bounds = loopsBounds(loops);
            pivot = [(bounds.x0 + bounds.x1) / 2, (bounds.y0 + bounds.y1) / 2];
          } else {
            pivot = origin.split(/\s+/).map((value) => parseFloat(value));
          }
        }
        matrix = multiply(multiply([1, 0, 0, 1, pivot[0], pivot[1]], matrix), [1, 0, 0, 1, -pivot[0], -pivot[1]]);
      }
      const toRailParent = multiply(invert(ancestorMatrix(railGroup)), multiply(ancestorMatrix(node), matrix));
      locations.push({
        type, location, rowHeight: null,
        loops: loops.map((loop) => loop.map((point) => applyMatrix(toRailParent, point))),
        replace: { start: railGroup.startIndex, end: railGroup.endIndex + 1 },
        keepRails: file === 'biped-armor.svg' && (location === 'LT' || location === 'RT'),
        writeFill: false,
        maskKey: `${type}:${location}`,
      });
      if (ancestorMatrix(railGroup).some((value, index) => Math.abs(value - [1, 0, 0, 1, 0, 0][index]) > 1e-9)) {
        throw new Error(`${file}: rails of ${location} sit in a transformed group`);
      }
    }
    return locations;
  }

  const byKey = new Map();
  const profiles = all.filter((node) => node.name === 'g' && /(^|\s)paperdoll-pip-profile(\s|$)/.test(node.attribs.class ?? ''));
  for (const profile of profiles) {
    for (const rect of elements(profile)) {
      if (rect.name !== 'rect') continue;
      const type = rect.attribs['data-fill'];
      if (type !== 'armor' && type !== 'structure') throw new Error(`${file}: unexpected rect in profile`);
      const location = rect.attribs['data-location'];
      const key = `${profile.parent.startIndex}|${type}|${location}`;
      if (!byKey.has(key)) byKey.set(key, { type, location, frames: new Map(), profiles: new Set(), heights: [], nominal: 0 });
      const entry = byKey.get(key);
      entry.profiles.add(profile);
      const matrix = multiply(ancestorMatrix(rect, profile.parent), parseTransform(rect.attribs.transform));
      const x = Number(rect.attribs.x), y = Number(rect.attribs.y), w = Number(rect.attribs.width), h = Number(rect.attribs.height);
      const spans = [[x, x + w]];
      if (rect.attribs['data-gap']) {
        const [left, right] = rect.attribs['data-gap'].split(',').map(Number);
        spans.splice(0, 1, [x, left], [right, x + w]);
      }
      // Rows of a rotated group are merged in the group's own axes, then rotated as one outline.
      const rotated = Math.abs(matrix[1]) > 1e-9 || Math.abs(matrix[2]) > 1e-9;
      const frame = rotated ? matrix.map((value) => round(value, 6)).join(',') : '';
      if (!entry.frames.has(frame)) entry.frames.set(frame, { matrix: rotated ? matrix : null, rects: [] });
      for (const [from, to] of spans) {
        if (to - from <= 1e-6) continue;
        const [ax, ay] = rotated ? [from, y] : applyMatrix(matrix, [from, y]);
        const [bx, by] = rotated ? [to, y + h] : applyMatrix(matrix, [to, y + h]);
        entry.frames.get(frame).rects.push({ x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by) });
        entry.nominal += Math.floor((to - from) / h + 1e-6);
      }
      entry.heights.push(h);
    }
  }
  // Armor rows that run into a structure band (ProtoMek main gun) end where the band begins.
  const subtract = (rect, hole) => {
    if (hole.x1 <= rect.x0 + 1e-6 || hole.x0 >= rect.x1 - 1e-6 || hole.y1 <= rect.y0 + 1e-6 || hole.y0 >= rect.y1 - 1e-6) return [rect];
    return [
      { ...rect, y1: Math.min(rect.y1, hole.y0) },
      { ...rect, y0: Math.max(rect.y0, hole.y1) },
      { ...rect, y0: Math.max(rect.y0, hole.y0), y1: Math.min(rect.y1, hole.y1), x1: Math.min(rect.x1, hole.x0) },
      { ...rect, y0: Math.max(rect.y0, hole.y0), y1: Math.min(rect.y1, hole.y1), x0: Math.max(rect.x0, hole.x1) },
    ].filter((part) => part.x1 - part.x0 > 1e-6 && part.y1 - part.y0 > 1e-6);
  };
  const structureRows = [...byKey.values()].filter((entry) => entry.type === 'structure')
    .flatMap((entry) => entry.frames.get('')?.rects ?? []);
  for (const entry of byKey.values()) {
    const frame = entry.frames.get('');
    if (entry.type !== 'armor' || !frame) continue;
    for (const hole of structureRows) frame.rects = frame.rects.flatMap((rect) => subtract(rect, hole));
  }
  const usedProfiles = new Set();
  for (const entry of byKey.values()) {
    const counts = new Map();
    entry.heights.forEach((height) => counts.set(height, (counts.get(height) ?? 0) + 1));
    const rowHeight = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const local = (rects) => rectUnionLoops(rects).map((loop) => simplifyLoop(smoothStairs(loop, rowHeight), 0.08));
    const outline = (frame, rects) => local(rects)
      .map((loop) => (frame.matrix ? loop.map((point) => applyMatrix(frame.matrix, point)) : loop));
    const frames = [...entry.frames.values()];
    const obstacle = OBSTACLES[`${file}|${entry.type}|${entry.location}`];
    if (obstacle) {
      for (const frame of frames) {
        frame.rects = frame.rects.flatMap((rect) => (rect.y1 <= obstacle.y0 + rowHeight * 0.1 || rect.y0 >= obstacle.y1
          ? [rect]
          : [{ ...rect, x1: Math.min(rect.x1, obstacle.x0) }, { ...rect, x0: Math.max(rect.x0, obstacle.x1) }]
            .filter((part) => part.x1 - part.x0 > 1e-6)));
      }
    }
    // Rows authored a hair apart (6.15 high, 6.2 pitch) are one stack: close gaps under a tenth of a row.
    for (const frame of frames) {
      const bottoms = [...new Set(frame.rects.map((rect) => rect.y1))];
      for (const rect of frame.rects) {
        const above = bottoms.find((bottom) => rect.y0 > bottom && rect.y0 - bottom < rowHeight * 0.1);
        if (above !== undefined) rect.y0 = above;
      }
    }
    // The outlines keep clear of the location border: the authored rows run right up to it.
    const erode = (share) => frames.map((frame) => ({ ...frame, rects: erodeRects(frame.rects, share * rowHeight) }));
    // Rails see the whole location; the filler needs each notch-free piece as its own area.
    const levels = RAIL_CLEARANCES.map(erode)
      .map((level) => level.flatMap((frame) => (frame.rects.length ? outline(frame, frame.rects) : [])))
      .filter((loops) => loops.length > 0);
    const loops = levels[0];
    // Slivers beside a main body (a row split by a cockpit, a corner tab) stay out of the filler's
    // outline; only sections of comparable size remain separate areas.
    const sectionArea = (section) => section.reduce((sum, rect) => sum + (rect.x1 - rect.x0) * (rect.y1 - rect.y0), 0);
    const fillFrames = [FILL_CLEARANCE, FILL_CLEARANCE / 2, 0].map(erode).find((level) => level.some((frame) => frame.rects.length > 0));
    const sections = fillFrames.flatMap((frame) => splitSections(frame.rects).map((section) => ({ frame, section, area: sectionArea(section) })));
    const largest = Math.max(...sections.map((item) => item.area));
    // A rotated stack keeps its own axes (rows stay rows for the filler) and carries the rotation.
    const areas = sections.filter((item) => item.area >= largest * 0.25)
      .map((item) => ({ loops: local(item.section), matrix: item.frame.matrix }));
    const dropped = sections.filter((item) => item.area < largest * 0.25).reduce((sum, item) => sum + item.area, 0);
    entry.droppedShare = dropped / sections.reduce((sum, item) => sum + item.area, 0);
    if (areas.some((area) => area.loops.length !== 1)) throw new Error(`${file}: ${entry.type} ${entry.location} section is not one outline`);
    const ordered = [...entry.profiles].sort((a, b) => a.startIndex - b.startIndex);
    const replacements = ordered.map((profile, index) => {
      if (usedProfiles.has(profile)) throw new Error(`${file}: profile shared by several locations`);
      usedProfiles.add(profile);
      return { start: profile.startIndex, end: profile.endIndex + 1, first: index === 0 };
    });
    locations.push({ type: entry.type, location: entry.location, rowHeight, loops, levels, areas, replacements, writeFill: true, nominal: entry.nominal, droppedShare: entry.droppedShare });
  }
  return locations;
}

async function processFile(file) {
  const source = file.startsWith('biped-')
    ? fs.readFileSync(path.join(ROOT, ASSETS, file), 'utf8')
    : execFileSync('git', ['show', `${ROWS_COMMIT}:${ASSETS}/${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const document = parseDocument(source, { xmlMode: true, withStartIndices: true, withEndIndices: true });
  const locations = collectLocations(file, document);
  const report = [];

  for (const type of ['armor', 'structure']) {
    const group = locations.filter((location) => location.type === type);
    if (group.length === 0) continue;
    const heights = new Map();
    group.forEach((location) => heights.set(location.rowHeight, (heights.get(location.rowHeight) ?? 0) + 1));
    const dominantHeight = [...heights].sort((a, b) => b[1] - a[1])[0][0];
    const pitch = basePitch(file, type, dominantHeight);
    const allBounds = group.map((location) => loopsBounds(location.loops));
    const centreX = (Math.min(...allBounds.map((b) => b.x0)) + Math.max(...allBounds.map((b) => b.x1))) / 2;
    const mask = file.startsWith('biped-') ? JSON.parse(fs.readFileSync(path.join(MASKS, `${file}.json`), 'utf8')) : null;
    for (const location of group) {
      location.basePitch = pitch;
      // Biped rails may use the whole silhouette of the location; the rest keep to their authored rows.
      location.regions = mask ? [regionFromMask(mask, location.maskKey)] : location.levels.map(regionFromLoops);
    }
    const done = new Set();
    for (const location of group) {
      if (done.has(location)) continue;
      const bounds = loopsBounds(location.loops);
      const partner = group.find((other) => other !== location && !done.has(other) && mirrorOf(location.loops, other.loops) !== null);
      if (partner) {
        const axis = mirrorOf(location.loops, partner.loops);
        const [left, right] = bounds.x0 < loopsBounds(partner.loops).x0 ? [location, partner] : [partner, location];
        const chosen = chooseRails(file, left, pitch, 'min');
        Object.assign(left, chosen);
        const flip = ([x, y]) => [2 * axis - x, y];
        const mirrored = chosen.result.rails.map((rail) => ({ ...rail, from: flip(rail.from), to: flip(rail.to), pips: rail.pips.map(flip) }));
        const fits = mirrored.every((rail) => rail.pips.every(([x, y]) => right.regions[chosen.level].valid(x, y, chosen.metrics.margin - 0.45)));
        if (fits) Object.assign(right, chosen, { result: { ...chosen.result, rails: mirrored } });
        else {
          console.error(`${file}: ${right.location} is not a mirror of ${left.location}; laid out on its own`);
          Object.assign(right, chooseRails(file, right, pitch, 'max'));
        }
        done.add(left).add(right);
      } else {
        const middle = (bounds.x0 + bounds.x1) / 2;
        Object.assign(location, chooseRails(file, location, pitch, middle > centreX + 1 ? 'max' : 'min', Math.abs(middle - centreX) <= 1));
        done.add(location);
      }
    }
  }

  const edits = [], previewEdits = [];
  for (const location of locations) {
    const { metrics, result } = location;
    const digits = location.basePitch < 4.5 ? 3 : 2;
    const strokeWidth = round(Math.max(0.3, Math.min(1.5, location.basePitch / 6)), 2);
    const outer = location.loops.filter((loop) => signedArea(loop) > 0).length;
    report.push(`${file} ${location.type} ${location.location}: mode ${result.mode} rails ${result.rails.length} capacity ${result.capacity}${result.full ? '' : ' (short rails)'} loops ${location.loops.length}${location.loops.length > 1 ? ` (outer ${outer})` : ''} r=${round(metrics.radius, 2)} areas ${location.areas?.length ?? 1} dropped ${round((location.droppedShare ?? 0) * 100, 0)}% scale ${location.scale} level ${location.level} target ${location.target}${result.capacity < location.target ? ' SHORT' : ''}`);
    if (location.writeFill) {
      location.replacements.forEach((replacement) => {
        const indent = indentOf(source, replacement.start);
        if (!replacement.first) {
          // Drop the whole line of a profile group merged into an earlier one.
          const lineStart = source.lastIndexOf('\n', replacement.start - 1);
          const edit = { start: lineStart, end: replacement.end, text: '' };
          edits.push(edit);
          previewEdits.push(edit);
          return;
        }
        const fill = location.areas.map((area) =>
          `<path data-fill="${location.type}" data-location="${location.location}" d="${loopsToPath(area.loops, digits)}"${area.matrix ? ` transform="matrix(${area.matrix.map((value) => round(value, 6)).join(' ')})"` : ''} style="fill: none; stroke: rgb(0, 0, 255); stroke-width: ${strokeWidth}; stroke-dasharray: ${round(strokeWidth * 2, 2)};"/>`)
          .join(`
${indent}`);
        const rails = railMarkup(location.location, location.type, result.rails, indent, digits, strokeWidth);
        const text = rails ? `${fill}\n${rails}` : fill;
        edits.push({ start: replacement.start, end: replacement.end, text });
        previewEdits.push({ start: replacement.start, end: replacement.end, text: `${text}\n${previewPips(result.rails, metrics.radius, Infinity)}` });
      });
    } else if (location.keepRails) {
      // Preview the hand-made rails as they are.
      continue;
    } else {
      const indent = indentOf(source, location.replace.start);
      const text = railMarkup(location.location, location.type, result.rails, indent, digits, strokeWidth);
      edits.push({ ...location.replace, text });
      previewEdits.push({ ...location.replace, text: `${text}\n${previewPips(result.rails, metrics.radius, Infinity)}` });
    }
  }
  const apply = (list) => [...list].sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
  const output = apply(edits);
  fs.mkdirSync(path.join(outDir, 'preview'), { recursive: true });
  fs.writeFileSync(path.join(outDir, file), output);

  const viewBox = /viewBox="([^"]+)"/.exec(source)[1].split(/[\s,]+/).map(Number);
  const zoom = Math.min(6, 1400 / Math.max(viewBox[2], viewBox[3]));
  const preview = apply(previewEdits)
    .replace(/<svg\b([^>]*)>/, (match, attributes) =>
      `<svg${attributes.replace(/\s(width|height)="[^"]*"/g, '')} width="${Math.round(viewBox[2] * zoom)}" height="${Math.round(viewBox[3] * zoom)}"><rect x="${viewBox[0]}" y="${viewBox[1]}" width="${viewBox[2]}" height="${viewBox[3]}" fill="#fff"/>`)
    .replace(/visibility="hidden" data-mekbay-shield/g, 'display="none" data-mekbay-shield');
  fs.writeFileSync(path.join(outDir, 'preview', file), preview);
  return report;
}

const files = fs.readdirSync(path.join(ROOT, ASSETS)).filter((file) => file.endsWith('.svg') && !SKIP.test(file))
  .filter((file) => only.length === 0 || only.includes(file));
const reports = [];
for (const file of files) {
  const started = Date.now();
  try {
    reports.push(...await processFile(file));
    console.error(`${file}: ${Date.now() - started} ms`);
  } catch (error) {
    console.error(`${file}: FAILED ${error.stack}`);
  }
}
fs.writeFileSync(path.join(outDir, 'report.txt'), reports.join('\n'));
