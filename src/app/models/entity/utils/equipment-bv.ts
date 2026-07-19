import type { BaseEntity } from '../base-entity';
import type { EntityMountedEquipment } from '../types/equipment';

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
    if (equipment.hasFlag('F_PROTOMEK_MELEE')) {
        const base = Math.ceil(entity.tonnage() * 0.2);
        return base * (equipment.hasFlag('S_PROTO_QMS') ? 2.5 : 1.25);
    }

    if (equipment.bv !== 'variable') {
        const hasRotorMastMount = entity.equipment().some(candidate =>
            candidate.location === 'Rotor' && candidate.equipment?.hasFlag('F_MAST_MOUNT'));
        const receivesMastMountBonus = (entity.entityType === 'VTOL' || entity.entityType === 'SupportVTOL')
            && mount.location === 'Rotor'
            && hasRotorMastMount
            && equipment.hasAnyFlag(['F_ECM', 'F_BAP', 'F_C3S', 'F_C3SBS', 'F_C3I']);
        return equipment.bv + (receivesMastMountBonus ? 10 : 0);
    }

    const tonnage = entity.tonnage();
    const tsmMultiplier = entity.equipment().some(mount => mount.equipment?.hasFlag('F_TSM')) ? 2 : 1;
    let bv: number;
    if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_HATCHET')) {
        bv = Math.ceil(tonnage / 5) * 1.5 * tsmMultiplier;
    } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_SWORD')) {
        bv = Math.ceil((tonnage / 10) + 1) * 1.725 * tsmMultiplier;
    } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_LANCE')) {
        bv = Math.ceil(tonnage / 5) * tsmMultiplier;
    } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_MACE')) {
        bv = Math.ceil(tonnage / 4) * tsmMultiplier;
    } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_RETRACTABLE_BLADE')) {
        bv = Math.ceil(tonnage / 10) * 1.725 * tsmMultiplier;
    } else if (equipment.hasFlag('F_HAND_WEAPON') && equipment.hasFlag('S_CLAW')) {
        bv = Math.ceil(tonnage / 7) * 1.275 * tsmMultiplier;
    } else if (equipment.hasFlag('F_TALON')) {
        bv = Math.round(Math.floor(tonnage / 5) * 0.5) * tsmMultiplier;
    } else if (equipment.hasFlag('F_RAM_PLATE')) {
        const torsoSpikeLocations = new Set(
            entity.equipment()
                .filter(mount => mount.equipment?.hasFlag('F_SPIKES'))
                .map(mount => mount.location)
                .filter(location => location === 'CT' || location === 'LT' || location === 'RT'),
        ).size;
        const damage = Math.trunc(Math.trunc(tonnage * entity.runMP() * 0.1) / 2)
            + torsoSpikeLocations;
        bv = damage * 1.1;
    } else {
        bv = 0;
    }

    return Math.round(bv * 1000) / 1000;
}