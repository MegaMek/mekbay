// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { CBTForceUnit } from '../cbt-force-unit.model';
import { WeaponEquipment } from '../equipment.model';
import type { CriticalSlot } from '../force-serialization';
import type { MountedEquipment } from '../mounted-equipment.model';
import { AeroRules } from './aero-rules';

function createHarness(
    heat: number,
    physical = false,
    crewState: 'healthy' | 'unconscious' = 'healthy',
    pilotHits = 0,
    criticalSlots: CriticalSlot[] = [],
    conditions: ReadonlySet<string> = new Set(),
): { rules: AeroRules; entry: MountedEquipment } {
    const crew = {
        getState: () => crewState,
        getSkill: () => 4,
        getHits: () => pilotHits,
    };
    const unit = {
        isLoaded: () => true,
        getHeat: () => ({ current: heat }),
        getInventory: () => [],
        getCritSlots: () => criticalSlots,
        getCrewMember: () => crew,
        getCrewMembers: () => [crew],
        getCondition: (condition: string) => conditions.has(condition),
        isEquipmentOperational: () => true,
        gameRules: { supportsSkidding: true },
    } as unknown as CBTForceUnit;
    const entry = {
        committedDestroyed: () => false,
        isPhysicalWeapon: () => physical,
        equipment: Object.create(WeaponEquipment.prototype),
        critSlots: [],
        states: new Map<string, string>(),
    } as unknown as MountedEquipment;
    return { rules: new AeroRules(unit), entry };
}

describe('AeroRules', () => {
    it('does not apply a fire modifier below the first heat threshold', () => {
        const { rules, entry } = createHarness(7);
        const modifiers = rules.getEquipmentToHitModifiers(entry);

        expect(modifiers).toEqual([]);
    });

    it('includes heat as a named weakened entry-state modifier', () => {
        const { rules, entry } = createHarness(8);
        const modifiers = rules.getEquipmentToHitModifiers(entry);

        expect(modifiers).toEqual([
            { label: 'Heat - Fire Modifier', modifier: 1, weakened: true, kind: 'heat' }
        ]);
    });

    it('uses the cumulative modifier at higher heat thresholds', () => {
        const { rules, entry } = createHarness(24);
        const modifiers = rules.getEquipmentToHitModifiers(entry);

        expect(modifiers).toEqual([
            { label: 'Heat - Fire Modifier', modifier: 4, weakened: true, kind: 'heat' }
        ]);
    });

    it('does not apply heat fire modifiers to physical attacks', () => {
        const { rules, entry } = createHarness(24, true);
        const modifiers = rules.getEquipmentToHitModifiers(entry);

        expect(modifiers).toEqual([]);
    });

    it('makes an aerospace unit immobile while its pilot is unconscious', () => {
        const { rules } = createHarness(0, false, 'unconscious');

        expect(rules.hasComputedCondition('immobile')).toBeTrue();
    });

    it('uses pilot, avionics, and life-support damage in a standard Control Roll', () => {
        const { rules } = createHarness(0, false, 'healthy', 2, [
            { id: 'avionics_hit_1', destroyed: 1 },
            { id: 'avionics_hit_2', destroying: 2 },
            { id: 'life_support_hit_1', destroyed: 3 },
            { id: 'fcs_hit_1', destroyed: 4 },
        ]);

        expect(rules.getStandardControlRollTarget()).toBe(9);
    });

    it('keeps out-of-control and random movement as separate movement conditions', () => {
        const controlled = createHarness(0).rules;
        const outOfControl = createHarness(0, false, 'healthy', 0, [], new Set(['out-of-control'])).rules;
        const randomMovement = createHarness(0, false, 'healthy', 0, [], new Set(['random-movement'])).rules;

        expect(controlled.isMotiveModeAvailable('run')).toBeTrue();
        expect(outOfControl.isMotiveModeAvailable('run')).toBeFalse();
        expect(randomMovement.isMotiveModeAvailable('run')).toBeFalse();
        expect(outOfControl.isMotiveModeAvailable('stationary')).toBeTrue();
        expect(randomMovement.isMotiveModeAvailable('stationary')).toBeTrue();
    });

    it('derives shutdown out-of-control without inventing random movement', () => {
        const { rules } = createHarness(8, false, 'healthy', 0, [], new Set(['shutdown']));

        expect(rules.hasComputedCondition('out-of-control')).toBeTrue();
        expect(rules.hasComputedCondition('random-movement')).toBeFalse();
        expect(rules.computedConditions()).toContain('out-of-control');
    });

    it('applies the Total Warfare out-of-control firing modifier independently of random movement', () => {
        const { rules, entry } = createHarness(8, false, 'healthy', 0, [], new Set(['out-of-control']));

        expect(rules.getEquipmentToHitModifiers(entry)).toEqual([
            { label: 'Heat - Fire Modifier', modifier: 1, weakened: true, kind: 'heat' },
            { label: 'Out of Control', modifier: 2, weakened: true },
        ]);
    });
});
