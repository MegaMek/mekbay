import {
  AmmoEquipment,
  ArmorEquipment,
  MiscEquipment,
  StructureEquipment,
  WeaponEquipment,
} from '../../../equipment.model';
import { MountedArmor } from '../../components/armor';
import { MountedStructure } from '../../components/structure';
import {
  TestAeroSpaceFighterEntity,
  TestBattleArmorEntity,
  TestBipedMekEntity,
  TestDropShipEntity,
  TestFixedWingSupportEntity,
  TestHandheldWeaponEntity,
  TestInfantryEntity,
  TestJumpShipEntity,
  TestProtoMekEntity,
  TestSpaceStationEntity,
  TestSupportTankEntity,
  TestTankEntity,
  TestWarShipEntity,
} from '../../testing/test-entities';
import { BV_MOVEMENT_CALCULATION, EntityMountedEquipment } from '../../types';
import { calculateBattleValue, calculateBattleValueDetails, getBVCalculator } from './factory';
import type { BattleValueDetail } from './bv-calculator';
import { infantryDamageDivisor } from './infantry-rules';
import { offensiveSpeedFactor, targetMovementModifier, vehicleTypeModifier } from './rules';
import {
  CombatVehicleBVCalculator,
  DropShipBVCalculator,
  MekBVCalculator,
  ProtoMekBVCalculator,
} from './family-calculators';

let mountSequence = 0;

function mount(equipment: WeaponEquipment | AmmoEquipment | MiscEquipment, location = 'Front'): EntityMountedEquipment {
  return new EntityMountedEquipment({
    mountId: `${equipment.id}-${++mountSequence}`, equipmentId: equipment.id, equipment,
    allocation: { kind: 'location', location }, rearMounted: false,
    turretMounted: false, omniPodMounted: false, armored: false,
  });
}

function findDetail(details: readonly BattleValueDetail[], type: string): BattleValueDetail | undefined {
  for (const detail of details) {
    if (detail.type === type) return detail;
    const nested = detail.details && findDetail(detail.details, type);
    if (nested) return nested;
  }
  return undefined;
}

describe('battle value pure rules', () => {
  it('ports MegaMek movement and speed tables', () => {
    expect(targetMovementModifier(0)).toBe(0);
    expect(targetMovementModifier(0, true)).toBe(0);
    expect(targetMovementModifier(5)).toBe(2);
    expect(targetMovementModifier(18)).toBe(5);
    expect(targetMovementModifier(7, true)).toBe(4);
    expect(offensiveSpeedFactor(5)).toBe(1);
    expect(offensiveSpeedFactor(8)).toBe(1.37);
  });

  it('ports combat vehicle type modifiers', () => {
    expect(vehicleTypeModifier('Tracked')).toBe(0.9);
    expect(vehicleTypeModifier('Hover')).toBe(0.7);
    expect(vehicleTypeModifier('Naval')).toBe(0.6);
  });
});

describe('battle value family dispatch', () => {
  it('adds MegaMek prototype laser heat bonuses', () => {
    class ExposedMekCalculator extends MekBVCalculator {
      heatOf(item: EntityMountedEquipment): number { return this.weaponHeat(item); }
    }
    const entity = new TestBipedMekEntity();
    const prototype = new WeaponEquipment({ id: 'ISERLargeLaserPrototype',
      name: 'Prototype ER Large Laser', type: 'weapon', weapon: { heat: 12 }, stats: { bv: 136 } });
    prototype.weapon.heatAdjustmentForBvCalculation = 3;
    expect(new ExposedMekCalculator(entity).heatOf(mount(prototype, 'RA'))).toBe(15);
  });

  it('applies arm AES to offensive club equipment', () => {
    class ExposedMekCalculator extends MekBVCalculator {
      modifier(item: EntityMountedEquipment): number { return this.offensiveEquipmentModifier(item); }
    }
    const entity = new TestBipedMekEntity();
    const aes = new MiscEquipment({ id: 'aes', name: 'AES', type: 'misc',
      flags: ['F_ACTUATOR_ENHANCEMENT_SYSTEM'] });
    const club = new MiscEquipment({ id: 'club', name: 'Club', type: 'misc', flags: ['F_CLUB'] });
    const clubMount = mount(club as never, 'RA');
    entity.setEquipment([mount(aes as never, 'RA'), clubMount]);
    expect(new ExposedMekCalculator(entity).modifier(clubMount)).toBe(1.25);
  });

  it('dispatches modeled families like MegaMek', () => {
    expect(getBVCalculator(new TestBipedMekEntity())).toBeInstanceOf(MekBVCalculator);
    expect(getBVCalculator(new TestTankEntity())).toBeInstanceOf(CombatVehicleBVCalculator);
    expect(getBVCalculator(new TestProtoMekEntity())).toBeInstanceOf(ProtoMekBVCalculator);
  });

  it('calculates from canonical equipment and ignores manual BV', () => {
    const entity = new TestTankEntity();
    entity.setTonnage(20);
    entity.originalWalkMP.set(4);
    entity.manualBV.set(9999);
    const laser = new WeaponEquipment({
      id: 'test-laser', name: 'Test Laser', type: 'weapon', stats: { bv: 100 },
      weapon: { ammoType: 'NA', heat: 0 }, flags: ['F_ENERGY'],
    });
    entity.setEquipment([mount(laser)]);
    const bv = getBVCalculator(entity).calculateBaseBV();
    expect(bv).toBeGreaterThan(0);
    expect(bv).not.toBe(9999);
  });

  it('calculates ProtoMek melee BV before the fixed-zero equipment fallback', () => {
    const entity = new TestProtoMekEntity();
    entity.setTonnage(7);
    const qms = new MiscEquipment({
      id: 'ProtoQuadMeleeSystem', name: 'ProtoMech Quad Melee System', type: 'misc',
      stats: { bv: 0 }, flags: ['F_PROTOMEK_MELEE', 'S_PROTO_QMS'],
    });
    const qmsMount = mount(qms as never, 'Torso');
    expect(qmsMount.getBV(entity)).toBe(5);
  });

  it('composes infantry armor, augmentation, and beast damage divisors', () => {
    const entity = new TestInfantryEntity();
    entity.augmentations.set(['tsm_implant', 'dermal_armor']);
    entity.mount.set({ damageDivisor: 2 } as never);
    expect(infantryDamageDivisor(entity)).toBe(3);
  });
});

describe('structured battle value details', () => {
  it('counts fixed-wing support weapons at full BV without heat tracking', () => {
    const entity = new TestFixedWingSupportEntity();
    entity.structuralIntegrity.set(5);
    entity.armorValues.set(new Map([['Nose', { front: 55, rear: 0 }]]));
    const hotLaser = new WeaponEquipment({
      id: 'hot-laser', name: 'Hot Laser', type: 'weapon', stats: { bv: 100 },
      weapon: { heat: 20 }, flags: ['F_ENERGY'],
    });
    const advancedFireControl = new MiscEquipment({
      id: 'advanced-fire-control', name: 'Advanced Fire Control', type: 'misc',
      flags: ['F_ADVANCED_FIRE_CONTROL'],
    });
    entity.setEquipment([
      mount(hotLaser, 'Nose'), mount(hotLaser, 'Nose'), mount(advancedFireControl, 'Body'),
    ]);

    const details = calculateBattleValueDetails(entity).details;
    expect(findDetail(details, 'Heat Efficiency')).toBeUndefined();
    expect(findDetail(details, 'Weapons')?.delta).toBe(200);
    expect(findDetail(details, 'Structural Integrity')?.delta).toBe(10);
    expect(findDetail(details, 'Type Modifier')?.calculation).toContain('x 1');
  });

  it('uses the support vehicle BAR signal rather than armor material defaults', () => {
    const entity = new TestSupportTankEntity();
    entity.armorValues.set(new Map([['Front', { front: 10, rear: 0 }]]));
    entity.barRating.set(0);
    expect(findDetail(calculateBattleValueDetails(entity).details, 'Armor')?.delta).toBe(0);
    entity.barRating.set(6);
    expect(findDetail(calculateBattleValueDetails(entity).details, 'Armor')?.delta).toBe(15);
  });

  it('applies BAR 5 only to Commercial armor on Meks', () => {
    const entity = new TestBipedMekEntity();
    entity.armorValues.set(new Map([['CT', { front: 84, rear: 0 }]]));
    const commercial = new ArmorEquipment({
      id: 'Commercial Armor', name: 'Commercial Armor', type: 'armor',
      armor: { type: 'COMMERCIAL', bar: 5 },
    });
    const standard = new ArmorEquipment({
      id: 'Standard Armor', name: 'Standard Armor', type: 'armor',
      armor: { type: 'STANDARD', bar: 10 },
    });

    entity.setUniformArmor(new MountedArmor({ armor: commercial, techBase: 'IS' }));
    expect(findDetail(calculateBattleValueDetails(entity).details, 'Armor')?.delta).toBe(105);

    entity.setUniformArmor(new MountedArmor({ armor: standard, techBase: 'IS' }));
    expect(findDetail(calculateBattleValueDetails(entity).details, 'Armor')?.delta).toBe(210);
  });

  it('applies reinforced structure BV before the XXL engine modifier', () => {
    const entity = new TestBipedMekEntity();
    entity.setTonnage(60);
    entity.mountedEngine().type.set('XXL');
    entity.setUniformStructure(new MountedStructure({
      structure: new StructureEquipment({
        id: 'Reinforced', name: 'Reinforced Structure', type: 'structure',
        flags: ['F_REINFORCED'],
      }),
      techBase: 'IS',
      tonnage: 12,
    }));

    const structure = findDetail(calculateBattleValueDetails(entity).details, 'Internal Structure');
    const internalPoints = entity.totalInternalPoints();
    expect(internalPoints).toBeGreaterThan(0);
    expect(structure?.delta).toBe(internalPoints * 1.5 * 2 * 0.25);
    expect(structure?.calculation).toContain(`${internalPoints} x 1.5 x 2 x 0.25`);
  });

  it('counts HarJel defensively and modifies armor once in each occupied location', () => {
    const entity = new TestBipedMekEntity();
    entity.armorValues.set(new Map([
      ['CT', { front: 6, rear: 4 }],
      ['LT', { front: 8, rear: 2 }],
      ['RT', { front: 10, rear: 0 }],
    ]));
    const harjel2 = new MiscEquipment({ id: 'harjel-2', name: 'HarJel II', type: 'misc',
      flags: ['F_HARJEL_II'], stats: { bv: -1 } });
    const harjel3 = new MiscEquipment({ id: 'harjel-3', name: 'HarJel III', type: 'misc',
      flags: ['F_HARJEL_III'], stats: { bv: -2 } });
    entity.setEquipment([
      mount(harjel2, 'CT'), mount(harjel3, 'LT'), mount(harjel3, 'LT'),
    ]);
    const details = calculateBattleValueDetails(entity).details;

    expect(findDetail(details, 'Armor')?.delta).toBe(82.5);
    expect(findDetail(details, 'Defensive Equipment')?.delta).toBe(-5);
  });

  it('shares one state calculation while preserving the numeric API', () => {
    const entity = new TestTankEntity();
    entity.setTonnage(20);
    entity.originalWalkMP.set(4);
    const laser = new WeaponEquipment({
      id: 'test-laser', name: 'Test Laser', shortName: 'Test Laser', type: 'weapon', stats: { bv: 100 },
      weapon: { ammoType: 'NA', heat: 0 }, flags: ['F_ENERGY'],
    });
    entity.setEquipment([mount(laser)]);

    const result = calculateBattleValueDetails(entity);
    expect(result.base).toBe(calculateBattleValue(entity));
    expect(result.details.map(detail => detail.type)).toEqual([
      'Effective MP', 'Defensive Battle Rating', 'Offensive Battle Rating', 'Battle Value',
    ]);
    expect(findDetail(result.details, 'Weapons')?.details?.[0].type).toBe('Test Laser (Front)');
    expect(findDetail(result.details, 'Speed Factor')?.total).toBeCloseTo(result.offensive, 3);
    expect(findDetail(result.details, 'Base Unit BV')?.total).toBe(result.base);
    expect(JSON.parse(JSON.stringify(result.details))).toEqual(result.details);
  });

  it('emits zero-safe shared sections and finite totals for an empty entity', () => {
    const result = calculateBattleValueDetails(new TestTankEntity());
    expect(findDetail(result.details, 'Armor')?.delta).toBe(0);
    expect(findDetail(result.details, 'Weapons')?.delta).toBe(0);
    expect(findDetail(result.details, 'Base Unit BV')?.total).toBe(result.base);
    expect(result.details.every(detail => detail.type.length > 0)).toBeTrue();
    expect(Number.isFinite(result.base)).toBeTrue();
  });

  it('reports the Mek labels, formulas, heat sequence, overheat, weight, and speed used by Hellion P', () => {
    const entity = new TestBipedMekEntity();
    entity.setTonnage(30);
    entity.originalWalkMP.set(12);
    const hotLaser = new WeaponEquipment({
      id: 'hot-laser', name: 'Imp. Heavy Medium Laser', shortName: 'Imp. Heavy Medium Laser',
      type: 'weapon', stats: { bv: 93 }, weapon: { ammoType: 'NA', heat: 100 }, flags: ['F_ENERGY'],
    });
    entity.setEquipment([mount(hotLaser, 'LT'), mount(hotLaser, 'LT')]);

    const result = calculateBattleValueDetails(entity);
    expect(result.details[0]).toEqual({ type: 'Effective MP', calculation: 'R: 18, J: 0, U: 0' });
    expect(findDetail(result.details, 'Defensive Battle Rating')).toBeDefined();
    expect(findDetail(result.details, 'Internal Structure')?.calculation).toContain('x 1.5');
    expect(findDetail(result.details, 'Gyro')?.calculation).toContain('+ 30 x');
    expect(findDetail(result.details, 'Heat Efficiency')?.calculation).toContain('6 +');
    const weapons = findDetail(result.details, 'Weapons')?.details ?? [];
    expect(weapons.filter(detail => detail.type === 'Imp. Heavy Medium Laser (LT)').length).toBe(2);
    expect(weapons.some(detail => detail.calculation?.includes('(Overheat)'))).toBeTrue();
    expect(findDetail(result.details, 'Weight')?.calculation).toContain('+ 30');
    expect(findDetail(result.details, 'Speed Factor')?.calculation).toContain('x 2.72');
    expect(findDetail(result.details, 'Base Unit BV')?.calculation).toContain(', rn');
  });

  it('uses improved jump-jet heat for Mek BV heat efficiency', () => {
    const entity = new TestBipedMekEntity();
    entity.setTonnage(80);
    entity.originalWalkMP.set(4);
    entity.mountedEngine().type.set('Fusion');
    const improvedJumpJet = new MiscEquipment({
      id: 'improved-jump-jet', name: 'Improved Jump Jet', type: 'misc',
      stats: { tonnage: 2 }, flags: ['F_JUMP_JET', 'S_IMPROVED'],
    });
    entity.setEquipment(Array.from({ length: 6 }, () => mount(improvedJumpJet, 'LT')));

    const heatEfficiency = findDetail(calculateBattleValueDetails(entity).details, 'Heat Efficiency');
    expect(entity.computeJumpMP({
      ...BV_MOVEMENT_CALCULATION,
      includeAlternateJumpSystems: false,
    })).toBe(6);
    expect(heatEfficiency?.calculation).toContain('- 3 (Jump)');
  });

  it('uses the reduced explosive penalty for Magshot Gauss rifles', () => {
    const entity = new TestBipedMekEntity();
    const magshot = new WeaponEquipment({
      id: 'ISMagshotGR', name: 'Magshot Gauss Rifle', type: 'weapon',
      stats: { bv: 15, explosive: true, criticalSlots: 2 },
      weapon: { ammoType: 'MAGSHOT', explosionDamage: 3 },
      flags: ['F_GAUSS'],
    });
    entity.setEquipment([mount(magshot, 'LT')]);

    const explosive = findDetail(calculateBattleValueDetails(entity).details, 'Explosive Equipment');
    expect(explosive?.delta).toBe(-2);
  });

  it('groups equivalent large-aero PPCs and applies arc factors before capacitor BV', () => {
    class ExposedDropShipCalculator extends DropShipBVCalculator {
      factor = 1;
      protected override arcFactor(): number { return this.factor; }
      arcValue(): number {
        this.offensiveValue = 0;
        this.processArc(0, false);
        return this.offensiveValue;
      }
    }
    const entity = new TestDropShipEntity();
    const ppc = new WeaponEquipment({
      id: 'ISERPPC', name: 'ER PPC', type: 'weapon', stats: { bv: 229 },
      weapon: { heat: 15 }, flags: ['F_PPC', 'F_PPC_CAPACITOR_COMPATIBLE'],
    });
    const capacitor = new MiscEquipment({
      id: 'PPC Capacitor', name: 'PPC Capacitor', type: 'misc',
      stats: { bv: 0 }, flags: ['F_PPC_CAPACITOR'],
    });
    const ppc1 = mount(ppc, 'Nose');
    const capacitor1 = mount(capacitor, 'Nose');
    const ppc2 = mount(ppc, 'Nose');
    const capacitor2 = mount(capacitor, 'Nose');
    entity.setEquipment([ppc1, capacitor1, ppc2, capacitor2]);
    entity.linkEquipment(capacitor1, ppc1);
    entity.linkEquipment(capacitor2, ppc2);
    const calculator = new ExposedDropShipCalculator(entity);

    calculator.factor = 1;
    expect(calculator.arcValue()).toBe(572);
    calculator.factor = 0.5;
    expect(calculator.arcValue()).toBe(343);
    calculator.factor = 0.25;
    expect(calculator.arcValue()).toBe(228.5);
  });

  it('exposes reactive BaseEntity value and details computed from current state', () => {
    const entity = new TestTankEntity();
    entity.setTonnage(10);
    const initial = entity.battleValue();
    expect(entity.battleValueDetails()).toBe(entity.battleValueDetails());

    entity.setTonnage(30);
    expect(entity.battleValue()).not.toBe(initial);
    expect(findDetail(entity.battleValueDetails(), 'Weight')?.calculation).toContain('+ 30');
  });

  it('returns a coherent hierarchy for every calculator family', () => {
    const entities = [
      new TestBipedMekEntity(), new TestTankEntity(), new TestProtoMekEntity(),
      new TestInfantryEntity(), new TestBattleArmorEntity(), new TestAeroSpaceFighterEntity(),
      new TestDropShipEntity(), new TestJumpShipEntity(), new TestSpaceStationEntity(),
      new TestWarShipEntity(), new TestHandheldWeaponEntity(),
    ];
    for (const entity of entities) {
      const result = calculateBattleValueDetails(entity);
      expect(result.details.map(detail => detail.type)).withContext(entity.entityType).toEqual([
        'Effective MP', 'Defensive Battle Rating', 'Offensive Battle Rating', 'Battle Value',
      ]);
      expect(findDetail(result.details, 'Base Unit BV')?.total).withContext(entity.entityType).toBe(result.base);
      expect(Number.isFinite(result.base)).withContext(entity.entityType).toBeTrue();
    }
  });
});
