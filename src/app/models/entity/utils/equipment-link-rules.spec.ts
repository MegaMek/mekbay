// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentFlag } from '../../equipment-flags.type';
import { MiscEquipment, WeaponEquipment, type WeaponData } from '../../equipment.model';
import { EntityMountedEquipment } from '../types';
import {
  canLinkEquipment,
  isArtemisCompatibleWeapon,
  isPpcCapacitorCompatibleWeapon,
  isWeaponEnhancement,
} from './equipment-link-rules';

describe('equipment link rules', () => {
  it('links weapon enhancements toward only their compatible weapons', () => {
    const lrm = weapon('lrm', { ammoType: 'LRM' }, ['F_ARTEMIS_COMPATIBLE']);
    const mrm = weapon('mrm', { ammoType: 'MRM' });
    const isPpc = weapon('PPC', {}, ['F_PPC','F_PPC_CAPACITOR_COMPATIBLE']);
    const heavyPpc = weapon('Heavy PPC', {}, ['F_PPC','F_PPC_CAPACITOR_COMPATIBLE']);
    const clanErPpc = weapon('CLERPPC', {}, ['F_PPC','F_PPC_CAPACITOR_COMPATIBLE'], 'Clan');
    const laser = weapon('laser', {}, ['F_LASER']);
    const pulseLaser = weapon('pulse', {}, ['F_LASER', 'F_PULSE']);
    const clanLaser = weapon('clan-laser', {}, ['F_LASER'], 'Clan');

    const artemis = enhancement('artemis', 'F_ARTEMIS');
    const apollo = enhancement('apollo', 'F_APOLLO');
    const capacitor = enhancement('capacitor', 'F_PPC_CAPACITOR');
    const pulseModule = enhancement('module', 'F_RISC_LASER_PULSE_MODULE');
    const insulator = enhancement('insulator', 'F_LASER_INSULATOR');

    expect(isWeaponEnhancement(artemis)).toBeTrue();
    expect(canLinkEquipment(artemis, lrm, { year: 3145 })).toBeTrue();
    expect(canLinkEquipment(lrm, artemis, { year: 3145 })).toBeFalse();
    expect(canLinkEquipment(apollo, mrm, { year: 3145 })).toBeTrue();
    expect(canLinkEquipment(apollo, lrm, { year: 3145 })).toBeFalse();
    expect(canLinkEquipment(capacitor, isPpc, { year: 3145 })).toBeTrue();
    expect(canLinkEquipment(capacitor, heavyPpc, { year: 3145 })).toBeTrue();
    expect(canLinkEquipment(capacitor, clanErPpc, { year: 3100 })).toBeFalse();
    expect(canLinkEquipment(capacitor, clanErPpc, { year: 3101 })).toBeTrue();
    expect(canLinkEquipment(pulseModule, laser, { year: 3145 })).toBeTrue();
    expect(canLinkEquipment(pulseModule, pulseLaser, { year: 3145 })).toBeFalse();
    expect(canLinkEquipment(pulseModule, clanLaser, { year: 3145 })).toBeFalse();
    expect(canLinkEquipment(insulator, pulseLaser, { year: 3145 })).toBeTrue();
  });

  it('requires source and target to occupy the same location', () => {
    const artemis = enhancement('artemis', 'F_ARTEMIS', 'Left');
    const launcher = weapon('lrm', { ammoType: 'LRM' }, ['F_ARTEMIS_COMPATIBLE'], 'IS', 'Right');

    expect(canLinkEquipment(artemis, launcher, { year: 3145 })).toBeFalse();
  });

  it('centralizes PPC capacitor compatibility and year boundaries', () => {
    const compatible = weapon('PPC', {}, ['F_PPC', 'F_PPC_CAPACITOR_COMPATIBLE']).equipment!;
    const missingCompatibility = weapon('PPC', {}, ['F_PPC']).equipment!;
    const clanErPpc = weapon(
      'CLERPPC', {}, ['F_PPC', 'F_PPC_CAPACITOR_COMPATIBLE'], 'Clan',
    ).equipment!;

    expect(isPpcCapacitorCompatibleWeapon(compatible, { year: 3145 })).toBeTrue();
    expect(isPpcCapacitorCompatibleWeapon(missingCompatibility, { year: 3145 })).toBeFalse();
    expect(isPpcCapacitorCompatibleWeapon(clanErPpc, { year: 3100 })).toBeFalse();
    expect(isPpcCapacitorCompatibleWeapon(clanErPpc, { year: 3101 })).toBeTrue();
  });

  it('centralizes Artemis launcher compatibility', () => {
    const compatible = weapon('LRM', {}, ['F_ARTEMIS_COMPATIBLE']).equipment!;
    const incompatible = weapon('LRM', {}).equipment!;

    expect(isArtemisCompatibleWeapon(compatible)).toBeTrue();
    expect(isArtemisCompatibleWeapon(incompatible)).toBeFalse();
  });
});

function enhancement(id: string, flag: EquipmentFlag, location = 'Front'): EntityMountedEquipment {
  return mount(new MiscEquipment({ id, name: id, type: 'misc', flags: [flag] }), location);
}

function weapon(
  id: string,
  weaponStats: Partial<WeaponData>,
  flags: EquipmentFlag[] = [],
  techBase: 'IS' | 'Clan' = 'IS',
  location = 'Front',
): EntityMountedEquipment {
  return mount(new WeaponEquipment({
    id,
    name: id,
    type: 'weapon',
    weapon: weaponStats,
    flags,
    tech: { base: techBase },
  }), location);
}

function mount(
  equipment: MiscEquipment | WeaponEquipment,
  location: string,
): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: `${equipment.id}-${location}`,
    equipmentId: equipment.id,
    equipment,
    allocation: { kind: 'location', location },
    rearMounted: false,
    turretMounted: false,
    omniPodMounted: false,
    armored: false,
  });
}
