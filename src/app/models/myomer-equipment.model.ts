// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from './equipment.model';
import type { EquipmentFlag } from './equipment-flags.type';
import { hasAnyPrototypeVariant } from './equipment-variant.model';

export type TripleStrengthMyomerKind = 'standard' | 'prototype' | 'industrial';

/** MegaMek's MTF myomer names (Mek.getMtf); the header follows the installed myomer system. */
export const MEK_MYOMER_TYPES = [
    'Standard', 'Triple-Strength', 'Prototype Triple-Strength', 'Industrial Triple-Strength', 'Super-Cooled',
] as const;
export type MekMyomerType = typeof MEK_MYOMER_TYPES[number];

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

/** The MTF myomer name an installed system gives its Mek, or null for any other equipment. */
export function mekMyomerTypeOf(equipment: Equipment | undefined): MekMyomerType | null {
    if (!equipment) return null;
    if (equipment.hasFlag('F_SCM')) return 'Super-Cooled';
    switch (tripleStrengthMyomerKindFromFlags(equipment.flags)) {
        case 'standard': return 'Triple-Strength';
        case 'prototype': return 'Prototype Triple-Strength';
        case 'industrial': return 'Industrial Triple-Strength';
        default: return null;
    }
}
