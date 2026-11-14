// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import { getMekLimbLocations, getMekLocationLabel, MEK_TORSO_LOCATIONS, type MekConfig } from '../entity/types/mek';
import type { MekHitArc } from '../../utils/record-sheet-reference-table';
import { aimedShotTargetFamily } from '../rules/aimed-shot-rules';
import type { TnTargetUnitType } from '../target-number-calculator.model';
import type { AimedShotLocation } from './attack-hit-location';
import {
    projectWeaponTargetPresentation,
    type EquipmentPanelComponent,
    type WeaponAttackContext,
} from './equipment-panel';
import type { TargetingTarget } from './targeting-target';

/** One location of the target as the aimed-shot picker shows it. */
export interface AimedShotChoice {
    readonly code: string;
    readonly label: string;
    /**
     * What is left where the shot would strike: armor, structure in parentheses once the armor is gone, or a cross
     * for a destroyed location. Null when the unit is not open here.
     */
    readonly remaining: string | null;
    /** The shot would strike the location's rear armor: a 'Mech's torso from behind. */
    readonly rearFace: boolean;
    /** What is left on the front of a location struck from behind; null when the unit is not open here. */
    readonly frontRemaining: string | null;
    /**
     * The target number of an aimed shot there as the weapon's row would show it (a number, or `M?` while the
     * attacker's movement is undeclared); null when the weapon may not aim there.
     */
    readonly targetNumber: string | null;
}

export interface AimedShotChoices {
    /** The weapon's target number without aiming, as its row shows it. */
    readonly normalTargetNumber: string | null;
    /** The location the weapon aims at now. */
    readonly current: string | null;
    readonly locations: readonly AimedShotChoice[];
}

/** The chassis a 'Mech target of a declared type has; one of no declared type is a biped. */
export function targetMekConfig(unitType: TnTargetUnitType | undefined): MekConfig {
    return unitType === 'mek-quad' ? 'Quad' : unitType === 'mek-tripod' ? 'Tripod' : 'Biped';
}

/**
 * What a weapon may aim at on its target from `arc`, each location with its target number. `locations` are the
 * struck unit's own (`aimedShotLocations`); without the unit (null) a 'Mech target shows the locations of its
 * declared type, and a vehicle none.
 */
export function aimedShotChoices(
    row: EquipmentPanelComponent,
    target: TargetingTarget,
    attack: WeaponAttackContext,
    ruleset: CBTRuleset,
    locations: readonly AimedShotLocation[] | null,
    arc: MekHitArc = 'front',
): AimedShotChoices {
    const remaining = (armor: number, location: AimedShotLocation): string =>
        location.destroyed ? '✕' : armor > 0 ? String(armor) : `(${location.structure})`;
    const targetNumber = (aim: string | null): string | null => {
        const presentation = projectWeaponTargetPresentation(row, target, attack, ruleset, aim);
        return (aim === null || presentation.aim !== null) && !presentation.outOfRange
            ? presentation.targetNumberText || null
            : null;
    };
    const undeclared = locations !== null || aimedShotTargetFamily(ruleset, target.unitType) !== 'mek' ? [] : [
        'HD', 'CT', 'LT', 'RT', ...getMekLimbLocations(targetMekConfig(target.unitType)),
    ].map(code => ({ code, label: getMekLocationLabel(code) ?? code }));
    return Object.freeze({
        normalTargetNumber: targetNumber(null),
        current: projectWeaponTargetPresentation(row, target, attack, ruleset).aim?.location ?? null,
        locations: Object.freeze([
            ...(locations ?? []).map(location => Object.freeze({
                code: location.code,
                label: location.label,
                remaining: remaining(location.armor, location),
                rearFace: location.rearFace,
                frontRemaining: remaining(location.frontArmor, location),
                targetNumber: location.destroyed ? null : targetNumber(location.code),
            })),
            ...undeclared.map(location => Object.freeze({
                ...location,
                remaining: null,
                rearFace: arc === 'rear' && MEK_TORSO_LOCATIONS.has(location.code),
                frontRemaining: null,
                targetNumber: targetNumber(location.code),
            })),
        ]),
    });
}
