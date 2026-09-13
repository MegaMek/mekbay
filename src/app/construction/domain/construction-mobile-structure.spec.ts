// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';
import { WeaponEquipment } from '../../models/equipment.model';
import type { EquipmentRegistry } from '../../models/equipment-lookup';
import { buildEquipmentRegistry } from '../../services/catalogs/equipment-catalog-builder';
import { StaticEmplacementEntity } from '../../models/entity/entities/misc/static-emplacement-entity';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { buildingHexKey, buildingLocationName } from '../../models/entity/types/building';
import { parseEntity } from '../../models/entity/parse-entity';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { RecordSheetSvgGenerator } from '../../utils/sheets/record-sheet-svg-generator';
import { ConstructionTopologyComponent } from '../components/construction-topology.component';
import { ConstructionBuildingServicesComponent } from '../components/construction-building-services.component';
import { createConstructionEntity, CONSTRUCTION_UNIT_TYPES } from './construction-factory';
import { getConstructionFields } from './construction-fields';
import { setConstructionBuildingHexHeight, setConstructionBuildingTopology, transformConstructionBuilding } from './construction-building-topology';
import { constructionEquipmentApplies, equipmentPlacementIssues, setConstructionArmor } from './construction-rules';
import { constructionEquipmentConflictMessages } from './construction-equipment-conflicts';

describe('Mobile Structure construction (TO:AUE pp. 76–84)', () => {
  const origin = { q: 0, r: 0 }, east = { q: 1, r: 0 };
  const laser = new WeaponEquipment({ id: 'MobileTestLaser', name: 'Mobile test laser', type: 'weapon',
    flags: ['F_TANK_WEAPON', 'F_ENERGY'], stats: { tonnage: 1.1, cost: 10000 }, weapon: { heat: 3, ranges: [3, 6, 9, 12] } });
  const registry = createTestEquipmentRegistry({ [laser.id]: laser });
  const create = () => createConstructionEntity('MobileStructure', registry) as StaticEmplacementEntity;
  const codes = (entity: StaticEmplacementEntity) => entity.validationResult().messages.map(message => message.code);
  const footprint = (count: number) => Array.from({ length: count }, (_, q) => ({ q, r: 0 }));
  let catalog: EquipmentRegistry;
  beforeAll(async () => { catalog = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json()); });

  it('creates, reopens and re-exports mobile identity without inventing flank MP or charged crew quarters', () => {
    const entity = create();
    expect(CONSTRUCTION_UNIT_TYPES.some(type => type.id === 'MobileStructure')).toBeTrue();
    entity.originalWalkMP.set(1.25);
    const loaded = parseEntity(encodeNativeEntity(entity), 'mobile.blk', registry).entity as StaticEmplacementEntity;
    expect(loaded.entityType).toBe('MobileStructure');
    expect(loaded.unitSubtype()).toBe('Mobile Structure');
    expect(loaded.originalWalkMP()).toBe(1.25);
    expect(loaded.walkMP()).toBe(1.25);
    expect(loaded.runMP()).toBe(1.25);
    expect(loaded.buildingCrew()).toEqual({ crew: 6, gunners: 0, officers: 1, total: 7 });
    expect(loaded.transporters()).toEqual([]);
    expect(codes(loaded)).toEqual([]);
  });

  it('matches the printed 20-hex super-freighter example, including concentrated fuel and rounded per-hex systems', () => {
    const entity = create();
    entity.buildingClass.set(1); entity.buildingType.set(4); entity.constructionFactor.set(75);
    setConstructionBuildingTopology(entity, footprint(20), 14);
    entity.motiveType.set('Naval'); entity.mobilePowerSystem.set('COMBUSTION_LIQUID');
    entity.originalWalkMP.set(1.25); entity.operatingRange.set(7000);
    entity.fuelLocations.set(new Map([['0,0', 735], ['1,0', 735]]));
    expect(entity.mobileSystems()).toEqual({ power: 1050, motive: 168, fuel: 1470, powerPerHex: 52.5, motivePerHex: 8.5, sealingPerHex: 0 });
    expect(entity.capacityPerHex()).toBe(1200);
    expect(entity.capacityInHex(origin) - entity.hexLoads()[0].exact).toBe(404);
    expect(entity.capacityInHex({ q: 2, r: 0 }) - entity.hexLoads()[2].exact).toBe(1139);
    expect(entity.buildingCrew().total).toBe(44);
    const loaded = parseEntity(encodeNativeEntity(entity), 'freighter.blk', registry).entity as StaticEmplacementEntity;
    expect(loaded.fuelLocations()).toEqual(entity.fuelLocations());
    expect(loaded.mobileSystems()).toEqual(entity.mobileSystems());
    expect(codes(loaded)).toEqual([]);
  });

  it('matches the printed 19-hex armored DropShip-mover example', () => {
    const entity = create();
    entity.buildingClass.set(2); entity.buildingType.set(4); entity.constructionFactor.set(150);
    setConstructionBuildingTopology(entity, footprint(19), 4);
    entity.originalWalkMP.set(2); entity.buildingOptions.update(options => ({ ...options, sealing: true }));
    setConstructionArmor(entity, buildingLocationName(origin, 0), 32);
    expect(entity.mobileSystems().power).toBe(304);
    expect(entity.mobileSystems().motive).toBe(304);
    expect(entity.mobileSystems().sealingPerHex).toBe(60);
    expect(entity.hexLoads()[0].exact).toBe(94);
    expect(entity.capacityPerHex() - entity.hexLoads()[0].exact).toBe(506);
    expect(entity.buildingCrew().total).toBe(84);
    expect(entity.baseLevel()).toBe(2);
  });

  for (const [power, expectedIS, expectedClan] of [
    ['STEAM', [6, 6, 6, 7], [7, 7, 7, 8]],
    ['COMBUSTION_LIQUID', [3, 3, 3, 3.2], [3, 3, 3, 3]],
    ['FUEL_CELL', [4, 4.4, 4, 5], [4, 4.2, 4, 4.4]],
    ['FISSION', [3, 3, 3, 3], [4, 4, 4, 4]],
    ['FUSION', [2, 2, 2, 2.2], [1.8, 1.8, 1.8, 2]],
  ] as const) for (const [index, motive] of ['Tracked', 'VTOL', 'Naval', 'Submarine'].entries()) {
    it(`uses the ${power}/${motive} table multipliers for both technology bases`, () => {
      const entity = create();
      entity.mobilePowerSystem.set(power); entity.motiveType.set(motive as 'Tracked');
      setConstructionBuildingTopology(entity, footprint(5), 2); entity.originalWalkMP.set(1);
      expect(entity.mobileSystems().power).toBe(expectedIS[index] * 10);
      entity.techBase.set('Clan');
      expect(entity.mobileSystems().power).toBe(expectedClan[index] * 10);
    });
  }

  it('enforces class, motive, quarter-MP, fuel and per-hex capacity limits', () => {
    const entity = create();
    entity.buildingClass.set(1); entity.buildingType.set(2); entity.constructionFactor.set(20);
    expect(codes(entity)).not.toContain('BUILDING_CF');
    entity.buildingType.set(3); entity.constructionFactor.set(20);
    expect(codes(entity)).toContain('BUILDING_CF');
    entity.buildingClass.set(2); entity.motiveType.set('VTOL');
    expect(codes(entity)).toContain('MOBILE_MOVEMENT');
    entity.motiveType.set('Tracked'); entity.originalWalkMP.set(1.1);
    expect(codes(entity)).toContain('MOBILE_MOVEMENT');
    entity.originalWalkMP.set(1); entity.mobilePowerSystem.set('STEAM');
    expect(codes(entity)).toContain('MOBILE_FUEL_RANGE');
    entity.operatingRange.set(1000); entity.fuelLocations.set(new Map([['0,0', 999]]));
    expect(codes(entity)).toContain('MOBILE_FUEL_ALLOCATION');
    expect(codes(entity)).toContain('BUILDING_HEX_CAPACITY');
    const field = getConstructionFields(entity).find(field => field.id === 'mobile-mp')!;
    expect(field.step).toBe(.25);
    expect(() => field.set(1.1)).toThrow();
  });

  it('uses the highest occupied hex for capacity while dropping equipment and door/lift stops on removed floors', () => {
    const entity = create();
    setConstructionBuildingTopology(entity, [origin, east], 3);
    setConstructionBuildingHexHeight(entity, east, 1);
    expect(entity.height()).toBe(3);
    expect(entity.equipmentLocations().length).toBe(4);
    expect(entity.capacityInHex(east)).toBe(120);
    addTestEquipment(entity, laser, { location: buildingLocationName(origin, 2) });
    entity.doors.set([{ position: { hex: origin, floor: 1 }, height: 2, facing: 0 }]);
    entity.elevators.set([{ hex: origin, capacity: 10, exits: new Map([[0, 4], [1, 4], [2, 4], [3, 4]]) }]);
    setConstructionBuildingHexHeight(entity, origin, 1);
    expect(entity.height()).toBe(1);
    expect(entity.equipment()).toEqual([]);
    expect(entity.doors()).toEqual([]);
    expect([...entity.elevators()[0].exits.keys()]).toEqual([0, 1]);
    const loaded = parseEntity(encodeNativeEntity(entity), 'short.blk', registry).entity as StaticEmplacementEntity;
    expect(loaded.hexHeights()).toEqual(entity.hexHeights());
  });

  it('moves fuel, variable heights and equipment with their hexes when the footprint rotates', () => {
    const entity = create();
    setConstructionBuildingTopology(entity, [origin, east], 3);
    setConstructionBuildingHexHeight(entity, east, 2);
    entity.fuelLocations.set(new Map([['1,0', 12]]));
    addTestEquipment(entity, laser, { location: buildingLocationName(east, 1) });
    transformConstructionBuilding(entity, hex => ({ q: -hex.r, r: hex.q + hex.r }));
    expect(entity.hexHeight({ q: 0, r: 1 })).toBe(2);
    expect(entity.fuelLocations().get('0,1')).toBe(12);
    expect(entity.equipment()[0].location).toBe(buildingLocationName({ q: 0, r: 1 }, 1));
  });

  it('rounds mobile power amplifiers to half a ton and counts their weapon gunner', () => {
    const entity = create(); entity.buildingClass.set(2); entity.mobilePowerSystem.set('FUEL_CELL'); entity.operatingRange.set(100);
    addTestEquipment(entity, laser, { location: buildingLocationName(origin, 0) });
    expect(entity.hexLoads()[0].powerAmplifiers).toBe(.5);
    expect(entity.buildingCrew().gunners).toBe(1);
    expect(codes(entity)).toContain('BUILDING_COOLING');
    entity.mobilePowerSystem.set('FUSION');
    expect(entity.hexLoads()[0].powerAmplifiers).toBe(0);
    expect(codes(entity)).not.toContain('BUILDING_COOLING');
  });

  it('uses the actual native facility catalog and the current flight-deck equipment rule (p. 124), not the obsolete p. 84 example', () => {
    const entity = createConstructionEntity('MobileStructure', catalog) as StaticEmplacementEntity;
    entity.buildingClass.set(1); entity.buildingType.set(4); entity.constructionFactor.set(75);
    setConstructionBuildingTopology(entity, footprint(3), 14);
    for (const id of ['Building Flight Deck', 'Building Helipad', 'Building Landing Deck', 'Modular Structure Linkage', 'Unspecified Building Equipment'])
      expect(constructionEquipmentApplies(entity, catalog.findEquipment(id)!)).withContext(id).toBeTrue();
    const deck = catalog.findEquipment('Building Flight Deck')!;
    const mount = addTestEquipment(entity, deck, { location: buildingLocationName(origin, 13) });
    entity.equipmentDesign.set(new Map([[mount.mountId, { automated: false, pcmtSource: 0,
      positions: entity.coordinates().map(hex => ({ hex, floor: 13 })) }]]));
    expect(mount.getTonnage(entity)).toBe(1500);
    expect(entity.hexLoads().map(load => load.miscellaneous)).toEqual([500, 500, 500]);
    expect(codes(entity)).not.toContain('BUILDING_FLIGHT_DECK');
    const loaded = parseEntity(encodeNativeEntity(entity), 'deck.blk', catalog).entity as StaticEmplacementEntity;
    expect(loaded.equipment()[0].equipmentId).toBe('Building Flight Deck');
    expect(loaded.equipment()[0].getTonnage(loaded)).toBe(1500);
    expect(loaded.equipmentPositions(loaded.equipment()[0]).length).toBe(3);
    expect(loaded.buildingCrew().crew).toBe(26);
    expect(codes(loaded)).toEqual([]);
  });

  it('counts real infantry gunners and rounds kilogram weapons, ammo and pintles together per hex', () => {
    const entity = createConstructionEntity('MobileStructure', catalog) as StaticEmplacementEntity;
    const weapon = catalog.findEquipment('InfantryStandardSRM')!, ammo = catalog.findEquipment('InfantryStandardSRM Ammo')!;
    addTestEquipment(entity, weapon, { location: buildingLocationName(origin, 0), turretType: 'pintle' });
    for (let magazine = 0; magazine < 50; magazine++) addTestEquipment(entity, ammo, { location: buildingLocationName(origin, 0) });
    const load = entity.hexLoads()[0];
    expect(entity.buildingCrew()).toEqual({ crew: 6, gunners: 1, officers: 1, total: 8 });
    expect(load.weapons + load.ammo + load.pintle + load.smallItemsRounding).toBeCloseTo(1.5);
    expect(entity.hexLoads()[1].smallItemsRounding).toBe(0);
    entity.transporters.set([{ id: 'loose-cargo', kind: 'bay', configuration: { type: 'cargo' }, capacity: .468, doors: 1, bayNumber: 1, omni: false }]);
    entity.baySpace.set(new Map([['loose-cargo', [{ position: { hex: origin, floor: 0 }, tons: .468 }]]]));
    expect(entity.hexLoads()[0].smallItemsRounding).toBeCloseTo(0);
  });

  it('applies equipment quantity limits per hex, including installation in a full hex', () => {
    const entity = createConstructionEntity('MobileStructure', catalog) as StaticEmplacementEntity;
    const hoist = Object.values(catalog.equipment).find(item => item.hasFlag('F_LIFT_HOIST'))!;
    for (const hex of [origin, east]) for (let count = 0; count < 4; count++)
      addTestEquipment(entity, hoist, { location: buildingLocationName(hex, 0) });
    expect(constructionEquipmentConflictMessages(entity).map(issue => issue.code)).not.toContain('LIFT_HOIST_LIMIT');
    expect(equipmentPlacementIssues(entity, hoist, buildingLocationName(origin, 0)).join(' ')).toContain('per Mobile Structure hex');
    addTestEquipment(entity, hoist, { location: buildingLocationName(origin, 0) });
    expect(constructionEquipmentConflictMessages(entity).map(issue => issue.code)).toContain('LIFT_HOIST_LIMIT');
  });

  it('prices the motive system per occupied hex and applies the CF multiplier last', () => {
    expect(create().cost()).toBe(2296000);
  });

  it('uses mobile BV protection once per hex and maximum MP without vehicle mass or facing discounts', () => {
    const entity = create();
    expect(entity.battleValue()).toBe(114); // (80 CF × 1.5) × .5 + (2 hexes × 50) × .54
    setConstructionBuildingTopology(entity, [origin, east], 3);
    expect(entity.battleValue()).toBe(114);
    entity.buildingClass.set(2); setConstructionArmor(entity, buildingLocationName(origin, 0), 16);
    const gun = new WeaponEquipment({ id: 'MobileBVWeapon', name: 'BV weapon', type: 'weapon',
      stats: { tonnage: 1, bv: 100 }, flags: ['F_TANK_WEAPON'], weapon: { ranges: [3, 6, 9, 12] } });
    addTestEquipment(entity, gun, { location: buildingLocationName(origin, 0), facing: 0 });
    addTestEquipment(entity, gun, { location: buildingLocationName(east, 0), facing: 3 });
    expect(entity.battleValue()).toBe(262); // (80 + 120) × .5 + 300 × .54
    entity.motiveType.set('Submarine'); entity.originalWalkMP.set(4);
    expect(entity.battleValue()).toBe(364); // Same defense; 300 × .88 offense.
    expect(entity.battleValueFor({
      destroyed: false, movement: { walk: 0, run: 0, jump: 0, umu: 0 }, engineHits: 0,
      equipmentStatus: () => 'available', armorRemaining: (location, face) => entity.getArmorValue(location, face),
      structureRemaining: location => entity.structureValues().get(location) ?? 0,
      ammoRemaining: () => 0, ammoEquipment: () => null,
    })).toBe(364); // TO:AUE uses designed maximum MP even when the current motive system is disabled.
  });

  it('checks bay doors against the exterior footprint and doubles the limit for Hangars', () => {
    const entity = create();
    const bay = { id: 'cargo', kind: 'bay' as const, configuration: { type: 'cargo' as const }, capacity: 10, doors: 6, bayNumber: 1, omni: false };
    entity.transporters.set([bay]);
    expect(codes(entity)).toContain('MOBILE_BAY_DOORS');
    entity.buildingClass.set(1);
    expect(codes(entity)).not.toContain('MOBILE_BAY_DOORS');
    entity.transporters.set([{ ...bay, doors: 0 }]);
    expect(codes(entity)).toContain('MOBILE_BAY_DOORS');
    entity.transporters.set([{ ...bay, doors: 1 }, { ...bay, id: 'internal-cargo', bayNumber: 2, doors: 0 }]);
    expect(codes(entity)).not.toContain('MOBILE_BAY_DOORS');
  });

  it('authors bay doors, preserves their native bay association and displays the same edge symbol on sheets', async () => {
    const entity = create();
    entity.transporters.set([{ id: 'bay-transport', kind: 'bay', configuration: { type: 'cargo' }, capacity: 10,
      doors: 1, bayNumber: 7, omni: false }]);
    const initialCost = entity.cost();
    const fixture = TestBed.createComponent(ConstructionBuildingServicesComponent);
    fixture.componentRef.setInput('entity', entity);
    fixture.componentRef.setInput('location', buildingLocationName(east, 0));
    fixture.componentInstance.editRequested.subscribe(edit => edit());
    fixture.detectChanges();
    fixture.componentInstance.addBayDoor(); fixture.detectChanges();
    expect(entity.bayDoors().length).toBe(1);
    expect(entity.bayDoors()[0].bayId).toBe('bay-transport');
    expect(entity.bayDoors()[0].position.hex).toEqual(east);
    expect(codes(entity)).not.toContain('BUILDING_BAY_DOOR');
    expect(codes(entity)).not.toContain('BUILDING_BAY_DOOR_COUNT');
    expect(entity.cost()).toBe(initialCost); // Bay construction already includes its doors.
    const source = encodeNativeEntity(entity);
    expect(source).toContain('<building_bay_doors>\n7;1,0,-1/0;0\n</building_bay_doors>');
    const restored = parseEntity(source, 'bay-door-mobile.blk', registry).entity as StaticEmplacementEntity;
    const restoredBay = restored.transporters().find(bay => bay.kind === 'bay' && bay.bayNumber === 7)!;
    expect(restored.bayDoors()[0]).toEqual({ bayId: restoredBay.id, position: { hex: east, floor: 0 }, facing: 0 });
    expect(restored.mapDoors()).toEqual([{ position: { hex: east, floor: 0 }, facing: 0, height: 1 }]);
    const svg = await RecordSheetSvgGenerator.generate(restored);
    expect(svg.querySelector('.building-map-layer [data-building-symbol="door"]')).not.toBeNull();
    fixture.destroy();
  });

  it('remaps bay doors with topology and removes doors whose original hex is deleted', () => {
    const entity = create();
    entity.transporters.set([{ id: 'cargo', kind: 'bay', configuration: { type: 'cargo' }, capacity: 10,
      doors: 1, bayNumber: 1, omni: false }]);
    entity.bayDoors.set([{ bayId: 'cargo', position: { hex: east, floor: 0 }, facing: 0 }]);
    transformConstructionBuilding(entity, hex => ({ q: -hex.r, r: hex.q + hex.r }), side => (side + 1) % 6);
    expect(entity.bayDoors()[0]).toEqual({ bayId: 'cargo', position: { hex: { q: 0, r: 1 }, floor: 0 }, facing: 1 });
    setConstructionBuildingTopology(entity, [origin]);
    expect(entity.bayDoors()).toEqual([]);
  });

  it('rejects unknown bay references and diagnoses overfilled exterior bay-door sides', () => {
    const entity = create();
    entity.transporters.set([{ id: 'cargo', kind: 'bay', configuration: { type: 'cargo' }, capacity: 10,
      doors: 2, bayNumber: 1, omni: false }]);
    const door = { bayId: 'cargo', position: { hex: origin, floor: 0 }, facing: 0 };
    entity.bayDoors.set([door, door]);
    expect(codes(entity)).toContain('BUILDING_BAY_DOOR');
    entity.buildingClass.set(1);
    expect(codes(entity)).not.toContain('BUILDING_BAY_DOOR');
    const source = encodeNativeEntity(entity).replace('1;0,0,0/0;0', '99;0,0,0/0;0');
    expect(() => parseEntity(source, 'invalid-bay-door.blk', registry)).toThrow();
    expect(() => parseEntity(encodeNativeEntity(entity).replace('1;0,0,0/0;0', '1;0,0,0/1;0'), 'roof-bay-door.blk', registry)).toThrow();
  });

  it('supports Hangar Large Portals while rejecting static-only construction options', () => {
    const entity = create(); entity.buildingClass.set(1);
    entity.buildingOptions.update(options => ({ ...options, openSpace: true }));
    expect(codes(entity)).not.toContain('BUILDING_OPEN_SPACE');
    expect(getConstructionFields(entity).some(field => field.id === 'building-openSpace')).toBeTrue();
    expect(getConstructionFields(entity).some(field => field.id === 'building-heavyMetal')).toBeFalse();
    expect(getConstructionFields(entity).some(field => field.id === 'building-ceiling')).toBeFalse();
    entity.buildingClass.set(2);
    expect(codes(entity)).toContain('BUILDING_OPEN_SPACE');
    entity.buildingOptions.update(options => ({ ...options, heavyMetal: true }));
    expect(codes(entity)).toContain('MOBILE_STATIC_OPTIONS');
  });

  it('authors explicit Large Portal equipment templates and preserves their identities across BLK and topology', () => {
    const entity = create(); entity.buildingClass.set(1);
    entity.buildingOptions.update(options => ({ ...options, openSpace: true }));
    expect(codes(entity)).toContain('MOBILE_PORTAL_TEMPLATES');
    const fields = getConstructionFields(entity);
    fields.find(field => field.id === 'mobile-portal-hex2')!.set('0,0');
    fields.find(field => field.id === 'mobile-portal-hex3')!.set('1,0');
    expect(codes(entity)).not.toContain('MOBILE_PORTAL_TEMPLATES');
    const source = encodeNativeEntity(entity);
    expect(source).toContain('<building_portal_templates>\n2;0,0,0\n3;1,0,-1\n</building_portal_templates>');
    const restored = parseEntity(source, 'portal.blk', registry).entity as StaticEmplacementEntity;
    expect(restored.portalHex2()).toEqual(origin);
    expect(restored.portalHex3()).toEqual(east);
    transformConstructionBuilding(restored, hex => ({ q: -hex.r, r: hex.q + hex.r }), side => (side + 1) % 6);
    expect(restored.portalHex3()).toEqual({ q: 0, r: 1 });
    setConstructionBuildingTopology(restored, [origin]);
    expect(restored.portalHex2()).toEqual(origin);
    expect(restored.portalHex3()).toBeNull();
    expect(codes(restored)).toContain('MOBILE_PORTAL_TEMPLATES');
  });

  it('rejects malformed portal template references and diagnoses duplicate or missing template hexes', () => {
    const entity = create(); entity.buildingClass.set(1);
    entity.buildingOptions.update(options => ({ ...options, openSpace: true }));
    entity.portalHex2.set(origin); entity.portalHex3.set(origin);
    expect(codes(entity)).toContain('MOBILE_PORTAL_TEMPLATES');
    entity.portalHex3.set({ q: 90, r: -90 });
    expect(codes(entity)).toContain('MOBILE_PORTAL_TEMPLATES');
    const source = encodeNativeEntity(entity);
    expect(() => parseEntity(source, 'off-footprint-portal.blk', registry)).toThrow();
    expect(() => parseEntity(source.replace('2;0,0,0', '4;0,0,0'), 'invalid-portal.blk', registry)).toThrow();
    expect(() => parseEntity(source.replace('3;90,-90,0', '2;1,0,-1'), 'duplicate-portal.blk', registry)).toThrow();
  });

  it('reports malformed portable mobile state at the BLK boundary', () => {
    const source = encodeNativeEntity(create());
    for (const [tag, value] of [['hex_heights', '1\n0'], ['fuel_locations', '90,0,-90;1'], ['fuel_locations', '0,0,0;-1'],
      ['power_system', 'UNKNOWN'], ['operating_range', '-1']] as const) {
      const block = `<${tag}>\n${value}\n</${tag}>`;
      const modified = source.includes(`<${tag}>`) ? source.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`), block) : source + '\n' + block;
      expect(parseEntity(modified, 'invalid-mobile.blk', registry).diagnostics.some(issue => issue.field === tag && issue.severity === 'error'))
        .withContext(tag + ': ' + value).toBeTrue();
    }
  });

  it('keeps variable layers visible in both topology views and permits growing an absent upper cell', () => {
    const entity = create(); setConstructionBuildingTopology(entity, [origin, east], 3);
    setConstructionBuildingHexHeight(entity, east, 1);
    const fixture = TestBed.createComponent(ConstructionTopologyComponent);
    fixture.componentRef.setInput('entity', entity); fixture.detectChanges();
    const editor = fixture.componentInstance; editor.editRequested.subscribe(edit => edit());
    editor.selectFloor(2); fixture.detectChanges();
    expect(editor.topCells().filter(cell => cell.occupied).length).toBe(1);
    editor.setViewMode('pancake'); fixture.detectChanges();
    expect([...fixture.nativeElement.querySelectorAll('.pancake-layer')].map((layer: Element) => layer.querySelectorAll('g.occupied').length).sort()).toEqual([1, 1, 2]);
    editor.openFloor(2); editor.activate(east, false); fixture.detectChanges();
    expect(entity.hexHeight(east)).toBe(3);
    expect(entity.coordinates().length).toBe(2);
    editor.setFuel(3); fixture.detectChanges();
    expect(entity.fuelLocations().get(buildingHexKey(east))).toBe(3);
    fixture.destroy();
  });

  it('prints real movement, variable floors and explicit fuel locations with non-negative translated labels', async () => {
    const entity = create(); entity.originalWalkMP.set(1.25); entity.mobilePowerSystem.set('FUEL_CELL'); entity.operatingRange.set(1000);
    entity.coordinates.set([{ q: -10, r: -10 }, { q: -9, r: -10 }]); entity.height.set(3);
    entity.hexHeights.set(new Map([['-10,-10', 3], ['-9,-10', 1]]));
    entity.fuelLocations.set(new Map([['-10,-10', entity.mobileSystems().fuel]]));
    const svg = await RecordSheetSvgGenerator.generate(entity);
    const layers = [...svg.querySelectorAll('.building-map-layer')];
    expect(layers.map(layer => layer.querySelectorAll('.building-hex.occupied').length)).toEqual([1, 1, 2]);
    expect(svg.textContent).toContain('1.25'); expect(svg.textContent).toContain('Tracked');
    expect(svg.textContent).toContain('Fuel cell'); expect(svg.textContent).toContain('Fuel (');
    expect(entity.coordinates().map(hex => entity.displayHex(hex)).every(label => /^\d{4}$/.test(label) && !label.startsWith('00') && !label.endsWith('00'))).toBeTrue();
  });
});
