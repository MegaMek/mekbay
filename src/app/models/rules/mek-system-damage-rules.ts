// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTRuleset } from '../cbt-ruleset.model';
import type { MekEntity } from '../entity/entities/mek/mek-entity';
import type { MekSystemType } from '../entity/types';
import { isShieldFlags } from '../entity/utils/physical-weapon-kernel';
import type { EquipmentFlag } from '../equipment-flags.type';

/** Three engine hits destroy a Mek; a superheavy's compact fusion engine fails at two (IO:AE p. 154). */
export function mekEngineDestructionHits(entity: MekEntity): 2 | 3 {
    return entity.isSuperHeavy() && entity.mountedEngine().type() === 'Compact' ? 2 : 3;
}

export function mekGyroDestructionHits(gyroType: string, ruleset: CBTRuleset): 0 | 2 | 3 | 4 {
    return gyroType === 'None' ? 0 : gyroType === 'Heavy Duty' ? ruleset === 'core-2026' ? 4 : 3 : 2;
}

export function mekSensorWeaponDisableHits(torsoMounted: boolean): 2 | 3 {
    return torsoMounted ? 3 : 2;
}

/** Number of component hits required to destroy mounted Mek equipment. */
export function mekCriticalDamageThreshold(
    rules: CBTRuleset,
    componentFlags: ReadonlySet<EquipmentFlag>,
): number {
    // Shield critical and actuator losses reduce DA/DC tracks; the shield
    // projection owns their operational threshold.
    if (isShieldFlags(componentFlags)) return Number.MAX_SAFE_INTEGER;
    return rules === 'core-2026' && componentFlags.has('F_AC') ? 2 : 1;
}

/** Component failure thresholds; individual critical-slot marks remain separate. */
export function mekSystemCriticalDamageThreshold(entity: MekEntity, system: MekSystemType, ruleset: CBTRuleset): number {
    switch (system) {
        case 'Engine': return mekEngineDestructionHits(entity);
        case 'Gyro': return mekGyroDestructionHits(entity.gyroType(), ruleset);
        case 'Sensors': return mekSensorWeaponDisableHits(entity.mountedCockpit().hasTorsoSlots);
        case 'Avionics': return 3;
        default: return 1;
    }
}

/** A generated sheet has room for every supported rule flavor; hits still belong to slots. */
export function mekSystemDamageDisplayCapacities(entity: MekEntity): Readonly<Record<string, number>> {
    const capacity = (system: MekSystemType) => mekSystemCriticalDamageThreshold(entity, system, 'core-2026');
    return {
        engine: capacity('Engine'),
        gyro: capacity('Gyro'),
        sensors: capacity('Sensors'),
        'life-support': capacity('Life Support'),
        avionics: entity.chassisConfig === 'LAM' ? capacity('Avionics') : 0,
        'landing-gear': entity.chassisConfig === 'LAM' ? capacity('Landing Gear') : 0,
    };
}
