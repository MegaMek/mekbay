// Lays out straight five-pip rail segments inside a location.
import { loopsBounds, pointSegmentDistance } from './geom.mjs';

const LINES_PER_PITCH = 16;
/** Rails follow a leaning limb up to this slope (sideways per unit along the limb). */
const MAX_LEAN = 1.2;

/**
 * A region answers whether a pip centre keeps `margin` clear of its edge: inside the loops, and no
 * closer than that to any of their edges. The layout asks this millions of times, so the edges are
 * sorted into a grid of cells and the crossings of each height are kept.
 */
export function regionFromLoops(loops) {
  const CELL = 4;
  const edges = loops.flatMap((loop) => loop.map((point, index) => [point, loop[(index + 1) % loop.length]]));
  const cells = new Map();
  const cellKey = (i, j) => (i + 32768) * 65536 + j + 32768;
  for (const edge of edges) {
    const [[ax, ay], [bx, by]] = edge;
    for (let i = Math.floor(Math.min(ax, bx) / CELL); i <= Math.floor(Math.max(ax, bx) / CELL); i++) {
      for (let j = Math.floor(Math.min(ay, by) / CELL); j <= Math.floor(Math.max(ay, by) / CELL); j++) {
        if (!cells.has(cellKey(i, j))) cells.set(cellKey(i, j), []);
        cells.get(cellKey(i, j)).push(edge);
      }
    }
  }
  const nearEdge = (x, y, margin) => {
    const point = [x, y];
    for (let i = Math.floor((x - margin) / CELL); i <= Math.floor((x + margin) / CELL); i++) {
      for (let j = Math.floor((y - margin) / CELL); j <= Math.floor((y + margin) / CELL); j++) {
        const edgesHere = cells.get(cellKey(i, j));
        if (!edgesHere) continue;
        for (let index = 0; index < edgesHere.length; index++) {
          if (pointSegmentDistance(point, edgesHere[index][0], edgesHere[index][1]) < margin) return true;
        }
      }
    }
    return false;
  };
  // Where the edges cross a height, as insideLoops finds them: a point with an odd number to its right is inside.
  const crossings = new Map();
  const crossingsAt = (y) => {
    let found = crossings.get(y);
    if (!found) {
      found = [];
      for (const loop of loops) {
        for (let index = 0, previous = loop.length - 1; index < loop.length; previous = index++) {
          const [x0, y0] = loop[index], [x1, y1] = loop[previous];
          if ((y0 > y) !== (y1 > y)) found.push((x1 - x0) * (y - y0) / (y1 - y0) + x0);
        }
      }
      if (crossings.size > 50000) crossings.clear();
      crossings.set(y, found);
    }
    return found;
  };
  const inside = (x, y) => {
    let count = 0;
    for (const crossing of crossingsAt(y)) if (x < crossing) count++;
    return count % 2 === 1;
  };
  return {
    bounds: loopsBounds(loops),
    valid: (x, y, margin) => inside(x, y) && !(margin > 0 && nearEdge(x, y, margin)),
  };
}

/**
 * @param region  where pips may sit
 * @param options pitch: pip spacing along a rail; columnPitch: spacing between parallel rails;
 *                margin: minimum distance of a pip centre from the region's edge;
 *                outer: 'min' | 'max' side of the first, unshifted rail of a band;
 *                target: the most pips the location is expected to hold;
 *                group: pips per rail, five unless the location is laid out in smaller groups;
 *                rails: the number of rails that takes; more that fit are thinned out evenly;
 *                stagger: false keeps neighbouring rails level; mode: 'V' | 'H' | undefined (auto);
 *                symmetric: the location straddles the paperdoll's axis and must mirror itself;
 *                halves: such a location is two separate areas, one on each side of the axis;
 *                sequence: rails and their pips fill left to right, top to bottom
 */
export function generateRails(region, options) {
  const { bounds } = region;
  const width = bounds.x1 - bounds.x0, height = bounds.y1 - bounds.y0;
  const vertical = layout(region, options, false);
  const horizontal = layout({
    bounds: { x0: bounds.y0, x1: bounds.y1, y0: bounds.x0, y1: bounds.x1 },
    valid: (u, v, margin) => region.valid(v, u, margin),
  }, { ...options, outer: 'min', symmetric: false, mirrorBands: options.symmetric }, true);
  if (options.mode === 'V') return vertical;
  if (options.mode === 'H') return horizontal;
  const [preferred, other] = width > height * 1.3 ? [horizontal, vertical] : [vertical, horizontal];
  // A group of five in either direction beats shorter rails.
  if (preferred.full !== other.full) return preferred.full ? preferred : other;
  return other.capacity > preferred.capacity * 1.25 ? other : preferred;
}

function layout(region, options, swapped) {
  const { pitch, columnPitch, margin } = options;
  const { bounds } = region;
  // A location that never holds five pips gets rails of its own largest count, so they sit centred.
  const group = options.group ?? Math.max(2, Math.min(5, options.target ?? 5));
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
  const band = (line, count, lattice = null, keep = null) => {
    const top = lineIntervals(line);
    if (top.length === 0) return null;

    // How far the limb runs sideways per unit down, measured between the band's top and `lines` below.
    const leanOver = (lines) => {
      const low = lineIntervals(line + lines), middle = lineIntervals(line + Math.round(lines / 2));
      if (top.length !== 1 || low.length !== 1 || middle.length !== 1) return null;
      const left = low[0][0] - top[0][0], right = low[0][1] - top[0][1], span = lines * lineStep;
      const straight = Math.abs(middle[0][0] - (top[0][0] + low[0][0]) / 2) <= pitch * 0.2
        && Math.abs(middle[0][1] - (top[0][1] + low[0][1]) / 2) <= pitch * 0.2;
      return straight && Math.sign(left) === Math.sign(right)
        && Math.min(Math.abs(left), Math.abs(right)) > span * 0.04
        && Math.abs(left - right) <= Math.max(Math.abs(left), Math.abs(right)) * 0.4
        ? Math.max(-MAX_LEAN, Math.min(MAX_LEAN, (left + right) / 2 / span)) : null;
    };
    // A rail that leans covers less height: probe the height a rail of the measured lean really spans.
    let shear = 0; // u travelled per pip: rails follow a limb that leans
    for (const share of count > 1 ? [1, 0.85, 0.72, 0.64] : []) {
      const lean = leanOver(Math.round((count - 1) * LINES_PER_PITCH * share));
      if (lean === null || Math.abs(Math.cos(Math.atan(lean)) - share) > 0.13) continue;
      shear = pitch * Math.sin(Math.atan(lean));
      break;
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
    const nominal = columnPitch * pitch / advance;
    const tightest = (columnPitch - Math.min(0.15, options.squeeze ?? 0.15)) * pitch / advance;
    const offsets = stagger ? [offsetsFor(0), offsetsFor(1)] : [offsetsFor(0)];
    // Stretches closer than two rails may sit are laid out as one, so their rails keep their distance.
    const regions = union(offsets.flat(), tightest);
    if (regions.length === 0) return null;
    const railAt = (u, odd, centre, spacing) => {
      const pips = Array.from({ length: count }, (_, pip) => pipAt(u, pip, odd));
      return pips.every(([pu, pv]) => valid(pu, pv, 2e-3))
        ? { u, pips, count, odd, centre, line, spacing, sheared: shear !== 0, secondary: odd === 1 }
        : null;
    };
    // Rank level rails from the ends inward so the ones filled first are separated by an empty lane.
    const rankInward = (rails) => rails.forEach((item, index) => {
      item.secondary = Math.min(index, rails.length - 1 - index) % 2 === 1;
    });
    /** Fewer rails than fit: each takes an equal lane of the width, neighbours still half a pitch apart. */
    const spread = (from, to, wanted) => {
      const reach = margin * pitch / advance;
      const lane = (to - from + 2 * reach) / wanted;
      const [first, spacing] = lane >= 2 * reach
        ? [from - reach + lane / 2, lane]
        : [wanted > 1 ? from : (from + to) / 2, wanted > 1 ? (to - from) / (wanted - 1) : 0];
      // The unshifted rail sits on the outer side; a location on the axis mirrors its pattern.
      const rank = (column) => (options.symmetric ? Math.min(column, wanted - 1 - column)
        : options.outer === 'max' ? wanted - 1 - column : column);
      const patterns = stagger ? [(column) => rank(column) % 2, (column) => (rank(column) + 1) % 2, () => 0] : [() => 0];
      for (const pattern of patterns) {
        const rails = [];
        for (let column = 0; column < wanted; column++) {
          // A rail the outline cuts short slides sideways within its lane to where it fits.
          const odd = pattern(column), lane0 = first + column * spacing;
          const u = offsets[odd].map(([low, high]) => Math.max(low, Math.min(high, lane0)))
            .sort((a, b) => Math.abs(a - lane0) - Math.abs(b - lane0))[0];
          const rail = u !== undefined && Math.abs(u - lane0) <= spacing * 0.35
            && (rails.length === 0 || u - rails[rails.length - 1].u >= tightest - 1e-6)
            ? railAt(u, odd, (from + to) / 2, spacing) : null;
          if (!rail) break;
          rails.push(rail);
        }
        if (rails.length < wanted) continue;
        if (rails.every((rail) => rail.odd === 0)) rankInward(rails);
        return rails;
      }
      return null;
    };
    const groups = [];
    regions.forEach(([from, to], slot) => {
      const wanted = keep?.get(slot);
      if (wanted === 0) return;
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
          // A location on the axis mirrors its pattern: the shifted rails pair up around the middle.
          const odd = stagger ? ((options.symmetric ? Math.min(column, columns - 1 - column) : column) + parity) % 2 : 0;
          const rail = railAt(first + column * spacing, odd, (from + to) / 2, spacing);
          if (rail) candidate.push(rail);
        }
        // Prefer more rails, then the unshifted rail on the outer side.
        const outerOdd = (entries) => (entries.length ? entries[options.outer === 'max' ? entries.length - 1 : 0].odd : 1);
        if (candidate.length > interval.length || (candidate.length === interval.length && outerOdd(candidate) < outerOdd(interval))) {
          interval = candidate;
        }
      }
      if (!stagger) rankInward(interval);
      if (wanted < interval.length) {
        // Where even lanes do not fit the outline, keep evenly spaced rails of the full set.
        interval = spread(from, to, wanted)
          ?? Array.from({ length: wanted }, (_, index) =>
            interval[wanted > 1 ? Math.round(index * (interval.length - 1) / (wanted - 1)) : Math.floor(interval.length / 2)]);
      }
      interval.forEach((item) => { item.slot = slot; });
      groups.push(...interval);
    });
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
      if (!found) continue;
      // The two areas of a location on the axis share the counts below five: one mirrored rail of two
      // pips in each.
      const partner = options.halves && swapped ? lineCount - 1 - (count - 1) * LINES_PER_PITCH - found.line : found.line;
      const mirror = Math.abs(partner - found.line) >= count * LINES_PER_PITCH ? band(partner, count) : null;
      const sides = options.halves && !swapped && found.groups.length % 2 === 0;
      if ((mirror || sides) && count > 2) continue;
      if (sides) {
        const half = found.groups.length / 2;
        found = { ...found, groups: found.groups.slice().sort((a, b) => a.u - b.u).slice(half - 1, half + 1) };
      }
      bands = mirror ? [found, mirror].sort((a, b) => a.line - b.line) : [found];
    }
  }

  const total = bands.reduce((sum, item) => sum + item.groups.length, 0);
  const centreLine = (lineCount - 1) / 2;
  // A location on the axis takes its rails in mirrored pairs: partners sit in the same row at the same
  // distance from the axis, and only a stretch on the axis itself holds an odd rail.
  const mirrored = Boolean(swapped ? options.mirrorBands : options.symmetric);
  const slots = bands.flatMap((item, index) => [...new Set(item.groups.map((entry) => entry.slot))].map((slot) => {
    const entries = item.groups.filter((entry) => entry.slot === slot);
    const offset = swapped ? (item.line + (item.count - 1) * LINES_PER_PITCH / 2 - centreLine) * lineStep
      : entries[0].centre - (bounds.x0 + bounds.x1) / 2;
    const apart = Math.round(Math.abs(offset) / (pitch / 2));
    return { index, slot, most: entries.length, keep: 0, onAxis: apart === 0,
      pair: mirrored ? `${swapped ? slot : index}|${apart}` : `${index}|${slot}` };
  }));
  const wanted = options.rails && mirrored && options.rails % 2 === 1 && !slots.some((slot) => slot.onAxis)
    ? options.rails + 1 : options.rails;
  if (wanted && total > wanted) {
    // More rails fit than the location ever fills: share the needed ones out and spread them evenly.
    shareOut(slots, wanted);
    bands = bands.map((item, index) => band(item.line, item.count, null,
      new Map(slots.filter((slot) => slot.index === index).map((slot) => [slot.slot, slot.keep])))).filter(Boolean);
  }

  if (options.mirrorBands) {
    // Side-by-side bands of a location on the axis are exact mirror images: those before the middle
    // copy their partners, so a part-filled pair stays even and both start at the axis.
    const axis = (bounds.y0 + bounds.y1) / 2;
    const middle = (item) => item.line + ((item.count - 1) * LINES_PER_PITCH + staggerLines) / 2;
    const before = (item) => middle(item) < centreLine - 1;
    const reflect = (item, source) => ({ ...item,
      groups: source.groups.map((entry) => ({ ...entry, pips: entry.pips.map(([u, v]) => [u, 2 * axis - v]) })) });
    const mirrorLine = (item) => lineCount - 1 - (item.count - 1) * LINES_PER_PITCH - item.line;
    bands = bands.map((item) => {
      // A band at the far edge has no room for its shifted rails and sits half a pitch off its partner's image.
      const partner = bands.find((other) => other !== item
        && Math.abs(middle(other) - (2 * centreLine - middle(item))) <= staggerLines + 2);
      if (partner) return before(item) ? reflect(item, partner) : item;
      // Two areas whose unshifted rails mirror each other: a shifted rail fits in one, which is the pattern for both.
      const other = options.halves && bands.find((candidate) => candidate !== item && Math.abs(candidate.line - mirrorLine(item)) <= 2);
      if (!other || other.groups.length < item.groups.length) return item;
      return other.groups.length > item.groups.length || before(item) ? reflect(item, other) : item;
    });
  }

  // Fill order: the unshifted rails band by band (centre, then outer, then inner side), so blocks of
  // five stay a lane apart; then the shifted rails in between, one per band in turn.
  const outerSign = options.outer === 'max' ? -1 : 1;
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
  if (options.sequence) {
    // Reading order instead: rows from the top, each from the left, and every rail's pips the same way.
    const page = ([u, v]) => (swapped ? [v, u] : [u, v]);
    const ends = (entry) => [page(entry.pips[0]), page(entry.pips[entry.pips.length - 1])];
    for (const { entry } of entries) {
      const [first, last] = ends(entry);
      const across = Math.abs(last[0] - first[0]) >= Math.abs(last[1] - first[1]);
      if (across ? last[0] < first[0] : last[1] < first[1]) entry.pips = entry.pips.slice().reverse();
    }
    const middle = (entry) => ends(entry).reduce((sum, point) => [sum[0] + point[0] / 2, sum[1] + point[1] / 2], [0, 0]);
    entries.sort((a, b) => middle(a.entry)[1] - middle(b.entry)[1]);
    // Rails less than a pip apart in height (side by side, one shifted) are one row.
    let row = -1, rowTop = -Infinity;
    for (const item of entries) {
      const y = middle(item.entry)[1];
      if (y - rowTop > pitch * 0.6) { row++; rowTop = y; }
      item.row = row;
    }
    entries.sort((a, b) => a.row - b.row || middle(a.entry)[0] - middle(b.entry)[0]);
  }

  const swap = ([u, v]) => (swapped ? [v, u] : [u, v]);
  const rails = entries.map(({ entry }) => {
    const { pips } = entry;
    const first = pips[0], last = pips[pips.length - 1];
    const direction = entry.count > 1
      ? [(last[0] - first[0]) / (entry.count - 1) / pitch, (last[1] - first[1]) / (entry.count - 1) / pitch]
      : [0, 1];
    return {
      from: swap([first[0] - direction[0] * pitch / 2, first[1] - direction[1] * pitch / 2]),
      to: swap([last[0] + direction[0] * pitch / 2, last[1] + direction[1] * pitch / 2]),
      capacity: entry.count,
      pips: pips.map(swap),
    };
  });
  return {
    rails,
    mode: swapped ? 'H' : 'V',
    capacity: rails.reduce((sum, rail) => sum + rail.capacity, 0),
    full: best !== null,
  };
}

/**
 * Gives every band the same number of rails as far as it holds them; leftovers go to the widest,
 * evenly spaced, and to slots that share a `pair` together.
 */
function shareOut(slots, rails) {
  const held = (level) => slots.reduce((sum, slot) => sum + Math.min(slot.most, level), 0);
  let level = 0;
  while (held(level + 1) <= rails) level++;
  slots.forEach((slot) => { slot.keep = Math.min(slot.most, level); });
  let extra = rails - held(level);
  const wider = slots.filter((slot) => slot.most > level);
  for (const size of [...new Set(wider.map((slot) => slot.most))].sort((a, b) => b - a)) {
    const units = new Map();
    for (const slot of wider.filter((item) => item.most === size)) {
      if (!units.has(slot.pair)) units.set(slot.pair, []);
      units.get(slot.pair).push(slot);
    }
    const list = [...units.values()];
    // The most evenly spaced units whose rails the leftover covers.
    for (let count = list.length; count > 0; count--) {
      const chosen = Array.from({ length: count }, (_, index) => list[Math.floor((index + 0.5) * list.length / count - 1e-9)]);
      const given = chosen.reduce((sum, unit) => sum + unit.length, 0);
      if (given > extra) continue;
      chosen.flat().forEach((slot) => { slot.keep++; });
      extra -= given;
      break;
    }
    if (extra === 0) break;
  }
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

function union(intervals, gap = 0) {
  const sorted = intervals.map((interval) => interval.slice()).sort((a, b) => a[0] - b[0]);
  const result = [];
  for (const [from, to] of sorted) {
    const last = result[result.length - 1];
    if (last && from <= last[1] + gap) last[1] = Math.max(last[1], to);
    else result.push([from, to]);
  }
  return result;
}
