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
  WarShipBVCalculator,
} from './family-calculators';
import { EquipmentFlag } from '../../../equipment-flags.type';

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

describe('WarShip BV arcs', () => {
  class ExposedWarShipCalculator extends WarShipBVCalculator {
    arcFor(item: EntityMountedEquipment): number { return this.arc(item); }
  }

  const weapon = new WeaponEquipment({
    id: 'capital-laser', name: 'Capital Laser', type: 'weapon',
    weapon: { damage: 1 },
  });

  it('maps canonical broadside locations to separate Java BV arcs', () => {
    const calculator = new ExposedWarShipCalculator(new TestWarShipEntity());

    expect(calculator.arcFor(mount(weapon, 'Left Broadside'))).toBe(6);
    expect(calculator.arcFor(mount(weapon, 'Right Broadside'))).toBe(7);
  });

  it('uses the Java right-broadside fallback for an unknown location', () => {
    const calculator = new ExposedWarShipCalculator(new TestWarShipEntity());

    expect(calculator.arcFor(mount(weapon, 'Unknown'))).toBe(7);
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

  it('uses semantic vibroblade sizes for Mek BV heat', () => {
    class ExposedMekCalculator extends MekBVCalculator {
      heatOf(item: EntityMountedEquipment): number { return this.weaponHeat(item); }
    }
    const calculator = new ExposedMekCalculator(new TestBipedMekEntity());
    const vibroblade = (sizeFlag: EquipmentFlag) => new MiscEquipment({
      id: sizeFlag, name: sizeFlag, type: 'misc', flags: ['F_CLUB', sizeFlag], stats: { bv: 1 },
    });
    const unrelated = new MiscEquipment({ id: 'club', name: 'Club', type: 'misc', flags: ['F_CLUB'] });

    expect(calculator.heatOf(mount(vibroblade('S_VIBRO_SMALL'), 'LA'))).toBe(3);
    expect(calculator.heatOf(mount(vibroblade('S_VIBRO_MEDIUM'), 'LA'))).toBe(5);
    expect(calculator.heatOf(mount(vibroblade('S_VIBRO_LARGE'), 'LA'))).toBe(7);
    expect(calculator.heatOf(mount(vibroblade('S_VIBRO_SMALL'), 'LT'))).toBe(0);
    expect(calculator.heatOf(mount(vibroblade('S_VIBRO_SMALL'), 'RA'))).toBe(3);
    expect(calculator.heatOf(mount(unrelated, 'LA'))).toBe(0);

    const leftBlade = mount(vibroblade('S_VIBRO_MEDIUM'), 'LA');
    const rightBlade = mount(vibroblade('S_VIBRO_LARGE'), 'RA');
    const twoArmEntity = new TestBipedMekEntity();
    twoArmEntity.setEquipment([leftBlade, rightBlade]);
    const twoArmCalculator = new ExposedMekCalculator(twoArmEntity);
    expect(twoArmCalculator.heatOf(leftBlade)).toBe(5);
    expect(twoArmCalculator.heatOf(rightBlade)).toBe(7);
  });

  it('uses airborne AirMek flank movement for standard LAM defensive TMM', () => {
    class ExposedMekCalculator extends MekBVCalculator {
      runningModifier(): number {
        this.prepare();
        return this.runningTmm();
      }
    }
    class StandardLamHarness extends TestBipedMekEntity {
      override isLandAirMek(): boolean { return true; }
      override airMekFlankMP(): number { return 10; }
    }
    const groundMek = new TestBipedMekEntity();
    groundMek.originalWalkMP.set(3);

    expect(new ExposedMekCalculator(new StandardLamHarness()).runningModifier()).toBe(5);
    expect(new ExposedMekCalculator(groundMek).runningModifier()).toBe(2);
  });

  it('keeps zero AirMek flank movement at zero TMM', () => {
    class ExposedMekCalculator extends MekBVCalculator {
      runningModifier(): number { return this.runningTmm(); }
    }
    class ImmobileLamHarness extends TestBipedMekEntity {
      override isLandAirMek(): boolean { return true; }
      override airMekFlankMP(): number { return 0; }
    }

    expect(new ExposedMekCalculator(new ImmobileLamHarness()).runningModifier()).toBe(0);
  });

  it('applies Mek summary modifier precedence without stacking cockpit and drone reductions', () => {
    class ExposedMekCalculator extends MekBVCalculator {
      summary(value: number): number { return this.summarize(value); }
    }
    const drone = new MiscEquipment({
      id: 'Drone OS', name: 'Drone OS', type: 'misc', flags: ['F_DRONE_OPERATING_SYSTEM'],
    });
    const standard = new TestBipedMekEntity();
    standard.setEquipment([mount(drone, 'CT')]);
    expect(new ExposedMekCalculator(standard).summary(100)).toBe(95);

    const small = new TestBipedMekEntity();
    small.cockpitType.set('Small');
    small.setEquipment([mount(drone, 'CT')]);
    expect(new ExposedMekCalculator(small).summary(100)).toBe(95);

    const virtualReality = new TestBipedMekEntity();
    virtualReality.cockpitType.set('Virtual Reality Piloting Pod');
    expect(new ExposedMekCalculator(virtualReality).summary(100)).toBe(140);
    virtualReality.hasRiscHeatSinkOverrideKit.set(true);
    expect(new ExposedMekCalculator(virtualReality).summary(100)).toBeCloseTo(141.4, 10);
  });

  it('counts both equipment items in a superheavy combined critical slot', () => {
    const primary = new AmmoEquipment({
      id: 'primary-ammo', name: 'Primary Ammo', type: 'ammo', stats: { bv: 10 },
      ammo: { type: 'AC', rackSize: 10, shots: 10 },
    });
    const secondary = new AmmoEquipment({
      id: 'secondary-ammo', name: 'Secondary Ammo', type: 'ammo', stats: { bv: 20 },
      ammo: { type: 'GAUSS', rackSize: 15, shots: 8 },
    });
    const entity = new TestBipedMekEntity();
    entity.setTonnage(150);
    entity.setEquipment([mount(primary, 'RT'), mount(secondary, 'RT')]);

    const items = entity.equipment();
    expect(items.map(item => item.equipment?.id)).toEqual([primary.id, secondary.id]);
    expect(items[1].location).toBe('RT');
  });

  it('treats a PPC as explosive only when linked to a capacitor', () => {
    class ExposedMekCalculator extends MekBVCalculator {
      explosive(mounted: EntityMountedEquipment): boolean { return this.isExplosive(mounted); }
    }
    const ppc = new WeaponEquipment({
      id: 'ppc', name: 'PPC', type: 'weapon', flags: ['F_PPC', 'F_PPC_CAPACITOR_COMPATIBLE'],
      stats: { explosive: false }, weapon: { heat: 10, damage: 10, ammoType: 'NA' },
    });
    const capacitor = new MiscEquipment({
      id: 'capacitor', name: 'PPC Capacitor', type: 'misc', flags: ['F_PPC_CAPACITOR'],
    });
    const ppcMount = mount(ppc, 'RA');
    const capacitorMount = mount(capacitor, 'RA');
    const entity = new TestBipedMekEntity();
    entity.setEquipment([ppcMount, capacitorMount]);
    const calculator = new ExposedMekCalculator(entity);
    expect(calculator.explosive(ppcMount)).toBeFalse();

    entity.linkEquipment(capacitorMount, ppcMount);
    expect(calculator.explosive(ppcMount)).toBeTrue();
  });

  it('applies MegaMek switched-arc turret semantics to superheavy vehicles', () => {
    class ExposedVehicleCalculator extends CombatVehicleBVCalculator {
      switchedRear(mounted: EntityMountedEquipment): boolean {
        this.switchRearAndFront = true;
        return this.isNominalRear(mounted);
      }
    }
    const weapon = new WeaponEquipment({
      id: 'test-weapon', name: 'Test Weapon', type: 'weapon', weapon: { ammoType: 'NA' },
    });
    const ordinary = new TestTankEntity();
    const ordinaryCalculator = new ExposedVehicleCalculator(ordinary);
    expect(ordinaryCalculator.switchedRear(mount(weapon, 'Turret'))).toBeFalse();

    const superheavy = new TestTankEntity();
    superheavy.setTonnage(200);
    const superheavyCalculator = new ExposedVehicleCalculator(superheavy);
    expect(superheavyCalculator.switchedRear(mount(weapon, 'Turret'))).toBeTrue();
    expect(superheavyCalculator.switchedRear(mount(weapon, 'Rear Left'))).toBeFalse();
    expect(superheavyCalculator.switchedRear(mount(weapon, 'Rear'))).toBeFalse();
  });

  it('does not grant vehicle stealth TMM when movement is zero', () => {
    const entity = new TestTankEntity();
    const stealth = new ArmorEquipment({
      id: 'vehicle-stealth', name: 'Vehicle Stealth', type: 'armor',
      armor: { type: 'STEALTH_VEHICLE' },
    });
    entity.armorValues.set(new Map([['Front', { front: 10, rear: 0 }]]));
    entity.setUniformArmor(new MountedArmor({ armor: stealth, techBase: 'IS' }));

    const result = calculateBattleValueDetails(entity);
    const factor = findDetail(result.details, 'Defensive Factor');
    expect(factor?.calculation).toContain('x 1');
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

  it('counts physical shields defensively and excludes them from offensive equipment', () => {
    class ExposedMekCalculator extends MekBVCalculator {
      isDefensive(item: EntityMountedEquipment): boolean { return this.countsAsDefensiveEquipment(item); }
      offensiveEquipmentValue(): number {
        this.offensiveValue = 0;
        this.processOffensiveEquipment();
        return this.offensiveValue;
      }
    }
    const entity = new TestBipedMekEntity();
    const shield = new MiscEquipment({
      id: 'shield', name: 'Medium Shield', type: 'misc', stats: { bv: 20 },
      flags: ['F_CLUB', 'S_SHIELD_MEDIUM'],
    });
    const shieldMount = mount(shield, 'LA');
    entity.setEquipment([shieldMount]);
    const calculator = new ExposedMekCalculator(entity);

    expect(calculator.isDefensive(shieldMount)).toBeTrue();
    expect(calculator.offensiveEquipmentValue()).toBe(0);

    const clubOnly = mount(new MiscEquipment({
      id: 'club', name: 'Club', type: 'misc', stats: { bv: 20 }, flags: ['F_CLUB'],
    }), 'LA');
    expect(calculator.isDefensive(clubOnly)).toBeFalse();
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

  it('applies CT armor material modifiers to torso-mounted cockpit armor', () => {
    const entity = new TestBipedMekEntity();
    entity.armorValues.set(new Map([['CT', { front: 8, rear: 2 }]]));
    const reflective = new ArmorEquipment({
      id: 'Reflective Armor', name: 'Reflective Armor', type: 'armor',
      armor: { type: 'REFLECTIVE' },
    });
    entity.setUniformArmor(new MountedArmor({ armor: reflective, techBase: 'IS' }));

    expect(findDetail(calculateBattleValueDetails(entity).details, 'Armor')?.delta).toBe(37.5);

    entity.cockpitType.set('Torso-Mounted');
    expect(findDetail(calculateBattleValueDetails(entity).details, 'Armor')?.delta).toBe(75);
  });

  it('adds the Blue Shield armor modifier to the material modifier', () => {
    const entity = new TestBipedMekEntity();
    entity.armorValues.set(new Map([['CT', { front: 10, rear: 0 }]]));
    entity.setUniformArmor(new MountedArmor({
      armor: new ArmorEquipment({
        id: 'Reflective Armor', name: 'Reflective Armor', type: 'armor',
        armor: { type: 'REFLECTIVE' },
      }),
      techBase: 'IS',
    }));
    entity.setEquipment([mount(new MiscEquipment({
      id: 'Blue Shield', name: 'Blue Shield', type: 'misc', flags: ['F_BLUE_SHIELD'],
    }), 'CT')]);

    expect(findDetail(calculateBattleValueDetails(entity).details, 'Armor')?.delta).toBe(42.5);
  });

  it('penalizes each unprotected Inner Sphere Mek location for Blue Shield', () => {
    class ExposedMekCalculator extends MekBVCalculator {
      blueShieldPenalty(): number { return -this.blueShieldUnprotectedLocations(); }
    }
    const entity = new TestBipedMekEntity();
    entity.techBase.set('IS');
    entity.setEquipment([mount(new MiscEquipment({
      id: 'Blue Shield', name: 'Blue Shield', type: 'misc', flags: ['F_BLUE_SHIELD'],
    }), 'CT')]);

    expect(new ExposedMekCalculator(entity).blueShieldPenalty()).toBe(-7);
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

  it('does not apply running heat to IndustrialMek BV heat efficiency', () => {
    const industrialStructure = new StructureEquipment({
      id: 'industrial-structure', name: 'Industrial Structure', type: 'structure',
      flags: ['F_INDUSTRIAL_STRUCTURE'],
    });
    const industrialMek = new TestBipedMekEntity();
    industrialMek.originalWalkMP.set(4);
    industrialMek.mountedEngine().type.set('Fusion');
    industrialMek.setStructureAt('CT', new MountedStructure({
      tonnage: 5,
      structure: industrialStructure,
    }));

    const battleMek = new TestBipedMekEntity();
    battleMek.originalWalkMP.set(4);
    battleMek.mountedEngine().type.set('Fusion');

    expect(findDetail(calculateBattleValueDetails(industrialMek).details, 'Heat Efficiency')?.calculation)
      .toContain('- 0 (Run)');
    expect(findDetail(calculateBattleValueDetails(battleMek).details, 'Heat Efficiency')?.calculation)
      .toContain('- 2 (Run)');
  });

  it('still applies jump heat to IndustrialMek BV heat efficiency', () => {
    const industrialStructure = new StructureEquipment({
      id: 'industrial-structure', name: 'Industrial Structure', type: 'structure',
      flags: ['F_INDUSTRIAL_STRUCTURE'],
    });
    const jumpJet = new MiscEquipment({
      id: 'jump-jet', name: 'Jump Jet', type: 'misc', flags: ['F_JUMP_JET'],
    });
    const entity = new TestBipedMekEntity();
    entity.originalWalkMP.set(4);
    entity.mountedEngine().type.set('Fusion');
    entity.setStructureAt('CT', new MountedStructure({ tonnage: 5, structure: industrialStructure }));
    entity.setEquipment(Array.from({ length: 4 }, () => mount(jumpJet, 'LT')));

    expect(findDetail(calculateBattleValueDetails(entity).details, 'Heat Efficiency')?.calculation)
      .toContain('- 4 (Jump)');
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

  it('uses semantic weapon flags for reduced explosive penalties', () => {
    const reducedWeaponFlags: EquipmentFlag[][] = [
      ['F_HYPER'],
      ['F_TSEMP'],
      ['F_B_POD'],
      ['F_M_POD'],
      ['F_TASER', 'F_MEK_WEAPON'],
      ['F_LASER', 'S_IMPROVED'],
    ];

    for (const [index, flags] of reducedWeaponFlags.entries()) {
      const entity = new TestBipedMekEntity();
      const weapon = new WeaponEquipment({
        id: `reduced-${index}`, name: `Reduced ${index}`, type: 'weapon',
        stats: { explosive: true, criticalSlots: 2 }, flags,
      });
      entity.setEquipment([mount(weapon, 'LT')]);

      const explosive = findDetail(calculateBattleValueDetails(entity).details, 'Explosive Equipment');
      expect(explosive?.delta).withContext(flags.join(' + ')).toBe(-2);
    }
  });

  it('requires both laser and improved flags for the improved-heavy-laser penalty', () => {
    const flagSets: EquipmentFlag[][] = [['F_LASER'], ['S_IMPROVED']];
    for (const flags of flagSets) {
      const entity = new TestBipedMekEntity();
      const weapon = new WeaponEquipment({
        id: flags[0], name: flags[0], type: 'weapon',
        stats: { explosive: true, criticalSlots: 2 }, flags,
      });
      entity.setEquipment([mount(weapon, 'LT')]);

      const explosive = findDetail(calculateBattleValueDetails(entity).details, 'Explosive Equipment');
      expect(explosive?.delta).withContext(flags[0]).toBe(-30);
    }
  });

  it('requires the Mek weapon flag for the reduced taser penalty', () => {
    const entity = new TestBipedMekEntity();
    const battleArmorTaser = new WeaponEquipment({
      id: 'ba-taser', name: 'BA Taser', type: 'weapon',
      stats: { explosive: true, criticalSlots: 1 }, flags: ['F_TASER', 'F_BA_WEAPON'],
    });
    entity.setEquipment([mount(battleArmorTaser, 'LT')]);

    const explosive = findDetail(calculateBattleValueDetails(entity).details, 'Explosive Equipment');
    expect(explosive?.delta).toBe(-15);
  });

  it('applies one total explosive penalty to a non-split HVAC', () => {
    const entity = new TestBipedMekEntity();
    const hvac = new WeaponEquipment({
      id: 'hvac', name: 'HVAC', type: 'weapon',
      stats: { explosive: true, criticalSlots: 4 }, flags: ['F_HVAC'],
    });
    entity.setEquipment([mount(hvac, 'LT')]);

    const explosive = findDetail(calculateBattleValueDetails(entity).details, 'Explosive Equipment');
    expect(explosive?.delta).toBe(-1);
  });

  it('counts occupied slots for a split HVAC', () => {
    const entity = new TestBipedMekEntity();
    const hvac = new WeaponEquipment({
      id: 'split-hvac', name: 'Split HVAC', type: 'weapon',
      stats: { explosive: true, criticalSlots: 4 }, flags: ['F_HVAC'],
    });
    const splitMount = mount(hvac, 'LT')
      .withAddedPlacement({ location: 'LT', slotIndex: 0 })
      .withAddedPlacement({ location: 'LT', slotIndex: 1 })
      .withAddedPlacement({ location: 'RT', slotIndex: 0 })
      .withAddedPlacement({ location: 'RT', slotIndex: 1 });
    entity.setEquipment([splitMount]);

    const explosive = findDetail(calculateBattleValueDetails(entity).details, 'Explosive Equipment');
    expect(explosive?.delta).toBe(-4);
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
