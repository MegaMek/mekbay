// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { AmmoEquipment, ArmorEquipment, MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import { MekEntity, ProtoMekEntity } from '../../models/entity/entities';
import { CONSTRUCTION_UNIT_TYPES, createConstructionEntity, getConstructionMass } from './construction-factory';
import { getConstructionFields } from './construction-fields';
import { planConstructionEquipmentInsertion, allocationPlacements, removeConstructionEquipment, reorderConstructionEquipment, splitConstructionEquipment, constructionEquipmentApplies, equipmentPlacementIssues, getConstructionLocations, getConstructionStructureOptions, installConstructionEquipment, moveConstructionEquipment, resizeConstructionEquipment, setConstructionArmorMaterial, setConstructionStructure, validateConstruction } from './construction-rules';
import { buildEquipmentRegistry } from '../../services/catalogs/equipment-catalog-builder';
import type { EquipmentRegistry } from '../../models/equipment-lookup';
import { HUNCHBACK_SOURCE } from './hunchback-fixture';

const standardTech = { base: 'All', level: 'Standard', advancement: { is: { common: '2500' }, clan: { common: '2500' } } } as const;
const laser = new WeaponEquipment({ id: 'Test Medium Laser', name: 'Test Medium Laser', type: 'weapon', tech: standardTech,
  flags: ['F_MEK_WEAPON', 'F_TANK_WEAPON', 'F_AERO_WEAPON', 'F_ENERGY'],
  stats: { tonnage: 1, criticalSlots: 1 }, weapon: { damage: 5, heat: 3 } });
const heavyGun = new WeaponEquipment({ id: 'Test Heavy Gun', name: 'Test Heavy Gun', type: 'weapon', tech: standardTech,
  flags: ['F_MEK_WEAPON', 'F_TANK_WEAPON'], stats: { tonnage: 14, criticalSlots: 10 } });
const jumpJet = new MiscEquipment({ id: 'Test Jump Jet', name: 'Test Jump Jet', type: 'misc', tech: standardTech,
  flags: ['F_MEK_EQUIPMENT', 'F_JUMP_JET'], stats: { tonnage: 0.5, criticalSlots: 1 } });
const ammo = new AmmoEquipment({ id: 'Test Ammo', name: 'Test Ammo', type: 'ammo', tech: standardTech,
  stats: { tonnage: 1 }, ammo: { type: 'AC', shots: 20, rackSize: 5, munitionType: ['M_STANDARD'] } });
const autocannon = new WeaponEquipment({ id: 'Test AC5', name: 'Test AC5', type: 'weapon', tech: standardTech,
  flags: ['F_MEK_WEAPON', 'F_TANK_WEAPON', 'F_AERO_WEAPON'], stats: { tonnage: 8, criticalSlots: 4 },
  weapon: { ammoType: 'AC', rackSize: 5 } });
const registry = createTestEquipmentRegistry(Object.fromEntries([laser, heavyGun, jumpJet, ammo, autocannon].map(eq => [eq.id, eq])));

describe('unit construction domain', () => {
  for (const kind of CONSTRUCTION_UNIT_TYPES) {
    it(`creates, exposes inputs and round-trips ${kind.label}`, () => {
      const entity = createConstructionEntity(kind.id, registry);
      const source = encodeNativeEntity(entity);
      const loaded = parseEntity(source, entity instanceof MekEntity ? 'custom.mtf' : 'custom.blk', registry).entity;
      expect(loaded.entityType).toBe(entity.entityType);
      expect(loaded.chassis()).toBe(entity.chassis());
      expect(getConstructionFields(entity).length).toBeGreaterThan(5);
      expect(getConstructionLocations(entity).length).toBeGreaterThan(0);
      expect(() => getConstructionMass(entity)).not.toThrow();
      expect(() => validateConstruction(entity)).not.toThrow();
    });
  }

  for (const kind of ['Aero', 'ConvFighter', 'FixedWingSupport', 'BuildingEntity'] as const) {
    it(`keeps ${kind} internal maxima identical to its saved native design`, () => {
      const entity = createConstructionEntity(kind, registry);
      const reload = () => parseEntity(encodeNativeEntity(entity), 'custom.blk', registry).entity;
      expect([...reload().structureValues()]).toEqual([...entity.structureValues()]);
      getConstructionFields(entity).find(field => field.id === 'year')!.set(3150);
      expect([...reload().structureValues()]).toEqual([...entity.structureValues()]);
    });
  }

  it('distinguishes platform weapon flags from miscellaneous-equipment flags', () => {
    const mek = createConstructionEntity('Biped', registry);
    expect(constructionEquipmentApplies(mek, laser)).toBeTrue();
    expect(constructionEquipmentApplies(createConstructionEntity('BattleArmor', registry), laser)).toBeFalse();
    expect(constructionEquipmentApplies(createConstructionEntity('Aero', registry), jumpJet)).toBeFalse();
  });

  it('enforces torso/leg jump-jet placement and physical head/leg slot limits', () => {
    const mek = createConstructionEntity('Biped', registry);
    expect(equipmentPlacementIssues(mek, jumpJet, 'RA')).toContain('Jump jets require a torso or leg.');
    expect(equipmentPlacementIssues(mek, jumpJet, 'RT')).toEqual([]);
    expect(getConstructionLocations(mek).find(loc => loc.id === 'HD')?.slots.length).toBe(6);
    expect(getConstructionLocations(mek).find(loc => loc.id === 'RL')?.slots.length).toBe(6);
  });

  it('preserves mount identity and snaps to the first available slot regardless of the drop slot', () => {
    const mek = createConstructionEntity('Biped', registry);
    const mount = installConstructionEquipment(mek, laser, 'RA', 4);
    const moved = moveConstructionEquipment(mek, mount, 'LT', 0);
    expect(moved.mountId).toBe(mount.mountId);
    expect(moved.placements).toEqual([{ location: 'LT', slotIndex: 0 }]);
    const second = installConstructionEquipment(mek, laser, 'LT', 10);
    expect(second.placements).toEqual([{ location: 'LT', slotIndex: 1 }]);
    expect(mek.equipment().filter(item => item.equipment === laser).length).toBe(2);
  });

  it('does not treat fragmented free slots as a contiguous equipment block', () => {
    const mek = createConstructionEntity('Biped', registry) as MekEntity;
    for (const slotIndex of [1, 3, 5, 7, 9, 11]) {
      mek.addEquipment({ equipmentId: laser.id, equipment: laser,
        allocation: { kind: 'location', location: 'LT', placements: [{ location: 'LT', slotIndex }] },
        rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false });
    }
    expect(() => installConstructionEquipment(mek, autocannon, 'LT')).toThrowError(/contiguous/);
    const spread = new MiscEquipment({ id: 'Spread', name: 'Spread', type: 'misc', tech: standardTech,
      flags: ['F_MEK_EQUIPMENT'], stats: { criticalSlots: 4, spreadable: true } });
    expect(installConstructionEquipment(mek, spread, 'LT').placements?.map(p => p.slotIndex)).toEqual([0, 2, 4, 6]);
  });

  it('previews and installs exactly two contiguous blocks when a large gun needs a split', () => {
    const mek = createConstructionEntity('Biped', registry) as MekEntity;
    const plan = allocationPlacements(mek, heavyGun, 'RA', 10);
    const gun = installConstructionEquipment(mek, heavyGun, 'RA', 10);
    expect(gun.placements).toEqual(plan);
    expect(gun.placements?.filter(p => p.location === 'RA').map(p => p.slotIndex)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(gun.placements?.filter(p => p.location === 'RT').map(p => p.slotIndex)).toEqual([0, 1]);
    expect(new Set(gun.placements?.map(p => p.location)).size).toBe(2);
    expect(() => installConstructionEquipment(mek, heavyGun, 'RL')).toThrowError(/contiguous/);
  });

  it('plans incoming equipment before installed blocks without moving the fixed system slots', () => {
    const mek = createConstructionEntity('Biped', registry) as MekEntity;
    const first = installConstructionEquipment(mek, laser, 'RA');
    const second = installConstructionEquipment(mek, laser, 'RA');
    const before = encodeNativeEntity(mek);
    const placements = allocationPlacements(mek, laser, 'RA')!;
    const preview = planConstructionEquipmentInsertion(mek, laser, 'RA', placements, undefined, first.mountId);
    expect(preview.arrangement.get(preview.mountId)).toEqual([{ location: 'RA', slotIndex: 4 }]);
    expect(preview.arrangement.get(first.mountId)).toEqual([{ location: 'RA', slotIndex: 5 }]);
    expect(preview.arrangement.get(second.mountId)).toEqual([{ location: 'RA', slotIndex: 6 }]);
    expect(encodeNativeEntity(mek)).toBe(before);
    const installed = installConstructionEquipment(mek, laser, 'RA');
    reorderConstructionEquipment(mek, 'RA', installed.mountId, first.mountId);
    expect(mek.equipment().find(m => m.mountId === installed.mountId)!.placements).toEqual(preview.arrangement.get(preview.mountId));
    expect(mek.criticalSlotGrid().get('RA')!.slice(0, 4).every(slot => slot.type === 'system')).toBeTrue();
  });

  it('edits split counts, retains mount identity and rejects impossible splits atomically', () => {
    const mek = createConstructionEntity('Biped', registry) as MekEntity;
    const gun = installConstructionEquipment(mek, heavyGun, 'RA');
    const split = splitConstructionEquipment(mek, gun, 'RA', 2, 'RT');
    expect(split.mountId).toBe(gun.mountId);
    expect(split.placements?.filter(p => p.location === 'RA').map(p => p.slotIndex)).toEqual([4, 5]);
    expect(split.placements?.filter(p => p.location === 'RT').map(p => p.slotIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(() => splitConstructionEquipment(mek, split, 'RA', 9, 'RT')).toThrowError(/contiguous/);
    expect(() => splitConstructionEquipment(mek, split, 'RA', 2, 'LT')).toThrowError(/adjacent/);
    expect(mek.equipment().find(m => m.mountId === gun.mountId)?.placements).toEqual(split.placements);
    const loaded = parseEntity(encodeNativeEntity(mek), 'split.mtf', registry).entity;
    const loadedGun = loaded.equipment().find(mount => mount.equipmentId === heavyGun.id)!;
    expect(loadedGun.placements?.filter(p => p.location === 'RA').length).toBe(2);
    expect(loadedGun.placements?.filter(p => p.location === 'RT').length).toBe(8);
  });

  it('sorts whole blocks around fixed systems and compacts after removal', () => {
    const mek = createConstructionEntity('Biped', registry) as MekEntity;
    const first = installConstructionEquipment(mek, laser, 'RA');
    const second = installConstructionEquipment(mek, autocannon, 'RA');
    const systems = mek.getSystemSlotsForLocation('RA').slice(0, 4);
    reorderConstructionEquipment(mek, 'RA', second.mountId, first.mountId);
    expect(mek.equipment().find(m => m.mountId === second.mountId)?.placements?.map(p => p.slotIndex)).toEqual([4, 5, 6, 7]);
    expect(mek.equipment().find(m => m.mountId === first.mountId)?.placements?.map(p => p.slotIndex)).toEqual([8]);
    removeConstructionEquipment(mek, second);
    expect(mek.equipment().find(m => m.mountId === first.mountId)?.placements?.map(p => p.slotIndex)).toEqual([4]);
    expect(mek.getSystemSlotsForLocation('RA').slice(0, 4)).toEqual(systems);
  });

  it('stores vehicle ammunition in body and fighter ammunition in fuselage', () => {
    const tank = createConstructionEntity('Tank', registry);
    installConstructionEquipment(tank, autocannon, 'Front');
    expect(equipmentPlacementIssues(tank, ammo, 'Front')).toContain('Requires the vehicle body.');
    expect(equipmentPlacementIssues(tank, ammo, 'Body')).toEqual([]);
    const fighter = createConstructionEntity('Aero', registry);
    installConstructionEquipment(fighter, autocannon, 'Nose');
    expect(equipmentPlacementIssues(fighter, ammo, 'Fuselage')).toEqual([]);
  });

  it('mounts conventional infantry field guns and their ammunition only in Field Guns', () => {
    const infantry = createConstructionEntity('Infantry', registry);
    expect(constructionEquipmentApplies(infantry, laser)).toBeFalse();
    expect(() => installConstructionEquipment(infantry, autocannon, 'Infantry')).toThrowError(/Field Guns/);
    installConstructionEquipment(infantry, autocannon, 'Field Guns');
    expect(equipmentPlacementIssues(infantry, ammo, 'Field Guns')).toEqual([]);
    const loaded = parseEntity(encodeNativeEntity(infantry), 'fieldgun.blk', registry).entity;
    expect(loaded.equipment().some(mount => mount.equipmentId === autocannon.id && mount.location === 'Field Guns')).toBeTrue();
  });

  it('distinguishes ProtoMek body equipment from per-location weapon capacity', () => {
    const proto = createConstructionEntity('ProtoMek', registry) as ProtoMekEntity;
    expect(getConstructionLocations(proto).find(loc => loc.id === 'Torso')?.slotCapacity).toBe(2);
    proto.isQuad.set(true);
    expect(getConstructionLocations(proto).find(loc => loc.id === 'Torso')?.slotCapacity).toBe(4);
    expect(getConstructionLocations(proto).find(loc => loc.id === 'Left Arm')?.slotCapacity).toBe(0);
  });

  it('keeps changed identity and settings on the detached native design', () => {
    const original = createConstructionEntity('Biped', registry);
    const copy = parseEntity(encodeNativeEntity(original), 'copy.mtf', registry).entity;
    getConstructionFields(copy).find(field => field.id === 'chassis')!.set('Independent');
    getConstructionFields(copy).find(field => field.id === 'tonnage')!.set(75);
    expect(original.chassis()).toBe('New Design');
    expect(original.tonnage()).toBe(50);
    expect(copy.chassis()).toBe('Independent');
    expect(copy.tonnage()).toBe(75);
  });

  it('rejects fractional discrete inputs and hidden conventional turret mass overrides', () => {
    const tank = createConstructionEntity('Tank', registry);
    expect(() => getConstructionFields(tank).find(field => field.id === 'year')!.set(3151.5)).toThrowError(/whole number/);
    getConstructionFields(tank).find(field => field.id === 'turret')!.set(true);
    expect(getConstructionFields(tank).some(field => field.id === 'baseTurretMass')).toBeFalse();
    tank.omni.set(true);
    expect(() => getConstructionFields(tank).find(field => field.id === 'baseTurretMass')!.set(-0.5)).toThrowError(/automatic/);
  });

  it('reallocates size changes atomically and retains the original on capacity failure', () => {
    const cargo = new MiscEquipment({ id: 'Resizable Cargo', name: 'Resizable Cargo', type: 'misc', tech: standardTech,
      flags: ['F_MEK_EQUIPMENT', 'F_CARGO'], stats: { tonnage: 'variable', criticalSlots: 'variable' } });
    const mek = createConstructionEntity('Biped', registry);
    const mount = installConstructionEquipment(mek, cargo, 'RT');
    const resized = resizeConstructionEquipment(mek, mount, 3);
    expect(resized.mountId).toBe(mount.mountId);
    expect(resized.placements?.length).toBe(3);
    expect(() => resizeConstructionEquipment(mek, resized, 100)).toThrowError(/free critical/);
    expect(mek.equipment().find(item => item.mountId === mount.mountId)?.size).toBe(3);
  });

  it('distributes a partial wing equally across the side torsos', () => {
    const wing = new MiscEquipment({ id: 'Test Partial Wing', name: 'Test Partial Wing', type: 'misc', tech: standardTech,
      flags: ['F_MEK_EQUIPMENT', 'F_PARTIAL_WING'], stats: { tonnage: 3, criticalSlots: 8, spreadable: true } });
    const mek = createConstructionEntity('Biped', registry);
    expect(() => installConstructionEquipment(mek, wing, 'RA')).toThrowError(/prescribed/);
    const mount = installConstructionEquipment(mek, wing, 'RT');
    expect(mount.placements?.filter(placement => placement.location === 'LT').length).toBe(4);
    expect(mount.placements?.filter(placement => placement.location === 'RT').length).toBe(4);
  });

  it('maps stealth reservations to all four canonical quad legs and both side torsos', () => {
    const stealth = new ArmorEquipment({ id: 'Test Stealth', name: 'Test Stealth', type: 'armor', tech: standardTech,
      flags: ['F_MEK_EQUIPMENT', 'F_STEALTH'], stats: { criticalSlots: 12, spreadable: true }, armor: { type: 'STEALTH' } });
    const mek = createConstructionEntity('Quad', createTestEquipmentRegistry({ [stealth.id]: stealth }));
    setConstructionArmorMaterial(mek, stealth);
    const mount = mek.equipment().find(item => item.equipmentId === stealth.id)!;
    for (const location of ['FLL', 'FRL', 'RLL', 'RRL', 'LT', 'RT']) expect(mount.placements?.filter(placement => placement.location === location).length).toBe(2);
  });

  it('uses the source infantry introduction-date exception while retaining rules-level restrictions', () => {
    const infantry = createConstructionEntity('Infantry', registry);
    infantry.year.set(2000);
    expect(equipmentPlacementIssues(infantry, autocannon, 'Field Guns')).toEqual([]);
    infantry.rulesLevel.set(1);
    expect(equipmentPlacementIssues(infantry, autocannon, 'Field Guns')).toContain('Exceeds the selected rules level.');
  });
});

describe('construction with the production equipment catalog', () => {
  let equipment: EquipmentRegistry;
  beforeAll(async () => {
    const response = await fetch('/online-assets/static/equipment.json');
    equipment = buildEquipmentRegistry(await response.json());
  });

  it('accepts a stock Hunchback HBK-4G including its external single heat sinks', () => {
    const entity = parseEntity(HUNCHBACK_SOURCE, 'hunchback.mtf', equipment).entity;
    const result = validateConstruction(entity);
    expect(result.messages.filter(message => message.severity === 'error')).toEqual([]);
  });

  it('creates a default Mek with all ten heat sinks allocated and no construction errors', () => {
    const entity = createConstructionEntity('Biped', equipment);
    expect(entity.equipment().every(mount => mount.allocation.kind !== 'unallocated')).toBeTrue();
    expect(validateConstruction(entity).messages.filter(message => message.severity === 'error')).toEqual([]);
  });

  it('rejects synthetic bay weapons and bomb representations for Meks', () => {
    const entity = createConstructionEntity('Biped', equipment);
    expect(constructionEquipmentApplies(entity, equipment.equipment['BombArrowIV'])).toBeFalse();
    expect(constructionEquipmentApplies(entity, equipment.equipment['AMS Bay'])).toBeFalse();
  });

  it('allocates all Endo Steel reservations across the chassis and preserves them through MTF', () => {
    const entity = createConstructionEntity('Biped', equipment);
    const structure = getConstructionStructureOptions(entity).find(item => item.id === 'IS Endo Steel')!;
    setConstructionStructure(entity, structure);
    const reservation = entity.equipment().find(mount => mount.equipmentId === structure.id)!;
    expect(reservation.placements?.length).toBe(14);
    expect(new Set(reservation.placements?.map(placement => placement.location)).size).toBeGreaterThan(1);
    const loaded = parseEntity(encodeNativeEntity(entity), 'endo.mtf', equipment).entity;
    expect(loaded.equipment().find(mount => mount.equipmentId === structure.id)?.placements?.length).toBe(14);
    entity.removeEquipment(reservation);
    expect(validateConstruction(entity).messages.some(message => message.code === 'MATERIAL_CRITICALS')).toBeTrue();
  });

  it('splits a 15-slot Arrow IV mount into adjacent locations and preserves one mount identity', () => {
    const entity = createConstructionEntity('Biped', equipment);
    entity.rulesLevel.set(3);
    const arrow = Object.values(equipment.equipment).find(eq => eq instanceof WeaponEquipment && eq.ammoType === 'ARROW_IV' && eq.critSlots === 15 && eq.techBase === 'IS' && !eq.hasFlag('F_BOMB_WEAPON'))!;
    const mount = installConstructionEquipment(entity, arrow, 'RT');
    expect(mount.placements?.length).toBe(15);
    expect(new Set(mount.placements?.map(placement => placement.location)).size).toBe(2);
    expect(entity.equipment().filter(item => item.mountId === mount.mountId).length).toBe(1);
    const loaded = parseEntity(encodeNativeEntity(entity), 'arrow.mtf', equipment).entity;
    expect(loaded.equipment().find(item => item.equipmentId === arrow.id)?.placements?.length).toBe(15);
  });

  it('makes Myomer selection install and remove its real critical-slot system through MTF', () => {
    const entity = createConstructionEntity('Biped', equipment) as MekEntity;
    const control = getConstructionFields(entity).find(field => field.id === 'myomer')!;
    const existing = entity.equipment().map(mount => mount.mountId);
    control.set('Triple Strength');
    const myomer = entity.equipment().find(mount => mount.equipment?.hasFlag('F_TSM'))!;
    expect(myomer).toBeDefined();
    expect(myomer.equipment?.hasFlag('F_PROTOTYPE')).toBeFalse();
    expect(myomer.placements?.length).toBe(6);
    const loaded = parseEntity(encodeNativeEntity(entity), 'myomer.mtf', equipment).entity as MekEntity;
    expect(loaded.myomerType()).toBe('Triple Strength');
    expect(loaded.equipment().find(mount => mount.equipment?.hasFlag('F_TSM'))?.placements?.length).toBe(6);
    control.set('Standard');
    expect(entity.equipment().some(mount => mount.equipment?.hasFlag('F_TSM'))).toBeFalse();
    expect(entity.equipment().map(mount => mount.mountId)).toEqual(existing);
  });

  it('allocates a ram plate to one critical slot in every torso', () => {
    const entity = createConstructionEntity('Quad', equipment);
    entity.rulesLevel.set(4);
    const ramPlate = Object.values(equipment.equipment).find(eq => eq.hasFlag('F_RAM_PLATE'))!;
    const mount = installConstructionEquipment(entity, ramPlate, 'RT');
    expect(mount.placements?.map(placement => placement.location).sort()).toEqual(['CT', 'LT', 'RT']);
  });
});
