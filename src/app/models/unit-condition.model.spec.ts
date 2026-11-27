// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    isUnitConditionKey,
    requireUnitConditionKey,
    UNIT_CONDITION_KEYS,
} from './unit-condition.model';
import { UNIT_CONDITION_DEFINITIONS } from './unit-status-presentation';
import {
    isMekLocationConditionKey,
    MEK_LOCATION_CONDITION_KEYS,
} from './runtime/runtime-state';

describe('unit conditions', () => {
    it('has one exact runtime vocabulary with presentation for every key', () => {
        expect(UNIT_CONDITION_DEFINITIONS.map(condition => condition.key))
            .toEqual([...UNIT_CONDITION_KEYS]);
        for (const condition of UNIT_CONDITION_KEYS) {
            expect(isUnitConditionKey(condition)).withContext(condition).toBeTrue();
        }
    });

    it('rejects aliases, normalization, and arbitrary strings at boundaries', () => {
        expect(isUnitConditionKey('immobilized')).toBeFalse();
        expect(isUnitConditionKey(' prone ')).toBeFalse();
        expect(isUnitConditionKey('not-a-condition')).toBeFalse();
        expect(isUnitConditionKey(42)).toBeFalse();
        expect(() => requireUnitConditionKey('immobilized')).toThrowError(/Unknown unit condition/);
    });
});

describe('Mek location conditions', () => {
    it('uses the same exact-key boundary contract', () => {
        for (const condition of MEK_LOCATION_CONDITION_KEYS) {
            expect(isMekLocationConditionKey(condition)).withContext(condition).toBeTrue();
        }
        expect(isMekLocationConditionKey(' flooded ')).toBeFalse();
        expect(isMekLocationConditionKey('removed')).toBeFalse();
    });
});
