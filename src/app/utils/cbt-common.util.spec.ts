// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary, UnitSubtype, UnitType } from '../models/unit-summary.model';
import { getEffectivePilotingSkill, getFixedPilotingSkill } from './cbt-common.util';

function createUnit(overrides: Partial<UnitSummary> = {}): UnitSummary {
    return {
        type: 'Mek' as UnitType,
        subtype: '' as UnitSubtype,
        canAntiMech: true,
        ...overrides,
    } as UnitSummary;
}

describe('CBT common rules', () => {
    describe('getFixedPilotingSkill', () => {
        it('returns null for units with variable Piloting', () => {
            expect(getFixedPilotingSkill(createUnit())).toBeNull();
            expect(getFixedPilotingSkill(createUnit({
                type: 'Infantry' as UnitType,
                subtype: 'Conventional Infantry' as UnitSubtype,
                canAntiMech: true,
            }))).toBeNull();
        });

        it('returns 5 for ProtoMeks and mechanized infantry without anti-Mech capability', () => {
            expect(getFixedPilotingSkill(createUnit({ type: 'ProtoMek' as UnitType }))).toBe(5);
            expect(getFixedPilotingSkill(createUnit({
                type: 'Infantry' as UnitType,
                subtype: 'Mechanized Conventional Infantry' as UnitSubtype,
                canAntiMech: false,
            }))).toBe(5);
        });

        it('returns 8 for non-mechanized conventional infantry without anti-Mech capability', () => {
            for (const subtype of ['Conventional Infantry', 'Motorized Conventional Infantry']) {
                expect(getFixedPilotingSkill(createUnit({
                    type: 'Infantry' as UnitType,
                    subtype: subtype as UnitSubtype,
                    canAntiMech: false,
                }))).withContext(subtype).toBe(8);
            }
        });

        it('returns 5 for other infantry without anti-Mech capability', () => {
            expect(getFixedPilotingSkill(createUnit({
                type: 'Infantry' as UnitType,
                subtype: '' as UnitSubtype,
                canAntiMech: false,
            }))).toBe(5);
        });
    });

    describe('getEffectivePilotingSkill', () => {
        it('preserves requested boundary values for variable-Piloting units', () => {
            expect(getEffectivePilotingSkill(createUnit(), 0)).toBe(0);
            expect(getEffectivePilotingSkill(createUnit(), 8)).toBe(8);
        });

        it('always returns the mandatory value for fixed-Piloting units', () => {
            const protoMek = createUnit({ type: 'ProtoMek' as UnitType });

            expect(getEffectivePilotingSkill(protoMek, 0)).toBe(5);
            expect(getEffectivePilotingSkill(protoMek, 5)).toBe(5);
            expect(getEffectivePilotingSkill(protoMek, 8)).toBe(5);
        });
    });
});