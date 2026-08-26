// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { BaseEntity } from '../base-entity';
import type { AeroEntity } from '../entities/aero/aero-entity';
import type { BattleArmorEntity } from '../entities/infantry/battle-armor-entity';
import type { InfantryBaseEntity } from '../entities/infantry/infantry-base-entity';
import type { InfantryEntity } from '../entities/infantry/infantry-entity';
import type { JumpShipEntity } from '../entities/largecraft/jumpship-entity';
import type { MekEntity } from '../entities/mek/mek-entity';
import type { ProtoMekEntity } from '../entities/protomek/protomek-entity';
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

export function isProtoMekEntity(entity: BaseEntity): entity is ProtoMekEntity {
    return entity.entityType === 'ProtoMek';
}

export function isInfantryEntity(entity: BaseEntity): entity is InfantryEntity {
    return entity.entityType === 'Infantry';
}

export function isBattleArmorEntity(entity: BaseEntity): entity is BattleArmorEntity {
    return entity.entityType === 'BattleArmor';
}

export function isInfantryFamilyEntity(entity: BaseEntity): entity is InfantryBaseEntity {
    return isInfantryEntity(entity) || isBattleArmorEntity(entity);
}
