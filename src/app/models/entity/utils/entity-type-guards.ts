import type { BaseEntity } from '../base-entity';
import type { AeroEntity } from '../entities/aero/aero-entity';
import type { JumpShipEntity } from '../entities/largecraft/jumpship-entity';
import type { MekEntity } from '../entities/mek/mek-entity';
import type { VehicleEntity } from '../entities/vehicle/vehicle-entity';

export function isMekEntity(entity: BaseEntity): entity is MekEntity {
    return entity.entityType === 'Mek';
}

export function isVehicleEntity(entity: BaseEntity): entity is VehicleEntity {
    return entity.entityType === 'Tank'
        || entity.entityType === 'Naval'
        || entity.entityType === 'VTOL'
        || entity.entityType === 'SupportTank'
        || entity.entityType === 'SupportNaval'
        || entity.entityType === 'SupportVTOL'
        || entity.entityType === 'LargeSupportTank';
}

export function isAeroEntity(entity: BaseEntity): entity is AeroEntity {
    return entity.entityType === 'Aero'
        || entity.entityType === 'ConvFighter'
        || entity.entityType === 'FixedWingSupport'
        || entity.entityType === 'SmallCraft'
        || entity.entityType === 'DropShip'
        || entity.entityType === 'JumpShip'
        || entity.entityType === 'WarShip'
        || entity.entityType === 'SpaceStation';
}

export function isJumpShipEntity(entity: BaseEntity): entity is JumpShipEntity {
    return entity.entityType === 'JumpShip';
}