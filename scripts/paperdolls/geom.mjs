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
