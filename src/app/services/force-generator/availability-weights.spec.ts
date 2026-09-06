// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { getScopedAvailabilityWeights, includeMulAvailabilityFallback } from './availability-weights';

describe('force generation availability weights', () => {
    const scope = { eraIdTexts: ['3000', '3050'], factionIdTextSet: new Set(['10', '20']) };

    it('takes independent production and salvage maxima across only the requested scope', () => {
        const record = { n: 'Test', e: { '3000': { '10': [2, 8] as [number, number], '99': [100, 100] as [number, number] }, '3050': { '20': [6, 1] as [number, number] }, '3100': { '10': [100, 100] as [number, number] } } };
        expect(getScopedAvailabilityWeights(record, scope, true)).toEqual({ requisition: 6, salvage: 8 });
        expect(getScopedAvailabilityWeights(record, scope, false)).toEqual({ requisition: 6, salvage: 8 });
    });

    it('distinguishes missing unit records from missing exact-context records', () => {
        expect(getScopedAvailabilityWeights(undefined, scope, true)).toEqual({ requisition: 10, salvage: 0 });
        expect(getScopedAvailabilityWeights({ n: 'Test', e: {} }, scope, true)).toEqual({ requisition: 0, salvage: 0 });
        expect(getScopedAvailabilityWeights(undefined, scope, false)).toEqual({ requisition: 0, salvage: 0 });
    });

    it('uses unknown weight only in MegaMek mode for an empty scope', () => {
        const empty = { eraIdTexts: [], factionIdTextSet: scope.factionIdTextSet };
        const record = { n: 'Test', e: {} };
        expect(getScopedAvailabilityWeights(record, empty, true)).toEqual({ requisition: 10, salvage: 0 });
        expect(getScopedAvailabilityWeights(record, empty, false)).toEqual({ requisition: 0, salvage: 0 });
    });

    it('lets explicit zero records suppress MUL fallback and preserves stronger weights and salvage', () => {
        const weights = { requisition: 0, salvage: 7 };
        includeMulAvailabilityFallback(weights, [0, 0]);
        expect(weights).toEqual({ requisition: 0, salvage: 7 });
        includeMulAvailabilityFallback(weights, undefined);
        expect(weights).toEqual({ requisition: 10, salvage: 7 });
        const strong = { requisition: 25, salvage: 3 };
        includeMulAvailabilityFallback(strong, undefined);
        expect(strong).toEqual({ requisition: 25, salvage: 3 });
    });
});
