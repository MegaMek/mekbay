// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { BaseEntity } from '../base-entity';
import type { EntityMountedEquipment } from '../types/equipment';
import { AmmoEquipment, WeaponEquipment } from '../../equipment.model';
import { getEquipmentEngineWeight } from './equipment-engine-weight';
import { isMekEntity } from './entity-type-guards';
import {
    fireControlVariableTonnage,
    getFireControlWeaponWeight,
} from './fire-control';
import {
    getTargetingComputerRelevantWeight,
    targetingComputerVariableTonnage,
} from './targeting-computer';
import {
    isJetBoosterEquipment,
    isMascEquipment,
    isSuperchargerEquipment,
} from '../../escalating-equipment.model';
import {
    isJumpJetEquipment,
    jumpBoosterVariableTonnage,
    isPartialWingEquipment,
    isUmuEquipment,
    jumpPropulsionTonnageMultiplier,
} from '../../jump-equipment.model';
import { isActuatorEnhancementSystem } from '../../myomer-equipment.model';
import { isDroneOperatingSystemEquipment } from '../../drone-operating-system.model';
import { isRamPlateEquipment } from '../../physical-augmentation.model';
import { structureConstructionTonnageFraction } from '../../construction-equipment.model';
import { physicalEquipmentVariableTonnage } from './physical-weapon';
import { chassisEquipmentVariableTonnage } from '../../chassis-equipment.model';
import { largeCraftEquipmentVariableTonnage } from '../../large-craft-equipment.model';
import { supportEquipmentVariableTonnage } from '../../support-equipment.model';
import { turretEquipmentVariableTonnage } from '../../turret-equipment.model';
import { isEquipmentForPlatform } from '../../equipment-platform.model';
import { boobyTrapVariableTonnage } from '../../aerospace-support-equipment.model';

export function getEquipmentTonnage(
    entity: BaseEntity,
    mount: EntityMountedEquipment,
): number | undefined {
    const equipment = mount.equipment;
    if (!equipment) return undefined;
    if (entity.entityType === 'HandheldWeapon' && equipment instanceof AmmoEquipment) {
        const mountedShots = mount.getAmmoShots() ?? 0;
        const capacity = mountedShots > 0 ? mountedShots : equipment.shots;
        return equipment.kgPerShot * capacity / 1000;
    }
    if (entity.entityType === 'ProtoMek' && equipment instanceof WeaponEquipment) {
        if (equipment.hasWeaponTrait('srm')) {
            return equipment.rackSize * (equipment.ammoType === 'SRM_STREAK' ? 0.5 : 0.25);
        }
        if (equipment.hasWeaponTrait('lrm')) {
            return equipment.rackSize * (equipment.ammoType === 'LRM_STREAK' ? 0.4 : 0.2);
        }
    }
    if (equipment.hasFixedTonnage()) return equipment.tonnage;

    const tonnage = entity.tonnage();
    const structureTonnageFraction = structureConstructionTonnageFraction(equipment);
    const physicalTonnage = physicalEquipmentVariableTonnage(equipment, tonnage);
    const chassisTonnage = chassisEquipmentVariableTonnage(equipment, {
        entityTonnage: tonnage,
        entityIsSupportVehicle: entity.isSupportVehicle(),
        standardRound: value => standardRound(value, entity),
    });
    const jumpBoosterTonnage = jumpBoosterVariableTonnage(equipment, {
        entityTonnage: tonnage,
        entityWeightClass: entity.weightClass(),
        mountSize: mount.size ?? 1,
        standardRound: value => standardRound(value, entity),
    });
    const targetingComputerTonnage = targetingComputerVariableTonnage(
        equipment,
        () => getTargetingComputerRelevantWeight(entity),
    );
    const fireControlTonnage = fireControlVariableTonnage(equipment, {
        baseChassisWeight: entity.baseChassisFireConWeight(),
        weaponWeight: () => getFireControlWeaponWeight(entity),
        standardRound: value => standardRound(value, entity),
    });
    const largeCraftTonnage = largeCraftEquipmentVariableTonnage(entity, mount);
    const supportTonnage = supportEquipmentVariableTonnage(
        entity,
        mount,
        value => standardRound(value, entity),
    );
    const turretTonnage = turretEquipmentVariableTonnage(
        entity,
        mount,
        value => standardRound(value, entity),
    );
    const boobyTrapTonnage = boobyTrapVariableTonnage(
        equipment,
        tonnage,
        value => standardRound(value, entity),
    );
    if (isJumpJetEquipment(equipment) || isUmuEquipment(equipment)) {
        let unitTonnage = tonnage;
        if (isMekEntity(entity) && entity.hasHybridStructure()) {
            unitTonnage = Math.min(
                entity.structureAt(mount.location).tonnage,
                entity.tonnage(), // is CT location
            );
        }
        const multiplier = jumpPropulsionTonnageMultiplier(equipment) ?? 1;
        if (isEquipmentForPlatform(equipment, 'protomek')) {
            if (unitTonnage < 6) return 0.05 * multiplier;
            if (unitTonnage < 10) return 0.1 * multiplier;
            return 0.15 * multiplier;
        }
        if (unitTonnage <= 55) return 0.5 * multiplier;
        if (unitTonnage <= 85) return multiplier;
        return 2 * multiplier;
    } else if (isPartialWingEquipment(equipment) && isEquipmentForPlatform(equipment, 'mek')) {
        return standardRound(tonnage * (equipment.techBase === 'Clan' ? 0.05 : 0.07), entity);
    } else if (isPartialWingEquipment(equipment) && isEquipmentForPlatform(equipment, 'protomek')) {
        return nearestKg(tonnage / 5);
    } else if (chassisTonnage !== null) {
        return chassisTonnage;
    } else if (isJetBoosterEquipment(equipment)) {
        return standardRound(getEquipmentEngineWeight(entity) / 10, entity);
    } else if (isSuperchargerEquipment(equipment)) {
        return standardRound(getEquipmentEngineWeight(entity) / 10, entity);
    } else if (isMascEquipment(equipment)) {
        if (entity.entityType === 'ProtoMek') return nearestKg(tonnage * 0.025);
        if (entity.entityType === 'BattleArmor') return 0.25 / 3;
        return Math.max(Math.round(tonnage * (equipment.techBase === 'Clan' ? 0.04 : 0.05)), 1);
    } else if (targetingComputerTonnage !== null) {
        return targetingComputerTonnage;
    } else if (turretTonnage !== null) {
        return turretTonnage;
    } else if (physicalTonnage !== null) {
        return physicalTonnage;
    } else if (isActuatorEnhancementSystem(equipment)) {
        return standardRound(tonnage / (isMekEntity(entity) && entity.chassisConfig === 'Quad' ? 50 : 35), entity);
    } else if (structureTonnageFraction !== null) {
        return standardRound(tonnage * structureTonnageFraction, entity);
    } else if (jumpBoosterTonnage !== null) {
        return jumpBoosterTonnage;
    } else if (boobyTrapTonnage !== null) {
        return boobyTrapTonnage;
    } else if (fireControlTonnage !== null) {
        return fireControlTonnage;
    } else if (isDroneOperatingSystemEquipment(equipment)) {
        return (tonnage / 10) + 0.5;
    } else if (largeCraftTonnage !== null) {
        return largeCraftTonnage;
    } else if (supportTonnage !== null) {
        return supportTonnage;
    } else if (isRamPlateEquipment(equipment)) {
        return Math.ceil(tonnage / 10);
    }

    return undefined;
}

function nextHalfTon(tonnage: number): number {
    return Math.ceil(Math.round(tonnage * 1000) / 500) / 2;
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

