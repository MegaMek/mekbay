// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ArmorEquipment, StructureEquipment } from '../../models/equipment.model';
import type { EquipmentRegistry } from '../../models/equipment-lookup';
import { buildEquipmentRegistry } from '../../services/catalogs/equipment-catalog-builder';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import { FixedWingSupportEntity, MekEntity } from '../../models/entity/entities';
import { calculateMekStructureWeight } from '../../models/entity/utils/weight/mek-weight';
import { calculateBattleValueDetails } from '../../models/entity/utils/battle-value/factory';
import { alphaStrikeArmor } from '../../models/entity/utils/alpha-strike/foundation/integrity';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { MountedArmor } from '../../models/entity/components';
import { CONSTRUCTION_UNIT_TYPES, createConstructionEntity } from './construction-factory';
import { constructionSupportsPatchwork, getConstructionArmorOptions, setConstructionArmorMaterial, setConstructionHybridStructure, setConstructionPatchwork, setConstructionStructure, validateConstruction } from './construction-rules';
import { getConstructionFields } from './construction-fields';
import { allocationPlacements, constructionSharedMekSlots, moveConstructionEquipmentBlock, splitConstructionEquipment } from './construction-rules';
import { applyConstructionSpreadPlacements, constructionSpreadAllocation, constructionSpreadAutoPlacements, constructionSpreadMovePlacements, setConstructionSpreadSlots, uninstallConstructionEquipment } from './construction-rules';

describe('native construction material modes', () => {
  let registry: EquipmentRegistry;
  beforeAll(async () => { registry = buildEquipmentRegistry(await (await fetch('/online-assets/static/equipment.json')).json()); });
  function reload(entity: ReturnType<typeof createConstructionEntity>) {
    return parseEntity(encodeNativeEntity(entity), entity instanceof MekEntity ? 'mode.mtf' : 'mode.blk', registry).entity;
  }

  for (const kind of ['Biped', 'Quad', 'Tripod', 'Tank', 'Naval', 'VTOL', 'SupportTank', 'SupportNaval', 'SupportVTOL', 'LargeSupportTank', 'Aero', 'ConvFighter', 'FixedWingSupport'] as const) {
    it(`preserves explicit uniform-start Patchwork on ${kind}`, () => {
      const entity = createConstructionEntity(kind, registry);
      const materials = [...entity.armorByLocation().values()].map(mounted => mounted.armor.id);
      expect(constructionSupportsPatchwork(entity)).toBeTrue();
      setConstructionPatchwork(entity, true);
      expect(entity.hasPatchworkArmor()).toBeTrue();
      expect([...entity.armorByLocation().values()].map(mounted => mounted.armor.id)).toEqual(materials);
      const loaded = reload(entity);
      expect(loaded.hasPatchworkArmor()).toBeTrue();
      expect([...loaded.armorByLocation().values()].map(mounted => mounted.armor.id)).toEqual(materials);
      setConstructionPatchwork(loaded, false);
      expect(reload(loaded).hasPatchworkArmor()).toBeFalse();
    });
  }

  it('keeps location materials and BAR ratings through support-vehicle and fixed-wing BLK', () => {
    for (const kind of ['SupportTank', 'FixedWingSupport'] as const) {
      const entity = createConstructionEntity(kind, registry);
      if (entity.isSupportVehicle()) entity.structuralTechRating.set(3);
      const bar = getConstructionArmorOptions(entity).find(armor => armor.bar === 5)!;
      expect(bar instanceof ArmorEquipment).toBeTrue();
      setConstructionPatchwork(entity, true);
      setConstructionArmorMaterial(entity, bar, entity.armorLocations[0]);
      entity.setArmorValue(entity.armorLocations[0], 'front', 10);
      const loaded = reload(entity);
      expect(loaded.armorAt(entity.armorLocations[0]).armor.bar).toBe(5);
      expect(loaded.totalArmorPoints()).toBe(10);
      expect(loaded.loadoutTonnage()).toBeCloseTo(entity.loadoutTonnage(), 6);
      expect(encodeNativeEntity(entity)).toContain('_barrating>');
    }
  });

  it('keeps mixed BAR protection and derived statistics stable after BLK reload and disabling Patchwork', () => {
    for (const kind of ['SupportTank', 'FixedWingSupport'] as const) {
      const entity = createConstructionEntity(kind, registry);
      const first = entity.armorLocations[0];
      const second = entity.armorLocations[1];
      if (entity.isSupportVehicle()) entity.structuralTechRating.set(3);
      addTestEquipment(entity, Object.values(registry.equipment).find(eq => eq.hasFlag('F_ARMORED_CHASSIS'))!, { location: 'Body' });
      const options = getConstructionArmorOptions(entity);
      const bar5 = options.find(armor => armor.bar === 5)!;
      const bar10 = options.find(armor => armor.armorType === 'SV_BAR_10')!;
      setConstructionPatchwork(entity, true);
      setConstructionArmorMaterial(entity, bar5, first);
      setConstructionArmorMaterial(entity, bar10, second);
      entity.setArmorValue(first, 'front', 50);
      entity.setArmorValue(second, 'front', 50);
      const loaded = reload(entity);
      expect(calculateBattleValueDetails(loaded).defensive).toBeCloseTo(calculateBattleValueDetails(entity).defensive, 6);
      expect(alphaStrikeArmor(loaded)).toBe(alphaStrikeArmor(entity));
      expect(alphaStrikeArmor(entity)).toBe(2); // AS uses the first facing's BAR for its conversion.
      if (entity instanceof FixedWingSupportEntity) {
        expect(entity.armorDamageThreshold(first)).toBe(1);
        expect(entity.armorDamageThreshold(second)).toBe(5);
      }
      setConstructionPatchwork(entity, false);
      expect(entity.isSupportVehicle() && entity.barRating()).toBe(5);
      expect(reload(entity).armorAt(second).armor.bar).toBe(5);
    }
  });

  for (const kind of ['Biped', 'Quad', 'Tripod'] as const) {
    it(`preserves uniform-start Hybrid and donor metadata on ${kind}`, () => {
      const entity = createConstructionEntity(kind, registry) as MekEntity;
      const weight = calculateMekStructureWeight(entity);
      setConstructionHybridStructure(entity, true);
      entity.setStructureDonor('CT', { name: 'Original donor', unitType: 'BattleMek' });
      const loaded = reload(entity) as MekEntity;
      expect(loaded.hasHybridStructure()).toBeTrue();
      expect(loaded.hasMixedStructureMaterials()).toBeFalse();
      expect(loaded.structureDonorAt('CT')?.name).toBe('Original donor');
      expect(calculateMekStructureWeight(loaded)).toBeCloseTo(weight, 6);
      setConstructionHybridStructure(loaded, false);
      expect((reload(loaded) as MekEntity).hasHybridStructure()).toBeFalse();
      expect(loaded.structureDonorAt('CT')).toBeNull();
    });
  }

  it('allocates hybrid structure criticals only at their donor locations and survives MTF', () => {
    const entity = createConstructionEntity('Biped', registry) as MekEntity;
    const endo = registry.findEquipment('IS Endo Steel') as StructureEquipment;
    setConstructionHybridStructure(entity, true);
    setConstructionStructure(entity, endo, 'RA', 55);
    const reservation = entity.equipment().find(mount => mount.equipmentId === endo.id)!;
    expect(reservation.placements?.map(placement => placement.location)).toEqual(['RA', 'RA']);
    const loaded = reload(entity) as MekEntity;
    expect(loaded.hasMixedStructureMaterials()).toBeTrue();
    expect(loaded.structureAt('RA').tonnage).toBe(55);
    expect(loaded.structureAt('RA').structure.id).toBe(endo.id);
    expect(validateConstruction(loaded).messages.filter(message => message.code === 'MATERIAL_CRITICALS')).toEqual([]);
    setConstructionStructure(loaded, loaded.structureAt('CT').structure, 'RA');
    expect(loaded.structureAt('RA').tonnage).toBe(55);
  });

  it('derives native FrankenMek leg penalties from donor identity and tonnage after MTF reload', () => {
    const entity = createConstructionEntity('Biped', registry) as MekEntity;
    setConstructionHybridStructure(entity, true);
    entity.setStructureDonor('RL', { name: 'Donor A', unitType: 'BattleMek' });
    entity.setStructureDonor('LL', { name: 'Donor A', unitType: 'BattleMek' });
    expect(entity.frankenMekPilotingModifier()).toBe(0);
    entity.setStructureDonor('LL', { name: 'Donor A', unitType: 'IndustrialMek' });
    expect((reload(entity) as MekEntity).frankenMekPilotingModifier()).toBe(1);
    setConstructionStructure(entity, entity.structureAt('LL').structure, 'LL', 55);
    expect((reload(entity) as MekEntity).frankenMekPilotingModifier()).toBe(2);
    setConstructionHybridStructure(entity, false);
    expect(entity.frankenMekPilotingModifier()).toBe(0);
  });

  for (const heavy of [false, true]) for (const control of ['chassis', 'CT']) {
    it(`resizes the chassis with a ${heavy ? '105→70' : '70→105'} ${control} edit, keeping the donor, through MTF reload`, () => {
      const original = heavy ? 105 : 70, next = heavy ? 70 : 105;
      const ammo = registry.equipment['IS Ammo AC/10'], gun = registry.equipment['Autocannon/10'];
      const source = [ 'chassis:Donor geometry', 'model:Audit', 'Config:Biped FrankenMek', 'techbase:Inner Sphere',
        'era:3150', 'rules level:5', `mass:${original}`, `engine:${original * 3} Fusion Engine`,
        'structure:Standard', `LA structure:${heavy ? 110 : 50}`, 'walk mp:3', 'heat sinks:10 Single',
        'Left Arm:', 'Shoulder', 'Upper Arm Actuator', 'Lower Arm Actuator', 'Hand Actuator', ...Array(heavy ? 4 : 7).fill(gun.id),
        'Right Arm:', 'Shoulder', 'Upper Arm Actuator', 'Lower Arm Actuator', 'Hand Actuator',
        ...(heavy ? [ammo.id + '|' + ammo.id] : [ammo.id, ammo.id]) ].join('\n');
      const entity = parseEntity(source, 'hybrid.mtf', registry).entity as MekEntity;
      entity.setStructureDonor('LA', { name: 'Original arm', unitType: 'BattleMek' });
      if (control === 'chassis') getConstructionFields(entity).find(field => field.id === 'tonnage')!.set(next);
      else setConstructionStructure(entity, entity.structureAt('CT').structure, 'CT', next);
      // The center torso sets one slot scale for the whole chassis (IO:AE p. 157); the donor keeps its tonnage and
      // locations without a donor follow the chassis.
      for (const design of [entity, reload(entity) as MekEntity]) {
        expect(design.tonnage()).toBe(next);
        expect(design.mountedEngine().rating).toBe(original * 3);
        expect(design.originalWalkMP()).toBe(Math.floor(original * 3 / next));
        expect(design.structureAt('LA').tonnage).toBe(heavy ? 110 : 50);
        expect(design.structureDonorAt('LA')?.name).toBe('Original arm');
        expect(design.structureAt('RA').tonnage).toBe(next);
        expect(design.frankenMekDonorSizeIssues().length).toBe(1);
        const guns = design.equipment().filter(mount => mount.equipmentId === gun.id);
        expect(guns.map(mount => mount.placedCriticalSlotCount)).toEqual([heavy ? 7 : 4]);
        expect(allocationPlacements(design, gun, 'LA', undefined, guns[0])?.length).toBe(heavy ? 7 : 4);
        const bins = design.equipment().filter(mount => mount.equipmentId === ammo.id);
        expect(bins.length).toBe(2);
        expect(bins[0].placements![0].slotIndex === bins[1].placements![0].slotIndex).toBeFalse();
        expect(design.criticalSlotSharingIssues()).toEqual([]);
      }
      // Correcting the donor changes no slots.
      setConstructionStructure(entity, entity.structureAt('LA').structure, 'LA', next);
      const corrected = reload(entity) as MekEntity;
      expect(corrected.frankenMekDonorSizeIssues().length).toBe(0);
      expect(corrected.structureDonorAt('LA')).toBeNull();
      expect(corrected.equipment().filter(mount => mount.equipmentId === gun.id).map(mount => mount.placedCriticalSlotCount))
        .toEqual([heavy ? 7 : 4]);
      expect(corrected.criticalSlotSharingIssues()).toEqual([]);
      expect(constructionSharedMekSlots(corrected, ammo, 'RA').length > 0).toBe(!heavy);
    });
  }

  it('splits a weapon at the chassis scale whatever its donors weigh, and keeps one mount on MTF reload', () => {
    const gun = registry.equipment['Autocannon/20'];
    for (const [arm, torso] of [[70, 105], [105, 70]]) {
      const source = ['chassis:Split', 'model:Donor', 'Config:Biped FrankenMek', 'techbase:Inner Sphere',
        'mass:105', 'engine:315 Fusion Engine', 'structure:Standard', `LA structure:${arm}`, `LT structure:${torso}`,
        'walk mp:3', 'heat sinks:10 Single', 'Left Torso:', ...Array(5).fill(gun.id)].join('\n');
      const mek = parseEntity(source, 'split.mtf', registry).entity as MekEntity;
      splitConstructionEquipment(mek, mek.equipment().find(m => m.equipmentId === gun.id)!, 'LA', 2, 'LT');
      const loaded = reload(mek) as MekEntity;
      const guns = loaded.equipment().filter(m => m.equipmentId === gun.id);
      expect(guns.length).toBe(1);
      expect(guns[0].placements!.filter(p => p.location === 'LT').length).toBe(3);
      expect(guns[0].placements!.filter(p => p.location === 'LA').length).toBe(2);
      expect(guns[0].getNumCriticalSlots(loaded)).toBe(5);
    }
  });

  it('moves a split weapon\'s blocks without changing their size', () => {
    const gun = registry.equipment['Autocannon/20'];
    const source = ['chassis:Split', 'model:Donor', 'Config:Biped FrankenMek', 'techbase:Inner Sphere', 'era:3150',
      'rules level:5', 'mass:70', 'engine:210 Fusion Engine', 'structure:Standard', 'LA structure:105', 'walk mp:3',
      'heat sinks:10 Single', 'Left Arm:', 'Shoulder', 'Upper Arm Actuator', 'Left Torso:', ...Array(10).fill(gun.id)].join('\n');
    const mek = parseEntity(source, 'split.mtf', registry).entity as MekEntity;
    const rows = (entity: MekEntity) => entity.equipment().filter(mount => mount.equipmentId === gun.id)
      .map(mount => ['LA', 'LT'].map(location => mount.placements!.filter(p => p.location === location).length));
    const split = splitConstructionEquipment(mek, mek.equipment().find(mount => mount.equipmentId === gun.id)!, 'LT', 3, 'LA');
    expect(rows(mek)).toEqual([[7, 3]]);
    expect(rows(reload(mek) as MekEntity)).toEqual([[7, 3]]);
    const intoArm = moveConstructionEquipmentBlock(mek, split, 'LT', 'LA');
    expect(rows(mek)).toEqual([[10, 0]]);
    moveConstructionEquipmentBlock(mek, intoArm, 'LA', 'LT');
    expect(rows(mek)).toEqual([[0, 10]]);
  });

  it('rolls back a chassis tonnage edit whose resized mounts cannot fit', () => {
    const gun = registry.equipment['Autocannon/10'];
    const source = ['chassis:Full arm', 'model:Donor', 'Config:Biped FrankenMek', 'techbase:Inner Sphere',
      'mass:105', 'engine:315 Fusion Engine', 'structure:Standard', 'LA structure:110',
      'walk mp:3', 'heat sinks:10 Single', 'Left Arm:', 'Shoulder', 'Upper Arm Actuator', 'Lower Arm Actuator', 'Hand Actuator',
      ...Array(8).fill(gun.id)].join('\n');
    const mek = parseEntity(source, 'full.mtf', registry).entity as MekEntity;
    mek.setStructureDonor('LA', { name: 'Original donor', unitType: 'BattleMek' });
    const original = encodeNativeEntity(mek);
    expect(() => getConstructionFields(mek).find(field => field.id === 'tonnage')!.set(100))
      .toThrowError(/free critical slots in LA\. Move it before changing the chassis tonnage/);
    expect(encodeNativeEntity(mek)).toBe(original);
    expect(mek.equipment().filter(m => m.equipmentId === gun.id).map(m => m.placedCriticalSlotCount)).toEqual([4, 4]);
  });

  it('moves FrankenMek locations without a donor with the chassis tonnage and keeps donors, as MegaMekLab does', () => {
    const source = ['chassis:Hybrid', 'model:Follow', 'Config:Biped FrankenMek', 'techbase:Inner Sphere', 'era:3150', 'rules level:5',
      'mass:50', 'engine:200 Fusion Engine', 'structure:Standard', 'LL structure:60', 'walk mp:4', 'heat sinks:10 Single'].join('\n');
    const mek = parseEntity(source, 'follow.mtf', registry).entity as MekEntity;
    mek.setStructureDonor('LA', { name: 'Hunchback HBK-4G', unitType: 'BattleMek' });
    getConstructionFields(mek).find(field => field.id === 'tonnage')!.set(55);
    const tons = (location: 'CT' | 'RA' | 'LA' | 'LL') => mek.structureAt(location).tonnage;
    expect([tons('CT'), tons('RA'), tons('LA'), tons('LL')]).toEqual([55, 55, 50, 60]);
    expect(mek.structureDonorAt('LA')?.name).toBe('Hunchback HBK-4G');
  });

  it('returns a split weapon to a division that still fits after a chassis class round trip', () => {
    const gun = registry.equipment['Autocannon/20'];
    const source = ['chassis:Split', 'model:Round trip', 'Config:Biped', 'techbase:Inner Sphere', 'era:3150', 'rules level:5',
      'mass:100', 'engine:300 Fusion Engine', 'structure:Standard', 'walk mp:3', 'heat sinks:10 Single',
      'Right Arm:', 'Shoulder', 'Upper Arm Actuator', 'Lower Arm Actuator', 'Hand Actuator', ...Array(3).fill(gun.id),
      ...Array(5).fill('Medium Laser'), 'Right Torso:', ...Array(7).fill(gun.id)].join('\n');
    const mek = parseEntity(source, 'round-trip.mtf', registry).entity as MekEntity;
    const rows = () => mek.equipment().filter(mount => mount.equipmentId === gun.id)
      .map(mount => ['RA', 'RT'].map(location => mount.placements!.filter(p => p.location === location).length));
    const tonnage = getConstructionFields(mek).find(field => field.id === 'tonnage')!;
    tonnage.set(105);
    expect(rows()).toEqual([[2, 3]]);
    // Scaling 2/3 back asks for 4/6, which the full arm cannot hold; 3/7 still fits.
    tonnage.set(100);
    expect(rows()).toEqual([[3, 7]]);
  });

  it('gives location-bound mounts their rows before a split weapon divides its own', () => {
    const gun = registry.equipment['Autocannon/20'];
    const source = ['chassis:Split', 'model:Order', 'Config:Biped', 'techbase:Inner Sphere', 'era:3150', 'rules level:5',
      'mass:100', 'engine:300 Fusion Engine', 'structure:Standard', 'walk mp:3', 'heat sinks:10 Single',
      'Left Arm:', 'Shoulder', 'Upper Arm Actuator', 'Lower Arm Actuator', 'Hand Actuator', ...Array(3).fill(gun.id),
      ...Array(5).fill('LRM 20'), 'Left Torso:', ...Array(7).fill(gun.id)].join('\n');
    const mek = parseEntity(source, 'order.mtf', registry).entity as MekEntity;
    const original = encodeNativeEntity(mek);
    const tonnage = getConstructionFields(mek).find(field => field.id === 'tonnage')!;
    tonnage.set(105);
    tonnage.set(100);
    expect(encodeNativeEntity(mek)).toBe(original);
  });

  it('keeps each donor\'s authored structure rows across a chassis class change (CO p. 213)', () => {
    // Anastasia's Clan Endo Steel head row is authored by its donor; the CO fallback table gives that head none.
    const clan = registry.findEquipment('Clan Endo Steel') as StructureEquipment;
    const source = ['chassis:Authored', 'model:Donor', 'Config:Biped FrankenMek', 'techbase:Mixed (IS Chassis)', 'era:3150',
      'rules level:5', 'mass:50', 'engine:200 Fusion Engine', 'structure:Hybrid', 'HD structure:Clan Endo Steel:50',
      'LA structure:Clan Endo Steel:50', 'RA structure:Clan Endo Steel:50', 'walk mp:4', 'heat sinks:10 Single',
      'Left Arm:', 'Shoulder', 'Upper Arm Actuator', 'Lower Arm Actuator', 'Hand Actuator', 'Clan Endo Steel',
      'Right Arm:', 'Shoulder', 'Upper Arm Actuator', 'Lower Arm Actuator', 'Hand Actuator', 'Clan Endo Steel',
      'Head:', 'Life Support', 'Sensors', 'Cockpit', 'Clan Endo Steel', 'Sensors', 'Life Support'].join('\n');
    const mek = parseEntity(source, 'authored.mtf', registry).entity as MekEntity;
    expect(mek.structureAt('HD').structure.id).toBe(clan.id);
    const original = encodeNativeEntity(mek);
    const rows = () => mek.equipment().filter(mount => mount.equipment?.id === clan.id).flatMap(mount => mount.placements ?? [])
      .map(placement => placement.location).sort();
    expect(rows()).toEqual(['HD', 'LA', 'RA']);
    const tonnage = getConstructionFields(mek).find(field => field.id === 'tonnage')!;
    tonnage.set(105);
    expect(rows()).toEqual(['HD', 'LA', 'RA']);
    tonnage.set(50);
    expect(encodeNativeEntity(mek)).toBe(original);
    expect(validateConstruction(mek).messages.filter(message => ['CRIT_DISTRIBUTION', 'MATERIAL_CRITICALS'].includes(message.code)))
      .toEqual([]);

    // Another location's new donor material leaves those rows alone and takes the table's rows itself (CO p. 212).
    const endo = registry.findEquipment('IS Endo Steel') as StructureEquipment;
    setConstructionStructure(mek, endo, 'LT', 50);
    expect(rows()).toEqual(['HD', 'LA', 'RA']);
    expect(mek.equipment().filter(mount => mount.equipment?.id === endo.id).flatMap(mount => mount.placements ?? [])
      .map(placement => placement.location)).toEqual(['LT', 'LT', 'LT']);
    expect(validateConstruction(mek).messages.filter(message => ['CRIT_DISTRIBUTION', 'MATERIAL_CRITICALS'].includes(message.code)))
      .toEqual([]);
  });

  it('requires the table rows in a location the editor gave a new structure, whatever fit there (CO p. 212)', () => {
    const endo = registry.findEquipment('IS Endo Steel') as StructureEquipment;
    const source = ['chassis:Full torso', 'model:Donor', 'Config:Biped FrankenMek', 'techbase:Inner Sphere', 'era:3150',
      'rules level:5', 'mass:50', 'engine:200 Fusion Engine', 'structure:Standard', 'walk mp:4', 'heat sinks:10 Single',
      'Left Torso:', ...Array(11).fill('Medium Laser')].join('\n');
    const mek = parseEntity(source, 'full.mtf', registry).entity as MekEntity;
    setConstructionStructure(mek, endo, 'LT', 50);
    expect(mek.equipment().filter(mount => mount.equipment?.id === endo.id).flatMap(mount => mount.placements ?? [])
      .map(placement => placement.location)).toEqual(['LT']);
    expect(validateConstruction(mek).messages.filter(message => ['CRIT_DISTRIBUTION', 'MATERIAL_CRITICALS'].includes(message.code))
      .map(message => message.message)).toEqual([
      `${endo.name} requires 3 reserved critical slots; 1 are assigned.`,
      `${endo.name} requires 3 critical slots in LT.`,
    ]);
  });

  it('keeps an unchanged location\'s loaded structure rows through a tech base change and an uninstall (CO p. 213)', () => {
    const clan = registry.findEquipment('Clan Endo Steel') as StructureEquipment;
    const endo = registry.findEquipment('IS Endo Steel') as StructureEquipment;
    const source = ['chassis:Authored', 'model:Donor', 'Config:Biped FrankenMek', 'techbase:Mixed (IS Chassis)', 'era:3150',
      'rules level:5', 'mass:50', 'engine:200 Fusion Engine', 'structure:Hybrid', 'HD structure:Clan Endo Steel:50',
      'LT structure:IS Endo Steel:50', 'walk mp:4', 'heat sinks:10 Single', 'Left Torso:', endo.id, endo.id, endo.id,
      'Head:', 'Life Support', 'Sensors', 'Cockpit', 'Clan Endo Steel', 'Sensors', 'Life Support'].join('\n');
    const mek = parseEntity(source, 'authored.mtf', registry).entity as MekEntity;
    const clanRows = () => mek.equipment().filter(mount => mount.equipment?.id === clan.id)
      .flatMap(mount => mount.placements ?? []).map(placement => placement.location).sort();
    getConstructionFields(mek).find(field => field.id === 'techBase')!.set('Clan');
    // The torso's new Clan Endo Steel takes the table's row; the head keeps the row its donor carries.
    expect(mek.structureAt('LT').structure.id).toBe(clan.id);
    expect(clanRows()).toEqual(['HD', 'LT']);
    expect(validateConstruction(mek).messages.filter(message => ['CRIT_DISTRIBUTION', 'MATERIAL_CRITICALS'].includes(message.code)))
      .toEqual([]);
    // Erasing the head's row leaves its requirement standing.
    const unallocated = uninstallConstructionEquipment(mek, mek.equipment().find(mount => mount.equipment?.id === clan.id)!);
    expect(constructionSpreadAllocation(mek, unallocated)?.locations.find(location => location.id === 'HD')?.required).toBe(1);
  });

  it('accepts the structure rows its donors wrote at either slot scale (CO p. 213)', () => {
    // As on the Schwerer Gustav, each Endo Steel donor location carries the table's rows.
    const endo = registry.findEquipment('IS Endo Steel') as StructureEquipment;
    const arm = ['Shoulder', 'Upper Arm Actuator', 'Lower Arm Actuator', 'Hand Actuator', endo.id, endo.id];
    const source = ['chassis:Donor rows', 'model:Scale', 'Config:Biped FrankenMek', 'techbase:Inner Sphere', 'era:3150',
      'rules level:5', 'mass:100', 'engine:300 Fusion Engine', 'structure:Hybrid', 'LA structure:IS Endo Steel:100',
      'RA structure:IS Endo Steel:100', 'LT structure:IS Endo Steel:100', 'RT structure:IS Endo Steel:100', 'walk mp:3',
      'heat sinks:10 Single', 'Left Arm:', ...arm, 'Right Arm:', ...arm, 'Left Torso:', ...Array(3).fill(endo.id),
      'Right Torso:', ...Array(3).fill(endo.id)].join('\n');
    const mek = parseEntity(source, 'rows.mtf', registry).entity as MekEntity;
    const issues = () => validateConstruction(mek).messages
      .filter(message => ['CRIT_DISTRIBUTION', 'MATERIAL_CRITICALS'].includes(message.code));
    const rows = () => mek.equipment().filter(mount => mount.equipment?.id === endo.id).flatMap(mount => mount.placements ?? []).length;
    expect(issues()).toEqual([]);
    // The superheavy chassis keeps the donors' 2 + 2 + 3 + 3 rows; its halved table only fills a location without any.
    getConstructionFields(mek).find(field => field.id === 'tonnage')!.set(105);
    expect(rows()).toBe(10);
    expect(issues()).toEqual([]);
  });

  it('uses local hybrid and patchwork requirements for partial allocation instead of the uniform slot total', () => {
    const entity = createConstructionEntity('Biped', registry) as MekEntity;
    const endo = registry.findEquipment('IS Endo Steel') as StructureEquipment;
    setConstructionHybridStructure(entity, true);
    setConstructionStructure(entity, endo, 'RA', 55);
    const endoMount = uninstallConstructionEquipment(entity, entity.equipment().find(mount => mount.equipmentId === endo.id)!);
    const hybrid = constructionSpreadAllocation(entity, endoMount)!;
    expect(hybrid.total).toBe(2);
    expect(hybrid.remaining).toBe(2);
    expect(hybrid.locations.filter(location => location.limit).map(location => location.id)).toEqual(['RA']);
    expect(() => setConstructionSpreadSlots(entity, endoMount, 'LA', 1)).toThrow();
    // The editor's own row is no donor's: the arm it gave Endo Steel takes the table's two (CO p. 212). A loaded design's
    // row is its donor's, and the table only fills an arm without any (CO p. 213).
    const partialEndo = setConstructionSpreadSlots(entity, endoMount, 'RA', 1);
    expect(constructionSpreadAllocation(entity, partialEndo)?.remaining).toBe(1);
    const loaded = reload(entity) as MekEntity;
    expect(constructionSpreadAllocation(loaded, loaded.equipment().find(mount => mount.equipmentId === endo.id)!)?.remaining).toBe(0);

    const ferro = getConstructionArmorOptions(entity).find(armor => armor.armorType === 'FERRO_FIBROUS' && armor.techBase !== 'Clan')!;
    setConstructionPatchwork(entity, true);
    setConstructionArmorMaterial(entity, ferro, 'LT');
    const ferroMount = uninstallConstructionEquipment(entity, entity.equipment().find(mount => mount.equipmentId === ferro.id)!);
    const patchwork = constructionSpreadAllocation(entity, ferroMount)!;
    expect(patchwork.total).toBe(ferro.patchworkSlotsMekSV);
    expect(patchwork.locations.filter(location => location.limit).map(location => location.id)).toEqual(['LT']);
    const plan = constructionSpreadAutoPlacements(entity, ferroMount);
    expect(plan.every(placement => placement.location === 'LT')).toBeTrue();
    expect(plan.length).toBe(ferro.patchworkSlotsMekSV);
  });

  it('rejects a Stealth block transfer into an already fulfilled location without changing any assignments', () => {
    const entity = createConstructionEntity('Biped', registry) as MekEntity;
    const stealth = getConstructionArmorOptions(entity).find(armor => armor.armorType === 'STEALTH')!;
    // Leave capacity for both required leg shares.
    for (const sink of entity.equipment().filter(mount => mount.allocation.kind !== 'engine')) entity.removeEquipment(sink);
    setConstructionArmorMaterial(entity, stealth);
    const mount = entity.equipment().find(mount => mount.equipmentId === stealth.id)!;
    const source = encodeNativeEntity(entity);
    expect(() => constructionSpreadMovePlacements(entity, mount, 'LT', 'RT')).toThrowError(/0 more/);
    expect(() => setConstructionSpreadSlots(entity, mount, 'RT', 3)).toThrow();
    expect(encodeNativeEntity(entity)).toBe(source);
    const partial = applyConstructionSpreadPlacements(entity, mount, constructionSpreadMovePlacements(entity, mount, 'LT', undefined));
    expect(constructionSpreadAllocation(entity, partial)?.remaining).toBe(2);
    expect(() => constructionSpreadMovePlacements(entity, partial, undefined, 'HD')).toThrowError(/cannot allocate/);
    const restored = applyConstructionSpreadPlacements(entity, partial, constructionSpreadAutoPlacements(entity, partial));
    expect(constructionSpreadAllocation(entity, restored)?.remaining).toBe(0);
    expect(validateConstruction(entity).messages.filter(message => ['MATERIAL_CRITICALS', 'CRIT_DISTRIBUTION'].includes(message.code))).toEqual([]);
  });

  it('rejects location-specific materials for native uniform-only craft', () => {
    const entity = createConstructionEntity('SmallCraft', registry);
    expect(constructionSupportsPatchwork(entity)).toBeFalse();
    expect(() => setConstructionArmorMaterial(entity, entity.armorAt('Nose').armor, 'Nose')).toThrowError(/uniform armor/);
  });

  it('reserves Patchwork armor criticals locally even while every material matches', () => {
    const entity = createConstructionEntity('Biped', registry);
    entity.mixedTech.set(true);
    const ferro = getConstructionArmorOptions(entity).find(armor => armor.armorType === 'FERRO_FIBROUS' && armor.techBase === 'Clan')!;
    setConstructionArmorMaterial(entity, ferro);
    setConstructionPatchwork(entity, true);
    const mount = entity.equipment().find(mount => mount.equipmentId === ferro.id)!;
    for (const location of entity.locationOrder) {
      expect(mount.placements?.filter(placement => placement.location === location).length).withContext(location).toBe(ferro.patchworkSlotsMekSV);
    }
    expect(reload(entity).hasPatchworkArmor()).toBeTrue();
  });

  it('swaps Standard and Heavy Industrial armor with the IndustrialMek chassis and on load', () => {
    const entity = createConstructionEntity('Biped', registry) as MekEntity;
    expect(entity.uniformArmor()?.type).toBe('STANDARD');
    setConstructionStructure(entity, registry.equipment['Industrial'] as StructureEquipment);
    expect(entity.uniformArmor()?.type).toBe('HEAVY_INDUSTRIAL');
    expect(getConstructionArmorOptions(entity).some(armor => armor.armorType === 'STANDARD')).toBeFalse();

    const native = encodeNativeEntity(entity);
    expect(native).toMatch(/\narmor:Heavy Industrial\([^)]+\)\n/);
    const legacy = native.replace(/armor:Heavy Industrial\(/, 'armor:Standard(');
    expect(parseEntity(legacy, 'industrial.mtf', registry).entity.uniformArmor()?.type).toBe('HEAVY_INDUSTRIAL');

    setConstructionStructure(entity, registry.equipment['Standard'] as StructureEquipment);
    expect(entity.uniformArmor()?.type).toBe('STANDARD');
  });

  it('keeps Heavy Industrial armor on a BattleMek when it loads', () => {
    const entity = createConstructionEntity('Biped', registry);
    setConstructionArmorMaterial(entity, registry.equipment['IS Heavy Industrial'] as ArmorEquipment);
    expect(reload(entity).uniformArmor()?.type).toBe('HEAVY_INDUSTRIAL');
  });

  for (const kind of CONSTRUCTION_UNIT_TYPES) {
    it(`starts a new ${kind.label} as a valid design`, () => {
      const errors = validateConstruction(createConstructionEntity(kind.id, registry)).messages
        .filter(message => message.severity === 'error').map(message => message.code);
      expect(errors).toEqual([]);
    });
  }

  it('requires advanced rules for non-BAR armor on a support vehicle', () => {
    const entity = createConstructionEntity('SupportTank', registry);
    expect(entity.staticTechLevel()).toBe('Standard');
    entity.setUniformArmor(new MountedArmor({ armor: registry.equipment['IS Ferro-Fibrous'] as ArmorEquipment }));
    expect(entity.staticTechLevel()).toBe('Advanced');
  });
});
