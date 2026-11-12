// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from './cbt-ruleset.model';
import { Equipment, WeaponEquipment } from './equipment.model';
import { gameRulesFor } from './rules/game-rules';
import type { WeaponType } from './weapon-types.model';

export const FLAMER_DAMAGE_MODE = 'Damage';
export const FLAMER_HEAT_MODE = 'Heat';
export const FLAMER_FLAG = 'F_FLAMER' as const;
export const FLAMER_MODES = Object.freeze([FLAMER_DAMAGE_MODE, FLAMER_HEAT_MODE] as const);

export function isFlamerEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment instanceof WeaponEquipment && equipment.hasFlag(FLAMER_FLAG);
}

/**
 * Weapons whose attacker may declare heat in place of damage: flamers, and the flame-based battle armor and infantry
 * weapons, plasma and incendiary ones (TW pp. 304-305, note §§; TechManual's flame-based feature; MegaMek
 * InfantryWeapon.isFlameBased).
 */
export function isHeatOrDamageWeapon(equipment: Equipment | null | undefined): boolean {
    return isFlamerEquipment(equipment) || (equipment instanceof WeaponEquipment
        && (equipment.hasFlag('F_BA_WEAPON') || equipment.hasFlag('F_INFANTRY'))
        && equipment.hasAnyFlag(['F_PLASMA', 'F_INFERNO', 'F_INCENDIARY_NEEDLES']));
}

/** A component whose modes are the heat-or-damage declaration. */
export function hasFlamerModes(modes: readonly string[]): boolean {
    return modes.includes(FLAMER_DAMAGE_MODE) && modes.includes(FLAMER_HEAT_MODE);
}

export function flamerRequiresPower(equipment: Equipment | null | undefined): boolean {
    return isFlamerEquipment(equipment)
        && equipment instanceof WeaponEquipment
        && equipment.ammoType === 'NA';
}

/**
 * The heat-or-damage declaration as component modes: a flamer has them only where its rules ask for the declaration,
 * while Core flamers always deal both (Core p. 183); other flame-based weapons always declare.
 */
export function heatOrDamageComponentModes(
    equipment: Equipment | null | undefined,
    ruleset: CBTRuleset,
): { readonly modes: readonly string[]; readonly defaultMode: string } | null {
    const declares = isFlamerEquipment(equipment)
        ? gameRulesFor(ruleset).supportsFlamerModes
        : isHeatOrDamageWeapon(equipment);
    return declares ? Object.freeze({ modes: FLAMER_MODES, defaultMode: FLAMER_DAMAGE_MODE }) : null;
}

export function flamerDisplayLabel(baseLabel: string, equipment: Equipment, mode: string | undefined): string {
    return isHeatOrDamageWeapon(equipment) && mode === FLAMER_HEAT_MODE
        ? `${baseLabel} (${FLAMER_HEAT_MODE})`
        : baseLabel;
}

export function applyFlamerWeaponTypes(
    equipment: Equipment,
    mode: string | undefined,
    types: ReadonlySet<WeaponType>,
): ReadonlySet<WeaponType> {
    if (!isHeatOrDamageWeapon(equipment) || mode !== FLAMER_DAMAGE_MODE || !types.has('H')) return types;
    const effective = new Set(types);
    effective.delete('H');
    return effective;
}
