// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSubtype, UnitSummary, UnitType } from './unit-summary.model';

export type UnitSummaryClassification = Pick<UnitSummary, 'type' | 'subtype'>;

type SummaryType<T extends UnitType> = UnitSummaryClassification & { type: T };
type InfantrySummary = SummaryType<'Infantry'>;
type BattleArmorSummary = InfantrySummary & { subtype: 'Battle Armor' };
type ConventionalInfantrySubtype = Extract<UnitSubtype, `${string}Conventional Infantry`>;
type ConventionalInfantrySummary = InfantrySummary & { subtype: ConventionalInfantrySubtype };
type VehicleSummary = SummaryType<'Tank' | 'Naval' | 'VTOL'>;

/** Centralized broad and infantry-specific classification for UnitSummary data. */
export class UnitSummaryTypeGuard {
    private constructor() {}

    static isMek(unit: UnitSummaryClassification | null | undefined): unit is SummaryType<'Mek'> {
        return unit?.type === 'Mek';
    }

    static isAero(unit: UnitSummaryClassification | null | undefined): unit is SummaryType<'Aero'> {
        return unit?.type === 'Aero';
    }

    static isProtoMek(unit: UnitSummaryClassification | null | undefined): unit is SummaryType<'ProtoMek'> {
        return unit?.type === 'ProtoMek';
    }

    static isInfantry(unit: UnitSummaryClassification | null | undefined): unit is InfantrySummary {
        return unit?.type === 'Infantry';
    }

    static isBattleArmor(unit: UnitSummaryClassification | null | undefined): unit is BattleArmorSummary {
        return this.isInfantry(unit) && unit.subtype === 'Battle Armor';
    }

    static isConventionalInfantry(
        unit: UnitSummaryClassification | null | undefined,
    ): unit is ConventionalInfantrySummary {
        return this.isInfantry(unit) && unit.subtype !== 'Battle Armor';
    }

    static isTank(unit: UnitSummaryClassification | null | undefined): unit is SummaryType<'Tank'> {
        return unit?.type === 'Tank';
    }

    static isNaval(unit: UnitSummaryClassification | null | undefined): unit is SummaryType<'Naval'> {
        return unit?.type === 'Naval';
    }

    static isVTOL(unit: UnitSummaryClassification | null | undefined): unit is SummaryType<'VTOL'> {
        return unit?.type === 'VTOL';
    }

    static isVehicle(unit: UnitSummaryClassification | null | undefined): unit is VehicleSummary {
        return this.isTank(unit) || this.isNaval(unit) || this.isVTOL(unit);
    }

    static isHandheldWeapon(
        unit: UnitSummaryClassification | null | undefined,
    ): unit is SummaryType<'Handheld Weapon'> {
        return unit?.type === 'Handheld Weapon';
    }
}
