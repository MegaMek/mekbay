// Geometry helpers for the paperdoll rail/fill generator.

export const round = (value, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function parseTransform(text) {
  let matrix = [1, 0, 0, 1, 0, 0];
  if (!text) return matrix;
  const pattern = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g;
  let match;
  while ((match = pattern.exec(text))) {
    const values = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let next;
    switch (match[1]) {
      case 'matrix': next = values; break;
      case 'translate': next = [1, 0, 0, 1, values[0], values[1] ?? 0]; break;
      case 'scale': next = [values[0], 0, 0, values[1] ?? values[0], 0, 0]; break;
      case 'rotate': {
        const angle = values[0] * Math.PI / 180;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        next = [cos, sin, -sin, cos, 0, 0];
        if (values.length === 3) {
          const [, cx, cy] = values;
          next = multiply(multiply([1, 0, 0, 1, cx, cy], next), [1, 0, 0, 1, -cx, -cy]);
        }
        break;
      }
    }
    matrix = multiply(matrix, next);
  }
  return matrix;
}

export function multiply(first, second) {
  return [
    first[0] * second[0] + first[2] * second[1],
    first[1] * second[0] + first[3] * second[1],
    first[0] * second[2] + first[2] * second[3],
    first[1] * second[2] + first[3] * second[3],
    first[0] * second[4] + first[2] * second[5] + first[4],
    first[1] * second[4] + first[3] * second[5] + first[5],
  ];
}

export const applyMatrix = (matrix, [x, y]) => [
  matrix[0] * x + matrix[2] * y + matrix[4],
  matrix[1] * x + matrix[3] * y + matrix[5],
];

/** Union of axis-aligned rectangles as closed loops (outer loops and holes wind oppositely). */
export function rectUnionLoops(rects) {
  const xs = [...new Set(rects.flatMap((rect) => [round(rect.x0), round(rect.x1)]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((rect) => [round(rect.y0), round(rect.y1)]))].sort((a, b) => a - b);
  const columns = xs.length - 1, rows = ys.length - 1;
  const filled = Array.from({ length: rows }, () => new Uint8Array(columns));
  for (const rect of rects) {
    const c0 = xs.indexOf(round(rect.x0)), c1 = xs.indexOf(round(rect.x1));
    const r0 = ys.indexOf(round(rect.y0)), r1 = ys.indexOf(round(rect.y1));
    for (let row = r0; row < r1; row++) for (let column = c0; column < c1; column++) filled[row][column] = 1;
  }
  const isFilled = (row, column) => row >= 0 && row < rows && column >= 0 && column < columns && filled[row][column] === 1;
  // Directed boundary edges with the interior on the right (screen coordinates).
  const edges = new Map();
  const addEdge = (from, to) => {
    const key = from.join(',');
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push(to);
  };
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (!filled[row][column]) continue;
      if (!isFilled(row - 1, column)) addEdge([column, row], [column + 1, row]);
      if (!isFilled(row, column + 1)) addEdge([column + 1, row], [column + 1, row + 1]);
      if (!isFilled(row + 1, column)) addEdge([column + 1, row + 1], [column, row + 1]);
      if (!isFilled(row, column - 1)) addEdge([column, row + 1], [column, row]);
    }
  }
  const loops = [];
  while (edges.size > 0) {
    const startKey = edges.keys().next().value;
    const start = startKey.split(',').map(Number);
    const loop = [start];
    let current = start, previous = null;
    for (;;) {
      const key = current.join(',');
      const targets = edges.get(key);
      let next;
      if (targets.length === 1 || !previous) {
        next = targets.shift();
      } else {
        // At a pinch point keep the two touching loops separate: turn right.
        const dx = current[0] - previous[0], dy = current[1] - previous[1];
        const index = targets.findIndex((target) => target[0] - current[0] === -dy && target[1] - current[1] === dx);
        next = targets.splice(index === -1 ? 0 : index, 1)[0];
      }
      if (targets.length === 0) edges.delete(key);
      previous = current;
      current = next;
      if (current[0] === start[0] && current[1] === start[1]) break;
      loop.push(current);
    }
    loops.push(removeCollinear(loop.map(([column, row]) => [xs[column], ys[row]])));
  }
  return loops;
}

export function removeCollinear(loop, tolerance = 1e-6) {
  let points = loop.slice();
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    for (let index = 0; index < points.length; index++) {
      const previous = points[(index + points.length - 1) % points.length];
      const current = points[index];
      const next = points[(index + 1) % points.length];
      if (pointSegmentDistance(current, previous, next) <= tolerance) {
        points.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return points;
}

export function signedArea(loop) {
  let area = 0;
  for (let index = 0; index < loop.length; index++) {
    const [x0, y0] = loop[index];
    const [x1, y1] = loop[(index + 1) % loop.length];
    area += x0 * y1 - x1 * y0;
  }
  return area / 2;
}

/**
 * Replaces row-by-row stair steps with the slanted edge through the middle of each step, the line
 * the rows were sampled from.
 */
export function smoothStairs(loop, rowHeight, maxStep = rowHeight * 0.9) {
  const orientation = Math.sign(signedArea(loop));
  const count = loop.length;
  const turn = (index) => {
    const previous = loop[(index + count - 1) % count], current = loop[index], next = loop[(index + 1) % count];
    return Math.sign((current[0] - previous[0]) * (next[1] - current[1]) - (current[1] - previous[1]) * (next[0] - current[0]));
  };
  const convex = loop.map((_, index) => turn(index) === orientation);
  // A step is a short horizontal edge between a convex and a concave corner, with one row on each side.
  const replaced = new Map();
  const dropped = new Set();
  for (let index = 0; index < count; index++) {
    const nextIndex = (index + 1) % count;
    const current = loop[index], next = loop[nextIndex];
    if (convex[index] === convex[nextIndex] || Math.abs(current[1] - next[1]) > 1e-9) continue;
    const before = loop[(index + count - 1) % count], after = loop[(nextIndex + 1) % count];
    const vertical = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) <= rowHeight * 1.6;
    if (Math.abs(current[0] - next[0]) > maxStep || !vertical(before, current) || !vertical(next, after)) continue;
    replaced.set(index, [(current[0] + next[0]) / 2, current[1]]);
    dropped.add(nextIndex);
  }
  return loop.flatMap((point, index) => (dropped.has(index) ? [] : [replaced.get(index) ?? point]));
}

/** Drops vertices that sit within the tolerance of the line through their neighbours. */
export function simplifyLoop(loop, tolerance) {
  let points = loop.slice();
  for (;;) {
    let best = -1, bestDistance = tolerance;
    for (let index = 0; index < points.length && points.length > 3; index++) {
      const previous = points[(index + points.length - 1) % points.length];
      const next = points[(index + 1) % points.length];
      const distance = pointSegmentDistance(points[index], previous, next);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    }
    if (best === -1) return points;
    points.splice(best, 1);
  }
}

export function pointSegmentDistance([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Even-odd containment across all loops. */
export function insideLoops([px, py], loops) {
  let inside = false;
  for (const loop of loops) {
    for (let index = 0, previous = loop.length - 1; index < loop.length; previous = index++) {
      const [x0, y0] = loop[index], [x1, y1] = loop[previous];
      if ((y0 > py) !== (y1 > py) && px < (x1 - x0) * (py - y0) / (y1 - y0) + x0) inside = !inside;
    }
  }
  return inside;
}

export function boundaryDistance(point, loops) {
  let distance = Infinity;
  for (const loop of loops) {
    for (let index = 0; index < loop.length; index++) {
      distance = Math.min(distance, pointSegmentDistance(point, loop[index], loop[(index + 1) % loop.length]));
    }
  }
  return distance;
}

export function loopsBounds(loops) {
  const xs = loops.flat().map((point) => point[0]), ys = loops.flat().map((point) => point[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

export const loopsToPath = (loops, digits = 2) => loops
  .map((loop) => `M ${loop.map(([x, y]) => `${round(x, digits)} ${round(y, digits)}`).join(' L ')} Z`)
  .join(' ');

/** Flattens an SVG path (M L H V C Q Z, absolute or relative) into closed loops. */
export function flattenPath(d, curveSteps = 12) {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? [];
  const loops = [];
  let loop = null, x = 0, y = 0, startX = 0, startY = 0, command = '', index = 0;
  const number = () => Number(tokens[index++]);
  const push = (nx, ny) => { x = nx; y = ny; loop.push([x, y]); };
  while (index < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[index])) command = tokens[index++];
    const relative = command === command.toLowerCase();
    const ox = relative ? x : 0, oy = relative ? y : 0;
    switch (command.toUpperCase()) {
      case 'M':
        if (loop && loop.length > 2) loops.push(loop);
        loop = [];
        push(ox + number(), oy + number());
        startX = x; startY = y;
        command = relative ? 'l' : 'L';
        break;
      case 'L': push(ox + number(), oy + number()); break;
      case 'H': push(ox + number(), y); break;
      case 'V': push(x, oy + number()); break;
      case 'C': {
        const x0 = x, y0 = y;
        const x1 = ox + number(), y1 = oy + number(), x2 = ox + number(), y2 = oy + number(), x3 = ox + number(), y3 = oy + number();
        for (let step = 1; step <= curveSteps; step++) {
          const t = step / curveSteps, u = 1 - t;
          push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
        }
        break;
      }
      case 'Q': {
        const x0 = x, y0 = y;
        const x1 = ox + number(), y1 = oy + number(), x2 = ox + number(), y2 = oy + number();
        for (let step = 1; step <= curveSteps; step++) {
          const t = step / curveSteps, u = 1 - t;
          push(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2);
        }
        break;
      }
      case 'Z':
        x = startX; y = startY;
        break;
      default:
        throw new Error(`Unsupported path command ${command} in ${d.slice(0, 60)}`);
    }
  }
  if (loop && loop.length > 2) loops.push(loop);
  return loops.map((points) => {
    const first = points[0], last = points[points.length - 1];
    return Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6 ? points.slice(0, -1) : points;
  });
}

/**
 * Splits a set of axis-aligned rectangles into stacks that have a single run per row, so each
 * stack is one contiguous area without notches or holes.
 */
export function splitSections(rects) {
  const xs = [...new Set(rects.flatMap((rect) => [round(rect.x0), round(rect.x1)]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((rect) => [round(rect.y0), round(rect.y1)]))].sort((a, b) => a - b);
  const slabs = [];
  for (let row = 0; row < ys.length - 1; row++) {
    const filled = new Uint8Array(xs.length - 1);
    for (const rect of rects) {
      if (round(rect.y0) <= ys[row] && round(rect.y1) >= ys[row + 1]) {
        for (let column = xs.indexOf(round(rect.x0)); column < xs.indexOf(round(rect.x1)); column++) filled[column] = 1;
      }
    }
    const runs = [];
    for (let column = 0; column < filled.length; column++) {
      if (!filled[column]) continue;
      const start = column;
      while (column + 1 < filled.length && filled[column + 1]) column++;
      runs.push({ x0: xs[start], x1: xs[column + 1], y0: ys[row], y1: ys[row + 1], parents: [], children: [] });
    }
    slabs.push(runs);
  }
  for (let row = 1; row < slabs.length; row++) {
    for (const run of slabs[row]) {
      for (const above of slabs[row - 1]) {
        if (Math.min(run.x1, above.x1) - Math.max(run.x0, above.x0) > 1e-6) {
          run.parents.push(above);
          above.children.push(run);
        }
      }
    }
  }
  const sections = [];
  for (const runs of slabs) {
    for (const run of runs) {
      const parent = run.parents.length === 1 && run.parents[0].children.length === 1 ? run.parents[0] : null;
      if (parent) {
        run.section = parent.section;
      } else {
        run.section = [];
        sections.push(run.section);
      }
      run.section.push({ x0: run.x0, x1: run.x1, y0: run.y0, y1: run.y1 });
    }
  }
  return sections;
}

/** Shrinks a union of axis-aligned rectangles by `distance` on every side (square erosion). */
export function erodeRects(rects, amount) {
  // Work on the same three-decimal grid as the edges, or a grown cell overshoots by rounding noise.
  const distance = round(amount);
  if (distance <= 0) return rects;
  const edges = (pick) => [...new Set(rects.flatMap(pick).map((value) => round(value)))].sort((a, b) => a - b);
  const xs0 = edges((rect) => [rect.x0, rect.x1]), ys0 = edges((rect) => [rect.y0, rect.y1]);
  const columns = xs0.length - 1, rows = ys0.length - 1;
  const filled = new Uint8Array(columns * rows);
  for (const rect of rects) {
    const c0 = xs0.indexOf(round(rect.x0)), c1 = xs0.indexOf(round(rect.x1));
    const r0 = ys0.indexOf(round(rect.y0)), r1 = ys0.indexOf(round(rect.y1));
    for (let row = r0; row < r1; row++) filled.fill(1, row * columns + c0, row * columns + c1);
  }
  // Every original cell the grown rectangle touches must belong to the union.
  const covered = (x0, x1, y0, y1) => {
    if (x0 < xs0[0] - 1e-6 || x1 > xs0[columns] + 1e-6 || y0 < ys0[0] - 1e-6 || y1 > ys0[rows] + 1e-6) return false;
    for (let column = 0; column < columns; column++) {
      if (Math.min(x1, xs0[column + 1]) - Math.max(x0, xs0[column]) <= 1e-6) continue;
      for (let row = 0; row < rows; row++) {
        if (Math.min(y1, ys0[row + 1]) - Math.max(y0, ys0[row]) <= 1e-6) continue;
        if (!filled[row * columns + column]) return false;
      }
    }
    return true;
  };
  const grown = (values) => [...new Set(values.flatMap((value) => [value - distance, value, value + distance]).map((value) => round(value)))].sort((a, b) => a - b);
  const xs = grown(xs0), ys = grown(ys0);
  const result = [];
  for (let row = 0; row < ys.length - 1; row++) {
    // Merge the kept cells of a row into runs to keep the outline small.
    let start = null;
    for (let column = 0; column <= xs.length - 1; column++) {
      const keep = column < xs.length - 1
        && covered(xs[column] - distance, xs[column + 1] + distance, ys[row] - distance, ys[row + 1] + distance);
      if (keep && start === null) start = xs[column];
      if (!keep && start !== null) {
        result.push({ x0: start, x1: xs[column], y0: ys[row], y1: ys[row + 1] });
        start = null;
      }
    }
  }
  return result;
}

/**
 * The part of the loops that keeps `clearance` from everything that is not free, sampled on a grid of
 * `cell`: its outline follows the real border at an even distance, around every bump of it, instead
 * of the stair steps of the rows it was made from. Whatever is narrower than `minWidth` (a wedge
 * running into a corner, a neck between two drawn lines) is left out: no pip fits there. Returns outer
 * loops (positive area) and holes.
 */
export function fitToFree(loops, free, clearance, cell, tolerance, minArea, minWidth = 0) {
  const bounds = loopsBounds(loops);
  const reach = Math.ceil(clearance / cell) + 2;
  const x0 = (Math.floor(bounds.x0 / cell) - reach - 1) * cell, y0 = (Math.floor(bounds.y0 / cell) - reach - 1) * cell;
  const width = Math.ceil((bounds.x1 - x0) / cell) + reach + 2, height = Math.ceil((bounds.y1 - y0) / cell) + reach + 2;
  const far = (reach + 1) * cell;
  // Distance, in cells, of every grid point from the nearest marked one, up to `limit` + 1.
  const distance = (marked, limit) => {
    const column = new Float32Array(width * height), result = new Float32Array(width * height);
    for (let i = 0; i < width; i++) {
      let run = limit + 1;
      for (let j = 0; j < height; j++) {
        run = marked[j * width + i] ? 0 : Math.min(run + 1, limit + 1);
        column[j * width + i] = run;
      }
      run = limit + 1;
      for (let j = height - 1; j >= 0; j--) {
        run = marked[j * width + i] ? 0 : Math.min(run + 1, limit + 1);
        column[j * width + i] = Math.min(column[j * width + i], run);
      }
    }
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        let best = (limit + 1) * (limit + 1);
        for (let other = Math.max(0, i - limit); other <= Math.min(width - 1, i + limit); other++) {
          const down = column[j * width + other], value = (i - other) * (i - other) + down * down;
          if (value < best) best = value;
        }
        result[j * width + i] = Math.sqrt(best);
      }
    }
    return result;
  };
  const taken = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) taken[j * width + i] = free(x0 + i * cell, y0 + j * cell) ? 0 : 1;
  }
  const depth = distance(taken, reach);
  // Signed distance from the loops themselves, exact only next to their outline.
  const inside = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    // Even-odd along the grid line, as insideLoops counts: a point is inside with an odd number of crossings to its right.
    const y = y0 + j * cell, crossings = [];
    for (const loop of loops) {
      for (let index = 0, previous = loop.length - 1; index < loop.length; previous = index++) {
        const [ax, ay] = loop[index], [bx, by] = loop[previous];
        if ((ay > y) !== (by > y)) crossings.push((bx - ax) * (y - ay) / (by - ay) + ax);
      }
    }
    crossings.sort((a, b) => a - b);
    let passed = 0;
    for (let i = 0; i < width; i++) {
      const x = x0 + i * cell;
      while (passed < crossings.length && crossings[passed] <= x) passed++;
      inside[j * width + i] = (crossings.length - passed) % 2;
    }
  }
  const field = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const index = j * width + i, here = inside[index];
      const edge = (i > 0 && inside[index - 1] !== here) || (i < width - 1 && inside[index + 1] !== here)
        || (j > 0 && inside[index - width] !== here) || (j < height - 1 && inside[index + width] !== here);
      const own = edge ? boundaryDistance([x0 + i * cell, y0 + j * cell], loops) * (here ? 1 : -1) : here ? far : -far;
      field[index] = Math.min(Math.min(far, depth[index] * cell) - clearance, own);
    }
  }
  if (minWidth > 0) {
    // Shrunk by half that width and grown back: what is narrower does not come back.
    const half = minWidth / 2, limit = Math.ceil(half / cell) + 2;
    const outside = new Uint8Array(width * height);
    for (let index = 0; index < outside.length; index++) outside[index] = field[index] > 0 ? 0 : 1;
    const core = distance(outside, limit);
    for (let index = 0; index < core.length; index++) core[index] = core[index] * cell >= half ? 1 : 0;
    const back = distance(core, limit);
    for (let index = 0; index < field.length; index++) field[index] = Math.min(field[index], half + cell / 2 - back[index] * cell);
  }
  // Marching squares, the crossings interpolated.
  const value = (i, j) => (i < 0 || j < 0 || i >= width || j >= height ? -far : field[j * width + i]);
  const nodes = new Map(), links = new Map();
  const cross = (i0, j0, i1, j1) => {
    const key = `${i0},${j0},${i1},${j1}`;
    if (!nodes.has(key)) {
      const a = value(i0, j0), b = value(i1, j1), t = a / (a - b);
      nodes.set(key, [x0 + (i0 + (i1 - i0) * t) * cell, y0 + (j0 + (j1 - j0) * t) * cell]);
      links.set(key, []);
    }
    return key;
  };
  const link = (a, b) => { links.get(a).push(b); links.get(b).push(a); };
  for (let j = 0; j < height - 1; j++) {
    for (let i = 0; i < width - 1; i++) {
      const code = (value(i, j) > 0 ? 1 : 0) | (value(i + 1, j) > 0 ? 2 : 0) | (value(i + 1, j + 1) > 0 ? 4 : 0) | (value(i, j + 1) > 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => cross(i, j, i + 1, j), right = () => cross(i + 1, j, i + 1, j + 1);
      const bottom = () => cross(i, j + 1, i + 1, j + 1), left = () => cross(i, j, i, j + 1);
      if (code === 1 || code === 14) link(left(), top());
      else if (code === 2 || code === 13) link(top(), right());
      else if (code === 4 || code === 11) link(right(), bottom());
      else if (code === 8 || code === 7) link(left(), bottom());
      else if (code === 3 || code === 12) link(left(), right());
      else if (code === 6 || code === 9) link(top(), bottom());
      else if (code === 5) { link(left(), top()); link(right(), bottom()); } else { link(top(), right()); link(left(), bottom()); }
    }
  }
  const traced = [];
  const used = new Set();
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let current = start, previous = null;
    do {
      used.add(current);
      loop.push(nodes.get(current));
      const [first, second] = links.get(current);
      const next = first !== previous ? first : second;
      previous = current;
      current = next;
    } while (current !== undefined && current !== start);
    traced.push(loop);
  }
  // Douglas-Peucker on each closed loop, split at its two points farthest apart.
  const reduce = (points) => {
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [from, to] = stack.pop();
      let worst = 0, at = -1;
      for (let index = from + 1; index < to; index++) {
        const gap = pointSegmentDistance(points[index], points[from], points[to]);
        if (gap > worst) { worst = gap; at = index; }
      }
      if (worst > tolerance) { keep[at] = 1; stack.push([from, at], [at, to]); }
    }
    return points.filter((_, index) => keep[index]);
  };
  const simplified = traced.filter((loop) => loop.length >= 4 && Math.abs(signedArea(loop)) >= minArea).map((loop) => {
    let apart = 0;
    loop.forEach((point, index) => {
      if (Math.hypot(point[0] - loop[0][0], point[1] - loop[0][1]) > Math.hypot(loop[apart][0] - loop[0][0], loop[apart][1] - loop[0][1])) apart = index;
    });
    return [...reduce(loop.slice(0, apart + 1)), ...reduce([...loop.slice(apart), loop[0]]).slice(1, -1)];
  }).filter((loop) => loop.length >= 3);
  // Outer loops run one way and holes the other, as rectUnionLoops gives them.
  return simplified.map((loop, index) => {
    const hole = simplified.filter((other, otherIndex) => otherIndex !== index && insideLoops(loop[0], [other])).length % 2 === 1;
    return (signedArea(loop) > 0) === hole ? loop.slice().reverse() : loop;
  });
}
