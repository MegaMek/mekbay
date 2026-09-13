// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { StaticEmplacementEntity } from '../../models/entity/entities/misc/static-emplacement-entity';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { WeaponEquipment } from '../../models/equipment.model';
import { buildingLocationName, buildingConnectedComponents } from '../../models/entity/types/building';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import { createConstructionEntity } from './construction-factory';
import { getConstructionFields } from './construction-fields';
import { setConstructionArmor, uninstallConstructionEquipment } from './construction-rules';
import { buildingTopologyDoorChanges, setConstructionBuildingTopology, transformConstructionBuilding } from './construction-building-topology';
import { buildingDoorGroups, linkBuildingDoors } from '../../models/entity/utils/building-doors';

describe('building construction topology', () => {
  const gun = new WeaponEquipment({ id: 'TopologyLaser', name: 'Topology laser', type: 'weapon', flags: ['F_TANK_WEAPON', 'F_ENERGY'],
    stats: { tonnage: 1, criticalSlots: 1 }, weapon: { damage: 5, ranges: [3, 6, 9, 12] } });
  const registry = createTestEquipmentRegistry({ [gun.id]: gun });
  const origin = { q: 0, r: 0 }, east = { q: 1, r: 0 }, northEast = { q: 1, r: -1 };
  const create = () => createConstructionEntity('BuildingEntity', registry) as StaticEmplacementEntity;

  it('removes newly obstructed exterior doors or preserves them when cleanup is declined', () => {
    for (const remove of [true, false]) {
      const entity = create();
      const north = { q: 0, r: -1 };
      setConstructionBuildingTopology(entity, [origin, north], 2);
      entity.doors.set([
        { position: { hex: origin, floor: 0 }, facing: 1, height: 2 },
        { position: { hex: north, floor: 0 }, facing: 2, height: 1 },
        { position: { hex: origin, floor: 0 }, facing: 3, height: 1 },
      ]);
      const next = [origin, north, northEast], changes = buildingTopologyDoorChanges(entity, next);
      expect(changes.count).toBe(2);
      expect(entity.doors().length).toBe(3);
      if (remove) changes.remove();
      setConstructionBuildingTopology(entity, next);
      expect(entity.doors().map(door => door.facing)).toEqual(remove ? [3] : [1, 2, 3]);
    }
  });

  it('removes all affected elevator access sides while retaining shafts, stops, and other access', () => {
    const entity = create();
    setConstructionBuildingTopology(entity, [origin, east, northEast], 2);
    entity.elevators.set([{ hex: origin, capacity: 20, exits: new Map([[0, 6], [1, 6], [2, 4]]) }]);
    const changes = buildingTopologyDoorChanges(entity, [origin, northEast]);
    expect(changes.count).toBe(3);
    changes.remove();
    setConstructionBuildingTopology(entity, [origin, northEast]);
    expect(entity.elevators()[0]).toEqual({ hex: origin, capacity: 20, exits: new Map([[0, 2], [1, 2], [2, 0]]) });
  });

  it('retains linked doors through native saves, rotation and mirroring', () => {
    const entity = create();
    setConstructionBuildingTopology(entity, [origin, { q: 0, r: 1 }], 2);
    const doors = [1, 2].map(facing => ({ position: { hex: origin, floor: 0 }, facing, height: 2 }));
    entity.doors.set(linkBuildingDoors(doors, doors[0], doors[1]));
    const loaded = parseEntity(encodeNativeEntity(entity), 'linked.blk', registry).entity as StaticEmplacementEntity;
    expect(loaded.doors()).toEqual(entity.doors());
    transformConstructionBuilding(loaded, hex => ({ q: -hex.r, r: hex.q + hex.r }), side => (side + 1) % 6);
    expect(buildingDoorGroups(loaded.doors()).map(group => group.length)).toEqual([2]);
    transformConstructionBuilding(loaded, hex => ({ q: -hex.q, r: hex.q + hex.r }), side => (6 - side) % 6);
    expect(buildingDoorGroups(loaded.doors()).map(group => group.length)).toEqual([2]);
  });

  it('derives all floors including empty equipment locations and round trips native cube coordinates', () => {
    const entity = create();
    setConstructionBuildingTopology(entity, [origin, east, northEast], 3);
    setConstructionArmor(entity, buildingLocationName(east, 1), 40);
    addTestEquipment(entity, gun, { location: buildingLocationName(east, 2), facing: 1 });
    const native = encodeNativeEntity(entity);
    expect(native).toContain('<coords>\n0.0,0.0,0.0\n1.0,0.0,-1.0\n1.0,-1.0,0.0\n</coords>');
    expect(native).toContain('<Level 2 1.0,0.0,-1.0 Equipment>');
    const loaded = parseEntity(native, 'topology.blk', registry).entity as StaticEmplacementEntity;
    expect(loaded.coordinates()).toEqual([origin, east, northEast]);
    expect(loaded.locationOrder.length).toBe(9);
    expect(loaded.equipment()[0].location).toBe(buildingLocationName(east, 2));
    expect(loaded.locationOrder.every(location => loaded.getArmorValue(location) === 40)).toBeTrue();
    expect(loaded.height()).toBe(3);
  });

  it('encodes every building facing using MegaMek clockwise direction markers', () => {
    const markers = ['(F)', '(FR)', '(RR)', '(R)', '(RL)', '(FL)'];
    for (let facing = 0; facing < 6; facing++) {
      const entity = create();
      const turretType = facing === 0 ? 'sponson' : facing === 1 ? 'pintle' : undefined;
      addTestEquipment(entity, gun, { location: buildingLocationName(origin, 0), facing, turretType });
      const native = encodeNativeEntity(entity);
      expect(native).withContext(String(facing)).toContain('TopologyLaser ' + markers[facing]);
      const loaded = parseEntity(native, 'facing.blk', registry).entity;
      expect(loaded.equipment()[0].facing).withContext(markers[facing]).toBe(facing);
      expect(loaded.equipment()[0].turretType).withContext(markers[facing]).toBe(turretType);
    }
  });

  it('moves and rotates mounted equipment with its hex, retaining mount identity and floor', () => {
    const entity = create();
    setConstructionBuildingTopology(entity, [origin, east], 2);
    const mount = addTestEquipment(entity, gun, { location: buildingLocationName(east, 1), facing: 5 });
    transformConstructionBuilding(entity, hex => ({ q: -hex.r, r: hex.q + hex.r }), facing => (facing + 1) % 6);
    expect(entity.coordinates()).toEqual([origin, { q: 0, r: 1 }]);
    expect(entity.equipment()[0].mountId).toBe(mount.mountId);
    expect(entity.equipment()[0].location).toBe(buildingLocationName({ q: 0, r: 1 }, 1));
    expect(entity.equipment()[0].facing).toBe(0);
  });

  it('deletes equipment on removed hexes and floors while keeping surviving mounts', () => {
    const entity = create();
    setConstructionBuildingTopology(entity, [origin, east], 3);
    const ground = addTestEquipment(entity, gun, { location: buildingLocationName(origin, 0) });
    const upper = addTestEquipment(entity, gun, { location: buildingLocationName(origin, 2) });
    const otherHex = addTestEquipment(entity, gun, { location: buildingLocationName(east, 0) });
    setConstructionBuildingTopology(entity, [origin], 2);
    expect(entity.equipment().length).toBe(1);
    expect(entity.equipment().find(mount => mount.mountId === ground.mountId)!.allocation.kind).toBe('location');
    for (const id of [upper.mountId, otherHex.mountId]) expect(entity.equipment().find(mount => mount.mountId === id)).toBeUndefined();
  });

  it('uses the same topology update when the chassis height changes', () => {
    const entity = create();
    setConstructionBuildingTopology(entity, [origin], 2);
    addTestEquipment(entity, gun, { location: buildingLocationName(origin, 1) });
    getConstructionFields(entity).find(field => field.id === 'height')!.set(1);
    expect(entity.equipment()).toEqual([]);
    expect(entity.locationOrder).toEqual([buildingLocationName(origin, 0)]);
  });

  it('discards unallocated equipment when geometry is rebuilt', () => {
    const entity = create();
    setConstructionBuildingTopology(entity, [origin, east], 2);
    const mount = addTestEquipment(entity, gun, { location: buildingLocationName(east, 1), facing: 4, turretType: 'sponson' });
    uninstallConstructionEquipment(entity, mount);
    setConstructionBuildingTopology(entity, [origin], 1);
    transformConstructionBuilding(entity, hex => ({ q: -hex.r, r: hex.q + hex.r }), facing => (facing + 1) % 6);
    expect(entity.equipment()).toEqual([]);
    expect(encodeNativeEntity(entity)).not.toContain(gun.id);
    expect(parseEntity(encodeNativeEntity(entity), 'unallocated.blk', registry).entity.equipment()).toEqual([]);
  });

  it('rejects conflicting coordinates atomically and identifies disconnected sections', () => {
    const entity = create();
    expect(() => setConstructionBuildingTopology(entity, [origin, origin])).toThrowError(/same position/);
    expect(() => setConstructionBuildingTopology(entity, [])).toThrowError(/one hex/);
    expect(() => setConstructionBuildingTopology(entity, [origin], 0)).toThrowError(/floor/);
    expect(entity.coordinates()).toEqual([origin]);
    expect(buildingConnectedComponents([origin, east, { q: 4, r: 4 }]).length).toBe(2);
  });

  it('rebases after removing the origin and keeps each surviving mount on its original floor', () => {
    const entity = create();
    setConstructionBuildingTopology(entity, [origin, east, northEast], 3);
    addTestEquipment(entity, gun, { location: buildingLocationName(origin, 0) });
    const first = addTestEquipment(entity, gun, { location: buildingLocationName(east, 2), facing: 4 });
    const second = addTestEquipment(entity, gun, { location: buildingLocationName(northEast, 1) });
    setConstructionBuildingTopology(entity, [east, northEast], 3);
    expect(entity.coordinates()).toEqual([origin, { q: 0, r: -1 }]);
    expect(entity.equipment().map(mount => [mount.mountId, mount.location])).toEqual([
      [first.mountId, buildingLocationName(origin, 2)], [second.mountId, buildingLocationName({ q: 0, r: -1 }, 1)],
    ]);
    expect(entity.equipment()[0].facing).toBe(4);
    const loaded = parseEntity(encodeNativeEntity(entity), 'rebased.blk', registry).entity;
    expect(loaded.equipment().map(mount => mount.location)).toEqual(entity.equipment().map(mount => mount.location));
  });
});
