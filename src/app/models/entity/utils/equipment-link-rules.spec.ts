import { MiscEquipment, WeaponEquipment, type WeaponData } from '../../equipment.model';
import { EntityMountedEquipment } from '../types';
import { canLinkEquipment, isWeaponEnhancement } from './equipment-link-rules';

describe('equipment link rules', () => {
  it('links weapon enhancements toward only their compatible weapons', () => {
    const lrm = weapon('lrm', { ammoType: 'LRM' }, ['F_ARTEMIS_COMPATIBLE']);
    const mrm = weapon('mrm', { ammoType: 'MRM' });
    const isPpc = weapon('ISPPC', {}, ['F_PPC']);
    const clanErPpc = weapon('CLERPPC', {}, ['F_PPC'], 'Clan');
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
});

function enhancement(id: string, flag: string, location = 'Front'): EntityMountedEquipment {
  return mount(new MiscEquipment({ id, name: id, type: 'misc', flags: [flag] }), location);
}

function weapon(
  id: string,
  weaponStats: Partial<WeaponData>,
  flags: string[] = [],
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
