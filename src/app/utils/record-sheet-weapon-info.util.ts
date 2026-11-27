// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentRegistry } from '../models/equipment-lookup';
import { WeaponEquipment } from '../models/equipment.model';
import type { WeaponType } from '../models/weapon-types.model';
import { resolveDefaultWeaponDamageText } from './inventory-control-damage.util';

const GENERIC_MML_TYPE_ORDER: readonly string[] = Object.freeze([
    'DB', 'PB', 'P', 'DE', 'V', 'C', 'F', 'S', 'H', 'AI', 'X', 'OS',
    'M', 'E', 'AE', 'A', 'B', 'N',
]);

/**
 * Converts the rules-rich equipment-table notation to MegaMekLab's record-sheet
 * notation.  The damage value remains authoritative; only the compact labels
 * and their historical order differ between the two presentations.
 */
export function formatRecordSheetWeaponDamageText(
    weapon: WeaponEquipment,
    semanticText: string,
    effectiveTypes: readonly WeaponType[] = weapon.getWeaponTypes(),
): string {
    const match = semanticText.trim().match(/^(.*?)(?:\s*\[([^\]]*)\])?$/u);
    if (!match) return semanticText;
    const damage = (match[1] ?? '').trim();
    const parsedLabels = (match[2] ?? '')
        .split(',')
        .map(label => label.trim())
        .filter(Boolean)
        .map(label => label.replace(/^C\d+$/u, 'C').replace(/^R\d+$/u, 'R'));
    const labels = new Set<string>(parsedLabels.length > 0 ? parsedLabels : effectiveTypes);

    let ordered: readonly string[];
    if (['AC_ULTRA', 'AC_ULTRA_THB', 'AC_ROTARY'].includes(weapon.ammoType)) {
        ordered = ['DB', 'R/C'];
    } else if (['AC_LBX', 'AC_LBX_THB', 'SBGAUSS'].includes(weapon.ammoType)) {
        ordered = ['DB', 'C/F/S'];
    } else if (labels.has('M') && labels.has('C')) {
        ordered = [
            'M', 'C',
            ...(labels.has('S') ? ['S'] : []),
            ...GENERIC_MML_TYPE_ORDER.filter(label => !['M', 'C', 'S'].includes(label) && labels.has(label)),
        ];
    } else if (weapon.hasFlag('F_ARTILLERY') && labels.has('AE') && !labels.has('DB')) {
        ordered = [
            'AE',
            ...(labels.has('S') ? ['S'] : []),
            ...(labels.has('F') ? ['F'] : []),
            ...GENERIC_MML_TYPE_ORDER.filter(label => !['AE', 'S', 'F', 'C', 'M'].includes(label) && labels.has(label)),
        ];
    } else if (labels.has('M') && labels.has('E')) {
        ordered = ['M', 'E', ...GENERIC_MML_TYPE_ORDER.filter(label => !['M', 'E'].includes(label) && labels.has(label))];
    } else {
        ordered = [
            ...GENERIC_MML_TYPE_ORDER.filter(label => labels.has(label)),
            ...parsedLabels.filter(label => !GENERIC_MML_TYPE_ORDER.includes(label)),
        ];
    }

    const unique = [...new Set(ordered)];
    return [damage, unique.length > 0 ? `[${unique.join(',')}]` : ''].filter(Boolean).join(' ');
}

export function defaultRecordSheetWeaponDamageText(
    weapon: WeaponEquipment,
    equipmentRegistry: EquipmentRegistry,
): string {
    return formatRecordSheetWeaponDamageText(
        weapon,
        resolveDefaultWeaponDamageText(weapon, equipmentRegistry),
    );
}
