// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MekConfig } from '../types/mek';
import type { EquipmentFlag } from '../../equipment-flags.type';
import {
  buildMekIntrinsicActions,
  intrinsicActionBaseDamageText,
  type MekIntrinsicActionFacts,
  type MekIntrinsicEquipmentFact,
} from './mek-intrinsic-actions';

describe('Mek intrinsic actions', () => {
  for (const [config, expectedKinds] of [
    ['Biped', ['punch', 'punch', 'kick', 'club', 'charge', 'push']],
    ['Tripod', ['punch', 'punch', 'kick', 'club', 'charge', 'push']],
    ['LAM', ['punch', 'punch', 'kick', 'club', 'charge', 'airmek-ram', 'push']],
    ['Quad', ['kick', 'charge']],
    ['QuadVee', ['kick', 'charge']],
  ] as const satisfies readonly (readonly [MekConfig, readonly string[]])[]) {
    it(`derives only the actions supported by a ${config}`, () => {
      expect(buildMekIntrinsicActions(facts({ config })).map(action => action.kind))
        .toEqual(expectedKinds);
    });
  }

  it('derives every equipment and actuator modifier from facts once', () => {
    const equipment = [
      fact('CT', 'F_TSM'),
      fact('LA', 'F_ACTUATOR_ENHANCEMENT_SYSTEM'),
      fact('RA', 'F_ACTUATOR_ENHANCEMENT_SYSTEM'),
      fact('LL', 'F_ACTUATOR_ENHANCEMENT_SYSTEM'),
      fact('RL', 'F_ACTUATOR_ENHANCEMENT_SYSTEM'),
      fact('RA', 'F_HAND_WEAPON', 'S_CLAW'),
      fact('LL', 'F_TALON'),
      fact('RL', 'F_TALON'),
      fact('CT', 'F_RAM_PLATE'),
      fact('LT', 'F_SPIKES'),
      fact('RT', 'F_SPIKES'),
    ];
    const actions = buildMekIntrinsicActions(facts({
      equipment,
      installedJumpMp: 1,
      lowerArmActuators: { left: false, right: true },
      handActuators: { left: false, right: true },
    }));

    expect(actions.find(action => action.id === 'intrinsic:punch:LA')).toEqual(jasmine.objectContaining({
      damage: { kind: 'fixed', value: 3, boostedValue: 6 },
      hitModifierAdjustment: 2,
    }));
    expect(actions.some(action => action.id === 'intrinsic:punch:RA')).toBeFalse();
    expect(actions.some(action => action.kind === 'club')).toBeFalse();
    expect(actions.find(action => action.kind === 'kick')).toEqual(jasmine.objectContaining({
      name: 'Kick [Talons]',
      damage: { kind: 'fixed', value: 17, boostedValue: 34 },
      hitModifierAdjustment: -1,
    }));
    expect(actions.find(action => action.kind === 'death-from-above')).toEqual(jasmine.objectContaining({
      name: 'DFA [Talons]',
      damage: { kind: 'fixed', value: 26 },
    }));
    expect(actions.find(action => action.kind === 'charge')?.damage).toEqual({
      kind: 'per-hex', coefficient: 8.25, bonus: 4,
    });
    expect(actions.find(action => action.kind === 'push')?.hitModifierAdjustment).toBe(-1);
  });

  it('applies the club claw and paired arm AES modifiers without suppressing arm punches', () => {
    const actions = buildMekIntrinsicActions(facts({ equipment: [
      fact('LA', 'F_ACTUATOR_ENHANCEMENT_SYSTEM'),
      fact('RA', 'F_ACTUATOR_ENHANCEMENT_SYSTEM'),
      fact('CT', 'F_CLUB', 'S_CLAW'),
    ] }));

    expect(actions.find(action => action.kind === 'club')).toEqual(jasmine.objectContaining({
      name: 'Club (Club/Improvised)',
      hitModifierAdjustment: 1,
    }));
    expect(actions.filter(action => action.kind === 'punch')).toHaveSize(2);
  });

  it('keeps prototype TSM inert and exposes LAM alternate damage explicitly', () => {
    const actions = buildMekIntrinsicActions(facts({
      config: 'LAM',
      equipment: [fact('CT', 'F_TSM', 'F_PROTOTYPE')],
    }));

    expect(actions.find(action => action.kind === 'kick')?.damage).toEqual({
      kind: 'fixed', value: 11, alternatives: { airmek: { kind: 'fixed', value: 6 } },
    });
    expect(intrinsicActionBaseDamageText(actions.find(action => action.kind === 'airmek-ram')!))
      .toBe('11/hex');
  });

  it('returns deeply immutable semantic capabilities', () => {
    const actions = buildMekIntrinsicActions(facts());
    const punch = actions[0];
    expect(Object.isFrozen(actions)).toBeTrue();
    expect(Object.isFrozen(punch)).toBeTrue();
    expect(Object.isFrozen(punch.locations)).toBeTrue();
    expect(punch.hitModifierAdjustment).toBe(0);
    expect(Object.isFrozen(punch.damage)).toBeTrue();
  });
});

function facts(overrides: Partial<MekIntrinsicActionFacts> = {}): MekIntrinsicActionFacts {
  return {
    tonnage: 55,
    config: 'Biped',
    installedJumpMp: 0,
    lowerArmActuators: { left: true, right: true },
    handActuators: { left: true, right: true },
    equipment: [],
    ...overrides,
  };
}

function fact(location: string, ...flags: EquipmentFlag[]): MekIntrinsicEquipmentFact {
  return { location, flags: new Set<EquipmentFlag>(flags) };
}
