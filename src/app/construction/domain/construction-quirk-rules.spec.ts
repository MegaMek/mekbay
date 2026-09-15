// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { MountedEngine } from '../../models/entity/components';
import { WeaponEquipment } from '../../models/equipment.model';
import { MekWithArmsEntity } from '../../models/entity/entities/mek/mek-entity';
import type { BaseEntity } from '../../models/entity/base-entity';
import { createConstructionEntity } from './construction-factory';
import { unitQuirkApplies } from '../../models/entity/utils/unit-quirks';
import { validateConstruction } from './construction-rules';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { weaponQuirkAddress } from '../../models/entity/utils/weapon-quirks';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import { convertEntityToAlphaStrike } from '../../models/entity/utils/alpha-strike/alpha-strike-converter';

const registry = createTestEquipmentRegistry({});
const addQuirk = (entity: BaseEntity, key: string) =>
  entity.quirks.update((items) => [...items, { quirk: { key, name: key, description: '', type: 'positive' } }]);

describe('source-based unit quirk legality', () => {
  it('allows battle armor Fast Reload per the Campaign Operations quirk table', () => {
    const entity = createConstructionEntity('BattleArmor', registry);
    addQuirk(entity, 'fast_reload');
    expect(entity.applicableQuirks()).toEqual(entity.quirks());
    addQuirk(entity, 'distracting');
    expect(unitQuirkApplies(entity, 'distracting')).toBeFalse();
    expect(entity.applicableQuirks().map((entry) => entry.quirk.key)).toEqual(['fast_reload']);
  });
  it('checks fist requirements independently for each arm and excludes quads', () => {
    const entity = createConstructionEntity('Biped', registry) as MekWithArmsEntity;
    expect(unitQuirkApplies(entity, 'battle_fists_la')).toBeTrue();
    expect(unitQuirkApplies(entity, 'barrel_fists_la')).toBeFalse();
    entity.hasHandActuator.update((hands) => ({ ...hands, left: false }));
    expect(unitQuirkApplies(entity, 'battle_fists_la')).toBeFalse();
    expect(unitQuirkApplies(entity, 'battle_fists_ra')).toBeTrue();
    expect(unitQuirkApplies(entity, 'barrel_fists_la')).toBeTrue();
    entity.hasLowerArmActuator.update((arms) => ({ ...arms, left: false }));
    expect(unitQuirkApplies(entity, 'barrel_fists_la')).toBeFalse();
    expect(unitQuirkApplies(createConstructionEntity('Quad', registry), 'battle_fists_la')).toBeFalse();
  });

  it('requires arm direct-fire weapons for overhead arms, except on OmniMeks', () => {
    const entity = createConstructionEntity('Biped', registry);
    const laser = new WeaponEquipment({ id: 'Arm Laser', name: 'Arm Laser', type: 'weapon', flags: ['F_DIRECT_FIRE'] });
    expect(unitQuirkApplies(entity, 'overhead_arms')).toBeFalse();
    const mount = entity.addEquipment({
      equipmentId: laser.id,
      equipment: laser,
      allocation: { kind: 'location', location: 'RA' },
      rearMounted: false,
      turretMounted: false,
      omniPodMounted: false,
      armored: false,
    });
    expect(unitQuirkApplies(entity, 'overhead_arms')).toBeTrue();
    entity.removeEquipment(mount);
    entity.omni.set(true);
    expect(unitQuirkApplies(entity, 'overhead_arms')).toBeTrue();
    const quad = createConstructionEntity('QuadVee', registry);
    quad.omni.set(true);
    expect(unitQuirkApplies(quad, 'overhead_arms')).toBeFalse();
    expect(unitQuirkApplies(quad, 'directional_torso_mount_360')).toBeTrue();
  });

  it('enforces symmetric targeting and arm-configuration exclusions', () => {
    const entity = createConstructionEntity('Biped', registry);
    addQuirk(entity, 'variable_range_targeting');
    addQuirk(entity, 'imp_target_long');
    addQuirk(entity, 'overhead_arms');
    addQuirk(entity, 'low_arms');
    expect(entity.applicableQuirks()).toEqual([]);
    expect(unitQuirkApplies(entity, 'imp_target_short')).toBeFalse();
  });

  it('uses actual Mek tonnage for compact and oversized quirks', () => {
    const entity = createConstructionEntity('Biped', registry);
    entity.setTonnage(55);
    expect(unitQuirkApplies(entity, 'compact_mech')).toBeTrue();
    expect(unitQuirkApplies(entity, 'oversized')).toBeFalse();
    entity.setTonnage(60);
    expect(unitQuirkApplies(entity, 'compact_mech')).toBeFalse();
    expect(unitQuirkApplies(entity, 'oversized')).toBeTrue();
  });

  it('distinguishes support vehicles, motive systems, fuel and lightweight scout bikes', () => {
    const tank = createConstructionEntity('Tank', registry);
    expect(unitQuirkApplies(tank, 'power_reverse')).toBeTrue();
    expect(unitQuirkApplies(createConstructionEntity('SupportTank', registry), 'power_reverse')).toBeFalse();
    tank.motiveType.set('Hover');
    tank.setTonnage(10);
    expect(unitQuirkApplies(tank, 'scout_bike')).toBeTrue();
    expect(unitQuirkApplies(tank, 'trailer_hitch')).toBeFalse();
    tank.setTonnage(15);
    expect(unitQuirkApplies(tank, 'scout_bike')).toBeFalse();
    tank.mountedEngine.set(new MountedEngine({ type: 'Fuel Cell', rating: 50, techBase: 'IS', installed: true }));
    expect(unitQuirkApplies(tank, 'gas_hog')).toBeTrue();
    expect(unitQuirkApplies(tank, 'fragile_fuel')).toBeFalse();
    expect(unitQuirkApplies(createConstructionEntity('SupportVTOL', registry), 'vtol_rotor_dual')).toBeTrue();
  });

  it('grants vehicles the Campaign Operations quirks MegaMek omits', () => {
    const tank = createConstructionEntity('Tank', registry);
    tank.setTonnage(60);
    expect(unitQuirkApplies(tank, 'oversized')).toBeTrue();
    expect(unitQuirkApplies(tank, 'rugged_2')).toBeTrue();
    expect(unitQuirkApplies(tank, 'rumble_seat')).toBeTrue();
    expect(unitQuirkApplies(tank, 'ramshackle')).toBeTrue();
    tank.setTonnage(55);
    expect(unitQuirkApplies(tank, 'oversized')).toBeFalse();

    const support = createConstructionEntity('SupportTank', registry);
    support.motiveType.set('Hover');
    support.setTonnage(10);
    expect(unitQuirkApplies(support, 'scout_bike')).toBeFalse();
    expect(unitQuirkApplies(support, 'searchlight')).toBeFalse();
    expect(unitQuirkApplies(support, 'rugged_1')).toBeTrue();
  });

  it('applies the source Aero allowance before ship-specific exceptions', () => {
    const warship = createConstructionEntity('WarShip', registry);
    expect(unitQuirkApplies(warship, 'atmo_flyer')).toBeTrue();
    expect(unitQuirkApplies(warship, 'docking_arms')).toBeFalse();
    expect(unitQuirkApplies(createConstructionEntity('JumpShip', registry), 'docking_arms')).toBeTrue();
    expect(unitQuirkApplies(createConstructionEntity('DropShip', registry), 'large_dropper')).toBeTrue();
    expect(unitQuirkApplies(createConstructionEntity('Aero', registry), 'fast_reload')).toBeTrue();
    expect(unitQuirkApplies(warship, 'fast_reload')).toBeFalse();
  });

  it('checks armor suits, ProtoMeks and infantry by their exact family lists', () => {
    for (const kind of ['BattleArmor', 'ProtoMek'] as const) {
      const entity = createConstructionEntity(kind, registry);
      expect(unitQuirkApplies(entity, 'rugged_2')).toBeTrue();
      expect(unitQuirkApplies(entity, 'no_eject')).toBeFalse();
    }
    expect(unitQuirkApplies(createConstructionEntity('Infantry', registry), 'easy_maintain')).toBeFalse();
  });
});

describe('quirk suppression', () => {
  it('preserves unknown chassis keys and values in MTF and BLK without applying them', () => {
    for (const kind of ['Biped', 'Tank'] as const) {
      const entity = createConstructionEntity(kind, registry);
      entity.quirks.set([
        {
          quirk: { key: 'unknown_quirk', name: 'unknown_quirk', type: 'positive', description: '' },
          value: 'keep:this:value',
        },
      ]);
      const fileName = kind === 'Biped' ? 'unknown.mtf' : 'unknown.blk';
      const parsed = parseEntity(encodeNativeEntity(entity), fileName, registry, { quirkResolver: () => undefined });
      expect(parsed.entity.quirks()).toEqual([
        {
          quirk: { key: 'unknown_quirk', name: 'unknown_quirk', type: 'positive', description: '', unresolved: true },
          value: 'keep:this:value',
        },
      ]);
      expect(parsed.entity.applicableQuirks()).toEqual([]);
      expect(parsed.diagnostics).toContain(jasmine.objectContaining({ code: 'QUIRK_NOT_FOUND', severity: 'warning' }));
      const saved = encodeNativeEntity(parsed.entity);
      expect(saved).toContain('unknown_quirk:keep:this:value');
      const definition = { key: 'unknown_quirk', name: 'Now known', type: 'positive' as const, description: '' };
      const resolved = parseEntity(saved, fileName, registry, { quirkResolver: () => definition }).entity;
      expect(resolved.quirks()[0].quirk).toBe(definition);
      if (kind === 'Biped') expect(resolved.applicableQuirks()).toHaveSize(1);
    }
  });
  it('preserves suppressed design and weapon assignments, including values, through MTF and BLK saves', () => {
    for (const kind of ['Biped', 'Tank'] as const) {
      const weapon = new WeaponEquipment({
        id: 'Quirk Weapon',
        name: 'Quirk Weapon',
        type: 'weapon',
        stats: { tonnage: 1, criticalSlots: 1 },
        weapon: { heat: 3, damage: 5, ammoType: 'NA' },
      });
      const weaponRegistry = createTestEquipmentRegistry({ [weapon.id]: weapon });
      const entity = createConstructionEntity(kind, weaponRegistry);
      const location = kind === 'Biped' ? 'RA' : 'Front';
      const mount = addTestEquipment(entity, weapon, {
        allocation: {
          kind: 'location',
          location,
          ...(kind === 'Biped' ? { placements: [{ location, slotIndex: 0 }] } : {}),
        },
      });
      addQuirk(entity, 'battle_fists_la');
      entity.quirks.update((entries) => [
        ...entries,
        {
          quirk: { key: 'obsolete', name: 'Obsolete', description: '', type: 'negative' },
          value: '2850,3050',
        },
      ]);
      if (entity instanceof MekWithArmsEntity) entity.hasHandActuator.update((hands) => ({ ...hands, left: false }));
      // Directional torso mount is illegal outside the torso on both families, so it stays suppressed but stored.
      entity.weaponQuirks.set([{ name: 'direct_torso_mount', ...weaponQuirkAddress(entity, mount) }]);
      const catalog = new Map(entity.quirks().map((entry) => [entry.quirk.key, entry.quirk]));
      const saved = encodeNativeEntity(entity);
      const parsed = parseEntity(saved, kind === 'Biped' ? 'quirks.mtf' : 'quirks.blk', weaponRegistry, {
        quirkResolver: (key) => catalog.get(key),
      }).entity;
      expect(parsed.quirks()).withContext(kind).toEqual(entity.quirks());
      expect(parsed.weaponQuirks()).withContext(kind).toEqual(entity.weaponQuirks());
      expect(parsed.applicableQuirks().map((entry) => entry.quirk.key)).toEqual(['obsolete']);
      expect(entity.applicableWeaponQuirks()).withContext(kind).toEqual([]);
      expect(parsed.applicableWeaponQuirks()).withContext(kind).toEqual([]);
      expect(validateConstruction(parsed).messages.some((issue) => issue.code.includes('QUIRK'))).toBeFalse();
    }
  });

  it('drops a weapon quirk whose weapon is missing from the imported file instead of keeping it', () => {
    for (const kind of ['Biped', 'Tank'] as const) {
      const entity = createConstructionEntity(kind, registry);
      entity.weaponQuirks.set([{ name: 'accurate', weaponName: 'Missing weapon', location: 'RA', slot: 4 }]);
      const parsed = parseEntity(
        encodeNativeEntity(entity),
        kind === 'Biped' ? 'orphan.mtf' : 'orphan.blk',
        registry,
      ).entity;
      expect(parsed.weaponQuirks()).withContext(kind).toEqual([]);
      expect(encodeNativeEntity(parsed).toLowerCase()).withContext(kind).not.toContain('weaponquirk');
    }
  });

  it('does not apply a suppressed chassis quirk to Alpha Strike calculations', () => {
    const entity = createConstructionEntity('Tank', registry);
    addQuirk(entity, 'trailer_hitch');
    entity.motiveType.set('Hover');
    expect(entity.applicableQuirks()).toEqual([]);
    expect(convertEntityToAlphaStrike(entity).specials).not.toContain('HTC');
    entity.motiveType.set('Tracked');
    expect(entity.applicableQuirks()).toEqual(entity.quirks());
    expect(convertEntityToAlphaStrike(entity).specials).toContain('HTC');
  });

  it('silently suppresses incompatible and unmatched assignments without losing them', () => {
    const laser = new WeaponEquipment({
      id: 'Quirk Test Laser',
      name: 'Quirk Test Laser',
      type: 'weapon',
      flags: ['F_MEK_WEAPON', 'F_ENERGY', 'F_LASER'],
      stats: { tonnage: 1, criticalSlots: 1 },
      weapon: { heat: 3, damage: 5, ammoType: 'NA' },
    });
    const entity = createConstructionEntity(
      'Biped',
      createTestEquipmentRegistry({ [laser.id]: laser }),
    ) as MekWithArmsEntity;
    entity.chassis.set('');
    entity.hasHandActuator.update((hands) => ({ ...hands, left: false }));
    addQuirk(entity, 'battle_fists_la');
    const mount = addTestEquipment(entity, laser, {
      allocation: { kind: 'location', location: 'RT', placements: [{ location: 'RT', slotIndex: 0 }] },
    });
    entity.weaponQuirks.set([
      { name: 'ammo_feed_problems', ...weaponQuirkAddress(entity, mount) },
      { name: 'accurate', weaponName: 'Missing laser', location: 'RA', slot: 4 },
    ]);
    const quirks = entity.quirks(),
      weaponQuirks = entity.weaponQuirks();
    const quirkCodes = ['QUIRK_NOT_APPLICABLE', 'WEAPON_QUIRK_NOT_APPLICABLE', 'WEAPON_QUIRK_UNMATCHED'];
    expect(unitQuirkApplies(entity, 'battle_fists_la')).toBeFalse();
    const result = validateConstruction(entity);
    expect(result.messages.filter((issue) => quirkCodes.includes(issue.code))).toEqual([]);
    expect(result.messages.some((issue) => issue.code === 'CHASSIS_REQUIRED')).toBeTrue();
    expect(entity.applicableQuirks()).toEqual([]);
    expect(entity.applicableWeaponQuirks()).toEqual([]);
    entity.hasHandActuator.update((hands) => ({ ...hands, left: true }));
    expect(entity.applicableQuirks()).toEqual(quirks);
    expect(entity.quirks()).toEqual(quirks);
    expect(entity.weaponQuirks()).toEqual(weaponQuirks);
  });
});
