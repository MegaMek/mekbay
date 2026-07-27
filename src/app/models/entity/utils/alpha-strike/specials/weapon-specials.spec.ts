import { AmmoEquipment, WeaponEquipment } from '../../../../equipment.model';
import {
  TestBattleArmorEntity as BattleArmorEntity,
  TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestFixedWingSupportEntity as FixedWingSupportEntity,
  TestInfantryEntity as InfantryEntity,
  TestTankEntity as TankEntity,
} from '../../../testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../../testing/test-mounted-equipment';
import { alphaStrikeWeaponSpecials } from './weapon-specials';

describe('Alpha Strike weapon specials', () => {
  it('converts canonical discrete weapon abilities without equipment-name lookup', () => {
    const entity = new BipedMekEntity();
    addTestEquipment(entity, weapon('tag', ['F_TAG'], { ranges: [6, 12, 18, 24] }));
    addTestEquipment(entity, weapon('ams', ['F_AMS']));
    addTestEquipment(entity, weapon('inarc', [], { ammoType: 'INARC' }));
    addTestEquipment(entity, weapon('artillery', ['F_ARTILLERY'], {
      ammoType: 'SNIPER', damage: 'artillery', rackSize: 0,
    }));

    expect(alphaStrikeWeaponSpecials(entity)).toEqual(['AMS', 'ARTS-1', 'INARC', 'TAG']);
  });

  it('omits a Narc count of one and displays aggregated counts above one', () => {
    const entity = new BipedMekEntity();
    addTestEquipment(entity, weapon('snarc-1', [], { ammoType: 'NARC' }));
    expect(alphaStrikeWeaponSpecials(entity)).toContain('SNARC');

    addTestEquipment(entity, weapon('snarc-2', [], { ammoType: 'NARC' }));
    expect(alphaStrikeWeaponSpecials(entity)).toContain('SNARC2');
  });

  it('limits aerospace damage specials to the aerospace converter family', () => {
    const entity = new AeroSpaceFighterEntity();
    addTestEquipment(entity, weapon('aero-lrm', ['F_LRM', 'F_MISSILE', 'F_INDIRECT_FIRE'], {
      ammoType: 'LRM', alphaStrike: { battleForceClass: 'LRM', damage: [2, 2, 2, 0] },
    }), { location: 'Nose' });
    addTestEquipment(entity, weapon('aero-flak', [], {
      alphaStrike: { battleForceClass: 'FLAK', damage: [1, 1, 1, 1] },
    }), { location: 'Nose' });

    const specials = alphaStrikeWeaponSpecials(entity);
    expect(specials).toContain('FLK1/1/1/1');
    expect(specials).not.toContain(jasmine.stringMatching(/^IF/));
    expect(specials).not.toContain(jasmine.stringMatching(/^LRM/));
  });

  it('limits Battle Armor damage specials to IF and FLK', () => {
    const entity = new BattleArmorEntity();
    for (let trooper = 1; trooper <= 4; trooper++) {
      addTestEquipment(entity, weapon(`ba-lrm-${trooper}`, ['F_LRM', 'F_MISSILE', 'F_INDIRECT_FIRE'], {
        ammoType: 'LRM', alphaStrike: { battleForceClass: 'LRM', damage: [0.2, 0.2, 0.2, 0] },
      }), { location: `Trooper ${trooper}` });
    }
    addTestEquipment(entity, new AmmoEquipment({
      id: 'ba-lrm-ammo', name: 'BA LRM Ammo', type: 'ammo',
      ammo: { type: 'LRM', rackSize: 0, shots: 20 },
    }), { location: 'Squad', shotsCount: 20 });

    const specials = alphaStrikeWeaponSpecials(entity);
    expect(specials).toContain('IF1');
    expect(specials).not.toContain(jasmine.stringMatching(/^LRM/));
  });

  it('scales representative Battle Armor FLK damage without requiring non-missile ammo', () => {
    const entity = new BattleArmorEntity();
    for (let trooper = 1; trooper <= 4; trooper++) {
      addTestEquipment(entity, weapon(`ba-flak-${trooper}`, [], {
        ammoType: 'AC_LBX', alphaStrike: { battleForceClass: 'FLAK', damage: [0.3, 0.3, 0, 0] },
      }), { location: `Trooper ${trooper}` });
    }

    expect(alphaStrikeWeaponSpecials(entity)).toContain('FLK1/1/-');
  });

  it('serializes aerospace FLK across all four range bands', () => {
    const entity = new AeroSpaceFighterEntity();
    addTestEquipment(entity, weapon('aero-flak', [], {
      ammoType: 'NA', alphaStrike: { battleForceClass: 'FLAK', damage: [1, 1, 1, 0] },
    }), { location: 'Nose' });

    expect(alphaStrikeWeaponSpecials(entity)).toContain('FLK1/1/1/-');
  });

  it('applies standard-damage heat factors before special qualification and rounding', () => {
    const entity = new BipedMekEntity();
    addTestEquipment(entity, weapon('heat-limited-lrm', ['F_INDIRECT_FIRE'], {
      ammoType: 'NA', alphaStrike: { battleForceClass: 'LRM', damage: [2, 2, 2, 0] },
    }));

    const specials = alphaStrikeWeaponSpecials(entity, 'standard', [0.4, 0.4, 0.4, 0.4]);
    expect(specials).not.toContain(jasmine.stringMatching(/^LRM/));
    expect(specials).toContain('IF1');
  });

  it('emits BTAS once for representative Battle Armor tasers', () => {
    const entity = new BattleArmorEntity();
    for (let trooper = 1; trooper <= 4; trooper++) {
      addTestEquipment(entity, weapon(`ba-taser-${trooper}`, [], { ammoType: 'TASER' }), {
        location: `Trooper ${trooper}`,
      });
    }

    expect(alphaStrikeWeaponSpecials(entity)).toContain('BTAS1');
    expect(alphaStrikeWeaponSpecials(entity)).not.toContain(jasmine.stringMatching(/^MTAS/));
  });

  it('excludes Battle Armor squad-support tasers', () => {
    const entity = new BattleArmorEntity();
    addTestEquipment(entity, weapon('ba-support-taser', [], { ammoType: 'TASER' }), {
      location: 'Squad', isSSWM: true,
    });

    expect(alphaStrikeWeaponSpecials(entity)).not.toContain(jasmine.stringMatching(/TAS/));
  });

  it('excludes Battle Armor squad-support TAG from discrete abilities', () => {
    const entity = new BattleArmorEntity();
    addTestEquipment(entity, weapon('ba-support-tag', ['F_TAG'], { ranges: [3, 6, 9, 12] }), {
      location: 'Squad', isSSWM: true,
    });

    expect(alphaStrikeWeaponSpecials(entity)).not.toContain('LTAG');
  });

  it('converts TAG from conventional-infantry selected weapons', () => {
    const entity = new InfantryEntity();
    const tag = new WeaponEquipment({
      id: 'infantry-tag', name: 'Infantry TAG', type: 'weapon', flags: ['F_INFANTRY', 'F_TAG'],
      weapon: { ranges: [3, 6, 9, 12], ammoType: 'NA' }, infantry: {},
    });
    if (!tag.isInfantryWeapon()) throw new Error('Expected infantry weapon');
    entity.primaryWeapon.set(tag);
    entity.secondaryWeapon.set(tag);

    expect(alphaStrikeWeaponSpecials(entity)).toContain('LTAG');
  });

  it('excludes Battle Armor squad-support weapons from IF and FLK specials', () => {
    const entity = new BattleArmorEntity();
    addTestEquipment(entity, weapon('ba-squad-support-lrm', ['F_MISSILE', 'F_INDIRECT_FIRE'], {
      ammoType: 'LRM', alphaStrike: { battleForceClass: 'LRM', damage: [10, 10, 10, 0] },
    }), { location: 'Squad', isSSWM: true });

    expect(alphaStrikeWeaponSpecials(entity)).not.toContain(jasmine.stringMatching(/^(IF|FLK)/));
  });

  it('derives LRM, IF, and rear damage from canonical ammo, range, and mount orientation', () => {
    const entity = new BipedMekEntity();
    const lrm = weapon('lrm20', ['F_LRM', 'F_MISSILE', 'F_INDIRECT_FIRE'], {
      ammoType: 'LRM', damage: 'cluster', rackSize: 20, ranges: [7, 14, 21, 28],
      alphaStrike: { battleForceClass: 'LRM' },
    });
    addTestEquipment(entity, lrm, { location: 'RA' });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'lrm-ammo', name: 'LRM Ammo', type: 'ammo', ammo: { type: 'LRM', rackSize: 20, shots: 20 },
    }), { location: 'RT', shotsCount: 20 });
    addTestEquipment(entity, weapon('rear-laser', [], {
      damage: 10, ranges: [5, 10, 20, 24], ammoType: 'NA',
    }), { location: 'RT', rearMounted: true });

    expect(alphaStrikeWeaponSpecials(entity)).toEqual(['IF1', 'LRM1/1/1', 'REAR1/1/1']);
  });

  it('uses dashes, rather than zeroes or minimum damage, in ordinary special vectors', () => {
    const entity = new BipedMekEntity();
    addTestEquipment(entity, weapon('ac10', ['F_BALLISTIC'], {
      ammoType: 'AC', damage: 10, rackSize: 10, ranges: [5, 10, 10, 10],
      alphaStrike: { battleForceClass: 'AC' },
    }), { location: 'RA' });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'ac-ammo', name: 'AC Ammo', type: 'ammo', ammo: { type: 'AC', rackSize: 10, shots: 10 },
    }), { location: 'RT', shotsCount: 10 });

    expect(alphaStrikeWeaponSpecials(entity)).toEqual(['AC1/1/-']);
  });

  it('scopes damage and discrete abilities to the vehicle turret', () => {
    const entity = new TankEntity();
    addTestEquipment(entity, weapon('turret-lrm', ['F_LRM', 'F_MISSILE', 'F_TAG', 'F_INDIRECT_FIRE'], {
      ammoType: 'LRM', damage: 'cluster', rackSize: 20, ranges: [7, 14, 21, 28],
      alphaStrike: { battleForceClass: 'LRM' },
    }), { location: 'Turret' });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'turret-lrm-ammo', name: 'Turret LRM Ammo', type: 'ammo',
      ammo: { type: 'LRM', rackSize: 20, shots: 20 },
    }), { location: 'Body', shotsCount: 20 });

    expect(alphaStrikeWeaponSpecials(entity, 'turret')).toEqual(['IF1', 'LRM1/1/1', 'TAG']);
  });

  it('uses physical vehicle rear locations when constructing REAR', () => {
    const entity = new TankEntity();
    addTestEquipment(entity, weapon('rear-laser', [], {
      damage: 10, ranges: [5, 10, 20, 24], ammoType: 'NA',
    }), { location: 'Rear' });

    expect(alphaStrikeWeaponSpecials(entity)).toContain('REAR1/1/1');
  });

  it('serializes non-large aerospace REAR damage across all four range bands', () => {
    const entity = new FixedWingSupportEntity();
    addTestEquipment(entity, weapon('aft-laser', [], {
      damage: 10, ranges: [5, 10, 20, 30], ammoType: 'NA',
    }), { location: 'Aft' });

    expect(alphaStrikeWeaponSpecials(entity)).toContain('REAR1/1/1/-');
  });

  it('aggregates forward aerospace point defense with canonical rounding', () => {
    const entity = new AeroSpaceFighterEntity();
    for (let index = 0; index < 4; index++) {
      addTestEquipment(entity, weapon(`point-defense-${index}`, [], {
        alphaStrike: { pointDefense: true, damage: [0.3, 0, 0, 0] },
      }), { location: 'Nose' });
    }

    expect(alphaStrikeWeaponSpecials(entity)).toContain('PNT2');
  });

  it('uses fixed aerospace AMS point-defense damage and suppresses AMS', () => {
    const entity = new AeroSpaceFighterEntity();
    for (let index = 0; index < 3; index++) {
      addTestEquipment(entity, weapon(`ams-${index}`, ['F_AMS'], {
        damage: 100, alphaStrike: { pointDefense: true },
      }), { location: 'Nose' });
    }

    expect(alphaStrikeWeaponSpecials(entity)).toContain('PNT1');
    expect(alphaStrikeWeaponSpecials(entity)).not.toContain('AMS');
  });

  it('excludes aft point defense and does not grant PNT to ground units', () => {
    const fighter = new AeroSpaceFighterEntity();
    const pointDefense = weapon('point-defense', [], {
      alphaStrike: { pointDefense: true, damage: [1, 0, 0, 0] },
    });
    addTestEquipment(fighter, pointDefense, { location: 'Aft' });
    expect(alphaStrikeWeaponSpecials(fighter)).not.toContain(jasmine.stringMatching(/^PNT/));

    const mek = new BipedMekEntity();
    addTestEquipment(mek, pointDefense, { location: 'RA' });
    expect(alphaStrikeWeaponSpecials(mek)).not.toContain(jasmine.stringMatching(/^PNT/));
  });

  it('applies aerospace-fighter forward heat adjustment to PNT', () => {
    const entity = new AeroSpaceFighterEntity();
    entity.heatSinkCount.set(6);
    for (let index = 0; index < 3; index++) {
      addTestEquipment(entity, weapon(`hot-point-defense-${index}`, [], {
        heat: 4, alphaStrike: { pointDefense: true, damage: [0.8, 0, 0, 0] },
      }), { location: 'Nose' });
    }

    expect(alphaStrikeWeaponSpecials(entity)).toContain('PNT2');
  });

  it('aggregates artillery counts with Alpha Strike hyphenated notation', () => {
    const entity = new BipedMekEntity();
    addTestEquipment(entity, weapon('sniper-1', ['F_ARTILLERY'], {
      ammoType: 'SNIPER', damage: 'artillery', rackSize: 0,
    }));
    addTestEquipment(entity, weapon('sniper-2', ['F_ARTILLERY'], {
      ammoType: 'SNIPER', damage: 'artillery', rackSize: 0,
    }));

    expect(alphaStrikeWeaponSpecials(entity)).toContain('ARTS-2');
  });

  it('converts Battle Armor Narc to CNARC without squad-count scaling', () => {
    const entity = new BattleArmorEntity();
    for (let trooper = 1; trooper <= 4; trooper++) {
      addTestEquipment(entity, weapon(`narc-${trooper}`, [], { ammoType: 'NARC' }), {
        location: `Trooper ${trooper}`,
      });
    }

    expect(alphaStrikeWeaponSpecials(entity)).toContain('CNARC');
    expect(alphaStrikeWeaponSpecials(entity).some(special => special.startsWith('SNARC'))).toBeFalse();
  });

  it('does not apply the one-shot damage penalty when double-one-shot takes precedence', () => {
    const doubleOneShot = new BipedMekEntity();
    const ordinaryOneShot = new BipedMekEntity();
    for (let index = 0; index < 4; index++) {
      addTestEquipment(doubleOneShot, weapon(`double-one-shot-${index}`,
        ['F_MISSILE', 'F_ONE_SHOT', 'F_DOUBLE_ONE_SHOT'], {
          ammoType: 'IATM', alphaStrike: { battleForceClass: 'IATM', damage: [0.45, 0.3, 0, 0] },
        }));
      addTestEquipment(ordinaryOneShot, weapon(`one-shot-${index}`, ['F_MISSILE', 'F_ONE_SHOT'], {
        ammoType: 'IATM', alphaStrike: { battleForceClass: 'IATM', damage: [0.45, 0.3, 0, 0] },
      }));
    }

    expect(doubleOneShot.mountedWeapons()[0].equipment.oneShotCount).toBe(2);
    expect(alphaStrikeWeaponSpecials(doubleOneShot)).toContain('IATM2/1/-');
    expect(ordinaryOneShot.mountedWeapons()[0].equipment.oneShotCount).toBe(1);
    expect(alphaStrikeWeaponSpecials(ordinaryOneShot)).not.toContain(jasmine.stringMatching(/^IATM/));
  });

  it('uses BattleForce classes instead of misleading ammunition categories', () => {
    const entity = new BipedMekEntity();
    for (let index = 0; index < 10; index++) {
      addTestEquipment(entity, weapon(`re-engineered-${index}`, [], {
        ammoType: 'NA', damage: 1, ranges: [5, 10, 15, 20],
        alphaStrike: { battleForceClass: 'REL' },
      }));
    }
    addTestEquipment(entity, weapon('rocket-launcher', [], {
      ammoType: 'ROCKET_LAUNCHER', damage: 20, ranges: [5, 10, 15, 20],
    }));

    expect(alphaStrikeWeaponSpecials(entity)).toContain('REL');
    expect(alphaStrikeWeaponSpecials(entity)).not.toContain(jasmine.stringMatching(/^AC/));
  });

  it('retains unenhanced indirect fire for an Artemis-linked weapon', () => {
    const entity = new BipedMekEntity();
    const lrm = addTestEquipment(entity, weapon('artemis-lrm',
      ['F_MISSILE', 'F_INDIRECT_FIRE', 'F_ARTEMIS_COMPATIBLE'], {
      ammoType: 'LRM', damage: 'cluster', rackSize: 20, ranges: [7, 14, 21, 28],
      alphaStrike: { battleForceClass: 'LRM' },
      }), { location: 'RA' });
    const artemis = addTestEquipmentWithFlags(entity, 'F_ARTEMIS', { location: 'RA' });
    entity.linkEquipment(artemis, lrm);
    addTestEquipment(entity, new AmmoEquipment({
      id: 'artemis-lrm-ammo', name: 'Artemis LRM Ammo', type: 'ammo',
      ammo: { type: 'LRM', rackSize: 20, shots: 20 },
    }), { location: 'RT', shotsCount: 20 });

    expect(alphaStrikeWeaponSpecials(entity)).toContain('IF1');
    expect(alphaStrikeWeaponSpecials(entity)).not.toContain(jasmine.stringMatching(/^LRM/));
  });

  it('applies a same-arm actuator enhancement system to indirect-fire damage', () => {
    const entity = new BipedMekEntity();
    addTestEquipment(entity, weapon('aes-lrm', ['F_MISSILE', 'F_INDIRECT_FIRE'], {
      ammoType: 'NA', damage: 'cluster', rackSize: 10, ranges: [7, 14, 21, 28],
      alphaStrike: { battleForceClass: 'LRM', damage: [0.39, 0.39, 0.39, 0] },
    }), { location: 'RA' });
    addTestEquipmentWithFlags(entity, 'F_ACTUATOR_ENHANCEMENT_SYSTEM', { location: 'RA' });

    expect(alphaStrikeWeaponSpecials(entity)).toContain('IF1');
  });

  it('does not apply an opposite-arm actuator enhancement system', () => {
    const entity = new BipedMekEntity();
    addTestEquipment(entity, weapon('unenhanced-lrm', ['F_MISSILE', 'F_INDIRECT_FIRE'], {
      ammoType: 'NA', damage: 'cluster', rackSize: 10, ranges: [7, 14, 21, 28],
      alphaStrike: { battleForceClass: 'LRM', damage: [0.39, 0.39, 0.39, 0] },
    }), { location: 'RA' });
    addTestEquipmentWithFlags(entity, 'F_ACTUATOR_ENHANCEMENT_SYSTEM', { location: 'LA' });

    expect(alphaStrikeWeaponSpecials(entity)).toContain('IF0*');
  });

  it('honors an explicit Alpha Strike indirect-fire override', () => {
    const entity = new BipedMekEntity();
    addTestEquipment(entity, weapon('iatm', ['F_MISSILE', 'F_INDIRECT_FIRE'], {
      ammoType: 'IATM', damage: 'cluster', rackSize: 9, ranges: [5, 10, 15, 20],
      alphaStrike: { battleForceClass: 'IATM', indirectFire: false, damage: [2.7, 1.8, 0.9, 0] },
    }));

    expect(entity.mountedWeapons()[0].equipment.alphaStrikeIndirectFire).toBeFalse();
    expect(alphaStrikeWeaponSpecials(entity)).not.toContain(jasmine.stringMatching(/^IF/));
  });
});

function weapon(
  id: string,
  flags: ConstructorParameters<typeof WeaponEquipment>[0]['flags'] = [],
  data: Partial<ConstructorParameters<typeof WeaponEquipment>[0]['weapon']> = {},
): WeaponEquipment {
  return new WeaponEquipment({
    id,
    name: id,
    type: 'weapon',
    flags,
    weapon: { damage: 0, rackSize: 0, ranges: [0, 0, 0, 0], ammoType: 'NA', ...data },
  });
}
