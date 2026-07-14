import type { BaseEntity } from '../base-entity';
import { JumpShipEntity } from '../entities/largecraft/jumpship-entity';
import { SpaceStationEntity } from '../entities/largecraft/space-station-entity';
import { WarShipEntity } from '../entities/largecraft/warship-entity';
import type { EntityMountedEquipment } from '../types/equipment';

export function getSrcsTonnage(entity: BaseEntity, mount: EntityMountedEquipment): number {
    if (entity.tonnage() < 10) return mount.equipment?.hasFlag('S_IMPROVED') ? 1 : 0;

    let percent = 0.05;
    if (entity.entityType === 'DropShip' || entity.entityType === 'SpaceStation') percent = 0.07;
    else if (entity.entityType === 'JumpShip' || entity.entityType === 'WarShip') percent = 0.1;

    if (mount.equipment?.hasFlag('S_IMPROVED')) {
        percent += mount.equipment.hasFlag('F_SASRCS') ? 0.01 : 0.02;
    } else if (mount.equipment?.hasFlag('S_ELITE')) {
        percent += 0.03;
    }

    if (entity instanceof JumpShipEntity && !(entity instanceof SpaceStationEntity)) {
        return Math.ceil((entity.tonnage() - getJumpDriveWeight(entity)) * percent);
    }
    return standardRound(entity.tonnage() * percent);
}

export function getCasparTonnage(entity: BaseEntity, improved: boolean): number {
    let percent = 0.05;
    if (entity.entityType === 'DropShip') percent = 0.04;
    else if (entity.entityType === 'SpaceStation') percent = 0.08;
    else if (entity.entityType === 'WarShip') percent = 0.06;

    if (improved) percent = percent === 0.05 ? 0.07 : percent + 0.04;
    const weight = entity.tonnage() * percent;
    return entity instanceof JumpShipEntity ? Math.ceil(weight) : standardRound(weight);
}

export function getCasparIITonnage(entity: BaseEntity, improved: boolean): number {
    let percent = 0.06;
    if (entity.entityType === 'DropShip') percent = 0.08;
    else if (entity.entityType === 'SpaceStation') percent = 0.1;
    else if (entity.entityType === 'WarShip') percent = 0.12;

    if (improved) percent = percent === 0.06 ? 0.08 : percent + 0.04;
    const weight = entity.tonnage() * percent;
    return entity instanceof JumpShipEntity ? Math.ceil(weight) : standardRound(weight);
}

function getJumpDriveWeight(entity: JumpShipEntity): number {
    let coreType = 0;
    if (entity instanceof SpaceStationEntity) coreType = 3;
    else if (entity instanceof WarShipEntity) coreType = entity.kfCore();

    const percentages = [0.95, 0.4525, 0.5, 0, 0.95];
    const percent = coreType === 4
        ? 0.05 + (0.03 * entity.jumpRange())
        : percentages[coreType] ?? percentages[0];
    return Math.ceil(entity.tonnage() * percent);
}

function standardRound(tonnage: number): number {
    return Math.ceil(tonnage * 2) / 2;
}