// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { StaticEmplacementEntity } from '../../models/entity/entities/misc/static-emplacement-entity';
import { BUILDING_CLASSES, BUILDING_DIRECTIONS, buildingLimits, buildingLocationName, buildingBridgeSpan, buildingBridgeLevels } from '../../models/entity/types/building';
import { getConstructionFields } from './construction-fields';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { calculateBuildingWeightBreakdown } from '../../models/entity/utils/weight/building-weight';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import { createConstructionEntity, getConstructionMass, getConstructionMassCapacity } from './construction-factory';
import {
  constructionEquipmentApplies,
  constructionSupportsAmmoQuantity,
  setConstructionArmor,
  validateConstruction,
} from './construction-rules';
import { setConstructionBuildingTopology, transformConstructionBuilding } from './construction-building-topology';

describe('static building construction rules', () => {
  const origin = { q: 0, r: 0 },
    east = { q: 1, r: 0 };
  const laser = new WeaponEquipment({
    id: 'BuildingLaser',
    name: 'Building laser',
    type: 'weapon',
    flags: ['F_TANK_WEAPON', 'F_ENERGY'],
    stats: { tonnage: 1.1, cost: 10000 },
    weapon: { heat: 3 },
  });
  const ammo = new AmmoEquipment({
    id: 'BuildingAmmo',
    name: 'Building ammo',
    type: 'ammo',
    stats: { tonnage: 1, cost: 1000 },
    ammo: { type: 'AC', shots: 20 },
  });
  const fusion = new MiscEquipment({
    id: 'FUSION PowerGenerator',
    name: 'Fusion generator',
    type: 'misc',
    flags: ['F_POWER_GENERATOR'],
    stats: { tonnage: 'variable', cost: 'variable' },
  });
  const sink = new MiscEquipment({
    id: 'BuildingDHS',
    name: 'Double heat sink',
    type: 'misc',
    flags: ['F_DOUBLE_HEAT_SINK'],
    stats: { tonnage: 1, cost: 6000 },
  });
  const cargo = new MiscEquipment({
    id: 'BuildingCargo',
    name: 'Cargo',
    type: 'misc',
    flags: ['F_CARGO', 'F_SUPPORT_TANK_EQUIPMENT'],
    stats: { tonnage: 'variable', cost: 0 },
  });
  const registry = createTestEquipmentRegistry(
    Object.fromEntries([laser, ammo, fusion, sink, cargo].map((eq) => [eq.id, eq])),
  );
  const create = () => createConstructionEntity('BuildingEntity', registry) as StaticEmplacementEntity;
  const codes = (entity: StaticEmplacementEntity) =>
    validateConstruction(entity).messages.map((message) => message.code);

  it('authors roof facilities with native mass, cost, crew and occupied roof checks', () => {
    const entity = create(), west = { q: -1, r: 0 };
    entity.buildingClass.set(4); entity.buildingType.set(4); entity.constructionFactor.set(150);
    setConstructionBuildingTopology(entity, [origin, east, west], 2);
    const facility = (id: string) => new MiscEquipment({ id, name: id, type: 'misc', stats: { tonnage: 'variable', cost: 'variable' } });
    const flight = facility('Building Flight Deck');
    expect(constructionEquipmentApplies(entity, flight)).toBeTrue();
    const deck = addTestEquipment(entity, flight, { location: buildingLocationName(origin, 1) });
    entity.equipmentDesign.set(new Map([[deck.mountId, { automated: false, pcmtSource: 0,
      positions: [origin, east, west].map(hex => ({ hex, floor: 1 })) }]]));
    expect(deck.getTonnage(entity)).toBe(1500);
    expect(deck.getCost(entity)).toBe(1000000);
    expect(entity.hexLoads().map(load => load.miscellaneous)).toEqual([500, 500, 500]);
    expect(entity.buildingCrew().crew).toBe(20);
    expect(codes(entity)).not.toContain('BUILDING_FLIGHT_DECK');
    entity.equipmentDesign.set(new Map([[deck.mountId, { automated: false, pcmtSource: 0,
      positions: [{ hex: origin, floor: 0 }, { hex: east, floor: 1 }] }]]));
    expect(codes(entity)).toContain('BUILDING_FLIGHT_DECK');
    expect(codes(entity)).toContain('BUILDING_ROOF_LEVEL');
    const pad = addTestEquipment(entity, facility('Building Helipad'), { location: buildingLocationName(origin, 1) });
    expect(pad.getTonnage(entity)).toBe(500);
    expect(pad.getCost(entity)).toBe(200000);
    expect(codes(entity)).toContain('BUILDING_ROOF_SPACE');
    entity.buildingOptions.update(options => ({ ...options, site: 'UNDERGROUND' }));
    expect(codes(entity)).toContain('BUILDING_RESERVED_ROOF');

    const landingBuilding = create();
    const hexes = [origin, ...BUILDING_DIRECTIONS];
    setConstructionBuildingTopology(landingBuilding, hexes, 1);
    const landing = addTestEquipment(landingBuilding, facility('Building Landing Deck'), { location: buildingLocationName(origin, 0), size: 7 });
    landingBuilding.equipmentDesign.set(new Map([[landing.mountId, { automated: false, pcmtSource: 0,
      positions: hexes.map(hex => ({ hex, floor: 0 })) }]]));
    expect(landing.getTonnage(landingBuilding)).toBe(3500);
    expect(landing.getCost(landingBuilding)).toBe(3500000);
    expect(landingBuilding.buildingCrew().crew).toBe(21);
    expect(codes(landingBuilding)).not.toContain('BUILDING_LANDING_DECK');
    landingBuilding.updateEquipment(mounts => mounts.map(mount => mount === landing ? mount.clone({ size: 19 }) : mount));
    expect(codes(landingBuilding)).toContain('BUILDING_LANDING_DECK');
  });

  it('round-trips doors, lifts, automation and mass allocation using native location/ordinal references', () => {
    const entity = create(), far = { q: 2, r: 0 };
    entity.buildingClass.set(2);
    setConstructionBuildingTopology(entity, [origin, east, far], 3);
    entity.doors.set([{ position: { hex: origin, floor: 0 }, facing: 0, height: 2 }]);
    entity.elevators.set([{ hex: origin, capacity: 20, exits: new Map([[0, 4], [1, 4], [2, 4], [3, 4]]) }]);
    const gun = addTestEquipment(entity, laser, { location: buildingLocationName(far, 2), turretType: 'sponson' });
    const generator = addTestEquipment(entity, fusion, { location: buildingLocationName(east, 0), size: 20 });
    addTestEquipment(entity, laser, { location: buildingLocationName(far, 2) });
    entity.equipmentDesign.set(new Map([
      [gun.mountId, { automated: true, positions: [], pcmtSource: 0 }],
      [generator.mountId, { automated: false, positions: [{ hex: east, floor: 0 }, { hex: far, floor: 0 }], pcmtSource: 0 }],
    ]));
    entity.transporters.set([{ id: 'bay', kind: 'bay', configuration: { type: 'cargo' }, capacity: 10, doors: 1, bayNumber: 0, omni: false }]);
    entity.baySpace.set(new Map([['bay', [{ position: { hex: east, floor: 1 }, tons: 10 }]]]));
    expect(entity.hexLoads().map(load => load.elevators)).toEqual([3, 0, 0]);
    expect(entity.hexLoads().map(load => load.carryingSpace)).toEqual([0, 10, 0]);
    expect(entity.equipmentWeightInHex(generator, east)).toBe(10);
    expect(entity.powerSupply().provided).toBe(20);
    const native = encodeNativeEntity(entity);
    const loaded = parseEntity(native, 'services.blk', registry).entity as StaticEmplacementEntity;
    expect(loaded.doors()).toEqual(entity.doors());
    expect(loaded.elevators()).toEqual(entity.elevators());
    expect(loaded.equipment().filter(mount => loaded.equipmentDesign().get(mount.mountId)?.automated).length).toBe(1);
    expect(loaded.cost()).toBe(entity.cost());
    expect(calculateBuildingWeightBreakdown(loaded)).toEqual(calculateBuildingWeightBreakdown(entity));
    transformConstructionBuilding(loaded, hex => ({ q: -hex.r, r: hex.q + hex.r }), side => (side + 1) % 6);
    expect(loaded.doors()[0].facing).toBe(1);
    expect(loaded.elevators()[0].exits.get(0)).toBe(8);
    expect(loaded.equipmentDesign().size).toBe(2);
    expect(loaded.cost()).toBe(entity.cost());
  });

  it('checks elevator clearance, exterior doors and exact bay space before printing', () => {
    const entity = create();
    setConstructionBuildingTopology(entity, [origin, east], 3);
    entity.elevators.set([{ hex: origin, capacity: 41, exits: new Map([[0, 1], [2, 1]]) }]);
    entity.doors.set([{ position: { hex: origin, floor: 2 }, facing: 2, height: 2 }]);
    addTestEquipment(entity, cargo, { location: buildingLocationName(origin, 1), size: 1 });
    entity.transporters.set([{ id: 'bay', kind: 'bay', configuration: { type: 'cargo' }, capacity: 10, doors: 1, bayNumber: 0, omni: false }]);
    entity.baySpace.set(new Map([['bay', [{ position: { hex: east, floor: 0 }, tons: 9 }]]]));
    expect(codes(entity)).toEqual(jasmine.arrayContaining(['BUILDING_DOOR', 'BUILDING_ELEVATOR', 'BUILDING_ELEVATOR_ACCESS', 'BUILDING_ELEVATOR_OCCUPIED', 'BUILDING_BAY_SPACE']));
  });

  it('offers all nine classifications without changing existing native class numbers', () => {
    const entity = create();
    const field = getConstructionFields(entity).find(field => field.id === 'buildingClass')!;
    expect(field.options?.map(option => option.label)).toEqual(Object.values(BUILDING_CLASSES));
    expect(BUILDING_CLASSES[3]).toBe('Gun Emplacement');
    field.set(4);
    expect(entity.buildingType()).toBe(3);
    expect(entity.limits()).toEqual({ minimumCF: 35, maximumCF: 90, hexes: 35, levels: 10 });
    expect(buildingLimits(4, 4)).toEqual({ minimumCF: 91, maximumCF: 150, hexes: 70, levels: 15 });
    expect(buildingLimits(6, 8)).toEqual({ minimumCF: 151, maximumCF: 650, hexes: Infinity, levels: 1 });
    expect(buildingLimits(6, 0)).toBeNull();
    field.set(5);
    expect(entity.buildingType()).toBe(1);
    expect(entity.constructionFactor()).toBe(2);
  });

  it('reproduces the p. 140 Castles Brian command tower and round-trips its capital values', () => {
    const entity = create();
    entity.buildingClass.set(4); entity.buildingType.set(3); entity.constructionFactor.set(50);
    setConstructionBuildingTopology(entity, [origin], 4);
    setConstructionArmor(entity, buildingLocationName(origin, 0), 50);
    expect(entity.tonnage()).toBe(2000);
    expect(calculateBuildingWeightBreakdown(entity).armor).toBe(32);
    expect(entity.maxArmorValues().get(buildingLocationName(origin, 0))).toBe(100);
    expect(entity.hasEnvironmentalSealing()).toBeTrue();
    expect(entity.cost()).toBe((1000000 * 50 * 4 * 1.5 + 32 * 10000) * 6);
    const loaded = parseEntity(encodeNativeEntity(entity), 'tower.blk', registry).entity as StaticEmplacementEntity;
    expect(loaded.buildingClass()).toBe(4);
    expect(loaded.getArmorValue(buildingLocationName(origin, 0))).toBe(50);
    expect(loaded.cost()).toBe(entity.cost());
    expect(loaded.buildingOptions().sealing).toBeFalse();
  });

  it('limits open-space equipment to one total budget and ground level', () => {
    const entity = create();
    entity.buildingClass.set(4); entity.buildingType.set(4); entity.constructionFactor.set(150);
    setConstructionBuildingTopology(entity, [origin, east], 2);
    entity.buildingOptions.update(options => ({ ...options, openSpace: true, site: 'UNDERGROUND' }));
    expect(entity.tonnage()).toBe(600);
    addTestEquipment(entity, cargo, { location: buildingLocationName(origin, 1), size: 550 });
    expect(codes(entity)).toContain('BUILDING_OPEN_SPACE_EQUIPMENT');
    const loaded = parseEntity(encodeNativeEntity(entity), 'cave.blk', registry).entity as StaticEmplacementEntity;
    expect(loaded.buildingOptions().openSpace).toBeTrue();
    expect(loaded.buildingOptions().site).toBe('UNDERGROUND');
    expect(loaded.tonnage()).toBe(600);
    addTestEquipment(loaded, cargo, { location: buildingLocationName(east, 0), size: 51 });
    expect(codes(loaded)).toContain('OVERWEIGHT');
    loaded.buildingOptions.update(options => ({ ...options, heavyMetal: true }));
    expect(loaded.tonnage()).toBe(450);
  });

  it('counts capital controls and enforces capital and subcapital power, count and roof restrictions', () => {
    for (const subCapital of [false, true]) {
      const entity = create();
      entity.buildingClass.set(4); entity.buildingType.set(3); entity.constructionFactor.set(50);
      setConstructionBuildingTopology(entity, [origin], 4);
      const capital = new WeaponEquipment({ id: 'Capital laser', name: 'Capital laser', type: 'weapon',
        flags: ['F_ENERGY'], stats: { tonnage: 100 }, weapon: { capital: !subCapital, subCapital } });
      const missile = new WeaponEquipment({ id: 'Capital missile', name: 'Capital missile', type: 'weapon',
        flags: ['F_MISSILE'], stats: { tonnage: 100 }, weapon: { capital: true } });
      addTestEquipment(entity, capital, { location: buildingLocationName(origin, 0) });
      expect(calculateBuildingWeightBreakdown(entity).capitalControls).toBe(10);
      expect(codes(entity)).toContain('BUILDING_CAPITAL_POWER');
      expect(codes(entity)).not.toContain('BUILDING_HEAVY_WEAPONS');
      addTestEquipment(entity, fusion, { location: buildingLocationName(origin, 0), size: 20 });
      addTestEquipment(entity, missile, { location: buildingLocationName(origin, 0) });
      addTestEquipment(entity, missile, { location: buildingLocationName(origin, 0) });
      expect(codes(entity)).not.toContain('BUILDING_CAPITAL_POWER');
      expect(codes(entity)).not.toContain('BUILDING_CAPITAL_COUNT');
      expect(calculateBuildingWeightBreakdown(entity).exact).toBe(330);
      addTestEquipment(entity, capital, { location: buildingLocationName(origin, 3), turretType: 'sponson' });
      expect(codes(entity)).toContain('BUILDING_CAPITAL_COUNT');
      expect(codes(entity)).toContain('BUILDING_CAPITAL_MOUNT');
      expect(codes(entity)).toContain('BUILDING_CAPITAL_ROOF');
      entity.buildingClass.set(0);
      expect(codes(entity)).toContain('BUILDING_CAPITAL_WEAPON');
    }
  });

  it('counts wall capacity, armor and cost per occupied side, not per whole hex', () => {
    const entity = create();
    entity.buildingClass.set(6);
    setConstructionBuildingTopology(entity, [origin], 4);
    entity.wallSides.set(new Map([['0,0', 3]]));
    setConstructionArmor(entity, buildingLocationName(origin, 0), 32);
    expect(entity.tonnage()).toBe(320);
    expect(calculateBuildingWeightBreakdown(entity).armor).toBe(4);
    expect(entity.cost()).toBe((5000 * 40 * 4 * 2 + 40000) * 1.4);
    const native = encodeNativeEntity(entity);
    expect(native).toContain('0,0,0;3');
    const loaded = parseEntity(native, 'wall.blk', registry).entity as StaticEmplacementEntity;
    expect(loaded.sideMask(origin)).toBe(3);
    expect(loaded.tonnage()).toBe(320);
  });

  it('gives tents, fences and bridges no interior, and matches the p. 115 bridge slope', () => {
    const entity = create();
    entity.buildingClass.set(5); entity.buildingType.set(1); entity.constructionFactor.set(2);
    expect(entity.tonnage()).toBe(0);
    expect(entity.powerSupply().required).toBe(0);
    expect(entity.cost()).toBe(2040);
    entity.buildingClass.set(7); entity.constructionFactor.set(1);
    setConstructionBuildingTopology(entity, [origin], 3);
    entity.wallSides.set(new Map([['0,0', 3]]));
    expect(entity.cost()).toBe(4848);
    entity.buildingClass.set(8); entity.buildingType.set(6); entity.constructionFactor.set(650);
    const hexes = Array.from({ length: 9 }, (_, q) => ({ q, r: 0 }));
    setConstructionBuildingTopology(entity, hexes, 1);
    entity.bridgeDecks.set(buildingBridgeLevels(buildingBridgeSpan(hexes)!, 5, 7));
    expect(hexes.map(hex => entity.deckLevel(hex))).toEqual([5, 5, 6, 6, 6, 6, 7, 7, 7]);
    expect(entity.mapLevels()).toEqual([7, 6, 5]);
    const loaded = parseEntity(encodeNativeEntity(entity), 'bridge.blk', registry).entity as StaticEmplacementEntity;
    expect(loaded.bridgeDecks()).toEqual(entity.bridgeDecks());
    loaded.bridgeDecks.update(levels => new Map(levels).set('1,0', 6));
    expect(codes(loaded)).toContain('BUILDING_BRIDGE_LINEAR_SLOPE');
    addTestEquipment(loaded, sink, { location: buildingLocationName(origin, 0) });
    expect(codes(loaded)).toContain('BUILDING_NO_INTERIOR');
  });

  it('starts with a usable external-powered building and calculates its capacity and cost', () => {
    const entity = create();
    expect(getConstructionMass(entity)).toBe(0);
    expect(getConstructionMassCapacity(entity)).toBe(40);
    expect(entity.powerSupply().external).toBeTrue();
    expect(codes(entity)).not.toContain('BUILDING_POWER');
    expect(entity.cost()).toBe(560000);
  });

  it('uses the classification-specific CF, footprint and level limits', () => {
    expect(buildingLimits(2, 1)).toEqual({ minimumCF: 9, maximumCF: 16, hexes: 14, levels: 10 });
    expect(buildingLimits(4, 2)).toEqual({ minimumCF: 91, maximumCF: 150, hexes: 20, levels: 30 });
    expect(buildingLimits(3, 0)).toEqual({ minimumCF: 41, maximumCF: 90, hexes: 10, levels: 10 });
    expect(buildingLimits(1, 3)).toEqual({ minimumCF: 1, maximumCF: 15, hexes: 1, levels: 1 });
    expect(buildingLimits(4, 0)).toBeNull();
    expect(buildingLimits(1, 2)).toBeNull();
    expect(buildingLimits(5, 0)).toBeNull();
    const entity = create();
    entity.buildingClass.set(1);
    entity.constructionFactor.set(17);
    expect(codes(entity)).toContain('BUILDING_CF');
    entity.constructionFactor.set(16);
    setConstructionBuildingTopology(entity, [origin], 11);
    expect(codes(entity)).not.toContain('BUILDING_CF');
    expect(codes(entity)).toContain('BUILDING_SIZE');
  });

  it('counts whole-ton armor once per hex, changes its Clan conversion, and enforces class armor limits', () => {
    const entity = create();
    entity.buildingClass.set(2);
    setConstructionBuildingTopology(entity, [origin, east], 3);
    setConstructionArmor(entity, buildingLocationName(origin, 0), 17);
    expect(entity.maxArmorValues().get(buildingLocationName(origin, 0))).toBe(40);
    expect(calculateBuildingWeightBreakdown(entity).armor).toBe(4);
    expect(entity.cost()).toBe(6776000); // (6 × 40 × 20,000 + 4 × 10,000) × 1.4
    entity.techBase.set('Clan');
    expect(calculateBuildingWeightBreakdown(entity).armor).toBe(2);
    expect(entity.cost()).toBe(6762000);
    entity.buildingClass.set(0);
    expect(entity.validationResult().messages.some((message) => message.code === 'ARMOR_EXCEEDS_MAX')).toBeTrue();
  });

  it('caps hangar capacity per four-level group and catches a locally overloaded hex', () => {
    const entity = create();
    entity.buildingClass.set(1);
    entity.buildingType.set(4);
    entity.constructionFactor.set(75);
    setConstructionBuildingTopology(entity, [origin], 4);
    expect(entity.capacityPerHex()).toBe(600);
    setConstructionBuildingTopology(entity, [origin], 5);
    expect(entity.capacityPerHex()).toBe(1125);
    entity.buildingClass.set(0);
    entity.buildingType.set(2);
    entity.constructionFactor.set(40);
    setConstructionBuildingTopology(entity, [origin, east], 1);
    addTestEquipment(entity, cargo, { location: buildingLocationName(origin, 0), size: 41 });
    expect(getConstructionMass(entity)).toBe(41);
    expect(codes(entity)).toContain('BUILDING_HEX_CAPACITY');
    expect(codes(entity)).not.toContain('OVERWEIGHT');
  });

  it('derives amplifiers and roof mechanisms independently per hex and counts installed cooling', () => {
    const entity = create();
    entity.buildingClass.set(2);
    setConstructionBuildingTopology(entity, [origin, east], 2);
    for (const hex of [origin, east])
      addTestEquipment(entity, laser, { location: buildingLocationName(hex, 1), turretType: 'sponson' });
    const weights = calculateBuildingWeightBreakdown(entity);
    expect(weights.powerAmplifiers).toBe(0.4);
    expect(weights.turret).toBe(1);
    expect(weights.exact).toBeCloseTo(3.6);
    expect(codes(entity)).toContain('BUILDING_COOLING');
    for (let i = 0; i < 3; i++) addTestEquipment(entity, sink, { location: buildingLocationName(origin, 0) });
    expect(codes(entity)).not.toContain('BUILDING_COOLING');
    expect(calculateBuildingWeightBreakdown(entity).heatSinks).toBe(3);
    entity.updateEquipment((mounts) =>
      mounts.map((mount) =>
        mount.equipment === laser
          ? mount.clone({ allocation: { kind: 'location', location: buildingLocationName(origin, 0) } })
          : mount,
      ),
    );
    expect(codes(entity)).toContain('BUILDING_ROOF_TURRET');
  });

  it('uses sized generators and only dispenses with amplifiers/cooling for fusion or fission', () => {
    const entity = create();
    entity.buildingClass.set(2);
    addTestEquipment(entity, laser, { location: buildingLocationName(origin, 0) });
    const generator = addTestEquipment(entity, fusion, { location: buildingLocationName(origin, 0), size: 0.5 });
    expect(generator.getTonnage(entity)).toBe(0.5);
    expect(entity.powerSupply().external).toBeFalse();
    expect(codes(entity)).toContain('BUILDING_POWER');
    expect(codes(entity)).not.toContain('BUILDING_COOLING');
    entity.updateEquipment((mounts) => mounts.map((mount) => (mount === generator ? mount.clone({ size: 2 }) : mount)));
    expect(codes(entity)).not.toContain('BUILDING_POWER');
    expect(calculateBuildingWeightBreakdown(entity).powerAmplifiers).toBe(0);
    expect(entity.equipment()[1].getCost(entity)).toBe(20000);
  });

  it('sums heavy weapon limits across floors of one hex', () => {
    const entity = create();
    entity.buildingClass.set(2);
    setConstructionBuildingTopology(entity, [origin], 2);
    for (let i = 0; i < 8; i++) addTestEquipment(entity, laser, { location: buildingLocationName(origin, i % 2) });
    expect(codes(entity)).toContain('BUILDING_HEAVY_WEAPONS'); // 8.8 > 40 × 2 / 10
  });

  it('offers infantry weapons, generators, heat sinks and support/DropShip equipment', () => {
    const entity = create();
    const infantry = new WeaponEquipment({
      id: 'Rifle',
      name: 'Rifle',
      type: 'weapon',
      flags: ['F_INFANTRY'],
      stats: { tonnage: 0.004, cost: 100 },
      infantry: { damage: 0.1, crew: 1 },
    });
    const dropship = new MiscEquipment({ id: 'DS item', name: 'DS item', type: 'misc', flags: ['F_DS_EQUIPMENT'] });
    for (const eq of [infantry, laser, fusion, sink, cargo, dropship])
      expect(constructionEquipmentApplies(entity, eq)).withContext(eq.id).toBeTrue();
    expect(
      constructionEquipmentApplies(
        entity,
        new MiscEquipment({
          id: 'Turret',
          name: 'Turret',
          type: 'misc',
          flags: ['F_TURRET', 'F_SUPPORT_TANK_EQUIPMENT'],
        }),
      ),
    ).toBeFalse();
    for (let i = 0; i < 7; i++) addTestEquipment(entity, infantry, { location: buildingLocationName(origin, 0) });
    expect(codes(entity)).toContain('BUILDING_INFANTRY_WEAPONS');
  });

  it('round trips empty/partial ammunition and bays/quarters without extra fields or unallocated mounts', () => {
    const entity = create();
    expect(constructionSupportsAmmoQuantity(entity)).toBeTrue();
    for (const shotsCount of [0, 7])
      addTestEquipment(entity, ammo, { location: buildingLocationName(origin, 0), shotsCount });
    entity.transporters.set([
      {
        id: 'quarters',
        kind: 'bay',
        configuration: { type: 'second-class-quarters' },
        capacity: 2,
        doors: 0,
        bayNumber: 1,
        omni: false,
      },
      { id: 'cargo', kind: 'bay', configuration: { type: 'cargo' }, capacity: 10, doors: 1, bayNumber: 2, omni: false },
    ]);
    const native = encodeNativeEntity(entity);
    expect(native).toContain(':Shots0#');
    expect(native).toContain(':Shots7#');
    expect(native).not.toContain(':SIZE:');
    expect(native).not.toContain('Unallocated');
    const loaded = parseEntity(native, 'building.blk', registry).entity as StaticEmplacementEntity;
    expect(loaded.equipment().map((mount) => mount.getAmmoShots())).toEqual([0, 7]);
    expect(loaded.equipment().map((mount) => mount.getTonnage(loaded))).toEqual([1, 1]);
    expect(loaded.transporters().length).toBe(2);
    expect(calculateBuildingWeightBreakdown(loaded).carryingSpace).toBe(24);
    expect(loaded.cost()).toBe(entity.cost());
  });
});
