import { MiscEquipment } from '../../equipment.model';
import type { BaseEntity } from '../base-entity';
import type { EntityMountedEquipment } from '../types/equipment';
import { isVehicleEntity } from './entity-type-guards';

export function getMekTurretEquipmentWeight(
    entity: BaseEntity,
    turret: EntityMountedEquipment,
): number | undefined {
    const location = turret.equipment?.hasFlag('F_HEAD_TURRET') ? 'HD' : turret.location;
    return sumEquipmentTonnage(entity, mount => mount.location === location && mount.turretMounted);
}

export function getSponsonTurretTonnage(
    entity: BaseEntity,
    round: (tonnage: number) => number,
): number | undefined {
    const turretCount = countEquipmentWithFlag(entity, 'F_SPONSON_TURRET');
    if (turretCount === 0) return undefined;
    const baseChassisWeight = isVehicleEntity(entity)
        ? entity.baseChassisSponsonPintleWeight()
        : -1;
    if (entity.omni() && baseChassisWeight >= 0) {
        return baseChassisWeight / turretCount;
    }

    const equipmentWeight = sumEquipmentTonnage(entity, mount => mount.turretType === 'sponson');
    return equipmentWeight === undefined ? undefined : round(equipmentWeight / 10) / turretCount;
}

export function getPintleTurretTonnage(
    entity: BaseEntity,
    turret: EntityMountedEquipment,
    round: (tonnage: number) => number,
): number | undefined {
    const turretCount = countEquipmentWithFlag(entity, 'F_PINTLE_TURRET');
    if (turretCount === 0) return undefined;
    const baseChassisWeight = isVehicleEntity(entity)
        ? entity.baseChassisSponsonPintleWeight()
        : -1;
    if (baseChassisWeight >= 0) {
        return baseChassisWeight / turretCount;
    }

    const weaponWeight = sumEquipmentTonnage(entity, mount =>
        mount.equipment?.type === 'weapon'
        && mount.location === turret.location
        && mount.turretType === 'pintle');
    return weaponWeight === undefined ? undefined : round(weaponWeight / 20);
}

function countEquipmentWithFlag(entity: BaseEntity, flag: string): number {
    return entity.equipment().filter(mount => mount.equipment?.hasFlag(flag)).length;
}

function sumEquipmentTonnage(
    entity: BaseEntity,
    predicate: (mount: EntityMountedEquipment) => boolean,
): number | undefined {
    let tonnage = 0;
    for (const mount of entity.equipment()) {
        const equipment = mount.equipment;
        if (!equipment || !predicate(mount)) continue;
        if (equipment.type === 'ammo' || equipment.type === 'armor') continue;
        if (equipment instanceof MiscEquipment && equipment.isHeatSink) continue;

        const mountTonnage = mount.getTonnage(entity);
        if (mountTonnage === undefined) return undefined;
        tonnage += mountTonnage;
    }
    return tonnage;
}