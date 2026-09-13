// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { type BuildingDoor } from '../types/building';

type Point = readonly [number, number];
export interface BuildingDoorGeometry { readonly line: readonly Point[]; readonly arrow: readonly Point[]; }
const VERTICES: readonly Point[] = [[2, 0], [1, 1], [-1, 1], [-2, 0], [-1, -1], [1, -1]];

/** Integer lattice vertices avoid rounding when testing whether two exterior edges touch. */
export function buildingDoorVertices(door: BuildingDoor): readonly Point[] {
  return [4, 5].map(offset => {
    const vertex = VERTICES[(door.facing + offset) % 6];
    return [3 * door.position.hex.q + vertex[0], 2 * door.position.hex.r + door.position.hex.q + vertex[1]] as const;
  });
}

export function buildingDoorsTouch(a: BuildingDoor, b: BuildingDoor): boolean {
  if (a === b || a.position.floor !== b.position.floor || a.height !== b.height) return false;
  const av = buildingDoorVertices(a), bv = buildingDoorVertices(b);
  return av.filter(p => bv.some(q => p[0] === q[0] && p[1] === q[1])).length === 1;
}

/** Derive connected openings; removing a segment never draws a line across the resulting gap. */
export function buildingDoorGroups(doors: readonly BuildingDoor[]): BuildingDoor[][] {
  const pending = new Set(doors.filter(door => door.linkGroup));
  const groups: BuildingDoor[][] = [];
  while (pending.size) {
    const group = [pending.values().next().value!];
    pending.delete(group[0]);
    for (const door of group) for (const other of pending) {
      if (door.linkGroup === other.linkGroup && buildingDoorsTouch(door, other)) {
        group.push(other); pending.delete(other);
      }
    }
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

export function linkBuildingDoors(doors: readonly BuildingDoor[], a: BuildingDoor, b: BuildingDoor): readonly BuildingDoor[] {
  if (!buildingDoorsTouch(a, b)) return doors;
  const group = a.linkGroup || b.linkGroup || reserveLinkGroup(new Set(doors.map(door => door.linkGroup ?? 0)));
  return normalizeBuildingDoorLinks(doors.map(door => door === a || door === b || (a.linkGroup && door.linkGroup === a.linkGroup)
    || (b.linkGroup && door.linkGroup === b.linkGroup) ? { ...door, linkGroup: group } : door));
}

export function unlinkBuildingDoor(doors: readonly BuildingDoor[], target: BuildingDoor): readonly BuildingDoor[] {
  return normalizeBuildingDoorLinks(doors.map(door => {
    if (door !== target) return door;
    const { linkGroup, ...independent } = door;
    return independent;
  }));
}

/** Remove singleton links and give separated openings distinct identities after an edit. */
export function normalizeBuildingDoorLinks(doors: readonly BuildingDoor[]): readonly BuildingDoor[] {
  const reserved = new Set(doors.map(door => door.linkGroup ?? 0));
  const used = new Set<number>(), assignments = new Map<BuildingDoor, number>();
  for (const group of buildingDoorGroups(doors)) {
    const id = used.has(group[0].linkGroup!) ? reserveLinkGroup(reserved) : group[0].linkGroup!;
    used.add(id);
    group.forEach(door => assignments.set(door, id));
  }
  return doors.map(door => {
    const linkGroup = assignments.get(door);
    if (linkGroup === door.linkGroup) return door;
    const { linkGroup: previous, ...independent } = door;
    return linkGroup ? { ...independent, linkGroup } : independent;
  });
}

/** Fill an unused positive ID instead of exceeding the native limit after a maximum imported ID. */
function reserveLinkGroup(reserved: Set<number>): number {
  let id = 1;
  while (reserved.has(id)) id++;
  reserved.add(id);
  return id;
}

/** Unit-radius geometry shared by editor and sheet affine projections. Each segment owns its portion of the line. */
export function buildingLinkedDoorGeometry(doors: readonly BuildingDoor[], visible: (door: BuildingDoor) => boolean = () => true) {
  const result = new Map<BuildingDoor, BuildingDoorGeometry>();
  const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  for (const group of buildingDoorGroups(doors)) {
    const center = new Map(group.map(door => {
      const [a, b] = buildingDoorVertices(door);
      return [door, [(a[0] + b[0]) / 4, (a[1] + b[1]) * Math.sqrt(3) / 4] as Point] as const;
    }));
    for (const door of group) {
      const c = center.get(door)!;
      if (!visible(door)) continue;
      const neighbors = group.filter(other => buildingDoorsTouch(door, other));
      const p = center.get(neighbors[0])!;
      const q: Point = neighbors.length > 1 ? center.get(neighbors[1])! : [2 * c[0] - p[0], 2 * c[1] - p[1]];
      let nx = -(q[1] - p[1]), ny = q[0] - p[0];
      const length = Math.hypot(nx, ny);
      if (!length) continue;
      nx /= length; ny /= length;
      const hx = 1.5 * door.position.hex.q, hy = Math.sqrt(3) * (door.position.hex.r + door.position.hex.q / 2);
      if (nx * (c[0] - hx) + ny * (c[1] - hy) < 0) { nx = -nx; ny = -ny; }
      const local = ([x, y]: Point): Point => [x - hx, y - hy];
      const line: Point[] = [];
      if (visible(neighbors[0])) line.push(midpoint(c, p));
      line.push(c);
      if (neighbors.length > 1 && visible(neighbors[1])) line.push(midpoint(c, q));
      result.set(door, {
        line: line.map(local),
        arrow: [local([c[0] + nx * .26, c[1] + ny * .26]),
          local([c[0] - nx * .13 - ny * .18, c[1] - ny * .13 + nx * .18]),
          local([c[0] - nx * .13 + ny * .18, c[1] - ny * .13 - nx * .18])],
      });
    }
  }
  return result;
}
