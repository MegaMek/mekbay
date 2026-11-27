// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    combineTargetCalculator,
    splitTargetCalculatorByOwner,
} from './targeting-target';

describe('target calculator ownership', () => {
    it('keeps target-intrinsic calculator fields with the encounter', () => {
        const result = splitTargetCalculatorByOwner({
            isAirborne: true,
            targetMovementBracket: '7-9',
            skidding: true,
            prone: true,
            targetHexCover: 'heavy',
            waterDepth: 'underwater-depth-1',
            buildingCover: 'building-2',
            largeTarget: true,
            narcAboveWater: true,
            narcUnderwater: false,
            ecmShielded: true,
        });

        expect(result.encounter).toEqual({
            isAirborne: true,
            targetMovementBracket: '7-9',
            skidding: true,
            prone: true,
            targetHexCover: 'heavy',
            waterDepth: 'underwater-depth-1',
            buildingCover: 'building-2',
            largeTarget: true,
            narcAboveWater: true,
            narcUnderwater: false,
            ecmShielded: true,
        });
        expect(result.attacker).toBeUndefined();
    });

    it('keeps directional, indirect, spotter, and intervening fields with the attacker', () => {
        const result = splitTargetCalculatorByOwner({
            interveningWoods: 'light2',
            partialCover: true,
            attackDirection: 'rear',
            indirectFire: true,
            secondaryTarget: true,
            secondaryTargetSideBack: false,
            spotterMoveMode: 'jump',
            spotterDeclaredAttacks: true,
            customModifier: -2,
        });

        expect(result.encounter).toBeUndefined();
        expect(result.attacker).toEqual({
            interveningWoods: 'light2',
            partialCover: true,
            attackDirection: 'rear',
            indirectFire: true,
            secondaryTarget: true,
            secondaryTargetSideBack: false,
            spotterMoveMode: 'jump',
            spotterDeclaredAttacks: true,
            customModifier: -2,
        });
    });

    it('combines encounter state with attacker state without mutating either source', () => {
        const encounter = { immobile: true, targetHexCover: 'light' as const };
        const attacker = { partialCover: true, indirectFire: true };

        const combined = combineTargetCalculator(encounter, attacker)!;
        combined.partialCover = false;

        expect(encounter).toEqual({ immobile: true, targetHexCover: 'light' });
        expect(attacker).toEqual({ partialCover: true, indirectFire: true });
    });

    it('handles absent calculator state', () => {
        expect(splitTargetCalculatorByOwner(undefined)).toEqual({});
        expect(combineTargetCalculator(undefined, undefined)).toBeUndefined();
    });

    it('preserves explicitly cleared fields when splitting a calculator patch', () => {
        expect(splitTargetCalculatorByOwner({
            targetHexCover: 'heavy',
            waterDepth: undefined,
            buildingCover: undefined,
        }).encounter).toEqual({
            targetHexCover: 'heavy',
            waterDepth: undefined,
            buildingCover: undefined,
        });
    });
});
