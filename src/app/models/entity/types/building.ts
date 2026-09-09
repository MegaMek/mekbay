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
export const BUILDING_ORIGIN: BuildingHex = Object.freeze({ q: 0, r: 0 });
export const BUILDING_CLASSES: Readonly<Record<number, string>> = {
  0: 'Standard',
  1: 'Hangar',
  2: 'Fortress',
  3: 'Gun Emplacement',
};
export const BUILDING_TYPES: Readonly<Record<number, string>> = {
  1: 'Light',
  2: 'Medium',
  3: 'Heavy',
  4: 'Hardened',
  5: 'Wall',
};
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
