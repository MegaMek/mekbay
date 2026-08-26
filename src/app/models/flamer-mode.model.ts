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

export function flamerRequiresPower(equipment: Equipment | null | undefined): boolean {
    return isFlamerEquipment(equipment)
        && equipment instanceof WeaponEquipment
        && equipment.ammoType === 'NA';
}

export function flamerComponentModes(
    equipment: Equipment | null | undefined,
    ruleset: CBTRuleset,
): { readonly modes: readonly string[]; readonly defaultMode: string } | null {
    return isFlamerEquipment(equipment) && gameRulesFor(ruleset).supportsFlamerModes
        ? Object.freeze({ modes: FLAMER_MODES, defaultMode: FLAMER_DAMAGE_MODE })
        : null;
}

export function flamerDisplayLabel(baseLabel: string, equipment: Equipment, mode: string | undefined): string {
    return isFlamerEquipment(equipment) && mode === FLAMER_HEAT_MODE
        ? `${baseLabel} (${FLAMER_HEAT_MODE})`
        : baseLabel;
}

export function applyFlamerWeaponTypes(
    equipment: Equipment,
    mode: string | undefined,
    types: ReadonlySet<WeaponType>,
): ReadonlySet<WeaponType> {
    if (!isFlamerEquipment(equipment) || mode !== FLAMER_DAMAGE_MODE || !types.has('H')) return types;
    const effective = new Set(types);
    effective.delete('H');
    return effective;
}
