// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ArmorEquipment, StructureEquipment } from '../../models/equipment.model';
import type { EquipmentRegistry } from '../../models/equipment-lookup';
import { buildEquipmentRegistry } from '../../services/catalogs/equipment-catalog-builder';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import { FixedWingSupportEntity, MekEntity } from '../../models/entity/entities';
import { calculateMekStructureWeight } from '../../models/entity/utils/weight/mek-weight';
import { calculateBattleValueDetails } from '../../models/entity/utils/battle-value';
import { alphaStrikeArmor } from '../../models/entity/utils/alpha-strike/foundation/integrity';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { createConstructionEntity } from './construction-factory';
import { constructionSupportsPatchwork, getConstructionArmorOptions, setConstructionArmorMaterial, setConstructionHybridStructure, setConstructionPatchwork, setConstructionStructure, validateConstruction } from './construction-rules';
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
    const halfEndo = setConstructionSpreadSlots(entity, endoMount, 'RA', 1);
    expect(constructionSpreadAllocation(entity, halfEndo)?.remaining).toBe(1);
    const loaded = reload(entity) as MekEntity;
    expect(constructionSpreadAllocation(loaded, loaded.equipment().find(mount => mount.equipmentId === endo.id)!)?.remaining).toBe(1);

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
});
