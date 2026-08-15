// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MountedArmor, MountedEngine } from '../../../components';
import { AmmoEquipment, ArmorEquipment, MiscEquipment, WeaponEquipment } from '../../../../equipment.model';
import type { EquipmentFlag } from '../../../../equipment-flags.type';
import {
  TestAeroSpaceFighterEntity as AeroSpaceFighterEntity,
  TestBattleArmorEntity as BattleArmorEntity,
  TestBipedMekEntity as BipedMekEntity,
  TestDropShipEntity as DropShipEntity,
  TestInfantryEntity as InfantryEntity,
  TestProtoMekEntity as ProtoMekEntity,
  TestQuadMekEntity as QuadMekEntity,
  TestQuadVeeEntity as QuadVeeEntity,
  TestSupportTankEntity as SupportTankEntity,
  TestTankEntity as TankEntity,
} from '../../../testing/test-entities';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../../testing/test-mounted-equipment';
import { alphaStrikeCoreSpecials } from './core-specials';

const GROUND_CONTEXT = { type: 'BM' as const, hasStandardDamage: true };

function stealthArmor(type = 'STEALTH'): MountedArmor {
  return new MountedArmor({
    armor: new ArmorEquipment({ id: type, name: type, type: 'armor', armor: { type } }),
    techBase: 'IS',
  });
}

describe('Alpha Strike core specials', () => {
  it('derives BAR from support-vehicle state and requires non-zero converted armor', () => {
    const entity = new SupportTankEntity();
    entity.barRating.set(6);
    entity.armorValues.set(new Map([['Front', { front: 30, rear: 0 }]]));

    expect(alphaStrikeCoreSpecials(entity, { type: 'SV', hasStandardDamage: true })).toContain('BAR');

    entity.barRating.set(10);
    expect(alphaStrikeCoreSpecials(entity, { type: 'SV', hasStandardDamage: true })).not.toContain('BAR');

    entity.barRating.set(6);
    entity.armorValues.set(new Map());
    expect(alphaStrikeCoreSpecials(entity, { type: 'SV', hasStandardDamage: true })).not.toContain('BAR');
  });

  it('aggregates mine dispensers and emits Battle Armor tool and parafoil abilities', () => {
    const entity = new BattleArmorEntity();
    for (let trooper = 1; trooper <= 4; trooper++) {
      addTestEquipmentWithFlags(entity, 'F_VEHICLE_MINE_DISPENSER', { location: `Trooper ${trooper}` });
    }
    addTestEquipmentWithFlags(entity, ['F_TOOLS', 'S_MINESWEEPER', 'F_PARAFOIL'], { location: 'Squad' });

    expect(alphaStrikeCoreSpecials(entity, { type: 'BA', hasStandardDamage: true }))
      .toEqual(jasmine.arrayContaining(['MDS8', 'MSW', 'PAR']));
  });

  it('converts conventional-infantry specialization and TSM implant abilities', () => {
    const entity = new InfantryEntity();
    entity.specializations.set(new Set([
      'fire-engineers', 'mountain-troops', 'trench-engineers',
    ]));
    entity.augmentations.set(['dermal_armor', 'tsm_implant']);

    expect(alphaStrikeCoreSpecials(entity, { type: 'CI', hasStandardDamage: true }))
      .toEqual(jasmine.arrayContaining(['FF', 'MTN', 'TRN', 'TSI']));

    const ordinary = alphaStrikeCoreSpecials(new InfantryEntity(), { type: 'CI', hasStandardDamage: true });
    expect(ordinary).not.toEqual(jasmine.arrayContaining(['FF', 'MTN', 'TRN', 'TSI']));
  });

  it('aggregates sensor dispensers and screen launchers', () => {
    const entity = new TankEntity();
    addTestEquipmentWithFlags(entity, 'F_SENSOR_DISPENSER');
    addTestEquipmentWithFlags(entity, 'F_SENSOR_DISPENSER');
    for (let index = 0; index < 3; index++) {
      addTestEquipment(entity, new WeaponEquipment({
        id: `screen-${index}`, name: 'Custom Screen Launcher', type: 'weapon',
        weapon: { ammoType: 'SCREEN_LAUNCHER' },
      }));
    }

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toEqual(jasmine.arrayContaining(['RSD2', 'RCN', 'SCR3']));
  });

  it('converts ProtoMek glider and magnetic-clamp abilities at the ten-ton boundary', () => {
    const light = new ProtoMekEntity();
    light.setTonnage(9.999);
    light.isGlider.set(true);
    addTestEquipmentWithFlags(light, 'F_MAGNETIC_CLAMP');
    expect(alphaStrikeCoreSpecials(light, { type: 'PM', hasStandardDamage: true }))
      .toEqual(jasmine.arrayContaining(['GLD', 'MCS']));

    const heavy = new ProtoMekEntity();
    heavy.setTonnage(10);
    addTestEquipmentWithFlags(heavy, 'F_MAGNETIC_CLAMP');
    expect(alphaStrikeCoreSpecials(heavy, { type: 'PM', hasStandardDamage: true })).toContain('UCS');
  });

  it('adds MEL from canonical ProtoMek melee equipment flags', () => {
    const entity = new ProtoMekEntity();
    addTestEquipmentWithFlags(entity, ['F_PROTOMEK_MELEE', 'S_PROTO_QMS']);

    expect(alphaStrikeCoreSpecials(entity, { type: 'PM', hasStandardDamage: true })).toContain('MEL');
  });

  it('adds LG only to superheavy Meks', () => {
    const superheavy = new BipedMekEntity();
    superheavy.setTonnage(101);
    expect(alphaStrikeCoreSpecials(superheavy, GROUND_CONTEXT)).toContain('LG');

    const standard = new BipedMekEntity();
    standard.setTonnage(100);
    expect(alphaStrikeCoreSpecials(standard, GROUND_CONTEXT)).not.toContain('LG');
  });

  it('adds MSW from vehicle minesweepers and infantry mine-engineer specialization', () => {
    const vehicle = new TankEntity();
    addTestEquipmentWithFlags(vehicle, 'F_MINESWEEPER');
    expect(alphaStrikeCoreSpecials(vehicle, { type: 'CV', hasStandardDamage: true }))
      .toContain('MSW');

    const infantry = new InfantryEntity();
    infantry.specializations.set(new Set(['mine-engineers']));
    expect(alphaStrikeCoreSpecials(infantry, { type: 'CI', hasStandardDamage: true }))
      .toContain('MSW');
  });

  it('does not treat ordinary BA tools as minesweepers', () => {
    const entity = new BattleArmorEntity();
    addTestEquipmentWithFlags(entity, 'F_TOOLS');

    expect(alphaStrikeCoreSpecials(entity, { type: 'BA', hasStandardDamage: true }))
      .not.toContain('MSW');
  });

  it('adds AMP from each amphibious chassis flag', () => {
    for (const flag of ['F_AMPHIBIOUS', 'F_FULLY_AMPHIBIOUS', 'F_LIMITED_AMPHIBIOUS'] as const) {
      const entity = new TankEntity();
      addTestEquipmentWithFlags(entity, flag);

      expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
        .withContext(flag)
        .toContain('AMP');
    }
  });

  it('does not derive AMP from a flotation hull alone', () => {
    const entity = new TankEntity();
    addTestEquipmentWithFlags(entity, 'F_FLOTATION_HULL');

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .not.toContain('AMP');
  });

  it('adds one ORO from one or more off-road chassis mounts', () => {
    const entity = new TankEntity();
    addTestEquipmentWithFlags(entity, 'F_OFF_ROAD');
    addTestEquipmentWithFlags(entity, 'F_OFF_ROAD');

    const specials = alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true });
    expect(specials.filter(special => special === 'ORO')).toEqual(['ORO']);
  });

  it('does not derive ORO from an unrelated chassis modification', () => {
    const entity = new TankEntity();
    addTestEquipmentWithFlags(entity, 'F_CHASSIS_MODIFICATION');

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .not.toContain('ORO');
  });

  it('aggregates drone carrier control sizes after truncating each mount', () => {
    const entity = new TankEntity();
    addTestEquipmentWithFlags(entity, 'F_DRONE_CARRIER_CONTROL', { size: 2.9 });
    addTestEquipmentWithFlags(entity, 'F_DRONE_CARRIER_CONTROL', { size: 1.9 });
    addTestEquipmentWithFlags(entity, 'F_DRONE_CARRIER_CONTROL');

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toContain('DCC4');
  });

  it('counts each remote drone command console as one and ignores its size', () => {
    const entity = new TankEntity();
    addTestEquipmentWithFlags(entity, 'F_REMOTE_DRONE_COMMAND_CONSOLE', { size: 12 });
    addTestEquipmentWithFlags(entity, 'F_REMOTE_DRONE_COMMAND_CONSOLE', {
      allocation: { kind: 'unallocated' },
    });

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toContain('DCC2');
  });

  it('aggregates MASH size after truncating each mount and defaults missing size to one', () => {
    const entity = new TankEntity();
    addTestEquipmentWithFlags(entity, 'F_MASH', { size: 2.9 });
    addTestEquipmentWithFlags(entity, 'F_MASH', { size: 1.9 });
    addTestEquipmentWithFlags(entity, 'F_MASH', { allocation: { kind: 'unallocated' } });

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toContain('MASH4');
  });

  it('aggregates ATAC size from canonical flags across custom equipment classes', () => {
    const entity = new TankEntity();
    addTestEquipmentWithFlags(entity, 'F_ATAC', { size: 20.9 });
    addTestEquipment(entity, new WeaponEquipment({
      id: 'custom-atac', name: 'Custom ATAC Weapon', type: 'weapon',
      flags: ['F_ATAC'], weapon: { ammoType: 'NA' },
    }));

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toContain('ATAC21');
  });

  it('adds BT from booby traps only to eligible unit types', () => {
    const vehicle = new TankEntity();
    addTestEquipment(vehicle, new WeaponEquipment({
      id: 'custom-booby-trap', name: 'Custom Booby Trap', type: 'weapon',
      flags: ['F_BOOBY_TRAP'], weapon: { ammoType: 'NA' },
    }));
    expect(alphaStrikeCoreSpecials(vehicle, { type: 'CV', hasStandardDamage: true })).toContain('BT');

    const battleArmor = new BattleArmorEntity();
    addTestEquipmentWithFlags(battleArmor, 'F_BOOBY_TRAP');
    expect(alphaStrikeCoreSpecials(battleArmor, { type: 'BA', hasStandardDamage: true })).not.toContain('BT');
  });

  it('maps HarJel generations to their distinct abilities', () => {
    const expected = new Map([
      ['F_HARJEL', 'BHJ'],
      ['F_HARJEL_II', 'BHJ2'],
      ['F_HARJEL_III', 'BHJ3'],
    ] as const);
    for (const [flag, ability] of expected) {
      const entity = new TankEntity();
      addTestEquipmentWithFlags(entity, flag);
      expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
        .withContext(flag)
        .toContain(ability);
    }
  });

  it('maps void signature and viral jammer flags independently', () => {
    const entity = new TankEntity();
    addTestEquipmentWithFlags(entity, 'F_VOID_SIG');
    addTestEquipmentWithFlags(entity, 'F_VIRAL_JAMMER_DECOY');
    addTestEquipmentWithFlags(entity, 'F_VIRAL_JAMMER_HOMING');

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toEqual(jasmine.arrayContaining(['DJ', 'HJ', 'MAS']));
  });

  it('maps bridge-layer and dune-buggy flags without equipment identity checks', () => {
    for (const bridgeFlag of ['F_LIGHT_BRIDGE_LAYER', 'F_MEDIUM_BRIDGE_LAYER', 'F_HEAVY_BRIDGE_LAYER'] as const) {
      const entity = new TankEntity();
      addTestEquipmentWithFlags(entity, bridgeFlag);
      expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
        .withContext(bridgeFlag)
        .toContain('BRID');
    }

    const duneBuggy = new TankEntity();
    addTestEquipmentWithFlags(duneBuggy, 'F_DUNE_BUGGY');
    expect(alphaStrikeCoreSpecials(duneBuggy, { type: 'CV', hasStandardDamage: true })).toContain('DUN');
  });

  it('honors MASH on custom equipment classes and uses mount size rather than tonnage', () => {
    const entity = new TankEntity();
    addTestEquipment(entity, new WeaponEquipment({
      id: 'custom-medical-weapon', name: 'Custom Medical Weapon', type: 'weapon',
      flags: ['F_MASH'], stats: { tonnage: 99 }, weapon: { ammoType: 'NA' },
    }), { size: 4 });

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toContain('MASH4');
  });

  it('adds ENG but not MEL for bulldozer equipment regardless of equipment class', () => {
    const entity = new TankEntity();
    addTestEquipment(entity, new WeaponEquipment({
      id: 'custom-bulldozer', name: 'Custom Bulldozer', type: 'weapon',
      flags: ['F_BULLDOZER'], weapon: { ammoType: 'NA' },
    }));
    addTestEquipmentWithFlags(entity, 'F_BULLDOZER');

    const specials = alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true });
    expect(specials.filter(special => special === 'ENG')).toEqual(['ENG']);
    expect(specials).not.toContain('MEL');
  });

  it('does not derive ENG from trench capability without an engineering flag', () => {
    const entity = new TankEntity();
    addTestEquipmentWithFlags(entity, 'F_TRENCH_CAPABLE');

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .not.toContain('ENG');
  });

  it('adds robotic-control companion abilities from canonical flags', () => {
    const expected = new Map([
      ['F_SRCS', ['RBT']],
      ['F_SASRCS', ['ECM', 'RBT']],
      ['F_CASPAR', ['RBT', 'SDCS']],
      ['F_CASPAR_II', ['RBT']],
    ] as const);

    for (const [flag, abilities] of expected) {
      const entity = new TankEntity();
      addTestEquipmentWithFlags(entity, flag);
      const specials = alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true });
      expect(specials).withContext(flag).toEqual(jasmine.arrayContaining([...abilities]));
      expect(specials.includes('SDCS')).withContext(`${flag} SDCS`).toBe(flag === 'F_CASPAR');
      expect(specials.includes('ECM')).withContext(`${flag} ECM`).toBe(flag === 'F_SASRCS');
    }
  });

  it('honors robotic-control flags on custom equipment classes', () => {
    const entity = new TankEntity();
    addTestEquipment(entity, new WeaponEquipment({
      id: 'custom-caspar', name: 'Custom CASPAR Weapon', type: 'weapon',
      flags: ['F_CASPAR'], weapon: { ammoType: 'NA' },
    }));

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toEqual(jasmine.arrayContaining(['RBT', 'SDCS']));
  });

  it('adds SHLD only when club and shield flags coexist, regardless of equipment class', () => {
    for (const shieldFlag of ['S_SHIELD_SMALL', 'S_SHIELD_MEDIUM', 'S_SHIELD_LARGE'] as const) {
      const entity = new TankEntity();
      addTestEquipment(entity, new WeaponEquipment({
        id: `custom-${shieldFlag}`, name: 'Custom Shield Weapon', type: 'weapon',
        flags: ['F_SHIELD', shieldFlag], weapon: { ammoType: 'NA' },
      }));
      expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
        .withContext(shieldFlag)
        .toEqual(jasmine.arrayContaining(['MEL', 'SHLD']));
    }

    const incompleteShield = new TankEntity();
    addTestEquipmentWithFlags(incompleteShield, 'S_SHIELD_MEDIUM');
    expect(alphaStrikeCoreSpecials(incompleteShield, { type: 'CV', hasStandardDamage: true }))
      .not.toContain('SHLD');
  });

  it('adds intrinsic DN only for a Mek interface cockpit', () => {
    const interfaceMek = new BipedMekEntity();
    interfaceMek.cockpitType.set('Interface');
    expect(alphaStrikeCoreSpecials(interfaceMek, GROUND_CONTEXT)).toContain('DN');

    const standardMek = new BipedMekEntity();
    expect(alphaStrikeCoreSpecials(standardMek, GROUND_CONTEXT)).not.toContain('DN');
  });

  it('adds intrinsic QV only for QuadVee chassis', () => {
    expect(alphaStrikeCoreSpecials(new QuadVeeEntity(), GROUND_CONTEXT)).toContain('QV');
    expect(alphaStrikeCoreSpecials(new QuadMekEntity(), GROUND_CONTEXT)).not.toContain('QV');
  });

  it('adds conventional infantry UMU and PAR from motive and specialization capabilities', () => {
    const submarine = new InfantryEntity();
    submarine.motiveType.set('Submarine');
    expect(alphaStrikeCoreSpecials(submarine, { type: 'CI', hasStandardDamage: true })).toContain('UMU');

    const specialized = new InfantryEntity();
    specialized.specializations.set(new Set(['scuba', 'paratroops']));
    expect(alphaStrikeCoreSpecials(specialized, { type: 'CI', hasStandardDamage: true }))
      .toEqual(jasmine.arrayContaining(['PAR', 'UMU']));

    const ordinary = new InfantryEntity();
    const ordinarySpecials = alphaStrikeCoreSpecials(ordinary, { type: 'CI', hasStandardDamage: true });
    expect(ordinarySpecials).not.toContain('PAR');
    expect(ordinarySpecials).not.toContain('UMU');
  });

  it('adds ENE when an eligible unit has no explosive components', () => {
    expect(alphaStrikeCoreSpecials(new BipedMekEntity(), GROUND_CONTEXT)).toEqual(['ENE']);
  });

  it('suppresses ENE for an installed explosive weapon', () => {
    const entity = new BipedMekEntity();
    addTestEquipment(entity, new WeaponEquipment({
      id: 'explosive', name: 'Explosive Weapon', type: 'weapon', stats: { explosive: true },
      weapon: { explosionDamage: 10, ammoType: 'NA' },
    }));

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).toEqual([]);
  });

  it('uses ammo-feed quirk mounted explosion damage with live linked-compatible ammo', () => {
    const entity = new BipedMekEntity();
    const gauss = new WeaponEquipment({
      id: 'test-gauss', name: 'Test Gauss', type: 'weapon', stats: { explosive: true },
      weapon: { ammoType: 'GAUSS', rackSize: 0, explosionDamage: 20 },
    });
    addTestEquipment(entity, gauss, {
      allocation: { kind: 'location', location: 'RA', placements: [{ location: 'RA', slotIndex: 3 }] },
    });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'test-gauss-ammo', name: 'Test Gauss Ammo', type: 'ammo',
      ammo: { type: 'GAUSS', rackSize: 0, shots: 8, damagePerShot: 15 },
    }), { location: 'RT', shotsCount: 8 });
    entity.weaponQuirks.set([{
      name: 'ammo_feed_problems', weaponName: 'test-gauss', location: 'RA', slot: 3,
    }]);

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).toEqual(['ENE']);
  });

  it('retains nominal explosion damage when ammo-feed ammo is empty', () => {
    const entity = new BipedMekEntity();
    const gauss = new WeaponEquipment({
      id: 'empty-feed-gauss', name: 'Empty Feed Gauss', type: 'weapon', stats: { explosive: true },
      weapon: { ammoType: 'GAUSS', rackSize: 0, explosionDamage: 20 },
    });
    addTestEquipment(entity, gauss, {
      allocation: { kind: 'location', location: 'RA', placements: [{ location: 'RA', slotIndex: 3 }] },
    });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'empty-gauss-ammo', name: 'Empty Gauss Ammo', type: 'ammo',
      ammo: { type: 'GAUSS', rackSize: 0, shots: 8, damagePerShot: 15 },
    }), { location: 'RT', shotsCount: 0 });
    entity.weaponQuirks.set([{
      name: 'ammo_feed_problems', weaponName: 'empty-feed-gauss', location: 'RA', slot: 3,
    }]);

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).not.toContain('ENE');
  });

  it('blocks ENE when ammo-feed quirk mounted explosion damage is positive', () => {
    const entity = new BipedMekEntity();
    const weapon = new WeaponEquipment({
      id: 'positive-feed-weapon', name: 'Positive Feed Weapon', type: 'weapon',
      stats: { explosive: true },
      weapon: { ammoType: 'AC', rackSize: 2, explosionDamage: 0 },
    });
    addTestEquipment(entity, weapon, {
      allocation: { kind: 'location', location: 'RA', placements: [{ location: 'RA', slotIndex: 3 }] },
    });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'positive-feed-ammo', name: 'Positive Feed Ammo', type: 'ammo',
      ammo: { type: 'AC', rackSize: 2, shots: 10, damagePerShot: 1 },
    }), { location: 'RT', shotsCount: 10 });
    entity.weaponQuirks.set([{
      name: 'ammo_feed_problems', weaponName: 'positive-feed-weapon', location: 'RA', slot: 3,
    }]);

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).not.toContain('ENE');
  });

  it('ignores unallocated explosive components for ENE', () => {
    const entity = new BipedMekEntity();
    addTestEquipment(entity, new WeaponEquipment({
      id: 'unallocated-explosive', name: 'Unallocated Explosive Weapon', type: 'weapon',
      stats: { explosive: true }, weapon: { explosionDamage: 10, ammoType: 'NA' },
    }), { allocation: { kind: 'unallocated' } });

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).toEqual(['ENE']);
  });

  it('suppresses ENE for flag-derived explosive equipment regardless of equipment class', () => {
    const flagSets: EquipmentFlag[][] = [
      ['F_FUEL'],
      ['F_BLUE_SHIELD'],
      ['F_JUMP_JET', 'S_PROTOTYPE', 'S_IMPROVED'],
      ['F_RISC_LASER_PULSE_MODULE'],
      ['F_EMERGENCY_COOLANT_SYSTEM'],
    ];
    for (const flags of flagSets) {
      const entity = new BipedMekEntity();
      addTestEquipment(entity, new WeaponEquipment({
        id: flags.join('-'), name: 'Custom Explosive Equipment', type: 'weapon',
        flags, stats: { explosive: true }, weapon: { explosionDamage: 0, ammoType: 'NA' },
      }));

      expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).not.toContain('ENE');
    }
  });

  it('requires static explosiveness and complete prototype improved jump-jet flags', () => {
    const nonExplosiveFuel = new BipedMekEntity();
    addTestEquipment(nonExplosiveFuel, new WeaponEquipment({
      id: 'non-explosive-fuel', name: 'Non-Explosive Fuel', type: 'weapon', flags: ['F_FUEL'],
      stats: { explosive: false }, weapon: { explosionDamage: 0, ammoType: 'NA' },
    }));
    expect(alphaStrikeCoreSpecials(nonExplosiveFuel, GROUND_CONTEXT)).toContain('ENE');

    const incompleteJumpJet = new BipedMekEntity();
    addTestEquipment(incompleteJumpJet, new WeaponEquipment({
      id: 'prototype-jump-jet', name: 'Prototype Jump Jet', type: 'weapon',
      flags: ['F_JUMP_JET', 'S_PROTOTYPE'], stats: { explosive: true },
      weapon: { explosionDamage: 0, ammoType: 'NA' },
    }));
    expect(alphaStrikeCoreSpecials(incompleteJumpJet, GROUND_CONTEXT)).toContain('ENE');
  });

  it('suppresses ENE for unallocated bomb bays and booby traps without explosive stats', () => {
    for (const flag of ['F_BOMB_BAY', 'F_BOOBY_TRAP'] satisfies EquipmentFlag[]) {
      const entity = new BipedMekEntity();
      addTestEquipmentWithFlags(entity, flag, { allocation: { kind: 'unallocated' } });

      expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).not.toContain('ENE');
    }
  });

  it('applies CASE precedence and removes all CASE variants when ENE applies', () => {
    const protectedEntity = new BipedMekEntity();
    addTestEquipment(protectedEntity, new WeaponEquipment({
      id: 'explosive', name: 'Explosive Weapon', type: 'weapon', stats: { explosive: true },
      weapon: { explosionDamage: 10, ammoType: 'NA' },
    }));
    addTestEquipmentWithFlags(protectedEntity, 'F_CASE');
    addTestEquipmentWithFlags(protectedEntity, 'F_CASE_II');
    addTestEquipmentWithFlags(protectedEntity, 'F_CASE_P');
    expect(alphaStrikeCoreSpecials(protectedEntity, GROUND_CONTEXT)).toEqual(['CASEII', 'CASEP']);

    const nonExplosiveEntity = new BipedMekEntity();
    addTestEquipmentWithFlags(nonExplosiveEntity, 'F_CASE');
    addTestEquipmentWithFlags(nonExplosiveEntity, 'F_CASE_II');
    addTestEquipmentWithFlags(nonExplosiveEntity, 'F_CASE_P');
    expect(alphaStrikeCoreSpecials(nonExplosiveEntity, GROUND_CONTEXT)).toEqual(['ENE']);
  });

  it('removes CASE when ammo-feed semantics make the unit ENE', () => {
    const entity = new BipedMekEntity();
    const gauss = new WeaponEquipment({
      id: 'case-feed-gauss', name: 'CASE Feed Gauss', type: 'weapon', stats: { explosive: true },
      weapon: { ammoType: 'GAUSS', rackSize: 0, explosionDamage: 20 },
    });
    addTestEquipment(entity, gauss, {
      allocation: { kind: 'location', location: 'RA', placements: [{ location: 'RA', slotIndex: 3 }] },
    });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'case-gauss-ammo', name: 'CASE Gauss Ammo', type: 'ammo',
      ammo: { type: 'GAUSS', rackSize: 0, shots: 8, damagePerShot: 15 },
    }), { location: 'RT', shotsCount: 8 });
    addTestEquipmentWithFlags(entity, 'F_CASE');
    entity.weaponQuirks.set([{
      name: 'ammo_feed_problems', weaponName: 'case-feed-gauss', location: 'RA', slot: 3,
    }]);

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).toEqual(['ENE']);
  });

  it('grants Clan units CASE only when they contain an explosive component', () => {
    const entity = new BipedMekEntity();
    entity.techBase.set('Clan');
    addTestEquipment(entity, new WeaponEquipment({
      id: 'explosive', name: 'Explosive Weapon', type: 'weapon', stats: { explosive: true },
      weapon: { explosionDamage: 10, ammoType: 'NA' },
    }));

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).toEqual(['CASE']);
  });

  it('does not grant CASE to families that are ineligible for it', () => {
    const fighter = new AeroSpaceFighterEntity();
    fighter.techBase.set('Clan');
    addTestEquipment(fighter, new WeaponEquipment({
      id: 'explosive', name: 'Explosive Weapon', type: 'weapon', stats: { explosive: true },
      weapon: { explosionDamage: 10, ammoType: 'NA' },
    }));
    addTestEquipmentWithFlags(fighter, 'F_CASE_II');

    expect(alphaStrikeCoreSpecials(fighter, { type: 'AF', hasStandardDamage: true })).toEqual([]);
    expect(alphaStrikeCoreSpecials(new BattleArmorEntity(), { type: 'BA', hasStandardDamage: true })).toEqual(['CAR5']);
    expect(alphaStrikeCoreSpecials(new ProtoMekEntity(), { type: 'PM', hasStandardDamage: true })).toEqual(['ENE']);
  });

  it('converts ECM and probe variants with their implied reconnaissance ability', () => {
    const entity = new BipedMekEntity();
    addTestEquipmentWithFlags(entity, 'F_ECM');
    addTestEquipmentWithFlags(entity, 'F_BAP');
    addTestEquipmentWithFlags(entity, 'F_BLOODHOUND');
    addTestEquipmentWithFlags(entity, 'F_WATCHDOG');
    addTestEquipmentWithFlags(entity, 'F_NOVA');

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).toEqual([
      'ECM', 'ENE', 'MHQ1', 'NOVA', 'PRB', 'RCN', 'WAT', 'LPRB', 'BH',
    ].sort());
  });

  it('lets Angel ECM supersede generic ECM while retaining light ECM', () => {
    const entity = new BipedMekEntity();
    addTestEquipmentWithFlags(entity, 'F_ECM');
    addTestEquipmentWithFlags(entity, ['F_ECM', 'F_ANGEL_ECM']);
    addTestEquipmentWithFlags(entity, ['F_ECM', 'F_SINGLE_HEX_ECM']);

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).toEqual(['AECM', 'ENE', 'LECM']);
  });

  it('classifies light probes and EW equipment without equipment-name lookup', () => {
    const lightProbe = new BipedMekEntity();
    addTestEquipment(lightProbe, new MiscEquipment({
      id: 'light-probe', name: 'Light Probe', type: 'misc', flags: ['F_BAP'],
      stats: { tonnage: 0.5 },
    }));
    expect(alphaStrikeCoreSpecials(lightProbe, GROUND_CONTEXT))
      .toEqual(['ENE', 'LPRB', 'RCN']);

    const ewEquipment = new BipedMekEntity();
    addTestEquipment(ewEquipment, new MiscEquipment({
      id: 'ew-equipment', name: 'EW Equipment', type: 'misc',
      flags: ['F_EW_EQUIPMENT', 'F_BAP', 'F_ECM'], stats: { tonnage: 7.5 },
    }));
    expect(alphaStrikeCoreSpecials(ewEquipment, GROUND_CONTEXT))
      .toEqual(['ECM', 'ENE', 'LPRB', 'RCN']);
  });

  it('distinguishes BA light probes from improved sensors by canonical tonnage', () => {
    for (const tonnage of [0.15, 0.25]) {
      const lightProbe = new BattleArmorEntity();
      addTestEquipment(lightProbe, new MiscEquipment({
        id: `ba-light-probe-${tonnage}`, name: 'BA Light Probe', type: 'misc',
        flags: ['F_BAP', 'F_BA_EQUIPMENT'], stats: { tonnage },
      }));
      expect(alphaStrikeCoreSpecials(lightProbe, { type: 'BA', hasStandardDamage: true }))
        .toEqual(['CAR5', 'LPRB', 'RCN']);
    }

    for (const tonnage of [0.045, 0.065]) {
      const improvedSensors = new BattleArmorEntity();
      addTestEquipment(improvedSensors, new MiscEquipment({
        id: `ba-improved-sensors-${tonnage}`, name: 'BA Improved Sensors', type: 'misc',
        flags: ['F_BAP', 'F_BA_EQUIPMENT'], stats: { tonnage },
      }));
      expect(alphaStrikeCoreSpecials(improvedSensors, { type: 'BA', hasStandardDamage: true }))
        .toEqual(['CAR5', 'RCN']);
    }
  });

  it('adds STL only for uniform stealth armor and OMNI only for Mek and vehicle units', () => {
    const mek = new BipedMekEntity();
    mek.omni.set(true);
    mek.setUniformArmor(stealthArmor());
    expect(alphaStrikeCoreSpecials(mek, GROUND_CONTEXT)).toEqual(['ENE', 'OMNI', 'STL']);

    mek.setArmorAt('CT', stealthArmor('STANDARD'));
    expect(alphaStrikeCoreSpecials(mek, GROUND_CONTEXT)).toEqual(['ENE', 'OMNI']);

    const vehicle = new TankEntity();
    vehicle.omni.set(true);
    expect(alphaStrikeCoreSpecials(vehicle, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'OMNI', 'SRCH']);
  });

  it('adds one STL from null-signature and chameleon misc equipment', () => {
    const entity = new BipedMekEntity();
    addTestEquipmentWithFlags(entity, 'F_NULL_SIG');
    addTestEquipmentWithFlags(entity, 'F_CHAMELEON_SHIELD');

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT))
      .toEqual(['ENE', 'STL']);
  });

  it('does not derive STL from generic stealth misc equipment', () => {
    const entity = new BipedMekEntity();
    addTestEquipmentWithFlags(entity, 'F_STEALTH');

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT))
      .toEqual(['ENE']);
  });

  it('adds one ARS from armored motive system misc equipment', () => {
    const entity = new TankEntity();
    addTestEquipmentWithFlags(entity, 'F_ARMORED_MOTIVE_SYSTEM');
    addTestEquipmentWithFlags(entity, 'F_ARMORED_MOTIVE_SYSTEM');

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ARS', 'ENE', 'SRCH']);
  });

  it('inherits ARS flag behavior through armor equipment', () => {
    const entity = new TankEntity();
    addTestEquipment(entity, new ArmorEquipment({
      id: 'armored-motive-armor', name: 'Armor', type: 'armor',
      flags: ['F_ARMORED_MOTIVE_SYSTEM'], armor: { type: 'STANDARD' },
    }));

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toContain('ARS');
  });

  it('converts canonical equipment, armor, engine, and armored-mount abilities', () => {
    const entity = new BipedMekEntity();
    entity.mountedEngine.set(new MountedEngine({ type: 'ICE', rating: 100, techBase: 'IS' }));
    entity.setUniformArmor(new MountedArmor({
      armor: new ArmorEquipment({ id: 'Reactive', name: 'Reactive', type: 'armor', armor: { type: 'REACTIVE' } }),
      techBase: 'IS',
    }));
    addTestEquipmentWithFlags(entity, 'F_TSM');
    addTestEquipmentWithFlags(entity, 'F_RADICAL_HEATSINK');
    addTestEquipmentWithFlags(entity, 'F_EJECTION_SEAT');
    addTestEquipmentWithFlags(entity, 'F_C3I');
    addTestEquipmentWithFlags(entity, 'F_C3S', { armored: true });

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).toEqual([
      'ARM', 'C3I', 'C3S', 'EE', 'ENE', 'ES', 'MHQ3', 'RCA', 'RHS', 'TSM',
    ]);
  });

  it('adds command-network values with final MHQ flooring and Naval C3', () => {
    const entity = new BipedMekEntity();
    addTestEquipmentWithFlags(entity, 'F_NOVA');
    addTestEquipmentWithFlags(entity, 'F_C3I');
    addTestEquipmentWithFlags(entity, 'F_NAVAL_C3');

    expect(alphaStrikeCoreSpecials(entity, GROUND_CONTEXT)).toEqual([
      'C3I', 'ECM', 'ENE', 'MHQ4', 'NC3', 'NOVA', 'PRB', 'RCN',
    ]);
  });

  it('omits a C3EM count of one and aggregates multiple mounts', () => {
    const single = new BipedMekEntity();
    addTestEquipmentWithFlags(single, ['F_C3S', 'F_C3EM']);
    expect(alphaStrikeCoreSpecials(single, GROUND_CONTEXT)).toContain('C3EM');

    const multiple = new BipedMekEntity();
    addTestEquipmentWithFlags(multiple, ['F_C3S', 'F_C3EM']);
    addTestEquipmentWithFlags(multiple, ['F_C3S', 'F_C3EM']);
    expect(alphaStrikeCoreSpecials(multiple, GROUND_CONTEXT)).toContain('C3EM2');
  });

  it('adds intrinsic MHQ for command cockpits', () => {
    const mek = new BipedMekEntity();
    mek.cockpitType.set('Command Console');
    expect(alphaStrikeCoreSpecials(mek, GROUND_CONTEXT)).toContain('MHQ1');

    const fighter = new AeroSpaceFighterEntity();
    fighter.cockpitType.set('Command Console');
    expect(alphaStrikeCoreSpecials(fighter, { type: 'AF', hasStandardDamage: true })).toContain('MHQ1');
  });

  it('adds intrinsic SRCH to combat vehicles but not support vehicles', () => {
    const vehicle = new TankEntity();
    expect(alphaStrikeCoreSpecials(vehicle, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'SRCH']);

    const supportVehicle = new SupportTankEntity();
    expect(alphaStrikeCoreSpecials(supportVehicle, { type: 'SV', hasStandardDamage: true }))
      .toEqual(['ENE']);
  });

  it('deduplicates intrinsic and mounted vehicle searchlights', () => {
    const vehicle = new TankEntity();
    addTestEquipmentWithFlags(vehicle, 'F_SEARCHLIGHT');

    expect(alphaStrikeCoreSpecials(vehicle, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'SRCH']);

    const supportVehicle = new SupportTankEntity();
    addTestEquipmentWithFlags(supportVehicle, 'F_SEARCHLIGHT');
    expect(alphaStrikeCoreSpecials(supportVehicle, { type: 'SV', hasStandardDamage: true }))
      .toEqual(['ENE', 'SRCH']);
  });

  it('adds SEAL and engine-qualified SOA only for sealed vehicles', () => {
    const fusionVehicle = new TankEntity();
    fusionVehicle.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 100, techBase: 'IS' }));
    addTestEquipmentWithFlags(fusionVehicle, 'F_ENVIRONMENTAL_SEALING');
    expect(alphaStrikeCoreSpecials(fusionVehicle, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'SEAL', 'SOA', 'SRCH']);

    const iceVehicle = new TankEntity();
    iceVehicle.mountedEngine.set(new MountedEngine({ type: 'ICE', rating: 100, techBase: 'IS' }));
    addTestEquipmentWithFlags(iceVehicle, 'F_ENVIRONMENTAL_SEALING');
    expect(alphaStrikeCoreSpecials(iceVehicle, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['EE', 'ENE', 'SEAL', 'SRCH']);
  });

  it('adds SOA from infantry space-adaptation equipment without adding SEAL', () => {
    const entity = new BattleArmorEntity();
    addTestEquipmentWithFlags(entity, 'F_SPACE_ADAPTATION');

    const specials = alphaStrikeCoreSpecials(entity, { type: 'BA', hasStandardDamage: true });
    expect(specials).toContain('SOA');
    expect(specials).not.toContain('SEAL');
  });

  it('does not treat environmental sealing as BA space adaptation', () => {
    const entity = new BattleArmorEntity();
    addTestEquipmentWithFlags(entity, 'F_ENVIRONMENTAL_SEALING');

    const specials = alphaStrikeCoreSpecials(entity, { type: 'BA', hasStandardDamage: true });
    expect(specials).not.toContain('SOA');
    expect(specials).not.toContain('SEAL');
  });

  it('requires a sealed vehicle SOA engine to be installed', () => {
    const entity = new TankEntity();
    entity.mountedEngine.set(new MountedEngine({
      type: 'Fusion', rating: 100, techBase: 'IS', installed: false,
    }));
    addTestEquipmentWithFlags(entity, 'F_ENVIRONMENTAL_SEALING');

    const specials = alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true });
    expect(specials).toContain('SEAL');
    expect(specials).not.toContain('SOA');
  });

  it('converts tractor, trailer, and hitch modifications to one HTC ability', () => {
    const entity = new TankEntity();
    addTestEquipmentWithFlags(entity, 'F_TRACTOR_MODIFICATION');
    addTestEquipmentWithFlags(entity, 'F_TRAILER_MODIFICATION');
    addTestEquipmentWithFlags(entity, 'F_HITCH');

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'HTC', 'SRCH']);
  });

  it('converts the trailer-hitch quirk to HTC and deduplicates equipment HTC', () => {
    const entity = new TankEntity();
    entity.quirks.set([{
      quirk: { key: 'trailer_hitch', name: 'Trailer Hitch', description: '', type: 'positive' },
    }]);
    addTestEquipmentWithFlags(entity, 'F_HITCH');

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'HTC', 'SRCH']);
  });

  it('converts mobile HPG equipment by its canonical flag', () => {
    const entity = new TankEntity();
    addTestEquipmentWithFlags(entity, 'F_MOBILE_HPG');

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'HPG', 'SRCH']);
  });

  it('derives communications MHQ and reconnaissance from mounted tonnage', () => {
    const entity = new TankEntity();
    entity.setTonnage(100);
    addTestEquipment(entity, new MiscEquipment({
      id: 'communications', name: 'Communications', type: 'misc', flags: ['F_COMMUNICATIONS'],
      stats: { tonnage: 'variable' },
    }), { size: 5 });

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'MHQ5', 'RCN', 'SRCH']);
  });

  it('omits communications reconnaissance below five percent of unit weight', () => {
    const entity = new TankEntity();
    entity.setTonnage(100);
    addTestEquipment(entity, new MiscEquipment({
      id: 'communications', name: 'Communications', type: 'misc', flags: ['F_COMMUNICATIONS'],
      stats: { tonnage: 'variable' },
    }), { size: 4 });

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'MHQ4', 'SRCH']);
  });

  it('aggregates ordinary-unit cargo without displaying transport doors', () => {
    const entity = new TankEntity();
    addTestEquipment(entity, new MiscEquipment({
      id: 'cargo', name: 'Cargo', type: 'misc', flags: ['F_CARGO'],
      stats: { tonnage: 'variable' },
    }), { size: 1.5 });
    entity.transporters.set([{
      id: 'cargo-bay', kind: 'bay', configuration: { type: 'cargo' }, capacity: 2.5,
      doors: 2, bayNumber: 1, omni: false,
    }]);

    expect(alphaStrikeCoreSpecials(entity, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['CT4', 'ENE', 'SRCH']);
  });

  it('rounds large-aerospace cargo and converts high capacity to CK', () => {
    const largeCraft = new DropShipEntity();
    largeCraft.transporters.set([{
      id: 'cargo-bay', kind: 'bay', configuration: { type: 'cargo' }, capacity: 10.6,
      doors: 1, bayNumber: 1, omni: false,
    }]);
    expect(alphaStrikeCoreSpecials(largeCraft, { type: 'DS', hasStandardDamage: true }))
      .toEqual(['CT11-D1']);

    const vehicle = new TankEntity();
    vehicle.transporters.set([{
      id: 'cargo-bay', kind: 'bay', configuration: { type: 'cargo' }, capacity: 1_501,
      doors: 3, bayNumber: 1, omni: false,
    }]);
    expect(alphaStrikeCoreSpecials(vehicle, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['CK2', 'ENE', 'SRCH']);
  });

  it('adds MFB from mobile-base equipment and qualifying transport bays', () => {
    const equipped = new TankEntity();
    addTestEquipmentWithFlags(equipped, 'F_MOBILE_FIELD_BASE');
    expect(alphaStrikeCoreSpecials(equipped, { type: 'CV', hasStandardDamage: true }))
      .toEqual(['ENE', 'MFB', 'SRCH']);

    const carrier = new DropShipEntity();
    carrier.transporters.set([{
      id: 'mek-bay', kind: 'bay', configuration: { type: 'mek' }, capacity: 2,
      doors: 1, bayNumber: 1, omni: false,
    }]);
    expect(alphaStrikeCoreSpecials(carrier, { type: 'DS', hasStandardDamage: true }))
      .toEqual(['MFB1', 'MT2-D1']);
  });

  it('aggregates transport bay capacities and doors into their Alpha Strike specials', () => {
    const entity = new DropShipEntity();
    entity.transporters.set([
      { id: 'fighter', kind: 'bay', configuration: { type: 'fighter', arts: false }, capacity: 2, doors: 1, bayNumber: 1, omni: false },
      { id: 'mek', kind: 'bay', configuration: { type: 'mek' }, capacity: 3, doors: 2, bayNumber: 2, omni: false },
      { id: 'infantry', kind: 'bay', configuration: { type: 'infantry', infantryType: 'Foot' }, capacity: 28, doors: 1, bayNumber: 3, omni: false },
      { id: 'troop-space', kind: 'troop-space', totalSpace: 2, omni: false },
      { id: 'collar', kind: 'docking-collar', collarNumber: 1, omni: false },
    ]);

    expect(alphaStrikeCoreSpecials(entity, { type: 'DS', hasStandardDamage: true }))
      .toEqual(['AT2-D1', 'DT1', 'IT30', 'MFB2', 'MT3-D2']);
  });

  it('derives jump and UMU advantages relative to the primary movement TMM', () => {
    const entity = new BipedMekEntity();

    expect(alphaStrikeCoreSpecials(entity, {
      ...GROUND_CONTEXT,
      movement: { primary: '', values: { '': 10, j: 6, s: 20 } },
    })).toEqual(['ENE', 'JMPW1', 'SUBS2']);
  });

  it('does not add a relative movement ability when that movement is primary or has the same TMM', () => {
    const entity = new BipedMekEntity();

    expect(alphaStrikeCoreSpecials(entity, {
      ...GROUND_CONTEXT,
      movement: { primary: 'j', values: { '': 10, j: 12, s: 10 } },
    })).toEqual(['ENE']);
  });

  it('keeps ENE arc-local for large aerospace and damage-dependent for aerospace elements', () => {
    expect(alphaStrikeCoreSpecials(new DropShipEntity(), { type: 'DS', hasStandardDamage: true })).toEqual([]);
    expect(alphaStrikeCoreSpecials(new AeroSpaceFighterEntity(), { type: 'AF', hasStandardDamage: false })).toEqual([]);
    expect(alphaStrikeCoreSpecials(new AeroSpaceFighterEntity(), { type: 'AF', hasStandardDamage: true })).toEqual(['ENE']);
  });

  it('adds CAR from the ceiling of every infantry unit weight', () => {
    const battleArmor = new BattleArmorEntity();
    battleArmor.trooperCount.set(4);
    const infantry = new InfantryEntity();
    infantry.squadSize.set(37);

    expect(alphaStrikeCoreSpecials(battleArmor, { type: 'BA', hasStandardDamage: true }))
      .toEqual(['CAR4']);
    expect(alphaStrikeCoreSpecials(infantry, { type: 'CI', hasStandardDamage: true }))
      .toEqual(['CAR4']);
  });

  it('adds MEC only for mechanized-capable Battle Armor', () => {
    const entity = new BattleArmorEntity();
    addTestEquipmentWithFlags(entity, 'F_BASIC_MANIPULATOR');

    expect(alphaStrikeCoreSpecials(entity, { type: 'BA', hasStandardDamage: true }))
      .toEqual(['CAR5', 'MEC']);
  });

  it('adds XMEC for magnetic clamps and lets it supersede MEC', () => {
    const entity = new BattleArmorEntity();
    entity.chassisType.set('Quad');
    addTestEquipmentWithFlags(entity, 'F_MAGNETIC_CLAMP');

    expect(alphaStrikeCoreSpecials(entity, { type: 'BA', hasStandardDamage: true }))
      .toEqual(['CAR5', 'XMEC']);
  });

  it('adds one LMAS from Battle Armor visual-camouflage misc equipment', () => {
    const entity = new BattleArmorEntity();
    addTestEquipmentWithFlags(entity, 'F_VISUAL_CAMO');
    addTestEquipmentWithFlags(entity, 'F_VISUAL_CAMO');

    expect(alphaStrikeCoreSpecials(entity, { type: 'BA', hasStandardDamage: true }))
      .toEqual(['CAR5', 'LMAS']);
  });

  it('does not add LMAS from visual camouflage on conventional infantry', () => {
    const entity = new InfantryEntity();
    addTestEquipmentWithFlags(entity, 'F_VISUAL_CAMO');

    expect(alphaStrikeCoreSpecials(entity, { type: 'CI', hasStandardDamage: true }))
      .not.toContain('LMAS');
  });

  it('derives MAS but not LMAS from mounted BA mimetic armor records', () => {
    const entity = new BattleArmorEntity();
    const mimeticArmor = new ArmorEquipment({
      id: 'mimetic-armor', name: 'Mimetic Armor', type: 'armor',
      flags: ['F_VISUAL_CAMO'], armor: { type: 'BA_MIMETIC' },
    });
    entity.setUniformArmor(new MountedArmor({ armor: mimeticArmor, techBase: 'IS' }));
    addTestEquipment(entity, mimeticArmor, { location: 'Squad' });

    expect(alphaStrikeCoreSpecials(entity, { type: 'BA', hasStandardDamage: true }))
      .toEqual(['CAR5', 'MAS']);
  });

  it('derives LMAS from non-mimetic visual-camouflage armor equipment', () => {
    const entity = new BattleArmorEntity();
    addTestEquipment(entity, new ArmorEquipment({
      id: 'visual-camo-armor', name: 'Visual Camo Armor', type: 'armor',
      flags: ['F_VISUAL_CAMO'], armor: { type: 'BA_STANDARD' },
    }), { location: 'Squad' });

    expect(alphaStrikeCoreSpecials(entity, { type: 'BA', hasStandardDamage: true }))
      .toContain('LMAS');
  });
});
