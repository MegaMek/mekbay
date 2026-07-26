import { WeaponEquipment, type EquipmentRawData } from '../../../../equipment.model';
import { TestBipedMekEntity } from '../../../testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../../testing/test-mounted-equipment';
import type { EntityMountedWeapon } from '../../../types';
import {
  alphaStrikeWeaponConversionMetadata,
  battleForceDamageForMount,
  legacyBattleForceDamageFallback,
  type AlphaStrikeRangeIndex,
} from './weapon-damage-profile';

function weapon(
  id: string,
  overrides: Partial<Omit<EquipmentRawData, 'id' | 'name' | 'type'>> = {},
): WeaponEquipment {
  return new WeaponEquipment({ id, name: id, type: 'weapon', ...overrides });
}

function mount(entity: TestBipedMekEntity, equipment: WeaponEquipment, equipmentId = equipment.id): EntityMountedWeapon {
  const mounted = addTestEquipment(entity, equipment, { location: 'RA' });
  mounted.equipmentId = equipmentId;
  if (!(mounted.equipment instanceof WeaponEquipment)) throw new Error('Expected a mounted weapon');
  return mounted as EntityMountedWeapon;
}

describe('Alpha Strike weapon damage profiles', () => {
  it('uses canonical weapon data rather than display names', () => {
    const entity = new TestBipedMekEntity();
    const innerSphere = mount(entity, weapon('ISLargePulseLaser', {
      aliases: ['Large Pulse Laser'],
      stats: { toHitModifier: -2 },
      weapon: { damage: 9, ranges: [3, 7, 10, 15], ammoType: 'NA' },
    }), 'Large Pulse Laser');
    const clan = mount(entity, weapon('CLLargePulseLaser', {
      aliases: ['Large Pulse Laser'],
      stats: { toHitModifier: -2 },
      weapon: { damage: 10, ranges: [6, 14, 20, 30], ammoType: 'NA' },
    }));

    expect(battleForceDamageForMount(entity, innerSphere, 0)).toBe(0.99);
    expect(battleForceDamageForMount(entity, clan, 0)).toBe(1.1);
    expect(battleForceDamageForMount(entity, innerSphere, 2)).toBe(0);
  });

  it('stores normalized one-shot damage for exactly one mount-time modifier', () => {
    const entity = new TestBipedMekEntity();
    const oneShot = mount(entity, weapon('LRM 5 (OS)', {
      flags: ['F_LRM', 'F_ONE_SHOT'],
      weapon: { damage: 'cluster', rackSize: 5, minRange: 6, ranges: [7, 14, 21, 28], ammoType: 'LRM' },
    }));

    expect(battleForceDamageForMount(entity, oneShot, 0)).toBe(0.15);
    expect(battleForceDamageForMount(entity, oneShot, 1)).toBe(0.3);
  });

  it('selects exact Artemis and Apollo variants from entity relationships', () => {
    const entity = new TestBipedMekEntity();
    const lrm = mount(entity, weapon('LRM 20', {
      flags: ['F_ARTEMIS_COMPATIBLE'],
      weapon: { damage: 'cluster', rackSize: 20, ranges: [7, 14, 21, 28], ammoType: 'LRM' },
    }));
    const artemis = addTestEquipmentWithFlags(entity, 'F_ARTEMIS', { location: 'RA' });
    const mrm = mount(entity, weapon('MRM 20', {
      flags: ['F_MRM'],
      weapon: { damage: 'cluster', rackSize: 20, ranges: [3, 8, 15, 22], ammoType: 'MRM' },
    }));
    const apollo = addTestEquipmentWithFlags(entity, 'F_APOLLO', { location: 'RA' });

    expect(battleForceDamageForMount(entity, lrm, 1)).toBe(1.2);
    expect(battleForceDamageForMount(entity, mrm, 1)).toBe(1.14);
    entity.linkEquipment(artemis, lrm);
    entity.linkEquipment(apollo, mrm);
    expect(battleForceDamageForMount(entity, lrm, 1)).toBe(1.6);
    expect(battleForceDamageForMount(entity, mrm, 1)).toBe(1.2);
  });

  it('selects the weapon-specific PPC-capacitor variant', () => {
    const entity = new TestBipedMekEntity();
    const ppc = mount(entity, weapon('ISERPPC', {
      flags: ['F_PPC', 'F_PPC_CAPACITOR_COMPATIBLE'],
      weapon: { damage: 10, ranges: [7, 14, 23, 34], ammoType: 'NA' },
    }));
    const capacitor = addTestEquipmentWithFlags(entity, 'F_PPC_CAPACITOR', { location: 'RA' });

    expect(battleForceDamageForMount(entity, ppc, 0)).toBe(1);
    entity.linkEquipment(capacitor, ppc);
    expect(battleForceDamageForMount(entity, ppc, 0)).toBe(0.75);
  });

  it('ports native special weapon-family BattleForce damage rules', () => {
    const entity = new TestBipedMekEntity();
    const ultra = mount(entity, weapon('Ultra AC/10', {
      weapon: { rackSize: 10, ranges: [6, 13, 20, 26], ammoType: 'AC_ULTRA' },
    }));
    const lbx = mount(entity, weapon('LB 10-X AC', {
      weapon: { rackSize: 10, ranges: [6, 12, 18, 24], ammoType: 'AC_LBX' },
    }));
    const streak = mount(entity, weapon('Streak SRM 6', {
      flags: ['F_SRM'],
      weapon: { rackSize: 6, ranges: [4, 8, 12, 16], ammoType: 'SRM_STREAK' },
    }));
    const hag = mount(entity, weapon('HAG/20', {
      flags: ['F_HAG'],
      weapon: { rackSize: 20, ranges: [8, 16, 24, 32], ammoType: 'HAG' },
    }));
    const streakLrm = mount(entity, weapon('Streak LRM 5', {
      flags: ['F_LRM'],
      weapon: { damage: 'cluster', rackSize: 5, ranges: [7, 14, 21, 28], ammoType: 'LRM_STREAK' },
    }));

    expect(battleForceDamageForMount(entity, ultra, 1)).toBe(1.5);
    expect(battleForceDamageForMount(entity, lbx, 1)).toBeCloseTo(0.63, 12);
    expect(battleForceDamageForMount(entity, streak, 1)).toBeCloseTo(1.2, 12);
    expect(battleForceDamageForMount(entity, hag, 0)).toBe(1.328);
    expect(battleForceDamageForMount(entity, hag, 1)).toBe(1.2);
    expect([0, 1, 2, 3].map(range => battleForceDamageForMount(entity, streakLrm, range as AlphaStrikeRangeIndex)))
      .toEqual([0.5, 0.5, 0.5, 0]);
  });

  it('uses MegaMek’s dedicated MML profile and Artemis values', () => {
    const entity = new TestBipedMekEntity();
    const mml = mount(entity, weapon('MML 7', {
      flags: ['F_MML', 'F_ARTEMIS_COMPATIBLE'],
      weapon: { damage: 'cluster', rackSize: 7, ranges: [3, 6, 9, 12], ammoType: 'MML' },
    }));
    const artemis = addTestEquipmentWithFlags(entity, 'F_ARTEMIS', { location: 'RA' });

    expect([0, 1, 2, 3].map(range => battleForceDamageForMount(entity, mml, range as AlphaStrikeRangeIndex)))
      .toEqual([0.8, 0.6, 0.4, 0]);
    entity.linkEquipment(artemis, mml);
    expect([0, 1, 2, 3].map(range => battleForceDamageForMount(entity, mml, range as AlphaStrikeRangeIndex)))
      .toEqual([1.2, 0.9, 0.6, 0]);
  });

  it('uses MegaMek’s distinct ATM and IATM profiles', () => {
    const entity = new TestBipedMekEntity();
    const atm = mount(entity, weapon('ATM 9', {
      weapon: { damage: 'cluster', rackSize: 9, ranges: [5, 10, 15, 20], ammoType: 'ATM' },
    }));
    const iatm = mount(entity, weapon('IATM 9', {
      weapon: { damage: 'cluster', rackSize: 9, ranges: [5, 10, 15, 20], ammoType: 'IATM' },
    }));

    expect([0, 1, 2, 3].map(range => battleForceDamageForMount(entity, atm, range as AlphaStrikeRangeIndex)))
      .toEqual([2.1, 1.4, 0.7, 0]);
    expect([0, 1, 2, 3].map(range => battleForceDamageForMount(entity, iatm, range as AlphaStrikeRangeIndex)))
      .toEqual([2.7, 1.8, 0.9, 0]);
  });

  it('excludes Clan Plasma Cannons from standard damage without suppressing their heat path', () => {
    const entity = new TestBipedMekEntity();
    const plasma = mount(entity, weapon('CLPlasmaCannon', {
      flags: ['F_PLASMA', 'F_ENERGY', 'F_DIRECT_FIRE'],
      weapon: { damage: 'variable', heat: 7, ranges: [6, 12, 18, 24], av: [10, 10] },
    }));

    expect([0, 1, 2, 3].map(range => battleForceDamageForMount(entity, plasma, range as AlphaStrikeRangeIndex)))
      .toEqual([0, 0, 0, 0]);
  });

  it('classifies Java point-defense laser overrides independently of equipment flags', () => {
    const entity = new TestBipedMekEntity();
    const microLaser = mount(entity, weapon('CLERMicroLaser', {
      weapon: { damage: 2, heat: 1, ranges: [1, 2, 4, 6], av: [2] },
    }));

    expect(alphaStrikeWeaponConversionMetadata(microLaser.equipment).pointDefense).toBeTrue();
    expect([0, 1, 2, 3].map(range => battleForceDamageForMount(entity, microLaser, range as AlphaStrikeRangeIndex)))
      .toEqual([0.2, 0, 0, 0]);
  });

  it('excludes machine-gun array controllers while retaining member-weapon conversion', () => {
    const entity = new TestBipedMekEntity();
    const controller = mount(entity, weapon('CLMGA', {
      flags: ['F_MGA'], weapon: { damage: 2, ranges: [1, 2, 3, 4], ammoType: 'MG' },
    }));
    const machineGun = mount(entity, weapon('CLMG', {
      flags: ['F_MG'], weapon: { damage: 2, ranges: [1, 2, 3, 4], ammoType: 'MG' },
    }));

    expect([0, 1, 2, 3].map(range => battleForceDamageForMount(entity, controller, range as AlphaStrikeRangeIndex)))
      .toEqual([0, 0, 0, 0]);
    expect(battleForceDamageForMount(entity, machineGun, 0)).toBe(0.2);
  });

  it('derives weapon conversion metadata from canonical flags and ammunition', () => {
    const artillery = weapon('Arrow IV', {
      flags: ['F_ARTILLERY'], tech: { base: 'Clan' },
      weapon: { damage: 'artillery', ammoType: 'ARROW_IV' },
    });
    const pointDefense = weapon('AMS', {
      flags: ['F_AMS'], weapon: { ammoType: 'AMS' },
    });
    const torpedo = weapon('LRT 10', {
      weapon: { ammoType: 'LRM_TORPEDO' },
    });

    expect(alphaStrikeWeaponConversionMetadata(artillery)).toEqual(jasmine.objectContaining({
      artilleryDamage: true, artillerySUA: 'ARTAC',
    }));
    expect(alphaStrikeWeaponConversionMetadata(pointDefense).pointDefense).toBeTrue();
    expect(alphaStrikeWeaponConversionMetadata(torpedo).primaryClass).toBeNull();
  });

  it('uses Java arced classes for capital missiles and all sub-capital weapons', () => {
    const capitalMissile = weapon('Capital Missile', {
      flags: ['F_MISSILE'], weapon: { capital: true, ammoType: 'PIRANHA' },
    });
    const subCapitalMissile = weapon('Sub-Capital Missile', {
      flags: ['F_MISSILE'], weapon: { subCapital: true, ammoType: 'PIRANHA' },
    });
    const subCapitalLaser = weapon('Sub-Capital Laser', {
      weapon: { subCapital: true, ammoType: 'NA' },
    });

    expect(alphaStrikeWeaponConversionMetadata(capitalMissile).primaryClass).toBe('MSL');
    expect(alphaStrikeWeaponConversionMetadata(subCapitalMissile).primaryClass).toBe('SCAP');
    expect(alphaStrikeWeaponConversionMetadata(subCapitalLaser).primaryClass).toBe('SCAP');
  });

  it('uses capital weapons’ canonical Alpha Strike attack values by range', () => {
    const entity = new TestBipedMekEntity();
    const capital = mount(entity, weapon('NAC/20', {
      weapon: {
        capital: true, damage: 200, av: [200, 160, 100, 40],
        ranges: [12, 24, 40, 50], ammoType: 'NAC',
      },
    }));

    expect([0, 1, 2, 3].map(range => battleForceDamageForMount(entity, capital, range as AlphaStrikeRangeIndex)))
      .toEqual([200, 160, 100, 40]);
  });

  it('falls back for custom numeric and cluster weapons', () => {
    const entity = new TestBipedMekEntity();
    const numeric = mount(entity, weapon('Custom Numeric', {
      weapon: { damage: 10, ranges: [5, 10, 20, 24], ammoType: 'NA' },
    }));
    const cluster = mount(entity, weapon('Custom SRM', {
      flags: ['F_SRM'],
      weapon: { damage: 'cluster', rackSize: 6, ranges: [3, 6, 9, 12], ammoType: 'SRM' },
    }));

    expect(battleForceDamageForMount(entity, numeric, 2)).toBe(1);
    expect(battleForceDamageForMount(entity, numeric, 3)).toBe(0);
    expect(battleForceDamageForMount(entity, cluster, 0)).toBe(0.8);
  });

  it('preserves minimum-range and to-hit fallback adjustments', () => {
    const adjusted = weapon('Custom Adjusted', {
      stats: { toHitModifier: 1 },
      weapon: { damage: 12, minRange: 6, ranges: [7, 14, 21, 28], ammoType: 'NA' },
    });

    expect(legacyBattleForceDamageFallback(adjusted, 0)).toBeCloseTo(0.57, 12);
    expect(legacyBattleForceDamageFallback(adjusted, 1)).toBeCloseTo(1.14, 12);
  });

  it('rejects an invalid runtime range index', () => {
    const entity = new TestBipedMekEntity();
    const mounted = mount(entity, weapon('Medium Laser'));

    expect(() => battleForceDamageForMount(entity, mounted, 4 as AlphaStrikeRangeIndex))
      .toThrowError(RangeError, /0 through 3/);
  });
});
