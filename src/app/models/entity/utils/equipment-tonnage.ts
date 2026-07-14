import type { BaseEntity } from '../base-entity';
import type { EntityMountedEquipment } from '../types/equipment';
import { getTargetingComputerRelevantWeight } from './targeting-computer';

export function getEquipmentTonnage(
    entity: BaseEntity,
    mount: EntityMountedEquipment,
): number | undefined {
    const equipment = mount.equipment;
    if (!equipment) return undefined;
    if (equipment.tonnage !== 'variable') return equipment.tonnage;

    const tonnage = entity.tonnage();
    if (equipment.hasFlag('F_PARTIAL_WING') && equipment.hasFlag('F_MEK_EQUIPMENT')) {
        return standardRound(tonnage * (equipment.techBase === 'Clan' ? 0.05 : 0.07), entity);
    } else if (equipment.hasFlag('F_PARTIAL_WING') && equipment.hasFlag('F_PROTOMEK_EQUIPMENT')) {
        return nearestKg(tonnage / 5);
    } else if (equipment.hasFlag('F_CHAIN_DRAPE')) {
        return nextHalfTon(tonnage / 10);
    } else if (equipment.hasFlag('F_JET_BOOSTER')) {
        return undefined;
    } else if (equipment.hasFlag('S_SUPERCHARGER')) {
        if (isSupportVehicle(entity) || entity.motiveType() === 'Hover') return undefined;
        const usesTankEngine = entity.entityType === 'Tank'
            || entity.entityType === 'Naval'
            || entity.entityType === 'VTOL';
        return standardRound(entity.mountedEngine().getWeight({ tank: usesTankEngine }) / 10, entity);
    } else if (equipment.hasFlag('F_MASC')) {
        if (entity.entityType === 'ProtoMek') return nearestKg(tonnage * 0.025);
        if (entity.entityType === 'BattleArmor') return 0.25 / 3;
        return Math.max(Math.round(tonnage * (equipment.techBase === 'Clan' ? 0.04 : 0.05)), 1);
    } else if (equipment.hasFlag('F_TARGETING_COMPUTER')) {
        const relevantWeight = getTargetingComputerRelevantWeight(entity);
        return relevantWeight === undefined
            ? undefined
            : Math.ceil(relevantWeight / (equipment.techBase === 'Clan' ? 5 : 4));
    } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_HATCHET')) {
        return Math.ceil(tonnage / 15);
    } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_LANCE')) {
        return Math.ceil(tonnage / 20);
    } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_SWORD')) {
        return nextHalfTon(tonnage / 20);
    } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_MACE')) {
        return Math.ceil(tonnage / 10);
    } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_RETRACTABLE_BLADE')) {
        return 0.5 + nextHalfTon(tonnage / 20);
    } else if ((equipment.hasFlag('F_HAND_WEAPON') && equipment.hasFlag('S_CLAW'))
        || equipment.hasFlag('F_TALON')) {
        return Math.ceil(tonnage / 15);
    } else if (equipment.hasFlag('F_INDUSTRIAL_STRUCTURE') || equipment.hasFlag('F_REINFORCED')) {
        return standardRound(tonnage * 0.2, entity);
    } else if (equipment.hasAnyFlag(['F_ENDO_STEEL', 'F_ENDO_STEEL_PROTO', 'F_COMPOSITE'])) {
        return standardRound(tonnage * 0.05, entity);
    } else if (equipment.hasFlag('F_ENDO_COMPOSITE')) {
        return standardRound(tonnage * 0.075, entity);
    } else if (equipment.hasFlag('F_DUNE_BUGGY')) {
        return tonnage / 10;
    } else if (equipment.hasFlag('F_ENVIRONMENTAL_SEALING')) {
        return isSupportVehicle(entity) ? 0 : standardRound(tonnage / 10, entity);
    } else if (equipment.hasFlag('F_MECHANICAL_JUMP_BOOSTER')) {
        if (entity.weightClass() === 'Ultra Light' || entity.weightClass() === 'Light') return 0.05;
        if (entity.weightClass() === 'Medium') return 0.1;
        if (entity.weightClass() === 'Heavy') return 0.25;
        if (entity.weightClass() === 'Assault') return 0.5;
        return undefined;
    } else if (equipment.hasFlag('F_JUMP_BOOSTER')) {
        return standardRound(tonnage * (mount.size ?? 1) * 0.05, entity);
    } else if (equipment.hasFlag('F_TRACKS')) {
        return standardRound(tonnage * (equipment.hasFlag('S_QUADVEE_WHEELS') ? 0.15 : 0.1), entity);
    } else if (equipment.hasFlag('F_LIMITED_AMPHIBIOUS')) {
        return standardRound(tonnage / 25, entity);
    } else if (equipment.hasFlag('F_FULLY_AMPHIBIOUS') || equipment.hasFlag('F_BOOBY_TRAP')) {
        return standardRound(tonnage / 10, entity);
    } else if (equipment.hasFlag('F_DRONE_OPERATING_SYSTEM')) {
        return (tonnage / 10) + 0.5;
    } else if (equipment.hasFlag('F_DRONE_CARRIER_CONTROL')) {
        return 2 + ((mount.size ?? 1) * 0.5);
    } else if (equipment.hasFlag('F_MASH')) {
        return 2.5 + (mount.size ?? 1);
    } else if (equipment.hasAnyFlag(['F_CARGO', 'F_LIQUID_CARGO', 'F_COMMUNICATIONS'])) {
        return standardRound(mount.size ?? 1, entity);
    } else if (equipment.hasFlag('F_LADDER')) {
        return nearestKg((mount.size ?? 1) / 200);
    } else if (equipment.hasFlag('F_CARGO_LIFTER')) {
        return 0.03 * Math.ceil((mount.size ?? 1) * 2);
    } else if (equipment.hasFlag('F_BA_MISSION_EQUIPMENT')) {
        return nearestKg((mount.size ?? 1) / 1000);
    } else if (equipment.hasFlag('F_RAM_PLATE')) {
        return Math.ceil(tonnage / 10);
    }

    return undefined;
}

function nextHalfTon(tonnage: number): number {
    return Math.ceil(tonnage * 2) / 2;
}

function nextKg(tonnage: number): number {
    return Math.ceil(tonnage * 1000) / 1000;
}

function nearestKg(tonnage: number): number {
    return Math.round(tonnage * 1000) / 1000;
}

function standardRound(tonnage: number, entity: BaseEntity): number {
    return usesKilogramStandard(entity) ? nextKg(tonnage) : nextHalfTon(tonnage);
}

function usesKilogramStandard(entity: BaseEntity): boolean {
    return entity.entityType === 'ProtoMek'
        || entity.entityType === 'BattleArmor'
        || entity.weightClass() === 'Small Support';
}

function isSupportVehicle(entity: BaseEntity): boolean {
    return entity.entityType === 'SupportTank'
        || entity.entityType === 'SupportVTOL'
        || entity.entityType === 'LargeSupportTank'
        || entity.entityType === 'FixedWingSupport';
}