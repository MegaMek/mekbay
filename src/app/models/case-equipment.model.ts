// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Equipment } from './equipment.model';

const CASE_FLAG = 'F_CASE' as const;
const CASE_II_FLAG = 'F_CASE_II' as const;
const CASE_PROTOTYPE_FLAG = 'F_CASE_P' as const;

export type CaseEquipmentKind = 'case' | 'case-ii' | 'prototype';

/** A prototype CASE vent fails on 1–2 (IO:AE p. 65). */
export function prototypeCaseFails(roll: number | undefined): boolean {
    return roll !== undefined && roll <= 2;
}

export function isStandardCaseEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(CASE_FLAG) === true;
}

export function isCaseIIEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(CASE_II_FLAG) === true;
}

export function isPrototypeCaseEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(CASE_PROTOTYPE_FLAG) === true;
}

export function isStandardOrPrototypeCaseEquipment(
    equipment: Equipment | null | undefined,
): boolean {
    return isStandardCaseEquipment(equipment) || isPrototypeCaseEquipment(equipment);
}

export function caseEquipmentKind(equipment: Equipment | null | undefined): CaseEquipmentKind | null {
    if (isCaseIIEquipment(equipment)) return 'case-ii';
    if (isPrototypeCaseEquipment(equipment)) return 'prototype';
    if (isStandardCaseEquipment(equipment)) return 'case';
    return null;
}

export function isCaseEquipment(equipment: Equipment | null | undefined): boolean {
    return caseEquipmentKind(equipment) !== null;
}

/** The name a CASE kind prints as: prototype CASE keeps its own, CASE-P (IO:AE p. 65), as its venting can fail */
export function caseKindLabel(kind: CaseEquipmentKind): 'CASE' | 'CASE II' | 'CASE-P' {
    return kind === 'case-ii' ? 'CASE II' : kind === 'prototype' ? 'CASE-P' : 'CASE';
}

export function caseRecordSheetLabel(equipment: Equipment | null | undefined): string | null {
    const kind = caseEquipmentKind(equipment);
    return kind === null ? null : `[${caseKindLabel(kind)}]`;
}

export function caseAlphaStrikeAbility(
    equipment: Equipment | null | undefined,
): 'CASE' | 'CASEII' | 'CASEP' | null {
    const kind = caseEquipmentKind(equipment);
    if (kind === 'case-ii') return 'CASEII';
    if (kind === 'prototype') return 'CASEP';
    return kind === 'case' ? 'CASE' : null;
}
