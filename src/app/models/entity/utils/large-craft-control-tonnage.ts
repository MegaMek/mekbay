import type { BaseEntity } from '../base-entity';
import type { EntityMountedEquipment } from '../types/equipment';
import { isJumpShipEntity } from './entity-type-guards';

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

    if (isJumpShipEntity(entity)) {
        return Math.ceil((entity.tonnage() - entity.jumpDriveWeight()) * percent);
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
    return entity.entityType === 'JumpShip' || entity.entityType === 'SpaceStation'
        ? Math.ceil(weight)
        : standardRound(weight);
}

export function getCasparIITonnage(entity: BaseEntity, improved: boolean): number {
    let percent = 0.06;
    if (entity.entityType === 'DropShip') percent = 0.08;
    else if (entity.entityType === 'SpaceStation') percent = 0.1;
    else if (entity.entityType === 'WarShip') percent = 0.12;

    if (improved) percent = percent === 0.06 ? 0.08 : percent + 0.04;
    const weight = entity.tonnage() * percent;
    return entity.entityType === 'JumpShip' || entity.entityType === 'SpaceStation'
        ? Math.ceil(weight)
        : standardRound(weight);
}

export function standardRound(tonnage: number): number {
    const kilogramRounded = Math.round(tonnage * 1000) / 1000;
    return Math.ceil(kilogramRounded * 2) / 2;
}