// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import { isShieldFlags } from '../entity/utils/physical-weapon-kernel';
import type { EquipmentFlag } from '../equipment-flags.type';
import type { Equipment } from '../equipment.model';

/** Catalog facts available both on a mounted item and in the compiled status topology. */
export interface CriticalHitEquipment {
    readonly type: Equipment['type'] | undefined;
    readonly flags: ReadonlySet<EquipmentFlag>;
    readonly capital?: boolean;
}

/** Core pp. 92, 183. A standard-scale autocannon keeps working through its first critical hit. */
export function equipmentCriticalHitThreshold(
    ruleset: CBTRuleset, family: 'mek' | 'non-mek', equipment: CriticalHitEquipment | undefined,
): number {
    // Mek shields track damage absorption and capacity separately.
    if (family === 'mek' && equipment && isShieldFlags(equipment.flags)) return Number.MAX_SAFE_INTEGER;
    return ruleset === 'core-2026' && equipment?.type === 'weapon' && equipment.flags.has('F_AC') && !equipment.capital ? 2 : 1;
}

/** Total direct hits after resolving component armor, including the hit being evaluated. */
export function criticalHitsDestroyEquipment(
    ruleset: CBTRuleset, family: 'mek' | 'non-mek', equipment: CriticalHitEquipment | undefined, totalHits: number,
): boolean {
    return totalHits >= equipmentCriticalHitThreshold(ruleset, family, equipment);
}

/** Only non-slot mounts that survive one hit may carry a saved first-hit mark. */
export function canRecordAutocannonHit(equipment: Equipment | undefined, ruleset: CBTRuleset): boolean {
    return !criticalHitsDestroyEquipment(ruleset, 'non-mek', equipment, 1);
}
