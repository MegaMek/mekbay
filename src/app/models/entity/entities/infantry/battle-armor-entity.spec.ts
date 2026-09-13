// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBattleArmorEntity as BattleArmorEntity } from '../../testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../testing/test-mounted-equipment';
import { AmmoEquipment, WeaponEquipment } from '../../../equipment.model';
import { AS_MOVEMENT_CALCULATION, BV_MOVEMENT_CALCULATION } from '../../types';

describe('BattleArmorEntity movement', () => {
  it('blocks loaded body missiles while retaining unburdened BV and AS movement', () => {
    const entity = new BattleArmorEntity();
    entity.motiveType.set('Jump');
    entity.propulsionMP.set(3);
    addTestEquipment(entity, new WeaponEquipment({ id: 'SRM', name: 'SRM', type: 'weapon',
      flags: ['F_MISSILE'], weapon: { ammoType: 'SRM', rackSize: 2 } }), { location: 'Squad', baMountLocation: 'Body' });
    const ammo = addTestEquipment(entity, new AmmoEquipment({ id: 'SRM Ammo', name: 'SRM Ammo', type: 'ammo',
      ammo: { type: 'SRM', rackSize: 2, shots: 2 } }), { location: 'Squad' });
    expect(entity.isBurdened()).toBeTrue();
    expect(entity.jumpMP()).toBe(0);
    expect(entity.computeJumpMP(BV_MOVEMENT_CALCULATION)).toBe(3);
    expect(entity.computeJumpMP(AS_MOVEMENT_CALCULATION)).toBe(3);
    entity.removeEquipment(ammo);
    expect(entity.isBurdened()).toBeFalse();
    expect(entity.jumpMP()).toBe(3);
  });

  for (const oneShotFlag of ['F_ONE_SHOT', 'F_DOUBLE_ONE_SHOT'] as const) {
    it(`counts intrinsic ${oneShotFlag} missile ammunition without synthetic mounts`, () => {
      const entity = new BattleArmorEntity();
      entity.motiveType.set('Jump');
      entity.propulsionMP.set(3);
      addTestEquipmentWithFlags(entity, 'F_BASIC_MANIPULATOR');
      const weapon = new WeaponEquipment({ id: 'One-shot SRM', name: 'One-shot SRM', type: 'weapon',
        flags: ['F_MISSILE', oneShotFlag], weapon: { ammoType: 'SRM', rackSize: 2 } });
      const mount = addTestEquipment(entity, weapon, { location: 'Squad', baMountLocation: 'Body' });
      expect(entity.equipment().some(item => item.equipment instanceof AmmoEquipment)).toBeFalse();
      expect(entity.isBurdened()).toBeTrue();
      expect(entity.jumpMP()).toBe(0);
      expect(entity.canMakeAntiMekAttacks()).toBeFalse();
      expect(entity.computeJumpMP(AS_MOVEMENT_CALCULATION)).toBe(3);
      entity.techBase.set('Clan');
      expect(entity.isBurdened()).toBeFalse();
      expect(entity.jumpMP()).toBe(3);
      expect(entity.canMakeAntiMekAttacks()).toBeTrue();
      entity.techBase.set('IS');
      entity.removeEquipment(mount);
      addTestEquipment(entity, weapon, { location: 'Squad', baMountLocation: 'LA' });
      expect(entity.isBurdened()).toBeFalse();
      expect(entity.jumpMP()).toBe(3);
    });
  }

  it('uses one canonical signal for squad size and trooper count', () => {
    const entity = new BattleArmorEntity();

    expect(entity.squadCount()).toBe(1);
    expect(entity.squadSize()).toBe(5);
    expect(entity.squadSize).toBe(entity.trooperCount);
    entity.trooperCount.set(6);
    expect(entity.squadSize()).toBe(6);
  });

  it('derives jump and UMU movement from slotless propulsion equipment', () => {
    const entity = new BattleArmorEntity();
    entity.originalWalkMP.set(1);
    entity.propulsionMP.set(3);
    entity.motiveType.set('Jump');
    addTestEquipmentWithFlags(entity, 'F_JUMP_JET', { location: 'None' });

    expect(entity.walkMP()).toBe(1);
    expect(entity.runMP()).toBe(1);
    expect(entity.jumpMP()).toBe(3);
    expect(entity.umuMP()).toBe(0);
    expect(entity.equipment()[0].location).toBe('None');
    expect(entity.equipment()[0].placements).toBeUndefined();

    entity.motiveType.set('UMU');
    entity.propulsionMP.set(2);
    entity.setEquipment([]);
    addTestEquipmentWithFlags(entity, 'F_UMU', { location: 'None' });
    expect(entity.jumpMP()).toBe(0);
    expect(entity.umuMP()).toBe(2);
  });

  it('reacts to BA movement modifiers without changing source walk MP', () => {
    const entity = new BattleArmorEntity();
    entity.originalWalkMP.set(5);
    entity.declaredWeightClass.set('Light');
    addTestEquipmentWithFlags(entity, 'F_MASC', { location: 'None' });

    expect(entity.walkMP()).toBe(7);
    expect(entity.runMP()).toBe(7);
    expect(entity.originalWalkMP()).toBe(5);

    entity.motiveType.set('UMU');
    entity.setEquipment([]);
    addTestEquipmentWithFlags(entity, 'F_MECHANICAL_JUMP_BOOSTER', { location: 'None' });
    expect(entity.jumpMP()).toBe(1);
  });
});

describe('BattleArmorEntity mechanized capability', () => {
  it('rejects quad squads even when they mount magnetic clamps', () => {
    const entity = new BattleArmorEntity();
    entity.chassisType.set('Quad');
    addTestEquipmentWithFlags(entity, 'F_MAGNETIC_CLAMP');

    expect(entity.mechanizedCapable()).toBeFalse();
  });

  it('accepts a non-quad squad with magnetic clamps', () => {
    const entity = new BattleArmorEntity();
    addTestEquipmentWithFlags(entity, 'F_MAGNETIC_CLAMP');

    expect(entity.mechanizedCapable()).toBeTrue();
  });

  it('applies the light-class armored glove threshold', () => {
    const entity = new BattleArmorEntity();
    entity.declaredWeightClass.set('Light');
    addTestEquipmentWithFlags(entity, 'F_ARMORED_GLOVE');

    expect(entity.mechanizedCapable()).toBeFalse();

    addTestEquipmentWithFlags(entity, 'F_ARMORED_GLOVE');
    expect(entity.mechanizedCapable()).toBeTrue();
  });

  it('accepts basic manipulators and battle claws only through heavy weight', () => {
    const entity = new BattleArmorEntity();
    entity.declaredWeightClass.set('Medium');
    addTestEquipmentWithFlags(entity, 'F_BASIC_MANIPULATOR');
    expect(entity.mechanizedCapable()).toBeTrue();

    entity.declaredWeightClass.set('Heavy');
    entity.setEquipment([]);
    addTestEquipmentWithFlags(entity, 'F_BATTLE_CLAW');
    expect(entity.mechanizedCapable()).toBeTrue();

    entity.declaredWeightClass.set('Assault');
    expect(entity.mechanizedCapable()).toBeFalse();
  });

  it('rejects squads without qualifying equipment', () => {
    const entity = new BattleArmorEntity();

    expect(entity.mechanizedCapable()).toBeFalse();
  });
});

describe('BattleArmorEntity anti-Mek attack capabilities', () => {
  it('derives light-unit Leg and Swarm capability from manipulator thresholds', () => {
    const entity = new BattleArmorEntity();
    entity.declaredWeightClass.set('Light');
    addTestEquipmentWithFlags(entity, 'F_ARMORED_GLOVE');

    expect(entity.legAttackCapable()).toBeFalse();
    expect(entity.swarmAttackCapable()).toBeFalse();
    expect(entity.canMakeAntiMekAttacks()).toBeFalse();

    addTestEquipmentWithFlags(entity, 'F_ARMORED_GLOVE');
    expect(entity.legAttackCapable()).toBeTrue();
    expect(entity.swarmAttackCapable()).toBeTrue();
    expect(entity.canMakeAntiMekAttacks()).toBeTrue();
  });

  it('requires two basic manipulators or a battle claw for medium units', () => {
    const entity = new BattleArmorEntity();
    addTestEquipmentWithFlags(entity, 'F_BASIC_MANIPULATOR');
    expect(entity.legAttackCapable()).toBeFalse();

    addTestEquipmentWithFlags(entity, 'F_BASIC_MANIPULATOR');
    expect(entity.legAttackCapable()).toBeTrue();

    entity.setEquipment([]);
    addTestEquipmentWithFlags(entity, 'F_BATTLE_CLAW');
    expect(entity.legAttackCapable()).toBeTrue();
  });

  it('allows UMU units to make Leg Attacks but not Swarm Attacks', () => {
    const entity = new BattleArmorEntity();
    entity.declaredWeightClass.set('Light');
    entity.motiveType.set('UMU');
    addTestEquipmentWithFlags(entity, 'F_BATTLE_CLAW');

    expect(entity.legAttackCapable()).toBeTrue();
    expect(entity.swarmAttackCapable()).toBeFalse();
    expect(entity.canMakeAntiMekAttacks()).toBeFalse();
  });

  it('rejects quad, heavy, assault, and magnetic-clamp-only units', () => {
    const quad = new BattleArmorEntity();
    quad.declaredWeightClass.set('Light');
    quad.chassisType.set('Quad');
    addTestEquipmentWithFlags(quad, 'F_BATTLE_CLAW');
    expect(quad.legAttackCapable()).toBeFalse();

    for (const weightClass of ['Heavy', 'Assault'] as const) {
      const entity = new BattleArmorEntity();
      entity.declaredWeightClass.set(weightClass);
      addTestEquipmentWithFlags(entity, 'F_BATTLE_CLAW');
      expect(entity.legAttackCapable()).toBeFalse();
      expect(entity.swarmAttackCapable()).toBeFalse();
    }

    const clamps = new BattleArmorEntity();
    clamps.declaredWeightClass.set('Light');
    addTestEquipmentWithFlags(clamps, 'F_MAGNETIC_CLAMP');
    expect(clamps.legAttackCapable()).toBeFalse();
    expect(clamps.swarmAttackCapable()).toBeFalse();
  });
});
