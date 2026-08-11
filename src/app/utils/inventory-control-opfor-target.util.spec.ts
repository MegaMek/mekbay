// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { MotiveModes } from '../models/motiveModes.model';
import type { Unit } from '../models/units.model';
import {
    deriveOpforTargetCalculatorState,
    getOpforInventoryTargetId,
    isLargeInventoryTarget,
    isOpforInventoryTargetId,
    resolveInventoryTargetUnitType
} from './inventory-control-opfor-target.util';

function unit(overrides: Partial<Unit> = {}): Unit {
    return {
        type: 'Mek',
        subtype: 'BattleMek',
        moveType: 'Biped',
        tons: 50,
        weightClass: 'Medium',
        ...overrides
    } as Unit;
}

function forceUnit(options: {
    definition?: Partial<Unit>;
    conditions?: string[];
    distance?: number | null;
    airborne?: boolean | null;
    moveMode?: MotiveModes | null;
} = {}): CBTForceUnit {
    const conditions = new Set(options.conditions ?? []);
    const moveDistance = signal<number | null>(options.distance ?? null);
    const airborne = signal<boolean | null>(options.airborne ?? null);
    const moveMode = signal<MotiveModes | null>(options.moveMode ?? null);
    return {
        getUnit: () => unit(options.definition),
        getCondition: (condition: string) => conditions.has(condition),
        turnState: () => ({ moveDistance, airborne, moveMode })
    } as unknown as CBTForceUnit;
}

describe('inventory control OPFOR targets', () => {
    it('uses stable namespaced IDs', () => {
        expect(getOpforInventoryTargetId('enemy-1')).toBe('opfor:enemy-1');
        expect(isOpforInventoryTargetId('opfor:enemy-1')).toBeTrue();
        expect(isOpforInventoryTargetId('A')).toBeFalse();
    });

    it('maps supported CBT unit classifications', () => {
        expect(resolveInventoryTargetUnitType(unit())).toBe('mek-biped');
        expect(resolveInventoryTargetUnitType(unit({ subtype: 'Quad BattleMek' }))).toBe('mek-quad');
        expect(resolveInventoryTargetUnitType(unit({ subtype: 'BattleMek', moveType: 'Tripod' }))).toBe('mek-tripod');
        expect(resolveInventoryTargetUnitType(unit({ type: 'Infantry', subtype: 'Battle Armor' }))).toBe('battle-armor');
        expect(resolveInventoryTargetUnitType(unit({ type: 'Infantry', subtype: 'Conventional Infantry' }))).toBe('infantry');
        expect(resolveInventoryTargetUnitType(unit({ type: 'ProtoMek', subtype: 'ProtoMek' }))).toBe('protoMek');
        expect(resolveInventoryTargetUnitType(unit({ type: 'VTOL', subtype: 'Combat Vehicle' }))).toBe('vtol');
        expect(resolveInventoryTargetUnitType(unit({ type: 'Tank', subtype: 'Combat Vehicle' }))).toBe('vehicle');
        expect(resolveInventoryTargetUnitType(unit({ type: 'Aero', subtype: 'Aerospace Fighter' }))).toBe('aero');
    });

    it('recognizes only Meks above 100 tons as large targets', () => {
        expect(isLargeInventoryTarget(unit({ tons: 100 }))).toBeFalse();
        expect(isLargeInventoryTarget(unit({ tons: 101 }))).toBeTrue();
        expect(isLargeInventoryTarget(unit({ type: 'Tank', tons: 150, weightClass: 'Assault' }))).toBeFalse();
        expect(isLargeInventoryTarget(unit({ type: 'Tank', tons: 200, weightClass: 'Colossal/Super-Heavy' }))).toBeFalse();
    });

    it('derives movement, airborne, skidding, and large state', () => {
        const state = deriveOpforTargetCalculatorState(forceUnit({
            definition: { tons: 120 },
            conditions: ['skidding'],
            distance: 8,
            airborne: true
        }));

        expect(state).toEqual(jasmine.objectContaining({
            targetMovementBracket: '7-9',
            isAirborne: true,
            skidding: true,
            largeTarget: true
        }));
    });

    it('derives immobile stance without discarding movement and jump state', () => {
        const state = deriveOpforTargetCalculatorState(forceUnit({
            conditions: ['immobile', 'prone', 'skidding'],
            distance: 12,
            airborne: true
        }), { interveningWoods: 'light1' });

        expect(state).toEqual(jasmine.objectContaining({
            prone: true,
            immobile: true,
            targetMovementBracket: '10-17',
            isAirborne: true,
            skidding: true,
            interveningWoods: 'light1'
        }));
    });

    it('treats jump movement as airborne without an explicit airborne flag', () => {
        const state = deriveOpforTargetCalculatorState(forceUnit({
            moveMode: 'jump',
            airborne: false,
            distance: 5
        }));

        expect(state.isAirborne).toBeTrue();
        expect(state.targetMovementBracket).toBe('5-6');
    });

    it('preserves unknown movement instead of treating it as zero', () => {
        expect(deriveOpforTargetCalculatorState(forceUnit()).targetMovementBracket).toBeNull();
    });
});
