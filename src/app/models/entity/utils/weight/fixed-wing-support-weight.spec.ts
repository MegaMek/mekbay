// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, createEquipment, WeaponEquipment } from '../../../equipment.model';
import { TestFixedWingSupportEntity } from '../../testing/test-entities';
import { addTestEquipment } from '../../testing/test-mounted-equipment';
import { MountedEngine } from '../../components';
import { calculateFixedWingSupportWeightBreakdown } from './fixed-wing-support-weight';

describe('fixed-wing support construction mass', () => {
  it('includes exported Omni base-chassis fire-control mass', () => {
    const entity = new TestFixedWingSupportEntity();
    entity.baseChassisFireConWeight.set(5.5);
    addTestEquipment(entity, createEquipment({
      id: 'Advanced Fire Control', name: 'Advanced Fire Control', type: 'misc',
      flags: ['F_ADVANCED_FIRE_CONTROL'], stats: { tonnage: 'variable' },
    }), { location: 'Fuselage' });

    const result = calculateFixedWingSupportWeightBreakdown(entity);
    expect(result.fireControl).toBe(5.5);
    expect(result.miscellaneous).toBe(0);
    expect(result.exact).toBeGreaterThanOrEqual(5.5);
  });

  it('derives installed advanced fire-control mass from eligible weapons', () => {
    const entity = new TestFixedWingSupportEntity();
    entity.setTonnage(20);
    addTestEquipment(entity, createEquipment({
      id: 'Advanced Fire Control', name: 'Advanced Fire Control', type: 'misc',
      flags: ['F_ADVANCED_FIRE_CONTROL'], stats: { tonnage: 'variable' },
    }), { location: 'Fuselage' });
    addTestEquipment(entity, new WeaponEquipment({
      id: 'Weapon', name: 'Weapon', type: 'weapon', stats: { tonnage: 5 },
    }), { location: 'Nose' });

    const result = calculateFixedWingSupportWeightBreakdown(entity);
    expect(result.fireControl).toBe(0.5);
    expect(result.miscellaneous).toBe(0);
  });

  it('uses the small fixed-wing chassis factor and kilogram rounding', () => {
    const entity = new TestFixedWingSupportEntity();
    entity.setTonnage(4);
    entity.structuralTechRating.set(3);
    expect(calculateFixedWingSupportWeightBreakdown(entity).structure).toBe(0.32);
  });

  it('uses class/rating fuel density with the propeller reduction', () => {
    const entity = new TestFixedWingSupportEntity();
    entity.setTonnage(4);
    entity.engineTechRating.set(3);
    entity.fuel.set(273);
    addTestEquipment(entity, createEquipment({
      id: 'Prop', name: 'Prop', type: 'misc', flags: ['F_CHASSIS_MODIFICATION', 'F_PROP'],
    }), { location: 'Fuselage' });
    expect(calculateFixedWingSupportWeightBreakdown(entity).fuel).toBe(3.276);
  });

  it('does not charge fuel for fusion-powered propeller aircraft', () => {
    const entity = new TestFixedWingSupportEntity();
    entity.fuel.set(100);
    entity.mountedEngine.set(new MountedEngine({ type: 'Fusion', rating: 50, techBase: 'IS' }));
    addTestEquipment(entity, createEquipment({
      id: 'Prop', name: 'Prop', type: 'misc', flags: ['F_CHASSIS_MODIFICATION', 'F_PROP'],
    }), { location: 'Fuselage' });
    expect(calculateFixedWingSupportWeightBreakdown(entity).fuel).toBe(0);
  });

  it('excludes bomb payloads from non-small support aircraft construction mass', () => {
    const entity = new TestFixedWingSupportEntity();
    entity.setTonnage(20);
    addTestEquipment(entity, new AmmoEquipment({
      id: 'bomb-ammo', name: 'Bomb Ammo', type: 'ammo', stats: { tonnage: 1 },
      flags: ['F_SPACE_BOMB'], ammo: { type: 'BOMB', shots: 1 },
    }), { location: 'Body' });
    addTestEquipment(entity, new AmmoEquipment({
      id: 'ordinary-ammo', name: 'Ordinary Ammo', type: 'ammo', stats: { tonnage: 1 },
      ammo: { type: 'LRM', shots: 1 },
    }), { location: 'Body' });
    addTestEquipment(entity, new WeaponEquipment({
      id: 'bomb-weapon', name: 'Bomb Weapon', type: 'weapon', stats: { tonnage: 2 },
      flags: ['F_BOMB_WEAPON'],
    }), { location: 'Nose' });
    addTestEquipment(entity, new WeaponEquipment({
      id: 'ordinary-weapon', name: 'Ordinary Weapon', type: 'weapon', stats: { tonnage: 3 },
    }), { location: 'Nose' });

    const result = calculateFixedWingSupportWeightBreakdown(entity);
    expect(result.ammo).toBe(1);
    expect(result.weapons).toBe(3);
  });
});