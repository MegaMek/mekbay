// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import { isVehicleEntity } from '../../../models/entity/utils/entity-type-guards';
import { usesSixSideVehicleHull } from './vehicle-record-sheet-components';

export type CombatVehiclePaperdollFamily = 'vehicle' | 'vtol' | 'wige';

/** Motive type selects a ground or airborne vehicle's paperdoll. */
export function combatVehiclePaperdollFamily(entity: BaseEntity): CombatVehiclePaperdollFamily {
    const motive = `${entity.entityType} ${entity.getMotiveTypeAsString() ?? ''}`.toLowerCase();
    if (motive.includes('vtol')) return 'vtol';
    if (motive.includes('wige') && !usesSixSideVehicleHull(entity)) return 'wige';
    return 'vehicle';
}

export function combatVehiclePaperdollAsset(entity: BaseEntity): string {
    const family = combatVehiclePaperdollFamily(entity);
    const dualTurret = isVehicleEntity(entity) && entity.hasDualTurret();
    const turret = dualTurret || isVehicleEntity(entity) && entity.hasTurret();
    const turretKind = dualTurret && family !== 'vtol' ? 'dualturret' : turret ? 'turret' : 'noturret';
    const superheavy = usesSixSideVehicleHull(entity)
        && family !== 'vtol'
        && family !== 'wige';
    return `/images/paperdolls/${family}-${superheavy ? 'superheavy-' : ''}${turretKind}.svg`;
}

export function navalPaperdollAsset(entity: BaseEntity): string {
    const dualTurret = isVehicleEntity(entity) && entity.hasDualTurret();
    const turret = dualTurret || isVehicleEntity(entity) && entity.hasTurret();
    const turretKind = dualTurret ? 'dualturret' : turret ? 'turret' : 'noturret';
    const superheavy = usesSixSideVehicleHull(entity);
    return `/images/paperdolls/naval-${superheavy ? 'superheavy-' : ''}${turretKind}.svg`;
}
