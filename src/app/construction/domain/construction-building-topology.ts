// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { StaticEmplacementEntity } from '../../models/entity/entities/misc/static-emplacement-entity';
import { buildingHexKey, buildingLocationName, buildingNeighbors, parseBuildingLocation, type BuildingHex, type BuildingLocation } from '../../models/entity/types/building';
import { locationArmor } from '../../models/entity/types';
import { normalizeBuildingDoorLinks } from '../../models/entity/utils/building-doors';

/** Only doors invalidated by this edit; pre-existing invalid placements remain available for repair. */
export function buildingTopologyDoorChanges(entity: StaticEmplacementEntity, hexes: readonly BuildingHex[]) {
  const before = new Set(entity.coordinates().map(buildingHexKey)), after = new Set(hexes.map(buildingHexKey));
  const obstructed = (door: { position: BuildingLocation; facing: number }) => {
    const neighbor = buildingNeighbors(door.position.hex)[door.facing];
    return neighbor && after.has(buildingHexKey(door.position.hex))
      && !before.has(buildingHexKey(neighbor)) && after.has(buildingHexKey(neighbor));
  };
  const doors = entity.doors().filter(obstructed), bayDoors = entity.bayDoors().filter(obstructed);
  let elevatorDoors = 0;
  const elevators = new Map(entity.elevators().flatMap(lift => {
    if (!after.has(buildingHexKey(lift.hex))) return [];
    const removedSides = buildingNeighbors(lift.hex).reduce((mask, hex, side) =>
      mask | (before.has(buildingHexKey(hex)) && !after.has(buildingHexKey(hex)) ? 1 << side : 0), 0);
    const exits = new Map([...lift.exits].map(([floor, mask]) => {
      elevatorDoors += [0, 1, 2, 3, 4, 5].filter(side => mask & removedSides & (1 << side)).length;
      return [floor, mask & ~removedSides];
    }));
    return removedSides ? [[lift, { ...lift, exits }] as const] : [];
  }));
  return { count: doors.length + bayDoors.length + elevatorDoors,
    description: `${doors.length + bayDoors.length} exterior door(s) would face an occupied hex; ${elevatorDoors} elevator access door(s) would face a removed hex.`,
    remove: () => {
      entity.doors.update(values => values.filter(door => !doors.includes(door)));
      entity.bayDoors.update(values => values.filter(door => !bayDoors.includes(door)));
      entity.elevators.update(values => values.map(lift => elevators.get(lift) ?? lift));
    } };
}

/** Update native geometry as one undoable change, keeping mounts attached to their hex/floor. */
export function setConstructionBuildingTopology(
  entity: StaticEmplacementEntity,
  hexes: readonly BuildingHex[],
  height = entity.height() ?? 1,
  movedHexes: ReadonlyMap<string, BuildingHex> = new Map(),
  facingTransform?: (facing: number) => number,
  hexHeights?: ReadonlyMap<string, number>,
): void {
  if (!Number.isSafeInteger(height) || height < 1) throw new Error('A building needs at least one floor.');
  if (hexes.some(hex => !Number.isSafeInteger(hex.q) || !Number.isSafeInteger(hex.r))) throw new Error('Hex coordinates must be whole numbers.');
  const keys = new Set(hexes.map(buildingHexKey));
  if (keys.size !== hexes.length) throw new Error('Two hexes cannot occupy the same position.');
  if (!hexes.length) throw new Error('A building needs at least one hex.');
  // Removing the origin rebases the survivors; equipment follows the original hex, not its array index.
  const origin = keys.has('0,0') ? { q: 0, r: 0 } : hexes[0];
  const rebase = (hex: BuildingHex) => ({ q: hex.q - origin.q || 0, r: hex.r - origin.r || 0 });
  const heights = new Map<string, number>(hexes.map(hex => [buildingHexKey(hex), height]));
  if (entity.isMobile()) {
    if (height === entity.height() || hexHeights) for (const oldHex of entity.coordinates()) {
      const target = movedHexes.get(buildingHexKey(oldHex)) ?? oldHex;
      if (keys.has(buildingHexKey(target))) heights.set(buildingHexKey(target), entity.hexHeight(oldHex));
    }
    for (const [key, value] of hexHeights ?? []) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('Each hex needs at least one floor.');
      if (keys.has(key)) heights.set(key, value);
    }
    height = Math.max(...heights.values());
  }
  const targetHeight = (hex: BuildingHex) => heights.get(buildingHexKey(hex)) ?? height;
  const armor = entity.armorValues().values().next().value?.front ?? 0;
  for (const [field, sides] of [[entity.wallSides, true], [entity.bridgeDecks, false], [entity.fuelLocations, false]] as const) {
    const values = new Map<string, number>();
    for (const oldHex of entity.coordinates()) {
      const sourceKey = buildingHexKey(oldHex);
      const target = movedHexes.get(sourceKey) ?? oldHex;
      if (!keys.has(buildingHexKey(target))) continue;
      let value = field().get(sourceKey);
      if (value === undefined && sides && entity.usesHexsides()) value = 1;
      if (value === undefined) continue;
      if (sides && facingTransform) value = [0, 1, 2, 3, 4, 5].reduce((mask, side) =>
        mask | ((value! & (1 << side)) ? 1 << facingTransform(side) : 0), 0);
      values.set(buildingHexKey(rebase(target)), value);
    }
    field.set(values);
  }
  const mounts = entity.equipment().flatMap(mount => {
    if (mount.allocation.kind !== 'location') return [mount];
    const old = parseBuildingLocation(mount.location);
    const hex = old && (movedHexes.get(buildingHexKey(old.hex)) ?? old.hex);
    if (!hex || !keys.has(buildingHexKey(hex)) || old!.floor >= targetHeight(hex)) {
      return [];
    }
    return mount.clone({ allocation: { kind: 'location', location: buildingLocationName(rebase(hex), old!.floor) },
      ...(facingTransform && mount.facing !== undefined ? { facing: facingTransform(mount.facing) } : {}) });
  });
  const position = (old: BuildingLocation, roof = false) => {
    const target = movedHexes.get(buildingHexKey(old.hex)) ?? old.hex;
    const floor = roof && old.floor === entity.hexHeight(old.hex) ? targetHeight(target) : old.floor;
    return keys.has(buildingHexKey(target)) && floor >= 0 && floor < targetHeight(target) + (roof ? 1 : 0)
      ? { hex: rebase(target), floor } : undefined;
  };
  const facing = facingTransform ?? (value => value);
  for (const field of [entity.portalHex2, entity.portalHex3]) {
    const hex = field();
    field.set(hex ? position({ hex, floor: 0 })?.hex ?? null : null);
  }
  entity.doors.set(normalizeBuildingDoorLinks(entity.doors().flatMap(door => {
    const target = position(door.position);
    const hex = movedHexes.get(buildingHexKey(door.position.hex)) ?? door.position.hex;
    return target ? [{ ...door, position: target, height: Math.min(door.height, targetHeight(hex) - target.floor), facing: facing(door.facing) }] : [];
  })));
  entity.bayDoors.set(entity.bayDoors().flatMap(door => {
    const target = position(door.position);
    return target ? [{ ...door, position: target, facing: facing(door.facing) }] : [];
  }));
  entity.elevators.set(entity.elevators().flatMap(lift => {
    const target = position({ hex: lift.hex, floor: 0 });
    if (!target) return [];
    const exits = new Map<number, number>();
    for (const [floor, mask] of lift.exits) {
      const stop = position({ hex: lift.hex, floor }, true);
      if (stop) exits.set(stop.floor, [0, 1, 2, 3, 4, 5].reduce((value, side) => value | ((mask & (1 << side)) ? 1 << facing(side) : 0), 0));
    }
    return exits.size >= 2 ? [{ ...lift, hex: target.hex, exits }] : [];
  }));
  const mountIds = new Set<string>(mounts.map(mount => mount.mountId));
  entity.equipmentDesign.set(new Map([...entity.equipmentDesign()].filter(([id]) => mountIds.has(id)).map(([id, design]) =>
    [id, { ...design, positions: design.positions.flatMap(old => { const target = position(old); return target ? [target] : []; }) }])));
  entity.baySpace.set(new Map([...entity.baySpace()].map(([id, spaces]) => [id, spaces.flatMap(space => {
    const target = position(space.position);
    return target ? [{ ...space, position: target }] : [];
  })])));
  entity.coordinates.set(hexes.map(rebase));
  entity.height.set(height);
  if (entity.isMobile()) entity.hexHeights.set(new Map(hexes.map(hex => [buildingHexKey(rebase(hex)), targetHeight(hex)])));
  entity.armorValues.set(new Map(entity.locationOrder.map(location => [location, locationArmor(armor)])));
  entity.setEquipment(mounts);
}

/** A mobile footprint is solid from its lowest floor; its roof may vary by hex (TO:AUE p. 77). */
export function setConstructionBuildingHexHeight(entity: StaticEmplacementEntity, hex: BuildingHex, height: number): void {
  if (!entity.isMobile()) throw new Error('Only Mobile Structures have different heights in one building footprint.');
  setConstructionBuildingTopology(entity, entity.coordinates(), entity.height(), new Map(), undefined,
    new Map([[buildingHexKey(hex), height]]));
}

export function transformConstructionBuilding(
  entity: StaticEmplacementEntity,
  transform: (hex: BuildingHex) => BuildingHex,
  facingTransform?: (facing: number) => number,
): void {
  const movedHexes = new Map(entity.coordinates().map(hex => [buildingHexKey(hex), transform(hex)]));
  setConstructionBuildingTopology(entity, [...movedHexes.values()], entity.height() ?? 1, movedHexes, facingTransform);
}
