// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, WeaponEquipment } from '../../../equipment.model';
import { MountedEngine } from '../../components';
import { TestAeroSpaceFighterEntity, TestConvFighterEntity } from '../../testing/test-entities';
import { addTestEquipment } from '../../testing/test-mounted-equipment';
import { calculateFighterWeightBreakdown } from './fighter-weight';

describe('fighter construction mass', () => {
  it('converts fuel points and aerospace cockpit types to tons', () => {
    const entity = new TestAeroSpaceFighterEntity();
    entity.fuel.set(80);
    entity.cockpitType.set('Small');
    const result = calculateFighterWeightBreakdown(entity);
    expect(result.fuel).toBe(1);
    expect(result.controls).toBe(2);
  });

  it('uses nearest-half controls and upward-half VSTOL mass for conventional fighters', () => {
    const entity = new TestConvFighterEntity();
    entity.setTonnage(25);
    entity.fuel.set(160);
    const withoutVstol = calculateFighterWeightBreakdown(entity);

    entity.vstol.set(true);
    const result = calculateFighterWeightBreakdown(entity);

    expect(result.controls).toBe(2.5);
    expect(result.vstol).toBe(1.5);
    expect(result.fuel).toBe(1);
    expect(result.rounded - withoutVstol.rounded).toBe(1.5);
  });

  it('adds shielding mass for fusion-powered conventional fighters', () => {
    const entity = new TestConvFighterEntity();
    entity.setTonnage(50);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 200, techBase: 'IS' }));
    expect(calculateFighterWeightBreakdown(entity).engine).toBe(13);
  });

  it('excludes bomb payloads while retaining ordinary weapons and ammunition', () => {
    const entity = new TestAeroSpaceFighterEntity();
    addTestEquipment(entity, new AmmoEquipment({
      id: 'bomb-ammo', name: 'Bomb Ammo', type: 'ammo', stats: { tonnage: 1 },
      flags: ['F_OTHER_BOMB'], ammo: { type: 'AAA_MISSILE', shots: 1 },
    }), { location: 'Fuselage' });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'ordinary-ammo', name: 'Ordinary Ammo', type: 'ammo', stats: { tonnage: 1 },
      ammo: { type: 'LRM', shots: 1 },
    }), { location: 'Fuselage' });
    addTestEquipment(entity, new WeaponEquipment({
      id: 'bomb-weapon', name: 'Bomb Weapon', type: 'weapon', stats: { tonnage: 2 },
      flags: ['F_BOMB_WEAPON'],
    }), { location: 'Nose' });
    addTestEquipment(entity, new WeaponEquipment({
      id: 'ordinary-weapon', name: 'Ordinary Weapon', type: 'weapon', stats: { tonnage: 3 },
    }), { location: 'Nose' });

    const result = calculateFighterWeightBreakdown(entity);
    expect(result.ammo).toBe(1);
    expect(result.weapons).toBe(3);
  });
});