// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { ECMMode } from '../models/common.model';
import type { MountedEquipment } from '../models/mounted-equipment.model';

export const ECM_MODE_STATE_KEY = 'ecm_mode';

export const NOVA_CEWS_STATE_KEY = ECM_MODE_STATE_KEY;
export const NOVA_CEWS_ON_STATE = ECMMode.ECM;
export const NOVA_CEWS_TURNING_OFF_STATE = 'nova-cews-turning-off';
export const NOVA_CEWS_OFF_STATE = ECMMode.OFF;
export const NOVA_CEWS_TURNING_ON_STATE = 'nova-cews-turning-on';

export type NovaCewsState =
    | typeof NOVA_CEWS_ON_STATE
    | typeof NOVA_CEWS_TURNING_OFF_STATE
    | typeof NOVA_CEWS_OFF_STATE
    | typeof NOVA_CEWS_TURNING_ON_STATE;

function defaultNovaCewsState(equipment: MountedEquipment): NovaCewsState {
    const firstNovaMount = equipment.owner.getInventory().find(candidate => (
        candidate.equipment?.flags.has('F_NOVA')
    ));
    return !firstNovaMount || firstNovaMount === equipment
        ? NOVA_CEWS_ON_STATE
        : NOVA_CEWS_OFF_STATE;
}

/** Missing and legacy non-Off ECM modes preserve the rules-default active state. */
export function novaCewsState(equipment: MountedEquipment | null | undefined): NovaCewsState {
    switch (equipment?.states.get(NOVA_CEWS_STATE_KEY)?.trim().toLowerCase()) {
        case NOVA_CEWS_TURNING_OFF_STATE: return NOVA_CEWS_TURNING_OFF_STATE;
        case ECMMode.OFF: return NOVA_CEWS_OFF_STATE;
        case NOVA_CEWS_TURNING_ON_STATE: return NOVA_CEWS_TURNING_ON_STATE;
        default:
            if (!equipment) return NOVA_CEWS_ON_STATE;
            return equipment.states.has(NOVA_CEWS_STATE_KEY)
                ? NOVA_CEWS_ON_STATE
                : defaultNovaCewsState(equipment);
    }
}

/** A pending End-Phase transition does not change the system's effects during the current turn. */
export function isNovaCewsEffectivelyActive(equipment: MountedEquipment | null | undefined): boolean {
    if (!equipment) return false;
    const state = novaCewsState(equipment);
    if (state !== NOVA_CEWS_ON_STATE && state !== NOVA_CEWS_TURNING_OFF_STATE) return false;

    // Even malformed/legacy state containing multiple ON mounts must obey the
    // rule that a unit can use only one Nova CEWS at a time.
    const firstActiveMount = equipment.owner.getInventory().find(candidate => {
        if (candidate.equipment?.flags.has('F_NOVA') !== true) return false;
        const candidateState = novaCewsState(candidate);
        return candidateState === NOVA_CEWS_ON_STATE
            || candidateState === NOVA_CEWS_TURNING_OFF_STATE;
    });
    return !firstActiveMount || firstActiveMount === equipment;
}

/** Resolves the mode currently supplying effects, including delayed Nova CEWS transitions. */
export function getEffectiveEcmMode(equipment: MountedEquipment): ECMMode | string {
    if (equipment.equipment?.flags.has('F_NOVA')) {
        return isNovaCewsEffectivelyActive(equipment) ? ECMMode.ECM : ECMMode.OFF;
    }
    return equipment.states.get(ECM_MODE_STATE_KEY) || ECMMode.ECM;
}

/** Mode state only; callers remain responsible for equipment and unit availability. */
export function isEcmModeActive(equipment: MountedEquipment): boolean {
    return getEffectiveEcmMode(equipment) !== ECMMode.OFF;
}
