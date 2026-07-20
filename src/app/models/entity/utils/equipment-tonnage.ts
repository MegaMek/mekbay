import type { BaseEntity } from '../base-entity';
import type { EntityMountedEquipment } from '../types/equipment';
import { getEquipmentEngineWeight } from './equipment-engine-weight';
import { isMekEntity } from './entity-type-guards';
import { getFireControlWeaponWeight } from './fire-control';
import { getCasparIITonnage, getCasparTonnage, getSrcsTonnage } from './large-craft-control-tonnage';
import { getTargetingComputerRelevantWeight } from './targeting-computer';
import { getMekTurretEquipmentWeight, getPintleTurretTonnage, getSponsonTurretTonnage } from './turret-tonnage';

export function getEquipmentTonnage(
    entity: BaseEntity,
    mount: EntityMountedEquipment,
): number | undefined {
    const equipment = mount.equipment;
    if (!equipment) return undefined;
    if (equipment.tonnage !== 'variable') return equipment.tonnage;

    const tonnage = entity.tonnage();
    if (equipment.hasFlag('F_JUMP_JET') || equipment.hasFlag('F_UMU')) {
        let unitTonnage = tonnage;
        if (isMekEntity(entity) && entity.hasHybridStructure()) {
            unitTonnage = Math.min(
                entity.structureAt(mount.location).tonnage,
                entity.tonnage(), // is CT location
            );
        }
        let multiplier = equipment.hasFlag('S_IMPROVED') ? 2 : 1;
        if (equipment.hasFlag('S_PROTOTYPE') && equipment.hasFlag('S_IMPROVED')) multiplier = 1;
        if (equipment.hasFlag('F_PROTOMEK_EQUIPMENT')) {
            if (unitTonnage < 6) return 0.05 * multiplier;
            if (unitTonnage < 10) return 0.1 * multiplier;
            return 0.15 * multiplier;
        }
        if (unitTonnage <= 55) return 0.5 * multiplier;
        if (unitTonnage <= 85) return multiplier;
        return 2 * multiplier;
    } else if (equipment.hasFlag('F_PARTIAL_WING') && equipment.hasFlag('F_MEK_EQUIPMENT')) {
        return standardRound(tonnage * (equipment.techBase === 'Clan' ? 0.05 : 0.07), entity);
    } else if (equipment.hasFlag('F_PARTIAL_WING') && equipment.hasFlag('F_PROTOMEK_EQUIPMENT')) {
        return nearestKg(tonnage / 5);
    } else if (equipment.hasFlag('F_CHAIN_DRAPE')) {
        return nextHalfTon(tonnage / 10);
    } else if (equipment.hasFlag('F_JET_BOOSTER')) {
        return standardRound(getEquipmentEngineWeight(entity) / 10, entity);
    } else if (equipment.hasFlag('S_SUPERCHARGER')) {
        return standardRound(getEquipmentEngineWeight(entity) / 10, entity);
    } else if (equipment.hasFlag('F_MASC')) {
        if (entity.entityType === 'ProtoMek') return nearestKg(tonnage * 0.025);
        if (entity.entityType === 'BattleArmor') return 0.25 / 3;
        return Math.max(Math.round(tonnage * (equipment.techBase === 'Clan' ? 0.04 : 0.05)), 1);
    } else if (equipment.hasFlag('F_TARGETING_COMPUTER')) {
        const relevantWeight = getTargetingComputerRelevantWeight(entity);
        return relevantWeight === undefined
            ? undefined
            : Math.ceil(relevantWeight / (equipment.techBase === 'Clan' ? 5 : 4));
    } else if (equipment.hasAnyFlag(['F_QUAD_TURRET', 'F_SHOULDER_TURRET', 'F_HEAD_TURRET'])) {
        const equipmentWeight = getMekTurretEquipmentWeight(entity, mount);
        return equipmentWeight === undefined ? undefined : standardRound(equipmentWeight / 10, entity);
    } else if (equipment.hasFlag('F_SPONSON_TURRET')) {
        return getSponsonTurretTonnage(entity, value => standardRound(value, entity));
    } else if (equipment.hasFlag('F_PINTLE_TURRET')) {
        return getPintleTurretTonnage(entity, mount, value => standardRound(value, entity));
    } else if (equipment.hasFlag('F_ARMORED_MOTIVE_SYSTEM')) {
        return standardRound(tonnage * (equipment.techBase === 'Clan' ? 0.1 : 0.15), entity);
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
    } else if (equipment.hasFlag('F_ACTUATOR_ENHANCEMENT_SYSTEM')) {
        return standardRound(tonnage / (isMekEntity(entity) && entity.chassisConfig === 'Quad' ? 50 : 35), entity);
    } else if (equipment.hasFlag('F_INDUSTRIAL_STRUCTURE') || equipment.hasFlag('F_REINFORCED')) {
        return standardRound(tonnage * 0.2, entity);
    } else if (equipment.hasAnyFlag(['F_ENDO_STEEL', 'F_ENDO_STEEL_PROTO', 'F_COMPOSITE'])) {
        return standardRound(tonnage * 0.05, entity);
    } else if (equipment.hasFlag('F_ENDO_COMPOSITE')) {
        return standardRound(tonnage * 0.075, entity);
    } else if (equipment.hasFlag('F_DUNE_BUGGY')) {
        return tonnage / 10;
    } else if (equipment.hasFlag('F_ENVIRONMENTAL_SEALING')) {
        return entity.isSupportVehicle() ? 0 : standardRound(tonnage / 10, entity);
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
    } else if (equipment.hasFlag('F_BASIC_FIRE_CONTROL') || equipment.hasFlag('F_ADVANCED_FIRE_CONTROL')) {
        const baseChassisWeight = entity.baseChassisFireConWeight();
        if (baseChassisWeight > 0) return baseChassisWeight;
        const weaponWeight = getFireControlWeaponWeight(entity);
        return weaponWeight === undefined
            ? undefined
            : standardRound(weaponWeight / (equipment.hasFlag('F_BASIC_FIRE_CONTROL') ? 20 : 10), entity);
    } else if (equipment.hasFlag('F_DRONE_OPERATING_SYSTEM')) {
        return (tonnage / 10) + 0.5;
    } else if (equipment.hasFlag('F_NAVAL_TUG_ADAPTOR')) {
        return 100 + (tonnage * 0.1);
    } else if (equipment.hasFlag('F_LIGHT_SAIL')) {
        return tonnage / 10;
    } else if (equipment.hasFlag('F_LF_STORAGE_BATTERY')) {
        return tonnage / 100;
    } else if (equipment.hasFlag('F_NAVAL_C3')) {
        return tonnage * 0.01;
    } else if (equipment.hasFlag('F_SRCS') || equipment.hasFlag('F_SASRCS')) {
        return getSrcsTonnage(entity, mount);
    } else if (equipment.hasFlag('F_CASPAR')) {
        return getCasparTonnage(entity, equipment.hasFlag('S_IMPROVED'));
    } else if (equipment.hasFlag('F_CASPAR_II')) {
        return getCasparIITonnage(entity, equipment.hasFlag('S_IMPROVED'));
    } else if (equipment.hasFlag('F_ATAC')) {
        return Math.min(standardRound(tonnage * 0.02, entity), 50000) + ((mount.size ?? 1) * 150);
    } else if (equipment.hasFlag('F_DTAC')) {
        return standardRound(tonnage * 0.03, entity) + ((mount.size ?? 1) * 150);
    } else if (equipment.hasFlag('F_SDS_DESTRUCT')) {
        return Math.min(Math.ceil(tonnage * 0.1), 10000);
    } else if (equipment.hasFlag('F_MAGNETIC_CLAMP') && equipment.hasFlag('F_PROTOMEK_EQUIPMENT')) {
        if (tonnage < 6) return 0.25;
        if (tonnage < 10) return 0.5;
        return 1;
    } else if (equipment.hasFlag('F_FUEL')) {
        const usesTankEngine = entity.entityType === 'Tank'
            || entity.entityType === 'Naval'
            || entity.entityType === 'VTOL';
        return standardRound(entity.mountedEngine().getWeight({ tank: usesTankEngine }) * 0.1, entity);
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
    } else if (equipment.hasFlag('F_POWER_GENERATOR') || equipment.hasFlag('F_DUMPER')) {
        return 1;
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

