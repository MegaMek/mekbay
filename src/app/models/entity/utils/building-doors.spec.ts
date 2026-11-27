// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BuildingDoor } from '../types/building';
import { buildingDoorsTouch, buildingDoorGroups, buildingLinkedDoorGeometry, linkBuildingDoors,
  normalizeBuildingDoorLinks, unlinkBuildingDoor } from './building-doors';

describe('linked building doors', () => {
  const door = (r: number, facing: number, floor = 0, height = 1): BuildingDoor => ({ position: { hex: { q: 0, r }, floor }, facing, height });

  it('allocates distinct groups within native integer limits without changing existing identities', () => {
    const doors = [2147483647, 2147483647, 1, 0].flatMap((linkGroup, index) =>
      [0, 1].map(facing => ({ ...door(3 * index, facing), linkGroup })));
    const linked = linkBuildingDoors(doors, doors[6], doors[7]);
    expect(buildingDoorGroups(linked).map(group => group.length)).toEqual([2, 2, 2, 2]);
    expect(new Set(linked.map(door => door.linkGroup)).size).toBe(4);
    expect(linked.every(door => door.linkGroup! > 0 && door.linkGroup! <= 2147483647)).toBeTrue();
    expect(linked[0].linkGroup).toBe(2147483647);
    expect(linked[4].linkGroup).toBe(1);
  });

  it('ends section lines at visible arrows while keeping the complete opening direction', () => {
    const doors = [door(0, 1), door(0, 2), door(1, 1)].map(door => ({ ...door, linkGroup: 1 }));
    const full = buildingLinkedDoorGeometry(doors);
    const top = buildingLinkedDoorGeometry(doors, door => door.position.hex.r === 0);
    expect(top.size).toBe(2);
    expect(top.get(doors[1])!.arrow).toEqual(full.get(doors[1])!.arrow);
    expect(top.get(doors[1])!.line.length).toBe(2);
    const bottom = buildingLinkedDoorGeometry(doors, door => door.position.hex.r === 1);
    expect(bottom.get(doors[2])!.arrow).toEqual(full.get(doors[2])!.arrow);
    expect(bottom.get(doors[2])!.line.length).toBe(1);
  });

  it('links touching sides in one hex or neighboring hexes, with matching levels and heights', () => {
    const a = door(0, 1), b = door(0, 2), c = door(1, 1);
    expect(buildingDoorsTouch(a, b)).toBeTrue();
    expect(buildingDoorsTouch(b, c)).toBeTrue();
    for (const other of [door(0, 4), door(0, 2, 1), door(0, 2, 0, 2), door(3, 1)]) expect(buildingDoorsTouch(a, other)).toBeFalse();
    let linked = linkBuildingDoors([a, b, c], a, b);
    linked = linkBuildingDoors(linked, linked[1], linked[2]);
    expect(buildingDoorGroups(linked).map(group => group.length)).toEqual([3]);
    const geometry = buildingLinkedDoorGeometry(linked);
    expect(geometry.size).toBe(3);
    for (const opening of geometry.values()) {
      expect(opening.line.every(point => Math.abs(point[0] - .75) < .0001)).toBeTrue();
      expect(opening.arrow[0][0]).toBeCloseTo(1.01);
    }
    const lineY = linked.flatMap(door => geometry.get(door)!.line.map(point => point[1] + Math.sqrt(3) * door.position.hex.r));
    expect(Math.min(...lineY)).toBeCloseTo(-Math.sqrt(3) / 4, 8);
    expect(Math.max(...lineY)).toBeCloseTo(3 * Math.sqrt(3) / 4, 8);
    expect(buildingDoorGroups(unlinkBuildingDoor(linked, linked[1]))).toEqual([]);
  });

  it('splits an opening after deleting a middle segment and removes singleton identities', () => {
    let doors: readonly BuildingDoor[] = [door(0, 1), door(0, 2), door(1, 1), door(1, 2), door(2, 1)];
    for (let i = 0; i < doors.length - 1; i++) doors = linkBuildingDoors(doors, doors[i], doors[i + 1]);
    doors = normalizeBuildingDoorLinks(doors.filter((_, index) => index !== 2));
    expect(buildingDoorGroups(doors).map(group => group.length)).toEqual([2, 2]);
    expect(doors[0].linkGroup).not.toBe(doors[2].linkGroup);
  });
});
