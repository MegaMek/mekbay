// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from './cbt-ruleset.model';
import { isWeaponEnhancementEquipment } from './weapon-enhancement.model';
import type { Equipment } from './equipment.model';
import type { EquipmentStatus } from './equipment-status.model';
import type { ToHitAdjustment } from './rules/game-rules';

export const APOLLO_STANDARD_MODE = 'Standard';
export const APOLLO_SATURATION_MODE = 'Saturation';
export const APOLLO_FLAG = 'F_APOLLO' as const;
export const APOLLO_MODES = Object.freeze([APOLLO_STANDARD_MODE, APOLLO_SATURATION_MODE] as const);

export type ApolloMode = typeof APOLLO_MODES[number];

export function isApolloMode(value: unknown): value is ApolloMode {
    return value === APOLLO_STANDARD_MODE || value === APOLLO_SATURATION_MODE;
}

/** Core 2026 owns the selectable saturation rule; Total Warfare uses the passive FCS bonus. */
export function supportsApolloSaturationModeForRuleset(implementation: CBTRuleset): boolean {
    return implementation === 'core-2026';
}

export interface ApolloEquipmentView {
    readonly ammoType?: string;
    hasFlag(flag: string): boolean;
}

export function isApolloEquipment(equipment: ApolloEquipmentView | null | undefined): boolean {
    return equipment?.hasFlag(APOLLO_FLAG) === true;
}

export function isApolloCompatibleWeapon(equipment: ApolloEquipmentView | null | undefined): boolean {
    return equipment?.ammoType === 'MRM' || equipment?.hasFlag('F_MRM') === true;
}

export function isApolloLink(
    source: ApolloEquipmentView | null | undefined,
    target: ApolloEquipmentView | null | undefined,
): boolean {
    return isApolloEquipment(source)
        && isWeaponEnhancementEquipment(source)
        && isApolloCompatibleWeapon(target);
}

/** Total Warfare's passive bonus for an installed Apollo-to-MRM link. */
export function apolloToHitAdjustment(
    source: Equipment | undefined,
    weapon: Equipment | undefined,
    status: EquipmentStatus,
    ruleset: CBTRuleset,
): ToHitAdjustment | null {
    if (!source || !isApolloLink(source, weapon) || supportsApolloSaturationModeForRuleset(ruleset)) return null;
    const label = source.shortName || source.name;
    const weakened = status !== 'available';
    return Object.freeze({
        kind: 'add' as const,
        label: status === 'destroyed'
            ? `${label} Destroyed`
            : status === 'disabled'
                ? `${label} Disabled`
                : label,
        modifier: weakened ? 0 : -1,
        weakened,
    });
}
