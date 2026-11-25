// Lays out straight five-pip rail segments inside a location.
import { boundaryDistance, insideLoops, loopsBounds } from './geom.mjs';

const LINES_PER_PITCH = 16;

/** A region answers whether a pip centre keeps `margin` clear of its edge. */
export function regionFromLoops(loops) {
  return {
    bounds: loopsBounds(loops),
    valid: (x, y, margin) => insideLoops([x, y], loops) && boundaryDistance([x, y], loops) >= margin,
  };
}

/**
 * @param region  where pips may sit
 * @param options pitch: pip spacing along a rail; columnPitch: spacing between parallel rails;
 *                margin: minimum distance of a pip centre from the region's edge;
 *                outer: 'min' | 'max' side of the first, unshifted rail of a band;
 *                target: the most pips the location is expected to hold;
 *                stagger: false keeps neighbouring rails level; mode: 'V' | 'H' | undefined (auto);
 *                symmetric: the location straddles the paperdoll's axis and must mirror itself
 */
export function generateRails(region, options) {
  const { bounds } = region;
  const width = bounds.x1 - bounds.x0, height = bounds.y1 - bounds.y0;
  const vertical = layout(region, options, false);
  const horizontal = layout({
    bounds: { x0: bounds.y0, x1: bounds.y1, y0: bounds.x0, y1: bounds.x1 },
    valid: (u, v, margin) => region.valid(v, u, margin),
  }, { ...options, outer: 'min', symmetric: false }, true);
  if (options.mode === 'V') return vertical;
  if (options.mode === 'H') return horizontal;
  const [preferred, other] = width > height * 1.3 ? [horizontal, vertical] : [vertical, horizontal];
  return other.capacity > preferred.capacity * 1.25 ? other : preferred;
}

function layout(region, options, swapped) {
  const { pitch, columnPitch, margin } = options;
  const { bounds } = region;
  // A location that never holds five pips gets rails of its own largest count, so they sit centred.
  const group = Math.max(2, Math.min(5, options.target ?? 5));
  const stagger = options.stagger === false ? 0 : 0.5;
  const staggerLines = stagger * LINES_PER_PITCH;
  const lineStep = pitch / LINES_PER_PITCH;
  let origin = bounds.y0 + margin;
  let lineCount = Math.max(0, Math.floor((bounds.y1 - margin - origin) / lineStep + 1e-6) + 1);
  if (swapped && lineCount > 0) {
    // Rows are laid out symmetrically about the middle of the location.
    const centre = (bounds.y0 + bounds.y1) / 2;
    const half = Math.floor((centre - origin) / lineStep + 1e-6);
    origin = centre - half * lineStep;
    lineCount = 2 * half + 1;
  }
  const valid = (u, v, slack = 1e-4) => region.valid(u, v, margin - slack);
  const lineCache = new Map();
  const lineIntervals = (line) => {
    if (line < 0 || line >= lineCount) return [];
    if (!lineCache.has(line)) lineCache.set(line, scanLine(valid, bounds.x0, bounds.x1, origin + line * lineStep, pitch / 40));
    return lineCache.get(line);
  };
  const lineOf = (v) => Math.round((v - origin) / lineStep);

  /** A band of parallel rails whose first pip row sits on `line`, each rail holding `count` pips. */
  const band = (line, count, lattice = null) => {
    const top = lineIntervals(line), bottom = lineIntervals(line + (count - 1) * LINES_PER_PITCH);
    if (top.length === 0 || bottom.length === 0) return null;
    let shear = 0; // u travelled per pip: rails follow a limb that leans
    if (count > 1 && top.length === 1 && bottom.length === 1) {
      const middle = lineIntervals(line + Math.round((count - 1) * LINES_PER_PITCH / 2));
      const left = bottom[0][0] - top[0][0], right = bottom[0][1] - top[0][1];
      const span = (count - 1) * pitch;
      const straight = middle.length === 1
        && Math.abs(middle[0][0] - (top[0][0] + bottom[0][0]) / 2) <= pitch * 0.2
        && Math.abs(middle[0][1] - (top[0][1] + bottom[0][1]) / 2) <= pitch * 0.2;
      if (straight && Math.sign(left) === Math.sign(right)
        && Math.min(Math.abs(left), Math.abs(right)) > span * 0.04
        && Math.abs(left - right) <= Math.max(Math.abs(left), Math.abs(right)) * 0.4) {
        const lean = Math.max(-0.7, Math.min(0.7, (left + right) / 2 / span));
        shear = pitch * Math.sin(Math.atan(lean));
      }
    }
    const advance = Math.sqrt(pitch * pitch - shear * shear); // v travelled per pip
    const firstV = origin + line * lineStep;
    // Odd rails start half a pitch further along, so neighbouring rails interlock.
    const pipAt = (u, pip, odd) => [u + (pip + odd * stagger) * shear, firstV + (pip + odd * stagger) * advance];
    const offsetsFor = (odd) => {
      let offsets = [[-Infinity, Infinity]];
      for (let pip = 0; pip < count && offsets.length > 0; pip++) {
        const [du, v] = pipAt(0, pip, odd);
        offsets = intersect(offsets, lineIntervals(lineOf(v)).map(([from, to]) => [from - du, to - du]));
      }
      return offsets;
    };
    const regions = union([...offsetsFor(0), ...(stagger ? offsetsFor(1) : [])]);
    if (regions.length === 0) return null;
    const nominal = columnPitch * pitch / advance;
    const tightest = (columnPitch - Math.min(0.15, options.squeeze ?? 0.15)) * pitch / advance;
    const groups = [];
    for (const [from, to] of regions) {
      const columns = Math.floor((to - from) / tightest + 1e-6) + 1;
      // An extra rail that only fits by closing the pip gap spreads the rails edge to edge.
      let spacing = columns > 1 ? Math.min(nominal, (to - from) / (columns - 1)) : 0;
      let first = (from + to) / 2 - (columns - 1) * spacing / 2;
      let parities = stagger ? [0, 1] : [0];
      if (lattice && shear === 0) {
        // Line the rails up with the widest band when that costs no rail.
        const low = Math.ceil((from - lattice.origin) / lattice.spacing - 1e-6);
        const high = Math.floor((to - lattice.origin) / lattice.spacing + 1e-6);
        // A band keeps its own centring unless the lattice is only a nudge away.
        const shift = Math.abs(lattice.origin + low * lattice.spacing - first);
        if (high - low + 1 === columns && shift <= lattice.spacing * 0.3 && !(options.symmetric && shift > 1e-6)) {
          spacing = lattice.spacing;
          first = lattice.origin + low * spacing;
          if (stagger && !options.symmetric) parities = [(((low % 2) + 2) % 2) ^ lattice.oddAtOrigin];
        }
      }
      let interval = [];
      for (const parity of parities) {
        const candidate = [];
        for (let column = 0; column < columns; column++) {
          const u = first + column * spacing;
          // A location on the axis mirrors its pattern: the shifted rails pair up around the middle.
          const odd = stagger ? ((options.symmetric ? Math.min(column, columns - 1 - column) : column) + parity) % 2 : 0;
          const pips = Array.from({ length: count }, (_, pip) => pipAt(u, pip, odd));
          if (!pips.every(([pu, pv]) => valid(pu, pv, 2e-3))) continue;
          candidate.push({ u, pips, count, odd, centre: (from + to) / 2, line, spacing, sheared: shear !== 0, secondary: odd === 1 });
        }
        // Prefer more rails, then the unshifted rail on the outer side.
        const outerOdd = (entries) => (entries.length ? entries[options.outer === 'max' ? entries.length - 1 : 0].odd : 1);
        if (candidate.length > interval.length || (candidate.length === interval.length && outerOdd(candidate) < outerOdd(interval))) {
          interval = candidate;
        }
      }
      if (!stagger) {
        // Rank from the ends inward so the rails filled first are separated by an empty lane.
        interval.forEach((item, index) => {
          item.secondary = Math.min(index, interval.length - 1 - index) % 2 === 1;
        });
      }
      groups.push(...interval);
    }
    if (groups.length === 0) return null;
    const lastLine = Math.max(...groups.map((item) => lineOf(item.pips[item.pips.length - 1][1])));
    return { line, count, groups, lastLine };
  };

  const groupLines = (group - 1) * LINES_PER_PITCH;
  // The gap follows the shifted rails, so the unshifted ones end half a pitch further apart.
  const GAPS = stagger ? [6, 8, 4, 10] : [12, 10, 14, 8, 16];
  let best = null;
  for (const gapLines of GAPS) {
    const period = groupLines + staggerLines + LINES_PER_PITCH + gapLines;
    for (let phase = 0; phase < period; phase++) {
      const bands = [];
      for (let line = phase; line + groupLines < lineCount; line += period) {
        const found = band(line, group);
        if (found) bands.push(found);
      }
      if (bands.length === 0) continue;
      const capacity = bands.reduce((sum, item) => sum + item.groups.length, 0);
      const first = bands[0].line, last = bands[bands.length - 1].lastLine;
      const imbalance = Math.abs(first - (lineCount - 1 - last));
      // Rows read left to right: keep them symmetric about the middle of the location.
      if (swapped && imbalance > 1) continue;
      const score = [-capacity, swapped ? 0 : imbalance, GAPS.indexOf(gapLines)];
      if (!best || lexicographic(score, best.score) < 0) best = { score, bands, capacity };
    }
  }

  let bands = best ? best.bands : [];
  if (best) {
    // Line the rails of every band up on the lattice that fits the most of them.
    const onLattice = (item, lattice) => item.groups.every((entry) => {
      const steps = (entry.u - lattice.origin) / lattice.spacing;
      return !entry.sheared && Math.abs(steps - Math.round(steps)) < 1e-6;
    });
    let chosen = null;
    for (const reference of bands) {
      const anchor = reference.groups[0];
      if (anchor.sheared) continue;
      const lattice = { origin: anchor.u, spacing: anchor.spacing || columnPitch, oddAtOrigin: anchor.odd };
      const aligned = bands.map((item) => {
        const candidate = band(item.line, item.count, lattice);
        return candidate && candidate.groups.length === item.groups.length ? candidate : item;
      });
      const score = aligned.reduce((sum, item) => sum + (onLattice(item, lattice) ? item.groups.length : 0), 0);
      if (!chosen || score > chosen.score) chosen = { bands: aligned, score };
    }
    if (chosen) bands = chosen.bands;
  } else {
    // Too small for a group of five: the longest short rail that fits, as central as possible.
    for (let count = options.target < 5 ? group : group - 1; count >= 2 && bands.length === 0; count--) {
      const slack = lineCount - 1 - (count - 1) * LINES_PER_PITCH;
      if (slack < 0) continue;
      const order = Array.from({ length: slack + 1 }, (_, index) => index)
        .sort((a, b) => Math.abs(a - slack / 2) - Math.abs(b - slack / 2));
      let found = null;
      for (const line of order) {
        const candidate = band(line, count);
        if (candidate && (!found || candidate.groups.length > found.groups.length)) found = candidate;
      }
      if (found) bands = [found];
    }
  }

  // Fill order: the unshifted rails band by band (centre, then outer, then inner side), so blocks of
  // five stay a lane apart; then the shifted rails in between, one per band in turn.
  const outerSign = options.outer === 'max' ? -1 : 1;
  const centreLine = (lineCount - 1) / 2;
  const entries = [];
  bands.forEach((item, bandIndex) => {
    for (const tier of [false, true]) {
      item.groups.filter((entry) => entry.secondary === tier)
        .sort((a, b) => Math.round(Math.abs(a.u - a.centre) / (columnPitch / 4)) - Math.round(Math.abs(b.u - b.centre) / (columnPitch / 4))
          || outerSign * (a.u - a.centre) - outerSign * (b.u - b.centre))
        .forEach((entry, ordinal) => {
          const along = Math.round(Math.abs(item.line + (item.count - 1) * LINES_PER_PITCH / 2 - centreLine));
          const key = swapped
            ? [tier ? 1 : 0, Math.round(entry.u / (columnPitch / 2)), along, item.line]
            : tier ? [1, ordinal, bandIndex, 0] : [0, bandIndex, ordinal, 0];
          entries.push({ entry, key });
        });
    }
  });
  entries.sort((a, b) => lexicographic(a.key, b.key));

  const swap = ([u, v]) => (swapped ? [v, u] : [u, v]);
  const rails = entries.map(({ entry }) => {
    const first = entry.pips[0], last = entry.pips[entry.pips.length - 1];
    const direction = entry.count > 1
      ? [(last[0] - first[0]) / (entry.count - 1) / pitch, (last[1] - first[1]) / (entry.count - 1) / pitch]
      : [0, 1];
    return {
      from: swap([first[0] - direction[0] * pitch / 2, first[1] - direction[1] * pitch / 2]),
      to: swap([last[0] + direction[0] * pitch / 2, last[1] + direction[1] * pitch / 2]),
      capacity: entry.count,
      pips: entry.pips.map(swap),
    };
  });
  return {
    rails,
    mode: swapped ? 'H' : 'V',
    capacity: rails.reduce((sum, rail) => sum + rail.capacity, 0),
    full: best !== null,
  };
}

function lexicographic(first, second) {
  for (let index = 0; index < first.length; index++) {
    if (first[index] !== second[index]) return first[index] - second[index];
  }
  return 0;
}

function scanLine(valid, from, to, v, step) {
  const intervals = [];
  const refine = (outside, inside) => {
    for (let iteration = 0; iteration < 14; iteration++) {
      const middle = (outside + inside) / 2;
      if (valid(middle, v)) inside = middle; else outside = middle;
    }
    return inside;
  };
  let previous = from - step, previousInside = false, start = 0;
  for (let u = from; u <= to + step; u += step) {
    const inside = u <= to && valid(u, v);
    if (inside && !previousInside) start = refine(previous, u);
    else if (!inside && previousInside) intervals.push([start, refine(u, previous)]);
    previous = u;
    previousInside = inside;
  }
  return intervals;
}

function intersect(first, second) {
  const result = [];
  for (const [a0, a1] of first) {
    for (const [b0, b1] of second) {
      const from = Math.max(a0, b0), to = Math.min(a1, b1);
      if (to >= from) result.push([from, to]);
    }
  }
  return result;
}

function union(intervals) {
  const sorted = intervals.map((interval) => interval.slice()).sort((a, b) => a[0] - b[0]);
  const result = [];
  for (const [from, to] of sorted) {
    const last = result[result.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else result.push([from, to]);
  }
  return result;
}
