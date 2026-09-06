// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import type { AeroEntity } from '../../../models/entity/entities/aero/aero-entity';
import { isAeroEntity } from '../../../models/entity/utils/entity-type-guards';
import { LargeAeroRecordSheetLayout } from './large-aero-record-sheet-layout';

/** Capital-scale vessels share bay tables and reverse sheets, with their own art and labels. */
export class CapitalShipRecordSheetLayout extends LargeAeroRecordSheetLayout {
    public readonly id = 'capital-ship';

    public matches(entity: BaseEntity): boolean {
        return isAeroEntity(entity) && (
            entity.entityType === 'JumpShip'
            || entity.entityType === 'WarShip'
            || entity.entityType === 'SpaceStation'
        );
    }

    protected sheetTitle(entity: AeroEntity): string {
        return `${this.vesselName(entity)} RECORD SHEET`;
    }

    protected dataPanelTitle(entity: AeroEntity): string {
        return `${this.vesselName(entity)} DATA`;
    }

    protected paperdollAsset(entity: AeroEntity): string {
        return `/images/paperdolls/${entity.entityType.toLowerCase()}.svg`;
    }

    private vesselName(entity: AeroEntity): string {
        return entity.entityType === 'SpaceStation' ? 'SPACE STATION' : entity.entityType.toUpperCase();
    }
}
