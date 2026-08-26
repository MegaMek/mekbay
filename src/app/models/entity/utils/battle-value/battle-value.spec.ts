// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
  AmmoEquipment,
  ArmorEquipment,
  MiscEquipment,
  WeaponEquipment,
} from '../../../equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from '../../../rules/game-rules';
import { MountedArmor } from '../../components/armor';
import type { BaseEntity } from '../../base-entity';
import type { EntityStateView } from '../../entity-state-view';
import {
  TestBipedMekEntity,
  TestDropShipEntity,
  TestFixedWingSupportEntity,
  TestInfantryEntity,
  TestProtoMekEntity,
  TestSupportTankEntity,
  TestTankEntity,
  TestWarShipEntity,
} from '../../testing/test-entities';
import { createTestEquipmentRegistry } from '../../testing/test-equipment-registry';
import { BV_MOVEMENT_CALCULATION, EntityMountedEquipment } from '../../types';
import { calculateBattleValue, calculateBattleValueDetails, getBVCalculator } from './factory';
import type { BattleValueDetail } from './bv-calculator';
import { infantryDamageDivisor } from './infantry-rules';
import {
  armorBVMultiplierForType,
  mekArmorBarFactor,
  offensiveSpeedFactor,
  targetMovementModifier,
  vehicleTypeModifier,
} from './rules';
import {
  CombatVehicleBVCalculator,
  DropShipBVCalculator,
  MekBVCalculator,
  ProtoMekBVCalculator,
  WarShipBVCalculator,
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

function entityState(
  entity: BaseEntity,
  statuses: ReadonlyMap<string, 'available' | 'disabled' | 'destroyed'> = new Map(),
): EntityStateView {
  return {
    destroyed: false,
    movement: {
      walk: entity.maxWalkMP(),
      run: entity.maxRunMP(),
      jump: entity.computeJumpMP(BV_MOVEMENT_CALCULATION),
      umu: entity.umuMP(),
    },
    engineHits: 0,
    equipmentStatus: mountId => statuses.get(mountId) ?? 'available',
    armorRemaining: (location, face) => entity.getArmorValue(location, face),
    structureRemaining: location => entity.structureValues().get(location) ?? 0,
    ammoRemaining: mountId => entity.equipment()
      .find(item => item.mountId === mountId)?.getAmmoShots() ?? 0,
    ammoEquipment: mountId => {
      const equipment = entity.equipment().find(item => item.mountId === mountId)?.equipment;
      return equipment instanceof AmmoEquipment ? equipment : null;
    },
  };
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

  it('shares immutable armor BV and commercial BAR factors', () => {
    expect(armorBVMultiplierForType('HARDENED')).toBe(2);
    expect(armorBVMultiplierForType('FERRO_LAMELLOR')).toBe(1.2);
    expect(armorBVMultiplierForType('STANDARD')).toBe(1);
    expect(mekArmorBarFactor('COMMERCIAL')).toBe(0.5);
    expect(mekArmorBarFactor('STANDARD')).toBe(1);
  });

  it('uses the rules layer for pristine and runtime-selected ammunition BV', () => {
    class ExposedCalculator extends CombatVehicleBVCalculator {
      ammoValue(item: EntityMountedEquipment): number { return this.ammoBV(item); }
    }
    const baseAmmo = new AmmoEquipment({
      id: 'AC5Ammo', name: 'AC/5 Ammo', type: 'ammo',
      stats: { bv: 10 }, ammo: { type: 'AC', rackSize: 5, shots: 10 },
    });
    const axHead = new AmmoEquipment({
      id: 'AXHeadAC5', name: 'AX Head AC/5 Ammo', type: 'ammo',
      stats: { bv: 7 },
      ammo: {
        type: 'AC', rackSize: 5, shots: 20, baseAmmo: baseAmmo.id,
        munitionType: ['M_AX_HEAD'],
      },
    });
    const registry = createTestEquipmentRegistry({ [baseAmmo.id]: baseAmmo, [axHead.id]: axHead });
    const entity = new TestTankEntity(registry);
    const installed = mount(axHead);
    entity.setEquipment([installed]);

    expect(new ExposedCalculator(entity, undefined, CORE_2026_GAME_RULES).ammoValue(installed)).toBe(10);
    expect(new ExposedCalculator(entity, undefined, TW_GAME_RULES).ammoValue(installed)).toBe(20);

    const selected = {
      ...entityState(entity),
      ammoRemaining: () => 5,
      ammoEquipment: () => axHead,
    } satisfies EntityStateView;
    expect(new ExposedCalculator(entity, selected, TW_GAME_RULES).ammoValue(installed)).toBe(20);
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
  it('dispatches every entity family to its entity-owned calculator', () => {
    expect(getBVCalculator(new TestTankEntity())).toBeInstanceOf(CombatVehicleBVCalculator);
    expect(getBVCalculator(new TestProtoMekEntity())).toBeInstanceOf(ProtoMekBVCalculator);
    expect(getBVCalculator(new TestBipedMekEntity())).toBeInstanceOf(MekBVCalculator);
  });

  it('uses the same Mek calculator with a runtime state view', () => {
    const entity = new TestBipedMekEntity();
    entity.setTonnage(55);
    const laser = mount(new WeaponEquipment({
      id: 'runtime-test-laser', name: 'Runtime Test Laser', type: 'weapon',
      weapon: { damage: 10, heat: 3 }, stats: { bv: 200 },
    }), 'RA');
    entity.setEquipment([laser]);

    const state = entityState(entity, new Map([[laser.mountId, 'destroyed']]));
    expect(entity.battleValueFor(state)).toBeLessThan(entity.battleValue());
    expect(entity.battleValueFor({ ...state, destroyed: true })).toBe(0);
  });

  it('counts F_SHIELD equipment defensively instead of offensively', () => {
    const entity = new TestBipedMekEntity();
    const shield = new MiscEquipment({
      id: 'test-shield', name: 'Shield', type: 'misc', stats: { bv: 50 },
      flags: ['F_SHIELD', 'S_SHIELD_SMALL'],
    });
    entity.setEquipment([mount(shield, 'RA')]);

    const details = calculateBattleValueDetails(entity).details;
    expect(findDetail(details, 'Defensive Equipment')?.delta).toBe(50);
    expect(findDetail(details, 'Offensive Equipment')).toBeUndefined();
  });

  it('shares mounted pod and linked PPC explosiveness with the entity', () => {
    const entity = new TestBipedMekEntity();
    const pod = mount(new WeaponEquipment({
      id: 'test-m-pod', name: 'M-Pod', type: 'weapon', stats: { explosive: true },
      flags: ['F_M_POD'],
    }), 'LT');
    const ppc = mount(new WeaponEquipment({
      id: 'test-ppc', name: 'PPC', type: 'weapon', stats: { explosive: true },
      flags: ['F_PPC', 'F_PPC_CAPACITOR_COMPATIBLE'],
    }), 'RT');
    const capacitor = mount(new MiscEquipment({
      id: 'test-capacitor', name: 'PPC Capacitor', type: 'misc', stats: { explosive: true },
      flags: ['F_PPC_CAPACITOR'],
    }), 'RT');
    entity.setEquipment([pod, ppc, capacitor]);
    entity.linkEquipment(capacitor, ppc);

    expect(entity.isMountedEquipmentExplosive(pod)).toBeFalse();
    expect(entity.isMountedEquipmentExplosive(ppc)).toBeTrue();
    expect(entity.isMountedEquipmentExplosive(capacitor)).toBeTrue();
    expect(findDetail(calculateBattleValueDetails(entity).details, 'Explosive Equipment')?.delta).toBe(-2);
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

});
