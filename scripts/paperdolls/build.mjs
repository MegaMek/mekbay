// Regenerates the pip placeholders of public/images/paperdolls: one blue data-fill outline per
// location and green five-pip data-rail segments (the Grouped pip layout).
//
//   node scripts/paperdolls/masks.mjs                (once, and after artwork changes: needs playwright-core)
//   node scripts/paperdolls/build.mjs [outDir] [file ...]
//
// Writes <outDir>/<file>, previews with every rail of a set filled in <outDir>/preview, and report.txt;
// outDir defaults to tmp/paperdolls/out. Copy the results over public/images/paperdolls when happy.
//
// Bipeds: the blue areas, canon rectangles and the hand-made LT/RT rails of biped-armor.svg are kept;
// the other rails are laid out inside the location silhouettes sampled by masks.mjs.
// Everything else: outlines and rails come from the MegaMekLab row rectangles, stretched out to the
// location outlines sampled by masks.mjs and trimmed by them, so every shape follows the drawn border
// at an even distance. The converted files no longer contain the rows; they are
// read from the last commit that had them (ROWS_COMMIT), or from scripts/paperdolls/sources where the
// artwork was edited since (ProtoMeks: labels outside the figure, larger head, internal structure in
// an enclosed sub-area of each location).
// The capital-ship grids (jumpship, warship, spacestation) and the damage-transfer images are left alone.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyMatrix, flattenPath, loopsBounds, loopsToPath, multiply, parseTransform, rectUnionLoops, round,
  erodeRects, fitToFree, insideLoops, signedArea, simplifyLoop, smoothStairs, splitSections,
} from './geom.mjs';
import { generateRails, regionFromLoops } from './rails.mjs';

const { parseDocument } = createRequire(import.meta.url)('htmlparser2');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSETS = 'public/images/paperdolls';
const ROWS_COMMIT = 'd1fd0cccc';
const MASKS = path.join(ROOT, 'tmp/paperdolls/masks');
/** Row-bearing sources whose artwork was edited after the conversion; they replace the pinned commit's. */
const SOURCES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sources');
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
  if (file.startsWith('protomek-')) return 3;
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
/** Share of a row height below which a part of a shape is too narrow for a pip and is left out. */
const MIN_WIDTH = 0.7;
/** Pip sizes tried from the largest down, as shares of the authored row height. */
const SCALES = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58, 0.52];
const LARGER_SCALES = [1.3, 1.15];
/** Biped pips keep their size; only their spacing may tighten toward the hand-made torso rails' limit. */
const BIPED_SCALES = [1, 0.95, 0.9, 0.86];
/** A further rail set must hold this much more than the one before it. */
const SET_STEP = 1.3;
/** Hundreds of pips are not counted in fives: such locations stop at this size and leave the rest to the filler. */
const LARGE_TARGET = 200, LARGE_SCALE = 0.76;
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
 * Vehicle and aerospace armor has no limit per location in the rules: the most that 99 of 100 canon
 * units carry there (mm-data unit files, November 2026). Heavier ones fall back to the distributed layout.
 */
const CANON_ARMOR = [
  [/^vtol-/, { FR: 36, RS: 28, LS: 28, RR: 24, TU: 20 }],
  [/^(vehicle|naval|wige)-superheavy-/, { FR: 136, FRRS: 104, FRLS: 104, RRRS: 92, RRLS: 92, RR: 64, TU: 110, FT: 110, RT: 66 }],
  [/^vehicle-/, { FR: 86, RS: 66, LS: 66, RR: 51, TU: 67, FT: 67, RT: 60 }],
  [/^naval-/, { FR: 80, RS: 66, LS: 66, RR: 55, TU: 60, FT: 60, RT: 60 }],
  [/^wige-/, { FR: 65, RS: 62, LS: 62, RR: 49, TU: 30, FT: 30, RT: 30 }],
  [/^fighter-aerospace/, { NOS: 121, RWG: 86, LWG: 86, AFT: 82 }],
  [/^fighter-conventional/, { NOS: 34, RWG: 33, LWG: 33, AFT: 33 }],
  [/^smallcraft-/, { NOS: 248, RS: 162, LS: 162, AFT: 120 }],
  [/^dropship-/, { NOS: 810, RS: 750, LS: 750, AFT: 705 }],
];

/**
 * The most pips a location is expected to hold: rails beyond it are never used.
 * Meks: 100 tons, tripods 200 (armor twice the internal structure, head 9; a torso shares its total with the rear).
 * ProtoMeks: 15 tons. Vehicles: internal structure of the heaviest chassis of the diagram, armor of the
 * canon units. Aerospace: structural integrity of typical designs.
 */
function locationMaximum(file, type, location) {
  const armor = type === 'armor';
  if (/^(biped|quad|quadvee|tripod)-/.test(file)) {
    // Nearly every canon tripod is superheavy: its diagram plans for 200 tons (Interstellar Operations:
    // Alternate Eras, Superheavy 'Mech Structure Table: head 4, center torso 60, side torsos 42,
    // arms 33, legs 42; head armor 12).
    const superheavy = file.startsWith('tripod-');
    if (location === 'CT_R') return superheavy ? 60 : 30;
    if (location.endsWith('_R')) return superheavy ? 42 : 20;
    const structure = location === 'HD' ? (superheavy ? 4 : 3)
      : location === 'CT' ? (superheavy ? 60 : 31)
        : location === 'LT' || location === 'RT' ? (superheavy ? 42 : 21)
          : location === 'LA' || location === 'RA' ? (superheavy ? 33 : 17)
            : superheavy ? 42 : 21;
    if (!armor) return structure;
    if (location === 'HD') return superheavy ? 12 : 9;
    // A 100-ton torso keeps points for its rear, as the hand-made biped rails assume.
    if (!superheavy && location === 'CT') return 55;
    if (!superheavy && (location === 'LT' || location === 'RT')) return 40;
    return structure * 2;
  }
  if (file.startsWith('protomek-')) {
    const quad = file === 'protomek-quad.svg';
    const table = armor
      ? { HD: 9, T: 30, RA: 6, LA: 6, L: quad ? 28 : 16, MG: 6 }
      : { HD: 4, T: 15, RA: 4, LA: 4, L: quad ? 14 : 8, MG: 2 };
    return table[location] ?? null;
  }
  if (location === 'RO') return armor ? 2 : 3;
  if (armor) return CANON_ARMOR.find(([family]) => family.test(file))?.[1][location] ?? null;
  if (location === 'SI') return file.startsWith('fighter-') ? 15 : file.startsWith('smallcraft-') ? 20 : 40;
  if (file.startsWith('vtol-')) return 6;
  if (file.startsWith('wige-')) return 8;
  if (file.startsWith('naval-superheavy-')) return 56;
  if (file.startsWith('naval-')) return 30;
  if (file.startsWith('vehicle-superheavy-')) return 30;
  if (file.startsWith('vehicle-')) return 10;
  return null;
}

/** A location that never fills its second rail (a Mek head's nine): that rail holds exactly the rest, centred. */
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
  result.capacity = result.rails.reduce((sum, rail) => sum + rail.capacity, 0);
}

/**
 * The rail sets of a location, largest pips first: the renderer uses the first that holds the count,
 * so light units keep large pips and heavy ones still group in fives. The last set holds the target
 * when the location has the room.
 */
function chooseRails(file, location, pitch, outer, symmetric = false) {
  const biped = file.startsWith('biped-');
  const target = locationMaximum(file, location.type, location.location) ?? location.nominal;
  const head = /^(biped|quad|quadvee|tripod)-/.test(file) && location.type === 'armor' && location.location === 'HD';
  // Two rails that never both fill sit level, the short one centred on the five, which already interlocks them.
  const single = target < 10;
  const cache = new Map();
  const attempt = (level, scale) => {
    const key = `${level}:${scale}`;
    if (!cache.has(key)) {
      const metrics = pipMetrics(file, location.type, pitch * scale);
      // Two separate areas on the axis (ProtoMek legs: a structure sub-area per side) mirror each other.
      const halves = symmetric && location.areas?.length === 2;
      // ProtoMeks have little room: their rails fill in reading order rather than a lane apart.
      const sequence = file.startsWith('protomek-');
      const options = { ...metrics, outer, target, symmetric, halves, sequence, stagger: !single, rails: Math.ceil(target / 5) };
      let result = generateRails(location.regions[level], head ? { ...options, mode: 'H' } : options);
      if (head && result.capacity < target) result = generateRails(location.regions[level], options);
      // Where no group of five fits, one shorter rail serves the counts it holds.
      if (!result.full) {
        result = generateRails(location.regions[level], { ...options, mode: result.mode, rails: 1 });
        // Shorter rails only serve counts below five.
        let held = 0;
        const rails = result.rails.filter((rail) => (held += rail.capacity) <= 4);
        result = { ...result, rails, capacity: rails.reduce((sum, rail) => sum + rail.capacity, 0) };
      }
      if (single && target > 5 && result.full && result.rails.length === 1) {
        // The second rail only ever holds the rest: it is laid out on its own, beside the five.
        const region = location.regions[level], [five] = result.rails, clear = metrics.columnPitch - 1e-6;
        const beside = { bounds: region.bounds,
          valid: (x, y, margin) => region.valid(x, y, margin) && five.pips.every(([px, py]) => Math.hypot(px - x, py - y) >= clear) };
        const rest = generateRails(beside, { ...options, mode: result.mode, target: target - 5, rails: undefined });
        const middle = (rail) => [(rail.from[0] + rail.to[0]) / 2, (rail.from[1] + rail.to[1]) / 2];
        const apart = (rail) => Math.hypot(middle(rail)[0] - middle(five)[0], middle(rail)[1] - middle(five)[1]);
        const short = rest.rails.filter((rail) => rail.capacity >= target - 5).sort((a, b) => apart(a) - apart(b))[0];
        if (short) result = { ...result, rails: [five, short], capacity: 5 + short.capacity };
      }
      if (single && target >= 5 && result.full) trimToTarget(result, target, metrics.pitch);
      cache.set(key, { scale, level, metrics, result });
    }
    return cache.get(key);
  };
  if (biped) {
    // Bipeds keep the spacing of the hand-made torso rails unless that leaves a location well short.
    const candidates = BIPED_SCALES.map((scale) => attempt(0, scale));
    const chosen = (candidates[0].result.full && candidates[0].result.capacity >= target * 0.8 ? candidates[0] : null)
      ?? candidates.find((candidate) => candidate.result.full && candidate.result.capacity >= target)
      ?? candidates.reduce((top, candidate) => (candidate.result.capacity > top.result.capacity ? candidate : top));
    return { sets: [chosen], target };
  }
  // Larger than the authored rows where the sheet asks for larger pips and the location has the room.
  const footprint = 1 + STROKE_RATIO / 2;
  const fullSize = (2 * requestedRadius(file, location.type) * footprint + PIP_GAP) / pitch;
  const larger = [...new Set(LARGER_SCALES.map((scale) => round(Math.min(scale, fullSize), 2)))].filter((scale) => scale > 1.05);
  const scales = [...larger, ...SCALES.filter((scale) => target <= LARGE_TARGET || scale >= LARGE_SCALE)];
  const levels = location.regions.map((_, level) => level);
  // The last level has no clearance left (unless the location only exists without one).
  const cleared = levels.length > 1 ? levels.slice(0, -1) : levels;
  const sets = [];
  const held = () => (sets.length ? sets[sets.length - 1].result.capacity : 0);
  const clearlyMore = (capacity, than) => capacity >= Math.max(than + 1, Math.floor(than * SET_STEP));
  // Only a set of full rails settles the target.
  const reached = () => sets.some((set) => set.result.full && set.result.capacity >= target);
  const offer = (candidate) => {
    const { capacity, full } = candidate.result;
    if (!clearlyMore(capacity, held()) && !(full && capacity >= target)) return;
    sets.push(candidate);
  };
  // At each pip size the clearance from the border shrinks only when that holds clearly more.
  const offerAll = (someLevels) => {
    for (const scale of scales) {
      if (reached()) return;
      offer(someLevels.map((level) => attempt(level, scale))
        .reduce((top, candidate) => (clearlyMore(candidate.result.capacity, top.result.capacity) ? candidate : top)));
    }
  };
  offerAll(cleared);
  // No clearance at all only where no group of five fits with one.
  if (!sets.some((set) => set.result.full)) offerAll(levels.filter((level) => !cleared.includes(level)));
  return { sets, target };
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

/** Without mirrored pairs the widest location (a torso, the legs) marks the diagram's axis: an off-centre gun does not. */
function middleOfWidest(bounds) {
  const widest = bounds.reduce((top, item) => (!top || item.x1 - item.x0 > top.x1 - top.x0 ? item : top), null);
  return widest ? (widest.x0 + widest.x1) / 2 : 0;
}

function mirrorRegion(region, axis) {
  const { bounds } = region;
  return {
    bounds: { ...bounds, x0: Math.max(bounds.x0, 2 * axis - bounds.x1), x1: Math.min(bounds.x1, 2 * axis - bounds.x0) },
    valid: (x, y, margin) => region.valid(x, y, margin) && region.valid(2 * axis - x, y, margin),
  };
}

function mirrorOf(first, second, tolerance = 0.3) {
  const a = loopsBounds(first), b = loopsBounds(second);
  const axis = (a.x0 + a.x1 + b.x0 + b.x1) / 4;
  if (Math.abs((a.x0 + a.x1) / 2 - axis) < 1) return null;
  const pointsA = first.flat(), pointsB = second.flat();
  if (pointsA.length !== pointsB.length) return null;
  const matches = pointsA.every(([x, y]) => pointsB.some(([bx, by]) => Math.hypot(2 * axis - x - bx, y - by) <= tolerance));
  return matches ? axis : null;
}

function railMarkup(location, type, rails, indent, digits, strokeWidth, set = 1) {
  if (rails.length === 0) return '';
  const style = `fill: none; stroke: rgb(0, 255, 0); stroke-width: ${strokeWidth}; stroke-linecap: round; stroke-dasharray: ${round(strokeWidth * 2, 2)};`;
  const lines = rails.map((rail, index) =>
    `${indent}  <path d="M ${round(rail.from[0], digits)} ${round(rail.from[1], digits)} L ${round(rail.to[0], digits)} ${round(rail.to[1], digits)}" style="${style}" data-rail-capacity="${rail.capacity}" data-rail-index="${index + 1}"/>`);
  return `${indent}<g data-rail="${type}" data-location="${location}"${set > 1 ? ` data-rail-set="${set}"` : ''}>\n${lines.join('\n')}\n${indent}</g>`;
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

/** Whether the mask shows a location, free of artwork, at a point of the diagram. */
function maskReader(mask, key) {
  const index = mask.keys.indexOf(key);
  if (index < 0) return null;
  const code = String.fromCharCode(48 + index + 1);
  return ([x, y]) => {
    const px = Math.floor((x - mask.viewBox[0]) * mask.scale), py = Math.floor((y - mask.viewBox[1]) * mask.scale);
    return py >= 0 && py < mask.height && px >= 0 && px < mask.width && mask.rows[py][px] === code;
  };
}

/**
 * The authored rows stop short of much of their location (a strip in a wide box, stair steps in a
 * corner). Each row runs out sideways to the location's outline, and the top and bottom rows take up
 * to a row of free height, so fill areas and rails use the room the artwork gives.
 * Mirrored locations stretch as one: the left one against both outlines, the right one as its mirror;
 * a location on the axis only where both of its halves are free.
 */
function stretchRows(file, entries, mask) {
  const plain = (entry) => entry.frames.get('')?.rects ?? [];
  const outlineOf = (entry) => (plain(entry).length ? rectUnionLoops(plain(entry)) : null);
  const reader = (entry, matrix) => {
    const read = maskReader(mask, `${entry.type}:${entry.location}`);
    if (!read) console.error(`${file}: no outline sampled for ${entry.type} ${entry.location}`);
    return read ? (x, y) => read(applyMatrix(matrix, [x, y])) : null;
  };
  // Rows the sampled outline does not cover at all stay as authored.
  const stretch = (rects, rowHeight, free) => {
    const authored = rects.map((rect) => ({ ...rect }));
    fitRows(rects, rowHeight, free);
    if (rects.length === 0) {
      console.error(`${file}: rows left as authored, the sampled outline does not cover them`);
      rects.push(...authored);
      return false;
    }
    return true;
  };
  const fitRows = (rects, rowHeight, free) => {
    const step = rowHeight / 8;
    const freeColumn = (x, rect) => [0.2, 0.5, 0.8].every((share) => free(x, rect.y0 + (rect.y1 - rect.y0) * share));
    const freeRow = (y, rect) => {
      for (let x = rect.x0 + step / 2; x < rect.x1; x += step) if (!free(x, y)) return false;
      return true;
    };
    // An edge whose middle lies over the outline first draws back onto free ground; then it runs
    // outward while its whole length stays free. With a limited reach the edge only moves if the
    // outline is that near: open room beyond the rows was left free on purpose (the sheet prints a
    // label there).
    const settle = (value, outward, reach, isFree, middleFree) => {
      let edge = value;
      for (let back = 0; !middleFree(edge - outward * step / 2); back += step) {
        if (back >= rowHeight) return value;
        edge -= outward * step;
      }
      const drawnBack = edge;
      for (let out = 0; isFree(edge + outward * step / 2); out += step) {
        if (out + step > reach + 1e-6) return round(drawnBack);
        edge += outward * step;
      }
      return round(edge);
    };
    const rows = new Map();
    for (const rect of rects) {
      const key = `${round(rect.y0)}|${round(rect.y1)}`;
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(rect);
    }
    for (const row of rows.values()) {
      row.sort((a, b) => a.x0 - b.x0);
      // A gap inside a row closes only if nothing is drawn in it.
      for (let index = 0; index + 1 < row.length; index++) {
        let clear = true;
        for (let x = row[index].x1 + step / 2; x < row[index + 1].x0 && clear; x += step) clear = freeColumn(x, row[index]);
        if (clear) row[index].x1 = row[index + 1].x0;
      }
      // A row keeps the stretches whose middle is free: it ends where it hangs over the outline, and
      // artwork lying across it (a head over a torso) cuts it in two.
      const kept = [];
      for (const rect of row) {
        const y = (rect.y0 + rect.y1) / 2;
        let start = null;
        for (let x = rect.x0; ; x += step) {
          const inside = x < rect.x1 - 1e-9 && free(Math.min(x + step / 2, (x + rect.x1) / 2), y);
          if (inside && start === null) start = x;
          if (!inside && start !== null) {
            const end = Math.min(x, rect.x1);
            if (end - start >= rowHeight / 2) kept.push({ ...rect, x0: round(start), x1: round(end) });
            start = null;
          }
          if (x >= rect.x1) break;
        }
        rect.x1 = rect.x0; // replaced by its stretches
      }
      // Every end runs on to the outline while the whole row height stays free.
      for (const rect of kept) {
        while (freeColumn(rect.x0 - step / 2, rect)) rect.x0 = round(rect.x0 - step);
        while (freeColumn(rect.x1 + step / 2, rect)) rect.x1 = round(rect.x1 + step);
      }
      rects.push(...kept);
    }
    for (let index = rects.length - 1; index >= 0; index--) {
      if (rects[index].x1 - rects[index].x0 <= 1e-6) rects.splice(index, 1);
    }
    const covered = (rect, y) => rects.some((other) => other !== rect && Math.abs(y - (y === rect.y0 ? other.y1 : other.y0)) < 0.01
      && Math.min(rect.x1, other.x1) - Math.max(rect.x0, other.x0) > 1e-6);
    for (const rect of rects) {
      const middle = (y) => free((rect.x0 + rect.x1) / 2, y);
      if (!covered(rect, rect.y0)) rect.y0 = settle(rect.y0, -1, rowHeight, (y) => freeRow(y, rect), middle);
      if (!covered(rect, rect.y1)) rect.y1 = settle(rect.y1, 1, rowHeight, (y) => freeRow(y, rect), middle);
    }
    for (let index = rects.length - 1; index >= 0; index--) {
      if (rects[index].y1 - rects[index].y0 <= 1e-6) rects.splice(index, 1);
    }
  };
  const toRoot = (entry) => ancestorMatrix([...entry.profiles][0]);
  const done = new Set();
  for (const type of ['armor', 'structure']) {
    const group = entries.filter((entry) => entry.type === type);
    const pairs = [];
    for (const left of group) {
      for (const right of group) {
        if (left === right || done.has(left) || done.has(right)) continue;
        const a = outlineOf(left), b = outlineOf(right);
        const axis = a && b && left.frames.size === 1 && right.frames.size === 1 ? mirrorOf(a, b, 0.6) : null;
        if (axis === null || loopsBounds(a).x0 > loopsBounds(b).x0) continue;
        pairs.push({ left, right, axis });
        done.add(left).add(right);
      }
    }
    const bounds = group.map(outlineOf).filter(Boolean).map(loopsBounds);
    const axis = pairs.length ? pairs.reduce((sum, pair) => sum + pair.axis, 0) / pairs.length : middleOfWidest(bounds);
    // Limbs authored a little differently on each side, or in turned rows, still mirror: the left
    // one's rows serve both.
    const only = (entry) => (entry.frames.size === 1 ? [...entry.frames.values()][0] : null);
    const parentBounds = (frame) => loopsBounds([frame.rects.flatMap((rect) =>
      [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x1, rect.y1], [rect.x0, rect.y1]]
        .map((point) => (frame.matrix ? applyMatrix(frame.matrix, point) : point)))]);
    for (const left of group) {
      for (const right of group) {
        if (left === right || done.has(left) || done.has(right) || !only(left)?.rects.length || !only(right)?.rects.length) continue;
        const a = parentBounds(only(left)), b = parentBounds(only(right)), slack = left.rowHeight;
        if ((a.x0 + a.x1) / 2 > axis - slack || Math.abs(a.x0 - (2 * axis - b.x1)) > slack || Math.abs(a.x1 - (2 * axis - b.x0)) > slack
          || Math.abs(a.y0 - b.y0) > slack || Math.abs(a.y1 - b.y1) > slack) continue;
        // Their own middle, which the artwork may place a little off the diagram's.
        pairs.push({ left, right, axis: (a.x0 + a.x1 + b.x0 + b.x1) / 4 });
        done.add(left).add(right);
      }
    }
    for (const { left, right, axis: pairAxis } of pairs) {
      const readLeft = maskReader(mask, `${left.type}:${left.location}`), readRight = maskReader(mask, `${right.type}:${right.location}`);
      if (!readLeft || !readRight) {
        console.error(`${file}: no outline sampled for ${left.type} ${left.location} or ${right.location}`);
        continue;
      }
      const frame = only(left), rootLeft = toRoot(left), rootRight = toRoot(right);
      frame.free = (x, y) => {
        const [px, py] = frame.matrix ? applyMatrix(frame.matrix, [x, y]) : [x, y];
        return readLeft(applyMatrix(rootLeft, [px, py])) && readRight(applyMatrix(rootRight, [2 * pairAxis - px, py]));
      };
      if (!stretch(frame.rects, left.rowHeight, frame.free)) delete frame.free;
      right.mirrorOf = { entry: left, axis: pairAxis };
      right.frames = frame.matrix
        ? new Map([['mirrored', { matrix: multiply([-1, 0, 0, 1, 2 * pairAxis, 0], frame.matrix), rects: frame.rects.map((rect) => ({ ...rect })) }]])
        : new Map([['', { matrix: null, rects: frame.rects.map((rect) => ({ ...rect, x0: round(2 * pairAxis - rect.x1), x1: round(2 * pairAxis - rect.x0) })) }]]);
    }
    for (const entry of group) {
      if (done.has(entry)) continue;
      for (const [name, frame] of entry.frames) {
        const free = reader(entry, name === '' ? toRoot(entry) : multiply(toRoot(entry), frame.matrix));
        if (!free) continue;
        const outline = name === '' ? loopsBounds(rectUnionLoops(frame.rects)) : null;
        const onAxis = outline && Math.abs((outline.x0 + outline.x1) / 2 - axis) <= entry.rowHeight;
        frame.free = onAxis ? (x, y) => free(x, y) && free(2 * axis - x, y) : free;
        if (!stretch(frame.rects, entry.rowHeight, frame.free)) delete frame.free;
      }
    }
  }
}

/** Fill outline of one location, in the coordinates of the element that will hold its rails. */
function collectLocations(file, document, mask) {
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
  // Armor rows that run into structure rows (ProtoMek main gun) end where those begin.
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
  for (const entry of byKey.values()) {
    const counts = new Map();
    entry.heights.forEach((height) => counts.set(height, (counts.get(height) ?? 0) + 1));
    entry.rowHeight = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const { rowHeight } = entry;
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
  }
  stretchRows(file, [...byKey.values()], mask);
  const usedProfiles = new Set();
  const cell = 1 / mask.scale;
  const shapes = new Map();
  /** The rail regions and fill areas of one location's rows. */
  const shapeOf = (entry) => {
    if (shapes.has(entry)) return shapes.get(entry);
    shapes.set(entry, entry.mirrorOf ? mirroredShape(entry) : rowShape(entry));
    return shapes.get(entry);
  };
  // The right one of a mirrored pair is the left one's image, point for point.
  const mirroredShape = (entry) => {
    const { axis } = entry.mirrorOf, source = shapeOf(entry.mirrorOf.entry);
    const flip = (loop) => loop.map(([x, y]) => [2 * axis - x, y]).reverse();
    return {
      levels: source.levels.map((loops) => loops.map(flip)),
      areas: source.areas.map((area) => (area.matrix
        ? { loops: area.loops, matrix: multiply([-1, 0, 0, 1, 2 * axis, 0], area.matrix) }
        : { loops: area.loops.map(flip), matrix: null })),
      droppedShare: source.droppedShare,
    };
  };
  const rowShape = (entry) => {
    const { rowHeight } = entry;
    const local = (rects) => rectUnionLoops(rects).map((loop) => simplifyLoop(smoothStairs(loop, rowHeight), 0.08));
    const frames = [...entry.frames.values()];
    // A row ends where its middle meets the outline, so beside a slanted or bumpy border it stops short
    // or hangs over. Each row is widened sideways (up to the next stretch of its own row) and the
    // outline itself then trims the shape, at an even distance all along.
    const widened = frames.map((frame) => (frame.free ? { ...frame, rects: frame.rects.map((rect) => {
      const beside = frame.rects.filter((other) => other !== rect && Math.min(rect.y1, other.y1) - Math.max(rect.y0, other.y0) > 1e-6);
      const gap = (gaps) => Math.min(Infinity, ...gaps.filter((value) => value >= -1e-6));
      const left = gap(beside.map((other) => rect.x0 - other.x1)), right = gap(beside.map((other) => other.x0 - rect.x1));
      // Short of the middle of a gap, so two stretches of one row never join across what parts them.
      const reach = (room) => Math.max(0, Math.min(rowHeight, room * 0.45));
      return { ...rect, x0: round(rect.x0 - reach(left)), x1: round(rect.x1 + reach(right)) };
    }) } : frame));
    // Only what holds some of the location's own rows: not a pocket beyond a drawn line.
    const fitted = (index, rects, clearance) => {
      const loops = local(rects), frame = frames[index];
      if (!frame.free || loops.length === 0) return loops;
      const samples = frame.rects.flatMap((rect) => [0.1, 0.3, 0.5, 0.7, 0.9]
        .map((share) => [rect.x0 + (rect.x1 - rect.x0) * share, (rect.y0 + rect.y1) / 2]));
      // Nothing narrower than a pip, unless the whole shape is (a rotor blade): then it stays as it is.
      for (const minWidth of [rowHeight * MIN_WIDTH, 0]) {
        const all = fitToFree(loops, frame.free, clearance, cell, Math.max(0.15, rowHeight * 0.03), rowHeight * rowHeight / 4, minWidth);
        const outers = all.filter((loop) => signedArea(loop) > 0 && samples.some((point) => insideLoops(point, [loop])));
        if (outers.length > 0 || minWidth === 0) {
          return [...outers, ...all.filter((loop) => signedArea(loop) <= 0 && outers.some((outer) => insideLoops(loop[0], [outer])))];
        }
      }
      return [];
    };
    // The shapes keep clear of the location border by a share of the row height.
    const erode = (share) => widened.map((frame) => ({ ...frame, rects: erodeRects(frame.rects, share * rowHeight) }));
    const placed = (frame, loops) => (frame.matrix ? loops.map((loop) => loop.map((point) => applyMatrix(frame.matrix, point))) : loops);
    // Rails see the whole location; the filler needs each notch-free piece as its own area.
    const levels = RAIL_CLEARANCES
      .map((share) => erode(share).flatMap((frame, index) => (frame.rects.length ? placed(frame, fitted(index, frame.rects, share * rowHeight)) : [])))
      .filter((loops) => loops.length > 0);
    const fillShare = [FILL_CLEARANCE, FILL_CLEARANCE / 2, 0].find((share) => erode(share).some((frame) => frame.rects.length > 0));
    const pieces = erode(fillShare).flatMap((frame, index) => splitSections(frame.rects)
      .flatMap((section) => fitted(index, section, fillShare * rowHeight).filter((loop) => signedArea(loop) > 0))
      .map((loop) => ({ loops: [loop], matrix: frame.matrix, area: signedArea(loop) })));
    if (pieces.length === 0) throw new Error(`${file}: ${entry.type} ${entry.location} has no fill area`);
    // Slivers beside a main body (a row split by a cockpit, a corner tab) stay out of the filler's
    // outline; only pieces of comparable size remain separate areas.
    const largest = Math.max(...pieces.map((piece) => piece.area));
    const total = pieces.reduce((sum, piece) => sum + piece.area, 0);
    // A rotated stack keeps its own axes (rows stay rows for the filler) and carries the rotation.
    const areas = pieces.filter((piece) => piece.area >= largest * 0.25).map(({ loops, matrix }) => ({ loops, matrix }));
    return { levels, areas, droppedShare: pieces.filter((piece) => piece.area < largest * 0.25).reduce((sum, piece) => sum + piece.area, 0) / total };
  };
  for (const entry of byKey.values()) {
    const { levels, areas, droppedShare } = shapeOf(entry);
    const ordered = [...entry.profiles].sort((a, b) => a.startIndex - b.startIndex);
    const replacements = ordered.map((profile, index) => {
      if (usedProfiles.has(profile)) throw new Error(`${file}: profile shared by several locations`);
      usedProfiles.add(profile);
      return { start: profile.startIndex, end: profile.endIndex + 1, first: index === 0 };
    });
    locations.push({ type: entry.type, location: entry.location, rowHeight: entry.rowHeight, loops: levels[0], levels, areas, replacements, writeFill: true, nominal: entry.nominal, droppedShare });
  }
  return locations;
}

/**
 * A painted location contour drawn after the pip groups (a VTOL's rotor tips, a boat's turret box)
 * would cover its own pips: there the pip groups move behind the last artwork of their parent.
 */
function drawPipsLast(text) {
  const tags = elements(parseDocument(text, { xmlMode: true, withStartIndices: true, withEndIndices: true }));
  const groups = [...new Set(tags.filter((node) => node.attribs['data-fill']).map((node) => node.parent))]
    .sort((a, b) => a.startIndex - b.startIndex);
  if (groups.length === 0) return text;
  const last = groups[groups.length - 1].endIndex;
  const painted = (node) => !['', 'none', 'transparent'].includes((node.attribs.fill ?? '').trim().toLowerCase());
  const covers = (node) => (node.attribs.class ?? '').split(/\s+/).includes('unitLocation') && painted(node);
  if (!tags.some((node) => node.startIndex > last && covers(node))) return text;
  const parent = groups[0].parent;
  if (groups.some((group) => group.parent !== parent)) throw new Error('pip groups do not share a parent');
  // Whole lines move: each group's, to just above its parent's closing tag.
  const lines = groups.map((group) => [text.lastIndexOf('\n', group.startIndex - 1) + 1, text.indexOf('\n', group.endIndex) + 1]);
  const closing = text.lastIndexOf('\n', parent.endIndex - '</g>'.length) + 1;
  let result = '', at = 0;
  for (const [from, to] of lines) {
    result += text.slice(at, from);
    at = to;
  }
  return result + text.slice(at, closing) + lines.map(([from, to]) => text.slice(from, to)).join('') + text.slice(closing);
}

async function processFile(file) {
  const source = file.startsWith('biped-')
    ? fs.readFileSync(path.join(ROOT, ASSETS, file), 'utf8')
    : fs.existsSync(path.join(SOURCES, file)) ? fs.readFileSync(path.join(SOURCES, file), 'utf8')
    : execFileSync('git', ['show', `${ROWS_COMMIT}:${ASSETS}/${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const document = parseDocument(source, { xmlMode: true, withStartIndices: true, withEndIndices: true });
  const mask = JSON.parse(fs.readFileSync(path.join(MASKS, `${file}.json`), 'utf8'));
  const locations = collectLocations(file, document, mask);
  const report = [];

  for (const type of ['armor', 'structure']) {
    const group = locations.filter((location) => location.type === type);
    if (group.length === 0) continue;
    const heights = new Map();
    group.forEach((location) => heights.set(location.rowHeight, (heights.get(location.rowHeight) ?? 0) + 1));
    const dominantHeight = [...heights].sort((a, b) => b[1] - a[1])[0][0];
    const pitch = basePitch(file, type, dominantHeight);
    const allBounds = group.map((location) => loopsBounds(location.loops));
    for (const location of group) {
      location.basePitch = pitch;
      // Biped rails may use the whole silhouette of the location; the rest keep to their authored rows.
      location.regions = location.maskKey ? [regionFromMask(mask, location.maskKey)] : location.levels.map(regionFromLoops);
    }
    // The diagram's axis: where its mirrored pairs meet, else the middle of its widest location.
    const pairAxes = group.flatMap((location) => group.map((other) => (other === location ? null : mirrorOf(location.loops, other.loops))))
      .filter((value) => value !== null);
    const axis = pairAxes.length ? pairAxes.reduce((sum, value) => sum + value, 0) / pairAxes.length : middleOfWidest(allBounds);
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
        const mirrored = chosen.sets.map((set) => ({ ...set, result: { ...set.result,
          rails: set.result.rails.map((rail) => ({ ...rail, from: flip(rail.from), to: flip(rail.to), pips: rail.pips.map(flip) })) } }));
        const fits = mirrored.every((set) => set.result.rails.every((rail) =>
          rail.pips.every(([x, y]) => right.regions[set.level].valid(x, y, set.metrics.margin - 0.45))));
        if (fits) Object.assign(right, chosen, { sets: mirrored });
        else {
          console.error(`${file}: ${right.location} is not a mirror of ${left.location}; laid out on its own`);
          Object.assign(right, chooseRails(file, right, pitch, 'max'));
        }
        done.add(left).add(right);
      } else {
        const middle = (bounds.x0 + bounds.x1) / 2;
        const onAxis = Math.abs(middle - axis) <= location.basePitch;
        // A location on the axis mirrors itself: its rails use only the room both halves have.
        if (onAxis) location.regions = location.regions.map((region) => mirrorRegion(region, axis));
        Object.assign(location, chooseRails(file, location, pitch, middle > axis + 1 ? 'max' : 'min', onAxis));
        done.add(location);
      }
    }
  }

  // Each edit writes its text for the asset, or for the preview of one rail set filled with pips.
  const edits = [];
  for (const location of locations) {
    const { sets } = location;
    const digits = location.basePitch < 4.5 ? 3 : 2;
    const strokeWidth = round(Math.max(0.3, Math.min(1.5, location.basePitch / 6)), 2);
    const outer = location.loops.filter((loop) => signedArea(loop) > 0).length;
    const last = sets[sets.length - 1];
    report.push(`${file} ${location.type} ${location.location}: target ${location.target} sets ${sets.map((set) =>
      `${set.result.capacity}${set.result.full ? '' : '(short)'}=${set.result.rails.length}${set.result.mode}@${set.scale}/L${set.level}/r${round(set.metrics.radius, 2)}`).join(' ')}${
      !last || last.result.capacity < location.target ? ' SHORT' : ''} loops ${location.loops.length}${location.loops.length > 1 ? ` (outer ${outer})` : ''} areas ${location.areas?.length ?? 1} dropped ${round((location.droppedShare ?? 0) * 100, 0)}%`);
    const markup = (indent, index, number) =>
      railMarkup(location.location, location.type, sets[index].result.rails, indent, digits, strokeWidth, number);
    const rails = (indent, shown) => {
      if (shown === undefined) return sets.map((_, index) => markup(indent, index, index + 1)).filter(Boolean).join('\n');
      const index = Math.min(shown, sets.length) - 1;
      return index < 0 ? '' : `${markup(indent, index, 1)}\n${previewPips(sets[index].result.rails, sets[index].metrics.radius, Infinity)}`;
    };
    if (location.writeFill) {
      location.replacements.forEach((replacement) => {
        const indent = indentOf(source, replacement.start);
        if (!replacement.first) {
          // Drop the whole line of a profile group merged into an earlier one.
          edits.push({ start: source.lastIndexOf('\n', replacement.start - 1), end: replacement.end, text: () => '' });
          return;
        }
        const fill = location.areas.map((area) =>
          `<path data-fill="${location.type}" data-location="${location.location}" d="${loopsToPath(area.loops, digits)}"${area.matrix ? ` transform="matrix(${area.matrix.map((value) => round(value, 6)).join(' ')})"` : ''} style="fill: none; stroke: rgb(0, 0, 255); stroke-width: ${strokeWidth}; stroke-dasharray: ${round(strokeWidth * 2, 2)};"/>`)
          .join(`\n${indent}`);
        edits.push({ start: replacement.start, end: replacement.end,
          text: (shown) => [fill, rails(indent, shown)].filter(Boolean).join('\n') });
      });
    } else if (!location.keepRails) {
      // Replace the group's whole line, indented like its closing tag, so reruns leave the file unchanged.
      const indent = indentOf(source, location.replace.end - '</g>'.length);
      edits.push({ start: source.lastIndexOf('\n', location.replace.start - 1) + 1, end: location.replace.end,
        text: (shown) => rails(indent, shown) });
    }
  }
  const apply = (shown) => drawPipsLast([...edits].sort((a, b) => b.start - a.start)
    .reduce((text, edit) => text.slice(0, edit.start) + edit.text(shown) + text.slice(edit.end), source));
  fs.mkdirSync(path.join(outDir, 'preview'), { recursive: true });
  fs.writeFileSync(path.join(outDir, file), apply());

  // One preview per rail set, every rail of that set filled (a location with fewer sets shows its last).
  const viewBox = /viewBox="([^"]+)"/.exec(source)[1].split(/[\s,]+/).map(Number);
  const zoom = Math.min(6, 1400 / Math.max(viewBox[2], viewBox[3]));
  const setCount = Math.max(...locations.map((location) => location.sets.length));
  for (let shown = 1; shown <= setCount; shown++) {
    const preview = apply(shown)
      .replace(/<svg\b([^>]*)>/, (match, attributes) =>
        `<svg${attributes.replace(/\s(width|height)="[^"]*"/g, '')} width="${Math.round(viewBox[2] * zoom)}" height="${Math.round(viewBox[3] * zoom)}"><rect x="${viewBox[0]}" y="${viewBox[1]}" width="${viewBox[2]}" height="${viewBox[3]}" fill="#fff"/>`)
      .replace(/visibility="hidden" data-mekbay-shield/g, 'display="none" data-mekbay-shield');
    fs.writeFileSync(path.join(outDir, 'preview', shown === 1 ? file : file.replace('.svg', `.set${shown}.svg`)), preview);
  }
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
