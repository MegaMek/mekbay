// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { InfantryEntity } from '../../entities/infantry/infantry-entity';
import { BipedMekEntity } from '../../entities/mek/biped-mek-entity';
import { ProtoMekEntity } from '../../entities/protomek/protomek-entity';
import { createTestEquipmentRegistry } from '../../testing/test-equipment-registry';
import { TestBattleArmorEntity, TestInfantryEntity } from '../../testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../testing/test-mounted-equipment';
import { AmmoEquipment, WeaponEquipment } from '../../../equipment.model';
import { adjustEntityBattleValueForSkills, effectiveEntityPilotingSkill, fixedEntityPilotingSkill } from './skill-facts';

describe('Entity crew-skill facts', () => {
  it('uses the loaded Entity family instead of catalog-summary fields', () => {
    const registry = createTestEquipmentRegistry();
    expect(effectiveEntityPilotingSkill(new BipedMekEntity(registry), 2)).toBe(2);
    expect(effectiveEntityPilotingSkill(new ProtoMekEntity(registry), 2)).toBe(5);

    const conventional = new InfantryEntity(registry);
    expect(fixedEntityPilotingSkill(conventional)).toBe(8);
    expect(effectiveEntityPilotingSkill(conventional, 2)).toBe(8);

    conventional.motiveType.set('Tracked');
    expect(fixedEntityPilotingSkill(conventional)).toBe(5);
    expect(effectiveEntityPilotingSkill(conventional, 2)).toBe(5);
  });

  it('separates conventional infantry physical capability from gear and preserves neutral BV', () => {
    const entity = new TestInfantryEntity();
    const neutralBV = entity.battleValue();
    expect(entity.canMakeAntiMekAttacks()).toBeTrue();
    expect(entity.hasAntiMekGear()).toBeFalse();
    expect(effectiveEntityPilotingSkill(entity, 5)).toBe(8);
    expect(adjustEntityBattleValueForSkills(entity, 68, 4, 5)).toBe(58);
    expect(adjustEntityBattleValueForSkills(entity, neutralBV, 4, 5)).toBe(Math.round(neutralBV * 0.85));
    expect(entity.battleValue()).toBe(neutralBV);

    const gear = addTestEquipmentWithFlags(entity, 'F_ANTI_MEK_GEAR');
    expect(entity.hasAntiMekGear()).toBeTrue();
    expect(effectiveEntityPilotingSkill(entity, 2)).toBe(2);
    entity.encumberingArmor.set(true);
    expect(entity.canMakeAntiMekAttacks()).toBeFalse();
    expect(effectiveEntityPilotingSkill(entity, 2)).toBe(5);
    entity.removeEquipment(gear);
    expect(effectiveEntityPilotingSkill(entity, 2)).toBe(5);
    entity.encumberingArmor.set(false);
    addTestEquipment(entity, new WeaponEquipment({ id: 'Field Gun', name: 'Field Gun', type: 'weapon' }), { location: 'Field Guns' });
    expect(entity.canMakeAntiMekAttacks()).toBeFalse();
    expect(effectiveEntityPilotingSkill(entity, 2)).toBe(5);
  });

  it('uses the general Battle Armor capability for skill BV rather than individual Leg/Swarm eligibility', () => {
    const entity = new TestBattleArmorEntity();
    addTestEquipmentWithFlags(entity, 'F_BASIC_MANIPULATOR');
    expect(entity.legAttackCapable()).toBeFalse();
    expect(entity.canMakeAntiMekAttacks()).toBeTrue();
    expect(effectiveEntityPilotingSkill(entity, 2)).toBe(2);
    addTestEquipmentWithFlags(entity, 'F_BASIC_MANIPULATOR');
    entity.motiveType.set('UMU');
    expect(entity.legAttackCapable()).toBeTrue();
    expect(entity.canMakeAntiMekAttacks()).toBeFalse();
    expect(effectiveEntityPilotingSkill(entity, 2)).toBe(5);
    entity.motiveType.set('Jump');
    entity.declaredWeightClass.set('Heavy');
    expect(entity.canMakeAntiMekAttacks()).toBeFalse();
    expect(effectiveEntityPilotingSkill(entity, 2)).toBe(5);
  });

  it('disables Inner Sphere anti-Mek attacks while body-mounted missile ammunition burdens the squad', () => {
    const entity = new TestBattleArmorEntity();
    addTestEquipmentWithFlags(entity, 'F_BASIC_MANIPULATOR');
    addTestEquipment(entity, new WeaponEquipment({ id: 'BA SRM 2', name: 'BA SRM 2', type: 'weapon',
      flags: ['F_MISSILE'], weapon: { ammoType: 'SRM', rackSize: 2 } }), { location: 'Squad', baMountLocation: 'Body' });
    const ammo = addTestEquipment(entity, new AmmoEquipment({ id: 'BA SRM Ammo', name: 'BA SRM Ammo', type: 'ammo',
      ammo: { type: 'SRM', rackSize: 2, shots: 2 } }), { location: 'Squad' });
    expect(entity.isBurdened()).toBeTrue();
    expect(entity.canMakeAntiMekAttacks()).toBeFalse();
    entity.techBase.set('Clan');
    expect(entity.isBurdened()).toBeFalse();
    expect(entity.canMakeAntiMekAttacks()).toBeTrue();
    entity.techBase.set('IS');
    entity.removeEquipment(ammo);
    expect(entity.canMakeAntiMekAttacks()).toBeTrue();
  });
});
