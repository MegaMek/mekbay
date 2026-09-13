// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { BUILDING_DIRECTIONS, BUILDING_ORIGIN, buildingNeighbors, buildingSheetGrid } from './building';

describe('building sheet grid', () => {
  it('numbers from 0101 regardless of the authored origin or input order', () => {
    const footprint = Array.from({ length: 14 }, (_, i) => ({ q: Math.floor(i / 7), r: i % 7 }));
    for (const origin of [BUILDING_ORIGIN, { q: -10, r: -10 }, { q: 37, r: -51 }, { q: -94, r: 63 }]) {
      const hexes = footprint.map(hex => ({ q: hex.q + origin.q, r: hex.r + origin.r }));
      const grid = buildingSheetGrid(hexes);
      expect([grid.columns, grid.rows]).toEqual([9, 7]);
      expect(grid.label(hexes[0])).toBe('0101');
      expect(grid.label(hexes.at(-1)!)).toBe('0207');
      expect(buildingSheetGrid([origin]).label(origin)).toBe('0101');
      const reversed = buildingSheetGrid([...hexes].reverse());
      for (const hex of hexes) {
        const position = grid.position(hex);
        expect(position.column).toBeGreaterThanOrEqual(0);
        expect(position.column).toBeLessThan(grid.columns);
        expect(position.row).toBeGreaterThanOrEqual(0);
        expect(position.row).toBeLessThan(grid.rows);
        expect(grid.hexAt(position.column, position.row)).toEqual(hex);
        expect(reversed.position(hex)).toEqual(position);
      }
    }
  });

  it('preserves all six neighbors across column parity and leaves missing corners empty', () => {
    for (const origin of [BUILDING_ORIGIN, { q: -10, r: -10 }, { q: 37, r: -51 }]) {
      const hexes = [BUILDING_ORIGIN, ...BUILDING_DIRECTIONS]
        .map(hex => ({ q: hex.q + origin.q, r: hex.r + origin.r }));
      const grid = buildingSheetGrid(hexes);
      expect(hexes.map(grid.label)).toEqual(['0202', '0201', '0302', '0303', '0203', '0103', '0102']);
      expect(hexes.map(grid.label)).not.toContain('0101');
      for (const hex of hexes) {
        const cell = grid.position(hex);
        const displayed = { q: cell.column, r: cell.row - Math.floor(cell.column / 2) };
        const displayedNeighbors = buildingNeighbors(displayed);
        for (const neighbor of buildingNeighbors(hex)) {
          const adjacent = grid.position(neighbor);
          expect(displayedNeighbors).toContain({ q: adjacent.column, r: adjacent.row - Math.floor(adjacent.column / 2) });
        }
      }
    }
  });

  it('adds only the columns and rows needed for wide, tall, and wide-and-tall footprints', () => {
    const wide = Array.from({ length: 13 }, (_, q) => ({ q, r: -Math.floor(q / 2) }));
    const tall = Array.from({ length: 12 }, (_, r) => ({ q: 0, r }));
    const both = [...wide.slice(0, 11), ...tall.slice(1, 9)];
    for (const [hexes, columns, rows] of [[wide, 13, 7], [tall, 9, 12], [both, 11, 9]] as const) {
      const grid = buildingSheetGrid(hexes);
      expect([grid.columns, grid.rows]).toEqual([columns, rows]);
      const xs = grid.hexes.map(hex => hex.column), ys = grid.hexes.map(hex => hex.row);
      expect(Math.min(...xs)).toBe(0);
      expect(Math.max(...xs)).toBeLessThan(columns);
      expect(Math.min(...ys)).toBe(0);
      expect(Math.max(...ys)).toBeLessThan(rows);
      expect(grid.label(hexes[0])).toBe('0101');
    }
  });
});
