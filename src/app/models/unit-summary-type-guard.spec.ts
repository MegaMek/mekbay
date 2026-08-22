// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSubtype, UnitType } from './unit-summary.model';
import { UnitSummaryTypeGuard, type UnitSummaryClassification } from './unit-summary-type-guard';

function summary(type: UnitType, subtype: UnitSubtype): UnitSummaryClassification {
    return { type, subtype };
}

describe('UnitSummaryTypeGuard', () => {
    it('classifies every broad UnitSummary type', () => {
        expect(UnitSummaryTypeGuard.isMek(summary('Mek', 'BattleMek'))).toBeTrue();
        expect(UnitSummaryTypeGuard.isAero(summary('Aero', 'Aerospace Fighter'))).toBeTrue();
        expect(UnitSummaryTypeGuard.isProtoMek(summary('ProtoMek', 'ProtoMek'))).toBeTrue();
        expect(UnitSummaryTypeGuard.isTank(summary('Tank', 'Combat Vehicle'))).toBeTrue();
        expect(UnitSummaryTypeGuard.isNaval(summary('Naval', 'Naval Vessel'))).toBeTrue();
        expect(UnitSummaryTypeGuard.isVTOL(summary('VTOL', 'Combat Vehicle'))).toBeTrue();
        expect(UnitSummaryTypeGuard.isHandheldWeapon(summary('Handheld Weapon', 'Handheld Weapon'))).toBeTrue();
    });

    it('distinguishes battle armor from conventional infantry', () => {
        const battleArmor = summary('Infantry', 'Battle Armor');
        const conventionalInfantry = summary('Infantry', 'Conventional Infantry');
        const mechanizedInfantry = summary('Infantry', 'Mechanized Conventional Infantry');

        expect(UnitSummaryTypeGuard.isInfantry(battleArmor)).toBeTrue();
        expect(UnitSummaryTypeGuard.isBattleArmor(battleArmor)).toBeTrue();
        expect(UnitSummaryTypeGuard.isConventionalInfantry(battleArmor)).toBeFalse();
        expect(UnitSummaryTypeGuard.isBattleArmor(conventionalInfantry)).toBeFalse();
        expect(UnitSummaryTypeGuard.isConventionalInfantry(conventionalInfantry)).toBeTrue();
        expect(UnitSummaryTypeGuard.isConventionalInfantry(mechanizedInfantry)).toBeTrue();
    });

    it('groups Tank, Naval, and VTOL summaries as vehicles', () => {
        expect(UnitSummaryTypeGuard.isVehicle(summary('Tank', 'Combat Vehicle'))).toBeTrue();
        expect(UnitSummaryTypeGuard.isVehicle(summary('Naval', 'Naval Vessel'))).toBeTrue();
        expect(UnitSummaryTypeGuard.isVehicle(summary('VTOL', 'Combat Vehicle'))).toBeTrue();
        expect(UnitSummaryTypeGuard.isVehicle(summary('Mek', 'BattleMek'))).toBeFalse();
    });

    it('handles a missing summary', () => {
        expect(UnitSummaryTypeGuard.isMek(undefined)).toBeFalse();
        expect(UnitSummaryTypeGuard.isConventionalInfantry(null)).toBeFalse();
    });
});
