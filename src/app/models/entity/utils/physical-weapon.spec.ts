// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { MiscEquipment, WeaponEquipment } from '../../equipment.model';
import type { EquipmentFlag } from '../../equipment-flags.type';
import {
  isPhysicalWeaponEquipment,
  resolvePhysicalWeaponDamage,
  resolveShieldProfile,
} from './physical-weapon';

function misc(flags: readonly EquipmentFlag[]): MiscEquipment {
  return new MiscEquipment({ id: flags.join('-'), name: 'Test', type: 'misc', flags: [...flags] });
}

describe('physical weapon utilities', () => {
  describe('isPhysicalWeaponEquipment', () => {
    it('recognizes exported mounted physical equipment flags', () => {
      expect(isPhysicalWeaponEquipment(misc(['F_CLUB']))).toBeTrue();
      expect(isPhysicalWeaponEquipment(misc(['F_HAND_WEAPON']))).toBeTrue();
      expect(isPhysicalWeaponEquipment(misc(['F_TALON']))).toBeTrue();
      expect(isPhysicalWeaponEquipment(misc(['F_SHIELD']))).toBeTrue();
    });

    it('classifies physical flags independently of equipment subclass', () => {
      expect(isPhysicalWeaponEquipment(new WeaponEquipment({
        id: 'laser', name: 'Laser', type: 'weapon', flags: ['F_CLUB'],
      }))).toBeTrue();
      expect(isPhysicalWeaponEquipment(new WeaponEquipment({
        id: 'laser', name: 'Laser', type: 'weapon', flags: [],
      }))).toBeFalse();
      expect(isPhysicalWeaponEquipment(misc(['F_RAM_PLATE']))).toBeFalse();
      expect(isPhysicalWeaponEquipment(undefined)).toBeFalse();
    });
  });

  describe('resolvePhysicalWeaponDamage', () => {
    it('uses shield absorption values instead of the generic club tonnage formula', () => {
      const cases: readonly [EquipmentFlag[], number, number][] = [
        [['F_SHIELD', 'S_SHIELD_SMALL'], 1, 3],
        [['F_SHIELD', 'S_SHIELD_MEDIUM'], 2, 5],
        [['F_SHIELD', 'S_SHIELD_LARGE'], 3, 7],
      ];

      for (const [flags, bashBonus, damageAbsorption] of cases) {
        const equipment = misc(flags);
        expect(resolveShieldProfile(equipment)).withContext(flags.join(', ')).toEqual(jasmine.objectContaining({
          bashBonus,
          damageAbsorption,
        }));
        expect(resolvePhysicalWeaponDamage(equipment, 75)).withContext(flags.join(', '))
          .toEqual({ kind: 'fixed', value: damageAbsorption });
      }

      expect(resolvePhysicalWeaponDamage(misc(['F_SHIELD']), 75))
        .toEqual({ kind: 'fixed', value: 0 });
    });

    it('resolves fixed subtype damage formulas', () => {
      const cases: readonly [string[], number][] = [
        [['F_HAND_WEAPON', 'S_CLAW'], 8],
        [['F_CLUB', 'S_SWORD'], 7],
        [['F_CLUB', 'S_RETRACTABLE_BLADE'], 6],
        [['F_CLUB', 'S_MACE'], 14],
        [['F_CLUB', 'S_PILE_DRIVER'], 10],
        [['F_CLUB', 'S_FLAIL'], 9],
        [['F_CLUB', 'S_DUAL_SAW'], 7],
        [['F_CLUB', 'S_CHAINSAW'], 5],
        [['F_CLUB', 'S_BACKHOE'], 6],
        [['F_CLUB', 'S_MINING_DRILL'], 4],
        [['F_CLUB', 'S_WRECKING_BALL'], 8],
        [['F_CLUB', 'S_VIBRO_LARGE'], 14],
        [['F_CLUB', 'S_VIBRO_MEDIUM'], 10],
        [['F_CLUB', 'S_VIBRO_SMALL'], 7],
        [['F_CLUB', 'S_CHAIN_WHIP'], 3],
        [['F_CLUB', 'S_COMBINE'], 3],
        [['F_CLUB', 'S_ROCK_CUTTER'], 5],
        [['F_CLUB', 'S_SPOT_WELDER'], 5],
      ];

      for (const [flags, value] of cases) {
        expect(resolvePhysicalWeaponDamage(misc(flags as EquipmentFlag[]), 55))
          .withContext(flags.join(', '))
          .toEqual({ kind: 'fixed', value });
      }
    });

    it('uses static talon and default club formulas at boundaries', () => {
      expect(resolvePhysicalWeaponDamage(misc(['F_TALON']), 54)).toEqual({ kind: 'fixed', value: 15 });
      expect(resolvePhysicalWeaponDamage(misc(['F_TALON']), 55)).toEqual({ kind: 'fixed', value: 17 });
      expect(resolvePhysicalWeaponDamage(misc(['F_CLUB', 'S_HATCHET']), 4)).toEqual({ kind: 'fixed', value: 0 });
      expect(resolvePhysicalWeaponDamage(misc(['F_CLUB', 'S_HATCHET']), 5)).toEqual({ kind: 'fixed', value: 1 });
    });
  });
});
