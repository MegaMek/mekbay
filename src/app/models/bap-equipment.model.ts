// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export const BAP_FLAG = 'F_BAP' as const;

export interface BapEquipmentView {
    hasFlag(flag: string): boolean;
}

export function isBapEquipment(equipment: BapEquipmentView | null | undefined): boolean {
    return equipment?.hasFlag(BAP_FLAG) === true;
}

export function activeProbeAlphaStrikeAbility(
    battleArmor: boolean,
    tonnage: number | undefined,
): 'PRB' | 'LPRB' | 'RCN' {
    if (tonnage === undefined) return 'PRB';
    if (battleArmor) {
        if (tonnage === 0.045 || tonnage === 0.065) return 'RCN';
        if (tonnage === 0.15 || tonnage === 0.25) return 'LPRB';
    } else if (tonnage === 0.5) {
        return 'LPRB';
    }
    return 'PRB';
}
