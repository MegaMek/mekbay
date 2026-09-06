// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import type { AeroEntity } from '../../../models/entity/entities/aero/aero-entity';
import { isAeroEntity } from '../../../models/entity/utils/entity-type-guards';
import { LargeAeroRecordSheetLayout } from './large-aero-record-sheet-layout';

/** Aerodyne and spheroid DropShips share the standard-scale vessel composition. */
export class DropShipRecordSheetLayout extends LargeAeroRecordSheetLayout {
    public readonly id = 'dropship';

    public matches(entity: BaseEntity): boolean {
        return isAeroEntity(entity) && entity.entityType === 'DropShip';
    }

    protected sheetTitle(entity: AeroEntity): string {
        return `${entity.getMotiveTypeAsString()?.toUpperCase() ?? 'AERODYNE'} DROPSHIP RECORD SHEET`;
    }

    protected dataPanelTitle(): string {
        return 'DROPSHIP DATA';
    }

    protected paperdollAsset(entity: AeroEntity): string {
        const spheroid = entity.motiveType() === 'Spheroid';
        return `/images/paperdolls/dropship-${spheroid ? 'spheroid' : 'aerodyne'}.svg`;
    }
}
