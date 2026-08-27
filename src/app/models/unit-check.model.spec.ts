// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    PENDING_UNIT_CHECK_KINDS,
    UNIT_CHECK_CAUSE,
    UNIT_CHECK_DEFINITIONS,
    UNIT_CHECK_KIND,
    unitCheckActionLabel,
    unitCheckAutomaticEffect,
    unitCheckAutomationKey,
    unitCheckLabel,
    unitCheckPriority,
    unitCheckReviewDescription,
    unitCheckUsesPilotAutomation,
    type PendingUnitCheckKind,
    type UnitCheckContext,
} from './unit-check.model';

describe('unit-check definitions', () => {
    const context: UnitCheckContext = {
        target: 6,
        heat: 18,
        hits: 1,
        crewHits: 1,
        consciousnessCheckHit: 1,
    };

    it('defines every serialized kind exactly once', () => {
        expect(Object.keys(UNIT_CHECK_DEFINITIONS)).toEqual(PENDING_UNIT_CHECK_KINDS);
    });

    it('owns exact heat-review text without service-side formatting', () => {
        const cases: readonly [PendingUnitCheckKind, Partial<UnitCheckContext>, string][] = [
            [UNIT_CHECK_KIND.HEAT_SHUTDOWN, {}, 'Shutdown check 6+'],
            [UNIT_CHECK_KIND.HEAT_SHUTDOWN, { target: undefined }, 'Automatic shutdown!'],
            [UNIT_CHECK_KIND.SHUTDOWN_RECOVERY, {}, 'Shutdown recovery check 6+'],
            [
                UNIT_CHECK_KIND.SHUTDOWN_RECOVERY,
                { target: undefined, heat: 13 },
                'Engine restarts automatically at heat 13',
            ],
            [UNIT_CHECK_KIND.HEAT_AMMO_EXPLOSION, {}, 'Ammunition explosion check 6+'],
            [UNIT_CHECK_KIND.HEAT_RANDOM_MOVEMENT, {}, 'Random movement check 6+'],
            [
                UNIT_CHECK_KIND.HEAT_RANDOM_MOVEMENT,
                { target: undefined, heat: 4 },
                'Heat 4 ends the heat-induced random-movement effect',
            ],
            [
                UNIT_CHECK_KIND.HEAT_PILOT_DAMAGE,
                { target: 9, heat: 27, hits: 2 },
                'Pilot heat damage check 9+ · 2 pilot hits on failure',
            ],
            [UNIT_CHECK_KIND.HEAT_LIFE_SUPPORT, { hits: 2 }, 'Damaged life support (2 pilot hits)'],
            [UNIT_CHECK_KIND.LIFE_SUPPORT_DROWNING, {}, 'Damaged life support (1 pilot hit)'],
        ];

        for (const [kind, overrides, expected] of cases) {
            expect(unitCheckReviewDescription(kind, { ...context, ...overrides }))
                .withContext(kind)
                .toBe(expected);
        }
    });

    it('owns labels, ordering, actions, automation, and result text', () => {
        expect(unitCheckLabel(UNIT_CHECK_KIND.SEATBELT, true)).toBe('Seatbelt check · Falling');
        expect(unitCheckPriority(UNIT_CHECK_KIND.CONSCIOUSNESS, false)).toBe(80);
        expect(unitCheckPriority(UNIT_CHECK_KIND.CONSCIOUSNESS, true)).toBe(5);
        expect(unitCheckActionLabel(UNIT_CHECK_KIND.CONSCIOUSNESS, 'success')).toBe('STAYS CONSCIOUS');
        expect(unitCheckActionLabel(UNIT_CHECK_KIND.CONSCIOUSNESS, 'failed')).toBe('UNCONSCIOUS');
        expect(unitCheckAutomaticEffect(UNIT_CHECK_KIND.HEAT_SHUTDOWN, context, 'failed'))
            .toBe('unit shut down');
        expect(unitCheckAutomationKey(UNIT_CHECK_KIND.AERO_CONTROL_RECOVERY, {
            ...context,
            cause: UNIT_CHECK_CAUSE.HEAT_RANDOM_MOVEMENT,
        })).toBe('heatEffectsCheck');
        expect(unitCheckUsesPilotAutomation(UNIT_CHECK_KIND.AERO_CONTROL_RECOVERY, {
            ...context,
            cause: UNIT_CHECK_CAUSE.HEAT_RANDOM_MOVEMENT,
        })).toBeFalse();
    });
});
