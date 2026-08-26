// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { BaseEntity } from '../base-entity';
import type { Equipment } from '../../equipment.model';
import { isRiscLaserPulseModule } from '../../risc-laser-mode.model';
import { isDirectFireFlags } from '../../weapon-traits-kernel';

const TARGETING_COMPUTER_FLAG = 'F_TARGETING_COMPUTER' as const;

export function isTargetingComputerEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment?.hasFlag(TARGETING_COMPUTER_FLAG) === true;
}

export function isDirectFireEquipment(equipment: Equipment | null | undefined): boolean {
    return equipment !== null && equipment !== undefined && isDirectFireFlags(equipment.flags);
}

export function isTargetingComputerRelevantWeapon(
    equipment: Equipment | null | undefined,
): boolean {
    return equipment?.type === 'weapon'
        && isDirectFireEquipment(equipment)
        && !equipment.hasWeaponTrait('taser');
}

export function targetingComputerVariableTonnage(
    equipment: Equipment | null | undefined,
    relevantWeight: () => number | undefined,
): number | null | undefined {
    if (!isTargetingComputerEquipment(equipment)) return null;
    const weight = relevantWeight();
    return weight === undefined
        ? undefined
        : Math.ceil(weight / (equipment!.techBase === 'Clan' ? 5 : 4));
}

export function targetingComputerVariableCost(
    equipment: Equipment | null | undefined,
    relevantWeight: () => number | undefined,
): number | null | undefined {
    if (!isTargetingComputerEquipment(equipment)) return null;
    const weight = relevantWeight();
    const divider = equipment!.techBase === 'IS' ? 4 : 5;
    return weight === undefined ? undefined : 10000 * Math.ceil(weight / divider);
}

export function targetingComputerCriticalSlots(
    equipment: Equipment | null | undefined,
    relevantWeight: () => number | undefined,
): number | null | undefined {
    return targetingComputerVariableTonnage(equipment, relevantWeight);
}

export function targetingComputerDamageMultiplier(
    targetingComputerInstalled: boolean,
    equipment: Equipment | null | undefined,
): 1 | 1.1 {
    return targetingComputerInstalled && isDirectFireEquipment(equipment) ? 1.1 : 1;
}

export function entityHasTargetingComputer(entity: BaseEntity): boolean {
    return entity.equipment().some(mount => isTargetingComputerEquipment(mount.equipment));
}

export function getTargetingComputerRelevantWeight(entity: BaseEntity): number | undefined {
    let weight = 0;

    for (const mount of entity.equipment()) {
        const equipment = mount.equipment;
        if (!equipment) continue;

        const relevantWeapon = isTargetingComputerRelevantWeapon(equipment);
        if (!relevantWeapon && !isRiscLaserPulseModule(equipment)) continue;

        const tonnage = mount.getTonnage(entity);
        if (tonnage === undefined) return undefined;
        weight += tonnage;
    }

    return weight;
}
