// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Relative axial coordinates. The third native cube axis is always -q-r. */
export interface BuildingHex {
  readonly q: number;
  readonly r: number;
}
export interface BuildingLocation {
  readonly hex: BuildingHex;
  readonly floor: number;
}
export interface BuildingDoor {
  readonly position: BuildingLocation;
  readonly facing: number;
  readonly height: number;
  /** Shared opening identity within this building; absent for independent doors. */
  readonly linkGroup?: number;
}
/** Transport door association; bayId is the in-memory bay identity, written as its native bay number. */
export interface BuildingBayDoor {
  readonly bayId: string;
  readonly position: BuildingLocation;
  readonly facing: number;
}
export interface BuildingElevator {
  readonly hex: BuildingHex;
  readonly capacity: number;
  readonly exits: ReadonlyMap<number, number>;
}
export interface BuildingSpace {
  readonly position: BuildingLocation;
  readonly tons: number;
}
export interface BuildingEquipmentPlacement {
  readonly positions: readonly BuildingLocation[];
  readonly automated: boolean;
  readonly pcmtSource: number;
}
export const BUILDING_ORIGIN: BuildingHex = Object.freeze({ q: 0, r: 0 });
export const BUILDING_CLASSES: Readonly<Record<number, string>> = {
  0: 'Standard',
  1: 'Hangar',
  2: 'Fortress',
  3: 'Gun Emplacement',
  4: 'Castles Brian',
  5: 'Tent',
  6: 'Wall',
  7: 'Fence',
  8: 'Bridge',
};
export const BUILDING_TYPES: Readonly<Record<number, string>> = {
  1: 'Light',
  2: 'Medium',
  3: 'Heavy',
  4: 'Hardened',
  5: 'Wall',
  6: 'Rail',
};

export interface BuildingOptions {
  readonly sealing: boolean;
  readonly heavyMetal: boolean;
  readonly civilianOfficers: boolean;
  readonly tunnel: boolean;
  readonly openSpace: boolean;
  readonly roofClearance: boolean;
  readonly ceiling: 'STANDARD' | 'HIGH' | 'LOW';
  readonly site: 'SURFACE' | 'UNDERGROUND' | 'UNDERWATER';
  readonly depth: number;
  /** Display level of native floor 0; null derives it from site and roof cover. */
  readonly baseLevel: number | null;
}
export const DEFAULT_BUILDING_OPTIONS: BuildingOptions = Object.freeze({ sealing: false, heavyMetal: false,
  civilianOfficers: false, tunnel: false, openSpace: false, roofClearance: false, ceiling: 'STANDARD', site: 'SURFACE', depth: 1, baseLevel: null });
export const BUILDING_SIDE_LABELS = ['N', 'NE', 'SE', 'S', 'SW', 'NW'] as const;

export interface BuildingLimits {
  readonly minimumCF: number;
  readonly maximumCF: number;
  readonly hexes: number;
  readonly levels: number;
}

/** TO:AR p. 113. Static buildings share one footprint and height (p. 127). */
export function buildingLimits(type: number, classification: number): BuildingLimits | null {
  if (classification === 5) return type === 1 ? { minimumCF: 1, maximumCF: 2, hexes: 1, levels: 1 } : null;
  if (classification === 7) return type === 1 ? { minimumCF: 1, maximumCF: 1, hexes: Infinity, levels: 3 } : null;
  if (classification === 8 && type === 6) return { minimumCF: 151, maximumCF: 650, hexes: Infinity, levels: 1 };
  const index = type - 1;
  if (!Number.isInteger(index) || index < 0 || index > 3) return null;
  if (classification === 1) return {
    minimumCF: [1, 9, 17, 46][index], maximumCF: [8, 16, 45, 75][index],
    hexes: [10, 14, 18, 20][index], levels: [7, 10, 13, 14][index],
  };
  let hexes: number, levels: number;
  if (classification === 0 && type !== 4) {
    hexes = [6, 8, 10][index]; levels = [5, 8, 10][index];
  } else if (classification === 2 && type !== 1) {
    hexes = [0, 12, 15, 20][index]; levels = [0, 15, 20, 30][index];
  } else if (classification === 3) {
    hexes = 1; levels = 1;
  } else if (classification === 4) {
    // p. 127 refers to the main p. 113 table (35/70 hexes), which conflicts with p. 212 (20/30).
    // TO:AR errata v7 does not resolve the discrepancy.
    return type === 3 ? { minimumCF: 35, maximumCF: 90, hexes: 35, levels: 10 }
      : type === 4 ? { minimumCF: 91, maximumCF: 150, hexes: 70, levels: 15 } : null;
  } else if (classification === 6) {
    hexes = Infinity; levels = [4, 6, 8, 10][index];
  } else if (classification === 8) {
    hexes = Infinity; levels = 1;
  } else return null;
  return { minimumCF: [1, 16, 41, 91][index], maximumCF: [15, 40, 90, 150][index], hexes, levels };
}
export const BUILDING_DIRECTIONS: readonly BuildingHex[] = [
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
];

export function buildingHexKey(hex: BuildingHex): string {
  return `${hex.q},${hex.r}`;
}

/** Shared editor/sheet projection, numbered from the footprint's top-left bounds at 0101. */
export function buildingSheetGrid(hexes: readonly BuildingHex[]) {
  const minQ = Math.min(...hexes.map(hex => hex.q));
  const maxQ = Math.max(...hexes.map(hex => hex.q));
  const columns = Math.max(9, maxQ - minQ + 1);
  const shiftQ = -minQ;
  // Translate the cube column before finding rows to preserve staggered-column adjacency.
  const rawRows = hexes.map(hex => hex.r + Math.floor((hex.q + shiftQ) / 2));
  const minRow = Math.min(...rawRows);
  const maxRow = Math.max(...rawRows);
  const rows = Math.max(7, maxRow - minRow + 1);
  const shiftRow = -minRow;
  const position = (hex: BuildingHex) => ({
    column: hex.q + shiftQ,
    row: hex.r + Math.floor((hex.q + shiftQ) / 2) + shiftRow,
  });
  const label = (hex: BuildingHex) => {
    const cell = position(hex);
    return `${String(cell.column + 1).padStart(2, '0')}${String(cell.row + 1).padStart(2, '0')}`;
  };
  const hexAt = (column: number, row: number): BuildingHex => ({
    q: column - shiftQ,
    r: row - shiftRow - Math.floor(column / 2),
  });
  return { columns, rows, position, label, hexAt,
    hexes: hexes.map(hex => ({ hex, ...position(hex), label: label(hex) })) };
}
/** MegaMek's location labels use Java double formatting, including the .0. */
export function buildingCubeText(hex: BuildingHex): string {
  return [hex.q, hex.r, -hex.q - hex.r].map((value) => value.toFixed(1)).join(',');
}
export function buildingLocationName(hex: BuildingHex, floor: number): string {
  return `Level ${floor} ${buildingCubeText(hex)}`;
}

export function parseBuildingHex(text: string): BuildingHex | null {
  const parts = text.split(',').map((value) => value.trim());
  if (parts.length !== 3 || parts.some((value) => !value)) return null;
  const [q, r, s] = parts.map(Number);
  return [q, r, s].every(Number.isSafeInteger) && q + r + s === 0 ? { q, r } : null;
}
export function parseBuildingLocation(text: string): BuildingLocation | null {
  const match = /^Level (\d+) (.+)$/i.exec(text);
  const hex = match && parseBuildingHex(match[2]);
  return hex ? { hex, floor: Number(match![1]) } : null;
}

export function buildingNeighbors(hex: BuildingHex): BuildingHex[] {
  return BUILDING_DIRECTIONS.map((direction) => ({ q: hex.q + direction.q, r: hex.r + direction.r }));
}

export function buildingConnectedComponents(hexes: readonly BuildingHex[]): BuildingHex[][] {
  const remaining = new Map(hexes.map((hex) => [buildingHexKey(hex), hex]));
  const components: BuildingHex[][] = [];
  while (remaining.size) {
    const component = [remaining.values().next().value!];
    remaining.delete(buildingHexKey(component[0]));
    for (let index = 0; index < component.length; index++) {
      for (const neighbor of buildingNeighbors(component[index])) {
        if (remaining.delete(buildingHexKey(neighbor))) component.push(neighbor);
      }
    }
    components.push(component);
  }
  return components;
}

/** The furthest connected hexes define the span; p. 115 rounds each interpolated elevation, never the slope. */
export function buildingBridgeSpan(hexes: readonly BuildingHex[]) {
  const occupied = new Set(hexes.map(buildingHexKey));
  let result: { start: BuildingHex; end: BuildingHex; distances: ReadonlyMap<string, number>; length: number } | null = null;
  for (const start of hexes) {
    const distances = new Map([[buildingHexKey(start), 0]]), pending = [start];
    for (let index = 0; index < pending.length; index++) for (const neighbor of buildingNeighbors(pending[index])) {
      const key = buildingHexKey(neighbor);
      if (occupied.has(key) && !distances.has(key)) {
        distances.set(key, distances.get(buildingHexKey(pending[index]))! + 1);
        pending.push(neighbor);
      }
    }
    if (distances.size !== occupied.size) return null;
    for (const end of hexes) {
      const length = distances.get(buildingHexKey(end))!;
      if (!result || length > result.length) result = { start, end, distances, length };
    }
  }
  return result;
}

export function buildingBridgeLevels(span: NonNullable<ReturnType<typeof buildingBridgeSpan>>, start: number, end: number): Map<string, number> {
  return new Map([...span.distances].map(([key, distance]) => [key,
    span.length === 0 ? start : Math.round(start + (end - start) * distance / span.length)]));
}
