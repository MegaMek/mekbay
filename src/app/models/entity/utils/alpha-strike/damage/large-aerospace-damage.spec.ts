import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../../../equipment.model';
import type { EquipmentFlag } from '../../../../equipment-flags.type';
import { TestDropShipEntity as DropShipEntity } from '../../../testing/test-entities';
import { addTestEquipment } from '../../../testing/test-mounted-equipment';
import { calculateLargeAerospaceDamage, largeAerospaceHeatAdjustmentFactor } from './large-aerospace-damage';

function weapon(
  id: string,
  flags: EquipmentFlag[] = [],
  overrides: Partial<ConstructorParameters<typeof WeaponEquipment>[0]> = {},
): WeaponEquipment {
  return new WeaponEquipment({
    id, name: id, type: 'weapon', flags,
    weapon: { damage: 10, heat: 0, ranges: [6, 12, 20, 25], ammoType: 'NA', ...overrides.weapon },
    ...overrides,
  });
}

describe('large aerospace damage', () => {
  it('keeps STD, CAP, SCAP, and subcapital missiles mutually exclusive', () => {
    const entity = new DropShipEntity();
    entity.heatSinkCount.set(200);
    addTestEquipment(entity, weapon('Medium Laser'), { location: 'Nose' });
    addTestEquipment(entity, weapon('Naval Autocannon (NAC/10)', [], {
      weapon: { capital: true, damage: 100, ranges: [6, 12, 20, 25], ammoType: 'NAC' },
    }), { location: 'Nose' });
    addTestEquipment(entity, weapon('Sub-Capital Laser /1', [], {
      weapon: { subCapital: true, damage: 10, ranges: [6, 12, 20, 25], ammoType: 'NA' },
    }), { location: 'Nose' });
    addTestEquipment(entity, weapon('Sub-Capital Missile Launcher (Piranha)', ['F_MISSILE'], {
      weapon: { subCapital: true, damage: 30, ranges: [6, 12, 20, 25], ammoType: 'PIRANHA' },
    }), { location: 'Nose' });

    const arc = calculateLargeAerospaceDamage(entity).arcs.frontArc;

    expect(arc.STD.dmgS).toBe('1');
    expect(arc.CAP.dmgS).toBe('100');
    expect(arc.SCAP.dmgS).toBe('40');
    expect(arc.MSL.dmgS).toBe('0');
    expect(calculateLargeAerospaceDamage(entity).arcs.leftArc.STD.dmgS).toBe('0');
    expect(arc.specials).not.toContain('CAP');
    expect(arc.specials).not.toContain('SCAP');
    expect(arc.specials).not.toContain('MSL');
  });

  it('applies one-shot and targeting-computer damage multipliers without ammo penalties', () => {
    const entity = new DropShipEntity();
    entity.heatSinkCount.set(100);
    const oneShot = weapon('LRM 5 (OS)', ['F_LRM', 'F_ONE_SHOT'], {
      weapon: { damage: 'cluster', rackSize: 5, ranges: [7, 14, 21, 28], ammoType: 'LRM' },
    });
    const directFire = weapon('Medium Laser', ['F_DIRECT_FIRE']);
    addTestEquipment(entity, oneShot, { location: 'Nose' });
    addTestEquipment(entity, directFire, { location: 'Nose' });
    addTestEquipment(entity, new MiscEquipment({
      id: 'Targeting Computer', name: 'Targeting Computer', type: 'misc', flags: ['F_TARGETING_COMPUTER'],
    }), { location: 'Nose' });

    const arc = calculateLargeAerospaceDamage(entity).arcs.frontArc;

    expect(arc.STD.dmgS).toBe('2');
  });

  it('emits FLK and PNT arc abilities with their canonical rounding', () => {
    const entity = new DropShipEntity();
    entity.heatSinkCount.set(100);
    addTestEquipment(entity, weapon('CLLBXAC10', [], {
      weapon: { rackSize: 10, ranges: [6, 12, 18, 24], ammoType: 'AC_LBX' },
    }), { location: 'Nose' });
    addTestEquipment(entity, weapon('Laser AMS', ['F_AMS']), { location: 'Nose' });

    expect(calculateLargeAerospaceDamage(entity).arcs.frontArc.specials)
      .toEqual(['ENE', 'FLK1/1/1/-', 'PNT1']);
  });

  it('assigns fixed short-range point-defense damage to AMS', () => {
    const entity = new DropShipEntity();
    entity.heatSinkCount.set(100);
    addTestEquipment(entity, weapon('ISAntiMissileSystem', ['F_AMS']), { location: 'Nose' });

    const arc = calculateLargeAerospaceDamage(entity).arcs.frontArc;

    expect(arc.STD.dmgS).toBe('0');
    expect(arc.specials).toEqual(['ENE', 'PNT1']);
  });

  it('aggregates artillery counts in the weapon arc without adding primary damage', () => {
    const entity = new DropShipEntity();
    entity.heatSinkCount.set(500);
    for (let count = 0; count < 4; count++) {
      addTestEquipment(entity, weapon('ISCruiseMissile50', ['F_ARTILLERY'], {
        weapon: { damage: 'artillery', rackSize: 50, ammoType: 'CRUISE_MISSILE' },
      }), { location: 'Nose' });
    }

    const arc = calculateLargeAerospaceDamage(entity).arcs.frontArc;

    expect(arc.STD.dmgS).toBe('0');
    expect(arc.specials).toContain('ARTCM5-4');
  });

  it('emits canonical tele-missile and Narc-family arc abilities', () => {
    const entity = new DropShipEntity();
    entity.heatSinkCount.set(500);
    addTestEquipment(entity, weapon('ISNarcBeacon (OS)', ['F_NARC', 'F_ONE_SHOT'], {
      weapon: { ammoType: 'NARC' },
    }), { location: 'Nose' });
    addTestEquipment(entity, weapon('Tele-operated Missile', ['F_TELE_MISSILE']), {
      location: 'Nose',
    });

    const specials = calculateLargeAerospaceDamage(entity).arcs.frontArc.specials;

    expect(specials).toContain('SNARC');
    expect(specials).toContain('TELE');
  });

  it('does not let an inert explosive weapon definition block ENE', () => {
    const entity = new DropShipEntity();
    const autocannon = new WeaponEquipment({
      id: 'Custom Inert Autocannon', name: 'Custom Inert Autocannon', type: 'weapon', flags: [],
      stats: { explosive: true },
      weapon: { damage: 5, heat: 1, explosionDamage: 0, ranges: [6, 12, 18, 24], ammoType: 'AC' },
    });
    addTestEquipment(entity, autocannon, { location: 'Nose' });

    expect(calculateLargeAerospaceDamage(entity).arcs.frontArc.specials).toContain('ENE');
  });

  it('does not treat naval Gauss ammunition as an explosive component', () => {
    const entity = new DropShipEntity();
    const ammo = new AmmoEquipment({
      id: 'Ammo Heavy N-Gauss', name: 'Heavy N-Gauss Ammo', type: 'ammo', flags: [],
      stats: { explosive: true },
      ammo: { type: 'HEAVY_NGAUSS', damagePerShot: 40, shots: 1 },
    });
    addTestEquipment(entity, ammo, { location: 'Nose' });

    expect(calculateLargeAerospaceDamage(entity).arcs.frontArc.specials).toContain('ENE');
  });

  it('applies one global heat factor to every class, arc, and range', () => {
    const entity = new DropShipEntity();
    entity.heatSinkCount.set(10);
    const nac = () => weapon('Naval Autocannon (NAC/10)', [], {
      weapon: { capital: true, damage: 100, heat: 30, ranges: [6, 12, 20, 25], ammoType: 'NAC' },
    });
    addTestEquipment(entity, nac(), { location: 'Nose' });
    addTestEquipment(entity, nac(), { location: 'Aft' });

    const result = calculateLargeAerospaceDamage(entity);

    expect(result.heatAdjustmentFactor).toBeCloseTo(10 / 56, 10);
    expect(result.arcs.frontArc.CAP.dmgS).toBe('18');
    expect(result.arcs.rearArc.CAP.dmgL).toBe('18');
  });

  it('does not adjust at the heat-capacity plus four boundary', () => {
    const entity = new DropShipEntity();
    entity.heatSinkCount.set(26);
    addTestEquipment(entity, weapon('Naval Autocannon (NAC/10)', [], {
      weapon: { capital: true, damage: 100, heat: 30, ranges: [6, 12, 20, 25], ammoType: 'NAC' },
    }), { location: 'Nose' });

    expect(largeAerospaceHeatAdjustmentFactor(entity)).toBe(1);
  });

  it('uses Alpha Strike heat overrides while retaining one-shot weapon heat', () => {
    const entity = new DropShipEntity();
    entity.heatSinkCount.set(10);
    addTestEquipment(entity, weapon('ISERLargeLaserPrototype', [], {
      weapon: { heat: 12, damage: 10, ranges: [7, 14, 21, 28], ammoType: 'NA' },
    }), { location: 'Nose' });
    addTestEquipment(entity, weapon('One-Shot Laser', ['F_ONE_SHOT'], {
      weapon: { heat: 5, damage: 10, ranges: [7, 14, 21, 28], ammoType: 'NA' },
    }), { location: 'Nose' });

    expect(largeAerospaceHeatAdjustmentFactor(entity)).toBeCloseTo(10 / 16, 12);
  });

  it('returns zero damage and a finite factor for an unarmed zero-capacity unit', () => {
    const result = calculateLargeAerospaceDamage(new DropShipEntity());
    expect(result.heatAdjustmentFactor).toBe(1);
    expect(result.arcs.frontArc.STD.dmgS).toBe('0');
    expect(result.arcs.frontArc.specials).toEqual(['ENE']);
  });
});
