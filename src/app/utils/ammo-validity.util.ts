// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoMunitionFlag } from '../models/ammo-munition-flags.type';
import { effectiveTechDateYear, TechAdvancementDates, type EquipmentTechBase } from '../models/entity/types/tech';
import type { AmmoEquipment, AmmoType } from '../models/equipment.model';
import { isBattleArmorAmmo } from '../models/equipment-platform.model';
import type { Era } from '../models/eras.model';
import type { UnitSummary, UnitType } from '../models/unit-summary.model';

/** Minimum immutable unit facts needed for construction-time ammo compatibility. */
export type AmmoCompatibilityUnitFacts = Pick<UnitSummary, 'type' | 'mixed' | 'techBase'>;

/** Immutable, mount-free facts needed to explain guided-ammo selection. */
export interface AmmoSelectionCompatibilityFacts {
    readonly artemisIV: readonly string[];
    readonly artemisV: readonly string[];
}

export interface AmmoValidityContext {
    readonly unitType?: UnitType;
    readonly era?: Era | null;
    readonly compatibilityFacts?: AmmoSelectionCompatibilityFacts;
    readonly weaponTechBases?: readonly EquipmentTechBase[];
    readonly allowAeroArtilleryAlternateMunitions?: boolean; // unofficial rules, this comes from MegaMek's AmmoType canAeroUse()
}

export type AmmoSelectionIssueReason = 'not-yet-existing-in-era'
    | 'extinct-in-era'
    | 'incompatible-tech-base'
    | 'missing-artemis-iv-component'
    | 'missing-artemis-v-component';

export interface AmmoSelectionIssue {
    reason: AmmoSelectionIssueReason;
    message: string;
}

export interface AmmoSelectionStatus {
    issues: AmmoSelectionIssue[];
}

const AMMO_SELECTION_ISSUE_MESSAGES: Record<AmmoSelectionIssueReason, string> = {
    'not-yet-existing-in-era': 'Not yet existing in this era',
    'extinct-in-era': 'Extinct in this era',
    'incompatible-tech-base': 'Ammunition tech base does not match the weapon',
    'missing-artemis-iv-component': 'Missing Artemis IV component',
    'missing-artemis-v-component': 'Missing Artemis V component',
};

export class AmmoValidityUtil {
    static isAmmoValid(ammo: AmmoEquipment, context: AmmoValidityContext = {}): boolean {
        return context.unitType !== 'Aero'
            || this.canAeroUse(ammo, !!context.allowAeroArtilleryAlternateMunitions);
    }

    static isAmmoCompatibleWithWeaponTechBases(
        ammo: AmmoEquipment,
        weaponTechBases: readonly EquipmentTechBase[] = [],
    ): boolean {
        return weaponTechBases.length === 0
            || weaponTechBases.some(weaponTechBase => this.isTechBaseCompatible(ammo.techBase, weaponTechBase));
    }

    static isAmmoCompatible(
        originalAmmo: AmmoEquipment,
        candidateAmmo: AmmoEquipment,
        unit?: AmmoCompatibilityUnitFacts,
    ): boolean {
        if (!this.isAmmoValid(candidateAmmo, { unitType: unit?.type })) return false;
        if (originalAmmo.ammoType !== candidateAmmo.ammoType) return false;
        if (originalAmmo.hasMunitionType('M_CASELESS') !== candidateAmmo.hasMunitionType('M_CASELESS')) return false;
        if (isBattleArmorAmmo(originalAmmo) !== isBattleArmorAmmo(candidateAmmo)) return false;

        if (originalAmmo.ammoType === 'AR10') return true;
        if (originalAmmo.rackSize !== candidateAmmo.rackSize) return false;
        if (originalAmmo.ammoType === 'MML' || originalAmmo.ammoType === 'AC_LBX') return true;

        return originalAmmo.ammoType === candidateAmmo.ammoType;
    }

    static getAmmoSelectionStatus(ammoOptions: readonly AmmoEquipment[], context: AmmoValidityContext = {}): Record<string, AmmoSelectionStatus> {
        return Object.fromEntries(ammoOptions.map(ammo => [ammo.internalName, { issues: this.getAmmoSelectionIssues(ammo, context) }]));
    }

    static getAmmoSelectionIssues(ammo: AmmoEquipment, context: AmmoValidityContext = {}): AmmoSelectionIssue[] {
        const reasons = [
            ...(this.isAmmoCompatibleWithWeaponTechBases(ammo, context.weaponTechBases) ? [] : ['incompatible-tech-base' as const]),
            ...this.getEraSelectionIssueReasons(ammo, context.era ?? null),
            ...this.getArtemisSelectionIssueReasons(ammo, context.compatibilityFacts),
        ];
        return reasons.map(reason => ({ reason, message: AMMO_SELECTION_ISSUE_MESSAGES[reason] }));
    }

    private static isTechBaseCompatible(ammoTechBase: EquipmentTechBase, weaponTechBase: EquipmentTechBase): boolean {
        return ammoTechBase === 'All' || weaponTechBase === 'All' || ammoTechBase === weaponTechBase;
    }

    private static getArtemisSelectionIssueReasons(
        ammo: AmmoEquipment,
        facts?: AmmoSelectionCompatibilityFacts,
    ): AmmoSelectionIssueReason[] {
        const reasons: AmmoSelectionIssueReason[] = [];

        if (ammo.hasMunitionType('M_ARTEMIS_CAPABLE') && !facts?.artemisIV.includes(ammo.internalName)) {
            reasons.push('missing-artemis-iv-component');
        }

        if (ammo.hasMunitionType('M_ARTEMIS_V_CAPABLE') && !facts?.artemisV.includes(ammo.internalName)) {
            reasons.push('missing-artemis-v-component');
        }

        return reasons;
    }

    private static canAeroUse(ammo: AmmoEquipment, allowAlternateArtilleryMunitions: boolean): boolean {
        if (allowAlternateArtilleryMunitions && this.canAeroUseAlternateArtilleryMunition(ammo)) return true;

        switch (ammo.ammoType) {
            case 'AC_LBX':
            case 'SBGAUSS':
                return ammo.hasMunitionType('M_CLUSTER');
            case 'ATM':
            case 'IATM':
                return this.hasAnyMunition(ammo, ['M_STANDARD', 'M_HIGH_EXPLOSIVE', 'M_EXTENDED_RANGE']);
            case 'AR10':
                return true;
            default:
                return this.isStandardMunition(ammo)
                    || ammo.hasMunitionType('M_ARTEMIS_CAPABLE')
                    || ammo.hasMunitionType('M_ARTEMIS_V_CAPABLE');
        }
    }

    private static canAeroUseAlternateArtilleryMunition(ammo: AmmoEquipment): boolean {
        const allowedMunitionsByAmmoType: Partial<Record<AmmoType, readonly AmmoMunitionFlag[]>> = {
            ARROW_IV: ['M_FLARE', 'M_CLUSTER', 'M_HOMING', 'M_INFERNO_IV', 'M_LASER_INHIB', 'M_SMOKE', 'M_FASCAM', 'M_DAVY_CROCKETT_M', 'M_VIBRABOMB_IV', 'M_STANDARD'],
            LONG_TOM: ['M_FLARE', 'M_CLUSTER', 'M_HOMING', 'M_FLECHETTE', 'M_SMOKE', 'M_FASCAM', 'M_DAVY_CROCKETT_M', 'M_STANDARD'],
            SNIPER: ['M_FLARE', 'M_CLUSTER', 'M_HOMING', 'M_FLECHETTE', 'M_SMOKE', 'M_FASCAM', 'M_STANDARD'],
            THUMPER: ['M_FLARE', 'M_CLUSTER', 'M_HOMING', 'M_FLECHETTE', 'M_SMOKE', 'M_FASCAM', 'M_STANDARD'],
        };

        const allowedMunitions = allowedMunitionsByAmmoType[ammo.ammoType];
        return !!allowedMunitions && this.hasAnyMunition(ammo, allowedMunitions);
    }

    private static isStandardMunition(ammo: AmmoEquipment): boolean {
        return ammo.munitionType.size === 0 || ammo.hasMunitionType('M_STANDARD');
    }

    private static hasAnyMunition(ammo: AmmoEquipment, munitionTypes: readonly AmmoMunitionFlag[]): boolean {
        return munitionTypes.some(munitionType => ammo.hasMunitionType(munitionType));
    }

    private static getEraSelectionIssueReasons(ammo: AmmoEquipment, era: Era | null): AmmoSelectionIssueReason[] {
        if (!era) return [];

        const timelines = [ammo.tech.advancement?.is, ammo.tech.advancement?.clan]
            .filter((dates): dates is TechAdvancementDates => !!dates);
        const timelineReasons = timelines.map(dates => this.getTimelineSelectionIssueReason(dates, era));
        if (timelineReasons.length === 0 || timelineReasons.some(reason => reason === null)) return [];

        return Array.from(new Set(timelineReasons.filter((reason): reason is AmmoSelectionIssueReason => reason !== null)));
    }

    private static getTimelineSelectionIssueReason(dates: TechAdvancementDates, era: Era): AmmoSelectionIssueReason | null {
        const eraStartYear = era.years.from ?? Number.NEGATIVE_INFINITY;
        const eraEndYear = era.years.to ?? Number.POSITIVE_INFINITY;
        const nonExtinctionYears = [dates.prototype, dates.production, dates.common, dates.reintroduced]
            .map(value => effectiveTechDateYear(value))
            .filter((year): year is number => year !== undefined);

        if (nonExtinctionYears.length > 0 && eraEndYear < Math.min(...nonExtinctionYears)) {
            return 'not-yet-existing-in-era';
        }

        const extinctYear = effectiveTechDateYear(dates.extinct, true);
        if (extinctYear === undefined || eraStartYear < extinctYear) return null;

        const nextAfterExtinction = nonExtinctionYears
            .filter(year => year > extinctYear)
            .sort((a, b) => a - b)[0];
        return nextAfterExtinction === undefined || eraEndYear < nextAfterExtinction ? 'extinct-in-era' : null;
    }
}
