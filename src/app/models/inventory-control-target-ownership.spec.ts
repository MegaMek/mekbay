// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    mergeInventoryControlCalculatorState,
    splitInventoryControlCalculatorState
} from './inventory-control-runtime-state.model';

describe('inventory control target ownership', () => {
    it('keeps target-intrinsic calculator fields shared', () => {
        const result = splitInventoryControlCalculatorState({
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

        expect(result.shared).toEqual({
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
        expect(result.local).toBeUndefined();
    });

    it('keeps directional, indirect, spotter, and intervening fields local', () => {
        const result = splitInventoryControlCalculatorState({
            interveningWoods: 'light2',
            partialCover: true,
            attackDirection: 'rear',
            indirectFire: true,
            secondaryTarget: true,
            secondaryTargetSideBack: false,
            spotterMoveMode: 'jump',
            spotterDeclaredAttacks: true
        });

        expect(result.shared).toBeUndefined();
        expect(result.local).toEqual({
            interveningWoods: 'light2',
            partialCover: true,
            attackDirection: 'rear',
            indirectFire: true,
            secondaryTarget: true,
            secondaryTargetSideBack: false,
            spotterMoveMode: 'jump',
            spotterDeclaredAttacks: true
        });
    });

    it('merges shared state with local state without mutating either source', () => {
        const shared = { immobile: true, targetHexCover: 'light' as const };
        const local = { partialCover: true, indirectFire: true };

        const merged = mergeInventoryControlCalculatorState(shared, local)!;
        merged.partialCover = false;

        expect(shared).toEqual({ immobile: true, targetHexCover: 'light' });
        expect(local).toEqual({ partialCover: true, indirectFire: true });
    });

    it('handles absent calculator state', () => {
        expect(splitInventoryControlCalculatorState(undefined)).toEqual({});
        expect(mergeInventoryControlCalculatorState(undefined, undefined)).toBeUndefined();
    });

    it('preserves explicitly cleared fields when splitting a calculator patch', () => {
        expect(splitInventoryControlCalculatorState({
            targetHexCover: 'heavy',
            waterDepth: undefined,
            buildingCover: undefined,
        }).shared).toEqual({
            targetHexCover: 'heavy',
            waterDepth: undefined,
            buildingCover: undefined,
        });
    });
});
