// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentFlag } from '../../../equipment-flags.type';
import { InfantryWeaponEquipment, WeaponEquipment } from '../../../equipment.model';
import { TestInfantryEntity as InfantryEntity } from '../../testing/test-entities';
import { addTestEquipmentWithFlags } from '../../testing/test-mounted-equipment';

describe('InfantryEntity strength limit', () => {
  it('validates the thirty-troop construction limit as squad size or count changes', () => {
    const infantry = new InfantryEntity();
    infantry.primaryWeapon.set(infantryWeapon('InfantryStrengthTest'));
    infantry.squadSize.set(6);
    infantry.squadCount.set(5);
    expect(infantry.validationResult().messages.some(message => message.code === 'INF_TOO_MANY_TROOPERS')).toBeFalse();
    expect(infantry.damageLocations()[0]!.internalPoints).toBe(30);

    infantry.squadSize.set(7);
    expect(infantry.validationResult().valid).toBeFalse();
    expect(infantry.validationResult().messages).toContain(jasmine.objectContaining({
      severity: 'error', code: 'INF_TOO_MANY_TROOPERS',
    }));
    // Invalid imported definitions remain recognizable; gameplay never exceeds the rule limit.
    expect(infantry.squadSize()).toBe(7);
    expect(infantry.squadCount()).toBe(5);
    expect(infantry.damageLocations()[0]!.internalPoints).toBe(30);

    infantry.squadCount.set(4);
    expect(infantry.validationResult().messages.some(message => message.code === 'INF_TOO_MANY_TROOPERS')).toBeFalse();
    expect(infantry.damageLocations()[0]!.internalPoints).toBe(28);
  });

  it('rejects fractional and non-finite squad definitions', () => {
    const infantry = new InfantryEntity();
    infantry.squadSize.set(1.5);
    expect(infantry.validationResult().messages).toContain(jasmine.objectContaining({ code: 'INF_NO_SQUAD_SIZE' }));
    infantry.squadSize.set(1);
    infantry.squadCount.set(Number.NaN);
    expect(infantry.validationResult().messages).toContain(jasmine.objectContaining({ code: 'INF_NO_SQUAD_COUNT' }));
    expect(infantry.damageLocations()[0]!.internalPoints).toBe(0);
  });
});

describe('InfantryEntity anti-Mek capability', () => {
  it('reacts to anti-Mek gear installation and removal', () => {
    const infantry = new InfantryEntity();

    expect(infantry.canAntiMech()).toBeFalse();

    const antiMekGear = addTestEquipmentWithFlags(infantry, 'F_ANTI_MEK_GEAR');
    expect(infantry.canAntiMech()).toBeTrue();

    infantry.removeEquipment(antiMekGear);
    expect(infantry.canAntiMech()).toBeFalse();
  });
});

describe('InfantryEntity movement', () => {
  const supportWeapon = infantryWeapon('InfantrySupportTest', ['F_INF_SUPPORT']);

  function createInfantry(): InfantryEntity {
    const infantry = new InfantryEntity();
    infantry.originalWalkMP.set(1);
    infantry.motiveType.set('Jump');
    infantry.secondaryCount.set(2);
    infantry.secondaryWeapon.set(supportWeapon);
    return infantry;
  }

  it('applies the support weapon movement penalty to ordinary infantry', () => {
    const infantry = createInfantry();

    expect(infantry.walkMP()).toBe(1);
    expect(infantry.jumpMP()).toBe(2);
  });

  it('does not apply the support weapon movement penalty to TAG troops', () => {
    const infantry = createInfantry();
    infantry.specializations.set(new Set(['tag-troops']));

    expect(infantry.walkMP()).toBe(1);
    expect(infantry.jumpMP()).toBe(3);
  });

  it('derives UMU movement from aquatic infantry motive configurations', () => {
    const infantry = new InfantryEntity();
    infantry.motiveType.set('UMU');
    expect(infantry.umuMP()).toBe(1);

    infantry.isMotorizedScuba.set(true);
    expect(infantry.umuMP()).toBe(2);

    infantry.motiveType.set('Submarine');
    expect(infantry.umuMP()).toBe(3);

    infantry.motiveType.set('Beast');
    infantry.mount.set({
      name: 'Aquatic Test Mount',
      size: 'Very Large',
      weight: 1,
      movementPoints: 5,
      movementMode: 'Submarine',
      burstDamage: 0,
      vehicleDamage: 0,
      damageDivisor: 1,
      maxWaterDepth: -1,
      secondaryGroundMP: 0,
      uwEndurance: 1,
    });
    expect(infantry.umuMP()).toBe(5);

    infantry.mount.update(mount => mount && { ...mount, movementMode: 'Leg' });
    expect(infantry.umuMP()).toBe(0);
  });
});

function infantryWeapon(id: string, extraFlags: EquipmentFlag[] = []): InfantryWeaponEquipment {
  const weapon = new WeaponEquipment({
    id,
    name: id,
    type: 'weapon',
    flags: ['F_INFANTRY', ...extraFlags],
    weapon: { ammoType: 'NA' },
    infantry: {},
  });
  if (!weapon.isInfantryWeapon()) throw new Error(`${id} is not an infantry weapon`);
  return weapon;
}
