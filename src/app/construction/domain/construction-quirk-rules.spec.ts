// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { MountedEngine } from '../../models/entity/components';
import { WeaponEquipment } from '../../models/equipment.model';
import { MekWithArmsEntity } from '../../models/entity/entities/mek/mek-entity';
import type { BaseEntity } from '../../models/entity/base-entity';
import { createConstructionEntity } from './construction-factory';
import { constructionQuirkApplies, constructionQuirkMessages } from './construction-quirk-rules';

const registry = createTestEquipmentRegistry({});
const addQuirk = (entity: BaseEntity, key: string) => entity.quirks.update(items => [...items,
  { quirk: { key, name: key, description: '', type: 'positive' } }]);

describe('source-based unit quirk legality', () => {
  it('allows battle armor Fast Reload per the Campaign Operations quirk table', () => {
    const entity = createConstructionEntity('BattleArmor', registry);
    addQuirk(entity, 'fast_reload');
    expect(constructionQuirkMessages(entity)).toEqual([]);
    addQuirk(entity, 'distracting');
    expect(constructionQuirkMessages(entity).map(issue => issue.message)).toEqual([
      'distracting is incompatible with this chassis, installed systems or selected quirks.',
    ]);
  });
  it('checks fist requirements independently for each arm and excludes quads', () => {
    const entity = createConstructionEntity('Biped', registry) as MekWithArmsEntity;
    expect(constructionQuirkApplies(entity, 'battle_fists_la')).toBeTrue();
    expect(constructionQuirkApplies(entity, 'barrel_fists_la')).toBeFalse();
    entity.hasHandActuator.update(hands => ({ ...hands, left: false }));
    expect(constructionQuirkApplies(entity, 'battle_fists_la')).toBeFalse();
    expect(constructionQuirkApplies(entity, 'battle_fists_ra')).toBeTrue();
    expect(constructionQuirkApplies(entity, 'barrel_fists_la')).toBeTrue();
    entity.hasLowerArmActuator.update(arms => ({ ...arms, left: false }));
    expect(constructionQuirkApplies(entity, 'barrel_fists_la')).toBeFalse();
    expect(constructionQuirkApplies(createConstructionEntity('Quad', registry), 'battle_fists_la')).toBeFalse();
  });

  it('requires arm direct-fire weapons for overhead arms, except on OmniMeks', () => {
    const entity = createConstructionEntity('Biped', registry);
    const laser = new WeaponEquipment({ id: 'Arm Laser', name: 'Arm Laser', type: 'weapon', flags: ['F_DIRECT_FIRE'] });
    expect(constructionQuirkApplies(entity, 'overhead_arms')).toBeFalse();
    const mount = entity.addEquipment({ equipmentId: laser.id, equipment: laser, allocation: { kind: 'location', location: 'RA' },
      rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false });
    expect(constructionQuirkApplies(entity, 'overhead_arms')).toBeTrue();
    entity.removeEquipment(mount);
    entity.omni.set(true);
    expect(constructionQuirkApplies(entity, 'overhead_arms')).toBeTrue();
    const quad = createConstructionEntity('QuadVee', registry);
    quad.omni.set(true);
    expect(constructionQuirkApplies(quad, 'overhead_arms')).toBeFalse();
    expect(constructionQuirkApplies(quad, 'directional_torso_mount_360')).toBeTrue();
  });

  it('enforces symmetric targeting and arm-configuration exclusions', () => {
    const entity = createConstructionEntity('Biped', registry);
    addQuirk(entity, 'variable_range_targeting');
    addQuirk(entity, 'imp_target_long');
    addQuirk(entity, 'overhead_arms');
    addQuirk(entity, 'low_arms');
    expect(constructionQuirkMessages(entity).length).toBe(4);
    expect(constructionQuirkApplies(entity, 'imp_target_short')).toBeFalse();
  });

  it('uses actual Mek tonnage for compact and oversized quirks', () => {
    const entity = createConstructionEntity('Biped', registry);
    entity.setTonnage(55);
    expect(constructionQuirkApplies(entity, 'compact_mech')).toBeTrue();
    expect(constructionQuirkApplies(entity, 'oversized')).toBeFalse();
    entity.setTonnage(60);
    expect(constructionQuirkApplies(entity, 'compact_mech')).toBeFalse();
    expect(constructionQuirkApplies(entity, 'oversized')).toBeTrue();
  });

  it('distinguishes support vehicles, motive systems, fuel and lightweight scout bikes', () => {
    const tank = createConstructionEntity('Tank', registry);
    expect(constructionQuirkApplies(tank, 'power_reverse')).toBeTrue();
    expect(constructionQuirkApplies(createConstructionEntity('SupportTank', registry), 'power_reverse')).toBeFalse();
    tank.motiveType.set('Hover');
    tank.setTonnage(10);
    expect(constructionQuirkApplies(tank, 'scout_bike')).toBeTrue();
    expect(constructionQuirkApplies(tank, 'trailer_hitch')).toBeFalse();
    tank.setTonnage(15);
    expect(constructionQuirkApplies(tank, 'scout_bike')).toBeFalse();
    tank.mountedEngine.set(new MountedEngine({ type: 'Fuel Cell', rating: 50, techBase: 'IS', installed: true }));
    expect(constructionQuirkApplies(tank, 'gas_hog')).toBeTrue();
    expect(constructionQuirkApplies(tank, 'fragile_fuel')).toBeFalse();
    expect(constructionQuirkApplies(createConstructionEntity('SupportVTOL', registry), 'vtol_rotor_dual')).toBeTrue();
  });

  it('applies the source Aero allowance before ship-specific exceptions', () => {
    const warship = createConstructionEntity('WarShip', registry);
    expect(constructionQuirkApplies(warship, 'atmo_flyer')).toBeTrue();
    expect(constructionQuirkApplies(warship, 'docking_arms')).toBeFalse();
    expect(constructionQuirkApplies(createConstructionEntity('JumpShip', registry), 'docking_arms')).toBeTrue();
    expect(constructionQuirkApplies(createConstructionEntity('DropShip', registry), 'large_dropper')).toBeTrue();
    expect(constructionQuirkApplies(createConstructionEntity('Aero', registry), 'fast_reload')).toBeTrue();
    expect(constructionQuirkApplies(warship, 'fast_reload')).toBeFalse();
  });

  it('checks armor suits, ProtoMeks and infantry by their exact family lists', () => {
    for (const kind of ['BattleArmor', 'ProtoMek'] as const) {
      const entity = createConstructionEntity(kind, registry);
      expect(constructionQuirkApplies(entity, 'rugged_2')).toBeTrue();
      expect(constructionQuirkApplies(entity, 'no_eject')).toBeFalse();
    }
    expect(constructionQuirkApplies(createConstructionEntity('Infantry', registry), 'easy_maintain')).toBeFalse();
  });
});
