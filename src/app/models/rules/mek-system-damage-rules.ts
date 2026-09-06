// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { MekEntity } from '../entity/entities/mek/mek-entity';

export const MEK_ENGINE_DESTRUCTION_HITS = 3;

export function mekGyroDestructionHits(gyroType: string, ruleset: CBTRuleset): 0 | 2 | 3 | 4 {
    return gyroType === 'None' ? 0 : gyroType === 'Heavy Duty' ? ruleset === 'core-2026' ? 4 : 3 : 2;
}

export function mekSensorWeaponDisableHits(torsoMounted: boolean): 2 | 3 {
    return torsoMounted ? 3 : 2;
}

/** A generated sheet has room for every supported rule flavor; hits still belong to slots. */
export function mekSystemDamageDisplayCapacities(entity: MekEntity): Readonly<Record<string, number>> {
    return {
        engine: MEK_ENGINE_DESTRUCTION_HITS,
        gyro: mekGyroDestructionHits(entity.gyroType(), 'core-2026'),
        sensors: mekSensorWeaponDisableHits(entity.mountedCockpit().hasTorsoSlots),
        'life-support': 1,
        avionics: entity.chassisConfig === 'LAM' ? 3 : 0,
        'landing-gear': entity.chassisConfig === 'LAM' ? 1 : 0,
    };
}
