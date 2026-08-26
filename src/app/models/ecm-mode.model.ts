// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { ECMMode } from './common.model';

export const ECM_FLAG = 'F_ECM' as const;
export const ANGEL_ECM_FLAG = 'F_ANGEL_ECM' as const;
export const SINGLE_HEX_ECM_FLAG = 'F_SINGLE_HEX_ECM' as const;

export interface EcmEquipmentView {
    hasFlag(flag: string): boolean;
}

/** Canonical runtime modes for ordinary ECM equipment. */
export const ECM_MODES: readonly ECMMode[] = Object.freeze([
    ECMMode.ECM,
    ECMMode.ECCM,
    ECMMode.GHOST,
    ECMMode.OFF,
]);

/** Additional simultaneous modes supported only by Angel ECM equipment. */
export const ANGEL_ECM_MODES: readonly ECMMode[] = Object.freeze([
    ECMMode.ECM,
    ECMMode.ECCM,
    ECMMode.GHOST,
    ECMMode.ECM_ECCM,
    ECMMode.ECM_GHOST,
    ECMMode.ECCM_GHOST,
    ECMMode.OFF,
]);

export function ecmModes(angel: boolean): readonly ECMMode[] {
    return angel ? ANGEL_ECM_MODES : ECM_MODES;
}

export function isEcmEquipment(equipment: EcmEquipmentView | null | undefined): boolean {
    return equipment?.hasFlag(ECM_FLAG) === true;
}

export function isAngelEcmEquipment(equipment: EcmEquipmentView | null | undefined): boolean {
    return isEcmEquipment(equipment) && equipment!.hasFlag(ANGEL_ECM_FLAG);
}

export function isSingleHexEcmEquipment(equipment: EcmEquipmentView | null | undefined): boolean {
    return isEcmEquipment(equipment) && equipment!.hasFlag(SINGLE_HEX_ECM_FLAG);
}

export function ecmEquipmentModes(
    equipment: EcmEquipmentView | null | undefined,
): Readonly<{ readonly modes: readonly ECMMode[]; readonly defaultMode: ECMMode }> | null {
    return isEcmEquipment(equipment)
        ? Object.freeze({
            modes: ecmModes(isAngelEcmEquipment(equipment)),
            defaultMode: ECMMode.ECM,
        })
        : null;
}

export function ecmDefensiveSystemValue(
    equipment: EcmEquipmentView | null | undefined,
): 0 | 1 | 2 {
    return !isEcmEquipment(equipment) ? 0 : isAngelEcmEquipment(equipment) ? 2 : 1;
}

export function ecmAlphaStrikeAbility(
    equipment: EcmEquipmentView | null | undefined,
): 'AECM' | 'ECM' | 'LECM' | null {
    if (!isEcmEquipment(equipment)) return null;
    if (isAngelEcmEquipment(equipment)) return 'AECM';
    return isSingleHexEcmEquipment(equipment) ? 'LECM' : 'ECM';
}

export function isECMMode(value: unknown): value is ECMMode {
    return typeof value === 'string' && ANGEL_ECM_MODES.includes(value as ECMMode);
}

export function ecmModeLabel(mode: ECMMode): string {
    switch (mode) {
        case ECMMode.ECM: return 'ECM';
        case ECMMode.ECCM: return 'ECCM';
        case ECMMode.GHOST: return 'Ghost';
        case ECMMode.ECM_ECCM: return 'ECM+ECCM';
        case ECMMode.ECM_GHOST: return 'ECM+Ghost';
        case ECMMode.ECCM_GHOST: return 'ECCM+Ghost';
        case ECMMode.OFF: return 'Off';
    }
}
