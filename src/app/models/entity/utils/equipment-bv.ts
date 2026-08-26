// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { BaseEntity } from '../base-entity';
import type { EntityMountedEquipment } from '../types/equipment';
import { isEcmEquipment } from '../../ecm-mode.model';
import { isBapEquipment } from '../../bap-equipment.model';
import { isOrdinaryTripleStrengthMyomerEquipment } from '../../myomer-equipment.model';
import { isRamPlateEquipment, isSpikesEquipment } from '../../physical-augmentation.model';
import { isMastMountEquipment } from '../../utility-equipment.model';
import { isC3MastMountBonusEquipment } from '../../c3-network.model';
import {
    isProtoMekMeleeEquipment,
    isProtoMekQuadMeleeSystemEquipment,
    physicalEquipmentBattleValue,
} from './physical-weapon';

const PPC_CAPACITOR_BV: Readonly<Record<string, number>> = {
    'Light PPC': 44,
    PPC: 88,
    'Heavy PPC': 53,
    ISSNPPC: 87,
    ISERPPC: 114,
    CLERPPC: 136,
};

/** Context-sensitive BV of a capacitor linked to an eligible PPC. */
export function getPpcCapacitorBV(linkedPpc: EntityMountedEquipment): number {
    return PPC_CAPACITOR_BV[linkedPpc.equipmentId] ?? 0;
}

export function getEquipmentBV(entity: BaseEntity, mount: EntityMountedEquipment): number {
    const equipment = mount.equipment;
    if (!equipment) return 0;

    // MiscType calculates ProtoMek melee BV by identity before consulting its
    // nominal database BV (which is zero for the Quad Melee System).
    if (isProtoMekMeleeEquipment(equipment)) {
        const base = Math.ceil(entity.tonnage() * 0.2);
        return base * (isProtoMekQuadMeleeSystemEquipment(equipment) ? 2.5 : 1.25);
    }

    if (equipment.hasFixedBV()) {
        const hasRotorMastMount = entity.equipment().some(candidate =>
            candidate.location === 'Rotor' && isMastMountEquipment(candidate.equipment));
        const receivesMastMountBonus = (entity.entityType === 'VTOL' || entity.entityType === 'SupportVTOL')
            && mount.location === 'Rotor'
            && hasRotorMastMount
            && (isEcmEquipment(equipment)
                || isBapEquipment(equipment)
                || isC3MastMountBonusEquipment(equipment));
        return equipment.bv + (receivesMastMountBonus ? 10 : 0);
    }

    const tonnage = entity.tonnage();
    const tsmMultiplier = entity.equipment().some(
        mount => isOrdinaryTripleStrengthMyomerEquipment(mount.equipment),
    ) ? 2 : 1;
    let bv: number;
    const physicalBV = physicalEquipmentBattleValue(equipment, tonnage, tsmMultiplier);
    if (physicalBV !== null) {
        bv = physicalBV;
    } else if (isRamPlateEquipment(equipment)) {
        const torsoSpikeLocations = new Set(
            entity.equipment()
                .filter(mount => isSpikesEquipment(mount.equipment))
                .map(mount => mount.location)
                .filter(location => location === 'CT' || location === 'LT' || location === 'RT'),
        ).size;
        const damage = Math.trunc(Math.trunc(tonnage * entity.maxRunMP() * 0.1) / 2)
            + torsoSpikeLocations;
        bv = damage * 1.1;
    } else {
        bv = 0;
    }

    return Math.round(bv * 1000) / 1000;
}
