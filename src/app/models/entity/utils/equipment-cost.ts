import type { BaseEntity } from '../base-entity';
import type { EntityMountedEquipment } from '../types/equipment';
import { getTargetingComputerRelevantWeight } from './targeting-computer';

export function getEquipmentCost(
    entity: BaseEntity,
    mount: EntityMountedEquipment,
): number | undefined {
    const equipment = mount.equipment;
    if (!equipment) return undefined;
    if (equipment.cost !== 'variable') return equipment.cost;

    const tonnage = entity.tonnage();
    let cost: number | undefined;
    if (equipment.hasFlag('F_CARGO_LIFTER')) {
        return 250 * Math.ceil((mount.size ?? 1) * 2);
    } else if (equipment.hasFlag('F_DRONE_CARRIER_CONTROL') || equipment.hasFlag('F_MASH')) {
        const equipmentTonnage = mount.getTonnage(entity);
        cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 10000;
    } else if (equipment.hasFlag('F_MASC') && equipment.hasFlag('F_BA_EQUIPMENT')) {
        cost = entity.runMP() * 75000;
    } else if (equipment.hasFlag('F_JET_BOOSTER')) {
        cost = undefined;
    } else if (equipment.hasFlag('S_SUPERCHARGER')) {
        const supportVehicle = entity.entityType === 'SupportTank'
            || entity.entityType === 'SupportVTOL'
            || entity.entityType === 'LargeSupportTank'
            || entity.entityType === 'FixedWingSupport';
        cost = supportVehicle ? undefined : entity.mountedEngine().rating * 10000;
    } else if (equipment.hasFlag('F_MASC') && entity.entityType === 'ProtoMek') {
        cost = Math.round(entity.mountedEngine().rating * 1000 * tonnage * 0.025);
    } else if (equipment.hasFlag('F_MASC')) {
        const mascTonnage = Math.round(tonnage / (equipment.techBase === 'Clan' ? 25 : 20));
        cost = entity.mountedEngine().rating * mascTonnage * 1000;
    } else if (equipment.hasFlag('F_TARGETING_COMPUTER')) {
        const relevantWeight = getTargetingComputerRelevantWeight(entity);
        const divider = equipment.techBase === 'IS' ? 4 : 5;
        cost = relevantWeight === undefined ? undefined : 10000 * Math.ceil(relevantWeight / divider);
    } else if (equipment.hasFlag('F_ENVIRONMENTAL_SEALING')) {
        cost = entity.entityType === 'Mek' ? 225 * tonnage : 0;
    } else if (equipment.hasFlag('F_LIMITED_AMPHIBIOUS') || equipment.hasFlag('F_FULLY_AMPHIBIOUS')) {
        const equipmentTonnage = mount.getTonnage(entity);
        cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 10000;
    } else if (equipment.hasFlag('F_DUNE_BUGGY')) {
        const equipmentTonnage = mount.getTonnage(entity);
        cost = equipmentTonnage === undefined ? undefined : 10 * equipmentTonnage * equipmentTonnage;
    } else if (equipment.hasFlag('F_DRONE_OPERATING_SYSTEM')) {
        const equipmentTonnage = mount.getTonnage(entity);
        cost = equipmentTonnage === undefined ? undefined : (equipmentTonnage * 10000) + 5000;
    } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_HATCHET')) {
        cost = Math.ceil(tonnage / 15) * 5000;
    } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_SWORD')) {
        cost = nextHalfTon(tonnage / 20) * 10000;
    } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_RETRACTABLE_BLADE')) {
        cost = (1 + Math.ceil(tonnage / 20)) * 10000;
    } else if (equipment.hasFlag('F_TRACKS')) {
        const multiplier = equipment.hasFlag('S_QUADVEE_WHEELS') ? 750 : 500;
        cost = Math.ceil((multiplier * entity.mountedEngine().rating * tonnage) / 75);
    } else if (equipment.hasFlag('F_TALON')) {
        const equipmentTonnage = mount.getTonnage(entity);
        cost = equipmentTonnage === undefined ? undefined : Math.ceil(equipmentTonnage * 300);
    } else if (equipment.hasFlag('F_SPIKES')) {
        cost = Math.ceil(tonnage * 50);
    } else if (equipment.hasFlag('F_PARTIAL_WING')) {
        const equipmentTonnage = mount.getTonnage(entity);
        cost = equipmentTonnage === undefined ? undefined : Math.ceil(equipmentTonnage * 50000);
    } else if (equipment.hasFlag('F_HAND_WEAPON') && equipment.hasFlag('S_CLAW')) {
        cost = Math.ceil(tonnage * 200);
    } else if (equipment.hasFlag('F_CLUB') && equipment.hasFlag('S_LANCE')) {
        cost = Math.ceil(tonnage * 150);
    } else if (equipment.hasFlag('F_MECHANICAL_JUMP_BOOSTER')) {
        if (entity.weightClass() === 'Assault') cost = 300000;
        else if (entity.weightClass() === 'Heavy') cost = 150000;
        else if (entity.weightClass() === 'Medium') cost = 75000;
        else cost = 50000;
    } else if (equipment.hasFlag('F_LADDER')) {
        cost = (mount.size ?? 1) * 5;
    } else if (equipment.hasFlag('F_COMMUNICATIONS')) {
        cost = (mount.size ?? 1) * 10000;
    } else if (equipment.hasFlag('F_RAM_PLATE')) {
        const equipmentTonnage = mount.getTonnage(entity);
        cost = equipmentTonnage === undefined ? undefined : equipmentTonnage * 10000;
    }

    if (cost === undefined || !mount.armored) return cost;
    const criticalSlots = equipment.getNumCriticalSlots(entity, mount.size ?? 1);
    return criticalSlots === undefined ? undefined : cost + (150000 * criticalSlots);
}

function nextHalfTon(tonnage: number): number {
    return Math.ceil(tonnage * 2) / 2;
}