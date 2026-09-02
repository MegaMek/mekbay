// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from './equipment.model';
import type { EquipmentFlag } from './equipment-flags.type';
import { hasAnyPrototypeVariant } from './equipment-variant.model';

export type TripleStrengthMyomerKind = 'standard' | 'prototype' | 'industrial';

export const TSM_FLAG = 'F_TSM' as const;
export const INDUSTRIAL_TSM_FLAG = 'F_INDUSTRIAL_TSM' as const;
export const ACTUATOR_ENHANCEMENT_SYSTEM_FLAG = 'F_ACTUATOR_ENHANCEMENT_SYSTEM' as const;

export function tripleStrengthMyomerKindFromFlags(
    flags: ReadonlySet<EquipmentFlag>,
): TripleStrengthMyomerKind | null | undefined {
    const ordinary = flags.has(TSM_FLAG);
    const industrial = flags.has(INDUSTRIAL_TSM_FLAG);
    if (!ordinary && !industrial) return undefined;
    if (ordinary && industrial) return null;
    if (industrial) return 'industrial';
    return hasAnyPrototypeVariant(flags) ? 'prototype' : 'standard';
}

export function tripleStrengthMyomerKind(
    equipment: Equipment | undefined,
): TripleStrengthMyomerKind | null | undefined {
    if (!equipment) return undefined;
    return tripleStrengthMyomerKindFromFlags(equipment.flags);
}

export function isActuatorEnhancementSystem(equipment: Equipment | undefined): boolean {
    return equipment?.hasFlag(ACTUATOR_ENHANCEMENT_SYSTEM_FLAG) === true;
}

export function isOrdinaryTripleStrengthMyomerEquipment(equipment: Equipment | undefined): boolean {
    const kind = tripleStrengthMyomerKind(equipment);
    return kind === 'standard' || kind === 'prototype';
}

export function isStandardTripleStrengthMyomerEquipment(equipment: Equipment | undefined): boolean {
    return tripleStrengthMyomerKind(equipment) === 'standard';
}

export function isActuatorEnhancementSystemFlags(flags: ReadonlySet<EquipmentFlag>): boolean {
    return flags.has(ACTUATOR_ENHANCEMENT_SYSTEM_FLAG);
}

export function tripleStrengthMyomerBvMultiplier(kind: TripleStrengthMyomerKind | null | undefined): number {
    return kind === 'standard' || kind === 'prototype' ? 1.5 : kind === 'industrial' ? 1.15 : 1;
}

export function tripleStrengthMyomerAlphaStrikeAbility(
    kind: TripleStrengthMyomerKind | null | undefined,
): 'TSM' | 'I-TSM' | null {
    return kind === 'standard' || kind === 'prototype' ? 'TSM' : kind === 'industrial' ? 'I-TSM' : null;
}
